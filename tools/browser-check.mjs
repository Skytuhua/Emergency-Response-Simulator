import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin = process.env.APP_URL || 'http://127.0.0.1:4175';
const output = '.private/browser-evidence/simpler';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [], external = [], receipts = [];
const sizes = [{ width: 1366, height: 768 }, { width: 1440, height: 900 }];
async function checkFit(page, label) {
  const result = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
    viewport: [innerWidth, innerHeight],
    buttonsOutside: [...document.querySelectorAll('main button')].filter(element => {
      if (!element.checkVisibility()) return false;
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return r.width && r.height && s.visibility !== 'hidden' && !element.closest('dialog') && (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1);
    }).map(element => element.textContent),
    smallControls: [...document.querySelectorAll('main button, main select, main label')].filter(element => element.checkVisibility() && element.getBoundingClientRect().width && parseFloat(getComputedStyle(element).fontSize) < 14).map(element => element.textContent),
  }));
  assert.ok(result.height <= result.viewport[1] + 1, `${label}: document scrolls vertically ${JSON.stringify(result)}`);
  assert.ok(result.width <= result.viewport[0] + 1, `${label}: document scrolls horizontally`);
  assert.deepEqual(result.buttonsOutside, [], `${label}: controls outside viewport`);
  assert.deepEqual(result.smallControls, [], `${label}: essential controls below14px`);
  receipts.push({ label, ...result });
}
async function checkMap(page) {
  const hidden = await page.evaluate(() => {
    const map = document.querySelector('.map-scene'); if (!map) return [];
    const scene = map.getBoundingClientRect(), legend = document.querySelector('.map-legend').getBoundingClientRect();
    return [...map.querySelectorAll('.map-house-label')].filter(element => {
      const r = element.getBoundingClientRect();
      return r.bottom > legend.top || r.left < scene.left || r.right > scene.right || parseFloat(getComputedStyle(element).fontSize) < 12;
    }).map(element => element.textContent);
  });
  assert.deepEqual(hidden, [], 'Household labels must be readable and clear of legend');
}
const step = async (page, count) => { for (let i = 0; i < count; i++) await page.getByRole('button', { name: 'Advance one minute' }).click(); };
const select = (page, id) => page.locator(`#map-home-${id}`).click();

try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await checkFit(page, `${size.width}-welcome`);
    await page.getByRole('button', { name: 'Customize the scenario', exact: true }).click();
    for (const stage of ['conditions', 'resources', 'review']) {
      await page.getByRole('heading', { name: stage[0].toUpperCase() + stage.slice(1), exact: true }).waitFor();
      assert.equal((await page.locator('.wizard-steps [aria-current="step"]').innerText()).replace(/\s+/g, ''), `${['conditions', 'resources', 'review'].indexOf(stage) + 1}${stage[0].toUpperCase() + stage.slice(1)}`);
      await checkFit(page, `${size.width}-${stage}`); await checkMap(page);
      await page.screenshot({ path: `${output}/${size.width}-${stage}.png` });
      if (stage !== 'review') await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Start exercise', exact: true }).click();
    await checkFit(page, `${size.width}-empty`);
    await select(page, 'H19'); await checkFit(page, `${size.width}-unknown`);
    assert.equal(await page.getByText('Shelter relocation', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Check home & run', exact: true }).click();
    await page.getByRole('button', { name: 'Pause exercise' }).waitFor();
    await step(page, 8);
    await page.getByRole('button', { name: 'Review need' }).waitFor();
    await checkFit(page, `${size.width}-urgent`); await checkMap(page);
    await page.screenshot({ path: `${output}/${size.width}-urgent.png` });
    await page.getByLabel('Response unit', { exact: true }).selectOption('V1');
    await page.getByRole('button', { name: 'Send transport & run', exact: true }).click();
    await page.getByRole('button', { name: 'Pause exercise' }).waitFor();
    await step(page, 9); await checkFit(page, `${size.width}-assigned`);
    assert.match(await page.locator('.clock-display').innerText(), /00:17/);
    await page.getByRole('button', { name: 'Exercise', exact: true }).click();
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export run', exact: true }).click();
    const savedPath = `${output}/${size.width}-minute17.json`; await (await downloading).saveAs(savedPath);
    assert.equal(JSON.parse(await readFile(savedPath, 'utf8')).savedMinute, 17);
    await page.getByRole('button', { name: 'Exercise', exact: true }).click();
    await page.getByRole('button', { name: 'Import run', exact: true }).click();
    await page.getByLabel('Choose saved run file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.locator('.global-error[role="alert"]').waitFor(); assert.match(await page.locator('.clock-display').innerText(), /00:17/);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.getByRole('button', { name: 'Exercise', exact: true }).click(); await page.getByRole('button', { name: 'Import run', exact: true }).click();
    await page.getByLabel('Choose saved run file').setInputFiles(savedPath);
    await page.getByText('Run restored at 17 min. Paused.', { exact: true }).waitFor();
    await select(page, 'H19'); await step(page, 7);
    await page.locator('.case-state h3').filter({ hasText: /^Helped$/ }).waitFor();
    await checkFit(page, `${size.width}-helped`);
    const teams = page.getByRole('button', { name: 'Teams', exact: true }); await teams.click();
    await page.getByRole('dialog', { name: 'Teams', exact: true }).waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await teams.evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Exercise', exact: true }).click(); await page.getByRole('button', { name: 'Finish exercise', exact: true }).click();
    await page.getByRole('button', { name: 'Finish now', exact: true }).click();
    for (const tab of ['Overview', 'Compare', 'Homes', 'Details']) {
      await page.getByRole('tab', { name: tab, exact: true }).click(); await checkFit(page, `${size.width}-results-${tab}`);
      if (tab === 'Overview') await page.screenshot({ path: `${output}/${size.width}-results.png` });
    }
    await page.getByRole('button', { name: 'Restart same conditions', exact: true }).click();
    assert.match(await page.locator('.clock-display').innerText(), /00:00/);
    // A zero-kit exercise keeps a clear visible blocker with no invalid dispatch.
    await page.getByRole('button', { name: 'Exercise', exact: true }).click(); await page.getByRole('button', { name: 'New exercise', exact: true }).click();
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await page.getByRole('button', { name: 'Customize the scenario', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByLabel('Supply kits', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Start exercise', exact: true }).click();
    await step(page, 10); await select(page, 'H02'); await checkFit(page, `${size.width}-shortage`);
    assert.equal(await page.getByRole('button', { name: 'Deliver kit & run', exact: true }).isDisabled(), true);
    await page.close(); await context.close();
  }
  if (process.env.CHECK_DEFERRED_MOBILE === '1') {
  const compact = await browser.newPage({ viewport: { width: 683, height: 384 } }); compact.on('pageerror', error => errors.push(error.message));
  await compact.goto(origin, { waitUntil: 'networkidle' });
  await compact.getByRole('button', { name: 'Customize the scenario', exact: true }).click();
  await compact.getByRole('button', { name: 'Continue', exact: true }).click(); await compact.getByRole('button', { name: 'Continue', exact: true }).click(); await compact.getByRole('button', { name: 'Start exercise', exact: true }).click();
  await compact.getByRole('button', { name: 'Homes', exact: true }).click(); await compact.getByRole('dialog', { name: 'Homes', exact: true }).getByRole('button', { name: /H19/ }).click();
  await compact.getByRole('dialog', { name: 'H19', exact: true }).waitFor();
  assert.equal(await compact.getByLabel('Response unit', { exact: true }).count(), 1, 'Only one accessible inspector is mounted');
  await compact.screenshot({ path: `${output}/zoom-reflow.png`, fullPage: true });
  await compact.keyboard.press('Escape'); assert.equal(await compact.getByRole('dialog').count(), 0);
  await compact.setViewportSize({ width: 390, height: 844 }); await compact.reload({ waitUntil: 'networkidle' });
  assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const toolbarIsClear = () => compact.evaluate(() => {
    const toolbar = document.querySelector('.workspace-toolbar');
    const next = document.querySelector('.wizard-layout, .results-tabs');
    return [...toolbar.querySelectorAll('button')].every(button => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 3);
      return box.bottom <= next.getBoundingClientRect().top && (hit === button || button.contains(hit));
    });
  });
  assert.equal(await toolbarIsClear(), true, 'Wrapped setup toolbar must not be covered by the form');
  await compact.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  await compact.getByRole('button', { name: 'Open run', exact: true }).click();
  await compact.getByLabel('Choose saved run file').setInputFiles('public/data/default-run.json');
  await compact.getByRole('heading', { name: 'Results & analysis' }).waitFor();
  assert.equal(await toolbarIsClear(), true, 'Wrapped results toolbar must not overlap tabs');
  await compact.close();
  }
  assert.deepEqual(errors, [], 'No runtime exceptions'); assert.deepEqual(external, [], 'No external requests');
  await writeFile(`${output}/layout-receipts.json`, JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify({ passed: true, desktopStates: receipts.length, viewports: sizes, mobile: 'deferred; opt in with CHECK_DEFERRED_MOBILE=1', golden: '8/16/24', partialReplay: 17, runtimeErrors: errors, externalRequests: external.length, evidence: output }));
} finally { await browser.close(); }
