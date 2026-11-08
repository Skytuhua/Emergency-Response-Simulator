import type { AgentArtifact, Household, Need, Scenario, ScenarioConfig } from './model';
import { createShelters, createTown, createUnits } from './content/town-v1';
import { validateArtifact } from './artifact';

export const DEFAULT_CONFIG: ScenarioConfig = { version: 1, template: 'storm-v1', seed: 42, additionalNeeds: 3, vans: 2, kits: 3, shelterA: 8, shelterB: 8, networkGap: 'southeast', roadPreset: 'open' };
const KEYS = Object.keys(DEFAULT_CONFIG).sort();
export function parseConfig(input: unknown): ScenarioConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Exercise settings must be an object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join('|') !== KEYS.join('|')) throw new Error('Exercise settings contain missing or unsupported fields.');
  if (value.version !== 1 || value.template !== 'storm-v1') throw new Error('Unsupported exercise version or storm template.');
  for (const [key, min, max] of [['seed', 0, 4294967295], ['additionalNeeds', 0, 9], ['vans', 1, 2], ['kits', 0, 6], ['shelterA', 0, 8], ['shelterB', 0, 8]] as const) {
    const field = value[key];
    if (typeof field !== 'number' || !Number.isInteger(field) || field < min || field > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  }
  if (typeof value.networkGap !== 'string' || !['none', 'northwest', 'northeast', 'southwest', 'southeast'].includes(value.networkGap)) throw new Error('Choose a supported communications gap.');
  if (value.roadPreset !== 'open' && value.roadPreset !== 'detour') throw new Error('Choose open roads or the connected detour.');
  return structuredClone(value) as unknown as ScenarioConfig;
}
function mulberry32(seed: number): () => number {
  let value = seed;
  return () => { value |= 0; value = value + 0x6D2B79F5 | 0; let result = Math.imul(value ^ value >>> 15, 1 | value); result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result; return ((result ^ result >>> 14) >>> 0) / 4294967296; };
}
export function createScenario(input: ScenarioConfig, inputArtifact: AgentArtifact | null = null): Scenario {
  const config = parseConfig(input);
  const artifact = inputArtifact ? validateArtifact(inputArtifact) : null;
  const random = mulberry32(config.seed);
  const town = createTown(config.roadPreset);
  const ordinary = town.households.filter(h => !['H02', 'H09', 'H19'].includes(h.id)).map(h => h.id);
  const data = new Map(ordinary.map(id => [id, { size: 1 + Math.floor(random() * 4), kind: random() < 0.5 ? 'delivery' as const : 'relocation' as const, urgent: random() < 0.5, reportMinute: 2 + Math.floor(random() * 9) }]));
  const candidates = [...ordinary];
  for (let index = candidates.length - 1; index > 0; index--) { const j = Math.floor(random() * (index + 1)); [candidates[index], candidates[j]] = [candidates[j], candidates[index]]; }
  if (config.seed === 42) {
    const pinned = ['H05', 'H12', 'H15']; candidates.splice(0, candidates.length, ...pinned, ...candidates.filter(id => !pinned.includes(id)));
    for (const id of pinned) { const entry = data.get(id)!; entry.kind = id === 'H15' ? 'relocation' : 'delivery'; entry.urgent = false; if (id === 'H15') entry.size = 4; }
  }
  const chosen = new Set(candidates.slice(0, config.additionalNeeds));
  const households: Household[] = town.households.map(home => {
    const fixed = ['H02', 'H09', 'H19'].includes(home.id);
    const entry = data.get(home.id);
    const kind = fixed ? home.id === 'H02' ? 'delivery' : 'relocation' : entry!.kind;
    const urgent = fixed || entry!.urgent;
    const need: Need | null = fixed || chosen.has(home.id) ? { id: `N-${home.id}`, kind, urgent, onset: 0, deadline: urgent ? 30 : 60 } : null;
    return { ...home, size: fixed ? home.id === 'H09' ? 3 : 2 : entry!.size, accessible: home.id === 'H19', need };
  });
  return {
    version: 1, generationVersion: 'mulberry32-v1', config, map: town.map, households,
    units: createUnits(config.vans), shelters: createShelters(config),
    kits: { initial: config.kits, available: config.kits, reserved: 0, consumed: 0 }, artifact,
    reports: households.filter(h => h.need).map(h => {
      const candidate = artifact?.candidates.find(c => c.householdId === h.id);
      return { id: `R-${h.id}`, householdId: h.id, needId: h.need!.id, attemptMinute: candidate ? 5 : ['H02','H09','H19'].includes(h.id) ? 10 : data.get(h.id)!.reportMinute, source: candidate ? 'mirofish' as const : 'rule-based' as const, ...(candidate ? { sourceActionId: candidate.sourceActionId } : {}) };
    }),
  };
}
