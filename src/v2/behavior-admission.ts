import type { ScenarioBundleV2 } from './contracts';
import { hashValue } from './hash';
import { parseBehaviorArtifactV2 } from './behavior-artifact';

export interface BehaviorAdmissionV2 { admitted: boolean; errors: string[]; directPersonaActors: number; eligibleActors: number }
export function admitBehaviorV2(bundle: ScenarioBundleV2): BehaviorAdmissionV2 {
  const errors: string[] = [];
  const behavior = bundle.assets.behavior;
  if (!behavior) return { admitted: bundle.hashes.behavior === null, errors: bundle.hashes.behavior === null ? [] : ['behavior-hash-without-artifact'], directPersonaActors: 0, eligibleActors: 0 };
  try {
    const parsed = parseBehaviorArtifactV2(behavior);
    if (hashValue(parsed) !== bundle.hashes.behavior || parsed.populationHash !== bundle.hashes.population || parsed.mapHash !== bundle.hashes.map || parsed.eventTapeHash !== bundle.hashes.events || parsed.supportHash !== bundle.hashes.support) errors.push('behavior-asset-binding-mismatch');
    const households = new Map(bundle.assets.population.households.map(h => [h.id, h]));
    const support = new Map(bundle.assets.support.map(s => [s.householdId, s.accessiblePlacesRequired]));
    const events = [...bundle.assets.events].sort((a, b) => a.effectiveAtMs - b.effectiveAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (bundle.populationMode !== 'mechanics-fixture' && parsed.sourceReceipts.some(r => r.vintage === 'AUTHORED-FIXTURE' || r.url === 'urn:dallas-v2:authored-unit-test')) errors.push('authored-behavior-source-not-release-evidence');
    for (const context of parsed.contexts) {
      if (households.get(context.householdId)?.size !== context.size) errors.push(`behavior-household-mismatch:${context.householdId}`);
      if (support.get(context.householdId) !== context.accessiblePlacesRequired) errors.push(`behavior-support-mismatch:${context.householdId}`);
      let communications = true, need = null;
      for (const event of events) {
        if (event.effectiveAtMs > context.atMs) break;
        if (event.payload.type === 'communications-change' && event.payload.householdIds.includes(context.householdId)) communications = event.payload.available;
        if (event.payload.type === 'need-onset' && event.payload.need.householdId === context.householdId) need = event.payload.need;
      }
      if (context.communicationsAvailable !== communications || hashValue(context.need) !== hashValue(need)) errors.push(`behavior-exogenous-context-mismatch:${context.opportunityId}`);
    }
    return { admitted: !errors.length, errors, directPersonaActors: errors.length ? 0 : parsed.personas.length, eligibleActors: errors.length ? 0 : new Set(parsed.actions.map(a => a.householdId)).size };
  } catch (error) {
    errors.push(`invalid-behavior-artifact:${error instanceof Error ? error.message : 'unknown'}`);
    return { admitted: false, errors, directPersonaActors: 0, eligibleActors: 0 };
  }
}
