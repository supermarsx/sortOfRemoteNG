"""Pure native-compiler contracts and binary parsers; no Windows API/Job/tool."""
from pathlib import Path
import ast
import importlib.util
import json
import io
import os
import struct
import tempfile
import unittest
import types
from unittest.mock import Mock, patch

def without_owned_observer(raw):
 start=b'# BEGIN owned Job metadata observer (no lifecycle authority).\r\n';end=b'# END owned Job metadata observer.\r\n\r\n'
 assert raw.count(start)==raw.count(end)==1
 a=raw.index(start);b=raw.index(end)+len(end);raw=raw[:a]+raw[b:]
 original=b"   try:\r\n    proof=job.run_job(worker_argv(role,root,p),root,root/'jobs'/role,min(87,remaining-3),cancel=parent,cap=1048576)\r\n"
 observed=b"   try:\r\n    member_observer=OwnedMemberObservation(OwnedMemberApi(job))\r\n    proof=job.run_job(worker_argv(role,root,p),root,root/'jobs'/role,min(87,remaining-3),cancel=parent,cap=1048576,_test_observe=member_observer)\r\n    proof['ownedMemberObservation']=member_observer.report()\r\n"
 assert raw.count(observed)==1
 return raw.replace(observed,original)

s=importlib.util.spec_from_file_location('arm_compile_source',Path(__file__).with_name('compile.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def object_bytes(machine=0xaa64,directives=b' /DEFAULTLIB:LIBCMT /DEFAULTLIB:OLDNAMES '):
 raw=bytearray(60+len(directives));struct.pack_into('<HH',raw,0,machine,1);raw[20:28]=b'.drectve';struct.pack_into('<II',raw,36,len(directives),60);raw[60:]=directives;return bytes(raw)
def pe_bytes(machine=0xaa64,name=b'KERNEL32.dll'):
 raw=bytearray(2048);raw[:2]=b'MZ';struct.pack_into('<I',raw,60,128);raw[128:132]=b'PE\0\0';struct.pack_into('<HH',raw,132,machine,1);struct.pack_into('<H',raw,148,240);struct.pack_into('<H',raw,152,0x20b);struct.pack_into('<II',raw,272,0x1000,40);struct.pack_into('<III',raw,404,0x1000,1024,512);struct.pack_into('<I',raw,524,0x1100);raw[768:768+len(name)+1]=name+b'\0';return bytes(raw)
def archive_member(name,data):
 fields=[name.ljust(16,b' '),b'0'.ljust(12),b'0'.ljust(6),b'0'.ljust(6),b'0'.ljust(8),str(len(data)).encode().ljust(10),b'`\n']
 return b''.join(fields)+data+(b'\n'if len(data)&1 else b'')

class Tests(unittest.TestCase):
 def test_backend_exact_derivative_only_profile_and_admission(self):
  root=Path(__file__).resolve().parents[2];old=(root/'native/windows-arm-native-tools/job.py').read_bytes();new=Path(__file__).with_name('job.py').read_bytes()
  self.assertEqual(m.sha(old),'92da42622686aad7c0e8ec0a7d012b07df4ff617dc1789a760a0bccc664d0995')
  expected=old.replace(b'97342e8b854a4bd970d3794ac5d966198bfc08cef67b5647da79b5ae35379bf1',m.PROFILE_SHA.encode()).replace(b'from observe import closed_worker_command, verified_sources',b'from compile import closed_worker_command, verified_sources')
  self.assertEqual(new,expected)
  def core(data):
   tree=ast.parse(data);tree.body=[n for n in tree.body if not(isinstance(n,ast.FunctionDef)and n.name=='approved_tool_command')and not(isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='PROFILE_SHA'for t in n.targets))];return ast.dump(tree)
  self.assertEqual(core(old),core(new))
 def test_profile_exact25_no_setup_or_cef_claim(self):
  p=m.profile();self.assertEqual(len(p['files']),25);self.assertEqual(p['roles'],list(m.ROLES));self.assertIsNone(p['claims']['setupCompatibility']);self.assertFalse(p['claims']['loadedModulesVerified']);self.assertFalse(p['claims']['outputExecuted'])
 def test_seven_fixed_commands_compile_only_mfc_and_static_three(self):
  p=m.profile();root=Path('C:/owned-root')
  for role in m.ROLES:
   argv=m.compiler_argv(role,root,p)
   if role.startswith('link-'):self.assertIn('/MACHINE:ARM64',argv);self.assertEqual(argv[-1],'kernel32.lib');self.assertNotIn('/DLL',argv)
   else:self.assertIn('/c',argv);self.assertIn('/MT',argv);self.assertIn('/WX',argv);self.assertIn('/DUNICODE',argv)
  self.assertEqual([x for x in m.ROLES if x.startswith('link-')],['link-c','link-stl','link-atl'])
  with self.assertRaises(ValueError):m.compiler_argv('arbitrary',root,p)
 def test_environment_has_no_inherited_secrets_or_proxy(self):
  p=m.profile()
  with patch.dict(os.environ,{'GITHUB_TOKEN':'fake-owned-token','HTTPS_PROXY':'fake-owned-proxy','CL':'/FIforeign.h'}):env=m.compiler_environment(Path('C:/owned-root'),p)
  self.assertNotIn('GITHUB_TOKEN',env);self.assertNotIn('HTTPS_PROXY',env);self.assertEqual(env['CL'],'');self.assertEqual(env['INCLUDE'],';'.join(p['includes']));self.assertEqual(env['LIB'],';'.join(p['libraries']))
 def test_closed_worker_exact_role_path_and_context(self):
  p=m.profile();old=m.BOUND_CONTEXT_DIGEST;m.BOUND_CONTEXT_DIGEST='a'*64
  try:
   root=Path.cwd();args=m.worker_argv('c',root,p);self.assertEqual(m.closed_worker_command(args,root,p),'c')
   for changed in [args[:-1]+['b'*64],args[:3]+['other.py']+args[4:],args[:5]+['git']+args[6:]]:
    with self.assertRaises(ValueError):m.closed_worker_command(changed,root,p)
  finally:m.BOUND_CONTEXT_DIGEST=old
 def test_coff_arm64_and_directives(self):
  value=m.coff(object_bytes());self.assertEqual(value['machine'],0xaa64);self.assertEqual(value['defaultLibraries'],['LIBCMT','OLDNAMES'])
  for raw in [object_bytes(0x8664),object_bytes(0xa641),object_bytes()[:30],object_bytes(directives=b'/DEFAULTLIB:../../foreign.lib')]:
   with self.assertRaises(ValueError):m.coff(raw)
 def test_archive_mixed_machines_are_observed_not_pure_arm_claim(self):
  raw=b'!<arch>\n'+archive_member(b'a.obj/',object_bytes())+archive_member(b'b.obj/',object_bytes(0xa641));value=m.archive_machines(raw)
  self.assertEqual(value['machineCounts'],{str(0xaa64):1,str(0xa641):1});self.assertFalse(value['allMembersArm64Claimed'])
  with self.assertRaises(ValueError):m.archive_machines(raw[:-10])
 def test_pe_arm64_declared_imports_and_wrong_arch(self):
  self.assertEqual(m.pe(pe_bytes())['importLibraries'],['KERNEL32.dll'])
  for raw in [pe_bytes(0x8664),pe_bytes(0xa641),pe_bytes(name=b'../foreign.dll'),pe_bytes()[:180]]:
   with self.assertRaises(ValueError):m.pe(raw)
 def test_path_escape_denied_before_open(self):
  for value in ['C:\\owned\\..\\foreign.lib','C:\\owned\\C:\\foreign.lib','\\\\server\\share\\file.lib','C:\\owned\\.\\file.lib']:
   with self.assertRaises(ValueError):m.scoped_dependency(value,['C:/owned'])
 def test_bounded_real_owned_file_rejects_growth_cap(self):
  with tempfile.TemporaryDirectory()as folder:
   file=Path(folder).resolve()/'owned.txt';file.write_bytes(b'owned')
   self.assertEqual(m.bounded(file,5),b'owned')
   with self.assertRaises(ValueError):m.bounded(file,4)
 def test_import_does_not_load_kernel_or_launch_program(self):
  tree=ast.parse(Path(__file__).with_name('compile.py').read_text())
  for node in tree.body:
   if isinstance(node,ast.Assign)and isinstance(node.value,ast.Call):self.assertNotIn(ast.unparse(node.value.func),['subprocess.Popen','C.WinDLL','ctypes.WinDLL'])
 def test_real_collector_preserves_nonzero_compiler_exit_with_fake_child(self):
  class Child:
   pid=123
   stdout=io.BytesIO(b'fixed compiler diagnostic\n')
   def poll(self):return 23
   def wait(self,timeout):return 23
  observed=[];launch=Mock(return_value=Child())
  with patch.object(m.subprocess,'CREATE_NO_WINDOW',0x08000000,create=True),patch.object(m.subprocess,'Popen',side_effect=AssertionError('real-child-spawn'))as real_spawn:
   code,raw,errors=m.collect(['fixed-not-executed'],Path.cwd(),{},launch=launch,on_started=observed.append)
   real_spawn.assert_not_called()
  launch.assert_called_once_with(['fixed-not-executed'],cwd=Path.cwd(),env={},stdin=m.subprocess.DEVNULL,stdout=m.subprocess.PIPE,stderr=m.subprocess.STDOUT,creationflags=0x08000000)
  self.assertEqual(code,23);self.assertEqual(raw,b'fixed compiler diagnostic\n');self.assertEqual(errors,[]);self.assertEqual(observed,[123])
 def test_real_collector_bounds_output_and_preserves_owned_kill_failure(self):
  class Child:
   pid=123
   stdout=io.BytesIO(b'x'*(1048576+1))
   def poll(self):return None
   def kill(self):raise OSError('owned-mock-only')
   def wait(self,timeout):raise TimeoutError()
  launch=Mock(return_value=Child())
  with patch.object(m.subprocess,'CREATE_NO_WINDOW',0x08000000,create=True),patch.object(m.subprocess,'Popen',side_effect=AssertionError('real-child-spawn'))as real_spawn:
   code,raw,errors=m.collect(['fixed-not-executed'],Path.cwd(),{},launch=launch)
   real_spawn.assert_not_called()
  launch.assert_called_once_with(['fixed-not-executed'],cwd=Path.cwd(),env={},stdin=m.subprocess.DEVNULL,stdout=m.subprocess.PIPE,stderr=m.subprocess.STDOUT,creationflags=0x08000000)
  self.assertIsNone(code);self.assertLessEqual(len(raw),1048576);self.assertIn('COMPILE_OUTPUT_CAP',errors);self.assertIn('COMPILE_OWN_CHILD_KILL_FAILED',errors);self.assertIn('COMPILE_OWN_CHILD_UNKNOWN',errors)
 def test_bigobj_native_machine_and_truncation(self):
  raw=bytearray(96);raw[:4]=b'\0\0\xff\xff';struct.pack_into('<HH',raw,4,2,0xaa64);struct.pack_into('<I',raw,44,1);raw[56:61]=b'.text'
  self.assertEqual(m.coff(raw)['machine'],0xaa64)
  with self.assertRaises(ValueError):m.coff(raw[:48])

 def test_only_tu_writer_changes_from_actual_pinned_beforeimage(self):
  current=without_owned_observer(Path(__file__).with_name('compile.py').read_bytes())
  fixed=b"with (root/'sources'/(name+'.'+extension)).open('xb')as f:f.write(text.encode('ascii'))"
  original=b"with (root/'sources'/(name+'.'+extension)).open('x',encoding='ascii')as f:f.write(text)"
  self.assertEqual(current.count(fixed),1)
  self.assertEqual(m.sha(current.replace(fixed,original)),'4ec17bd96f1a59fdf2d8c872e9b602cd5d5fc13e35b8ef5bb0c55e770bb1dba7')
 def actual_tu_guard(self,root,role):
  tree=ast.parse(Path(__file__).with_name('compile.py').read_bytes())
  worker=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='worker')
  calls=[n for n in ast.walk(worker)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='need'and len(n.args)==2 and isinstance(n.args[1],ast.Constant)and n.args[1].value=='COMPILE_TU_CHANGED']
  self.assertEqual(len(calls),1);source,extension=m.SOURCES[role]
  return eval(compile(ast.Expression(calls[0]),'<actual-unchanged-TU-guard>','eval'),{'need':m.need,'bounded':m.bounded,'root':root,'role':role,'source':source,'extension':extension})
 @unittest.skipUnless(os.name=='nt','actual Windows default text-newline behavior')
 def test_actual_old_windows_text_writer_denied_by_unchanged_production_guard(self):
  parent=Path(tempfile.gettempdir()).resolve()
  with tempfile.TemporaryDirectory(dir=parent)as folder:
   root=Path(folder).resolve();before=root.lstat();(root/'sources').mkdir()
   try:
    for role,(text,extension)in m.SOURCES.items():
     file=root/'sources'/(role+'.'+extension)
     # Exact original production writer statement: execute real Windows text IO.
     with file.open('x',encoding='ascii')as f:f.write(text)
     self.assertEqual(file.read_bytes(),text.encode('ascii').replace(b'\n',b'\r\n'))
     with self.assertRaisesRegex(ValueError,'^COMPILE_TU_CHANGED$'):self.actual_tu_guard(root,role)
   finally:
    self.assertEqual(m.no_links(root),root);self.assertEqual(root.parent,parent);self.assertEqual((root.lstat().st_dev,root.lstat().st_ino),(before.st_dev,before.st_ino))
 def run_writer_only(self,root):
  # Real run() writes all fixed TUs; deny the Job loader before any Win32 import.
  with patch.object(m,'profile',return_value={'files':[]}),patch.object(m,'verified_sources',return_value={}),patch.object(m,'observer',return_value=object()),patch.object(m.platform,'machine',return_value='ARM64'),patch.object(m.sys,'platform','win32'),patch.dict(m.sys.modules,{m.__name__:m}),patch.object(m.importlib.util,'spec_from_file_location',side_effect=RuntimeError('TEST_STOP_BEFORE_JOB'))as loader:
   result=m.run(root)
  return result,loader.call_count
 def test_actual_binary_writer_passes_unchanged_guard_for_all_four_tus(self):
  parent=Path(tempfile.gettempdir()).resolve()
  with tempfile.TemporaryDirectory(dir=parent)as folder:
   root=Path(folder).resolve();before=root.lstat();(root/'sources').mkdir()
   try:
    result,loads=self.run_writer_only(root);self.assertEqual(result,1);self.assertEqual(loads,1)
    for role,(text,extension)in m.SOURCES.items():
     self.assertEqual((root/'sources'/(role+'.'+extension)).read_bytes(),text.encode('ascii'))
     self.actual_tu_guard(root,role)
    report=json.loads((root/'compile-result.json').read_bytes());self.assertFalse(report['success']);self.assertFalse(report['basicCompilerCapabilityProven']);self.assertFalse(report['compilerTranslationUnitAttempted'])
   finally:
    self.assertEqual(m.no_links(root),root);self.assertEqual(root.parent,parent);self.assertEqual((root.lstat().st_dev,root.lstat().st_ino),(before.st_dev,before.st_ino))
 def test_actual_binary_writer_refuses_existing_destination_without_job_or_overwrite(self):
  parent=Path(tempfile.gettempdir()).resolve()
  with tempfile.TemporaryDirectory(dir=parent)as folder:
   root=Path(folder).resolve();before=root.lstat();(root/'sources').mkdir();file=root/'sources/c.c';file.write_bytes(b'existing-owned-fixture')
   try:
    result,loads=self.run_writer_only(root);self.assertEqual(result,1);self.assertEqual(loads,0);self.assertEqual(file.read_bytes(),b'existing-owned-fixture')
    with self.assertRaisesRegex(ValueError,'^COMPILE_TU_CHANGED$'):self.actual_tu_guard(root,'c')
   finally:
    self.assertEqual(m.no_links(root),root);self.assertEqual(root.parent,parent);self.assertEqual((root.lstat().st_dev,root.lstat().st_ino),(before.st_dev,before.st_ino))


class FakeOwnedApi:
 def __init__(self):self.events=[];self.ids=[20];self.opens=[];self.closed=[];self.birth=101;self.member_changed=False;self.creation_changed=False;self.child_identity_calls=0;self.child_member_calls=0;self.image_value='C:/private-not-retained/vctip.exe';self.image_failure=None;self.close_ok=True;self.open_ok=True;self.snapshot_value=None;self.on_open=None
 def identity(self,handle):
  self.events.append('identity:'+str(handle))
  if handle=='root':return(10,100)
  self.child_identity_calls+=1;pid=int(handle.split('-')[1]);return(pid,self.birth+(1 if self.creation_changed and self.child_identity_calls>1 else 0))
 def member(self,handle,job):
  self.events.append('member:'+str(handle));assert job=='job'
  if handle=='root':return True
  self.child_member_calls+=1;return not(self.member_changed and self.child_member_calls>1)
 def snapshot(self,job):self.events.append('snapshot');assert job=='job';return self.snapshot_value if self.snapshot_value is not None else(len(self.ids),len(self.ids),list(self.ids))
 def open(self,pid):
  self.events.append('open');self.opens.append(pid)
  if self.on_open:self.on_open()
  return'child-'+str(pid)if self.open_ok else None
 def image(self,handle):
  self.events.append('image')
  if self.image_failure:raise self.image_failure
  return self.image_value
 def close(self,handle):self.events.append('close');self.closed.append(handle);return self.close_ok

class OwnedObservationTests(unittest.TestCase):
 def observer(self,api=None,clock=lambda:0):
  api=api or FakeOwnedApi();value=m.OwnedMemberObservation(api,clock);value('job','root',10,'100');return api,value
 def test_full_original_protocol_and_backend_unchanged(self):
  raw=without_owned_observer(Path(__file__).with_name('compile.py').read_bytes());self.assertEqual(m.sha(raw),'9c0b95b20aacf43f5eeb19932f6bdfe86f75bd2a6a669daf8837212465a686c3')
  self.assertEqual(m.sha(Path(__file__).with_name('job.py').read_bytes()),'e24c0f7d598b0297d59d09258b87ba57911ac3075470b9a37c53018572083770')
  tree=ast.parse(Path(__file__).with_name('job.py').read_bytes());run=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='run_job')
  calls=[n for n in ast.walk(run)if isinstance(n,ast.Call)]
  bind=next(n for n in calls if isinstance(n.func,ast.Name)and n.func.id=='_test_observe')
  resume=next(n for n in calls if isinstance(n.func,ast.Name)and n.func.id=='resume')
  before=next(n for n in calls if isinstance(n.func,ast.Attribute)and n.func.attr=='before_cleanup')
  children=next(n for n in calls if isinstance(n.func,ast.Name)and n.func.id=='observed_process_handles')
  terminate=next(n for n in calls if isinstance(n.func,ast.Name)and n.func.id=='terminate_job')
  quiet=next(n for n in ast.walk(run)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='quiet_deadline'for t in n.targets))
  self.assertLess(bind.lineno,resume.lineno);self.assertLess(quiet.lineno,before.lineno);self.assertLess(before.lineno,children.lineno);self.assertLess(before.lineno,terminate.lineno)
 def test_creation_bound_owned_member_and_closed_image_classification(self):
  api,value=self.observer();value.before_cleanup(30);data=value.report();self.assertTrue(data['complete']);self.assertTrue(data['withinExistingCleanupDeadline']);self.assertTrue(data['handlesClosed']);self.assertEqual(data['reportedCount'],1)
  row=data['members'][0];self.assertEqual((row['pid'],row['creation']),(20,'101'));self.assertTrue(row['identityVerified']);self.assertTrue(row['memberBefore']);self.assertTrue(row['memberAfter']);self.assertEqual(row['imageClass'],'msvc-vctip-name');self.assertFalse(data['imageAuthentication']);self.assertEqual(api.closed,['child-20']);self.assertNotIn('private-not-retained',json.dumps(data))
 def test_unbound_or_root_identity_mismatch_never_opens_member(self):
  for bind in [False,True]:
   api=FakeOwnedApi();value=m.OwnedMemberObservation(api,lambda:0)
   if bind:value('job','root',11,'100')
   value.before_cleanup(30);self.assertFalse(value.report()['bound']);self.assertFalse(value.report()['complete']);self.assertEqual(api.opens,[]);self.assertNotIn('snapshot',api.events)
 def test_partial_duplicate_overcount_lists_never_open_process(self):
  for snapshot in [(2,1,[20]),(9,9,list(range(20,29))),(2,2,[20,20]),(1,1,[True])]:
   api,value=self.observer();api.snapshot_value=snapshot;value.before_cleanup(30);self.assertEqual(value.report()['error'],'OBSERVER_LIST_BOUND');self.assertEqual(api.opens,[])
 def test_creation_or_membership_change_remains_unknown_and_closes_handle(self):
  for mode in ['old-birth','birth-change','membership-before','membership-after']:
   api,value=self.observer()
   if mode=='old-birth':api.birth=99
   if mode=='birth-change':api.creation_changed=True
   if mode=='membership-before':api.child_member_calls=1;api.member_changed=True
   if mode=='membership-after':api.member_changed=True
   value.before_cleanup(30);row=value.report()['members'][0];self.assertFalse(row['identityVerified']);self.assertIsNone(row['pid']);self.assertIsNone(row['creation']);self.assertEqual(row['imageClass'],'unknown');self.assertEqual(api.closed,['child-20'])
   if mode in ['old-birth','membership-before']:self.assertNotIn('image',api.events)
 def test_nonmember_snapshot_pid_never_queries_foreign_identity_or_image(self):
  api,value=self.observer();api.child_member_calls=1;api.member_changed=True;value.before_cleanup(30)
  self.assertEqual(api.child_identity_calls,0);self.assertNotIn('image',api.events);self.assertEqual(api.closed,['child-20']);row=value.report()['members'][0];self.assertFalse(row['identityVerified']);self.assertIsNone(row['pid']);self.assertIsNone(row['creation']);self.assertEqual(row['imageClass'],'unknown');self.assertEqual(row['error'],'OBSERVER_MEMBERSHIP_MISMATCH')
 def test_open_unavailable_and_unknown_or_failed_image_never_leak_path(self):
  api,value=self.observer();api.open_ok=False;value.before_cleanup(30);self.assertEqual(api.closed,[]);self.assertEqual(value.report()['members'][0]['error'],'OBSERVER_OPEN_UNAVAILABLE')
  for image,error in [('C:/private-unique/unlisted-owned.exe',None),('X'*32768,None),(None,OSError('PRIVATE-EXCEPTION-MUST-NOT-LEAK'))]:
   api,value=self.observer();api.image_value=image;api.image_failure=error;value.before_cleanup(30);data=value.report();row=data['members'][0];self.assertTrue(row['identityVerified']);self.assertEqual(row['pid'],20);self.assertIn(row['imageClass'],['unclassified','unknown']);self.assertNotIn('private-unique',json.dumps(data));self.assertNotIn('PRIVATE-EXCEPTION',json.dumps(data));self.assertEqual(api.closed,['child-20'])
 def test_same_cleanup_budget_exhaustion_closes_open_handle_without_retry(self):
  api,value=self.observer();value.before_cleanup(.01);self.assertEqual(api.opens,[]);self.assertNotIn('snapshot',api.events);self.assertEqual(value.report()['error'],'OBSERVER_BUDGET')
  clock=[0];api,value=self.observer(clock=lambda:clock[0]);api.on_open=lambda:clock.__setitem__(0,2);value.before_cleanup(30);self.assertEqual(api.opens,[20]);self.assertEqual(api.closed,['child-20']);self.assertNotIn('image',api.events);self.assertEqual(value.report()['error'],'OBSERVER_BUDGET')
 def test_maximum_eight_rows_and_one_snapshot_only(self):
  api,value=self.observer();api.ids=list(range(20,28));value.before_cleanup(30);self.assertEqual(len(value.report()['members']),8);self.assertLessEqual(len(json.dumps({'roles':[{'job':{'ownedMemberObservation':value.report()}}]},indent=2).encode()),8192);self.assertTrue(value.report()['complete']);opened=list(api.opens);value.before_cleanup(30);self.assertEqual(api.opens,opened);self.assertFalse(value.report()['complete']);self.assertEqual(value.report()['error'],'OBSERVER_SNAPSHOT_REPEATED')
 def test_metadata_bound_fails_closed_without_private_payload(self):
  api,value=self.observer();value.before_cleanup(30);value.data['unexpected-private-payload']='PRIVATE'*2000;report=value.report();self.assertEqual(report['error'],'OBSERVER_REPORT_BOUND');self.assertFalse(report['complete']);self.assertNotIn('PRIVATE',json.dumps(report));self.assertLess(len(json.dumps(report)),8192)
 def test_repeated_bind_and_empty_snapshot_never_expand_authority(self):
  api,value=self.observer();value('foreign','other',999,'1');value.before_cleanup(30);self.assertEqual(api.opens,[]);self.assertFalse(value.report()['bound']);self.assertEqual(value.report()['error'],'OBSERVER_BIND_REPEATED')
  api,value=self.observer();api.ids=[];value.before_cleanup(30);self.assertTrue(value.report()['complete']);self.assertEqual(value.report()['members'],[]);self.assertEqual(api.opens,[])
 def test_invalid_root_creation_and_deadline_are_closed_unknown(self):
  for creation in ['0','-1','1'*21,'not-private',True]:
   api=FakeOwnedApi();value=m.OwnedMemberObservation(api,lambda:0);value('job','root',10,creation);value.before_cleanup(30);self.assertFalse(value.report()['bound']);self.assertEqual(api.opens,[])
  for deadline in [float('nan'),float('inf'),True,-1]:
   api,value=self.observer();value.before_cleanup(deadline);self.assertEqual(api.opens,[]);self.assertEqual(value.report()['error'],'OBSERVER_BUDGET')
 def test_close_failure_is_separate_and_no_raw_error_escapes(self):
  api,value=self.observer();api.close_ok=False
  with self.assertRaisesRegex(ValueError,'^OBSERVER_CLOSE_FAILED$'):value.before_cleanup(30)
  self.assertFalse(value.report()['handlesClosed']);self.assertFalse(value.report()['complete']);self.assertEqual(api.closed,['child-20'])
 def test_real_caller_parent_receipt_preserves_original_descendants_verdict_and_bytes(self):
  api=FakeOwnedApi();events=[];held={};observation_class=m.OwnedMemberObservation
  class Parent:
   parent_creation='50';exit_observed=False
   def __init__(self,event):pass
   def close(self):events.append('parent-close')
  tree=ast.parse(Path(__file__).with_name('job.py').read_bytes());function=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='write_parent_receipt');scope={'Path':Path,'json':json};exec(compile(ast.Module(body=[function],type_ignores=[]),'<actual-parent-receipt-writer>','exec'),scope)
  def run_job(argv,root,output,seconds,**kwargs):
   observer=kwargs['_test_observe'];observer('job','root',10,'100');events.append('bound-before-resume');proof={'success':False,'outcome':'descendants-left','rootExit':0,'cleanupVerified':True,'activeAtEnd':0,'rootReaped':True,'logReadersStopped':True};held['proof']=proof;events.append('original-verdict');observer.before_cleanup(30);events.append('original-cleanup');output.mkdir(parents=True);raw=(json.dumps(proof)+'\n').encode();(output/'receipt.json').write_bytes(raw);held['original']=raw;return proof
  fake=types.SimpleNamespace(ParentCancel=Parent,run_job=run_job,write_parent_receipt=scope['write_parent_receipt']);spec=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module:None))
  parent=Path(tempfile.gettempdir()).resolve()
  with tempfile.TemporaryDirectory(dir=parent)as folder:
   root=Path(folder).resolve();before=root.lstat();(root/'sources').mkdir()
   try:
    with patch.object(m,'profile',return_value={'files':[],'python':{'path':'not-executed-owned-python'}}),patch.object(m,'BOUND_CONTEXT_DIGEST','a'*64),patch.object(m,'verified_sources',return_value={}),patch.object(m,'observer',return_value=object()),patch.object(m.platform,'machine',return_value='ARM64'),patch.object(m.sys,'platform','win32'),patch.dict(m.sys.modules,{m.__name__:m}),patch.object(m.importlib.util,'spec_from_file_location',return_value=spec),patch.object(m.importlib.util,'module_from_spec',return_value=fake),patch.object(m,'OwnedMemberApi',return_value=api),patch.object(m,'OwnedMemberObservation',side_effect=lambda adapter:observation_class(adapter,lambda:0)):
     self.assertEqual(m.run(root),1)
    original=(root/'jobs/c/receipt.json').read_bytes();self.assertEqual(original,held['original']);receipt=json.loads((root/'jobs/c/parent-receipt.json').read_bytes());self.assertEqual(receipt['originalJobOutcome'],'descendants-left');self.assertEqual(receipt['originalJobRootExit'],0);self.assertFalse(receipt['success']);self.assertEqual(receipt['originalJobReceipt']['sha256'],m.sha(original));self.assertTrue(receipt['ownedMemberObservation']['complete']);self.assertEqual(events,['bound-before-resume','original-verdict','original-cleanup','parent-close']);report=json.loads((root/'compile-result.json').read_bytes());self.assertFalse(report['success']);self.assertEqual(len(report['roles']),1)
   finally:self.assertEqual(m.no_links(root),root);self.assertEqual(root.parent,parent);self.assertEqual((root.lstat().st_dev,root.lstat().st_ino),(before.st_dev,before.st_ino))

if __name__=='__main__':unittest.main()
