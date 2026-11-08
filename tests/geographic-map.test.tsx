// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createScenario, DALLAS_DEFAULT_CONFIG, DEFAULT_CONFIG } from '../src/scenario';
import { initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { summarize } from '../src/sim/results';
import { TownMap } from '../src/ui/TownMap';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom lacks SVG capability detection; Leaflet's real SVG renderer is retained.
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value() { return {}; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const dallas = () => observe(initialize(createScenario(DALLAS_DEFAULT_CONFIG), 'map-test'));

it('provides an interactive tiled map and explicit supported simulation area', () => {
  const { container } = render(<TownMap view={dallas()} onSelect={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Fit simulation area' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
  expect(container.querySelector('.leaflet-container')).toBeTruthy();
  expect(screen.getByText('Simulation boundary')).toBeTruthy();
  expect(container.querySelector('.simulation-boundary')).toBeTruthy();
  expect(container.querySelector('.communications-outage')).toBeTruthy();
});

it('isolates map keyboard interaction and preserves selection callbacks', () => {
  const select = vi.fn(), globalKey = vi.fn();
  window.addEventListener('keydown', globalKey);
  const { container } = render(<TownMap view={dallas()} onSelect={select} selected="H19" />);
  const marker = screen.getByRole('button', { name: /^H19,/ });
  fireEvent.click(marker);
  expect(select).toHaveBeenCalledWith('H19');
  expect(marker.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(container.querySelector('.town-map')!, { key: 'Escape' });
  window.removeEventListener('keydown', globalKey);
  expect(globalKey).not.toHaveBeenCalled();
});

it('mounts through StrictMode and keeps the geographic map and focused home on state updates', () => {
  const view = dallas();
  const { container, rerender, unmount } = render(<StrictMode><TownMap view={view} onSelect={vi.fn()} /></StrictMode>);
  const map = container.querySelector('.leaflet-container');
  expect(map).toBeTruthy();
  const home = screen.getByRole('button', { name: /^H02,/ });
  home.focus();
  rerender(<StrictMode><TownMap view={{ ...view, minute: 1 }} onSelect={vi.fn()} selected="H02" /></StrictMode>);
  expect(container.querySelector('.leaflet-container')).toBe(map);
  expect(document.activeElement).toBe(home);
  expect(screen.getByRole('button', { name: 'H19, Southeast, unknown' }).classList.contains('urgent')).toBe(false);
  unmount();
  expect(container.querySelector('.leaflet-container')).toBeNull();
});

it('reveals undiscovered needs only in a finalized debrief', () => {
  const state = initialize(createScenario(DALLAS_DEFAULT_CONFIG), 'debrief-map'), view = observe(state), debrief = summarize(state);
  const { rerender } = render(<TownMap view={view} debrief={debrief} onSelect={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /undiscovered need/ })).toBeNull();
  rerender(<TownMap view={{ ...view, finalized: true }} debrief={debrief} onSelect={vi.fn()} />);
  expect(screen.getByRole('button', { name: /^H19, Southeast, undiscovered need \(debrief\)$/ })).toBeTruthy();
});

it('retains the legacy Riverdale canvas and controls contract', () => {
  const { container } = render(<TownMap view={observe(initialize(createScenario(DEFAULT_CONFIG), 'legacy'))} onSelect={vi.fn()} />);
  expect(screen.getByLabelText('Schematic map of fictional Riverdale')).toBeTruthy();
  expect(container.querySelector('canvas')).toBeTruthy();
  expect(container.querySelector('.leaflet-container')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^H\d+,/ })).toHaveLength(24);
});
