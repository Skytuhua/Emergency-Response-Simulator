import type { PositionV2,ScenarioBundleV2,SetupOverlayV2 } from './contracts';
import { pointInRingsV2 } from './data-admission';
import { compareIdsV2 } from './routes';

type Point={lat:number;lon:number};
type Roads=SetupOverlayV2['roads'];
export type BaseResolutionV2={ok:true;base:NonNullable<SetupOverlayV2['base']>;actual:PositionV2;snapDistanceMeters:number}
  |{ok:false;code:'outside'|'unreachable'|'invalid';message:string};

export function baseSnapDistanceMetersV2(a:Point,b:Point,earthRadiusMeters=6371008.8):number {
  const radians=Math.PI/180,dlat=(b.lat-a.lat)*radians,dlon=(b.lon-a.lon)*radians;
  const hav=Math.sin(dlat/2)**2+Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin(dlon/2)**2;
  return 2*earthRadiusMeters*Math.asin(Math.min(1,Math.sqrt(Math.max(0,hav))));
}
export function pointInsideSetupAreaV2(bundle:ScenarioBundleV2,point:Point):boolean {
  return Number.isFinite(point.lat)&&Number.isFinite(point.lon)&&bundle.assets.geography.tracts.some(tract=>pointInRingsV2(point.lon,point.lat,tract.rings));
}
export function initialClosedEdgeIdsV2(bundle:ScenarioBundleV2,overrides:Roads=bundle.setup?.roads??[]):string[] {
  const closed=new Set<string>();
  for(const event of [...bundle.assets.events].filter(event=>event.effectiveAtMs===0).sort((a,b)=>compareIdsV2(a.id,b.id))){
    if(event.payload.type==='edge-state-change')for(const id of event.payload.edgeIds)event.payload.closed?closed.add(id):closed.delete(id);
  }
  for(const road of overrides)road.closed?closed.add(road.edgeId):closed.delete(road.edgeId);
  return [...closed].sort(compareIdsV2);
}
function context(bundle:ScenarioBundleV2,requested:Point,roads:Roads) {
  const closed=initialClosedEdgeIdsV2(bundle,roads),closedSet=new Set(closed),outgoing=new Set<string>();
  for(const edge of bundle.assets.map.edges)if(!closedSet.has(edge.id)){
    if(edge.direction==='both'||edge.direction==='forward')outgoing.add(edge.from);
    if(edge.direction==='both'||edge.direction==='reverse')outgoing.add(edge.to);
  }
  const open=new Map(bundle.assets.facilities.map(f=>[f.id,f.opensAtMs===0]));
  for(const event of [...bundle.assets.events].filter(event=>event.effectiveAtMs===0).sort((a,b)=>compareIdsV2(a.id,b.id)))if(event.payload.type==='facility-state-change')open.set(event.payload.facilityId,event.payload.open);
  const shelters=bundle.assets.facilities.filter(f=>f.kind==='shelter'&&open.get(f.id)).sort((a,b)=>compareIdsV2(a.id,b.id));
  const homes=new Set(bundle.assets.population.households.map(home=>home.homeNodeId));
  const shelterNodes=new Set(shelters.map(shelter=>shelter.nodeId));
  const radius=bundle.assets.map.metadata.projection.earthRadiusMeters;
  const candidates=bundle.assets.map.nodes.filter(node=>outgoing.has(node.id)&&pointInsideSetupAreaV2(bundle,{lat:node.lat!,lon:node.lon!}))
    .map(node=>({node,distance:baseSnapDistanceMetersV2(requested,{lat:node.lat!,lon:node.lon!},radius)}))
    .sort((a,b)=>a.distance-b.distance||compareIdsV2(a.node.id,b.node.id));

  // Search backwards over incoming-arc states, preserving turn restrictions across a home pickup.
  type Arc={from:string;to:string;way:number};
  const arcs:Arc[]=[],incoming=new Map<string,number[]>(),departing=new Map<string,number[]>();
  const add=(from:string,to:string,way:number)=>{
    const id=arcs.push({from,to,way})-1;
    incoming.set(to,[...(incoming.get(to)??[]),id]);
    departing.set(from,[...(departing.get(from)??[]),id]);
  };
  for(const edge of bundle.assets.map.edges)if(!closedSet.has(edge.id)){
    if(edge.direction==='both'||edge.direction==='forward')add(edge.from,edge.to,edge.osmWayId);
    if(edge.direction==='both'||edge.direction==='reverse')add(edge.to,edge.from,edge.osmWayId);
  }
  const restrictions=new Map<string,typeof bundle.assets.map.restrictions>();
  for(const restriction of bundle.assets.map.restrictions){
    const key=`${restriction.viaNodeId}:${restriction.fromWayId}`;
    restrictions.set(key,[...(restrictions.get(key)??[]),restriction]);
  }
  const legal=(previous:Arc,next:Arc)=>!(restrictions.get(`${next.from}:${previous.way}`)??[]).some(restriction=>{
    const sameWay=restriction.toWayId===next.way;
    const uTurn=restriction.maneuver.endsWith('u_turn')&&restriction.fromWayId===restriction.toWayId;
    const target=sameWay&&(!uTurn||previous.from===next.to);
    return restriction.kind==='only'?!target:target;
  });
  const backwards=(seeds:number[])=>{
    const seen=new Set(seeds),queue=[...seen];
    for(let i=0;i<queue.length;i++){
      const next=arcs[queue[i]];
      for(const id of incoming.get(next.from)??[])if(!seen.has(id)&&legal(arcs[id],next)){seen.add(id);queue.push(id);}
    }
    return seen;
  };
  const toShelter=backwards(arcs.flatMap((arc,id)=>shelterNodes.has(arc.to)?[id]:[]));
  const viaHome=backwards([...toShelter].filter(id=>homes.has(arcs[id].to)));
  const reachable=(nodeId:string)=>{
    if(homes.has(nodeId)&&shelterNodes.has(nodeId))return true;
    for(const id of departing.get(nodeId)??[])if(viaHome.has(id)||homes.has(nodeId)&&toShelter.has(id))return true;
    return false;
  };
  return {candidates,reachable};
}
function failure(bundle:ScenarioBundleV2,requested:Point,roads:Roads):BaseResolutionV2|null {
  if(!requested||typeof requested!=='object'||![requested.lat,requested.lon].every(value=>typeof value==='number'&&Number.isFinite(value))||Math.abs(requested.lat)>90||Math.abs(requested.lon)>180)return {ok:false,code:'invalid',message:'Choose a valid point on the map.'};
  if(!pointInsideSetupAreaV2(bundle,requested))return {ok:false,code:'outside',message:'Choose a point inside the simulation boundary.'};
  const edgeIds=new Set(bundle.assets.map.edges.map(edge=>edge.id)),seen=new Set<string>();
  if(!Array.isArray(roads)||roads.some(road=>!road||!edgeIds.has(road.edgeId)||typeof road.closed!=='boolean'||seen.has(road.edgeId)||!seen.add(road.edgeId)))return {ok:false,code:'invalid',message:'Choose road segments from this simulation.'};
  return null;
}
const noRoute=():BaseResolutionV2=>({ok:false,code:'unreachable',message:'No reachable street base was found inside this boundary. Reopen a road and try again.'});
function success(requested:Point,candidate:ReturnType<typeof context>['candidates'][number]):BaseResolutionV2 {
  const {node,distance}=candidate;
  return {ok:true,base:{requested:{...requested},nodeId:node.id},actual:{lat:node.lat!,lon:node.lon!,x:node.x,y:node.y},snapDistanceMeters:distance};
}
/** Synchronous admission uses exactly the same deterministic selection as the UI. */
export function resolveBaseImmediatelyV2(bundle:ScenarioBundleV2,requested:Point,roads:Roads):BaseResolutionV2 {
  const invalid=failure(bundle,requested,roads);if(invalid)return invalid;
  const search=context(bundle,requested,roads);
  for(const candidate of search.candidates)if(search.reachable(candidate.node.id))return success(requested,candidate);
  return noRoute();
}
/** Yield between candidate batches so a difficult placement does not monopolize UI work. */
export async function resolveBaseV2(bundle:ScenarioBundleV2,requested:Point,roads:Roads=bundle.setup?.roads??[]):Promise<BaseResolutionV2> {
  const invalid=failure(bundle,requested,roads);if(invalid)return invalid;
  const search=context(bundle,requested,roads);
  for(let index=0;index<search.candidates.length;index++){
    if(index>0&&index%8===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    const candidate=search.candidates[index];if(search.reachable(candidate.node.id))return success(requested,candidate);
  }
  return noRoute();
}
