import { describe, expect, it } from 'vitest';
import { changeEvent, mechanicsFixture, needEvent } from '../../fixtures/v2/mechanics/fixture';
import { HORIZON_MS, MINUTE_MS as M } from '../../src/v2/contracts';
import { advanceWorld, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { observeCoordinator, observeSnapshot } from '../../src/v2/observe';
import { summarizeWorld } from '../../src/v2/summary';

describe('v2 world chronology and knowledge', () => {
  it('private unused closures cannot shift public evidence identifiers', () => {
    const a=mechanicsFixture(),b=mechanicsFixture();
    b.assets.events=[changeEvent('unseen',0,{type:'edge-state-change',edgeIds:['HS'],closed:true})];
    const check=(bundle:typeof a)=>advanceWorld(dispatchWorld(initializeWorld(bundle,'public-identity'),{id:'same-check',sequence:1,atMs:0,action:'check',unitId:'C1',householdId:'H1'}).state,12*M);
    expect(observeCoordinator(check(a))).toEqual(observeCoordinator(check(b)));
  });
  it('completed mission estimates stay at their actual completion when time advances', () => {
    let state=dispatchWorld(initializeWorld(mechanicsFixture(),'stable-completion'),{id:'check',sequence:1,atMs:0,action:'check',unitId:'C1',householdId:'H1'}).state;
    state=advanceWorld(state,12*M);
    const completed=state.missions[0].completedAtMs;
    expect(completed).toBe(12*M);
    state=advanceWorld(state,20*M);
    expect(state.missions[0].estimatedCompletionAtMs).toBe(completed);
  });
  it('runs the actual 360-minute clock and refuses cutoff assignments', () => {
    const state = advanceWorld(initializeWorld(mechanicsFixture(), 'clock'), HORIZON_MS);
    expect(state.nowMs).toBe(360 * M);
    expect(state.finalized).toBe(true);
    expect(observeSnapshot(state).summary?.households).toBe(4);
    expect(dispatchWorld(state, { id: 'late', sequence: 1, atMs: HORIZON_MS, action: 'check', unitId: 'C1', householdId: 'H1' }).result.accepted).toBe(false);
  });
  it('a clean early check does not suppress a later need and its failed/retried report', () => {
    const bundle = mechanicsFixture();
    bundle.assets.events = [needEvent('H1', 'delivery', 60 * M),
      changeEvent('offline', 60 * M, { type: 'communications-change', householdIds: ['H1'], available: false }),
      changeEvent('online', 110 * M, { type: 'communications-change', householdIds: ['H1'], available: true })];
    let state = initializeWorld(bundle, 'later');
    state = dispatchWorld(state, { id: 'early-check', sequence: 1, atMs: 0, action: 'check', unitId: 'C1', householdId: 'H1' }).state;
    state = advanceWorld(state, 12 * M);
    expect(observeCoordinator(state).households[0].known?.needs).toEqual([]);
    state = advanceWorld(state, 80 * M);
    expect(state.events.filter(event => event.type === 'report-failed').map(event => event.atMs)).toEqual([80 * M]);
    expect(observeCoordinator(state).households[0].known?.needs).toEqual([]);
    state = advanceWorld(state, 110 * M);
    expect(observeCoordinator(state).households[0].known?.needs.map(need => need.id)).toEqual(['N-H1']);
    expect(state.events.filter(event => event.type === 'report-received').map(event => event.atMs)).toEqual([110 * M]);
    expect(summarizeWorld(state).needs).toBe(1);
  });
  it('does not leak future needs, supports, private closures or mutable state in coordinator DTOs', () => {
    const a = mechanicsFixture(), b = mechanicsFixture();
    b.assets.events = [needEvent('H7', 'relocation', 60 * M), changeEvent('hidden-close', 0, { type: 'edge-state-change', edgeIds: ['BH'], closed: true })];
    b.assets.support[0].accessiblePlacesRequired = 4;
    const stateA = initializeWorld(a, 'a'), stateB = initializeWorld(b, 'b');
    expect(observeCoordinator(stateA)).toEqual(observeCoordinator(stateB));
    const publicState = observeCoordinator(stateB);
    expect(JSON.stringify(publicState)).not.toContain('hidden-close');
    publicState.households[0].position.x = 999;
    expect(observeCoordinator(stateB).households[0].position.x).toBe(20);
    expect(publicState.map.edges.every(edge => edge.closed === undefined)).toBe(true);
  });
  it('ignores old completion estimates after an occupied road closes and reopens', () => {
    const bundle = mechanicsFixture();
    bundle.assets.events = [changeEvent('close', M, { type: 'edge-state-change', edgeIds: ['BH'], closed: true }), changeEvent('reopen', 3 * M, { type: 'edge-state-change', edgeIds: ['BH'], closed: false })];
    let state = dispatchWorld(initializeWorld(bundle, 'strand'), { id: 'check', sequence: 1, atMs: 0, action: 'check', unitId: 'C1', householdId: 'H1' }).state;
    state = advanceWorld(state, 20 * M);
    const unit = observeCoordinator(state).units[0];
    expect(unit.status).toBe('stranded');
    expect(unit.cursor).toMatchObject({ kind: 'edge', elapsedMs: M, durationMs: 2 * M });
    expect(unit.position.x).toBe(10);
    expect(observeCoordinator(state).missions[0].completedAtMs).toBeNull();
    expect(summarizeWorld(state).uncheckedHomes).toBe(4);
  });
  it('applies a closure at exact edge arrival before safe completion', () => {
    const bundle = mechanicsFixture();
    bundle.assets.events = [changeEvent('close-at-arrival', 2 * M, { type: 'edge-state-change', edgeIds: ['BH'], closed: true })];
    let state = dispatchWorld(initializeWorld(bundle, 'tie'), { id: 'check', sequence: 1, atMs: 0, action: 'check', unitId: 'C1', householdId: 'H1' }).state;
    state = advanceWorld(state, 12 * M);
    expect(observeCoordinator(state).units[0].cursor).toMatchObject({ kind: 'edge', elapsedMs: 2 * M });
    expect(observeCoordinator(state).units[0].status).toBe('stranded');
    expect(observeCoordinator(state).households[0].lastCheckAtMs).toBeNull();
  });
  it('reconciles all occupied-edge interruptions before any same-time service completions', () => {
    const bundle = mechanicsFixture();
    bundle.assets.events = [changeEvent('close-before-all-completions', 12 * M, { type: 'edge-state-change', edgeIds: ['BH'], closed: true })];
    let state = dispatchWorld(initializeWorld(bundle, 'phases'), { id: 'first', sequence: 1, atMs: 0, action: 'check', unitId: 'C1', householdId: 'H1' }).state;
    state = advanceWorld(state, 11 * M);
    state = dispatchWorld(state, { id: 'second', sequence: 2, atMs: 11 * M, action: 'check', unitId: 'C2', householdId: 'H6' }).state;
    state = advanceWorld(state, 12 * M);
    const simultaneous = state.events.filter(event => event.atMs === 12 * M);
    expect(simultaneous.findIndex(event => event.type === 'mission-stranded')).toBeLessThan(simultaneous.findIndex(event => event.type === 'mission-completed'));
  });
  it('produces identical physical state and trace whether advancing by minutes or directly', () => {
    const bundle = mechanicsFixture();
    bundle.assets.events = [needEvent('H1', 'delivery', 60 * M), changeEvent('offline', 60 * M, { type: 'communications-change', householdIds: ['H1'], available: false }),
      changeEvent('online', 110 * M, { type: 'communications-change', householdIds: ['H1'], available: true })];
    const initial = initializeWorld(bundle, 'integration-equivalence');
    let stepped = initial;
    for (let minute = 1; minute <= 360; minute++) stepped = advanceWorld(stepped);
    expect(stepped).toEqual(advanceWorld(initial, HORIZON_MS));
  });
  it('completes actual safe service at minute 360 before finalization', () => {
    let state = advanceWorld(initializeWorld(mechanicsFixture(), 'cutoff-completion'), 348 * M);
    state = dispatchWorld(state, { id: 'last-safe-check', sequence: 1, atMs: 348 * M, action: 'check', unitId: 'C1', householdId: 'H1' }).state;
    state = advanceWorld(state, HORIZON_MS);
    expect(observeCoordinator(state).missions[0].completedAtMs).toBe(HORIZON_MS);
    expect(observeCoordinator(state).households[0].lastCheckAtMs).toBe(HORIZON_MS);
    expect(state.finalized).toBe(true);
  });
});
