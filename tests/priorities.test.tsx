// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, createScenario } from '../src/scenario';
import { initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import type { ObservationView, ObservedHousehold } from '../src/model';
import { getPriorityGroups, priorityReason } from '../src/ui/priorities';

const fixture = () => observe(initialize(createScenario(DEFAULT_CONFIG), 'priorities'));
function reveal(home: ObservedHousehold, urgent: boolean, deadline: number) {
  home.known = { need: { id: `N-${home.id}`, kind: 'relocation', urgent, onset: 0, deadline }, size: 2, accessible: false, consent: true, observedAt: 0, receivedAt: 0, source: 'assessment', requestText: 'Public request' };
  home.assessedAt = 0; home.status = 'assessed';
}
function assign(view: ObservationView, home: ObservedHousehold, action: 'ASSESS' | 'RELOCATE' = 'RELOCATE') {
  home.missionId = `M${view.missions.length + 1}`; home.status = 'assigned';
  view.missions.push({ id: home.missionId, action, unitId: 'V1', householdId: home.id, dispatchedAt: 0, arrivalAt: 6, pickupAt: action === 'RELOCATE' ? 8 : null, completionAt: 16, route: { nodes: [], legs: [], minutes: 6 }, shelterRoute: null, status: 'traveling' });
}

describe('public priorities', () => {
  it('orders urgent deadlines before other known needs, and cannot-call homes before other unknowns', () => {
    const view = fixture();
    reveal(view.households[0], false, 10); reveal(view.households[1], true, 30); reveal(view.households[2], true, 18);
    const groups = getPriorityGroups(view);
    expect(groups['needs-help'].map(home => home.id)).toEqual(['H03', 'H02', 'H01']);
    expect(groups['not-checked'][0].communications).toBe(false);
    const lastCannotCall = groups['not-checked'].reduce((last, home, index) => home.communications ? last : index, -1);
    expect(groups['not-checked'].slice(lastCannotCall + 1).every(home => home.communications)).toBe(true);
    view.households.reverse();
    expect(getPriorityGroups(view)['needs-help'].map(home => home.id)).toEqual(['H03', 'H02', 'H01']);
  });

  it('does not turn lack of contact into a need or disclose private scenario facts', () => {
    const scenario = createScenario(DEFAULT_CONFIG);
    const first = observe(initialize(scenario, 'same-public-view'));
    scenario.households.forEach(home => { home.need = null; home.size = 99; home.accessible = !home.accessible; });
    scenario.reports = [];
    const second = observe(initialize(scenario, 'same-public-view'));
    expect(getPriorityGroups(first)).toEqual(getPriorityGroups(second));
    expect(getPriorityGroups(first)['needs-help']).toEqual([]);
    const outageHome = first.households.find(home => !home.communications)!;
    expect(priorityReason(first, outageHome)).toBe('Cannot call · not checked');
    expect(priorityReason(first, first.households.find(home => home.communications)!)).toBe('Not checked · need unknown');
  });

  it('keeps assigned checks separate and distinguishes arrival, boarding, drop-off and completed assistance', () => {
    const view = fixture(); const home = view.households[0]; reveal(home, true, 30); assign(view, home);
    expect(getPriorityGroups(view)['needs-help']).toHaveLength(0);
    expect(getPriorityGroups(view)['on-the-way'].map(item => item.id)).toEqual([home.id]);
    expect(priorityReason(view, home)).toBe('Help on the way · arrives in 6 min');
    view.minute = 6; view.missions[0].status = 'boarding';
    expect(priorityReason(view, home)).toBe('Residents boarding · completes in 10 min');
    view.minute = 8; view.missions[0].status = 'transporting';
    expect(priorityReason(view, home)).toBe('Going to shelter · completes in 8 min');
    expect(getPriorityGroups(view)['on-the-way']).toHaveLength(1);
    home.completedAt = 16; home.missionId = null; view.missions[0].status = 'completed'; view.minute = 16;
    expect(getPriorityGroups(view)['on-the-way']).toHaveLength(0);
    expect(priorityReason(view, home)).toBe('Help completed');
    const other = view.households[1]; assign(view, other, 'ASSESS');
    view.minute = 0;
    expect(priorityReason(view, other)).toBe('Check on the way · arrives in 6 min');
  });

  it('shows truthful deadline wording, including due and overdue needs', () => {
    const view = fixture(); const home = view.households[0]; reveal(home, true, 30); view.minute = 12;
    expect(priorityReason(view, home)).toBe('Needs a ride · urgent · 18 min left');
    view.minute = 30; expect(priorityReason(view, home)).toContain('due now');
    view.minute = 33; expect(priorityReason(view, home)).toContain('3 min overdue');
  });


});
