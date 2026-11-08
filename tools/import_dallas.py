"""Deterministic, offline OSM -> bounded Dallas exercise graph (no network dependency).

Run: python tools/import_dallas.py --source .private/dallas-osm-source-tagged.json
The retained source is recoverable separately; this importer never fetches or refreshes it.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import heapq
import json
import math
from pathlib import Path

BOUNDS = {'south': 32.788, 'west': -96.784, 'north': 32.800, 'east': -96.764}
RADIUS = 6371008.8
SPEED_KPH = 12
SOURCE_SHA256 = '3619ab590a4065af70488ce71470d29bd044aeed87cd4bcf35fa3e61d10a3b35'
PROFILE = 'bounded-public-local-motorcar-v1'
ALLOWED_HIGHWAYS = {'residential', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'living_street'}
ACCESS_MODES = ('motorcar', 'motor_vehicle', 'vehicle', 'access')
ALLOWED_ACCESS = {'yes', 'designated', 'permissive'}
MANEUVERS = {'no_left_turn', 'no_right_turn', 'no_straight_on', 'no_u_turn', 'only_left_turn', 'only_right_turn', 'only_straight_on', 'only_u_turn', 'no_entry', 'no_exit'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def haversine(a, b):
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    dlat = lat2 - lat1
    dlon = math.radians(b['lon'] - a['lon'])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * RADIUS * math.asin(min(1, math.sqrt(h)))


def permitted(tags, direction=None):
    for mode in ACCESS_MODES:
        keys = [f'{mode}:{direction}', mode] if direction else [mode]
        for key in keys:
            if key in tags:
                return tags[key] in ALLOWED_ACCESS
    return True


def import_graph(payload, bounds=BOUNDS):
    """Normalize topology first; return all bounded components plus exclusion evidence."""
    unique = {}
    for element in payload['elements']:
        key = (element['type'], element['id'])
        previous = unique.get(key, {})
        if any(previous[field] != value for field, value in element.items() if field in previous):
            raise ValueError(f'Conflicting duplicate OSM object: {key}')
        unique[key] = {**previous, **element}
    elements = sorted(unique.values(), key=lambda e: (e['type'], e['id']))
    source_nodes = {e['id']: e for e in elements if e['type'] == 'node'}
    excluded = defaultdict(list)
    excluded_nodes = defaultdict(set)
    unsupported, inapplicable, restrictions = [], [], []
    prohibited_ways = set()
    for relation in (e for e in elements if e['type'] == 'relation' and e.get('tags', {}).get('type') == 'restriction'):
        tags = relation['tags']
        maneuver = next((tags[key] for key in ('restriction:motorcar', 'restriction:motor_vehicle', 'restriction:vehicle', 'restriction') if key in tags), None)
        has_applicable_conditional = any(key in tags for key in ('restriction:conditional', 'restriction:motorcar:conditional', 'restriction:motor_vehicle:conditional', 'restriction:vehicle:conditional'))
        if (maneuver is None and not has_applicable_conditional) or set(tags.get('except', '').split(';')) & {'motorcar', 'motor_vehicle', 'vehicle'}:
            inapplicable.append(relation['id'])
            continue
        members = relation.get('members', [])
        froms = [m for m in members if m['role'] == 'from' and m['type'] == 'way']
        tos = [m for m in members if m['role'] == 'to' and m['type'] == 'way']
        vias = [m for m in members if m['role'] == 'via']
        if (maneuver not in MANEUVERS or len(froms) != 1 or len(tos) != 1 or len(vias) != 1 or vias[0]['type'] != 'node'
                or any('conditional' in key for key in tags)):
            unsupported.append(relation['id'])
            prohibited_ways.update(m['ref'] for m in members if m['type'] == 'way')
            continue
        restrictions.append({'id': f"osm-r{relation['id']}", 'fromWayId': froms[0]['ref'], 'toWayId': tos[0]['ref'],
                             'viaNodeId': f"osm-n{vias[0]['ref']}", 'kind': 'only' if maneuver.startswith('only_') else 'no', 'maneuver': maneuver})
    lat0 = (bounds['south'] + bounds['north']) / 2
    lon0 = (bounds['west'] + bounds['east']) / 2
    width_m = RADIUS * math.cos(math.radians(lat0)) * math.radians(bounds['east'] - bounds['west'])
    height_m = RADIUS * math.radians(bounds['north'] - bounds['south'])
    scale = min(864 / width_m, 624 / height_m)

    def point(ref):
        source = source_nodes[ref]
        return {'x': round(480 + RADIUS * math.cos(math.radians(lat0)) * math.radians(source['lon'] - lon0) * scale, 3),
                'y': round(360 - RADIUS * math.radians(source['lat'] - lat0) * scale, 3),
                'lat': source['lat'], 'lon': source['lon'], 'osmNodeId': ref}

    def usable(ref):
        source = source_nodes.get(ref)
        if source is None or not (bounds['south'] <= source['lat'] <= bounds['north'] and bounds['west'] <= source['lon'] <= bounds['east']):
            return False
        tags = source.get('tags', {})
        reason = None
        if any(key.split(':')[0] in ACCESS_MODES and any(part in key.split(':') for part in ('conditional', 'forward', 'backward')) for key in tags):
            reason = 'conditional-or-directional-node-access-fail-closed'
        elif not permitted(tags):
            reason = 'restricted-motorcar-access'
        elif tags.get('locked') == 'yes':
            reason = 'locked-barrier'
        elif tags.get('barrier') not in (None, 'no', 'entrance', 'cattle_grid') and not any(tags.get(mode) in ALLOWED_ACCESS for mode in ACCESS_MODES):
            reason = 'blocking-barrier'
        if reason:
            excluded_nodes[reason].add(ref)
        return reason is None

    chains = []
    for way in (e for e in elements if e['type'] == 'way'):
        tags = way.get('tags', {})
        reason = None
        if way['id'] in prohibited_ways:
            reason = 'unsupported-restriction-fail-closed'
        elif tags.get('highway') not in ALLOWED_HIGHWAYS:
            reason = 'outside-local-driving-profile'
        elif any('conditional' in key and (key.split(':')[0] in ACCESS_MODES or key.startswith('oneway')) for key in tags):
            reason = 'conditional-access-fail-closed'
        elif any(key in tags for key in ('oneway:forward', 'oneway:backward')):
            reason = 'unsupported-directional-oneway-fail-closed'
        elif tags.get('area') == 'yes' or tags.get('construction') or tags.get('proposed') or tags.get('impassable') == 'yes':
            reason = 'non-road-or-unavailable'
        oneway = next((tags[key] for key in ('oneway:motorcar', 'oneway:motor_vehicle', 'oneway:vehicle', 'oneway') if key in tags), 'yes' if tags.get('junction') == 'roundabout' else 'no')
        if not reason and oneway not in ('yes', '1', 'true', '-1', 'no', '0', 'false'):
            reason = 'unsupported-oneway-fail-closed'
        forward = permitted(tags, 'forward') and oneway != '-1'
        reverse = permitted(tags, 'backward') and oneway in ('no', '0', 'false', '-1')
        if not reason and not (forward or reverse):
            reason = 'restricted-motorcar-access'
        if reason:
            excluded[reason].append(way['id'])
            continue
        direction = 'both' if forward and reverse else 'forward' if forward else 'reverse'
        chain = []
        for ref in way['nodes']:
            if usable(ref):
                chain.append(ref)
            else:
                if len(chain) > 1:
                    chains.append((way, direction, chain))
                chain = []
        if len(chain) > 1:
            chains.append((way, direction, chain))
    occurrences = Counter(ref for _, _, chain in chains for ref in chain)
    split_nodes = {ref for ref, count in occurrences.items() if count > 1}
    split_nodes.update(int(r['viaNodeId'][5:]) for r in restrictions)
    split_nodes.update(ref for _, _, chain in chains for ref in (chain[0], chain[-1]))
    edges = []
    for way, direction, chain in chains:
        start = 0
        for end in range(1, len(chain)):
            if chain[end] not in split_nodes:
                continue
            refs = chain[start:end + 1]
            geometry = [point(ref) for ref in refs]
            length = round(sum(haversine(a, b) for a, b in zip(geometry, geometry[1:])), 3)
            if length > 0:
                duration = max(1, math.floor(length / (SPEED_KPH / 3.6) * 1000 + 0.5))
                # Original-node endpoints keep IDs stable across input ordering; chain index distinguishes repeated segments.
                edges.append({'id': f"osm-w{way['id']}-n{refs[0]}-n{refs[-1]}-i{way['nodes'].index(refs[0])}",
                              'from': f'osm-n{refs[0]}', 'to': f'osm-n{refs[-1]}', 'minutes': duration / 60000,
                              'durationMs': duration, 'lengthMeters': length, 'direction': direction,
                              'osmWayId': way['id'], 'name': way.get('tags', {}).get('name', 'Unnamed public street'),
                              'highway': way['tags']['highway'], 'geometry': geometry})
            start = end
    edges.sort(key=lambda e: e['id'])
    node_refs = sorted({int(edge[key][5:]) for edge in edges for key in ('from', 'to')})
    nodes = [{'id': f'osm-n{ref}', **point(ref)} for ref in node_refs]
    way_ids = {edge['osmWayId'] for edge in edges}
    node_ids = {node['id'] for node in nodes}
    restrictions = [r for r in restrictions if r['fromWayId'] in way_ids and r['toWayId'] in way_ids and r['viaNodeId'] in node_ids]
    stats = {'excludedWays': dict(sorted(excluded.items())), 'excludedNodes': {reason: sorted(refs) for reason, refs in sorted(excluded_nodes.items())},
             'unsupportedRestrictionIds': unsupported, 'inapplicableRestrictionIds': inapplicable,
             'sourceDuplicateObjectsMerged': len(payload['elements']) - len(elements),
             'normalizedNodes': len(nodes), 'normalizedEdges': len(edges), 'normalizedRestrictions': len(restrictions)}
    return {'kind': 'osm-driving', 'width': 960, 'height': 720, 'nodes': nodes, 'edges': edges, 'restrictions': restrictions,
            'projection': {'id': 'local-equirectangular-v1', 'originLat': lat0, 'originLon': lon0, 'earthRadiusMeters': RADIUS, 'metersPerUnit': 1 / scale, 'padding': 48}}, stats


def largest_driving_component(graph):
    """Largest strongly connected component; roads crossing the bbox are never fabricated/clipped."""
    adjacency, reverse = defaultdict(set), defaultdict(set)
    for edge in graph['edges']:
        arcs = [(edge['from'], edge['to'])] if edge['direction'] == 'forward' else [(edge['to'], edge['from'])] if edge['direction'] == 'reverse' else [(edge['from'], edge['to']), (edge['to'], edge['from'])]
        for a, b in arcs:
            adjacency[a].add(b)
            reverse[b].add(a)
    visited, order = set(), []

    def visit(node):
        visited.add(node)
        for nxt in sorted(adjacency[node]):
            if nxt not in visited:
                visit(nxt)
        order.append(node)

    for node in sorted(adjacency):
        if node not in visited:
            visit(node)
    visited, components = set(), []
    for node in reversed(order):
        if node in visited:
            continue
        stack, component = [node], set()
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            component.add(current)
            stack.extend(sorted(reverse[current] - visited, reverse=True))
        components.append(component)
    keep = sorted(components, key=lambda c: (-len(c), sorted(c)))[0]
    result = {**graph, 'nodes': [node for node in graph['nodes'] if node['id'] in keep],
              'edges': [edge for edge in graph['edges'] if edge['from'] in keep and edge['to'] in keep]}
    way_ids = {edge['osmWayId'] for edge in result['edges']}
    result['restrictions'] = [r for r in graph['restrictions'] if r['viaNodeId'] in keep and r['fromWayId'] in way_ids and r['toWayId'] in way_ids]
    return result


def path(graph, start, target, closed=frozenset()):
    """Importer placement witness uses the same incoming-arc restriction state as runtime."""
    adjacency = defaultdict(list)
    for edge in graph['edges']:
        if edge['id'] in closed:
            continue
        for a, b, suffix in ((edge['from'], edge['to'], 'f'), (edge['to'], edge['from'], 'r')):
            if edge['direction'] == ('reverse' if suffix == 'f' else 'forward'):
                continue
            adjacency[a].append((edge, a, b, edge['id'] + ':' + suffix))
    queue = [(0, '', start, None, ())]
    visited = set()
    while queue:
        cost, tie, current, incoming, route = heapq.heappop(queue)
        key = (current, incoming[3] if incoming else '')
        if key in visited:
            continue
        visited.add(key)
        if current == target:
            return cost, route
        for arc in sorted(adjacency[current], key=lambda a: a[3]):
            if incoming:
                banned = False
                for r in graph['restrictions']:
                    if r['viaNodeId'] != current or r['fromWayId'] != incoming[0]['osmWayId']:
                        continue
                    same_way_u_turn = r['maneuver'].endswith('u_turn') and r['fromWayId'] == r['toWayId']
                    match = r['toWayId'] == arc[0]['osmWayId'] and (not same_way_u_turn or incoming[1] == arc[2])
                    if (r['kind'] == 'only' and not match) or (r['kind'] == 'no' and match):
                        banned = True
                        break
                if banned:
                    continue
            heapq.heappush(queue, (cost + arc[0]['durationMs'], tie + '|' + arc[3], arc[2], arc, route + (arc[0]['id'],)))
    return None


def build_bundle(payload, raw_sha):
    normalized, stats = import_graph(payload)
    graph = largest_driving_component(normalized)
    projection = graph.pop('projection')
    nodes = graph['nodes']
    adjacent_names = defaultdict(set)
    for edge in graph['edges']:
        for key in ('from', 'to'):
            adjacent_names[edge[key]].add(edge['name'])
    used = set()

    def nearest(lat, lon):
        options = [node for node in nodes if node['id'] not in used and adjacent_names[node['id']] != {'Unnamed public street'}]
        choice = min(options, key=lambda node: (haversine(node, {'lat': lat, 'lon': lon}), node['id']))
        used.add(choice['id'])
        return choice

    base = nearest(32.794, -96.775)
    shelter_a, shelter_b = nearest(32.795, -96.766), nearest(32.793, -96.782)
    homes = []
    for quadrant, neighborhood in enumerate(('northwest', 'northeast', 'southwest', 'southeast')):
        for local in range(6):
            lat = (32.798 if quadrant < 2 else 32.7915) - (local // 3) * .002
            lon = (-96.782 if quadrant % 2 == 0 else -96.773) + (local % 3) * .003
            home = nearest(lat, lon)
            ident = f'H{len(homes) + 1:02}'
            homes.append({'id': ident, 'name': f'Demo household {ident}', 'address': f"Demo home {ident} on {sorted(adjacent_names[home['id']])[0]}",
                          'nodeId': home['id'], 'x': home['x'], 'y': home['y'], 'neighborhood': neighborhood})
    anchors = [base['id'], shelter_a['id'], shelter_b['id']] + [h['nodeId'] for h in homes]
    witnesses = [(base['id'], home['nodeId']) for home in homes] + [(home['nodeId'], shelter['id']) for home in homes for shelter in (shelter_a, shelter_b)]
    if any(path(graph, a, b) is None for a, b in witnesses):
        raise ValueError('Chosen exercise placements are not reachable under all retained turn restrictions.')
    # Deterministically choose a useful physical closure with all exercise routes still reachable.
    detour = None
    for edge in graph['edges']:
        if edge['from'] in anchors or edge['to'] in anchors:
            continue
        direct = path(graph, edge['from'], edge['to'])
        alternate = path(graph, edge['from'], edge['to'], {edge['id']})
        if direct and alternate and edge['id'] in direct[1] and alternate[0] > direct[0] and all(path(graph, a, b, {edge['id']}) for a, b in witnesses):
            detour = edge['id']
            break
    if detour is None:
        raise ValueError('No connected demonstration detour was found.')
    placements = {'baseNodeId': base['id'], 'shelterANodeId': shelter_a['id'], 'shelterBNodeId': shelter_b['id'], 'households': homes}
    graph_hash = digest({'nodes': nodes, 'edges': graph['edges'], 'restrictions': graph['restrictions'], 'placements': placements, 'detourEdgeIds': [detour]})
    graph['metadata'] = {
        'datasetId': 'dallas-old-east-v1', 'datasetHash': graph_hash, 'displayName': 'Old East Dallas', 'bounds': BOUNDS, 'projection': projection,
        'source': {'name': 'OpenStreetMap', 'url': 'https://www.openstreetmap.org/', 'timestamp': payload.get('osm3s', {}).get('timestamp_osm_base', ''),
                   'rawSha256': raw_sha, 'license': 'ODbL-1.0', 'licenseUrl': 'https://opendatacommons.org/licenses/odbl/1-0/'},
        'attribution': '© OpenStreetMap contributors · ODbL',
        'travelPolicy': {'id': 'storm-training-12kph-v1', 'assumedSpeedKph': SPEED_KPH,
                         'description': 'Modeled storm training travel at a constant 12 km/h; real street distances, no live traffic. Sum integer milliseconds, then round each route up once to whole minutes.'},
        'profile': PROFILE, 'baseNodeId': base['id'],
        'limitations': ['Bounded public local-street passenger-car profile; excludes service roads, motorways and access-restricted roads.',
                        'Unsupported applicable conditional or via-way restrictions exclude their affected ways; no emergency exemptions.',
                        'No routing outside the displayed bounds. Map completeness and current road conditions are not guaranteed.',
                        'Households, incidents, response base and shelters are fictional training placements.'],
        'quadrantLabels': [{'neighborhood': neighborhood, 'x': x, 'y': y} for neighborhood, x, y in
                           [('northwest', 240, 76), ('northeast', 720, 76), ('southwest', 240, 644), ('southeast', 720, 644)]]}
    stats.update({'retainedNodes': len(nodes), 'retainedEdges': len(graph['edges']), 'retainedRestrictions': len(graph['restrictions']),
                  'discardedComponentNodes': len(normalized['nodes']) - len(nodes), 'geometryPoints': sum(len(e['geometry']) for e in graph['edges']), 'placementRouteWitnesses': len(witnesses)})
    return {'map': graph, 'placements': placements, 'detourEdgeIds': [detour]}, stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('.private/dallas-osm-source-tagged.json'))
    parser.add_argument('--output', type=Path, default=Path('fixtures/maps/dallas-streets-v1.json'))
    args = parser.parse_args()
    raw = args.source.read_bytes()
    raw_sha = hashlib.sha256(raw).hexdigest()
    if raw_sha != SOURCE_SHA256:
        raise ValueError('Frozen Dallas v1 source hash differs; refreshes require a new immutable dataset version.')
    bundle, stats = build_bundle(json.loads(raw), raw_sha)
    output = (canonical(bundle) + '\n').encode()
    manifest = {'version': 1, 'datasetId': 'dallas-old-east-v1', 'importerVersion': 'dallas-osm-import-v1', 'sourceSha256': raw_sha,
                'sourceBytes': len(raw), 'sourceTimestamp': bundle['map']['metadata']['source']['timestamp'], 'queryBounds': BOUNDS,
                'sourceDescription': 'Retained Overpass highway ways and turn-restriction relations with recursively referenced tagged nodes; full source is kept separately in .private/dallas-osm-source-tagged.json.',
                'acquisition': {'endpoint': 'https://overpass-api.de/api/interpreter', 'method': 'POST', 'encoding': 'application/x-www-form-urlencoded',
                                'query': '[out:json][timeout:30];(way["highway"](32.788,-96.784,32.800,-96.764);relation["type"="restriction"](32.788,-96.784,32.800,-96.764););out body;>;out body qt;',
                                'userAgent': 'CatastropheResponseSimulator/0.1(https://github.com/Skytuhua/catastrophe-response-simulator)'},
                'outputSha256': hashlib.sha256(output).hexdigest(), 'outputBytes': len(output), 'datasetHash': bundle['map']['metadata']['datasetHash'],
                'profile': PROFILE, 'rounding': 'Coordinates: original WGS84; projected units and geodesic meters: 3 decimals; milliseconds: nearest positive integer; each route minutes: ceiling of summed milliseconds.',
                'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors', 'sourceUrl': 'https://www.openstreetmap.org/copyright',
                'stats': stats, 'detourEdgeIds': bundle['detourEdgeIds']}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    args.output.with_name('dallas-streets-v1.source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in manifest.items() if key != 'stats'}, indent=2))
    print(json.dumps({key: value for key, value in stats.items() if key != 'excludedWays'}, indent=2))


if __name__ == '__main__':
    main()
