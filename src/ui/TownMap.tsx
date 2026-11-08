import { useEffect, useRef } from 'react';
import { Accessibility, Check, House, ShieldCheck, TriangleAlert, Truck, Users } from 'lucide-react';
import type { ObservationView, RunSummary } from '../model';
import { drawTown, neighborhoodName, publicUnitPosition } from '../map';
import { GeographicTownMap } from './GeographicTownMap';

export interface TownMapProps { view: ObservationView; selected?: string | null; onSelect?: (id: string) => void; compact?: boolean; debrief?: RunSummary; }
export function TownMap(props: TownMapProps) {
  return props.view.map.kind === 'osm-driving' ? <GeographicTownMap {...props} /> : <SchematicTownMap {...props} />;
}
function SchematicTownMap({ view, selected = null, onSelect, compact = false, debrief }: TownMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      drawTown(canvas, view, selected);
    };
    draw();
    const resize = new ResizeObserver(draw); resize.observe(canvas);
    return () => resize.disconnect();
  }, [view, selected]);
  const position = (x: number, y: number) => ({ left: `${x / view.map.width * 100}%`, top: `${y / view.map.height * 100}%` });
  const base = { x:480, y:330 };
  const neighborhoods = [
    { label:'Northwest', x:220, y:34 }, { label:'Northeast', x:740, y:34 }, { label:'Southwest', x:220, y:378 }, { label:'Southeast', x:740, y:378 },
  ];
  return <div className="town-map" aria-label="Schematic map of fictional Riverdale">
    <div className="map-scene">
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="map-overlay">
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
      <div className="map-facility base" style={position(base.x, base.y)}><div className="facility-icon"><ShieldCheck size={22} /></div><span>Response base</span></div>
      {view.units.map((unit, index) => {
        const point = publicUnitPosition(view, unit);
        const offset = !unit.missionId;
        return <div key={unit.id} data-unit-id={unit.id} className="map-unit" style={{ ...position(point.x + (offset ? (index - 1) * 38 : 0), point.y + (offset ? 75 : 0)) }} title={`${unit.id}: ${unit.missionId ? 'On mission' : 'Available'}`}>{unit.kind === 'crew' ? <Users /> : <Truck />}</div>;
      })}
    </div>
    </div>
    <div className="map-legend"><div className="legend-items"><span><i className="legend-dot" /> Not checked</span><span><i className="legend-dot reported" /> Needs help</span><span><i className="legend-dot assisted" /> Helped</span>{debrief && view.finalized && <span><i className="legend-dot undiscovered" /> Undiscovered need</span>}{!compact && view.networkGap !== 'none' && <span><i className="legend-dot outage" /> Cannot call</span>}</div><span className="map-scale">Schematic · exercise travel</span></div>
  </div>;
}
