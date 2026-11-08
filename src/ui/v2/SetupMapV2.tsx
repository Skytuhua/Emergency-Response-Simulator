import { useId,useMemo,useState } from 'react';
import type { ScenarioBundleV2,SetupOverlayV2 } from '../../v2/contracts';
import type { ObservationView } from '../../model';
import { baseSnapDistanceMetersV2,initialClosedEdgeIdsV2 } from '../../v2/setup-topology';
import { TownMap,type ResponseBaseMarker } from '../TownMap';
import { SecondaryPanel } from '../SecondaryPanel';
import './setup-map.css';

export interface SetupMapV2Props {
  bundle:ScenarioBundleV2; setup:SetupOverlayV2; mode:'base'|'roads';
  onBasePick:(point:{lat:number;lon:number})=>void; onRoadToggle:(edgeId:string)=>void;
  baseBusy?:boolean; message?:string;
}

export function SetupMapV2({bundle,setup,mode,onBasePick,onRoadToggle,baseBusy=false,message}:SetupMapV2Props){
  const [query,setQuery]=useState(''),[page,setPage]=useState(0),[blockedOnly,setBlockedOnly]=useState(false),[selectedRoadId,setSelectedRoadId]=useState<string|null>(null);
  const [streetBrowserOpen,setStreetBrowserOpen]=useState(false);
  const id=useId();
  const closed=useMemo(()=>new Set(initialClosedEdgeIdsV2(bundle,setup.roads,setup.scenario)),[bundle,setup.roads,setup.scenario]);
  const overrides=useMemo(()=>Object.fromEntries(setup.roads.map(road=>[road.edgeId,road.closed])),[setup.roads]);
  const map=useMemo(()=>({...bundle.assets.map,edges:bundle.assets.map.edges.map(edge=>({...edge,closed:closed.has(edge.id)}))}),[bundle.assets.map,closed]);
  const sourceBase=bundle.assets.facilities.find(facility=>facility.kind==='base');
  const baseNodeId=setup.base?.nodeId??sourceBase?.nodeId;
  const node=bundle.assets.map.nodes.find(point=>point.id===baseNodeId);
  const base=useMemo<ResponseBaseMarker|null>(()=>node?{nodeId:node.id,x:node.x,y:node.y,label:'Response base'}:null,[node]);
  const actual=node&&Number.isFinite(node.lat)&&Number.isFinite(node.lon)?{lat:node.lat!,lon:node.lon!}:null;
  const requested=setup.base?.requested??null;
  const distance=requested&&actual?baseSnapDistanceMetersV2(requested,actual,map.metadata.projection.earthRadiusMeters):null;
  const view=useMemo<ObservationView>(()=>({
    runId:`setup-map:${bundle.hashes.map}`,minute:0,finalized:false,map,households:[],units:[],missions:[],events:[],requests:[],networkGap:'none',
    contactCount:0,assessedCount:0,assistedCount:0,
    kits:{initial:setup.resources.supplyBundles,available:setup.resources.supplyBundles,reserved:0,consumed:0},
    shelters:bundle.assets.facilities.filter(facility=>facility.kind==='shelter').map(facility=>{
      const capacity=setup.resources.shelterPlaces.find(item=>item.facilityId===facility.id)?.places??facility.capacity;
      return {id:facility.id,name:facility.name,nodeId:facility.nodeId,x:facility.position.x,y:facility.position.y,accessible:facility.accessible,capacity,reserved:0,occupied:0,available:capacity};
    }),
  }),[bundle,map,setup.resources]);
  const roads=useMemo(()=>[...bundle.assets.map.edges].sort((a,b)=>a.id.localeCompare(b.id)).map((edge,index)=>({
    edge,label:`${edge.name||'Unnamed street'}, segment ${String(index+1).padStart(4,'0')}`,
  })).sort((a,b)=>a.label.localeCompare(b.label)),[bundle.assets.map.edges]);
  const filtered=useMemo(()=>roads.filter(road=>(!blockedOnly||closed.has(road.edge.id))&&road.label.toLowerCase().includes(query.trim().toLowerCase())),[roads,blockedOnly,closed,query]);
  const chooseRoad=(edgeId:string)=>{setSelectedRoadId(edgeId);onRoadToggle(edgeId);};
  const count=8,pages=Math.max(1,Math.ceil(filtered.length/count)),currentPage=Math.min(page,pages-1);
  return <section className="setup-map-v2" aria-label="Setup map editor">
    <div className="setup-map-canvas" aria-busy={baseBusy}>
      <TownMap view={view} responseBase={base} requestedBase={requested} roadOverrides={overrides} selectedRoadId={selectedRoadId}
        boundaryRings={bundle.assets.geography.tracts.flatMap(tract=>tract.rings)} mapTitle={mode==='base'?'Place the response base':'Choose blocked streets'}
        mapLabel="Dallas streets for choosing a response base and blocked streets" onMapPoint={mode==='base'&&!baseBusy?onBasePick:undefined} onRoadSelect={mode==='roads'?chooseRoad:undefined}/>
    </div>
    <div className="setup-base-facts">
      <dl><div><dt>Street base</dt><dd><output aria-label="Actual base coordinates">{actual?`${actual.lat}, ${actual.lon}`:'No street base selected'}</output></dd></div>
        {requested&&<div><dt>Requested point</dt><dd><output aria-label="Requested base coordinates">{requested.lat}, {requested.lon}</output></dd></div>}</dl>
      {distance!==null&&<p>The requested point is about {distance.toFixed(1)} m from the street base.</p>}
      {(baseBusy||message)&&<p className="setup-map-message" role="status" aria-live="polite">{baseBusy?'Finding a reachable street base…':message}</p>}
    </div>
    {mode==='roads'&&<div className="setup-map-road-tools"><span>{closed.size} blocked street segments</span><button id={`${id}-find-street`} type="button" onClick={()=>setStreetBrowserOpen(true)}>Find a street</button></div>}
    {mode==='roads'&&streetBrowserOpen&&<SecondaryPanel title="Choose blocked streets" onClose={()=>setStreetBrowserOpen(false)} fallbackFocusId={`${id}-find-street`} className="setup-street-panel"><section className="setup-road-browser" aria-label="Retained street segments">
      <div className="setup-road-search"><label htmlFor={`${id}-search`}>Search streets<input id={`${id}-search`} type="search" placeholder="Street name or segment number" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setStreetBrowserOpen(false);}}}/></label>
        <label className="setup-blocked-filter"><input type="checkbox" checked={blockedOnly} onChange={event=>{setBlockedOnly(event.target.checked);setPage(0);}}/>Blocked only</label></div>
      <ul>{filtered.slice(currentPage*count,currentPage*count+count).map(({edge,label})=>{
        const blocked=closed.has(edge.id),override=overrides[edge.id];
        const status=override===false?'Reopened by you':override===true?'Blocked by you':blocked?'Initially blocked':'Open';
        return <li key={edge.id}><button type="button" aria-label={`${blocked?'Reopen':'Block'} ${label}`} aria-pressed={blocked} className={selectedRoadId===edge.id?'is-selected':''} onClick={()=>chooseRoad(edge.id)}><strong>{label}</strong><span>{status}</span></button></li>;
      })}</ul>
      {!filtered.length&&<p>No matching street segments.</p>}
      <footer><button type="button" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Previous</button><span>{filtered.length?currentPage*count+1:0}–{Math.min(filtered.length,(currentPage+1)*count)} of {filtered.length} segments</span><button type="button" disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Next</button></footer>
    </section></SecondaryPanel>}
  </section>;
}
