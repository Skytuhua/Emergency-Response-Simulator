// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { observeCoordinator } from '../../src/v2/observe';
import { advanceWorld, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { adaptMapV2 } from '../../src/ui/v2/map-adapter';
import { TownMap } from '../../src/ui/TownMap';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('animates a recorded trip and snaps to the observed position on pause',()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
  Object.defineProperty(SVGSVGElement.prototype,'createSVGRect',{configurable:true,value(){return {};}});
  let nextId=0;const frames=new Map<number,FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextId,callback);return nextId;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.spyOn(performance,'now').mockReturnValue(100);
  const world=dispatchWorld(initializeWorld(mechanicsFixture(),'motion-ui'),{id:'check',sequence:1,atMs:0,action:'check',unitId:'C1',householdId:'H1'}).state;
  const before=observeCoordinator(advanceWorld(world,30000)),after=observeCoordinator(advanceWorld(world,90000));
  const renderMap=(observation:typeof before,playing:boolean)=>{const scene=adaptMapV2(observation);return <TownMap view={scene.view} unitStates={scene.unitStates} motionObservation={observation} motionPlaying={playing} motionSpeed={1}/>;};
  const {container,rerender}=render(renderMap(before,true));
  const marker=container.querySelector<HTMLElement>('[data-unit-id="C1"]')!;const start=marker.style.left;
  rerender(renderMap(after,true));expect(marker.style.left).toBe(start);
  const callback=[...frames.values()].at(-1)!;callback(600);
  const halfway=Number.parseFloat(marker.style.left);expect(halfway).not.toBe(Number.parseFloat(start));
  const stopped=structuredClone(after);stopped.nowMs+=60000;stopped.units.find(unit=>unit.id==='C1')!.status='stranded';stopped.missions[0].status='stranded';
  rerender(renderMap(stopped,true));const actual=Number.parseFloat(marker.style.left);expect(actual).not.toBe(halfway);
  rerender(renderMap(stopped,false));expect(Number.parseFloat(marker.style.left)).toBe(actual);
});
