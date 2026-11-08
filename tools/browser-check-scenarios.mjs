import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Uses Vite's source modules to replay each exported run. OSM tiles are local fixtures.
const origin = new URL(process.env.APP_URL || 'http://127.0.0.1:43184');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(origin.hostname), 'Use a local development server');
const output = '.private/browser-evidence/scenario-choices';
await mkdir(output, {recursive:true});
const sourceText = await readFile('public/data/dallas-v2-scenario.json','utf8');
const source = JSON.parse(sourceText), tile = await readFile('tests/fixtures/map-tile.svg');
const browser = await chromium.launch();
const errors = [], external = [], records = []; let tileRequests = 0;
try {
  for (const name of ['Storm','Flood','Tornado']) {
    const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',acceptDownloads:true});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://tile.openstreetmap.org' && route.request().method() === 'GET') {tileRequests++; return route.fulfill({contentType:'image/svg+xml',body:tile});}
      if (url.origin === origin.origin && url.pathname === '/data/dallas-v2-scenario.json') return route.fulfill({contentType:'application/json',body:sourceText});
      if ((url.origin === origin.origin && route.request().method() === 'GET') || url.protocol === 'blob:') return route.continue();
      external.push({url:url.href,method:route.request().method()}); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin.href);
    await page.getByRole('radio',{name,exact:true}).check();
    await page.getByRole('button',{name:'Start simulation',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).click({timeout:30000});
    assert.match(await page.locator('.v2-header-population').innerText(),new RegExp(name));
    await page.getByRole('button',{name:'Advance one minute',exact:true}).click();
    await page.getByRole('button',{name:'Run options',exact:true}).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button',{name:'Save run',exact:true}).click();
    const downloaded = await downloadPromise, saved = await readFile(await downloaded.path(),'utf8'), file = JSON.parse(saved);
    assert.equal(file.bundle.setup.scenario,name.toLowerCase());
    if (name === 'Storm') assert.equal(file.bundle.setup.scenarioRecipe,undefined);
    else assert.equal(file.bundle.setup.scenarioRecipe,'dallas-hazards-v1');
    assert.deepEqual(file.bundle.hashes,source.hashes,'Admitted hashes are unchanged');
    assert.deepEqual(file.bundle.assets,source.assets,'Admitted source assets are unchanged');
    assert.ok(file.savedAtMs >= 60_000,'The simulation advanced');
    const evidence = await page.evaluate(async file => {
      const {replayV2,digestSessionV2} = await import('/src/v2/run-file.ts');
      const {effectiveScenarioV2} = await import('/src/v2/setup.ts');
      const {observeSnapshot} = await import('/src/v2/observe.ts');
      const replayed = await replayV2(file, 'scenario-browser-proof'), effective = effectiveScenarioV2(file.bundle), view = observeSnapshot(replayed.world);
      return {expected:digestSessionV2(replayed), tapeHash:effective.eventTapeHash, needEvents:effective.events.filter(e=>e.payload.type==='need-onset').length,
        initialClosed:replayed.world.closedEdgeIds.length, units:view.coordinator.units.length, preparedActions:view.preparedActions.length,
        observedPublicEvents:view.coordinator.events.length};
    },file);
    assert.deepEqual(evidence.expected,file.expected,'Saved state, trace and summary replay exactly');
    assert.ok(evidence.needEvents>0 && evidence.initialClosed>0 && evidence.units>0);
    if(name!=='Storm') assert.equal(evidence.preparedActions,0,'Different events do not reuse storm AI actions');
    await page.screenshot({path:`${output}/${name.toLowerCase()}.png`});
    records.push({name,scenario:file.bundle.setup.scenario,recipe:file.bundle.setup.scenarioRecipe??null,savedAtMs:file.savedAtMs,...evidence});
    await context.close();
  }
  // Keep an explicit road edit when switching events in the custom setup.
  const customContext=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',acceptDownloads:true});
  await customContext.route('**/*',route=>{const url=new URL(route.request().url());
    if(url.origin==='https://tile.openstreetmap.org'&&route.request().method()==='GET'){tileRequests++;return route.fulfill({contentType:'image/svg+xml',body:tile});}
    if(url.origin===origin.origin&&url.pathname==='/data/dallas-v2-scenario.json')return route.fulfill({contentType:'application/json',body:sourceText});
    if(url.origin===origin.origin&&route.request().method()==='GET')return route.continue();
    external.push({url:url.href,method:route.request().method()});return route.abort();});
  const custom=await customContext.newPage();custom.on('pageerror',error=>errors.push(error.message));
  await custom.goto(origin.href);await custom.getByRole('radio',{name:'Flood',exact:true}).check();
  await custom.getByRole('button',{name:'Customize setup',exact:true}).click();
  await custom.getByRole('button',{name:'Edit road blocks',exact:true}).click();
  await custom.getByRole('button',{name:'Find a street',exact:true}).click();
  const finder=custom.getByRole('dialog',{name:'Choose blocked streets'});
  const blocker=finder.locator('button[aria-label^="Block "]').first();
  const streetLabel=await blocker.getAttribute('aria-label');await blocker.click();
  await finder.getByRole('searchbox',{name:'Search streets'}).focus();await custom.keyboard.press('Escape');
  await finder.waitFor({state:'hidden'});
  await custom.getByRole('combobox',{name:/Simulated event/}).selectOption('tornado');
  assert.ok((await custom.locator('.setup-v2-location-tools dl').innerText()).includes('1'),'Road edit survives event switch');
  await custom.getByRole('button',{name:'Continue',exact:true}).click();await custom.getByRole('button',{name:'Continue',exact:true}).click();
  assert.match(await custom.getByRole('region',{name:'Review setup'}).innerText(),/Tornado/);
  await custom.getByRole('button',{name:'Start simulation',exact:true}).click();await custom.getByRole('button',{name:'Pause',exact:true}).click();
  await custom.getByRole('button',{name:'Run options',exact:true}).click();const saving=custom.waitForEvent('download');
  await custom.getByRole('button',{name:'Save run',exact:true}).click();const exported=JSON.parse(await readFile(await (await saving).path(),'utf8'));
  assert.equal(exported.bundle.setup.scenario,'tornado');assert.equal(exported.bundle.setup.roads.length,1);
  assert.equal(exported.bundle.setup.roads[0].closed,true);assert.deepEqual(exported.bundle.hashes,source.hashes);
  const customReplay=await custom.evaluate(async file=>{const {replayV2,digestSessionV2}=await import('/src/v2/run-file.ts');return digestSessionV2(await replayV2(file,'custom-scenario-proof'));},exported);
  assert.deepEqual(customReplay,exported.expected,'Customized event and roads replay exactly');
  await customContext.close();
  assert.equal(new Set(records.map(record=>record.tapeHash)).size,3,'The scenarios use distinct event tapes');
  assert.equal(new Set(records.map(record=>record.needEvents)).size,3,'The scenarios have distinct needs');
  assert.equal(new Set(records.map(record=>record.initialClosed)).size,3,'The scenarios have distinct initial closures');
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.ok(tileRequests>0);
  const receipt={bundleSha256:createHash('sha256').update(sourceText).digest('hex'),population:source.assets.population.households.length,
    residents:source.assets.population.persons.length,tileRequests,liveTiles:0,records,custom:{scenario:exported.bundle.setup.scenario,road:exported.bundle.setup.roads[0],streetLabel,replay:true},errors,external};
  await writeFile(`${output}/receipt.json`,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
} finally {await browser.close();}
