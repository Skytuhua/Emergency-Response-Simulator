import type { HouseholdStatus, Mission, ObservationView, ObservedHousehold } from '../../model';
import { MINUTE_MS, type CoordinatorObservationV2, type PublicHouseholdV2, type PublicMissionV2 } from '../../v2/contracts';
import { xyToLatLng } from '../geographic';
import type { MapViewport,ResponseBaseMarker } from '../TownMap';
import { createHomeLabelsV2, homeLabelV2 } from './home-labels';

export interface MapFeatureV2 {
  id: string;
  kind: 'household' | 'cluster';
  householdIds: string[];
  homeCount: number;
  /** Public-known count; never the private population count. */
  knownPeopleCount: number;
  x: number; y: number;
  label: string;
}
export interface MapSceneV2 {
  view: ObservationView;
  features: MapFeatureV2[];
  totalHomes: number;
  /** Global groups retain all members; only visibleFeatures enter the DOM. */
  visibleFeatures: MapFeatureV2[];
  visibleHomes: number;
  hiddenHomes: number;
  selectedFeatureId: string | null;
  householdLabels: Record<string, string>;
  householdTitles: Record<string, string>;
  householdCounts: Record<string, number>;
  homeLabels: ReadonlyMap<string,string>;
  responseBase:ResponseBaseMarker|null;
  unitStates: Record<string, { x: number; y: number; label: string }>;
}
export function publicHomeStatusV2(home: PublicHouseholdV2): HouseholdStatus {
  const needs = home.known?.needs ?? [];
  if (needs.length && needs.every(need => need.completedAtMs !== null)) return 'assisted';
  if (home.missionId) return 'assigned';
  if (needs.some(need => need.completedAtMs === null)) return 'reported';
  return home.lastCheckAtMs !== null ? 'assessed' : 'unknown';
}
export function homeStatusLabelV2(home: PublicHouseholdV2): string {
  const status = publicHomeStatusV2(home);
  return status === 'assisted' ? 'Help completed' : status === 'assigned' ? 'Team assigned'
    : status === 'reported' ? 'Waiting for help' : status === 'assessed' ? 'Checked; no need currently known' : 'Needs not yet known';
}
function observedHome(home: PublicHouseholdV2, map: CoordinatorObservationV2['map'], label:string): ObservedHousehold {
  const needs = [...(home.known?.needs ?? [])].sort((a,b) => Number(b.urgent)-Number(a.urgent) || a.deadlineMs-b.deadlineMs);
  const need = needs.find(item => item.completedAtMs === null) ?? needs[0];
  const status = publicHomeStatusV2(home);
  return {
    id: `household:${home.id}`, name: label, address: 'Simulated home', nodeId: home.homeNodeId,
    x: home.position.x, y: home.position.y,
    // Legacy quadrants are renderer metadata, not a v2 geographic claim.
    neighborhood: `${home.position.y < map.height/2 ? 'north' : 'south'}${home.position.x < map.width/2 ? 'west' : 'east'}`,
    // Exact tri-state remains in the DTO/list; no legacy outage overlay is drawn.
    communications: home.communicationsAvailable !== false, status,
    known: home.known ? { size: home.known.size, accessible: home.known.accessiblePlacesRequired > 0, consent: true,
      observedAt: home.known.observedAtMs/MINUTE_MS, receivedAt: home.known.receivedAtMs/MINUTE_MS,
      source: home.known.source === 'check' ? 'assessment' : 'rule-based', requestText: home.known.text,
      need: need ? { id:need.id, kind:need.kind, urgent:need.urgent, onset:need.onsetMs/MINUTE_MS, deadline:need.deadlineMs/MINUTE_MS } : null } : null,
    contactedAt: home.lastContactAtMs === null ? null : home.lastContactAtMs/MINUTE_MS,
    assessedAt: home.lastCheckAtMs === null ? null : home.lastCheckAtMs/MINUTE_MS,
    completedAt: status === 'assisted' ? Math.max(...needs.map(item => item.completedAtMs!))/MINUTE_MS : null,
    missionId: home.missionId,
  };
}
function missionForRenderer(mission: PublicMissionV2, nowMs: number): Mission {
  const legs = mission.route.legs.map(leg => ({ from:leg.fromNodeId, to:leg.toNodeId, edgeId:leg.edgeId, minutes:leg.durationMs/MINUTE_MS, durationMs:leg.durationMs }));
  return { id:mission.id, unitId:mission.unitId, householdId:`household:${mission.householdId}`,
    action:mission.action === 'check' ? 'ASSESS' : mission.action === 'deliver' ? 'DELIVER' : 'RELOCATE',
    ...(mission.shelterId ? { shelterId:mission.shelterId } : {}), dispatchedAt:mission.dispatchedAtMs/MINUTE_MS,
    // Renderer consumes geometry only; exact v2 cursor positions are supplied separately.
    arrivalAt:nowMs/MINUTE_MS, pickupAt:null, completionAt:(mission.completedAtMs ?? mission.estimatedCompletionAtMs ?? nowMs)/MINUTE_MS,
    route:{ nodes:legs.length ? [legs[0].from,...legs.map(leg=>leg.to)] : [], legs, minutes:mission.route.durationMs/MINUTE_MS, durationMs:mission.route.durationMs },
    shelterRoute:null, status:mission.status === 'completed' ? 'completed' : mission.status === 'boarding' ? 'boarding' : mission.status === 'transporting' || mission.status === 'dropoff' ? 'transporting' : 'traveling' };
}

/** Explicit renderer compatibility. No private world, future tape, needs or closures enter here. */
export function adaptMapV2(observation: CoordinatorObservationV2, selected: string | null = null, viewport: MapViewport | null = null): MapSceneV2 {
  const homeLabels=createHomeLabelsV2(observation.households);
  const closed = new Set(observation.knownClosedEdgeIds);
  const map = { ...observation.map, edges:observation.map.edges.map(edge=>({ ...edge, closed:closed.has(edge.id) })) };
  const groups = new Map<string, PublicHouseholdV2[]>();
  const aggregate = observation.households.length > 150;
  // Fixed world-pixel bins keep the geographic scale. Panning changes
  // visibility, never membership or IDs; closer zoom allows more detail.
  const level = Math.max(0, Math.floor(viewport?.zoom ?? 13));
  const scale = 256 * 2 ** level;
  const project = (lat: number, lon: number) => ({
    x: (lon + 180) / 360 * scale,
    y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale,
  });
  const cell = 48;
  for (const home of observation.households) {
    const [lat, lon] = xyToLatLng(map, home.position), point = project(lat, lon);
    const id = !aggregate || home.id === selected ? `household:${home.id}` : `cluster:${level}:${Math.floor(point.x/cell)}:${Math.floor(point.y/cell)}`;
    const members=groups.get(id) ?? []; members.push(home); groups.set(id,members);
  }
  const positionedGroups=[...groups].map(([id,members])=>{
    const x=members.reduce((sum,home)=>sum+home.position.x,0)/members.length;
    const y=members.reduce((sum,home)=>sum+home.position.y,0)/members.length;
    const [lat,lon]=xyToLatLng(map,{x,y});
    return {id,members,x,y,point:project(lat,lon)};
  });
  let markerGroups=positionedGroups;
  if(aggregate){
    // Neighboring bin centroids can be almost coincident. Merge those groups
    // into the larger group's existing anchor, keeping the count inside a
    // readable house. Anchors depend only on public positions and zoom.
    const spacing=52, anchors:typeof positionedGroups=[];
    const buckets=new Map<string,typeof positionedGroups>();
    const candidates=positionedGroups.filter(group=>group.id!==`household:${selected}`)
      .sort((a,b)=>b.members.length-a.members.length||a.id.localeCompare(b.id));
    for(const candidate of candidates){
      const gx=Math.floor(candidate.point.x/spacing),gy=Math.floor(candidate.point.y/spacing);
      let neighbor:typeof candidate|undefined;
      for(let dx=-1;dx<=1&&!neighbor;dx++)for(let dy=-1;dy<=1&&!neighbor;dy++){
        neighbor=buckets.get(`${gx+dx}:${gy+dy}`)?.find(anchor=>Math.abs(anchor.point.x-candidate.point.x)<spacing&&Math.abs(anchor.point.y-candidate.point.y)<spacing);
      }
      if(neighbor)neighbor.members.push(...candidate.members);
      else {anchors.push(candidate);const key=`${gx}:${gy}`,bucket=buckets.get(key)??[];bucket.push(candidate);buckets.set(key,bucket);}
    }
    const selectedGroups=positionedGroups.filter(group=>group.id===`household:${selected}`), selectedPoint=selectedGroups[0]?.point;
    if(selectedPoint)for(const anchor of anchors){
      if(Math.abs(anchor.point.x-selectedPoint.x)>=spacing||Math.abs(anchor.point.y-selectedPoint.y)>=spacing)continue;
      // Keep the selected home at its exact position. A neighboring group may
      // use another actual member's position when its original anchor covers it.
      const alternative=anchor.members.map(home=>{
        const [lat,lon]=xyToLatLng(map,home.position);return {home,point:project(lat,lon)};
      }).filter(candidate=>(Math.abs(candidate.point.x-selectedPoint.x)>=spacing||Math.abs(candidate.point.y-selectedPoint.y)>=spacing)
        &&anchors.every(other=>other===anchor||Math.abs(candidate.point.x-other.point.x)>=spacing||Math.abs(candidate.point.y-other.point.y)>=spacing))
        .sort((a,b)=>Math.hypot(a.point.x-anchor.point.x,a.point.y-anchor.point.y)-Math.hypot(b.point.x-anchor.point.x,b.point.y-anchor.point.y)||a.home.id.localeCompare(b.home.id))[0];
      if(alternative){anchor.x=alternative.home.position.x;anchor.y=alternative.home.position.y;anchor.point=alternative.point;}
    }
    markerGroups=[...anchors,...selectedGroups];
  }
  const features: MapFeatureV2[] = [], households: ObservedHousehold[] = [];
  const householdLabels: Record<string,string> = {};
  const householdCounts: Record<string,number> = {};
  for (const {id:groupId,members,x,y} of markerGroups) {
    const single=members.length===1, id=single?`household:${members[0].id}`:groupId;
    const waiting=members.filter(home=>(home.known?.needs??[]).some(need=>need.completedAtMs===null)).length;
    const unchecked=members.filter(home=>home.lastCheckAtMs===null).length;
    const completed=members.filter(home=>publicHomeStatusV2(home)==='assisted').length;
    const label=single ? `${homeLabelV2(homeLabels,members[0].id)} · ${homeStatusLabelV2(members[0])}` : `${members.length} homes · ${waiting} waiting for help · ${unchecked} not checked · ${completed} help completed`;
    features.push({id,kind:single?'household':'cluster',householdIds:members.map(home=>home.id),homeCount:members.length,
      knownPeopleCount:members.reduce((sum,home)=>sum+(home.known?.size??0),0),x,y,label});
    householdLabels[id]=single ? homeLabelV2(homeLabels,members[0].id) : `${members.length} homes`;
    householdCounts[id]=members.length;
    if(single) households.push(observedHome(members[0],map,homeLabelV2(homeLabels,members[0].id)));
    else households.push({id,name:label,address:'Grouped simulated homes',nodeId:members[0].homeNodeId,x,y,
      neighborhood:'northwest',communications:true,status:members.every(home=>publicHomeStatusV2(home)===publicHomeStatusV2(members[0]))?publicHomeStatusV2(members[0]):'unknown',
      known:null,contactedAt:null,assessedAt:null,completedAt:null,missionId:null});
  }
  const selectedHome=selected?observation.households.find(home=>home.id===selected):undefined;
  const selectedLatLng=selectedHome?xyToLatLng(map,selectedHome.position):null;
  const selectedPoint=selectedLatLng?project(...selectedLatLng):null;
  const visible = (feature: MapFeatureV2) => {
    if (!viewport) return true;
    const [lat, lon] = xyToLatLng(map, feature);
    const point = project(lat, lon), northwest = project(viewport.bounds.north, viewport.bounds.west), southeast = project(viewport.bounds.south, viewport.bounds.east);
    // Exactly colocated homes cannot draw separate readable hit targets. Keep
    // that group's complete membership globally and in Find a home; the exact
    // selected home takes priority until another public group anchor is clear.
    if(aggregate&&selectedPoint&&feature.kind==='cluster'&&Math.abs(point.x-selectedPoint.x)<52&&Math.abs(point.y-selectedPoint.y)<52)return false;
    // Keep edge hit targets until their full marker leaves the clipped scene.
    const padding = 24 / 2 ** (viewport.zoom-level);
    return point.x >= northwest.x-padding && point.x <= southeast.x+padding && point.y >= northwest.y-padding && point.y <= southeast.y+padding;
  };
  const visibleFeatures = features.filter(visible), visibleIds = new Set(visibleFeatures.map(feature=>feature.id));
  const visibleHomes = visibleFeatures.reduce((sum,feature)=>sum+feature.homeCount,0);
  const unitLabels={available:'Available',working:'On a task',blocked:'Unable to continue',stranded:'Stranded'};
  const unitStates=Object.fromEntries(observation.units.map(unit=>[unit.id,{x:unit.position.x,y:unit.position.y,
    label:`${unit.id}: ${unitLabels[unit.status]} · ${unit.passengers} passengers · ${unit.carriedBundles} supply bundles`} ]));
  const view: ObservationView = { runId:`v2-map:${observation.map.metadata.datasetId}`,minute:observation.nowMs/MINUTE_MS,
    finalized:observation.finalized,map,households:households.filter(home=>visibleIds.has(home.id)),
    units:observation.units.map(unit=>({ id:unit.id,name:unit.id,kind:unit.kind,accessible:unit.accessiblePlaces>0,seats:unit.seats,
      nodeId:unit.cursor.kind==='node'?unit.cursor.nodeId:unit.cursor.arc.fromNodeId,x:unit.position.x,y:unit.position.y,
      missionId:unit.missionId,passengers:unit.passengers,busyMinutes:unit.busyMs/MINUTE_MS })),
    shelters:observation.facilities.filter(facility=>facility.kind==='shelter').map(facility=>({ id:facility.id,
      name:`${facility.name}${facility.open?'':' · closed'}`,nodeId:facility.nodeId,x:facility.position.x,y:facility.position.y,
      accessible:facility.accessible,capacity:facility.capacity,reserved:facility.reserved,occupied:facility.occupied,available:facility.available })),
    kits:{initial:observation.supply.initial,available:observation.supply.depotAvailable,reserved:observation.supply.reserved,consumed:observation.supply.delivered},
    missions:observation.missions.filter(mission=>mission.status!=='blocked'&&mission.status!=='stranded').map(mission=>missionForRenderer(mission,observation.nowMs)),
    events:[],networkGap:'none',requests:households.filter(home=>home.status==='reported'),
    contactCount:observation.households.filter(home=>home.lastContactAtMs!==null).length,
    assessedCount:observation.households.filter(home=>home.lastCheckAtMs!==null).length,
    assistedCount:observation.households.filter(home=>publicHomeStatusV2(home)==='assisted').length,
  };
  const householdTitles=Object.fromEntries(features.map(feature=>[feature.id,feature.label]));
  const base=observation.facilities.find(facility=>facility.kind==='base');
  const responseBase=base?{nodeId:base.nodeId,x:base.position.x,y:base.position.y,label:'Response base'}:null;
  return {view,features,visibleFeatures,visibleHomes,hiddenHomes:observation.households.length-visibleHomes,totalHomes:observation.households.length,selectedFeatureId:selected?`household:${selected}`:null,householdLabels,householdTitles,householdCounts,homeLabels,unitStates,responseBase};
}
