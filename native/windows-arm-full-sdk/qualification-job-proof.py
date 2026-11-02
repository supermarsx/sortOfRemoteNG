"""Inactive proof-only adapter. Importing performs no native declarations or IO."""
import ast
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import sys
import threading
import time
import types

PROFILE_SHA = "51abf0bea1ee6f2b0c36fd436eb4aa6936652c827bad1c9b33e10f6189b7822e"
REPO = Path(__file__).resolve().parents[2]
PROFILE = Path(__file__).with_name("qualification-job-proof-profile.json")
CASES = (
    "six-role-normal", "second-role-nonzero", "session-cancel-after-owned-output",
    "preaborted", "outer-cancel-after-assignment-before-resume",
    "deadline-with-pipe-descendant", "closed-pipe-orphan",
    "reparented-descendant", "bounded-output-failure",
)



# BEGIN bounded controller failure observation
_CONTROLLER_PHASES = frozenset(["entry","profile","authority","arguments","preparation","suite-context","source-witnesses","kernel-import","case-prepare","case-parent","case-run","case-readback","case-complete","source-recheck","scratch-cleanup","complete","success-report"])
_CONTROLLER_CODES = frozenset(["PROOF_ARGV","PROOF_ASSIGN_CANCEL","PROOF_AUTHORITY","PROOF_CASE","PROOF_CASE_ASSIGNMENT","PROOF_CASE_CLEANUP","PROOF_CASE_OBSERVER","PROOF_CASE_OUTCOME","PROOF_CASE_POLICY","PROOF_CASE_RESUME","PROOF_CLEANUP_ABI","PROOF_CLEANUP_BOUND","PROOF_CLEANUP_BYTES","PROOF_CLEANUP_CHANGED","PROOF_CLEANUP_CLOSE","PROOF_CLEANUP_DEPTH","PROOF_CLEANUP_FILE_INFO","PROOF_CLEANUP_LEDGER","PROOF_CLEANUP_OPEN","PROOF_CLEANUP_PARENT","PROOF_CLEANUP_READ","PROOF_CLEANUP_TYPE","PROOF_CLEANUP_UNKNOWN","PROOF_CLOCK","PROOF_CLOCK_DRIFT","PROOF_CLOSE_LEDGER","PROOF_COMMAND","PROOF_CONTEXT","PROOF_CONTEXT_PIN","PROOF_CONTEXT_WRITE","PROOF_DEADLINE","PROOF_ENVIRONMENT","PROOF_FILE","PROOF_FILE_CHANGED","PROOF_FILE_IDENTITY","PROOF_HOST","PROOF_INACTIVE","PROOF_JOB_HANDLE","PROOF_KERNEL_AST","PROOF_KERNEL_RECEIPT","PROOF_LINK","PROOF_NODE_JOIN","PROOF_NODE_OUTCOME","PROOF_NODE_RESULT","PROOF_NORMAL","PROOF_ORPHAN","PROOF_PATH","PROOF_PIN","PROOF_POLICY","PROOF_PREABORT","PROOF_PROFILE","PROOF_REPARENT","PROOF_RESERVE","PROOF_ROLE","PROOF_ROOT","PROOF_ROOT_CHANGED","PROOF_TRACKING"])
_CONTROLLER_STAGES = frozenset(["assign-before-resume","atomic-suite-job-list","bounded-job-pids","child-job-identity","cleanup-deadline","close-parent-handle","cpu-policy","create-job","create-suspended","explicit-handle-list","final-root-exit","inherit-explicit-handle","init-handle-list","job-handle-not-inherited","job-limits","job-noninheritable","job-not-stdio-handle","open-owned-job-child","parent-creation","proof-controller-close","proof-controller-handle","proof-controller-outside","proof-membership","proof-observed-child-close","proof-parent-close","proof-root-creation","query-job","query-job-pids","read-job-handle-flags","readback-cpu-policy","readback-job-limits","reap-owned-job-child","reap-owned-root","reap-suspended-owned-root","resume-owned-root","root-creation-time","root-exit","terminate-owned-job","terminate-suspended-owned-root","verify-atomic-suite-membership","verify-child-job","wait-root"])
_CONTROLLER_NATIVE_REASONS = {
    "parent-handle-unavailable": "NATIVE_PARENT_HANDLE_UNAVAILABLE",
    "parent-identity-unavailable": "NATIVE_PARENT_IDENTITY_UNAVAILABLE",
    "parent-observation-failed": "NATIVE_PARENT_OBSERVATION_FAILED",
    "prototype-policy-mismatch": "NATIVE_POLICY_MISMATCH",
}
_controller_observation = {"phase": "entry", "case": None, "completedCases": 0}


def _observe_controller(phase, case=None, completed=0):
    # Observation only: no paths, probes, clocks, assertions or authority.
    try:
        if phase in _CONTROLLER_PHASES and (case is None or case in CASES) and type(completed) is int and 0 <= completed <= len(CASES):
            _controller_observation.update(phase=phase, case=case, completedCases=completed)
    except BaseException:
        pass


def controller_failure(error):
    value = {"schemaVersion": 1, "kind": "windows-benign-job-controller-failure",
             "complete": False, "failure": "PROOF_DENIED", "phase": "entry",
             "case": None, "completedCases": 0, "code": "UNKNOWN",
             "nativeStage": None, "nativeErrno": None,
             "productionAdmission": False, "runtimeReady": False}
    try:
        phase = dict.get(_controller_observation, "phase")
        case = dict.get(_controller_observation, "case")
        completed = dict.get(_controller_observation, "completedCases")
        if type(phase) is str and len(phase) <= 64 and phase in _CONTROLLER_PHASES:
            value["phase"] = phase
        if case is None or type(case) is str and len(case) <= 64 and case in CASES:
            value["case"] = case
        if type(completed) is int and 0 <= completed <= len(CASES):
            value["completedCases"] = completed
        # Built-in descriptors bypass user __getattribute__, properties and str.
        args = BaseException.args.__get__(error, BaseException)
        if type(args) is tuple and len(args) == 1 and type(args[0]) is str and len(args[0]) <= 64:
            if args[0] in _CONTROLLER_CODES:
                value["code"] = args[0]
            elif args[0] in _CONTROLLER_NATIVE_REASONS:
                value["code"] = _CONTROLLER_NATIVE_REASONS[args[0]]
        native = any(type(error) is cls for cls in
                     (OSError, PermissionError, FileNotFoundError, FileExistsError,
                      NotADirectoryError, IsADirectoryError, TimeoutError, InterruptedError,
                      ProcessLookupError, ChildProcessError, ConnectionError,
                      BrokenPipeError, ConnectionAbortedError, ConnectionRefusedError,
                      ConnectionResetError, BlockingIOError))
        if native:
            number = OSError.errno.__get__(error, OSError)
            fields = BaseException.__dict__["__dict__"].__get__(error, BaseException)
            stage = dict.get(fields, "stage") if type(fields) is dict else None
            if type(number) is int and 0 <= number <= 4294967295:
                value["nativeErrno"] = number
            if type(stage) is str and len(stage) <= 64 and stage in _CONTROLLER_STAGES:
                value["nativeStage"] = stage
            if value["code"] == "UNKNOWN":
                value["code"] = "NATIVE_OS_ERROR"
        elif type(error) is TypeError:
            value["code"] = "PYTHON_TYPE_ERROR"
        elif type(error) is KeyError:
            value["code"] = "PYTHON_KEY_ERROR"
        elif type(error) is json.JSONDecodeError:
            value["code"] = "PYTHON_JSON_ERROR"
        if len(json.dumps(value, separators=(",", ":")).encode()) <= 2048:
            return value
    except BaseException:
        pass
    return {"schemaVersion": 1, "kind": "windows-benign-job-controller-failure",
            "complete": False, "failure": "PROOF_DENIED", "phase": "entry",
            "case": None, "completedCases": 0, "code": "UNKNOWN",
            "nativeStage": None, "nativeErrno": None,
            "productionAdmission": False, "runtimeReady": False}
# END bounded controller failure observation


def need(value, code):
    if not value:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def physical(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, "PROOF_PATH")
    for at in (path, *path.parents):
        info = at.lstat()
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400, "PROOF_LINK")
    return path


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink)


def held(path, maximum, expected=None):
    path = physical(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 <= before.st_size <= maximum, "PROOF_FILE")
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        need(identity(opened) == identity(before), "PROOF_FILE_IDENTITY")
        raw = stream.read(maximum + 1)
        need(len(raw) == before.st_size and identity(os.fstat(stream.fileno())) == identity(opened), "PROOF_FILE_CHANGED")
    after = path.lstat()
    need(identity(after) == identity(before) and after.st_mtime_ns == before.st_mtime_ns and after.st_ctime_ns == before.st_ctime_ns, "PROOF_FILE_CHANGED")
    if expected is not None:
        need(len(raw) == expected["bytes"] and sha(raw) == expected["sha256"], "PROOF_PIN")
    return raw


class SuiteClock:
    """One creator start; every case consumes the same original work/final ends."""
    def __init__(self, started_ms, wall=time.time, mono=time.monotonic):
        self.wall, self.mono = wall, mono
        need(type(started_ms) is int, "PROOF_CLOCK")
        self.origin_wall = started_ms / 1000
        now = wall()
        need(0 <= now - self.origin_wall < 150, "PROOF_CLOCK")
        self.origin_mono = mono() - (now - self.origin_wall)

    def left(self, work=False):
        wall_elapsed = self.wall() - self.origin_wall
        mono_elapsed = self.mono() - self.origin_mono
        need(wall_elapsed >= 0 and abs(wall_elapsed - mono_elapsed) <= 2, "PROOF_CLOCK_DRIFT")
        left = (150 if work else 280) - max(wall_elapsed, mono_elapsed)
        need(left > 0, "PROOF_DEADLINE")
        return left

    def case_seconds(self, name):
        need(name in CASES, "PROOF_CASE")
        left = self.left(True)
        need(left >= (8 if name == "deadline-with-pipe-descendant" else 3), "PROOF_RESERVE")
        return min(4 if name == "deadline-with-pipe-descendant" else 20, left)


class CloseLedger:
    """Forward once. Evidence failure never changes the native return or flow."""
    def __init__(self, native, maximum=4096, get_error=None, set_error=None):
        self.native, self.maximum = native, maximum
        self.get_error, self.set_error = get_error, set_error
        self.calls, self.failed, self.lost = [], False, False

    def __call__(self, *args):
        try:
            result = self.native(*args)
        except BaseException:
            self.failed = True
            raise
        error, captured_error = None, False
        if self.get_error:
            try:
                error, captured_error = self.get_error(), True
            except BaseException:
                self.lost = True
        try:
            if len(self.calls) >= self.maximum:
                self.lost = True
            else:
                self.calls.append(bool(result))
            if not result:
                self.failed = True
        except BaseException:
            self.lost = True
        finally:
            if self.set_error and captured_error:
                try:
                    self.set_error(error)
                except BaseException:
                    self.lost = True
        return result

    def snapshot(self, created):
        return {"closeCalls": len(self.calls), "checkedCloseCallsSucceeded": bool((not created or self.calls) and not self.failed and not self.lost)}


def profile():
    raw = held(PROFILE, 65536)
    need(sha(raw) == PROFILE_SHA, "PROOF_PROFILE")
    value = json.loads(raw)
    need(value["cases"] == list(CASES) and value["suiteSeconds"] == 300 and value["workSeconds"] == 150 and value["finalReserveSeconds"] == 150, "PROOF_POLICY")
    return value


def authority(p):
    need(p["workflowActivation"] is True and p["proofExecutionAdmitted"] is True, "PROOF_INACTIVE")
    need(os.name == "nt" and platform.machine().lower() in ("amd64", "x86_64"), "PROOF_HOST")
    fixed = {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_REPOSITORY_VISIBILITY": "public", "GITHUB_REPOSITORY": p["repository"], "GITHUB_REPOSITORY_ID": p["repositoryId"], "GITHUB_REF": p["ref"], "ImageVersion": p["image"]}
    need(all(os.environ.get(k) == v for k, v in fixed.items()), "PROOF_AUTHORITY")
    need(os.environ.get("GITHUB_WORKFLOW_REF") == p["repository"] + "/" + p["workflow"] + "@" + p["ref"], "PROOF_AUTHORITY")


def checked_root(root, nonce):
    import re
    root = physical(root)
    need(root.parent == REPO / ".artifacts" and root.name == "windows-arm-job-proof-" + nonce and re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", nonce), "PROOF_ROOT")
    need(root.is_dir(), "PROOF_ROOT")
    return root


def kernel_source(p):
    raw = held(REPO / p["kernel"]["path"], 65536, p["kernel"])
    tree = ast.parse(raw)
    run = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "run_job")
    need(sha(ast.dump(run, include_attributes=False).encode()) == p["kernel"]["runJobAstSha256"], "PROOF_KERNEL_AST")
    return raw


def load_kernel(p):
    raw = kernel_source(p)
    module = types.ModuleType("_sorng_benign_job_proof_kernel")
    module.__file__ = str(REPO / p["kernel"]["path"])
    # Execute the exact held bytes, not a second path read during import.
    exec(compile(raw, module.__file__, "exec"), module.__dict__)
    return module


def launch_environment(root):
    value = {"SystemRoot": "C:/Windows", "WINDIR": "C:/Windows", "PATH": "C:/Windows/System32", "TEMP": str(root / "tmp"), "TMP": str(root / "tmp"), "USERPROFILE": str(root / "home"), "PYTHONDONTWRITEBYTECODE": "1"}
    tracking = os.environ.get("RUNNER_TRACKING_ID")
    if tracking:
        need(len(tracking) <= 256 and tracking.isascii() and all(32 <= ord(c) < 127 for c in tracking), "PROOF_TRACKING")
        value["RUNNER_TRACKING_ID"] = tracking
    return value


def expected_outcome(name):
    if name in ("preaborted", "outer-cancel-after-assignment-before-resume"):
        return "cancelled"
    if name == "deadline-with-pipe-descendant":
        return "deadline"
    if name in ("closed-pipe-orphan", "reparented-descendant"):
        return "descendants-left"
    return "success"


def checked_case(name, raw, node, ledger, foreign, observer, reparent):
    need(name in CASES and raw.get("outcome") == expected_outcome(name), "PROOF_CASE_OUTCOME")
    need(raw.get("cleanupVerified") is True and raw.get("activeAtEnd") == 0 and raw.get("logReadersStopped") is True and foreign, "PROOF_CASE_CLEANUP")
    created = name != "preaborted"
    if created:
        need(raw.get("started") is True and raw.get("assignedBeforeResume") is True and raw.get("assignedAtCreationVerified") is True and raw.get("rootReaped") is True, "PROOF_CASE_ASSIGNMENT")
        need(raw.get("observerStopped") is True and raw.get("handleListOnly") is True and raw.get("assignmentMode") == "creation-attribute", "PROOF_CASE_OBSERVER")
        need(raw.get("policyReadback") == {"flags": 8712, "activeProcessLimit": 64, "jobMemoryBytes": "8589934592", "cpuFlags": 5, "cpuRate": 2500, "inheritedHandles": 3, "affinityChanged": False}, "PROOF_CASE_POLICY")
        need(raw.get("jobHandleInheritable") is False and raw.get("jobHandleInStdioAllowlist") is False, "PROOF_JOB_HANDLE")
    else:
        need(raw.get("started") is False and raw.get("assignedBeforeResume") is False and raw.get("resumed") is False and raw.get("jobCreated") is False, "PROOF_PREABORT")
    if name == "outer-cancel-after-assignment-before-resume":
        need(raw.get("resumed") is False and observer, "PROOF_ASSIGN_CANCEL")
    elif created:
        need(raw.get("resumed") is True, "PROOF_CASE_RESUME")
    if name == "reparented-descendant":
        need(reparent is True, "PROOF_REPARENT")
    if name in ("six-role-normal", "second-role-nonzero", "session-cancel-after-owned-output", "closed-pipe-orphan", "reparented-descendant", "bounded-output-failure"):
        need(node is not None and node.get("case") == name and node.get("cohortQuietProven") is False, "PROOF_NODE_RESULT")
        wanted = {"six-role-normal": None, "second-role-nonzero": "PRIVATE_COMMAND_EXIT", "session-cancel-after-owned-output": "PRIVATE_CANCELLED", "closed-pipe-orphan": None, "reparented-descendant": None, "bounded-output-failure": "PRIVATE_COMMAND_OUTPUT_BOUND"}[name]
        need(node.get("failure") == wanted and node.get("complete") is (wanted is None), "PROOF_NODE_OUTCOME")
        need(node.get("unconfirmedClose") is False and node.get("rootAndPipesJoined") is True and node.get("rolesStarted") == (6 if name == "six-role-normal" else 2 if name == "second-role-nonzero" else 1), "PROOF_NODE_JOIN")
        if name == "six-role-normal":
            need(node.get("rolesJoined") == 6 and node.get("logFiles") == 12 and node.get("fileChecks") is True and node.get("closedEntryDenied") is True, "PROOF_NORMAL")
        if name in ("closed-pipe-orphan", "reparented-descendant"):
            need(raw.get("success") is False and raw.get("observedChildrenReaped", 0) >= 1, "PROOF_ORPHAN")
    need(ledger["checkedCloseCallsSucceeded"] is True, "PROOF_CLOSE_LEDGER")
    return {"case": name, "expectedOutcome": expected_outcome(name), "kernelOutcome": raw["outcome"], "workerStarted": raw["started"], "assignedBeforeResume": raw["assignedBeforeResume"], "resumed": raw["resumed"], "activeAtEnd": 0, "rootReaped": raw.get("rootReaped", None), "readersJoined": True, "closeCalls": ledger["closeCalls"], "checkedCloseCallsSucceeded": True, "foreignControllerPreserved": True, "assignmentObserverVerified": observer, "reparentedDescendantVerified": reparent, "node": node}


def cleanup_paths():
    """Only names the fixed controller/kernel/actors can create, never a walk grant."""
    result = {"preparation.json", "tmp", "home"}
    roles = ("qual-gn-desc-pa", "qual-gn-desc-cef", "qual-gn-args", "qual-generate-headers", "qual-clang-probe", "qual-link-probe")
    for name in CASES:
        result.add(name)
        for leaf in ("tmp", "home", "jobs", "private-qualification-logs", "case.json"):
            result.add(name + "/" + leaf)
        job = name + "/jobs/proof-" + name
        result.add(job)
        for leaf in ("receipt.json", "stdout.log", "stderr.log"):
            result.add(job + "/" + leaf)
        for role in roles:
            for channel in ("stdout", "stderr"):
                result.add(name + "/private-qualification-logs/" + role + "." + channel + ".log")
        if name not in ("preaborted", "outer-cancel-after-assignment-before-resume", "deadline-with-pipe-descendant"):
            result.add(name + "/node-result.json")
        if name == "six-role-normal":
            result.update((name + "/tiny-pe.bin", name + "/malformed-pe.bin"))
        if name == "reparented-descendant":
            result.add(name + "/reparent.json")
    return frozenset(result)


def cleanup_directory_stamp(info):
    # This owned deletion advances directory times/link counts, not identity.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid)


def cleanup_file_stamp(info):
    return identity(info) + (info.st_size, info.st_mtime_ns, info.st_ctime_ns)


class CleanupRead:
    """One ordinary read handle, with explicit checked close outcomes."""
    def __init__(self, path, outcomes):
        self.fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        self.outcomes = outcomes

    def stamp(self):
        return cleanup_file_stamp(os.fstat(self.fd))

    def digest(self, clock):
        os.lseek(self.fd, 0, os.SEEK_SET)
        digest, count = hashlib.sha256(), 0
        maximum = self.stamp()[4]
        while True:
            clock.left()
            raw = os.read(self.fd, 65536)
            if not raw:
                need(count == maximum, "PROOF_CLEANUP_CHANGED")
                return digest.hexdigest()
            count += len(raw)
            need(count <= maximum, "PROOF_CLEANUP_CHANGED")
            digest.update(raw)

    def close(self):
        if self.fd is None:
            return
        owned, self.fd = self.fd, None  # Never retry a failed numeric close.
        try:
            os.close(owned)
        except BaseException:
            self.outcomes.append(False)
            raise
        self.outcomes.append(True)


class WindowsCleanupRead:
    """Read-only/share-delete: no process, Job, delete or write access rights.

    FILE_ID_INFO's128-bit id+volume is compared between held and fresh named
    handles. Layout/flags are from Microsoft Learn's fileapi/winbase headers.
    """
    def __init__(self, path, outcomes):
        import ctypes as C
        from ctypes import wintypes as W
        self.C, self.W, self.outcomes = C, W, outcomes
        api = C.WinDLL("kernel32", use_last_error=True)

        class FileId(C.Structure):
            _fields_ = [("volume", C.c_uint64), ("identifier", C.c_ubyte * 16)]

        class FileInfo(C.Structure):
            _fields_ = [("attributes", W.DWORD), ("created", W.FILETIME), ("accessed", W.FILETIME), ("written", W.FILETIME), ("volume", W.DWORD), ("sizeHigh", W.DWORD), ("sizeLow", W.DWORD), ("links", W.DWORD), ("indexHigh", W.DWORD), ("indexLow", W.DWORD)]

        need(C.sizeof(FileId) == 24 and FileId.identifier.offset == 8 and C.sizeof(FileInfo) == 52, "PROOF_CLEANUP_ABI")
        self.FileId, self.FileInfo = FileId, FileInfo

        def declare(name, result, args):
            function = getattr(api, name)
            function.restype, function.argtypes = result, args
            return function

        create = declare("CreateFileW", W.HANDLE, [W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE])
        self.info = declare("GetFileInformationByHandle", W.BOOL, [W.HANDLE, C.POINTER(FileInfo)])
        self.file_id = declare("GetFileInformationByHandleEx", W.BOOL, [W.HANDLE, C.c_int, C.c_void_p, W.DWORD])
        self.seek = declare("SetFilePointerEx", W.BOOL, [W.HANDLE, C.c_int64, C.c_void_p, W.DWORD])
        self.read = declare("ReadFile", W.BOOL, [W.HANDLE, C.c_void_p, W.DWORD, C.POINTER(W.DWORD), C.c_void_p])
        self.native_close = declare("CloseHandle", W.BOOL, [W.HANDLE])
        self.handle = create(str(path), 0x80000000, 7, None, 3, 0x80 | 0x00200000, None)
        need(self.handle is not None and self.handle != C.c_void_p(-1).value, "PROOF_CLEANUP_OPEN")

    def stamp(self):
        C, W = self.C, self.W
        info, identifier = self.FileInfo(), self.FileId()
        need(self.info(self.handle, C.byref(info)) and self.file_id(self.handle, 18, C.byref(identifier), C.sizeof(identifier)), "PROOF_CLEANUP_FILE_INFO")
        need(not info.attributes & (0x10 | 0x400) and info.links == 1, "PROOF_CLEANUP_TYPE")
        packed = lambda value: (value.dwHighDateTime << 32) | value.dwLowDateTime
        return (identifier.volume, bytes(identifier.identifier), info.attributes, info.links, (info.sizeHigh << 32) | info.sizeLow, packed(info.created), packed(info.written))

    def digest(self, clock):
        C, W = self.C, self.W
        need(self.seek(self.handle, 0, None, 0), "PROOF_CLEANUP_READ")
        digest, raw, count_total = hashlib.sha256(), C.create_string_buffer(65536), 0
        maximum = self.stamp()[4]
        while True:
            clock.left()
            count = W.DWORD()
            need(self.read(self.handle, raw, len(raw), C.byref(count), None) and count.value <= len(raw), "PROOF_CLEANUP_READ")
            if count.value == 0:
                need(count_total == maximum, "PROOF_CLEANUP_CHANGED")
                return digest.hexdigest()
            count_total += count.value
            need(count_total <= maximum, "PROOF_CLEANUP_CHANGED")
            digest.update(raw.raw[:count.value])

    def close(self):
        if self.handle is None:
            return
        owned, self.handle = self.handle, None
        success = bool(self.native_close(owned))
        self.outcomes.append(success)
        need(success, "PROOF_CLEANUP_CLOSE")


def remove_owned_tree(root, original, clock, known_paths):
    """Guard each mutation. These named operations are NOT inode-CAS/race-free."""
    need(isinstance(known_paths, frozenset) and len(known_paths) <= 4096, "PROOF_CLEANUP_LEDGER")
    need(all(type(name) is str and 0 < len(name) <= 1024 and all(part and part not in (".", "..") and not any(c in part for c in "\\:\x00") for part in name.split("/")) for name in known_paths), "PROOF_CLEANUP_LEDGER")
    root = physical(root)
    need(identity(root.lstat()) == original, "PROOF_ROOT_CHANGED")
    roots = {item: cleanup_directory_stamp(item.lstat()) for item in (root, *root.parents)}
    rows, remaining, close_outcomes = {}, set(), []
    maximum_bytes = 2 * 64 * 1024**2 * len(CASES) + 16 * 1024**2
    total, failed, primary = 0, False, None

    def check_root():
        clock.left()
        for item, expected in roots.items():
            physical(item)
            need(cleanup_directory_stamp(item.lstat()) == expected, "PROOF_ROOT_CHANGED")

    def check_parent(parent):
        check_root()
        at = parent
        while at != root:
            relative = at.relative_to(root).as_posix()
            expected = rows.get(relative)
            need(expected and expected["directory"], "PROOF_CLEANUP_PARENT")
            physical(at)
            need(cleanup_directory_stamp(at.lstat()) == expected["identity"], "PROOF_CLEANUP_PARENT")
            at = at.parent
        with os.scandir(parent) as iterator:
            names = set()
            for entry in iterator:
                clock.left()
                need(len(names) < 4096, "PROOF_CLEANUP_BOUND")
                names.add(entry.name)
        expected = {Path(name).name for name in remaining if (root / name).parent == parent}
        need(names == expected, "PROOF_CLEANUP_UNKNOWN")

    reader = WindowsCleanupRead if os.name == "nt" else CleanupRead
    try:
        for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
            check_root()
            parent = Path(base)
            need(len(parent.relative_to(root).parts) <= 8, "PROOF_CLEANUP_DEPTH")
            for name in sorted(dirs + files):
                check_root()
                item = physical(parent / name)
                relative = item.relative_to(root).as_posix()
                need(relative in known_paths and relative not in rows and len(rows) < 4096, "PROOF_CLEANUP_UNKNOWN")
                info = item.lstat()
                need(stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1), "PROOF_CLEANUP_TYPE")
                row = {"directory": stat.S_ISDIR(info.st_mode), "identity": cleanup_directory_stamp(info) if stat.S_ISDIR(info.st_mode) else cleanup_file_stamp(info), "handle": None}
                rows[relative] = row
                remaining.add(relative)
                if not row["directory"]:
                    total += info.st_size
                    need(total <= maximum_bytes, "PROOF_CLEANUP_BYTES")
                    handle = reader(item, close_outcomes)
                    row["handle"] = handle  # Own before metadata/content calls.
                    row["held"] = handle.stamp()
                    need(row["held"][4] == info.st_size, "PROOF_CLEANUP_CHANGED")
                    row["sha256"] = handle.digest(clock)
                    need(handle.stamp() == row["held"] and cleanup_file_stamp(item.lstat()) == row["identity"], "PROOF_CLEANUP_CHANGED")
                    row["handle"] = None
                    handle.close()
                    check_root()
        for relative in sorted(rows, key=lambda name: (len(Path(name).parts), name), reverse=True):
            row, item = rows[relative], root / relative
            check_parent(item.parent)
            physical(item)
            if row["directory"]:
                check_parent(item)
                need(cleanup_directory_stamp(item.lstat()) == row["identity"], "PROOF_CLEANUP_PARENT")
                check_root()
                item.rmdir()
            else:
                handle = reader(item, close_outcomes)
                row["handle"] = handle
                need(cleanup_file_stamp(item.lstat()) == row["identity"] and handle.stamp() == row["held"] and handle.digest(clock) == row["sha256"], "PROOF_CLEANUP_CHANGED")
                named = reader(item, close_outcomes)
                named_failed = False
                try:
                    need(named.stamp() == row["held"] and named.digest(clock) == row["sha256"] and handle.stamp() == row["held"], "PROOF_CLEANUP_CHANGED")
                except BaseException:
                    named_failed = True
                    raise
                finally:
                    try:
                        named.close()
                    except BaseException:
                        if not named_failed:
                            raise
                check_parent(item.parent)
                need(cleanup_file_stamp(item.lstat()) == row["identity"] and handle.stamp() == row["held"], "PROOF_CLEANUP_CHANGED")
                check_root()
                item.unlink()
                row["handle"] = None
                handle.close()
            remaining.remove(relative)
            check_root()
        check_parent(root)
        need(not remaining, "PROOF_CLEANUP_UNKNOWN")
        check_root()
        root.rmdir()
    except BaseException as error:
        failed, primary = True, error
    finally:
        for row in rows.values():
            handle, row["handle"] = row["handle"], None
            if handle is not None:
                try:
                    handle.close()
                except BaseException as error:
                    if not failed:
                        failed, primary = True, error
    if failed:
        raise primary
    need(all(close_outcomes), "PROOF_CLEANUP_CLOSE")
    return {"readHandlesClosed": True, "closeCalls": len(close_outcomes), "sourceInodeCas": False}


def suite(root, context_raw, p):
    _observe_controller("suite-context")  # controller-observation
    context = json.loads(context_raw)
    clock = SuiteClock(context["startedMs"])
    need(context["kind"] == "windows-benign-job-preparation" and context["head"] == os.environ.get("GITHUB_SHA"), "PROOF_CONTEXT")
    root = checked_root(root, context["nonce"])
    root_identity = identity(root.lstat())
    _observe_controller("source-witnesses")  # controller-observation
    for name in p["sourcePaths"]:
        clock.left()
        held(REPO / name, 4 * 1024 * 1024, context["sources"][name])
    held(Path(p["python"]["path"]), p["python"]["bytes"], p["python"])
    held(Path(p["node"]["path"]), p["node"]["bytes"], p["node"])
    _observe_controller("kernel-import")  # controller-observation
    kernel = load_kernel(p)
    case_rows, receipts = [], []
    fixture = REPO / "tests/fixtures/cef/windows_arm_qualification_job_proof.mjs"
    for name in CASES:
        _observe_controller("case-prepare", name, len(case_rows))  # controller-observation
        seconds = clock.case_seconds(name)
        held(Path(p["python"]["path"]), p["python"]["bytes"], p["python"])
        held(Path(p["node"]["path"]), p["node"]["bytes"], p["node"])
        seconds = min(seconds, clock.case_seconds(name))
        case = root / name
        case.mkdir()
        for leaf in ("jobs", "tmp", "home", "private-qualification-logs"):
            (case / leaf).mkdir()
        event = threading.Event()
        if name == "preaborted":
            event.set()
        case_context = {"kind": "windows-benign-job-case", "case": name, "root": str(case), "nonce": context["nonce"], "head": context["head"], "sourceHead": context["head"], "workEndMs": min(context["startedMs"] + 150000, int(time.time() * 1000 + (20 if name == "deadline-with-pipe-descendant" else seconds) * 1000)), "subjectSha256": p["subject"]["sha256"]}
        raw = (json.dumps(case_context, separators=(",", ":")) + "\n").encode()
        case_file = case / "case.json"
        with case_file.open("xb") as stream:
            need(stream.write(raw) == len(raw), "PROOF_CONTEXT_WRITE")
        command = [p["node"]["path"], "--disable-proto=throw", "--no-addons", str(fixture), "--worker", name, str(case_file), sha(raw)]
        role = "proof-" + name
        producer = types.ModuleType("producer")
        producer.verified_sources = lambda cwd: ({"proofOnly": True}, None, None)
        producer.worker_policy = lambda selected, _context: dict(p["kernelPolicy"]) if selected == role else need(False, "PROOF_ROLE")
        previous = sys.modules.get("producer")
        sys.modules["producer"] = producer
        kernel.approved_tool_command = lambda argv, cwd: role if argv == command and Path(cwd) == case else need(False, "PROOF_COMMAND")
        kernel.launch_environment = lambda selected, cwd: launch_environment(case) if selected == role and Path(cwd) == case else need(False, "PROOF_ENVIRONMENT")
        ledger = CloseLedger(kernel.close, p["maxCloseCalls"], kernel.C.get_last_error, kernel.C.set_last_error)
        native_close = kernel.close
        kernel.close = ledger
        controller = None
        parent = None
        try:
            _observe_controller("case-parent", name, len(case_rows))  # controller-observation
            controller = kernel.open_process(0x100000 | 0x1000, False, os.getpid())
            kernel.checked(controller, "proof-controller-handle")
            controller_created = kernel.ParentCancel.creation(controller)
            parent = kernel.ParentCancel(event)
        except BaseException:
            if controller:
                owned_controller = controller
                controller = None
                try:
                    ledger(owned_controller)
                except BaseException:
                    pass
            kernel.close = native_close
            if previous is None:
                sys.modules.pop("producer", None)
            else:
                sys.modules["producer"] = previous
            raise
        observed = [False]
        reparent = [False]

        class Cancellation:
            def is_set(self):
                return parent.is_set() or clock.left(True) <= 0

        def observer(job, process, pid, created):
            clock.left(True)
            inside = kernel.W.BOOL()
            kernel.checked(kernel.is_in_job(process, job, kernel.C.byref(inside)) and inside.value, "proof-membership")
            kernel.checked(kernel.ParentCancel.creation(process) == int(created), "proof-root-creation")
            foreign = kernel.W.BOOL()
            kernel.checked(kernel.is_in_job(controller, job, kernel.C.byref(foreign)) and not foreign.value, "proof-controller-outside")
            observed[0] = True
            if name == "outer-cancel-after-assignment-before-resume":
                event.set()

            def before_cleanup(_deadline):
                if name != "reparented-descendant":
                    return
                evidence = json.loads(held(case / "reparent.json", 4096))
                need(evidence.get("middleClosed") is True and type(evidence.get("childPid")) is int, "PROOF_REPARENT")
                get_pid = kernel.declare("GetProcessId", kernel.W.DWORD, [kernel.HANDLE])
                children = kernel.observed_process_handles(job)
                try:
                    reparent[0] = any(get_pid(handle) == evidence["childPid"] and kernel.ParentCancel.creation(handle) > 0 for handle in children)
                    need(reparent[0], "PROOF_REPARENT")
                finally:
                    for handle in children:
                        kernel.checked(ledger(handle), "proof-observed-child-close")
            observer.before_cleanup = before_cleanup

        failed = False
        try:
            _observe_controller("case-run", name, len(case_rows))  # controller-observation
            result = kernel.run_job(command, case, case / "jobs" / role, seconds, cancel=Cancellation(), cap=p["caseOutputCapBytes"], _test_observe=observer)
            _observe_controller("case-readback", name, len(case_rows))  # controller-observation
            clock.left()
            held(Path(p["python"]["path"]), p["python"]["bytes"], p["python"])
            held(Path(p["node"]["path"]), p["node"]["bytes"], p["node"])
            foreign = kernel.wait(controller, 0) == 258 and kernel.ParentCancel.creation(controller) == controller_created and kernel.wait(parent.handle, 0) == 258 and not parent.exit_observed
            owned_controller = controller
            controller = None
            kernel.checked(ledger(owned_controller), "proof-controller-close")
            owned_parent = parent.handle
            parent.handle = None
            kernel.checked(ledger(owned_parent), "proof-parent-close")
            raw_receipt = held(case / "jobs" / role / "receipt.json", 65536)
            need(json.loads(raw_receipt) == result, "PROOF_KERNEL_RECEIPT")
            node_path = case / "node-result.json"
            node = json.loads(held(node_path, 65536)) if node_path.exists() else None
            row = checked_case(name, result, node, ledger.snapshot(result["started"]), foreign, observed[0], reparent[0])
            row["kernelReceiptPin"] = {"bytes": len(raw_receipt), "sha256": sha(raw_receipt)}
            case_rows.append(row)
            _observe_controller("case-complete", name, len(case_rows))  # controller-observation
            import base64
            receipts.append(base64.b64encode(raw_receipt).decode("ascii"))
        except BaseException:
            failed = True
            raise
        finally:
            try:
                if controller:
                    owned_controller = controller
                    controller = None
                    kernel.checked(ledger(owned_controller), "proof-controller-close")
                if parent.handle:
                    owned_parent = parent.handle
                    parent.handle = None
                    kernel.checked(ledger(owned_parent), "proof-parent-close")
            except BaseException:
                if not failed:
                    raise
            kernel.close = native_close
            if previous is None:
                sys.modules.pop("producer", None)
            else:
                sys.modules["producer"] = previous
    _observe_controller("source-recheck", completed=len(case_rows))  # controller-observation
    clock.left()
    for name in p["sourcePaths"]:
        held(REPO / name, 4 * 1024 * 1024, context["sources"][name])
    _observe_controller("scratch-cleanup", completed=len(case_rows))  # controller-observation
    cleanup = remove_owned_tree(root, root_identity, clock, cleanup_paths())
    need(cleanup["readHandlesClosed"] is True, "PROOF_CLEANUP_CLOSE")
    clock.left()
    return {"schemaVersion": 1, "kind": "windows-benign-job-controller-result", "complete": True, "nonce": context["nonce"], "head": context["head"], "cases": case_rows, "rawReceipts": receipts, "scratchRemoved": True, "productionAdmission": False, "sourceGnQualified": False, "compilerAdmission": False, "nativeAcceptance": False, "runtimeReady": False}


def main(argv):
    _observe_controller("profile")  # controller-observation
    p = profile()
    _observe_controller("authority")  # controller-observation
    authority(p)  # Inactive before argv-selected paths or native module imports.
    _observe_controller("arguments")  # controller-observation
    need(len(argv) == 3 and argv[0] == "--suite", "PROOF_ARGV")
    need(len(argv[2]) == 64 and all(c in "0123456789abcdef" for c in argv[2]), "PROOF_CONTEXT_PIN")
    _observe_controller("preparation")  # controller-observation
    raw = held(Path(argv[1]) / "preparation.json", 131072)
    need(sha(raw) == argv[2], "PROOF_CONTEXT_PIN")
    value = suite(Path(argv[1]), raw, p)
    _observe_controller("success-report", completed=len(CASES))  # controller-observation
    print(json.dumps(value, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except BaseException as error:  # controller-observation
        # No raw exceptions/paths/arguments/environment in workflow output.
        print(json.dumps(controller_failure(error), separators=(",", ":")), flush=True)  # controller-observation
        raise SystemExit(1)
