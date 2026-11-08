import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

export const ROOT = new URL('../../', import.meta.url);
export const OUTPUT = new URL('.private/dallas-v2-evaluation/', ROOT);
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
export const EXPERIMENT_PLAN = deepFreeze({
  version: 1, name: 'Dallas V2 background-only paired policy experiment', preparedArtifact: null,
  seeds: Array.from({ length: 30 }, (_, index) => 20261108 + index),
  policies: ['received-order-v2', 'urgency-first-v2', 'urgency-plus-coverage-v2'],
  baselinePopulation: 'full-tract', horizonMinutes: 360, referenceCoverageFraction: .25,
  sensitivityPopulation: 'distinct admitted 1000-household benchmark subset', sensitivitySeeds: [20261108, 20261109, 20261110],
  sensitivities: [
    { id: 'coverage-0', factor: 'coverageFraction', value: 0 }, { id: 'coverage-50', factor: 'coverageFraction', value: .5 },
    { id: 'report-delay-5', factor: 'reportDelayMinutes', value: 5 }, { id: 'report-delay-60', factor: 'reportDelayMinutes', value: 60 },
    { id: 'propensity-60', factor: 'reportingPropensity', value: .6 }, { id: 'propensity-100', factor: 'reportingPropensity', value: 1 },
    { id: 'travel-0.5', factor: 'travelTimeMultiplier', value: .5 }, { id: 'travel-1.5', factor: 'travelTimeMultiplier', value: 1.5 },
  ],
  sensitivityPolicy: 'urgency-plus-coverage-v2',
  unexecutedDesignFactors: ['need incidence 5%/20%', 'communications exposure 0%/40%', 'urgent share 15%/45%', 'accessible demand 5%/20%', 'delivery mix 25%/75%', 'assessment 5/15min', 'delivery service 5/15min', 'boarding/dropoff 5/20min', 'closure share 0%/10%'],
  benchmark: { householdSizes: [100, 1000, 3061, 10000], coldTrials: 5, warmTrials: 10, coldDefinition: 'fresh Node process, Vite SSR modules, new map and population; no prior policy route cache', warmDefinition: 'same process, modules, admitted bundle and policy route cache after cold run', minutesPerTrial: 360 },
  unperformed: ['human comprehension study', 'hazard calibration', 'behavior calibration', 'held-out historical event validation', 'browser interaction/frame benchmark'],
});
export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export const readJson = async path => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
export const writeJson = async (name, value) => { await mkdir(OUTPUT, { recursive: true }); await writeFile(new URL(name, OUTPUT), `${JSON.stringify(value, null, 2)}\n`); };
async function writeReceipt(name, value) {
  try {
    const previous = await readFile(new URL(name, OUTPUT));
    await mkdir(new URL('history/', OUTPUT), { recursive: true });
    await writeFile(new URL(`history/${hashBytes(previous)}-${name}`, OUTPUT), previous, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeJson(name, value);
}
export const environment = () => ({ node: process.version, platform: process.platform, release: os.release(), arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() });
export function statistics(values) {
  if (!values.length) return { samples: 0, mean: null, median: null, p95: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b), quantile = q => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
  return { samples: sorted.length, mean: values.reduce((a, b) => a + b, 0) / values.length, median: quantile(.5), p95: quantile(.95), min: sorted[0], max: sorted.at(-1) };
}
export function subsetPopulation(population, size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > population.households.length) throw new Error(`Source admission gate: cannot obtain ${size} distinct supported households from ${population.households.length}.`);
  const households = population.households.slice(0, size), ids = new Set(households.map(home => home.id));
  const persons = population.persons.filter(person => ids.has(person.householdId));
  assert.equal(new Set(households.map(home => home.placement.unitId)).size, size, 'Distinct supported unit IDs');
  assert.equal(persons.length, households.reduce((sum, home) => sum + home.personIds.length, 0), 'Whole household membership');
  return { ...population, mode: 'benchmark', households, persons, fit: { converged: true, controls: [], method: `First ${size} distinct households in frozen seeded benchmark subset`, limitations: ['Engineering workload subset; full-tract fitting claims do not transfer to this subset.'] } };
}
export async function sourceHashes() {
  const paths = ['tools/v2/evaluate.mjs', 'tools/v2/benchmark.mjs', 'src/model.ts'];
  async function visit(path) { for (const entry of await readdir(new URL(path, ROOT), { withFileTypes: true })) { const file = `${path}/${entry.name}`; if (entry.isDirectory()) await visit(file); else if (entry.name.endsWith('.ts')) paths.push(file); } }
  await visit('src/v2');
  for (const path of ['fixtures/v2/maps/dallas-roads-v2.json', 'fixtures/v2/maps/facilities-v2.json', 'fixtures/v2/geography/dallas-geography-v2.json', 'fixtures/v2/population/dallas-population-v2.json', 'fixtures/v2/population/dallas-benchmark1000-v2.json', 'fixtures/v2/sources/data-assets-v2.json']) paths.push(path);
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, hashBytes(await readFile(new URL(path, ROOT)))])));
}
export async function loadCore() {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  try {
    const modules = await Promise.all(['scenario', 'coordinate', 'world', 'observe', 'summary', 'run-file', 'resources', 'routes', 'hash', 'admission', 'policies/index'].map(name => server.ssrLoadModule(`/src/v2/${name}.ts`)));
    return { server, ...Object.assign({}, ...modules) };
  } catch (error) { await server.close(); throw error; }
}
export async function loadInputs(size = 3061) {
  const loadMeasurements = {};
  const measuredRead = async path => { const before = performance.now(), bytes = await readFile(new URL(path, ROOT)), readMs = performance.now() - before, parseAt = performance.now(); const value = JSON.parse(bytes.toString('utf8')); loadMeasurements[path] = { bytes: bytes.length, readMs, parseMs: performance.now() - parseAt }; return value; };
  const [map, full, thousand, geography, facilities] = await Promise.all([
    measuredRead('fixtures/v2/maps/dallas-roads-v2.json'), measuredRead('fixtures/v2/population/dallas-population-v2.json'), measuredRead('fixtures/v2/population/dallas-benchmark1000-v2.json'), measuredRead('fixtures/v2/geography/dallas-geography-v2.json'), measuredRead('fixtures/v2/maps/facilities-v2.json'),
  ]);
  if (size > full.households.length) throw new Error(`Source admission gate: ${size} exceeds ${full.households.length} admitted distinct households; no current-building-capacity or additional geographic source is admitted.`);
  const subsetAt = performance.now(), population = size === full.households.length ? full : size === 1000 ? thousand : subsetPopulation(thousand, size);
  return { map, population, geography, facilities, loadMeasurements, populationSubsetMs: performance.now() - subsetAt };
}
export function variantBundle(core, inputs, seed, variant = { id: 'baseline' }) {
  let bundle = core.createScenarioV2(inputs, seed, null);
  if (variant.factor) {
    bundle = structuredClone(bundle);
    if (variant.factor === 'reportDelayMinutes') bundle.behaviorRules.reportDelayMs = variant.value * 60000;
    if (variant.factor === 'reportingPropensity') {
      const needs = bundle.assets.events.flatMap(event => event.payload.type === 'need-onset' ? [event.payload.need.householdId] : []);
      needs.sort((a, b) => { const x = core.seededRank(seed, bundle.recipeVersion, 'background-reporting', a), y = core.seededRank(seed, bundle.recipeVersion, 'background-reporting', b); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; });
      bundle.behaviorRules.reportingHouseholdIds = needs.slice(0, Math.floor(needs.length * variant.value + .5));
    }
    if (variant.factor === 'travelTimeMultiplier') {
      bundle.assets.map.edges.forEach(edge => { edge.durationMs = Math.max(1, Math.floor(edge.durationMs * variant.value + .5)); });
      bundle.assets.map.metadata.travelPolicy.assumedSpeedKph /= variant.value;
      bundle.assumptions.push(`OFAT engineering travel-time multiplier ${variant.value}; not calibrated travel times.`);
    }
    const { hashes: _old, ...unsealed } = bundle; bundle = core.sealScenarioV2(unsealed);
  }
  const errors = core.admitScenarioV2(bundle);
  if (errors.length) throw new Error(`Scenario admission: ${errors.join('; ')}`);
  return bundle;
}
export function extractMetrics(state, summary, supply, facilities) {
  const byHome = new Map(state.households.map(home => [home.id, home])), unfinished = state.needs.filter(need => need.completedAtMs === null);
  const elapsed = (at, onset) => Math.max(0, at - onset) / 60000;
  return { ...Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'outcomes')),
    unresolvedNeeds: unfinished.length, unfinishedMissions: state.missions.filter(m => m.status !== 'completed').length,
    strandedUnits: state.units.filter(unit => unit.status === 'stranded').length, blockedMissions: state.missions.filter(m => m.status === 'blocked').length,
    acceptedCommands: state.commands.filter(row => row.accepted).length, rejectedCommands: state.commands.filter(row => !row.accepted).length,
    waits: { unmetOnsetMinutes: statistics(unfinished.map(need => elapsed(state.nowMs, need.onsetMs))),
      unmetSinceLatestHouseholdUpdateMinutes: statistics(unfinished.filter(need => byHome.get(need.householdId)?.known?.needs?.some(known => known.id === need.id)).map(need => elapsed(state.nowMs, byHome.get(need.householdId).known.receivedAtMs))),
      completedOnsetMinutes: statistics(state.needs.filter(need => need.completedAtMs !== null).map(need => elapsed(need.completedAtMs, need.onsetMs))),
      completedMissionMinutes: statistics(state.missions.filter(m => m.completedAtMs !== null).map(m => elapsed(m.completedAtMs, m.dispatchedAtMs))) },
    waitingReasons: Object.fromEntries([...new Set((summary.outcomes ?? []).flatMap(home => home.needs.filter(need => need.completedAtMs === null).map(need => need.waitingReason)))].map(reason => [reason, summary.outcomes.flatMap(home => home.needs).filter(need => need.completedAtMs === null && need.waitingReason === reason).length])),
    resources: { supply, facilities, units: state.units.map(unit => ({ id: unit.id, status: unit.status, busyMinutes: unit.busyMs / 60000, passengers: unit.passengers, carriedBundles: unit.carriedBundles })) },
  };
}
export const scalarMetrics = ['completedNeeds', 'peopleHelped', 'timelyUrgent', 'unmetNeedMinutes', 'undiscoveredNeeds', 'uncheckedHomes', 'cannotCallUncheckedHomes', 'unsupportedHouseholds', 'peopleWaiting', 'strandedUnits'];
export function pairedDifferences(rows) {
  const seeds = [...new Set(rows.map(row => row.seed))].sort((a, b) => a - b), completeSeeds = [], incompleteSeeds = [], pairs = [];
  for (const seed of seeds) {
    const triple = EXPERIMENT_PLAN.policies.map(policy => rows.find(row => row.seed === seed && row.policy === policy && row.status === 'completed'));
    if (triple.some(row => !row)) { incompleteSeeds.push(seed); continue; }
    assert.equal(new Set(triple.map(row => row.exogenousHash)).size, 1, 'Paired exogenous input mismatch'); completeSeeds.push(seed); pairs.push(triple);
  }
  const comparisons = {};
  for (const [a, b] of [[1, 0], [2, 0], [2, 1]]) comparisons[`${EXPERIMENT_PLAN.policies[a]} minus ${EXPERIMENT_PLAN.policies[b]}`] = Object.fromEntries(scalarMetrics.map(metric => [metric, statistics(pairs.filter(pair => Number.isFinite(pair[a].metrics[metric]) && Number.isFinite(pair[b].metrics[metric])).map(pair => pair[a].metrics[metric] - pair[b].metrics[metric]))]));
  return { completeSeeds, incompleteSeeds, comparisons };
}
/** A previous successful file cannot stand in for a failed current child. */
export function admitBaselineRows(rows, executions, { executionId, seeds, planHash, sourceSha256 }) {
  return seeds.flatMap(seed => EXPERIMENT_PLAN.policies.map(policy => {
    const row = rows.find(row => row.seed === seed && row.policy === policy), child = executions.find(child => child.seed === seed);
    try {
      assert.equal(child?.exitCode, 0, 'Current baseline child did not exit successfully.');
      assert.equal(row?.executionId, executionId, 'Stale or missing baseline receipt: execution identity differs.');
      assert.equal(row?.seed, seed); assert.equal(row?.policy, policy); assert.equal(row?.variant, 'baseline');
      assert.equal(row?.planHash, planHash, 'Baseline plan identity differs.');
      assert.deepEqual(row?.sourceSha256, sourceSha256, 'Baseline source identity differs.');
      assert.equal(row?.status, 'completed', 'Current baseline run did not complete.');
      return row;
    } catch (error) {
      return { seed, policy, variant: 'baseline', status: 'failed', executionId, failure: String(error), child: child ?? null, observedReceipt: row ?? null };
    }
  }));
}
export async function executeRun(core, bundle, { policy, seed, variant = 'baseline', coverageFraction = .25, replay = false, onMinute, profile = false }) {
  const start = performance.now(), step = [], projections = [], policies = [], routes = [], invariantTimes = [], checkpoints = [];
  let session, invariantChecks = 0, maximumHeapBytes = process.memoryUsage().heapUsed;
  const record = { schemaVersion: 1, recordedAt: new Date().toISOString(), seed, policy, variant, coverageFraction, populationMode: bundle.populationMode,
    hashes: bundle.hashes, exogenousHash: core.hashValue({ seed, hashes: bundle.hashes, resources: bundle.resources, behaviorRules: bundle.behaviorRules }),
    householdIds: bundle.assets.population.households.map(home => home.id), needDefinitions: bundle.assets.events.flatMap(event => event.payload.type === 'need-onset' ? [event.payload.need] : []),
    householdCount: bundle.assets.population.households.length, personCount: bundle.assets.population.persons.length, preparedArtifact: null, replay: { performed: false } };
  try {
    const beforeInit = performance.now(); session = core.initializeSessionV2(bundle, policy, `eval:${seed}:${policy}:${variant}`, coverageFraction); const initializeMs = performance.now() - beforeInit;
    const verify = () => { const before = performance.now(); core.assertWorldInvariants(session.world); invariantTimes.push(performance.now() - before); invariantChecks++; };
    const checkpoint = () => checkpoints.push({ minute: session.world.nowMs / 60000, actualNeeds: session.world.needs.length,
      undiscoveredNeeds: session.world.needs.filter(need => !need.discovered).length,
      uncheckedHomes: session.world.households.filter(home => home.lastCheckAtMs === null).length,
      cannotCallUncheckedHomes: session.world.households.filter(home => !home.communicationsAvailable && home.lastCheckAtMs === null).length });
    verify(); checkpoint();
    while (!session.world.finalized) {
      const before = performance.now(); session = core.advanceSessionV2(session); step.push(performance.now() - before); verify();
      maximumHeapBytes = Math.max(maximumHeapBytes, process.memoryUsage().heapUsed);
      if ([30, 60, 120, 240, 360].includes(session.world.nowMs / 60000)) checkpoint();
      if (profile && session.world.nowMs % (60 * 60000) === 0) {
        const startProjection = performance.now(), view = core.observeCoordinator(session.world); projections.push(performance.now() - startProjection);
        const startPolicy = performance.now(); core.chooseCommandV2?.(view, policy, bundle.resources, coverageFraction); policies.push(performance.now() - startPolicy);
      }
      if (onMinute) await onMinute(session.world.nowMs / 60000, session);
    }
    const summaryAt = performance.now(), summary = core.summarizeWorld(session.world), summarizeMs = performance.now() - summaryAt;
    assert.equal(session.world.nowMs, 360 * 60000); assert.equal(summary.households, bundle.assets.population.households.length); assert.equal(summary.persons, bundle.assets.population.persons.length);
    assert.equal(summary.peopleHelped, summary.outcomes.filter(home => home.needs.some(need => need.completedAtMs !== null)).reduce((sum, home) => sum + home.size, 0), 'Completed people independently reconciled');
    assert.equal(summary.behavior.directPersonaActors, 0); assert.equal(summary.behavior.directActions, 0);
    const facilities = bundle.assets.facilities.map(f => ({ id: f.id, ...core.facilityTotalsV2(session.world, f.id) }));
    record.metrics = extractMetrics(session.world, summary, core.supplyTotalsV2(session.world), facilities);
    record.digests = core.digestSessionV2(session);
    if (replay) {
      const replayAt = performance.now(), file = core.makeRunFileV2(session), text = JSON.stringify(file), parsed = core.parseRunFileV2(text), restored = await core.replayV2(parsed, `replay:${seed}:${policy}:${variant}`);
      const actual = core.digestSessionV2(restored); assert.deepEqual(actual, record.digests); core.assertWorldInvariants(restored.world);
      record.replay = { performed: true, bytes: Buffer.byteLength(text), replayMs: performance.now() - replayAt, newRunId: restored.world.runId, digestEquality: true };
      await writeJson('reference-run.json', file);
    }
    return { ...record, status: 'completed', horizonMinutes: 360, invariantChecks, checkpoints, timing: { initializeMs, minutePlusPolicyMs: statistics(step), externalInvariantMs: statistics(invariantTimes), projectionMs: statistics(projections), policyMs: statistics(policies), routingMs: statistics(routes), summarizeMs, totalMs: performance.now() - start, maximumObservedHeapBytes: maximumHeapBytes }, commands: session.world.commands.length, traceEvents: session.world.events.length };
  } catch (error) {
    if (session) { try { await writeJson(`failed-state-${seed}-${policy}-${variant}.json`, core.makeRunFileV2(session)); } catch (saveError) { await writeJson(`failed-state-${seed}-${policy}-${variant}.json`, { saveFailure: String(saveError), session }); } }
    return { ...record, status: 'failed', failure: { message: String(error?.stack ?? error), minute: session?.world.nowMs / 60000 }, invariantChecks, elapsedMs: performance.now() - start };
  }
}
export async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const planText = JSON.stringify(EXPERIMENT_PLAN, null, 2), planHash = hashBytes(planText);
  try { const frozen = JSON.parse(await readFile(new URL('predeclared-plan.json', OUTPUT), 'utf8')); assert.equal(frozen.planHash, planHash, 'The predeclared plan changed; preserve the earlier experiment in a separate directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(new URL('predeclared-plan.json', OUTPUT), `${JSON.stringify({ frozenAt: new Date().toISOString(), planHash, plan: EXPERIMENT_PLAN }, null, 2)}\n`, { flag: 'wx' }); }
  const sourceAtStart = await sourceHashes(), rows = [], started = performance.now();
  const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'baseline';
  const limit = Number(process.argv.find(arg => arg.startsWith('--limit-seeds='))?.slice(14) ?? 30);
  const offset = Number(process.argv.find(arg => arg.startsWith('--seed-offset='))?.slice(14) ?? 0);
  const workers = Number(process.argv.find(arg => arg.startsWith('--workers='))?.slice(10) ?? 1);
  const executionId = process.argv.find(arg => arg.startsWith('--execution-id='))?.slice(15) ?? randomUUID();
  const sensitivitySeedArg = process.argv.find(arg => arg.startsWith('--sensitivity-seed='))?.slice(19);
  const sensitivitySeeds = sensitivitySeedArg === undefined ? EXPERIMENT_PLAN.sensitivitySeeds : [Number(sensitivitySeedArg)];
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 30);
  assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset + limit <= 30);
  assert.ok(Number.isSafeInteger(workers) && workers >= 1 && workers <= 8);
  assert.ok(/^[A-Za-z0-9-]{1,80}$/.test(executionId), 'Invalid execution identity.');
  assert.ok(sensitivitySeeds.every(seed => EXPERIMENT_PLAN.sensitivitySeeds.includes(seed)), 'Use a predeclared sensitivity seed.');
  if (workers > 1) {
    assert.equal(phase, 'baseline', 'Parallel execution currently supports baseline only.');
    const seeds = EXPERIMENT_PLAN.seeds.slice(offset, offset + limit), executions = [];
    let cursor = 0;
    async function consume() {
      while (cursor < seeds.length) {
        const index = cursor++, seed = seeds[index];
        const execution = await new Promise(resolvePromise => {
          const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--limit-seeds=1', `--seed-offset=${offset + index}`, `--execution-id=${executionId}`, ...(index === 0 ? [] : ['--no-replay'])], { cwd: fileURLToPath(ROOT), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
          let stderr = ''; child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => { stderr += data; process.stderr.write(data); });
          child.on('error', error => resolvePromise({ exitCode: null, error: String(error) })); child.on('close', exitCode => resolvePromise({ exitCode, stderr }));
        });
        executions.push({ seed, executionId, ...execution });
      }
    }
    await Promise.all(Array.from({ length: Math.min(workers, seeds.length) }, consume));
    for (const seed of seeds) for (const policy of EXPERIMENT_PLAN.policies) {
      try { rows.push(JSON.parse(await readFile(new URL(`run-${seed}-${policy}-baseline.json`, OUTPUT), 'utf8'))); }
      catch (error) { rows.push({ seed, policy, variant: 'baseline', status: 'failed', failure: String(error) }); }
    }
    const admitted = admitBaselineRows(rows, executions, { executionId, seeds, planHash, sourceSha256: sourceAtStart });
    const after = await sourceHashes(), receipt = { recordedAt: new Date().toISOString(), command: process.argv, phase, workers, executionId, planHash, environment: environment(),
      runCount: admitted.length, successfulRuns: admitted.filter(row => row.status === 'completed').length, failedRuns: admitted.filter(row => row.status === 'failed').length,
      executions, rows: admitted, paired: pairedDifferences(admitted), sourceSha256: sourceAtStart, sourceSha256AtEnd: after, sourceUnchangedDuringProcess: JSON.stringify(sourceAtStart) === JSON.stringify(after) && admitted.every(row => JSON.stringify(row.sourceSha256) === JSON.stringify(sourceAtStart)), elapsedMs: performance.now() - started, modelCalls: 0, networkCalls: 0, limits: EXPERIMENT_PLAN.unperformed };
    await writeReceipt('baseline-receipt.json', receipt); if (receipt.failedRuns || !receipt.sourceUnchangedDuringProcess) process.exitCode = 1;
    console.log(JSON.stringify({ receipt: '.private/dallas-v2-evaluation/baseline-receipt.json', successfulRuns: receipt.successfulRuns, failedRuns: receipt.failedRuns, elapsedMs: receipt.elapsedMs })); return;
  }
  const core = await loadCore();
  try {
    const inputs = await loadInputs(), reference = await loadInputs(1000);
    const jobs = [];
    if (phase === 'baseline' || phase === 'all') for (const seed of EXPERIMENT_PLAN.seeds.slice(offset, offset + limit)) for (const policy of EXPERIMENT_PLAN.policies) jobs.push({ seed, policy, inputs, variant: { id: 'baseline' } });
    if (phase === 'sensitivities' || phase === 'all') for (const seed of sensitivitySeeds) for (const variant of [{ id: 'sensitivity-reference' }, ...EXPERIMENT_PLAN.sensitivities]) jobs.push({ seed, policy: EXPERIMENT_PLAN.sensitivityPolicy, inputs: reference, variant });
    assert.ok(jobs.length > 0, 'Use --phase=baseline, sensitivities, or all.');
    for (const job of jobs) {
      const bundleAt = performance.now(); let bundle;
      try { bundle = variantBundle(core, job.inputs, job.seed, job.variant); }
      catch (error) { const failed = { seed: job.seed, policy: job.policy, variant: job.variant.id, status: 'failed', executionId, planHash, sourceSha256: sourceAtStart, stage: 'scenario-admission', failure: String(error.stack ?? error) }; rows.push(failed); await writeReceipt(`run-${job.seed}-${job.policy}-${job.variant.id}.json`, failed); console.error(JSON.stringify(failed)); continue; }
      const bundleMs = performance.now() - bundleAt;
      const options = { seed: job.seed, policy: job.policy, variant: job.variant.id, coverageFraction: job.variant.factor === 'coverageFraction' ? job.variant.value : .25,
        replay: rows.length === 0 && phase !== 'sensitivities' && !process.argv.includes('--no-replay'), onMinute: async minute => { if (minute % 60 === 0) console.log(JSON.stringify({ progress: true, seed: job.seed, policy: job.policy, variant: job.variant.id, minute })); } };
      const row = await executeRun(core, bundle, options); row.bundleBuildMs = bundleMs; row.planHash = planHash; row.sourceSha256 = sourceAtStart; row.executionId = executionId;
      rows.push(row); await writeReceipt(`run-${job.seed}-${job.policy}-${job.variant.id}.json`, row);
      await writeJson(`${phase}-progress.json`, { totalJobs: jobs.length, completedJobs: rows.length, failedJobs: rows.filter(row => row.status === 'failed').length, elapsedMs: performance.now() - started });
      console.log(JSON.stringify({ run: rows.length, total: jobs.length, seed: row.seed, policy: row.policy, variant: row.variant, status: row.status, totalMs: row.timing?.totalMs, failure: row.failure }));
    }
    const sourceAtEnd = await sourceHashes();
    const receipt = { recordedAt: new Date().toISOString(), command: process.argv, executionId, planHash, environment: environment(), phase, requestedSeeds: [...new Set(jobs.map(job => job.seed))], runCount: rows.length,
      successfulRuns: rows.filter(row => row.status === 'completed').length, failedRuns: rows.filter(row => row.status === 'failed').length, rows,
      paired: pairedDifferences(rows.filter(row => row.variant === 'baseline')), sourceSha256: sourceAtStart, sourceUnchangedDuringProcess: JSON.stringify(sourceAtStart) === JSON.stringify(sourceAtEnd), sourceSha256AtEnd: sourceAtEnd,
      elapsedMs: performance.now() - started, modelCalls: 0, networkCalls: 0, limits: EXPERIMENT_PLAN.unperformed };
    const receiptName = phase === 'sensitivities' && sensitivitySeedArg !== undefined ? `sensitivities-seed-${sensitivitySeedArg}-receipt.json` : `${phase}${limit === 30 ? '' : `-shard-${offset}`}-receipt.json`;
    await writeReceipt(receiptName, receipt); if (receipt.failedRuns || !receipt.sourceUnchangedDuringProcess) process.exitCode = 1;
    console.log(JSON.stringify({ receipt: `.private/dallas-v2-evaluation/${phase}-receipt.json`, successfulRuns: receipt.successfulRuns, failedRuns: receipt.failedRuns, elapsedMs: receipt.elapsedMs, sourceUnchanged: receipt.sourceUnchangedDuringProcess }));
  } finally { await core.server.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
