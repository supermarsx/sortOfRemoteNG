"""Synthetic data/admission tests. Never imports the Windows kernel backend."""
import ast
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile
import uuid

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import acquire
import checkpoint
import producer

PROFILE = json.loads((HERE / "profile.json").read_bytes())


def clock():
    return acquire.Clock(time.time() + 30, time.monotonic() + 30)


def job_admission_functions(file, source=None):
    # Compile only these actual production bodies: never import WinDLL/Job code.
    tree = ast.parse(source if source is not None else (HERE / "job.py").read_bytes())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and
                node.name in ("environment", "load_profile", "approved_tool_command")]
    namespace = {"Path": Path, "os": os, "__file__": str(file), "hashlib": hashlib,
                 "json": json, "PROFILE_SHA": producer.PROFILE_SHA}
    exec(compile(ast.Module(body=selected, type_ignores=[]), "actual-job-admission", "exec"), namespace)
    return namespace


class Reply(io.BytesIO):
    def __init__(self, raw, url, status=200, headers=None):
        super().__init__(raw)
        self.url, self.status = url, status
        self.headers = headers or {"Content-Length": str(len(raw))}

    def geturl(self):
        return self.url


class BootstrapTests(unittest.TestCase):
    def temp(self):
        directory = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(directory.cleanup)
        return Path(directory.name).resolve()

    def archive(self, parent, entries):
        target = parent / "fixture.zip"
        with zipfile.ZipFile(target, "x") as z:
            for name, data in entries:
                z.writestr(name, data)
        return target

    def test_profile_only_bootstrap_and_fixed_source_eight(self):
        self.assertEqual(PROFILE["modes"], ["bootstrap-inputs"])
        self.assertFalse(PROFILE["buildAdmission"])
        self.assertEqual(len(PROFILE["sourcePaths"]), 8)
        self.assertEqual(PROFILE["programs"], list(producer.ROLES))
        self.assertEqual(PROFILE["rust"]["bytes"], 414479372)
        self.assertEqual(PROFILE["rust"]["maximumBytes"], 512 * 1024**2)
        self.assertEqual(hashlib.sha256((HERE / "profile.json").read_bytes()).hexdigest(), producer.PROFILE_SHA)

    def test_job_all_nonadmission_ast_exact_and_original_policy(self):
        before = HERE.parent / "windows-x64-arm-toolchain/job.py"
        self.assertEqual(hashlib.sha256(before.read_bytes()).hexdigest(), PROFILE["jobFoundationSha256"])
        old, new = ast.parse(before.read_bytes()), ast.parse((HERE / "job.py").read_bytes())
        # Exactly one environment namespace literal differs; all kernel/lifecycle
        # bodies and every other environment guard remain the original AST.
        old_environment = next(n for n in old.body if isinstance(n, ast.FunctionDef) and n.name == "environment")
        new_environment = next(n for n in new.body if isinstance(n, ast.FunctionDef) and n.name == "environment")
        literals = [n for n in ast.walk(new_environment) if isinstance(n, ast.Constant) and
                    n.value == r"windows-arm-cross-sdk-[a-f0-9-]{36}"]
        self.assertEqual(len(literals), 1)
        self.assertNotEqual(ast.dump(old_environment), ast.dump(new_environment))
        literals[0].value = r"windows-x64-arm-toolchain-[a-f0-9-]{36}"
        self.assertEqual(ast.dump(old_environment), ast.dump(new_environment))
        def body(tree):
            return [ast.dump(node, include_attributes=False) for node in tree.body
                    if not (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "approved_tool_command")
                    and not (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "PROFILE_SHA" for t in node.targets))]
        self.assertEqual(body(old), body(new))
        text = (HERE / "job.py").read_text()
        self.assertIn("limits.job_memory = 512 * 1024 ** 2", text)
        self.assertIn("cpu.rate!=2500", text)
        self.assertIn("limits.basic.active_limit!=8", text)

    def test_actual_environment_rejects_old_namespace_and_admits_only_owned_bootstrap_root(self):
        repo = self.temp();artifacts = repo / ".artifacts";artifacts.mkdir()
        file = repo / "native/windows-arm-cross-sdk/job.py"
        root = artifacts / ("windows-arm-cross-sdk-" + str(uuid.uuid4()))
        root.mkdir();(root / "tmp").mkdir();(root / "home").mkdir()
        current = job_admission_functions(file)
        old = job_admission_functions(file, (HERE.parent / "windows-x64-arm-toolchain/job.py").read_bytes())
        with patch("os.getcwd", return_value=str(root)):
            with self.assertRaisesRegex(ValueError, "benign-scratch-scope"):
                old["environment"]()
            observed = current["environment"]()
            self.assertEqual(observed, {"SystemRoot": "C:/Windows", "WINDIR": "C:/Windows",
                "PATH": "C:/Windows/System32", "TEMP": str(root / "tmp"), "TMP": str(root / "tmp"),
                "USERPROFILE": str(root / "home"), "PYTHONDONTWRITEBYTECODE": "1"})
        for name in ["windows-x64-arm-toolchain-" + str(uuid.uuid4()), "windows-arm-cross-sdk-invalid"]:
            foreign = artifacts / name;foreign.mkdir()
            with patch("os.getcwd", return_value=str(foreign)):
                with self.assertRaisesRegex(ValueError, "benign-scratch-scope"):
                    current["environment"]()
        elsewhere = repo / root.name;elsewhere.mkdir()
        with patch("os.getcwd", return_value=str(elsewhere)):
            with self.assertRaisesRegex(ValueError, "benign-scratch-scope"):
                current["environment"]()
        (root / "home").rmdir();(root / "home").write_bytes(b"not a directory")
        with patch("os.getcwd", return_value=str(root)):
            with self.assertRaisesRegex(ValueError, "benign-scratch-alias"):
                current["environment"]()

    def test_actual_profile_and_command_admission_reaches_environment_without_kernel(self):
        repo = self.temp();directory = repo / "native/windows-arm-cross-sdk";directory.mkdir(parents=True)
        profile_file = directory / "profile.json";profile_file.write_bytes((HERE / "profile.json").read_bytes())
        root = repo / ".artifacts" / ("windows-arm-cross-sdk-" + str(uuid.uuid4()))
        root.mkdir(parents=True);(root / "tmp").mkdir();(root / "home").mkdir()
        functions = job_admission_functions(directory / "job.py")
        self.assertEqual(functions["load_profile"](), PROFILE)
        seen = []
        with patch.object(producer, "CONTEXT_SHA", "a" * 64), patch.object(producer, "verified_sources", side_effect=lambda value: seen.append(value)), patch("os.getcwd", return_value=str(root)):
            for role in (*producer.ROLES, "operation"):
                argv = producer.worker_argv(role, root, PROFILE)
                self.assertEqual(functions["approved_tool_command"](argv, str(root)), role)
            self.assertEqual(seen, [root] * 6)
            bad = producer.worker_argv("sdk-data", root, PROFILE);bad[0] = "C:/acquired/gn.exe"
            with self.assertRaisesRegex(acquire.Denied, "BOOT_COMMAND"):
                functions["approved_tool_command"](bad, str(root))
            self.assertEqual(len(seen), 6)
        profile_file.write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "TOOLS_PROFILE_PIN"):
            functions["load_profile"]()

    def test_reviewed_acquisition_prefix_unchanged(self):
        original = (HERE.parent / "windows-x64-arm-toolchain/acquire.py").read_bytes()
        self.assertTrue((HERE / "acquire.py").read_bytes().startswith(original))

    def test_cipd_response_exact_package_sha256_and_instance_id(self):
        raw = b")]}'\n" + json.dumps({"package": "gn/gn/windows-amd64", "instance": {
            "hashAlgo": "SHA256", "hexDigest": "a" * 64}}).encode()
        result = acquire.cipd_ref(acquire.cipd_reply(raw), "gn/gn/windows-amd64")
        self.assertEqual(result["hexDigest"], "a" * 64)
        for field, value in [("hashAlgo", "SHA1"), ("hexDigest", "A" * 64), ("hexDigest", "a" * 40)]:
            bad = {"package": "gn/gn/windows-amd64", "instance": {**result, field: value}}
            with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_REF"):
                acquire.cipd_ref(bad, "gn/gn/windows-amd64")
        with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_PACKAGE"):
            acquire.cipd_ref({"package": "foreign", "instance": result}, "gn/gn/windows-amd64")

    def test_cipd_json_bound_duplicate_and_utf8(self):
        for raw in [b"{}", b")]}'\n" + b" " * 65536,
                    b")]}'\n{\"x\":1,\"x\":2}", b")]}'\n{\"x\":\"\xff\"}"]:
            with self.assertRaises((acquire.Denied, UnicodeError)):
                acquire.cipd_reply(raw)

    def test_cipd_rpc_is_only_two_read_methods_no_redirect_or_credentials(self):
        seen = []
        def request(r, timeout):
            seen.append(r)
            return Reply(b")]}'\n{}", r.full_url, headers={"X-Prpc-Grpc-Code": "0"})
        self.assertEqual(acquire.cipd_rpc("ResolveVersion", {"package": "fixed"}, clock(), request), {})
        self.assertEqual(seen[0].method, "POST")
        self.assertNotIn("Authorization", seen[0].headers)
        for method in ["CreateRef", "RegisterInstance", "../ResolveVersion"]:
            with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_METHOD"):
                acquire.cipd_rpc(method, {}, clock(), request)
        self.assertEqual(len(seen), 1)

    def test_signed_url_strict_https_host_and_no_raw_retention(self):
        good = {"signedUrl": "https://storage.googleapis.com/opaque?signature=synthetic"}
        self.assertEqual(acquire.cipd_url(good), good["signedUrl"])
        for value in ["http://storage.googleapis.com/x", "https://storage.googleapis.com.evil/x",
                      "https://user:secret@storage.googleapis.com/x", "https://storage.googleapis.com/x#fragment",
                      "https://storage.googleapis.com/\nsecret"]:
            with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_URL"):
                acquire.cipd_url({"signedUrl": value})

    def test_real_zip_member_hashes_observed_without_extraction(self):
        root = self.temp()
        file = self.archive(root, [("gn.exe", b"synthetic-not-executable"), (".cipdpkg/manifest.json", b"{}")])
        rows = acquire.cipd_zip_inventory(file, PROFILE, clock())
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["sha256"], hashlib.sha256(b"synthetic-not-executable").hexdigest())
        self.assertEqual([p.name for p in root.iterdir()], ["fixture.zip"])

    def test_owned_cipd_archive_hardlink_and_expired_clock_deny(self):
        root = self.temp();file = self.archive(root, [("gn.exe", b"synthetic")])
        os.link(file, root / "linked.zip")
        with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_ARCHIVE_FILE"):
            acquire.cipd_zip_inventory(file, PROFILE, clock())
        root = self.temp();file = self.archive(root, [("gn.exe", b"synthetic")])
        with self.assertRaisesRegex(acquire.Denied, "ACQ_DEADLINE"):
            acquire.cipd_zip_inventory(file, PROFILE, acquire.Clock(0, 0))

    def test_zip_traversal_case_duplicate_links_setid_and_expansion_deny(self):
        for name in ["../x", "/absolute", "a/../x", "CON/file"]:
            root = self.temp();file = self.archive(root, [(name, b"x")])
            with self.assertRaises(acquire.Denied):
                acquire.cipd_zip_inventory(file, PROFILE, clock())
        root = self.temp();file = self.archive(root, [("a/x", b"x")])
        # ZipInfo construction on Windows smudges backslashes before writing;
        # mutate both physical header names to test the actual reader instead.
        file.write_bytes(file.read_bytes().replace(b"a/x", b"a\\x"))
        with self.assertRaisesRegex(acquire.Denied, "ACQ_MEMBER_PATH"):
            acquire.cipd_zip_inventory(file, PROFILE, clock())
        root = self.temp();file = self.archive(root, [("a", b"1"), ("A", b"2")])
        with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_ALIAS"):
            acquire.cipd_zip_inventory(file, PROFILE, clock())
        for mode in [stat.S_IFLNK | 0o777, stat.S_IFREG | 0o4755]:
            root = self.temp();file = root / "fixture.zip"
            with zipfile.ZipFile(file, "x") as z:
                info = zipfile.ZipInfo("link");info.external_attr = mode << 16;z.writestr(info, "target")
            with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_TYPE"):
                acquire.cipd_zip_inventory(file, PROFILE, clock())
        root = self.temp();file = self.archive(root, [("a", b"ab")]);p = copy.deepcopy(PROFILE)
        p["limits"]["cipdExpandedBytes"] = 1
        with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_MEMBER_BOUND"):
            acquire.cipd_zip_inventory(file, p, clock())

    def test_one_payload_get_sha_and_after_resolution_binding(self):
        root = self.temp();(root / "archives").mkdir()
        source = self.temp();archive = self.archive(source, [("gn.exe", b"synthetic")]).read_bytes()
        sha = hashlib.sha256(archive).hexdigest();calls, downloads = [], []
        def rpc(method, body, _clock):
            calls.append(method)
            return ({"package": "gn/gn/windows-amd64", "instance": {"hashAlgo": "SHA256", "hexDigest": sha}}
                    if method == "ResolveVersion" else {"signedUrl": "https://storage.googleapis.com/fixed"})
        def request(r, timeout):
            downloads.append(r)
            return Reply(archive, r.full_url)
        result = acquire.acquire_cipd(root, "gn-archive", PROFILE, clock(), rpc, request)
        self.assertEqual(len(downloads), 1)
        self.assertEqual(calls, ["ResolveVersion", "GetInstanceURL", "ResolveVersion"])
        self.assertFalse(result["extracted"]);self.assertFalse(result["executed"])
        self.assertNotIn("signedUrl", json.dumps(result));self.assertEqual(len(result["instanceId"]), 44)

    def test_corrupt_archive_fails_without_second_get_or_recovery(self):
        root = self.temp();(root / "archives").mkdir();calls = []
        def rpc(method, body, _clock):
            return ({"package": "gn/gn/windows-amd64", "instance": {"hashAlgo": "SHA256", "hexDigest": "0" * 64}}
                    if method == "ResolveVersion" else {"signedUrl": "https://storage.googleapis.com/fixed"})
        def request(r, timeout):
            calls.append(1);return Reply(b"wrong", r.full_url)
        with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_HASH"):
            acquire.acquire_cipd(root, "gn-archive", PROFILE, clock(), rpc, request)
        self.assertEqual(len(calls), 1)
        self.assertEqual((root / "archives/gn-archive.zip").read_bytes(), b"wrong")

    def test_source_identity_closed8_canonical_and_actual_are_distinct(self):
        paths = PROFILE["sourcePaths"]
        rows = [{"path": p, "bytes": 2, "sha256": "a" * 64, "canonicalBytes": 1,
                 "canonicalSha256": "b" * 64, "encoding": "git-crlf" if i in (0, 7) else "exact"}
                for i, p in enumerate(paths)]
        first = checkpoint.closed_sources(rows, paths)
        rows[0]["sha256"] = "c" * 64
        self.assertNotEqual(first, checkpoint.closed_sources(rows, paths))
        rows[1]["encoding"] = "git-crlf"
        with self.assertRaisesRegex(ValueError, "BOOT_SOURCE_ENCODING"):
            checkpoint.closed_sources(rows, paths)

    def test_both_original_clocks_no_reset_and_invalid_values_deny(self):
        self.assertEqual(checkpoint.remaining_deadlines({"wallWorkEnd": 100, "monotonicWorkEnd": 90}, 80, 85), 5)
        for c in [{"wallWorkEnd": 100, "monotonicWorkEnd": 90},
                  {"wallWorkEnd": float("inf"), "monotonicWorkEnd": 200}]:
            with self.assertRaises(ValueError):
                checkpoint.remaining_deadlines(c, 101, 100)

    def test_canonical_actual_binding_denies_mixed_or_lone_cr_without_relaxing_native_bytes(self):
        raw = b"line\r\nnext\r\n";canonical_raw = b"line\nnext\n"
        row = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
               "canonicalBytes": len(canonical_raw), "canonicalSha256": hashlib.sha256(canonical_raw).hexdigest(),
               "encoding": "git-crlf"}
        self.assertEqual(checkpoint.source_bytes(row, raw), canonical_raw)
        for bad in [b"line\r\nnext\n", b"line\rnext\r\n"]:
            altered = {**row, "bytes": len(bad), "sha256": hashlib.sha256(bad).hexdigest()}
            with self.assertRaises(ValueError):
                checkpoint.source_bytes(altered, bad)
        with self.assertRaisesRegex(ValueError, "BOOT_SOURCE_CANONICAL"):
            checkpoint.source_bytes({**row, "encoding": "exact"}, raw)

    def test_actual_source_verifier_binds_all_eight_snapshots_then_denies_live_mutation(self):
        repo = self.temp();root = repo / ".artifacts" / ("windows-arm-cross-sdk-" + str(uuid.uuid4()))
        root.mkdir(parents=True);(root / "source-inputs").mkdir()
        p = copy.deepcopy(PROFILE);rows = []
        for i, name in enumerate(p["sourcePaths"]):
            file = repo / name;file.parent.mkdir(parents=True, exist_ok=True)
            raw = ("synthetic source " + str(i) + "\n").encode();file.write_bytes(raw)
            (root / "source-inputs" / str(i)).write_bytes(raw)
            rows.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                         "canonicalBytes": len(raw), "canonicalSha256": hashlib.sha256(raw).hexdigest(), "encoding": "exact"})
        python = repo / "synthetic-python";python.write_bytes(b"data never executed")
        p["python"] = {"path": str(python), "bytes": python.stat().st_size, "sha256": hashlib.sha256(python.read_bytes()).hexdigest()}
        c = {"kind": "windows-arm-cross-sdk-bootstrap-context", "mode": "bootstrap-inputs", "repository": "supermarsx/sortOfRemoteNG",
             "repositoryId": "1010282954", "visibility": "public", "event": "workflow_dispatch", "ref": producer.CARRIER_REF, "inputs": None,
             "defaultBranch": "main", "workflow": p["sourcePaths"][0], "head": "a" * 40, "workflowSha": "a" * 40,
             "image": p["image"], "runId": "123", "attempt": "1", "wallWorkEnd": time.time() + 20,
             "monotonicWorkEnd": time.monotonic() + 20, "sources": rows,
             "sourceDigest": checkpoint.closed_sources(rows, p["sourcePaths"])}
        raw = json.dumps(c).encode();(root / "context.json").write_bytes(raw);sha = hashlib.sha256(raw).hexdigest()
        with patch.object(producer, "ROOT", repo), patch.object(producer, "profile", return_value=p):
            producer.verified_sources(root, sha, bind=True)
            target = repo / p["sourcePaths"][3];target.write_bytes(b"M" * target.stat().st_size)
            with self.assertRaisesRegex(acquire.Denied, "ACQ_HASH"):
                producer.verified_sources(root, sha)

    def test_actual_carrier_authority_keeps_branch_and_default_main_distinct(self):
        c = {"kind": "windows-arm-cross-sdk-bootstrap-context", "mode": "bootstrap-inputs",
             "repository": "supermarsx/sortOfRemoteNG", "repositoryId": "1010282954",
             "visibility": "public", "event": "workflow_dispatch", "defaultBranch": "main",
             "ref": producer.CARRIER_REF, "inputs": None, "workflow": PROFILE["sourcePaths"][0],
             "head": "a" * 40, "workflowSha": "a" * 40, "image": PROFILE["image"], "runId": "123", "attempt": "1"}
        producer.bootstrap_authority(c, PROFILE)
        producer.bootstrap_authority({**c, "inputs": {}}, PROFILE)
        for key, value in [("ref", "refs/heads/main"), ("ref", producer.CARRIER_REF + "-other"),
                           ("defaultBranch", producer.CARRIER_REF.removeprefix("refs/heads/")),
                           ("repository", "foreign/repo"), ("repositoryId", "1"), ("visibility", "private"),
                           ("event", "push"), ("workflow", ".github/workflows/cef-windows-arm-cross-sdk.yml"),
                           ("workflowSha", "b" * 40), ("inputs", {"mode": "compile"}), ("inputs", []),
                           ("head", "x" * 40), ("image", "unexpected")]:
            with self.subTest(key=key, value=value), self.assertRaisesRegex(acquire.Denied, "BOOT_AUTHORITY"):
                producer.bootstrap_authority({**c, key: value}, PROFILE)

    def test_closed_commands_cannot_run_any_acquired_executable(self):
        producer.CONTEXT_SHA = "a" * 64
        root = Path.cwd()
        for role in producer.ROLES:
            argv = producer.worker_argv(role, root, PROFILE)
            self.assertEqual(producer.closed_worker_command(argv, root, PROFILE), role)
            for index, value in [(0, "C:/payload/gn.exe"), (5, "compile"), (8, "--other")]:
                bad = argv.copy();bad[index] = value
                with self.assertRaisesRegex(acquire.Denied, "BOOT_COMMAND"):
                    producer.closed_worker_command(bad, root, PROFILE)
        for event in ["subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn"]:
            with self.assertRaisesRegex(ValueError, "BOOT_DATA_NO_EXECUTION"):
                producer.no_execution(event, ())

    def test_report_write_failure_denies_without_masking_primary(self):
        result = {"success": True, "firstFailure": "ACQ_HASH"}
        with patch.object(acquire, "save", side_effect=OSError("synthetic")):
            producer.retain(Path.cwd(), "unused", result)
        self.assertFalse(result["success"])
        self.assertEqual(result["firstFailure"], "ACQ_HASH")
        self.assertEqual(result["reportingFailure"], "BOOT_REPORT_WRITE")

    def test_bootstrap_seal_never_admits_compiled_objects_or_runtime(self):
        seal = checkpoint.bootstrap_seal({"sourceDigest": "a" * 64, "head": "b" * 40}, [])
        self.assertFalse(seal["engineCheckpointImplemented"])
        self.assertFalse(seal["buildAdmission"]);self.assertFalse(seal["sdkBuilt"])
        self.assertFalse(seal["nativeAcceptance"]);self.assertFalse(seal["outputExecuted"])


if __name__ == "__main__":
    unittest.main()
