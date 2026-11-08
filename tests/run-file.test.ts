import { describe, expect, it } from 'vitest';
import { createScenario, DEFAULT_CONFIG } from '../src/scenario';
import { initialize, dispatch, advanceMinute } from '../src/sim/engine';
import { summarize } from '../src/sim/results';
import { makeRunFile, parseRunFile, replay } from '../src/run-file';

function savedRun() {
  let state = initialize(createScenario(DEFAULT_CONFIG, null), 'original');
  state = dispatch(state, { runId: state.runId, commandId: 'check-19', sequence: 1, minute: 0, action: 'ASSESS', unitId: 'C1', householdId: 'H19' }).state;
  for (let i = 0; i < 17; i++) state = advanceMinute(state);
  return state;
}
describe('bounded deterministic run files', () => {
  it('replays a minute-17 run with a new identity and identical summary', () => {
    const original = savedRun();
    const file = parseRunFile(JSON.stringify(makeRunFile(original)));
    const restored = replay(file);
    expect(restored.minute).toBe(17);
    expect(restored.runId).not.toBe(original.runId);
    expect(summarize(restored)).toEqual(summarize(original));
    expect(restored.commands[0].command.runId).toBe(restored.runId);
    let a = original, b = restored;
    while (a.minute < 60) { a = advanceMinute(a); b = advanceMinute(b); }
    expect(summarize(a)).toEqual(summarize(b));
  });
  it('exports complete final runs and isolates returned objects', () => {
    let state = savedRun();
    while (state.minute < 60) state = advanceMinute(state);
    const file = makeRunFile(state);
    expect(replay(parseRunFile(JSON.stringify(file))).finalized).toBe(true);
    file.scenario.config.seed = 900;
    expect(state.scenario.config.seed).toBe(42);
  });
  it('rejects edited truth and summaries', () => {
    const file = makeRunFile(savedRun());
    file.scenario.households[0].size = 99;
    expect(() => parseRunFile(JSON.stringify(file))).toThrow(/scenario|conditions/i);
    const summary = makeRunFile(savedRun());
    summary.expectedSummary.contactCount = 999;
    expect(() => parseRunFile(JSON.stringify(summary))).toThrow(/summary|replay/i);
  });
  it('rejects command identity, order, arguments and expected outcome tampering', () => {
    for (const edit of [
      (f: ReturnType<typeof makeRunFile>) => { f.commands[0].command.runId = 'alien'; },
      (f: ReturnType<typeof makeRunFile>) => { f.commands[0].command.minute = 18; },
      (f: ReturnType<typeof makeRunFile>) => { f.commands.push(structuredClone(f.commands[0])); },
      (f: ReturnType<typeof makeRunFile>) => { f.commands[0].command.householdId = 'H99'; },
      (f: ReturnType<typeof makeRunFile>) => { f.commands[0].result.accepted = !f.commands[0].result.accepted; },
    ]) {
      const file = makeRunFile(savedRun()); edit(file);
      expect(() => parseRunFile(JSON.stringify(file))).toThrow();
    }
  });
  it('rejects oversized, malformed, unsupported and extra-key input', () => {
    expect(() => parseRunFile('x'.repeat(1_048_577))).toThrow(/1 MiB/);
    expect(() => parseRunFile('{')).toThrow(/JSON/);
    const file = makeRunFile(savedRun());
    expect(() => parseRunFile(JSON.stringify({ ...file, version: 2 }))).toThrow(/version/);
    expect(() => parseRunFile(JSON.stringify({ ...file, remoteUrl: 'https://example.com' }))).toThrow(/unsupported|unexpected/i);
    expect(() => parseRunFile(JSON.stringify({ ...file, commands: Array(501).fill(file.commands[0]) }))).toThrow(/500/);
  });
  it('does not mutate current state when imports fail', () => {
    const state = savedRun(); const before = JSON.stringify(state);
    expect(() => parseRunFile('{"kind":"wrong"}')).toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });
});
