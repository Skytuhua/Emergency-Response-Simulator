import { describe, expect, it } from 'vitest';
import { changeEvent, mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { MINUTE_MS as M } from '../../src/v2/contracts';
import { planRouteV2 } from '../../src/v2/routes';
import { advanceWorld, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { observeCoordinator } from '../../src/v2/observe';

describe('v2 directed movement', () => {
  it('plans across a pickup waypoint using an alternate legal arrival orientation', () => {
    const map = mechanicsFixture().assets.map;
    map.restrictions = [{ id: 'no-short-arrival-to-shelter', viaNodeId: 'H', fromWayId: 1, toWayId: 4, kind: 'no', maneuver: 'no_right_turn' },
      { id: 'no-short-u-turn', viaNodeId: 'H', fromWayId: 1, toWayId: 1, kind: 'no', maneuver: 'no_u_turn' },
      { id: 'no-short-to-detour', viaNodeId: 'H', fromWayId: 1, toWayId: 3, kind: 'no', maneuver: 'no_left_turn' }];
    const route = planRouteV2(map, { nodeId: 'B', incoming: null }, ['H', 'S']);
    expect(route?.legs.map(leg => leg.edgeId)).toEqual(['BX', 'XH', 'HS']);
    expect(route?.durationMs).toBe(5 * M);
  });
  it('retains the incoming arc across a ten-minute check and a new assignment', () => {
    const bundle = mechanicsFixture();
    bundle.assets.map.restrictions = [{ id: 'no-u-turn', viaNodeId: 'H', fromWayId: 1, toWayId: 1, kind: 'no', maneuver: 'no_u_turn' }];
    let state = dispatchWorld(initializeWorld(bundle, 'dwell'), { id: 'c1', sequence: 1, atMs: 0, action: 'check', unitId: 'C1', householdId: 'H1' }).state;
    state = advanceWorld(state, 12 * M);
    expect(observeCoordinator(state).units[0].cursor).toMatchObject({ kind: 'node', nodeId: 'H', incoming: { edgeId: 'BH', fromNodeId: 'B', toNodeId: 'H' } });
    const route = planRouteV2(bundle.assets.map, observeCoordinator(state).units[0].cursor as { kind: 'node'; nodeId: string; incoming: null }, ['B']);
    expect(route?.legs.map(leg => leg.edgeId)).toEqual(['XH', 'BX']);
  });
  it('accepts the same command with an unknown closure, then discovers it at edge entry and reroutes', () => {
    const open = mechanicsFixture(), closed = mechanicsFixture();
    closed.assets.events = [changeEvent('unknown', 0, { type: 'edge-state-change', edgeIds: ['BH'], closed: true })];
    const command = { id: 'c', sequence: 1, atMs: 0, action: 'check' as const, unitId: 'C1', householdId: 'H1' };
    const a = dispatchWorld(initializeWorld(open, 'open'), command), b = dispatchWorld(initializeWorld(closed, 'closed'), command);
    expect(a.result).toEqual(b.result);
    const state = advanceWorld(b.state, 13 * M);
    expect(observeCoordinator(state).knownClosedEdgeIds).toEqual(['BH']);
    expect(observeCoordinator(state).missions[0].completedAtMs).toBe(13 * M);
    expect(state.events.find(event => event.type === 'closure-encountered')?.atMs).toBe(0);
  });
  it('uses direction restrictions rather than treating a street as undirected', () => {
    const map = mechanicsFixture().assets.map;
    map.edges = [map.edges[0]];
    map.edges[0].direction = 'forward';
    expect(planRouteV2(map, { nodeId: 'H', incoming: null }, ['B'])).toBeNull();
  });
  it('uses Unicode code-point order for stable equal-cost route ties', () => {
    const map = mechanicsFixture().assets.map;
    map.edges = [{ ...map.edges[0], id: '\u{10000}' }, { ...map.edges[0], id: '\uE000' }];
    expect(planRouteV2(map, { nodeId: 'B', incoming: null }, ['H'])?.legs[0].edgeId).toBe('\uE000');
  });
  it('preserves pickup arrival restrictions during real boarding and onward travel', () => {
    const bundle = mechanicsFixture();
    bundle.assets.events = [{ id: 'need', effectiveAtMs: 0, observedAtMs: 0, sourceClass: 'assumed', sourceRef: 'fixture',
      payload: { type: 'need-onset', need: { id: 'N', householdId: 'H1', kind: 'relocation', urgent: true, onsetMs: 0, deadlineMs: 90 * M } } }];
    bundle.assets.map.restrictions = [{ id: 'arrival-only', viaNodeId: 'H', fromWayId: 1, toWayId: 1, kind: 'only', maneuver: 'only_u_turn' }];
    let state = dispatchWorld(initializeWorld(bundle, 'pickup'), { id: 'pickup', sequence: 1, atMs: 0, action: 'transport', unitId: 'V1', householdId: 'H1', needId: 'N', shelterId: 'SHELTER' }).state;
    state = advanceWorld(state, 12 * M);
    expect(observeCoordinator(state).units.find(item => item.id === 'V1')?.cursor).toMatchObject({ kind: 'node', nodeId: 'H', incoming: { edgeId: 'XH', fromNodeId: 'X', toNodeId: 'H' } });
    state = advanceWorld(state, 13 * M);
    const unit = observeCoordinator(state).units.find(item => item.id === 'V1')!;
    expect(unit.passengers).toBe(2);
    expect(unit.cursor).toMatchObject({ kind: 'edge', arc: { edgeId: 'HS', fromNodeId: 'H', toNodeId: 'S' } });
  });
});
