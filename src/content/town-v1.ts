import type { Household, MapNode, RoadGraph, ScenarioConfig, Shelter, Unit } from '../model';

export const BASE_NODE = 'g2-3';
export const TOWN_NAME = 'Riverdale';
export function createTown(roadPreset: ScenarioConfig['roadPreset']): { map: RoadGraph; households: Omit<Household, 'size' | 'accessible' | 'need'>[] } {
  const xs = [90, 220, 350, 480, 610, 740, 870];
  const ys = [90, 210, 330, 450, 570];
  const nodes: MapNode[] = [];
  const edges: RoadGraph['edges'] = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 7; col++) {
    const id = `g${row}-${col}`;
    nodes.push({ id, x: xs[col], y: ys[row] });
    if (col > 0) edges.push({ id: `h${row}-${col}`, from: `g${row}-${col - 1}`, to: id, minutes: 3 });
    if (row > 0) edges.push({ id: `v${row}-${col}`, from: `g${row - 1}-${col}`, to: id, minutes: 3, ...(roadPreset === 'detour' && row === 3 && col === 4 ? { closed: true } : {}) });
  }
  const neighborhoods = ['northwest', 'northeast', 'southwest', 'southeast'] as const;
  const streets = ['Cedar Lane', 'Maple Avenue', 'Willow Street', 'Oak Drive'];
  const households: Omit<Household, 'size' | 'accessible' | 'need'>[] = [];
  neighborhoods.forEach((neighborhood, quadrant) => {
    for (let local = 0; local < 6; local++) {
      const row = Math.floor(local / 3) + (quadrant >= 2 ? 3 : 0);
      const col = local % 3 + (quadrant % 2 === 1 ? 4 : 0);
      const index = quadrant * 6 + local + 1;
      const id = `H${String(index).padStart(2, '0')}`;
      households.push({ id, name: `Household ${id}`, address: `${100 + index * 7} ${streets[quadrant]}`, nodeId: `g${row}-${col}`, x: xs[col], y: ys[row], neighborhood });
    }
  });
  return { map: { width: 960, height: 660, nodes, edges }, households };
}
export function createUnits(vans: number): Unit[] {
  const unit = (id: string, name: string, kind: Unit['kind'], accessible: boolean): Unit => ({ id, name, kind, accessible, seats: kind === 'van' ? 4 : 0, nodeId: BASE_NODE, x: 480, y: 330, missionId: null, passengers: 0, busyMinutes: 0 });
  return [unit('C1', 'Response crew', 'crew', false), unit('V1', 'Accessible transport', 'van', true), ...(vans === 2 ? [unit('V2', 'General transport', 'van', false)] : [])];
}
export function createShelters(config: ScenarioConfig): Shelter[] {
  return [
    { id: 'A', name: 'East Shelter', nodeId: 'g2-5', x: 740, y: 330, accessible: true, capacity: config.shelterA, available: config.shelterA, reserved: 0, occupied: 0 },
    { id: 'B', name: 'West Shelter', nodeId: 'g2-1', x: 220, y: 330, accessible: false, capacity: config.shelterB, available: config.shelterB, reserved: 0, occupied: 0 },
  ];
}
