"""Freeze actor-local v2 inputs offline; execute only through the shared paid gate.

Three initial opportunities mean one persona and two social actions per actor.
The CLI never reads credentials during freeze, estimate, validation or replay.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys

from behavior_contract import (ADAPTER_VERSION, EFFORT, HASH_KEYS, MODEL, SOURCE_COMMIT, action_instruction,
                               canonical, hash_value, make_manifest, sha256, validate_manifest)
from normalize_behavior import parse_report, request_contains_frozen_prompt, validate_artifact, verify_private_sources

ROOT = Path(__file__).resolve().parents[2]


def allowance_estimate(actors: int) -> dict:
    if type(actors) is not int or not 1 <= actors <= 6:
        raise ValueError('One cohort is limited to six actors')
    # Every actor has one persona call and two action opportunities, each with
    # at most one tool continuation. No SDK or upstream paid retry is allowed.
    calls = actors * 5
    ceiling = (Decimal(50000 + 4096) * Decimal('2.5') + Decimal(4096) * Decimal(5)) / Decimal(1_000_000)
    return {'actors': actors, 'maxCalls': calls, 'sdkRetries': 0, 'maxRequestBytes': 50000,
            'maxOutputTokens': 4096, 'maxUsd': format(ceiling * calls, '.6f'),
            'detail': 'Conservative existing reservation rates; execution also requires refreshed exact model/price/account admission.'}


def validate_work_root(work: Path, private: Path) -> Path:
    resolved = work.resolve()
    if resolved.parent != private.resolve() or not resolved.is_dir() or resolved.is_symlink():
        raise ValueError('Work must be an immediate physical child of the canonical private budget root')
    return resolved


def require_execution_gate(gate: dict) -> None:
    if (type(gate) is not dict or gate.get('kind') != 'dallas-v2-paid-cohort-authorization' or gate.get('version') != 2
            or gate.get('model') != MODEL or gate.get('reasoningEffort') != EFFORT
            or gate.get('authorized') is not True or not isinstance(gate.get('manifestHash'), str)
            or not isinstance(gate.get('allowanceUsd'), str)):
        raise ValueError('An explicit coordinator shared budget gate is required before credential access')


def worker_interpreter() -> list[str]:
    # OASIS opens its UTF-8 profile JSON without specifying an encoding.
    # Interpreter startup must select UTF-8 before any upstream module loads.
    return [sys.executable, '-X', 'utf8']


def episode_config(manifest: dict, work: Path, episode_index: int) -> dict:
    count = len(manifest['actors'])
    return dict(simulation_id=f'{work.name}-{episode_index}', llm_model=MODEL,
                time_config=dict(total_simulation_hours=1, minutes_per_round=60, agents_per_hour_min=count, agents_per_hour_max=count, peak_activity_multiplier=1, off_peak_activity_multiplier=1),
                agent_configs=[dict(agent_id=i, active_hours=[0], activity_level=1) for i in range(count)], event_config=dict(initial_posts=[]))


def admit_profile_resume(manifest: dict, work: Path, gate: dict, ledger: dict) -> list[dict]:
    """Offline admission only for a failure after profiles, before social I/O.

    It does not alter a ledger, reserve an allowance, read credentials or repeat
    any request. Unknown/partial episodes and already attempted social calls
    must be handled separately, never retried through this narrow recovery.
    """
    import re
    require_execution_gate(gate)
    validate_manifest(manifest)
    if (manifest['kind'] != 'dallas-behavior-preparation' or gate['manifestHash'] != hash_value(manifest)
            or json.loads((work / 'preparation-manifest.json').read_text(encoding='utf-8')) != manifest
            or ledger.get('version') != 1 or ledger.get('canonicalRoot') != str(work.parent.resolve())):
        raise ValueError('Resume inputs differ from the original cohort')
    cohorts = [row for row in ledger['cohorts'] if row['work'] == work.name]
    if len(cohorts) != 1 or cohorts[0]['status'] != 'active' or Decimal(cohorts[0]['allowanceUsd']) != Decimal(gate['allowanceUsd']):
        raise ValueError('Resume requires the same active whole-cohort allowance')
    expected = {p['id']: (1, 1) if p['kind'] == 'persona' else (2, 0) for p in manifest['prompts']}
    actual = {key: (row['limit'], row['attempts']) for key,row in ledger['opportunities'].items() if row['work'] == work.name}
    if actual != expected or any(type(value) is not int for pair in actual.values() for value in pair):
        raise ValueError('Resume requires completed profile attempts and zero social attempts')
    if (work / 'profiles-resume-claim.json').exists() or {path.name for path in work.glob('episode-*')} != {'episode-0'}:
        raise ValueError('Resume has already been claimed or contains another episode')
    episode = work / 'episode-0'
    if not episode.is_dir() or {path.name for path in episode.iterdir()} != {'contexts.json', 'reddit_profiles.json', 'simulation_config.json'}:
        raise ValueError('Resume only accepts a pre-social episode scaffold without a database or trace')
    contexts = [[c for c in manifest['contexts'] if c['householdId'] == actor['householdId']][0] for actor in manifest['actors']]
    if (json.loads((episode / 'contexts.json').read_text(encoding='utf-8')) != contexts
            or json.loads((episode / 'simulation_config.json').read_text(encoding='utf-8')) != episode_config(manifest, work, 0)):
        raise ValueError('Resume scaffold differs from the frozen contexts or configuration')
    verified = json.loads((work / 'profiles-verified.json').read_text(encoding='utf-8'))
    rows = json.loads((episode / 'reddit_profiles.json').read_text(encoding='utf-8'))
    usage = json.loads((work / 'usage.json').read_text(encoding='utf-8'))
    count = len(manifest['actors'])
    if len(rows) != count or len(verified) != count or len(usage) != count:
        raise ValueError('Resume requires exactly one successful profile request per actor')
    for prefix in ('responses', 'request', 'request-meta'):
        names = {path.name for path in work.glob(prefix + '-*.json') if prefix != 'request' or not path.name.startswith('request-meta-')}
        if names != {f'{prefix}-{index}.json' for index in range(count)}:
            raise ValueError('Resume contains missing or additional request evidence')
    profiles = []
    for index,(actor,row,profile,call) in enumerate(zip(manifest['actors'], rows, verified, usage)):
        logical = 'persona:' + actor['householdId']
        prompt = next(p for p in manifest['prompts'] if p['id'] == logical)
        request = json.loads((work / f'request-{index}.json').read_text(encoding='utf-8'))
        raw = json.loads((work / f'responses-{index}.json').read_text(encoding='utf-8'))
        metadata = json.loads((work / f'request-meta-{index}.json').read_text(encoding='utf-8'))
        if (call.get('status') != 'success' or call.get('logicalOpportunityId') != logical
                or call.get('model') != MODEL or call.get('responseModel') != MODEL or call.get('reasoningEffort') != EFFORT
                or metadata.get('logicalOpportunityId') != logical or call.get('requestHash') != hash_value(request)
                or request.get('model') != MODEL or request.get('reasoning') != {'effort': EFFORT}
                or not request_contains_frozen_prompt(request, prompt['text'])
                or raw.get('model') != MODEL or raw.get('status') != 'completed' or raw.get('error')):
            raise ValueError('Resume profile request/source was not successfully verified')
        texts = []
        for output in raw.get('output', []):
            if output.get('status') == 'incomplete' or output.get('type') == 'function_call':
                raise ValueError('Resume profile source is incomplete or contains a tool call')
            if output.get('type') == 'message':
                for part in output.get('content', []):
                    if part.get('type') != 'output_text':
                        raise ValueError('Resume profile source contains unsupported output')
                    texts.append(part['text'])
        source = json.loads(''.join(texts))
        if (profile.get('householdId') != actor['householdId']
                or any(profile.get(field) != source.get(field) for field in ('persona', 'age', 'profession'))
                or not isinstance(source.get('persona'), str) or not source['persona']
                or type(source.get('age')) is not int or not isinstance(source.get('profession'), str)
                or row.get('persona') != source['persona'] + '\n\n' + action_instruction(contexts[index])
                or row.get('age') != source['age'] or row.get('profession') != source['profession']
                or row.get('user_id') != index or row.get('name') != f'Synthetic Dallas actor {index + 1}'
                or not isinstance(row.get('username'), str) or not re.fullmatch(f'synthetic_dallas_actor_{index + 1}_[0-9]{{3}}', row['username'])
                or not isinstance(source.get('bio'), str) or row.get('bio') != source['bio'][:150]
                or row.get('mbti') != (source.get('mbti') or 'ISTJ') or row.get('country') != (source.get('country') or '中国')
                or row.get('interested_topics', []) != source.get('interested_topics', [])):
            raise ValueError('Resume saved profile differs from the verified original source')
        gender = {'男':'male', '女':'female', '机构':'other', '其他':'other', 'male':'male', 'female':'female', 'other':'other'}.get(str(source.get('gender') or '').lower().strip(), 'other')
        if row.get('gender') != gender or type(row.get('karma')) is not int or not 500 <= row['karma'] <= 5000 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', row.get('created_at', '')):
            raise ValueError('Resume saved profile metadata is invalid')
        allowed = {'user_id', 'username', 'name', 'bio', 'persona', 'karma', 'created_at', 'age', 'gender', 'mbti', 'country', 'profession', 'interested_topics'}
        if set(row) - allowed:
            raise ValueError('Resume saved profile has unsupported fields')
        restored = deepcopy(row)
        restored['user_name'] = restored.pop('username')
        restored['persona'] = source['persona']
        profiles.append(restored)
    return profiles


def validate_selected_tools(context: dict, calls: list[dict], selected: set[str]) -> None:
    if len(calls) > 1:
        raise ValueError('Multiple actions cannot execute in one opportunity')
    if calls and context['opportunityId'] in selected:
        raise ValueError('A tool continuation cannot execute a second action')
    for call in calls:
        args = json.loads(call['arguments'])
        if call['name'] == 'create_post' and isinstance(args, dict) and set(args) == {'content'}:
            parse_report(args['content'], context)
        elif call['name'] != 'do_nothing' or args != {}:
            raise ValueError('Model-selected action is outside the exact legal menu')
        selected.add(context['opportunityId'])


def disable_agent_retries(agent) -> None:
    """OASIS omits this CAMEL option; constrain the actual constructed actor."""
    agent.retry_attempts = 1
    if type(agent.retry_attempts) is not int or agent.retry_attempts != 1:
        raise ValueError('Actual OASIS/CAMEL actor still permits paid retries')


def configure_private_logging(work: Path):
    """Constrain upstream FileHandlers before imports or credential access.

    The preparation worker is an isolated process. Patch the base methods so
    later OASIS/CAMEL handlers, including rotating subclasses, receive the same
    directory and redaction rule. The returned cleanup is for offline tests.
    """
    import copy
    import logging
    import re
    import traceback
    root = work.resolve()
    directory = root / 'log'
    directory.mkdir(exist_ok=True)
    if directory.resolve().parent != root:
        raise ValueError('Private preparation log directory resolves outside its work root')
    original_init, original_emit = logging.FileHandler.__init__, logging.FileHandler.emit
    original_factory = logging.getLogRecordFactory()
    def scrub(value: str) -> str:
        return re.sub(r'sk-[A-Za-z0-9_-]+', '[REDACTED]', value)
    def bounded_init(handler, filename, *args, **kwargs):
        target = Path(filename).resolve()
        if not target.is_relative_to(root):
            target = directory / target.name
        original_init(handler, target, *args, **kwargs)
    def sanitized_record(record):
        safe = copy.copy(record)
        safe.msg, safe.args = scrub(record.getMessage()), ()
        safe.exc_text = scrub(''.join(traceback.format_exception(*record.exc_info))) if record.exc_info else scrub(record.exc_text) if record.exc_text else None
        safe.exc_info = None
        safe.stack_info = scrub(record.stack_info) if record.stack_info else None
        for key, value in vars(safe).items():
            if isinstance(value, str):
                setattr(safe, key, scrub(value))
        return safe
    def record_factory(*args, **kwargs):
        return sanitized_record(original_factory(*args, **kwargs))
    def sanitized_emit(handler, record):
        if not Path(handler.baseFilename).resolve().is_relative_to(root):
            return
        safe = sanitized_record(record)
        original_emit(handler, safe)
    # No pre-existing inherited file sink can bypass the confined base path.
    loggers = [logging.getLogger(), *(logger for logger in logging.Logger.manager.loggerDict.values() if isinstance(logger, logging.Logger))]
    for logger in loggers:
        for handler in list(logger.handlers):
            if isinstance(handler, logging.FileHandler):
                logger.removeHandler(handler)
                handler.close()
    logging.FileHandler.__init__, logging.FileHandler.emit = bounded_init, sanitized_emit
    logging.setLogRecordFactory(record_factory)
    def restore():
        for logger in [logging.getLogger(), *(value for value in logging.Logger.manager.loggerDict.values() if isinstance(value, logging.Logger))]:
            for handler in list(logger.handlers):
                if isinstance(handler, logging.FileHandler) and Path(handler.baseFilename).resolve().is_relative_to(root):
                    logger.removeHandler(handler)
                    handler.close()
        logging.FileHandler.__init__, logging.FileHandler.emit = original_init, original_emit
        logging.setLogRecordFactory(original_factory)
    return restore


def contexts_from_bundle(bundle: dict, actor_ids: list[str]) -> list[dict]:
    """Select local onset+20 and first subsequent communications observation.

    Data/world admission owns source/physical validity. Frozen asset hashes are
    copied rather than recomputed with this integer-only behavior canonicalizer.
    """
    households = {h['id']: h for h in bundle['assets']['population']['households']}
    support = {s['householdId']: s['accessiblePlacesRequired'] for s in bundle['assets']['support']}
    events = sorted(bundle['assets']['events'], key=lambda event: (event['effectiveAtMs'], event['id']))
    bindings = dict(populationHash=bundle['hashes']['population'], mapHash=bundle['hashes']['map'], eventTapeHash=bundle['hashes']['events'], supportHash=bundle['hashes']['support'])
    contexts = []
    for household_id in sorted(actor_ids):
        household = households.get(household_id)
        if not household or household_id not in support:
            raise ValueError('Selected actor lacks frozen household/support facts')
        onsets = [e for e in events if e['payload']['type'] == 'need-onset' and e['payload']['need']['householdId'] == household_id]
        if not onsets:
            raise ValueError('Actor lacks a local exogenous need onset')
        need = onsets[0]['payload']['need']
        report_at = need['onsetMs'] + bundle['behaviorRules']['reportDelayMs']
        changes = [e for e in events if e['effectiveAtMs'] > report_at and e['payload']['type'] == 'communications-change' and household_id in e['payload']['householdIds']]
        if report_at > bundle['horizonMs'] or not changes:
            raise ValueError('Actor lacks both supported social opportunities within the horizon')
        for at_ms, opportunity in ((report_at, f"report:{need['id']}:0"), (changes[0]['effectiveAtMs'], f"communications:{household_id}:{changes[0]['id']}")):
            available = True
            current_need = None
            for event in events:
                if event['effectiveAtMs'] > at_ms:
                    break
                payload = event['payload']
                if payload['type'] == 'communications-change' and household_id in payload['householdIds']:
                    available = payload['available']
                if payload['type'] == 'need-onset' and payload['need']['householdId'] == household_id:
                    current_need = payload['need']
            contexts.append(dict(householdId=household_id, opportunityId=opportunity, atMs=at_ms, **bindings,
                                 size=household['size'], accessiblePlacesRequired=support[household_id], communicationsAvailable=available, need=current_need))
    return contexts


def _raw_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_from_work(manifest: dict, work: Path) -> dict:
    """Normalize actual private provider and platform files, never fabricate actions."""
    profiles = json.loads((work / 'profiles-verified.json').read_text(encoding='utf-8'))
    usage = json.loads((work / 'usage.json').read_text(encoding='utf-8'))
    metadata = {int(path.stem.split('-')[-1]): json.loads(path.read_text(encoding='utf-8')) for path in work.glob('request-meta-*.json')}
    evidence, receipts, compact_by_opportunity = [], {}, {}
    for index, meta in sorted(metadata.items()):
        raw_path, request_path = work / f'responses-{index}.json', work / f'request-{index}.json'
        if not raw_path.exists() or index >= len(usage) or usage[index].get('status') != 'success':
            continue
        raw = json.loads(raw_path.read_text(encoding='utf-8'))
        if raw.get('model') != MODEL or raw.get('status') != 'completed' or raw.get('error'):
            continue
        outputs, tools = [], []
        for output in raw.get('output', []):
            if output.get('type') == 'message':
                for part in output.get('content', []):
                    if part.get('type') != 'output_text':
                        raise ValueError('Refused/unsupported provider output cannot be exported')
                    outputs.append(part['text'])
            elif output.get('type') == 'function_call':
                tools.append(dict(name=output['name'], arguments=output['arguments'], callId=output['call_id']))
        prompt = next(p for p in manifest['prompts'] if p['id'] == meta['logicalOpportunityId'])
        kind = 'persona-response' if prompt['kind'] == 'persona' else 'action-response'
        if kind == 'action-response' and not tools:
            # The tool continuation counts and remains private evidence, but
            # does not become a second newly generated platform action.
            continue
        payload = dict(model=MODEL, reasoningEffort=EFFORT, api='responses', status='completed', sourceResponseHash=_raw_sha(raw_path),
                       requestHash=hash_value(json.loads(request_path.read_text(encoding='utf-8'))), promptHash=prompt['sha256'],
                       householdId=prompt['householdId'], opportunityId=prompt['opportunityId'], contextHash=prompt['contextHash'], outputText=''.join(outputs), toolCalls=tools)
        identifier = f'response:{payload["sourceResponseHash"]}'
        item = dict(id=identifier, kind=kind, payload=payload, sha256=hash_value(payload))
        evidence.append(item)
        compact_by_opportunity[prompt['id']] = item
        receipts[identifier] = dict(id=identifier, url='https://api.openai.com/v1/responses', retrievedAt=meta['recordedAt'], sha256=payload['sourceResponseHash'],
                                    bytes=raw_path.stat().st_size, vintage='preparation-v2', license='private-synthetic-output', status='retained', notes=['Full provider envelope retained privately; portable fields establish consistency, not remote authentication.'])
    personas, actions = [], []
    for profile in profiles:
        source = compact_by_opportunity.get('persona:' + profile['householdId'])
        if not source:
            continue
        personas.append(dict(householdId=profile['householdId'], persona=profile['persona'], age=profile['age'], profession=profile['profession'], sourceResponseHash=source['payload']['sourceResponseHash'], model=MODEL, reasoningEffort=EFFORT, origin='llm-direct'))
    actor_ids = [a['householdId'] for a in manifest['actors']]
    for episode in sorted(work.glob('episode-*')):
        trace_path = episode / 'trace.json'
        if not trace_path.exists():
            continue
        contexts = json.loads((episode / 'contexts.json').read_text(encoding='utf-8'))
        for row in json.loads(trace_path.read_text(encoding='utf-8')):
            kind = str(row.get('action', '')).lower()
            if kind not in ('create_post', 'do_nothing'):
                continue
            agent_id = row.get('user_id')
            if type(agent_id) is not int or not 0 <= agent_id < len(actor_ids):
                raise ValueError('Platform trace references an unknown actor')
            context = contexts[agent_id]
            response = compact_by_opportunity.get(context['opportunityId'])
            if not response:
                continue
            info = json.loads(row['info']) if isinstance(row.get('info'), str) else row.get('info', {})
            content = info.get('content', '')
            source_action = f"{manifest['actors'][0]['cohortId']}:{episode.name}:reddit-trace-{row['source_rowid']}"
            payload = dict(householdId=context['householdId'], opportunityId=context['opportunityId'], agentId=agent_id, actionType=kind, content=content,
                           sourceActionId=source_action, sourceResponseHash=response['payload']['sourceResponseHash'], responseEvidenceId=response['id'], autonomous=True, successful=True, sourceTraceHash=hash_value(row))
            evidence.append(dict(id='upstream:' + source_action, kind='upstream-action', payload=payload, sha256=hash_value(payload)))
            receipt_id = 'trace:' + source_action
            receipts[receipt_id] = dict(id=receipt_id, url='urn:dallas-v2:oasis-trace', retrievedAt='retained-at-preparation', sha256=payload['sourceTraceHash'], bytes=len(canonical(row).encode('utf-8')),
                                         vintage='pinned-oasis', license='private-synthetic-output', status='retained')
            actions.append(dict(id='action:' + source_action, householdId=context['householdId'], opportunityId=context['opportunityId'], atMs=context['atMs'], contextHash=hash_value(context), action='report' if kind == 'create_post' else 'wait',
                                text=content, sourceResponseHash=payload['sourceResponseHash'], sourceActionId=source_action, origin='llm-direct', model=MODEL, reasoningEffort=EFFORT))
    artifact = dict(kind='dallas-prepared-behavior', version=2, manifestHash=hash_value(manifest), **{key: manifest[key] for key in HASH_KEYS}, personas=personas, contexts=manifest['contexts'], actions=actions,
                    sourceCommit=SOURCE_COMMIT, adapterVersion=ADAPTER_VERSION, sourceReceipts=list(receipts.values()), preparationManifest=manifest, evidence=evidence)
    return verify_private_sources(artifact, work)


def execute(manifest: dict, work: Path, gate: dict, key_file: Path, resume_profiles_only: bool = False) -> dict:
    """Actual upstream worker. This function is never used by tests or playback."""
    require_execution_gate(gate)
    validate_manifest(manifest)
    if manifest['kind'] != 'dallas-behavior-preparation' or any(len([c for c in manifest['contexts'] if c['householdId'] == actor['householdId']]) != 2 for actor in manifest['actors']):
        raise ValueError('Execution requires one original cohort with exactly two local social contexts per actor')
    if gate['manifestHash'] != hash_value(manifest):
        raise ValueError('Authorized manifest differs from frozen inputs')
    if not sys.flags.utf8_mode:
        raise ValueError('Paid workers require UTF-8 interpreter mode; use the execute CLI')
    # All provider imports and credential access are below the explicit gate.
    import asyncio
    from datetime import datetime, timezone
    import importlib.util
    import os
    import re
    import sqlite3
    import subprocess
    sys.path.insert(0, str(ROOT / 'tools'))
    from project_budget import V2CallGuard, _read, budget_lock, canonical_private_root, complete_cohort, reserve_cohort
    from prepare_mirofish import preflight_model
    from mirofish_worker import create_social_model, import_generator
    from terra_responses import TerraResponsesBridge
    work = validate_work_root(work, canonical_private_root())
    configure_private_logging(work)
    if json.loads((work / 'preparation-manifest.json').read_text(encoding='utf-8')) != manifest:
        raise ValueError('Actual work inputs differ from frozen manifest')
    actual = subprocess.check_output(['git', '-C', str(ROOT / 'vendor/MiroFish'), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(ROOT / 'vendor/MiroFish'), 'status', '--porcelain'], text=True).strip()
    if actual != SOURCE_COMMIT or dirty:
        raise ValueError('Pinned MiroFish source differs')
    from importlib.metadata import version
    expected_versions = {'camel-ai': '0.2.78', 'camel-oasis': '0.2.5', 'openai': '1.109.1'}
    versions = {name: version(name) for name in expected_versions}
    if versions != expected_versions:
        raise ValueError('Pinned MiroFish/OASIS/CAMEL transport dependency versions differ')
    version_receipt = dict(sourceCommit=actual, dependencies=versions)
    limits = {p['id']: 1 if p['kind'] == 'persona' else 2 for p in manifest['prompts']}
    resumed_profiles = None
    if resume_profiles_only:
        if json.loads((work / 'upstream-versions.json').read_text(encoding='utf-8')) != version_receipt:
            raise ValueError('Resume upstream versions differ from original preparation')
        with budget_lock(work.parent):
            resumed_profiles = admit_profile_resume(manifest, work, gate, _read(work.parent))
            # Exclusive, single-use admission also prevents concurrent recovery
            # workers from spending the same two-call social opportunity.
            protected = [path for path in work.rglob('*') if path.is_file() and path.parent.name != 'log']
            with (work / 'profiles-resume-claim.json').open('x', encoding='utf-8') as receipt_file:
                json.dump(dict(kind='pre-social-profile-resume', manifestHash=hash_value(manifest), profiles=len(resumed_profiles),
                               retainedFiles={str(path.relative_to(work)): _raw_sha(path) for path in sorted(protected)},
                               admittedAt=datetime.now(timezone.utc).isoformat()), receipt_file, indent=2)
    else:
        with (work / 'upstream-versions.json').open('x', encoding='utf-8') as receipt_file:
            json.dump(version_receipt, receipt_file, indent=2)
        reserve_cohort(work, gate['allowanceUsd'], limits)
    key_text = key_file.read_text(encoding='utf-8-sig')
    match = re.search(r'sk-[A-Za-z0-9_-]+', key_text)
    if not match:
        raise ValueError('Authorized credential was not found; credential content was not printed')
    key = match.group(0)
    receipt = preflight_model(work, key)
    os.environ.update(OPENAI_API_KEY=key, LLM_API_KEY=key, LLM_MODEL_NAME=MODEL, LLM_BASE_URL='https://api.openai.com/v1',
                      MIROFISH_BUDGET_USD=gate['allowanceUsd'], MIROFISH_PREFLIGHT_RECEIPT=str(receipt), MIROFISH_LANG='en', ZEP_API_KEY='', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    current: ContextVar[str] = ContextVar('behavior_logical_opportunity')
    prompt_by_id = {p['id']: p for p in manifest['prompts']}
    context_by_id = {c['opportunityId']: c for c in manifest['contexts']}
    selected_actions: set[str] = set()

    class LegalBridge(TerraResponsesBridge):
        def _finish(self, response, inputs, request_index):
            translated = super()._finish(response, inputs, request_index)
            prompt = prompt_by_id[current.get()]
            calls = translated.choices[0].message.tool_calls or []
            if prompt['kind'] == 'action':
                validate_selected_tools(context_by_id[prompt['id']], [dict(name=call.function.name, arguments=call.function.arguments) for call in calls], selected_actions)
            elif calls:
                raise ValueError('Persona generation must not execute tools')
            return translated

    class Guard(V2CallGuard):
        def start(self, kwargs):
            logical = current.get()
            prompt = prompt_by_id[logical]
            messages = kwargs.get('messages', [])
            if not any(isinstance(m.get('content'), str) and prompt['text'] in m['content'] for m in messages):
                raise ValueError('Actual upstream request omits the exact frozen actor instruction')
            index, prepared = super().start(kwargs)
            with (work / f'request-{index}.json').open('x', encoding='utf-8') as stream:
                json.dump(prepared, stream, ensure_ascii=False, indent=2)
            with (work / f'request-meta-{index}.json').open('x', encoding='utf-8') as stream:
                json.dump(dict(logicalOpportunityId=logical, recordedAt=datetime.now(timezone.utc).isoformat()), stream)
            return index, prepared

        @contextmanager
        def selected(self, logical):
            with self.opportunity(logical):
                token = current.set(logical)
                try:
                    yield
                finally:
                    current.reset(token)

    guard = Guard(work)
    guard.bridge = LegalBridge(work)
    guard.install()
    from openai import OpenAI
    Generator, EntityNode = import_generator()
    from app.utils.locale import set_locale
    set_locale('en')
    generator = Generator(api_key=key, model_name=MODEL, zep_api_key='')
    generator.client = OpenAI(api_key=key, base_url='https://api.openai.com/v1', max_retries=0, timeout=30)
    generated, verified = [], []
    if resumed_profiles is not None:
        from app.services.oasis_profile_generator import OasisAgentProfile
        generated = [OasisAgentProfile(**profile) for profile in resumed_profiles]
    for index, actor in enumerate([] if resumed_profiles is not None else manifest['actors']):
        prompt = prompt_by_id['persona:' + actor['householdId']]
        entity = EntityNode(uuid=actor['householdId'], name=f'Synthetic Dallas actor {index + 1}', labels=['Entity', 'Person'], summary=prompt['text'], attributes={'synthetic': True})
        before = len(guard.calls)
        with guard.selected(prompt['id']):
            profile = generator.generate_profile_from_entity(entity, user_id=index, use_llm=True)
        raw = [json.loads((work / f'responses-{n}.json').read_text(encoding='utf-8')) for n in range(before, len(guard.calls)) if (work / f'responses-{n}.json').exists()]
        model_text = [''.join(part.get('text', '') for output in r.get('output', []) if output.get('type') == 'message' for part in output.get('content', []) if part.get('type') == 'output_text') for r in raw if r.get('status') == 'completed' and r.get('model') == MODEL]
        exact = [json.loads(content) for content in model_text if content.startswith('{')]
        if not any(all(record.get(field) == getattr(profile, field) for field in ('persona', 'age', 'profession')) for record in exact):
            raise ValueError('Upstream profile used fallback or unverified fields; no social calls admitted')
        generated.append(profile)
        verified.append(dict(householdId=actor['householdId'], persona=profile.persona, age=profile.age, profession=profile.profession))
        (work / 'profiles-verified.json').write_text(json.dumps(verified, ensure_ascii=False, indent=2), encoding='utf-8')
    from oasis.social_agent.agent import SocialAgent
    original_action = SocialAgent.perform_action_by_llm
    for episode_index in range(2):
        episode = work / f'episode-{episode_index}'
        retained_scaffold = resume_profiles_only and episode_index == 0
        if not retained_scaffold:
            episode.mkdir()
        contexts = [[c for c in manifest['contexts'] if c['householdId'] == actor['householdId']][episode_index] for actor in manifest['actors']]
        config_path = episode / 'simulation_config.json'
        if not retained_scaffold:
            (episode / 'contexts.json').write_text(json.dumps(contexts, ensure_ascii=False, indent=2), encoding='utf-8')
            episode_profiles = deepcopy(generated)
            for index, profile in enumerate(episode_profiles):
                profile.persona += '\n\n' + action_instruction(contexts[index])
            generator.save_profiles(episode_profiles, str(episode / 'reddit_profiles.json'), platform='reddit')
            config_path.write_text(json.dumps(episode_config(manifest, work, episode_index)), encoding='utf-8')
        specification = importlib.util.spec_from_file_location('pinned_reddit_v2', ROOT / 'vendor/MiroFish/backend/scripts/run_reddit_simulation.py')
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        runner = module.RedditSimulationRunner(str(config_path), wait_for_commands=False)
        runner.AVAILABLE_ACTIONS = [module.ActionType.CREATE_POST, module.ActionType.DO_NOTHING]
        runner._create_model = lambda: create_social_model(dict(contextWindowTokens=32768, reasoningEffort='low', timeoutSeconds=30, sdkRetries=0))

        async def selected_action(agent):
            # Each actor observes only the frozen local context. Other actors'
            # contemporaneous platform posts do not become exogenous inputs.
            async def local_observation():
                return 'Independent synthetic opportunity. No messages from other households are available.'
            agent.env.to_text_prompt = local_observation
            disable_agent_retries(agent)
            with guard.selected(contexts[agent.social_agent_id]['opportunityId']):
                return await original_action(agent)

        SocialAgent.perform_action_by_llm = selected_action
        try:
            asyncio.run(runner.run(max_rounds=1))
        finally:
            SocialAgent.perform_action_by_llm = original_action
        connection = sqlite3.connect(episode / 'reddit_simulation.db')
        connection.row_factory = sqlite3.Row
        rows = [dict(row) for row in connection.execute('SELECT rowid AS source_rowid, * FROM trace ORDER BY rowid')]
        connection.close()
        (episode / 'trace.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    artifact = build_from_work(manifest, work)
    complete_cohort(work)
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest='command', required=True)
    freeze = subparsers.add_parser('freeze')
    freeze.add_argument('--bundle', type=Path, required=True)
    freeze.add_argument('--actors', nargs='+', required=True)
    freeze.add_argument('--cohort-id', required=True)
    freeze.add_argument('--output', type=Path, required=True)
    estimate = subparsers.add_parser('estimate')
    estimate.add_argument('--actors', type=int, default=6)
    for command in ('execute', '_worker'):
        paid = subparsers.add_parser(command)
        paid.add_argument('--manifest', type=Path, required=True)
        paid.add_argument('--work', type=Path, required=True)
        paid.add_argument('--gate', type=Path, required=True)
        paid.add_argument('--key-file', type=Path, required=True)
        paid.add_argument('--output', type=Path, required=True)
        paid.add_argument('--resume-profiles-only', action='store_true', help='Reuse verified profiles only after a pre-social failure; never retry a social request')
    args = parser.parse_args()
    if args.command == 'estimate':
        print(json.dumps(allowance_estimate(args.actors)))
        return 0
    if args.command == 'freeze':
        bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
        if len(set(args.actors)) != len(args.actors):
            parser.error('Actor IDs must be unique')
        manifest = make_manifest(contexts_from_bundle(bundle, args.actors), args.cohort_id)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
        print(json.dumps(dict(manifestHash=hash_value(manifest), **allowance_estimate(len(manifest['actors'])))))
        return 0
    gate = json.loads(args.gate.read_text(encoding='utf-8'))
    require_execution_gate(gate)
    if args.output.exists():
        parser.error('Completed output is never overwritten')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest = validate_manifest(json.loads(args.manifest.read_text(encoding='utf-8')))
    if args.command == 'execute':
        # Capture upstream logging: an authentication failure can contain a
        # provider-generated credential fragment. Nothing is streamed publicly.
        import os
        import re
        import subprocess
        import uuid
        sys.path.insert(0, str(ROOT / 'tools'))
        from project_budget import canonical_private_root
        work = validate_work_root(args.work, canonical_private_root())
        log_path = work / (f'worker-resume-{uuid.uuid4().hex}.log' if args.resume_profiles_only else 'worker.log')
        if log_path.exists():
            parser.error('Existing worker evidence is never overwritten; inspect the original failure before resuming')
        command = worker_interpreter() + [str(Path(__file__).resolve()), '_worker', '--manifest', str(args.manifest.resolve()), '--work', str(work), '--gate', str(args.gate.resolve()), '--key-file', str(args.key_file.resolve()), '--output', str(args.output.resolve())]
        if args.resume_profiles_only:
            command.append('--resume-profiles-only')
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=os.name != 'nt', cwd=work)
        timed_out = False
        try:
            output, _ = process.communicate(timeout=480)
        except subprocess.TimeoutExpired:
            timed_out = True
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
            else:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        safe = re.sub(r'sk-[A-Za-z0-9_-]+', '[REDACTED]', output.decode('utf-8', errors='replace'))
        with log_path.open('x', encoding='utf-8') as log:
            log.write(safe)
        if timed_out or process.returncode != 0:
            print(json.dumps(dict(status='timeout' if timed_out else 'failed', detail='Sanitized private worker evidence and conservative reservations retained.')))
            return 2
        artifact = validate_artifact(json.loads(args.output.read_text(encoding='utf-8')))
        print(json.dumps(dict(status='completed', directPersonaActors=len(artifact['personas']), directPreparedActions=len(artifact['actions']))))
        return 0
    artifact = execute(manifest, args.work, gate, args.key_file, args.resume_profiles_only)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(artifact, stream, ensure_ascii=False, indent=2)
    print(json.dumps(dict(directPersonaActors=len(artifact['personas']), directPreparedActions=len(artifact['actions']))))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
