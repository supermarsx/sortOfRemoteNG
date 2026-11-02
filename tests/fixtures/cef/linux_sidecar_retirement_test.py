"""Inactive primitive tests; only Linux x64 cases use real inherited FDs/kernel."""
import copy
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / 'scripts/lib/cef-linux-sidecar-retirement.py'
spec = importlib.util.spec_from_file_location('retirement', HELPER)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def record():
    return {'schemaVersion': 1, 'kind': 'sorng-linux-owned-sidecar-retirement',
        'originalEndMs': time.time_ns() // 1000000 + 30000,
        'file': dict(zip(m.STAMP, ('1', '2', '3', '33152', '1', '1', '1', '1'))),
        'sourceDirectory': dict(zip(m.DIRECTORY, ('1', '3', '3', '16832'))),
        'destinationDirectory': dict(zip(m.DIRECTORY, ('1', '4', '3', '16832'))),
        'sha256': 'a' * 64}


class PortableBoundaries(unittest.TestCase):
    def host(self):
        return patch.multiple(m.sys, platform='linux')

    def test_unknown_actual_host_denies_before_descriptor_io(self):
        with patch.object(m.sys, 'platform', 'darwin'), patch.object(m.os, 'fstat', side_effect=AssertionError('no fd IO')):
            with self.assertRaisesRegex(m.RetirementError, 'RETIRE_HOST'):
                m.validate(record())
        with self.host(), patch.object(m.platform, 'machine', return_value='aarch64'):
            with self.assertRaisesRegex(m.RetirementError, 'RETIRE_HOST'):
                m.validate(record())

    def test_closed_record_schema_pin_bounds_and_original_deadline(self):
        with self.host(), patch.object(m.platform, 'machine', return_value='x86_64'):
            self.assertGreater(m.validate(record()), time.monotonic())
            mutations = (
                lambda r: r.update(path='/arbitrary'),
                lambda r: r.update(schemaVersion=True),
                lambda r: r.update(originalEndMs=1),
                lambda r: r.update(originalEndMs=time.time_ns() // 1000000 + m.MAX_HOST_MS + 60000),
                lambda r: r.update(sha256='PRIVATE'),
                lambda r: r['file'].update(nlink='2'),
                lambda r: r['file'].update(size=str(m.MAX_BYTES + 1)),
                lambda r: r['sourceDirectory'].update(path='/arbitrary'),
            )
            for mutate in mutations:
                item = record(); mutate(item)
                with self.subTest(item=item), self.assertRaises(m.RetirementError):
                    m.validate(item)

    def test_no_arbitrary_argv_syscall_or_fallback(self):
        source = HELPER.read_text()
        self.assertNotIn('subprocess', source)
        self.assertNotIn('os.rename(', source)
        self.assertNotIn('os.unlink(', source)
        self.assertNotIn('os.link(', source)
        with patch.object(m.ctypes, 'CDLL', return_value=object()):
            with self.assertRaisesRegex(m.RetirementError, 'RETIRE_UNSUPPORTED'):
                m.rename_no_replace()
        for number in (errno.ENOSYS, errno.EINVAL, errno.EEXIST):
            calls = []
            class Function:
                def __call__(self, *args):
                    calls.append(args)
                    return -1
            library = type('Library', (), {'renameat2': Function()})()
            with patch.object(m.ctypes, 'CDLL', return_value=library), patch.object(m.ctypes, 'get_errno', return_value=number):
                with self.assertRaises(OSError) as caught:
                    m.rename_no_replace()
            self.assertEqual(caught.exception.errno, number)
            self.assertEqual(calls, [(3, m.LEAF, 5, m.LEAF, 1)])

    def test_close_faults_do_not_replace_original_failure_and_all_fds_close(self):
        primary = m.RetirementError('RETIRE_DEADLINE')
        secondary = OSError(errno.EIO, 'PRIVATE CLOSE')
        result = m.result_record(); calls = []
        def close(fd):
            calls.append(fd)
            if fd == 4:
                raise secondary
        with patch.object(m, 'validate', side_effect=primary), patch.object(m.os, 'close', side_effect=close):
            with self.assertRaises(m.RetirementError) as caught:
                m.execute(record(), result)
        self.assertIs(caught.exception, primary)
        self.assertEqual(calls, [3, 4, 5])
        self.assertFalse(result['complete'])
        self.assertFalse(result['descriptorsClosed'])
        self.assertEqual(result['closeFailures'], 1)
        self.assertFalse(result['renamed'])

    def test_failure_after_rename_keeps_actual_partial_state_and_original_error(self):
        primary = m.RetirementError('RETIRE_DEADLINE')
        result = m.result_record(); checks = 0
        def check(_):
            nonlocal checks
            checks += 1
            if checks == 3:
                raise primary
        stamp = record()['file']
        with patch.object(m, 'validate', return_value=1), patch.object(m, 'check', side_effect=check), \
             patch.object(m, 'held_directories'), patch.object(m, 'hash_held', return_value=stamp), \
             patch.object(m, 'stamp', return_value=stamp), patch.object(m.os, 'stat'), patch.object(m.os, 'fstat'), \
             patch.object(m, 'absent'), patch.object(m, 'rename_no_replace') as rename, patch.object(m.os, 'close'):
            with self.assertRaises(m.RetirementError) as caught:
                m.execute(record(), result)
        self.assertIs(caught.exception, primary)
        rename.assert_called_once_with()
        self.assertTrue(result['renamed'])
        self.assertFalse(result['readback'])
        self.assertFalse(result['complete'])
        self.assertTrue(result['descriptorsClosed'])

    def test_source_substitution_readback_failure_reports_move_without_rollback(self):
        primary = m.RetirementError('RETIRE_READBACK')
        result = m.result_record(); original = record()['file']
        with patch.object(m, 'validate', return_value=1), patch.object(m, 'check'), \
             patch.object(m, 'held_directories'), patch.object(m, 'hash_held', side_effect=[original, primary]), \
             patch.object(m, 'stamp', return_value=original), patch.object(m.os, 'stat'), patch.object(m.os, 'fstat'), \
             patch.object(m, 'absent'), patch.object(m, 'rename_no_replace') as rename, patch.object(m.os, 'close'), \
             patch.object(m.os, 'unlink', side_effect=AssertionError('no rollback/unlink')):
            with self.assertRaises(m.RetirementError) as caught:
                m.execute(record(), result)
        self.assertIs(caught.exception, primary)
        rename.assert_called_once_with()
        self.assertTrue(result['renamed'])
        self.assertFalse(result['readback'] or result['complete'])
        self.assertTrue(result['descriptorsClosed'])


BOOTSTRAP = r'''
import fcntl,os,pathlib,sys
root=pathlib.Path(sys.argv[1]);helper=sys.argv[2]
fds=[os.open(root/'source',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW),
     os.open(root/'source/.siso_sorng_source_metadata.json',os.O_RDONLY|os.O_NOFOLLOW),
     os.open(root/'retired',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)]
high=[fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,10)for fd in fds]
for fd in fds:os.close(fd)
for source,target in zip(high,(3,4,5)):os.dup2(source,target,inheritable=True)
for fd in high:os.close(fd)
os.execv(sys.executable,[sys.executable,'-I','-B','-S',helper])
'''
RACE_BOOTSTRAP = BOOTSTRAP[:BOOTSTRAP.index('os.execv')] + r'''
import importlib.util
spec=importlib.util.spec_from_file_location('owned_retire_race',helper)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=m.rename_no_replace
def race():
 leaf=root/'source'/m.LEAF.decode()
 leaf.rename(root/'still-held-original')
 leaf.write_bytes(b'foreign replacement owned by test')
 original()
m.rename_no_replace=race
sys.argv=[helper]
sys.exit(m.main())
'''


@unittest.skipUnless(sys.platform == 'linux' and m.platform.machine() == 'x86_64',
    'requires genuine Linux x64 inherited descriptors and renameat2; not ARM native acceptance')
class ActualKernel(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cef-linux-retirement-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in ('source', 'retired'):
            (self.root / name).mkdir(mode=0o700)
        self.leaf = self.root / 'source' / m.LEAF.decode()
        self.leaf.write_bytes(b'actual creation-owned fixture sidecar\n')
        self.pin = record()
        self.pin.update(file=m.stamp(self.leaf.stat()),
            sourceDirectory=m.directory((self.root / 'source').stat()),
            destinationDirectory=m.directory((self.root / 'retired').stat()),
            sha256=hashlib.sha256(self.leaf.read_bytes()).hexdigest())

    def run_helper(self, race=False):
        raw = (json.dumps(self.pin, sort_keys=True, separators=(',', ':')) + '\n').encode()
        result = subprocess.run([sys.executable, '-I', '-B', '-S', '-c', RACE_BOOTSTRAP if race else BOOTSTRAP, str(self.root), str(HELPER)],
            input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        self.assertLess(len(result.stdout), 4096)
        self.assertNotIn(b'PRIVATE', result.stdout)
        return result.returncode, json.loads(result.stdout)

    def test_actual_no_replace_move_preserves_held_file_and_reports_closed(self):
        old = self.leaf.stat(); raw = self.leaf.read_bytes()
        code, value = self.run_helper()
        self.assertEqual(code, 0, value)
        self.assertTrue(value['complete'] and value['renamed'] and value['readback'] and value['descriptorsClosed'])
        self.assertFalse(value['migrationAdmitted'] or value['nativeAcceptance'] or value['runtimeReady'])
        retired = self.root / 'retired' / m.LEAF.decode()
        self.assertFalse(self.leaf.exists())
        self.assertEqual(retired.read_bytes(), raw)
        self.assertEqual((retired.stat().st_dev, retired.stat().st_ino, retired.stat().st_nlink), (old.st_dev, old.st_ino, 1))

    def test_existing_destination_preserved_and_never_overwritten(self):
        target = self.root / 'retired' / m.LEAF.decode(); target.write_bytes(b'unrelated destination')
        code, value = self.run_helper()
        self.assertEqual(code, 1)
        self.assertEqual(value['error'], 'RETIRE_DESTINATION_EXISTS')
        self.assertFalse(value['renamed'])
        self.assertEqual(target.read_bytes(), b'unrelated destination')
        self.assertTrue(self.leaf.exists())

    def test_same_length_drift_inode_replacement_and_hardlinks_deny(self):
        raw = self.leaf.read_bytes()
        self.leaf.write_bytes(b'x' * len(raw))
        _, value = self.run_helper(); self.assertFalse(value['renamed'])
        self.leaf.rename(self.root / 'original-inode-kept-alive'); self.leaf.write_bytes(raw)
        _, value = self.run_helper(); self.assertFalse(value['renamed'])
        self.pin['file'] = m.stamp(self.leaf.stat())
        os.link(self.leaf, self.root / 'extra-link')
        _, value = self.run_helper(); self.assertFalse(value['renamed'])
        self.assertTrue(self.leaf.exists())

    def test_actual_source_leaf_swap_is_detected_without_claiming_inode_cas(self):
        original = self.leaf.read_bytes()
        code, value = self.run_helper(race=True)
        self.assertEqual(code, 1)
        self.assertTrue(value['renamed'])
        self.assertFalse(value['readback'] or value['complete'])
        self.assertEqual(value['error'], 'RETIRE_READBACK')
        self.assertEqual((self.root / 'still-held-original').read_bytes(), original)
        self.assertEqual((self.root / 'retired' / m.LEAF.decode()).read_bytes(), b'foreign replacement owned by test')
        self.assertFalse(self.leaf.exists())

    def test_replaced_destination_directory_and_expired_original_end_deny(self):
        (self.root / 'retired').rename(self.root / 'original-retired')
        (self.root / 'retired').mkdir(mode=0o700)
        _, value = self.run_helper(); self.assertFalse(value['renamed'])
        self.pin['destinationDirectory'] = m.directory((self.root / 'retired').stat())
        self.pin['originalEndMs'] = 1
        _, value = self.run_helper()
        self.assertEqual(value['error'], 'RETIRE_DEADLINE')
        self.assertFalse(value['renamed'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
