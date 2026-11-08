import type { DecisionEvidenceV2, ObserverSnapshotV2, PreparedActionV2, TraceEventV2 } from '../../v2/contracts';
import { activityTextV2, activityTitleV2, directPersonasV2, homeStatusTextV2, householdEventsV2, missionStatusTextV2, policyLabelsV2, timeV2, waitingReasonTextV2 } from './ObserverV2';
import { createHomeLabelsV2, homeLabelV2 } from './home-labels';

function actionOutcome(action: PreparedActionV2, events: TraceEventV2[]): string {
  const matching = events.filter(event => event.atMs === action.atMs && (event.evidenceIds?.includes(action.id) || event.evidenceIds?.includes(action.opportunityId)));
  const direct = matching.find(event => event.type === 'resident-action' && event.source === 'llm-direct' && event.evidenceIds?.includes(action.id));
  if (matching.some(event => event.type === 'resident-action-suppressed')) return 'Skipped after help was completed';
  if (matching.some(event => event.type === 'report-received' && event.source === 'llm-direct' && event.evidenceIds?.includes(action.id))) return 'Call received';
  if (direct && matching.some(event => event.type === 'report-failed')) return 'Call blocked';
  return direct ? action.action === 'wait' ? 'Wait recorded' : 'Attempt recorded; no call received' : 'Not recorded as carried out';
}

export function SourceDetailsV2({snapshot,householdId,decisions=[],roadChangesDisableActions=false,scenarioChangesDisableActions=false}: {snapshot:ObserverSnapshotV2;householdId:string;decisions?:DecisionEvidenceV2[];roadChangesDisableActions?:boolean;scenarioChangesDisableActions?:boolean}) {
  const home=snapshot.coordinator.households.find(item=>item.id===householdId);
  const labels=createHomeLabelsV2(snapshot.coordinator.households);
  const persona=directPersonasV2(snapshot).find(item=>item.householdId===householdId);
  const actions=snapshot.preparedActions.filter(item=>item.householdId===householdId&&item.origin==='llm-direct');
  const events=householdEventsV2(snapshot,householdId);
  const commandIds=new Set(events.filter(event=>event.type==='mission-dispatched').flatMap(event=>event.evidenceIds??[]));
  const publicDecisions=decisions.filter(decision=>commandIds.has(decision.commandId)&&decision.atMs<=snapshot.nowMs);
  const missions=snapshot.coordinator.missions.filter(mission=>mission.householdId===householdId);
  if(!home)return <p>This home is not in the loaded run.</p>;
  return <div className="v2-source-details">
    <p>{persona?'Simulated home and residents. The file records an AI plan made before playback.':'Simulated household using the reporting rules.'}</p>
    <h3>{homeLabelV2(labels,home.id)}</h3>
    <h3>What teams know</h3><p>{homeStatusTextV2(home)}. {home.communicationsAvailable===false?'Unable to call.':home.communicationsAvailable===null?'Phone connection not yet known.':'Phone connection available.'}</p>
    {home.known&&<><p>{home.known.size} residents · {home.known.accessiblePlacesRequired} accessible vehicle places needed</p><p>Information received at {timeV2(home.known.receivedAtMs)} from {home.known.source==='report'?'a call for help':home.known.source==='check'?'a home check':'a recorded observation'}.</p></>}
    <h3>Resident profile</h3>
    {persona?<><p>Resident profile recorded as AI-created · {persona.age} years · {persona.profession}</p><p>{persona.model} · {persona.reasoningEffort} reasoning</p></>:<p>Simulated household. This home follows simulation rules.</p>}
    <h3>Planned actions</h3><p className="v2-muted">A plan is shown separately from what happened.</p>
    {actions.length?actions.map(action=><section key={action.id} className="v2-source-action"><h4>{action.action==='report'?'Planned call':'Planned wait'} at {timeV2(action.atMs)}</h4><p>{snapshot.nowMs<action.atMs?'Planned for later':actionOutcome(action,events)}</p></section>):<p>{scenarioChangesDisableActions?'Prepared actions are not used for this event.':roadChangesDisableActions?'Prepared actions are not used with these road changes.':'No AI actions were planned for this home.'}</p>}
    <h3>What happened</h3><ol className="v2-event-list">{events.map(event=><li key={event.id}><time>{timeV2(event.atMs)}</time><div><strong>{activityTitleV2(event)}</strong><p>{activityTextV2(event,snapshot,labels)}</p></div></li>)}</ol>{!events.length&&<p>No call or team activity has been recorded yet.</p>}
    {missions.length>0&&<><h3>Team response</h3>{missions.map(mission=><section className="v2-source-action" key={mission.id}><h4>{mission.unitId} · {missionStatusTextV2(mission.status)}</h4><p>{mission.action==='check'?'Home check':mission.action==='deliver'?'Supply delivery':'Shelter trip'} · assigned at {timeV2(mission.dispatchedAtMs)}{mission.completedAtMs!==null?` · finished at ${timeV2(mission.completedAtMs)}`:''}</p>{mission.reason&&<p>{waitingReasonTextV2(mission.reason)}</p>}</section>)}</>}
    {publicDecisions.length>0&&<><h3>How teams were chosen</h3><p>{policyLabelsV2[publicDecisions.at(-1)!.policy]}. Assignments use received calls, home checks and known road conditions.</p></>}
    <details className="v2-technical-evidence"><summary>Technical evidence</summary>
      <p>Hashes check that records match; they do not authenticate the provider.</p>
      <dl className="v2-detail-list"><div><dt>Original home ID</dt><dd>{home.id}</dd></div></dl>
      {persona&&<section><h4>Original resident profile</h4><p>{persona.persona}</p></section>}
      {persona&&<dl className="v2-detail-list"><div><dt>Profile response SHA-256</dt><dd>{persona.sourceResponseHash}</dd></div></dl>}
      {actions.map(action=><section key={action.id} className="v2-source-action"><h4>{timeV2(action.atMs)} · {action.action}</h4><dl className="v2-detail-list"><div><dt>Action / original action</dt><dd>{action.id} / {action.sourceActionId}</dd></div><div><dt>Trigger ID</dt><dd>{action.opportunityId}</dd></div><div><dt>Response SHA-256</dt><dd>{action.sourceResponseHash}</dd></div><div><dt>Local context SHA-256</dt><dd>{action.contextHash}</dd></div></dl></section>)}
      <h4>Original timeline</h4>{events.map(event=><section key={event.id}><p>{timeV2(event.atMs)} · {event.type} · {event.visibility} · {event.source} · {event.id}</p><p>{activityTextV2(event,snapshot,labels)}</p></section>)}
      {publicDecisions.map(decision=><section className="v2-source-action" key={decision.commandId}><h4>{decision.commandId} · {timeV2(decision.atMs)}</h4><p>{decision.rule}</p><dl className="v2-detail-list"><div><dt>Response approach</dt><dd>{policyLabelsV2[decision.policy]}</dd></div><div><dt>Received information SHA-256</dt><dd>{decision.observationHash}</dd></div><div><dt>Evidence IDs</dt><dd>{decision.evidenceIds.join(', ')}</dd></div></dl></section>)}
      {missions.map(mission=><section key={mission.id}><h4>{mission.id}</h4>{mission.reason&&<p>{mission.reason}</p>}<p>Route: {mission.route.legs.map(leg=>leg.edgeId).join(' → ')||'No travel legs'}.</p></section>)}
    </details>
  </div>;
}
