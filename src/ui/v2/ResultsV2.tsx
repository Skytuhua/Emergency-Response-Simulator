import { useId, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileDown, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { ObserverSnapshotV2, PolicyIdV2, SummaryV2 } from '../../v2/contracts';
import { MapV2 } from './MapV2';
import { SecondaryPanel } from '../SecondaryPanel';
import { createHomeLabelsV2, homeLabelV2 } from './home-labels';
import { EvidenceDetailsV2, HomesListV2, SourceDetailsV2, activityTextV2, fallbackReasonTextV2, householdEventsV2, policyLabelsV2, timeV2, unitStatusTextV2, waitingReasonTextV2, type ObserverEvidenceV2 } from './ObserverV2';
import './observer-v2.css';

export interface ComparisonV2 { policy:PolicyIdV2; summary:SummaryV2 }
export interface ResultsV2Props {
  snapshot:ObserverSnapshotV2; policy:PolicyIdV2; comparisons?:ComparisonV2[]; loading?:boolean; evidence?:ObserverEvidenceV2;
  onExport:()=>void; onReplay:()=>void; onRestart:()=>void; onNew:()=>void;
}
const tabs=['Overview','Compare','Homes','Details'] as const;
const percent=(n:number,total:number)=>total?`${Math.round(n/total*100)}%`:'No urgent needs';
function CompletionChart({summary,comparisons}: {summary:SummaryV2;comparisons:ComparisonV2[]}) {
  const series=[{label:'This run',summary},...comparisons.map(item=>({label:policyLabelsV2[item.policy],summary:item.summary}))];
  const max=Math.max(1,...series.map(item=>item.summary.peopleHelped));
  const colors=['#bd2534','#536c83','#90732e'];
  const x=(ms:number)=>42+ms/(360*60_000)*342, y=(people:number)=>174-people/max*144;
  const line=(value:SummaryV2)=>{
    const completions=value.outcomes.flatMap(home=>{
      const times=home.needs.flatMap(need=>need.completedAtMs===null?[]:[need.completedAtMs]);
      return times.length?[{at:Math.min(...times),size:home.size}]:[];
    }).sort((a,b)=>a.at-b.at);
    let count=0, path=`M ${x(0)} ${y(0)}`;
    for(const completion of completions){path+=` H ${x(completion.at)} V ${y(count+=completion.size)}`;}
    return `${path} H ${x(360*60_000)}`;
  };
  return <section className="v2-completion-chart" aria-label="Completed assistance over time"><h2>People in homes that received some help</h2><svg viewBox="0 0 408 210" role="img" aria-label={`People in homes that received some help after six hours: this run ${summary.peopleHelped}${comparisons.map(item=>`, ${policyLabelsV2[item.policy]} ${item.summary.peopleHelped}`).join('')}`}>
    {[0,.5,1].map(tick=><g key={tick}><line x1={42} x2={384} y1={y(max*tick)} y2={y(max*tick)} stroke="#e0e5e9"/><text x={32} y={y(max*tick)+4} textAnchor="end" fontSize={12} fill="#53616d">{Math.round(max*tick)}</text></g>)}
    {[0,60,120,180,240,300,360].map(minute=><text key={minute} x={x(minute*60_000)} y={196} textAnchor="middle" fontSize={12} fill="#53616d">{minute}m</text>)}
    {series.map((item,index)=><path key={item.label} d={line(item.summary)} fill="none" stroke={colors[index%colors.length]} strokeWidth={index===0?2.5:1.75} strokeDasharray={index?'5 4':undefined}/>)}
  </svg><div className="v2-chart-legend">{series.map((item,index)=><span key={item.label}><i style={{background:colors[index%colors.length]}}/>{item.label}</span>)}</div><p className="v2-muted">Each resident counts once, when their home first receives help.</p></section>;
}
export function ResultsV2({snapshot,policy,comparisons=[],loading=false,evidence,onExport,onReplay,onRestart,onNew}:ResultsV2Props) {
  const summary=snapshot.summary;
  const labels=useMemo(()=>createHomeLabelsV2(snapshot.coordinator.households),[snapshot.coordinator.households]);
  const [tab,setTab]=useState<typeof tabs[number]>('Overview');
  const [panel,setPanel]=useState<'source'|'evidence'|null>(null);
  const [selected,setSelected]=useState<string|null>(()=>summary?.outcomes.find(home=>home.needs.some(need=>need.completedAtMs===null))?.householdId??snapshot.coordinator.households[0]?.id??null);
  const refs=useRef<(HTMLButtonElement|null)[]>([]), id=useId();
  const other=comparisons.filter(item=>item.policy!==policy);
  const changeTab=(value:typeof tabs[number])=>{setTab(value);};
  const inspect=(householdId:string)=>{setSelected(householdId);setTab('Homes');refs.current[2]?.focus();};
  const waiting=summary?.outcomes.filter(home=>home.needs.some(need=>need.completedAtMs===null))??[];
  const selectedOutcome=summary?.outcomes.find(home=>home.householdId===selected);
  const all=[...(summary?[{policy,summary}]:[]),...other];
  return <section className="results-v2" aria-label="Six-hour simulation results">
    <header className="v2-results-toolbar"><div><h1>Results &amp; analysis</h1><p>{evidence?.scenarioName?`${{storm:'Storm',flood:'Flood',tornado:'Tornado'}[evidence.scenarioName]} / `:''}Dallas · {snapshot.population.households.toLocaleString()} simulated homes · {snapshot.population.persons.toLocaleString()} people · {timeV2(snapshot.nowMs)}</p></div><div><Button variant="outline" onClick={onExport}><FileDown size={16}/>Export run</Button><Button variant="outline" onClick={onReplay}>Verify this run</Button><Button variant="outline" onClick={onRestart}><RotateCcw size={15}/>Restart</Button><Button variant="ghost" onClick={onNew}>New simulation</Button></div></header>
    <div className="v2-results-tabs" role="tablist" aria-label="Results views">{tabs.map((item,index)=><button key={item} type="button" role="tab" ref={element=>{refs.current[index]=element;}} id={`${id}-tab-${index}`} aria-selected={tab===item} aria-controls={`${id}-panel-${index}`} tabIndex={tab===item?0:-1} onClick={()=>changeTab(item)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next===null)return;event.preventDefault();changeTab(tabs[next]);refs.current[next]?.focus();
    }}>{item}</button>)}</div>
    {!summary?<p className="v2-pad" role="status">Results become available after six hours. This run is still in progress.</p>:<div className="v2-results-panel" role="tabpanel" id={`${id}-panel-${tabs.indexOf(tab)}`} aria-labelledby={`${id}-tab-${tabs.indexOf(tab)}`} tabIndex={0}>
      {tab==='Overview'&&<div className="v2-results-overview"><div className="v2-debrief-outcomes"><h2>What happened</h2><dl className="v2-final-counts"><div><dt>People in homes that received some help</dt><dd>{summary.peopleHelped.toLocaleString()}</dd></div><div><dt>Urgent needs helped on time</dt><dd>{summary.timelyUrgent.toLocaleString()} / {summary.urgentNeeds.toLocaleString()}</dd></div><div><dt>People in homes with unmet needs</dt><dd>{summary.peopleWaiting.toLocaleString()}</dd></div><div><dt>Homes not checked</dt><dd>{summary.uncheckedHomes.toLocaleString()}</dd></div></dl><p className="v2-outcome-note">Unchecked homes may or may not need help.</p><dl className="v2-remaining-counts"><div><dt>Unchecked homes unable to call at the end</dt><dd>{summary.cannotCallUncheckedHomes.toLocaleString()}</dd></div><div><dt>Needs teams did not find</dt><dd>{summary.undiscoveredNeeds.toLocaleString()}</dd></div><div><dt>Total waiting time across needs (minutes)</dt><dd>{Math.round(summary.unmetNeedMinutes).toLocaleString()}</dd></div></dl></div>
        <section className="v2-final-map"><MapV2 snapshot={snapshot} mapTitle="Response after six hours" selected={selected} onSelect={inspect} fallbackFocusId={`${id}-tab-2`} geography={evidence?.geography} compact/><div className="v2-final-resources"><span>{summary.completedNeeds} / {summary.needs} needs completed</span><span>Supply bundles: {snapshot.coordinator.supply.delivered} delivered · {snapshot.coordinator.supply.loaded} carried · {snapshot.coordinator.supply.reserved} reserved</span><span>Shelter: {snapshot.coordinator.facilities.reduce((sum,item)=>sum+item.occupied,0)} occupied · {snapshot.coordinator.facilities.reduce((sum,item)=>sum+item.reserved,0)} reserved</span></div></section>
        <section className="v2-waiting-reasons" aria-label="Why people are still waiting"><h2>Why people are still waiting</h2><p className="v2-muted">Status at the end of the simulation.</p><ul>{waiting.slice(0,8).map(home=><li key={home.householdId}><button type="button" onClick={()=>inspect(home.householdId)}><strong>{homeLabelV2(labels,home.householdId)} · {home.size} {home.size===1?'person':'people'}</strong><span>{[...new Set(home.needs.filter(need=>need.completedAtMs===null).map(need=>`${need.kind==='delivery'?'Supplies':'Ride'}: ${waitingReasonTextV2(need.waitingReason)}`))].join(' ')}</span><ChevronRight size={15}/></button></li>)}</ul>{!waiting.length&&<p>All needs were resolved by the end.</p>}{waiting.length>8&&<Button variant="ghost" onClick={()=>inspect(waiting[0].householdId)}>Inspect all homes ({waiting.length} waiting)<ChevronRight size={15}/></Button>}</section>
      </div>}
      {tab==='Compare'&&<div className="v2-comparison-layout"><section><h2>Same conditions, different response rules</h2><p className="v2-muted">{policyLabelsV2[policy]} was used for this run. The other completed runs use the same starting conditions.</p>{loading&&<p role="status">Computing policy comparisons…</p>}{!loading&&!other.length&&<p role="status">No comparison is available yet.</p>}<div className="v2-table-scroll"><table className="v2-table"><thead><tr><th scope="col">Outcome</th>{all.map(item=><th scope="col" key={item.policy}>{policyLabelsV2[item.policy]}{item.policy===policy?' · this run':''}</th>)}</tr></thead><tbody>
        <tr><th scope="row">People in homes that received some help</th>{all.map(item=><td key={item.policy}>{item.summary.peopleHelped}</td>)}</tr>
        <tr><th scope="row">Urgent help on time</th>{all.map(item=><td key={item.policy}>{item.summary.timelyUrgent} / {item.summary.urgentNeeds} ({percent(item.summary.timelyUrgent,item.summary.urgentNeeds)})</td>)}</tr>
        <tr><th scope="row">People in homes with unmet needs</th>{all.map(item=><td key={item.policy}>{item.summary.peopleWaiting}</td>)}</tr>
        <tr><th scope="row">Homes not checked</th>{all.map(item=><td key={item.policy}>{item.summary.uncheckedHomes}</td>)}</tr>
        <tr><th scope="row">Needs teams did not find</th>{all.map(item=><td key={item.policy}>{item.summary.undiscoveredNeeds}</td>)}</tr>
        <tr><th scope="row">Total waiting time for needs (minutes)</th>{all.map(item=><td key={item.policy}>{Math.round(item.summary.unmetNeedMinutes).toLocaleString()}</td>)}</tr>
        <tr><th scope="row">Homes without suitable transport</th>{all.map(item=><td key={item.policy}>{item.summary.unsupportedHouseholds}</td>)}</tr>
      </tbody></table></div><p className="v2-muted">Earlier updates first orders homes by their latest report or check.</p><p className="v2-muted">Results depend on the simulated incidents, resources and reporting rules. They have not been validated as predictions of a real disaster.</p></section><CompletionChart summary={summary} comparisons={other}/></div>}
      {tab==='Homes'&&<div className="v2-results-homes"><section><h2>All simulated homes</h2><HomesListV2 snapshot={snapshot} selected={selected} onSelect={setSelected}/></section><section className="v2-household-debrief" aria-label="Selected household debrief"><h2>{selected?homeLabelV2(labels,selected):'Select a home'} · home history</h2>{selectedOutcome&&<><p>{selectedOutcome.size} {selectedOutcome.size===1?'person':'people'} · {selectedOutcome.checkedAtMs===null?'Not checked':`Checked ${timeV2(selectedOutcome.checkedAtMs)}`}</p><h3>Needs during the simulation</h3>{selectedOutcome.needs.length?<ul className="v2-revealed-needs">{selectedOutcome.needs.map(need=><li key={need.id}><strong>{need.urgent?'Urgent · ':''}{need.kind==='delivery'?'Supplies':'Transport'}</strong><span>Need began {timeV2(need.onsetMs)} · help due by {timeV2(need.deadlineMs)}</span><span>{need.completedAtMs===null?waitingReasonTextV2(need.waitingReason):`Completed ${timeV2(need.completedAtMs)}${need.completedAtMs<=need.deadlineMs?' · on time':' · after the target time'}`}</span>{!need.discovered&&need.waitingReason!=='Need has not been observed.'&&<span>Teams did not know about this need.</span>}</li>)}</ul>:<p>No need arose for this home during the simulation.</p>}</>}{selected&&<><h3>What happened at this home</h3><ol className="v2-event-list">{householdEventsV2(snapshot,selected).map(event=><li key={event.id}><time>{timeV2(event.atMs)}</time><p>{activityTextV2(event,snapshot,labels)}</p></li>)}</ol><Button variant="outline" onClick={()=>setPanel('source')}>Source &amp; timeline</Button></>}</section></div>}
      {tab==='Details'&&<div className="v2-results-details"><section><h2>How resident actions were chosen</h2><dl className="v2-detail-list"><div><dt>Profiles recorded as AI-created</dt><dd>{summary.behavior.directPersonaActors}</dd></div><div><dt>Residents whose plans matched this run</dt><dd>{summary.behavior.eligibleActors}</dd></div><div><dt>Recorded AI actions used</dt><dd>{summary.behavior.directActions}</dd></div><div><dt>Actions skipped after help</dt><dd>{summary.behavior.suppressed}</dd></div><div><dt>Actions using simulation rules</dt><dd>{summary.behavior.fallback}</dd></div></dl><ul>{Object.entries(summary.behavior.fallbackReasons).map(([reason,count])=><li key={reason}>{fallbackReasonTextV2(reason)}: {count}</li>)}</ul><p className="v2-muted">Hashes check that records match; they do not authenticate the provider.</p><h2>Resources after six hours</h2><dl className="v2-detail-list"><div><dt>Supply bundles at base / set aside / carried / delivered</dt><dd>{snapshot.coordinator.supply.depotAvailable} / {snapshot.coordinator.supply.reserved} / {snapshot.coordinator.supply.loaded} / {snapshot.coordinator.supply.delivered}</dd></div><div><dt>Homes without suitable transport</dt><dd>{summary.unsupportedHouseholds}</dd></div></dl><ul className="v2-unit-accounting">{snapshot.coordinator.units.map(unit=><li key={unit.id}><strong>{unit.id} · {unitStatusTextV2(unit.status)}</strong><span>{unit.passengers} passengers · {unit.carriedBundles} carried supply bundles · {Math.round(unit.busyMs/60_000)} busy minutes</span></li>)}</ul><p className="v2-muted">Passengers and supply bundles stay with teams whose trips are unfinished or interrupted. Help is complete after delivery or arrival at shelter.</p></section><section><h2>Sources and assumptions</h2><p>Review the sources, population matching and simulation assumptions.</p><Button variant="outline" onClick={()=>setPanel('evidence')}>Read sources and assumptions</Button></section></div>}
    </div>}
    {panel&&<SecondaryPanel title={panel==='source'?`${selected?homeLabelV2(labels,selected):'Home'} source and timeline`:'Sources and assumptions'} onClose={()=>setPanel(null)} fallbackFocusId={`${id}-tab-${panel==='source'?2:3}`} className="v2-secondary">{panel==='source'&&selected?<SourceDetailsV2 snapshot={snapshot} householdId={selected} decisions={evidence?.decisions} roadChangesDisableActions={evidence?.roadChangesDisableActions} scenarioChangesDisableActions={evidence?.scenarioChangesDisableActions}/>:<EvidenceDetailsV2 evidence={evidence}/>}</SecondaryPanel>}
  </section>;
}
