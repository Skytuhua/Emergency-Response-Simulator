import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DISASTER_SCENARIO_RECIPE_V1, MINUTE_MS, type DisasterScenarioV2, type ScenarioBundleV2 } from '../../src/v2/contracts';
import { scenarioEventsV2 } from '../../src/v2/disaster-scenarios';
import { defaultSetupV2,effectiveScenarioV2,validateSetupV2,withSetupV2 } from '../../src/v2/setup';
import { initialClosedEdgeIdsV2,resolveBaseImmediatelyV2 } from '../../src/v2/setup-topology';
import { initializeSessionV2,advanceSessionV2 } from '../../src/v2/coordinate';
import { digestSessionV2,makeRunFileV2,replayV2 } from '../../src/v2/run-file';
import { observeSnapshot } from '../../src/v2/observe';
import { evaluateResidentOpportunityV2 } from '../../src/v2/behavior';
import { initializeWorld,advanceWorld } from '../../src/v2/world';
import { hashValue } from '../../src/v2/hash';
import { admitScenarioV2 } from '../../src/v2/admission';
import * as scenarioGenerator from '../../src/v2/disaster-scenarios';

const bundle=JSON.parse(readFileSync('public/data/dallas-v2-scenario.json','utf8')) as ScenarioBundleV2;
const choose=(scenario:DisasterScenarioV2)=>withSetupV2(bundle,{...defaultSetupV2(bundle),scenario,...(scenario==='storm'?{}:{scenarioRecipe:DISASTER_SCENARIO_RECIPE_V1})});
describe('synthetic Dallas disaster choices',()=>{
  it('preserves the original storm and old setup overlays exactly',()=>{
    const storm=choose('storm'),old=defaultSetupV2(bundle);delete old.scenario;
    expect(validateSetupV2(bundle,old)).toEqual([]);
    expect(effectiveScenarioV2(storm).events).toBe(bundle.assets.events);
    expect(effectiveScenarioV2(withSetupV2(bundle,old)).eventTapeHash).toBe(bundle.hashes.events);
    expect(effectiveScenarioV2(storm).behavior).toBe(bundle.assets.behavior);
    expect(validateSetupV2(bundle,{...old,scenario:'other'})).not.toEqual([]);
    expect(validateSetupV2(bundle,{...old,scenario:null})).not.toEqual([]);
    expect(validateSetupV2(bundle,{...old,scenario:'flood'})).not.toEqual([]);
    expect(validateSetupV2(bundle,{...old,scenario:'tornado',scenarioRecipe:'unrecognized'})).not.toEqual([]);
  });
  it('creates distinct deterministic assumed needs, outages and road closures without changing admitted assets',()=>{
    const before=JSON.stringify(bundle.assets),runs=['storm','flood','tornado'].map(scenario=>choose(scenario as DisasterScenarioV2));
    const events=runs.map(run=>effectiveScenarioV2(run).events);
    expect(hashValue(events[1])).toBe('cfc4677a3a74afb174d50c0886d3f92fc187523d2c488808bd998784135550c2');
    expect(hashValue(events[2])).toBe('6d87b5e0167643268e0f8ab6b8057a4d7aac16019da48bcd07f0e846c0c6b04e');
    expect(events[1]).toEqual(scenarioEventsV2(bundle,'flood'));expect(events[2]).toEqual(scenarioEventsV2(bundle,'tornado'));
    expect(events[1]).not.toEqual(events[0]);expect(events[2]).not.toEqual(events[1]);
    for(const [index,run] of runs.entries()){
      expect(JSON.stringify(run.assets)).toBe(before);expect(run.hashes).toEqual(bundle.hashes);
      const tape=events[index];expect(new Set(tape.map(event=>event.id)).size).toBe(tape.length);
      for(const event of tape){expect(event.effectiveAtMs%MINUTE_MS).toBe(0);if(event.observedAtMs!==null)expect(event.observedAtMs%MINUTE_MS).toBe(0);}
      if(index){expect(effectiveScenarioV2(run).behavior).toBeNull();expect(effectiveScenarioV2(run).eventTapeHash).not.toBe(bundle.hashes.events);}
    }
    const count=(event:ScenarioBundleV2['assets']['events'][number],type:string)=>event.payload.type===type;
    expect(events[1].filter(e=>e.payload.type==='need-onset'&&e.payload.need.kind==='relocation').length).toBeGreaterThan(events[0].filter(e=>e.payload.type==='need-onset'&&e.payload.need.kind==='relocation').length);
    for(const tape of events.slice(1))for(const kind of ['delivery','relocation'] as const)for(const urgent of [true,false])expect(tape.some(e=>e.payload.type==='need-onset'&&e.payload.need.kind===kind&&e.payload.need.urgent===urgent)).toBe(true);
    expect(events[1].some(e=>count(e,'communications-change'))).toBe(true);expect(events[2].some(e=>count(e,'edge-state-change'))).toBe(true);
  });
  it('keeps the default Dallas base reachable and respects edited roads in each new scenario',()=>{
    const node=bundle.assets.map.nodes.find(item=>item.id===bundle.resources.depotNodeId)!;
    for(const scenario of ['flood','tornado'] as const){
      const initial=initialClosedEdgeIdsV2(bundle,[],scenario);expect(initial.length).toBeGreaterThan(0);
      const resolved=resolveBaseImmediatelyV2(bundle,{lat:node.lat!,lon:node.lon!},[],scenario);
      expect(resolved).toMatchObject({ok:true,base:{nodeId:node.id}});
      const setup={...defaultSetupV2(bundle),scenario,scenarioRecipe:DISASTER_SCENARIO_RECIPE_V1,roads:[{edgeId:initial[0],closed:false}]};
      const run=choose(scenario),edited=withSetupV2(run,setup);
      expect(initialClosedEdgeIdsV2(edited)).not.toContain(initial[0]);
      expect(effectiveScenarioV2(edited).events.filter(event=>event.payload.type==='edge-state-change'&&event.payload.edgeIds.includes(initial[0])).map(event=>event.id)).toHaveLength(1);
    }
  },30_000);
  it('schedules a scenario-specific 80% reporting cohort and retries calls during outages',()=>{
    for(const scenario of ['flood','tornado'] as const){
      const setup={...defaultSetupV2(bundle),scenario,scenarioRecipe:DISASTER_SCENARIO_RECIPE_V1};
      setup.resources.crews=0;setup.resources.vans=0;setup.resources.accessibleVans=0;
      const run=withSetupV2(bundle,setup),effective=effectiveScenarioV2(run),needHomes=new Set(effective.events.flatMap(event=>event.payload.type==='need-onset'?[event.payload.need.householdId]:[]));
      const reporting=effective.behaviorRules.reportingHouseholdIds;
      expect(reporting.length).toBe(Math.round(needHomes.size*.8));expect(reporting.every(id=>needHomes.has(id))).toBe(true);
      expect(reporting).not.toEqual(bundle.behaviorRules.reportingHouseholdIds);
      const world=advanceWorld(initializeWorld(run,`calls-${scenario}`),210*MINUTE_MS);
      const failures=world.events.filter(event=>event.type==='report-failed');
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some(event=>world.events.filter(other=>other.type==='report-failed'&&other.householdId===event.householdId).length>1)).toBe(true);
      expect(world.events.some(event=>event.type==='report-received')).toBe(true);
      for(const failure of failures)expect(reporting).toContain(failure.householdId);
    }
    expect(effectiveScenarioV2(choose('storm')).behaviorRules).toBe(bundle.behaviorRules);
  },60_000);
  it('rejects altered source assets before generating a scenario for base validation',()=>{
    const damaged=structuredClone(bundle),id='X'.repeat(200000);damaged.assets.population.households[0].id=id;
    const base=bundle.assets.map.nodes.find(node=>node.id===bundle.resources.depotNodeId)!;
    damaged.setup={...defaultSetupV2(bundle),scenario:'flood',scenarioRecipe:DISASTER_SCENARIO_RECIPE_V1,base:{nodeId:base.id,requested:{lat:base.lat!,lon:base.lon!}}};
    const generator=vi.spyOn(scenarioGenerator,'scenarioEventsV2');
    try{expect(admitScenarioV2(damaged).length).toBeGreaterThan(0);expect(generator).not.toHaveBeenCalled();}finally{generator.mockRestore();}
  },30_000);
  it('keeps the chosen scenario through a saved run and replay without prepared AI',async()=>{
    for(const scenario of ['flood','tornado'] as const){
      const run=choose(scenario),session=advanceSessionV2(initializeSessionV2(run,'urgency-plus-coverage-v2',`scenario-${scenario}`),10*MINUTE_MS);
      const snapshot=observeSnapshot(session.world);expect(snapshot.preparedActions).toEqual([]);expect(snapshot.personas).toEqual([]);
      const file=makeRunFileV2(session);expect(file.bundle.setup?.scenario).toBe(scenario);
      const replay=await replayV2(file,`replayed-${scenario}`);expect(digestSessionV2(replay)).toEqual(file.expected);
      const home=run.assets.population.households[0],support=run.assets.support.find(item=>item.householdId===home.id)!;
      const decision=evaluateResidentOpportunityV2(run,{householdId:home.id,opportunityId:'authored-opportunity',atMs:0,size:home.size,accessiblePlacesRequired:support.accessiblePlacesRequired,communicationsAvailable:true,need:null,completedAssistance:[]});
      expect(decision).toMatchObject({source:'behavior-model',fallback:true,fallbackReason:'different-disaster-scenario'});
      const tampered=structuredClone(file);tampered.bundle.setup!.scenario=scenario==='flood'?'tornado':'flood';
      await expect(replayV2(tampered,'tampered')).rejects.toThrow();
    }
  },60_000);
});
