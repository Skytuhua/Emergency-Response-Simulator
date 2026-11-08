import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import contract from '../fixtures/actor-context-dallas-v1.json';
import manifest from '../fixtures/preparation-manifest-dallas-terra-low-v1.json';
import mapBundle from '../fixtures/maps/dallas-streets-v1.json';
import legacyManifest from '../fixtures/preparation-manifest-terra-low-v1.json';
import legacyArtifact from '../public/data/mirofish-v1.json';
import legacyMini from '../public/data/mirofish-4.1-mini-v1.json';
import savedTerra from '../public/data/default-run.json';
import savedMini from '../public/data/default-run-4.1-mini-v1.json';
import { validateArtifact } from '../src/artifact';
import { parseRunFile, replay } from '../src/run-file';
import { summarize } from '../src/sim/results';

const DALLAS_INPUT = 'f1f98271f7c423fa1dc0a851c67837c228c81ddd05bfd3c992502110e1c3d20b';
const DALLAS_ACTORS = '41a8c28b2da65f9519a19e6426514a86328724021c0d0cca3f84499386fd4062';
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');

// In-memory boundary fixture; this is never provider evidence or a public artifact.
function dallasExample() {
  return { version: 1, template: 'storm-dallas-v1', sourceCommit: '7657031ac01184afe2cb220f5ee3545573b5e843',
    model: 'gpt-6.1-terra', api: 'responses', reasoningEffort: 'low', generationOutcome: 'profiles-only',
    preparationVersion: 'catastrophe-preparation-dallas-v1', timingMapVersion: 'round0-minute5-v1',
    inputHash: DALLAS_INPUT, actorContextDigest: DALLAS_ACTORS, actorContexts: structuredClone(contract.actorContexts),
    profiles: manifest.entities.map(entity => ({ householdId: entity.uuid, displayName: entity.name,
      persona: 'Synthetic test fixture, not provider evidence.', outcome: 'llm', instruction: entity.instruction })),
    candidates: [], episode: { rounds: 0, activeAgents: 0, autonomousActions: 0, seededActions: 0 }, provenance: [] };
}

describe('separately versioned Dallas preparation artifact', () => {
  it('accepts the exact Dallas Terra LOW contract and returns an independent value', () => {
    const input = dallasExample(), before = structuredClone(input);
    const artifact = validateArtifact(input);
    expect(artifact.template).toBe('storm-dallas-v1');
    expect(artifact.candidates).toEqual([]);
    expect(artifact.actorContexts.map(actor => actor.nodeId)).toEqual(['osm-n81982111', 'osm-n82064216', 'osm-n81953006']);
    expect(input).toEqual(before);
    artifact.profiles[0].persona = 'Changed copy';
    expect(input).toEqual(before);
  });

  it('pins the complete manifest, map dataset and the three frozen placement references', () => {
    expect(hash(manifest)).toBe(DALLAS_INPUT);
    expect(hash(contract.actorContexts)).toBe(DALLAS_ACTORS);
    expect(contract.mapDatasetHash).toBe('ba2017a31c639b4f26060bdd41ca575a536c3ae7080a8fa8a8ec9340c01e8ed6');
    expect(contract.mapDatasetHash).toBe(mapBundle.map.metadata.datasetHash);
    for (const actor of contract.actorContexts) {
      expect(actor.nodeId).toBe(mapBundle.placements.households.find(home => home.id === actor.householdId)!.nodeId);
    }
    expect(manifest.profiles).toEqual(legacyManifest.profiles);
    expect(manifest.social).toEqual(legacyManifest.social);
  });

  it('retains target evidence requirements for a complete autonomous Dallas request', () => {
    const input = dallasExample();
    const actor = contract.actorContexts[0];
    const candidate = { sourceActionId: 'synthetic-test-action', householdId: 'H02', needId: 'N-H02',
      factRefs: actor.factRefs, attemptMinute: 5, sourceText: 'Synthetic boundary request; not a model response.' };
    const target = { ...input, generationOutcome: 'target', candidates: [candidate],
      episode: { rounds: 1, activeAgents: 3, autonomousActions: 3, seededActions: 0 } };
    expect(validateArtifact(target).candidates).toHaveLength(1);
    expect(() => validateArtifact({ ...target, profiles: input.profiles.slice(1) })).toThrow();
    expect(() => validateArtifact({ ...target, candidates: [{ ...candidate, factRefs: ['H02.need'] }] })).toThrow();
    expect(() => validateArtifact({ ...target, episode: { ...target.episode, seededActions: 1 } })).toThrow();
    expect(() => validateArtifact({ ...target, generationOutcome: 'profiles-only' })).toThrow();
  });

  it('rejects copied cross-template identities and all Riverdale/Dallas context swaps', () => {
    const dallas = dallasExample();
    const before = structuredClone(dallas);
    for (const changes of [
      { template: 'storm-v1' }, { preparationVersion: 'catastrophe-preparation-v1' },
      { inputHash: legacyArtifact.inputHash }, { actorContextDigest: legacyArtifact.actorContextDigest },
      { actorContexts: legacyArtifact.actorContexts }, { profiles: legacyArtifact.profiles },
      { ...legacyArtifact, template: 'storm-dallas-v1', preparationVersion: dallas.preparationVersion,
        inputHash: DALLAS_INPUT, actorContextDigest: DALLAS_ACTORS },
      { template: 'storm-v1', preparationVersion: legacyArtifact.preparationVersion, inputHash: legacyArtifact.inputHash,
        actorContextDigest: legacyArtifact.actorContextDigest, profiles: legacyArtifact.profiles },
    ]) expect(() => validateArtifact({ ...dallas, ...changes })).toThrow();
    expect(dallas).toEqual(before);
  });

  it('rejects model relabeling, unsupported transport and non-LOW reasoning despite copied hashes', () => {
    const dallas = dallasExample();
    for (const changes of [
      { model: 'gpt-4.1-mini' }, { model: 'unapproved-model' }, { api: 'chat-completions' },
      { api: undefined }, { reasoningEffort: 'medium' }, { reasoningEffort: undefined },
      { inputHash: legacyMini.inputHash }, { template: ['storm-dallas-v1'] },
    ]) expect(() => validateArtifact({ ...dallas, ...changes })).toThrow();
  });

  it('rejects altered actor facts, prompts, profile evidence and unknown artifact fields', () => {
    const dallas = dallasExample();
    const changedActor = structuredClone(dallas); changedActor.actorContexts[0].size = 4;
    const changedPrompt = structuredClone(dallas); changedPrompt.profiles[0].instruction += ' changed';
    const duplicateProfile = structuredClone(dallas); duplicateProfile.profiles[1] = duplicateProfile.profiles[0];
    for (const input of [changedActor, changedPrompt, duplicateProfile,
      { ...dallas, generationOutcome: 'target' }, { ...dallas, generationOutcome: ['profiles-only'] },
      { ...dallas, profiles: dallas.profiles.map(profile => ({ ...profile, outcome: ['llm'] })) },
      { ...dallas, mapDatasetHash: contract.mapDatasetHash },
    ]) expect(() => validateArtifact(input)).toThrow();
  });

  it('still validates both retained artifacts and replays their saved Riverdale runs', () => {
    for (const [artifact, saved, model] of [[legacyArtifact, savedTerra, 'gpt-6.1-terra'], [legacyMini, savedMini, 'gpt-4.1-mini']] as const) {
      expect(validateArtifact(artifact).template).toBe('storm-v1');
      const restored = replay(parseRunFile(JSON.stringify(saved)));
      expect(restored.scenario.artifact?.model).toBe(model);
      expect(summarize(restored)).toMatchObject({ assistanceCompleted: 6, timelyUrgentCount: 3 });
    }
  });
});
