"""Fixed bootstrap data workers. No GN, Rust, compiler or acquired binary execution."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquire as data
import checkpoint

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PROFILE_SHA = "5142ffe3fc4a3c84b84788318dc0591887d4603d1c4aca38716752dc8de87285"
CONTEXT_SHA = None
COMMAND_INVENTORY_REPORTING_FAILURE = False
ROLES = ("sdk-data", "llvm-data", "rust-archive", "gn-archive", "siso-archive", "materialize", "runtime-closure")
CARRIER_REF = "refs/heads/codex/windows-arm-full-sdk-source-20261026"
SOURCE_GN_REF = "refs/heads/codex/windows-arm-source-gn-20261026"
SOURCE_GN_NAMESPACE = "native/cef-build-inputs/20261026-r5-capsule23-windows-arm64-cross-x64-external-webview/"
COMMAND_CANDIDATES = [
    {'role':'node','path':'C:/hostedtoolcache/windows/node/24.19.0/x64/node.exe','kind':'pe'},
    {'role':'git-command','path':'C:/Program Files/Git/cmd/git.exe','kind':'pe'},
    *({'role':flavor+'-'+name.removesuffix('.exe').removesuffix('.dll'),
       'path':'C:/Program Files/Git/'+flavor+'/'+relative,'kind':'pe'}
      for flavor in ('ucrt64','mingw64')
      for name,relative in [
          ('git.exe','bin/git.exe'),('git-remote-https.exe','libexec/git-core/git-remote-https.exe'),
          *[(dll,'bin/'+dll) for dll in ('libcurl-4.dll','libcrypto-3-x64.dll','libssl-3-x64.dll',
              'libintl-8.dll','libiconv-2.dll','libpcre2-8-0.dll','zlib1.dll')]]),
    {'role':'git-system-config','path':'C:/Program Files/Git/etc/gitconfig','kind':'config'},
]


def source_mode(c):
    data.need(c.get('mode') in ('input-closure', 'command-inventory', 'source-gn'), 'FULL_MODE')
    return c['mode'] == 'source-gn'


def source_host_tools(p):
    # Missing reviewed pins deny BEFORE data acquisition. Observed bytes may
    # verify a reviewed pin, but can never create the expected identity.
    tools = p['sourceGn']['hostTools']
    data.need(type(tools) is dict and set(tools) == {'node', 'git'}, 'FULL_HOST_TOOLS')
    for role in ('node', 'git'):
        pin = tools[role]
        data.need(type(pin) is dict and set(pin) == {'path', 'bytes', 'sha256', 'nlink'}, 'FULL_HOST_TOOL_PIN_MISSING')
        data.need(type(pin['path']) is str and re.fullmatch(r'C:/[A-Za-z0-9 ./_-]+/(?:node|git)\.exe', pin['path']) and
                  not any(x in ('.', '..') for x in pin['path'].split('/')) and
                  type(pin['bytes']) is int and 0 < pin['bytes'] <= 256 * 1024**2 and
                  type(pin['nlink']) is int and 1 <= pin['nlink'] <= 8 and
                  re.fullmatch('[a-f0-9]{64}', pin['sha256']), 'FULL_HOST_TOOL_PIN')
        data.need(pin['path'].endswith('/' + role + '.exe'), 'FULL_HOST_TOOL_ROLE')
    return tools


def source_execution_policy(p):
    policy = p['sourceGn']['executionPolicy']
    data.need(type(policy) is dict and set(policy) == {'hostLoaderClosureApproved',
              'gitConfigurationApproved','sourceHookCommandClosureApproved'} and
              all(value is True for value in policy.values()), 'FULL_EXECUTION_POLICY_UNAVAILABLE')
    data.need(p['phaseAdmission'].get('source-gn') is True, 'FULL_SOURCE_ADMISSION_UNAVAILABLE')


def source_capacity(root, p, clock, *, memory=None, disk=shutil.disk_usage, cpus=os.cpu_count,
                    leaf='source-capacity-result.json', enforce=True):
    data.need(leaf in ('source-capacity-result.json', 'source-capacity-supervisor-result.json',
                      'source-capacity-pre-source-result.json'), 'FULL_CAPACITY_LEAF')
    clock.remaining()
    if memory is None:
        data.need(os.name == 'nt', 'FULL_CAPACITY_PLATFORM')
        import ctypes
        from ctypes import wintypes
        class MemoryStatus(ctypes.Structure):
            _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD)] + [
                (name, ctypes.c_ulonglong) for name in ('totalPhysical', 'availablePhysical',
                'totalPageFile', 'availablePageFile', 'totalVirtual', 'availableVirtual', 'extendedVirtual')]
        value = MemoryStatus();value.length = ctypes.sizeof(value)
        query = ctypes.WinDLL('kernel32', use_last_error=True).GlobalMemoryStatusEx
        query.argtypes = [ctypes.POINTER(MemoryStatus)];query.restype = wintypes.BOOL
        data.need(bool(query(ctypes.byref(value))), 'FULL_CAPACITY_UNAVAILABLE')
        memory = lambda: (value.totalPhysical, value.availablePhysical)
    total, available = memory();free = disk(root).free;cpu = cpus()
    data.need(all(type(x) is int and x > 0 for x in (total, available, free, cpu)) and
              available <= total, 'FULL_CAPACITY_FIELDS')
    limits = p['sourceGn']['limits']
    observed = {'totalPhysicalBytes': total, 'availablePhysicalBytes': available,
                'freeBytes': free, 'logicalCpuCount': cpu, 'sourceGnOnly': True,
                'compilerCapacityProven': False}
    data.save(root / leaf, observed)
    data.need(type(enforce) is bool, 'FULL_CAPACITY_POLICY')
    if enforce:
        data.need(available >= limits['availableRamBytes'] and free >= limits['freeBytes'] and
                  cpu >= 4, 'FULL_CAPACITY_SHORTFALL')
    clock.remaining()
    return observed


def command_inventory(root, c, p, clock, *, memory=None, disk=shutil.disk_usage, cpus=os.cpu_count):
    global COMMAND_INVENTORY_REPORTING_FAILURE
    import extract
    data.need(c['mode'] == 'command-inventory', 'FULL_INVENTORY_MODE')
    local = data.Clock(min(clock.wall_end, time.time() + 120), min(clock.mono_end, time.monotonic() + 120))
    capacity = source_capacity(root, p, local, memory=memory, disk=disk, cpus=cpus, enforce=False)
    candidates = p['commandInventory']['candidates']
    data.need(candidates == COMMAND_CANDIDATES, 'FULL_INVENTORY_CANDIDATES')
    rows = [];total = 0
    def consumed(count):
        nonlocal total, charged
        data.need(type(count)is int and charged <= count <= admitted, 'FULL_INVENTORY_BYTES')
        total += count-charged;charged=count
        data.need(total <= 512*1024**2, 'FULL_INVENTORY_BYTES')
    for candidate in candidates:
        row = {'role':candidate['role'], 'publicCandidatePath':candidate['path'],
               'expectedIdentity':None, 'executionAdmitted':False, 'imageLoaded':False}
        try:
            file = Path(candidate['path']);before = file.lstat();file = data.plain(file)
            charged=0;admitted=before.st_size
            data.need(type(admitted)is int and 0 <= admitted <= 512*1024**2-total,
                      'FULL_INVENTORY_BYTES')
            observed, raw = extract.held(file, local, retain=True,
                maximum=min(512*1024**2-total,65536 if candidate['kind']=='config' else 256*1024**2),
                expected_size=admitted,expected_nlink=before.st_nlink,progress=consumed,bounded_reads=True)
            data.need(observed['bytes']==charged,'FULL_INVENTORY_BYTES')
            row.update(status='observed', bytes=observed['bytes'], sha256=observed['sha256'],
                       nlink=before.st_nlink)
            if candidate['kind'] == 'pe':
                pe = extract.pe_metadata(raw)
                row.update(machine=pe['machine'], machineKind=pe['machineKind'],
                           version=pe['version'], versionStatus=pe['versionStatus'],
                           imports=pe['imports'], delayImports=pe['delayImports'])
            else:
                text = raw.decode('utf-8','strict')
                data.need('\0' not in text and all(len(line)<=4096 for line in text.splitlines()),'FULL_GIT_CONFIG_BOUND')
                row['configurationFacts'] = {'systemConfigObserved':True,
                    'hasInclude':bool(re.search(r'^\s*\[include(?:If)?(?:\s|\])',text,re.M|re.I)),
                    'hasCredentialSection':bool(re.search(r'^\s*\[credential(?:\s|\])',text,re.M|re.I)),
                    'hasFilterSection':bool(re.search(r'^\s*\[filter(?:\s|\])',text,re.M|re.I)),
                    'hasUrlSection':bool(re.search(r'^\s*\[url(?:\s|\])',text,re.M|re.I)),
                    'effectiveConfigurationNotProven':True}
        except FileNotFoundError:
            row['status'] = 'missing'
        except data.Denied as error:
            if failure(error)=='FULL_INVENTORY_BYTES':
                try:
                    data.save(root/'command-inventory-observation.json',{'kind':'windows-arm-source-command-inventory',
                        'success':False,'complete':False,'firstFailure':'FULL_INVENTORY_BYTES',
                        'rows':rows,'observedBytes':total,'executed':False,'executionAdmitted':False})
                except BaseException:
                    COMMAND_INVENTORY_REPORTING_FAILURE=True
                raise
            row.update(status='denied', reason=failure(error))
        rows.append(row);local.remaining()
    result = {'kind':'windows-arm-source-command-inventory','success':True,'complete':True,
              'image':c['image'],'head':c['head'],'repositoryId':c['repositoryId'],
              'runner':p['runner'],'sourceDigest':c['sourceDigest'],'profileSha256':PROFILE_SHA,
              'capacity':capacity,'rows':rows,'observedBytes':total,'executed':False,
              'sourceFetched':False,'gnExecuted':False,'expectedPinsCreated':False,'executionAdmitted':False}
    data.need(len(json.dumps(result,ensure_ascii=True).encode('ascii')) <= p['limits']['summaryBytes'],
              'FULL_INVENTORY_REPORT_BOUND')
    data.save(root/'command-inventory-observation.json',result)
    return result


def verify_source_setup(root, c, p, clock):
    data.need(source_mode(c), 'FULL_SETUP_MODE')
    sys.addaudithook(no_execution)
    import environment
    rows = []
    for cpu in ('x86', 'x64', 'arm64'):
        _, raw = data.held(root/'source-gn-logs'/('setup-'+cpu+'.stdout.log'),clock,
                           retain=True,maximum=4*1024**2)
        rows.append(environment.verify_setup(raw.decode('utf-8','strict'),root,p,cpu))
    result = {'kind':'windows-arm-source-setup-verification','success':True,
              'cpus':rows,'sourceId':p['sourceGn']['sourceId'],'executed':False}
    data.save(root/'source-setup-verification-result.json',result)
    return 0


def validate_source_gn_result(value,p):
    data.need(type(value) is dict and set(value)=={'kind','success','stage','firstFailure','target',
        'sourceId','graph','generatedArguments','compilerExecuted','engineCompilationRequested',
        'engineCheckpointImplemented','sdkBuilt','nativeAcceptance','sourceCloseFailure','gitPolicy',
        'outerJobCleanupNotInferred'},'FULL_SOURCE_RESULT')
    data.need(value['kind']=='windows-arm-source-gn' and value['success'] is True and
              value['stage']=='graph-inventory' and value['firstFailure'] is None and
              value['target']==p['target'] and value['sourceId']==p['sourceGn']['sourceId'] and
              value['compilerExecuted'] is None and value['engineCompilationRequested'] is False and
              all(value[key] is False for key in ('engineCheckpointImplemented','sdkBuilt','nativeAcceptance','sourceCloseFailure'))and
              value['outerJobCleanupNotInferred'] is True,'FULL_SOURCE_RESULT')
    graph=value['graph']
    data.need(type(graph)is dict and set(graph)=={'files','bytes','visited','sha256'}and
              type(graph['files'])is int and 0<graph['files']<=50000 and
              type(graph['bytes'])is int and 0<=graph['bytes']<=8*1024**3 and
              type(graph['visited'])is int and graph['files']<=graph['visited']<=300000 and
              type(graph['sha256'])is str and re.fullmatch('[a-f0-9]{64}',graph['sha256']),'FULL_SOURCE_GRAPH')
    expected={'targetCpu':'arm64','hostCpu':'x64','criticalArgumentsVerified':True,
        'instanceTracer':False,'remoteExecution':False,'generatedSecurityHeadersVerified':False,'compilerAdmission':False}
    actual=value['generatedArguments']
    data.need(type(actual)is dict and set(actual)==set(expected) and all(
        actual[key] is target if type(target)is bool else type(actual[key])is str and actual[key]==target
        for key,target in expected.items()),'FULL_SOURCE_GN_ARGUMENTS')
    policy=value['gitPolicy']
    data.need(type(policy)is dict and set(policy)=={'kind','ownedConfigFiles','verificationFailed',
        'callerGitConfigAccepted','installedConfigurationWritten'}and policy['kind']=='owned-source-git-isolation-v1'and
        all(policy[key]is False for key in ('verificationFailed','callerGitConfigAccepted','installedConfigurationWritten'))and
        type(policy['ownedConfigFiles'])is list and len(policy['ownedConfigFiles'])==2,'FULL_SOURCE_GIT_POLICY')
    for index,row in enumerate(policy['ownedConfigFiles']):
        data.need(type(row)is dict and set(row)=={'sha256','bytes'}and type(row['sha256'])is str and
                  re.fullmatch('[a-f0-9]{64}',row['sha256']) and type(row['bytes'])is int and
                  (0<row['bytes']<=4096 if index==0 else row['bytes']==0),'FULL_SOURCE_GIT_POLICY')
        if index==1:data.need(row['sha256']==hashlib.sha256(b'').hexdigest(),'FULL_SOURCE_GIT_POLICY')
    return value


def worker_policy(role, c):
    # A larger child cannot escape a smaller parent Job: source-gn operation
    # and its one Node driver share the explicit source policy. Data children
    # and every input-only operation retain the original exact policy.
    role_in_mode(role,c)
    large = source_mode(c) and role in ('operation', 'source-gn')
    return {'processes': 64 if large else 8,
            'memoryBytes': (8 * 1024**3) if large else (512 * 1024**2), 'cpuRate': 2500}


def role_in_mode(role,c):
    source_mode(c)
    allowed = ('operation','command-inventory') if c['mode']=='command-inventory' else (
        *ROLES,'operation',*(('source-gn',)if c['mode']=='source-gn'else()))
    data.need(role in allowed,'FULL_ROLE_MODE')
    return role


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def profile(clock):
    _, raw = data.held(HERE / "profile.json", clock, sha256=PROFILE_SHA, retain=True, maximum=65536)
    p = json.loads(raw)
    data.need(p["kind"] == "sorng-windows-arm-full-sdk-source" and
              p["modes"] == ["input-closure", "command-inventory", "source-gn"] and p["buildAdmission"] is False and
              p["sdkVersion"] == "10.0.28000.0" and p["programs"] == list(ROLES), "BOOT_PROFILE")
    return p


def bootstrap_authority(c, p):
    data.need(c["kind"] == "windows-arm-full-sdk-context" and
              c["mode"] in ("input-closure", "command-inventory", "source-gn") and c["repository"] == "supermarsx/sortOfRemoteNG" and
              c["repositoryId"] == "1010282954" and c["visibility"] == "public" and
              c["event"] == "workflow_dispatch" and c["defaultBranch"] == "main" and
              c["ref"] == (CARRIER_REF if c["mode"] == "input-closure" else SOURCE_GN_REF) and
              ((c['mode'] == 'input-closure' and (c['inputs'] is None or type(c['inputs']) is dict and not c['inputs'])) or
               (c['mode'] != 'input-closure' and c['inputs'] == {'mode':c['mode']})) and
              c["workflow"] == p["sourcePaths"][0] and
              c["workflow"] == ".github/workflows/windows-x64-arm-toolchain.yml" and
              c["workflowSha"] == c["head"] and re.fullmatch("[a-f0-9]{40}", c["head"]) and
              c["image"] == p["image"] and re.fullmatch("[1-9][0-9]*", c["runId"]) and
              re.fullmatch("[1-9][0-9]*", c["attempt"]), "BOOT_AUTHORITY")


def verified_sources(root, expected=None, bind=False):
    global CONTEXT_SHA
    root = data.plain(root)
    data.need(root.parent == ROOT / ".artifacts" and
              re.fullmatch("windows-arm-full-sdk-[a-f0-9-]{36}", root.name), "BOOT_ROOT")
    short = data.Clock(time.time() + 5, time.monotonic() + 5)
    _, raw = data.held(root / "context.json", short, retain=True, maximum=131072)
    data.need(digest(raw) == (expected if expected is not None else CONTEXT_SHA), "BOOT_CONTEXT_PIN")
    c = json.loads(raw)
    checkpoint.remaining_deadlines(c, time.time(), time.monotonic())
    clock = data.Clock(c["wallWorkEnd"], c["monotonicWorkEnd"])
    p = profile(clock)
    bootstrap_authority(c, p)
    data.need(checkpoint.closed_sources(c["sources"], p["sourcePaths"]) == c["sourceDigest"], "BOOT_SOURCE_DIGEST")
    for i, row in enumerate(c["sources"]):
        _, snapshot = data.held(root / "source-inputs" / str(i), clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
        _, live = data.held(ROOT / row["path"], clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
        data.need(snapshot == live, "BOOT_SOURCE_CHANGED")
        checkpoint.source_bytes(row, live)
    data.need(type(p.get('sourceData'))is list and len(p['sourceData'])==29,'FULL_SOURCE_DATA_SET')
    for row in p['sourceData']:
        data.need(row['path'].startswith('native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/'),'FULL_SOURCE_DATA_PATH')
        data.held(ROOT/row['path'],clock,row['bytes'],row['sha256'],maximum=2*1024**2)
    if source_mode(c):
        data.need(type(p['sourceGn']['sourceData']) is list and len(p['sourceGn']['sourceData']) == 30 and
                  type(p['sourceGn']['helpers']) is list and len(p['sourceGn']['helpers']) == 11, 'FULL_SOURCE_GN_SET')
        for row in p['sourceGn']['sourceData']:
            data.need(row['path'].startswith(SOURCE_GN_NAMESPACE), 'FULL_SOURCE_GN_PATH')
            data.held(ROOT/row['path'],clock,row['bytes'],row['sha256'],maximum=2*1024**2)
        for row in p['sourceGn']['helpers']:
            data.need(row['path'].startswith('scripts/') or row['path'] == 'native/cef-hosted-recipe.json', 'FULL_SOURCE_HELPER')
            data.held(ROOT/row['path'],clock,row['bytes'],row['sha256'],maximum=2*1024**2)
    data.held(p["python"]["path"], clock, p["python"]["bytes"], p["python"]["sha256"])
    if bind:
        CONTEXT_SHA = digest(raw)
    return c, p, clock


def worker_argv(role, root, p):
    data.need(role in (*ROLES, "operation", "source-gn", "command-inventory") and CONTEXT_SHA is not None, "BOOT_ROLE")
    if role == 'source-gn':
        tools = source_host_tools(p)
        return [tools['node']['path'], '--disable-proto=throw', '--no-addons', str(HERE / 'source-driver.mjs'),
                '--source-gn', str(root), CONTEXT_SHA, '--execute']
    return [p["python"]["path"], "-I", "-B", str(HERE / "producer.py"),
            "--worker", role, str(root), CONTEXT_SHA, "--execute"]


def closed_worker_command(argv, root, p):
    if type(argv) is list and len(argv) == 8 and argv[4] == '--source-gn':
        data.need(argv == worker_argv('source-gn', Path(root), p) and Path(root) == Path.cwd(), 'FULL_NODE_COMMAND')
        return 'source-gn'
    data.need(type(argv) is list and len(argv) == 9 and argv[5] in (*ROLES, "operation", "command-inventory") and
              argv == worker_argv(argv[5], Path(root), p) and Path(root) == Path.cwd(), "BOOT_COMMAND")
    return argv[5]


def no_execution(event, _args):
    if event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn"):
        raise ValueError("BOOT_DATA_NO_EXECUTION")


def failure(error):
    code = str(error)
    return code if re.fullmatch("(?:BOOT|ACQ|FULL|IDX|INV|ENV)_[A-Z_]{1,56}", code) else "BOOT_UNAVAILABLE"


def retain(root, name, result):
    try:
        data.save(root / name, result)
    except BaseException:
        result["reportingFailure"] = "BOOT_REPORT_WRITE"
        result["success"] = False


class RuntimeProgress:
    """Closed, incomplete snapshots in the existing *-result.json retention scope."""
    PHASES = frozenset(('inventory-enter','root-enter','metadata','hash-enter','hash',
                       'hash-complete','directory-post','root-complete','sort',
                       'inventory-complete','installed14-validated','inventory-save',
                       'inventory-retained','projection-enter','projection-retained','worker-finish'))
    BOUNDARIES = PHASES - frozenset(('metadata','hash-enter','hash','hash-complete','directory-post'))
    BOUNDS = {'root':(-1,7),'visited':(0,50000),'completedFiles':(0,50000),
              'announcedBytes':(0,8*1024**3),'completedBytes':(0,8*1024**3),
              'activeBytes':(0,512*1024**2),'hashBytes':(0,512*1024**2),
              'completedDirectories':(0,50000)}

    def __init__(self, root, clock, mono=time.monotonic):
        self.root=data.plain(root);self.clock=clock;self.mono=mono;self.begin=mono()
        self.last=None;self.count=0;self.bytes=0;self.closeFailure=False
        self.state={key:(-1 if key=='root'else 0)for key in self.BOUNDS}

    def __call__(self, phase, *, force=False, **values):
        data.need(type(phase)is str and phase in self.PHASES and type(force)is bool and
                  (not force or phase in self.BOUNDARIES),'FULL_PROGRESS_FIELDS')
        data.need(not set(values)-set(self.BOUNDS),'FULL_PROGRESS_FIELDS')
        for key,value in values.items():
            low,high=self.BOUNDS[key]
            data.need(type(value)is int and low<=value<=high,'FULL_PROGRESS_FIELDS')
        self.state.update(values)
        now=self.mono();elapsed=now-self.begin
        data.need(math.isfinite(elapsed)and 0<=elapsed<=3600,'FULL_PROGRESS_CLOCK')
        # At most one periodic snapshot per six seconds. Only the fixed root and
        # phase boundaries bypass that throttle; there are no per-file writes.
        if self.count>=128 or (not force and self.last is not None and now-self.last<6):return
        self.clock.remaining()
        row={'kind':'windows-arm-runtime-progress','success':False,'complete':False,
             'sourcePostVerified':False,'role':'runtime-closure','phase':phase,
             'elapsedMs':int(elapsed*1000),'sequence':self.count,**self.state}
        raw=(json.dumps(row,sort_keys=True,separators=(',',':'))+'\n').encode('ascii')
        data.need(len(raw)<=1024 and self.bytes+len(raw)<=128*1024,'FULL_PROGRESS_BOUND')
        target=self.root/('runtime-progress-%03d-result.json'%self.count)
        data.plain(target,exists=False)
        self.count+=1;self.bytes+=len(raw)
        stream=target.open('xb');primary=None
        try:
            data.need(stream.write(raw)==len(raw),'FULL_PROGRESS_WRITE')
            stream.flush()
        except BaseException as error:
            primary=error
            raise
        finally:
            try:stream.close()
            except BaseException:
                self.closeFailure=True
                if primary is None:raise
        self.last=now


def data_worker(role, root, c, p, clock):
    sys.addaudithook(no_execution)
    result = {"role": role, "success": False, "firstFailure": None, "executed": False}
    progress=None
    try:
        if role == 'command-inventory':
            command_inventory(root, c, p, clock)
        elif role == "sdk-data":
            data.acquire_sdk(root, p, clock)
        elif role == "llvm-data":
            data.acquire_llvm(root, p, clock)
        elif role == "rust-archive":
            data.acquire_rust_archive(root, p, clock)
        elif role in ('gn-archive','siso-archive'):
            data.acquire_cipd(root, role, p, clock)
        elif role == 'materialize':
            import extract
            start=time.monotonic()
            local=data.Clock(min(clock.wall_end,time.time()+p['limits']['extractSeconds']),
                             min(clock.mono_end,start+p['limits']['extractSeconds']))
            for spec in p['cipd']:
                observed=extract.cipd_archive(root/'archives'/(spec['role']+'.zip'),root/spec['role'].removesuffix('-archive'),spec,p,local)
                data.save(root/(spec['role']+'-extracted.json'),observed)
            observed=extract.rust_archive(root/'archives/rust.tar.xz',root/'rust',p['rust'],local)
            data.save(root/'rust-extracted.json',observed)
        elif role == 'runtime-closure':
            import extract, environment
            progress=RuntimeProgress(root,clock)
            progress('inventory-enter',force=True)
            inventory_clock=data.Clock(
                min(clock.wall_end,time.time()+p['limits']['installedSeconds']),
                min(clock.mono_end,time.monotonic()+p['limits']['installedSeconds']))
            observed=environment.installed_inventory(p,inventory_clock,progress)
            inventory_clock.remaining()
            progress('inventory-save',force=True)
            data.save(root/'installed-source-inventory.json',observed)
            progress('inventory-retained',force=True)
            progress('projection-enter',force=True,root=-1,activeBytes=0,hashBytes=0)
            observed=extract.runtime_projection(root,p,clock)
            data.save(root/'runtime-projection.json',observed)
            progress('projection-retained',force=True)
        else:
            raise data.Denied('FULL_PHASE_UNAVAILABLE')
        result["success"] = True
    except BaseException as error:
        result["firstFailure"] = failure(error)
    finally:
        if getattr(sys.modules.get('extract'),'FILE_CLOSE_FAILURE',False):
            result['sourceCloseFailure']=True
        if COMMAND_INVENTORY_REPORTING_FAILURE:
            result['inventoryObservationReportingFailure']=True
        try:
            verified_sources(root)
            clock.remaining()
            result["sourcePostVerified"] = True
        except BaseException:
            result["sourcePostVerified"] = False
            result["firstFailure"] = result["firstFailure"] or "BOOT_POSTCHECK"
            result["success"] = False
        if progress is not None:
            try:progress('worker-finish',force=True)
            except BaseException as error:
                result['progressReportingFailure']=True;result['success']=False
                result['firstFailure']=result['firstFailure'] or failure(error)
            if progress.closeFailure:result['progressCloseFailure']=True
        retain(root, role + "-result.json", result)
    return 0 if result["success"] else 1


def operation(root, c, p, clock):
    # This is the only parent allowed to spawn fixed, audit-restricted Python
    # data workers. Acquired executables are never worker arguments.
    import job
    result = {"kind": "windows-arm-full-sdk-bootstrap-operation", "success": False,
              "firstFailure": None, "jobs": [], "sdkBuilt": False, "outputExecuted": False,
              "buildAdmission": False, "engineCheckpointImplemented": False}
    if source_mode(c):
        result['outputExecuted'] = None  # A failed source/hook phase is not a no-execution proof.
    parent = None
    try:
        if source_mode(c):
            source_host_tools(p)
            source_execution_policy(p)
            result['sourceCapacity'] = source_capacity(root, p, clock)
            for pin in source_host_tools(p).values():
                import extract
                extract.held(pin['path'],clock,pin['bytes'],pin['sha256'],maximum=256*1024**2,
                             expected_nlink=pin['nlink'])
        if c['mode'] != 'command-inventory':
            data.need(shutil.disk_usage(root).free >= p["limits"]["freeBytes"], "BOOT_CAPACITY")
        result["capacity"] = {"freeBytes": shutil.disk_usage(root).free,
                              "logicalCpuCount": os.cpu_count(), "engineCapacityProven": False}
        parent = job.ParentCancel(threading.Event())
        for role in (('command-inventory',) if c['mode'] == 'command-inventory' else ROLES):
            verified_sources(root)
            allotted = {"sdk-data": 1170, "llvm-data": 300, "rust-archive": 1200,
                        "gn-archive": 180, "siso-archive": 180,
                        "materialize":600,"runtime-closure":720,'command-inventory':120}[role]
            reserve = 3 if c['mode'] == 'command-inventory' else p["limits"]["finalReserveSeconds"]
            seconds = min(allotted, clock.remaining() - reserve - 3)
            data.need(seconds > 0, "BOOT_ADMISSION")
            observed = job.run_job(worker_argv(role, root, p), str(root), root / "jobs" / role,
                                   seconds, cancel=parent, cap=131072)
            result["jobs"].append({"role": role, "originalJob": observed})
            data.need(observed.get("success") is True and observed.get("cleanupVerified") is True and
                      observed.get("rootExit") == 0 and observed.get("activeAtEnd") == 0,
                      "BOOT_JOB_FAILED")
        if source_mode(c):
            verified_sources(root)
            result['capacityBeforeSource'] = source_capacity(root,p,clock,leaf='source-capacity-pre-source-result.json')
            seconds = clock.remaining() - p['sourceGn']['limits']['finalReserveSeconds'] - 3
            data.need(seconds > 0, 'FULL_SOURCE_ADMISSION')
            observed = job.run_job(worker_argv('source-gn', root, p), str(root), root/'jobs/source-gn',
                                   seconds, cancel=parent, cap=p['sourceGn']['limits']['outputBytes'])
            result['jobs'].append({'role':'source-gn','originalJob':observed})
            data.need(observed.get('success') is True and observed.get('cleanupVerified') is True and
                      observed.get('rootExit') == 0 and observed.get('activeAtEnd') == 0, 'FULL_SOURCE_JOB_FAILED')
            _, raw = data.held(root/'source-gn-result.json',clock,retain=True,maximum=131072)
            source_result = validate_source_gn_result(json.loads(raw),p)
            result['sourceGnVerified'] = True
            result['outputExecuted'] = True
        result["success"] = True
    except BaseException as error:
        result["firstFailure"] = failure(error)
    finally:
        if parent is not None:
            try:
                parent.close();result["parentHandleClosed"] = True
            except BaseException:
                result["parentHandleClosed"] = False
                result["success"] = False
                result["firstFailure"] = result["firstFailure"] or "BOOT_PARENT_CLOSE"
        try:
            verified_sources(root);clock.remaining();result["sourcePostVerified"] = True
        except BaseException:
            result["sourcePostVerified"] = False;result["success"] = False
            result["firstFailure"] = result["firstFailure"] or "BOOT_POSTCHECK"
        retain(root, "bootstrap-result.json", result)
    return 0 if result["success"] else 1


def supervise(root, c, p, clock):
    import job
    parent, result, primary = None, None, None
    try:
        (root / "jobs").mkdir()
        if source_mode(c):
            source_host_tools(p)
            source_execution_policy(p)
            source_capacity(root, p, clock, leaf='source-capacity-supervisor-result.json')
        parent = job.ParentCancel(threading.Event())
        seconds = clock.remaining() - 3
        data.need(seconds > 0, "BOOT_ADMISSION")
        result = job.run_job(worker_argv("operation", root, p), str(root), root / "jobs/operation",
                             seconds, cancel=parent, cap=131072)
        result["parentCreationFiletime"] = parent.parent_creation
        result["parentExitObserved"] = parent.exit_observed
    except BaseException as error:
        primary = failure(error)
    finally:
        closed = parent is None
        if parent is not None:
            try:
                parent.close();closed = True
            except BaseException:
                closed = False
        report = {"kind": "bootstrap-supervisor", "success": bool(result and result.get("success") and closed and not primary),
                  "firstFailure": primary, "originalJob": result, "parentHandleClosed": closed,
                  "sdkBuilt": False, "outputExecuted": False}
        if source_mode(c):report['outputExecuted'] = None
        try:
            verified_sources(root);clock.remaining();report["sourcePostVerified"] = True
        except BaseException:
            report["sourcePostVerified"] = False;report["success"] = False
            report["firstFailure"] = report["firstFailure"] or "BOOT_POSTCHECK"
        retain(root, "supervisor-result.json", report)
    return 0 if report["success"] else 1


def main(argv):
    if len(argv) == 4 and argv[0] == '--verify-source-setup' and argv[3] == '--execute':
        data.need(os.name == 'nt', 'BOOT_PLATFORM')
        root = Path(argv[1]);c,p,clock = verified_sources(root,argv[2],bind=True)
        data.need(Path(sys.executable).resolve() == Path(p['python']['path']).resolve(), 'BOOT_PYTHON')
        return verify_source_setup(root,c,p,clock)
    if len(argv) == 4 and argv[0] == "--supervise" and argv[3] == "--execute":
        data.need(os.name == "nt", "BOOT_PLATFORM")
        root = Path(argv[1]);c, p, clock = verified_sources(root, argv[2], bind=True)
        data.need(Path(sys.executable).resolve() == Path(p["python"]["path"]).resolve(), "BOOT_PYTHON")
        return supervise(root, c, p, clock)
    data.need(os.name == "nt" and len(argv) == 5 and argv[0] == "--worker" and
              argv[1] in (*ROLES, "operation", "command-inventory") and argv[4] == "--execute", "BOOT_ARGV")
    root = Path(argv[2])
    c, p, clock = verified_sources(root, argv[3], bind=True)
    data.need(Path(sys.executable).resolve() == Path(p["python"]["path"]).resolve(), "BOOT_PYTHON")
    role_in_mode(argv[1],c)
    return operation(root, c, p, clock) if argv[1] == "operation" else data_worker(argv[1], root, c, p, clock)


if __name__ == "__main__":
    sys.modules["producer"] = sys.modules[__name__]
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({"success": False, "firstFailure": failure(error), "sdkBuilt": False}))
        raise SystemExit(1)
