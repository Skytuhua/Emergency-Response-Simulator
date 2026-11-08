import type { ObservationView, ObservedHousehold, SimState } from '../model';

/** The sole projection consumed by live UI, legal previews and policies. */
export function observe(state: SimState): ObservationView {
  const households: ObservedHousehold[] = state.scenario.households.map(home => {
    const progress = state.households.find(p => p.householdId === home.id)!;
    const profile = progress.known ? state.scenario.artifact?.profiles.find(p => p.householdId === home.id) : undefined;
    return {
      id: home.id, name: profile?.displayName || home.name, address: home.address, nodeId: home.nodeId,
      x: home.x, y: home.y, neighborhood: home.neighborhood,
      communications: state.scenario.config.networkGap !== home.neighborhood,
      status: progress.completedAt !== null ? 'assisted' : progress.missionId ? 'assigned' : progress.assessedAt !== null ? 'assessed' : progress.known ? 'reported' : 'unknown',
      known: structuredClone(progress.known), contactedAt: progress.contactedAt, assessedAt: progress.assessedAt,
      completedAt: progress.completedAt, missionId: progress.missionId,
    };
  });
  return {
    runId: state.runId, minute: state.minute, finalized: state.finalized,
    map: structuredClone(state.scenario.map), households, units: structuredClone(state.units),
    shelters: structuredClone(state.shelters), kits: { ...state.kits },
    missions: structuredClone(state.missions), events: structuredClone(state.events), networkGap: state.scenario.config.networkGap,
    requests: households.filter(h => h.known?.need && h.completedAt === null),
    contactCount: households.filter(h => h.contactedAt !== null).length,
    assessedCount: households.filter(h => h.assessedAt !== null).length,
    assistedCount: households.filter(h => h.completedAt !== null).length,
  };
}
