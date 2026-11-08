"""Validate real OASIS traces without inventing speech or physical facts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = "7657031ac01184afe2cb220f5ee3545573b5e843"
CONTRACT_HASHES = {
    'storm-v1': '9ebcbac1cb419a16db8df5f382438cf5cedc6937a1ba228a6f9f6174a618ef9c',
    'storm-dallas-v1': '9aff15d10e1b0c68c940f52618d0b814939c34df84ea32e1e7305b5b79f8b018',
}
PREPARATION_INPUTS = {
    ('storm-v1', 'gpt-4.1-mini'): ('preparation-manifest-v1.json', '25c44ff50fc81cb8a38b991c56bb71f8736961d3db3337b37c8a7f1cf7565321'),
    ('storm-v1', 'gpt-6.1-terra'): ('preparation-manifest-terra-low-v1.json', '4b5c2eb1432d0146f1e5962df091f993a0a633b25778c605eabdd61c4970e00a'),
    ('storm-dallas-v1', 'gpt-6.1-terra'): ('preparation-manifest-dallas-terra-low-v1.json', 'f1f98271f7c423fa1dc0a851c67837c228c81ddd05bfd3c992502110e1c3d20b'),
}


def load_contract(path: Path | None = None) -> dict:
    return json.loads((path or ROOT / "fixtures/actor-context-v1.json").read_text(encoding="utf-8"))


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def instruction(actor: dict, template: str = 'storm-v1') -> str:
    payload = {"kind":"help_request", "householdId":actor["householdId"], "needId":actor["needId"], "factRefs":actor["factRefs"]}
    opening = ('Fictional Dallas storm exercise. Household placements, incidents and personas are synthetic. '
               'Node identifiers are opaque map references. Do not infer real resident data, private future conditions, fleet, road configuration or outage configuration. '
               if template == 'storm-dallas-v1' else 'Fictional storm exercise. ')
    return (opening + "Your household facts are fixed: " + json.dumps(actor, sort_keys=True) + ". "
            "You may choose to request help or do nothing. If you choose to ask for help, create a post containing this exact JSON object "
            "(you may add your own surrounding speech): " + json.dumps(payload, separators=(",", ":")) + ". "
            "These references authorize including the fixed facts in an exercise request. Do not invent new physical facts or another household's request.")


def verified_model_persona(responses: list[str], exported_persona: str) -> bool:
    """Only an exact nonempty raw model field proves model authorship.

    Upstream fills omitted fields with authored summaries without calling its
    rule-fallback method, so API success alone is insufficient.
    """
    if not isinstance(exported_persona, str) or not exported_persona.strip():
        return False
    for content in responses:
        try:
            payload = json.loads(content)
        except (TypeError, json.JSONDecodeError):
            continue
        persona = payload.get('persona') if isinstance(payload, dict) else None
        if isinstance(persona, str) and persona.strip() and persona == exported_persona:
            return True
    return False


def preparation_manifest(contract: dict, model: str) -> dict:
    """All controlled inputs actually supplied to pinned generation and social APIs."""
    if not isinstance(contract, dict) or canonical_hash(contract) not in CONTRACT_HASHES.values():
        raise ValueError('Actor input is incompatible with the exact frozen preparation contracts.')
    identity = (contract['template'], model)
    if not isinstance(model, str) or identity not in PREPARATION_INPUTS:
        raise ValueError('Unsupported preparation model and template; no substitution is permitted.')
    dallas = contract['template'] == 'storm-dallas-v1'
    resident = 'Dallas demo resident' if dallas else 'Riverdale resident'
    summary = ('Fictional Dallas storm exercise resident. Household placements, incidents and personas are synthetic. Only supplied household facts are authoritative.'
               if dallas else 'Fictional resident of a town experiencing storm-related power outage. Only supplied household facts are authoritative.')
    manifest = {
        'version': 1, 'sourceCommit': SOURCE_COMMIT, 'contract': contract,
        'locale': 'en',
        'entities': [dict(uuid=a['householdId'], name=f"{resident} {a['householdId']}",
                          labels=['Entity', 'Person'],
                          summary=summary,
                          attributes=a, instruction=instruction(a, contract['template'])) for a in contract['actorContexts']],
        'profiles': {'model': model, 'baseUrl': 'https://api.openai.com/v1', 'useLlm': True, 'zep': False,
                     'maxTokens': 1600, 'sdkRetries': 0, 'timeoutSeconds': 30,
                     'upstreamAttemptTemperatures': [0.7, 0.6, 0.5]},
        'social': {'model': model, 'temperature': 0.4, 'maxTokens': 1600, 'sdkRetries': 0,
                   'timeoutSeconds': 30, 'rounds': 1, 'waitForCommands': False,
                   'actions': ['CREATE_POST', 'DO_NOTHING'],
                   'time_config': {'total_simulation_hours': 1, 'minutes_per_round': 60,
                                   'agents_per_hour_min': 3, 'agents_per_hour_max': 3,
                                   'peak_activity_multiplier': 1, 'off_peak_activity_multiplier': 1},
                   'agent_configs': [{'agent_id': i, 'active_hours': [0], 'activity_level': 1} for i in range(3)],
                   'event_config': {'initial_posts': []}},
    }
    if model == 'gpt-6.1-terra':
        for settings in (manifest['profiles'], manifest['social']):
            settings.pop('maxTokens')
            settings.update(api='responses', reasoningEffort='low', maxOutputTokens=4096,
                            serviceTier='default', adapterVersion='terra-responses-v1',
                            temperatureForwarded=False)
        manifest['social']['contextWindowTokens'] = 32768
    fixture_name, expected_hash = PREPARATION_INPUTS[identity]
    frozen = json.loads((ROOT / 'fixtures' / fixture_name).read_text(encoding='utf-8'))
    if canonical_hash(manifest) != expected_hash or canonical_hash(frozen) != expected_hash:
        raise ValueError('Complete preparation inputs differ from the exact frozen manifest.')
    return manifest


def normalize_action(action: dict, actors: list[dict]) -> dict | None:
    if not action.get("autonomous") or not action.get("successful") or action.get("actionType", "").lower() not in ("create_post", "create_comment"):
        return None
    actor_index = action.get("agentId")
    if type(actor_index) is not int or not 0 <= actor_index < len(actors):
        return None
    actor = actors[actor_index]
    content = action.get("content", "")
    if not isinstance(content, str) or len(content) > 12000:
        return None
    decoder = json.JSONDecoder()
    payload = None
    for index, char in enumerate(content):
        if char == "{":
            try:
                candidate, _ = decoder.raw_decode(content[index:])
                if isinstance(candidate, dict) and candidate.get("kind") == "help_request":
                    if payload is not None:
                        return None
                    payload = candidate
            except json.JSONDecodeError:
                continue
    if payload is None or set(payload) != {"kind", "householdId", "needId", "factRefs"}:
        return None
    if payload["householdId"] != actor["householdId"] or payload["needId"] != actor["needId"]:
        return None
    if payload["factRefs"] != actor["factRefs"]:
        return None
    return {"sourceActionId":str(action["id"]), "householdId":actor["householdId"], "needId":actor["needId"],
            "factRefs":actor["factRefs"], "attemptMinute":5, "sourceText":content}


def build_artifact(contract: dict, profile_evidence: dict, social: dict) -> dict:
    actors = contract["actorContexts"]
    candidates = []
    seen = set()
    for action in social.get("actions", []):
        candidate = normalize_action(action, actors)
        if candidate and candidate["householdId"] not in seen:
            candidates.append(candidate)
            seen.add(candidate["householdId"])
    profiles = profile_evidence.get("profiles", [])
    verified = sum(p["outcome"] == "llm" for p in profiles)
    outcome = "target" if verified == 3 and candidates and social.get("activeAgents") == 3 else "profiles-only" if verified else "blocked"
    if outcome != 'target':
        # Partial preparation cannot export a request set that the runtime's
        # complete-profile contract rejects. Raw platform traces stay private.
        candidates = []
    model = profile_evidence.get('model', 'unavailable')
    transport = {'api':'responses', 'reasoningEffort':'low'} if model == 'gpt-6.1-terra' else {}
    return {"version":1, "template":contract["template"], "sourceCommit":SOURCE_COMMIT, "model":model, **transport,
            "generationOutcome":outcome, "preparationVersion":contract["preparationVersion"], "timingMapVersion":contract["timingMapVersion"],
            "inputHash":canonical_hash(preparation_manifest(contract, model)), "actorContextDigest":canonical_hash(actors), "actorContexts":actors,
            "profiles":profiles, "candidates":candidates,
            "episode":{"rounds":social.get("rounds", 0), "activeAgents":social.get("activeAgents", 0),
                       "autonomousActions":len(social.get("actions", [])), "seededActions":0},
            "provenance":[{"label":"Preparation", "detail":"Actual pinned MiroFish OasisProfileGenerator; sequential OpenAI calls; rule fallback recorded explicitly."},
                          {"label":"Social episode", "detail":social.get("detail", "No verified social round.")},
                          {"label":"Timing assumption", "detail":"First autonomous social round maps to exercise minute 5; rules attempt minute 10 otherwise."},
                          {"label":"Usage", "detail":json.dumps(profile_evidence.get("usage", {}), sort_keys=True)}]}
