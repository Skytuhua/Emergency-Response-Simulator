import json
import sys
import tempfile
import os
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(TOOLS / 'v2'))
import mirofish_worker as legacy
import project_budget as budget


class ProjectBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch = patch.object(budget, 'canonical_private_root', return_value=self.root)
        self.patch.start(); self.addCleanup(self.patch.stop)

    def work(self, name):
        work = self.root / name; work.mkdir()
        (work / 'preparation-manifest.json').write_text(json.dumps({'version': 2, 'profiles': {'model': 'gpt-6.1-terra'}}))
        return work

    def test_whole_cohort_and_legacy_calls_share_one_cap_without_double_counting(self):
        work = self.work('cohort-a')
        budget.reserve_cohort(work, '4', {'profile:A': 1, 'report:A': 2})
        self.assertEqual(legacy.cumulative_spend(self.root), legacy.AUDITED_PRIOR_USD + 4)
        (work / 'usage.json').write_text(json.dumps([{'status':'success','accounting':'usage-estimate','reservedUsd':1,'chargedUsd':0.2}]))
        self.assertEqual(legacy.cumulative_spend(self.root), legacy.AUDITED_PRIOR_USD + 4)
        budget.complete_cohort(work)
        self.assertEqual(legacy.cumulative_spend(self.root), legacy.AUDITED_PRIOR_USD + legacy._money('0.2'))

    def test_cap_wrong_root_and_duplicate_opportunity_fail_before_calls(self):
        a, b = self.work('a'), self.work('b')
        budget.reserve_cohort(a, '6', {'profile:A': 1})
        with self.assertRaisesRegex(RuntimeError, 'cap|budget'):
            budget.reserve_cohort(b, '5', {'profile:B': 1})
        with self.assertRaisesRegex(ValueError, 'opportunity'):
            budget.reserve_cohort(b, '1', {'profile:A': 1})
        nested = self.root / 'nested' / 'child'; nested.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'immediate|root'):
            budget.reserve_cohort(nested, '1', {'profile:C': 1})

    def test_logical_attempts_remain_exhausted_after_failure_or_new_folder(self):
        work = self.work('a')
        budget.reserve_cohort(work, '1', {'profile:A': 1})
        budget.claim_opportunity(work, 'profile:A')
        with self.assertRaisesRegex(RuntimeError, 'limit|exhausted'):
            budget.claim_opportunity(work, 'profile:A')
        budget.complete_cohort(work)
        with self.assertRaisesRegex(ValueError, 'opportunity'):
            budget.reserve_cohort(self.work('b'), '1', {'profile:A': 1})

    def test_corrupt_or_unknown_cohort_ledger_fails_closed(self):
        (self.root / 'terra-v2-cohorts.json').write_text('{broken')
        with self.assertRaises(ValueError): legacy.cumulative_spend(self.root)
        with self.assertRaises(ValueError): budget.reserve_cohort(self.work('a'), '1', {'a': 1})

    def test_malformed_resumed_counters_fail_closed_for_old_and_new_readers(self):
        work = self.work('a'); budget.reserve_cohort(work, '1', {'a': 1})
        path = self.root / 'terra-v2-cohorts.json'
        original = json.loads(path.read_text())
        for field, bad in [('attempts', -1), ('limit', 100), ('limit', True), ('limit', 1.0)]:
            changed = json.loads(json.dumps(original)); changed['opportunities']['a'][field] = bad
            path.write_text(json.dumps(changed))
            with self.subTest(field=field, bad=bad):
                with self.assertRaises(ValueError): legacy.cumulative_spend(self.root)
                with self.assertRaises(ValueError): budget.claim_opportunity(work, 'a')

    def test_own_admitted_allowance_is_not_reserved_twice_and_pre_io_failure_keeps_attempt(self):
        work = self.work('a'); budget.reserve_cohort(work, '9.98', {'profile:A': 1, 'report:A': 2})
        receipt = work / 'preflight.json'
        receipt.write_text(json.dumps({'model':'gpt-6.1-terra','available':True,'statusCode':200,'endpoint':legacy.MODEL_ENDPOINT}))
        with patch.dict(os.environ, {'MIROFISH_BUDGET_USD':'9.98','MIROFISH_PREFLIGHT_RECEIPT':str(receipt)}):
            guard = budget.V2CallGuard(work)
        with guard.opportunity('profile:A'), patch.object(guard.bridge, 'prepare', return_value={'input':'tiny'}):
            index, _ = guard.start({})
        self.assertEqual(index, 0)
        self.assertEqual(legacy.cumulative_spend(self.root), legacy.AUDITED_PRIOR_USD + legacy._money('9.98'))
        with guard.opportunity('report:A'), patch.object(guard.bridge, 'prepare', return_value={'input':'x'*50001}):
            with self.assertRaisesRegex(RuntimeError,'byte limit'): guard.start({})
        ledger = json.loads((self.root/'terra-v2-cohorts.json').read_text())
        self.assertEqual(ledger['opportunities']['report:A']['attempts'], 0)


if __name__ == '__main__': unittest.main()
