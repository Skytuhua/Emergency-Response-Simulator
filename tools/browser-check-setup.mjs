import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Run against the Vite development server: replay and route checks import source modules.
const origin=new URL(process.env.APP_URL || 'http://127.0.0.1:43184').origin,out='.private/browser-evidence/setup-map';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use a local development server');
const source=JSON.parse(await readFile('public/data/dallas-v2-scenario.json','utf8'));
const tile=await readFile('tests/fixtures/map-tile.svg'),browser=await chromium.launch();
const labels=new Map([...source.assets.map.edges].sort((a,b)=>a.id.localeCompare(b.id)).map((edge,index)=>[edge.id,`${edge.name||'Unnamed street'}, segment ${String(index+1).padStart(4,'0')}`]));
const requested=source.assets.population.households[0].position;
const sizes=process.env.MAP_WIDTH?[{width:Number(process.env.MAP_WIDTH),height:Number(process.env.MAP_HEIGHT)}]:[{width:1696,height:1020},{width:1366,height:768},{width:1440,height:900}];
await mkdir(out,{recursive:true});
const receipts=[];
try{
  for(const size of sizes){
    let intercepted=0;const errors=[],external=[];
    const context=await browser.newContext({viewport:size,reducedMotion:'reduce',acceptDownloads:true});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='tile.openstreetmap.org'){intercepted++;return route.fulfill({contentType:'image/svg+xml',body:tile});}
      if(url.origin===origin||url.protocol==='blob:')return route.continue();external.push(url.href);return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const ready=()=>page.waitForFunction(()=>document.querySelector('.setup-map-canvas')?.getAttribute('aria-busy')==='false');
    const project=point=>page.evaluate(({lat,lon})=>{
      const tile=document.querySelector('img.leaflet-tile-loaded'),rect=tile.getBoundingClientRect(),[z,x,y]=new URL(tile.src).pathname.match(/\d+/g).map(Number),scale=256*2**z,ratio=rect.width/256;
      return {x:rect.left+((lon+180)/360*scale-x*256)*ratio,y:rect.top+((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*scale-y*256)*ratio};
    },point);
    const coords=async label=>{const value=await page.getByLabel(label,{exact:true}).textContent(),[lat,lon]=value.split(',').map(Number);return {lat,lon};};
    await page.goto(origin);
    await page.getByRole('button',{name:'Customize setup',exact:true}).click({timeout:20000});
    await page.waitForFunction(()=>document.querySelectorAll('img.leaflet-tile-loaded').length>0);await ready();await settled();
    await page.locator('.leaflet-container').evaluate(el=>el.dataset.setupProof='kept');
    const initialBase=await page.locator('.map-facility.base').getAttribute('data-base-node-id');
    assert.equal(initialBase,source.assets.map.metadata.baseNodeId);
    const scene=await page.locator('.geographic-scene').boundingBox();
    await page.mouse.click(scene.x+12,scene.y+12);await ready();
    await page.locator('.setup-map-message').filter({hasText:'inside the simulation boundary'}).waitFor();
    assert.equal(await page.locator('.map-facility.base').getAttribute('data-base-node-id'),initialBase);
    const point=await project(requested);await page.mouse.click(point.x,point.y);await ready();
    await page.getByLabel('Requested base coordinates',{exact:true}).waitFor();await settled();
    const currentScene=await page.locator('.geographic-scene').boundingBox(),center={x:currentScene.x+currentScene.width/2,y:currentScene.y+currentScene.height/2},from=await project(requested);
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(center.x,center.y,{steps:8});await page.mouse.up();await settled();
    await page.locator('.geographic-leaflet').focus();await page.keyboard.press('Enter');await ready();await settled();
    const picked=await coords('Requested base coordinates'),actual=await coords('Actual base coordinates');
    const expected=await page.evaluate(async({point,source})=>{const {resolveBaseV2}=await import('/src/v2/setup-topology.ts');return resolveBaseV2(source,point,[]);},{point:picked,source});
    assert.equal(expected.ok,true);assert.equal(await page.locator('.map-facility.base').getAttribute('data-base-node-id'),expected.base.nodeId);
    assert.deepEqual(actual,{lat:expected.actual.lat,lon:expected.actual.lon});assert.notEqual(expected.base.nodeId,initialBase);
    const pin=await page.locator('.setup-requested-base svg').evaluate(el=>{const m=el.getScreenCTM();return {x:m.a*12+m.c*22+m.e,y:m.b*12+m.d*22+m.f};}),wantPin=await project(picked);
    assert.ok(Math.hypot(pin.x-wantPin.x,pin.y-wantPin.y)<1.6,'Requested pin tip matches its actual coordinates');
    await page.getByRole('button',{name:'Fit simulation area',exact:true}).click();await settled();
    await page.screenshot({path:`${out}/${size.width}x${size.height}-base.png`});
    await page.getByRole('button',{name:'Edit road blocks',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.setup-road-target').length>0);
    await page.getByRole('button',{name:'Fit simulation area',exact:true}).click();await settled();
    const candidate=await page.locator('.setup-road-target').evaluateAll(elements=>{
      const scene=document.querySelector('.geographic-scene').getBoundingClientRect(),base=document.querySelector('.map-facility.base').getBoundingClientRect();
      return elements.filter(el=>el.previousElementSibling.classList.contains('setup-road-open')).map(el=>{
        const length=el.getTotalLength();if(length<12)return null;const p=el.getPointAtLength(length*.43).matrixTransform(el.getScreenCTM());
        return {id:el.getAttribute('data-road-id'),x:p.x,y:p.y};
      }).filter(point=>point&&point.x>scene.left+30&&point.x<scene.right-30&&point.y>scene.top+30&&point.y<scene.bottom-30&&Math.hypot(point.x-base.x,point.y-base.y)>100&&document.elementFromPoint(point.x,point.y)?.getAttribute('data-road-id')===point.id)[0];
    });
    assert.ok(candidate,'A visible physical street target is available');await page.mouse.click(candidate.x,candidate.y);await ready();await settled();
    const blockedLabel=labels.get(candidate.id),segment=blockedLabel.match(/segment \d+/)[0];
    const finder=page.getByRole('button',{name:'Find a street',exact:true});await finder.focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Choose blocked streets',exact:true});await dialog.waitFor();
    await dialog.getByRole('searchbox',{name:'Search streets'}).fill(segment);
    const reopener=dialog.getByRole('button',{name:`Reopen ${blockedLabel}`,exact:true});await reopener.focus();await page.keyboard.press('Enter');await ready();
    const blocker=dialog.getByRole('button',{name:`Block ${blockedLabel}`,exact:true});await blocker.focus();await page.keyboard.press('Enter');await ready();
    assert.equal(await dialog.getByRole('button',{name:`Reopen ${blockedLabel}`,exact:true}).getAttribute('aria-pressed'),'true');
    await dialog.getByRole('searchbox',{name:'Search streets'}).focus();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await finder.evaluate(el=>document.activeElement===el),true);
    assert.equal(await page.locator('.leaflet-container').getAttribute('data-setup-proof'),'kept');
    await page.screenshot({path:`${out}/${size.width}x${size.height}-roads.png`});
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByLabel('Response teams',{exact:true}).fill('7');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:'Start simulation',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click({timeout:20000});
    const runBase=await page.locator('.map-facility.base').getAttribute('data-base-node-id');assert.equal(runBase,expected.base.nodeId);
    await page.screenshot({path:`${out}/${size.width}x${size.height}-run.png`});
    await page.getByRole('button',{name:'Run options',exact:true}).click();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save run',exact:true}).click();const download=await downloadPromise;
    const saved=await readFile(await download.path(),'utf8'),file=JSON.parse(saved);
    assert.equal(file.bundle.setup.resources.crews,7);assert.equal(file.bundle.setup.base.nodeId,runBase);assert.equal(file.bundle.assets.map.metadata.baseNodeId,initialBase);
    assert.deepEqual(file.bundle.assets.map,source.assets.map);assert.deepEqual(file.bundle.hashes,source.hashes);
    assert.equal(file.bundle.setup.roads.find(road=>road.edgeId===candidate.id)?.closed,true);
    const replay=await page.evaluate(async({file,edgeId})=>{
      const {replayV2}=await import('/src/v2/run-file.ts'),{observeCoordinator}=await import('/src/v2/observe.ts'),{advanceWorld}=await import('/src/v2/world.ts');
      const restored=await replayV2(file,'setup-map-browser-proof'),publicView=observeCoordinator(restored.world),base=publicView.facilities.find(f=>f.kind==='base');
      const future=advanceWorld(restored.world,240*60000);
      return {base,unitBases:publicView.units.map(unit=>unit.baseNodeId),sourceBase:publicView.map.metadata.baseNodeId,blockedAfter240Minutes:future.closedEdgeIds.includes(edgeId)};
    },{file,edgeId:candidate.id});
    assert.equal(replay.base.nodeId,runBase);assert.ok(replay.unitBases.every(id=>id===runBase));assert.equal(replay.unitBases.length,11);assert.equal(replay.sourceBase,initialBase);assert.equal(replay.blockedAfter240Minutes,true);
    await writeFile(`${out}/${size.width}x${size.height}-custom-run.json`,saved);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(intercepted>0);
    const receipt={...size,intercepted,liveTiles:0,initialBase,picked,actual,runBase,roadId:candidate.id,runSavedAtMs:file.savedAtMs,sourceMapUnchanged:true,sourceHashesUnchanged:true,replay,sha256:createHash('sha256').update(saved).digest('hex'),errors,external};
    receipts.push(receipt);await writeFile(`${out}/${size.width}x${size.height}-receipt.json`,JSON.stringify(receipt,null,2));
    console.log(JSON.stringify({pass:true,...size,intercepted,liveTiles:0,base:runBase,road:candidate.id,savedAtMs:file.savedAtMs}));await context.close();
  }
  await writeFile(`${out}/receipt.json`,JSON.stringify({receipts,liveTiles:0},null,2));
}finally{await browser.close();}
