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
        self.assertEqual(PROFILE["modes"], ["input-closure", "command-inventory", "source-gn"])
        self.assertFalse(PROFILE["buildAdmission"])
        self.assertEqual(len(PROFILE["sourcePaths"]), 11)
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
                    n.value == r"windows-arm-full-sdk-[a-f0-9-]{36}"]
        self.assertEqual(len(literals), 1)
        self.assertNotEqual(ast.dump(old_environment), ast.dump(new_environment))
        literals[0].value = r"windows-x64-arm-toolchain-[a-f0-9-]{36}"
        self.assertEqual(ast.dump(old_environment), ast.dump(new_environment))
        readback = next(n for n in new.body if isinstance(n, ast.FunctionDef) and n.name == 'readback_policy')
        self.assertEqual(readback.args.args.pop().arg, 'policy')
        run = next(n for n in new.body if isinstance(n, ast.FunctionDef) and n.name == 'run_job')
        additions = [n for n in run.body if ast.unparse(n) in (
            'from producer import worker_policy, verified_sources',
            'policy = worker_policy(role, verified_sources(Path(cwd))[0])')]
        self.assertEqual(len(additions), 2)
        for node in additions:run.body.remove(node)
        calls=[n for n in ast.walk(run)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='readback_policy']
        self.assertEqual(len(calls),1);self.assertEqual(ast.unparse(calls[0].args.pop()),'policy')
        class PolicyDefaults(ast.NodeTransformer):
            counts={'processes':0,'memoryBytes':0,'cpuRate':0}
            def visit_Subscript(self,node):
                if isinstance(node.value,ast.Name)and node.value.id=='policy':
                    key=node.slice.value;self.counts[key]+=1
                    return ast.parse({'processes':'8','memoryBytes':'512 * 1024 ** 2','cpuRate':'2500'}[key],mode='eval').body
                return self.generic_visit(node)
        normal=PolicyDefaults();new=normal.visit(new)
        self.assertEqual(normal.counts,{'processes':2,'memoryBytes':2,'cpuRate':1})
        def body(tree):
            return [ast.dump(node, include_attributes=False) for node in tree.body
                    if not (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in ("approved_tool_command","load_profile"))
                    and not (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "PROFILE_SHA" for t in node.targets))]
        self.assertEqual(body(old), body(new))
        self.assertEqual(producer.worker_policy('operation',{'mode':'input-closure'}),
                         {'processes':8,'memoryBytes':512*1024**2,'cpuRate':2500})

    def test_actual_environment_rejects_old_namespace_and_admits_only_owned_bootstrap_root(self):
        repo = self.temp();artifacts = repo / ".artifacts";artifacts.mkdir()
        file = repo / "native/windows-arm-full-sdk/job.py"
        root = artifacts / ("windows-arm-full-sdk-" + str(uuid.uuid4()))
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
        for name in ["windows-x64-arm-toolchain-" + str(uuid.uuid4()), "windows-arm-full-sdk-invalid"]:
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
        repo = self.temp();directory = repo / "native/windows-arm-full-sdk";directory.mkdir(parents=True)
        profile_file = directory / "profile.json";profile_file.write_bytes((HERE / "profile.json").read_bytes())
        root = repo / ".artifacts" / ("windows-arm-full-sdk-" + str(uuid.uuid4()))
        root.mkdir(parents=True);(root / "tmp").mkdir();(root / "home").mkdir()
        functions = job_admission_functions(directory / "job.py")
        self.assertEqual(functions["load_profile"](), PROFILE)
        seen = []
        with patch.object(producer, "CONTEXT_SHA", "a" * 64), patch.object(producer, "verified_sources", side_effect=lambda value: (seen.append(value) or ({'mode':'input-closure'},PROFILE,clock()))), patch("os.getcwd", return_value=str(root)):
            for role in (*producer.ROLES, "operation"):
                argv = producer.worker_argv(role, root, PROFILE)
                self.assertEqual(functions["approved_tool_command"](argv, str(root)), role)
            self.assertEqual(seen, [root] * 8)
            bad = producer.worker_argv("sdk-data", root, PROFILE);bad[0] = "C:/acquired/gn.exe"
            with self.assertRaisesRegex(acquire.Denied, "BOOT_COMMAND"):
                functions["approved_tool_command"](bad, str(root))
            self.assertEqual(len(seen), 8)
        profile_file.write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "TOOLS_PROFILE_PIN"):
            functions["load_profile"]()

    def test_reviewed_acquisition_prefix_unchanged(self):
        original = (HERE.parent / "windows-x64-arm-toolchain/acquire.py").read_bytes()
        self.assertIn(b"class MtimeTarInfo", (HERE / "acquire.py").read_bytes())
        self.assertIn(b"FULL_CIPD_IMMUTABLE", (HERE / "acquire.py").read_bytes())

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
        p=copy.deepcopy(PROFILE);p['cipd'][0]['instance']={'hashAlgo':'SHA256','hexDigest':sha};p['cipd'][0]['archiveSha256']=sha
        result = acquire.acquire_cipd(root, "gn-archive", p, clock(), rpc, request)
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
        p=copy.deepcopy(PROFILE);p['cipd'][0]['instance']={'hashAlgo':'SHA256','hexDigest':'0'*64};p['cipd'][0]['archiveSha256']='0'*64
        with self.assertRaisesRegex(acquire.Denied, "BOOT_CIPD_HASH"):
            acquire.acquire_cipd(root, "gn-archive", p, clock(), rpc, request)
        self.assertEqual(len(calls), 1)
        self.assertEqual((root / "archives/gn-archive.zip").read_bytes(), b"wrong")

    def test_source_identity_closed8_canonical_and_actual_are_distinct(self):
        paths = PROFILE["sourcePaths"]
        rows = [{"path": p, "bytes": 2, "sha256": "a" * 64, "canonicalBytes": 1,
                 "canonicalSha256": "b" * 64, "encoding": "git-crlf" if i in (0, len(paths)-1) else "exact"}
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
        repo = self.temp();root = repo / ".artifacts" / ("windows-arm-full-sdk-" + str(uuid.uuid4()))
        root.mkdir(parents=True);(root / "source-inputs").mkdir()
        p = copy.deepcopy(PROFILE);rows = []
        for row in p["sourceData"]:
            file=repo/row["path"];file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes((producer.ROOT/row["path"]).read_bytes())
        for i, name in enumerate(p["sourcePaths"]):
            file = repo / name;file.parent.mkdir(parents=True, exist_ok=True)
            raw = ("synthetic source " + str(i) + "\n").encode();file.write_bytes(raw)
            (root / "source-inputs" / str(i)).write_bytes(raw)
            rows.append({"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                         "canonicalBytes": len(raw), "canonicalSha256": hashlib.sha256(raw).hexdigest(), "encoding": "exact"})
        python = repo / "synthetic-python";python.write_bytes(b"data never executed")
        p["python"] = {"path": str(python), "bytes": python.stat().st_size, "sha256": hashlib.sha256(python.read_bytes()).hexdigest()}
        c = {"kind": "windows-arm-full-sdk-context", "mode": "input-closure", "repository": "supermarsx/sortOfRemoteNG",
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
        c = {"kind": "windows-arm-full-sdk-context", "mode": "input-closure",
             "repository": "supermarsx/sortOfRemoteNG", "repositoryId": "1010282954",
             "visibility": "public", "event": "workflow_dispatch", "defaultBranch": "main",
             "ref": producer.CARRIER_REF, "inputs": None, "workflow": PROFILE["sourcePaths"][0],
             "head": "a" * 40, "workflowSha": "a" * 40, "image": PROFILE["image"], "runId": "123", "attempt": "1"}
        producer.bootstrap_authority(c, PROFILE)
        producer.bootstrap_authority({**c, "inputs": {}}, PROFILE)
        for key, value in [("ref", "refs/heads/main"), ("ref", producer.CARRIER_REF + "-other"),
                           ("defaultBranch", producer.CARRIER_REF.removeprefix("refs/heads/")),
                           ("repository", "foreign/repo"), ("repositoryId", "1"), ("visibility", "private"),
                           ("event", "push"), ("workflow", ".github/workflows/cef-windows-arm-full-sdk.yml"),
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


import extract as material
import environment
import lzma
import tarfile
import struct


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

ACTUAL_SETUP_X86 = (
    'vc_bin_dir = "C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\bin\\\\Hostx64\\\\x86"\r\n'
    'include_flags_I = "\\"/IC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\include\\" \\"/IC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\include\\" \\"/IWindows Kits/10/Include/10.0.28000.0/ucrt\\" \\"/IWindows Kits/10/Include/10.0.28000.0/shared\\" \\"/IWindows Kits/10/Include/10.0.28000.0/um\\" \\"/IWindows Kits/10/Include/10.0.28000.0/winrt\\" \\"/IWindows Kits/10/Include/10.0.28000.0/cppwinrt\\""\r\n'
    'include_flags_I_list = ["/IC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\include", "/IC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\include", "/IWindows Kits/10/Include/10.0.28000.0/ucrt", "/IWindows Kits/10/Include/10.0.28000.0/shared", "/IWindows Kits/10/Include/10.0.28000.0/um", "/IWindows Kits/10/Include/10.0.28000.0/winrt", "/IWindows Kits/10/Include/10.0.28000.0/cppwinrt"]\r\n'
    'include_flags_imsvc = "\\"-imsvcC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\include\\" \\"-imsvcC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\include\\" \\"-imsvcWindows Kits/10/Include/10.0.28000.0/ucrt\\" \\"-imsvcWindows Kits/10/Include/10.0.28000.0/shared\\" \\"-imsvcWindows Kits/10/Include/10.0.28000.0/um\\" \\"-imsvcWindows Kits/10/Include/10.0.28000.0/winrt\\" \\"-imsvcWindows Kits/10/Include/10.0.28000.0/cppwinrt\\""\r\n'
    'include_flags_imsvc_list = ["-imsvcC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\include", "-imsvcC:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\include", "-imsvcWindows Kits/10/Include/10.0.28000.0/ucrt", "-imsvcWindows Kits/10/Include/10.0.28000.0/shared", "-imsvcWindows Kits/10/Include/10.0.28000.0/um", "-imsvcWindows Kits/10/Include/10.0.28000.0/winrt", "-imsvcWindows Kits/10/Include/10.0.28000.0/cppwinrt"]\r\n'
    'paths = "D:\\\\a\\\\sortOfRemoteNG\\\\sortOfRemoteNG\\\\.artifacts\\\\windows-x64-arm-toolchain-8f15eb5d-ab88-4753-87ac-0076e7a2a490\\\\host-runtime;C:\\\\hostedtoolcache\\\\windows\\\\Python\\\\3.12.10\\\\x64;C:\\\\hostedtoolcache\\\\windows\\\\Python\\\\3.12.10\\\\x64;D:\\\\a\\\\sortOfRemoteNG\\\\sortOfRemoteNG\\\\.artifacts\\\\windows-x64-arm-toolchain-8f15eb5d-ab88-4753-87ac-0076e7a2a490\\\\llvm\\\\bin;C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\bin\\\\Hostx64\\\\x86;D:\\\\a\\\\sortOfRemoteNG\\\\sortOfRemoteNG\\\\.artifacts\\\\windows-x64-arm-toolchain-8f15eb5d-ab88-4753-87ac-0076e7a2a490\\\\Windows Kits\\\\10\\\\bin\\\\10.0.28000.0\\\\x64;D:\\\\a\\\\sortOfRemoteNG\\\\sortOfRemoteNG\\\\.artifacts\\\\windows-x64-arm-toolchain-8f15eb5d-ab88-4753-87ac-0076e7a2a490\\\\host-runtime;C:\\\\Windows\\\\System32;C:\\\\Windows"\r\n'
    'libpath_flags = "\\"-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\lib\\\\x86\\" \\"-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\lib\\\\x86\\" \\"-libpath:Windows Kits/10/Lib/10.0.28000.0/ucrt/x86\\" \\"-libpath:Windows Kits/10/Lib/10.0.28000.0/um/x86\\""\r\n'
    'libpath_flags_list = ["-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\lib\\\\x86", "-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\lib\\\\x86", "-libpath:Windows Kits/10/Lib/10.0.28000.0/ucrt/x86", "-libpath:Windows Kits/10/Lib/10.0.28000.0/um/x86"]\r\n'
    'libpath_lldlink_flags = "\\"-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\lib\\\\x86\\" \\"-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\lib\\\\x86\\" \\"-libpath:Windows Kits/10/Lib/10.0.28000.0/ucrt/x86\\" \\"-libpath:Windows Kits/10/Lib/10.0.28000.0/um/x86\\""\r\n'
    'libpath_lldlink_flags_list = ["-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\lib\\\\x86", "-libpath:C:\\\\Program Files\\\\Microsoft Visual Studio\\\\18\\\\Enterprise\\\\VC\\\\Tools\\\\MSVC\\\\14.51.36231\\\\atlmfc\\\\lib\\\\x86", "-libpath:Windows Kits/10/Lib/10.0.28000.0/ucrt/x86", "-libpath:Windows Kits/10/Lib/10.0.28000.0/um/x86"]\r\n'
    'msvc_dir = ""\r\n'
    'windows_kits_dir = ""\r\n'
)

ACTUAL_SETUP_ROOT = "D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/windows-x64-arm-toolchain-8f15eb5d-ab88-4753-87ac-0076e7a2a490"
HISTORICAL_SETUP_BODIES = 'def rows(root, profile, cpu):\n    need(cpu in CPUS, "ENV_CPU")\n    root = Path(root)\n    vc = Path(profile["vsRoot"]) / "VC/Tools/MSVC" / profile["toolset"]\n    sdk = root / "Windows Kits/10"\n    inc = [vc / "include", vc / "atlmfc/include"] + [sdk / "Include" / profile["sdkVersion"] / x for x in ("ucrt", "shared", "um", "winrt", "cppwinrt")]\n    lib = [vc / "lib" / cpu, vc / "atlmfc/lib" / cpu] + [sdk / "Lib" / profile["sdkVersion"] / x / cpu for x in ("ucrt", "um")]\n    paths = [Path(profile["python"]["path"]).parent, root / "llvm/bin", vc / "bin/Hostx64" / cpu,\n             sdk / "bin" / profile["sdkVersion"] / "x64", root / "host-runtime", Path("C:/Windows/System32"), Path("C:/Windows")]\n    return {"INCLUDE": ";".join(map(str, inc)), "LIB": ";".join(map(str, lib)),\n            "LIBPATH": ";".join(map(str, lib)), "Path": ";".join(map(str, paths)),\n            "SystemRoot": "C:/Windows", "WINDIR": "C:/Windows", "TEMP": str(root / "tmp"),\n            "TMP": str(root / "tmp"), "USERPROFILE": str(root / "home"), "VSLANG": "1033",\n            "CL": "", "_CL_": "", "LINK": "", "_LINK_": ""}\n\ndef verify_setup(text, root, profile, cpu):\n    need(type(text) is str and len(text.encode("utf-8")) <= 4 * 1024**2, "ENV_SETUP_BOUND")\n    values = {}\n    for line in text.splitlines():\n        need(len(line) <= 65536, "ENV_SETUP_BOUND")\n        match = re.fullmatch(r"([A-Za-z_]+) = (.+)", line)\n        need(match and match[1] not in values, "ENV_SETUP_FORMAT")\n        try:\n            values[match[1]] = json.loads(match[2])\n        except (ValueError, TypeError):\n            raise ValueError("ENV_SETUP_FORMAT") from None\n    required = {"vc_bin_dir", "include_flags_I", "include_flags_I_list", "include_flags_imsvc", "include_flags_imsvc_list",\n                "paths", "libpath_flags", "libpath_flags_list", "libpath_lldlink_flags", "libpath_lldlink_flags_list", "msvc_dir", "windows_kits_dir"}\n    need(set(values) == required, "ENV_SETUP_FIELDS")\n    expected = rows(root, profile, cpu)\n    vc = str(Path(profile["vsRoot"]) / "VC/Tools/MSVC" / profile["toolset"])\n    # setup output is relative to the operation cwd when on the same drive.\n    def absolute(value):\n        need(type(value) is str, "ENV_SETUP_TYPE")\n        return ntpath.normpath(value if ntpath.isabs(value) else ntpath.join(str(root), value)).replace("\\\\", "/").casefold()\n    # FindFileInEnvList checks cl.exe exists, then returns its containing directory.\n    need(absolute(values["vc_bin_dir"]) == (vc + "/bin/Hostx64/" + cpu).replace("\\\\", "/").casefold(), "ENV_SETUP_CPU")\n    def flags(key, prefix, paths):\n        actual = values[key]\n        need(type(actual) is list and len(actual) == len(paths) and\n             all(type(x) is str and x.startswith(prefix) for x in actual), "ENV_SETUP_TYPE")\n        need([absolute(x[len(prefix):]) for x in actual] == [absolute(x) for x in paths], "ENV_SETUP_PATHS")\n        # Match pinned setup_toolchain.py\'s q/ListToArgString, not just its list.\n        quoted = [x if re.fullmatch(r"[a-zA-Z0-9._/\\\\:-]*", x) else \'"\' + x + \'"\' for x in actual]\n        scalar = values[key.removesuffix("_list")]\n        need(type(scalar) is str and scalar == " ".join(quoted), "ENV_SETUP_FLAGS")\n    flags("libpath_flags_list", "-libpath:", expected["LIB"].split(";"))\n    flags("libpath_lldlink_flags_list", "-libpath:", expected["LIB"].split(";"))\n    flags("include_flags_I_list", "/I", expected["INCLUDE"].split(";"))\n    flags("include_flags_imsvc_list", "-imsvc", expected["INCLUDE"].split(";"))\n    # Upstream computes these optional summaries from raw, already-relativized\n    # INCLUDE spellings. Cross-drive backslashes or a root-relative SDK path can\n    # leave them empty. Derive exactly; never accept an arbitrary empty summary.\n    msvc_dir, windows_kits_dir = "", ""\n    for item in values["include_flags_I_list"]:\n        include = item[2:]\n        msvc_match = re.match(r"^.*/VC/Tools/MSVC/[^/]+/include$", include)\n        if msvc_match is not None:\n            msvc_dir = msvc_match.group(0)\n        sdk_match = re.match(r"^(.*/Windows Kits/\\d+/Include/[^/]+)/.*", include)\n        if sdk_match is not None:\n            windows_kits_dir = sdk_match.group(1)\n    need(type(values["msvc_dir"]) is str and values["msvc_dir"] == msvc_dir, "ENV_SETUP_MSVC")\n    need(type(values["windows_kits_dir"]) is str and values["windows_kits_dir"] == windows_kits_dir, "ENV_SETUP_SDK")\n    path_parts = values["paths"]\n    need(type(path_parts) is str, "ENV_SETUP_TYPE")\n    wanted_paths = [str(Path(root) / "host-runtime"), str(Path(profile["python"]["path"]).parent)] + expected["Path"].split(";")\n    need([absolute(x) for x in path_parts.split(";")] == [absolute(x) for x in wanted_paths], "ENV_SETUP_PATHS")\n    return {"cpu": cpu, "setupSucceeded": True, "sdkVersion": profile["sdkVersion"],\n            "registeredSdkClaim": False, "adapterNotVendorOrigin": True}'
HISTORICAL_SETUP_SHA = '11f1369799cc64d1e62f995114d1c6ae957aeafed9d504ae7914a2bc11c047e2'

CEF_CUSTOM_RUNTIME_BODIES = 'def SetEnvironmentAndGetRuntimeDllDirs():\n    """Sets up os.environ to use the depot_tools VS toolchain with gyp, and\n    returns the location of the VC runtime DLLs so they can be copied into\n    the output directory after gyp generation.\n\n    Return value is [x64path, x86path, \'Arm64Unused\'] or None. arm64path is\n    generated separately because there are multiple folders for the arm64 VC\n    runtime.\n    """\n    vs_runtime_dll_dirs = None\n    depot_tools_win_toolchain = bool(\n        int(os.environ.get(\'DEPOT_TOOLS_WIN_TOOLCHAIN\', \'1\'))\n    )\n    # When running on a non-Windows host, only do this if the SDK has explicitly\n    # been downloaded before (in which case json_data_file will exist).\n    if (\n        _HostIsWindows() or os.path.exists(json_data_file)\n    ) and depot_tools_win_toolchain:\n        if ShouldUpdateToolchain():\n            if len(sys.argv) > 1 and sys.argv[1] == \'update\':\n                update_result = Update()\n            else:\n                update_result = Update(no_download=True)\n            if update_result != 0:\n                raise Exception(\n                    \'Failed to update, error code %d.\' % update_result\n                )\n        with open(json_data_file, \'r\') as tempf:\n            toolchain_data = json.load(tempf)\n\n        toolchain = toolchain_data[\'path\']\n        version = toolchain_data[\'version\']\n        win_sdk = toolchain_data.get(\'win_sdk\')\n        wdk = toolchain_data[\'wdk\']\n        # TODO(scottmg): The order unfortunately matters in these. They should be\n        # split into separate keys for x64/x86/arm64. (See CopyDlls call below).\n        # http://crbug.com/345992\n        vs_runtime_dll_dirs = toolchain_data[\'runtime_dirs\']\n        # The number of runtime_dirs in the toolchain_data was two (x64/x86) but\n        # changed to three (x64/x86/arm64) and this code needs to handle both\n        # possibilities, which can change independently from this code.\n        if len(vs_runtime_dll_dirs) == 2:\n            vs_runtime_dll_dirs.append(\'Arm64Unused\')\n\n        os.environ[\'GYP_MSVS_OVERRIDE_PATH\'] = toolchain\n\n        os.environ[\'WINDOWSSDKDIR\'] = win_sdk\n        os.environ[\'WDK_DIR\'] = wdk\n        # Include the VS runtime in the PATH in case it\'s not machine-installed.\n        runtime_path = os.path.pathsep.join(vs_runtime_dll_dirs)\n        os.environ[\'PATH\'] = runtime_path + os.path.pathsep + os.environ[\'PATH\']\n    elif sys.platform == \'win32\' and not depot_tools_win_toolchain:\n        has_override_path = True\n        if not \'GYP_MSVS_OVERRIDE_PATH\' in os.environ:\n            has_override_path = False\n            os.environ[\'GYP_MSVS_OVERRIDE_PATH\'] = DetectVisualStudioPath()\n\n        if has_override_path:\n            # Don\'t attempt to copy DLLs when using a custom toolchain.\n            # The DLLs should already be discoverable via the PATH env variable.\n            return None\n\n        # When using an installed toolchain these files aren\'t needed in the output\n        # directory in order to run binaries locally, but they are needed in order\n        # to create isolates or the mini_installer. Copying them to the output\n        # directory ensures that they are available when needed.\n        bitness = platform.architecture()[0]\n        # When running 64-bit python the x64 DLLs will be in System32\n        # ARM64 binaries will not be available in the system directories because we\n        # don\'t build on ARM64 machines.\n        x64_path = \'System32\' if bitness == \'64bit\' else \'Sysnative\'\n        x64_path = os.path.join(os.path.expandvars(\'%windir%\'), x64_path)\n        vs_runtime_dll_dirs = [\n            x64_path,\n            os.path.join(os.path.expandvars(\'%windir%\'), \'SysWOW64\'),\n            \'Arm64Unused\',\n        ]\n\n    return vs_runtime_dll_dirs\n\ndef CopyDlls(target_dir, configuration, target_cpu):\n    """Copy the VS runtime DLLs into the requested directory as needed.\n\n    configuration is one of \'Debug\' or \'Release\'.\n    target_cpu is one of \'x86\', \'x64\' or \'arm64\'.\n\n    The debug configuration gets both the debug and release DLLs; the\n    release config only the latter.\n    """\n    vs_runtime_dll_dirs = SetEnvironmentAndGetRuntimeDllDirs()\n    if not vs_runtime_dll_dirs:\n        return\n\n    x64_runtime, x86_runtime, arm64_runtime = vs_runtime_dll_dirs\n    if target_cpu == \'x64\':\n        runtime_dir = x64_runtime\n    elif target_cpu == \'x86\':\n        runtime_dir = x86_runtime\n    elif target_cpu == \'arm64\':\n        runtime_dir = arm64_runtime\n    else:\n        raise Exception(\'Unknown target_cpu: \' + target_cpu)\n    _CopyRuntime(target_dir, runtime_dir, target_cpu, debug=False)\n    if configuration == \'Debug\':\n        _CopyRuntime(target_dir, runtime_dir, target_cpu, debug=True)\n    _CopyDebugger(target_dir, target_cpu)\n    if target_cpu == \'arm64\':\n        target_dir = os.path.join(target_dir, \'win_clang_x64\')\n        target_cpu = \'x64\'\n        runtime_dir = x64_runtime\n        os.makedirs(target_dir, exist_ok=True)\n        _CopyRuntime(target_dir, runtime_dir, target_cpu, debug=False)\n        if configuration == \'Debug\':\n            _CopyRuntime(target_dir, runtime_dir, target_cpu, debug=True)\n        _CopyDebugger(target_dir, target_cpu)'
CEF_CUSTOM_RUNTIME_SHA = '851f64f71745f04ef5ea6a00ee72dd74ffc9ec093b3942e1d6790566ff8cdc55'

class FullInputTests(unittest.TestCase):
    temp=BootstrapTests.temp
    archive=BootstrapTests.archive

    def runtime_fixture(self):
        root=self.temp();sources=root/'sources';sources.mkdir();output=root/'output';output.mkdir()
        p=copy.deepcopy(PROFILE);remaining=21356560
        for i,row in enumerate(p['runtime17']['rows']):
            size=remaining if i==16 else 1250000;remaining-=size
            raw=pe(row['machine'])+bytes(size-len(pe(row['machine'])))
            source=sources/(str(i)+'.dll');source.write_bytes(raw)
            row.update(source=str(source),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),
                       fileVersion='14.51.36231.1',imports=['kernel32.dll'],delayImports=[])
        return root,output,p

    def test_actual_pe_parser_and_seventeen_independent_runtime_copies(self):
        root,output,p=self.runtime_fixture()
        result=material.runtime_projection(output,p,clock())
        self.assertEqual(len(result['files']),17);self.assertEqual(sum(r['bytes']for r in result['files']),21356560)
        self.assertFalse(result['executed']);self.assertFalse(result['sdk28000DebuggerClaim'])
        for before,after in zip(p['runtime17']['rows'],result['files']):
            source=Path(before['source']);destination=output/after['path']
            self.assertEqual(source.read_bytes(),destination.read_bytes())
            self.assertNotEqual((source.stat().st_dev,source.stat().st_ino),(destination.stat().st_dev,destination.stat().st_ino))
            self.assertEqual(destination.stat().st_nlink,1)

    def test_runtime_version_import_machine_hash_missing_and_destination_denials(self):
        for scenario in ['version','imports','machine','hash','missing','destination','cohort']:
            with self.subTest(scenario=scenario):
                root,output,p=self.runtime_fixture();row=p['runtime17']['rows'][0]
                if scenario=='version':row['fileVersion']='99.0.0.0'
                elif scenario=='imports':row['imports']=['unexpected.dll']
                elif scenario=='machine':row['machine']=0xaa64;row['destination']='runtime/arm64/first.dll'
                elif scenario=='hash':row['sha256']='0'*64
                elif scenario=='missing':Path(row['source']).unlink()
                elif scenario=='destination':row['destination']='../foreign.dll'
                else:p['runtime17']['rows'].pop()
                with self.assertRaises((acquire.Denied,FileNotFoundError)):material.runtime_projection(output,p,clock())

    def test_runtime_source_mutation_after_copy_is_detected(self):
        root,output,p=self.runtime_fixture();original=material.write_member
        def mutate(*args,**kwargs):
            result=original(*args,**kwargs);Path(p['runtime17']['rows'][0]['source']).write_bytes(b'changed');return result
        with patch.object(material,'write_member',side_effect=mutate):
            with self.assertRaises(acquire.Denied):material.runtime_projection(output,p,clock())

    def test_full_pe_parser_denies_malformed_and_reports_versions_without_loading(self):
        result=material.pe_metadata(pe(delay=True))
        self.assertEqual(result['version']['fileVersion'],[14,51,36231,1]);self.assertEqual(result['delayImports'],['oleaut32.dll'])
        self.assertFalse(result['imageLoaded'])
        for raw in [b'',pe()[:100],b'ZZ'+pe()[2:]]:
            with self.assertRaises(acquire.Denied):material.pe_metadata(raw)

    def test_installed_tree_observes_every_input_and_empty_directory_count_bounds(self):
        root=self.temp();(root/'include').mkdir();(root/'include/header.h').write_bytes(b'owned input')
        p=copy.deepcopy(PROFILE);limits=p['limits']
        result=environment.inventory_installed_roots(root,('include',),limits,clock())
        self.assertEqual(result['files'][0]['path'],'include/header.h');self.assertEqual(result['bytes'],11)
        self.assertFalse(result['previous14AreCompleteClosure'])
        for i in range(3):(root/'include'/str(i)).mkdir()
        with self.assertRaisesRegex(acquire.Denied,'FULL_INSTALLED_BOUND'):environment.inventory_installed_roots(root,('include',),{**limits,'installedFiles':1},clock())
        with self.assertRaisesRegex(acquire.Denied,'FULL_INSTALLED_ROOT'):environment.installed_inventory({**p,'vsRoot':str(root)},clock())

    def test_installed_tree_missing_hardlink_symlink_and_bytes_caps_deny(self):
        for scenario in ['missing','hardlink','total','file']:
            with self.subTest(scenario=scenario):
                root=self.temp();(root/'include').mkdir();file=root/'include/header.h';file.write_bytes(b'bytes')
                limits=copy.deepcopy(PROFILE['limits'])
                if scenario=='missing':file.unlink();(root/'include').rmdir()
                elif scenario=='hardlink':os.link(file,root/'include/alias')
                elif scenario=='total':limits['installedBytes']=1
                else:limits['installedFileBytes']=1
                with self.assertRaises((acquire.Denied,FileNotFoundError)):environment.inventory_installed_roots(root,('include',),limits,clock())

    def test_real_installed_tree_symlink_denies_without_following_target(self):
        root=self.temp();(root/'include').mkdir();file=root/'source';file.write_bytes(b'owned')
        try:os.symlink(file,root/'include/alias')
        except OSError as error:
            if getattr(error,'winerror',None)==1314:self.skipTest('owned Windows symlink requires unavailable privilege')
            raise
        with self.assertRaises(acquire.Denied):environment.inventory_installed_roots(root,('include',),PROFILE['limits'],clock())

    def test_complete_inventory_still_requires_all_fourteen_prior_byte_pins(self):
        rows=[{'path':environment.INSTALLED14[r['role']],'bytes':r['bytes'],'sha256':r['sha256']}for r in PROFILE['installedMsvc14']]
        self.assertTrue(environment.validate_installed_inventory(PROFILE,{'files':rows}))
        for scenario in ['missing','bytes','hash']:
            changed=copy.deepcopy(rows)
            if scenario=='missing':changed.pop()
            elif scenario=='bytes':changed[0]['bytes']+=1
            else:changed[0]['sha256']='0'*64
            with self.assertRaisesRegex(acquire.Denied,'FULL_INSTALLED_PIN'):environment.validate_installed_inventory(PROFILE,{'files':changed})

    def test_genuine_setup_x86_replay_and_explicit_new_runtime_projection(self):
        import ntpath
        self.assertEqual(len(ACTUAL_SETUP_X86.encode()),4392)
        self.assertEqual(hashlib.sha256(ACTUAL_SETUP_X86.encode()).hexdigest(),'a9fd974d168a3b0cb78e731028317184f6edefa6d8e9dd42f51e017bde817462')
        self.assertEqual(hashlib.sha256(HISTORICAL_SETUP_BODIES.encode()).hexdigest(),HISTORICAL_SETUP_SHA)
        scope={'Path':Path,'need':acquire.need,'CPUS':environment.CPUS,'re':material.re,'ntpath':ntpath,'json':json}
        exec(compile(HISTORICAL_SETUP_BODIES,'pinned-historical-setup','exec'),scope)
        self.assertTrue(scope['verify_setup'](ACTUAL_SETUP_X86,Path(ACTUAL_SETUP_ROOT),PROFILE,'x86')['setupSucceeded'])
        # This next body is intentionally transformed prospective context, not a new hosted observation.
        fields={k:json.loads(v)for k,v in (line.split(' = ',1)for line in ACTUAL_SETUP_X86.splitlines())}
        fields['paths']=fields['paths'].replace('\\host-runtime','\\runtime\\x64').replace('/host-runtime','/runtime/x64')
        text='\n'.join(k+' = '+json.dumps(v)for k,v in fields.items())
        self.assertTrue(environment.verify_setup(text,Path(ACTUAL_SETUP_ROOT),PROFILE,'x86')['setupSucceeded'])
        for key,value in [('vc_bin_dir','C:/foreign/arm64'),('windows_kits_dir','foreign'),('msvc_dir','foreign'),('paths','C:/ambient')]:
            with self.subTest(key=key),self.assertRaises(acquire.Denied):environment.verify_setup('\n'.join(k+' = '+json.dumps(value if k==key else v)for k,v in fields.items()),Path(ACTUAL_SETUP_ROOT),PROFILE,'x86')

    def test_all_three_cpu_current_adapter_summaries_and_no_arbitrary_command_values(self):
        root=Path('D:/owned')
        for cpu in environment.CPUS:
            value=environment.rows(root,PROFILE,cpu);vc=PROFILE['vsRoot']+'/VC/Tools/MSVC/'+PROFILE['toolset']
            fields={'vc_bin_dir':vc+'/bin/Hostx64/'+cpu,'msvc_dir':vc+'/include','windows_kits_dir':'D:/owned/Windows Kits/10/Include/10.0.28000.0',
                    'paths':str(root/'runtime/x64')+';'+str(Path(PROFILE['python']['path']).parent)+';'+value['Path']}
            for key,prefix,source in [('include_flags_I','/I','INCLUDE'),('include_flags_imsvc','-imsvc','INCLUDE'),('libpath_flags','-libpath:','LIB'),('libpath_lldlink_flags','-libpath:','LIB')]:
                fields[key+'_list']=[prefix+x.replace('\\','/')for x in value[source].split(';')]
                fields[key]=' '.join('"'+x+'"'if ' 'in x else x for x in fields[key+'_list'])
            rendered='\n'.join(k+' = '+json.dumps(v)for k,v in fields.items())
            self.assertTrue(environment.verify_setup(rendered,root,PROFILE,cpu)['setupSucceeded'])
            fields['libpath_flags_list'][0]='-libpath:C:/foreign';fields['libpath_flags']='-libpath:C:/foreign'
            with self.assertRaises(acquire.Denied):environment.verify_setup('\n'.join(k+' = '+json.dumps(v)for k,v in fields.items()),root,PROFILE,cpu)
        for value in ['C:/x&run','C:/x%PATH%','C:/x\nnew','C:/x"']:
            with self.assertRaises(acquire.Denied):environment.safe_value(value)
    def tar(self, root, rows):
        # Synthetic uncompressed headers exercise the production XZ/TAR stream.
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT)as archive:
            for name,body,kind in rows:
                info=tarfile.TarInfo(name);info.type=kind;info.size=len(body);archive.addfile(info,io.BytesIO(body))
        raw=lzma.compress(stream.getvalue());file=root/'owned.tar.xz';file.write_bytes(raw)
        return file,{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}

    def pax(self, **fields):
        raw=b''
        for key,value in fields.items():
            body=(key+'='+value+'\n').encode();length=len(body)+2
            while len(str(length))+1+len(body)!=length:length=len(str(length))+1+len(body)
            raw+=str(length).encode()+b' '+body
        return raw

    def test_raw_collision_distinct_local_pax_effective_paths_materialize_independently(self):
        root=self.temp();prefix='a'*100
        file,spec=self.tar(root,[("PaxHeader",self.pax(path=prefix+'one',mtime='12.34'),tarfile.XHDTYPE),
                                 (prefix,b'one',tarfile.REGTYPE),
                                 ("PaxHeader",self.pax(path=prefix+'two',mtime='12.35'),tarfile.XHDTYPE),
                                 (prefix,b'two',tarfile.REGTYPE)])
        result=material.rust_archive(file,root/'out',spec,clock())
        self.assertEqual((root/'out'/ (prefix+'one')).read_bytes(),b'one')
        self.assertEqual((root/'out'/ (prefix+'two')).read_bytes(),b'two')
        self.assertEqual(result['headers'],4);self.assertEqual(len(result['files']),2)
        self.assertFalse(result['executed']);self.assertFalse(result['targetStdProven'])

    def test_rust_observed_plus_and_long_effective_paths_reach_owned_directory_and_file_writes(self):
        # First authentic failure from the retained14bc archive, not a length failure.
        observed='lib/rustlib/src/rust/library/vendor/wasip2-1.0.4+wasi-0.2.12'
        self.assertEqual(len(observed),60)
        observed_at='lib/rustlib/src/rust/library/vendor/wit-bindgen-0.57.1/wasi-cli@0.2.0.wasm'
        self.assertEqual(len(observed_at),74)
        long=observed+'/'+'segment/'*12+'member.rs'
        self.assertTrue(160 < len(long) <= 240)
        with self.assertRaisesRegex(acquire.Denied,'ACQ_MEMBER_PATH'):acquire.member_name(observed)
        for name in (observed,observed_at,long):self.assertEqual(material.rust_member_name(name),name)
        root=self.temp()
        file,spec=self.tar(root,[(observed,b'',tarfile.DIRTYPE),
            ('PaxHeader',self.pax(path=long,mtime='12.34'),tarfile.XHDTYPE),
            (long[:100],b'actual owned write',tarfile.REGTYPE),
            (observed_at,b'passive wasm bytes, never executed',tarfile.REGTYPE)])
        result=material.rust_archive(file,root/'out',spec,clock())
        self.assertEqual((root/'out'/long).read_bytes(),b'actual owned write')
        self.assertEqual([r['path']for r in result['files']],[observed,long,observed_at])
        self.assertEqual((root/'out'/observed_at).read_bytes(),b'passive wasm bytes, never executed')
        self.assertEqual(result['files'][1]['sha256'],hashlib.sha256(b'actual owned write').hexdigest())
        self.assertEqual(result['files'][1]['rawHeaderName'],long[:100])

    def test_rust_path_adapter_retains_windows_restrictions_and_240_bound_without_normalizing(self):
        for name in ('CON','x/NUL.rs','aux+ok/COM1.txt','aux@ok/COM1.txt','x/LPT9','x.','x ',
                     '/abs','C:/drive','//server/share','../x','x/../y','x/./y',
                     'x//y','x\\y','x\\..\\y','x:stream','x\0y','caf\u00e9','x?y','x'*241):
            with self.subTest(name=name),self.assertRaises(acquire.Denied):material.rust_member_name(name)
        self.assertEqual(material.rust_member_name('a'*240),'a'*240)
        for names in [('pkg+one','pkg+one'),('Pkg+one','pkg+one'),('pkg+one','pkg+one/member')]:
            root=self.temp();file,spec=self.tar(root,[(n,b'body',tarfile.REGTYPE)for n in names])
            with self.subTest(names=names),self.assertRaises(acquire.Denied):material.rust_archive(file,root/'out',spec,clock())
        root=self.temp();file,spec=self.tar(root,[('pkg+one',b'body',tarfile.REGTYPE)])
        for key,value in [('member',1),('expanded',1),('headers',0)]:
            limits=dict(material.CAPS);limits[key]=value
            with self.subTest(cap=key),self.assertRaises(acquire.Denied):material.rust_archive(file,root/('out-'+key),spec,clock(),limits)

    def test_rust_adapter_does_not_admit_plus_or_long_names_to_sdk_cipd_or_runtime(self):
        root=self.temp();output=root/'out';output.mkdir()
        for name in ('pkg+one','pkg@one','a'*161):
            with self.subTest(name=name):
                with self.assertRaisesRegex(acquire.Denied,'ACQ_MEMBER_PATH'):acquire.member_name(name)
                with self.assertRaisesRegex(acquire.Denied,'ACQ_MEMBER_PATH'):material.owned_destination(output,name,True,clock())
                with self.assertRaisesRegex(acquire.Denied,'ACQ_MEMBER_PATH'):material.write_member(output,name,io.BytesIO(b'x'),1,clock())
        for name in ('pkg+one','pkg@one'):
            archive=self.archive(self.temp(),[(name,b'not executed')])
            with self.assertRaisesRegex(acquire.Denied,'ACQ_MEMBER_PATH'):acquire.cipd_zip_inventory(archive,PROFILE,clock())
            fixture,output,p=self.runtime_fixture();p['runtime17']['rows'][0]['destination']='runtime/x64/'+name+'.dll'
            with self.assertRaisesRegex(acquire.Denied,'ACQ_MEMBER_PATH'):material.runtime_projection(output,p,clock())

    def test_full_extraction_denies_true_duplicates_case_topology_links_and_unsafe_names(self):
        cases=[ [('x',b'a',tarfile.REGTYPE),('x',b'b',tarfile.REGTYPE)],
                [('X',b'a',tarfile.REGTYPE),('x',b'b',tarfile.REGTYPE)],
                [('x',b'a',tarfile.REGTYPE),('x/y',b'b',tarfile.REGTYPE)],
                [('../foreign',b'a',tarfile.REGTYPE)],[('x',b'',tarfile.SYMTYPE)],
                [('x',b'',tarfile.LNKTYPE)],[('CON',b'a',tarfile.REGTYPE)],
                [('x.',b'a',tarfile.REGTYPE)],[('/absolute',b'a',tarfile.REGTYPE)]]
        for rows in cases:
            with self.subTest(rows=rows):
                root=self.temp();file,spec=self.tar(root,rows)
                with self.assertRaises(acquire.Denied):material.rust_archive(file,root/'out',spec,clock())

    def test_pax_override_global_chain_and_prefix_mismatch_deny(self):
        for rows in [
          [('p',self.pax(size='1',mtime='1'),tarfile.XHDTYPE),('x',b'a',tarfile.REGTYPE)],
          [('p',self.pax(linkpath='x',mtime='1'),tarfile.XHDTYPE),('x',b'a',tarfile.REGTYPE)],
          [('p',self.pax(path='../x',mtime='1'),tarfile.XHDTYPE),('x',b'a',tarfile.REGTYPE)],
          [('p',self.pax(path='unrelated',mtime='1'),tarfile.XHDTYPE),('x',b'a',tarfile.REGTYPE)],
          [('p',self.pax(mtime='1'),tarfile.XGLTYPE),('x',b'a',tarfile.REGTYPE)],
          [('p',self.pax(mtime='1'),tarfile.XHDTYPE),('p',self.pax(mtime='1'),tarfile.XHDTYPE)],
          [('p',self.pax(mtime='-1'),tarfile.XHDTYPE),('x',b'a',tarfile.REGTYPE)]]:
            with self.subTest(rows=rows):
                root=self.temp();file,spec=self.tar(root,rows)
                with self.assertRaises(acquire.Denied):material.rust_archive(file,root/'out',spec,clock())

    def test_every_ordinary_rust_file_is_hashed_not_only_old_selected_roles(self):
        root=self.temp();file,spec=self.tar(root,[('VERSION',b'fixed',tarfile.REGTYPE),('bin/bindgen.exe',b'not executed',tarfile.REGTYPE),('lib/rustlib/src/rust/library/core/src/lib.rs',b'std source',tarfile.REGTYPE)])
        result=material.rust_archive(file,root/'out',spec,clock())
        self.assertEqual(len(result['files']),3)
        self.assertEqual(next(r for r in result['files']if r['path']=='VERSION')['sha256'],hashlib.sha256(b'fixed').hexdigest())

    def test_archive_hash_expired_clock_member_expansion_and_existing_destination_denials(self):
        for scenario in ['hash','clock','member','expanded','existing']:
            with self.subTest(scenario=scenario):
                root=self.temp();file,spec=self.tar(root,[('x',b'abcd',tarfile.REGTYPE)])
                limits=dict(material.CAPS);c=clock()
                if scenario=='hash':spec['sha256']='0'*64
                if scenario=='clock':c=acquire.Clock(time.time()-1,time.monotonic()-1)
                if scenario=='member':limits['member']=1
                if scenario=='expanded':limits['expanded']=1
                if scenario=='existing':(root/'out').mkdir()
                with self.assertRaises((acquire.Denied,FileExistsError)):material.rust_archive(file,root/'out',spec,c,limits)

    def test_zip_fixed_instances_and_all_member_hashes_before_materialization(self):
        root=self.temp();archive=self.archive(root,[('gn.exe',b'not run'),('.cipdpkg/manifest.json',b'{}')]);raw=archive.read_bytes()
        p=copy.deepcopy(PROFILE);spec=copy.deepcopy(p['cipd'][0]);spec.update(archiveBytes=len(raw),archiveSha256=hashlib.sha256(raw).hexdigest())
        spec['instance']={'hashAlgo':'SHA256','hexDigest':spec['archiveSha256']};spec['members']=acquire.cipd_zip_inventory(archive,p,clock())
        result=material.cipd_archive(archive,root/'out',spec,p,clock())
        self.assertEqual((root/'out/gn.exe').read_bytes(),b'not run');self.assertFalse(result['executed'])
        spec['members'][0]['sha256']='0'*64
        with self.assertRaisesRegex(acquire.Denied,'FULL_CIPD_INVENTORY'):material.cipd_archive(archive,root/'bad',spec,p,clock())
        self.assertFalse((root/'bad').exists())

    def test_version_resolution_drift_denied_before_url_or_payload(self):
        root=self.temp();(root/'archives').mkdir();rpc_calls=[]
        def rpc(method,body,c):
            rpc_calls.append(method);return {'package':'gn/gn/windows-amd64','instance':{'hashAlgo':'SHA256','hexDigest':'0'*64}}
        with patch.object(acquire,'opener',side_effect=AssertionError('no GET')):
            with self.assertRaisesRegex(acquire.Denied,'FULL_CIPD_IMMUTABLE'):acquire.acquire_cipd(root,'gn-archive',PROFILE,clock(),rpc)
        self.assertEqual(rpc_calls,['ResolveVersion'])

    def test_closed_phase_and_data_envelope_never_become_compiled_checkpoint(self):
        self.assertEqual([k for k,v in PROFILE['phaseAdmission'].items()if v],['input-closure','source-gn','command-inventory'])
        for fn in (checkpoint.compiled_checkpoint,checkpoint.compiled_restore):
            with self.assertRaisesRegex(ValueError,'FULL_ENGINE_'):fn({'kind':'sorng-windows-arm-full-sdk-bootstrap-data'})
        for key in ['engine-pilot','compiled-checkpoint','sdk-package','compiled-restore']:
            self.assertFalse(PROFILE['phaseAdmission'][key])
        self.assertFalse(PROFILE['claims']['sourceMetadataWindowsProven'])

    def test_host_environment_never_adds_arm_runtime_to_host_path(self):
        for cpu in ['x86','x64','arm64']:
            observed=environment.rows(Path('C:/owned'),PROFILE,cpu)
            self.assertIn('runtime\\x64'if os.name=='nt'else'runtime/x64',observed['Path'])
            self.assertNotIn('runtime/arm64',observed['Path'].replace('\\','/'))
            self.assertIn('Hostx64',observed['Path']);self.assertNotIn('Hostarm64',observed['Path'])
        with self.assertRaises(acquire.Denied):environment.rows(Path('C:/owned'),PROFILE,'arbitrary')

    def test_regular_file_and_each_directory_identity_contract_remain_strict(self):
        import stat
        value=(1,2,0,4,5,stat.S_IFDIR|0o755,7,8)
        changed=list(value);changed[2]=4096
        self.assertEqual(material.directory_identity(value,'nt'),material.directory_identity(tuple(changed),'nt'))
        self.assertNotEqual(material.directory_identity(value,'posix'),material.directory_identity(tuple(changed),'posix'))
        for i in [0,1,3,4,5,6,7]:
            changed=list(value);changed[i]+=1
            self.assertNotEqual(material.directory_identity(value,'nt'),material.directory_identity(tuple(changed),'nt'))
        root=self.temp();file=root/'input';file.write_bytes(b'a')
        with self.assertRaisesRegex(acquire.Denied,'ACQ_SIZE'):material.held(file,clock(),2)

    def test_source_read_error_survives_close_failure_close_only_denies(self):
        root=self.temp();file=root/'input';file.write_bytes(b'a');original=Path.open
        primary=acquire.Denied('FULL_FIRST');secondary=OSError('private close detail')
        class Reader:
            def __init__(self,stream,fail):self.stream=stream;self.fail=fail
            def fileno(self):return self.stream.fileno()
            def read(self,size):
                if self.fail:raise primary
                return self.stream.read(size)
            def close(self):self.stream.close();raise secondary
        for fail in [True,False]:
            def opened(path,*args,**kwargs):return Reader(original(path,*args,**kwargs),fail)
            with patch.object(Path,'open',autospec=True,side_effect=opened):
                with self.assertRaises(BaseException)as caught:material.held(file,clock())
                self.assertIs(caught.exception,primary if fail else secondary)

    def test_new_closed_failure_codes_retained_without_private_exception_output(self):
        for code in ['FULL_RUNTIME_PE','IDX_TAR_DUPLICATE','INV_PE_VERSION','ENV_SETUP_CPU']:
            self.assertEqual(producer.failure(ValueError(code)),code)
        self.assertEqual(producer.failure(OSError('C:/private/credential')),'BOOT_UNAVAILABLE')

    def test_actual_operation_closed_stage_order_stops_first_failure_and_retains_cleanup(self):
        from types import SimpleNamespace
        for failed in [None,'materialize']:
            root=self.temp();calls=[]
            class Parent:
                def __init__(self,_event):pass
                def close(self):
                    if failed:raise OSError('closed secondary')
            def run(argv,cwd,output,seconds,**kwargs):
                role=argv[5];calls.append((role,seconds))
                return {'success':role!=failed,'cleanupVerified':True,'rootExit':0 if role!=failed else 1,'activeAtEnd':0,'rootReaped':True,'logReadersStopped':True}
            module=SimpleNamespace(ParentCancel=Parent,run_job=run)
            with patch.dict(sys.modules,{'job':module}),patch.object(producer,'CONTEXT_SHA','a'*64),patch.object(producer,'verified_sources'),patch.object(producer.shutil,'disk_usage',return_value=SimpleNamespace(free=100*1024**3)):
                exit_code=producer.operation(root,{'mode':'input-closure'},PROFILE,acquire.Clock(time.time()+600,time.monotonic()+600))
            report=json.loads((root/'bootstrap-result.json').read_bytes())
            expected=list(producer.ROLES)if failed is None else list(producer.ROLES[:6])
            self.assertEqual([r[0]for r in calls],expected)
            self.assertTrue(all(0<r[1]<=480 for r in calls));self.assertFalse(report['sdkBuilt'])
            if failed:
                self.assertEqual(exit_code,1);self.assertEqual(report['firstFailure'],'BOOT_JOB_FAILED');self.assertFalse(report['parentHandleClosed'])
            else:self.assertEqual(exit_code,0);self.assertTrue(report['parentHandleClosed'])

    def test_actual_pinned_cef_runhooks_custom_runtime_skips_ambient_copydlls(self):
        from types import SimpleNamespace
        self.assertEqual(hashlib.sha256(CEF_CUSTOM_RUNTIME_BODIES.encode()).hexdigest(),CEF_CUSTOM_RUNTIME_SHA)
        called=[]
        def forbidden(*args,**kwargs):called.append(args);raise AssertionError('custom toolchain must not ambient copy')
        scope={'os':SimpleNamespace(environ={'DEPOT_TOOLS_WIN_TOOLCHAIN':'0','GYP_MSVS_OVERRIDE_PATH':'C:/owned/custom-vs'}),
               'sys':SimpleNamespace(platform='win32'),'_HostIsWindows':lambda:True,
               '_CopyRuntime':forbidden,'_CopyDebugger':forbidden,'DetectVisualStudioPath':forbidden}
        exec(compile(CEF_CUSTOM_RUNTIME_BODIES,'pinned-official-runhooks-runtime','exec'),scope)
        self.assertIsNone(scope['SetEnvironmentAndGetRuntimeDllDirs']())
        self.assertIsNone(scope['CopyDlls']('owned/output','Release','arm64'));self.assertEqual(called,[])


class RuntimeProgressTests(unittest.TestCase):
    temp=BootstrapTests.temp

    def test_held_default_none_is_pinned_original_body_and_actual_chunk_counts_are_measured(self):
        tree=ast.parse((HERE/'extract.py').read_bytes())
        body=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='held'))
        self.assertEqual(body.args.args.pop().arg,'bounded_reads');self.assertIs(body.args.defaults.pop().value,False)
        bounded=next(n for n in ast.walk(body)if isinstance(n,ast.While))
        check=next(n for n in bounded.body if isinstance(n,ast.If)and ast.unparse(n.test)=='bounded_reads and count == before.st_size')
        bounded.body.remove(check)
        read=next(n for n in bounded.body if isinstance(n,ast.Assign)and ast.unparse(n.targets[0])=='chunk')
        self.assertEqual(ast.unparse(read.value.args[0]),'min(CHUNK, before.st_size - count) if bounded_reads else CHUNK')
        read.value.args[0]=ast.Name(id='CHUNK',ctx=ast.Load())
        self.assertEqual(body.args.args.pop().arg,'expected_nlink');self.assertEqual(body.args.defaults.pop().value,1)
        guard=next(n for n in ast.walk(body)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='need'and len(n.args)>1 and isinstance(n.args[1],ast.Constant)and n.args[1].value=='ACQ_FILE')
        self.assertEqual(ast.dump(guard.args[0],include_attributes=False),ast.dump(ast.parse('type(expected_nlink) is int and 1 <= expected_nlink <= 8 and stat.S_ISREG(before.st_mode) and before.st_nlink == expected_nlink',mode='eval').body,include_attributes=False))
        guard.args[0]=ast.parse('stat.S_ISREG(before.st_mode) and before.st_nlink == 1',mode='eval').body
        self.assertEqual(body.args.args.pop().arg,'progress');body.args.defaults.pop()
        loop=next(n for n in ast.walk(body)if isinstance(n,ast.While))
        added=[n for n in loop.body if isinstance(n,ast.If)and ast.unparse(n.test)=='progress is not None']
        self.assertEqual(len(added),1);loop.body.remove(added[0])
        self.assertEqual(hashlib.sha256(ast.dump(body,include_attributes=False).encode()).hexdigest(),
                         '605cc3ceea34e697ccb1c2b5f2573d1e28f88e319e0c8f9ffd09e8161d96cf9f')
        file=self.temp()/'file';raw=b'x'*(material.CHUNK*2+17);file.write_bytes(raw)
        default,_=material.held(file,clock(),maximum=len(raw));counts=[]
        observed,_=material.held(file,clock(),maximum=len(raw),progress=counts.append)
        self.assertEqual(default,observed)
        self.assertEqual(counts,[material.CHUNK,material.CHUNK*2,len(raw)])

    def test_held_observer_mutation_still_denies_and_callback_failure_survives_close_failure(self):
        file=self.temp()/'file';file.write_bytes(b'x'*70000)
        def mutation(count):
            info=file.stat();os.utime(file,ns=(info.st_atime_ns,info.st_mtime_ns+1000000000))
        with self.assertRaisesRegex(acquire.Denied,'ACQ_CHANGED'):material.held(file,clock(),progress=mutation)
        sentinel=RuntimeError('PRIVATE_CALLBACK_MESSAGE');closing=RuntimeError('PRIVATE_CLOSE_MESSAGE')
        stream=file.open('rb')
        class CloseFault:
            def __getattr__(self,name):return getattr(stream,name)
            def close(self):stream.close();raise closing
        def callback(count):raise sentinel
        with patch.object(Path,'open',return_value=CloseFault()),patch.object(material,'FILE_CLOSE_FAILURE',False):
            with self.assertRaises(RuntimeError)as caught:material.held(file,clock(),progress=callback)
            self.assertIs(caught.exception,sentinel);self.assertTrue(material.FILE_CLOSE_FAILURE)

    def test_progress_monotonic_throttle_finite_bounds_privacy_and_incomplete_admission(self):
        root=self.temp();now=[10.0];progress=producer.RuntimeProgress(root,clock(),mono=lambda:now[0])
        progress('inventory-enter',force=True)
        for i in range(50000):progress('metadata',visited=i)
        self.assertEqual(progress.count,1)
        now[0]+=1;progress('hash',hashBytes=10);self.assertEqual(progress.count,1)
        now[0]+=5;progress('hash',hashBytes=20);self.assertEqual(progress.count,2)
        for i in range(300):progress('sort',force=True)
        files=sorted(root.glob('runtime-progress-*-result.json'));self.assertEqual(len(files),128)
        self.assertLessEqual(sum(p.stat().st_size for p in files),128*1024)
        for bad in ({'path':'SECRET_PATH'},{'visited':True},{'visited':50001},{'hashBytes':512*1024**2+1}):
            with self.assertRaisesRegex(acquire.Denied,'FULL_PROGRESS_FIELDS'):progress('metadata',**bad)
        source=ast.parse((HERE/'producer.py').read_bytes())
        operation=next(n for n in source.body if isinstance(n,ast.FunctionDef)and n.name=='operation')
        predicate=next(n for n in ast.walk(operation)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='need'and len(n.args)>1 and isinstance(n.args[1],ast.Constant)and n.args[1].value=='BOOT_JOB_FAILED')
        for file in files:
            row=json.loads(file.read_bytes());self.assertFalse(row['success']);self.assertFalse(row['complete']);self.assertFalse(row['sourcePostVerified'])
            with self.assertRaisesRegex(acquire.Denied,'BOOT_JOB_FAILED'):
                exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.Expr(value=predicate)],type_ignores=[])),'actual-operation-admission','exec'),{'data':acquire,'observed':row})
            self.assertNotIn('SECRET',file.read_text());self.assertLessEqual(file.stat().st_size,1024)

    def test_progress_sink_preserves_original_write_error_and_denies_close_only_failure(self):
        first=OSError('PRIVATE_WRITE');second=OSError('PRIVATE_CLOSE')
        class Fault:
            def __init__(self,write_failure):self.write_failure=write_failure
            def write(self,raw):
                if self.write_failure:raise first
                return len(raw)
            def flush(self):pass
            def close(self):raise second
        for fail,expected in ((True,first),(False,second)):
            progress=producer.RuntimeProgress(self.temp(),clock())
            with patch.object(Path,'open',return_value=Fault(fail)):
                with self.assertRaises(OSError)as caught:progress('inventory-enter',force=True)
            self.assertIs(caught.exception,expected);self.assertTrue(progress.closeFailure)

    def test_progress_interrupted_next_snapshot_keeps_prior_complete_snapshot(self):
        root=self.temp();progress=producer.RuntimeProgress(root,clock());progress('inventory-enter',force=True)
        prior=root/'runtime-progress-000-result.json';raw=prior.read_bytes();original_open=Path.open
        sentinel=OSError('PRIVATE_INTERRUPTION')
        class Partial:
            def __init__(self,stream):self.stream=stream
            def write(self,body):self.stream.write(body[:17]);raise sentinel
            def flush(self):self.stream.flush()
            def close(self):self.stream.close()
        def opened(path,*args,**kwargs):return Partial(original_open(path,*args,**kwargs))
        with patch.object(Path,'open',new=opened):
            with self.assertRaises(OSError)as caught:progress('sort',force=True)
        self.assertIs(caught.exception,sentinel);self.assertEqual(prior.read_bytes(),raw)
        self.assertFalse(json.loads(raw)['success'])
        with self.assertRaises(json.JSONDecodeError):json.loads((root/'runtime-progress-001-result.json').read_bytes())

    def test_progress_rejects_unknown_phase_and_nonfinite_or_backwards_numeric_clock(self):
        for phase in ('PRIVATE_PATH',{'unknown':'PRIVATE_PATH'}):
            progress=producer.RuntimeProgress(self.temp(),clock())
            with self.assertRaisesRegex(acquire.Denied,'FULL_PROGRESS_FIELDS'):progress(phase)
            self.assertEqual(progress.count,0)
        for value in (float('nan'),float('inf'),-1.0,3601.0):
            now=[0.0];progress=producer.RuntimeProgress(self.temp(),clock(),mono=lambda:now[0]);now[0]=value
            with self.assertRaisesRegex(acquire.Denied,'FULL_PROGRESS_CLOCK'):progress('inventory-enter',force=True)
            self.assertEqual(progress.count,0)

    def test_actual_installed_inventory_progress_matches_default_content_and_phase_order(self):
        root=self.temp();(root/'include').mkdir();(root/'include/empty').mkdir()
        (root/'include/one.h').write_bytes(b'x'*70000);(root/'include/two.h').write_bytes(b'y')
        baseline=environment.inventory_installed_roots(root,('include',),PROFILE['limits'],clock())
        events=[]
        def observed(phase,**fields):events.append((phase,fields))
        result=environment.inventory_installed_roots(root,('include',),PROFILE['limits'],clock(),observed)
        self.assertEqual(result,baseline);self.assertEqual(events[0][0],'root-enter')
        self.assertEqual(events[-1][0],'inventory-complete');phases=[p for p,v in events]
        self.assertLess(phases.index('hash-enter'),phases.index('hash'))
        self.assertLess(phases.index('root-complete'),phases.index('sort'))
        final=events[-1][1];self.assertEqual(final['completedFiles'],2);self.assertEqual(final['completedBytes'],70001)
        self.assertEqual(final['completedDirectories'],2)
        self.assertTrue(any(p=='hash'and v['hashBytes']==65536 for p,v in events))

    def test_actual_worker_keeps_primary_when_final_progress_sink_fails(self):
        root=self.temp();primary=acquire.Denied('FULL_INSTALLED_PIN')
        class LateFault(producer.RuntimeProgress):
            def __call__(self,phase,**values):
                if phase=='worker-finish':raise OSError('SECRET_VENDOR_PATH')
                return super().__call__(phase,**values)
        with patch.object(sys,'addaudithook'),patch.object(producer,'verified_sources'),patch.object(producer,'RuntimeProgress',LateFault),patch.object(environment,'installed_inventory',side_effect=primary):
            self.assertEqual(producer.data_worker('runtime-closure',root,{},PROFILE,clock()),1)
        row=json.loads((root/'runtime-closure-result.json').read_bytes())
        self.assertEqual(row['firstFailure'],'FULL_INSTALLED_PIN');self.assertTrue(row['progressReportingFailure'])
        self.assertFalse(row['success']);self.assertNotIn('SECRET',json.dumps(row))
        interim=json.loads(next(root.glob('runtime-progress-*-result.json')).read_bytes())
        self.assertFalse(interim['sourcePostVerified']);self.assertFalse(interim['success'])


class RuntimeBudgetTests(unittest.TestCase):
    temp=BootstrapTests.temp

    def test_six_second_cadence_retains_last600_second_progress_and_all_fixed_boundaries(self):
        root=self.temp();now=[0.0];progress=producer.RuntimeProgress(root,clock(),mono=lambda:now[0])
        progress('inventory-enter',force=True)
        for ordinal in range(8):
            progress('root-enter',force=True,root=ordinal)
            for second in range(1,76):
                now[0]=ordinal*75+second
                progress('hash',visited=ordinal*100+second,hashBytes=second)
            progress('root-complete',force=True,root=ordinal)
        for phase in ('sort','inventory-complete','installed14-validated','inventory-save',
                      'inventory-retained','projection-enter','projection-retained','worker-finish'):
            progress(phase,force=True)
        rows=[json.loads(p.read_bytes())for p in sorted(root.glob('runtime-progress-*-result.json'))]
        self.assertLessEqual(len(rows),125);self.assertLess(len(rows),128)
        self.assertEqual(rows[-1]['phase'],'worker-finish');self.assertEqual(rows[-1]['elapsedMs'],600000)
        self.assertGreaterEqual(max(r['elapsedMs']for r in rows if r['phase']=='hash'),590000)
        self.assertEqual(sum(r['phase']=='root-enter'for r in rows),8)
        self.assertEqual(sum(r['phase']=='root-complete'for r in rows),8)
        self.assertTrue(all(not r['complete']and not r['success']and not r['sourcePostVerified']for r in rows))

    def test_new_profile_is_strictly_bound_in_producer_and_job_with_original_other_caps(self):
        self.assertEqual(PROFILE['limits']['installedSeconds'],600)
        self.assertEqual(PROFILE['limits']['wholeSeconds'],3600)
        self.assertEqual(PROFILE['limits']['finalReserveSeconds'],120)
        self.assertEqual(PROFILE['limits']['cleanupSeconds'],30)
        self.assertEqual(PROFILE['limits']['installedFiles'],50000)
        self.assertEqual(PROFILE['limits']['installedBytes'],8*1024**3)
        self.assertEqual(PROFILE['limits']['installedFileBytes'],512*1024**2)
        self.assertEqual(producer.PROFILE_SHA,hashlib.sha256((HERE/'profile.json').read_bytes()).hexdigest())
        tree=ast.parse((HERE/'job.py').read_bytes())
        pin=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='PROFILE_SHA'for x in n.targets))
        self.assertEqual(pin,producer.PROFILE_SHA)
        self.assertNotEqual(pin,'52a005e688abc7ea8133f448bbf4ba602ff3056efd97208f3ee674699862716a')

    def model_operation(self, remaining, fail_runtime=False):
        from types import SimpleNamespace
        root=self.temp();calls=[];state={'remaining':remaining,'closed':False,'verified':0}
        class Budget:
            def remaining(self):return state['remaining']
        class Parent:
            def __init__(self,event):pass
            def close(self):
                state['closed']=True
                if fail_runtime:raise OSError('PRIVATE_CLOSE')
        def run(argv,cwd,output,seconds,**kwargs):
            role=Path(output).name;calls.append((role,seconds,state['remaining']))
            if role=='runtime-closure':
                state['remaining']-=seconds
                if fail_runtime:return {'success':False,'cleanupVerified':True,'rootExit':124,'activeAtEnd':0}
            return {'success':True,'cleanupVerified':True,'rootExit':0,'activeAtEnd':0}
        def verified(root):
            state['verified']+=1
            if fail_runtime and state['verified']==8:raise acquire.Denied('BOOT_POSTCHECK')
        fake=SimpleNamespace(ParentCancel=Parent,run_job=run)
        with patch.dict(sys.modules,{'job':fake}),patch.object(producer,'verified_sources',side_effect=verified),patch.object(producer.shutil,'disk_usage',return_value=SimpleNamespace(free=PROFILE['limits']['freeBytes']+1)):
            import subprocess
            with patch.object(subprocess,'Popen',side_effect=AssertionError('no real child'))as spawn:
                code=producer.operation(root,{'mode':'input-closure'},PROFILE,Budget())
                spawn.assert_not_called()
        return code,calls,state,json.loads((root/'bootstrap-result.json').read_bytes())

    def test_actual_operation_runtime720_clamps_to_same_remaining_work_and_preserves_reserve(self):
        for remaining,expected in ((900,720),(700,577)):
            code,calls,state,row=self.model_operation(remaining)
            self.assertEqual(code,0);self.assertEqual(calls[-1][:2],('runtime-closure',expected))
            self.assertEqual(state['remaining'],remaining-expected)
            self.assertTrue(all(seconds<=before-PROFILE['limits']['finalReserveSeconds']-3 for role,seconds,before in calls))
            self.assertGreaterEqual(state['remaining'],123);self.assertTrue(state['closed'])
            self.assertTrue(row['sourcePostVerified']);self.assertFalse(row['sdkBuilt'])
        code,calls,state,row=self.model_operation(100)
        self.assertEqual(code,1);self.assertEqual(calls,[]);self.assertEqual(state['remaining'],100)
        self.assertEqual(row['firstFailure'],'BOOT_ADMISSION');self.assertTrue(state['closed'])

    def test_actual_inventory600_is_bounded_by_existing_clock_not_an_added_deadline(self):
        from types import SimpleNamespace
        function=next(n for n in ast.parse((HERE/'environment.py').read_bytes()).body if isinstance(n,ast.FunctionDef)and n.name=='inventory_installed_roots')
        assignment=next(n for n in function.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='end'for t in n.targets))
        for remaining,expected in ((900,600),(300,300)):
            scope={'clock':SimpleNamespace(remaining=lambda:remaining),'limits':PROFILE['limits'],'time':SimpleNamespace(monotonic=lambda:1000)}
            exec(compile(ast.Module(body=[assignment],type_ignores=[]),'actual-inventory-budget','exec'),scope)
            self.assertEqual(scope['end'],1000+expected)
        self.assertEqual(720-PROFILE['limits']['installedSeconds'],120)

    def test_runtime_failure_remains_primary_through_original_cleanup_and_postcheck(self):
        code,calls,state,row=self.model_operation(900,True)
        self.assertEqual(code,1);self.assertEqual(calls[-1][:2],('runtime-closure',720))
        self.assertEqual(row['firstFailure'],'BOOT_JOB_FAILED')
        self.assertTrue(state['closed']);self.assertFalse(row['parentHandleClosed']);self.assertFalse(row['sourcePostVerified'])


class SourceGnTests(unittest.TestCase):
    temp=BootstrapTests.temp

    def source_result(self,p):
        return {'kind':'windows-arm-source-gn','success':True,'stage':'graph-inventory','firstFailure':None,
            'target':p['target'],'sourceId':p['sourceGn']['sourceId'],
            'graph':{'files':2,'bytes':512,'visited':3,'sha256':'a'*64},
            'generatedArguments':{'targetCpu':'arm64','hostCpu':'x64','criticalArgumentsVerified':True,
                'instanceTracer':False,'remoteExecution':False,'generatedSecurityHeadersVerified':False,'compilerAdmission':False},
            'compilerExecuted':None,'engineCompilationRequested':False,'engineCheckpointImplemented':False,
            'sdkBuilt':False,'nativeAcceptance':False,'sourceCloseFailure':False,'outerJobCleanupNotInferred':True,
            'gitPolicy':{'kind':'owned-source-git-isolation-v1','ownedConfigFiles':[
                {'sha256':'b'*64,'bytes':320},{'sha256':hashlib.sha256(b'').hexdigest(),'bytes':0}],
                'verificationFailed':False,'callerGitConfigAccepted':False,'installedConfigurationWritten':False}}

    def synthetic_host_pins(self):
        p=copy.deepcopy(PROFILE)
        p['sourceGn']['hostTools']={role:{'path':'C:/owned/'+role+'.exe','bytes':12,
            'sha256':'a'*64,'nlink':1}for role in ('node','git')}
        return p

    def test_input_and_passive_jobs_remain_original_while_only_source_parent_and_driver_are_large(self):
        data_policy={'processes':8,'memoryBytes':512*1024**2,'cpuRate':2500}
        source_policy={'processes':64,'memoryBytes':8*1024**3,'cpuRate':2500}
        for mode in PROFILE['modes']:
            for role in (*producer.ROLES,'operation','source-gn','command-inventory'):
                allowed=role in ('operation','command-inventory')if mode=='command-inventory'else role!='command-inventory'and(role!='source-gn'or mode=='source-gn')
                if not allowed:
                    with self.assertRaisesRegex(acquire.Denied,'FULL_ROLE_MODE'):producer.worker_policy(role,{'mode':mode})
                    continue
                expected=source_policy if mode=='source-gn'and role in ('operation','source-gn')else data_policy
                self.assertEqual(producer.worker_policy(role,{'mode':mode}),expected)
        for mode in ('compile','restore','sdk',None):
            with self.assertRaisesRegex(acquire.Denied,'FULL_MODE'):producer.worker_policy('operation',{'mode':mode})

    def test_missing_reviewed_host_pins_or_execution_policy_denies_before_capacity_and_any_data_child(self):
        from types import SimpleNamespace
        missing=copy.deepcopy(PROFILE);missing['sourceGn']['hostTools']['node']=None
        denied=[(missing,'FULL_HOST_TOOL_PIN_MISSING')]
        self.assertIsNone(producer.source_execution_policy(PROFILE))
        for key in PROFILE['sourceGn']['executionPolicy']:
            disabled=copy.deepcopy(PROFILE);disabled['sourceGn']['executionPolicy'][key]=False
            denied.append((disabled,'FULL_EXECUTION_POLICY_UNAVAILABLE'))
        disabled=copy.deepcopy(PROFILE);disabled['phaseAdmission']['source-gn']=False
        denied.append((disabled,'FULL_SOURCE_ADMISSION_UNAVAILABLE'))
        for p,expected in denied:
            root=self.temp()
            with patch.dict(sys.modules,{'job':SimpleNamespace()}),patch.object(producer,'source_capacity',side_effect=AssertionError('no native query')),patch.object(producer,'verified_sources'):
                self.assertEqual(producer.operation(root,{'mode':'source-gn'},p,clock()),1)
            report=json.loads((root/'bootstrap-result.json').read_bytes())
            self.assertEqual(report['firstFailure'],expected);self.assertEqual(report['jobs'],[])
            self.assertIsNone(report['outputExecuted']);self.assertFalse(report['sdkBuilt'])

    def test_actual_source_operation_joins_seven_data_jobs_before_one_driver_under_same_clock_and_reserve(self):
        from types import SimpleNamespace
        p=self.synthetic_host_pins();p['sourceGn']['executionPolicy']={key:True for key in p['sourceGn']['executionPolicy']};p['phaseAdmission']['source-gn']=True
        for failed in (False,True):
            root=self.temp();state={'remaining':7000,'closed':False};calls=[];measurements=[]
            class Budget:
                def remaining(self):return state['remaining']
            budget=Budget()
            class Parent:
                def __init__(self,_event):pass
                def close(self):
                    state['closed']=True
                    if failed:raise OSError('secondary cleanup')
            def run(argv,cwd,output,seconds,**kwargs):
                role=Path(output).name;calls.append((role,seconds,state['remaining']));state['remaining']-=10
                if role=='source-gn':acquire.save(root/'source-gn-result.json',self.source_result(p))
                return {'success':not(failed and role=='source-gn'),'cleanupVerified':True,
                    'rootExit':1 if failed and role=='source-gn'else 0,'activeAtEnd':0}
            def capacity(_root,_profile,current,**kwargs):measurements.append(current);return {'synthetic':True}
            with patch.dict(sys.modules,{'job':SimpleNamespace(ParentCancel=Parent,run_job=run)}),patch.object(producer,'verified_sources'),patch.object(producer,'CONTEXT_SHA','c'*64),patch.object(producer,'source_capacity',side_effect=capacity),patch.object(producer,'verify_source_host_closure',return_value={'synthetic':True})as verified,patch.object(material,'held',return_value=({},None)),patch.object(producer.shutil,'disk_usage',return_value=SimpleNamespace(free=200*1024**3)):
                code=producer.operation(root,{'mode':'source-gn'},p,budget)
                self.assertEqual(verified.call_count,2)
                self.assertTrue(all(call.args[1]is budget for call in verified.call_args_list))
            self.assertEqual([row[0]for row in calls],[*producer.ROLES,'source-gn']);self.assertTrue(state['closed'])
            self.assertTrue(all(value is budget for value in measurements));self.assertEqual(len(measurements),2)
            self.assertEqual(calls[-1][1],calls[-1][2]-123);self.assertLess(calls[-1][1],7200)
            report=json.loads((root/'bootstrap-result.json').read_bytes());self.assertFalse(report['sdkBuilt'])
            if failed:self.assertEqual(code,1);self.assertEqual(report['firstFailure'],'FULL_SOURCE_JOB_FAILED');self.assertFalse(report['parentHandleClosed'])
            else:self.assertEqual(code,0);self.assertTrue(report['sourceGnVerified']);self.assertTrue(report['outputExecuted'])

    def test_source_result_rejects_fake_counts_legacy_identity_compile_claims_and_numeric_booleans(self):
        good=self.source_result(PROFILE);self.assertIs(producer.validate_source_gn_result(good,PROFILE),good)
        for key,value in [('sourceId',PROFILE['sourceId']),('success',1),('sdkBuilt',True),
                          ('compilerExecuted',False),('engineCompilationRequested',True),('stage','cef-gn')]:
            bad=copy.deepcopy(good);bad[key]=value
            with self.assertRaises(acquire.Denied):producer.validate_source_gn_result(bad,PROFILE)
        for key,value in [('files',0),('files',True),('bytes',8*1024**3+1),('visited',1),('sha256','x'*64)]:
            bad=copy.deepcopy(good);bad['graph'][key]=value
            with self.assertRaises(acquire.Denied):producer.validate_source_gn_result(bad,PROFILE)
        bad=copy.deepcopy(good);bad['generatedArguments']['criticalArgumentsVerified']=1
        with self.assertRaises(acquire.Denied):producer.validate_source_gn_result(bad,PROFILE)
        bad=copy.deepcopy(good);bad['gitPolicy']['verificationFailed']=True
        with self.assertRaises(acquire.Denied):producer.validate_source_gn_result(bad,PROFILE)

    def test_reviewed_host_role_bytes_linkcount_and_exact_fields_are_required_not_self_derived(self):
        p=self.synthetic_host_pins();self.assertEqual(producer.source_host_tools(p),p['sourceGn']['hostTools'])
        for key,value in [('path','C:/owned/../git.exe'),('path','//foreign/git.exe'),('bytes',True),('sha256','A'*64),('nlink',0),('nlink',9)]:
            bad=copy.deepcopy(p);bad['sourceGn']['hostTools']['git'][key]=value
            with self.assertRaises(acquire.Denied):producer.source_host_tools(bad)
        bad=copy.deepcopy(p);bad['sourceGn']['hostTools']['node']['observedAsExpected']=True
        with self.assertRaises(acquire.Denied):producer.source_host_tools(bad)
        self.assertEqual(producer.source_host_tools(PROFILE),PROFILE['sourceGn']['hostTools'])
        self.assertTrue(PROFILE['phaseAdmission']['source-gn'])

    def test_actual_capacity_body_observes_available_not_total_memory_and_denies_before_admission(self):
        from types import SimpleNamespace
        gib=1024**3
        for available,free,cpus,valid in ((10*gib,100*gib,4,True),(9*gib,100*gib,4,False),
                                       (10*gib,100*gib-1,4,False),(10*gib,100*gib,3,False)):
            root=self.temp()
            args={'memory':lambda:(32*gib,available),'disk':lambda _root:SimpleNamespace(free=free),'cpus':lambda:cpus}
            if valid:
                result=producer.source_capacity(root,PROFILE,clock(),**args)
                self.assertEqual(result['availablePhysicalBytes'],10*gib);self.assertFalse(result['compilerCapacityProven'])
            else:
                with self.assertRaisesRegex(acquire.Denied,'FULL_CAPACITY_SHORTFALL'):producer.source_capacity(root,PROFILE,clock(),**args)
                self.assertTrue((root/'source-capacity-result.json').is_file())

    def test_capacity_invalid_measurements_and_original_clock_never_admit(self):
        from types import SimpleNamespace
        for value in (float('nan'),True,0,-1):
            root=self.temp()
            with self.assertRaisesRegex(acquire.Denied,'FULL_CAPACITY_FIELDS'):
                producer.source_capacity(root,PROFILE,clock(),memory=lambda:(32*1024**3,value),disk=lambda _:SimpleNamespace(free=100*1024**3),cpus=lambda:4)
        with self.assertRaisesRegex(acquire.Denied,'ACQ_DEADLINE'):
            producer.source_capacity(self.temp(),PROFILE,acquire.Clock(0,0),memory=lambda:self.fail('no native query after deadline'))

    def test_source_driver_argv_is_closed_to_one_node_file_context_and_mode(self):
        p=self.synthetic_host_pins();root=self.temp()
        with patch.object(producer,'CONTEXT_SHA','a'*64),patch('os.getcwd',return_value=str(root)):
            argv=producer.worker_argv('source-gn',root,p)
            self.assertEqual(argv,[p['sourceGn']['hostTools']['node']['path'],'--disable-proto=throw','--no-addons',
                str(HERE/'source-driver.mjs'),'--source-gn',str(root),'a'*64,'--execute'])
            self.assertEqual(producer.closed_worker_command(argv,str(root),p),'source-gn')
            for changed in (argv+['--arbitrary'],[argv[0],'-e','arbitrary',*argv[3:]],argv[:6]+['b'*64]+argv[7:]):
                with self.assertRaises(acquire.Denied):producer.closed_worker_command(changed,str(root),p)

    def test_command_inventory_is_closed_to_exact_candidates_no_path_search_and_no_expected_pin_creation(self):
        from types import SimpleNamespace
        root=self.temp()
        binaries={c['path']:root/('owned-'+str(i)+'.exe') for i,c in enumerate(producer.COMMAND_CANDIDATES) if c['kind']=='pe'}
        for binary in binaries.values():binary.write_bytes(pe())
        configuration=root/'owned-config';configuration.write_text('[credential]\n helper = synthetic\n')
        candidates=PROFILE['commandInventory']['candidates'];seen=[]
        def mapped(value):
            seen.append(str(value));return configuration if str(value).endswith('/etc/gitconfig')else binaries[str(value)]
        with patch.object(producer,'Path',side_effect=mapped):
            result=producer.command_inventory(root,{'mode':'command-inventory','image':'SYNTHETIC','head':'a'*40,
                'repositoryId':'1010282954','sourceDigest':'b'*64},PROFILE,clock(),memory=lambda:(32*1024**3,12*1024**3),
                disk=lambda _:SimpleNamespace(free=110*1024**3),cpus=lambda:4)
        self.assertEqual(seen,[c['path']for c in candidates]);self.assertEqual(len(result['rows']),len(candidates))
        self.assertTrue(all(row['status']=='observed'for row in result['rows']))
        self.assertTrue(any(row.get('machine')==0x8664 for row in result['rows']))
        self.assertTrue(result['rows'][-1]['configurationFacts']['hasCredentialSection'])
        self.assertTrue(all(row['expectedIdentity']is None and not row['executionAdmitted']for row in result['rows']))
        self.assertFalse(result['executed']);self.assertFalse(result['expectedPinsCreated'])
        self.assertTrue((root/'command-inventory-observation.json').is_file())

    def test_command_inventory_extra_or_changed_candidate_denies_without_any_file_read(self):
        from types import SimpleNamespace
        p=copy.deepcopy(PROFILE);p['commandInventory']['candidates'][0]['path']='C:/arbitrary/node.exe'
        with patch.object(producer,'Path',side_effect=AssertionError('no candidate read')):
            with self.assertRaisesRegex(acquire.Denied,'FULL_INVENTORY_CANDIDATES'):
                producer.command_inventory(self.temp(),{'mode':'command-inventory'},p,clock(),memory=lambda:(1,1),
                    disk=lambda _:SimpleNamespace(free=1),cpus=lambda:1)

    def test_command_inventory_aggregate_stops_before_next_reader_and_keeps_primary(self):
        from types import SimpleNamespace
        root=self.temp();file=root/'owned';file.write_bytes(b'owned');calls=[]
        class Candidate:
            def lstat(self):return SimpleNamespace(st_size=256*1024**2,st_nlink=1)
        def held(path,clk,**kw):
            calls.append(kw['maximum']);kw['progress'](256*1024**2)
            return {'bytes':256*1024**2,'sha256':'a'*64,'identity':[1,len(calls)]},b'synthetic'
        sentinel=acquire.Denied('FULL_INVENTORY_BYTES');original_need=acquire.need
        def need(ok,code):
            if not ok and code=='FULL_INVENTORY_BYTES':raise sentinel
            return original_need(ok,code)
        args=(root,{'mode':'command-inventory'},PROFILE,clock())
        metadata={'machine':0x8664,'machineKind':'x64','version':None,'versionStatus':'absent','imports':[],'delayImports':[]}
        with patch.object(producer,'source_capacity',return_value={}),patch.object(producer,'Path',return_value=Candidate()),patch.object(acquire,'plain',return_value=file),patch.object(material,'held',side_effect=held),patch.object(material,'pe_metadata',return_value=metadata),patch.object(acquire,'need',side_effect=need):
            with self.assertRaisesRegex(acquire.Denied,'FULL_INVENTORY_BYTES')as raised:
                producer.command_inventory(*args)
            self.assertIs(raised.exception,sentinel)
        self.assertEqual(calls,[256*1024**2]*2)
        result=json.loads((root/'command-inventory-observation.json').read_bytes())
        self.assertEqual(result['observedBytes'],512*1024**2)
        self.assertIs(result['complete'],False);self.assertIs(result['success'],False)
        self.assertEqual([r['status'] for r in result['rows']],['observed','observed','denied'])
        calls.clear()
        with patch.object(producer,'source_capacity',return_value={}),patch.object(producer,'Path',return_value=Candidate()),patch.object(acquire,'plain',return_value=file),patch.object(material,'held',side_effect=held),patch.object(material,'pe_metadata',return_value=metadata),patch.object(acquire,'save',side_effect=OSError('private sink')):
            with self.assertRaisesRegex(acquire.Denied,'FULL_INVENTORY_BYTES'):
                producer.command_inventory(*args)

    def test_command_inventory_physical_small_boundary_never_opens_third_candidate(self):
        # Execute the production body with only its fixed 512MiB constant scaled
        # to two tiny real PE fixtures; no alternative implementation or large I/O.
        source=ast.parse((HERE/'producer.py').read_bytes())
        body=copy.deepcopy(next(n for n in source.body if isinstance(n,ast.FunctionDef)and n.name=='command_inventory'))
        raw=pe();cap=2*len(raw)
        class Cap(ast.NodeTransformer):
            def visit_BinOp(self,node):
                if ast.unparse(node)=='512 * 1024 ** 2':return ast.copy_location(ast.Constant(cap),node)
                return self.generic_visit(node)
        body=Cap().visit(body);scope=dict(producer.__dict__)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[body],type_ignores=[])),'actual-inventory-small-cap','exec'),scope)
        root=self.temp();files={c['path']:root/('owned-'+str(i)) for i,c in enumerate(producer.COMMAND_CANDIDATES)}
        for file in files.values():file.write_bytes(raw)
        opens=[];original=Path.open
        def opened(path,*args,**kw):
            if path in files.values() and args and args[0]=='rb':opens.append(path)
            return original(path,*args,**kw)
        with patch.object(Path,'open',opened):
            # Extracted function retains the production globals snapshot.
            scope['Path']=lambda value:files[str(value)];scope['source_capacity']=lambda *a,**k:{}
            with self.assertRaisesRegex(acquire.Denied,'FULL_INVENTORY_BYTES'):
                scope['command_inventory'](root,{'mode':'command-inventory'},PROFILE,clock())
        self.assertEqual(len(opens),2)
        observation=json.loads((root/'command-inventory-observation.json').read_bytes())
        self.assertEqual(observation['observedBytes'],cap)
        self.assertFalse(observation['complete'])

    def test_scoped_observed_multilink_reader_does_not_relax_original_default(self):
        root=self.temp();file=root/'file';file.write_bytes(b'owned passive file');os.link(file,root/'link')
        with self.assertRaisesRegex(acquire.Denied,'ACQ_FILE'):material.held(file,clock())
        observed,_=material.held(file,clock(),expected_nlink=2)
        self.assertEqual(observed['sha256'],hashlib.sha256(file.read_bytes()).hexdigest())
        for value in (True,0,1,3,9):
            with self.assertRaisesRegex(acquire.Denied,'ACQ_FILE'):material.held(file,clock(),expected_nlink=value)


class ImportGraphTests(unittest.TestCase):
    temp=BootstrapTests.temp

    def graph(self, mapping, *, candidates=None, reader=None):
        state={'rows':[],'edges':[]};seen=[]
        candidates=candidates or [{'role':'fixture','path':producer.COMMAND_DLL_ROOT+'root.dll','kind':'pe'}]
        def read(candidate):
            seen.append(candidate['path'])
            if reader:return reader(candidate)
            imports,delay=mapping[candidate['path']]
            return {'imports':imports,'delayImports':delay}
        producer.command_import_graph(candidates,clock(),read,state)
        return state,seen

    def test_transitive_five_observed_missing_names_cycles_and_delays_are_rooted_once(self):
        base=producer.COMMAND_DLL_ROOT
        missing=['libbrotlidec.dll','libidn2-0.dll','libpsl-5.dll','libssh2-1.dll','libzstd.dll']
        mapping={base+'root.dll':(missing,['KERNEL32.dll']),**{base+n:([],[]) for n in missing}}
        mapping[base+missing[0]]=([missing[1],'root.dll'],[])
        state,seen=self.graph(mapping)
        self.assertEqual(seen,[base+'root.dll',*[base+n for n in missing]])
        self.assertEqual(len(state['edges']),8)
        self.assertEqual(state['edges'][5]['classification'],'system-name-only')
        self.assertTrue(all(e.get('target','').startswith(base) for e in state['edges'] if e['classification']=='rooted-candidate'))

    def test_case_collision_denies_before_second_spelling_is_opened(self):
        base=producer.COMMAND_DLL_ROOT;seen=[];state={'rows':[],'edges':[]}
        def read(candidate):seen.append(candidate['path']);return {'imports':['safe.dll','SAFE.dll'],'delayImports':[]}
        with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_CASE'):
            producer.command_import_graph([{'role':'fixture','path':base+'root.dll','kind':'pe'}],clock(),read,state)
        self.assertEqual(seen,[base+'root.dll'])

    def test_unsafe_names_do_not_create_candidates(self):
        for name in ('../escape.dll','a/b.dll','a\\b.dll','C:evil.dll','name.dll ',
                     'name.dll.','con.dll','LPT1.dll','nul.x.dll','a..b.dll','not-a-dll.exe',42):
            with self.subTest(name=name):
                seen=[]
                def read(candidate):seen.append(candidate['path']);return {'imports':[name],'delayImports':[]}
                with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_NAME'):
                    self.graph({},reader=read)
                self.assertEqual(len(seen),1)

    def test_finite_system_table_does_not_whitelist_unknown_api_or_vendor_runtime(self):
        base=producer.COMMAND_DLL_ROOT
        names=['api-ms-win-unknown-l1-1-0.dll','vcruntime140.dll']
        mapping={base+'root.dll':(names,[]),**{base+n:([],[]) for n in names}}
        state,seen=self.graph(mapping)
        self.assertEqual(seen,[base+'root.dll',*[base+n for n in names]])
        self.assertTrue(all(e['classification']=='rooted-candidate'for e in state['edges']))

    def test_unique_file_and_edge_caps_stop_before_new_reader(self):
        base=producer.COMMAND_DLL_ROOT;seen=[]
        def read(candidate):
            seen.append(candidate['path'])
            return {'imports':['n'+str(i)+'.dll' for i in range(64)],'delayImports':[]}
        with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_FILES'):self.graph({},reader=read)
        self.assertEqual(len(seen),1)
        def edges(candidate):return {'imports':['KERNEL32.dll']*256,'delayImports':['USER32.dll']}
        with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_EDGES'):self.graph({},reader=edges)
        row,seen=self.graph({},reader=lambda c:{'imports':['KERNEL32.dll']*256,'delayImports':[]})
        self.assertEqual(len(row['edges']),256)
        def chain(candidate):
            index=int(Path(candidate['path']).stem[1:])
            return {'imports':['n'+str(index+1)+'.dll'] if index<63 else [],'delayImports':[]}
        rows,seen=self.graph({},candidates=[{'role':'fixture','path':base+'n0.dll','kind':'pe'}],reader=chain)
        self.assertEqual(len(seen),64);self.assertEqual(len(rows['edges']),63)

    def inventory(self,root,reader,*,save=None):
        from types import SimpleNamespace
        args=(root,{'mode':'command-inventory','image':'SYNTHETIC','head':'a'*40,
              'repositoryId':'1010282954','sourceDigest':'b'*64},PROFILE,clock())
        context=patch.object(acquire,'save',side_effect=save) if save else patch.object(producer,'CONTEXT_SHA',None)
        with patch.object(producer,'source_capacity',return_value={}),patch.object(producer,'Path',side_effect=reader),context:
            return producer.command_inventory(*args)

    def test_missing_candidate_retains_closed_phase_and_never_self_pins(self):
        root=self.temp();missing=root/'missing';calls=[]
        def mapped(path):calls.append(path);return missing
        with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_MISSING')as raised:self.inventory(root,mapped)
        self.assertIsInstance(raised.exception.__cause__,FileNotFoundError)
        value=json.loads((root/'command-inventory-observation.json').read_bytes())
        self.assertEqual(value['rows'][0]['status'],'missing');self.assertEqual(len(calls),1)
        self.assertFalse(value['complete']);self.assertFalse(value['expectedPinsCreated'])

    def test_distinct_paths_same_physical_file_denied(self):
        root=self.temp();file=root/'owned';file.write_bytes(pe())
        with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_IDENTITY_ALIAS'):
            self.inventory(root,lambda _:file)
        value=json.loads((root/'command-inventory-observation.json').read_bytes())
        self.assertEqual([r['status']for r in value['rows']],['observed','denied'])

    def test_real_held_pe_reads_follow_two_transitive_dlls_and_charge_same_ledger(self):
        root=self.temp();base=producer.COMMAND_DLL_ROOT
        files={c['path']:root/('fixture-'+str(i)) for i,c in enumerate(producer.COMMAND_CANDIDATES)}
        files.update({base+name:root/name for name in ('first.dll','second.dll')})
        total=0
        for candidate,file in files.items():
            if candidate.endswith('/etc/gitconfig'):raw=b'[core]\n bare = false\n'
            else:
                raw=bytearray(pe(version=False))
                imported='first.dll' if candidate==base+'libcurl-4.dll' else 'second.dll' if candidate==base+'first.dll' else 'kernel32.dll'
                raw[0x380:0x400]=bytes(0x80)
                raw[0x380:0x380+len(imported)+1]=imported.encode()+b'\0'
                raw=bytes(raw)
            file.write_bytes(raw);total+=len(raw)
        seen=[]
        def mapped(path):seen.append(path);return files[path]
        result=self.inventory(root,mapped)
        self.assertEqual(seen,[*[c['path']for c in producer.COMMAND_CANDIDATES],base+'first.dll',base+'second.dll'])
        self.assertEqual(result['observedBytes'],total)
        self.assertEqual(len(result['rows']),14)
        self.assertEqual(len([e for e in result['edges'] if e['classification']=='rooted-candidate']),2)
        self.assertFalse(result['executionAdmitted']);self.assertFalse(result['gnExecuted'])

    def test_read_primary_is_not_replaced_by_retention_failure(self):
        root=self.temp();sentinel=OSError('synthetic read failure')
        def broken(_):raise sentinel
        producer.COMMAND_INVENTORY_REPORTING_FAILURE=False
        with self.assertRaises(OSError)as raised:self.inventory(root,broken,save=OSError('synthetic sink'))
        self.assertIs(raised.exception,sentinel)
        self.assertTrue(producer.COMMAND_INVENTORY_REPORTING_FAILURE)
        producer.COMMAND_INVENTORY_REPORTING_FAILURE=False

    def test_changed_graph_policy_denies_before_candidate_reads(self):
        root=self.temp();p=copy.deepcopy(PROFILE);p['commandInventory']['importGraph']['dllRoot']='C:/arbitrary/'
        with patch.object(producer,'source_capacity',return_value={}),patch.object(producer,'Path',side_effect=AssertionError('no read')):
            with self.assertRaisesRegex(acquire.Denied,'FULL_IMPORT_POLICY'):
                producer.command_inventory(root,{'mode':'command-inventory'},p,clock())


class InventoryClockTests(unittest.TestCase):
    temp=BootstrapTests.temp

    def fixture(self, old=False, advance=None, seconds=(3600,3600), post_failure=False):
        root=self.temp();file=root/'owned-input';raw=b'x'*(material.CHUNK*2+17);file.write_bytes(raw)
        state={'wall':1000.0,'mono':2000.0,'reads':0,'projectionClocks':[],'progressClocks':[],'inventoryClocks':[]}
        real_clock=acquire.Clock;whole=real_clock(1000+seconds[0],2000+seconds[1],wall=lambda:state['wall'],mono=lambda:state['mono'])
        original_open=Path.open;progress_type=producer.RuntimeProgress
        class ObservedProgress(progress_type):
            def __init__(self,root,clock):state['progressClocks'].append(clock);super().__init__(root,clock)
        class AdvancingReader:
            def __init__(self,stream):self.stream=stream
            def __getattr__(self,name):return getattr(self.stream,name)
            def read(self,size):
                chunk=self.stream.read(size);state['reads']+=1
                if state['reads']==1:
                    if advance in ('wall','both'):state['wall']+=601
                    if advance in ('mono','both'):state['mono']+=601
                return chunk
        def opened(path,*args,**kwargs):
            stream=original_open(path,*args,**kwargs)
            return AdvancingReader(stream)if path==file and args and args[0]=='rb'else stream
        def constructed(wall_end,mono_end):return real_clock(wall_end,mono_end,wall=lambda:state['wall'],mono=lambda:state['mono'])
        def inventory(profile,clock,progress):
            # Replace the vendor tree walk with a REAL held physical two-chunk
            # file. Clock creation/forwarding and the read loop are production.
            state['inventoryClocks'].append(clock)
            pin,_=material.held(file,clock,maximum=len(raw))
            if advance=='after-inventory':state['wall']+=601;state['mono']+=601
            return {'fixtureOwnedInput':pin,'vendorInventoryClaim':False}
        def projection(root,profile,clock):state['projectionClocks'].append(clock);return {'fixture':True,'executed':False}
        def post(root):
            if post_failure:raise acquire.Denied('BOOT_POSTCHECK')
        with patch.object(sys,'addaudithook'),patch.object(producer,'verified_sources',side_effect=post),patch.object(producer,'RuntimeProgress',ObservedProgress),patch.object(acquire,'Clock',side_effect=constructed),patch.object(producer.time,'time',side_effect=lambda:state['wall']),patch.object(producer.time,'monotonic',side_effect=lambda:state['mono']),patch.object(environment,'installed_inventory',side_effect=inventory),patch.object(material,'runtime_projection',side_effect=projection),patch.object(Path,'open',new=opened):
            worker=producer.data_worker
            if old:
                function=copy.deepcopy(next(n for n in ast.parse((HERE/'producer.py').read_bytes()).body if isinstance(n,ast.FunctionDef)and n.name=='data_worker'))
                first=next(n for n in function.body if isinstance(n,ast.Try)).body[0]
                self.assertEqual(ast.unparse(first.test),"role == 'command-inventory'")
                self.assertEqual(len(first.body),1)
                self.assertEqual(ast.unparse(first.body[0]),'command_inventory(root, c, p, clock)')
                attempt=next(n for n in function.body if isinstance(n,ast.Try));attempt.body[0]=first.orelse[0]
                flag=next(n for n in attempt.finalbody if isinstance(n,ast.If)and ast.unparse(n.test)=='COMMAND_INVENTORY_REPORTING_FAILURE')
                self.assertEqual(ast.unparse(flag.body[0]),"result['inventoryObservationReportingFailure'] = True")
                attempt.finalbody.remove(flag)
                assignments=[n for n in ast.walk(function)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='inventory_clock'for t in n.targets)]
                self.assertEqual(len(assignments),1)
                runtime=next(n for n in ast.walk(function)if isinstance(n,ast.If)and ast.unparse(n.test)=="role == 'runtime-closure'")
                runtime.body.remove(assignments[0])
                completion=next(n for n in runtime.body if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Attribute)and isinstance(n.value.func.value,ast.Name)and n.value.func.value.id=='inventory_clock')
                runtime.body.remove(completion)
                call=next(n for n in ast.walk(function)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='installed_inventory')
                call.args[1]=ast.Name(id='clock',ctx=ast.Load())
                self.assertEqual(hashlib.sha256(ast.dump(function,include_attributes=False).encode()).hexdigest(),'144c4d772d2b075c35e6a8b50eca879c0a26ffdec393647ee0366c60cb635439')
                scope=dict(producer.__dict__)
                exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),'actual-pinned59e-worker','exec'),scope)
                worker=scope['data_worker']
            code=worker('runtime-closure',root,{},PROFILE,whole)
        return code,state,whole,json.loads((root/'runtime-closure-result.json').read_bytes())

    def test_actual_old_worker_reads_more_after600_but_new_local_clock_denies_next_chunk(self):
        for domain in ('wall','mono','both'):
            with self.subTest(domain=domain):
                old,state,whole,row=self.fixture(old=True,advance=domain)
                self.assertEqual(old,0);self.assertEqual(state['reads'],4)
                self.assertIs(state['inventoryClocks'][0],whole)
                new,state,whole,row=self.fixture(advance=domain)
                self.assertEqual(new,1);self.assertEqual(state['reads'],1)
                self.assertGreater(whole.remaining(),0)
                self.assertEqual(row['firstFailure'],'ACQ_DEADLINE');self.assertTrue(row['sourcePostVerified'])
                self.assertEqual(state['projectionClocks'],[]);self.assertIs(state['progressClocks'][0],whole)

    def test_inventory_wall_and_monotonic_min_keep_short_remaining_and_projection_original_clock(self):
        for seconds,expected in (((300,900),(1300,2600)),((900,300),(1600,2300)),((3600,3600),(1600,2600))):
            code,state,whole,row=self.fixture(seconds=seconds)
            self.assertEqual(code,0);local=state['inventoryClocks'][0]
            self.assertIsNot(local,whole);self.assertEqual((local.wall_end,local.mono_end),expected)
            self.assertEqual(state['projectionClocks'],[whole]);self.assertEqual(state['progressClocks'],[whole])
            self.assertTrue(row['success'])

    def test_inventory_deadline_remains_primary_with_failing_source_postcheck(self):
        code,state,whole,row=self.fixture(advance='both',post_failure=True)
        self.assertEqual(code,1);self.assertEqual(state['reads'],1)
        self.assertEqual(row['firstFailure'],'ACQ_DEADLINE');self.assertFalse(row['sourcePostVerified'])
        self.assertFalse(row['success']);self.assertGreater(whole.remaining(),0)

    def test_inventory_must_finish_inside_local_clock_before_saving_or_projection(self):
        old,state,whole,row=self.fixture(old=True,advance='after-inventory')
        self.assertEqual(old,0)
        new,state,whole,row=self.fixture(advance='after-inventory')
        self.assertEqual(new,1);self.assertEqual(row['firstFailure'],'ACQ_DEADLINE')
        self.assertEqual(state['projectionClocks'],[]);self.assertGreater(whole.remaining(),0)


class ReviewedHostClosureTests(unittest.TestCase):
    temp=BootstrapTests.temp

    def fixture(self):
        # Genuine small held PE bodies at owned paths. Mapping installed names
        # to fixtures is test-only; the production verifier never rewrites them.
        root=self.temp();p=copy.deepcopy(PROFILE);rows=p['sourceGn']['hostClosure']['rows'];files={}
        for i,row in enumerate(rows):
            name=Path(rows[11]['path']).name if i==0 else Path(rows[i+1]['path']).name if 11<=i<17 else 'kernel32.dll'
            raw=bytearray(pe(version=False));raw[0x380:0x3c0]=bytes(0x40)
            raw[0x380:0x380+len(name)+1]=name.encode()+b'\0'
            file=root/('owned-'+str(i));file.write_bytes(raw);files[row['path']]=file
            row.update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),nlink=1)
        for role in ('node','git'):
            pin=p['sourceGn']['hostTools'][role];row=next(row for row in rows if row['path']==pin['path'])
            pin.update(bytes=row['bytes'],sha256=row['sha256'],nlink=1)
        value=p['sourceGn']['hostClosure'];value['peBytes']=sum(row['bytes']for row in rows)
        state={'rows':[],'edges':[]}
        producer.command_import_graph([row for row in producer.COMMAND_CANDIDATES if row['kind']=='pe'],clock(),
            lambda candidate:material.pe_metadata(files[candidate['path']].read_bytes()),state)
        value['edgeCount']=len(state['edges']);value['edgeSha256']=producer.source_edges_digest(state['edges'])
        calls=[]
        def read(path,current,**kwargs):
            calls.append(path)
            return material.held(files[path],current,**kwargs)
        return p,files,calls,read

    def test_root_adopted_table_is_finite_and_only_closed_source_gn_is_activated(self):
        rows=producer.source_host_closure_rows(PROFILE,PROFILE['image'])
        self.assertEqual(len(rows),18)
        self.assertEqual(sum(row['bytes']for row in rows.values()),113853492)
        self.assertEqual(PROFILE['sourceGn']['hostClosure']['edgeCount'],242)
        self.assertEqual(PROFILE['sourceGn']['hostClosure']['edgeSha256'],'78537ac08d4dddabd50a5c83cdbd676114fdf03cf9abe670359c4ffd20ba5d9a')
        self.assertNotIn('C:/Program Files/Git/etc/gitconfig'.lower(),rows)
        self.assertLessEqual(len((HERE/'profile.json').read_bytes()),65536)
        self.assertTrue(PROFILE['phaseAdmission']['source-gn'])
        self.assertTrue(PROFILE['sourceGn']['executionPolicy']['hostLoaderClosureApproved'])
        self.assertTrue(PROFILE['sourceGn']['executionPolicy']['sourceHookCommandClosureApproved'])

    def test_actual_shared_reader_and_pe_graph_verify_eighteen_physical_files(self):
        p,files,calls,read=self.fixture()
        result=producer.verify_source_host_closure(p,clock(),p['image'],reader=read)
        self.assertEqual(len(calls),18);self.assertEqual(len(set(calls)),18)
        self.assertEqual(result['bytes'],sum(file.stat().st_size for file in files.values()))
        self.assertEqual(result['edgeSha256'],p['sourceGn']['hostClosure']['edgeSha256'])
        self.assertFalse(result['candidateExecuted']);self.assertFalse(result['systemNameBytesProven'])

    def test_hash_nlink_machine_and_missing_identity_stop_before_next_physical_reader(self):
        for fault in ('hash','nlink','machine','missing'):
            p,files,calls,read=self.fixture();first=p['sourceGn']['hostClosure']['rows'][0];file=files[first['path']]
            if fault=='hash':raw=bytearray(file.read_bytes());raw[-1]^=1;file.write_bytes(raw)
            if fault=='nlink':first['nlink']=2;p['sourceGn']['hostTools']['node']['nlink']=2
            if fault=='machine':
                raw=bytearray(file.read_bytes());struct.pack_into('<H',raw,0x84,0xaa64);file.write_bytes(raw)
                first['sha256']=hashlib.sha256(raw).hexdigest();p['sourceGn']['hostTools']['node']['sha256']=first['sha256']
            if fault=='missing':file.unlink()
            with self.assertRaises((acquire.Denied,FileNotFoundError)):
                producer.verify_source_host_closure(p,clock(),p['image'],reader=read)
            self.assertEqual(len(calls),1,fault)

    def test_image_schema_and_aggregate_fail_before_any_reader(self):
        p,files,calls,read=self.fixture()
        with self.assertRaisesRegex(acquire.Denied,'FULL_HOST_IMAGE'):
            producer.verify_source_host_closure(p,clock(),'wrong',reader=read)
        for fault in ('extra','duplicate','path','aggregate','config'):
            changed=copy.deepcopy(p);rows=changed['sourceGn']['hostClosure']['rows']
            if fault=='extra':rows.append(copy.deepcopy(rows[-1]))
            if fault=='duplicate':rows[-1]=copy.deepcopy(rows[0])
            if fault=='path':rows[-1]['path']='C:/foreign/unknown.dll'
            if fault=='config':rows[-1]['path']='C:/Program Files/Git/etc/gitconfig'
            if fault=='aggregate':
                for row in rows:row['bytes']=256*1024**2
                for role in ('node','git'):changed['sourceGn']['hostTools'][role]['bytes']=256*1024**2
                changed['sourceGn']['hostClosure']['peBytes']=18*256*1024**2
            with self.assertRaises(acquire.Denied):producer.verify_source_host_closure(changed,clock(),p['image'],reader=read)
        self.assertEqual(calls,[])

    def test_unexpected_graph_node_is_denied_before_open_and_bad_edge_digest_never_completes(self):
        p,files,calls,read=self.fixture();first=p['sourceGn']['hostClosure']['rows'][0];file=files[first['path']]
        raw=bytearray(file.read_bytes());name=b'not-approved.dll\0';raw[0x380:0x3c0]=bytes(0x40);raw[0x380:0x380+len(name)]=name;file.write_bytes(raw)
        first['sha256']=hashlib.sha256(raw).hexdigest();p['sourceGn']['hostTools']['node']['sha256']=first['sha256']
        with self.assertRaisesRegex(acquire.Denied,'FULL_HOST_CLOSURE_UNEXPECTED'):
            producer.verify_source_host_closure(p,clock(),p['image'],reader=read)
        self.assertEqual(len(calls),11);self.assertFalse(any('not-approved' in value for value in calls))
        p,files,calls,read=self.fixture();p['sourceGn']['hostClosure']['edgeSha256']='0'*64
        with self.assertRaisesRegex(acquire.Denied,'FULL_HOST_CLOSURE_GRAPH'):
            producer.verify_source_host_closure(p,clock(),p['image'],reader=read)
        self.assertEqual(len(calls),18)

    def test_actual_parent_image_failure_denies_before_capacity_or_data_jobs(self):
        from types import SimpleNamespace
        p=copy.deepcopy(PROFILE);p['sourceGn']['executionPolicy']={key:True for key in p['sourceGn']['executionPolicy']};p['phaseAdmission']['source-gn']=True
        root=self.temp()
        with patch.dict(sys.modules,{'job':SimpleNamespace()}),patch.object(producer,'source_capacity',side_effect=AssertionError('no capacity query')):
            self.assertEqual(producer.operation(root,{'mode':'source-gn','image':'wrong'},p,clock()),1)
        report=json.loads((root/'bootstrap-result.json').read_bytes())
        self.assertEqual(report['firstFailure'],'FULL_HOST_IMAGE');self.assertEqual(report['jobs'],[])

    def test_edge_digest_uses_sorted_rows_and_all_sorted_dictionary_keys_without_newline(self):
        edges=[{'from':'C:/z','kind':'import','name':'B.dll','classification':'rooted-candidate','target':'C:/root/B.dll'},
               {'from':'C:/A','kind':'delay','name':'a.dll','classification':'system-name-only'}]
        canonical=b'[{"classification":"system-name-only","from":"C:/A","kind":"delay","name":"a.dll"},{"classification":"rooted-candidate","from":"C:/z","kind":"import","name":"B.dll","target":"C:/root/B.dll"}]'
        self.assertEqual(producer.source_edges_digest(edges),hashlib.sha256(canonical).hexdigest())

    def test_real_second_verification_failure_stops_before_node_and_preserves_primary_through_parent_cleanup(self):
        from types import SimpleNamespace
        p,files,calls,read=self.fixture();p['sourceGn']['executionPolicy']={key:True for key in p['sourceGn']['executionPolicy']};p['phaseAdmission']['source-gn']=True
        root=self.temp();jobs=[];checks=[];closed=[]
        actual=producer.verify_source_host_closure
        def verify(profile,current,image):
            checks.append(current)
            if len(checks)==2:
                file=files[p['sourceGn']['hostClosure']['rows'][0]['path']]
                raw=bytearray(file.read_bytes());raw[-1]^=1;file.write_bytes(raw)
            return actual(profile,current,image,reader=read)
        class Parent:
            def __init__(self,_event):pass
            def close(self):closed.append(True);raise OSError('secondary cleanup')
        def run(argv,cwd,output,seconds,**kwargs):
            jobs.append(Path(output).name)
            return {'success':True,'cleanupVerified':True,'rootExit':0,'activeAtEnd':0}
        current=acquire.Clock(time.time()+1000,time.monotonic()+1000)
        with patch.dict(sys.modules,{'job':SimpleNamespace(ParentCancel=Parent,run_job=run)}),patch.object(producer,'verified_sources'),patch.object(producer,'CONTEXT_SHA','c'*64),patch.object(producer,'verify_source_host_closure',side_effect=verify),patch.object(producer,'source_capacity',return_value={}),patch.object(producer.shutil,'disk_usage',return_value=SimpleNamespace(free=200*1024**3)):
            self.assertEqual(producer.operation(root,{'mode':'source-gn','image':p['image']},p,current),1)
        self.assertEqual(jobs,list(producer.ROLES));self.assertEqual(len(checks),2)
        self.assertTrue(all(value is current for value in checks));self.assertEqual(len(calls),19)
        self.assertEqual(closed,[True])
        report=json.loads((root/'bootstrap-result.json').read_bytes())
        self.assertEqual(report['firstFailure'],'ACQ_HASH');self.assertFalse(report['parentHandleClosed'])


if __name__ == "__main__":
    unittest.main()
