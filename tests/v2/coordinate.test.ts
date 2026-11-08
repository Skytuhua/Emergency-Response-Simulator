import { describe,expect,it } from 'vitest';
import { mechanicsFixture,needEvent } from '../../fixtures/v2/mechanics/fixture';
import { initializeSessionV2,advanceSessionV2 } from '../../src/v2/coordinate';
import { MINUTE_MS as M } from '../../src/v2/contracts';

describe('automatic v2 sessions',()=>{
  it('records one public decision per accepted command and coordinates fractional boundaries',()=>{
    const b=mechanicsFixture();b.assets.map.edges.find(e=>e.id==='BH')!.durationMs=2*M+1;
    b.assets.events=[needEvent('H1','delivery')];
    let session=initializeSessionV2(b,'urgency-first-v2','fractional');
    expect(session.world.commands.length).toBe(4);
    session=advanceSessionV2(session,13*M);
    expect(session.world.commands.some(c=>c.command.atMs===12*M+1&&c.command.action==='deliver')).toBe(true);
    expect(session.decisions).toHaveLength(session.world.commands.length);
    expect(session.decisions.every(d=>/^[a-f0-9]{64}$/.test(d.observationHash))).toBe(true);
  });
});
