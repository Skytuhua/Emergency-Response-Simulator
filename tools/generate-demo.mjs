import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createScenario, DEFAULT_CONFIG } = await server.ssrLoadModule('/src/scenario.ts');
  const { runDefaultWitness, summarize } = await server.ssrLoadModule('/src/sim/results.ts');
  const { makeRunFile, parseRunFile } = await server.ssrLoadModule('/src/run-file.ts');
  const { default: artifact } = await server.ssrLoadModule('/public/data/mirofish-v1.json');
  const state = runDefaultWitness(createScenario(DEFAULT_CONFIG, artifact));
  const summary = summarize(state);
  assert.equal(summary.assistanceCompleted, 6); assert.equal(summary.timelyUrgentCount, 3);
  const file = makeRunFile(state); const text = JSON.stringify(file, null, 2);
  parseRunFile(text);
  await writeFile('public/data/default-run.json', text);
  console.log(JSON.stringify({ savedRun: 'public/data/default-run.json', completed: summary.assistanceCompleted, timelyUrgent: summary.timelyUrgentCount, kits: summary.kitsConsumed, shelterPlaces: summary.shelterOccupancy }));
} finally { await server.close(); }
