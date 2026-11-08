"""Materialize fitted complete households at explicitly approximate blocks.

2020 HU100 weights distribute ACS2024 tract household estimates, not actual
residents or current building capacity. Each unit/point is synthetic. Access
is the nearest retained public local-road node within a declared 500m cap;
the internal block last-mile is an assumption, not a driveway survey.
"""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import time

from acquire_sources import canonical, TRACTS, sha256, file_sha256, peak_working_set_bytes
from import_roads import geometry_support, polygon_from_rings, haversine, route_waypoints

PRIVATE=Path('.private/dallas-v2-data')
SEED=20261108


def largest_remainder(total,weights):
    denominator=sum(weights.values())
    if denominator<=0:raise ValueError('No residential block weight')
    raw={key:total*weight/denominator for key,weight in weights.items()}
    result={key:math.floor(value) for key,value in raw.items()}
    for key in sorted(weights,key=lambda key:(-(raw[key]-result[key]),key))[:total-sum(result.values())]:result[key]+=1
    return result


def random_point(polygon,unit,seed=SEED):
    from shapely.geometry import Point
    west,south,east,north=polygon.bounds
    for attempt in range(10000):
        raw=hashlib.sha256(f'{seed}|block-placement-v2.1|{unit}|{attempt}'.encode()).digest()
        a,b=[int.from_bytes(raw[start:start+8],'big')/2**64 for start in (0,8)]
        point=Point(west+a*(east-west),south+b*(north-south))
        if polygon.contains(point):return point
    raise ValueError('Placement rejection sampler exceeded declared cap')


def source_receipts(raw):
    receipts=[]
    for entry in sorted(raw.glob('*.receipt.json')):
        source=json.loads(entry.read_text())
        if source.get('status')!='downloaded' or not source.get('completeResponse'):raise ValueError('Incomplete source receipt')
        path=raw/source['id']
        hasher=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):hasher.update(chunk)
        if path.stat().st_size!=source['bytes'] or hasher.hexdigest()!=source['sha256']:raise ValueError('Retained raw source hash mismatch')
        osm=source['id']=='osm-roads.json'
        osm_license=source['id'] in ('osm-copyright.html','odbl-1.0.html')
        vintage='Retrieved license/policy snapshot' if osm_license or source['id'].endswith('-policy.pdf') else 'OpenStreetMap 2026-11-08' if osm else 'Census 2020 blocks' if source['id']=='blocks2020.json' else 'Census 2020 PUMA' if source['id']=='puma.json' else 'ACS2024 geography' if source['id']=='tracts.json' else 'ACS 2020-2024 five-year'
        notes=['Complete HTTP200 bytes retained privately; normalized outputs are separate derivatives.']
        if source['id'].startswith('acs2024-'):notes+=['ACS 2020-2024 five-year estimates/MOEs; pipe GEO_ID|TABLE_Exxx|TABLE_Mxxx bulk schema; two exact tract rows; negative/suppressed required controls reject admission; no API annotations supplied.']
        if source['id'].startswith('csv_'):notes+=['PUMS current STATE/PUMA/TYPEHUGQ fields; complete occupied household membership joined by string STATE/SERIALNO and unique SPORDER; household WGTP controls sampling, person PWGTP is diagnostic only.']
        receipts.append({'id':source['id'],'url':source['url'],'retrievedAt':source['retrievedAt'],'sha256':source['sha256'],'bytes':source['bytes'],
            'vintage':vintage,'license':'ODbL-1.0' if osm or source['id']=='odbl-1.0.html' else 'CC-BY-SA-2.0' if source['id']=='osm-copyright.html' else 'US-government-public-domain', 'status':'retained',
            'notes':notes})
    return receipts


def main():
    from pyproj import Transformer
    from shapely.ops import transform
    started=time.monotonic();raw=PRIVATE/'raw'
    sources=source_receipts(raw)
    tracts,geometry_receipt=geometry_support(raw)
    tract_polygons={f['attributes']['GEOID']:polygon_from_rings(f['geometry']['rings']) for f in tracts}
    to_m=Transformer.from_crs(4326,32614,always_xy=True).transform
    to_ll=Transformer.from_crs(32614,4326,always_xy=True).transform
    blocks_payload=json.loads((raw/'blocks2020.json').read_text())
    if blocks_payload.get('error') or blocks_payload.get('exceededTransferLimit') or blocks_payload.get('spatialReference',{}).get('wkid')!=4326:raise ValueError('Invalid block geography response')
    blocks={}
    for feature in blocks_payload['features']:
        attributes=feature['attributes'];geoid=attributes['GEOID'];tract=geoid[:11]
        if geoid in blocks or tract not in TRACTS:raise ValueError('Duplicate/outside block geography')
        polygon=polygon_from_rings(feature['geometry']['rings'])
        clipped=polygon.intersection(tract_polygons[tract])
        if int(attributes['HU100'])>0 and (not clipped.is_valid or clipped.area<=0):raise ValueError('Residential block lacks current tract support')
        blocks[geoid]={'attributes':attributes,'rings':feature['geometry']['rings'],'polygon':clipped}
    fitted=json.loads((PRIVATE/'fitted-households.json').read_text())
    fit_receipt=json.loads(Path('fixtures/v2/population/fit-receipt-v2.json').read_text())
    if fit_receipt['custody']['controlsSha256']!=file_sha256('fixtures/v2/sources/tract-controls-v2.json'):raise ValueError('Normalized control input hash mismatch')
    if fit_receipt['custody']['selectedHouseholdsSha256']!=sha256((PRIVATE/'fitted-households.json').read_bytes()):raise ValueError('Fitted source custody mismatch')
    graph=json.loads(Path('fixtures/v2/maps/dallas-roads-v2.json').read_text())
    facilities=json.loads(Path('fixtures/v2/maps/facilities-v2.json').read_text())
    projection=graph['metadata']['projection'];nodes=graph['nodes']
    households,persons,support,placements=[],[],[],[]
    household_donors=[]
    for tract in TRACTS:
        positive={key:int(block['attributes']['HU100']) for key,block in blocks.items() if key.startswith(tract) and int(block['attributes']['HU100'])>0}
        allocations=largest_remainder(len(fitted[tract]),positive)
        iterator=iter(fitted[tract])
        for block_id,count in sorted(allocations.items()):
            block=blocks[block_id];metric=transform(to_m,block['polygon'])
            support.append({'id':block_id,'rings':block['rings'],'housingUnits2020':positive[block_id],'allocatedHouseholds':count,'allocationMethod':'2020-housing-unit-weighted-approximate'})
            for unit_number in range(1,count+1):
                donor=next(iterator);ident=f'HH-{tract}-{len(households)+1:05}';unit=f'{block_id}:synthetic-unit:{unit_number}'
                ll=transform(to_ll,random_point(metric,unit))
                position={'lat':ll.y,'lon':ll.x}
                node=min(nodes,key=lambda node:(haversine(node,position),node['id']))
                distance=haversine(node,position)
                if distance>500:raise ValueError('Approximate block placement exceeds 500m public-road access cap')
                position['x']=round(480+6371008.8*math.cos(math.radians(projection['originLat']))*math.radians(ll.x-projection['originLon'])/projection['metersPerUnit'],3)
                position['y']=round(360-6371008.8*math.radians(ll.y-projection['originLat'])/projection['metersPerUnit'],3)
                member_ids=[]
                for order,member in enumerate(donor['members'],1):
                    person_id=f'P-{ident}-{order:02}';member_ids.append(person_id)
                    persons.append({'id':person_id,'householdId':ident,'age':int(member['AGEP']),'sex':member['SEX'],'relationship':member['RELSHIPP'],
                        'disability':member['DIS'] or None,'language':None if int(member['AGEP'])<5 else 'English-only' if member['LANX']=='2' else member['LANP'] or None})
                households.append({'id':ident,'tractGeoid':tract,'size':len(member_ids),'personIds':member_ids,'homeNodeId':node['id'],'position':position,
                    'vehicles':int(donor['housing']['VEH']), 'placement':{'method':'approximate-census-block','supportId':block_id,'unitId':unit,
                        'accessNodeId':node['id'],'distanceMeters':round(distance,3),
                        'capacityBasis':f'2020 Census block HU100={positive[block_id]}; {count} ACS2024 synthetic households allocated by housing-unit weight; current building capacity unverified.'}})
                household_donors.append({'householdId':ident,'state':donor['housing']['STATE'],'serial':donor['housing']['SERIALNO'],'SPORDER':[p['SPORDER'] for p in donor['members']]})
                placements.append({'householdId':ident,'blockId':block_id,'accessNodeId':node['id'],'distanceMeters':round(distance,3)})
    unique_access=sorted({h['homeNodeId'] for h in households})
    # Legal turn-state witnesses are counted by distinct access node, not by
    # duplicating a witness thousands of times for apartment households.
    witnesses=[]
    base=next(f for f in facilities if f['kind']=='base')['nodeId'];shelters=[f['nodeId'] for f in facilities if f['kind']=='shelter']
    for node in unique_access:
        for waypoints in ([node],*[ [node,shelter] for shelter in shelters]):
            route=route_waypoints(graph,base,waypoints)
            if route is None:raise ValueError(f'Legal routing unsupported: {base} through {waypoints}')
            witnesses.append({'from':base,'waypoints':waypoints,'durationMs':route[0],'arcIds':list(route[1]),'incomingContinuity':'preserved through household waypoint'})
    controls=json.loads(Path('fixtures/v2/sources/tract-controls-v2.json').read_text())
    sums={(tract,table):next(r['estimate'] for r in controls if r['tractGeoid']==tract and r['tableId']==table and r['lineId']=='001') for tract in TRACTS for table in ('B01001','B25008')}
    excluded=sum(sums[tract,'B01001']-sums[tract,'B25008'] for tract in TRACTS)
    if excluded<0:raise ValueError('Negative derived ACS exclusion estimate')
    limitations=['Synthetic whole-household resampling from public PUMS donors; no record identifies an actual tract resident.',
        'Household/person targets are ACS 2020-2024 estimates; margins of error are retained separately from fitting residuals.',
        'Aggregate excluded group-quarter estimate is B01001 total minus B25008 occupied-housing persons: 187. Different-table uncertainty is not independent; exact GQ resident count is unobserved.',
        '2020 HU100 supplies block allocation weights, not current building capacities; all unit positions are approximate synthetic points within admitted tract/block intersection.',
        'Public road nodes are motorcar-accessible under the declared OSM profile; intra-block last-mile access is a modeled <=500m link, not a surveyed driveway/pedestrian path.',
        'Member age/sex/relationships/disability/language preserve complete sampled PUMS households; tract-level member traits and correlations are not independently calibrated.',
        'Published zero fit cells use the declared rare-cell <=2-household tolerance; complete source-supported 6+ households remain intact when selected.']
    fit_controls=[{'id':r['id'],'target':r['target'],'achieved':r['achieved'],'moe':r['moe']} for t in fit_receipt['tracts'] for r in t['controls']]
    population={'kind':'dallas-population','version':2,'mode':'full-tract','seed':SEED,'households':households,'persons':persons,
        'sourceReceipts':[r for r in sources if r['id'].startswith(('acs2024-','csv_','pums-','table-'))], 'excludedGroupQuarters':excluded,
        'fit':{'method':'KL entropy balancing / declared primary reconciliation / seeded whole-household MILP integerization v2.1','converged':True,'controls':fit_controls,'limitations':limitations}}
    geography={'kind':'dallas-geography','version':2,'crs':'EPSG:4326','routingBufferMeters':500,
        'tracts':[{'geoid':tract,'rings':next(t['geometry']['rings'] for t in tracts if t['attributes']['GEOID']==tract)} for tract in TRACTS],
        'residentialSupport':support,'sourceReceipts':[r for r in sources if r['id'] in ('tracts.json','puma.json','blocks2020.json')],
        'limitations':limitations[3:5]}
    placement_receipt={'status':'admitted','method':'2020-HU-weighted approximate census block','households':len(households),'persons':len(persons),
        'blockCount':len(blocks),'positiveHousingBlocks':len(support),'distinctSyntheticUnits':len({h['placement']['unitId'] for h in households}),
        'distinctCoordinates':len({(h['position']['lat'],h['position']['lon']) for h in households}),'distinctAccessNodes':len(unique_access),
        'maxAccessDistanceMeters':max(h['placement']['distanceMeters'] for h in households),'accessDistanceCapMeters':500,
        'routingWitnesses':len(witnesses),'geometryAdmission':geometry_receipt,'exclusionsByTract':[
            {'tractGeoid':tract,'totalPopulationEstimate':sums[tract,'B01001'],'occupiedHousingPersonEstimate':sums[tract,'B25008'],
                'derivedExcludedGroupQuarterEstimate':sums[tract,'B01001']-sums[tract,'B25008']} for tract in TRACTS],
        'elapsedSeconds':round(time.monotonic()-started,3),'peakWorkingSetBytes':peak_working_set_bytes(),'limitations':limitations}
    for name,value in [('fixtures/v2/population/dallas-population-v2.json',population),('fixtures/v2/geography/dallas-geography-v2.json',geography),
        ('fixtures/v2/population/placement-receipt-v2.json',placement_receipt),('fixtures/v2/sources/source-receipts-v2.json',sources),
        (PRIVATE/'routing-witnesses.json',witnesses),(PRIVATE/'household-donor-custody.json',household_donors)]:
        Path(name).write_text(canonical(value)+'\n',encoding='utf-8')
    # Distinct, separately labeled subset benchmark; never the full-tract count.
    sample=sorted(households,key=lambda h:hashlib.sha256(f'{SEED}|benchmark1000|{h["id"]}'.encode()).hexdigest())[:1000]
    selected_ids={h['id'] for h in sample}
    benchmark={**population,'mode':'benchmark','households':sample,'persons':[p for p in persons if p['householdId'] in selected_ids],
        'excludedGroupQuarters':None,'fit':{'method':'Seeded distinct 1000-household subset of admitted full-tract population','converged':True,'controls':[],
            'limitations':['Workload sample; does not represent the full tract totals.']}}
    Path('fixtures/v2/population/dallas-benchmark1000-v2.json').write_text(canonical(benchmark)+'\n',encoding='utf-8')
    # Match the runtime's canonical JSON exactly, including JavaScript's numeric
    # rendering. Raw-byte source hashes stay separate and are never rewritten.
    import subprocess
    freeze_script="""
import fs from 'node:fs';
import crypto from 'node:crypto';
import { canonical, hashValue } from './src/v2/hash.ts';
const names=['maps/dallas-roads-v2.json','maps/facilities-v2.json','geography/dallas-geography-v2.json','population/dallas-population-v2.json','population/dallas-benchmark1000-v2.json'];
const manifest={kind:'dallas-data-assets',version:2,hashAlgorithm:'sha256(canonical-v2)',assets:{}};
for(const name of names){
 const file='fixtures/v2/'+name; const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(name==='maps/dallas-roads-v2.json'){ const {metadata,...topology}=value;metadata.datasetHash=hashValue(topology); }
 const bytes=Buffer.from(canonical(value)+'\\n');fs.writeFileSync(file,bytes);
 manifest.assets[name]={sha256:hashValue(value),rawJsonSha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
fs.writeFileSync('fixtures/v2/sources/data-assets-v2.json',canonical(manifest)+'\\n');
"""
    subprocess.run(['node','--experimental-strip-types','--input-type=module'],input=freeze_script,text=True,check=True)
    print(json.dumps({k:v for k,v in placement_receipt.items() if k not in ('limitations','geometryAdmission')}),flush=True)


if __name__=='__main__':main()
