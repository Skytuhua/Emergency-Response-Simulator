import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Deliberately separate from config/import validation and the 24-home demo UI.
// This synthetic, single-process experiment makes no model or external requests.
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = new URL('../.private/scale-check.json', import.meta.url);
const publicReport = new URL('../docs/evidence/scale-check.md', import.meta.url);
const householdCount = 1000;
const shortlistLimit = 12;
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
const round = number => Math.round(number * 1000) / 1000;
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, totalMs: round(values.reduce((sum, value) => sum + value, 0)), medianMs: round(sorted[Math.floor((sorted.length - 1) * .5)] ?? 0), p95Ms: round(sorted[Math.ceil(sorted.length * .95) - 1] ?? 0), maxMs: round(sorted.at(-1) ?? 0) };
};

try {
  const { createScenario, DALLAS_DEFAULT_CONFIG } = await server.ssrLoadModule('/src/scenario.ts');
  const { initialize, dispatch, advanceMinute } = await server.ssrLoadModule('/src/sim/engine.ts');
  const { observe } = await server.ssrLoadModule('/src/sim/observe.ts');
  const { summarize } = await server.ssrLoadModule('/src/sim/results.ts');
  const { getPriorityGroups } = await server.ssrLoadModule('/src/ui/priorities.ts');
  const { HORIZON } = await server.ssrLoadModule('/src/model.ts');
  const started = performance.now();
  const template = createScenario(DALLAS_DEFAULT_CONFIG, null);
  const scenario = structuredClone(template);
  scenario.households = Array.from({ length: householdCount }, (_, index) => {
    const source = template.households[index % template.households.length];
    const id = `S${String(index + 1).padStart(4, '0')}`;
    return { ...structuredClone(source), id, name: `Synthetic household ${index + 1}`, address: `Synthetic copy of demo location ${source.id}`, need: source.need ? { ...source.need, id: `N-${id}` } : null };
  });
  scenario.reports = scenario.households.flatMap((home, index) => {
    if (!home.need) return [];
    const sourceId = template.households[index % template.households.length].id;
    const source = template.reports.find(report => report.householdId === sourceId);
    return [{ id: `R-${home.id}`, householdId: home.id, needId: home.need.id, attemptMinute: source.attemptMinute, source: 'rule-based' }];
  });
  scenario.artifact = null;
  const materializeMs = performance.now() - started;
  const initialStarted = performance.now();
  let state = initialize(scenario, 'scale-check-synthetic-1000');
  const initializeMs = performance.now() - initialStarted;
  const advanceTimes = [], priorityTimes = [], dispatchTimes = [], queueSnapshots = [];
  let maximumObservedHeapBytes = process.memoryUsage().heapUsed;
  let invariantChecks = 0;

  function verify(current) {
    invariantChecks++;
    const kit = current.kits;
    for (const amount of [kit.initial, kit.available, kit.reserved, kit.consumed]) assert.ok(Number.isSafeInteger(amount) && amount >= 0);
    assert.equal(kit.available + kit.reserved + kit.consumed, kit.initial, 'Kit conservation');
    for (const shelter of current.shelters) {
      for (const amount of [shelter.available, shelter.reserved, shelter.occupied]) assert.ok(Number.isSafeInteger(amount) && amount >= 0);
      assert.equal(shelter.available + shelter.reserved + shelter.occupied, shelter.capacity, 'Shelter conservation');
      const transports = current.missions.filter(mission => mission.action === 'RELOCATE' && mission.shelterId === shelter.id);
      const residents = mission => current.scenario.households.find(home => home.id === mission.householdId).size;
      assert.equal(shelter.occupied, transports.filter(mission => mission.status === 'completed').reduce((sum, mission) => sum + residents(mission), 0), 'Occupied places match completed transports');
      assert.equal(shelter.reserved, transports.filter(mission => mission.status !== 'completed').reduce((sum, mission) => sum + residents(mission), 0), 'Reserved places match unfinished transports');
    }
    assert.equal(kit.consumed, current.missions.filter(mission => mission.action === 'DELIVER' && mission.status === 'completed').length, 'Consumed kits match completed deliveries');
    assert.equal(kit.reserved, current.missions.filter(mission => mission.action === 'DELIVER' && mission.status !== 'completed').length, 'Reserved kits match unfinished deliveries');
    for (const progress of current.households.filter(home => home.completedAt !== null)) {
      const completedMission = current.missions.find(mission => mission.householdId === progress.householdId && mission.action !== 'ASSESS' && mission.status === 'completed' && mission.completionAt === progress.completedAt);
      assert.ok(completedMission, 'A completed home must have a completed assistance mission');
      assert.ok(progress.completedAt <= current.minute, 'No future completion counted');
      assert.ok(current.events.some(event => event.type === 'completion' && event.householdId === progress.householdId && event.minute === progress.completedAt), 'Completion event must exist');
    }
    for (const unit of current.units) assert.ok(unit.busyMinutes >= 0 && unit.busyMinutes <= current.minute);
    assert.ok(current.commands.length < 500, 'Workload must stay below the existing command limit');
  }

  function priorities(current, record = false) {
    const view = observe(current);
    const before = performance.now();
    const groups = getPriorityGroups(view);
    priorityTimes.push(performance.now() - before);
    if (record) queueSnapshots.push({ minute: current.minute, needsHelp: groups['needs-help'].length, notCheckedUnknownNeed: groups['not-checked'].length, onTheWay: groups['on-the-way'].length, totalVisibleQueue: Object.values(groups).reduce((sum, group) => sum + group.length, 0) });
    return groups;
  }

  verify(state);
  while (!state.finalized) {
    const record = [0, 10, 30].includes(state.minute);
    priorities(state, record);
    for (const unitId of state.units.filter(unit => !unit.missionId).map(unit => unit.id).sort()) {
      const unit = state.units.find(item => item.id === unitId);
      const groups = priorities(state);
      const assistance = groups['needs-help'].filter(home => home.known.need.kind === 'delivery'
        ? unit.kind === 'crew' && state.kits.available > 0
        : unit.kind === 'van' && unit.seats >= home.known.size && (!home.known.accessible || unit.accessible) && state.shelters.some(shelter => shelter.available >= home.known.size && (!home.known.accessible || shelter.accessible)));
      // Bounded public queue policy, not an optimized baseline or triage model.
      const candidates = (assistance.length ? assistance : groups['not-checked']).slice(0, shortlistLimit);
      for (const home of candidates) {
        const need = home.known?.need;
        const shelter = need?.kind === 'relocation' ? state.shelters.find(item => item.available >= home.known.size && (!home.known.accessible || item.accessible)) : undefined;
        const intent = { action: !need ? 'ASSESS' : need.kind === 'delivery' ? 'DELIVER' : 'RELOCATE', householdId: home.id, unitId, ...(shelter ? { shelterId: shelter.id } : {}) };
        const before = performance.now();
        const applied = dispatch(state, { ...intent, runId: state.runId, commandId: `S${state.commands.length + 1}`, sequence: state.commands.length + 1, minute: state.minute });
        dispatchTimes.push(performance.now() - before);
        state = applied.state;
        if (applied.result.accepted) break;
      }
    }
    const before = performance.now();
    state = advanceMinute(state);
    advanceTimes.push(performance.now() - before);
    verify(state);
    maximumObservedHeapBytes = Math.max(maximumObservedHeapBytes, process.memoryUsage().heapUsed);
  }
  priorities(state, true);
  const summarizeStarted = performance.now();
  const summary = summarize(state);
  const summarizeMs = performance.now() - summarizeStarted;
  const completed = state.households.filter(home => home.completedAt !== null);
  const expectedPeople = completed.reduce((sum, progress) => sum + scenario.households.find(home => home.id === progress.householdId).size, 0);
  assert.equal(summary.peopleAssisted, expectedPeople, 'People count derives only from completed homes');
  assert.equal(summary.assistanceCompleted, completed.length, 'Completed needs count must match completed homes');
  assert.equal(state.minute, HORIZON);
  assert.equal(summary.householdCount, householdCount);
  assert.equal(state.scenario.artifact, null);
  const unchecked = state.households.filter(home => home.assessedAt === null);
  const receipt = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    experiment: 'Single-process 1,000 synthetic homes sharing 24 frozen Dallas demo locations',
    environment: { node: process.version, platform: process.platform, release: os.release(), architecture: process.arch, cpu: os.cpus()[0]?.model ?? 'unavailable', logicalCpus: os.cpus().length, totalMemoryGiB: round(os.totalmem() / 1024 ** 3) },
    workload: { households: summary.householdCount, population: summary.population, actualNeedHomes: summary.totalNeeds, sourceDemoLocations: template.households.length, uniqueRoadNodesUsedByHomes: new Set(scenario.households.map(home => home.nodeId)).size, roadNodes: scenario.map.nodes.length, roadEdges: scenario.map.edges.length, units: state.units.length, startingKits: scenario.kits.initial, startingShelterPlaces: scenario.shelters.reduce((sum, shelter) => sum + shelter.capacity, 0), simulatedMinutes: state.minute, clockAdvances: advanceTimes.length, policy: `Public priority groups, compatible resources, at most ${shortlistLimit} candidate dispatch attempts per idle unit per minute`, modelCalls: 0, externalRequests: 0 },
    timing: { materializeMs: round(materializeMs), initializeMs: round(initializeMs), advance: stats(advanceTimes), priorities: stats(priorityTimes), dispatch: stats(dispatchTimes), summarizeMs: round(summarizeMs), totalExperimentMs: round(performance.now() - started), maximumObservedHeapMiB: round(maximumObservedHeapBytes / 1024 ** 2) },
    observableQueues: queueSnapshots,
    final: { finalized: state.finalized, completedHomes: summary.assistanceCompleted, peopleHelped: summary.peopleAssisted, urgentHomesHelpedOnTime: summary.timelyUrgentCount, urgentNeedHomes: summary.urgentNeeds, actualNeedHomesStillWaiting: summary.totalNeeds - summary.assistanceCompleted, peopleStillWaiting: summary.households.filter(home => home.need && home.completedAt === null).reduce((sum, home) => sum + home.size, 0), homesNotChecked: unchecked.length, homesNotCheckedInOutage: unchecked.filter(progress => scenario.households.find(home => home.id === progress.householdId).neighborhood === scenario.config.networkGap).length, undiscoveredActualNeeds: summary.stillUndiscovered, unfinishedMissions: state.missions.filter(mission => mission.status !== 'completed').length, commandsAccepted: state.commands.filter(command => command.result.accepted).length, commandsRejected: state.commands.filter(command => !command.result.accepted).length, kits: state.kits, shelters: state.shelters.map(({ id, capacity, available, reserved, occupied }) => ({ id, capacity, available, reserved, occupied })) },
    invariants: { stateChecks: invariantChecks, nonnegativeResourceConservation: true, completedHomesHaveCompletedAssistanceMissionAndEvent: true, peopleHelpedDerivedFromCompletedHomes: true, commandLimitUnchanged: 500 },
    unperformed: ['Uncoached first-time participant test (target 4 of 5; no participants recruited)', '1,000-home browser rendering or interaction test', 'Concurrent users, network services, providers, or deployment load', 'Citywide coverage, real household needs, validated triage, or production capacity'],
    sourceSha256: {},
  };
  for (const path of ['tools/scale-check.mjs', 'src/model.ts', 'src/scenario.ts', 'src/sim/engine.ts', 'src/sim/observe.ts', 'src/sim/routes.ts', 'src/sim/results.ts', 'src/ui/priorities.ts', 'fixtures/maps/dallas-streets-v1.json']) receipt.sourceSha256[path] = createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex');
  const queueRows = receipt.observableQueues.map(queue => `| ${queue.minute} | ${queue.needsHelp} | ${queue.notCheckedUnknownNeed} | ${queue.onTheWay} | ${queue.totalVisibleQueue} |`).join('\n');
  const report = `# Bounded synthetic scale experiment\n\nGenerated by \`node tools/scale-check.mjs\` at ${receipt.recordedAt}. Machine-readable receipt: \`.private/scale-check.json\`.\n\nThis single-process engine experiment used **${summary.householdCount} synthetic households (${summary.population} residents)** at the same **${template.households.length} fictional demo placements** on the frozen Dallas street graph. Locations, resident counts, and need patterns repeat; these are not 1,000 distinct real homes. The app config, importer, 24-home UI, resource limits, and 500-command engine cap were not expanded. No model calls or external requests were made.\n\nEnvironment: ${receipt.environment.platform} ${receipt.environment.release}, ${receipt.environment.architecture}; Node ${receipt.environment.node}; ${receipt.environment.cpu}; ${receipt.environment.logicalCpus} logical CPUs; ${receipt.environment.totalMemoryGiB} GiB system memory.\n\n## Executed workload and time\n\nThe actual engine advanced ${advanceTimes.length} times to minute ${state.minute}. A bounded policy read only public observation priority groups and tried up to ${shortlistLimit} candidates per idle unit per minute. It used ${state.units.length} existing response units, ${scenario.kits.initial} kits and ${receipt.workload.startingShelterPlaces} shelter places. This is a workload measurement, not a policy-quality comparison.\n\n| Measurement | Result |\n| --- | ---: |\n| Total experiment, after module loading | ${receipt.timing.totalExperimentMs} ms |\n| Materialize synthetic scenario | ${receipt.timing.materializeMs} ms |\n| Initialize actual engine | ${receipt.timing.initializeMs} ms |\n| Advance minute: median / p95 / max | ${receipt.timing.advance.medianMs} / ${receipt.timing.advance.p95Ms} / ${receipt.timing.advance.maxMs} ms |\n| Priority list build: samples / p95 / max | ${receipt.timing.priorities.samples} / ${receipt.timing.priorities.p95Ms} / ${receipt.timing.priorities.maxMs} ms |\n| Dispatch attempts: samples / p95 / max | ${receipt.timing.dispatch.samples} / ${receipt.timing.dispatch.p95Ms} / ${receipt.timing.dispatch.maxMs} ms |\n| Final summary calculation | ${receipt.timing.summarizeMs} ms |\n| Largest heap sample at minute boundaries | ${receipt.timing.maximumObservedHeapMiB} MiB |\n\nThe priority timing excludes observation projection; the total includes it. Heap samples are not an allocation profile or a guaranteed peak. One run, with Vite SSR and no warmup or repeated statistical benchmark, is recorded.\n\n## Observable queues\n\n| Minute | Known needs, unassigned | Unknown need, not checked | Mission in progress | Total visible queue |\n| --- | ---: | ---: | ---: | ---: |\n${queueRows}\n\nThese queues are built from public observations. Unknown homes are not treated as verified needs. The queue's unknown/not-checked category excludes homes whose report revealed facts; the debrief's homes-not-checked count includes every home without a completed assessment, including reported homes.\n\n## Final engine outcomes\n\n- ${summary.assistanceCompleted} need homes completed; ${summary.peopleAssisted} people helped; ${summary.timelyUrgentCount} / ${summary.urgentNeeds} urgent need homes helped on time.\n- ${receipt.final.actualNeedHomesStillWaiting} actual need homes (${receipt.final.peopleStillWaiting} people) still waiting; ${receipt.final.unfinishedMissions} unfinished missions.\n- ${receipt.final.homesNotChecked} homes never checked, including ${receipt.final.homesNotCheckedInOutage} in the communications outage; ${summary.stillUndiscovered} actual needs remained undiscovered.\n- ${receipt.final.commandsAccepted} dispatches accepted; ${receipt.final.commandsRejected} rejected. Kits: ${state.kits.consumed} consumed, ${state.kits.reserved} reserved, ${state.kits.available} available. Shelter places: ${summary.shelterOccupancy} occupied, ${state.shelters.reduce((sum, shelter) => sum + shelter.reserved, 0)} reserved.\n\nResource conservation and nonnegative counters were asserted on all ${invariantChecks} engine states. Every counted completed home was checked against a completed assistance mission and its completion event; assisted population was independently recomputed from those homes. The unchanged resource shortage leaves most needs unresolved.\n\n## Evidence limits and participant target\n\nThe target is at least 4 of 5 uncoached first-time participants completing the demo goal. **This participant test is unperformed**: no participants were recruited or observed. Automated checks are not user research.\n\nThis experiment does not establish browser usability with 1,000 homes, citywide coverage, real household needs, validated triage, concurrent clients, provider performance, deployment capacity or production readiness. Repeated placements and the small fixed resource pool bound what this run demonstrates. Source hashes and exact counters are retained in the private receipt.\n`;
  await mkdir(new URL('../.private/', import.meta.url), { recursive: true });
  await mkdir(new URL('../docs/evidence/', import.meta.url), { recursive: true });
  await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(publicReport, report);
  console.log(JSON.stringify({ receipt: '.private/scale-check.json', report: 'docs/evidence/scale-check.md', households: summary.householdCount, peopleHelped: summary.peopleAssisted, totalMs: receipt.timing.totalExperimentMs, invariantStates: invariantChecks }));
} finally {
  await server.close();
}
