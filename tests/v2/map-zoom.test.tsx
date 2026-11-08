import { describe, expect, it } from 'vitest';
import roads from '../../fixtures/v2/maps/dallas-roads-v2.json';
import population from '../../fixtures/v2/population/dallas-population-v2.json';
import { mechanicsFixture } from '../../fixtures/v2/mechanics/fixture';
import { observeCoordinator } from '../../src/v2/observe';
import { initializeWorld } from '../../src/v2/world';
import type { CoordinatorObservationV2 } from '../../src/v2/contracts';
import { adaptMapV2 } from '../../src/ui/v2/map-adapter';

function observation(): CoordinatorObservationV2 {
  const value = observeCoordinator(initializeWorld(mechanicsFixture(), 'map-zoom'));
  return { ...value, map: roads as unknown as CoordinatorObservationV2['map'], households: population.households.map(home => ({
    id: home.id, tractGeoid: home.tractGeoid, homeNodeId: home.homeNodeId, position: home.position,
    communicationsAvailable: null, lastContactAtMs: null, lastCheckAtMs: null, known: null, missionId: null,
  })) };
}
const bounds = roads.metadata.bounds;

describe('public Dallas home detail follows map zoom', () => {
  it('renders the effective public base facility while retaining the source graph base identity',()=>{
    const value=observation(),original=value.map.metadata.baseNodeId,base=value.facilities.find(facility=>facility.kind==='base')!;
    base.nodeId='configured-base';base.position={lat:32.79,lon:-96.78,x:7,y:8};
    const scene=adaptMapV2(value);
    expect(scene.responseBase).toEqual({nodeId:'configured-base',x:7,y:8,label:'Response base'});
    expect(scene.view.map.metadata?.baseNodeId).toBe(original);
  });
  it('uses complete global home labels in marker text and accessible titles after viewport filtering', () => {
    const value=observation(),last=value.households.at(-1)!;
    value.households.reverse();
    const scene=adaptMapV2(value,last.id,{zoom:19,bounds});
    expect(scene.householdLabels[`household:${last.id}`]).toBe('Home 3061');
    expect(scene.householdTitles[`household:${last.id}`]).toBe('Home 3061 · Needs not yet known');
    expect(scene.householdTitles[`household:${last.id}`]).not.toContain(last.id);
    expect(scene.features.find(feature=>feature.id===`household:${last.id}`)?.householdIds).toEqual([last.id]);
  });
  it('reveals more actual individual homes at close zoom while preserving every global member', () => {
    const value = observation();
    const wide = adaptMapV2(value, null, { zoom: 13, bounds });
    const middle = adaptMapV2(value, null, { zoom: 16, bounds });
    const close = adaptMapV2(value, null, { zoom: 19, bounds });
    expect(middle.features.length).toBeGreaterThan(wide.features.length);
    expect(close.features.length).toBeGreaterThan(middle.features.length);
    expect(close.features.filter(feature => feature.kind === 'household').length).toBeGreaterThan(500);
    for (const scene of [wide, middle, close]) {
      expect(scene.totalHomes).toBe(3061);
      expect(scene.features.reduce((sum, feature) => sum + feature.homeCount, 0)).toBe(3061);
      expect(new Set(scene.features.flatMap(feature => feature.householdIds)).size).toBe(3061);
    }
    const actual = new Map(value.households.map(home => [home.id, home]));
    for (const feature of close.features.filter(feature => feature.kind === 'household')) {
      const home = actual.get(feature.householdIds[0])!;
      expect(feature.id).toBe(`household:${home.id}`);
      expect([feature.x, feature.y]).toEqual([home.position.x, home.position.y]);
    }
  });

  it('culls offscreen markers with explicit global and visible denominators and stable groups across pans', () => {
    const value = observation(), first = value.households[0].position;
    const near = { south: first.lat - .001, north: first.lat + .001, west: first.lon - .001, east: first.lon + .001 };
    const scene = adaptMapV2(value, null, { zoom: 19, bounds: near });
    const elsewhere = adaptMapV2(value, null, { zoom: 19, bounds: { south: 32.8, north: 32.802, west: -96.79, east: -96.788 } });
    expect(scene.visibleFeatures.length).toBeGreaterThan(0);
    expect(scene.visibleFeatures.length).toBeLessThan(100);
    expect(scene.view.households).toHaveLength(scene.visibleFeatures.length);
    expect(scene.visibleHomes + scene.hiddenHomes).toBe(3061);
    expect(scene.visibleHomes).toBe(scene.visibleFeatures.reduce((sum, feature) => sum + feature.homeCount, 0));
    expect(scene.hiddenHomes).toBeGreaterThan(2500);
    expect(scene.features).toEqual(elsewhere.features);
  });

  it('merges neighboring screen bins when their house markers would cover each other', () => {
    const value = observation(), scene = adaptMapV2(value, null, { zoom: 13, bounds });
    const projection = value.map.metadata.projection;
    const pixels = scene.features.map(feature => {
      const lat = projection.originLat - (feature.y-value.map.height/2)*projection.metersPerUnit/projection.earthRadiusMeters*180/Math.PI;
      const lon = projection.originLon + (feature.x-value.map.width/2)*projection.metersPerUnit/(projection.earthRadiusMeters*Math.cos(projection.originLat*Math.PI/180))*180/Math.PI;
      return { id: feature.id, x: (lon+180)/360*256*2**13, y: (1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*256*2**13 };
    });
    const covered: string[] = [];
    for(let i=0;i<pixels.length;i++)for(let j=i+1;j<pixels.length;j++) {
      if(Math.abs(pixels[i].x-pixels[j].x)<48&&Math.abs(pixels[i].y-pixels[j].y)<48)covered.push(`${pixels[i].id} / ${pixels[j].id}`);
    }
    expect(covered).toEqual([]);
    expect(scene.features.reduce((sum,feature)=>sum+feature.homeCount,0)).toBe(3061);
  });

  it('keeps a selected real home separate and never paints a mixed group as all reported', () => {
    const value = observation(), selected = value.households[0];
    value.households[1] = { ...value.households[1], known: { observedAtMs: 0, receivedAtMs: 0, size: 2, accessiblePlacesRequired: 0,
      source: 'report', eventIds: [], text: 'Known request', needs: [{ id: 'known', householdId: value.households[1].id, kind: 'delivery', urgent: true, onsetMs: 0, deadlineMs: 60_000, completedAtMs: null }] } };
    const scene = adaptMapV2(value, selected.id, { zoom: 13, bounds });
    const feature = scene.features.find(item => item.id === `household:${selected.id}`)!;
    expect(feature.householdIds).toEqual([selected.id]);
    expect([feature.x, feature.y]).toEqual([selected.position.x, selected.position.y]);
    const mixed = scene.features.find(item => item.kind === 'cluster' && item.householdIds.includes(value.households[1].id))!;
    expect(scene.view.households.find(home => home.id === mixed.id)?.status).toBe('unknown');
    expect(scene.householdTitles[mixed.id]).toContain('1 waiting for help');
    expect(scene.householdCounts[mixed.id]).toBe(mixed.homeCount);
    expect(scene.view.map.edges.filter(edge => edge.closed).map(edge => edge.id)).toEqual([]);
  });
});
