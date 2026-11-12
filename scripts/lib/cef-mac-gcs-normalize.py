"""Fixed fresh-source preparation, never a source verifier or checkpoint grant.

The c101dcbe depot_tools GcsRoot writer serializes an insertion-ordered dict.
Normalize that bookkeeping ONCE after dependency hooks, before any snapshot.
No fields are omitted; arrays and scalar values (including number tokens) stay.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import signal
import stat
import sys
import time

LEAF = '.gcs_entries'
MAX_BYTES = 1024 * 1024
MAX_DEPTH = 64
MAX_MS = 5000
WRITER = ('depot_tools/gclient_scm.py', 105463,
          'b20ddbd39c6ae1f52386775a4fdc6493e7d5d5dc857b294ef50f79e06226b121')
DEPOT_COMMIT = 'c101dcbe0489c455fce7c2247bfee19680b116c3'
SOURCES = {
    'x86_64-apple-darwin': '684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef',
    'aarch64-apple-darwin': '65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54',
}


class PrepError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def need(value, code):
    if not value:
        raise PrepError(code)


class Budget:
    def __init__(self, deadline_ms):
        need(type(deadline_ms) is int, 'DEADLINE')
        now = time.time_ns() // 1_000_000
        remaining = deadline_ms - now
        need(0 < remaining <= MAX_MS, 'DEADLINE')
        self.wall_start, self.wall_end = now, deadline_ms
        self.mono_start = time.monotonic()
        self.mono_end = self.mono_start + remaining / 1000
        self.last_wall, self.last_mono = now, self.mono_start

    def check(self):
        wall, mono = time.time_ns() // 1_000_000, time.monotonic()
        need(self.last_wall <= wall < self.wall_end and
             self.last_mono <= mono < self.mono_end, 'DEADLINE')
        self.last_wall, self.last_mono = wall, mono


class Number(str):
    """An already-validated JSON number token; never rounded through a float."""


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'JSON_DUPLICATE')
        result[key] = value
    return result


def invalid_constant(_value):
    raise PrepError('JSON_NONFINITE')


def canonical_bytes(raw, budget):
    need(type(raw) is bytes and 0 < len(raw) <= MAX_BYTES, 'JSON_BOUND')
    budget.check()
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_pairs,
                           parse_int=Number, parse_float=Number,
                           parse_constant=invalid_constant)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise PrepError('JSON_INVALID') from None
    need(type(value) is dict, 'JSON_ROOT')

    def quote(value):
        need(not any(0xD800 <= ord(c) <= 0xDFFF for c in value), 'JSON_UNICODE')
        return json.dumps(value, ensure_ascii=True)

    pieces, count = [], 0

    def emit(piece):
        nonlocal count
        count += len(piece)  # Every emitted character is ASCII.
        need(count <= MAX_BYTES, 'JSON_BOUND')
        pieces.append(piece)

    def encode(value, depth):
        budget.check()
        need(depth <= MAX_DEPTH, 'JSON_DEPTH')
        if isinstance(value, Number):
            emit(str(value))
            return
        if type(value) is str:
            emit(quote(value))
            return
        if value is None:
            emit('null')
            return
        if type(value) is bool:
            emit('true' if value else 'false')
            return
        indent = '  ' * (depth + 1)
        closing = '  ' * depth
        if type(value) is list:
            if not value:
                emit('[]')
                return
            emit('[\n')
            for index, child in enumerate(value):
                if index:
                    emit(',\n')
                emit(indent)
                encode(child, depth + 1)
            emit('\n' + closing + ']')
            return
        need(type(value) is dict, 'JSON_SHAPE')
        if not value:
            emit('{}')
            return
        emit('{\n')
        for index, key in enumerate(sorted(value)):
            if index:
                emit(',\n')
            emit(indent)
            emit(quote(key))
            emit(': ')
            encode(value[key], depth + 1)
        emit('\n' + closing + '}')

    encode(value, 0)
    result = ''.join(pieces).encode('ascii')
    need(0 < len(result) <= MAX_BYTES, 'JSON_BOUND')
    budget.check()
    return result


def birth(info):
    value = getattr(info, 'st_birthtime_ns', None)
    if value is not None:
        need(type(value) is int and 0 <= value < 2**63, 'IDENTITY')
        return ('ns', str(value))
    value = getattr(info, 'st_birthtime', None)
    if value is not None:
        need(type(value) is float and math.isfinite(value) and 0 <= value < 2**63, 'IDENTITY')
        return ('float-hex', value.hex())
    need(sys.platform != 'darwin', 'IDENTITY')
    return None  # Real POSIX scratch checks on Linux do not model Darwin facts.


def stable(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_uid, info.st_gid, birth(info))


def full(info):
    return stable(info) + (info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def close_owned(fds, primary):
    first = primary
    for fd in reversed(fds):
        try:
            os.close(fd)
        except BaseException as error:
            if first is None:
                first = error
    if primary is None and first is not None:
        raise first


def physical(root, budget):
    need(root.is_absolute() and str(root) == os.path.abspath(root), 'ROOT')
    for directory in (*reversed(root.parents), root):
        budget.check()
        info = directory.lstat()
        need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'ROOT')


def checked_read(fd, maximum, budget):
    blocks, count = [], 0
    while True:
        budget.check()
        value = os.read(fd, min(65536, maximum + 1 - count))
        if not value:
            return b''.join(blocks)
        count += len(value)
        need(count <= maximum, 'FILE_BOUND')
        blocks.append(value)


def verify_writer(root, budget):
    writer = root / WRITER[0]
    physical(writer.parent, budget)
    before = writer.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
         before.st_uid == os.geteuid() and before.st_size == WRITER[1], 'WRITER_PIN')
    fds, primary = [], None
    try:
        fd = os.open(writer, os.O_RDONLY | os.O_NOFOLLOW)
        fds.append(fd)
        need(full(os.fstat(fd)) == full(before), 'WRITER_IDENTITY')
        raw = checked_read(fd, WRITER[1], budget)
        need(len(raw) == WRITER[1] and hashlib.sha256(raw).hexdigest() == WRITER[2], 'WRITER_PIN')
        need(full(writer.lstat()) == full(os.fstat(fd)) == full(before), 'WRITER_IDENTITY')
    except BaseException as error:
        primary = error
        raise
    finally:
        close_owned(fds, primary)


def normalize_root(root, budget):
    root = Path(root)
    physical(root, budget)
    verify_writer(root, budget)
    before_root = root.lstat()
    need(before_root.st_uid == os.geteuid(), 'ROOT_OWNER')
    fds, primary = [], None
    try:
        rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fds.append(rootfd)

        def root_current():
            physical(root, budget)
            need(full(root.lstat()) == full(os.fstat(rootfd)) == full(before_root), 'ROOT_CHANGED')

        root_current()
        before = os.stat(LEAF, dir_fd=rootfd, follow_symlinks=False)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
             before.st_uid == os.geteuid() and 0 < before.st_size <= MAX_BYTES, 'FILE_SHAPE')
        fd = os.open(LEAF, os.O_RDWR | os.O_NOFOLLOW, dir_fd=rootfd)
        fds.append(fd)

        def named():
            return os.stat(LEAF, dir_fd=rootfd, follow_symlinks=False)

        need(full(os.fstat(fd)) == full(named()) == full(before), 'FILE_CHANGED')
        raw = checked_read(fd, before.st_size, budget)
        need(len(raw) == before.st_size and full(os.fstat(fd)) == full(named()) == full(before), 'FILE_CHANGED')
        canonical = canonical_bytes(raw, budget)
        root_current()
        need(full(os.fstat(fd)) == full(named()) == full(before), 'FILE_CHANGED')
        # Timestamp granularity alone cannot expose every same-size overwrite.
        os.lseek(fd, 0, os.SEEK_SET)
        need(checked_read(fd, before.st_size, budget) == raw, 'FILE_CHANGED')
        need(full(os.fstat(fd)) == full(named()) == full(before), 'FILE_CHANGED')
        changed = canonical != raw
        if changed:
            os.lseek(fd, 0, os.SEEK_SET)
            position = 0
            while position < len(canonical):
                budget.check()
                root_current()
                need(stable(os.fstat(fd)) == stable(named()) == stable(before), 'FILE_CHANGED')
                block = memoryview(canonical)[position:position + 65536]
                wrote = os.write(fd, block)
                need(0 < wrote <= len(block), 'FILE_WRITE')
                position += wrote
            budget.check()
            root_current()
            need(stable(os.fstat(fd)) == stable(named()) == stable(before), 'FILE_CHANGED')
            os.ftruncate(fd, len(canonical))
            budget.check()
            os.fsync(fd)
            after = os.fstat(fd)
            need(stable(after) == stable(before) and full(named()) == full(after), 'FILE_CHANGED')
            os.lseek(fd, 0, os.SEEK_SET)
            need(checked_read(fd, len(canonical), budget) == canonical, 'FILE_READBACK')
            need(full(os.fstat(fd)) == full(named()) == full(after), 'FILE_CHANGED')
        root_current()
        budget.check()
        return {'kind': 'mac-gcs-fresh-preparation', 'changed': changed,
                'inputBytes': len(raw), 'outputBytes': len(canonical),
                'inputSha256': hashlib.sha256(raw).hexdigest(),
                'outputSha256': hashlib.sha256(canonical).hexdigest(),
                'runtimeReady': False}
    except BaseException as error:
        primary = error
        raise
    finally:
        close_owned(fds, primary)


def main():
    need(len(sys.argv) == 4, 'ARGUMENTS')
    target, root, deadline = sys.argv[1:]
    need(target in SOURCES and sys.platform == 'darwin' and platform.machine() == 'x86_64', 'TARGET')
    expected = '/Users/runner/work/_temp/sorng-cef-engineering/' + target + '/' + SOURCES[target] + '/source'
    need(root == expected and deadline.isascii() and deadline.isdecimal() and len(deadline) == 13, 'ARGUMENTS')
    budget = Budget(int(deadline))

    def cancelled(_signum, _frame):
        raise PrepError('CANCELLED')

    signal.signal(signal.SIGTERM, cancelled)
    result = normalize_root(Path(root), budget)
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = error.code if type(error) is PrepError else 'IO_OR_RUNTIME'
        print(json.dumps({'kind': 'mac-gcs-fresh-preparation', 'failure': code,
                          'runtimeReady': False}, separators=(',', ':')))
        sys.exit(1)
