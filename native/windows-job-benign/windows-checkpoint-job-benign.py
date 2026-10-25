"""Opt-in fixed Python-only kernel fixtures. No compiler/network/runtime interface."""
import argparse,ctypes,datetime,hashlib,importlib.util,json,os,pathlib,re,stat,subprocess,sys,threading,time,uuid
from pathlib import Path
PROFILE_SHA='b57d74719436db5f8b62cc8853882b4219e7b975ead6ab39c93333d240f72940'
def load_arm_profile():
 p=Path(__file__).resolve().with_name('windows-checkpoint-job-interface.json')
 for part in(p,*p.parents):
  if part.is_symlink()or getattr(part.lstat(),'st_file_attributes',0)&0x400:raise ValueError('ARM_PROFILE_LINK')
 info=p.stat()
 if not info.st_size<=16384 or info.st_nlink!=1:raise ValueError('ARM_PROFILE_BOUND')
 with p.open('rb')as source:raw=source.read(16385)
 if len(raw)!=info.st_size or hashlib.sha256(raw).hexdigest()!=PROFILE_SHA:raise ValueError('ARM_PROFILE_PIN')
 value=json.loads(raw.decode('utf8','strict'))
 if value['target']!='aarch64-pc-windows-msvc'or value['runner']!='windows-11-arm':raise ValueError('ARM_PROFILE_TARGET')
 return value
PROFILE=load_arm_profile()
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parent.parent;ARTIFACTS=ROOT/'.artifacts';PY=Path(PROFILE['python']['path']);PY_SHA=PROFILE['python']['sha256'];SOURCE_NAMES=PROFILE['sourceNames'];CASE_NAMES=PROFILE['cases']
def need(value,code):
 if not value:raise ValueError(code)
def plain(p):
 p=pathlib.Path(p);need(p.is_absolute()and p.resolve()==p,'OWN_PATH_ALIAS')
 for part in (p,*p.parents):need(not part.is_symlink()and not(getattr(part.lstat(),'st_file_attributes',0)&0x400),'OWN_PATH_LINK')
 return p
def read_json(p):
 plain(p);size=p.stat().st_size;need(0<size<=4*1024**2,'OWN_JSON_BOUND')
 with p.open('rb')as source:raw=source.read(4*1024**2+1)
 need(len(raw)==size,'OWN_JSON_CHANGED');return json.loads(raw.decode('utf8','strict'))
def write(p,value):
 p=pathlib.Path(p);plain(p.parent);need(os.name=='nt','OWN_PUBLISH_PLATFORM')
 raw=(json.dumps(value,indent=2)+'\n').encode('utf8');need(0<len(raw)<=4*1024**2,'OWN_JSON_BOUND')
 parent=p.parent;parent_id=(parent.stat().st_dev,parent.stat().st_ino);temporary=parent/('.'+p.name+'.'+uuid.uuid4().hex+'.tmp');created=None;published=False
 try:
  with temporary.open('xb')as stream:
   info=os.fstat(stream.fileno());created=(info.st_dev,info.st_ino)
   need(stream.write(raw)==len(raw),'OWN_JSON_SHORT_WRITE')
  plain(parent);need((parent.stat().st_dev,parent.stat().st_ino)==parent_id,'OWN_PARENT_CHANGED');plain(temporary)
  info=temporary.lstat();need(stat.S_ISREG(info.st_mode)and info.st_nlink==1 and(info.st_dev,info.st_ino)==created and info.st_size==len(raw),'OWN_TEMP_CHANGED')
  # Windows os.rename atomically publishes and always denies an existing target.
  # No replace/fallback/retry: readers never observe an incomplete final name.
  os.rename(temporary,p);published=True
 finally:
  if created is not None and not published:
   plain(parent);need((parent.stat().st_dev,parent.stat().st_ino)==parent_id,'OWN_PARENT_CHANGED')
   try:
    info=temporary.lstat()
   except FileNotFoundError:pass
   else:
    plain(temporary);need(stat.S_ISREG(info.st_mode)and info.st_nlink==1 and(info.st_dev,info.st_ino)==created,'OWN_TEMP_CHANGED');temporary.unlink()

def hash_file(p):
 plain(p);need(p.is_file()and p.stat().st_nlink==1 and p.stat().st_size<=1024**2,'SOURCE_FILE_BOUND')
 with p.open('rb')as source:raw=source.read(1024**2+1)
 need(len(raw)<=1024**2,'SOURCE_STREAM_BOUND');return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
def sources():
 need(hash_file(PY)['sha256']==PY_SHA,'PYTHON_PIN');return {name:hash_file(HERE/name)for name in SOURCE_NAMES}
def load_driver():
 manifest=read_json(ROOT/'.orchestration/logs/windows-checkpoint-job-prototype-final-hashes-20261025.json');rows=manifest['files'];need(len(rows)==4 and {pathlib.Path(x['path']).name for x in rows}==set(SOURCE_NAMES),'SOURCE_FOUR_SET')
 for row in rows:
  path=ROOT/row['path'];need(path==HERE/path.name,'SOURCE_FOUR_SCOPE');need(hash_file(path)=={'bytes':row['bytes'],'sha256':row['sha256']},'SOURCE_FOUR_PIN')
 spec=importlib.util.spec_from_file_location('owned_kernel_prototype',HERE/'windows-checkpoint-job.py');driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver);return driver

def scratch():
 plain(ARTIFACTS);out=ARTIFACTS/('windows-checkpoint-benign-'+str(uuid.uuid4()));out.mkdir()
 for name in ['tmp','home','jobs']:(out/name).mkdir()
 return out

def clean(job):
 need(job.get('cleanupVerified')is True and job.get('activeAtEnd')==0 and job.get('logReadersStopped')is True,'OWNED_CLEANUP_FAILED')
 if job.get('started'):need(job.get('rootReaped')is True and isinstance(job.get('rootCreationFiletime'),str),'OWNED_ROOT_NOT_REAPED')
 if job.get('started'):
  policy=job.get('policyReadback',{});need(policy.get('flags')==0x2208 and policy.get('activeProcessLimit')==8 and policy.get('jobMemoryBytes')==str(512*1024**2)and policy.get('cpuFlags')==5 and policy.get('cpuRate')==2500 and policy.get('inheritedHandles')==3,'ACTUAL_POLICY_MISMATCH')
 need(job.get('parentHandleClosed')is True,'PARENT_HANDLE_NOT_CLOSED')

def admit_case(name,job,marker_exists=False):
 clean(job);outcome=job.get('outcome')
 expected={'normal':'success','nonzero23':'compiler-failure','timeout-child':'deadline','orphan':'descendants-left','output-cap':'output-cap','pre-cancel':'cancelled','suspended-cancel':'cancelled','assignment-fault':'launcher-failure','policy-fault':'launcher-failure','parent-controller-death':'success'}[name];need(outcome==expected,'UNEXPECTED_CASE_OUTCOME')
 need(job.get('success')is (name in {'normal','parent-controller-death'}),'EXPECTED_SUCCESS_CLASS')
 if name=='normal':need(marker_exists,'NORMAL_FIXTURE_NOT_ENTERED')
 if name in {'normal','orphan','parent-controller-death'}:need(job.get('rootExit')==0,'EXPECTED_ROOT_ZERO')
 if name=='output-cap':need(job.get('capturedBytes')==65536 and job.get('outputCapBytes')==65536,'OUTPUT_CAP_NOT_PROVEN')
 if name=='policy-fault':need(job.get('failureStage')=='cpu-policy','WRONG_POLICY_FAULT')
 if name=='assignment-fault':need(job.get('failureStage')=='assign-before-resume','WRONG_ASSIGNMENT_FAULT')
 if name=='nonzero23':need(job.get('rootExit')==23 and job.get('finalRootExit')==23,'ORIGINAL_23_NOT_PRESERVED')
 if name in {'pre-cancel','policy-fault'}:need(job.get('started')is False and 'rootPid'not in job,'UNEXPECTED_ROOT_CREATED')
 if name in {'suspended-cancel','assignment-fault'}:need(job.get('started')is True and job.get('resumed')is False and not marker_exists,'SUSPENDED_ROOT_RESUMED')
 if name=='pre-cancel':need(not marker_exists,'PRESET_CANCEL_FIXTURE_ENTERED')
 if name in {'timeout-child','orphan'}:need(marker_exists and job.get('observedChildrenReaped',0)>=1,'LIVE_CHILD_PROOF_MISSING')
 return {'expectedOutcome':expected,'originalOutcome':outcome,'originalRootExit':job.get('rootExit'),'expectedObservationVerified':True}

def process_identity(driver,handle):return str(driver.ParentCancel.creation(handle))
def exit_stamp(driver,handle):
 fields=[driver.W.FILETIME()for _ in range(4)];driver.checked(driver.process_times(handle,*[driver.C.byref(x)for x in fields]),'held-process-times');return str((fields[1].dwHighDateTime<<32)|fields[1].dwLowDateTime)
def own_current(driver):return driver.declare('GetCurrentProcess',driver.HANDLE,[])()

def fixture(mode,marker):
 root=pathlib.Path.cwd();need(root.parent==ARTIFACTS and re.fullmatch(r'windows-checkpoint-benign-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',root.name)and marker==root/'child-marker.txt','FIXTURE_SCOPE');plain(root)
 if mode=='zero':write(marker,{'fixtureEntered':True});return 0
 if mode=='nonzero':return 23
 if mode=='sleeper':time.sleep(40);return 0
 if mode=='output-cap':
  for _ in range(256):print('x'*1024,flush=True)
  return 0
 if mode in {'timeout-child','root-exits-with-child'}:
  driver=load_driver();child=subprocess.Popen([str(PY),'-I','-B',str(pathlib.Path(__file__).resolve()),'--fixture','sleeper',str(marker)],cwd=pathlib.Path.cwd(),env=driver.environment(),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True,creationflags=subprocess.CREATE_NO_WINDOW);write(marker,{'pid':child.pid,'creationFiletime':process_identity(driver,int(child._handle))})
  if mode=='root-exits-with-child':return 0
  time.sleep(40);return 0
 if mode=='owner':return owner(marker)
 if mode=='parent-controller':return controller(marker)
 if mode=='suite':return suite(marker.parent)
 raise ValueError('CLOSED_FIXTURE_MODE')

class ParentObserver:
 def __init__(self,driver,root):self.driver=driver;self.root=root;self.stop=threading.Event();self.thread=None;self.error=None;self.held={};self.facts={}
 def __call__(self,job,root_handle,pid,creation):
  self.job=job;self.root_handle=root_handle;self.facts={'controllerPid':pid,'controllerCreationFiletime':creation};self.thread=threading.Thread(target=self.observe,daemon=True);self.thread.start()
 def wait_file(self,name,end):
  path=self.root/name
  while not path.exists():
   need(not self.stop.is_set()and time.monotonic()<end,'PARENT_HANDSHAKE_DEADLINE');time.sleep(.01)
  return read_json(path)
 def hold(self,role,row):
  d=self.driver;need(type(row['pid'])is int and 0<row['pid']<2**32 and re.fullmatch('[0-9]{1,20}',row['creationFiletime']),'OWNED_IDENTITY_FIELDS');open_process=d.declare('OpenProcess',d.HANDLE,[d.W.DWORD,d.W.BOOL,d.W.DWORD]);handle=open_process(0x00100000|0x1000,False,row['pid']);d.checked(handle,'open-owned-observer-process')
  try:
   member=d.W.BOOL();is_in=d.declare('IsProcessInJob',d.W.BOOL,[d.HANDLE,d.HANDLE,d.C.POINTER(d.W.BOOL)]);d.checked(is_in(handle,self.job,d.C.byref(member))and member.value,'observer-exact-job-membership');need(process_identity(d,handle)==row['creationFiletime'],'OWNED_IDENTITY_CHANGED');need(d.wait(handle,0)==258,'OWNED_CHILD_NOT_LIVE');buffer=d.C.create_unicode_buffer(32768);count=d.W.DWORD(32768);query=d.declare('QueryFullProcessImageNameW',d.W.BOOL,[d.HANDLE,d.W.DWORD,d.W.LPWSTR,d.C.POINTER(d.W.DWORD)]);d.checked(query(handle,0,buffer,d.C.byref(count)),'owned-image-role');need(0<count.value<32768 and os.path.normcase(buffer.value)==os.path.normcase(str(PY)),'OWNED_IMAGE_ROLE');self.held[role]=handle;self.facts[role]={'pid':row['pid'],'creationFiletime':row['creationFiletime'],'imageRole':'pinned-python','imageSha256':PY_SHA,'liveBeforeControllerExit':True}
  except BaseException:d.close(handle);raise
 def observe(self):
  try:
   end=time.monotonic()+8;c=self.wait_file('controller.json',end);need(c=={'pid':self.facts['controllerPid'],'creationFiletime':self.facts['controllerCreationFiletime']},'CONTROLLER_IDENTITY_MISMATCH');self.hold('owner',self.wait_file('owner.json',end));self.hold('child',self.wait_file('owned-child.json',end));self.hold('grandchild',self.wait_file('child-marker.txt',end));write(self.root/'controller-exit-ack.json',{'controllerPid':c['pid'],'ownedChildrenVerified':True})
   while self.driver.wait(self.root_handle,0)==258:
    need(not self.stop.is_set()and time.monotonic()<end,'CONTROLLER_EXIT_NOT_OBSERVED');time.sleep(.01)
   value=exit_stamp(self.driver,self.root_handle);need(int(value)>0,'CONTROLLER_EXIT_TIME_MISSING');self.facts['controllerExitFiletime']=value
  except Exception:self.error='PARENT_OBSERVER_FAILED'
 def before_cleanup(self,deadline):
  self.cleanup_deadline=deadline;self.stop.set()
  if self.thread:self.thread.join(timeout=max(0,deadline-time.monotonic()));need(not self.thread.is_alive(),'PARENT_OBSERVER_NOT_JOINED')
 def finish(self):
  d=self.driver
  try:
   need(self.error is None and set(self.held)=={'owner','child','grandchild'}and 'controllerExitFiletime'in self.facts,'PARENT_OBSERVATION_INCOMPLETE')
   for role,handle in self.held.items():
    need(d.wait(handle,0)==0,'OWNED_OBSERVED_PROCESS_ALIVE');stamp=exit_stamp(d,handle);need(int(stamp)>=int(self.facts['controllerExitFiletime']),'CHILD_EXIT_PRECEDED_CONTROLLER');self.facts[role]['exitFiletime']=stamp
   value=d.W.DWORD();d.checked(d.exit_code(self.held['owner'],d.C.byref(value)),'held-owner-exit');need(value.value==0,'OWNER_EXIT_NOT_ZERO');owner=read_json(self.root/'owner-result.json');need(owner['expectedCancellationObserved']is True and owner['job']['parentCreationFiletime']==self.facts['controllerCreationFiletime']and owner['job']['parentExitObserved']is True,'PARENT_DEATH_PROOF_MISMATCH');clean(owner['job']);physical=read_json(self.root/'jobs/timeout-child/parent-receipt.json');need(physical==owner['job'],'PHYSICAL_OWNER_RECEIPT_MISMATCH');self.facts['ownerExit']=value.value;return self.facts
  finally:self.close_held()
 def close_held(self):
  self.stop.set()
  if self.thread and self.thread.is_alive():self.thread.join(timeout=max(0,getattr(self,'cleanup_deadline',time.monotonic())-time.monotonic()));need(not self.thread.is_alive(),'OBSERVER_STILL_RUNNING')
  failed=False
  for role,handle in list(self.held.items()):
   del self.held[role]
   if not self.driver.close(handle):failed=True
  need(not failed,'CLOSE_HELD_OBSERVER_FAILED')

def controller(marker):
 d=load_driver();root=pathlib.Path.cwd();write(root/'controller.json',{'pid':os.getpid(),'creationFiletime':process_identity(d,own_current(d))})
 with(root/'owner-stdout.log').open('xb')as stdout,(root/'owner-stderr.log').open('xb')as stderr:
  p=subprocess.Popen([str(PY),'-I','-B',str(pathlib.Path(__file__).resolve()),'--fixture','owner',str(marker)],cwd=root,env=d.environment(),stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,close_fds=True,creationflags=subprocess.CREATE_NO_WINDOW);write(root/'owner.json',{'pid':p.pid,'creationFiletime':process_identity(d,int(p._handle))});end=time.monotonic()+8
  while not(root/'controller-exit-ack.json').exists():
   need(time.monotonic()<end,'CONTROLLER_ACK_DEADLINE');time.sleep(.01)
 return 0

def owner(marker):
 d=load_driver();root=pathlib.Path.cwd();c=read_json(root/'controller.json');need(c['pid']==os.getppid(),'OWNER_PARENT_MISMATCH')
 def publish(job,handle,pid,creation):write(root/'owned-child.json',{'pid':pid,'creationFiletime':creation})
 result=d.run_benign('timeout-child',root,root/'jobs/timeout-child',10,_test_observe=publish);valid=result['outcome']=='cancelled'and result.get('parentExitObserved')is True and result.get('parentCreationFiletime')==c['creationFiletime'];clean(result);write(root/'owner-result.json',{'expectedCancellationObserved':valid,'job':result});return 0 if valid else 23

def survivor(driver,row):
 need(type(row['pid'])is int and 0<row['pid']<2**32 and re.fullmatch('[0-9]{1,20}',row['creationFiletime']),'SURVIVOR_IDENTITY_FIELDS');open_process=driver.declare('OpenProcess',driver.HANDLE,[driver.W.DWORD,driver.W.BOOL,driver.W.DWORD]);handle=open_process(0x00100000|0x1000,False,row['pid'])
 if not handle:need(driver.C.get_last_error()==87,'SURVIVOR_STATE_UNKNOWN');return 'gone'
 try:
  if process_identity(driver,handle)!=row['creationFiletime']:return 'pid-reused-original-gone'
  need(driver.wait(handle,0)==0,'OWNED_SURVIVOR_PRESENT');return 'exited'
 finally:driver.checked(driver.close(handle),'close-survivor-handle')

def suite(root):
 d=load_driver();before=sources();context=read_json(root/'guard-context.json');need(context['sources']==before,'SUITE_SOURCE_CONTEXT');report={'kind':'actual-benign-kernel-suite','success':False,'cases':[],'kernelArchitectureClaim':'local-host-only','compilerOrVendorStarted':False,'actualWindowsArmSupportProven':False};seen=[];old=pathlib.Path.cwd();parent_observer=None
 try:
  for name in CASE_NAMES:
   remaining=context['suiteDeadlineMonotonic']-time.monotonic();need(remaining>45,'SUITE_CLEANUP_RESERVE');need(sources()==before,'SUITE_SOURCE_CHANGED');case=scratch();os.chdir(case);cancel=threading.Event();fault=None;observe=None;mode={'normal':'zero','nonzero23':'nonzero','timeout-child':'timeout-child','orphan':'root-exits-with-child','output-cap':'output-cap','pre-cancel':'zero','suspended-cancel':'zero','assignment-fault':'zero','policy-fault':'zero','parent-controller-death':'parent-controller'}[name];seconds=1 if name=='timeout-child'else 10
   if name=='pre-cancel':cancel.set()
   if name=='suspended-cancel':observe=lambda *args:cancel.set()
   if name=='assignment-fault':fault='assignment'
   if name=='policy-fault':fault='policy'
   parent_observer=ParentObserver(d,case)if name=='parent-controller-death'else None
   if parent_observer:observe=parent_observer
   job=d.run_benign(mode,case,case/'jobs'/mode,seconds,cancel=cancel,_test_fault=fault,_test_observe=observe);row={'name':name,'root':str(case),'job':job};report['cases'].append(row);row['expectation']=admit_case(name,job,(case/'child-marker.txt').exists());need(read_json(case/'jobs'/mode/'parent-receipt.json')==job,'PHYSICAL_PARENT_RECEIPT');
   if job.get('started'):seen.append({'pid':job['rootPid'],'creationFiletime':job['rootCreationFiletime']})
   if name in {'timeout-child','orphan'}:seen.append(read_json(case/'child-marker.txt'))
   if parent_observer:row['parentDeath']=parent_observer.finish();seen.extend({'pid':x['pid'],'creationFiletime':x['creationFiletime']}for x in row['parentDeath'].values()if isinstance(x,dict)and 'pid'in x)
   write(case/'case.json',row);os.chdir(old)
  report['survivors']=[{'identity':row,'status':survivor(d,row)}for row in seen];need(sources()==before,'SUITE_FINAL_SOURCE_CHANGED');need(time.monotonic()<context['suiteDeadlineMonotonic'],'SUITE_FINAL_DEADLINE');report['success']=True
 except Exception as error:
  value=str(error);report['failure']=value if re.fullmatch('[A-Z_]{1,80}',value)else 'KERNEL_SUITE_FAILED'
 finally:
  os.chdir(old)
  if parent_observer:
   try:parent_observer.close_held()
   except Exception:report['observerCloseFailure']='OWNED_OBSERVER_NOT_CLOSED';report['success']=False
  write(root/'actual-suite.json',report)
 return 0 if report['success']else 1

def guard_child(root):
 d=load_driver();plain(root);context=read_json(root/'guard-context.json');need(sources()==context['sources'],'GUARD_SOURCE_CONTEXT');old=pathlib.Path.cwd();os.chdir(root);report={'kind':'owned-atomic-suite-guard','success':False}
 try:
  seconds=min(240,context['guardDeadlineMonotonic']-time.monotonic()-30);need(seconds>0,'GUARD_DEADLINE');job=d.run_benign('suite',root,root/'jobs/suite',seconds);report['job']=job;clean(job);need(job['success']is True and job['assignmentMode']=='creation-attribute'and job.get('assignedAtCreationVerified')is True and job.get('jobHandleInheritable')is False and job.get('jobHandleInStdioAllowlist')is False,'ATOMIC_SUITE_GUARD_FAILED');data=read_json(root/'actual-suite.json');need(data['success']is True and [x['name']for x in data['cases']]==CASE_NAMES,'KERNEL_CASE_SET');need(sources()==context['sources']and time.monotonic()<context['guardDeadlineMonotonic'],'GUARD_FINAL_DEADLINE');report['success']=True
 except Exception as error:
  value=str(error);report['failure']=value if re.fullmatch('[A-Z_]{1,80}',value)else 'ATOMIC_GUARD_FAILED'
 finally:os.chdir(old);write(root/'guard-result.json',report)
 return 0 if report['success']else 1

def observe_arm_abi(driver):
 import platform
 need(sys.platform=='win32'and platform.machine().upper()=='ARM64','ARM_NATIVE_PROCESS')
 types={'pointer':ctypes.c_void_p,'SIZE':driver.SIZE,'HANDLE':driver.HANDLE,'BOOL':driver.W.BOOL,'DWORD':driver.W.DWORD,'WORD':driver.W.WORD,'WCHAR':ctypes.c_wchar,'FILETIME':driver.W.FILETIME}
 measured={'types':{k:ctypes.sizeof(v)for k,v in types.items()},'structures':{k:ctypes.sizeof(getattr(driver,k))for k in PROFILE['abi']['structures']},'offsets':{k:getattr(getattr(driver,k.split('.')[0]),k.split('.')[1]).offset for k in PROFILE['abi']['offsets']}}
 need(measured==PROFILE['abi'],'ARM_ABI_LAYOUT');return measured

def guard():
 start=time.monotonic();beg=datetime.datetime.now(datetime.timezone.utc);root=scratch();before=sources();provenance=read_json(ROOT/'authority.json');need(provenance['sourcePins']==before and provenance['nativeTarget']=='aarch64-pc-windows-msvc','ARM_SOURCE_AUTHORITY');context={'sources':before,'guardDeadlineMonotonic':start+270,'suiteDeadlineMonotonic':start+235,'wholeDeadlineUtc':(beg+datetime.timedelta(seconds=300)).isoformat()};write(root/'guard-context.json',context);report={'kind':'bounded-actual-benign-kernel-operation','success':False,'root':str(root),'startedUtc':beg.isoformat(),'wholeDeadlineUtc':context['wholeDeadlineUtc'],'compilerOrVendorAuthorized':False,'actualWindowsArmSupportProven':False,'authority':provenance};p=None
 try:
  d=load_driver();write(root/'abi.json',observe_arm_abi(d))
  with(root/'controller-stdout.log').open('xb')as stdout,(root/'controller-stderr.log').open('xb')as stderr:
   p=subprocess.Popen([str(PY),'-I','-B',str(pathlib.Path(__file__).resolve()),'--guard-child',str(root)],cwd=ROOT,env={k:os.environ[k]for k in ['SystemRoot','WINDIR']if k in os.environ},stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,close_fds=True,creationflags=subprocess.CREATE_NO_WINDOW);report.update(childPid=p.pid,childCreationFiletime=process_identity(d,int(p._handle)));write(root/'launch.json',report);print(json.dumps({'pid':p.pid,'root':str(root),'deadlineUtc':context['wholeDeadlineUtc']}),flush=True)
   try:report['childExit']=p.wait(timeout=max(0,270-(time.monotonic()-start)))
   except subprocess.TimeoutExpired:report['outcome']='outer-deadline';p.kill();report['childExit']=p.wait(timeout=max(0,300-(time.monotonic()-start)))
  data=read_json(root/'guard-result.json');report['success']=report['childExit']==0 and data['success']is True and sources()==before and time.monotonic()-start<=300
 except Exception:report['failure']='BENIGN_GUARD_OPERATION_FAILED'
 finally:
  if p is not None and p.poll()is None:
   p.kill()
   try:p.wait(timeout=max(0,300-(time.monotonic()-start)))
   except subprocess.TimeoutExpired:pass
  report.update(childReaped=p is None or p.poll()is not None,elapsedMs=round((time.monotonic()-start)*1000),finishedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat());write(root/'operation.json',report);print(json.dumps({'root':str(root),'success':report['success'],'childExit':report.get('childExit'),'reaped':report['childReaped']}),flush=True)
 return 0 if report['success']and report['childReaped']else 1

if __name__=='__main__':
 try:
  if len(sys.argv)==4 and sys.argv[1]=='--fixture':raise SystemExit(fixture(sys.argv[2],pathlib.Path(sys.argv[3])))
  if len(sys.argv)==3 and sys.argv[1]=='--guard-child':raise SystemExit(guard_child(pathlib.Path(sys.argv[2])))
  if sys.argv[1:]==['--suite','--execute']:raise SystemExit(guard())
  print('{"prototypeOnly":true,"kernelExecutionAuthorized":false}')
 except Exception:print('{"kind":"benign-kernel-case-denied"}');raise SystemExit(23)
