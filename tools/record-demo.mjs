import { chromium } from '@playwright/test';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// A local automatic observer recording, with no manual assignment or model calls.
// Every mission in the exported run must have been issued by the auto coordinator.
const origin = process.env.APP_URL || 'http://127.0.0.1:43183';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use an explicitly selected local preview');
const directory = '.private/demo-recording/automatic-dallas';
await mkdir(directory, { recursive: true });
const tileFixture = await readFile(new URL('../tests/fixtures/map-tile.svg', import.meta.url));
const viewport = { width: 1440, height: 900 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport, reducedMotion: 'reduce', recordVideo: { dir: directory, size: viewport } });
const page = await context.newPage();
const errors = [], external = [], observations = [], tileRequests = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  // Synthetic tile image only. No automated traffic reaches the live provider.
  if (url.origin === 'https://tile.openstreetmap.org' && /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname) && route.request().method() === 'GET') {
    tileRequests.push(url.href);
    return route.fulfill({ contentType: 'image/svg+xml', body: tileFixture });
  }
  if (url.origin === new URL(origin).origin && route.request().method() === 'GET') return route.continue();
  external.push({ url: route.request().url(), method: route.request().method() }); return route.abort();
});
const started = Date.now();
const at = async seconds => { const delay = started + seconds * 1000 - Date.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay)); };
const pause = async () => { const button = page.getByRole('button', { name: 'Pause simulation', exact: true }); if (await button.count()) await button.click(); };
const minute = async () => {
  const clock = /^(\d+):(\d+)/.exec(await page.locator('.clock-display').innerText());
  assert.ok(clock, 'Simulation clock exposes elapsed time');
  return Number(clock[1]) * 60 + Number(clock[2]);
};
const advanceTo = async target => {
  await pause();
  assert.ok(await minute() <= target, 'Playback exceeded the scripted observation minute');
  while (await minute() < target) await page.getByRole('button', { name: 'Advance one minute', exact: true }).click();
};
const select = id => page.getByRole('button', { name: 'Select ' + id + ' generated representative', exact: true }).click();
const closePanel = async () => { if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape'); };
const waitForMap = async () => {
  await page.locator('.geographic-tile-status').filter({ hasText: 'Street map loaded.' }).waitFor();
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')];
    return tiles.length > 0 && tiles.every(tile => tile.complete && tile.naturalWidth > 0);
  });
};
const openWhileRunning = async name => {
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pause simulation', exact: true }).count(), 1);
  await page.getByRole('button', { name, exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Resume simulation', exact: true }).count(), 1);
  const stoppedAt = await minute();
  await page.waitForTimeout(650); // Greater than the 4x (500ms) tick.
  assert.equal(await minute(), stoppedAt, name + ' pauses active playback');
};
try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await waitForMap();
  await at(5); await page.getByRole('button', { name: 'Start simulation', exact: true }).click(); await pause();
  await waitForMap();
  assert.equal(await minute(), 0);
  assert.equal(await page.getByLabel('Response unit', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Select H\d+ generated representative$/ }).count(), 3);
  for (const [second, id] of [[10, 'H02'], [14, 'H09'], [18, 'H19']]) {
    await at(second); await select(id);
    observations.push({ second, minute: await minute(), selected: id });
  }
  await at(22); await page.getByText('Full source & custody', { exact: true }).click();
  assert.match(await page.locator('.persona-proof-body').innerText(), /gpt-6\.1-terra \/ low/);
  await at(32); await page.getByText('Full source & custody', { exact: true }).click();
  await page.getByLabel('Playback speed', { exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  await page.waitForFunction(() => {
    const clock = /^(\d+):(\d+)/.exec(document.querySelector('.clock-display')?.textContent || '');
    return clock && Number(clock[1]) * 60 + Number(clock[2]) >= 5;
  }, null, { timeout: 10_000 });
  await pause(); await select('H19');
  await page.getByRole('heading', { name: /Cannot call.*network gap/ }).waitFor();
  observations.push({ minute: await minute(), state: 'H19 prepared request cannot call during network gap' });
  await at(37); await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await waitForMap();
  await at(39); await page.getByRole('button', { name: 'Fit simulation area', exact: true }).click(); await waitForMap();
  await at(42); await openWhileRunning('Details');
  const details = page.getByRole('dialog', { name: 'Details', exact: true });
  await details.getByText('Behavior provenance', { exact: false }).click();
  assert.match(await details.innerText(), /3 verified model-generated profiles; 3 accepted autonomous requests/);
  assert.match(await details.innerText(), /Playback makes no model calls/);
  await at(57); await closePanel();
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  await page.waitForFunction(() => {
    const clock = /^(\d+):(\d+)/.exec(document.querySelector('.clock-display')?.textContent || '');
    return clock && Number(clock[1]) * 60 + Number(clock[2]) >= 20;
  }, null, { timeout: 15_000 });
  await pause();
  await at(75); await advanceTo(35); await select('H19');
  const status = page.getByRole('region', { name: 'Observed status', exact: true });
  assert.match(await status.innerText(), /Traveling to shelter/);
  assert.equal(await status.getByRole('heading', { name: 'Assistance completed', exact: true }).count(), 0, 'Travel is not completed assistance');
  observations.push({ minute: 35, state: 'H19 transporting; assistance pending' });
  await at(90); await advanceTo(36);
  await status.getByRole('heading', { name: 'Assistance completed', exact: true }).waitFor();
  assert.match(await status.innerText(), /Completed 00:36/);
  await page.getByRole('heading', { name: /Assistance complete.*m36/ }).waitFor();
  observations.push({ minute: 36, state: 'H19 assistance completed after deadline' });
  await at(104); await openWhileRunning('Activity');
  await at(118); await closePanel();
  await page.getByRole('button', { name: 'Exercise', exact: true }).click();
  await page.getByRole('button', { name: 'View outcomes', exact: true }).click();
  await at(130); await page.getByRole('button', { name: 'Finish now', exact: true }).click();
  await page.getByRole('heading', { name: 'Results & analysis', exact: true }).waitFor();
  await page.getByText('6 of 6 needs resolved', { exact: true }).waitFor();
  await waitForMap();
  assert.equal(await page.locator('.outcome-summary > div').filter({ has: page.getByText('People helped', { exact: true }) }).locator('dd').innerText(), '15');
  assert.equal(await page.locator('.outcome-summary > div').filter({ has: page.getByText('Urgent help on time', { exact: true }) }).locator('dd').innerText(), '2 / 3');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export run', exact: true }).click();
  const runPath = directory + '/automatic-dallas-minute60.json';
  await (await downloading).saveAs(runPath);
  const run = JSON.parse(await readFile(runPath, 'utf8'));
  assert.equal(run.savedMinute, 60);
  assert.equal(run.config.template, 'storm-dallas-v1');
  assert.equal(run.expectedSummary.assistanceCompleted, 6);
  assert.equal(run.expectedSummary.totalNeeds, 6);
  assert.equal(run.expectedSummary.peopleAssisted, 15);
  assert.equal(run.expectedSummary.timelyUrgentCount, 2);
  assert.equal(run.expectedSummary.urgentNeeds, 3);
  assert.equal(run.expectedSummary.households.find(home => home.householdId === 'H19').completedAt, 36);
  assert.ok(run.commands.length > 3 && run.commands.every(row => row.result.accepted && row.command.commandId.startsWith('AUTO-')));
  await at(148); await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await at(160); await page.getByRole('tab', { name: 'Homes', exact: true }).click();
  await page.getByLabel('Inspect household timeline', { exact: true }).selectOption('H19');
  assert.match(await page.locator('.timeline-highlight').innerText(), /00:36/);
  await at(174); await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await at(180);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.ok(tileRequests.length > 0, 'Fixture-only tile interception was exercised');
  const durationSeconds = Math.round((Date.now() - started) / 1000);
  const video = page.video(); await page.close(); await context.close();
  const path = directory + '/automatic-dallas-response-demo.webm'; await rename(await video.path(), path);
  const receipt = {
    video: path, run: runPath, durationSeconds,
    durationBasis: 'observer session wall time; encoded media duration is measured separately', viewport,
    mode: 'automatic coordinator; observer controls only',
    automatic: { assisted: run.expectedSummary.assistanceCompleted, totalNeeds: run.expectedSummary.totalNeeds, peopleHelped: run.expectedSummary.peopleAssisted, timelyUrgent: run.expectedSummary.timelyUrgentCount, urgentNeeds: run.expectedSummary.urgentNeeds, h19CompletedAt: 36 },
    authoredWitness: 'not used; public/data/default-dallas-run.json is a separate manual feasibility witness',
    evidence: 'scripted local browser recording with synthetic fixture tiles; native Preview, live map appearance and user acceptance remain separate',
    observations, automaticCommands: run.commands.length, runtimeErrors: errors, unexpectedRequests: external.length,
    tileRequestsIntercepted: tileRequests.length, liveTileRequests: 0, paidProviderCalls: 0,
  };
  await writeFile(directory + '/automatic-dallas-response-demo.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
