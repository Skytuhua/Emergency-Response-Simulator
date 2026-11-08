import type { GeographicRoadGraph } from '../model';

export const ENGINE_V2 = 'dallas-world-v2.1' as const;
export const RECIPE_V2 = 'dallas-six-hour-v2.1' as const;
export const MINUTE_MS = 60_000;
export const HORIZON_MS = 360 * MINUTE_MS;
export type Sha256 = string;
export type PopulationModeV2 = 'full-tract' | 'benchmark' | 'mechanics-fixture';
export type PolicyIdV2 = 'received-order-v2' | 'urgency-first-v2' | 'urgency-plus-coverage-v2';
export interface PositionV2 { lat: number; lon: number; x: number; y: number }
export interface SourceReceiptV2 {
  id: string; url: string; retrievedAt: string; sha256: Sha256; bytes: number;
  vintage: string; license: string; status: 'retained' | 'derived' | 'assumed'; notes?: string[];
}
export interface PersonV2 {
  id: string; householdId: string; age: number; sex: string; relationship: string;
  disability?: string | null; language?: string | null;
}
export interface HouseholdV2 {
  id: string; tractGeoid: string; size: number; personIds: string[]; homeNodeId: string; position: PositionV2;
  placement: { method: string; supportId: string; unitId: string; accessNodeId: string; distanceMeters: number; capacityBasis: string };
  vehicles?: number;
}
export interface PopulationBundleV2 {
  kind: 'dallas-population'; version: 2; mode: PopulationModeV2; seed: number;
  households: HouseholdV2[]; persons: PersonV2[]; sourceReceipts: SourceReceiptV2[];
  excludedGroupQuarters: number | null;
  fit: { method: string; converged: boolean; controls: { id: string; target: number; achieved: number; moe: number | null }[]; limitations: string[] };
}
export interface GeographyBundleV2 {
  kind: 'dallas-geography'; version: 2; crs: 'EPSG:4326'; routingBufferMeters: 500;
  tracts: { geoid: string; rings: [number, number][][] }[];
  residentialSupport?: { id: string; rings: [number, number][][]; housingUnits2020: number; allocatedHouseholds: number; allocationMethod: '2020-housing-unit-weighted-approximate' }[];
  sourceReceipts: SourceReceiptV2[]; limitations: string[];
}
export interface SupportRequirementV2 { householdId: string; accessiblePlacesRequired: number; origin: 'assumed' }
export interface NeedDefinitionV2 {
  id: string; householdId: string; kind: 'delivery' | 'relocation'; urgent: boolean; onsetMs: number; deadlineMs: number;
}
export type WorldPayloadV2 =
  | { type: 'need-onset'; need: NeedDefinitionV2 }
  | { type: 'communications-change'; householdIds: string[]; available: boolean }
  | { type: 'edge-state-change'; edgeIds: string[]; closed: boolean }
  | { type: 'facility-state-change'; facilityId: string; open: boolean };
export interface WorldEventV2 {
  id: string; effectiveAtMs: number; observedAtMs: number | null;
  sourceClass: 'observed' | 'derived' | 'assumed'; sourceRef: string; payload: WorldPayloadV2;
}
export interface FacilityV2 {
  id: string; name: string; kind: 'base' | 'shelter'; nodeId: string; position: PositionV2;
  synthetic: true; capacity: number; accessible: boolean; opensAtMs: number;
}
export interface UnitSpecificationV2 {
  id: string; kind: 'crew' | 'van'; capabilities: ('check' | 'deliver' | 'transport' | 'pickup-verification')[];
  seats: number; accessiblePlaces: number; baseNodeId: string;
}
export interface ResourceSpecificationV2 {
  units: UnitSpecificationV2[]; supplyBundles: number; depotNodeId: string;
  loadMs: number; assessmentMs: number; deliveryMs: number; boardingMs: number; dropoffMs: number;
}
export type DisasterScenarioV2 = 'storm' | 'flood' | 'tornado';
export const DISASTER_SCENARIO_RECIPE_V1 = 'dallas-hazards-v1' as const;
export interface SetupOverlayV2 {
  kind:'dallas-user-setup'; version:1;
  scenario?:DisasterScenarioV2;
  scenarioRecipe?:typeof DISASTER_SCENARIO_RECIPE_V1;
  base:null|{requested:{lat:number;lon:number};nodeId:string};
  roads:{edgeId:string;closed:boolean}[];
  resources:{crews:number;vans:number;accessibleVans:number;supplyBundles:number;shelterPlaces:{facilityId:string;places:number}[]};
}
export interface ResidentContextV2 {
  householdId: string; opportunityId: string; atMs: number; populationHash: Sha256; mapHash: Sha256; eventTapeHash: Sha256; supportHash: Sha256;
  size: number; accessiblePlacesRequired: number; communicationsAvailable: boolean; need: NeedDefinitionV2 | null;
}
export interface PersonaV2 {
  householdId: string; persona: string; age: number; profession: string; sourceResponseHash: Sha256;
  model: 'gpt-6.1-terra'; reasoningEffort: 'low'; origin: 'llm-direct';
}
export interface PreparedActionV2 {
  id: string; householdId: string; opportunityId: string; atMs: number; contextHash: Sha256;
  action: 'report' | 'wait'; text: string; sourceResponseHash: Sha256; sourceActionId: string;
  origin: 'llm-direct'; model: 'gpt-6.1-terra'; reasoningEffort: 'low';
}
export interface BehaviorArtifactV2 {
  kind: 'dallas-prepared-behavior'; version: 2; manifestHash: Sha256;
  populationHash: Sha256; mapHash: Sha256; eventTapeHash: Sha256; supportHash: Sha256;
  personas: PersonaV2[]; contexts: ResidentContextV2[]; actions: PreparedActionV2[];
  sourceCommit: string; adapterVersion: string; sourceReceipts: SourceReceiptV2[];
  preparationManifest: Record<string, unknown>;
  evidence: { id: string; kind: 'persona-response' | 'action-response' | 'upstream-action'; payload: unknown; sha256: Sha256 }[];
}
export interface ScenarioBundleV2 {
  kind: 'catastrophe-scenario'; version: 2; engineVersion: typeof ENGINE_V2; recipeVersion: typeof RECIPE_V2;
  seed: number; horizonMs: typeof HORIZON_MS; populationMode: PopulationModeV2;
  assets: {
    map: GeographicRoadGraph; geography: GeographyBundleV2; population: PopulationBundleV2;
    events: WorldEventV2[]; support: SupportRequirementV2[]; facilities: FacilityV2[]; behavior: BehaviorArtifactV2 | null;
  };
  hashes: { map: Sha256; geography: Sha256; population: Sha256; events: Sha256; support: Sha256; facilities: Sha256; behavior: Sha256 | null };
  resources: ResourceSpecificationV2;
  behaviorRules: { reportDelayMs: number; retryMs: number; reportingHouseholdIds: string[] };
  assumptions: string[];
  setup?:SetupOverlayV2;
}
export interface DirectedArcV2 { edgeId: string; fromNodeId: string; toNodeId: string }
export type CursorV2 =
  | { kind: 'node'; nodeId: string; incoming: DirectedArcV2 | null }
  | { kind: 'edge'; arc: DirectedArcV2; elapsedMs: number; durationMs: number };
export interface RoutePlanV2 { legs: (DirectedArcV2 & { durationMs: number })[]; durationMs: number; terminalIncoming: DirectedArcV2 | null }
export interface KnownNeedV2 extends NeedDefinitionV2 { completedAtMs: number | null }
export interface KnownHouseholdV2 {
  observedAtMs: number; receivedAtMs: number; size: number; accessiblePlacesRequired: number;
  needs: KnownNeedV2[]; source: 'report' | 'check'; eventIds: string[]; text: string;
}
export interface PublicHouseholdV2 {
  id: string; tractGeoid: string; homeNodeId: string; position: PositionV2;
  communicationsAvailable: boolean | null; lastContactAtMs: number | null; lastCheckAtMs: number | null;
  known: KnownHouseholdV2 | null; missionId: string | null;
}
export interface PublicUnitV2 extends UnitSpecificationV2 {
  cursor: CursorV2; position: PositionV2; missionId: string | null; passengers: number; carriedBundles: number; busyMs: number;
  status: 'available' | 'working' | 'blocked' | 'stranded';
}
export interface PublicFacilityV2 extends FacilityV2 { open: boolean; reserved: number; occupied: number; available: number }
export type MissionStatusV2 = 'loading' | 'traveling' | 'checking' | 'delivering' | 'boarding' | 'transporting' | 'dropoff' | 'completed' | 'blocked' | 'stranded';
export interface PublicMissionV2 {
  id: string; unitId: string; householdId: string; needId: string | null; action: 'check' | 'deliver' | 'transport'; shelterId?: string;
  status: MissionStatusV2; dispatchedAtMs: number; estimatedCompletionAtMs: number | null; completedAtMs: number | null;
  route: RoutePlanV2; routeLegIndex: number; stageRemainingMs: number; reason: string | null;
}
export interface TraceEventV2 {
  id: string; atMs: number; type: string; householdId?: string; needId?: string; missionId?: string; unitId?: string;
  message: string; visibility: 'coordinator' | 'resident' | 'debrief'; source: 'world-rule' | 'behavior-model' | 'llm-direct' | 'automatic-policy';
  evidenceIds?: string[];
}
export interface CoordinatorObservationV2 {
  version: 2; nowMs: number; finalized: boolean; map: GeographicRoadGraph; knownClosedEdgeIds: string[];
  households: PublicHouseholdV2[]; units: PublicUnitV2[]; facilities: PublicFacilityV2[]; missions: PublicMissionV2[];
  supply: { initial: number; depotAvailable: number; reserved: number; loaded: number; delivered: number };
  events: TraceEventV2[];
}
export interface CommandIntentV2 { action: 'check' | 'deliver' | 'transport'; unitId: string; householdId: string; needId?: string; shelterId?: string }
export interface CommandV2 extends CommandIntentV2 { id: string; sequence: number; atMs: number }
export interface CommandOutcomeV2 { command: CommandV2; accepted: boolean; reason: string; missionId?: string }
export interface DecisionEvidenceV2 {
  commandId: string; atMs: number; policy: PolicyIdV2; observationHash: Sha256; rule: string; evidenceIds: string[];
}
export interface HouseholdOutcomeV2 {
  householdId: string; size: number; contactedAtMs: number | null; checkedAtMs: number | null;
  needs: { id: string; kind: 'delivery' | 'relocation'; urgent: boolean; onsetMs: number; deadlineMs: number; completedAtMs: number | null; discovered: boolean; waitingReason: string | null }[];
}
export interface SummaryV2 {
  households: number; persons: number; needs: number; completedNeeds: number; peopleHelped: number; urgentNeeds: number; timelyUrgent: number;
  peopleWaiting: number; uncheckedHomes: number; cannotCallUncheckedHomes: number; undiscoveredNeeds: number; unmetNeedMinutes: number;
  unsupportedHouseholds: number; outcomes: HouseholdOutcomeV2[];
  behavior: { directPersonaActors: number; eligibleActors: number; directActions: number; suppressed: number; fallback: number; fallbackReasons: Record<string, number> };
}
export interface ObserverSnapshotV2 {
  runId: string; nowMs: number; finalized: boolean; population: { households: number; persons: number; mode: PopulationModeV2 };
  coordinator: CoordinatorObservationV2; residentEvents: TraceEventV2[]; personas: PersonaV2[];
  observedEvents?: TraceEventV2[];
  preparedActions: PreparedActionV2[]; summary: SummaryV2 | null;
}
