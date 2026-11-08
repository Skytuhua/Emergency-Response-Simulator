import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { changeEvent,mechanicsFixture,needEvent } from '../../fixtures/v2/mechanics/fixture';
import { MINUTE_MS as M,type ScenarioBundleV2 } from '../../src/v2/contracts';
import { defaultSetupV2,effectiveScenarioV2,validateSetupV2,withSetupV2 } from '../../src/v2/setup';
import { baseSnapDistanceMetersV2,initialClosedEdgeIdsV2,resolveBaseV2 } from '../../src/v2/setup-topology';
import { sealScenarioV2 } from '../../src/v2/scenario';
import { admitScenarioV2 } from '../../src/v2/admission';
import { initializeWorld,advanceWorld,dispatchWorld,assertWorldInvariants } from '../../src/v2/world';
import { observeCoordinator,observeSnapshot } from '../../src/v2/observe';
import { initializeSessionV2,advanceSessionV2 } from '../../src/v2/coordinate';
import { digestSessionV2,makeRunFileV2,parseRunFileV2,replayV2 } from '../../src/v2/run-file';
import { hashValue } from '../../src/v2/hash';
import type { SessionV2 } from '../../src/v2/session';

function fixture(events:ScenarioBundleV2['assets']['events']=[]) {
  const b=mechanicsFixture();
  b.assets.geography.tracts=[{geoid:'FIXTURE',rings:[[[-96.79,32.78],[-96.77,32.78],[-96.77,32.80],[-96.79,32.80],[-96.79,32.78]]]}];
  b.assets.facilities.find(f=>f.kind==='shelter')!.capacity=8;
  b.assets.events=events;
  return sealScenarioV2(b);
}
const report=(kind:'delivery'|'relocation'='delivery')=>({...needEvent('H1',kind),observedAtMs:0});

describe('user setup overlays change operation without rewriting admitted assets',()=>{
  it('uses the configured base, team counts, supplies and shelter capacity in the actual world',async()=>{
    const b=fixture([report()]),before=JSON.stringify(b.assets),setup=defaultSetupV2(b);
    const x=b.assets.map.nodes.find(n=>n.id==='X')!;
    setup.base={requested:{lat:x.lat!,lon:x.lon!},nodeId:'X'};
    setup.resources={crews:2,vans:3,accessibleVans:1,supplyBundles:7,shelterPlaces:[{facilityId:'SHELTER',places:4}]};
    const configured=withSetupV2(b,setup),world=initializeWorld(configured,'custom-base');
    expect(admitScenarioV2(configured)).toEqual([]);
    expect(JSON.stringify(b.assets)).toBe(before);
    expect(configured.assets).toBe(b.assets);
    expect(configured.hashes).toBe(b.hashes);
    expect(configured.resources).toBe(b.resources);
    expect(world.bundle).toBe(configured);
    expect(world.units.map(u=>u.id)).toEqual(['C1','C2','V1','V2','V3']);
    expect(world.units.every(u=>u.baseNodeId==='X'&&u.cursor.kind==='node'&&u.cursor.nodeId==='X')).toBe(true);
    const view=observeCoordinator(world);
    expect(view.facilities.find(f=>f.kind==='base')).toMatchObject({nodeId:'X',position:{x:0,y:20}});
    expect(view.facilities.find(f=>f.id==='SHELTER')).toMatchObject({capacity:4,available:4});
    expect(view.supply.initial).toBe(7);
    const dispatched=dispatchWorld(world,{id:'custom-delivery',sequence:1,atMs:0,action:'deliver',unitId:'C1',householdId:'H1',needId:'N-H1'});
    expect(dispatched.result.accepted).toBe(true);
    expect(dispatched.state.missions[0].route.legs[0].fromNodeId).toBe('X');
    const done=advanceWorld(dispatched.state,14*M);
    expect(done.needs[0].completedAtMs).toBe(14*M);
    expect(observeCoordinator(done).supply.delivered).toBe(1);
    assertWorldInvariants(done);
  });
  it('uses custom capacity and stock when accepting assignments',()=>{
    const b=fixture([report('relocation')]),setup=defaultSetupV2(b);
    setup.resources.shelterPlaces[0].places=1;
    const world=initializeWorld(withSetupV2(b,setup),'small-shelter');
    expect(dispatchWorld(world,{id:'ride',sequence:1,atMs:0,action:'transport',unitId:'V1',householdId:'H1',needId:'N-H1',shelterId:'SHELTER'}).result).toMatchObject({accepted:false,reason:'The shelter has insufficient unreserved places.'});
    const supply=fixture([report()]),empty=defaultSetupV2(supply);empty.resources.supplyBundles=0;
    expect(dispatchWorld(initializeWorld(withSetupV2(supply,empty),'no-stock'),{id:'kit',sequence:1,atMs:0,action:'deliver',unitId:'C1',householdId:'H1',needId:'N-H1'}).result.accepted).toBe(false);
  });
  it('keeps user road changes through later closure and reopening events',()=>{
    const b=fixture([
      changeEvent('source-close-BH',0,{type:'edge-state-change',edgeIds:['BH'],closed:true},0),
      changeEvent('source-close-BX',10*M,{type:'edge-state-change',edgeIds:['BX'],closed:true},10*M),
      changeEvent('source-open-BX',20*M,{type:'edge-state-change',edgeIds:['BX'],closed:false},20*M),
      changeEvent('source-close-BH-again',30*M,{type:'edge-state-change',edgeIds:['BH'],closed:true},30*M),
    ]),before=JSON.stringify(b.assets.events),setup=defaultSetupV2(b);
    setup.roads=[{edgeId:'BX',closed:true},{edgeId:'BH',closed:false}];
    const configured=withSetupV2(b,setup);
    expect(initialClosedEdgeIdsV2(configured)).toEqual(['BX']);
    let world=initializeWorld(configured,'persistent-roads');
    for(const minute of [0,10,20,30,60]){world=advanceWorld(world,minute*M);expect(world.closedEdgeIds).toEqual(['BX']);expect(world.knownClosedEdgeIds).toEqual(['BX']);}
    expect(JSON.stringify(b.assets.events)).toBe(before);
  });
  it('preserves the exact no-setup view references',()=>{
    const b=fixture(),view=effectiveScenarioV2(b);
    expect(view.resources).toBe(b.resources);expect(view.facilities).toBe(b.assets.facilities);
    expect(view.events).toBe(b.assets.events);expect(view.behavior).toBe(b.assets.behavior);
    expect(view.eventTapeHash).toBe(b.hashes.events);
  });
  it('retains source AI output but disables prepared plans for custom roads',()=>{
    const b=JSON.parse(readFileSync('public/data/dallas-v2-scenario.json','utf8')) as ScenarioBundleV2;
    const setup=defaultSetupV2(b);setup.roads=[{edgeId:b.assets.map.edges[0].id,closed:false}];
    const configured=withSetupV2(b,setup);
    expect(configured.assets.behavior).toBe(b.assets.behavior);
    expect(effectiveScenarioV2(configured).behavior).toBeNull();
    const customWorld=initializeWorld(configured,'custom-no-prepared'),snapshot=observeSnapshot(customWorld);
    expect(snapshot.personas).toEqual([]);expect(snapshot.preparedActions).toEqual([]);
    expect(initializeWorld(configured,'custom-counter').behavior.directPersonaActors).toBe(0);
    const attempted=advanceWorld(customWorld,20*M);
    expect(attempted.behavior.directActions).toBe(0);
    expect(attempted.behavior.fallbackReasons['custom-road-conditions']).toBeGreaterThan(0);
    const unchanged=defaultSetupV2(b);unchanged.resources.crews++;
    const resourcesOnly=withSetupV2(b,unchanged);
    expect(effectiveScenarioV2(resourcesOnly).behavior).toBe(b.assets.behavior);
    expect(advanceWorld(initializeWorld(resourcesOnly,'resources-only-prepared'),20*M).behavior.directActions).toBeGreaterThan(0);
  },30_000);
  it('rejects malformed, unknown or unbounded settings instead of accepting source-looking data',()=>{
    const b=fixture(),good=defaultSetupV2(b);
    for(const mutate of [
      (s:any)=>{s.extra=true;},(s:any)=>{s.resources.crews=1.5;},(s:any)=>{s.resources.vans=true;},
      (s:any)=>{s.resources.crews=65;},(s:any)=>{s.resources.accessibleVans=s.resources.vans+1;},
      (s:any)=>{s.resources.supplyBundles=-1;},(s:any)=>{s.resources.shelterPlaces[0].places=17;},
      (s:any)=>{s.resources.shelterPlaces.push({...s.resources.shelterPlaces[0]});},
      (s:any)=>{s.roads=[{edgeId:'not-a-street',closed:true}];},(s:any)=>{s.roads=[{edgeId:'BH',closed:1}];},
      (s:any)=>{s.base={requested:{lat:35,lon:-96},nodeId:'B'};},
    ]){const bad=structuredClone(good);mutate(bad);expect(validateSetupV2(b,bad).length).toBeGreaterThan(0);expect(()=>withSetupV2(b,bad)).toThrow();}
  });
});

describe('base placement is inside the actual polygon and routable',()=>{
  it('snaps deterministically to an in-boundary street node and reports actual distance',async()=>{
    const b=fixture(),x=b.assets.map.nodes.find(n=>n.id==='X')!;
    const point={lat:x.lat!+0.000001,lon:x.lon!};
    const result=await resolveBaseV2(b,point,[]);
    expect(result.ok).toBe(true);
    if(!result.ok)throw new Error(result.message);
    expect(result.base).toEqual({requested:point,nodeId:'X'});
    expect(result.actual).toMatchObject({lat:x.lat,lon:x.lon,x:0,y:20});
    expect(result.snapDistanceMeters).toBeCloseTo(baseSnapDistanceMetersV2(point,result.actual,b.assets.map.metadata.projection.earthRadiusMeters),6);
  });
  it('rejects outside, polygon-hole and all-road-unreachable positions',async()=>{
    const b=fixture();
    expect(await resolveBaseV2(b,{lat:35,lon:-96},[])).toMatchObject({ok:false,code:'outside'});
    b.assets.geography.tracts[0].rings.push([[-96.7801,32.7899],[-96.7799,32.7899],[-96.7799,32.7901],[-96.7801,32.7901],[-96.7801,32.7899]]);
    expect(await resolveBaseV2(b,{lat:32.79,lon:-96.78},[])).toMatchObject({ok:false,code:'outside'});
    const closed=fixture();
    expect(await resolveBaseV2(closed,{lat:32.79,lon:-96.78},closed.assets.map.edges.map(e=>({edgeId:e.id,closed:true})))).toMatchObject({ok:false,code:'unreachable'});
  });
  it('breaks equal-distance eligible-node ties by stable node ID',async()=>{
    const b=fixture(),x=b.assets.map.nodes.find(node=>node.id==='X')!;
    b.assets.map.nodes.push({...x,id:'A',osmNodeId:5});
    const edge=structuredClone(b.assets.map.edges.find(item=>item.id==='XH')!);
    edge.id='AH';edge.from='A';edge.osmWayId=5;b.assets.map.edges.push(edge);
    const result=await resolveBaseV2(b,{lat:x.lat!,lon:x.lon!},[]);
    expect(result).toMatchObject({ok:true,base:{nodeId:'A'}});
  });
});

describe('settings are self-contained replay identity',()=>{
  it('accepts a recorded command for a newly configured unit and rejects removing that unit from the saved settings',async()=>{
    const b=fixture([report()]),setup=defaultSetupV2(b);setup.resources.crews=5;
    const start=initializeWorld(withSetupV2(b,setup),'new-unit-source'),view=observeCoordinator(start);
    const command={id:'new-crew-command',sequence:1,atMs:0,action:'deliver' as const,unitId:'C5',householdId:'H1',needId:'N-H1'};
    const dispatched=dispatchWorld(start,command);expect(dispatched.result.accepted).toBe(true);
    const source:SessionV2={world:advanceWorld(dispatched.state,30*M),policy:'urgency-first-v2',coverageFraction:.25,lineage:null,playbackOrigin:'fresh',decisions:[{
      commandId:command.id,atMs:0,policy:'urgency-first-v2',observationHash:hashValue(view),rule:'Authored setup regression',evidenceIds:['H1','C5','N-H1'],
    }]};
    const file=makeRunFileV2(source);
    expect(file.commands[0].command.unitId).toBe('C5');
    expect(digestSessionV2(await replayV2(file,'new-unit-restored'))).toEqual(digestSessionV2(source));
    file.bundle.setup!.resources.crews=4;
    expect(()=>parseRunFileV2(JSON.stringify(file))).toThrow(/unit|reference/i);
  });
  it('keeps the pre-overlay engine state, trace and summary identity for an existing default run',()=>{
    const b=mechanicsFixture();
    b.assets.geography.tracts=[{geoid:'FIXTURE',rings:[[[-96.79,32.78],[-96.77,32.78],[-96.77,32.80],[-96.79,32.80],[-96.79,32.78]]]}];
    b.assets.events=[report()];
    const session=advanceSessionV2(initializeSessionV2(sealScenarioV2(b),'urgency-plus-coverage-v2','pre-overlay-identity'),30*M);
    expect(digestSessionV2(session)).toEqual({
      stateDigest:'f213f69cdfd3620b405852fc3596bf3bb08c48cfd92ad712d498c03d01b62d09',
      traceDigest:'2d399d5c5caa5414c8ac139541e0d6222a9c244740690d3e1746c92bb1d45a5b',
      summaryHash:'af0eb85fd4df50419b868e35649b554da8e6163f9a2d2a41672084b9b19dc9c8',
    });
  });
  it('exports new effective unit IDs and replays configured base/resources/roads exactly',async()=>{
    const b=fixture([report()]),setup=defaultSetupV2(b);setup.resources.crews=5;setup.resources.vans=1;setup.resources.accessibleVans=1;
    setup.roads=[{edgeId:'BH',closed:false}];
    const source=advanceSessionV2(initializeSessionV2(withSetupV2(b,setup),'urgency-plus-coverage-v2','setup-source'),30*M);
    expect(source.world.units.some(u=>u.id==='C5')).toBe(true);
    const file=parseRunFileV2(JSON.stringify(makeRunFileV2(source)));
    expect(file.bundle.setup).toEqual(source.world.bundle.setup);
    const restored=await replayV2(file,'setup-restored');
    expect(digestSessionV2(restored)).toEqual(digestSessionV2(source));
  });
});
