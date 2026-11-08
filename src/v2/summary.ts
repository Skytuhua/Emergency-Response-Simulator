import { MINUTE_MS, type SummaryV2 } from './contracts';
import type { WorldStateV2 } from './world';

/** Ground truth is intentionally a debrief projection, never a coordinator input. */
export function summarizeWorld(state: WorldStateV2): SummaryV2 {
  const population = state.bundle.assets.population;
  const transports = state.bundle.resources.units.filter(unit => unit.capabilities.includes('transport'));
  const unsupported = new Set<string>();
  const outcomes = population.households.map(home => {
    const progress = state.households.find(item => item.id === home.id)!;
    const requirement = state.bundle.assets.support.find(item => item.householdId === home.id)!.accessiblePlacesRequired;
    const canTransport = transports.some(unit => unit.seats >= home.size && unit.accessiblePlaces >= requirement);
    const needs = state.needs.filter(need => need.householdId === home.id).map(need => {
      const mission = state.missions.find(item => item.needId === need.id && item.status !== 'completed');
      if (need.kind === 'relocation' && !canTransport) unsupported.add(home.id);
      return { id: need.id, kind: need.kind, urgent: need.urgent, onsetMs: need.onsetMs, deadlineMs: need.deadlineMs,
        completedAtMs: need.completedAtMs, discovered: need.discovered,
        waitingReason: need.completedAtMs !== null ? null : need.kind === 'relocation' && !canTransport ? 'Whole-household transport is unsupported.'
          : mission?.reason ?? (!need.discovered ? 'Need has not been observed.' : mission ? `Mission is ${mission.status}.` : 'Awaiting an available compatible assignment.') };
    });
    return { householdId: home.id, size: home.size, contactedAtMs: progress.lastContactAtMs, checkedAtMs: progress.lastCheckAtMs, needs };
  });
  const needs = outcomes.flatMap(home => home.needs), completedHouseholds = outcomes.filter(home => home.needs.some(need => need.completedAtMs !== null));
  return { households: population.households.length, persons: population.persons.length, needs: needs.length,
    completedNeeds: needs.filter(need => need.completedAtMs !== null).length,
    peopleHelped: completedHouseholds.reduce((sum, home) => sum + home.size, 0),
    urgentNeeds: needs.filter(need => need.urgent).length,
    timelyUrgent: needs.filter(need => need.urgent && need.completedAtMs !== null && need.completedAtMs <= need.deadlineMs).length,
    peopleWaiting: outcomes.filter(home => home.needs.some(need => need.completedAtMs === null)).reduce((sum, home) => sum + home.size, 0),
    uncheckedHomes: outcomes.filter(home => home.checkedAtMs === null).length,
    cannotCallUncheckedHomes: state.households.filter(home => !home.communicationsAvailable && home.lastCheckAtMs === null).length,
    undiscoveredNeeds: needs.filter(need => !need.discovered).length,
    unmetNeedMinutes: needs.reduce((sum, need) => sum + Math.max(0, (need.completedAtMs ?? state.nowMs) - need.onsetMs) / MINUTE_MS, 0),
    unsupportedHouseholds: unsupported.size, outcomes, behavior: structuredClone(state.behavior) };
}
