import type { GeographicRoadGraph } from '../model';
import type { CursorV2, PositionV2 } from './contracts';

/** Follow the oriented polyline, never an obsolete dispatch-to-arrival interpolation. */
export function positionAtCursorV2(map: GeographicRoadGraph, cursor: CursorV2): PositionV2 {
  if (cursor.kind === 'node') {
    const node = map.nodes.find(item => item.id === cursor.nodeId);
    if (!node || node.lat === undefined || node.lon === undefined) throw new Error('V2 cursor references a missing geographic node.');
    return { x: node.x, y: node.y, lat: node.lat, lon: node.lon };
  }
  const edge = map.edges.find(item => item.id === cursor.arc.edgeId);
  if (!edge) throw new Error('V2 cursor references a missing geographic edge.');
  const points = edge.from === cursor.arc.fromNodeId ? edge.geometry : [...edge.geometry].reverse();
  const distances = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = distances.reduce((sum, distance) => sum + distance, 0) * Math.min(1, Math.max(0, cursor.elapsedMs / cursor.durationMs));
  for (let i = 0; i < distances.length; i++) {
    if (remaining <= distances[i] || i === distances.length - 1) {
      const fraction = distances[i] ? remaining / distances[i] : 0, a = points[i], b = points[i + 1];
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction,
        lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
    } remaining -= distances[i];
  }
  throw new Error('V2 geographic edge has no traversable geometry.');
}
