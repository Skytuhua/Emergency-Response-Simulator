"""Offline admission of retained v2 compact evidence; never invokes a provider."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import hashlib
from pathlib import Path

from behavior_contract import (ADAPTER_VERSION, CONTEXT_KEYS, EFFORT, HASH_KEYS, MODEL, SOURCE_COMMIT,
                               canonical, digest, hash_value, integer, obj, report_payload, sha256, text,
                               validate_context, validate_manifest)


def parse_report(content: str, context: dict) -> dict:
    text(content)
    if content.count('{') > 64:
        raise ValueError('Report JSON candidate limit exceeded')
    class DuplicateKey(ValueError):
        pass
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise DuplicateKey('Duplicate report JSON key')
            result[key] = value
        return result
    decoder, matches = json.JSONDecoder(object_pairs_hook=unique_object), []
    for index, char in enumerate(content):
        if char != '{':
            continue
        try:
            value, _ = decoder.raw_decode(content[index:])
        except DuplicateKey:
            raise ValueError('Duplicate report JSON key') from None
        except (ValueError, RecursionError):
            continue
        if isinstance(value, dict) and value.get('kind') == 'help_request_v2':
            matches.append(value)
    if len(matches) != 1 or matches[0] != report_payload(context) or context['need'] is None:
        raise ValueError('Report must contain one exact actor-local request and no extra physical facts')
    return matches[0]


def _response(payload: dict, kind: str, manifest: dict) -> None:
    obj(payload, ('model', 'reasoningEffort', 'api', 'status', 'sourceResponseHash', 'requestHash', 'promptHash',
                  'householdId', 'opportunityId', 'contextHash', 'outputText', 'toolCalls'))
    if (payload['model'], payload['reasoningEffort'], payload['api'], payload['status']) != (MODEL, EFFORT, 'responses', 'completed'):
        raise ValueError('Unsupported compact response identity')
    for key in ('sourceResponseHash', 'requestHash', 'promptHash'):
        digest(payload[key])
    text(payload['householdId'], 240)
    text(payload['outputText'], empty=True)
    prompts = [p for p in manifest['prompts'] if p['householdId'] == payload['householdId'] and p['opportunityId'] == payload['opportunityId']]
    if len(prompts) != 1 or prompts[0]['sha256'] != payload['promptHash'] or prompts[0]['contextHash'] != payload['contextHash']:
        raise ValueError('Response lacks the exact frozen prompt and context')
    if type(payload['toolCalls']) is not list or len(payload['toolCalls']) > 1:
        raise ValueError('One legal action per actor opportunity is supported')
    for tool in payload['toolCalls']:
        obj(tool, ('name', 'arguments', 'callId'))
        text(tool['name'], 120)
        text(tool['arguments'])
        text(tool['callId'], 240)
        if tool['name'] not in ('create_post', 'do_nothing'):
            raise ValueError('Unsupported model-selected action')
    if kind == 'persona-response' and (payload['opportunityId'] is not None or payload['toolCalls']):
        raise ValueError('Persona generation cannot be relabeled as an action')


def validate_artifact(value: dict) -> dict:
    obj(value, ('kind', 'version', 'manifestHash', *HASH_KEYS, 'personas', 'contexts', 'actions', 'sourceCommit', 'adapterVersion', 'sourceReceipts', 'preparationManifest', 'evidence'))
    if value['kind'] != 'dallas-prepared-behavior' or value['version'] != 2 or value['sourceCommit'] != SOURCE_COMMIT or value['adapterVersion'] != ADAPTER_VERSION:
        raise ValueError('Unsupported behavior artifact')
    manifest = validate_manifest(value['preparationManifest'])
    if value['manifestHash'] != hash_value(value['preparationManifest']) or value['contexts'] != manifest['contexts'] or any(value[key] != manifest[key] for key in HASH_KEYS):
        raise ValueError('Behavior asset, manifest or context hash mismatch')
    evidence, source_receipts = {}, {}
    if type(value['evidence']) is not list or len(value['evidence']) > 168:
        raise ValueError('Behavior evidence limit exceeded')
    if type(value['sourceReceipts']) is not list or len(value['sourceReceipts']) > 256:
        raise ValueError('Source receipt limit exceeded')
    for receipt in value['sourceReceipts']:
        required = ('id', 'url', 'retrievedAt', 'sha256', 'bytes', 'vintage', 'license', 'status')
        if type(receipt) is not dict or set(receipt) - set((*required, 'notes')) or any(k not in receipt for k in required):
            raise ValueError('Unsupported source receipt')
        for key in ('id', 'url', 'retrievedAt', 'vintage', 'license'):
            text(receipt[key], 2000)
        digest(receipt['sha256'])
        integer(receipt['bytes'], 1, 2_000_000)
        if receipt['status'] != 'retained' or receipt['id'] in source_receipts or not receipt['url'].startswith(('https://api.openai.com/', 'urn:dallas-v2:')):
            raise ValueError('Behavior source receipt is not retained or safe')
        if 'notes' in receipt:
            if type(receipt['notes']) is not list or len(receipt['notes']) > 10:
                raise ValueError('Invalid source notes')
            for note in receipt['notes']:
                text(note, 2000)
        source_receipts[receipt['id']] = receipt
    for item in value['evidence']:
        obj(item, ('id', 'kind', 'payload', 'sha256'))
        text(item['id'], 480)
        if item['id'] in evidence or item['sha256'] != hash_value(item['payload']):
            raise ValueError('Duplicate or tampered compact evidence')
        if item['kind'] in ('persona-response', 'action-response'):
            _response(item['payload'], item['kind'], manifest)
            payload = item['payload']
            receipt = source_receipts.get('response:' + payload['sourceResponseHash'])
            if not receipt or receipt['sha256'] != payload['sourceResponseHash']:
                raise ValueError('Missing retained raw response source')
        elif item['kind'] == 'upstream-action':
            payload = obj(item['payload'], ('householdId', 'opportunityId', 'agentId', 'actionType', 'content', 'sourceActionId', 'sourceResponseHash', 'responseEvidenceId', 'autonomous', 'successful', 'sourceTraceHash'))
            for key in ('householdId', 'opportunityId', 'sourceActionId', 'responseEvidenceId'):
                text(payload[key], 480)
            integer(payload['agentId'], 0, 5)
            text(payload['content'], empty=True)
            digest(payload['sourceResponseHash'])
            digest(payload['sourceTraceHash'])
            receipt = source_receipts.get('trace:' + payload['sourceActionId'])
            if not receipt or receipt['sha256'] != payload['sourceTraceHash'] or payload['autonomous'] is not True or payload['successful'] is not True:
                raise ValueError('Action lacks a retained successful autonomous platform trace')
        else:
            raise ValueError('Unsupported compact evidence kind')
        evidence[item['id']] = item
    personas = set()
    if type(value['personas']) is not list or len(value['personas']) > 24:
        raise ValueError('Persona limit exceeded')
    for persona in value['personas']:
        obj(persona, ('householdId', 'persona', 'age', 'profession', 'sourceResponseHash', 'model', 'reasoningEffort', 'origin'))
        if persona['householdId'] in personas or (persona['model'], persona['reasoningEffort'], persona['origin']) != (MODEL, EFFORT, 'llm-direct'):
            raise ValueError('Duplicate or unsupported direct persona')
        text(persona['persona'])
        text(persona['profession'], 240)
        integer(persona['age'], 0, 120)
        matches = [e for e in evidence.values() if e['kind'] == 'persona-response' and e['payload']['householdId'] == persona['householdId'] and e['payload']['sourceResponseHash'] == persona['sourceResponseHash']]
        if len(matches) != 1:
            raise ValueError('Persona lacks exact model response')
        raw = json.loads(matches[0]['payload']['outputText'])
        if not isinstance(raw, dict) or any(raw.get(key) != persona[key] for key in ('persona', 'age', 'profession')):
            raise ValueError('Exported persona is not exactly model-authored')
        personas.add(persona['householdId'])
    seen, sources = set(), set()
    if type(value['actions']) is not list or len(value['actions']) > 48:
        raise ValueError('Prepared action limit exceeded')
    for action in value['actions']:
        obj(action, ('id', 'householdId', 'opportunityId', 'atMs', 'contextHash', 'action', 'text', 'sourceResponseHash', 'sourceActionId', 'origin', 'model', 'reasoningEffort'))
        text(action['id'], 480)
        text(action['text'], empty=action['action'] == 'wait')
        if action['householdId'] not in personas or action['opportunityId'] in seen or action['sourceActionId'] in sources or (action['model'], action['reasoningEffort'], action['origin']) != (MODEL, EFFORT, 'llm-direct'):
            raise ValueError('Action lacks a unique admitted actor opportunity')
        contexts = [c for c in value['contexts'] if c['opportunityId'] == action['opportunityId'] and c['householdId'] == action['householdId']]
        if len(contexts) != 1 or action['contextHash'] != hash_value(contexts[0]) or action['atMs'] != contexts[0]['atMs']:
            raise ValueError('Prepared action context mismatch')
        traces = [e['payload'] for e in evidence.values() if e['kind'] == 'upstream-action' and e['payload']['sourceActionId'] == action['sourceActionId']]
        if len(traces) != 1:
            raise ValueError('Missing exact source action')
        trace = traces[0]
        response_item = evidence.get(trace['responseEvidenceId'])
        if not response_item or response_item['kind'] != 'action-response':
            raise ValueError('Trace lacks a model action response')
        response = response_item['payload']
        if any(trace[k] != action[k] or response[k] != action[k] for k in ('householdId', 'opportunityId', 'sourceResponseHash')) or trace['content'] != action['text'] or response['contextHash'] != action['contextHash']:
            raise ValueError('Model, action and source trace do not match')
        cohort_id = next(a['cohortId'] for a in manifest['actors'] if a['householdId'] == action['householdId'])
        actor_ids = [a['householdId'] for a in manifest['actors'] if a['cohortId'] == cohort_id]
        if trace['agentId'] >= len(actor_ids) or actor_ids[trace['agentId']] != action['householdId'] or len(response['toolCalls']) != 1:
            raise ValueError('Wrong actor identity in platform trace')
        tool = response['toolCalls'][0]
        args = json.loads(tool['arguments'])
        if action['action'] == 'report':
            if trace['actionType'] != 'create_post' or tool['name'] != 'create_post' or args != {'content': action['text']}:
                raise ValueError('Reported action was not actually selected and executed')
            parse_report(action['text'], contexts[0])
        elif action['action'] != 'wait' or action['text'] != '' or trace['actionType'] != 'do_nothing' or tool['name'] != 'do_nothing' or args != {}:
            raise ValueError('Wait action was not actually selected and executed')
        seen.add(action['opportunityId'])
        sources.add(action['sourceActionId'])
    # Validate UTF-8 canonicalizability and cap before portable export.
    if len(canonical(value).encode('utf-8')) > 4_000_000:
        raise ValueError('Behavior artifact exceeds portable byte limit')
    return deepcopy(value)


def request_contains_frozen_prompt(request: dict, prompt: str) -> bool:
    """Recognize bounded text message forms, never reasoning or tool outputs."""
    for item in request.get('input', []):
        if not isinstance(item, dict) or item.get('role') not in ('system', 'developer', 'user', 'assistant'):
            continue
        content = item.get('content')
        if isinstance(content, str) and prompt in content:
            return True
        if isinstance(content, list) and any(isinstance(part, dict) and set(part) == {'type', 'text'}
                                            and part['type'] in ('input_text', 'output_text') and isinstance(part['text'], str)
                                            and prompt in part['text'] for part in content):
            return True
    return False


def verify_private_sources(artifact: dict, work: Path) -> dict:
    """Admission at preparation time checks hashes against exact private bytes.

    Callers cannot use a public compact receipt as proof that a provider call
    happened. This function requires the actual raw files and actual trace rows.
    """
    validated = validate_artifact(artifact)
    responses = {hashlib.sha256(path.read_bytes()).hexdigest(): path for path in work.glob('responses-*.json')}
    usage = json.loads((work / 'usage.json').read_text(encoding='utf-8'))
    for item in validated['evidence']:
        if item['kind'] not in ('persona-response', 'action-response'):
            continue
        compact = item['payload']
        path = responses.get(compact['sourceResponseHash'])
        if path is None:
            raise ValueError('Retained raw provider response is missing')
        raw = json.loads(path.read_text(encoding='utf-8'))
        if raw.get('model') != MODEL or raw.get('status') != 'completed' or raw.get('error'):
            raise ValueError('Provider source is incomplete, failed or substituted')
        request = json.loads((work / path.name.replace('responses-', 'request-')).read_text(encoding='utf-8'))
        prompts = [p for p in validate_manifest(validated['preparationManifest'])['prompts'] if p['householdId'] == compact['householdId'] and p['opportunityId'] == compact['opportunityId']]
        request_index = int(path.stem.split('-')[-1])
        ledger_row = usage[request_index] if request_index < len(usage) else {}
        if (hash_value(request) != compact['requestHash'] or request.get('model') != MODEL or request.get('reasoning') != {'effort': 'low'}
                or ledger_row.get('status') != 'success' or ledger_row.get('requestHash') != compact['requestHash'] or ledger_row.get('logicalOpportunityId') != prompts[0]['id']
                or not request_contains_frozen_prompt(request, prompts[0]['text'])):
            raise ValueError('Actual provider request differs from the exact frozen prompt/model')
        outputs, tools = [], []
        for output in raw.get('output', []):
            if output.get('status') == 'incomplete':
                raise ValueError('Incomplete response item cannot become portable evidence')
            if output.get('type') == 'message':
                for part in output.get('content', []):
                    if part.get('type') != 'output_text':
                        raise ValueError('Refused or unsupported source response')
                    outputs.append(part['text'])
            elif output.get('type') == 'function_call':
                tools.append({'name': output['name'], 'arguments': output['arguments'], 'callId': output['call_id']})
        if ''.join(outputs) != compact['outputText'] or tools != compact['toolCalls']:
            raise ValueError('Compact evidence differs from actual source output')
    trace_rows = []
    for path in work.glob('episode-*/trace.json'):
        trace_rows.extend(json.loads(path.read_text(encoding='utf-8')))
    by_hash = {hash_value(row): row for row in trace_rows}
    for item in validated['evidence']:
        if item['kind'] != 'upstream-action':
            continue
        payload = item['payload']
        row = by_hash.get(payload['sourceTraceHash'])
        if not row or row.get('user_id') != payload['agentId'] or row.get('action') != payload['actionType']:
            raise ValueError('Retained original OASIS row is missing or mismatched')
        info = json.loads(row['info']) if isinstance(row.get('info'), str) else row.get('info', {})
        if info.get('content', '') != payload['content']:
            raise ValueError('Compact action differs from actual executed OASIS content')
    return validated


def merge_artifacts(values: list[dict]) -> dict:
    if not 1 <= len(values) <= 4:
        raise ValueError('At most four admitted cohorts can be merged')
    admitted = [validate_artifact(value) for value in values]
    if any(value['preparationManifest']['kind'] != 'dallas-behavior-preparation' for value in admitted):
        raise ValueError('Merge original cohort artifacts; nested aggregation is unsupported')
    result = deepcopy(admitted[0])
    manifest = dict(kind='dallas-behavior-preparation-set', version=2, manifests=[value['preparationManifest'] for value in admitted])
    validate_manifest(manifest)
    result['preparationManifest'], result['manifestHash'] = manifest, hash_value(manifest)
    for key in ('personas', 'contexts', 'actions', 'evidence', 'sourceReceipts'):
        result[key] = [item for value in admitted for item in value[key]]
    return validate_artifact(result)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, nargs='+')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--private-work', type=Path)
    args = parser.parse_args()
    inputs = [json.loads(path.read_text(encoding='utf-8')) for path in args.input]
    artifact = inputs[0] if len(inputs) == 1 else merge_artifacts(inputs)
    artifact = verify_private_sources(artifact, args.private_work) if args.private_work else validate_artifact(artifact)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(artifact, output, ensure_ascii=False, indent=2)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
