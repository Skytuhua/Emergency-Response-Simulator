import { describe, expect, it } from 'vitest';
import { createScenario, DEFAULT_CONFIG, parseConfig } from '../src/scenario';
import { advanceMinute, dispatch, initialize } from '../src/sim/engine';
import { shortestPath, routePosition } from '../src/sim/routes';
import { observe } from '../src/sim/observe';
import { makeRunFile, parseRunFile, replay, MAX_RUN_BYTES } from '../src/run-file';
import { summarize } from '../src/sim/results';
import type { AgentArtifact, ScenarioConfig, SimState } from '../src/model';
import legacyArtifact from '../public/data/mirofish-v1.json';

const config: ScenarioConfig = { ...DEFAULT_CONFIG, template: 'storm-dallas-v1' };
const until = (initial: SimState, minute: number) => { let state = initial; while (state.minute < minute) state = advanceMinute(state); return state; };
const send = (state: SimState, action: 'ASSESS' | 'RELOCATE', unitId = 'C1', householdId = 'H19') => dispatch(state, { runId: state.runId, commandId: `c${state.commands.length + 1}`, sequence: state.commands.length + 1, minute: state.minute, action, unitId, householdId, ...(action === 'RELOCATE' ? { shelterId: 'A' } : {}) });

describe('frozen Dallas exercise and replay', () => {
  it('accepts only exact supported template strings', () => {
    expect(parseConfig(config).template).toBe('storm-dallas-v1');
    expect(() => parseConfig({ ...config, template: ['storm-dallas-v1'] })).toThrow('Unsupported');
    expect(() => parseConfig({ ...config, template: 'storm-dallas-v2' })).toThrow('Unsupported');
  });
  it('rejects the retained legacy preparation artifact for Dallas', () => {
    expect(legacyArtifact.template).toBe('storm-v1');
    expect(() => createScenario(config, legacyArtifact as AgentArtifact)).toThrow('template does not match');
  });
  it('uses real street references and fictional home labels with no hidden facts in observations', () => {
    const scenario = createScenario(config);
    expect(scenario.map.kind).toBe('osm-driving');
    expect(scenario.households).toHaveLength(24);
    expect(scenario.households.every(home => /^Demo home H\d\d on /.test(home.address))).toBe(true);
    expect(scenario.map.edges.every(edge => edge.osmWayId && edge.name && edge.geometry && edge.lengthMeters! > 0 && edge.durationMs! > 0)).toBe(true);
    const state = initialize(scenario, 'dallas');
    const before = observe(state);
    const changed = structuredClone(state);
    changed.scenario.households[18].need = null;
    expect(observe(changed)).toEqual(before);
    expect(before.households.every(home => home.known === null)).toBe(true);
    expect(JSON.stringify(before)).not.toContain('deadline');
    expect(createScenario(config)).toEqual(scenario);
  });
  it('finds all exercise placement routes and a closure changes a real route', () => {
    const open = createScenario(config), detour = createScenario({ ...config, roadPreset: 'detour' });
    const changed: boolean[] = [];
    for (const home of open.households) {
      const a = shortestPath(open.map, open.units[0].nodeId, home.nodeId)!;
      const b = shortestPath(detour.map, detour.units[0].nodeId, home.nodeId)!;
      expect(a).not.toBeNull(); expect(b).not.toBeNull();
      changed.push(JSON.stringify(a) !== JSON.stringify(b));
      for (const shelter of detour.shelters) {
        const openRoute = shortestPath(open.map, home.nodeId, shelter.nodeId), detourRoute = shortestPath(detour.map, home.nodeId, shelter.nodeId);
        expect(detourRoute).not.toBeNull();
        changed.push(JSON.stringify(openRoute) !== JSON.stringify(detourRoute));
      }
      expect(b.legs.every(leg => !detour.map.edges.find(edge => edge.id === leg.edgeId)!.closed)).toBe(true);
    }
    const closed = detour.map.edges.find(edge => edge.closed)!;
    expect(shortestPath(open.map, closed.from, closed.to)).not.toEqual(shortestPath(detour.map, closed.from, closed.to));
    expect(changed.some(Boolean)).toBe(true);
  });
  it('replays real geometry positions during travel, boarding, transport, and final state', () => {
    let state = initialize(createScenario(config), 'dallas-replay');
    state = send(state, 'ASSESS').state;
    const mission = state.missions[0];
    const checkReplay = (current: SimState) => {
      const restored = replay(parseRunFile(JSON.stringify(makeRunFile(current))));
      expect(restored.runId).not.toBe(current.runId);
      expect(summarize(restored)).toEqual(summarize(current));
      expect(restored.units).toEqual(current.units);
    };
    checkReplay(state);
    state = until(state, 1); checkReplay(state);
    expect(state.units[0]).toMatchObject(routePosition(state.scenario.map, mission.route, 1));
    state = until(state, mission.completionAt);
    state = send(state, 'RELOCATE', 'V1').state;
    const transport = state.missions[1];
    state = until(state, transport.arrivalAt); checkReplay(state);
    state = until(state, transport.pickupAt! + 1); checkReplay(state);
    state = until(state, 60); checkReplay(state);
    expect(state.shelters[0].occupied).toBe(2);
  });
  it('rejects changed geographic geometry and stays below fixed run limits with 500 commands', () => {
    let state = initialize(createScenario({ ...config, additionalNeeds: 9, kits: 6 }), 'r'.repeat(120));
    for (let index = 0; index < 500; index++) state = dispatch(state, {
      runId: state.runId, commandId: 'c'.repeat(117) + String(index).padStart(3, '0'), sequence: Number.MAX_SAFE_INTEGER - 499 + index,
      minute: 0, action: 'ASSESS', unitId: 'C1', householdId: 'H19', shelterId: 'B',
    }).state;
    const file = makeRunFile(state);
    expect(state.commands).toHaveLength(500);
    expect(new TextEncoder().encode(JSON.stringify(file, null, 2)).length).toBeLessThan(MAX_RUN_BYTES);
    const checkArrays = (value: unknown): void => {
      if (Array.isArray(value)) { expect(value.length).toBeLessThanOrEqual(5000); value.forEach(checkArrays); }
      else if (value && typeof value === 'object') Object.values(value).forEach(checkArrays);
    };
    checkArrays(file);
    const modified = structuredClone(file);
    modified.scenario.map.edges[0].geometry![0].x += 1;
    expect(() => parseRunFile(JSON.stringify(modified))).toThrow('initial conditions');
  });
});
