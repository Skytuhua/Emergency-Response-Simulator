"""Offline v2 manifest compatibility checks for the coordinator-owned ledger."""
from decimal import Decimal
import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/v2'))
sys.path.insert(0, str(ROOT / 'tools'))


class BehaviorBudgetTests(unittest.TestCase):
    def test_legacy_reader_counts_v2_and_failed_uncertain_calls(self):
        preparation = importlib.import_module('prepare_behavior')
        worker = importlib.import_module('mirofish_worker')
        fixture = json.loads((ROOT / 'fixtures/v2/behavior/authored-chain.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as temporary:
            ledger = Path(temporary)
            work = ledger / 'v2-cohort-1'
            work.mkdir()
            (work / 'preparation-manifest.json').write_text(json.dumps(fixture['preparationManifest']))
            (work / 'usage.json').write_text(json.dumps([
                {'reservedUsd': .2, 'chargedUsd': .01, 'status': 'failed', 'accounting': 'usage-estimate'},
                {'reservedUsd': .2, 'chargedUsd': .02, 'status': 'success', 'accounting': 'usage-estimate'},
            ]))
            self.assertEqual(worker.cumulative_spend(ledger), worker.AUDITED_PRIOR_USD + Decimal('.22'))
            self.assertEqual(preparation.validate_work_root(work, ledger), work.resolve())
            nested = work / 'nested'
            nested.mkdir()
            with self.assertRaises(ValueError):
                preparation.validate_work_root(nested, ledger)

    def test_cohort_ceiling_counts_continuations_and_no_retries(self):
        preparation = importlib.import_module('prepare_behavior')
        estimate = preparation.allowance_estimate(6)
        self.assertEqual(estimate['maxCalls'], 30)
        self.assertEqual(estimate['sdkRetries'], 0)
        self.assertEqual(estimate['maxUsd'], '4.671600')
        with self.assertRaises(ValueError):
            preparation.allowance_estimate(7)


if __name__ == '__main__':
    unittest.main()
