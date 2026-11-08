import type { GeographicRoadEdge, GeographicRoadGraph, TurnRestriction } from '../model';
import type { DirectedArcV2, RoutePlanV2 } from './contracts';

export function compareIdsV2(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index].codePointAt(0)! - right[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return left.length - right.length;
}
interface Arc extends DirectedArcV2 { durationMs: number; wayId: number; key: string }
interface GraphIndex { nodes: Set<string>; adjacency: Map<string, Arc[]>; edges: Map<string, GeographicRoadEdge>; restrictions: Map<string, TurnRestriction[]> }
const indexes = new WeakMap<GeographicRoadGraph, GraphIndex>();

/** Static indexes exclude all hazard state. A bundle's admitted map is immutable. */
function indexGraph(map: GeographicRoadGraph): GraphIndex {
  const cached = indexes.get(map);
  if (cached) return cached;
  const index: GraphIndex = { nodes: new Set(map.nodes.map(node => node.id)), adjacency: new Map(), edges: new Map(), restrictions: new Map() };
  for (const edge of map.edges) {
    if (!Number.isSafeInteger(edge.durationMs) || edge.durationMs <= 0) throw new Error('V2 routes require positive integer millisecond edge durations.');
    index.edges.set(edge.id, edge);
    const add = (fromNodeId: string, toNodeId: string) => {
      const arc = { edgeId: edge.id, fromNodeId, toNodeId, durationMs: edge.durationMs, wayId: edge.osmWayId, key: `${edge.id}:${fromNodeId}>${toNodeId}` };
      const adjacent = index.adjacency.get(fromNodeId) ?? [];
      adjacent.push(arc); index.adjacency.set(fromNodeId, adjacent);
    };
    if (edge.direction === 'both' || edge.direction === 'forward') add(edge.from, edge.to);
    if (edge.direction === 'both' || edge.direction === 'reverse') add(edge.to, edge.from);
  }
  for (const arcs of index.adjacency.values()) arcs.sort((a, b) => compareIdsV2(a.key, b.key));
  for (const restriction of map.restrictions) {
    const key = `${restriction.viaNodeId}:${restriction.fromWayId}`;
    index.restrictions.set(key, [...(index.restrictions.get(key) ?? []), restriction]);
  }
  indexes.set(map, index); return index;
}

function legalTurn(index: GraphIndex, incoming: DirectedArcV2 | null, arc: Arc): boolean {
  if (!incoming) return true;
  const previous = index.edges.get(incoming.edgeId);
  if (!previous || incoming.toNodeId !== arc.fromNodeId) return false;
  return !(index.restrictions.get(`${arc.fromNodeId}:${previous.osmWayId}`) ?? []).some(restriction => {
    const sameWay = restriction.toWayId === arc.wayId;
    const uTurn = restriction.maneuver.endsWith('u_turn') && restriction.fromWayId === restriction.toWayId;
    const target = sameWay && (!uTurn || incoming.fromNodeId === arc.toNodeId);
    return restriction.kind === 'only' ? !target : target;
  });
}

interface SearchEntry { node: string; incoming: DirectedArcV2 | null; waypoint: number; cost: number; tie: string; parent: SearchEntry | null; leg: Arc | null }
class MinHeap {
  private entries: SearchEntry[] = [];
  private before(a: SearchEntry, b: SearchEntry) { return a.cost < b.cost || a.cost === b.cost && compareIdsV2(a.tie, b.tie) < 0; }
  push(entry: SearchEntry) {
    this.entries.push(entry); let at = this.entries.length - 1;
    while (at > 0) { const parent = (at - 1) >> 1; if (!this.before(this.entries[at], this.entries[parent])) break; [this.entries[at], this.entries[parent]] = [this.entries[parent], this.entries[at]]; at = parent; }
  }
  pop(): SearchEntry | undefined {
    const first = this.entries[0], last = this.entries.pop(); if (!this.entries.length || !last) return first;
    this.entries[0] = last; let at = 0;
    while (true) { const left = 2 * at + 1, right = left + 1; let next = at;
      if (left < this.entries.length && this.before(this.entries[left], this.entries[next])) next = left;
      if (right < this.entries.length && this.before(this.entries[right], this.entries[next])) next = right;
      if (next === at) break; [this.entries[at], this.entries[next]] = [this.entries[next], this.entries[at]]; at = next;
    } return first;
  }
}

/** One Dijkstra state includes incoming arc AND waypoint index, including across pickup. */
export function planRouteV2(map: GeographicRoadGraph, from: { nodeId: string; incoming: DirectedArcV2 | null }, waypoints: readonly string[], knownClosedEdgeIds: readonly string[] = []): RoutePlanV2 | null {
  const index = indexGraph(map), closed = new Set(knownClosedEdgeIds);
  if (!index.nodes.has(from.nodeId) || waypoints.some(node => !index.nodes.has(node))) return null;
  const queue = new MinHeap(), visited = new Set<string>();
  queue.push({ node: from.nodeId, incoming: from.incoming, waypoint: 0, cost: 0, tie: '', parent: null, leg: null });
  for (let current = queue.pop(); current; current = queue.pop()) {
    while (current.waypoint < waypoints.length && current.node === waypoints[current.waypoint]) current.waypoint++;
    const key = `${current.node}|${current.incoming ? `${current.incoming.edgeId}:${current.incoming.fromNodeId}>${current.incoming.toNodeId}` : ''}|${current.waypoint}`;
    if (visited.has(key)) continue; visited.add(key);
    if (current.waypoint === waypoints.length) {
      const legs: RoutePlanV2['legs'] = [];
      for (let entry: SearchEntry | null = current; entry?.leg; entry = entry.parent) {
        const { edgeId, fromNodeId, toNodeId, durationMs } = entry.leg;
        legs.push({ edgeId, fromNodeId, toNodeId, durationMs });
      }
      legs.reverse();
      return { legs, durationMs: current.cost, terminalIncoming: current.incoming ? { ...current.incoming } : null };
    }
    for (const arc of index.adjacency.get(current.node) ?? []) {
      if (closed.has(arc.edgeId) || !legalTurn(index, current.incoming, arc)) continue;
      queue.push({ node: arc.toNodeId, incoming: { edgeId: arc.edgeId, fromNodeId: arc.fromNodeId, toNodeId: arc.toNodeId },
        waypoint: current.waypoint, cost: current.cost + arc.durationMs, tie: `${current.tie}|${arc.key}`, parent: current, leg: arc });
    }
  }
  return null;
}
