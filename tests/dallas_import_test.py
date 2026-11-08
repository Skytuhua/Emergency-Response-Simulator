"""Offline normalization regressions: python -m unittest discover -s tests -p dallas_import_test.py."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('dallas_import', Path(__file__).parents[1] / 'tools/import_dallas.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def node(i, x=0, y=0, **tags):
    return {'type': 'node', 'id': i, 'lon': -96.78 + x / 10000, 'lat': 32.79 + y / 10000, 'tags': tags}


def way(i, refs, **tags):
    return {'type': 'way', 'id': i, 'nodes': refs, 'tags': {'highway': 'residential', 'name': 'Demo road', **tags}}


class DallasImportTest(unittest.TestCase):
    def test_distinct_way_u_turn_relation_is_not_limited_to_endpoint_reversal(self):
        relation = {'type':'relation', 'id':1, 'tags':{'type':'restriction', 'restriction':'no_u_turn'},
                    'members':[{'type':'way','ref':1,'role':'from'}, {'type':'node','ref':2,'role':'via'}, {'type':'way','ref':2,'role':'to'}]}
        graph, _ = self.normalize([node(1), node(2, 1), node(3, 2), way(1, [1,2]), way(2, [2,3]), relation])
        self.assertIsNone(module.path(graph, 'osm-n1', 'osm-n3'))

    def normalize(self, elements):
        return module.import_graph({'elements': elements})

    def test_access_precedence_oneway_roundabout_and_barriers(self):
        elements = [node(i, i) for i in range(1, 8)]
        elements += [way(1, [1, 2], oneway='-1'), way(2, [2, 3], junction='roundabout'),
                     way(3, [3, 4], access='private'), way(4, [4, 5], access='private', motorcar='yes'),
                     way(5, [5, 6], **{'motor_vehicle:conditional': 'yes @ (Mo-Fr)'}),
                     way(6, [6, 7], **{'motorcar:forward': 'no'})]
        graph, stats = self.normalize(elements)
        edges = {e['osmWayId']: e for e in graph['edges']}
        self.assertEqual(edges[1]['direction'], 'reverse')
        self.assertEqual(edges[2]['direction'], 'forward')
        self.assertNotIn(3, edges)
        self.assertIn(4, edges)
        self.assertNotIn(5, edges)
        self.assertEqual(edges[6]['direction'], 'reverse')
        self.assertTrue(stats['excludedWays'])
        blocked, _ = self.normalize([node(1), node(2, 1, barrier='bollard'), node(3, 2), way(1, [1, 2, 3])])
        self.assertEqual(blocked['edges'], [])

    def test_real_topology_does_not_join_geometric_crossing_and_keeps_curve(self):
        elements = [node(1, 0, 0), node(2, 1, 1), node(3, 2, 0), node(4, 1, -1), node(5, 1, 2),
                    way(1, [1, 2, 3]), way(2, [4, 5], bridge='yes', layer='1')]
        graph, _ = self.normalize(elements)
        self.assertEqual(len(graph['edges']), 2)
        self.assertEqual(len(graph['edges'][0]['geometry']), 3)
        self.assertFalse({graph['edges'][0]['from'], graph['edges'][0]['to']} & {graph['edges'][1]['from'], graph['edges'][1]['to']})
        a, b, c = graph['edges'][0]['geometry']
        self.assertGreater(graph['edges'][0]['lengthMeters'], module.haversine(a, c))

    def test_supported_via_node_and_fail_closed_unsupported_restrictions(self):
        relation = {'type': 'relation', 'id': 1, 'tags': {'type': 'restriction', 'restriction': 'no_left_turn'},
                    'members': [{'type': 'way', 'ref': 1, 'role': 'from'}, {'type': 'node', 'ref': 2, 'role': 'via'}, {'type': 'way', 'ref': 2, 'role': 'to'}]}
        elements = [node(1), node(2, 1), node(3, 2), way(1, [1, 2]), way(2, [2, 3]), relation]
        graph, _ = self.normalize(elements)
        self.assertEqual(graph['restrictions'][0]['viaNodeId'], 'osm-n2')
        relation['tags']['restriction:conditional'] = 'no_left_turn @ (Mo-Fr)'
        graph, stats = self.normalize(elements)
        self.assertEqual(graph['edges'], [])
        self.assertEqual(stats['unsupportedRestrictionIds'], [1])
        del relation['tags']['restriction']
        graph, stats = self.normalize(elements)
        self.assertEqual(graph['edges'], [])
        self.assertEqual(stats['unsupportedRestrictionIds'], [1])
        relation['tags'] = {'type': 'restriction', 'restriction': 'no_left_turn'}
        relation['members'][1] = {'type': 'way', 'ref': 3, 'role': 'via'}
        graph, stats = self.normalize(elements + [way(3, [2, 3])])
        self.assertEqual(graph['edges'], [])
        self.assertEqual(stats['unsupportedRestrictionIds'], [1])

    def test_input_order_is_irrelevant(self):
        elements = [node(1), node(2, 1), node(3, 2), way(1, [1, 2, 3])]
        self.assertEqual(self.normalize(elements), self.normalize(list(reversed(elements))))

    def test_overpass_recurse_duplicate_objects_do_not_duplicate_streets(self):
        elements = [node(1), node(2, 1), node(3, 2), way(1, [1, 2, 3])]
        graph, _ = self.normalize(elements)
        duplicated, _ = self.normalize(elements + elements + [{'type': 'way', 'id': 1, 'nodes': [1, 2, 3]}])
        self.assertEqual(graph, duplicated)


if __name__ == '__main__':
    unittest.main()
