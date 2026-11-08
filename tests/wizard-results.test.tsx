// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Creator } from '../src/ui/Creator';
import { Results } from '../src/ui/Results';
import { SecondaryPanel } from '../src/ui/SecondaryPanel';
import type { ScenarioConfig } from '../src/model';
import { createScenario, DEFAULT_CONFIG, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { runBaseline, runDefaultWitness, summarize } from '../src/sim/results';

vi.mock('../src/ui/TownMap', () => ({ TownMap: () => <div data-testid="town-map">Town map</div> }));

afterEach(cleanup);

function Wizard({ onStart = vi.fn(), initial = DEFAULT_CONFIG }: { onStart?: (config: ScenarioConfig) => void; initial?: ScenarioConfig }) {
  const [config, setConfig] = useState<ScenarioConfig>({ ...initial });
  return <Creator config={config} artifact={null} error={null} onChange={setConfig} onStart={override => onStart(override ?? config)} onDefault={() => setConfig({ ...DEFAULT_CONFIG })} onImport={vi.fn()} />;
}
const customize = () => fireEvent.click(screen.getByRole('button', { name: 'Customize the scenario' }));

describe('exercise setup wizard', () => {
  it('welcomes first-time visitors, starts the demo with defaults, and retains custom edits', () => {
    const onStart = vi.fn();
    render(<Wizard onStart={onStart} initial={{ ...DEFAULT_CONFIG, additionalNeeds: 8 }} />);
    expect(screen.getByRole('heading', { name: 'Storm response demo' })).toBeTruthy();
    expect(screen.getByText('Some people need help. Others cannot call.')).toBeTruthy();
    expect(screen.getByText('Find who needs help, send a team, and see help arrive.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    expect(onStart).toHaveBeenCalledExactlyOnceWith(DALLAS_DEFAULT_CONFIG);
    customize();
    fireEvent.change(screen.getByLabelText('How many more households need help?'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Start the demo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start the demo' }));
    expect(onStart).toHaveBeenLastCalledWith(DALLAS_DEFAULT_CONFIG);
    expect(onStart).toHaveBeenCalledTimes(2);
    customize();
    expect((screen.getByLabelText('How many more households need help?') as HTMLInputElement).value).toBe('5');
  });

  it('explains the effect of each condition in everyday language', () => {
    render(<Wizard />);
    customize();
    expect(screen.getByLabelText('Where can’t people call for help?')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Down in the southeast' })).toBeTruthy();
    expect(screen.getByText('Homes there cannot call for help.')).toBeTruthy();
    expect(screen.getByLabelText('Roads available')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'One road closed' })).toBeTruthy();
    expect(screen.getByLabelText('How many more households need help?')).toBeTruthy();
    expect(screen.getByText('Added to the 3 homes in every exercise.')).toBeTruthy();
  });

  it('prefills conditions, retains edits through Back, and starts only from Review', () => {
    const onStart = vi.fn();
    render(<Wizard onStart={onStart} />);
    customize();
    expect(screen.getByRole('heading', { name: 'Conditions' })).toBeTruthy();
    expect((screen.getByLabelText('Where can’t people call for help?') as HTMLSelectElement).value).toBe('southeast');
    expect((screen.getByLabelText('How many more households need help?') as HTMLInputElement).value).toBe('3');
    expect(screen.queryByLabelText('Supply kits')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start exercise' })).toBeNull();
    fireEvent.change(screen.getByLabelText('How many more households need help?'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Roads available'), { target: { value: 'detour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Supply kits'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('How many more households need help?') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Roads available') as HTMLSelectElement).value).toBe('detour');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((screen.getByLabelText('Supply kits') as HTMLInputElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Starts paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start exercise' }));
    expect(onStart).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_CONFIG, additionalNeeds: 5, roadPreset: 'detour', kits: 2 });
  });

  it('blocks each invalid step with field-specific errors, including the advanced seed', () => {
    const onStart = vi.fn();
    render(<Wizard onStart={onStart} />);
    customize();
    fireEvent.change(screen.getByLabelText('How many more households need help?'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter a whole number from 0 to 9.')).toBeTruthy();
    expect(screen.getByLabelText('How many more households need help?').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Conditions' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How many more households need help?'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Scenario seed'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter a whole number from 0 to 4294967295.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Scenario seed'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Supply kits'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter a whole number from 0 to 6.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('keeps focus in the field being corrected when another field is still invalid', () => {
    render(<Wizard initial={{ ...DEFAULT_CONFIG, additionalNeeds: -1, seed: -1 }} />);
    customize();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const additionalNeeds = screen.getByLabelText('How many more households need help?');
    expect(document.activeElement).toBe(additionalNeeds);
    fireEvent.change(additionalNeeds, { target: { value: '3' } });
    expect(document.activeElement).toBe(additionalNeeds);
    expect(screen.getByText('Enter a whole number from 0 to 4294967295.')).toBeTruthy();
  });
});

describe('secondary panels', () => {
  it('uses a compact confirmation variant and restores focus after Escape or Close', () => {
    const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
    function Confirmation() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>New exercise</button>{open && <SecondaryPanel title="Start over?" variant="confirmation" onClose={() => setOpen(false)}><p>Discard this run and return to setup?</p><button onClick={() => setOpen(false)}>Cancel</button></SecondaryPanel>}</>;
    }
    try {
      render(<Confirmation />);
      const trigger = screen.getByRole('button', { name: 'New exercise' });
      for (const dismiss of ['escape', 'close']) {
        trigger.focus();
        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Start over?' });
        expect(dialog.getAttribute('data-variant')).toBe('confirmation');
        const closeButton = screen.getByRole('button', { name: 'Close Start over?' });
        expect(document.activeElement).toBe(closeButton);
        if (dismiss === 'escape') fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
        else fireEvent.click(closeButton);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
      }
    } finally {
      cleanup();
      if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });
});

describe('results workspace', () => {
  it('starts with computed outcomes and map, keeping comparison, homes, and details in tabs', () => {
    const state = runDefaultWitness(createScenario(DEFAULT_CONFIG, null));
    const pristine = structuredClone(state.scenario);
    const summary = summarize(state);
    const baseline = summarize(runBaseline(structuredClone(state.scenario)));
    const callbacks = { onExport: vi.fn(), onReplay: vi.fn(), onRestart: vi.fn(), onEdit: vi.fn() };
    render(<Results state={state} {...callbacks} />);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('definition', { name: 'People helped' }).textContent).toBe(String(summary.peopleAssisted));
    expect(screen.getByRole('definition', { name: 'Urgent help on time' }).textContent).toBe(`${summary.timelyUrgentCount} / ${summary.urgentNeeds}`);
    expect(screen.getByRole('definition', { name: 'Undiscovered needs' }).textContent).toBe(String(summary.stillUndiscovered));
    expect(screen.getByTestId('town-map')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
    const contactRow = screen.getByRole('row', { name: /Contact coverage/ });
    expect(within(contactRow).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Contact coverage', `${Math.round(summary.contactCoverage * 100)}%`, `${Math.round(baseline.contactCoverage * 100)}%`, `${Math.round((summary.contactCoverage - baseline.contactCoverage) * 100) > 0 ? '+' : ''}${Math.round((summary.contactCoverage - baseline.contactCoverage) * 100)} pp`]);
    expect(screen.getByRole('img', { name: `People assisted by minute 60: your response ${summary.peopleAssisted}, baseline ${baseline.peopleAssisted}` })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Homes' }));
    expect(screen.getByRole('heading', { name: 'H19 · Assistance completed' })).toBeTruthy();
    expect(screen.getByText('00:24', { selector: '.timeline-highlight strong' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Inspect household timeline'), { target: { value: 'H02' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByRole('region', { name: 'Resource accounting' })).toBeTruthy();
    expect(screen.getByText('Behavior provenance')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Homes' }));
    expect((screen.getByLabelText('Inspect household timeline') as HTMLSelectElement).value).toBe('H02');
    expect(state.scenario).toEqual(pristine);
    fireEvent.click(screen.getByRole('button', { name: 'Export run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replay decisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart same conditions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit conditions' }));
    Object.values(callbacks).forEach(callback => expect(callback).toHaveBeenCalledOnce());
  });

  it('supports standard keyboard navigation through the results tabs', () => {
    const state = runDefaultWitness(createScenario(DEFAULT_CONFIG, null));
    render(<Results state={state} onExport={vi.fn()} onReplay={vi.fn()} onRestart={vi.fn()} onEdit={vi.fn()} />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Compare' }));
    expect(screen.getByRole('tab', { name: 'Compare' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Details' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(overview);
  });
});
