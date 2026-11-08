import { Accessibility, CheckCircle2, Clock3, House, Package, RadioTower, Search, Truck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { Mission, ObservationView, ObservedHousehold } from '../model';
import { getAutomaticWaitingReason } from '../sim/automatic';

export const observationTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function observationHomeStatus(home: ObservedHousehold): string {
  if (home.completedAt !== null) return 'Assistance completed';
  if (home.missionId) return 'Team assigned';
  if (home.known?.need) return home.known.need.urgent ? 'Urgent need' : 'Needs assistance';
  return home.known ? 'No current need' : 'Not checked';
}

function missionStage(mission: Mission, minute: number): string {
  if (mission.status === 'boarding') return 'Residents boarding';
  if (mission.status === 'transporting') return 'Traveling to shelter';
  if (minute < mission.arrivalAt) return mission.action === 'ASSESS' ? 'Welfare check on the way' : 'Assistance on the way';
  return mission.action === 'ASSESS' ? 'Checking home' : 'Delivering supplies';
}

/** Only public observations belong here. Prepared persona prose is evidence in Details. */
export function ObservationInspector({ view, selected, onDetails }: {
  view: ObservationView; selected: string | null; onDetails: () => void;
}) {
  const home = view.households.find(item => item.id === selected);
  if (!home) return <aside className="observation-inspector observation-empty" aria-label="Observed home">
    <House size={28} aria-hidden="true" /><h3>Follow a home</h3><p>Select a resident or map home.</p>
  </aside>;
  const mission = view.missions.find(item => item.householdId === home.id && item.status !== 'completed');
  const need = home.known?.need;
  const completed = home.completedAt !== null;
  const title = completed ? 'Assistance completed' : mission ? missionStage(mission, view.minute) : !home.known ? 'Need not yet known' : !need ? 'No current need' : need.kind === 'delivery' ? 'Needs supplies' : 'Needs transport';
  const Icon = completed ? CheckCircle2 : mission ? Truck : !home.known ? Search : need?.kind === 'delivery' ? Package : need ? Truck : House;
  const remaining = need ? need.deadline - view.minute : 0;
  const waiting = !completed && !mission && (!home.known || need) ? getAutomaticWaitingReason(view, home.id) : null;
  const unit = view.units.find(item => item.id === mission?.unitId);
  const shelter = view.shelters.find(item => item.id === mission?.shelterId);
  return <aside className="observation-inspector" aria-label="Observed home">
    <header className="observation-home-heading"><h3>Home {home.id}</h3><p>{home.address}</p></header>
    <section className={`observation-home-state${completed ? ' is-completed' : ''}`} aria-label="Observed status">
      <h3><Icon size={19} aria-hidden="true" />{title}</h3>
      {completed && <p>Completed {observationTime(home.completedAt!)}</p>}
      {!completed && need && <><div className="observation-urgency">{need.urgent && <Badge variant="destructive">Urgent</Badge>}<span>Due {observationTime(need.deadline)} · {remaining > 0 ? `${remaining} min left` : remaining === 0 ? 'due now' : `${-remaining} min overdue`}</span></div></>}
      {mission && <div className="observation-mission">
        <strong>{mission.unitId}{shelter ? ` → ${shelter.name}` : unit ? ` · ${unit.name}` : ''}</strong>
        <p><Clock3 size={15} aria-hidden="true" />{mission.action === 'ASSESS' ? 'Check' : 'Completion'} in {Math.max(0, mission.completionAt - view.minute)} min</p>
      </div>}
    </section>
    <section className="observation-known" aria-label="Known facts">
      <h3>Known to coordinator</h3>
      <p className={home.communications ? '' : 'observation-outage'}><RadioTower size={16} aria-hidden="true" />{home.communications ? 'Phone and internet available' : 'Cannot call · phone and internet outage'}</p>
      {home.known ? <><div className="observation-fact-chips"><p><Users size={16} aria-hidden="true" />{home.known.size} {home.known.size === 1 ? 'resident' : 'residents'}</p>
        {home.known.accessible && <p><Accessibility size={16} aria-hidden="true" />Accessible transport</p>}</div>
        <p className="observation-muted">Received {observationTime(home.known.receivedAt)} · {home.known.source === 'assessment' ? 'team radio' : home.known.source === 'mirofish' ? 'prepared resident report' : 'reporting rule'}</p>
      </> : <p className="observation-muted">Waiting for a report or home check.</p>}
    </section>
    {waiting && <p className="observation-waiting" role="status">{waiting}</p>}
    <Button className="observation-source-button" variant="outline" onClick={onDetails}>Source &amp; details</Button>
  </aside>;
}
