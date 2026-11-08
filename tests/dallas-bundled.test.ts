import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dallasData from '../public/data/mirofish-dallas-v1.json';
import dallasManifest from '../fixtures/preparation-manifest-dallas-terra-low-v1.json';
import legacyData from '../public/data/mirofish-v1.json';
import legacyRun from '../public/data/default-run.json';
import { DALLAS_TERRA_PREPARATION_INPUT_HASH, validateArtifact } from '../src/artifact';
import { createScenario, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { advanceMinute, dispatch, initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { summarize } from '../src/sim/results';
import { getSuggestedAssignment } from '../src/ui/suggestions';
import { MAX_COMMANDS, MAX_RUN_BYTES, makeRunFile, parseRunFile, replay } from '../src/run-file';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;

describe('Dallas bundled preparation and authored replay witness', () => {
  it('pins the actual Dallas Terra low contract and six-call target preparation', () => {
    const artifact = validateArtifact(dallasData);
    expect(artifact.template).toBe('storm-dallas-v1');
    expect(artifact.model).toBe('gpt-6.1-terra');
    expect(artifact.api).toBe('responses');
    expect(artifact.reasoningEffort).toBe('low');
    expect(artifact.generationOutcome).toBe('target');
    expect(artifact.inputHash).toBe(DALLAS_TERRA_PREPARATION_INPUT_HASH);
    expect(createHash('sha256').update(JSON.stringify(canonical(dallasManifest))).digest('hex')).toBe(DALLAS_TERRA_PREPARATION_INPUT_HASH);
    expect(artifact.profiles.filter(profile => profile.outcome === 'llm')).toHaveLength(3);
    expect(artifact.candidates).toHaveLength(3);
    expect(artifact.episode).toEqual({ rounds: 1, activeAgents: 3, autonomousActions: 3, seededActions: 0 });
    expect(JSON.parse(artifact.provenance.find(entry => entry.label === 'Usage')!.detail).calls).toBe(6);
  });

  it('replays a legal scripted six-need response with Dallas 6/12/21 timing', () => {
    // This is an authored feasibility witness. It does not evaluate the public priority policy.
    const file = parseRunFile(readFileSync('public/data/default-dallas-run.json', 'utf8'));
    expect(file.config).toEqual(DALLAS_DEFAULT_CONFIG);
    expect(file.artifact).toEqual(validateArtifact(dallasData));
    let state = initialize(file.scenario, file.sourceRunId);
    for (const row of file.commands) {
      while (state.minute < row.command.minute) state = advanceMinute(state);
      const view = observe(state);
      if (row.command.action !== 'ASSESS') expect(view.households.find(home => home.id === row.command.householdId)?.known?.need).toBeTruthy();
      expect(getSuggestedAssignment(view, row.command.householdId, row.command.action, row.command.unitId)).toEqual({
        action: row.command.action, unitId: row.command.unitId, householdId: row.command.householdId,
        ...(row.command.shelterId ? { shelterId: row.command.shelterId } : {}),
      });
      const outcome = dispatch(state, row.command);
      expect(outcome.result.accepted).toBe(true);
      state = outcome.state;
    }
    while (!state.finalized) state = advanceMinute(state);
    const restored = replay(file);
    expect(summarize(restored)).toEqual(summarize(state));
    expect(summarize(restored)).toMatchObject({ assistanceCompleted: 6, timelyUrgentCount: 3, kitsConsumed: 3, shelterOccupancy: 9, stillUndiscovered: 0 });
    expect(restored.missions.find(mission => mission.householdId === 'H19' && mission.action === 'ASSESS')).toMatchObject({ dispatchedAt: 0, completionAt: 6 });
    expect(restored.missions.find(mission => mission.householdId === 'H19' && mission.action === 'RELOCATE')).toMatchObject({ unitId: 'V1', dispatchedAt: 6, pickupAt: 12, completionAt: 21 });
    expect(restored.scenario.households).toEqual(createScenario(DALLAS_DEFAULT_CONFIG, null).households);
  });

  it('exports and replays 500 commands under 1 MiB with the actual Dallas artifact', () => {
    let state = initialize(createScenario(DALLAS_DEFAULT_CONFIG, validateArtifact(dallasData)), 'dallas-500-command-stress');
    for (let sequence = 1; sequence <= MAX_COMMANDS; sequence++) {
      state = dispatch(state, { action: 'ASSESS', householdId: 'H19', unitId: 'C1', runId: state.runId, commandId: `stress-${sequence}`, sequence, minute: 0 }).state;
    }
    expect(state.commands).toHaveLength(500);
    expect(state.commands.filter(row => row.result.accepted)).toHaveLength(1);
    const text = JSON.stringify(makeRunFile(state), null, 2);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_RUN_BYTES);
    expect(summarize(replay(parseRunFile(text)))).toEqual(summarize(state));
  }, 30_000);
});

describe('legacy Riverdale fixture compatibility is separate from Dallas', () => {
  it('retains the old artifact binding and 8/16/24 response timing', () => {
    expect(validateArtifact(legacyData).template).toBe('storm-v1');
    const state = replay(parseRunFile(JSON.stringify(legacyRun)));
    expect(state.scenario.config.template).toBe('storm-v1');
    expect(state.missions.find(mission => mission.householdId === 'H19' && mission.action === 'ASSESS')?.completionAt).toBe(8);
    expect(state.missions.find(mission => mission.householdId === 'H19' && mission.action === 'RELOCATE')).toMatchObject({ dispatchedAt: 8, pickupAt: 16, completionAt: 24 });
    expect(summarize(state)).toMatchObject({ assistanceCompleted: 6, timelyUrgentCount: 3 });
  });
});
