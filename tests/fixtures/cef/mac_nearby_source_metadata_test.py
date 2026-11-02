"""Portable private-proof guards; real Darwin qualification remains separate."""
import copy
from contextlib import contextmanager, ExitStack
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('nearby_codec',ROOT/'scripts/lib/cef-checkpoint-archive.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
proof_spec=importlib.util.spec_from_file_location('nearby_proof',Path(__file__).with_name('mac_nearby_source_proof.py'))
proof=importlib.util.module_from_spec(proof_spec);proof_spec.loader.exec_module(proof)
BRANCH='refs/heads/codex/mac-nearby-source-qualification-20261101'


class PrivateNearby(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.parent=Path(self.temp.name).resolve()
        self.output=self.parent/'cef-mac-nearby-owned-proof-12345678-1234-4123-8123-123456789abc'
        self.environment={'RUNNER_TEMP':str(self.parent),'ImageOS':'macos15','ImageVersion':m.MAC_SOURCE_IMAGE,
            'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public',
            'GITHUB_REPOSITORY':'supermarsx/sortOfRemoteNG','GITHUB_REPOSITORY_ID':'1010282954',
            'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':BRANCH,'GITHUB_SHA':'a'*40,
            'GITHUB_WORKFLOW_SHA':'a'*40,
            'GITHUB_WORKFLOW_REF':'supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-nearby-source-proof.yml@'+BRANCH}
        m.SOURCE_CLOSE_FAILURE=False
    def tearDown(self):self.temp.cleanup()
    @contextmanager
    def host(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys,'platform','darwin'))
            stack.enter_context(patch.object(m.platform,'machine',return_value='x86_64'))
            stack.enter_context(patch.dict(os.environ,self.environment,clear=True))
            # A portable model of only the hosted temp location and Windows
            # directory-FD boundary. Sidecar creation/readback are real IO.
            stack.enter_context(patch.object(m,'_MAC_NEARBY_PROOF_TEMP',str(self.parent)))
            stack.enter_context(patch.object(os,'geteuid',return_value=self.parent.stat().st_uid,create=True))
            if os.name=='nt':
                lstat=Path.lstat;open_fd=os.open;fstat=os.fstat;directories=set()
                holder=self.parent/'owned-directory-fd-model';holder.write_bytes(b'owned handle')
                def local_lstat(path,*args,**kwargs):
                    info=lstat(path,*args,**kwargs)
                    if path!=self.output:return info
                    return SimpleNamespace(**{key:getattr(info,key)for key in('st_dev','st_ino','st_uid','st_gid')},st_mode=stat.S_IFDIR|0o700)
                def local_open(path,flags,*args,**kwargs):
                    if Path(path)==self.output:
                        fd=open_fd(holder,os.O_RDONLY);directories.add(fd);return fd
                    return open_fd(path,flags,*args,**kwargs)
                def local_fstat(fd):
                    info=fstat(fd)
                    return local_lstat(self.output) if fd in directories else info
                stack.enter_context(patch.object(Path,'lstat',local_lstat))
                stack.enter_context(patch.object(os,'open',side_effect=local_open))
                stack.enter_context(patch.object(os,'fstat',side_effect=local_fstat))
                stack.enter_context(patch.object(os,'O_DIRECTORY',0,create=True))
                stack.enter_context(patch.object(os,'O_NOFOLLOW',0,create=True))
            yield
    def value(self,intel=False):
        work=self.output/('intel' if intel else 'arm')/'work'
        out=work/'source/src/out'/('Release_GN_x64' if intel else 'Release_GN_arm64')
        identity={'target':'x86_64-apple-darwin' if intel else 'aarch64-apple-darwin',
            'source':m.MAC_INTEL_SOURCE if intel else m.MAC_SOURCE,'canonicalRoot':str(work),'image':m.MAC_SOURCE_IMAGE,
            **{key:'b'*64 for key in('producer','tools','graph','siso')}}
        value={'schemaVersion':2,'kind':'sorng-macintel-source-metadata' if intel else 'sorng-macarm-source-metadata',
            'policy':m.MAC_INTEL_NEARBY_METADATA_POLICY if intel else m.MAC_ARM_NEARBY_METADATA_POLICY,
            'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,'identity':identity,
            'snapshot':{'entries':[],'rootMtimeNs':'1','gitHeads':{},'bytes':0,
                'literalLinks':m._mac_nearby_portable_declarations()}}
        return work,out,value
    def write(self,out,value,mode='source-record'):
        with m.source_io_scope(mode):
            m.SOURCE_IO_CONTEXT.set((mode,Path(value['identity']['canonicalRoot'])/'source'))
            return m.metadata(out,m.SOURCE_METADATA_NAME,value,source=True,owned_sidecar=True)
    def test_policy_availability_does_not_admit_private_proof_or_public_wrong_scope(self):
        self.assertIs(type(m.MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED),bool)
        self.assertEqual(m._MAC_NEARBY_PROOF_TEMP,'/Users/runner/work/_temp')
        for policy in ('mac-arm','mac-intel'):
            for mode in m.SOURCE_IO_MODES:
                with patch.object(m,'safe',side_effect=AssertionError('no path IO')):
                    with self.assertRaises(m.CheckpointError):m.source_metadata(mode,None,None,None,platform_policy=policy)
        self.assertFalse(m._mac_nearby_policy_owned({'mac':True,'ownedMacArm':True,'nearbyLiteralPolicy':m.MAC_NEARBY_LITERAL_POLICY}))
    def test_fixed_gitmodules_and_portable_declarations_are_exact_five(self):
        import hashlib
        raw=(ROOT/'tests/fixtures/cef/mac_nearby.gitmodules').read_bytes()
        self.assertEqual(len(raw),1512);self.assertEqual(hashlib.sha256(raw).hexdigest(),m.NEARBY_MODULES_SHA256)
        rows=m._mac_nearby_portable_declarations()
        self.assertEqual(len(rows),5)
        self.assertEqual(len({row['origin']for row in rows}),5)
        for row in rows:
            self.assertEqual(row['nearbyHead'],m.NEARBY_HEAD)
            self.assertEqual(row['gitmodulesSha256'],m.NEARBY_MODULES_SHA256)
            self.assertEqual(row['rawTargetSha256'],hashlib.sha256(row['rawTarget'].encode()).hexdigest())
            self.assertEqual(row['state'],'empty')
    def test_named_path_or_snapshot_cannot_mint_v2_writer_authority(self):
        for intel in(False,True):
            _,out,value=self.value(intel);out.mkdir(parents=True)
            with self.assertRaises(m.CheckpointError):self.write(out,value)
            self.assertFalse((out/m.SOURCE_METADATA_NAME).exists())
    def test_real_creator_receipt_writes_both_exact_policies_and_retires_before_close(self):
        with self.host(),m._mac_nearby_owned_proof_tree(self.output,m.Budget(5))as receipt:
            self.assertEqual(m._mac_nearby_owned_proof_path(receipt),self.output)
            for intel in(False,True):
                work,out,value=self.value(intel);out.mkdir(parents=True)
                written=self.write(out,value)
                self.assertEqual(json.loads((out/m.SOURCE_METADATA_NAME).read_bytes()),value)
                self.assertEqual(written['bytes'],(out/m.SOURCE_METADATA_NAME).stat().st_size)
                self.assertTrue(m._mac_nearby_proof_selection(work/'source',value['identity'],work,'mac-intel'if intel else'mac-arm'))
        self.assertNotIn(receipt,m._MAC_NEARBY_PROOF_RECEIPTS)
        with self.assertRaises(m.CheckpointError):m._mac_nearby_owned_proof_path(receipt)
        _,out,value=self.value()
        with self.assertRaises(m.CheckpointError):self.write(out,value)
    def test_wrong_source_target_image_root_policy_schema_phase_and_literal_rows_deny_before_write(self):
        with self.host(),m._mac_nearby_owned_proof_tree(self.output,m.Budget(5)):
            for intel in(False,True):
                work,out,value=self.value(intel);out.mkdir(parents=True)
                changes=[{'schemaVersion':1},{'policy':'old-or-foreign'},{'kind':'sorng-linuxarm-source-metadata'}]
                changes += [{'identity':{**value['identity'],key:'foreign'}}for key in('target','source','image','canonicalRoot')]
                changes += [{'snapshot':{**value['snapshot'],'literalLinks':[]}}]
                changed=copy.deepcopy(value['snapshot']);changed['literalLinks'][0]['gitlinkCommit']='0'*40
                changes.append({'snapshot':changed})
                for delta in changes:
                    with self.assertRaises(m.CheckpointError):self.write(out,{**value,**delta})
                for mode in('source-apply','source-verify'):
                    with self.assertRaises(m.CheckpointError):self.write(out,value,mode)
                with self.assertRaises(m.CheckpointError):self.write(out.parent,value)
                self.assertFalse((out/m.SOURCE_METADATA_NAME).exists())
    def test_forged_or_expired_object_is_not_a_receipt(self):
        with self.host(),m._mac_nearby_owned_proof_tree(self.output,m.Budget(5)):
            _,out,value=self.value();out.mkdir(parents=True)
            for fake in(object(),True,{},'named-path'):
                token=m._MAC_NEARBY_PROOF_WRITER.set(fake)
                try:
                    with self.assertRaises(m.CheckpointError):self.write(out,value)
                finally:m._MAC_NEARBY_PROOF_WRITER.reset(token)
            self.assertFalse((out/m.SOURCE_METADATA_NAME).exists())
    def test_branch_host_image_and_head_mismatch_deny_before_creation(self):
        with self.host():
            for key in('GITHUB_REF','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','ImageVersion','RUNNER_ENVIRONMENT'):
                with patch.dict(os.environ,{key:'foreign'}):
                    with self.assertRaises(m.CheckpointError):
                        with m._mac_nearby_owned_proof_tree(self.output,m.Budget(5)):self.fail('not admitted')
                self.assertFalse(self.output.exists())
    def test_replaced_root_and_close_fault_retire_genuine_receipt(self):
        with self.host():
            with self.assertRaises(m.CheckpointError):
                with m._mac_nearby_owned_proof_tree(self.output,m.Budget(5))as receipt:
                    self.output.rename(self.output.with_name(self.output.name+'-retired'))
                    self.output.mkdir(mode=0o700)
                    m._mac_nearby_owned_proof_path(receipt)
            self.assertNotIn(receipt,m._MAC_NEARBY_PROOF_RECEIPTS)
        self.output=self.parent/'cef-mac-nearby-owned-proof-12345678-1234-4123-8123-123456789abd'
        with self.host():
            close=os.close
            def fault(fd):close(fd);raise OSError('closed owned FD then reported failure')
            with patch.object(os,'close',side_effect=fault),self.assertRaises(OSError):
                with m._mac_nearby_owned_proof_tree(self.output,m.Budget(5))as receipt:pass
            self.assertTrue(m.SOURCE_CLOSE_FAILURE)
            self.assertNotIn(receipt,m._MAC_NEARBY_PROOF_RECEIPTS)
    def test_v2_selection_does_not_accept_legacy_v1_sidecar(self):
        with self.host(),m._mac_nearby_owned_proof_tree(self.output,m.Budget(5)):
            work,out,value=self.value();out.mkdir(parents=True)
            legacy={**value,'schemaVersion':1,'policy':m.MAC_SOURCE_METADATA_POLICY}
            with m.source_io_scope('source-apply'),patch.object(m,'source_read_sidecar',return_value=legacy),patch.object(m.os,'utime',side_effect=AssertionError('no metadata write')):
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-binding'):
                    m._source_metadata_owned_codec('source-apply',work/'source',out/m.SOURCE_METADATA_NAME,value['identity'],work,m.Budget(5),'mac-arm')
    def test_actual_snapshot_projection_keeps_raw_mac_order_and_all_five_literals_without_cipd(self):
        import hashlib
        with self.host(),m._mac_nearby_owned_proof_tree(self.output,m.Budget(5))as receipt:
            for intel in(False,True):
                work,out,value=self.value(intel);out.mkdir(parents=True)
                root=work/'source';rows=[]
                # Model only the inventory boundary; the actual snapshot body,
                # thread-pool byte hashing, reader joins and projection execute.
                with patch.object(m,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')):
                    for name,raw in(('z.cc',b'z'),('.gclient_entries',b'entries = {}\n'),('a.cc',b'a')):
                        file=root/name;file.write_bytes(raw);info=file.stat()
                        row={'path':name,'kind':'file','stamp':m.stamp(info),'ctimeNs':info.st_ctime_ns}
                        m.source_mac_row(row,info,{'mac':True,'ownedMacArm':True});rows.append(row)
                    policy={'mac':True,'ownedMacIntel'if intel else'ownedMacArm':True,
                        'nearbyLiteralPolicy':m.MAC_NEARBY_LITERAL_POLICY,'_macNearbyReceipt':receipt,
                        '_macNearbyIdentity':value['identity'],'_macNearbyRoot':root,
                        '_macNearbyPlatform':'mac-intel'if intel else'mac-arm',
                        'registrySha256':hashlib.sha256(b'entries = {}\n').hexdigest(),
                        'gitHeads':{'src':'a'*40,'src/cef':'b'*40,'depot_tools':'c'*40,m.NEARBY_ROOT:m.NEARBY_HEAD},
                        '_nearby_literals':{'portable':m._mac_nearby_portable_declarations()}}
                    with ExitStack()as stack:
                        if os.name=='nt':
                            # Windows exposes creation time through path ctime
                            # and last-write time through some FD ctime views.
                            # Model only Darwin's matching ctime views; all bytes,
                            # live FDs and the remaining identity fields are real.
                            fstat=os.fstat
                            files={(row['stamp'][2],row['stamp'][3]):root/row['path']for row in rows}
                            def matching_ctime(fd):
                                info=fstat(fd);file=files.get((info.st_dev,info.st_ino))
                                if file is None:return info
                                current=file.stat()
                                if m.stamp(info)!=m.stamp(current):return info
                                return SimpleNamespace(**{key:getattr(info,key)for key in('st_size','st_mtime_ns','st_dev','st_ino','st_mode','st_nlink','st_uid','st_gid')},st_ctime_ns=current.st_ctime_ns)
                            stack.enter_context(patch.object(os,'fstat',side_effect=matching_ctime))
                        stack.enter_context(patch.object(m,'inventory',return_value=(rows,sum(row['stamp'][0]for row in rows))))
                        stack.enter_context(patch.object(m,'source_cipd_layout',side_effect=AssertionError('Mac must never enter Linux CIPD layout')))
                        snapshot=m.source_snapshot_inventory(root,m.Budget(5),{},policy,False)
                    self.assertEqual([row['path']for row in snapshot['entries']],['z.cc','.gclient_entries','a.cc'])
                    self.assertEqual(snapshot['literalLinks'],m._mac_nearby_portable_declarations())
                    self.assertEqual(len(snapshot['literalLinks']),5)
                    self.assertEqual(snapshot['entries'][0]['sha256'],hashlib.sha256(b'z').hexdigest())
    @unittest.skipUnless(os.name=='posix','genuine full FD/scandir codec fixture requires POSIX; Windows is not Darwin proof')
    def test_genuine_full_nearby_codec_roundtrip_recreates_both_trees_and_checks_negatives(self):
        with self.host(),ExitStack()as stack:
            if not hasattr(self.parent.stat(),'st_birthtime'):
                stack.enter_context(patch.object(m,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')))
            budget=m.Budget(40)
            with m._mac_nearby_owned_proof_tree(self.output,budget)as receipt:
                tree=proof.NearbyTree(m,receipt)
                try:
                    for intel in(False,True):
                        result=proof.roundtrip(tree,m,budget,intel)
                        self.assertTrue(result['recreatedDistinctInodes']);self.assertTrue(result['verified'])
                        self.assertEqual(set(result['negativeCases']),set(proof.NEGATIVES))
                finally:self.assertTrue(tree.cleanup())
            self.assertNotIn(receipt,m._MAC_NEARBY_PROOF_RECEIPTS)
    def test_proof_preflight_denies_other_host_or_branch_before_interpreter_or_output(self):
        with self.host(),patch.object(proof.base,'verify_python',side_effect=AssertionError('no interpreter read')):
            for key in('GITHUB_REF','ImageVersion','GITHUB_WORKFLOW_SHA','GITHUB_REPOSITORY'):
                with patch.dict(os.environ,{key:'foreign'}),self.assertRaises(RuntimeError):
                    proof.preflight(['--output',str(self.output)])
                self.assertFalse(self.output.exists())


if __name__=='__main__':unittest.main(verbosity=2)
