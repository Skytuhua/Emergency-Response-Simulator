import frozenBundle from '../../fixtures/maps/dallas-streets-v1.json';
import type { GeographicRoadGraph, Household, ScenarioConfig, Shelter, Unit } from '../model';

// This is a new immutable replay template. Dataset refreshes must use a new version.
const bundle = frozenBundle as unknown as {
  map: GeographicRoadGraph;
  placements: { baseNodeId: string; shelterANodeId: string; shelterBNodeId: string; households: Omit<Household, 'size' | 'accessible' | 'need'>[] };
  detourEdgeIds: string[];
};
export const DALLAS_BASE_NODE = bundle.placements.baseNodeId;
export const DALLAS_DETOUR_EDGE_IDS: readonly string[] = Object.freeze([...bundle.detourEdgeIds]);

export function createDallasTown(roadPreset: ScenarioConfig['roadPreset']) {
  const map = structuredClone(bundle.map);
  if (roadPreset === 'detour') for (const edge of map.edges) if (DALLAS_DETOUR_EDGE_IDS.includes(edge.id)) edge.closed = true;
  return { map, households: structuredClone(bundle.placements.households) };
}

export function createDallasUnits(vans: number): Unit[] {
  const base = bundle.map.nodes.find(node => node.id === DALLAS_BASE_NODE)!;
  const unit = (id: string, name: string, kind: Unit['kind'], accessible: boolean): Unit => ({
    id, name, kind, accessible, seats: kind === 'van' ? 4 : 0, nodeId: base.id, x: base.x, y: base.y,
    missionId: null, passengers: 0, busyMinutes: 0,
  });
  return [unit('C1', 'Response crew', 'crew', false), unit('V1', 'Accessible transport', 'van', true), ...(vans === 2 ? [unit('V2', 'General transport', 'van', false)] : [])];
}

export function createDallasShelters(config: ScenarioConfig): Shelter[] {
  const shelter = (id: string, nodeId: string, capacity: number, accessible: boolean): Shelter => {
    const node = bundle.map.nodes.find(item => item.id === nodeId)!;
    return { id, name: `Demo shelter ${id}`, nodeId, x: node.x, y: node.y, accessible, capacity, available: capacity, reserved: 0, occupied: 0 };
  };
  return [shelter('A', bundle.placements.shelterANodeId, config.shelterA, true), shelter('B', bundle.placements.shelterBNodeId, config.shelterB, false)];
}
