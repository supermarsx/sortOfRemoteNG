"""Fixed Intel scratch codec proof. This diagnostic writes no production inputs."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import sys
import time

spec = importlib.util.spec_from_file_location('owned_proof_base', Path(__file__).with_name('mac_owned_source_proof.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
SOURCE = '684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef'
TARGET = 'x86_64-apple-darwin'
need = base.need
FAILURE_CODES = frozenset(('source-sidecar-role','source-sidecar-binding','source-content-changed',
    'source-metadata-postcheck','source-mac-write-identity','source-write-identity',
    'source-mac-birth-unavailable','source-mac-root-changed','source-root-changed',
    'source-close-failure','archive-deadline'))


class IntelOwnedTree(base.OwnedTree):
    def __init__(self,module,receipt):
        # Adopt the helper's genuine exclusive creation; do not mkdir again.
        self.root = module._mac_intel_owned_proof_path(receipt)
        self.created = {self.root:base.owner(self.root.lstat())}
        self.check(self.root)


def failure_code(error,module):
    if type(error) is module.CheckpointError and len(error.args)==1 and type(error.args[0])is str and error.args[0] in FAILURE_CODES:
        return error.args[0]
    return 'source-close-failure' if module.SOURCE_CLOSE_FAILURE else 'OWNED_INTEL_SOURCE_PROOF_FAILED'


def public_denied(module, output):
    need(module.MAC_INTEL_SOURCE_WRITE_ADMITTED is True)
    for mode in module.SOURCE_IO_MODES:
        try:
            module.source_metadata(mode, output/'must-not-read', output/'must-not-write', {}, platform_policy='mac-intel')
        except module.CheckpointError as error:
            need(str(error) == 'source-mac-identity-scope')
        else:
            need(False)


def fixture(tree, module):
    work = tree.directory('work')
    root = tree.directory('work/source')
    out = tree.directory('work/source/src/out/Release_GN_x64')
    tree.directory('work/source/src/cef/include')
    tree.directory('work/source/depot_tools')
    tree.directory('work/source/src/empty')
    registry = "entries = {'src': 'https://public.example/src', '" + module.NEARBY_ROOT + "': 'https://public.example/nearby'}\n"
    tree.file('work/source/.gclient_entries', registry.encode('ascii'))
    for name in ('src', 'src/cef', 'depot_tools'):
        tree.file('work/source/'+name+'/.git/HEAD', b'a'*40+b'\n')
    tree.file('work/source/'+module.NEARBY_ROOT+'/.git/HEAD', (module.NEARBY_HEAD+'\n').encode('ascii'))
    for name in ('src/input.cc', 'src/cef/include/generated.h', 'depot_tools/helper.py'):
        tree.file('work/source/'+name, ('owned Intel fixture '+name+'\n').encode('ascii'))
    tree.link('work/source/src/input-link', 'input.cc')
    identity = {key:hashlib.sha256(('synthetic-owned-intel-proof-'+key).encode()).hexdigest()
                for key in ('producer','tools','graph','siso')}
    identity.update(target=TARGET, source=SOURCE, canonicalRoot=str(work), image=base.IMAGE)
    return work, root, out/module.SOURCE_METADATA_NAME, identity


def replace_input(tree, file, raw):
    """Replace only one creation-owned fixture file with a distinct live inode."""
    before = tree.check(file)
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1)
    tree.check(file.parent)
    relative = str(file.relative_to(tree.root))
    pending = tree.file(relative+'.recreated', raw)
    fresh = tree.check(pending)
    need((fresh.st_dev,fresh.st_ino) != (before.st_dev,before.st_ino))
    need(base.owner(file.lstat()) == base.owner(before))
    os.replace(pending, file)
    tree.created[file] = tree.created.pop(pending)
    need(base.owner(tree.check(file)) == base.owner(fresh))
    need(file.read_bytes() == raw)


def roundtrip(tree, module, budget):
    work, root, sidecar, identity = fixture(tree, module)
    def codec(mode):
        budget.check()
        with module.source_io_scope(mode):
            result = module._source_metadata_owned_codec(mode, root, sidecar, identity, work, budget, 'mac-intel')
        need(not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
        return result
    recorded = codec('source-record')
    tree.adopt_file(sidecar, 128*1024)
    original = sidecar.read_bytes()
    stored = json.loads(original)
    need(stored['kind'] == 'sorng-macintel-source-metadata' and stored['policy'] == module.MAC_INTEL_SOURCE_METADATA_POLICY)
    need(set(stored['snapshot']) == {'entries','rootMtimeNs','gitHeads','bytes'})
    need(all('birthNs' not in row and 'birthIdentity' not in row for row in stored['snapshot']['entries']))
    need(codec('source-verify')['complete'])
    file = root/'src/input.cc'
    content = file.read_bytes()
    initial = tree.check(file)
    # Same-length content corruption must fail before any metadata writes.
    replace_input(tree, file, bytes([content[0]^1])+content[1:])
    before = {path:tree.check(path).st_mtime_ns for path in tree.created}
    original_utime = module.os.utime
    attempted_utimes = 0
    def observe_utime(*args,**kwargs):
        nonlocal attempted_utimes
        attempted_utimes += 1
        return original_utime(*args,**kwargs)  # Observe; never suppress real IO.
    module.os.utime = observe_utime
    try:
        try:
            codec('source-apply')
        except module.CheckpointError as error:
            need(str(error) == 'source-content-changed')
            need(not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
        else:
            need(False)
    finally:
        module.os.utime = original_utime
    need(attempted_utimes == 0)
    need(before == {path:tree.check(path).st_mtime_ns for path in tree.created})
    replace_input(tree, file, content)
    need((tree.check(file).st_dev,tree.check(file).st_ino) != (initial.st_dev,initial.st_ino))
    fd = os.open(file, os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need(base.owner(info) == base.owner(tree.check(file)))
        os.utime(fd, ns=(info.st_atime_ns,info.st_mtime_ns+2_000_000_000))
    finally:
        os.close(fd)
    try:
        codec('source-verify')
    except module.CheckpointError as error:
        need(str(error) == 'source-metadata-postcheck')
        need(not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
    else:
        need(False)
    applied, verified = codec('source-apply'), codec('source-verify')
    need(sidecar.read_bytes() == original and file.read_bytes() == content)
    need(not (root/'acquisition-logs'/module.SOURCE_STAT_CACHE_NAME).exists())
    return {'complete':True,'recorded':recorded['complete'],'recreatedInode':True,'corruptBytesDeniedBeforeUtime':True,
            'driftDetected':True,'applied':applied['complete'],'verified':verified['complete'],
            'sidecarKind':stored['kind'],'sidecarUnchanged':True,'noLinuxStatCache':True,
            'identityKind':'synthetic-owned-intel-proof','birthIdentityPortable':False,
            'entries':recorded['entries'],'cleanupConfirmed':False}


def preflight(args):
    base.at_stage('arguments')
    need(len(args) == 2 and args[0] == '--output')
    base.at_stage('host')
    need(sys.platform == 'darwin' and platform.machine() == 'x86_64')
    base.at_stage('image')
    need(os.environ.get('ImageOS') == 'macos15' and os.environ.get('ImageVersion') == base.IMAGE)
    base.at_stage('runner')
    need(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
         os.environ.get('GITHUB_REPOSITORY_VISIBILITY') == 'public')
    base.at_stage('python-executable')
    executable = PurePosixPath(sys.executable)
    need(executable.is_absolute() and executable.anchor == '/' and str(executable) == sys.executable and
         '..' not in executable.parts and '\\' not in sys.executable and '\x00' not in sys.executable and
         executable.name == PurePosixPath(base.PYTHON).name and base.interpreter_relation()['canonicalMatch'] is True)
    base.at_stage('python-pin')
    base.verify_python()
    base.at_stage('temp')
    temp = Path(os.environ['RUNNER_TEMP'])
    need(str(temp) == '/Users/runner/work/_temp' and temp.resolve(strict=True) == temp and
         not temp.is_symlink() and temp.stat().st_uid == os.geteuid())
    base.at_stage('output')
    output = Path(args[1])
    need(output.parent == temp and re.fullmatch('cef-mac-intel-owned-proof-'+base.UUID,output.name) and not os.path.lexists(output))
    base.at_stage('helper-import')
    module = base.helper()
    base.at_stage('admission')
    need(module.MAC_INTEL_SOURCE_WRITE_ADMITTED is True and module.MAC_INTEL_SOURCE == SOURCE and
         module.MAC_INTEL_SOURCE_IMAGE == base.IMAGE and module.MAC_INTEL_SOURCE_PROOF ==
         (41348226366,13099539006,'499ade0595d3e3d90fa15aea1ffb8499e297bf3f',16278,
          '2e56488f480ed75dc479569d5214914b4b2ed0e73732e2a1723156d85a0ca249',
          'c34dde53d28645ddb78c0ac7b97b40df48d6acce10ff260462bb7178c6f9aab5'))
    started = int(os.environ['CEF_MAC_PACKAGE_JOB_STARTED_MS'])
    now = time.time_ns()//1_000_000
    seconds = min(100,(started+300000-now-30000)//1000)
    need(started > 0 and now >= started and seconds >= 15)
    return output, module, module.Budget(seconds-5)


def main(args):
    output, module, budget = preflight(args)
    base.at_stage('owned-root')
    tree=None;clean=False;writer_closed=False;retired=False
    report = {'schemaVersion':1,'kind':'sorng-macintel-owned-source-proof','complete':False,
              'hostPlatform':'darwin','hostArchitecture':'x86_64','targetArchitecture':'x64',
              'image':base.IMAGE,'sourceLockReference':SOURCE,'sourceWriteAdmitted':False,
              'productionInputWrites':False,'publicOutOfScopeDeniedBefore':False,
              'publicOutOfScopeDeniedAfter':False,'scopedSourceWritesSupported':True,
              'scopedSourcePolicy':module.MAC_INTEL_SOURCE_METADATA_POLICY,'nativeAcceptance':False,'runtimeReady':False,
              'proofWriterClosed':False,'proofWriterCapabilityRetired':False,'failure':None,'failureCode':None}
    def failed(error):
        if report['failure'] is None:
            report['failure']='OWNED_INTEL_SOURCE_PROOF_FAILED'
            report['failureStage']=base.CURRENT_STAGE
            report['failureCode']=failure_code(error,module)
    try:
        with module._mac_intel_owned_proof_tree(output,budget) as receipt:
            tree=IntelOwnedTree(module,receipt)
            try:
                base.at_stage('capability')
                budget.check()
                module.mac_owned_capability_observe({'kind':'sorng-macintel-external-input-context','source':SOURCE,
                    'outputRoot':str(output),'target':TARGET},output/'capability.json',module.Budget(5),owned_birth_proof=True)
                tree.adopt_file(output/'capability.json',65536)
                report['capability'] = json.loads((output/'capability.json').read_bytes())
                need(report['capability']['complete'] and len(report['capability']['rows']) == 12 and
                     all(row['exactMtimeReadback'] and row['symlinkTargetUnchanged'] for row in report['capability']['rows']))
                base.at_stage('public-gates')
                public_denied(module,output)
                report['publicOutOfScopeDeniedBefore'] = True
                base.at_stage('roundtrip')
                report['roundtrip'] = roundtrip(tree,module,budget)
                public_denied(module,output)
                report['publicOutOfScopeDeniedAfter'] = True
                budget.check()
            except BaseException as error:
                failed(error)
            finally:
                base.at_stage('cleanup')
                try:clean=tree.cleanup()
                except BaseException as error:failed(error)
        writer_closed=True
        try:module._mac_intel_owned_proof_path(receipt)
        except module.CheckpointError as error:retired=error.args==('source-sidecar-role',)
        need(retired)
    except BaseException as error:
        failed(error)
    report['proofWriterClosed']=writer_closed
    report['proofWriterCapabilityRetired']=retired
    report['cleanupConfirmed']=clean and writer_closed and retired and not module.SOURCE_CLOSE_FAILURE
    if 'roundtrip' in report:report['roundtrip']['cleanupConfirmed']=report['cleanupConfirmed']
    report['complete']=report['failure'] is None and report['cleanupConfirmed']
    raw=(json.dumps(report,sort_keys=True,separators=(',',':'))+'\n').encode()
    need(len(raw)<=128*1024 and tree is not None)
    base.at_stage('report')
    tree.file('proof.json',raw,maximum=128*1024)
    need(report['complete'])


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BaseException:
        print(json.dumps({'kind':'sorng-macintel-owned-source-preflight','complete':False,
                          'stage':base.CURRENT_STAGE,'failure':'OWNED_INTEL_SOURCE_PROOF_DENIED','sourceWriteAdmitted':False}))
        raise SystemExit(1)
