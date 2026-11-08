"""Tiny authored road/geography tests; not an OSM acquisition receipt."""
from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/v2'))


class RoadTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT / 'tools/v2/import_roads.py').exists(), 'v2 road admission missing')
        import import_roads
        self.roads = import_roads

    def test_oneway_and_turn_restrictions_survive_normalization(self):
        payload = {'elements': [
            *[{'type':'node','id':i,'lat':32.79,'lon':-96.78+i*.0001} for i in range(1,4)],
            {'type':'way','id':10,'nodes':[1,2],'tags':{'highway':'residential','oneway':'yes'}},
            {'type':'way','id':11,'nodes':[2,3],'tags':{'highway':'residential'}},
            {'type':'relation','id':20,'tags':{'type':'restriction','restriction':'no_straight_on'},'members':[
                {'type':'way','ref':10,'role':'from'},{'type':'node','ref':2,'role':'via'},{'type':'way','ref':11,'role':'to'}]}]}
        graph, _ = self.roads.import_graph(payload)
        self.assertEqual(graph['edges'][0]['direction'], 'forward')
        self.assertIsNone(self.roads.path(graph,'osm-n1','osm-n3'))
        self.assertIsNone(self.roads.route_waypoints(graph,'osm-n1',['osm-n2','osm-n3']))
        self.assertIsNone(self.roads.path(graph,'osm-n2','osm-n1'))

    def test_restricted_way_never_enters_driving_graph(self):
        payload={'elements':[{'type':'node','id':1,'lat':32.79,'lon':-96.78},{'type':'node','id':2,'lat':32.791,'lon':-96.78},
            {'type':'way','id':10,'nodes':[1,2],'tags':{'highway':'residential','access':'private'}}]}
        graph, stats=self.roads.import_graph(payload)
        self.assertEqual(graph['edges'],[])
        self.assertIn('restricted-motorcar-access',stats['excludedWays'])

    def test_scc_cannot_erase_only_target_while_retaining_incoming_way(self):
        # The only allowed departure is a one-way dead end outside the SCC.
        # Keeping the incoming way after dropping the rule invents a U-turn.
        payload={'elements':[
            *[{'type':'node','id':i,'lat':32.79+i*.0001,'lon':-96.78} for i in (1,2,3,4)],
            {'type':'way','id':10,'nodes':[1,2],'tags':{'highway':'residential'}},
            {'type':'way','id':11,'nodes':[2,3],'tags':{'highway':'residential','oneway':'yes'}},
            {'type':'way','id':20,'nodes':[2,4],'tags':{'highway':'residential'}},
            {'type':'way','id':21,'nodes':[4,1],'tags':{'highway':'residential'}},
            {'type':'relation','id':30,'tags':{'type':'restriction','restriction':'only_right_turn'},'members':[
                {'type':'way','ref':10,'role':'from'},{'type':'node','ref':2,'role':'via'},{'type':'way','ref':11,'role':'to'}]}]}
        normalized,_=self.roads.import_graph(payload)
        self.assertIn('osm-r30',{r['id'] for r in normalized['restrictions']})
        retained=self.roads.largest_driving_component(normalized)
        self.assertNotIn(10,{edge['osmWayId'] for edge in retained['edges']},
            'SCC erased the only-turn target/rule while retaining its incoming approach')

    def test_published_dallas_no_longer_admits_reported_commerce_uturn(self):
        graph=json.loads((ROOT/'fixtures/v2/maps/dallas-roads-v2.json').read_text(encoding='utf-8'))
        edge='osm-w1351901654-n5929220474-n82036066-i1'
        route=self.roads.route_waypoints(graph,'osm-n5929220474',['osm-n82036066','osm-n5929220474'])
        self.assertTrue(route is None or route[1]!=(edge+':f',edge+':r'),
            'SCC dropped only_right_turn relation 16355259 and admitted the forbidden 152882ms U-turn')


if __name__ == '__main__': unittest.main()
