"""One physical preparation ledger and recoverable, whole-cohort admissions.

This module performs no model requests. V2CallGuard delegates the bounded
Responses transport to the existing guard after claiming one logical attempt.
"""
from __future__ import annotations

import json
import os
import subprocess
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
import sys

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from mirofish_worker import CallGuard, TOTAL_BUDGET_USD, _money, _charged, budget_lock, cumulative_spend


def canonical_private_root() -> Path:
    """Git worktrees share the primary checkout's physical budget root."""
    common = subprocess.check_output(['git', '-C', str(TOOLS.parent), 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip()
    common_path = Path(common).resolve()
    if common_path.name != '.git':
        raise ValueError('Preparation requires the primary project Git budget root')
    return (common_path.parent / '.private').resolve()


def _root(work: Path) -> Path:
    root = canonical_private_root()
    if work.resolve().parent != root or work.is_symlink():
        raise ValueError('Cohorts must be immediate children of the canonical budget root')
    manifest = json.loads((work / 'preparation-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('profiles', {}).get('model') != 'gpt-6.1-terra':
        raise ValueError('Unregistered cohort model')
    return root


def _read(root: Path) -> dict:
    path = root / 'terra-v2-cohorts.json'
    if not path.exists():
        return {'version': 1, 'canonicalRoot': str(root.resolve()), 'cohorts': [], 'opportunities': {}}
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if (value.get('version') != 1 or value.get('canonicalRoot') != str(root.resolve())
                or not isinstance(value.get('cohorts'), list) or not isinstance(value.get('opportunities'), dict)):
            raise ValueError()
        works = set()
        for cohort in value['cohorts']:
            name = cohort.get('work') if isinstance(cohort, dict) else None
            if (not isinstance(name, str) or not name or Path(name).name != name or name in {'.', '..'} or name in works
                    or cohort.get('status') not in {'active', 'completed'} or not 0 < _money(cohort.get('allowanceUsd')) <= TOTAL_BUDGET_USD):
                raise ValueError()
            works.add(name)
        for identity, row in value['opportunities'].items():
            if (not isinstance(identity, str) or not 1 <= len(identity) <= 256 or not isinstance(row, dict)
                    or row.get('work') not in works or type(row.get('limit')) is not int or row['limit'] not in {1, 2}
                    or type(row.get('attempts')) is not int or not 0 <= row['attempts'] <= row['limit']):
                raise ValueError()
        return value
    except (ValueError, AttributeError):
        raise ValueError('Invalid shared v2 preparation cohort ledger') from None


def _write(root: Path, ledger: dict) -> None:
    path = root / 'terra-v2-cohorts.json'
    temporary = root / 'terra-v2-cohorts.tmp'
    with temporary.open('w', encoding='utf-8') as output:
        json.dump(ledger, output, indent=2); output.flush(); os.fsync(output.fileno())
    os.replace(temporary, path)


def reserve_cohort(work: Path, allowance_usd, opportunities: dict[str, int]) -> None:
    root = _root(work); allowance = _money(allowance_usd)
    if not 0 < allowance <= TOTAL_BUDGET_USD or not opportunities:
        raise ValueError('Invalid cohort allowance or opportunities')
    if any(not isinstance(key, str) or not 1 <= len(key) <= 256 or type(limit) is not int or limit not in {1, 2} for key, limit in opportunities.items()):
        raise ValueError('Invalid logical opportunity limit')
    with budget_lock(root):
        ledger = _read(root)
        if any(key in ledger['opportunities'] for key in opportunities):
            raise ValueError('A logical opportunity is already registered; resume its original cohort')
        if any(row.get('work') == work.name for row in ledger['cohorts']):
            raise ValueError('Cohort is already registered')
        if cumulative_spend(root) + allowance > TOTAL_BUDGET_USD:
            raise RuntimeError('Cumulative project budget cap cannot admit this cohort')
        ledger['cohorts'].append({'work': work.name, 'allowanceUsd': str(allowance), 'status': 'active'})
        ledger['opportunities'].update({key: {'work': work.name, 'limit': limit, 'attempts': 0} for key, limit in opportunities.items()})
        _write(root, ledger)


def claim_opportunity(work: Path, logical_id: str) -> None:
    root = _root(work)
    with budget_lock(root):
        _claim_locked(root, work, logical_id)


def _claim_locked(root: Path, work: Path, logical_id: str) -> None:
    ledger = _read(root)
    row = ledger['opportunities'].get(logical_id)
    cohort = next((row for row in ledger['cohorts'] if row.get('work') == work.name), None)
    if not row or row.get('work') != work.name or not cohort or cohort.get('status') != 'active':
        raise ValueError('Opportunity has no active registered cohort')
    if type(row.get('attempts')) is not int or row['attempts'] < 0 or type(row.get('limit')) is not int or row.get('limit') not in {1, 2}:
        raise ValueError('Invalid logical opportunity attempt ledger')
    if row['attempts'] >= row['limit']:
        raise RuntimeError('Logical opportunity attempt limit exhausted')
    row['attempts'] += 1
    _write(root, ledger)


def complete_cohort(work: Path) -> None:
    root = _root(work)
    with budget_lock(root):
        ledger = _read(root)
        cohort = next((row for row in ledger['cohorts'] if row.get('work') == work.name), None)
        if cohort is None: raise ValueError('Cohort is not registered')
        cohort['status'] = 'completed'; _write(root, ledger)


class V2CallGuard(CallGuard):
    def __init__(self, work: Path):
        root = _root(work)
        super().__init__(work)
        with budget_lock(root):
            cohort = next((row for row in _read(root)['cohorts'] if row.get('work') == work.name), None)
            if not cohort or cohort.get('status') != 'active' or self.budget > _money(cohort['allowanceUsd']):
                raise ValueError('Call budget exceeds its active whole-cohort allowance')
        self._logical_id = ContextVar('terra-v2-logical-opportunity', default=None)

    @contextmanager
    def opportunity(self, logical_id: str):
        token = self._logical_id.set(logical_id)
        try: yield
        finally: self._logical_id.reset(token)

    def _budget_growth(self, ceiling):
        root = _root(self.work)
        cohort = next(row for row in _read(root)['cohorts'] if row.get('work') == self.work.name)
        allowance = _money(cohort['allowanceUsd'])
        charged = _charged(self.calls)
        return max(allowance, charged + ceiling) - max(allowance, charged)

    def _reservation_metadata(self):
        logical_id = self._logical_id.get()
        if not logical_id: raise ValueError('A registered logical opportunity is required')
        root = _root(self.work)
        # Called by CallGuard.start inside the same lock, after every pre-I/O
        # budget/request check. A rejected admission does not consume an attempt.
        _claim_locked(root, self.work, logical_id)
        return {'logicalOpportunityId': logical_id}
