import type { GeographicRoadGraph } from '../../model';
import type { CommandIntentV2, CoordinatorObservationV2, KnownNeedV2, PolicyIdV2, PublicHouseholdV2, PublicUnitV2, ResourceSpecificationV2, RoutePlanV2 } from '../contracts';
import { planRouteV2, compareIdsV2 as order } from '../routes';

export interface PolicyChoiceV2 { intent: CommandIntentV2; estimatedCompletionAtMs: number; rule: string; evidenceIds: string[] }
const caches=new WeakMap<GeographicRoadGraph,Map<string,RoutePlanV2|null>>();
function route(view:CoordinatorObservationV2,unit:PublicUnitV2,waypoints:string[]):RoutePlanV2|null{
  if(unit.cursor.kind!=='node')return null;
  let cache=caches.get(view.map);if(!cache){cache=new Map();caches.set(view.map,cache);}
  const key=JSON.stringify([unit.cursor.nodeId,unit.cursor.incoming,waypoints,[...view.knownClosedEdgeIds].sort(order)]);
  if(cache.has(key))return cache.get(key)!;
  const result=planRouteV2(view.map,unit.cursor,waypoints,view.knownClosedEdgeIds);
  if(cache.size>=20_000)cache.clear();cache.set(key,result);return result;
}
const available=(view:CoordinatorObservationV2)=>view.units.filter(unit=>unit.status==='available'&&!unit.missionId&&unit.cursor.kind==='node').sort((a,b)=>order(a.id,b.id));
function chooseTie(a:PolicyChoiceV2,b:PolicyChoiceV2):number{
  return a.estimatedCompletionAtMs-b.estimatedCompletionAtMs||order(a.intent.householdId,b.intent.householdId)||order(a.intent.unitId,b.intent.unitId)||order(a.intent.shelterId??'',b.intent.shelterId??'');
}
function checkChoice(view:CoordinatorObservationV2,units:PublicUnitV2[],r:ResourceSpecificationV2,disruptionOnly=false):PolicyChoiceV2|null{
  const grouped=new Map<string,PublicHouseholdV2>();
  for(const home of view.households){
    if(home.missionId||home.known||home.lastCheckAtMs!==null||disruptionOnly&&home.communicationsAvailable!==false)continue;
    const key=`${home.communicationsAvailable===false?0:1}/${home.homeNodeId}`,old=grouped.get(key);
    if(!old||order(home.id,old.id)<0)grouped.set(key,home);
  }
  let best:PolicyChoiceV2|null=null,bestOutage=Infinity;
  const nodes=new Map(view.map.nodes.map(node=>[node.id,node]));
  for(const unit of units.filter(unit=>unit.capabilities.includes('check'))){
    const metersPerUnit=view.map.metadata.projection.metersPerUnit,speed=view.map.metadata.travelPolicy.assumedSpeedKph*1000/3_600_000;
    const bound=(home:PublicHouseholdV2)=>{const target=nodes.get(home.homeNodeId)!;return Math.hypot(target.x-unit.position.x,target.y-unit.position.y)*metersPerUnit/Math.max(speed,.000001)*.99+r.assessmentMs+view.nowMs;};
    const homes=[...grouped.values()].sort((a,b)=>Number(a.communicationsAvailable!==false)-Number(b.communicationsAvailable!==false)||bound(a)-bound(b)||order(a.id,b.id));
    for(const home of homes){
      const outage=home.communicationsAvailable===false?0:1;
      if(outage>bestOutage)break;
      // A conservative geometric bound avoids exhaustive repeated street searches.
      if(best&&outage===bestOutage&&bound(home)>best.estimatedCompletionAtMs)continue;
      const path=route(view,unit,[home.homeNodeId]);if(!path)continue;
      const choice={intent:{action:'check' as const,unitId:unit.id,householdId:home.id},estimatedCompletionAtMs:view.nowMs+path.durationMs+r.assessmentMs,rule:disruptionOnly?'Coverage: uncontacted home in a public communications disruption':'Check an uncontacted home',evidenceIds:[]};
      if(!best||outage<bestOutage||chooseTie(choice,best)<0){best=choice;bestOutage=outage;}
    }
  }
  return best;
}

/** These policies receive public DTOs and static resource assumptions only. */
export function chooseCommandV2(view:CoordinatorObservationV2,policy:PolicyIdV2,r:ResourceSpecificationV2,coverageFraction=.25,rejectedUnits:ReadonlySet<string>=new Set()):PolicyChoiceV2|null{
  if(view.finalized)return null;
  const units=available(view).filter(unit=>!rejectedUnits.has(unit.id));
  if(!units.length)return null;
  if(policy==='urgency-plus-coverage-v2'){
    const crews=view.units.filter(unit=>unit.capabilities.includes('check')).sort((a,b)=>order(a.id,b.id));
    const reserved=new Set(crews.slice(0,Math.floor(crews.length*coverageFraction+.5)).map(unit=>unit.id));
    const coverage=checkChoice(view,units.filter(unit=>reserved.has(unit.id)),r,true);
    if(coverage)return coverage;
  }
  const needs:{home:PublicHouseholdV2;need:KnownNeedV2;key:number[]}[]=[];
  for(const home of view.households)if(!home.missionId&&home.known)for(const need of home.known.needs)if(need.completedAtMs===null){
    needs.push({home,need,key:policy==='received-order-v2'?[home.known.receivedAtMs]:[need.urgent?0:1,need.deadlineMs]});
  }
  const compareKey=(a:number[],b:number[])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
  needs.sort((a,b)=>compareKey(a.key,b.key)||order(a.need.id,b.need.id));
  let best:PolicyChoiceV2|null=null,group:number[]|null=null;
  for(const {home,need,key} of needs){
    if(best&&group&&compareKey(group,key)!==0)break;
    const action=need.kind==='delivery'?'deliver':'transport';
    for(const unit of units){
      if(!unit.capabilities.includes(action))continue;
      if(action==='deliver'&&view.supply.depotAvailable<1&&unit.carriedBundles===0)continue;
      if(action==='transport'&&(unit.seats<home.known!.size||unit.accessiblePlaces<home.known!.accessiblePlacesRequired))continue;
      const shelters=action==='transport'?view.facilities.filter(f=>f.kind==='shelter'&&f.open&&f.available>=home.known!.size&&(!home.known!.accessiblePlacesRequired||f.accessible)).sort((a,b)=>order(a.id,b.id)):[null];
      for(const shelter of shelters){
        const load=action==='deliver'&&unit.carriedBundles===0;
        if(load&&!view.facilities.some(f=>f.kind==='base'&&f.nodeId===r.depotNodeId&&f.open))continue;
        const path=route(view,unit,[...(load?[r.depotNodeId]:[]),home.homeNodeId,...(shelter?[shelter.nodeId]:[])]);if(!path)continue;
        const choice:PolicyChoiceV2={intent:{action,unitId:unit.id,householdId:home.id,needId:need.id,...(shelter?{shelterId:shelter.id}:{})},estimatedCompletionAtMs:view.nowMs+path.durationMs+(action==='deliver'?r.deliveryMs+(load?r.loadMs:0):r.boardingMs+r.dropoffMs),rule:policy==='received-order-v2'?'Received order, then earliest feasible completion':need.urgent?'Known urgent need, deadline, then earliest feasible completion':'Known need, deadline, then earliest feasible completion',evidenceIds:[need.id,...home.known!.eventIds]};
        if(!best||chooseTie(choice,best)<0){best=choice;group=key;}
      }
    }
  }
  return best??checkChoice(view,units,r);
}
