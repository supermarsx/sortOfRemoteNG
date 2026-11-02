"""Actual local file sidecar tests; no source checkout, compiler or Job actor."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import checkpoint_inputs as subject


class CheckpointInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name).resolve()
        self.identity = dict(image='20261030.294.1', sourceId=subject.SOURCES['20261030.294.1'],
                             producerSha256='a' * 64, sourceDateEpoch=dict(present=True, value='1700000000'))
        self.root = self.repo / '.artifacts' / subject.root_name(self.identity['image'], self.identity['sourceId'])
        self.root.mkdir(parents=True)
        self.patch = patch.object(subject, 'REPO', self.repo)
        self.patch.start()
        self.calls = 0
        self.clock = types.SimpleNamespace(remaining=lambda: 600)
        def fence():
            self.calls += 1
        self.fence = fence
        for name in subject.NAMESPACES:
            (self.root / name).mkdir()
        (self.root / 'source-checkout/src').mkdir()
        (self.root / 'source-checkout/src/out').mkdir()
        (self.root / 'source-checkout/.git').mkdir()
        (self.root / 'source-checkout/src/input.cc').write_bytes(b'fixed source\n')
        (self.root / 'llvm/tool.exe').write_bytes(b'fixed tool\n')
        (self.root / 'runtime/empty').write_bytes(b'')
        self.files = [self.root / name for name in ('source-checkout/src/input.cc', 'llvm/tool.exe', 'runtime/empty')]
        self.ns = 1700000000123456700
        for file in self.files:
            os.utime(file, ns=(self.ns, self.ns))

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def record(self):
        return subject.record_inputs(self.root, self.identity, self.clock, self.fence)['sidecar']

    def fresh_times(self):
        for file in self.files:
            os.utime(file, ns=(self.ns + 1000000000, self.ns + 1000000000))

    def apply(self, pin):
        return subject.apply_inputs(self.root, self.identity, pin, self.clock, self.fence)

    def tamper_sidecar(self, transform):
        file = self.root / subject.SIDECAR
        rows = [json.loads(line) for line in file.read_bytes().splitlines()]
        raw = b''.join(subject._line(row) for row in transform(rows))
        file.write_bytes(raw)
        return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())

    def test_real_windows_same_handle_timestamp_restore_and_excluded_outputs(self):
        pin = self.record()
        # Output transport owns these; they must neither be hashed nor retimed.
        (self.root / 'source-checkout/src/out/compiled.obj').write_bytes(b'changed output')
        (self.root / 'source-checkout/.git/private').write_bytes(b'changed git')
        self.fresh_times()
        result = self.apply(pin)
        self.assertTrue(result['dataOnly'])
        self.assertTrue(result['timestampsApplied'])
        self.assertFalse(result['executionAdmitted'])
        self.assertFalse(result['checkpointAdmission'])
        self.assertEqual(result['files'], 3)
        self.assertTrue(all(file.stat().st_mtime_ns == self.ns for file in self.files))
        self.assertGreater(self.calls, 20)

    def test_entire_fresh_tree_denied_before_any_timestamp_for_changed_extra_missing(self):
        for case in ('bytes', 'extra', 'missing'):
            with self.subTest(case=case):
                # Recreate each case without touching other production paths.
                if (self.root / subject.SIDECAR).exists():
                    (self.root / subject.SIDECAR).unlink()
                for file, raw in zip(self.files, (b'fixed source\n', b'fixed tool\n', b'')):
                    file.write_bytes(raw)
                    os.utime(file, ns=(self.ns, self.ns))
                extra = self.root / 'siso/extra'
                if extra.exists():
                    extra.unlink()
                pin = self.record()
                self.fresh_times()
                if case == 'bytes':
                    self.files[0].write_bytes(b'wrong bytes!\n')
                elif case == 'extra':
                    extra.write_bytes(b'extra')
                else:
                    self.files[0].unlink()
                with patch.object(subject, '_set_mtime', side_effect=AssertionError('mutation before full validation')):
                    with self.assertRaisesRegex(ValueError, 'BYTES|NAME_SET|END'):
                        self.apply(pin)

    def test_sidecar_identity_pin_path_type_and_duplicate_equivalent_are_strict(self):
        pin = self.record()
        for key, value in (('image', 'foreign'), ('sourceId', 'b' * 64), ('producerSha256', 'b' * 64),
                           ('sourceDateEpoch', dict(present=False, value=None))):
            identity = copy.deepcopy(self.identity)
            identity[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                subject.apply_inputs(self.root, identity, pin, self.clock, self.fence)
        with self.assertRaisesRegex(ValueError, 'SIDECAR_CHANGED'):
            self.apply(dict(pin, sha256='b' * 64))
        for raw in (b'{"a":1,"a":2}\n', b'{"a":1,"\\u0061":2}\n', b'{"a":1}', b'{"a":NaN}\n'):
            with self.assertRaises((ValueError, UnicodeError)):
                subject._parse(raw)
        for name in ('../escape', 'llvm/../escape', 'llvm\\escape', 'llvm/CON', 'llvm/name.', 'external/tool',
                     'source-checkout/src/out/object', 'source-checkout/.git/config'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'PATH|NAMESPACE'):
                subject._name(name)
        changed = self.tamper_sidecar(lambda rows: [dict(rows[0], schemaVersion=True), *rows[1:]])
        with self.assertRaisesRegex(ValueError, 'HEADER'):
            self.apply(changed)

    def test_case_alias_hardlink_and_symlink_are_denied(self):
        link = self.root / 'llvm/alias'
        os.link(self.files[0], link)
        with self.assertRaisesRegex(ValueError, 'REGULAR'):
            self.record()
        link.unlink()
        (self.root / subject.SIDECAR).unlink()
        self.assertEqual(subject._name('llvm/Name'), subject._name('llvm/name'))
        try:
            link.symlink_to(self.files[0])
        except OSError:
            return  # Windows without symlink privilege still tests real hardlinks.
        with self.assertRaisesRegex(ValueError, 'REGULAR'):
            self.record()

    def test_actual_unicode_normalization_aliases_are_denied(self):
        # NTFS stores distinct Unicode spellings; the sidecar rejects names that
        # would alias under its strict canonical namespace comparison.
        (self.root / 'llvm/caf\u00e9').write_bytes(b'one')
        (self.root / 'llvm/cafe\u0301').write_bytes(b'two')
        self.assertEqual(len(list((self.root / 'llvm').iterdir())), 3)
        with self.assertRaisesRegex(ValueError, 'CASE_ALIAS'):
            self.record()

    def test_falsy_first_deadline_rollback_and_owner_retirement_prevent_mutation(self):
        pin = self.record()
        self.fresh_times()
        class FalsyError(Exception):
            def __bool__(self): return False
        error = FalsyError('original lease denied')
        def expired(): raise error
        with patch.object(subject, '_set_mtime', side_effect=AssertionError('late mutation')):
            with self.assertRaises(FalsyError) as caught:
                subject.apply_inputs(self.root, self.identity, pin, types.SimpleNamespace(remaining=expired), self.fence)
        self.assertIs(caught.exception, error)
        for remaining in (False, 0, float('nan'), float('inf')):
            with self.subTest(remaining=remaining), self.assertRaisesRegex(ValueError, 'DEADLINE'):
                subject.apply_inputs(self.root, self.identity, pin, types.SimpleNamespace(remaining=lambda: remaining), self.fence)
        guard = subject._Guard(self.root, subject._identity(self.identity), self.clock, self.fence)
        with patch.object(subject.time, 'time', return_value=guard.wall - 1):
            with self.assertRaisesRegex(ValueError, 'CLOCK_ROLLBACK') as denied:
                guard.check()
        with self.assertRaises(ValueError) as again:
            guard.check()
        self.assertIs(again.exception, denied.exception)
        with self.assertRaisesRegex(RuntimeError, 'retired'):
            subject.apply_inputs(self.root, self.identity, pin, self.clock, lambda: (_ for _ in ()).throw(RuntimeError('retired')))
        left = {'seconds': 600}
        def late_fence(): left['seconds'] = 0
        with self.assertRaisesRegex(ValueError, 'DEADLINE'):
            subject.apply_inputs(self.root, self.identity, pin,
                                 types.SimpleNamespace(remaining=lambda: left['seconds']), late_fence)

    def test_original_fixed_root_epoch_and_policy_bounds(self):
        self.assertEqual(self.root.name, 'windows-arm-full-sdk-bb3bd4a8-e93c-44e5-81f2-3ddc15a01d19')
        self.assertEqual(subject.root_name('20261021.278.1', subject.SOURCES['20261021.278.1']),
                         'windows-arm-full-sdk-adaa4b45-ea3f-4a01-b88f-10a988c6b0ac')
        self.assertEqual((subject.MAX_ENTRIES, subject.MAX_FILE, subject.MAX_RAW, subject.MAX_SIDECAR),
                         (3000000, 8 * 1024**3, 256 * 1024**3, 1536 * 1024**2))
        self.assertFalse(subject.EXECUTION_ADMITTED)
        changed = copy.deepcopy(self.identity)
        changed['sourceDateEpoch'] = dict(present=False, value='0')
        with self.assertRaisesRegex(ValueError, 'EPOCH'):
            subject._identity(changed)

    def test_owned_file_close_uncertainty_preserves_falsy_first_failure(self):
        class FalsyError(Exception):
            def __bool__(self): return False
        original, close_error = FalsyError('first'), RuntimeError('close uncertain')
        fdopen, closed = subject.os.fdopen, []
        class Wrapped:
            def __init__(self, stream): self.stream = stream
            def __getattr__(self, name): return getattr(self.stream, name)
            def close(self):
                self.stream.close()
                closed.append(True)
                raise close_error
        guard = subject._Guard(self.root, subject._identity(self.identity), self.clock, self.fence)
        with patch.object(subject.os, 'fdopen', side_effect=lambda *a, **k: Wrapped(fdopen(*a, **k))):
            with self.assertRaises(FalsyError) as caught:
                with subject._file(self.files[0], guard):
                    raise original
            self.assertIs(caught.exception, original)
            with self.assertRaises(RuntimeError) as caught:
                with subject._file(self.files[0], guard):
                    pass
            self.assertIs(caught.exception, close_error)
        self.assertEqual(len(closed), 2)

    def test_change_after_complete_validation_reheld_before_first_mutation(self):
        pin = self.record()
        self.fresh_times()
        verify = subject._verify
        def raced(*args, **kwargs):
            result = verify(*args, **kwargs)
            # Sorted namespace llvm is the first file; retain its bytes but
            # replace the physical file after the complete initial verification.
            file = self.files[1]
            raw = file.read_bytes()
            file.unlink()
            file.write_bytes(raw)
            return result
        with patch.object(subject, '_verify', side_effect=raced), patch.object(subject, '_set_mtime', side_effect=AssertionError('mutated replaced file')):
            with self.assertRaisesRegex(ValueError, 'CHANGED'):
                self.apply(pin)

    def test_actual_excluded_gitfile_old_directory_red_new_restore_green_and_unsafe_deny(self):
        gitfile = self.root / 'source-checkout/.git'
        gitfile.rmdir()  # The fixture created this empty physical directory.
        gitfile.write_bytes(b'gitdir: Z:/target-that-must-never-be-opened\n')
        # Replay only the exact former exclusion check against the actual file.
        with patch.object(subject, '_git_metadata', side_effect=lambda p: subject._directory(p.lstat())):
            with self.assertRaisesRegex(ValueError, 'DIRECTORY'):
                self.record()
        (self.root / subject.SIDECAR).unlink()
        pin = self.record()
        self.fresh_times()
        self.assertTrue(self.apply(pin)['timestampsApplied'])
        self.assertEqual(gitfile.read_bytes(), b'gitdir: Z:/target-that-must-never-be-opened\n')
        gitfile.unlink()
        os.link(self.files[0], gitfile)
        with self.assertRaisesRegex(ValueError, 'REGULAR'):
            self.apply(pin)
        gitfile.unlink()
        gitfile.write_bytes(b'x' * 65537)
        with self.assertRaisesRegex(ValueError, 'GIT_METADATA_BOUND'):
            self.apply(pin)
        # Model an actual Windows reparse attribute without requiring symlink
        # privilege; it must deny before any metadata target read can occur.
        info = gitfile.lstat()
        reparse = types.SimpleNamespace(st_mode=info.st_mode, st_nlink=1, st_file_attributes=0x400)
        with patch.object(Path, 'lstat', return_value=reparse):
            with self.assertRaisesRegex(ValueError, 'REGULAR'):
                subject._git_metadata(gitfile)


if __name__ == '__main__':
    unittest.main()
