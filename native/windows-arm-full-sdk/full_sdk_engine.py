"""Fixed parent-driven engine phases; importing never loads the Windows kernel.

Phase JSON describes held inputs and original ends, never an execution grant.
The private parent remains responsible for its actual source/fresh-Git brands.
"""
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

NATIVE_ENGINE_ADMITTED = True  # Reviewed fixed execution ATTEMPT; no native qualification claim.
EXPENSIVE_ENGINE_ADMITTED = True  # Original6h/3h slice and real checkpoint alternative required.
ROLES = ('probe-clang', 'probe-link', 'cef-engine', 'package', 'checkpoint-seal')
CAPS = {'probe-clang': 900, 'probe-link': 900, 'cef-engine': 10800, 'package': 2400, 'checkpoint-seal': 3600}
METADATA_MAXIMA = (65536, 65536, 1048576, 1048576, 4194304, 1048576, 8388608, 8388608, 131072)
SOURCES = {'20261103.298.1': 'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90',
           '20261021.278.1': 'fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa'}
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
_ACTIVE = {}
_BIRTHS = {}
FIELDS = {'schemaVersion', 'kind', 'mode', 'role', 'sourceContextSha256', 'image', 'sourceId',
          'target', 'wallWholeEnd', 'monotonicWholeEnd', 'wallPhaseEnd', 'monotonicPhaseEnd',
          'parentPid', 'parentCreationFiletime', 'metadataFiles', 'gitPolicyFiles', 'prior'}


def need(value, code):
    if not value:
        raise ValueError('FULL_SDK_ENGINE_' + code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def _json(raw):
    def pairs(rows):
        value = {}
        for key, item in rows:
            need(key not in value, 'JSON_DUPLICATE')
            value[key] = item
        return value
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: need(False, 'JSON_NUMBER'))


def _pin(value, maximum=2 * 1024**2, minimum=1):
    need(type(value) is dict and set(value) == {'bytes', 'sha256'} and
         type(value['bytes']) is int and minimum <= value['bytes'] <= maximum and
         type(value['sha256']) is str and re.fullmatch('[a-f0-9]{64}', value['sha256']), 'PIN')


def canonical_root_name(image, source_id):
    need(type(image) is str and image in SOURCES and source_id == SOURCES[image], 'SOURCE')
    raw = bytearray(hashlib.sha256(('sortOfRemoteNG/windows-arm-full-sdk/root/v1\0repositoryId=1010282954'
          '\0target=aarch64-pc-windows-msvc\0image=' + image + '\0sourceId=' + source_id).encode()).digest()[:16])
    raw[6], raw[8] = (raw[6] & 15) | 64, (raw[8] & 63) | 128
    text = raw.hex()
    return 'windows-arm-full-sdk-' + '-'.join((text[:8], text[8:12], text[12:16], text[16:20], text[20:]))


def validate_packet(value, role, source):
    need(type(source) is dict and source.get('kind') == 'windows-arm-full-sdk-context' and
         source.get('mode') == 'full-sdk-source-gn' and source.get('workflow') == '.github/workflows/windows-arm-full-sdk.yml' and
         source.get('ref') == 'refs/heads/main' and source.get('event') == 'workflow_dispatch' and
         source.get('visibility') == 'public' and source.get('repositoryId') == '1010282954' and
         source.get('head') == source.get('workflowSha') and
         type(source.get('head')) is str and re.fullmatch('[a-f0-9]{40}', source['head']), 'SOURCE_SCOPE')
    need(type(value) is dict and set(value) == FIELDS and role in ROLES and
         type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and value['kind'] == 'windows-arm-full-sdk-engine-context' and
         value['mode'] == 'full-sdk-engine' and value['role'] == role, 'CONTEXT')
    need(value['target'] == source['target'] == 'aarch64-pc-windows-msvc' and
         value['image'] == source['image'] and value['sourceId'] == source['sourceId'] == SOURCES.get(value['image']), 'SOURCE')
    need(type(value['sourceContextSha256']) is str and re.fullmatch('[a-f0-9]{64}', value['sourceContextSha256']), 'SOURCE_PIN')
    for key in ('wallWholeEnd', 'monotonicWholeEnd', 'wallPhaseEnd', 'monotonicPhaseEnd'):
        need(type(value[key]) in (int, float) and math.isfinite(value[key]), 'CLOCK')
    need(value['wallWholeEnd'] == source['wallWholeEnd'] and
         value['monotonicWholeEnd'] == source['monotonicWholeEnd'] and
         value['wallPhaseEnd'] <= value['wallWholeEnd'] - 150 and
         value['monotonicPhaseEnd'] <= value['monotonicWholeEnd'] - 150, 'ORIGINAL_ENDS')
    if role == 'cef-engine':
        need(value['wallPhaseEnd'] <= value['wallWholeEnd'] - 3600 and
             value['monotonicPhaseEnd'] <= value['monotonicWholeEnd'] - 3600, 'CEF_POSTCOMPILE_RESERVE')
    need(type(value['parentPid']) is int and 0 < value['parentPid'] <= 0xffffffff and
         type(value['parentCreationFiletime']) is str and re.fullmatch('[1-9][0-9]{0,19}', value['parentCreationFiletime']), 'PARENT')
    rows = source['sources']
    names = ('native/windows-arm-full-sdk/private-qualification-profile.json',
             'native/windows-arm-full-sdk/engine-qualification-profile.json')
    expected = ['source-inputs/' + str(next(i for i, row in enumerate(rows) if row['path'] == name)) for name in names]
    out = 'source-checkout/src/out/Release_GN_arm64/'
    expected += ['private-qualification-logs/' + name for name in
                 ('qual-gn-desc-pa.stdout.log', 'qual-gn-desc-cef.stdout.log', 'qual-gn-args.stdout.log')]
    expected += [out + 'args.gn', out + 'gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h',
                 out + 'gen/cef/include/cef_config.h', 'full-metadata-result.json']
    for key, paths in (('metadataFiles', expected), ('gitPolicyFiles',
        ['full-sdk-control/cef-source-git-policy/global.gitconfig', 'full-sdk-control/cef-source-git-policy/system.gitconfig'])):
        records = value[key]
        need(type(records) is list and len(records) == len(paths), 'RECORDS')
        need([row.get('relative') for row in records if type(row) is dict] == paths, 'RECORD_PATHS')
        for index, row in enumerate(records):
            need(set(row) == {'relative', 'bytes', 'sha256'}, 'RECORD_FIELDS')
            _pin({key: row[key] for key in ('bytes', 'sha256')},
                 METADATA_MAXIMA[index] if key == 'metadataFiles' else 65536,
                 0 if key == 'gitPolicyFiles' and index == 1 else 1)
            if key == 'gitPolicyFiles' and index == 1:
                need(row['bytes'] == 0 and row['sha256'] == digest(b''), 'GIT_SYSTEM_PIN')
    if role == ROLES[0]:
        need(value['prior'] is None, 'PRIOR')
    elif role == 'checkpoint-seal':
        need(type(value['prior']) is dict and set(value['prior']) == {'result', 'receipt', 'closure', 'launch'} and value['prior']['result'] is None, 'PRIOR')
        for key in ('receipt', 'closure', 'launch'):
            _pin(value['prior'][key])
    else:
        need(type(value['prior']) is dict and set(value['prior']) == {'result', 'receipt'}, 'PRIOR')
        for row in value['prior'].values():
            _pin(row)
    return value


class OriginalClock:
    def __init__(self, packet):
        self.ends = tuple(packet[key] for key in ('wallWholeEnd', 'monotonicWholeEnd', 'wallPhaseEnd', 'monotonicPhaseEnd'))
        self.failed, self.primary = False, None

    def remaining(self):
        if self.failed:
            raise self.primary
        try:
            whole = min(self.ends[0] - time.time(), self.ends[1] - time.monotonic())
            work = min(self.ends[2] - time.time(), self.ends[3] - time.monotonic(), whole - 150)
            need(0 < whole <= 21600 and 0 < work, 'DEADLINE')
            return work
        except BaseException as error:
            self.failed, self.primary = True, error
            raise


def _canonical_module():
    need(sys.modules.get('full_sdk_engine') is sys.modules.get(__name__) and
         Path(__file__).resolve() == HERE / 'full_sdk_engine.py', 'CANONICAL_MODULE')


def _fence(state):
    for path, identity in state['fence']:
        info = path.lstat()
        need(not path.is_symlink() and not (getattr(info, 'st_file_attributes', 0) & 0x400) and
             stat.S_ISDIR(info.st_mode) and (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode),
             getattr(info, 'st_birthtime_ns', None)) == identity, 'ROOT_CHANGED')


def _state(root=None, context=None, profile=None):
    _canonical_module()
    need(len(_ACTIVE) == 1, 'BRAND')
    state = next(iter(_ACTIVE.values()))
    if state['failed']:
        raise state['primary']
    need(not state['closed'] and state['pid'] == os.getpid() and _BIRTHS.get(state['birth']) is state, 'RETIRED')
    need((root is None or Path(root) == state['root']) and
         (context is None or context is state['context']) and
         (profile is None or profile is state['profile']), 'IDENTITY')
    need(digest(canonical(state['context'])) == state['semantic'] and
         digest(canonical(state['profile'])) == state['profileSemantic'], 'CONTEXT_CHANGED')
    state['clock'].remaining()
    need(not state['parent'].is_set(), 'PARENT_EXITED')
    _fence(state)
    return state


def _has_active_root(root):
    return bool(_ACTIVE) and Path(root) == next(iter(_ACTIVE.values()))['root']


def _has_active_profile(profile):
    return bool(_ACTIVE) and profile is next(iter(_ACTIVE.values()))['profile']


def _verified_active_sources(root, expected=None, bind=False):
    state = _state(root=root)
    need(type(bind) is bool and (expected is None or expected == state['sha']), 'CONTEXT_PIN')
    for file, pin in state['held']:
        state['data'].held(file, state['clock'], pin['bytes'], pin['sha256'], maximum=max(pin['bytes'], 1))
    _state(root=root)
    return state['context'], state['profile'], state['clock']


def _worker_policy(role, context):
    state = _state(context=context)
    need(role == state['context']['role'], 'ROLE')
    return {'processes': 64, 'memoryBytes': 8 * 1024**3, 'cpuRate': 2500}


def _worker_argv(state):
    return [state['node']['path'], '--disable-proto=throw', '--no-addons', str(HERE / 'full-sdk-engine-worker.mjs'),
            '--full-sdk-engine-worker', state['context']['role'], str(state['root']), state['sha'], '--execute']


def approve_engine_job_command(argv, cwd):
    state = _state(root=cwd)
    _verified_active_sources(cwd)
    need(Path.cwd() == state['root'] and argv == _worker_argv(state), 'ARGV')
    return state['context']['role']


def _load(root, sha, role):
    need(type(root) is str and Path(root).is_absolute() and Path(root).parent == REPO / '.artifacts' and
         re.fullmatch('windows-arm-full-sdk-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', Path(root).name), 'ENTRY_SCOPE')
    need(NATIVE_ENGINE_ADMITTED, 'NATIVE_CLOSED')
    need(role in ROLES and (role != 'cef-engine' or EXPENSIVE_ENGINE_ADMITTED), 'EXPENSIVE_ENGINE_CLOSED')
    need(os.name == 'nt' and not _ACTIVE and not _BIRTHS, 'ENTRY')
    need(sys.modules.get('full_sdk_engine') in (None, sys.modules[__name__]), 'MODULE_ALIAS')
    sys.modules['full_sdk_engine'] = sys.modules[__name__]
    sys.path.insert(0, str(HERE))
    import acquire as data
    import producer
    import job
    root = data.plain(root)
    need(root.parent == REPO / '.artifacts', 'ROOT')
    short = data.Clock(time.time() + 5, time.monotonic() + 5)
    packet_file = root / ('full-sdk-engine-' + role + '-context.json')
    _, raw = data.held(packet_file, short, sha256=sha, retain=True, maximum=131072)
    packet = _json(raw)
    _, source_raw = data.held(root / 'context.json', short, sha256=packet['sourceContextSha256'], retain=True, maximum=131072)
    source = _json(source_raw)
    validate_packet(packet, role, source)
    need(root.name == canonical_root_name(packet['image'], packet['sourceId']), 'CANONICAL_ROOT')
    clock = OriginalClock(packet)
    clock.remaining()
    need(packet['parentPid'] == os.getppid(), 'PARENT')
    _, policy_raw = data.held(REPO / 'native/windows-arm-full-sdk/sdk-origin-review.json', clock,
                             sha256=source['originPolicySha256'], retain=True, maximum=1024**2)
    policy = _json(policy_raw)
    need(policy['origin'] == 'owned-windows-arm64-full-sdk' and policy['target'] == packet['target'] and
         policy['workflow'] == '.github/workflows/windows-arm-full-sdk.yml' and source['sources'] == policy['producerInputs'], 'POLICY')
    held = [(packet_file, {'bytes': len(raw), 'sha256': sha}),
            (root / 'context.json', {'bytes': len(source_raw), 'sha256': packet['sourceContextSha256']}),
            (REPO / 'native/windows-arm-full-sdk/sdk-origin-review.json',
             {'bytes': len(policy_raw), 'sha256': source['originPolicySha256']})]
    workflow = REPO / '.github/workflows/windows-arm-full-sdk.yml'
    data.held(workflow, clock, policy['workflowPin']['bytes'], policy['workflowPin']['sha256'], maximum=2 * 1024**2)
    held.append((workflow, policy['workflowPin']))
    rows = policy['producerInputs']
    need(type(rows) is list and 1 <= len(rows) <= 128 and len({r['path'] for r in rows}) == len(rows), 'INPUTS')
    required = {'native/windows-arm-full-sdk/' + name for name in
                ('full_sdk_engine.py', 'full-sdk-engine-worker.mjs', 'full-sdk-source-profile.json', 'source-root.mjs', 'job.py', 'producer.py')}
    need(required <= {r['path'] for r in rows}, 'INPUTS')
    profile_raw = None
    for index, row in enumerate(rows):
        name = row['path']
        need(type(name) is str and re.fullmatch('[A-Za-z0-9_./-]+', name) and
             all(p not in ('', '.', '..') for p in name.split('/')), 'INPUT_PATH')
        for file in (REPO / name, root / 'source-inputs' / str(index)):
            _, retained = data.held(file, clock, row['bytes'], row['sha256'], retain=True, maximum=2 * 1024**2)
            if name == 'native/windows-arm-full-sdk/full-sdk-source-profile.json':
                profile_raw = retained
            held.append((file, row))
    need(profile_raw is not None, 'PROFILE')
    profile = _json(profile_raw)
    node = profile['node']
    data.held(node['path'], clock, node['bytes'], node['sha256'], maximum=node['bytes'])
    held.append((Path(node['path']), node))
    need(Path(sys.executable).resolve() == Path(profile['python']['path']).resolve(), 'PYTHON')
    data.held(profile['python']['path'], clock, profile['python']['bytes'], profile['python']['sha256'])
    held.append((Path(profile['python']['path']), profile['python']))
    for row in packet['metadataFiles'] + packet['gitPolicyFiles']:
        data.held(root / row['relative'], clock, row['bytes'], row['sha256'], maximum=max(row['bytes'], 1))
        held.append((root / row['relative'], row))
    fence = []
    for file in (root, *root.parents):
        info = file.lstat()
        fence.append((file, (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode), getattr(info, 'st_birthtime_ns', None))))
    parent = job.ParentCancel(threading.Event())
    state = None
    own = None
    try:
        need(parent.parent_creation == packet['parentCreationFiletime'], 'PARENT_CREATION')
        own = job.open_process(0x100000 | 0x1000, False, os.getpid())
        job.checked(own, 'engine-own-handle')
        creation = str(job.ParentCancel.creation(own))
        state = dict(root=root, context=packet, profile=profile, node=node, sha=sha, clock=clock, data=data,
                     held=held, fence=fence, parent=parent, pid=os.getpid(), birth=object(), closed=False,
                     failed=False, primary=None, semantic=digest(canonical(packet)),
                     profileSemantic=digest(canonical(profile)), own=own, creation=creation)
        _BIRTHS[state['birth']] = state
        _ACTIVE[str(root)] = state
        _verified_active_sources(root)
        return state
    except BaseException:
        if state is not None:
            _ACTIVE.clear()
            _BIRTHS.clear()
        # Preserve the original failure even if either owned-handle close fails.
        for close in (parent.close, lambda: job.checked(job.close(own), 'engine-load-close-own') if own else None):
            try:
                close()
            except BaseException:
                pass
        raise


# BEGIN FIXED CEF SUPERVISOR DEADLINE
class OriginalWholeClock:
    def __init__(self, packet):
        self.ends = (packet['wallWholeEnd'], packet['monotonicWholeEnd'])
        self.failed, self.primary = False, None

    def remaining(self):
        if self.failed:
            raise self.primary
        try:
            whole = min(self.ends[0] - time.time(), self.ends[1] - time.monotonic())
            need(150 < whole <= 21600, 'WHOLE_DEADLINE')
            return whole - 150
        except BaseException as error:
            self.failed, self.primary = True, error
            raise


def inspect_native_slice(result, seconds):
    need(type(seconds) is int and 0 < seconds <= 10800 and type(result) is dict and
         result.get('kind') == 'owned-job-proof' and result.get('outcome') == 'deadline' and result.get('success') is False and
         result.get('rootExit') is None and result.get('finalRootExit') == 124 and result.get('rootReaped') is True and
         type(result.get('activeAtEnd')) is int and result['activeAtEnd'] == 0 and result.get('cleanupVerified') is True and result.get('logReadersStopped') is True and
         result.get('cleanupBudgetMs') == 30000 and type(result.get('elapsedMs')) is int and result['elapsedMs'] >= seconds * 1000 and
         result.get('started') is True and result.get('jobCreated') is True and result.get('assignedBeforeResume') is True and
         result.get('resumed') is True and result.get('assignedAtCreationVerified') is True and result.get('assignmentMode') == 'creation-attribute' and
         result.get('handleListOnly') is True and result.get('jobHandleInheritable') is False and result.get('jobHandleInStdioAllowlist') is False and
         type(result.get('rootPid')) is int and result['rootPid'] > 0 and type(result.get('rootCreationFiletime')) is str and
         re.fullmatch('[1-9][0-9]{0,19}', result['rootCreationFiletime']) and
         ('observerStopped' not in result or result['observerStopped'] is True) and
         result.get('outputCapBytes') == 64 * 1024**2 and type(result.get('capturedBytes')) is int and
         0 <= result['capturedBytes'] <= result['outputCapBytes'], 'SLICE_NATIVE_DEADLINE')
    need(result.get('policyReadback') == dict(flags=8712, activeProcessLimit=64, jobMemoryBytes=str(8 * 1024**3),
         cpuFlags=5, cpuRate=2500, inheritedHandles=3, affinityChanged=False), 'SLICE_POLICY')
    return result


def _post_slice_sources(state):
    _canonical_module()
    need(_ACTIVE.get(str(state['root'])) is state and _BIRTHS.get(state['birth']) is state and
         state['pid'] == os.getpid() and not state['closed'] and not state['failed'] and
         state['context']['role'] == 'cef-engine' and state.get('directNativeResult') is state.get('nativeSliceResult'), 'SLICE_OWNER')
    inspect_native_slice(state['directNativeResult'], state['assignedSeconds'])
    need(digest(canonical(state['context'])) == state['semantic'] and
         digest(canonical(state['profile'])) == state['profileSemantic'] and not state['parent'].is_set(), 'SLICE_IDENTITY')
    clock = state['postSliceClock']
    clock.remaining()
    _fence(state)
    for file, pin in state['held']:
        state['data'].held(file, clock, pin['bytes'], pin['sha256'], maximum=max(pin['bytes'], 1))
    receipt = state['root'] / 'jobs' / 'cef-engine' / 'receipt.json'
    _, raw = state['data'].held(receipt, clock, retain=True, maximum=1048576)
    need(canonical(_json(raw)) == canonical(state['directNativeResult']), 'SLICE_ORIGINAL_RECEIPT')
    state['nativeReceiptPin'] = dict(bytes=len(raw), sha256=digest(raw))
    clock.remaining()
    _fence(state)
# END FIXED CEF SUPERVISOR DEADLINE


def _run(state):
    import job
    role, root = state['context']['role'], state['root']
    _verified_active_sources(root)
    launch = dict(kind='windows-arm-full-sdk-engine-launch', role=role, ownPid=state['pid'],
                  ownCreationFiletime=state['creation'], parentPid=state['context']['parentPid'],
                  parentCreationFiletime=state['context']['parentCreationFiletime'], contextSha256=state['sha'])
    with (root / ('full-sdk-engine-' + role + '-launch.json')).open('xb') as stream:
        stream.write(canonical(launch) + b'\n')
    _state(root=root)
    seconds = math.floor(min(CAPS[role], state['clock'].remaining()))
    need(seconds > 0, 'DEADLINE')
    state['assignedSeconds'] = seconds
    result = job.run_job(_worker_argv(state), str(root), root / 'jobs' / role, seconds,
                         cancel=state['parent'], cap=64 * 1024**2)
    state['directNativeResult'] = result
    if result.get('success') is True:
        _verified_active_sources(root)
        need(result.get('cleanupVerified') is True and result.get('activeAtEnd') == 0 and result.get('rootExit') == 0 and
             result.get('rootReaped') is True and result.get('logReadersStopped') is True, 'JOB_FAILED')
        return result
    need(role == 'cef-engine' and result.get('outcome') == 'deadline', 'JOB_FAILED')
    inspect_native_slice(result, seconds)
    state['nativeSliceResult'] = result
    state['postSliceClock'] = OriginalWholeClock(state['context'])
    _post_slice_sources(state)
    return result


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    need(type(argv) is list and len(argv) == 5 and all(type(value) is str for value in argv) and argv[0] == '--full-sdk-engine-launcher' and
         argv[1] in ROLES and re.fullmatch('[a-f0-9]{64}', argv[3]) and argv[4] == '--execute', 'ARGV')
    state = _load(argv[2], argv[3], argv[1])
    failed, primary = False, None
    try:
        actual_result = _run(state)
        completion = 'native-slice-ended' if state.get('nativeSliceResult') is actual_result else 'success'
    except BaseException as error:
        failed, primary = True, error
        state['failed'], state['primary'] = True, error
    finally:
        state['closed'] = True
        _ACTIVE.clear()
        _BIRTHS.clear()
        import job
        for close in (state['parent'].close, lambda: job.checked(job.close(state['own']), 'engine-close-own')):
            try:
                close()
            except BaseException as error:
                if not failed:
                    failed, primary = True, error
        if not failed:
            (state.get('postSliceClock') or state['clock']).remaining()
            _fence(state)
            report = dict(kind='windows-arm-full-sdk-engine-launcher-close', role=argv[1],
                          success=True, parentHandleClosed=True, ownHandleClosed=True,
                          ownPid=state['pid'], ownCreationFiletime=state['creation'],
                          parentPid=state['context']['parentPid'], parentCreationFiletime=state['context']['parentCreationFiletime'],
                          sourceContextSha256=state['context']['sourceContextSha256'],
                          sdkBuilt=False, nativeAcceptance=False, jobSeconds=state['assignedSeconds'])
            if argv[1] == 'cef-engine':
                report.update(completion=completion)
                if completion == 'native-slice-ended':
                    report['receiptPin'] = state['nativeReceiptPin']
            with (state['root'] / ('full-sdk-engine-closed-' + argv[1] + '.json')).open('xb') as stream:
                stream.write(canonical(report) + b'\n')
    if failed:
        raise primary
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
