// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { SetupV2, type SetupV2Settings } from '../../src/ui/v2/SetupV2';

afterEach(cleanup);
const bundle=mechanicsFixture();
const initial:SetupV2Settings={kind:'dallas-user-setup',version:1,base:null,roads:[],resources:{crews:4,vans:4,accessibleVans:2,supplyBundles:250,shelterPlaces:[{facilityId:'SHELTER',places:10}]}};
function show(extra:Partial<Parameters<typeof SetupV2>[0]>={}) {
  const onStart=vi.fn(),onImport=vi.fn(),onEditMode=vi.fn();
  function Harness(){const [setup,setSetup]=useState<SetupV2Settings>(structuredClone(initial));return <SetupV2 bundle={bundle} setup={setup} onChange={setSetup} onStart={onStart} onImport={onImport} map={<div>Authored map slot</div>} editMode="base" onEditMode={onEditMode} {...extra}/>;}
  render(<Harness/>);return {onStart,onImport,onEditMode};
}
function resources(){fireEvent.click(screen.getByRole('button',{name:'Customize setup'}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));}

describe('expanded onboarding and guided setup',()=>{
  it('starts the default automatic simulation or opens a saved run from the welcome screen',()=>{
    const callbacks=show();
    expect(screen.getByRole('heading',{name:'Dallas storm response'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Start simulation'}));
    expect(callbacks.onStart).toHaveBeenCalledWith(initial);
    fireEvent.click(screen.getByRole('button',{name:'Open saved run'}));
    expect(callbacks.onImport).toHaveBeenCalledTimes(1);
  });
  it('preserves resource choices when going Back and submits the full reviewed settings',()=>{
    const callbacks=show();resources();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Transport vans'),{target:{value:'12'}});
    fireEvent.change(screen.getByLabelText('Vans with accessible places'),{target:{value:'3'}});
    fireEvent.change(screen.getByLabelText('Supply bundles'),{target:{value:'450'}});
    fireEvent.click(screen.getByRole('button',{name:'Back'}));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect((screen.getByLabelText('Transport vans') as HTMLInputElement).value).toBe('12');
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Start simulation'}));
    expect(callbacks.onStart).toHaveBeenCalledWith(expect.objectContaining({resources:expect.objectContaining({vans:12,accessibleVans:3,supplyBundles:450})}));
  });
  it('identifies invalid accessible-van counts beside the field and prevents progression',()=>{
    const callbacks=show();resources();
    const input=screen.getByLabelText('Vans with accessible places');
    fireEvent.change(input,{target:{value:'5'}});
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Choose 0 to 4 accessible vans.')).toBeTruthy();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(callbacks.onStart).not.toHaveBeenCalled();
  });
  it('keeps outside-base feedback next to placement controls and blocks invalid setup',()=>{
    const callbacks=show({errors:{base:'Choose a point inside the simulation boundary.'}});
    fireEvent.click(screen.getByRole('button',{name:'Customize setup'}));
    expect(screen.getByRole('alert').textContent).toContain('inside the simulation boundary');
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(callbacks.onStart).not.toHaveBeenCalled();
  });
  it('offers map-edit modes through named keyboard controls without dispatching responders',async()=>{
    const callbacks=show();const user=userEvent.setup();
    screen.getByRole('button',{name:'Customize setup'}).focus();await user.keyboard('{Enter}');
    const roads=screen.getByRole('button',{name:'Edit road blocks'});roads.focus();await user.keyboard('{Enter}');
    expect(callbacks.onEditMode).toHaveBeenCalledWith('roads');
    expect(screen.queryByRole('button',{name:/dispatch|send help|assign/i})).toBeNull();
    expect(within(screen.getByRole('region',{name:'Base and roads'})).getByText('Authored map slot')).toBeTruthy();
  });
});
