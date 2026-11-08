import type { GeographicRoadGraph } from '../../../src/model';
import { ENGINE_V2, HORIZON_MS, MINUTE_MS, RECIPE_V2, type ScenarioBundleV2, type WorldEventV2 } from '../../../src/v2/contracts';

/** Authored, synthetic mechanics fixture. This is not a Dallas population/map. */
export function mechanicsFixture(): ScenarioBundleV2 {
  const points = [
    { id: 'B', x: 0, y: 0 }, { id: 'H', x: 20, y: 0 },
    { id: 'X', x: 0, y: 20 }, { id: 'S', x: 40, y: 0 },
  ].map((node, index) => ({ ...node, osmNodeId: index + 1, lat: 32.79 + node.y / 100000, lon: -96.78 + node.x / 100000 }));
  const edge = (id: string, from: string, to: string, durationMs: number, way: number) => {
    const a = points.find(node => node.id === from)!, b = points.find(node => node.id === to)!;
    return { id, from, to, durationMs, minutes: durationMs / MINUTE_MS, direction: 'both' as const,
      osmWayId: way, name: id, highway: 'residential', lengthMeters: Math.hypot(b.x - a.x, b.y - a.y),
      geometry: [a, b].map(node => ({ x: node.x, y: node.y, lat: node.lat, lon: node.lon, osmNodeId: node.osmNodeId })) };
  };
  const map: GeographicRoadGraph = { kind: 'osm-driving', width: 50, height: 50, nodes: points,
    edges: [edge('BH', 'B', 'H', 2 * MINUTE_MS, 1), edge('BX', 'B', 'X', MINUTE_MS, 2),
      edge('XH', 'X', 'H', 2 * MINUTE_MS, 3), edge('HS', 'H', 'S', 2 * MINUTE_MS, 4)], restrictions: [],
    metadata: { datasetId: 'authored-mechanics-v2', datasetHash: 'a'.repeat(64), displayName: 'Authored mechanics only',
      bounds: { south: 32.78, west: -96.79, north: 32.80, east: -96.77 },
      projection: { id: 'authored', originLat: 32.79, originLon: -96.78, earthRadiusMeters: 6371008.8, metersPerUnit: 1, padding: 0 },
      source: { name: 'Authored fixture', url: 'https://example.invalid/authored-fixture', timestamp: '2026-11-08', rawSha256: 'a'.repeat(64), license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      attribution: 'Authored synthetic mechanics fixture', travelPolicy: { id: 'fixture-integer-ms', assumedSpeedKph: 1, description: 'Authored duration values; not physical Dallas travel times' },
      profile: 'mechanics-fixture', limitations: ['No geographic or population validity claim.'], baseNodeId: 'B', quadrantLabels: [] } };
  const household = (id: string, size: number) => ({ id, tractGeoid: 'FIXTURE', size,
    personIds: Array.from({ length: size }, (_, index) => `${id}-P${index + 1}`), homeNodeId: 'H',
    position: { lat: points[1].lat, lon: points[1].lon, x: 20, y: 0 },
    placement: { method: 'authored-fixture', supportId: 'fixture-building', unitId: id, accessNodeId: 'H', distanceMeters: 0, capacityBasis: 'authored distinct test unit' } });
  const households = [household('H1', 2), household('H6', 6), household('H7', 7), household('UNREACHED', 1)];
  const position = (id: string) => { const node = points.find(item => item.id === id)!; return { lat: node.lat, lon: node.lon, x: node.x, y: node.y }; };
  return { kind: 'catastrophe-scenario', version: 2, engineVersion: ENGINE_V2, recipeVersion: RECIPE_V2,
    seed: 1, horizonMs: HORIZON_MS, populationMode: 'mechanics-fixture',
    assets: { map, geography: { kind: 'dallas-geography', version: 2, crs: 'EPSG:4326', routingBufferMeters: 500, tracts: [], sourceReceipts: [], limitations: ['Authored mechanics only.'] },
      population: { kind: 'dallas-population', version: 2, mode: 'mechanics-fixture', seed: 1, households,
        persons: households.flatMap(home => home.personIds.map(id => ({ id, householdId: home.id, age: 40, sex: 'unspecified', relationship: 'authored-fixture-member' }))),
        sourceReceipts: [], excludedGroupQuarters: null, fit: { method: 'authored-fixture', converged: true, controls: [], limitations: ['Not demographic fit.'] } },
      events: [], support: households.map(home => ({ householdId: home.id, accessiblePlacesRequired: home.id === 'H6' ? 1 : 0, origin: 'assumed' })),
      facilities: [{ id: 'BASE', name: 'Synthetic base', kind: 'base', nodeId: 'B', position: position('B'), synthetic: true, capacity: 0, accessible: true, opensAtMs: 0 },
        { id: 'SHELTER', name: 'Synthetic shelter', kind: 'shelter', nodeId: 'S', position: position('S'), synthetic: true, capacity: 150, accessible: true, opensAtMs: 0 }], behavior: null },
    hashes: { map: 'a'.repeat(64), geography: 'b'.repeat(64), population: 'c'.repeat(64), events: 'd'.repeat(64), support: 'e'.repeat(64), facilities: 'f'.repeat(64), behavior: null },
    resources: { units: [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `C${index + 1}`, kind: 'crew' as const, capabilities: ['check', 'deliver'] as ('check' | 'deliver')[], seats: 0, accessiblePlaces: 0, baseNodeId: 'B' })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `V${index + 1}`, kind: 'van' as const, capabilities: ['transport', 'pickup-verification'] as ('transport' | 'pickup-verification')[], seats: 6, accessiblePlaces: index < 2 ? 1 : 0, baseNodeId: 'B' })),
    ], supplyBundles: 250, depotNodeId: 'B', loadMs: 2 * MINUTE_MS, assessmentMs: 10 * MINUTE_MS, deliveryMs: 10 * MINUTE_MS, boardingMs: 10 * MINUTE_MS, dropoffMs: 10 * MINUTE_MS },
    behaviorRules: { reportDelayMs: 20 * MINUTE_MS, retryMs: 30 * MINUTE_MS, reportingHouseholdIds: households.map(home => home.id) },
    assumptions: ['Authored mechanics fixture only.', 'One bundle per crew; two-minute synthetic base loading.'] };
}

export function needEvent(householdId = 'H1', kind: 'delivery' | 'relocation' = 'delivery', atMs = 0, id = `N-${householdId}`): WorldEventV2 {
  return { id: `onset-${id}`, effectiveAtMs: atMs, observedAtMs: null, sourceClass: 'assumed', sourceRef: 'authored-mechanics',
    payload: { type: 'need-onset', need: { id, householdId, kind, urgent: true, onsetMs: atMs, deadlineMs: atMs + 90 * MINUTE_MS } } };
}

export function changeEvent(id: string, atMs: number, payload: WorldEventV2['payload'], observedAtMs: number | null = null): WorldEventV2 {
  return { id, effectiveAtMs: atMs, observedAtMs, sourceClass: 'assumed', sourceRef: 'authored-mechanics', payload };
}
