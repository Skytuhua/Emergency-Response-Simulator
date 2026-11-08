"""Thin instrumented execution of pinned MiroFish; invoked only by preparation CLI."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sqlite3
import sys
import types
from pathlib import Path

from normalize_mirofish import ROOT, canonical_hash, preparation_manifest, verified_model_persona


class CallGuard:
    """Bounds all SDK attempts before network I/O and retains usage without credentials.

    A conservative byte bound and 30-call cap costs under $1 at verified model rates,
    even if each UTF-8 request byte is counted as a token. SDK retries are disabled.
    """
    def __init__(self, work: Path):
        self.work = work
        ledger = work / "usage.json"
        self.calls = json.loads(ledger.read_text()) if ledger.exists() else []
        self.inflight_reserve = 0.0
        self.responses: dict[int, str] = {}

    def start(self, kwargs: dict) -> int:
        if len(self.calls) >= 30:
            raise RuntimeError("Preparation call-count limit reached")
        request_bytes = len(json.dumps({k:v for k,v in kwargs.items() if k != "extra_headers"}, default=str).encode())
        if request_bytes > 50000:
            raise RuntimeError("Preparation request byte limit reached")
        kwargs.pop("max_completion_tokens", None)
        kwargs["max_tokens"] = 1600
        kwargs["stream"] = False
        # Include a conservative fixed overhead allowance, rather than assuming JSON bytes exactly equal token counts.
        ceiling = (request_bytes + 4096) * 0.40 / 1_000_000 + 1600 * 1.60 / 1_000_000
        reserved = sum(c["reservedUsd"] for c in self.calls)
        if reserved + ceiling > float(os.environ["MIROFISH_BUDGET_USD"]):
            raise RuntimeError("Configured preparation budget reached")
        index = len(self.calls)
        self.calls.append({"requestHash":canonical_hash({k:v for k,v in kwargs.items() if k != "extra_headers"}), "requestBytes":request_bytes,
                           "reservedUsd":ceiling, "status":"started"})
        self.save()
        return index

    def finish(self, index: int, response=None):
        record = self.calls[index]
        if response is None:
            record["status"] = "failed"
        else:
            content = response.choices[0].message.content or ''
            self.responses[index] = content
            (self.work / f'sdk-response-{index}.json').write_text(json.dumps({
                'content': content, 'finishReason': response.choices[0].finish_reason,
                'responseId': response.id, 'model': response.model,
            }, indent=2), encoding='utf-8')
            usage = response.usage
            record.update(status="success", inputTokens=usage.prompt_tokens if usage else 0,
                          outputTokens=usage.completion_tokens if usage else 0)
            record["estimatedUsd"] = (record["inputTokens"] * .4 + record["outputTokens"] * 1.6) / 1_000_000
        self.save()

    def save(self):
        (self.work / "usage.json").write_text(json.dumps(self.calls, indent=2), encoding="utf-8")

    def install(self):
        from openai.resources.chat.completions import Completions, AsyncCompletions
        original_sync, original_async = Completions.create, AsyncCompletions.create
        guard = self
        def sync(client, *args, **kwargs):
            index = guard.start(kwargs)
            try:
                response = original_sync(client, *args, **kwargs)
                guard.finish(index, response)
                return response
            except Exception:
                guard.finish(index)
                raise
        async def async_call(client, *args, **kwargs):
            index = guard.start(kwargs)
            try:
                response = await original_async(client, *args, **kwargs)
                guard.finish(index, response)
                return response
            except Exception:
                guard.finish(index)
                raise
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
        usage = {"calls":len(guard.calls), "inputTokens":sum(c.get("inputTokens",0) for c in guard.calls),
                 "outputTokens":sum(c.get("outputTokens",0) for c in guard.calls), "estimatedUsd":sum(c.get("estimatedUsd",0) for c in guard.calls)}
        (work / "profiles-evidence.json").write_text(json.dumps({"model":os.environ["LLM_MODEL_NAME"], "profiles":evidence, "usage":usage}, indent=2), encoding="utf-8")


def social(work: Path, guard: CallGuard):
    path = ROOT / "vendor/MiroFish/backend/scripts/run_reddit_simulation.py"
    spec = importlib.util.spec_from_file_location("pinned_reddit_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType
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
    runner._create_model = lambda: ModelFactory.create(model_platform=ModelPlatformType.OPENAI, model_type=os.environ["LLM_MODEL_NAME"],
        api_key=os.environ["OPENAI_API_KEY"], model_config_dict={"max_tokens":settings['maxTokens'],"temperature":settings['temperature']}, timeout=settings['timeoutSeconds'], max_retries=settings['sdkRetries'])
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
    profile["usage"] = {"calls":len(guard.calls), "inputTokens":sum(c.get("inputTokens",0) for c in guard.calls),
                        "outputTokens":sum(c.get("outputTokens",0) for c in guard.calls), "estimatedUsd":sum(c.get("estimatedUsd",0) for c in guard.calls)}
    profile_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")


if __name__ == "__main__":
    phase, work_path = sys.argv[1:]
    work = Path(work_path)
    guard = CallGuard(work)
    guard.install()
    {"profiles":profiles, "social":social}[phase](work, guard)
