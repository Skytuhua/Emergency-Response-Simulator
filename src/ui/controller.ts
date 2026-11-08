import type { ObservationView } from '../model';

export function newlyDiscoveredUrgency(before: ObservationView, after: ObservationView): string | null {
  const known = new Set(before.households.filter(h => h.known?.need?.urgent).map(h => h.id));
  return after.households.find(h => h.known?.need?.urgent && h.completedAt === null && !known.has(h.id))?.id ?? null;
}
