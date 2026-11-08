import type { GeographicRoadGraph } from '../model';
import { ENGINE_V2, HORIZON_MS, MINUTE_MS as M, RECIPE_V2, type BehaviorArtifactV2, type FacilityV2, type GeographyBundleV2, type HouseholdV2, type PopulationBundleV2, type ScenarioBundleV2, type WorldEventV2 } from './contracts';
import { hashValue, seededRank } from './hash';
import { admitDataV2 } from './data-admission';

export interface ScenarioInputsV2 { map: GeographicRoadGraph; population: PopulationBundleV2; geography: GeographyBundleV2; facilities: FacilityV2[] }
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const count = (fraction: number, total: number) => Math.floor(fraction * total + .5);
function ranked<T>(items: readonly T[], seed: number, field: string, id: (item: T) => string): T[] {
  return items.map(item=>({item,id:id(item),rank:seededRank(seed,RECIPE_V2,field,id(item))})).sort((a,b)=>order(a.rank,b.rank)||order(a.id,b.id)).map(row=>row.item);
}
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a,b)=>a+b,0), raw = weights.map(weight => total * weight / sum), values = raw.map(Math.floor);
  const remainder = raw.map((value,index)=>({index,fraction:value-values[index]})).sort((a,b)=>b.fraction-a.fraction || a.index-b.index);
  for(let i=0,left=total-values.reduce((a,b)=>a+b,0);i<left;i++) values[remainder[i].index]++;
  return values;
}
const distance = (a:{lat:number;lon:number}, b:{lat:number;lon:number}) => Math.hypot((a.lat-b.lat)*111_320,(a.lon-b.lon)*111_320*Math.cos(a.lat*Math.PI/180));

export function sealScenarioV2(bundle: Omit<ScenarioBundleV2,'hashes'>): ScenarioBundleV2 {
  return { ...bundle, hashes: {
    map: hashValue(bundle.assets.map), geography: hashValue(bundle.assets.geography), population: hashValue(bundle.assets.population),
    events: hashValue(bundle.assets.events), support: hashValue(bundle.assets.support), facilities: hashValue(bundle.assets.facilities),
    behavior: bundle.assets.behavior ? hashValue(bundle.assets.behavior) : null,
  } };
}

/** Seeded authored disaster assumptions over admitted source-conditioned people. */
export function createScenarioV2(inputs: ScenarioInputsV2, seed = 20261108, behavior: BehaviorArtifactV2 | null = null): ScenarioBundleV2 {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Use a nonnegative safe integer seed.');
  const errors = admitDataV2(inputs.population, inputs.geography, inputs.map);
  if(errors.length) throw new Error(`Population/map admission failed: ${errors.slice(0,4).join('; ')}`);
  const homes = inputs.population.households, target = count(.1, homes.length);
  const tracts = [...new Set(homes.map(home=>home.tractGeoid))].sort(order);
  const groups = tracts.map(tract=>homes.filter(home=>home.tractGeoid===tract));
  const tractCounts = allocate(target,groups.map(group=>group.length));
  const selected = groups.flatMap((group,index)=>ranked(group,seed,'need-household',home=>home.id).slice(0,tractCounts[index]));
  const onsetCounts = allocate(selected.length,[.4,.4,.2]);
  const onsetOrder = ranked(selected,seed,'need-onset',home=>home.id);
  const urgency = new Set(ranked(selected,seed,'need-urgency',home=>home.id).slice(0,count(.3,selected.length)).map(home=>home.id));
  const delivery = new Set(ranked(selected,seed,'need-kind',home=>home.id).slice(0,count(.5,selected.length)).map(home=>home.id));
  const relocation = selected.filter(home=>!delivery.has(home.id));
  const accessible = new Set(ranked(relocation,seed,'support-requirement',home=>home.id).slice(0,count(.1,relocation.length)).map(home=>home.id));
  const support = homes.map(home=>({householdId:home.id,accessiblePlacesRequired:accessible.has(home.id)?1:0,origin:'assumed' as const}));
  const events: WorldEventV2[] = [];
  let offset=0;
  onsetCounts.forEach((size,index)=>{
    const onsetMs=[0,60*M,120*M][index];
    for(const home of onsetOrder.slice(offset,offset+size)) events.push({id:`need:${home.id}`,effectiveAtMs:onsetMs,observedAtMs:null,sourceClass:'assumed',sourceRef:RECIPE_V2,
      payload:{type:'need-onset',need:{id:`N:${home.id}`,householdId:home.id,kind:delivery.has(home.id)?'delivery':'relocation',urgent:urgency.has(home.id),onsetMs,deadlineMs:onsetMs+(urgency.has(home.id)?90:180)*M}}});
    offset+=size;
  });
  // Spatial masks depend on geography and seed, never on private need assignment.
  const center = ranked(homes,seed,'communications-center',home=>home.id)[0].position;
  const outageHomes = [...homes].sort((a,b)=>distance(a.position,center)-distance(b.position,center)||order(a.id,b.id)).slice(0,count(.2,homes.length));
  const comms=(id:string,at:number,ids:HouseholdV2[],available:boolean)=>events.push({id,effectiveAtMs:at,observedAtMs:at,sourceClass:'assumed',sourceRef:RECIPE_V2,payload:{type:'communications-change',householdIds:ids.map(home=>home.id),available}});
  comms('communications:loss',0,outageHomes,false);
  comms('communications:partial-restoration',120*M,outageHomes.slice(0,Math.floor(outageHomes.length/2)),true);
  comms('communications:restoration',240*M,outageHomes.slice(Math.floor(outageHomes.length/2)),true);
  const roadCenter = ranked(homes,seed,'road-disruption-center',home=>home.id)[0].position;
  const nodes = new Map(inputs.map.nodes.map(node=>[node.id,node]));
  const eligible = inputs.map.edges.filter(edge=>inputs.facilities.every(facility=>{
    const from=nodes.get(edge.from)!,to=nodes.get(edge.to)!;
    return Math.min(distance({lat:from.lat!,lon:from.lon!},facility.position),distance({lat:to.lat!,lon:to.lon!},facility.position))>150;
  }));
  eligible.sort((a,b)=>{
    const midpoint=(edge:typeof a)=>{const x=nodes.get(edge.from)!,y=nodes.get(edge.to)!;return {lat:(x.lat!+y.lat!)/2,lon:(x.lon!+y.lon!)/2};};
    return distance(midpoint(a),roadCenter)-distance(midpoint(b),roadCenter)||order(a.id,b.id);
  });
  const totalLength=inputs.map.edges.reduce((sum,edge)=>sum+edge.lengthMeters,0), closures:string[]=[];
  let closedLength=0;
  for(const edge of eligible){if(closedLength>=totalLength*.05)break;closures.push(edge.id);closedLength+=edge.lengthMeters;}
  const closureGroups=[closures.filter((_,i)=>i%3===0),closures.filter((_,i)=>i%3===1),closures.filter((_,i)=>i%3===2)];
  closureGroups.forEach((edgeIds,index)=>events.push({id:`roads:closure:${index}`,effectiveAtMs:[0,30*M,120*M][index],observedAtMs:[0,90*M,150*M][index],sourceClass:'assumed',sourceRef:RECIPE_V2,payload:{type:'edge-state-change',edgeIds,closed:true}}));
  events.push({id:'roads:partial-reopening',effectiveAtMs:240*M,observedAtMs:240*M,sourceClass:'assumed',sourceRef:RECIPE_V2,payload:{type:'edge-state-change',edgeIds:closureGroups[0],closed:false}});
  events.sort((a,b)=>a.effectiveAtMs-b.effectiveAtMs||order(a.id,b.id));
  const base=inputs.facilities.find(facility=>facility.kind==='base');
  if(!base)throw new Error('A declared synthetic base is required.');
  return sealScenarioV2({kind:'catastrophe-scenario',version:2,engineVersion:ENGINE_V2,recipeVersion:RECIPE_V2,seed,horizonMs:HORIZON_MS,populationMode:inputs.population.mode,
    assets:{map:inputs.map,geography:inputs.geography,population:inputs.population,events,support,facilities:inputs.facilities,behavior},
    resources:{units:[...Array.from({length:4},(_,i)=>({id:`C${i+1}`,kind:'crew' as const,capabilities:['check','deliver'] as ('check'|'deliver')[],seats:0,accessiblePlaces:0,baseNodeId:base.nodeId})),...Array.from({length:4},(_,i)=>({id:`V${i+1}`,kind:'van' as const,capabilities:['transport','pickup-verification'] as ('transport'|'pickup-verification')[],seats:6,accessiblePlaces:i<2?1:0,baseNodeId:base.nodeId}))],supplyBundles:250,depotNodeId:base.nodeId,loadMs:2*M,assessmentMs:10*M,deliveryMs:10*M,boardingMs:10*M,dropoffMs:10*M},
    behaviorRules:{reportDelayMs:20*M,retryMs:30*M,reportingHouseholdIds:ranked(selected,seed,'background-reporting',home=>home.id).slice(0,count(.8,selected.length)).map(home=>home.id)},
    assumptions:[
      'Census-conditioned synthetic occupied households; aggregate point estimates and margins of error, not real resident identities.',
      '10% need households; 40/40/20% onset at minutes 0/60/120; 30% urgent; 50% supply/transport; onset-relative 90/180-minute targets.',
      '10% of relocation households require one accessible place, independently authored rather than inferred from disability.',
      '80% background reporting at onset+20, retry every30; direct actors use exact prepared contexts only.',
      `Spatial communications loss initially affects ${outageHomes.length} homes; halves restore at120/240. Synthetic, not an observed outage.`,
      `Synthetic road closures select ${(closedLength/totalLength*100).toFixed(3)}% of retained centerline length; safe staging approaches within150m excluded. New closures at0/30/120, announcements at0/90/150, partial reopening240.`,
      'Four check/delivery crews, four six-place vans (two with one included accessible place),250 household bundles,300 shelter places are synthetic capacities.',
      'Bundles begin at the synthetic depot; crews carry at most one and load for2min. Check/delivery/boarding/dropoff each10min. No split households or rescue of stranded units.',
      'Historical2022 Dallas flooding is context only; no hydraulic, behavior or response calibration is claimed.',
    ],
  });
}
export function reseedScenarioV2(bundle: ScenarioBundleV2, seed: number): ScenarioBundleV2 {
  // First paired-seed experiment uses the same explicit background model in all runs.
  return createScenarioV2({map:bundle.assets.map,population:bundle.assets.population,geography:bundle.assets.geography,facilities:bundle.assets.facilities},seed,null);
}
