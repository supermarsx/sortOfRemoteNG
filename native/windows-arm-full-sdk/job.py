"""Closed tool-observer Job derivative; importing performs declarations, not a tool launch."""
import argparse
import hashlib
import ctypes as C
from ctypes import wintypes as W
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import signal
import threading
import sys
import time

K = C.WinDLL("kernel32", use_last_error=True)
SIZE = C.c_size_t
HANDLE = W.HANDLE
class BasicLimits(C.Structure):
    _fields_ = [("process_time", C.c_int64), ("job_time", C.c_int64), ("flags", W.DWORD),
                ("min_ws", SIZE), ("max_ws", SIZE), ("active_limit", W.DWORD),
                ("affinity", SIZE), ("priority", W.DWORD), ("scheduling", W.DWORD)]
class IoCounters(C.Structure):
    _fields_ = [(name, C.c_uint64) for name in ("reads", "writes", "other", "read_bytes", "write_bytes", "other_bytes")]
class ExtendedLimits(C.Structure):
    _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory", SIZE),
                ("job_memory", SIZE), ("peak_process", SIZE), ("peak_job", SIZE)]
class CpuRate(C.Structure):
    _fields_ = [("flags", W.DWORD), ("rate", W.DWORD)]
class Accounting(C.Structure):
    _fields_ = [(n, C.c_int64) for n in ("user", "kernel", "period_user", "period_kernel")] + [
        (n, W.DWORD) for n in ("faults", "total", "active", "terminated")]
class Startup(C.Structure):
    _fields_ = [("cb", W.DWORD), ("reserved", W.LPWSTR), ("desktop", W.LPWSTR), ("title", W.LPWSTR)] + [
        (n, W.DWORD) for n in ("x", "y", "width", "height", "x_chars", "y_chars", "fill", "flags")] + [
        ("show", W.WORD), ("reserved_size", W.WORD), ("reserved_bytes", C.POINTER(C.c_ubyte)),
        ("stdin", HANDLE), ("stdout", HANDLE), ("stderr", HANDLE)]
class StartupEx(C.Structure):
    _fields_ = [("startup", Startup), ("attributes", C.c_void_p)]
class ProcessInfo(C.Structure):
    _fields_ = [("process", HANDLE), ("thread", HANDLE), ("pid", W.DWORD), ("tid", W.DWORD)]


def declare(name, result, args):
    fn = getattr(K, name)
    fn.restype, fn.argtypes = result, args
    return fn

create_job = declare("CreateJobObjectW", HANDLE, [C.c_void_p, W.LPCWSTR])
set_job = declare("SetInformationJobObject", W.BOOL, [HANDLE, C.c_int, C.c_void_p, W.DWORD])
query_job = declare("QueryInformationJobObject", W.BOOL, [HANDLE, C.c_int, C.c_void_p, W.DWORD, C.c_void_p])
assign = declare("AssignProcessToJobObject", W.BOOL, [HANDLE, HANDLE])
terminate_job = declare("TerminateJobObject", W.BOOL, [HANDLE, W.UINT])
terminate_process = declare("TerminateProcess", W.BOOL, [HANDLE, W.UINT])
close = declare("CloseHandle", W.BOOL, [HANDLE])
wait = declare("WaitForSingleObject", W.DWORD, [HANDLE, W.DWORD])
resume = declare("ResumeThread", W.DWORD, [HANDLE])
exit_code = declare("GetExitCodeProcess", W.BOOL, [HANDLE, C.POINTER(W.DWORD)])
process_times = declare("GetProcessTimes", W.BOOL, [HANDLE] + [C.POINTER(W.FILETIME)] * 4)
set_handle = declare("SetHandleInformation", W.BOOL, [HANDLE, W.DWORD, W.DWORD])
init_attrs = declare("InitializeProcThreadAttributeList", W.BOOL, [C.c_void_p, W.DWORD, W.DWORD, C.POINTER(SIZE)])
update_attrs = declare("UpdateProcThreadAttribute", W.BOOL, [C.c_void_p, W.DWORD, SIZE, C.c_void_p, SIZE, C.c_void_p, C.c_void_p])
delete_attrs = declare("DeleteProcThreadAttributeList", None, [C.c_void_p])
open_process = declare("OpenProcess", HANDLE, [W.DWORD, W.BOOL, W.DWORD])
is_in_job = declare("IsProcessInJob", W.BOOL, [HANDLE, HANDLE, C.POINTER(W.BOOL)])
create_process = declare("CreateProcessW", W.BOOL, [W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p,
    W.BOOL, W.DWORD, C.c_void_p, W.LPCWSTR, C.POINTER(StartupEx), C.POINTER(ProcessInfo)])


def checked(ok, stage):
    if not ok:
        error = OSError(C.get_last_error(), stage)
        error.stage = stage
        raise error


def active(job):
    info = Accounting()
    checked(query_job(job, 1, C.byref(info), C.sizeof(info), None), "query-job")
    return info.active


def observed_process_handles(job):
    class ProcessList(C.Structure):
        _fields_ = [("assigned", W.DWORD), ("count", W.DWORD), ("ids", SIZE * 128)]
    processes = ProcessList()
    checked(query_job(job, 3, C.byref(processes), C.sizeof(processes), None), "query-job-pids")
    checked(processes.count <= 128, "bounded-job-pids")
    handles = []
    try:
        for pid in processes.ids[:processes.count]:
            handle = open_process(0x100000 | 0x1000, False, pid)
            if not handle:
                # A fully exited process is absent; any other failure denies quiescence.
                checked(C.get_last_error() == 87, "open-owned-job-child")
                continue
            belongs = W.BOOL()
            try:
                checked(is_in_job(handle, job, C.byref(belongs)), "verify-child-job")
                checked(belongs.value, "child-job-identity")
            except BaseException:
                close(handle)
                raise
            handles.append(handle)
        return handles
    except BaseException:
        for handle in handles:
            close(handle)
        raise


def remaining_ms(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        error = OSError(1460, "cleanup-deadline")
        error.stage = "cleanup-deadline"
        raise error
    return max(1, int(remaining * 1000))


def wait_until(handle, deadline, stage, *, wait_fn=wait):
    checked(wait_fn(handle, remaining_ms(deadline)) == 0, stage)


def environment():
    # Fixed diagnostic environment; absolute tool roles only, no ambient tool paths.
    scratch=Path.cwd();root=Path(__file__).resolve().parents[2]/'.artifacts'
    import re
    if scratch.parent!=root or re.fullmatch(r'windows-arm-full-sdk-[a-f0-9-]{36}',scratch.name)is None:raise ValueError('benign-scratch-scope')
    for file in (scratch,scratch/'tmp',scratch/'home'):
        if file.resolve()!=file or file.is_symlink()or not file.is_dir():raise ValueError('benign-scratch-alias')
        for parent in (file,*file.parents):
            if parent.is_symlink()or getattr(parent.lstat(),'st_file_attributes',0)&0x400:raise ValueError('benign-scratch-link')
    return {'SystemRoot':'C:/Windows','WINDIR':'C:/Windows','PATH':'C:/Windows/System32','TEMP':str(scratch/'tmp'),'TMP':str(scratch/'tmp'),'USERPROFILE':str(scratch/'home'),'PYTHONDONTWRITEBYTECODE':'1'}



class CancelledBeforeRun(Exception):
    pass


def readback_policy(job):
    limits=ExtendedLimits();cpu=CpuRate()
    checked(query_job(job,9,C.byref(limits),C.sizeof(limits),None),'readback-job-limits')
    checked(query_job(job,15,C.byref(cpu),C.sizeof(cpu),None),'readback-cpu-policy')
    if limits.basic.flags!=(0x2000|0x200|0x8)or limits.basic.active_limit!=8 or limits.job_memory!=512*1024**2 or cpu.flags!=5 or cpu.rate!=2500:raise OSError('prototype-policy-mismatch')
    return {'flags':limits.basic.flags,'activeProcessLimit':limits.basic.active_limit,'jobMemoryBytes':str(limits.job_memory),'cpuFlags':cpu.flags,'cpuRate':cpu.rate,'inheritedHandles':3,'affinityChanged':False}

def run_job(argv, cwd, output, seconds, *, cancel=None, _test_fault=None, cap=64 * 1024 * 1024, _test_cleanup_seconds=None, _test_observe=None):
    """Creation-time containment; return original result plus separate cleanup proof."""
    if not argv or not Path(argv[0]).is_absolute() or not (0 < seconds <= 21600) or not (0 < cap <= 64 * 1024 * 1024):
        raise ValueError("invalid-controlled-command")
    role = approved_tool_command(argv,cwd)
    if Path(output)!=Path(cwd)/'jobs'/role:raise ValueError('tool-output-scope')
    output = Path(output)
    output.mkdir(parents=False, exist_ok=False)
    result = {"kind": "owned-job-proof", "started": False, "assignedBeforeResume": False, "resumed": False,
              "jobCreated": False, "handleListOnly": True, "outcome": "launcher-failure", "rootExit": None,
              "cleanupVerified": False, "activeAtEnd": None}
    atomic_suite = True  # Every diagnostic role uses the proven creation-attribute branch.
    result["assignmentMode"] = "creation-attribute" if atomic_suite else "suspended-manual"
    started = time.monotonic()
    job = attrs = None
    pi = ProcessInfo()
    files = []
    readers = []
    log_bytes = [0]
    log_lock = threading.Lock()
    log_cap = threading.Event()
    log_failure = threading.Event()
    def capture(read_fd, filename):
        try:
            with os.fdopen(read_fd, "rb", buffering=0) as stream, open(filename, "xb", buffering=0) as log:
                while True:
                    chunk = stream.read(65536)
                    if not chunk:
                        break
                    with log_lock:
                        remaining = max(0, cap - log_bytes[0])
                        log.write(chunk[:remaining])
                        log_bytes[0] += min(len(chunk), remaining)
                        if len(chunk) > remaining:
                            log_cap.set()
        except OSError:
            log_failure.set()
    try:
        if cancel is not None and cancel.is_set():
            raise CancelledBeforeRun()
        job = create_job(None, None)
        checked(job, "create-job")
        result["jobCreated"]=True
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000 | 0x200 | 0x8  # kill-on-close, job memory, active-process limit
        limits.basic.active_limit = 8
        limits.job_memory = 512 * 1024 ** 2
        checked(set_job(job, 9, C.byref(limits), C.sizeof(limits)), "job-limits")
        cpu = CpuRate(1 | 4, 2500 if _test_fault != "policy" else 10001)
        checked(set_job(job, 15, C.byref(cpu), C.sizeof(cpu)), "cpu-policy")
        result['policyReadback']=readback_policy(job)
        files.append(open(os.devnull, "rb", buffering=0))
        for name in ("stdout.log", "stderr.log"):
            read_fd, write_fd = os.pipe()
            files.append(os.fdopen(write_fd, "wb", buffering=0))
            reader = threading.Thread(target=capture, args=(read_fd, output / name), daemon=True)
            readers.append(reader)
            reader.start()
        handles = (HANDLE * 3)(*[msvcrt.get_osfhandle(f.fileno()) for f in files])
        for h in handles:
            checked(set_handle(h, 1, 1), "inherit-explicit-handle")
        size = SIZE()
        attribute_count = 2 if atomic_suite else 1
        init_attrs(None, attribute_count, 0, C.byref(size))
        buffer = C.create_string_buffer(size.value)
        attrs = C.cast(buffer, C.c_void_p)
        checked(init_attrs(attrs, attribute_count, 0, C.byref(size)), "init-handle-list")
        checked(update_attrs(attrs, 0, 0x20002, handles, C.sizeof(handles), None, None), "explicit-handle-list")
        if atomic_suite:
            checked(set_handle(job,1,0),'job-noninheritable')
            info=W.DWORD();get_handle=declare('GetHandleInformation',W.BOOL,[HANDLE,C.POINTER(W.DWORD)])
            checked(get_handle(job,C.byref(info)),'read-job-handle-flags')
            checked(info.value&1==0,'job-handle-not-inherited')
            checked(all(int(h)!=int(job)for h in handles),'job-not-stdio-handle')
            job_list=(HANDLE*1)(job)
            checked(update_attrs(attrs,0,0x2000D,job_list,C.sizeof(job_list),None,None),'atomic-suite-job-list')
            result['jobHandleInheritable']=False;result['jobHandleInStdioAllowlist']=False
        si = StartupEx()
        si.startup.cb, si.startup.flags = C.sizeof(si), 0x100
        si.startup.stdin, si.startup.stdout, si.startup.stderr = handles
        si.attributes = attrs
        env = C.create_unicode_buffer("\0".join(k + "=" + v for k, v in sorted(environment().items(), key=lambda kv: kv[0].upper())) + "\0\0")
        command = C.create_unicode_buffer(subprocess.list2cmdline([str(a) for a in argv]))
        if cancel is not None and cancel.is_set():
            raise CancelledBeforeRun()
        checked(create_process(str(argv[0]), command, None, None, True,
                               0x4 | 0x80000 | 0x08000000 | 0x400, env, str(cwd), C.byref(si), C.byref(pi)), "create-suspended")
        for f in files:
            f.close()  # The only remaining pipe writers belong to the suspended owned process.
        result["started"] = True
        result["rootPid"] = pi.pid
        creation, ending, kernel, user = [W.FILETIME() for _ in range(4)]
        checked(process_times(pi.process, C.byref(creation), C.byref(ending), C.byref(kernel), C.byref(user)), "root-creation-time")
        result["rootCreationFiletime"] = str((creation.dwHighDateTime << 32) | creation.dwLowDateTime)
        if atomic_suite:
            inside=W.BOOL();is_in=declare('IsProcessInJob',W.BOOL,[HANDLE,HANDLE,C.POINTER(W.BOOL)])
            checked(is_in(pi.process,job,C.byref(inside))and inside.value,'verify-atomic-suite-membership')
            result['assignedAtCreationVerified']=True
        else:
            checked(assign(None if _test_fault == "assignment" else job, pi.process), "assign-before-resume")
        result["assignedBeforeResume"] = True
        if _test_observe is not None:_test_observe(job,pi.process,pi.pid,result['rootCreationFiletime'])
        if cancel is not None and cancel.is_set():
            raise CancelledBeforeRun()
        checked(resume(pi.thread) != 0xFFFFFFFF, "resume-owned-root")
        result["resumed"] = True
        result["outcome"] = "running"
        while True:
            if cancel is not None and cancel.is_set():
                result["outcome"] = "cancelled"
                break
            if time.monotonic() - started >= seconds:
                result["outcome"] = "deadline"
                break
            if log_failure.is_set() or log_cap.is_set():
                result["outcome"] = "log-failure" if log_failure.is_set() else "output-cap"
                break
            state = wait(pi.process, 50)
            checked(state != 0xFFFFFFFF, "wait-root")
            if state == 0:
                code = W.DWORD()
                checked(exit_code(pi.process, C.byref(code)), "root-exit")
                result["rootExit"] = code.value
                result["outcome"] = "success" if code.value == 0 else "compiler-failure"
                quiet_deadline = time.monotonic() + 2
                while active(job) and time.monotonic() < quiet_deadline:
                    time.sleep(0.025)
                if active(job):
                    result["outcome"] = "descendants-left" if code.value == 0 else "compiler-failure"
                break
    except CancelledBeforeRun:
        result["outcome"] = "cancelled"
    except OSError as exc:
        # Fixed stage identifiers and numeric OS code only; never raw command/environment.
        result["failureStage"], result["winerror"] = getattr(exc, "stage", "launcher-io"), exc.errno
        result["outcome"] = "launcher-failure"
    finally:
        cleanup_deadline = time.monotonic() + (30 if _test_cleanup_seconds is None else _test_cleanup_seconds)
        try:
            if _test_observe is not None and hasattr(_test_observe,'before_cleanup'):
                try:_test_observe.before_cleanup(cleanup_deadline);result['observerStopped']=True
                except Exception:result['observerStopped']=False;result['observerFailure']='OWNED_OBSERVER_NOT_CLOSED'
            if pi.process and not result["assignedBeforeResume"]:
                checked(terminate_process(pi.process, 125), "terminate-suspended-owned-root")
                wait_until(pi.process, cleanup_deadline, "reap-suspended-owned-root")
            if job:
                children = observed_process_handles(job)
                try:
                    if active(job):
                        checked(terminate_job(job, 124), "terminate-owned-job")
                    for child in children:
                        wait_until(child, cleanup_deadline, "reap-owned-job-child")
                    result["observedChildrenReaped"] = len(children)
                finally:
                    for child in children:
                        close(child)
                while active(job):
                    time.sleep(min(.025, remaining_ms(cleanup_deadline) / 1000))
                result["activeAtEnd"] = active(job)
                result["cleanupVerified"] = result["activeAtEnd"] == 0
            if not job:
                result["cleanupVerified"] = not result["started"]
                result["activeAtEnd"] = 0 if not result["started"] else None
            if pi.process:
                wait_until(pi.process, cleanup_deadline, "reap-owned-root")
                result["rootReaped"] = True
                code = W.DWORD()
                checked(exit_code(pi.process, C.byref(code)), "final-root-exit")
                result["finalRootExit"] = code.value
        except OSError as exc:
            result["cleanupFailureStage"], result["cleanupWinerror"] = getattr(exc, "stage", "launcher-io"), exc.errno
            result["cleanupVerified"] = False
        if attrs:
            delete_attrs(attrs)
        for handle in (pi.thread, pi.process, job):
            if handle:
                close(handle)
        for f in files:
            f.close()
        for reader in readers:
            reader.join(timeout=max(0, cleanup_deadline - time.monotonic()))
        result["cleanupBudgetMs"] = 30000 if _test_cleanup_seconds is None else int(_test_cleanup_seconds * 1000)
        result["logReadersStopped"] = all(not reader.is_alive() for reader in readers)
        result["capturedBytes"] = log_bytes[0]
        result["outputCapBytes"] = cap
        if not result["logReadersStopped"] or log_failure.is_set():
            result["cleanupVerified"] = False
        if log_cap.is_set() and result["outcome"] == "success":
            result["outcome"] = "output-cap"
        result["elapsedMs"] = int((time.monotonic() - started) * 1000)
        result["success"] = result["outcome"] == "success" and result["cleanupVerified"] and result.get("observerStopped",True)
        (output / "receipt.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result



# Explicit derivative: original ABI/kernel/lifecycle code above; closed tools admission below.
PROFILE_SHA = "8a472f84e39ffda2334c535bb5422881d73e10011570fe079f1b6dd2a8d8764f"
def load_profile():
    p=Path(__file__).with_name('profile.json')
    for item in (p,*p.parents):
        if item.is_symlink() or getattr(item.lstat(),'st_file_attributes',0)&0x400:raise ValueError('TOOLS_PROFILE_LINK')
    if p.stat().st_size>65536:raise ValueError('TOOLS_PROFILE_BOUND')
    with p.open('rb') as stream:raw=stream.read(65537)
    if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=PROFILE_SHA:raise ValueError('TOOLS_PROFILE_PIN')
    return json.loads(raw)

def approved_tool_command(argv,cwd):
    from producer import closed_worker_command, verified_sources
    role=closed_worker_command(argv,cwd,load_profile())
    verified_sources(Path(cwd))
    environment()
    return role

class ParentCancel:
    def __init__(self,event):
        self.event=event;self.handle=None;self.exit_observed=False
        self.open=declare('OpenProcess',HANDLE,[W.DWORD,W.BOOL,W.DWORD]);self.current=declare('GetCurrentProcess',HANDLE,[])
        self.handle=self.open(0x00100000|0x1000,False,os.getppid())
        if not self.handle:raise ValueError('parent-handle-unavailable')
        try:
            parent_creation=self.creation(self.handle);own_creation=self.creation(self.current())
            if parent_creation>own_creation or wait(self.handle,0)!=258:raise ValueError('parent-identity-unavailable')
            self.parent_creation=str(parent_creation)
        except BaseException:self.close();raise
    @staticmethod
    def creation(handle):
        fields=[W.FILETIME()for _ in range(4)]
        checked(process_times(handle,*[C.byref(x)for x in fields]),'parent-creation')
        return (fields[0].dwHighDateTime<<32)|fields[0].dwLowDateTime
    def is_set(self):
        if self.event.is_set():return True
        value=wait(self.handle,0)
        if value not in (0,258):raise OSError('parent-observation-failed')
        if value==0:self.exit_observed=True
        return value==0
    def close(self):
        if self.handle:checked(close(self.handle),'close-parent-handle');self.handle=None

def write_parent_receipt(output,result):
    import hashlib
    output=Path(output);raw=output/'receipt.json';final=output/'parent-receipt.json'
    for item in (raw,*raw.parents):
        if item.is_symlink()or getattr(item.lstat(),'st_file_attributes',0)&0x400:raise ValueError('parent-receipt-link')
    if output.resolve()!=output or not raw.is_file()or raw.stat().st_nlink!=1 or not 0<raw.stat().st_size<=1024**2:raise ValueError('parent-receipt-scope')
    with raw.open('rb')as stream:data=stream.read(1024**2+1)
    if len(data)>1024**2:raise ValueError('parent-receipt-bound')
    original=json.loads(data);result['originalJobReceipt']={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()};result['originalJobOutcome']=original.get('outcome');result['originalJobRootExit']=original.get('rootExit')
    with final.open('x',encoding='utf8')as stream:json.dump(result,stream,indent=2);stream.write('\n')

def run_observation(role,cwd,seconds):
    from observe import worker_argv
    profile=load_profile()
    if role not in profile['programs'] or not 0<seconds<=20:raise ValueError('TOOLS_ROLE')
    argv=worker_argv(role,cwd,profile)
    output=Path(cwd)/'jobs'/role
    parent=ParentCancel(threading.Event());result=None
    try:
        result=run_job(argv,cwd,output,seconds,cancel=parent,cap=65536)
        result['parentCreationFiletime']=parent.parent_creation
        result['parentExitObserved']=parent.exit_observed
    finally:
        try:
            parent.close()
            if result is not None:result['parentHandleClosed']=True
        except Exception:
            if result is None:raise
            result['parentHandleClosed']=False;result['success']=False
        if result is not None:write_parent_receipt(output,result)
    return result

if __name__=='__main__':
    raise SystemExit('TOOLS_NO_DIRECT_ENTRY')
