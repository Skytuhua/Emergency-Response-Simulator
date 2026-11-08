import { effectiveScenarioV2 } from './setup';
import type { GeographicRoadGraph } from '../model';
import type { CoordinatorObservationV2, ObserverSnapshotV2, PublicMissionV2 } from './contracts';
import type { WorldStateV2 } from './world';
import { facilityTotalsV2, supplyTotalsV2 } from './resources';
import { summarizeWorld } from './summary';

const publicMaps = new WeakMap<GeographicRoadGraph, GeographicRoadGraph>();
function immutablePublicMap(map: GeographicRoadGraph): GeographicRoadGraph {
  let result = publicMaps.get(map);
  if (result) return result;
  result = structuredClone(map);
  for (const edge of result.edges) delete edge.closed;
  const freeze = (value: object): void => {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
    Object.freeze(value);
  };
  freeze(result); publicMaps.set(map, result); return result;
}

/** Explicit field construction is a privacy boundary; never spread private records here. */
export function observeCoordinator(state: WorldStateV2): CoordinatorObservationV2 {
  const householdProgress=new Map(state.households.map(home=>[home.id,home]));
  const missions: PublicMissionV2[] = state.missions.map(mission => ({ id: mission.id, unitId: mission.unitId, householdId: mission.householdId,
    needId: mission.needId, action: mission.action, ...(mission.shelterId ? { shelterId: mission.shelterId } : {}), status: mission.status,
    dispatchedAtMs: mission.dispatchedAtMs, estimatedCompletionAtMs: mission.estimatedCompletionAtMs, completedAtMs: mission.completedAtMs,
    route: structuredClone(mission.route), routeLegIndex: mission.routeLegIndex, stageRemainingMs: mission.stageRemainingMs, reason: mission.reason }));
  return { version: 2, nowMs: state.nowMs, finalized: state.finalized, map: immutablePublicMap(state.bundle.assets.map),
    knownClosedEdgeIds: [...state.knownClosedEdgeIds],
    households: state.bundle.assets.population.households.map(home => {
      const progress = householdProgress.get(home.id)!;
      return { id: home.id, tractGeoid: home.tractGeoid, homeNodeId: home.homeNodeId,
        position: { lat: home.position.lat, lon: home.position.lon, x: home.position.x, y: home.position.y },
        communicationsAvailable: progress.knownCommunicationsAvailable, lastContactAtMs: progress.lastContactAtMs,
        lastCheckAtMs: progress.lastCheckAtMs, known: progress.known ? structuredClone(progress.known) : null, missionId: progress.missionId };
    }),
    units: state.units.map(unit => ({ id: unit.id, kind: unit.kind, capabilities: [...unit.capabilities], seats: unit.seats,
      accessiblePlaces: unit.accessiblePlaces, baseNodeId: unit.baseNodeId, cursor: structuredClone(unit.cursor), position: { ...unit.position },
      missionId: unit.missionId, passengers: unit.passengers, carriedBundles: unit.carriedBundles, busyMs: unit.busyMs, status: unit.status })),
    facilities: effectiveScenarioV2(state.bundle).facilities.map(facility => ({ id: facility.id, name: facility.name, kind: facility.kind, nodeId: facility.nodeId,
      position: { ...facility.position }, synthetic: true, capacity: facility.capacity, accessible: facility.accessible, opensAtMs: facility.opensAtMs,
      open: state.facilities.find(item => item.id === facility.id)!.knownOpen, ...facilityTotalsV2(state, facility.id) })),
    missions, supply: supplyTotalsV2(state), events: state.events.filter(event => event.visibility === 'coordinator').map(event => structuredClone(event)) };
}

export function observeSnapshot(state: WorldStateV2): ObserverSnapshotV2 {
  return { runId: state.runId, nowMs: state.nowMs, finalized: state.finalized,
    population: { households: state.bundle.assets.population.households.length, persons: state.bundle.assets.population.persons.length, mode: state.bundle.populationMode },
    coordinator: observeCoordinator(state), residentEvents: state.events.filter(event => event.visibility === 'resident').map(event => structuredClone(event)),
    observedEvents: state.events.filter(event=>event.visibility!=='debrief').map(event=>structuredClone(event)),
    personas: structuredClone(effectiveScenarioV2(state.bundle).behavior?.personas ?? []),
    preparedActions: structuredClone(effectiveScenarioV2(state.bundle).behavior?.actions ?? []), summary: state.finalized ? summarizeWorld(state) : null };
}
