import type { Action, CommandIntent, ObservationView, ObservedHousehold } from '../model';
import { shortestPath } from '../sim/routes';

/** Primary work is driven only by facts already visible to the operator. */
export function getPrimaryAction(home: ObservedHousehold): Action | null {
  if (home.missionId || home.completedAt !== null) return null;
  if (!home.known) return 'ASSESS';
  return home.known.need?.kind === 'delivery' ? 'DELIVER' : home.known.need?.kind === 'relocation' ? 'RELOCATE' : null;
}

export function getBlockedReason(view: ObservationView, householdId: string, action: Action, unitId: string, shelterId?: string): string | null {
  if (view.finalized) return 'The exercise has ended.';
  const home = view.households.find(h => h.id === householdId);
  if (!home) return 'Select a home.';
  // This check precedes capabilities so assistance can never disclose an unknown need.
  if (action !== 'ASSESS' && !home.known) return 'Check this home or receive a request first.';
  if (home.missionId || view.missions.some(m => m.householdId === home.id && m.status !== 'completed')) return 'A team is already assigned to this home.';
  if (action !== 'ASSESS' && home.completedAt !== null) return 'This home has already received help.';
  const unit = view.units.find(u => u.id === unitId);
  if (!unit) return 'Choose an available team.';
  if (unit.missionId || view.missions.some(m => m.unitId === unit.id && m.status !== 'completed')) return 'This team is busy until its assignment completes.';
  if (action === 'DELIVER') {
    if (home.known?.need?.kind !== 'delivery') return 'There is no known supply kit need.';
    if (unit.kind !== 'crew') return 'Choose the response crew to deliver a kit.';
    if (view.kits.available < 1) return 'No unreserved supply kits remain.';
  }
  if (action === 'RELOCATE') {
    if (home.known?.need?.kind !== 'relocation') return 'There is no known transport need.';
    if (unit.kind !== 'van') return 'Choose a transport van.';
    if (home.known.accessible && !unit.accessible) return 'Choose a van with accessible transport.';
    if (unit.seats < home.known.size) return `Choose a van with at least ${home.known.size} seats.`;
    const shelter = view.shelters.find(s => s.id === shelterId);
    if (!shelter) return 'Choose a reachable shelter.';
    if (home.known.accessible && !shelter.accessible) return 'Choose an accessible shelter.';
    if (shelter.available < home.known.size) return `${shelter.name} has ${shelter.available} unreserved places; ${home.known.size} are needed.`;
    if (!shortestPath(view.map, home.nodeId, shelter.nodeId)) return 'There is no open route to this shelter.';
  }
  if (!shortestPath(view.map, unit.nodeId, home.nodeId)) return 'There is no open route to this home.';
  return null;
}

export function isAssignmentFeasible(view: ObservationView, intent: CommandIntent): boolean {
  return getBlockedReason(view, intent.householdId, intent.action, intent.unitId, intent.shelterId) === null;
}

/** Earliest completion first, with deterministic identity ties and valid manual unit preference. */
export function getSuggestedAssignment(view: ObservationView, householdId: string, action?: Action, preferredUnitId?: string): CommandIntent | null {
  const home = view.households.find(h => h.id === householdId);
  const work = action ?? (home ? getPrimaryAction(home) : null);
  if (!home || !work) return null;
  const candidates: { intent: CommandIntent; completion: number }[] = [];
  for (const unit of view.units) {
    const shelters = work === 'RELOCATE' ? view.shelters : [undefined];
    for (const shelter of shelters) {
      const intent: CommandIntent = { action: work, householdId, unitId: unit.id, ...(shelter ? { shelterId: shelter.id } : {}) };
      if (!isAssignmentFeasible(view, intent)) continue;
      const travel = shortestPath(view.map, unit.nodeId, home.nodeId)!.minutes;
      const onward = shelter ? shortestPath(view.map, home.nodeId, shelter.nodeId)!.minutes : 0;
      candidates.push({ intent, completion: view.minute + travel + onward + (work === 'RELOCATE' ? 4 : 2) });
    }
  }
  candidates.sort((a, b) => a.completion - b.completion || a.intent.unitId.localeCompare(b.intent.unitId) || (a.intent.shelterId ?? '').localeCompare(b.intent.shelterId ?? ''));
  const preferred = candidates.find(candidate => candidate.intent.unitId === preferredUnitId);
  return (preferred ?? candidates[0])?.intent ?? null;
}
