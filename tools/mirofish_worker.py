"""Thin instrumented execution of pinned MiroFish; invoked only by preparation CLI."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sqlite3
import sys
import types
import uuid
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from pathlib import Path

from normalize_mirofish import ROOT, canonical_hash, preparation_manifest, verified_model_persona
from terra_responses import MAX_OUTPUT_TOKENS, TERRA_MODEL, TerraResponsesBridge

AUDITED_PRIOR_USD = Decimal("0.0093664")
TOTAL_BUDGET_USD = Decimal("10")
RESERVED_INPUT_USD_PER_MILLION = Decimal("2.50")
INPUT_USD_PER_MILLION = Decimal("1")
OUTPUT_USD_PER_MILLION = Decimal("5")
MODEL_ENDPOINT = "https://api.openai.com/v1/models/" + TERRA_MODEL


def _money(value) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("Invalid preparation budget accounting") from None
    if not result.is_finite() or result < 0:
        raise ValueError("Invalid preparation budget accounting")
    return result


def _load_calls(work: Path) -> list[dict]:
    path = work / "usage.json"
    calls = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    if not isinstance(calls, list) or any(not isinstance(call, dict) for call in calls):
        raise ValueError("Invalid preparation usage ledger")
    return calls


def _charged(calls: list[dict]) -> Decimal:
    total = Decimal(0)
    for call in calls:
        reserved = _money(call["reservedUsd"])
        charged = _money(call.get("chargedUsd", reserved))
        if call.get("status") != "success" or call.get("accounting") != "usage-estimate":
            charged = max(charged, reserved)
        total += charged
    return total


def cumulative_spend(private: Path) -> Decimal:
    """Audited legacy expense plus all persistent Terra reservations/charges.

    Legacy ledgers are covered by the explicit audited baseline, so they are
    preserved without being charged twice. New calls can only use Terra.
    """
    total = AUDITED_PRIOR_USD
    for work in private.iterdir():
        if not work.is_dir():
            continue
        manifest = work / "preparation-manifest.json"
        if not manifest.exists():
            continue
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("profiles", {}).get("model") == TERRA_MODEL:
            total += _charged(_load_calls(work))
    return total


@contextmanager
def budget_lock(private: Path):
    """Serialize ledger updates; the operating system releases crashed locks."""
    with (private / "terra-budget.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError("Another preparation is updating the shared budget; retry later") from None
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


class CallGuard:
    """Reserve the expanded Terra request before I/O and retain uncertain costs."""
    def __init__(self, work: Path):
        self.work = work
        try:
            manifest = json.loads((work / "preparation-manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise ValueError("Terra preparation requires its retained run manifest") from None
        if manifest.get("profiles", {}).get("model") != TERRA_MODEL:
            raise ValueError("New preparation calls require a Terra run manifest")
        self.calls = _load_calls(work)
        self.budget = _money(os.environ["MIROFISH_BUDGET_USD"])
        if not 0 < self.budget <= TOTAL_BUDGET_USD:
            raise ValueError("Preparation run budget must be above zero and at most $10")
        self.bridge = TerraResponsesBridge(work)
        self.responses: dict[int, str] = {}
        try:
            receipt_path = Path(os.environ["MIROFISH_PREFLIGHT_RECEIPT"]).resolve()
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        except (KeyError, OSError, ValueError):
            raise ValueError("A successful private Terra account preflight receipt is required") from None
        if (receipt_path.parent != work.resolve() or receipt.get("model") != TERRA_MODEL
                or receipt.get("available") is not True or receipt.get("statusCode") != 200
                or receipt.get("endpoint") != MODEL_ENDPOINT):
            raise ValueError("A successful private Terra account preflight receipt is required")

    def start(self, kwargs: dict) -> tuple[int, dict]:
        with budget_lock(self.work.parent):
            self.calls = _load_calls(self.work)
            if len(self.calls) >= 30:
                raise RuntimeError("Preparation call-count limit reached")
            index = len(self.calls)
            prepared = self.bridge.prepare(kwargs, index)
            request_bytes = len(json.dumps(prepared, allow_nan=False).encode("utf-8"))
            if request_bytes > 50000:
                raise RuntimeError("Expanded preparation request byte limit reached")
            # Count every request byte as a token plus a fixed overhead. The
            # input rate also covers published cache-write rates; estimated
            # actual usage below uses standard input/output rates only.
            ceiling = ((request_bytes + 4096) * RESERVED_INPUT_USD_PER_MILLION
                       + MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION) / 1_000_000
            if _charged(self.calls) + ceiling > self.budget:
                raise RuntimeError("Configured preparation run budget reached")
            if cumulative_spend(self.work.parent) + ceiling > TOTAL_BUDGET_USD:
                raise RuntimeError("Cumulative $10 preparation budget reached")
            self.calls.append({"model": TERRA_MODEL, "api": "responses", "reasoningEffort": "low",
                "requestHash": canonical_hash(prepared), "requestBytes": request_bytes,
                "maxOutputTokens": MAX_OUTPUT_TOKENS, "reservedUsd": float(ceiling),
                "chargedUsd": float(ceiling), "status": "started", "accounting": "reserved",
                "reservedInputUsdPerMillion": float(RESERVED_INPUT_USD_PER_MILLION),
                "estimatedInputUsdPerMillion": 1, "outputUsdPerMillion": 5})
            self.save()
            return index, prepared

    def finish(self, index: int, response=None):
        with budget_lock(self.work.parent):
            self.calls = _load_calls(self.work)
            record = self.calls[index]
            accepted = response is not None and response.choices[0].finish_reason in {"stop", "tool_calls"}
            record["status"] = "success" if accepted else "rejected" if response is not None else "failed"
            receipt_path = self.work / f"responses-{index}.json"
            raw = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else {}
            usage = raw.get("usage")
            if isinstance(usage, dict):
                counts = [usage.get("input_tokens"), usage.get("output_tokens")]
                if all(type(count) is int and count >= 0 for count in counts):
                    record.update(inputTokens=counts[0], outputTokens=counts[1], responseModel=raw.get("model"),
                        cachedInputTokens=(usage.get("input_tokens_details") or {}).get("cached_tokens", 0),
                        reasoningTokens=(usage.get("output_tokens_details") or {}).get("reasoning_tokens", 0))
                    if raw.get("model") == TERRA_MODEL:
                        actual = (counts[0] * INPUT_USD_PER_MILLION + counts[1] * OUTPUT_USD_PER_MILLION) / 1_000_000
                        record["estimatedUsd"] = float(actual)
                        if accepted:
                            record.update(chargedUsd=float(actual), accounting="usage-estimate")
                        elif actual > _money(record["chargedUsd"]):
                            record["chargedUsd"] = float(actual)
            if response is not None:
                content = response.choices[0].message.content or ""
                finish_reason = response.choices[0].finish_reason
                record["finishReason"] = finish_reason
                if finish_reason == "stop" and not response.choices[0].message.refusal:
                    self.responses[index] = content
                with (self.work / f"sdk-response-{index}.json").open("x", encoding="utf-8") as evidence:
                    json.dump({"content": content, "finishReason": finish_reason,
                               "responseId": response.id, "model": response.model}, evidence, indent=2)
            self.save()
            if _charged(self.calls) > self.budget or cumulative_spend(self.work.parent) > TOTAL_BUDGET_USD:
                raise RuntimeError("Reported preparation usage exceeded the reserved budget; further calls blocked")

    def save(self):
        temporary = self.work / f"usage-{uuid.uuid4().hex}.tmp"
        temporary.write_text(json.dumps(self.calls, indent=2), encoding="utf-8")
        os.replace(temporary, self.work / "usage.json")

    def usage_summary(self) -> dict:
        return {"calls": len(self.calls), "inputTokens": sum(c.get("inputTokens", 0) for c in self.calls),
            "outputTokens": sum(c.get("outputTokens", 0) for c in self.calls),
            "estimatedUsd": sum(c.get("estimatedUsd", 0) for c in self.calls),
            "chargedUsd": float(_charged(self.calls)), "reservedUsd": sum(c["reservedUsd"] for c in self.calls),
            "estimateDetail": "Standard input/output token estimate; uncertain calls retain conservative reservations."}

    @staticmethod
    def _validate_client(resource):
        if resource._client.max_retries != 0 or str(resource._client.base_url).rstrip("/") != "https://api.openai.com/v1":
            raise ValueError("Preparation requires the direct OpenAI endpoint with SDK retries disabled")

    def create(self, resource, kwargs: dict):
        self._validate_client(resource)
        index, prepared = self.start(kwargs)
        try:
            response = self.bridge.create_prepared(resource, prepared, index)
        except Exception:
            self.finish(index)
            raise
        self.finish(index, response)
        if response.choices[0].finish_reason not in {"stop", "tool_calls"}:
            raise RuntimeError("Terra response was incomplete or refused; raw evidence retained")
        return response

    async def acreate(self, resource, kwargs: dict):
        self._validate_client(resource)
        index, prepared = self.start(kwargs)
        try:
            response = await self.bridge.acreate_prepared(resource, prepared, index)
        except Exception:
            self.finish(index)
            raise
        self.finish(index, response)
        if response.choices[0].finish_reason not in {"stop", "tool_calls"}:
            raise RuntimeError("Terra response was incomplete or refused; raw evidence retained")
        return response

    def install(self):
        from openai.resources.chat.completions import Completions, AsyncCompletions
        guard = self
        def sync(client, *args, **kwargs):
            if args:
                raise ValueError("Preparation requires keyword-only SDK requests")
            return guard.create(client, kwargs)
        async def async_call(client, *args, **kwargs):
            if args:
                raise ValueError("Preparation requires keyword-only SDK requests")
            return await guard.acreate(client, kwargs)
        Completions.create, AsyncCompletions.create = sync, async_call


def import_generator():
    sys.path.insert(0, str(ROOT / "vendor/MiroFish/backend"))
    # Avoid app.services' eager imports of unrelated graph/server services. Load real module files unchanged.
    import app
    namespace = types.ModuleType("app.services")
    namespace.__path__ = [str(ROOT / "vendor/MiroFish/backend/app/services")]
    sys.modules["app.services"] = namespace
    from app.services.oasis_profile_generator import OasisProfileGenerator
    from app.services.zep_entity_reader import EntityNode
    return OasisProfileGenerator, EntityNode


def profiles(work: Path, guard: CallGuard):
    from openai import OpenAI
    Generator, EntityNode = import_generator()
    from app.utils.locale import set_locale
    set_locale("en")
    contract = json.loads((work / "contract.json").read_text())
    manifest = json.loads((work / 'preparation-manifest.json').read_text())
    if manifest != preparation_manifest(contract, os.environ['LLM_MODEL_NAME']):
        raise RuntimeError('Actual preparation inputs do not match the retained manifest')
    settings = manifest['profiles']
    generator = Generator(api_key=os.environ["OPENAI_API_KEY"], model_name=os.environ["LLM_MODEL_NAME"], zep_api_key="")
    generator.client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=settings['baseUrl'], max_retries=settings['sdkRetries'], timeout=settings['timeoutSeconds'])
    original_fallback = generator._generate_profile_rule_based
    fallback = []
    def tracked_fallback(*args, **kwargs):
        fallback.append(True)
        return original_fallback(*args, **kwargs)
    generator._generate_profile_rule_based = tracked_fallback
    retained, evidence = [], []
    for index, actor in enumerate(contract["actorContexts"]):
        before_fallback = len(fallback)
        before_calls = len(guard.calls)
        entity_input = manifest['entities'][index]
        entity = EntityNode(**{k: entity_input[k] for k in ('uuid', 'name', 'labels', 'summary', 'attributes')})
        profile = generator.generate_profile_from_entity(entity, user_id=index, use_llm=settings['useLlm'])
        original_persona = profile.persona
        appended = entity_input['instruction']
        raw_responses = [guard.responses[i] for i in range(before_calls, len(guard.calls)) if i in guard.responses]
        succeeded = len(fallback) == before_fallback and verified_model_persona(raw_responses, original_persona)
        evidence.append({"householdId":actor["householdId"], "displayName":profile.name, "persona":original_persona,
                         "outcome":"llm" if succeeded else "rule-fallback", "instruction":appended})
        profile.persona = original_persona + "\n\n" + appended
        retained.append(profile)
        generator.save_profiles(retained, str(work / "reddit_profiles.json"), platform="reddit")
        usage = guard.usage_summary()
        (work / "profiles-evidence.json").write_text(json.dumps({"model":os.environ["LLM_MODEL_NAME"], "profiles":evidence, "usage":usage}, indent=2), encoding="utf-8")


def create_social_model(settings: dict, factory=None):
    if factory is None:
        from camel.models import ModelFactory
        factory = ModelFactory.create
    model = factory(model_platform='openai', model_type=TERRA_MODEL,
        api_key=os.environ['OPENAI_API_KEY'], url='https://api.openai.com/v1',
        model_config_dict={'max_tokens':settings['contextWindowTokens'], 'reasoning_effort':settings['reasoningEffort']},
        timeout=settings['timeoutSeconds'], max_retries=settings['sdkRetries'])
    # Pinned CAMEL resets this value in its base constructor. Constrain the
    # actual SDK clients as well; CallGuard independently verifies them at I/O.
    model._max_retries = settings['sdkRetries']
    model._client.max_retries = settings['sdkRetries']
    model._async_client.max_retries = settings['sdkRetries']
    return model


def social(work: Path, guard: CallGuard):
    path = ROOT / "vendor/MiroFish/backend/scripts/run_reddit_simulation.py"
    spec = importlib.util.spec_from_file_location("pinned_reddit_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    manifest = json.loads((work / 'preparation-manifest.json').read_text())
    contract = json.loads((work / 'contract.json').read_text())
    if manifest != preparation_manifest(contract, os.environ['LLM_MODEL_NAME']):
        raise RuntimeError('Social inputs do not match the retained preparation manifest')
    settings = manifest['social']
    config = {"simulation_id":work.name,"llm_model":settings['model'],
              'time_config': settings['time_config'], 'agent_configs': settings['agent_configs'], 'event_config': settings['event_config']}
    config_path = work / "simulation_config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    runner = module.RedditSimulationRunner(str(config_path), wait_for_commands=settings['waitForCommands'])
    # Actual upstream runner and LLMAction behavior, with a minimal action menu and bounded backend configuration.
    runner.AVAILABLE_ACTIONS = [getattr(module.ActionType, action) for action in settings['actions']]
    runner._create_model = lambda: create_social_model(settings)
    original_select = runner._get_active_agents_for_round
    selected_counts = []
    def select(*args, **kwargs):
        result = original_select(*args, **kwargs)
        selected_counts.append(len(result))
        return result
    runner._get_active_agents_for_round = select
    asyncio.run(runner.run(max_rounds=settings['rounds']))
    connection = sqlite3.connect(work / "reddit_simulation.db")
    connection.row_factory = sqlite3.Row
    schema = [dict(row) for row in connection.execute("SELECT name, sql FROM sqlite_master WHERE type='table'")]
    (work / "sqlite-schema.json").write_text(json.dumps(schema, indent=2), encoding="utf-8")
    rows = [dict(row) for row in connection.execute("SELECT rowid AS source_rowid, * FROM trace ORDER BY rowid")]
    (work / "trace.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    actions = []
    for row in rows:
        kind = str(row.get("action", row.get("action_type", ""))).lower()
        if kind not in ("create_post", "create_comment", "do_nothing"):
            continue
        info = row.get("info", "{}")
        info = json.loads(info) if isinstance(info, str) else info
        if not isinstance(info, dict):
            continue
        # CREATE_POST trace only exists after successful platform insertion; no ManualAction posts are supplied.
        actions.append({"id":f"reddit-trace-{row['source_rowid']}", "agentId":row.get("user_id"),
                        "actionType":kind, "autonomous":True, "successful":True, "content":info.get("content", "")})
    connection.close()
    evidence = {"rounds":1, "activeAgents":selected_counts[0] if selected_counts else 0, "actions":actions,
                "detail":"Actual pinned RedditSimulationRunner with one LLMAction round, hour-zero activity, no seeded posts, CREATE_POST/DO_NOTHING action menu. Successful platform trace rows retained."}
    (work / "social-evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    profile_path = work / "profiles-evidence.json"
    profile = json.loads(profile_path.read_text())
    profile["usage"] = guard.usage_summary()
    profile_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")


if __name__ == "__main__":
    phase, work_path = sys.argv[1:]
    work = Path(work_path)
    guard = CallGuard(work)
    guard.install()
    {"profiles":profiles, "social":social}[phase](work, guard)
