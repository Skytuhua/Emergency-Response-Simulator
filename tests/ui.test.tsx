// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';

vi.mock('../src/ui/Creator', () => ({ Creator: ({ onStart }: { onStart: () => void }) => <button onClick={() => onStart()}>Start exercise</button> }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const start = () => { render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Start exercise' })); };
const select = (id: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id},`) }));
const step = (count: number) => { for (let i = 0; i < count; i++) fireEvent.click(screen.getByRole('button', { name: /Advance one minute/ })); };

describe('simplified exercise controller', () => {
  it('starts paused and resumes exactly one clock after a successful dispatch', () => {
    start();
    expect(screen.getByRole('button', { name: /Resume exercise/ })).toBeTruthy();
    select('H19');
    fireEvent.click(screen.getByRole('button', { name: /^(Assess|Check home & run)/ }));
    expect(screen.getByRole('button', { name: /Pause exercise/ })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('00:01', { selector: '.clock-display' })).toBeTruthy();
    select('H18');
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText('00:01', { selector: '.clock-display' })).toBeTruthy();
  });
  it('preserves radio discovery and assistance at minutes8/16/24 without claiming help at dispatch', () => {
    start(); select('H19');
    expect(screen.queryByText('Needs transport')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Check home & run/ }));
    step(7); expect(screen.queryByText('Needs transport')).toBeNull(); step(1);
    expect(screen.getByRole('button', { name: /Resume exercise/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review need/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Response unit'), { target: { value: 'V1' } });
    fireEvent.click(screen.getByRole('button', { name: /Send transport & run/ }));
    expect(screen.queryByText('Helped', { selector: '.case-state h3' })).toBeNull();
    expect(screen.getByRole('button', { name: /Pause exercise/ })).toBeTruthy();
    step(8); expect(screen.queryByText('Helped', { selector: '.case-state h3' })).toBeNull();
    step(8); expect(screen.getByText('Helped', { selector: '.case-state h3' })).toBeTruthy();
    expect(screen.queryByText(/Silence does not mean safety/)).toBeNull();
    expect(screen.queryByText(/Assignment is not assistance/)).toBeNull();
  }, 20000);
  it('pauses for panels and Escape closes them before clearing the selected home', () => {
    start(); select('H19'); fireEvent.click(screen.getByRole('button', { name: /Check home & run/ }));
    const teams = screen.getByRole('button', { name: 'Teams' });
    teams.focus(); fireEvent.click(teams);
    expect(screen.getByRole('dialog', { name: 'Teams' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('00:00', { selector: '.clock-display' })).toBeTruthy();
    fireEvent(screen.getByRole('dialog', { name: 'Teams' }), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Home H19' })).toBeTruthy();
    expect(document.activeElement === teams).toBe(true);
    expect(screen.getByRole('button', { name: /Resume exercise/ })).toBeTruthy();
  });
  it('pauses when the document is hidden and never catches up', () => {
    start(); fireEvent.click(screen.getByRole('button', { name: /Resume exercise/ }));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText('00:00', { selector: '.clock-display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resume exercise/ })).toBeTruthy();
  });
  it('pauses when Escape clears the current home', () => {
    start(); select('H19'); fireEvent.click(screen.getByRole('button', { name: /Check home & run/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('00:00', { selector: '.clock-display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resume exercise/ })).toBeTruthy();
  });
  it('finishes via the exercise panel and restarts with a clean paused clock', () => {
    start(); fireEvent.click(screen.getByRole('button', { name: 'Exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish now' }));
    expect(screen.getByRole('heading', { name: 'Results & analysis' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restart/ }));
    expect(screen.getByText('00:00', { selector: '.clock-display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resume exercise/ })).toBeTruthy();
  });
});
