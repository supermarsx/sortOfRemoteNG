"""Closed scratch-only Darwin codec proof. Never admits production source writes."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import stat
import sys
import time

REPOSITORY = Path(__file__).resolve().parents[3]
IMAGE = '20260824.0482.1'
SOURCE = '65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54'
PYTHON = '/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
PYTHON_SHA = 'b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d'
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
PREFLIGHT_STAGES = ('arguments', 'host', 'image', 'runner', 'python-executable',
                    'python-pin', 'temp', 'output', 'helper-import', 'admission',
                    'owned-root', 'capability', 'public-gates', 'roundtrip', 'cleanup', 'report')
CURRENT_STAGE = 'arguments'
INTERPRETER_FACTS = None


def need(value):
    if not value:
        raise RuntimeError('OWNED_SOURCE_PROOF_DENIED')


def at_stage(stage):
    global CURRENT_STAGE
    need(stage in PREFLIGHT_STAGES)
    CURRENT_STAGE = stage


def interpreter_relation():
    actual, expected = Path(sys.executable), Path(PYTHON)
    framework = expected.parents[1] / 'Resources/Python.app/Contents/MacOS/Python'
    role = 'reviewed-launcher' if actual == expected else 'framework-app' if actual == framework else 'other'
    basename = actual.name if actual.name in ('python3.14', 'Python', 'python3', 'python', 'python.exe') else 'other'
    try:
        canonical = actual.resolve(strict=True) == expected.resolve(strict=True)
    except (OSError, RuntimeError):
        canonical = None
    return {'role': role, 'basename': basename, 'lexicalMatch': sys.executable == PYTHON,
            'canonicalMatch': canonical}


def preflight_failure():
    value = {'kind': 'sorng-macarm-owned-source-preflight', 'complete': False,
             'stage': CURRENT_STAGE, 'failure': 'OWNED_SOURCE_PROOF_DENIED',
             'sourceWriteAdmitted': False}
    if INTERPRETER_FACTS is not None:
        value['interpreter'] = INTERPRETER_FACTS
    return value


def helper():
    file = REPOSITORY / 'scripts/lib/cef-checkpoint-archive.py'
    spec = importlib.util.spec_from_file_location('owned_checkpoint_codec', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def owner(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid


def verify_python():
    path = Path(PYTHON)
    before = path.lstat()
    key = lambda value: (owner(value), value.st_size, value.st_nlink, value.st_mtime_ns, value.st_ctime_ns)
    need(stat.S_ISREG(before.st_mode) and before.st_size == 13592)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(key(os.fstat(fd)) == key(before))
        raw = bytearray()
        while len(raw) <= 13592:
            chunk = os.read(fd, 13593 - len(raw))
            if not chunk:
                break
            raw.extend(chunk)
        need(len(raw) == 13592 and key(os.fstat(fd)) == key(before) == key(path.lstat()))
        need(hashlib.sha256(raw).hexdigest() == PYTHON_SHA)
    finally:
        os.close(fd)


class OwnedTree:
    """Only explicit creation receipts may authorize this fixture's cleanup."""
    def __init__(self, root):
        root.mkdir(mode=0o700)
        self.root = root
        self.created = {root: owner(root.lstat())}

    def check(self, path):
        info = path.lstat()
        need(path in self.created and owner(info) == self.created[path])
        need(info.st_uid == os.geteuid())
        return info

    def directory(self, relative):
        path = self.root
        for part in Path(relative).parts:
            need(part not in ('', '.', '..'))
            self.check(path)
            path = path / part
            if path not in self.created:
                path.mkdir(mode=0o700)
                self.created[path] = owner(path.lstat())
            need(stat.S_ISDIR(self.check(path).st_mode))
        return path

    def file(self, relative, raw, maximum=4096):
        need(maximum in (4096, 128 * 1024) and type(raw) is bytes and len(raw) <= maximum)
        path = self.root / relative
        self.directory(str(Path(relative).parent))
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            before = os.fstat(fd)
            self.created[path] = owner(before)
            need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1)
            need(os.write(fd, raw) == len(raw))
            need(owner(path.lstat()) == owner(os.fstat(fd)) == self.created[path])
        finally:
            os.close(fd)
        return path

    def link(self, relative, target):
        path = self.root / relative
        self.directory(str(Path(relative).parent))
        os.symlink(target, path)
        self.created[path] = owner(path.lstat())
        need(stat.S_ISLNK(self.check(path).st_mode) and os.readlink(path) == target)
        return path

    def adopt_file(self, path, maximum):
        # This exact file was written by the just-completed bounded codec call.
        need(path.parent in self.created)
        self.check(path.parent)
        info = path.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= maximum)
        self.created[path] = owner(info)

    def cleanup(self):
        okay = True
        for path in sorted(self.created, key=lambda path: len(path.parts), reverse=True):
            if path == self.root:
                continue
            try:
                self.check(path.parent)
                info = self.check(path)
                if stat.S_ISDIR(info.st_mode):
                    os.rmdir(path)
                else:
                    need(stat.S_ISLNK(info.st_mode) or stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
                    os.unlink(path)
            except (OSError, RuntimeError):
                okay = False
        self.check(self.root)
        return okay and not any(self.root.iterdir())


def fixture(tree, module):
    work = tree.directory('work')
    root = tree.directory('work/source')
    out = tree.directory('work/source/src/out/Release_GN_arm64')
    tree.directory('work/source/src/cef/include')
    tree.directory('work/source/depot_tools')
    tree.directory('work/source/src/empty')
    registry = "entries = {'src': 'https://public.example/src', '" + module.NEARBY_ROOT + "': 'https://public.example/nearby'}\n"
    tree.file('work/source/.gclient_entries', registry.encode('ascii'))
    for name in ('src', 'src/cef', 'depot_tools'):
        tree.file('work/source/' + name + '/.git/HEAD', b'a' * 40 + b'\n')
    tree.file('work/source/' + module.NEARBY_ROOT + '/.git/HEAD', (module.NEARBY_HEAD + '\n').encode('ascii'))
    for name in ('src/input.cc', 'src/cef/include/generated.h', 'depot_tools/helper.py'):
        tree.file('work/source/' + name, ('owned fixture ' + name + '\n').encode('ascii'))
    tree.link('work/source/src/input-link', 'input.cc')
    identity = {key: hashlib.sha256(('synthetic-owned-proof-' + key).encode()).hexdigest()
                for key in ('producer', 'tools', 'graph', 'siso')}
    identity.update(target='aarch64-apple-darwin', source=SOURCE, canonicalRoot=str(work), image=IMAGE)
    return work, root, out / module.SOURCE_METADATA_NAME, identity


def codec(module, mode, work, root, sidecar, identity):
    with module.source_io_scope(mode):
        return module._source_metadata_owned_codec(mode, root, sidecar, identity, work,
                                                   module.Budget(15), 'mac-arm')


def roundtrip(tree, module):
    work, root, sidecar, identity = fixture(tree, module)
    record = codec(module, 'source-record', work, root, sidecar, identity)
    tree.adopt_file(sidecar, 128 * 1024)
    original = sidecar.read_bytes()
    stored = json.loads(original)
    need(stored['kind'] == 'sorng-macarm-source-metadata')
    need(stored['policy'] == module.MAC_SOURCE_METADATA_POLICY)
    need(set(stored['snapshot']) == {'entries', 'rootMtimeNs', 'gitHeads', 'bytes'})
    need(all('birthNs' not in row and 'birthIdentity' not in row for row in stored['snapshot']['entries']))
    need(codec(module, 'source-verify', work, root, sidecar, identity)['complete'])
    file = root / 'src/input.cc'
    original_hash = hashlib.sha256(file.read_bytes()).hexdigest()
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        os.utime(fd, ns=(info.st_atime_ns, info.st_mtime_ns + 2_000_000_000))
    finally:
        os.close(fd)
    drift = False
    drift_reason = None
    try:
        codec(module, 'source-verify', work, root, sidecar, identity)
    except module.CheckpointError as error:
        need(str(error) == 'source-metadata-postcheck')
        need(not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
        drift = True
        drift_reason = str(error)
    need(drift)
    applied = codec(module, 'source-apply', work, root, sidecar, identity)
    verified = codec(module, 'source-verify', work, root, sidecar, identity)
    need(sidecar.read_bytes() == original and hashlib.sha256(file.read_bytes()).hexdigest() == original_hash)
    need(not (root / 'acquisition-logs' / module.SOURCE_STAT_CACHE_NAME).exists())
    return {'complete': True, 'recorded': record['complete'], 'driftDetected': drift, 'driftReason': drift_reason,
            'applied': applied['complete'], 'verified': verified['complete'],
            'sidecarKind': stored['kind'], 'sidecarUnchanged': True, 'noLinuxStatCache': True,
            'identityKind': 'synthetic-owned-proof', 'birthIdentityPortable': False,
            'entries': record['entries'], 'cleanupConfirmed': False}


def preflight(args):
    global INTERPRETER_FACTS
    INTERPRETER_FACTS = None
    at_stage('arguments')
    need(len(args) == 2 and args[0] == '--output')
    at_stage('host')
    need(sys.platform == 'darwin' and platform.machine() == 'x86_64')
    at_stage('image')
    need(os.environ.get('ImageOS') == 'macos15' and os.environ.get('ImageVersion') == IMAGE)
    at_stage('runner')
    need(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted')
    need(os.environ.get('GITHUB_REPOSITORY_VISIBILITY') == 'public')
    at_stage('python-executable')
    INTERPRETER_FACTS = interpreter_relation()
    need(sys.executable == PYTHON)
    at_stage('python-pin')
    verify_python()
    at_stage('temp')
    temp = Path(os.environ['RUNNER_TEMP'])
    need(temp.is_absolute() and temp.resolve(strict=True) == temp and not temp.is_symlink())
    need(temp.stat().st_uid == os.geteuid())
    at_stage('output')
    output = Path(args[1])
    need(output.parent == temp and re.fullmatch('cef-mac-owned-proof-' + UUID, output.name))
    need(not os.path.lexists(output))
    at_stage('helper-import')
    module = helper()
    at_stage('admission')
    need(module.MAC_SOURCE_WRITE_ADMITTED is False)
    return output, module


def main(args):
    output, module = preflight(args)
    at_stage('owned-root')
    tree = OwnedTree(output)
    report = {'schemaVersion': 1, 'kind': 'sorng-macarm-owned-source-proof', 'complete': False,
              'hostPlatform': 'darwin', 'hostArchitecture': 'x86_64', 'targetArchitecture': 'arm64',
              'image': IMAGE, 'sourceLockReference': SOURCE, 'sourceWriteAdmitted': False,
              'nativeAcceptance': False, 'runtimeReady': False, 'failure': None}
    try:
        at_stage('capability')
        capability_path = output / 'capability.json'
        module.mac_owned_capability_observe({'outputRoot': str(output), 'target': 'aarch64-apple-darwin'},
                                           capability_path, module.Budget(5), owned_birth_proof=True)
        tree.adopt_file(capability_path, 65536)
        capability = json.loads(capability_path.read_bytes())
        report['capability'] = capability
        need(capability['complete'] and len(capability['rows']) == 12)
        need(all(row['exactMtimeReadback'] and row['symlinkTargetUnchanged'] for row in capability['rows']))
        at_stage('public-gates')
        for mode in module.SOURCE_IO_MODES:
            try:
                module.source_metadata(mode, output / 'must-not-read', output / 'must-not-write', {},
                                       platform_policy='mac-arm')
            except module.CheckpointError as error:
                need(str(error) == 'source-mac-darwin-capability-unreviewed')
            else:
                need(False)
        report['publicAdmissionDeniedBefore'] = True
        at_stage('roundtrip')
        report['roundtrip'] = roundtrip(tree, module)
        need(module.MAC_SOURCE_WRITE_ADMITTED is False)
        report['publicAdmissionDisabledAfter'] = True
    except BaseException:
        report['failure'] = 'OWNED_SOURCE_PROOF_FAILED'
    finally:
        at_stage('cleanup')
        try:
            clean = tree.cleanup()
        except BaseException:
            clean = False
        report['cleanupConfirmed'] = clean
        if 'roundtrip' in report:
            report['roundtrip']['cleanupConfirmed'] = clean
        report['complete'] = report['failure'] is None and clean
        raw = (json.dumps(report, sort_keys=True, separators=(',', ':')) + '\n').encode()
        need(len(raw) <= 128 * 1024)
        at_stage('report')
        tree.file('proof.json', raw, maximum=128 * 1024)
    print(json.dumps({'complete': report['complete'], 'sourceWriteAdmitted': False}))
    return 0 if report['complete'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except BaseException:
        print(json.dumps(preflight_failure(), sort_keys=True, separators=(',', ':')))
        raise SystemExit(1)
