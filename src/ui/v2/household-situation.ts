import type { WorldStateV2 } from '../../v2/world';

export interface HouseholdSituationV2 {
  householdId:string;
  residentCount:number;
  communicationsAvailable:boolean;
  accessiblePlacesRequired:number;
  needs:{id:string;kind:'delivery'|'relocation';urgent:boolean;onsetMs:number;deadlineMs:number;completedAtMs:number|null;knownToTeams:boolean;cause:null}[];
}

/** Observer-only facts. Never pass this projection to a coordination policy. */
export function householdSituationV2(world:WorldStateV2,householdId:string):HouseholdSituationV2|null {
  const home=world.bundle.assets.population.households.find(item=>item.id===householdId);
  const progress=world.households.find(item=>item.id===householdId);
  if(!home||!progress)return null;
  const known=new Set(progress.known?.needs.map(need=>need.id)??[]);
  return {
    householdId,residentCount:home.size,communicationsAvailable:progress.communicationsAvailable,
    accessiblePlacesRequired:world.bundle.assets.support.find(item=>item.householdId===householdId)?.accessiblePlacesRequired??0,
    needs:world.needs.filter(need=>need.householdId===householdId&&need.onsetMs<=world.nowMs).map(need=>({
      id:need.id,kind:need.kind,urgent:need.urgent,onsetMs:need.onsetMs,deadlineMs:need.deadlineMs,
      completedAtMs:need.completedAtMs,knownToTeams:known.has(need.id),cause:null,
    })),
  };
}
