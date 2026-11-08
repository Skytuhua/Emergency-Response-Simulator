import { Accessibility, ArrowRight, Check, ChevronRight, Circle, ClipboardCheck, Clock3, FileDown, House, Info, List, MapPin, Package, Pause, Play, RadioTower, Search, ShieldCheck, SkipForward, TriangleAlert, Truck, Users, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { Action, CommandIntent, ObservationView, ObservedHousehold } from '../model';
import { shortestPath } from '../sim/routes';
import { neighborhoodName } from '../map';
import { TownMap } from './TownMap';

export const minuteLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const householdStatus = (home: ObservedHousehold) => home.completedAt !== null ? 'Assisted' : home.missionId ? 'Unit assigned' : home.known?.need ? (home.known.need.urgent ? 'Urgent need' : 'Known need') : home.assessedAt !== null ? 'No current need' : 'Unassessed';

interface ResponseProps {
  view: ObservationView; selected: string | null; unitId: string; shelterId: string;
  running: boolean; speed: number; notice: { text: string; urgentId?: string } | null;
  onSelect: (id: string | null) => void; onUnit: (id: string) => void; onShelter: (id: string) => void;
  onToggle: () => void; onStep: () => void; onSpeed: (speed: number) => void;
  onDispatch: (intent: CommandIntent) => void; onExport: () => void; onFinish: () => void; onDismiss: () => void;
}

export function Response(props: ResponseProps) {
  const { view, selected, unitId, shelterId, running, speed, notice, onSelect, onUnit, onShelter, onToggle, onStep, onSpeed, onDispatch, onExport, onFinish, onDismiss } = props;
  const home = view.households.find(h => h.id === selected) ?? null;
  const unit = view.units.find(u => u.id === unitId) ?? view.units[0];
  const shelter = view.shelters.find(s => s.id === shelterId) ?? view.shelters[0];
  const activeMission = home ? view.missions.find(m => m.id === home.missionId) : undefined;
  const occupied = view.shelters.reduce((sum, s) => sum + s.occupied, 0), reserved = view.shelters.reduce((sum, s) => sum + s.reserved, 0), capacity = view.shelters.reduce((sum, s) => sum + s.capacity, 0);
  const busy = view.units.filter(u => u.missionId).length;
  const route = home && unit ? shortestPath(view.map, unit.nodeId, home.nodeId) : null;
  const shelterRoute = home && shelter ? shortestPath(view.map, home.nodeId, shelter.nodeId) : null;
  const blockedReason = (action: Action): string | null => {
    if (view.finalized) return 'The exercise has ended.';
    if (!home) return 'Select a household.';
    if (home.missionId) return 'A unit is already assigned to this household.';
    if (home.completedAt !== null) return 'This household has already been assisted.';
    if (!unit || unit.missionId) return 'Choose an available response unit.';
    if (!route) return 'There is no open route to this household.';
    if (action === 'ASSESS') return home.assessedAt !== null ? 'This household has already been assessed.' : null;
    if (!home.known) return 'Assess or receive a request first.';
    if (!home.known.need) return 'There is no current assistance need.';
    if (action === 'DELIVER') {
      if (home.known.need.kind !== 'delivery') return 'This household needs transport, not a supply kit.';
      if (unit.kind !== 'crew') return 'Choose the response crew to deliver a kit.';
      if (view.kits.available < 1) return 'No unreserved supply kits remain.';
    }
    if (action === 'RELOCATE') {
      if (home.known.need.kind !== 'relocation') return 'This household needs a supply kit.';
      if (unit.kind !== 'van') return 'Choose a transport van to relocate this household.';
      if (home.known.accessible && !unit.accessible) return 'This household requires accessible transport.';
      if (home.known.size > unit.seats) return 'The household exceeds the vehicle seat capacity.';
      if (!shelter || !shelterRoute) return 'Choose a reachable shelter.';
      if (home.known.accessible && !shelter.accessible) return 'Choose the accessible East Shelter.';
      if (shelter.available < home.known.size) return `Only ${shelter.available} unreserved shelter places remain.`;
    }
    return null;
  };
  const action = (kind: Action) => home && onDispatch({ action: kind, unitId: unit.id, householdId: home.id, ...(kind === 'RELOCATE' ? { shelterId: shelter.id } : {}) });
  const preferred = home?.known?.need?.kind === 'relocation' ? 'RELOCATE' : home?.known?.need?.kind === 'delivery' ? 'DELIVER' : 'ASSESS';
  const reason = home ? blockedReason(preferred) : null;
  const eta = route ? view.minute + route.minutes + (preferred === 'RELOCATE' ? (shelterRoute?.minutes ?? 0) + 4 : 2) : null;

  return <>
    <div className="page-heading response-heading"><div><h1>Coordinate the response</h1><p>{view.contactCount} of 24 households contacted · {view.requests.filter(h => !h.missionId).length} known needs awaiting assistance</p></div><div className="heading-actions"><div className="clock-display">{minuteLabel(view.minute)}<small>EXERCISE TIME / 01:00</small></div><div className="clock-controls"><Button size="sm" variant={running ? 'secondary' : 'default'} onClick={onToggle} aria-label={running ? 'Pause exercise' : 'Resume exercise'}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? 'Pause' : 'Resume'}</Button><Button size="sm" variant="outline" onClick={onStep} aria-label="Advance one minute"><SkipForward size={14} /><span className="step-label">Step</span></Button><label className="sr-only" htmlFor="playback-speed">Playback speed</label><select id="playback-speed" className="speed-select" value={speed} onChange={e => onSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><Button variant="outline" size="icon-sm" onClick={onExport} aria-label="Export run"><FileDown size={15} /></Button></div></div></div>
    {notice && <div className={`status-message ${notice.urgentId ? '' : 'info'}`} role={notice.urgentId ? 'alert' : 'status'}><div>{notice.urgentId ? <TriangleAlert size={17} /> : <Info size={17} />}<span>{notice.text}</span></div>{notice.urgentId ? <Button variant="outline" size="sm" onClick={() => onSelect(notice.urgentId!)}>Review need <ArrowRight size={13} /></Button> : <button onClick={onDismiss} aria-label="Dismiss message" style={{ border: 0, background: 'none', color: 'inherit' }}><X size={15} /></button>}</div>}
    <div className="resource-bar"><div className="resource-item"><Truck size={30} /><div><span className="resource-label">Response units</span><strong>{view.units.length - busy} <small>/ {view.units.length} available</small></strong></div></div><div className="resource-item"><Package size={29} /><div><span className="resource-label">Supply kits</span><strong>{view.kits.available} <small>available · {view.kits.reserved} reserved</small></strong></div></div><div className="resource-item"><House size={29} /><div><span className="resource-label">Shelter occupancy</span><strong>{occupied} <small>/ {capacity} · {reserved} reserved</small></strong><div className="capacity-track"><div style={{ width: `${capacity ? (occupied + reserved) / capacity * 100 : 0}%` }} /></div></div></div><div className="resource-item network"><RadioTower size={28} /><div><span className="resource-label">Household communications</span><strong>{view.networkGap !== 'none' ? <><Badge variant="destructive" className="text-[9px] rounded">OUTAGE</Badge>{neighborhoodName(view.networkGap)}</> : <><Check size={13} /> All channels connected</>}</strong></div></div></div>
    <div className="response-layout"><section className="map-panel" aria-label="Response map"><TownMap view={view} selected={selected} onSelect={onSelect} /></section><aside className="panel inspector" aria-label="Household inspector">
      {home ? <><div className="inspector-header"><House size={28} /><div><h2>Household {home.id}</h2><p>{home.address} · {neighborhoodName(home.neighborhood)}</p></div><button className="close-inspector" aria-label="Close inspector" onClick={() => onSelect(null)}><X size={16} /></button></div>
        <div className="known-need"><div className="need-label">{home.known?.need ? <Package size={17} /> : <Search size={17} />}{home.known ? 'Assessment / received request' : 'Need not yet known'}</div><div className="need-name">{home.known?.need ? home.known.need.kind === 'delivery' ? 'Supply kit needed' : 'Shelter relocation' : home.known ? 'No current need' : 'Welfare check needed'}</div><div className="urgency-row">{home.known?.need?.urgent ? <><TriangleAlert size={14} /><span>Urgency</span><Badge variant="destructive" className="text-[10px]">High · by {minuteLabel(home.known.need.deadline)}</Badge></> : <><ClipboardCheck size={14} /><span>{householdStatus(home)}</span>{home.known?.need && <span style={{ marginLeft: 'auto' }}>By {minuteLabel(home.known.need.deadline)}</span>}</>}</div></div>
        <dl className="facts-list"><div><dt><Users size={14} /> Household</dt><dd>{home.known ? `${home.known.size} people${home.known.accessible ? ' · accessible transport' : ''}` : 'Not yet assessed'}</dd></div><div><dt><ShieldCheck size={14} /> Status</dt><dd>{householdStatus(home)}</dd></div><div><dt><RadioTower size={14} /> Communications</dt><dd>{home.communications ? 'Household network available' : 'No household contact · outage'}</dd></div>{home.known && <div><dt><Clock3 size={14} /> Evidence received</dt><dd>{minuteLabel(home.known.receivedAt)} · {home.known.source === 'assessment' ? 'Responder radio' : home.known.source === 'mirofish' ? 'Prepared social request' : 'Rule-based request'}</dd></div>}</dl>
        {!home.known && <p className="inspector-instruction">Silence does not mean safety. Send a welfare check to learn whether this household needs assistance.</p>}
        {activeMission && <div className="eta-note"><strong>{activeMission.unitId} assigned · {activeMission.action.toLowerCase()}</strong><br />{activeMission.pickupAt !== null && <>Pickup {minuteLabel(activeMission.pickupAt)} · </>}Completion {minuteLabel(activeMission.completionAt)}{activeMission.shelterId && <> · Shelter {activeMission.shelterId}</>}<br />Unit committed until completion. Assignment is not assistance.</div>}
        <div className="dispatch-section"><h3>Dispatch assistance</h3><div className="dispatch-selects"><label className="sr-only" htmlFor="dispatch-unit">Response unit</label><select id="dispatch-unit" value={unitId} onChange={e => onUnit(e.target.value)}>{view.units.map(u => <option key={u.id} value={u.id}>{u.id} · {u.kind === 'crew' ? 'Crew' : u.accessible ? 'Accessible van' : 'General van'}{u.missionId ? ' (busy)' : ''}</option>)}</select>{home.known?.need?.kind === 'relocation' && <><label className="sr-only" htmlFor="dispatch-shelter">Destination shelter</label><select id="dispatch-shelter" value={shelterId} onChange={e => onShelter(e.target.value)}>{view.shelters.map(s => <option key={s.id} value={s.id}>{s.name} · {s.available} free</option>)}</select></>}</div><div className="action-buttons"><button type="button" className={`action-button ${preferred === 'ASSESS' ? 'primary' : ''}`} disabled={!!blockedReason('ASSESS')} title={blockedReason('ASSESS') ?? 'Travel to household and assess for two minutes'} onClick={() => action('ASSESS')}><Search size={17} /> Assess<span className="action-description">Discover needs</span><ChevronRight size={15} /></button><button type="button" className={`action-button ${preferred === 'DELIVER' ? 'primary' : ''}`} disabled={!!blockedReason('DELIVER')} title={blockedReason('DELIVER') ?? 'Reserve one kit; assistance completes after delivery'} onClick={() => action('DELIVER')}><Package size={16} /> Deliver kit<span className="action-description">Reserve 1 kit</span><ChevronRight size={15} /></button><button type="button" className={`action-button ${preferred === 'RELOCATE' ? 'primary' : ''}`} disabled={!!blockedReason('RELOCATE')} title={blockedReason('RELOCATE') ?? 'Reserve shelter places and dispatch transport'} onClick={() => action('RELOCATE')}><Users size={17} /> Relocate<span className="action-description">Move to shelter</span><ChevronRight size={15} /></button></div>{reason ? <p className="dispatch-note">{reason}</p> : eta !== null && <p className="dispatch-note">{unit.id} → {home.id}{preferred === 'RELOCATE' ? ` → ${shelter.name}` : ''} · completion {minuteLabel(eta)}{preferred === 'RELOCATE' ? ` · reserves ${home.known?.size} places` : preferred === 'DELIVER' ? ' · reserves 1 kit' : ''}. Unit committed until completion.</p>}</div>
      </> : <div className="empty-inspector"><MapPin size={40} strokeWidth={1.3} /><h2>Start with a welfare check</h2><p>Select an unassessed home on the map, choose a unit, and send a welfare check. Households without communications need someone to reach them.</p><Button className="first-household" variant="outline" size="sm" onClick={() => onSelect('H19')}><Search size={14} /> Select a southeast home</Button></div>}
    </aside></div>
    <div className="response-footer"><div className="unit-section"><h2 className="strip-heading"><Truck size={15} /> Response units</h2><div className="unit-list">{view.units.map(u => { const mission = view.missions.find(m => m.id === u.missionId); return <button key={u.id} className={`unit-card ${u.missionId ? 'busy' : ''} ${unitId === u.id ? 'selected' : ''}`} onClick={() => onUnit(u.id)} aria-pressed={unitId === u.id}>{u.kind === 'crew' ? <Users size={24} /> : u.accessible ? <Accessibility size={24} /> : <Truck size={24} />}<div><strong>{u.id} · {u.kind === 'crew' ? 'Response crew' : u.accessible ? 'Accessible' : 'Transport'}</strong><small><Circle />{mission ? `${mission.householdId} · ETA ${minuteLabel(mission.completionAt)}` : 'Available'}</small></div></button>; })}</div></div><div className="recent-events"><h2 className="strip-heading"><List size={15} /> Recent events</h2><ul>{view.events.slice(-3).reverse().map(event => <li key={event.id}><time>{minuteLabel(event.minute)}</time>{event.urgent ? <TriangleAlert size={12} color="#ba2835" /> : event.type === 'completion' ? <Check size={12} color="#2f8a59" /> : <Info size={12} />}<span>{event.message}</span></li>)}</ul></div></div>
    <details className="household-list-panel"><summary><List size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} /> Select household from accessible list · {view.assessedCount}/24 assessed</summary><div className="household-grid">{view.households.map(h => <button key={h.id} className={`household-list-button ${selected === h.id ? 'selected' : ''}`} onClick={() => onSelect(h.id)} aria-pressed={selected === h.id}><House size={13} />{h.id}<span>{householdStatus(h)}</span></button>)}</div></details>
    <div className="bottom-note"><span><ShieldCheck size={12} /> Fictional exercise · 1×: one simulated minute every two seconds</span><span><Button variant="link" size="xs" onClick={onFinish}>Finish at minute 60 <ArrowRight size={12} /></Button></span></div>
  </>;
}
