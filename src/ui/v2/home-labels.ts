/** Display names are local to a complete saved run. Internal identities stay intact. */
export function createHomeLabelsV2(households:readonly {id:string}[]):ReadonlyMap<string,string> {
  const ids=[...new Set(households.map(home=>home.id))].sort();
  const width=Math.max(4,String(ids.length).length);
  return new Map(ids.map((id,index)=>[id,`Home ${String(index+1).padStart(width,'0')}`]));
}

export function homeLabelV2(labels:ReadonlyMap<string,string>,id:string):string {
  return labels.get(id)??'Unknown home';
}
