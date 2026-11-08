import { describe, expect, it } from 'vitest';
import { changeEvent, mechanicsFixture, needEvent } from '../../fixtures/v2/mechanics/fixture';
import { MINUTE_MS as M } from '../../src/v2/contracts';
import { advanceWorld, assertWorldInvariants, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { observeCoordinator } from '../../src/v2/observe';
import { summarizeWorld } from '../../src/v2/summary';

function reported(bundle = mechanicsFixture()) { return advanceWorld(initializeWorld(bundle, 'resources'), 20 * M); }
describe('v2 mission-owned resources', () => {
  it('reserves the last kit atomically, loads for two minutes and consumes only after completed delivery', () => {
    const bundle = mechanicsFixture(); bundle.resources.supplyBundles = 1;
    bundle.assets.events = [needEvent('H1'), needEvent('H6')];
    let state = reported(bundle);
    const command = { id: 'delivery', sequence: 1, atMs: 20 * M, action: 'deliver' as const, unitId: 'C1', householdId: 'H1', needId: 'N-H1' };
    state = dispatchWorld(state, command).state;
    expect(observeCoordinator(state).supply).toEqual({ initial: 1, depotAvailable: 0, reserved: 1, loaded: 0, delivered: 0 });
    expect(dispatchWorld(state, command).state.commands).toHaveLength(1);
    const rejected = dispatchWorld(state, { ...command, id: 'contention', sequence: 2, unitId: 'C2', householdId: 'H6', needId: 'N-H6' });
    expect(rejected.result.accepted).toBe(false);
    state = advanceWorld(rejected.state, 22 * M);
    expect(observeCoordinator(state).supply.loaded).toBe(1);
    expect(observeCoordinator(state).units[0].carriedBundles).toBe(1);
    state = advanceWorld(state, 34 * M);
    expect(observeCoordinator(state).supply.delivered).toBe(1);
    expect(summarizeWorld(state).completedNeeds).toBe(1);
    expect(() => assertWorldInvariants(state)).not.toThrow();
  });
  it('preserves a loaded bundle on a stranded crew without completing delivery', () => {
    const bundle = mechanicsFixture(); bundle.assets.events = [needEvent(), changeEvent('close', 23 * M, { type: 'edge-state-change', edgeIds: ['BH'], closed: true })];
    let state = dispatchWorld(reported(bundle), { id: 'd', sequence: 1, atMs: 20 * M, action: 'deliver', unitId: 'C1', householdId: 'H1', needId: 'N-H1' }).state;
    state = advanceWorld(state, 360 * M);
    expect(observeCoordinator(state).units[0]).toMatchObject({ carriedBundles: 1, status: 'stranded' });
    expect(observeCoordinator(state).supply).toMatchObject({ loaded: 1, delivered: 0 });
    expect(summarizeWorld(state).peopleWaiting).toBe(2);
    assertWorldInvariants(state);
  });
  it('six people with one included accessible place fit while seven remain unsupported', () => {
    const bundle = mechanicsFixture(); bundle.assets.events = [needEvent('H6', 'relocation'), needEvent('H7', 'relocation')];
    let state = reported(bundle);
    const command = { id: 'six', sequence: 1, atMs: 20 * M, action: 'transport' as const, unitId: 'V1', householdId: 'H6', needId: 'N-H6', shelterId: 'SHELTER' };
    state = dispatchWorld(state, command).state;
    expect(observeCoordinator(state).facilities[1].reserved).toBe(6);
    expect(dispatchWorld(state, { ...command, id: 'seven', sequence: 2, unitId: 'V2', householdId: 'H7', needId: 'N-H7' }).result).toMatchObject({ accepted: false, reason: expect.stringContaining('unsupported') });
    state = advanceWorld(state, 44 * M);
    expect(observeCoordinator(state).facilities[1]).toMatchObject({ reserved: 0, occupied: 6, available: 144 });
    expect(observeCoordinator(state).units.find(unit => unit.id === 'V1')?.passengers).toBe(0);
    expect(summarizeWorld(state)).toMatchObject({ peopleHelped: 6, peopleWaiting: 7, unsupportedHouseholds: 1 });
    assertWorldInvariants(state);
  });
  it('retains boarded passengers and reserved seats when a shelter closes at dropoff completion', () => {
    const bundle = mechanicsFixture(); bundle.assets.events = [needEvent('H6', 'relocation'), changeEvent('shelter-close', 44 * M, { type: 'facility-state-change', facilityId: 'SHELTER', open: false }, 44 * M)];
    let state = dispatchWorld(reported(bundle), { id: 'six', sequence: 1, atMs: 20 * M, action: 'transport', unitId: 'V1', householdId: 'H6', needId: 'N-H6', shelterId: 'SHELTER' }).state;
    state = advanceWorld(state, 60 * M);
    expect(observeCoordinator(state).facilities[1]).toMatchObject({ open: false, reserved: 6, occupied: 0 });
    expect(observeCoordinator(state).units.find(unit => unit.id === 'V1')).toMatchObject({ passengers: 6, status: 'blocked' });
    expect(summarizeWorld(state).completedNeeds).toBe(0);
    assertWorldInvariants(state);
  });
  it('strands boarded passengers at the progressed occupied-edge cursor and retains their seats', () => {
    const bundle = mechanicsFixture(); bundle.assets.events = [needEvent('H6', 'relocation'),
      changeEvent('unsafe-occupied-transport', 33 * M, { type: 'edge-state-change', edgeIds: ['HS'], closed: true }),
      changeEvent('reopened-without-rescue', 35 * M, { type: 'edge-state-change', edgeIds: ['HS'], closed: false }, 35 * M)];
    let state = dispatchWorld(reported(bundle), { id: 'six', sequence: 1, atMs: 20 * M, action: 'transport', unitId: 'V1', householdId: 'H6', needId: 'N-H6', shelterId: 'SHELTER' }).state;
    state = advanceWorld(state, 360 * M);
    expect(observeCoordinator(state).units.find(unit => unit.id === 'V1')).toMatchObject({ passengers: 6, status: 'stranded',
      position: { x: 30, y: 0 }, cursor: { kind: 'edge', elapsedMs: M, durationMs: 2 * M } });
    expect(observeCoordinator(state).facilities[1]).toMatchObject({ reserved: 6, occupied: 0 });
    expect(summarizeWorld(state)).toMatchObject({ completedNeeds: 0, peopleWaiting: 6 });
    assertWorldInvariants(state);
  });
  it('reserves last shelter places atomically and keeps completed occupants after closure', () => {
    const bundle = mechanicsFixture(); bundle.assets.facilities[1].capacity = 6;
    bundle.assets.events = [needEvent('H6', 'relocation'), needEvent('H1', 'relocation'),
      changeEvent('closed-after-dropoff', 45 * M, { type: 'facility-state-change', facilityId: 'SHELTER', open: false }, 45 * M)];
    let state = reported(bundle);
    const first = { id: 'six', sequence: 1, atMs: 20 * M, action: 'transport' as const, unitId: 'V1', householdId: 'H6', needId: 'N-H6', shelterId: 'SHELTER' };
    state = dispatchWorld(state, first).state;
    const second = dispatchWorld(state, { ...first, id: 'two', sequence: 2, unitId: 'V2', householdId: 'H1', needId: 'N-H1' });
    expect(second.result).toMatchObject({ accepted: false, reason: expect.stringContaining('insufficient') });
    expect(observeCoordinator(second.state).facilities[1].reserved).toBe(6);
    state = advanceWorld(second.state, 46 * M);
    expect(observeCoordinator(state).facilities[1]).toMatchObject({ open: false, reserved: 0, occupied: 6, available: 0 });
    assertWorldInvariants(state);
  });
  it('retains a household requiring two accessible places as unmet and rejects missing support', () => {
    const bundle = mechanicsFixture(); bundle.assets.support[0].accessiblePlacesRequired = 2;
    bundle.assets.events = [needEvent('H1', 'relocation')];
    const state = reported(bundle);
    expect(dispatchWorld(state, { id: 'unsupported', sequence: 1, atMs: 20 * M, action: 'transport', unitId: 'V1', householdId: 'H1', needId: 'N-H1', shelterId: 'SHELTER' }).result.reason).toContain('unsupported');
    expect(summarizeWorld(state)).toMatchObject({ unsupportedHouseholds: 1, peopleWaiting: 2 });
    const incomplete = mechanicsFixture(); incomplete.assets.support = [];
    expect(() => initializeWorld(incomplete, 'missing')).toThrow('Missing support requirement');
  });
});
