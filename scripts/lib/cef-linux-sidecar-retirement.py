"""Inactive Linux-only owned-FD primitive. No path or ownership-report interface.

The parent must own the creator capability and original lease. JSON supplies
expected pins only; the live inherited descriptors supply the kernel objects.
This primitive confers no checkpoint, source migration or runtime admission.
"""
import ctypes
import errno
import hashlib
import json
import os
import platform
import re
import stat
import sys
import time

LEAF = b'.siso_sorng_source_metadata.json'
FDS = (3, 4, 5)  # creation-owned source directory, sidecar, exclusive destination
MAX_BYTES = 1536 * 1024**2
MAX_INPUT = 4096
MAX_STAGE_MS = 600000
MAX_HOST_MS = 300 * 60000
STAMP = ('dev', 'ino', 'uid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs')
DIRECTORY = ('dev', 'ino', 'uid', 'mode')
ERRORS = frozenset(('RETIRE_HOST', 'RETIRE_SHAPE', 'RETIRE_SCOPE', 'RETIRE_DEADLINE',
    'RETIRE_STAMP', 'RETIRE_FILE', 'RETIRE_PIN', 'RETIRE_DIRECTORY', 'RETIRE_ALIAS',
    'RETIRE_DESTINATION_EXISTS', 'RETIRE_SOURCE_REMAINS', 'RETIRE_UNSUPPORTED',
    'RETIRE_READBACK', 'RETIRE_ARGUMENTS', 'RETIRE_INPUT'))


class RetirementError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RetirementError(code)


def stamp(value):
    return dict(zip(STAMP, (str(value.st_dev), str(value.st_ino), str(value.st_uid),
        str(value.st_mode), str(value.st_nlink), str(value.st_size),
        str(value.st_mtime_ns), str(value.st_ctime_ns))))


def directory(value):
    full = stamp(value)
    return {key: full[key] for key in DIRECTORY}


def shape(value, keys):
    require(type(value) is dict and set(value) == set(keys), 'RETIRE_SHAPE')


def validate(record):
    require(sys.platform == 'linux' and platform.machine() == 'x86_64', 'RETIRE_HOST')
    shape(record, ('schemaVersion', 'kind', 'originalEndMs', 'file', 'sourceDirectory', 'destinationDirectory', 'sha256'))
    require(record['schemaVersion'] == 1 and type(record['schemaVersion']) is int and
        record['kind'] == 'sorng-linux-owned-sidecar-retirement', 'RETIRE_SCOPE')
    require(type(record['originalEndMs']) is int and record['originalEndMs'] > 0, 'RETIRE_DEADLINE')
    shape(record['file'], STAMP)
    for key in ('sourceDirectory', 'destinationDirectory'):
        shape(record[key], DIRECTORY)
    for item in (record['file'], record['sourceDirectory'], record['destinationDirectory']):
        require(all(type(value) is str and re.fullmatch(r'0|[1-9][0-9]{0,20}', value)
            for value in item.values()), 'RETIRE_STAMP')
    require(record['file']['nlink'] == '1' and 0 < int(record['file']['size']) <= MAX_BYTES,
        'RETIRE_FILE')
    require(type(record['sha256']) is str and re.fullmatch('[a-f0-9]{64}', record['sha256']), 'RETIRE_PIN')
    remaining = record['originalEndMs'] - time.time_ns() // 1000000
    require(0 < remaining <= MAX_HOST_MS, 'RETIRE_DEADLINE')
    return time.monotonic() + min(remaining, MAX_STAGE_MS) / 1000


def check(end):
    require(time.monotonic() < end, 'RETIRE_DEADLINE')


def held_directories(record):
    source = os.fstat(3)
    destination = os.fstat(5)
    require(stat.S_ISDIR(source.st_mode) and stat.S_ISDIR(destination.st_mode) and
        source.st_uid == destination.st_uid == os.geteuid() and
        stat.S_IMODE(destination.st_mode) == 0o700 and
        (source.st_dev, source.st_ino) != (destination.st_dev, destination.st_ino) and
        source.st_dev == destination.st_dev and
        directory(source) == record['sourceDirectory'] and
        directory(destination) == record['destinationDirectory'], 'RETIRE_DIRECTORY')


def hash_held(record, end, *, renamed=False):
    before = os.fstat(4)
    current = stamp(before)
    expected = record['file']
    # Linux rename legitimately advances ctime. Every other file field stays
    # exact, and the complete contents are rehashed after the atomic operation.
    fields = tuple(key for key in STAMP if not (renamed and key == 'ctimeNs'))
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and
        before.st_nlink == 1 and all(current[key] == expected[key] for key in fields), 'RETIRE_FILE')
    os.lseek(4, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    count = 0
    while True:
        check(end)
        block = os.read(4, 1024 * 1024)
        if not block:
            break
        count += len(block)
        require(count <= MAX_BYTES and count <= int(expected['size']), 'RETIRE_FILE')
        digest.update(block)
    check(end)
    require(count == int(expected['size']) and digest.hexdigest() == record['sha256'] and
        stamp(os.fstat(4)) == current, 'RETIRE_PIN')
    return current


def absent(fd, code='RETIRE_DESTINATION_EXISTS'):
    try:
        os.stat(LEAF, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise RetirementError(code)


def rename_no_replace():
    # No arbitrary syscall number, path, argv, native executable or fallback.
    # ENOSYS/EINVAL and all other failures deny; original objects are preserved.
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, 'renameat2', None)
    require(function is not None, 'RETIRE_UNSUPPORTED')
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    if function(3, LEAF, 5, LEAF, 1) != 0:  # RENAME_NOREPLACE
        code = ctypes.get_errno()
        raise OSError(code, 'RETIRE_RENAME')


def close_owned():
    failures = []
    for fd in FDS:
        try:
            os.close(fd)
        except BaseException as error:
            failures.append(error)
    return failures


def execute(record, result):
    primary = None
    failed = False
    try:
        result['phase'] = 'validation'
        end = validate(record)
        check(end)
        result['phase'] = 'precheck'
        held_directories(record)
        original = hash_held(record, end)
        require(stamp(os.stat(LEAF, dir_fd=3, follow_symlinks=False)) == original, 'RETIRE_ALIAS')
        absent(5)
        check(end)
        held_directories(record)
        # Recheck after the potentially long hash and immediately before move.
        require(stamp(os.fstat(4)) == original and
            stamp(os.stat(LEAF, dir_fd=3, follow_symlinks=False)) == original, 'RETIRE_ALIAS')
        result['phase'] = 'rename'
        rename_no_replace()
        result['renamed'] = True
        check(end)
        result['phase'] = 'readback'
        held_directories(record)
        absent(3, 'RETIRE_SOURCE_REMAINS')
        retired = hash_held(record, end, renamed=True)
        require(stamp(os.stat(LEAF, dir_fd=5, follow_symlinks=False)) == retired, 'RETIRE_READBACK')
        check(end)
        result['readback'] = True
    except BaseException as error:
        primary, failed = error, True
    finally:
        errors = close_owned()
        result['descriptorsClosed'] = not errors
        result['closeFailures'] = len(errors)
        if errors and not failed:
            primary, failed = errors[0], True
    if failed:
        raise primary
    result['phase'] = 'complete'
    result['complete'] = True
    return result


def result_record():
    return {'schemaVersion': 1, 'kind': 'sorng-linux-owned-sidecar-retirement-result',
        'complete': False, 'phase': 'input', 'renamed': False, 'readback': False,
        'descriptorsClosed': False, 'closeFailures': 0,
        'migrationAdmitted': False, 'nativeAcceptance': False, 'runtimeReady': False}


def main():
    result = result_record()
    try:
        require(len(sys.argv) == 1, 'RETIRE_ARGUMENTS')
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        require(0 < len(raw) <= MAX_INPUT, 'RETIRE_INPUT')
        # Canonical JSON rejects duplicate fields and alternate encodings.
        record = json.loads(raw)
        require((json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode() == raw,
            'RETIRE_INPUT')
        execute(record, result)
    except BaseException as error:
        # Input failures occur before execute owns its normal finally path.
        if result['phase'] == 'input':
            errors = close_owned()
            result['descriptorsClosed'] = not errors
            result['closeFailures'] = len(errors)
        result['error'] = (error.args[0] if type(error) is RetirementError and len(error.args) == 1 and
            type(error.args[0]) is str and error.args[0] in ERRORS else 'RETIRE_OPERATION')
        result['errno'] = error.errno if isinstance(error, OSError) and type(error.errno) is int and error.errno in (
            errno.EEXIST, errno.EINVAL, errno.ENOSYS, errno.EXDEV, errno.EBADF,
            errno.EACCES, errno.EPERM, errno.ENOENT, errno.EIO) else None
        print(json.dumps(result, sort_keys=True, separators=(',', ':')))
        return 1
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
