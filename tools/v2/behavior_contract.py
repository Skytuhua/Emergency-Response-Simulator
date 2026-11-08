"""Public, no-I/O v2 behavior contract. All numeric contract fields are safe integers.

Source byte hashes deliberately differ from canonical JSON identities. Full
Responses envelopes are private; portable evidence contains only selected text
and tool fields and establishes retained consistency, not remote authentication.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

MODEL = 'gpt-6.1-terra'
EFFORT = 'low'
SOURCE_COMMIT = '7657031ac01184afe2cb220f5ee3545573b5e843'
ADAPTER_VERSION = 'dallas-behavior-v2.1'
HORIZON_MS = 21_600_000
HASH_KEYS = ('populationHash', 'mapHash', 'eventTapeHash', 'supportHash')
CONTEXT_KEYS = ('householdId', 'opportunityId', 'atMs', *HASH_KEYS, 'size', 'accessiblePlacesRequired', 'communicationsAvailable', 'need')


def canonical(value: Any, depth: int = 0) -> str:
    if depth > 30:
        raise ValueError('Behavior nesting limit exceeded')
    if value is None or type(value) in (bool, str):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if type(value) is int and abs(value) <= 9_007_199_254_740_991:
        return str(value)
    if type(value) is list:
        return '[' + ','.join(canonical(item, depth + 1) for item in value) + ']'
    if type(value) is dict and all(type(key) is str for key in value):
        return '{' + ','.join(canonical(key) + ':' + canonical(value[key], depth + 1) for key in sorted(value)) + '}'
    raise ValueError('Behavior canonical values require safe integers and plain JSON')


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def hash_value(value: Any) -> str:
    return sha256(canonical(value))


def obj(value: Any, keys) -> dict:
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError('Unsupported or missing behavior fields')
    return value


def text(value: Any, maximum: int = 12000, empty: bool = False) -> str:
    if type(value) is not str or len(value) > maximum or (not empty and not value) or any(ord(c) < 32 and c not in '\n\r\t' for c in value):
        raise ValueError('Invalid behavior text')
    return value


def digest(value: Any) -> str:
    if type(value) is not str or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Invalid behavior SHA-256')
    return value


def integer(value: Any, minimum: int = 0, maximum: int = HORIZON_MS) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('Invalid behavior integer')
    return value


def validate_context(value: Any) -> dict:
    context = obj(value, CONTEXT_KEYS)
    for key in ('householdId', 'opportunityId'):
        text(context[key], 240)
    for key in HASH_KEYS:
        digest(context[key])
    integer(context['atMs'])
    integer(context['size'], 1, 100)
    integer(context['accessiblePlacesRequired'], 0, 100)
    if type(context['communicationsAvailable']) is not bool:
        raise ValueError('Missing communications state')
    if context['need'] is not None:
        need = obj(context['need'], ('id', 'householdId', 'kind', 'urgent', 'onsetMs', 'deadlineMs'))
        text(need['id'], 240)
        if need['householdId'] != context['householdId'] or need['kind'] not in ('delivery', 'relocation') or type(need['urgent']) is not bool:
            raise ValueError('Invalid actor-local need')
        integer(need['onsetMs'])
        integer(need['deadlineMs'])
        if not need['onsetMs'] <= context['atMs'] or need['deadlineMs'] < need['onsetMs']:
            raise ValueError('Future or invalid actor-local need')
    return context


def report_payload(context: dict) -> dict:
    return {'kind': 'help_request_v2', 'householdId': context['householdId'], 'opportunityId': context['opportunityId'],
            'contextHash': hash_value(context), 'needId': context['need']['id'] if context['need'] else None}


def action_instruction(context: dict) -> str:
    return ('Fictional Dallas exercise. You represent one synthetic household. Actor-local observations: ' + canonical(context) +
            '. Choose CREATE_POST to attempt reporting your current need, or DO_NOTHING to wait. A failed network still permits an attempted report. '
            'CREATE_POST is allowed only with a current need, and its content must contain exactly this JSON object, with optional surrounding speech: ' + canonical(report_payload(context)) +
            '. Do not add physical facts, medical outcomes, global conditions, capacities, or completed assistance. Other households are not observable.')


def persona_instruction(household_id: str, context: dict) -> str:
    facts = {key: context[key] for key in ('householdId', 'size', 'accessiblePlacesRequired')}
    return ('Create an illustrative fictional Dallas household representative, not an actual resident. Local household facts: ' + canonical(facts) +
            '. Return persona, age and profession as synthetic background. Do not infer a disability, medical priority, real identity or physical outcome. Background is never a triage feature.')


def make_manifest(contexts: list[dict], cohort_id: str) -> dict:
    if not contexts or len(contexts) > 12:
        raise ValueError('One cohort requires one to twelve action contexts')
    for context in contexts:
        validate_context(context)
    ids = sorted({context['householdId'] for context in contexts})
    if len(ids) > 6 or len({c['opportunityId'] for c in contexts}) != len(contexts):
        raise ValueError('Cohort is limited to six distinct actors and unique opportunities')
    first = contexts[0]
    if any(any(c[key] != first[key] for key in HASH_KEYS) for c in contexts):
        raise ValueError('All cohort inputs must share frozen asset hashes')
    prompts = []
    for household_id in ids:
        selected = [c for c in contexts if c['householdId'] == household_id]
        if len(selected) > 2:
            raise ValueError('Only need-onset and communications-change actions are supported')
        p = persona_instruction(household_id, selected[0])
        prompts.append(dict(id='persona:' + household_id, kind='persona', householdId=household_id, opportunityId=None, contextHash=None, text=p, sha256=sha256(p)))
        for context in selected:
            p = action_instruction(context)
            prompts.append(dict(id=context['opportunityId'], kind='action', householdId=household_id, opportunityId=context['opportunityId'], contextHash=hash_value(context), text=p, sha256=sha256(p)))
    return {'kind': 'dallas-behavior-preparation', 'version': 2, 'sourceCommit': SOURCE_COMMIT, 'adapterVersion': ADAPTER_VERSION,
            **{key: first[key] for key in HASH_KEYS}, 'api': 'responses', 'reasoningEffort': EFFORT,
            'profiles': {'model': MODEL, 'sdkRetries': 0, 'upstreamPaidRetries': 0, 'maxOutputTokens': 4096, 'requestBytesLimit': 50000},
            'social': {'actions': ['CREATE_POST', 'DO_NOTHING'], 'roundsPerOpportunity': 1, 'seededActions': 0, 'maxCallsPerOpportunity': 2, 'platformObservation': 'no-other-household-posts'},
            'actors': [{'householdId': identity, 'cohortId': cohort_id} for identity in ids], 'contexts': contexts,
            'prompts': prompts, 'logicalOpportunities': [prompt['id'] for prompt in prompts]}


def validate_manifest(value: Any) -> dict:
    if type(value) is dict and value.get('kind') == 'dallas-behavior-preparation-set':
        obj(value, ('kind', 'version', 'manifests'))
        if value['version'] != 2 or type(value['manifests']) is not list or not 1 <= len(value['manifests']) <= 4:
            raise ValueError('Unsupported behavior cohort set')
        if any(type(m) is not dict or m.get('kind') != 'dallas-behavior-preparation' for m in value['manifests']):
            raise ValueError('Nested cohort sets are unsupported')
        manifests = [validate_manifest(m) for m in value['manifests']]
        merged = dict(manifests[0])
        for key in ('actors', 'contexts', 'prompts', 'logicalOpportunities'):
            merged[key] = [item for manifest in manifests for item in manifest[key]]
        if any(any(m[key] != merged[key] for key in HASH_KEYS) for m in manifests):
            raise ValueError('Cohorts have different asset bindings')
        if (len({a['householdId'] for a in merged['actors']}) != len(merged['actors'])
                or len({m['actors'][0]['cohortId'] for m in manifests}) != len(manifests)
                or len(set(merged['logicalOpportunities'])) != len(merged['logicalOpportunities'])):
            raise ValueError('A cohort, actor or logical opportunity repeats across manifests')
        return merged
    manifest = obj(value, ('kind', 'version', 'sourceCommit', 'adapterVersion', *HASH_KEYS, 'api', 'reasoningEffort', 'profiles', 'social', 'actors', 'contexts', 'prompts', 'logicalOpportunities'))
    actors = manifest['actors']
    if type(actors) is not list or not 1 <= len(actors) <= 6:
        raise ValueError('Unsupported cohort size')
    for actor in actors:
        obj(actor, ('householdId', 'cohortId'))
        text(actor['householdId'], 240)
        text(actor['cohortId'], 240)
    if len({a['cohortId'] for a in actors}) != 1:
        raise ValueError('One manifest represents one admitted cohort')
    expected = make_manifest(manifest['contexts'], actors[0]['cohortId'])
    if canonical(manifest) != canonical(expected):
        raise ValueError('Manifest differs from exact supported prompts, contexts, model or retry settings')
    return manifest
