import { useEffect, useState } from 'react';
import { Accessibility, Check, ChevronRight, Clock3, FileDown, FileUp, House, List, Package, Pause, Play, RadioTower, RotateCcw, SkipForward, TriangleAlert, Truck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { AgentArtifact, CommandIntent, ObservationView, ObservedHousehold, SimEvent } from '../model';
import { neighborhoodName } from '../map';
import { HouseholdInspector } from './HouseholdInspector';
import { SecondaryPanel } from './SecondaryPanel';
import { Provenance } from './Provenance';
import { TownMap } from './TownMap';

export const minuteLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const householdStatus = (home: ObservedHousehold) => home.completedAt !== null ? 'Helped' : home.missionId ? 'Team assigned' : home.known?.need ? (home.known.need.urgent ? 'Urgent need' : 'Needs help') : home.assessedAt !== null ? 'No current need' : 'Not checked';
type Panel = 'Homes' | 'Teams' | 'Activity' | 'Details' | 'Exercise' | 'Household';
interface ResponseProps {
  view: ObservationView; selected: string | null; unitId: string; shelterId: string; artifact: AgentArtifact | null;
  running: boolean; speed: number; notice: { text: string; urgentId?: string } | null;
  onSelect: (id: string | null) => void; onUnit: (id: string) => void; onShelter: (id: string) => void;
  onToggle: () => void; onStep: () => void; onSpeed: (speed: number) => void; onPause: () => void;
  onDispatch: (intent: CommandIntent) => void; onExport: () => void; onImport: () => void;
  onFinish: () => void; onEdit: () => void; onDismiss: () => void;
}
const eventLabel = (event: SimEvent) => ({ dispatch: 'Team sent', assessment: 'Home checked', request: 'Request received', pickup: 'Residents boarded', completion: 'Help completed', system: event.minute === 0 ? 'Exercise started' : 'Exercise finished' })[event.type];

export function Response(props: ResponseProps) {
  const { view, selected, unitId, shelterId, artifact, running, speed, notice, onSelect, onUnit, onShelter, onToggle, onStep, onSpeed, onPause, onDispatch, onExport, onImport, onFinish, onEdit, onDismiss } = props;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 1099px), (max-height: 649px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1099px), (max-height: 649px)');
    if (!media) return;
    const resize = () => setCompact(media.matches);
    media.addEventListener('change', resize); return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => { if (!compact && panel === 'Household') setPanel(null); }, [compact, panel]);
  const open = (next: Panel) => { onPause(); setPanel(next); };
  const chooseHome = (id: string) => { onSelect(id); setPanel(compact ? 'Household' : null); };
  const inspector = <HouseholdInspector view={view} selected={selected} unitId={unitId} shelterId={shelterId}
    onUnit={onUnit} onShelter={onShelter} onDetails={() => open('Details')} onClose={() => { onSelect(null); setPanel(null); }}
    onDispatch={intent => { onDispatch(intent); if (compact) setPanel(null); }} />;
  const home = view.households.find(h => h.id === selected);
  const occupied = view.shelters.reduce((sum, shelter) => sum + shelter.occupied, 0);
  const reserved = view.shelters.reduce((sum, shelter) => sum + shelter.reserved, 0);
  const free = view.shelters.reduce((sum, shelter) => sum + shelter.available, 0);
  const available = view.units.filter(unit => !unit.missionId).length;
  return <section className="response-screen" aria-label="Response dashboard">
    <div className="workspace-toolbar"><h1>Respond</h1><div className="playback-controls">
      <div className="exercise-clock"><time className="clock-display" aria-label={`Exercise time ${minuteLabel(view.minute)}`}>{minuteLabel(view.minute)}</time><span>/ 60 min</span></div>
      <Button variant="outline" onClick={onToggle} aria-label={running ? 'Pause exercise' : 'Resume exercise'}>{running ? <Pause /> : <Play />}{running ? 'Pause' : 'Run'}</Button>
      <Button variant="outline" onClick={onStep} aria-label="Advance one minute"><SkipForward /><span>+1 min</span></Button>
      <label className="sr-only" htmlFor="playback-speed">Playback speed</label><select id="playback-speed" value={speed} onChange={event => onSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
    </div><div className="toolbar-actions panel-triggers">{(['Homes', 'Teams', 'Activity', 'Details', 'Exercise'] as const).map(name => <Button id={`panel-${name.toLowerCase()}`} key={name} variant="ghost" onClick={() => open(name)}>{name}</Button>)}</div></div>
    <div className="resource-row" aria-label="Available resources">
      <div><Users /><span>Teams <strong>{available}/{view.units.length}</strong></span></div>
      <div><Package /><span>Kits <strong>{view.kits.available}</strong>{view.kits.reserved > 0 && <span className="reserved-count"> · {view.kits.reserved} reserved</span>}</span></div>
      <div><House /><span>Shelter <strong>{free} free</strong>{reserved > 0 && <span className="reserved-count"> · {reserved} reserved</span>}</span></div>
      <div className={view.networkGap === 'none' ? '' : 'outage-resource'}><RadioTower /><span>{view.networkGap === 'none' ? 'No outage' : `Outage · ${neighborhoodName(view.networkGap)}`}</span></div>
    </div>
    <div className="notice-slot" aria-live="polite">{notice && <div className={`compact-notice ${notice.urgentId ? 'urgent-notice' : ''}`} role={notice.urgentId ? 'alert' : 'status'}>{notice.urgentId && <TriangleAlert />}<span>{notice.text}</span>{notice.urgentId ? <Button size="sm" variant="outline" onClick={() => chooseHome(notice.urgentId!)}>Review need</Button> : <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss message">Dismiss</Button>}</div>}</div>
    <div className="response-workspace"><div className="map-panel"><TownMap view={view} selected={selected} onSelect={chooseHome} /></div>{!compact && <div className="inspector">{inspector}</div>}</div>
    {compact && selected && <Button className="compact-selection" variant="outline" onClick={() => open('Household')}>{selected} · {home ? householdStatus(home) : 'View home'}<ChevronRight /></Button>}
    {panel && <SecondaryPanel key={panel} title={panel === 'Household' ? selected ?? 'Home' : panel} onClose={() => setPanel(null)} fallbackFocusId={selected ? `map-home-${selected}` : 'panel-homes'}>
      {panel === 'Household' && inspector}
      {panel === 'Homes' && <div className="home-list">{view.households.map(item => <button key={item.id} className="home-list-row" onClick={() => chooseHome(item.id)}><House /><strong>{item.id}</strong><span>{householdStatus(item)}</span><ChevronRight /></button>)}</div>}
      {panel === 'Teams' && <div className="detail-stack">{view.units.map(unit => { const mission = view.missions.find(m => m.id === unit.missionId); return <section key={unit.id} className="detail-section"><h3>{unit.accessible ? <Accessibility /> : <Truck />}{unit.name} · {unit.id}</h3><p>{mission ? `${mission.householdId} · Done in ${Math.max(0, mission.completionAt - view.minute)} min` : 'Available'}</p>{unit.passengers > 0 && <p>{unit.passengers} passengers</p>}</section>; })}</div>}
      {panel === 'Activity' && <ol className="activity-list">{[...view.events].reverse().map(event => <li key={event.id}><time>{minuteLabel(event.minute)}</time><div><strong>{eventLabel(event)}{event.householdId ? ` · ${event.householdId}` : ''}</strong><details><summary>Details</summary><p>{event.message}</p></details></div></li>)}</ol>}
      {panel === 'Details' && <div className="detail-stack">{home && <section className="detail-section"><h3>{home.id}</h3><p>{home.address} · {neighborhoodName(home.neighborhood)}</p><p>{home.communications ? 'Network available' : 'Network outage'}</p>{home.known && <><p>Received {minuteLabel(home.known.receivedAt)} · {home.known.source === 'assessment' ? 'Team radio' : home.known.source === 'mirofish' ? 'Prepared request' : 'Simulation rule'}</p><p>{home.known.requestText}</p></>}</section>}<section className="detail-section"><h3>Resources</h3><p>Kits: {view.kits.available} available · {view.kits.reserved} reserved · {view.kits.consumed} delivered</p><p>Shelters: {free} free · {reserved} reserved · {occupied} occupied</p>{view.shelters.map(shelter => <p key={shelter.id}>{shelter.name}: {shelter.available} free{shelter.accessible ? ' · Accessible' : ''}</p>)}</section><section className="detail-section"><h3>Exercise assumptions</h3><p>24 fictional homes · 60 minutes</p><p>Fixed needs and outages. Preloaded kits. Teams use reliable radios.</p></section><Provenance artifact={artifact} /></div>}
      {panel === 'Exercise' && <div className="exercise-actions"><Button variant="outline" onClick={() => { setPanel(null); onImport(); }}><FileUp /> Import run</Button><Button variant="outline" onClick={() => { setPanel(null); onExport(); }}><FileDown /> Export run</Button><hr /><Button variant="outline" onClick={() => { setPanel(null); onEdit(); }}><RotateCcw /> New exercise</Button><Button variant="outline" onClick={() => { setPanel(null); onFinish(); }}><Check /> Finish exercise</Button></div>}
    </SecondaryPanel>}
  </section>;
}
