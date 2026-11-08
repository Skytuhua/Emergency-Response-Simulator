import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Local observer regression. Only playback and observation controls are used;
// the automatic coordinator chooses all response units, shelters and missions.
// Use only the explicitly selected local preview. Native visual acceptance uses T3 Preview.
const origin = process.env.APP_URL || 'http://127.0.0.1:43183';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use an explicitly selected local preview');
const output = '.private/browser-evidence/automatic-dallas';
await mkdir(output, { recursive: true });
const tileFixture = await readFile(new URL('../tests/fixtures/map-tile.svg', import.meta.url));
const browser = await chromium.launch();
const errors = [], external = [], receipts = [], outcomes = [], tileRequests = [];
const sizes = [
  { width: 1366, height: 768 }, { width: 1440, height: 900 },
  { width: 1696, height: 1020 },
];

async function inspectLayout(page) {
  return page.evaluate(() => {
    const scrollSelector = '.simulation-residents, .observation-coordinator-body, .side-panel-body, .results-tab-panel, .debrief-waiting-list, [data-layout-scroll]';
    const selector = 'button, select, input, summary, a[href], [tabindex="0"]';
    const rendered = element => element.checkVisibility() && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const bounds = element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top + element.clientTop, bottom: rect.top + element.clientTop + element.clientHeight, left: rect.left + element.clientLeft, right: rect.left + element.clientLeft + element.clientWidth };
    };
    const label = element => element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName;
    const outside = (rect, box, axis) => axis === 'X' ? rect.left < box.left - 1 || rect.right > box.right + 1 : rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
    const viewport = { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    // Walk from the control outward. Only real scrolling can make an offscreen
    // row reachable. Hidden/clip never excuses essential content being lost.
    const exposure = element => {
      const original = element.getBoundingClientRect();
      const rect = { top: original.top, bottom: original.bottom, left: original.left, right: original.right };
      const loss = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = bounds(parent);
        for (const axis of ['X', 'Y']) {
          const overflow = style['overflow' + axis];
          if (!/^(auto|scroll|hidden|clip)$/.test(overflow)) continue;
          const scrolling = /^(auto|scroll)$/.test(overflow) && (axis === 'X' ? parent.scrollWidth > parent.clientWidth + 1 : parent.scrollHeight > parent.clientHeight + 1);
          const nonempty = rect.right > rect.left && rect.bottom > rect.top;
          if (nonempty && outside(rect, box, axis) && !scrolling) loss.push(axis + ':' + (parent.className || parent.tagName));
          if (axis === 'X') { rect.left = Math.max(rect.left, box.left); rect.right = Math.min(rect.right, box.right); }
          else { rect.top = Math.max(rect.top, box.top); rect.bottom = Math.min(rect.bottom, box.bottom); }
        }
      }
      return { rect, loss, visible: rect.right > rect.left && rect.bottom > rect.top };
    };
    const controls = [...document.querySelectorAll('main ' + selector.split(', ').join(', main '))].filter(rendered);
    const contentLoss = controls.flatMap(element => {
      const result = exposure(element);
      return result.loss.length ? [{ label: label(element), clipping: result.loss }] : [];
    });
    const controlsOutside = controls.filter(element => {
      const result = exposure(element);
      return result.visible && (outside(result.rect, viewport, 'X') || outside(result.rect, viewport, 'Y'));
    }).map(label);
    const origin = document.activeElement, modal = document.querySelector('dialog[open]');
    const regions = [...document.querySelectorAll(scrollSelector)].filter(rendered);
    const savedScroll = regions.map(region => [region, region.scrollLeft, region.scrollTop]);
    const scrollingRegions = regions.map(region => {
      const rect = region.getBoundingClientRect();
      const last = [...region.querySelectorAll(selector)].filter(element => rendered(element) && !element.disabled).at(-1);
      const canFocus = !modal || modal.contains(region);
      if (canFocus) last?.focus();
      const focused = last?.getBoundingClientRect();
      let focusAccessible = !canFocus || !focused;
      if (canFocus && focused) {
        focusAccessible = document.activeElement === last && !outside(focused, viewport, 'X') && !outside(focused, viewport, 'Y');
        for (let parent = last.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), box = bounds(parent);
          for (const axis of ['X', 'Y']) {
            if (/^(auto|scroll|hidden|clip)$/.test(style['overflow' + axis]) && outside(focused, box, axis)) focusAccessible = false;
          }
        }
      }
      for (const [element, left, top] of savedScroll) { element.scrollLeft = left; element.scrollTop = top; }
      return { label: region.getAttribute('aria-label') || region.className, bounded: !outside(rect, viewport, 'X') && !outside(rect, viewport, 'Y'), focusAccessible, focusDeferredToModal: !canFocus, clientHeight: region.clientHeight, scrollHeight: region.scrollHeight, clientWidth: region.clientWidth, scrollWidth: region.scrollWidth };
    });
    if (origin instanceof HTMLElement) origin.focus({ preventScroll: true });
    return {
      height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, viewport: [innerWidth, innerHeight],
      contentLoss, controlsOutside,
      smallControls: [...document.querySelectorAll('main button, main select, main label, main summary, main a[href]')].filter(rendered).filter(element => parseFloat(getComputedStyle(element).fontSize) < 14).map(label),
      scrollingRegions,
    };
  });
}
async function checkFit(page, label) {
  const result = await inspectLayout(page);
  receipts.push({ label, ...result });
  assert.ok(result.height <= result.viewport[1] + 1, label + ': document scrolls vertically ' + JSON.stringify(result));
  assert.ok(result.width <= result.viewport[0] + 1, label + ': document scrolls horizontally');
  assert.deepEqual(result.contentLoss, [], label + ': essential content lost to non-scrollable clipping');
  assert.deepEqual(result.controlsOutside, [], label + ': visible controls outside viewport');
  assert.deepEqual(result.smallControls, [], label + ': essential controls below 14px');
  assert.ok(result.scrollingRegions.every(region => region.bounded && region.focusAccessible), label + ': panes must reveal the full focused control on both axes ' + JSON.stringify(result.scrollingRegions));
}
async function checkLayoutRegressions() {
  const context = await browser.newContext({ viewport: sizes[0] }), page = await context.newPage();
  const shell = content => '<style>html,body{margin:0;font:14px sans-serif}button{font:inherit;height:44px}main{height:600px}.pane{width:160px;height:80px}.row{display:block;width:140px;margin-top:120px}</style><main>' + content + '</main>';
  try {
    await page.setContent(shell('<div class="pane" style="overflow:hidden"><button class="row">Wholly clipped</button></div>'));
    assert.ok((await inspectLayout(page)).contentLoss.some(item => item.label === 'Wholly clipped'), 'Regression: wholly clipped essential controls must fail');
    await page.setContent(shell('<div class="pane" style="overflow-x:hidden"><button style="width:500px">Too wide hidden</button></div>'));
    assert.ok((await inspectLayout(page)).contentLoss.some(item => item.label === 'Too wide hidden'), 'Regression: intersecting a wide button with a hidden pane must fail');
    await page.setContent(shell('<div class="pane" data-layout-scroll style="overflow:auto"><button style="width:500px">Too wide focused</button></div>'));
    assert.equal((await inspectLayout(page)).scrollingRegions[0].focusAccessible, false, 'Regression: focus visibility checks both axes');
    await page.setContent(shell('<div class="pane" data-layout-scroll style="overflow:auto"><button class="row">Scrollable row</button></div>'));
    const reachable = await inspectLayout(page);
    assert.deepEqual(reachable.contentLoss, []);
    assert.deepEqual(reachable.controlsOutside, []);
    assert.equal(reachable.scrollingRegions[0].focusAccessible, true, 'A genuine scrolling list reveals its focused row');
    receipts.push({ label: 'in-memory-layout-regressions', passed: true, cases: 4 });
  } finally { await context.close(); }
}
async function checkMap(page) {
  const result = await page.evaluate(() => {
    const map = document.querySelector('.geographic-scene, .map-scene');
    if (!map) throw new Error('Expected map scene is missing');
    const scene = map.getBoundingClientRect(), legend = map.closest('.town-map').querySelector('.map-legend').getBoundingClientRect();
    return [...map.querySelectorAll('.map-house-label')].filter(element => {
      const r = element.getBoundingClientRect();
      return r.bottom > Math.min(legend.top, scene.bottom) || r.top < scene.top || r.left < scene.left || r.right > scene.right || parseFloat(getComputedStyle(element).fontSize) < 12;
    }).map(element => element.textContent);
  });
  assert.deepEqual(result, [], 'Household labels must remain readable and clear of the legend');
}
async function waitForMap(page) {
  await page.locator('.geographic-tile-status').filter({ hasText: 'Street map loaded.' }).waitFor();
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')];
    return tiles.length > 0 && tiles.every(tile => tile.complete && tile.naturalWidth > 0);
  });
}
const pause = async page => { const button = page.getByRole('button', { name: 'Pause simulation', exact: true }); if (await button.count()) await button.click(); };
const minute = async page => {
  const clock = /^(\d+):(\d+)/.exec(await page.locator('.clock-display').innerText());
  assert.ok(clock, 'Simulation clock exposes elapsed time');
  return Number(clock[1]) * 60 + Number(clock[2]);
};
async function advanceTo(page, target) {
  await pause(page);
  assert.ok(await minute(page) <= target, 'Playback exceeded the scripted observation minute');
  while (await minute(page) < target) await page.getByRole('button', { name: 'Advance one minute', exact: true }).click();
}
const select = (page, id) => page.getByRole('button', { name: 'Select ' + id + ' generated representative', exact: true }).click();
const closePanel = async page => { if (await page.getByRole('dialog').count()) { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); } };
async function openExercise(page, action) {
  await closePanel(page);
  await page.getByRole('button', { name: 'Exercise', exact: true }).click();
  await page.getByRole('button', { name: action, exact: true }).click();
}
async function exportRun(page, path) {
  const downloading = page.waitForEvent('download');
  if (await page.locator('.simulation-screen').count()) await openExercise(page, 'Export run');
  else await page.getByRole('button', { name: 'Export run', exact: true }).click();
  await (await downloading).saveAs(path);
  return JSON.parse(await readFile(path, 'utf8'));
}
async function checkPanel(page, name, label) {
  const trigger = page.getByRole('button', { name, exact: true });
  await page.getByLabel('Playback speed', { exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pause simulation', exact: true }).count(), 1, 'Panel probe starts with playback running');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Resume simulation', exact: true }).count(), 1, 'Opening a panel pauses playback');
  const stoppedAt = await minute(page);
  await page.waitForTimeout(650); // Longer than the selected 4x playback tick (500ms).
  assert.equal(await minute(page), stoppedAt, 'Opening a panel keeps playback paused across a tick');
  const box = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, name + ': panel stays inside viewport');
  assert.equal(await dialog.getByRole('button', { name: 'Close ' + name, exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  // Native modal dialogs may cycle through browser chrome. Background page
  // controls must remain inert whenever the document itself owns keyboard focus.
  assert.equal(await dialog.evaluate(element => !document.hasFocus() || element.contains(document.activeElement)), true, name + ': focus does not enter the background page');
  await page.keyboard.press('Tab');
  await checkFit(page, label);
  await closePanel(page);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true, name + ': Escape restores trigger focus');
}
async function checkConfirmation(page, label) {
  const result = await page.getByRole('dialog', { name: 'Finish exercise', exact: true }).evaluate(element => {
    const r = element.getBoundingClientRect();
    return { width: r.width, height: r.height, variant: element.getAttribute('data-variant'), viewport: [innerWidth, innerHeight] };
  });
  assert.equal(result.variant, 'confirmation');
  assert.ok(result.width <= Math.min(560, result.viewport[0] - 24), 'Confirmation stays compact');
  assert.ok(result.height < result.viewport[1] * .6, 'Confirmation stays below 60% of viewport');
  receipts.push({ label, ...result });
}
function checkAutomaticSummary(file) {
  assert.equal(file.savedMinute, 60);
  assert.equal(file.config.template, 'storm-dallas-v1');
  assert.equal(file.expectedSummary.assistanceCompleted, 6);
  assert.equal(file.expectedSummary.totalNeeds, 6);
  assert.equal(file.expectedSummary.peopleAssisted, 15);
  assert.equal(file.expectedSummary.timelyUrgentCount, 2);
  assert.equal(file.expectedSummary.urgentNeeds, 3);
  assert.equal(file.expectedSummary.households.find(home => home.householdId === 'H19').completedAt, 36);
  assert.ok(file.commands.length > 3 && file.commands.every(row => row.result.accepted && row.command.commandId.startsWith('AUTO-')), 'Only accepted automatic commands were recorded');
}

try {
  await checkLayoutRegressions();
  for (const size of sizes) {
    const label = size.width + 'x' + size.height;
    const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      // Fixture responses only: no automated request reaches the live tile host.
      if (url.origin === 'https://tile.openstreetmap.org' && /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname) && route.request().method() === 'GET') {
        tileRequests.push(url.href);
        return route.fulfill({ contentType: 'image/svg+xml', body: tileFixture });
      }
      if (url.origin === new URL(origin).origin && route.request().method() === 'GET') return route.continue();
      external.push({ url: route.request().url(), method: route.request().method() }); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('?scenario=v1',origin).href, { waitUntil: 'networkidle' });
      await waitForMap(page);
      await page.getByRole('heading', { name: 'Observe a Dallas storm response.', exact: true }).waitFor();
      await checkFit(page, label + '-welcome'); await checkMap(page);
      await page.screenshot({ path: output + '/' + label + '-welcome.png' });
      await page.getByRole('button', { name: 'Customize conditions', exact: true }).click();
      for (const stage of ['Conditions', 'Resources', 'Review']) {
        await page.getByRole('heading', { name: stage, exact: true }).waitFor();
        await checkFit(page, label + '-' + stage.toLowerCase()); await checkMap(page);
        if (stage !== 'Review') await page.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Start simulation', exact: true }).click(); await pause(page);
      await waitForMap(page);
      assert.equal(await minute(page), 0);
      await page.getByRole('heading', { name: 'Observe simulation', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Response unit', { exact: true }).count(), 0, 'Observer flow has no manual assignment controls');
      assert.match(await page.locator('.observation-counts').innerText(), /Active\s+3\s+Completed\s+0/, 'Automatic assignment does not count as help');
      assert.equal(await page.getByRole('button', { name: /^Select H\d+ generated representative$/ }).count(), 3);
      for (const id of ['H02', 'H09', 'H19']) {
        await select(page, id);
        await page.getByRole('region', { name: id + ' source and response flow', exact: true }).waitFor();
      }
      assert.match(await page.getByRole('region', { name: 'Known facts', exact: true }).innerText(), /Waiting for a report or home check/);
      await checkFit(page, label + '-automatic-start'); await checkMap(page);
      await page.screenshot({ path: output + '/' + label + '-automatic-start.png' });
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await waitForMap(page);
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await waitForMap(page);
      await page.getByRole('button', { name: 'Fit simulation area', exact: true }).click(); await waitForMap(page);
      await checkFit(page, label + '-map-controls'); await checkMap(page);

      // Exercise real timed playback before exact observer-step boundaries.
      await page.getByLabel('Playback speed', { exact: true }).selectOption('4');
      await page.getByRole('button', { name: 'Resume simulation', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.clock-display')?.textContent?.startsWith('00:00'), null, { timeout: 5000 });
      await pause(page);
      assert.ok(await minute(page) >= 1 && await minute(page) < 5);
      await advanceTo(page, 5); await select(page, 'H19');
      await page.getByRole('heading', { name: /Cannot call.*network gap/ }).waitFor();
      await checkFit(page, label + '-blocked-request');

      for (const panel of ['Homes', 'Teams', 'Activity', 'Details', 'Exercise']) await checkPanel(page, panel, label + '-panel-' + panel.toLowerCase());
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      const details = page.getByRole('dialog', { name: 'Details', exact: true });
      assert.match(await details.innerText(), /Assignments, resource reservations, road travel and completion use deterministic rules\. Playback makes no model calls\./);
      await details.getByText('Behavior provenance', { exact: false }).click();
      assert.match(await details.innerText(), /gpt-6\.1-terra/);
      assert.match(await details.innerText(), /low.*responses API/);
      assert.match(await details.innerText(), /3 verified model-generated profiles; 3 accepted autonomous requests/);
      await checkFit(page, label + '-provenance');
      await page.screenshot({ path: output + '/' + label + '-details.png' });
      await closePanel(page);

      await advanceTo(page, 35); await select(page, 'H19');
      const status = page.getByRole('region', { name: 'Observed status', exact: true });
      assert.equal(await status.getByRole('heading', { name: 'Assistance completed', exact: true }).count(), 0, 'Boarding and travel do not count as help');
      assert.match(await status.innerText(), /Traveling to shelter/);
      await page.getByRole('heading', { name: 'Assistance pending', exact: true }).waitFor();
      await checkFit(page, label + '-transporting'); await checkMap(page);
      await page.screenshot({ path: output + '/' + label + '-transporting.png' });
      const savedPath = output + '/' + label + '-minute35.json';
      const partial = await exportRun(page, savedPath);
      assert.equal(partial.savedMinute, 35);
      assert.equal(partial.expectedSummary.households.find(home => home.householdId === 'H19').completedAt, null);
      await openExercise(page, 'Import run');
      await page.getByLabel('Choose saved run file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
      await page.locator('.global-error[role="alert"]').waitFor();
      assert.equal(await minute(page), 35); await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
      const afterInvalid = await exportRun(page, output + '/' + label + '-after-invalid-import.json');
      assert.deepEqual(afterInvalid, partial, 'Invalid import preserves the full exported run, including knowledge, commands, resources and summary');
      await openExercise(page, 'Import run'); await page.getByLabel('Choose saved run file').setInputFiles(savedPath);
      await page.getByText('Run restored at 35 min. Paused.', { exact: true }).waitFor();
      await waitForMap(page);
      await advanceTo(page, 36); await select(page, 'H19');
      await status.getByRole('heading', { name: 'Assistance completed', exact: true }).waitFor();
      assert.match(await status.innerText(), /Completed 00:36/);
      await page.getByRole('heading', { name: /Assistance complete.*m36/ }).waitFor();
      await checkFit(page, label + '-completed');
      await page.screenshot({ path: output + '/' + label + '-completed.png' });
      await openExercise(page, 'View outcomes'); await checkConfirmation(page, label + '-confirmation');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Exercise', exact: true }).evaluate(element => element === document.activeElement), true, 'Cancelling outcomes restores Exercise focus');
      await openExercise(page, 'View outcomes'); await page.getByRole('button', { name: 'Finish now', exact: true }).click();
      await page.getByRole('heading', { name: 'Results & analysis', exact: true }).waitFor();
      await page.getByText('6 of 6 needs resolved', { exact: true }).waitFor();
      await waitForMap(page);
      assert.equal(await page.locator('.outcome-summary > div').filter({ has: page.getByText('People helped', { exact: true }) }).locator('dd').innerText(), '15');
      assert.equal(await page.locator('.outcome-summary > div').filter({ has: page.getByText('Urgent help on time', { exact: true }) }).locator('dd').innerText(), '2 / 3');
      for (const tab of ['Overview', 'Compare', 'Homes', 'Details']) {
        await page.getByRole('tab', { name: tab, exact: true }).click(); await checkFit(page, label + '-results-' + tab.toLowerCase());
        if (tab === 'Overview') {
          await page.getByText('Everyone who needed help received it.', { exact: true }).waitFor();
          await page.screenshot({ path: output + '/' + label + '-automatic-results.png' });
        }
      }
      const auto = await exportRun(page, output + '/' + label + '-automatic-minute60.json');
      checkAutomaticSummary(auto);
      outcomes.push({ viewport: label, automatic: { resolved: 6, peopleHelped: 15, timelyUrgent: 2, urgentNeeds: 3, h19CompletedAt: 36, commands: auto.commands.length } });
      await page.getByRole('tab', { name: 'Details', exact: true }).focus(); await page.keyboard.press('Home');
      assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).evaluate(element => element === document.activeElement && element.getAttribute('aria-selected') === 'true'), true, 'Results keyboard navigation restores Overview');

      await page.getByRole('button', { name: 'Restart same conditions', exact: true }).click(); await pause(page);
      assert.equal(await minute(page), 0);
      // Authored manual witness is imported AFTER saving the actual automatic
      // output. Its 3/3 timely result is a separate feasibility demonstration.
      await openExercise(page, 'Import run'); await page.getByLabel('Choose saved run file').setInputFiles('public/data/default-dallas-run.json');
      await page.getByRole('heading', { name: 'Results & analysis', exact: true }).waitFor();
      await page.getByText('6 of 6 needs resolved', { exact: true }).waitFor();
      await waitForMap(page);
      assert.equal(await page.locator('.outcome-summary > div').filter({ has: page.getByText('Urgent help on time', { exact: true }) }).locator('dd').innerText(), '3 / 3');
      await checkFit(page, label + '-authored-witness-results');
      const witness = await exportRun(page, output + '/' + label + '-authored-witness-minute60.json');
      const h19 = witness.expectedSummary.households.find(home => home.householdId === 'H19');
      assert.equal(h19.assessedAt, 6); assert.equal(h19.completedAt, 21);
      assert.equal(witness.expectedSummary.peopleAssisted, 15);
      assert.equal(witness.expectedSummary.timelyUrgentCount, 3);
      await page.getByRole('tab', { name: 'Homes', exact: true }).click();
      await page.getByLabel('Inspect household timeline', { exact: true }).selectOption('H19');
      for (const [message, time] of [['Radio assessment: H19', '00:06'], ['H19 boarded', '00:12'], ['H19 assistance completed', '00:21']]) {
        assert.equal(await page.locator('.timeline-events li').filter({ hasText: message }).locator('time').innerText(), time, 'Authored witness timeline: ' + message);
      }
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'No runtime exceptions'); assert.deepEqual(external, [], 'No external or non-GET requests');
  assert.ok(tileRequests.length > 0, 'Fixture-only tile interception was exercised');
  console.log(JSON.stringify({ passed: true, layoutStates: receipts.filter(row => !row.cases).length, layoutRegressions: 4, viewports: sizes, mobile: 'deferred', automatic: '6 resolved; 15 people; 2/3 urgent on time; H19 completion36', partialReplay: 35, authoredWitness: 'separate import; 6/12/21; 3/3 timely; feasibility only', runtimeErrors: errors, unexpectedRequests: external.length, tileRequestsIntercepted: tileRequests.length, liveTileRequests: 0, evidence: output, visualAcceptance: 'separate T3 Preview and user review required' }));
} finally {
  await writeFile(output + '/layout-receipts.json', JSON.stringify({ receipts, outcomes, runtimeErrors: errors, blockedRequests: external, tileRequestsIntercepted: tileRequests.length, liveTileRequests: 0 }, null, 2));
  await browser.close();
}
