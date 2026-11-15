"""Admission-only controls. No native host claim, production IO or worker spawn."""
import copy
import importlib.util
import inspect
import json
from pathlib import Path
import sys
import time
import unittest

ROOT=Path(__file__).resolve().parents[3]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
archive=load('qualified_archive','scripts/lib/cef-checkpoint-archive.py')
census=load('qualified_census','scripts/lib/cef-mac-process-census.py')
PIN=archive.MAC_SOURCE_SCOPE_QUALIFICATION
SOURCES=dict(PIN[20])
OLD={'aarch64-apple-darwin':'65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54','x86_64-apple-darwin':'684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef'}
def identity(target,source):
    return {'target':target,'source':source,'image':PIN[19],'canonicalRoot':'/Users/runner/work/_temp/sorng-cef-engineering/'+target+'/'+source}
def context(target,source,evidence=None):
    return {'kind':'mac-census-session','mode':'integration-proof','target':target,'source':source,'canonicalRoot':identity(target,source)['canonicalRoot'],'image':PIN[19],'phase':'compile','workMilliseconds':1000,'leaseMilliseconds':2000,'wallEndMilliseconds':int(time.time()*1000)+2000,'requestBudget':132,'evidence':census.NATIVE_EVIDENCE,'supervisorEvidence':PIN[18]if evidence is None else evidence}
ROOT_ONLY=Path('/Users/runner/work/_temp/cef-mac-census-integration-11111111-1111-4111-8111-111111111111/cef-mac-census-session-22222222-2222-4222-8222-222222222222')

class Qualification(unittest.TestCase):
    def tearDown(self):
        archive.MAC_SOURCE_SCOPE_QUALIFICATION=archive._MAC_SOURCE_SCOPE_QUALIFICATION_PIN
        census.MAC_SOURCE_SCOPE_QUALIFICATION=census._MAC_SOURCE_SCOPE_QUALIFICATION_PIN
    def test_actual_archive_and_census_records_are_identical_and_use_fresh_outer(self):
        self.assertEqual(PIN,census.MAC_SOURCE_SCOPE_QUALIFICATION)
        self.assertEqual(len(PIN),23);self.assertEqual(PIN[1:4],(43652853463,1,'4dbcb84855ea9cd9ee632657bafd265a6491fc69'))
        self.assertEqual(PIN[18],'bcced5eb54b04a47e9ee34ef6394ea142ec74073fee22c22ec44ef2285bf0ef3')
        self.assertNotEqual(PIN[18],census.NATIVE_SUPERVISOR_QUALIFICATION['sha256'])
    def test_only_the_two_fresh_exact_source_image_pairs_qualify(self):
        for target,source in SOURCES.items():
            for module,check in [(archive,archive.source_mac_scope_qualified),(census,census.native_scope_qualified)]:
                self.assertTrue(check(target,source,PIN[19]))
                self.assertFalse(check(target,OLD[target],PIN[19]));self.assertFalse(check(target,'0'*64,PIN[19]));self.assertFalse(check(target,source,'latest'))
    def test_missing_or_forged_qualification_cannot_be_replaced_by_report_data(self):
        for value in [None,{},dict(runId=43652853463,complete=True),tuple(list(PIN)[:18]+['0'*64]+list(PIN)[19:])]:
            archive.MAC_SOURCE_SCOPE_QUALIFICATION=value;census.MAC_SOURCE_SCOPE_QUALIFICATION=value
            for target,source in SOURCES.items():
                self.assertFalse(archive.source_mac_scope_qualified(target,source,PIN[19]));self.assertFalse(census.native_scope_qualified(target,source,PIN[19]))
    def test_literal_scope_retarget_without_fresh_qualification_is_denied(self):
        previous=archive.MAC_SOURCE;archive.MAC_SOURCE='f'*64
        before=archive.source_mac_write_host_admission;archive.source_mac_write_host_admission=lambda:None
        try:
            with self.assertRaisesRegex(archive.CheckpointError,'source-mac-identity-scope'):archive.source_mac_write_admission(identity('aarch64-apple-darwin','f'*64))
        finally:archive.MAC_SOURCE=previous;archive.source_mac_write_host_admission=before
    def test_original_admission_without_qualification_was_red_for_current_scope(self):
        old=inspect.getsource(archive.source_mac_write_admission).replace("source_mac_scope_qualified('aarch64-apple-darwin', MAC_SOURCE, MAC_SOURCE_IMAGE) and\n            ","",1)
        self.assertNotEqual(old,inspect.getsource(archive.source_mac_write_admission))
        scope=dict(archive.__dict__);scope['source_mac_write_host_admission']=lambda:None;exec(old,scope)
        before=archive.source_mac_write_host_admission;archive.source_mac_write_host_admission=lambda:None;archive.MAC_SOURCE_SCOPE_QUALIFICATION=None
        try:
            good=identity('aarch64-apple-darwin',SOURCES['aarch64-apple-darwin'])
            scope['source_mac_write_admission'](good)  # Old scalar gate accepted the unsupported scope.
            with self.assertRaisesRegex(archive.CheckpointError,'source-mac-identity-scope'):archive.source_mac_write_admission(good)
        finally:archive.source_mac_write_host_admission=before
    def test_actual_worker_parser_accepts_current_and_rejects_historical_inner_hash(self):
        for target,source in SOURCES.items():
            value=context(target,source);self.assertEqual(census.native_context(ROOT_ONLY,json.dumps(value)),value)
            with self.assertRaisesRegex(census.CensusError,'CENSUS_ROOT'):census.native_context(ROOT_ONLY,json.dumps(context(target,source,census.NATIVE_SUPERVISOR_QUALIFICATION['sha256'])))
    def test_actual_worker_parser_rejects_missing_source_qualification_and_extra_report_keys(self):
        for target,source in SOURCES.items():
            value=context(target,source);value['sourceScopeQualification']={'complete':True}
            with self.assertRaisesRegex(census.CensusError,'CENSUS_ROOT'):census.native_context(ROOT_ONLY,json.dumps(value))
        census.MAC_SOURCE_SCOPE_QUALIFICATION=None
        with self.assertRaisesRegex(census.CensusError,'CENSUS_ROOT'):census.native_context(ROOT_ONLY,json.dumps(context('aarch64-apple-darwin',SOURCES['aarch64-apple-darwin'])))
    def test_production_census_flag_still_denies_before_production_path_io(self):
        previous=census.PRODUCTION_CENSUS_ADMITTED;census.PRODUCTION_CENSUS_ADMITTED=False
        try:
            for target,source in SOURCES.items():
                value=context(target,source);value['mode']='production'
                with self.assertRaisesRegex(census.CensusError,'CENSUS_UNADMITTED'):census.native_context(Path('/never-created-by-qualification-tests'),json.dumps(value))
        finally:census.PRODUCTION_CENSUS_ADMITTED=previous

if __name__=='__main__':
    if sys.argv[1:]==['--record']:print(json.dumps(PIN))
    else:unittest.main()
