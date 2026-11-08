import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeEvent, mechanicsFixture, needEvent } from '../../fixtures/v2/mechanics/fixture';
import { ENGINE_V2, HORIZON_MS, MINUTE_MS as M, type CommandV2, type ScenarioBundleV2 } from '../../src/v2/contracts';
import { admitScenarioV2 } from '../../src/v2/admission';
import { advanceSessionV2, initializeSessionV2 } from '../../src/v2/coordinate';
import { hashValue } from '../../src/v2/hash';
import { observeCoordinator } from '../../src/v2/observe';
import { createScenarioV2, sealScenarioV2, type ScenarioInputsV2 } from '../../src/v2/scenario';
import type { SessionV2 } from '../../src/v2/session';
import { advanceWorld, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { continueV2, digestSessionV2, makeRunFileV2, parseRunFileV2, replayV2 } from '../../src/v2/run-file';

function bundle(events: ScenarioBundleV2['assets']['events'] = []): ScenarioBundleV2 {
  const value = mechanicsFixture();
  // Explicit authored geographic support; this fixture makes no Dallas source claim.
  value.assets.geography.tracts = [{ geoid: 'FIXTURE', rings: [[[-96.79, 32.78], [-96.77, 32.78], [-96.77, 32.80], [-96.79, 32.80], [-96.79, 32.78]]] }];
  value.assets.events = events;
  return sealScenarioV2(value);
}
function fresh(input = bundle()): SessionV2 {
  return { world: initializeWorld(input, 'source-run'), policy: 'urgency-plus-coverage-v2', coverageFraction: .25,
    decisions: [], lineage: null, playbackOrigin: 'fresh' };
}
function record(session: SessionV2, intent: Partial<CommandV2> = {}): SessionV2 {
  const command: CommandV2 = { id: `recorded:${session.world.commands.length + 1}`, sequence: session.world.commands.length + 1,
    atMs: session.world.nowMs, action: 'check', unitId: 'C1', householdId: 'H1', ...intent };
  const observation = observeCoordinator(session.world);
  return { ...session, decisions: [...session.decisions, { commandId: command.id, atMs: command.atMs, policy: session.policy,
    observationHash: hashValue(observation), rule: 'retained-test-decision', evidenceIds: [command.householdId] }],
    world: advanceWorld(dispatchWorld(session.world, command).state, session.world.nowMs) };
}
function partial(): SessionV2 {
  const session = record(fresh());
  return { ...session, world: advanceWorld(session.world, M) };
}
afterEach(() => vi.unstubAllGlobals());

describe('bounded self-contained V2 run files', () => {
  it('replays the actual coordinator multi-command initialization at the saved zero-time boundary', async () => {
    const session = initializeSessionV2(bundle(), 'urgency-plus-coverage-v2', '00000000-0000-4000-8000-000000000001');
    expect(session.world.commands).toHaveLength(4);
    expect(session.world.commands.map(record => record.command.atMs)).toEqual([0, 0, 0, 0]);
    const replayed = await replayV2(makeRunFileV2(session), 'coordinator-initial-replay');
    expect(replayed.world.units.slice(0, 4).every(unit => unit.cursor.kind === 'edge')).toBe(true);
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(session));
  });

  it('replays coordinator commands dispatched at fractional-minute engine boundaries', async () => {
    const source = bundle([needEvent('H1', 'delivery')]);
    source.assets.map.edges.find(edge => edge.id === 'BH')!.durationMs = 2 * M + 1;
    const admitted = sealScenarioV2(source);
    const session = advanceSessionV2(initializeSessionV2(admitted, 'urgency-first-v2', '00000000-0000-4000-8000-000000000002'), 13 * M);
    expect(session.world.commands.some(record => record.command.atMs === 12 * M + 1 && record.command.action === 'deliver')).toBe(true);
    const replayed = await replayV2(makeRunFileV2(session), 'fractional-coordinator-replay');
    expect(replayed.world.commands).toEqual(session.world.commands);
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(session));
  });

  it('replays the admitted 3061-household, 5306-person world through the complete offline horizon', async () => {
    const [map, population, geography, facilities] = await Promise.all([
      import('../../fixtures/v2/maps/dallas-roads-v2.json'),
      import('../../fixtures/v2/population/dallas-population-v2.json'),
      import('../../fixtures/v2/geography/dallas-geography-v2.json'),
      import('../../fixtures/v2/maps/facilities-v2.json'),
    ]);
    const inputs = { map: map.default, population: population.default, geography: geography.default, facilities: facilities.default } as unknown as ScenarioInputsV2;
    const admitted = createScenarioV2(inputs);
    let session = record(fresh(admitted), { householdId: admitted.assets.population.households[0].id });
    session = { ...session, world: advanceWorld(session.world, HORIZON_MS) };
    const file = makeRunFileV2(session);
    vi.stubGlobal('fetch', () => { throw new Error('Offline release replay'); });
    const replayed = await replayV2(parseRunFileV2(JSON.stringify(file)), 'source-conditioned-replay');
    expect(replayed.world.bundle.populationMode).toBe('full-tract');
    expect(replayed.world.households).toHaveLength(3061);
    expect(replayed.world.bundle.assets.population.persons).toHaveLength(5306);
    expect(replayed.world.nowMs).toBe(360 * M);
    expect(replayed.world.finalized).toBe(true);
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(session));
  }, 30_000);

  it('replays recorded commands offline under a fresh identity with exact partial cursor and evidence', async () => {
    const session = partial();
    expect(admitScenarioV2(session.world.bundle)).toEqual([]);
    const file = parseRunFileV2(JSON.stringify(makeRunFileV2(session)));
    vi.stubGlobal('fetch', () => { throw new Error('Network unavailable'); });
    const replayed = await replayV2(file, 'offline-playback');
    expect(replayed.world.runId).toBe('offline-playback');
    expect(replayed.playbackOrigin).toBe('imported');
    expect(replayed.world.units[0].cursor).toEqual({ kind: 'edge', arc: { edgeId: 'BH', fromNodeId: 'B', toNodeId: 'H' }, elapsedMs: M, durationMs: 2 * M });
    expect(replayed.world.commands).toEqual(session.world.commands);
    expect(replayed.decisions).toEqual(session.decisions);
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(session));
    expect(Object.keys(file.bundle.assets)).toHaveLength(7);
  });

  it('continues an imported partial run with new lineage while retaining the recorded history', async () => {
    const file = makeRunFileV2(partial());
    const imported = await replayV2(file, 'local-import');
    const continued = continueV2(imported, 'continued-run');
    expect(continued.lineage).toEqual({ sourceRunId: 'source-run', sourceSavedAtMs: M, sourceStateDigest: file.expected.stateDigest });
    expect(continued.playbackOrigin).toBe('continued');
    expect(continued.world.runId).toBe('continued-run');
    expect(digestSessionV2(continued)).toEqual(digestSessionV2(imported));
    const withNewCommand = record(continued, { unitId: 'C2', householdId: 'H6' });
    const advanced = { ...withNewCommand, world: advanceWorld(withNewCommand.world, 15 * M) };
    const replayed = await replayV2(makeRunFileV2(advanced), 'continued-playback');
    expect(replayed.world.commands).toHaveLength(2);
    expect(replayed.world.commands[0]).toEqual(file.commands[0]);
    expect(replayed.decisions[0]).toEqual(file.decisions[0]);
    expect(replayed.decisions[1].commandId).toBe('recorded:2');
    expect(imported.world.commands).toHaveLength(1);
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(advanced));
  });

  it('retains ordered custody across multiple import, continuation and export cycles', async () => {
    const first = makeRunFileV2(partial());
    const imported = await replayV2(first, 'playback-a');
    const continued = continueV2(imported, 'branch-b');
    const second = makeRunFileV2(continued);
    const reopened = await replayV2(second, 'playback-b');
    const third = makeRunFileV2(continueV2(reopened, 'branch-c'));
    expect(third.ancestry?.map(edge => edge.sourceRunId)).toEqual(['source-run', 'branch-b']);
    expect(third.ancestry?.[0]).toEqual({ sourceRunId: first.sourceRunId, sourceSavedAtMs: M, sourceStateDigest: first.expected.stateDigest });
    expect(third.lineage?.sourceRunId).toBe('branch-b');
    const cycle = structuredClone(third); cycle.ancestry!.push(cycle.ancestry![0]);
    expect(() => parseRunFileV2(JSON.stringify(cycle))).toThrow(/cycle/i);
    const conflict = structuredClone(third); conflict.lineage!.sourceStateDigest = '0'.repeat(64);
    expect(() => parseRunFileV2(JSON.stringify(conflict))).toThrow(/lineage|ancestry/i);
    const tooLong = structuredClone(third);
    tooLong.ancestry = Array.from({ length: 33 }, (_, index) => ({ sourceRunId: `ancestor:${index}`, sourceSavedAtMs: 0, sourceStateDigest: 'a'.repeat(64) }));
    expect(() => parseRunFileV2(JSON.stringify(tooLong))).toThrow(/32|limit/i);
    await expect(replayV2(first, 'source-run')).rejects.toThrow(/fresh|identity/i);
    expect(() => continueV2(reopened, 'source-run')).toThrow(/fresh|identity/i);
  });

  it('reproduces retained rejected commands without inventing missions or extra decisions', async () => {
    const session = record(record(fresh()), { householdId: 'H6' });
    expect(session.world.commands[1]).toMatchObject({ accepted: false, reason: 'The unit is unavailable.' });
    const replayed = await replayV2(makeRunFileV2(session), 'rejections');
    expect(replayed.world.commands).toHaveLength(2);
    expect(replayed.world.missions).toHaveLength(1);
    expect(replayed.decisions).toHaveLength(2);
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(session));
  });

  it('preserves a maximum-length command identity in its generated mission identity', async () => {
    const session = record(fresh(), { id: 'c'.repeat(160) });
    const replayed = await replayV2(makeRunFileV2(session), 'long-command-replay');
    expect(replayed.world.missions[0].id).toBe(`mission:${'c'.repeat(160)}`);
  });

  it('retains stranded passengers, shelter reservations, supplies and physical cursor at minute 360', async () => {
    let session = fresh(bundle([needEvent('H1', 'relocation'), needEvent('H6', 'delivery'),
      changeEvent('loaded-crew-edge-close', 23 * M, { type: 'edge-state-change', edgeIds: ['BH'], closed: true }),
      changeEvent('occupied-edge-close', 33 * M, { type: 'edge-state-change', edgeIds: ['HS'], closed: true })]));
    session = { ...session, world: advanceWorld(session.world, 20 * M) };
    session = record(session, { action: 'transport', unitId: 'V1', needId: 'N-H1', shelterId: 'SHELTER' });
    session = record(session, { action: 'deliver', unitId: 'C1', householdId: 'H6', needId: 'N-H6' });
    session = { ...session, world: advanceWorld(session.world, HORIZON_MS) };
    const replayed = await replayV2(makeRunFileV2(session), 'stranded-replay');
    const van = replayed.world.units.find(unit => unit.id === 'V1')!;
    expect(van.status).toBe('stranded');
    expect(van.passengers).toBe(2);
    expect(van.cursor).toMatchObject({ kind: 'edge', elapsedMs: M, durationMs: 2 * M });
    expect(replayed.world.seatReservations).toEqual([{ missionId: 'mission:recorded:1', facilityId: 'SHELTER', places: 2, status: 'reserved' }]);
    expect(replayed.world.bundleReservations[0].status).toBe('loaded');
    expect(replayed.world.units[0]).toMatchObject({ status: 'stranded', carriedBundles: 1, cursor: { kind: 'edge', elapsedMs: M, durationMs: 2 * M } });
    expect(digestSessionV2(replayed)).toEqual(digestSessionV2(session));
  });

  it('rejects tampered decisions, outcomes and terminal state or trace receipts', async () => {
    const source = makeRunFileV2(partial());
    const decision = structuredClone(source); decision.decisions[0].observationHash = '0'.repeat(64);
    await expect(replayV2(decision)).rejects.toThrow(/observation/i);
    const reference = structuredClone(source); reference.decisions[0].evidenceIds = ['future-private-event'];
    await expect(replayV2(reference)).rejects.toThrow(/evidence/i);
    const outcome = structuredClone(source); outcome.commands[0].accepted = false;
    await expect(replayV2(outcome)).rejects.toThrow(/outcome/i);
    for (const key of ['stateDigest', 'traceDigest', 'summaryHash'] as const) {
      const changed = structuredClone(source); changed.expected[key] = '0'.repeat(64);
      await expect(replayV2(changed)).rejects.toThrow(/digest|trace|summary/i);
    }
    const alteredCursor = partial();
    if (alteredCursor.world.units[0].cursor.kind === 'edge') alteredCursor.world.units[0].cursor.elapsedMs++;
    await expect(replayV2(makeRunFileV2(alteredCursor))).rejects.toThrow(/state|digest/i);
  });

  it('rejects missing or tampered embedded assets and unsupported versions before replay', () => {
    const source = makeRunFileV2(partial());
    const tampered = structuredClone(source); tampered.bundle.assets.map.edges[0].durationMs = 1;
    expect(() => parseRunFileV2(JSON.stringify(tampered))).toThrow(/hash|map/i);
    const missing = structuredClone(source) as unknown as { bundle: { assets: Record<string, unknown> } };
    delete missing.bundle.assets.map;
    expect(() => parseRunFileV2(JSON.stringify(missing))).toThrow();
    for (const replacement of [{ version: 1 }, { engineVersion: `${ENGINE_V2}-future` }, { policy: 'latest-policy' }]) {
      expect(() => parseRunFileV2(JSON.stringify({ ...source, ...replacement }))).toThrow(/unsupported/i);
    }
  });

  it('rejects duplicates, bad references, unsupported keys, nonfinite numbers and out-of-order commands', () => {
    const session = record(partial(), { unitId: 'C2', householdId: 'H6' });
    const source = makeRunFileV2(session);
    for (const mutate of [
      (file: typeof source) => { file.commands[1].command.id = file.commands[0].command.id; },
      (file: typeof source) => { file.commands[1].command.sequence = 1; },
      (file: typeof source) => { file.commands[1].command.atMs = -1; },
      (file: typeof source) => { file.commands[0].command.unitId = 'unknown'; },
      (file: typeof source) => { file.decisions.pop(); },
      (file: typeof source) => { file.coverageFraction = -1; },
    ]) {
      const invalid = structuredClone(source); mutate(invalid);
      expect(() => parseRunFileV2(JSON.stringify(invalid))).toThrow();
    }
    expect(() => parseRunFileV2(JSON.stringify({ ...source, state: {} }))).toThrow(/key/i);
    expect(() => parseRunFileV2(JSON.stringify(source).replace('"coverageFraction":0.25', '"coverageFraction":1e400'))).toThrow(/finite|coverage|range/i);
  });

  it('enforces V2 byte, depth, command and array limits without relaxing legacy imports', async () => {
    const source = makeRunFileV2(partial());
    expect(() => parseRunFileV2(' '.repeat(32 * 1024 * 1024 + 1))).toThrow(/32|size|MiB/i);
    const deep = `${'['.repeat(41)}0${']'.repeat(41)}`;
    expect(() => parseRunFileV2(deep)).toThrow(/structure|deep|nest/i);
    expect(() => parseRunFileV2(JSON.stringify({ ...source, commands: Array(20_001).fill(source.commands[0]) }))).toThrow(/command|limit/i);
    expect(() => parseRunFileV2(JSON.stringify({ ...source, decisions: Array(100_001).fill(null) }))).toThrow(/array|limit/i);
    const traceOverflow = partial(); traceOverflow.world.events = Array(100_001).fill(traceOverflow.world.events[0]);
    expect(() => makeRunFileV2(traceOverflow)).toThrow(/trace|event|limit/i);
    const { parseRunFile } = await import('../../src/run-file');
    expect(() => parseRunFile(JSON.stringify(source))).toThrow(/version|key/i);
    expect(() => parseRunFile(' '.repeat(1_048_577))).toThrow(/1 MiB/i);
  });
});
