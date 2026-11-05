"""Pure routing/identity regressions; native Darwin acceptance is a separate proof."""
import copy
import importlib.util
import json
from contextlib import ExitStack
from pathlib import Path
import os
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('codec_under_test', ROOT / 'scripts/lib/cef-checkpoint-archive.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
proof_spec = importlib.util.spec_from_file_location('proof_under_test', ROOT / 'tests/fixtures/cef/mac_owned_source_proof.py')
proof = importlib.util.module_from_spec(proof_spec)
proof_spec.loader.exec_module(proof)


def info(**changed):
    fields = dict(st_dev=1, st_ino=2, st_mode=0o100600, st_size=10, st_nlink=1,
                  st_uid=12, st_gid=34, st_mtime_ns=100, st_ctime_ns=200,
                  st_birthtime=1790000000.123456)
    fields.update(changed)
    return SimpleNamespace(**fields)


class BirthIdentity(unittest.TestCase):
    def test_float_is_opaque_hex_and_never_invented_nanoseconds(self):
        value = info()
        self.assertEqual(m.source_birth_identity(value), ('darwin-birthtime-float-hex', value.st_birthtime.hex()))
        self.assertEqual(m.source_birth_identity(info(st_birthtime_ns=123)), ('birthtime-ns', '123'))
        self.assertNotEqual(m.source_birth_identity(value)[0], 'birthtime-ns')

    def test_missing_nonfinite_negative_or_malformed_birth_denied(self):
        for value in [None, 1, float('nan'), float('inf'), -1.0]:
            with self.subTest(value=value), self.assertRaisesRegex(m.CheckpointError, 'source-mac-birth-unavailable'):
                m.source_birth_identity(info(st_birthtime=value))
        for value in [True, -1, 2**63, 1.5]:
            with self.subTest(value=value), self.assertRaises(m.CheckpointError):
                m.source_birth_identity(info(st_birthtime_ns=value))

    def test_darwin_fallback_is_owned_scope_only_and_external_projection_unchanged(self):
        row = {}
        m.source_mac_row(row, info(), {'mac':True, 'ownedMacArm':True})
        self.assertIn('birthIdentity', row)
        self.assertNotIn('birthNs', row)
        external = {}
        m.source_mac_row(external, info(), {'mac':True, 'external':True})
        self.assertIsNone(external['birthNs'])
        self.assertNotIn('birthIdentity', external)
        with self.assertRaises(m.CheckpointError):
            m.source_mac_row({}, info(), {'mac':True})

    def test_own_timestamp_transition_reports_changed_birth_without_cross_job_claim(self):
        before, after = info(), info(st_birthtime=1700000000.0, st_mtime_ns=50, st_ctime_ns=300)
        value = m.source_owned_mac_transition(before, after, copy.copy(after))
        self.assertEqual(value['kind'], 'owned-utime-birth-observation')
        self.assertTrue(value['changed'])
        self.assertEqual(value['before'][1], before.st_birthtime.hex())
        self.assertEqual(value['after'][1], after.st_birthtime.hex())

    def test_owned_mutation_cannot_replace_file_or_change_owner_mode_size_or_links(self):
        for field in ['st_dev','st_ino','st_mode','st_size','st_nlink','st_uid','st_gid']:
            with self.subTest(field=field), self.assertRaisesRegex(m.CheckpointError, 'source-mac-write-identity'):
                changed = info(**{field:getattr(info(),field)+1})
                m.source_owned_mac_transition(info(), changed)
        with self.assertRaisesRegex(m.CheckpointError, 'source-mac-write-identity'):
            m.source_owned_mac_transition(info(), info(), info(st_birthtime=1700000000.0))

    def test_same_path_birth_or_ctime_change_invalidates_inventory_identity(self):
        policy = {'mac':True,'ownedMacArm':True}
        baseline = m.source_local(info(), policy)
        for change in [dict(st_birthtime=1700000000.0), dict(st_ctime_ns=201), dict(st_uid=13), dict(st_gid=35)]:
            self.assertNotEqual(m.source_local(info(**change), policy), baseline)


class OwnedCodecRouting(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='owned-codec-routing-')
        self.work = Path(self.temp.name).resolve()
        self.root = self.work / 'source'
        self.out = self.root / 'src/out/Release_GN_arm64'
        self.out.mkdir(parents=True)
        self.sidecar = self.out / m.SOURCE_METADATA_NAME
        self.identity = {key:'a'*64 for key in ('source','producer','tools','graph','siso')}
        self.identity.update(target='aarch64-apple-darwin', canonicalRoot=str(self.work), image='20260824.0482.1')
        self.snapshot = {'entries':[], 'rootMtimeNs':'1', 'gitHeads':{}, 'bytes':0}
        self.stored = {'schemaVersion':1, 'kind':'sorng-macarm-source-metadata',
                       'policy':m.MAC_SOURCE_METADATA_POLICY, 'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,
                       'identity':self.identity, 'snapshot':self.snapshot}

    def tearDown(self):
        self.temp.cleanup()

    def core(self, mode, budget=None):
        with m.source_io_scope(mode):
            return m._source_metadata_owned_codec(mode, self.root, self.sidecar, self.identity,
                                                  self.work, budget or m.Budget(5), 'mac-arm')

    def test_out_of_scope_arm_and_intel_deny_before_any_path_read(self):
        self.assertTrue(m.MAC_SOURCE_WRITE_ADMITTED)
        self.assertTrue(m.MAC_INTEL_SOURCE_WRITE_ADMITTED)
        for policy in ['mac-arm','mac-intel']:
            for mode in m.SOURCE_IO_MODES:
                with patch.object(sys,'platform','darwin'), patch.object(m,'safe',side_effect=AssertionError('no path access')):
                    reason = 'source-mac-(host|identity)-scope'
                    with self.assertRaisesRegex(m.CheckpointError, reason):
                        m.source_metadata_owned(mode,self.root,self.sidecar,{},platform_policy=policy)

    def test_arm_records_distinct_mac_schema_with_raw_namespace_and_no_linux_cache(self):
        captured = {}
        def metadata(root,name,value,**kwargs):
            captured.update(value)
            return {'name':name,'bytes':100,'sha256':'b'*64}
        with patch.object(sys,'platform','darwin'), patch.object(m,'source_repositories',return_value={'repositories':{m.NEARBY_ROOT}}), \
             patch.object(m,'source_snapshot',return_value=self.snapshot) as snapshot, \
             patch.object(m,'metadata',side_effect=metadata), patch.object(m,'source_read_sidecar',side_effect=lambda *a,**k:captured), \
             patch.object(m,'source_stat_cache_write',side_effect=AssertionError('no Linux cache')):
            self.assertTrue(self.core('source-record')['complete'])
        self.assertEqual(captured['kind'],'sorng-macarm-source-metadata')
        self.assertEqual(captured['policy'],m.MAC_SOURCE_METADATA_POLICY)
        self.assertEqual(snapshot.call_args.kwargs, {'context':{'mac':True,'ownedMacArm':True}, 'layout':{}})
        self.assertNotIn('literalLinks',captured['snapshot'])

    def test_arm_verify_takes_one_mac_snapshot_when_nothing_is_written(self):
        with patch.object(sys,'platform','darwin'), patch.object(m,'source_read_sidecar',return_value=self.stored), \
             patch.object(m,'source_snapshot',return_value=self.snapshot) as snapshot, \
             patch.object(m,'source_stat_cache_reuse',side_effect=AssertionError('no Linux reuse')), \
             patch.object(m.os,'utime',side_effect=AssertionError('verify writes nothing')):
            self.assertTrue(self.core('source-verify')['complete'])
        self.assertEqual(snapshot.call_count,1)
        # No cache and no digests: nothing may be reused, so every file is read.
        self.assertTrue(all(call.kwargs == {'context':{'mac':True,'ownedMacArm':True}, 'layout':{}, 'reuse':None} for call in snapshot.call_args_list))

    def apply_snapshots(self, root_mtime_matches):
        policy = {'mac':True,'ownedMacArm':True}
        info = self.root.stat()
        self.snapshot['rootMtimeNs'] = str(info.st_mtime_ns if root_mtime_matches else info.st_mtime_ns + 1000)
        def take(root, budget, guards=None, **kwargs):
            if guards is not None:guards[''] = m.source_local(root.stat(), policy)
            return self.snapshot
        with patch.object(sys,'platform','darwin'), patch.object(m,'source_repositories',return_value={}), \
             patch.object(m,'source_read_sidecar',return_value=self.stored), \
             patch.object(m,'source_snapshot',side_effect=take) as snapshot, \
             patch.object(m,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')), \
             patch.object(m.os,'utime',wraps=m.os.utime) as write, \
             patch.object(m,'source_owned_mac_transition'):
            self.assertTrue(self.core('source-apply')['complete'])
        return snapshot.call_count, write.call_count

    def test_arm_apply_without_any_timestamp_write_takes_one_snapshot(self):
        self.assertEqual(self.apply_snapshots(True), (1, 0))

    @unittest.skipUnless(os.name == 'posix', 'real directory descriptors')
    def test_arm_apply_with_a_timestamp_write_keeps_its_postcheck(self):
        calls, writes = self.apply_snapshots(False)
        self.assertEqual((calls, writes), (2, 1))

    def test_wrong_sidecar_kind_or_cross_platform_schema_denied_before_mutation(self):
        for kind in ['sorng-linuxarm-source-metadata','sorng-macintel-source-metadata']:
            with patch.object(sys,'platform','darwin'), patch.object(m,'source_read_sidecar',return_value={**self.stored,'kind':kind}), \
                 patch.object(m.os,'utime',side_effect=AssertionError('no mutation')):
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-binding'):
                    self.core('source-apply')

    def test_actual_arm_sidecar_writer_binds_metadata_target_and_output_path(self):
        with m.source_io_scope('source-record'):
            written = m.metadata(self.out, m.SOURCE_METADATA_NAME, self.stored, source=True, owned_sidecar=True)
        self.assertEqual(written['bytes'],self.sidecar.stat().st_size)
        self.assertEqual(json.loads(self.sidecar.read_bytes()),self.stored)
        for changed in [{'kind':'sorng-macintel-source-metadata'}, {'identity':{**self.identity,'target':'aarch64-unknown-linux-gnu'}}]:
            with self.subTest(changed=changed), m.source_io_scope('source-record'):
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):
                    m.metadata(self.out,m.SOURCE_METADATA_NAME,{**self.stored,**changed},source=True,owned_sidecar=True)
        self.assertEqual(json.loads(self.sidecar.read_bytes()),self.stored)

    def test_changed_content_or_oversized_inventory_denied_before_any_utime(self):
        row = {'path':'src/file','kind':'file','mode':0o100600,'size':1,'sha256':'a'*64,'mtimeNs':'1','nlink':1}
        expected = {**self.snapshot,'entries':[row]}
        changed = {**self.snapshot,'entries':[{**row,'sha256':'b'*64}]}
        with patch.object(sys,'platform','darwin'), patch.object(m,'source_read_sidecar',return_value={**self.stored,'snapshot':expected}), \
             patch.object(m,'source_snapshot',return_value=changed), patch.object(m.os,'utime',side_effect=AssertionError('no mutation')):
            with self.assertRaisesRegex(m.CheckpointError,'source-content-changed'):
                self.core('source-apply')
        with patch.object(sys,'platform','darwin'), patch.object(m,'source_read_sidecar',return_value={**self.stored,'snapshot':expected}), \
             patch.object(m,'SOURCE_MAX_ENTRIES',0), patch.object(m.os,'utime',side_effect=AssertionError('no mutation')):
            with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-shape'):
                self.core('source-apply')

    def test_expired_budget_denies_before_namespace_or_metadata_writes(self):
        class Cancelled:
            def check(self):
                raise m.CheckpointError('controlled-cancellation')
        with patch.object(sys,'platform','darwin'), patch.object(m,'source_snapshot',side_effect=AssertionError('no namespace access')), \
             patch.object(m.os,'utime',side_effect=AssertionError('no timestamp writes')):
            with self.assertRaisesRegex(m.CheckpointError,'controlled-cancellation'):
                self.core('source-record',Cancelled())


class SourceWriteScope(unittest.TestCase):
    def identity(self):
        return {'target':'aarch64-apple-darwin','source':m.MAC_SOURCE,
                'canonicalRoot':'/Users/runner/work/_temp/sorng-cef-engineering/aarch64-apple-darwin/'+m.MAC_SOURCE,
                'image':m.MAC_SOURCE_IMAGE,**{key:'a'*64 for key in ('producer','tools','graph','siso')}}

    def host(self, **environment):
        stack=ExitStack()
        stack.enter_context(patch.object(sys,'platform','darwin'))
        stack.enter_context(patch.object(m.platform,'machine',return_value='x86_64'))
        stack.enter_context(patch.dict(m.os.environ,{'ImageOS':'macos15','ImageVersion':m.MAC_SOURCE_IMAGE,
                                                   'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public',
                                                   **environment},clear=True))
        return stack

    def test_exact_reviewed_scope_reaches_public_codec_with_validated_identity(self):
        identity=self.identity();work=Path(identity['canonicalRoot'])
        with self.host(),patch.object(m,'safe',side_effect=lambda p:p), \
             patch.object(m,'_source_metadata_owned_codec',return_value={'complete':True})as core:
            for mode in m.SOURCE_IO_MODES:
                self.assertEqual(m.source_metadata_owned(mode,work/'source',work/'source/src/out/Release_GN_arm64'/m.SOURCE_METADATA_NAME,identity,
                    platform_policy='mac-arm'),{'complete':True})
                self.assertEqual(core.call_args.args[0],mode)
                self.assertEqual(core.call_args.args[4],work)
        self.assertEqual(m.MAC_SOURCE_PROOF,(41328841230,13092905128,
            'fa52dc3d113fa10929f391c196286ffb3cda52ea045b73ceb4df01649a725e90'))

    def test_unreviewed_host_image_source_target_and_root_deny_before_root_io(self):
        cases=[('host',{}, {},'linux','x86_64'),('native-arm',{}, {},'darwin','arm64'),
               ('image',{'ImageVersion':'20261030.294.1'},{},'darwin','x86_64'),
               ('image-os',{'ImageOS':'macos14'},{},'darwin','x86_64'),
               ('source',{}, {'source':'b'*64},'darwin','x86_64'),
               ('target',{}, {'target':'x86_64-apple-darwin'},'darwin','x86_64'),
               ('root',{}, {'canonicalRoot':'/arbitrary'},'darwin','x86_64'),
               ('identity-image',{}, {'image':'20261030.294.1'},'darwin','x86_64')]
        for name,env,changed,host,arch in cases:
            with self.subTest(case=name),self.host(**env),patch.object(sys,'platform',host), \
                 patch.object(m.platform,'machine',return_value=arch), \
                 patch.object(m,'safe',side_effect=AssertionError('no root access')), \
                 patch.object(m,'_source_metadata_owned_codec',side_effect=AssertionError('no codec')), \
                 patch.object(m.os,'utime',side_effect=AssertionError('no writes')):
                for mode in m.SOURCE_IO_MODES:
                    with self.assertRaisesRegex(m.CheckpointError,'source-mac-(host|identity)-scope'):
                        m.source_metadata_owned(mode,Path('/not-read'),Path('/not-written'),
                            {**self.identity(),**changed},platform_policy='mac-arm')

    def test_public_identity_validator_rejects_other_arm_source_or_image_before_safe(self):
        with patch.object(m,'safe',side_effect=lambda p:p)as safe:
            self.assertEqual(m.source_metadata_identity(self.identity(),'mac-arm'),Path(self.identity()['canonicalRoot']))
        safe.assert_called_once()
        for changed in [{'source':'b'*64},{'image':'20261030.294.1'}]:
            with self.subTest(changed=changed),patch.object(m,'safe',side_effect=AssertionError('no root IO')):
                with self.assertRaisesRegex(m.CheckpointError,'source-root'):
                    m.source_metadata_identity({**self.identity(),**changed},'mac-arm')


class PreflightStages(unittest.TestCase):
    def prefix(self, **environment):
        stack = ExitStack()
        stack.enter_context(patch.object(sys,'platform','darwin'))
        stack.enter_context(patch.object(proof.platform,'machine',return_value='x86_64'))
        stack.enter_context(patch.object(sys,'executable',proof.PYTHON))
        stack.enter_context(patch.dict(proof.os.environ, {
            'ImageOS':'macos15','ImageVersion':proof.IMAGE,'GITHUB_ACTIONS':'true',
            'RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public',**environment},clear=True))
        return stack

    def test_unknown_arguments_emit_only_closed_stage_facts(self):
        with self.assertRaises(RuntimeError):
            proof.preflight(['--PRIVATE_ARGUMENT'])
        value = proof.preflight_failure()
        self.assertEqual(value['stage'],'arguments')
        self.assertNotIn('interpreter',value)
        self.assertNotIn('PRIVATE',json.dumps(value))
        self.assertFalse(value['sourceWriteAdmitted'])
        self.assertLess(len(json.dumps(value)),2048)

    def test_host_image_and_runner_fail_before_interpreter_execution_or_output_creation(self):
        cases = [('host',{},'linux'),('image',{'ImageVersion':'wrong'},'darwin'),('runner',{'GITHUB_ACTIONS':'false'},'darwin')]
        for stage,environment,host in cases:
            with self.subTest(stage=stage),self.prefix(**environment),patch.object(sys,'platform',host), \
                 patch.object(proof,'verify_python')as verify,patch.object(proof,'OwnedTree')as output:
                with self.assertRaises(RuntimeError):
                    proof.main(['--output','/not-created'])
                self.assertEqual(proof.preflight_failure()['stage'],stage)
                verify.assert_not_called();output.assert_not_called()

    def test_wrong_basename_is_denied_even_with_the_pinned_canonical_target(self):
        framework = str(Path(proof.PYTHON).parents[1] / 'Resources/Python.app/Contents/MacOS/Python')
        with self.prefix(),patch.object(sys,'executable',framework),patch.object(Path,'resolve',return_value=Path(proof.PYTHON)), \
             patch.object(proof,'verify_python')as verify,patch.object(proof,'OwnedTree')as output:
            with self.assertRaises(RuntimeError):
                proof.main(['--output','/not-created'])
            value = proof.preflight_failure()
            self.assertEqual(value['stage'],'python-executable')
            self.assertEqual(value['interpreter'],{'role':'framework-app','basename':'Python','lexicalMatch':False,'canonicalMatch':True})
            self.assertNotIn('/usr/',json.dumps(value))
            verify.assert_not_called();output.assert_not_called()

    def test_absolute_same_basename_alias_reaches_held_pin_before_any_output(self):
        alias = '/usr/local/opt/python@3.14/bin/python3.14'
        marker = OSError('PRIVATE_PIN_PATH_AND_ERROR')
        with self.prefix(),patch.object(sys,'executable',alias), \
             patch.object(Path,'resolve',return_value=Path(proof.PYTHON)), \
             patch.object(proof,'verify_python',side_effect=marker)as verify, \
             patch.object(proof,'OwnedTree')as output:
            with self.assertRaises(OSError)as raised:
                proof.main(['--output','/not-created'])
            self.assertIs(raised.exception,marker)
            value = proof.preflight_failure()
            self.assertEqual(value['stage'],'python-pin')
            self.assertEqual(value['interpreter'],{'role':'other','basename':'python3.14',
                'lexicalMatch':False,'canonicalMatch':True})
            verify.assert_called_once_with();output.assert_not_called()

    def test_foreign_target_relative_and_malformed_aliases_cannot_reach_pin_or_output(self):
        cases = [('/foreign/python3.14',False),('python3.14',True),
                 ('relative/python3.14',True),('/usr/../bin/python3.14',True),
                 ('/usr//bin/python3.14',True),('/usr/./bin/python3.14',True),
                 ('//usr/bin/python3.14',True),('/usr/\\bin/python3.14',True),
                 ('/usr/bin/python3.14\x00',True),('/usr/bin/python3',True)]
        for executable,matching in cases:
            def resolved(path, **kwargs):
                return Path(proof.PYTHON) if matching or path==Path(proof.PYTHON) else Path('/private/foreign/python3.14')
            with self.subTest(executable=executable),self.prefix(), \
                 patch.object(sys,'executable',executable),patch.object(Path,'resolve',autospec=True,side_effect=resolved), \
                 patch.object(proof,'verify_python')as verify,patch.object(proof,'OwnedTree')as output:
                with self.assertRaises(RuntimeError):
                    proof.main(['--output','/not-created'])
                self.assertEqual(proof.preflight_failure()['stage'],'python-executable')
                verify.assert_not_called();output.assert_not_called()

    def test_pin_failure_retains_fixed_stage_without_raw_exception_or_path(self):
        marker = OSError('PRIVATE_PIN_PATH_AND_ERROR')
        with self.prefix(),patch.object(Path,'resolve',return_value=Path(proof.PYTHON)), \
             patch.object(proof,'verify_python',side_effect=marker),patch.object(proof,'OwnedTree')as output:
            with self.assertRaises(OSError)as raised:
                proof.main(['--output','/not-created'])
            self.assertIs(raised.exception,marker)
            value = proof.preflight_failure()
            self.assertEqual(value['stage'],'python-pin')
            self.assertEqual(value['interpreter']['role'],'reviewed-launcher')
            self.assertTrue(value['interpreter']['lexicalMatch'])
            self.assertNotIn('PRIVATE',json.dumps(value));output.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
