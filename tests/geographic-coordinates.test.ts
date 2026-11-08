import { expect, it } from 'vitest';
import { createScenario, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { xyToLatLng, simulationBounds, outageBounds, geographicIdentity } from '../src/ui/geographic';

const map = createScenario(DALLAS_DEFAULT_CONFIG).map;
it('inverts the importer projection for every frozen node and geometry vertex', () => {
  for (const point of [...map.nodes, ...map.edges.flatMap(edge => edge.geometry ?? [])]) {
    const [lat, lon] = xyToLatLng(map, point);
    // The importer rounds x/y to .001 map units (under one centimetre here).
    expect(lat).toBeCloseTo(point.lat!, 7);
    expect(lon).toBeCloseTo(point.lon!, 7);
  }
  expect(xyToLatLng(map, { x: 480, y: 360 })).toEqual([32.794, -96.774]);
});
it('uses metadata bounds, keeping the southeast outage separate from the supported area', () => {
  expect(simulationBounds(map)).toEqual([[32.788, -96.784], [32.8, -96.764]]);
  expect(outageBounds(map, 'southeast')).toEqual([[32.788, -96.774], [32.794, -96.764]]);
  expect(outageBounds(map, 'none')).toBeNull();
});
it('keeps a cloned map identity stable but changes it for a new dataset or projection', () => {
  expect(geographicIdentity(map)).toBe(geographicIdentity(structuredClone(map)));
  const changed = structuredClone(map);
  changed.metadata!.projection.metersPerUnit *= 2;
  expect(geographicIdentity(changed)).not.toBe(geographicIdentity(map));
  changed.metadata!.datasetHash = 'different';
  expect(geographicIdentity(changed)).not.toBe(geographicIdentity(map));
});
