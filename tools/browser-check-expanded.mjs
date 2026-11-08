import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Exercise the real expanded observer. Every OSM tile is replaced locally;
// simulation source data, automatic decisions and route overlays remain real app code.
const origin = new URL(process.env.APP_URL || 'http://127.0.0.1:43183');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(origin.hostname),'Use a local preview');
const url = new URL(origin); url.searchParams.set('scenario','v2');
const recording = process.env.RECORD_EXPANDED === '1';
const output = `.private/${recording?'demo-recording':'browser-evidence'}/expanded-dallas`;
await mkdir(output,{recursive:true});
const bundleText=await readFile('public/data/dallas-v2-scenario.json','utf8');
const bundle = JSON.parse(bundleText);
const bundleSha256=createHash('sha256').update(bundleText).digest('hex');
const tile = await readFile('tests/fixtures/map-tile.svg');
const sizes = recording?[{width:1440,height:900}]:[{width:1366,height:768},{width:1440,height:900},{width:1696,height:1020}];
const browser = await chromium.launch();
const errors=[],external=[],receipts=[];let interceptedTiles=0;
const ready = page => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function layout(page) {
  await ready(page);
  const result=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    const stages=[...document.querySelectorAll('.v2-story-group')];
    return {width:innerWidth,height:innerHeight,horizontal:document.documentElement.scrollWidth>innerWidth+1,
      pageScroll:document.documentElement.scrollHeight>innerHeight+1,map:rect('.geographic-scene'),
      source:rect('.v2-source-button'),stageCount:stages.length,
      stagesFit:stages.every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),
      rawJson:/contextHash|help_request_v2|sourceResponseHash/.test(document.body.innerText),
      footer:document.querySelectorAll('.v2-footer,.geographic-source,.geographic-tile-status').length,
      houses:document.querySelectorAll('.map-house-count').length,
      circles:document.querySelectorAll('.map-house-group-icon circle').length,
      headerPlayback:document.querySelectorAll('.app-header .v2-playback').length,
      mainPlayback:document.querySelectorAll('main .v2-playback').length,
      mapHeadings:document.querySelectorAll('.v2-map-heading').length,
      essentialMinimum:Math.min(...[...document.querySelectorAll('.v2-story-group strong,.v2-story-group p,.v2-header-controls button,.v2-resource-strip')].filter(el=>el.getBoundingClientRect().height>1).map(el=>parseFloat(getComputedStyle(el).fontSize)))};
  });
  assert.equal(result.horizontal,false,'No horizontal clipping');
  assert.equal(result.pageScroll,false,'Dashboard fits desktop height');
  assert.equal(result.stageCount,3);assert.equal(result.stagesFit,true,'All household details visible');
  assert.equal(result.headerPlayback,1);assert.equal(result.mainPlayback,0,'Playback shares the top header');
  assert.equal(result.mapHeadings,0,'Map title shares its controls row');
  assert.ok(result.source.bottom<=result.height,'Source control visible');
  assert.ok(result.essentialMinimum>=14,'Essential labels remain readable');
  assert.equal(result.rawJson,false,'No structured action text in primary view');
  assert.equal(result.circles,0,'House counts do not use circles');assert.ok(result.houses>0);
  assert.equal(result.footer,0,'Explanation strips do not consume map space');
  return result;
}
try {
  for(const [index,size] of sizes.entries()) {
    const context=await browser.newContext({viewport:size,reducedMotion:'reduce',...(recording?{recordVideo:{dir:output,size}}:{})});
    await context.route('**/*',route=>{
      const requestUrl=new URL(route.request().url());
      if(requestUrl.origin==='https://tile.openstreetmap.org'&&route.request().method()==='GET') {interceptedTiles++;return route.fulfill({contentType:'image/svg+xml',body:tile});}
      if(requestUrl.origin===origin.origin&&requestUrl.pathname==='/data/dallas-v2-scenario.json')return route.fulfill({contentType:'application/json',body:bundleText});
      if(requestUrl.origin===origin.origin&&route.request().method()==='GET')return route.continue();
      external.push({url:requestUrl.href,method:route.request().method()});return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url.href);await page.getByRole('button',{name:'Start simulation',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.map-house-count').length>0);
    assert.doesNotMatch(await page.locator('main').innerText(),/AI-created resident|A home.s story|AI plan used/);
    assert.ok((await page.locator('.v2-header-population').innerText()).includes(bundle.assets.population.persons.length.toLocaleString()));
    const fit=await layout(page);
    await page.screenshot({path:`${output}/${size.width}-observer.png`});
    const source=page.getByRole('button',{name:/^Inspect .+ source$/});
    await source.focus();await source.press('Enter');
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.ok(!(await dialog.innerText()).includes('contextHash'),'Closed evidence does not expose action JSON');
    assert.equal(await dialog.locator('details.v2-technical-evidence').getAttribute('open'),null);
    await dialog.locator('details.v2-technical-evidence summary').click();
    assert.doesNotMatch(await dialog.innerText(),/help_request_v2|contextHash/,'Action JSON is never displayed');
    await dialog.getByRole('button',{name:/^Close /}).click();
    assert.equal(await source.evaluate(el=>el===document.activeElement),true,'Focus restored after inspection');
    assert.equal(await page.getByRole('button',{name:'Run',exact:true}).count(),1,'Closing inspection stays paused');
    await page.getByRole('button',{name:'Run options',exact:true}).click();
    await page.getByRole('button',{name:'Restart with the same conditions'}).click();
    const confirmation=page.getByRole('dialog',{name:'Restart simulation?'});
    const confirmationSize=await confirmation.boundingBox();
    assert.ok(confirmationSize.height<300,'Confirmation fits its content');
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Close Run options',exact:true}).click();
    if(index===0&&process.env.SKIP_RESULTS!=='1') {
      await page.getByLabel('Playback speed',{exact:true}).selectOption('60');
      await page.getByRole('button',{name:'Run',exact:true}).click();
      await page.waitForFunction(()=>Number(document.querySelector('.v2-clock time').textContent.slice(0,2))*60+Number(document.querySelector('.v2-clock time').textContent.slice(3,5))>=5,{},{timeout:30000});
      await page.getByRole('button',{name:'Pause',exact:true}).click();
      await page.getByRole('button',{name:'Run options',exact:true}).click();
      await page.getByRole('button',{name:'Skip to the end',exact:true}).click();
      await page.getByRole('dialog',{name:'Skip to the end?'}).getByRole('button',{name:'Skip to the end',exact:true}).click();
      await page.getByRole('heading',{name:'Results & analysis',exact:true}).waitFor({timeout:240000});
      await page.screenshot({path:`${output}/${size.width}-overview.png`});
      for(const tab of ['Compare','Homes','Details']) {
        await page.getByRole('tab',{name:tab,exact:true}).click();
        assert.equal(await page.getByRole('tabpanel').evaluate(el=>/contextHash|help_request_v2|no-prepared-artifact/.test(el.innerText)),false,'Result view uses plain descriptions');
        await page.screenshot({path:`${output}/${size.width}-${tab.toLowerCase()}.png`});
      }
    }
    receipts.push({size,fit,confirmationHeight:confirmationSize.height,video:recording?await page.video()?.path():null});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const receipt={population:bundle.assets.population.households.length,residents:bundle.assets.population.persons.length,preparedProfiles:bundle.assets.behavior?.personas.length??0,bundleSha256,behaviorHash:bundle.hashes.behavior,interceptedTiles,liveTiles:0,errors,external,receipts,resultsChecked:process.env.SKIP_RESULTS!=='1'};
  await writeFile(`${output}/receipt.json`,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
} finally {await browser.close();}
