"""Private DATA controls. Injected stats are models, never native qualification."""
import ast
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
BASELINE = globals().get('HELD_BASELINE_RAW')
if BASELINE is None: BASELINE = (HERE / 'baseline.py').read_bytes()
CANDIDATE = globals().get('HELD_CANDIDATE_RAW')
if CANDIDATE is None: CANDIDATE = (HERE / 'candidate.py').read_bytes()
assert len(BASELINE) == 229058 and hashlib.sha256(BASELINE).hexdigest() == 'c728e702508d1a22417197c056d064c496528af82a29b5c993e6f4f521a74dcb'
assert len(CANDIDATE) == 228969 and hashlib.sha256(CANDIDATE).hexdigest() == '47d0866df8a9d4f5816a197db8db413b871e0170390384dfd2defdad6d27fc8e'


def load(raw):
    module = types.ModuleType('held_private_helper')
    exec(compile(raw, '<held-private-helper>', 'exec'), module.__dict__)
    return module


def functions(raw):
    text = raw.decode()
    return {node.name: ast.get_source_segment(text, node) for node in ast.parse(text).body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}


def inverse(raw):
    old, new = functions(BASELINE)['_source_mac_fd_hash'], functions(CANDIDATE)['_source_mac_fd_hash']
    assert raw.count(new.encode()) == 1
    result = raw.replace(new.encode(), old.encode(), 1)
    assert result == BASELINE
    return result


class BoundaryControls(unittest.TestCase):
    def test_whole_inverse_and_every_other_function_byte_identity(self):
        self.assertEqual(inverse(CANDIDATE), BASELINE)
        old, new = functions(BASELINE), functions(CANDIDATE)
        self.assertEqual(set(old), set(new))
        for name in old:
            if name != '_source_mac_fd_hash':
                self.assertEqual(old[name], new[name], name)
        for raw in (CANDIDATE.replace(b'held_after =', b'held_after  =', 1), CANDIDATE + b'\n'):
            with self.assertRaises(AssertionError):
                inverse(raw)

    def run_hash(self, raw, *, fault=None, body=None, close_error=None, expired=False):
        module = load(raw)
        with tempfile.TemporaryDirectory(prefix='stat-boundary-') as directory:
            path = Path(directory) / 'input'
            path.write_bytes(b'full actual bytes\x00\xff' * 100)
            actual = path.stat()
            def snapshot():
                value = types.SimpleNamespace(**{name: getattr(actual, name) for name in dir(actual) if name.startswith('st_')})
                value.st_birthtime_ns = 123456789
                return value
            before = snapshot()
            row = {'path': 'input', 'stamp': module.stamp(before), 'ctimeNs': before.st_ctime_ns,
                   'birthIdentity': ('MODEL', 123456789), 'uid': before.st_uid, 'gid': before.st_gid}
            counts = {'named': 0, 'held': 0, 'close': 0, 'bytes': 0}
            first = []
            class Leaf:
                scope = types.SimpleNamespace(record=lambda error: first.append(error))
                def __fspath__(self): return str(path)
                def stat(self):
                    counts['named'] += 1
                    value = snapshot()
                    if fault is not None: fault('named', counts['named'], value)
                    return value
                def open(self, mode):
                    actual_stream = path.open(mode)
                    class Stream:
                        def fileno(self): return actual_stream.fileno()
                        def read(self, size):
                            if body is not None: body(path, counts)
                            value = actual_stream.read(size); counts['bytes'] += len(value)
                            return value
                        def close(self):
                            counts['close'] += 1; actual_stream.close()
                            if close_error is not None: raise close_error
                    return Stream()
            def held(fd):
                counts['held'] += 1
                value = snapshot()
                if fault is not None: fault('held', counts['held'], value)
                return value
            class Budget:
                def check(self):
                    if expired: raise RuntimeError('original-expired-model')
            with patch.object(module.os, 'fstat', held), patch.object(module, 'source_birth_identity', lambda value: ('MODEL', value.st_birthtime_ns)):
                result = module._source_mac_fd_hash(Path(directory), row, Budget(), {'mac': True, 'ownedMacIntel': True}, Leaf())
            return result, counts, first

    def test_real_full_bytes_equal_and_exact_syscall_reduction(self):
        old, old_counts, _ = self.run_hash(BASELINE)
        new, new_counts, _ = self.run_hash(CANDIDATE)
        self.assertEqual(old, new)
        self.assertEqual(old_counts, {'named': 4, 'held': 6, 'close': 1, 'bytes': 1900})
        self.assertEqual(new_counts, {'named': 2, 'held': 2, 'close': 1, 'bytes': 1900})

    def test_every_original_identity_field_denies_at_each_captured_boundary(self):
        fields = ('st_size', 'st_mtime_ns', 'st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_ctime_ns', 'st_uid', 'st_gid', 'st_birthtime_ns')
        for boundary, ordinal in (('named', 1), ('held', 1), ('named', 2), ('held', 2)):
            for field in fields:
                def fault(kind, number, value):
                    if (kind, number) == (boundary, ordinal): setattr(value, field, getattr(value, field) + 1)
                with self.subTest(boundary=boundary, field=field), self.assertRaises(BaseException):
                    self.run_hash(CANDIDATE, fault=fault)

    def test_count_and_deadline_cannot_admit(self):
        def grow(path, counts):
            if not counts['bytes']:
                with path.open('ab') as output: output.write(b'x')
        with self.assertRaises(BaseException): self.run_hash(CANDIDATE, body=grow)
        with self.assertRaisesRegex(RuntimeError, 'original-expired-model'): self.run_hash(CANDIDATE, expired=True)

    def test_falsy_first_read_error_survives_real_close_secondary(self):
        class FalsyError(Exception):
            def __bool__(self): return False
        primary, secondary = FalsyError('fixed-model-primary'), RuntimeError('fixed-model-close')
        def fail(path, counts): raise primary
        with self.assertRaises(FalsyError) as result:
            self.run_hash(CANDIDATE, body=fail, close_error=secondary)
        self.assertIs(result.exception, primary)

    def test_close_uncertainty_denies_after_complete_hash(self):
        secondary = RuntimeError('fixed-model-close')
        with self.assertRaises(RuntimeError) as result: self.run_hash(CANDIDATE, close_error=secondary)
        self.assertIs(result.exception, secondary)


def candidate_filesystem_suite(fd_controls_raw, filename):
    """Reuse actual creation-owned scratch FS controls, without old inverse tests."""
    held = types.ModuleType('held_existing_fd_controls')
    held.__file__ = str(filename)
    held.HELD_HELPER_RAW = BASELINE
    exec(compile(fd_controls_raw, str(filename), 'exec'), held.__dict__)
    class CandidateFilesystem(held.OwnedFilesystem):
        def setUp(self):
            held.RAW = CANDIDATE
            try: super().setUp()
            finally: held.RAW = BASELINE
    return unittest.defaultTestLoader.loadTestsFromTestCase(CandidateFilesystem)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(BoundaryControls)
    if len(sys.argv) == 2:
        filename = Path(sys.argv[1]).resolve()
        suite.addTests(candidate_filesystem_suite(filename.read_bytes().replace(b'\r\n', b'\n'), filename))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
