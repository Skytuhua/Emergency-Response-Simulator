// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import prepared from '../public/data/mirofish-dallas-v1.json';
import legacy from '../public/data/mirofish-v1.json';
import type { AgentArtifact, Mission, ObservationView } from '../src/model';
import { createScenario, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { advanceMinute, initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { PersonaFlow } from '../src/ui/PersonaFlow';

const artifact = prepared as AgentArtifact;
function viewAt(minute = 0, gap = 'none' as typeof DALLAS_DEFAULT_CONFIG.networkGap): ObservationView {
  let state = initialize(createScenario({ ...DALLAS_DEFAULT_CONFIG, networkGap: gap }, artifact), 'persona-test');
  while (state.minute < minute) state = advanceMinute(state);
  return observe(state);
}
function show(view = viewAt(), source: AgentArtifact | null = artifact, selected: string | null = 'H02') {
  const onSelect = vi.fn(), onInspect = vi.fn();
  render(<PersonaFlow view={view} artifact={source} selected={selected} onSelect={onSelect} onInspect={onInspect} />);
  return { onSelect, onInspect };
}
afterEach(cleanup);

describe('prepared persona evidence and observed response flow', () => {
  it('keeps selectors compact and all five essential stages above the full-source disclosure', () => {
    show();
    const select = screen.getByRole('button', { name: /Select H02 generated representative/ });
    expect(within(select).getByText('Administrative coordinator')).toBeTruthy();
    expect(within(select).queryByText('37 years')).toBeNull();
    expect(screen.queryByText('36 years')).toBeNull();
    const flow = screen.getByRole('region', { name: 'H02 source and response flow' });
    const stages = within(flow).getByRole('list', { name: 'Source and observed response stages' });
    expect(within(stages).getAllByRole('listitem')).toHaveLength(5);
    expect(stages.querySelectorAll('p')).toHaveLength(0);
    expect(flow.querySelectorAll('.persona-event-reference')).toHaveLength(0);
    const quote = flow.querySelector('blockquote')!;
    expect(quote.textContent!.length).toBeLessThanOrEqual(93);
    const shown = quote.textContent!.slice(1, -1).replace(/…$/, '');
    expect(artifact.candidates.find(candidate => candidate.householdId === 'H02')!.sourceText.startsWith(shown)).toBe(true);
    const proof = screen.getByText('Full source & custody').closest('details')!;
    expect(within(proof).getByText('Verified model output JSON')).toBeTruthy();
  });

  it('retains verified attributes when only approved JSON object key order changes', () => {
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
    show(viewAt(), reorder(artifact) as AgentArtifact);
    expect(screen.getByText('Administrative coordinator')).toBeTruthy();
    expect(screen.queryByText('Prepared source not linked to Dallas evidence')).toBeNull();
  });
  it('shows actual returned attributes and prepared playback rather than a live generation claim', () => {
    show();
    expect(screen.getByText('Prepared Terra · playback')).toBeTruthy();
    expect(screen.getByText('Administrative coordinator')).toBeTruthy();
    expect(screen.getByText('37 years')).toBeTruthy();
    expect(screen.getByText('ISTJ')).toBeTruthy();
    expect(screen.getByText('Library assistant')).toBeTruthy();
    expect(screen.getByText('Office coordinator')).toBeTruthy();
    expect(screen.getByLabelText('3 generated representatives · 24 synthetic homes')).toBeTruthy();
    expect(screen.queryByText(/generating|live model|thinking/i)).toBeNull();
    expect(screen.getByText('Request not attempted yet')).toBeTruthy();
  });

  it('keeps the stored resident request visible while a network gap leaves coordinator need unknown', () => {
    const view = viewAt(5, 'southeast');
    const blocked = view.households.find(home => home.id === 'H19')!;
    expect(blocked.communications).toBe(false);
    expect(blocked.known).toBeNull();
    show(view, artifact, 'H19');
    const flow = screen.getByRole('region', { name: 'H19 source and response flow' });
    expect(within(flow).getByText('Cannot call · network gap')).toBeTruthy();
    expect(within(flow).getByText('Coordinator need unknown')).toBeTruthy();
    expect(within(flow).getByText(/Our two-person household needs relocation assistance/)).toBeTruthy();
    expect(within(flow).queryByText('Request received · m5')).toBeNull();
  });

  it('uses the real public prepared-request receipt and never infers receipt from known facts alone', () => {
    const view = viewAt(5);
    show(view);
    expect(screen.getByText('Request received · m5')).toBeTruthy();
    cleanup();
    view.events = view.events.filter(event => event.householdId !== 'H02');
    show(view);
    expect(screen.getByText('No recorded request receipt')).toBeTruthy();
    expect(screen.queryByText('Request received · m5')).toBeNull();
  });

  it('does not equate an assignment or a completed assessment with completed assistance', () => {
    const view = viewAt(5);
    const home = view.households.find(home => home.id === 'H02')!;
    home.missionId = 'M1'; home.status = 'assigned';
    const mission: Mission = { id: 'M1', action: 'DELIVER', householdId: 'H02', unitId: 'C1', dispatchedAt: 5, arrivalAt: 10, completionAt: 12, pickupAt: null, route: { nodes: [], legs: [], minutes: 5 }, shelterRoute: null, status: 'traveling' };
    view.missions = [mission];
    show(view);
    expect(screen.getByText('Response assigned')).toBeTruthy();
    expect(screen.getByText('Assistance pending')).toBeTruthy();
    expect(screen.queryByText(/Assistance complete ·/)).toBeNull();
    cleanup();
    view.missions[0] = { ...mission, action: 'ASSESS', status: 'completed' };
    home.missionId = null; home.assessedAt = 12;
    show(view);
    expect(screen.queryByText(/Assistance complete ·/)).toBeNull();
    cleanup();
    home.completedAt = 15; home.status = 'assisted';
    show(view);
    expect(screen.getByText('Assistance complete · m15')).toBeTruthy();
  });

  it('does not claim a skipped request was received when assistance preceded its attempt', () => {
    const view = viewAt(5);
    view.events = view.events.filter(event => event.householdId !== 'H02');
    view.households.find(home => home.id === 'H02')!.completedAt = 4;
    show(view);
    expect(screen.getByText('No request receipt · already assisted')).toBeTruthy();
    expect(screen.queryByText('Request received · m5')).toBeNull();
  });

  it('offers keyboard-native resident selection and inspectable full verbatim source with custody hashes', async () => {
    const callbacks = show();
    const select = screen.getByRole('button', { name: /Select H09 generated representative/ });
    expect(select.tagName).toBe('BUTTON');
    select.focus();
    await userEvent.keyboard('{Enter}');
    expect(callbacks.onSelect).toHaveBeenCalledWith('H09');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect H02' }));
    expect(callbacks.onInspect).toHaveBeenCalledWith('H02');
    const sourceText = artifact.candidates.find(candidate => candidate.householdId === 'H02')!.sourceText;
    const full = screen.getByText((_content, element) => element?.tagName === 'PRE' && element.textContent === sourceText);
    expect(full.closest('details')).toBeTruthy();
    expect(screen.getByText(artifact.profiles[0].persona)).toBeTruthy();
    expect(screen.getByText(artifact.inputHash)).toBeTruthy();
    expect(screen.getByText('reddit-trace-6')).toBeTruthy();
    expect(screen.getByText('793ac3a0ece9cd64e6eb4aaf1a918523ab8598f640eeab7363f7feeab7a0a2ed')).toBeTruthy();
  });

  it.each([
    ['missing', null, 'Rule-based reporting'],
    ['legacy', legacy as AgentArtifact, 'Prepared source not linked to Dallas evidence'],
    ['blocked', { ...artifact, generationOutcome: 'blocked', profiles: [], candidates: [] } as AgentArtifact, 'Preparation unavailable · rule-based reporting'],
    ['profiles only', { ...artifact, generationOutcome: 'profiles-only', candidates: [] } as AgentArtifact, 'Profiles prepared · rule-based reporting'],
    ['wrong input', { ...artifact, inputHash: 'changed' } as AgentArtifact, 'Prepared source not linked to Dallas evidence'],
    ['changed persona', { ...artifact, profiles: artifact.profiles.map((profile, i) => i ? profile : { ...profile, persona: 'invented' }) } as AgentArtifact, 'Prepared source not linked to Dallas evidence'],
  ])('keeps %s artifacts honest without assigning Dallas structured traits', (_name, source, label) => {
    show(viewAt(), source);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Administrative coordinator')).toBeNull();
    expect(screen.queryByText('37 years')).toBeNull();
    expect(screen.queryByText('Stored request')).toBeNull();
  });
});
