// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { newlyDiscoveredUrgency } from '../src/ui/controller';
import type { ObservationView, ObservedHousehold } from '../src/model';

const household = (id: string, known: boolean, completed = false): ObservedHousehold => ({
  id, name: id, address: 'Synthetic street', nodeId: id, x: 0, y: 0,
  neighborhood: 'southeast', communications: false, status: known ? 'reported' : 'unknown',
  known: known ? { need: { id: `N-${id}`, kind: 'relocation', urgent: true, onset: 0, deadline: 30 }, size: 2, accessible: true, consent: true, observedAt: 8, receivedAt: 8, source: 'assessment', requestText: 'Known request' } : null,
  contactedAt: known ? 8 : null, assessedAt: known ? 8 : null, completedAt: completed ? 8 : null, missionId: null,
});
const view = (households: ObservedHousehold[]) => ({ households } as ObservationView);

describe('exercise urgency pause', () => {
  it('pauses for a newly radio-assessed urgent household in an outage', () => {
    expect(newlyDiscoveredUrgency(view([household('H19', false)]), view([household('H19', true)]))).toBe('H19');
  });
  it('does not repeatedly pause for an already known urgent household', () => {
    expect(newlyDiscoveredUrgency(view([household('H19', true)]), view([household('H19', true)]))).toBeNull();
  });
  it('does not pause for a need resolved in the same minute', () => {
    expect(newlyDiscoveredUrgency(view([household('H19', false)]), view([household('H19', true, true)]))).toBeNull();
  });
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('operator workflow', () => {
  it('moves focus and scroll to new screens and exposes finish confirmation', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create exercise/ }));
    expect(document.activeElement === screen.getByRole('heading', { name: 'Coordinate the response' })).toBe(true);
    expect(window.scrollTo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Finish at minute 60/ }));
    expect(document.activeElement === screen.getByRole('alert')).toBe(true);
  });
  it('starts paused, hides private needs, then discovers H19 over radio at minute eight', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create exercise/ }));
    expect(screen.getByRole('button', { name: 'Resume exercise' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'H19, Southeast, unknown' }));
    expect(screen.getByText('Need not yet known')).toBeTruthy();
    expect(screen.queryByText('Shelter relocation')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Assess/ }));
    const stepButton = screen.getByRole('button', { name: 'Advance one minute' });
    for (let minute = 0; minute < 7; minute++) fireEvent.click(stepButton);
    expect(screen.queryByText('Shelter relocation')).toBeNull();
    fireEvent.click(stepButton);
    expect(screen.getByText('Shelter relocation')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review need/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume exercise' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Response unit'), { target: { value: 'V1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Relocate/ }));
    expect(screen.getByText(/2 reserved/)).toBeTruthy();
    for (let minute = 8; minute < 24; minute++) fireEvent.click(stepButton);
    expect(screen.getByText('Assisted', { selector: '.facts-list dd' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Relocate/ }).hasAttribute('disabled')).toBe(true);
  }, 20000);

  it('keeps a single timer and pauses it when a household is selected', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create exercise/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume exercise' }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('00:01', { selector: '.clock-display' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'H19, Southeast, unknown' }));
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByText('00:01', { selector: '.clock-display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume exercise' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume exercise' }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('00:02', { selector: '.clock-display' })).toBeTruthy();
  });

  it('finishes at the common horizon and computes a debrief without inventing improvements', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create exercise/ }));
    fireEvent.click(screen.getByRole('button', { name: /Finish at minute 60/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish exercise' }));
    expect(screen.getByRole('heading', { name: 'Results & analysis' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /People assisted by minute 60: your response 0/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume exercise' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Restart same conditions/ }));
    expect(screen.getByText('00:00', { selector: '.clock-display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume exercise' })).toBeTruthy();
  });
});
