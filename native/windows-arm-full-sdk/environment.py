"""Three closed custom-toolchain environments; no global SDK or VS mutation."""
import json
import ntpath
from pathlib import Path
import re
from acquire import held, need, plain, save
import extract as material

CPUS = {"x64": "amd64", "x86": "amd64_x86", "arm64": "amd64_arm64"}
INSTALLED14 = {
    **{'host-'+n:'bin/Hostx64/arm64/'+n for n in ('cl.exe','link.exe','lib.exe')},
    **{'crt-'+n:'lib/arm64/'+n for n in ('libcmt.lib','libcpmt.lib','libvcruntime.lib','oldnames.lib')},
    **{'atl-'+n:'atlmfc/lib/arm64/'+n for n in ('atls.lib','uafxcw.lib')},
    **{'header-'+n:'include/'+n for n in ('vcruntime.h','vector','string')},
    **{'header-'+n:'atlmfc/include/'+n for n in ('atlbase.h','afxwin.h')},
}


def installed_inventory(profile, clock):
    """Observe complete fixed toolset roots before any executable admission."""
    toolset=Path(profile['vsRoot'])/'VC/Tools/MSVC'/profile['toolset']
    need(profile['toolset']=='14.51.36231' and
         str(toolset).replace('\\','/')=='C:/Program Files/Microsoft Visual Studio/18/Enterprise/VC/Tools/MSVC/14.51.36231','FULL_INSTALLED_ROOT')
    toolset=plain(toolset)
    roots=('include','atlmfc/include','lib/x64','lib/arm64','atlmfc/lib/x64','atlmfc/lib/arm64','bin/Hostx64/x64','bin/Hostx64/arm64')
    result=inventory_installed_roots(toolset,roots,profile['limits'],clock)
    validate_installed_inventory(profile,result)
    return result


def validate_installed_inventory(profile,result):
    expected=profile['installedMsvc14'];need(len(expected)==14 and {r['role']for r in expected}==set(INSTALLED14),'FULL_INSTALLED_PIN_SET')
    rows={r['path']:r for r in result['files']}
    for pin in expected:
        row=rows.get(INSTALLED14[pin['role']])
        need(row is not None and (row['bytes'],row['sha256'])==(pin['bytes'],pin['sha256']),'FULL_INSTALLED_PIN')
    return True


def inventory_installed_roots(toolset,roots,limits,clock):
    import hashlib
    import os
    import stat
    import time
    toolset=plain(toolset);root_before=material.signature(toolset.stat())
    end=min(clock.remaining(),limits['installedSeconds'])+time.monotonic()
    rows=[];total=0;aliases=set();visited=0
    def check():
        clock.remaining();need(time.monotonic()<end,'FULL_INSTALLED_DEADLINE')
    for role in roots:
        pending=[(plain(toolset/role),role)]
        while pending:
            check();directory,name=pending.pop();before=material.signature(directory.stat())
            need(stat.S_ISDIR(before[5]),'FULL_INSTALLED_DIRECTORY')
            with os.scandir(directory)as iterator:
                for entry in iterator:
                    visited+=1;need(visited<=limits['installedFiles'],'FULL_INSTALLED_BOUND')
                    check();relative=name+'/'+entry.name;material.data.member_name(relative)
                    need(relative.casefold()not in aliases,'FULL_INSTALLED_ALIAS');aliases.add(relative.casefold())
                    path=plain(directory/entry.name);info=path.lstat()
                    if stat.S_ISDIR(info.st_mode):pending.append((path,relative))
                    else:
                        need(stat.S_ISREG(info.st_mode)and info.st_nlink==1,'FULL_INSTALLED_FILE')
                        total+=info.st_size
                        need(len(rows)<limits['installedFiles'] and total<=limits['installedBytes'],'FULL_INSTALLED_BOUND')
                        pin,_=material.held(path,clock,maximum=limits['installedFileBytes'])
                        rows.append({'path':relative,'bytes':pin['bytes'],'sha256':pin['sha256']})
            need(material.directory_identity(material.signature(directory.stat()))==material.directory_identity(before),'FULL_INSTALLED_CHANGED')
    need(material.directory_identity(material.signature(toolset.stat()))==material.directory_identity(root_before),'FULL_INSTALLED_CHANGED')
    rows.sort(key=lambda r:r['path'])
    raw=json.dumps(rows,sort_keys=True,separators=(',',':')).encode()
    need(len(raw)<=16*1024**2,'FULL_INSTALLED_REPORT_BOUND')
    return {'kind':'windows-arm-full-installed-source-inventory','roots':list(roots),'files':rows,
            'bytes':total,'visited':visited,'sha256':hashlib.sha256(raw).hexdigest(),'executed':False,'previous14AreCompleteClosure':False}


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
             sdk / "bin" / profile["sdkVersion"] / "x64", root / "runtime/x64", Path("C:/Windows/System32"), Path("C:/Windows")]
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
                  "VS_CRT_ROOT": str(Path(root) / "runtime/x64"), "SDK_ROOT": str(Path(root) / "Windows Kits/10"),
                  "SDK_VERSION": profile["sdkVersion"]}}
    # Values stay in this private operational context. Public summaries expose role/hash only.
    save(Path(root) / "environment-private.json", {"cpus": environments, **result})
    return environments, result


def setup_argv(root, profile, cpu):
    need(cpu in CPUS, "ENV_CPU")
    root = Path(root)
    return [profile["python"]["path"], "-I", "-B", str(root / "chromium/build/toolchain/win/setup_toolchain.py"),
            str(root / "custom-vs"), str(root / "Windows Kits/10"), str(root / "runtime/x64"),
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
    # FindFileInEnvList checks cl.exe exists, then returns its containing directory.
    need(absolute(values["vc_bin_dir"]) == (vc + "/bin/Hostx64/" + cpu).replace("\\", "/").casefold(), "ENV_SETUP_CPU")
    def flags(key, prefix, paths):
        actual = values[key]
        need(type(actual) is list and len(actual) == len(paths) and
             all(type(x) is str and x.startswith(prefix) for x in actual), "ENV_SETUP_TYPE")
        need([absolute(x[len(prefix):]) for x in actual] == [absolute(x) for x in paths], "ENV_SETUP_PATHS")
        # Match pinned setup_toolchain.py's q/ListToArgString, not just its list.
        quoted = [x if re.fullmatch(r"[a-zA-Z0-9._/\\:-]*", x) else '"' + x + '"' for x in actual]
        scalar = values[key.removesuffix("_list")]
        need(type(scalar) is str and scalar == " ".join(quoted), "ENV_SETUP_FLAGS")
    flags("libpath_flags_list", "-libpath:", expected["LIB"].split(";"))
    flags("libpath_lldlink_flags_list", "-libpath:", expected["LIB"].split(";"))
    flags("include_flags_I_list", "/I", expected["INCLUDE"].split(";"))
    flags("include_flags_imsvc_list", "-imsvc", expected["INCLUDE"].split(";"))
    # Upstream computes these optional summaries from raw, already-relativized
    # INCLUDE spellings. Cross-drive backslashes or a root-relative SDK path can
    # leave them empty. Derive exactly; never accept an arbitrary empty summary.
    msvc_dir, windows_kits_dir = "", ""
    for item in values["include_flags_I_list"]:
        include = item[2:]
        msvc_match = re.match(r"^.*/VC/Tools/MSVC/[^/]+/include$", include)
        if msvc_match is not None:
            msvc_dir = msvc_match.group(0)
        sdk_match = re.match(r"^(.*/Windows Kits/\d+/Include/[^/]+)/.*", include)
        if sdk_match is not None:
            windows_kits_dir = sdk_match.group(1)
    need(type(values["msvc_dir"]) is str and values["msvc_dir"] == msvc_dir, "ENV_SETUP_MSVC")
    need(type(values["windows_kits_dir"]) is str and values["windows_kits_dir"] == windows_kits_dir, "ENV_SETUP_SDK")
    path_parts = values["paths"]
    need(type(path_parts) is str, "ENV_SETUP_TYPE")
    wanted_paths = [str(Path(root) / "runtime/x64"), str(Path(profile["python"]["path"]).parent)] + expected["Path"].split(";")
    need([absolute(x) for x in path_parts.split(";")] == [absolute(x) for x in wanted_paths], "ENV_SETUP_PATHS")
    return {"cpu": cpu, "setupSucceeded": True, "sdkVersion": profile["sdkVersion"],
            "registeredSdkClaim": False, "adapterNotVendorOrigin": True}
