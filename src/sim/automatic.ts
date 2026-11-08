import type { CommandIntent, ObservationView, ObservedHousehold, Scenario, SimState } from '../model';
import { getBlockedReason, getPrimaryAction, getSuggestedAssignment } from '../ui/suggestions';
import { advanceMinute, dispatch, initialize } from './engine';
import { observe } from './observe';
import { shortestPath } from './routes';
import { publicDispatchContext } from './decision-evidence';

function completionMinute(view: ObservationView, intent: CommandIntent): number {
  const home = view.households.find(home => home.id === intent.householdId)!;
  const unit = view.units.find(unit => unit.id === intent.unitId)!;
  const route = shortestPath(view.map, unit.nodeId, home.nodeId);
  if (!route) return Infinity;
  if (intent.action !== 'RELOCATE') return view.minute + route.minutes + 2;
  const shelter = view.shelters.find(shelter => shelter.id === intent.shelterId);
  const onward = shelter && shortestPath(view.map, home.nodeId, shelter.nodeId);
  return onward ? view.minute + route.minutes + onward.minutes + 4 : Infinity;
}

interface Candidate { home: ObservedHousehold; intent: CommandIntent; completion: number }
const compareIdentity = (a: Candidate, b: Candidate) => a.home.id.localeCompare(b.home.id)
  || a.intent.unitId.localeCompare(b.intent.unitId) || (a.intent.shelterId ?? '').localeCompare(b.intent.shelterId ?? '');

/** Policy receives public observations only. Unknown homes have no inferred need or deadline. */
export function chooseAutomaticIntent(view: ObservationView): CommandIntent | null {
  if (view.finalized) return null;
  const assistance: Candidate[] = [], checks: Candidate[] = [];
  for (const home of view.households) {
    const action = getPrimaryAction(home);
    if (!action) continue;
    const intent = getSuggestedAssignment(view, home.id, action);
    if (!intent) continue;
    const candidate = { home, intent, completion: completionMinute(view, intent) };
    if (home.known?.need) assistance.push(candidate);
    else if (!home.known) checks.push(candidate);
  }
  assistance.sort((a, b) => Number(b.home.known!.need!.urgent) - Number(a.home.known!.need!.urgent)
    || a.home.known!.need!.deadline - b.home.known!.need!.deadline || a.completion - b.completion || compareIdentity(a, b));
  if (assistance.length) return assistance[0].intent;
  checks.sort((a, b) => Number(a.home.communications) - Number(b.home.communications)
    || a.completion - b.completion || compareIdentity(a, b));
  return checks[0]?.intent ?? null;
}

/** Public decision evidence; this is a deterministic scheduling rule, not model triage. */
export function explainAutomaticIntent(view: ObservationView, intent: CommandIntent): string {
  const blocked = getBlockedReason(view, intent.householdId, intent.action, intent.unitId, intent.shelterId);
  if (blocked) return blocked;
  const home = view.households.find(home => home.id === intent.householdId)!;
  const completion = completionMinute(view, intent);
  return publicDispatchContext(home, intent.action, completion);
}

/** Explain waiting using only visible resources, routes, assignments and known facts. */
export function getAutomaticWaitingReason(view: ObservationView, householdId: string): string | null {
  const home = view.households.find(home => home.id === householdId);
  if (!home) return null;
  if (home.completedAt !== null) return 'Assistance completed.';
  const mission = view.missions.find(mission => mission.householdId === home.id && mission.status !== 'completed');
  if (mission) return `${mission.action === 'ASSESS' ? 'On-site check' : 'Assistance'} in progress; expected completion minute ${mission.completionAt}.`;
  if (home.missionId) return 'A team is already assigned to this home.';
  if (view.finalized) return home.known?.need ? 'Simulation ended before assistance completed.' : home.known ? 'No current assistance need was observed.' : 'Simulation ended before this home was checked.';
  const action = getPrimaryAction(home);
  if (!action) return 'No current assistance need was observed.';
  if (getSuggestedAssignment(view, home.id, action)) return home.known ? 'Known need is waiting for automatic assignment.' : 'Needs unknown; waiting for an on-site check.';
  if (action === 'DELIVER' && view.kits.available < 1) return 'No unreserved supply kits remain.';
  if (action === 'RELOCATE') {
    const known = home.known!;
    const vans = view.units.filter(unit => unit.kind === 'van' && unit.seats >= known.size && (!known.accessible || unit.accessible));
    if (!vans.length) return 'No transport van has compatible accessibility and enough seats.';
    const shelters = view.shelters.filter(shelter => shelter.available >= known.size && (!known.accessible || shelter.accessible));
    if (!shelters.length) return 'No compatible shelter has enough unreserved places for this household.';
    if (!shelters.some(shelter => shortestPath(view.map, home.nodeId, shelter.nodeId))) return 'No open road route reaches a compatible shelter.';
  }
  return home.known ? 'Waiting for an available compatible team and an open road route.' : 'Needs unknown; waiting for an available team and an open road route.';
}

/** Playback status derives from retained command metadata, so replay preserves it. */
export function getAutomaticCoordinationIssue(state: Pick<SimState, 'commands'>): string | null {
  if (state.commands.length >= 500) return 'Command limit reached. Export or start a new simulation.';
  const last = state.commands.at(-1);
  if (!Number.isSafeInteger((last?.command.sequence ?? 0) + 1)) return 'Assignment sequence limit reached. Start a new simulation.';
  if (last && !last.result.accepted) return `Assignment rejected: ${last.result.reason}`;
  return null;
}

function coordinate(initial: SimState): SimState {
  let state = initial;
  // An accepted assignment occupies one team. Never retry a rejected command in this boundary.
  for (let count = 0; count < initial.units.length && !state.finalized; count++) {
    const view = observe(state);
    const intent = chooseAutomaticIntent(view);
    if (!intent) break;
    if (state.commands.length >= 500) return state;
    const sequence = (state.commands.at(-1)?.command.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) return state;
    const baseId = `AUTO-${String(sequence).padStart(4, '0')}`;
    let commandId = baseId, collision = 0;
    const ids = new Set(state.commands.map(record => record.command.commandId));
    while (ids.has(commandId)) commandId = `${baseId}-${++collision}`;
    const outcome = dispatch(state, { ...intent, runId: state.runId, commandId, sequence, minute: state.minute });
    state = outcome.state;
    if (!outcome.result.accepted) return state;
  }
  return state;
}

/** Initial reports and every independent available team are coordinated at minute zero. */
export function initializeAutomatic(scenario: Scenario, runId: string): SimState {
  return coordinate(initialize(scenario, runId));
}

/** Complete missions and publish reports, then respond at that same minute boundary. */
export function advanceAutomaticMinute(state: SimState): SimState {
  if (state.finalized) return state;
  return coordinate(advanceMinute(state));
}
