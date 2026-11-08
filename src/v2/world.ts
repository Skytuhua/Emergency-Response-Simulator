import { effectiveScenarioV2,validateSetupV2 } from './setup';
import { HORIZON_MS, MINUTE_MS, type CommandOutcomeV2, type CommandV2, type KnownHouseholdV2, type NeedDefinitionV2, type PublicMissionV2, type PublicUnitV2, type ScenarioBundleV2, type SummaryV2, type TraceEventV2 } from './contracts';
import { compareIdsV2, planRouteV2 } from './routes';
import { positionAtCursorV2 } from './movement';
import { facilityTotalsV2, supplyTotalsV2, type BundleReservationV2, type SeatReservationV2 } from './resources';
import { appendTraceV2, applyWorldChangesV2, deliverWorldAnnouncementsV2, revealHouseholdV2, worldSchedulesV2 } from './events';
import { evaluateResidentOpportunityV2 } from './behavior';

export interface HouseholdStateV2 {
  id: string; communicationsAvailable: boolean; knownCommunicationsAvailable: boolean | null;
  lastContactAtMs: number | null; lastCheckAtMs: number | null; known: KnownHouseholdV2 | null; missionId: string | null;
}
export interface NeedStateV2 extends NeedDefinitionV2 {
  onsetEventId: string; completedAtMs: number | null; discovered: boolean;
  nextReportAtMs: number | null; reportAttempt: number;
}
export interface MissionStateV2 extends PublicMissionV2 { destination: 'depot' | 'household' | 'shelter' }
export interface FacilityStateV2 { id: string; open: boolean; knownOpen: boolean }

/** Private physical/knowledge state. Only explicit projections leave this module family. */
export interface WorldStateV2 {
  runId: string; bundle: ScenarioBundleV2; nowMs: number; finalized: boolean;
  households: HouseholdStateV2[]; needs: NeedStateV2[]; units: PublicUnitV2[];
  facilities: FacilityStateV2[]; missions: MissionStateV2[];
  closedEdgeIds: string[]; knownClosedEdgeIds: string[];
  effectiveEventIndex: number; observedEventIndex: number; openedFacilityIds: string[];
  bundleReservations: BundleReservationV2[]; seatReservations: SeatReservationV2[];
  commands: CommandOutcomeV2[]; events: TraceEventV2[]; consumedOpportunityIds: string[];
  traceSequence: Record<TraceEventV2['visibility'], number>;
  directEligibleHouseholdIds: string[];
  behavior: SummaryV2['behavior'];
}

function cloneWorld(state: WorldStateV2): WorldStateV2 {
  // Assets remain the same immutable admitted bundle; runtime mutable records are copied.
  const { bundle, ...records } = state;
  return { ...structuredClone(records), bundle };
}

export function initializeWorld(bundle: ScenarioBundleV2, runId: string): WorldStateV2 {
  if (bundle.horizonMs !== HORIZON_MS) throw new Error('V2 worlds require the 360-minute horizon.');
  if(bundle.setup){const errors=validateSetupV2(bundle,bundle.setup);if(errors.length)throw new Error(errors.join(' '));}
  const supports = new Map(bundle.assets.support.map(item => [item.householdId, item.accessiblePlacesRequired]));
  for (const home of bundle.assets.population.households) if (!supports.has(home.id)) throw new Error(`Missing support requirement for ${home.id}.`);
  const state: WorldStateV2 = {
    runId, bundle, nowMs: 0, finalized: false,
    households: bundle.assets.population.households.map(home => ({ id: home.id, communicationsAvailable: true, knownCommunicationsAvailable: null,
      lastContactAtMs: null, lastCheckAtMs: null, known: null, missionId: null })),
    needs: [], units: effectiveScenarioV2(bundle).resources.units.map(unit => ({ ...unit, capabilities: [...unit.capabilities], cursor: { kind: 'node', nodeId: unit.baseNodeId, incoming: null },
      position: positionAtCursorV2(bundle.assets.map, { kind: 'node', nodeId: unit.baseNodeId, incoming: null }), missionId: null, passengers: 0, carriedBundles: 0, busyMs: 0, status: 'available' })),
    facilities: effectiveScenarioV2(bundle).facilities.map(facility => ({ id: facility.id, open: facility.opensAtMs <= 0, knownOpen: facility.opensAtMs <= 0 })),
    missions: [], closedEdgeIds: [], knownClosedEdgeIds: [], effectiveEventIndex: 0, observedEventIndex: 0,
    openedFacilityIds: effectiveScenarioV2(bundle).facilities.filter(item => item.opensAtMs <= 0).map(item => item.id),
    bundleReservations: [], seatReservations: [], commands: [], events: [], consumedOpportunityIds: [], directEligibleHouseholdIds: [], traceSequence: {coordinator:0,resident:0,debrief:0},
    behavior: { directPersonaActors: effectiveScenarioV2(bundle).behavior?.personas.length ?? 0, eligibleActors: 0, directActions: 0, suppressed: 0, fallback: 0, fallbackReasons: {} },
  };
  settleBoundary(state); assertWorldInvariants(state); return state;
}

function missionWaypoints(state: WorldStateV2, mission: MissionStateV2): string[] {
  const home = state.bundle.assets.population.households.find(item => item.id === mission.householdId)!;
  const shelter = mission.shelterId ? effectiveScenarioV2(state.bundle).facilities.find(item => item.id === mission.shelterId) : null;
  if (mission.destination === 'shelter') return [shelter!.nodeId];
  const destinations = [home.homeNodeId, ...(mission.action === 'transport' ? [shelter!.nodeId] : [])];
  return mission.destination === 'depot' ? [effectiveScenarioV2(state.bundle).resources.depotNodeId, ...destinations] : destinations;
}

function estimateRemaining(state: WorldStateV2, mission: MissionStateV2): number | null {
  if (mission.status === 'blocked' || mission.status === 'stranded') return null;
  if (mission.status === 'completed') return 0;
  const unit = state.units.find(item => item.id === mission.unitId)!;
  let remaining = mission.route.legs.slice(mission.routeLegIndex).reduce((sum, leg) => sum + leg.durationMs, 0);
  if (unit.cursor.kind === 'edge') remaining -= unit.cursor.elapsedMs;
  const r = effectiveScenarioV2(state.bundle).resources;
  if (mission.action === 'check') remaining += mission.status === 'checking' ? mission.stageRemainingMs : r.assessmentMs;
  if (mission.action === 'deliver') {
    const loaded = state.bundleReservations.find(item => item.missionId === mission.id)?.status === 'loaded';
    if (!loaded) remaining += mission.status === 'loading' ? mission.stageRemainingMs : r.loadMs;
    remaining += mission.status === 'delivering' ? mission.stageRemainingMs : r.deliveryMs;
  }
  if (mission.action === 'transport') {
    if (mission.destination !== 'shelter') remaining += mission.status === 'boarding' ? mission.stageRemainingMs : r.boardingMs;
    remaining += mission.status === 'dropoff' ? mission.stageRemainingMs : r.dropoffMs;
  }
  return remaining;
}

function blockMission(state: WorldStateV2, mission: MissionStateV2, reason: string, stranded = false): void {
  const unit = state.units.find(item => item.id === mission.unitId)!;
  mission.status = stranded ? 'stranded' : 'blocked'; mission.reason = reason; mission.estimatedCompletionAtMs = null;
  unit.status = stranded ? 'stranded' : 'blocked';
  appendTraceV2(state, { type: stranded ? 'mission-stranded' : 'mission-blocked', householdId: mission.householdId,
    missionId: mission.id, unitId: mission.unitId, ...(mission.needId ? { needId: mission.needId } : {}), message: reason, visibility: 'coordinator', source: 'world-rule' });
}

function replanMission(state: WorldStateV2, mission: MissionStateV2): boolean {
  const unit = state.units.find(item => item.id === mission.unitId)!;
  if (unit.cursor.kind !== 'node') return false;
  const route = planRouteV2(state.bundle.assets.map, unit.cursor, missionWaypoints(state, mission), state.knownClosedEdgeIds);
  if (!route) { blockMission(state, mission, 'No legal route remains from the current safe node.'); return false; }
  mission.route = route; mission.routeLegIndex = 0;
  appendTraceV2(state, { type: 'mission-rerouted', householdId: mission.householdId, missionId: mission.id, unitId: unit.id,
    message: 'Replanned from the actual safe node with the arrival arc preserved.', visibility: 'coordinator', source: 'world-rule' });
  return true;
}

function discoverClosure(state: WorldStateV2, mission: MissionStateV2, edgeId: string): void {
  if (state.knownClosedEdgeIds.includes(edgeId)) return;
  state.knownClosedEdgeIds.push(edgeId); state.knownClosedEdgeIds.sort(compareIdsV2);
  appendTraceV2(state, { type: 'closure-encountered', householdId: mission.householdId, missionId: mission.id, unitId: mission.unitId,
    message: `Observed unsafe edge ${edgeId} at the actual movement cursor.`, visibility: 'coordinator', source: 'world-rule', evidenceIds: [edgeId] });
}

function finishMission(state: WorldStateV2, mission: MissionStateV2): void {
  const unit = state.units.find(item => item.id === mission.unitId)!, home = state.households.find(item => item.id === mission.householdId)!;
  if (mission.needId) {
    const need = state.needs.find(item => item.id === mission.needId)!;
    need.completedAtMs = state.nowMs;
    const known = home.known?.needs.find(item => item.id === mission.needId); if (known) known.completedAtMs = state.nowMs;
  }
  mission.status = 'completed'; mission.completedAtMs = state.nowMs; mission.estimatedCompletionAtMs = state.nowMs; mission.stageRemainingMs = 0;
  unit.missionId = null; unit.status = 'available'; home.missionId = null;
  appendTraceV2(state, { type: 'mission-completed', householdId: home.id, missionId: mission.id, unitId: unit.id,
    ...(mission.needId ? { needId: mission.needId } : {}), message: mission.action === 'check' ? 'Household check completed.' : `Completed ${mission.action} assistance after safe service.`, visibility: 'coordinator', source: 'world-rule' });
}

/** All occupied cursors are reconciled before any mission can complete service. */
function reconcileOccupiedMovement(state: WorldStateV2, mission: MissionStateV2): void {
  if (['completed', 'blocked', 'stranded'].includes(mission.status)) return;
  const unit = state.units.find(item => item.id === mission.unitId)!;
  // The interval has progressed to t before evaluating safety at t, including exact arrivals.
  if (unit.cursor.kind === 'edge') {
    if (state.closedEdgeIds.includes(unit.cursor.arc.edgeId)) {
      discoverClosure(state, mission, unit.cursor.arc.edgeId);
      blockMission(state, mission, 'The occupied edge became unsafe; recovery is unsupported.', true); return;
    }
    if (unit.cursor.elapsedMs < unit.cursor.durationMs) return;
    unit.cursor = { kind: 'node', nodeId: unit.cursor.arc.toNodeId, incoming: { ...unit.cursor.arc } };
    unit.position = positionAtCursorV2(state.bundle.assets.map, unit.cursor); mission.routeLegIndex++;
  }
}

/** Complete safe stages and enter the next safe edge. Only called after tape changes. */
function reconcileMission(state: WorldStateV2, mission: MissionStateV2): void {
  if (['completed', 'blocked', 'stranded'].includes(mission.status)) return;
  const unit = state.units.find(item => item.id === mission.unitId)!;
  if (unit.cursor.kind === 'edge') return;
  // At most one edge entry plus the finite depot/pickup/dropoff transitions can occur at t.
  for (let transition = 0; transition < 8; transition++) {
    if (unit.cursor.kind !== 'node') return;
    if (['loading', 'checking', 'delivering', 'boarding', 'dropoff'].includes(mission.status)) {
      if (mission.status === 'loading' || mission.status === 'dropoff') {
        const facility = mission.status === 'loading'
          ? effectiveScenarioV2(state.bundle).facilities.find(item => item.kind === 'base' && item.nodeId === effectiveScenarioV2(state.bundle).resources.depotNodeId)
          : effectiveScenarioV2(state.bundle).facilities.find(item => item.id === mission.shelterId);
        const physical = facility ? state.facilities.find(item => item.id === facility.id)! : null;
        if (physical && !physical.open) {
          physical.knownOpen = false;
          blockMission(state, mission, `The ${mission.status === 'loading' ? 'depot' : 'destination shelter'} is closed; reservations and cargo are retained.`); return;
        }
      }
      if (mission.stageRemainingMs > 0) return;
      if (mission.status === 'loading') {
        const reservation = state.bundleReservations.find(item => item.missionId === mission.id)!;
        reservation.status = 'loaded'; unit.carriedBundles++;
        mission.destination = 'household'; mission.status = 'traveling';
        appendTraceV2(state, { type: 'bundle-loaded', missionId: mission.id, householdId: mission.householdId, unitId: unit.id,
          message: 'One household bundle loaded at the synthetic depot.', visibility: 'coordinator', source: 'world-rule' });
        continue;
      }
      if (mission.status === 'checking') { revealHouseholdV2(state, mission.householdId, 'check', `check:${mission.id}`); finishMission(state, mission); return; }
      if (mission.status === 'delivering') {
        const reservation = state.bundleReservations.find(item => item.missionId === mission.id)!;
        reservation.status = 'delivered'; unit.carriedBundles--; finishMission(state, mission); return;
      }
      if (mission.status === 'boarding') {
        revealHouseholdV2(state, mission.householdId, 'check', `pickup:${mission.id}`);
        unit.passengers = state.bundle.assets.population.households.find(item => item.id === mission.householdId)!.size;
        mission.destination = 'shelter'; mission.status = 'transporting';
        appendTraceV2(state, { type: 'passengers-boarded', missionId: mission.id, householdId: mission.householdId, unitId: unit.id,
          message: `Boarded the whole household (${unit.passengers} people).`, visibility: 'coordinator', source: 'world-rule' });
        continue;
      }
      if (mission.status === 'dropoff') {
        state.seatReservations.find(item => item.missionId === mission.id)!.status = 'occupied';
        unit.passengers = 0; finishMission(state, mission); return;
      }
    }
    const destinations = missionWaypoints(state, mission), nextTarget = destinations[0];
    if (unit.cursor.nodeId === nextTarget) {
      if (mission.destination === 'depot') { mission.status = 'loading'; mission.stageRemainingMs = effectiveScenarioV2(state.bundle).resources.loadMs; }
      else if (mission.destination === 'shelter') { mission.status = 'dropoff'; mission.stageRemainingMs = effectiveScenarioV2(state.bundle).resources.dropoffMs; }
      else { mission.status = mission.action === 'check' ? 'checking' : mission.action === 'deliver' ? 'delivering' : 'boarding';
        mission.stageRemainingMs = mission.action === 'check' ? effectiveScenarioV2(state.bundle).resources.assessmentMs : mission.action === 'deliver' ? effectiveScenarioV2(state.bundle).resources.deliveryMs : effectiveScenarioV2(state.bundle).resources.boardingMs; }
      appendTraceV2(state, { type: 'stage-started', householdId: mission.householdId, missionId: mission.id, unitId: unit.id,
        message: `Started ${mission.status} at the actual destination.`, visibility: 'coordinator', source: 'world-rule' });
      continue;
    }
    // Public changes reroute only at a safe node. Never fabricate a node for an occupied edge.
    if (mission.route.legs.slice(mission.routeLegIndex).some(leg => state.knownClosedEdgeIds.includes(leg.edgeId))) {
      if (!replanMission(state, mission)) return;
    }
    const leg = mission.route.legs[mission.routeLegIndex];
    if (!leg || leg.fromNodeId !== unit.cursor.nodeId) { blockMission(state, mission, 'The route has no legal continuation at the actual cursor.'); return; }
    if (state.closedEdgeIds.includes(leg.edgeId)) {
      discoverClosure(state, mission, leg.edgeId);
      if (!replanMission(state, mission)) return;
      continue;
    }
    unit.cursor = { kind: 'edge', arc: { edgeId: leg.edgeId, fromNodeId: leg.fromNodeId, toNodeId: leg.toNodeId }, elapsedMs: 0, durationMs: leg.durationMs };
    unit.position = positionAtCursorV2(state.bundle.assets.map, unit.cursor);
    return;
  }
  throw new Error('V2 exceeded finite same-time movement transitions.');
}

function processOpportunity(state: WorldStateV2, householdId: string, opportunityId: string, need: NeedDefinitionV2 | null): void {
  if (state.consumedOpportunityIds.includes(opportunityId)) return;
  state.consumedOpportunityIds.push(opportunityId);
  const home = state.bundle.assets.population.households.find(item => item.id === householdId)!, physical = state.households.find(item => item.id === householdId)!;
  const accessiblePlacesRequired = state.bundle.assets.support.find(item => item.householdId === householdId)!.accessiblePlacesRequired;
  const localNeed: NeedDefinitionV2 | null = need ? { id: need.id, householdId: need.householdId, kind: need.kind,
    urgent: need.urgent, onsetMs: need.onsetMs, deadlineMs: need.deadlineMs } : null;
  const evaluation = evaluateResidentOpportunityV2(state.bundle, { householdId, opportunityId, atMs: state.nowMs, size: home.size,
    accessiblePlacesRequired, communicationsAvailable: physical.communicationsAvailable, need: localNeed,
    completedAssistance: state.needs.filter(item => item.completedAtMs !== null).map(item => item.id) });
  state.behavior.directActions += evaluation.directActions;
  // Denominator is unique households with an actually matching, legal executed opportunity.
  // Completed-assistance suppression is counted separately, before context eligibility.
  if (evaluation.origin === 'llm-direct' && !state.directEligibleHouseholdIds.includes(householdId)) {
    state.directEligibleHouseholdIds.push(householdId); state.behavior.eligibleActors = state.directEligibleHouseholdIds.length;
  }
  if (evaluation.suppressed) state.behavior.suppressed++;
  if (evaluation.fallback) { state.behavior.fallback++; const reason = evaluation.fallbackReason ?? 'unspecified'; state.behavior.fallbackReasons[reason] = (state.behavior.fallbackReasons[reason] ?? 0) + 1; }
  appendTraceV2(state, { type: evaluation.suppressed ? 'resident-action-suppressed' : 'resident-action', householdId,
    ...(need ? { needId: need.id } : {}), message: evaluation.text, visibility: 'resident', source: evaluation.source, evidenceIds: [opportunityId, ...evaluation.evidenceIds] });
  if (evaluation.suppressed || evaluation.action !== 'report' || !need) return;
  if (!physical.communicationsAvailable) {
    appendTraceV2(state, { type: 'report-failed', householdId, needId: need.id, message: 'Resident report attempt failed because communications were unavailable.', visibility: 'resident', source: evaluation.source, evidenceIds: [opportunityId] });
    return;
  }
  revealHouseholdV2(state, householdId, 'report', opportunityId, evaluation.text);
  const progress = state.needs.find(item => item.id === need.id); if (progress) progress.nextReportAtMs = null;
  appendTraceV2(state, { type: 'report-received', householdId, needId: need.id, message: evaluation.text,
    visibility: 'coordinator', source: evaluation.source, evidenceIds: [opportunityId, ...evaluation.evidenceIds] });
}

function deliverResidentActions(state: WorldStateV2): void {
  const background = state.needs.filter(need => need.nextReportAtMs === state.nowMs).sort((a, b) => compareIdsV2(a.id, b.id));
  for (const need of background) {
    const opportunityId = `report:${need.id}:${need.reportAttempt}`;
    // Tentatively schedule retry; receipt/suppression clears it below.
    need.reportAttempt++; need.nextReportAtMs = state.nowMs + state.bundle.behaviorRules.retryMs;
    processOpportunity(state, need.householdId, opportunityId, need);
    if (need.completedAtMs !== null) need.nextReportAtMs = null;
  }
  for (const context of effectiveScenarioV2(state.bundle).behavior?.contexts ?? []) {
    if (context.atMs !== state.nowMs || state.consumedOpportunityIds.includes(context.opportunityId)) continue;
    const localNeeds = state.needs.filter(need => need.householdId === context.householdId && need.onsetMs <= state.nowMs).sort((a, b) => b.onsetMs - a.onsetMs || compareIdsV2(a.id, b.id));
    processOpportunity(state, context.householdId, context.opportunityId, localNeeds[0] ?? null);
  }
}

function settleBoundary(state: WorldStateV2): void {
  applyWorldChangesV2(state);
  for (const mission of state.missions) reconcileOccupiedMovement(state, mission);
  for (const mission of state.missions) reconcileMission(state, mission);
  deliverWorldAnnouncementsV2(state);
  deliverResidentActions(state);
  for (const mission of state.missions) {
    if(mission.status==='completed'){mission.estimatedCompletionAtMs=mission.completedAtMs;continue;}
    const remaining = estimateRemaining(state, mission);
    mission.estimatedCompletionAtMs = remaining === null ? null : state.nowMs + remaining;
  }
  if (state.nowMs === HORIZON_MS) state.finalized = true;
  assertWorldInvariants(state);
}

export function nextWorldBoundaryMs(state: WorldStateV2, targetMs: number): number {
  const schedule = worldSchedulesV2(state.bundle);
  let next = targetMs;
  const effective = schedule.effective[state.effectiveEventIndex]?.effectiveAtMs;
  const observed = schedule.observed[state.observedEventIndex]?.observedAtMs;
  if (effective !== undefined && effective > state.nowMs) next = Math.min(next, effective);
  if (observed !== undefined && observed !== null && observed > state.nowMs) next = Math.min(next, observed);
  for (const facility of effectiveScenarioV2(state.bundle).facilities) if (!state.openedFacilityIds.includes(facility.id) && facility.opensAtMs > state.nowMs) next = Math.min(next, facility.opensAtMs);
  for (const need of state.needs) if (need.nextReportAtMs !== null && need.nextReportAtMs > state.nowMs) next = Math.min(next, need.nextReportAtMs);
  for (const context of effectiveScenarioV2(state.bundle).behavior?.contexts ?? []) if (context.atMs > state.nowMs && !state.consumedOpportunityIds.includes(context.opportunityId)) next = Math.min(next, context.atMs);
  for (const unit of state.units) {
    if (unit.status !== 'working') continue;
    const mission = state.missions.find(item => item.id === unit.missionId)!;
    const remaining = unit.cursor.kind === 'edge' ? unit.cursor.durationMs - unit.cursor.elapsedMs : mission.stageRemainingMs;
    if (remaining > 0) next = Math.min(next, state.nowMs + remaining);
  }
  return next;
}

/** Event integration is exact at integer ms; empty intervals are advanced as one span. */
export function advanceWorld(state: WorldStateV2, targetMs = Math.min(HORIZON_MS, (Math.floor(state.nowMs / MINUTE_MS) + 1) * MINUTE_MS)): WorldStateV2 {
  if (!Number.isSafeInteger(targetMs) || targetMs < state.nowMs || targetMs > HORIZON_MS) throw new Error('Invalid V2 advance time.');
  const next = cloneWorld(state);
  settleBoundary(next);
  while (next.nowMs < targetMs) {
    const atMs = nextWorldBoundaryMs(next, targetMs), elapsed = atMs - next.nowMs;
    if (elapsed <= 0) throw new Error('V2 clock failed to progress.');
    for (const unit of next.units) {
      if (unit.status !== 'working') continue;
      unit.busyMs += elapsed;
      if (unit.cursor.kind === 'edge') { unit.cursor.elapsedMs += elapsed; unit.position = positionAtCursorV2(next.bundle.assets.map, unit.cursor); }
      else {
        const mission = next.missions.find(item => item.id === unit.missionId)!;
        mission.stageRemainingMs = Math.max(0, mission.stageRemainingMs - elapsed);
      }
    }
    next.nowMs = atMs; settleBoundary(next);
  }
  assertWorldInvariants(next); return next;
}

export function dispatchWorld(state: WorldStateV2, command: CommandV2): { state: WorldStateV2; result: CommandOutcomeV2 } {
  const duplicate = state.commands.find(record => record.command.id === command.id);
  if (duplicate) return { state, result: structuredClone(duplicate) };
  const next = cloneWorld(state);
  const reject = (reason: string) => {
    const result = { command: structuredClone(command), accepted: false, reason };
    next.commands.push(result); return { state: next, result: structuredClone(result) };
  };
  if (next.finalized || next.nowMs >= HORIZON_MS) return reject('No new assignments are accepted at the cutoff.');
  if (command.atMs !== next.nowMs || !Number.isSafeInteger(command.sequence) || command.sequence <= (next.commands.at(-1)?.command.sequence ?? 0)) return reject('Command time or sequence is invalid.');
  const unit = next.units.find(item => item.id === command.unitId), home = next.households.find(item => item.id === command.householdId);
  const household = next.bundle.assets.population.households.find(item => item.id === command.householdId);
  if (!unit || !home || !household) return reject('Unknown unit or household.');
  if (unit.status !== 'available' || unit.missionId || unit.cursor.kind !== 'node') return reject('The unit is unavailable.');
  if (home.missionId) return reject('The household already has a committed mission.');
  if (!unit.capabilities.includes(command.action)) return reject('The unit does not have the required capability.');
  const knownNeed = home.known?.needs.find(item => item.id === command.needId);
  if (command.action !== 'check' && (!knownNeed || knownNeed.completedAtMs !== null || knownNeed.kind !== (command.action === 'deliver' ? 'delivery' : 'relocation'))) return reject('A matching observed active need is required.');
  if (command.action === 'check' && command.needId) return reject('A proactive check does not claim a need.');
  let shelter: ScenarioBundleV2['assets']['facilities'][number] | undefined;
  if (command.action === 'transport') {
    const requirement = home.known!.accessiblePlacesRequired;
    const transportUnits = effectiveScenarioV2(next.bundle).resources.units.filter(item => item.capabilities.includes('transport'));
    if (!transportUnits.some(item => item.seats >= home.known!.size && item.accessiblePlaces >= requirement)) return reject('Household transport is unsupported by the modeled whole-household vehicles.');
    if (unit.seats < home.known!.size || unit.accessiblePlaces < requirement) return reject('The vehicle lacks the required included passenger/accessibility places.');
    shelter = effectiveScenarioV2(next.bundle).facilities.find(item => item.id === command.shelterId && item.kind === 'shelter');
    if (!shelter || !next.facilities.find(item => item.id === shelter!.id)!.knownOpen) return reject('The destination shelter is not publicly open.');
    if (requirement > 0 && !shelter.accessible) return reject('The destination shelter does not accept this support requirement.');
    if (facilityTotalsV2(next, shelter.id).available < home.known!.size) return reject('The shelter has insufficient unreserved places.');
  }
  const needsLoad = command.action === 'deliver' && unit.carriedBundles === 0;
  if (command.action === 'deliver' && supplyTotalsV2(next).depotAvailable < 1) return reject('No unreserved household bundles remain at the depot.');
  if (needsLoad) {
    const depot = effectiveScenarioV2(next.bundle).facilities.find(item => item.kind === 'base' && item.nodeId === effectiveScenarioV2(next.bundle).resources.depotNodeId);
    if (depot && !next.facilities.find(item => item.id === depot.id)!.knownOpen) return reject('The depot is not publicly open.');
  }
  const waypoints = [...(needsLoad ? [effectiveScenarioV2(next.bundle).resources.depotNodeId] : []), household.homeNodeId, ...(shelter ? [shelter.nodeId] : [])];
  const route = planRouteV2(next.bundle.assets.map, unit.cursor, waypoints, next.knownClosedEdgeIds);
  if (!route) return reject('No legal route exists in the public routing view.');
  const id = `mission:${command.id}`;
  const mission: MissionStateV2 = { id, unitId: unit.id, householdId: home.id, needId: command.action === 'check' ? null : knownNeed!.id,
    action: command.action, ...(shelter ? { shelterId: shelter.id } : {}), status: 'traveling', dispatchedAtMs: next.nowMs,
    estimatedCompletionAtMs: null, completedAtMs: null, route, routeLegIndex: 0, stageRemainingMs: 0, reason: null, destination: needsLoad ? 'depot' : 'household' };
  if (command.action === 'deliver') next.bundleReservations.push({ missionId: id, unitId: unit.id, status: 'reserved' });
  if (shelter) next.seatReservations.push({ missionId: id, facilityId: shelter.id, places: home.known!.size, status: 'reserved' });
  next.missions.push(mission); unit.missionId = id; unit.status = 'working'; home.missionId = id;
  mission.estimatedCompletionAtMs = next.nowMs + estimateRemaining(next, mission)!;
  const result: CommandOutcomeV2 = { command: structuredClone(command), accepted: true, reason: 'Mission accepted using public evidence.', missionId: id };
  next.commands.push(result);
  appendTraceV2(next, { type: 'mission-dispatched', householdId: home.id, missionId: id, unitId: unit.id,
    ...(mission.needId ? { needId: mission.needId } : {}), message: `Accepted ${command.action} assignment.`, visibility: 'coordinator', source: 'automatic-policy', evidenceIds: [command.id] });
  assertWorldInvariants(next); return { state: next, result: structuredClone(result) };
}

export function assertWorldInvariants(state: WorldStateV2): void {
  const fail = (reason: string): never => { throw new Error(`V2 invariant: ${reason}`); };
  const supply = supplyTotalsV2(state);
  if (Object.values(supply).some(value => !Number.isSafeInteger(value) || value < 0) || supply.initial !== supply.depotAvailable + supply.reserved + supply.loaded + supply.delivered) fail('supply conservation');
  if (new Set(state.bundleReservations.map(item => item.missionId)).size !== state.bundleReservations.length) fail('duplicate bundle reservation');
  if (new Set(state.seatReservations.map(item => item.missionId)).size !== state.seatReservations.length) fail('duplicate shelter reservation');
  for (const facility of effectiveScenarioV2(state.bundle).facilities) {
    const totals = facilityTotalsV2(state, facility.id);
    if (totals.available < 0 || totals.occupied < 0 || totals.reserved < 0 || totals.available + totals.occupied + totals.reserved !== facility.capacity) fail('shelter conservation');
  }
  for (const unit of state.units) {
    const loaded = state.bundleReservations.filter(item => item.unitId === unit.id && item.status === 'loaded').length;
    if (unit.carriedBundles !== loaded || unit.carriedBundles > 1 || unit.carriedBundles < 0) fail('carried bundle conservation');
    if (unit.passengers < 0 || unit.passengers > unit.seats) fail('passenger capacity');
    const active = state.missions.filter(item => item.unitId === unit.id && item.status !== 'completed');
    if (active.length > 1 || (active[0]?.id ?? null) !== unit.missionId) fail('unit commitment');
    if (unit.cursor.kind === 'edge' && (!Number.isSafeInteger(unit.cursor.elapsedMs) || unit.cursor.elapsedMs < 0 || unit.cursor.elapsedMs > unit.cursor.durationMs)) fail('edge progress');
    if (unit.passengers > 0) {
      const mission = active[0], reservation = state.seatReservations.find(item => item.missionId === mission?.id);
      if (!reservation || reservation.status !== 'reserved' || reservation.places !== unit.passengers || mission.action !== 'transport') fail('passenger reservation');
    }
  }
  for (const home of state.households) {
    const active = state.missions.filter(item => item.householdId === home.id && item.status !== 'completed');
    if (active.length > 1 || (active[0]?.id ?? null) !== home.missionId) fail('household commitment');
  }
  for (const need of state.needs) if (need.completedAtMs !== null && !state.missions.some(mission => mission.needId === need.id && mission.completedAtMs === need.completedAtMs)) fail('completion requires actual mission completion');
}
