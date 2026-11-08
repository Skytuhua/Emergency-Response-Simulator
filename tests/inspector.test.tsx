// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Mission, ObservationView, ObservedHousehold } from '../src/model';
import { HouseholdInspector } from '../src/ui/HouseholdInspector';

function fixture(): ObservationView {
  const home: ObservedHousehold = { id: 'H1', name: 'One', address: '1 Test Road', nodeId: 'home', x: 1, y: 1, neighborhood: 'southeast', communications: false, status: 'unknown', known: null, contactedAt: null, assessedAt: null, completedAt: null, missionId: null };
  return { runId: 'test', minute: 8, finalized: false, map: { width: 2, height: 2, nodes: [{ id: 'home', x: 1, y: 1 }, { id: 'base', x: 0, y: 0 }], edges: [{ id: 'road', from: 'base', to: 'home', minutes: 6 }] }, households: [home], units: [{ id: 'C1', name: 'Response crew', kind: 'crew', accessible: false, seats: 0, nodeId: 'base', x: 0, y: 0, missionId: null, passengers: 0, busyMinutes: 0 }, { id: 'V1', name: 'Accessible van', kind: 'van', accessible: true, seats: 4, nodeId: 'base', x: 0, y: 0, missionId: null, passengers: 0, busyMinutes: 0 }], shelters: [{ id: 'A', name: 'East Shelter', nodeId: 'base', x: 0, y: 0, accessible: true, capacity: 8, reserved: 0, occupied: 0, available: 8 }], kits: { initial: 1, available: 1, reserved: 0, consumed: 0 }, missions: [], events: [], networkGap: 'southeast', requests: [], contactCount: 0, assessedCount: 0, assistedCount: 0 };
}
function reveal(view: ObservationView, kind: 'delivery' | 'relocation') {
  view.households[0].known = { need: { id: 'N1', kind, urgent: true, onset: 0, deadline: 30 }, size: 2, accessible: true, consent: true, observedAt: 8, receivedAt: 8, source: 'assessment', requestText: 'Detailed source wording' };
  view.households[0].assessedAt = 8; view.households[0].status = 'assessed';
}
function props(view: ObservationView) {
  return { view, selected: 'H1', unitId: 'C1', shelterId: 'A', onUnit: vi.fn(), onShelter: vi.fn(), onDispatch: vi.fn(), onDetails: vi.fn(), onClose: vi.fn() };
}
afterEach(cleanup);

describe('contextual household inspector', () => {
  it('shows one welfare check without disclosing unknown facts', () => {
    const state = props(fixture()); render(<HouseholdInspector {...state} />);
    expect(screen.getByText('Need not yet known')).toBeTruthy();
    expect(screen.queryByText(/2 residents|Accessible transport|Due/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deliver kit & run' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send transport & run' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check home & run' }));
    expect(state.onDispatch).toHaveBeenCalledWith({ action: 'ASSESS', householdId: 'H1', unitId: 'C1' });
    fireEvent.click(screen.getByRole('button', { name: 'Details' })); expect(state.onDetails).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close home' })); expect(state.onClose).toHaveBeenCalled();
  });

  it('shows essential known facts and dispatches compatible transport', () => {
    const view = fixture(); reveal(view, 'relocation'); const state = props(view); render(<HouseholdInspector {...state} />);
    expect(screen.getByText('2 residents')).toBeTruthy(); expect(screen.getByText('Accessible transport')).toBeTruthy();
    expect(screen.getByText('Due 00:30')).toBeTruthy();
    expect(screen.queryByText('Detailed source wording')).toBeNull();
    expect(state.onUnit).toHaveBeenCalledWith('V1');
    fireEvent.click(screen.getByRole('button', { name: 'Send transport & run' }));
    expect(state.onDispatch).toHaveBeenCalledWith({ action: 'RELOCATE', householdId: 'H1', unitId: 'V1', shelterId: 'A' });
    expect(screen.queryByRole('button', { name: 'Check home & run' })).toBeNull();
  });

  it('shows a short assignment countdown and never counts boarding as helped', () => {
    const view = fixture(); reveal(view, 'relocation'); view.households[0].missionId = 'M1'; view.households[0].status = 'assigned';
    view.missions = [{ id: 'M1', action: 'RELOCATE', unitId: 'V1', householdId: 'H1', shelterId: 'A', dispatchedAt: 0, arrivalAt: 6, pickupAt: 10, completionAt: 16, route: { nodes: [], legs: [], minutes: 6 }, shelterRoute: null, status: 'boarding' } satisfies Mission];
    render(<HouseholdInspector {...props(view)} />);
    expect(screen.getByText(/Boarding/)).toBeTruthy(); expect(screen.getByText(/Done in 8 min/)).toBeTruthy();
    expect(screen.queryByText('Helped')).toBeNull(); expect(screen.queryByRole('button', { name: /& run/ })).toBeNull();
  });

  it('shows completed help and known no-need without a primary action, with an optional recheck', () => {
    const view = fixture(); reveal(view, 'delivery'); view.households[0].completedAt = 24; view.minute = 24;
    const state = props(view); const { rerender } = render(<HouseholdInspector {...state} />);
    expect(screen.getByText('Helped')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Deliver kit & run' })).toBeNull();
    fireEvent.click(screen.getByText('More actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Recheck home & run' }));
    expect(state.onDispatch).toHaveBeenCalledWith({ action: 'ASSESS', householdId: 'H1', unitId: 'C1' });
    view.households[0].completedAt = null; view.households[0].known!.need = null;
    rerender(<HouseholdInspector {...state} />);
    expect(screen.getByText('No current need')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Check home & run' })).toBeNull();
  });

  it('keeps a blocked delivery visible with the resource problem', () => {
    const view = fixture(); reveal(view, 'delivery'); view.kits.available = 0; view.kits.reserved = 1;
    const state = props(view); render(<HouseholdInspector {...state} />);
    expect(screen.getByRole('button', { name: 'Deliver kit & run' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('No unreserved supply kits remain.')).toBeTruthy(); expect(state.onDispatch).not.toHaveBeenCalled();
  });

  it('keeps a valid manually chosen slower shelter', () => {
    const view = fixture(); reveal(view, 'relocation');
    view.map.nodes.push({ id: 'far', x: 2, y: 0 });
    view.map.edges.push({ id: 'long-road', from: 'home', to: 'far', minutes: 9 });
    view.shelters.push({ ...view.shelters[0], id: 'B', name: 'Second Shelter', nodeId: 'far' });
    const state = { ...props(view), unitId: 'V1', shelterId: 'B' };
    render(<HouseholdInspector {...state} />);
    expect((screen.getByLabelText('Destination shelter') as HTMLSelectElement).value).toBe('B');
    fireEvent.click(screen.getByRole('button', { name: 'Send transport & run' }));
    expect(state.onDispatch).toHaveBeenCalledWith({ action: 'RELOCATE', householdId: 'H1', unitId: 'V1', shelterId: 'B' });
    expect(state.onShelter).not.toHaveBeenCalled();
  });

  it('shows the kit shortage even when the previous task selected a van', () => {
    const view = fixture(); reveal(view, 'delivery'); view.kits.available = 0;
    render(<HouseholdInspector {...props(view)} unitId="V1" />);
    expect(screen.getByText('No unreserved supply kits remain.')).toBeTruthy();
    expect((screen.getByLabelText('Response unit') as HTMLSelectElement).value).toBe('C1');
  });
});
