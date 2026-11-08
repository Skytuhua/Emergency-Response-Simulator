"""Authored malformed snippets test admission; none is a Census observation."""
import importlib.util
import io
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'v2'))


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT / 'tools/v2/acquire_sources.py').exists(), 'v2 source admission parser is missing')
        import acquire_sources
        self.source = acquire_sources

    def test_html_and_arcgis_errors_are_rejected(self):
        for data in (b'<html>rate limit</html>', b'{"error":{"code":400}}'):
            with self.assertRaises(ValueError):
                self.source.parse_arcgis(data, ['48113001502'])

    def test_arcgis_requires_complete_4326_geography(self):
        import json
        good = {'spatialReference': {'wkid': 4326}, 'features': [{'attributes': {'GEOID': '48113001502'}, 'geometry': {'rings': [[[0,0],[1,0],[1,1],[0,0]]]}}]}
        self.assertEqual(len(self.source.parse_arcgis(json.dumps(good).encode(), ['48113001502'])), 1)
        for patch in ({'exceededTransferLimit': True}, {'spatialReference': {'wkid': 3857}}, {'features': []}):
            with self.assertRaises(ValueError):
                self.source.parse_arcgis(json.dumps({**good, **patch}).encode(), ['48113001502'])

    def test_bulk_parser_rejects_api_columns_duplicates_and_jam_values(self):
        for data in ('GEO_ID|B11001_001E|B11001_001M\n1400000US48113001502|3|2\n',
                     'GEO_ID|B11001_E001|B11001_M001\n1400000US48113001502|3|2\n1400000US48113001502|3|2\n',
                     'GEO_ID|B11001_E001|B11001_M001\n1400000US48113001502|-666666666|2\n'):
            with self.assertRaises(ValueError):
                self.source.parse_table(io.StringIO(data), 'B11001', ['48113001502'], expected_lines=1)

    def test_bulk_parser_retains_raw_estimate_and_moe(self):
        rows = self.source.parse_table(io.StringIO('GEO_ID|B11001_E001|B11001_M001\n1400000US48113001502|3|2\n'), 'B11001', ['48113001502'], expected_lines=1)
        self.assertEqual(rows[0]['estimate'], 3)
        self.assertEqual(rows[0]['estimateRaw'], '3')
        self.assertEqual(rows[0]['moe'], 2)

    def test_hash_mismatch_and_incomplete_zip_rejected(self):
        with self.assertRaises(ValueError):
            self.source.verify_bytes(b'abc', '0' * 64)
        with self.assertRaises(ValueError):
            self.source.validate_zip(io.BytesIO(b'PK incomplete'), 'psam_h48.csv')


if __name__ == '__main__':
    unittest.main()
