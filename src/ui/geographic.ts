import type { ObservationView, RoadGraph } from '../model';

export type LatLng = [number, number];
export type Bounds = [LatLng, LatLng];

/** Inverse of tools/import_dallas.py's local-equirectangular-v1 projection.
 * Padding controls the importer's scale, not its origin: x/y are centred on width/2,height/2.
 */
export function xyToLatLng(map: RoadGraph, point: { x: number; y: number }): LatLng {
  const p = map.metadata!.projection;
  const degreesPerMeter = 180 / (Math.PI * p.earthRadiusMeters);
  return [
    p.originLat - (point.y - map.height / 2) * p.metersPerUnit * degreesPerMeter,
    p.originLon + (point.x - map.width / 2) * p.metersPerUnit * degreesPerMeter / Math.cos(p.originLat * Math.PI / 180),
  ];
}

export function simulationBounds(map: RoadGraph): Bounds {
  const b = map.metadata!.bounds;
  return [[b.south, b.west], [b.north, b.east]];
}

export function outageBounds(map: RoadGraph, gap: ObservationView['networkGap']): Bounds | null {
  if (gap === 'none') return null;
  const b = map.metadata!.bounds, lat = (b.north + b.south) / 2, lon = (b.west + b.east) / 2;
  return [[gap.startsWith('south') ? b.south : lat, gap.endsWith('east') ? lon : b.west],
    [gap.startsWith('south') ? lat : b.north, gap.endsWith('east') ? b.east : lon]];
}

/** Value identity survives engine snapshots and minute updates. */
export function geographicIdentity(map: RoadGraph): string {
  const m = map.metadata!;
  return JSON.stringify([m.datasetId, m.datasetHash, m.bounds, m.projection, map.width, map.height]);
}
