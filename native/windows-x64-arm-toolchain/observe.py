"""Bounded public installed-tool observations; no vendor or generated image execution."""
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import stat
import struct
from acquire import held, need, plain, save

COMPONENT_PACKAGES = (
    "Microsoft.VC.14.51.Tools.HostX64.TargetARM64.base",
    "Microsoft.VC.14.51.CRT.ARM64.Desktop.base",
    "Microsoft.VC.14.51.ATL.ARM64.base", "Microsoft.VC.14.51.MFC.ARM64.base")
CRT_NAMES = ("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "concrt140.dll")


def windows_path(value):
    need(type(value) is str and len(value) <= 512 and
         re.fullmatch(r"[A-Za-z]:[\\/][^:\x00-\x1f\x7f]+", value), "OBS_PATH")
    text = value.replace("\\", "/")
    need(all(p not in ("", ".", "..") for p in text[3:].split("/")) and
         ntpath.normpath(value).replace("\\", "/").casefold() == text.casefold(), "OBS_PATH")
    return text


def setup_projection(state, installed, profile):
    need(type(state) is dict and type(installed) is dict, "OBS_SETUP_ROOT")
    need(windows_path(state.get("installationPath")).casefold() ==
         profile["vsRoot"].casefold(), "OBS_SETUP_PATH")
    version = state.get("installationVersion")
    need(type(version) is str and re.fullmatch(r"\d{1,3}(?:\.\d{1,8}){3}", version), "OBS_SETUP_VERSION_TYPE")
    need(version == profile["vsVersion"], "OBS_SETUP_VERSION_MISMATCH")
    packages = installed.get("packages")
    need(type(packages) is list and 0 < len(packages) <= 10000, "OBS_SETUP_PACKAGES")
    wanted = set(profile["setupComponents"]) | set(COMPONENT_PACKAGES)
    rows, seen = [], set()
    for item in packages:
        need(type(item) is dict, "OBS_SETUP_PACKAGE_TYPE")
        ident = item.get("id")
        if ident not in wanted:
            continue
        version = item.get("version")
        need(ident not in seen, "OBS_SETUP_DUPLICATE")
        need(type(version) is str and re.fullmatch(r"\d{1,3}(?:\.\d{1,8}){2,3}", version), "OBS_SETUP_PACKAGE_VERSION")
        seen.add(ident)
        rows.append({"id": ident, "version": version})
    need(wanted <= seen, "OBS_SETUP_COMPONENT_MISSING")
    return {"installationVersion": state["installationVersion"],
            "packages": sorted(rows, key=lambda x: x["id"]),
            "registeredPackageReferencesObserved": True,
            "installedPayloadCompletenessClaimed": False}


def setup_pair(instance, profile, clock):
    # Both files MUST be from one held, physical instance directory.
    instance = plain(instance)
    need(re.fullmatch(r"[0-9a-fA-F]{8}", instance.name), "OBS_SETUP_INSTANCE")
    rows, values = [], []
    for name in ("state.json", "state.packages.json"):
        pin, raw = held(instance / name, clock, retain=True, maximum=4 * 1024**2)
        try:
            value = json.loads(raw.decode("utf-8", "strict"))
        except (ValueError, UnicodeError):
            raise ValueError("OBS_SETUP_JSON") from None
        rows.append({"role": name, **pin})
        values.append(value)
    return {"records": rows, **setup_projection(values[0], values[1], profile)}


def installed_paths(profile):
    vc = Path(profile["vsRoot"]) / "VC/Tools/MSVC" / profile["toolset"]
    result = [("host-" + n, vc / "bin/Hostx64/arm64" / n) for n in ("cl.exe", "link.exe", "lib.exe")]
    result += [("crt-" + n, vc / "lib/arm64" / n) for n in ("libcmt.lib", "libcpmt.lib", "libvcruntime.lib", "oldnames.lib")]
    result += [("atl-" + n, vc / "atlmfc/lib/arm64" / n) for n in ("atls.lib", "uafxcw.lib")]
    result += [("header-" + n, vc / "include" / n) for n in ("vcruntime.h", "vector", "string")]
    result += [("header-" + n, vc / "atlmfc/include" / n) for n in ("atlbase.h", "afxwin.h")]
    return result


def pe_machine(raw):
    need(len(raw) >= 64 and raw[:2] == b"MZ", "OBS_PE")
    at = struct.unpack_from("<I", raw, 60)[0]
    need(64 <= at <= 1024**2 and at + 6 <= len(raw) and raw[at:at + 4] == b"PE\0\0", "OBS_PE")
    return struct.unpack_from("<H", raw, at + 4)[0]


def system_crt(path, clock):
    """Exact four OS roles may have Windows-servicing hardlinks; never owned files."""
    path = plain(path)
    need(str(path).replace("\\", "/").casefold() in
         {("C:/Windows/System32/" + n).casefold() for n in CRT_NAMES}, "OBS_OS_SCOPE")
    p0 = path.lstat()
    need(stat.S_ISREG(p0.st_mode) and 0 < p0.st_size <= 32 * 1024**2 and p0.st_nlink >= 1, "OBS_OS_FILE")
    h, data = hashlib.sha256(), bytearray()
    with path.open("rb") as f:
        f0 = os.fstat(f.fileno())
        for b in iter(lambda: f.read(1024**2), b""):
            clock.remaining()
            need(len(data) + len(b) <= p0.st_size, "OBS_OS_FILE")
            h.update(b)
            data.extend(b)
        f1 = os.fstat(f.fileno())
    p1 = path.lstat()
    from acquire import signature, shared
    need(signature(p0) == signature(p1) and signature(f0) == signature(f1) and
         shared(p0) == shared(f0) == shared(p1) == shared(f1), "OBS_OS_CHANGED")
    need(len(data) == p0.st_size and pe_machine(data) == 0x8664, "OBS_OS_MACHINE")
    return {"role": path.name, "bytes": len(data), "sha256": h.hexdigest(),
            "nlink": p0.st_nlink, "machine": 0x8664, "independentSource": False}, bytes(data)


def observe(root, profile, clock):
    rows = []
    for (role, path), expected in zip(installed_paths(profile), profile["installedMsvc14"]):
        need(role == expected["role"], "OBS_PROFILE_ORDER")
        pin, prefix = held(path, clock, expected["bytes"], expected["sha256"],
                           retain=role.startswith("host-"), maximum=256 * 1024**2)
        if role.startswith("host-"):
            need(pe_machine(prefix) == 0x8664, "OBS_HOST_MACHINE")
        rows.append({"role": role, "path": str(path), **pin})
    instances = plain(Path("C:/ProgramData/Microsoft/VisualStudio/Packages/_Instances"))
    directories = []
    with os.scandir(instances) as it:
        for entry in it:
            clock.remaining()
            need(len(directories) < 16, "OBS_INSTANCE_BOUND")
            need(entry.is_dir(follow_symlinks=False) and re.fullmatch(r"[0-9a-fA-F]{8}", entry.name), "OBS_INSTANCE_NAME")
            directories.append(Path(entry.path))
    matches = []
    for directory in directories:
        pin, raw = held(directory / "state.json", clock, retain=True, maximum=4 * 1024**2)
        value = json.loads(raw.decode("utf-8", "strict"))
        if type(value) is dict and type(value.get("installationPath")) is str and windows_path(value["installationPath"]).casefold() == profile["vsRoot"].casefold():
            matches.append(setup_pair(directory, profile, clock))
    need(len(matches) == 1, "OBS_SETUP_UNIQUE")
    runtime = Path(root) / "host-runtime"
    runtime.mkdir()
    crt = []
    for name in CRT_NAMES:
        record, raw = system_crt(Path("C:/Windows/System32") / name, clock)
        with (runtime / name).open("xb") as f:
            f.write(raw)
        held(runtime / name, clock, record["bytes"], record["sha256"], maximum=32 * 1024**2)
        crt.append(record)
    result = {"installedMsvc14": rows, "setup": matches[0], "observedHostCrt": crt,
              "allCefCrtOrDiaProven": False, "compilerExecuted": False}
    save(Path(root) / "installed-observations.json", result)
    return result
