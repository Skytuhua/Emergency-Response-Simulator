// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import type { ScenarioConfig } from '../src/model';
import prepared from '../public/data/mirofish-dallas-v1.json';
import legacy from '../public/data/mirofish-v1.json';

vi.mock('../src/ui/Creator', () => ({ Creator: ({ onStart }: { onStart: (config?: ScenarioConfig) => void }) => <button onClick={() => onStart(DALLAS_DEFAULT_CONFIG)}>Start simulation</button> }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({ ok:true, json:async () => url.includes('dallas') ? prepared : legacy })));
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches:false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const start = async () => { render(<App />); await act(async () => {}); fireEvent.click(screen.getByRole('button', {name:'Start simulation'})); };
const select = (id: string) => fireEvent.click(document.querySelector(`#map-home-${id}`)!);
const clock = () => document.querySelector('.clock-display')!.textContent;
const advance = (count: number) => { for (let i=0;i<count;i++) fireEvent.click(screen.getByRole('button', {name:'Advance one minute'})); };

describe('automatic observation lifecycle', () => {
  it('starts automatic coordination and exactly one playback clock without user dispatch', async () => {
    await start();
    expect(screen.getByRole('button', {name:'Pause simulation'})).toBeTruthy();
    expect(document.querySelectorAll('.map-unit').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', {name:/Check home|Send supplies|Send a ride/})).toBeNull();
    act(() => vi.advanceTimersByTime(2000)); expect(clock()).toContain('00:01');
    select('H19');
    act(() => vi.advanceTimersByTime(2000)); expect(clock()).toContain('00:02');
    fireEvent.click(screen.getByRole('button', {name:'Pause simulation'}));
    act(() => vi.advanceTimersByTime(4000)); expect(clock()).toContain('00:02');
  });
  it('continues through new urgency and distinguishes a check or assignment from completion', async () => {
    await start(); select('H19');
    expect(document.querySelector('.observation-home-state.is-completed')).toBeNull();
    act(() => vi.advanceTimersByTime(12000));
    expect(clock()).toContain('00:06');
    expect(screen.getByRole('button', {name:'Pause simulation'})).toBeTruthy();
    expect(screen.getByText('Accessible transport', {selector:'.observation-fact-chips p'})).toBeTruthy();
    expect(document.querySelector('.observation-home-state.is-completed')).toBeNull();
    advance(30);
    expect(clock()).toContain('00:36');
    expect(document.querySelector('.observation-home-state.is-completed')).not.toBeNull();
  }, 20000);
  it('pauses on Details and restores focus without resuming when the dialog closes', async () => {
    await start(); select('H19');
    const details = screen.getByRole('button', {name:'Details'}); details.focus(); fireEvent.click(details);
    const dialog = screen.getByRole('dialog', {name:'Details'});
    act(() => vi.advanceTimersByTime(4000)); expect(clock()).toContain('00:00');
    fireEvent(dialog, new Event('cancel', {bubbles:true,cancelable:true}));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(details);
    expect(screen.getByRole('button', {name:'Resume simulation'})).toBeTruthy();
  });
  it('pauses a hidden tab and never catches up when visibility returns', async () => {
    await start();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(10000)); expect(clock()).toContain('00:00');
    expect(screen.getByRole('button', {name:'Resume simulation'})).toBeTruthy();
  });
  it('advances the policy to outcomes and starts a fresh automatic run on restart', async () => {
    await start(); fireEvent.click(screen.getByRole('button',{name:'Exercise'}));
    fireEvent.click(screen.getByRole('button',{name:'View outcomes'}));
    fireEvent.click(screen.getByRole('button',{name:'Finish now'}));
    expect(screen.getByRole('heading',{name:'Results & analysis'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Restart same conditions'}));
    expect(clock()).toContain('00:00'); expect(screen.getByRole('button',{name:'Pause simulation'})).toBeTruthy();
  }, 20000);
});
