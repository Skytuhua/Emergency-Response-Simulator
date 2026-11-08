// @vitest-environment jsdom
import { afterEach,beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import type { SetupOverlayV2 } from '../../src/v2/contracts';
import type { TownMapProps } from '../../src/ui/TownMap';
import { SetupMapV2 } from '../../src/ui/v2/SetupMapV2';

// Only the external map layout is replaced; setup controls and callbacks are real.
vi.mock('../../src/ui/TownMap',()=>({TownMap:(props:TownMapProps)=><div>
  <button onClick={()=>props.onMapPoint?.({lat:32.79,lon:-96.78})}>Pick a map point</button>
  <output aria-label="Map base node">{props.responseBase?.nodeId}</output>
</div>}));
afterEach(cleanup);
beforeAll(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
});
const settings=():SetupOverlayV2=>({kind:'dallas-user-setup',version:1,base:null,roads:[],resources:{crews:4,vans:4,accessibleVans:2,supplyBundles:250,shelterPlaces:[{facilityId:'SHELTER',places:150}]}});

it('forwards a requested point only in base mode and retains the accepted street base while resolving',()=>{
  const bundle=mechanicsFixture(),setup=settings(),pick=vi.fn(),toggle=vi.fn();
  const result=render(<SetupMapV2 bundle={bundle} setup={setup} mode="base" onBasePick={pick} onRoadToggle={toggle}/>);
  fireEvent.click(screen.getByRole('button',{name:'Pick a map point'}));expect(pick).toHaveBeenCalledWith({lat:32.79,lon:-96.78});
  result.rerender(<SetupMapV2 bundle={bundle} setup={setup} mode="base" baseBusy onBasePick={pick} onRoadToggle={toggle}/>);
  fireEvent.click(screen.getByRole('button',{name:'Pick a map point'}));expect(pick).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Map base node').textContent).toBe('B');
  expect(screen.getByText(/Finding a reachable street base/).getAttribute('role')).toBe('status');
});

it('shows the exact snapped street location separately from the requested point without mutating source metadata',()=>{
  const bundle=mechanicsFixture(),setup=settings(),before=JSON.stringify(bundle);
  setup.base={requested:{lat:32.79001,lon:-96.77981},nodeId:'H'};
  render(<SetupMapV2 bundle={bundle} setup={setup} mode="base" onBasePick={vi.fn()} onRoadToggle={vi.fn()}/>);
  expect(screen.getByLabelText('Map base node').textContent).toBe('H');
  expect(screen.getByLabelText('Actual base coordinates').textContent).toBe('32.79, -96.7798');
  expect(screen.getByLabelText('Requested base coordinates').textContent).toBe('32.79001, -96.77981');
  expect(screen.getByText(/about 1.5 m/)).toBeTruthy();
  expect(JSON.stringify(bundle)).toBe(before);
});

it('offers keyboard street search and passes the physical edge identity once per toggle',async()=>{
  const bundle=mechanicsFixture(),setup=settings(),toggle=vi.fn(),pick=vi.fn();
  bundle.assets.events=[{id:'initial-HS',effectiveAtMs:0,observedAtMs:0,sourceClass:'assumed',sourceRef:'authored-test',payload:{type:'edge-state-change',edgeIds:['HS'],closed:true}}];
  const result=render(<SetupMapV2 bundle={bundle} setup={setup} mode="roads" onBasePick={pick} onRoadToggle={toggle}/>);
  const finder=screen.getByRole('button',{name:'Find a street'});finder.focus();await userEvent.keyboard('{Enter}');
  fireEvent.change(screen.getByRole('searchbox',{name:'Search streets'}),{target:{value:'HS'}});
  const blocked=screen.getByRole('button',{name:'Reopen HS, segment 0003'});blocked.focus();await userEvent.keyboard('{Enter}');
  expect(toggle).toHaveBeenCalledExactlyOnceWith('HS');expect(pick).not.toHaveBeenCalled();
  result.rerender(<SetupMapV2 bundle={bundle} setup={{...setup,roads:[{edgeId:'HS',closed:false}]}} mode="roads" onBasePick={pick} onRoadToggle={toggle}/>);
  expect(screen.getByRole('button',{name:'Block HS, segment 0003'}).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByText('Reopened by you')).toBeTruthy();
  const search=screen.getByRole('searchbox',{name:'Search streets'});search.focus();fireEvent.keyDown(search,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(finder);
});
