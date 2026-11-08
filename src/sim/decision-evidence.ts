import type { Action, ObservedHousehold } from '../model';

/** Public eligibility context, not a claim about a human or model's reasoning. */
export function publicDispatchContext(home: Pick<ObservedHousehold, 'communications' | 'known'>, action: Action, completion: number): string {
  if (action === 'ASSESS') return `${home.known ? 'Previously observed home' : home.communications ? 'Needs unknown' : 'Communications unavailable; needs unknown'}. On-site check expected to complete at minute ${completion}.`;
  const need = home.known?.need;
  if (!need) return 'Assistance requires an observed need.';
  return `Known ${need.urgent ? 'urgent' : 'nonurgent'} ${need.kind === 'delivery' ? 'supply' : 'transport'} need; deadline minute ${need.deadline}. ${action === 'DELIVER' ? 'Delivery' : 'Shelter arrival'} expected at minute ${completion}.`;
}
