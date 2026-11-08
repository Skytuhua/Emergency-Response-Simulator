import { describe, expect, it } from 'vitest';
import { createScenario, DEFAULT_CONFIG, parseConfig } from '../src/scenario';
import { shortestPath } from '../src/sim/routes';

describe('scenario contract', () => {
  it('rejects coerced communications enums instead of silently disabling the outage', () => {
    for (const networkGap of [['southeast'], ['none'], { toString: () => 'southeast' }]) {
      expect(() => parseConfig({ ...DEFAULT_CONFIG, networkGap })).toThrow();
    }
  });
  it('rejects invalid bounds and unsupported keys', () => {
    for (const patch of [{ seed: -1 }, { seed: 2 ** 32 }, { kits: 7 }, { vans: 0 }, { additionalNeeds: 10 }, { shelterA: 9 }, { seed: Infinity }, { invented: true }, { networkGap: 'west' }]) {
      expect(() => parseConfig({ ...DEFAULT_CONFIG, ...patch })).toThrow();
    }
  });
  it('has 24 stable homes, golden distances and connected presets', () => {
    for (const roadPreset of ['open', 'detour'] as const) {
      const s = createScenario({ ...DEFAULT_CONFIG, roadPreset }, null);
      expect(s.households).toHaveLength(24);
      expect(new Set(s.households.map(h => h.id)).size).toBe(24);
      for (const h of s.households) expect(shortestPath(s.map, 'g2-3', h.nodeId)).not.toBeNull();
    }
    const s = createScenario(DEFAULT_CONFIG, null);
    expect(shortestPath(s.map, s.units[0].nodeId, 'g3-4')?.minutes).toBe(6);
    expect(shortestPath(s.map, 'g3-4', s.shelters[0].nodeId)?.minutes).toBe(6);
  });
  it('reproduces seed42 and retains needs when prefix increases', () => {
    const s = createScenario(DEFAULT_CONFIG, null);
    expect(s).toEqual(createScenario(DEFAULT_CONFIG, null));
    expect(s.households.filter(h => h.need).map(h => h.id)).toEqual(['H02', 'H05', 'H09', 'H12', 'H15', 'H19']);
    expect(s.households.find(h => h.id === 'H15')).toMatchObject({ size: 4, accessible: false, need: { kind: 'relocation', urgent: false } });
    const larger = createScenario({ ...DEFAULT_CONFIG, additionalNeeds: 5 }, null);
    for (const id of ['H05', 'H12', 'H15']) expect(larger.households.find(h => h.id === id)).toEqual(s.households.find(h => h.id === id));
    expect(createScenario({ ...DEFAULT_CONFIG, seed: 43 }, null)).not.toEqual(s);
  });
  it('shortest paths handle zero distance, disconnected nodes and deterministic ties', () => {
    const map = { width: 1, height: 1, nodes: ['a','b','c','d'].map(id => ({ id, x: 0, y: 0 })), edges: [{ id: 'ab', from: 'a', to: 'b', minutes: 1 }, { id: 'ac', from: 'a', to: 'c', minutes: 1 }, { id: 'bd', from: 'b', to: 'd', minutes: 1 }, { id: 'cd', from: 'c', to: 'd', minutes: 1 }] };
    expect(shortestPath(map, 'a', 'd')?.nodes).toEqual(['a','b','d']);
    expect(shortestPath(map, 'a', 'a')?.minutes).toBe(0);
    expect(shortestPath(map, 'a', 'missing')).toBeNull();
  });
  it('freezes the generator version, ordinary population and report schedule', () => {
    const scenario = createScenario(DEFAULT_CONFIG, null);
    expect({ version: scenario.generationVersion, population: scenario.households.map(h => [h.id, h.size]), reports: scenario.reports }).toMatchInlineSnapshot(`
      {
        "population": [
          [
            "H01",
            3,
          ],
          [
            "H02",
            2,
          ],
          [
            "H03",
            1,
          ],
          [
            "H04",
            4,
          ],
          [
            "H05",
            3,
          ],
          [
            "H06",
            3,
          ],
          [
            "H07",
            4,
          ],
          [
            "H08",
            2,
          ],
          [
            "H09",
            3,
          ],
          [
            "H10",
            3,
          ],
          [
            "H11",
            2,
          ],
          [
            "H12",
            1,
          ],
          [
            "H13",
            1,
          ],
          [
            "H14",
            3,
          ],
          [
            "H15",
            4,
          ],
          [
            "H16",
            3,
          ],
          [
            "H17",
            4,
          ],
          [
            "H18",
            1,
          ],
          [
            "H19",
            2,
          ],
          [
            "H20",
            3,
          ],
          [
            "H21",
            4,
          ],
          [
            "H22",
            3,
          ],
          [
            "H23",
            3,
          ],
          [
            "H24",
            2,
          ],
        ],
        "reports": [
          {
            "attemptMinute": 10,
            "householdId": "H02",
            "id": "R-H02",
            "needId": "N-H02",
            "source": "rule-based",
          },
          {
            "attemptMinute": 6,
            "householdId": "H05",
            "id": "R-H05",
            "needId": "N-H05",
            "source": "rule-based",
          },
          {
            "attemptMinute": 10,
            "householdId": "H09",
            "id": "R-H09",
            "needId": "N-H09",
            "source": "rule-based",
          },
          {
            "attemptMinute": 7,
            "householdId": "H12",
            "id": "R-H12",
            "needId": "N-H12",
            "source": "rule-based",
          },
          {
            "attemptMinute": 7,
            "householdId": "H15",
            "id": "R-H15",
            "needId": "N-H15",
            "source": "rule-based",
          },
          {
            "attemptMinute": 10,
            "householdId": "H19",
            "id": "R-H19",
            "needId": "N-H19",
            "source": "rule-based",
          },
        ],
        "version": "mulberry32-v1",
      }
    `);
  });
});
