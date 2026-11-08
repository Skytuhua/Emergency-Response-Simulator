import { describe,expect,it } from 'vitest';
import { mechanicsFixture,needEvent } from '../../fixtures/v2/mechanics/fixture';
import { initializeWorld,advanceWorld } from '../../src/v2/world';
import { observeCoordinator } from '../../src/v2/observe';
import { householdSituationV2 } from '../../src/ui/v2/household-situation';
import { MINUTE_MS as M } from '../../src/v2/contracts';

describe('observer-only selected household situation',()=>{
  it('shows an actual unreported need without giving it to the coordinator or inventing a cause',()=>{
    const bundle=mechanicsFixture();bundle.assets.events=[needEvent('H1','delivery')];
    const world=initializeWorld(bundle,'observer-situation'),before=JSON.stringify(observeCoordinator(world));
    const situation=householdSituationV2(world,'H1')!;
    expect(situation.residentCount).toBe(2);
    expect(situation.needs).toEqual([{id:'N-H1',kind:'delivery',urgent:true,onsetMs:0,deadlineMs:90*M,completedAtMs:null,knownToTeams:false,cause:null}]);
    expect(JSON.stringify(observeCoordinator(world))).toBe(before);
    expect(observeCoordinator(world).households.find(home=>home.id==='H1')!.known).toBeNull();
  });
  it('does not reveal a future need and changes team knowledge only after its report arrives',()=>{
    const bundle=mechanicsFixture();bundle.assets.events=[needEvent('H1','relocation',60*M)];
    let world=initializeWorld(bundle,'future-situation');
    expect(householdSituationV2(world,'H1')!.needs).toEqual([]);
    world=advanceWorld(world,60*M);
    expect(householdSituationV2(world,'H1')!.needs[0].knownToTeams).toBe(false);
    world=advanceWorld(world,80*M);
    expect(householdSituationV2(world,'H1')!.needs[0].knownToTeams).toBe(true);
  });
  it('returns no selected situation for an unknown home',()=>{
    expect(householdSituationV2(initializeWorld(mechanicsFixture(),'unknown-situation'),'not-in-run')).toBeNull();
  });
});
