import { describe, expect, it } from 'vitest';
import type { AgentArtifact, Need, Scenario, SimState } from '../src/model';
import { createScenario, DALLAS_DEFAULT_CONFIG, DEFAULT_CONFIG } from '../src/scenario';
import { dispatch, initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { summarize } from '../src/sim/results';
import { chooseAutomaticIntent, explainAutomaticIntent, getAutomaticWaitingReason, getAutomaticCoordinationIssue, initializeAutomatic, advanceAutomaticMinute } from '../src/sim/automatic';
import { makeRunFile, parseRunFile, replay } from '../src/run-file';
import dallasArtifact from '../public/data/mirofish-dallas-v1.json';
import legacyRun from '../public/data/default-run.json';

function tinyScenario(): Scenario {
  const scenario = createScenario(DEFAULT_CONFIG);
  scenario.map = {
    width: 10, height: 10,
    nodes: ['base', 'h1', 'h2', 'h3', 'h4', 'sA', 'sB'].map((id, x) => ({ id, x, y: 0 })),
    edges: [
      { id: 'one', from: 'base', to: 'h1', minutes: 2 },
      { id: 'two', from: 'base', to: 'h2', minutes: 1 },
      { id: 'three', from: 'base', to: 'h3', minutes: 3 },
      { id: 'four', from: 'base', to: 'h4', minutes: 4 },
      { id: 'shelterA', from: 'h1', to: 'sA', minutes: 2 },
      { id: 'shelterB', from: 'h1', to: 'sB', minutes: 1 },
    ],
  };
  scenario.households = scenario.households.slice(0, 4).map((home, index) => ({
    ...home, id: `H0${index + 1}`, nodeId: `h${index + 1}`, x: index + 1, y: 0,
    neighborhood: index === 1 ? 'southeast' : 'northwest', size: 2, accessible: false, need: null,
  }));
  scenario.units = scenario.units.map(unit => ({ ...unit, nodeId: 'base', x: 0, y: 0 }));
  scenario.shelters = scenario.shelters.map((shelter, index) => ({ ...shelter, nodeId: index ? 'sB' : 'sA', capacity: 4, available: 4, reserved: 0, occupied: 0 }));
  scenario.reports = [];
  return scenario;
}

function publicNeed(scenario: Scenario, id: string, kind: Need['kind'] = 'relocation', options: { urgent?: boolean; deadline?: number; accessible?: boolean; size?: number; reportMinute?: number } = {}) {
  const home = scenario.households.find(home => home.id === id)!;
  home.need = { id: `N-${id}`, kind, urgent: options.urgent ?? true, onset: 0, deadline: options.deadline ?? 30 };
  home.accessible = options.accessible ?? false;
  home.size = options.size ?? 2;
  scenario.reports.push({ id: `R-${id}`, householdId: id, needId: home.need.id, attemptMinute: options.reportMinute ?? 0, source: 'rule-based' });
}

function untilAutomatic(initial: SimState, minute: number) {
  let state = initial;
  while (state.minute < minute) state = advanceAutomaticMinute(state);
  return state;
}

function conservation(state: SimState) {
  expect(state.kits.available + state.kits.reserved + state.kits.consumed).toBe(state.kits.initial);
  expect(Math.min(state.kits.available, state.kits.reserved, state.kits.consumed)).toBeGreaterThanOrEqual(0);
  for (const shelter of state.shelters) {
    expect(shelter.available + shelter.reserved + shelter.occupied).toBe(shelter.capacity);
    expect(Math.min(shelter.available, shelter.reserved, shelter.occupied)).toBeGreaterThanOrEqual(0);
  }
  const active = state.missions.filter(mission => mission.status !== 'completed');
  expect(new Set(active.map(mission => mission.unitId)).size).toBe(active.length);
  expect(new Set(active.map(mission => mission.householdId)).size).toBe(active.length);
}

describe('automatic public observation policy', () => {
  it('selects identical work when unobserved household truth changes and leaves the public input untouched', () => {
    const a = initialize(tinyScenario(), 'public-only');
    const b = structuredClone(a);
    b.scenario.households[1].need = { id: 'hidden', kind: 'relocation', urgent: true, onset: 0, deadline: 4 };
    b.scenario.households[1].size = 4;
    b.scenario.households[1].accessible = true;
    const view = observe(a), snapshot = structuredClone(view);
    expect(observe(b)).toEqual(view);
    expect(chooseAutomaticIntent(view)).toEqual({ action: 'ASSESS', householdId: 'H02', unitId: 'C1' });
    expect(chooseAutomaticIntent(observe(b))).toEqual(chooseAutomaticIntent(view));
    expect(explainAutomaticIntent(observe(b), chooseAutomaticIntent(view)!)).toEqual(explainAutomaticIntent(view, chooseAutomaticIntent(view)!));
    expect(view).toEqual(snapshot);
    expect(explainAutomaticIntent(view, chooseAutomaticIntent(view)!)).toMatch(/unknown/i);
    expect(explainAutomaticIntent(view, chooseAutomaticIntent(view)!)).toMatch(/communications unavailable/i);
    const alternative = structuredClone(a.scenario);
    alternative.households[1] = structuredClone(b.scenario.households[1]);
    let first = initializeAutomatic(a.scenario, 'hidden-independent');
    let second = initializeAutomatic(alternative, 'hidden-independent');
    expect(first.commands).toEqual(second.commands);
    // Neither need becomes public until the on-site check completes at minute 3.
    for (let minute = 1; minute <= 2; minute++) {
      first = advanceAutomaticMinute(first);
      second = advanceAutomaticMinute(second);
      expect(observe(first)).toEqual(observe(second));
      expect(first.commands).toEqual(second.commands);
    }
  });

  it('ranks feasible known urgent needs by earliest deadline ahead of nearer nonurgent work and unknown checks', () => {
    const scenario = tinyScenario();
    publicNeed(scenario, 'H01', 'relocation', { deadline: 20 });
    publicNeed(scenario, 'H03', 'relocation', { deadline: 10 });
    publicNeed(scenario, 'H04', 'delivery', { urgent: false, deadline: 5 });
    const view = observe(initialize(scenario, 'deadlines'));
    expect(chooseAutomaticIntent(view)).toEqual({ action: 'RELOCATE', householdId: 'H03', unitId: 'V1', shelterId: 'B' });
    view.households.find(home => home.id === 'H03')!.missionId = 'assigned';
    expect(chooseAutomaticIntent(view)?.householdId).toBe('H01');
    view.households.find(home => home.id === 'H01')!.missionId = 'assigned';
    expect(chooseAutomaticIntent(view)).toEqual({ action: 'DELIVER', householdId: 'H04', unitId: 'C1' });
    expect(explainAutomaticIntent(view, chooseAutomaticIntent(view)!)).toMatch(/known/i);
  });

  it('uses the earliest compatible arrival at an accessible shelter and respects both route legs', () => {
    const scenario = tinyScenario();
    publicNeed(scenario, 'H01', 'relocation', { accessible: true });
    scenario.units.find(unit => unit.id === 'V2')!.nodeId = 'h1';
    scenario.shelters.find(shelter => shelter.id === 'B')!.accessible = false;
    const view = observe(initialize(scenario, 'accessible'));
    expect(chooseAutomaticIntent(view)).toEqual({ action: 'RELOCATE', householdId: 'H01', unitId: 'V1', shelterId: 'A' });
    view.map.edges.find(edge => edge.id === 'shelterA')!.closed = true;
    expect(chooseAutomaticIntent(view)?.action).toBe('ASSESS');
    expect(chooseAutomaticIntent(view)?.householdId).toBe('H02');
    view.map.edges.find(edge => edge.id === 'two')!.closed = true;
    expect(chooseAutomaticIntent(view)?.householdId).not.toBe('H02');
  });

  it('uses stable unit, household and shelter identities when candidate arrays are reordered', () => {
    const scenario = tinyScenario();
    scenario.config.networkGap = 'none';
    publicNeed(scenario, 'H01');
    scenario.shelters[0].nodeId = scenario.shelters[1].nodeId;
    const view = observe(initialize(scenario, 'ties'));
    const expected = { action: 'RELOCATE', householdId: 'H01', unitId: 'V1', shelterId: 'A' };
    expect(chooseAutomaticIntent(view)).toEqual(expected);
    view.households.reverse(); view.units.reverse(); view.shelters.reverse();
    expect(chooseAutomaticIntent(view)).toEqual(expected);
  });

  it('honors public active missions even if a unit or home has a stale empty mission pointer', () => {
    const scenario = tinyScenario();
    publicNeed(scenario, 'H01', 'delivery');
    let state = initialize(scenario, 'public-occupancy');
    state = dispatch(state, { runId: state.runId, sequence: 1, commandId: 'manual', minute: 0, action: 'ASSESS', householdId: 'H02', unitId: 'C1' }).state;
    const view = observe(state);
    view.units.find(unit => unit.id === 'C1')!.missionId = null;
    view.households.find(home => home.id === 'H02')!.missionId = null;
    const next = chooseAutomaticIntent(view);
    expect(next?.unitId).not.toBe('C1');
    expect(next?.householdId).not.toBe('H02');
    expect(next?.action).toBe('ASSESS');
  });
});

describe('automatic engine coordinator', () => {
  it('dispatches all independent available teams immediately and never counts assignment as assistance', () => {
    const state = initializeAutomatic(tinyScenario(), 'automatic-start');
    expect(state.commands).toHaveLength(3);
    expect(state.commands.every(record => record.result.accepted)).toBe(true);
    expect(new Set(state.missions.map(mission => mission.unitId)).size).toBe(3);
    expect(new Set(state.missions.map(mission => mission.householdId)).size).toBe(3);
    expect(observe(state).assistedCount).toBe(0);
    expect(state.events.filter(event => event.type === 'dispatch').every(event => /unknown/i.test(event.message))).toBe(true);
    conservation(state);
  });

  it('publishes a due report and dispatches its feasible response at that same minute boundary', () => {
    const scenario = tinyScenario();
    scenario.households = scenario.households.slice(0, 1);
    publicNeed(scenario, 'H01', 'delivery', { reportMinute: 1 });
    scenario.units = scenario.units.filter(unit => unit.id === 'C1');
    let state = initialize(scenario, 'report-boundary');
    state = advanceAutomaticMinute(state);
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0].command).toMatchObject({ action: 'DELIVER', minute: 1, unitId: 'C1', householdId: 'H01' });
    expect(state.events.find(event => event.type === 'request')?.minute).toBe(1);
    expect(observe(state).assistedCount).toBe(0);
    state = untilAutomatic(state, 5);
    expect(observe(state).assistedCount).toBe(1);
  });

  it('reobserves after each reservation so two vans cannot overbook a shared shelter', () => {
    const scenario = tinyScenario();
    scenario.config.networkGap = 'none';
    publicNeed(scenario, 'H01', 'relocation', { size: 3 });
    publicNeed(scenario, 'H03', 'relocation', { size: 3 });
    scenario.shelters[0].available = scenario.shelters[0].capacity = 3;
    scenario.shelters[1].available = scenario.shelters[1].capacity = 0;
    const state = initializeAutomatic(scenario, 'contention');
    const relocations = state.commands.filter(record => record.command.action === 'RELOCATE');
    expect(relocations).toHaveLength(1);
    expect(state.shelters[0]).toMatchObject({ reserved: 3, available: 0, occupied: 0 });
    expect(state.commands.every(record => record.result.accepted)).toBe(true);
    conservation(state);
  });

  it('does not churn repeated assessment or rejected commands for exhausted resources or known no-need homes', () => {
    const scenario = tinyScenario();
    scenario.config.networkGap = 'none';
    publicNeed(scenario, 'H01', 'delivery');
    publicNeed(scenario, 'H03');
    scenario.kits = { initial: 0, available: 0, reserved: 0, consumed: 0 };
    scenario.shelters.forEach(shelter => { shelter.capacity = 0; shelter.available = 0; });
    const initial = initializeAutomatic(scenario, 'shortage');
    const view = observe(initial);
    expect(getAutomaticWaitingReason(view, 'H01')).toMatch(/kit/i);
    expect(getAutomaticWaitingReason(view, 'H03')).toMatch(/shelter|places/i);
    const state = untilAutomatic(initial, 60);
    expect(state.commands).toHaveLength(2);
    expect(state.commands.every(record => record.result.accepted && record.command.action === 'ASSESS')).toBe(true);
    expect(state.households.filter(home => home.assessedAt !== null)).toHaveLength(2);
    expect(observe(state).assistedCount).toBe(0);
    conservation(state);
  });

  it.each([
    { travel: 58, completedAt: 60, reserved: 0, consumed: 1 },
    { travel: 59, completedAt: null, reserved: 1, consumed: 0 },
  ])('includes minute60 completions and retains later reservations (travel $travel)', ({ travel, completedAt, reserved, consumed }) => {
    const scenario = tinyScenario();
    scenario.households = scenario.households.slice(0, 1);
    publicNeed(scenario, 'H01', 'delivery', { reportMinute: 0 });
    scenario.map.edges.find(edge => edge.id === 'one')!.minutes = travel;
    let state = initializeAutomatic(scenario, 'late');
    expect(state.commands).toHaveLength(1);
    state = untilAutomatic(state, 60);
    expect(state.kits).toEqual({ initial: 3, available: 2, reserved, consumed });
    expect(state.households[0].completedAt).toBe(completedAt);
    expect(advanceAutomaticMinute(state)).toBe(state);
    expect(chooseAutomaticIntent(observe(state))).toBeNull();
    conservation(state);
  });

  it('retains command-limit status and exact engine history through export and replay', () => {
    let state = initialize(createScenario(DEFAULT_CONFIG), 'full-log');
    for (let sequence = 1; sequence <= 500; sequence++) state = dispatch(state, {
      runId: state.runId, commandId: `manual-${sequence}`, sequence, minute: 0,
      action: 'ASSESS', unitId: 'C1', householdId: 'H01',
    }).state;
    state = untilAutomatic(state, 60);
    expect(state.commands).toHaveLength(500);
    // replay validates the serialized export itself; avoid validating 500 commands twice.
    const restored = replay(makeRunFile(state));
    expect(restored.events).toEqual(state.events);
    expect(getAutomaticCoordinationIssue(state)).toMatch(/command limit/i);
    expect(getAutomaticCoordinationIssue(restored)).toBe(getAutomaticCoordinationIssue(state));
    expect(state.minute).toBe(60);
    conservation(state);
  });

  it('continues with a short unique command identity when retained commands occupy its generated IDs', () => {
    let state = initialize(tinyScenario(), 'identity-collisions');
    for (let sequence = 1; sequence <= 56; sequence++) state = dispatch(state, {
      runId: state.runId, commandId: `AUTO-0057${'-a'.repeat(sequence - 1)}`, sequence, minute: 0,
      action: 'ASSESS', unitId: 'C1', householdId: 'H01',
    }).state;
    state = advanceAutomaticMinute(state);
    expect(state.commands.length).toBeGreaterThan(56);
    expect(state.commands[56].result.accepted).toBe(true);
    expect(state.commands[56].command.commandId.length).toBeLessThanOrEqual(120);
    expect(new Set(state.commands.map(record => record.command.commandId)).size).toBe(state.commands.length);
  });

  it('records stable commands and reproduces actual automatic Dallas outcomes through the existing run format', () => {
    const scenario = createScenario(DALLAS_DEFAULT_CONFIG, dallasArtifact as AgentArtifact);
    let a = initializeAutomatic(scenario, 'auto-dallas');
    let b = initializeAutomatic(scenario, 'auto-dallas');
    while (!a.finalized) {
      conservation(a);
      a = advanceAutomaticMinute(a);
      b = advanceAutomaticMinute(b);
    }
    conservation(a);
    expect(a).toEqual(b);
    expect(a.commands.length).toBeGreaterThan(3);
    expect(a.commands.length).toBeLessThan(100);
    expect(a.commands.every(record => record.result.accepted)).toBe(true);
    expect(new Set(a.commands.map(record => record.command.commandId)).size).toBe(a.commands.length);
    expect(a.commands.map(record => record.command.sequence)).toEqual(a.commands.map((_, index) => index + 1));
    const restored = replay(parseRunFile(JSON.stringify(makeRunFile(a))));
    expect(summarize(restored)).toEqual(summarize(a));
    expect(restored.missions).toEqual(a.missions);
    expect(restored.events).toEqual(a.events);
    expect(observe(a).assistedCount).toBe(a.events.filter(event => event.type === 'completion').length);
  }, 30_000);

  it('keeps the retained manual legacy 8/16/24 witness independent of automatic coordination', () => {
    const state = replay(parseRunFile(JSON.stringify(legacyRun)));
    expect(state.missions.find(mission => mission.action === 'ASSESS' && mission.householdId === 'H19')?.completionAt).toBe(8);
    expect(state.missions.find(mission => mission.action === 'RELOCATE' && mission.householdId === 'H19')).toMatchObject({ dispatchedAt: 8, pickupAt: 16, completionAt: 24 });
    expect(summarize(state).assistanceCompleted).toBe(6);
  });
});
