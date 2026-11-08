"""Authored donor records verify full-member admission and exclusions."""
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/v2'))


def housing(serial='HU00000000001',size=7,**extra):
    return {'RT':'H','STATE':'48','PUMA':'02313','SERIALNO':serial,'TYPEHUGQ':'1','NP':str(size),'WGTP':'10','HHT':'1','VEH':'2','TEN':'1',**extra}


def person(order,serial='HU00000000001',**extra):
    return {'RT':'P','STATE':'48','PUMA':'02313','SERIALNO':serial,'SPORDER':str(order),'AGEP':'30','SEX':'1','RELSHIPP':'20' if order==1 else '25','DIS':'2','LANX':'1','LANP':'','PWGTP':'11',**extra}


class PopulationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT/'tools/v2/fit_population.py').exists(),'v2 whole-household fit missing')
        import fit_population
        self.population=fit_population

    def test_whole_seven_member_household_and_string_serial(self):
        donors,receipt=self.population.join_donors([housing()], [person(i) for i in range(1,8)])
        self.assertEqual(donors[0]['housing']['SERIALNO'],'HU00000000001')
        self.assertEqual(len(donors[0]['members']),7)
        self.assertEqual(receipt['completeDonors'],1)

    def test_gq_np_one_and_vacancy_do_not_enter_households(self):
        donors,receipt=self.population.join_donors([housing('GQ00000000001',1,TYPEHUGQ='2'),housing('HU00000000002',0)],
            [person(1,'GQ00000000001')])
        self.assertEqual(donors,[])
        self.assertEqual(receipt['excludedHousing']['group-quarters'],1)

    def test_orphan_duplicate_and_clipped_members_rejected(self):
        cases=[([housing(size=2)],[person(1)]),([housing(size=1)],[person(1),person(1)]),([],[person(1)]),
            ([housing(size=2)],[person(1),person(1,SPORDER='01',RELSHIPP='25')]),
            ([housing(size=2)],[person(1),person(3)])]
        for hs,ps in cases:
            with self.assertRaises(ValueError):self.population.join_donors(hs,ps)

    def test_incompatible_universe_never_becomes_household_margin(self):
        for table in ('B01001','B18101','B16004','B25024'):
            with self.assertRaises(ValueError):self.population.control_feature(table,1,housing(size=2))


if __name__=='__main__':unittest.main()
