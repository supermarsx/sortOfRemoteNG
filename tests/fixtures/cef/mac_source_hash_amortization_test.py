"""Real owned FS controls. Darwin birth semantics proved only on Darwin."""
import hashlib,os,stat,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
import importlib.util

HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
P=None;RAW=None;PROTOTYPE_RAW=None
def configure(prototype,raw,prototype_raw):
    global P,RAW,PROTOTYPE_RAW
    assert len(raw)==209410 and hashlib.sha256(raw).hexdigest()=='3975ef80cf4daf3b4c49f7922ddd3a6b5e18517b6fe3e28c92ab03a440be57c6'
    P,RAW,PROTOTYPE_RAW=prototype,raw,prototype_raw

@unittest.skipUnless(os.name=='posix','Actual POSIX directory-FD contract')
class Controls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='mac-amortization-controls-');self.base=Path(self.temp.name).resolve()
        self.root=self.base/'root';self.root.mkdir();self.parent=self.root/'outer/ancestor/deep/parent';self.parent.mkdir(parents=True)
        for i in range(70):(self.parent/('input%03d'%i)).write_bytes(bytes((i%251,))*1024)
        self.m=types.ModuleType('actual');exec(compile(RAW,'<actual-helper>','exec'),self.m.__dict__)
        self.n,self.observations,self.inverse=P.snapshot_module(RAW)
        self.scopes=[];original=P.Scope.__init__
        def capture(scope,*args,**kwargs):original(scope,*args,**kwargs);self.scopes.append(scope)
        self.capture=patch.object(P.Scope,'__init__',capture);self.capture.start()
    def tearDown(self):
        self.capture.stop();self.temp.cleanup()
    def context(self):return {'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}}
    def snapshot(self,module=None,budget=None):
        module=module or self.n
        return module.source_snapshot(self.root,budget or module.Budget(10),context=self.context())
    def closed(self):
        self.assertTrue(self.scopes)
        for scope in self.scopes:
            self.assertEqual(scope.active,0);self.assertEqual(scope.opened,scope.closed);self.assertFalse(scope.ledger)
    def test_full_snapshot_pair_and_original_hash_inverse(self):
        expected=self.snapshot(self.m)
        self.assertEqual(self.snapshot(),expected);self.assertEqual(self.snapshot(),expected)
        self.assertTrue(self.inverse['sourceHashUnchanged']);self.assertTrue(self.inverse['dispatcherInverseExact'])
        self.closed()
        for row in self.observations:
            self.assertLessEqual(row['peakFDs'],9);self.assertEqual(row['opened'],row['closed']);self.assertEqual(row['unknownCloses'],0)
    def test_same_length_changed_file_denied(self):
        original=P.Scope.batch;changed=[]
        def mutate(scope,rows):
            if not changed:
                changed.append(True);p=self.root/rows[0]['path'];p.write_bytes(b'x'*p.stat().st_size)
            return original(scope,rows)
        with patch.object(P.Scope,'batch',mutate):
            with self.assertRaises(BaseException):self.snapshot()
        self.closed()
    def test_leaf_symlink_does_not_disclose_foreign_bytes(self):
        original=P.Leaf.open;foreign=self.base/'foreign';foreign.write_bytes(b'foreign-private');changed=[]
        def replace(leaf,mode):
            if not changed:
                changed.append(True);leaf.path.unlink();leaf.path.symlink_to(foreign)
            return original(leaf,mode)
        with patch.object(P.Leaf,'open',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertEqual(foreign.read_bytes(),b'foreign-private');self.closed()
    def test_parent_replacement_preserved(self):
        original=P.Scope.batch;changed=[];saved=self.base/'saved-parent'
        def replace(scope,rows):
            if not changed:
                changed.append(True);self.parent.rename(saved);self.parent.mkdir();(self.parent/'foreign').write_bytes(b'preserve')
            return original(scope,rows)
        with patch.object(P.Scope,'batch',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertEqual((self.parent/'foreign').read_bytes(),b'preserve');self.closed()
    def test_intermediate_ancestor_symlink_aba_changes_original_tuple(self):
        original=P.Leaf.open;changed=[];ancestor=self.root/'outer/ancestor';saved=self.root/'outer/saved'
        def aba(leaf,mode):
            if not changed:
                changed.append(True);scope=leaf.scope
                before=scope.m.source_local(ancestor.stat(),scope.policy)
                ancestor.rename(saved);ancestor.symlink_to(saved,target_is_directory=True);ancestor.unlink();saved.rename(ancestor)
                # Guarantee an observable ctime while restoring the original mtime.
                time.sleep(0.002);s=ancestor.stat();os.utime(ancestor,ns=(s.st_atime_ns,before[0][1]))
                self.assertNotEqual(scope.m.source_local(ancestor.stat(),scope.policy),before)
                # Root and immediate parent alone cannot identify this mutation.
                scope.directory_check('outer/ancestor/deep/parent',leaf.parent)
            return original(leaf,mode)
        with patch.object(P.Leaf,'open',aba):
            with self.assertRaises(BaseException):self.snapshot()
        self.closed()
    def test_read_primary_survives_close_secondary(self):
        class FalseError(ValueError):
            def __bool__(self):return False
        primary=FalseError('primary');secondary=RuntimeError('secondary');original_close=P.Stream.close
        def read(stream,count):raise primary
        def close(stream):original_close(stream);raise secondary
        with patch.object(P.Stream,'read',read),patch.object(P.Stream,'close',close):
            with self.assertRaises(ValueError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);self.assertTrue(self.n.SOURCE_CLOSE_FAILURE);self.closed()
    def test_deadline_after_actual_close_denies(self):
        budget=self.n.Budget(10);original=P.Stream.close;changed=[]
        def close(stream):
            result=original(stream)
            if not changed:changed.append(True);budget.end=time.monotonic()-1
            return result
        with patch.object(P.Stream,'close',close):
            with self.assertRaises(BaseException):self.snapshot(budget=budget)
        self.closed()
    def test_root_replacement_preserves_foreign_tree(self):
        original=P.Leaf.open;changed=[];saved=self.base/'saved-root'
        def replace(leaf,mode):
            if not changed:
                changed.append(True);self.root.rename(saved);self.root.mkdir();(self.root/'foreign').write_bytes(b'preserve')
            return original(leaf,mode)
        with patch.object(P.Leaf,'open',replace):
            with self.assertRaises(BaseException):self.snapshot()
        self.assertEqual((self.root/'foreign').read_bytes(),b'preserve');self.closed()
    def test_pool_constructor_failure_closes_owned_root(self):
        primary=ValueError('pool-construction')
        with patch.object(P.futures,'ThreadPoolExecutor',side_effect=primary):
            with self.assertRaises(ValueError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);self.closed()
    def test_parent_open_primary_precedes_uncertain_cleanup_actual_old_red(self):
        fixed='        except BaseException as primary:\n            self.record(primary)\n            if owned and self.ledger.get(current) is False:'
        old='        except BaseException:\n            if owned and self.ledger.get(current) is False:'
        text=PROTOTYPE_RAW.decode();self.assertEqual(text.count(fixed),1)
        old_raw=text.replace(fixed,old,1).encode()
        self.assertEqual(len(old_raw),14183)
        self.assertEqual(hashlib.sha256(old_raw).hexdigest(),'0e3615b7ca3bd4d354247c29cfe93171e632cbd88a995e250e6737739ae5eff7')
        previous=types.ModuleType('actual_old_prototype');exec(compile(old_raw,'<actual-old-prototype>','exec'),previous.__dict__)
        class FalseError(OSError):
            def __bool__(self):return False
        actual_open=P.Scope.open;actual_close=P.Scope.close;actual_parent=P.Scope.parent
        for method,old_control in [(previous.Scope.parent,True),(actual_parent,False)]:
            entered=[];uncertain=[];primary=FalseError(5,'original');secondary=OSError(5,'secondary')
            self.n,_,_=P.snapshot_module(RAW)
            def open(scope,name,flags,**kwargs):
                if name=='deep':entered.append(True);raise primary
                return actual_open(scope,name,flags,**kwargs)
            def close(scope,fd,operation):
                if entered and not uncertain and fd!=scope.rootfd:
                    uncertain.append(fd)
                    def checked_close():operation();raise secondary
                    return actual_close(scope,fd,checked_close)
                return actual_close(scope,fd,operation)
            with patch.object(P.Scope,'parent',method),patch.object(P.Scope,'open',open),patch.object(P.Scope,'close',close):
                with self.assertRaises(OSError)as caught:self.snapshot()
            self.assertIs(caught.exception,secondary if old_control else primary)
            scope=self.scopes[-1];self.assertEqual(scope.unknown,1);self.assertEqual(scope.active,0)
            self.assertEqual(scope.opened,scope.close_attempts);self.assertEqual(scope.opened-scope.closed,1)
    def test_unknown_root_close_is_not_retried_or_accepted(self):
        original=P.Scope.close;seen=[];primary=OSError('unknown-close')
        def close(scope,fd,operation):
            if fd==scope.rootfd:
                def unknown():operation();seen.append(fd);raise primary
                return original(scope,fd,unknown)
            return original(scope,fd,operation)
        with patch.object(P.Scope,'close',close):
            with self.assertRaises(OSError)as caught:self.snapshot()
        self.assertIs(caught.exception,primary);self.assertEqual(len(seen),1)
        self.assertTrue(self.n.SOURCE_CLOSE_FAILURE)
        scope=self.scopes[0];self.assertEqual(scope.opened-scope.closed,1);self.assertEqual(scope.unknown,1)
        self.assertEqual(scope.ledger,{scope.rootfd:True})
    def test_postinventory_change_cannot_escape_as_snapshot(self):
        original=self.n.inventory;count=[]
        def inventory(*args,**kwargs):
            count.append(True)
            if len(count)==2:(self.parent/'input000').write_bytes(b'x'*1024)
            return original(*args,**kwargs)
        with patch.object(self.n,'inventory',inventory):
            with self.assertRaises(BaseException):self.snapshot()
        self.closed()
    def test_leaf_diagnostics_keep_the_existing_relative_projection(self):
        original=P.Leaf.stat;changed=[]
        def missing(leaf):
            if not changed:
                changed.append(leaf.path.relative_to(self.root).as_posix());raise FileNotFoundError(2,'private body',str(self.base/'secret'))
            return original(leaf)
        token=self.n.SOURCE_IO_CONTEXT.set(('source-record',self.root))
        try:
            with patch.object(P.Leaf,'stat',missing):
                with self.assertRaises(FileNotFoundError)as caught:self.snapshot()
            value=caught.exception.sourceIoFailure
            self.assertEqual(value['kind'],'FileNotFound')
            self.assertEqual(value['candidate']['sha256'],hashlib.sha256(changed[0].encode()).hexdigest())
            self.assertEqual(value['candidate']['bytes'],len(changed[0].encode()));self.assertNotIn('name',value['candidate'])
            self.assertNotIn('private body',str(value));self.assertNotIn('secret',str(value))
        finally:self.n.SOURCE_IO_CONTEXT.reset(token)
        self.closed()
    @unittest.skipUnless(sys.platform=='darwin','Actual Darwin birth and owned-source FD semantics')
    def test_actual_darwin_owned_birth_uid_gid_nlink_and_digest(self):
        policy={'mac':True,'ownedMacIntel':True,'_directories':{},'_nearby_literals':None,'_clang_literals':None}
        budget=self.n.Budget(10);root_before=self.n.stamp(self.root.stat());local=self.n.source_local(self.root.stat(),policy)
        rows,_=self.n.inventory(self.root,budget,source_policy=policy)
        rows=[r for r in rows if r['kind']=='file'];hash_file,_=P.derive_hash(self.n,RAW)
        expected={r['path']:self.n.source_hash(self.root,r,budget,policy)for r in rows}
        progress={'hashedFiles':0,'hashedBytes':0}
        result,_=P.dispatch(self.n,hash_file,self.root,rows,budget,policy,root_before,local,progress)
        self.assertEqual(result,expected);self.closed()
        for field in ['birthIdentity','uid','gid']:
            bad=dict(rows[0]);bad[field]=('darwin-birthtime-float-hex','0x0.0p+0')if field=='birthIdentity'else bad[field]+1
            with self.assertRaises(BaseException):self.n.source_hash(self.root,bad,budget,policy)
            with self.assertRaises(BaseException):P.dispatch(self.n,hash_file,self.root,[bad],budget,policy,root_before,local,{'hashedFiles':0,'hashedBytes':0})
        original=self.root/rows[0]['path'];os.link(original,self.base/'hardlink')
        bad=dict(rows[0]);s=original.stat();bad.update(stamp=self.n.stamp(s),ctimeNs=s.st_ctime_ns,birthIdentity=self.n.source_birth_identity(s))
        with self.assertRaises(BaseException):self.n.source_hash(self.root,bad,budget,policy)
        with self.assertRaises(BaseException):P.dispatch(self.n,hash_file,self.root,[bad],budget,policy,root_before,local,{'hashedFiles':0,'hashedBytes':0})
    def test_unconfirmed_join_keeps_root_until_real_workers_finish(self):
        entered=threading.Event();release=threading.Event();pools=[];original_batch=P.Scope.batch;shutdown=P.futures.ThreadPoolExecutor.shutdown
        budget=self.n.Budget(10);ordinary_check=budget.check;primary=self.n.CheckpointError('archive-deadline')
        def check():
            ordinary_check()
            if entered.is_set():raise primary
        budget.check=check
        def blocked(scope,rows):entered.set();release.wait(2);return original_batch(scope,rows)
        def unconfirmed(pool,*args,**kwargs):pools.append(pool)
        try:
            with patch.object(P.Scope,'batch',blocked),patch.object(P.futures.ThreadPoolExecutor,'shutdown',unconfirmed):
                with self.assertRaises(BaseException)as caught:self.snapshot(budget=budget)
            self.assertIs(caught.exception,primary)
            self.assertTrue(entered.is_set());self.assertTrue(self.n.SOURCE_JOIN_FAILURE)
            self.assertTrue(any(scope.ledger.get(scope.rootfd)is False for scope in self.scopes))
        finally:
            release.set()
            for pool in pools:shutdown(pool,wait=True,cancel_futures=True)
            for scope in self.scopes:scope.finish(joined=True)
        self.closed()

if __name__=='__main__':
    configure(load('prototype',HERE/'mac_source_hash_amortization_prototype.py'),(HERE.parents[2]/'scripts/lib/cef-checkpoint-archive.py').read_bytes().replace(b'\r\n',b'\n'),(HERE/'mac_source_hash_amortization_prototype.py').read_bytes().replace(b'\r\n',b'\n'))
    unittest.main(verbosity=2)
