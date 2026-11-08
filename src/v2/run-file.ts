import { ENGINE_V2, HORIZON_MS, MINUTE_MS, type CommandOutcomeV2, type CoordinatorObservationV2, type DecisionEvidenceV2, type PolicyIdV2, type ScenarioBundleV2 } from './contracts';
import { admitScenarioV2, boundedJson } from './admission';
import { canonical, hashValue } from './hash';
import { assertV2Structure, V2_LIMITS } from './limits';
import { observeCoordinator } from './observe';
import type { SessionV2 } from './session';
import { summarizeWorld } from './summary';
import { advanceWorld, assertWorldInvariants, dispatchWorld, initializeWorld } from './world';

type RunLineageV2 = NonNullable<SessionV2['lineage']>;
export interface SessionDigestsV2 { stateDigest: string; traceDigest: string; summaryHash: string }
export interface RunFileV2 {
  kind: 'catastrophe-response-run'; version: 2; engineVersion: typeof ENGINE_V2;
  sourceRunId: string; savedAtMs: number; bundle: ScenarioBundleV2;
  policy: PolicyIdV2; coverageFraction: number;
  commands: CommandOutcomeV2[]; decisions: DecisionEvidenceV2[];
  lineage: RunLineageV2 | null; ancestry?: RunLineageV2[];
  expected: SessionDigestsV2;
}

const POLICIES: PolicyIdV2[] = ['received-order-v2', 'urgency-first-v2', 'urgency-plus-coverage-v2'];
const sha = /^[0-9a-f]{64}$/;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Run contains unsupported keys.');
  if (required.some(key => !Object.hasOwn(value, key))) throw new Error('Run is missing required fields.');
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function integer(value: unknown, low: number, high: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < low || value > high) throw new Error(`${label} is outside the supported range.`);
  return value;
}
function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !sha.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}
function text(value: unknown, label: string, max = 1_000): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new Error(`${label} is invalid.`);
  return value;
}
function checkLineage(input: unknown): RunLineageV2 {
  const value = object(input, 'Run lineage'); keys(value, ['sourceRunId', 'sourceSavedAtMs', 'sourceStateDigest']);
  identifier(value.sourceRunId, 'Lineage source run ID');
  integer(value.sourceSavedAtMs, 0, HORIZON_MS, 'Lineage saved time');
  digest(value.sourceStateDigest, 'Lineage source state');
  return value as unknown as RunLineageV2;
}
function appendAncestry(ancestry: RunLineageV2[], edge: RunLineageV2): RunLineageV2[] {
  const previous = ancestry.find(item => item.sourceRunId === edge.sourceRunId);
  if (previous) {
    if (canonical(previous) !== canonical(edge) || ancestry.at(-1) !== previous) throw new Error('Run ancestry contains a cycle or conflicting source.');
    return ancestry;
  }
  if (ancestry.length >= V2_LIMITS.ancestry) throw new Error('Run ancestry exceeds the supported 32-hop limit.');
  return [...ancestry, structuredClone(edge)];
}

function checkCommands(file: RunFileV2): void {
  if (!Array.isArray(file.commands) || file.commands.length > V2_LIMITS.commands) throw new Error('V2 run files support at most 20000 commands.');
  if (!Array.isArray(file.decisions) || file.decisions.length !== file.commands.length) throw new Error('Every V2 command requires exactly one decision evidence record.');
  const units = new Set(file.bundle.resources.units.map(unit => unit.id));
  const homes = new Set(file.bundle.assets.population.households.map(home => home.id));
  const shelters = new Set(file.bundle.assets.facilities.filter(facility => facility.kind === 'shelter').map(facility => facility.id));
  const needs = new Map(file.bundle.assets.events.flatMap(event => event.payload.type === 'need-onset' ? [[event.payload.need.id, event.payload.need] as const] : []));
  const ids = new Set<string>(); let sequence = 0, atMs = 0;
  file.commands.forEach((input, index) => {
    const row = object(input, 'Command outcome'); keys(row, ['command', 'accepted', 'reason', 'missionId'], ['command', 'accepted', 'reason']);
    const command = object(row.command, 'Command');
    keys(command, ['id', 'sequence', 'atMs', 'action', 'unitId', 'householdId', 'needId', 'shelterId'], ['id', 'sequence', 'atMs', 'action', 'unitId', 'householdId']);
    const id = identifier(command.id, 'Command ID');
    if (ids.has(id)) throw new Error('Duplicate command IDs are unsupported.');
    ids.add(id);
    const nextSequence = integer(command.sequence, 1, Number.MAX_SAFE_INTEGER, 'Command sequence');
    const nextTime = integer(command.atMs, 0, file.savedAtMs, 'Command time');
    if (nextSequence <= sequence || nextTime < atMs) throw new Error('Commands are out of order.');
    sequence = nextSequence; atMs = nextTime;
    if (!['check', 'deliver', 'transport'].includes(String(command.action))) throw new Error('Unsupported V2 command action.');
    if (!units.has(identifier(command.unitId, 'Unit ID')) || !homes.has(identifier(command.householdId, 'Household ID'))) throw new Error('Command has a missing unit or household reference.');
    if (command.needId !== undefined) {
      const need = needs.get(identifier(command.needId, 'Need ID'));
      if (!need || need.householdId !== command.householdId || need.onsetMs > nextTime) throw new Error('Command has an invalid need reference.');
    }
    if (command.shelterId !== undefined && !shelters.has(identifier(command.shelterId, 'Shelter ID'))) throw new Error('Command has a missing shelter reference.');
    if (typeof row.accepted !== 'boolean') throw new Error('Command outcome is invalid.');
    text(row.reason, 'Command outcome reason');
    if (row.missionId !== undefined && row.missionId !== `mission:${id}`) throw new Error('Command outcome has an invalid mission reference.');
    if (row.accepted !== (row.missionId !== undefined)) throw new Error('Command outcome mission and acceptance differ.');
    const decision = object(file.decisions[index], 'Decision evidence');
    keys(decision, ['commandId', 'atMs', 'policy', 'observationHash', 'rule', 'evidenceIds']);
    if (identifier(decision.commandId, 'Decision command ID') !== id || decision.atMs !== nextTime) throw new Error('Decision evidence does not match its command.');
    if (decision.policy !== file.policy) throw new Error('Unsupported or inconsistent decision policy.');
    digest(decision.observationHash, 'Decision observation hash'); text(decision.rule, 'Decision rule');
    if (!Array.isArray(decision.evidenceIds) || decision.evidenceIds.length > V2_LIMITS.arrayLength) throw new Error('Decision evidence IDs are invalid.');
    const evidence = decision.evidenceIds.map(value => identifier(value, 'Decision evidence ID'));
    if (new Set(evidence).size !== evidence.length) throw new Error('Duplicate decision evidence IDs are unsupported.');
  });
}

function validate(input: unknown): RunFileV2 {
  assertV2Structure(input);
  const value = object(input, 'V2 run file');
  const required = ['kind', 'version', 'engineVersion', 'sourceRunId', 'savedAtMs', 'bundle', 'policy', 'coverageFraction', 'commands', 'decisions', 'lineage', 'expected'];
  keys(value, [...required, 'ancestry'], required);
  if (value.kind !== 'catastrophe-response-run' || value.version !== 2 || value.engineVersion !== ENGINE_V2) throw new Error('Unsupported V2 run-file kind, version or engine version.');
  const sourceRunId = identifier(value.sourceRunId, 'Source run ID');
  integer(value.savedAtMs, 0, HORIZON_MS, 'Saved time');
  if (!POLICIES.includes(value.policy as PolicyIdV2)) throw new Error('Unsupported V2 policy.');
  if (typeof value.coverageFraction !== 'number' || !Number.isFinite(value.coverageFraction) || value.coverageFraction < 0 || value.coverageFraction > 1) throw new Error('Coverage fraction is outside the supported range.');
  const expected = object(value.expected, 'Expected replay digests'); keys(expected, ['stateDigest', 'traceDigest', 'summaryHash']);
  for (const [key, item] of Object.entries(expected)) digest(item, key);
  if (value.lineage !== null) checkLineage(value.lineage);
  if (value.ancestry !== undefined && !Array.isArray(value.ancestry)) throw new Error('Run ancestry must be an array.');
  const ancestry = (value.ancestry ?? []) as unknown[];
  if (ancestry.length > V2_LIMITS.ancestry) throw new Error('Run ancestry exceeds the supported 32-hop limit.');
  const ancestorIds = new Set<string>();
  for (const input of ancestry) {
    const edge = checkLineage(input);
    if (edge.sourceRunId === sourceRunId || ancestorIds.has(edge.sourceRunId)) throw new Error('Run ancestry contains a cycle.');
    if (edge.sourceSavedAtMs > (value.savedAtMs as number)) throw new Error('Run ancestry saved time exceeds the current saved time.');
    ancestorIds.add(edge.sourceRunId);
  }
  if (value.lineage !== null) {
    const edge = value.lineage as RunLineageV2;
    if (edge.sourceRunId === sourceRunId || edge.sourceSavedAtMs > (value.savedAtMs as number)) throw new Error('Run lineage contains a cycle or invalid saved time.');
    if (ancestry.length && canonical(ancestry.at(-1)) !== canonical(edge)) throw new Error('Run ancestry does not end at its immediate lineage.');
  } else if (ancestry.length) throw new Error('Run ancestry has no immediate lineage.');
  // A command cap is checked before asset hashing, which can be more expensive.
  if (!Array.isArray(value.commands) || value.commands.length > V2_LIMITS.commands) throw new Error('V2 run files support at most 20000 commands.');
  const errors = admitScenarioV2(value.bundle);
  if (errors.length) throw new Error(`V2 scenario admission failed: ${errors.slice(0, 5).join(' ')}`);
  const file = value as unknown as RunFileV2;
  checkCommands(file);
  return file;
}

/**
 * Replay identity retains all physical, knowledge, resource, event, command and
 * decision state. Only world.runId and local playback/continuation metadata are
 * excluded. Assets occur once in the file; their complete bundle hash binds all
 * assets, resource specifications, authored rules and assumptions to this state.
 */
export function digestSessionV2(session: SessionV2): SessionDigestsV2 {
  const { runId: _runId, bundle, ...state } = session.world;
  return {
    stateDigest: hashValue({ bundleHash: hashValue(bundle), state, policy: session.policy, coverageFraction: session.coverageFraction, decisions: session.decisions }),
    traceDigest: hashValue(session.world.events),
    summaryHash: hashValue(summarizeWorld(session.world)),
  };
}

export function makeRunFileV2(session: SessionV2): RunFileV2 {
  if (session.world.events.length > V2_LIMITS.traceEvents) throw new Error('V2 trace exceeds the 100000-event export limit.');
  assertWorldInvariants(session.world);
  assertV2Structure(session.world); assertV2Structure(session.decisions);
  const file: RunFileV2 = {
    kind: 'catastrophe-response-run', version: 2, engineVersion: ENGINE_V2,
    sourceRunId: session.world.runId, savedAtMs: session.world.nowMs,
    bundle: session.world.bundle, policy: session.policy, coverageFraction: session.coverageFraction,
    commands: session.world.commands, decisions: session.decisions,
    lineage: session.lineage, ancestry: session.ancestry ?? [], expected: digestSessionV2(session),
  };
  assertV2Structure(file);
  if (new TextEncoder().encode(JSON.stringify(file)).byteLength > V2_LIMITS.bytes) throw new Error('V2 run exceeds the 32 MiB export limit.');
  return structuredClone(validate(file));
}

/** Structural/source admission only; expensive replay occurs asynchronously. */
export function parseRunFileV2(text: string): RunFileV2 {
  if (typeof text !== 'string') throw new Error('Choose a valid JSON V2 run file.');
  return validate(boundedJson(text));
}

function publicEvidenceIds(observation: CoordinatorObservationV2): Set<string> {
  const ids = new Set<string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    for (const [key, child] of Object.entries(item)) {
      if (key === 'id' && typeof child === 'string') ids.add(child);
      else if ((key === 'eventIds' || key === 'evidenceIds') && Array.isArray(child)) {
        for (const id of child) if (typeof id === 'string') ids.add(id);
      }
      else visit(child);
    }
  };
  visit(observation); return ids;
}

/** Executes retained commands; it never calls an automatic policy or a provider. */
export async function replayV2(input: RunFileV2, newRunId: string = crypto.randomUUID()): Promise<SessionV2> {
  identifier(newRunId, 'Playback run ID');
  // Object callers pass the same source/structure gates as text imports.
  assertV2Structure(input);
  const file = parseRunFileV2(JSON.stringify(input));
  if (newRunId === file.sourceRunId || file.ancestry?.some(edge => edge.sourceRunId === newRunId) || file.lineage?.sourceRunId === newRunId) throw new Error('Replay requires a fresh local run identity.');
  let world = initializeWorld(file.bundle, newRunId);
  let sliceStart = performance.now();
  const yieldWhenNeeded = async (force = false): Promise<void> => {
    if (force || performance.now() - sliceStart >= 12) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  };
  const advanceTo = async (target: number): Promise<void> => {
    // A bounded time slice also keeps a long command-free replay interruptible.
    while (world.nowMs < target) {
      world = advanceWorld(world, Math.min(target, world.nowMs + 5 * MINUTE_MS));
      if (world.events.length > V2_LIMITS.traceEvents) throw new Error('V2 replay trace exceeds the 100000-event limit.');
      await yieldWhenNeeded();
    }
  };
  await yieldWhenNeeded(true);
  for (const [index, expected] of file.commands.entries()) {
    await advanceTo(expected.command.atMs);
    const observation = observeCoordinator(world), evidence = file.decisions[index];
    if (hashValue(observation) !== evidence.observationHash) throw new Error(`Replay public observation differs for command ${expected.command.id}.`);
    const publicIds = publicEvidenceIds(observation);
    if (evidence.evidenceIds.some(id => !publicIds.has(id))) throw new Error(`Replay decision evidence is not public for command ${expected.command.id}.`);
    const dispatched = dispatchWorld(world, expected.command);
    if (canonical(dispatched.result) !== canonical(expected)) throw new Error(`Replay outcome differs for command ${expected.command.id}.`);
    // Match the live coordinator's zero-time stage transition before the next
    // same-time observation, including when this is the final saved command.
    world = advanceWorld(dispatched.state, dispatched.state.nowMs);
    if (world.events.length > V2_LIMITS.traceEvents) throw new Error('V2 replay trace exceeds the 100000-event limit.');
    await yieldWhenNeeded();
  }
  await advanceTo(file.savedAtMs);
  const source: RunLineageV2 = { sourceRunId: file.sourceRunId, sourceSavedAtMs: file.savedAtMs, sourceStateDigest: file.expected.stateDigest };
  let ancestry = structuredClone(file.ancestry ?? []);
  if (file.lineage) ancestry = appendAncestry(ancestry, file.lineage);
  ancestry = appendAncestry(ancestry, source);
  const session: SessionV2 = { world, policy: file.policy, coverageFraction: file.coverageFraction, decisions: structuredClone(file.decisions),
    lineage: source, ancestry, playbackOrigin: 'imported' };
  const actual = digestSessionV2(session);
  for (const key of ['stateDigest', 'traceDigest', 'summaryHash'] as const) if (actual[key] !== file.expected[key]) throw new Error(`Replay ${key} differs from the saved run.`);
  return session;
}

/** A continuation preserves all origin command/decision/event identities. */
export function continueV2(session: SessionV2, newRunId: string = crypto.randomUUID()): SessionV2 {
  identifier(newRunId, 'Continuation run ID');
  if (newRunId === session.world.runId || session.ancestry?.some(edge => edge.sourceRunId === newRunId)) throw new Error('Continuation requires a fresh run identity.');
  const source = session.playbackOrigin === 'imported' && session.lineage ? session.lineage
    : { sourceRunId: session.world.runId, sourceSavedAtMs: session.world.nowMs, sourceStateDigest: digestSessionV2(session).stateDigest };
  const ancestry = appendAncestry(structuredClone(session.ancestry ?? []), source);
  return { ...structuredClone(session), world: { ...structuredClone(session.world), runId: newRunId },
    lineage: structuredClone(source), ancestry, playbackOrigin: 'continued' };
}
