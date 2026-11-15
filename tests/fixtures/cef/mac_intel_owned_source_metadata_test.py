"""Portable Intel codec checks. Native Darwin qualification is separate."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from contextlib import contextmanager, ExitStack

ROOT=Path(__file__).resolve().parents[3]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
m=load('intel_codec','scripts/lib/cef-checkpoint-archive.py')
# Retain historical proof/codec cases against their exact complete source body.
# Current public admission tests below keep the unmodified production module m.
_history=load('intel_history_inverse','tests/fixtures/cef/mac_source_reuse_inverse.py')
_historical_spec=importlib.util.spec_from_file_location('intel_historical_codec',ROOT/'scripts/lib/cef-checkpoint-archive.py')
historical=importlib.util.module_from_spec(_historical_spec)
exec(compile(_history.before_compiler_compatibility((ROOT/'scripts/lib/cef-checkpoint-archive.py').read_text(encoding='utf8').encode(),'scripts/lib/cef-checkpoint-archive.py'),str(_historical_spec.origin),'exec'),historical.__dict__)
proof=load('intel_proof','tests/fixtures/cef/mac_intel_owned_source_proof.py')


class IntelCodec(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.work=Path(self.temp.name);self.root=self.work/'source'
        self.out=self.root/'src/out/Release_GN_x64';self.out.mkdir(parents=True);self.sidecar=self.out/historical.SOURCE_METADATA_NAME
        self.identity={key:'a'*64 for key in ('source','producer','tools','graph','siso')}
        self.identity.update(target='x86_64-apple-darwin',canonicalRoot=str(self.work),image='20260824.0482.1')
        self.snapshot={'entries':[],'rootMtimeNs':str(self.root.stat().st_mtime_ns),'gitHeads':{},'bytes':0}
        self.stored={'schemaVersion':1,'kind':'sorng-macintel-source-metadata','policy':historical.MAC_INTEL_SOURCE_METADATA_POLICY,
                     'sourceDateEpoch':historical.SOURCE_METADATA_DATE_EPOCH,'identity':self.identity,'snapshot':self.snapshot}
    def tearDown(self):self.temp.cleanup()
    def core(self,mode,budget=None):
        with historical.source_io_scope(mode):return historical._source_metadata_owned_codec(mode,self.root,self.sidecar,self.identity,self.work,budget or historical.Budget(5),'mac-intel')
    def test_public_scope_denies_before_all_io_and_mutations(self):
        self.assertTrue(historical.MAC_INTEL_SOURCE_WRITE_ADMITTED)
        for mode in historical.SOURCE_IO_MODES:
            with patch.object(historical,'safe',side_effect=AssertionError('no path access')),patch.object(historical,'_source_metadata_owned_codec',side_effect=AssertionError('no private call')),patch.object(historical.os,'utime',side_effect=AssertionError('no mutation')):
                with self.assertRaisesRegex(historical.CheckpointError,'source-mac-(host|identity)-scope'):
                    historical.source_metadata(mode,None,None,None,platform_policy='mac-intel')
    def test_owned_intel_birth_is_opaque_and_nonowned_stays_strict(self):
        info=SimpleNamespace(st_size=1,st_mtime_ns=2,st_dev=3,st_ino=4,st_mode=0o100600,st_nlink=1,st_ctime_ns=5,st_uid=6,st_gid=7,st_birthtime=1790000000.125)
        for role in ('ownedMacArm','ownedMacIntel'):
            policy={'mac':True,role:True};row={};historical.source_mac_row(row,info,policy)
            self.assertEqual(row['birthIdentity'],('darwin-birthtime-float-hex',info.st_birthtime.hex()))
            self.assertEqual(historical.source_local(info,policy)[2],row['birthIdentity'])
            self.assertNotIn('birthNs',row)
        for policy in ({'mac':True},{'mac':True,'ownedMacIntel':1},{'ownedMacIntel':True},{'mac':True,'ownedUnknown':True}):
            self.assertFalse(historical.source_owned_mac(policy))
        with self.assertRaises(historical.CheckpointError):historical.source_mac_row({},info,{'mac':True})
    def test_intel_record_selects_full_mac_context_and_preserves_sidecar_kind(self):
        captured={}
        def write(root,name,value,**kwargs):captured.update(value);return {'name':name,'bytes':100,'sha256':'a'*64}
        with patch.object(sys,'platform','darwin'),patch.object(historical,'source_repositories',return_value={'repositories':{historical.NEARBY_ROOT}}),patch.object(historical,'source_snapshot',return_value=self.snapshot)as take,patch.object(historical,'metadata',side_effect=write),patch.object(historical,'source_read_sidecar',side_effect=lambda *a,**k:captured),patch.object(historical,'source_stat_cache_write',side_effect=AssertionError('no Linux cache')):
            self.assertTrue(self.core('source-record')['complete'])
        self.assertEqual(take.call_args.kwargs,{'context':{'mac':True,'ownedMacIntel':True},'layout':{}})
        self.assertEqual(captured['kind'],'sorng-macintel-source-metadata');self.assertEqual(captured['policy'],historical.MAC_INTEL_SOURCE_METADATA_POLICY)
        self.assertNotIn('literalLinks',captured['snapshot'])
    def test_intel_verify_takes_one_mac_snapshot_when_nothing_is_written(self):
        with patch.object(sys,'platform','darwin'),patch.object(historical,'source_read_sidecar',return_value=self.stored),patch.object(historical,'source_snapshot',return_value=self.snapshot)as take,patch.object(historical,'source_stat_cache_reuse',side_effect=AssertionError('no Linux cache')),patch.object(historical.os,'utime',side_effect=AssertionError('verify cannot write')):
            self.assertTrue(self.core('source-verify')['complete'])
        self.assertEqual(take.call_count,1);self.assertTrue(all(c.kwargs=={'context':{'mac':True,'ownedMacIntel':True},'layout':{},'reuse':None}for c in take.call_args_list))
    def test_same_length_hash_change_denies_before_utime(self):
        row={'path':'src/file','kind':'file','mode':0o100600,'size':1,'sha256':'a'*64,'mtimeNs':'1','nlink':1}
        expected={**self.snapshot,'entries':[row],'bytes':1};changed={**expected,'entries':[{**row,'sha256':'b'*64}]}
        with patch.object(sys,'platform','darwin'),patch.object(historical,'source_read_sidecar',return_value={**self.stored,'snapshot':expected}),patch.object(historical,'source_snapshot',return_value=changed),patch.object(historical.os,'utime',side_effect=AssertionError('no mutation')):
            with self.assertRaisesRegex(historical.CheckpointError,'source-content-changed'):self.core('source-apply')
    def test_apply_root_uses_full_local_guard_and_owned_transition(self):
        for drift in (0,1):
            policy={'mac':True,'ownedMacIntel':True};rootinfo=self.root.stat()
            # Exercise the write transition with real timestamp drift; equal times
            # intentionally take the existing owned-root no-op path.
            wanted=rootinfo.st_mtime_ns-drift;self.snapshot['rootMtimeNs']=str(wanted)
            self.assertEqual(wanted < rootinfo.st_mtime_ns,bool(drift))
            changed=SimpleNamespace(**{key:getattr(rootinfo,key) for key in dir(rootinfo) if key.startswith('st_')})
            changed.st_mtime_ns=wanted;written=False;real_stat=Path.stat
            def observed(path,*args,**kwargs):
                return changed if path==self.root and written else real_stat(path,*args,**kwargs)
            def write_timestamp(fd,*,ns):
                nonlocal written
                self.assertEqual(fd,123);self.assertEqual(ns,(rootinfo.st_atime_ns,wanted));written=True
            def take(root,budget,guards=None,**kwargs):
                self.assertEqual(kwargs['context'],policy)
                if guards is not None:guards['']=historical.source_local(root.stat(),policy)
                return self.snapshot
            with patch.object(sys,'platform','darwin'),patch.object(historical,'source_repositories',return_value={}),patch.object(historical,'source_read_sidecar',return_value=self.stored),patch.object(historical,'source_snapshot',side_effect=take),patch.object(historical,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')),patch.object(historical.os,'O_NOFOLLOW',0,create=True),patch.object(historical.os,'O_DIRECTORY',0,create=True),patch.object(historical.os,'open',return_value=123),patch.object(historical.os,'fstat',side_effect=lambda fd:changed if written else rootinfo),patch.object(Path,'stat',observed),patch.object(historical.os,'utime',side_effect=write_timestamp)as write,patch.object(historical.os,'close')as close,patch.object(historical,'source_owned_mac_transition',wraps=historical.source_owned_mac_transition)as transition:
                self.assertTrue(self.core('source-apply')['complete'])
            self.assertEqual(write.call_count,drift);self.assertEqual(close.call_count,drift);self.assertEqual(transition.call_count,drift)
    def test_cross_kind_and_expired_budget_deny_before_write(self):
        for kind in ('sorng-macarm-source-metadata','sorng-linuxarm-source-metadata'):
            with patch.object(sys,'platform','darwin'),patch.object(historical,'source_read_sidecar',return_value={**self.stored,'kind':kind}),patch.object(historical.os,'utime',side_effect=AssertionError('no mutation')):
                with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-binding'):self.core('source-apply')
        class Expired:
            def check(self):raise historical.CheckpointError('controlled-deadline')
        with patch.object(sys,'platform','darwin'),patch.object(historical,'source_snapshot',side_effect=AssertionError('no scan')):
            with self.assertRaisesRegex(historical.CheckpointError,'controlled-deadline'):self.core('source-record',Expired())
    def test_recreated_fixture_file_has_new_inode_and_cleans_only_its_own_tree(self):
        folder=Path(self.temp.name)/'owned'
        with patch.object(os,'geteuid',return_value=self.work.stat().st_uid,create=True),patch.object(os,'O_NOFOLLOW',getattr(os,'O_NOFOLLOW',0),create=True):
            tree=proof.base.OwnedTree(folder);file=tree.file('src/input.cc',b'owned bytes')
            before=file.stat();proof.replace_input(tree,file,b'owned bytes')
            self.assertNotEqual((file.stat().st_dev,file.stat().st_ino),(before.st_dev,before.st_ino))
            self.assertTrue(tree.cleanup());folder.rmdir()
    def test_failure_code_projection_is_closed_and_never_raw_exception(self):
        with patch.object(historical,'SOURCE_CLOSE_FAILURE',False):
            self.assertEqual(proof.failure_code(historical.CheckpointError('source-sidecar-role'),historical),'source-sidecar-role')
            for error in (historical.CheckpointError('PRIVATE_PATH'),OSError('PRIVATE_PATH')):
                self.assertEqual(proof.failure_code(error,historical),'OWNED_INTEL_SOURCE_PROOF_FAILED')


class ActualProofWriter(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.temp_path=Path(self.temp.name).resolve()
        self.output=self.temp_path/'cef-mac-intel-owned-proof-12345678-1234-4123-8123-123456789abc'
        self.work=self.output/'work';self.out=self.work/'source/src/out/Release_GN_x64'
        self.identity={'target':'x86_64-apple-darwin','source':historical.MAC_INTEL_SOURCE,'canonicalRoot':str(self.work),'image':'20260824.0482.1',**{key:'a'*64 for key in ('producer','tools','graph','siso')}}
        self.value={'schemaVersion':1,'kind':'sorng-macintel-source-metadata','policy':historical.MAC_INTEL_SOURCE_METADATA_POLICY,'sourceDateEpoch':historical.SOURCE_METADATA_DATE_EPOCH,'identity':self.identity,'snapshot':{'entries':[],'rootMtimeNs':'1','gitHeads':{},'bytes':0}}
        historical.SOURCE_CLOSE_FAILURE=False
    def tearDown(self):self.temp.cleanup()
    @contextmanager
    def host(self):
        # Writer IO is never mocked. Windows lacks directory FDs/mode0700;
        # model ONLY that kernel boundary, using real creation and close handles.
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys,'platform','darwin'))
            stack.enter_context(patch.object(historical.platform,'machine',return_value='x86_64'))
            stack.enter_context(patch.dict(os.environ,{'RUNNER_TEMP':str(self.temp_path),'ImageOS':'macos15','ImageVersion':'20260824.0482.1','GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public'},clear=True))
            stack.enter_context(patch.object(os,'geteuid',return_value=self.temp_path.stat().st_uid,create=True))
            if os.name=='nt':
                original_lstat=Path.lstat;original_open=os.open;original_fstat=os.fstat;directory_fds=set()
                def local_lstat(path,*args,**kwargs):
                    info=original_lstat(path,*args,**kwargs)
                    if path!=self.output:return info
                    return SimpleNamespace(**{key:getattr(info,key) for key in ('st_dev','st_ino','st_uid','st_gid')},st_mode=0o40700)
                holder=self.temp_path/'directory-fd-model';holder.write_bytes(b'owned descriptor model')
                def local_open(path,flags,*args,**kwargs):
                    if Path(path)==self.output:
                        fd=original_open(holder,os.O_RDONLY);directory_fds.add(fd);return fd
                    return original_open(path,flags,*args,**kwargs)
                def local_fstat(fd):
                    value=original_fstat(fd)  # Prove this actual handle is live.
                    return local_lstat(self.output) if fd in directory_fds else value
                stack.enter_context(patch.object(Path,'lstat',local_lstat))
                stack.enter_context(patch.object(os,'open',side_effect=local_open))
                stack.enter_context(patch.object(os,'fstat',side_effect=local_fstat))
                stack.enter_context(patch.object(os,'O_DIRECTORY',0,create=True));stack.enter_context(patch.object(os,'O_NOFOLLOW',0,create=True))
            yield
    def write(self,value=None,root=None,name=None,mode='source-record'):
        with historical.source_io_scope(mode):
            historical.SOURCE_IO_CONTEXT.set((mode,self.work/'source'))
            return historical.metadata(root or self.out,name or historical.SOURCE_METADATA_NAME,value or self.value,source=True,owned_sidecar=True)
    def test_unmocked_writer_reproduces_original_denial_without_scope(self):
        self.out.mkdir(parents=True)
        with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write()
        self.assertFalse((self.out/historical.SOURCE_METADATA_NAME).exists())
    def test_unmocked_writer_accepts_only_created_scope_and_retires_it(self):
        with self.host(),historical._mac_intel_owned_proof_tree(self.output,historical.Budget(5))as receipt:
            self.assertEqual(historical._mac_intel_owned_proof_path(receipt),self.output)
            self.out.mkdir(parents=True)
            written=self.write()
            self.assertEqual(json.loads((self.out/historical.SOURCE_METADATA_NAME).read_bytes()),self.value)
            self.assertEqual(written['bytes'],(self.out/historical.SOURCE_METADATA_NAME).stat().st_size)
            self.assertTrue(historical.MAC_INTEL_SOURCE_WRITE_ADMITTED)
            for mode in historical.SOURCE_IO_MODES:
                for attempted in (None,self.identity):
                    with self.assertRaisesRegex(historical.CheckpointError,'source-mac-identity-scope'):historical.source_metadata(mode,None,None,attempted,platform_policy='mac-intel')
        with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write()
        with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):historical._mac_intel_owned_proof_path(receipt)
    def test_wrong_identity_kind_policy_path_phase_and_forgery_never_write(self):
        with self.host(),historical._mac_intel_owned_proof_tree(self.output,historical.Budget(5)):
            self.out.mkdir(parents=True)
            for change in ({'kind':'sorng-macarm-source-metadata'},{'policy':'wrong'},{'identity':{**self.identity,'source':'0'*64}},{'identity':{**self.identity,'target':'aarch64-apple-darwin'}},{'identity':{**self.identity,'image':'latest'}},{'identity':{**self.identity,'canonicalRoot':str(self.work/'other')}}):
                with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write({**self.value,**change})
            for mode in ('source-apply','source-verify'):
                with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write(mode=mode)
            with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write(root=self.out.parent)
            with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write(name='wrong.json')
            for fake in (object(),{},True,'forged'):
                token=historical._MAC_INTEL_PROOF_WRITER.set(fake)
                try:
                    with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write()
                finally:historical._MAC_INTEL_PROOF_WRITER.reset(token)
            self.assertFalse((self.out/historical.SOURCE_METADATA_NAME).exists())
    def test_replaced_root_and_close_fault_cannot_keep_a_live_receipt(self):
        with self.host():
            receipt=None
            with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):
                with historical._mac_intel_owned_proof_tree(self.output,historical.Budget(5))as receipt:
                    old=self.output.with_name(self.output.name+'-old');self.output.rename(old);self.output.mkdir(mode=0o700)
                    self.out.mkdir(parents=True)
                    with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):self.write()
            self.assertNotIn(receipt,historical._MAC_INTEL_PROOF_RECEIPTS)
        # A fresh separate namespace, with a real close that then reports fault.
        self.output=self.temp_path/'cef-mac-intel-owned-proof-12345678-1234-4123-8123-123456789abd'
        with self.host():
            close=os.close
            def faulty_close(fd):close(fd);raise OSError('PRIVATE_CLOSE')
            with self.assertRaises(OSError),patch.object(os,'close',side_effect=faulty_close):
                with historical._mac_intel_owned_proof_tree(self.output,historical.Budget(5))as receipt:pass
            self.assertTrue(historical.SOURCE_CLOSE_FAILURE);self.assertNotIn(receipt,historical._MAC_INTEL_PROOF_RECEIPTS)
            with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):historical._mac_intel_owned_proof_path(receipt)
    @unittest.skipUnless(os.name=='posix','full FD/scandir filesystem integration requires POSIX; Windows is not Darwin proof')
    def test_complete_real_codec_writer_recreated_inode_and_cleanup(self):
        with self.host(),ExitStack() as stack:
            if sys.platform!='darwin' or not hasattr(self.temp_path.stat(),'st_birthtime'):
                # Linux models only Darwin's unavailable birth supplement;
                # source snapshots, hashing, worker joins and writer IO are real.
                stack.enter_context(patch.object(historical,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')))
            budget=historical.Budget(15)
            with historical._mac_intel_owned_proof_tree(self.output,budget)as receipt:
                tree=proof.IntelOwnedTree(historical,receipt)
                fixture=proof.fixture
                with ExitStack()as original_inode:
                    def fixture_with_held_input(owned,module):
                        result=fixture(owned,module)
                        file=result[1]/'src/input.cc';before=owned.check(file)
                        fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
                        original_inode.callback(os.close,fd)
                        self.assertEqual(proof.base.owner(os.fstat(fd)),proof.base.owner(before))
                        self.assertEqual(proof.base.owner(owned.check(file)),proof.base.owner(before))
                        return result
                    # Keep the creation-owned initial inode live across both real
                    # replacements, so Linux cannot recycle it for the final file.
                    with patch.object(proof,'fixture',side_effect=fixture_with_held_input):
                        result=proof.roundtrip(tree,historical,budget)
                self.assertTrue(result['recreatedInode']);self.assertTrue(result['corruptBytesDeniedBeforeUtime'])
                self.assertTrue(result['verified']);self.assertTrue(tree.cleanup())
            with self.assertRaisesRegex(historical.CheckpointError,'source-sidecar-role'):historical._mac_intel_owned_proof_path(receipt)


class IntelPublicScope(unittest.TestCase):
    def test_history_inverse_is_closed_and_current_public_module_stays_current(self):
        raw=(ROOT/'scripts/lib/cef-checkpoint-archive.py').read_text(encoding='utf8').encode()
        previous=_history.before_compiler_compatibility(raw,'scripts/lib/cef-checkpoint-archive.py')
        self.assertNotEqual(m.MAC_INTEL_SOURCE,historical.MAC_INTEL_SOURCE)
        self.assertEqual(m.MAC_INTEL_SOURCE,m.MAC_SOURCE_SCOPE_QUALIFICATION[20][1][1])
        self.assertEqual(_history.before_compiler_compatibility(previous,'scripts/lib/cef-checkpoint-archive.py'),previous)
        for body in (raw,previous):
            damaged=bytearray(body);damaged[len(damaged)//2]^=1
            with self.assertRaises(AssertionError):
                _history.before_compiler_compatibility(bytes(damaged),'scripts/lib/cef-checkpoint-archive.py')
    def identity(self):
        return {'target':'x86_64-apple-darwin','source':m.MAC_INTEL_SOURCE,'image':m.MAC_INTEL_SOURCE_IMAGE,
                'canonicalRoot':'/Users/runner/work/_temp/sorng-cef-engineering/x86_64-apple-darwin/'+m.MAC_INTEL_SOURCE,
                **{key:'a'*64 for key in ('producer','tools','graph','siso')}}
    def host(self,**changes):
        stack=ExitStack();stack.enter_context(patch.object(sys,'platform','darwin'))
        stack.enter_context(patch.object(m.platform,'machine',return_value='x86_64'))
        stack.enter_context(patch.dict(os.environ,{'ImageOS':'macos15','ImageVersion':m.MAC_INTEL_SOURCE_IMAGE,
            'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public',**changes},clear=True))
        return stack
    def test_exact_qualified_public_scope_reaches_codec_and_binds_raw_proof(self):
        identity=self.identity();work=Path(identity['canonicalRoot'])
        with self.host(),patch.object(m,'safe',side_effect=lambda path:path),patch.object(m,'_source_metadata_owned_codec',return_value={'complete':True})as core:
            for mode in m.SOURCE_IO_MODES:
                self.assertEqual(m.source_metadata_owned(mode,work/'source',work/'source/src/out/Release_GN_x64'/m.SOURCE_METADATA_NAME,identity,platform_policy='mac-intel'),{'complete':True})
                self.assertEqual(core.call_args.args[4],work);self.assertEqual(core.call_args.args[-1],'mac-intel')
        self.assertEqual(m.MAC_INTEL_SOURCE_PROOF,(41348226366,13099539006,'499ade0595d3e3d90fa15aea1ffb8499e297bf3f',16278,
            '2e56488f480ed75dc479569d5214914b4b2ed0e73732e2a1723156d85a0ca249',
            'c34dde53d28645ddb78c0ac7b97b40df48d6acce10ff260462bb7178c6f9aab5'))
    def test_unqualified_host_identity_and_cli_fail_before_filesystem_io(self):
        cases=[({'ImageVersion':'latest'},{}),({'ImageOS':'macos14'},{}),({'GITHUB_ACTIONS':'false'},{}),
            ({'RUNNER_ENVIRONMENT':'self-hosted'},{}),({'GITHUB_REPOSITORY_VISIBILITY':'private'},{}),
            ({},{'source':'0'*64}),({},{'target':'aarch64-apple-darwin'}),({},{'image':'latest'}),({},{'canonicalRoot':'/arbitrary'})]
        for env,identity in cases:
            with self.host(**env),patch.object(m,'source_metadata_identity',side_effect=AssertionError('no identity IO')),patch.object(m,'safe',side_effect=AssertionError('no filesystem IO')),patch.object(m,'_source_metadata_owned_codec',side_effect=AssertionError('no codec')):
                for mode in m.SOURCE_IO_MODES:
                    with self.assertRaisesRegex(m.CheckpointError,'source-mac-(host|identity)-scope'):
                        m.source_metadata_owned(mode,None,None,{**self.identity(),**identity},platform_policy='mac-intel')
        for platform_name,architecture in [('linux','x86_64'),('darwin','arm64')]:
            with self.host(),patch.object(sys,'platform',platform_name),patch.object(m.platform,'machine',return_value=architecture),patch.object(m,'safe',side_effect=AssertionError('no path IO')):
                with self.assertRaisesRegex(m.CheckpointError,'source-mac-host-scope'):m.source_metadata_owned('source-apply',None,None,self.identity(),platform_policy='mac-intel')
        for mode in m.SOURCE_IO_MODES:
            with self.host(ImageVersion='wrong'),patch.object(sys,'argv',['archive',mode,'--input','PRIVATE','--output','PRIVATE','--manifest','PRIVATE','--platform-policy','mac-intel']),patch.object(Path,'read_bytes',side_effect=AssertionError('no manifest read')):
                with self.assertRaisesRegex(m.CheckpointError,'source-mac-host-scope'):m.main()


if __name__=='__main__':unittest.main(verbosity=2)
