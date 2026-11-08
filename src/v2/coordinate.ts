import { effectiveScenarioV2 } from './setup';
import { HORIZON_MS, MINUTE_MS, type PolicyIdV2, type ScenarioBundleV2 } from './contracts';
import type { SessionV2 } from './session';
import { advanceWorld, dispatchWorld, initializeWorld, nextWorldBoundaryMs } from './world';
import { observeCoordinator } from './observe';
import { hashValue } from './hash';
import { chooseCommandV2 } from './policies';

export function coordinateSessionV2(session:SessionV2):SessionV2{
  let world=session.world;
  if(world.finalized)return session;
  const revision=world.traceSequence.coordinator;
  if(session.lastCoordinatedRevision===revision)return session;
  const decisions=[...session.decisions];
  const rejectedUnits=new Set<string>();
  for(let i=0;i<world.units.length;i++){
    if(!world.units.some(unit=>unit.status==='available'&&!unit.missionId))break;
    const view=observeCoordinator(world),choice=chooseCommandV2(view,session.policy,effectiveScenarioV2(world.bundle).resources,session.coverageFraction,rejectedUnits);
    if(!choice)break;
    if(world.commands.length>=20_000)throw new Error('V2 command bound reached.');
    const sequence=(world.commands.at(-1)?.command.sequence??0)+1;
    const id=`AUTO-V2:${sequence}`;
    const dispatched=dispatchWorld(world,{...choice.intent,id,sequence,atMs:world.nowMs});
    decisions.push({commandId:id,atMs:world.nowMs,policy:session.policy,observationHash:hashValue(view),rule:choice.rule,
      evidenceIds:[...new Set([choice.intent.householdId,choice.intent.unitId,...(choice.intent.shelterId?[choice.intent.shelterId]:[]),...choice.evidenceIds])]});
    // Enter the new mission's first zero-time stage before asking the engine
    // for its next physical boundary. Replay settles this same boundary.
    world=advanceWorld(dispatched.state,dispatched.state.nowMs);
    if(!dispatched.result.accepted)rejectedUnits.add(choice.intent.unitId);
  }
  return {...session,world,decisions,lastCoordinatedRevision:world.traceSequence.coordinator};
}
export function initializeSessionV2(bundle:ScenarioBundleV2,policy:PolicyIdV2='urgency-plus-coverage-v2',runId:string=crypto.randomUUID(),coverageFraction=.25):SessionV2{
  if(!['received-order-v2','urgency-first-v2','urgency-plus-coverage-v2'].includes(policy)||![0,.25,.5].includes(coverageFraction))throw new Error('Unsupported policy or coverage setting.');
  return coordinateSessionV2({world:initializeWorld(bundle,runId),policy,coverageFraction,decisions:[],lineage:null,ancestry:[],playbackOrigin:'fresh'});
}
/** Coordinate after every engine boundary, including fractional-minute arrivals. */
export function advanceSessionV2(session:SessionV2,targetMs=Math.min(HORIZON_MS,(Math.floor(session.world.nowMs/MINUTE_MS)+1)*MINUTE_MS)):SessionV2{
  if(!Number.isSafeInteger(targetMs)||targetMs<session.world.nowMs||targetMs>HORIZON_MS)throw new Error('Invalid session time.');
  let next=coordinateSessionV2(session);
  while(!next.world.finalized&&next.world.nowMs<targetMs){
    const boundary=nextWorldBoundaryMs(next.world,targetMs);
    next=coordinateSessionV2({...next,world:advanceWorld(next.world,boundary)});
  }
  return next;
}
export async function finishSessionV2(session:SessionV2,onProgress?:(minute:number)=>void,signal?:AbortSignal):Promise<SessionV2>{
  let next=session;
  while(!next.world.finalized){
    if(signal?.aborted)throw new Error('Simulation continuation was cancelled.');
    next=advanceSessionV2(next);onProgress?.(next.world.nowMs/MINUTE_MS);
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  return next;
}
