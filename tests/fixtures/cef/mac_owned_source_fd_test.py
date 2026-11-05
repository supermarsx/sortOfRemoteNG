"""Actual owned FS/Git checks; POSIX birth modeling is not Darwin qualification."""
import ast,hashlib,importlib.util,json,os,subprocess,sys,tempfile,threading,time,types,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
RAW=globals().get('HELD_HELPER_RAW')
if RAW is None:RAW=(ROOT/'scripts/lib/cef-checkpoint-archive.py').read_bytes().replace(b'\r\n',b'\n')
# The digest-reuse change is restored first: these history proofs bind the earlier reviewed helper.
_REUSE_SPEC=importlib.util.spec_from_file_location('mac_source_reuse_inverse',str(ROOT/'tests/fixtures/cef/mac_source_reuse_inverse.py'))
_REUSE=importlib.util.module_from_spec(_REUSE_SPEC);_REUSE_SPEC.loader.exec_module(_REUSE);RAW=_REUSE.inverse(RAW)
def noop_inverse(raw):
    text=raw.decode()
    if '# BEGIN MAC OWNED NOOP 'not in text:return raw
    for role in ('SYMLINK','FILE'):
        block=f"                # BEGIN MAC OWNED NOOP {role} UTIME\n                if mac and before.st_mtime_ns == int(row['mtimeNs']):\n                    continue\n                # END MAC OWNED NOOP {role} UTIME\n"
        assert text.count(block)==1;text=text.replace(block,'',1)
    header="        # BEGIN MAC OWNED NOOP ROOT UTIME\n        if not (mac and info.st_mtime_ns == int(expected['rootMtimeNs'])):\n";end='        # END MAC OWNED NOOP ROOT UTIME\n'
    assert text.count(header)==text.count(end)==1
    start=text.index(header);finish=text.index(end,start);body=text[start+len(header):finish]
    restored=''.join(line[4:]if line.strip()else line for line in body.splitlines(keepends=True))
    text=text[:start]+restored+text[finish+len(end):]
    value=text.encode();assert len(value)==228445 and hashlib.sha256(value).hexdigest()=='75b9d75d5f33ccb433effabb560d168ade627352377afdff4939cd2920ba2b23'
    return value
def inverse(raw):
    text=raw.decode();start=text.index('\n\n# BEGIN STATIC MAC OWNED FD HASHING\n');marker='# END STATIC MAC OWNED FD HASHING\n'
    end=text.index(marker,start)+len(marker);block=text[start:end]
    selection="        # BEGIN STATIC MAC OWNED FD SELECTION\n        if source_owned_mac(policy):\n            return _source_mac_owned_snapshot_inventory(root,budget,guards,policy,external,member_policy=member_policy,reuse=reuse,layout=layout)\n        # END STATIC MAC OWNED FD SELECTION\n"
    assert text.count(selection)==1 and text.count(marker)==1
    old=text.replace(block,'',1).replace(selection,'',1).encode()
    assert len(old)==209410 and hashlib.sha256(old).hexdigest()=='3975ef80cf4daf3b4c49f7922ddd3a6b5e18517b6fe3e28c92ab03a440be57c6'
    return old,block
OLD,BLOCK=inverse(noop_inverse(RAW))
def load(raw):
    module=types.ModuleType('actual_static_helper');exec(compile(raw,'<actual-static-helper>','exec'),module.__dict__);return module
def functions(raw):
    text=raw.decode();return {n.name:ast.get_source_segment(text,n)for n in ast.parse(text).body if isinstance(n,ast.FunctionDef)}

class StaticInverse(unittest.TestCase):
    def test_complete_old_helper_and_unchanged_fallback_functions(self):
        old,new=functions(OLD),functions(noop_inverse(RAW))
        for name in old:
            if name!='source_snapshot':self.assertEqual(new[name],old[name],name)
        self.assertEqual(hashlib.sha256(new['source_hash'].encode()).hexdigest(),'10d698d99fc7198033531fede6cfd1a99e25dc393a4b884b74ac1fc46601f047')
        self.assertNotIn('exec(',BLOCK);self.assertNotIn('ast.',BLOCK);self.assertNotIn('compile(',BLOCK)
        self.assertIn('_MAC_SOURCE_FD_WORKERS = 1',BLOCK);self.assertIn('_MAC_SOURCE_FD_BATCH = 32',BLOCK)
    def test_static_leaf_copy_reverses_only_adapter_and_first_error_latch(self):
        new=functions(RAW)['_source_mac_fd_hash'];old=functions(OLD)['source_hash']
        new=new.replace('def _source_mac_fd_hash(root, row, budget, policy, leaf):','def source_hash(root, row, budget, policy=None):',1)
        new=new.replace("    p = leaf;before = source_io_call('file-path-stat', p, p.stat)","    p = source_io_call('file-path-stat', root / row['path'], lambda: safe(root / row['path']));before = source_io_call('file-path-stat', p, p.stat)",1)
        new=new.replace('        leaf.scope.record(error)\n','',1);self.assertEqual(new,old)

@unittest.skipUnless(os.name=='posix','Actual POSIX held directory-FD checks')
class OwnedFilesystem(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='owned-static-fd-');self.base=Path(self.temp.name).resolve();self.root=self.base/'source';self.root.mkdir()
        self.home=self.base/'git-home';self.home.mkdir();self.empty=self.home/'empty';self.empty.write_text('');self.hooks=self.home/'hooks';self.hooks.mkdir()
        self.env={'PATH':'/usr/bin:/bin','HOME':str(self.home),'LANG':'C','LC_ALL':'C','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':str(self.empty),'GIT_CONFIG_SYSTEM':str(self.empty),'GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0'}
        for name in ('src','src/cef','depot_tools'):
            directory=self.root/name;directory.mkdir(parents=True,exist_ok=True)
            self.git(directory,['init','--quiet']);self.git(directory,['config','user.name','Owned fixture']);self.git(directory,['config','user.email','fixture@example.invalid'])
            (directory/'input.txt').write_bytes(('scratch '+name+'\n').encode())
            self.git(directory,['add','input.txt']);self.git(directory,['commit','--quiet','-m','Actual scratch fixture']);self.git(directory,['checkout','--quiet','--detach'])
            self.assertRegex((directory/'.git/HEAD').read_text(),r'^[a-f0-9]{40}\n$')
        (self.root/'.gclient_entries').write_text("entries = {'src':'https://public.invalid/src','src/cef':'https://public.invalid/cef'}\n")
        self.parent=self.root/'src/outer/ancestor/deep/parent';self.parent.mkdir(parents=True)
        for i in range(70):(self.parent/('input%03d'%i)).write_bytes(bytes([i])*1024)
        self.m,self.old=load(RAW),load(OLD);self.stack=ExitStack();self.scopes=[]
        if sys.platform!='darwin':
            # A stable POSIX-only supplement for models. Never native evidence.
            model=lambda s:('MODELED-NOT-DARWIN',str(s.st_dev)+':'+str(s.st_ino))
            self.stack.enter_context(patch.object(self.m,'source_birth_identity',model));self.stack.enter_context(patch.object(self.old,'source_birth_identity',model))
        original=self.m._MacSourceFdScope.__init__
        def capture(scope,*args,**kwargs):original(scope,*args,**kwargs);self.scopes.append(scope)
        self.stack.enter_context(patch.object(self.m._MacSourceFdScope,'__init__',capture))
    def tearDown(self):self.stack.close();self.temp.cleanup()
    def git(self,directory,args):
        return subprocess.run(['/usr/bin/git','-c','core.autocrlf=false','-c','commit.gpgsign=false','-c','core.hooksPath='+str(self.hooks),'-C',str(directory),*args],env=self.env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10).stdout
    def snapshot(self,module=None,context=None,budget=None):
        module=module or self.m;context={'mac':True,'ownedMacIntel':True}if context is None else context
        return module.source_snapshot(self.root,budget or module.Budget(10),context=context)
    def closed(self):
        self.assertTrue(self.scopes)
        for scope in self.scopes:
            self.assertEqual(scope.active,0);self.assertEqual(scope.opened,scope.closed);self.assertFalse(scope.ledger);self.assertLessEqual(scope.peak,3)
    def test_owned_snapshot_pair_matches_entire_old_helper(self):
        expected=self.snapshot(self.old)
        self.assertEqual(self.snapshot(),expected);self.assertEqual(self.snapshot(),expected)
        self.assertEqual(set(expected['gitHeads']),{'src','src/cef','depot_tools'});self.closed()
    def test_linux_and_external_mac_keep_original_fallback(self):
        with patch.object(self.m,'_source_mac_owned_snapshot_inventory',side_effect=AssertionError('owned route not allowed')):
            for context in ({},{'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}}):
                self.assertEqual(self.snapshot(context=context),self.snapshot(self.old,context=context))
        self.assertFalse(self.scopes)
    def test_same_length_file_change_denied_before_acceptance(self):
        original=self.m._MacSourceFdScope.batch;changed=[]
        def mutate(scope,rows):
            if not changed:changed.append(True);p=self.root/rows[0]['path'];p.write_bytes(b'x'*p.stat().st_size)
            return original(scope,rows)
        with patch.object(self.m._MacSourceFdScope,'batch',mutate):
            with self.assertRaises(BaseException):self.snapshot()
        self.closed()
    def test_natural_intermediate_rename_aba_is_boundary_limited(self):
        expected=self.snapshot(self.old);original=self.m._MacSourceFdLeaf.open;changed=[];observed=[]
        ancestor=self.root/'src/outer/ancestor';saved=self.root/'src/outer/saved'
        def aba(leaf,mode):
            if not changed and str(leaf.path).startswith(str(self.parent)):
                changed.append(True);ancestor.rename(saved);saved.rename(ancestor)
                observed.append(any(self.m.source_local((self.root/name).lstat(),leaf.scope.policy)!=leaf.scope.policy['_directories'][name]for name in('src/outer','src/outer/ancestor')))
            return original(leaf,mode)
        denied=False;value=None
        with patch.object(self.m._MacSourceFdLeaf,'open',aba):
            try:value=self.snapshot()
            except BaseException:denied=True
        self.assertTrue(observed)
        if observed[0]:self.assertTrue(denied)
        if not denied:self.assertEqual(value,expected)
        self.closed()
    def test_false_primary_survives_real_close_uncertainty(self):
        class FalseError(ValueError):
            def __bool__(self):return False
        primary=FalseError('first');secondary=OSError('second');original=self.m._MacSourceFdStream.close
        def read(stream,count):raise primary
        def close(stream):original(stream);raise secondary
        with patch.object(self.m._MacSourceFdStream,'read',read),patch.object(self.m._MacSourceFdStream,'close',close):
            with self.assertRaises(ValueError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);self.assertTrue(self.m.SOURCE_CLOSE_FAILURE);self.closed()
    def test_real_root_close_failure_never_admits_or_retries(self):
        original=self.m._MacSourceFdScope.close;seen=[];primary=OSError('uncertain')
        def close(scope,fd,operation):
            if fd==scope.rootfd:
                def uncertain():operation();seen.append(fd);raise primary
                return original(scope,fd,uncertain)
            return original(scope,fd,operation)
        with patch.object(self.m._MacSourceFdScope,'close',close):
            with self.assertRaises(OSError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);self.assertEqual(len(seen),1);self.assertTrue(self.m.SOURCE_CLOSE_FAILURE)
        scope=self.scopes[0];self.assertEqual(scope.opened,scope.close_attempts);self.assertEqual(scope.unknown,1)
    def test_deadline_after_checked_file_close_never_admits(self):
        budget=self.m.Budget(10);original=self.m._MacSourceFdStream.close
        def close(stream):original(stream);budget.end=time.monotonic()-1
        with patch.object(self.m._MacSourceFdStream,'close',close):
            with self.assertRaises(BaseException):self.snapshot(budget=budget)
        self.closed()

    def test_leaf_symlink_does_not_disclose_foreign_bytes(self):
        original=self.m._MacSourceFdLeaf.open;foreign=self.base/'foreign';foreign.write_bytes(b'foreign-private');changed=[]
        def replace(leaf,mode):
            if not changed:
                changed.append(True);leaf.path.unlink();leaf.path.symlink_to(foreign)
            return original(leaf,mode)
        with patch.object(self.m._MacSourceFdLeaf,'open',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertEqual(foreign.read_bytes(),b'foreign-private');self.closed()

    def test_persistent_intermediate_symlink_during_batch_denies(self):
        original=self.m._MacSourceFdLeaf.open;calls=[];lock=threading.Lock();ancestor=self.root/'src/outer/ancestor';saved=self.base/'saved-ancestor'
        def replace(leaf,mode):
            with lock:calls.append(True);selected=len(calls)==2
            if selected:ancestor.rename(saved);ancestor.symlink_to(saved,target_is_directory=True)
            return original(leaf,mode)
        with patch.object(self.m._MacSourceFdLeaf,'open',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertTrue(ancestor.is_symlink());self.assertTrue(saved.is_dir());self.closed()

    def test_parent_replacement_during_batch_preserves_foreign_tree(self):
        original=self.m._MacSourceFdLeaf.open;calls=[];lock=threading.Lock();saved=self.base/'saved-parent'
        def replace(leaf,mode):
            with lock:calls.append(True);selected=len(calls)==2
            if selected:self.parent.rename(saved);self.parent.mkdir();(self.parent/'foreign').write_bytes(b'preserve')
            return original(leaf,mode)
        with patch.object(self.m._MacSourceFdLeaf,'open',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertEqual((self.parent/'foreign').read_bytes(),b'preserve');self.closed()

    def test_root_replacement_preserves_foreign_tree(self):
        original=self.m._MacSourceFdLeaf.open;calls=[];lock=threading.Lock();saved=self.base/'saved-root'
        def replace(leaf,mode):
            with lock:calls.append(True);selected=len(calls)==2
            if selected:self.root.rename(saved);self.root.mkdir();(self.root/'foreign').write_bytes(b'preserve')
            return original(leaf,mode)
        with patch.object(self.m._MacSourceFdLeaf,'open',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertEqual((self.root/'foreign').read_bytes(),b'preserve');self.closed()

    def test_pool_constructor_failure_closes_owned_root(self):
        primary=ValueError('pool-construction')
        with patch.object(self.m._mac_source_fd_futures,'ThreadPoolExecutor',side_effect=primary):
            with self.assertRaises(ValueError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);self.closed()

    def test_postinventory_change_cannot_escape_as_snapshot(self):
        original=self.m.inventory;count=[]
        def inventory(*args,**kwargs):
            count.append(True)
            if len(count)==2:(self.parent/'input000').write_bytes(b'x'*1024)
            return original(*args,**kwargs)
        with patch.object(self.m,'inventory',inventory):
            with self.assertRaises(BaseException):self.snapshot()
        self.closed()

    def test_leaf_diagnostics_keep_the_existing_relative_projection(self):
        original=self.m._MacSourceFdLeaf.stat;changed=[]
        def missing(leaf):
            if not changed and str(leaf.path).startswith(str(self.parent)):
                changed.append(leaf.path.relative_to(self.root).as_posix());raise FileNotFoundError(2,'private body',str(self.base/'secret'))
            return original(leaf)
        token=self.m.SOURCE_IO_CONTEXT.set(('source-record',self.root))
        try:
            with patch.object(self.m._MacSourceFdLeaf,'stat',missing):
                with self.assertRaises(FileNotFoundError)as caught:self.snapshot()
            value=caught.exception.sourceIoFailure
            self.assertEqual(value['kind'],'FileNotFound')
            self.assertEqual(value['candidate']['sha256'],hashlib.sha256(changed[0].encode()).hexdigest())
            self.assertEqual(value['candidate']['bytes'],len(changed[0].encode()));self.assertEqual(value['candidate'].get('name'),changed[0])
            self.assertNotIn('private body',str(value));self.assertNotIn('secret',str(value))
        finally:self.m.SOURCE_IO_CONTEXT.reset(token)
        self.closed()

    def test_unconfirmed_join_keeps_root_until_real_workers_finish(self):
        entered=threading.Event();release=threading.Event();pools=[];original_batch=self.m._MacSourceFdScope.batch;shutdown=self.m._mac_source_fd_futures.ThreadPoolExecutor.shutdown
        budget=self.m.Budget(10);ordinary_check=budget.check;primary=self.m.CheckpointError('archive-deadline')
        def check():
            ordinary_check()
            if entered.is_set():raise primary
        budget.check=check
        def blocked(scope,rows):entered.set();release.wait(2);return original_batch(scope,rows)
        def unconfirmed(pool,*args,**kwargs):pools.append(pool)
        try:
            with patch.object(self.m._MacSourceFdScope,'batch',blocked),patch.object(self.m._mac_source_fd_futures.ThreadPoolExecutor,'shutdown',unconfirmed):
                with self.assertRaises(BaseException)as caught:self.snapshot(budget=budget)
            self.assertIs(caught.exception,primary)
            self.assertTrue(entered.is_set());self.assertTrue(self.m.SOURCE_JOIN_FAILURE)
            self.assertTrue(any(scope.ledger.get(scope.rootfd)is False for scope in self.scopes))
        finally:
            release.set()
            for pool in pools:shutdown(pool,wait=True,cancel_futures=True)
            for scope in self.scopes:scope.finish(joined=True)
        self.closed()


    def test_parent_open_false_primary_precedes_checked_close_uncertainty(self):
        class FalseError(OSError):
            def __bool__(self):return False
        entered=[];uncertain=[];primary=FalseError(5,'original');secondary=OSError(5,'secondary')
        actual_open=self.m._MacSourceFdScope.open;actual_close=self.m._MacSourceFdScope.close
        def open(scope,name,flags,**kwargs):
            if name=='deep':entered.append(True);raise primary
            return actual_open(scope,name,flags,**kwargs)
        def close(scope,fd,operation):
            if entered and not uncertain and fd!=scope.rootfd:
                uncertain.append(fd)
                def checked():operation();raise secondary
                return actual_close(scope,fd,checked)
            return actual_close(scope,fd,operation)
        with patch.object(self.m._MacSourceFdScope,'open',open),patch.object(self.m._MacSourceFdScope,'close',close):
            with self.assertRaises(OSError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);scope=self.scopes[-1]
        self.assertEqual(scope.unknown,1);self.assertEqual(scope.active,0);self.assertEqual(scope.opened,scope.close_attempts)
    @unittest.skipUnless(sys.platform=='darwin','Actual Darwin birth/uid/gid/nlink')
    def test_actual_darwin_owned_leaf_nearmisses_deny(self):
        budget=self.m.Budget(10)
        policy={**self.m.source_repositories(self.root,budget),'mac':True,'ownedMacArm':True,'_directories':{},'_nearby_literals':None,'_clang_literals':None}
        before=self.m.stamp(self.root.stat());local=self.m.source_local(self.root.stat(),policy)
        rows,_=self.m.inventory(self.root,budget,source_policy=policy);rows=[r for r in rows if r['kind']=='file']
        def dispatch(values):return self.m._source_mac_fd_hashes(self.root,values,budget,policy,before,local,{'hashedFiles':0,'hashedBytes':0})
        expected={r['path']:self.m.source_hash(self.root,r,budget,policy)for r in rows}
        self.assertEqual(dispatch(rows),expected);self.closed()
        for field in ('birthIdentity','uid','gid'):
            bad=dict(rows[0]);bad[field]=('darwin-birthtime-float-hex','0x0.0p+0')if field=='birthIdentity'else bad[field]+1
            with self.assertRaises(BaseException):self.m.source_hash(self.root,bad,budget,policy)
            with self.assertRaises(BaseException):dispatch([bad])
        original=self.root/rows[0]['path'];os.link(original,self.base/'hardlink');bad=dict(rows[0]);info=original.stat()
        bad.update(stamp=self.m.stamp(info),ctimeNs=info.st_ctime_ns,birthIdentity=self.m.source_birth_identity(info))
        with self.assertRaises(BaseException):self.m.source_hash(self.root,bad,budget,policy)
        with self.assertRaises(BaseException):dispatch([bad])

if __name__=='__main__':unittest.main(verbosity=2)
