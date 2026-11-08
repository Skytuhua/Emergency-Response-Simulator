import type { RoadGraph, Route } from '../model';

export function shortestPath(map: RoadGraph, from: string, to: string): Route | null {
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
