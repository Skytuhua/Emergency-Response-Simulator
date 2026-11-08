import { describe, expect, it } from 'vitest';
import type { ObservationView, ObservedHousehold, Unit } from '../src/model';
import { getBlockedReason, getPrimaryAction, getSuggestedAssignment, isAssignmentFeasible } from '../src/ui/suggestions';

const home = (known: boolean = true): ObservedHousehold => ({
  id: 'H1', name: 'One', address: '1 Test Road', nodeId: 'home', x: 1, y: 1,
  neighborhood: 'southeast', communications: false, status: known ? 'reported' : 'unknown',
  known: known ? { need: { id: 'N1', kind: 'relocation', urgent: true, onset: 0, deadline: 30 }, size: 2, accessible: true, consent: true, observedAt: 8, receivedAt: 8, source: 'assessment', requestText: 'Public request' } : null,
  contactedAt: known ? 8 : null, assessedAt: known ? 8 : null, completedAt: null, missionId: null,
});
const unit = (id: string, nodeId = 'base', kind: Unit['kind'] = 'van'): Unit => ({ id, name: id, kind, accessible: true, seats: 4, nodeId, x: 0, y: 0, missionId: null, passengers: 0, busyMinutes: 0 });
function publicView(known = true): ObservationView {
  return {
    runId: 'test', minute: 8, finalized: false,
    map: { width: 10, height: 10, nodes: ['base', 'near', 'home', 'east', 'west'].map((id, x) => ({ id, x, y: 0 })), edges: [
      { id: 'a', from: 'base', to: 'home', minutes: 6 }, { id: 'b', from: 'near', to: 'home', minutes: 2 },
      { id: 'c', from: 'home', to: 'east', minutes: 3 }, { id: 'd', from: 'home', to: 'west', minutes: 7 },
    ] },
    households: [home(known)], units: [unit('V2'), unit('V1', 'near'), unit('C1', 'base', 'crew')],
    shelters: [
      { id: 'B', name: 'West', nodeId: 'west', x: 0, y: 0, accessible: true, capacity: 8, available: 8, occupied: 0, reserved: 0 },
      { id: 'A', name: 'East', nodeId: 'east', x: 0, y: 0, accessible: true, capacity: 8, available: 8, occupied: 0, reserved: 0 },
    ],
    kits: { initial: 2, available: 2, reserved: 0, consumed: 0 }, missions: [], events: [], networkGap: 'southeast',
    requests: [], contactCount: 1, assessedCount: 1, assistedCount: 0,
  };
}

describe('public assignment suggestions', () => {
  it('chooses the earliest completion and uses stable unit and shelter ties', () => {
    const view = publicView();
    expect(getSuggestedAssignment(view, 'H1')).toEqual({ action: 'RELOCATE', householdId: 'H1', unitId: 'V1', shelterId: 'A' });
    view.units.find(u => u.id === 'V2')!.nodeId = 'near';
    view.shelters.find(s => s.id === 'B')!.nodeId = 'east';
    view.units.reverse(); view.shelters.reverse();
    expect(getSuggestedAssignment(view, 'H1')?.unitId).toBe('V1');
    expect(getSuggestedAssignment(view, 'H1')?.shelterId).toBe('A');
  });

  it('preserves a valid manual unit with its best compatible shelter and replaces invalid choices', () => {
    const view = publicView();
    expect(getSuggestedAssignment(view, 'H1', 'RELOCATE', 'V2')).toMatchObject({ unitId: 'V2', shelterId: 'A' });
    expect(getSuggestedAssignment(view, 'H1', 'RELOCATE', 'C1')?.unitId).toBe('V1');
    view.units.find(u => u.id === 'V2')!.missionId = 'busy';
    expect(getSuggestedAssignment(view, 'H1', 'RELOCATE', 'V2')?.unitId).toBe('V1');
  });

  it('does not infer any need, size, accessibility or deadline for unknown homes', () => {
    const view = publicView(false);
    expect(getPrimaryAction(view.households[0])).toBe('ASSESS');
    expect(getSuggestedAssignment(view, 'H1')?.action).toBe('ASSESS');
    expect(getBlockedReason(view, 'H1', 'RELOCATE', 'C1', 'missing')).toBe('Check this home or receive a request first.');
    expect(getBlockedReason(view, 'H1', 'DELIVER', 'C1')).toBe('Check this home or receive a request first.');
    expect(getSuggestedAssignment(view, 'H1', 'RELOCATE')).toBeNull();
    expect(JSON.stringify(view.households[0])).not.toContain('deadline');
  });

  it('requires compatible accessible vans, enough seats and unreserved shelter places', () => {
    const view = publicView();
    const intent = { action: 'RELOCATE' as const, householdId: 'H1', unitId: 'V1', shelterId: 'A' };
    view.units[1].accessible = false;
    expect(isAssignmentFeasible(view, intent)).toBe(false);
    view.units[1].accessible = true; view.units[1].seats = 1;
    expect(getBlockedReason(view, 'H1', 'RELOCATE', 'V1', 'A')).toContain('seats');
    view.units[1].seats = 4; view.shelters[1].accessible = false;
    expect(isAssignmentFeasible(view, intent)).toBe(false);
    view.shelters[1].accessible = true; view.shelters[1].available = 1; view.shelters[1].reserved = 7;
    expect(isAssignmentFeasible(view, intent)).toBe(false);
    expect(getSuggestedAssignment(view, 'H1')?.shelterId).toBe('B');
    view.shelters[0].available = 1;
    expect(getSuggestedAssignment(view, 'H1')).toBeNull();
  });

  it('uses the crew and available kits for known delivery needs', () => {
    const view = publicView(); view.households[0].known!.need!.kind = 'delivery';
    expect(getPrimaryAction(view.households[0])).toBe('DELIVER');
    expect(getSuggestedAssignment(view, 'H1')).toEqual({ action: 'DELIVER', householdId: 'H1', unitId: 'C1' });
    view.kits.available = 0; view.kits.reserved = 2;
    expect(getSuggestedAssignment(view, 'H1')).toBeNull();
    expect(getBlockedReason(view, 'H1', 'DELIVER', 'C1')).toBe('No unreserved supply kits remain.');
  });

  it('prevents a second assignment when an active public mission already owns a unit', () => {
    const view = publicView();
    view.missions.push({ id: 'M1', action: 'ASSESS', unitId: 'V1', householdId: 'H2', dispatchedAt: 8, arrivalAt: 10, pickupAt: null, completionAt: 12, route: { nodes: [], legs: [], minutes: 2 }, shelterRoute: null, status: 'traveling' });
    expect(getSuggestedAssignment(view, 'H1')?.unitId).toBe('V2');
    view.missions[0].status = 'completed';
    expect(getSuggestedAssignment(view, 'H1')?.unitId).toBe('V1');
  });

  it('respects active assignments, open routes and finalized exercises', () => {
    const view = publicView(); view.households[0].missionId = 'M1';
    expect(getPrimaryAction(view.households[0])).toBeNull();
    expect(getSuggestedAssignment(view, 'H1', 'ASSESS')).toBeNull();
    view.households[0].missionId = null;
    view.map.edges.filter(edge => edge.to === 'home').forEach(edge => { edge.closed = true; });
    expect(getSuggestedAssignment(view, 'H1')).toBeNull();
    view.map.edges.forEach(edge => { edge.closed = false; }); view.finalized = true;
    expect(getSuggestedAssignment(view, 'H1')).toBeNull();
    expect(getBlockedReason(view, 'H1', 'ASSESS', 'C1')).toContain('ended');
  });

  it('has no primary task for helped/no-need homes but permits an explicit recheck', () => {
    const view = publicView(); view.households[0].known!.need = null;
    expect(getPrimaryAction(view.households[0])).toBeNull();
    expect(getSuggestedAssignment(view, 'H1')).toBeNull();
    expect(getSuggestedAssignment(view, 'H1', 'ASSESS')).not.toBeNull();
    view.households[0].completedAt = 24;
    expect(getPrimaryAction(view.households[0])).toBeNull();
    expect(getSuggestedAssignment(view, 'H1', 'ASSESS')).not.toBeNull();
  });
});
