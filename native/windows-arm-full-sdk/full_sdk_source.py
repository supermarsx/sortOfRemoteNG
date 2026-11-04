"""Fixed full-source qualification adapter; importing starts no process.

Reviewed attempt admission is separate from native qualification. Exact vectors,
code/policy pins, original clocks and the creation-owned native context are
required before any worker. No report or caller JSON issues a capability.
"""
import hashlib
import json
import math
import re
import sys
import time
import os
import copy
import threading
import stat
from pathlib import Path

MODE = 'full-sdk-source-gn'
WORKFLOW = '.github/workflows/windows-arm-full-sdk.yml'
POLICY = 'native/windows-arm-full-sdk/sdk-origin-review.json'
PROFILE_SHA256 = 'be314d35dfce51f97f6fb4ab47df04710c4deb4ec5e9544bbaf062996c808989'
FULL_SOURCE_ADMITTED = False
SOURCE_QUALIFICATION_ALLOWED = True
HEX = re.compile(r'[a-f0-9]{64}')
ROOT = re.compile(r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\.artifacts/windows-arm-full-sdk-'
                  r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}')
FALSE_FIELDS = ('executionAdmitted',
                'sourceProgramCarryforwardQualified',
                'fullArm64DefaultsQualified', 'engineCompilationAllowed',
                'sdkAllowed', 'nativeAcceptance', 'runtimeReady', 'publicationAllowed')


class Denied(ValueError):
    pass


def need(value, code):
    if not value:
        raise Denied('FULL_SDK_SOURCE_' + code)


def parse_profile(raw):
    """Inspect exact code-pinned interface bytes; this does not read a policy."""
    need(type(raw) is bytes and 0 < len(raw) <= 65536 and
         hashlib.sha256(raw).hexdigest() == PROFILE_SHA256, 'PROFILE_PIN')
    p = json.loads(raw)
    need(p['mode'] == MODE and p['workflow'] == WORKFLOW and p['policy'] == POLICY and
         p['ref'] == 'refs/heads/main' and p['sourceClosureStatus'] == 'closed-internal-source-body' and
         p['fullModeBodyImplemented'] is True and p['sourceSessionIssuerImplemented'] is True and
         p['sourceQualificationAllowed'] is True and
         all(p[key] is False for key in FALSE_FIELDS), 'PROFILE_CLOSED')
    return p


def inspect_context(context, raw_profile):
    """Exact identity projection only; no held source/root, lease or workflow proof."""
    p = parse_profile(raw_profile)
    keys = ('mode', 'workflow', 'policy', 'ref', 'repository', 'repositoryId',
            'event', 'visibility', 'defaultBranch', 'image', 'target',
            'sourceId', 'sourceProfileSha256', 'head', 'workflowSha',
            'runId', 'attempt', 'inputs')
    need(type(context) is dict and set(context) == set(keys), 'CONTEXT_FIELDS')
    for key in ('mode', 'workflow', 'policy', 'ref', 'repository', 'repositoryId',
                'event', 'visibility', 'defaultBranch', 'target'):
        need(type(context[key]) is str and context[key] == p[key], 'CONTEXT_SCOPE')
    need(type(context['image']) is str and context['image'] in p['images'], 'IMAGE')
    image = p['images'][context['image']]
    need(context['sourceId'] == image['sourceId'] and
         context['sourceProfileSha256'] == image['profileSha256'], 'SOURCE_TUPLE')
    need(type(context['head']) is str and re.fullmatch(r'[a-f0-9]{40}', context['head']) and
         context['workflowSha'] == context['head'], 'HEAD')
    need(all(type(context[key]) is str and re.fullmatch(r'[1-9][0-9]*', context[key])
             for key in ('runId', 'attempt')), 'RUN')
    need(type(context['inputs']) is dict and set(context['inputs']) == {'restore_run'} and
         type(context['inputs']['restore_run']) is str and re.fullmatch(r'0|[1-9][0-9]{0,19}', context['inputs']['restore_run']), 'INPUTS')
    return {'kind': 'inactive-full-sdk-source-context', 'executionAdmitted': False}


def command_projection(context, root, context_sha, raw_profile):
    """Fixed future vectors, never commands accepted by the current Job adapter."""
    inspect_context(context, raw_profile)
    p = parse_profile(raw_profile)
    need(type(root) is str and ROOT.fullmatch(root), 'ROOT')
    need(type(context_sha) is str and HEX.fullmatch(context_sha), 'CONTEXT_PIN')
    checkout = root.split('/.artifacts/', 1)[0]
    return {
        'role': p['role'],
        'launcher': [p['python']['path'], '-I', '-B', checkout + '/' + p['launcher'],
                     p['launcherFlag'], root, context_sha, '--execute'],
        'worker': [p['node']['path'], '--disable-proto=throw', '--no-addons',
                   checkout + '/' + p['driver'], p['driverFlag'], root, context_sha, '--execute'],
        'executionAdmitted': False,
    }


def phase_budget(wall_whole_end, mono_whole_end, wall_source_end,
                 mono_source_end, wall_now, mono_now):
    """Read-only projection of original ends. No new clock or runtime capability."""
    values = (wall_whole_end, mono_whole_end, wall_source_end,
              mono_source_end, wall_now, mono_now)
    need(all(type(value) in (int, float) and math.isfinite(value) for value in values), 'CLOCK')
    whole = min(wall_whole_end - wall_now, mono_whole_end - mono_now)
    source = min(wall_source_end - wall_now, mono_source_end - mono_now)
    need(150 < whole <= 21600 and 150 < source <= 10800 and
         wall_source_end <= wall_whole_end and mono_source_end <= mono_whole_end, 'DEADLINE')
    return {'workSeconds': min(whole, source) - 150, 'cleanupSeconds': 30,
            'finalReserveSeconds': 120, 'wallWholeEnd': wall_whole_end,
            'monotonicWholeEnd': mono_whole_end, 'wallSourceEnd': wall_source_end,
            'monotonicSourceEnd': mono_source_end, 'executionAdmitted': False}


def require_execution(*_args, **_kwargs):
    # Reviewed qualification ATTEMPT only. Actual native owner/context, code pins
    # and original clocks are still required before every fixed child/Job.
    need(SOURCE_QUALIFICATION_ALLOWED, 'QUALIFICATION_CLOSED')


# BEGIN CLOSED FULL SOURCE IMPLEMENTATION
# No test callback, deserializer or public registration function writes these.
_ACTIVE = {}
_BIRTHS = {}
_DATA_ROLES = ('sdk-data', 'llvm-data', 'rust-archive', 'gn-archive',
               'siso-archive', 'materialize', 'runtime-closure')
_OPERATION = 'full-source-operation'
_NODE = 'full-sdk-source-gn'
_ROLES = (_OPERATION, *_DATA_ROLES, _NODE)
_IDENTITY = ('mode', 'workflow', 'policy', 'ref', 'repository', 'repositoryId',
             'event', 'visibility', 'defaultBranch', 'image', 'target', 'sourceId',
             'sourceProfileSha256', 'head', 'workflowSha', 'runId', 'attempt', 'inputs')


def _semantic(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _root_key(root):
    return str(root).replace('\\', '/')


def _directory_identity(path):
    value = path.lstat()
    need(stat.S_ISDIR(value.st_mode) and not stat.S_ISLNK(value.st_mode) and
         not (getattr(value, 'st_file_attributes', 0) & 0x400), 'OWNED_DIRECTORY')
    # Owned child creation changes directory times/size/link count legitimately.
    return (value.st_dev, value.st_ino, stat.S_IFMT(value.st_mode),
            getattr(value, 'st_birthtime_ns', None))


def _capture_root_fence(root):
    paths = (root, *root.parents)
    need(root.is_absolute() and len(paths) <= 64 and len(str(root)) <= 4096, 'OWNED_ROOT_PATH')
    return tuple((path, _directory_identity(path)) for path in paths)


def _owned_root_fence(state):
    """Saved creation ledger only; valid during retirement, never reactivates it."""
    fence = state['rootFence']
    need(type(fence) is tuple and 0 < len(fence) <= 64 and
         fence[0][0] == state['root'] and _root_key(state['root']) == state['key'] and
         fence[0][1][:2] == state['rootId'], 'OWNED_ROOT_BINDING')
    for path, identity in reversed(fence):
        need(_directory_identity(path) == identity, 'OWNED_ROOT_CHANGED')
    need(os.path.normcase(str(state['root'].resolve(strict=True))) ==
         os.path.normcase(str(state['root'])), 'OWNED_ROOT_ALIAS')
    # Acceptance fences, not an atomic inode-CAS under external concurrent writers.


def _save_owned_report(state, name, value):
    names = {'full-source-operation-result.json', 'full-source-launcher-result.json',
             'full-source-closed-' + state['role'] + '.json'}
    need(name in names, 'REPORT_NAME')
    # Original clocks remain consumed even after registry retirement. Cleanup uses
    # the saved ledger and cannot mint a live transaction or refresh either end.
    live_success = name != 'full-source-closed-' + state['role'] + '.json' and value.get('success') is True
    if live_success:
        need(_state(root=state['root'], context=state['context'], profile=state['profile']) is state, 'REPORT_STATE')
    state['clock'].remaining()
    if live_success:
        need(_state(root=state['root'], context=state['context'], profile=state['profile']) is state, 'REPORT_STATE')
    _owned_root_fence(state)
    state['data'].save(state['root'] / name, value)
    _owned_root_fence(state)


def _live_mutation_fence(state):
    try:
        need(_state(root=state['root'], context=state['context'], profile=state['profile']) is state, 'LAUNCHER_STATE')
        _verified_active_sources(state['root'])
        need(_state(root=state['root'], context=state['context'], profile=state['profile']) is state, 'LAUNCHER_STATE')
        _owned_root_fence(state)
    except BaseException as error:
        _retire(state, error, True)
        raise


def _canonical_module():
    current = sys.modules.get(__name__)
    need(current is not None and sys.modules.get('full_sdk_source') is current, 'CANONICAL_MODULE')
    return current


def _retire(state, error=None, failed=False):
    # First failure, including an exception carrying a falsy payload, is retained.
    if failed and not state['failed']:
        state['failed'], state['primary'] = True, error
    state['closed'] = True
    state['epoch'] += 1
    if _ACTIVE.get(state['key']) is state:
        del _ACTIVE[state['key']]
    _BIRTHS.pop(state['birth'], None)


def _state(root=None, context=None, profile=None):
    _canonical_module()
    candidates = list(_ACTIVE.values())
    need(len(candidates) == 1, 'ACTIVE_SOURCE')
    state = candidates[0]
    if state['failed']:
        raise state['primary']
    try:
        need(not state['closed'] and _BIRTHS.get(state['birth']) is state['native'], 'SOURCE_RETIRED')
        need(root is None or _root_key(root) == state['key'], 'ACTIVE_ROOT')
        need(context is None or context is state['context'], 'CONTEXT_IDENTITY')
        need(profile is None or profile is state['profile'], 'PROFILE_IDENTITY')
        need(_semantic(state['context']) == state['contextSemantic'] and
             _semantic(state['profile']) == state['profileSemantic'], 'STATE_MUTATED')
        need(not state['native']['parent'].is_set(), 'PARENT_EXIT')
        state['clock'].remaining()
        need(_ACTIVE.get(state['key']) is state and not state['closed'] and
             _BIRTHS.get(state['birth']) is state['native'], 'SOURCE_RETIRED')
        return state
    except BaseException as error:
        _retire(state, error, True)
        raise


def _has_active_root(root):
    _canonical_module()
    return _root_key(root) in _ACTIVE


def _has_active_profile(profile):
    _canonical_module()
    return any(state['profile'] is profile for state in _ACTIVE.values())


class _OriginalClock:
    """Consumes original Python-epoch ends, never starts or refreshes a lease."""
    def __init__(self, context):
        self.ends = tuple(context[key] for key in
                          ('wallWholeEnd', 'monotonicWholeEnd', 'wallWorkEnd', 'monotonicWorkEnd'))
        self.wall_end = min(self.ends[0], self.ends[2])
        self.mono_end = min(self.ends[1], self.ends[3])
        self.wall, self.mono = time.time, time.monotonic
        self.failed = False
        self.primary = None
        self.remaining()

    def remaining(self):
        if self.failed:
            raise self.primary
        try:
            values = phase_budget(*self.ends, self.wall(), self.mono())
            return values['workSeconds'] + 150
        except BaseException as error:
            self.failed, self.primary = True, error
            raise


def _verified_active_sources(root, expected=None, bind=False):
    state = _state(root=root)
    try:
        need(expected is None or expected == state['contextSha'], 'CONTEXT_PIN')
        # bind cannot replace a context, a deadline, or the active source identity.
        need(type(bind) is bool, 'BIND')
        data = state['data']
        _owned_root_fence(state)
        _, raw = data.held(state['root'] / 'context.json', state['clock'],
                           sha256=state['contextSha'], maximum=131072, retain=True)
        need(raw == state['contextRaw'], 'CONTEXT_CHANGED')
        for name, pin in state['held']:
            data.held(name, state['clock'], pin['bytes'], pin['sha256'], maximum=2 * 1024**2)
        _state(root=root)
        _owned_root_fence(state)
        return state['context'], state['profile'], state['clock']
    except BaseException as error:
        _retire(state, error, True)
        raise


# BEGIN OWNED FULL SOURCE ENVIRONMENT
def _source_environment_retention_guard(root, context, profile, clock):
    state = _state(root=root, context=context, profile=profile)
    need(state['role'] == 'runtime-closure' and clock is state['clock'] and
         profile['sourceGn']['sourceId'] == context['sourceId'], 'ENVIRONMENT_OWNER')
    _live_mutation_fence(state)
    saved_fence = state['rootFence']
    saved = tuple((path, dict(pin)) for path, pin in state['held'])
    data = state['data']
    def guard():
        # This saved owner may restrict failure DATA retention after retirement;
        # it never reactivates a source map or issues an execution capability.
        try:
            need(state['context'] is context and state['profile'] is profile and
                 state['clock'] is clock and state['rootFence'] is saved_fence and
                 _semantic(context) == state['contextSemantic'] and
                 _semantic(profile) == state['profileSemantic'] and
                 not state['native']['parent'].is_set(), 'ENVIRONMENT_RETENTION_OWNER')
            clock.remaining()
            _owned_root_fence(state)
            _, raw = data.held(state['root'] / 'context.json', clock, sha256=state['contextSha'],
                               maximum=131072, retain=True)
            need(raw == state['contextRaw'], 'CONTEXT_CHANGED')
            for path, pin in saved:
                data.held(path, clock, pin['bytes'], pin['sha256'], maximum=2 * 1024**2)
            _owned_root_fence(state)
            clock.remaining()
        except BaseException as error:
            _retire(state, error, True)
            raise
    return guard


def _prepare_source_environment(root, context, profile, clock):
    state = _state(root=root, context=context, profile=profile)
    try:
        need(state['role'] == 'runtime-closure' and clock is state['clock'] and
             profile['sourceGn']['sourceId'] == context['sourceId'], 'ENVIRONMENT_OWNER')
        _live_mutation_fence(state)
        import environment
        need(Path(environment.__file__).resolve(strict=True) == state['here'] / 'environment.py', 'ENVIRONMENT_MODULE')
        data = state['data']
        environments = {cpu: environment.rows(root, profile, cpu) for cpu in environment.CPUS}
        for values in environments.values():
            for name in ('INCLUDE', 'LIB', 'LIBPATH', 'Path'):
                for directory in values[name].split(';'):
                    _state(root=root, context=context, profile=profile)
                    environment.safe_value(directory)
                    need(data.plain(directory).is_dir(), 'ENVIRONMENT_DIRECTORY')
        raw = environment.script(environments, profile['sdkVersion'])
        need(0 < len(raw) <= 256 * 1024, 'ENVIRONMENT_BOUND')
        directories = []

        def fence():
            _live_mutation_fence(state)
            need(clock is state['clock'], 'ENVIRONMENT_CLOCK')
            for directory, identity in directories:
                need(_directory_identity(directory) == identity, 'ENVIRONMENT_DIRECTORY_CHANGED')

        def create_directory(directory):
            data.plain(directory, exists=False)
            fence()
            directory.mkdir()
            directories.append((directory, _directory_identity(directory)))
            fence()

        def write_owned(destination, body):
            need(type(body) is bytes and 0 < len(body) <= 256 * 1024, 'ENVIRONMENT_BOUND')
            data.plain(destination, exists=False)
            fence()
            stream = destination.open('xb', buffering=0)
            failed = False
            def identity(value):
                # Windows named .bat stat adds execute bits that handle stat
                # does not. Preserve type plus every actual identity/time field.
                signature = data.signature(value)
                return signature[:5] + (stat.S_IFMT(value.st_mode),) + signature[6:]
            def creation_identity(value):
                need(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and
                     not (getattr(value, 'st_file_attributes', 0) & 0x400), 'ENVIRONMENT_FILE')
                return (value.st_dev, value.st_ino, stat.S_IFMT(value.st_mode), value.st_nlink,
                        getattr(value, 'st_birthtime_ns', None))
            try:
                before = os.fstat(stream.fileno())
                created = creation_identity(before)
                need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                     identity(before) == identity(destination.lstat()), 'ENVIRONMENT_FILE')
                fence()
                need(identity(before) == identity(destination.lstat()), 'ENVIRONMENT_FILE_CHANGED')
                need(stream.write(body) == len(body), 'ENVIRONMENT_WRITE')
                fence()
            except BaseException:
                failed = True
                raise
            finally:
                try:
                    stream.close()
                except BaseException:
                    if not failed:
                        raise
            fence()
            need(creation_identity(destination.lstat()) == created, 'ENVIRONMENT_FILE_REPLACED')
            pin, actual = data.held(destination, clock, len(body), hashlib.sha256(body).hexdigest(),
                                    retain=True, maximum=256 * 1024)
            need(actual == body, 'ENVIRONMENT_READBACK')
            need(creation_identity(destination.lstat()) == created and
                 (pin['identity'][0], pin['identity'][1], stat.S_IFREG, pin['identity'][4], pin['identity'][5]) == created,
                 'ENVIRONMENT_FILE_REPLACED')
            fence()
            return pin

        custom = state['root'] / 'custom-vs'
        create_directory(custom)
        create_directory(custom / 'VC')
        pin = write_owned(custom / 'VC/vcvarsall.bat', raw)
        result = {'environmentOrigin': 'owned-closed-custom-vcvars-adapter', 'registeredSdkClaim': False,
                  'adapter': pin, 'cpus': list(environment.CPUS), 'cefEnvironment': {
                      'WIN_CUSTOM_TOOLCHAIN': '1', 'DEPOT_TOOLS_WIN_TOOLCHAIN': '0', 'CEF_VCVARS': 'none',
                      'GYP_MSVS_OVERRIDE_PATH': str(custom), 'GYP_MSVS_VERSION': '2026',
                      'VS_CRT_ROOT': str(state['root'] / 'runtime/x64'),
                      'SDK_ROOT': str(state['root'] / 'Windows Kits/10'), 'SDK_VERSION': profile['sdkVersion']}}
        private = (json.dumps({'cpus': environments, **result}, indent=2) + '\n').encode('utf-8')
        write_owned(state['root'] / 'environment-private.json', private)
        fence()
        return result
    except BaseException as error:
        _retire(state, error, True)
        raise
# END OWNED FULL SOURCE ENVIRONMENT


def _role_in_mode(role, context):
    state = _state(context=context)
    try:
        need(role in _ROLES and state['context']['mode'] == MODE, 'ROLE')
    except BaseException as error:
        _retire(state, error, True)
        raise
    return role


def _worker_policy(role, context):
    _role_in_mode(role, context)
    large = role in (_OPERATION, _NODE)
    return {'processes': 64 if large else 8,
            'memoryBytes': 8 * 1024**3 if large else 512 * 1024**2, 'cpuRate': 2500}


def _worker_argv(role, root, profile):
    state = _state(root=root, profile=profile)
    _role_in_mode(role, state['context'])
    if role == _NODE:
        return [profile['sourceGn']['hostTools']['node']['path'], '--disable-proto=throw', '--no-addons',
                str(state['here'] / 'full-sdk-source-driver.mjs'), '--full-sdk-source-gn',
                str(state['root']), state['contextSha'], '--execute']
    return [profile['python']['path'], '-I', '-B', str(state['here'] / 'full_sdk_source.py'),
            '--full-sdk-source-worker', role, str(state['root']), state['contextSha'], '--execute']


def approve_source_job_command(argv, cwd, context=None):
    state = _state(root=cwd, context=context)
    try:
        _verified_active_sources(cwd)
        need(Path(cwd) == Path.cwd(), 'CWD')
        if type(argv) is list and len(argv) == 8 and argv[4] == '--full-sdk-source-gn':
            role = _NODE
        else:
            need(type(argv) is list and len(argv) == 9 and argv[4] == '--full-sdk-source-worker', 'ARGV')
            role = argv[5]
        need(argv == _worker_argv(role, cwd, state['profile']), 'COMMAND')
        _state(root=cwd)
        return role
    except BaseException as error:
        _retire(state, error, True)
        raise


def _source_execution_policy(profile):
    state = _state(profile=profile)
    policy = profile['sourceGn']['executionPolicy']
    need(set(policy) == {'hostLoaderClosureApproved', 'gitConfigurationApproved',
                         'sourceHookCommandClosureApproved'} and all(x is True for x in policy.values()), 'RECIPE_POLICY')
    need(state['context']['sourceId'] == profile['sourceGn']['sourceId'], 'RECIPE_SOURCE')
    return policy


def _host_closure(profile, clock, context):
    state = _state(context=context, profile=profile)
    need(clock is state['clock'], 'CLOCK_IDENTITY')
    return state['producer'].verify_source_host_closure(profile, clock, context['image'], reviewed_image=context['image'])


def _load_source_entry(root, context_sha, entry_role):
    # Reject foreign scope before any optional/native import or filesystem read.
    require_execution()
    need(type(root) is str and ROOT.fullmatch(root.replace('\\', '/')) and
         type(context_sha) is str and HEX.fullmatch(context_sha), 'ENTRY_SCOPE')
    need(os.name == 'nt' and entry_role in ('launcher', 'verify-setup', _OPERATION, *_DATA_ROLES), 'ENTRY')
    here = Path(__file__).resolve().parent
    need(sys.modules.get('full_sdk_source') in (None, sys.modules[__name__]), 'MODULE_ALIAS')
    sys.modules['full_sdk_source'] = sys.modules[__name__]
    sys.path.insert(0, str(here))
    import acquire as data
    import producer
    import job
    need(not _ACTIVE and not _BIRTHS, 'ENTRY_REUSE')
    root = data.plain(root)
    need(ROOT.fullmatch(_root_key(root)) and root.parent == here.parents[1] / '.artifacts', 'ROOT')
    root_fence = _capture_root_fence(root)
    # The first original bootstrap carrier is intentionally NOT implemented here.
    # Existing absolute Python-epoch ends are consumed, never replaced by now+6h.
    short = data.Clock(time.time() + 5, time.monotonic() + 5)
    _, raw = data.held(root / 'context.json', short, sha256=context_sha, retain=True, maximum=131072)
    c = json.loads(raw)
    _, profile_raw = data.held(here / 'full-sdk-source-profile.json', short, sha256=PROFILE_SHA256,
                               retain=True, maximum=65536)
    full = parse_profile(profile_raw)
    inspect_context({key: c[key] for key in _IDENTITY}, profile_raw)
    clock = _OriginalClock(c)
    # Absence is denial. These bytes restrict a live native entry; they never issue it.
    _, policy_raw = data.held(here.parents[1] / POLICY, clock, sha256=c['originPolicySha256'],
                              retain=True, maximum=1024**2)
    policy = json.loads(policy_raw)
    need(policy['kind'] == 'sorng-windows-arm64-sdk-origin-policy' and
         policy['origin'] == 'owned-windows-arm64-full-sdk' and policy['target'] == full['target'] and
         policy['workflow'] == WORKFLOW and 0 < len(policy['producerInputs']) <= 128, 'ORIGIN_POLICY')
    workflow = here.parents[1] / WORKFLOW
    data.held(workflow, clock, policy['workflowPin']['bytes'], policy['workflowPin']['sha256'], maximum=2 * 1024**2)
    rows = policy['producerInputs']
    need(c['sources'] == rows and len({row['path'] for row in rows}) == len(rows), 'CLOSURE')
    need(set(full['requiredProducerPaths']).issubset({row['path'] for row in rows}), 'REQUIRED_CLOSURE')
    held = [(here / 'full-sdk-source-profile.json', {'bytes': len(profile_raw), 'sha256': PROFILE_SHA256}),
            (here.parents[1] / POLICY, {'bytes': len(policy_raw), 'sha256': c['originPolicySha256']}),
            (workflow, policy['workflowPin'])]
    for index, row in enumerate(rows):
        name = row['path']
        need(type(name) is str and not name.startswith(('/', '\\')) and
             all(part not in ('', '.', '..') for part in name.replace('\\', '/').split('/')), 'INPUT_PATH')
        live = here.parents[1] / name
        saved = root / 'source-inputs' / str(index)
        _, a = data.held(live, clock, row['bytes'], row['sha256'], retain=True, maximum=2 * 1024**2)
        _, b = data.held(saved, clock, row['bytes'], row['sha256'], retain=True, maximum=2 * 1024**2)
        need(a == b, 'INPUT_CHANGED')
        held.extend(((live, row), (saved, row)))
    selected = full['images'][c['image']]
    base = json.loads(data.held(here / 'profile.json', clock, sha256=full['baseProfileSha256'], retain=True, maximum=65536)[1])
    recipe = json.loads(data.held(here / selected['profile'], clock, sha256=selected['profileSha256'], retain=True, maximum=131072)[1])
    need(recipe['image'] == c['image'] and recipe['sourceGn']['sourceId'] == c['sourceId'] and
         recipe['sourceGn']['limits']['wholeSeconds'] == 7200 and
         recipe['sourceGn']['limits']['acquisitionSeconds'] == 4500 and
         recipe['sourceGn']['limits']['hooksSeconds'] == 1800, 'SOURCE_RECIPE')
    p = copy.deepcopy(base)
    p.update(image=c['image'], sourceGn=copy.deepcopy(recipe['sourceGn']), sourcePaths=[row['path'] for row in rows])
    for pin in [*p['sourceData'], *p['sourceGn']['sourceData'], *p['sourceGn']['helpers']]:
        data.held(here.parents[1] / pin['path'], clock, pin['bytes'], pin['sha256'], maximum=2 * 1024**2)
        held.append((here.parents[1] / pin['path'], pin))
    data.held(p['python']['path'], clock, p['python']['bytes'], p['python']['sha256'])
    need(Path(sys.executable).resolve() == Path(p['python']['path']).resolve(), 'PYTHON')
    parent = job.ParentCancel(threading.Event())
    own = None
    birth = object()
    state = None
    try:
        own = job.open_process(0x100000 | 0x1000, False, os.getpid())
        job.checked(own, 'full-source-own-handle')
        native = {'parent': parent, 'own': own, 'pid': os.getpid(),
                  'creationFiletime': str(job.ParentCancel.creation(own)),
                  'parentCreationFiletime': parent.parent_creation}
        _BIRTHS[birth] = native
        state = dict(key=_root_key(root), root=root, rootId=root_fence[0][1][:2], rootFence=root_fence,
                     here=here, birth=birth, native=native, context=c, profile=p, clock=clock,
                     contextSha=context_sha, contextRaw=raw, contextSemantic=_semantic(c),
                     profileSemantic=_semantic(p), held=held, data=data, producer=producer,
                     role=entry_role, failed=False, primary=None, closed=False, epoch=0)
        _ACTIVE[state['key']] = state
        _verified_active_sources(root)
        return state
    except BaseException as error:
        if state is not None:
            _retire(state, error, True)
        else:
            _BIRTHS.pop(birth, None)
        # Cleanup uncertainty cannot turn a failed entry into a success, and
        # neither close may replace the original validation/creation failure.
        for close in ((lambda: job.checked(job.close(own), 'full-source-close-own')) if own else lambda: None,
                      parent.close):
            try:
                close()
            except BaseException:
                pass
        raise


def _close_source_entry(state):
    # Revoke before close, retaining the immutable creation ledger for cleanup.
    _retire(state)
    import job
    primary = state['primary'] if state['failed'] else None
    failed = state['failed']
    for close in (state['native']['parent'].close,
                  lambda: job.checked(job.close(state['native']['own']), 'full-source-close-own')):
        try:
            close()
        except BaseException as error:
            if not failed:
                failed, primary = True, error
        try:
            _owned_root_fence(state)
        except BaseException as error:
            if not failed:
                failed, primary = True, error
    if not failed:
        try:
            _save_owned_report(state, 'full-source-closed-' + state['role'] + '.json',
                               dict(success=True, parentHandleClosed=True, ownHandleClosed=True,
                                    ownPid=state['native']['pid'], ownCreationFiletime=state['native']['creationFiletime'],
                                    parentCreationFiletime=state['native']['parentCreationFiletime'], sdkBuilt=False))
        except BaseException as error:
            failed, primary = True, error
    state['cleanupConfirmed'] = not failed
    if failed:
        _retire(state, primary, True)
        raise primary


def _run_operation(state):
    """Full-mode derivative of the fixed acquisition loop; no old mode relabel."""
    import job
    producer = state['producer']
    root, c, p, clock = state['root'], state['context'], state['profile'], state['clock']
    result = dict(kind='windows-arm-full-source-operation', success=False, jobs=[],
                  sourceGnVerified=False, sdkBuilt=False, buildAdmission=False)
    phase_end = min(clock.mono_end, c['monotonicAcquisitionEnd'])
    wall_phase_end = min(clock.wall_end, c['wallAcquisitionEnd'])
    failed = False
    try:
        _source_execution_policy(p)
        producer.source_capacity(root, p, clock)
        _host_closure(p, clock, c)
        for role in (*_DATA_ROLES, _NODE):
            _verified_active_sources(root)
            # All acquisition roles consume the same original7200s endpoint. The
            # Node body debits data time and retains the fixed3600s hook cap.
            remaining = min(clock.remaining(), phase_end - time.monotonic(), wall_phase_end - time.time()) if role != _NODE else clock.remaining()
            allotted = {'sdk-data': 1170, 'llvm-data': 300, 'rust-archive': 1200,
                         'gn-archive': 180, 'siso-archive': 180, 'materialize': 600,
                         'runtime-closure': 720}.get(role, 10800)
            seconds = min(allotted, remaining - 150)
            need(seconds > 0, 'PHASE_DEADLINE')
            receipt = job.run_job(_worker_argv(role, root, p), str(root), root / 'jobs' / role,
                                  seconds, cancel=state['native']['parent'],
                                  cap=p['sourceGn']['limits']['outputBytes'] if role == _NODE else 131072)
            result['jobs'].append(dict(role=role, originalJob=receipt))
            need(receipt.get('success') is True and receipt.get('cleanupVerified') is True and
                 receipt.get('rootExit') == 0 and receipt.get('activeAtEnd') == 0, 'JOB_FAILED')
        raw = state['data'].held(root / 'full-source-gn-result.json', clock, retain=True, maximum=131072)[1]
        source = producer.validate_source_gn_result(json.loads(raw), p)
        need(source['success'] is True, 'SOURCE_RESULT')
        _verified_active_sources(root)
        result['sourceGnVerified'], result['success'] = True, True
    except BaseException as error:
        failed = True
        _retire(state, error, True)
        raise
    finally:
        try:
            _save_owned_report(state, 'full-source-operation-result.json', result)
        except BaseException:
            if not failed:
                raise
    return 0


def _run_source_launcher(state):
    import job
    root, p = state['root'], state['profile']
    _live_mutation_fence(state)
    (root / 'jobs').mkdir()
    _owned_root_fence(state)
    seconds = state['clock'].remaining() - 150
    need(seconds > 0, 'SOURCE_DEADLINE')
    result = job.run_job(_worker_argv(_OPERATION, root, p), str(root), root / 'jobs' / _OPERATION,
                         seconds, cancel=state['native']['parent'], cap=131072)
    need(result.get('success') is True and result.get('cleanupVerified') is True and
         result.get('rootExit') == 0 and result.get('activeAtEnd') == 0, 'OPERATION_JOB_FAILED')
    _verified_active_sources(root)
    _save_owned_report(state, 'full-source-launcher-result.json',
                       dict(success=True, originalOperationJob=result, sdkBuilt=False,
                            ownPid=state['native']['pid'], ownCreationFiletime=state['native']['creationFiletime'],
                            parentCreationFiletime=state['native']['parentCreationFiletime']))
    return 0


def _run_fixed_entry(argv):
    # The public entry accepts only these fixed full-mode vectors.
    require_execution()
    need(type(argv) is list and len(argv) in (4, 5) and all(type(value) is str for value in argv) and argv[-1] == '--execute', 'ENTRY_ARGV')
    if len(argv) == 4:
        need(argv[0] in ('--full-sdk-source-launcher', '--full-sdk-verify-source-setup'), 'ENTRY_FLAG')
        role = 'launcher' if argv[0] == '--full-sdk-source-launcher' else 'verify-setup'
        root, context_sha = argv[1], argv[2]
    else:
        need(argv[0] == '--full-sdk-source-worker' and argv[1] in (_OPERATION, *_DATA_ROLES), 'ENTRY_FLAG')
        role, root, context_sha = argv[1:4]
    state = _load_source_entry(root, context_sha, role)
    try:
        if role == 'launcher':
            return _run_source_launcher(state)
        if role == _OPERATION:
            return _run_operation(state)
        if role == 'verify-setup':
            return state['producer'].verify_source_setup(state['root'], state['context'], state['profile'], state['clock'])
        return state['producer'].data_worker(role, state['root'], state['context'], state['profile'], state['clock'])
    except BaseException as error:
        _retire(state, error, True)
        raise
    finally:
        _close_source_entry(state)
# END CLOSED FULL SOURCE IMPLEMENTATION


def main(argv=None):
    require_execution()
    return _run_fixed_entry(sys.argv[1:] if argv is None else argv)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        code = str(error)
        print(code if re.fullmatch(r'FULL_SDK_SOURCE_[A-Z_]{1,80}', code) else 'FULL_SDK_SOURCE_FAILED', file=sys.stderr)
        raise SystemExit(1)
