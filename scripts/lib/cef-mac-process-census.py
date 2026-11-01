"""Scoped Darwin ownership census and fixed native integration fixtures."""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import stat
import struct
import subprocess
import sys
import time

PRODUCTION_CENSUS_ADMITTED = True
ACTIVE_NATIVE_MODE = None
IMAGE = '20260824.0482.1'
PYTHON = '/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
DEVELOPER = '/Applications/Xcode_26.3.app/Contents/Developer'
SDK = DEVELOPER + '/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk'
CLANG = DEVELOPER + '/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang'
PINS = ((PYTHON, 13592, 'b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d'),
        (CLANG, 272034048, '15339439a6be4a9d33d281ec040a7e0092190b1c8d7de5f94d824b50ffae0769'),
        (SDK + '/SDKSettings.json', 7627, '95882a9cea02396e76f3e406a5728269b2a1a11bcd241430a84c9e63d09a6cd3'),
        (SDK + '/usr/lib/libSystem.B.tbd', 337542, '607d9993892c95703a0909ff06f5843058ff1ec30b08337f42ab056d9bf325ea'))
MAX_ROWS = 32768
MAX_OUTPUT = 4 * 1024**2
ROLES = ('root', 'child', 'grandchild', 'launcher', 'detached', 'foreign',
         'busy0', 'busy1', 'busy2', 'busy3')
ABI_FIELDS = ('recordBytes', 'pidOffset', 'pidBytes', 'parentOffset', 'parentBytes',
              'groupOffset', 'groupBytes', 'secondsOffset', 'secondsBytes',
              'microsOffset', 'microsBytes', 'pointerBytes', 'longBytes', 'mib')
NATIVE_ABI = {'recordBytes':648,'pidOffset':40,'pidBytes':4,'parentOffset':560,'parentBytes':4,
              'groupOffset':564,'groupBytes':4,'secondsOffset':0,'secondsBytes':8,
              'microsOffset':8,'microsBytes':4,'pointerBytes':8,'longBytes':8,'mib':[1,14,0,0]}
NATIVE_EVIDENCE = 'ec38df12b8469456d353614e2cb54e486ecc163b5ab15ddcb908b296d6fc1855'
NATIVE_SUPERVISOR_QUALIFICATION = {'runId':41342489672,'artifactId':13097527087,
    'source':'ce297732e385466d4d8fe731e30441408fec6d30',
    'sha256':'43bc3e2bb72dce370e8b35f0e3ab0cf4584ab85f4f66c1b5b336e7df7bfefb3c'}
NATIVE_SOURCES = {'x86_64-apple-darwin':'684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef',
                  'aarch64-apple-darwin':'65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54'}
NATIVE_MAX_WORK_MS = 180*60*1000
NATIVE_MAX_REQUESTS = 43328
NATIVE_UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'

# This executable is an ABI oracle used only by the native scratch proof.
# Production will use reviewed, code-pinned offsets only after separate review.
ORACLE = r'''#define _DARWIN_C_SOURCE 1
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/proc.h>
#include <sys/user.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
int main(int argc, char **argv) {
 if(argc==1) {
  printf("{\"recordBytes\":%zu,\"pidOffset\":%zu,\"pidBytes\":%zu,\"parentOffset\":%zu,\"parentBytes\":%zu,\"groupOffset\":%zu,\"groupBytes\":%zu,\"secondsOffset\":%zu,\"secondsBytes\":%zu,\"microsOffset\":%zu,\"microsBytes\":%zu,\"pointerBytes\":%zu,\"longBytes\":%zu,\"mib\":[%d,%d,%d,0]}\n",
   sizeof(struct kinfo_proc),offsetof(struct kinfo_proc,kp_proc.p_pid),sizeof(((struct kinfo_proc*)0)->kp_proc.p_pid),
   offsetof(struct kinfo_proc,kp_eproc.e_ppid),sizeof(((struct kinfo_proc*)0)->kp_eproc.e_ppid),
   offsetof(struct kinfo_proc,kp_eproc.e_pgid),sizeof(((struct kinfo_proc*)0)->kp_eproc.e_pgid),
   offsetof(struct kinfo_proc,kp_proc.p_starttime.tv_sec),sizeof(((struct kinfo_proc*)0)->kp_proc.p_starttime.tv_sec),
   offsetof(struct kinfo_proc,kp_proc.p_starttime.tv_usec),sizeof(((struct kinfo_proc*)0)->kp_proc.p_starttime.tv_usec),
   sizeof(void*),sizeof(long),CTL_KERN,KERN_PROC,KERN_PROC_ALL);
  return 0;
 }
 if(argc!=3 || strcmp(argv[1],"--identity")) return 2;
 char *end=NULL; errno=0; long pid=strtol(argv[2],&end,10);
 if(errno || !end || *end || pid<=0 || pid>2147483647) return 2;
 int mib[]={CTL_KERN,KERN_PROC,KERN_PROC_PID,(int)pid}; struct kinfo_proc row; size_t n=sizeof(row);
 int result=sysctl(mib,4,&row,&n,NULL,0);
 if(result!=0) return errno==ESRCH ? 3 : 4;
 if(n==0) return 3;
 if(n!=sizeof(row) || row.kp_proc.p_pid!=pid) return 4;
 printf("{\"pid\":%d,\"parent\":%d,\"group\":%d,\"start\":\"darwin-v1:%lld:%lld\"}\n",
  row.kp_proc.p_pid,row.kp_eproc.e_ppid,row.kp_eproc.e_pgid,
  (long long)row.kp_proc.p_starttime.tv_sec,(long long)row.kp_proc.p_starttime.tv_usec);
 return 0;
}
'''


class CensusError(Exception):
    pass


def need(ok, code):
    if not ok:
        raise CensusError(code)


def authority(require_public=True):
    need(sys.platform == 'darwin' and platform.machine() == 'x86_64', 'CENSUS_HOST')
    need(os.environ.get('ImageOS') == 'macos15' and os.environ.get('ImageVersion') == IMAGE, 'CENSUS_IMAGE')
    need(os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
         (not require_public or os.environ.get('GITHUB_ACTIONS') == 'true' and
          os.environ.get('GITHUB_REPOSITORY_VISIBILITY') == 'public'), 'CENSUS_RUNNER')
    need(Path(sys.executable).name == 'python3.14' and Path(sys.executable).is_absolute() and
         Path(sys.executable).resolve(strict=True) == Path(PYTHON).resolve(strict=True), 'CENSUS_PYTHON')


def root_path(raw):
    import re
    root = Path(raw)
    temp = Path(os.environ['RUNNER_TEMP'])
    need(root.is_absolute() and root.parent == temp and root.resolve(strict=True) == root and
         re.fullmatch(r'cef-mac-census-proof-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', root.name), 'CENSUS_ROOT')
    info = root.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and
         stat.S_IMODE(info.st_mode) == 0o700, 'CENSUS_ROOT')
    return root


def identity(info):
    return tuple(getattr(info, k) for k in ('st_dev','st_ino','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_gid'))


def held_pin(path, size, expected, deadline):
    path = Path(path)
    before = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISREG(before.st_mode) and before.st_size == size, 'CENSUS_TOOL_PIN')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(identity(os.fstat(fd)) == identity(before), 'CENSUS_TOOL_CHANGED')
        digest = hashlib.sha256(); total = 0
        while True:
            need(time.monotonic() < deadline, 'CENSUS_DEADLINE')
            block = os.read(fd, min(1024**2, size + 1 - total))
            if not block:
                break
            total += len(block); digest.update(block)
            need(total <= size, 'CENSUS_TOOL_BOUND')
        need(total == size and digest.hexdigest() == expected and
             identity(os.fstat(fd)) == identity(before) == identity(path.lstat()), 'CENSUS_TOOL_CHANGED')
    finally:
        os.close(fd)


def held_bytes(path, maximum):
    path=Path(path);before=path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0 < before.st_size <= maximum and
         path.resolve(strict=True)==path,'CENSUS_OWNED_FILE')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        need(identity(os.fstat(fd))==identity(before),'CENSUS_OWNED_FILE')
        raw=bytearray()
        while len(raw)<=maximum:
            block=os.read(fd,min(65536,maximum+1-len(raw)))
            if not block:break
            raw.extend(block)
        need(len(raw)==before.st_size and len(raw)<=maximum and
             identity(os.fstat(fd))==identity(before)==identity(path.lstat()),'CENSUS_OWNED_FILE')
        return bytes(raw)
    finally:os.close(fd)


def validate_abi(abi):
    need(type(abi) is dict and set(abi) == set(ABI_FIELDS), 'CENSUS_ABI')
    need(all(type(abi[k]) is int for k in ABI_FIELDS if k != 'mib'), 'CENSUS_ABI')
    need(128 <= abi['recordBytes'] <= 1024 and abi['pointerBytes'] == abi['longBytes'] == 8, 'CENSUS_ABI')
    need(type(abi['mib']) is list and len(abi['mib']) == 4 and
         all(type(x) is int and 0 <= x <= 1024 for x in abi['mib']) and abi['mib'][-1] == 0, 'CENSUS_ABI')
    used = set()
    for name in ('pid','parent','group','seconds','micros'):
        offset, width = abi[name+'Offset'], abi[name+'Bytes']
        need(width in (4,8) and (name not in ('pid','parent','group') or width == 4) and
             offset >= 0 and offset + width <= abi['recordBytes'], 'CENSUS_ABI')
        cells = set(range(offset, offset+width))
        need(not cells & used, 'CENSUS_ABI'); used.update(cells)
    return abi


def decode_rows(raw, abi):
    validate_abi(abi)
    size = abi['recordBytes']
    need(type(raw) is bytes and len(raw) % size == 0 and len(raw)//size <= MAX_ROWS, 'CENSUS_ROWS_BOUND')
    rows=[]; seen=set()
    for base in range(0,len(raw),size):
        def number(name):
            return struct.unpack_from('<i' if abi[name+'Bytes']==4 else '<q',raw,base+abi[name+'Offset'])[0]
        pid,parent,group,seconds,micros = [number(n) for n in ('pid','parent','group','seconds','micros')]
        if pid == 0:
            continue
        need(0 < pid <= 2147483647 and 0 <= parent <= 2147483647 and
             0 <= group <= 2147483647 and seconds > 0 and 0 <= micros < 1000000 and pid not in seen,
             'CENSUS_ROWS_IDENTITY')
        seen.add(pid)
        rows.append({'pid':pid,'parent':parent,'group':group,'start':f'darwin-v1:{seconds}:{micros}'})
    need(rows, 'CENSUS_ROWS_EMPTY')
    return rows


class SysctlCensus:
    def __init__(self, abi, libc=None):
        self.abi=validate_abi(abi)
        self.libc=libc or C.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True)
        self.call=self.libc.sysctl
        self.call.argtypes=[C.POINTER(C.c_int),C.c_uint,C.c_void_p,C.POINTER(C.c_size_t),C.c_void_p,C.c_size_t]
        self.call.restype=C.c_int

    def snapshot(self):
        end=time.monotonic()+2
        mib=(C.c_int*4)(*self.abi['mib'])
        maximum=MAX_ROWS*self.abi['recordBytes']
        for attempt in range(2):
            need(time.monotonic()<end,'CENSUS_DEADLINE')
            size=C.c_size_t()
            need(self.call(mib,4,None,C.byref(size),None,0)==0,'CENSUS_SYSCTL')
            need(0 < size.value <= maximum,'CENSUS_ROWS_BOUND')
            # Capacity slack is bounded by the same MAX_ROWS limit, never an
            # unbounded retry or the generic ps one-second sleep loop.
            capacity=min(maximum,size.value+32*self.abi['recordBytes'])
            buffer=C.create_string_buffer(capacity); size=C.c_size_t(capacity)
            result=self.call(mib,4,buffer,C.byref(size),None,0)
            if result == 0:
                need(size.value <= capacity and time.monotonic()<end,'CENSUS_DEADLINE')
                return decode_rows(bytes(buffer[:size.value]),self.abi)
            need(C.get_errno()==12 and attempt==0,'CENSUS_SYSCTL')
        raise CensusError('CENSUS_SYSCTL')


def prepare_source(root):
    end=time.monotonic()+45
    for pin in PINS:
        held_pin(*pin,end)
    need(not list(root.iterdir()),'CENSUS_ROOT_NOT_EMPTY')
    source=root/'abi-oracle.c'
    with source.open('x',encoding='utf-8') as stream:
        os.chmod(source,0o600); stream.write(ORACLE)
    print(json.dumps({'prepared':True,'sourceSha256':hashlib.sha256(ORACLE.encode()).hexdigest(),
                      'productionAdmitted':False}),flush=True)


def compiler_environment(root):
    env={'PATH':'/usr/bin:/bin','HOME':str(root),'TMPDIR':str(root),
         'DEVELOPER_DIR':DEVELOPER,'SDKROOT':SDK,'LC_ALL':'C','TZ':'UTC'}
    if os.environ.get('RUNNER_TRACKING_ID'):env['RUNNER_TRACKING_ID']=os.environ['RUNNER_TRACKING_ID']
    return env


def compile_oracle(root):
    # Node's existing compileSlice owns this entire compiler process lineage,
    # including cc1/ld. No root-only subprocess timeout can certify cleanup.
    source=root/'abi-oracle.c';binary=root/'abi-oracle'
    need(held_bytes(source,16384)==ORACLE.encode(),'CENSUS_ORACLE_SOURCE')
    held_pin(*PINS[1],time.monotonic()+20)
    end=time.monotonic()+5
    while not (root/'compiler-start').exists():
        need(time.monotonic()<end,'CENSUS_COMPILE_GATE');time.sleep(.01)
    need(held_bytes(root/'compiler-start',64)==b'start\n','CENSUS_COMPILE_GATE')
    try:
        subprocess.run([CLANG,'-x','c','-std=c11','-fno-modules','-isysroot',SDK,str(source),'-o',str(binary)],
                       cwd=root,env=compiler_environment(root),stdin=subprocess.DEVNULL,
                       check=True)
    except (subprocess.SubprocessError,OSError):raise CensusError('CENSUS_ORACLE_COMPILE')from None


def read_oracle(root):
    source=root/'abi-oracle.c';binary=root/'abi-oracle'
    need(held_bytes(source,16384)==ORACLE.encode(),'CENSUS_ORACLE_SOURCE')
    binary_sha=hashlib.sha256(held_bytes(binary,2*1024**2)).hexdigest()
    # Node owns and joins the fixed leaf oracle before starting this worker.
    # Killing the census worker must never strand an oracle child process.
    raw=held_bytes(root/'abi-oracle.json',4096)
    receipt=json.loads(raw)
    need(type(receipt)is dict and set(receipt)=={'abi','oracleSha256'} and
         receipt['oracleSha256']==binary_sha,'CENSUS_OWNED_FILE')
    abi=validate_abi(receipt['abi'])
    need(hashlib.sha256(held_bytes(binary,2*1024**2)).hexdigest()==binary_sha,'CENSUS_OWNED_FILE')
    return abi,binary_sha


def worker(root):
    abi,binary_sha=read_oracle(root)
    provider=SysctlCensus(abi)
    print(json.dumps({'kind':'mac-census-proof-ready','abi':abi,'oracleSha256':binary_sha,
                      'productionAdmitted':False},separators=(',',':')),flush=True)
    previous=0
    for line in iter(lambda:sys.stdin.buffer.readline(129),b''):
        need(len(line)<=128 and line.endswith(b'\n'),'CENSUS_REQUEST')
        value=json.loads(line)
        need(type(value)is dict and set(value)=={'request'} and type(value['request'])is int and
             previous < value['request'] <= 10000,'CENSUS_REQUEST')
        previous=value['request']; began=time.monotonic()
        rows=provider.snapshot()
        response=json.dumps({'request':previous,'rows':rows,
                             'collectMicros':max(0,int((time.monotonic()-began)*1000000))},separators=(',',':'))
        need(len(response.encode())<=MAX_OUTPUT,'CENSUS_OUTPUT_BOUND')
        print(response,flush=True)


def native_root(root):
    import re
    root=Path(root);temp=Path(os.environ['RUNNER_TEMP'])
    need(root.is_absolute() and root.resolve(strict=True)==root and root.parent.parent==temp and
         re.fullmatch('cef-mac-census-session-'+NATIVE_UUID,root.name) and
         re.fullmatch('cef-mac-census-(integration|production)-'+NATIVE_UUID,root.parent.name),'CENSUS_ROOT')
    for path in (temp,root.parent,root):
        info=path.lstat()
        need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid==os.geteuid(),'CENSUS_ROOT')
        if path!=temp:need(stat.S_IMODE(info.st_mode)==0o700,'CENSUS_ROOT')
    return root


def native_context(root,raw):
    value=json.loads(raw)
    fields={'kind','mode','target','source','canonicalRoot','image','phase','workMilliseconds',
            'leaseMilliseconds','wallEndMilliseconds','requestBudget','evidence','supervisorEvidence'}
    need(type(value)is dict and set(value)==fields and value['kind']=='mac-census-session' and
         value['mode'] in ('integration-proof','production') and value['target'] in NATIVE_SOURCES and
         value['source']==NATIVE_SOURCES[value['target']] and value['image']==IMAGE and
         value['evidence']==NATIVE_EVIDENCE and value['supervisorEvidence']==NATIVE_SUPERVISOR_QUALIFICATION['sha256'],'CENSUS_ROOT')
    expected='/Users/runner/work/_temp/sorng-cef-engineering/'+value['target']+'/'+value['source']
    need(value['canonicalRoot']==expected,'CENSUS_ROOT')
    need(value['phase'] in ('compile','readonly') and type(value['workMilliseconds'])is int and
         1<=value['workMilliseconds']<=NATIVE_MAX_WORK_MS and
         type(value['leaseMilliseconds'])is int and 1<=value['leaseMilliseconds']<=NATIVE_MAX_WORK_MS+30000 and
         type(value['wallEndMilliseconds'])is int and
         time.time()*1000<value['wallEndMilliseconds']<=time.time()*1000+NATIVE_MAX_WORK_MS+30000 and
         type(value['requestBudget'])is int and
         value['requestBudget']==((value['workMilliseconds']+249)//250+128 if value['phase']=='compile' else 8) and
         value['requestBudget']<=NATIVE_MAX_REQUESTS,'CENSUS_DEADLINE')
    if value['mode']=='production':
        need(PRODUCTION_CENSUS_ADMITTED and root.parent.name.startswith('cef-mac-census-production-'),'CENSUS_UNADMITTED')
        source=Path(expected)
        need(source.resolve(strict=True)==source and stat.S_ISDIR(source.lstat().st_mode) and
             source.lstat().st_uid==os.geteuid() and source.lstat().st_mode&0o700==0o700 and
             source.lstat().st_mode&0o022==0,'CENSUS_ROOT')
    else:need(root.parent.name.startswith('cef-mac-census-integration-'),'CENSUS_ROOT')
    return value


def native_worker(root):
    global ACTIVE_NATIVE_MODE
    root=native_root(root)
    raw=held_bytes(root/'context.json',4096)
    value=native_context(root,raw)
    ACTIVE_NATIVE_MODE=value['mode']
    end=min(time.monotonic()+value['leaseMilliseconds']/1000,
            time.monotonic()+(value['wallEndMilliseconds']/1000-time.time()))
    provider=SysctlCensus(NATIVE_ABI)
    print(json.dumps({'kind':'mac-census-native-ready','abi':NATIVE_ABI,
        'contextSha256':hashlib.sha256(raw).hexdigest(),'productionAdmitted':value['mode']=='production'},separators=(',',':')),flush=True)
    previous=0
    for line in iter(lambda:sys.stdin.buffer.readline(129),b''):
        need(time.monotonic()<end and len(line)<=128 and line.endswith(b'\n'),'CENSUS_DEADLINE')
        request=json.loads(line)
        need(type(request)is dict and set(request)=={'request'} and type(request['request'])is int and
             request['request']==previous+1 and request['request']<=value['requestBudget'],'CENSUS_REQUEST')
        previous=request['request'];began=time.monotonic();rows=provider.snapshot()
        need(time.monotonic()<end,'CENSUS_DEADLINE')
        response=json.dumps({'request':previous,'rows':rows,
            'collectMicros':max(0,int((time.monotonic()-began)*1000000))},separators=(',',':'))
        need(len(response.encode())<=MAX_OUTPUT,'CENSUS_OUTPUT_BOUND');print(response,flush=True)


def integration_actor(root,role):
    import re
    need(role in ('normal','slice-stop','cancel','reparent','worker-timeout','foreign','launcher','detached'),'CENSUS_ROLE')
    root=Path(root);temp=Path(os.environ['RUNNER_TEMP'])
    need(root.parent==temp and root.resolve(strict=True)==root and
         re.fullmatch('cef-mac-census-integration-'+NATIVE_UUID,root.name),'CENSUS_ROOT')
    info=root.lstat();need(stat.S_ISDIR(info.st_mode) and info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==0o700,'CENSUS_ROOT')
    if role=='detached':os.setsid()
    original_parent=os.getppid();stopping=False;children=[]
    def stop(signum,frame):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGTERM,stop)
    def receipt(name,value):
        target=root/(name+'.json');partial=root/(name+'.partial')
        with partial.open('x')as stream:os.chmod(stream.name,0o600);json.dump(value,stream)
        os.rename(partial,target)
    receipt(role,{'pid':os.getpid(),'parent':original_parent,'group':os.getpgrp()})
    env={k:v for k,v in os.environ.items()if k in ('PATH','RUNNER_TEMP','ImageOS','ImageVersion','RUNNER_ENVIRONMENT','RUNNER_TRACKING_ID')}
    def spawn_role(child):
        process=subprocess.Popen([PYTHON,'-I','-B','-S',str(Path(__file__).resolve()),'--integration-actor',str(root),child],cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        children.append(process)
    end=time.monotonic()+60;reparented=False
    try:
        if role=='launcher':spawn_role('detached')
        while not stopping and time.monotonic()<end:
            if role=='detached' and not reparented and os.getppid()!=original_parent:
                receipt('reparented',{'confirmed':True});reparented=True
            if role=='launcher' and (root/'reparent-now').exists():return
            if role not in ('launcher','detached','foreign') and (root/'start').exists():
                need(held_bytes(root/'start',64)==b'start\n','CENSUS_COMPILE_GATE')
                if role=='normal':time.sleep(.3);return
                if role=='reparent' and not children:spawn_role('launcher')
            time.sleep(.025)
    finally:
        if role!='launcher' or not (root/'reparent-now').exists():
            for child in children:
                if child.poll()is None:child.terminate()
            for child in children:
                try:child.wait(timeout=2)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=2)


def actor(root,role):
    need(role in ROLES,'CENSUS_ROLE')
    if role=='detached':
        os.setsid()
    receipt={'pid':os.getpid(),'parent':os.getppid(),'group':os.getpgrp(),'session':os.getsid(0)}
    target=root/('actor-'+role+'.json')
    partial=root/('actor-'+role+'.partial')
    with partial.open('x') as stream:
        os.chmod(stream.name,0o600); json.dump(receipt,stream)
    need(not os.path.lexists(target),'CENSUS_ACTOR_FILE')
    os.rename(partial,target)
    children=[]; stopping=False
    def stop(signum,frame):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGTERM,stop)
    selected=('child','launcher') if role=='root' else ('grandchild',)if role=='child'else ('detached',)if role=='launcher'else ()
    env={key:value for key,value in os.environ.items() if key in
         ('PATH','RUNNER_TEMP','ImageOS','ImageVersion','GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY_VISIBILITY','RUNNER_TRACKING_ID')}
    try:
        for child in selected:
            children.append(subprocess.Popen([PYTHON,'-I','-B','-S',str(Path(__file__).resolve()),'--proof-actor',str(root),child],
                                             cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
        end=time.monotonic()+120
        while not stopping and time.monotonic()<end:
            if role=='launcher' and (root/'orphan-now').exists():
                return # Deliberately observed child is reparented; fixture reaps it by exact start token.
            if role.startswith('busy'):
                for _ in range(20000):
                    hashlib.sha256(b'owned-census-contention').digest()
            else:
                time.sleep(.025)
    finally:
        if role!='launcher' or not (root/'orphan-now').exists():
            for child in children:
                if child.poll() is None:
                    child.terminate()
            for child in children:
                try:child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=2)


def main(args):
    if len(args)==3 and args[0]=='--integration-actor':
        authority(require_public=False);held_pin(*PINS[0],time.monotonic()+2)
        integration_actor(args[1],args[2]);return
    if len(args)==2 and args[0]=='--census-worker':
        authority(require_public=False);held_pin(*PINS[0],time.monotonic()+2)
        native_worker(args[1]);return
    need(len(args) in (2,3) and args[0] in ('--proof-prepare','--proof-compile','--proof-worker','--proof-actor'),'CENSUS_ARGUMENTS')
    authority(require_public=args[0]!='--proof-compile');root=root_path(args[1])
    held_pin(*PINS[0],time.monotonic()+5)
    if args[0]=='--proof-prepare':
        need(len(args)==2,'CENSUS_ARGUMENTS');prepare_source(root)
    elif args[0]=='--proof-compile':
        need(len(args)==2,'CENSUS_ARGUMENTS');compile_oracle(root)
    elif args[0]=='--proof-worker':
        need(len(args)==2,'CENSUS_ARGUMENTS');worker(root)
    else:
        need(len(args)==3,'CENSUS_ARGUMENTS');actor(root,args[2])


if __name__=='__main__':
    try:
        main(sys.argv[1:])
    except BaseException as error:
        code=str(error) if isinstance(error,CensusError) else 'CENSUS_FAILED'
        native=len(sys.argv)>1 and sys.argv[1]=='--census-worker'
        value={'kind':'mac-census-native-failure'if native else'mac-census-proof-failure','code':code,
               'productionAdmitted':ACTIVE_NATIVE_MODE=='production'if native else False}
        if native:value['mode']=ACTIVE_NATIVE_MODE or'unavailable'
        print(json.dumps(value),file=sys.stderr)
        raise SystemExit(1)
