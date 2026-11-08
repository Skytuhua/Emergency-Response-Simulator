import type { GeographicRoadGraph } from '../model';
import type { GeographyBundleV2, PopulationBundleV2, SourceReceiptV2 } from './contracts';

const finite = (value: number) => Number.isFinite(value);
const nonnegativeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
const sha = /^[0-9a-f]{64}$/;
const tractCounts: Record<string, { households: number; persons: number }> = {
  '48113001502': { households: 1284, persons: 2329 },
  '48113002200': { households: 1777, persons: 2977 },
};
// Frozen complete official raw inputs. New source revisions require a new
// admitted release; an ID alone cannot inherit retained-source status.
const sourceHashes: Record<string, string> = {
  'acs2024-b11001.dat': '77200c3d9c0d99773bc7f78208bc96f25170e5d4d175a5de320620b478ceaff5',
  'acs2024-b11016.dat': '448229fa89d3190ba18f42d59a27da692898ac95f2b21fc7f27161b11f2fb501',
  'acs2024-b08201.dat': '2f64e698223ba83f97b67dde4a34961a02f230e0359ffc69b9657b89a3df6b4d',
  'acs2024-b25008.dat': 'caf0a0ed0ed04f462880589096143d9f89c2e870c0e9e75c99a993cb3bf9c751',
  'acs2024-b01001.dat': '1637b18a96881b81e050df1cd3d5ac38a33208b9b69b40e1dbeb3c4e13718f0e',
  'csv_htx.zip': '15a22511e75b24c4be7801e9948219a5facef2c459aad845df3dff5af5569f7e',
  'csv_ptx.zip': '4ea2f374dd8870daccba5d1080627ea5c84fd64e3a07633a3b9e75f27593590c',
  'tracts.json': '976085942e1e5d193c6635c26b72e8a5db08f84714b9ca63711152621c0c5ec2',
  'puma.json': '758f274e685699617193358086cb8c9ed5e1a15bc13301f4296d8da468b8537e',
  'blocks2020.json': '85ca9d184bd48d9d0f36fe638d2348413f31330dd57d65ae41a3a0cf1fd8abb7',
};

/** Even/odd membership supports multiple exteriors and polygon holes. */
export function pointInRingsV2(lon: number, lat: number, rings: [number, number][][]): boolean {
  if (!finite(lon) || !finite(lat)) return false;
  let contained = false;
  for (const ring of rings) {
    if (ring.length < 4) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (![xi, yi, xj, yj].every(finite)) return false;
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) contained = !contained;
  }
  return contained;
}

function sourceErrors(receipts: SourceReceiptV2[], required: string[], full: boolean): string[] {
  const errors: string[] = [], ids = new Set<string>();
  for (const receipt of receipts) {
    if (ids.has(receipt.id)) errors.push(`duplicate-source:${receipt.id}`);
    ids.add(receipt.id);
    if (!sha.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0 || !receipt.url || !receipt.vintage || !receipt.license || !Number.isFinite(Date.parse(receipt.retrievedAt))) errors.push(`invalid-source:${receipt.id}`);
    if (full) {
      try {
        const url = new URL(receipt.url);
        if (url.protocol !== 'https:' || !['www2.census.gov', 'tigerweb.geo.census.gov'].includes(url.hostname)) errors.push(`unapproved-source-url:${receipt.id}`);
      } catch { errors.push(`invalid-source-url:${receipt.id}`); }
    }
    if (full && required.includes(receipt.id) && (receipt.status !== 'retained' || receipt.sha256 !== sourceHashes[receipt.id])) errors.push(`unretained-release-source:${receipt.id}`);
  }
  if (full) for (const id of required) if (!ids.has(id)) errors.push(`missing-source:${id}`);
  return errors;
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180, lat = (b.lat - a.lat) * radians, lon = (b.lon - a.lon) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(lon / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pure offline admission; private raw parsing/fit is performed by tools/v2. */
export function admitDataV2(population: PopulationBundleV2, geography: GeographyBundleV2, map: GeographicRoadGraph): string[] {
  const errors: string[] = [], full = population.mode === 'full-tract';
  if (population.kind !== 'dallas-population' || population.version !== 2 || !['full-tract', 'benchmark', 'mechanics-fixture'].includes(population.mode)) errors.push('population-version');
  if (geography.kind !== 'dallas-geography' || geography.version !== 2 || geography.crs !== 'EPSG:4326' || geography.routingBufferMeters !== 500) errors.push('geography-version-or-buffer');
  errors.push(...sourceErrors(population.sourceReceipts, Object.keys(sourceHashes).filter(id => id.startsWith('acs2024-') || id.startsWith('csv_')), full));
  errors.push(...sourceErrors(geography.sourceReceipts, ['tracts.json', 'puma.json', 'blocks2020.json'], full));
  const tracts = new Map(geography.tracts.map(tract => [tract.geoid, tract]));
  if (tracts.size !== geography.tracts.length) errors.push('duplicate-tract');
  if (full && (tracts.size !== 2 || Object.keys(tractCounts).some(id => !tracts.has(id)))) errors.push('full-tract-support');
  const blocks = new Map((geography.residentialSupport ?? []).map(block => [block.id, block]));
  if (geography.residentialSupport && blocks.size !== geography.residentialSupport.length) errors.push('duplicate-residential-support');
  if (full && !blocks.size) errors.push('missing-residential-block-support');
  const nodes = new Map(map.nodes.map(node => [node.id, node]));
  const legalAccessNodes = new Set(map.edges.flatMap(edge => [edge.from, edge.to]));
  const householdIds = new Set<string>(), personIds = new Set<string>(), units = new Set<string>(), members = new Set<string>();
  const persons = new Map(population.persons.map(person => [person.id, person]));
  const actualBlocks = new Map<string, number>(), actualTracts = new Map<string, { households: number; persons: number }>();
  for (const person of population.persons) {
    if (!person.id || personIds.has(person.id)) errors.push(`duplicate-person:${person.id}`);
    personIds.add(person.id);
    if (!nonnegativeInteger(person.age) || person.age > 115 || !person.relationship || !person.sex) errors.push(`invalid-person:${person.id}`);
  }
  for (const household of population.households) {
    const { id, placement, position } = household;
    if (!id || householdIds.has(id)) errors.push(`duplicate-household:${id}`);
    householdIds.add(id);
    if (!Number.isSafeInteger(household.size) || household.size <= 0 || household.size !== household.personIds.length) errors.push(`household-size:${id}`);
    for (const member of household.personIds) {
      if (members.has(member) || persons.get(member)?.householdId !== id) errors.push(`household-membership:${id}:${member}`);
      members.add(member);
    }
    if (!Object.values(position).every(finite) || !tracts.has(household.tractGeoid) || !pointInRingsV2(position.lon, position.lat, tracts.get(household.tractGeoid)?.rings ?? [])) errors.push(`outside-tract:${id}`);
    if (!placement.unitId || units.has(placement.unitId)) errors.push(`synthetic-unit:${id}`);
    units.add(placement.unitId);
    const node = nodes.get(household.homeNodeId);
    if (!node || !legalAccessNodes.has(household.homeNodeId) || placement.accessNodeId !== household.homeNodeId || !finite(placement.distanceMeters) || placement.distanceMeters < 0 || placement.distanceMeters > 500 || !placement.capacityBasis) errors.push(`unsupported-access:${id}`);
    if (node?.lat !== undefined && node.lon !== undefined && Math.abs(distanceMeters(position, { lat: node.lat, lon: node.lon }) - placement.distanceMeters) > 1) errors.push(`access-distance:${id}`);
    const block = blocks.get(placement.supportId);
    if (full && (!block || !placement.supportId.startsWith(household.tractGeoid) || !pointInRingsV2(position.lon, position.lat, block.rings) || placement.method !== 'approximate-census-block')) errors.push(`unsupported-residential-placement:${id}`);
    actualBlocks.set(placement.supportId, (actualBlocks.get(placement.supportId) ?? 0) + 1);
    const count = actualTracts.get(household.tractGeoid) ?? { households: 0, persons: 0 };
    count.households++; count.persons += household.size; actualTracts.set(household.tractGeoid, count);
  }
  if (members.size !== population.persons.length || population.persons.some(person => !members.has(person.id) || !householdIds.has(person.householdId))) errors.push('orphan-or-duplicate-members');
  for (const block of blocks.values()) {
    if (!nonnegativeInteger(block.housingUnits2020) || block.housingUnits2020 === 0 || !nonnegativeInteger(block.allocatedHouseholds) || block.allocationMethod !== '2020-housing-unit-weighted-approximate') errors.push(`invalid-block-support:${block.id}`);
    if (full && (actualBlocks.get(block.id) ?? 0) !== block.allocatedHouseholds) errors.push(`block-allocation-accounting:${block.id}`);
  }
  if (!population.fit.converged) errors.push('fit-not-converged');
  const fitIds = new Set<string>();
  for (const control of population.fit.controls) {
    if (fitIds.has(control.id) || !nonnegativeInteger(control.target) || !nonnegativeInteger(control.achieved) || control.moe !== null && (!finite(control.moe) || control.moe < 0)) errors.push(`invalid-fit-control:${control.id}`);
    fitIds.add(control.id);
    const tract = control.id.split(':')[0], counts = actualTracts.get(tract);
    const primary = control.id.endsWith(':households') || control.id.endsWith(':occupied-persons');
    const denominator = control.id.includes('B25008') ? tractCounts[tract]?.persons : tractCounts[tract]?.households;
    const tolerance = primary ? 0 : denominator === undefined ? 0 : control.target < denominator * .02 ? 2 : Math.floor(denominator * .02);
    if (Math.abs(control.achieved - control.target) > tolerance) errors.push(`fit-tolerance:${control.id}`);
    if (control.id.endsWith(':households') && control.achieved !== counts?.households || control.id.endsWith(':occupied-persons') && control.achieved !== counts?.persons) errors.push(`fit-primary-accounting:${control.id}`);
  }
  if (full) {
    if (population.excludedGroupQuarters !== 187) errors.push('missing-derived-group-quarter-exclusion');
    for (const [tract, expected] of Object.entries(tractCounts)) {
      const actual = actualTracts.get(tract);
      if (actual?.households !== expected.households || actual.persons !== expected.persons) errors.push(`primary-tract-target:${tract}`);
      for (const field of ['households', 'occupied-persons']) if (!fitIds.has(`${tract}:${field}`)) errors.push(`missing-primary-fit-control:${tract}:${field}`);
      const leafLines: Record<string, number[]> = {
        B11001: [3,5,6,8,9], B11016: [3,4,5,6,7,8,10,11,12,13,14,15,16],
        B08201: [8,9,10,11,12,14,15,16,17,18,20,21,22,23,24,26,27,28,29,30], B25008: [2,3],
      };
      for (const [table, lines] of Object.entries(leafLines)) for (const line of lines) {
        const id = `${tract}:${table}_E${String(line).padStart(3, '0')}`;
        if (!fitIds.has(id)) errors.push(`missing-selected-fit-control:${id}`);
      }
    }
  }
  return [...new Set(errors)];
}
