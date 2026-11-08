import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import normalize_mirofish as normalize
import prepare_mirofish as prepare

ROOT = Path(__file__).resolve().parents[2]
NODES = {'H02': 'osm-n81982111', 'H09': 'osm-n82064216', 'H19': 'osm-n81953006'}
MAP_HASH = 'ba2017a31c639b4f26060bdd41ca575a536c3ae7080a8fa8a8ec9340c01e8ed6'


def dallas_contract():
    contract = json.loads((ROOT / 'fixtures/actor-context-v1.json').read_text(encoding='utf-8'))
    contract.update(template='storm-dallas-v1', preparationVersion='catastrophe-preparation-dallas-v1', mapDatasetHash=MAP_HASH)
    for actor in contract['actorContexts']:
        actor['nodeId'] = NODES[actor['householdId']]
    return contract


class DallasPreparationTests(unittest.TestCase):
    def test_artifact_uses_the_separately_versioned_dallas_identity(self):
        contract = dallas_contract()
        artifact = normalize.build_artifact(contract, {'model': 'gpt-6.1-terra', 'profiles': []}, {})
        self.assertEqual(artifact['template'], 'storm-dallas-v1')
        self.assertEqual(artifact['preparationVersion'], 'catastrophe-preparation-dallas-v1')
        self.assertEqual(artifact['actorContexts'], contract['actorContexts'])
        self.assertEqual(artifact['generationOutcome'], 'blocked')
        self.assertEqual(artifact['candidates'], [])

    def test_dallas_entities_are_explicit_demo_residents_and_keep_node_ids_opaque(self):
        manifest = normalize.preparation_manifest(dallas_contract(), 'gpt-6.1-terra')
        self.assertEqual([e['name'] for e in manifest['entities']], [f'Dallas demo resident {h}' for h in NODES])
        for entity in manifest['entities']:
            self.assertIn('synthetic', entity['summary'])
            self.assertIn('opaque', entity['instruction'])
            self.assertNotIn('Riverdale', json.dumps(entity))

    def test_arbitrary_contracts_and_dallas_legacy_model_are_rejected(self):
        for contract in [dict(dallas_contract(), mapDatasetHash='0' * 64),
                         dict(dallas_contract(), template='storm-dallas-v2')]:
            with self.subTest(contract=contract), self.assertRaises(ValueError):
                normalize.preparation_manifest(contract, 'gpt-6.1-terra')
        with self.assertRaises(ValueError):
            normalize.preparation_manifest(dallas_contract(), 'gpt-4.1-mini')

    def test_exact_frozen_manifest_and_map_placement_identity_without_mutation(self):
        contract = dallas_contract()
        before = copy.deepcopy(contract)
        self.assertEqual(contract, normalize.load_contract(ROOT / 'fixtures/actor-context-dallas-v1.json'))
        manifest = normalize.preparation_manifest(contract, 'gpt-6.1-terra')
        frozen = json.loads((ROOT / 'fixtures/preparation-manifest-dallas-terra-low-v1.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest, frozen)
        self.assertEqual(normalize.canonical_hash(manifest), 'f1f98271f7c423fa1dc0a851c67837c228c81ddd05bfd3c992502110e1c3d20b')
        self.assertEqual(normalize.canonical_hash(contract['actorContexts']), '41a8c28b2da65f9519a19e6426514a86328724021c0d0cca3f84499386fd4062')
        bundle = json.loads((ROOT / 'fixtures/maps/dallas-streets-v1.json').read_text(encoding='utf-8'))
        self.assertEqual(contract['mapDatasetHash'], bundle['map']['metadata']['datasetHash'])
        placements = {home['id']: home['nodeId'] for home in bundle['placements']['households']}
        for actor in contract['actorContexts']:
            self.assertEqual(actor['nodeId'], placements[actor['householdId']])
        terra = normalize.preparation_manifest(normalize.load_contract(), 'gpt-6.1-terra')
        self.assertEqual(manifest['profiles'], terra['profiles'])
        self.assertEqual(manifest['social'], terra['social'])
        self.assertEqual(contract, before)

    def test_contract_type_aliases_and_hidden_inputs_cannot_match_frozen_inputs(self):
        variants = [dict(dallas_contract(), version=True), dict(dallas_contract(), fleet=2),
                    dict(dallas_contract(), preparationVersion='catastrophe-preparation-v1')]
        changed = dallas_contract()
        changed['actorContexts'][0]['size'] = 2.0
        variants.append(changed)
        changed = dallas_contract()
        changed['actorContexts'][0]['nodeId'] = 'g0-1'
        variants.append(changed)
        for contract in variants:
            before = copy.deepcopy(contract)
            with self.subTest(contract=contract), self.assertRaises(ValueError):
                normalize.preparation_manifest(contract, 'gpt-6.1-terra')
            self.assertEqual(contract, before)

    def test_changed_full_manifest_is_rejected_before_secret_or_work_access(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            fixtures = base / 'fixtures'
            fixtures.mkdir()
            frozen = json.loads((ROOT / 'fixtures/preparation-manifest-dallas-terra-low-v1.json').read_text(encoding='utf-8'))
            frozen['social']['rounds'] = 2
            fixture = fixtures / 'preparation-manifest-dallas-terra-low-v1.json'
            fixture.write_text(json.dumps(frozen), encoding='utf-8')
            source = base / 'input.json'
            source.write_text(json.dumps(dallas_contract()), encoding='utf-8')
            output = base / 'artifact.json'
            argv = ['prepare_mirofish.py', '--input', str(source), '--output', str(output),
                    '--key-file', str(base / 'must-not-be-read.key'), '--budget-usd', '1']
            before = fixture.read_bytes()
            with patch.object(normalize, 'ROOT', base), patch.object(prepare, 'ROOT', base), patch.object(sys, 'argv', argv):
                with self.assertRaises((SystemExit, FileNotFoundError)) as stopped:
                    prepare.main()
                self.assertIsInstance(stopped.exception, SystemExit)
            self.assertEqual(before, fixture.read_bytes())
            self.assertFalse(output.exists())
            self.assertFalse((base / '.private').exists())

    def test_resume_preserves_dallas_identity_and_rejects_legacy_or_changed_prompts(self):
        dallas = normalize.preparation_manifest(dallas_contract(), 'gpt-6.1-terra')
        legacy = normalize.preparation_manifest(normalize.load_contract(), 'gpt-6.1-terra')
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            manifest = work / 'preparation-manifest.json'
            manifest.write_text(json.dumps(dallas), encoding='utf-8')
            evidence = {'model': 'gpt-6.1-terra', 'profiles': [dict(householdId=entity['uuid'], instruction=entity['instruction']) for entity in dallas['entities']]}
            profile_file = work / 'profiles-evidence.json'
            profile_file.write_text(json.dumps(evidence), encoding='utf-8')
            before = {p.name: p.read_bytes() for p in work.iterdir()}
            prepare.verify_resume_manifest(work, dallas)
            with self.assertRaises(ValueError):
                prepare.verify_resume_manifest(work, legacy)
            self.assertEqual(before, {p.name: p.read_bytes() for p in work.iterdir()})
            evidence['profiles'][0]['instruction'] = legacy['entities'][0]['instruction']
            profile_file.write_text(json.dumps(evidence), encoding='utf-8')
            with self.assertRaises(ValueError):
                prepare.verify_resume_manifest(work, dallas)

    def test_cli_rejects_invalid_contract_before_reading_key_or_creating_work(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            contract = dict(dallas_contract(), mapDatasetHash='0' * 64)
            source = base / 'input.json'
            source.write_text(json.dumps(contract), encoding='utf-8')
            key = base / 'must-not-be-read.key'
            output = base / 'artifact.json'
            argv = ['prepare_mirofish.py', '--input', str(source), '--output', str(output),
                    '--key-file', str(key), '--budget-usd', '1']
            before = source.read_bytes()
            with patch.object(sys, 'argv', argv), self.assertRaises((SystemExit, FileNotFoundError)) as stopped:
                prepare.main()
            self.assertIsInstance(stopped.exception, SystemExit)
            self.assertFalse(output.exists())
            self.assertEqual(source.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
