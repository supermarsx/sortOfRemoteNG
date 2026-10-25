"""Three closed custom-toolchain environments; no global SDK or VS mutation."""
import json
import ntpath
from pathlib import Path
import re
from acquire import held, need, plain, save
from observe import windows_path

CPUS = {"x64": "amd64", "x86": "amd64_x86", "arm64": "amd64_arm64"}


def safe_value(value):
    need(type(value) is str and 0 < len(value) <= 4096 and
         not re.search(r"[\x00-\x1f\x7f&|<>^%!\"]", value), "ENV_VALUE")
    return value


def rows(root, profile, cpu):
    need(cpu in CPUS, "ENV_CPU")
    root = Path(root)
    vc = Path(profile["vsRoot"]) / "VC/Tools/MSVC" / profile["toolset"]
    sdk = root / "Windows Kits/10"
    inc = [vc / "include", vc / "atlmfc/include"] + [sdk / "Include" / profile["sdkVersion"] / x for x in ("ucrt", "shared", "um", "winrt", "cppwinrt")]
    lib = [vc / "lib" / cpu, vc / "atlmfc/lib" / cpu] + [sdk / "Lib" / profile["sdkVersion"] / x / cpu for x in ("ucrt", "um")]
    paths = [Path(profile["python"]["path"]).parent, root / "llvm/bin", vc / "bin/Hostx64" / cpu,
             sdk / "bin" / profile["sdkVersion"] / "x64", root / "host-runtime", Path("C:/Windows/System32"), Path("C:/Windows")]
    return {"INCLUDE": ";".join(map(str, inc)), "LIB": ";".join(map(str, lib)),
            "LIBPATH": ";".join(map(str, lib)), "Path": ";".join(map(str, paths)),
            "SystemRoot": "C:/Windows", "WINDIR": "C:/Windows", "TEMP": str(root / "tmp"),
            "TMP": str(root / "tmp"), "USERPROFILE": str(root / "home"), "VSLANG": "1033",
            "CL": "", "_CL_": "", "LINK": "", "_LINK_": ""}


def script(environments, sdk_version):
    need(set(environments) == set(CPUS) and sdk_version == "10.0.28000.0", "ENV_PROFILE")
    lines = ["@echo off", 'if not "%~3"=="" exit /b 91',
             'if not "%~2"=="10.0.28000.0" exit /b 92']
    for cpu, argument in CPUS.items():
        lines.append('if "%~1"=="' + argument + '" goto ' + cpu)
    lines.append("exit /b 93")
    for cpu in CPUS:
        lines.append(":" + cpu)
        for key, value in environments[cpu].items():
            need(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", key), "ENV_KEY")
            if value:
                safe_value(value)
            lines.append('set "' + key + "=" + value + '"')
        lines.append("exit /b 0")
    return ("\r\n".join(lines) + "\r\n").encode("ascii", "strict")


def create(root, profile, clock):
    environments = {cpu: rows(root, profile, cpu) for cpu in CPUS}
    for value in environments.values():
        for key in ("INCLUDE", "LIB", "LIBPATH", "Path"):
            for directory in value[key].split(";"):
                safe_value(directory)
                need(plain(directory).is_dir(), "ENV_DIRECTORY")
    custom = Path(root) / "custom-vs"
    custom.mkdir()
    (custom / "VC").mkdir()
    raw = script(environments, profile["sdkVersion"])
    with (custom / "VC/vcvarsall.bat").open("xb") as f:
        f.write(raw)
    import hashlib
    pin, _ = held(custom / "VC/vcvarsall.bat", clock, len(raw), hashlib.sha256(raw).hexdigest())
    result = {"environmentOrigin": "owned-closed-custom-vcvars-adapter", "registeredSdkClaim": False,
              "adapter": pin, "cpus": list(CPUS), "cefEnvironment": {
                  "WIN_CUSTOM_TOOLCHAIN": "1", "DEPOT_TOOLS_WIN_TOOLCHAIN": "0", "CEF_VCVARS": "none",
                  "GYP_MSVS_OVERRIDE_PATH": str(custom), "GYP_MSVS_VERSION": "2026",
                  "VS_CRT_ROOT": str(Path(root) / "host-runtime"), "SDK_ROOT": str(Path(root) / "Windows Kits/10"),
                  "SDK_VERSION": profile["sdkVersion"]}}
    # Values stay in this private operational context. Public summaries expose role/hash only.
    save(Path(root) / "environment-private.json", {"cpus": environments, **result})
    return environments, result


def setup_argv(root, profile, cpu):
    need(cpu in CPUS, "ENV_CPU")
    root = Path(root)
    return [profile["python"]["path"], "-I", "-B", str(root / "chromium/build/toolchain/win/setup_toolchain.py"),
            str(root / "custom-vs"), str(root / "Windows Kits/10"), str(root / "host-runtime"),
            "win", cpu, "environment." + cpu]


def verify_setup(text, root, profile, cpu):
    need(type(text) is str and len(text.encode("utf-8")) <= 4 * 1024**2, "ENV_SETUP_BOUND")
    values = {}
    for line in text.splitlines():
        need(len(line) <= 65536, "ENV_SETUP_BOUND")
        match = re.fullmatch(r"([A-Za-z_]+) = (.+)", line)
        need(match and match[1] not in values, "ENV_SETUP_FORMAT")
        try:
            values[match[1]] = json.loads(match[2])
        except (ValueError, TypeError):
            raise ValueError("ENV_SETUP_FORMAT") from None
    required = {"vc_bin_dir", "include_flags_I", "include_flags_I_list", "include_flags_imsvc", "include_flags_imsvc_list",
                "paths", "libpath_flags", "libpath_flags_list", "libpath_lldlink_flags", "libpath_lldlink_flags_list", "msvc_dir", "windows_kits_dir"}
    need(set(values) == required, "ENV_SETUP_FIELDS")
    expected = rows(root, profile, cpu)
    vc = str(Path(profile["vsRoot"]) / "VC/Tools/MSVC" / profile["toolset"])
    # setup output is relative to the operation cwd when on the same drive.
    def absolute(value):
        need(type(value) is str, "ENV_SETUP_TYPE")
        return ntpath.normpath(value if ntpath.isabs(value) else ntpath.join(str(root), value)).replace("\\", "/").casefold()
    need(absolute(values["vc_bin_dir"]) == (vc + "/bin/Hostx64/" + cpu + "/cl.exe").replace("\\", "/").casefold(), "ENV_SETUP_CPU")
    # Upstream MSVC_DIR's full match ends in /include despite its variable name.
    need(absolute(values["msvc_dir"]) == (vc + "/include").replace("\\", "/").casefold(), "ENV_SETUP_MSVC")
    need(absolute(values["windows_kits_dir"]) == str(Path(root) / "Windows Kits/10/Include" / profile["sdkVersion"]).replace("\\", "/").casefold(), "ENV_SETUP_SDK")
    def flags(key, prefix, paths):
        actual = values[key]
        need(type(actual) is list and len(actual) == len(paths) and
             all(type(x) is str and x.startswith(prefix) for x in actual), "ENV_SETUP_TYPE")
        need([absolute(x[len(prefix):]) for x in actual] == [absolute(x) for x in paths], "ENV_SETUP_PATHS")
    flags("libpath_flags_list", "-libpath:", expected["LIB"].split(";"))
    flags("libpath_lldlink_flags_list", "-libpath:", expected["LIB"].split(";"))
    flags("include_flags_I_list", "/I", expected["INCLUDE"].split(";"))
    flags("include_flags_imsvc_list", "-imsvc", expected["INCLUDE"].split(";"))
    path_parts = values["paths"]
    need(type(path_parts) is str, "ENV_SETUP_TYPE")
    wanted_paths = [str(Path(root) / "host-runtime"), str(Path(profile["python"]["path"]).parent)] + expected["Path"].split(";")
    need([absolute(x) for x in path_parts.split(";")] == [absolute(x) for x in wanted_paths], "ENV_SETUP_PATHS")
    return {"cpu": cpu, "setupSucceeded": True, "sdkVersion": profile["sdkVersion"],
            "registeredSdkClaim": False, "adapterNotVendorOrigin": True}
