"""Owned input timestamp sidecar DATA; never source or execution authority.

The caller retains the genuine original lease and owner fence. Output transport
is handled by the unchanged archive helper; external installed tools are absent.
"""
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time
import unicodedata

DATA_ONLY = True
EXECUTION_ADMITTED = False
REPO = Path(__file__).resolve().parents[2]
SIDECAR = 'full-sdk-checkpoint-inputs.jsonl'
MAX_ENTRIES = 3_000_000
MAX_FILE = 8 * 1024**3
MAX_RAW = 256 * 1024**3
MAX_SIDECAR = 1536 * 1024**2
NAMESPACES = ('source-checkout', 'Windows Kits', 'llvm', 'rust', 'siso', 'gn', 'custom-vs', 'runtime')
SOURCES = {'20261030.294.1': 'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90',
           '20261021.278.1': 'fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa'}


def need(ok, code):
    if not ok:
        raise ValueError('CHECKPOINT_INPUTS_' + code)


def _line(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def _parse(raw):
    need(0 < len(raw) <= 32768 and raw.endswith(b'\n'), 'LINE')
    def pairs(rows):
        result = {}
        for key, value in rows:
            need(key not in result, 'JSON_DUPLICATE')
            result[key] = value
        return result
    value = json.loads(raw.decode('ascii'), object_pairs_hook=pairs,
                       parse_constant=lambda _: need(False, 'JSON_NUMBER'))
    need(_line(value) == raw, 'JSON_CANONICAL')
    return value


def root_name(image, source_id):
    need(type(image) is str and SOURCES.get(image) == source_id, 'SOURCE')
    text = ('sortOfRemoteNG/windows-arm-full-sdk/root/v1\0repositoryId=1010282954'
            '\0target=aarch64-pc-windows-msvc\0image=' + image + '\0sourceId=' + source_id)
    raw = bytearray(hashlib.sha256(text.encode()).digest()[:16])
    raw[6], raw[8] = (raw[6] & 15) | 64, (raw[8] & 63) | 128
    text = raw.hex()
    return 'windows-arm-full-sdk-' + '-'.join((text[:8], text[8:12], text[12:16], text[16:20], text[20:]))


def _identity(value):
    need(type(value) is dict and set(value) == {'image', 'sourceId', 'producerSha256', 'sourceDateEpoch'}, 'IDENTITY')
    name = root_name(value['image'], value['sourceId'])
    need(type(value['producerSha256']) is str and re.fullmatch('[a-f0-9]{64}', value['producerSha256']), 'PRODUCER')
    epoch = value['sourceDateEpoch']
    need(type(epoch) is dict and set(epoch) == {'present', 'value'} and type(epoch['present']) is bool, 'EPOCH')
    need((not epoch['present'] and epoch['value'] is None) or
         (epoch['present'] and type(epoch['value']) is str and re.fullmatch('0|[1-9][0-9]{0,11}', epoch['value']) and
          int(epoch['value']) <= 253402300799), 'EPOCH')
    # JSON round-trip prevents caller-owned aliases from changing the header.
    return dict(kind='windows-arm-full-sdk-checkpoint-inputs', schemaVersion=1,
                identity=json.loads(json.dumps(value)), canonicalRoot=name, namespaces=list(NAMESPACES),
                exclusions=['source-checkout/**/.git', 'source-checkout/src/out'],
                bounds=dict(entries=MAX_ENTRIES, fileBytes=MAX_FILE, rawBytes=MAX_RAW, sidecarBytes=MAX_SIDECAR))


def _directory(info):
    need(stat.S_ISDIR(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400), 'DIRECTORY')
    return (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode), getattr(info, 'st_birthtime_ns', None))


def _signature(info):
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
         not (getattr(info, 'st_file_attributes', 0) & 0x400), 'REGULAR')
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, getattr(info, 'st_birthtime_ns', None), info.st_nlink)


def _shared(signature):
    # CPython3.12 Windows path ctime means birth, while FD ctime can mean change.
    # Compare shared birth/mtime across interfaces; compare full same-interface
    # signatures separately around every held read.
    # Windows path mode also synthesizes executable bits from the suffix.
    return signature[:2] + (stat.S_IFMT(signature[2]),) + signature[3:5] + signature[6:]


def _git_metadata(path):
    # A submodule/worktree may use a gitfile. This is excluded Git metadata,
    # never an input path to follow, read, archive, or retime. Actual repository
    # identity remains the private parent's fresh Git obligation.
    info = path.lstat()
    if stat.S_ISDIR(info.st_mode):
        _directory(info)
    else:
        signature = _signature(info)
        need(signature[3] <= 65536, 'GIT_METADATA_BOUND')


class _Guard:
    def __init__(self, root, header, clock, fence):
        self.root, self.clock, self.fence = Path(root), clock, fence
        self.failed, self.primary = False, None
        self.directories = {}
        self.wall, self.mono = time.time(), time.monotonic()
        need(self.root.is_absolute() and self.root.parent == REPO / '.artifacts' and
             self.root.name == header['canonicalRoot'], 'ROOT')
        self.parents = [(p, _directory(p.lstat())) for p in (self.root, *self.root.parents)]
        self.check()

    def check(self):
        if self.failed:
            raise self.primary
        try:
            wall, mono = time.time(), time.monotonic()
            need(wall >= self.wall and mono >= self.mono, 'CLOCK_ROLLBACK')
            self.wall, self.mono = wall, mono
            left = self.clock.remaining()
            need(type(left) in (int, float) and math.isfinite(left) and left > 0, 'DEADLINE')
            self.fence()
            for path, identity in self.parents:
                need(_directory(path.lstat()) == identity, 'ROOT_CHANGED')
            need(self.root.resolve() == self.root, 'ROOT_ALIAS')
            # The genuine owner fence may itself perform IO. Recheck the same
            # original lease after it returns, immediately before our next IO.
            left = self.clock.remaining()
            wall, mono = time.time(), time.monotonic()
            need(type(left) in (int, float) and math.isfinite(left) and left > 0, 'DEADLINE')
            need(wall >= self.wall and mono >= self.mono, 'CLOCK_ROLLBACK')
            self.wall, self.mono = wall, mono
        except BaseException as error:
            self.failed, self.primary = True, error
            raise


@contextmanager
def _file(path, guard, timestamp=False, create=False):
    guard.check()
    stream = None
    if os.name == 'nt' and not create:
        # FILE_SHARE_READ excludes concurrent writers/rename/delete. Operate on
        # the very same handle for hashing and SetFileTime, never a second path.
        import ctypes as c
        from ctypes import wintypes as w
        import msvcrt
        kernel = c.WinDLL('kernel32', use_last_error=True)
        open_file = kernel.CreateFileW
        open_file.argtypes = (w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE)
        open_file.restype = w.HANDLE
        close = kernel.CloseHandle
        close.argtypes, close.restype = (w.HANDLE,), w.BOOL
        handle = open_file(str(path), 0x80000000 | (0x100 if timestamp else 0), 1, None, 3, 0x00200000, None)
        need(handle not in (None, c.c_void_p(-1).value), 'OPEN')
        try:
            descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            close(handle)
            raise
        try:
            stream = os.fdopen(descriptor, 'rb', buffering=0)
        except BaseException:
            try:
                os.close(descriptor)
            except BaseException:
                pass
            raise
    else:
        descriptor = os.open(path, (os.O_WRONLY | os.O_CREAT | os.O_EXCL if create else os.O_RDONLY) |
                             getattr(os, 'O_NOFOLLOW', 0), 0o600)
        try:
            stream = os.fdopen(descriptor, 'wb' if create else 'rb', buffering=0)
        except BaseException:
            try:
                os.close(descriptor)
            except BaseException:
                pass
            raise
    failed, primary = False, None
    try:
        guard.check()
        yield stream
    except BaseException as error:
        failed, primary = True, error
    finally:
        try:
            stream.close()
        except BaseException as error:
            if not failed:
                failed, primary = True, error
    if failed:
        raise primary
    guard.check()


def _name(name):
    need(type(name) is str and 0 < len(name.encode('utf-8')) <= 4096 and '\\' not in name, 'PATH')
    parts = name.split('/')
    for part in parts:
        need(part not in ('', '.', '..') and not part.endswith((' ', '.')) and
             not any(ord(c) < 32 or c in '<>:"|?*' for c in part) and
             part.split('.')[0].casefold() not in {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}, 'PATH')
    need(parts[0] in NAMESPACES and '.git' not in parts and
         not (len(parts) >= 3 and parts[:3] == ['source-checkout', 'src', 'out']), 'NAMESPACE')
    return unicodedata.normalize('NFC', name).casefold()


def _walk(guard):
    seen, count = set(), 0
    def visit(path, name):
        nonlocal count
        guard.check()
        folded = _name(name)
        need(folded not in seen, 'CASE_ALIAS')
        seen.add(folded)
        count += 1
        need(count <= MAX_ENTRIES, 'ENTRIES')
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            identity = _directory(info)
            yield dict(kind='directory', path=name), identity
            if name in guard.directories:
                need(guard.directories[name] == identity, 'DIRECTORY_CHANGED')
            else:
                guard.directories[name] = identity
            with os.scandir(path) as entries:
                names = []
                for entry in entries:
                    need(len(names) < MAX_ENTRIES, 'ENTRIES')
                    names.append(entry.name)
                names.sort()
            for child in names:
                if child == '.git' and (name == 'source-checkout' or name.startswith('source-checkout/')):
                    _git_metadata(path / child)
                    continue
                if name == 'source-checkout/src' and child == 'out':
                    _directory((path / child).lstat())
                    continue
                yield from visit(path / child, name + '/' + child)
            need(_directory(path.lstat()) == identity, 'DIRECTORY_CHANGED')
        else:
            signature = _signature(info)
            need(0 <= info.st_size <= MAX_FILE, 'FILE_BOUND')
            yield dict(kind='file', path=name), signature
    for namespace in sorted(NAMESPACES):
        yield from visit(guard.root / namespace, namespace)


@contextmanager
def _hash(path, guard, expected=None, timestamp=False):
    parent = path.parent
    while parent != guard.root:
        relative = parent.relative_to(guard.root).as_posix()
        need(relative in guard.directories and _directory(parent.lstat()) == guard.directories[relative], 'DIRECTORY_CHANGED')
        parent = parent.parent
    before = _signature(path.lstat())
    if expected is not None:
        need(before == expected, 'CHANGED')
    with _file(path, guard, timestamp=timestamp) as stream:
        fd_before = _signature(os.fstat(stream.fileno()))
        need(_shared(fd_before) == _shared(before), 'IDENTITY')
        digest, size = hashlib.sha256(), 0
        while True:
            guard.check()
            chunk = stream.read(1024**2)
            if not chunk:
                break
            size += len(chunk)
            need(size <= MAX_FILE and size <= before[3], 'GROWTH')
            digest.update(chunk)
        need(size == before[3] and _signature(os.fstat(stream.fileno())) == fd_before and
             _signature(path.lstat()) == before, 'CHANGED')
        yield stream, before, digest.hexdigest()
        guard.check()


def _set_mtime(stream, nanoseconds):
    need(type(nanoseconds) is int and 0 <= nanoseconds <= 253402300799999999999, 'MTIME')
    if os.name == 'nt':
        import ctypes as c
        from ctypes import wintypes as w
        import msvcrt
        need(nanoseconds % 100 == 0, 'MTIME_PRECISION')
        ticks = nanoseconds // 100 + 116444736000000000
        value = w.FILETIME(ticks & 0xffffffff, ticks >> 32)
        call = c.WinDLL('kernel32', use_last_error=True).SetFileTime
        call.argtypes, call.restype = (w.HANDLE, c.c_void_p, c.c_void_p, c.POINTER(w.FILETIME)), w.BOOL
        need(call(msvcrt.get_osfhandle(stream.fileno()), None, None, c.byref(value)), 'SET_MTIME')
    else:
        os.utime(stream.fileno(), ns=(os.fstat(stream.fileno()).st_atime_ns, nanoseconds))


def _pin(pin):
    need(type(pin) is dict and set(pin) == {'bytes', 'sha256'} and type(pin['bytes']) is int and
         0 < pin['bytes'] <= MAX_SIDECAR and type(pin['sha256']) is str and re.fullmatch('[a-f0-9]{64}', pin['sha256']), 'SIDECAR_PIN')


def record_inputs(root, identity, clock, fence):
    header = _identity(identity)
    guard = _Guard(root, header, clock, fence)
    digest, written, count, files, raw_bytes = hashlib.sha256(), 0, 0, 0, 0
    def emit(stream, value):
        nonlocal written
        raw = _line(value)
        need(len(raw) <= 32768 and written + len(raw) <= MAX_SIDECAR, 'SIDECAR_BOUND')
        guard.check()
        need(stream.write(raw) == len(raw), 'WRITE')
        written += len(raw)
        digest.update(raw)
    with _file(guard.root / SIDECAR, guard, create=True) as output:
        emit(output, header)
        for row, signature in _walk(guard):
            count += 1
            if row['kind'] == 'file':
                with _hash(guard.root / row['path'], guard, signature) as (_, before, sha):
                    row.update(bytes=before[3], sha256=sha, mtimeNs=before[4])
                files += 1
                raw_bytes += row['bytes']
                need(raw_bytes <= MAX_RAW, 'RAW_BOUND')
            emit(output, row)
        emit(output, dict(kind='end', entries=count, files=files, rawBytes=raw_bytes))
    pin = dict(bytes=written, sha256=digest.hexdigest())
    # Re-open through the same strict reader and verify a complete post-inventory.
    _verify(guard, header, pin, require_mtime=True)
    return dict(dataOnly=True, sidecar=pin, entries=count, files=files, rawBytes=raw_bytes)


def _verify(guard, header, pin, require_mtime=False):
    _pin(pin)
    sidecar = guard.root / SIDECAR
    signatures, count, files, raw_bytes, total = [], 0, 0, 0, 0
    digest = hashlib.sha256()
    with _file(sidecar, guard) as stream:
        before = _signature(os.fstat(stream.fileno()))
        path_before = _signature(sidecar.lstat())
        need(_shared(before) == _shared(path_before), 'SIDECAR_CHANGED')
        need(before[3] == pin['bytes'], 'SIDECAR_PIN')
        def read():
            nonlocal total
            guard.check()
            raw = stream.readline(32769)
            total += len(raw)
            need(total <= MAX_SIDECAR, 'SIDECAR_BOUND')
            digest.update(raw)
            return _parse(raw)
        need(_line(read()) == _line(header), 'HEADER')
        for fresh, signature in _walk(guard):
            row = read()
            need(type(row) is dict and row.get('kind') == fresh['kind'] and row.get('path') == fresh['path'], 'NAME_SET')
            count += 1
            if fresh['kind'] == 'file':
                need(set(row) == {'kind', 'path', 'bytes', 'sha256', 'mtimeNs'} and type(row['bytes']) is int and
                     type(row['mtimeNs']) is int and 0 <= row['mtimeNs'] <= 253402300799999999999 and
                     (os.name != 'nt' or row['mtimeNs'] % 100 == 0), 'ROW')
                with _hash(guard.root / fresh['path'], guard, signature) as (_, before_file, sha):
                    need(row['bytes'] == before_file[3] and row['sha256'] == sha, 'BYTES')
                    if require_mtime:
                        need(before_file[4] == row['mtimeNs'], 'MTIME')
                files += 1
                raw_bytes += row['bytes']
                need(raw_bytes <= MAX_RAW, 'RAW_BOUND')
                signatures.append((fresh['path'], signature, row['mtimeNs'], sha))
            else:
                need(row == fresh, 'ROW')
        need(_line(read()) == _line(dict(kind='end', entries=count, files=files, rawBytes=raw_bytes)), 'END')
        need(stream.read(1) == b'' and total == pin['bytes'] and digest.hexdigest() == pin['sha256'] and
             _signature(os.fstat(stream.fileno())) == before and _signature(sidecar.lstat()) == path_before, 'SIDECAR_CHANGED')
    return signatures


def apply_inputs(root, identity, sidecar_pin, clock, fence):
    header = _identity(identity)
    guard = _Guard(root, header, clock, fence)
    # Complete namespace/byte/identity validation precedes the first mutation.
    signatures = _verify(guard, header, sidecar_pin)
    for name, signature, nanoseconds, sha in signatures:
        path = guard.root / name
        with _hash(path, guard, signature, timestamp=True) as (stream, before, actual):
            need(actual == sha, 'BYTES')
            guard.check()
            _set_mtime(stream, nanoseconds)
            after = _signature(os.fstat(stream.fileno()))
            need(_shared(after)[:4] == _shared(before)[:4] and _shared(after)[5:] == _shared(before)[5:] and after[4] == nanoseconds and
                 _shared(_signature(path.lstat())) == _shared(after), 'MTIME_CHANGED')
    # A changed sidecar/tree or uncertain close cannot publish successful DATA.
    final = _verify(guard, header, sidecar_pin, require_mtime=True)
    return dict(dataOnly=True, timestampsApplied=True, files=len(final), sidecar=dict(sidecar_pin),
                sourceQualified=False, checkpointAdmission=False, executionAdmitted=False)
