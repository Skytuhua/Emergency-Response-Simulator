// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createScenario, DALLAS_DEFAULT_CONFIG, DEFAULT_CONFIG } from '../src/scenario';
import { initialize, dispatch, advanceMinute } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { TownMap } from '../src/ui/TownMap';
import { Creator } from '../src/ui/Creator';
import { validateArtifact } from '../src/artifact';
import legacyArtifact from '../public/data/mirofish-v1.json';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders completed Dallas vehicles at their actual street arrival position', () => {
  let state = initialize(createScenario(DALLAS_DEFAULT_CONFIG), 'actual-position');
  state = dispatch(state, {runId:state.runId, commandId:'check', sequence:1, minute:0, action:'ASSESS', unitId:'C1', householdId:'H19'}).state;
  while (state.minute < state.missions[0].completionAt) state = advanceMinute(state);
  const view = observe(state), unit = view.units.find(item => item.id === 'C1')!;
  expect(unit.missionId).toBeNull();
  const {container} = render(<TownMap view={view} />);
  const marker = container.querySelector<HTMLElement>('[data-unit-id="C1"]')!;
  // Both anchors now live in Leaflet's pixel pane. The completed vehicle must
  // remain at its actual destination rather than teleporting to the base.
  const destination = container.querySelector<HTMLElement>('[title^="H19,"]')!;
  expect(marker.style.left).toBe(destination.style.left);
  expect(marker.style.top).toBe(destination.style.top);
  expect(marker.style.left).not.toBe(container.querySelector<HTMLElement>('.map-facility.base')!.style.left);
});

it('keeps the Dallas welcome preview valid when editing a retained legacy run', () => {
  render(<Creator config={DEFAULT_CONFIG} artifact={validateArtifact(legacyArtifact)} error={null} onChange={vi.fn()} onStart={vi.fn()} onDefault={vi.fn()} onImport={vi.fn()} />);
  expect(screen.getByLabelText('Real Dallas streets with fictional homes and incidents')).toBeTruthy();
  expect(screen.queryByText('Enter valid conditions to preview the town.')).toBeNull();
});
