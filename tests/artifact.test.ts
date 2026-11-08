import { describe, expect, it } from 'vitest';
import { ACTOR_CONTEXTS, ACTOR_CONTEXT_DIGEST, PREPARATION_INPUT_HASH, validateArtifact } from '../src/artifact';
import type { AgentArtifact } from '../src/model';
import manifest from '../fixtures/preparation-manifest-v1.json';

function example(): AgentArtifact {
  return { version: 1, template: 'storm-v1', sourceCommit: '7657031ac01184afe2cb220f5ee3545573b5e843', model: manifest.profiles.model,
    generationOutcome: 'profiles-only', preparationVersion: 'catastrophe-preparation-v1', timingMapVersion: 'round0-minute5-v1',
    inputHash: PREPARATION_INPUT_HASH, actorContextDigest: ACTOR_CONTEXT_DIGEST, actorContexts: structuredClone(ACTOR_CONTEXTS),
    profiles: ACTOR_CONTEXTS.map(a => ({householdId:a.householdId,displayName:a.householdId,persona:'Synthetic test fixture, not evidence.',instruction:manifest.entities.find(entity => entity.uuid === a.householdId)!.instruction,outcome:'llm'})),
    candidates: [], episode:{rounds:0,activeAgents:0,autonomousActions:0,seededActions:0}, provenance:[] };
}

function terraExample() {
  return { ...example(), model: 'gpt-6.1-terra', api: 'responses', reasoningEffort: 'low',
    inputHash: '4b5c2eb1432d0146f1e5962df091f993a0a633b25778c605eabdd61c4970e00a' };
}
describe('prepared artifact boundary', () => {
  it('accepts the exact Terra-low preparation contract while retaining legacy artifacts', () => {
    expect(validateArtifact(terraExample()).model).toBe('gpt-6.1-terra');
    expect(validateArtifact(example()).model).toBe('gpt-4.1-mini');
  });
  it('rejects a relabelled legacy artifact and unsupported Terra reasoning or transport', () => {
    expect(() => validateArtifact({ ...example(), model: 'gpt-6.1-terra' })).toThrow();
    for (const changes of [{ reasoningEffort: 'medium' }, { api: 'chat-completions' }, { reasoningEffort: undefined }, { api: undefined }]) {
      expect(() => validateArtifact({ ...terraExample(), ...changes })).toThrow();
    }
    expect(() => validateArtifact({ ...example(), api: 'responses', reasoningEffort: 'low' })).toThrow();
  });
  it('rejects model and instruction tampering despite a copied complete-input hash', () => {
    expect(() => validateArtifact({ ...example(), model: 'unsupported-model' })).toThrow();
    const artifact = example(); artifact.profiles[0].instruction += ' altered';
    expect(() => validateArtifact(artifact)).toThrow();
  });
  it('rejects array-coerced integration and profile outcomes', () => {
    expect(() => validateArtifact({ ...example(), generationOutcome: ['target'], profiles: [] })).toThrow();
    const artifact = example();
    expect(() => validateArtifact({ ...artifact, profiles: artifact.profiles.map(profile => ({ ...profile, outcome: ['llm'] })) })).toThrow();
  });
  it('accepts supported profile-only contract without fabricating social success', () => {
    expect(validateArtifact(example()).candidates).toEqual([]);
  });
  it('rejects changed actor facts despite copied digest', () => {
    const a = example(); a.actorContexts[0].size = 4;
    expect(() => validateArtifact(a)).toThrow(/context/i);
  });
  it('rejects target claim lacking successful social evidence', () => {
    const a = example(); a.generationOutcome = 'target';
    expect(() => validateArtifact(a)).toThrow(/social|target/i);
  });
  it('rejects seeded actions and candidates with incomplete facts', () => {
    const a = example(); a.episode.seededActions = 1;
    expect(() => validateArtifact(a)).toThrow();
    a.episode.seededActions = 0;
    a.candidates.push({sourceActionId:'trace-1', householdId:'H02', needId:'N-H02', attemptMinute:5,sourceText:'test',factRefs:['H02.need']});
    expect(() => validateArtifact(a)).toThrow();
  });
  it('rejects unknown keys, versions, remote content, and inconsistent input identity', () => {
    expect(() => validateArtifact({...example(), url:'https://example.com'})).toThrow();
    expect(() => validateArtifact({...example(),version:2})).toThrow();
    expect(() => validateArtifact({...example(),inputHash:'0'.repeat(64)})).toThrow();
  });
});
