import contract from '../fixtures/actor-context-v1.json';
import preparation from '../fixtures/preparation-manifest-v1.json';
import terraPreparation from '../fixtures/preparation-manifest-terra-low-v1.json';
import type { ActorContext, AgentArtifact } from './model';

export const ACTOR_CONTEXTS = contract.actorContexts as ActorContext[];
export const ACTOR_CONTEXT_DIGEST = '29d76908b9d92d2ec55c705decd710dacee96edaba118b7402b66179960f328f';
export const PREPARATION_INPUT_HASH = '25c44ff50fc81cb8a38b991c56bb71f8736961d3db3337b37c8a7f1cf7565321';
export const TERRA_PREPARATION_INPUT_HASH = '4b5c2eb1432d0146f1e5962df091f993a0a633b25778c605eabdd61c4970e00a';
export const PREPARATION_VERSION = 'catastrophe-preparation-v1';
export const TIMING_MAP_VERSION = 'round0-minute5-v1';
export const MIROFISH_COMMIT = '7657031ac01184afe2cb220f5ee3545573b5e843';

function object(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Artifact must contain objects.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(record, key))) throw new Error('Unsupported or missing artifact keys.');
  return record;
}
function text(value: unknown, max = 12000): asserts value is string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid or oversized artifact text.');
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid artifact list.');
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => JSON.stringify(key) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}

/** Structural compatibility validation, not cryptographic proof of remote authorship. */
export function validateArtifact(input: unknown): AgentArtifact {
  const required = ['version','template','sourceCommit','model','generationOutcome','preparationVersion','timingMapVersion','inputHash','actorContextDigest','actorContexts','profiles','candidates','episode','provenance'];
  const a = object(input, [...required, 'api', 'reasoningEffort'], required);
  if (a.version !== 1 || a.template !== 'storm-v1' || a.sourceCommit !== MIROFISH_COMMIT) throw new Error('Unsupported MiroFish artifact version or source.');
  const supported = a.model === terraPreparation.profiles.model ? terraPreparation : a.model === preparation.profiles.model ? preparation : null;
  if (!supported) throw new Error('Artifact model differs from the supported preparation inputs.');
  const terra = supported === terraPreparation;
  const expectedHash = terra ? TERRA_PREPARATION_INPUT_HASH : PREPARATION_INPUT_HASH;
  if (a.preparationVersion !== PREPARATION_VERSION || a.timingMapVersion !== TIMING_MAP_VERSION || a.inputHash !== expectedHash) throw new Error('MiroFish preparation input identity does not match this exercise.');
  if (terra ? a.api !== 'responses' || a.reasoningEffort !== 'low' : Object.hasOwn(a, 'api') || Object.hasOwn(a, 'reasoningEffort')) throw new Error('Artifact transport or reasoning differs from the supported preparation inputs.');
  if (a.actorContextDigest !== ACTOR_CONTEXT_DIGEST || canonical(a.actorContexts) !== canonical(ACTOR_CONTEXTS)) throw new Error('MiroFish actor context is incompatible with this exercise.');
  text(a.model, 120);
  if (typeof a.generationOutcome !== 'string' || !['target','profiles-only','blocked'].includes(a.generationOutcome)) throw new Error('Unsupported MiroFish integration outcome.');
  const profiles = array(a.profiles, 3);
  const profileIds = new Set();
  let verified = 0;
  for (const value of profiles) {
    const p = object(value, ['householdId','displayName','persona','outcome','instruction']);
    if (!ACTOR_CONTEXTS.some(actor => actor.householdId === p.householdId) || profileIds.has(p.householdId)) throw new Error('Invalid or duplicate profile actor.');
    profileIds.add(p.householdId);
    text(p.displayName, 120); text(p.persona); text(p.instruction);
    if (p.instruction !== supported.entities.find(entity => entity.uuid === p.householdId)?.instruction) throw new Error('Artifact instruction differs from the supported preparation inputs.');
    if (typeof p.outcome !== 'string' || !['llm','rule-fallback'].includes(p.outcome)) throw new Error('Invalid profile generation evidence.');
    if (p.outcome === 'llm') verified++;
  }
  const e = object(a.episode, ['rounds','activeAgents','autonomousActions','seededActions']);
  for (const key of ['rounds','activeAgents','autonomousActions','seededActions']) if (!Number.isInteger(e[key]) || Number(e[key]) < 0 || Number(e[key]) > 100) throw new Error('Invalid social episode counts.');
  if (e.seededActions !== 0 || Number(e.rounds) > 1 || Number(e.activeAgents) > 3) throw new Error('Unsupported social episode settings.');
  const candidates = array(a.candidates, 3);
  const candidateIds = new Set(), sources = new Set();
  for (const value of candidates) {
    const c = object(value, ['sourceActionId','householdId','needId','factRefs','attemptMinute','sourceText']);
    const actor = ACTOR_CONTEXTS.find(actor => actor.householdId === c.householdId);
    if (!actor || actor.needId !== c.needId || canonical(actor.factRefs) !== canonical(c.factRefs) || c.attemptMinute !== 5) throw new Error('Invalid social request fact references.');
    text(c.sourceActionId, 120); text(c.sourceText);
    if (!c.sourceActionId || !c.sourceText || candidateIds.has(c.householdId) || sources.has(c.sourceActionId)) throw new Error('Duplicate or missing social request source.');
    candidateIds.add(c.householdId); sources.add(c.sourceActionId);
    if (!profiles.some(p => (p as Record<string, unknown>).householdId === c.householdId && (p as Record<string, unknown>).outcome === 'llm')) throw new Error('Social request lacks a verified actor profile.');
  }
  if (candidates.length && (e.rounds !== 1 || e.activeAgents !== 3 || Number(e.autonomousActions) < candidates.length)) throw new Error('Social requests lack a valid autonomous episode.');
  if (a.generationOutcome === 'target' && (verified !== 3 || !candidates.length)) throw new Error('Target integration requires three profiles and validated social requests.');
  if (a.generationOutcome === 'profiles-only' && (!verified || candidates.length)) throw new Error('Profiles-only outcome is inconsistent with its evidence.');
  if (a.generationOutcome === 'blocked' && (verified || candidates.length)) throw new Error('Blocked outcome is inconsistent with verified profiles.');
  for (const value of array(a.provenance, 20)) {
    const p = object(value, ['label','detail']); text(p.label, 120); text(p.detail);
  }
  return structuredClone(input) as AgentArtifact;
}
