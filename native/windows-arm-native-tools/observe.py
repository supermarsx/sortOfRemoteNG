"""Closed diagnostic observer. Importing this file performs no Windows API calls."""
import contextlib
import ctypes as C
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import threading
import time

PROFILE_SHA = "97342e8b854a4bd970d3794ac5d966198bfc08cef67b5647da79b5ae35379bf1"
ROLES = ("python", "git", "powershell", "cl", "link")
FAILURES = frozenset({"TOOLS_PATH", "TOOLS_LINK", "TOOLS_PROFILE_PIN", "TOOLS_PROFILE", "TOOLS_PROFILE_BOUND", "TOOLS_ROLE", "TOOLS_COMMAND", "TOOLS_CONTEXT_BOUND", "TOOLS_CONTEXT", "TOOLS_CONTEXT_CHANGED", "TOOLS_SOURCES", "TOOLS_SOURCE_PIN", "TOOLS_DEPLOYMENT_PIN", "TOOLS_PROVENANCE", "TOOLS_FILE_BOUND", "TOOLS_OPEN_IDENTITY", "TOOLS_FILE_PIN", "TOOLS_PE_DOS", "TOOLS_PE_BOUND", "TOOLS_PE_MACHINE", "TOOLS_FILE_CHANGED", "TOOLS_TRUST_ABI", "TOOLS_VERSION_BOUND", "TOOLS_VERSION_READER_UNKNOWN", "TOOLS_EXEC_NATIVE", "TOOLS_NATIVE", "TOOLS_DEADLINE", "TOOLS_JOB_UNCONFIRMED", "TOOLS_SIGNATURE_UNVERIFIED", "TOOLS_BIRTHTIME_UNAVAILABLE"})
BOUND_CONTEXT_DIGEST = None
SOURCE_PATHS = (
    ".github/workflows/windows-arm-native-tools.yml",
    "native/windows-arm-native-tools/job.py",
    "native/windows-arm-native-tools/observe.py",
    "native/windows-arm-native-tools/profile.json",
    "native/windows-arm-native-tools/test_observe.py",
    "tests/tooling/windowsArmNativeTools.node-test.mjs",
    "tests/tooling/nodeToolchain.node-test.mjs",
)


def deny(condition, code):
    if not condition:
        raise ValueError(code)


def no_links(path):
    path = Path(path)
    deny(path.is_absolute() and path.resolve() == path, "TOOLS_PATH")
    for item in (path, *path.parents):
        info = item.lstat()
        deny(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400, "TOOLS_LINK")
    return path


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink, getattr(info, "st_birthtime_ns", None))


def common_identity(info, require_birth=None):
    if require_birth is None:
        require_birth = os.name == "nt"
    birth = getattr(info, "st_birthtime_ns", None)
    deny(not require_birth or type(birth) is int, "TOOLS_BIRTHTIME_UNAVAILABLE")
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, birth, info.st_nlink)


def verify_open_identity(path_before, fd_before):
    deny(common_identity(fd_before) == common_identity(path_before), "TOOLS_OPEN_IDENTITY")


def verify_snapshots(path_before, fd_before, path_after, fd_after):
    deny(identity(fd_after) == identity(fd_before) and identity(path_after) == identity(path_before) and common_identity(fd_after) == common_identity(path_after), "TOOLS_FILE_CHANGED")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def failure_code(error):
    return error.args[0] if type(error) is ValueError and len(error.args) == 1 and type(error.args[0]) is str and error.args[0] in FAILURES else "TOOLS_OBSERVATION_INCOMPLETE"


def profile_bytes(raw):
    deny(0 < len(raw) <= 32768 and digest(raw) == PROFILE_SHA, "TOOLS_PROFILE_PIN")
    value = json.loads(raw)
    deny(value["target"] == "aarch64-pc-windows-msvc" and tuple(value["programs"]) == ROLES, "TOOLS_PROFILE")
    deny(len(value["files"]) <= 32 and sum(x["size"] for x in value["files"]) <= 256 * 1024**2, "TOOLS_PROFILE_BOUND")
    return value


def load_profile():
    path = no_links(Path(__file__).with_name("profile.json"))
    deny(path.stat().st_size <= 32768, "TOOLS_PROFILE_PIN")
    with path.open("rb") as stream:
        return profile_bytes(stream.read(32769))


def row_for(role, profile):
    deny(role in ROLES, "TOOLS_ROLE")
    return next(row for row in profile["files"] if row["role"] == profile["programs"][role])


def version_argv(role, profile):
    path = row_for(role, profile)["path"]
    return {
        "python": [path, "-I", "-B", "-c", "import sys;print(sys.version.split()[0]);print(sys.maxsize.bit_length()+1)"],
        "git": [path, "--version"],
        "powershell": [path, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
        "cl": [path, "/Bv"],
        "link": [path, "/help"],
    }[role]


def worker_argv(role, root, profile):
    deny(role in ROLES, "TOOLS_ROLE")
    return [str(Path(row_for("python", profile)["path"])), "-I", "-B", str(Path(__file__).resolve()), "--role", role, str(Path(root))]


def closed_worker_command(argv, root, profile):
    deny(len(argv) == 7 and argv[5] in ROLES, "TOOLS_COMMAND")
    deny(argv == worker_argv(argv[5], root, profile) and Path(root) == Path.cwd(), "TOOLS_COMMAND")
    return argv[5]


def context_digest(raw, expected):
    actual = digest(raw)
    deny(expected is None or actual == expected, "TOOLS_CONTEXT_CHANGED")
    return actual


def verified_sources(root, bind=False):
    global BOUND_CONTEXT_DIGEST
    root = no_links(root)
    context = no_links(root / "context.json")
    deny(context.stat().st_size <= 131072, "TOOLS_CONTEXT_BOUND")
    with context.open("rb") as stream:
        raw = stream.read(131073)
    deny(len(raw) <= 131072, "TOOLS_CONTEXT_BOUND")
    deny(bind or BOUND_CONTEXT_DIGEST is not None, "TOOLS_CONTEXT_CHANGED")
    pinned = context_digest(raw, BOUND_CONTEXT_DIGEST)
    value = json.loads(raw)
    deny(value["kind"] == "sorng-windows-arm-native-tools-context" and value["image"] == "20261022.194.1", "TOOLS_CONTEXT")
    deny([row["path"] for row in value["sources"]] == list(SOURCE_PATHS), "TOOLS_SOURCES")
    for index, row in enumerate(value["sources"]):
        file = no_links(root / "source-inputs" / str(index))
        deny(file.stat().st_size <= 2 * 1024**2, "TOOLS_SOURCE_PIN")
        with file.open("rb") as stream:
            data = stream.read(2 * 1024**2+1)
        deny(len(data) <= 2 * 1024**2 and len(data) == row["size"] and digest(data) == row["sha256"], "TOOLS_SOURCE_PIN")
        if row["path"].startswith("native/windows-arm-native-tools/"):
            deployed = no_links(Path(__file__).with_name(Path(row["path"]).name))
            deny(deployed.stat().st_size <= 2 * 1024**2, "TOOLS_DEPLOYMENT_PIN")
            with deployed.open("rb") as stream:
                actual = stream.read(2 * 1024**2+1)
            deny(actual == data, "TOOLS_DEPLOYMENT_PIN")
    deny(value["producerProvenanceIntegrationRequired"] is True and len(value["ancestry"]) == 4, "TOOLS_PROVENANCE")
    if bind:
        BOUND_CONTEXT_DIGEST = pinned
    return value


@contextlib.contextmanager
def held_file(row):
    path = no_links(row["path"])
    before = path.stat()
    deny(stat.S_ISREG(before.st_mode) and before.st_nlink == row["nlink"] and before.st_size == row["size"] <= 128 * 1024**2, "TOOLS_FILE_BOUND")
    with path.open("rb", buffering=0) as stream:
        fd_before = os.fstat(stream.fileno())
        # Preserve both full snapshots; different API views of ctime are not
        # equated. Shared birth/dev/inode/size/mtime/nlink must still all match.
        verify_open_identity(before, fd_before)
        raw = stream.read(row["size"] + 1)
        deny(len(raw) == row["size"] and digest(raw) == row["sha256"], "TOOLS_FILE_PIN")
        if row["machine"] is not None:
            deny(len(raw) >= 64 and raw[:2] == b"MZ", "TOOLS_PE_DOS")
            offset = struct.unpack_from("<I", raw, 60)[0]
            deny(offset <= len(raw) - 6 and raw[offset:offset+4] == b"PE\0\0", "TOOLS_PE_BOUND")
            deny(struct.unpack_from("<H", raw, offset+4)[0] == row["machine"], "TOOLS_PE_MACHINE")
        try:
            yield stream
        finally:
            fd_after, path_after = os.fstat(stream.fileno()), path.stat()
            verify_snapshots(before, fd_before, path_after, fd_after)
            stream.seek(0)
            deny(digest(stream.read(row["size"] + 1)) == row["sha256"], "TOOLS_FILE_CHANGED")
            verify_snapshots(before, fd_before, path.stat(), os.fstat(stream.fileno()))


def close_trust(verify, data):
    """Injectable status/lifetime rule; native wrapper supplies ctypes call."""
    status = closed = None
    try:
        data.action = 1
        status = verify(data) & 0xffffffff
    finally:
        data.action = 2
        closed = verify(data) & 0xffffffff
    return {"status": status, "closeStatus": closed, "verified": status == 0 and closed == 0, "cacheOnly": True, "signerIdentity": "not-observed"}


def cache_only_trust(path, stream):
    # SDK28000 wintrust.h/Softpub.h; Microsoft Learn WinVerifyTrust/WINTRUST_DATA.
    # LONG is 32 bits, zero alone means success. No UI; close on every verify.
    from ctypes import wintypes as W
    import msvcrt
    import uuid
    class FileInfo(C.Structure):
        _fields_ = [("size", W.DWORD), ("path", W.LPCWSTR), ("file", W.HANDLE), ("subject", C.c_void_p)]
    class Data(C.Structure):
        _fields_ = [("size", W.DWORD), ("policy", C.c_void_p), ("sip", C.c_void_p), ("ui", W.DWORD), ("revocation", W.DWORD), ("choice", W.DWORD), ("info", C.POINTER(FileInfo)), ("action", W.DWORD), ("state", W.HANDLE), ("url", W.LPCWSTR), ("flags", W.DWORD), ("context", W.DWORD), ("settings", C.c_void_p)]
    deny(sys.platform == "win32" and C.sizeof(FileInfo) == 32 and C.sizeof(Data) == 88 and C.sizeof(W.LONG) == 4, "TOOLS_TRUST_ABI")
    library = C.WinDLL("C:/Windows/System32/wintrust.dll", winmode=0x800)
    verify = library.WinVerifyTrust
    verify.restype = W.LONG
    verify.argtypes = [W.HWND, C.c_void_p, C.POINTER(Data)]
    action = (C.c_ubyte * 16).from_buffer_copy(uuid.UUID("00aac56b-cd44-11d0-8cc2-00c04fc295ee").bytes_le)
    info = FileInfo(C.sizeof(FileInfo), str(path), msvcrt.get_osfhandle(stream.fileno()), None)
    data = Data()
    data.size, data.ui, data.revocation, data.choice = C.sizeof(Data), 2, 1, 1
    data.info, data.flags = C.pointer(info), 0x1000 | 0x80
    return close_trust(lambda value: verify(W.HWND(-1), C.byref(action), C.byref(value)), data)


def minimal_environment(root):
    root = Path(root)
    return {"SystemRoot": "C:/Windows", "WINDIR": "C:/Windows", "PATH": "C:/Windows/System32", "TEMP": str(root/"tmp"), "TMP": str(root/"tmp"), "USERPROFILE": str(root/"home"), "PYTHONDONTWRITEBYTECODE": "1", "POWERSHELL_TELEMETRY_OPTOUT": "1", "POWERSHELL_UPDATECHECK": "Off", "DOTNET_CLI_TELEMETRY_OPTOUT": "1"}


def collect_version(argv, root, launch=subprocess.Popen):
    child = launch(argv, cwd=root, env=minimal_environment(root), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    chunks, length, failures = [], [0], []
    overflow = threading.Event()
    def read():
        try:
            while True:
                chunk = child.stdout.read(min(4096, 65537-length[0]))
                if not chunk:
                    return
                length[0] += len(chunk)
                if length[0] > 65536:
                    overflow.set()
                    return
                chunks.append(chunk)
        except Exception:
            failures.append(True)
    reader = threading.Thread(target=read)
    reader.start()
    deadline = time.monotonic()+15
    try:
        while child.poll() is None and not overflow.is_set() and not failures and time.monotonic() < deadline:
            time.sleep(0.01)
        if child.poll() is None:
            child.kill()
        code = child.wait(timeout=2)
        reader.join(timeout=2)
        deny(not reader.is_alive() and not overflow.is_set() and not failures and time.monotonic() < deadline, "TOOLS_VERSION_BOUND")
        return code, b"".join(chunks)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=2)
        reader.join(timeout=2)
        # If this is still blocked, outer Job termination remains mandatory;
        # never return a successful ownership proof with a live reader.
        deny(not reader.is_alive(), "TOOLS_VERSION_READER_UNKNOWN")
        child.stdout.close()


def role_worker(role, root, profile):
    verified_sources(root, bind=True)
    row = row_for(role, profile)
    deny(row["machine"] == 0xaa64, "TOOLS_EXEC_NATIVE")
    result = {"role": role, "signature": None, "versionExit": None, "versionOutputBytes": 0, "versionOutputSha256": None, "versionIdentifiers": [], "versionAttempted": False}
    with held_file(row) as stream:
        result["signature"] = cache_only_trust(row["path"], stream)
        if result["signature"]["verified"]:
            # Child inherits creation-time Job. No breakaway/profile/compiler
            # inputs. One bounded reader; raw vendor paths are never published.
            result["versionAttempted"] = True
            result["versionExit"], raw = collect_version(version_argv(role, profile), root)
            result["versionOutputBytes"], result["versionOutputSha256"] = len(raw), digest(raw)
            result["versionIdentifiers"] = list(dict.fromkeys(re.findall(rb"\b[0-9]{1,3}(?:\.[0-9]{1,5}){1,4}\b", raw)))[:8]
            result["versionIdentifiers"] = [x.decode("ascii") for x in result["versionIdentifiers"]]
    target = Path(root)/("result-"+role+".json")
    target.write_text(json.dumps(result, sort_keys=True)+"\n", encoding="utf8")


def run(root):
    deny(sys.platform == "win32" and os.environ.get("PROCESSOR_ARCHITECTURE", "").upper() in ("ARM64", ""), "TOOLS_NATIVE")
    context = verified_sources(root, bind=True)
    profile = load_profile()
    begin = time.monotonic()
    deadline = begin + 150
    result = {"schemaVersion": 1, "kind": "sorng-windows-arm-native-tools", "provenance": context, "phase": "inventory-before", "activeRole": None, "files": [], "roles": [], "success": False, "setupCompatibility": None, "loadedModulesVerified": False, "compilerTranslationUnitAttempted": False, "cefStarted": False, "nativeAcceptance": False, "hostedBuild": False, "producerProvenanceIntegrationRequired": True, "failure": None}
    sys.modules["observe"] = sys.modules[__name__]
    try:
        result["phase"], result["activeRole"] = "own-source-identity", "observe.py"
        own = next(row for row in context["sources"] if row["path"] == "native/windows-arm-native-tools/observe.py")
        with held_file({"path": str(Path(__file__).resolve()), "size": own["size"], "sha256": own["sha256"], "nlink": 1, "machine": None}):
            pass
        result["ownSourceIdentityVerified"] = True
        result["phase"], result["activeRole"] = "backend-import", None
        spec = importlib.util.spec_from_file_location("owned_tools_job", Path(__file__).with_name("job.py"))
        job = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(job)
        result["phase"] = "inventory-before"
        for row in profile["files"]:
            result["activeRole"] = row["role"]
            deny(time.monotonic() < deadline, "TOOLS_DEADLINE")
            with held_file(row):
                result["files"].append({"role": row["role"], "size": row["size"], "sha256": row["sha256"], "machine": row["machine"], "nlink": row["nlink"], "pinMatched": True})
        for role in ROLES:
            result["phase"], result["activeRole"] = "owned-role", role
            remaining = deadline - time.monotonic() - 30
            deny(remaining > 0, "TOOLS_DEADLINE")
            proof = job.run_observation(role, root, min(20, remaining))
            result["roles"].append({"role": role, "job": proof})
            deny(proof["success"] and proof["cleanupVerified"] and proof["activeAtEnd"] == 0 and proof["logReadersStopped"] and proof["parentHandleClosed"], "TOOLS_JOB_UNCONFIRMED")
            observed = json.loads((Path(root)/("result-"+role+".json")).read_text())
            result["roles"][-1]["observation"] = observed
            deny(observed["signature"]["verified"], "TOOLS_SIGNATURE_UNVERIFIED")
        result["phase"] = "inventory-after"
        for row in profile["files"]:
            result["activeRole"] = row["role"]
            deny(time.monotonic() < deadline, "TOOLS_DEADLINE")
            with held_file(row):
                pass
        verified_sources(root)
        result["phase"], result["activeRole"] = "complete", None
        result["success"] = True
    except Exception as error:
        result["failure"] = failure_code(error)
    result["versionCommandsAllZero"] = len(result["roles"]) == len(ROLES) and all(row.get("observation", {}).get("versionExit") == 0 for row in result["roles"])
    result["toolchainUsabilityProven"] = False
    result["elapsedMs"] = int((time.monotonic()-begin)*1000)
    (Path(root)/"observation.json").write_text(json.dumps(result, indent=2)+"\n", encoding="utf8")
    return 0 if result["success"] else 1


if __name__ == "__main__":
    try:
        deny(len(sys.argv) in (3, 4), "TOOLS_ARGUMENTS")
        if sys.argv[1] == "--role":
            deny(len(sys.argv) == 4 and sys.argv[2] in ROLES, "TOOLS_ARGUMENTS")
            role_worker(sys.argv[2], Path.cwd(), load_profile())
        else:
            deny(sys.argv[1] == "--observe" and len(sys.argv) == 3, "TOOLS_ARGUMENTS")
            raise SystemExit(run(Path(sys.argv[2])))
    except Exception:
        raise SystemExit("TOOLS_OBSERVATION_FAILED")
