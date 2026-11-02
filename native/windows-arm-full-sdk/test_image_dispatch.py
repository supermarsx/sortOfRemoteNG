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



# Native method fixture from depot_tools@c101dcbe0489c455fce7c2247bfee19680b116c3.
# // Copyright 2009 The Chromium Authors
# //
# // Redistribution and use in source and binary forms, with or without
# // modification, are permitted provided that the following conditions are
# // met:
# //
# //    * Redistributions of source code must retain the above copyright
# // notice, this list of conditions and the following disclaimer.
# //    * Redistributions in binary form must reproduce the above
# // copyright notice, this list of conditions and the following disclaimer
# // in the documentation and/or other materials provided with the
# // distribution.
# //    * Neither the name of Google LLC nor the names of its
# // contributors may be used to endorse or promote products derived from
# // this software without specific prior written permission.
# //
# // THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
# // "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
# // LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
# // A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
# // OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
# // SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
# // LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
# // DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
# // THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
# // (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
# // OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
PINNED_FLATTENER_SOURCE = 'class NativePinnedFlattener:\n    def _pin_dep(self, dep):\n        """Pins a dependency to specific full revision sha.\n\n        Arguments:\n            dep (Dependency): dependency to process\n        """\n        if dep.url is None:\n            return\n\n        # Make sure the revision is always fully specified (a hash),\n        # as opposed to refs or tags which might change. Similarly,\n        # shortened shas might become ambiguous; make sure to always\n        # use full one for pinning.\n        revision = gclient_utils.SplitUrlRevision(dep.url)[1]\n        if not revision or not gclient_utils.IsFullGitSha(revision):\n            dep.PinToActualRevision()\n\n    def _add_dep(self, dep):\n        """Helper to add a dependency to flattened DEPS.\n\n        Arguments:\n            dep (Dependency): dependency to add\n        """\n        assert dep.name not in self._deps or self._deps.get(dep.name) == dep, (\n            dep.name,\n            self._deps.get(dep.name),\n        )\n        if dep.url:\n            self._deps[dep.name] = dep\n\n    def _flatten_dep(self, dep):\n        """Visits a dependency in order to flatten it (see CMDflatten).\n\n        Arguments:\n            dep (Dependency): dependency to process\n        """\n        logging.debug("_flatten_dep(%s)", dep.name)\n\n        assert dep.deps_parsed, (\n            "Attempted to flatten %s but it has not been processed." % dep.name\n        )\n\n        self._allowed_hosts.update(dep.allowed_hosts)\n\n        # Only include vars explicitly listed in the DEPS files or gclient\n        # solution, not automatic, local overrides (i.e. not all of\n        # dep.get_vars()).\n        hierarchy = dep.hierarchy(include_url=False)\n        for key, value in dep._vars.items():\n            # Make sure there are no conflicting variables. It is fine however\n            # to use same variable name, as long as the value is consistent.\n            assert key not in self._vars or self._vars[key][1] == value, (\n                "dep:%s key:%s value:%s != %s"\n                % (dep.name, key, value, self._vars[key][1])\n            )\n            self._vars[key] = (hierarchy, value)\n        # Override explicit custom variables.\n        for key, value in dep.custom_vars.items():\n            # Do custom_vars that don\'t correspond to DEPS vars ever make sense?\n            # DEPS conditionals shouldn\'t be using vars that aren\'t also defined\n            # in the DEPS (presubmit actually disallows this), so any new\n            # custom_var must be unused in the DEPS, so no need to add it to the\n            # flattened output either.\n            if key not in self._vars:\n                continue\n            # Don\'t "override" existing vars if it\'s actually the same value.\n            if self._vars[key][1] == value:\n                continue\n            # Anything else is overriding a default value from the DEPS.\n            self._vars[key] = (hierarchy + " [custom_var override]", value)\n\n        self._pre_deps_hooks.extend(\n            [(dep, hook) for hook in dep.pre_deps_hooks]\n        )\n        self._hooks.extend([(dep, hook) for hook in dep.deps_hooks])\n\n        for sub_dep in dep.dependencies:\n            self._add_dep(sub_dep)\n\n        for d in dep.dependencies:\n            if d.should_recurse:\n                self._flatten_dep(d)\n\n'
PINNED_FLATTENER_METHOD_SHA256 = 'c182a251969b0b6cfc0683ba83d97639c55f0dabd8153af6d0e61fde6f1c63b1'

# Exact native dependency/registration/cache-resolution methods from the same
# pinned depot_tools revision. Process dispatch remains a deny-on-resolve seam.
PINNED_CIPD_SOURCE = r'''class NativeDependencyPin:
    def PinToActualRevision(self):
        """Updates self.url to the revision checked out on disk."""
        if self.url is None:
            return
        url = None
        scm = self.CreateSCM()
        if scm.name == "cipd":
            revision = scm.revinfo(None, None, None)
            package = self.GetExpandedPackageName()
            url = "%s/p/%s/+/%s" % (
                scm.GetActualRemoteURL(None),
                package,
                revision,
            )
        if scm.name == "gcs":
            url = self.url

        if os.path.isdir(scm.checkout_path):
            revision = scm.revinfo(None, None, None)
            url = "%s@%s" % (
                gclient_utils.SplitUrlRevision(self.url)[0],
                revision,
            )
        self.set_url(url)


class CipdDependency(Dependency):
    def __init__(
        self,
        parent,
        name,
        dep_value,
        cipd_root,
        custom_vars,
        should_process,
        relative,
        condition,
    ):
        package = dep_value["package"]
        if dep_value.get("version_file"):
            fp = os.path.join(
                parent.root.root_dir, parent.name, dep_value["version_file"]
            )
            version = gclient_utils.FileRead(fp).strip()
        else:
            version = dep_value["version"]
        url = urllib.parse.urljoin(
            cipd_root.service_url, "%s@%s" % (package, version)
        )
        super(CipdDependency, self).__init__(
            parent=parent,
            name=name + ":" + package,
            url=url,
            managed=None,
            custom_deps=None,
            custom_vars=custom_vars,
            custom_hooks=None,
            deps_file=None,
            should_process=should_process,
            should_recurse=False,
            relative=relative,
            condition=condition,
        )
        self._cipd_package = None
        self._cipd_root = cipd_root
        # CIPD wants /-separated paths, even on Windows.
        native_subdir_path = os.path.relpath(
            os.path.join(self.root.root_dir, name), cipd_root.root_dir
        )
        self._cipd_subdir = posixpath.join(*native_subdir_path.split(os.sep))
        self._package_name = package
        self._package_version = version

    def _CreatePackageIfNecessary(self):
        # We lazily create the CIPD package to make sure that only packages
        # that we want (as opposed to all packages defined in all DEPS files
        # we parse) get added to the root and subsequently ensured.
        if not self._cipd_package:
            self._cipd_package = self._cipd_root.add_package(
                self._cipd_subdir, self._package_name, self._package_version
            )

    def GetScmName(self):
        """Always 'cipd'."""
        return "cipd"

    def GetExpandedPackageName(self):
        """Return the CIPD package name with the variables evaluated."""
        package = self._cipd_root.expand_package_name(self._package_name)
        if package:
            return package
        return self._package_name

    def CreateSCM(self, out_cb=None):
        """Create a Wrapper instance suitable for handling this CIPD dependency."""
        self._CreatePackageIfNecessary()
        return gclient_scm.CipdWrapper(
            self.url,
            self.root.root_dir,
            self.name,
            self.outbuf,
            out_cb,
            root=self._cipd_root,
            package=self._cipd_package,
        )


class CipdRoot:
    def __init__(self, root_dir, service_url, log_level=None):
        self._all_packages = set()
        self._mutator_lock = threading.Lock()
        self._packages_by_subdir = collections.defaultdict(list)
        self._root_dir = root_dir
        self._service_url = service_url
        self._resolved_packages = None
        self._log_level = log_level or "error"

    def add_package(self, subdir, package, version):
        """Adds a package to this CIPD root.

        As far as clients are concerned, this grants both root and subdir authority
        to packages arbitrarily. (The implementation grants root authority to the
        first package added and subdir authority to the first package added for that
        subdir, but clients should not depend on or expect that behavior.)

        Args:
          subdir: str; relative path to where the package should be installed from
            the cipd root directory.
          package: str; the cipd package name.
          version: str; the cipd package version.
        Returns:
          CipdPackage; the package that was created and added to this root.
        """
        with self._mutator_lock:
            cipd_package = CipdPackage(
                package, version, not self._packages_by_subdir[subdir]
            )
            self._all_packages.add(cipd_package)
            self._packages_by_subdir[subdir].append(cipd_package)
            return cipd_package

    def resolved_packages(self):
        if not self._resolved_packages:
            self._resolved_packages = self.ensure_file_resolve()
        return self._resolved_packages

    @contextlib.contextmanager
    def _create_ensure_file_for_resolve(self):
        try:
            contents = "$ResolvedVersions %s\n" % os.devnull
            for subdir, packages in sorted(self._packages_by_subdir.items()):
                contents += "@Subdir %s\n" % subdir
                for package in sorted(packages, key=lambda p: p.name):
                    contents += "%s %s\n" % (package.name, package.version)
                contents += "\n"
            ensure_file = None
            with tempfile.NamedTemporaryFile(
                suffix=".ensure", delete=False, mode="wb"
            ) as ensure_file:  # noqa: F811
                ensure_file.write(contents.encode("utf-8", "replace"))
            yield ensure_file.name
        finally:
            if ensure_file is not None and os.path.exists(ensure_file.name):
                os.remove(ensure_file.name)

    def _create_resolved_file(self):
        return tempfile.NamedTemporaryFile(
            suffix=".resolved", delete=False, mode="wb"
        )

    def ensure_file_resolve(self):
        """Run `cipd ensure-file-resolve`."""
        with self._mutator_lock:
            with self._create_resolved_file() as output_file:
                with self._create_ensure_file_for_resolve() as ensure_file:
                    cmd = [
                        "cipd",
                        "ensure-file-resolve",
                        "-log-level",
                        self._log_level,
                        "-ensure-file",
                        ensure_file,
                        "-json-output",
                        output_file.name,
                    ]
                    gclient_utils.CheckCallAndFilter(
                        cmd, print_stdout=False, show_header=False
                    )
                    with open(output_file.name) as f:
                        output_json = json.load(f)
                        return output_json.get("result", {})

    def run(self, command):
        if command == "update":
            self.ensure()
        elif command == "revert":
            self.clobber()
            self.ensure()

    @property
    def root_dir(self):
        return self._root_dir

    @property
    def service_url(self):
        return self._service_url


class CipdWrapper(CipdWrapperBase):
    def revinfo(self, options, args, file_list):
        """Grab the instance ID."""
        try:
            tmpdir = tempfile.mkdtemp()
            # Attempt to get instance_id from the root resolved cache.
            # Resolved cache will not match on any CIPD packages with
            # variables such as ${platform}, they will fall back to
            # the slower method below.
            resolved = self._root.resolved_packages()
            if resolved:
                # CIPD uses POSIX separators across all platforms, so
                # replace any Windows separators.
                path_split = self.relpath.replace(os.sep, "/").split(":")
                if len(path_split) > 1:
                    src_path, package = path_split
                    if src_path in resolved:
                        for resolved_package in resolved[src_path]:
                            if package == resolved_package.get("pin", {}).get(
                                "package"
                            ):
                                return resolved_package.get("pin", {}).get(
                                    "instance_id"
                                )

            describe_json_path = os.path.join(tmpdir, "describe.json")
            cmd = [
                "cipd",
                "describe",
                self._package.name,
                "-log-level",
                "error",
                "-version",
                self._package.version,
                "-json-output",
                describe_json_path,
            ]
            gclient_utils.CheckCallAndFilter(cmd)
            with open(describe_json_path) as f:
                describe_json = json.load(f)
            return (
                describe_json.get("result", {})
                .get("pin", {})
                .get("instance_id")
            )
        finally:
            gclient_utils.rmtree(tmpdir)

    def GetActualRemoteURL(self, options):
        return self._root.service_url

'''
PINNED_CIPD_METHOD_SHA256 = 'ddc43c8f94e0c4672003c0653691526fd371ebd1a184ccb0b9e8742bd8416808'



def _native_projection_fixture(folder, case):
    """Synthetic parsed objects; exact native methods and actual DEPS locals.

    Native pinning/registration/resolution bodies execute against controlled
    SCM metadata and owned temporary files. Any CIPD process dispatch is denied
    and counted; no acquired program, network or hook execution occurs.
    """
    import logging
    import re
    import types
    import collections
    import contextlib
    import os
    import shutil
    import threading
    import urllib.parse
    import posixpath
    namespace={'logging':logging,'gclient_utils':types.SimpleNamespace(
        SplitUrlRevision=lambda url:url.rsplit('@',1),
        IsFullGitSha=lambda value:bool(re.fullmatch('[a-fA-F0-9]{40}',value)))}
    assert hashlib.sha256(PINNED_FLATTENER_SOURCE.encode()).hexdigest()==PINNED_FLATTENER_METHOD_SHA256
    exec(compile(PINNED_FLATTENER_SOURCE,'<pinned-e4f650-Flattener-methods>','exec'),namespace)
    Native=namespace['NativePinnedFlattener']
    state=types.SimpleNamespace(constructed=0,parsed=0,bound=0,pins=[],queries=[],
        cipdRegistrations=0,cipdScmCreations=0,cipdResolves=0,ensureIncludedInactive=False)
    class Dep:
        def __init__(self,name,parent=None,value=None,**native):
            self.name=name;self.parent=parent;self.dependencies=[]
            self._vars={}if value is None else{'chromium_revision':value}
            self.custom_vars={};self.allowed_hosts=set();self.deps_parsed=True
            self.should_recurse=native.get('should_recurse',True)
            self.should_process=native.get('should_process',True);self.outbuf=None
            self.deps_file=native.get('deps_file','DEPS')
            self.url=native.get('url','https://example.invalid/'+name+'@'+'a'*40)
            self.deps_hooks=[types.SimpleNamespace(name=name,condition='checkout_win',pattern=None,
                effective_cwd=name,action=['python3','known.py'],variables=self._vars)]
            self.pre_deps_hooks=[]
        def hierarchy(self,include_url=False):return self.name
        @property
        def root(self):return types.SimpleNamespace(root_dir=str(folder))
        def GetScmName(self):return 'git'
        def set_url(self,url):self.url=url
        def hierarchy_data(self):
            out=[];at=self
            while at:
                out.insert(0,(at.name,at.url));at=at.parent
            return tuple(out)
        def CreateSCM(self):
            state.pins.append(self.name)
            if case=='pin-failure':raise RuntimeError('FULL_FIXTURE_PIN_FAILED')
            return types.SimpleNamespace(name='git',checkout_path=str(folder/self.name),
                revinfo=lambda *_:'b'*40)
    native_temp=folder/'native-cipd';native_temp.mkdir()
    class CipdPackage:
        def __init__(self,name,version,authority):
            state.cipdRegistrations+=1;self.name=name;self.version=version
    class CipdWrapperBase:
        def __init__(self,url,root_dir,relpath,outbuf,out_cb,*,root,package):
            state.cipdScmCreations+=1;self._root=root;self._package=package
            self.relpath=relpath;self.name='cipd';self.checkout_path=str(folder/'cipd-checkout')
    def deny_dispatch(command,*args,**kwargs):
        assert command[:2]==['cipd','ensure-file-resolve']
        state.cipdResolves+=1
        ensure=Path(command[command.index('-ensure-file')+1]).resolve()
        assert ensure.is_relative_to(native_temp)
        payload=ensure.read_text();assert len(payload)<=65536
        state.ensureIncludedInactive='chrome_internal/not-needed version:1' in payload
        raise RuntimeError('FULL_FIXTURE_CIPD_GLOBAL_RESOLVE')
    def remove_owned(directory):
        path=Path(directory).resolve();assert path.is_relative_to(native_temp)
        shutil.rmtree(path)
    namespace['gclient_utils'].CheckCallAndFilter=deny_dispatch
    namespace['gclient_utils'].rmtree=remove_owned
    namespace.update(Dependency=Dep,CipdWrapperBase=CipdWrapperBase,CipdPackage=CipdPackage,
        os=os,json=json,collections=collections,contextlib=contextlib,threading=threading,urllib=urllib,posixpath=posixpath,
        tempfile=types.SimpleNamespace(
            mkdtemp=lambda:tempfile.mkdtemp(dir=native_temp),
            NamedTemporaryFile=lambda *args,**kwargs:tempfile.NamedTemporaryFile(*args,dir=native_temp,**kwargs)))
    assert hashlib.sha256(PINNED_CIPD_SOURCE.encode()).hexdigest()==PINNED_CIPD_METHOD_SHA256
    exec(compile(PINNED_CIPD_SOURCE,'<pinned-c101-CIPD-methods>','exec'),namespace)
    namespace['gclient_scm']=types.SimpleNamespace(CipdWrapper=namespace['CipdWrapper'])
    Dep.PinToActualRevision=namespace['NativeDependencyPin'].PinToActualRevision
    cipd_root=namespace['CipdRoot'](str(folder),'https://example.invalid/')
    cipd_root.add_package('src/inactive','chrome_internal/not-needed','version:1')
    state.cipdRegistrations=0  # Already-parsed metadata, before observer pinning.
    top=Dep('src')
    angle=Dep('src/third_party/angle',top,'80685c1f3c2953578acb9987fd63af524e7435cb')
    dawn=Dep('src/third_party/dawn',top,'9d728f73dd5798b6cdef64b1dbe3270a04aca336')
    top.dependencies=[angle,dawn]
    top.pre_deps_hooks=[types.SimpleNamespace(name='pre',condition='False',pattern=None,effective_cwd='.',action=['vpython3','pre.py'],variables=top._vars)]
    dawn.deps_hooks[0].condition='False'
    dawn.deps_hooks[0].action=['unsupported-platform-tool','%PATH%','x&echo y']
    angle.deps_file='DEPS.chromium'  # Missing explicit name uses native DEPS fallback.
    for dep in(top,angle,dawn):
        file=folder/dep.name/'DEPS';file.parent.mkdir(parents=True,exist_ok=True);file.write_text('# fixture metadata only\n')
    if case=='pinning' or case=='pin-failure':angle.url=angle.url.rsplit('@',1)[0]+'@main'
    elif case=='custom-origin':
        dawn.deps_file='DEPS.custom';(folder/dawn.name/dawn.deps_file).write_text('# preferred fixture\n')
    elif case=='identity':top.dependencies.append(Dep(angle.name,top))
    elif case=='cycle':angle.dependencies=[top]
    elif case=='unparsed':angle.deps_parsed=False
    elif case=='hook-bound':top.deps_hooks*=513
    elif case=='dep-bound':
        top.dependencies=[Dep('src/leaf'+str(i),top)for i in range(4097)]
        for dep in top.dependencies:dep.should_recurse=False
    elif case=='depth':
        at=top
        for i in range(65):
            child=Dep('src/nested'+str(i),at);child.deps_hooks=[];at.dependencies=[child];at=child
    elif case=='unsafe-origin':angle.deps_file='../outside'
    elif case=='unsafe-name':angle.name='src/../outside'
    elif case=='unsafe-url':angle.url='http://example.invalid/repo@'+'a'*40
    elif case=='unsafe-url-space':angle.url='https://example.invalid/has space@'+'a'*40
    elif case=='nonrecursive-pin':
        package=Dep('src/packages:vendor/package',top);package.should_recurse=False;package.deps_file=None
        package.url='https://example.invalid/pkg@version';top.dependencies.append(package)
    elif case in('cipd-selected','cipd-unselected'):
        package=namespace['CipdDependency'](top,'src/packages',
            {'package':'angle/traces/fixture','version':'version:1'},cipd_root,{},
            case=='cipd-selected',False,'checkout_win'if case=='cipd-selected'else'False')
        assert not package.should_recurse and package.GetScmName()=='cipd'
        top.dependencies.append(package)
    elif case=='gcs-nonrecursive':
        package=Dep('src/nonrecursive-gcs',top);package.should_recurse=False;package.deps_file=None
        package.url='https://example.invalid/gcs@version';package.GetScmName=lambda:'gcs'
        def deny_gcs():raise RuntimeError('FULL_FIXTURE_GCS_METADATA_QUERY')
        package.CreateSCM=deny_gcs;top.dependencies.append(package)
    elif case=='recursive-non-git':angle.GetScmName=lambda:'gcs'
    elif case=='shared-subtree':top.dependencies.append(angle)
    elif case=='origin-bound':
        top.dependencies=[Dep('src/origin'+str(i),top)for i in range(1025)]
        for dep in top.dependencies:dep.deps_hooks=[]
    elif case=='output-bound':top.deps_hooks[0].action=['x'*(4*1024**2+1)]
    elif case not in('scoped','custom-origin'):raise ValueError('unknown fixture case')
    before=copy.deepcopy((top._vars,angle._vars,dawn._vars))
    class Client:
        dependencies=(top,)
        root_dir=str(folder)
        def __init__(self,options):self.options=options
        def RunOnDeps(self,command,args,progress):
            assert command=='flatten'and args==[]and progress is False
            assert self.options.nohooks and self.options.noprehooks and self.options.process_all_deps
            cipd_root.run(command)  # Native flatten is metadata-only, not ensure.
            state.parsed+=1;return 0
    class FixtureFlattener(Native):
        def __init__(self,client,pin_all_deps):
            state.constructed+=1;assert pin_all_deps
            self._client=client;self._allowed_hosts=set();self._vars={};self._deps={};self._hooks=[];self._pre_deps_hooks=[]
            for solution in client.dependencies:self._add_dep(solution);self._flatten_dep(solution)
            for dep in self._deps.values():self._pin_dep(dep)
        @property
        def deps_files(self):
            rows=[]
            for dep in self._deps.values():
                if not dep.should_recurse:continue
                name=dep.deps_file
                if not (folder/dep.name/name).exists():name='DEPS'
                if not (folder/dep.name/name).exists():continue
                rows.append((dep.url,name,dep.hierarchy_data()))
            return rows
    class Parser:
        def parse_args(self,args):assert args==['--jobs','2'];return types.SimpleNamespace(),[]
    module=types.ModuleType('gclient');module.OptionParser=Parser;module.Flattener=FixtureFlattener
    module.GClient=types.SimpleNamespace(LoadCurrentConfig=lambda options:Client(options))
    bootstrap=types.ModuleType('source_bootstrap')
    def bind(a,b):assert(a,b)==('a'*64,'b'*64);state.bound+=1
    bootstrap.bind=bind
    return module,bootstrap,state,(top,angle,dawn),before


def selected_hook_projection_case(program,case):
    """Execute one actual generated projection over the closed fixture tree."""
    import contextlib
    import io
    import os
    with tempfile.TemporaryDirectory(prefix='cef-scoped-hooks-')as temp:
        folder=Path(temp).resolve();module,bootstrap,state,deps,before=_native_projection_fixture(folder,case)
        output=io.StringIO();old_cwd=Path.cwd();old_argv=sys.argv
        original_exists=os.path.exists
        def exists(file):
            candidate=Path(file).absolute();state.queries.append(str(candidate))
            assert candidate.is_relative_to(folder),'fixture queried outside owned root'
            return True if case=='origin-bound' else original_exists(file)
        error=None
        try:
            os.chdir(folder);sys.argv=['-c',str(folder),str(folder),'a'*64,'b'*64]
            with patch.dict(sys.modules,{'gclient':module,'source_bootstrap':bootstrap}),patch('os.path.exists',side_effect=exists),contextlib.redirect_stdout(output):
                exec(compile(program,'<actual-selected-hook-projection>','exec'),{})
        except BaseException as caught:error={'type':type(caught).__name__,'message':str(caught)[:512]}
        finally:os.chdir(old_cwd);sys.argv=old_argv
        packet=None
        if error is None:
            text=output.getvalue();assert text.startswith('FULL_HOOK_PROJECTION:')and text.count('\n')==1
            packet=json.loads(text.split(':',1)[1])
        return {'case':case,'error':error,'packet':packet,'flattenerConstructed':state.constructed,
            'parsed':state.parsed,'bootstrapBound':state.bound,'pins':state.pins,
            'cipdRegistrations':state.cipdRegistrations,'cipdScmCreations':state.cipdScmCreations,
            'cipdResolves':state.cipdResolves,'ensureIncludedInactive':state.ensureIncludedInactive,
            'varsUnchanged':(deps[0]._vars,deps[1]._vars,deps[2]._vars)==before,
            'outsideMetadataQueried':any(not Path(p).is_relative_to(folder)for p in state.queries)}


class PinnedScopedHookTests(unittest.TestCase):
    def test_native_cipd_registration_revinfo_and_global_resolution_chain_reproduces_failure(self):
        for case in ('cipd-selected','cipd-unselected'):
            with self.subTest(case=case),tempfile.TemporaryDirectory()as temp:
                module,_,state,deps,_=_native_projection_fixture(Path(temp).resolve(),case)
                package=deps[0].dependencies[-1]
                self.assertFalse(package.should_recurse)
                self.assertEqual(package.GetScmName(),'cipd')
                with self.assertRaisesRegex(RuntimeError,'FULL_FIXTURE_CIPD_GLOBAL_RESOLVE'):
                    module.Flattener._pin_dep(None,package)
                self.assertEqual((state.cipdRegistrations,state.cipdScmCreations,state.cipdResolves),(1,1,1))
                self.assertTrue(state.ensureIncludedInactive)

    def test_native_flatten_root_command_does_not_itself_resolve_cipd_packages(self):
        for case in ('cipd-selected','cipd-unselected'):
            with self.subTest(case=case),tempfile.TemporaryDirectory()as temp:
                module,_,state,_,_=_native_projection_fixture(Path(temp).resolve(),case)
                options=module.OptionParser().parse_args(['--jobs','2'])[0]
                options.nohooks=options.noprehooks=options.process_all_deps=True
                self.assertEqual(module.GClient.LoadCurrentConfig(options).RunOnDeps('flatten',[],False),0)
                self.assertEqual((state.cipdRegistrations,state.cipdScmCreations,state.cipdResolves),(0,0,0))

    def test_native_git_ref_pin_uses_owned_checkout_metadata_and_full_revision(self):
        with tempfile.TemporaryDirectory()as temp:
            module,_,state,deps,_=_native_projection_fixture(Path(temp).resolve(),'pinning')
            angle=deps[1]
            module.Flattener._pin_dep(None,angle)
            self.assertEqual(state.pins,['src/third_party/angle'])
            self.assertEqual(angle.url,'https://example.invalid/src/third_party/angle@'+'b'*40)
            self.assertEqual((state.cipdRegistrations,state.cipdScmCreations,state.cipdResolves),(0,0,0))

    def test_native_global_variable_assertion_is_retained_and_reproduces_the_actual_failure(self):
        with tempfile.TemporaryDirectory()as temp:
            module,_,_,_,_=_native_projection_fixture(Path(temp).resolve(),'scoped')
            options=module.OptionParser().parse_args(['--jobs','2'])[0]
            client=module.GClient.LoadCurrentConfig(options)
            with self.assertRaisesRegex(AssertionError,'dep:src/third_party/dawn key:chromium_revision value:9d728f73dd5798b6cdef64b1dbe3270a04aca336 != 80685c1f3c2953578acb9987fd63af524e7435cb'):
                module.Flattener(client,pin_all_deps=True)

# Pinned infra c77fff30 -> LUCI Gitlink 7ba3e893. The actual action constructs
# this vector, independently witnessed in actions/cipd.go (a097c57b...); its
# stdin is ensure.File.Serialize from the one virtualenv package. These are
# source-derived bytes, not a claim that the failed runner recorded argv.
VIRTUALENV_EXPORT_GO_CALL = 'cmd := cipdCommand(ctx, "export", "--root", out, "--ensure-file", "-")'
VIRTUALENV_EXPORT_STDIN = b'infra/3pp/tools/virtualenv  version:2@20.25.1.chromium.8\n'
VIRTUALENV_EXPORT_STDIN_SHA256 = '6668f72f25b7f434c5ca5b8205410289381cdbd7d98cc3aaa8fbb6ce991eaf1b'
VIRTUALENV_PACKAGE_ID = 'virtualenv+n21fvm7m09pn5o63l11eh3li0k'


def _bootstrap_export_namespace(program, root):
    import ast, os, stat, types
    names = {'arguments', 'run_checked', 'export_input', 'execute', 'bind'}
    functions = [node for node in ast.parse(program).body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
    need_names = names - {'export_input'}
    assert need_names <= {node.name for node in functions}
    state = SimpleNamespace(verify=0, context=0, subprocess=[], direct=[])

    class Clock:
        def remaining(self): return 600

    clock = Clock()
    client = root/'client-is-never-executed.exe'

    def verify(expected, guard):
        assert expected == 'a'*64 and guard == 'b'*64
        state.verify += 1
        return {'client': {'path': str(client)}, 'vpython': {'path': str(client)}}, clock

    def context():
        state.context += 1
        return clock

    def run(command, **kwargs):
        state.subprocess.append((command, kwargs))
        return SimpleNamespace(returncode=0)

    namespace = {'Path': Path, 'P': {'workspace': str(root/'source-checkout')},
                 'ROOT': root, 'DEPOT': root/'source-checkout/depot_tools', 'data': data,
                 'stat': stat, 'os': os, 'sys': SimpleNamespace(path=list(sys.path)),
                 'verify': verify, 'context': context,
                 'inherited_environment': lambda *a: None,
                 'subprocess': SimpleNamespace(run=run)}
    exec(compile(ast.Module(body=functions, type_ignores=[]), '<actual-generated-bootstrap>', 'exec'), namespace)
    return namespace, state, clock


def selected_virtualenv_export_case(program, previous, root):
    """Actual generated guards/runners plus owned files; no payload executable."""
    import io, re, types
    root = Path(root).resolve()
    out = root/'source-caches/vpython/store'/VIRTUALENV_PACKAGE_ID/'contents'
    out.mkdir(parents=True)
    (root/'source-checkout').mkdir()
    (root/'tmp').mkdir()
    ensure = root/'tmp/ensure.txt'
    ensure.write_bytes(b'owned old native ensure fixture')
    output = root/'tmp/result.json'
    output.write_bytes(b'{}')
    assert len(VIRTUALENV_EXPORT_STDIN) == 57
    assert hashlib.sha256(VIRTUALENV_EXPORT_STDIN).hexdigest() == VIRTUALENV_EXPORT_STDIN_SHA256
    literals = re.findall(r'"([^"]*)"', VIRTUALENV_EXPORT_GO_CALL)
    assert literals == ['export', '--root', '--ensure-file', '-']
    vector = [*literals[:2], str(out), *literals[2:]]
    old, _, _ = _bootstrap_export_namespace(previous, root)
    try: old['arguments']('cipd', vector)
    except data.Denied as error: assert str(error) == 'FULL_BOOTSTRAP_CIPD_ARGV'
    else: raise AssertionError('old guard unexpectedly admitted export')
    current, state, clock = _bootstrap_export_namespace(program, root)
    current['arguments']('cipd', vector)
    current['sys'].stdin = SimpleNamespace(buffer=io.BytesIO(VIRTUALENV_EXPORT_STDIN))
    current['execute']('cipd', vector, 'a'*64, 'b'*64)
    assert state.context == 1 and state.verify == 2
    assert len(state.subprocess) == 1
    command, options = state.subprocess[0]
    assert command[1:] == vector and options == {
        'check': False, 'shell': False, 'timeout': 480, 'input': VIRTUALENV_EXPORT_STDIN}
    # Old families retain the exact two-argument runner and no stdin option.
    for argv in (["ensure", "-log-level", "info", "-root", str(root/'source-checkout'), "-ensure-file", str(ensure)],
                 ["ensure-file-resolve", "-log-level", "error", "-ensure-file", str(ensure), "-json-output", str(output)]):
        current['execute']('cipd', argv, 'a'*64, 'b'*64)
        assert state.subprocess[-1] == ([command[0], *argv], {'check': False, 'shell': False, 'timeout': 480})
    bad_vectors = [vector+['--extra'], ['export', '-root', str(out), '--ensure-file', '-'],
                   ['export', '--ensure-file', '-', '--root', str(out)],
                   [*vector[:3], '--ensure-file', str(ensure)],
                   ['export', '--root', str(root), '--ensure-file', '-']]
    for name in ('wheels+'+'a'*25+'0', 'cpython+'+'a'*25+'0',
                 'virtualenv+'+'a'*25, 'virtualenv+'+'a'*25+'1',
                 'virtualenv+'+'a'*25+'w'):
        bad = out.parent.parent/name/'contents'
        bad.mkdir(parents=True)
        bad_vectors.append(['export', '--root', str(bad), '--ensure-file', '-'])
    outside = root/'tmp'/VIRTUALENV_PACKAGE_ID/'contents'
    outside.mkdir(parents=True)
    bad_vectors.append(['export', '--root', str(outside), '--ensure-file', '-'])
    file_out = out.parent.parent/('virtualenv+'+'b'*25+'0')/'contents'
    file_out.parent.mkdir()
    file_out.write_bytes(b'not a directory')
    bad_vectors.append(['export', '--root', str(file_out), '--ensure-file', '-'])
    bad_vectors.append(['export', '--root', str(out)+'/', '--ensure-file', '-'])
    for argv in bad_vectors:
        try: current['arguments']('cipd', argv)
        except (data.Denied, OSError): pass
        else: raise AssertionError('unexpected export vector accepted')
    bodies = [b'', VIRTUALENV_EXPORT_STDIN.replace(b'  ', b' '),
              VIRTUALENV_EXPORT_STDIN.replace(b'\n', b'\r\n'),
              VIRTUALENV_EXPORT_STDIN+b'other/package version:1\n',
              VIRTUALENV_EXPORT_STDIN.replace(b'20.25.1', b'20.25.2'),
              b'$ServiceURL https://private.invalid\n'+VIRTUALENV_EXPORT_STDIN,
              b'x'*100000]
    before = len(state.subprocess)
    for body in bodies:
        stream = io.BytesIO(body)
        current['sys'].stdin = SimpleNamespace(buffer=stream)
        try: current['execute']('cipd', vector, 'a'*64, 'b'*64)
        except data.Denied as error: assert str(error) == 'FULL_BOOTSTRAP_CIPD_EXPORT_INPUT'
        else: raise AssertionError('unexpected ensure stdin accepted')
        assert stream.tell() <= 58
    assert len(state.subprocess) == before
    class Expired:
        def remaining(self): raise data.Denied('ACQ_DEADLINE')
    try: current['export_input'](Expired())
    except data.Denied as error: assert str(error) == 'ACQ_DEADLINE'
    else: raise AssertionError('export input created a new clock')
    # The direct subprocess2 redirection must never bypass stdin validation.
    class Popen:
        def __init__(self, args, **kwargs): state.direct.append((args, kwargs))
    module = types.ModuleType('subprocess2')
    module.Popen = Popen
    with patch.dict(sys.modules, {'subprocess2': module}):
        current['bind']('a'*64, 'b'*64)
        try: module.Popen(['cipd', *vector])
        except data.Denied as error: assert str(error) == 'FULL_BOOTSTRAP_CIPD_EXPORT_ROLE'
        else: raise AssertionError('direct redirection bypassed stdin verifier')
        assert not state.direct
        module.Popen(['cipd', 'expand-package-name', 'infra/tools/${platform}'])
        assert state.direct[-1][0] == [command[0], 'expand-package-name', 'infra/tools/${platform}']
        assert state.direct[-1][1]['shell'] is False
    return {'legacyDenied': 'FULL_BOOTSTRAP_CIPD_ARGV', 'newAccepted': True,
            'argv': vector, 'stdinBytes': len(VIRTUALENV_EXPORT_STDIN),
            'stdinSha256': VIRTUALENV_EXPORT_STDIN_SHA256,
            'malformedVectorsDenied': len(bad_vectors), 'stdinCasesDenied': len(bodies),
            'directExportDenied': True, 'oldEnsureFamiliesUnchanged': True,
            'payloadExecutablesInvoked': 0, 'sourceDerivedNotObservedArgv': True}


def selected_virtualenv_export_guard(program, root, vector):
    namespace, _, _ = _bootstrap_export_namespace(program, Path(root))
    try: namespace['arguments']('cipd', vector)
    except (data.Denied, OSError) as error: return {'denied': True, 'code': str(error)}
    return {'denied': False}



# Exact native Hook class from depot_tools c101dcbe0489c455fce7c2247bfee19680b116c3/gclient.py.
# Only fixed stdlib/test recorders replace external calls; no payload executes.
PINNED_APACHE_HOOK_SOURCE = 'class Hook(object):\n    """Descriptor of command ran before/after sync or on demand."""\n\n    def __init__(\n        self,\n        action,\n        pattern=None,\n        name=None,\n        cwd=None,\n        condition=None,\n        variables=None,\n        verbose=False,\n        cwd_base=None,\n    ):\n        """Constructor.\n\n        Arguments:\n          action (list of str): argv of the command to run\n          pattern (str regex): noop with git; deprecated\n          name (str): optional name; no effect on operation\n          cwd (str): working directory to use\n          condition (str): condition when to run the hook\n          variables (dict): variables for evaluating the condition\n        """\n        self._action = gclient_utils.freeze(action)\n        self._pattern = pattern\n        self._name = name\n        self._cwd = cwd\n        self._condition = condition\n        self._variables = variables\n        self._verbose = verbose\n        self._cwd_base = cwd_base\n\n    @staticmethod\n    def from_dict(\n        d, variables=None, verbose=False, conditions=None, cwd_base=None\n    ):\n        """Creates a Hook instance from a dict like in the DEPS file."""\n        # Merge any local and inherited conditions.\n        gclient_eval.UpdateCondition(d, "and", conditions)\n        return Hook(\n            d["action"],\n            d.get("pattern"),\n            d.get("name"),\n            d.get("cwd"),\n            d.get("condition"),\n            variables=variables,\n            # Always print the header if not printing to a TTY.\n            verbose=verbose or not setup_color.IS_TTY,\n            cwd_base=cwd_base,\n        )\n\n    @property\n    def action(self):\n        return self._action\n\n    @property\n    def pattern(self):\n        return self._pattern\n\n    @property\n    def name(self):\n        return self._name\n\n    @property\n    def condition(self):\n        return self._condition\n\n    @property\n    def effective_cwd(self):\n        cwd = self._cwd_base\n        if self._cwd:\n            cwd = os.path.join(cwd, self._cwd)\n        return cwd\n\n    def matches(self, file_list):\n        """Returns true if the pattern matches any of files in the list."""\n        if not self._pattern:\n            return True\n        pattern = re.compile(self._pattern)\n        return bool([f for f in file_list if pattern.search(f)])\n\n    def run(self):\n        """Executes the hook\'s command (provided the condition is met)."""\n        if self._condition and not gclient_eval.EvaluateCondition(\n            self._condition, self._variables\n        ):\n            return\n\n        cmd = list(self._action)\n\n        if cmd[0] == "vpython3" and _detect_host_os() == "win":\n            cmd[0] += ".bat"\n\n        exit_code = 2\n        try:\n            start_time = time.time()\n            gclient_utils.CheckCallAndFilter(\n                cmd,\n                cwd=self.effective_cwd,\n                print_stdout=True,\n                show_header=True,\n                always_show_header=self._verbose,\n            )\n            exit_code = 0\n        except (gclient_utils.Error, subprocess2.CalledProcessError) as e:\n            # Use a discrete exit status code of 2 to indicate that a hook\n            # action failed.  Users of this script may wish to treat hook action\n            # failures differently from VC failures.\n            print("Error: %s" % str(e), file=sys.stderr)\n            sys.exit(exit_code)\n        finally:\n            elapsed_time = time.time() - start_time\n            metrics.collector.add_repeated(\n                "hooks",\n                {\n                    "action": gclient_utils.CommandToStr(cmd),\n                    "name": self._name,\n                    "cwd": os.path.relpath(\n                        os.path.normpath(self.effective_cwd), self._cwd_base\n                    ),\n                    "condition": self._condition,\n                    "execution_time": elapsed_time,\n                    "exit_code": exit_code,\n                },\n            )\n            if elapsed_time > 10:\n                print(\n                    "Hook \'%s\' took %.2f secs"\n                    % (gclient_utils.CommandToStr(cmd), elapsed_time)\n                )'
PINNED_APACHE_HOOK_SHA256 = 'e6b563524e7f5efab03547a60b0f36fa6a6772e5563f45741e5f111dc6e926e9'
APACHE_ACTION = ('python3','src/third_party/depot_tools/download_from_google_storage.py',
    '--no_resume','--directory','--recursive','--num_threads=16','--bucket',
    'chromium-apache-win32','src/third_party/apache-win32')


class ApacheSourceWitnessTests(unittest.TestCase):
    def test_native_hook_constructor_condition_dispatch_and_original_action_are_exact_primary_bytes(self):
        import ast
        self.assertEqual(hashlib.sha256(PINNED_APACHE_HOOK_SOURCE.encode()).hexdigest(),PINNED_APACHE_HOOK_SHA256)
        hook=ast.parse(PINNED_APACHE_HOOK_SOURCE).body[0]
        self.assertEqual(hook.name,'Hook')
        run=next(n for n in hook.body if isinstance(n,ast.FunctionDef)and n.name=='run')
        text=ast.get_source_segment(PINNED_APACHE_HOOK_SOURCE,run)
        self.assertIn('gclient_eval.EvaluateCondition(',text)
        self.assertIn('cmd = list(self._action)',text)
        self.assertIn('cwd=self.effective_cwd',text)


def selected_apache_worker_case(program,case):
    import contextlib,io,os,types
    state=SimpleNamespace(commands=[],bound=0,plain=0,evaluations=[],metrics=[],fanoutDenied=False,
        original_action=None,hook=None)
    class NativeError(Exception):pass
    class NativeCalledProcessError(Exception):pass
    namespace={
        'gclient_utils':None,'gclient_eval':None,'setup_color':SimpleNamespace(IS_TTY=False),
        'subprocess2':SimpleNamespace(CalledProcessError=NativeCalledProcessError),
        '_detect_host_os':lambda:'win','os':os,'sys':sys,'time':time,
        'metrics':SimpleNamespace(collector=SimpleNamespace(add_repeated=lambda name,row:state.metrics.append(row))),
    }
    def dispatch(command,*args,**kwargs):
        state.commands.append(list(command))
        if case in('post-action-replaced','first-failure'):
            state.hook._action=tuple(list(state.hook.action));state.hook._name='other'
        if case=='first-failure':raise NativeError('FIXED_FIRST_FAILURE')
        if 'chromium-apache-win32'in command and '--num_threads=16'in command:
            state.fanoutDenied=True
            raise NativeError('FIXTURE_16_WORKER_FANOUT')
        return 0
    utils=SimpleNamespace(freeze=lambda action:tuple(action),CheckCallAndFilter=dispatch,
        Error=NativeError,CommandToStr=lambda command:' '.join(command))
    def evaluate(condition,variables):
        state.evaluations.append(condition)
        return variables['checkout_win']
    namespace['gclient_utils']=utils;namespace['gclient_eval']=SimpleNamespace(EvaluateCondition=evaluate)
    exec(compile(PINNED_APACHE_HOOK_SOURCE,'<pinned-c101-native-Hook>','exec'),namespace)
    NativeHook=namespace['Hook']
    module=types.ModuleType('gclient');module.Hook=NativeHook;module.gclient_utils=utils
    bootstrap=types.ModuleType('source_bootstrap')
    def bind(a,b):assert(a,b)==('a'*64,'b'*64);state.bound+=1
    bootstrap.bind=bind
    def plain(file):state.plain+=1;return data.plain(file)
    bootstrap.data=SimpleNamespace(plain=plain)
    output=io.StringIO();errors=io.StringIO();error=None;exit_code=None
    with tempfile.TemporaryDirectory(prefix='cef-apache-projection-')as temp:
        folder=Path(temp).resolve();depot=folder/'depot_tools';depot.mkdir();commands=folder/'commands';commands.mkdir()
        adapter=commands/'python3.bat';raw=b'@echo off\r\n';adapter.write_bytes(raw)
        bootstrap.P={'workspace':folder.as_posix()}
        action=list(APACHE_ACTION);name='apache_win32';condition='checkout_win';pattern=r'\.sha1';cwd=str(folder);enabled=True
        if case=='unrelated':action=['python3','src/tools/another.py','--num_threads=16'];name='other';pattern='.'
        elif case=='false-condition':enabled=False
        elif case=='wrong-name':name='other'
        elif case=='wrong-condition':condition='checkout_win and another_flag'
        elif case=='wrong-pattern':pattern='.'
        elif case=='wrong-script':action[1]='src/third_party/depot_tools/../download_from_google_storage.py'
        elif case=='wrong-bucket':action[7]='chromium-apache-win32-other'
        elif case=='wrong-output':action[8]='src/third_party/another-apache'
        elif case=='wrong-flag-order':action[4],action[5]=action[5],action[4]
        elif case=='duplicate-threads':action.append('--num_threads=16')
        elif case=='already-two':action[5]='--num_threads=2'
        elif case=='extra-flag':action.append('--force')
        elif case=='cwd-outside':cwd=str(folder.parent)
        elif case=='cwd-alias':cwd=str(folder)+'/ignored/..'
        elif case not in('apache','post-action-replaced','first-failure'):raise ValueError('closed case')
        hook=NativeHook(action,pattern=pattern,name=name,condition=condition,
            variables={'checkout_win':enabled},cwd_base=cwd)
        state.original_action=hook.action;state.hook=hook
        def main(args):
            assert args==['runhooks','--jobs','2'];hook.run();return 0
        module.main=main
        previous_argv=sys.argv;previous_path=list(sys.path)
        try:
            sys.argv=['-c',str(depot),str(adapter),hashlib.sha256(raw).hexdigest(),'a'*64,'b'*64]
            with patch.dict(sys.modules,{'gclient':module,'source_bootstrap':bootstrap}),contextlib.redirect_stdout(output),contextlib.redirect_stderr(errors):
                exec(compile(program,'<actual-selected-dependency-hooks>','exec'),{})
        except SystemExit as caught:
            exit_code=caught.code
            if caught.code!=0:error={'type':'SystemExit','message':str(caught.code)}
        except BaseException as caught:error={'type':type(caught).__name__,'message':str(caught)[:512]}
        finally:sys.argv=previous_argv;sys.path[:]=previous_path
        same_action=hook.action is state.original_action and tuple(hook.action)==tuple(action)
    return {'case':case,'error':error,'exitCode':exit_code,'commands':state.commands,
        'originalActionRetained':same_action,'originalThreads':action[5]if name=='apache_win32'else None,
        'evaluatedConditions':state.evaluations,'bootstrapBound':state.bound,'plainChecks':state.plain,
        'modeledQuotaDenial':state.fanoutDenied,'stderr':errors.getvalue()[:1024],
        'quotaConditionModeled':True,'nativeJobExecuted':False,'payloadExecutablesInvoked':0,
        'nativeHookBytes':len(PINNED_APACHE_HOOK_SOURCE.encode()),
        'nativeHookSha256':hashlib.sha256(PINNED_APACHE_HOOK_SOURCE.encode()).hexdigest()}


if __name__=='__main__':unittest.main()
