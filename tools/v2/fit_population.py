"""Stream complete ACS PUMS households, fit declared margins, integerize groups.

Run with the isolated data venv. Raw Texas ZIPs are never expanded to disk or
loaded as a whole dataframe. Only the admitted PUMA donor fields are retained.
"""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import time
import zipfile

from acquire_sources import canonical, parse_table, TABLE_LINES, TRACTS, file_sha256, peak_working_set_bytes

HOUSING_FIELDS=('RT','STATE','PUMA','SERIALNO','TYPEHUGQ','NP','WGTP','HHT','VEH','TEN','BLD')
PERSON_FIELDS=('RT','STATE','PUMA','SERIALNO','SPORDER','AGEP','SEX','RELSHIPP','DIS','LANX','LANP','PWGTP')
PRIVATE=Path('.private/dallas-v2-data')
SEED=20261108


def join_donors(housing_rows,person_rows):
    donors,excluded_keys={},set()
    stats={'housingRows':0,'personRows':0,'candidatePumaHousingRows':0,'excludedHousing':Counter(),'excludedPersons':Counter()}
    for row in housing_rows:
        stats['housingRows']+=1
        if row['RT']!='H' or row['STATE']!='48' or row['PUMA']!='02313':continue
        stats['candidatePumaHousingRows']+=1
        key=(row['STATE'],row['SERIALNO'])
        if key in donors or key in excluded_keys:raise ValueError('Duplicate housing key')
        reason='group-quarters' if row['TYPEHUGQ']!='1' else 'vacant' if int(row['NP'])==0 else 'nonpositive-household-weight' if int(row['WGTP'])<=0 else None
        if reason:
            stats['excludedHousing'][reason]+=1
            excluded_keys.add(key)
            continue
        if int(row['NP']) not in range(1,21) or int(row['HHT']) not in range(1,8):raise ValueError('Invalid occupied household donor')
        donors[key]={'housing':{key:row.get(key,'') for key in HOUSING_FIELDS},'members':[]}
    seen=set()
    for row in person_rows:
        stats['personRows']+=1
        if row['RT']!='P' or row['STATE']!='48' or row['PUMA']!='02313':continue
        key=(row['STATE'],row['SERIALNO'])
        if key in excluded_keys:
            stats['excludedPersons']['excluded-housing-universe']+=1
            continue
        if key not in donors:raise ValueError('Orphan person in selected PUMA')
        member_key=(*key,int(row['SPORDER']))
        if member_key in seen:raise ValueError('Duplicate person key')
        seen.add(member_key)
        if int(row['AGEP'])<0 or int(row['SPORDER'])<1:raise ValueError('Invalid person donor')
        donors[key]['members'].append({key:row.get(key,'') for key in PERSON_FIELDS})
    for donor in donors.values():
        donor['members'].sort(key=lambda row:int(row['SPORDER']))
        if len(donor['members'])!=int(donor['housing']['NP']):raise ValueError('Incomplete/clipped household donor')
        if [int(row['SPORDER']) for row in donor['members']]!=list(range(1,len(donor['members'])+1)):raise ValueError('Noncontiguous person ordinals')
        if sum(row['RELSHIPP']=='20' for row in donor['members'])!=1:raise ValueError('Occupied donor requires one reference person')
    result=[donors[key] for key in sorted(donors)]
    stats.update({'completeDonors':len(result),'completeMembers':sum(len(d['members']) for d in result),
        'sizeDistribution':dict(sorted(Counter(len(d['members']) for d in result).items())),
        'householdWeightSum':sum(int(d['housing']['WGTP']) for d in result),
        'personWeightSumDiagnostic':sum(int(p['PWGTP']) for d in result for p in d['members']),
        'joinKey':'string (STATE,SERIALNO); unique (STATE,SERIALNO,SPORDER)',
        'filters':"RT=H, STATE=48, PUMA=02313, TYPEHUGQ=1, NP>0, WGTP>0; all matching P members"})
    return result,stats


def zip_rows(path,member,fields):
    with zipfile.ZipFile(path) as archive:
        if archive.namelist().count(member)!=1 or len(archive.namelist())!=len(set(archive.namelist())):raise ValueError('Missing/duplicate donor ZIP member')
        with archive.open(member) as binary,io.TextIOWrapper(binary,encoding='utf-8-sig',newline='') as text:
            reader=csv.DictReader(text)
            expected_columns=241 if member=='psam_h48.csv' else 285
            if not set(fields).issubset(reader.fieldnames or []) or len(reader.fieldnames or [])!=expected_columns or len(set(reader.fieldnames))!=expected_columns:raise ValueError('Unsupported current PUMS schema')
            for row in reader:yield row


def control_feature(table,line,housing):
    n,hht,vehicles,tenure=(int(housing[k]) for k in ('NP','HHT','VEH','TEN'))
    family=hht in (1,2,3)
    if table=='B11001':
        return int({3:hht==1,5:hht==2,6:hht==3,8:not family and n==1,9:not family and n>1}.get(line,False))
    if table=='B11016':
        own_line=(min(n,7)+1) if family else (min(n,7)+9)
        return int(line==own_line)
    if table=='B08201':
        own_line=8+(min(n,4)-1)*6+min(vehicles,4)
        return int(line==own_line)
    if table=='B25008' and line in (2,3):return n*int((tenure in (1,2))==(line==2))
    raise ValueError('Incompatible universe or nonselected margin')


def selected_controls(rows,tract):
    leafs={'B11001':{3,5,6,8,9},'B11016':set(range(3,9))|set(range(10,17)),
        'B08201':{i for start in (8,14,20,26) for i in range(start,start+5)},'B25008':{2,3}}
    return [row for row in rows if row['tractGeoid']==tract and row['tableId'] in leafs and int(row['lineId']) in leafs[row['tableId']]]


def fit_tract(donors,rows,tract,seed=SEED):
    import numpy as np
    import scipy
    from scipy.optimize import Bounds, LinearConstraint, linprog, milp, minimize
    started=time.monotonic()
    totals={(r['tableId'],int(r['lineId'])):r['estimate'] for r in rows if r['tractGeoid']==tract}
    households,persons=totals['B11001',1],totals['B25008',1]
    if any(totals[t,1]!=households for t in ('B11016','B08201')):raise ValueError('Household universes disagree')
    controls=selected_controls(rows,tract)
    grouped=defaultdict(list)
    for donor in donors:
        h=donor['housing']
        grouped[tuple(int(h[k]) for k in ('NP','HHT','VEH','TEN'))].append(donor)
    keys=sorted(grouped)
    samples=[grouped[k][0]['housing'] for k in keys]
    a=np.array([[control_feature(r['tableId'],int(r['lineId']),h) for h in samples] for r in controls],dtype=float)
    target=np.array([r['estimate'] for r in controls],dtype=float)
    # Survey zeros are uncertain estimates. The declared rare-cell <=2-unit
    # tolerance applies; complete source-supported large donors stay intact.
    keep=np.ones(len(keys),dtype=bool)
    keys=[k for k,yes in zip(keys,keep) if yes]
    a=a[:,keep]
    if any(target[i]>0 and not a[i].any() for i in range(len(target))):
        raise ValueError('Positive required control has no donor support')
    n=len(keys)
    prior=np.array([sum(int(d['housing']['WGTP']) for d in grouped[k]) for k in keys],dtype=float)
    prior*=households/prior.sum()
    primary=np.array([np.ones(n),[k[0] for k in keys]],dtype=float)
    exact=np.array([households,persons],dtype=float)
    tolerances=np.array([2 if t<.02*(persons if r['tableId']=='B25008' else households) else math.floor(.02*(persons if r['tableId']=='B25008' else households)) for t,r in zip(target,controls)],dtype=float)
    lower=np.maximum(0,target-tolerances); upper=target+tolerances
    feasible=linprog(np.zeros(n),A_ub=np.vstack([a,-a]),b_ub=np.hstack([upper,-lower]),A_eq=primary,b_eq=exact,bounds=(0,None),method='highs',options={'time_limit':30})
    if not feasible.success:raise ValueError('Infeasible compatible-control fit: '+feasible.message)
    def objective(w):return float(np.sum(np.where(w>0,w*np.log(np.maximum(w,1e-15)/prior)-w+prior,prior)))
    def gradient(w):return np.log(np.maximum(w,1e-15)/prior)
    active=np.any(a!=0,axis=1)
    def check_cap(_weights):
        if time.monotonic()-started>180:raise ValueError('Entropy fitting exceeded 180 second wall-clock cap')
        memory=peak_working_set_bytes()
        if memory is not None and memory>512*1024**2:raise ValueError('Entropy fitting exceeded 512MiB measured process memory cap')
    fitted=minimize(objective,np.maximum(feasible.x,0),jac=gradient,method='SLSQP',bounds=Bounds(np.zeros(n),np.full(n,np.inf)),
        constraints=[LinearConstraint(primary,exact,exact),LinearConstraint(a[active],lower[active],upper[active])],
        callback=check_cap,options={'maxiter':1000,'ftol':1e-8})
    if not fitted.success or np.max(np.abs(primary@fitted.x-exact))>1e-6:
        raise ValueError('Entropy fit failed declared iteration/convergence cap: '+fitted.message)
    # Seeded min absolute deviation integerization of the fitted joint types.
    # The solver preserves hard household/person totals and every tolerance.
    constraints=np.vstack([np.hstack([primary,np.zeros((2,n))]),np.hstack([a,np.zeros((len(a),n))]),
        np.hstack([np.eye(n),-np.eye(n)]),np.hstack([-np.eye(n),-np.eye(n)])])
    lo=np.hstack([exact,lower,np.full(2*n,-np.inf)])
    hi=np.hstack([exact,upper,fitted.x,-fitted.x])
    costs=np.hstack([np.array([int(hashlib.sha256(f'{seed}|{tract}|{k}'.encode()).hexdigest()[:8],16)/2**32*1e-8 for k in keys]),np.ones(n)])
    integer=milp(costs,integrality=np.hstack([np.ones(n),np.zeros(n)]),bounds=Bounds(np.zeros(2*n),np.full(2*n,np.inf)),
        constraints=LinearConstraint(constraints,lo,hi),options={'time_limit':60,'mip_rel_gap':0})
    if not integer.success:raise ValueError('Integerization failed declared time/feasibility cap: '+integer.message)
    counts=np.rint(integer.x[:n]).astype(int)
    if not np.array_equal(primary@counts,exact) or np.any(a@counts<lower-1e-6) or np.any(a@counts>upper+1e-6):raise ValueError('Integerized fit failed exact accounting')
    selected=[]
    for key,count in zip(keys,counts):
        pool=grouped[key]; total=sum(int(d['housing']['WGTP']) for d in pool)
        for draw in range(count):
            rank=int(hashlib.sha256(f'{seed}|whole-household-v2.1|{tract}|{key}|{draw}'.encode()).hexdigest(),16)/2**256*total
            cumulative=0
            for donor in pool:
                cumulative+=int(donor['housing']['WGTP'])
                if rank<cumulative:
                    selected.append(donor);break
    margins=[{'id':f"{tract}:{r['sourceField']}",'tractGeoid':tract,'tableId':r['tableId'],'sourceField':r['sourceField'],
        'target':r['estimate'],'continuousAchieved':float(achieved),'achieved':int(final),'moe':r['moe'],
        'tolerance':int(tolerance),'residual':int(final-r['estimate']),'receiptRef':r['receiptRef']} for r,achieved,final,tolerance in zip(controls,a@fitted.x,a@counts,tolerances)]
    margins=[{'id':f'{tract}:households','target':households,'achieved':len(selected),'moe':None,'tolerance':0,'residual':0},
        {'id':f'{tract}:occupied-persons','target':persons,'achieved':sum(len(d['members']) for d in selected),'moe':None,'tolerance':0,'residual':0}]+margins
    return selected,{'tractGeoid':tract,'households':households,'persons':persons,'converged':True,'entropyIterations':fitted.nit,
        'jointTypes':n,'donorTypesBeforePublishedZeroFilter':len(grouped),'elapsedSeconds':round(time.monotonic()-started,3),
        'solver':f'SciPy {scipy.__version__}: SLSQP KL entropy balance then HiGHS MILP absolute-deviation integerization',
        'controls':margins,'publishedZeros':'Survey zero estimates use the declared rare-cell <=2-unit tolerance; only complete source donors can supply members.',
        'universeReconciliation':{'sizeTableImpliedPersons':sum(r['estimate']*(int(r['lineId'])-1 if int(r['lineId'])<=8 else int(r['lineId'])-9) for r in controls if r['tableId']=='B11016'),
            'occupiedPersonTarget':persons,'policy':'Primary household/member totals exact; supported nonzero margins use <=2pp or rare <=2 units tolerance.'},
        'policy':{'majorToleranceShare':.02,'rareAbsoluteTolerance':2,'entropyMaxIterations':1000,'feasibilityTimeCapSeconds':30,'integerTimeCapSeconds':60,'seed':seed},
        'selectedSizeDistribution':dict(sorted(Counter(len(d['members']) for d in selected).items()))}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--seed',type=int,default=SEED);args=parser.parse_args()
    started=time.monotonic();raw=PRIVATE/'raw'
    input_hashes={name:file_sha256(raw/name) for name in ('csv_htx.zip','csv_ptx.zip')}
    for name,digest in input_hashes.items():
        if json.loads((raw/f'{name}.receipt.json').read_text())['sha256']!=digest:raise ValueError('Donor source input hash mismatch')
    donor_path=PRIVATE/'donors.json'
    cache_hash_path=PRIVATE/'donors.json.sha256'
    if donor_path.exists():
        if not cache_hash_path.exists() or cache_hash_path.read_text().strip()!=file_sha256(donor_path):raise ValueError('Cached donor artifact hash mismatch')
        cached=json.loads(donor_path.read_text())
        if cached.get('sourceHashes')!=input_hashes:raise ValueError('Cached donor source binding mismatch; rebuild donor cache from retained sources')
        donors=cached['donors'];donor_receipt=cached['receipt']
        join_donors((d['housing'] for d in donors),(p for d in donors for p in d['members']))
    else:
        donors,donor_receipt=join_donors(zip_rows(raw/'csv_htx.zip','psam_h48.csv',HOUSING_FIELDS),zip_rows(raw/'csv_ptx.zip','psam_p48.csv',PERSON_FIELDS))
        donor_path.write_text(canonical({'donors':donors,'receipt':donor_receipt,'sourceHashes':input_hashes})+'\n')
        cache_hash_path.write_text(file_sha256(donor_path)+'\n')
    record_counts=list(csv.DictReader((raw/'pums-record-count.csv').open(encoding='utf-8-sig')))
    expected_counts={row['FILE_TYPE']:int(row['NUMBER_OF_RECORDS']) for row in record_counts if row['STATE']=='48'}
    if donor_receipt['housingRows']!=expected_counts['Housing'] or donor_receipt['personRows']!=expected_counts['Person']:raise ValueError('PUMS row counts disagree with official release metadata')
    controls=[]
    for table in TABLE_LINES:
        with (raw/f'acs2024-{table.lower()}.dat').open(encoding='utf-8-sig') as stream:controls.extend(parse_table(stream,table))
    result,receipts={},[]
    for tract in TRACTS:
        try:result[tract],receipt=fit_tract(donors,controls,tract,args.seed)
        except Exception as error:
            (PRIVATE/f'rejected-fit-{tract}-{time.time_ns()}.json').write_text(canonical({'status':'rejected','tractGeoid':tract,'seed':args.seed,'error':str(error)})+'\n')
            raise
        receipts.append(receipt)
        print(json.dumps({k:v for k,v in receipt.items() if k!='controls'}),flush=True)
    (PRIVATE/'fitted-households.json').write_text(canonical(result)+'\n')
    Path('fixtures/v2/sources/tract-controls-v2.json').write_text(canonical(controls)+'\n')
    receipt={'seed':args.seed,'donors':donor_receipt,'tracts':receipts,'elapsedSeconds':round(time.monotonic()-started,3),
        'excludedUniverses':['Group quarters excluded from donors; total-population B01001 used only for aggregate exclusion estimate.',
            'Age/sex/language/disability member records retain complete donors but are not calibrated tract marginals.',
            'B18101/B16004/B25024 not fitted: incompatible civilian, age-5+/GQ and vacant-housing universes.'],
        'rejectedPolicies':[{'policy':'Treat published zero estimates as exact structural zeros','status':'rejected',
            'tractGeoid':'48113002200','maximumFeasiblePersons':2974,'requiredPersons':2977,
            'reason':'Exact primary persons infeasible under all other stated margins; survey-zero estimates are not structural zeros. Rare-cell <=2-unit tolerance applies.'}],
        'peakWorkingSetBytes':peak_working_set_bytes(),'rawRetainedBytes':sum(json.loads(p.read_text())['bytes'] for p in raw.glob('*.receipt.json')),
        'custody':{'donorSourceHashes':input_hashes,'donorsSha256':hashlib.sha256(donor_path.read_bytes()).hexdigest(),
            'controlsSha256':file_sha256('fixtures/v2/sources/tract-controls-v2.json'),
            'selectedHouseholdsSha256':hashlib.sha256((PRIVATE/'fitted-households.json').read_bytes()).hexdigest()}}
    Path('fixtures/v2/population/fit-receipt-v2.json').write_text(canonical(receipt)+'\n')
    print(json.dumps({'donors':donor_receipt,'elapsedSeconds':receipt['elapsedSeconds']}),flush=True)


if __name__=='__main__':main()
