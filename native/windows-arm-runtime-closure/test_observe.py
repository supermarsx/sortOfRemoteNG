import ast
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tested_observe", HERE / "observe.py")
o = importlib.util.module_from_spec(spec);spec.loader.exec_module(o)


def clock():
    return o.Clock(time.time() + 120, time.monotonic() + 120)


def pe(machine=0x8664, version=True, delay=False):
    raw = bytearray(0x1200);raw[:2] = b"MZ";struct.pack_into("<I", raw, 60, 0x80)
    raw[0x80:0x84] = b"PE\0\0";struct.pack_into("<HH", raw, 0x84, machine, 1)
    struct.pack_into("<H", raw, 0x94, 0xf0);opt = 0x98
    struct.pack_into("<H", raw, opt, 0x20b);struct.pack_into("<I", raw, opt + 60, 0x200)
    struct.pack_into("<I", raw, opt + 108, 16)
    row = opt + 0xf0;raw[row:row + 8] = b".rdata\0\0"
    struct.pack_into("<IIII", raw, row + 8, 0x1000, 0x1000, 0x1000, 0x200)
    struct.pack_into("<II", raw, opt + 112 + 8, 0x1100, 40)
    struct.pack_into("<I", raw, 0x300 + 12, 0x1180);raw[0x380:0x38d] = b"kernel32.dll\0"
    if delay:
        struct.pack_into("<II", raw, opt + 112 + 13 * 8, 0x1200, 64)
        struct.pack_into("<II", raw, 0x400, 1, 0x1280);raw[0x480:0x48d] = b"oleaut32.dll\0"
    if version:
        struct.pack_into("<II", raw, opt + 112 + 2 * 8, 0x1300, 0x300)
        for offset, key, child in ((0, 16, 0x80000020), (32, 1, 0x80000040), (64, 1033, 96)):
            struct.pack_into("<H", raw, 0x500 + offset + 14, 1)
            struct.pack_into("<II", raw, 0x500 + offset + 16, key, child)
        key = "VS_VERSION_INFO\0".encode("utf-16-le")
        body = bytearray(struct.pack("<HHH", 92, 52, 0) + key)
        body.extend(b"\0" * (-len(body) % 4));body.extend(struct.pack("<13I", 0xfeef04bd, 0x10000, (14 << 16) | 51, (36231 << 16) | 1, (14 << 16) | 51, (36231 << 16) | 1, 0, 0, 0, 0, 0, 0, 0))
        assert len(body) == 92
        struct.pack_into("<IIII", raw, 0x560, 0x1500, len(body), 0, 0);raw[0x700:0x700 + len(body)] = body
    return bytes(raw)


class PassiveTests(unittest.TestCase):
    def setUp(self):
        self.flag = patch.object(o, "FILE_CLOSE_FAILURE", False)
        self.flag.start();self.addCleanup(self.flag.stop)

    def test_pe_import_delay_version_and_machine_are_data_only(self):
        r = o.pe_metadata(pe(delay=True))
        self.assertEqual(r["machineKind"], "x64");self.assertEqual(r["imports"], ["kernel32.dll"])
        self.assertEqual(r["delayImports"], ["oleaut32.dll"]);self.assertEqual(r["version"]["fileVersion"], [14, 51, 36231, 1])
        self.assertFalse(r["imageLoaded"])
        for number, name in ((0xaa64, "arm64"), (0xa641, "arm64ec"), (0xa64e, "arm64x"), (123, "other")):
            self.assertEqual(o.pe_metadata(pe(number))["machineKind"], name)
        self.assertEqual(o.pe_metadata(pe(version=False))["versionStatus"], "absent")

    def test_pe_truncation_signature_optional_and_section_bounds(self):
        for body in (b"", b"MZ", pe()[:0x700], b"ZZ" + pe()[2:]):
            with self.assertRaises(o.Denied):o.pe_metadata(body)
        for offset, fmt, value in ((60, "I", 0xffffffff), (0x86, "H", 97), (0x98, "H", 0), (0x98 + 108, "I", 17), (0x188 + 20, "I", 0x10000)):
            raw = bytearray(pe());struct.pack_into("<" + fmt, raw, offset, value)
            with self.subTest(offset=offset), self.assertRaises(o.Denied):o.pe_metadata(bytes(raw))

    def test_import_names_rva_delay_attribute_and_termination_deny(self):
        for offset, value in ((0x30c, 0xfffffff0), (0x98 + 112 + 12, 20)):
            raw = bytearray(pe());struct.pack_into("<I", raw, offset, value)
            with self.assertRaises(o.Denied):o.pe_metadata(bytes(raw))
        raw = bytearray(pe());raw[0x380:0x38d] = b"../escape.dll"
        with self.assertRaisesRegex(o.Denied, "INV_PE_IMPORT_NAME"):o.pe_metadata(bytes(raw))
        raw = bytearray(pe(delay=True));struct.pack_into("<I", raw, 0x400, 0)
        with self.assertRaisesRegex(o.Denied, "INV_PE_DELAY_FORMAT"):o.pe_metadata(bytes(raw))

    def test_version_tree_payload_signature_and_rva_deny(self):
        for offset, value in ((0x514, 0x80000000), (0x560, 0xfffffff0), (0x564, 0x100001), (0x728, 0)):
            raw = bytearray(pe());struct.pack_into("<I", raw, offset, value)
            with self.subTest(offset=offset), self.assertRaises(o.Denied):o.pe_metadata(bytes(raw))
        raw = bytearray(pe());struct.pack_into("<H", raw, 0x500 + 14, 257)
        with self.assertRaises(o.Denied):o.pe_metadata(bytes(raw))

    def fixture(self, root):
        p = json.loads((HERE / "profile.json").read_bytes());vs = root / "VS";sdk = root / "SDK"
        vs.mkdir();sdk.mkdir();redist = vs / "VC/Redist/MSVC";redist.mkdir(parents=True)
        p["vsRoot"], p["sdkRoot"], p["redistRoot"] = str(vs), str(sdk), str(redist)
        original = json.loads((HERE / "profile.json").read_bytes())
        for row in p["roles"]:
            for key in ("path", "pathTemplate"):
                if key in row:row[key] = row[key].replace(original["vsRoot"], str(vs)).replace(original["sdkRoot"], str(sdk))
        return p

    def test_real_owned_file_inventory_missing_roles_and_both_machines(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve())
            version = Path(p["redistRoot"]) / "14.51.36231";version.mkdir()
            for role in p["roles"]:
                raw = role.get("path", role.get("pathTemplate", "")).format(observedVersion=version.name)
                f = Path(raw);f.parent.mkdir(parents=True, exist_ok=True);f.write_bytes(pe(0xaa64 if role["expectedArchitecture"] == "arm64" else 0x8664))
            observed = o.inventory(p, clock())
            self.assertEqual(len(observed["rows"]), 17);self.assertEqual(observed["redistVersions"], ["14.51.36231"])
            self.assertTrue(all(r["architectureMatch"] and r["status"] == "observed" and r["nlink"] == 1 for r in observed["rows"]))
            self.assertFalse(observed["closureSatisfied"] or observed["vendorExecuted"] or observed["filesCopied"] or observed["sdkDebuggerVersionProven"])
            self.assertEqual(observed["rows"][0]["sha256"], hashlib.sha256(pe()).hexdigest())

    def test_no_redist_version_is_missing_not_latest_or_compiler_substitution(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve());r = o.inventory(p, clock())
            self.assertEqual(r["redistVersions"], []);self.assertEqual(len(r["rows"]), 17)
            self.assertEqual(sum(x["status"] == "missing-redist-version" for x in r["rows"]), 9)
            self.assertTrue(r["observationComplete"]);self.assertFalse(r["closureSatisfied"])

    def test_directory_enumeration_cap_stops_before_unbounded_scan_and_ambiguity(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve())
            for i in range(17):(Path(p["redistRoot"]) / str(i)).mkdir()
            with self.assertRaisesRegex(o.Denied, "INV_VERSION_BOUND"):o.inventory(p, clock())
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve())
            for i in range(5):(Path(p["redistRoot"]) / ("14.51." + str(i))).mkdir()
            with self.assertRaisesRegex(o.Denied, "INV_VERSION_BOUND"):o.inventory(p, clock())

    def test_real_hardlink_denies_and_partial_row_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve());target = Path(p["roles"][-1]["path"]);target.parent.mkdir(parents=True)
            target.write_bytes(pe());os.link(target, target.with_name("owned-alias"));report = {}
            with self.assertRaisesRegex(o.Denied, "ACQ_FILE"):o.inventory(p, clock(), report=report)
            self.assertEqual(report["rows"][-1]["status"], "denied");self.assertFalse(report["observationComplete"])

    def test_real_symlink_denies_without_reading_external_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve();p = self.fixture(root);outside = root / "outside";outside.write_bytes(pe())
            target = Path(p["roles"][-1]["path"]);target.parent.mkdir(parents=True)
            try:target.symlink_to(outside)
            except OSError:self.skipTest("owned symlink privilege unavailable")
            with patch.object(o, "held", side_effect=AssertionError("no content read")) as held:
                with self.assertRaisesRegex(o.Denied, "INV_LINK"):o.inventory(p, clock())
            held.assert_not_called()

    def test_reparse_metadata_denies_before_any_file_content(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve());target = Path(p["roles"][-1]["path"]);target.parent.mkdir(parents=True);target.write_bytes(pe())
            original = Path.lstat
            def flagged(path):
                value = original(path)
                return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=0x400) if path == target else value
            with patch.object(Path, "lstat", autospec=True, side_effect=flagged), patch.object(o, "held", side_effect=AssertionError("must not read")) as held:
                with self.assertRaisesRegex(o.Denied, "INV_LINK"):o.inventory(p, clock())
            held.assert_not_called()

    def test_real_held_file_mutation_denies_via_same_view_prepost_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder).resolve() / "owned.dll";target.write_bytes(pe());original = Path.open
            class Reader:
                def __init__(self, stream):self.stream=stream;self.changed=False
                def __enter__(self):return self
                def __exit__(self, *args):return self.stream.__exit__(*args)
                def close(self):return self.stream.close()
                def fileno(self):return self.stream.fileno()
                def read(self, count):
                    data=self.stream.read(count)
                    if not self.changed:
                        self.changed=True;before=target.stat()
                        with original(target, "r+b") as writer:writer.write(b"NZ")
                        os.utime(target, ns=(before.st_atime_ns,before.st_mtime_ns+1000000000))
                    return data
            def opened(path, *args, **kwargs):
                stream=original(path, *args, **kwargs)
                return Reader(stream) if path==target and args==("rb",) else stream
            with patch.object(Path,"open",autospec=True,side_effect=opened):
                with self.assertRaisesRegex(o.Denied,"ACQ_CHANGED"):o.held(target,clock(),retain=True)

    def test_alias_and_lexical_parent_do_not_normalize(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(o.Denied, "INV_PATH"):o.fixed_path(str(Path(folder).resolve()) + "/../escape")
        for raw in ("//server/share", "relative", "C:/x/./y"):
            with self.assertRaises(o.Denied):o.fixed_path(raw)

    def test_caps_and_expired_original_clock_prevent_content_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve());target = Path(p["roles"][-1]["path"]);target.parent.mkdir(parents=True);target.write_bytes(pe())
            for key in ("perFileBytes", "totalFileBytes"):
                bad = json.loads(json.dumps(p));bad["limits"][key] = 1
                with patch.object(o, "held", side_effect=AssertionError("must not read")) as held:
                    with self.assertRaisesRegex(o.Denied, "INV_TOTAL_BOUND"):o.inventory(bad, clock())
                held.assert_not_called()
            with patch.object(o, "fixed_path", side_effect=AssertionError("no filesystem")) as physical:
                with self.assertRaisesRegex(o.Denied, "ACQ_DEADLINE"):o.inventory(p, o.Clock(time.time() - 1, time.monotonic() - 1))
            physical.assert_not_called()

    def test_source_parent_mutation_is_not_silent(self):
        with tempfile.TemporaryDirectory() as folder:
            p = self.fixture(Path(folder).resolve());target = Path(p["roles"][-1]["path"]);target.parent.mkdir(parents=True);target.write_bytes(pe())
            original = o.held
            def mutate(*args, **kwargs):
                result = original(*args, **kwargs);before = target.parent.stat()
                (target.parent / "changed").write_bytes(b"x")
                os.utime(target.parent, ns=(before.st_atime_ns, before.st_mtime_ns + 1000000000))
                return result
            with patch.object(o, "held", side_effect=mutate):
                with self.assertRaisesRegex(o.Denied, "INV_SOURCE_CHANGED"):o.inventory(p, clock())


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.flag = patch.object(o, "FILE_CLOSE_FAILURE", False)
        self.flag.start();self.addCleanup(self.flag.stop)

    def authority(self):
        p = json.loads((HERE / "profile.json").read_bytes())
        c = {"kind": "windows-arm-runtime-closure-context", "mode": "passive-runtime-closure", "repository": "supermarsx/sortOfRemoteNG", "repositoryId": "1010282954", "visibility": "public", "event": "workflow_dispatch", "defaultBranch": "main", "ref": o.CARRIER_REF, "inputs": None, "workflow": p["sourcePaths"][0], "workflowSha": "a" * 40, "head": "a" * 40, "image": p["image"], "runId": "123", "attempt": "1"}
        return c, p

    def test_actual_python_authority_accepts_only_truthful_carrier_and_image(self):
        c, p = self.authority();o.bootstrap_authority(c, p);c["inputs"] = {};o.bootstrap_authority(c, p)
        for key, value in (("ref", "refs/heads/main"), ("defaultBranch", "other"), ("repositoryId", "1"), ("event", "push"), ("inputs", []), ("inputs", {"x": "y"}), ("image", "20261022.1.1"), ("workflowSha", "b" * 40), ("mode", "bootstrap-inputs"), ("visibility", "private")):
            bad = dict(c);bad[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(o.Denied, "INV_AUTHORITY"):o.bootstrap_authority(bad, p)

    def test_actual_held_combined_close_only_and_good_preserve_exact_error_identity(self):
        original = Path.open
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder).resolve() / "owned.bin";target.write_bytes(b"owned fixture")
            primary = o.Denied("ACQ_DEADLINE");cause = OSError("owned cause");primary.__cause__ = cause
            secondary = OSError("owned close sentinel")
            class Reader:
                def __init__(self, stream, read_fault):self.stream=stream;self.read_fault=read_fault
                def fileno(self):return self.stream.fileno()
                def read(self, count):
                    if self.read_fault:raise primary
                    return self.stream.read(count)
                def close(self):self.stream.close();raise secondary
            for read_fault in (True, False):
                def opened(path, *args, **kwargs):
                    stream=original(path,*args,**kwargs)
                    return Reader(stream,read_fault) if path==target and args==("rb",) else stream
                with patch.object(o, "FILE_CLOSE_FAILURE", False), patch.object(Path,"open",autospec=True,side_effect=opened):
                    with self.assertRaises(BaseException) as found:o.held(target,clock(),retain=True)
                    self.assertIs(found.exception,primary if read_fault else secondary)
                    if read_fault:self.assertIs(found.exception.__cause__,cause)
                    self.assertTrue(o.FILE_CLOSE_FAILURE)
            observed, raw = o.held(target,clock(),retain=True)
            self.assertEqual(raw,b"owned fixture");self.assertEqual(observed["sha256"],hashlib.sha256(raw).hexdigest())
            self.assertFalse(o.FILE_CLOSE_FAILURE)

    def test_actual_profile_pin_and_source_encoding_contract(self):
        self.assertEqual(o.profile(clock())["kind"], "windows-arm-runtime-closure-passive")
        raw = b"public\n";row = {"path": "native/example.py", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "canonicalBytes": len(raw), "canonicalSha256": hashlib.sha256(raw).hexdigest(), "encoding": "exact"}
        self.assertEqual(o.source_bytes(row, raw), raw)
        with self.assertRaisesRegex(ValueError, "BOOT_SOURCE_BYTES"):o.source_bytes(row, raw + b"x")
        for text in (b"a\r\nb\n", b"a\rb"):
            bad = {**row, "encoding": "git-crlf", "bytes": len(text), "sha256": hashlib.sha256(text).hexdigest()}
            with self.assertRaises(ValueError):o.source_bytes(bad, text)

    def test_no_execution_or_network_events_admitted(self):
        for event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "socket.connect", "socket.getaddrinfo"):
            with self.assertRaisesRegex(o.Denied, "INV_NO_EXECUTION_OR_NETWORK"):o.no_execution(event, ())
        o.no_execution("exec", ())

    def test_closed_worker_command_rejects_tools_unknown_role_context_and_cwd(self):
        c, p = self.authority()
        with tempfile.TemporaryDirectory() as folder, patch.object(o, "CONTEXT_SHA", "a" * 64), patch.object(Path, "cwd", return_value=Path(folder)):
            argv = o.worker_argv("observation", Path(folder), p);self.assertEqual(o.closed_worker_command(argv, folder, p), "observation")
            for bad in (argv + ["extra"], ["vendor.exe"], argv[:5] + ["sdk-data"] + argv[6:]):
                with self.assertRaises(o.Denied):o.closed_worker_command(bad, folder, p)
            with self.assertRaises(o.Denied):o.closed_worker_command(argv, Path(folder) / "other", p)

    def test_actual_environment_body_uses_new_owned_namespace(self):
        tree = ast.parse((HERE / "job.py").read_text());fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "environment")
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder).resolve();script = project / "native/windows-arm-runtime-closure/job.py";script.parent.mkdir(parents=True);script.write_text("# synthetic")
            scratch = project / ".artifacts/windows-arm-runtime-closure-11111111-1111-1111-1111-111111111111"
            (scratch / "tmp").mkdir(parents=True);(scratch / "home").mkdir()
            scope = {"Path": Path, "__file__": str(script)};exec(compile(ast.Module(body=[fn], type_ignores=[]), "actual environment", "exec"), scope)
            original = ast.parse((HERE.parents[1] / "native/windows-x64-arm-toolchain/job.py").read_text())
            old = next(n for n in original.body if isinstance(n, ast.FunctionDef) and n.name == "environment")
            old_scope = {"Path": Path, "__file__": str(script)}
            exec(compile(ast.Module(body=[old], type_ignores=[]), "old environment", "exec"), old_scope)
            with patch.object(Path, "cwd", return_value=scratch):
                with self.assertRaisesRegex(ValueError, "benign-scratch-scope"):
                    old_scope["environment"]()
                env = scope["environment"]()
            self.assertEqual(set(env), {"SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "PYTHONDONTWRITEBYTECODE"})
            self.assertNotIn("GITHUB_TOKEN", env)
            with patch.object(Path, "cwd", return_value=project):
                with self.assertRaisesRegex(ValueError, "benign-scratch-scope"):scope["environment"]()

    def test_job_lifecycle_and_resources_are_exact_existing_foundation(self):
        baseline = HERE.parents[1] / "native/windows-x64-arm-toolchain/job.py"
        a, b = ast.parse(baseline.read_text()), ast.parse((HERE / "job.py").read_text())
        ignored = {"environment", "approved_tool_command"}
        aa = {n.name: ast.dump(n, include_attributes=False) for n in a.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name not in ignored}
        bb = {n.name: ast.dump(n, include_attributes=False) for n in b.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name not in ignored}
        self.assertEqual(aa, bb)
        self.assertIn("512*1024**2", (HERE / "job.py").read_text())

    def test_actual_job_admission_body_never_reaches_sources_or_environment_for_bad_command(self):
        tree = ast.parse((HERE / "job.py").read_text());fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "approved_tool_command")
        _, p = self.authority();calls = []
        scope = {"Path": Path, "load_profile": lambda: p, "environment": lambda: calls.append("environment")}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "actual admission", "exec"), scope)
        with tempfile.TemporaryDirectory() as folder, patch.dict(o.sys.modules, {"observe": o}), patch.object(o, "CONTEXT_SHA", "a" * 64), patch.object(Path, "cwd", return_value=Path(folder)), patch.object(o, "verified_sources", side_effect=lambda root: calls.append("sources")):
            with self.assertRaises(o.Denied):scope["approved_tool_command"](["vendor.exe"], folder)
            self.assertEqual(calls, [])
            argv = o.worker_argv("observation", Path(folder), p)
            self.assertEqual(scope["approved_tool_command"](argv, folder), "observation")
            self.assertEqual(calls, ["sources", "environment"])

    def test_actual_parent_keeps_first_job_error_through_close_and_postcheck_fault(self):
        captured = []
        class Parent:
            def __init__(self, _event):pass
            def close(self):raise OSError("private close failure")
        def denied(*args, **kwargs):raise o.Denied("INV_PE_IMPORT_NAME")
        fake = SimpleNamespace(ParentCancel=Parent, run_job=denied)
        _, p = self.authority()
        with patch.object(o, "CONTEXT_SHA", "a" * 64), tempfile.TemporaryDirectory() as folder, patch.object(o, "load_job", return_value=fake), patch.object(o, "verified_sources", side_effect=o.Denied("INV_SOURCE_CHANGED")), patch.object(o, "retain", side_effect=lambda _root, _name, report: captured.append(report)):
            self.assertEqual(o.supervise(Path(folder), {}, p, clock()), 1)
        self.assertEqual(captured[0]["firstFailure"], "INV_PE_IMPORT_NAME")
        self.assertFalse(captured[0]["parentHandleClosed"] or captured[0]["sourcePostVerified"] or captured[0]["success"])

    def test_parent_admits_only_original_remaining_budget_and_preserves_job_receipt(self):
        captured = [];arguments = []
        original = {"success": False, "rootExit": 1, "cleanupVerified": False, "activeAtEnd": 1, "failure": "original"}
        class Parent:
            def __init__(self, _event):pass
            def close(self):pass
        def run(*args, **kwargs):arguments.append((args, kwargs));return original
        fake = SimpleNamespace(ParentCancel=Parent, run_job=run)
        _, p = self.authority()
        with tempfile.TemporaryDirectory() as folder, patch.object(o, "load_job", return_value=fake), patch.object(o, "CONTEXT_SHA", "a" * 64), patch.object(o, "verified_sources"), patch.object(o, "retain", side_effect=lambda _root, _name, report: captured.append(report)):
            self.assertEqual(o.supervise(Path(folder), {}, p, o.Clock(100, 100, wall=lambda: 90, mono=lambda: 90)), 1)
        self.assertEqual(arguments[0][0][3], 7)
        self.assertIs(captured[0]["originalJob"], original)
        self.assertEqual(captured[0]["firstFailure"], "INV_JOB_FAILED")

    def test_held_job_loader_ignores_poisoned_adjacent_pyc_and_denies_source_tamper(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder).resolve();raw = b"VALUE = 'held source'\n";(source / "job.py").write_bytes(raw)
            (source / "job.pyc").write_bytes(b"unverified adjacent bytecode")
            row = {"path": "native/fixed/job.py", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "canonicalBytes": len(raw), "canonicalSha256": hashlib.sha256(raw).hexdigest(), "encoding": "exact"}
            with patch.object(o, "HERE", source):
                module = o.load_job({"sources": [row]}, {"sourcePaths": [None, None, None, row["path"]]}, clock())
                self.assertEqual(module.VALUE, "held source")
                (source / "job.py").write_bytes(b"VALUE = 'tampered'\n")
                with self.assertRaises(o.Denied):o.load_job({"sources": [row]}, {"sourcePaths": [None, None, None, row["path"]]}, clock())

    def test_parent_closed_file_fact_denies_success_without_rewriting_original_clean_job(self):
        captured = []
        original = {"success": True, "rootExit": 0, "cleanupVerified": True, "activeAtEnd": 0}
        class Parent:
            def __init__(self, _event):pass
            def close(self):pass
        fake = SimpleNamespace(ParentCancel=Parent, run_job=lambda *args, **kwargs: original)
        _, p = self.authority()
        with tempfile.TemporaryDirectory() as folder, patch.object(o, "load_job", return_value=fake), patch.object(o, "CONTEXT_SHA", "a" * 64), patch.object(o, "FILE_CLOSE_FAILURE", True), patch.object(o, "verified_sources"), patch.object(o, "retain", side_effect=lambda _root, _name, report: captured.append(report)):
            self.assertEqual(o.supervise(Path(folder), {}, p, clock()), 1)
        self.assertIs(captured[0]["originalJob"], original)
        self.assertTrue(original["success"]);self.assertFalse(captured[0]["success"])
        self.assertEqual(captured[0]["fileCloseFailure"], "INV_FILE_CLOSE")
        self.assertEqual(captured[0]["firstFailure"], "INV_FILE_CLOSE")

    def test_reporting_failure_preserves_primary_and_closed_fallback(self):
        result = {"success": False, "firstFailure": "INV_PE_DOS"};output = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, patch.object(Path, "open", side_effect=OSError("private reporting path")), redirect_stdout(output):
            o.retain(Path(folder), "inventory.json", result)
        self.assertEqual(result["firstFailure"], "INV_PE_DOS");self.assertEqual(result["reportingFailure"], "INV_REPORT_WRITE")
        self.assertNotIn("private", output.getvalue())

    def test_worker_keeps_partial_inventory_primary_through_postcheck_and_report_fault(self):
        result = io.StringIO()
        def broken(_p, _clock, report):
            report["rows"] = [{"role": "fixed", "status": "denied"}];raise o.Denied("INV_PE_RVA")
        with tempfile.TemporaryDirectory() as folder, patch.object(o, "FILE_CLOSE_FAILURE", True), patch.object(o.sys, "addaudithook"), patch.object(o, "inventory", side_effect=broken), patch.object(o, "verified_sources", side_effect=o.Denied("INV_SOURCE_CHANGED")), redirect_stdout(result):
            self.assertEqual(o.worker(Path(folder), {}, {}, clock()), 1)
            row = json.loads((Path(folder) / "inventory.json").read_bytes())
        self.assertEqual(row["firstFailure"], "INV_PE_RVA");self.assertEqual(row["rows"][0]["role"], "fixed");self.assertFalse(row["sourcePostVerified"]);self.assertEqual(row["fileCloseFailure"],"INV_FILE_CLOSE")


if __name__ == "__main__":
    unittest.main()
