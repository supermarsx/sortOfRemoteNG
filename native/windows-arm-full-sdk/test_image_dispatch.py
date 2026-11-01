"""Both complete tuples, before-data denial, and a fixed union seal; no tool execution."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import acquire as data
import checkpoint
import producer as boot
BASE=json.loads((HERE/'profile.json').read_bytes())
def clock():return data.Clock(time.time()+30,time.monotonic()+30)
def context(image):
    return {'kind':'windows-arm-full-sdk-context','mode':boot.IMAGE_MODE,
        'repository':'supermarsx/sortOfRemoteNG','repositoryId':'1010282954','visibility':'public',
        'event':'workflow_dispatch','defaultBranch':'main','ref':boot.IMAGE_REF,
        'inputs':{'mode':boot.IMAGE_MODE},'workflow':boot.CURRENT_WORKFLOW,
        'workflowSha':'a'*40,'head':'a'*40,'image':image,'runId':'1','attempt':'1'}
class ImageDispatchTests(unittest.TestCase):
    def test_each_actual_profile_has_complete_same_union_and_exact_original_payloads(self):
        for image,tuple_ in boot.IMAGE_TUPLES.items():
            with self.subTest(image=image):
                p=boot.image_profile(copy.deepcopy(BASE),clock(),image)
                raw=(HERE/tuple_['profile']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),tuple_['sha256'])
                self.assertEqual(p['sourcePaths'],list(checkpoint.IMAGE_QUALIFIED_PATHS))
                self.assertEqual(len(set(p['sourcePaths'])),94)
                for name in p['sourcePaths']:self.assertTrue((boot.ROOT/name).is_file(),name)
                for row in (*p['sourceGn']['helpers'],*p['sourceGn']['sourceData']):
                    raw=(boot.ROOT/row['path']).read_bytes()
                    self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(row['bytes'],row['sha256']))
                lock=json.loads((boot.ROOT/tuple_['namespace']/'source-lock.json').read_bytes())
                self.assertEqual(hashlib.sha256(json.dumps(lock,sort_keys=True,separators=(',',':')).encode()).hexdigest(),tuple_['sourceId'])
                self.assertEqual(len(lock['patches']),23)
                self.assertEqual(lock['bridge']['header']['sha256'],'1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e')
                self.assertFalse(any('disk-cache'in row['path']for row in lock['patches']))
                self.assertEqual(p['sourceGn']['limits'],BASE['sourceGn']['limits'])
                self.assertEqual(p['sourceGn']['hostClosure']['image'],image)
                self.assertEqual(p['sourceGn']['hostClosure']['edgeCount'],242)
                self.assertEqual(len(p['sourceGn']['hostClosure']['rows']),18)
                boot.source_execution_policy(p)
                for key in ('compilerAllowed','sdkAllowed','checkpointAllowed','restoreAllowed'):self.assertIs(p['sourceGn'][key],False)
    def test_unknown_images_and_foreign_contexts_cannot_choose_any_tuple(self):
        for image in ('','20261031.294.1','__proto__',None,True,0,{},[]):
            with self.assertRaises(data.Denied):boot.image_profile(copy.deepcopy(BASE),clock(),image)
        for image in boot.IMAGE_TUPLES:
            c=context(image);boot.bootstrap_authority(c,BASE)
            for key,value in [('ref',boot.CURRENT_REF),('ref',boot.REVIEWED_REF),('ref',boot.PREFLIGHT_REF),
                    ('ref','refs/heads/main'),('mode','current-source-gn'),('image','20261031.294.1'),
                    ('inputs',{'mode':boot.IMAGE_MODE,'image':image}),('head','b'*40)]:
                with self.subTest(key=key,value=value),self.assertRaises(data.Denied):boot.bootstrap_authority({**c,key:value},BASE)
            for role in (*boot.ROLES,'operation','source-gn','metrics-fixture'):boot.role_in_mode(role,c)
            for role in ('git-version','clang-version','compile','sdk','preflight'):
                with self.assertRaises(data.Denied):boot.role_in_mode(role,c)
    def test_profile_pin_or_opposite_profile_never_falls_back(self):
        images=list(boot.IMAGE_TUPLES)
        for index,image in enumerate(images):
            with tempfile.TemporaryDirectory()as folder:
                for supplied in (b'{}',(HERE/boot.IMAGE_TUPLES[images[1-index]]['profile']).read_bytes()):
                    target=Path(folder)/boot.IMAGE_TUPLES[image]['profile'];target.write_bytes(supplied)
                    with patch.object(boot,'HERE',Path(folder)),self.assertRaisesRegex(data.Denied,'ACQ_HASH'):
                        boot.image_profile(copy.deepcopy(BASE),clock(),image)
    def test_opposite_sealed_driver_cannot_run_and_resource_caps_stay_fixed(self):
        for image,tuple_ in boot.IMAGE_TUPLES.items():
            p=boot.image_profile(copy.deepcopy(BASE),clock(),image);root=boot.ROOT/'.artifacts/windows-arm-full-sdk-fixture'
            with patch.object(boot,'CONTEXT_SHA','a'*64),patch('os.getcwd',return_value=str(root)):
                argv=boot.worker_argv('source-gn',root,p)
                self.assertTrue(argv[3].endswith(tuple_['driver']))
                self.assertEqual(boot.closed_worker_command(argv,root,p),'source-gn')
                other=next(v for k,v in boot.IMAGE_TUPLES.items()if k!=image)
                argv[3]=str(HERE/other['driver'])
                with self.assertRaises(data.Denied):boot.closed_worker_command(argv,root,p)
            self.assertEqual(boot.worker_policy('source-gn',context(image)),{'processes':64,'memoryBytes':8*1024**3,'cpuRate':2500})
    def test_actual_parent_host_pin_failure_stops_before_capacity_or_data_without_fallback(self):
        for image in boot.IMAGE_TUPLES:
            p=boot.image_profile(copy.deepcopy(BASE),clock(),image)
            with tempfile.TemporaryDirectory()as folder:
                root=Path(folder).resolve()
                with patch.dict(sys.modules,{'job':SimpleNamespace()}),patch.object(boot,'source_capacity',side_effect=AssertionError('no data admission')),\
                     patch.object(boot,'verify_source_host_closure',side_effect=data.Denied('ACQ_HASH'))as verify:
                    self.assertEqual(boot.operation(root,context(image),p,clock()),1)
                self.assertEqual(verify.call_count,1)
                self.assertEqual(verify.call_args.kwargs['reviewed_image'],image)
                report=json.loads((root/'bootstrap-result.json').read_bytes())
                self.assertEqual(report['firstFailure'],'ACQ_HASH');self.assertEqual(report['jobs'],[])
    def test_union_length_is_not_generic_authority_and_encoding_position_is_closed(self):
        paths=list(checkpoint.IMAGE_QUALIFIED_PATHS)
        rows=[{'path':n,'bytes':1,'sha256':'a'*64,'canonicalBytes':1,'canonicalSha256':'a'*64,'encoding':'exact'}for n in paths]
        self.assertEqual(len(checkpoint.closed_sources(rows,paths)),64)
        for altered in (paths[::-1],paths[:-1],paths+['extra'],['fake']+paths[1:]):
            with self.assertRaises(ValueError):checkpoint.closed_sources(rows,altered)
        for index in (12,13,14,15,16,18,19,21,93):
            bad=copy.deepcopy(rows);bad[index]['encoding']='git-crlf'
            with self.assertRaisesRegex(ValueError,'BOOT_SOURCE_ENCODING'):checkpoint.closed_sources(bad,paths)
        for index in (0,10,11,20):
            good=copy.deepcopy(rows);good[index]['encoding']='git-crlf';checkpoint.closed_sources(good,paths)
if __name__=='__main__':unittest.main()
