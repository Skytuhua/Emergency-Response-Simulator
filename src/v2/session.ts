import type { DecisionEvidenceV2, PolicyIdV2 } from './contracts';
import type { WorldStateV2 } from './world';

export interface RunLineageV2 { sourceRunId:string; sourceSavedAtMs:number; sourceStateDigest:string }
export interface SessionV2 {
  world: WorldStateV2; policy: PolicyIdV2; coverageFraction: number;
  decisions: DecisionEvidenceV2[];
  lineage: RunLineageV2 | null;
  ancestry?: RunLineageV2[];
  playbackOrigin: 'fresh' | 'imported' | 'continued';
  lastCoordinatedRevision?: number;
}
