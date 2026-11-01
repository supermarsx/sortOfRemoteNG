"""Production admission boundaries; no canonical production path is written."""
import ast
import copy
from contextlib import contextmanager
import hashlib
import importlib.util
import os
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
FILE=ROOT/'scripts/lib/cef-checkpoint-archive.py'
spec=importlib.util.spec_from_file_location('nearby_public_codec',FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FACTS={'ImageOS':'macos15','ImageVersion':'20260824.0482.1','GITHUB_ACTIONS':'true',
       'RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public'}


class PublicScope(unittest.TestCase):
    @contextmanager
    def host(self):
        with patch.object(sys,'platform','darwin'),patch.object(m.platform,'machine',return_value='x86_64'),patch.dict(os.environ,FACTS,clear=True):yield
    def data(self,intel=False):
        target='x86_64-apple-darwin'if intel else'aarch64-apple-darwin'
        source=m.MAC_INTEL_SOURCE if intel else m.MAC_SOURCE
        work=Path('/Users/runner/work/_temp/sorng-cef-engineering/'+target+'/'+source)
        identity={'target':target,'source':source,'canonicalRoot':'/Users/runner/work/_temp/sorng-cef-engineering/'+target+'/'+source,
            'image':m.MAC_SOURCE_IMAGE,**{key:'c'*64 for key in('producer','tools','graph','siso')}}
        root=work/'source';sidecar=root/'src/out'/('Release_GN_x64'if intel else'Release_GN_arm64')/m.SOURCE_METADATA_NAME
        policy='mac-intel'if intel else'mac-arm'
        value={'schemaVersion':2,'kind':'sorng-macintel-source-metadata'if intel else'sorng-macarm-source-metadata',
            'policy':m.MAC_INTEL_NEARBY_METADATA_POLICY if intel else m.MAC_ARM_NEARBY_METADATA_POLICY,
            'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,'identity':identity,
            'snapshot':{'entries':[],'rootMtimeNs':'1','gitHeads':{},'bytes':0,'literalLinks':m._mac_nearby_portable_declarations()}}
        return work,root,sidecar,identity,policy,value
    def test_pinned_native_evidence_distinguishes_raw_proof_from_zip_and_has_no_runtime_setter(self):
        self.assertIs(m.MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED,True)
        self.assertEqual(m.MAC_NEARBY_LITERAL_PROOF,(41359670492,13104029618,'0b12590921384faa4eef4a64a6c9c0cd5a699ead',2052,
            '6edf2afc493e35c5089ffa64c6686701e234323fe6e502a29a24644bb808ce33',827,
            '357439ca1b6cf013ed6e0f3aca0f773faa06bf5ffb6c90b33ee97c8fbc1e7c8d'))
    def test_actual_public_entry_mints_and_retires_only_registered_scope_for_both_policies_and_modes(self):
        with self.host():
            for intel in(False,True):
                work,root,sidecar,identity,policy,_=self.data(intel)
                for mode in m.SOURCE_IO_MODES:
                    observed=[]
                    def reached(selected,*args):
                        receipt=m._MAC_NEARBY_PUBLIC_SCOPE.get();observed.append(receipt)
                        self.assertIs(type(receipt),object)
                        self.assertIs(m._mac_nearby_scope_selection(root,identity,work,policy,selected),receipt)
                        return {'complete':True}
                    # The boundary under test ends at codec entry; never create
                    # the canonical production tree on this test machine.
                    with patch.object(m,'source_metadata_identity',return_value=work),patch.object(m,'_source_metadata_owned_codec',side_effect=reached):
                        self.assertTrue(m.source_metadata(mode,root,sidecar,identity,platform_policy=policy)['complete'])
                    self.assertEqual(len(observed),1)
                    self.assertNotIn(observed[0],m._MAC_NEARBY_PUBLIC_RECEIPTS)
                    with self.assertRaises(m.CheckpointError):m._mac_nearby_public_current(observed[0])
    def test_wrong_actual_host_facts_identity_namespace_paths_and_json_grants_deny_before_io(self):
        with self.host(),patch.object(m,'safe',side_effect=AssertionError('no path IO')),patch.object(m,'source_metadata_identity',side_effect=AssertionError('no identity IO')),patch.object(m,'_source_metadata_owned_codec',side_effect=AssertionError('no codec')):
            for intel in(False,True):
                _,root,sidecar,identity,policy,_=self.data(intel)
                for mode in m.SOURCE_IO_MODES:
                    for key in FACTS:
                        with patch.dict(os.environ,{key:'foreign'}),self.assertRaises(m.CheckpointError):
                            m.source_metadata(mode,root,sidecar,identity,platform_policy=policy)
                        missing=dict(FACTS);missing.pop(key)
                        with patch.dict(os.environ,missing,clear=True),self.assertRaises(m.CheckpointError):
                            m.source_metadata(mode,root,sidecar,identity,platform_policy=policy)
                    for key in('target','source','image','canonicalRoot','producer'):
                        with self.assertRaises(m.CheckpointError):m.source_metadata(mode,root,sidecar,{**identity,key:'foreign'},platform_policy=policy)
                    with self.assertRaises(m.CheckpointError):m.source_metadata(mode,root,sidecar,{**identity,'publicScope':True},platform_policy=policy)
                    for bad_root,bad_sidecar in((root/'other',sidecar),(root,sidecar.parent/'other'),(None,sidecar)):
                        with self.assertRaises(m.CheckpointError):m.source_metadata(mode,bad_root,bad_sidecar,identity,platform_policy=policy)
            self.assertFalse(m._MAC_NEARBY_PUBLIC_RECEIPTS)
    def test_forged_stale_cross_identity_and_cross_mode_scope_cannot_be_used(self):
        with self.host():
            work,root,sidecar,identity,policy,_=self.data()
            with m._mac_nearby_public_scope('source-record',root,sidecar,identity,policy):
                receipt=m._MAC_NEARBY_PUBLIC_SCOPE.get()
                for fake in(object(),{},True,'serialized-receipt'):
                    token=m._MAC_NEARBY_PUBLIC_SCOPE.set(fake)
                    try:
                        with self.assertRaises(m.CheckpointError):m._mac_nearby_public_current(fake)
                    finally:m._MAC_NEARBY_PUBLIC_SCOPE.reset(token)
                with self.assertRaises(m.CheckpointError):m._mac_nearby_scope_selection(root,{**identity,'source':'0'*64},work,policy,'source-record')
                with self.assertRaises(m.CheckpointError):m._mac_nearby_scope_selection(root,identity,work,policy,'source-verify')
            self.assertNotIn(receipt,m._MAC_NEARBY_PUBLIC_RECEIPTS)
    def test_both_actual_cli_host_gates_precede_any_manifest_or_source_path_io(self):
        with self.host(),patch.object(m,'safe',side_effect=AssertionError('no manifest or path IO')):
            for policy in('mac-arm','mac-intel'):
                for mode in m.SOURCE_IO_MODES:
                    argv=['archive',mode,'--input','not-read','--output','not-written','--manifest','not-read','--platform-policy',policy]
                    for key in FACTS:
                        with patch.dict(os.environ,{key:'foreign'}),patch.object(sys,'argv',argv):
                            with self.assertRaisesRegex(m.CheckpointError,'source-mac-host-scope'):m.main()
    def test_private_codec_and_direct_v1_writer_cannot_fall_back_in_canonical_namespace(self):
        with self.host(),patch.object(m,'safe',side_effect=AssertionError('no path IO')),patch.object(m,'source_io_call',side_effect=AssertionError('no writer IO')):
            for intel in(False,True):
                work,root,sidecar,identity,policy,value=self.data(intel)
                with self.assertRaisesRegex(m.CheckpointError,'source-mac-nearby-public-scope'):
                    m._source_metadata_owned_codec('source-record',root,sidecar,identity,work,m.Budget(5),policy)
                legacy={**value,'schemaVersion':1,'policy':m.MAC_INTEL_SOURCE_METADATA_POLICY if intel else m.MAC_SOURCE_METADATA_POLICY}
                with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):
                    m.metadata(sidecar.parent,sidecar.name,legacy,source=True,owned_sidecar=True)
    def test_legacy_fallback_denies_canonical_path_aliases_and_namespace_root_before_io(self):
        namespace='/Users/runner/work/_temp/sorng-cef-engineering'
        with self.host(),patch.object(m,'safe',side_effect=AssertionError('no path IO')),patch.object(m,'source_io_call',side_effect=AssertionError('no writer IO')):
            self.assertTrue(m._mac_nearby_legacy_private_namespace({'canonicalRoot':str(ROOT)}))
            for intel in(False,True):
                _,_,_,identity,policy,value=self.data(intel)
                canonical=identity['canonicalRoot']
                aliases=(canonical.replace('/_temp/','/_temp//'),'/'+canonical,
                    canonical.replace('/_temp/','/_temp/./'),canonical.replace('/_temp/','/_temp/ignored/../'),
                    namespace,namespace+'/',namespace+'//',namespace+'/a/..',canonical.casefold(),
                    canonical.replace('sorng-cef-engineering','SORNG-CEF-ENGINEERING'))
                for alias in aliases:
                    with self.subTest(alias=alias):
                        changed={**identity,'canonicalRoot':alias};work=Path(alias);root=work/'source'
                        sidecar=root/'src/out'/('Release_GN_x64'if intel else'Release_GN_arm64')/m.SOURCE_METADATA_NAME
                        with patch.object(m,'Path',PurePosixPath):
                            self.assertFalse(m._mac_nearby_legacy_private_namespace(changed))
                        self.assertTrue(m._mac_nearby_protected_namespace(changed))
                        with self.assertRaisesRegex(m.CheckpointError,'source-mac-nearby-public-scope'):
                            m._source_metadata_owned_codec('source-record',root,sidecar,changed,work,m.Budget(5),policy)
                        legacy={**value,'identity':changed,'schemaVersion':1,'policy':m.MAC_INTEL_SOURCE_METADATA_POLICY if intel else m.MAC_SOURCE_METADATA_POLICY}
                        with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):
                            m.metadata(sidecar.parent,sidecar.name,legacy,source=True,owned_sidecar=True)
    def test_schema1_role_spoof_cannot_write_protected_mac_namespace_and_ordinary_linux_stays_valid(self):
        with patch.object(m,'source_io_call',side_effect=AssertionError('WRITER_REACHED')):
            for intel in(False,True):
                _,_,_,identity,_,value=self.data(intel)
                for canonical in(identity['canonicalRoot'],identity['canonicalRoot'].replace('/_temp/','/_temp//'),identity['canonicalRoot'].casefold()):
                    for target in(identity['target'],'aarch64-unknown-linux-gnu'):
                        changed={**identity,'canonicalRoot':canonical,'target':target}
                        legacy={**value,'identity':changed,'schemaVersion':1,'kind':'sorng-linuxarm-source-metadata','policy':m.SOURCE_METADATA_POLICY}
                        output=Path(canonical)/'source/src/out/Release_GN_arm64'
                        with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):
                            m.metadata(output,m.SOURCE_METADATA_NAME,legacy,source=True,owned_sidecar=True)
            canonical='/home/runner/work/_temp/sorng-cef-engineering/aarch64-unknown-linux-gnu/'+'a'*64
            legacy={**value,'identity':{**identity,'canonicalRoot':canonical,'target':'aarch64-unknown-linux-gnu'},
                'schemaVersion':1,'kind':'sorng-linuxarm-source-metadata','policy':m.SOURCE_METADATA_POLICY}
            self.assertFalse(m._mac_nearby_protected_namespace(legacy['identity']))
            with self.assertRaisesRegex(AssertionError,'WRITER_REACHED'):
                m.metadata(Path(canonical)/'source/src/out/Release_GN_arm64',m.SOURCE_METADATA_NAME,legacy,source=True,owned_sidecar=True)
    def test_actual_codec_under_public_scope_selects_v2_and_denies_v1_before_snapshot_or_utime(self):
        with self.host():
            for intel in(False,True):
                work,root,sidecar,identity,policy,value=self.data(intel)
                legacy={**value,'schemaVersion':1,'policy':m.MAC_INTEL_SOURCE_METADATA_POLICY if intel else m.MAC_SOURCE_METADATA_POLICY}
                for mode in('source-apply','source-verify'):
                    with m._mac_nearby_public_scope(mode,root,sidecar,identity,policy),m.source_io_scope(mode),patch.object(m,'safe',side_effect=lambda p:p),patch.object(Path,'is_dir',return_value=True),patch.object(m,'source_read_sidecar',return_value=legacy),patch.object(m,'source_snapshot',side_effect=AssertionError('no snapshot after old schema')),patch.object(m.os,'utime',side_effect=AssertionError('no metadata write')):
                        with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-binding'):
                            m._source_metadata_owned_codec(mode,root,sidecar,identity,work,m.Budget(5),policy)
    def test_actual_codec_requires_all_literal_bindings_before_any_public_apply_write(self):
        with self.host():
            for intel in(False,True):
                work,root,sidecar,identity,policy,value=self.data(intel)
                changed=copy.deepcopy(value);changed['snapshot']['literalLinks'][0]['gitlinkCommit']='0'*40
                with m._mac_nearby_public_scope('source-apply',root,sidecar,identity,policy),m.source_io_scope('source-apply'),patch.object(m,'safe',side_effect=lambda p:p),patch.object(Path,'is_dir',return_value=True),patch.object(m,'source_read_sidecar',return_value=changed),patch.object(m,'source_snapshot',return_value=value['snapshot']),patch.object(m.os,'utime',side_effect=AssertionError('no metadata write')):
                    with self.assertRaisesRegex(m.CheckpointError,'source-nearby-binding'):
                        m._source_metadata_owned_codec('source-apply',root,sidecar,identity,work,m.Budget(5),policy)
    def test_schema2_writer_classifier_requires_registered_scope_role_and_exact_five_rows(self):
        with self.host(),patch.object(m,'safe',side_effect=lambda p:p),patch.object(Path,'lstat',return_value=SimpleNamespace(st_mode=0o40700,st_uid=0)),patch.object(os,'geteuid',return_value=0,create=True):
            for intel in(False,True):
                _,root,sidecar,identity,policy,value=self.data(intel)
                self.assertFalse(m._mac_nearby_scoped_writer_allowed(sidecar.parent,value))
                with m._mac_nearby_public_scope('source-record',root,sidecar,identity,policy),m.source_io_scope('source-record'):
                    m.SOURCE_IO_CONTEXT.set(('source-record',root))
                    self.assertTrue(m._mac_nearby_scoped_writer_allowed(sidecar.parent,value))
                    bad=copy.deepcopy(value);bad['snapshot']['literalLinks']=[]
                    with self.assertRaises(m.CheckpointError):m._mac_nearby_scoped_writer_allowed(sidecar.parent,bad)
                self.assertFalse(m._mac_nearby_scoped_writer_allowed(sidecar.parent,value))
    def test_twelve_native_qualified_filesystem_hash_and_timestamp_functions_are_byte_equivalent(self):
        # Raw source spans normalized only for CRLF, avoiding ast.dump version
        # differences between local Python3.12 and the pinned Darwin3.14.
        expected={
            'inventory':'5d48126efcd015f0a652872d4e9ca36beaf5895e68b8f75ddbfd7c27596172eb',
            'source_nearby_route':'f7237daefb76099145df97022599a506bc19eb06a96a8aea0ac6e9d8c37fd36b',
            'source_nearby_check':'2f0a91c7d7dabd9f3d2cd18f24cdd2001dc3f7d01705106456bf0e29e771df6d',
            'source_nearby_literal':'c85246648130a5d92f56675379ec7dde89eb129704c42d2cd0487df93e831bba',
            'source_nearby_literals':'47fc72667ad679d2b929bad16435bfbc53cf70de835fb852fbc7390bcb814c29',
            'source_local':'a7667b2ce5f3c409afee2dfc1a2991c6b3844e0a42ac937a513338da88adf2f9',
            'source_owned_mac_transition':'a417d33b9a3dd487e779515bc271e2df79db1655b528828f2d2a826bd23e1b98',
            'source_directory':'f65173f6d5b602b19cd9a07df0f63a904ef90b0a79ae1b40d7fe284395f34f78',
            'source_link_target':'e00b1b8bfe4687580fd324c8e90c09a9883d6b9ff6780449a7d007d2c9206935',
            'source_hash':'10d698d99fc7198033531fede6cfd1a99e25dc393a4b884b74ac1fc46601f047',
            'source_portable':'2c96d204f5b6e2e67bbf8a87547bfcdcde1ab0572c3dfef388f192c86077d8a7',
            'source_snapshot_inventory':'71924dd37f3c5c05e64d48f60ff02788b9e6d366abd3d2d23ba467cf0c2e0fff'}
        raw=FILE.read_text();body=ast.parse(raw)
        actual={node.name:hashlib.sha256(ast.get_source_segment(raw,node).encode()).hexdigest()
            for node in body.body if isinstance(node,ast.FunctionDef)and node.name in expected}
        self.assertEqual(actual,expected)


if __name__=='__main__':unittest.main(verbosity=2)
