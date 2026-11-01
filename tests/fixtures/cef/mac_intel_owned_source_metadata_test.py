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
proof=load('intel_proof','tests/fixtures/cef/mac_intel_owned_source_proof.py')


class IntelCodec(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.work=Path(self.temp.name);self.root=self.work/'source'
        self.out=self.root/'src/out/Release_GN_x64';self.out.mkdir(parents=True);self.sidecar=self.out/m.SOURCE_METADATA_NAME
        self.identity={key:'a'*64 for key in ('source','producer','tools','graph','siso')}
        self.identity.update(target='x86_64-apple-darwin',canonicalRoot=str(self.work),image='20260824.0482.1')
        self.snapshot={'entries':[],'rootMtimeNs':str(self.root.stat().st_mtime_ns),'gitHeads':{},'bytes':0}
        self.stored={'schemaVersion':1,'kind':'sorng-macintel-source-metadata','policy':m.MAC_INTEL_SOURCE_METADATA_POLICY,
                     'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,'identity':self.identity,'snapshot':self.snapshot}
    def tearDown(self):self.temp.cleanup()
    def core(self,mode,budget=None):
        with m.source_io_scope(mode):return m._source_metadata_owned_codec(mode,self.root,self.sidecar,self.identity,self.work,budget or m.Budget(5),'mac-intel')
    def test_public_gate_stays_false_before_all_io_and_mutations(self):
        self.assertFalse(m.MAC_INTEL_SOURCE_WRITE_ADMITTED)
        for mode in m.SOURCE_IO_MODES:
            with patch.object(m,'safe',side_effect=AssertionError('no path access')),patch.object(m,'_source_metadata_owned_codec',side_effect=AssertionError('no private call')),patch.object(m.os,'utime',side_effect=AssertionError('no mutation')):
                with self.assertRaisesRegex(m.CheckpointError,'source-mac-intel-darwin-capability-unreviewed'):
                    m.source_metadata(mode,None,None,None,platform_policy='mac-intel')
    def test_owned_intel_birth_is_opaque_and_nonowned_stays_strict(self):
        info=SimpleNamespace(st_size=1,st_mtime_ns=2,st_dev=3,st_ino=4,st_mode=0o100600,st_nlink=1,st_ctime_ns=5,st_uid=6,st_gid=7,st_birthtime=1790000000.125)
        for role in ('ownedMacArm','ownedMacIntel'):
            policy={'mac':True,role:True};row={};m.source_mac_row(row,info,policy)
            self.assertEqual(row['birthIdentity'],('darwin-birthtime-float-hex',info.st_birthtime.hex()))
            self.assertEqual(m.source_local(info,policy)[2],row['birthIdentity'])
            self.assertNotIn('birthNs',row)
        for policy in ({'mac':True},{'mac':True,'ownedMacIntel':1},{'ownedMacIntel':True},{'mac':True,'ownedUnknown':True}):
            self.assertFalse(m.source_owned_mac(policy))
        with self.assertRaises(m.CheckpointError):m.source_mac_row({},info,{'mac':True})
    def test_intel_record_selects_full_mac_context_and_preserves_sidecar_kind(self):
        captured={}
        def write(root,name,value,**kwargs):captured.update(value);return {'name':name,'bytes':100,'sha256':'a'*64}
        with patch.object(sys,'platform','darwin'),patch.object(m,'source_repositories',return_value={'repositories':{m.NEARBY_ROOT}}),patch.object(m,'source_snapshot',return_value=self.snapshot)as take,patch.object(m,'metadata',side_effect=write),patch.object(m,'source_read_sidecar',side_effect=lambda *a,**k:captured),patch.object(m,'source_stat_cache_write',side_effect=AssertionError('no Linux cache')):
            self.assertTrue(self.core('source-record')['complete'])
        self.assertEqual(take.call_args.kwargs,{'context':{'mac':True,'ownedMacIntel':True}})
        self.assertEqual(captured['kind'],'sorng-macintel-source-metadata');self.assertEqual(captured['policy'],m.MAC_INTEL_SOURCE_METADATA_POLICY)
        self.assertNotIn('literalLinks',captured['snapshot'])
    def test_intel_verify_uses_two_full_passes_and_no_linux_cache(self):
        with patch.object(sys,'platform','darwin'),patch.object(m,'source_read_sidecar',return_value=self.stored),patch.object(m,'source_snapshot',return_value=self.snapshot)as take,patch.object(m,'source_stat_cache_reuse',side_effect=AssertionError('no Linux cache')),patch.object(m.os,'utime',side_effect=AssertionError('verify cannot write')):
            self.assertTrue(self.core('source-verify')['complete'])
        self.assertEqual(take.call_count,2);self.assertTrue(all(c.kwargs=={'context':{'mac':True,'ownedMacIntel':True}}for c in take.call_args_list))
    def test_same_length_hash_change_denies_before_utime(self):
        row={'path':'src/file','kind':'file','mode':0o100600,'size':1,'sha256':'a'*64,'mtimeNs':'1','nlink':1}
        expected={**self.snapshot,'entries':[row],'bytes':1};changed={**expected,'entries':[{**row,'sha256':'b'*64}]}
        with patch.object(sys,'platform','darwin'),patch.object(m,'source_read_sidecar',return_value={**self.stored,'snapshot':expected}),patch.object(m,'source_snapshot',return_value=changed),patch.object(m.os,'utime',side_effect=AssertionError('no mutation')):
            with self.assertRaisesRegex(m.CheckpointError,'source-content-changed'):self.core('source-apply')
    def test_apply_root_uses_full_local_guard_and_owned_transition(self):
        policy={'mac':True,'ownedMacIntel':True};rootinfo=self.root.stat()
        def take(root,budget,guards=None,**kwargs):
            self.assertEqual(kwargs['context'],policy)
            if guards is not None:guards['']=m.source_local(root.stat(),policy)
            return self.snapshot
        with patch.object(sys,'platform','darwin'),patch.object(m,'source_repositories',return_value={}),patch.object(m,'source_read_sidecar',return_value=self.stored),patch.object(m,'source_snapshot',side_effect=take),patch.object(m,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')),patch.object(m.os,'O_NOFOLLOW',0,create=True),patch.object(m.os,'O_DIRECTORY',0,create=True),patch.object(m.os,'open',return_value=123),patch.object(m.os,'fstat',return_value=rootinfo),patch.object(m.os,'utime')as write,patch.object(m.os,'close')as close,patch.object(m,'source_owned_mac_transition',wraps=m.source_owned_mac_transition)as transition:
            self.assertTrue(self.core('source-apply')['complete'])
        self.assertEqual(write.call_count,1);self.assertEqual(close.call_count,1);self.assertEqual(transition.call_count,1)
    def test_cross_kind_and_expired_budget_deny_before_write(self):
        for kind in ('sorng-macarm-source-metadata','sorng-linuxarm-source-metadata'):
            with patch.object(sys,'platform','darwin'),patch.object(m,'source_read_sidecar',return_value={**self.stored,'kind':kind}),patch.object(m.os,'utime',side_effect=AssertionError('no mutation')):
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-binding'):self.core('source-apply')
        class Expired:
            def check(self):raise m.CheckpointError('controlled-deadline')
        with patch.object(sys,'platform','darwin'),patch.object(m,'source_snapshot',side_effect=AssertionError('no scan')):
            with self.assertRaisesRegex(m.CheckpointError,'controlled-deadline'):self.core('source-record',Expired())
    def test_recreated_fixture_file_has_new_inode_and_cleans_only_its_own_tree(self):
        folder=Path(self.temp.name)/'owned'
        with patch.object(os,'geteuid',return_value=self.work.stat().st_uid,create=True),patch.object(os,'O_NOFOLLOW',getattr(os,'O_NOFOLLOW',0),create=True):
            tree=proof.base.OwnedTree(folder);file=tree.file('src/input.cc',b'owned bytes')
            before=file.stat();proof.replace_input(tree,file,b'owned bytes')
            self.assertNotEqual((file.stat().st_dev,file.stat().st_ino),(before.st_dev,before.st_ino))
            self.assertTrue(tree.cleanup());folder.rmdir()
    def test_failure_code_projection_is_closed_and_never_raw_exception(self):
        with patch.object(m,'SOURCE_CLOSE_FAILURE',False):
            self.assertEqual(proof.failure_code(m.CheckpointError('source-sidecar-role'),m),'source-sidecar-role')
            for error in (m.CheckpointError('PRIVATE_PATH'),OSError('PRIVATE_PATH')):
                self.assertEqual(proof.failure_code(error,m),'OWNED_INTEL_SOURCE_PROOF_FAILED')


class ActualProofWriter(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.temp_path=Path(self.temp.name).resolve()
        self.output=self.temp_path/'cef-mac-intel-owned-proof-12345678-1234-4123-8123-123456789abc'
        self.work=self.output/'work';self.out=self.work/'source/src/out/Release_GN_x64'
        self.identity={'target':'x86_64-apple-darwin','source':m.MAC_INTEL_SOURCE,'canonicalRoot':str(self.work),'image':'20260824.0482.1',**{key:'a'*64 for key in ('producer','tools','graph','siso')}}
        self.value={'schemaVersion':1,'kind':'sorng-macintel-source-metadata','policy':m.MAC_INTEL_SOURCE_METADATA_POLICY,'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,'identity':self.identity,'snapshot':{'entries':[],'rootMtimeNs':'1','gitHeads':{},'bytes':0}}
        m.SOURCE_CLOSE_FAILURE=False
    def tearDown(self):self.temp.cleanup()
    @contextmanager
    def host(self):
        # Writer IO is never mocked. Windows lacks directory FDs/mode0700;
        # model ONLY that kernel boundary, using real creation and close handles.
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys,'platform','darwin'))
            stack.enter_context(patch.object(m.platform,'machine',return_value='x86_64'))
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
        with m.source_io_scope(mode):
            m.SOURCE_IO_CONTEXT.set((mode,self.work/'source'))
            return m.metadata(root or self.out,name or m.SOURCE_METADATA_NAME,value or self.value,source=True,owned_sidecar=True)
    def test_unmocked_writer_reproduces_original_denial_without_scope(self):
        self.out.mkdir(parents=True)
        with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write()
        self.assertFalse((self.out/m.SOURCE_METADATA_NAME).exists())
    def test_unmocked_writer_accepts_only_created_scope_and_retires_it(self):
        with self.host(),m._mac_intel_owned_proof_tree(self.output,m.Budget(5))as receipt:
            self.assertEqual(m._mac_intel_owned_proof_path(receipt),self.output)
            self.out.mkdir(parents=True)
            written=self.write()
            self.assertEqual(json.loads((self.out/m.SOURCE_METADATA_NAME).read_bytes()),self.value)
            self.assertEqual(written['bytes'],(self.out/m.SOURCE_METADATA_NAME).stat().st_size)
            self.assertFalse(m.MAC_INTEL_SOURCE_WRITE_ADMITTED)
            for mode in m.SOURCE_IO_MODES:
                with self.assertRaisesRegex(m.CheckpointError,'source-mac-intel-darwin-capability-unreviewed'):m.source_metadata(mode,None,None,None,platform_policy='mac-intel')
        with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write()
        with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):m._mac_intel_owned_proof_path(receipt)
    def test_wrong_identity_kind_policy_path_phase_and_forgery_never_write(self):
        with self.host(),m._mac_intel_owned_proof_tree(self.output,m.Budget(5)):
            self.out.mkdir(parents=True)
            for change in ({'kind':'sorng-macarm-source-metadata'},{'policy':'wrong'},{'identity':{**self.identity,'source':'0'*64}},{'identity':{**self.identity,'target':'aarch64-apple-darwin'}},{'identity':{**self.identity,'image':'latest'}},{'identity':{**self.identity,'canonicalRoot':str(self.work/'other')}}):
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write({**self.value,**change})
            for mode in ('source-apply','source-verify'):
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write(mode=mode)
            with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write(root=self.out.parent)
            with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write(name='wrong.json')
            for fake in (object(),{},True,'forged'):
                token=m._MAC_INTEL_PROOF_WRITER.set(fake)
                try:
                    with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write()
                finally:m._MAC_INTEL_PROOF_WRITER.reset(token)
            self.assertFalse((self.out/m.SOURCE_METADATA_NAME).exists())
    def test_replaced_root_and_close_fault_cannot_keep_a_live_receipt(self):
        with self.host():
            receipt=None
            with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):
                with m._mac_intel_owned_proof_tree(self.output,m.Budget(5))as receipt:
                    old=self.output.with_name(self.output.name+'-old');self.output.rename(old);self.output.mkdir(mode=0o700)
                    self.out.mkdir(parents=True)
                    with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):self.write()
            self.assertNotIn(receipt,m._MAC_INTEL_PROOF_RECEIPTS)
        # A fresh separate namespace, with a real close that then reports fault.
        self.output=self.temp_path/'cef-mac-intel-owned-proof-12345678-1234-4123-8123-123456789abd'
        with self.host():
            close=os.close
            def faulty_close(fd):close(fd);raise OSError('PRIVATE_CLOSE')
            with self.assertRaises(OSError),patch.object(os,'close',side_effect=faulty_close):
                with m._mac_intel_owned_proof_tree(self.output,m.Budget(5))as receipt:pass
            self.assertTrue(m.SOURCE_CLOSE_FAILURE);self.assertNotIn(receipt,m._MAC_INTEL_PROOF_RECEIPTS)
            with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):m._mac_intel_owned_proof_path(receipt)
    @unittest.skipUnless(os.name=='posix','full FD/scandir filesystem integration requires POSIX; Windows is not Darwin proof')
    def test_complete_real_codec_writer_recreated_inode_and_cleanup(self):
        with self.host(),ExitStack() as stack:
            if sys.platform!='darwin' or not hasattr(self.temp_path.stat(),'st_birthtime'):
                # Linux models only Darwin's unavailable birth supplement;
                # source snapshots, hashing, worker joins and writer IO are real.
                stack.enter_context(patch.object(m,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')))
            budget=m.Budget(15)
            with m._mac_intel_owned_proof_tree(self.output,budget)as receipt:
                tree=proof.IntelOwnedTree(m,receipt)
                result=proof.roundtrip(tree,m,budget)
                self.assertTrue(result['recreatedInode']);self.assertTrue(result['corruptBytesDeniedBeforeUtime'])
                self.assertTrue(result['verified']);self.assertTrue(tree.cleanup())
            with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):m._mac_intel_owned_proof_path(receipt)


if __name__=='__main__':unittest.main(verbosity=2)
