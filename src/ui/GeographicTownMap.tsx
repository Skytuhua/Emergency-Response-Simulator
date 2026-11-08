import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as L from 'leaflet';
import { Accessibility, Check, House, ShieldCheck, TriangleAlert, Truck, Users } from 'lucide-react';
import type { TownMapProps } from './TownMap';
import { neighborhoodName, publicUnitPosition } from '../map';
import { routeLegGeometry } from '../sim/routes';
import { geographicIdentity, outageBounds, simulationBounds, xyToLatLng } from './geographic';
import 'leaflet/dist/leaflet.css';
import './geographic-map.css';

type TileStatus = 'loading' | 'ready' | 'unavailable';
interface MapRuntime { map: L.Map; tiles: L.TileLayer; markers: HTMLElement; dynamic: L.LayerGroup; fit: () => void }
const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
const tileUrl = env?.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const providerCredit = env?.VITE_MAP_TILE_ATTRIBUTION;
const textLabel = (text: string) => { const node = document.createElement('span'); node.textContent = text; return node; };

/** Tiles provide visual context only. Routing and observations remain on the frozen engine graph. */
export function GeographicTownMap({ view, selected = null, onSelect, compact = false, debrief }: TownMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const [, redrawMarkers] = useState(0);
  const [tileStatus, setTileStatus] = useState<TileStatus>('loading');
  const identity = `${view.runId}:${geographicIdentity(view.map)}`;
  // Keep initial static geometry without making object identity an effect dependency.
  const currentView = useRef(view); currentView.current = view;

  useEffect(() => {
    if (!container.current) return;
    const graph = currentView.current.map;
    const map = L.map(container.current, {
      zoomControl: false, attributionControl: false, minZoom: 10, maxZoom: 19, zoomSnap: .25, zoomDelta: .5,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      // Wheel interaction is intentional when the pointer is over the map.
      scrollWheelZoom: true, keyboard: true,
    });
    const fit = () => map.fitBounds(simulationBounds(graph), { paddingTopLeft: [32, 40], paddingBottomRight: [32, 28], maxZoom: 17, animate: false });
    fit();
    const fallbackPane = map.createPane('retainedRoads'); fallbackPane.style.zIndex = '190';
    const markers = map.createPane('simulationMarkers'); markers.style.zIndex = '610'; markers.style.pointerEvents = 'none';
    const staticLayers = L.layerGroup().addTo(map);
    // Retained roads remain useful even when tile requests fail or hang. No invented land use.
    L.polyline(graph.edges.flatMap(edge => edge.geometry?.length ? [edge.geometry.map(point => xyToLatLng(graph, point))] : []), {
      pane: 'retainedRoads', color: '#73827c', weight: 4, opacity: .75, interactive: false,
    }).addTo(staticLayers);
    L.rectangle(simulationBounds(graph), {
      className: 'simulation-boundary', color: '#315e94', weight: 3, dashArray: '10 5', fill: false, interactive: false,
    }).addTo(staticLayers);
    const b = graph.metadata!.bounds;
    L.tooltip({ permanent: true, direction: 'center', className: 'simulation-boundary-label' })
      .setLatLng([b.north, (b.west + b.east) / 2]).setContent(textLabel('Simulation boundary')).addTo(staticLayers);
    const dynamic = L.layerGroup().addTo(map);
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
    const redraw = () => redrawMarkers(revision => revision + 1);
    map.on('zoomend viewreset moveend', redraw);
    const drag = () => { dragged.current = true; };
    map.on('dragstart', drag);
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (!disposed) { map.invalidateSize({ pan: false, animate: false }); redraw(); } });
    });
    resize.observe(container.current);
    setRuntime({ map, tiles, markers, dynamic, fit });
    return () => {
      disposed = true;
      resize.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(timeout);
      tiles.off(); map.off('zoomend viewreset moveend', redraw); map.off('dragstart', drag); map.remove();
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
    for (const edge of view.map.edges.filter(edge => edge.closed)) {
      if (edge.geometry) L.polyline(edge.geometry.map(point => xyToLatLng(view.map, point)), {
        className: 'closed-simulation-road', color: '#a32135', weight: 5, dashArray: '4 5', interactive: false,
      }).addTo(dynamic);
    }
    for (const mission of view.missions.filter(m => m.status !== 'completed' && (!selected || selected === m.householdId))) {
      // Separate legs avoid drawing a fictitious join across missing geometry.
      const legs = [...mission.route.legs, ...(mission.shelterRoute?.legs ?? [])];
      const points = legs.map(leg => routeLegGeometry(view.map, leg).map(point => xyToLatLng(view.map, point)));
      L.polyline(points, { color: '#fff', weight: 7, interactive: false }).addTo(dynamic);
      L.polyline(points, { className: 'simulation-mission-route', color: '#bf2535', weight: 3, dashArray: '7 5', interactive: false }).addTo(dynamic);
    }
  }, [runtime, view, selected]);

  const position = (point: { x: number; y: number }) => {
    const p = runtime!.map.latLngToLayerPoint(xyToLatLng(view.map, point));
    return { left: `${p.x}px`, top: `${p.y}px` };
  };
  const base = view.map.nodes.find(node => node.id === view.map.metadata!.baseNodeId);
  return <div className="town-map geographic-map interactive-geographic-map" aria-label="Real Dallas streets with fictional homes and incidents" onPointerDownCapture={() => { dragged.current = false; }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="geographic-toolbar" role="group" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" onClick={() => runtime?.map.zoomIn()}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => runtime?.map.zoomOut()}>−</button>
      <button type="button" onClick={() => runtime?.fit()}>Fit simulation area</button>
      <span className="geographic-boundary-key"><i />Simulation area only</span>
    </div>
    <div className="geographic-scene">
      <div className="geographic-leaflet" ref={container} aria-label="Interactive street map. Drag to pan; arrow keys to move; plus and minus to zoom." />
      {runtime && createPortal(<>
        {(view.map.metadata!.quadrantLabels ?? []).map(item => <span key={item.neighborhood} className="neighborhood-label" style={position(item)}>{neighborhoodName(item.neighborhood)}</span>)}
        {view.households.map(home => {
          const undiscovered = view.finalized && debrief?.households.find(h => h.householdId === home.id)?.undiscovered;
          const urgent = home.known?.need?.urgent && home.completedAt === null;
          const label = `${home.id}, ${neighborhoodName(home.neighborhood)}, ${undiscovered ? 'undiscovered need (debrief)' : home.status}${urgent ? ', urgent need' : ''}`;
          const props = { className: `map-house ${home.status} ${urgent ? 'urgent' : ''} ${undiscovered ? 'undiscovered' : ''} ${selected === home.id ? 'selected' : ''}`, style: position(home), title: label };
          const content = <><House aria-hidden="true" />{urgent && <TriangleAlert className="house-flag" aria-hidden="true" />}{home.status === 'assisted' && <Check className="house-flag" aria-hidden="true" />}<span className="map-house-label">{home.id}</span></>;
          return onSelect ? <button {...props} key={home.id} id={`map-home-${home.id}`} type="button" aria-label={label} aria-pressed={selected === home.id} onClick={event => { if (!dragged.current || event.detail === 0) onSelect(home.id); }}>{content}</button> : <span {...props} key={home.id}>{content}</span>;
        })}
        {view.shelters.map(shelter => <div key={shelter.id} data-shelter-id={shelter.id} className="map-facility" style={position(shelter)}><div className="facility-icon">{shelter.accessible ? <Accessibility size={23} /> : <Users size={23} />}</div><span>{shelter.name}</span></div>)}
        {base && <div className="map-facility base" style={position(base)}><div className="facility-icon"><ShieldCheck size={22} /></div><span>Demo response base</span></div>}
        {view.units.map(unit => <div key={unit.id} data-unit-id={unit.id} className="map-unit" style={position(publicUnitPosition(view, unit))} title={`${unit.id}: ${unit.missionId ? 'On mission' : 'Available'}`}>{unit.kind === 'crew' ? <Users /> : <Truck />}</div>)}
      </>, runtime.markers)}
    </div>
    <div className="geographic-tile-status" role="status" aria-live="polite" aria-atomic="true">
      <span>{tileStatus === 'loading' ? 'Loading street map… Retained exercise roads are available.' : tileStatus === 'unavailable' ? 'Street map tiles unavailable or incomplete. Showing retained exercise roads; pan and zoom still work.' : 'Street map loaded. Homes and incidents are fictional.'}</span>
      {tileStatus === 'unavailable' && <button type="button" onClick={() => {
        if (!runtime) return;
        // GridLayer.redraw in Leaflet 1.9.4 uses the fractional view zoom as an
        // XYZ tile level. Re-adding the layer uses its normal integer tile grid.
        runtime.map.removeLayer(runtime.tiles); runtime.tiles.addTo(runtime.map);
      }}>Retry map tiles</button>}
    </div>
    <div className="map-legend"><div className="legend-items"><span><i className="legend-dot" />Not checked</span><span><i className="legend-dot reported" />Needs help</span><span><i className="legend-dot assisted" />Helped</span>{debrief && view.finalized && <span><i className="legend-dot undiscovered" />Undiscovered need</span>}{!compact && view.networkGap !== 'none' && <span><i className="legend-dot outage" />Cannot call</span>}</div></div>
    <div className="map-source"><span>Supported area inside blue boundary · routing uses retained exercise roads{providerCredit ? ` · ${providerCredit}` : ''}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></div>
  </div>;
}
