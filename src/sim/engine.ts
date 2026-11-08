import type { Command, CommandResult, Household, KnownFacts, Mission, Route, Scenario, SimState, Unit } from '../model';
import { HORIZON } from '../model';
import { isGeographicGraph, routePosition, shortestPath, validateGeographicGraph } from './routes';
import { publicDispatchContext } from './decision-evidence';

const clone = <T>(value: T): T => structuredClone(value);
const event = (state: SimState, type: SimState['events'][number]['type'], message: string, householdId?: string, urgent?: boolean) => {
  state.events.push({ id: `E${String(state.events.length + 1).padStart(4, '0')}`, minute: state.minute, type, message, ...(householdId ? { householdId } : {}), ...(urgent ? { urgent: true } : {}) });
};
function facts(home: Household, minute: number, source: KnownFacts['source']): KnownFacts {
  return { need: clone(home.need), size: home.size, accessible: home.accessible, consent: true, observedAt: minute, receivedAt: minute, source,
    requestText: home.need ? `${home.size} ${home.size === 1 ? 'resident needs' : 'residents need'} ${home.need.kind === 'delivery' ? 'one supply kit' : home.accessible ? 'accessible transport to a powered shelter' : 'transport to a powered shelter'}. ${home.need.urgent ? 'Urgent; assistance due by minute 30.' : 'Assistance due by minute 60.'}` : 'Assessment confirmed no current assistance need.' };
}
function publishReports(state: SimState) {
  for (const report of state.scenario.reports.filter(r => r.attemptMinute === state.minute).sort((a, b) => a.id.localeCompare(b.id))) {
    const home = state.scenario.households.find(h => h.id === report.householdId)!;
    const progress = state.households.find(h => h.householdId === home.id)!;
    if (progress.completedAt !== null || state.scenario.config.networkGap === home.neighborhood || !home.need) continue;
    const newlyKnown = !progress.known;
    progress.known ??= facts(home, state.minute, report.source);
    progress.contactedAt ??= state.minute;
    event(state, 'request', `Request received: ${home.id} · ${home.need.kind === 'delivery' ? 'supply kit' : 'shelter transport'} (${report.source === 'mirofish' ? 'prepared MiroFish request' : 'simulation rule'}).`, home.id, newlyKnown && home.need.urgent);
  }
}
export function initialize(scenario: Scenario, runId: string): SimState {
  if (!runId || typeof runId !== 'string' || runId.length > 120) throw new Error('A valid run identity is required.');
  const ids = new Set(scenario.map.nodes.map(n => n.id));
  const duplicateIds = [scenario.map.nodes, scenario.map.edges, scenario.households, scenario.units, scenario.shelters, scenario.reports].some(items => new Set(items.map(item => item.id)).size !== items.length);
  if (isGeographicGraph(scenario.map)) validateGeographicGraph(scenario.map);
  if (duplicateIds || scenario.households.some(h => !ids.has(h.nodeId)) || scenario.units.some(u => !ids.has(u.nodeId)) || scenario.shelters.some(s => !ids.has(s.nodeId)) || scenario.map.edges.some(e => !ids.has(e.from) || !ids.has(e.to) || (!isGeographicGraph(scenario.map) && (!Number.isInteger(e.minutes) || e.minutes <= 0))) || scenario.reports.some(r => !scenario.households.some(h => h.id === r.householdId && h.need?.id === r.needId))) throw new Error('The scenario contains invalid or dangling map references.');
  const state: SimState = {
    runId, minute: 0, finalized: false, scenario: clone(scenario),
    households: scenario.households.map(h => ({ householdId: h.id, known: null, contactedAt: null, assessedAt: null, completedAt: null, missionId: null })),
    units: clone(scenario.units), shelters: clone(scenario.shelters), kits: clone(scenario.kits), missions: [], commands: [], events: [],
  };
  event(state, 'system', 'Exercise started. Teams have reliable radios; household networks may be unavailable.');
  publishReports(state);
  return state;
}
function sameCommand(a: Command, b: Command): boolean {
  return a.runId === b.runId && a.commandId === b.commandId && a.sequence === b.sequence && a.minute === b.minute && a.action === b.action && a.unitId === b.unitId && a.householdId === b.householdId && a.shelterId === b.shelterId;
}
export function dispatch(state: SimState, command: Command): { state: SimState; result: CommandResult } {
  const unchanged = (reason: string) => ({ state, result: { accepted: false, reason } });
  if (!command || command.runId !== state.runId) return unchanged('This command belongs to a different exercise.');
  const existing = state.commands.find(c => c.command.commandId === command.commandId);
  if (existing) return sameCommand(existing.command, command) ? { state, result: clone(existing.result) } : unchanged('Command ID conflict. Use a new command ID.');
  if (state.commands.length >= 500) return unchanged('This exercise has reached the 500-command limit. Advance, export, or restart.');
  if (typeof command.commandId !== 'string' || !command.commandId || command.commandId.length > 120 || !Number.isInteger(command.sequence) || command.sequence <= (state.commands.at(-1)?.command.sequence ?? 0) || command.minute !== state.minute || !Number.isInteger(command.minute) || Object.keys(command).some(k => !['runId','commandId','sequence','minute','action','unitId','householdId','shelterId'].includes(k))) return unchanged('Command identity, order, or exercise minute is invalid.');
  const reject = (reason: string) => {
    const next = clone(state); const result = { accepted: false, reason }; next.commands.push({ command: clone(command), result }); return { state: next, result };
  };
  if (state.finalized) return reject('The exercise is complete. Restart to dispatch again.');
  if (!['ASSESS','DELIVER','RELOCATE'].includes(command.action)) return reject('Choose assessment, delivery, or relocation.');
  const home = state.scenario.households.find(h => h.id === command.householdId);
  const progress = state.households.find(h => h.householdId === command.householdId);
  const unit = state.units.find(u => u.id === command.unitId);
  if (!home || !progress || !unit) return reject('Select an existing household and response unit.');
  // Knowledge is checked before any private need facts or capabilities.
  if (command.action !== 'ASSESS' && !progress.known) return reject('Assess or receive a request first.');
  if (unit.missionId) return reject('This unit is committed until its current mission completes.');
  if (progress.missionId) return reject('A response unit is already assigned to this household.');
  if (progress.completedAt !== null && command.action !== 'ASSESS') return reject('This household has already received assistance.');
  if (command.action === 'DELIVER' && (unit.kind !== 'crew' || progress.known?.need?.kind !== 'delivery')) return reject('Supply delivery requires the response crew and a known delivery need.');
  if (command.action === 'DELIVER' && state.kits.available < 1) return reject('No unreserved supply kits remain.');
  if (command.action === 'RELOCATE' && (unit.kind !== 'van' || progress.known?.need?.kind !== 'relocation')) return reject('Relocation requires a van and a known transport need.');
  if (command.action === 'RELOCATE' && (progress.known!.size > unit.seats || progress.known!.accessible && !unit.accessible)) return reject('Choose a van with compatible accessibility and enough seats.');
  const shelter = command.shelterId ? state.shelters.find(s => s.id === command.shelterId) : undefined;
  if (command.action === 'RELOCATE' && (!shelter || progress.known!.accessible && !shelter.accessible)) return reject('Choose a compatible powered shelter.');
  if (command.action === 'RELOCATE' && shelter!.available < progress.known!.size) return reject('This shelter does not have enough unreserved places for the whole household.');
  const route = shortestPath(state.scenario.map, unit.nodeId, home.nodeId);
  const shelterRoute = command.action === 'RELOCATE' ? shortestPath(state.scenario.map, home.nodeId, shelter!.nodeId) : null;
  if (!route || command.action === 'RELOCATE' && !shelterRoute) return reject('No open road route is available.');
  const next = clone(state);
  const nextUnit = next.units.find(u => u.id === unit.id)!;
  const nextProgress = next.households.find(h => h.householdId === home.id)!;
  const id = `M${String(next.missions.length + 1).padStart(4, '0')}`;
  const arrivalAt = state.minute + route.minutes;
  const pickupAt = command.action === 'RELOCATE' ? arrivalAt + 2 : null;
  const completionAt = pickupAt !== null ? pickupAt + shelterRoute!.minutes + 2 : arrivalAt + 2;
  const mission: Mission = { id, action: command.action, unitId: unit.id, householdId: home.id, ...(command.action === 'RELOCATE' ? { shelterId: shelter!.id } : {}), dispatchedAt: state.minute, arrivalAt, pickupAt, completionAt, route, shelterRoute, status: route.minutes ? 'traveling' : command.action === 'RELOCATE' ? 'boarding' : 'traveling' };
  nextUnit.missionId = id; nextProgress.missionId = id; next.missions.push(mission);
  if (command.action === 'DELIVER') { next.kits.available--; next.kits.reserved++; }
  if (command.action === 'RELOCATE') { const target = next.shelters.find(s => s.id === shelter!.id)!; target.available -= progress.known!.size; target.reserved += progress.known!.size; }
  const result: CommandResult = { accepted: true, reason: `Unit committed until completion at minute ${completionAt}.`, missionId: id };
  next.commands.push({ command: clone(command), result: clone(result) });
  const context = publicDispatchContext({known:progress.known, communications:state.scenario.config.networkGap !== home.neighborhood}, command.action, completionAt);
  event(next, 'dispatch', `${unit.id} assigned to ${command.action === 'ASSESS' ? 'assess' : command.action === 'DELIVER' ? 'deliver supplies to' : 'relocate'} ${home.id}. Completion minute ${completionAt}. ${context}`, home.id);
  return { state: next, result };
}
function positionAlong(state: SimState, unit: Unit, route: Route, elapsed: number) {
  const position = routePosition(state.scenario.map, route, elapsed);
  unit.x = position.x; unit.y = position.y;
}
export function advanceMinute(state: SimState): SimState {
  if (state.finalized || state.minute >= HORIZON) return state;
  const next = clone(state); next.minute++;
  for (const mission of next.missions.filter(m => m.status !== 'completed').sort((a, b) => a.id.localeCompare(b.id))) {
    const unit = next.units.find(u => u.id === mission.unitId)!;
    const home = next.scenario.households.find(h => h.id === mission.householdId)!;
    const progress = next.households.find(h => h.householdId === home.id)!;
    unit.busyMinutes++;
    if (mission.pickupAt !== null && next.minute >= mission.pickupAt) {
      positionAlong(next, unit, mission.shelterRoute!, next.minute - mission.pickupAt);
      if (next.minute === mission.pickupAt) { unit.passengers = home.size; unit.nodeId = home.nodeId; event(next, 'pickup', `${home.id} boarded ${unit.id}; assistance completes at shelter drop-off.`, home.id); }
      mission.status = 'transporting';
    } else {
      positionAlong(next, unit, mission.route, next.minute - mission.dispatchedAt);
      if (next.minute >= mission.arrivalAt && mission.action === 'RELOCATE') mission.status = 'boarding';
    }
    if (next.minute === mission.completionAt) {
      mission.status = 'completed'; unit.missionId = null; progress.missionId = null;
      if (mission.action === 'ASSESS') {
        const newlyKnown = !progress.known;
        progress.known = facts(home, next.minute, 'assessment'); progress.contactedAt ??= next.minute; progress.assessedAt ??= next.minute;
        unit.nodeId = home.nodeId;
        event(next, 'assessment', `Radio assessment: ${home.id} · ${home.need ? home.need.kind === 'delivery' ? 'supply kit needed' : 'shelter transport needed' : 'no current assistance need'}.`, home.id, newlyKnown && !!home.need?.urgent);
      } else {
        progress.completedAt = next.minute;
        if (mission.action === 'DELIVER') { next.kits.reserved--; next.kits.consumed++; unit.nodeId = home.nodeId; }
        else { const shelter = next.shelters.find(s => s.id === mission.shelterId)!; shelter.reserved -= home.size; shelter.occupied += home.size; unit.passengers = 0; unit.nodeId = shelter.nodeId; }
        event(next, 'completion', `${home.id} assistance completed: ${mission.action === 'DELIVER' ? 'supply kit delivered' : 'household arrived at shelter'}.`, home.id);
      }
      const node = next.scenario.map.nodes.find(n => n.id === unit.nodeId)!; unit.x = node.x; unit.y = node.y;
    }
  }
  publishReports(next);
  if (next.minute === HORIZON) { next.finalized = true; event(next, 'system', 'Exercise complete. Final-minute arrivals are included; unfinished missions remain unresolved.'); }
  return next;
}
