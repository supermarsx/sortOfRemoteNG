"""Pure/injected tests only. Never imports the Windows Job or runs vendor tools."""
import ast
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import acquire as a
import environment as e
import observe as o
import slice as s

P = json.loads((HERE / "profile.json").read_text())


def temporary():
    return tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())


def clock():
    return a.Clock(1000, 1000, wall=lambda: 1, mono=lambda: 1)


class Response(io.BytesIO):
    def __init__(self, raw, url):
        super().__init__(raw)
        self.status = 200
        self.url = url
        self.headers = {"Content-Length": str(len(raw))}
    def geturl(self):
        return self.url


class AcquisitionTests(unittest.TestCase):
    def test_both_clock_views_expire_and_do_not_reset(self):
        self.assertEqual(a.Clock(10, 20, wall=lambda: 3, mono=lambda: 5).remaining(), 7)
        for wall, mono in [(10, 5), (3, 20)]:
            with self.assertRaisesRegex(a.Denied, "ACQ_DEADLINE"):
                a.Clock(10, 20, wall=lambda: wall, mono=lambda: mono).remaining()

    def test_fixed_download_exact_hash_and_create_new(self):
        raw, url = b"fixed public bytes", "https://fixed.invalid/public"
        spec = {"url": url, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        with temporary() as temp:
            path = Path(temp) / "download"
            opener = Mock(side_effect=lambda *args, **kwargs: Response(raw, url))
            got = a.fixed_download(spec, path, clock(), 100, url, opener)
            self.assertEqual(got["sha256"], spec["sha256"])
            with self.assertRaises(FileExistsError):
                a.fixed_download(spec, path, clock(), 100, url, opener)
            self.assertEqual(opener.call_count, 1)

    def test_download_wrong_url_denies_before_network(self):
        opener = Mock()
        with self.assertRaisesRegex(a.Denied, "ACQ_FIXED_SPEC"):
            a.fixed_download({"url": "https://other.invalid", "bytes": 1}, Path("unused"), clock(), 10, "https://fixed.invalid", opener)
        opener.assert_not_called()

    def test_download_hash_or_eof_mismatch_preserves_failure_bytes(self):
        for raw in (b"bad", b"x"):
            with temporary() as temp:
                p = Path(temp) / "partial"
                url = "https://fixed.invalid"
                response = Response(raw, url)
                response.headers["Content-Length"] = "3"
                with self.assertRaises(a.Denied):
                    a.fixed_download({"url": url, "bytes": 3, "sha256": "0" * 64}, p, clock(), 10, url, lambda *x, **y: response)
                self.assertTrue(p.exists())
                self.assertEqual(p.read_bytes(), raw)

    def test_redirect_encoding_size_and_cap_deny(self):
        for field, value in (("redirect", "https://else.invalid"), ("Content-Encoding", "gzip"), ("Content-Length", "500")):
            with temporary() as temp:
                response = Response(b"abc", "https://fixed.invalid")
                if field == "redirect":
                    response.url = value
                else:
                    response.headers[field] = value
                with self.assertRaises(a.Denied):
                    a.fixed_download({"url": "https://fixed.invalid", "bytes": 3, "sha256": "0" * 64}, Path(temp) / "x", clock(), 3, "https://fixed.invalid", lambda *x, **y: response)

    def test_sdk_projection_uses_owned_windows_kits_layout(self):
        self.assertEqual(a.destination(a.IDS[0], "c/Include/10.0.28000.0/um/Windows.h"), "Windows Kits/10/Include/10.0.28000.0/um/Windows.h")
        self.assertEqual(a.destination(a.IDS[1], "c/um/arm64/kernel32.lib"), "Windows Kits/10/Lib/10.0.28000.0/um/arm64/kernel32.lib")
        with self.assertRaisesRegex(a.Denied, "ACQ_LAYOUT"):
            a.destination(a.IDS[1], "c/um/x64/kernel32.lib")

    def test_sdk_overlap_rejected_before_extract(self):
        entries = {a.IDS[0]: {"c/Include/A.h": {}, "c/Include/a.h": {}}}
        with self.assertRaisesRegex(a.Denied, "ACQ_OVERLAP"):
            a.projection([{"id": a.IDS[0]}], entries)

    def test_opc_three_types_only_and_no_sdk_projection(self):
        self.assertEqual(a.opc_kind("_rels/.rels"), "relationships")
        self.assertEqual(a.opc_kind("[Content_Types].xml"), "content-types")
        self.assertEqual(a.opc_kind("package/services/metadata/core-properties/" + "a" * 32 + ".psmdcp"), "core-properties")
        for bad in ("../x", "package/services/metadata/core-properties/one.psmdcp", "other.xml"):
            self.assertIsNone(a.opc_kind(bad))

    def test_held_rejects_mutated_hash_and_hardlink(self):
        with temporary() as temp:
            p = Path(temp) / "x"
            p.write_bytes(b"good")
            with self.assertRaisesRegex(a.Denied, "ACQ_HASH"):
                a.held(p, clock(), sha256="0" * 64)
            link = Path(temp) / "other"
            os.link(p, link)
            with self.assertRaisesRegex(a.Denied, "ACQ_FILE"):
                a.held(p, clock())

    def test_tar_path_grammar_denies_traversal_and_aliases(self):
        for name in ("../a", "/root", "C:/a", "a//b", "a/./b", "a\\b", "a/../b", "a\0b"):
            with self.assertRaises(a.Denied, msg=name):
                a.tar_name(name)
        self.assertEqual(a.tar_name("bin/clang-cl.exe"), "bin/clang-cl.exe")

    def tar(self, base, members):
        p = Path(base) / "sample.tar.xz"
        with tarfile.open(p, "w:xz", format=tarfile.USTAR_FORMAT) as f:
            for name, data, kind in members:
                item = tarfile.TarInfo(name)
                item.type = kind
                item.size = len(data) if kind == tarfile.REGTYPE else 0
                if kind == tarfile.SYMTYPE:
                    item.linkname = "outside"
                f.addfile(item, io.BytesIO(data) if item.isfile() else None)
        return p

    def test_tar_real_roundtrip_hash_and_unknown_link_denial(self):
        for kind in (tarfile.REGTYPE, tarfile.SYMTYPE):
            with temporary() as temp:
                p = self.tar(temp, [("bin/tool", b"bytes", kind)])
                if kind == tarfile.REGTYPE:
                    rows = a.extract_tar(p, Path(temp) / "out", P["limits"], clock())
                    self.assertEqual(rows[0]["sha256"], hashlib.sha256(b"bytes").hexdigest())
                else:
                    with self.assertRaisesRegex(a.Denied, "ACQ_TAR_TYPE"):
                        a.extract_tar(p, Path(temp) / "out", P["limits"], clock())

    def test_tar_count_size_case_duplicate_denials(self):
        samples = [([("A", b"a", tarfile.REGTYPE), ("a", b"b", tarfile.REGTYPE)], {}),
                   ([("a", b"abc", tarfile.REGTYPE)], {"tarMemberBytes": 2}),
                   ([("a", b"abc", tarfile.REGTYPE)], {"tarExpandedBytes": 2}),
                   ([("a", b"a", tarfile.REGTYPE), ("b", b"b", tarfile.REGTYPE)], {"tarFiles": 1})]
        for members, changes in samples:
            with temporary() as temp:
                limits = {**P["limits"], **changes}
                with self.assertRaises(a.Denied):
                    a.extract_tar(self.tar(temp, members), Path(temp) / "out", limits, clock())

    def test_tar_implicit_directory_case_alias_is_not_normalized(self):
        with temporary() as temp:
            archive = self.tar(temp, [("Dir/a", b"a", tarfile.REGTYPE), ("dir/b", b"b", tarfile.REGTYPE)])
            with self.assertRaisesRegex(a.Denied, "ACQ_TAR_CASE"):
                a.extract_tar(archive, Path(temp) / "out", P["limits"], clock())


class SetupTests(unittest.TestCase):
    def pair(self):
        state = {"installationPath": P["vsRoot"].replace("/", "\\"), "installationVersion": P["vsVersion"], "selectedPackages": []}
        packages = {"packages": [{"id": name, "version": "18.11.0.0"} for name in (*P["setupComponents"], *o.COMPONENT_PACKAGES)]}
        return state, packages

    def test_real_split_schema_old_assumption_red_new_projection_green(self):
        state, packages = self.pair()
        self.assertNotIn("packages", state)
        with self.assertRaisesRegex(a.Denied, "OBS_SETUP_PACKAGES"):
            o.setup_projection(state, state, P)
        self.assertTrue(o.setup_projection(state, packages, P)["registeredPackageReferencesObserved"])

    def test_setup_typed_subreasons_missing_duplicate_version_path(self):
        for change, reason in (("path", "OBS_SETUP_PATH"), ("version", "OBS_SETUP_VERSION_MISMATCH"),
                               ("missing", "OBS_SETUP_COMPONENT_MISSING"), ("duplicate", "OBS_SETUP_DUPLICATE"),
                               ("type", "OBS_SETUP_PACKAGES"), ("packageVersion", "OBS_SETUP_PACKAGE_VERSION")):
            state, package = self.pair()
            if change == "path":
                state["installationPath"] = "C:/Other/VS"
            elif change == "version":
                state["installationVersion"] = "18.10.0.0"
            elif change == "missing":
                package["packages"].pop()
            elif change == "duplicate":
                package["packages"].append(package["packages"][0])
            elif change == "type":
                package["packages"] = {}
            else:
                package["packages"][0]["version"] = "arbitrary"
            with self.assertRaisesRegex(a.Denied, reason):
                o.setup_projection(state, package, P)

    def test_windows_paths_do_not_normalize_escape_into_acceptance(self):
        for path in ("C:/owned/../foreign", "C:/owned/C:/bad", "//server/share", "C:/owned//x", "relative"):
            with self.assertRaises(a.Denied):
                o.windows_path(path)

    def test_os_hardlink_exception_cannot_admit_owned_path(self):
        with temporary() as temp:
            file = Path(temp) / "vcruntime140.dll"
            file.write_bytes(b"not an OS role")
            with self.assertRaisesRegex(a.Denied, "OBS_OS_SCOPE"):
                o.system_crt(file, clock())


class EnvironmentTests(unittest.TestCase):
    def test_three_cpus_keep_same_sdk_and_distinct_library_roots(self):
        rows = {cpu: e.rows(Path("D:/owned"), P, cpu) for cpu in e.CPUS}
        for cpu, value in rows.items():
            self.assertIn("/" + cpu, value["LIB"].replace("\\", "/"))
            self.assertIn("10.0.28000.0", value["LIB"])
            self.assertNotIn("GH_TOKEN", value)
        self.assertEqual(len(set(x["LIB"] for x in rows.values())), 3)

    def test_generated_adapter_is_closed_without_ambient_argument_expansion(self):
        text = e.script({cpu: e.rows(Path("D:/owned"), P, cpu) for cpu in e.CPUS}, P["sdkVersion"]).decode("ascii")
        self.assertIn('if not "%~3"=="" exit /b 91', text)
        self.assertNotIn("%*", text)
        self.assertNotIn("setlocal", text)
        self.assertEqual(text.count("exit /b 0"), 3)
        self.assertNotIn("reg ", text.lower())

    def test_environment_script_metacharacters_and_wrong_sdk_deny(self):
        for bad in ("C:/x&calc", "C:/x%PATH%", "C:/x\nset x=y", 'C:/x"'):
            with self.assertRaises(a.Denied):
                e.safe_value(bad)
        with self.assertRaises(a.Denied):
            e.script({}, "10.0.26100.0")

    def setup_text(self, cpu):
        root = Path("D:/owned")
        value = e.rows(root, P, cpu)
        vc = P["vsRoot"] + "/VC/Tools/MSVC/" + P["toolset"]
        fields = {"vc_bin_dir": vc + "/bin/Hostx64/" + cpu + "/cl.exe", "msvc_dir": vc + "/include",
                  "windows_kits_dir": "D:/owned/Windows Kits/10/Include/10.0.28000.0",
                  "paths": str(root / "host-runtime") + ";" + str(Path(P["python"]["path"]).parent) + ";" + value["Path"]}
        for key, prefix, source in (("include_flags_I", "/I", "INCLUDE"), ("include_flags_imsvc", "-imsvc", "INCLUDE"),
                                    ("libpath_flags", "-libpath:", "LIB"), ("libpath_lldlink_flags", "-libpath:", "LIB")):
            fields[key + "_list"] = [prefix + x.replace("\\", "/") for x in value[source].split(";")]
            fields[key] = " ".join(fields[key + "_list"])
        return fields

    def test_actual_setup_scope_parser_cpu_and_path_positive_negative(self):
        for cpu in e.CPUS:
            fields = self.setup_text(cpu)
            text = "\n".join(key + " = " + json.dumps(value) for key, value in fields.items())
            self.assertTrue(e.verify_setup(text, Path("D:/owned"), P, cpu)["setupSucceeded"])
            fields["libpath_flags_list"][0] = "-libpath:C:/unowned/arm64"
            with self.assertRaises(a.Denied):
                e.verify_setup("\n".join(key + " = " + json.dumps(value) for key, value in fields.items()), Path("D:/owned"), P, cpu)


class SliceTests(unittest.TestCase):
    def setUp(self):
        self.context, self.inputs, self.prefix = s.BOUND_CONTEXT, s.BOUND_INPUTS, s.BOUND_VENDOR_PREFIX
        s.BOUND_CONTEXT, s.BOUND_INPUTS, s.BOUND_VENDOR_PREFIX = "a" * 64, "b" * 64, "c" * 64
    def tearDown(self):
        s.BOUND_CONTEXT, s.BOUND_INPUTS, s.BOUND_VENDOR_PREFIX = self.context, self.inputs, self.prefix

    def test_closed_worker_exact_argv_and_unknown_role_no_kernel(self):
        root = Path.cwd()
        argv = s.worker_argv("c", root, P)
        with patch("pathlib.Path.cwd", return_value=root):
            self.assertEqual(s.closed_worker_command(argv, root, P), "c")
            for index in (0, 3, 4, 5, 6, 7, 8, 9, 10):
                mutated = argv.copy()
                mutated[index] += "foreign"
                with self.assertRaises(a.Denied):
                    s.closed_worker_command(mutated, root, P)
        with patch.object(s, "load_job") as loader, patch.object(sys, "argv", ["slice.py", "--worker", "unknown", "root", "a", "--execute", "b"]):
            with self.assertRaises(a.Denied):
                s.main()
            loader.assert_not_called()

    def test_all_fixed_vendor_commands_never_execute_generated_images(self):
        root = Path("D:/owned")
        for role in s.ROLES:
            argv = s.tool_argv(role, root, P)
            self.assertNotIn(str(root / "bin/c.exe"), argv[:1])
            if role in ("c", "stl", "atl", "mfc", "builtins"):
                self.assertIn("--target=aarch64-pc-windows", argv)
                self.assertIn("/WX", argv)
                self.assertIn("/MT", argv)
            if role.startswith("link-"):
                self.assertIn("/MACHINE:ARM64", argv)
                self.assertTrue(argv[0].endswith("lld-link.exe"))
        self.assertIn("clang_rt.builtins-aarch64.lib", " ".join(s.tool_argv("link-c", root, P)))
        self.assertTrue(s.tool_argv("resource", root, P)[0].replace("\\", "/").endswith("x64/rc.exe"))

    def test_coff_native_arm_positive_other_machine_denied(self):
        raw = bytearray(20)
        raw[0:2] = (0xaa64).to_bytes(2, "little")
        self.assertEqual(s.coff(raw)["machine"], 0xaa64)
        for machine in (0x8664, 0xa641, 0x14c):
            raw[0:2] = machine.to_bytes(2, "little")
            with self.assertRaises(a.Denied):
                s.coff(raw)

    def test_relative_dependency_escape_denies_before_any_file_open(self):
        for value in ("C:/owned/../foreign", "C:/owned/C:/foreign", "C:/foreign/header.h"):
            with patch.object(s, "plain") as reader:
                with self.assertRaises(a.Denied):
                    s.dependency_scope(value, [("vc", Path("C:/owned"))])
                reader.assert_not_called()

    def test_collect_actual_body_injected_child_only_preserves_exit_and_flags(self):
        fake = Mock()
        fake.stdout = io.BytesIO(b"fixed diagnostic")
        fake.poll.return_value = 23
        launch = Mock(return_value=fake)
        result, raw = s.collect(["fixed-tool"], Path.cwd(), {"fixed": "env"}, launch)
        self.assertEqual((result["exit"], raw), (23, b"fixed diagnostic"))
        self.assertEqual(launch.call_args.kwargs["creationflags"], 0x08000000)
        self.assertEqual(launch.call_args.kwargs["env"], {"fixed": "env"})
        fake.kill.assert_not_called()

    def test_error_summary_never_echoes_arbitrary_exception(self):
        self.assertEqual(s.closed_error(OSError("secret path")), "SLICE_OPERATION_FAILED")
        self.assertEqual(s.closed_error(ValueError("secret path")), "SLICE_OPERATION_FAILED")
        self.assertEqual(s.closed_error(ValueError("SLICE_COFF_MACHINE")), "SLICE_COFF_MACHINE")

    def test_actual_tu_writer_is_binary_create_new_exact_lf(self):
        with temporary() as temp:
            (Path(temp) / "sources").mkdir()
            s.write_sources(Path(temp))
            for name, (extension, source) in s.SOURCES.items():
                self.assertEqual((Path(temp) / "sources" / (name + "." + extension)).read_bytes(), source.encode("utf-8"))
                self.assertNotIn(b"\r", source.encode("utf-8"))
            with self.assertRaises(FileExistsError):
                s.write_sources(Path(temp))

    def test_coherently_repinned_input_map_cannot_replace_parent_sealed_digest(self):
        mutated = b"[]"
        sidecar = hashlib.sha256(mutated).hexdigest().encode("ascii") + b"\n"
        with patch.object(s, "held", side_effect=[({}, mutated), ({}, sidecar)]) as opened:
            with self.assertRaisesRegex(a.Denied, "SLICE_INPUT_MAP"):
                s.actual_inputs(Path("D:/owned"), P, clock())
            self.assertEqual(opened.call_count, 2)

    def test_output_inventory_escaping_paths_denied_before_open(self):
        for value in ("../outside", "C:/foreign", "\\\\server\\share", "/absolute", "a//b", "a/./b"):
            with self.assertRaises(a.Denied):
                s.relative_output(Path("D:/owned"), value)

    def test_lld_command_uses_supported_verbose_flag(self):
        command = s.tool_argv("link-stl", Path("D:/owned"), P)
        self.assertIn("/VERBOSE", command)
        self.assertNotIn("/VERBOSE:LIB", command)

    def test_nonfinite_or_boolean_context_clock_denies(self):
        for value in (True, float("nan"), float("inf"), "clock"):
            with self.assertRaises(a.Denied):
                s.context_clock({"wallWorkEnd": value, "monotonicWorkEnd": 1000})

    def aggregate_fixture(self, root, last_bytes=3 * 1024**2):
        for directory in ("logs", "results", "jobs"):
            (root / directory).mkdir()
        rows = []
        for index, role in enumerate(s.ROLES[:8]):
            size = 4 * 1024**2 if index < 7 else last_bytes
            data = b"x" * size
            (root / "logs" / (role + ".log")).write_bytes(data)
            a.save(root / "results" / (role + ".json"), {"role": role, "exit": 0, "failure": None,
                 "postVerified": True, "childReaped": True, "readerJoined": True,
                 "outputBytes": size, "outputSha256": hashlib.sha256(data).hexdigest()})
            (root / "jobs" / role).mkdir()
            a.save(root / "jobs" / role / "receipt.json", {"success": True, "rootExit": 0,
                 "cleanupVerified": True, "rootReaped": True, "activeAtEnd": 0, "logReadersStopped": True})
            rows.append(s.completed_vendor_row(root, role, clock()))
        return rows

    def test_actual_31mib_prefix_leaves_1mib_and_exact_boundary_blocks_before_invocation(self):
        for last, remaining in ((3 * 1024**2, 1024**2), (4 * 1024**2, 0)):
            with temporary() as temp:
                root = Path(temp)
                prior = self.aggregate_fixture(root, last)
                if remaining:
                    pin = s.seal_vendor_prefix(root, "resource", prior, P, clock())
                    self.assertEqual(s.vendor_remaining(root, "resource", pin, P, clock()), remaining)
                else:
                    with patch.object(s, "collect") as launch:
                        with self.assertRaisesRegex(a.Denied, "SLICE_TOTAL_OUTPUT_CAP"):
                            s.seal_vendor_prefix(root, "resource", prior, P, clock())
                        launch.assert_not_called()

    def test_forged_prefix_or_hardlinked_prior_log_cannot_spend_budget(self):
        with temporary() as temp:
            root = Path(temp)
            prior = self.aggregate_fixture(root)
            pin = s.seal_vendor_prefix(root, "resource", prior, P, clock())
            prefix = root / "vendor-prefix-resource.json"
            original = prefix.read_bytes()
            mutated = json.loads(original)
            mutated["contextSha256"] = "d" * 64
            prefix.write_text(json.dumps(mutated))
            with self.assertRaisesRegex(a.Denied, "ACQ_HASH"):
                s.vendor_remaining(root, "resource", pin, P, clock())
            prefix.write_bytes(original)
            os.link(root / "logs" / (s.ROLES[0] + ".log"), root / "owned-hardlink")
            with self.assertRaisesRegex(a.Denied, "ACQ_FILE"):
                s.vendor_remaining(root, "resource", pin, P, clock())

    def test_actual_collector_exact_remaining_cap_and_overshoot_stop_reap_join(self):
        class Child:
            def __init__(self, raw, live):
                self.stdout = io.BytesIO(raw)
                self.code = None if live else 0
                self.killed = False
                self.waited = False
            def poll(self):
                return self.code
            def kill(self):
                self.killed = True
                self.code = -9
            def wait(self, timeout):
                self.waited = True
                return self.code
        for extra in (0, 1):
            child = Child(b"x" * (1024**2 + extra), live=bool(extra))
            result, raw = s.collect(["fixed"], Path.cwd(), {}, Mock(return_value=child), maximum=1024**2, total_limited=True)
            self.assertEqual(len(raw), 1024**2)
            self.assertTrue(result["childReaped"] and result["readerJoined"] and child.waited)
            self.assertEqual(result["failure"], "SLICE_TOTAL_OUTPUT_CAP" if extra else None)
            self.assertEqual(child.killed, bool(extra))
        with patch.object(s.subprocess, "Popen") as forbidden:
            with self.assertRaisesRegex(a.Denied, "SLICE_TOTAL_OUTPUT_CAP"):
                s.collect(["fixed"], Path.cwd(), {}, forbidden, maximum=0, total_limited=True)
            forbidden.assert_not_called()

    def test_cap_remains_first_failure_when_owned_child_kill_and_reap_fail(self):
        child = Mock()
        child.stdout = io.BytesIO(b"abcd")
        child.poll.return_value = None
        child.kill.side_effect = OSError("private error omitted")
        child.wait.side_effect = s.subprocess.TimeoutExpired("fixed", 1)
        result, raw = s.collect(["fixed"], Path.cwd(), {}, Mock(return_value=child), maximum=3, total_limited=True)
        self.assertEqual(raw, b"abc")
        self.assertEqual(result["failure"], "SLICE_TOTAL_OUTPUT_CAP")
        self.assertFalse(result["childReaped"])
        self.assertTrue(result["readerJoined"])

    def test_builtin_requires_same_actual_symbol_module_record_not_search_text(self):
        row = b" 0001:00001300       __udivti3                  0000000140001300     clang_rt.builtins-aarch64:udivti3.o\n"
        self.assertTrue(s.builtin_contribution(row)["contributionObserved"])
        for bad in (b"Searching clang_rt.builtins-aarch64.lib\n__udivti3\n", row.replace(b"clang_rt.builtins-aarch64", b"libcmt"), row + row):
            with self.assertRaises(a.Denied):
                s.builtin_contribution(bad)

    def test_backend_nonadmission_functions_and_kernel_abi_are_identical(self):
        original = (HERE.parent / "windows-arm-native-compile/job.py").read_text()
        current = (HERE / "job.py").read_text()
        old = {x.name: ast.dump(x, include_attributes=False) for x in ast.parse(original).body if isinstance(x, (ast.FunctionDef, ast.ClassDef))}
        new = {x.name: ast.dump(x, include_attributes=False) for x in ast.parse(current).body if isinstance(x, (ast.FunctionDef, ast.ClassDef))}
        self.assertEqual(set(old), set(new))
        for name in old.keys() - {"environment", "approved_tool_command", "load_profile"}:
            self.assertEqual(old[name], new[name], name)
        self.assertEqual(hashlib.sha256((HERE.parent / "windows-arm-native-compile/job.py").read_bytes()).hexdigest(), P["jobFoundationSha256"])

    def test_profile_pins_do_not_claim_deferred_or_actual_execution(self):
        self.assertFalse(P["deferredRust"]["acquiredInThisSlice"])
        self.assertFalse(P["conditionalRuntime"]["selected"])
        self.assertIsNone(P["sourceId"])
        self.assertFalse(P["buildAdmission"])
        self.assertEqual(P["limits"]["compileSeconds"], 900)
        self.assertEqual(P["limits"]["roleSeconds"], 90)


if __name__ == "__main__":
    unittest.main()
