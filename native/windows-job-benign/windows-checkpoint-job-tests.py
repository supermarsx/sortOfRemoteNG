"""Pure/AST and owned temporary-file checks; no native module import or Job."""
import ast,hashlib,json,os,pathlib,stat,tempfile,types,unittest,uuid
HERE=pathlib.Path(__file__).resolve().parent
CODE=(HERE/'windows-checkpoint-job.py').read_text();TREE=ast.parse(CODE)
def extract(name,scope):
 node=next(n for n in TREE.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))and n.name==name)
 exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'actual-prototype-definition','exec'),scope)
 return scope[name]
class Tests(unittest.TestCase):
 def test_all_four_sources_parse_and_interface_has_no_compiler_or_actual_kernel_claim(self):
  for n in ['windows-checkpoint-job.py','windows-checkpoint-job-benign.py','windows-checkpoint-job-tests.py']:ast.parse((HERE/n).read_text())
  data=json.loads((HERE/'windows-checkpoint-job-interface.json').read_text());self.assertFalse(data['claims']['productionInterface']);self.assertFalse(data['claims']['windowsArmKernelTested'])
 def test_fixture_hash_is_bound_and_only_closed_python_fixture_modes_exist(self):
  fixture_sha=hashlib.sha256((HERE/'windows-checkpoint-job-benign.py').read_text().encode('utf8')).hexdigest();self.assertEqual(json.loads((HERE/'windows-checkpoint-job-interface.json').read_text())['python']['sha256'],'46851212e3a4fc1846086dc9c7be10aeb156320b1f68dfbd86eafa56a4b0d8b4')
  self.assertIn(fixture_sha,CODE);self.assertIn("'benign-only-interface'",CODE);self.assertNotIn('autoninja',CODE);self.assertNotIn('cef-builds',CODE)
 def test_actual_benign_command_guard_rejects_foreign_python_flags_fixture_mode_and_marker(self):
  with tempfile.TemporaryDirectory()as root:
   root=pathlib.Path(root);py=root/'python';fixture=root/'fixture';py.write_bytes(b'python');fixture.write_bytes(b'fixture');old=pathlib.Path.cwd();os.chdir(root)
   try:
    scope={'Path':pathlib.Path,'PYTHON':py,'PYTHON_SHA':hashlib.sha256(b'python').hexdigest(),'FIXTURE':fixture,'FIXTURE_SHA':hashlib.sha256(b'fixture').hexdigest(),'MODES':{'zero'},'environment':lambda:{}}
    guard=extract('approved_benign_command',scope);args=[str(py),'-I','-B',str(fixture),'--fixture','zero',str(root/'child-marker.txt')];guard(args,root)
    for index,value in [(0,'foreign.exe'),(1,'-c'),(3,'foreign.py'),(5,'compiler'),(6,str(root/'outside'))]:
     changed=list(args);changed[index]=value
     with self.assertRaises(ValueError):guard(changed,root)
    py.write_bytes(b'changed')
    with self.assertRaises(ValueError):guard(args,root)
   finally:os.chdir(old)
 def test_actual_parent_cancel_holds_original_handle_detects_exit_and_unknown_wait(self):
  state={'wait':258,'parent':10,'own':20,'closed':[]}
  def declare(name,*args):return (lambda *a:123)if name=='OpenProcess'else(lambda:456)
  scope={'declare':declare,'HANDLE':object,'W':types.SimpleNamespace(DWORD=object,BOOL=object),'os':types.SimpleNamespace(getppid=lambda:7),'wait':lambda *a:state['wait'],'close':lambda h:state['closed'].append(h)or True,'checked':lambda v,s:None if v else (_ for _ in()).throw(OSError(s))}
  cls=extract('ParentCancel',scope);cls.creation=staticmethod(lambda h:state['parent']if h==123 else state['own']);event=types.SimpleNamespace(is_set=lambda:False);watch=cls(event);self.assertFalse(watch.is_set());state['wait']=0;self.assertTrue(watch.is_set());state['wait']=0xffffffff
  with self.assertRaises(OSError):watch.is_set()
  watch.close();self.assertEqual(state['closed'],[123]);state['wait']=258;state['parent']=30
  with self.assertRaises(ValueError):cls(event)
  self.assertEqual(state['closed'],[123,123])
 def test_actual_policy_reader_requires_every_small_benign_limit(self):
  class Limits:
   def __init__(self):self.basic=types.SimpleNamespace(flags=0,active_limit=0);self.job_memory=0
  class Cpu:
   def __init__(self):self.flags=0;self.rate=0
  changed={'field':None}
  def query(job,kind,obj,*args):
   if kind==9:obj.basic.flags=0x2000|0x200|8;obj.basic.active_limit=8;obj.job_memory=512*1024**2
   else:obj.flags=5;obj.rate=2500
   if changed['field']=='memory'and kind==9:obj.job_memory=1
   if changed['field']=='cpu'and kind==15:obj.rate=2000
   if changed['field']=='active'and kind==9:obj.basic.active_limit=128
   if changed['field']=='flags'and kind==9:obj.basic.flags=0
   return changed['field']!='query'
  def checked(value,stage):
   if not value:raise OSError(stage)
  read=extract('readback_policy',{'ExtendedLimits':Limits,'CpuRate':Cpu,'query_job':query,'C':types.SimpleNamespace(byref=lambda x:x,sizeof=lambda x:1),'checked':checked})
  self.assertEqual(read(123)['jobMemoryBytes'],str(512*1024**2))
  for field in ['memory','cpu','active','flags','query']:
   changed['field']=field
   with self.assertRaises(OSError):read(123)
 def test_inherited_lifecycle_still_contains_suspended_assignment_explicit_handles_and_one_cleanup_deadline(self):
  run=next(n for n in TREE.body if isinstance(n,ast.FunctionDef)and n.name=='run_job');text=ast.get_source_segment(CODE,run);self.assertLess(text.index('assign('),text.index('resume('));self.assertIn('0x20002',text);self.assertIn('cleanup_deadline',text);self.assertIn('wait_until(pi.process, cleanup_deadline',text);self.assertIn('approved_benign_command(argv,cwd)',text);self.assertIn("Path(output)!=Path(cwd)/'jobs'/argv[5]",text);self.assertIn("result['policyReadback']=readback_policy(job)",text)
 def test_actual_environment_uses_only_owned_temp_and_system32_without_ambient_values(self):
  parent=pathlib.Path(tempfile.mkdtemp());(parent/'.artifacts').mkdir();root=parent/'.artifacts'/('windows-checkpoint-benign-'+str(uuid.uuid4()));root.mkdir();(root/'tmp').mkdir();(root/'home').mkdir();old=pathlib.Path.cwd();os.chdir(root)
  try:
   env=extract('environment',{'Path':pathlib.Path,'__file__':str(root.parent.parent/'.cache/windows-checkpoint-prototype/windows-checkpoint-job.py')})();self.assertEqual(env['PATH'],'C:/Windows/System32');self.assertEqual(env['TEMP'],str(root/'tmp'));self.assertNotIn('GH_TOKEN',env);self.assertNotIn('LIB',env)
  finally:os.chdir(old);(root/'tmp').rmdir();(root/'home').rmdir();root.rmdir();(parent/'.artifacts').rmdir();parent.rmdir()
 def test_actual_parent_close_failure_is_physically_recorded_without_overwriting_original_job(self):
  for original_exit,close_fails in [(0,False),(0,True),(23,True)]:
   with tempfile.TemporaryDirectory()as root:
    root=pathlib.Path(root);output=root/'jobs/zero';output.mkdir(parents=True);original={'success':original_exit==0,'outcome':'success'if original_exit==0 else 'compiler-failure','rootExit':original_exit};data=json.dumps(original).encode();(output/'receipt.json').write_bytes(data)
    class Parent:
     parent_creation='12345'
     def __init__(self,event):pass
     def close(self):
      if close_fails:raise OSError('synthetic-close')
    scope={'Path':pathlib.Path,'MODES':{'zero'},'PYTHON':root/'python','FIXTURE':root/'fixture','approved_benign_command':lambda *args:None,'ParentCancel':Parent,'threading':types.SimpleNamespace(Event=lambda:None),'run_job':lambda *args,**kwargs:dict(original),'json':json}
    extract('write_parent_receipt',scope);run=extract('run_benign',scope);result=run('zero',root,output,1);physical=json.loads((output/'parent-receipt.json').read_text());self.assertEqual(physical,result);self.assertEqual((output/'receipt.json').read_bytes(),data);self.assertEqual(physical['originalJobOutcome'],original['outcome']);self.assertEqual(physical['originalJobRootExit'],original_exit);self.assertEqual(physical['parentHandleClosed'],not close_fails);self.assertEqual(physical['success'],original_exit==0 and not close_fails)

FIX_CODE=(HERE/'windows-checkpoint-job-benign.py').read_text();FIX_TREE=ast.parse(FIX_CODE)
def fixture_definition(name,scope):
 node=next(n for n in FIX_TREE.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))and n.name==name)
 exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'actual-benign-fixture-definition','exec'),scope);return scope[name]
def need(value,code):
 if not value:raise ValueError(code)
def base_case(name):
 result={'started':True,'jobCreated':True,'rootReaped':True,'rootCreationFiletime':'123','cleanupVerified':True,'activeAtEnd':0,'logReadersStopped':True,'parentHandleClosed':True,'resumed':True,'policyReadback':{'flags':0x2208,'activeProcessLimit':8,'jobMemoryBytes':str(512*1024**2),'cpuFlags':5,'cpuRate':2500,'inheritedHandles':3},'rootExit':0,'finalRootExit':0,'capturedBytes':0,'outputCapBytes':65536}
 values={'normal':('success',True),'nonzero23':('compiler-failure',False),'timeout-child':('deadline',False),'orphan':('descendants-left',False),'output-cap':('output-cap',False),'pre-cancel':('cancelled',False),'suspended-cancel':('cancelled',False),'assignment-fault':('launcher-failure',False),'policy-fault':('launcher-failure',False),'parent-controller-death':('success',True)};result['outcome'],result['success']=values[name]
 if name=='nonzero23':result['rootExit']=result['finalRootExit']=23
 if name in {'timeout-child','orphan'}:result['observedChildrenReaped']=1
 if name in {'pre-cancel','policy-fault'}:result['started']=False;result.pop('rootCreationFiletime')
 if name in {'suspended-cancel','assignment-fault'}:result['resumed']=False
 if name=='assignment-fault':result['failureStage']='assign-before-resume'
 if name=='policy-fault':result['failureStage']='cpu-policy'
 if name=='output-cap':result['capturedBytes']=65536
 return result
class HarnessTests(unittest.TestCase):
 def test_atomic_outer_branch_has_two_attributes_only_three_handles_and_no_manual_fallback(self):
  run=next(n for n in TREE.body if isinstance(n,ast.FunctionDef)and n.name=='run_job');text=ast.get_source_segment(CODE,run);self.assertIn('attribute_count = 2 if atomic_suite else 1',text);self.assertIn('0x2000D',text);self.assertIn('(HANDLE*1)(job)',text);self.assertIn('job-not-stdio-handle',text);self.assertIn('job-handle-not-inherited',text);self.assertIn('verify-atomic-suite-membership',text)
  branch=next(n for n in ast.walk(run)if isinstance(n,ast.If)and isinstance(n.test,ast.Name)and n.test.id=='atomic_suite'and any(isinstance(x,ast.Assign)and any(isinstance(t,ast.Subscript)for t in x.targets)for x in n.body));calls=[n.func.id for part in branch.body for n in ast.walk(part)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)];self.assertNotIn('assign',calls);self.assertLess(text.index('verify-atomic-suite-membership'),text.index('resume(pi.thread)'))
 def test_every_expected_case_and_original_failure_class_is_explicit(self):
  scope={'need':need};fixture_definition('clean',scope);admit=fixture_definition('admit_case',scope)
  names=['normal','nonzero23','timeout-child','orphan','output-cap','pre-cancel','suspended-cancel','assignment-fault','policy-fault','parent-controller-death']
  for name in names:
   marker=name in {'normal','timeout-child','orphan'};self.assertTrue(admit(name,base_case(name),marker)['expectedObservationVerified']);bad=base_case(name);bad['cleanupVerified']=False
   with self.assertRaises(ValueError):admit(name,bad,marker)
  bad=base_case('suspended-cancel');bad['resumed']=True
  with self.assertRaises(ValueError):admit('suspended-cancel',bad,False)
  with self.assertRaises(ValueError):admit('pre-cancel',base_case('pre-cancel'),True)
  bad=base_case('normal');bad['policyReadback']['cpuRate']=3000
  with self.assertRaises(ValueError):admit('normal',bad,True)
 def test_owned_json_writer_is_parseable_and_invalid_utf8_or_replay_denies(self):
  scope={'pathlib':pathlib,'need':need,'json':json,'os':os,'stat':stat,'uuid':uuid};fixture_definition('plain',scope);read=fixture_definition('read_json',scope);write=fixture_definition('write',scope)
  with tempfile.TemporaryDirectory()as root:
   p=pathlib.Path(root)/'record.json';write(p,{'own':True});self.assertEqual(read(p),{'own':True})
   with self.assertRaises(FileExistsError):write(p,{'own':False})
   p.write_bytes(b'{"bad":"\xff"}')
   with self.assertRaises(UnicodeDecodeError):read(p)
 def test_parent_observer_opens_only_exact_job_members_before_reading_image_role(self):
  import ctypes,threading,time
  state={'member':True,'creation':'123','image':str(HERE/'python.exe'),'queries':0,'closed':[]}
  def declare(name,*args):
   if name=='OpenProcess':return lambda *a:100
   if name=='IsProcessInJob':
    def member(h,j,out):out._obj.value=state['member'];return True
    return member
   if name=='QueryFullProcessImageNameW':
    def query(h,f,buffer,count):state['queries']+=1;buffer.value=state['image'];count._obj.value=len(state['image']);return True
    return query
   raise AssertionError(name)
  def checked(value,stage):
   if not value:raise OSError(stage)
  driver=types.SimpleNamespace(declare=declare,HANDLE=ctypes.c_void_p,W=types.SimpleNamespace(DWORD=ctypes.c_uint32,BOOL=ctypes.c_int,LPWSTR=ctypes.c_wchar_p),C=ctypes,checked=checked,wait=lambda *a:258,close=lambda h:state['closed'].append(h)or True,ParentCancel=types.SimpleNamespace(creation=lambda h:state['creation']))
  scope={'need':need,'threading':threading,'time':time,'re':__import__('re'),'os':os,'PY':HERE/'python.exe','PY_SHA':'0'*64,'process_identity':lambda d,h:d.ParentCancel.creation(h)};cls=fixture_definition('ParentObserver',scope);observer=cls(driver,HERE);observer.job=200;observer.hold('owner',{'pid':42,'creationFiletime':'123'});self.assertEqual(observer.facts['owner']['imageRole'],'pinned-python');observer.close_held();self.assertFalse(observer.held)
  state['member']=False;state['queries']=0
  with self.assertRaises(OSError):observer.hold('foreign',{'pid':43,'creationFiletime':'123'})
  self.assertEqual(state['queries'],0);self.assertEqual(state['closed'],[100,100])
  state['member']=True;state['creation']='456'
  with self.assertRaises(ValueError):observer.hold('reused',{'pid':44,'creationFiletime':'123'})
  self.assertEqual(state['queries'],0)
 def test_controller_identity_mismatch_prevents_child_observation_or_exit_ack(self):
  import threading,time
  calls=[];scope={'need':need,'threading':threading,'time':time,'write':lambda *args:calls.append('ack')};cls=fixture_definition('ParentObserver',scope);obj=cls(types.SimpleNamespace(),HERE);obj.facts={'controllerPid':7,'controllerCreationFiletime':'123'};obj.wait_file=lambda *args:{'pid':8,'creationFiletime':'123'};obj.hold=lambda *args:calls.append('hold');obj.observe();self.assertEqual(obj.error,'PARENT_OBSERVER_FAILED');self.assertEqual(calls,[])
 def test_observer_close_attempts_all_owned_handles_and_never_double_closes_after_failure(self):
  import threading,time
  calls=[];driver=types.SimpleNamespace(close=lambda h:calls.append(h)or h!=2);scope={'need':need,'threading':threading,'time':time};cls=fixture_definition('ParentObserver',scope);obj=cls(driver,HERE);obj.held={'one':1,'two':2,'three':3}
  with self.assertRaises(ValueError):obj.close_held()
  self.assertEqual(calls,[1,2,3]);self.assertFalse(obj.held);obj.close_held();self.assertEqual(calls,[1,2,3])
 def test_guard_and_case_lists_have_one_carried_300_second_bound_and_no_generic_commands(self):
  self.assertIn("sys.argv[1:]==['--suite','--execute']",FIX_CODE);self.assertIn('min(240,',FIX_CODE);self.assertIn('270-(time.monotonic()-start)',FIX_CODE);self.assertIn('300-(time.monotonic()-start)',FIX_CODE);self.assertIn('time.monotonic()-start<=300',FIX_CODE);self.assertIn("_test_observe.before_cleanup(cleanup_deadline)",CODE);self.assertNotIn('BREAKAWAY',CODE);self.assertNotIn('autoninja',FIX_CODE);self.assertIn("'actualWindowsArmSupportProven':False",FIX_CODE)
 def test_source_manifest_foreign_path_is_rejected_before_native_module_execution(self):
  scope={'need':need,'ROOT':HERE,'HERE':HERE,'SOURCE_NAMES':['a','b','c','d'],'read_json':lambda p:{'files':[{'path':'foreign/'+x,'bytes':1,'sha256':'0'*64}for x in ['a','b','c','d']]},'pathlib':pathlib};load=fixture_definition('load_driver',scope)
  with self.assertRaises(ValueError):load()

class AtomicPublicationTests(unittest.TestCase):
 def scope(self,os_adapter=None,json_adapter=None):
  scope={'pathlib':pathlib,'need':need,'json':json if json_adapter is None else json_adapter,'os':os if os_adapter is None else os_adapter,'stat':stat,'uuid':uuid}
  fixture_definition('plain',scope);return scope
 def test_completed_staged_json_is_invisible_until_atomic_publish(self):
  import threading
  entered=threading.Event();release=threading.Event();errors=[]
  def delayed_rename(source,target):entered.set();need(release.wait(2),'TEST_PUBLISH_GATE');return os.rename(source,target)
  adapter=types.SimpleNamespace(name=os.name,fstat=os.fstat,rename=delayed_rename);scope=self.scope(os_adapter=adapter);write=fixture_definition('write',scope);read=fixture_definition('read_json',self.scope())
  with tempfile.TemporaryDirectory()as root:
   root=pathlib.Path(root);p=root/'handshake.json';value={'owned':True,'complete':'whole record'}
   def worker():
    try:write(p,value)
    except Exception as error:errors.append(error)
   thread=threading.Thread(target=worker);thread.start()
   try:
    self.assertTrue(entered.wait(2));self.assertFalse(p.exists());temporary=list(root.glob('.*.tmp'));self.assertEqual(len(temporary),1);self.assertEqual(json.loads(temporary[0].read_bytes()),value)
   finally:release.set();thread.join(2)
   self.assertFalse(thread.is_alive());self.assertFalse(errors);self.assertEqual(read(p),value);self.assertEqual(list(root.glob('.*.tmp')),[])
 def test_duplicate_destination_and_failed_publish_preserve_destination_and_cleanup_only_own_temp(self):
  with tempfile.TemporaryDirectory()as root:
   root=pathlib.Path(root);p=root/'record.json';write=fixture_definition('write',self.scope());write(p,{'old':True});original=p.read_bytes()
   with self.assertRaises(FileExistsError):write(p,{'new':True})
   self.assertEqual(p.read_bytes(),original);self.assertEqual(list(root.glob('.*.tmp')),[])
   sentinel=root/'.foreign.tmp';sentinel.write_bytes(b'preserve')
   def fail_rename(*args):raise OSError('synthetic-publish-failure')
   adapter=types.SimpleNamespace(name=os.name,fstat=os.fstat,rename=fail_rename);failed=fixture_definition('write',self.scope(os_adapter=adapter))
   with self.assertRaises(OSError):failed(root/'failed.json',{'new':True})
   self.assertFalse((root/'failed.json').exists());self.assertEqual(list(root.glob('.*.tmp')),[sentinel]);self.assertEqual(sentinel.read_bytes(),b'preserve')
 def test_oversize_or_wrong_platform_denies_before_creating_any_temp(self):
  with tempfile.TemporaryDirectory()as root:
   root=pathlib.Path(root);write=fixture_definition('write',self.scope())
   with self.assertRaises(ValueError):write(root/'oversize.json',{'x':'a'*(4*1024**2)})
   adapter=types.SimpleNamespace(name='posix');wrong=fixture_definition('write',self.scope(os_adapter=adapter))
   with self.assertRaises(ValueError):wrong(root/'not-windows.json',{'owned':True})
   self.assertEqual(list(root.iterdir()),[])

class ArmPortableTests(unittest.TestCase):
 def test_profile_reader_hashes_actual_bytes_and_denies_replacement_without_loading_driver(self):
  scope={'Path':pathlib.Path,'hashlib':hashlib,'json':json,'__file__':str(HERE/'windows-checkpoint-job.py'),'PROFILE_SHA':hashlib.sha256((HERE/'windows-checkpoint-job-interface.json').read_bytes()).hexdigest()}
  load=extract('load_arm_profile',scope);self.assertEqual(load()['python']['machine'],43620)
  with tempfile.TemporaryDirectory()as root:
   root=pathlib.Path(root);(root/'windows-checkpoint-job-interface.json').write_text('{"secret":true}')
   scope['__file__']=str(root/'windows-checkpoint-job.py')
   with self.assertRaisesRegex(ValueError,'ARM_PROFILE_PIN'):load()
 def test_actual_ctypes_structures_match_expected_arm_abi_under_simulated_machine_only(self):
  import ctypes,ctypes.wintypes,platform,sys,unittest.mock
  scope={'C':ctypes,'W':ctypes.wintypes,'SIZE':ctypes.c_size_t,'HANDLE':ctypes.wintypes.HANDLE}
  for name in ['BasicLimits','IoCounters','ExtendedLimits','CpuRate','Accounting','Startup','StartupEx','ProcessInfo']:extract(name,scope)
  driver=types.SimpleNamespace(**scope);profile=json.loads((HERE/'windows-checkpoint-job-interface.json').read_bytes());fixture_scope={'ctypes':ctypes,'sys':types.SimpleNamespace(platform='win32'),'need':need,'PROFILE':profile};observe=fixture_definition('observe_arm_abi',fixture_scope)
  with unittest.mock.patch.object(platform,'machine',return_value='ARM64'):
   self.assertEqual(observe(driver),profile['abi'])
   profile['abi']['types']['pointer']=4
   with self.assertRaisesRegex(ValueError,'ARM_ABI_LAYOUT'):observe(driver)
  with unittest.mock.patch.object(platform,'machine',return_value='AMD64'):
   with self.assertRaisesRegex(ValueError,'ARM_NATIVE_PROCESS'):observe(driver)
 def test_runtime_guard_checks_abi_and_actual_source_authority_before_process_creation(self):
  node=next(n for n in FIX_TREE.body if isinstance(n,ast.FunctionDef)and n.name=='guard');text=ast.get_source_segment(FIX_CODE,node)
  self.assertLess(text.index('observe_arm_abi(d)'),text.index('subprocess.Popen('));self.assertLess(text.index('ARM_SOURCE_AUTHORITY'),text.index('subprocess.Popen('));self.assertIn("provenance=read_json(ROOT/'authority.json')",text)

if __name__=='__main__':unittest.main()
