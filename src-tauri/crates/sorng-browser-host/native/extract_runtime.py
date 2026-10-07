"""Extract an already digest-verified CEF distribution into a NEW directory.

Python >= 3.12 is required for tarfile's data filter. No network or browser launch.
The caller verifies the immutable artifact pin before and after this operation.
"""
import json
import pathlib
import plistlib
import re
import shutil
import sys
import tarfile


def extract(archive, destination):
    archive = pathlib.Path(archive).resolve(strict=True)
    destination = pathlib.Path(destination)
    if sys.version_info < (3, 12):
        raise RuntimeError("Safe CEF extraction requires Python 3.12 or newer")
    # Refuse reuse, including an empty directory or a dangling link.
    destination.mkdir(parents=False, exist_ok=False)
    raw = destination / "distribution"
    raw.mkdir()
    with tarfile.open(archive, "r:bz2") as package:
        members = package.getmembers()
        if not members or len(members) > 50000:
            raise ValueError("Unexpected CEF archive inventory")
        roots = set()
        names = set()
        for member in members:
            name = member.name.rstrip("/")
            parts = pathlib.PurePosixPath(name).parts
            if (not parts or name.startswith("/") or "\\" in name or ":" in name
                    or any(part in (".", "..") for part in parts)
                    or name in names or not (member.isfile() or member.isdir()
                                             or member.issym() or member.islnk())):
                raise ValueError("Unsafe archive member")
            names.add(name)
            roots.add(parts[0])
            if member.issym() or member.islnk():
                if "\\" in member.linkname or ":" in member.linkname:
                    raise ValueError("Unsafe archive link")
            tarfile.data_filter(member, str(raw))
        if len(roots) != 1 or not next(iter(roots)).startswith("cef_binary_"):
            raise ValueError("Unexpected CEF distribution root")
        package.extractall(raw, members=members, filter="data")
    distribution = raw / next(iter(roots))
    runtime = destination / "runtime"
    shutil.copytree(distribution / "Release", runtime, symlinks=True)
    resources = distribution / "Resources"
    if resources.is_dir():
        shutil.copytree(resources, runtime, symlinks=True, dirs_exist_ok=True)
    for name in ("include", "cmake", "libcef_dll"):
        shutil.copytree(distribution / name, runtime / name, symlinks=True)
    for name in ("CMakeLists.txt", "CREDITS.html", "LICENSE.txt", "README.txt"):
        source = distribution / name
        if source.is_file():
            shutil.copy2(source, runtime / name)
    print(json.dumps({"runtime": str(runtime), "distribution": str(distribution)}))


if __name__ == "__main__":
    if sys.argv[1] == "plist":
        with open(sys.argv[2], "rb") as source:
            info = plistlib.load(source)
        identifier = info.get("CFBundleIdentifier", "")
        if (info.get("CFBundleExecutable") != sys.argv[3]
                or info.get("CFBundlePackageType") != "APPL"
                or info.get("LSMinimumSystemVersion") not in ("14.0", "14.0.0")
                or not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", identifier)):
            raise ValueError("Application plist must match executable, APPL type and macOS 14.0")
        print(json.dumps({"identifier": identifier}))
    else:
        extract(*sys.argv[1:])
