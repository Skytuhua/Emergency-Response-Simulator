import { describe, expect, it } from 'vitest';
import map from '../../fixtures/v2/maps/dallas-roads-v2.json';
import population from '../../fixtures/v2/population/dallas-population-v2.json';
import geography from '../../fixtures/v2/geography/dallas-geography-v2.json';
import facilities from '../../fixtures/v2/maps/facilities-v2.json';
import { createScenarioV2, reseedScenarioV2, sealScenarioV2 } from '../../src/v2/scenario';
import { admitScenarioV2 } from '../../src/v2/admission';
import type { ScenarioInputsV2 } from '../../src/v2/scenario';
import { hashValue } from '../../src/v2/hash';

const inputs = { map, population, geography, facilities } as unknown as ScenarioInputsV2;
describe('admitted Dallas six-hour recipe', () => {
  it('uses whole-source population and exact deterministic versioned assumptions', () => {
    const a = createScenarioV2(inputs), b = createScenarioV2(inputs);
    expect(a).toEqual(b);
    expect(a.assets.population.households).toHaveLength(3061);
    expect(a.assets.population.persons).toHaveLength(5306);
    expect(a.assets.population.households.filter(home => home.size > 6)).toHaveLength(4);
    expect(a.horizonMs).toBe(360 * 60_000);
    const needs = a.assets.events.filter(event => event.payload.type === 'need-onset');
    expect(needs).toHaveLength(306);
    expect(a.assets.support).toHaveLength(3061);
    expect(a.resources.units).toHaveLength(8);
    expect(a.resources.supplyBundles).toBe(250);
    expect(admitScenarioV2(a)).toEqual([]);
  },30_000);
  it('changes seeded events independently of iteration order and binds every asset', () => {
    const a = createScenarioV2(inputs), b = reseedScenarioV2(a, 123);
    expect(b.hashes.population).toBe(a.hashes.population);
    expect(b.hashes.events).not.toBe(a.hashes.events);
    expect(b.assets.behavior).toBeNull();
    expect(b.hashes.events).toBe(hashValue(b.assets.events));
    const changed = structuredClone(a); changed.assets.support[0].accessiblePlacesRequired = 9;
    expect(admitScenarioV2(changed).join(' ')).toMatch(/hash|support/i);
    const missing = structuredClone(a); missing.assets.support.pop();
    expect(admitScenarioV2(missing).join(' ')).toMatch(/support/i);
  },30_000);
  it('rejects edited and rehashed streets or population as source-conditioned data',()=>{
    const original=createScenarioV2(inputs);
    for(const mutate of [
      (b:typeof original)=>{b.assets.map.edges[0].durationMs=0;},
      (b:typeof original)=>{b.assets.map.restrictions=[];},
      (b:typeof original)=>{for(const h of b.assets.population.households)h.vehicles=0;},
      (b:typeof original)=>{for(const p of b.assets.population.persons)p.relationship='25';},
      (b:typeof original)=>{for(const c of b.assets.population.fit.controls){c.target=0;c.achieved=0;}},
    ]){
      const changed=structuredClone(original);mutate(changed);
      expect(admitScenarioV2(sealScenarioV2(changed)).join(' ')).toMatch(/Unapproved|Invalid|control/i);
    }
  },30_000);
});
