// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createScenario, DALLAS_DEFAULT_CONFIG, DEFAULT_CONFIG } from '../src/scenario';
import { initialize } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { summarize } from '../src/sim/results';
import { TownMap } from '../src/ui/TownMap';
import geography from '../fixtures/v2/geography/dallas-geography-v2.json';

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

it('reclaims both explanation rows while keeping map credit in the legend', () => {
  const { container } = render(<TownMap view={dallas()} onSelect={vi.fn()} />);
  expect(container.querySelector('.geographic-tile-status')).toBeNull();
  expect(container.querySelector('.map-source')).toBeNull();
  expect(screen.queryByText(/Street map loaded|Loading street map|Supported area inside/)).toBeNull();
  const credit = screen.getByRole('link', { name: /OpenStreetMap contributors/ });
  expect(credit.closest('.map-legend')).toBeTruthy();
});

it('fits the complete actual tract rings and anchors a prominent filled boundary to their real edge', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  const callback=vi.fn(),rings=geography.tracts.flatMap(tract=>tract.rings) as [number,number][][];
  const {container}=render(<TownMap view={dallas()} boundaryRings={rings} mapTitle="Dallas response area" onViewportChange={callback}/>);
  const vertices=rings.flat(),south=Math.min(...vertices.map(point=>point[1])),north=Math.max(...vertices.map(point=>point[1]));
  const west=Math.min(...vertices.map(point=>point[0])),east=Math.max(...vertices.map(point=>point[0]));
  const viewport=callback.mock.lastCall![0];
  expect(viewport.bounds.south).toBeLessThan(south);
  expect(viewport.bounds.north).toBeGreaterThan(north);
  expect(viewport.bounds.west).toBeLessThan(west);
  expect(viewport.bounds.east).toBeGreaterThan(east);
  expect(viewport.zoom).toBeGreaterThan(14);
  expect(container.querySelectorAll('.simulation-boundary')).toHaveLength(2);
  expect(container.querySelectorAll('.simulation-boundary-halo')).toHaveLength(2);
  expect(container.querySelectorAll('.simulation-boundary-fill')).toHaveLength(2);
  expect(screen.getByRole('heading',{name:'Dallas response area'}).closest('.geographic-toolbar')).toBeTruthy();
});

it('places the exact group count inside a house silhouette and keeps the group keyboard action', () => {
  const select = vi.fn();
  render(<TownMap view={dallas()} onSelect={select} householdCounts={{ H19: 463 }} householdTitles={{ H19: '463 homes · 1 known waiting' }} />);
  const group = screen.getByRole('button', { name: '463 homes · 1 known waiting' });
  expect(group.querySelector('svg.map-house-group-icon path')).toBeTruthy();
  expect(group.querySelector('svg.map-house-group-icon text')?.textContent).toBe('463');
  expect(group.querySelector('circle')).toBeNull();
  expect(group.querySelector('.map-house-label')).toBeNull();
  group.focus();
  fireEvent.click(group, { detail: 0 });
  expect(select).toHaveBeenCalledWith('H19');
  expect(document.activeElement).toBe(group);
});

it('uses an explicit response base without changing the admitted map base metadata',()=>{
  const view=dallas(),original=view.map.metadata!.baseNodeId;
  const {container}=render(<TownMap view={view} responseBase={{nodeId:'configured-base',x:7,y:8,label:'Response base'}}/>);
  expect(container.querySelector('.map-facility.base')?.getAttribute('data-base-node-id')).toBe('configured-base');
  expect(container.querySelector('.map-facility.base')?.getAttribute('aria-label')).toBe('Response base');
  expect(view.map.metadata!.baseNodeId).toBe(original);
});

it('separates setup map point picking from retained road selection and keeps the viewport on edits',()=>{
  const source=dallas(),view={...source,map:{...source.map,edges:source.map.edges.slice(0,2)}},point=vi.fn(),road=vi.fn();
  const id=view.map.edges[0].id;
  const {container,rerender}=render(<TownMap view={view} onMapPoint={point} onRoadSelect={road} roadOverrides={{[id]:true}}/>);
  const map=container.querySelector('.leaflet-container')!,target=container.querySelector(`.setup-road-target[data-road-id="${id}"]`)!;
  expect(target).toBeTruthy();fireEvent.click(target,{clientX:20,clientY:20});
  expect(road).toHaveBeenCalledWith(id);expect(point).not.toHaveBeenCalled();
  fireEvent.click(map,{clientX:100,clientY:100});expect(point).toHaveBeenCalledWith({lat:expect.any(Number),lon:expect.any(Number)});
  point.mockClear();fireEvent.keyDown(map,{key:'Enter'});expect(point).toHaveBeenCalledWith({lat:expect.any(Number),lon:expect.any(Number)});
  expect(container.querySelector('.setup-road-user-blocked')).toBeTruthy();
  rerender(<TownMap view={view} onMapPoint={point} onRoadSelect={road} roadOverrides={{[id]:false}}/>);
  expect(container.querySelector('.leaflet-container')).toBe(map);
  expect(container.querySelector('.setup-road-reopened')).toBeTruthy();
});

it('keeps Leaflet classes and map instance when base picking is disabled and re-enabled', () => {
  const view=dallas(),pick=vi.fn();
  const {container,rerender}=render(<TownMap view={view} onMapPoint={pick}/>);
  const map=container.querySelector('.leaflet-container');
  expect(map).toBeTruthy();
  rerender(<TownMap view={view}/>);
  expect(container.querySelector('.leaflet-container')).toBe(map);
  rerender(<TownMap view={view} onMapPoint={pick}/>);
  expect(container.querySelector('.leaflet-container')).toBe(map);
});

it('reports initial and zoomed viewports without replacing the map on snapshot updates', () => {
  const callback = vi.fn(), view = dallas();
  const { container, rerender } = render(<TownMap view={view} onViewportChange={callback} />);
  const map = container.querySelector('.leaflet-container');
  expect(callback).toHaveBeenCalled();
  const initial = callback.mock.lastCall![0];
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(callback.mock.lastCall![0].zoom).toBeGreaterThan(initial.zoom);
  expect(callback.mock.lastCall![0].bounds).toEqual(expect.objectContaining({ north: expect.any(Number), south: expect.any(Number), west: expect.any(Number), east: expect.any(Number) }));
  const afterZoom = callback.mock.lastCall![0];
  rerender(<TownMap view={{ ...view, minute: 1 }} onViewportChange={callback} />);
  expect(container.querySelector('.leaflet-container')).toBe(map);
  expect(callback.mock.lastCall![0]).toEqual(afterZoom);
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
  expect(screen.queryByRole('button', { name: /need not found/ })).toBeNull();
  rerender(<TownMap view={{ ...view, finalized: true }} debrief={debrief} onSelect={vi.fn()} />);
  expect(screen.getByRole('button', { name: /^H19, Southeast, need not found \(results\)$/ })).toBeTruthy();
});

it('retains the legacy Riverdale canvas and controls contract', () => {
  const { container } = render(<TownMap view={observe(initialize(createScenario(DEFAULT_CONFIG), 'legacy'))} onSelect={vi.fn()} />);
  expect(screen.getByLabelText('Schematic map of fictional Riverdale')).toBeTruthy();
  expect(container.querySelector('canvas')).toBeTruthy();
  expect(container.querySelector('.leaflet-container')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^H\d+,/ })).toHaveLength(24);
});
