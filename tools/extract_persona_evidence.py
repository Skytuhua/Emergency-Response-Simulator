"""Extract approved model fields without exporting provider envelopes or reasoning.

This is an offline custody check. It performs no provider calls and reads only
the six named Responses files, profiles-evidence.json and trace.json in the
retained preparation directory. The public artifact and manifest remain inputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'gpt-6.1-terra'
INPUT_HASH = 'f1f98271f7c423fa1dc0a851c67837c228c81ddd05bfd3c992502110e1c3d20b'
ARTIFACT_SHA256 = '793ac3a0ece9cd64e6eb4aaf1a918523ab8598f640eeab7363f7feeab7a0a2ed'
HOUSEHOLDS = ('H02', 'H09', 'H19')


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value: object) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))


def _response(raw_bytes: bytes) -> dict:
    response = json.loads(raw_bytes)
    if (response.get('model') != MODEL or response.get('reasoning', {}).get('effort') != 'low'
            or not isinstance(response.get('output'), list)):
        raise ValueError('The retained response must be the actual Terra-low output.')
    return response


def verified_profile_fields(raw_bytes: bytes, persona: str) -> dict:
    """Return an allowlist from the exact output JSON, never upstream defaults."""
    if not isinstance(persona, str) or not persona.strip():
        raise ValueError('A nonempty artifact persona is required.')
    matches = []
    for item in _response(raw_bytes)['output']:
        if item.get('type') != 'message':
            continue
        for part in item.get('content', []):
            if part.get('type') != 'output_text':
                continue
            try:
                payload = json.loads(part.get('text', ''))
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict) and payload.get('persona') == persona:
                matches.append(payload)
    if len(matches) != 1:
        raise ValueError('Artifact persona does not identify one exact model JSON output.')
    payload = matches[0]
    if type(payload.get('age')) is not int or not 0 < payload['age'] < 130:
        raise ValueError('No verified model age field.')
    for key in ('mbti', 'profession', 'bio'):
        if not isinstance(payload.get(key), str) or not payload[key].strip() or len(payload[key]) > 2000:
            raise ValueError(f'No verified model {key} field.')
    return {key: payload[key] for key in ('age', 'mbti', 'profession', 'bio')}


def verified_post(raw_bytes: bytes, row: dict, candidate: dict, actor_index: int) -> bool:
    """Require the accepted artifact, actual platform row and raw call to agree."""
    if (candidate.get('sourceActionId') != f"reddit-trace-{row.get('source_rowid')}"
            or row.get('user_id') != actor_index or row.get('action') != 'create_post'):
        return False
    try:
        if json.loads(row.get('info', ''))['content'] != candidate['sourceText']:
            return False
        calls = [json.loads(item['arguments']).get('content')
                 for item in _response(raw_bytes)['output']
                 if item.get('type') == 'function_call' and item.get('name') == 'create_post']
        return calls == [candidate['sourceText']]
    except (KeyError, TypeError, ValueError):
        return False


def build_approved_evidence(root: Path, work: Path) -> dict:
    artifact_bytes = (root / 'public/data/mirofish-dallas-v1.json').read_bytes()
    if sha256(artifact_bytes) != ARTIFACT_SHA256:
        raise ValueError('Only the exact approved Dallas artifact may be enriched.')
    artifact = json.loads(artifact_bytes)
    manifest = json.loads((root / 'fixtures/preparation-manifest-dallas-terra-low-v1.json').read_bytes())
    if canonical_hash(manifest) != INPUT_HASH or artifact['inputHash'] != INPUT_HASH:
        raise ValueError('Preparation manifest identity changed.')
    if (artifact['model'] != MODEL or artifact['reasoningEffort'] != 'low'
            or artifact['template'] != 'storm-dallas-v1' or artifact['generationOutcome'] != 'target'):
        raise ValueError('Only the approved target preparation is supported.')

    profiles_bytes = (work / 'profiles-evidence.json').read_bytes()
    trace_bytes = (work / 'trace.json').read_bytes()
    profiles = json.loads(profiles_bytes)
    trace = json.loads(trace_bytes)
    responses = [(work / f'responses-{index}.json').read_bytes() for index in range(6)]
    if profiles.get('model') != MODEL or profiles.get('profiles') != artifact['profiles']:
        raise ValueError('Retained profile evidence differs from the approved artifact.')
    if len(artifact['profiles']) != 3 or len(artifact['candidates']) != 3:
        raise ValueError('The exact three generated representatives are required.')

    records = []
    for index, household_id in enumerate(HOUSEHOLDS):
        profile = next(p for p in artifact['profiles'] if p['householdId'] == household_id)
        if profile['outcome'] != 'llm':
            raise ValueError('A rule profile cannot receive model attributes.')
        fields = verified_profile_fields(responses[index], profile['persona'])
        candidate = next(c for c in artifact['candidates'] if c['householdId'] == household_id)
        rows = [row for row in trace if candidate['sourceActionId'] == f"reddit-trace-{row.get('source_rowid')}"]
        matched = [raw for raw in responses[3:] if len(rows) == 1 and verified_post(raw, rows[0], candidate, index)]
        if len(matched) != 1:
            raise ValueError('Accepted post lacks one matching raw call and platform row.')
        records.append({
            'householdId': household_id, 'fields': fields,
            'personaExcerpt': profile['persona'][:360],
            'personaSha256': sha256(profile['persona'].encode('utf-8')),
            'sourceActionId': candidate['sourceActionId'],
            'requestSha256': sha256(candidate['sourceText'].encode('utf-8')),
            'profileResponseSha256': sha256(responses[index]),
            'postResponseSha256': sha256(matched[0]),
        })
    return {
        'version': 1,
        'artifact': {key: artifact[key] for key in ('template', 'model', 'api', 'reasoningEffort',
                     'inputHash', 'sourceCommit', 'actorContextDigest', 'preparationVersion')},
        'manifestHash': INPUT_HASH,
        'artifactSha256': ARTIFACT_SHA256,
        'profilesEvidenceSha256': sha256(profiles_bytes),
        'traceSha256': sha256(trace_bytes),
        'records': records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'src/content/persona-evidence-dallas-v1.json')
    parser.add_argument('--reference-output', type=Path, default=ROOT / 'fixtures/mirofish-dallas-approved-v1.json')
    args = parser.parse_args()
    evidence = build_approved_evidence(ROOT, ROOT / '.private/mirofish-hoyvt38t')
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    args.reference_output.write_bytes((ROOT / 'public/data/mirofish-dallas-v1.json').read_bytes())
    print('Verified and extracted 3 profiles and 3 accepted posts; no provider calls.')


if __name__ == '__main__':
    main()
