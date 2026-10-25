"""Fixed hosted x64 inventory. No tool, compiler, installer or network execution."""
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import sys
import time

PROFILE_SHA = "baf9b745aa3c8f05e1c7d336afdef5d4ec90fa08f2a280820f4b56083f8fdeda"
MAX_FILE = 256 * 1024**2
MAX_TOTAL = 1024**3
MAX_ROWS = 40
MAX_OUTPUT = 128 * 1024
ERRORS = frozenset({"INV_PATH", "INV_LINK", "INV_IDENTITY", "INV_CHANGED", "INV_BIRTH", "INV_FILE_BOUND", "INV_TOTAL_BOUND", "INV_ROW_BOUND", "INV_DEADLINE", "INV_DIRECTORY_BOUND", "INV_DIRECTORY", "INV_PROFILE", "INV_JSON", "INV_PROVENANCE", "INV_PE", "INV_OUTPUT", "INV_RUNTIME"})


def require(value, code):
    if not value:
        raise ValueError(code)


def code(error):
    return error.args[0] if type(error) is ValueError and len(error.args) == 1 and error.args[0] in ERRORS else "INV_INCOMPLETE"


def windows_absolute(value):
    require(type(value) is str and len(value) <= 512 and not re.search(r"[\x00-\x1f\x7f]", value), "INV_PATH")
    normalized = value.replace("\\", "/")
    require(re.fullmatch(r"[A-Za-z]:/[^:]+", normalized) and not any(p in ("", ".", "..") for p in normalized[3:].split("/")), "INV_PATH")
    require(ntpath.normpath(value).replace("\\", "/").casefold() == normalized.casefold(), "INV_PATH")
    return normalized


def plain(path):
    path = Path(path)
    require(path.is_absolute(), "INV_PATH")
    actual = path.resolve(strict=True)
    require(str(actual).casefold() == str(path).casefold() if os.name == "nt" else actual == path, "INV_PATH")
    for item in (path, *path.parents):
        s = item.lstat()
        require(not stat.S_ISLNK(s.st_mode) and not getattr(s, "st_file_attributes", 0) & 0x400, "INV_LINK")
    return actual


def full(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink, getattr(s, "st_birthtime_ns", None), getattr(s, "st_file_attributes", 0))


def shared(s, birth_required):
    birth = getattr(s, "st_birthtime_ns", None)
    require(not birth_required or type(birth) is int, "INV_BIRTH")
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink, birth)


def stable(p0, f0, p1, f1, birth_required):
    require(full(p0) == full(p1) and full(f0) == full(f1), "INV_CHANGED")
    require(shared(p0, birth_required) == shared(f0, birth_required) == shared(p1, birth_required) == shared(f1, birth_required), "INV_IDENTITY")


class Budget:
    def __init__(self, seconds=180, clock=time.monotonic):
        self.clock = clock
        self.end = clock() + seconds
        self.total = 0
        self.rows = 0
        self.stage = "profile"
        self.role = "profile"

    def check(self):
        require(self.clock() < self.end, "INV_DEADLINE")

    def admit(self, size):
        self.check()
        require(type(size) is int and 0 <= size <= MAX_FILE, "INV_FILE_BOUND")
        require(self.total + size <= MAX_TOTAL, "INV_TOTAL_BOUND")
        require(self.rows < MAX_ROWS, "INV_ROW_BOUND")
        self.total += size
        self.rows += 1

    def phase(self, stage, role=None):
        require(stage in {"profile", "msvc-directories", "installed-file", "setup-directories", "setup-state", "capacity", "complete"}, "INV_PROFILE")
        require(role is None or role in {"profile", "setup-state"} or role in {r[0] for r in targets({"visualStudioRoot": "C:/fixed", "toolset": "14.51.36231", "sdkRoot": "C:/fixed-sdk", "sdk": "10.0.28000.0"})}, "INV_PROFILE")
        self.stage, self.role = stage, role


def file_record(path, budget, retain=0, maximum=MAX_FILE):
    """Hash one held regular file; never follow a reparse point or accept a hardlink."""
    budget.check()
    path = Path(path)
    try:
        path = plain(path)
    except FileNotFoundError:
        # Validate the existing parent chain even for an absent leaf.
        parent = path.parent
        while not parent.exists():
            budget.check()
            parent = parent.parent
        plain(parent)
        budget.admit(0)
        return {"present": False}, b""
    p0 = path.lstat()
    require(stat.S_ISREG(p0.st_mode) and p0.st_nlink == 1, "INV_LINK")
    require(p0.st_size <= maximum, "INV_FILE_BOUND")
    budget.admit(p0.st_size)
    h = hashlib.sha256()
    prefix = bytearray()
    count = 0
    with path.open("rb") as stream:
        f0 = os.fstat(stream.fileno())
        require(stat.S_ISREG(f0.st_mode) and f0.st_nlink == 1 and not getattr(f0, "st_file_attributes", 0) & 0x400, "INV_LINK")
        require(shared(p0, os.name == "nt") == shared(f0, os.name == "nt"), "INV_IDENTITY")
        plain(path)
        while True:
            budget.check()
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            count += len(chunk)
            require(count <= p0.st_size, "INV_CHANGED")
            h.update(chunk)
            if len(prefix) < retain:
                prefix.extend(chunk[:retain - len(prefix)])
        f1 = os.fstat(stream.fileno())
        p1 = path.lstat()
        stable(p0, f0, p1, f1, os.name == "nt")
        plain(path)
    require(count == p0.st_size, "INV_CHANGED")
    return {"present": True, "bytes": count, "sha256": h.hexdigest(), "stableHeldIdentity": True, "independentFile": True}, bytes(prefix)


def immediate_directories(root, maximum, budget, pattern):
    budget.check()
    root = plain(root)
    before = root.stat()
    require(stat.S_ISDIR(before.st_mode), "INV_DIRECTORY")
    names = []
    # Count every entry, including unrecognized names, without opening its target.
    with os.scandir(root) as entries:
        for entry in entries:
            budget.check()
            require(len(names) < maximum, "INV_DIRECTORY_BOUND")
            require(re.fullmatch(pattern, entry.name) is not None, "INV_DIRECTORY")
            item = root / entry.name
            s = item.lstat()
            require(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and not getattr(s, "st_file_attributes", 0) & 0x400, "INV_LINK")
            names.append(entry.name)
    require(full(before) == full(root.lstat()), "INV_CHANGED")
    plain(root)
    return sorted(names)


def pe_machine(prefix, size):
    require(size >= 64 and prefix[:2] == b"MZ", "INV_PE")
    offset = struct.unpack_from("<I", prefix, 60)[0]
    require(64 <= offset <= 65512 and offset + 6 <= len(prefix) and offset + 6 <= size and prefix[offset:offset + 4] == b"PE\0\0", "INV_PE")
    machine = struct.unpack_from("<H", prefix, offset + 4)[0]
    require(machine in (0x8664, 0xaa64, 0xa641), "INV_PE")
    return machine


def json_object(raw):
    require(0 < len(raw) <= 4 * 1024**2, "INV_JSON")
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result, "INV_JSON")
            result[key] = value
        return result
    try:
        result = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("INV_JSON") from None
    require(type(result) is dict, "INV_JSON")
    return result


def provenance_projection(data, profile):
    # Only closed public component/package IDs and numeric versions escape this function.
    require(type(data.get("installationPath")) is str and windows_absolute(data["installationPath"]).casefold() == profile["visualStudioRoot"].casefold(), "INV_PROVENANCE")
    version = data.get("installationVersion")
    require(type(version) is str and re.fullmatch(r"\d{1,3}(?:\.\d{1,8}){3}", version), "INV_PROVENANCE")
    packages = data.get("packages")
    require(type(packages) is list and len(packages) <= 10000, "INV_PROVENANCE")
    wanted = set(profile["components"]) | {
        "Microsoft.VC.14.51.Tools.HostX64.TargetARM64.base", "Microsoft.VC.14.51.CRT.ARM64.Desktop.base",
        "Microsoft.VC.14.51.ATL.ARM64.base", "Microsoft.VC.14.51.MFC.ARM64.base"}
    rows = []
    seen = set()
    for row in packages:
        require(type(row) is dict, "INV_PROVENANCE")
        if row.get("id") not in wanted:
            continue
        ident, value = row["id"], row.get("version")
        require(ident not in seen and type(value) is str and re.fullmatch(r"\d{1,3}(?:\.\d{1,8}){2,3}", value), "INV_PROVENANCE")
        seen.add(ident)
        rows.append({"id": ident, "version": value})
    return {"installationVersion": version, "manifestVersionMatch": version == profile["visualStudioVersion"], "packages": sorted(rows, key=lambda r: r["id"]), "requiredComponentsObserved": all(x in seen for x in profile["components"])}


def targets(profile):
    vc = Path(profile["visualStudioRoot"]) / "VC/Tools/MSVC" / profile["toolset"]
    sdk = Path(profile["sdkRoot"])
    rows = [("host-" + name, vc / "bin/Hostx64/arm64" / name, "pe") for name in ("cl.exe", "link.exe", "lib.exe")]
    rows += [("crt-" + name, vc / "lib/arm64" / name, "file") for name in ("libcmt.lib", "libcpmt.lib", "libvcruntime.lib", "oldnames.lib")]
    rows += [("atl-" + name, vc / "atlmfc/lib/arm64" / name, "file") for name in ("atls.lib", "uafxcw.lib")]
    rows += [("header-" + name, vc / "include" / name, "file") for name in ("vcruntime.h", "vector", "string")]
    rows += [("header-" + name, vc / "atlmfc/include" / name, "file") for name in ("atlbase.h", "afxwin.h")]
    rows += [("sdk-" + name, sdk / "Include" / profile["sdk"] / area / name, "file") for area, name in (("um", "Windows.h"), ("ucrt", "stdio.h"))]
    rows += [("sdk-" + name, sdk / "Lib" / profile["sdk"] / area / "arm64" / name, "file") for area, name in (("um", "kernel32.lib"), ("um", "user32.lib"), ("um", "uuid.lib"), ("ucrt", "libucrt.lib"))]
    rows.append(("sdk-resource-tool", sdk / "bin" / profile["sdk"] / "x64/rc.exe", "pe"))
    require(len(rows) <= 32 and len({r[0] for r in rows}) == len(rows), "INV_PROFILE")
    return rows


def profile(raw):
    require(len(raw) <= 16384 and hashlib.sha256(raw).hexdigest() == PROFILE_SHA, "INV_PROFILE")
    p = json_object(raw)
    require(p["mode"] == "inventory" and p["toolset"] == "14.51.36231" and p["sdk"] == "10.0.28000.0", "INV_PROFILE")
    for key in ("visualStudioRoot", "sdkRoot", "instancesRoot"):
        windows_absolute(p[key])
    return p


def inventory(p, budget, progress=None):
    budget.phase("msvc-directories")
    msvc = Path(p["visualStudioRoot"]) / "VC/Tools/MSVC"
    versions = immediate_directories(msvc, 8, budget, r"\d{1,2}\.\d{1,2}\.\d{1,8}")
    if progress is not None:
        progress["observedMsvcVersions"] = versions
    require(p["toolset"] in versions, "INV_DIRECTORY")
    rows = []
    if progress is not None:
        progress["partialFixedFileRows"] = rows
    for role, path, kind in targets(p):
        budget.phase("installed-file", role)
        pin, prefix = file_record(path, budget, 65536 if kind == "pe" else 0)
        if pin["present"] and kind == "pe":
            pin["machine"] = pe_machine(prefix, pin["bytes"])
        rows.append({"role": role, **pin})
    instances = Path(p["instancesRoot"])
    budget.phase("setup-directories")
    names = immediate_directories(instances, 16, budget, r"[a-fA-F0-9]{8}")
    matches = []
    for name in names:
        budget.phase("setup-state", "setup-state")
        pin, raw = file_record(instances / name / "state.json", budget, 4 * 1024**2 + 1, 4 * 1024**2)
        if not pin["present"]:
            continue
        data = json_object(raw)
        path = data.get("installationPath")
        if type(path) is str and windows_absolute(path).casefold() == p["visualStudioRoot"].casefold():
            matches.append({"statePin": pin, **provenance_projection(data, p)})
    require(len(matches) == 1, "INV_PROVENANCE")
    budget.check()
    return {"files": rows, "publicSetupProvenance": matches[0], "toolsetDirectoryMatch": True,
            "sdk28000Complete": all(r["present"] for r in rows if r["role"].startswith("sdk-")),
            "missingRoles": [r["role"] for r in rows if not r["present"]], "hashedBytes": budget.total, "hashedFileRows": budget.rows}


def encode(result):
    raw = (json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
    require(len(raw) <= MAX_OUTPUT, "INV_OUTPUT")
    return raw


def runtime_fields(env):
    result = {}
    for key in ("ImageOS", "ImageVersion", "RUNNER_ARCH"):
        value = env.get(key, "")
        require(type(value) is str and re.fullmatch(r"[A-Za-z0-9._-]{0,64}", value), "INV_RUNTIME")
        result[key] = value
    return result


def main():
    result = {"kind": "sorng-windows-x64-arm-inventory", "mode": "inventory", "success": False,
              "compilerExecuted": False, "installerExecuted": False, "downloaded": False, "nativeAcceptance": False, "buildAdmission": False}
    budget = None
    try:
        require(sys.argv[1:] == ["--inventory"] and os.name == "nt" and os.environ.get("PROCESSOR_ARCHITECTURE", "").upper() == "AMD64", "INV_RUNTIME")
        budget = Budget()
        _, raw_profile = file_record(Path(__file__).with_name("profile.json"), budget, 16385, 16384)
        p = profile(raw_profile)
        result["runtime"] = runtime_fields(os.environ)
        result["manifestImageMatch"] = result["runtime"]["ImageVersion"] == p["image"]
        result["manifestCommit"] = p["manifestCommit"]
        result["identityQualification"] = "Held-file and per-view pre/post checks; concurrent ancestor replacement with complete ABA restoration is not excluded."
        result.update(inventory(p, budget, result))
        budget.phase("capacity")
        disk = shutil.disk_usage(Path(p["visualStudioRoot"]).anchor)
        result["capacity"] = {"logicalCpu": os.cpu_count(), "diskTotalBytes": disk.total, "diskFreeBytes": disk.free}
        budget.check()
        budget.phase("complete")
        result["success"] = True
    except Exception as error:
        result["failure"] = code(error)
        result["failureStage"] = budget.stage if budget is not None else "runtime"
        result["failureRole"] = budget.role if budget is not None else None
        result["completedFixedRows"] = len(result.get("partialFixedFileRows", []))
    sys.stdout.buffer.write(encode(result))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
