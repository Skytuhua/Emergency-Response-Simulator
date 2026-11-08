import { useCallback, useId, useMemo, useState } from 'react';
import type { GeographyBundleV2, ObserverSnapshotV2 } from '../../v2/contracts';
import { TownMap, type MapViewport } from '../TownMap';
import { SecondaryPanel } from '../SecondaryPanel';
import { adaptMapV2, homeStatusLabelV2 } from './map-adapter';
import { homeLabelV2 } from './home-labels';
import './observer-v2.css';
import './map-v2.css';

export interface MapV2Props { snapshot:ObserverSnapshotV2; selected?:string|null; onSelect?:(id:string)=>void; onPause?:()=>void; fallbackFocusId?:string; geography?:GeographyBundleV2; compact?:boolean; mapTitle?:string; playing?:boolean; speed?:number }
export function MapV2({snapshot,selected=null,onSelect,onPause,fallbackFocusId,geography,compact=false,mapTitle='Dallas response area',playing=false,speed=1}:MapV2Props) {
  const [viewport,setViewport]=useState<MapViewport|null>(null);
  const onViewportChange=useCallback((next:MapViewport)=>setViewport(current=>current?.zoom===next.zoom && current.bounds.north===next.bounds.north && current.bounds.south===next.bounds.south && current.bounds.west===next.bounds.west && current.bounds.east===next.bounds.east ? current : next),[]);
  const scene=useMemo(()=>adaptMapV2(snapshot.coordinator,selected,viewport),[snapshot.coordinator,selected,viewport]);
  const [clusterId,setClusterId]=useState<string|null>(null);
  const [page,setPage]=useState(0);
  const [query,setQuery]=useState('');
  const mapFocusId=useId();
  const cluster=scene.features.find(feature=>feature.id===clusterId);
  const homes=useMemo(()=>new Map(snapshot.coordinator.households.map(home=>[home.id,home])),[snapshot.coordinator.households]);
  const groupMembers=useMemo(()=>(cluster?.householdIds??[]).filter(id=>homeLabelV2(scene.homeLabels,id).toLowerCase().includes(query.trim().toLowerCase())),[cluster,scene.homeLabels,query]);
  const choose=(id:string)=>{
    const feature=scene.features.find(item=>item.id===id);
    if(!feature)return;
    if(feature.kind==='household')onSelect?.(feature.householdIds[0]);
    else {onPause?.();setPage(0);setQuery('');setClusterId(id);}
  };
  return <div className="v2-map-wrap" id={mapFocusId} tabIndex={-1} aria-label="Dallas map and home groups">
    <TownMap view={scene.view} selected={scene.selectedFeatureId} onSelect={onSelect?choose:undefined} compact={compact}
      unitStates={scene.unitStates} motionObservation={snapshot.coordinator} motionPlaying={playing} motionSpeed={speed} boundaryRings={geography?.tracts.flatMap(tract=>tract.rings)} householdLabels={scene.householdLabels} householdTitles={scene.householdTitles} householdCounts={scene.householdCounts}
      onViewportChange={onViewportChange} mapTitle={mapTitle} responseBase={scene.responseBase}/>
    {cluster&&<SecondaryPanel title="Homes in selected map group" onClose={()=>setClusterId(null)} fallbackFocusId={fallbackFocusId??mapFocusId} className="v2-secondary">
      <section className="v2-group-browser" aria-label="Map group members"><h3>{cluster.homeCount} homes in this group</h3>
      <label className="v2-group-search">Search homes in this group<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setClusterId(null);}}} placeholder="Home 0001"/></label>
      <ul>{groupMembers.slice(page*20,page*20+20).map(id=>{
        const home=homes.get(id)!;
        const label=homeLabelV2(scene.homeLabels,id);
        return <li key={id}><button type="button" aria-label={`Inspect ${label}, ${homeStatusLabelV2(home)}`} onClick={()=>{onSelect?.(id);setClusterId(null);}}><strong>{label}</strong><span>{homeStatusLabelV2(home)}</span></button></li>;
      })}</ul>
      {!groupMembers.length&&<p>No matching homes.</p>}
      <footer><button type="button" disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>{groupMembers.length?page*20+1:0}–{Math.min(groupMembers.length,page*20+20)} of {groupMembers.length}</span><button type="button" disabled={(page+1)*20>=groupMembers.length} onClick={()=>setPage(page+1)}>Next</button></footer>
      </section>
    </SecondaryPanel>}
  </div>;
}
