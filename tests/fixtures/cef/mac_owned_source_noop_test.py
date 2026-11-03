"""Scratch-only actual codec tests; synthetic identities cannot admit CEF source."""
import hashlib,importlib.util,json,os,sys,time,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
fd=globals().get('HELD_FD_CONTROLS')
if fd is None:
    spec=importlib.util.spec_from_file_location('fd_controls',HERE/'mac_owned_source_fd_test.py');fd=importlib.util.module_from_spec(spec);spec.loader.exec_module(fd)

@unittest.skipUnless(os.name=='posix','Actual owned POSIX codec')
class NoopCodec(fd.OwnedFilesystem):
    # Inherited FD controls intentionally run against this same final helper.
    def setUp(self):
        super().setUp();self.work=self.base;self.out=self.root/'src/out/Release_GN_arm64';self.out.mkdir(parents=True)
        self.sidecar=self.out/self.m.SOURCE_METADATA_NAME
        (self.root/'src/input-link').symlink_to('input.txt')
        self.identity={k:hashlib.sha256(('SYNTHETIC-SCRATCH-NOT-CEF-'+k).encode()).hexdigest()for k in('source','producer','tools','graph','siso')}
        self.identity.update(target='aarch64-apple-darwin',canonicalRoot=str(self.work),image=self.m.MAC_SOURCE_IMAGE)
        self.assertNotEqual(self.identity['source'],self.m.MAC_SOURCE)
    def codec(self,mode,module=None,budget=None):
        module=module or self.m
        # WSL is an explicit ABI model only; genuine Darwin keeps actual facts.
        with ExitStack()as stack:
            if sys.platform!='darwin':stack.enter_context(patch.object(sys,'platform','darwin'))
            with module.source_io_scope(mode):
                return module._source_metadata_owned_codec(mode,self.root,self.sidecar,self.identity,self.work,budget or module.Budget(10),'mac-arm')
    def record(self):return self.codec('source-record')
    def test_canonical_old_writes_new_zero_and_full_postcheck(self):
        self.assertTrue(self.record()['complete']);old_calls=[];new_calls=[];actual=os.utime
        with patch.object(os,'utime',side_effect=lambda *a,**k:(old_calls.append((a,k)),actual(*a,**k))[1]):
            old=self.codec('source-apply',self.old)
        original=self.m.source_snapshot;observed=[]
        def snapshot(*a,**k):observed.append(True);return original(*a,**k)
        with patch.object(os,'utime',side_effect=lambda *a,**k:(new_calls.append((a,k)),actual(*a,**k))[1]),patch.object(self.m,'source_snapshot',snapshot):
            new=self.codec('source-apply')
        self.assertGreater(len(old_calls),0);self.assertEqual(new_calls,[]);self.assertEqual(new,old);self.assertEqual(len(observed),2)
        self.assertTrue(self.codec('source-verify')['complete']);self.closed()
    def test_mixed_times_use_actual_fd_mutation_and_link_readback(self):
        self.record();file=self.root/'src/input.txt';link=self.root/'src/input-link';directory=self.parent
        before={p:p.lstat()for p in(file,link,directory)}
        for p,s in before.items():os.utime(p,ns=(s.st_atime_ns,s.st_mtime_ns+1000000000),follow_symlinks=False)
        calls=[];actual=os.utime
        def write(target,*a,**k):
            calls.append(('fd'if type(target)is int else'path',target));return actual(target,*a,**k)
        with patch.object(os,'utime',write):self.assertTrue(self.codec('source-apply')['complete'])
        self.assertEqual(len(calls),3);self.assertEqual(sum(kind=='fd'for kind,_ in calls),2);self.assertEqual(sum(kind=='path'for kind,_ in calls),1)
        for p,s in before.items():self.assertEqual(p.lstat().st_mtime_ns,s.st_mtime_ns)
        self.assertTrue(self.codec('source-verify')['complete']);self.closed()
    def test_matching_mtime_cannot_hide_same_length_content_tamper(self):
        self.record();file=self.root/'src/input.txt';s=file.stat();original=file.read_bytes()
        file.write_bytes(b'x'*len(original));os.utime(file,ns=(s.st_atime_ns,s.st_mtime_ns))
        with patch.object(os,'utime',side_effect=AssertionError('tamper may not write')):
            with self.assertRaisesRegex(self.m.CheckpointError,'source-content-changed'):self.codec('source-apply')
        self.closed()
    def test_expired_original_budget_denies_before_any_utime(self):
        self.record();budget=self.m.Budget(10);budget.end=time.monotonic()-1
        with patch.object(os,'utime',side_effect=AssertionError('expired may not write')):
            with self.assertRaisesRegex(self.m.CheckpointError,'archive-deadline'):self.codec('source-apply',budget=budget)
    def test_real_mutation_close_failure_is_not_success(self):
        self.record();file=self.root/'src/input.txt';s=file.stat();os.utime(file,ns=(s.st_atime_ns,s.st_mtime_ns+1000000000))
        actual_write=os.utime;actual_close=os.close;target=[];primary=OSError('uncertain-mutation-close')
        def write(fd,*a,**k):
            value=actual_write(fd,*a,**k)
            if type(fd)is int:target.append(fd)
            return value
        def close(fd):
            value=actual_close(fd)
            if target and fd==target[-1]:raise primary
            return value
        with patch.object(os,'utime',write),patch.object(os,'close',close):
            with self.assertRaises(OSError)as caught:self.codec('source-apply')
        self.assertIs(caught.exception,primary);self.assertTrue(target);self.assertTrue(self.m.SOURCE_CLOSE_FAILURE)
    def test_false_mutation_error_survives_real_close_uncertainty(self):
        self.record();file=self.root/'src/input.txt';s=file.stat();os.utime(file,ns=(s.st_atime_ns,s.st_mtime_ns+1000000000))
        class FalseError(ValueError):
            def __bool__(self):return False
        primary=FalseError('first');secondary=OSError('second');target=[];actual_close=os.close
        def write(fd,*a,**k):target.append(fd);raise primary
        def close(fd):
            value=actual_close(fd)
            if target and fd==target[-1]:raise secondary
            return value
        with patch.object(os,'utime',write),patch.object(os,'close',close):
            with self.assertRaises(ValueError)as caught:self.codec('source-apply')
        self.assertIs(caught.exception,primary);self.assertTrue(self.m.SOURCE_CLOSE_FAILURE)
    def test_scratch_identity_cannot_mint_public_source_authority(self):
        with patch.object(self.m,'safe',side_effect=AssertionError('public scratch must deny before IO')):
            with self.assertRaises(self.m.CheckpointError):
                self.m.source_metadata_owned('source-record',self.root,self.sidecar,self.identity,platform_policy='mac-arm')

class SeparateInverse(unittest.TestCase):
    def test_noop_restores_fd_only_then_complete_original(self):
        restored=fd.noop_inverse(fd.RAW)
        self.assertEqual(hashlib.sha256(restored).hexdigest(),'75b9d75d5f33ccb433effabb560d168ade627352377afdff4939cd2920ba2b23')
        self.assertEqual(fd.inverse(restored)[0],fd.OLD)

if __name__=='__main__':unittest.main(verbosity=2)
