import { ENGINE_V2, HORIZON_MS, RECIPE_V2, type ScenarioBundleV2 } from './contracts';
import { canonical, hashValue } from './hash';
import { admitDataV2 } from './data-admission';
import { admitBehaviorV2 } from './behavior-admission';
import approvedData from '../../fixtures/v2/sources/data-assets-v2.json';
import type { GeographicRoadGraph } from '../model';
import { validateSetupV2 } from './setup';

export function admitMapV2(map:GeographicRoadGraph):string[]{
  const errors:string[]=[],nodes=new Map(map.nodes.map(node=>[node.id,node])),edgeIds=new Set<string>(),ways=new Set<number>();
  const metadata=map.metadata;
  if(map.kind!=='osm-driving'||!metadata||!metadata.projection||!metadata.travelPolicy||!metadata.bounds
    ||![metadata.projection.originLat,metadata.projection.originLon,metadata.projection.earthRadiusMeters,metadata.projection.metersPerUnit,metadata.travelPolicy.assumedSpeedKph,...Object.values(metadata.bounds)].every(Number.isFinite)
    ||metadata.projection.metersPerUnit<=0||metadata.projection.earthRadiusMeters<=0||metadata.travelPolicy.assumedSpeedKph<=0)errors.push('Invalid geographic projection, bounds or travel policy.');
  if(nodes.size!==map.nodes.length||!Number.isFinite(map.width)||map.width<=0||!Number.isFinite(map.height)||map.height<=0)errors.push('Invalid map dimensions or duplicate nodes.');
  for(const node of map.nodes)if(!node.id||![node.x,node.y,node.lat,node.lon].every(x=>typeof x==='number'&&Number.isFinite(x))||Math.abs(node.lat!)>90||Math.abs(node.lon!)>180)errors.push('Invalid geographic node.');
  for(const edge of map.edges){
    if(edgeIds.has(edge.id)||!nodes.has(edge.from)||!nodes.has(edge.to)||edge.from===edge.to||!Number.isSafeInteger(edge.durationMs)||edge.durationMs<=0||!Number.isFinite(edge.lengthMeters)||edge.lengthMeters<=0||!['both','forward','reverse'].includes(edge.direction)||!Number.isSafeInteger(edge.osmWayId)||!Array.isArray(edge.geometry)||edge.geometry.length<2)errors.push('Invalid map edge topology, direction or cost.');
    edgeIds.add(edge.id);ways.add(edge.osmWayId);
    for(const p of edge.geometry??[])if(![p.x,p.y,p.lat,p.lon].every(Number.isFinite)||Math.abs(p.lat)>90||Math.abs(p.lon)>180)errors.push('Invalid road geometry.');
    const from=nodes.get(edge.from),to=nodes.get(edge.to),a=edge.geometry?.[0],b=edge.geometry?.at(-1);
    if(from&&to&&a&&b&&(Math.abs(a.lat-from.lat!)>1e-7||Math.abs(a.lon-from.lon!)>1e-7||Math.abs(b.lat-to.lat!)>1e-7||Math.abs(b.lon-to.lon!)>1e-7))errors.push('Road geometry endpoints differ from topology.');
  }
  const restrictions=new Set<string>();
  for(const r of map.restrictions){if(restrictions.has(r.id)||!['no','only'].includes(r.kind)||!nodes.has(r.viaNodeId)||!ways.has(r.fromWayId)||!ways.has(r.toWayId)||!r.maneuver)errors.push('Invalid map turn restriction.');restrictions.add(r.id);}
  return [...new Set(errors)];
}

export const MAX_V2_BYTES = 32 * 1024 * 1024;
export function boundedJson(text: string): unknown {
  if(new TextEncoder().encode(text).length>MAX_V2_BYTES)throw new Error('V2 data exceeds32MiB.');
  let nodes=0;
  const value=JSON.parse(text);
  const check=(item:unknown,depth:number)=>{
    if(++nodes>1_000_000||depth>40)throw new Error('V2 data structure exceeds supported limits.');
    if(typeof item==='string'&&item.length>262_144)throw new Error('V2 text exceeds supported limits.');
    if(Array.isArray(item)){if(item.length>100_000)throw new Error('V2 array exceeds supported limits.');for(const x of item)check(x,depth+1);}
    else if(item&&typeof item==='object')for(const x of Object.values(item))check(x,depth+1);
  };
  check(value,0);return value;
}
export function admitScenarioV2(input: unknown): string[] {
  const errors:string[]=[];
  try{
    const b=input as ScenarioBundleV2;
    if(!b||b.kind!=='catastrophe-scenario'||b.version!==2||b.engineVersion!==ENGINE_V2||b.recipeVersion!==RECIPE_V2||b.horizonMs!==HORIZON_MS)return ['Unsupported v2 scenario/engine/recipe/horizon.'];
    canonical(b);
    if(!Number.isSafeInteger(b.seed)||b.seed<0)errors.push('Invalid scenario seed.');
    errors.push(...admitDataV2(b.assets.population,b.assets.geography,b.assets.map));
    errors.push(...admitMapV2(b.assets.map));
    if(b.populationMode!==b.assets.population.mode)errors.push('Population mode differs.');
    for(const key of ['map','geography','population','events','support','facilities','behavior'] as const){
      const expected=b.assets[key]===null?null:hashValue(b.assets[key]);if(b.hashes[key]!==expected)errors.push(`Asset hash differs: ${key}.`);
    }
    // Full-tract source claims belong only to the independently reviewed release
    // assets. Rehashing altered populations or streets cannot inherit provenance.
    if(b.populationMode==='full-tract'){
      const paths={map:'maps/dallas-roads-v2.json',geography:'geography/dallas-geography-v2.json',population:'population/dallas-population-v2.json',facilities:'maps/facilities-v2.json'} as const;
      for(const key of Object.keys(paths) as (keyof typeof paths)[])if(b.hashes[key]!==approvedData.assets[paths[key]].sha256)errors.push(`Unapproved source-conditioned ${key} asset.`);
    }
    const homes=new Set(b.assets.population.households.map(home=>home.id)),nodes=new Set(b.assets.map.nodes.map(node=>node.id)),edges=new Set(b.assets.map.edges.map(edge=>edge.id));
    const supports=new Set<string>();
    for(const s of b.assets.support){if(!homes.has(s.householdId)||supports.has(s.householdId)||!Number.isSafeInteger(s.accessiblePlacesRequired)||s.accessiblePlacesRequired<0||s.accessiblePlacesRequired>20||s.origin!=='assumed')errors.push('Invalid support requirement.');supports.add(s.householdId);}
    if(supports.size!==homes.size)errors.push('Missing support requirements.');
    const facilityIds=new Set<string>();
    for(const f of b.assets.facilities){if(facilityIds.has(f.id)||!nodes.has(f.nodeId)||f.synthetic!==true||!['base','shelter'].includes(f.kind)||!Number.isSafeInteger(f.capacity)||f.capacity<0||!Number.isSafeInteger(f.opensAtMs)||f.opensAtMs<0||f.opensAtMs>HORIZON_MS)errors.push('Invalid synthetic facility.');facilityIds.add(f.id);}
    if(!b.assets.facilities.some(f=>f.kind==='base'&&f.nodeId===b.resources.depotNodeId))errors.push('Missing declared supply depot.');
    const eventIds=new Set<string>(),needIds=new Set<string>();let previous=-1;
    for(const e of b.assets.events){
      if(eventIds.has(e.id)||!Number.isSafeInteger(e.effectiveAtMs)||e.effectiveAtMs<previous||e.effectiveAtMs<0||e.effectiveAtMs>HORIZON_MS||e.observedAtMs!==null&&(!Number.isSafeInteger(e.observedAtMs)||e.observedAtMs<e.effectiveAtMs||e.observedAtMs>HORIZON_MS))errors.push('Invalid ordered event tape.');
      previous=e.effectiveAtMs;eventIds.add(e.id);const p=e.payload;
      if(p.type==='need-onset'){const n=p.need;if(needIds.has(n.id)||!homes.has(n.householdId)||!['delivery','relocation'].includes(n.kind)||typeof n.urgent!=='boolean'||n.onsetMs!==e.effectiveAtMs||!Number.isSafeInteger(n.deadlineMs)||n.deadlineMs<n.onsetMs)errors.push('Invalid need definition.');needIds.add(n.id);}
      else if(p.type==='communications-change'){if(typeof p.available!=='boolean'||p.householdIds.some(id=>!homes.has(id)))errors.push('Invalid communications event.');}
      else if(p.type==='edge-state-change'){if(typeof p.closed!=='boolean'||p.edgeIds.some(id=>!edges.has(id)))errors.push('Invalid road event.');}
      else if(p.type==='facility-state-change'){if(!facilityIds.has(p.facilityId)||typeof p.open!=='boolean')errors.push('Invalid facility event.');}
      else errors.push('Unsupported world event.');
    }
    const ids=new Set<string>();
    for(const u of b.resources.units){if(ids.has(u.id)||!nodes.has(u.baseNodeId)||!['crew','van'].includes(u.kind)||!Number.isSafeInteger(u.seats)||u.seats<0||!Number.isSafeInteger(u.accessiblePlaces)||u.accessiblePlaces<0||u.accessiblePlaces>u.seats||u.capabilities.some(c=>!['check','deliver','transport','pickup-verification'].includes(c)))errors.push('Invalid response unit.');ids.add(u.id);}
    for(const key of ['loadMs','assessmentMs','deliveryMs','boardingMs','dropoffMs'] as const)if(!Number.isSafeInteger(b.resources[key])||b.resources[key]<=0||b.resources[key]>HORIZON_MS)errors.push('Invalid service duration.');
    if(!Number.isSafeInteger(b.resources.supplyBundles)||b.resources.supplyBundles<0||b.resources.supplyBundles>100_000)errors.push('Invalid supply count.');
    if(!Number.isSafeInteger(b.behaviorRules.reportDelayMs)||b.behaviorRules.reportDelayMs<0||!Number.isSafeInteger(b.behaviorRules.retryMs)||b.behaviorRules.retryMs<=0||b.behaviorRules.reportingHouseholdIds.some(id=>!homes.has(id)))errors.push('Invalid reporting rules.');
    errors.push(...admitBehaviorV2(b).errors);
    // Setup base checks search the graph; only run them after source admission.
    if(!errors.length&&Object.hasOwn(b,'setup'))errors.push(...validateSetupV2(b,b.setup));
  }catch(cause){errors.push(`Malformed v2 scenario: ${cause instanceof Error?cause.message:'invalid structure'}`);}
  return [...new Set(errors)];
}
export function parseScenarioV2(text:string):ScenarioBundleV2{
  const value=boundedJson(text),errors=admitScenarioV2(value);if(errors.length)throw new Error(errors.slice(0,5).join(' '));return value as ScenarioBundleV2;
}
