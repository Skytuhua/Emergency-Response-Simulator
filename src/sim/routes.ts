import type { GeographicRoadEdge, GeographicRoadGraph, RoadGraph, Route, RouteLeg } from '../model';

export function isGeographicGraph(map: RoadGraph): map is GeographicRoadGraph { return map.kind === 'osm-driving'; }

export function geographicDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validateGeographicGraph(map: GeographicRoadGraph): void {
  const fail = () => { throw new Error('The scenario contains invalid geographic street data.'); };
  const metadata = map.metadata;
  if (!metadata || !metadata.bounds || !Number.isFinite(metadata.travelPolicy?.assumedSpeedKph) || metadata.travelPolicy.assumedSpeedKph <= 0) fail();
  const { south, west, north, east } = metadata.bounds;
  if (![south, west, north, east, map.width, map.height].every(Number.isFinite) || south >= north || west >= east || map.width <= 0 || map.height <= 0) fail();
  const nodes = new Map(map.nodes.map(node => [node.id, node]));
  if (nodes.size !== map.nodes.length || new Set(map.edges.map(edge => edge.id)).size !== map.edges.length) fail();
  for (const node of map.nodes) {
    if (![node.x, node.y, node.lat, node.lon].every(value => typeof value === 'number' && Number.isFinite(value)) || !Number.isSafeInteger(node.osmNodeId) || node.osmNodeId! <= 0 || node.lat! < south || node.lat! > north || node.lon! < west || node.lon! > east) fail();
  }
  for (const edge of map.edges) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    if (!a || !b || !Number.isSafeInteger(edge.osmWayId) || edge.osmWayId <= 0 || !Number.isSafeInteger(edge.durationMs) || edge.durationMs <= 0 || !Number.isFinite(edge.lengthMeters) || edge.lengthMeters <= 0 || !Number.isFinite(edge.minutes) || Math.abs(edge.minutes - edge.durationMs / 60000) > 1e-12 || !['both', 'forward', 'reverse'].includes(edge.direction) || !Array.isArray(edge.geometry) || edge.geometry.length < 2) fail();
    const points = edge.geometry;
    for (const point of points) {
      if (![point.x, point.y, point.lat, point.lon].every(Number.isFinite) || !Number.isSafeInteger(point.osmNodeId) || point.osmNodeId <= 0 || point.lat < south || point.lat > north || point.lon < west || point.lon > east) fail();
    }
    const first = points[0], last = points.at(-1)!;
    if (first.osmNodeId !== a!.osmNodeId || last.osmNodeId !== b!.osmNodeId || first.x !== a!.x || first.y !== a!.y || last.x !== b!.x || last.y !== b!.y || first.lat !== a!.lat || first.lon !== a!.lon || last.lat !== b!.lat || last.lon !== b!.lon) fail();
    const distance = points.slice(1).reduce((sum, point, index) => sum + geographicDistance(points[index], point), 0);
    if (Math.abs(distance - edge.lengthMeters) > .002 || Math.abs(edge.durationMs - edge.lengthMeters / (metadata.travelPolicy.assumedSpeedKph / 3.6) * 1000) > .501) fail();
  }
  const ways = new Set(map.edges.map(edge => edge.osmWayId));
  if (!Array.isArray(map.restrictions) || new Set(map.restrictions.map(r => r.id)).size !== map.restrictions.length || map.restrictions.some(r => !nodes.has(r.viaNodeId) || !ways.has(r.fromWayId) || !ways.has(r.toWayId) || !['no', 'only'].includes(r.kind))) fail();
}

export function shortestPath(map: RoadGraph, from: string, to: string): Route | null {
  if (isGeographicGraph(map)) return geographicPath(map, from, to);
  const ids = new Set(map.nodes.map(n => n.id));
  if (!ids.has(from) || !ids.has(to)) return null;
  const queue: { node: string; distance: number; path: string[]; legs: Route['legs'] }[] = [{ node: from, distance: 0, path: [from], legs: [] }];
  const visited = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance || a.path.join('|').localeCompare(b.path.join('|')));
    const current = queue.shift()!;
    if (visited.has(current.node)) continue;
    visited.add(current.node);
    if (current.node === to) return { nodes: current.path, legs: current.legs, minutes: current.distance };
    for (const edge of map.edges.filter(e => !e.closed && (e.from === current.node || e.to === current.node)).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!Number.isInteger(edge.minutes) || edge.minutes <= 0) throw new Error('Road travel times must be positive integer minutes.');
      const next = edge.from === current.node ? edge.to : edge.from;
      if (ids.has(next) && !visited.has(next)) queue.push({ node: next, distance: current.distance + edge.minutes, path: [...current.path, next], legs: [...current.legs, { from: current.node, to: next, minutes: edge.minutes }] });
    }
  }
  return null;
}

interface Arc { edge: GeographicRoadEdge; from: string; to: string; id: string }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function geographicPath(map: GeographicRoadGraph, from: string, to: string): Route | null {
  const ids = new Set(map.nodes.map(node => node.id));
  if (!ids.has(from) || !ids.has(to)) return null;
  const adjacency = new Map<string, Arc[]>();
  for (const edge of map.edges) {
    if (!Number.isSafeInteger(edge.durationMs) || edge.durationMs <= 0) throw new Error('Geographic road times must be positive integer milliseconds.');
    if (edge.closed) continue;
    const add = (a: string, b: string, suffix: string) => {
      if (ids.has(a) && ids.has(b)) adjacency.set(a, [...(adjacency.get(a) ?? []), { edge, from: a, to: b, id: `${edge.id}:${suffix}` }]);
    };
    if (edge.direction === 'both' || edge.direction === 'forward') add(edge.from, edge.to, 'f');
    if (edge.direction === 'both' || edge.direction === 'reverse') add(edge.to, edge.from, 'r');
  }
  type Entry = { node: string; incoming: Arc | null; cost: number; distance: number; path: string[]; legs: RouteLeg[]; tie: string };
  const queue: Entry[] = [{ node: from, incoming: null, cost: 0, distance: 0, path: [from], legs: [], tie: '' }];
  const visited = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || compare(a.tie, b.tie));
    const current = queue.shift()!;
    const key = `${current.node}|${current.incoming?.id ?? ''}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.node === to) return { nodes: current.path, legs: current.legs, minutes: Math.ceil(current.cost / 60000), durationMs: current.cost, lengthMeters: Math.round(current.distance * 1000) / 1000 };
    for (const arc of (adjacency.get(current.node) ?? []).sort((a, b) => compare(a.id, b.id))) {
      if (current.incoming && map.restrictions.some(restriction => {
        if (restriction.viaNodeId !== current.node || restriction.fromWayId !== current.incoming!.edge.osmWayId) return false;
        const sameWay = restriction.toWayId === arc.edge.osmWayId;
        const sameWayUTurn = restriction.maneuver.endsWith('u_turn') && restriction.fromWayId === restriction.toWayId;
        const target = sameWay && (!sameWayUTurn || current.incoming!.from === arc.to);
        return restriction.kind === 'only' ? !target : target;
      })) continue;
      if (!visited.has(`${arc.to}|${arc.id}`)) queue.push({ node: arc.to, incoming: arc, cost: current.cost + arc.edge.durationMs, distance: current.distance + arc.edge.lengthMeters,
        path: [...current.path, arc.to], tie: `${current.tie}|${arc.id}`,
        legs: [...current.legs, { from: arc.from, to: arc.to, edgeId: arc.edge.id, durationMs: arc.edge.durationMs, minutes: arc.edge.durationMs / 60000 }] });
    }
  }
  return null;
}

/** The selected physical segment, oriented in this route's traversal direction. */
export function routeLegGeometry(map: RoadGraph, leg: RouteLeg): { x: number; y: number }[] {
  if (isGeographicGraph(map)) {
    const edge = map.edges.find(item => item.id === leg.edgeId);
    if (!edge || !((edge.from === leg.from && edge.to === leg.to) || (edge.to === leg.from && edge.from === leg.to))) throw new Error('Route references an invalid street segment.');
    return edge.from === leg.from ? edge.geometry : [...edge.geometry].reverse();
  }
  const a = map.nodes.find(node => node.id === leg.from), b = map.nodes.find(node => node.id === leg.to);
  return a && b ? [a, b] : [];
}

/** Movement uses fine-grained leg costs; integer arrival-rounding slack stays at the endpoint. */
export function routePosition(map: RoadGraph, route: Route, elapsedMinutes: number): { x: number; y: number } {
  let remaining = Math.max(0, elapsedMinutes);
  for (const leg of route.legs) {
    const duration = leg.durationMs === undefined ? leg.minutes : leg.durationMs / 60000;
    if (remaining <= duration) {
      const points = routeLegGeometry(map, leg);
      if (!points.length) throw new Error('Route geometry is missing.');
      if (!isGeographicGraph(map)) {
        const fraction = Math.min(1, remaining / duration);
        return { x: points[0].x + (points[1].x - points[0].x) * fraction, y: points[0].y + (points[1].y - points[0].y) * fraction };
      }
      const distances = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
      let target = distances.reduce((sum, distance) => sum + distance, 0) * Math.min(1, duration ? remaining / duration : 1);
      for (let index = 0; index < distances.length; index++) {
        const distance = distances[index];
        if (target <= distance || index === distances.length - 1) {
          const fraction = distance ? Math.min(1, target / distance) : 0;
          return { x: points[index].x + (points[index + 1].x - points[index].x) * fraction, y: points[index].y + (points[index + 1].y - points[index].y) * fraction };
        }
        target -= distance;
      }
      return points[0];
    }
    remaining -= duration;
  }
  const endpoint = map.nodes.find(node => node.id === route.nodes.at(-1));
  if (!endpoint) throw new Error('Route endpoint is missing.');
  return { x: endpoint.x, y: endpoint.y };
}
