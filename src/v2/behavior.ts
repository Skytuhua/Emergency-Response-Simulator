import type { ResidentContextV2, ScenarioBundleV2 } from './contracts';
import { hashValue } from './hash';
import { parseBehaviorArtifactV2, validateResidentContextV2 } from './behavior-artifact';
import { effectiveScenarioV2 } from './setup';

export interface ResidentOpportunityInputV2 extends Omit<ResidentContextV2, 'populationHash' | 'mapHash' | 'eventTapeHash' | 'supportHash'> { completedAssistance: readonly string[] }
export interface ResidentOpportunityResultV2 {
  action: 'report' | 'wait'; source: 'llm-direct' | 'behavior-model'; origin: 'llm-direct' | 'behavior-model-fallback' | 'suppressed';
  text: string; evidenceIds: string[]; suppressed: boolean; fallback: boolean; fallbackReason: string | null; directActions: 0 | 1;
}

/** Pure offline selection. Scheduling, delivery failure/retry and deduplication belong to the world. */
export function evaluateResidentOpportunityV2(bundle: ScenarioBundleV2, input: ResidentOpportunityInputV2): ResidentOpportunityResultV2 {
  const fallback = (reason: string): ResidentOpportunityResultV2 => ({
    action: input.need && input.need.onsetMs <= input.atMs && effectiveScenarioV2(bundle).behaviorRules.reportingHouseholdIds.includes(input.householdId) ? 'report' : 'wait',
    source: 'behavior-model', origin: 'behavior-model-fallback', text: '', evidenceIds: [input.opportunityId], suppressed: false, fallback: true, fallbackReason: reason, directActions: 0,
  });
  if (input.need && input.completedAssistance.includes(input.need.id)) return { action: 'wait', source: 'behavior-model', origin: 'suppressed', text: '', evidenceIds: [input.opportunityId, input.need.id], suppressed: true, fallback: false, fallbackReason: null, directActions: 0 };
  const runtime=effectiveScenarioV2(bundle),artifact=runtime.behavior;
  if (!artifact) return fallback((bundle.setup?.scenario??'storm')!=='storm'?'different-disaster-scenario':bundle.setup?.roads.length?'custom-road-conditions':'no-prepared-artifact');
  if (artifact.populationHash !== bundle.hashes.population || artifact.mapHash !== bundle.hashes.map || artifact.eventTapeHash !== runtime.eventTapeHash || artifact.supportHash !== bundle.hashes.support) return fallback('artifact-binding-mismatch');
  const prepared = artifact.actions.filter(a => a.householdId === input.householdId && a.opportunityId === input.opportunityId);
  if (!prepared.length) return fallback(artifact.personas.some(p => p.householdId === input.householdId) ? 'missing-prepared-opportunity' : 'actor-not-prepared');
  const context: ResidentContextV2 = { householdId: input.householdId, opportunityId: input.opportunityId, atMs: input.atMs,
    populationHash: bundle.hashes.population, mapHash: bundle.hashes.map, eventTapeHash: runtime.eventTapeHash, supportHash: bundle.hashes.support,
    size: input.size, accessiblePlacesRequired: input.accessiblePlacesRequired, communicationsAvailable: input.communicationsAvailable, need: input.need };
  try { validateResidentContextV2(context); } catch { return fallback('invalid-local-context'); }
  if (prepared.length !== 1 || prepared[0].contextHash !== hashValue(context)) return fallback('context-mismatch');
  try {
    parseBehaviorArtifactV2(artifact);
    if (hashValue(artifact) !== bundle.hashes.behavior) return fallback('artifact-hash-mismatch');
  } catch { return fallback('invalid-prepared-source-chain'); }
  const action = prepared[0];
  if (action.action === 'report' && !input.need) return fallback('illegal-prepared-report');
  return { action: action.action, source: 'llm-direct', origin: 'llm-direct', text: action.text, evidenceIds: [action.id, action.sourceActionId, action.sourceResponseHash, action.contextHash], suppressed: false, fallback: false, fallbackReason: null, directActions: 1 };
}
