import { describe, expect, it } from 'vitest';
import type { RoadGraph } from '../src/model';
import { shortestPath, routePosition, routeLegGeometry } from '../src/sim/routes';
import frozenDallas from '../fixtures/maps/dallas-streets-v1.json';

function graph(edges: Record<string, unknown>[], restrictions: Record<string, unknown>[] = []): RoadGraph {
  return { kind: 'osm-driving', width: 100, height: 100,
    nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i * 10, y: 0, osmNodeId: i + 1, lat: 32, lon: -96 + i / 1000 })),
    edges: edges.map((edge, i) => ({ id: `e${i}`, minutes: 0.4, durationMs: 24000, lengthMeters: 100, direction: 'both', osmWayId: i + 1, name: 'Test', highway: 'residential', ...edge })), restrictions,
  } as unknown as RoadGraph;
}

describe('Dallas driving route costs and legality', () => {
  it('enforces retained Dallas distinct-way no-u-turn relation 6205001', () => {
    const route = shortestPath(frozenDallas.map as RoadGraph, 'osm-n4470318400', 'osm-n9748212388')!;
    expect(route.nodes).not.toEqual(['osm-n4470318400', 'osm-n81756938', 'osm-n9748212388']);
    expect(route.minutes).toBe(4);
  });
  it('obeys forward/reverse one-way arcs and rounds the aggregate once', () => {
    const map = graph([{ from: 'a', to: 'b', direction: 'forward' }, { from: 'b', to: 'c', direction: 'forward' }]);
    expect(shortestPath(map, 'c', 'a')).toBeNull();
    expect(shortestPath(map, 'a', 'c')).toMatchObject({ minutes: 1, durationMs: 48000, legs: [{ edgeId: 'e0' }, { edgeId: 'e1' }] });
    const reverse = graph([{ from: 'a', to: 'b', direction: 'reverse' }]);
    expect(shortestPath(reverse, 'a', 'b')).toBeNull();
    expect(shortestPath(reverse, 'b', 'a')?.minutes).toBe(1);
  });
  it('tracks incoming way for via-node turn restrictions', () => {
    const map = graph([{ from: 'a', to: 'b', direction: 'forward' }, { from: 'b', to: 'c', direction: 'forward' }, { from: 'b', to: 'd', direction: 'forward' }, { from: 'd', to: 'c', direction: 'forward' }],
      [{ id: 'r1', fromWayId: 1, toWayId: 2, viaNodeId: 'b', kind: 'no', maneuver: 'no_left_turn' }]);
    expect(shortestPath(map, 'a', 'c')?.nodes).toEqual(['a', 'b', 'd', 'c']);
    expect(shortestPath(map, 'b', 'c')?.nodes).toEqual(['b', 'c']);
    map.edges[2].closed = true;
    expect(shortestPath(map, 'a', 'c')).toBeNull();
  });
  it('keeps a same-way no-u-turn from forbidding straight travel', () => {
    const map = graph([{ from: 'a', to: 'b', osmWayId: 7 }, { from: 'b', to: 'c', osmWayId: 7 }],
      [{ id: 'r1', fromWayId: 7, toWayId: 7, viaNodeId: 'b', kind: 'no', maneuver: 'no_u_turn' }]);
    expect(shortestPath(map, 'a', 'c')?.nodes).toEqual(['a', 'b', 'c']);
  });
  it('uses stable edge identity for parallel equal-cost roads regardless of array order', () => {
    const map = graph([{ id: 'z', from: 'a', to: 'b' }, { id: 'a', from: 'a', to: 'b' }]);
    const route = shortestPath(map, 'a', 'b');
    expect(route?.legs[0]).toMatchObject({ edgeId: 'a' });
    map.edges.reverse(); map.nodes.reverse();
    expect(shortestPath(map, 'a', 'b')).toEqual(route);
  });
  it('interpolates cumulative polyline distance in both orientations and holds rounding slack', () => {
    const map = graph([{ from: 'a', to: 'b', durationMs: 36000, minutes: .6,
      geometry: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }] }]);
    Object.assign(map.nodes[0], { x: 0, y: 0 }); Object.assign(map.nodes[1], { x: 10, y: 10 });
    const forward = shortestPath(map, 'a', 'b')!, reverse = shortestPath(map, 'b', 'a')!;
    expect(routePosition(map, forward, .3)).toEqual({ x: 0, y: 10 });
    expect(routePosition(map, reverse, .15)).toEqual({ x: 5, y: 10 });
    expect(routeLegGeometry(map, reverse.legs[0])).toEqual([{ x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }]);
    expect(routePosition(map, forward, .9)).toEqual({ x: 10, y: 10 });
    expect(routePosition(map, shortestPath(map, 'a', 'a')!, 0)).toEqual({ x: 0, y: 0 });
  });
  it('applies only-turn restrictions and keeps incoming-arc states distinct', () => {
    const map = graph([{ from: 'a', to: 'b', direction: 'forward' }, { from: 'b', to: 'c', direction: 'forward' },
      { from: 'b', to: 'd', direction: 'forward' }, { from: 'a', to: 'd', direction: 'forward', durationMs: 60000 }, { from: 'd', to: 'b', direction: 'forward' }],
      [{ id: 'r1', fromWayId: 1, toWayId: 3, viaNodeId: 'b', kind: 'only', maneuver: 'only_right_turn' }]);
    expect(shortestPath(map, 'a', 'c')?.nodes).toEqual(['a', 'b', 'd', 'b', 'c']);
  });
});
