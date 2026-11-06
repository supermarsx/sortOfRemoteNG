"""Read-only hosted-runner image fact probe (no source build, no SDK, no execution).

Records, for the image it runs on, exactly the host facts the reviewed
image-qualified source/GN profiles pin: the node/git host tools, the 18-file Git
ucrt64 loader closure and its import edges (computed with the repository's own
import-graph code), the pinned Python, and the system command presence/hash. It
then compares them with the pinned 20261030.294.1 and 20261021.278.1 profiles.
The output is evidence for a human image review; it admits nothing.
"""
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import acquire as data  # noqa: E402
import extract  # noqa: E402
import producer  # noqa: E402

PYTHON = "C:/hostedtoolcache/windows/Python/3.12.10/x64/python.exe"
SYSTEM_COMMANDS = [
    "C:/Windows/System32/cmd.exe",
    "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "C:/Windows/System32/findstr.exe",
    "C:/Windows/System32/fc.exe",
]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def observe(name):
    path = Path(name)
    try:
        info = os.stat(name)
        raw = path.read_bytes()
    except OSError as error:
        return {"path": name, "present": False, "error": type(error).__name__}
    return {"path": name, "present": True, "bytes": len(raw), "sha256": sha(raw), "nlink": info.st_nlink, "raw": raw}


def public(row):
    return {key: value for key, value in row.items() if key != "raw"}


def closure():
    clock = data.Clock(time.time() + 900, time.monotonic() + 900)
    state = {"rows": [], "edges": []}
    rows = []
    missing = []

    def read(candidate):
        row = observe(candidate["path"])
        if not row["present"]:
            missing.append(candidate["path"])
            return {"imports": [], "delayImports": []}
        pe = extract.pe_metadata(row["raw"])
        rows.append(
            {
                "path": row["path"],
                "bytes": row["bytes"],
                "sha256": row["sha256"],
                "nlink": row["nlink"],
                "machine": pe["machine"],
            }
        )
        return {"imports": pe["imports"], "delayImports": pe["delayImports"]}

    seeds = [row for row in producer.COMMAND_CANDIDATES if row["kind"] == "pe"]
    producer.command_import_graph(seeds, clock, read, state)
    return {
        "missing": missing,
        "rows": rows,
        "peBytes": sum(row["bytes"] for row in rows),
        "edgeCount": len(state["edges"]),
        "edgeSha256": producer.source_edges_digest(state["edges"]),
    }


def pinned(profile_name):
    raw = (HERE / profile_name).read_bytes()
    return json.loads(raw)["sourceGn"]


def compare(observed, profile_name):
    pin = pinned(profile_name)
    want = {row["path"].lower(): row for row in pin["hostClosure"]["rows"]}
    have = {row["path"].lower(): row for row in observed["rows"]}
    differences = []
    for key in sorted(set(want) | set(have)):
        a, b = want.get(key), have.get(key)
        if a is None or b is None:
            differences.append({"path": (a or b)["path"], "kind": "only-in-pin" if b is None else "only-observed"})
        else:
            changed = [name for name in ("bytes", "sha256", "nlink", "machine") if a[name] != b[name]]
            if changed:
                differences.append({"path": a["path"], "kind": "changed", "fields": changed})
    return {
        "profile": profile_name,
        "image": pin["hostClosure"]["image"],
        "rowsEqual": not differences,
        "differences": differences,
        "peBytesEqual": pin["hostClosure"]["peBytes"] == observed["peBytes"],
        "edgeCountEqual": pin["hostClosure"]["edgeCount"] == observed["edgeCount"],
        "edgeSha256Equal": pin["hostClosure"]["edgeSha256"] == observed["edgeSha256"],
        "hostToolsEqual": {
            role: {key: pin["hostTools"][role][key] for key in ("bytes", "sha256", "nlink")}
            == {key: next(r for r in observed["rows"] if r["path"] == pin["hostTools"][role]["path"])[key] for key in ("bytes", "sha256", "nlink")}
            if any(r["path"] == pin["hostTools"][role]["path"] for r in observed["rows"])
            else None
            for role in ("node", "git")
        },
        "hostToolPaths": {role: pin["hostTools"][role]["path"] for role in ("node", "git")},
    }


VSWHERE = "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
TREES = [
    "C:/Program Files/Microsoft Visual Studio",
    "C:/Program Files (x86)/Microsoft Visual Studio",
    "C:/Program Files (x86)/Windows Kits",
    "C:/Program Files (x86)/Microsoft SDKs",
]
KEY_TOOLS = ("cl.exe", "link.exe", "lib.exe", "rc.exe", "clang-cl.exe", "lld-link.exe", "ml64.exe", "midl.exe", "mt.exe")
MANIFESTS = ["C:/imagedata.json", "C:/software-report.md", "C:/Windows/System32/config/systemprofile/imagedata.json"]


def tree_facts(root, seconds=240):
    """Path+size digest of a whole tree (no content reads) plus sha256 of key tool binaries."""
    deadline = time.monotonic() + seconds
    top = {}
    digest = hashlib.sha256()
    key = []
    files = total = 0
    truncated = False
    if not os.path.isdir(root):
        return {"root": root, "present": False}
    for base, dirs, names in os.walk(root):
        dirs.sort()
        if time.monotonic() > deadline:
            truncated = True
            break
        for name in sorted(names):
            full = os.path.join(base, name).replace("\\", "/")
            try:
                size = os.stat(full).st_size
            except OSError:
                continue
            rel = full[len(root) + 1:]
            digest.update((rel + "\0" + str(size) + "\n").encode("utf-8", "replace"))
            files += 1
            total += size
            part = "/".join(rel.split("/")[:3])
            entry = top.setdefault(part, [0, 0])
            entry[0] += 1
            entry[1] += size
            if name.lower() in KEY_TOOLS and size < 200 * 1024 * 1024:
                try:
                    key.append({"path": full, "bytes": size, "sha256": sha(Path(full).read_bytes())})
                except OSError:
                    pass
    return {
        "root": root,
        "present": True,
        "files": files,
        "bytes": total,
        "pathSizeSha256": digest.hexdigest(),
        "truncated": truncated,
        "topLevel": {k: {"files": v[0], "bytes": v[1]} for k, v in sorted(top.items())},
        "keyTools": key,
    }


def image_toolchain():
    out = {"vswhere": None, "trees": [], "manifests": [], "toolcache": {}}
    if os.path.exists(VSWHERE):
        try:
            done = subprocess.run(
                [VSWHERE, "-all", "-prerelease", "-products", "*", "-format", "json", "-utf8"],
                capture_output=True, timeout=120, check=False,
            )
            out["vswhere"] = {"exit": done.returncode, "stdoutSha256": sha(done.stdout)}
            try:
                out["vswhere"]["instances"] = json.loads(done.stdout.decode("utf-8", "replace"))
            except ValueError:
                out["vswhere"]["raw"] = done.stdout.decode("utf-8", "replace")[:4000]
        except Exception as error:
            out["vswhere"] = {"error": type(error).__name__ + ": " + str(error)[:200]}
    for tree in TREES:
        out["trees"].append(tree_facts(tree))
    for name in MANIFESTS:
        if os.path.exists(name):
            raw = Path(name).read_bytes()
            row = {"path": name, "bytes": len(raw), "sha256": sha(raw)}
            if name.endswith(".json"):
                try:
                    row["content"] = json.loads(raw.decode("utf-8-sig"))
                except ValueError:
                    row["head"] = raw[:2000].decode("utf-8", "replace")
            else:
                row["head"] = raw[:200000].decode("utf-8", "replace")
            out["manifests"].append(row)
    cache = Path("C:/hostedtoolcache/windows")
    if cache.is_dir():
        for tool in sorted(cache.iterdir()):
            if tool.is_dir():
                out["toolcache"][tool.name] = sorted(v.name for v in tool.iterdir() if v.is_dir())
    return out


MSVC = "C:/Program Files/Microsoft Visual Studio/18/Enterprise/VC/Tools/MSVC/14.51.36231"
MSVC_ROOTS = ("include", "atlmfc/include", "lib/x64", "lib/arm64", "atlmfc/lib/x64", "atlmfc/lib/arm64",
              "bin/Hostx64/x64", "bin/Hostx64/arm64")
HASH_TREES = {
    "git": "C:/Program Files/Git",
    "python": "C:/hostedtoolcache/windows/Python/3.12.10/x64",
    "node": "C:/hostedtoolcache/windows/node/24.19.0/x64",
}
FILE_CAP = 256 * 1024 * 1024


def hash_tree(root, relative_roots=None, seconds=420):
    """Per-file sha256 rows for a tree (or selected sub-roots), sorted, with the pipeline's digest."""
    deadline = time.monotonic() + seconds
    rows = []
    unhashed = []
    bases = [root] if relative_roots is None else [root + "/" + r for r in relative_roots]
    truncated = False
    for base in bases:
        if not os.path.isdir(base):
            unhashed.append({"root": base, "error": "missing"})
            continue
        for here, dirs, names in os.walk(base):
            dirs.sort()
            if time.monotonic() > deadline:
                truncated = True
                break
            for name in sorted(names):
                full = os.path.join(here, name).replace("\\", "/")
                rel = full[len(root) + 1:]
                try:
                    size = os.stat(full).st_size
                    if size > FILE_CAP:
                        rows.append({"path": rel, "bytes": size, "sha256": None})
                        continue
                    rows.append({"path": rel, "bytes": size, "sha256": sha(Path(full).read_bytes())})
                except OSError as error:
                    unhashed.append({"path": rel, "error": type(error).__name__})
    rows.sort(key=lambda r: r["path"])
    raw = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    return {
        "root": root,
        "subRoots": relative_roots,
        "files": len(rows),
        "bytes": sum(r["bytes"] for r in rows),
        "rowsSha256": sha(raw),
        "truncated": truncated,
        "unhashed": unhashed[:50],
        "rows": rows,
    }


def consumed_inputs():
    out = {}
    msvc = hash_tree(MSVC, MSVC_ROOTS)
    pins = json.loads((HERE / "profile.json").read_bytes())["installedMsvc14"]
    import environment  # the pipeline's own role -> path table

    by_path = {r["path"]: r for r in msvc["rows"]}
    checks = []
    for pin in pins:
        row = by_path.get(environment.INSTALLED14[pin["role"]])
        checks.append(
            {
                "role": pin["role"],
                "path": environment.INSTALLED14[pin["role"]],
                "equal": bool(row) and (row["bytes"], row["sha256"]) == (pin["bytes"], pin["sha256"]),
            }
        )
    msvc["installedMsvc14Pins"] = checks
    msvc["installedMsvc14AllEqual"] = all(c["equal"] for c in checks)
    out["msvcToolset"] = msvc
    names = json.loads((HERE / "profile.json").read_bytes())["commandInventory"]["importGraph"]["systemNames"]
    system = []
    for name in names:
        row = observe("C:/Windows/System32/" + name)
        system.append(public(row))
    out["system32Named"] = system
    for key, root in HASH_TREES.items():
        out[key] = hash_tree(root)
    return out


def main():
    base = json.loads((HERE / "profile.json").read_bytes())
    python_pin = base.get("python", {})
    result = {
        "kind": "windows-arm-image-probe",
        "imageVersion": os.environ.get("ImageVersion"),
        "imageOS": os.environ.get("ImageOS"),
        "runnerOS": os.environ.get("RUNNER_OS"),
        "runnerArch": os.environ.get("RUNNER_ARCH"),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "pythonVersion": sys.version.split()[0],
        "executed": False,
        "admits": False,
    }
    py = observe(PYTHON)
    result["python"] = {
        **public(py),
        "pinnedPath": python_pin.get("path"),
        "pinnedBytes": python_pin.get("bytes"),
        "pinnedSha256": python_pin.get("sha256"),
        "equalToPin": py.get("present") is True
        and py.get("bytes") == python_pin.get("bytes")
        and py.get("sha256") == python_pin.get("sha256"),
    }
    result["systemCommands"] = [public(observe(name)) for name in SYSTEM_COMMANDS]
    try:
        observed = closure()
        result["hostClosure"] = observed
        result["comparisons"] = [
            compare(observed, "image-qualified-current-profile.json"),
            compare(observed, "image-qualified-20261021-profile.json"),
        ]
    except Exception as error:  # evidence run: report, never hide
        result["hostClosureError"] = type(error).__name__ + ": " + str(error)[:300]
    try:
        result["imageToolchain"] = image_toolchain()
    except Exception as error:
        result["imageToolchainError"] = type(error).__name__ + ": " + str(error)[:300]
    try:
        result["consumedInputs"] = consumed_inputs()
    except Exception as error:
        result["consumedInputsError"] = type(error).__name__ + ": " + str(error)[:300]
    summary = json.loads(json.dumps(result))
    for value in summary.get("consumedInputs", {}).values():
        if isinstance(value, dict):
            value.pop("rows", None)
    summary.get("imageToolchain", {}).pop("manifests", None)
    print(json.dumps(summary, indent=2, sort_keys=True)[:100000])
    out = os.environ.get("PROBE_OUTPUT")
    if out:
        Path(out).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
