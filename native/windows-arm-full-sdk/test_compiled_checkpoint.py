"""Portable codec/HTTPS interface tests. Native process records are modeled DATA.

Actual unchanged pinned archive pack/restore and real Windows file timestamp
operations run on a tiny owned fixture; no compiler, Siso, Job, Git or network.
"""
import ast
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import shutil
import types
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compiled_checkpoint as subject


CARRIER_HEAD = 'c' * 40  # Modeled current main H; original producer B stays a*40.


def carrier_metadata(route):
    prefix = '/repos/' + subject.REPOSITORY
    if route == prefix:
        return dict(id=subject.REPOSITORY_ID, full_name=subject.REPOSITORY,
                    private=False, visibility='public', default_branch='main')
    if route == prefix + '/git/ref/heads/main':
        return dict(ref='refs/heads/main', node_id='modeled-reference',
                    url=subject.API + prefix + '/git/refs/heads/main',
                    object=dict(type='commit', sha=CARRIER_HEAD,
                                url=subject.API + prefix + '/git/commits/' + CARRIER_HEAD))
    if route == prefix + '/git/commits/' + CARRIER_HEAD:
        return dict(sha=CARRIER_HEAD, tree=dict(sha='d' * 40))
    return None


def job(deadline=False):
    value = dict(kind='owned-job-proof', started=True, jobCreated=True, assignedBeforeResume=True, resumed=True,
                 assignedAtCreationVerified=True, handleListOnly=True, cleanupVerified=True, rootReaped=True,
                 logReadersStopped=True, assignmentMode='creation-attribute', activeAtEnd=0,
                 jobHandleInheritable=False, jobHandleInStdioAllowlist=False, cleanupBudgetMs=30000,
                 outputCapBytes=64 * 1024**2, capturedBytes=10, rootPid=102, rootCreationFiletime='1002',
                 policyReadback=dict(flags=0x2000 | 0x200 | 0x8, activeProcessLimit=64,
                                     jobMemoryBytes=str(8 * 1024**3), cpuFlags=5, cpuRate=2500,
                                     inheritedHandles=3, affinityChanged=False),
                 success=not deadline, outcome='deadline' if deadline else 'success',
                 rootExit=None if deadline else 0, finalRootExit=124 if deadline else 0, elapsedMs=1000)
    return value


class CodecTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name).resolve() / 'checkout' / 'checkout'
        self.repo.mkdir(parents=True)
        self.original_repo = subject.REPO
        self.root = self.repo / '.artifacts' / subject.inputs.root_name('20261030.294.1', subject.inputs.SOURCES['20261030.294.1'])
        self.root.mkdir(parents=True)
        self.patches = [patch.object(subject, 'REPO', self.repo), patch.object(subject.inputs, 'REPO', self.repo)]
        for p in self.patches: p.start()
        self.clock = types.SimpleNamespace(remaining=lambda: 2000)
        self.fence = lambda: None
        for name in subject.inputs.NAMESPACES: (self.root / name).mkdir()
        (self.root / 'source-checkout/src/out/Release_GN_arm64').mkdir(parents=True)
        (self.root / 'source-checkout/src/input.cc').write_bytes(b'actual bytes, modeled build\n')
        self.put(subject.OUT + '/args.gn', b'target_cpu="arm64"\n')
        self.put(subject.OUT + '/build.ninja', b'build partial.obj: phony\n')
        self.put(subject.OUT + '/partial.obj', b'fixture object DATA')
        helper = (self.original_repo / subject.HELPER).read_bytes().replace(b'\r\n', b'\n')
        path = self.repo / subject.HELPER
        path.parent.mkdir(parents=True)
        path.write_bytes(helper)
        self.rows = [dict(path=subject.HELPER, bytes=len(helper), sha256=subject.sha(helper))]
        self.put('source-inputs/0', helper)
        for name in ('private-qualification-profile.json', 'engine-qualification-profile.json'):
            relative = 'native/windows-arm-full-sdk/' + name
            raw = (self.original_repo / relative).read_bytes()
            target = self.repo / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            self.put('source-inputs/' + str(len(self.rows)), raw)
            self.rows.append(dict(path=relative, bytes=len(raw), sha256=subject.sha(raw)))
        workflow_bytes = b'fixed modeled workflow bytes\n'
        workflow_file = self.repo / subject.WORKFLOW
        workflow_file.parent.mkdir(parents=True)
        workflow_file.write_bytes(workflow_bytes)
        policy = dict(origin='owned-windows-arm64-full-sdk', workflow=subject.WORKFLOW,
                      workflowPin=dict(bytes=len(workflow_bytes), sha256=subject.sha(workflow_bytes)),
                      target='aarch64-pc-windows-msvc', producerInputs=self.rows)
        policy_raw = subject.canonical(policy) + b'\n'
        path = self.repo / 'native/windows-arm-full-sdk/sdk-origin-review.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(policy_raw)
        self.source = dict(kind='windows-arm-full-sdk-context', mode='full-sdk-source-gn', repository=subject.REPOSITORY,
                           repositoryId=str(subject.REPOSITORY_ID), workflow=subject.WORKFLOW, ref='refs/heads/main',
                           event='workflow_dispatch', visibility='public', image='20261030.294.1', target='aarch64-pc-windows-msvc',
                           sourceId=subject.inputs.SOURCES['20261030.294.1'], head='a' * 40, workflowSha='a' * 40,
                           runId='1234', attempt='1', sources=self.rows, originPolicySha256=subject.sha(policy_raw),
                           wallWholeEnd=subject.time.time() + 5000, monotonicWholeEnd=subject.time.monotonic() + 5000)
        self.source_pin = self.put('context.json', self.source)
        self.packet = dict(schemaVersion=1, kind='windows-arm-full-sdk-engine-context', role='cef-engine', mode='full-sdk-engine', sourceContextSha256=self.source_pin['sha256'],
                           target=self.source['target'], wallPhaseEnd=self.source['wallWholeEnd'] - 3600,
                           monotonicPhaseEnd=self.source['monotonicWholeEnd'] - 3600,
                           image=self.source['image'], sourceId=self.source['sourceId'], wallWholeEnd=self.source['wallWholeEnd'],
                           monotonicWholeEnd=self.source['monotonicWholeEnd'], parentPid=100, parentCreationFiletime='1000', metadataFiles=[],
                           gitPolicyFiles=[dict(relative='full-sdk-control/cef-source-git-policy/global.gitconfig', bytes=1, sha256='b' * 64),
                                           dict(relative='full-sdk-control/cef-source-git-policy/system.gitconfig', bytes=0, sha256=subject.sha(b''))],
                           prior=dict(result=dict(bytes=1, sha256='b' * 64), receipt=dict(bytes=1, sha256='b' * 64)))
        metadata = ['source-inputs/1', 'source-inputs/2'] + ['private-qualification-logs/' + name for name in
            ('qual-gn-desc-pa.stdout.log', 'qual-gn-desc-cef.stdout.log', 'qual-gn-args.stdout.log')]
        metadata += [subject.OUT + '/args.gn', subject.OUT + '/gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h',
                     subject.OUT + '/gen/cef/include/cef_config.h', 'full-metadata-result.json']
        for name in metadata:
            seal = self.measure(name) if (self.root / name).exists() else self.put(name, b'held metadata')
            self.packet['metadataFiles'].append(dict(relative=name, **seal))
        packet_pin = self.put('full-sdk-engine-cef-engine-context.json', self.packet)
        self.launch = dict(kind='windows-arm-full-sdk-engine-launch', role='cef-engine', contextSha256=packet_pin['sha256'],
                           ownPid=101, ownCreationFiletime='1001', parentPid=100, parentCreationFiletime='1000')
        self.put('full-sdk-engine-cef-engine-launch.json', self.launch)
        self.engine_job = job(True)
        jp = self.put('jobs/cef-engine/receipt.json', self.engine_job)
        self.closed = dict(kind='windows-arm-full-sdk-engine-launcher-close', role='cef-engine', ownPid=101,
                           ownCreationFiletime='1001', parentPid=100, parentCreationFiletime='1000',
                           sourceContextSha256=self.source_pin['sha256'], parentHandleClosed=True, ownHandleClosed=True,
                           sdkBuilt=False, nativeAcceptance=False, success=True, completion='native-slice-ended',
                           receiptPin=jp, jobSeconds=1)
        self.put('full-sdk-engine-closed-cef-engine.json', self.closed)
        source_job = dict(job(), outputCapBytes=131072, rootPid=82, rootCreationFiletime='802')
        self.put('jobs/full-source-operation/receipt.json', source_job)
        self.put('full-source-launcher-result.json', dict(success=True, sdkBuilt=False, originalOperationJob=source_job,
                                                         ownPid=90, ownCreationFiletime='900'))
        self.put('full-source-closed-launcher.json', dict(success=True, parentHandleClosed=True, ownHandleClosed=True,
                                                       ownPid=90, ownCreationFiletime='900', parentCreationFiletime='1000'))
        pins = [dict(path=name, name=name, **self.measure(subject.OUT + '/' + name)) for name in ('args.gn', 'build.ninja')]
        graph = dict(kind='sorng-cef-fresh-graph-pins', complete=True, files=2, bytes=sum(p['bytes'] for p in pins),
                     sha256=subject.sha(subject.canonical(pins)), pins=pins)
        gp = self.put(subject.GRAPH_FILE, graph)
        tools = dict(kind='windows-arm-full-installed-source-inventory', files=[dict(path='fixed/tool', bytes=3, sha256='b' * 64)],
                     executed=False, previous14AreCompleteClosure=False)
        tools['sha256'] = subject.sha(subject.canonical(tools['files']))
        tp = self.put(subject.TOOL_FILE, tools)
        self.identity = dict(image=self.source['image'], sourceId=self.source['sourceId'],
                             producerSha256=subject.producer_digest(self.rows), sourceDateEpoch=dict(present=False, value=None),
                             canonicalRoot=self.root.name, toolProofPin=tp, graphPin=gp)

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def put(self, name, value):
        raw = value if type(value) is bytes else subject.canonical(value) + b'\n'
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(raw)
        return dict(bytes=len(raw), sha256=subject.sha(raw))

    def measure(self, name):
        raw = (self.root / name).read_bytes()
        return dict(bytes=len(raw), sha256=subject.sha(raw))

    def guard(self):
        return subject.guard_for(self.root, self.identity, self.clock, self.fence)[0]

    def test_actual_unchanged_pinned_pack_restore_and_input_sidecar_seal_modeled_native_deadline(self):
        result = subject.seal_checkpoint(self.root, self.identity, self.clock, self.fence)
        self.assertTrue(result['dataOnly'])
        record = result['record']
        self.assertEqual(record['rawChain']['outcome'], 'quiet-deadline')
        self.assertFalse(record['sdkBuilt'])
        self.assertFalse(record['executionAdmitted'])
        self.assertEqual((self.root / 'full-sdk-checkpoint-roundtrip/partial.obj').read_bytes(), b'fixture object DATA')
        assets = subject.validate_record(record, self.identity)
        self.assertEqual({row['name'] for row in assets}, {'inputs.jsonl', 'graph.json', 'tools.json', 'native-chain.json', 'inventory.json', 'checkpoint-00000.bin'})

    def test_actual_chain_missing_close_wrong_policy_cancel_outputcap_and_near_deadline_deny(self):
        for field, wrong in (('outcome', 'cancelled'), ('outcome', 'output-cap'), ('rootReaped', False),
                             ('activeAtEnd', False), ('logReadersStopped', False), ('finalRootExit', 0), ('elapsedMs', 999)):
            changed = dict(self.engine_job, **{field: wrong})
            self.put('jobs/cef-engine/receipt.json', changed)
            with self.subTest(field=field, wrong=wrong), self.assertRaises(ValueError):
                subject.validate_chain(self.guard(), self.identity)
        self.put('jobs/cef-engine/receipt.json', self.engine_job)
        for field, wrong in (('ownHandleClosed', False), ('parentHandleClosed', None), ('ownPid', 999), ('success', False)):
            self.put('full-sdk-engine-closed-cef-engine.json', dict(self.closed, **{field: wrong}))
            with self.subTest(field=field), self.assertRaises(ValueError):
                subject.validate_chain(self.guard(), self.identity)

    def test_actual_source_launcher_and_job_receipt_writer_bind_the_source_output_cap(self):
        # Execute the real launcher and the real receipt-field assignment with
        # modeled kernel work. This catches a producer/consumer mismatch without
        # inventing another independently matching native receipt schema.
        source_ast = ast.parse((self.original_repo / 'native/windows-arm-full-sdk/full_sdk_source.py').read_bytes())
        launcher_ast = next(node for node in source_ast.body if isinstance(node, ast.FunctionDef) and node.name == '_run_source_launcher')
        job_ast = ast.parse((self.original_repo / 'native/windows-arm-full-sdk/job.py').read_bytes())
        assignments = [node for node in ast.walk(job_ast) if isinstance(node, ast.Assign) and
                       any(isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and
                           target.value.id == 'result' and isinstance(target.slice, ast.Constant) and
                           target.slice.value == 'outputCapBytes' for target in node.targets)]
        self.assertEqual(len(assignments), 1)
        field_writer = compile(ast.Module(body=assignments, type_ignores=[]), '<actual-job-receipt-field>', 'exec')
        observed = []
        reports = {}
        def native_model(*args, **kwargs):
            result = dict(job(), rootPid=82, rootCreationFiletime='802')
            exec(field_writer, {'result': result, 'cap': kwargs['cap']})
            observed.append(result)
            return result
        scope = dict(need=subject.need, _OPERATION='full-source-operation',
                     _live_mutation_fence=lambda state: None, _owned_root_fence=lambda state: None,
                     _verified_active_sources=lambda root: None, _worker_argv=lambda *args: ['modeled-native-work'],
                     _save_owned_report=lambda state, name, value: reports.update({name: value}))
        exec(compile(ast.Module(body=[launcher_ast], type_ignores=[]), '<actual-source-launcher>', 'exec'), scope)
        launch_root = self.root / 'actual-launcher-model'
        launch_root.mkdir()
        state = dict(root=launch_root, profile={}, clock=self.clock,
                     native=dict(parent=object(), pid=90, creationFiletime='900', parentCreationFiletime='1000'))
        with patch.dict(sys.modules, {'job': types.SimpleNamespace(run_job=native_model)}):
            self.assertEqual(scope['_run_source_launcher'](state), 0)
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0]['outputCapBytes'], 131072)
        # The old shared engine-cap predicate rejects the actual source writer.
        with self.assertRaisesRegex(ValueError, 'JOB_CLOSURE'):
            subject._job(observed[0])
        self.put('jobs/full-source-operation/receipt.json', observed[0])
        self.put('full-source-launcher-result.json', reports['full-source-launcher-result.json'])
        self.assertEqual(subject.validate_chain(self.guard(), self.identity)[1]['outcome'], 'quiet-deadline')

    def test_source_and_engine_output_caps_remain_distinct_and_strict(self):
        source_job = dict(job(), rootPid=82, rootCreationFiletime='802', outputCapBytes=131072)
        for fields in (dict(outputCapBytes=64 * 1024**2), dict(outputCapBytes=131071),
                       dict(outputCapBytes=131073), dict(capturedBytes=131073)):
            with self.subTest(role='source', fields=fields), self.assertRaisesRegex(ValueError, 'JOB_CLOSURE'):
                subject._job(dict(source_job, **fields), output_cap=131072)
        for fields in (dict(outputCapBytes=131072), dict(capturedBytes=64 * 1024**2 + 1)):
            with self.subTest(role='cef', fields=fields), self.assertRaisesRegex(ValueError, 'JOB_CLOSURE'):
                subject._job(dict(self.engine_job, **fields), True)

    def test_canonical_producer_and_strict_json_reject_duplicates_and_unknown_identity(self):
        independent = hashlib.sha256(json.dumps(sorted(self.rows, key=lambda r: r['path']), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(subject.producer_digest(self.rows), independent)
        for rows in ([*self.rows, *self.rows], [dict(self.rows[0], path='../escape')], [dict(self.rows[0], bytes=True)]):
            with self.assertRaises(ValueError): subject.producer_digest(rows)
        for raw in (b'{"a":1,"a":2}', b'{"a":1,"\\u0061":2}', b'{"a":NaN}'):
            with self.assertRaises(ValueError): subject.strict_json(raw)
        with self.assertRaises(ValueError): subject.identity_header(dict(self.identity, grant=True))

    def test_original_whole_end_clips_pack_before_any_helper_can_get_new_lease(self):
        guard = self.guard()
        self.source['wallWholeEnd'] = subject.time.time() + 149
        self.put('context.json', self.source)
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_RESERVE'):
            subject._seconds(guard)

    def test_first_falsy_failure_survives_close_and_stage_has_only_bounded_context(self):
        class FalsyError(Exception):
            def __bool__(self): return False
        first = FalsyError('secret token raw path must not be projected')
        class Resource:
            def close(self): raise RuntimeError('later')
        with self.assertRaises(FalsyError) as caught:
            with subject.stage('pack', 'source-checkout/src/input.cc', files=2), subject.owned(Resource()):
                raise first
        self.assertIs(caught.exception, first)
        projected = subject.failure_context(first)
        self.assertEqual(projected['stage'], 'pack')
        self.assertNotIn('secret', json.dumps(projected))
        self.assertEqual(projected['files'], 2)

    def test_actual_api_run_predicate_requires_terminal_success_exact_attempt_workflow_public_repo(self):
        run = dict(id=1234, run_attempt=1, repository=dict(id=subject.REPOSITORY_ID, full_name=subject.REPOSITORY,
                   private=False, default_branch='main'), head_branch='main', event='workflow_dispatch',
                   workflow_id=42, path=subject.WORKFLOW, head_sha='a' * 40, status='completed', conclusion='success')
        workflow = dict(id=42, path=subject.WORKFLOW)
        class Client:
            def get(self, route):
                if route == '/repos/' + subject.REPOSITORY:
                    return dict(id=subject.REPOSITORY_ID, full_name=subject.REPOSITORY, private=False, default_branch='main')
                return copy.deepcopy(workflow if '/workflows/' in route else run)
        self.assertEqual(subject._run(Client(), '1234', '1')['id'], 1234)
        for field, wrong in (('conclusion', 'failure'), ('status', 'in_progress'), ('run_attempt', 2),
                             ('head_branch', 'other'), ('workflow_id', 43)):
            original = run[field]
            run[field] = wrong
            with self.subTest(field=field), self.assertRaises(ValueError): subject._run(Client(), '1234', '1')
            run[field] = original

    def test_asset_download_bounds_hash_and_unknown_names_cannot_be_exposed(self):
        class Response(io.BytesIO):
            pass
        data = b'fixed asset'
        class Client:
            clock = types.SimpleNamespace(remaining=lambda: 100)
            def response(self, *args, **kwargs): return Response(data), len(data)
        expected = dict(bytes=len(data), sha256=subject.sha(data))
        file = self.root / 'downloaded.bin'
        subject._download_asset(Client(), dict(id=1, size=len(data)), file, expected, 100)
        self.assertEqual(file.read_bytes(), data)
        with self.assertRaisesRegex(ValueError, 'ASSET_HASH'):
            subject._download_asset(Client(), dict(id=1, size=len(data)), self.root / 'wrong.bin', dict(expected, sha256='f' * 64), 100)
        class Assets:
            def get(self, route): return [dict(id=1, name='../secret', size=1, state='uploaded')]
        with self.assertRaisesRegex(ValueError, 'ASSET_ROW'): subject._release_assets(Assets(), dict(id=2))

    def test_actual_codec_fresh_restore_same_canonical_root_before_gn_and_metadata(self):
        sealed = subject.seal_checkpoint(self.root, self.identity, self.clock, self.fence)
        old_root = self.root.with_name(self.root.name + '-retained')
        self.assertEqual(old_root.parent, self.repo / '.artifacts')
        self.root.rename(old_root)
        self.root.mkdir()
        for namespace in (*subject.inputs.NAMESPACES, 'source-inputs'):
            shutil.copytree(old_root / namespace, self.root / namespace)
        shutil.copyfile(old_root / subject.TOOL_FILE, self.root / subject.TOOL_FILE)
        fresh = dict(self.source, runId='5678', head='b' * 40, workflowSha='b' * 40)
        fresh_pin = self.put('context.json', fresh)
        download = self.repo.parent.parent / '_temp/sorng-windows-arm-checkpoint-5678-1'
        download.mkdir(parents=True)
        for file in (old_root / subject.OUTPUT).iterdir():
            shutil.copyfile(file, download / file.name)
        ready = dict(kind='windows-arm-full-sdk-checkpoint-download', schemaVersion=1, record=sealed['checkpoint'],
                     priorRunId='1234', priorAttempt='1', currentRunId='5678', currentAttempt='1',
                     head=self.source['head'], identity=self.identity)
        ready_raw = subject.canonical(ready) + b'\n'
        (download / 'ready.json').write_bytes(ready_raw)
        input_file = self.root / 'source-checkout/src/input.cc'
        original_ns = input_file.stat().st_mtime_ns
        os.utime(input_file, ns=(original_ns + 1000000000, original_ns + 1000000000))
        result = subject.restore_checkpoint(self.root, self.identity, fresh_pin['sha256'],
                 dict(bytes=len(ready_raw), sha256=subject.sha(ready_raw)), self.clock, self.fence)
        self.assertTrue(result['restored'])
        self.assertFalse(result['sourceQualified'])
        self.assertEqual(input_file.stat().st_mtime_ns, original_ns)
        self.assertEqual((self.root / subject.OUT / 'partial.obj').read_bytes(), b'fixture object DATA')
        self.assertEqual(result['priorGraph']['files'], 2)
        self.assertTrue((self.root / 'source-checkout/src/out/Release_GN_arm64.fresh-gn').is_dir())

    def test_fixed_https_redirect_strips_token_and_foreign_host_or_header_failure_closes(self):
        from email.message import Message
        class Response(io.BytesIO):
            status = 200
            def __init__(self, raw=b'fixed'):
                super().__init__(raw)
                self.headers = Message()
                self.headers['Content-Length'] = str(len(raw))
        for target, allowed in (('https://release-assets.githubusercontent.com/fixed', True), ('https://foreign.example/secret', False)):
            client = subject.Github('fixture-secret', self.clock)
            requests = []
            final = Response()
            class Opener:
                def open(self, request, timeout):
                    requests.append(request)
                    if len(requests) == 1:
                        headers = Message()
                        headers['Location'] = target
                        raise subject.urllib.error.HTTPError(request.full_url, 302, 'redirect', headers, io.BytesIO())
                    return final
            client.opener = Opener()
            if allowed:
                response, length = client.response('GET', '/repos/' + subject.REPOSITORY + '/releases/assets/1', asset=True, maximum=10)
                with subject.owned(response): self.assertEqual(response.read(), b'fixed')
                self.assertEqual(length, 5)
                self.assertEqual(requests[0].get_header('Authorization'), 'Bearer fixture-secret')
                self.assertIsNone(requests[1].get_header('Authorization'))
            else:
                with self.assertRaisesRegex(ValueError, 'ASSET_REDIRECT'):
                    client.response('GET', '/repos/' + subject.REPOSITORY + '/releases/assets/1', asset=True, maximum=10)
                self.assertEqual(len(requests), 1)
        client = subject.Github('fixture-secret', self.clock)
        response = Response()
        response.headers['Content-Length'] = '5'  # Duplicate header is denied.
        client.opener = types.SimpleNamespace(open=lambda *a, **k: response)
        with self.assertRaisesRegex(ValueError, 'HTTP_LENGTH'):
            client.response('GET', '/repos/' + subject.REPOSITORY)
        self.assertTrue(response.closed)
        # Actual GitHub API headers observed in the bounded live read omit CL.
        # Bounded read+EOF and exact authenticated asset pins still govern data.
        response = Response()
        del response.headers['Content-Length']
        client.opener = types.SimpleNamespace(open=lambda *a, **k: response)
        value, length = client.response('GET', '/repos/' + subject.REPOSITORY)
        with subject.owned(value): self.assertEqual(value.read(), b'fixed')
        self.assertIsNone(length)
        with self.assertRaisesRegex(ValueError, 'API_CLOSED_ROUTE'):
            client.response('DELETE', '/repos/' + subject.REPOSITORY + '/releases/1')

    def test_codec_cli_never_reads_transport_token_and_evidence_is_raw_byte_bound(self):
        with patch.dict(os.environ, GH_TOKEN='fixture-secret'):
            with self.assertRaisesRegex(ValueError, 'RESTORE_PACKET'):
                subject.main(['--restore', str(self.root), self.source_pin['sha256']])
            self.assertEqual(os.environ['GH_TOKEN'], 'fixture-secret')
        sealed = subject.seal_checkpoint(self.root, self.identity, self.clock, self.fence)
        evidence = json.loads((self.root / subject.OUTPUT / 'native-chain.json').read_bytes())
        parsed = subject.validate_evidence(sealed['record'], evidence)
        self.assertEqual(parsed['job']['outcome'], 'deadline')
        changed = copy.deepcopy(evidence)
        changed['jobs/cef-engine/receipt.json']['base64'] = base64.b64encode(b'{}').decode()
        with self.assertRaisesRegex(ValueError, 'EVIDENCE_PIN'):
            subject.validate_evidence(sealed['record'], changed)

    def test_fresh_carrier_finite_inverse_restores_complete_reviewed_codec(self):
        raw = Path(subject.__file__).read_text()
        start = raw.index('# BEGIN FRESH DEFAULT-MAIN TRANSPORT CARRIER\n')
        end = raw.index('# END FRESH DEFAULT-MAIN TRANSPORT CARRIER\n', start) + len('# END FRESH DEFAULT-MAIN TRANSPORT CARRIER\n\n\n')
        raw = raw[:start] + raw[end:]
        replacements = (
            ("\n\nSAFE_CODES = SAFE_CODES | frozenset({'CARRIER_REPOSITORY', 'CARRIER_REF', 'CARRIER_COMMIT',\n                                    'CARRIER_CHANGED', 'CARRIER_RELEASE'})\n",
             ''),
            ("                      r'/actions/workflows/windows-arm-full-sdk\\.yml', r'/git/ref/heads/main', r'/git/commits/[a-f0-9]{40}',\n",
             "                      r'/actions/workflows/windows-arm-full-sdk\\.yml', r'/git/commits/[a-f0-9]{40}',\n"),
            ('    release = _create_transport_release(client, release_tag)\n',
             "    release = client.post('/repos/' + REPOSITORY + '/releases', dict(tag_name=release_tag, name=release_tag,\n                         target_commitish=current['head_sha'], draft=True, prerelease=True))\n"),
            ("         release.get('tag_name') == release_tag, 'SDK_QUARANTINE_RELEASE')\n",
             "         release.get('tag_name') == release_tag and release.get('target_commitish') == current['head_sha'], 'SDK_QUARANTINE_RELEASE')\n"),
            ("                    release=dict(id=release['id'], tag=release_tag, head=source['head'], carrierHead=release['target_commitish']),\n",
             "                    release=dict(id=release['id'], tag=release_tag, head=source['head']),\n"),
            ("    need(type(seal['release']) is dict and set(seal['release']) == {'id', 'tag', 'head', 'carrierHead'} and\n",
             "    need(type(seal['release']) is dict and set(seal['release']) == {'id', 'tag', 'head'} and\n"),
            ("         type(seal['release']['carrierHead']) is str and re.fullmatch('[a-f0-9]{40}', seal['release']['carrierHead']) and\n",
             ''),
            ("    _carrier_commit(client, immutable['release']['carrierHead'])\n",
             ''),
            ("    need(type(release) is dict and release.get('id') == immutable['release']['id'] and\n         release.get('tag_name') == immutable['release']['tag'] and release.get('name') == immutable['release']['tag'] and\n         release.get('draft') is True and release.get('prerelease') is True and\n         release.get('target_commitish') == immutable['release']['carrierHead'], 'RELEASE_SCOPE')\n",
             "    need(release.get('id') == immutable['release']['id'] and release.get('tag_name') == immutable['release']['tag'] and\n         release.get('draft') is True and release.get('prerelease') is True and release.get('target_commitish') == prior['head_sha'], 'RELEASE_SCOPE')\n"),
            ('    release = _create_transport_release(client, tag(record, record_pin))\n',
             "    release = client.post('/repos/' + REPOSITORY + '/releases',\n                          dict(tag_name=tag(record, record_pin), target_commitish=current['head_sha'],\n                               name=tag(record, record_pin), draft=True, prerelease=True))\n"),
            ("         release.get('tag_name') == tag(record, record_pin), 'UPLOAD_RELEASE')\n",
             "         release.get('target_commitish') == current['head_sha'] and release.get('tag_name') == tag(record, record_pin), 'UPLOAD_RELEASE')\n"),
            ("                    identity=identity, release=dict(id=release['id'], tag=release['tag_name'], head=current['head_sha'], carrierHead=release['target_commitish']),\n",
             "                    identity=identity, release=dict(id=release['id'], tag=release['tag_name'], head=current['head_sha']),\n"),
        )
        for after, before in replacements:
            self.assertEqual(raw.count(after), 1)
            raw = raw.replace(after, before, 1)
        self.assertEqual(subject.sha(raw.encode()), 'a945464bead52c2d8413fd05fdc158f250749a8d85caab87a29782a5edeae2d9')

    def test_fresh_transport_carrier_rechecks_public_default_main_before_one_post(self):
        prefix = '/repos/' + subject.REPOSITORY
        class Client:
            clock = self.clock
            def __init__(self):
                self.posts, self.gets, self.release = [], [], None
            def get(self, route):
                self.gets.append(route)
                return copy.deepcopy(self.release if route == prefix + '/releases/42' else carrier_metadata(route))
            def post(self, route, body):
                self.posts.append((route, copy.deepcopy(body)))
                self.release = dict(id=42, **body)
                return copy.deepcopy(self.release)
        client = Client()
        result = subject._create_transport_release(client, 'fixed-fixture-tag')
        self.assertEqual(result['target_commitish'], CARRIER_HEAD)
        self.assertEqual(client.gets, [prefix, prefix + '/git/ref/heads/main',
                         prefix + '/git/commits/' + CARRIER_HEAD, prefix,
                         prefix + '/git/ref/heads/main', prefix + '/releases/42'])
        self.assertEqual(len(client.posts), 1)
        # Every preflight mismatch denies before POST. These are transport
        # observations, not caller-supplied source or execution permissions.
        for label, route_suffix, occurrence, mutate in (
            ('private', '', 1, lambda v: v.update(private=True)),
            ('internal', '', 1, lambda v: v.update(visibility='internal')),
            ('visibility-missing', '', 1, lambda v: v.pop('visibility')),
            ('repository', '', 1, lambda v: v.update(id=1)),
            ('default', '', 2, lambda v: v.update(default_branch='other')),
            ('ref', '/git/ref/heads/main', 1, lambda v: v.update(ref='refs/heads/other')),
            ('ref-url', '/git/ref/heads/main', 1, lambda v: v.update(url='https://foreign.example/ref')),
            ('object', '/git/ref/heads/main', 1, lambda v: v['object'].update(type='tag')),
            ('commit', '/git/commits/' + CARRIER_HEAD, 1, lambda v: v.update(sha='e' * 40)),
            ('tree', '/git/commits/' + CARRIER_HEAD, 1, lambda v: v.update(tree=None)),
            ('moved', '/git/ref/heads/main', 2, lambda v: v['object'].update(
                sha='e' * 40, url=subject.API + prefix + '/git/commits/' + 'e' * 40)),
        ):
            client = Client()
            original = client.get
            seen = []
            def changed(route):
                value = original(route)
                if route == prefix + route_suffix:
                    seen.append(route)
                    if len(seen) == occurrence: mutate(value)
                return value
            client.get = changed
            with self.subTest(label=label), self.assertRaises(ValueError):
                subject._create_transport_release(client, 'fixed-fixture-tag')
            self.assertFalse(client.posts)
        # The original clock failure is propagated without retries or renewal.
        failure = RuntimeError('modeled original lease expiry')
        client = Client()
        calls = []
        def remaining():
            calls.append(None)
            if len(calls) == 2: raise failure
            return 1
        client.clock = types.SimpleNamespace(remaining=remaining)
        with self.assertRaises(RuntimeError) as caught:
            subject._create_transport_release(client, 'fixed-fixture-tag')
        self.assertIs(caught.exception, failure)
        self.assertFalse(client.posts)

    def test_transport_carrier_post_and_readback_are_exact_no_retry_or_producer_relabel(self):
        prefix = '/repos/' + subject.REPOSITORY
        for location in ('post', 'readback'):
            for field, wrong in (('id', 43), ('tag_name', 'other'), ('name', 'other'),
                                 ('target_commitish', self.source['head']), ('draft', False), ('prerelease', False)):
                posts = []
                class Client:
                    clock = self.clock
                    def post(self, route, body):
                        posts.append(body)
                        result = dict(id=42, **body)
                        if location == 'post': result[field] = wrong if field != 'id' else 0
                        return result
                    def get(self, route):
                        value = carrier_metadata(route)
                        if value is not None: return value
                        self_test.assertEqual(route, prefix + '/releases/42')
                        result = dict(id=42, **posts[0])
                        result[field] = wrong
                        return result
                self_test = self
                with self.subTest(location=location, field=field), self.assertRaisesRegex(ValueError, 'CARRIER_RELEASE'):
                    subject._create_transport_release(Client(), 'fixed-fixture-tag')
                self.assertEqual(len(posts), 1)
        # Python bool equality cannot substitute for typed numeric release id.
        class BooleanReadback:
            clock = self.clock
            def post(self, route, body):
                self.release = dict(id=1, **body)
                return copy.deepcopy(self.release)
            def get(self, route):
                if route == prefix + '/releases/1': return dict(self.release, id=True)
                return carrier_metadata(route)
        with self.assertRaisesRegex(ValueError, 'CARRIER_RELEASE'):
            subject._create_transport_release(BooleanReadback(), 'fixed-fixture-tag')
        class Denied:
            clock = self.clock
            def get(self, route): return carrier_metadata(route)
            def post(self, route, body): raise subject.CheckpointFailure('API_STATUS')
        with self.assertRaisesRegex(ValueError, 'API_STATUS'):
            subject._create_transport_release(Denied(), 'fixed-fixture-tag')

    def test_carrier_ref_uses_authenticated_fixed_route_and_never_follows_redirect(self):
        from email.message import Message
        prefix = '/repos/' + subject.REPOSITORY
        requests = []
        class Response(io.BytesIO):
            status = 200
            def __init__(self):
                raw = subject.canonical(carrier_metadata(prefix + '/git/ref/heads/main'))
                super().__init__(raw)
                self.headers = Message()
                self.headers['Content-Length'] = str(len(raw))
        client = subject.Github('fixture-secret', self.clock)
        def opened(request, timeout):
            requests.append(request)
            return Response()
        client.opener = types.SimpleNamespace(open=opened)
        self.assertEqual(subject._carrier_ref(client), CARRIER_HEAD)
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer fixture-secret')
        self.assertEqual(requests[0].full_url, subject.API + prefix + '/git/ref/heads/main')
        for method, route in (('GET', '/git/ref/heads/other'), ('GET', '/git/refs/heads/main'),
                              ('POST', '/git/ref/heads/main'), ('GET', '/git/ref/heads/main?x=1')):
            with self.subTest(method=method, route=route), self.assertRaisesRegex(ValueError, 'API_CLOSED_ROUTE'):
                client.response(method, prefix + route)
        self.assertEqual(len(requests), 1)
        def redirected(request, timeout):
            requests.append(request)
            headers = Message()
            headers['Location'] = 'https://release-assets.githubusercontent.com/foreign-ref'
            raise subject.urllib.error.HTTPError(request.full_url, 302, 'redirect', headers, io.BytesIO())
        client.opener = types.SimpleNamespace(open=redirected)
        with self.assertRaisesRegex(ValueError, 'API_STATUS'):
            subject._carrier_ref(client)
        self.assertEqual(len(requests), 2)

    def test_actual_git_blob_tree_binding_denies_foreign_workflow_or_changed_producer_bytes(self):
        workflow = b'fixed workflow bytes\n'
        rows = [*self.rows, dict(path=subject.WORKFLOW, bytes=len(workflow), sha256=subject.sha(workflow))]
        contents = {row['path']: (workflow if row['path'] == subject.WORKFLOW else (self.repo / row['path']).read_bytes()) for row in rows}
        blobs, entries = {}, []
        for row in rows:
            raw = contents[row['path']]
            git_sha = hashlib.sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()
            entries.append(dict(path=row['path'], type='blob', mode='100644', sha=git_sha, size=len(raw)))
            blobs[git_sha] = dict(sha=git_sha, encoding='base64', size=len(raw), content=base64.b64encode(raw).decode())
        class Client:
            def get(self, route, maximum=subject.MAX_RECORD):
                if '/git/commits/' in route: return dict(sha='a' * 40, tree=dict(sha='b' * 40))
                if '/git/trees/' in route: return dict(truncated=False, tree=entries)
                return blobs[route.rsplit('/', 1)[1]]
        wp = dict(bytes=len(workflow), sha256=subject.sha(workflow))
        subject._tree(Client(), 'a' * 40, self.rows, wp)
        entries[-1]['mode'] = '120000'
        with self.assertRaisesRegex(ValueError, 'TREE_PATH'): subject._tree(Client(), 'a' * 40, self.rows, wp)
        entries[-1]['mode'] = '100644'
        first = next(iter(blobs.values()))
        first['content'] = base64.b64encode(b'changed').decode()
        with self.assertRaisesRegex(ValueError, 'BLOB_PIN'): subject._tree(Client(), 'a' * 40, self.rows, wp)

    def test_fixed_transport_complete_asset_download_creates_ready_only_after_all_hashes(self):
        sealed = subject.seal_checkpoint(self.root, self.identity, self.clock, self.fence)
        record, rp = sealed['record'], sealed['checkpoint']
        names = [dict(name='checkpoint.json', **rp), *subject.validate_record(record, self.identity)]
        bodies = {index: (self.root / subject.OUTPUT / row['name']).read_bytes() for index, row in enumerate(names, 1)}
        assets = [dict(id=index, name=row['name'], size=row['bytes'], state='uploaded', digest='sha256:' + row['sha256']) for index, row in enumerate(names, 1)]
        release = dict(id=42, tag_name=subject.tag(record, rp), name=subject.tag(record, rp),
                       draft=True, prerelease=True, target_commitish=CARRIER_HEAD)
        current = dict(id=5678, run_attempt=1)
        prior = dict(head_sha=self.source['head'])
        policy = dict(producerInputs=self.rows, workflowPin=dict(bytes=1, sha256='b' * 64))
        seal = dict(schemaVersion=1, kind='windows-arm-full-sdk-immutable-checkpoint-seal', workflow=record['workflow'], identity=self.identity,
                    release=dict(id=42, tag=release['tag_name'], head=self.source['head'], carrierHead=CARRIER_HEAD), record=rp,
                    assets=[dict(id=index, **row) for index, row in enumerate(names, 1)],
                    nativeEvidence=record['nativeEvidence'], sourceContext=record['rawChain']['sourceContext'])
        zip_buffer = io.BytesIO()
        with subject.zipfile.ZipFile(zip_buffer, 'w', compression=subject.zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr('checkpoint-seal.json', subject.canonical(seal))
        zip_raw = zip_buffer.getvalue()
        artifact = dict(id=999, name=subject.seal_name('1234', '1'), expired=False, size_in_bytes=len(zip_raw), digest='sha256:' + subject.sha(zip_raw),
                        workflow_run=dict(id=1234, repository_id=subject.REPOSITORY_ID, head_repository_id=subject.REPOSITORY_ID,
                                          head_branch='main', head_sha=self.source['head']))
        class Client:
            clock = self.clock
            def get(self, route, maximum=subject.MAX_RECORD):
                metadata = carrier_metadata(route)
                if metadata is not None: return metadata
                if '/artifacts?' in route: return dict(total_count=1, artifacts=[artifact])
                return assets if '/assets?' in route else release
            def response(self, method, route, **kwargs):
                downloads.append(route)
                raw = zip_raw if '/actions/artifacts/' in route else bodies[int(route.rsplit('/', 1)[1])]
                return io.BytesIO(raw), len(raw)
        temp = self.repo.parent.parent / '_temp'
        temp.mkdir()
        with patch.dict(os.environ, RUNNER_TEMP=str(temp)), patch.object(subject, '_transport_scope', return_value=(current, policy)), \
             patch.object(subject, '_run', return_value=prior), patch.object(subject, '_tree'):
            downloads = []
            result = subject.transport_download(Client(), '1234', '1', self.source['image'])
            ready = temp / 'sorng-windows-arm-checkpoint-5678-1/ready.json'
            self.assertEqual(subject.sha(ready.read_bytes()), result['readyPin']['sha256'])
            self.assertEqual(json.loads(ready.read_bytes())['priorRunId'], '1234')
            self.assertEqual(json.loads(ready.read_bytes())['sealArtifact']['id'], 999)
            # Stored H is transport data, not current main and never producer
            # B. A mutable release or raw immutable seal cannot swap those roles.
            original_release, original_seal = copy.deepcopy(release), copy.deepcopy(seal)
            for index, (label, expected) in enumerate((('target', 'RELEASE_SCOPE'), ('name', 'RELEASE_SCOPE'),
                    ('producer', 'SEAL_RELEASE'), ('missing-carrier', 'SEAL_RELEASE'), ('carrier', 'CARRIER_COMMIT'))):
                current['id'] = 5680 + index
                release.clear()
                release.update(copy.deepcopy(original_release))
                seal.clear()
                seal.update(copy.deepcopy(original_seal))
                if label == 'target': release['target_commitish'] = self.source['head']
                elif label == 'name': release['name'] = 'other'
                elif label == 'producer': seal['release']['head'] = CARRIER_HEAD
                elif label == 'missing-carrier': del seal['release']['carrierHead']
                elif label == 'carrier': seal['release']['carrierHead'] = 'e' * 40
                buffer = io.BytesIO()
                with subject.zipfile.ZipFile(buffer, 'w', compression=subject.zipfile.ZIP_DEFLATED) as zipped:
                    zipped.writestr('checkpoint-seal.json', subject.canonical(seal))
                zip_raw = buffer.getvalue()
                artifact.update(size_in_bytes=len(zip_raw), digest='sha256:' + subject.sha(zip_raw))
                downloads.clear()
                with self.subTest(label=label), self.assertRaisesRegex(ValueError, expected):
                    subject.transport_download(Client(), '1234', '1', self.source['image'])
                self.assertTrue(all('/actions/artifacts/' in route for route in downloads))
                self.assertFalse((temp / ('sorng-windows-arm-checkpoint-' + str(current['id']) + '-1/ready.json')).exists())
            release.clear()
            release.update(original_release)
            buffer = io.BytesIO()
            with subject.zipfile.ZipFile(buffer, 'w', compression=subject.zipfile.ZIP_DEFLATED) as zipped:
                zipped.writestr('checkpoint-seal.json', subject.canonical(original_seal))
            zip_raw = buffer.getvalue()
            artifact.update(size_in_bytes=len(zip_raw), digest='sha256:' + subject.sha(zip_raw))
            # Same authenticated record, one actual body byte changed. The next
            # exclusive handoff directory may contain partial files, never ready.
            current['id'] = 5679
            bodies[2] = bodies[2][:-1] + bytes([bodies[2][-1] ^ 1])
            with self.assertRaisesRegex(ValueError, 'ASSET_HASH'):
                subject.transport_download(Client(), '1234', '1', self.source['image'])
            self.assertFalse((temp / 'sorng-windows-arm-checkpoint-5679-1/ready.json').exists())

    def test_actual_seal_cli_and_fixed_upload_verify_all_asset_responses_without_codec_token(self):
        with patch.dict(os.environ, GH_TOKEN='fixture-secret'):
            sealed = subject.main(['--seal', str(self.root), self.source_pin['sha256']])
            self.assertEqual(os.environ['GH_TOKEN'], 'fixture-secret')
        self.assertTrue(sealed['sealed'])
        self.assertEqual(sealed['kind'], 'windows-arm-full-sdk-checkpoint-seal-result')
        self.assertEqual(sealed['sourceContextSha256'], self.source_pin['sha256'])
        self.assertEqual(self.measure('full-sdk-checkpoint-seal-result.json'), sealed['result'])
        current = dict(id=1234, run_attempt=1, head_sha=self.source['head'])
        assets, posts = [], []
        class Client:
            clock = self.clock
            def post(self, route, body):
                posts.append(body)
                return dict(id=42, **body)
            def response(self, method, route, data=None, **kwargs):
                name = subject.urllib.parse.parse_qs(subject.urllib.parse.urlsplit(route).query)['name'][0]
                row = dict(id=len(assets) + 1, name=name, size=len(data), state='uploaded', digest='sha256:' + subject.sha(data))
                assets.append(row)
                raw = subject.canonical(row)
                return io.BytesIO(raw), len(raw)
            def get(self, route):
                metadata = carrier_metadata(route)
                if metadata is not None: return metadata
                return assets if '/assets?' in route else dict(id=42, **posts[-1])
        with patch.object(subject, '_transport_scope', return_value=(current, dict(producerInputs=self.rows))):
            result = subject.transport_upload(Client(), self.source['image'], self.clock, self.fence)
            self.assertTrue(result['usableOnlyAfterWorkflowSuccess'])
            self.assertTrue(posts[0]['draft'])
            self.assertEqual(posts[0]['target_commitish'], CARRIER_HEAD)
            raw_seal = json.loads((self.root / result['sealFile']).read_bytes())
            self.assertEqual(raw_seal['workflow']['head'], self.source['head'])
            self.assertEqual(raw_seal['release']['head'], self.source['head'])
            self.assertEqual(raw_seal['release']['carrierHead'], CARRIER_HEAD)
            self.assertEqual(len(assets), 7)
            self.put('full-sdk-engine-closed-cef-engine.json', dict(self.closed, ownHandleClosed=False))
            posts.clear()
            with self.assertRaises(ValueError):
                subject.transport_upload(Client(), self.source['image'], self.clock, self.fence)
            self.assertFalse(posts)

    @unittest.skipUnless(os.name == 'nt', 'Actual Windows GetTickCount64 carrier interface')
    def test_actual_windows_first_carrier_tick_clock_never_renews_and_preserves_rollback_failure(self):
        import ctypes as c
        tick = c.WinDLL('kernel32').GetTickCount64
        tick.restype = c.c_ulonglong
        wall_start, tick_start = int(subject.time.time() * 1000) - 1000, tick() - 1000
        value = dict(schemaVersion=1, kind='windows-arm-first-workflow-clock', clock='windows-gettickcount64', dotnetMajor=9,
                     wallStartMs=wall_start, tickStartMs=tick_start, wallEndMs=wall_start + 21600000, tickEndMs=tick_start + 21600000,
                     repository=subject.REPOSITORY, repositoryId=str(subject.REPOSITORY_ID), ref='refs/heads/main', event='workflow_dispatch',
                     runId='1234', attempt='1', head='a' * 40, workflowSha='a' * 40,
                     workflowRef=subject.REPOSITORY + '/' + subject.WORKFLOW + '@refs/heads/main', job='sdk', image=self.source['image'])
        keys = dict(repository='GITHUB_REPOSITORY', repositoryId='GITHUB_REPOSITORY_ID', ref='GITHUB_REF', event='GITHUB_EVENT_NAME',
                    runId='GITHUB_RUN_ID', attempt='GITHUB_RUN_ATTEMPT', head='GITHUB_SHA', workflowSha='GITHUB_WORKFLOW_SHA',
                    workflowRef='GITHUB_WORKFLOW_REF', job='GITHUB_JOB', image='ImageVersion')
        env = {name: value[key] for key, name in keys.items()}
        env.update(SORNG_FULLSDK_FIRST_CLOCK=json.dumps(value), GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                   GITHUB_REPOSITORY_VISIBILITY='public', CEF_DEFAULT_BRANCH='main')
        with patch.dict(os.environ, env):
            clock = subject._TransportClock()
            self.assertLess(clock.remaining(), 21450)
            with patch.object(subject.time, 'time', return_value=wall_start / 1000 - 1):
                with self.assertRaisesRegex(ValueError, 'CLOCK_ROLLBACK') as first: clock.remaining()
            with self.assertRaises(ValueError) as again: clock.remaining()
            self.assertIs(again.exception, first.exception)

    def test_immutable_seal_zip_exact_member_and_forged_digest_are_denied(self):
        for name, duplicate in (('../checkpoint-seal.json', False), ('checkpoint-seal.json', True)):
            buffer = io.BytesIO()
            with subject.zipfile.ZipFile(buffer, 'w') as archive:
                archive.writestr(name, b'{}')
                if duplicate: archive.writestr('extra.json', b'{}')
            with self.subTest(name=name, duplicate=duplicate), self.assertRaises(ValueError):
                subject.unpack_raw_seal(buffer.getvalue(), 'checkpoint-seal.json')
        raw = io.BytesIO()
        with subject.zipfile.ZipFile(raw, 'w') as archive: archive.writestr('checkpoint-seal.json', b'{"data":true}')
        self.assertEqual(subject.unpack_raw_seal(raw.getvalue(), 'checkpoint-seal.json'), dict(data=True))
        # Actions API supplies the immutable ZIP digest. A matching mutable
        # release draft can never substitute for this missing artifact.
        class Client:
            def get(self, route): return dict(total_count=0, artifacts=[])
        with self.assertRaises(ValueError):
            subject.authenticated_seal(Client(), dict(head_sha='a' * 40), '1234', '1', self.root)

    def test_sdk_quarantine_is_distinct_five_assets_all_four_modeled_native_chains_no_old_origin(self):
        archive_name = 'sorng-cef-custom-' + self.source['sourceId'] + '-' + subject.SDK_TARGET + '.tar.bz2'
        archive_pin = self.put(subject.SDK_BUNDLE + '/' + archive_name, b'fixture archive DATA, not an actual native SDK')
        lock = (self.original_repo / 'native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/source-lock.json').read_bytes()
        lock_pin = self.put(subject.SDK_BUNDLE + '/source-lock.json', lock)
        receipt_pin = self.put(subject.SDK_BUNDLE + '/receipt.json', dict(kind='sorng-cef-custom-build-receipt', target=subject.SDK_TARGET,
                               sourceLockSha256=self.source['sourceId'], archiveSha256=archive_pin['sha256']))
        manifest_pin = self.put(subject.SDK_BUNDLE + '/manifest.json', dict(kind='sorng-cef-custom-runtime', sourceLockSha256=self.source['sourceId'],
                                artifacts=[dict(target=subject.SDK_TARGET, archive=dict(sha256=archive_pin['sha256']))]))
        descriptor = dict(kind='sorng-cef-runtime-release', target=subject.SDK_TARGET)
        for field, name, seal in (('sourceLock', 'source-lock.json', lock_pin), ('manifest', 'manifest.json', manifest_pin),
                                  ('receipt', 'receipt.json', receipt_pin), ('archive', archive_name, archive_pin)):
            descriptor[field] = dict(path=name, size=seal['bytes'], sha256=seal['sha256'])
        runtime_pin = self.put(subject.SDK_BUNDLE + '/runtime.json', descriptor)
        assets = [dict(name=name, size=seal['bytes'], sha256=seal['sha256']) for name, seal in
                  (('runtime.json', runtime_pin), ('source-lock.json', lock_pin), ('manifest.json', manifest_pin), ('receipt.json', receipt_pin), (archive_name, archive_pin))]
        previous = None
        for index, role in enumerate(('probe-clang', 'probe-link', 'cef-engine', 'package')):
            packet = dict(self.packet, role=role, prior=None if previous is None else dict(result=previous['result'], receipt=previous['job']))
            pp = self.put(f'full-sdk-engine-{role}-context.json', packet)
            launch = dict(self.launch, role=role, contextSha256=pp['sha256'], ownPid=110 + index, ownCreationFiletime=str(1100 + index))
            self.put(f'full-sdk-engine-{role}-launch.json', launch)
            native = dict(job(), rootPid=210 + index, rootCreationFiletime=str(2100 + index))
            jp = self.put(f'jobs/{role}/receipt.json', native)
            closed = dict(self.closed, role=role, ownPid=launch['ownPid'], ownCreationFiletime=launch['ownCreationFiletime'], completion='success', receiptPin=jp)
            self.put(f'full-sdk-engine-closed-{role}.json', closed)
            output = None
            if role in ('probe-clang', 'probe-link'):
                output = self.put('full-sdk-engine-probe/probe.' + ('obj' if role == 'probe-clang' else 'exe'), b'modeled compiler output DATA')
            elif role == 'package': output = dict(bundle=subject.SDK_BUNDLE, assets=assets)
            result = dict(kind='windows-arm-full-sdk-engine-worker-result', role=role, sourceContextSha256=self.source_pin['sha256'],
                          image=self.source['image'], sourceId=self.source['sourceId'], success=True, output=output,
                          engineComplete=role == 'cef-engine', sdkBuilt=role == 'package', nativeAcceptance=False, runtimeReady=False)
            rp = self.put(f'full-sdk-engine-{role}-result.json', result)
            previous = dict(result=rp, job=jp)
        report = dict(kind='windows-arm-full-sdk-produced', sourceId=self.source['sourceId'], image=self.source['image'], target=subject.SDK_TARGET,
                      sdkBuilt=True, nativeAcceptance=False, runtimeReady=False, publicationAllowed=False, bundle=subject.SDK_BUNDLE,
                      assets=[dict(row, identity='held-fixture-physical-id') for row in assets])
        self.put('full-sdk-controller-result.json', report)
        uploaded, posts = [], []
        class Client:
            clock = self.clock
            def post(self, route, value):
                posts.append(value)
                return dict(id=42, **value)
            def response(self, method, route, data=None):
                name = subject.urllib.parse.parse_qs(subject.urllib.parse.urlsplit(route).query)['name'][0]
                row = dict(id=len(uploaded) + 1, name=name, size=len(data), digest='sha256:' + subject.sha(data), state='uploaded')
                uploaded.append(row)
                raw = subject.canonical(row)
                return io.BytesIO(raw), len(raw)
            def get(self, route):
                metadata = carrier_metadata(route)
                if metadata is not None: return metadata
                return uploaded if '/assets?' in route else dict(id=42, **posts[-1])
        current = dict(id=1234, run_attempt=1, head_sha=self.source['head'])
        with patch.object(subject, '_transport_scope', return_value=(current, dict(producerInputs=self.rows))):
            result = subject.transport_upload(Client(), self.source['image'], self.clock, self.fence)
        self.assertEqual(result['kind'], 'sdk')
        self.assertEqual(len(uploaded), 5)
        self.assertFalse(result['nativeAcceptance'])
        self.assertFalse(result['publicationAllowed'])
        raw_seal = json.loads((self.root / result['sealFile']).read_bytes())
        self.assertEqual(raw_seal['origin'], 'owned-windows-arm64-full-sdk')
        self.assertEqual(posts[0]['target_commitish'], CARRIER_HEAD)
        self.assertEqual(raw_seal['release']['head'], self.source['head'])
        self.assertEqual(raw_seal['release']['carrierHead'], CARRIER_HEAD)
        self.assertEqual(raw_seal['workflow']['head'], self.source['head'])
        self.assertNotIn('checkpoint', raw_seal['kind'])
        self.assertEqual(len(raw_seal['nativePhases']), 20)
        self.put('jobs/probe-link/receipt.json', dict(job(), rootReaped=False))
        with self.assertRaises(ValueError):
            subject.sdk_quarantine(Client(), self.root, report, self.clock, self.fence, current, dict(producerInputs=self.rows))


if __name__ == '__main__':
    unittest.main()
