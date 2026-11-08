import type { Command, CommandRecord, CommandResult, RunFile, SimState } from './model';
import { createScenario, parseConfig } from './scenario';
import { validateArtifact } from './artifact';
import { initialize, dispatch, advanceMinute } from './sim/engine';
import { summarize } from './sim/results';

export const MAX_RUN_BYTES = 1_048_576;
export const MAX_COMMANDS = 500;
const TOP_KEYS = ['kind', 'version', 'sourceRunId', 'config', 'scenario', 'artifact', 'commands', 'savedMinute', 'expectedSummary'];

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Run contains unsupported keys.');
  if (required.some(key => !Object.hasOwn(value, key))) throw new Error('Run is missing required fields.');
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function integer(value: unknown, low: number, high: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) throw new Error(`${label} is outside the supported range.`);
  return value;
}
// Sorting object keys makes replay checks independent of JSON property order.
function canonical(value: unknown, depth = 0): string {
  if (depth > 24) throw new Error('Run nesting is too deep.');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Run contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (value.length > 16_384) throw new Error('Run text exceeds the supported length.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 5000) throw new Error('Run array exceeds the supported length.');
    return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  }
  const object = record(value, 'Run field');
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(',')}}`;
}
function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }

function commandRecord(input: unknown, file: RunFile, previousSequence: number, previousMinute: number, ids: Set<string>): CommandRecord {
  const row = record(input, 'Command record'); keys(row, ['command', 'result']);
  const c = record(row.command, 'Command');
  keys(c, ['runId', 'commandId', 'sequence', 'minute', 'action', 'unitId', 'householdId', 'shelterId'], ['runId', 'commandId', 'sequence', 'minute', 'action', 'unitId', 'householdId']);
  if (identifier(c.runId, 'Command run ID') !== file.sourceRunId) throw new Error('Command belongs to a different source run.');
  const commandId = identifier(c.commandId, 'Command ID');
  if (ids.has(commandId)) throw new Error('Duplicate command IDs are not supported.');
  ids.add(commandId);
  const sequence = integer(c.sequence, 1, Number.MAX_SAFE_INTEGER, 'Command sequence');
  const minute = integer(c.minute, 0, file.savedMinute, 'Command minute');
  if (sequence <= previousSequence || minute < previousMinute) throw new Error('Commands are out of order.');
  if (typeof c.action !== 'string' || !['ASSESS', 'DELIVER', 'RELOCATE'].includes(c.action)) throw new Error('Unsupported command action.');
  const unitId = identifier(c.unitId, 'Unit ID'), householdId = identifier(c.householdId, 'Household ID');
  if (!file.scenario.units.some(unit => unit.id === unitId) || !file.scenario.households.some(household => household.id === householdId)) throw new Error('Command has a missing unit or household reference.');
  if (c.shelterId !== undefined && !file.scenario.shelters.some(shelter => shelter.id === identifier(c.shelterId, 'Shelter ID'))) throw new Error('Command has a missing shelter reference.');
  const result = record(row.result, 'Command result');
  keys(result, ['accepted', 'reason', 'missionId'], ['accepted', 'reason']);
  if (typeof result.accepted !== 'boolean' || typeof result.reason !== 'string' || result.reason.length > 1000) throw new Error('Command outcome is invalid.');
  if (result.missionId !== undefined) identifier(result.missionId, 'Mission ID');
  return { command: c as unknown as Command, result: result as unknown as CommandResult };
}

function execute(file: RunFile, runId: string): SimState {
  let state = initialize(structuredClone(file.scenario), runId);
  for (const row of file.commands) {
    while (state.minute < row.command.minute) state = advanceMinute(state);
    const dispatched = dispatch(state, { ...row.command, runId });
    if (!equal(dispatched.result, row.result)) throw new Error(`Replay outcome differs for command ${row.command.commandId}.`);
    state = dispatched.state;
  }
  while (state.minute < file.savedMinute) state = advanceMinute(state);
  if (!equal(summarize(state), file.expectedSummary)) throw new Error('Replay summary differs from the saved run.');
  return state;
}

function validate(input: unknown): RunFile {
  const object = record(input, 'Run file'); keys(object, TOP_KEYS);
  canonical(object);
  if (object.kind !== 'catastrophe-response-run') throw new Error('This is not a catastrophe response run file.');
  if (object.version !== 1) throw new Error('Unsupported run-file version.');
  const sourceRunId = identifier(object.sourceRunId, 'Source run ID');
  const config = parseConfig(object.config);
  const artifact = object.artifact === null ? null : validateArtifact(object.artifact);
  const scenario = createScenario(config, artifact);
  if (!equal(scenario, object.scenario)) throw new Error('Stored scenario does not match its supported initial conditions.');
  const savedMinute = integer(object.savedMinute, 0, 60, 'Saved minute');
  if (!Array.isArray(object.commands) || object.commands.length > MAX_COMMANDS) throw new Error('Run files support at most 500 commands.');
  const file: RunFile = { kind: 'catastrophe-response-run', version: 1, sourceRunId, config, scenario, artifact, savedMinute, commands: [], expectedSummary: object.expectedSummary as RunFile['expectedSummary'] };
  const ids = new Set<string>(); let sequence = 0, minute = 0;
  for (const row of object.commands) {
    const checked = commandRecord(row, file, sequence, minute, ids);
    sequence = checked.command.sequence; minute = checked.command.minute;
    file.commands.push(checked);
  }
  execute(file, `validation-${crypto.randomUUID()}`);
  return structuredClone(file);
}

export function makeRunFile(state: SimState): RunFile {
  if (state.commands.length > MAX_COMMANDS) throw new Error('Run exceeds the 500-command export limit.');
  const file: RunFile = structuredClone({
    kind: 'catastrophe-response-run', version: 1, sourceRunId: state.runId,
    config: state.scenario.config, scenario: state.scenario, artifact: state.scenario.artifact,
    commands: state.commands, savedMinute: state.minute, expectedSummary: summarize(state),
  });
  if (new TextEncoder().encode(JSON.stringify(file)).byteLength > MAX_RUN_BYTES) throw new Error('Run exceeds the 1 MiB export limit.');
  return file;
}

export function parseRunFile(text: string): RunFile {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_RUN_BYTES) throw new Error('Choose a run file no larger than 1 MiB.');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('Choose a valid JSON run file.'); }
  return validate(input);
}

export function replay(file: RunFile): SimState {
  // Recheck callers that supply objects without going through the file picker.
  const checked = parseRunFile(JSON.stringify(file));
  return execute(checked, crypto.randomUUID());
}

export function downloadRun(state: SimState): void {
  const blob = new Blob([JSON.stringify(makeRunFile(state), null, 2)], { type: 'application/json' });
  if (blob.size > MAX_RUN_BYTES) throw new Error('Run exceeds the 1 MiB export limit.');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `response-run-${state.scenario.config.seed}-minute-${state.minute}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
