"""Owned input timestamp sidecar DATA; never source or execution authority.

The caller retains the genuine original lease and owner fence. Output transport
is handled by the unchanged archive helper; external installed tools are absent.
"""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import functools
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import threading
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
SOURCES = {'20261103.298.1': 'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90',
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
                exclusions=['source-checkout/**/.git', 'source-checkout/src/out', BIDI_BIN],
                bounds=dict(entries=MAX_ENTRIES, fileBytes=MAX_FILE, rawBytes=MAX_RAW, sidecarBytes=MAX_SIDECAR))


RESOLVE_INTERVAL = 5.0
HASH_CHUNK = 4 * 1024**2
# Parallel content hashing: the walk, every comparison and every emitted row stay on the calling thread in walk
# order; only the full-file reads run on workers. SORNG_CHECKPOINT_HASH_WORKERS=1 forces the serial path.
HASH_WORKERS_ENV = 'SORNG_CHECKPOINT_HASH_WORKERS'
HASH_WINDOW = 128
SHARED_CHECK_INTERVAL = 0.2
PROGRESS_FILE = 'full-sdk-engine-checkpoint-seal-progress.json'  # matches the always() records glob full-sdk-engine-*.json
PROGRESS_KIND = 'windows-arm-full-sdk-checkpoint-seal-progress'
PROGRESS_INTERVAL = 30.0


class Progress:
    """Best-effort seal heartbeat DATA; it never gates, reorders or alters any integrity check.

    Every emission (stage boundary, rate-limited tick, daemon-thread beat, final) goes to stderr and
    atomically replaces one small JSON record, so a deadline kill leaves the last beat behind. Disabled
    instances are inert: no clock reads, no IO.
    """

    def __init__(self):
        self.enabled = False
        self.path = None
        self.interval = PROGRESS_INTERVAL
        self._lock = threading.Lock()
        self._stop = None
        self._thread = None
        self._reset()

    def _reset(self):
        self.started, self.last, self.seq = time.monotonic(), 0.0, 0
        self.stages, self.current, self.outcome = [], None, None
        self.entries = self.files = self.bytes = 0

    def enable(self, root, interval=PROGRESS_INTERVAL, thread=True):
        self.disable()
        self._reset()
        self.path, self.interval, self.enabled = Path(root) / PROGRESS_FILE, float(interval), True
        self.last = time.monotonic()
        if thread:
            self._stop = threading.Event()
            self._thread = threading.Thread(target=self._beat, args=(self._stop,), name='seal-progress', daemon=True)
            self._thread.start()
        return self

    def disable(self):
        if self._stop is not None:
            self._stop.set()
        self._stop = self._thread = None
        self.enabled = False

    def _beat(self, stop):
        # Covers long operations that never tick (archive pack/restore, one huge file).
        while not stop.wait(min(1.0, max(self.interval / 4, 0.01))):
            if time.monotonic() - self.last >= self.interval:
                self.emit('heartbeat')

    def _close_stage(self, now):
        current = self.current
        if current is not None and 'seconds' not in current:
            current.update(seconds=round(now - current['start'], 3), entries=self.entries, files=self.files, bytes=self.bytes)

    def stage(self, name, total_entries=None):
        if not self.enabled:
            return
        now = time.monotonic()
        self._close_stage(now)
        self.entries = self.files = self.bytes = 0
        self.current = dict(name=name, start=now, totalEntries=total_entries)
        self.stages.append(self.current)
        self.emit('stage')

    def tick(self, entries, files, nbytes):
        if not self.enabled:
            return
        self.entries, self.files, self.bytes = entries, files, nbytes
        if time.monotonic() - self.last >= self.interval:
            self.emit('progress')

    def final(self, outcome):
        if not self.enabled:
            return
        self._close_stage(time.monotonic())
        self.outcome = outcome
        self.emit('final')
        self.disable()

    def snapshot(self, reason):
        now, current = time.monotonic(), self.current
        report = dict(schemaVersion=1, kind=PROGRESS_KIND, seq=self.seq, reason=reason, outcome=self.outcome,
                      utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), elapsedSeconds=round(now - self.started, 1),
                      stage=None, entries=self.entries, files=self.files, bytes=self.bytes,
                      stages=[dict((k, v) for k, v in row.items() if k != 'start') for row in self.stages if 'seconds' in row])
        if current is not None and 'seconds' not in current:
            seconds = now - current['start']
            report.update(stage=current['name'], stageSeconds=round(seconds, 1), totalEntries=current['totalEntries'],
                          entriesPerSecond=round(self.entries / seconds, 1) if seconds > 0 else 0,
                          megabytesPerSecond=round(self.bytes / 1048576 / seconds, 2) if seconds > 0 else 0)
        return report

    def emit(self, reason):
        if not self.enabled:
            return None
        try:
            with self._lock:
                self.last = time.monotonic()
                self.seq += 1
                report = self.snapshot(reason)
                raw = json.dumps(report, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
                print('seal-progress ' + raw, file=sys.stderr, flush=True)
                temporary = self.path.with_name(self.path.name + '.tmp')
                with temporary.open('wb') as stream:
                    stream.write(raw.encode('ascii') + bytes((10,)))
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
                return report
        except BaseException as error:
            if not isinstance(error, Exception):
                raise
            return None  # Telemetry only: never into the integrity path.


PROGRESS = Progress()


# npm .bin shims (16 symlinks) from the sha256-pinned chromium-bidi gclient GCS tarball; the build names
# node_modules/<package>/... files directly and never executes .bin. Never hashed, sealed or restored.
BIDI_BIN = 'source-checkout/src/third_party/chromium-bidi/node_modules/.bin'
BIDI_BIN_PARENT, BIDI_BIN_CHILD = BIDI_BIN.rsplit('/', 1)

AUDIT_CAP = 200
AUDIT_KIND = 'windows-arm-full-sdk-link-audit'
# The workflow always() records upload already globs full-sdk-engine-*.json.
AUDIT_PREFIX = 'full-sdk-engine-'
AUDIT_SUFFIX = '.json'


def _link_checks(info):
    """Return the reasons one lstat result fails the _signature/_directory predicates."""
    mode, attributes, checks = info.st_mode, getattr(info, 'st_file_attributes', 0), []
    directory = stat.S_ISDIR(mode)
    if stat.S_ISLNK(mode):
        checks.append('symlink')
    if attributes & 0x400:
        checks.append('reparse-point')
    if not directory and not stat.S_ISLNK(mode) and not stat.S_ISREG(mode):
        checks.append('not-regular')
    if not directory and stat.S_ISREG(mode) and info.st_nlink != 1:
        checks.append('nlink>1' if info.st_nlink > 1 else 'nlink<1')
    return checks


def audit_links(root, check=None, cap=AUDIT_CAP, namespaces=NAMESPACES):
    """Metadata-only lstat walk over the hashed namespaces; never hashes or opens a file.

    Applies the same predicates and exclusions as _walk/_signature but collects every
    violation (the first `cap` are listed, all are counted) instead of aborting on the first.
    `firstCode` is the CHECKPOINT_INPUTS_* suffix _walk would have raised first.
    """
    root = Path(root)
    state = dict(entries=0, total=0, first=None)
    listed, by_check, by_namespace, missing, seen = [], {}, {}, [], set()

    def violate(namespace, name, checks, code, info=None):
        state['total'] += 1
        state['first'] = state['first'] or (code, name)
        by_namespace[namespace] = by_namespace.get(namespace, 0) + 1
        for item in checks:
            by_check[item] = by_check.get(item, 0) + 1
        if len(listed) < cap:
            row = dict(path=name, namespace=namespace, checks=checks, code=code)
            if info is not None:
                row.update(nlink=info.st_nlink, mode=oct(info.st_mode),
                           attributes=hex(getattr(info, 'st_file_attributes', 0)))
            listed.append(row)

    def excluded(path, name, namespace, child, expect_directory):
        # Excluded names are never descended, but their own identity must still satisfy the predicates.
        full = name + '/' + child
        try:
            info = (path / child).lstat()
        except OSError as error:
            violate(namespace, full, ['lstat-error:%s' % error.errno], 'OPEN')
            return
        checks = _link_checks(info)
        if expect_directory and not stat.S_ISDIR(info.st_mode):
            checks.append('not-directory')
        if checks:
            violate(namespace, full, checks, 'DIRECTORY' if stat.S_ISDIR(info.st_mode) else 'REGULAR', info)

    def visit(path, name, namespace):
        state['entries'] += 1
        if check is not None and state['entries'] % 2048 == 0:
            check()
        try:
            folded = _name(name)
        except ValueError as error:
            code = str(error)[len('CHECKPOINT_INPUTS_'):]
            violate(namespace, name, ['name:' + code.lower()], code)
            return
        if folded in seen:
            violate(namespace, name, ['name:case_alias'], 'CASE_ALIAS')
            return
        seen.add(folded)
        try:
            info = path.lstat()
        except OSError as error:
            violate(namespace, name, ['lstat-error:%s' % error.errno], 'OPEN')
            return
        directory = stat.S_ISDIR(info.st_mode)
        checks = _link_checks(info)
        if checks:
            violate(namespace, name, checks, 'DIRECTORY' if directory else 'REGULAR', info)
            return
        if not directory:
            if info.st_size > MAX_FILE:
                violate(namespace, name, ['file-bound'], 'FILE_BOUND', info)
            return
        try:
            with os.scandir(path) as entries:
                names = sorted(entry.name for entry in entries)
        except OSError as error:
            violate(namespace, name, ['scandir-error:%s' % error.errno], 'OPEN', info)
            return
        for child in names:
            if child == '.git' and (name == 'source-checkout' or name.startswith('source-checkout/')):
                excluded(path, name, namespace, child, False)
            elif name == 'source-checkout/src' and child == 'out':
                excluded(path, name, namespace, child, True)
            elif name == BIDI_BIN_PARENT and child == BIDI_BIN_CHILD:
                excluded(path, name, namespace, child, True)
            else:
                visit(path / child, name + '/' + child, namespace)

    for namespace in sorted(namespaces):
        try:
            (root / namespace).lstat()
        except OSError:
            missing.append(namespace)
            continue
        visit(root / namespace, namespace, namespace)
    code, first = state['first'] or (None, None)
    return dict(kind=AUDIT_KIND, schemaVersion=1, namespaces=sorted(namespaces), missingNamespaces=missing,
                entries=state['entries'], violationCount=state['total'], listed=len(listed),
                capped=state['total'] > len(listed), cap=cap, byCheck=dict(sorted(by_check.items())),
                byNamespace=dict(sorted(by_namespace.items())), firstCode=code, firstPath=first, violations=listed)


def write_audit(root, report, label):
    """Write the audit as canonical JSON beside the other full-sdk-engine-*.json records."""
    need(type(label) is str and re.fullmatch('[a-z0-9-]{1,64}', label), 'AUDIT_LABEL')
    raw = json.dumps(report, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode() + b'\n'
    name = AUDIT_PREFIX + label + AUDIT_SUFFIX
    with (Path(root) / name).open('wb') as stream:
        stream.write(raw)
    return name


def audit_summary(report, limit=25):
    lines = ['link audit: %d entries, %d violations (%s)' % (
        report['entries'], report['violationCount'], ', '.join('%s=%d' % item for item in report['byCheck'].items()) or 'none')]
    for row in report['violations'][:limit]:
        lines.append('  %s [%s]%s' % (row['path'], ','.join(row['checks']), ' nlink=%s' % row['nlink'] if 'nlink' in row else ''))
    return lines


def audit_failure(root, report, label):
    """Persist the audit and return the exact CHECKPOINT_INPUTS_* cause with the first offender attached."""
    write_audit(root, report, label)
    error = ValueError('CHECKPOINT_INPUTS_' + report['firstCode'])
    first = report['firstPath']
    context = dict(stage='sidecar-record', code='SIDECAR_' + report['firstCode'], paths=report['violationCount'])
    if type(first) is str and len(first) <= 512:
        context.update(relativeName=first, relativeNameSha256=hashlib.sha256(first.encode()).hexdigest())
    object.__setattr__(error, 'checkpoint_context', context)
    return error


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
        self.resolved = None
        self.lock = threading.RLock()
        self.last_full = 0.0
        self.wall, self.mono = time.time(), time.monotonic()
        need(self.root.is_absolute() and self.root.parent == REPO / '.artifacts' and
             self.root.name == header['canonicalRoot'], 'ROOT')
        self.parents = [(p, _directory(p.lstat())) for p in (self.root, *self.root.parents)]
        self.check()

    def check(self):
        with self.lock:
            self._check()
            self.last_full = time.monotonic()

    def check_shared(self):
        # Worker-thread check: the complete check (root identity, alias, fence, rollback) runs at most every
        # SHARED_CHECK_INTERVAL seconds (the main thread runs it at every walk entry anyway); in between, a failure
        # already latched by any thread and the original deadline are still enforced on every call.
        if self.failed:
            raise self.primary
        if time.monotonic() - self.last_full >= SHARED_CHECK_INTERVAL:
            return self.check()
        try:
            left = self.clock.remaining()
            need(type(left) in (int, float) and math.isfinite(left) and left > 0, 'DEADLINE')
        except BaseException as error:
            with self.lock:
                if not self.failed:
                    self.failed, self.primary = True, error
                raise self.primary
        if self.failed:
            raise self.primary

    def _check(self):
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
            # Path.resolve() (GetFinalPathNameByHandle) was ~60% of every check. The ancestor loop above already
            # proves each ancestor, root included, is the same non-reparse directory (dev/ino/birth) captured at
            # construction, so the resolved path cannot change; keep the alias proof on the first check and
            # re-run it at most every RESOLVE_INTERVAL seconds as belt and braces.
            if self.resolved is None or mono - self.resolved >= RESOLVE_INTERVAL:
                need(self.root.resolve() == self.root, 'ROOT_ALIAS')
                self.resolved = mono
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


@functools.lru_cache(maxsize=None)
def _kernel_open():
    # One CreateFileW/CloseHandle prototype for the process (it was rebuilt for every file).
    import ctypes as c
    from ctypes import wintypes as w
    kernel = c.WinDLL('kernel32', use_last_error=True)
    open_file = kernel.CreateFileW
    open_file.argtypes = (w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE)
    open_file.restype = w.HANDLE
    close = kernel.CloseHandle
    close.argtypes, close.restype = (w.HANDLE,), w.BOOL
    return open_file, close


@contextmanager
def _file(path, guard, timestamp=False, create=False):
    guard.check()
    stream = None
    if os.name == 'nt' and not create:
        # FILE_SHARE_READ excludes concurrent writers/rename/delete. Operate on
        # the very same handle for hashing and SetFileTime, never a second path.
        import ctypes as c
        import msvcrt
        open_file, close = _kernel_open()
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
         not (len(parts) >= 3 and parts[:3] == ['source-checkout', 'src', 'out']) and
         '/'.join(parts[:len(BIDI_BIN.split('/'))]) != BIDI_BIN, 'NAMESPACE')
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
                if (name == 'source-checkout/src' and child == 'out') or (name == BIDI_BIN_PARENT and child == BIDI_BIN_CHILD):
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
def _hash(path, guard, expected=None, timestamp=False, content=True):
    # content=False opens the same pinned handle and re-proves it by metadata only (apply's mutation pass; the
    # bytes were hashed moments earlier by the complete verify, and every identity/size/mtime field must match).
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
        digest, size, first = hashlib.sha256(), 0, True
        while content:
            # _file just ran guard.check() with only the fstat above in between; later reads re-check each time.
            if not first:
                guard.check()
            first = False
            chunk = stream.read(HASH_CHUNK)
            if not chunk:
                break
            size += len(chunk)
            need(size <= MAX_FILE and size <= before[3], 'GROWTH')
            digest.update(chunk)
        if not content:
            size = before[3]
        need(size == before[3] and _signature(os.fstat(stream.fileno())) == fd_before and
             _signature(path.lstat()) == before, 'CHANGED')
        yield stream, before, digest.hexdigest() if content else None
        # _file runs guard.check() again right after closing the stream; nothing happens in between.


def _worker_count(workers=None):
    if workers is None:
        raw = os.environ.get(HASH_WORKERS_ENV, '')
        workers = int(raw) if re.fullmatch('[1-9][0-9]{0,2}', raw) else min(16, max(4, 2 * (os.cpu_count() or 1)))
    return max(1, min(int(workers), 256))


class _SharedGuard:
    """What _hash/_file need from the guard, with the throttled thread-safe check."""
    def __init__(self, guard):
        self.root, self.directories, self.check = guard.root, guard.directories, guard.check_shared


class _Ordered:
    """Content hashes on a bounded worker pool, completions consumed strictly in walk order.

    push() queues one walk entry; finish(before, sha) (sha is None without a path) always runs on the calling
    thread in push order, so rows, counters, the first error and the sidecar bytes equal the serial result.
    One worker means the original inline path. close() cancels what is outstanding and joins every thread.
    """
    def __init__(self, guard, workers=None):
        self.guard, self.pending = guard, deque()
        count = _worker_count(workers)
        self.pool = ThreadPoolExecutor(max_workers=count, thread_name_prefix='checkpoint-hash') if count > 1 else None
        self.shared = _SharedGuard(guard) if self.pool else None
        self.window = max(HASH_WINDOW, count * 4)

    def _job(self, path, signature):
        with _hash(path, self.shared, signature) as (_, before, sha):
            return before, sha

    def push(self, path, signature, finish):
        if self.pool is None:
            if path is None:
                finish(None, None)
            else:
                with _hash(path, self.guard, signature) as (_, before, sha):
                    finish(before, sha)
            return
        future = None if path is None else self.pool.submit(self._job, path, signature)
        self.pending.append((future, finish))
        if len(self.pending) >= self.window:
            self.complete()

    def complete(self):
        future, finish = self.pending.popleft()
        if future is None:
            finish(None, None)
        else:
            before, sha = future.result()
            finish(before, sha)

    def drain(self):
        # Also used when the calling thread failed: earlier entries' own failures still win, in walk order.
        while self.pending:
            self.complete()

    def close(self):
        if self.pool is not None:
            for future, _ in self.pending:
                if future is not None:
                    future.cancel()
            self.pending.clear()
            self.pool.shutdown(wait=True, cancel_futures=True)


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


def record_inputs(root, identity, clock, fence, workers=None):
    header = _identity(identity)
    guard = _Guard(root, header, clock, fence)
    # Metadata-only pre-pass: report every link/reparse violation at once, minutes
    # into the seal instead of one at a time after tens of minutes of hashing.
    PROGRESS.stage('link-audit')
    report = audit_links(guard.root, check=guard.check)
    if report['violationCount']:
        for line in audit_summary(report):
            print(line, file=sys.stderr)
        raise audit_failure(guard.root, report, 'checkpoint-seal-link-violations')
    digest, written, count, files, raw_bytes = hashlib.sha256(), 0, 0, 0, 0
    def emit(stream, value):
        nonlocal written
        raw = _line(value)
        need(len(raw) <= 32768 and written + len(raw) <= MAX_SIDECAR, 'SIDECAR_BOUND')
        guard.check()
        need(stream.write(raw) == len(raw), 'WRITE')
        written += len(raw)
        digest.update(raw)
    PROGRESS.stage('record-walk-hash', total_entries=report['entries'])
    ordered = _Ordered(guard, workers)
    try:
        with _file(guard.root / SIDECAR, guard, create=True) as output:
            emit(output, header)
            def finisher(row):
                def finish(before, sha):
                    nonlocal count, files, raw_bytes
                    count += 1
                    if row['kind'] == 'file':
                        row.update(bytes=before[3], sha256=sha, mtimeNs=before[4])
                        files += 1
                        raw_bytes += row['bytes']
                        need(raw_bytes <= MAX_RAW, 'RAW_BOUND')
                    emit(output, row)
                    PROGRESS.tick(count, files, raw_bytes)
                return finish
            try:
                for row, signature in _walk(guard):
                    ordered.push(guard.root / row['path'] if row['kind'] == 'file' else None, signature, finisher(row))
            except BaseException:
                ordered.drain()
                raise
            ordered.drain()
            emit(output, dict(kind='end', entries=count, files=files, rawBytes=raw_bytes))
    finally:
        ordered.close()
    pin = dict(bytes=written, sha256=digest.hexdigest())
    # No back-to-back re-hash here: nothing can change the inputs between this walk and the final
    # verify-record-seal pass, which runs after pack/restore; apply_inputs re-hashes fully on restore.
    return dict(dataOnly=True, sidecar=pin, entries=count, files=files, rawBytes=raw_bytes)


NAME_SET_LISTING = 25


def _name_set_report(read, walker, fresh, row, count):
    """Name the namespace difference on stderr before NAME_SET denies (diagnostics only, bounded, never raises).

    The tree walk and the sidecar rows run in lockstep, so everything before this entry matched; the rest of
    both sides is drained to list exactly which names exist only in the tree or only in the sidecar.
    """
    try:
        tree = [(fresh['kind'], fresh['path'])]
        side = [(row.get('kind'), row.get('path'))] if type(row) is dict and 'path' in row else []
        for item, _ in walker:
            tree.append((item['kind'], item['path']))
        while True:
            more = read()
            if type(more) is not dict or 'path' not in more:
                break
            side.append((more.get('kind'), more.get('path')))
        only_tree, only_side = sorted(set(tree) - set(side)), sorted(set(side) - set(tree), key=str)
        print('checkpoint inputs NAME_SET: first mismatch at entry %d: tree=%r sidecar=%r' %
              (count, tree[0], side[0] if side else None), file=sys.stderr)
        print('checkpoint inputs NAME_SET: %d names only in the tree, %d only in the sidecar' %
              (len(only_tree), len(only_side)), file=sys.stderr)
        for label, names in (('only in tree', only_tree), ('only in sidecar', only_side)):
            for item in names[:NAME_SET_LISTING]:
                print('checkpoint inputs NAME_SET: %s: %s %s' % (label, item[0], str(item[1])[:300]), file=sys.stderr)
            if len(names) > NAME_SET_LISTING:
                print('checkpoint inputs NAME_SET: %s: ... %d more' % (label, len(names) - NAME_SET_LISTING), file=sys.stderr)
    except BaseException:
        pass


# Written by the acquisition step and regenerated with different bytes on every run (git progress counters, pids;
# run 44552110281 vs 44633550604 differ in size). Diagnostic logs, never a compile input: a restore compares only
# their names and does not retime them. Seals still record them and every same-run seal pass still verifies them.
VOLATILE_PREFIX = 'source-checkout/acquisition-logs/'


def _changed_report(changed):
    try:
        print('checkpoint inputs BYTES: %d files differ from the sidecar' % len(changed), file=sys.stderr)
        for name in changed[:NAME_SET_LISTING]:
            print('checkpoint inputs BYTES: changed: %s' % name[:300], file=sys.stderr)
        if len(changed) > NAME_SET_LISTING:
            print('checkpoint inputs BYTES: ... %d more' % (len(changed) - NAME_SET_LISTING), file=sys.stderr)
    except BaseException:
        pass


def _verify(guard, header, pin, require_mtime=False, collect=True, label='verify', total_entries=None, content=True, restore=False, workers=None):
    # collect=False (seal-only passes) drops the per-file signature list that only apply_inputs consumes.
    # content=False (the final seal pass) re-walks and compares names, sizes and mtimes without re-reading file bytes.
    # restore=True (apply_inputs only) exempts VOLATILE_PREFIX bytes and reports every changed file before denying.
    _pin(pin)
    PROGRESS.stage(label, total_entries=total_entries)
    sidecar = guard.root / SIDECAR
    signatures, count, files, raw_bytes, total, changed = [], 0, 0, 0, 0, []
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
        walker = _walk(guard)
        ordered = _Ordered(guard, workers if content else 1)
        def finisher(row, fresh, signature, exempt, hashed):
            def finish(before_file, sha):
                nonlocal count, files, raw_bytes
                count += 1
                if hashed:
                    same = row['bytes'] == before_file[3] and row['sha256'] == sha
                    if restore and not same:
                        changed.append(fresh['path'])
                    else:
                        need(same, 'BYTES')
                    if require_mtime:
                        need(before_file[4] == row['mtimeNs'], 'MTIME')
                elif fresh['kind'] == 'file' and not exempt:
                    need(not collect and row['bytes'] == signature[3] and type(row['sha256']) is str and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'BYTES')
                    if require_mtime:
                        need(signature[4] == row['mtimeNs'], 'MTIME')
                if fresh['kind'] == 'file':
                    files += 1
                    raw_bytes += row['bytes']
                    need(raw_bytes <= MAX_RAW, 'RAW_BOUND')
                    if collect and not exempt:
                        signatures.append((fresh['path'], signature, row['mtimeNs'], sha))
                PROGRESS.tick(count, files, raw_bytes)
            return finish
        try:
            try:
                for fresh, signature in walker:
                    row = read()
                    if not (type(row) is dict and row.get('kind') == fresh['kind'] and row.get('path') == fresh['path']):
                        _name_set_report(read, walker, fresh, row, count + len(ordered.pending))
                    need(type(row) is dict and row.get('kind') == fresh['kind'] and row.get('path') == fresh['path'], 'NAME_SET')
                    exempt = hashed = False
                    path = None
                    if fresh['kind'] == 'file':
                        need(set(row) == {'kind', 'path', 'bytes', 'sha256', 'mtimeNs'} and type(row['bytes']) is int and
                             type(row['mtimeNs']) is int and 0 <= row['mtimeNs'] <= 253402300799999999999 and
                             (os.name != 'nt' or row['mtimeNs'] % 100 == 0), 'ROW')
                        exempt = restore and fresh['path'].startswith(VOLATILE_PREFIX)
                        hashed = content and not exempt
                        if hashed:
                            path = guard.root / fresh['path']
                    else:
                        need(row == fresh, 'ROW')
                    ordered.push(path, signature, finisher(row, fresh, signature, exempt, hashed))
            except BaseException:
                ordered.drain()
                raise
            ordered.drain()
        finally:
            ordered.close()
        if changed:
            _changed_report(changed)
        need(not changed, 'BYTES')
        need(_line(read()) == _line(dict(kind='end', entries=count, files=files, rawBytes=raw_bytes)), 'END')
        need(stream.read(1) == b'' and total == pin['bytes'] and digest.hexdigest() == pin['sha256'] and
             _signature(os.fstat(stream.fileno())) == before and _signature(sidecar.lstat()) == path_before, 'SIDECAR_CHANGED')
    return signatures


def apply_inputs(root, identity, sidecar_pin, clock, fence, workers=None):
    header = _identity(identity)
    guard = _Guard(root, header, clock, fence)
    # Complete namespace/byte/identity validation precedes the first mutation. This is the only pass that reads
    # file bytes: re-hashing the 29 GB tree for the timestamp pass and again for the final check cost ~53 minutes
    # each (the seal's record walk took 3156 s), so both later passes prove the tree by metadata instead.
    signatures = _verify(guard, header, sidecar_pin, label='verify-restore', restore=True, workers=workers)
    for name, signature, nanoseconds, sha in signatures:
        path = guard.root / name
        # The pass-1 signature pins size, mtime, file id and birth; a replaced or rewritten file fails CHANGED.
        with _hash(path, guard, signature, timestamp=True, content=False) as (stream, before, _):
            guard.check()
            _set_mtime(stream, nanoseconds)
            after = _signature(os.fstat(stream.fileno()))
            need(_shared(after)[:4] == _shared(before)[:4] and _shared(after)[5:] == _shared(before)[5:] and after[4] == nanoseconds and
                 _shared(_signature(path.lstat())) == _shared(after), 'MTIME_CHANGED')
    # A changed sidecar/tree or uncertain close cannot publish successful DATA.
    _verify(guard, header, sidecar_pin, require_mtime=True, collect=False, content=False, label='verify-after-apply',
            total_entries=len(signatures), restore=True)
    return dict(dataOnly=True, timestampsApplied=True, files=len(signatures), sidecar=dict(sidecar_pin),
                sourceQualified=False, checkpointAdmission=False, executionAdmitted=False)
