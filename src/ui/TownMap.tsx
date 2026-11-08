import { useEffect, useRef, useState } from 'react';
import { Accessibility, Check, House, RadioTower, ShieldCheck, TriangleAlert, Truck, Users } from 'lucide-react';
import type { ObservationView, RunSummary } from '../model';
import { drawTown, neighborhoodName, publicUnitPosition } from '../map';

interface TownMapProps { view: ObservationView; selected?: string | null; onSelect?: (id: string) => void; compact?: boolean; debrief?: RunSummary; }
export function TownMap({ view, selected = null, onSelect, compact = false, debrief }: TownMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const geographic = view.map.kind === 'osm-driving';
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      drawTown(canvas, view, selected);
      if (geographic) {
        const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / view.map.width, rect.height / view.map.height);
        const next = { left: (rect.width - view.map.width * scale) / 2, top: (rect.height - view.map.height * scale) / 2, width: view.map.width * scale, height: view.map.height * scale };
        setFrame(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
      } else setFrame(null);
    };
    draw();
    const resize = new ResizeObserver(draw); resize.observe(canvas);
    return () => resize.disconnect();
  }, [view, selected, geographic]);
  const position = (x: number, y: number) => ({ left: `${x / view.map.width * 100}%`, top: `${y / view.map.height * 100}%` });
  const base = geographic ? view.map.nodes.find(node => node.id === view.map.metadata?.baseNodeId) : { x:480, y:330 };
  const neighborhoods = geographic ? (view.map.metadata?.quadrantLabels ?? []).map(item => ({ ...item, label:neighborhoodName(item.neighborhood) })) : [
    { label:'Northwest', x:220, y:34 }, { label:'Northeast', x:740, y:34 }, { label:'Southwest', x:220, y:378 }, { label:'Southeast', x:740, y:378 },
  ];
  return <div className={`town-map ${geographic ? 'geographic-map' : ''}`} aria-label={geographic ? 'Real Dallas streets with fictional homes and incidents' : 'Schematic map of fictional Riverdale'}>
    <div className="map-scene">
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="map-overlay" style={geographic && frame ? { ...frame, right:'auto', bottom:'auto' } : undefined}>
      {neighborhoods.map(n => <span key={n.label} className="neighborhood-label" style={position(n.x, n.y)}>{n.label}</span>)}
      {view.households.map(h => {
        const undiscovered = view.finalized && debrief?.households.find(summary => summary.householdId === h.id)?.undiscovered;
        const urgent = h.known?.need?.urgent && h.completedAt === null;
        const className = `map-house ${h.status} ${urgent ? 'urgent' : ''} ${undiscovered ? 'undiscovered' : ''} ${selected === h.id ? 'selected' : ''}`;
        const label = `${h.id}, ${neighborhoodName(h.neighborhood)}, ${undiscovered ? 'undiscovered need (debrief)' : h.status}${urgent ? ', urgent need' : ''}`;
        const content = <><House aria-hidden="true" />{urgent && <TriangleAlert className="house-flag" aria-hidden="true" />}{h.status === 'assisted' && <Check className="house-flag" aria-hidden="true" />}<span className="map-house-label">{h.id}</span></>;
        return onSelect ? <button id={`map-home-${h.id}`} key={h.id} type="button" title={label} aria-label={label} aria-pressed={selected === h.id} className={className} style={position(h.x, h.y)} onClick={() => onSelect(h.id)}>{content}</button> : <span key={h.id} title={label} className={className} style={position(h.x, h.y)}>{content}</span>;
      })}
      {view.shelters.map(shelter => <div key={shelter.id} className="map-facility" style={position(shelter.x, shelter.y)}><div className="facility-icon">{shelter.accessible ? <Accessibility size={23} /> : <Users size={23} />}</div><span>{shelter.name}</span></div>)}
      {base && <div className="map-facility base" style={position(base.x, base.y)}><div className="facility-icon"><ShieldCheck size={22} /></div><span>{geographic ? 'Demo response base' : 'Response base'}</span></div>}
      {view.units.map((unit, index) => {
        const point = publicUnitPosition(view, unit);
        if (geographic && !unit.missionId && unit.nodeId === view.map.metadata?.baseNodeId) return null;
        const offset = !geographic && !unit.missionId;
        return <div key={unit.id} data-unit-id={unit.id} className="map-unit" style={{ ...position(point.x + (offset ? (index - 1) * 38 : 0), point.y + (offset ? 75 : 0)) }} title={`${unit.id}: ${unit.missionId ? 'On mission' : 'Available'}`}>{unit.kind === 'crew' ? <Users /> : <Truck />}</div>;
      })}
    </div>
    </div>
    <div className="map-legend"><div className="legend-items"><span><i className="legend-dot" /> Not checked</span><span><i className="legend-dot reported" /> Needs help</span><span><i className="legend-dot assisted" /> Helped</span>{debrief && view.finalized && <span><i className="legend-dot undiscovered" /> Undiscovered need</span>}{!compact && view.networkGap !== 'none' && <span><i className="legend-dot outage" /> Cannot call</span>}</div><span className="map-scale">{geographic ? 'Distance-based exercise travel' : 'Schematic · exercise travel'}</span></div>
    {geographic && <div className="map-source"><span>Dallas streets · fictional homes and incidents</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></div>}
  </div>;
}
