import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import extract_persona_evidence as extract


def raw_profile(persona='Exact model persona.'):
    payload = {'persona': persona, 'age': 37, 'mbti': 'ISTJ', 'profession': 'Coordinator', 'bio': 'Fictional resident.'}
    return json.dumps({'model': 'gpt-6.1-terra', 'reasoning': {'effort': 'low'}, 'output': [
        {'type': 'reasoning', 'summary': [{'text': 'MUST STAY PRIVATE'}]},
        {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(payload)}]},
    ]}).encode()


class PersonaEvidenceTests(unittest.TestCase):
    def test_reads_only_actual_returned_fields_and_keeps_reasoning_private(self):
        fields = extract.verified_profile_fields(raw_profile(), 'Exact model persona.')
        self.assertEqual(fields, {'age': 37, 'mbti': 'ISTJ', 'profession': 'Coordinator', 'bio': 'Fictional resident.'})
        self.assertNotIn('MUST STAY PRIVATE', json.dumps(fields))
        self.assertNotIn('name', fields)

    def test_unverified_persona_or_missing_model_field_fails_closed(self):
        for persona in ['invented', '']:
            with self.subTest(persona=persona), self.assertRaises(ValueError):
                extract.verified_profile_fields(raw_profile(), persona)
        raw = json.loads(raw_profile())
        content = json.loads(raw['output'][1]['content'][0]['text'])
        del content['profession']
        raw['output'][1]['content'][0]['text'] = json.dumps(content)
        with self.assertRaises(ValueError):
            extract.verified_profile_fields(json.dumps(raw).encode(), 'Exact model persona.')

    def test_model_and_effort_are_not_relabelled(self):
        for key, value in [('model', 'gpt-4.1-mini'), ('reasoning', {'effort': 'high'})]:
            raw = json.loads(raw_profile()); raw[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                extract.verified_profile_fields(json.dumps(raw).encode(), 'Exact model persona.')

    def test_approved_derived_file_is_reproducible_from_only_named_private_sources(self):
        work = ROOT / '.private/mirofish-hoyvt38t'
        if not (work / 'responses-0.json').exists():
            self.skipTest('Retained local preparation not available in this checkout')
        actual = extract.build_approved_evidence(ROOT, work)
        published = json.loads((ROOT / 'src/content/persona-evidence-dallas-v1.json').read_text(encoding='utf-8'))
        self.assertEqual(actual, published)
        self.assertEqual(len(actual['records']), 3)
        self.assertEqual(actual['artifact']['inputHash'], actual['manifestHash'])
        self.assertEqual({record['sourceActionId'] for record in actual['records']}, {'reddit-trace-4', 'reddit-trace-5', 'reddit-trace-6'})
        public_text = json.dumps(actual)
        for forbidden in ['output_text', 'function_call', 'reasoning_tokens', 'instructions', 'usage', 'private/']:
            self.assertNotIn(forbidden, public_text)

    def test_trace_and_raw_function_call_must_both_match_the_accepted_post(self):
        candidate = {'sourceActionId': 'reddit-trace-4', 'householdId': 'H09', 'sourceText': 'Exact stored post'}
        row = {'source_rowid': 4, 'user_id': 1, 'action': 'create_post', 'info': json.dumps({'content': 'Exact stored post'})}
        response = json.dumps({'model': 'gpt-6.1-terra', 'reasoning': {'effort': 'low'}, 'output': [
            {'type': 'function_call', 'name': 'create_post', 'arguments': json.dumps({'content': 'Exact stored post'})},
        ]}).encode()
        self.assertTrue(extract.verified_post(response, row, candidate, 1))
        changed = copy.deepcopy(row); changed['user_id'] = 0
        self.assertFalse(extract.verified_post(response, changed, candidate, 1))
        changed = copy.deepcopy(candidate); changed['sourceText'] = 'unverified speech'
        self.assertFalse(extract.verified_post(response, row, changed, 1))


if __name__ == '__main__':
    unittest.main()
