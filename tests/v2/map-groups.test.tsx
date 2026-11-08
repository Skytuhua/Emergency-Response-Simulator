// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { observeSnapshot } from '../../src/v2/observe';
import { initializeWorld } from '../../src/v2/world';
import { MapV2 } from '../../src/ui/v2/MapV2';

// Real native group drawer, with only Leaflet's unavailable jsdom layout replaced.
vi.mock('../../src/ui/TownMap',()=>({TownMap:({view,onSelect,householdTitles}:{view:{households:{id:string}[]};onSelect?:(id:string)=>void;householdTitles:Record<string,string>})=><div>{view.households.map(home=><button key={home.id} aria-label={householdTitles[home.id]} onClick={()=>onSelect?.(home.id)}/>)}</div>}));
beforeAll(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(cleanup);

it('searches a map group by globally unique home name and selects its unchanged internal identity',()=>{
  const snapshot=observeSnapshot(initializeWorld(mechanicsFixture(),'group-names')),original=snapshot.coordinator.households[0];
  snapshot.coordinator.households=['A','B'].flatMap(tract=>Array.from({length:80},(_,i)=>({...original,id:`HH-${tract}-${String(i+1).padStart(4,'0')}`})));
  const select=vi.fn();render(<MapV2 snapshot={snapshot} onSelect={select}/>);
  fireEvent.click(screen.getByRole('button',{name:/160 homes/}));
  const dialog=screen.getByRole('dialog',{name:'Homes in selected map group'});
  expect(dialog.textContent).not.toContain('HH-');
  fireEvent.change(within(dialog).getByRole('searchbox',{name:'Search homes in this group'}),{target:{value:'Home 0081'}});
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button',{name:'Inspect Home 0081, Needs not yet known'}));
  expect(select).toHaveBeenCalledWith('HH-B-0001');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes on Escape from an active group search and restores the house marker focus',()=>{
  const snapshot=observeSnapshot(initializeWorld(mechanicsFixture(),'group-search-escape')),original=snapshot.coordinator.households[0];
  snapshot.coordinator.households=Array.from({length:160},(_,i)=>({...original,id:`HOME-${i+1}`}));
  render(<MapV2 snapshot={snapshot} onSelect={vi.fn()}/>);
  const opener=screen.getByRole('button',{name:/160 homes/});opener.focus();fireEvent.click(opener);
  const dialog=screen.getByRole('dialog',{name:'Homes in selected map group'}),search=within(dialog).getByRole('searchbox',{name:'Search homes in this group'});
  fireEvent.change(search,{target:{value:'Home 0001'}});search.focus();fireEvent.keyDown(search,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(opener);
});
