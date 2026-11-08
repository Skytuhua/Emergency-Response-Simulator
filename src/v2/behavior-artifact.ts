import type { BehaviorArtifactV2, ResidentContextV2 } from './contracts';
import { HORIZON_MS } from './contracts';
import { canonical, hashValue, sha256 } from './hash';

export const BEHAVIOR_MODEL_V2 = 'gpt-6.1-terra';
export const BEHAVIOR_SOURCE_V2 = '7657031ac01184afe2cb220f5ee3545573b5e843';
export const BEHAVIOR_ADAPTER_V2 = 'dallas-behavior-v2.1';
const HASH_KEYS = ['populationHash', 'mapHash', 'eventTapeHash', 'supportHash'] as const;
type ObjectV2 = Record<string, unknown>;
function object(value: unknown, keys: readonly string[]): ObjectV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Behavior requires plain objects.');
  const result = value as ObjectV2;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw new Error('Unsupported or missing behavior fields.');
  return result;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Behavior list limit exceeded.');
  return value;
}
function text(value: unknown, maximum = 12000, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid behavior text.');
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid behavior SHA-256.');
}
function integer(value: unknown, minimum = 0, maximum = HORIZON_MS): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error('Invalid behavior integer.');
}
function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }

/** These contexts contain only actor-local exogenous facts, never assistance history. */
export function validateResidentContextV2(value: unknown): ResidentContextV2 {
  const c = object(value, ['householdId', 'opportunityId', 'atMs', ...HASH_KEYS, 'size', 'accessiblePlacesRequired', 'communicationsAvailable', 'need']);
  text(c.householdId, 240); text(c.opportunityId, 240); integer(c.atMs); integer(c.size, 1, 100); integer(c.accessiblePlacesRequired, 0, 100);
  for (const key of HASH_KEYS) digest(c[key]);
  if (typeof c.communicationsAvailable !== 'boolean') throw new Error('Missing communications state.');
  if (c.need !== null) {
    const n = object(c.need, ['id', 'householdId', 'kind', 'urgent', 'onsetMs', 'deadlineMs']);
    text(n.id, 240); integer(n.onsetMs); integer(n.deadlineMs);
    if (n.householdId !== c.householdId || !['delivery', 'relocation'].includes(String(n.kind)) || typeof n.urgent !== 'boolean' || n.onsetMs > c.atMs || n.deadlineMs < n.onsetMs) throw new Error('Invalid or future actor-local need.');
  }
  return value as ResidentContextV2;
}
export function reportPayloadV2(context: ResidentContextV2) {
  return { kind: 'help_request_v2', householdId: context.householdId, opportunityId: context.opportunityId, contextHash: hashValue(context), needId: context.need?.id ?? null };
}
export function actionInstructionV2(context: ResidentContextV2): string {
  return 'Fictional Dallas exercise. You represent one synthetic household. Actor-local observations: ' + canonical(context) +
    '. Choose CREATE_POST to attempt reporting your current need, or DO_NOTHING to wait. A failed network still permits an attempted report. ' +
    'CREATE_POST is allowed only with a current need, and its content must contain exactly this JSON object, with optional surrounding speech: ' + canonical(reportPayloadV2(context)) +
    '. Do not add physical facts, medical outcomes, global conditions, capacities, or completed assistance. Other households are not observable.';
}
export function personaInstructionV2(context: ResidentContextV2): string {
  return 'Create an illustrative fictional Dallas household representative, not an actual resident. Local household facts: ' + canonical({ householdId: context.householdId, size: context.size, accessiblePlacesRequired: context.accessiblePlacesRequired }) +
    '. Return persona, age and profession as synthetic background. Do not infer a disability, medical priority, real identity or physical outcome. Background is never a triage feature.';
}

/** Extract approved request fields; narrative never changes physical facts. */
export function parseReportV2(content: string, context: ResidentContextV2): void {
  text(content);
  if ([...content].filter(char => char === '{').length > 64) throw new Error('Report JSON candidate limit exceeded.');
  const matches: unknown[] = [];
  let duplicate = false;
  for (let start = 0; start < content.length; start++) {
    if (content[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < content.length; end++) {
      const char = content[end];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const candidate = content.slice(start, end + 1), value = JSON.parse(candidate);
          if (value?.kind === 'help_request_v2') {
            const keys = new Set<string>();
            let level = 0;
            for (let i = 0; i < candidate.length; i++) {
              const char = candidate[i];
              if (char === '{' || char === '[') level++;
              else if (char === '}' || char === ']') level--;
              else if (char === '"') {
                const begins = i++;
                while (i < candidate.length) { if (candidate[i] === '\\') i += 2; else if (candidate[i] === '"') break; else i++; }
                let next = i + 1;
                while (/\s/.test(candidate[next] ?? '') && next < candidate.length) next++;
                if (level === 1 && candidate[next] === ':') {
                  const key = JSON.parse(candidate.slice(begins, i + 1)) as string;
                  if (keys.has(key)) duplicate = true;
                  keys.add(key);
                }
              }
            }
            matches.push(value);
          }
        } catch { /* other prose is not authoritative */ }
        break;
      }
    }
  }
  if (duplicate || !context.need || matches.length !== 1 || !equal(matches[0], reportPayloadV2(context))) throw new Error('Report must contain one exact actor-local request without duplicate keys.');
}

export function validatePreparationManifestV2(value: unknown): ObjectV2 {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as ObjectV2).kind === 'dallas-behavior-preparation-set') {
    const set = object(value, ['kind', 'version', 'manifests']);
    const inputs = list(set.manifests, 4);
    if (set.version !== 2 || !inputs.length || inputs.some(m => !m || (m as ObjectV2).kind !== 'dallas-behavior-preparation')) throw new Error('Unsupported cohort set.');
    const manifests = inputs.map(validatePreparationManifestV2);
    const merged = { ...manifests[0] };
    for (const key of ['actors', 'contexts', 'prompts', 'logicalOpportunities']) merged[key] = manifests.flatMap(m => m[key] as unknown[]);
    const actors = merged.actors as ObjectV2[];
    if (manifests.some(m => HASH_KEYS.some(key => m[key] !== merged[key])) || new Set(actors.map(a => a.householdId)).size !== actors.length || new Set(manifests.map(m => (m.actors as ObjectV2[])[0].cohortId)).size !== manifests.length || new Set(merged.logicalOpportunities as unknown[]).size !== (merged.logicalOpportunities as unknown[]).length) throw new Error('Repeated actor/opportunity/cohort or mismatched assets.');
    return merged;
  }
  const m = object(value, ['kind', 'version', 'sourceCommit', 'adapterVersion', ...HASH_KEYS, 'api', 'reasoningEffort', 'profiles', 'social', 'actors', 'contexts', 'prompts', 'logicalOpportunities']);
  if (m.kind !== 'dallas-behavior-preparation' || m.version !== 2 || m.sourceCommit !== BEHAVIOR_SOURCE_V2 || m.adapterVersion !== BEHAVIOR_ADAPTER_V2 || m.api !== 'responses' || m.reasoningEffort !== 'low') throw new Error('Unsupported behavior preparation.');
  for (const key of HASH_KEYS) digest(m[key]);
  if (!equal(m.profiles, { model: BEHAVIOR_MODEL_V2, sdkRetries: 0, upstreamPaidRetries: 0, maxOutputTokens: 4096, requestBytesLimit: 50000 }) || !equal(m.social, { actions: ['CREATE_POST', 'DO_NOTHING'], roundsPerOpportunity: 1, seededActions: 0, maxCallsPerOpportunity: 2, platformObservation: 'no-other-household-posts' })) throw new Error('Unsupported model, retry or action settings.');
  const actors = list(m.actors, 6).map(value => object(value, ['householdId', 'cohortId']));
  if (!actors.length) throw new Error('An artifact manifest requires an actor.');
  for (const actor of actors) { text(actor.householdId, 240); text(actor.cohortId, 240); }
  if (new Set(actors.map(a => a.householdId)).size !== actors.length || new Set(actors.map(a => a.cohortId)).size !== 1) throw new Error('Invalid cohort identities.');
  const contexts = list(m.contexts, 12).map(validateResidentContextV2);
  if (!contexts.length || new Set(contexts.map(c => c.opportunityId)).size !== contexts.length || contexts.some(c => !actors.some(a => a.householdId === c.householdId) || HASH_KEYS.some(key => c[key] !== m[key]))) throw new Error('Invalid or mismatched manifest contexts.');
  const expected: ObjectV2[] = [];
  const sorted = [...actors].sort((a, b) => String(a.householdId) < String(b.householdId) ? -1 : String(a.householdId) > String(b.householdId) ? 1 : 0);
  if (!equal(sorted, actors)) throw new Error('Actor order must be canonical.');
  for (const actor of actors) {
    const selected = contexts.filter(c => c.householdId === actor.householdId);
    if (!selected.length || selected.length > 2) throw new Error('Only two social opportunities per actor are supported.');
    const persona = personaInstructionV2(selected[0]);
    expected.push({ id: `persona:${actor.householdId}`, kind: 'persona', householdId: actor.householdId, opportunityId: null, contextHash: null, text: persona, sha256: sha256(persona) });
    for (const context of selected) {
      const instruction = actionInstructionV2(context);
      expected.push({ id: context.opportunityId, kind: 'action', householdId: actor.householdId, opportunityId: context.opportunityId, contextHash: hashValue(context), text: instruction, sha256: sha256(instruction) });
    }
  }
  if (!equal(m.prompts, expected) || !equal(m.logicalOpportunities, expected.map(p => p.id))) throw new Error('Manifest prompt hashes or opportunity identities differ.');
  return m;
}

/** Portable validation establishes retained source consistency, not provider authentication. */
export function parseBehaviorArtifactV2(input: unknown): BehaviorArtifactV2 {
  // Bound expansion before canonical hashing. No caller-controlled limit profile.
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).length > 4_000_000) throw new Error('Behavior artifact byte limit exceeded.');
  const a = object(input, ['kind', 'version', 'manifestHash', ...HASH_KEYS, 'personas', 'contexts', 'actions', 'sourceCommit', 'adapterVersion', 'sourceReceipts', 'preparationManifest', 'evidence']);
  if (a.kind !== 'dallas-prepared-behavior' || a.version !== 2 || a.sourceCommit !== BEHAVIOR_SOURCE_V2 || a.adapterVersion !== BEHAVIOR_ADAPTER_V2) throw new Error('Unsupported behavior artifact.');
  const m = validatePreparationManifestV2(a.preparationManifest);
  if (a.manifestHash !== hashValue(a.preparationManifest) || !equal(a.contexts, m.contexts) || HASH_KEYS.some(key => a[key] !== m[key])) throw new Error('Behavior manifest or binding mismatch.');
  const prompts = m.prompts as ObjectV2[];
  const receipts = new Map<string, ObjectV2>();
  for (const value of list(a.sourceReceipts, 256)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source receipt.');
    const r = value as ObjectV2;
    object(r, Object.hasOwn(r, 'notes') ? ['id', 'url', 'retrievedAt', 'sha256', 'bytes', 'vintage', 'license', 'status', 'notes'] : ['id', 'url', 'retrievedAt', 'sha256', 'bytes', 'vintage', 'license', 'status']);
    for (const key of ['id', 'url', 'retrievedAt', 'vintage', 'license']) text(r[key], 2000);
    digest(r.sha256); integer(r.bytes, 1, 2_000_000);
    if (r.status !== 'retained' || receipts.has(String(r.id)) || !/^https:\/\/api\.openai\.com\/|^urn:dallas-v2:/.test(String(r.url))) throw new Error('Source receipt must be retained and use a safe reference.');
    if (r.notes !== undefined) for (const note of list(r.notes, 10)) text(note, 2000);
    receipts.set(String(r.id), r);
  }
  const evidence = new Map<string, ObjectV2>();
  for (const value of list(a.evidence, 168)) {
    const e = object(value, ['id', 'kind', 'payload', 'sha256']); text(e.id, 480);
    if (evidence.has(e.id) || e.sha256 !== hashValue(e.payload)) throw new Error('Duplicate or tampered evidence.');
    if (e.kind === 'persona-response' || e.kind === 'action-response') {
      const p = object(e.payload, ['model', 'reasoningEffort', 'api', 'status', 'sourceResponseHash', 'requestHash', 'promptHash', 'householdId', 'opportunityId', 'contextHash', 'outputText', 'toolCalls']);
      if (p.model !== BEHAVIOR_MODEL_V2 || p.reasoningEffort !== 'low' || p.api !== 'responses' || p.status !== 'completed') throw new Error('Wrong response model or completion.');
      for (const key of ['sourceResponseHash', 'requestHash', 'promptHash']) digest(p[key]);
      text(p.householdId, 240); text(p.outputText, 12000, true);
      const matching = prompts.filter(prompt => prompt.householdId === p.householdId && prompt.opportunityId === p.opportunityId);
      if (matching.length !== 1 || matching[0].sha256 !== p.promptHash || matching[0].contextHash !== p.contextHash) throw new Error('Response prompt/context mismatch.');
      const tools = list(p.toolCalls, 1);
      for (const value of tools) { const tool = object(value, ['name', 'arguments', 'callId']); text(tool.arguments); text(tool.callId, 240); if (!['create_post', 'do_nothing'].includes(String(tool.name))) throw new Error('Unsupported function action.'); }
      if (e.kind === 'persona-response' && (p.opportunityId !== null || tools.length)) throw new Error('Persona is not a live action.');
      if (receipts.get(`response:${p.sourceResponseHash}`)?.sha256 !== p.sourceResponseHash) throw new Error('Missing retained response receipt.');
    } else if (e.kind === 'upstream-action') {
      const p = object(e.payload, ['householdId', 'opportunityId', 'agentId', 'actionType', 'content', 'sourceActionId', 'sourceResponseHash', 'responseEvidenceId', 'autonomous', 'successful', 'sourceTraceHash']);
      for (const key of ['householdId', 'opportunityId', 'sourceActionId', 'responseEvidenceId']) text(p[key], 480);
      integer(p.agentId, 0, 5); text(p.content, 12000, true); digest(p.sourceResponseHash); digest(p.sourceTraceHash);
      if (p.autonomous !== true || p.successful !== true || receipts.get(`trace:${p.sourceActionId}`)?.sha256 !== p.sourceTraceHash) throw new Error('Missing successful autonomous trace.');
    } else throw new Error('Unsupported evidence kind.');
    evidence.set(e.id, e);
  }
  const personas = new Set<string>();
  for (const value of list(a.personas, 24)) {
    const p = object(value, ['householdId', 'persona', 'age', 'profession', 'sourceResponseHash', 'model', 'reasoningEffort', 'origin']);
    text(p.householdId, 240); text(p.persona); text(p.profession, 240); integer(p.age, 0, 120);
    if (personas.has(p.householdId) || p.model !== BEHAVIOR_MODEL_V2 || p.reasoningEffort !== 'low' || p.origin !== 'llm-direct') throw new Error('Invalid direct persona.');
    const matches = [...evidence.values()].filter(e => e.kind === 'persona-response' && (e.payload as ObjectV2).householdId === p.householdId && (e.payload as ObjectV2).sourceResponseHash === p.sourceResponseHash);
    if (matches.length !== 1) throw new Error('Persona lacks exact source response.');
    const raw = JSON.parse(String((matches[0].payload as ObjectV2).outputText));
    if (!raw || ['persona', 'age', 'profession'].some(key => raw[key] !== p[key])) throw new Error('Persona is not exactly model-authored.');
    personas.add(p.householdId);
  }
  const seen = new Set(), sources = new Set();
  for (const value of list(a.actions, 48)) {
    const action = object(value, ['id', 'householdId', 'opportunityId', 'atMs', 'contextHash', 'action', 'text', 'sourceResponseHash', 'sourceActionId', 'origin', 'model', 'reasoningEffort']);
    text(action.id, 480); text(action.text, 12000, action.action === 'wait');
    if (!personas.has(String(action.householdId)) || seen.has(action.opportunityId) || sources.has(action.sourceActionId) || action.model !== BEHAVIOR_MODEL_V2 || action.reasoningEffort !== 'low' || action.origin !== 'llm-direct') throw new Error('Action lacks unique admitted actor.');
    const contexts = (a.contexts as ResidentContextV2[]).filter(c => c.householdId === action.householdId && c.opportunityId === action.opportunityId);
    if (contexts.length !== 1 || action.contextHash !== hashValue(contexts[0]) || action.atMs !== contexts[0].atMs) throw new Error('Action context mismatch.');
    const traces = [...evidence.values()].filter(e => e.kind === 'upstream-action' && (e.payload as ObjectV2).sourceActionId === action.sourceActionId);
    if (traces.length !== 1) throw new Error('Action lacks exact platform source.');
    const trace = traces[0].payload as ObjectV2;
    const responseItem = evidence.get(String(trace.responseEvidenceId));
    if (!responseItem || responseItem.kind !== 'action-response') throw new Error('Trace lacks model action response.');
    const response = responseItem.payload as ObjectV2;
    if (['householdId', 'opportunityId', 'sourceResponseHash'].some(k => trace[k] !== action[k] || response[k] !== action[k]) || trace.content !== action.text || response.contextHash !== action.contextHash) throw new Error('Action source chain mismatch.');
    const cohortId = (m.actors as ObjectV2[]).find(actor => actor.householdId === action.householdId)?.cohortId;
    const cohortActors = (m.actors as ObjectV2[]).filter(actor => actor.cohortId === cohortId);
    if (cohortActors[Number(trace.agentId)]?.householdId !== action.householdId || (response.toolCalls as unknown[]).length !== 1) throw new Error('Platform actor identity mismatch.');
    const tool = (response.toolCalls as ObjectV2[])[0];
    const args = JSON.parse(String(tool.arguments));
    if (action.action === 'report') {
      if (trace.actionType !== 'create_post' || tool.name !== 'create_post' || !equal(args, { content: action.text })) throw new Error('Report was not selected and executed.');
      parseReportV2(action.text, contexts[0]);
    } else if (action.action !== 'wait' || action.text !== '' || trace.actionType !== 'do_nothing' || tool.name !== 'do_nothing' || !equal(args, {})) throw new Error('Wait was not selected and executed.');
    seen.add(action.opportunityId); sources.add(action.sourceActionId);
  }
  return structuredClone(input) as BehaviorArtifactV2;
}
export const validateBehaviorArtifactV2 = parseBehaviorArtifactV2;
