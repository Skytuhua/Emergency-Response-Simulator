import { useEffect } from 'react';
import { Accessibility, Check, ClipboardCheck, Clock3, House, Info, MapPin, Package, Search, Truck, Users, X } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import type { Action, CommandIntent, ObservationView } from '../model';
import { neighborhoodName } from '../map';
import { shortestPath } from '../sim/routes';
import { getBlockedReason, getPrimaryAction, getSuggestedAssignment, isAssignmentFeasible } from './suggestions';

interface HouseholdInspectorProps {
  view: ObservationView; selected: string | null; unitId: string; shelterId: string;
  onUnit: (id: string) => void; onShelter: (id: string) => void;
  onDispatch: (intent: CommandIntent) => void; onDetails: () => void; onClose: () => void;
}

const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const labels: Record<Action, string> = { ASSESS: 'Check home & run', DELIVER: 'Deliver kit & run', RELOCATE: 'Send transport & run' };

export function HouseholdInspector({ view, selected, unitId, shelterId, onUnit, onShelter, onDispatch, onDetails, onClose }: HouseholdInspectorProps) {
  const home = view.households.find(h => h.id === selected);
  const action = home ? getPrimaryAction(home) : null;
  const assignment = home && action ? getSuggestedAssignment(view, home.id, action, unitId) : null;
  const compatibleUnits = view.units.filter(unit => action === 'DELIVER' ? unit.kind === 'crew' : action === 'RELOCATE' ? unit.kind === 'van' && unit.seats >= (home?.known?.size ?? 0) && (!home?.known?.accessible || unit.accessible) : true);
  const chosenUnitId = assignment?.unitId ?? compatibleUnits.find(unit => unit.id === unitId)?.id ?? compatibleUnits[0]?.id ?? view.units.find(unit => unit.id === unitId)?.id ?? view.units[0]?.id ?? '';
  const manualShelter: CommandIntent | null = home && action === 'RELOCATE'
    ? { action, householdId: home.id, unitId: chosenUnitId, shelterId }
    : null;
  const fallbackShelter = view.shelters.find(shelter => shelter.id === shelterId) ?? view.shelters.find(shelter => !home?.known?.accessible || shelter.accessible) ?? view.shelters[0];
  const chosenShelterId = manualShelter && isAssignmentFeasible(view, manualShelter) ? shelterId : assignment?.shelterId ?? fallbackShelter?.id ?? '';
  const intent: CommandIntent | null = home && action ? { action, householdId: home.id, unitId: chosenUnitId, ...(action === 'RELOCATE' ? { shelterId: chosenShelterId } : {}) } : null;
  const blocked = intent ? getBlockedReason(view, intent.householdId, intent.action, intent.unitId, intent.shelterId) : null;
  const mission = home ? view.missions.find(m => m.id === home.missionId && m.status !== 'completed') : undefined;
  const recheck = home && !mission && home.known ? getSuggestedAssignment(view, home.id, 'ASSESS', unitId) : null;

  useEffect(() => {
    if (!assignment) return;
    if (unitId !== chosenUnitId) onUnit(chosenUnitId);
    if (action === 'RELOCATE' && shelterId !== chosenShelterId) onShelter(chosenShelterId);
  }, [assignment?.unitId, assignment?.shelterId, chosenUnitId, chosenShelterId, unitId, shelterId, action, onUnit, onShelter]);

  if (!home) return <aside className="inspector-panel inspector-empty" aria-label="Household inspector">
    <MapPin size={30} aria-hidden="true" /><h2>Select a home</h2>
  </aside>;

  const helped = home.completedAt !== null;
  const need = home.known?.need;
  const title = helped ? 'Helped' : mission ? 'Team assigned' : !home.known ? 'Need not yet known' : !need ? 'No current need' : need.kind === 'delivery' ? 'Supply kit needed' : 'Shelter relocation';
  const route = intent ? shortestPath(view.map, view.units.find(u => u.id === chosenUnitId)?.nodeId ?? '', home.nodeId) : null;
  const onward = intent?.action === 'RELOCATE' ? shortestPath(view.map, home.nodeId, view.shelters.find(s => s.id === chosenShelterId)?.nodeId ?? '') : null;
  const completion = !blocked && route && action ? view.minute + route.minutes + (action === 'RELOCATE' ? (onward?.minutes ?? 0) + 4 : 2) : null;
  const StageIcon = helped ? Check : mission ? Truck : !home.known ? Search : need?.kind === 'delivery' ? Package : need ? Truck : ClipboardCheck;
  const missionLabel = mission?.status === 'boarding' ? 'Boarding' : mission?.status === 'transporting' ? 'Travelling to shelter' : mission?.action === 'ASSESS' ? 'Checking home' : mission?.action === 'DELIVER' ? 'Delivering kit' : 'Travelling to home';

  return <aside className="inspector-panel" aria-label="Household inspector">
    <header className="inspector-heading">
      <div><h2><House size={19} aria-hidden="true" />Home {home.id}</h2><p>{home.address} · {neighborhoodName(home.neighborhood)}</p></div>
      <Button variant="ghost" size="icon-sm" aria-label="Close home" onClick={onClose}><X aria-hidden="true" /></Button>
    </header>
    <section className="case-state" aria-label="Home status">
      <h3><StageIcon size={20} aria-hidden="true" />{title}</h3>
      {!helped && need && <div className="case-deadline">{need.urgent && <Badge variant="destructive">Urgent</Badge>}<span>Due {time(need.deadline)}</span></div>}
      {helped && <p className="case-completed">Completed {time(home.completedAt!)}</p>}
      {home.known && <div className="case-facts"><span><Users size={16} aria-hidden="true" />{home.known.size} {home.known.size === 1 ? 'resident' : 'residents'}</span>{home.known.accessible && <span><Accessibility size={16} aria-hidden="true" />Accessible transport</span>}</div>}
      {mission && <div className="case-mission" role="status"><strong>{missionLabel}</strong><span><Clock3 size={16} aria-hidden="true" />Done in {Math.max(0, mission.completionAt - view.minute)} min</span></div>}
    </section>

    {action && <section className="inspector-assignment" aria-label="Assignment">
      <label htmlFor="inspector-unit">Response unit</label>
      <select id="inspector-unit" value={chosenUnitId} onChange={event => onUnit(event.target.value)}>
        {!view.units.length && <option value="">No teams available</option>}
        {view.units.map(unit => {
          const candidate = getSuggestedAssignment(view, home.id, action, unit.id);
          const feasible = candidate?.unitId === unit.id;
          return <option key={unit.id} value={unit.id} disabled={!feasible}>{unit.id} · {unit.name}{unit.missionId ? ' · Busy' : ''}</option>;
        })}
      </select>
      {action === 'RELOCATE' && <><label htmlFor="inspector-shelter">Destination shelter</label><select id="inspector-shelter" value={chosenShelterId} onChange={event => onShelter(event.target.value)}>
        {!view.shelters.length && <option value="">No shelters available</option>}
        {view.shelters.map(shelter => <option key={shelter.id} value={shelter.id} disabled={!isAssignmentFeasible(view, { action, householdId: home.id, unitId: chosenUnitId, shelterId: shelter.id })}>{shelter.name} · {shelter.available} places available</option>)}
      </select></>}
      <Button className="inspector-primary" disabled={!!blocked} aria-describedby={blocked ? 'inspector-blocker' : undefined} onClick={() => { if (intent && !blocked) onDispatch(intent); }}>{action === 'ASSESS' ? <Search aria-hidden="true" /> : action === 'DELIVER' ? <Package aria-hidden="true" /> : <Truck aria-hidden="true" />}{labels[action]}</Button>
      {blocked ? <p id="inspector-blocker" className="inspector-blocker" role="status">{blocked}</p> : completion !== null && <p className="inspector-completion"><Clock3 size={16} aria-hidden="true" />Completes {time(completion)}{action === 'DELIVER' ? ' · reserves 1 kit' : action === 'RELOCATE' ? ` · reserves ${home.known!.size} places` : ''}</p>}
    </section>}

    <footer className="inspector-footer"><Button variant="outline" size="sm" onClick={onDetails}><Info aria-hidden="true" />Details</Button>{recheck && <details className="inspector-more"><summary>More actions</summary><Button variant="outline" size="sm" onClick={() => onDispatch(recheck)}>Recheck home &amp; run</Button></details>}</footer>
  </aside>;
}
