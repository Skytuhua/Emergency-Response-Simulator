// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { SourceDetailsV2 } from '../../src/ui/v2/SourceDetailsV2';
import { observeSnapshot } from '../../src/v2/observe';
import { initializeWorld } from '../../src/v2/world';
import { MINUTE_MS as M, type PreparedActionV2, type TraceEventV2 } from '../../src/v2/contracts';

afterEach(cleanup);
const action:PreparedActionV2={id:'action:test',householdId:'H1',opportunityId:'op:test',atMs:20*M,contextHash:'a'.repeat(64),action:'report',text:'{"kind":"help_request_v2","contextHash":"original-test-value"}',sourceResponseHash:'b'.repeat(64),sourceActionId:'original:test',origin:'llm-direct',model:'gpt-6.1-terra',reasoningEffort:'low'};
function snapshot() {
  const value=observeSnapshot(initializeWorld(mechanicsFixture(),'source-details-test'));
  value.preparedActions=[action];
  value.personas=[{householdId:'H1',persona:'Authored test profile, not provider evidence.',age:43,profession:'Test profession',origin:'llm-direct',model:'gpt-6.1-terra',reasoningEffort:'low',sourceResponseHash:'c'.repeat(64)}];
  return value;
}
function event(type:string,source:TraceEventV2['source']='llm-direct'):TraceEventV2 {
  return {id:type,atMs:20*M,type,householdId:'H1',source,visibility:type==='report-received'?'coordinator':'resident',message:action.text,evidenceIds:[action.opportunityId,action.id]};
}

describe('plain-language source details preserve original evidence',()=>{
  it('separates the future plan from events and hides raw JSON/hashes in a closed evidence disclosure',()=>{
    const value=snapshot(),before=JSON.stringify(value);
    render(<SourceDetailsV2 snapshot={value} householdId="H1"/>);
    expect(screen.getByText('Planned call at 00:20')).toBeTruthy();
    expect(screen.getByText('Planned for later')).toBeTruthy();
    expect(screen.queryByText('Call received')).toBeNull();
    expect(screen.queryByText(action.text)).toBeNull();
    const details=screen.getByText('Technical evidence').closest('details');
    expect(details?.open).toBe(false);
    expect(within(details!).getByText('Technical evidence')).toBeTruthy();
    expect(screen.getByText('c'.repeat(64)).closest('details')).toBe(details);
    expect(screen.getByText(value.personas[0].persona).closest('details')?.open).toBe(false);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('distinguishes a blocked direct call from a later receipt without treating JSON as speech',()=>{
    const value=snapshot();value.nowMs=20*M;value.observedEvents=[event('resident-action'),event('report-failed')];
    const result=render(<SourceDetailsV2 snapshot={value} householdId="H1"/>);
    expect(screen.getAllByText('Call blocked').length).toBeGreaterThan(0);
    expect(screen.queryByText('Call received')).toBeNull();
    value.observedEvents.push(event('report-received'));result.rerender(<SourceDetailsV2 snapshot={value} householdId="H1"/>);
    expect(screen.getAllByText('Call received').length).toBeGreaterThan(0);
    expect(screen.queryByText(action.text)).toBeNull();
  });
  it('explains that road changes disable stored actions',()=>{
    const value=snapshot();value.preparedActions=[];value.personas=[];
    render(<SourceDetailsV2 snapshot={value} householdId="H1" roadChangesDisableActions />);
    expect(screen.getByText('Prepared actions are not used with these road changes.')).toBeTruthy();
    expect(screen.queryByText('No AI actions were planned for this home.')).toBeNull();
  });
  it('does not count a rule-based attempt as execution of the stored AI action',()=>{
    const value=snapshot();value.nowMs=20*M;value.observedEvents=[event('resident-action','behavior-model'),event('report-failed','behavior-model')];
    render(<SourceDetailsV2 snapshot={value} householdId="H1"/>);
    expect(screen.getByText('Not recorded as carried out')).toBeTruthy();
    expect(screen.queryByText('Attempt recorded; no call received')).toBeNull();
  });
});
