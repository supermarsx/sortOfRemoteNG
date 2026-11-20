"""Evidence only (branch winarm-image-315-requal): regenerate the image-dependent MSVC pins from the real hosted bytes.

Reads the reviewed profile.json, re-observes every installedMsvc14 and runtime17 source on the running image with the
pipeline's own PE reader, and writes the replacement rows plus the tool-lock rows. Nothing is built or admitted.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import extract  # noqa: E402
import environment  # noqa: E402

VS = "C:/Program Files/Microsoft Visual Studio/18/Enterprise"
OLD = "14.51.36231"


def observe(path):
    raw = Path(path).read_bytes()
    return raw, hashlib.sha256(raw).hexdigest(), os.stat(path).st_nlink


def main():
    profile = json.loads((HERE / "profile.json").read_bytes())
    toolsets = sorted(p.name for p in Path(VS + "/VC/Tools/MSVC").iterdir() if p.is_dir())
    new = [t for t in toolsets if t.startswith("14.5") and t != OLD]
    assert len(new) == 1, toolsets
    toolset = new[0]
    out = {"kind": "windows-arm-requal-probe", "imageVersion": os.environ.get("ImageVersion"), "toolsets": toolsets,
           "toolset": toolset, "installedMsvc14": [], "runtime17": [], "toolLockMsvc": [], "toolLockRuntime": []}
    for pin in profile["installedMsvc14"]:
        rel = environment.INSTALLED14[pin["role"]]
        raw, digest, _ = observe(VS + "/VC/Tools/MSVC/" + toolset + "/" + rel)
        row = dict(pin, bytes=len(raw), sha256=digest)
        if "machine" in pin:
            row["machine"] = extract.pe_metadata(raw)["machine"]
        out["installedMsvc14"].append(row)
        out["toolLockMsvc"].append({"path": "Program Files/Microsoft Visual Studio/18/Enterprise/VC/Tools/MSVC/" + toolset + "/" + rel,
                                    "size": len(raw), "sha256": digest})
    for old in profile["runtime17"]["rows"]:
        source = old["source"].replace(OLD, toolset)
        raw, digest, nlink = observe(source)
        pe = extract.pe_metadata(raw)
        version = ".".join(map(str, pe["version"]["fileVersion"])) if pe["version"] is not None else None
        row = dict(old, source=source, bytes=len(raw), sha256=digest, machine=pe["machine"], fileVersion=version,
                   imports=pe["imports"], delayImports=pe["delayImports"], sourceNlink=nlink)
        if old["sourceFolderVersion"] is not None:
            row["sourceFolderVersion"] = toolset
        out["runtime17"].append(row)
        out["toolLockRuntime"].append({"path": old["destination"], "size": len(raw), "sha256": digest})
    out["runtime17TotalBytes"] = sum(r["bytes"] for r in out["runtime17"])
    target = Path(os.environ["RUNNER_TEMP"]) / "msvc-pin-probe" / "requal-probe.json"
    target.write_text(json.dumps(out, indent=1))
    print("toolset", toolset, "runtime17 bytes", out["runtime17TotalBytes"])


main()
