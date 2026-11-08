import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import type { ScenarioBundleV2 } from '../../src/v2/contracts';
import { baseSnapDistanceMetersV2, initialClosedEdgeIdsV2, resolveBaseImmediatelyV2 } from '../../src/v2/setup-topology';
import { compareIdsV2, planRouteV2 } from '../../src/v2/routes';

describe('base route reachability',()=>{
  it('agrees with waypoint routing for one-way streets, closures and turn restrictions',()=>{
    for(const mode of ['no','only','u-turn'] as const)for(const direction of ['both','forward','reverse'] as const)for(const closedId of [null,'BH','XH','HS']){
      const b=mechanicsFixture();
      b.assets.geography.tracts=[{geoid:'FIXTURE',rings:[[[-96.79,32.78],[-96.77,32.78],[-96.77,32.80],[-96.79,32.80],[-96.79,32.78]]]}];
      b.assets.map.edges.find(edge=>edge.id==='BH')!.direction=direction;
      b.assets.map.restrictions=[{id:'restriction',viaNodeId:'H',fromWayId:1,toWayId:mode==='u-turn'?1:4,kind:mode==='only'?'only':'no',maneuver:mode==='u-turn'?'no_u_turn':'no_right_turn'}];
      const roads=closedId?[{edgeId:closedId,closed:true}]:[],closed=initialClosedEdgeIdsV2(b,roads);
      for(const requestedNode of b.assets.map.nodes){
        const requested={lat:requestedNode.lat!,lon:requestedNode.lon!};
        const ordered=b.assets.map.nodes.filter(n=>b.assets.map.edges.some(e=>!closed.includes(e.id)&&(e.direction==='both'&&(e.from===n.id||e.to===n.id)||e.direction==='forward'&&e.from===n.id||e.direction==='reverse'&&e.to===n.id)))
          .map(node=>({node,distance:baseSnapDistanceMetersV2(requested,{lat:node.lat!,lon:node.lon!},b.assets.map.metadata.projection.earthRadiusMeters)}))
          .sort((a,c)=>a.distance-c.distance||compareIdsV2(a.node.id,c.node.id));
        const expected=ordered.find(({node})=>planRouteV2(b.assets.map,{nodeId:node.id,incoming:null},['H','S'],closed));
        const actual=resolveBaseImmediatelyV2(b,requested,roads);
        expect(actual.ok?actual.base.nodeId:null).toBe(expected?.node.id??null);
      }
    }
  });
  it('quickly rejects a base when all Dallas shelter streets are closed',()=>{
    const b=JSON.parse(readFileSync('public/data/dallas-v2-scenario.json','utf8')) as ScenarioBundleV2;
    const shelters=new Set(b.assets.facilities.filter(f=>f.kind==='shelter').map(f=>f.nodeId));
    const roads=b.assets.map.edges.filter(edge=>shelters.has(edge.from)||shelters.has(edge.to)).map(edge=>({edgeId:edge.id,closed:true}));
    const home=b.assets.population.households[0].position;
    expect(roads.length).toBeGreaterThan(0);
    expect(resolveBaseImmediatelyV2(b,{lat:home.lat,lon:home.lon},roads)).toMatchObject({ok:false,code:'unreachable'});
  },3000);
});
