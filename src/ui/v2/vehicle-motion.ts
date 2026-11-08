import type { CoordinatorObservationV2, CursorV2, RoutePlanV2 } from '../../v2/contracts';
import { MINUTE_MS } from '../../v2/contracts';
import { positionAtCursorV2 } from '../../v2/movement';

type Leg = RoutePlanV2['legs'][number];
export interface VehicleMotionV2 { segments:{leg:Leg;startMs:number;endMs:number}[]; durationMs:number }
const sameArc=(a:{edgeId:string;fromNodeId:string;toNodeId:string},b:Leg)=>a.edgeId===b.edgeId&&a.fromNodeId===b.fromNodeId&&a.toNodeId===b.toNodeId;

/** Animate only a continuous, already-observed movement on the same route. */
export function vehicleMotionV2(previous:CoordinatorObservationV2,current:CoordinatorObservationV2,unitId:string):VehicleMotionV2|null {
  if(current.nowMs-previous.nowMs!==MINUTE_MS)return null;
  const before=previous.units.find(unit=>unit.id===unitId),after=current.units.find(unit=>unit.id===unitId);
  if(!before||!after||!before.missionId||before.missionId!==after.missionId||before.status!=='working'||after.status!=='working'||before.cursor.kind!=='edge'||after.cursor.kind!=='edge')return null;
  const a=previous.missions.find(mission=>mission.id===before.missionId),b=current.missions.find(mission=>mission.id===after.missionId);
  if(!a||!b||a.status!==b.status||!['traveling','transporting'].includes(a.status)||JSON.stringify(a.route)!==JSON.stringify(b.route)||a.routeLegIndex>b.routeLegIndex)return null;
  if(!a.route.legs[a.routeLegIndex]||!a.route.legs[b.routeLegIndex]||!sameArc(before.cursor.arc,a.route.legs[a.routeLegIndex])||!sameArc(after.cursor.arc,a.route.legs[b.routeLegIndex]))return null;
  if(current.events.some(event=>event.missionId===a.id&&event.atMs>previous.nowMs&&event.atMs<=current.nowMs&&['mission-rerouted','closure-encountered','mission-blocked','mission-stranded','stage-started'].includes(event.type)))return null;
  const segments=a.route.legs.slice(a.routeLegIndex,b.routeLegIndex+1).map((leg,index,legs)=>({leg,startMs:index===0?before.cursor.kind==='edge'?before.cursor.elapsedMs:0:0,endMs:index===legs.length-1?after.cursor.kind==='edge'?after.cursor.elapsedMs:0:leg.durationMs}));
  if(segments.some(item=>item.startMs<0||item.endMs<item.startMs||item.endMs>item.leg.durationMs))return null;
  const durationMs=segments.reduce((sum,item)=>sum+item.endMs-item.startMs,0);
  return durationMs===MINUTE_MS?{segments,durationMs}:null;
}

export function vehicleMotionPositionV2(map:CoordinatorObservationV2['map'],motion:VehicleMotionV2,fraction:number) {
  let remaining=Math.max(0,Math.min(1,fraction))*motion.durationMs;
  for(const segment of motion.segments){
    const duration=segment.endMs-segment.startMs;
    if(remaining<=duration){const cursor:CursorV2={kind:'edge',arc:segment.leg,elapsedMs:segment.startMs+remaining,durationMs:segment.leg.durationMs};return positionAtCursorV2(map,cursor);}
    remaining-=duration;
  }
  const segment=motion.segments[motion.segments.length-1];
  return positionAtCursorV2(map,{kind:'edge',arc:segment.leg,elapsedMs:segment.endMs,durationMs:segment.leg.durationMs});
}
