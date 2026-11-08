import { describe, expect, it } from 'vitest';
import { createScenario, DEFAULT_CONFIG } from '../src/scenario';
import { advanceMinute, dispatch, initialize } from '../src/sim/engine';
import { summarize, runBaseline, runDefaultWitness } from '../src/sim/results';

describe('computed outcomes and policy', () => {
  it('completes every default need with an executed response witness', () => {
    const s = runDefaultWitness(createScenario(DEFAULT_CONFIG, null));
    const summary = summarize(s);
    expect(s.minute).toBe(60);
    expect(summary.assistanceCompleted).toBe(6);
    expect(summary.timelyUrgentCount).toBe(3);
    expect(summary.kitsConsumed).toBe(3);
    expect(summary.shelterOccupancy).toBe(9);
    expect(summary.households.find(h => h.householdId === 'H19')?.completedAt).toBe(24);
    expect(s.commands.every(c => c.result.accepted)).toBe(true);
  });
  it('uses identical cloned initial conditions and makes deterministic public-only baseline choices', () => {
    const scenario = createScenario(DEFAULT_CONFIG, null);
    const pristine = structuredClone(scenario);
    const first = runBaseline(scenario); const second = runBaseline(scenario);
    expect(summarize(first)).toEqual(summarize(second));
    expect(scenario).toEqual(pristine);
    expect(first.commands.length).toBeGreaterThan(0);
    expect(first.commands.every(c => c.result.accepted)).toBe(true);
    for (const shelter of first.shelters) expect(shelter.available + shelter.reserved + shelter.occupied).toBe(shelter.capacity);
  });
  it('computes no-action losses and honest ties instead of fixed improvement values', () => {
    let idle = initialize(createScenario(DEFAULT_CONFIG, null), 'idle');
    while (idle.minute < 60) idle = advanceMinute(idle);
    const result = summarize(idle); const baseline = summarize(runBaseline(idle.scenario));
    expect(result.assistanceCompleted).toBe(0);
    expect(result.timelyUrgentAssistance).toBe(0);
    expect(result.unmetUrgentNeedMinutes).toBe(180);
    expect(baseline.assistanceCompleted).toBeGreaterThan(result.assistanceCompleted);
    expect(summarize(runBaseline(idle.scenario))).toEqual(baseline);
  });
  it('conserves all scarce resources across seeds, shortages and both road presets', () => {
    for (const seed of [0, 42, 4294967295]) for (const roadPreset of ['open', 'detour'] as const) {
      const scenario = createScenario({ ...DEFAULT_CONFIG, seed, roadPreset, additionalNeeds: 9, kits: 1, shelterA: 2, shelterB: 3 }, null);
      const result = runBaseline(scenario);
      expect(result.kits.available + result.kits.reserved + result.kits.consumed).toBe(1);
      expect(Math.min(result.kits.available, result.kits.reserved, result.kits.consumed)).toBeGreaterThanOrEqual(0);
      for (const shelter of result.shelters) {
        expect(shelter.available + shelter.reserved + shelter.occupied).toBe(shelter.capacity);
        expect(Math.min(shelter.available, shelter.reserved, shelter.occupied)).toBeGreaterThanOrEqual(0);
      }
      const active = result.missions.filter(m => m.status !== 'completed');
      expect(new Set(active.map(m => m.householdId)).size).toBe(active.length);
      expect(new Set(active.map(m => m.unitId)).size).toBe(active.length);
    }
  });
});
