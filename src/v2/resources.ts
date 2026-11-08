import type { CoordinatorObservationV2 } from './contracts';
import type { WorldStateV2 } from './world';

export interface BundleReservationV2 { missionId: string; unitId: string; status: 'reserved' | 'loaded' | 'delivered' }
export interface SeatReservationV2 { missionId: string; facilityId: string; places: number; status: 'reserved' | 'occupied' }

export function supplyTotalsV2(state: WorldStateV2): CoordinatorObservationV2['supply'] {
  const initial = state.bundle.resources.supplyBundles;
  return { initial, depotAvailable: initial - state.bundleReservations.length,
    reserved: state.bundleReservations.filter(item => item.status === 'reserved').length,
    loaded: state.bundleReservations.filter(item => item.status === 'loaded').length,
    delivered: state.bundleReservations.filter(item => item.status === 'delivered').length };
}

export function facilityTotalsV2(state: WorldStateV2, facilityId: string) {
  const facility = state.bundle.assets.facilities.find(item => item.id === facilityId);
  if (!facility) throw new Error('V2 facility is missing.');
  const records = state.seatReservations.filter(item => item.facilityId === facilityId);
  const reserved = records.filter(item => item.status === 'reserved').reduce((sum, item) => sum + item.places, 0);
  const occupied = records.filter(item => item.status === 'occupied').reduce((sum, item) => sum + item.places, 0);
  return { reserved, occupied, available: facility.capacity - reserved - occupied };
}
