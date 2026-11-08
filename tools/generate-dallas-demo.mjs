import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createScenario, DALLAS_DEFAULT_CONFIG } = await server.ssrLoadModule('/src/scenario.ts');
  const { initialize, dispatch, advanceMinute } = await server.ssrLoadModule('/src/sim/engine.ts');
  const { observe } = await server.ssrLoadModule('/src/sim/observe.ts');
  const { getPrimaryAction, getSuggestedAssignment } = await server.ssrLoadModule('/src/ui/suggestions.ts');
  const { summarize } = await server.ssrLoadModule('/src/sim/results.ts');
  const { makeRunFile, parseRunFile, replay } = await server.ssrLoadModule('/src/run-file.ts');
  const { default: artifact } = await server.ssrLoadModule('/public/data/mirofish-dallas-v1.json');

  // These are authored learning targets, not a hidden-truth or public priority policy.
  // Every assistance decision below still requires a known public need and a legal suggestion.
  const targets = ['H19', 'H09', 'H02', 'H05', 'H12', 'H15'];
  const scenario = createScenario(DALLAS_DEFAULT_CONFIG, artifact);
  const physicalTruth = JSON.stringify(scenario.households);
  let state = initialize(scenario, 'dallas-authored-witness');
  const send = intent => {
    assert.ok(intent, `No feasible authored assignment at minute ${state.minute}`);
    const sequence = state.commands.length + 1;
    const applied = dispatch(state, { ...intent, runId: state.runId, commandId: `DW${sequence}`, sequence, minute: state.minute });
    assert.ok(applied.result.accepted, `Authored witness rejected at ${state.minute}: ${applied.result.reason}`);
    state = applied.state;
  };
  send(getSuggestedAssignment(observe(state), 'H19', 'ASSESS', 'C1'));
  send(getSuggestedAssignment(observe(state), 'H09', 'ASSESS', 'V2'));
  while (!state.finalized) {
    for (const unitId of ['V1', 'C1', 'V2']) {
      const view = observe(state);
      if (view.units.find(unit => unit.id === unitId)?.missionId) continue;
      // Hold the accessible van at base for the authored H19 discovery at minute 6.
      if (unitId === 'V1' && !view.households.find(home => home.id === 'H19')?.known) continue;
      const publicTargets = targets.map(id => view.households.find(home => home.id === id));
      const work = [
        ...publicTargets.filter(home => home?.known?.need),
        ...publicTargets.filter(home => home && !home.known),
      ];
      for (const home of work) {
        const action = getPrimaryAction(home);
        const intent = action && getSuggestedAssignment(view, home.id, action, unitId);
        if (!intent || intent.unitId !== unitId) continue;
        send(intent);
        break;
      }
    }
    state = advanceMinute(state);
  }
  assert.equal(JSON.stringify(state.scenario.households), physicalTruth, 'Witness must not alter physical truth');
  const summary = summarize(state);
  assert.equal(summary.assistanceCompleted, 6);
  assert.equal(summary.timelyUrgentCount, 3);
  assert.equal(summary.kitsConsumed, 3);
  assert.equal(summary.shelterOccupancy, 9);
  const h19 = state.missions.find(mission => mission.householdId === 'H19' && mission.action === 'RELOCATE');
  assert.deepEqual([h19.dispatchedAt, h19.pickupAt, h19.completionAt], [6, 12, 21]);
  const text = JSON.stringify(makeRunFile(state), null, 2);
  const restored = replay(parseRunFile(text));
  assert.deepEqual(summarize(restored), summary);
  await writeFile('public/data/default-dallas-run.json', text);
  console.log(JSON.stringify({
    savedRun: 'public/data/default-dallas-run.json', evidence: 'authored replay witness; not a baseline or public priority evaluation',
    completed: summary.assistanceCompleted, timelyUrgent: summary.timelyUrgentCount,
    kits: summary.kitsConsumed, shelterPlaces: summary.shelterOccupancy, bytes: Buffer.byteLength(text),
    missions: state.missions.map(({ action, unitId, householdId, shelterId, dispatchedAt, arrivalAt, pickupAt, completionAt }) => ({ action, unitId, householdId, shelterId, dispatchedAt, arrivalAt, pickupAt, completionAt })),
  }));
} finally { await server.close(); }
