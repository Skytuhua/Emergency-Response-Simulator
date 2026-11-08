import { describe, expect, it } from 'vitest';
import { mechanicsFixture, needEvent, changeEvent } from '../../fixtures/v2/mechanics/fixture';
import { advanceWorld, initializeWorld } from '../../src/v2/world';
import { observeCoordinator } from '../../src/v2/observe';
import { chooseCommandV2 } from '../../src/v2/policies';
import { MINUTE_MS as M } from '../../src/v2/contracts';

describe('public automatic policy comparison', () => {
  it('distinguishes received order, urgency, and reserved coverage', () => {
    const bundle=mechanicsFixture();
    const first=needEvent('H1','delivery',0,'first'); if(first.payload.type==='need-onset')first.payload.need.urgent=false;
    bundle.assets.events=[first,needEvent('H6','relocation',M,'urgent')];
    const view=observeCoordinator(advanceWorld(initializeWorld(bundle,'policy'),21*M));
    expect(chooseCommandV2(view,'received-order-v2',bundle.resources)?.intent.needId).toBe('first');
    expect(chooseCommandV2(view,'urgency-first-v2',bundle.resources)?.intent.needId).toBe('urgent');
    view.households.find(home=>home.id==='UNREACHED')!.communicationsAvailable=false;
    const covered=chooseCommandV2(view,'urgency-plus-coverage-v2',bundle.resources);
    expect(covered?.intent).toMatchObject({action:'check',unitId:'C1'});
    expect(covered?.rule).toMatch(/coverage/i);
  });
  it('uses only public knowledge and respects whole-household accessibility', () => {
    const bundle=mechanicsFixture();bundle.assets.events=[needEvent('H7','relocation')];
    const view=observeCoordinator(advanceWorld(initializeWorld(bundle,'public'),20*M));
    expect(chooseCommandV2(view,'urgency-first-v2',bundle.resources)?.intent.action).toBe('check');
    const reordered=structuredClone(view);reordered.households.reverse();reordered.units.reverse();reordered.facilities.reverse();
    expect(chooseCommandV2(reordered,'urgency-first-v2',bundle.resources)).toEqual(chooseCommandV2(view,'urgency-first-v2',bundle.resources));
  });
  it('does not let a publicly closed depot block feasible transport or checks',()=>{
    const b=mechanicsFixture();b.assets.events=[needEvent('H1','delivery'),needEvent('H6','relocation'),changeEvent('base-closed',0,{type:'facility-state-change',facilityId:'BASE',open:false},0)];
    const view=observeCoordinator(advanceWorld(initializeWorld(b,'depot'),20*M));
    expect(chooseCommandV2(view,'urgency-first-v2',b.resources)?.intent).toMatchObject({action:'transport',householdId:'H6'});
  });
});
