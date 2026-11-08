import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GeographyBundleV2, PopulationBundleV2 } from '../../src/v2/contracts';
import type { GeographicRoadGraph } from '../../src/model';

const root = resolve(import.meta.dirname, '../..');
const read = <T,>(name: string): T => JSON.parse(readFileSync(resolve(root, name), 'utf8')) as T;
async function admission() {
  const path = resolve(root, 'src/v2/data-admission.ts');
  expect(existsSync(path), 'v2 data admission is missing').toBe(true);
  return import('../../src/v2/data-admission');
}
const load = () => ({
  population: read<PopulationBundleV2>('fixtures/v2/population/dallas-population-v2.json'),
  geography: read<GeographyBundleV2>('fixtures/v2/geography/dallas-geography-v2.json'),
  map: read<GeographicRoadGraph>('fixtures/v2/maps/dallas-roads-v2.json'),
});

describe('actual source-conditioned Dallas data admission', () => {
  it('admits complete whole households and exactly accounted members', async () => {
    const { admitDataV2 } = await admission(); const { population, geography, map } = load();
    expect(population.households).toHaveLength(3061);
    expect(population.persons).toHaveLength(5306);
    expect(population.excludedGroupQuarters).toBe(187);
    expect(admitDataV2(population, geography, map)).toEqual([]);
  });
  it('rejects clipped households, orphan persons and duplicate members', async () => {
    const { admitDataV2 } = await admission();
    for (const mutate of [
      (p: PopulationBundleV2) => { p.households[0].size += 1; },
      (p: PopulationBundleV2) => { p.persons[0].householdId = 'missing'; },
      (p: PopulationBundleV2) => { p.households[1].personIds.push(p.households[0].personIds[0]); p.households[1].size += 1; },
    ]) {
      const { population, geography, map } = load(); mutate(population);
      expect(admitDataV2(population, geography, map).length).toBeGreaterThan(0);
    }
  });
  it('rejects points outside exact support, absent legal access and duplicate synthetic units', async () => {
    const { admitDataV2 } = await admission();
    for (const mutate of [
      (p: PopulationBundleV2) => { p.households[0].position.lat = 33; },
      (p: PopulationBundleV2) => { p.households[0].homeNodeId = 'private-road'; },
      (p: PopulationBundleV2) => { p.households[1].placement.unitId = p.households[0].placement.unitId; },
      (p: PopulationBundleV2) => { p.households[0].placement.supportId = 'missing-block'; },
    ]) {
      const { population, geography, map } = load(); mutate(population);
      expect(admitDataV2(population, geography, map).length).toBeGreaterThan(0);
    }
  });
  it('requires full-tract source receipts, person reconciliation and declared fit tolerances', async () => {
    const { admitDataV2 } = await admission();
    for (const mutate of [
      (p: PopulationBundleV2) => { p.sourceReceipts = []; },
      (p: PopulationBundleV2) => { p.sourceReceipts[0].sha256 = 'wrong'; },
      (p: PopulationBundleV2) => { p.sourceReceipts[0].url = 'javascript:alert(1)'; },
      (p: PopulationBundleV2) => { p.excludedGroupQuarters = null; },
      (p: PopulationBundleV2) => { p.fit.controls[0].achieved += 1000; },
      (p: PopulationBundleV2) => { p.fit.converged = false; },
      (p: PopulationBundleV2) => { p.fit.controls.pop(); },
    ]) {
      const { population, geography, map } = load(); mutate(population);
      expect(admitDataV2(population, geography, map).length).toBeGreaterThan(0);
    }
  });
  it('uses polygon holes as excluded geography', async () => {
    const { pointInRingsV2 } = await admission();
    const rings: [number, number][][] = [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[2,1],[2,2],[1,2],[1,1]]];
    expect(pointInRingsV2(3,3,rings)).toBe(true);
    expect(pointInRingsV2(1.5,1.5,rings)).toBe(false);
    expect(pointInRingsV2(5,3,rings)).toBe(false);
  });
});
