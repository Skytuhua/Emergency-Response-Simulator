import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import artifactData from '../public/data/mirofish-v1.json';
import preparationManifest from '../fixtures/preparation-manifest-v1.json';
import terraManifest from '../fixtures/preparation-manifest-terra-low-v1.json';
import savedDefault from '../public/data/default-run.json';
import legacyArtifact from '../public/data/mirofish-4.1-mini-v1.json';
import savedLegacy from '../public/data/default-run-4.1-mini-v1.json';
import { PREPARATION_INPUT_HASH, TERRA_PREPARATION_INPUT_HASH, validateArtifact } from '../src/artifact';
import { DEFAULT_CONFIG, createScenario } from '../src/scenario';
import { initialize, advanceMinute } from '../src/sim/engine';
import { observe } from '../src/sim/observe';
import { runDefaultWitness, summarize } from '../src/sim/results';
import { parseRunFile, replay } from '../src/run-file';

describe('approved bundled MiroFish artifact', () => {
  it('retains the original artifact bytes and replays the original saved run', () => {
    expect(createHash('sha256').update(readFileSync('public/data/mirofish-4.1-mini-v1.json', 'utf8').replace(/\r\n/g, '\n')).digest('hex')).toBe('d661847725cb4cb7f25c7ef13077cd7f8025c52d76a2ca878020cc052995f5e3');
    expect(validateArtifact(legacyArtifact).model).toBe('gpt-4.1-mini');
    const restored = replay(parseRunFile(JSON.stringify(savedLegacy)));
    expect(restored.scenario.artifact?.model).toBe('gpt-4.1-mini');
    expect(summarize(restored).assistanceCompleted).toBe(6);
    expect(summarize(restored).timelyUrgentCount).toBe(3);
  });
  it('ships a replay-validated recovery run with all six needs completed', () => {
    const summary = summarize(replay(parseRunFile(JSON.stringify(savedDefault))));
    expect(summary.assistanceCompleted).toBe(6);
    expect(summary.timelyUrgentCount).toBe(3);
  });
  it('pins the complete actual preparation contract, including prompts and social settings', () => {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, sorted(value)])) : v;
    expect(createHash('sha256').update(JSON.stringify(sorted(preparationManifest))).digest('hex')).toBe(PREPARATION_INPUT_HASH);
    expect(createHash('sha256').update(JSON.stringify(sorted(terraManifest))).digest('hex')).toBe(TERRA_PREPARATION_INPUT_HASH);
  });
  it('has genuine verified profiles and preserves default response feasibility', () => {
    const artifact = validateArtifact(artifactData);
    expect(artifact.profiles.filter(profile => profile.outcome === 'llm')).toHaveLength(3);
    const result = summarize(runDefaultWitness(createScenario(DEFAULT_CONFIG, artifact)));
    expect(result.assistanceCompleted).toBe(6);
    expect(result.timelyUrgentCount).toBe(3);
    expect(result.kitsConsumed).toBe(3);
    expect(result.shelterOccupancy).toBe(9);
  });
  it('changes only accepted social report timing and delivers canonical facts through open channels', () => {
    const artifact = validateArtifact(artifactData);
    const config = { ...DEFAULT_CONFIG, networkGap: 'none' as const };
    const prepared = createScenario(config, artifact), fallback = createScenario(config, null);
    expect(prepared.households).toEqual(fallback.households);
    for (const candidate of artifact.candidates) {
      expect(prepared.reports.find(report => report.householdId === candidate.householdId)?.attemptMinute).toBe(5);
      expect(fallback.reports.find(report => report.householdId === candidate.householdId)?.attemptMinute).toBe(10);
    }
    let state = initialize(prepared, 'approved-observation');
    for (let minute = 0; minute < 5; minute++) state = advanceMinute(state);
    for (const candidate of artifact.candidates) {
      const home = observe(state).households.find(home => home.id === candidate.householdId)!;
      expect(home.known?.source).toBe('mirofish');
      expect(home.known?.receivedAt).toBe(5);
      expect(home.known?.need?.id).toBe(candidate.needId);
      expect(home.known?.requestText).not.toBe(candidate.sourceText);
    }
  });
});
