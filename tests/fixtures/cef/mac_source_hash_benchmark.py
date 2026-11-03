"""Fixed benign Darwin owning-codec evidence. Never a CEF source grant."""
import hashlib,io,json,os,platform,re,stat,sys,time,types,unittest
from pathlib import Path

BRANCH='refs/heads/codex/mac-source-hash-benchmark-20261103'
PYTHON='/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
PYTHON_SHA='b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d'
HELPER_SHA='c728e702508d1a22417197c056d064c496528af82a29b5c993e6f4f521a74dcb'
FD_SHA='0f5b287ef6adff29fca698f73faf0e324c7babe36738074671eedd47e030a344'
NOOP_SHA='8500196f4ec52dffeab214b90dd9ac2746ba801fb29ce4f9f535b5deb7c5f8e2'
TEMP=Path('/Users/runner/work/_temp')
PHASE='authority'
RESULTS=[]

def require(ok):
    if not ok:raise RuntimeError('OWNED_FIXTURE_CONTRACT')

def identity(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def pin(path,maximum,expected=None):
    before=path.lstat();require(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<before.st_size<=maximum)
    with path.open('rb')as stream:
        require(identity(before)==identity(os.fstat(stream.fileno())))
        raw=stream.read(maximum+1)
        require(len(raw)==before.st_size and identity(before)==identity(os.fstat(stream.fileno()))==identity(path.lstat()))
    digest=hashlib.sha256(raw).hexdigest();require(expected is None or digest==expected)
    return raw,{'bytes':len(raw),'sha256':digest}

class OriginalBudget:
    def __init__(self,started):
        now=time.time();require(0<=now-started<780)
        self.wall_end=started+840;self.end=time.monotonic()+min(720,self.wall_end-now)
        self.seconds=min(720,int(self.wall_end-now))
    def check(self):
        if time.monotonic()>=self.end or time.time()>=self.wall_end:raise TimeoutError('OWNED_FIXTURE_DEADLINE')

def module(raw,path,initial):
    value=types.ModuleType('held_'+path.stem);value.__file__=str(path);value.__dict__.update(initial)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value

def controls(value,budget,expected):
    class Result(unittest.TextTestResult):
        def startTest(self,test):budget.check();super().startTest(test)
    result=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0,resultclass=Result).run(unittest.defaultTestLoader.loadTestsFromModule(value))
    failed=[test._testMethodName for test,_ in result.failures+result.errors]
    require(all(re.fullmatch('test_[a-z_]{1,120}',name)for name in failed))
    summary={'tests':result.testsRun,'skipped':len(result.skipped),'failures':len(result.failures),'errors':len(result.errors),'failedTests':failed}
    RESULTS.append(summary);require(result.wasSuccessful()and result.testsRun==expected and not result.skipped)
    return summary

def main():
    global PHASE
    env=os.environ
    require(len(sys.argv)==1 and sys.platform=='darwin'and platform.machine()=='x86_64')
    require(env.get('GITHUB_REPOSITORY')=='supermarsx/sortOfRemoteNG'and env.get('GITHUB_REPOSITORY_ID')=='1010282954')
    require(env.get('GITHUB_REF')==BRANCH and env.get('GITHUB_EVENT_NAME')=='workflow_dispatch'and env.get('GITHUB_REPOSITORY_VISIBILITY')=='public')
    require(env.get('GITHUB_ACTIONS')=='true'and env.get('RUNNER_ENVIRONMENT')=='github-hosted')
    require(env.get('ImageOS')=='macos15'and env.get('ImageVersion')=='20260824.0482.1'and env.get('RUNNER_TEMP')==str(TEMP))
    require(re.fullmatch('[a-f0-9]{40}',env.get('GITHUB_SHA',''))is not None)
    started=env.get('CEF_MAC_HASH_BENCHMARK_STARTED_MS','');require(re.fullmatch('[0-9]{13}',started)is not None)
    budget=OriginalBudget(int(started)/1000)
    repo=Path(__file__).resolve().parents[3];head,head_pin=pin(repo/'.git/HEAD',41)
    require(head==(env['GITHUB_SHA']+'\n').encode())
    python_raw,python_pin=pin(Path(PYTHON),16384,PYTHON_SHA);require(Path(sys.executable).resolve()==Path(PYTHON).resolve())
    workflow=repo/'.github/workflows/cef-engineering-checkpoint.yml';_,workflow_pin=pin(workflow,65536)
    self_raw,self_pin=pin(Path(__file__),65536)
    helper=repo/'tests/fixtures/cef/mac_owned_source_candidate.py';raw,helper_pin=pin(helper,262144,HELPER_SHA)
    fd_path=repo/'tests/fixtures/cef/mac_owned_source_fd_test.py';fd_raw,fd_pin=pin(fd_path,65536,FD_SHA)
    noop_path=repo/'tests/fixtures/cef/mac_owned_source_noop_test.py';noop_raw,noop_pin=pin(noop_path,65536,NOOP_SHA)
    PHASE='held-import';fd=module(fd_raw,fd_path,{'HELD_HELPER_RAW':raw});noop=module(noop_raw,noop_path,{'HELD_FD_CONTROLS':fd})
    require(fd.noop_inverse(raw)!=raw and len(fd.OLD)==209410)
    PHASE='owned-fd-controls';fd_result=controls(fd,budget,19)
    PHASE='owned-codec-controls';noop_result=controls(noop,budget,25)
    PHASE='owned-snapshots';fixture=fd.OwnedFilesystem(methodName='test_owned_snapshot_pair_matches_entire_old_helper');fixture.setUp()
    # Creation-owned real detached scratch repositories, never real CEF source.
    try:
        for i in range(70,4000):(fixture.parent/('input%04d'%i)).write_bytes(bytes([i%251])*18000)
        baseline=[];candidate=[];previous=None
        for name,helper_module,rows in [('baseline',fixture.old,baseline),('candidate',fixture.m,candidate)]:
            for _ in range(2):
                budget.check();begin=time.monotonic();helper_module.source_progress_start(budget.seconds)
                value=fixture.snapshot(module=helper_module,budget=budget);helper_module.source_phase('done')
                if previous is not None:require(value==previous)
                previous=value
                rows.append({'elapsedMs':round((time.monotonic()-begin)*1000),'entries':len(value['entries']),'bytes':value['bytes'],
                             'phases':[list(item)for item in helper_module.SOURCE_PROGRESS['phases']]})
        fixture.closed();observations=[]
        for scope in fixture.scopes:
            require(scope.active==0 and scope.peak<=3 and scope.opened==scope.closed==scope.close_attempts and not scope.ledger and scope.unknown==0)
            observations.append({'peakFDs':scope.peak,'opened':scope.opened,'closed':scope.closed,'closeAttempts':scope.close_attempts,'unknown':scope.unknown,'active':scope.active})
        require(len(observations)==2 and set(previous['gitHeads'])=={'src','src/cef','depot_tools'})
        full_digest=hashlib.sha256(json.dumps(previous,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    finally:fixture.tearDown()
    PHASE='final-pins'
    for path,maximum,expected in [(helper,262144,HELPER_SHA),(fd_path,65536,FD_SHA),(noop_path,65536,NOOP_SHA),
                                 (Path(__file__),65536,self_pin['sha256']),(workflow,65536,workflow_pin['sha256']),(repo/'.git/HEAD',41,head_pin['sha256'])]:pin(path,maximum,expected)
    budget.check()
    report={'schemaVersion':1,'kind':'mac-owned-source-static-benign-fixture','head':env['GITHUB_SHA'],'runId':env['GITHUB_RUN_ID'],'attempt':env['GITHUB_RUN_ATTEMPT'],
            'image':env['ImageVersion'],'pythonVersion':platform.python_version(),'cpuCount':os.cpu_count(),'python':python_pin,'workflow':workflow_pin,'fixture':self_pin,
            'helper':helper_pin,'fdControls':fd_pin,'noopControls':noop_pin,'fdResult':fd_result,'noopResult':noop_result,'baseline':baseline,'candidate':candidate,
            'completeSnapshotEquality':True,'snapshotSha256':full_digest,'observations':observations,'workers':1,'batchCap':32,'fdCap':3,
            'sourceKind':'Three actual detached scratch Git repositories; synthetic NON-CEF identity; no public source grant',
            'rawNativeBirthFacts':True,'sourceQualified':False,'runtimeReady':False,'nativeQualified':False}
    PHASE='report';report_raw=(json.dumps(report,sort_keys=True,separators=(',',':'))+'\n').encode();require(len(report_raw)<=32768)
    target=TEMP/'cef-mac-hash-benchmark-report.json'
    with target.open('xb')as stream:require(stream.write(report_raw)==len(report_raw))
    _,written=pin(target,32768,hashlib.sha256(report_raw).hexdigest())
    print(json.dumps({'kind':report['kind'],'report':written,'runtimeReady':False,'nativeQualified':False},separators=(',',':')))

if __name__=='__main__':
    try:main()
    except BaseException as error:
        label='DEADLINE'if type(error)is TimeoutError else'CONTRACT'if type(error)is RuntimeError else'UNCLASSIFIED'
        print(json.dumps({'kind':'mac-owned-source-static-benign-fixture','success':False,'failure':label,'phase':PHASE,'results':RESULTS,'runtimeReady':False,'nativeQualified':False},separators=(',',':')))
        sys.exit(1)
