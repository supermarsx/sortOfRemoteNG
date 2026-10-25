"""Closed native ARM compiler capability; never executes generated programs."""
import contextlib
import hashlib
import importlib.util
import json
import ntpath
import os
from pathlib import Path
import platform
import re
import stat
import struct
import subprocess
import sys
import threading
import time
import types

PROFILE_SHA='e627ccce5b05733a73be68f58d7d6522850ca6a13fad5913c4ac0c62771b05a7'
ROLES=('c','stl','atl','mfc','link-c','link-stl','link-atl')
BOUND_CONTEXT_DIGEST=None
OBSERVER=None
OBSERVER_SHA='617da082669864f58b2830d4ff9e7df0a02b6de20a4e47593be3e59b1cd55449'
SOURCES={
 'c':('#include <Windows.h>\n#include <string.h>\nint main(void){SYSTEM_INFO x;GetSystemInfo(&x);return _stricmp("owned","OWNED")+(x.dwNumberOfProcessors==0);}\n','c'),
 'stl':('#include <vector>\n#include <numeric>\nint main(){std::vector<int> x{1,2,3};return std::accumulate(x.begin(),x.end(),0)-6;}\n','cpp'),
 'atl':('#include <atlbase.h>\n#include <atlstr.h>\nint main(){ATL::CStringW x(L"owned");return x.CompareNoCase(L"OWNED");}\n','cpp'),
 'mfc':('#include <afxwin.h>\nint main(){CStringW x(L"owned");return x.GetLength()!=5;}\n','cpp'),
}
def need(value,code):
 if not value:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def bounded(path,cap):
 path=no_links(path);info=path.lstat();need(stat.S_ISREG(info.st_mode)and info.st_size<=cap,'COMPILE_FILE_BOUND');helper=observer()
 with path.open('rb')as f:
  fd_before=os.fstat(f.fileno());helper.verify_open_identity(info,fd_before);raw=f.read(cap+1)
  helper.verify_snapshots(info,fd_before,path.lstat(),os.fstat(f.fileno()))
 need(len(raw)<=cap,'COMPILE_FILE_BOUND');return raw
# BEGIN owned Job metadata observer (no lifecycle authority).
class OwnedMemberApi:
 """Bindings are created only after the maintained native Job module is loaded."""
 def __init__(self,job):
  self.j=job
  self.get_pid=job.declare('GetProcessId',job.W.DWORD,[job.HANDLE])
  self.get_image=job.declare('QueryFullProcessImageNameW',job.W.BOOL,[job.HANDLE,job.W.DWORD,job.W.LPWSTR,job.C.POINTER(job.W.DWORD)])
 def identity(self,handle):
  j=self.j;pid=int(self.get_pid(handle));fields=[j.W.FILETIME()for _ in range(4)]
  need(pid>0 and j.process_times(handle,*[j.C.byref(x)for x in fields]),'OBSERVER_IDENTITY_UNAVAILABLE')
  return pid,(fields[0].dwHighDateTime<<32)|fields[0].dwLowDateTime
 def member(self,handle,job):
  value=self.j.W.BOOL();need(self.j.is_in_job(handle,job,self.j.C.byref(value)),'OBSERVER_MEMBERSHIP_UNAVAILABLE');return bool(value.value)
 def snapshot(self,job):
  j=self.j
  class ProcessList(j.C.Structure):
   _fields_=[('assigned',j.W.DWORD),('count',j.W.DWORD),('ids',j.SIZE*8)]
  value=ProcessList();need(j.query_job(job,3,j.C.byref(value),j.C.sizeof(value),None),'OBSERVER_LIST_UNAVAILABLE')
  need(value.count<=8,'OBSERVER_LIST_BOUND');return int(value.assigned),int(value.count),list(value.ids[:value.count])
 def open(self,pid):return self.j.open_process(0x100000|0x1000,False,pid)
 def image(self,handle):
  j=self.j;buffer=j.C.create_unicode_buffer(32768);size=j.W.DWORD(32768)
  need(self.get_image(handle,0,buffer,j.C.byref(size))and 0<size.value<32768,'OBSERVER_IMAGE_UNAVAILABLE')
  return buffer[:size.value]
 def close(self,handle):return bool(self.j.close(handle))

class OwnedMemberObservation:
 """One creation-bound metadata snapshot; no process controls, grace or retries."""
 ERRORS=frozenset(('OBSERVER_NOT_BOUND','OBSERVER_BIND_REPEATED','OBSERVER_SNAPSHOT_REPEATED','OBSERVER_IDENTITY_UNAVAILABLE','OBSERVER_IDENTITY_MISMATCH','OBSERVER_MEMBERSHIP_UNAVAILABLE','OBSERVER_MEMBERSHIP_MISMATCH','OBSERVER_LIST_UNAVAILABLE','OBSERVER_LIST_BOUND','OBSERVER_OPEN_UNAVAILABLE','OBSERVER_IMAGE_UNAVAILABLE','OBSERVER_BUDGET','OBSERVER_CLOCK','OBSERVER_CLOSE_FAILED','OBSERVER_API_UNAVAILABLE'))
 IMAGE_NAMES={'python.exe':'python-name','pythonw.exe':'python-name','cl.exe':'msvc-driver-name','c1.exe':'msvc-c-front-end-name','c1xx.exe':'msvc-cpp-front-end-name','c2.exe':'msvc-back-end-name','link.exe':'msvc-linker-name','cvtres.exe':'msvc-resource-name','mspdbsrv.exe':'msvc-pdb-service-name','vctip.exe':'msvc-vctip-name'}
 def __init__(self,api,clock=time.monotonic):
  self.api=api;self.clock=clock;self.job=None;self.root=None;self.birth=None;self.calls=0;self.end=None
  self.data={'kind':'owned-job-member-metadata','bound':False,'rootPid':None,'rootCreation':None,'snapshotAttempted':False,'complete':False,'members':[],'error':None,'handlesClosed':True,'imageAuthentication':False,'elapsedMs':None,'withinExistingCleanupDeadline':False}
 @staticmethod
 def _integer(value,maximum):return isinstance(value,int)and not isinstance(value,bool)and 0<value<=maximum
 def _identity(self,value):
  need(isinstance(value,tuple)and len(value)==2 and self._integer(value[0],0xffffffff)and self._integer(value[1],0xffffffffffffffff),'OBSERVER_IDENTITY_UNAVAILABLE');return value
 @classmethod
 def _code(cls,error):
  value=error.args[0]if isinstance(error,ValueError)and len(error.args)==1 else None
  return value if isinstance(value,str)and value in cls.ERRORS else'OBSERVER_API_UNAVAILABLE'
 def _fail(self,code):
  if self.data['error']is None:self.data['error']=code
  self.data['complete']=False
 def _now(self):
  value=self.clock();need(isinstance(value,(int,float))and not isinstance(value,bool)and 0<=value<1e20,'OBSERVER_CLOCK');return value
 def _budget(self):need(self._now()<self.end,'OBSERVER_BUDGET')
 def _invoke(self,method,*args):self._budget();return method(*args)
 def __call__(self,job,root,pid,creation):
  self.calls+=1
  try:
   need(self.calls==1,'OBSERVER_BIND_REPEATED')
   need(job and root and self._integer(pid,0xffffffff)and isinstance(creation,str)and 1<=len(creation)<=20 and creation.isascii()and creation.isdecimal(),'OBSERVER_IDENTITY_UNAVAILABLE')
   birth=int(creation);need(self._integer(birth,0xffffffffffffffff),'OBSERVER_IDENTITY_UNAVAILABLE')
   need(self._identity(self.api.identity(root))==(pid,birth),'OBSERVER_IDENTITY_MISMATCH')
   need(self.api.member(root,job)is True,'OBSERVER_MEMBERSHIP_MISMATCH')
   need(self._identity(self.api.identity(root))==(pid,birth),'OBSERVER_IDENTITY_MISMATCH')
   self.job,self.root,self.birth=job,root,birth;self.data.update(bound=True,rootPid=pid,rootCreation=creation)
  except Exception as error:self.data['bound']=False;self.job=self.root=None;self._fail(self._code(error))
 def _row(self,pid):
  row={'snapshotIndex':len(self.data['members']),'pid':None,'creation':None,'memberBefore':None,'memberAfter':None,'identityVerified':False,'imageClass':'unknown','imageNameOnly':True,'handleOpened':False,'handleClosed':None,'error':None};handle=None
  try:
   handle=self._invoke(self.api.open,pid);need(handle,'OBSERVER_OPEN_UNAVAILABLE');row['handleOpened']=True
   row['memberBefore']=self._invoke(self.api.member,handle,self.job)is True;need(row['memberBefore'],'OBSERVER_MEMBERSHIP_MISMATCH')
   first=self._identity(self._invoke(self.api.identity,handle));need(first[0]==pid and first[1]>=self.birth and(pid!=self.data['rootPid']or first[1]==self.birth),'OBSERVER_IDENTITY_MISMATCH')
   classification='unknown'
   try:
    image=self._invoke(self.api.image,handle);need(isinstance(image,str)and 0<len(image)<32768 and '\0'not in image,'OBSERVER_IMAGE_UNAVAILABLE')
    classification=self.IMAGE_NAMES.get(ntpath.basename(image).lower(),'unclassified')
   except BaseException as error:row['error']=self._code(error);self._fail(row['error'])
   final=self._identity(self._invoke(self.api.identity,handle));need(final==first,'OBSERVER_IDENTITY_MISMATCH')
   row['memberAfter']=self._invoke(self.api.member,handle,self.job)is True;need(row['memberAfter'],'OBSERVER_MEMBERSHIP_MISMATCH');self._budget()
   row.update(pid=pid,creation=str(first[1]),identityVerified=True,imageClass=classification)
  except BaseException as error:row['error']=self._code(error);self._fail(row['error'])
  finally:
   if handle:
    try:row['handleClosed']=self.api.close(handle)is True
    except BaseException:row['handleClosed']=False
    if not row['handleClosed']:self.data['handlesClosed']=False;self._fail('OBSERVER_CLOSE_FAILED');row['error']=row['error']or'OBSERVER_CLOSE_FAILED'
  self.data['members'].append(row)
 def before_cleanup(self,deadline):
  started=None
  try:
   need(not self.data['snapshotAttempted'],'OBSERVER_SNAPSHOT_REPEATED');self.data['snapshotAttempted']=True
   need(self.data['bound']and self.job and self.root,'OBSERVER_NOT_BOUND')
   started=self._now();need(isinstance(deadline,(int,float))and not isinstance(deadline,bool)and 0<deadline<1e20 and deadline-started>.05,'OBSERVER_BUDGET')
   self.end=min(deadline,started+1);self.data['withinExistingCleanupDeadline']=self.end<=deadline
   need(self._identity(self._invoke(self.api.identity,self.root))==(self.data['rootPid'],self.birth),'OBSERVER_IDENTITY_MISMATCH')
   value=self._invoke(self.api.snapshot,self.job);self._budget()
   need(isinstance(value,tuple)and len(value)==3,'OBSERVER_LIST_BOUND');assigned,count,pids=value
   need(type(assigned)is int and type(count)is int and 0<=assigned<=8 and count==assigned and isinstance(pids,list)and len(pids)==count and all(self._integer(p,0xffffffff)for p in pids)and len(set(pids))==len(pids),'OBSERVER_LIST_BOUND')
   self.data['reportedCount']=count
   for pid in pids:self._budget();self._row(pid)
   self._budget();self.data['complete']=self.data['error']is None and all(r['identityVerified']and r['handleClosed']for r in self.data['members'])
  except BaseException as error:self._fail(self._code(error))
  finally:
   self.job=self.root=None
   if started is not None:
    try:self.data['elapsedMs']=max(0,int((self._now()-started)*1000))
    except BaseException:self._fail('OBSERVER_CLOCK')
  if not self.data['handlesClosed']:raise ValueError('OBSERVER_CLOSE_FAILED')
 def report(self):
  raw=json.dumps(self.data,ensure_ascii=True,indent=2).encode('ascii')
  # Reserve eight indentation columns plus fixed envelope text for the caller.
  if len(raw)+8*raw.count(b'\n')+128>8192:return {'kind':'owned-job-member-metadata','bound':self.data['bound'],'complete':False,'members':[],'handlesClosed':self.data['handlesClosed'],'error':'OBSERVER_REPORT_BOUND','imageAuthentication':False}
  return json.loads(raw)
# END owned Job metadata observer.

def profile():
 raw=bounded(Path(__file__).with_name('profile.json'),32768);need(sha(raw)==PROFILE_SHA,'COMPILE_PROFILE_PIN');return json.loads(raw)
def repo():return Path(__file__).resolve().parents[2]
def no_links(path):
 path=Path(path);need(path.is_absolute()and path.resolve()==path,'COMPILE_PATH')
 for p in (path,*path.parents):need(not p.is_symlink()and not getattr(p.lstat(),'st_file_attributes',0)&0x400,'COMPILE_LINK')
 return path
def observer():
 global OBSERVER
 if OBSERVER is not None:return OBSERVER
 source=repo()/'native/windows-arm-native-tools/observe.py'
 no_links(source)
 with source.open('rb')as f:raw=f.read(131073)
 need(len(raw)<=131072 and sha(raw)==OBSERVER_SHA,'COMPILE_OBSERVER')
 module=types.ModuleType('original_arm_observer');module.__file__=str(source);exec(compile(raw,str(source),'exec'),module.__dict__);OBSERVER=module;return module
def verified_sources(root,bind=False,expected=None):
 global BOUND_CONTEXT_DIGEST
 root=no_links(root);raw=bounded(root/'context.json',131072);digest=sha(raw)
 if expected is not None:need(digest==expected,'COMPILE_CONTEXT_CHANGED')
 if not bind:need(BOUND_CONTEXT_DIGEST==digest,'COMPILE_CONTEXT_CHANGED')
 p=profile();value=json.loads(raw)
 need(value['kind']=='sorng-windows-arm-native-compile-context'and value['image']==p['image'],'COMPILE_CONTEXT')
 need(value['repository']=='supermarsx/sortOfRemoteNG'and value['workflow']=='.github/workflows/windows-arm-native-compile.yml','COMPILE_AUTHORITY')
 need(value['repositoryId']=='1010282954'and value['visibility']=='public'and value['event']=='workflow_dispatch'and value['ref']=='refs/heads/'+value['defaultBranch'],'COMPILE_AUTHORITY')
 need(re.fullmatch('[1-9][0-9]*',value['runId'])is not None and re.fullmatch('[1-9][0-9]*',value['attempt'])is not None,'COMPILE_RUN')
 need(re.fullmatch('[a-f0-9]{40}',value['head'])is not None and value['workflowSha']==value['head'],'COMPILE_HEAD')
 need([row['path']for row in value['sources']]==p['sourcePaths'],'COMPILE_SOURCE_SET')
 provision=bounded(root/'fresh-provision.json',1048576);need(len(provision)==value['freshProvision']['bytes']and sha(provision)==value['freshProvision']['sha256'],'COMPILE_PROVISION_CHANGED')
 observed=json.loads(provision);need(observed['target']=='aarch64-pc-windows-msvc'and observed['completed']is True and observed['engineBuildAttempted']is False,'COMPILE_PROVISION')
 for index,row in enumerate(value['sources']):
  data=bounded(no_links(root/'source-inputs'/str(index)),2*1024**2)
  need(len(data)==row['bytes']and sha(data)==row['sha256'],'COMPILE_SOURCE_PIN')
  need(bounded(no_links(repo()/row['path']),2*1024**2)==data,'COMPILE_LIVE_SOURCE')
 if bind:BOUND_CONTEXT_DIGEST=digest
 return value
def worker_argv(role,root,p):
 need(role in ROLES and BOUND_CONTEXT_DIGEST is not None,'COMPILE_ROLE')
 return [p['python']['path'],'-I','-B',str(Path(__file__).resolve()),'--worker',role,str(root),BOUND_CONTEXT_DIGEST]
def closed_worker_command(argv,root,p):
 need(len(argv)==8 and argv[5]in ROLES and argv==worker_argv(argv[5],Path(root),p),'COMPILE_COMMAND')
 need(Path(root)==Path.cwd(),'COMPILE_CWD');return argv[5]
def tool(p,name):return next(row for row in p['files']if row['role']==p['programs'][name])['path']
def compiler_environment(root,p):
 root=Path(root)
 return {'SystemRoot':'C:/Windows','WINDIR':'C:/Windows','PATH':str(Path(tool(p,'cl')).parent)+';C:/Windows/System32',
  'TEMP':str(root/'tmp'),'TMP':str(root/'tmp'),'USERPROFILE':str(root/'home'),'INCLUDE':';'.join(p['includes']),
  'LIB':';'.join(p['libraries']),'VSLANG':'1033','CL':'','_CL_':'','LINK':'','_LINK_':''}
def compiler_argv(role,root,p):
 need(role in ROLES,'COMPILE_ROLE');root=Path(root)
 if role.startswith('link-'):
  name=role[5:]
  return [tool(p,'link'),'/NOLOGO','/MACHINE:ARM64','/SUBSYSTEM:CONSOLE','/INCREMENTAL:NO','/VERBOSE:LIB',
   '/OUT:'+str(root/'bin'/(name+'.exe')),'/MAP:'+str(root/'maps'/(name+'.map')),str(root/'objects'/(name+'.obj')),'kernel32.lib']
 text,extension=SOURCES[role]
 args=[tool(p,'cl'),'/nologo','/c','/MT','/W4','/WX','/showIncludes','/DUNICODE','/D_UNICODE','/Fo'+str(root/'objects'/(role+'.obj'))]
 if extension=='cpp':args+=['/EHsc','/std:c++20']
 return args+[str(root/'sources'/(role+'.'+extension))]
def coff(raw):
 need(20<=len(raw)<=8*1024**2,'COMPILE_COFF_BOUND')
 if raw[:4]==b'\0\0\xff\xff':
  need(len(raw)>=56 and struct.unpack_from('<H',raw,4)[0]>=2,'COMPILE_BIGOBJ');machine=struct.unpack_from('<H',raw,6)[0];count=struct.unpack_from('<I',raw,44)[0];offset=56
 else:machine,count=struct.unpack_from('<HH',raw,0);offset=20+struct.unpack_from('<H',raw,16)[0]
 need(machine==0xaa64 and 0<count<=65536 and offset+count*40<=len(raw),'COMPILE_COFF_MACHINE')
 defaults=[]
 for n in range(count):
  h=raw[offset+n*40:offset+(n+1)*40]
  if h[:8].rstrip(b'\0')!=b'.drectve':continue
  size,start=struct.unpack_from('<II',h,16);need(size<=1048576 and start+size<=len(raw),'COMPILE_DIRECTIVE_BOUND')
  text=raw[start:start+size].rstrip(b'\0 ').decode('ascii','strict')
  for name in re.findall(r'/DEFAULTLIB:(?:"([^"]+)"|([^\s]+))',text,re.I):
   value=name[0]or name[1];need(re.fullmatch(r'[A-Za-z0-9_+.-]{1,80}',value)is not None and '..'not in value,'COMPILE_DEFAULTLIB');defaults.append(value)
 need(len(defaults)<=128,'COMPILE_DEFAULTLIB_COUNT');return {'machine':machine,'defaultLibraries':sorted(set(defaults))}
def archive_machines(raw):
 need(raw.startswith(b'!<arch>\n')and len(raw)<=32*1024**2,'COMPILE_ARCHIVE_BOUND');position=8;count=0;machines={};unknown=0
 while position<len(raw):
  need(position+60<=len(raw),'COMPILE_ARCHIVE_HEADER');header=raw[position:position+60];need(header[58:60]==b'`\n','COMPILE_ARCHIVE_HEADER')
  value=header[48:58].strip();need(value.isdigit(),'COMPILE_ARCHIVE_SIZE');size=int(value);start=position+60;need(start+size<=len(raw),'COMPILE_ARCHIVE_MEMBER')
  name=header[:16].strip();member=raw[start:start+size]
  if name not in(b'/',b'//',b'/SYM64/'):
   count+=1;need(count<=200000,'COMPILE_ARCHIVE_COUNT');machine=struct.unpack_from('<H',member,6 if member[:4]==b'\0\0\xff\xff'else 0)[0]if len(member)>=20 else 0
   if machine in(0xaa64,0xa641,0xa64e,0x8664,0x14c):machines[str(machine)]=machines.get(str(machine),0)+1
   else:unknown+=1
  position=start+size+(size&1)
 need(position==len(raw),'COMPILE_ARCHIVE_TAIL');return {'members':count,'machineCounts':machines,'unknownHeaderMembers':unknown,'allMembersArm64Claimed':False}
def pe(raw):
 need(64<=len(raw)<=8*1024**2 and raw[:2]==b'MZ','COMPILE_PE_BOUND');offset=struct.unpack_from('<I',raw,60)[0]
 need(64<=offset<=1048576 and offset+264<=len(raw)and raw[offset:offset+4]==b'PE\0\0','COMPILE_PE_HEADER')
 machine,count=struct.unpack_from('<HH',raw,offset+4);optional=struct.unpack_from('<H',raw,offset+20)[0];base=offset+24
 need(machine==0xaa64 and 1<=count<=96 and optional>=240 and base+optional+count*40<=len(raw)and struct.unpack_from('<H',raw,base)[0]==0x20b,'COMPILE_PE_MACHINE')
 def read(rva,size):
  for n in range(count):
   h=base+optional+n*40;va,rawsize,pointer=struct.unpack_from('<III',raw,h+12)
   if va<=rva and rva-va+size<=rawsize:
    start=pointer+rva-va;need(start+size<=len(raw),'COMPILE_PE_RVA');return start
  raise ValueError('COMPILE_PE_RVA')
 imports=[];rva,size=struct.unpack_from('<II',raw,base+120)
 need(size<=20*128,'COMPILE_IMPORT_BOUND')
 if rva:
  need(size>=20,'COMPILE_IMPORT_BOUND')
  for n in range(128):
   need((n+1)*20<=size,'COMPILE_IMPORT_BOUND')
   at=read(rva+20*n,20);entry=raw[at:at+20]
   if entry==b'\0'*20:break
   name_rva=struct.unpack_from('<I',entry,12)[0];name_at=read(name_rva,1);end=raw.find(b'\0',name_at,name_at+257)
   need(end>=name_at,'COMPILE_IMPORT_NAME');name=raw[name_at:end].decode('ascii','strict');need(re.fullmatch(r'[A-Za-z0-9_.-]{1,256}',name)is not None,'COMPILE_IMPORT_NAME');imports.append(name)
  else:raise ValueError('COMPILE_IMPORT_COUNT')
 return {'machine':machine,'importLibraries':imports,'executed':False}
def scoped_dependency(value,roots):
 need(isinstance(value,str)and len(value)<=4096 and re.fullmatch(r'[A-Za-z]:[\\/].+',value)is not None and value.count(':')==1 and not any(ord(c)<32 for c in value),'COMPILE_DEPENDENCY_PATH')
 need(not any(p in('.','..')for p in value.replace('\\','/').split('/'))and ntpath.normpath(value).casefold()==value.replace('/','\\').casefold(),'COMPILE_DEPENDENCY_PATH')
 normalized=os.path.normpath(value);need(Path(normalized).is_absolute()and '..'not in Path(value).parts,'COMPILE_DEPENDENCY_PATH')
 lower=normalized.casefold();need(any(lower.startswith(os.path.normpath(root).casefold()+os.sep)for root in roots),'COMPILE_DEPENDENCY_SCOPE');return no_links(Path(normalized))
def dependencies(text,root,p,role):
 rows=[];paths=set();roots=p['libraries']if role.startswith('link-')else p['includes']
 if role.startswith('link-'):
  observed=re.findall(r'^\s*Searching (.+\.lib):\s*$',text,re.M|re.I)
 else:observed=re.findall(r'^Note: including file:\s*(.+?)\s*$',text,re.M)
 need(observed,'COMPILE_DEPENDENCIES_MISSING');maximum=128 if role.startswith('link-')else 2048;total=0
 for value in observed:
  path=scoped_dependency(value,roots)
  if str(path).casefold()in paths:continue
  paths.add(str(path).casefold());need(len(paths)<=maximum,'COMPILE_DEPENDENCY_COUNT');raw=bounded(path,32*1024**2);total+=len(raw)
  need(total<=p['limits']['libraryBytes'if role.startswith('link-')else'headerBytes'],'COMPILE_DEPENDENCY_BYTES')
  row={'path':str(path),'bytes':len(raw),'sha256':sha(raw),'historicallyPinned':any(str(path).casefold()==r['path'].casefold()for r in p['files'])}
  if role.startswith('link-')and raw.startswith(b'!<arch>\n'):row['archive']=archive_machines(raw)
  rows.append(row)
 return rows
def collect(argv,root,env,launch=subprocess.Popen,on_started=None):
 child=launch(argv,cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
 if on_started is not None:on_started(child.pid)
 chunks=[];size=[0];failure=[]
 def reader():
  try:
   while True:
    block=child.stdout.read(65536)
    if not block:break
    size[0]+=len(block)
    if size[0]>1048576:failure.append('COMPILE_OUTPUT_CAP');break
    chunks.append(block)
  except Exception:failure.append('COMPILE_OUTPUT_READER')
 thread=threading.Thread(target=reader);thread.start();end=time.monotonic()+85
 while child.poll()is None and not failure and time.monotonic()<end:time.sleep(.02)
 if child.poll()is None:
  failure.append('COMPILE_PROCESS_UNFINISHED')
  try:child.kill()
  except Exception:failure.append('COMPILE_OWN_CHILD_KILL_FAILED')
 try:code=child.wait(timeout=2)
 except Exception:code=None;failure.append('COMPILE_OWN_CHILD_UNKNOWN')
 thread.join(timeout=2);need(not thread.is_alive(),'COMPILE_READER_UNKNOWN')
 return code,b''.join(chunks),failure
def worker(role,root,expected):
 root=no_links(root);verified_sources(root,bind=True,expected=expected);p=profile();report={'role':role,'phase':'inventory-before','compilerExit':None,'compilerProcessCreated':False,'success':False,'outputExecuted':False}
 try:
  # Re-pin actual installed25 before executing the fixed compiler descendant.
  helper=observer()
  for row in p['files']:
   with helper.held_file(row):pass
  report['phase']='cache-only-signature';program='link'if role.startswith('link-')else'cl';tool_row=next(r for r in p['files']if r['role']==p['programs'][program])
  with helper.held_file(tool_row)as stream:report['signature']=helper.cache_only_trust(tool_row['path'],stream)
  need(report['signature']['verified'],'COMPILE_SIGNATURE')
  if role in SOURCES:
   source,extension=SOURCES[role];need(bounded(root/'sources'/(role+'.'+extension),65536)==source.encode('ascii'),'COMPILE_TU_CHANGED')
   report['translationUnitSha256']=sha(source.encode('ascii'))
  else:
   name=role[5:];previous=json.loads(bounded(root/'results'/(name+'.json'),2*1024**2));obj=bounded(root/'objects'/(name+'.obj'),8*1024**2)
   need(previous['success']and previous['compilerExit']==0 and previous['output']['sha256']==sha(obj),'COMPILE_INPUT_OBJECT_CHANGED')
   report['inputObjectSha256']=sha(obj)
  report['phase']='native-command';argv=compiler_argv(role,root,p);env=compiler_environment(root,p);report['argv']=argv;report['environmentKeys']=sorted(env)
  code,raw,errors=collect(argv,root,env,on_started=lambda pid:report.update(compilerPid=pid,compilerProcessCreated=True));report['compilerExit']=code;report['processFailures']=errors
  with (root/'results'/(role+'.compiler.log')).open('xb')as f:f.write(raw)
  report['compilerOutput']={'bytes':len(raw),'sha256':sha(raw)}
  need(not errors and code==0,'COMPILE_NATIVE_FAILED');text=raw.decode('utf-8','strict')
  report['phase']='output-inspection';output=root/('bin'if role.startswith('link-')else'objects')/((role[5:]if role.startswith('link-')else role)+('.exe'if role.startswith('link-')else'.obj'))
  data=bounded(no_links(output),8*1024**2);need(output.stat().st_nlink==1,'COMPILE_OUTPUT_LINK');report['output']={'relativePath':str(output.relative_to(root)),'bytes':len(data),'sha256':sha(data),'inspection':pe(data)if role.startswith('link-')else coff(data)}
  report['phase']='dependency-observation';report['dependencies']=dependencies(text,root,p,role);report['dependencyObservation']='linker-search-path-files-not-loaded-module-proof'if role.startswith('link-')else'compiler-showIncludes-paths'
  if role.startswith('link-'):
   mapraw=bounded(root/'maps'/(role[5:]+'.map'),4*1024**2);report['map']={'bytes':len(mapraw),'sha256':sha(mapraw)}
  verified_sources(root);report['success']=True;report['phase']='complete'
 except Exception as error:
  text=str(error);report['failure']=text if isinstance(error,ValueError)and re.fullmatch('COMPILE_[A-Z_]{1,60}',text)else'COMPILE_WORKER_DENIED'
 finally:
  data=json.dumps(report,indent=2).encode()
  if len(data)>2*1024**2:
   report={'role':role,'compilerExit':report['compilerExit'],'success':False,'failure':'COMPILE_REPORT_BOUND','dependencyRecordsComplete':False,'outputExecuted':False};data=json.dumps(report).encode()
  with (root/'results'/(role+'.json')).open('xb')as f:f.write(data)
 return 0 if report['success']else 1
def run(root):
 begin=time.monotonic();end=begin+870;root=no_links(root);p=profile();context=verified_sources(root,bind=True)
 need(sys.platform=='win32'and platform.machine().upper()=='ARM64','COMPILE_NATIVE_HOST')
 helper=observer();result={'kind':'sorng-native-arm-compiler-capability','context':context,'phase':'inventory-before','activeRole':None,'roles':[],'success':False,'setupCompatibility':None,'loadedModulesVerified':False,'sdkBuilt':False,'outputExecuted':False,'nativeAcceptance':False,'publicationAllowed':False}
 sys.modules['compile']=sys.modules[__name__]
 try:
  for row in p['files']:
   with helper.held_file(row):pass
  for name,(text,extension)in SOURCES.items():
   with (root/'sources'/(name+'.'+extension)).open('xb')as f:f.write(text.encode('ascii'))
  s=importlib.util.spec_from_file_location('native_compile_owned_job',Path(__file__).with_name('job.py'));job=importlib.util.module_from_spec(s);s.loader.exec_module(job)
  for role in ROLES:
   result['phase']='owned-compile-command';result['activeRole']=role
   verified_sources(root);remaining=end-time.monotonic()-120;need(remaining>3,'COMPILE_DEADLINE')
   parent=job.ParentCancel(threading.Event());proof=None
   try:
    member_observer=OwnedMemberObservation(OwnedMemberApi(job))
    proof=job.run_job(worker_argv(role,root,p),root,root/'jobs'/role,min(87,remaining-3),cancel=parent,cap=1048576,_test_observe=member_observer)
    proof['ownedMemberObservation']=member_observer.report()
    proof['parentCreationFiletime']=parent.parent_creation;proof['parentExitObserved']=parent.exit_observed
   finally:
    try:parent.close();closed=True
    except Exception:closed=False
    if proof is not None:proof['parentHandleClosed']=closed;job.write_parent_receipt(root/'jobs'/role,proof)
   result['roles'].append({'role':role,'job':proof})
   need(proof is not None and proof['success']and proof['cleanupVerified']and proof['activeAtEnd']==0 and proof['rootReaped']and proof['logReadersStopped']and proof['parentHandleClosed'],'COMPILE_JOB_DENIED')
   observed=json.loads(bounded(root/'results'/(role+'.json'),2*1024**2));result['roles'][-1]['observation']=observed;need(observed['success']and observed['compilerExit']==0,'COMPILE_ROLE_DENIED')
  result['success']=True;result['phase']='complete';result['activeRole']=None
 except Exception as error:
  text=str(error);result['failure']=text if isinstance(error,ValueError)and re.fullmatch('COMPILE_[A-Z_]{1,60}',text)else'COMPILE_CAPABILITY_DENIED'
 # Independent final source/input observation even after failure; never replace
 # the original compiler/Job result or read an unsafe still-running output tree.
 result['postSourceVerified']=False;result['post25Verified']=False
 try:
  need(time.monotonic()<end,'COMPILE_DEADLINE');verified_sources(root);result['postSourceVerified']=True
  for row in p['files']:
   need(time.monotonic()<end,'COMPILE_DEADLINE')
   with helper.held_file(row):pass
  result['post25Verified']=True
 except Exception:result['postObservationFailure']='COMPILE_POST_OBSERVATION_DENIED'
 result['success']=result['success']and result['postSourceVerified']and result['post25Verified']
 result['elapsedMs']=int((time.monotonic()-begin)*1000);result['wholeDeadlineAdmission']=time.monotonic()<=begin+900
 result['success']=result['success']and result['wholeDeadlineAdmission']
 result['compilerTranslationUnitAttempted']=True if any(r.get('observation',{}).get('compilerProcessCreated')is True for r in result['roles'])else None if any(r.get('job',{}).get('started')is True for r in result['roles'])else False
 result['basicCompilerCapabilityProven']=result['success']and len(result['roles'])==7
 result['cefClangCompilerVerified']=False;result['fullCefToolchainUsabilityProven']=False
 record=root/'compile-result.json';record.write_text(json.dumps(result,indent=2),encoding='utf8')
 if time.monotonic()>end:
  result['success']=False;result['basicCompilerCapabilityProven']=False;result['finalBudgetFailure']='COMPILE_FINAL_WORK_DEADLINE';record.write_text(json.dumps(result,indent=2),encoding='utf8')
 return 0 if result['success']else 1
if __name__=='__main__':
 try:
  if len(sys.argv)==5 and sys.argv[1]=='--worker'and sys.argv[2]in ROLES:raise SystemExit(worker(sys.argv[2],Path(sys.argv[3]),sys.argv[4]))
  need(len(sys.argv)==3 and sys.argv[1]=='--run','COMPILE_ARGUMENTS');raise SystemExit(run(Path(sys.argv[2])))
 except Exception:print('COMPILE_ENTRY_DENIED');raise SystemExit(1)
