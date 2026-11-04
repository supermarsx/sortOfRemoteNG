"""Private Darwin hash-primitive comparison; never a CEF/source/SDK grant."""
import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import re
import signal
import stat
import sys
import threading
import time
import types
import unittest

BRANCH = 'refs/heads/codex/mac-source-io-coalescing-proof-20261104'
WORKFLOW = '.github/workflows/cef-engineering-checkpoint.yml'
PYTHON = '/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
PYTHON_SHA = 'b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d'
PINS = {
    'mac_source_io_baseline.py': (229058, 'c728e702508d1a22417197c056d064c496528af82a29b5c993e6f4f521a74dcb'),
    'mac_source_io_candidate.py': (228969, '47d0866df8a9d4f5816a197db8db413b871e0170390384dfd2defdad6d27fc8e'),
    'mac_source_io_boundary_controls.py': (7823, '971a2993429b493a832a68f36a62b10b10cb789c06a688787e2fbe5e230f3c6b'),
    'mac_source_io_inverse.json': (6218, 'ca0496aa0e9c25f0886803a0b8845ce10bf9cdec97b99aa8e3e26fc42e66d290'),
    'mac_owned_source_fd_test.py': (19939, '0f5b287ef6adff29fca698f73faf0e324c7babe36738074671eedd47e030a344'),
    'mac_owned_source_noop_test.py': (6896, '8500196f4ec52dffeab214b90dd9ac2746ba801fb29ce4f9f535b5deb7c5f8e2'),
}
TEMP = Path('/Users/runner/work/_temp')
PHASE = 'authority'
RESULTS = []


def require(value):
    if not value:
        raise RuntimeError('MAC_SOURCE_IO_PROOF_CONTRACT')


def birth_identity(info):
    # Same supplementary identity contract as the held source helper; no inferred ns.
    value = getattr(info, 'st_birthtime_ns', None)
    if value is not None:
        require(type(value) is int and 0 <= value < 2**63)
        return ('birthtime-ns', str(value))
    value = getattr(info, 'st_birthtime', None)
    require(type(value) is float and math.isfinite(value) and 0 <= value < 2**63)
    token = value.hex()
    require(len(token) <= 64 and float.fromhex(token).hex() == token)
    return ('darwin-birthtime-float-hex', token)


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns,
            info.st_uid, info.st_gid, birth_identity(info))


def failure_class(error):
    # Exact builtin classes only; no message, path, stack, arbitrary attribute or getter.
    for kind, label in ((TimeoutError, 'TIMEOUT'), (RuntimeError, 'CONTRACT'), (AttributeError, 'ATTRIBUTE'),
                        (FileNotFoundError, 'MISSING_FILE'), (PermissionError, 'PERMISSION'),
                        (OSError, 'OS_ERROR'), (ValueError, 'VALUE'), (TypeError, 'TYPE'),
                        (KeyError, 'KEY'), (AssertionError, 'ASSERTION'), (KeyboardInterrupt, 'INTERRUPTED')):
        if type(error) is kind:
            return label
    return 'UNKNOWN'


def held(file, maximum, expected=None):
    file = Path(file)
    for parent in reversed(file.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode))
    before = file.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            0 < before.st_size <= maximum)
    handle = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    failed = False
    try:
        require(identity(before) == identity(os.fstat(handle)))
        blocks, count = [], 0
        while True:
            block = os.read(handle, min(65536, maximum + 1 - count))
            if not block:
                break
            blocks.append(block)
            count += len(block)
            require(count <= maximum)
        raw = b''.join(blocks)
        require(count == before.st_size and identity(before) == identity(os.fstat(handle)) == identity(file.lstat()))
        digest = hashlib.sha256(raw).hexdigest()
        require(expected is None or digest == expected)
        return raw, {'bytes': count, 'sha256': digest}
    except BaseException:
        failed = True
        raise
    finally:
        try:
            os.close(handle)
        except BaseException:
            if not failed:
                raise


class OriginalBudget:
    def __init__(self, started):
        self.wall, self.mono = time.time, time.monotonic
        self.lock = threading.Lock()
        now = self.wall()
        require(0 <= now - started < 1080)
        self.wall_end = started + 1140
        self.end = self.mono() + min(1080, self.wall_end - now)
        self.seconds = min(1080, int(self.wall_end - now))
        self.last_wall, self.last_mono = now, self.mono()

    def check(self):
        with self.lock:
            wall, mono = self.wall(), self.mono()
            if wall < self.last_wall or mono < self.last_mono or wall >= self.wall_end or mono >= self.end:
                raise TimeoutError('MAC_SOURCE_IO_PROOF_DEADLINE')
            self.last_wall, self.last_mono = wall, mono


def module(raw, file, initial):
    value = types.ModuleType('held_' + Path(file).stem)
    value.__file__ = str(file)
    value.__dict__.update(initial)
    exec(compile(raw, str(file), 'exec'), value.__dict__)
    return value


def controls(value, budget, expected, label):
    class Result(unittest.TextTestResult):
        def startTest(self, case):
            budget.check()
            super().startTest(case)
    result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0, resultclass=Result).run(
        unittest.defaultTestLoader.loadTestsFromModule(value))
    failed = [case._testMethodName for case, _ in result.failures + result.errors]
    require(all(re.fullmatch('test_[a-z_]{1,120}', name) for name in failed))
    summary = {'label': label, 'tests': result.testsRun, 'skipped': len(result.skipped),
               'failures': len(result.failures), 'errors': len(result.errors), 'failedTests': failed}
    RESULTS.append(summary)
    require(result.wasSuccessful() and result.testsRun == expected and not result.skipped)
    budget.check()
    return summary


def capture_modules(raw, fd_raw, noop_raw, fixture_dir, outer=None):
    initial = {'HELD_HELPER_RAW': raw}
    if outer is not None:
        header = b'def noop_inverse(raw):\n'
        direct = b"new=functions(RAW)['_source_mac_fd_hash'];old=functions(OLD)['source_hash']"
        decoded = b"new=functions(HELD_CANDIDATE_INVERSE(RAW))['_source_mac_fd_hash'];old=functions(OLD)['source_hash']"
        require(fd_raw.count(header) == 1)
        require(fd_raw.count(direct) == 1)
        adapted = fd_raw.replace(header, header + b'    raw = HELD_CANDIDATE_INVERSE(raw)\n', 1)
        adapted = adapted.replace(direct, decoded, 1)
        require(adapted.replace(b'    raw = HELD_CANDIDATE_INVERSE(raw)\n', b'', 1).replace(decoded, direct, 1) == fd_raw)
        fd_raw = adapted
        initial['HELD_CANDIDATE_INVERSE'] = outer
    fd = module(fd_raw, fixture_dir / 'mac_owned_source_fd_test.py', initial)
    noop = module(noop_raw, fixture_dir / 'mac_owned_source_noop_test.py', {'HELD_FD_CONTROLS': fd})
    return fd, noop


def fixture_snapshots(fd, budget):
    fixture = fd.OwnedFilesystem(methodName='test_owned_snapshot_pair_matches_entire_old_helper')
    try:
        fixture.setUp()
        # Existing70 regular files +9,930 files across fixed deep parent groups.
        for index in range(70, 10000):
            budget.check()
            directory = fixture.root / 'src/io-fixture' / ('group%03d' % (index % 160))
            for depth in range(index % 8):
                directory /= 'deep%d' % depth
            directory.mkdir(parents=True, exist_ok=True)
            size = (0, 1, 127, 4096, 18000)[index % 5]
            (directory / ('input%05d.bin' % index)).write_bytes(bytes([index % 251]) * size)
        return fixture
    except BaseException:
        try:
            fixture.tearDown()
        except BaseException:
            pass
        raise


def main():
    global PHASE
    env = os.environ
    PHASE = 'authority-platform'
    require(len(sys.argv) == 1 and sys.platform == 'darwin' and platform.machine() == 'x86_64')
    PHASE = 'authority-repository'
    require(env.get('GITHUB_REPOSITORY') == 'supermarsx/sortOfRemoteNG' and env.get('GITHUB_REPOSITORY_ID') == '1010282954')
    PHASE = 'authority-provider'
    require(env.get('GITHUB_ACTIONS') == 'true' and env.get('RUNNER_ENVIRONMENT') == 'github-hosted')
    PHASE = 'authority-ref'
    require(env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and env.get('GITHUB_REF') == BRANCH)
    PHASE = 'authority-image'
    require(env.get('GITHUB_REPOSITORY_VISIBILITY') == 'public' and env.get('ImageOS') == 'macos15')
    PHASE = 'authority-temp'
    require(env.get('ImageVersion') == '20260824.0482.1' and env.get('RUNNER_TEMP') == str(TEMP))
    PHASE = 'authority-credentials'
    require(not any(name in env for name in ('GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'PYTHONPATH')))
    PHASE = 'authority-head'
    require(re.fullmatch('[a-f0-9]{40}', env.get('GITHUB_SHA', '')) is not None)
    PHASE = 'authority-run'
    require(re.fullmatch('[1-9][0-9]{0,14}', env.get('GITHUB_RUN_ID', '')) is not None)
    PHASE = 'authority-attempt'
    require(re.fullmatch('[1-9][0-9]{0,3}', env.get('GITHUB_RUN_ATTEMPT', '')) is not None)
    PHASE = 'authority-workflow-head'
    require(env.get('GITHUB_WORKFLOW_SHA') == env['GITHUB_SHA'])
    PHASE = 'authority-workflow-ref'
    require(env.get('GITHUB_WORKFLOW_REF') == 'supermarsx/sortOfRemoteNG/' + WORKFLOW + '@' + BRANCH)
    PHASE = 'authority-original-clock'
    started = env.get('CEF_MAC_IO_PROOF_STARTED_MS', '')
    require(re.fullmatch('[0-9]{13}', started) is not None)
    budget = OriginalBudget(int(started) / 1000)
    def expire(_number, _frame):
        raise TimeoutError('MAC_SOURCE_IO_PROOF_DEADLINE')
    signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, max(0.001, budget.end - time.monotonic()))
    repo = Path(__file__).resolve().parents[3]
    fixture_dir = repo / 'tests/fixtures/cef'
    PHASE = 'held-checkout-head'
    head, head_pin = held(repo / '.git/HEAD', 41)
    require(head == (env['GITHUB_SHA'] + '\n').encode())
    PHASE = 'held-python'
    _, python_pin = held(PYTHON, 16384, PYTHON_SHA)
    require(Path(sys.executable).resolve() == Path(PYTHON).resolve())
    PHASE = 'held-workflow'
    _, workflow_pin = held(repo / WORKFLOW, 65536)
    PHASE = 'held-carrier'
    _, self_pin = held(Path(__file__), 65536)
    raws, pins = {}, {}
    for name, (size, digest) in PINS.items():
        PHASE = 'held-subject-' + name.removeprefix('mac_').removesuffix('.py').removesuffix('.json').replace('_', '-')
        raws[name], pins[name] = held(fixture_dir / name, size, digest)
        require(len(raws[name]) == size)
    PHASE = 'whole-candidate-inverse'
    baseline, candidate = raws['mac_source_io_baseline.py'], raws['mac_source_io_candidate.py']
    inverse = json.loads(raws['mac_source_io_inverse.json'])
    require(inverse['baseline'] == pins['mac_source_io_baseline.py'] and inverse['candidate'] == pins['mac_source_io_candidate.py'])
    require(len(inverse['rows']) == 1 and inverse['rows'][0]['occurrences'] == 1)
    row = inverse['rows'][0]
    def outer(raw):
        require(raw == candidate and raw.count(row['after'].encode()) == 1)
        restored = raw.replace(row['after'].encode(), row['before'].encode(), 1)
        require(restored == baseline)
        return restored
    require(outer(candidate) == baseline)
    PHASE = 'held-controls'
    baseline_fd, baseline_noop = capture_modules(baseline, raws['mac_owned_source_fd_test.py'], raws['mac_owned_source_noop_test.py'], fixture_dir)
    candidate_fd, candidate_noop = capture_modules(candidate, raws['mac_owned_source_fd_test.py'], raws['mac_owned_source_noop_test.py'], fixture_dir, outer)
    controls(baseline_fd, budget, 19, 'baseline-fd')
    controls(baseline_noop, budget, 25, 'baseline-codec')
    controls(candidate_fd, budget, 19, 'candidate-fd')
    controls(candidate_noop, budget, 25, 'candidate-codec')
    boundary = module(raws['mac_source_io_boundary_controls.py'], fixture_dir / 'mac_source_io_boundary_controls.py',
                      {'HELD_BASELINE_RAW': baseline, 'HELD_CANDIDATE_RAW': candidate})
    controls(boundary, budget, 6, 'boundary-capture-modeled-faults')
    PHASE = 'two-complete-snapshots'
    fixture = fixture_snapshots(baseline_fd, budget)
    snapshots, ledgers, previous = {}, {}, None
    try:
        for label, fd, raw in [('baseline', baseline_fd, baseline), ('candidate', candidate_fd, candidate)]:
            current = fd.load(raw)
            scopes = []
            original_init = current._MacSourceFdScope.__init__
            def capture(scope, *args, _original=original_init, **kwargs):
                _original(scope, *args, **kwargs)
                scopes.append(scope)
            current._MacSourceFdScope.__init__ = capture
            snapshots[label] = []
            for _ in range(2):
                budget.check()
                began = time.monotonic()
                current.source_progress_start(budget.seconds)
                value = fixture.snapshot(module=current, budget=budget)
                current.source_phase('done')
                require(previous is None or value == previous)
                previous = value
                files = sum(item['kind'] == 'file' for item in value['entries'])
                hashed = current.SOURCE_PROGRESS['totals'][0]
                require(hashed == files and current.SOURCE_PROGRESS['totals'][2] == 0)
                snapshots[label].append({'elapsedMs': round((time.monotonic() - began) * 1000),
                    'entries': len(value['entries']), 'files': files, 'bytes': value['bytes'], 'hashedFiles': hashed,
                    'snapshotSha256': hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                    'phases': [list(item) for item in current.SOURCE_PROGRESS['phases']]})
            require(len(scopes) == 2)
            ledgers[label] = []
            for scope in scopes:
                require(scope.active == 0 and scope.peak <= 3 and scope.opened == scope.closed == scope.close_attempts
                        and not scope.ledger and scope.unknown == 0)
                ledgers[label].append({'peakFDs': scope.peak, 'opened': scope.opened, 'closed': scope.closed,
                    'closeAttempts': scope.close_attempts, 'unknown': scope.unknown, 'active': scope.active})
        require(set(previous['gitHeads']) == {'src', 'src/cef', 'depot_tools'})
    except BaseException:
        try:
            fixture.tearDown()
        except BaseException:
            pass
        raise
    else:
        fixture.tearDown()
    PHASE = 'final-pins'
    for name, (size, digest) in PINS.items():
        PHASE = 'final-subject-' + name.removeprefix('mac_').removesuffix('.py').removesuffix('.json').replace('_', '-')
        held(fixture_dir / name, size, digest)
    PHASE = 'final-checkout-head'
    held(repo / '.git/HEAD', 41, head_pin['sha256'])
    PHASE = 'final-workflow'
    held(repo / WORKFLOW, 65536, workflow_pin['sha256'])
    held(Path(__file__), 65536, self_pin['sha256'])
    budget.check()
    report = {'schemaVersion': 1, 'kind': 'private-mac-fullhash-boundary-capture-proof',
        'head': env['GITHUB_SHA'], 'runId': env['GITHUB_RUN_ID'], 'attempt': env['GITHUB_RUN_ATTEMPT'],
        'imageEnvironment': env['ImageVersion'], 'pythonVersion': platform.python_version(), 'cpuCount': os.cpu_count(),
        'python': python_pin, 'workflow': workflow_pin, 'carrier': self_pin, 'subjects': pins,
        'controls': RESULTS, 'snapshots': snapshots, 'ledgers': ledgers, 'completeCanonicalEquality': True,
        'fixtureRegularFilesRequested': 10000, 'workers': 1, 'batchCap': 32, 'fdCap': 3,
        'rawDarwinBirthFacts': True, 'boundaryFaultStatsAreModels': True, 'publicSourceGrantIssued': False,
        'historicalInverseControlsDecodeExactCandidateLayer': True, 'runtimeControlsUseWholeHeldCandidate': True,
        'SDKSourceUsed': False, 'sourceQualified': False, 'nativeAcceptance': False, 'runtimeReady': False,
        'scope': 'Two full primitive snapshots each; real scratch FS/Git only; fixed warm order; no full-source fit or ETA claim'}
    PHASE = 'report'
    raw = (json.dumps(report, sort_keys=True, separators=(',', ':')) + '\n').encode()
    require(len(raw) <= 32768)
    target = TEMP / 'cef-mac-source-io-proof-report.json'
    handle = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    failed = False
    try:
        require(os.write(handle, raw) == len(raw))
        os.fsync(handle)
    except BaseException:
        failed = True
        raise
    finally:
        try:
            os.close(handle)
        except BaseException:
            if not failed:
                raise
    _, report_pin = held(target, 32768, hashlib.sha256(raw).hexdigest())
    budget.check()
    signal.setitimer(signal.ITIMER_REAL, 0)
    print(json.dumps({'kind': report['kind'], 'report': report_pin, 'runtimeReady': False}, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        label = 'DEADLINE' if type(error) is TimeoutError else 'CONTRACT' if type(error) is RuntimeError else 'UNCLASSIFIED'
        try:
            print(json.dumps({'kind': 'private-mac-fullhash-boundary-capture-proof', 'success': False,
                'phase': PHASE, 'failure': label, 'failureClass': failure_class(error),
                'results': RESULTS, 'runtimeReady': False}, separators=(',', ':')))
        except BaseException:
            pass
        sys.exit(1)
