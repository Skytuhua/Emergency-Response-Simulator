import { effectiveScenarioV2 } from './setup';
import type { ScenarioBundleV2, TraceEventV2, WorldEventV2 } from './contracts';
import type { WorldStateV2 } from './world';
import { compareIdsV2 } from './routes';

const schedules = new WeakMap<ScenarioBundleV2, { effective: WorldEventV2[]; observed: WorldEventV2[] }>();
export function worldSchedulesV2(bundle: ScenarioBundleV2) {
  let schedule = schedules.get(bundle);
  if (!schedule) { schedule = { effective: [...effectiveScenarioV2(bundle).events].sort((a, b) => a.effectiveAtMs - b.effectiveAtMs || compareIdsV2(a.id, b.id)),
    observed: effectiveScenarioV2(bundle).events.filter(event => event.observedAtMs !== null).sort((a, b) => a.observedAtMs! - b.observedAtMs! || compareIdsV2(a.id, b.id)) };
    schedules.set(bundle, schedule); }
  return schedule;
}

export function appendTraceV2(state: WorldStateV2, event: Omit<TraceEventV2, 'id' | 'atMs'>): void {
  // Private activity cannot shift otherwise identical public evidence IDs.
  const sequence=++state.traceSequence[event.visibility];
  state.events.push({ id: `trace:${event.visibility}:${sequence}`, atMs: state.nowMs, ...event });
}

export function revealHouseholdV2(state: WorldStateV2, householdId: string, source: 'report' | 'check', evidenceId: string, text?: string): void {
  const home = state.households.find(item => item.id === householdId)!;
  const record = state.bundle.assets.population.households.find(item => item.id === householdId)!;
  const requirement = state.bundle.assets.support.find(item => item.householdId === householdId)!.accessiblePlacesRequired;
  const needs = state.needs.filter(need => need.householdId === householdId && need.onsetMs <= state.nowMs);
  for (const need of needs) need.discovered = true;
  const history = home.known?.needs ?? [];
  const merged = [...history];
  for (const need of needs) {
    const known = merged.find(item => item.id === need.id);
    if (known) known.completedAtMs = need.completedAtMs;
    else merged.push({ id: need.id, householdId, kind: need.kind, urgent: need.urgent, onsetMs: need.onsetMs, deadlineMs: need.deadlineMs, completedAtMs: need.completedAtMs });
  }
  merged.sort((a, b) => a.onsetMs - b.onsetMs || compareIdsV2(a.id, b.id));
  home.known = { observedAtMs: state.nowMs, receivedAtMs: state.nowMs, size: record.size, accessiblePlacesRequired: requirement,
    needs: merged, source, eventIds: [...(home.known?.eventIds ?? []), evidenceId], text: text ?? `Household check found ${needs.filter(need => need.completedAtMs === null).length} active need(s).` };
  if (home.lastContactAtMs === null) home.lastContactAtMs = state.nowMs;
  if (source === 'check') home.lastCheckAtMs = state.nowMs;
  home.knownCommunicationsAvailable = home.communicationsAvailable;
  appendTraceV2(state, { type: source === 'check' ? 'household-checked' : 'household-observed', householdId,
    message: home.known.text, visibility: 'coordinator', source: 'world-rule', evidenceIds: [evidenceId] });
}

export function applyWorldChangesV2(state: WorldStateV2): void {
  const schedule = worldSchedulesV2(state.bundle);
  for (const facility of effectiveScenarioV2(state.bundle).facilities) {
    if (facility.opensAtMs <= state.nowMs && !state.openedFacilityIds.includes(facility.id)) {
      state.openedFacilityIds.push(facility.id);
      const physical = state.facilities.find(item => item.id === facility.id)!; physical.open = true; physical.knownOpen = true;
    }
  }
  while (schedule.effective[state.effectiveEventIndex]?.effectiveAtMs === state.nowMs) {
    const event = schedule.effective[state.effectiveEventIndex++], payload = event.payload;
    if (payload.type === 'need-onset') {
      if (state.needs.some(need => need.id === payload.need.id)) throw new Error('V2 duplicate canonical need ID.');
      const reporting = effectiveScenarioV2(state.bundle).behaviorRules.reportingHouseholdIds.includes(payload.need.householdId);
      state.needs.push({ ...payload.need, onsetEventId: event.id, completedAtMs: null, discovered: false,
        nextReportAtMs: reporting ? event.effectiveAtMs + effectiveScenarioV2(state.bundle).behaviorRules.reportDelayMs : null, reportAttempt: 0 });
    } else if (payload.type === 'communications-change') {
      for (const id of payload.householdIds) state.households.find(item => item.id === id)!.communicationsAvailable = payload.available;
    } else if (payload.type === 'edge-state-change') {
      for (const id of payload.edgeIds) {
        if (payload.closed && !state.closedEdgeIds.includes(id)) state.closedEdgeIds.push(id);
        if (!payload.closed) state.closedEdgeIds = state.closedEdgeIds.filter(edge => edge !== id);
      }
      state.closedEdgeIds.sort(compareIdsV2);
    } else {
      state.facilities.find(item => item.id === payload.facilityId)!.open = payload.open;
    }
    appendTraceV2(state, { type: 'world-change', message: `Applied ${payload.type}.`, visibility: 'debrief', source: 'world-rule', evidenceIds: [event.id] });
  }
}

export function deliverWorldAnnouncementsV2(state: WorldStateV2): void {
  const schedule = worldSchedulesV2(state.bundle);
  while (schedule.observed[state.observedEventIndex]?.observedAtMs === state.nowMs) {
    const event = schedule.observed[state.observedEventIndex++], payload = event.payload;
    if (payload.type === 'need-onset') revealHouseholdV2(state, payload.need.householdId, 'report', event.id);
    else if (payload.type === 'communications-change') {
      for (const id of payload.householdIds) state.households.find(item => item.id === id)!.knownCommunicationsAvailable = payload.available;
    } else if (payload.type === 'edge-state-change') {
      for (const id of payload.edgeIds) {
        if (payload.closed && !state.knownClosedEdgeIds.includes(id)) state.knownClosedEdgeIds.push(id);
        if (!payload.closed) state.knownClosedEdgeIds = state.knownClosedEdgeIds.filter(edge => edge !== id);
      }
      state.knownClosedEdgeIds.sort(compareIdsV2);
    } else state.facilities.find(item => item.id === payload.facilityId)!.knownOpen = payload.open;
    appendTraceV2(state, { type: 'world-announcement', message: `Received ${payload.type} observation.`, visibility: 'coordinator', source: 'world-rule', evidenceIds: [event.id] });
  }
}
