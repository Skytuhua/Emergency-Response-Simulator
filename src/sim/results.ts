import type { CommandIntent, ObservationView, ObservedHousehold, RunSummary, Scenario, SimState, Unit } from '../model';
import { advanceMinute, dispatch, initialize } from './engine';
import { observe } from './observe';
import { shortestPath } from './routes';

export function summarize(state: SimState): RunSummary {
  const households = state.scenario.households.map(home => {
    const progress = state.households.find(h => h.householdId === home.id)!;
    return { householdId: home.id, size: home.size, need: structuredClone(home.need), accessible: home.accessible, contactedAt: progress.contactedAt, assessedAt: progress.assessedAt, completedAt: progress.completedAt, timely: home.need ? progress.completedAt !== null && progress.completedAt <= home.need.deadline : null, undiscovered: !!home.need && !progress.known };
  });
  const urgent = households.filter(h => h.need?.urgent);
  const timely = urgent.filter(h => h.timely).length;
  const contactCount = households.filter(h => h.contactedAt !== null).length;
  const assessmentCount = households.filter(h => h.assessedAt !== null).length;
  const unitBusyMinutes = state.units.reduce((sum, u) => sum + u.busyMinutes, 0);
  const assistedOverTime = Array.from({ length: state.minute + 1 }, (_, minute) => ({ minute, people: households.filter(h => h.completedAt !== null && h.completedAt <= minute).reduce((sum, h) => sum + h.size, 0) }));
  return {
    minute: state.minute, householdCount: households.length, population: households.reduce((sum, h) => sum + h.size, 0), contactCount, assessmentCount,
    contactCoverage: contactCount / households.length, assessmentCoverage: assessmentCount / households.length,
    timelyUrgentAssistance: urgent.length ? timely / urgent.length : null, urgentNeeds: urgent.length, timelyUrgentCount: timely,
    unmetUrgentNeedMinutes: urgent.reduce((sum, h) => sum + Math.min(h.completedAt ?? state.minute, state.minute, 60) - h.need!.onset, 0),
    stillUndiscovered: households.filter(h => h.undiscovered).length,
    assistanceCompleted: households.filter(h => h.need && h.completedAt !== null).length,
    totalNeeds: households.filter(h => h.need).length,
    peopleAssisted: households.filter(h => h.completedAt !== null).reduce((sum, h) => sum + h.size, 0),
    kitsConsumed: state.kits.consumed, shelterOccupancy: state.shelters.reduce((sum, s) => sum + s.occupied, 0), unitBusyMinutes,
    resourceUse: state.units.length && state.minute ? unitBusyMinutes / (state.units.length * state.minute) : 0,
    households, assistedOverTime,
  };
}
interface Choice { intent: CommandIntent; completion: number; home: ObservedHousehold }
function assistance(view: ObservationView, unit: Unit): Choice[] {
  const choices: Choice[] = [];
  for (const home of view.households.filter(h => h.known?.need && !h.missionId && h.completedAt === null)) {
    const known = home.known!;
    const route = shortestPath(view.map, unit.nodeId, home.nodeId);
    if (!route) continue;
    if (known.need!.kind === 'delivery' && unit.kind === 'crew' && view.kits.available > 0) choices.push({ intent: { action: 'DELIVER', unitId: unit.id, householdId: home.id }, completion: view.minute + route.minutes + 2, home });
    if (known.need!.kind === 'relocation' && unit.kind === 'van' && known.size <= unit.seats && (!known.accessible || unit.accessible)) {
      const shelters = view.shelters.filter(s => s.available >= known.size && (!known.accessible || s.accessible));
      for (const shelter of shelters) { const path = shortestPath(view.map, home.nodeId, shelter.nodeId); if (path) choices.push({ intent: { action: 'RELOCATE', unitId: unit.id, householdId: home.id, shelterId: shelter.id }, completion: view.minute + route.minutes + path.minutes + 4, home }); }
    }
  }
  return choices.sort((a, b) => Number(b.home.known!.need!.urgent) - Number(a.home.known!.need!.urgent) || a.home.known!.need!.deadline - b.home.known!.need!.deadline || a.completion - b.completion || a.home.id.localeCompare(b.home.id) || (a.intent.shelterId ?? '').localeCompare(b.intent.shelterId ?? ''));
}
/** No truth object is accepted here. Virtual reservations prevent a batch overbooking. */
export function chooseBaseline(input: ObservationView): CommandIntent[] {
  if (input.finalized) return [];
  const view = structuredClone(input);
  const intents: CommandIntent[] = [];
  for (const unit of view.units.filter(u => !u.missionId).sort((a, b) => a.id.localeCompare(b.id))) {
    let intent = assistance(view, unit)[0]?.intent;
    if (!intent) {
      const unknown = view.households.filter(h => !h.missionId && h.contactedAt === null);
      const candidates = unknown.length ? unknown : view.households.filter(h => !h.missionId && h.assessedAt === null && h.completedAt === null);
      const home = candidates.map(home => ({ home, route: shortestPath(view.map, unit.nodeId, home.nodeId) })).filter(x => x.route !== null).sort((a, b) => a.route!.minutes - b.route!.minutes || a.home.id.localeCompare(b.home.id))[0]?.home;
      if (home) intent = { action: 'ASSESS', unitId: unit.id, householdId: home.id };
    }
    if (!intent) continue;
    intents.push(intent); unit.missionId = 'policy-reserved';
    const home = view.households.find(h => h.id === intent.householdId)!; home.missionId = 'policy-reserved';
    if (intent.action === 'DELIVER') { view.kits.available--; view.kits.reserved++; }
    if (intent.action === 'RELOCATE') { const shelter = view.shelters.find(s => s.id === intent.shelterId)!; shelter.available -= home.known!.size; shelter.reserved += home.known!.size; }
  }
  return intents;
}
export function runBaseline(scenario: Scenario): SimState {
  let state = initialize(scenario, 'baseline');
  while (!state.finalized) {
    // Re-project after each accepted command before selecting another idle unit.
    for (const id of state.units.map(u => u.id).sort()) {
      const intent = chooseBaseline(observe(state)).find(i => i.unitId === id);
      if (!intent) continue;
      const result = dispatch(state, { ...intent, runId: state.runId, commandId: `B${state.commands.length + 1}`, sequence: state.commands.length + 1, minute: state.minute });
      state = result.state;
    }
    state = advanceMinute(state);
  }
  return state;
}
/** Executed authored witness, exposed separately from the observation-only policy. */
export function runDefaultWitness(scenario: Scenario): SimState {
  let state = initialize(scenario, 'default-witness');
  const schedule: { minute: number; intent: CommandIntent }[] = [
    { minute: 0, intent: { action: 'ASSESS', unitId: 'C1', householdId: 'H19' } },
    { minute: 0, intent: { action: 'ASSESS', unitId: 'V2', householdId: 'H09' } },
    { minute: 8, intent: { action: 'RELOCATE', unitId: 'V1', householdId: 'H19', shelterId: 'A' } },
    { minute: 8, intent: { action: 'ASSESS', unitId: 'C1', householdId: 'H02' } },
    { minute: 17, intent: { action: 'RELOCATE', unitId: 'V2', householdId: 'H09', shelterId: 'A' } },
    { minute: 24, intent: { action: 'RELOCATE', unitId: 'V1', householdId: 'H15', shelterId: 'B' } },
    { minute: 28, intent: { action: 'DELIVER', unitId: 'C1', householdId: 'H02' } },
    { minute: 30, intent: { action: 'DELIVER', unitId: 'C1', householdId: 'H05' } },
    { minute: 35, intent: { action: 'DELIVER', unitId: 'C1', householdId: 'H12' } },
  ];
  while (!state.finalized) {
    for (const item of schedule.filter(s => s.minute === state.minute)) {
      const applied = dispatch(state, { ...item.intent, runId: state.runId, commandId: `W${state.commands.length + 1}`, sequence: state.commands.length + 1, minute: state.minute });
      if (!applied.result.accepted) throw new Error(`Default witness failed at minute ${state.minute}: ${applied.result.reason}`);
      state = applied.state;
    }
    state = advanceMinute(state);
  }
  return state;
}
