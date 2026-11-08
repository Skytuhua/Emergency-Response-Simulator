import { describe, expect, it } from 'vitest';
// The executable Node harness is JavaScript so it can run without a new build dependency.
// @ts-expect-error This local executable intentionally has no declaration file.
import { EXPERIMENT_PLAN, pairedDifferences, statistics, subsetPopulation, extractMetrics, admitBaselineRows } from '../../tools/v2/evaluate.mjs';
// @ts-expect-error The executable benchmark intentionally has no declaration file.
import { validateBenchmarkWorker } from '../../tools/v2/benchmark.mjs';

describe('V2 evaluation evidence contracts', () => {
  it('freezes all 30 baseline seeds, exact policies, and background-only behavior before execution', () => {
    expect(EXPERIMENT_PLAN.seeds).toEqual(Array.from({ length: 30 }, (_, i) => 20261108 + i));
    expect(EXPERIMENT_PLAN.policies).toEqual(['received-order-v2', 'urgency-first-v2', 'urgency-plus-coverage-v2']);
    expect(EXPERIMENT_PLAN.preparedArtifact).toBe(null);
    expect(EXPERIMENT_PLAN.sensitivitySeeds).toEqual([20261108, 20261109, 20261110]);
    expect(EXPERIMENT_PLAN.sensitivities.map((row: { id: string }) => row.id)).toEqual([
      'coverage-0', 'coverage-50', 'report-delay-5', 'report-delay-60', 'propensity-60', 'propensity-100', 'travel-0.5', 'travel-1.5',
    ]);
    expect(Object.isFrozen(EXPERIMENT_PLAN.seeds)).toBe(true);
  });
  it('preserves whole household membership and distinct supported unit IDs in a subset', () => {
    const source = { households: [
      { id: 'A', personIds: ['P1', 'P2'], placement: { unitId: 'U1' } },
      { id: 'B', personIds: ['P3'], placement: { unitId: 'U2' } },
    ], persons: [{ id: 'P1', householdId: 'A' }, { id: 'P2', householdId: 'A' }, { id: 'P3', householdId: 'B' }] };
    const result = subsetPopulation(source, 1);
    expect(result.households).toEqual([source.households[0]]);
    expect(result.persons.map((person: { id: string }) => person.id)).toEqual(['P1', 'P2']);
    expect(result.mode).toBe('benchmark');
    expect(() => subsetPopulation(source, 10000)).toThrow(/admission/i);
    expect(source.households).toHaveLength(2);
  });
  it('uses nearest-rank p95 and retains an explicit empty denominator', () => {
    expect(statistics([])).toEqual({ samples: 0, mean: null, median: null, p95: null, min: null, max: null });
    expect(statistics(Array.from({ length: 20 }, (_, i) => i + 1)).p95).toBe(19);
  });
  it('pairs only successful matched-input seed triples and keeps failures in the denominator', () => {
    const successful = (policy: string, seed: number, peopleHelped: number) => ({ status: 'completed', policy, seed, variant: 'baseline', exogenousHash: 'same', metrics: { peopleHelped } });
    const result = pairedDifferences([
      successful('received-order-v2', 1, 4), successful('urgency-first-v2', 1, 5), successful('urgency-plus-coverage-v2', 1, 7),
      successful('received-order-v2', 2, 4), { status: 'failed', policy: 'urgency-first-v2', seed: 2, variant: 'baseline' },
    ]);
    expect(result.completeSeeds).toEqual([1]);
    expect(result.incompleteSeeds).toEqual([2]);
    expect(result.comparisons['urgency-plus-coverage-v2 minus received-order-v2'].peopleHelped.mean).toBe(3);
  });
  it('rejects a purported pair whose frozen exogenous inputs differ', () => {
    const rows = EXPERIMENT_PLAN.policies.map((policy: string, i: number) => ({ status: 'completed', policy, seed: 1, variant: 'baseline', exogenousHash: i ? 'other' : 'first', metrics: {} }));
    expect(() => pairedDifferences(rows)).toThrow(/exogenous/i);
  });
  it('rejects stale worker receipts instead of admitting a previous successful trial after a crash', () => {
    expect(() => validateBenchmarkWorker({ experimentId: 'previous', sourceUnchanged: true }, 'current')).toThrow(/stale/i);
    expect(() => validateBenchmarkWorker({ experimentId: 'current', sourceUnchanged: false }, 'current')).toThrow(/source/i);
    expect(validateBenchmarkWorker({ experimentId: 'current', sourceUnchanged: true }, 'current')).toEqual({ experimentId: 'current', sourceUnchanged: true });
  });
  it('does not admit earlier successful seed rows when the current baseline child fails', () => {
    const expected = { executionId: 'current', seeds: [20261108], planHash: 'plan', sourceSha256: { core: 'hash' } };
    const previous = EXPERIMENT_PLAN.policies.map((policy: string) => ({ seed: 20261108, policy, variant: 'baseline', status: 'completed', executionId: 'previous', planHash: 'plan', sourceSha256: { core: 'hash' } }));
    const rows = admitBaselineRows(previous, [{ seed: 20261108, exitCode: 1 }], expected);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row: { status: string }) => row.status === 'completed')).toHaveLength(0);
    expect(rows.every((row: { status: string; observedReceipt: { status: string } }) => row.status === 'failed' && row.observedReceipt.status === 'completed')).toBe(true);
  });
  it('requires current execution, plan, source, seed, and policy identity for baseline admission', () => {
    const expected = { executionId: 'current', seeds: [20261108], planHash: 'plan', sourceSha256: { core: 'hash' } };
    const current = EXPERIMENT_PLAN.policies.map((policy: string) => ({ seed: 20261108, policy, variant: 'baseline', status: 'completed', executionId: 'current', planHash: 'plan', sourceSha256: { core: 'hash' } }));
    expect(admitBaselineRows(current, [{ seed: 20261108, exitCode: 0 }], expected).every((row: { status: string }) => row.status === 'completed')).toBe(true);
    for (const change of [{ executionId: 'old' }, { planHash: 'other' }, { sourceSha256: { core: 'changed' } }, { seed: 0 }, { policy: 'other' }]) {
      const altered = [{ ...current[0], ...change }, ...current.slice(1)];
      expect(admitBaselineRows(altered, [{ seed: 20261108, exitCode: 0 }], expected).filter((row: { status: string }) => row.status === 'completed')).toHaveLength(2);
    }
  });
  it('excludes a later undiscovered need after an earlier empty check from latest-update waits', () => {
    const state = { nowMs: 30 * 60000, missions: [], needs: [{ id: 'later', householdId: 'A', onsetMs: 20 * 60000, completedAtMs: null, discovered: false }],
      households: [{ id: 'A', known: { receivedAtMs: 5 * 60000, needs: [] } }], commands: [], units: [] };
    const metrics = extractMetrics(state, { outcomes: [] }, {}, []);
    expect(metrics.waits.unmetSinceLatestHouseholdUpdateMinutes.samples).toBe(0);
    expect(metrics.waits).not.toHaveProperty('unmetReceivedMinutes');
  });
  it('labels a known need clock as latest household update, not first need receipt', () => {
    const state = { nowMs: 30 * 60000, missions: [], needs: [{ id: 'N', householdId: 'A', onsetMs: 10 * 60000, completedAtMs: null }],
      households: [{ id: 'A', known: { receivedAtMs: 25 * 60000, needs: [{ id: 'N' }] } }], commands: [], units: [] };
    expect(extractMetrics(state, { outcomes: [] }, {}, []).waits.unmetSinceLatestHouseholdUpdateMinutes.p95).toBe(5);
  });
  it('does not turn in-flight assignments or background actions into completed or direct work', () => {
    const summary = { households: 2, persons: 3, needs: 1, completedNeeds: 0, peopleHelped: 0, urgentNeeds: 1, timelyUrgent: 0,
      peopleWaiting: 2, uncheckedHomes: 2, cannotCallUncheckedHomes: 1, undiscoveredNeeds: 0, unmetNeedMinutes: 15,
      unsupportedHouseholds: 0, behavior: { directPersonaActors: 0, eligibleActors: 0, directActions: 0, suppressed: 0, fallback: 1, fallbackReasons: { 'no-prepared-artifact': 1 } } };
    const state = { nowMs: 30 * 60000, missions: [{ status: 'traveling', dispatchedAtMs: 25 * 60000, completedAtMs: null }],
      needs: [{ id: 'N1', householdId: 'A', onsetMs: 15 * 60000, completedAtMs: null }],
      households: [{ id: 'A', known: { receivedAtMs: 20 * 60000, needs: [{ id: 'N1' }] } }], commands: [{ accepted: true }], units: [{ status: 'available', busyMs: 0 }], events: [] };
    const metrics = extractMetrics(state, summary, { initial: 1, depotAvailable: 0, reserved: 1, loaded: 0, delivered: 0 }, []);
    expect(metrics.peopleHelped).toBe(0);
    expect(metrics.unfinishedMissions).toBe(1);
    expect(metrics.waits.unmetOnsetMinutes.p95).toBe(15);
    expect(metrics.waits.unmetSinceLatestHouseholdUpdateMinutes.p95).toBe(10);
    expect(metrics.behavior.directActions).toBe(0);
    expect(metrics.resources.supply.reserved).toBe(1);
  });
});
