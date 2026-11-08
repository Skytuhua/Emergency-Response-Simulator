import { describe, expect, it } from 'vitest';
import { createScenario, DEFAULT_CONFIG } from '../src/scenario';
import { advanceMinute, dispatch, initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { summarize, chooseBaseline } from '../src/sim/results';
import type { Action, SimState } from '../src/model';

function send(s: SimState, action: Action, unitId: string, householdId: string, shelterId?: string, commandId = `c${s.commands.length + 1}`) {
  return dispatch(s, { runId: s.runId, minute: s.minute, sequence: s.commands.length + 1, commandId, action, unitId, householdId, ...(shelterId ? { shelterId } : {}) });
}
function until(s: SimState, minute: number) { while (s.minute < minute) s = advanceMinute(s); return s; }
const fresh = () => initialize(createScenario(DEFAULT_CONFIG, null), 'test');
describe('authoritative engine', () => {
  it('runs silent-household radio assessment, pickup and completed assistance at exactly 8/16/24', () => {
    let s = fresh();
    const before = observe(s).households.find(h => h.id === 'H19')!;
    expect(before.known).toBeNull();
    expect(JSON.stringify(before)).not.toContain('deadline');
    s = send(s, 'ASSESS', 'C1', 'H19').state;
    s = until(s, 7);
    expect(observe(s).households.find(h => h.id === 'H19')?.known).toBeNull();
    s = until(s, 8);
    expect(observe(s).households.find(h => h.id === 'H19')?.known).toMatchObject({ source: 'assessment', observedAt: 8, receivedAt: 8, size: 2, accessible: true, need: { kind: 'relocation', deadline: 30 } });
    const dispatched = send(s, 'RELOCATE', 'V1', 'H19', 'A');
    expect(dispatched.result.accepted).toBe(true);
    s = dispatched.state;
    expect(s.shelters[0]).toMatchObject({ reserved: 2, occupied: 0, available: 6 });
    s = until(s, 16);
    expect(s.units.find(u => u.id === 'V1')?.passengers).toBe(2);
    expect(s.households.find(h => h.householdId === 'H19')?.completedAt).toBeNull();
    s = until(s, 24);
    expect(s.shelters[0]).toMatchObject({ reserved: 0, occupied: 2, available: 6 });
    expect(s.units.find(u => u.id === 'V1')?.passengers).toBe(0);
    expect(summarize(s).households.find(h => h.householdId === 'H19')).toMatchObject({ completedAt: 24, timely: true });
  });
  it('unknown assistance reasons cannot reveal need type and baseline sees the same view', () => {
    const a = fresh(); const b = structuredClone(a);
    b.scenario.households.find(h => h.id === 'H19')!.need = null;
    expect(observe(a)).toEqual(observe(b));
    expect(chooseBaseline(observe(a))).toEqual(chooseBaseline(observe(b)));
    expect(send(a, 'DELIVER', 'C1', 'H19').result.reason).toBe('Assess or receive a request first.');
    expect(send(b, 'DELIVER', 'C1', 'H19').result).toEqual(send(a, 'DELIVER', 'C1', 'H19').result);
  });
  it('rejects duplicate household work, conflict IDs and stale runs without consuming resources', () => {
    const initial = fresh();
    const first = send(initial, 'ASSESS', 'C1', 'H19');
    const command = first.state.commands[0].command;
    const repeat = dispatch(first.state, command);
    expect(repeat.state).toBe(first.state); expect(repeat.result).toEqual(first.result);
    const conflict = dispatch(first.state, { ...command, householdId: 'H18' });
    expect(conflict.result.accepted).toBe(false); expect(conflict.state).toBe(first.state);
    expect(send(first.state, 'ASSESS', 'V1', 'H19').result.accepted).toBe(false);
    const stale = dispatch(first.state, { ...command, commandId: 'stale', runId: 'old' });
    expect(stale.state).toBe(first.state); expect(stale.result.accepted).toBe(false);
    expect(initial.minute).toBe(0); expect(initial.missions).toHaveLength(0);
  });
  it('reserves kits once and keeps conservation through delivery', () => {
    let s = until(fresh(), 10);
    s = send(s, 'DELIVER', 'C1', 'H02').state;
    expect(s.kits).toEqual({ initial: 3, available: 2, reserved: 1, consumed: 0 });
    s = until(s, s.missions[0].completionAt);
    expect(s.kits).toEqual({ initial: 3, available: 2, reserved: 0, consumed: 1 });
  });
  it('shelter contention is atomic and accessible needs require compatible transport', () => {
    let s = initialize(createScenario({ ...DEFAULT_CONFIG, shelterA: 3, shelterB: 0, networkGap: 'none' }, null), 'capacity');
    s = until(s, 10);
    expect(send(s, 'RELOCATE', 'V2', 'H19', 'A').result.accepted).toBe(false);
    const first = send(s, 'RELOCATE', 'V2', 'H09', 'A');
    expect(first.result.accepted).toBe(true);
    const second = send(first.state, 'RELOCATE', 'V1', 'H19', 'A');
    expect(second.result.accepted).toBe(false);
    expect(second.state.shelters[0]).toMatchObject({ available: 0, reserved: 3, occupied: 0 });
  });
  it('minute60 completions count and later missions keep their reservations onboard', () => {
    let s = until(fresh(), 46);
    s = send(s, 'DELIVER', 'C1', 'H02').state;
    expect(s.missions[0].completionAt).toBe(60);
    s = until(s, 60);
    expect(s.finalized).toBe(true); expect(s.kits.consumed).toBe(1);
    expect(send(s, 'ASSESS', 'V1', 'H01').result.accepted).toBe(false);
    expect(advanceMinute(s)).toBe(s);
    let late = initialize(createScenario({ ...DEFAULT_CONFIG, networkGap: 'none' }, null), 'late');
    late = until(late, 50); late = send(late, 'RELOCATE', 'V1', 'H19', 'A').state; late = until(late, 60);
    expect(late.units.find(u => u.id === 'V1')?.passengers).toBe(2);
    expect(late.shelters[0].reserved).toBe(2);
    expect(late.households.find(h => h.householdId === 'H19')?.completedAt).toBeNull();
  });
  it('one-minute travel plus service takes3 and zero-distance service takes2', () => {
    const scenario = createScenario(DEFAULT_CONFIG, null);
    scenario.map.edges.forEach(e => { e.minutes = 1; });
    const home = scenario.households.find(h => h.id === 'H19')!;
    scenario.units[0].nodeId = 'g2-4';
    let s = initialize(scenario, 'travel');
    s = send(s, 'ASSESS', 'C1', 'H19').state;
    expect(s.missions[0].completionAt).toBe(3);
    s = until(s, 3);
    expect(s.units[0].nodeId).toBe(home.nodeId);
    s = send(s, 'ASSESS', 'C1', 'H19').state;
    expect(s.missions[1].completionAt).toBe(5);
  });
  it('completion suppresses a due report at the same minute', () => {
    const scenario = createScenario({ ...DEFAULT_CONFIG, networkGap: 'none' }, null);
    scenario.reports.find(r => r.householdId === 'H02')!.attemptMinute = 16;
    let s = initialize(scenario, 'ordering');
    s = send(s, 'ASSESS', 'C1', 'H02').state; s = until(s, 14);
    s = send(s, 'DELIVER', 'C1', 'H02').state; s = until(s, 16);
    expect(s.events.filter(e => e.type === 'request' && e.householdId === 'H02')).toHaveLength(0);
    expect(s.kits.consumed).toBe(1);
  });
  it('bounds unique command logs at500 while preserving idempotent repeats and clock advancement', () => {
    let s = fresh();
    s = send(s, 'ASSESS', 'C1', 'H19').state;
    for (let i = 1; i < 500; i++) s = send(s, 'ASSESS', 'C1', 'H19').state;
    expect(s.commands).toHaveLength(500);
    const capped = send(s, 'ASSESS', 'V1', 'H01');
    expect(capped.result.reason).toContain('500-command'); expect(capped.state).toBe(s);
    expect(dispatch(s, s.commands[0].command).result.accepted).toBe(true);
    expect(advanceMinute(s).minute).toBe(1);
  });
  it('rejects dangling and duplicate scenario references before starting', () => {
    const scenario = createScenario(DEFAULT_CONFIG, null);
    scenario.households[0].nodeId = 'not-a-node';
    expect(() => initialize(scenario, 'bad')).toThrow();
    const duplicate = createScenario(DEFAULT_CONFIG, null);
    duplicate.map.nodes[0].id = duplicate.map.nodes[1].id;
    expect(() => initialize(duplicate, 'bad')).toThrow();
    const units = createScenario(DEFAULT_CONFIG, null);
    units.units[1].id = units.units[0].id;
    expect(() => initialize(units, 'bad')).toThrow();
  });
  it('retains first assessment time when a home is checked again', () => {
    let s = fresh(); s = send(s, 'ASSESS', 'C1', 'H19').state; s = until(s, 8);
    s = send(s, 'ASSESS', 'C1', 'H19').state; s = until(s, 10);
    expect(s.households.find(h => h.householdId === 'H19')?.assessedAt).toBe(8);
    expect(s.households.find(h => h.householdId === 'H19')?.known?.observedAt).toBe(10);
  });
});
