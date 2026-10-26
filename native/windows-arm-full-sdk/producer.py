"""Fixed bootstrap data workers. No GN, Rust, compiler or acquired binary execution."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquire as data
import checkpoint

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PROFILE_SHA = "52a005e688abc7ea8133f448bbf4ba602ff3056efd97208f3ee674699862716a"
CONTEXT_SHA = None
ROLES = ("sdk-data", "llvm-data", "rust-archive", "gn-archive", "siso-archive", "materialize", "runtime-closure")
CARRIER_REF = "refs/heads/codex/windows-arm-full-sdk-source-20261026"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def profile(clock):
    _, raw = data.held(HERE / "profile.json", clock, sha256=PROFILE_SHA, retain=True, maximum=65536)
    p = json.loads(raw)
    data.need(p["kind"] == "sorng-windows-arm-full-sdk-source" and
              p["modes"] == ["input-closure"] and p["buildAdmission"] is False and
              p["sdkVersion"] == "10.0.28000.0" and p["programs"] == list(ROLES), "BOOT_PROFILE")
    return p


def bootstrap_authority(c, p):
    data.need(c["kind"] == "windows-arm-full-sdk-context" and
              c["mode"] == "input-closure" and c["repository"] == "supermarsx/sortOfRemoteNG" and
              c["repositoryId"] == "1010282954" and c["visibility"] == "public" and
              c["event"] == "workflow_dispatch" and c["defaultBranch"] == "main" and
              c["ref"] == CARRIER_REF and
              (c["inputs"] is None or type(c["inputs"]) is dict and not c["inputs"]) and
              c["workflow"] == p["sourcePaths"][0] and
              c["workflow"] == ".github/workflows/windows-x64-arm-toolchain.yml" and
              c["workflowSha"] == c["head"] and re.fullmatch("[a-f0-9]{40}", c["head"]) and
              c["image"] == p["image"] and re.fullmatch("[1-9][0-9]*", c["runId"]) and
              re.fullmatch("[1-9][0-9]*", c["attempt"]), "BOOT_AUTHORITY")


def verified_sources(root, expected=None, bind=False):
    global CONTEXT_SHA
    root = data.plain(root)
    data.need(root.parent == ROOT / ".artifacts" and
              re.fullmatch("windows-arm-full-sdk-[a-f0-9-]{36}", root.name), "BOOT_ROOT")
    short = data.Clock(time.time() + 5, time.monotonic() + 5)
    _, raw = data.held(root / "context.json", short, retain=True, maximum=131072)
    data.need(digest(raw) == (expected if expected is not None else CONTEXT_SHA), "BOOT_CONTEXT_PIN")
    c = json.loads(raw)
    checkpoint.remaining_deadlines(c, time.time(), time.monotonic())
    clock = data.Clock(c["wallWorkEnd"], c["monotonicWorkEnd"])
    p = profile(clock)
    bootstrap_authority(c, p)
    data.need(checkpoint.closed_sources(c["sources"], p["sourcePaths"]) == c["sourceDigest"], "BOOT_SOURCE_DIGEST")
    for i, row in enumerate(c["sources"]):
        _, snapshot = data.held(root / "source-inputs" / str(i), clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
        _, live = data.held(ROOT / row["path"], clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
        data.need(snapshot == live, "BOOT_SOURCE_CHANGED")
        checkpoint.source_bytes(row, live)
    data.need(type(p.get('sourceData'))is list and len(p['sourceData'])==29,'FULL_SOURCE_DATA_SET')
    for row in p['sourceData']:
        data.need(row['path'].startswith('native/cef-build-inputs/20261026-r5-capsule22-windows-arm64-cross-x64/'),'FULL_SOURCE_DATA_PATH')
        data.held(ROOT/row['path'],clock,row['bytes'],row['sha256'],maximum=2*1024**2)
    data.held(p["python"]["path"], clock, p["python"]["bytes"], p["python"]["sha256"])
    if bind:
        CONTEXT_SHA = digest(raw)
    return c, p, clock


def worker_argv(role, root, p):
    data.need(role in (*ROLES, "operation") and CONTEXT_SHA is not None, "BOOT_ROLE")
    return [p["python"]["path"], "-I", "-B", str(HERE / "producer.py"),
            "--worker", role, str(root), CONTEXT_SHA, "--execute"]


def closed_worker_command(argv, root, p):
    data.need(type(argv) is list and len(argv) == 9 and argv[5] in (*ROLES, "operation") and
              argv == worker_argv(argv[5], Path(root), p) and Path(root) == Path.cwd(), "BOOT_COMMAND")
    return argv[5]


def no_execution(event, _args):
    if event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn"):
        raise ValueError("BOOT_DATA_NO_EXECUTION")


def failure(error):
    code = str(error)
    return code if re.fullmatch("(?:BOOT|ACQ|FULL|IDX|INV|ENV)_[A-Z_]{1,56}", code) else "BOOT_UNAVAILABLE"


def retain(root, name, result):
    try:
        data.save(root / name, result)
    except BaseException:
        result["reportingFailure"] = "BOOT_REPORT_WRITE"
        result["success"] = False


def data_worker(role, root, c, p, clock):
    sys.addaudithook(no_execution)
    result = {"role": role, "success": False, "firstFailure": None, "executed": False}
    try:
        if role == "sdk-data":
            data.acquire_sdk(root, p, clock)
        elif role == "llvm-data":
            data.acquire_llvm(root, p, clock)
        elif role == "rust-archive":
            data.acquire_rust_archive(root, p, clock)
        elif role in ('gn-archive','siso-archive'):
            data.acquire_cipd(root, role, p, clock)
        elif role == 'materialize':
            import extract
            start=time.monotonic()
            local=data.Clock(min(clock.wall_end,time.time()+p['limits']['extractSeconds']),
                             min(clock.mono_end,start+p['limits']['extractSeconds']))
            for spec in p['cipd']:
                observed=extract.cipd_archive(root/'archives'/(spec['role']+'.zip'),root/spec['role'].removesuffix('-archive'),spec,p,local)
                data.save(root/(spec['role']+'-extracted.json'),observed)
            observed=extract.rust_archive(root/'archives/rust.tar.xz',root/'rust',p['rust'],local)
            data.save(root/'rust-extracted.json',observed)
        elif role == 'runtime-closure':
            import extract, environment
            observed=environment.installed_inventory(p,clock)
            data.save(root/'installed-source-inventory.json',observed)
            observed=extract.runtime_projection(root,p,clock)
            data.save(root/'runtime-projection.json',observed)
        else:
            raise data.Denied('FULL_PHASE_UNAVAILABLE')
        result["success"] = True
    except BaseException as error:
        result["firstFailure"] = failure(error)
    finally:
        if getattr(sys.modules.get('extract'),'FILE_CLOSE_FAILURE',False):
            result['sourceCloseFailure']=True
        try:
            verified_sources(root)
            clock.remaining()
            result["sourcePostVerified"] = True
        except BaseException:
            result["sourcePostVerified"] = False
            result["firstFailure"] = result["firstFailure"] or "BOOT_POSTCHECK"
            result["success"] = False
        retain(root, role + "-result.json", result)
    return 0 if result["success"] else 1


def operation(root, c, p, clock):
    # This is the only parent allowed to spawn fixed, audit-restricted Python
    # data workers. Acquired executables are never worker arguments.
    import job
    result = {"kind": "windows-arm-full-sdk-bootstrap-operation", "success": False,
              "firstFailure": None, "jobs": [], "sdkBuilt": False, "outputExecuted": False,
              "buildAdmission": False, "engineCheckpointImplemented": False}
    parent = None
    try:
        data.need(shutil.disk_usage(root).free >= p["limits"]["freeBytes"], "BOOT_CAPACITY")
        result["capacity"] = {"freeBytes": shutil.disk_usage(root).free,
                              "logicalCpuCount": os.cpu_count(), "engineCapacityProven": False}
        parent = job.ParentCancel(threading.Event())
        for role in ROLES:
            verified_sources(root)
            allotted = {"sdk-data": 1170, "llvm-data": 300, "rust-archive": 1200,
                        "gn-archive": 180, "siso-archive": 180,
                        "materialize":600,"runtime-closure":120}[role]
            seconds = min(allotted, clock.remaining() - p["limits"]["finalReserveSeconds"] - 3)
            data.need(seconds > 0, "BOOT_ADMISSION")
            observed = job.run_job(worker_argv(role, root, p), str(root), root / "jobs" / role,
                                   seconds, cancel=parent, cap=131072)
            result["jobs"].append({"role": role, "originalJob": observed})
            data.need(observed.get("success") is True and observed.get("cleanupVerified") is True and
                      observed.get("rootExit") == 0 and observed.get("activeAtEnd") == 0,
                      "BOOT_JOB_FAILED")
        result["success"] = True
    except BaseException as error:
        result["firstFailure"] = failure(error)
    finally:
        if parent is not None:
            try:
                parent.close();result["parentHandleClosed"] = True
            except BaseException:
                result["parentHandleClosed"] = False
                result["success"] = False
                result["firstFailure"] = result["firstFailure"] or "BOOT_PARENT_CLOSE"
        try:
            verified_sources(root);clock.remaining();result["sourcePostVerified"] = True
        except BaseException:
            result["sourcePostVerified"] = False;result["success"] = False
            result["firstFailure"] = result["firstFailure"] or "BOOT_POSTCHECK"
        retain(root, "bootstrap-result.json", result)
    return 0 if result["success"] else 1


def supervise(root, c, p, clock):
    import job
    parent, result, primary = None, None, None
    try:
        (root / "jobs").mkdir()
        parent = job.ParentCancel(threading.Event())
        seconds = clock.remaining() - 3
        data.need(seconds > 0, "BOOT_ADMISSION")
        result = job.run_job(worker_argv("operation", root, p), str(root), root / "jobs/operation",
                             seconds, cancel=parent, cap=131072)
        result["parentCreationFiletime"] = parent.parent_creation
        result["parentExitObserved"] = parent.exit_observed
    except BaseException as error:
        primary = failure(error)
    finally:
        closed = parent is None
        if parent is not None:
            try:
                parent.close();closed = True
            except BaseException:
                closed = False
        report = {"kind": "bootstrap-supervisor", "success": bool(result and result.get("success") and closed and not primary),
                  "firstFailure": primary, "originalJob": result, "parentHandleClosed": closed,
                  "sdkBuilt": False, "outputExecuted": False}
        try:
            verified_sources(root);clock.remaining();report["sourcePostVerified"] = True
        except BaseException:
            report["sourcePostVerified"] = False;report["success"] = False
            report["firstFailure"] = report["firstFailure"] or "BOOT_POSTCHECK"
        retain(root, "supervisor-result.json", report)
    return 0 if report["success"] else 1


def main(argv):
    if len(argv) == 4 and argv[0] == "--supervise" and argv[3] == "--execute":
        data.need(os.name == "nt", "BOOT_PLATFORM")
        root = Path(argv[1]);c, p, clock = verified_sources(root, argv[2], bind=True)
        data.need(Path(sys.executable).resolve() == Path(p["python"]["path"]).resolve(), "BOOT_PYTHON")
        return supervise(root, c, p, clock)
    data.need(os.name == "nt" and len(argv) == 5 and argv[0] == "--worker" and
              argv[1] in (*ROLES, "operation") and argv[4] == "--execute", "BOOT_ARGV")
    root = Path(argv[2])
    c, p, clock = verified_sources(root, argv[3], bind=True)
    data.need(Path(sys.executable).resolve() == Path(p["python"]["path"]).resolve(), "BOOT_PYTHON")
    return operation(root, c, p, clock) if argv[1] == "operation" else data_worker(argv[1], root, c, p, clock)


if __name__ == "__main__":
    sys.modules["producer"] = sys.modules[__name__]
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({"success": False, "firstFailure": failure(error), "sdkBuilt": False}))
        raise SystemExit(1)
