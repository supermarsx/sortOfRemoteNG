"""Closed x64-host toolchain diagnostic. Inert imports; generated images never run."""
import datetime
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import struct
import subprocess
import sys
import threading
import time
sys.path.insert(0, str(Path(__file__).resolve().parent))
from acquire import Clock, Denied, acquire_sdk, acquire_llvm, held, need, plain, save
import environment as env_adapter
import observe

PROFILE_SHA = "3b7f693689acc3b5becf9a69c22f84e79757f3813f96f1bfa7b585789075a844"
BOUND_CONTEXT = None
BOUND_INPUTS = None
BOUND_VENDOR_PREFIX = None
PHASE = "source-preflight"
CURRENT_ROOT = None
ROLES = ("setup-x86", "setup-x64", "setup-arm64", "c", "stl", "atl", "mfc", "assembly", "resource", "builtins", "link-c", "link-stl", "link-atl")
DATA_ROLES = ("sdk-acquire", "llvm-acquire")
SOURCES = {
    "c": ("c", '#include <Windows.h>\nextern unsigned long owned_asm(void);\nextern int builtin_probe(void);\nint main(void){return (GetCurrentProcessId()==0)+(owned_asm()!=7)+builtin_probe();}\n'),
    "stl": ("cpp", '#include <vector>\n#include <numeric>\nint main(){std::vector<int> x{1,2,3};return std::accumulate(x.begin(),x.end(),0)-6;}\n'),
    "atl": ("cpp", '#include <atlbase.h>\n#include <atlstr.h>\nint main(){ATL::CStringW x(L"owned");return x.CompareNoCase(L"OWNED");}\n'),
    "mfc": ("cpp", '#include <afxwin.h>\nint main(){CStringW x(L"owned");return x.GetLength()!=5;}\n'),
    "assembly": ("S", '.text\n.globl owned_asm\n.p2align 2\nowned_asm:\nmov w0, #7\nret\n'),
    "resource": ("rc", 'STRINGTABLE\nBEGIN\n101 "owned arm toolchain"\nEND\n'),
    "builtins": ("c", 'typedef unsigned tu_int __attribute__((mode(TI)));\nextern tu_int __udivti3(tu_int,tu_int);\nvolatile unsigned long long input_a=14,input_b=2;\nint builtin_probe(void){return (int)__udivti3((tu_int)input_a,(tu_int)input_b)-7;}\n')}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def profile(clock):
    _, raw = held(Path(__file__).with_name("profile.json"), clock, sha256=PROFILE_SHA, retain=True, maximum=32768)
    value = json.loads(raw)
    need(value["kind"] == "sorng-x64-arm-toolchain-diagnostic" and value["buildAdmission"] is False and
         value["host"] == "x86_64-pc-windows-msvc" and value["target"] == "aarch64-pc-windows-msvc" and
         value["sdkVersion"] == "10.0.28000.0", "SLICE_PROFILE")
    return value


def context_clock(context):
    need(all(type(context[key]) in (int, float) and math.isfinite(context[key])
             for key in ("wallWorkEnd", "monotonicWorkEnd")), "SLICE_CONTEXT_CLOCK")
    return Clock(context["wallWorkEnd"], context["monotonicWorkEnd"])


def verified_sources(root, expected=None, bind=False):
    global BOUND_CONTEXT
    root = plain(root)
    need(root.parent == Path(__file__).resolve().parents[2] / ".artifacts" and
         re.fullmatch(r"windows-x64-arm-toolchain-[0-9a-f-]{36}", root.name), "SLICE_ROOT")
    # Metadata read itself is bounded before trusting the carried deadline.
    bootstrap = Clock(time.time() + 5, time.monotonic() + 5)
    _, raw = held(root / "context.json", bootstrap, retain=True, maximum=131072)
    need(digest(raw) == (expected if expected is not None else BOUND_CONTEXT), "SLICE_CONTEXT_PIN")
    context = json.loads(raw)
    clock = context_clock(context)
    clock.remaining()
    p = profile(clock)
    need(context["kind"] == "sorng-x64-arm-toolchain-context" and context["repository"] == "supermarsx/sortOfRemoteNG" and
         context["repositoryId"] == "1010282954" and context["visibility"] == "public" and context["event"] == "workflow_dispatch" and
         context["ref"] == "refs/heads/" + context["defaultBranch"] and context["workflow"] == ".github/workflows/windows-x64-arm-toolchain.yml" and
         re.fullmatch(r"[a-f0-9]{40}", context["head"]) and context["workflowSha"] == context["head"] and
         re.fullmatch(r"[1-9][0-9]*", context["runId"]) and re.fullmatch(r"[1-9][0-9]*", context["attempt"]), "SLICE_AUTHORITY")
    need(context["image"] == p["image"] and [r["path"] for r in context["sources"]] == p["sourcePaths"], "SLICE_SOURCE_SET")
    for i, item in enumerate(context["sources"]):
        _, snap = held(root / "source-inputs" / str(i), clock, item["bytes"], item["sha256"], retain=True, maximum=2 * 1024**2)
        _, live = held(Path(__file__).resolve().parents[2] / item["path"], clock, item["bytes"], item["sha256"], retain=True, maximum=2 * 1024**2)
        need(snap == live, "SLICE_SOURCE_CHANGED")
    held(p["python"]["path"], clock, p["python"]["bytes"], p["python"]["sha256"])
    if bind:
        BOUND_CONTEXT = digest(raw)
    return context, p, clock


def worker_argv(role, root, p):
    need(role in (*ROLES, *DATA_ROLES, "operation") and BOUND_CONTEXT is not None, "SLICE_ROLE")
    unstarted = role in (*DATA_ROLES, "operation")
    need(unstarted or BOUND_INPUTS is not None, "SLICE_INPUTS_UNBOUND")
    need(unstarted or BOUND_VENDOR_PREFIX is not None, "SLICE_VENDOR_PREFIX_UNBOUND")
    return [p["python"]["path"], "-I", "-B", str(Path(__file__).resolve()), "--worker", role, str(root), BOUND_CONTEXT, "--execute", "unstarted" if unstarted else BOUND_INPUTS, "unstarted" if unstarted else BOUND_VENDOR_PREFIX]


def closed_worker_command(argv, root, p):
    need(len(argv) == 11 and argv[5] in (*ROLES, *DATA_ROLES, "operation") and
         argv == worker_argv(argv[5], Path(root), p) and Path(root) == Path.cwd(), "SLICE_COMMAND")
    return argv[5]


def actual_inputs(root, p, clock):
    # Verify acquisition-produced byte inventories before every tool role.
    _, raw = held(Path(root) / "input-pins.json", clock, retain=True, maximum=8 * 1024**2)
    _, expected = held(Path(root) / "input-pins.sha256", clock, retain=True, maximum=65)
    need(BOUND_INPUTS is not None and digest(raw) == BOUND_INPUTS and
         expected == BOUND_INPUTS.encode("ascii") + b"\n", "SLICE_INPUT_MAP")
    rows = json.loads(raw)
    need(type(rows) is list and len(rows) <= 35000, "SLICE_INPUT_BOUND")
    selected = [x for x in rows if x["path"] == str(Path(root) / "compile-clock.json")]
    need(len(selected) == 1, "SLICE_COMPILE_CLOCK")
    _, clock_raw = held(selected[0]["path"], clock, selected[0]["bytes"], selected[0]["sha256"], retain=True, maximum=1024)
    phase_clock = json.loads(clock_raw)
    need(type(phase_clock["wallEnd"]) in (int, float) and type(phase_clock["monoEnd"]) in (int, float) and
         phase_clock["wallEnd"] <= clock.wall_end and phase_clock["monoEnd"] <= clock.mono_end, "SLICE_COMPILE_CLOCK")
    clock = Clock(phase_clock["wallEnd"], phase_clock["monoEnd"])
    for item in rows:
        held(item["path"], clock, item["bytes"], item["sha256"], maximum=1024**3)
    return clock


def tool_argv(role, root, p):
    need(role in ROLES, "SLICE_ROLE")
    root = Path(root)
    if role.startswith("setup-"):
        return env_adapter.setup_argv(root, p, role[6:])
    clang, lld = str(root / "llvm/bin/clang-cl.exe"), str(root / "llvm/bin/lld-link.exe")
    if role.startswith("link-"):
        name = role[5:]
        objects = [root / "objects" / (name + ".obj")]
        if name == "c":
            objects += [root / "objects/assembly.obj", root / "objects/builtins.obj", root / "objects/resource.res",
                        root / "llvm/lib/clang/24/lib/windows/clang_rt.builtins-aarch64.lib"]
        return [lld, "/NOLOGO", "/MACHINE:ARM64", "/SUBSYSTEM:CONSOLE", "/INCREMENTAL:NO", "/VERBOSE",
                "/OUT:" + str(root / "bin" / (name + ".exe")), "/MAP:" + str(root / "maps" / (name + ".map")),
                *map(str, objects), "kernel32.lib"]
    extension, _ = SOURCES[role]
    source = str(root / "sources" / (role + "." + extension))
    if role == "resource":
        return [str(root / "Windows Kits/10/bin" / p["sdkVersion"] / "x64/rc.exe"), "/nologo", "/fo" + str(root / "objects/resource.res"), source]
    if role == "assembly":
        return [clang, "--target=aarch64-pc-windows", "-c", "-o" + str(root / "objects/assembly.obj"), source]
    args = [clang, "--target=aarch64-pc-windows", "/nologo", "/c", "/MT", "/W4", "/WX", "/showIncludes", "/DUNICODE", "/D_UNICODE",
            "/Fo" + str(root / "objects" / (role + ".obj"))]
    if extension == "cpp":
        args += ["/EHsc", "/std:c++20"]
    return args + [source]


def vendor_remaining(root, role, prefix_sha, p, clock):
    """Only the parent-sealed, exact prior fixed roles may spend aggregate bytes."""
    need(role in ROLES and type(prefix_sha) is str and re.fullmatch(r"[a-f0-9]{64}", prefix_sha), "SLICE_VENDOR_PREFIX")
    _, raw = held(Path(root) / ("vendor-prefix-" + role + ".json"), clock, sha256=prefix_sha, retain=True, maximum=131072)
    value = json.loads(raw)
    need(type(value) is dict and set(value) == {"kind", "contextSha256", "inputSha256", "nextRole", "prior"} and
         value["kind"] == "parent-sealed-vendor-log-prefix" and value["contextSha256"] == BOUND_CONTEXT and
         value["inputSha256"] == BOUND_INPUTS and value["nextRole"] == role and type(value["prior"]) is list and
         all(type(x) is dict for x in value["prior"]) and
         [x.get("role") for x in value["prior"]] == list(ROLES[:ROLES.index(role)]), "SLICE_VENDOR_PREFIX")
    total = 0
    for item in value["prior"]:
        need(type(item) is dict and set(item) == {"role", "log", "result", "job"}, "SLICE_VENDOR_PREFIX")
        previous = item["role"]
        def record(name, relative, maximum, retain=False):
            pin = item[name]
            need(type(pin) is dict and set(pin) == {"bytes", "sha256"} and type(pin["bytes"]) is int and
                 0 <= pin["bytes"] <= maximum and type(pin["sha256"]) is str and re.fullmatch(r"[a-f0-9]{64}", pin["sha256"]), "SLICE_VENDOR_PREFIX")
            return held(Path(root) / relative, clock, pin["bytes"], pin["sha256"], retain=retain, maximum=maximum)[1]
        record("log", "logs/" + previous + ".log", p["limits"]["roleOutputBytes"])
        result = json.loads(record("result", "results/" + previous + ".json", 4 * 1024**2, True))
        job = json.loads(record("job", "jobs/" + previous + "/receipt.json", 1024**2, True))
        need(result["role"] == previous and type(result["exit"]) is int and result["exit"] == 0 and result["failure"] is None and
             not result.get("guardFailure") and result.get("postVerified") is True and
             result.get("childReaped") is True and result.get("readerJoined") is True and
             result["outputBytes"] == item["log"]["bytes"] and result["outputSha256"] == item["log"]["sha256"], "SLICE_VENDOR_PREFIX_RESULT")
        need(job["success"] is True and type(job["rootExit"]) is int and job["rootExit"] == 0 and job["cleanupVerified"] is True and
             job["rootReaped"] is True and job["activeAtEnd"] == 0 and job["logReadersStopped"] is True, "SLICE_VENDOR_PREFIX_JOB")
        total += item["log"]["bytes"]
        need(total <= p["limits"]["totalOutputBytes"], "SLICE_TOTAL_OUTPUT_CAP")
    remaining = p["limits"]["totalOutputBytes"] - total
    need(remaining > 0, "SLICE_TOTAL_OUTPUT_CAP")
    return remaining


def seal_vendor_prefix(root, role, prior, p, clock):
    value = {"kind": "parent-sealed-vendor-log-prefix", "contextSha256": BOUND_CONTEXT,
             "inputSha256": BOUND_INPUTS, "nextRole": role, "prior": prior}
    file = Path(root) / ("vendor-prefix-" + role + ".json")
    save(file, value)
    _, raw = held(file, clock, retain=True, maximum=131072)
    pin = digest(raw)
    vendor_remaining(root, role, pin, p, clock)
    return pin


def completed_vendor_row(root, role, clock):
    row = {"role": role}
    for kind, relative, maximum in (("log", "logs/" + role + ".log", 4 * 1024**2),
                                    ("result", "results/" + role + ".json", 4 * 1024**2),
                                    ("job", "jobs/" + role + "/receipt.json", 1024**2)):
        value, _ = held(Path(root) / relative, clock, maximum=maximum)
        row[kind] = {"bytes": value["bytes"], "sha256": value["sha256"]}
    return row


def collect(argv, root, env, launch=subprocess.Popen, now=time.monotonic, maximum=4 * 1024**2, total_limited=False):
    need(type(maximum) is int and 0 < maximum <= 4 * 1024**2, "SLICE_TOTAL_OUTPUT_CAP")
    child = launch(argv, cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                   stderr=subprocess.STDOUT, creationflags=0x08000000)
    chunks, failures, size = [], [], [0]
    stopped, lock = threading.Event(), threading.Lock()
    def reader():
        try:
            while not stopped.is_set():
                data = child.stdout.read(min(65536, maximum + 1 - size[0]))
                if not data:
                    break
                with lock:
                    if stopped.is_set():
                        break
                    retained = min(len(data), maximum - size[0])
                    if retained:
                        chunks.append(data[:retained])
                    size[0] += len(data)
                    if size[0] > maximum:
                        failures.append("SLICE_TOTAL_OUTPUT_CAP" if total_limited else "SLICE_OUTPUT_CAP")
                        break
        except Exception:
            failures.append("SLICE_PIPE")
    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    end = now() + 85
    while child.poll() is None and not failures and now() < end:
        time.sleep(.02)
    if child.poll() is None:
        if not failures:
            failures.append("SLICE_CHILD_UNFINISHED")
        try:
            child.kill()
        except Exception:
            failures.append("SLICE_KILL_UNCONFIRMED")
    reaped = False
    try:
        child.wait(timeout=max(0, end - now()))
        reaped = True
    except Exception:
        failures.append("SLICE_CHILD_UNREAPED")
    thread.join(max(0, end - now()))
    joined = not thread.is_alive()
    if not joined:
        failures.append("SLICE_PIPE_UNCONFIRMED")
    stopped.set()
    with lock:
        raw = b"".join(chunks)
    return {"exit": child.poll(), "failure": failures[0] if failures else None,
            "childReaped": reaped, "readerJoined": joined, "retainedCapBytes": maximum}, raw


def coff(raw):
    need(20 <= len(raw) <= 32 * 1024**2, "SLICE_COFF_BOUND")
    machine = struct.unpack_from("<H", raw, 6 if raw[:4] == b"\0\0\xff\xff" else 0)[0]
    need(machine == 0xaa64, "SLICE_COFF_MACHINE")
    return {"machine": machine, "executed": False}


def pe(raw):
    need(64 <= len(raw) <= 32 * 1024**2 and raw[:2] == b"MZ", "SLICE_PE")
    at = struct.unpack_from("<I", raw, 60)[0]
    need(64 <= at <= 1024**2 and at + 264 <= len(raw) and raw[at:at + 4] == b"PE\0\0" and
         struct.unpack_from("<H", raw, at + 4)[0] == 0xaa64, "SLICE_PE_MACHINE")
    count = struct.unpack_from("<H", raw, at + 6)[0]
    optional = struct.unpack_from("<H", raw, at + 20)[0]
    base = at + 24
    need(1 <= count <= 96 and optional >= 240 and base + optional + count * 40 <= len(raw) and
         struct.unpack_from("<H", raw, base)[0] == 0x20b, "SLICE_PE_HEADER")
    def mapped(rva, size):
        for index in range(count):
            h = base + optional + index * 40
            va, length, start = struct.unpack_from("<III", raw, h + 12)
            if va <= rva and rva - va + size <= length:
                location = start + rva - va
                need(location + size <= len(raw), "SLICE_PE_RVA")
                return location
        raise ValueError("SLICE_PE_RVA")
    imports = []
    rva, size = struct.unpack_from("<II", raw, base + 120)
    need(size <= 20 * 128 and (rva != 0 or size == 0), "SLICE_PE_IMPORTS")
    if rva:
        for index in range(128):
            need((index + 1) * 20 <= size, "SLICE_PE_IMPORTS")
            h = mapped(rva + index * 20, 20)
            if raw[h:h + 20] == b"\0" * 20:
                break
            name_rva = struct.unpack_from("<I", raw, h + 12)[0]
            name = mapped(name_rva, 1)
            end = raw.find(b"\0", name, name + 257)
            need(end > name, "SLICE_PE_IMPORT_NAME")
            mapped(name_rva, end - name + 1)
            value = raw[name:end].decode("ascii", "strict")
            need(re.fullmatch(r"[A-Za-z0-9_.-]{1,256}", value), "SLICE_PE_IMPORT_NAME")
            imports.append(value)
        else:
            raise ValueError("SLICE_PE_IMPORTS")
    return {"machine": 0xaa64, "executed": False, "importsObserved": True, "importLibraries": imports}


def dependency_scope(value, roots):
    normalized = observe.windows_path(value)
    allowed = []
    for label, base in roots:
        prefix = str(base).replace("\\", "/")
        if normalized.casefold().startswith(prefix.casefold() + "/"):
            allowed.append((label, normalized[len(prefix) + 1:]))
    need(len(allowed) == 1, "SLICE_DEPENDENCY_SCOPE")
    return plain(value), allowed[0]


def dependencies(text, root, p, role, clock):
    vc = Path(p["vsRoot"]) / "VC/Tools/MSVC" / p["toolset"]
    roots = [("vc", vc), ("sdk", Path(root) / "Windows Kits/10"), ("llvm", Path(root) / "llvm")]
    if role.startswith("link-"):
        # LLVM20e97c4b Driver.cpp/addFile logs full archive reads; archive
        # member-only Reading/Loaded rows are not treated as filesystem paths.
        candidates = re.findall(r"^lld-link: Reading (.+\.lib)\s*$", text, re.M)
        maximum = 128
    else:
        candidates = re.findall(r"^Note: including file:\s*(.+?)\s*$", text, re.M)
        maximum = p["limits"]["headerFiles"]
    need(candidates, "SLICE_DEPENDENCIES_MISSING")
    rows, seen, total = [], set(), 0
    for value in candidates:
        file, (label, relative) = dependency_scope(value, roots)
        if str(file).casefold() in seen:
            continue
        seen.add(str(file).casefold())
        need(len(seen) <= maximum, "SLICE_DEPENDENCY_COUNT")
        record, _ = held(file, clock, maximum=256 * 1024**2)
        total += record["bytes"]
        need(total <= (1024**3 if role.startswith("link-") else p["limits"]["headerBytes"]), "SLICE_DEPENDENCY_BYTES")
        rows.append({"root": label, "relativePath": relative, "bytes": record["bytes"], "sha256": record["sha256"],
                     "diagnosticObservationOnly": True})
    return rows


def builtin_contribution(raw):
    need(len(raw) <= 4 * 1024**2, "SLICE_MAP_BOUND")
    text = raw.decode("utf-8", "strict")
    # LLVM20e97c4b COFF/MapFile.cpp strips archive extensions in Lib:Object.
    matches = re.findall(r"^\s*[0-9a-fA-F]{4}:[0-9a-fA-F]{8}\s+__udivti3\s+[0-9a-fA-F]{16}\s+"
                         r"clang_rt\.builtins-aarch64:([A-Za-z0-9_.+-]{1,160})\s*$", text, re.M)
    need(len(matches) == 1 and ".." not in matches[0], "SLICE_BUILTINS_CONTRIBUTION")
    return {"symbol": "__udivti3", "libraryStem": "clang_rt.builtins-aarch64", "member": matches[0],
            "contributionObserved": True, "outputExecuted": False}


def write_sources(root):
    for name, (extension, source) in SOURCES.items():
        with (Path(root) / "sources" / (name + "." + extension)).open("xb") as f:
            f.write(source.encode("utf-8"))


def relative_output(root, value):
    need(type(value) is str and 0 < len(value) <= 320 and value.isascii() and
         not any(c in value for c in ("\\", ":", "\0")) and
         all(32 <= ord(c) < 127 for c in value) and
         all(part not in ("", ".", "..") and not part.endswith((".", " ")) for part in value.split("/")), "SLICE_OUTPUT_PATH")
    return Path(root).joinpath(*value.split("/"))


def worker(role, root):
    context, p, clock = verified_sources(root)
    clock = actual_inputs(root, p, clock)
    for name, (extension, source) in SOURCES.items():
        raw = source.encode("utf-8")
        held(Path(root) / "sources" / (name + "." + extension), clock, len(raw), digest(raw))
    values = env_adapter.rows(root, p, "arm64")
    if role.startswith("setup-"):
        values.update(json.loads((Path(root) / "environment-private.json").read_text())["cefEnvironment"])
    remaining = vendor_remaining(root, role, BOUND_VENDOR_PREFIX, p, clock)
    result, output = collect(tool_argv(role, root, p), root, values,
                             maximum=min(p["limits"]["roleOutputBytes"], remaining),
                             total_limited=remaining <= p["limits"]["roleOutputBytes"])
    with (Path(root) / "logs" / (role + ".log")).open("xb") as f:
        f.write(output)
    result.update(role=role, outputBytes=len(output), outputSha256=digest(output), outputExecuted=False)
    try:
        if result["exit"] == 0 and result["failure"] is None:
            if role.startswith("setup-"):
                result["setup"] = env_adapter.verify_setup(output.decode("utf-8", "strict"), root, p, role[6:])
            elif role == "resource":
                held(Path(root) / "objects/resource.res", clock, maximum=32 * 1024**2)
            else:
                name = role[5:] if role.startswith("link-") else role
                file = Path(root) / ("bin" if role.startswith("link-") else "objects") / (name + (".exe" if role.startswith("link-") else ".obj"))
                pin, data = held(file, clock, retain=True, maximum=32 * 1024**2)
                result["output"] = {**pin, **(pe(data) if role.startswith("link-") else coff(data))}
                if role not in ("assembly", "builtins"):
                    result["dependencies"] = dependencies(output.decode("utf-8", "strict"), root, p, role, clock)
                if role == "link-c":
                    _, mapping = held(Path(root) / "maps/c.map", clock, retain=True, maximum=4 * 1024**2)
                    result["builtinContribution"] = builtin_contribution(mapping)
    except BaseException as e:
        result["guardFailure"] = closed_error(e)
    finally:
        try:
            verified_sources(root)
            result["postVerified"] = True
        except BaseException as e:
            result["postVerified"] = False
            result["postFailure"] = closed_error(e)
        save(Path(root) / "results" / (role + ".json"), result)
    return 0 if result["exit"] == 0 and not result["failure"] and not result.get("guardFailure") and result["postVerified"] else 1


def load_job():
    spec = importlib.util.spec_from_file_location("owned_x64_arm_job", Path(__file__).with_name("job.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def operation(root):
    global PHASE, BOUND_INPUTS, BOUND_VENDOR_PREFIX
    context, p, clock = verified_sources(root)
    need(__import__("shutil").disk_usage(root).free >= p["limits"]["freeBytes"], "SLICE_DISK")
    PHASE = "installed-observation"
    acquisition_clock = Clock(min(clock.wall_end, time.time() + 2700), min(clock.mono_end, time.monotonic() + 2700))
    save(Path(root) / "phase-installed.json", {"phase": PHASE, "begun": True})
    observations = observe.observe(root, p, acquisition_clock)
    PHASE = "acquisition"
    save(Path(root) / "phase-acquisition.json", {"phase": PHASE, "begun": True})
    job = load_job()
    acquisition_jobs = []
    parent_acquisition = job.ParentCancel(threading.Event())
    acquisition_failure = None
    acquisition_parent_closed = False
    try:
        for data_role in DATA_ROLES:
            seconds = min(1170 if data_role == "sdk-acquire" else acquisition_clock.remaining(), acquisition_clock.remaining()) - 3
            need(seconds > 0, "SLICE_ACQUISITION_DEADLINE")
            result = job.run_job(worker_argv(data_role, root, p), root, Path(root) / "jobs" / data_role,
                                 seconds, cancel=parent_acquisition, cap=4 * 1024**2)
            acquisition_jobs.append({"role": data_role, "job": result})
            save(Path(root) / (data_role + "-job.json"), {"role": data_role, "job": result})
            need(result["success"] is True, "SLICE_ACQUISITION_JOB_FAILED")
    except BaseException as error:
        acquisition_failure = error
    finally:
        try:
            parent_acquisition.close()
            acquisition_parent_closed = True
        except BaseException:
            pass
        save(Path(root) / "acquisition-parent.json", {"parentCreationFiletime": parent_acquisition.parent_creation,
             "parentExitObserved": parent_acquisition.exit_observed, "parentHandleClosed": acquisition_parent_closed,
             "firstFailure": closed_error(acquisition_failure) if acquisition_failure is not None else None,
             "originalJobOutcomes": [{"role": x["role"], "outcome": x["job"]["outcome"], "rootExit": x["job"]["rootExit"]} for x in acquisition_jobs]})
    if acquisition_failure is not None:
        raise acquisition_failure
    need(acquisition_parent_closed, "SLICE_PARENT_CLOSE")
    _, raw_acquisition = held(Path(root) / "acquisition.json", acquisition_clock, retain=True, maximum=8 * 1024**2)
    acquisition = json.loads(raw_acquisition)
    PHASE = "environment-projection"
    env_adapter.create(root, p, acquisition_clock)
    acquisition_clock.remaining()
    end = min(clock.mono_end, time.monotonic() + 900)
    compile_wall_end = min(clock.wall_end, time.time() + 900)
    compile_clock = Clock(compile_wall_end, end)
    save(Path(root) / "compile-clock.json", {"wallEnd": compile_wall_end, "monoEnd": end})
    pins = []
    for row in acquisition["sdkFiles"]:
        pins.append({"path": str(relative_output(root, row["path"])), "bytes": row["bytes"], "sha256": row["sha256"]})
    for row in acquisition["llvmFiles"]:
        pins.append({"path": str(relative_output(Path(root) / "llvm", row["path"])), "bytes": row["bytes"], "sha256": row["sha256"]})
    expected_archives = {str(Path(root) / "archives" / (x["id"] + ".nupkg")): (x["bytes"], x["sha256"]) for x in p["sdk"]["packages"]}
    expected_archives[str(Path(root) / "archives/clang.tar.xz")] = (p["llvm"]["bytes"], p["llvm"]["sha256"])
    need(len(acquisition["archives"]) == 5 and {x["path"] for x in acquisition["archives"]} == set(expected_archives), "SLICE_ARCHIVE_SET")
    for item in acquisition["archives"]:
        need((item["bytes"], item["sha256"]) == expected_archives[item["path"]], "SLICE_ARCHIVE_PIN")
        pins.append({k: item[k] for k in ("path", "bytes", "sha256")})
    for package in p["sdk"]["packages"]:
        pins.append({"path": str(Path(root) / "metadata-inputs" / (package["id"] + ".json")),
                     "bytes": package["catalog"]["bytes"], "sha256": package["catalog"]["sha256"]})
    for item in observations["installedMsvc14"]:
        pins.append({k: item[k] for k in ("path", "bytes", "sha256")})
    pins += [{"path": str(Path(root) / "host-runtime" / x["role"]), "bytes": x["bytes"], "sha256": x["sha256"]} for x in observations["observedHostCrt"]]
    for source in p["upstreamSources"]:
        pins.append({"path": str(Path(root) / "chromium" / source["path"]), "bytes": source["bytes"], "sha256": source["sha256"]})
    for relative in ("custom-vs/VC/vcvarsall.bat", "environment-private.json", "compile-clock.json"):
        file = Path(root) / relative
        record, _ = held(file, clock, maximum=131072)
        pins.append({"path": str(file), "bytes": record["bytes"], "sha256": record["sha256"]})
    write_sources(root)
    save(Path(root) / "input-pins.json", pins)
    BOUND_INPUTS = digest((Path(root) / "input-pins.json").read_bytes())
    with (Path(root) / "input-pins.sha256").open("xb") as f:
        f.write((BOUND_INPUTS + "\n").encode("ascii"))
    job = load_job()
    report = {"kind": "x64-arm-toolchain-slice", "success": False, "stages": [], "outputExecuted": False,
              "cefStarted": False, "sdkBuilt": False, "nativeAcceptance": False, "publicationAllowed": False}
    parent = job.ParentCancel(threading.Event())
    vendor_records = []
    try:
        for role in ROLES:
            PHASE = role
            BOUND_VENDOR_PREFIX = seal_vendor_prefix(root, role, vendor_records.copy(), p, compile_clock)
            remaining = min(90, end - time.monotonic() - 120) - 3
            need(remaining > 0, "SLICE_FINAL_RESERVE")
            result = job.run_job(worker_argv(role, root, p), root, Path(root) / "jobs" / role, remaining, cancel=parent, cap=4 * 1024**2)
            report["stages"].append({"role": role, "job": result})
            save(Path(root) / ("progress-" + role + ".json"), report)
            need(result["success"] is True, "SLICE_JOB_FAILED")
            vendor_records.append(completed_vendor_row(root, role, compile_clock))
        actual_inputs(root, p, clock)
        verified_sources(root)
        need(time.monotonic() < end, "SLICE_FINAL_DEADLINE")
        report["success"] = True
    except BaseException as e:
        report["failure"] = closed_error(e)
    finally:
        try:
            parent.close()
            report["parentHandleClosed"] = True
        except BaseException:
            report["parentHandleClosed"] = False
            report["success"] = False
            report["parentCloseFailure"] = "SLICE_PARENT_CLOSE"
        try:
            verified_sources(root)
            report["postSourceVerified"] = True
        except BaseException as e:
            report["postSourceVerified"] = False
            report["postFailure"] = closed_error(e)
            report["success"] = False
        report["terminalUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save(Path(root) / "slice-result.json", report)
    return 0 if report["success"] else 1


def closed_error(error):
    code = error.args[0] if isinstance(error, (ValueError, Denied)) and len(error.args) == 1 else "SLICE_OPERATION_FAILED"
    return code if type(code) is str and re.fullmatch(r"(?:SLICE|ACQ|OBS|ENV)_[A-Z_]{1,70}", code) else "SLICE_OPERATION_FAILED"


def supervise(root):
    context, p, clock = verified_sources(root)
    job = load_job()
    parent = job.ParentCancel(threading.Event())
    result = None
    try:
        result = job.run_job(worker_argv("operation", root, p), root, Path(root) / "jobs/operation", clock.remaining() - 3, cancel=parent, cap=32 * 1024**2)
        result["parentCreationFiletime"] = parent.parent_creation
        result["parentExitObserved"] = parent.exit_observed
    finally:
        try:
            parent.close()
            closed = True
        except BaseException:
            closed = False
        if result is not None:
            result["parentHandleClosed"] = closed
            if not closed:
                result["success"] = False
                result["parentCloseFailure"] = "SLICE_PARENT_CLOSE"
            job.write_parent_receipt(Path(root) / "jobs/operation", result)
    return 0 if result and result["success"] else 1


def main():
    global BOUND_INPUTS, BOUND_VENDOR_PREFIX, CURRENT_ROOT
    need(len(sys.argv) in (5, 8), "SLICE_ARGUMENTS")
    if sys.argv[1] == "--supervise":
        need(len(sys.argv) == 5 and sys.argv[4] == "--execute", "SLICE_ARGUMENTS")
        root, expected = Path(sys.argv[2]), sys.argv[3]
        verified_sources(root, expected, True)
        CURRENT_ROOT = root
        return supervise(root)
    need(len(sys.argv) == 8 and sys.argv[1] == "--worker" and sys.argv[2] in (*ROLES, *DATA_ROLES, "operation"), "SLICE_ARGUMENTS")
    root, expected = Path(sys.argv[3]), sys.argv[4]
    need(sys.argv[5] == "--execute", "SLICE_ARGUMENTS")
    if sys.argv[2] in (*DATA_ROLES, "operation"):
        need(sys.argv[6] == "unstarted", "SLICE_INPUT_ARGUMENT")
        need(sys.argv[7] == "unstarted", "SLICE_VENDOR_PREFIX")
    else:
        need(re.fullmatch(r"[a-f0-9]{64}", sys.argv[6]), "SLICE_INPUT_ARGUMENT")
        BOUND_INPUTS = sys.argv[6]
        need(re.fullmatch(r"[a-f0-9]{64}", sys.argv[7]), "SLICE_VENDOR_PREFIX")
        BOUND_VENDOR_PREFIX = sys.argv[7]
    verified_sources(root, expected, True)
    CURRENT_ROOT = root
    if sys.argv[2] in DATA_ROLES:
        global PHASE
        PHASE = sys.argv[2]
        _, p, clock = verified_sources(root)
        # Data-only workers have no subprocess authority, even through imports.
        def no_execution(event, _args):
            if event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn"):
                raise ValueError("ACQ_NO_EXECUTION")
        sys.addaudithook(no_execution)
        (acquire_sdk if sys.argv[2] == "sdk-acquire" else acquire_llvm)(root, p, clock)
        verified_sources(root)
        return 0
    return operation(root) if sys.argv[2] == "operation" else worker(sys.argv[2], root)


if __name__ == "__main__":
    sys.modules["slice"] = sys.modules[__name__]
    try:
        raise SystemExit(main())
    except (Exception, KeyboardInterrupt) as e:
        result = {"success": False, "failure": closed_error(e), "phase": PHASE, "outputExecuted": False}
        if CURRENT_ROOT is not None:
            try:
                verified_sources(CURRENT_ROOT)
                result["postSourceVerified"] = True
            except BaseException as post:
                result["postSourceVerified"] = False
                result["postFailure"] = closed_error(post)
            try:
                save(CURRENT_ROOT / "operation-failure.json", result)
            except BaseException:
                result["failureReceiptRetained"] = False
        print(json.dumps(result))
        raise SystemExit(1)
