export const SCHEMA_VERSION = 1 as const;
export const HORIZON = 60;
export type Neighborhood = 'northwest' | 'northeast' | 'southwest' | 'southeast';
export type Action = 'ASSESS' | 'DELIVER' | 'RELOCATE';
export type NeedKind = 'delivery' | 'relocation';
export interface ScenarioConfig {
  version: 1; template: 'storm-v1'; seed: number; additionalNeeds: number;
  vans: number; kits: number; shelterA: number; shelterB: number;
  networkGap: Neighborhood | 'none'; roadPreset: 'open' | 'detour';
}
export interface MapNode { id: string; x: number; y: number }
export interface RoadEdge { id: string; from: string; to: string; minutes: number; closed?: boolean }
export interface RoadGraph { nodes: MapNode[]; edges: RoadEdge[]; width: number; height: number }
export interface Route { nodes: string[]; legs: { from: string; to: string; minutes: number }[]; minutes: number }
export interface Need { id: string; kind: NeedKind; urgent: boolean; onset: number; deadline: number }
export interface Household {
  id: string; name: string; address: string; nodeId: string; x: number; y: number;
  neighborhood: Neighborhood; size: number; accessible: boolean; need: Need | null;
}
export interface ActorContext { householdId: string; nodeId: string; size: number; accessible: boolean; needId: string; needKind: NeedKind; onset: 0; deadline: 30; factRefs: string[] }
export interface ReportCandidate {
  sourceActionId: string; householdId: string; needId: string; factRefs: string[];
  attemptMinute: 5; sourceText: string;
}
export interface AgentArtifact {
  version: 1; template: 'storm-v1'; sourceCommit: string; model: string;
  api?: 'responses'; reasoningEffort?: 'low';
  generationOutcome: 'target' | 'profiles-only' | 'blocked' | 'synthetic-test';
  preparationVersion: string; timingMapVersion: string;
  inputHash: string; actorContextDigest: string; actorContexts: ActorContext[];
  profiles: { householdId: string; displayName: string; persona: string; outcome: 'llm' | 'rule-fallback'; instruction: string }[];
  candidates: ReportCandidate[];
  episode: { rounds: number; activeAgents: number; autonomousActions: number; seededActions: number };
  provenance: { label: string; detail: string }[];
}
export interface PotentialReport { id: string; householdId: string; needId: string; attemptMinute: number; source: 'mirofish' | 'rule-based'; sourceActionId?: string }
export interface Shelter { id: string; name: string; nodeId: string; x: number; y: number; accessible: boolean; capacity: number; reserved: number; occupied: number; available: number }
export interface Unit { id: string; name: string; kind: 'crew' | 'van'; accessible: boolean; seats: number; nodeId: string; x: number; y: number; missionId: string | null; passengers: number; busyMinutes: number }
export interface KitResource { initial: number; available: number; reserved: number; consumed: number }
export interface Scenario { version: 1; generationVersion: 'mulberry32-v1'; config: ScenarioConfig; map: RoadGraph; households: Household[]; units: Unit[]; shelters: Shelter[]; kits: KitResource; reports: PotentialReport[]; artifact: AgentArtifact | null }
export interface KnownFacts { need: Need | null; size: number; accessible: boolean; consent: true; observedAt: number; receivedAt: number; source: 'assessment' | 'mirofish' | 'rule-based'; requestText: string }
export interface HouseholdProgress { householdId: string; known: KnownFacts | null; contactedAt: number | null; assessedAt: number | null; completedAt: number | null; missionId: string | null }
export interface Mission {
  id: string; action: Action; unitId: string; householdId: string; shelterId?: string;
  dispatchedAt: number; arrivalAt: number; pickupAt: number | null; completionAt: number;
  route: Route; shelterRoute: Route | null; status: 'traveling' | 'boarding' | 'transporting' | 'completed';
}
export interface CommandIntent { action: Action; unitId: string; householdId: string; shelterId?: string }
export interface Command extends CommandIntent { runId: string; commandId: string; sequence: number; minute: number }
export interface CommandResult { accepted: boolean; reason: string; missionId?: string }
export interface CommandRecord { command: Command; result: CommandResult }
export interface SimEvent { id: string; minute: number; type: 'dispatch' | 'assessment' | 'request' | 'pickup' | 'completion' | 'system'; householdId?: string; message: string; urgent?: boolean }
export interface SimState {
  runId: string; minute: number; finalized: boolean; scenario: Scenario;
  households: HouseholdProgress[]; units: Unit[]; shelters: Shelter[]; kits: KitResource;
  missions: Mission[]; commands: CommandRecord[]; events: SimEvent[];
}
export type HouseholdStatus = 'unknown' | 'reported' | 'assessed' | 'assigned' | 'assisted';
export interface ObservedHousehold {
  id: string; name: string; address: string; nodeId: string; x: number; y: number;
  neighborhood: Neighborhood; communications: boolean; status: HouseholdStatus;
  known: KnownFacts | null; contactedAt: number | null; assessedAt: number | null;
  completedAt: number | null; missionId: string | null;
}
export interface ObservationView {
  runId: string; minute: number; finalized: boolean; map: RoadGraph;
  households: ObservedHousehold[]; units: Unit[]; shelters: Shelter[]; kits: KitResource;
  missions: Mission[]; events: SimEvent[]; networkGap: ScenarioConfig['networkGap'];
  requests: ObservedHousehold[]; contactCount: number; assessedCount: number; assistedCount: number;
}
export interface HouseholdSummary { householdId: string; size: number; need: Need | null; accessible: boolean; contactedAt: number | null; assessedAt: number | null; completedAt: number | null; timely: boolean | null; undiscovered: boolean }
export interface RunSummary {
  minute: number; householdCount: number; population: number; contactCount: number; assessmentCount: number;
  contactCoverage: number; assessmentCoverage: number; timelyUrgentAssistance: number | null;
  urgentNeeds: number; timelyUrgentCount: number; unmetUrgentNeedMinutes: number;
  stillUndiscovered: number; assistanceCompleted: number; totalNeeds: number; peopleAssisted: number;
  kitsConsumed: number; shelterOccupancy: number; unitBusyMinutes: number; resourceUse: number;
  households: HouseholdSummary[]; assistedOverTime: { minute: number; people: number }[];
}
export interface RunFile { kind: 'catastrophe-response-run'; version: 1; sourceRunId: string; config: ScenarioConfig; scenario: Scenario; artifact: AgentArtifact | null; commands: CommandRecord[]; savedMinute: number; expectedSummary: RunSummary }
