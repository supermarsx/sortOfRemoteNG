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
from unittest.mock import patch

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
  observed=[];code,raw,errors=m.collect(['fixed-not-executed'],Path.cwd(),{},launch=lambda *args,**kwargs:Child(),on_started=observed.append)
  self.assertEqual(code,23);self.assertEqual(raw,b'fixed compiler diagnostic\n');self.assertEqual(errors,[]);self.assertEqual(observed,[123])
 def test_real_collector_bounds_output_and_preserves_owned_kill_failure(self):
  class Child:
   pid=123
   stdout=io.BytesIO(b'x'*(1048576+1))
   def poll(self):return None
   def kill(self):raise OSError('owned-mock-only')
   def wait(self,timeout):raise TimeoutError()
  code,raw,errors=m.collect(['fixed-not-executed'],Path.cwd(),{},launch=lambda *args,**kwargs:Child())
  self.assertIsNone(code);self.assertLessEqual(len(raw),1048576);self.assertIn('COMPILE_OUTPUT_CAP',errors);self.assertIn('COMPILE_OWN_CHILD_KILL_FAILED',errors);self.assertIn('COMPILE_OWN_CHILD_UNKNOWN',errors)
 def test_bigobj_native_machine_and_truncation(self):
  raw=bytearray(96);raw[:4]=b'\0\0\xff\xff';struct.pack_into('<HH',raw,4,2,0xaa64);struct.pack_into('<I',raw,44,1);raw[56:61]=b'.text'
  self.assertEqual(m.coff(raw)['machine'],0xaa64)
  with self.assertRaises(ValueError):m.coff(raw[:48])

if __name__=='__main__':unittest.main()
