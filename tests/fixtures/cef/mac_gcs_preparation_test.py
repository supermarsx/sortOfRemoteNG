"""Portable JSON tests and real POSIX scratch I/O. No Darwin/source grant."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import io
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
HELPER = Path(sys.argv.pop(1)).resolve()
SPEC = importlib.util.spec_from_file_location('gcs_prep', HELPER)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
PINNED_WRITER = ('depot_tools/gclient_scm.py', 105463,
                 'b20ddbd39c6ae1f52386775a4fdc6493e7d5d5dc857b294ef50f79e06226b121')
assert m.WRITER == PINNED_WRITER
assert m.DEPOT_COMMIT == 'c101dcbe0489c455fce7c2247bfee19680b116c3'


def budget():
    return m.Budget(time.time_ns() // 1_000_000 + m.MAX_MS)


class JsonControls(unittest.TestCase):
    def test_object_keys_only_preserve_arrays_every_field_and_precise_scalars(self):
        raw = b'{"z":["second","first",true,false,null,1e+00,-0,9007199254740993,0.100000000000000000000001],"a":{"z":"1e+00","a":"\\u00e9"}}'
        value = m.canonical_bytes(raw, budget())
        self.assertLess(value.index(b'"a"'), value.index(b'"z"'))
        self.assertIn(b'"z": "1e+00"', value)
        self.assertIn(b'1e+00,\n', value)
        self.assertIn(b'-0,\n', value)
        self.assertIn(b'9007199254740993,\n', value)
        self.assertIn(b'0.100000000000000000000001\n', value)
        self.assertEqual(json.loads(raw, parse_int=m.Number, parse_float=m.Number),
                         json.loads(value, parse_int=m.Number, parse_float=m.Number))
        self.assertEqual(m.canonical_bytes(value, budget()), value)

    def test_actual_writer_shapes_and_empty_arrays_keep_standard_sorted_layout(self):
        value = {'src/z': {'src/z/data': ['b', 'a']}, 'src': {'src/a': [], 'src/b': ['fixed']}}
        expected = json.dumps(value, sort_keys=True, indent=2).encode()
        self.assertEqual(m.canonical_bytes(json.dumps(value).encode(), budget()), expected)

    def test_duplicate_keys_at_any_depth_are_rejected(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":{"a":0,"a":1}}', b'{"x":[{"a":0,"a":1}]}'):
            with self.subTest(raw=raw), self.assertRaisesRegex(m.PrepError, 'JSON_DUPLICATE'):
                m.canonical_bytes(raw, budget())

    def test_nonfinite_values_never_round_trip(self):
        for value in ('NaN', 'Infinity', '-Infinity'):
            with self.subTest(value=value), self.assertRaisesRegex(m.PrepError, 'JSON_NONFINITE'):
                m.canonical_bytes(('{"x":' + value + '}').encode(), budget())

    def test_invalid_root_syntax_utf8_and_surrogates_are_rejected(self):
        for raw in (b'[]', b'1', b'null', b'{"x":}', b'{"x":1,}', b'{"x":1} trailing',
                    b'{"x":"\xff"}', b'{"x":"\\ud800"}', b'\xef\xbb\xbf{}'):
            with self.subTest(raw=raw), self.assertRaises(m.PrepError):
                m.canonical_bytes(raw, budget())

    def test_bounds_cover_input_output_and_depth(self):
        with patch.object(m, 'MAX_BYTES', 64):
            for raw in (b'x' * 65, b'{"x":[1,2,3,4,5,6,7,8,9,10]}'):
                with self.subTest(raw=raw), self.assertRaisesRegex(m.PrepError, 'JSON_BOUND'):
                    m.canonical_bytes(raw, budget())
        raw = ('{"x":' + '[' * 65 + '0' + ']' * 65 + '}').encode()
        with self.assertRaisesRegex(m.PrepError, 'JSON_DEPTH'):
            m.canonical_bytes(raw, budget())

    def test_original_deadline_is_not_renewed(self):
        with self.assertRaisesRegex(m.PrepError, 'DEADLINE'):
            m.Budget(time.time_ns() // 1_000_000 - 1)
        with self.assertRaisesRegex(m.PrepError, 'DEADLINE'):
            m.Budget(time.time_ns() // 1_000_000 + m.MAX_MS + 1000)
        b = budget()
        b.mono_end = time.monotonic() - 1
        with self.assertRaisesRegex(m.PrepError, 'DEADLINE'):
            m.canonical_bytes(b'{}', b)

    def test_closed_cli_target_root_host_and_deadline_before_any_io(self):
        for target, source in m.SOURCES.items():
            root = '/Users/runner/work/_temp/sorng-cef-engineering/' + target + '/' + source + '/source'
            args = ['script', target, root, str(time.time_ns() // 1_000_000 + m.MAX_MS)]
            with (patch.object(m.sys, 'argv', args), patch.object(m.sys, 'platform', 'darwin'),
                  patch.object(m.platform, 'machine', return_value='x86_64'),
                  patch.object(m.signal, 'signal'), patch.object(m, 'normalize_root', return_value={'fixed': True}) as normalize,
                  patch.object(m.sys, 'stdout', io.StringIO()) as output):
                m.main()
                normalize.assert_called_once()
                self.assertEqual(normalize.call_args.args[0], Path(root))
                self.assertEqual(json.loads(output.getvalue()), {'fixed': True})
            cases = [('target', 'x86_64-unknown-linux-gnu'), ('root', root + '/..'),
                     ('root', root.replace(source, '0' * 64)), ('deadline', '9' * 13),
                     ('deadline', 'not-a-deadline'), ('host', 'arm64'), ('platform', 'linux')]
            for kind, value in cases:
                actual = list(args)
                if kind in ('target', 'root', 'deadline'):
                    actual[{'target': 1, 'root': 2, 'deadline': 3}[kind]] = value
                with (self.subTest(target=target, case=kind, value=value),
                      patch.object(m.sys, 'argv', actual),
                      patch.object(m.sys, 'platform', value if kind == 'platform' else 'darwin'),
                      patch.object(m.platform, 'machine', return_value=value if kind == 'host' else 'x86_64'),
                      patch.object(m, 'normalize_root', side_effect=AssertionError('no IO')),
                      self.assertRaises(m.PrepError)):
                    m.main()


@unittest.skipUnless(os.name == 'posix' and hasattr(os, 'O_NOFOLLOW'), 'real POSIX held-inode fixture')
class OwnedFileControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mac-gcs-prep-')
        self.root = Path(self.temp.name).resolve()
        (self.root / 'depot_tools').mkdir()
        # Owned scratch writer exercises real I/O without vendoring depot_tools.
        # The immutable actual writer pin is asserted above and on real source prep.
        writer = b'fixed scratch writer; never executed\n'
        self.writer_pin = patch.object(m, 'WRITER', (PINNED_WRITER[0], len(writer), hashlib.sha256(writer).hexdigest()))
        self.writer_pin.start()
        (self.root / m.WRITER[0]).write_bytes(writer)
        self.file = self.root / m.LEAF
        self.raw = b'{"z":{"b":["second","first"]},"a":{"n":[1e+00,-0,true,false,null]}}'
        self.file.write_bytes(self.raw)

    def tearDown(self):
        self.writer_pin.stop()
        self.temp.cleanup()

    def normalize(self):
        return m.normalize_root(self.root, budget())

    def test_write_uses_same_inode_preserves_mode_values_and_readback(self):
        before = self.file.stat()
        result = self.normalize()
        after = self.file.stat()
        self.assertTrue(result['changed'])
        self.assertEqual((before.st_dev, before.st_ino, before.st_mode),
                         (after.st_dev, after.st_ino, after.st_mode))
        self.assertEqual(self.file.read_bytes(), m.canonical_bytes(self.raw, budget()))
        self.assertFalse(result['runtimeReady'])
        self.assertEqual(result['outputSha256'], hashlib.sha256(self.file.read_bytes()).hexdigest())

    def test_already_canonical_does_not_write_or_touch_metadata(self):
        self.normalize()
        before = m.full(self.file.stat())
        with (patch.object(m.os, 'write', side_effect=AssertionError('no write')),
              patch.object(m.os, 'ftruncate', side_effect=AssertionError('no truncate'))):
            result = self.normalize()
        self.assertFalse(result['changed'])
        self.assertEqual(m.full(self.file.stat()), before)

    def test_invalid_json_is_refused_before_write(self):
        self.file.write_bytes(b'{"x":1,"x":2}')
        with (patch.object(m.os, 'write', side_effect=AssertionError('no write')),
              self.assertRaisesRegex(m.PrepError, 'JSON_DUPLICATE')):
            self.normalize()
        self.assertEqual(self.file.read_bytes(), b'{"x":1,"x":2}')

    def test_writer_pin_drift_is_refused_before_metadata_write(self):
        writer = self.root / m.WRITER[0]
        raw = writer.read_bytes()
        writer.write_bytes(b'x' + raw[1:])
        with (patch.object(m.os, 'write', side_effect=AssertionError('no write')),
              self.assertRaisesRegex(m.PrepError, 'WRITER_PIN')):
            self.normalize()
        self.assertEqual(self.file.read_bytes(), self.raw)

    def test_symlink_hardlink_directory_and_empty_file_are_denied(self):
        original = self.root / 'original'
        self.file.rename(original)
        for kind in ('symlink', 'hardlink', 'directory', 'empty'):
            with self.subTest(kind=kind):
                if kind == 'symlink':
                    self.file.symlink_to(original)
                elif kind == 'hardlink':
                    os.link(original, self.file)
                elif kind == 'directory':
                    self.file.mkdir()
                else:
                    self.file.write_bytes(b'')
                try:
                    with self.assertRaises(m.PrepError):
                        self.normalize()
                finally:
                    if kind == 'directory':
                        self.file.rmdir()
                    else:
                        self.file.unlink()
        self.assertEqual(original.read_bytes(), self.raw)

    def test_same_size_concurrent_content_change_is_denied_before_write(self):
        canonical = m.canonical_bytes
        full = m.full
        before = self.file.stat()

        def mutate(raw, b):
            result = canonical(raw, b)
            self.file.write_bytes(b' ' * len(self.raw))
            return result

        with (patch.object(m, 'canonical_bytes', mutate),
              # Explicitly model a timestamp-granularity collision on this inode.
              patch.object(m, 'full', side_effect=lambda info: full(before) if info.st_ino == before.st_ino else full(info)),
              patch.object(m.os, 'write', side_effect=AssertionError('no write')),
              self.assertRaisesRegex(m.PrepError, 'FILE_CHANGED')):
            self.normalize()

    def test_noop_still_rechecks_raw_bytes_after_parse(self):
        self.raw = m.canonical_bytes(self.raw, budget())
        self.file.write_bytes(self.raw)
        self.test_same_size_concurrent_content_change_is_denied_before_write()

    def test_cancellation_during_partial_write_aborts_and_joins_descriptors(self):
        real_write, real_close = m.os.write, m.os.close
        opened, closed = [], []
        real_open = m.os.open

        def opened_fd(*args, **kwargs):
            fd = real_open(*args, **kwargs)
            opened.append(fd)
            return fd

        def cancelled_write(fd, value):
            real_write(fd, value[:5])
            raise m.PrepError('CANCELLED')

        def close(fd):
            closed.append(fd)
            return real_close(fd)

        with (patch.object(m.os, 'open', opened_fd), patch.object(m.os, 'close', close),
              patch.object(m.os, 'write', cancelled_write),
              self.assertRaisesRegex(m.PrepError, 'CANCELLED')):
            self.normalize()
        self.assertEqual(sorted(opened), sorted(closed))
        self.assertNotEqual(self.file.read_bytes(), self.raw)

    def test_replaced_leaf_never_receives_the_write(self):
        canonical = m.canonical_bytes
        replacement = b'{"untouched":true}'

        def replace(raw, b):
            result = canonical(raw, b)
            self.file.rename(self.root / 'old-held')
            self.file.write_bytes(replacement)
            return result

        with (patch.object(m, 'canonical_bytes', replace),
              patch.object(m.os, 'write', side_effect=AssertionError('no write')),
              self.assertRaises(m.PrepError)):
            self.normalize()
        self.assertEqual(self.file.read_bytes(), replacement)
        self.assertEqual((self.root / 'old-held').read_bytes(), self.raw)

    def test_deadline_after_parse_prevents_any_write(self):
        canonical = m.canonical_bytes

        def expire(raw, b):
            result = canonical(raw, b)
            b.mono_end = time.monotonic() - 1
            return result

        with (patch.object(m, 'canonical_bytes', expire),
              patch.object(m.os, 'write', side_effect=AssertionError('no write')),
              self.assertRaisesRegex(m.PrepError, 'DEADLINE')):
            self.normalize()

    def test_falsy_primary_survives_secondary_close_failure_and_all_fds_join(self):
        class FalsyError(Exception):
            def __bool__(self):
                return False
        primary = FalsyError('fixed model')
        real_close = m.os.close
        real_read = m.os.read
        held = []
        closed = []

        def read(fd, count):
            if os.fstat(fd).st_ino == self.file.stat().st_ino:
                held.append(fd)
                raise primary
            return real_read(fd, count)

        def close(fd):
            real_close(fd)
            closed.append(fd)
            if fd in held:
                raise OSError('fixed secondary model')

        with patch.object(m.os, 'read', read), patch.object(m.os, 'close', close):
            with self.assertRaises(FalsyError) as caught:
                self.normalize()
        self.assertIs(caught.exception, primary)
        self.assertEqual(len(held), 1)
        self.assertEqual(closed.count(held[0]), 1)
        for fd in closed:
            with self.assertRaises(OSError):
                os.fstat(fd)


if __name__ == '__main__':
    unittest.main(verbosity=2)
