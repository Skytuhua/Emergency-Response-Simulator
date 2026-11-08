import copy
import json
import sys
import unittest
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from normalize_mirofish import normalize_action, canonical_hash, load_contract, verified_model_persona, preparation_manifest
from prepare_mirofish import verify_resume_manifest


class NormalizationTests(unittest.TestCase):
    def test_resume_cannot_relabel_existing_profiles_with_changed_inputs(self):
        expected = preparation_manifest(load_contract(), 'gpt-4.1-mini')
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            with self.assertRaises(ValueError):
                verify_resume_manifest(work, expected)
            manifest = work / 'preparation-manifest.json'
            manifest.write_text(json.dumps(expected), encoding='utf-8')
            evidence = {'model': expected['profiles']['model'], 'profiles': [dict(householdId=entity['uuid'], instruction=entity['instruction']) for entity in expected['entities']]}
            evidence_file = work / 'profiles-evidence.json'
            evidence_file.write_text(json.dumps(evidence), encoding='utf-8')
            verify_resume_manifest(work, expected)
            changed = copy.deepcopy(expected)
            changed['entities'][0]['instruction'] += ' changed'
            before = manifest.read_bytes()
            with self.assertRaises(ValueError):
                verify_resume_manifest(work, changed)
            self.assertEqual(before, manifest.read_bytes())
            evidence['model'] = 'changed-model'
            evidence_file.write_text(json.dumps(evidence), encoding='utf-8')
            with self.assertRaises(ValueError):
                verify_resume_manifest(work, expected)
            evidence['model'] = expected['profiles']['model']
            evidence['profiles'][0]['instruction'] += ' changed'
            evidence_file.write_text(json.dumps(evidence), encoding='utf-8')
            with self.assertRaises(ValueError):
                verify_resume_manifest(work, expected)
    def test_missing_model_persona_cannot_be_verified_via_upstream_default(self):
        for content in ['{}', '{"persona":""}', '{"bio":"A model bio"}', '{"persona":null}', '{"persona":123}']:
            self.assertFalse(verified_model_persona([content], 'AUTHORED SUMMARY'))
        self.assertFalse(verified_model_persona(['{"persona":"A different persona"}'], 'AUTHORED SUMMARY'))
        self.assertTrue(verified_model_persona(['{"persona":"A generated resident"}'], 'A generated resident'))

    def test_identity_covers_actual_entity_instruction_and_episode_inputs(self):
        manifest = preparation_manifest(load_contract(), 'gpt-4.1-mini')
        fixture = Path(__file__).resolve().parents[2] / 'fixtures/preparation-manifest-v1.json'
        self.assertEqual(manifest, json.loads(fixture.read_text(encoding='utf-8')))
        changed = copy.deepcopy(manifest)
        changed['entities'][0]['instruction'] += ' changed'
        self.assertNotEqual(canonical_hash(manifest), canonical_hash(changed))
        changed = copy.deepcopy(manifest)
        changed['social']['agent_configs'][0]['active_hours'] = [1]
        self.assertNotEqual(canonical_hash(manifest), canonical_hash(changed))

    def setUp(self):
        self.contract = load_contract()
        self.actor = self.contract["actorContexts"][0]
        self.action = {"id":"trace-1","agentId":0,"actionType":"create_post","autonomous":True,"successful":True,
                       "content":json.dumps({"kind":"help_request","householdId":"H02","needId":"N-H02","factRefs":self.actor["factRefs"]})}

    def test_successful_autonomous_request_preserves_source_and_references(self):
        candidate = normalize_action(self.action, self.contract["actorContexts"])
        self.assertEqual(candidate["attemptMinute"], 5)
        self.assertEqual(candidate["sourceText"], self.action["content"])
        self.assertEqual(candidate["factRefs"], self.actor["factRefs"])

    def test_manual_seed_and_failed_action_are_never_candidates(self):
        for field in ["autonomous", "successful"]:
            action = dict(self.action, **{field:False})
            self.assertIsNone(normalize_action(action, self.contract["actorContexts"]))

    def test_actor_spoof_and_partial_fact_refs_are_rejected(self):
        for updates in [{"householdId":"H09"}, {"needId":"other"}, {"factRefs":["H02.need"]}]:
            payload = json.loads(self.action["content"])
            payload.update(updates)
            self.assertIsNone(normalize_action(dict(self.action, content=json.dumps(payload)), self.contract["actorContexts"]))

    def test_unstructured_speech_is_social_evidence_only(self):
        self.assertIsNone(normalize_action(dict(self.action, content="We need some help"), self.contract["actorContexts"]))

    def test_canonical_hash_is_order_invariant_and_sensitive_to_facts(self):
        self.assertEqual(canonical_hash({"b":2,"a":1}), canonical_hash({"a":1,"b":2}))
        changed = copy.deepcopy(self.actor)
        changed["size"] = 4
        self.assertNotEqual(canonical_hash(changed), canonical_hash(self.actor))


if __name__ == "__main__":
    unittest.main()
