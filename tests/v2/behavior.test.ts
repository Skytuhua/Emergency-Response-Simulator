import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/v2/behavior/authored-chain.json';
import type { NeedDefinitionV2, ScenarioBundleV2 } from '../../src/v2/contracts';
import { hashValue } from '../../src/v2/hash';
import { parseBehaviorArtifactV2, parseReportV2 } from '../../src/v2/behavior-artifact';
import { admitBehaviorV2 } from '../../src/v2/behavior-admission';
import { evaluateResidentOpportunityV2 } from '../../src/v2/behavior';

function bundle() {
  const behavior = parseBehaviorArtifactV2(fixture);
  return {
    populationMode: 'mechanics-fixture',
    assets: { behavior, population: { households: [{ id: 'synthetic-H1', size: 2 }] }, support: [{ householdId: 'synthetic-H1', accessiblePlacesRequired: 1 }], events: [
      { id: 'fixture-need', effectiveAtMs: 0, payload: { type: 'need-onset', need: behavior.contexts[0].need } },
      { id: 'fixture-offline', effectiveAtMs: 0, payload: { type: 'communications-change', householdIds: ['synthetic-H1'], available: false } },
    ] },
    hashes: { population: behavior.populationHash, map: behavior.mapHash, events: behavior.eventTapeHash, support: behavior.supportHash, behavior: hashValue(behavior) },
    behaviorRules: { reportingHouseholdIds: ['synthetic-H1'] },
  } as unknown as ScenarioBundleV2;
}

function input() {
  const { populationHash: _p, mapHash: _m, eventTapeHash: _e, supportHash: _s, ...local } = fixture.contexts[0];
  return { ...local, need: local.need as NeedDefinitionV2, completedAssistance: [] as string[] };
}

describe('prepared v2 behavior (authored chain, no provider calls)', () => {
  it('executes an exact retained action and exposes its source pointers', () => {
    const result = evaluateResidentOpportunityV2(bundle(), input());
    expect(result.action).toBe('report');
    expect(result.source).toBe('llm-direct');
    expect(result.directActions).toBe(1);
    expect(result.evidenceIds).toContain(fixture.actions[0].sourceActionId);
  });
  it('records post-assistance suppression and does not reuse it for a later need', () => {
    const local = input();
    const suppressed = evaluateResidentOpportunityV2(bundle(), { ...local, completedAssistance: [local.need!.id] });
    expect(suppressed.suppressed).toBe(true);
    expect(suppressed.directActions).toBe(0);
    expect(suppressed.action).toBe('wait');
    expect(evaluateResidentOpportunityV2(bundle(), { ...local, need: { ...local.need!, id: 'later-need' }, completedAssistance: [local.need!.id] }).suppressed).toBe(false);
  });
  it.each(['size', 'atMs', 'accessiblePlacesRequired'] as const)('uses named fallback when %s changes', key => {
    const local = input();
    const result = evaluateResidentOpportunityV2(bundle(), { ...local, [key]: local[key] + 1 });
    expect(result.origin).toBe('behavior-model-fallback');
    expect(result.fallbackReason).toBe('context-mismatch');
    expect(result.directActions).toBe(0);
  });
  it('retains a legitimate attempted report when communications are down', () => {
    const local = input();
    expect(local.communicationsAvailable).toBe(false);
    expect(evaluateResidentOpportunityV2(bundle(), local).action).toBe('report');
  });
  it('admits empty behavior and counts actual personas independently of direct actions', () => {
    const b = bundle();
    expect(admitBehaviorV2(b)).toMatchObject({ admitted: true, directPersonaActors: 1 });
    b.assets.behavior = null;
    b.hashes.behavior = null;
    expect(admitBehaviorV2(b)).toMatchObject({ admitted: true, directPersonaActors: 0 });
    expect(evaluateResidentOpportunityV2(b, input()).fallbackReason).toBe('no-prepared-artifact');
  });
  it('rejects tampered model, prompt, response, source action and context', () => {
    for (const mutate of [
      (a: typeof fixture) => { a.personas[0].model = 'other-model'; },
      (a: typeof fixture) => { a.preparationManifest.prompts[0].text += ' changed'; },
      (a: typeof fixture) => { a.evidence[0].sha256 = 'f'.repeat(64); },
      (a: typeof fixture) => { a.actions[0].sourceActionId = 'invented'; },
      (a: typeof fixture) => { a.contexts[0].size = 8; },
    ]) {
      const tampered = structuredClone(fixture); mutate(tampered);
      expect(() => parseBehaviorArtifactV2(tampered)).toThrow();
    }
  });
  it('rejects a changed bundle binding instead of weakening the context across seeds', () => {
    const b = bundle(); b.hashes.events = 'f'.repeat(64);
    expect(admitBehaviorV2(b).admitted).toBe(false);
    expect(evaluateResidentOpportunityV2(b, input()).fallbackReason).toBe('artifact-binding-mismatch');
  });
  it('rejects contexts inconsistent with actual support and local exogenous events', () => {
    for (const mutate of [
      (b: ScenarioBundleV2) => { b.assets.support[0].accessiblePlacesRequired = 0; },
      (b: ScenarioBundleV2) => { b.assets.events.pop(); },
    ]) {
      const b = bundle(); mutate(b);
      expect(admitBehaviorV2(b).admitted).toBe(false);
    }
  });
  it('does not admit the authored test source into a full tract release', () => {
    const b = bundle(); b.populationMode = 'full-tract';
    expect(admitBehaviorV2(b).admitted).toBe(false);
  });
  it('admits original bounded cohort sets and rejects duplicate cohorts', () => {
    const aggregate = structuredClone(fixture) as unknown as Record<string, unknown>;
    aggregate.preparationManifest = { kind: 'dallas-behavior-preparation-set', version: 2, manifests: [fixture.preparationManifest] };
    aggregate.manifestHash = hashValue(aggregate.preparationManifest);
    expect(parseBehaviorArtifactV2(aggregate).actions).toHaveLength(1);
    (aggregate.preparationManifest as { manifests: unknown[] }).manifests.push(fixture.preparationManifest);
    aggregate.manifestHash = hashValue(aggregate.preparationManifest);
    expect(() => parseBehaviorArtifactV2(aggregate)).toThrow();
  });
  it('rejects duplicate keys in a model-selected report', () => {
    const b = bundle();
    expect(() => parseReportV2(fixture.actions[0].text.replace('{', '{"kind":"help_request_v2",'), b.assets.behavior!.contexts[0])).toThrow();
  });
});
