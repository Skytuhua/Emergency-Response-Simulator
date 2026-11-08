import { describe, expect, it } from 'vitest';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { observeCoordinator } from '../../src/v2/observe';
import { advanceWorld, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { vehicleMotionPositionV2, vehicleMotionV2 } from '../../src/ui/v2/vehicle-motion';

function observations(viaTurn=false){
  const bundle=mechanicsFixture();
  if(viaTurn){const edge=bundle.assets.map.edges.find(item=>item.id==='BH')!;edge.durationMs=240000;edge.minutes=4;}
  const dispatched=dispatchWorld(initializeWorld(bundle,'motion'),{id:'check',sequence:1,atMs:0,action:'check',unitId:'C1',householdId:'H1'});
  if(!dispatched.result.accepted)throw new Error('Fixture dispatch failed');
  return [observeCoordinator(advanceWorld(dispatched.state,30000)),observeCoordinator(advanceWorld(dispatched.state,90000))] as const;
}
describe('observed vehicle movement',()=>{
  it('interpolates between observed positions and follows an actual turn',()=>{
    const [before,after]=observations(true),motion=vehicleMotionV2(before,after,'C1');
    expect(motion?.segments.map(item=>item.leg.edgeId)).toEqual(['BX','XH']);
    expect(vehicleMotionPositionV2(after.map,motion!,0)).toMatchObject({x:0,y:10});
    expect(vehicleMotionPositionV2(after.map,motion!,.5)).toMatchObject({x:0,y:20});
    expect(vehicleMotionPositionV2(after.map,motion!,1)).toMatchObject({x:5,y:15});
  });
  it('does not animate across a reroute, time skip, arrival or assignment change',()=>{
    const [before,after]=observations();expect(vehicleMotionV2(before,after,'C1')).not.toBeNull();
    const changed=structuredClone(after);changed.missions[0].route.legs[0].edgeId='other';expect(vehicleMotionV2(before,changed,'C1')).toBeNull();
    const skipped=structuredClone(after);skipped.nowMs+=60000;expect(vehicleMotionV2(before,skipped,'C1')).toBeNull();
    const arrived=structuredClone(after);arrived.missions[0].status='checking';expect(vehicleMotionV2(before,arrived,'C1')).toBeNull();
    const reassigned=structuredClone(after);reassigned.units[0].missionId=null;expect(vehicleMotionV2(before,reassigned,'C1')).toBeNull();
  });
});
