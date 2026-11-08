// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { V2App } from '../../src/V2App';
import { advanceSessionV2, finishSessionV2 } from '../../src/v2/coordinate';
import { replayV2 } from '../../src/v2/run-file';

vi.mock('../../src/v2/admission', async original => ({ ...await original<typeof import('../../src/v2/admission')>(), parseScenarioV2: vi.fn(value => JSON.parse(value)) }));
vi.mock('../../src/v2/coordinate', async original => {
  const real = await original<typeof import('../../src/v2/coordinate')>();
  return { ...real, advanceSessionV2: vi.fn(real.advanceSessionV2), finishSessionV2: vi.fn(async session => ({ ...session, world: { ...session.world, finalized: true } })) };
});
vi.mock('../../src/v2/run-file', async original => ({ ...await original<typeof import('../../src/v2/run-file')>(), makeRunFileV2: vi.fn(() => ({})), replayV2: vi.fn() }));
vi.mock('../../src/ui/v2/ObserverV2', () => ({ ObserverV2: (props: Record<string, any>) => <div><span>{props.playing ? 'Playing' : 'Paused'}</span><button onClick={props.onToggle}>Toggle</button><button onClick={props.onPause}>Pause for details</button><button onClick={props.onFinish}>Skip to the end</button><button onClick={props.onRestart}>Restart</button></div> }));
vi.mock('../../src/ui/v2/ResultsV2', () => ({ ResultsV2: (props: Record<string, any>) => <div><button onClick={props.onReplay}>Replay</button><button onClick={props.onRestart}>Restart now</button></div> }));
vi.mock('../../src/ui/v2/SetupMapV2',()=>({SetupMapV2:()=> <div>Authored setup map</div>}));

async function load() {
  render(<V2App onLegacy={vi.fn()}/>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole('button',{name:'Start simulation'}));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => {const bundle=mechanicsFixture();bundle.assets.facilities.forEach(facility=>{if(facility.kind==='shelter')facility.capacity=16;});return JSON.stringify(bundle);} })));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('expanded app playback and plain-language controls', () => {
  it('uses loaded population counts and runs exactly one timer; details pause without resuming', async () => {
    await load();
    expect(screen.getByText('Emergency Response Simulator')).toBeTruthy();
    expect(screen.getByText(/Dallas · 16 simulated residents/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(advanceSessionV2).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Pause for details'));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(advanceSessionV2).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Paused')).toBeTruthy();
    fireEvent.click(screen.getByText('Toggle'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(advanceSessionV2).toHaveBeenCalledTimes(3);
  });
  it('pauses on a hidden tab and stays paused when it becomes visible', async () => {
    await load();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    act(() => { vi.advanceTimersByTime(2000); });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(advanceSessionV2).not.toHaveBeenCalled();
    expect(screen.getByText('Paused')).toBeTruthy();
  });
  it('asks a short, understandable confirmation before skipping time', async () => {
    await load(); fireEvent.click(screen.getByText('Skip to the end'));
    const dialog = screen.getByRole('dialog', { name: 'Skip to the end?' });
    expect(within(dialog).getByText('Run the remaining time and show the results?')).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/cutoff|observation|source-conditioned/);
    expect(finishSessionV2).not.toHaveBeenCalled();
  });
  it('explains a rejected import without exposing parser text as the main message', async () => {
    await load();
    const file = { size: 1, text: async () => 'invalid json' };
    await act(async () => { fireEvent.change(screen.getByLabelText('Choose a saved run'), { target: { files: [file] } }); });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText("This file couldn't be opened. Choose a saved simulation run.")).toBeTruthy();
    expect(within(alert).getByText('Error details').closest('details')?.open).toBe(false);
    expect(screen.getByText('Paused')).toBeTruthy();
  });
  it('ignores a failed old replay after a restart', async () => {
    await load(); fireEvent.click(screen.getByText('Skip to the end'));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Skip to the end' })); });
    let reject!: (cause: Error) => void;
    vi.mocked(replayV2).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    fireEvent.click(screen.getByText('Replay'));
    fireEvent.click(screen.getByText('Restart now'));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Restart simulation?'})).getByRole('button',{name:'Restart'}));
    await act(async () => { reject(new Error('stale replay error')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Playing')).toBeTruthy();
  });
});
