// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Mission, SimState } from '../src/model';
import { createScenario, DEFAULT_CONFIG, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { initialize } from '../src/sim/engine';
import { Results } from '../src/ui/Results';

// Canvas drawing is independent of the debrief counts and interactions under test.
vi.mock('../src/ui/TownMap', () => ({ TownMap: () => <div /> }));
afterEach(cleanup);

const callbacks = { onExport: vi.fn(), onReplay: vi.fn(), onRestart: vi.fn(), onEdit: vi.fn() };

function debrief(): SimState {
  const scenario = createScenario(DEFAULT_CONFIG, null);
  scenario.reports = [];
  for (const home of scenario.households) home.need = null;
  for (const [id, size, kind, urgent] of [['H02', 2, 'delivery', true], ['H03', 4, 'delivery', false], ['H19', 3, 'relocation', true]] as const) {
    const home = scenario.households.find(home => home.id === id)!;
    home.size = size;
    home.need = { id: `N-${id}`, kind, urgent, onset: 0, deadline: urgent ? 30 : 60 };
  }
  scenario.households.find(home => home.id === 'H02')!.neighborhood = 'northwest';
  scenario.households.find(home => home.id === 'H04')!.neighborhood = 'southeast';
  const state = initialize(scenario, 'debrief-test');
  state.minute = 60; state.finalized = true;
  for (const progress of state.households) {
    const home = scenario.households.find(home => home.id === progress.householdId)!;
    progress.assessedAt = 2; progress.contactedAt = 2;
    progress.known = { need: home.need, size: home.size, accessible: home.accessible, consent: true, observedAt: 2, receivedAt: 2, source: 'assessment', requestText: 'Fixture assessment' };
  }
  for (const id of ['H02', 'H04', 'H19']) state.households.find(home => home.householdId === id)!.assessedAt = null;
  for (const id of ['H04', 'H19']) {
    const progress = state.households.find(home => home.householdId === id)!;
    progress.known = null; progress.contactedAt = null;
  }
  state.households.find(home => home.householdId === 'H03')!.completedAt = 40;
  state.kits = { initial: 3, available: 1, reserved: 1, consumed: 1 };
  const mission: Mission = { id: 'M1', action: 'DELIVER', unitId: 'C1', householdId: 'H02', dispatchedAt: 58, arrivalAt: 61, pickupAt: null, completionAt: 63, route: { nodes: [], legs: [], minutes: 3 }, shelterRoute: null, status: 'traveling' };
  state.missions = [mission];
  state.households.find(home => home.householdId === 'H02')!.missionId = mission.id;
  state.units.find(unit => unit.id === 'C1')!.missionId = mission.id;
  return state;
}

describe('challenge debrief', () => {
  it('keeps earlier response events before the final waiting explanation', () => {
    const state = debrief();
    state.events.push({id:'early-request',minute:7,type:'request',householdId:'H02',message:'Earlier request'});
    const {container} = render(<Results state={state} {...callbacks} />);
    fireEvent.click(screen.getByRole('tab', {name:'Homes'}));
    fireEvent.change(screen.getByLabelText('Inspect household timeline'), {target:{value:'H02'}});
    expect([...container.querySelectorAll('.timeline-events time')].map(item => item.textContent)).toEqual(['00:00','00:07','01:00']);
  });
  it('separates unfinished residents, unchecked homes, outage homes, and undiscovered actual needs', () => {
    render(<Results state={debrief()} {...callbacks} />);
    expect(screen.getByRole('definition', { name: 'People helped' }).textContent).toBe('4');
    expect(screen.getByRole('definition', { name: 'Urgent help on time' }).textContent).toBe('0 / 2');
    expect(screen.getByRole('definition', { name: 'People still waiting' }).textContent).toBe('5');
    expect(screen.getByRole('definition', { name: 'Homes not checked' }).textContent).toBe('3');
    expect(screen.getByRole('definition', { name: 'Could not call' }).textContent).toBe('2');
    expect(screen.getByRole('definition', { name: 'Undiscovered needs' }).textContent).toBe('1');
    const waiting = screen.getByRole('region', { name: 'Why people are still waiting' });
    expect(within(waiting).getAllByRole('button')).toHaveLength(2);
    expect(within(waiting).queryByRole('button', { name: /H04/ })).toBeNull();
    expect(within(waiting).getByRole('button', { name: /H02/ }).textContent).toContain('Delivery unfinished');
    expect(within(waiting).getByRole('button', { name: /H19/ }).textContent).toContain('Not checked');
    expect(within(waiting).getByRole('button', { name: /H19/ }).textContent).toContain('could not call');
  });

  it('opens the selected waiting home timeline and preserves the comparison tabs', () => {
    const state = debrief();
    const pristine = structuredClone(state);
    render(<Results state={state} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: /H02.*Delivery unfinished/ }));
    expect(screen.getByRole('tab', { name: 'Homes' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Inspect household timeline') as HTMLSelectElement).value).toBe('H02');
    expect(screen.getByText(/Delivery unfinished/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(screen.getByRole('columnheader', { name: 'Baseline' })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Timely urgent assistance/ }).textContent).toContain('0%');
    expect(state).toEqual(pristine);
  });

  it('describes current resource evidence without asserting a past cause', () => {
    const state = debrief();
    state.missions = [];
    state.households.find(home => home.householdId === 'H02')!.missionId = null;
    state.units.find(unit => unit.id === 'C1')!.missionId = null;
    state.kits = { initial: 3, available: 0, reserved: 1, consumed: 2 };
    render(<Results state={state} {...callbacks} />);
    expect(screen.getByRole('button', { name: /H02/ }).textContent).toContain('No unreserved kits at finish');
    expect(screen.getByText('Reasons describe the final state; they do not prove what caused a delay.')).toBeTruthy();
  });

  it('uses the actual map type to identify Dallas and keeps behavior provenance tied to the scenario', () => {
    const state = initialize(createScenario(DALLAS_DEFAULT_CONFIG, null), 'dallas-debrief');
    state.minute = 60; state.finalized = true;
    render(<Results state={state} {...callbacks} />);
    expect(screen.getByText('Dallas demo · 24 fictional homes')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.queryByText(/Riverdale storm/)).toBeNull();
    expect(screen.getByText(/No verified MiroFish artifact is loaded/)).toBeTruthy();
  });
});
