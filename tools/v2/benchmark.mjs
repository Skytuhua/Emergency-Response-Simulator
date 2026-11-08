import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { ROOT, OUTPUT, EXPERIMENT_PLAN, loadCore, loadInputs, variantBundle, executeRun, environment, sourceHashes, statistics, writeJson } from './evaluate.mjs';

const argument = (key, fallback) => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
export function validateBenchmarkWorker(receipt, experimentId) {
  assert.equal(receipt.experimentId, experimentId, 'Stale benchmark worker receipt: execution identity differs.');
  assert.equal(receipt.sourceUnchanged, true, 'Benchmark worker source changed during execution.');
  return receipt;
}
async function worker() {
  const size = Number(argument('size', 1000)), trial = Number(argument('trial', 1)), warmCount = Number(argument('warm-count', 0)), experimentId = argument('experiment-id', randomUUID()), started = performance.now();
  const sourceSha256 = await sourceHashes(), beforeCore = performance.now(), core = await loadCore(), moduleLoadMs = performance.now() - beforeCore;
  try {
    const populationAt = performance.now(), inputs = await loadInputs(size), allInputAssetsLoadMs = performance.now() - populationAt;
    const populationSourcePath = size === 3061 ? 'fixtures/v2/population/dallas-population-v2.json' : 'fixtures/v2/population/dallas-benchmark1000-v2.json';
    const buildAt = performance.now(), bundle = variantBundle(core, inputs, 20261108), scenarioBuildAdmissionMs = performance.now() - buildAt, rows = [];
    for (let index = 0; index <= warmCount; index++) {
      const temperature = index === 0 ? 'cold' : 'warm', options = { seed: 20261108, policy: 'urgency-plus-coverage-v2', variant: `benchmark-${size}-${trial}-${temperature}-${index}` };
      const row = await executeRun(core, bundle, options);
      // Standalone components are measured after the integrated run, so probes do not prime its cold policy caches.
      const initial = core.initializeWorld(bundle, `probe:${size}:${trial}:${index}`), projection = [], policies = [], routes = [];
      let view;
      for (let sample = 0; sample < 5; sample++) { const before = performance.now(); view = core.observeCoordinator(initial); projection.push(performance.now() - before); }
      for (let sample = 0; sample < 5; sample++) { const before = performance.now(); core.chooseCommandV2(view, 'urgency-plus-coverage-v2', bundle.resources, .25); policies.push(performance.now() - before); }
      for (const home of bundle.assets.population.households.filter((_, index) => index % Math.max(1, Math.floor(size / 20)) === 0).slice(0, 20)) {
        const before = performance.now(); core.planRouteV2(bundle.assets.map, { nodeId: bundle.resources.depotNodeId, incoming: null }, [home.homeNodeId], []); routes.push(performance.now() - before);
      }
      row.temperature = temperature; row.trial = temperature === 'cold' ? trial : index; row.experimentId = experimentId; row.sourceSha256 = sourceSha256;
      row.componentProbes = { projectionMs: statistics(projection), policyMs: statistics(policies), routingMs: statistics(routes), note: 'Post-run standalone probes; policy on initial uncoordinated public state; routes base-to-20 retained homes, without closures. Not additive parts of integrated timing.' };
      row.modelCalls = 0; row.networkCalls = 0;
      rows.push(row); await writeJson(`benchmark-${size}-${temperature}-${row.trial}.json`, row);
      console.log(JSON.stringify({ size, temperature, trial: row.trial, status: row.status, totalMs: row.timing?.totalMs, stepP95Ms: row.timing?.minutePlusPolicyMs.p95 }));
    }
    const after = await sourceHashes();
    const result = { size, trial, experimentId, environment: environment(), sourceSha256, sourceUnchanged: JSON.stringify(sourceSha256) === JSON.stringify(after), moduleLoadMs, allInputAssetsLoadMs,
      individualAssetLoad: inputs.loadMeasurements, populationSourceLoad: { sourcePath: populationSourcePath, ...inputs.loadMeasurements[populationSourcePath], subsetMs: inputs.populationSubsetMs, note: 'Read/parse timers overlap other source-asset reads; not additive to all-input elapsed time. The 100-household trial selects whole members from the retained 1000-household source.' },
      scenarioBuildAdmissionMs, rows, processTotalMs: performance.now() - started };
    await writeJson(`benchmark-worker-${size}-${trial}.json`, result); if (rows.some(row => row.status !== 'completed')) process.exitCode = 1;
  } finally { await core.server.close(); }
}
async function runProcess(size, trial, warmCount, experimentId) {
  const started = performance.now();
  return await new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', `--size=${size}`, `--trial=${trial}`, `--warm-count=${warmCount}`, `--experiment-id=${experimentId}`], { cwd: fileURLToPath(ROOT), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = ''; child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => { stderr += data.toString(); process.stderr.write(data); });
    child.on('error', error => resolve({ experimentId, exitCode: null, failure: String(error), wallMs: performance.now() - started })); child.on('close', exitCode => resolve({ experimentId, exitCode, stderr, wallMs: performance.now() - started }));
  });
}
export async function main() {
  await mkdir(OUTPUT, { recursive: true });
  await writeJson('benchmark-predeclared-plan.json', { recordedBeforeExecution: new Date().toISOString(), plan: EXPERIMENT_PLAN.benchmark });
  const started = performance.now(), sizes = String(argument('sizes', '100,1000,3061,10000')).split(',').map(Number), executions = [], results = [];
  assert.ok(sizes.every(size => EXPERIMENT_PLAN.benchmark.householdSizes.includes(size)));
  for (const size of sizes) {
    try { await loadInputs(size); } catch (error) {
      const gate = { size, status: 'source-admission-blocked', message: String(error.message), performedTrials: 0, syntheticStressPerformed: false };
      results.push(gate); await writeJson(`benchmark-${size}-gate.json`, gate); console.log(JSON.stringify(gate)); continue;
    }
    const trials = [];
    for (let trial = 1; trial <= 5; trial++) {
      const experimentId = randomUUID(), execution = await runProcess(size, trial, trial === 1 ? 10 : 0, experimentId); executions.push({ size, trial, ...execution });
      try { trials.push(validateBenchmarkWorker(JSON.parse(await readFile(new URL(`benchmark-worker-${size}-${trial}.json`, OUTPUT), 'utf8')), experimentId)); }
      catch (error) {
        const retained = [];
        for (const [temperature, index] of [['cold', trial], ...(trial === 1 ? Array.from({ length: 10 }, (_, index) => ['warm', index + 1]) : [])]) {
          try { const row = JSON.parse(await readFile(new URL(`benchmark-${size}-${temperature}-${index}.json`, OUTPUT), 'utf8')); if (row.experimentId === experimentId) retained.push(row); } catch { /* Missing trials remain in the failed worker denominator. */ }
        }
        trials.push({ size, trial, status: 'failed', message: String(error), rows: retained });
      }
    }
    const rows = trials.flatMap(trial => trial.rows ?? []), successful = rows.filter(row => row.status === 'completed');
    const sourceStableAllTrials = trials.every(trial => trial.sourceUnchanged === true) && new Set(trials.map(trial => JSON.stringify(trial.sourceSha256))).size === 1;
    const identicalDigestsAllTrials = new Set(successful.map(row => JSON.stringify(row.digests))).size === 1;
    const valid = rows.length === 15 && successful.length === 15 && sourceStableAllTrials && identicalDigestsAllTrials && executions.filter(execution => execution.size === size).every(execution => execution.exitCode === 0);
    const result = { size, status: valid ? 'completed' : 'failed', coldTrials: rows.filter(row => row.temperature === 'cold').length,
      warmTrials: rows.filter(row => row.temperature === 'warm').length, sourceStableAllTrials, identicalDigestsAllTrials,
      summary: Object.fromEntries(['cold', 'warm'].map(temperature => { const group = successful.filter(row => row.temperature === temperature); return [temperature, {
        runs: group.length, totalRunMs: statistics(group.map(row => row.timing.totalMs)), runP95MinutePlusPolicyMs: statistics(group.map(row => row.timing.minutePlusPolicyMs.p95)),
        allMinutePlusPolicyMsP95Bound: group.length ? Math.max(...group.map(row => row.timing.minutePlusPolicyMs.p95)) : null,
        maximumObservedHeapBytes: group.length ? Math.max(...group.map(row => row.timing.maximumObservedHeapBytes)) : null,
        target1000StepPass: valid && size === 1000 && group.length ? group.every(row => row.timing.minutePlusPolicyMs.p95 < 100) : null }]; })),
      browserInteraction: { performed: false, targetMs: 200, targetPass: null }, trials };
    results.push(result); await writeJson(`benchmark-${size}-receipt.json`, result);
  }
  const receipt = { recordedAt: new Date().toISOString(), command: process.argv, environment: environment(), plan: EXPERIMENT_PLAN.benchmark, elapsedMs: performance.now() - started, executions, results,
    modelCalls: 0, networkCalls: 0, heapScope: 'Largest process heap sample at minute boundaries; not allocation rate or guaranteed OS peak.', calibration: 'Unperformed; engineering synthetic workload measurements only.' };
  await writeJson('benchmark-receipt.json', receipt);
  console.log(JSON.stringify({ receipt: '.private/dallas-v2-evaluation/benchmark-receipt.json', elapsedMs: receipt.elapsedMs, results: results.map(({ size, status, coldTrials, warmTrials }) => ({ size, status, coldTrials, warmTrials })) }));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) { if (process.argv.includes('--worker')) await worker(); else await main(); }
