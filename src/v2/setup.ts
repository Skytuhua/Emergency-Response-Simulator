import type { BehaviorArtifactV2,FacilityV2,ResourceSpecificationV2,ScenarioBundleV2,SetupOverlayV2,WorldEventV2 } from './contracts';
import { hashValue } from './hash';
import { compareIdsV2 } from './routes';
import { resolveBaseImmediatelyV2 } from './setup-topology';

export interface EffectiveScenarioV2 {resources:ResourceSpecificationV2;facilities:FacilityV2[];events:WorldEventV2[];behavior:BehaviorArtifactV2|null;eventTapeHash:string}
const cache=new WeakMap<ScenarioBundleV2,EffectiveScenarioV2>();
const plain=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const keys=(value:Record<string,unknown>,names:string[])=>Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const integer=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;

export function defaultSetupV2(bundle:ScenarioBundleV2):SetupOverlayV2 {
  return {kind:'dallas-user-setup',version:1,base:null,roads:[],resources:{
    crews:bundle.resources.units.filter(unit=>unit.kind==='crew').length,vans:bundle.resources.units.filter(unit=>unit.kind==='van').length,
    accessibleVans:bundle.resources.units.filter(unit=>unit.kind==='van'&&unit.accessiblePlaces>0).length,
    supplyBundles:bundle.resources.supplyBundles,shelterPlaces:bundle.assets.facilities.filter(facility=>facility.kind==='shelter').map(facility=>({facilityId:facility.id,places:facility.capacity})),
  }};
}
export function validateSetupV2(bundle:ScenarioBundleV2,input:unknown):string[] {
  const errors:string[]=[];
  if(!plain(input)||!keys(input,['kind','version','base','roads','resources'])||input.kind!=='dallas-user-setup'||input.version!==1)return ['setup: These settings are not supported.'];
  const resource=input.resources;
  if(!plain(resource)||!keys(resource,['crews','vans','accessibleVans','supplyBundles','shelterPlaces']))errors.push('resources: Choose supported resource settings.');
  else{
    if(!integer(resource.crews,0,64))errors.push('resources.crews: Choose a whole number from 0 to 64.');
    if(!integer(resource.vans,0,64))errors.push('resources.vans: Choose a whole number from 0 to 64.');
    if(!integer(resource.accessibleVans,0,typeof resource.vans==='number'?resource.vans:0))errors.push('resources.accessibleVans: Accessible vans cannot exceed all vans.');
    if(!integer(resource.supplyBundles,0,100_000))errors.push('resources.supplyBundles: Choose a whole number from 0 to 100000.');
    const shelterIds=new Set(bundle.assets.facilities.filter(f=>f.kind==='shelter').map(f=>f.id)),seen=new Set<string>();
    if(!Array.isArray(resource.shelterPlaces)||resource.shelterPlaces.length!==shelterIds.size)errors.push('resources.shelterPlaces: Set the capacity of every shelter.');
    else for(const row of resource.shelterPlaces){
      if(!plain(row)||!keys(row,['facilityId','places'])||typeof row.facilityId!=='string'||!shelterIds.has(row.facilityId)||seen.has(row.facilityId)||!integer(row.places,0,bundle.assets.population.persons.length))errors.push('resources.shelterPlaces: Choose valid capacities for each shelter.');
      else seen.add(row.facilityId);
    }
  }
  const edgeIds=new Set(bundle.assets.map.edges.map(edge=>edge.id)),seenRoads=new Set<string>();
  if(!Array.isArray(input.roads)||input.roads.length>edgeIds.size)errors.push('roads: Choose road segments from this simulation.');
  else for(const road of input.roads){
    if(!plain(road)||!keys(road,['edgeId','closed'])||typeof road.edgeId!=='string'||!edgeIds.has(road.edgeId)||seenRoads.has(road.edgeId)||typeof road.closed!=='boolean')errors.push('roads: Choose each road segment at most once.');
    else seenRoads.add(road.edgeId);
  }
  if(input.base!==null){
    const base=input.base;
    if(!plain(base)||!keys(base,['requested','nodeId'])||!plain(base.requested)||!keys(base.requested,['lat','lon'])||typeof base.nodeId!=='string')errors.push('base: Choose a base on the map.');
    else if(!errors.some(error=>error.startsWith('roads:'))){
      const result=resolveBaseImmediatelyV2(bundle,base.requested as unknown as {lat:number;lon:number},input.roads as SetupOverlayV2['roads']);
      if(!result.ok)errors.push(`base: ${result.message}`);
      else if(result.base.nodeId!==base.nodeId)errors.push('base: The base must use the nearest reachable street point. Choose its location again.');
    }
  }
  return [...new Set(errors)];
}
export function withSetupV2(bundle:ScenarioBundleV2,setup:SetupOverlayV2):ScenarioBundleV2 {
  const errors=validateSetupV2(bundle,setup);if(errors.length)throw new Error(errors.join(' '));
  const copy=structuredClone(setup);copy.roads.sort((a,b)=>compareIdsV2(a.edgeId,b.edgeId));copy.resources.shelterPlaces.sort((a,b)=>compareIdsV2(a.facilityId,b.facilityId));
  return {...bundle,setup:copy};
}
export function effectiveScenarioV2(bundle:ScenarioBundleV2):EffectiveScenarioV2 {
  if(!bundle.setup)return {resources:bundle.resources,facilities:bundle.assets.facilities,events:bundle.assets.events,behavior:bundle.assets.behavior,eventTapeHash:bundle.hashes.events};
  const cached=cache.get(bundle);if(cached)return cached;
  const settings=bundle.setup,baseNode=settings.base?.nodeId??bundle.resources.depotNodeId;
  const node=bundle.assets.map.nodes.find(item=>item.id===baseNode)!;
  const capacities=new Map(settings.resources.shelterPlaces.map(row=>[row.facilityId,row.places]));
  const facilities=bundle.assets.facilities.map(facility=>facility.kind==='shelter'?{...facility,capacity:capacities.get(facility.id)!}:facility.kind==='base'&&facility.nodeId===bundle.resources.depotNodeId?{...facility,nodeId:baseNode,position:{lat:node.lat!,lon:node.lon!,x:node.x,y:node.y}}:facility);
  const units:ResourceSpecificationV2['units']=[
    ...Array.from({length:settings.resources.crews},(_,index)=>({id:`C${index+1}`,kind:'crew' as const,capabilities:['check','deliver'] as ('check'|'deliver')[],seats:0,accessiblePlaces:0,baseNodeId:baseNode})),
    ...Array.from({length:settings.resources.vans},(_,index)=>({id:`V${index+1}`,kind:'van' as const,capabilities:['transport','pickup-verification'] as ('transport'|'pickup-verification')[],seats:6,accessiblePlaces:index<settings.resources.accessibleVans?1:0,baseNodeId:baseNode})),
  ];
  const resources={...bundle.resources,units,supplyBundles:settings.resources.supplyBundles,depotNodeId:baseNode};
  let events=bundle.assets.events;
  if(settings.roads.length){
    const overridden=new Set(settings.roads.map(road=>road.edgeId)),ids=new Set(events.map(event=>event.id));
    events=events.flatMap(event=>{if(event.payload.type!=='edge-state-change')return [event];const edgeIds=event.payload.edgeIds.filter(id=>!overridden.has(id));return edgeIds.length?[{...event,payload:{...event.payload,edgeIds}}]:[];});
    for(const road of [...settings.roads].sort((a,b)=>compareIdsV2(a.edgeId,b.edgeId))){
      const prefix=`user-road:${hashValue(road.edgeId)}`;let id=prefix,index=0;while(ids.has(id))id=`${prefix}:${++index}`;ids.add(id);
      events.push({id,effectiveAtMs:0,observedAtMs:0,sourceClass:'assumed',sourceRef:'user-specified-setup',payload:{type:'edge-state-change',edgeIds:[road.edgeId],closed:road.closed}});
    }
    events.sort((a,b)=>a.effectiveAtMs-b.effectiveAtMs||compareIdsV2(a.id,b.id));
  }
  const view={resources,facilities,events,behavior:settings.roads.length?null:bundle.assets.behavior,eventTapeHash:settings.roads.length?hashValue(events):bundle.hashes.events};
  cache.set(bundle,view);return view;
}
