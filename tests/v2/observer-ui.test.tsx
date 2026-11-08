// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { changeEvent, mechanicsFixture, needEvent } from '../../fixtures/v2/mechanics/fixture';
import { observeSnapshot } from '../../src/v2/observe';
import { advanceWorld, dispatchWorld, initializeWorld } from '../../src/v2/world';
import { MINUTE_MS as M, type ObserverSnapshotV2, type PersonaV2, type PreparedActionV2 } from '../../src/v2/contracts';
import { EvidenceDetailsV2, ObserverV2, directPersonasV2, householdEventsV2 } from '../../src/ui/v2/ObserverV2';
import { ResultsV2 } from '../../src/ui/v2/ResultsV2';
import { MapV2 } from '../../src/ui/v2/MapV2';
import { adaptMapV2 } from '../../src/ui/v2/map-adapter';
import { createHomeLabelsV2, homeLabelV2 } from '../../src/ui/v2/home-labels';
import type { HouseholdSituationV2 } from '../../src/ui/v2/household-situation';
import { householdSituationV2 } from '../../src/ui/v2/household-situation';

// Leaflet needs real layout; adapter is exercised directly and root owns browser map verification.
vi.mock('../../src/ui/TownMap', () => ({ TownMap: ({view,onSelect,householdTitles}:{view:{households:{id:string;name:string}[]};onSelect?:(id:string)=>void;householdTitles?:Record<string,string>}) => <div aria-label="Retained interactive map">{view.households.map(home=><button type="button" key={home.id} aria-label={householdTitles?.[home.id]} onClick={()=>onSelect?.(home.id)}>{home.name}</button>)}</div> }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(()=>{cleanup();document.querySelectorAll('[data-test-header]').forEach(element=>element.remove());});
const persona: PersonaV2 = { householdId: 'H1', persona: 'Authored test persona text, not provider evidence.', age: 43, profession: 'Test profession', origin: 'llm-direct', model: 'gpt-6.1-terra', reasoningEffort: 'low', sourceResponseHash: 'a'.repeat(64) };
const action: PreparedActionV2 = { id: 'prepared:test', householdId: 'H1', opportunityId: 'opportunity:test', atMs: 20*M, contextHash: 'b'.repeat(64), action: 'report', text: 'Authored test request.', sourceResponseHash: 'c'.repeat(64), sourceActionId: 'source:test', origin: 'llm-direct', model: 'gpt-6.1-terra', reasoningEffort: 'low' };
function snapshot(): ObserverSnapshotV2 { const value=observeSnapshot(initializeWorld(mechanicsFixture(), 'observer-test'));delete value.observedEvents;return value; }
function show(value = snapshot(), selected: string | null = 'H1', controlsTarget:HTMLElement|null=null, situation?:HouseholdSituationV2) {
  const callbacks = { onSelect: vi.fn(), onToggle: vi.fn(), onSpeed: vi.fn(), onStep: vi.fn(), onPause: vi.fn(), onExport: vi.fn(), onImport: vi.fn(), onRestart: vi.fn(), onNew: vi.fn(), onFinish: vi.fn() };
  render(<ObserverV2 snapshot={value} policy="urgency-plus-coverage-v2" playing={false} speed={1} selected={selected} controlsTarget={controlsTarget} situation={situation} {...callbacks} />);
  return callbacks;
}
function selectedDetails(name='Home 0001') { return screen.getByRole('region',{name:`${name} selected home details`}); }
function authoredSituation(householdId='H1'):HouseholdSituationV2 {
  return {householdId,residentCount:2,communicationsAvailable:true,accessiblePlacesRequired:0,needs:[{id:`N-${householdId}`,kind:'delivery',urgent:true,onsetMs:0,deadlineMs:90*M,completedAtMs:null,knownToTeams:false,cause:null}]};
}
function sourceDialog() {
  fireEvent.click(screen.getByRole('button',{name:'Inspect Home 0001 source'}));
  return screen.getByRole('dialog',{name:'Home 0001 source and timeline'});
}

describe('v2 observer evidence and selection', () => {
  it('shows household needs, requests and response without the superseded story or AI badges',()=>{
    const value=snapshot();value.personas=[persona];value.preparedActions=[action];
    show(value,'H1',null,authoredSituation());
    const selected=screen.getByRole('region',{name:'Selected home'});
    expect(within(selected).getByRole('region',{name:'Needs'})).toBeTruthy();
    expect(within(selected).getByRole('region',{name:'Request'})).toBeTruthy();
    expect(within(selected).getByRole('region',{name:'Response'})).toBeTruthy();
    expect(selected.textContent).not.toMatch(/AI-created|AI plan used|A home's story|Resident plan|Did the call get through|Help status/);
    expect(screen.getByRole('heading',{name:'Response overview'})).toBeTruthy();
    expect(screen.queryByRole('region',{name:'Selected home status'})).toBeNull();
    expect(document.querySelector('.v2-map-heading')).toBeNull();
  });
  it('shows accessible transport places only when teams know they are needed',()=>{
    const value=snapshot();value.coordinator.households[0].known={observedAtMs:0,receivedAtMs:0,size:2,accessiblePlacesRequired:1,source:'report',eventIds:[],text:'',needs:[]};
    show(value);expect(within(selectedDetails()).getByText('Accessible places needed: 1')).toBeTruthy();
  });
  it('counts distinct active teams and keeps each number beside its precise metric label',()=>{
    const state=dispatchWorld(initializeWorld(mechanicsFixture(),'overview-count'),{id:'check',sequence:1,atMs:0,action:'check',unitId:'C1',householdId:'H1'}).state;
    const value=observeSnapshot(state);value.coordinator.missions.push({...value.coordinator.missions[0],id:'historical-second-mission'});
    show(value);
    const overview=screen.getByRole('region',{name:'Response overview'});
    const active=within(overview).getByText('teams responding').parentElement!;
    expect(active.querySelector('strong')?.textContent).toBe('1');
    expect(active.querySelector('span')?.textContent).toBe('teams responding');
    const helped=within(overview).getByText('people in homes that received some help').parentElement!;
    expect(helped.querySelector('strong')?.textContent).toBe('0');
    expect(helped.title).toContain('at least one completed need');
    expect(within(overview).getByText('Coverage details').closest('details')!.open).toBe(false);
    expect(within(overview).getByText('Recent updates').closest('details')!.open).toBe(false);
  });
  it('portals controls into the shared header and returns drawer focus there without resuming',async()=>{
    const header=document.createElement('div');header.setAttribute('data-test-header','true');document.body.append(header);
    const callbacks=show(snapshot(),'H1',header);
    expect(within(header).getByRole('combobox',{name:'Playback speed'})).toBeTruthy();
    const observer=screen.getByRole('region',{name:'Automatic six-hour simulation observation'});
    expect(within(observer).queryByText('Observe simulation')).toBeNull();
    expect(within(observer).getByRole('heading',{name:'Dallas response simulation'}).classList.contains('sr-only')).toBe(true);
    const trigger=within(header).getByRole('button',{name:'Find a home'});trigger.focus();await userEvent.keyboard('{Enter}');
    const dialog=screen.getByRole('dialog',{name:'All simulated homes'});fireEvent(dialog,new Event('cancel',{cancelable:true}));
    expect(document.activeElement).toBe(trigger);expect(callbacks.onPause).toHaveBeenCalledTimes(1);expect(callbacks.onToggle).not.toHaveBeenCalled();
  });
  it('uses complete-run home labels in search and retains the exact internal selection ID',()=>{
    const value=snapshot(),first=value.coordinator.households[0];
    value.coordinator.households=[{...first,id:'HH-TRACT-A-0001'},{...first,id:'HH-TRACT-B-0001'}];value.population.households=2;
    const callbacks=show(value,'HH-TRACT-B-0001');
    fireEvent.click(screen.getByRole('button',{name:'Find a home'}));
    const dialog=screen.getByRole('dialog',{name:'All simulated homes'});
    fireEvent.change(within(dialog).getByRole('searchbox',{name:'Search homes'}),{target:{value:'0002'}});
    const choose=within(dialog).getByRole('button',{name:/Inspect Home 0002/});
    expect(choose.textContent).not.toContain('TRACT');fireEvent.click(choose);expect(callbacks.onSelect).toHaveBeenCalledWith('HH-TRACT-B-0001');
  });
  it('keeps partial assistance distinct from all needs completed',()=>{
    const value=snapshot(),home=value.coordinator.households.find(item=>item.id==='H1')!;
    home.known={size:2,accessiblePlacesRequired:0,source:'check',eventIds:[],observedAtMs:0,receivedAtMs:0,text:'Authored known facts',needs:[
      {id:'first',householdId:'H1',kind:'delivery',urgent:false,onsetMs:0,deadlineMs:90*M,completedAtMs:10*M},
      {id:'second',householdId:'H1',kind:'relocation',urgent:true,onsetMs:0,deadlineMs:100*M,completedAtMs:null},
    ]};
    show(value);const selected=selectedDetails();
    expect(within(selected).getByText('Some help completed')).toBeTruthy();
    expect(within(selected).getByText('1 need still waiting')).toBeTruthy();
    expect(within(selected).queryByText('Help completed')).toBeNull();
    expect(within(selected).getByRole('region',{name:'Response'}).getAttribute('data-help-state')).toBe('partial');
  });
  it('does not attach a previous needs call to a new need unknown to teams',()=>{
    const value=snapshot();value.nowMs=30*M;
    const situation=authoredSituation();
    situation.needs=[
      {...situation.needs[0],id:'old',completedAtMs:10*M,knownToTeams:true},
      {...situation.needs[0],id:'new',kind:'relocation',onsetMs:25*M},
    ];
    value.coordinator.events=[{id:'old-receipt',atMs:5*M,type:'report-received',householdId:'H1',needId:'old',message:'Earlier report',visibility:'coordinator',source:'behavior-model',evidenceIds:[]}];
    show(value,'H1',null,situation);const selected=selectedDetails();
    expect(within(selected).getByText('Not yet known to response teams')).toBeTruthy();
    expect(within(selected).getByText('No call recorded yet')).toBeTruthy();
    expect(within(selected).getByText('Some help completed')).toBeTruthy();
    expect(within(selected).queryByText(/Call received/)).toBeNull();
  });
  it('shows a hidden need to the observer without adding it to the teams public waiting count',()=>{
    const fixture=mechanicsFixture();fixture.assets.events=[needEvent('H1','delivery')];
    const world=initializeWorld(fixture,'observer-hidden-need'),value=observeSnapshot(world);
    const before=JSON.stringify(value.coordinator);
    show(value,'H1',null,householdSituationV2(world,'H1')!);
    const selected=selectedDetails(),overview=screen.getByRole('region',{name:'Response overview'});
    expect(within(selected).getByText('Needs supplies')).toBeTruthy();
    expect(within(selected).getByText('Not yet known to response teams')).toBeTruthy();
    expect(within(selected).getByText('Specific cause not recorded')).toBeTruthy();
    expect(within(overview).getByText('homes waiting for help').parentElement?.querySelector('strong')?.textContent).toBe('0');
    expect(JSON.stringify(observeSnapshot(world).coordinator)).toBe(before);
  });
  it.each(['blocked','stranded'] as const)('does not say transport never arrived when passengers boarded a %s van',status=>{
    const fixture=mechanicsFixture();fixture.assets.events=[needEvent('H6','relocation'),status==='blocked'
      ? changeEvent('close',44*M,{type:'facility-state-change',facilityId:'SHELTER',open:false},44*M)
      : changeEvent('unsafe',33*M,{type:'edge-state-change',edgeIds:['HS'],closed:true})];
    let world=advanceWorld(initializeWorld(fixture,'transport'),20*M);
    world=dispatchWorld(world,{id:'six',sequence:1,atMs:20*M,action:'transport',unitId:'V1',householdId:'H6',needId:'N-H6',shelterId:'SHELTER'}).state;
    world=advanceWorld(world,60*M);
    expect(observeSnapshot(world).coordinator.units.find(unit=>unit.id==='V1')).toMatchObject({passengers:6,status});
    show(observeSnapshot(world),'H6',null,householdSituationV2(world,'H6')!);
    const selected=screen.getByRole('region',{name:'Selected home'});
    expect(within(selected).getByText('Shelter trip not completed')).toBeTruthy();
    expect(within(selected).queryByText('No transport arrived yet')).toBeNull();
    expect(within(selected).queryByText('Help completed')).toBeNull();
    const stopped=screen.getByRole('region',{name:'Teams stopped'});
    expect(within(stopped).getByText(status==='stranded'?'The road became unsafe.':'The destination shelter is closed.')).toBeTruthy();
    expect(within(stopped).getByText('6 people on board')).toBeTruthy();
    expect(stopped.textContent).not.toMatch(/0 supply|0 passengers/);
  });
  it('shows a single supply bundle without zero passenger counts or invented reasons',()=>{
    const value=snapshot(),unit=value.coordinator.units[0];unit.status='blocked';unit.passengers=0;unit.carriedBundles=1;
    show(value);
    const stopped=screen.getByRole('region',{name:'Teams stopped'});
    expect(within(stopped).getByText('Team C1 · Stopped')).toBeTruthy();
    expect(within(stopped).getByText('1 supply bundle on board')).toBeTruthy();
    expect(within(stopped).getByText('Reason not available.')).toBeTruthy();
    expect(stopped.textContent).not.toContain('0');
  });
  it('never relabels an authored persona as direct AI evidence and keeps provenance out of the primary panel',()=>{
    const value=snapshot();value.personas=[{...persona,origin:'authored'} as unknown as PersonaV2];show(value);
    expect(directPersonasV2(value)).toEqual([]);
    const selected=screen.getByRole('region',{name:'Selected home'});
    expect(selected.textContent).not.toMatch(/AI-created|prepared personas|other homes|Test profession/);
    expect(within(sourceDialog()).getByText('Simulated household. This home follows simulation rules.')).toBeTruthy();
    expect(screen.queryByText(persona.persona)).toBeNull();
  });
  it('shows an actual failed call and its network cause without claiming receipt or completed help',()=>{
    const value=snapshot();value.nowMs=20*M;value.personas=[persona];value.preparedActions=[action];
    value.residentEvents=[
      {id:'attempt',atMs:20*M,type:'resident-action',householdId:'H1',needId:'N-H1',message:action.text,visibility:'resident',source:'llm-direct',evidenceIds:[action.id,action.opportunityId]},
      {id:'failed',atMs:20*M,type:'report-failed',householdId:'H1',needId:'N-H1',message:'Failed',visibility:'resident',source:'llm-direct',evidenceIds:[action.opportunityId]},
    ];
    show(value,'H1',null,authoredSituation());const selected=selectedDetails();
    expect(within(selected).getByText('Call failed just now.')).toBeTruthy();
    expect(within(selected).getByText('Phone network was down.')).toBeTruthy();
    expect(within(selected).getByText('Not yet known to response teams')).toBeTruthy();
    expect(within(selected).getByText('No supplies delivered yet')).toBeTruthy();
    expect(within(selected).queryByText(/Call received|Help completed/)).toBeNull();
  });
  it('does not infer an attempted call or help need from a retained biography and past plan',()=>{
    const value=snapshot();value.nowMs=30*M;value.personas=[persona];value.preparedActions=[action];show(value);
    const selected=selectedDetails();expect(within(selected).getByText('No call recorded yet')).toBeTruthy();
    expect(within(selected).getByText('Situation not available')).toBeTruthy();
    expect(selected.textContent).not.toMatch(/Call received|Call failed|No current need in this simulation|AI plan used/);
    expect(within(sourceDialog()).getByText('Not recorded as carried out')).toBeTruthy();
  });
  it('keeps public receipt display separate from exact action attribution in optional evidence',()=>{
    const value=snapshot();value.nowMs=30*M;value.personas=[persona];value.preparedActions=[action];
    value.coordinator.events=[{id:'receipt',atMs:20*M,type:'report-received',householdId:'H1',message:action.text,visibility:'coordinator',source:'llm-direct',evidenceIds:['different-action']}];
    const props={snapshot:value,policy:'urgency-plus-coverage-v2' as const,playing:false,speed:1,selected:'H1',onSelect:vi.fn(),onToggle:vi.fn(),onSpeed:vi.fn(),onPause:vi.fn(),onExport:vi.fn(),onImport:vi.fn(),onRestart:vi.fn(),onNew:vi.fn(),onFinish:vi.fn()};
    const result=render(<ObserverV2 {...props}/>);
    expect(within(selectedDetails()).getByText('Call received 10 min ago.')).toBeTruthy();
    const dialog=sourceDialog(),planned=within(dialog).getByText('Planned call at 00:20').closest('section')!;
    expect(within(planned).getByText('Not recorded as carried out')).toBeTruthy();
    value.coordinator.events[0].evidenceIds=[action.id];result.rerender(<ObserverV2 {...props} snapshot={{...value}}/>);
    expect(within(planned).getByText('Call received')).toBeTruthy();
  });
  it('keeps a selected background home separate from another home\'s prepared profile and actions',()=>{
    const value=snapshot();value.personas=[persona];value.preparedActions=[action];show(value,'H7');
    const selected=selectedDetails('Home 0003');expect(selected.textContent).not.toMatch(/Test profession|Authored test request|AI-created/);
    fireEvent.click(within(selected).getByRole('button',{name:'Inspect Home 0003 source'}));
    expect(within(screen.getByRole('dialog')).getByText('No AI actions were planned for this home.')).toBeTruthy();
    expect(screen.queryByText(persona.persona)).toBeNull();
  });
  it('keeps structured source JSON and hashes out of household facts while retaining them in a closed source disclosure',()=>{
    const value=snapshot();value.personas=[persona];const raw=JSON.stringify({contextHash:'b'.repeat(64),householdId:'H1',needId:'need:test'});value.preparedActions=[{...action,text:raw}];
    show(value,'H1',null,authoredSituation());const selected=selectedDetails();
    expect(within(selected).getByText('No call recorded yet')).toBeTruthy();
    expect(selected.textContent).not.toContain('contextHash');expect(selected.textContent).not.toContain('b'.repeat(64));expect(selected.textContent).not.toContain(persona.persona);
    const dialog=sourceDialog();expect(within(dialog).queryByText(raw)).toBeNull();
    expect(within(dialog).getByText('Planned call at 00:20')).toBeTruthy();
    expect(within(dialog).getByText(persona.persona).closest('details')?.open).toBe(false);
  });
  it('retains a planned wait in optional evidence without presenting it as an attempted or received call',()=>{
    const value=snapshot();value.personas=[persona];value.preparedActions=[{...action,action:'wait',text:'Unabridged wait source.'}];show(value,'H1',null,authoredSituation());
    const selected=selectedDetails();expect(within(selected).getByText('No call recorded yet')).toBeTruthy();expect(selected.textContent).not.toMatch(/Call planned|Call received|Call failed/);
    const dialog=sourceDialog();expect(within(dialog).getByText('Planned wait at 00:20')).toBeTruthy();expect(within(dialog).queryByText('Unabridged wait source.')).toBeNull();
  });
  it('uses a complete-run home label while retaining the original identity only in technical evidence',()=>{
    const value=snapshot(),id='HH-48113002200-01474';value.coordinator.households[0].id=id;value.personas=[{...persona,householdId:id}];const callbacks=show(value,id);
    const label=homeLabelV2(createHomeLabelsV2(value.coordinator.households),id),selected=selectedDetails(label);
    expect(within(selected).getByRole('heading',{name:label}).textContent).toBe(label);
    fireEvent.click(within(selected).getByRole('button',{name:`Inspect ${label} source`}));
    const original=within(screen.getByRole('dialog')).getByText(id);expect(original.closest('details')?.open).toBe(false);expect(callbacks.onPause).toHaveBeenCalled();
  });
  it('moves finish into run options and removes the bottom observer footer',()=>{
    const callbacks=show();expect(screen.queryByText('Only received reports, checks and known road closures guide the response.')).toBeNull();
    expect(screen.queryByRole('button',{name:'Skip to the end'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Run options'}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Run options'})).getByRole('button',{name:'Skip to the end'}));expect(callbacks.onFinish).toHaveBeenCalledTimes(1);
  });
  it('keeps unknown information explicit without primary AI badges or declaring a home safe',()=>{
    const value=snapshot();value.personas=[persona];show(value);const selected=screen.getByRole('region',{name:'Selected home'});
    expect(screen.getByLabelText('Choose a home')).toBeTruthy();expect(screen.getByText('Urgent needs and home checks')).toBeTruthy();expect(screen.getByText('Time elapsed')).toBeTruthy();
    expect(within(selected).getByText('Situation not available')).toBeTruthy();expect(selected.textContent).not.toMatch(/AI-created|AI plan used|safe home|No current need in this simulation/);
  });
  it('counts waiting homes as homes and presents optional activity without engine narration or JSON speech',()=>{
    const value=snapshot();value.coordinator.households[0].known={observedAtMs:0,receivedAtMs:0,size:2,accessiblePlacesRequired:0,source:'report',eventIds:[],text:'',needs:[{id:'need',householdId:'H1',kind:'delivery',urgent:true,onsetMs:0,deadlineMs:90*M,completedAtMs:null}]};
    const raw='{"contextHash":"'+'b'.repeat(64)+'"}';value.coordinator.events=[{id:'route',atMs:0,type:'mission-rerouted',unitId:'C1',message:'Replanned from the actual safe node with the arrival arc preserved.',visibility:'coordinator',source:'world-rule'},
      {id:'call',atMs:0,type:'report-received',householdId:'H1',message:raw,visibility:'coordinator',source:'llm-direct'}];
    const before=JSON.stringify(value);show(value);const overview=screen.getByRole('region',{name:'Response overview'});
    expect(within(overview).getByText('homes waiting for help').parentElement?.querySelector('strong')?.textContent).toBe('1');
    const queue=within(overview).getByRole('region',{name:'Homes waiting for help'});expect(within(queue).getByText('Urgent Supplies')).toBeTruthy();
    const latest=within(overview).getByRole('region',{name:'Latest activity',hidden:true});expect(latest.textContent).toContain('changed route from its last safe location');
    expect(latest.textContent).not.toContain('arrival arc');expect(latest.textContent).not.toContain('contextHash');expect(latest.textContent).not.toContain('b'.repeat(64));expect(JSON.stringify(value)).toBe(before);
  });
  it('never counts a completed home check as delivered assistance',()=>{
    let state=dispatchWorld(initializeWorld(mechanicsFixture(),'check-test'),{id:'check',sequence:1,atMs:0,action:'check',unitId:'C1',householdId:'H1'}).state;
    state=advanceWorld(state,12*M);show(observeSnapshot(state),'H1',null,householdSituationV2(state,'H1')!);
    expect(within(selectedDetails()).getByText('No current need in this simulation')).toBeTruthy();expect(within(selectedDetails()).queryByText('Help completed')).toBeNull();
    expect(screen.getByText('people in homes that received some help').parentElement?.querySelector('strong')?.textContent).toBe('0');
  });
  it('keeps a received rule-based report separate from a retained direct plan in source attribution',()=>{
    const value=snapshot();value.nowMs=30*M;value.personas=[persona];value.preparedActions=[action];
    value.residentEvents=[{id:'fallback',atMs:20*M,type:'resident-action',householdId:'H1',message:'',visibility:'resident',source:'behavior-model',evidenceIds:[action.opportunityId]}];
    value.coordinator.events=[{id:'fallback-receipt',atMs:20*M,type:'report-received',householdId:'H1',message:'Rule-based receipt',visibility:'coordinator',source:'behavior-model',evidenceIds:[action.opportunityId]}];
    show(value);expect(within(selectedDetails()).getByText('Call received 10 min ago.')).toBeTruthy();expect(selectedDetails().textContent).not.toContain('AI plan used');
    const planned=within(sourceDialog()).getByText('Planned call at 00:20').closest('section')!;expect(within(planned).getByText('Not recorded as carried out')).toBeTruthy();
  });
  it('advances from an earlier failed attempt to the later recorded receipt',()=>{
    const value=snapshot();value.nowMs=50*M;value.personas=[persona];value.preparedActions=[action];value.residentEvents=[
      {id:'resident:9',atMs:20*M,type:'resident-action',householdId:'H1',message:action.text,visibility:'resident',source:'llm-direct',evidenceIds:[action.opportunityId,action.id]},
      {id:'resident:10',atMs:20*M,type:'report-failed',householdId:'H1',message:'Blocked earlier',visibility:'resident',source:'llm-direct',evidenceIds:[action.opportunityId]},
      {id:'resident:11',atMs:50*M,type:'resident-action',householdId:'H1',message:'',visibility:'resident',source:'behavior-model',evidenceIds:['retry:50']},
    ];value.coordinator.events=[{id:'coordinator:9',atMs:50*M,type:'report-received',householdId:'H1',message:'Later fallback received',visibility:'coordinator',source:'behavior-model',evidenceIds:['retry:50']}];
    show(value);const selected=selectedDetails();expect(within(selected).getByText('Call received just now.')).toBeTruthy();expect(selected.textContent).not.toMatch(/Call failed|Phone network was down/);
  });
  it('shows a later suppressed request without converting the earlier failure or suppression into completed assistance',()=>{
    const value=snapshot();value.nowMs=50*M;value.personas=[persona];value.preparedActions=[action];value.residentEvents=[
      {id:'resident:9',atMs:20*M,type:'report-failed',householdId:'H1',message:'Earlier blocked',visibility:'resident',source:'llm-direct',evidenceIds:[action.opportunityId]},
      {id:'resident:10',atMs:50*M,type:'resident-action-suppressed',householdId:'H1',message:'',visibility:'resident',source:'behavior-model',evidenceIds:['retry:50','need']},
    ];show(value);const selected=selectedDetails();expect(within(selected).getByText('No new request after help.')).toBeTruthy();expect(selected.textContent).not.toMatch(/Call failed|Help completed/);
  });
  it('uses the admitted interleaved trace order and excludes debrief records',()=>{
    const value=snapshot();value.nowMs=20*M;
    const attempt={id:'resident:9',atMs:20*M,type:'resident-action',householdId:'H1',message:'Attempt',visibility:'resident' as const,source:'llm-direct' as const,evidenceIds:['opportunity']};
    const receipt={id:'coordinator:9',atMs:20*M,type:'report-received',householdId:'H1',message:'Receipt',visibility:'coordinator' as const,source:'llm-direct' as const,evidenceIds:['opportunity']};
    const dispatch={...receipt,id:'coordinator:10',type:'mission-dispatched',message:'Assigned'};
    value.residentEvents=[attempt];value.coordinator.events=[receipt,dispatch];
    value.observedEvents=[attempt,receipt,dispatch,{...receipt,id:'private',visibility:'debrief'}];
    expect(householdEventsV2(value,'H1').map(event=>event.id)).toEqual(['resident:9','coordinator:9','coordinator:10']);
  });
  it('preserves authored lane order and merges attempt before receipt without lexical ID ordering',()=>{
    const value=snapshot();value.nowMs=20*M;
    value.residentEvents=[{id:'resident:9',atMs:20*M,type:'resident-action',householdId:'H1',message:'Attempt',visibility:'resident',source:'llm-direct',evidenceIds:['opportunity']},
      {id:'resident:10',atMs:20*M,type:'report-failed',householdId:'H1',message:'Failure',visibility:'resident',source:'llm-direct',evidenceIds:['other']}];
    value.coordinator.events=[{id:'coordinator:9',atMs:20*M,type:'report-received',householdId:'H1',message:'Receipt',visibility:'coordinator',source:'llm-direct',evidenceIds:['opportunity']},
      {id:'coordinator:10',atMs:20*M,type:'mission-dispatched',householdId:'H1',message:'Assigned',visibility:'coordinator',source:'automatic-policy',evidenceIds:['command']}];
    expect(householdEventsV2(value,'H1').map(event=>event.id)).toEqual(['resident:9','resident:10','coordinator:9','coordinator:10']);
  });
  it('links the actual public policy rule and observation hash to the recorded command',()=>{
    const value=snapshot();value.coordinator.events=[{id:'dispatch',atMs:0,type:'mission-dispatched',householdId:'H1',missionId:'mission:auto',message:'Accepted check assignment.',visibility:'coordinator',source:'automatic-policy',evidenceIds:['auto']}];
    value.coordinator.missions=[{id:'mission:auto',unitId:'C1',householdId:'H1',needId:null,action:'check',status:'checking',dispatchedAtMs:0,estimatedCompletionAtMs:12*M,completedAtMs:null,route:{legs:[],durationMs:0,terminalIncoming:null},routeLegIndex:0,stageRemainingMs:M,reason:null}];
    const callbacks={onSelect:vi.fn(),onToggle:vi.fn(),onSpeed:vi.fn(),onPause:vi.fn(),onExport:vi.fn(),onImport:vi.fn(),onRestart:vi.fn(),onNew:vi.fn(),onFinish:vi.fn()};
    const bundle=mechanicsFixture();
    render(<ObserverV2 snapshot={value} policy="urgency-plus-coverage-v2" playing={false} speed={1} selected="H1" {...callbacks} evidence={{assumptions:[],sources:[],geography:bundle.assets.geography,fit:bundle.assets.population.fit,decisions:[{commandId:'auto',atMs:0,policy:'urgency-plus-coverage-v2',observationHash:'d'.repeat(64),rule:'Actual public coverage rule',evidenceIds:['H1']}]}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Inspect Home 0001 source'}));
    const dialog=screen.getByRole('dialog',{name:'Home 0001 source and timeline'});
    expect(within(dialog).getByText('Actual public coverage rule')).toBeTruthy();
    expect(within(dialog).getByText('d'.repeat(64))).toBeTruthy();
  });
  it('opens source inspection paused and restores keyboard focus without resuming', async () => {
    const value=snapshot(); value.personas=[persona]; value.preparedActions=[action]; const callbacks=show(value);
    const trigger=screen.getByRole('button',{name:'Inspect Home 0001 source'}); trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(callbacks.onPause).toHaveBeenCalledTimes(1);
    const dialog=screen.getByRole('dialog',{name:'Home 0001 source and timeline'});
    expect(within(dialog).getByText(persona.persona)).toBeTruthy();
    expect(within(dialog).queryByText(action.text)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button',{name:'Close Home 0001 source and timeline'}));
    expect(document.activeElement).toBe(trigger);
    expect(callbacks.onToggle).not.toHaveBeenCalled();
  });
  it('bounds household rows and can find the last household through keyboard selection', async () => {
    const value=snapshot(); const original=value.coordinator.households[0];
    value.coordinator.households=Array.from({length:3061},(_,i)=>({...original,id:`HOME-${i+1}`}));
    value.population.households=3061; const callbacks=show(value);
    fireEvent.click(screen.getByRole('button',{name:'Find a home'}));
    const dialog=screen.getByRole('dialog',{name:'All simulated homes'});
    expect(within(dialog).getAllByRole('button',{name:/Inspect Home /}).length).toBeLessThanOrEqual(40);
    fireEvent.change(within(dialog).getByRole('searchbox',{name:'Search homes'}),{target:{value:homeLabelV2(createHomeLabelsV2(value.coordinator.households),'HOME-3061')}});
    const home=within(dialog).getByRole('button',{name:new RegExp(`Inspect ${homeLabelV2(createHomeLabelsV2(value.coordinator.households),'HOME-3061')}`)}); home.focus(); await userEvent.keyboard('{Enter}');
    expect(callbacks.onSelect).toHaveBeenCalledWith('HOME-3061');
  });
});
describe('v2 explicit public map adapter', () => {
  it('preserves exact household cluster membership, unknown status and selected-home resolution', () => {
    const value=snapshot(); const original=value.coordinator.households[0];
    value.coordinator.households=Array.from({length:3061},(_,i)=>({...original,id:`HOME-${i+1}`}));
    const scene=adaptMapV2(value.coordinator,'HOME-3061');
    expect(scene.totalHomes).toBe(3061);
    expect(scene.features.reduce((sum,feature)=>sum+feature.homeCount,0)).toBe(3061);
    expect(new Set(scene.features.flatMap(feature=>feature.householdIds)).size).toBe(3061);
    expect(scene.features.some(feature=>feature.id==='household:HOME-3061'&&feature.homeCount===1)).toBe(true);
    expect(scene.features.length).toBeLessThan(200);
  });
  it('ignores raw closed flags, keeps only announced closures and retains exact interrupted unit positions', () => {
    const value=snapshot(); value.coordinator.map=structuredClone(value.coordinator.map);
    value.coordinator.map.edges[0].closed=true; value.coordinator.knownClosedEdgeIds=['HS'];
    value.coordinator.units[0].status='stranded'; value.coordinator.units[0].position={lat:32.79,lon:-96.78,x:7,y:8};
    const scene=adaptMapV2(value.coordinator);
    expect(scene.view.map.edges.filter(edge=>edge.closed).map(edge=>edge.id)).toEqual(['HS']);
    expect(scene.unitStates.C1).toEqual({x:7,y:8,label:expect.stringContaining('Stranded')});
  });
  it('resolves a grouped marker through real member IDs instead of dispatching or inventing a home',()=>{
    const value=snapshot(),original=value.coordinator.households[0];
    value.coordinator.households=Array.from({length:160},(_,i)=>({...original,id:`HOME-${i+1}`}));value.population.households=160;
    const onSelect=vi.fn();render(<MapV2 snapshot={value} onSelect={onSelect}/>);
    fireEvent.click(screen.getByRole('button',{name:/160 homes ·/}));
    const members=screen.getByRole('dialog',{name:'Homes in selected map group'});
    expect(within(members).getAllByRole('listitem')).toHaveLength(20);
    fireEvent.click(within(members).getByRole('button',{name:'Next'}));
    fireEvent.click(within(members).getByRole('button',{name:`Inspect ${homeLabelV2(createHomeLabelsV2(value.coordinator.households),'HOME-21')}, Needs not yet known`}));
    expect(onSelect).toHaveBeenCalledWith('HOME-21');
  });
  it('describes mixed map groups with precise counts instead of assigning every member the waiting state',()=>{
    const value=snapshot(),original=value.coordinator.households[0];
    value.coordinator.households=Array.from({length:160},(_,i)=>({...original,id:`HOME-${i+1}`}));
    value.coordinator.households[0].known={observedAtMs:0,receivedAtMs:0,size:2,accessiblePlacesRequired:0,source:'report',eventIds:[],text:'',needs:[{id:'need',householdId:'HOME-1',kind:'delivery',urgent:true,onsetMs:0,deadlineMs:90*M,completedAtMs:null}]};
    const scene=adaptMapV2(value.coordinator),feature=scene.features[0];
    expect(scene.householdLabels[feature.id]).toBe('160 homes');
    expect(scene.householdTitles[feature.id]).toBe('160 homes · 1 waiting for help · 160 not checked · 0 help completed');
    render(<MapV2 snapshot={value} onSelect={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'160 homes · 1 waiting for help · 160 not checked · 0 help completed'})).toBeTruthy();
  });
  it('pauses group inspection and restores its opener on native cancel without resuming',async()=>{
    const value=snapshot(),original=value.coordinator.households[0];value.coordinator.households=Array.from({length:160},(_,i)=>({...original,id:`HOME-${i+1}`}));
    const onPause=vi.fn(),onSelect=vi.fn();render(<MapV2 snapshot={value} onSelect={onSelect} onPause={onPause}/>);
    const opener=screen.getByRole('button',{name:/160 homes ·/});opener.focus();await userEvent.keyboard('{Enter}');
    expect(onPause).toHaveBeenCalledTimes(1);const dialog=screen.getByRole('dialog',{name:'Homes in selected map group'});
    expect(within(dialog).getByRole('button',{name:'Close Homes in selected map group'})).toBeTruthy();
    fireEvent(dialog,new Event('cancel',{cancelable:true}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(opener);expect(onSelect).not.toHaveBeenCalled();
  });
  it('returns group focus to the supplied home control if the opener disappears',()=>{
    const value=snapshot(),original=value.coordinator.households[0];value.coordinator.households=Array.from({length:160},(_,i)=>({...original,id:`HOME-${i+1}`}));
    render(<><button id="group-home-fallback">Find a home fallback</button><MapV2 snapshot={value} onSelect={vi.fn()} fallbackFocusId="group-home-fallback"/></>);
    const opener=screen.getByRole('button',{name:/160 homes ·/});opener.focus();fireEvent.click(opener);
    const dialog=screen.getByRole('dialog',{name:'Homes in selected map group'});opener.remove();
    fireEvent.click(within(dialog).getByRole('button',{name:'Close Homes in selected map group'}));
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Find a home fallback'}));
  });
  it('does not expose private onset or unannounced closure changes through map output',()=>{
    const a=mechanicsFixture(),b=mechanicsFixture();
    b.assets.events=[needEvent('H1'),{id:'private-road',effectiveAtMs:0,observedAtMs:null,sourceClass:'assumed',sourceRef:'test',payload:{type:'edge-state-change',edgeIds:['HS'],closed:true}}];
    const first=adaptMapV2(observeSnapshot(initializeWorld(a,'same')).coordinator);
    const changed=adaptMapV2(observeSnapshot(initializeWorld(b,'same')).coordinator);
    expect(changed).toEqual(first);
  });
});
describe('v2 descriptive debrief',()=>{
  it('keeps source details concise while retaining original assumptions, fit and source records in a closed disclosure',()=>{
    const bundle=mechanicsFixture(),assumption='Original authored assumption: exact wording 10/20/30.';
    const fit={...bundle.assets.population.fit,method:'original-technical-fit-method'};
    const sources=[{id:'original-source-id',url:'https://www2.census.gov/example',retrievedAt:'2026-11-08',sha256:'e'.repeat(64),bytes:123,vintage:'2022',license:'Original license',status:'derived' as const}];
    render(<EvidenceDetailsV2 evidence={{assumptions:[assumption],fit,sources,geography:bundle.assets.geography}}/>);
    expect(screen.getByRole('heading',{name:'Population matching'})).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Simulated events'})).toBeTruthy();
    const disclosure=screen.getByText('Technical evidence').closest('details')!;expect(disclosure.open).toBe(false);
    expect(within(disclosure).getByText(assumption)).toBeTruthy();
    expect(within(disclosure).getByText((_text,element)=>element?.tagName==='PRE'&&element.textContent===JSON.stringify(fit,null,2))).toBeTruthy();
    expect(within(disclosure).getByText((_text,element)=>element?.tagName==='PRE'&&element.textContent===JSON.stringify(sources,null,2))).toBeTruthy();
    expect(screen.getByText('This view uses the loaded population and map sources. Homes and incidents are simulated.')).toBeTruthy();
  });
  it('does not turn untrusted source URLs into links',()=>{
    const bundle=mechanicsFixture();
    const sources=[{id:'unsafe',url:'data:text/html,unsafe',retrievedAt:'2026-11-08',sha256:'e'.repeat(64),bytes:1,vintage:'2022',license:'test',status:'derived' as const}];
    render(<EvidenceDetailsV2 evidence={{assumptions:[],fit:bundle.assets.population.fit,sources,geography:bundle.assets.geography}}/>);
    expect(screen.queryByRole('link',{name:'unsafe',hidden:true})).toBeNull();
  });
  it('distinguishes undiscovered needs from unchecked homes and unfinished assistance',()=>{
    const bundle=mechanicsFixture();bundle.assets.events=[needEvent('H1')];
    const value=observeSnapshot(advanceWorld(initializeWorld(bundle,'results-test'),360*M));
    render(<ResultsV2 snapshot={value} policy="urgency-plus-coverage-v2" comparisons={[]} onExport={vi.fn()} onReplay={vi.fn()} onRestart={vi.fn()} onNew={vi.fn()}/>);
    expect(screen.getByText('Needs teams did not find')).toBeTruthy();
    expect(screen.getByText('Homes not checked')).toBeTruthy();
    expect(screen.getByText('People in homes with unmet needs')).toBeTruthy();
    expect(screen.queryByText(/score|winner|safe homes/i)).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'Homes'}));
    expect(screen.getByRole('searchbox',{name:'Search homes'})).toBeTruthy();
  });
  it('pairs each outcome label with its count and keeps unchecked homes distinct from unmet needs',()=>{
    const value=observeSnapshot(advanceWorld(initializeWorld(mechanicsFixture(),'result-rows'),360*M));
    Object.assign(value.summary!,{peopleHelped:104,timelyUrgent:16,urgentNeeds:92,peopleWaiting:445,uncheckedHomes:2948,cannotCallUncheckedHomes:0,undiscoveredNeeds:61,unmetNeedMinutes:85629});
    render(<ResultsV2 snapshot={value} policy="urgency-plus-coverage-v2" onExport={vi.fn()} onReplay={vi.fn()} onRestart={vi.fn()} onNew={vi.fn()}/>);
    for(const [label,count] of [['People in homes that received some help','104'],['Urgent needs helped on time','16 / 92'],['People in homes with unmet needs','445'],['Homes not checked','2,948'],['Unchecked homes unable to call at the end','0'],['Needs teams did not find','61'],['Total waiting time across needs (minutes)','85,629']]) {
      expect(screen.getByText(label).parentElement?.querySelector('dd')?.textContent).toBe(count);
    }
    expect(screen.getByText('Unchecked homes may or may not need help.')).toBeTruthy();
  });
  it('explains results in plain language and keeps raw rule reasons and evidence behind a source choice',()=>{
    const bundle=mechanicsFixture();bundle.assets.events=[needEvent('H1')];
    const value=observeSnapshot(advanceWorld(initializeWorld(bundle,'plain-results'),360*M));
    value.personas=[persona];value.preparedActions=[{...action,text:'{"contextHash":"'+'b'.repeat(64)+'"}'}];
    value.summary!.behavior.fallbackReasons={'context-mismatch':2,'unknown-technical-key':1};
    render(<ResultsV2 snapshot={value} policy="urgency-plus-coverage-v2" onExport={vi.fn()} onReplay={vi.fn()} onRestart={vi.fn()} onNew={vi.fn()}/>);
    expect(screen.getByText('Needs teams did not find')).toBeTruthy();expect(screen.getByText('Total waiting time across needs (minutes)')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab',{name:'Details'}));
    expect(screen.getByText('The resident’s situation differed from the plan: 2')).toBeTruthy();
    expect(screen.queryByText(/context-mismatch|unknown-technical-key/)).toBeNull();
    expect(screen.getByText('Homes without suitable transport')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab',{name:'Homes'}));
    expect(screen.queryByText(/contextHash/)).toBeNull();
    expect(screen.getByRole('button',{name:'Source & timeline'})).toBeTruthy();
  });
});
