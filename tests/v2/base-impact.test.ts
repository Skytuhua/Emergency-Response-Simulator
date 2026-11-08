import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MINUTE_MS, type ScenarioBundleV2 } from '../../src/v2/contracts';
import { initializeSessionV2, advanceSessionV2 } from '../../src/v2/coordinate';
import { initializeWorld, dispatchWorld, advanceWorld } from '../../src/v2/world';
import { defaultSetupV2, withSetupV2 } from '../../src/v2/setup';
import { resolveBaseImmediatelyV2, baseSnapDistanceMetersV2 } from '../../src/v2/setup-topology';
import { digestSessionV2, makeRunFileV2, replayV2 } from '../../src/v2/run-file';

const bundle = JSON.parse(readFileSync('public/data/dallas-v2-scenario.json','utf8')) as ScenarioBundleV2;
function configured(point:{lat:number;lon:number}) {
  const setup=defaultSetupV2(bundle),result=resolveBaseImmediatelyV2(bundle,{lat:point.lat,lon:point.lon},[]);
  if(!result.ok)throw new Error(result.message);
  setup.base=result.base;
  return withSetupV2(bundle,setup);
}
describe('Dallas base placement affects response',()=>{
  it('changes actual travel to the same home from a different valid base',()=>{
    const node=bundle.assets.map.nodes.find(item=>item.id==='osm-n859233806')!;
    const alternate=configured({lat:node.lat!,lon:node.lon!});
    const command={id:'same-home-check',sequence:1,atMs:0,action:'check' as const,unitId:'C1',householdId:'HH-48113001502-00001'};
    const runs=[bundle,alternate].map(input=>{
      const dispatched=dispatchWorld(initializeWorld(input,'same-home'),command);
      expect(dispatched.result.accepted).toBe(true);
      const mission=dispatched.state.missions[0],edges=new Map(input.assets.map.edges.map(edge=>[edge.id,edge]));
      const distance=mission.route.legs.reduce((sum,leg)=>sum+(edges.get(leg.edgeId)?.lengthMeters??0),0);
      const finished=advanceWorld(dispatched.state,60*MINUTE_MS),completed=finished.missions.find(item=>item.id===mission.id)!;
      const arrival=finished.events.find(event=>event.missionId===mission.id&&event.type==='stage-started'&&event.message.startsWith('Started checking'));
      return {origin:mission.route.legs[0].fromNodeId,travelMs:mission.route.durationMs,distance,arrivalMs:arrival?.atMs,completedMs:completed.completedAtMs};
    });
    expect(runs[0].origin).toBe('osm-n81782630');expect(runs[1].origin).toBe('osm-n859233806');
    expect(runs[0].travelMs).toBe(415310);expect(runs[1].travelMs).toBe(1040669);
    expect(runs[0].distance).toBeCloseTo(1384.361,3);expect(runs[1].distance).toBeCloseTo(3468.883,3);
    expect(runs[0].arrivalMs).toBe(runs[0].travelMs);expect(runs[1].arrivalMs).toBe(runs[1].travelMs);
    expect(runs[0].completedMs).toBe(runs[0].arrivalMs!+bundle.resources.assessmentMs);
    expect(runs[1].completedMs).toBe(runs[1].arrivalMs!+bundle.resources.assessmentMs);
  },30_000);

  it('changes origins and actual trips while preserving saved-run identity',async()=>{
    const sorted=[...bundle.assets.population.households].sort((a,b)=>a.position.lon-b.position.lon);
    const west=configured(sorted[0].position),east=configured(sorted.at(-1)!.position);
    const w=west.setup!.base!,e=east.setup!.base!;
    expect(w.nodeId).not.toBe(e.nodeId);
    expect(baseSnapDistanceMetersV2(w.requested,e.requested)).toBeGreaterThan(1500);
    for(const [b,id] of [[west,w.nodeId],[east,e.nodeId]] as const) {
      const world=initializeWorld(b,'origin-proof');
      expect(world.units.every(u=>u.baseNodeId===id&&u.cursor.kind==='node'&&u.cursor.nodeId===id)).toBe(true);
    }
    const ws=initializeSessionV2(west,'urgency-plus-coverage-v2','west-proof');
    const es=initializeSessionV2(east,'urgency-plus-coverage-v2','east-proof');
    const pick=(session:typeof ws)=>session.world.missions.map(m=>({home:m.householdId,unit:m.unitId,start:m.route.legs[0]?.fromNodeId,legs:m.route.legs.map(l=>l.edgeId),duration:m.route.durationMs}));
    const initialWest=pick(ws),initialEast=pick(es);
    const westFinished=advanceSessionV2(ws,20*MINUTE_MS),eastFinished=advanceSessionV2(es,20*MINUTE_MS);
    const rows=(s:typeof ws)=>s.world.missions.map(m=>({unit:m.unitId,home:m.householdId,action:m.action,dispatchedMs:m.dispatchedAtMs,completedMs:m.completedAtMs}));
    expect(initialWest.length).toBeGreaterThan(0);
    expect(initialEast.length).toBeGreaterThan(0);
    expect(initialWest[0].start).toBe(w.nodeId);
    expect(initialEast[0].start).toBe(e.nodeId);
    expect(initialWest).not.toEqual(initialEast);
    expect(rows(westFinished)).not.toEqual(rows(eastFinished));
    for(const [finished,base] of [[westFinished,w],[eastFinished,e]] as const){
      const saved=makeRunFileV2(finished);expect(saved.bundle.setup!.base).toEqual(base);
      const restored=await replayV2(saved,'replay-proof');
      expect(digestSessionV2(restored)).toEqual(saved.expected);
      expect(restored.world.units.every(u=>u.baseNodeId===base.nodeId)).toBe(true);
    }
  },60_000);
});
