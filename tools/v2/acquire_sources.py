"""No-key official ACS2024/TIGERweb acquisition with complete-byte custody.

Raw files stay private. A cached file is reused only after its recorded hash is
verified. Failed attempts never replace a complete cached response.
"""
import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import zipfile

TRACTS = ('48113001502', '48113002200')
BASE = 'https://www2.census.gov/programs-surveys/acs/'
TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/'
TABLE_LINES = {'B11001': 9, 'B11016': 16, 'B08201': 30, 'B25008': 3, 'B01001': 49}
UNIVERSES = {'B11001': 'households', 'B11016': 'households', 'B08201': 'households', 'B25008': 'occupied-housing-persons', 'B01001': 'total-population-including-group-quarters'}
USER_AGENT = 'CatastropheResponseSimulator/2.0 (public Census/OSM research; no paid services)'


def canonical(value):
    def normalize(item):
        if isinstance(item,float):
            if not math.isfinite(item):raise ValueError('Canonical data requires finite numbers')
            return int(item) if item.is_integer() else item
        if isinstance(item,list):return [normalize(entry) for entry in item]
        if isinstance(item,dict):return {key:normalize(entry) for key,entry in item.items()}
        return item
    return json.dumps(normalize(value), sort_keys=True, separators=(',', ':'), ensure_ascii=False,allow_nan=False)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def peak_working_set_bytes():
    """Measured process high-water RSS, or None on unsupported hosts."""
    try:
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in (
                'PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage',
                'QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]
        counters=Counters();counters.cb=ctypes.sizeof(counters)
        if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(-1),ctypes.byref(counters),counters.cb):return counters.PeakWorkingSetSize
    except (AttributeError,OSError):
        try:
            import resource
            return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
        except ImportError:pass
    return None


def verify_bytes(raw, expected):
    if sha256(raw) != expected:
        raise ValueError('Retained input hash mismatch')


def parse_arcgis(raw, expected_ids):
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError('ArcGIS response is not JSON') from error
    if data.get('error') or data.get('exceededTransferLimit'):
        raise ValueError('ArcGIS error or transfer limit')
    if data.get('spatialReference', {}).get('wkid') != 4326:
        raise ValueError('Geometry CRS must be EPSG:4326')
    features = data.get('features', [])
    ids = [str(feature.get('attributes', {}).get('GEOID')) for feature in features]
    if len(set(ids)) != len(ids) or set(ids) != set(expected_ids):
        raise ValueError('Missing, duplicate or unexpected geography')
    for feature in features:
        rings = feature.get('geometry', {}).get('rings')
        if not rings or any(len(ring) < 4 or ring[0] != ring[-1] for ring in rings):
            raise ValueError('Unclosed or missing polygon ring')
    return features


def parse_table(stream, table, tract_ids=TRACTS, expected_lines=None):
    count = expected_lines or TABLE_LINES[table]
    reader = csv.reader(stream, delimiter='|')
    header = next(reader, [])
    expected = ['GEO_ID'] + [f'{table}_{kind}{line:03}' for line in range(1, count + 1) for kind in ('E', 'M')]
    if header != expected:
        raise ValueError(f'{table} wrong bulk columns/schema')
    wanted = {f'1400000US{tract}' for tract in tract_ids}
    seen, output = set(), []
    for cells in reader:
        if not cells or cells[0] not in wanted:
            continue
        if len(cells) != len(header) or cells[0] in seen:
            raise ValueError('Duplicate target GEO_ID or wrong target cell count')
        seen.add(cells[0])
        for line in range(1, count + 1):
            raw_e, raw_m = cells[2 * line - 1:2 * line + 1]
            try:
                estimate, moe = int(raw_e), int(raw_m)
            except ValueError as error:
                raise ValueError('Missing or noninteger required control') from error
            # Negative ACS jam/suppression cells cannot become fitted numbers.
            if estimate < 0 or moe < 0:
                raise ValueError('Unsupported ACS special value in required control')
            output.append({'tractGeoid': cells[0][9:], 'tableId': table, 'lineId': f'{line:03}',
                           'sourceField': header[2 * line - 1], 'universeId': UNIVERSES[table],
                           'estimateRaw': raw_e, 'moeRaw': raw_m, 'estimate': estimate, 'moe': moe,
                           'specialValueReason': None, 'status': 'admitted', 'receiptRef': f'acs2024-{table.lower()}'})
    if seen != wanted:
        raise ValueError('Missing required target GEO_ID')
    return output


def validate_zip(source, expected_name):
    try:
        with zipfile.ZipFile(source) as archive:
            names = archive.namelist()
            if names.count(expected_name) != 1 or len(names) != len(set(names)):
                raise ValueError('Missing/duplicate PUMS ZIP entry')
            bad = archive.testzip()
            if bad:
                raise ValueError(f'Truncated/CRC-invalid PUMS entry {bad}')
    except zipfile.BadZipFile as error:
        raise ValueError('Incomplete ZIP source') from error


def acquire(source_id, url, directory, max_bytes, *, post_data=None, method='GET', format_hint=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    target, receipt_path = directory / source_id, directory / f'{source_id}.receipt.json'
    if target.exists() and receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        if receipt.get('url') != url or receipt.get('method') != method or receipt.get('requestBody') != (post_data.decode() if post_data else None):
            raise ValueError('Source ID reused for a different request')
        digest = file_sha256(target)
        if digest != receipt['sha256'] or target.stat().st_size != receipt['bytes']:
            raise ValueError('Cached input hash mismatch')
        return receipt
    started = time.monotonic()
    attempt = {'id': source_id, 'url': url, 'method': method, 'requestBody': post_data.decode() if post_data else None,
               'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'release': 'OpenStreetMap snapshot' if source_id=='osm-roads.json' else '2020 Census blocks' if source_id=='blocks2020.json' else '2020 Census PUMA' if source_id=='puma.json' else 'ACS2024 geography' if source_id=='tracts.json' else 'ACS 2020-2024 / source policy metadata',
               'status': 'rejected', 'parserVersion': 'dallas-data-acquisition-v2.1'}
    temporary = directory / f'{source_id}.partial'
    try:
        request = Request(url, data=post_data, method=method, headers={'User-Agent': USER_AGENT, **({'Content-Type': 'application/x-www-form-urlencoded'} if post_data else {})})
        with urlopen(request, timeout=180) as response, temporary.open('wb') as output:
            if response.status != 200:
                raise ValueError(f'Full source requires HTTP 200, received {response.status}')
            expected = int(response.headers['Content-Length']) if response.headers.get('Content-Length') else None
            total, digest = 0, hashlib.sha256()
            prefix = b''
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError('Source exceeds frozen byte ceiling')
                if not prefix:
                    prefix = chunk[:1024].lstrip().lower()
                    if prefix.startswith((b'<!doctype html', b'<html')) and format_hint != 'html':
                        raise ValueError('HTTP 200 HTML is not source data')
                output.write(chunk)
                digest.update(chunk)
            if total == 0 or expected is not None and total != expected:
                raise ValueError('Truncated source bytes')
            attempt.update({'status': 'downloaded', 'httpStatus': response.status, 'finalUrl': response.url,
                            'contentType': response.headers.get('Content-Type'), 'bytes': total, 'sha256': digest.hexdigest(),
                            'elapsedSeconds': round(time.monotonic() - started, 3), 'completeResponse': True,
                            'peakWorkingSetBytes':peak_working_set_bytes()})
        temporary.replace(target)
        receipt_path.write_text(json.dumps(attempt, indent=2) + '\n', encoding='utf-8')
        return attempt
    except Exception as error:
        attempt.update({'error': str(error), 'elapsedSeconds': round(time.monotonic() - started, 3)})
        (directory / f'{source_id}.failed-{time.time_ns()}.json').write_text(json.dumps(attempt, indent=2) + '\n')
        raise


def query_url(layer, where, fields='*'):
    return TIGER + str(layer) + '/query?' + urlencode({'f': 'json', 'where': where, 'outFields': fields, 'returnGeometry': 'true', 'outSR': 4326})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.private/dallas-v2-data/raw'))
    args = parser.parse_args()
    sources = [(f'acs2024-{table.lower()}.dat', BASE + f'summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-{table.lower()}.dat', 240_000_000) for table in TABLE_LINES]
    sources += [('csv_htx.zip', BASE + 'data/pums/2024/5-Year/csv_htx.zip', 90_000_000),
                ('csv_ptx.zip', BASE + 'data/pums/2024/5-Year/csv_ptx.zip', 210_000_000),
                ('table-shells.txt', BASE + 'summary_file/2024/table-based-SF/documentation/ACS20245YR_Table_Shells.txt', 6_000_000),
                ('pums-dictionary.txt', BASE + 'tech_docs/pums/data_dict/PUMS_Data_Dictionary_2020-2024.txt', 3_000_000),
                ('pums-record-count.csv',BASE+'tech_docs/pums/estimates/pums_record_count_20_24.csv',100_000),
                ('tracts.json', query_url(8, "GEOID IN ('48113001502','48113002200')"), 500_000),
                ('puma.json', query_url(0, "GEOID='4802313'"), 500_000),
                ('service-metadata.json', TIGER + '?f=pjson', 1_000_000)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        future_ids = {pool.submit(acquire, ident, url, args.directory, ceiling): ident for ident, url, ceiling in sources}
        failed = []
        for future in concurrent.futures.as_completed(future_ids):
            try:
                receipt = future.result()
                print(json.dumps({key: receipt[key] for key in ('id', 'bytes', 'sha256', 'status')}), flush=True)
            except Exception as error:
                failed.append(future_ids[future])
                print(json.dumps({'id': future_ids[future], 'status': 'rejected', 'error': str(error)}), flush=True)
    if failed:
        raise SystemExit('Incomplete source acquisition: ' + ', '.join(failed))


if __name__ == '__main__':
    main()
