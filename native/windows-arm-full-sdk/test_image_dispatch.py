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
                root=Path(folder).resolve(strict=True)
                for supplied in (b'{}',(HERE/boot.IMAGE_TUPLES[images[1-index]]['profile']).read_bytes()):
                    target=root/boot.IMAGE_TUPLES[image]['profile'];target.write_bytes(supplied)
                    with patch.object(boot,'HERE',root),self.assertRaisesRegex(data.Denied,'ACQ_HASH'):
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
class UpstreamTimeoutRetryTests(unittest.TestCase):
    def acquisition(self):
        from contextlib import ExitStack, contextmanager
        import base64
        @contextmanager
        def fixture():
            with tempfile.TemporaryDirectory() as folder, ExitStack() as stack:
                root=Path(folder).resolve(strict=True);(root/'archives').mkdir()
                profile=copy.deepcopy(BASE);profile['upstreamSources']=profile['upstreamSources'][:1]
                payload=b'pinned metadata\n';row=profile['upstreamSources'][0]
                row.update(bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest())
                state=SimpleNamespace(expired=False,opens=[],closes=0,reads=[],payload=payload,
                    encoded=base64.b64encode(payload),root=root,row=row,open_error=None,
                    read_error=None,close_error=None,status=200,url=row['url'],on_open=None,on_read=None)
                class Budget:
                    def remaining(self):
                        data.need(not state.expired,'ACQ_DEADLINE')
                        return 30
                class Response:
                    @property
                    def status(self):return state.status
                    def geturl(self):return state.url
                    def read(self,bound):
                        state.reads.append(bound)
                        if state.on_read:return state.on_read()
                        if state.read_error:raise state.read_error
                        return state.encoded
                    def __enter__(self):return self
                    def __exit__(self,*args):
                        state.closes+=1
                        if state.close_error:raise state.close_error
                def open_url(request,**kwargs):
                    state.opens.append((request,kwargs))
                    if state.on_open:return state.on_open(Response)
                    if state.open_error:raise state.open_error
                    return Response()
                def held(path,*args,**kwargs):
                    if Path(path).name=='sdk-acquisition.json':
                        return {},json.dumps({'archives':[],'sdkFiles':[]}).encode()
                    return {},None
                stack.enter_context(patch.object(data,'held',side_effect=held))
                stack.enter_context(patch.object(data,'fixed_download',return_value={}))
                stack.enter_context(patch.object(data,'extract_tar',return_value=[]))
                stack.enter_context(patch.object(data,'opener',return_value=SimpleNamespace(open=open_url)))
                state.run=lambda:data.acquire_llvm(root,profile,Budget())
                state.output=root/'chromium'/row['path']
                yield state
        return fixture()

    def assert_no_output(self,s):
        self.assertFalse(s.output.exists());self.assertFalse((s.root/'acquisition.json').exists())

    def test_open_timeout_retries_same_request_then_validates_pinned_bytes(self):
        with self.acquisition()as s:
            def opened(Response):
                if len(s.opens)==1:raise TimeoutError('secret')
                return Response()
            s.on_open=opened;s.run()
            self.assertEqual(s.output.read_bytes(),s.payload)
            self.assertEqual(len(s.opens),2);self.assertIs(s.opens[0][0],s.opens[1][0])
            self.assertEqual([r.full_url for r,_ in s.opens],[s.row['url']]*2)
            self.assertEqual([kw for _,kw in s.opens],[{'timeout':15}]*2)
            self.assertEqual(s.closes,1)

    def test_wrapped_open_timeout_recovers_without_rewriting_original_url(self):
        from urllib.error import URLError
        with self.acquisition()as s:
            def opened(Response):
                if len(s.opens)<3:raise URLError(URLError(TimeoutError('secret')))
                return Response()
            s.on_open=opened;s.run()
            self.assertEqual(len(s.opens),3);self.assertEqual(s.output.read_bytes(),s.payload)
            self.assertEqual({r.full_url for r,_ in s.opens},{s.row['url']})

    def test_read_timeout_discards_partial_response_and_opens_fresh_response(self):
        with self.acquisition()as s:
            responses=[]
            def opened(Response):
                response=Response();responses.append(response);return response
            def read():
                if len(s.reads)==1:raise TimeoutError('partial response discarded')
                return s.encoded
            s.on_open=opened;s.on_read=read;s.run()
            self.assertEqual(s.output.read_bytes(),s.payload);self.assertEqual(len(s.opens),2)
            self.assertIsNot(responses[0],responses[1]);self.assertEqual(s.closes,2)
            self.assertEqual(s.reads,[4*1024**2+1]*2)

    def test_repeated_timeout_caps_three_attempts_and_preserves_exact_terminal_error(self):
        from urllib.error import URLError
        for reading in (False,True):
            with self.subTest(reading=reading),self.acquisition()as s:
                errors=[TimeoutError('secret1'),URLError(TimeoutError('secret2')),TimeoutError('secret3')]
                if reading:
                    def read():raise errors[len(s.reads)-1]
                    s.on_read=read
                else:
                    def opened(Response):raise errors[len(s.opens)-1]
                    s.on_open=opened
                with self.assertRaises(TimeoutError)as found:s.run()
                self.assertIs(found.exception,errors[-1]);self.assertEqual(len(s.opens),3)
                self.assertEqual(s.closes,3 if reading else 0);self.assert_no_output(s)
                self.assertEqual(boot.llvm_failure_diagnostic(found.exception),
                    {'category':'socket-timeout','stage':'upstream-witness','ordinal':0})

    def test_wrapped_timeout_depth_is_bounded_and_cycles_or_strings_never_retry(self):
        from urllib.error import URLError
        cycle=URLError('cycle');cycle.reason=cycle
        allowed=[TimeoutError('secret'),URLError(TimeoutError('secret')),URLError(URLError(TimeoutError('secret')))]
        denied=[URLError(URLError(URLError(TimeoutError('secret')))),cycle,URLError('timed out'),RuntimeError('timed out')]
        for error in allowed:self.assertTrue(data.upstream_socket_timeout(error))
        for error in denied:
            with self.subTest(errorType=type(error).__name__),self.acquisition()as s:
                s.open_error=error
                with self.assertRaises(type(error))as found:s.run()
                self.assertIs(found.exception,error);self.assertEqual(len(s.opens),1);self.assert_no_output(s)

    def test_http_tls_dns_and_nested_non_timeout_errors_are_never_retried(self):
        import socket,ssl
        from urllib.error import URLError,HTTPError
        errors=[HTTPError('secret',429,'secret',{},None),ssl.SSLError('secret'),
            socket.gaierror('secret'),ConnectionError('secret')]
        for error in list(errors):errors.append(URLError(error))
        for reading in (False,True):
            for error in errors:
                with self.subTest(reading=reading,errorType=type(error).__name__),self.acquisition()as s:
                    if reading:s.read_error=error
                    else:s.open_error=error
                    with self.assertRaises(type(error))as found:s.run()
                    self.assertIs(found.exception,error);self.assertEqual(len(s.opens),1);self.assert_no_output(s)

    def test_expiry_before_retry_after_read_and_before_file_creation_prevents_output(self):
        for phase in ('retry','after-read','before-write'):
            with self.subTest(phase=phase),self.acquisition()as s:
                decode_patch=None
                if phase=='retry':
                    def opened(Response):s.expired=True;raise TimeoutError('secret')
                    s.on_open=opened
                elif phase=='after-read':
                    def read():s.expired=True;return s.encoded
                    s.on_read=read
                else:
                    original=data.base64.b64decode
                    def decoded(*args,**kwargs):
                        result=original(*args,**kwargs);s.expired=True;return result
                    decode_patch=patch.object(data.base64,'b64decode',side_effect=decoded);decode_patch.start()
                try:
                    with self.assertRaisesRegex(data.Denied,'ACQ_DEADLINE'):s.run()
                finally:
                    if decode_patch:decode_patch.stop()
                self.assertEqual(len(s.opens),1);self.assert_no_output(s)

    def test_validation_and_local_io_failures_never_retry_or_create_unverified_output(self):
        import binascii
        for phase in ('url','status','redirect','size','base64','length','hash','close','mkdir','opener'):
            with self.subTest(phase=phase),self.acquisition()as s:
                error=TimeoutError('local secret');manager=None;expected=data.Denied
                if phase=='url':s.row['url']='https://invalid.example/'
                if phase=='status':s.status=503
                if phase=='redirect':s.url='https://invalid.example/'
                if phase=='size':s.encoded=b'a'*(4*1024**2+1)
                if phase=='base64':s.encoded=b'!';expected=binascii.Error
                if phase=='length':s.row['bytes']+=1
                if phase=='hash':s.row['sha256']='0'*64
                if phase=='close':s.close_error=error;expected=TimeoutError
                if phase=='mkdir':manager=patch.object(data,'mkdir_owned',side_effect=error);expected=TimeoutError
                if phase=='opener':manager=patch.object(data,'opener',side_effect=error);expected=TimeoutError
                if manager:manager.start()
                try:
                    with self.assertRaises(expected)as found:s.run()
                    if expected is TimeoutError:self.assertIs(found.exception,error)
                finally:
                    if manager:manager.stop()
                self.assertEqual(len(s.opens),0 if phase in ('url','mkdir','opener')else 1);self.assert_no_output(s)

    def test_close_failure_after_retryable_read_timeout_is_not_retried(self):
        with self.acquisition()as s:
            s.read_error=TimeoutError('read timeout');s.close_error=TimeoutError('close failure')
            with self.assertRaises(TimeoutError)as found:s.run()
            self.assertIs(found.exception,s.close_error)
            self.assertEqual(len(s.opens),1);self.assertEqual(s.closes,1);self.assert_no_output(s)

    def test_acquire_ast_only_replaces_exact_network_block_and_adds_prewrite_deadline(self):
        import ast
        tree=ast.parse((HERE/'acquire.py').read_text())
        function=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='acquire_llvm')
        loops=[n for n in ast.walk(function)if isinstance(n,ast.For)and ast.unparse(n.target)=='(ordinal, original)']
        self.assertEqual(len(loops),1);loop=loops[0]
        retry=ast.Module(body=loop.body[4:7],type_ignores=[])
        self.assertEqual(hashlib.sha256(ast.dump(retry,include_attributes=False).encode()).hexdigest(),
            'ce06254c2fd352057e4c04ac26d9f540c5858d3468a27d015021dc9cd004d8fe')
        self.assertEqual(ast.unparse(loop.body[9]),'clock.remaining()')
        self.assertIsInstance(loop.body[10],ast.With)
        self.assertEqual(ast.unparse(loop.body[10].items[0].context_expr),"file.open('xb')")
        del loop.body[9]
        # Restore only the pinned historical single request, not any other guard.
        loop.body[4:7]=ast.parse('''
with opener().open(urllib.request.Request(original["url"]), timeout=min(15, clock.remaining())) as response:
    need(response.status == 200 and response.geturl() == original["url"], "ACQ_RESPONSE")
    encoded = response.read(4 * 1024**2 + 1)
    need(len(encoded) <= 4 * 1024**2, "ACQ_SOURCE_SIZE")
''').body
        self.assertEqual(hashlib.sha256(ast.dump(function,include_attributes=False).encode()).hexdigest(),
            'bc5f9447bd590c7d1402703214c1d8e0de092c9babf49c1b4b887e5f49919aec')

    def test_create_new_and_save_timeout_failures_do_not_trigger_network_retry(self):
        for existing in (False,True):
            with self.subTest(existing=existing),self.acquisition()as s:
                if existing:
                    s.output.parent.mkdir(parents=True);s.output.write_bytes(b'preserved')
                    with self.assertRaises(FileExistsError):s.run()
                    self.assertEqual(s.output.read_bytes(),b'preserved')
                else:
                    original=Path.open
                    def opening(path,*args,**kwargs):
                        if args and args[0]=='xb':raise TimeoutError('local save timeout')
                        return original(path,*args,**kwargs)
                    with patch.object(Path,'open',opening),self.assertRaises(TimeoutError):s.run()
                    self.assert_no_output(s)
                self.assertEqual(len(s.opens),1)

if __name__=='__main__':unittest.main()
