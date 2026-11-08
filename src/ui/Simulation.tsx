import { useEffect, useState } from 'react';
import { Accessibility, CheckCircle2, ChevronRight, FileDown, FileUp, House, Package, Pause, Play, RadioTower, RotateCcw, SkipForward, TriangleAlert, Truck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import type { AgentArtifact, ObservationView, SimEvent } from '../model';
import { HORIZON } from '../model';
import { neighborhoodName } from '../map';
import { getPriorityGroups } from './priorities';
import { ObservationInspector, observationHomeStatus, observationTime } from './ObservationInspector';
import { PersonaFlow } from './PersonaFlow';
import { Provenance } from './Provenance';
import { SecondaryPanel } from './SecondaryPanel';
import { TownMap } from './TownMap';
import './simulation.css';

type Panel = 'Residents' | 'Coordinator' | 'Homes' | 'Teams' | 'Activity' | 'Details' | 'Exercise';
export interface SimulationProps {
  view: ObservationView; artifact: AgentArtifact | null; selected: string | null; running: boolean; speed: number;
  notice?: { text: string; urgentId?: string } | null;
  onSelect: (id: string | null) => void; onToggle: () => void; onStep?: () => void;
  onSpeed: (speed: number) => void; onPause: () => void; onExport: () => void; onImport: () => void;
  onRestart: () => void; onEdit: () => void; onFinish: () => void;
}
const compactQuery = '(max-width: 1199px)';
const eventTitle = (event: SimEvent) => ({ dispatch: 'Team assigned', assessment: 'Home checked', request: 'Report received', pickup: 'Residents boarded', completion: 'Assistance completed', system: 'Simulation update' })[event.type];

/** Observation and playback only. All responder choices belong to the automatic policy. */
export function Simulation(props: SimulationProps) {
  const { view, artifact, selected, running, speed, notice, onSelect, onToggle, onStep, onSpeed, onPause, onExport, onImport, onRestart, onEdit, onFinish } = props;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia?.(compactQuery).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(compactQuery);
    if (!media) return;
    const resize = () => setCompact(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const open = (next: Panel) => { onPause(); setPanel(next); };
  const chooseHome = (id: string) => { onSelect(id); if (compact) open('Coordinator'); else setPanel(null); };
  const inspect = (id: string) => { onSelect(id); open('Details'); };
  const groups = getPriorityGroups(view);
  const waiting = groups['needs-help'];
  const unchecked = view.households.filter(item => !item.known && item.assessedAt === null);
  const active = view.missions.filter(mission => mission.status !== 'completed');
  const available = view.units.filter(unit => !unit.missionId).length;
  const free = view.shelters.reduce((sum, item) => sum + item.available, 0);
  const reserved = view.shelters.reduce((sum, item) => sum + item.reserved, 0);
  const home = view.households.find(item => item.id === selected);
  const residents = <div
    onClickCapture={event => { if (event.target instanceof Element && event.target.closest('summary')) onPause(); }}
    onKeyDownCapture={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('summary')) onPause(); }}>
    <PersonaFlow view={view} artifact={artifact} selected={selected} onSelect={chooseHome} onInspect={inspect} />
  </div>;
  const coordinator = <section className="observation-coordinator" aria-label="Automatic coordinator">
    <header className="observation-panel-heading"><h2>Coordinator</h2><span>Rule based</span></header>
    <div className="observation-coordinator-body">
      <dl className="observation-counts"><div><dt>Waiting</dt><dd>{waiting.length}</dd></div><div><dt>Active</dt><dd>{active.length}</dd></div><div><dt>Completed</dt><dd>{view.assistedCount}</dd></div></dl>
      <ObservationInspector view={view} selected={selected} onDetails={() => open('Details')} />
      {waiting.length > 0 && <section className="observation-queue" aria-label="Known needs waiting"><h3>Known needs waiting</h3>{waiting.slice(0, 3).map(item => <button key={item.id} className={`observation-queue-home${selected === item.id ? ' selected' : ''}`} onClick={() => chooseHome(item.id)}><strong>{item.id}</strong><span>{item.known!.need!.urgent ? 'Urgent · ' : ''}{item.known!.need!.kind === 'delivery' ? 'Supplies' : 'Transport'}</span><ChevronRight aria-hidden="true" /></button>)}</section>}
      <p className="observation-muted">{unchecked.length} homes with needs still unknown{unchecked.some(item => !item.communications) ? ' · includes homes unable to call' : ''}.</p>
      <Button variant="ghost" onClick={() => open('Homes')}>View all homes <ChevronRight aria-hidden="true" /></Button>
    </div>
  </section>;
  return <section className="simulation-screen" aria-label="Automatic simulation observation">
    <div className="simulation-toolbar">
      <div className="simulation-title"><h1>Observe simulation</h1><span>{view.finalized ? 'Playback ended' : running ? 'Automatic response running' : 'Playback paused'}</span></div>
      <div className="simulation-playback">
        <time className="clock-display" aria-label={`Simulation time ${observationTime(view.minute)}`}>{observationTime(view.minute)}<span> / {HORIZON} min</span></time>
        <Button variant="outline" onClick={onToggle} disabled={view.finalized} aria-label={running ? 'Pause simulation' : 'Resume simulation'}>{running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{running ? 'Pause' : 'Resume'}</Button>
        {onStep && <Button variant="ghost" size="icon" disabled={view.finalized} onClick={onStep} aria-label="Advance one minute" title="Advance one minute"><SkipForward aria-hidden="true" /></Button>}
        <label className="sr-only" htmlFor="simulation-speed">Playback speed</label><select id="simulation-speed" value={speed} onChange={event => onSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
      </div>
      <nav className="simulation-panels" aria-label="Observation panels">{(['Homes', 'Teams', 'Activity', 'Details', 'Exercise'] as const).map(name => <Button key={name} id={`observation-panel-${name.toLowerCase()}`} variant="ghost" onClick={() => open(name)}>{name}</Button>)}</nav>
    </div>
    <div className="simulation-resources" aria-label="Simulation resources">
      <div><Users aria-hidden="true" /><span>Teams <strong>{available}/{view.units.length} free</strong></span></div>
      <div><Package aria-hidden="true" /><span>Kits <strong>{view.kits.available} free</strong>{view.kits.reserved > 0 && <span> · {view.kits.reserved} reserved</span>}</span></div>
      <div><House aria-hidden="true" /><span>Shelter <strong>{free} places free</strong>{reserved > 0 && <span> · {reserved} reserved</span>}</span></div>
      <div className={view.networkGap === 'none' ? '' : 'simulation-outage'}><RadioTower aria-hidden="true" /><span>{view.networkGap === 'none' ? 'Communications available' : `Outage · ${neighborhoodName(view.networkGap)}`}</span></div>
    </div>
    {notice && <div className={`simulation-notice${notice.urgentId ? ' urgent' : ''}`} role={notice.urgentId ? 'alert' : 'status'}>{notice.urgentId && <TriangleAlert aria-hidden="true" />}<span>{notice.text}</span>{notice.urgentId && <Button size="sm" variant="outline" onClick={() => chooseHome(notice.urgentId!)}>View home</Button>}</div>}
    {compact && <div className="simulation-focus-panels"><Button id="observation-panel-residents" variant="outline" onClick={() => open('Residents')}>Residents</Button><Button id="observation-panel-coordinator" variant="outline" onClick={() => open('Coordinator')}>Coordinator{selected ? ` · ${selected}` : ''}</Button></div>}
    <div className="simulation-workspace">
      {!compact && <div className="simulation-residents">{residents}</div>}
      <section className="simulation-map-section" aria-label="Response map"><div className="simulation-map-heading"><h2>{view.map.kind === 'osm-driving' ? 'Dallas response' : 'Response area'}</h2><span>Moving teams · recorded routes</span></div><div className="simulation-map map-panel"><TownMap view={view} selected={selected} onSelect={chooseHome} /></div></section>
      {!compact && coordinator}
    </div>
    {panel && <SecondaryPanel key={panel} title={panel} className="simulation-secondary" onClose={() => setPanel(null)} fallbackFocusId={`observation-panel-${panel.toLowerCase()}`}>
      {panel === 'Residents' && residents}
      {panel === 'Coordinator' && coordinator}
      {panel === 'Homes' && <div className="home-list">{view.households.map(item => <button key={item.id} className="home-list-row" onClick={() => chooseHome(item.id)}><House aria-hidden="true" /><strong>{item.id}</strong><span>{observationHomeStatus(item)}</span><ChevronRight aria-hidden="true" /></button>)}</div>}
      {panel === 'Teams' && <div className="detail-stack">{view.units.map(unit => { const mission = active.find(item => item.unitId === unit.id); return <section key={unit.id} className="detail-section"><h3>{unit.accessible ? <Accessibility aria-hidden="true" /> : <Truck aria-hidden="true" />}{unit.name} · {unit.id}</h3><p>{mission ? `${mission.action === 'ASSESS' ? 'Welfare check' : mission.action === 'DELIVER' ? 'Supply delivery' : 'Shelter transport'} · ${mission.householdId}` : 'Available for automatic assignment'}</p>{mission && <p>{mission.status} · completion {observationTime(mission.completionAt)}</p>}{unit.passengers > 0 && <p>{unit.passengers} residents aboard; assistance completes at shelter arrival.</p>}</section>; })}</div>}
      {panel === 'Activity' && <ol className="activity-list">{[...view.events].reverse().map(event => <li key={event.id}><time>{observationTime(event.minute)}</time><div><strong>{eventTitle(event)}{event.householdId ? ` · ${event.householdId}` : ''}</strong><p>{event.message}</p></div></li>)}</ol>}
      {panel === 'Details' && <div className="detail-stack">
        {home && <section className="detail-section"><h3>Public observation · {home.id}</h3><p>{home.address} · {neighborhoodName(home.neighborhood)}</p><p>{home.communications ? 'Phone and internet available' : 'Phone and internet outage: a prepared report may fail to reach the coordinator.'}</p>{home.known ? <><p>Received {observationTime(home.known.receivedAt)} · {home.known.source === 'assessment' ? 'team radio' : home.known.source === 'mirofish' ? 'prepared resident report' : 'reporting rule'}</p><p className="observation-source-text">{home.known.requestText}</p></> : <p>No household need has reached the coordinator. Prepared persona context does not establish an observed need.</p>}</section>}
        <section className="detail-section"><h3>Prepared AI and automatic rules</h3><p>{artifact?.profiles.some(profile => profile.outcome === 'llm') ? `${artifact.profiles.filter(profile => profile.outcome === 'llm').length} resident representatives have retained model-generated profiles. The remaining homes follow reporting rules.` : 'No verified model-generated resident profile is loaded. Homes follow reporting rules.'}</p><p>Prepared reports can reach the public observation state only through reporting or a team radio assessment. Communications outages can block calls.</p><p>The coordinator reads public observations, ranks known urgent needs and checks unreported homes. Assignments, resource reservations, road travel and completion use deterministic rules. Playback makes no model calls.</p><p>Persona illustrations are decorative. Full retained source is available in the provenance below.</p></section>
        <section className="detail-section"><h3>Resources and assumptions</h3><p>{view.households.length} fictional homes · {HORIZON} simulated minutes.</p><p>{view.map.kind === 'osm-driving' ? 'Real Dallas street geometry with fictional residents, incidents and response capacities.' : 'Fictional training town, residents and incidents.'}</p><p>Kits: {view.kits.available} free · {view.kits.reserved} reserved · {view.kits.consumed} delivered.</p>{view.shelters.map(shelter => <p key={shelter.id}>{shelter.name}: {shelter.available} free · {shelter.reserved} reserved · {shelter.occupied} occupied{shelter.accessible ? ' · accessible' : ''}.</p>)}<p>Fixed needs and outages, preloaded kits, reliable team radios and assumed exercise travel times.</p></section>
        <Provenance artifact={artifact} debrief />
      </div>}
      {panel === 'Exercise' && <div className="exercise-actions"><p>Opening a panel pauses playback. Resume when you are ready to continue observing.</p><Button variant="outline" onClick={() => { setPanel(null); onImport(); }}><FileUp aria-hidden="true" />Import run</Button><Button variant="outline" onClick={() => { setPanel(null); onExport(); }}><FileDown aria-hidden="true" />Export run</Button><hr /><Button variant="outline" onClick={() => { setPanel(null); onRestart(); }}><RotateCcw aria-hidden="true" />Restart simulation</Button><Button variant="outline" onClick={() => { setPanel(null); onEdit(); }}>New simulation</Button><Button variant="outline" onClick={() => { setPanel(null); onFinish(); }}><CheckCircle2 aria-hidden="true" />View outcomes</Button></div>}
    </SecondaryPanel>}
  </section>;
}
