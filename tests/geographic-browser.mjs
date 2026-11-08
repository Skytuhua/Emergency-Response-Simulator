import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin = process.env.APP_URL || 'http://127.0.0.1:4186';
const output = '.private/map-browser';
await mkdir(output, { recursive: true });
const tileFixture = await readFile(new URL('./fixtures/map-tile.svg', import.meta.url));
const browser = await chromium.launch();
const errors = [], receipts = [], sizes = [{ width: 1696, height: 1020 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }];
let tileRequests = 0, denyTiles = false, holdTiles = false, heldTiles = [], unexpectedExternal = [];
async function contextFor(size) {
  const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
  // No live tile requests escape this route, including failure/recovery tests.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'tile.openstreetmap.org') {
      tileRequests++;
      if (!/^\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) { unexpectedExternal.push(`Invalid XYZ tile: ${url.href}`); return route.abort(); }
      if (holdTiles && tileRequests % 2 === 0) { heldTiles.push(route); return; }
      return denyTiles ? route.abort('internetdisconnected') : route.fulfill({ contentType: 'image/svg+xml', body: tileFixture });
    }
    if (url.origin === origin) return route.continue();
    unexpectedExternal.push(url.href); return route.abort();
  });
  return context;
}
const waitForMap = async page => {
  await page.locator('.geographic-tile-status').filter({ hasText: 'Street map loaded.' }).waitFor();
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')];
    return tiles.length > 0 && tiles.every(tile => tile.complete && tile.naturalWidth > 0);
  });
};
const paneState = page => page.locator('.leaflet-simulationMarkers-pane').evaluate(element => ({
  pane: element.parentElement.style.transform,
  homes: [...element.querySelectorAll('.map-house')].map(home => [home.title, home.style.left, home.style.top]),
}));
async function aligned(page) {
  // Native Leaflet events request a React marker render; inspect the painted
  // frame after that commit, rather than racing the event callback's setState.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => {
    const view = window.mapFixtureView;
    const tile = document.querySelector('img.leaflet-tile-loaded');
    const [z, tx, ty] = new URL(tile.src).pathname.match(/\d+/g).map(Number);
    const rect = tile.getBoundingClientRect(), scale = 256 * 2 ** z, tileScale = rect.width / 256;
    const projected = (lat, lon) => ({
      x: rect.left + ((lon + 180) / 360 * scale - tx * 256) * tileScale,
      y: rect.top + ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale - ty * 256) * tileScale,
    });
    const expected = point => {
      const p = view.map.metadata.projection;
      const lat = p.originLat - (point.y - view.map.height / 2) * p.metersPerUnit / p.earthRadiusMeters * 180 / Math.PI;
      const lon = p.originLon + (point.x - view.map.width / 2) * p.metersPerUnit / (p.earthRadiusMeters * Math.cos(p.originLat * Math.PI / 180)) * 180 / Math.PI;
      return projected(lat, lon);
    };
    const errors = [];
    const check = (element, point, label) => {
      const r = element.getBoundingClientRect(), want = expected(point);
      errors.push({ label, error: Math.hypot(r.left + r.width / 2 - want.x, r.top + r.height / 2 - want.y), actual: [r.left + r.width / 2, r.top + r.height / 2], expected: want });
    };
    for (const home of view.households) check(document.querySelector(`#map-home-${home.id}`), home, home.id);
    for (const shelter of view.shelters) check(document.querySelector(`[data-shelter-id="${shelter.id}"]`), shelter, shelter.id);
    for (const unit of view.units.filter(unit => !unit.missionId)) check(document.querySelector(`[data-unit-id="${unit.id}"]`), unit, unit.id);
    check(document.querySelector('.map-facility.base'), view.map.nodes.find(n => n.id === view.map.metadata.baseNodeId), 'base');
    // Inspect actual SVG boundary geometry, independently projected from metadata.
    const boundary = document.querySelector('path.simulation-boundary').getBoundingClientRect();
    const b = view.map.metadata.bounds, nw = projected(b.north, b.west), se = projected(b.south, b.east);
    // Leaflet clips SVG paths to its renderer at deep zoom. Compare each full
    // boundary edge only while it lies inside that renderer's visible extent.
    const renderer = document.querySelector('path.simulation-boundary').ownerSVGElement.getBoundingClientRect();
    if (nw.x >= renderer.left) errors.push({ label: 'boundary west', error: Math.abs(boundary.left - nw.x) });
    if (nw.y >= renderer.top) errors.push({ label: 'boundary north', error: Math.abs(boundary.top - nw.y) });
    if (se.x <= renderer.right) errors.push({ label: 'boundary east', error: Math.abs(boundary.right - se.x) });
    if (se.y <= renderer.bottom) errors.push({ label: 'boundary south', error: Math.abs(boundary.bottom - se.y) });
    return errors;
  });
  for (const item of result) {
    if (item.error > 2) {
      console.log(JSON.stringify({ item, transforms: await page.locator('.leaflet-pane, .leaflet-tile-container').evaluateAll(elements => elements.map(element => [element.className, element.style.transform])), tiles: await page.locator('img.leaflet-tile-loaded').evaluateAll(elements => elements.slice(0, 4).map(element => ({ src: element.src, rect: element.getBoundingClientRect().toJSON() }))) }));
      await page.screenshot({ path: `${output}/alignment-failure.png` });
    }
    assert.ok(item.error <= 2, `${item.label}: geographic alignment drift ${item.error}px`);
  }
}
async function visibleChrome(page, label) {
  const result = await page.evaluate(() => {
    const root = document.querySelector('.interactive-geographic-map'), scene = root.querySelector('.geographic-scene').getBoundingClientRect();
    const elements = [...root.querySelectorAll('.geographic-toolbar button, .map-source a, .simulation-boundary-label')];
    return {
      scene: { width: scene.width, height: scene.height },
      boundaryHeight: root.querySelector('path.simulation-boundary').getBoundingClientRect().height,
      clipped: elements.filter(element => { const r = element.getBoundingClientRect(); return r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.width === 0; }).map(el => el.textContent),
      tiny: elements.filter(element => parseFloat(getComputedStyle(element).fontSize) < 14).map(el => el.textContent),
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
    };
  });
  assert.ok(result.scene.width > 200 && result.scene.height > 140, `${label}: usable map size ${JSON.stringify(result)}`);
  assert.ok(result.boundaryHeight >= result.scene.height * .65, `${label}: fit wastes map height (${result.boundaryHeight}/${result.scene.height})`);
  assert.deepEqual(result.clipped, [], `${label}: map chrome clipped`);
  assert.deepEqual(result.tiny, [], `${label}: map controls shrunk`);
  assert.equal(result.overflow, false, `${label}: document overflows`);
  receipts.push({ label, ...result });
}
try {
  const context = await contextFor(sizes[0]), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/tests/fixtures/geographic-map.html`); await waitForMap(page); await aligned(page);
  await page.getByRole('button', { name: /^H19,/ }).click();
  assert.equal(await page.getByLabel('Selection', { exact: true }).textContent(), 'H19');
  await page.locator('.geographic-leaflet').focus(); await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('Global escape count').textContent(), '0');
  const beforePan = await paneState(page);
  const firstHome = await page.getByRole('button', { name: /^H01,/ }).boundingBox();
  await page.mouse.move(firstHome.x + firstHome.width / 2, firstHome.y + firstHome.height / 2);
  await page.mouse.down(); await page.mouse.move(firstHome.x + firstHome.width / 2 + 120, firstHome.y + firstHome.height / 2 + 70, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(350);
  assert.equal(await page.getByLabel('Selection', { exact: true }).textContent(), 'H19', 'Panning from a home must not select it on release');
  const box = await page.locator('.geographic-leaflet').boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .5 + 105, box.y + box.height * .5 + 65, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(350);
  assert.notDeepEqual(await paneState(page), beforePan, 'Dragging changes viewport');
  await aligned(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await waitForMap(page); await aligned(page);
  const beforeWheel = await paneState(page);
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .55);
  await page.mouse.wheel(0, -60); await page.waitForTimeout(300); await waitForMap(page); await aligned(page);
  assert.notDeepEqual(await paneState(page), beforeWheel, 'Wheel zoom changes viewport');
  const beforeDoubleClick = await paneState(page);
  await page.mouse.dblclick(box.x + 45, box.y + 45); await waitForMap(page); await aligned(page);
  assert.notDeepEqual(await paneState(page), beforeDoubleClick, 'Double-click zoom changes viewport');
  const viewport = await paneState(page);
  await page.getByRole('button', { name: 'Advance minute', exact: true }).click();
  await page.getByRole('button', { name: 'Clone map snapshot', exact: true }).click();
  assert.deepEqual(await paneState(page), viewport, 'Minute/state snapshots retain pan and zoom');
  const boundaryBefore = await page.locator('path.simulation-boundary').getAttribute('d');
  await page.getByRole('button', { name: 'Clear outage', exact: true }).click();
  assert.equal(await page.locator('path.communications-outage').count(), 0);
  assert.equal(await page.locator('path.simulation-boundary').getAttribute('d'), boundaryBefore, 'Boundary is independent of outage');
  await page.getByRole('button', { name: 'Resize layout' }).click(); await page.waitForTimeout(100); await aligned(page);
  await page.getByRole('button', { name: 'Fit simulation area' }).click(); await waitForMap(page); await aligned(page);
  await page.getByRole('button', { name: 'Dispatch H19' }).click();
  assert.equal(await page.locator('path.simulation-mission-route').count(), 1);
  await aligned(page);
  await page.getByRole('button', { name: 'Advance minute', exact: true }).click();
  const unitPosition = await page.locator('[data-unit-id="C1"]').evaluate(el => [el.style.left, el.style.top]);
  const basePosition = await page.locator('.map-facility.base').evaluate(el => [el.style.left, el.style.top]);
  assert.notDeepEqual(unitPosition, basePosition, 'Mission vehicle moves along route');
  const distanceFromRoute = await page.evaluate(() => {
    const path = document.querySelector('path.simulation-mission-route'), matrix = path.getScreenCTM();
    const unit = document.querySelector('[data-unit-id="C1"]').getBoundingClientRect();
    let nearest = Infinity;
    for (let length = 0; length <= path.getTotalLength(); length += 1) {
      const point = path.getPointAtLength(length).matrixTransform(matrix);
      nearest = Math.min(nearest, Math.hypot(point.x - unit.left - unit.width / 2, point.y - unit.top - unit.height / 2));
    }
    return nearest;
  });
  assert.ok(distanceFromRoute < 2, `Moving vehicle stays on geographic mission route (${distanceFromRoute}px)`);
  await page.getByRole('button', { name: 'New scenario' }).click(); await waitForMap(page); await aligned(page);
  await page.getByRole('button', { name: 'Toggle map' }).click();
  assert.equal(await page.locator('.leaflet-container').count(), 0);
  await page.getByRole('button', { name: 'Toggle map' }).click(); await waitForMap(page);
  assert.equal(await page.locator('.leaflet-container').count(), 1, 'StrictMode/remount does not leak map');
  await page.screenshot({ path: `${output}/fixture-interaction.png` });
  await context.close();
  // A fresh context prevents image-memory reuse from bypassing the error probe.
  denyTiles = true;
  const failureContext = await contextFor(sizes[0]), failurePage = await failureContext.newPage();
  failurePage.on('pageerror', error => errors.push(error.message));
  await failurePage.goto(`${origin}/tests/fixtures/geographic-map.html`);
  await failurePage.getByRole('button', { name: 'Retry map tiles' }).waitFor();
  assert.match(await failurePage.locator('.geographic-tile-status').innerText(), /retained exercise roads/);
  assert.ok(await failurePage.locator('.leaflet-retainedRoads-pane path').count() > 0);
  await failurePage.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await failurePage.screenshot({ path: `${output}/fixture-offline.png` });
  denyTiles = false;
  await failurePage.getByRole('button', { name: 'Retry map tiles' }).click(); await waitForMap(failurePage); await aligned(failurePage);
  // A partially loaded new viewport must time out, even after a previously healthy batch.
  holdTiles = true;
  // Two half steps guarantee a different integer XYZ level, avoiding reuse of
  // the already-loaded grid while still exercising fractional view zooms.
  await failurePage.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await failurePage.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await failurePage.getByRole('button', { name: 'Retry map tiles' }).waitFor({ timeout: 12000 });
  assert.ok(heldTiles.length > 0, 'The mixed batch includes genuinely pending image requests');
  holdTiles = false;
  await Promise.all(heldTiles.splice(0).map(route => route.fulfill({ contentType: 'image/svg+xml', body: tileFixture })));
  await waitForMap(failurePage); await aligned(failurePage);
  await failurePage.screenshot({ path: `${output}/fixture-recovery.png` });
  await failureContext.close();

  for (const size of sizes) {
    const context = await contextFor(size), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await waitForMap(page); await visibleChrome(page, `${size.width}-welcome`);
    await page.screenshot({ path: `${output}/${size.width}-welcome.png` });
    await page.getByRole('button', { name: 'Start simulation', exact: true }).click(); await waitForMap(page);
    await visibleChrome(page, `${size.width}-response`);
    await page.screenshot({ path: `${output}/${size.width}-response.png` });
    await context.close();
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.deepEqual(unexpectedExternal, [], 'No unexpected external network requests');
  assert.ok(tileRequests > 0, 'Browser exercised real tile loading');
  await writeFile(`${output}/receipt.json`, JSON.stringify({ tileRequestsIntercepted: tileRequests, liveTileRequests: 0, errors, receipts }, null, 2));
  console.log(`PASS: geographic map browser regressions; ${tileRequests} local tile responses/aborts, zero live tile requests. Evidence: ${output}`);
} finally { await browser.close(); }
