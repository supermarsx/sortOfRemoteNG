"""Fixed benign timing evidence; never a source, SDK or runtime grant."""
import concurrent.futures as futures
from contextvars import copy_context
import hashlib, io, json, os, platform, re, stat, sys, tempfile, threading, time, types, unittest
from pathlib import Path

BRANCH='refs/heads/codex/mac-source-hash-benchmark-20261103'
HELPER='scripts/lib/cef-checkpoint-archive.py'
HELPER_SHA='3975ef80cf4daf3b4c49f7922ddd3a6b5e18517b6fe3e28c92ab03a440be57c6'
PYTHON='/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
PYTHON_SHA='b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d'
TEMP=Path('/Users/runner/work/_temp')
PHASE='authority'
CONTROL_RESULT=None
PROTOTYPE_SHA='2d3c5710df44e04b38abcdd98909fc72db7c0fc7f70db094d0695d8705f005cd'
CONTROL_SHA='f9f442eb7339a7d074201538e4abc660d85f1f4f06459cd1d51a2fa93f617322'
def require(ok):
    if not ok:raise RuntimeError('BENCHMARK_CONTRACT')
def identity(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_nlink,s.st_mtime_ns,s.st_ctime_ns)
def pin(path,maximum,expected=None):
    before=path.lstat();require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<before.st_size<=maximum)
    with path.open('rb')as stream:
        require(identity(before)==identity(os.fstat(stream.fileno())))
        raw=stream.read(maximum+1)
        require(len(raw)==before.st_size and identity(os.fstat(stream.fileno()))==identity(before)==identity(path.lstat()))
    digest=hashlib.sha256(raw).hexdigest();require(expected is None or digest==expected)
    return raw,{'bytes':len(raw),'sha256':digest}
class OriginalBudget:
    def __init__(self,started):
        now=time.time();require(0<=now-started<780)
        self.wall_end=started+840;self.end=time.monotonic()+min(720,self.wall_end-now)
        self.seconds=min(720,int(self.wall_end-now))
    def check(self):
        if time.monotonic()>=self.end or time.time()>=self.wall_end:raise TimeoutError('BENCHMARK_DEADLINE')
def hashes(module,root,rows,budget,workers,expected):
    iterator=iter(rows);pending={};actual={};active=0;peak=0;lock=threading.Lock()
    def one(row):
        nonlocal active,peak
        with lock:active+=1;peak=max(peak,active)
        try:return module.source_hash(root,row,budget,{'mac':True,'ownedMacIntel':True})
        finally:
            with lock:active-=1
    pool=futures.ThreadPoolExecutor(max_workers=workers);failed=False;primary=None
    try:
        def submit():
            budget.check();row=next(iterator,None)
            if row is not None:pending[pool.submit(copy_context().run,one,row)]=row['path']
        for _ in range(workers):submit()
        while pending:
            budget.check();done,_=futures.wait(pending,timeout=0.25,return_when=futures.FIRST_COMPLETED)
            for task in done:actual[pending.pop(task)]=task.result()
            for _ in done:submit()
        require(actual==expected)
    except BaseException as error:
        failed=True;primary=error
        for task in pending:task.cancel()
        raise
    finally:
        try:
            pool.shutdown(wait=True,cancel_futures=failed);require(active==0)
        except BaseException:
            if primary is None:raise
    budget.check();require(not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
    return peak
def main():
    global PHASE,CONTROL_RESULT
    env=os.environ
    # Authority fences precede fixture creation and helper import.
    require(len(sys.argv)==1 and sys.platform=='darwin' and platform.machine()=='x86_64')
    require(env.get('GITHUB_REPOSITORY')=='supermarsx/sortOfRemoteNG' and env.get('GITHUB_REPOSITORY_ID')=='1010282954')
    require(env.get('GITHUB_REF')==BRANCH and env.get('GITHUB_EVENT_NAME')=='workflow_dispatch')
    require(env.get('GITHUB_REPOSITORY_VISIBILITY')=='public' and env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted')
    require(env.get('ImageOS')=='macos15' and env.get('ImageVersion')=='20260824.0482.1')
    require(env.get('RUNNER_TEMP')==str(TEMP) and re.fullmatch('[a-f0-9]{40}',env.get('GITHUB_SHA','')))
    started=env.get('CEF_MAC_HASH_BENCHMARK_STARTED_MS','');require(re.fullmatch('[0-9]{13}',started) is not None)
    budget=OriginalBudget(int(started)/1000)
    temp_info=TEMP.lstat();require(stat.S_ISDIR(temp_info.st_mode) and temp_info.st_uid==os.geteuid() and TEMP.resolve()==TEMP)
    repo=Path(__file__).resolve().parents[3];require(repo==Path(env['GITHUB_WORKSPACE']).resolve())
    head_sha=hashlib.sha256((env['GITHUB_SHA']+'\n').encode()).hexdigest()
    pin(repo/'.git/HEAD',41,head_sha)
    raw,helper_pin=pin(repo/HELPER,209410,HELPER_SHA);require(len(raw)==209410)
    _,python_pin=pin(Path(PYTHON),1024**2,PYTHON_SHA);require(Path(sys.executable).resolve()==Path(PYTHON).resolve())
    _,self_pin=pin(Path(__file__),65536)
    workflow=repo/'.github/workflows/cef-engineering-checkpoint.yml';_,workflow_pin=pin(workflow,65536)
    prototype_path=Path(__file__).with_name('mac_source_hash_amortization_prototype.py')
    controls_path=Path(__file__).with_name('mac_source_hash_amortization_test.py')
    prototype_raw,prototype_pin=pin(prototype_path,65536,PROTOTYPE_SHA)
    controls_raw,controls_pin=pin(controls_path,65536,CONTROL_SHA)
    # Execute the entire actual held module bytes; never reopen an unchecked
    # named source file between its pin check and code loading.
    module=types.ModuleType('unchanged_archive');module.__file__=str(repo/HELPER)
    exec(compile(raw,str(repo/HELPER),'exec'),module.__dict__)
    pin(repo/HELPER,209410,HELPER_SHA)
    # Preserve this bounded scratch tree for ephemeral host teardown. Never
    # recursively delete a name that another process could have replaced.
    PHASE='fixture-create';root=Path(tempfile.mkdtemp(prefix='cef-mac-hash-benchmark-',dir=TEMP));root.chmod(0o700)
    rows=[];expected={};sizes=(0,97,4096,65536)
    for n in range(4000):
        budget.check();p=root/'source/src/third_party/owned/fixture/deep'/str(n//100)/('input'+str(n))
        p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);data=bytes((n%251,))*sizes[n%4]
        with p.open('xb')as stream:require(stream.write(data)==len(data))
        p.chmod(0o600);s=p.stat();name=p.relative_to(root).as_posix()
        rows.append({'path':name,'kind':'file','stamp':module.stamp(s),'ctimeNs':s.st_ctime_ns,'birthIdentity':module.source_birth_identity(s),'uid':s.st_uid,'gid':s.st_gid})
        expected[name]=hashlib.sha256(data).hexdigest()
    PHASE='baseline-hash';results=[];configured=module.SOURCE_HASH_WORKERS;require(1<=configured<=8)
    for label,workers in [('sequential',1),('current',configured),('four',4),('eight',8),('current-repeat',configured),('sequential-repeat',1)]:
        begin=time.monotonic();peak=hashes(module,root,rows,budget,workers,expected)
        results.append({'label':label,'workers':workers,'pendingCap':workers,'observedPeakReaders':peak,'elapsedMs':round((time.monotonic()-begin)*1000),'digestsExact':True,'readersJoined':True})
    PHASE='baseline-snapshot';snapshots=[];previous=None
    for _ in range(2):
        budget.check();begin=time.monotonic()
        # Actual internal Mac read-only DATA codec. No real source repositories,
        # external tool profile, source lease or production identity is forged.
        context={'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}}
        module.source_progress_start(budget.seconds)
        value=module.source_snapshot(root,budget,context=context);module.source_phase('done')
        for row in value['entries']:
            if row['kind']=='file':require(row['sha256']==expected[row['path']])
        require(previous is None or previous==value);previous=value
        snapshots.append({'elapsedMs':round((time.monotonic()-begin)*1000),'entries':len(value['entries']),'files':len(expected),'bytes':value['bytes'],'phases':[list(item)for item in module.SOURCE_PROGRESS['phases']]})
    PHASE='prototype-controls'
    prototype=types.ModuleType('fixed_hash_prototype');prototype.__file__=str(prototype_path)
    exec(compile(prototype_raw,str(prototype_path),'exec'),prototype.__dict__)
    controls=types.ModuleType('fixed_hash_controls');controls.__file__=str(controls_path)
    exec(compile(controls_raw,str(controls_path),'exec'),controls.__dict__);controls.configure(prototype,raw,prototype_raw)
    class Result(unittest.TextTestResult):
        def startTest(self,test):budget.check();super().startTest(test)
    result=unittest.TextTestRunner(stream=io.StringIO(),verbosity=0,resultclass=Result).run(unittest.defaultTestLoader.loadTestsFromModule(controls))
    failed=[test._testMethodName for test,_ in result.failures+result.errors]
    require(all(re.fullmatch('test_[a-z_]{1,120}',name)for name in failed))
    CONTROL_RESULT={'tests':result.testsRun,'skipped':len(result.skipped),'failures':len(result.failures),'errors':len(result.errors),'failedTests':failed}
    require(result.wasSuccessful()and result.testsRun==15 and not result.skipped)
    PHASE='prototype-snapshot';candidate,observations,inverse=prototype.snapshot_module(raw);candidate_snapshots=[]
    for _ in range(2):
        budget.check();begin=time.monotonic();candidate.source_progress_start(budget.seconds)
        value=candidate.source_snapshot(root,budget,context={'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}})
        candidate.source_phase('done');require(value==previous)
        candidate_snapshots.append({'elapsedMs':round((time.monotonic()-begin)*1000),'entries':len(value['entries']),'files':len(expected),'bytes':value['bytes'],'phases':[list(item)for item in candidate.SOURCE_PROGRESS['phases']]})
    pin(repo/HELPER,209410,HELPER_SHA);pin(Path(__file__),65536,self_pin['sha256']);pin(workflow,65536,workflow_pin['sha256']);budget.check()
    pin(prototype_path,65536,PROTOTYPE_SHA);pin(controls_path,65536,CONTROL_SHA)
    pin(repo/'.git/HEAD',41,head_sha)
    report={'schemaVersion':1,'kind':'mac-source-hash-benign-benchmark','head':env['GITHUB_SHA'],'runId':env['GITHUB_RUN_ID'],'attempt':env['GITHUB_RUN_ATTEMPT'],
      'image':env['ImageVersion'],'platform':platform.platform(),'pythonVersion':platform.python_version(),'cpuCount':os.cpu_count(),'currentWorkers':configured,
      'helper':helper_pin,'python':python_pin,'fixture':self_pin,'workflow':workflow_pin,'files':4000,'bytes':sum(r['stamp'][0]for r in rows),'results':results,'snapshots':snapshots,
      'prototype':prototype_pin,'controls':controls_pin,'controlResult':CONTROL_RESULT,'prototypeInverse':inverse,'prototypeSnapshots':candidate_snapshots,'prototypeObservations':observations,
      'snapshotScope':'Creation-owned internal read-only Mac DATA fixture only','fixturePreservedForHostTeardown':True,'runtimeReady':False,'nativeQualified':False}
    PHASE='report';raw=(json.dumps(report,sort_keys=True,separators=(',',':'))+'\n').encode();require(len(raw)<=32768)
    target=TEMP/'cef-mac-hash-benchmark-report.json'
    with target.open('xb')as stream:require(stream.write(raw)==len(raw))
    _,written=pin(target,32768,hashlib.sha256(raw).hexdigest())
    print(json.dumps({'kind':report['kind'],'report':written,'runtimeReady':False,'nativeQualified':False},separators=(',',':')))
if __name__=='__main__':
    try:main()
    except BaseException as error:
        label='DEADLINE' if type(error)is TimeoutError else 'CONTRACT' if type(error)is RuntimeError else 'HELPER' if type(error).__name__=='CheckpointError' else 'UNCLASSIFIED'
        print(json.dumps({'kind':'mac-source-hash-benign-benchmark','success':False,'failure':label,'phase':PHASE,'controlResult':CONTROL_RESULT,'runtimeReady':False,'nativeQualified':False},separators=(',',':')))
        sys.exit(1)
