import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check, ChevronRight, Clock3, FileDown, House, MessageSquareText, Package, Pause, Play, Radio, RadioTower, Search, SkipForward, Truck, Users } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { HORIZON_MS, MINUTE_MS, type DecisionEvidenceV2, type GeographyBundleV2, type ObserverSnapshotV2, type PersonaV2, type PolicyIdV2, type PopulationBundleV2, type PublicHouseholdV2, type SourceReceiptV2, type TraceEventV2 } from '../../v2/contracts';
import { SecondaryPanel } from '../SecondaryPanel';
import { MapV2 } from './MapV2';
import { SourceDetailsV2 } from './SourceDetailsV2';
export { SourceDetailsV2 } from './SourceDetailsV2';
import { publicHomeStatusV2 } from './map-adapter';
import { createHomeLabelsV2, homeLabelV2 } from './home-labels';
import type { HouseholdSituationV2 } from './household-situation';
import '../simulation.css';
import './observer-v2.css';

export interface ObserverEvidenceV2 {
  assumptions: string[];
  sources: SourceReceiptV2[];
  fit: PopulationBundleV2['fit'];
  geography: GeographyBundleV2;
  decisions?: DecisionEvidenceV2[];
  roadChangesDisableActions?: boolean;
}
export interface ObserverV2Props {
  snapshot:ObserverSnapshotV2; policy:PolicyIdV2; playing:boolean; speed:number; selected:string|null;
  onSelect:(id:string|null)=>void; onToggle:()=>void; onSpeed:(speed:number)=>void; onStep?:()=>void;
  onPause:()=>void; onExport:()=>void; onImport:()=>void; onRestart:()=>void; onNew:()=>void; onFinish:()=>void;
  evidence?:ObserverEvidenceV2;
  controlsTarget?:HTMLElement|null;
  situation?:HouseholdSituationV2;
}
export const policyLabelsV2: Record<PolicyIdV2,string> = {
  'received-order-v2':'Earlier updates first', 'urgency-first-v2':'Most urgent first', 'urgency-plus-coverage-v2':'Urgent needs and home checks',
};
export function homeStatusTextV2(home:PublicHouseholdV2):string {
  const status=publicHomeStatusV2(home);
  return status==='assisted'?'Help completed':status==='assigned'?'Team assigned':status==='reported'?'Waiting for help'
    :status==='assessed'?'Checked; no need currently known':'Needs not yet known';
}
export function missionStatusTextV2(status:string):string {
  const labels:Record<string,string>={loading:'Loading supplies',traveling:'On the way',checking:'Checking the home',delivering:'Delivering supplies',boarding:'Helping people board',transporting:'Taking people to shelter',dropoff:'Arriving at shelter',completed:'Finished',blocked:'Unable to continue',stranded:'Stranded'};
  return Object.hasOwn(labels,status)?labels[status]:'Task in progress';
}
export function unitStatusTextV2(status:string):string {
  return status==='available'?'Available':status==='working'?'On a task':status==='stranded'?'Stranded':status==='blocked'?'Unable to continue':'Status not available';
}
export function waitingReasonTextV2(reason:string|null):string {
  if(!reason)return 'Help has not been completed.';
  if(reason==='Whole-household transport is unsupported.')return 'No vehicle can carry this whole household with the required accessible places.';
  if(reason==='Need has not been observed.')return 'Teams did not know about this need.';
  if(reason==='Awaiting an available compatible assignment.')return 'Waiting for a team that can help.';
  if(reason==='No legal route remains from the current safe node.'||reason==='The route has no legal continuation at the actual cursor.')return 'No usable route remains from the team’s current location.';
  if(reason==='The occupied edge became unsafe; recovery is unsupported.')return 'The team is stranded on a road that became unsafe. This simulation cannot recover stranded teams.';
  if(reason.includes('is closed; reservations and cargo are retained.'))return reason.includes('destination shelter')?'The destination shelter is closed. Places stay reserved and passengers and supplies stay with the team.':'The supply base is closed. Supplies stay reserved or with the team.';
  const mission=reason.match(/^Mission is ([a-z-]+)\.$/);
  return mission?`${missionStatusTextV2(mission[1])}.`:'Help remains unfinished. See the original record for its recorded reason.';
}
function interruptedReasonV2(reason:string|null):string {
  if(reason==='No legal route remains from the current safe node.'||reason==='The route has no legal continuation at the actual cursor.')return 'No available route.';
  if(reason==='The occupied edge became unsafe; recovery is unsupported.')return 'The road became unsafe.';
  if(reason==='The destination shelter is closed; reservations and cargo are retained.')return 'The destination shelter is closed.';
  if(reason==='The depot is closed; reservations and cargo are retained.')return 'The supply base is closed.';
  return 'Reason not available.';
}
export function fallbackReasonTextV2(reason:string):string {
  const labels:Record<string,string>={
    'no-prepared-artifact':'No AI plan was loaded','artifact-binding-mismatch':'The plan belonged to different simulation conditions',
    'missing-prepared-opportunity':'No AI action was planned for that moment','actor-not-prepared':'This home followed simulation rules',
    'invalid-local-context':'The resident’s local information could not be used','context-mismatch':'The resident’s situation differed from the plan',
    'artifact-hash-mismatch':'The AI plan records did not match','invalid-prepared-source-chain':'The AI plan’s source could not be verified',
    'illegal-prepared-report':'The planned call did not match a current need',
    'custom-road-conditions':'Road changes: simulation reporting rules used',
  };
  return Object.hasOwn(labels,reason)?labels[reason]:'Other recorded reason';
}
export function activityTitleV2(event:TraceEventV2):string {
  const labels:Record<string,string>={'resident-action':'Resident action','resident-action-suppressed':'Action skipped after help','report-failed':'Call blocked','report-received':'Call received','mission-dispatched':'Team assigned','mission-rerouted':'Route changed','closure-encountered':'Blocked road found','mission-completed':'Task finished','mission-blocked':'Team unable to continue','mission-stranded':'Team stranded','bundle-loaded':'Supplies loaded','passengers-boarded':'Residents boarded','stage-started':'Team activity','household-checked':'Home checked','household-observed':'Home information received','world-announcement':'Situation update'};
  return Object.hasOwn(labels,event.type)?labels[event.type]:'Recorded activity';
}
export function activityTextV2(event:TraceEventV2,snapshot?:ObserverSnapshotV2,labels?:ReadonlyMap<string,string>):string {
  const names=labels??(snapshot?createHomeLabelsV2(snapshot.coordinator.households):null);
  const unit=event.unitId??'A team',home=event.householdId&&names?homeLabelV2(names,event.householdId):'A home';
  const mission=snapshot?.coordinator.missions.find(item=>item.id===event.missionId);
  switch(event.type){
    case 'report-received':return `${home}: a call for help was received.`;
    case 'report-failed':return `${home}: a call could not get through.`;
    case 'resident-action':return 'A resident action was recorded.';
    case 'resident-action-suppressed':return 'The planned action was skipped after help was completed.';
    case 'mission-rerouted':return `${unit} changed route from its last safe location.`;
    case 'closure-encountered':return `${unit} found a blocked road.`;
    case 'mission-blocked':case 'mission-stranded':return `${unit}: ${waitingReasonTextV2(event.message)}`;
    case 'mission-dispatched':return `${unit} was assigned ${mission?.action==='check'?'a home check':mission?.action==='deliver'?'a supply delivery':mission?.action==='transport'?'a shelter trip':'a response task'}.`;
    case 'mission-completed':return mission?.action==='check'?'A home check finished.':mission?.action==='deliver'?'Supplies were delivered.':mission?.action==='transport'?'Residents arrived at shelter.':'The assigned task finished.';
    case 'bundle-loaded':return `${unit} loaded one household supply bundle at the base.`;
    case 'passengers-boarded':return `The whole household boarded ${unit}.`;
    case 'household-checked':return `${home} was checked.`;
    case 'household-observed':return `Information about ${home.toLowerCase()} was received.`;
    case 'stage-started':return mission?`${unit}: ${missionStatusTextV2(event.message.match(/^Started ([a-z-]+)/)?.[1]??mission.status)}.`:`${unit} started its next task.`;
    case 'world-announcement':return event.message.includes('communications-change')?'A phone network update was received.':event.message.includes('edge-state-change')?'A road update was received.':event.message.includes('facility-state-change')?'A shelter update was received.':'A situation update was received.';
    default:return 'Activity was recorded. The original record is available in the source details.';
  }
}
export function timeV2(ms:number):string {
  const minutes=Math.floor(ms/MINUTE_MS);
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
export function directPersonasV2(snapshot:ObserverSnapshotV2):PersonaV2[] {
  const homes=new Set(snapshot.coordinator.households.map(home=>home.id)), seen=new Set<string>();
  return snapshot.personas.filter(persona=>{
    if(persona.origin!=='llm-direct'||persona.model!=='gpt-6.1-terra'||persona.reasoningEffort!=='low'||!homes.has(persona.householdId)||seen.has(persona.householdId))return false;
    seen.add(persona.householdId);return true;
  });
}
export function householdEventsV2(snapshot:ObserverSnapshotV2,id:string):TraceEventV2[] {
  const unique=new Map((snapshot.observedEvents??[...snapshot.residentEvents,...snapshot.coordinator.events])
    .filter(event=>event.householdId===id&&event.atMs<=snapshot.nowMs&&event.visibility!=='debrief').map(event=>[event.id,event]));
  const events=[...unique.values()];
  if(snapshot.observedEvents)return events;
  // Authored snapshots lack a global trace. Keep lane order for ties and merge
  // by causal phase rather than sorting visibility-prefixed identifiers.
  const phase=(event:TraceEventV2)=>event.type==='mission-completed'?0
    :event.type==='resident-action'||event.type==='resident-action-suppressed'?1
      :event.type==='report-failed'||event.type==='report-received'?2
        :event.type==='mission-dispatched'?3:4;
  return events.sort((a,b)=>a.atMs-b.atMs||phase(a)-phase(b));
}
export function HomesListV2({snapshot,selected,onSelect}: {snapshot:ObserverSnapshotV2;selected:string|null;onSelect:(id:string)=>void}) {
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(0);
  const labels=useMemo(()=>createHomeLabelsV2(snapshot.coordinator.households),[snapshot.coordinator.households]);
  const filtered=useMemo(()=>snapshot.coordinator.households.filter(home=>homeLabelV2(labels,home.id).toLowerCase().includes(query.trim().toLowerCase())),[snapshot.coordinator.households,labels,query]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/40)), boundedPage=Math.min(page,pageCount-1);
  return <div className="v2-home-browser">
    <label className="v2-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search homes</span><input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} placeholder="Search Home 0001"/></label>
    <p className="v2-muted">{filtered.length.toLocaleString()} of {snapshot.population.households.toLocaleString()} simulated homes</p>
    <ul className="v2-home-list" aria-label="Home search results">{filtered.slice(boundedPage*40,boundedPage*40+40).map(home=><li key={home.id}>
      <button type="button" aria-label={`Inspect ${homeLabelV2(labels,home.id)}, ${homeStatusTextV2(home)}`} aria-pressed={selected===home.id} onClick={()=>onSelect(home.id)}>
        <House size={17} aria-hidden="true"/><span><strong>{homeLabelV2(labels,home.id)}</strong><span>{homeStatusTextV2(home)}</span></span>
        {home.communicationsAvailable===false&&<RadioTower size={16} aria-label="Unable to call"/>}<ChevronRight size={16} aria-hidden="true"/>
      </button></li>)}</ul>
    {!filtered.length&&<p>No matching home. Try its number.</p>}
    <nav className="v2-pagination" aria-label="Home list pages"><Button variant="outline" disabled={boundedPage===0} onClick={()=>setPage(boundedPage-1)}>Previous</Button><span>Page {boundedPage+1} of {pageCount}</span><Button variant="outline" disabled={boundedPage+1>=pageCount} onClick={()=>setPage(boundedPage+1)}>Next</Button></nav>
  </div>;
}

function SelectedHomePanel({snapshot,home,labels,situation,onSelect,onSource,onFind}: {snapshot:ObserverSnapshotV2;home:PublicHouseholdV2|null;labels:ReadonlyMap<string,string>;situation?:HouseholdSituationV2;onSelect:(id:string)=>void;onSource:()=>void;onFind:()=>void}) {
  const name=home?homeLabelV2(labels,home.id):'Choose a home';
  const actual=home&&situation?.householdId===home.id?situation:null;
  const residentCount=actual?.residentCount??home?.known?.size??null;
  const needs=actual?.needs??(home?.known?.needs??[]).map(need=>({...need,knownToTeams:true,cause:null}));
  const pending=needs.filter(need=>need.completedAtMs===null),completed=needs.filter(need=>need.completedAtMs!==null);
  const events=home?householdEventsV2(snapshot,home.id):[];
  const pendingIds=new Set(pending.map(need=>need.id));
  const latest=events.filter(event=>['report-received','report-failed','resident-action-suppressed'].includes(event.type)
    &&(!actual||!pendingIds.size||Boolean(event.needId&&pendingIds.has(event.needId)))).at(-1);
  const duration=(ms:number)=>{const n=Math.max(0,Math.floor(ms/MINUTE_MS));return n>=60?`${Math.floor(n/60)}h${n%60?` ${n%60} min`:''}`:`${n} min`;};
  const ago=(atMs:number)=>snapshot.nowMs-atMs<MINUTE_MS?'just now':`${duration(snapshot.nowMs-atMs)} ago`;
  const request=latest?.type==='report-failed'?`Call failed ${ago(latest.atMs)}.`:latest?.type==='report-received'?`Call received ${ago(latest.atMs)}.`:latest?.type==='resident-action-suppressed'?'No new request after help.':'No call recorded yet';
  const requestDetail=latest?.type==='report-failed'?'Phone network was down.':latest?.type==='report-received'?'Response teams received the request.':latest?.type==='resident-action-suppressed'?'No new request was made.':home?.lastCheckAtMs!==null&&home?.lastCheckAtMs!==undefined?`Home checked at ${timeV2(home.lastCheckAtMs)}.`:null;
  const mission=home?snapshot.coordinator.missions.find(item=>item.id===home.missionId)??(completed.length?snapshot.coordinator.missions.filter(item=>item.householdId===home.id&&item.action!=='check').at(-1):undefined):undefined;
  const missionUnit=mission?snapshot.coordinator.units.find(unit=>unit.id===mission.unitId):undefined;
  const boarded=Boolean(mission&&(missionUnit?.missionId===mission.id&&missionUnit.passengers>0||events.some(event=>event.type==='passengers-boarded'&&event.missionId===mission.id)));
  const onlySupplies=pending.length>0&&pending.every(need=>need.kind==='delivery'),onlyRide=pending.length>0&&pending.every(need=>need.kind==='relocation');
  const helpState=completed.length&&pending.length?'partial':completed.length?'complete':!actual&&!home?.known?'unknown':'pending';
  const response=helpState==='partial'?'Some help completed':helpState==='complete'?'Help completed':onlySupplies?'No supplies delivered yet':onlyRide?boarded||mission&&['boarding','transporting','dropoff'].includes(mission.status)?'Shelter trip not completed':'No transport arrived yet':actual&&needs.length===0?mission?.action==='check'?'Home check in progress':'No help needed right now':!actual&&!home?.known?'Response not available':'No assistance recorded';
  const ids=[...labels.keys()],index=home?ids.indexOf(home.id):-1,choices=ids.slice(Math.max(0,index-4),Math.max(0,index-4)+9);
  return <section className="v2-resident-panel" aria-label="Selected home">
    <header className="v2-panel-heading"><h2>Selected home</h2><House size={18} aria-hidden="true"/></header>
    <div className="v2-story-chooser"><label><span className="sr-only">Choose a home</span><select value={home?.id??''} onChange={event=>{if(event.target.value)onSelect(event.target.value);}}>{!home&&<option value="">Choose a home</option>}{choices.map(id=><option key={id} value={id}>{homeLabelV2(labels,id)}</option>)}</select></label><Button variant="ghost" onClick={onFind} aria-label="Find another home"><Search size={16}/></Button></div>
    {!home?<p className="v2-muted v2-pad">Find a home to see its situation.</p>:<section className="v2-flow" aria-label={`${name} selected home details`}>
      <div className="v2-flow-identity"><h3 className="sr-only">{name}</h3></div>
      <p className="v2-resident-count">{residentCount===null?'Resident count not available':`${residentCount} ${residentCount===1?'resident':'residents'}`}</p>
      {home.known&&home.known.accessiblePlacesRequired>0&&<p className="v2-resident-count">Accessible places needed: {home.known.accessiblePlacesRequired}</p>}
      <div className="v2-story-groups">
        <section className="v2-story-group" aria-label="Needs"><header><House size={18} aria-hidden="true"/><h3>Needs</h3></header><div className="v2-story-content">
          {!actual&&<p className="v2-muted">{home.known?'Known information only':'Situation not available'}</p>}
          {needs.length>0?<><ul className="v2-current-needs">{needs.map(need=><li key={need.id}><strong>{need.completedAtMs!==null?need.kind==='delivery'?'Supplies received':'Ride to shelter completed':need.kind==='delivery'?'Needs supplies':'Needs a ride to shelter'}</strong>{need.urgent&&<span className="v2-urgent">Urgent</span>}<span>Started {ago(need.onsetMs)}</span>{need.completedAtMs===null&&<span>{need.deadlineMs>snapshot.nowMs?`${duration(need.deadlineMs-snapshot.nowMs)} left`:`${duration(snapshot.nowMs-need.deadlineMs)} overdue`}</span>}{!need.knownToTeams&&<span className="v2-not-known">Not yet known to response teams</span>}</li>)}</ul><p className="v2-muted">Specific cause not recorded</p></>:actual?<p>No current need in this simulation</p>:home.known&&<p>No need currently known to response teams</p>}
        </div></section>
        <section className={`v2-story-group${latest?.type==='report-failed'?' is-blocked':latest?.type==='report-received'?' is-received':''}`} aria-label="Request"><header><Radio size={18} aria-hidden="true"/><h3>Request</h3></header><div className="v2-story-content"><strong>{request}</strong>{requestDetail&&<p>{requestDetail}</p>}</div></section>
        <section className={`v2-story-group is-${helpState}`} aria-label="Response" data-help-state={helpState}><header>{helpState==='complete'?<Check size={18} aria-hidden="true"/>:<Truck size={18} aria-hidden="true"/>}<h3>Response</h3></header><div className="v2-story-content"><strong>{response}</strong>{helpState==='partial'&&<span>{pending.length} {pending.length===1?'need':'needs'} still waiting</span>}{completed.length>0&&<p>Completed at {timeV2(Math.max(...completed.map(need=>need.completedAtMs!)))}</p>}{mission&&<><p>{mission.unitId}: {missionStatusTextV2(mission.status)}</p>{mission.shelterId&&<p>Shelter: {snapshot.coordinator.facilities.find(facility=>facility.id===mission.shelterId)?.name??'Destination recorded in source'}</p>}{mission.estimatedCompletionAtMs!==null&&mission.completedAtMs===null&&<p>Expected completion {timeV2(mission.estimatedCompletionAtMs)}</p>}</>}{!mission&&pending.length>0&&<p>No team assigned</p>}</div></section>
      </div>
      <Button variant="outline" className="v2-source-button" onClick={onSource} aria-label={`Inspect ${name} source`}>Source &amp; timeline <ChevronRight size={15}/></Button>
    </section>}
  </section>;
}

export function EvidenceDetailsV2({evidence}: {evidence?:ObserverEvidenceV2}) {
  if(!evidence)return <p>No sources were included with this view.</p>;
  return <div className="v2-source-details"><h3>Population matching</h3>
    <p>This view uses the loaded population and map sources. Homes and incidents are simulated.</p>
    <p>{evidence.sources.length} source records · {evidence.fit.controls.length} population measures · {evidence.geography.tracts.length} mapped areas</p>
    <p>Population matching does not validate how a disaster unfolds or how people behave.</p>
    <h3>Simulated events</h3><p>Incidents and response resources follow the assumptions chosen for this simulation.</p>
    <details className="v2-technical-evidence"><summary>Technical evidence</summary>
      <h4>Original assumptions</h4><ol>{evidence.assumptions.map((text,index)=><li key={index}>{text}</li>)}</ol>
      <h4>Original population matching</h4><pre>{JSON.stringify(evidence.fit,null,2)}</pre>
      <h4>Original geography limitations</h4><ul>{evidence.geography.limitations.map((text,index)=><li key={index}>{text}</li>)}</ul>
      <h4>Original source records</h4><ul>{evidence.sources.map(source=>{let safe=false;try{const url=new URL(source.url);safe=url.protocol==='https:'&&['www2.census.gov','tigerweb.geo.census.gov','api.openai.com'].includes(url.hostname)&&!url.username&&!url.password;}catch{/* Invalid source URLs remain plain text. */}return <li key={source.id}>{safe?<a href={source.url} target="_blank" rel="noopener noreferrer">{source.id}</a>:source.id}</li>;})}</ul><pre>{JSON.stringify(evidence.sources,null,2)}</pre>
    </details>
  </div>;
}
function Outcomes({snapshot,policy,labels,onSelect,onPause}: {snapshot:ObserverSnapshotV2;policy:PolicyIdV2;labels:ReadonlyMap<string,string>;onSelect:(id:string)=>void;onPause:()=>void}) {
  const observation=snapshot.coordinator;
  const waiting=observation.households.filter(item=>item.known?.needs.some(need=>need.completedAtMs===null));
  const completed=observation.households.filter(item=>item.known?.needs.some(need=>need.completedAtMs!==null));
  const checked=observation.households.filter(item=>item.lastCheckAtMs!==null).length;
  const cannotCall=observation.households.filter(item=>item.communicationsAvailable===false&&item.lastCheckAtMs===null).length;
  const activeTeams=new Set(observation.units.filter(unit=>unit.status==='working').map(unit=>unit.id)).size;
  const interrupted=observation.units.filter(unit=>unit.status==='stranded'||unit.status==='blocked');
  const coverage=observation.households.length?checked/observation.households.length:0;
  const recent=[...observation.events].reverse().slice(0,5);
  return <section className="v2-outcomes-panel" aria-label="Response overview">
    <header className="v2-panel-heading"><h2>Response overview</h2></header>
    <div className="v2-outcomes-body"><p className="v2-response-rule">{policyLabelsV2[policy]}</p>
      <div className="v2-overview-metrics" aria-label="What response teams know"><div className="v2-overview-metric"><strong>{waiting.length}</strong><span>homes waiting for help</span></div><div className="v2-overview-metric"><strong>{activeTeams}</strong><span>teams responding</span></div><div className="v2-overview-metric" title="People in homes with at least one completed need; other needs may still be waiting"><strong>{completed.reduce((sum,item)=>sum+(item.known?.size??0),0)}</strong><span>people in homes that received some help</span></div></div>
      <section className="v2-known-queue" aria-label="Homes waiting for help"><h3>Homes waiting for help</h3>{waiting.slice(0,3).map(item=>{const mission=observation.missions.find(record=>record.id===item.missionId);return <button key={item.id} type="button" aria-label={`Inspect ${homeLabelV2(labels,item.id)}, waiting for help`} onClick={()=>onSelect(item.id)}><strong>{homeLabelV2(labels,item.id)}</strong><span>{item.known!.needs.filter(need=>need.completedAtMs===null).map(need=>`${need.urgent?'Urgent ':''}${need.kind==='delivery'?'Supplies':'Ride to shelter'}`).join(' / ')}</span><span>{mission?missionStatusTextV2(mission.status):'Waiting for a response'}</span><ChevronRight size={15}/></button>;})}{!waiting.length&&<p className="v2-muted">{observation.households.some(item=>item.known?.needs.length)?'No known homes waiting for help':'No needs reported yet'}</p>}</section>
      <details className="v2-coverage-details"><summary>Coverage details</summary><section className="v2-coverage" aria-label="Home check coverage"><div><h3>Homes checked</h3><span>{checked.toLocaleString()} / {observation.households.length.toLocaleString()}</span></div><div className="v2-coverage-track" role="meter" aria-label="Homes checked" aria-valuemin={0} aria-valuemax={observation.households.length} aria-valuenow={checked}><span style={{width:`${coverage*100}%`}}/></div><dl className="v2-detail-list"><div><dt>Homes not checked</dt><dd>{(observation.households.length-checked).toLocaleString()}</dd></div><div><dt>Unchecked homes known to be unable to call</dt><dd>{cannotCall.toLocaleString()}</dd></div></dl></section></details>
      {interrupted.length>0&&<section className="v2-interrupted" aria-label="Teams stopped"><h3>Teams stopped</h3>{interrupted.map(unit=>{const mission=observation.missions.find(item=>item.id===unit.missionId);return <p key={unit.id}><strong>Team {unit.id} · {unit.status==='stranded'?'Stranded':'Stopped'}</strong><span>{interruptedReasonV2(mission?.reason??null)}</span>{unit.passengers>0&&<span>{unit.passengers} {unit.passengers===1?'person':'people'} on board</span>}{unit.carriedBundles>0&&<span>{unit.carriedBundles} supply {unit.carriedBundles===1?'bundle':'bundles'} on board</span>}</p>;})}</section>}
      <details className="v2-recent" onToggle={event=>{if(event.currentTarget.open)onPause();}}><summary>Recent updates</summary><section aria-label="Latest activity">{recent.map(event=><p key={event.id}><time>{timeV2(event.atMs)}</time><span>{activityTextV2(event,snapshot,labels)}</span></p>)}</section></details>
    </div>
  </section>;
}

type Panel='homes'|'source'|'evidence'|'residents'|'outcomes'|'run';
export function ObserverV2(props:ObserverV2Props) {
  const {snapshot,policy,playing,speed,selected,onSelect,onToggle,onSpeed,onStep,onPause,onExport,onImport,onRestart,onNew,onFinish,evidence,controlsTarget,situation}=props;
  const [panel,setPanel]=useState<Panel|null>(null);
  const labels=useMemo(()=>createHomeLabelsV2(snapshot.coordinator.households),[snapshot.coordinator.households]);
  const personas=directPersonasV2(snapshot);
  const home=snapshot.coordinator.households.find(item=>item.id===selected)??(selected===null?snapshot.coordinator.households.find(item=>item.id===personas[0]?.householdId)??snapshot.coordinator.households[0]:undefined)??null;
  const open=(next:Panel)=>{onPause();setPanel(next);};
  const choose=(id:string)=>onSelect(id);
  const observation=snapshot.coordinator;
  const available=observation.units.filter(unit=>unit.status==='available').length;
  const shelters=observation.facilities.filter(facility=>facility.kind==='shelter'&&facility.open);
  const free=shelters.reduce((sum,facility)=>sum+facility.available,0), reserved=observation.facilities.reduce((sum,facility)=>sum+facility.reserved,0);
  const name=home?homeLabelV2(labels,home.id):'Home';
  const titles:Record<Panel,string>={homes:'All simulated homes',source:`${name} source and timeline`,evidence:'Sources and assumptions',residents:'Selected home',outcomes:'Response overview',run:'Run options'};
  const residents=<SelectedHomePanel snapshot={snapshot} home={home} labels={labels} situation={situation} onSelect={choose} onSource={()=>open('source')} onFind={()=>open('homes')}/>;
  const outcomes=<Outcomes snapshot={snapshot} policy={policy} labels={labels} onSelect={choose} onPause={onPause}/>;
  const controls=<div className="v2-observer-controls" role="group" aria-label="Simulation controls">
    <div className="v2-playback"><div className="v2-clock"><span>Time elapsed</span><time aria-label={`Time elapsed ${timeV2(snapshot.nowMs)} of six hours`}>{timeV2(snapshot.nowMs)}<span> / 06:00</span></time></div><Button variant="outline" onClick={onToggle} disabled={snapshot.finalized}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'Pause':'Run'}</Button><label><span className="sr-only">Playback speed</span><select aria-label="Playback speed" value={speed} onChange={event=>onSpeed(Number(event.target.value))}>{[1,2,5,10,30,60].map(value=><option key={value} value={value}>{value}x</option>)}</select></label>{onStep&&<Button variant="ghost" aria-label="Advance one minute" onClick={()=>{onPause();onStep();}} disabled={snapshot.finalized}><SkipForward size={17}/></Button>}</div>
    <nav className="v2-toolbar-actions" aria-label="Inspection tools"><Button id="v2-find-home" variant="outline" onClick={()=>open('homes')}><Search size={16}/>Find a home</Button><Button variant="ghost" onClick={()=>open('evidence')}>Sources</Button><Button variant="ghost" onClick={()=>open('run')}>Run options</Button></nav>
  </div>;
  return <section className="observer-v2" aria-label="Automatic six-hour simulation observation">
    {controlsTarget?<>{createPortal(controls,controlsTarget)}<h1 className="sr-only">Dallas response simulation</h1><p className="sr-only">{snapshot.population.households.toLocaleString()} simulated homes and {snapshot.population.persons.toLocaleString()} residents.</p></>:<header className="v2-toolbar"><div className="v2-title"><h1>Observe simulation</h1><p>Dallas / {snapshot.population.households.toLocaleString()} simulated homes / {snapshot.population.persons.toLocaleString()} people</p></div>{controls}</header>}
    <div className="v2-resource-strip" aria-label="Available teams and supplies"><span><Users size={17}/><strong>{available} / {observation.units.length}</strong> teams available</span><span title="Counts are household supply bundles"><Package size={17}/><strong>{observation.supply.depotAvailable}</strong> supplies at base / {observation.supply.reserved} set aside / {observation.supply.loaded} carried</span><span><House size={17}/><strong>{free}</strong> shelter places free / {reserved} reserved</span><span className="v2-run-state"><i className={playing?'is-running':''}/>{snapshot.finalized?'Six hours completed':playing?'Automatic simulation':'Paused'}</span></div>
    <div className="v2-focused-tools"><Button variant="outline" onClick={()=>open('residents')}>Selected home</Button><Button variant="outline" onClick={()=>open('outcomes')}>Response overview</Button></div>
    <div className="v2-workspace"><aside className="v2-resident-column">{residents}</aside><section className="v2-map-column" aria-label="Dallas observation map"><MapV2 snapshot={snapshot} playing={playing} speed={speed} selected={home?.id??null} onSelect={choose} onPause={onPause} fallbackFocusId="v2-find-home" geography={evidence?.geography}/></section><aside className="v2-outcomes-column">{outcomes}</aside></div>
    {panel&&<SecondaryPanel key={panel} title={titles[panel]} onClose={()=>setPanel(null)} fallbackFocusId="v2-find-home" className="v2-secondary">
      {panel==='homes'&&<HomesListV2 snapshot={snapshot} selected={home?.id??null} onSelect={id=>{choose(id);setPanel(null);}}/>}
      {panel==='source'&&home&&<SourceDetailsV2 snapshot={snapshot} householdId={home.id} decisions={evidence?.decisions} roadChangesDisableActions={evidence?.roadChangesDisableActions}/>}
      {panel==='evidence'&&<EvidenceDetailsV2 evidence={evidence}/>}
      {panel==='residents'&&residents}{panel==='outcomes'&&outcomes}
      {panel==='run'&&<div className="v2-run-options"><p>Save this run at its current point, or continue from a saved run.</p><Button variant="outline" onClick={onExport}><FileDown size={16}/>Save run</Button><Button variant="outline" onClick={onImport}>Open saved run</Button><Button variant="outline" onClick={onRestart}>Restart with the same conditions</Button><Button variant="outline" onClick={onNew}>New simulation</Button><Button variant="outline" onClick={onFinish}>{snapshot.finalized?'View results':'Skip to the end'}<ChevronRight size={15}/></Button><p className="v2-muted">Closing this panel keeps the simulation paused.</p><p className="v2-muted">{Math.floor(snapshot.nowMs/MINUTE_MS)} of {HORIZON_MS/MINUTE_MS} minutes recorded.</p></div>}
    </SecondaryPanel>}
  </section>;
}
