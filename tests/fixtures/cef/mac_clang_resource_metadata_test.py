"""Inactive v3 codec tests. POSIX Linux is real; Darwin host/birth facts are models."""
import ast
import copy
from contextlib import contextmanager, ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('clang_resource_codec',ROOT/'scripts/lib/cef-checkpoint-archive.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
BRANCH='refs/heads/codex/mac-clang-resource-metadata-20261102'


def put(root,name,raw):
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);return p


def source_fixture(work,intel=False,linux=False):
    root=work/'source';root.mkdir(parents=True)
    out=root/'src/out'/('Release_GN_x64'if intel else'Release_GN_arm64');out.mkdir(parents=True)
    (root/'acquisition-logs').mkdir()
    repositories=['src','src/cef','depot_tools',m.MAC_CLANG_SOURCE_ROWS[1][1]]
    if not linux:repositories.append(m.NEARBY_ROOT)
    put(root,'.gclient_entries',('entries = '+repr({name:'https://public.example/'+str(i)for i,name in enumerate(repositories)if name!='depot_tools'})+'\n').encode())
    for repository in repositories:put(root,repository+'/.git/HEAD',b'a'*40+b'\n')
    for row,fixture in zip(m.MAC_CLANG_SOURCE_ROWS,['mac_clang_chromium.DEPS','mac_clang_openscreen.DEPS']):
        prefix,repository,head,deps,size,sha,*_=row
        put(root,repository+'/.git/HEAD',(head+'\n').encode())
        raw=Path(__file__).with_name(fixture).read_bytes()
        assert len(raw)==size and hashlib.sha256(raw).hexdigest()==sha
        put(root,deps,raw)
        parent=root/prefix/'lib/clang/24/lib';parent.mkdir(parents=True)
        for origin,target in m.MAC_CLANG_RUNTIME_ALIASES:
            if linux:(parent/target).mkdir()
            os.symlink(target,parent/origin)
    if not linux:
        put(root,m.NEARBY_ROOT+'/.git/HEAD',(m.NEARBY_HEAD+'\n').encode())
        put(root,m.NEARBY_ROOT+'/.gitmodules',Path(__file__).with_name('mac_nearby.gitmodules').read_bytes())
        for origin,target,gitlink,_,_ in m.NEARBY_LITERAL_LINKS:
            (root/m.NEARBY_ROOT/gitlink).mkdir(parents=True,exist_ok=True)
            link=root/m.NEARBY_ROOT/origin;link.parent.mkdir(parents=True,exist_ok=True);os.symlink(target,link)
    put(root,'src/input.cc',b'fixed owned clang resource input\n')
    os.symlink('input.cc',root/'src/input-link')
    identity={key:hashlib.sha256(('synthetic-clang-proof-'+key).encode()).hexdigest()for key in('producer','tools','graph','siso')}
    identity.update(target='aarch64-unknown-linux-gnu'if linux else'x86_64-apple-darwin'if intel else'aarch64-apple-darwin',
        source='1'*64 if linux else m.MAC_INTEL_SOURCE if intel else m.MAC_SOURCE,
        canonicalRoot=str(work),image='20261026.354.1'if linux else m.MAC_SOURCE_IMAGE)
    return root,out/m.SOURCE_METADATA_NAME,identity


class FixedDeclarations(unittest.TestCase):
    def test_real_primary_deps_bytes_and_host_selected_archive_pins(self):
        for row,fixture in zip(m.MAC_CLANG_SOURCE_ROWS,['mac_clang_chromium.DEPS','mac_clang_openscreen.DEPS']):
            _,_,_,_,size,sha,package,generation,archive_bytes,archive_sha=row
            raw=Path(__file__).with_name(fixture).read_bytes()
            self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(size,sha))
            matches=[]
            for node in ast.walk(ast.parse(raw)):
                if type(node)is not ast.Dict:continue
                values={k.value:v for k,v in zip(node.keys,node.values)if type(k)is ast.Constant and type(k.value)is str}
                name=values.get('object_name')
                if type(name)is ast.Constant and name.value==package:
                    matches.append({key:ast.literal_eval(values[key])for key in('sha256sum','size_bytes','generation','condition')})
            self.assertEqual(matches,[{'sha256sum':archive_sha,'size_bytes':archive_bytes,'generation':generation,
                'condition':'host_os == "mac" and host_cpu == "x64"'}])
    def test_exact_six_compiler_rows_do_not_change_old_nearby_five(self):
        rows=m._mac_clang_portable_declarations()
        self.assertEqual(len(rows),6);self.assertEqual(len({r['origin']for r in rows}),6)
        for row in rows:
            self.assertEqual(row['rawTargetSha256'],hashlib.sha256(row['rawTarget'].encode()).hexdigest())
            self.assertEqual(row['targetState'],'absent')
        self.assertEqual(len(m._mac_nearby_portable_declarations()),5)
        self.assertEqual(m.MAC_NEARBY_LITERAL_PROOF[2],'0b12590921384faa4eef4a64a6c9c0cd5a699ead')
        self.assertIs(m.MAC_CLANG_LITERAL_PRODUCTION_ADMITTED,False)
    def test_unbranded_context_is_not_a_literal_exception_on_any_path(self):
        for policy in ({},{'mac':False},{'mac':True,'ownedMacArm':True,'clangLiteralPolicy':m.MAC_CLANG_LITERAL_POLICY}):
            with patch.object(m,'safe',side_effect=AssertionError('no filesystem')):
                self.assertFalse(m.source_clang_literal(policy,m._mac_clang_portable_declarations()[0]['origin'],'anything',None))
    def test_new_json_schema_cannot_mint_writer_or_linux_kind_fallback(self):
        with tempfile.TemporaryDirectory()as temp:
            root=Path(temp).resolve()
            identity={'canonicalRoot':str(root),'target':'aarch64-apple-darwin'}
            for kind in('sorng-macarm-source-metadata','sorng-macintel-source-metadata','sorng-linuxarm-source-metadata'):
                value={'schemaVersion':3,'kind':kind,'policy':m.MAC_ARM_CLANG_METADATA_POLICY,
                    'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,'identity':identity,'snapshot':{}}
                with patch.object(m,'source_io_call',side_effect=AssertionError('before writer IO')):
                    with self.assertRaises(m.CheckpointError):m.metadata(root,m.SOURCE_METADATA_NAME,value,True,True)
            self.assertFalse((root/m.SOURCE_METADATA_NAME).exists())
    def test_public_entry_never_selects_v3_from_a_schema_or_literal_report(self):
        self.assertIs(m.MAC_CLANG_LITERAL_PRODUCTION_ADMITTED,False)
        for policy in('mac-arm','mac-intel'):
            with patch.object(m,'safe',side_effect=AssertionError('before source IO')):
                with self.assertRaises(m.CheckpointError):m.source_metadata('source-record',None,None,{},platform_policy=policy)


@unittest.skipUnless(os.name=='posix','real dir-FD/scandir/symlink codec requires POSIX; Windows is not Darwin proof')
class PosixCodec(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.parent=Path(self.temp.name).resolve()
        self.output=self.parent/'cef-mac-clang-owned-proof-12345678-1234-4123-8123-123456789abc'
        self.env={'RUNNER_TEMP':str(self.parent),'ImageOS':'macos15','ImageVersion':m.MAC_SOURCE_IMAGE,
            'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public',
            'GITHUB_REPOSITORY':'supermarsx/sortOfRemoteNG','GITHUB_REPOSITORY_ID':'1010282954',
            'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':BRANCH,'GITHUB_SHA':'a'*40,
            'GITHUB_WORKFLOW_SHA':'a'*40,
            'GITHUB_WORKFLOW_REF':'supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-clang-resource-proof.yml@'+BRANCH}
        m.SOURCE_CLOSE_FAILURE=m.SOURCE_JOIN_FAILURE=False
    def tearDown(self):self.temp.cleanup()
    @contextmanager
    def mac_model(self):
        with ExitStack()as stack:
            stack.enter_context(patch.object(sys,'platform','darwin'))
            stack.enter_context(patch.object(m.platform,'machine',return_value='x86_64'))
            stack.enter_context(patch.dict(os.environ,self.env,clear=True))
            stack.enter_context(patch.object(m,'_MAC_CLANG_PROOF_TEMP',str(self.parent)))
            if not hasattr(self.parent.stat(),'st_birthtime'):
                # Only Darwin host/birth facts are modeled. Real dir FDs,
                # bytes, inode/ctime/owner, hashes and codec pipeline execute.
                stack.enter_context(patch.object(m,'source_birth_identity',return_value=('darwin-birthtime-float-hex','0x1.0p+30')))
            yield
    def fixture(self,intel=False):
        work=self.output/('intel'if intel else'arm')/'work'
        root,sidecar,identity=source_fixture(work,intel)
        def codec(mode):
            with m.source_io_scope(mode):
                return m._source_metadata_owned_codec(mode,root,sidecar,identity,work,m.Budget(20),'mac-intel'if intel else'mac-arm')
        return work,root,sidecar,identity,codec
    def deny_before_utime(self,action):
        with patch.object(m.os,'utime',wraps=m.os.utime)as writes:
            with self.assertRaises((m.CheckpointError,OSError)):action()
            self.assertEqual(writes.call_count,0)
    def test_real_linux_schema1_same_clang_paths_resolve_record_apply_verify_and_cache(self):
        if not sys.platform.startswith('linux'):self.skipTest('requires actual Linux, not a modeled platform')
        work=self.parent/'linux';root,sidecar,identity=source_fixture(work,linux=True)
        def codec(mode):return m.source_metadata(mode,root,sidecar,identity,seconds=20)
        recorded=codec('source-record');raw=sidecar.read_bytes();stored=json.loads(raw)
        self.assertEqual(stored['schemaVersion'],1)
        self.assertEqual(stored['policy'],m.SOURCE_METADATA_POLICY)
        self.assertNotIn('compilerLiteralLinks',stored['snapshot'])
        cache=root/'acquisition-logs'/m.SOURCE_STAT_CACHE_NAME
        self.assertTrue(cache.is_file())
        self.assertEqual(json.loads(cache.read_bytes())['sidecarSha256'],hashlib.sha256(raw).hexdigest())
        file=root/'src/input.cc';before=file.stat();os.utime(file,ns=(before.st_atime_ns,before.st_mtime_ns+2000000000))
        applied=codec('source-apply');verified=codec('source-verify')
        self.assertTrue(recorded['complete']and applied['complete']and verified['complete'])
        self.assertEqual(file.stat().st_mtime_ns,before.st_mtime_ns)
        self.assertGreater(applied['timing']['hashedFiles'],0)
        self.assertGreater(verified['timing']['reusedFiles'],0)
        self.assertEqual(sidecar.read_bytes(),raw)
        (root/m.MAC_CLANG_SOURCE_ROWS[1][0]/'lib/clang/24/lib'/m.MAC_CLANG_RUNTIME_ALIASES[1][1]).rmdir()
        self.deny_before_utime(lambda:codec('source-apply'))
    def test_portable_mac_model_real_codec_both_targets_records_applies_and_verifies_v3(self):
        with self.mac_model(),m._mac_clang_owned_proof_tree(self.output,m.Budget(30))as receipt:
            for intel in(False,True):
                _,root,sidecar,_,codec=self.fixture(intel)
                self.assertTrue(codec('source-record')['complete'])
                raw=sidecar.read_bytes();value=json.loads(raw)
                self.assertEqual(value['schemaVersion'],3)
                self.assertEqual(value['snapshot']['literalLinks'],m._mac_nearby_portable_declarations())
                self.assertEqual(value['snapshot']['compilerLiteralLinks'],m._mac_clang_portable_declarations())
                file=root/'src/input.cc';before=file.stat();os.utime(file,ns=(before.st_atime_ns,before.st_mtime_ns+2000000000))
                self.assertTrue(codec('source-apply')['complete']and codec('source-verify')['complete'])
                self.assertEqual(file.stat().st_mtime_ns,before.st_mtime_ns)
                self.assertEqual(sidecar.read_bytes(),raw)
                self.assertFalse((root/'acquisition-logs'/m.SOURCE_STAT_CACHE_NAME).exists())
            self.assertEqual(m._mac_clang_owned_proof_path(receipt),self.output)
        self.assertNotIn(receipt,m._MAC_CLANG_PROOF_RECEIPTS)
        with self.assertRaises(m.CheckpointError):m._mac_clang_owned_proof_path(receipt)
    def test_portable_mac_model_wrong_literals_provenance_and_present_targets_deny_before_utime(self):
        with self.mac_model(),m._mac_clang_owned_proof_tree(self.output,m.Budget(30)):
            _,root,sidecar,_,codec=self.fixture();codec('source-record')
            parent=root/m.MAC_CLANG_SOURCE_ROWS[1][0]/'lib/clang/24/lib';origin,target=m.MAC_CLANG_RUNTIME_ALIASES[1]
            link=parent/origin;link.unlink();os.symlink('wrong-target',link)
            self.deny_before_utime(lambda:codec('source-apply'))
            link.unlink();os.symlink(target,link)
            for kind in('file','directory','link'):
                p=parent/target
                if kind=='file':p.write_bytes(b'present')
                elif kind=='directory':p.mkdir()
                else:os.symlink('also-absent',p)
                self.deny_before_utime(lambda:codec('source-apply'))
                if kind=='directory':p.rmdir()
                else:p.unlink()
            for name in ['src/DEPS','src/.git/HEAD',m.MAC_CLANG_SOURCE_ROWS[1][3],m.MAC_CLANG_SOURCE_ROWS[1][1]+'/.git/HEAD','src/input.cc']:
                p=root/name;raw=p.read_bytes();p.write_bytes(bytes([raw[0]^1])+raw[1:])
                self.deny_before_utime(lambda:codec('source-apply'));p.write_bytes(raw)
    def test_portable_mac_model_old_schema_or_modified_compiler_rows_deny_before_utime(self):
        with self.mac_model(),m._mac_clang_owned_proof_tree(self.output,m.Budget(30)):
            _,_,sidecar,_,codec=self.fixture();codec('source-record');raw=sidecar.read_bytes();value=json.loads(raw)
            variants=[{**value,'schemaVersion':v}for v in(1,2)]
            variants += [{**value,'policy':m.MAC_ARM_NEARBY_METADATA_POLICY},
                         {**value,'kind':'sorng-linuxarm-source-metadata'}]
            changed=copy.deepcopy(value);changed['snapshot']['compilerLiteralLinks'][0]['rawTarget']='foreign';variants.append(changed)
            changed=copy.deepcopy(value);del changed['snapshot']['compilerLiteralLinks'];variants.append(changed)
            for changed in variants:
                sidecar.write_bytes((json.dumps(changed)+'\n').encode());self.deny_before_utime(lambda:codec('source-apply'))
            sidecar.write_bytes(raw)
            # Direct low-level writer calls cannot downgrade this v3-owned
            # namespace by pretending to be an ordinary Linux schema1 row.
            for version,kind,policy in ((1,'sorng-linuxarm-source-metadata',m.SOURCE_METADATA_POLICY),
                                       (1,'sorng-macarm-source-metadata',m.MAC_SOURCE_METADATA_POLICY),
                                       (2,'sorng-macarm-source-metadata',m.MAC_ARM_NEARBY_METADATA_POLICY)):
                forged={**value,'schemaVersion':version,'kind':kind,'policy':policy}
                with patch.object(m,'source_io_call',side_effect=AssertionError('before writer IO')):
                    with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):
                        m.metadata(sidecar.parent,m.SOURCE_METADATA_NAME,forged,True,True)
    def test_creator_wrong_host_or_branch_denies_before_filesystem_and_retires_on_close_error(self):
        with self.mac_model():
            for key in('GITHUB_REF','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','ImageVersion'):
                with patch.dict(os.environ,{key:'foreign'}),patch.object(m,'safe',side_effect=AssertionError('no filesystem')):
                    with self.assertRaises(m.CheckpointError):
                        with m._mac_clang_owned_proof_tree(self.output,m.Budget(5)):self.fail('wrong authority')
            close=os.close
            def fault(fd):close(fd);raise OSError('owned close failure')
            with patch.object(os,'close',side_effect=fault),self.assertRaises(OSError):
                with m._mac_clang_owned_proof_tree(self.output,m.Budget(5))as receipt:pass
            self.assertNotIn(receipt,m._MAC_CLANG_PROOF_RECEIPTS)
            self.assertTrue(m.SOURCE_CLOSE_FAILURE)
    def test_portable_mac_model_actual_parent_replacement_denies(self):
        with self.mac_model(),m._mac_clang_owned_proof_tree(self.output,m.Budget(20))as receipt:
            work,root,_,identity,_=self.fixture()
            policy={**m.source_repositories(root,m.Budget(5)),'mac':True,'ownedMacArm':True,
                'clangLiteralPolicy':m.MAC_CLANG_LITERAL_POLICY,'_macClangReceipt':receipt,
                '_macClangIdentity':identity,'_macClangRoot':root,'_macClangPlatform':'mac-arm'}
            parent=root/m.MAC_CLANG_SOURCE_ROWS[0][0]/'lib/clang/24/lib'
            with self.assertRaises((m.CheckpointError,OSError)):
                with m.source_clang_literals(root,policy,m.Budget(5))as state:
                    os.rename(parent,parent.with_name('lib-retired'));parent.mkdir()
                    self.deny_before_utime(lambda:m.source_clang_check(state,m.Budget(5)))
    def test_portable_mac_model_actual_held_parent_fd_rebinding_denies_and_joins(self):
        with self.mac_model(),m._mac_clang_owned_proof_tree(self.output,m.Budget(20))as receipt:
            _,root,_,identity,_=self.fixture()
            policy={**m.source_repositories(root,m.Budget(5)),'mac':True,'ownedMacArm':True,
                'clangLiteralPolicy':m.MAC_CLANG_LITERAL_POLICY,'_macClangReceipt':receipt,
                '_macClangIdentity':identity,'_macClangRoot':root,'_macClangPlatform':'mac-arm'}
            alternate=self.output/'other-owned-parent';alternate.mkdir()
            with self.assertRaises(m.CheckpointError):
                with m.source_clang_literals(root,policy,m.Budget(5))as state:
                    fd=state['directories'][0][1]
                    replacement=os.open(alternate,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                    try:os.dup2(replacement,fd)
                    finally:os.close(replacement)
                    self.deny_before_utime(lambda:m.source_clang_check(state,m.Budget(5)))
            with self.assertRaises(OSError):os.fstat(fd)
            self.assertFalse(m.SOURCE_CLOSE_FAILURE)
    def test_portable_mac_model_v3_scope_does_not_block_real_linux_codec_elsewhere(self):
        if not sys.platform.startswith('linux'):self.skipTest('requires actual Linux')
        with self.mac_model(),m._mac_clang_owned_proof_tree(self.output,m.Budget(20)):
            with patch.object(sys,'platform','linux'):
                work=self.parent/'separate-linux';root,sidecar,identity=source_fixture(work,linux=True)
                for mode in m.SOURCE_IO_MODES:
                    self.assertTrue(m.source_metadata(mode,root,sidecar,identity,seconds=20)['complete'])
                self.assertTrue((root/'acquisition-logs'/m.SOURCE_STAT_CACHE_NAME).is_file())
    def test_portable_mac_model_fresh_operation_budget_cannot_extend_creator_original_end(self):
        with self.mac_model():
            original=m.Budget(20)
            with m._mac_clang_owned_proof_tree(self.output,original)as receipt:
                with patch.object(m.time,'monotonic',return_value=original.end+1):
                    fresh=m.Budget(20);fresh.check()
                    with self.assertRaisesRegex(m.CheckpointError,'archive-deadline'):
                        m._mac_clang_owned_proof_path(receipt)
                with patch.object(m.time,'monotonic',side_effect=[original.end-1,original.end+1]):
                    with self.assertRaisesRegex(m.CheckpointError,'archive-deadline'):
                        m._mac_clang_owned_proof_path(receipt)


if __name__=='__main__':unittest.main(verbosity=2)
