"""Acquire/import the full two-tract + 500m OSM driving support.

Pure v1 topology/access/restriction helpers are reused without editing v1 data
or behavior. WGS84 source vertices and directions remain intact.
"""
import argparse
from collections import defaultdict
import heapq
import json
from pathlib import Path
import sys
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from import_dallas import import_graph, largest_driving_component as _legacy_largest_driving_component, path, haversine, digest
from acquire_sources import acquire, parse_arcgis, query_url, canonical, TRACTS

PRIVATE = Path('.private/dallas-v2-data')


def largest_driving_component(graph, *, correction_receipt=None):
    """Reduce to an SCC without erasing an applicable only-turn constraint.

    The legacy reducer removes restrictions whose target way leaves the SCC.
    For v2, that must also close the source approach: otherwise a previously
    forbidden departure becomes legal. Remove the entire affected incoming
    way conservatively and recompute from the original normalized topology
    until all retained only-turn approaches retain their source constraints.
    """
    closed_ways=set();corrections=[]
    for iteration in range(len(graph['edges'])+1):
        working={**graph,'edges':[edge for edge in graph['edges'] if edge['osmWayId'] not in closed_ways]}
        if not working['edges']:raise ValueError('Only-turn-safe SCC reduction removed every driving edge')
        retained=_legacy_largest_driving_component(working)
        retained_rules={rule['id'] for rule in retained['restrictions']}
        lost=[]
        for rule in graph['restrictions']:
            if rule['kind']!='only' or rule['id'] in retained_rules:continue
            # A rule still applies only if its from-way has an admitted arc
            # entering the exact via node. Other surviving segments of a way
            # do not by themselves make this particular turn applicable.
            approach=[edge for edge in retained['edges'] if edge['osmWayId']==rule['fromWayId'] and (
                edge['to']==rule['viaNodeId'] and edge['direction'] in ('both','forward') or
                edge['from']==rule['viaNodeId'] and edge['direction'] in ('both','reverse'))]
            if approach:lost.append((rule,approach))
        if not lost:
            if correction_receipt is not None:
                correction_receipt.update({'policy':'fail-closed-incoming-way-and-recompute-scc-v2.1','iterations':iteration+1,
                    'closedIncomingWayIds':sorted(closed_ways),'sourceOnlyRestrictionCorrections':corrections,
                    'excludedEdgeIds':sorted(edge['id'] for edge in graph['edges'] if edge['osmWayId'] in closed_ways)})
            return retained
        newly_closed={rule['fromWayId'] for rule,_ in lost}-closed_ways
        if not newly_closed:raise ValueError('Only-turn SCC reduction failed to make progress')
        closed_ways.update(newly_closed)
        for rule,approach in lost:
            corrections.append({'iteration':iteration+1,'restriction':rule,'incomingApproachEdgeIds':sorted(edge['id'] for edge in approach),
                'closedIncomingWayId':rule['fromWayId'],'reason':'SCC removed an applicable only-turn target/rule; retaining its incoming approach would invent a legal departure.'})
    raise ValueError('Only-turn SCC reduction exceeded finite edge-removal bound')


def route_waypoints(graph,start,waypoints):
    """One turn-state search through access/dwell points; arrival is retained."""
    adjacency=defaultdict(list)
    for edge in graph['edges']:
        for a,b,suffix in ((edge['from'],edge['to'],'f'),(edge['to'],edge['from'],'r')):
            if edge['direction']==('reverse' if suffix=='f' else 'forward'):continue
            adjacency[a].append((edge,a,b,edge['id']+':'+suffix))
    queue=[(0,'',start,None,0,())];visited=set()
    while queue:
        cost,tie,node,incoming,index,route=heapq.heappop(queue)
        while index<len(waypoints) and node==waypoints[index]:index+=1
        state=(node,incoming[3] if incoming else '',index)
        if state in visited:continue
        visited.add(state)
        if index==len(waypoints):return cost,route
        for arc in sorted(adjacency[node],key=lambda arc:arc[3]):
            banned=False
            if incoming:
                for restriction in graph['restrictions']:
                    if restriction['viaNodeId']!=node or restriction['fromWayId']!=incoming[0]['osmWayId']:continue
                    uturn=restriction['maneuver'].endswith('u_turn') and restriction['fromWayId']==restriction['toWayId']
                    match=restriction['toWayId']==arc[0]['osmWayId'] and (not uturn or incoming[1]==arc[2])
                    if restriction['kind']=='only' and not match or restriction['kind']=='no' and match:banned=True;break
            if not banned:heapq.heappush(queue,(cost+arc[0]['durationMs'],tie+'|'+arc[3],arc[2],arc,index,route+(arc[3],)))
    return None


def polygon_from_rings(rings):
    """ArcGIS polygons can contain multiple exteriors and interior rings."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    parts=[Polygon(ring) for ring in rings]
    if any(not part.is_valid or part.area<=0 for part in parts):
        raise ValueError('Invalid source polygon ring')
    depths=[sum(other.contains(part.representative_point()) for j,other in enumerate(parts) if i!=j and other.area>part.area) for i,part in enumerate(parts)]
    result=unary_union([part for part,depth in zip(parts,depths) if depth%2==0])
    for part,depth in zip(parts,depths):
        if depth%2:result=result.difference(part)
    if not result.is_valid:raise ValueError('Invalid polygon topology')
    return result


def geometry_support(raw_directory):
    from shapely.ops import transform, unary_union
    from pyproj import Transformer
    tracts = parse_arcgis((raw_directory/'tracts.json').read_bytes(), TRACTS)
    pumas = parse_arcgis((raw_directory/'puma.json').read_bytes(), ['4802313'])
    to_m = Transformer.from_crs(4326, 32614, always_xy=True).transform
    to_ll = Transformer.from_crs(32614, 4326, always_xy=True).transform
    polygons = {f['attributes']['GEOID']: polygon_from_rings(f['geometry']['rings']) for f in tracts}
    if any(not p.is_valid or p.area <= 0 for p in polygons.values()):
        raise ValueError('Invalid tract polygon topology')
    a, b = [transform(to_m, polygons[key]) for key in TRACTS]
    shared = a.boundary.intersection(b.boundary).length
    # Independent ArcGIS boundaries differ by sub-mm vertex rounding. Report
    # that tolerance, rather than silently inventing a shared polygon.
    if shared < 1 and a.distance(b) > 0.02:
        raise ValueError('Tracts are not adjacent within 2cm source rounding tolerance')
    puma = transform(to_m, polygon_from_rings(pumas[0]['geometry']['rings']))
    union = unary_union([a,b])
    uncovered = union.difference(puma.buffer(0.02)).area
    if not puma.is_valid or uncovered > 1:
        raise ValueError('Donor PUMA lacks full positive-area tract support')
    buffered = union.buffer(500)
    bounds = transform(to_ll, buffered).bounds
    receipt = {'metricCrs': 'EPSG:32614', 'routingBufferMeters': 500, 'sourceBoundaryToleranceMeters': 0.02,
               'tractAreasM2': {key: transform(to_m,p).area for key,p in polygons.items()},
               'sharedBoundaryMeters': shared, 'boundaryGapMeters': a.distance(b),
               'pumaGeoid': '4802313', 'pumaUncoveredAreaM2': uncovered,
               'routingBufferAreaM2': buffered.area,
               'queryBounds': dict(zip(('west','south','east','north'), bounds))}
    return tracts, receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acquire',action='store_true')
    args=parser.parse_args()
    raw=PRIVATE/'raw'
    tracts, geography_receipt=geometry_support(raw)
    bounds=geography_receipt['queryBounds']
    bbox=','.join(str(bounds[k]) for k in ('south','west','north','east'))
    query=f'[out:json][timeout:90][maxsize:67108864];(way["highway"]({bbox});relation["type"="restriction"]({bbox}););out body;>;out body qt;'
    if args.acquire:
        endpoint='https://overpass-api.de/api/interpreter'
        print(json.dumps(acquire('osm-roads.json',endpoint+'?'+urlencode({'data':query}),raw,64_000_000)),flush=True)
        blocks='https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/tigerWMS_Census2020/MapServer/10/query?'+urlencode({
            'f':'json','where':"STATE='48' AND COUNTY='113' AND TRACT IN ('001502','002200')",'outFields':'GEOID,TRACT,HU100,POP100,AREALAND,INTPTLON,INTPTLAT','returnGeometry':'true','outSR':4326})
        print(json.dumps(acquire('blocks2020.json',blocks,raw,5_000_000)),flush=True)
    source=json.loads((raw/'osm-roads.json').read_bytes())
    if 'elements' not in source or not source.get('osm3s',{}).get('timestamp_osm_base'):
        raise ValueError('Incomplete OSM response')
    graph,stats=import_graph(source,bounds)
    sys.setrecursionlimit(max(10000, len(graph['nodes'])*2))
    correction_receipt={}
    retained=largest_driving_component(graph,correction_receipt=correction_receipt)
    projection=retained.pop('projection')
    nodes=retained['nodes']
    base=min(nodes,key=lambda n:(haversine(n,{'lat':32.7928,'lon':-96.777}),n['id']))
    shelter_a=min(nodes,key=lambda n:(haversine(n,{'lat':32.798,'lon':-96.769}),n['id']))
    shelter_b=min(nodes,key=lambda n:(haversine(n,{'lat':32.788,'lon':-96.787}),n['id']))
    if len({n['id'] for n in (base,shelter_a,shelter_b)})!=3:
        raise ValueError('Synthetic facilities require distinct road nodes')
    raw_receipt=json.loads((raw/'osm-roads.json.receipt.json').read_text())
    retained['metadata']={'datasetId':'dallas-two-tracts-v2','datasetHash':digest(retained),'displayName':'Dallas tract 15.02 and tract 22',
        'bounds':bounds,'projection':projection,'source':{'name':'OpenStreetMap','url':'https://www.openstreetmap.org/','timestamp':source['osm3s']['timestamp_osm_base'],
            'rawSha256':raw_receipt['sha256'],'license':'ODbL-1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/'},
        'attribution':'© OpenStreetMap contributors · ODbL','travelPolicy':{'id':'storm-training-12kph-v1','assumedSpeedKph':12,
            'description':'Synthetic constant 12 km/h over real street geometry; no live traffic or emergency exemptions.'},
        'profile':'bounded-public-local-motorcar-v1','baseNodeId':base['id'],
        'limitations':['Public local-road motorcar profile excludes motorways, service and restricted ways.',
            'Unsupported conditional/via-way restrictions exclude affected ways; no emergency exemptions.',
            'Query rectangle encloses the exact EPSG:32614 tract-union 500m buffer; no buffer residents added.',
            'SCC reduction fails closed on an incoming way if its applicable only-turn target/rule disappears, then recomputes until stable.',
            'Largest strongly connected component retained; excluded components are reported. Synthetic facilities have no real operational status.'],
        'quadrantLabels':[]}
    stats.update({'retainedNodes':len(nodes),'retainedEdges':len(retained['edges']),'retainedRestrictions':len(retained['restrictions']),
        'discardedComponentNodes':len(graph['nodes'])-len(nodes),'discardedComponentEdges':len(graph['edges'])-len(retained['edges']),
        'sourceTimestamp':source['osm3s']['timestamp_osm_base'],'rawSha256':raw_receipt['sha256'],'query':query,
        'restrictionSafeReduction':correction_receipt})
    facilities=[]
    for ident,name,kind,node,capacity,accessible in [('base-v2','Synthetic response base','base',base,0,True),
        ('shelter-a-v2','Synthetic shelter A','shelter',shelter_a,150,True),('shelter-b-v2','Synthetic shelter B','shelter',shelter_b,150,False)]:
        facilities.append({'id':ident,'name':name,'kind':kind,'nodeId':node['id'],'position':{k:node[k] for k in ('x','y','lat','lon')},'synthetic':True,'capacity':capacity,'accessible':accessible,'opensAtMs':0})
    for filename,value in [('fixtures/v2/maps/dallas-roads-v2.json',retained),('fixtures/v2/maps/facilities-v2.json',facilities),
        ('fixtures/v2/maps/road-admission-v2.json',stats),('fixtures/v2/geography/geometry-admission-v2.json',geography_receipt)]:
        Path(filename).write_text(canonical(value)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in stats.items() if k not in ('excludedWays','excludedNodes','query')}),flush=True)


if __name__=='__main__': main()
