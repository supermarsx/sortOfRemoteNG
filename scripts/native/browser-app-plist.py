"""Generate the development app plist; release uses Tauri's real bundler plist."""
import json
import pathlib
import plistlib
import sys

config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
extra = config.get("bundle", {}).get("macOS", {}).get("infoPlist")
plist = {}
if extra:
    with (pathlib.Path(sys.argv[3]) / extra).open("rb") as source:
        plist = plistlib.load(source)
plist.update({
    "CFBundleExecutable": config["mainBinaryName"],
    "CFBundleIdentifier": config["identifier"],
    "CFBundleName": config["productName"],
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": "1",
    "CFBundleShortVersionString": "1.0",
    "LSMinimumSystemVersion": "14.0",
    "NSHighResolutionCapable": True,
})
with pathlib.Path(sys.argv[2]).open("xb") as output:
    plistlib.dump(plist, output)
