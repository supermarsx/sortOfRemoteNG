"""Current R5 source identity/authority tests; no Git/LLVM execution."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import acquire as data
import checkpoint
import producer as boot

BASE=json.loads((HERE/'profile.json').read_bytes())
SELECTED=json.loads((HERE/'reviewed-20261021-source-profile.json').read_bytes())


def clock():return data.Clock(time.time()+30,time.monotonic()+30)


class ReviewedSourceTests(unittest.TestCase):
    def test_profile_and_all_payload_helper_pins_are_exact_before_import(self):
        p=boot.reviewed_profile(copy.deepcopy(BASE),clock())
        self.assertEqual(hashlib.sha256((HERE/'reviewed-20261021-source-profile.json').read_bytes()).hexdigest(),boot.REVIEWED_PROFILE_SHA)
        self.assertEqual(p['sourceGn']['helpersSourceCommit'],'0fd6ebc70f110ff80909fe996fb4abf5499c9468')
        self.assertEqual(len(p['sourcePaths']),62)
        for row in (*p['sourceGn']['helpers'],*p['sourceGn']['sourceData']):
            raw=(boot.ROOT/row['path']).read_bytes()
            self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(row['bytes'],row['sha256']),row['path'])
        lock=json.loads((boot.ROOT/p['sourceGn']['namespace']/'source-lock.json').read_bytes())
        identity=hashlib.sha256(json.dumps(lock,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(identity,p['sourceGn']['sourceId'])
        self.assertEqual(identity,'fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa')
        self.assertEqual(len(lock['patches']),23)
        self.assertEqual(lock['bridge']['patchId'],'sorng-tls-v2-682c378-5')
        self.assertEqual(lock['bridge']['header']['sha256'],'1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e')
        self.assertFalse(any('disk-cache'in row['path']for row in lock['patches']))

    def test_old_host_closure_is_exact_and_foreign_image_or_mixed_profile_denied(self):
        p=boot.reviewed_profile(copy.deepcopy(BASE),clock())
        self.assertEqual(p['sourceGn']['hostClosure'],BASE['sourceGn']['hostClosure'])
        self.assertEqual(p['sourceGn']['hostTools'],BASE['sourceGn']['hostTools'])
        rows=boot.source_host_closure_rows(p,boot.REVIEWED_IMAGE)
        self.assertEqual(len(rows),18)
        self.assertEqual(p['sourceGn']['hostClosure']['edgeCount'],242)
        self.assertEqual(p['sourceGn']['hostClosure']['edgeSha256'],
            '78537ac08d4dddabd50a5c83cdbd676114fdf03cf9abe670359c4ffd20ba5d9a')
        for image in ('20261030.294.1','20261022.278.1'):
            with self.assertRaises(data.Denied):boot.source_host_closure_rows(p,image)
        boot.source_execution_policy(p)
        for mode in ('current-source-gn','source-gn'):
            mixed=copy.deepcopy(p);mixed['sourceGn']['mode']=mode
            with self.assertRaises(data.Denied):boot.source_execution_policy(mixed)
        current=boot.current_profile(copy.deepcopy(BASE),clock())
        self.assertEqual(current['image'],'20261030.294.1')
        self.assertEqual(current['sourceGn']['sourceId'],
            'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90')
        self.assertEqual(current['sourceGn']['hostClosure']['image'],'20261030.294.1')

    def test_new_phase_cannot_admit_legacy_branch_or_compiler_roles(self):
        c={'kind':'windows-arm-full-sdk-context','mode':boot.REVIEWED_MODE,
            'repository':'supermarsx/sortOfRemoteNG','repositoryId':'1010282954','visibility':'public',
            'event':'workflow_dispatch','defaultBranch':'main','ref':boot.REVIEWED_REF,
            'inputs':{'mode':boot.REVIEWED_MODE},'workflow':boot.CURRENT_WORKFLOW,
            'workflowSha':'a'*40,'head':'a'*40,'image':boot.REVIEWED_IMAGE,'runId':'1','attempt':'1'}
        boot.bootstrap_authority(c,BASE)
        for key,value in [('ref',boot.SOURCE_GN_REF),('ref',boot.PREFLIGHT_REF),('ref',boot.CURRENT_REF),
                ('image','20261030.294.1'),('mode','source-gn'),('workflow',BASE['sourcePaths'][0])]:
            with self.assertRaises(data.Denied):boot.bootstrap_authority({**c,key:value},BASE)
        for role in (*boot.ROLES,'operation','source-gn','metrics-fixture'):boot.role_in_mode(role,c)
        for role in ('git-version','clang-version','compile','sdk','preflight'):
            with self.assertRaises(data.Denied):boot.role_in_mode(role,c)
        for mode in ('input-closure','command-inventory','source-gn','source-preflight'):
            with self.assertRaises(data.Denied):boot.role_in_mode('metrics-fixture',{'mode':mode})

    def test_actual_old_mode_rejects_wrong_image_or_changed_bytes_before_any_data_job(self):
        import tempfile
        from types import SimpleNamespace
        p=boot.reviewed_profile(copy.deepcopy(BASE),clock())
        actual=boot.verify_source_host_closure
        def changed_reader(path,current,**pins):
            expected=next(row for row in BASE['sourceGn']['hostClosure']['rows'] if row['path']==path)
            self.assertEqual(pins['sha256'],expected['sha256'])
            self.assertEqual(pins['expected_size'],expected['bytes'])
            raise data.Denied('ACQ_HASH')
        for image,failure in (('20261030.294.1','FULL_HOST_IMAGE'),(boot.REVIEWED_IMAGE,'ACQ_HASH')):
            with self.subTest(image=image),tempfile.TemporaryDirectory()as folder:
                root=Path(folder).resolve()
                def verify(profile,current,observed,**kwargs):
                    return actual(profile,current,observed,reader=changed_reader,**kwargs)
                with patch.dict(sys.modules,{'job':SimpleNamespace()}),\
                     patch.object(boot,'verify_source_host_closure',side_effect=verify),\
                     patch.object(boot,'source_capacity',side_effect=AssertionError('capacity must not run')):
                    self.assertEqual(boot.operation(root,{'mode':boot.REVIEWED_MODE,'image':image},p,clock()),1)
                report=json.loads((root/'bootstrap-result.json').read_bytes())
                self.assertEqual(report['firstFailure'],failure)
                self.assertEqual(report['jobs'],[])

    def test_only_mode_sealed_profile_selects_new_driver_and_keeps_limits(self):
        p=boot.reviewed_profile(copy.deepcopy(BASE),clock());root=boot.ROOT/'.artifacts/windows-arm-full-sdk-fixture'
        with patch.object(boot,'CONTEXT_SHA','a'*64),patch('os.getcwd',return_value=str(root)):
            argv=boot.worker_argv('source-gn',root,p)
            self.assertTrue(argv[3].endswith('reviewed-20261021-source-driver.mjs'))
            self.assertEqual(boot.closed_worker_command(argv,root,p),'source-gn')
            with self.assertRaises(data.Denied):boot.closed_worker_command(argv,root,BASE)
        self.assertEqual(p['sourceGn']['limits'],BASE['sourceGn']['limits'])
        self.assertEqual(boot.worker_policy('source-gn',{'mode':boot.REVIEWED_MODE}),
            {'processes':64,'memoryBytes':8*1024**3,'cpuRate':2500})
        for key in ('compilerAllowed','sdkAllowed','checkpointAllowed','restoreAllowed'):
            self.assertIs(p['sourceGn'][key],False)


if __name__=='__main__':unittest.main()
