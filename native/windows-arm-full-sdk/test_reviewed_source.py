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
            if row['path']==boot.CURRENT_MIRROR+'scripts/lib/browser-custom-runtime.mjs':
                # Only the image-qualified recipe adopts reviewed commit8f0b.
                # This old profile/pin stays immutable; normalize that exact delta.
                self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(70755,'f6772b8785ccf96a721013fa93a79c3ae252d19b986e338f59265f3c62f8827f'))
                start=raw.index(b'// Only this separately creation-owned runtime profile')
                end=raw.index(b'async function sourceGitPhysical(file)',start);raw=raw[:start]+raw[end:]
                start=raw.index(b'  let runtimeProfile;\n');end=raw.index(b'  await sourceGitPhysical(directory);',start);raw=raw[:start]+raw[end:]
                raw=raw.replace(b'    runtimeProfile,\n',b'',1)
                start=raw.index(b'    if (policy.runtimeProfile) {\n');end=raw.index(b'    const hooks = await opendir(',start);raw=raw[:start]+raw[end:]
                raw=raw.replace(b'      USERPROFILE:\n        policy.runtimeProfile?.path ?? path.join(policy.directory, "home"),',b'      USERPROFILE: path.join(policy.directory, "home"),',1)
                self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(69741,'7a2fb8f3ca0ba4404050e37b7382fe53789cdb3b70682d1930205508c72a3217'))
                start=raw.index(b'  const windowsLongPaths = options !== undefined;\n')
                end=raw.index(b'  if (\n    !path.isAbsolute(directory)',start)
                raw=raw[:start]+raw[end:]
                raw=raw.replace(b'prepareSourceGitIsolation(directory, options)',b'prepareSourceGitIsolation(directory)',1)
                raw=raw.replace(b'${windowsLongPaths ? "\\tlongpaths = true\\n" : ""}',b'',1)
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

    def test_llvm_diagnostic_categories_are_type_only_bounded_and_redacted(self):
        import socket
        import ssl
        from urllib.error import HTTPError, URLError
        secret='https://user:token@private.invalid/path?secret=token'
        cases=[(HTTPError(secret,503,secret,{'Authorization':secret},None),{'stage':'unknown','category':'http','httpStatus':503}),
            (ssl.SSLError(secret),{'stage':'unknown','category':'tls'}),(TimeoutError(secret),{'stage':'unknown','category':'socket-timeout'}),
            (socket.gaierror(-2,secret),{'stage':'unknown','category':'dns'}),(OSError(secret),{'stage':'unknown','category':'other'})]
        for error,expected in cases:
            for wrapped in (error,URLError(error),URLError(URLError(error))):
                self.assertEqual(boot.llvm_failure_diagnostic(wrapped),expected)
                self.assertNotIn('token',json.dumps(boot.llvm_failure_diagnostic(wrapped)))
        self.assertEqual(boot.llvm_failure_diagnostic(URLError(URLError(URLError(TimeoutError(secret))))),{'stage':'unknown','category':'other'})
        self.assertEqual(boot.llvm_failure_diagnostic(URLError(secret)),{'stage':'unknown','category':'other'})
        cycle=URLError(secret);cycle.reason=cycle
        self.assertEqual(boot.llvm_failure_diagnostic(cycle),{'stage':'unknown','category':'other'})
        for status in (True,99,600,secret):
            error=HTTPError(secret,503,secret,{},None);error.code=status
            self.assertEqual(boot.llvm_failure_diagnostic(error),{'stage':'unknown','category':'http'})
        class SecretError(Exception):
            def __str__(self):raise AssertionError('must not stringify secret error')
        self.assertEqual(boot.llvm_failure_diagnostic(SecretError()),{'stage':'unknown','category':'other'})

    def test_actual_acquisition_stages_retain_exact_exception_without_any_secret(self):
        import base64
        import tempfile
        from contextlib import ExitStack
        from types import SimpleNamespace
        payload=b'test'
        stages=[('download',None),('extract',None),('pin-check',None),
            ('upstream-witness',0),('upstream-witness',1),('upstream-witness',2)]
        for selected,selected_ordinal in stages:
            with self.subTest(stage=selected,ordinal=selected_ordinal),tempfile.TemporaryDirectory()as folder,ExitStack()as stack:
                root=Path(folder).resolve();(root/'archives').mkdir()
                p=copy.deepcopy(BASE)
                for row in p['upstreamSources']:
                    row['bytes']=len(payload);row['sha256']=hashlib.sha256(payload).hexdigest()
                error=TimeoutError('https://private.invalid/secret?token=credential')
                def held(path,*args,**kwargs):
                    if Path(path).name=='sdk-acquisition.json':return ({},json.dumps({'archives':[],'sdkFiles':[]}).encode())
                    if selected=='pin-check':raise error
                    return ({},None)
                stack.enter_context(patch.object(data,'held',side_effect=held))
                stack.enter_context(patch.object(data,'fixed_download',side_effect=error if selected=='download'else lambda *a,**k:{}))
                stack.enter_context(patch.object(data,'extract_tar',side_effect=error if selected=='extract'else lambda *a,**k:[]))
                opened=[]
                class Response:
                    status=200
                    def __init__(self,url):self.url=url
                    def geturl(self):return self.url
                    def read(self,_bound):return base64.b64encode(payload)
                    def __enter__(self):return self
                    def __exit__(self,*args):pass
                def open_url(request,**kwargs):
                    ordinal=len(opened);opened.append(request.full_url)
                    if selected=='upstream-witness'and request.full_url==p['upstreamSources'][selected_ordinal]['url']:raise error
                    return Response(request.full_url)
                stack.enter_context(patch.object(data,'opener',return_value=SimpleNamespace(open=open_url)))
                with self.assertRaises(TimeoutError)as observed:data.acquire_llvm(root,p,clock())
                self.assertIs(observed.exception,error)
                expected={'category':'socket-timeout','stage':selected}
                if selected_ordinal is not None:expected['ordinal']=selected_ordinal
                self.assertEqual(boot.llvm_failure_diagnostic(error),expected)
                self.assertNotIn('secret',json.dumps(boot.llvm_failure_diagnostic(error)))

    def test_acquisition_annotation_failure_and_untrusted_stage_fields_are_secondary(self):
        import tempfile
        class AnnotationError(TimeoutError):
            def __setattr__(self,name,value):
                if name=='_sorng_llvm_failure_stage':raise RuntimeError('secret annotation failure')
                super().__setattr__(name,value)
        error=AnnotationError('secret transport failure')
        with tempfile.TemporaryDirectory()as folder,patch.object(data,'held',side_effect=error):
            with self.assertRaises(AnnotationError)as observed:data.acquire_llvm(Path(folder).resolve(),BASE,clock())
        self.assertIs(observed.exception,error)
        self.assertEqual(boot.llvm_failure_diagnostic(error),{'category':'socket-timeout','stage':'unknown'})
        for bad in [('https://private.invalid',None),('download',0),('upstream-witness',True),
                    ('upstream-witness',3),('upstream-witness',-1),['download',None]]:
            unknown=TimeoutError('secret');unknown._sorng_llvm_failure_stage=bad
            self.assertEqual(boot.llvm_failure_diagnostic(unknown),{'category':'socket-timeout','stage':'unknown'})

    def test_actual_llvm_worker_preserves_failure_and_redacts_diagnostic(self):
        import tempfile
        from urllib.error import HTTPError
        for observe_failure in (False,True):
            with self.subTest(observe_failure=observe_failure),tempfile.TemporaryDirectory()as folder:
                root=Path(folder).resolve();error=HTTPError('https://private.invalid/token',429,'secret token',{},None)
                original=boot.llvm_failure_diagnostic
                observer=patch.object(boot,'llvm_failure_diagnostic',side_effect=RuntimeError('secret observer token')) if observe_failure else patch.object(boot,'llvm_failure_diagnostic',side_effect=original)
                with patch.object(sys,'addaudithook'),patch.object(data,'acquire_llvm',side_effect=error),\
                     patch.object(boot,'verified_sources'),observer:
                    self.assertEqual(boot.data_worker('llvm-data',root,{},BASE,clock()),1)
                report=json.loads((root/'llvm-data-result.json').read_bytes())
                self.assertEqual(report['firstFailure'],'BOOT_UNAVAILABLE')
                self.assertFalse(report['success']);self.assertFalse(report['executed'])
                self.assertTrue(report['sourcePostVerified'])
                self.assertEqual(report['failureDiagnostic'],{'stage':'unknown','category':'other'} if observe_failure else {'stage':'unknown','category':'http','httpStatus':429})
                self.assertNotIn('secret',json.dumps(report));self.assertNotIn('private',json.dumps(report));self.assertNotIn('token',json.dumps(report))

    def test_explicit_llvm_pin_denial_remains_primary_without_network_reclassification(self):
        import tempfile
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder).resolve()
            with patch.object(sys,'addaudithook'),patch.object(data,'acquire_llvm',side_effect=data.Denied('ACQ_HASH')),\
                 patch.object(boot,'verified_sources'),patch.object(boot,'llvm_failure_diagnostic',side_effect=AssertionError('not an opaque exception')):
                self.assertEqual(boot.data_worker('llvm-data',root,{},BASE,clock()),1)
            report=json.loads((root/'llvm-data-result.json').read_bytes())
            self.assertEqual(report['firstFailure'],'ACQ_HASH');self.assertNotIn('failureDiagnostic',report)

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
