import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

// Run against the production preview. No provider or external asset access is allowed.
const origin = process.env.APP_URL || 'http://127.0.0.1:4175';
const output = '.private/browser-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [], external = [];
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url()); return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const clock = () => page.locator('.clock-display');
const step = async count => { for (let i = 0; i < count; i++) await page.getByRole('button', { name: 'Advance one minute' }).click(); };
try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByText('Prepared MiroFish behavior', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/creator-desktop.png`, fullPage: true });
  const overlaps = await page.evaluate(() => {
    const legend = document.querySelector('.map-legend').getBoundingClientRect();
    return [...document.querySelectorAll('.map-house-label')].filter(label => {
      const box = label.getBoundingClientRect();
      return box.bottom > legend.top && box.top < legend.bottom && box.right > legend.left && box.left < legend.right;
    }).map(label => label.textContent);
  });
  assert.deepEqual(overlaps, [], 'Map legend must not obscure household labels');
  await page.getByRole('button', { name: 'Create exercise', exact: true }).click();
  assert.equal(await clock().evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, 'Clock must be visible after creating below the fold');
  await page.getByRole('button', { name: 'Select a southeast home' }).click();
  await page.getByText('Need not yet known').waitFor();
  assert.equal(await page.getByText('Shelter relocation', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /^Assess/ }).click();
  await step(7);
  assert.equal(await page.getByText('Shelter relocation', { exact: true }).count(), 0);
  await step(1);
  await page.getByText('Shelter relocation', { exact: true }).waitFor();
  assert.match(await clock().innerText(), /00:08/);
  await page.getByRole('button', { name: 'Resume exercise' }).waitFor();
  await page.screenshot({ path: `${output}/response-desktop.png`, fullPage: true });
  await page.getByLabel('Response unit', { exact: true }).selectOption('V1');
  await page.getByRole('button', { name: /^Relocate/ }).click();
  await step(9);
  assert.match(await clock().innerText(), /00:17/);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export run', exact: true }).click();
  const download = await downloading;
  const runPath = `${output}/partial-run.json`; await download.saveAs(runPath);
  const saved = JSON.parse(await readFile(runPath, 'utf8'));
  assert.equal(saved.savedMinute, 17);
  assert.equal(saved.artifact.generationOutcome, 'target');
  await page.getByRole('button', { name: 'Import saved run', exact: true }).click();
  await page.getByLabel('Choose saved run file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.getByRole('alert').filter({ hasText: /missing|unsupported|required|run/i }).waitFor();
  assert.match(await clock().innerText(), /00:17/);
  await page.getByRole('button', { name: 'Import saved run', exact: true }).click();
  await page.getByLabel('Choose saved run file').setInputFiles(runPath);
  await page.getByText('Saved decisions replayed to minute 17. Playback is paused.').waitFor();
  await page.getByRole('button', { name: /^H19, Southeast, assigned/ }).click();
  await step(7);
  assert.match(await clock().innerText(), /00:24/);
  assert.equal(await page.locator('.facts-list dd').filter({ hasText: /^Assisted$/ }).count(), 1);
  await page.getByRole('button', { name: /Finish at minute 60/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Finish exercise', exact: true }).evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, 'Finish confirmation must be in view');
  await page.getByRole('button', { name: 'Finish exercise', exact: true }).click();
  await page.getByRole('heading', { name: 'Results & analysis' }).waitFor();
  await page.screenshot({ path: `${output}/results-desktop.png`, fullPage: true });
  assert.equal(await page.getByRole('img', { name: /People assisted by minute 60: your response 2/ }).count(), 1);
  await page.getByRole('button', { name: 'Restart same conditions' }).click();
  assert.match(await clock().innerText(), /00:00/);
  await page.getByRole('button', { name: 'Resume exercise' }).waitFor();
  // A fresh reload is usable while all external hosts are still blocked.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Set up your response' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/creator-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must not scroll horizontally');
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  assert.deepEqual(external, [], 'No external runtime requests');
  console.log(JSON.stringify({ passed: true, desktop: '1366x768', mobile: '390x844', goldenTimeline: '8/16/24', partialReplay: 17, offlineExternalRequests: external.length, screenshots: output }));
} finally { await browser.close(); }
