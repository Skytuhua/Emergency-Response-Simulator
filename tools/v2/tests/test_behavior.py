"""Synthetic no-spend checks; these snippets are not provider evidence."""
from copy import deepcopy
import importlib
import json
import hashlib
from pathlib import Path
import sys
import unittest
import tempfile
import subprocess
import os

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/v2'))
sys.path.insert(0, str(ROOT / 'tools'))


class BehaviorTests(unittest.TestCase):
    def setUp(self):
        self.contract = importlib.import_module('behavior_contract')
        self.normalizer = importlib.import_module('normalize_behavior')
        self.fixture = json.loads((ROOT / 'fixtures/v2/behavior/authored-chain.json').read_text(encoding='utf-8'))

    def test_canonical_context_is_integer_only_and_unicode_stable(self):
        self.assertEqual(self.contract.canonical({'\U00010000': 2, '\ue000': 1}), '{"\ue000":1,"\U00010000":2}')
        for bad in (0.5, float('nan'), 2 ** 54):
            with self.assertRaises(ValueError):
                self.contract.canonical({'atMs': bad})

    def test_compact_chain_retains_only_allowed_fields_and_exact_sources(self):
        artifact = self.normalizer.validate_artifact(self.fixture)
        self.assertEqual(len(artifact['personas']), 1)
        self.assertEqual(len(artifact['actions']), 1)
        for mutate in (
            lambda x: x['personas'][0].update(persona='invented biography'),
            lambda x: x['actions'][0].update(sourceResponseHash='f' * 64),
            lambda x: x['contexts'][0].update(size=9),
            lambda x: x['preparationManifest']['profiles'].update(sdkRetries=1),
            lambda x: x['evidence'][0]['payload'].update(reasoning='private reasoning'),
        ):
            bad = deepcopy(self.fixture)
            mutate(bad)
            with self.assertRaises(ValueError):
                self.normalizer.validate_artifact(bad)

    def test_action_parser_rejects_extra_facts_and_duplicate_json(self):
        context = self.fixture['contexts'][0]
        valid = self.contract.report_payload(context)
        self.assertEqual(self.normalizer.parse_report(json.dumps(valid), context), valid)
        for text in (json.dumps({**valid, 'severity': 'fatal'}), json.dumps(valid) + json.dumps(valid), json.dumps({**valid, 'needId': 'another'}), json.dumps(valid).replace('{', '{"kind":"help_request_v2",', 1)):
            with self.assertRaises(ValueError):
                self.normalizer.parse_report(text, context)

    def test_offline_cli_never_reads_credentials_or_imports_provider(self):
        preparation = importlib.import_module('prepare_behavior')
        with self.assertRaisesRegex(ValueError, 'shared budget gate'):
            preparation.require_execution_gate({'not': 'approved'})

    def _resume_fixture(self, work):
        """Authored pre-social failure; never provider evidence."""
        from terra_responses import TerraResponsesBridge
        context = deepcopy(self.fixture['contexts'][0])
        later = deepcopy(context)
        later.update(opportunityId=context['opportunityId'] + ':later', atMs=context['atMs'] + 1000)
        manifest = self.contract.make_manifest([context, later], 'authored-resume')
        (work / 'preparation-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        actor = manifest['actors'][0]
        prompt = next(p for p in manifest['prompts'] if p['kind'] == 'persona')
        source = dict(bio='Authored profile', persona='Authored person’s profile.', age=43, gender='other', mbti='ISTJ', country='United States', profession='Test profession', interested_topics=['Authored topic'])
        request = TerraResponsesBridge().prepare({'model': self.contract.MODEL, 'messages': [{'role': 'user', 'content': prompt['text']}], 'reasoning_effort': 'low'}, 0)
        raw = dict(model=self.contract.MODEL, status='completed', error=None, output=[dict(type='message', content=[dict(type='output_text', text=json.dumps(source))])])
        (work / 'request-0.json').write_text(json.dumps(request), encoding='utf-8')
        (work / 'responses-0.json').write_text(json.dumps(raw), encoding='utf-8')
        (work / 'request-meta-0.json').write_text(json.dumps(dict(logicalOpportunityId=prompt['id'])), encoding='utf-8')
        (work / 'usage.json').write_text(json.dumps([dict(status='success', model=self.contract.MODEL, reasoningEffort='low', responseModel=self.contract.MODEL, requestHash=self.contract.hash_value(request), logicalOpportunityId=prompt['id'])]), encoding='utf-8')
        (work / 'profiles-verified.json').write_text(json.dumps([dict(householdId=actor['householdId'], **{k: source[k] for k in ('persona', 'age', 'profession')})]), encoding='utf-8')
        episode = work / 'episode-0'; episode.mkdir()
        contexts = [[c for c in manifest['contexts'] if c['householdId'] == a['householdId']][0] for a in manifest['actors']]
        (episode / 'contexts.json').write_text(json.dumps(contexts), encoding='utf-8')
        row = dict(user_id=0, username='synthetic_dallas_actor_1_123', name='Synthetic Dallas actor 1', karma=1000, created_at='2026-11-08', **source)
        row['persona'] += '\n\n' + self.contract.action_instruction(contexts[0])
        (episode / 'reddit_profiles.json').write_text(json.dumps([row], ensure_ascii=False), encoding='utf-8')
        preparation = importlib.import_module('prepare_behavior')
        (episode / 'simulation_config.json').write_text(json.dumps(preparation.episode_config(manifest, work, 0)), encoding='utf-8')
        gate = dict(kind='dallas-v2-paid-cohort-authorization', version=2, model=self.contract.MODEL, reasoningEffort='low', authorized=True, manifestHash=self.contract.hash_value(manifest), allowanceUsd='4.671600')
        ledger = dict(version=1, canonicalRoot=str(work.parent.resolve()), cohorts=[dict(work=work.name, allowanceUsd='4.671600', status='active')], opportunities={p['id']: dict(work=work.name, limit=1 if p['kind']=='persona' else 2, attempts=1 if p['kind']=='persona' else 0) for p in manifest['prompts']})
        return manifest, gate, ledger

    def test_worker_utf8_mode_reads_unicode_profile_with_unspecified_upstream_encoding(self):
        preparation = importlib.import_module('prepare_behavior')
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'profiles.json'
            path.write_text(json.dumps({'persona': 'Resident’'}, ensure_ascii=False), encoding='utf-8')
            with self.assertRaises(UnicodeDecodeError):
                json.loads(path.read_bytes().decode('gbk'))
            command = preparation.worker_interpreter() + ['-c', 'import json,sys; assert json.load(open(sys.argv[1]))["persona"] == "Resident\\u2019"; print(sys.flags.utf8_mode)', str(path)]
            result = subprocess.run(command, env={**os.environ, 'PYTHONUTF8': '0'}, capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), '1')

    def test_profile_resume_reuses_exact_paid_profiles_without_mutating_custody(self):
        preparation = importlib.import_module('prepare_behavior')
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            manifest, gate, ledger = self._resume_fixture(work)
            before = {str(p.relative_to(work)): p.read_bytes() for p in work.rglob('*') if p.is_file()}
            profiles = preparation.admit_profile_resume(manifest, work, gate, ledger)
            self.assertEqual(profiles[0]['persona'], 'Authored person’s profile.')
            self.assertEqual(profiles[0]['user_name'], 'synthetic_dallas_actor_1_123')
            self.assertEqual(before, {str(p.relative_to(work)): p.read_bytes() for p in work.rglob('*') if p.is_file()})
            self.assertEqual([r['attempts'] for r in ledger['opportunities'].values()], [1, 0, 0])

    def test_profile_resume_rejects_social_attempt_unknown_scaffold_and_unverified_profile(self):
        preparation = importlib.import_module('prepare_behavior')
        for mutation in ('action-attempt', 'bool-attempt', 'completed-lease', 'wrong-allowance', 'unverified', 'wrong-request', 'extra-request', 'incomplete', 'database', 'wrong-context', 'claimed'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                work = Path(temporary); manifest, gate, ledger = self._resume_fixture(work)
                if mutation == 'action-attempt':
                    next(row for key,row in ledger['opportunities'].items() if key.startswith('report:'))['attempts'] = 1
                elif mutation == 'bool-attempt': next(iter(ledger['opportunities'].values()))['attempts'] = True
                elif mutation == 'completed-lease': ledger['cohorts'][0]['status'] = 'completed'
                elif mutation == 'wrong-allowance': gate['allowanceUsd'] = '1'
                elif mutation == 'unverified':
                    path=work/'profiles-verified.json'; path.write_text(path.read_text(encoding='utf-8').replace('Test profession','Changed profession'), encoding='utf-8')
                elif mutation == 'wrong-request':
                    path=work/'request-0.json'; path.write_text(path.read_text(encoding='utf-8').replace('gpt-6.1-terra','other-model'), encoding='utf-8')
                elif mutation == 'extra-request': (work/'request-1.json').write_text('{}', encoding='utf-8')
                elif mutation == 'incomplete':
                    path=work/'responses-0.json'; path.write_text(path.read_text(encoding='utf-8').replace('completed','incomplete'), encoding='utf-8')
                elif mutation == 'database': (work/'episode-0/reddit_simulation.db').write_bytes(b'authored')
                elif mutation == 'wrong-context': (work/'episode-0/contexts.json').write_text('[]', encoding='utf-8')
                elif mutation == 'claimed': (work/'profiles-resume-claim.json').write_text('{}', encoding='utf-8')
                with self.assertRaises(ValueError): preparation.admit_profile_resume(manifest,work,gate,ledger)

    def test_aggregate_preserves_original_manifest_and_rejects_duplicate_opportunity(self):
        merged = self.normalizer.merge_artifacts([self.fixture])
        self.assertEqual(merged['preparationManifest']['manifests'][0], self.fixture['preparationManifest'])
        self.assertEqual(self.normalizer.validate_artifact(merged)['actions'], self.fixture['actions'])
        with self.assertRaises(ValueError):
            self.normalizer.merge_artifacts([self.fixture, self.fixture])

    def test_tool_continuation_cannot_execute_a_second_action(self):
        preparation = importlib.import_module('prepare_behavior')
        context = self.fixture['contexts'][0]
        calls = [{'name': 'do_nothing', 'arguments': '{}'}]
        selected = set()
        preparation.validate_selected_tools(context, calls, selected)
        preparation.validate_selected_tools(context, [], selected)  # normal final continuation
        with self.assertRaisesRegex(ValueError, 'second action'):
            preparation.validate_selected_tools(context, calls, selected)

    def test_frozen_prompt_supports_text_forms_without_matching_reasoning_or_changed_text(self):
        prompt = self.fixture['preparationManifest']['prompts'][0]['text']
        contains = self.normalizer.request_contains_frozen_prompt
        for content in (prompt, [{'type': 'input_text', 'text': prompt}], [{'type': 'output_text', 'text': 'Upstream wrapper ' + prompt}]):
            self.assertTrue(contains({'input': [{'role': 'user', 'content': content}]}, prompt))
        for content in (prompt[:-1], [{'type': 'reasoning', 'text': prompt}], [{'type': 'input_text', 'text': prompt[:-1]}]):
            self.assertFalse(contains({'input': [{'role': 'user', 'content': content}]}, prompt))
        self.assertFalse(contains({'input': [{'type': 'function_call_output', 'output': prompt}]}, prompt))

    def test_upstream_file_logging_is_private_and_redacts_exception_fragments(self):
        import logging
        import io
        preparation = importlib.import_module('prepare_behavior')
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            restore = preparation.configure_private_logging(work)
            logger = logging.getLogger('v2-authored-secret-probe')
            logger.propagate = False
            handler = logging.FileHandler(ROOT / 'log/v2-must-not-write-here.log')
            captured = io.StringIO()
            stream = logging.StreamHandler(captured)
            logger.addHandler(handler)
            logger.addHandler(stream)
            logger.setLevel(logging.ERROR)
            try:
                try:
                    raise RuntimeError('AUTHORED credential fragment sk-offline-secret-fragment-123')
                except RuntimeError:
                    logger.exception('AUTHORED failure %s', 'sk-offline-secret-fragment-123')
                handler.flush()
                written = Path(handler.baseFilename)
                self.assertEqual(written.parent, work / 'log')
                self.assertNotIn('sk-offline', written.read_text(encoding='utf-8'))
                self.assertIn('[REDACTED]', written.read_text(encoding='utf-8'))
                self.assertNotIn('sk-offline', captured.getvalue())
                self.assertIn('[REDACTED]', captured.getvalue())
                self.assertFalse((ROOT / 'log/v2-must-not-write-here.log').exists())
            finally:
                logger.removeHandler(handler)
                logger.removeHandler(stream)
                handler.close()
                restore()

    def test_actual_oasis_agent_rate_limit_has_one_attempt_without_sleep(self):
        import asyncio
        from unittest.mock import AsyncMock, Mock, patch
        preparation = importlib.import_module('prepare_behavior')
        with tempfile.TemporaryDirectory() as temporary:
            restore = preparation.configure_private_logging(Path(temporary))
            try:
                import httpx
                from openai import RateLimitError
                from camel.models.stub_model import StubModel
                from camel.types import ModelType
                from oasis.social_agent.agent import SocialAgent
                from oasis.social_platform.config import UserInfo
                from oasis.social_platform.typing import ActionType
                agent = SocialAgent(0, UserInfo(name='Authored test actor'), model=StubModel(ModelType.STUB), available_actions=[ActionType.DO_NOTHING])
                self.assertEqual(agent.retry_attempts, 3)  # installed upstream constructor
                preparation.disable_agent_retries(agent)
                self.assertEqual(agent.retry_attempts, 1)  # actual constructed instance
                guard_start = Mock()
                async def rejected_request(*args, **kwargs):
                    guard_start()
                    raise RateLimitError('AUTHORED offline rate limit', response=httpx.Response(429, request=httpx.Request('POST', 'https://example.invalid')), body=None)
                with patch.object(agent.model_backend, 'arun', new=rejected_request), patch('asyncio.sleep', new_callable=AsyncMock) as sleep:
                    with self.assertRaises(Exception):
                        asyncio.run(agent._aget_model_response([], 0))
                    self.assertEqual(guard_start.call_count, 1)
                    sleep.assert_not_awaited()
            finally:
                restore()

    def test_private_verifier_checks_raw_crlf_bytes_actual_request_and_oasis_row(self):
        # Entirely authored source files exercise custody checks without network.
        from terra_responses import TerraResponsesBridge
        bridge = TerraResponsesBridge()
        artifact = deepcopy(self.fixture)
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            usage, replacement = [], {}
            for index, evidence in enumerate(artifact['evidence'][:2]):
                compact = evidence['payload']
                prompt = artifact['preparationManifest']['prompts'][index]
                request = bridge.prepare({'model': self.contract.MODEL, 'messages': [{'role': 'user', 'content': prompt['text']}], 'reasoning_effort': 'low'}, index)
                self.assertIsInstance(request['input'][0]['content'], str)
                raw = {'model': self.contract.MODEL, 'status': 'completed', 'error': None, 'output': []}
                if compact['outputText']:
                    raw['output'].append({'type': 'message', 'content': [{'type': 'output_text', 'text': compact['outputText']}]})
                for tool in compact['toolCalls']:
                    raw['output'].append({'type': 'function_call', 'name': tool['name'], 'arguments': tool['arguments'], 'call_id': tool['callId']})
                raw_bytes = json.dumps(raw, indent=2).replace('\n', '\r\n').encode('utf-8')
                response_hash = hashlib.sha256(raw_bytes).hexdigest()
                (work / f'responses-{index}.json').write_bytes(raw_bytes)
                (work / f'request-{index}.json').write_text(json.dumps(request), encoding='utf-8')
                replacement[compact['sourceResponseHash']] = response_hash
                compact['sourceResponseHash'] = response_hash
                compact['requestHash'] = self.contract.hash_value(request)
                evidence['id'] = 'response:' + response_hash
                usage.append({'status': 'success', 'requestHash': compact['requestHash'], 'logicalOpportunityId': prompt['id']})
            (work / 'usage.json').write_text(json.dumps(usage), encoding='utf-8')
            artifact['personas'][0]['sourceResponseHash'] = replacement[artifact['personas'][0]['sourceResponseHash']]
            artifact['actions'][0]['sourceResponseHash'] = replacement[artifact['actions'][0]['sourceResponseHash']]
            trace = artifact['evidence'][2]['payload']
            trace['sourceResponseHash'] = artifact['actions'][0]['sourceResponseHash']
            trace['responseEvidenceId'] = 'response:' + trace['sourceResponseHash']
            row = {'source_rowid': 1, 'user_id': 0, 'action': 'create_post', 'info': json.dumps({'content': trace['content']})}
            trace['sourceTraceHash'] = self.contract.hash_value(row)
            episode = work / 'episode-0'
            episode.mkdir()
            (episode / 'trace.json').write_text(json.dumps([row]), encoding='utf-8')
            for receipt in artifact['sourceReceipts']:
                if receipt['sha256'] in replacement:
                    receipt['sha256'] = replacement[receipt['sha256']]
                    receipt['id'] = 'response:' + receipt['sha256']
                elif receipt['id'].startswith('trace:'):
                    receipt['sha256'] = trace['sourceTraceHash']
            for item in artifact['evidence']:
                item['sha256'] = self.contract.hash_value(item['payload'])
            self.assertEqual(len(self.normalizer.verify_private_sources(artifact, work)['actions']), 1)
            request_path = work / 'request-1.json'
            request_path.write_text(request_path.read_text(encoding='utf-8').replace('Fictional Dallas', 'Altered Dallas'), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'request differs'):
                self.normalizer.verify_private_sources(artifact, work)


if __name__ == '__main__':
    unittest.main()
