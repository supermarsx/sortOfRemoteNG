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
    print(json.dumps(result, indent=2, sort_keys=True))
    out = os.environ.get("PROBE_OUTPUT")
    if out:
        Path(out).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
