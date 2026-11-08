import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../fixtures/maps/dallas-streets-v1.source-manifest.json';
import { createScenario, DALLAS_DEFAULT_CONFIG } from '../src/scenario';
import { geographicDistance, shortestPath, validateGeographicGraph } from '../src/sim/routes';
import { advanceMinute, dispatch, initialize } from '../src/sim/engine';
import type { GeographicRoadGraph } from '../src/model';

describe('bundled real Dallas source data', () => {
  it('pins public source bytes and checks geometry, meters, bounds, endpoint identity, and timing', () => {
    const bytes = Buffer.from(readFileSync(new URL('../fixtures/maps/dallas-streets-v1.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.outputSha256);
    expect(bytes.length).toBe(manifest.outputBytes);
    const scenario = createScenario(DALLAS_DEFAULT_CONFIG), map = scenario.map as GeographicRoadGraph;
    expect(() => validateGeographicGraph(map)).not.toThrow();
    expect(map.edges.some(edge => edge.geometry.length > 2)).toBe(true);
    expect(map.metadata.source.rawSha256).toBe(manifest.sourceSha256);
    expect(map.metadata.datasetHash).toBe(manifest.datasetHash);
    expect(map.nodes.length).toBeLessThan(5000); expect(map.edges.length).toBeLessThan(5000);
    for (const edge of map.edges) {
      const measured = edge.geometry.slice(1).reduce((sum, point, i) => sum + geographicDistance(edge.geometry[i], point), 0);
      expect(Math.abs(measured - edge.lengthMeters)).toBeLessThan(.002);
      expect(edge.durationMs).toBe(Math.round(edge.lengthMeters / (12 / 3.6) * 1000));
    }
  });
  it('honors a real Columbia Avenue one-way and returns identical routes after array shuffling', () => {
    const map = createScenario(DALLAS_DEFAULT_CONFIG).map as GeographicRoadGraph;
    const edge = map.edges.find(e => e.osmWayId === 1037128907)!;
    expect(edge.name).toBe('Columbia Avenue'); expect(edge.direction).toBe('forward');
    const forward = shortestPath(map, edge.from, edge.to)!, reverse = shortestPath(map, edge.to, edge.from)!;
    expect(forward.legs.some(leg => leg.edgeId === edge.id)).toBe(true);
    expect(reverse).not.toBeNull();
    expect(reverse.legs.some(leg => leg.edgeId === edge.id && leg.from === edge.to)).toBe(false);
    expect(reverse.durationMs).toBeGreaterThan(forward.durationMs!);
    map.nodes.reverse(); map.edges.reverse(); map.restrictions.reverse();
    expect(shortestPath(map, edge.to, edge.from)).toEqual(reverse);
  });
  it('rejects an unreachable dispatch before reserving resources', () => {
    const scenario = createScenario(DALLAS_DEFAULT_CONFIG);
    const base = scenario.units[0].nodeId;
    scenario.map.edges.forEach(edge => { if (edge.from === base || edge.to === base) edge.closed = true; });
    let state = initialize(scenario, 'dallas-unreachable');
    while (state.minute < 10) state = advanceMinute(state);
    const before = structuredClone({ kits: state.kits, shelters: state.shelters });
    const rejected = dispatch(state, { runId: state.runId, commandId: 'blocked', sequence: 1, minute: state.minute, action: 'DELIVER', unitId: 'C1', householdId: 'H02' });
    expect(rejected.result).toEqual({ accepted: false, reason: 'No open road route is available.' });
    expect({ kits: rejected.state.kits, shelters: rejected.state.shelters }).toEqual(before);
    expect(rejected.state.missions).toHaveLength(0);
  });
});
