import { createServer } from 'vite';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const root=new URL('../../',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const server=await createServer({server:{middlewareMode:true,watch:null,ws:false,preTransformRequests:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
  const {createScenarioV2}=await server.ssrLoadModule('/src/v2/scenario.ts');
  const {admitScenarioV2}=await server.ssrLoadModule('/src/v2/admission.ts');
  const {initializeSessionV2,advanceSessionV2}=await server.ssrLoadModule('/src/v2/coordinate.ts');
  const {observeSnapshot}=await server.ssrLoadModule('/src/v2/observe.ts');
  const {seededRank}=await server.ssrLoadModule('/src/v2/hash.ts');
  const inputs={map:await read('fixtures/v2/maps/dallas-roads-v2.json'),population:await read('fixtures/v2/population/dallas-population-v2.json'),geography:await read('fixtures/v2/geography/dallas-geography-v2.json'),facilities:await read('fixtures/v2/maps/facilities-v2.json')};
  const started=performance.now();
  const behaviorPath=process.argv.find(arg=>arg.startsWith('--behavior='))?.slice('--behavior='.length);
  const behavior=behaviorPath?JSON.parse(await readFile(behaviorPath,'utf8')):null;
  const bundle=createScenarioV2(inputs,20261108,behavior),errors=admitScenarioV2(bundle);
  if(errors.length)throw new Error(errors.join('; '));
  const builtMs=performance.now()-started;
  const needs=bundle.assets.events.filter(event=>event.payload.type==='need-onset').map(event=>event.payload.need);
  const eligible=needs.filter(need=>bundle.assets.events.some(event=>event.payload.type==='communications-change'&&event.payload.householdIds.includes(need.householdId)&&event.effectiveAtMs>need.onsetMs+bundle.behaviorRules.reportDelayMs));
  eligible.sort((a,b)=>seededRank(bundle.seed,bundle.recipeVersion,'direct-actor',a.householdId).localeCompare(seededRank(bundle.seed,bundle.recipeVersion,'direct-actor',b.householdId)));
  const actors=eligible.slice(0,24).map(need=>need.householdId);
  if(actors.length!==24)throw new Error('Fewer than24 context-eligible actors; do not fabricate target.');
  const directory=new URL('.private/dallas-v2-reference/',root);await mkdir(directory,{recursive:true});
  await writeFile(new URL('scenario-v2.json',directory),JSON.stringify(bundle));
  await writeFile(new URL('actor-selection.json',directory),JSON.stringify({seed:bundle.seed,method:'pre-outcome field-keyed rank among need homes with a subsequent local communications change',eligible:eligible.length,actors,cohorts:Array.from({length:4},(_,i)=>actors.slice(i*6,i*6+6))},null,2));
  if(process.argv.includes('--publish')){
    await mkdir(new URL('public/data/',root),{recursive:true});
    await writeFile(new URL('public/data/dallas-v2-scenario.json',root),JSON.stringify(bundle));
  }
  const initAt=performance.now();let session=initializeSessionV2(bundle,'urgency-plus-coverage-v2','reference-probe');
  const initializedMs=performance.now()-initAt;
  const stepAt=performance.now();session=advanceSessionV2(session);const firstStepMs=performance.now()-stepAt;
  const snapshotAt=performance.now();const snapshot=observeSnapshot(session.world);const snapshotMs=performance.now()-snapshotAt;
  const receipt={households:snapshot.population.households,persons:snapshot.population.persons,horizonMinutes:360,mapNodes:bundle.assets.map.nodes.length,mapEdges:bundle.assets.map.edges.length,needs:needs.length,preparedActors:bundle.assets.behavior?.personas.length??0,eligibleActors:eligible.length,selectedActors:actors,builtMs,initializedMs,firstStepMs,snapshotMs,automaticCommands:session.world.commands.length,hashes:bundle.hashes,published:process.argv.includes('--publish')};
  await writeFile(new URL('build-receipt.json',directory),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}finally{await server.close();}
