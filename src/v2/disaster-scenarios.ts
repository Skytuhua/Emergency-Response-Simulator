import { MINUTE_MS, type DisasterScenarioV2, type ScenarioBundleV2, type WorldEventV2 } from './contracts';
import { compareIdsV2 } from './routes';

function scenarioRankV2(seed:number,key:string):number {
  let h=(2166136261 ^ seed)>>>0;
  for(const c of key){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h;
}

export function scenarioReportingHouseholdsV2(bundle:ScenarioBundleV2,scenario:DisasterScenarioV2,events:WorldEventV2[]):string[] {
  if(scenario==='storm')return bundle.behaviorRules.reportingHouseholdIds;
  const homes=events.flatMap(event=>event.payload.type==='need-onset'?[event.payload.need.householdId]:[]);
  return [...new Set(homes)].map(id=>({id,rank:scenarioRankV2(bundle.seed,`${scenario}:report:${id}`)})).sort((a,b)=>a.rank-b.rank||compareIdsV2(a.id,b.id)).slice(0,Math.round(homes.length*.8)).map(item=>item.id);
}

// This v1 recipe is frozen for replay; future changes need a new recipe version.
// These are synthetic exercise assumptions, not flood depths, wind fields, or forecasts.
export function scenarioEventsV2(bundle:ScenarioBundleV2,scenario:DisasterScenarioV2=bundle.setup?.scenario??'storm'):WorldEventV2[] {
  if(scenario==='storm')return bundle.assets.events;
  const homes=bundle.assets.population.households, map=bundle.assets.map;
  const score=(x:number,y:number)=>scenario==='flood'?-y:Math.abs(y/map.height-(0.76-0.42*x/map.width));
  const affected=[...homes].sort((a,b)=>score(a.position.x,a.position.y)-score(b.position.x,b.position.y)||compareIdsV2(a.id,b.id));
  const impacted=affected.slice(0,Math.ceil(homes.length*(scenario==='flood'?0.45:0.28)));
  const rank=(id:string)=>scenarioRankV2(bundle.seed,`${scenario}:${id}`);
  const ordered=impacted.map(home=>({home,rank:rank(home.id)})).sort((a,b)=>a.rank-b.rank||compareIdsV2(a.home.id,b.home.id));
  const needHomes=ordered.slice(0,Math.ceil(homes.length*(scenario==='flood'?0.18:0.13)));
  const subset=(purpose:string,fraction:number)=>new Set(needHomes.map(({home})=>({id:home.id,rank:scenarioRankV2(bundle.seed,`${scenario}:${purpose}:${home.id}`)})).sort((a,b)=>a.rank-b.rank||compareIdsV2(a.id,b.id)).slice(0,Math.round(needHomes.length*fraction)).map(item=>item.id));
  const urgentHomes=subset('urgent',scenario==='flood'?0.4:0.7),relocationHomes=subset('relocation',scenario==='flood'?0.6:0.5);
  const events:WorldEventV2[]=needHomes.map(({home},index)=>{
    const onsetCode=scenarioRankV2(bundle.seed,`${scenario}:onset:${home.id}`);
    const onset=(scenario==='flood'?[0,30,90,150]:[0,10,30,60])[onsetCode%4]*MINUTE_MS;
    const urgent=urgentHomes.has(home.id),kind=relocationHomes.has(home.id)?'relocation':'delivery';
    const need={id:`${scenario}:need:${home.id}`,householdId:home.id,kind,urgent,onsetMs:onset,deadlineMs:onset+(urgent?90:180)*MINUTE_MS} as const;
    return {id:`${scenario}:need-event:${index}:${home.id}`,effectiveAtMs:onset,observedAtMs:null,sourceClass:'assumed',sourceRef:`synthetic-${scenario}-v1`,payload:{type:'need-onset',need}};
  });
  const ids=impacted.map(home=>home.id).sort(compareIdsV2),restored=ids.slice(0,Math.floor(ids.length/2)),remaining=ids.slice(restored.length);
  const comm=(id:string,minute:number,householdIds:string[],available:boolean):WorldEventV2=>({id:`${scenario}:${id}`,effectiveAtMs:minute*MINUTE_MS,observedAtMs:minute*MINUTE_MS,sourceClass:'assumed',sourceRef:`synthetic-${scenario}-v1`,payload:{type:'communications-change',householdIds,available}});
  events.push(comm('communications-loss',0,ids,false),comm('communications-partial',scenario==='flood'?180:90,restored,true),comm('communications-restored',scenario==='flood'?300:180,remaining,true));
  const protectedNodes=new Set([bundle.resources.depotNodeId,...bundle.assets.facilities.map(facility=>facility.nodeId)]);
  const streets=map.edges.filter(edge=>!protectedNodes.has(edge.from)&&!protectedNodes.has(edge.to)).map(edge=>({edge,point:edge.geometry[Math.floor(edge.geometry.length/2)],rank:rank(edge.id)})).filter(item=>item.point)
    .sort((a,b)=>score(a.point.x,a.point.y)-score(b.point.x,b.point.y)||a.rank-b.rank||compareIdsV2(a.edge.id,b.edge.id));
  const pool=streets.slice(0,Math.ceil(streets.length*(scenario==='flood'?0.45:0.28))).sort((a,b)=>a.rank-b.rank||compareIdsV2(a.edge.id,b.edge.id));
  const count=Math.min(pool.length,scenario==='flood'?108:60),selected=pool.slice(0,count).map(item=>item.edge.id),first=Math.ceil(count/3),second=Math.ceil(count*2/3);
  const road=(id:string,minute:number,edgeIds:string[],closed:boolean):WorldEventV2=>({id:`${scenario}:${id}`,effectiveAtMs:minute*MINUTE_MS,observedAtMs:minute*MINUTE_MS,sourceClass:'assumed',sourceRef:`synthetic-${scenario}-v1`,payload:{type:'edge-state-change',edgeIds,closed}});
  if(selected.length){events.push(road('roads-initial',0,selected.slice(0,first),true),road('roads-later',scenario==='flood'?60:10,selected.slice(first,second),true),road('roads-additional',scenario==='flood'?120:30,selected.slice(second),true),road('roads-reopen',scenario==='flood'?300:180,selected.slice(0,first),false));}
  return events.sort((a,b)=>a.effectiveAtMs-b.effectiveAtMs||compareIdsV2(a.id,b.id));
}
