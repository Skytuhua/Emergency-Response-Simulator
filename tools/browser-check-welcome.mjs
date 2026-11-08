import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin=new URL(process.env.APP_URL||'http://127.0.0.1:43184').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use a local server');
const tile=await readFile('tests/fixtures/map-tile.svg');
const output='.private/browser-evidence/welcome';
await mkdir(output,{recursive:true});
const browser=await chromium.launch(),receipts=[];
const sizes=[{width:2000,height:1072},{width:1696,height:1020},{width:1440,height:900},{width:1366,height:768}];
const errors=[],external=[];let tiles=0;
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function boundary(page) {
  return page.locator('.simulation-boundary').evaluateAll(paths=>{
    const scene=document.querySelector('.geographic-scene').getBoundingClientRect();
    return paths.map(path=>{
      const box=path.getBBox(),m=path.getScreenCTM();
      const corners=[[box.x,box.y],[box.x+box.width,box.y+box.height]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
      return {left:corners[0].x-scene.left,top:corners[0].y-scene.top,right:scene.right-corners[1].x,bottom:scene.bottom-corners[1].y};
    });
  });
}
try {
  for (const size of sizes) {
    const context=await browser.newContext({viewport:size,reducedMotion:'reduce'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin==='https://tile.openstreetmap.org'){tiles++;return route.fulfill({contentType:'image/svg+xml',body:tile});}
      if(url.origin===origin&&route.request().method()==='GET')return route.continue();
      external.push(url.href);return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.getByRole('button',{name:'Start simulation',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.simulation-boundary').length>0);await settle(page);
    const measurements=await page.evaluate(()=>{
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
      return {width:innerWidth,height:innerHeight,pageHeight:document.documentElement.scrollHeight,horizontal:document.documentElement.scrollWidth>innerWidth+1,header:rect('.app-header'),welcome:rect('.setup-v2-welcome'),copy:rect('.setup-v2-welcome-copy'),map:rect('.setup-v2-welcome-map'),scene:rect('.geographic-scene'),buttons:[...document.querySelectorAll('.setup-v2-welcome-actions button')].map(el=>({font:parseFloat(getComputedStyle(el).fontSize),bottom:el.getBoundingClientRect().bottom}))};
    });
    assert.equal(measurements.horizontal,false,'No horizontal clipping');
    assert.ok(measurements.pageHeight<=size.height+1,'No page scroll at standard desktop size');
    assert.ok(measurements.map.bottom<=size.height+1,'Map fits viewport');
    assert.ok(measurements.buttons.every(button=>button.font>=14&&button.bottom<=size.height),'Welcome actions are readable and visible');
    assert.ok(Math.abs((measurements.copy.top+measurements.copy.bottom)/2-(measurements.map.top+measurements.map.bottom)/2)<4,'Copy is centered next to the map');
    assert.ok(measurements.scene.height>=size.height*.5,'Map uses available height');
    assert.ok(measurements.map.bottom>=size.height-80,'Map does not leave excessive empty space below');
    const boundaryGaps=await boundary(page);assert.ok(boundaryGaps.length>=2,'Both tract boundaries rendered');
    assert.ok(boundaryGaps.every(gap=>Math.min(...Object.values(gap))>=-3),'Both tract boundaries fit in map');
    const attribution=page.getByRole('link',{name:'© OpenStreetMap contributors'});
    assert.equal(await attribution.count(),1);await attribution.focus();assert.equal(await attribution.evaluate(el=>el===document.activeElement),true,'Attribution is keyboard focusable');
    assert.equal(await attribution.getAttribute('href'),'https://www.openstreetmap.org/copyright');
    assert.equal(await page.getByRole('button',{name:'Fit simulation area'}).count(),0,'Decorative map does not show disabled controls');
    await page.screenshot({path:`${output}/${size.width}x${size.height}.png`});
    const customize=page.getByRole('button',{name:'Customize setup',exact:true});await customize.focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Fit simulation area'}).waitFor();await page.getByRole('button',{name:'Edit road blocks'}).waitFor();
    await settle(page);const customizedBoundary=await boundary(page);assert.ok(customizedBoundary.every(gap=>Math.min(...Object.values(gap))>=-3),'Boundary fits after opening setup');
    await page.getByRole('button',{name:'Back',exact:true}).focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Customize setup',exact:true}).waitFor();await settle(page);
    assert.equal(await page.getByRole('link',{name:'© OpenStreetMap contributors'}).count(),1);
    receipts.push({size,measurements,boundaryGaps,customizedBoundary});await context.close();
  }
  // Enlarged text is allowed to scroll, but controls and attribution remain reachable.
  const context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin==='https://tile.openstreetmap.org'){tiles++;return route.fulfill({contentType:'image/svg+xml',body:tile});}if(url.origin===origin&&route.request().method()==='GET')return route.continue();external.push(url.href);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  await page.getByRole('button',{name:'Start simulation',exact:true}).waitFor();await page.addStyleTag({content:'html { zoom: 1.5; }'});await settle(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Enlarged text does not clip horizontally');
  for(const name of ['Start simulation','Customize setup','Open saved run']) {const button=page.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();await button.focus();assert.equal(await button.evaluate(el=>el===document.activeElement),true,`${name} remains reachable`);}
  const credit=page.getByRole('link',{name:'© OpenStreetMap contributors'});await credit.scrollIntoViewIfNeeded();await credit.focus();assert.equal(await credit.evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:`${output}/1366x768-enlarged.png`,fullPage:true});await context.close();
  // A failed basemap has an accessible retry on the welcome screen.
  const failedContext=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  let failTiles=true,failedTiles=0,recoveredTiles=0;
  await failedContext.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin==='https://tile.openstreetmap.org'){
      if(failTiles){failedTiles++;return route.abort('failed');}
      recoveredTiles++;return route.fulfill({contentType:'image/svg+xml',body:tile});
    }
    if(url.origin===origin&&route.request().method()==='GET')return route.continue();
    external.push(url.href);return route.abort();
  });
  const failedPage=await failedContext.newPage();failedPage.on('pageerror',e=>errors.push(e.message));await failedPage.goto(origin);
  const retry=failedPage.getByRole('button',{name:'Reload map',exact:true});await retry.waitFor({timeout:20000});
  assert.ok(await failedPage.getByRole('status').filter({hasText:'Map incomplete or unavailable'}).isVisible());
  assert.ok(failedTiles>0,'A tile request actually failed');
  await retry.focus();assert.equal(await retry.evaluate(el=>el===document.activeElement),true,'Retry is keyboard accessible');
  failTiles=false;await failedPage.keyboard.press('Enter');
  await retry.waitFor({state:'hidden',timeout:20000});
  await failedPage.waitForFunction(()=>document.querySelectorAll('img.leaflet-tile-loaded').length>0);
  assert.ok(recoveredTiles>0,'Retry made new successful tile requests');
  const recoveryCredit=failedPage.getByRole('link',{name:/OpenStreetMap contributors/});
  assert.equal(await recoveryCredit.count(),1);
  assert.equal(await recoveryCredit.evaluate(el=>el===document.activeElement),true,'Focus moves to attribution while the map reloads');
  await failedContext.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(tiles>0);
  await writeFile(`${output}/receipt.json`,JSON.stringify({receipts,tiles,liveTiles:0,errors,external,enlargedText:'150%',tileRecovery:true},null,2));
  console.log(JSON.stringify({passed:true,sizes,tiles,liveTiles:0,enlargedText:'150%',tileRecovery:true}));
} finally { await browser.close(); }
