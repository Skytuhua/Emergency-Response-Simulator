// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import prepared from '../public/data/mirofish-dallas-v1.json';
import type { AgentArtifact, Mission, ObservationView } from '../src/model';
import { createScenario, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { ObservationInspector } from '../src/ui/ObservationInspector';
import { Simulation } from '../src/ui/Simulation';

function fixture(): ObservationView {
  return { runId: 'observer', minute: 8, finalized: false,
    map: { width: 100, height: 100, nodes: [{ id: 'base', x: 0, y: 0 }, { id: 'home', x: 50, y: 50 }], edges: [{ id: 'road', from: 'base', to: 'home', minutes: 6 }] },
    households: [{ id: 'H1', name: 'One', address: '1 Test Road', nodeId: 'home', x: 50, y: 50, neighborhood: 'southeast', communications: false, status: 'unknown', known: null, contactedAt: null, assessedAt: null, completedAt: null, missionId: null }],
    units: [{ id: 'C1', name: 'Response crew', kind: 'crew', accessible: false, seats: 0, nodeId: 'base', x: 0, y: 0, missionId: null, passengers: 0, busyMinutes: 0 }],
    shelters: [{ id: 'A', name: 'East Shelter', nodeId: 'base', x: 0, y: 0, accessible: true, capacity: 8, reserved: 0, occupied: 0, available: 8 }],
    kits: { initial: 1, available: 1, reserved: 0, consumed: 0 }, missions: [], events: [], networkGap: 'southeast', requests: [], contactCount: 0, assessedCount: 0, assistedCount: 0 };
}
function known(view: ObservationView) {
  view.households[0].known = { need: { id: 'N1', kind: 'relocation', urgent: true, onset: 0, deadline: 30 }, size: 2, accessible: true, consent: true, observedAt: 8, receivedAt: 8, source: 'assessment', requestText: 'Radio report retained exactly.' };
  view.households[0].assessedAt = 8;
}
function props(view = fixture()) {
  return { view, artifact: null, selected: 'H1', running: true, speed: 1, onSelect: vi.fn(), onToggle: vi.fn(), onStep: vi.fn(), onSpeed: vi.fn(), onPause: vi.fn(), onExport: vi.fn(), onImport: vi.fn(), onRestart: vi.fn(), onEdit: vi.fn(), onFinish: vi.fn() };
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('automatic observation screen', () => {
  it('shows only observation/playback controls and conceals unknown household facts', () => {
    render(<Simulation {...props()} />);
    expect(screen.getByRole('heading', { name: 'Observe simulation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause simulation' })).toBeTruthy();
    expect(screen.queryByLabelText('Response unit')).toBeNull();
    expect(screen.queryByRole('button', { name: /dispatch|send supplies|send a ride|check home.*run|rescue/i })).toBeNull();
    expect(screen.queryByText(/2 residents|Accessible transport|Due 00:30/)).toBeNull();
    expect(screen.getByText('Need not yet known')).toBeTruthy();
    expect(within(screen.getByRole('complementary', { name: 'Observed home' })).getByText(/Cannot call/)).toBeTruthy();
  });
  it('keeps boarding and transporting distinct from completed assistance', () => {
    const view = fixture(); known(view); view.households[0].missionId = 'M1';
    const mission: Mission = { id: 'M1', action: 'RELOCATE', unitId: 'C1', householdId: 'H1', shelterId: 'A', dispatchedAt: 0, arrivalAt: 6, pickupAt: 10, completionAt: 16, route: { nodes: [], legs: [], minutes: 6 }, shelterRoute: null, status: 'boarding' };
    view.missions = [mission];
    const { rerender } = render(<ObservationInspector view={view} selected="H1" onDetails={vi.fn()} />);
    expect(screen.getByText('Residents boarding')).toBeTruthy();
    expect(screen.getByText('Completion in 8 min')).toBeTruthy();
    expect(screen.queryByText('Assistance completed')).toBeNull();
    mission.status = 'transporting'; rerender(<ObservationInspector view={view} selected="H1" onDetails={vi.fn()} />);
    expect(screen.getByText('Traveling to shelter')).toBeTruthy();
    mission.status = 'completed'; view.households[0].completedAt = 16;
    rerender(<ObservationInspector view={view} selected="H1" onDetails={vi.fn()} />);
    expect(screen.getByText('Assistance completed')).toBeTruthy();
    expect(screen.getByText('Completed 00:16')).toBeTruthy();
  });
  it('shows known received facts, urgency and actual deadline without exposing full source in the primary panel', () => {
    const view = fixture(); known(view);
    render(<ObservationInspector view={view} selected="H1" onDetails={vi.fn()} />);
    expect(screen.getByText('2 residents')).toBeTruthy();
    expect(screen.getByText('Accessible transport')).toBeTruthy();
    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(screen.getByText('Due 00:30 · 22 min left')).toBeTruthy();
    expect(screen.getByText('Received 00:08 · team radio')).toBeTruthy();
    expect(screen.queryByText('Radio report retained exactly.')).toBeNull();
  });
  it('shows a resource blockage without claiming assistance and keeps no-need observations out of waiting state', () => {
    const view = fixture(); known(view); view.households[0].known!.need!.kind = 'delivery'; view.kits.available = 0;
    const { rerender } = render(<ObservationInspector view={view} selected="H1" onDetails={vi.fn()} />);
    expect(screen.getByText('No unreserved supply kits remain.')).toBeTruthy();
    expect(screen.queryByText('Assistance completed')).toBeNull();
    view.households[0].known!.need = null;
    rerender(<ObservationInspector view={view} selected="H1" onDetails={vi.fn()} />);
    expect(screen.getByText('No current need')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('opens Details from the keyboard, pauses once, restores focus and never resumes on close', async () => {
    const state = props(); known(state.view); render(<Simulation {...state} />);
    const trigger = screen.getByRole('button', { name: 'Details' }); trigger.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(state.onPause).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText('Radio report retained exactly.')).toBeTruthy();
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(state.onToggle).not.toHaveBeenCalled();
  });
  it('selects a home through Homes without issuing an action and uses public status', () => {
    const state = props(); render(<Simulation {...state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Homes' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Homes' })).getByRole('button', { name: /H1.*Not checked/ }));
    expect(state.onSelect).toHaveBeenCalledWith('H1');
    expect(state.onToggle).not.toHaveBeenCalled();
  });
  it('selects the actual prepared persona and pauses for its full source using the keyboard', async () => {
    const artifact = prepared as AgentArtifact;
    const view = observe(initialize(createScenario(DALLAS_DEFAULT_CONFIG, artifact), 'source-test'));
    const state = { ...props(view), selected: 'H02', artifact }; render(<Simulation {...state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select H19 generated representative' }));
    expect(state.onSelect).toHaveBeenCalledWith('H19');
    const summary = screen.getByText('Full source & custody'); summary.focus();
    await userEvent.keyboard('{Enter}');
    expect(state.onPause).toHaveBeenCalledTimes(1);
    // jsdom does not implement the native summary keyboard toggle.
    fireEvent.click(summary);
    expect(summary.closest('details')?.open).toBe(true);
    expect(screen.getByText('Administrative coordinator')).toBeTruthy();
    expect(state.onToggle).not.toHaveBeenCalled();
  });
  it('makes residents and coordinator accessible as focused panels at narrower desktop sizes', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
    const state = props(); render(<Simulation {...state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Residents' }));
    expect(screen.getByRole('dialog', { name: 'Residents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Residents' }));
    fireEvent.click(screen.getByRole('button', { name: /^Coordinator/ }));
    expect(screen.getByRole('dialog', { name: 'Coordinator' })).toBeTruthy();
    expect(state.onPause).toHaveBeenCalledTimes(2);
  });
});
