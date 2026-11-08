import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as L from 'leaflet';
import { Accessibility, Check, House, MapPin, ShieldCheck, TriangleAlert, Truck, Users } from 'lucide-react';
import type { TownMapProps } from './TownMap';
import { neighborhoodName, publicUnitPosition } from '../map';
import { routeLegGeometry } from '../sim/routes';
import { geographicIdentity, outageBounds, simulationBounds, xyToLatLng } from './geographic';
import { vehicleMotionPositionV2, vehicleMotionV2 } from './v2/vehicle-motion';
import type { CoordinatorObservationV2 } from '../v2/contracts';
import 'leaflet/dist/leaflet.css';
import './geographic-map.css';

type TileStatus = 'loading' | 'ready' | 'unavailable';
interface MapRuntime { map: L.Map; tiles: L.TileLayer; markers: HTMLElement; dynamic: L.LayerGroup; roadEditor:L.LayerGroup; fit: () => void }
const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
const tileUrl = env?.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const providerCredit = env?.VITE_MAP_TILE_ATTRIBUTION;
const textLabel = (text: string) => { const node = document.createElement('span'); node.textContent = text; return node; };

/** Tiles provide visual context only. Routing and observations remain on the frozen engine graph. */
export function GeographicTownMap({ view, selected = null, onSelect, compact = false, debrief, unitStates, boundaryRings, householdLabels, householdTitles, householdCounts, mapTitle, onViewportChange, mapLabel, responseBase, requestedBase, onMapPoint, onRoadSelect, roadOverrides, selectedRoadId, motionObservation, motionPlaying = false, motionSpeed = 1 }: TownMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const [, redrawMarkers] = useState(0);
  const [tileStatus, setTileStatus] = useState<TileStatus>('loading');
  const identity = `${view.runId}:${geographicIdentity(view.map)}:${JSON.stringify(boundaryRings??[])}`;
  // Keep initial static geometry without making object identity an effect dependency.
  const currentView = useRef(view); currentView.current = view;
  const viewportCallback = useRef(onViewportChange); viewportCallback.current = onViewportChange;
  const pointCallback=useRef(onMapPoint);pointCallback.current=onMapPoint;
  const roadCallback=useRef(onRoadSelect);roadCallback.current=onRoadSelect;

  useEffect(() => {
    if (!container.current) return;
    const graph = currentView.current.map;
    const map = L.map(container.current, {
      zoomControl: false, attributionControl: false, minZoom: 10, maxZoom: 19, zoomSnap: .25, zoomDelta: .5,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      // Wheel interaction is intentional when the pointer is over the map.
      scrollWheelZoom: true, keyboard: true,
    });
    const tractRings=(boundaryRings??[]).filter(ring=>ring.length>=3).map(ring=>ring.map(([lon,lat])=>[lat,lon] as [number,number]));
    const areaBounds=tractRings.length?L.latLngBounds(tractRings.flat()):L.latLngBounds(simulationBounds(graph));
    const fit = () => map.fitBounds(areaBounds, { paddingTopLeft: tractRings.length?[48,60]:[32,40], paddingBottomRight: tractRings.length?[48,40]:[32,28], maxZoom: 17, animate: false });
    fit();
    const fallbackPane = map.createPane('retainedRoads'); fallbackPane.style.zIndex = '190';
    const markers = map.createPane('simulationMarkers'); markers.style.zIndex = '610'; markers.style.pointerEvents = 'none';
    const staticLayers = L.layerGroup().addTo(map);
    // Retained roads remain useful even when tile requests fail or hang. No invented land use.
    L.polyline(graph.edges.flatMap(edge => edge.geometry?.length ? [edge.geometry.map(point => xyToLatLng(graph, point))] : []), {
      pane: 'retainedRoads', color: '#73827c', weight: 4, opacity: .75, interactive: false,
    }).addTo(staticLayers);
    const boundaryStyle={className:'simulation-boundary',color:'#315e94',weight:3,dashArray:'10 5',fill:false,interactive:false};
    if(tractRings.length){
      const fillPane=map.createPane('simulationBoundaryFill');fillPane.style.zIndex='350';fillPane.style.pointerEvents='none';
      const haloPane=map.createPane('simulationBoundaryHalo');haloPane.style.zIndex='430';haloPane.style.pointerEvents='none';
      const edgePane=map.createPane('simulationBoundaryEdge');edgePane.style.zIndex='450';edgePane.style.pointerEvents='none';
      for(const ring of tractRings){
        L.polygon(ring,{pane:'simulationBoundaryFill',className:'simulation-boundary-fill',stroke:false,fillColor:'#3f7cc1',fillOpacity:.075,interactive:false,smoothFactor:0,noClip:true}).addTo(staticLayers);
        L.polyline(ring,{pane:'simulationBoundaryHalo',className:'simulation-boundary-halo',color:'#fff',weight:9,opacity:1,interactive:false,smoothFactor:0,noClip:true}).addTo(staticLayers);
        L.polyline(ring,{pane:'simulationBoundaryEdge',className:'simulation-boundary',color:'#173f7a',weight:4.5,opacity:1,interactive:false,smoothFactor:0,noClip:true}).addTo(staticLayers);
      }
    }else L.rectangle(simulationBounds(graph),boundaryStyle).addTo(staticLayers);
    const b = graph.metadata!.bounds;
    const edgeAnchor=tractRings.flat().reduce<[number,number]|null>((best,point)=>!best||point[0]>best[0]?point:best,null);
    L.tooltip({ permanent: true, direction: tractRings.length?'top':'center', offset:tractRings.length?[0,-6]:[0,0], className: 'simulation-boundary-label' })
      .setLatLng(edgeAnchor??[b.north, (b.west + b.east) / 2]).setContent(textLabel('Simulation boundary')).addTo(staticLayers);
    const dynamic = L.layerGroup().addTo(map);
    const roadPane=map.createPane('simulationRoadEditor');roadPane.style.zIndex='410';
    const roadEditor=L.layerGroup().addTo(map);
    const tiles = L.tileLayer(tileUrl, {
      maxZoom: 19, minZoom: 10, detectRetina: false, keepBuffer: 0,
      updateWhenIdle: true, updateWhenZooming: false, crossOrigin: false,
    });
    const failed = new Set<HTMLImageElement>(), loaded = new Set<HTMLImageElement>(), pending = new Set<HTMLImageElement>();
    let disposed = false, timeout = 0;
    const report = () => {
      if (disposed) return;
      for (const tile of failed) if (!tile.isConnected) failed.delete(tile);
      for (const tile of loaded) if (!tile.isConnected) loaded.delete(tile);
      for (const tile of pending) if (!tile.isConnected) pending.delete(tile);
      if (failed.size) setTileStatus('unavailable');
      else if (!pending.size && loaded.size) setTileStatus('ready');
      if (!pending.size) window.clearTimeout(timeout);
    };
    const start = (event: L.TileEvent) => pending.add(event.tile as HTMLImageElement);
    const success = (event: L.TileEvent) => { pending.delete(event.tile as HTMLImageElement); failed.delete(event.tile as HTMLImageElement); loaded.add(event.tile as HTMLImageElement); report(); };
    const failure = (event: L.TileErrorEvent) => { pending.delete(event.tile as HTMLImageElement); failed.add(event.tile as HTMLImageElement); report(); };
    const unload = (event: L.TileEvent) => { pending.delete(event.tile as HTMLImageElement); failed.delete(event.tile as HTMLImageElement); loaded.delete(event.tile as HTMLImageElement); };
    const loading = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => { if (!disposed) setTileStatus('unavailable'); }, 8000);
    };
    tiles.on('loading', loading).on('tileloadstart', start).on('tileload', success).on('tileerror', failure).on('tileunload', unload).on('load', report);
    setTileStatus('loading');
    tiles.addTo(map);
    const redraw = () => {
      redrawMarkers(revision => revision + 1);
      const bounds = map.getBounds();
      viewportCallback.current?.({ zoom: map.getZoom(), bounds: { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() } });
    };
    map.on('zoomend viewreset moveend', redraw);
    const drag = () => { dragged.current = true; };
    map.on('dragstart', drag);
    const pickPoint=(event:L.LeafletMouseEvent)=>{if(!dragged.current)pointCallback.current?.({lat:event.latlng.lat,lon:event.latlng.lng});};
    map.on('click',pickPoint);
    let frame = 0, initialResize = true;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        // Leaflet may mount before the setup panel reaches its final size. Fit once
        // after layout, then keep the user's center on subsequent panel resizes.
        map.invalidateSize({ pan: true, animate: false });
        if (initialResize) { initialResize = false; fit(); }
        redraw();
      });
    });
    resize.observe(container.current);
    setRuntime({ map, tiles, markers, dynamic, roadEditor, fit });
    redraw();
    return () => {
      disposed = true;
      resize.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timeout);
      tiles.off(); map.off('zoomend viewreset moveend', redraw); map.off('dragstart', drag); map.off('click',pickPoint);map.remove();
    };
  }, [identity]);

  useEffect(() => {
    if (!runtime) return;
    const { dynamic } = runtime;
    dynamic.clearLayers();
    const bounds = outageBounds(view.map, view.networkGap);
    if (bounds) L.rectangle(bounds, {
      className: 'communications-outage', color: '#a5721c', weight: 1.5, dashArray: '3 5',
      fillColor: '#e6bc58', fillOpacity: .22, interactive: false,
    }).addTo(dynamic);
    for (const edge of view.map.edges.filter(edge => edge.closed&&!roadOverrides)) {
      if (edge.geometry) L.polyline(edge.geometry.map(point => xyToLatLng(view.map, point)), {
        className: 'closed-simulation-road', color: '#a32135', weight: 5, dashArray: '4 5', interactive: false,
      }).addTo(dynamic);
    }
    if(requestedBase&&responseBase)L.polyline([[requestedBase.lat,requestedBase.lon],xyToLatLng(view.map,responseBase)],{
      className:'setup-base-snap-link',color:'#4e5fa3',weight:2.5,dashArray:'5 5',interactive:false,
    }).addTo(dynamic);
    for (const mission of view.missions.filter(m => m.status !== 'completed' && (!selected || selected === m.householdId))) {
      // Separate legs avoid drawing a fictitious join across missing geometry.
      const legs = [...mission.route.legs, ...(mission.shelterRoute?.legs ?? [])];
      const points = legs.map(leg => routeLegGeometry(view.map, leg).map(point => xyToLatLng(view.map, point)));
      L.polyline(points, { color: '#fff', weight: 7, interactive: false }).addTo(dynamic);
      L.polyline(points, { className: 'simulation-mission-route', color: '#bf2535', weight: 3, dashArray: '7 5', interactive: false }).addTo(dynamic);
    }
  }, [runtime, view, selected,requestedBase,responseBase,roadOverrides]);

  useEffect(()=>{
    if(!runtime)return;runtime.roadEditor.clearLayers();
    if(!roadOverrides)return;
    for(const edge of view.map.edges){
      if(!edge.geometry?.length)continue;
      const override=roadOverrides[edge.id],closed=override??!!edge.closed;
      const category=override===true?'user-blocked':override===false?'reopened':closed?'initial-blocked':'open';
      const color=category==='user-blocked'?'#a32135':category==='initial-blocked'?'#a66612':category==='reopened'?'#18704d':'#4e779a';
      const points=edge.geometry.map(point=>xyToLatLng(view.map,point));
      L.polyline(points,{pane:'simulationRoadEditor',className:`setup-edit-road setup-road-${category}${selectedRoadId===edge.id?' setup-road-selected':''}`,
        color,weight:selectedRoadId===edge.id?7:closed?5:3,opacity:closed?1:.8,dashArray:category==='user-blocked'?'8 5':category==='initial-blocked'?'2 5':undefined,interactive:false,
      }).addTo(runtime.roadEditor);
      if(onRoadSelect){
        const target=L.polyline(points,{pane:'simulationRoadEditor',className:'setup-road-target',color:'#fff',weight:18,opacity:.001,interactive:true,bubblingMouseEvents:false})
          .addTo(runtime.roadEditor).bindTooltip(textLabel(`${edge.name||'Unnamed street'} · ${closed?'Blocked':'Open'}`),{sticky:true});
        target.getElement()?.setAttribute('data-road-id',edge.id);
        target.getElement()?.setAttribute('role','presentation');
        target.on('click',(event:L.LeafletMouseEvent)=>{L.DomEvent.stopPropagation(event.originalEvent);if(!dragged.current||event.originalEvent.detail===0)roadCallback.current?.(edge.id);});
      }
    }
  },[runtime,view.map,roadOverrides,selectedRoadId,!!onRoadSelect]);

  const previousMotion = useRef<CoordinatorObservationV2 | undefined>(undefined);
  const latestMotion = useRef(motionObservation); latestMotion.current=motionObservation;
  useLayoutEffect(()=>{
    const previous=previousMotion.current; previousMotion.current=motionObservation;
    if(!runtime||!motionObservation||!previous||!motionPlaying||document.hidden||motionSpeed<=0)return;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if(reduced?.matches)return;
    const markers=Array.from(runtime.markers.querySelectorAll<HTMLElement>('[data-unit-id]'));
    const animations=motionObservation.units.flatMap(unit=>{
      const element=markers.find(item=>item.dataset.unitId===unit.id),motion=vehicleMotionV2(previous,motionObservation,unit.id);
      return element&&motion?[{element,motion,unit}]:[];
    });
    if(!animations.length)return;
    let frame=0,finished=false;
    const draw=(fraction:number)=>{for(const item of animations){
      const point=vehicleMotionPositionV2(motionObservation.map,item.motion,fraction);
      const projected=runtime.map.latLngToLayerPoint(xyToLatLng(motionObservation.map,point));
      item.element.style.left=`${projected.x}px`;item.element.style.top=`${projected.y}px`;
    }};
    const restore=()=>{if(finished)return;finished=true;cancelAnimationFrame(frame);for(const item of animations){
      const latest=latestMotion.current,unit=latest?.units.find(candidate=>candidate.id===item.unit.id);
      if(!latest||!unit)continue;
      const point=runtime.map.latLngToLayerPoint(xyToLatLng(latest.map,unit.position));
      item.element.style.left=`${point.x}px`;item.element.style.top=`${point.y}px`;
    }};
    const started=performance.now(),duration=1000/motionSpeed;
    const animate=(now:number)=>{const progress=Math.min(1,Math.max(0,(now-started)/duration));draw(progress);if(progress<1)frame=requestAnimationFrame(animate);else restore();};
    const hidden=()=>{if(document.hidden)restore();};const preference=()=>{if(reduced?.matches)restore();};
    document.addEventListener('visibilitychange',hidden);reduced?.addEventListener?.('change',preference);
    draw(0);frame=requestAnimationFrame(animate);
    return()=>{document.removeEventListener('visibilitychange',hidden);reduced?.removeEventListener?.('change',preference);restore();};
  },[runtime,motionObservation,motionPlaying,motionSpeed]);

  const position = (point: { x: number; y: number }) => {
    const p = runtime!.map.latLngToLayerPoint(xyToLatLng(view.map, point));
    return { left: `${p.x}px`, top: `${p.y}px` };
  };
  const base = responseBase===undefined?view.map.nodes.find(node => node.id === view.map.metadata!.baseNodeId):responseBase;
  const baseLabel=responseBase?.label??'Demo response base';
  return <div className="town-map geographic-map interactive-geographic-map" aria-label={mapLabel??'Dallas streets with simulated homes and incidents'} onPointerDownCapture={() => { dragged.current = false; }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="geographic-toolbar" role="group" aria-label="Map controls">
      {mapTitle&&<h2 className="geographic-map-title">{mapTitle}</h2>}
      <button type="button" aria-label="Zoom in" onClick={() => runtime?.map.zoomIn()}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => runtime?.map.zoomOut()}>−</button>
      <button type="button" onClick={() => runtime?.fit()}>Fit simulation area</button>
      {!mapTitle&&<span className="geographic-boundary-key"><i />Simulation area only</span>}
    </div>
    <div className="geographic-scene">
      <div className="geographic-leaflet" data-point-picker={onMapPoint ? 'true' : undefined} ref={container} aria-label={onMapPoint?'Interactive street map. Arrow keys move; plus and minus zoom; Enter chooses the center as the requested base point.':'Interactive street map. Drag to pan; arrow keys to move; plus and minus to zoom.'} onKeyDown={event=>{if(event.key==='Enter'&&onMapPoint&&runtime){event.preventDefault();const point=runtime.map.getCenter();onMapPoint({lat:point.lat,lon:point.lng});}}}/>
      {runtime && createPortal(<>
        {(view.map.metadata!.quadrantLabels ?? []).map(item => <span key={item.neighborhood} className="neighborhood-label" style={position(item)}>{neighborhoodName(item.neighborhood)}</span>)}
        {view.households.map(home => {
          const undiscovered = view.finalized && debrief?.households.find(h => h.householdId === home.id)?.undiscovered;
          const urgent = home.known?.need?.urgent && home.completedAt === null;
          const displayLabel=householdLabels?.[home.id]??home.id;
          const label = householdTitles?.[home.id]??`${displayLabel}, ${neighborhoodName(home.neighborhood)}, ${undiscovered ? 'need not found (results)' : home.status}${urgent ? ', urgent need' : ''}`;
          const count=householdCounts?.[home.id]??1;
          const props = { className: `map-house ${count>1?'map-house-group':''} ${home.status} ${urgent ? 'urgent' : ''} ${undiscovered ? 'undiscovered' : ''} ${selected === home.id ? 'selected' : ''}`, style: position(home), title: label };
          const content = count>1 ? <svg className="map-house-group-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M2 20 24 2 46 20h-4v26H6V20Z"/><text className="map-house-count" x="24" y="33" textAnchor="middle" dominantBaseline="middle">{count}</text></svg> : <><House aria-hidden="true" />{urgent && <TriangleAlert className="house-flag" aria-hidden="true" />}{home.status === 'assisted' && <Check className="house-flag" aria-hidden="true" />}<span className="map-house-label">{displayLabel}</span></>;
          return onSelect ? <button {...props} key={home.id} id={`map-home-${home.id}`} type="button" aria-label={label} aria-pressed={selected === home.id} onClick={event => { if (!dragged.current || event.detail === 0) onSelect(home.id); }}>{content}</button> : <span {...props} key={home.id}>{content}</span>;
        })}
        {view.shelters.map(shelter => <div key={shelter.id} data-shelter-id={shelter.id} className="map-facility" style={position(shelter)}><div className="facility-icon">{shelter.accessible ? <Accessibility size={23} /> : <Users size={23} />}</div><span>{shelter.name}</span></div>)}
        {base && <div className="map-facility base" role="img" aria-label={baseLabel} data-base-node-id={responseBase?.nodeId??view.map.metadata!.baseNodeId} style={position(base)}><div className="facility-icon"><ShieldCheck size={22} /></div><span>{baseLabel}</span></div>}
        {requestedBase&&<div className="setup-requested-base" role="img" aria-label={`Requested base point at ${requestedBase.lat}, ${requestedBase.lon}`} style={(()=>{const point=runtime.map.latLngToLayerPoint([requestedBase.lat,requestedBase.lon]);return {left:`${point.x}px`,top:`${point.y}px`};})()}><MapPin aria-hidden="true"/><span>Requested point</span></div>}
        {view.units.map(unit => {
          const label=unitStates?.[unit.id]?.label??`${unit.id}: ${unit.missionId?'On mission':'Available'}`;
          return <div key={unit.id} data-unit-id={unit.id} className="map-unit" role="img" aria-label={label} style={position(unitStates?.[unit.id]??publicUnitPosition(view,unit))} title={label}>{unit.kind === 'crew' ? <Users /> : <Truck />}</div>;
        })}
      </>, runtime.markers)}
      {tileStatus === 'unavailable' && <div className="geographic-tile-status" role="status" aria-live="polite" aria-atomic="true">
      <span>Street map unavailable or incomplete. Retained exercise roads remain available.</span>
      <button type="button" onClick={() => {
        if (!runtime) return;
        // GridLayer.redraw in Leaflet 1.9.4 uses the fractional view zoom as an
        // XYZ tile level. Re-adding the layer uses its normal integer tile grid.
        setTileStatus('loading'); runtime.map.removeLayer(runtime.tiles); runtime.tiles.addTo(runtime.map);
      }}>Reload map</button>
      </div>}
    </div>
    <div className="map-legend" aria-label="Map legend"><div className="legend-items">{roadOverrides?<><span><i className="setup-road-key open"/>Open</span><span><i className="setup-road-key initial-blocked"/>Initially blocked</span><span><i className="setup-road-key user-blocked"/>Blocked by you</span><span><i className="setup-road-key reopened"/>Reopened by you</span></>:<><span><i className="legend-dot" />Not checked</span><span><i className="legend-dot reported" />Needs help</span><span><i className="legend-dot assisted" />Helped</span>{debrief && view.finalized && <span><i className="legend-dot undiscovered" />Need not found</span>}{!compact && view.networkGap !== 'none' && <span><i className="legend-dot outage" />Cannot call</span>}</>}</div><span className="geographic-attribution">{providerCredit && `${providerCredit} · `}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></span></div>
  </div>;
}
