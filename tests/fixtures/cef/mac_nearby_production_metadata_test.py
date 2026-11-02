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
        # Explicit legacy-v2 model: final production has the separate v3 gate.
        with patch.object(m,'MAC_CLANG_LITERAL_PRODUCTION_ADMITTED',False),patch.object(sys,'platform','darwin'),patch.object(m.platform,'machine',return_value='x86_64'),patch.dict(os.environ,FACTS,clear=True):yield
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
        raw=FILE.read_text()
        # Only the fixed post-CEF DEPS state is added; restore the complete
        # a41 diagnostic helper before all prior qualification inverses.
        self.assertEqual(len(raw.encode()),209272)
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),'1a8388c61458686cd1afccba934bfb2a2d5ccedde5de33d2b0fd0f70b9db85c8')
        deps_edits=(("     'Mac/clang-llvmorg-24-init-3796-g20e97c4b-2.tar.xz', 1786821111761283, 56450032,\n     'ec510fb1db5e96d127eaeb55ff61daf49d58647c653a65c6ffec42c0b59e3d84'),\n)\n# BEGIN REVIEWED MAC POST CEF DEPS STATES\n# CEF's fixed tarball_deps patch adds only source_tarball hook conditions.\n# These exact byte states bind the same source/HEAD/compiler tuple; no other\n# file growth, unknown hash or package version is admitted.\nMAC_CLANG_CEF_DEPS_PATCH = (\n    '682c378d70d5780061e96644dca16ddd8fd157a9', 'patch/patches/tarball_deps.patch', 1729,\n    '667211318898ef819f80a1c7addef90661a6f557a0de044c1e0e71d441174264')\nMAC_CLANG_CHROMIUM_DEPS_STATES = (\n    (197649,'cd59c0f5c31e1dbbc65b2db96bb11a18f7bdc91496fafb5b6a4e7f94d8ad797c'),\n    (197828,'bd17c48ed2810d17cd2f37af0875ec0eb260366aaef399c152eaf2eaecb9cc8b'),\n)\n# END REVIEWED MAC POST CEF DEPS STATES\n\nMAC_CLANG_RUNTIME_ALIASES = (\n    ('aarch64-cros-linux-gnu','aarch64-unknown-linux-gnu'),\n    ('armv7a-cros-linux-gnueabihf','armv7-unknown-linux-gnueabihf'),\n", "     'Mac/clang-llvmorg-24-init-3796-g20e97c4b-2.tar.xz', 1786821111761283, 56450032,\n     'ec510fb1db5e96d127eaeb55ff61daf49d58647c653a65c6ffec42c0b59e3d84'),\n)\nMAC_CLANG_RUNTIME_ALIASES = (\n    ('aarch64-cros-linux-gnu','aarch64-unknown-linux-gnu'),\n    ('armv7a-cros-linux-gnueabihf','armv7-unknown-linux-gnueabihf'),\n"), ("                p=safe(root/name);before=p.lstat()\n                require(stat.S_ISREG(before.st_mode) and before.st_uid==os.geteuid() and before.st_nlink==1,\n                        'source-clang-binding')\n                allowed=((size,expected_sha),)\n                if expected is None and name=='src/DEPS':\n                    require(allowed[0]==MAC_CLANG_CHROMIUM_DEPS_STATES[0], 'source-clang-binding')\n                    allowed=MAC_CLANG_CHROMIUM_DEPS_STATES\n                maximum=size if expected is not None else max(row[0]for row in allowed)\n                raw=source_read_bytes(p,budget,maximum)\n                require((raw==expected if expected is not None else\n                         (len(raw),hashlib.sha256(raw).hexdigest())in allowed), 'source-clang-binding')\n                identity=source_local(before,policy)\n                require(source_local(p.lstat(),policy)==identity, 'source-clang-changed')\n                state['headers'].append((p,raw,identity))\n", "                p=safe(root/name);before=p.lstat()\n                require(stat.S_ISREG(before.st_mode) and before.st_uid==os.geteuid() and before.st_nlink==1,\n                        'source-clang-binding')\n                raw=source_read_bytes(p,budget,size)\n                require((raw==expected if expected is not None else len(raw)==size and\n                        hashlib.sha256(raw).hexdigest()==expected_sha), 'source-clang-binding')\n                identity=source_local(before,policy)\n                require(source_local(p.lstat(),policy)==identity, 'source-clang-changed')\n                state['headers'].append((p,raw,identity))\n"))
        for current,previous in deps_edits:
            self.assertEqual(raw.count(current),1);raw=raw.replace(current,previous)
        # Remove only the reviewed read-bound diagnostic layer before the
        # complete public-v3/native-v3/old-v2 inverse retained below.
        self.assertEqual(len(raw.encode()),208244)
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),'a41a4d3f42a46801d5114a450eb28b3331a95548783502333eab39e10c730e64')
        diagnostic_edits=(("# Diagnostics from this exact failed read, never path/clock or filesystem authority.\ndef source_metadata_read_value(value, mode):\n    fields = {'mode','stage','phase','predicate','size','nlink','kind','maximum','readBytes'}\n    require(type(value) is dict and set(value) in (fields, fields | {'candidate'}) and\n            value['mode'] == mode and mode in SOURCE_IO_MODES and value['stage'] in ('stat','stream') and\n            value['phase'] in SOURCE_PHASES and value['predicate'] in ('kind','nlink','empty','size','growth') and\n            value['kind'] in ('regular','directory','symlink','other') and\n            all(type(value[key]) is int and 0 <= value[key] <= 2**53-1 for key in ('size','nlink')) and\n            type(value['maximum']) is int and 0 < value['maximum'] <= SOURCE_METADATA_MAX_BYTES, 'diagnostic')\n    if value['stage'] == 'stat':\n        expected = ('kind' if value['kind'] != 'regular' else 'nlink' if value['nlink'] != 1 else\n                    'empty' if value['size'] == 0 else 'size' if value['size'] > value['maximum'] else None)\n        require(value['readBytes'] is None and value['predicate'] == expected, 'diagnostic')\n    else:\n        require(value['predicate'] == 'growth' and value['kind'] == 'regular' and value['nlink'] == 1 and\n                0 < value['size'] <= value['maximum'] and type(value['readBytes']) is int and\n                value['size'] < value['readBytes'] <= value['size'] + 65536, 'diagnostic')\n    if 'candidate' in value:\n        item = value['candidate']\n        require(type(item) is dict and set(item) in ({'bytes','sha256'},{'bytes','sha256','name'}) and\n                type(item['bytes']) is int and 0 < item['bytes'] <= 4*1024**2 and\n                isinstance(item['sha256'],str) and re.fullmatch(r'[a-f0-9]{64}',item['sha256']) is not None and\n                ('name' not in item or source_path_name(item['name']) and len(item['name'].encode()) == item['bytes'] and\n                 hashlib.sha256(item['name'].encode()).hexdigest() == item['sha256']), 'diagnostic')\n    require(len(json.dumps(value).encode()) <= 2048, 'diagnostic')\n    return dict(value)\n\n\ndef source_metadata_read_record(error, path, before, maximum, stage, count=None):\n    try:\n        context = SOURCE_IO_CONTEXT.get()\n        if (type(error) is not CheckpointError or str(error) != 'source-metadata-read-bound' or\n                type(context) is not tuple or len(context) != 2 or context[0] not in SOURCE_IO_MODES):\n            return\n        if 'sourceMetadataReadFailure' in error.__dict__ or error.__dict__.get('sourceMetadataReadFailureInvalid') is True:\n            return\n        kind = ('regular' if stat.S_ISREG(before.st_mode) else 'directory' if stat.S_ISDIR(before.st_mode) else\n                'symlink' if stat.S_ISLNK(before.st_mode) else 'other')\n        predicate = ('growth' if stage == 'stream' else 'kind' if kind != 'regular' else\n                     'nlink' if before.st_nlink != 1 else 'empty' if before.st_size == 0 else 'size')\n        value = {'mode':context[0], 'stage':stage, 'phase':SOURCE_PROGRESS['phase'] if SOURCE_PROGRESS is not None else 'start',\n                 'predicate':predicate, 'size':before.st_size, 'nlink':before.st_nlink, 'kind':kind,\n                 'maximum':maximum, 'readBytes':count}\n        if context[1] is not None:\n            try:\n                name = Path(path).relative_to(context[1]).as_posix()\n            except ValueError:\n                name = '.'\n            if name != '.':\n                require(all(part not in ('','.','..') for part in name.split('/')), 'diagnostic')\n                raw = name.encode()\n                value['candidate'] = {'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest(),\n                                      **({'name':name} if source_path_name(name) else {})}\n        error.sourceMetadataReadFailure = source_metadata_read_value(value, context[0])\n    except BaseException:\n        try:\n            error.sourceMetadataReadFailureInvalid = True\n        except BaseException:\n            pass\n\n\ndef source_metadata_read_failure_fields(error, mode):\n    if mode not in SOURCE_IO_MODES or type(error) is not CheckpointError or str(error) != 'source-metadata-read-bound':\n        return {}\n    try:\n        if error.__dict__.get('sourceMetadataReadFailureInvalid') is True:\n            return {'sourceMetadataReadFailureInvalid':True}\n        value = error.__dict__.get('sourceMetadataReadFailure')\n        return {} if value is None else {'sourceMetadataReadFailure':source_metadata_read_value(value, mode)}\n    except BaseException:\n        return {'sourceMetadataReadFailureInvalid':True}\n\n\n", ''), ("def source_read_bytes(path, budget, maximum):\n    path = source_io_call('file-path-stat', path, lambda: safe(path));before = source_io_call('file-path-stat', path, path.stat)\n    try:\n        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,\n                'source-metadata-read-bound')\n    except CheckpointError as error:\n        source_metadata_read_record(error, path, before, maximum, 'stat')\n        raise\n    stream = source_io_call('file-open', path, lambda: path.open('rb'));primary = None;parts = [];count = 0\n    try:\n        fd_before = source_io_call('file-fd-stat', path, lambda: os.fstat(stream.fileno()))\n        require(stamp(fd_before)==stamp(before) and fd_before.st_ctime_ns==before.st_ctime_ns,\n                'source-metadata-read-changed')\n        while True:\n            budget.check();chunk=source_io_call('file-read', path, lambda: stream.read(65536))\n            if not chunk:\n                break\n            count+=len(chunk)\n            try:\n                require(count<=before.st_size, 'source-metadata-read-bound')\n            except CheckpointError as error:\n                source_metadata_read_record(error, path, before, maximum, 'stream', count)\n                raise\n            parts.append(chunk)\n        after=source_io_call('file-path-stat', path, path.stat);held=source_io_call('file-fd-stat', path, lambda: os.fstat(stream.fileno()))\n        require(count==before.st_size and stamp(after)==stamp(before)==stamp(held) and\n                after.st_ctime_ns==before.st_ctime_ns==held.st_ctime_ns, 'source-metadata-read-changed')\n    except BaseException as error:\n        primary=error\n        raise\n    finally:\n        source_close(lambda: source_io_call('file-close', path, stream.close), primary)\n    return b''.join(parts)", "def source_read_bytes(path, budget, maximum):\n    path = source_io_call('file-path-stat', path, lambda: safe(path));before = source_io_call('file-path-stat', path, path.stat)\n    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,\n            'source-metadata-read-bound')\n    stream = source_io_call('file-open', path, lambda: path.open('rb'));primary = None;parts = [];count = 0\n    try:\n        fd_before = source_io_call('file-fd-stat', path, lambda: os.fstat(stream.fileno()))\n        require(stamp(fd_before)==stamp(before) and fd_before.st_ctime_ns==before.st_ctime_ns,\n                'source-metadata-read-changed')\n        while True:\n            budget.check();chunk=source_io_call('file-read', path, lambda: stream.read(65536))\n            if not chunk:\n                break\n            count+=len(chunk);require(count<=before.st_size, 'source-metadata-read-bound');parts.append(chunk)\n        after=source_io_call('file-path-stat', path, path.stat);held=source_io_call('file-fd-stat', path, lambda: os.fstat(stream.fileno()))\n        require(count==before.st_size and stamp(after)==stamp(before)==stamp(held) and\n                after.st_ctime_ns==before.st_ctime_ns==held.st_ctime_ns, 'source-metadata-read-changed')\n    except BaseException as error:\n        primary=error\n        raise\n    finally:\n        source_close(lambda: source_io_call('file-close', path, stream.close), primary)\n    return b''.join(parts)"), ('**source_metadata_read_failure_fields(error, CLI_SOURCE_MODE), ', ''))
        for current,previous in diagnostic_edits:
            self.assertEqual(raw.count(current),1);raw=raw.replace(current,previous)
        self.assertEqual(len(raw.encode()),203191)
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),'3be8d4b159293e677d0d49ce7b6f09f661363481db655f936e436f694a9ef8b8')
        # Layer one removes only the reviewed public operation and its exact
        # call-site substitutions, recovering the COMPLETE native-qualified
        # 1c34 helper. Layer two below restores the original 0b/839 spans.
        start='# BEGIN MAC CLANG PUBLIC OPERATION\n';end='# END MAC CLANG PUBLIC OPERATION'
        self.assertEqual(raw.count(start),1);self.assertEqual(raw.count(end),1)
        first=raw.index(start);last=raw.index(end,first)+len(end);block=raw[first:last]
        self.assertEqual(hashlib.sha256(block.encode()).hexdigest(),'29ae728b93a68805046d941a07cbbd8e794fe77f95e1260b005678d01895b9cd')
        self.assertEqual(raw.count(block+'\n\n\n'),1);raw=raw.replace(block+'\n\n\n','')
        public_edits=(("    # All admission checks are pure and precede safe(), manifests or source IO.\n    require(MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is not True, 'source-mac-clang-public-scope')\n    require(MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED is True and mode in SOURCE_IO_MODES and\n", '    # All admission checks are pure and precede safe(), manifests or source IO.\n    require(MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED is True and mode in SOURCE_IO_MODES and\n'), ('def _mac_nearby_scope_selection(root,identity,work,platform_policy,mode=None):\n    if _MAC_CLANG_PROOF_SCOPE.get() is not None or _MAC_CLANG_PUBLIC_SCOPE.get() is not None:\n        return _mac_clang_scope_selection(root,identity,work,platform_policy,mode)\n', 'def _mac_nearby_scope_selection(root,identity,work,platform_policy,mode=None):\n    if _MAC_CLANG_PROOF_SCOPE.get() is not None:\n        return _mac_clang_scope_selection(root,identity,work,platform_policy,mode)\n'), ("# public selection are unchanged; neither JSON nor the new policy grants v3.\nMAC_CLANG_LITERAL_PRODUCTION_ADMITTED = True\nMAC_CLANG_LITERAL_POLICY = 'sorng-mac-pinned-clang-runtime-literals-v1'\n", "# public selection are unchanged; neither JSON nor the new policy grants v3.\nMAC_CLANG_LITERAL_PRODUCTION_ADMITTED = False\nMAC_CLANG_LITERAL_POLICY = 'sorng-mac-pinned-clang-runtime-literals-v1'\n"), ("def _mac_clang_scope_selection(root,identity,work,platform_policy,mode=None):\n    public=_MAC_CLANG_PUBLIC_SCOPE.get()\n    if public is not None:\n        selected,source,_,bound,canonical,policy=_mac_clang_public_current(public)\n        require(Path(root)==source and Path(work)==canonical and type(identity)is dict and\n                tuple(sorted(identity.items()))==bound and platform_policy==policy and\n                (mode is None or mode==selected), 'source-mac-clang-public-scope')\n        return public\n    receipt=_MAC_CLANG_PROOF_SCOPE.get()\n", 'def _mac_clang_scope_selection(root,identity,work,platform_policy,mode=None):\n    receipt=_MAC_CLANG_PROOF_SCOPE.get()\n'), ("def _mac_clang_scoped_writer_allowed(root,value):\n    if _MAC_CLANG_PROOF_SCOPE.get()is None and _MAC_CLANG_PUBLIC_SCOPE.get()is None:return False\n    identity=value['identity'];intel=identity.get('target')=='x86_64-apple-darwin'\n", "def _mac_clang_scoped_writer_allowed(root,value):\n    if _MAC_CLANG_PROOF_SCOPE.get()is None:return False\n    identity=value['identity'];intel=identity.get('target')=='x86_64-apple-darwin'\n"), ("            SOURCE_IO_CONTEXT.get()==('source-record',work/'source'), 'source-sidecar-role')\n    safe(Path(root));current=Path(root)\n    proof_root=work if receipt is _MAC_CLANG_PUBLIC_SCOPE.get()else _mac_clang_owned_proof_path(receipt)\n    while current!=proof_root:\n", "            SOURCE_IO_CONTEXT.get()==('source-record',work/'source'), 'source-sidecar-role')\n    safe(Path(root));current=Path(root);proof_root=_mac_clang_owned_proof_path(receipt)\n    while current!=proof_root:\n"), ("def _mac_clang_writer_namespace(root,identity):\n    if MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is True and (\n            _mac_nearby_protected_namespace(identity) or\n            _mac_nearby_protected_namespace({'canonicalRoot':str(root)})):return True\n    receipt=_MAC_CLANG_PROOF_SCOPE.get()\n", 'def _mac_clang_writer_namespace(root,identity):\n    receipt=_MAC_CLANG_PROOF_SCOPE.get()\n'), ("    if platform_policy in ('mac-arm','mac-intel'):\n        operation=_mac_clang_public_scope if MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is True else _mac_nearby_public_scope\n        with operation(mode,root,sidecar,identity,platform_policy):\n            work = source_metadata_identity(identity, platform_policy)\n", "    if platform_policy in ('mac-arm','mac-intel'):\n        with _mac_nearby_public_scope(mode,root,sidecar,identity,platform_policy):\n            work = source_metadata_identity(identity, platform_policy)\n"), ("    compiler_scope = _mac_clang_scope_selection(root,identity,work,platform_policy,mode) if mac else None\n    if MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is True and (\n            _mac_nearby_protected_namespace(identity) or\n            _mac_nearby_protected_namespace({'canonicalRoot':str(root)})):\n        require(compiler_scope is not None and compiler_scope is _MAC_CLANG_PUBLIC_SCOPE.get(),\n                'source-mac-clang-public-scope')\n    nearby_mac = nearby_scope is not None\n", '    compiler_scope = _mac_clang_scope_selection(root,identity,work,platform_policy,mode) if mac else None\n    nearby_mac = nearby_scope is not None\n'))
        self.assertEqual(len(public_edits),9)
        for current,previous in public_edits:
            self.assertEqual(raw.count(current),1);raw=raw.replace(current,previous)
        self.assertEqual(len(raw.encode()),198811)
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),'5af4cb39c9c15e6d115eeca3a6bf4d893bf45af43595a5e65a34c4d114973d79')
        # Preserve the old 0b-qualified v2 spans. Only these two hash-pinned
        # inactive blocks and thirteen exact caller/schema substitutions are
        # normalized; this does not qualify the v3 branch as native evidence.
        blocks=(('# BEGIN INACTIVE MAC CLANG PROOF SCOPE\n', '# END INACTIVE MAC CLANG PROOF SCOPE', '46d7458d9205a3e4d750ceaf542dbe6e1021192bcb0fd97c484330ebd3e194d8'), ('# BEGIN INACTIVE MAC CLANG LITERAL INSPECTORS\n', '# END INACTIVE MAC CLANG LITERAL INSPECTORS', '59ff65017aa5bce71af31fe43fb1764006a0ec4607583af7d81ad98f22f61d80'))
        for start,end,expected_sha in blocks:
            self.assertEqual(raw.count(start),1);self.assertEqual(raw.count(end),1)
            first=raw.index(start);last=raw.index(end,first)+len(end);block=raw[first:last]
            self.assertEqual(hashlib.sha256(block.encode()).hexdigest(),expected_sha)
            self.assertEqual(raw.count(block+'\n\n\n'),1);raw=raw.replace(block+'\n\n\n','')
        edits=(
            ("                        require(isinstance(target,str) and 0 < len(target.encode()) <= 4096 and not any(ord(c)<32 for c in target), 'source-link')\n                        if not external:\n                            if not (source_nearby_literal(source_policy,name,target,s) or\n                                    source_clang_literal(source_policy,name,target,s)):\n                                source_link_target(root, p, target, budget)\n                        row = {'path':name,'kind':'symlink','stamp':stamp(s),'target':target,'ctimeNs':s.st_ctime_ns}\n","                        require(isinstance(target,str) and 0 < len(target.encode()) <= 4096 and not any(ord(c)<32 for c in target), 'source-link')\n                        if not external:\n                            if not source_nearby_literal(source_policy,name,target,s):\n                                source_link_target(root, p, target, budget)\n                        row = {'path':name,'kind':'symlink','stamp':stamp(s),'target':target,'ctimeNs':s.st_ctime_ns}\n"),
            ("    if source_policy is not None:\n        literal_bytes = len(json.dumps(source_policy['_nearby_literals']['portable'],sort_keys=True,separators=(',',':')).encode()) if source_policy.get('_nearby_literals') is not None else (2 if not source_policy.get('external') and not source_policy.get('mac') else 0)\n        if source_policy.get('_clang_literals')is not None:\n            literal_bytes+=len(json.dumps(source_policy['_clang_literals']['portable'],sort_keys=True,separators=(',',':')).encode())\n        source_metadata_precharge(sum(len(r['path'].encode()) + len(r.get('target','').encode()) + 320 for r in rows) + literal_bytes,\n                                  owned_source=source_policy.get('external') is not True)\n","    if source_policy is not None:\n        literal_bytes = len(json.dumps(source_policy['_nearby_literals']['portable'],sort_keys=True,separators=(',',':')).encode()) if source_policy.get('_nearby_literals') is not None else (2 if not source_policy.get('external') and not source_policy.get('mac') else 0)\n        source_metadata_precharge(sum(len(r['path'].encode()) + len(r.get('target','').encode()) + 320 for r in rows) + literal_bytes,\n                                  owned_source=source_policy.get('external') is not True)\n"),
            ('\ndef _mac_nearby_scope_selection(root,identity,work,platform_policy,mode=None):\n    if _MAC_CLANG_PROOF_SCOPE.get() is not None:\n        return _mac_clang_scope_selection(root,identity,work,platform_policy,mode)\n    public=_MAC_NEARBY_PUBLIC_SCOPE.get()\n    if public is not None:\n','\ndef _mac_nearby_scope_selection(root,identity,work,platform_policy,mode=None):\n    public=_MAC_NEARBY_PUBLIC_SCOPE.get()\n    if public is not None:\n'),
            ("        require(source is True and name == SOURCE_METADATA_NAME and type(value) is dict and\n                set(value) == {'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'} and\n                type(value['schemaVersion']) is int and value['schemaVersion'] in (1,2,3) and\n                value['sourceDateEpoch'] == SOURCE_METADATA_DATE_EPOCH and type(value['identity']) is dict and\n                isinstance(value['identity'].get('canonicalRoot'), str) and type(value['snapshot']) is dict and\n                not (value['schemaVersion']==1 and _mac_nearby_protected_namespace(value['identity'])) and\n                not (value['schemaVersion']!=3 and _mac_clang_writer_namespace(root,value['identity'])) and\n                ((value['schemaVersion']==3 and _mac_clang_scoped_writer_allowed(root,value)) or\n                 (value['schemaVersion']==2 and _mac_nearby_scoped_writer_allowed(root,value)) or\n                 (value['schemaVersion']==1 and ((value['kind'] == 'sorng-linuxarm-source-metadata' and value['policy'] == SOURCE_METADATA_POLICY and\n                  Path(root) == Path(value['identity']['canonicalRoot']) / 'source/src/out/Release_GN_arm64') or\n","        require(source is True and name == SOURCE_METADATA_NAME and type(value) is dict and\n                set(value) == {'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'} and\n                type(value['schemaVersion']) is int and value['schemaVersion'] in (1,2) and\n                value['sourceDateEpoch'] == SOURCE_METADATA_DATE_EPOCH and type(value['identity']) is dict and\n                isinstance(value['identity'].get('canonicalRoot'), str) and type(value['snapshot']) is dict and\n                not (value['schemaVersion']==1 and _mac_nearby_protected_namespace(value['identity'])) and\n                ((value['schemaVersion']==2 and _mac_nearby_scoped_writer_allowed(root,value)) or\n                 (value['schemaVersion']==1 and ((value['kind'] == 'sorng-linuxarm-source-metadata' and value['policy'] == SOURCE_METADATA_POLICY and\n                  Path(root) == Path(value['identity']['canonicalRoot']) / 'source/src/out/Release_GN_arm64') or\n"),
            ("    require(owner in (0, os.geteuid()) if external else owner == os.geteuid(), 'source-owner')\n    policy = dict(context) if external else {**source_repositories(root, budget), **(context or {})}\n    with source_metadata_literals(root,policy,budget) as (literals,compiler):\n        policy['_nearby_literals']=literals\n        policy['_clang_literals']=compiler\n        return source_snapshot_inventory(root,budget,guards,policy,external,member_policy=member_policy,reuse=reuse,layout=layout)\n\n","    require(owner in (0, os.geteuid()) if external else owner == os.geteuid(), 'source-owner')\n    policy = dict(context) if external else {**source_repositories(root, budget), **(context or {})}\n    with source_nearby_literals(root,policy,budget) as literals:\n        policy['_nearby_literals']=literals\n        return source_snapshot_inventory(root,budget,guards,policy,external,member_policy=member_policy,reuse=reuse,layout=layout)\n\n"),
            ("    if not external and (not policy.get('mac') or _mac_nearby_policy_owned(policy)):\n        value['literalLinks'] = policy['_nearby_literals']['portable'] if policy['_nearby_literals'] is not None else []\n    if not external and _mac_clang_policy_owned(policy):\n        value['compilerLiteralLinks']=policy['_clang_literals']['portable']\n    if external:\n        value['root'] = {'mode':root_before[4], 'mtimeNs':str(root_before[1]), 'uid':root.stat().st_uid,\n","    if not external and (not policy.get('mac') or _mac_nearby_policy_owned(policy)):\n        value['literalLinks'] = policy['_nearby_literals']['portable'] if policy['_nearby_literals'] is not None else []\n    if external:\n        value['root'] = {'mode':root_before[4], 'mtimeNs':str(root_before[1]), 'uid':root.stat().st_uid,\n"),
            ("    snapshot_context = {'mac':True, 'ownedMacIntel' if intel else 'ownedMacArm':True} if mac else None\n    nearby_scope = _mac_nearby_scope_selection(root,identity,work,platform_policy,mode) if mac else None\n    compiler_scope = _mac_clang_scope_selection(root,identity,work,platform_policy,mode) if mac else None\n    nearby_mac = nearby_scope is not None\n    if mac and not nearby_mac:\n        require(_mac_nearby_legacy_private_namespace(identity), 'source-mac-nearby-public-scope')\n    schema_version = 3 if compiler_scope is not None else 2 if nearby_mac else 1\n    if nearby_mac:\n        sidecar_policy = MAC_INTEL_NEARBY_METADATA_POLICY if intel else MAC_ARM_NEARBY_METADATA_POLICY\n","    snapshot_context = {'mac':True, 'ownedMacIntel' if intel else 'ownedMacArm':True} if mac else None\n    nearby_scope = _mac_nearby_scope_selection(root,identity,work,platform_policy,mode) if mac else None\n    nearby_mac = nearby_scope is not None\n    if mac and not nearby_mac:\n        require(_mac_nearby_legacy_private_namespace(identity), 'source-mac-nearby-public-scope')\n    schema_version = 2 if nearby_mac else 1\n    if nearby_mac:\n        sidecar_policy = MAC_INTEL_NEARBY_METADATA_POLICY if intel else MAC_ARM_NEARBY_METADATA_POLICY\n"),
            ('            _macNearbyReceipt=nearby_scope,_macNearbyIdentity=dict(identity),\n            _macNearbyRoot=Path(root),_macNearbyPlatform=platform_policy,_macNearbyMode=mode)\n    if compiler_scope is not None:\n        sidecar_policy=MAC_INTEL_CLANG_METADATA_POLICY if intel else MAC_ARM_CLANG_METADATA_POLICY\n        snapshot_context.update(clangLiteralPolicy=MAC_CLANG_LITERAL_POLICY,\n            _macClangReceipt=compiler_scope,_macClangIdentity=dict(identity),\n            _macClangRoot=Path(root),_macClangPlatform=platform_policy,_macClangMode=mode)\n    budget.check()\n    root = safe(root);sidecar = Path(sidecar)\n','            _macNearbyReceipt=nearby_scope,_macNearbyIdentity=dict(identity),\n            _macNearbyRoot=Path(root),_macNearbyPlatform=platform_policy,_macNearbyMode=mode)\n    budget.check()\n    root = safe(root);sidecar = Path(sidecar)\n'),
            ("        return result\n    if mode == 'source-record':\n        with source_metadata_literals(root,{**source_repositories(root,budget), **(snapshot_context or {})},budget) as (record_literals,record_compiler):\n            layout = {}\n            current = source_snapshot(root, budget, guards, context=snapshot_context) if mac else source_snapshot(root, budget, guards, layout=layout)\n","        return result\n    if mode == 'source-record':\n        with source_nearby_literals(root,{**source_repositories(root,budget), **(snapshot_context or {})},budget) as record_literals:\n            layout = {}\n            current = source_snapshot(root, budget, guards, context=snapshot_context) if mac else source_snapshot(root, budget, guards, layout=layout)\n"),
            ("            require(source_io_call('sidecar-readback', sidecar, lambda: source_read_sidecar(sidecar, budget, owned_sidecar=True)) == value, 'source-sidecar-readback')\n            source_phase('record-literals')\n            with source_metadata_literals(root,{**source_repositories(root,budget), **(snapshot_context or {})},budget) as (literals,compiler):\n                require((mac and not nearby_mac) or (literals['portable'] if literals is not None else [])==current['literalLinks'], 'source-nearby-binding')\n                require(compiler_scope is None or compiler['portable']==current['compilerLiteralLinks'], 'source-clang-binding')\n            if linux:\n                source_phase('stat-cache-write')\n","            require(source_io_call('sidecar-readback', sidecar, lambda: source_read_sidecar(sidecar, budget, owned_sidecar=True)) == value, 'source-sidecar-readback')\n            source_phase('record-literals')\n            with source_nearby_literals(root,{**source_repositories(root,budget), **(snapshot_context or {})},budget) as literals:\n                require((mac and not nearby_mac) or (literals['portable'] if literals is not None else [])==current['literalLinks'], 'source-nearby-binding')\n            if linux:\n                source_phase('stat-cache-write')\n"),
            ("            'source-sidecar-binding')\n    expected = stored['snapshot']\n    expected_fields={'entries','rootMtimeNs','gitHeads','bytes'} if mac and not nearby_mac else {'entries','rootMtimeNs','gitHeads','bytes','literalLinks'}\n    if compiler_scope is not None:expected_fields.add('compilerLiteralLinks')\n    require(isinstance(expected, dict) and set(expected) == expected_fields and\n            isinstance(expected['entries'], list) and len(expected['entries']) <= SOURCE_MAX_ENTRIES,\n            'source-sidecar-shape')\n","            'source-sidecar-binding')\n    expected = stored['snapshot']\n    require(isinstance(expected, dict) and set(expected) == ({'entries','rootMtimeNs','gitHeads','bytes'} if mac and not nearby_mac else {'entries','rootMtimeNs','gitHeads','bytes','literalLinks'}) and\n            isinstance(expected['entries'], list) and len(expected['entries']) <= SOURCE_MAX_ENTRIES,\n            'source-sidecar-shape')\n"),
            ("            'source-repository-or-total-changed')\n    require((mac and not nearby_mac) or expected['literalLinks'] == current['literalLinks'], 'source-nearby-binding')\n    require(compiler_scope is None or expected['compilerLiteralLinks']==current['compilerLiteralLinks'], 'source-clang-binding')\n    # Compare the entire freshly hashed namespace before the first metadata write.\n    without_time = lambda rows: [{k:v for k,v in row.items() if k != 'mtimeNs'} for row in rows]\n","            'source-repository-or-total-changed')\n    require((mac and not nearby_mac) or expected['literalLinks'] == current['literalLinks'], 'source-nearby-binding')\n    # Compare the entire freshly hashed namespace before the first metadata write.\n    without_time = lambda rows: [{k:v for k,v in row.items() if k != 'mtimeNs'} for row in rows]\n"),
            ("        source_phase('apply-literals')\n        # Revalidate the fixed absence witnesses immediately before any utime.\n        with source_metadata_literals(root,{**source_repositories(root,budget), **(snapshot_context or {})},budget) as (literals,compiler):\n            require((mac and not nearby_mac) or (literals['portable'] if literals is not None else []) == expected['literalLinks'], 'source-nearby-binding')\n            require(compiler_scope is None or compiler['portable']==expected['compilerLiteralLinks'], 'source-clang-binding')\n        source_phase('apply-utime')\n        for row in sorted(expected['entries'], key=lambda r:r['path'].count('/'), reverse=True):\n","        source_phase('apply-literals')\n        # Revalidate the fixed absence witnesses immediately before any utime.\n        with source_nearby_literals(root,{**source_repositories(root,budget), **(snapshot_context or {})},budget) as literals:\n            require((mac and not nearby_mac) or (literals['portable'] if literals is not None else []) == expected['literalLinks'], 'source-nearby-binding')\n        source_phase('apply-utime')\n        for row in sorted(expected['entries'], key=lambda r:r['path'].count('/'), reverse=True):\n"),
        )
        self.assertEqual(len(edits),13)
        for current,previous in edits:
            self.assertEqual(raw.count(current),1);raw=raw.replace(current,previous)
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),'839ed8a3be5f81dd7778bf7fb4d76209d7e64342ec9387dc323d5c280098165d')
        body=ast.parse(raw)
        actual={node.name:hashlib.sha256(ast.get_source_segment(raw,node).encode()).hexdigest()
            for node in body.body if isinstance(node,ast.FunctionDef)and node.name in expected}
        self.assertEqual(actual,expected)


if __name__=='__main__':unittest.main(verbosity=2)
