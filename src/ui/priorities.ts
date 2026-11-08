import type { Mission, ObservationView, ObservedHousehold } from '../model';

export type PriorityGroup = 'needs-help' | 'not-checked' | 'on-the-way';
export type PriorityGroups = Record<PriorityGroup, ObservedHousehold[]>;

const byId = (a: ObservedHousehold, b: ObservedHousehold) => a.id.localeCompare(b.id, undefined, { numeric: true });

export function activeMission(view: ObservationView, home: ObservedHousehold): Mission | undefined {
  return view.missions.find(mission => mission.householdId === home.id && mission.status !== 'completed');
}

/** A work list built exclusively from facts already visible to the operator. */
export function getPriorityGroups(view: ObservationView): PriorityGroups {
  const groups: PriorityGroups = { 'needs-help': [], 'not-checked': [], 'on-the-way': [] };
  for (const home of view.households) {
    if (home.completedAt !== null) continue;
    if (home.missionId || activeMission(view, home)) groups['on-the-way'].push(home);
    else if (home.known?.need) groups['needs-help'].push(home);
    else if (!home.known && home.assessedAt === null) groups['not-checked'].push(home);
  }
  groups['needs-help'].sort((a, b) => Number(b.known!.need!.urgent) - Number(a.known!.need!.urgent)
    || a.known!.need!.deadline - b.known!.need!.deadline || byId(a, b));
  groups['not-checked'].sort((a, b) => Number(a.communications) - Number(b.communications) || byId(a, b));
  groups['on-the-way'].sort((a, b) => (activeMission(view, a)?.completionAt ?? Infinity) - (activeMission(view, b)?.completionAt ?? Infinity) || byId(a, b));
  return groups;
}

/** Arrival and boarding remain work in progress; only completedAt means help completed. */
export function priorityReason(view: ObservationView, home: ObservedHousehold): string {
  if (home.completedAt !== null) return 'Help completed';
  const mission = activeMission(view, home);
  if (mission) {
    const remaining = Math.max(0, mission.completionAt - view.minute);
    if (mission.status === 'boarding') return `Residents boarding · completes in ${remaining} min`;
    if (mission.status === 'transporting') return `Going to shelter · completes in ${remaining} min`;
    if (view.minute < mission.arrivalAt) return `${mission.action === 'ASSESS' ? 'Check' : 'Help'} on the way · arrives in ${mission.arrivalAt - view.minute} min`;
    return `Team at home · ${mission.action === 'ASSESS' ? 'check' : 'supplies'} complete in ${remaining} min`;
  }
  if (home.missionId) return 'Team assigned';
  if (!home.known) return home.communications ? 'Not checked · need unknown' : 'Cannot call · not checked';
  const need = home.known.need;
  if (!need) return 'Checked · no current need';
  const remaining = need.deadline - view.minute;
  const deadline = remaining > 0 ? `${remaining} min left` : remaining === 0 ? 'due now' : `${Math.abs(remaining)} min overdue`;
  return `${need.kind === 'delivery' ? 'Needs supplies' : 'Needs a ride'}${need.urgent ? ' · urgent' : ''} · ${deadline}`;
}
