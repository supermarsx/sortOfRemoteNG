"""Pure fixtures only. Never import job.py or call Windows/native APIs."""
import ast
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("pure_observe", HERE / "observe.py")
observe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observe)
PROFILE = observe.profile_bytes((HERE / "profile.json").read_bytes())


class PureContracts(unittest.TestCase):
    def test_cross_view_ctime_difference_is_not_a_mutation_waiver(self):
        fields = dict(st_dev=1,st_ino=2,st_size=3,st_mtime_ns=4,st_birthtime_ns=5,st_nlink=1)
        path = types.SimpleNamespace(**fields,st_ctime_ns=6)
        fd = types.SimpleNamespace(**fields,st_ctime_ns=7)
        observe.verify_open_identity(path,fd)
        observe.verify_snapshots(path,fd,path,fd)
        changed_path = types.SimpleNamespace(**fields,st_ctime_ns=8)
        changed_fd = types.SimpleNamespace(**fields,st_ctime_ns=9)
        for after_path,after_fd in [(changed_path,fd),(path,changed_fd)]:
            with self.assertRaisesRegex(ValueError,'TOOLS_FILE_CHANGED'):
                observe.verify_snapshots(path,fd,after_path,after_fd)
        for key in ['st_dev','st_ino','st_size','st_mtime_ns','st_birthtime_ns','st_nlink']:
            changed={**fields,key:fields[key]+1}
            with self.assertRaisesRegex(ValueError,'TOOLS_FILE_CHANGED'):
                observe.verify_snapshots(path,fd,types.SimpleNamespace(**changed,st_ctime_ns=6),types.SimpleNamespace(**changed,st_ctime_ns=7))
        for key in ['st_dev','st_ino','st_size','st_mtime_ns','st_birthtime_ns','st_nlink']:
            altered = {**fields,key:fields[key]+1}
            with self.assertRaisesRegex(ValueError,'TOOLS_OPEN_IDENTITY'):
                observe.verify_open_identity(path,types.SimpleNamespace(**altered,st_ctime_ns=7))
        without_birth = types.SimpleNamespace(st_dev=1,st_ino=2,st_size=3,st_mtime_ns=4,st_nlink=1)
        with self.assertRaisesRegex(ValueError,'TOOLS_BIRTHTIME_UNAVAILABLE'):
            observe.common_identity(without_birth,require_birth=True)

    def test_actual_own_source_held_identity_without_native_calls(self):
        file = (HERE/'observe.py').resolve()
        raw = file.read_bytes()
        row = {'path':str(file),'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'nlink':1,'machine':None}
        with observe.held_file(row):
            pass

    def test_profile_pin_and_closed_limits(self):
        self.assertEqual(len(PROFILE["files"]), 25)
        self.assertEqual(sum(x["size"] for x in PROFILE["files"]), 83648151)
        self.assertLessEqual(len(PROFILE["files"]), 32)
        with self.assertRaisesRegex(ValueError, "TOOLS_PROFILE_PIN"):
            observe.profile_bytes((HERE / "profile.json").read_bytes()+b" ")
        self.assertIsNone(PROFILE["closure"]["setupCompatibility"])
        self.assertFalse(PROFILE["closure"]["loadedModulesVerified"])
        self.assertEqual(PROFILE["files"][1]["nlink"], 4)
        self.assertEqual(PROFILE["files"][23]["machine"], 0x8664)

    def test_command_table_no_sources_or_links(self):
        self.assertEqual(observe.version_argv("cl", PROFILE)[1:], ["/Bv"])
        self.assertEqual(observe.version_argv("link", PROFILE)[1:], ["/help"])
        self.assertEqual(observe.version_argv("git", PROFILE)[1:], ["--version"])
        self.assertEqual(observe.version_argv("powershell", PROFILE)[1:4], ["-NoLogo", "-NoProfile", "-NonInteractive"])
        with self.assertRaisesRegex(ValueError, "TOOLS_ROLE"):
            observe.version_argv("foreign", PROFILE)

    def test_worker_argv_denies_extra_and_wrong_role_or_root(self):
        root = Path.cwd()
        good = observe.worker_argv("cl", root, PROFILE)
        self.assertEqual(observe.closed_worker_command(good, root, PROFILE), "cl")
        for bad in [good+["extra"], good[:-1], good[:5]+["engine"]+good[6:], ["foreign"]+good[1:], good[:4]+["--compile"]+good[5:]]:
            with self.assertRaises(ValueError):
                observe.closed_worker_command(bad, root, PROFILE)

    def test_no_inherited_credentials_or_loader_path(self):
        env = observe.minimal_environment(Path.cwd())
        self.assertEqual(set(env), {"SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "PYTHONDONTWRITEBYTECODE", "POWERSHELL_TELEMETRY_OPTOUT", "POWERSHELL_UPDATECHECK", "DOTNET_CLI_TELEMETRY_OPTOUT"})
        self.assertEqual(env["PATH"], "C:/Windows/System32")
        for key in ["GH_TOKEN", "GITHUB_TOKEN", "PYTHONPATH", "INCLUDE", "LIB", "CL", "_CL_", "LINK"]:
            self.assertNotIn(key, env)

    def test_trust_closes_zero_and_nonzero_status(self):
        for status, closed, success in [(0, 0, True), (1, 0, False), (0, 1, False), (-2146762496, 0, False)]:
            calls = []
            def verify(data):
                calls.append(data.action)
                return status if data.action == 1 else closed
            result = observe.close_trust(verify, types.SimpleNamespace(action=None))
            self.assertEqual(calls, [1, 2])
            self.assertEqual(result["verified"], success)
            self.assertEqual(result["closeStatus"], closed)
            self.assertEqual(result["status"], status & 0xffffffff)

    def test_trust_exception_still_closes(self):
        calls = []
        def verify(data):
            calls.append(data.action)
            if data.action == 1:
                raise RuntimeError("synthetic")
            return 0
        with self.assertRaises(RuntimeError):
            observe.close_trust(verify, types.SimpleNamespace(action=None))
        self.assertEqual(calls, [1, 2])

    def test_file_pin_and_postmutation(self):
        with tempfile.TemporaryDirectory(prefix="arm-pure-") as name:
            file = Path(name).resolve()/"sample"
            with file.open("wb") as stream:
                stream.write(b"plain fixture");stream.flush();os.fsync(stream.fileno())
            row = {"path": str(file), "size": file.stat().st_size, "nlink": 1, "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "machine": None}
            with observe.held_file(row):
                pass
            with self.assertRaisesRegex(ValueError, "TOOLS_FILE_CHANGED"):
                with observe.held_file(row):
                    file.write_bytes(b"changed bytes")
            with self.assertRaisesRegex(ValueError, "TOOLS_FILE_PIN"):
                with observe.held_file(row):
                    pass

    def test_pe_machine_cannot_be_bypassed(self):
        with tempfile.TemporaryDirectory(prefix="arm-pe-pure-") as name:
            file = Path(name).resolve()/"sample"
            raw = bytearray(128);raw[:2]=b"MZ";raw[60:64]=(64).to_bytes(4,"little");raw[64:68]=b"PE\0\0";raw[68:70]=(0x8664).to_bytes(2,"little")
            with file.open("wb") as stream:
                stream.write(raw);stream.flush();os.fsync(stream.fileno())
            os.utime(file, ns=(1600000000000000000,1600000000000000000))
            row={"path":str(file),"size":128,"nlink":1,"sha256":hashlib.sha256(raw).hexdigest(),"machine":0xaa64}
            with self.assertRaisesRegex(ValueError,"TOOLS_PE_MACHINE"):
                with observe.held_file(row):pass

    def test_bounded_reader_and_minimal_environment(self):
        class Child:
            def __init__(self, raw):
                self.stdout=io.BytesIO(raw);self.killed=False
            def poll(self):return 0
            def wait(self,timeout):return 0
            def kill(self):self.killed=True
        calls=[]
        def launch(argv,**options):
            calls.append((argv,options));return Child(b"version 1.2.3")
        code, raw=observe.collect_version(["fixed"],Path.cwd(),launch)
        self.assertEqual((code,raw),(0,b"version 1.2.3"))
        self.assertEqual(calls[0][1]["env"],observe.minimal_environment(Path.cwd()))
        with self.assertRaisesRegex(ValueError,"TOOLS_VERSION_BOUND"):
            observe.collect_version(["fixed"],Path.cwd(),lambda *_a,**_k:Child(b"x"*65537))

    def test_reader_failure_never_success(self):
        class Broken:
            def read(self,_):raise OSError("private fake path")
            def close(self):pass
        fake=types.SimpleNamespace(stdout=Broken(),poll=lambda:0,wait=lambda timeout:0,kill=lambda:None)
        with self.assertRaisesRegex(ValueError,"TOOLS_VERSION_BOUND"):
            observe.collect_version(["fixed"],Path.cwd(),lambda *_a,**_k:fake)

    def test_timeout_kills_and_joins_owned_fake_before_denial(self):
        class Child:
            def __init__(self):self.stdout=io.BytesIO(b'');self.killed=False;self.waited=False
            def poll(self):return 0 if self.killed else None
            def kill(self):self.killed=True
            def wait(self,timeout):self.waited=True;return 125
        child=Child();clock=iter([0,16,16])
        with patch.object(observe.time,'monotonic',side_effect=lambda:next(clock,16)):
            with self.assertRaisesRegex(ValueError,'TOOLS_VERSION_BOUND'):
                observe.collect_version(['fixed'],Path.cwd(),lambda *_a,**_k:child)
        self.assertTrue(child.killed and child.waited and child.stdout.closed)

    def test_closed_failure_and_signature_denial_do_not_emit_provider_text(self):
        for error in [ValueError('secret path'),ValueError(['secret']),OSError('private token')]:
            self.assertEqual(observe.failure_code(error),'TOOLS_OBSERVATION_INCOMPLETE')
        self.assertEqual(observe.failure_code(ValueError('TOOLS_FILE_CHANGED')),'TOOLS_FILE_CHANGED')
        with tempfile.TemporaryDirectory(prefix='arm-signature-pure-') as name:
            root=Path(name).resolve()
            @observe.contextlib.contextmanager
            def held(_row):yield io.BytesIO(b'fixture')
            with patch.object(observe,'verified_sources',return_value={}),patch.object(observe,'held_file',held),patch.object(observe,'cache_only_trust',return_value={'verified':False,'status':1,'closeStatus':0}),patch.object(observe,'collect_version',side_effect=AssertionError('must not execute')):
                observe.role_worker('cl',root,PROFILE)
            result=json.loads((root/'result-cl.json').read_text())
            self.assertFalse(result['versionAttempted'])
            self.assertIsNone(result['versionExit'])

    def test_non_native_observation_cannot_reach_signature_or_execute(self):
        profile=json.loads(json.dumps(PROFILE))
        next(row for row in profile['files']if row['role']==profile['programs']['cl'])['machine']=0xa641
        with patch.object(observe,'verified_sources',return_value={}),patch.object(observe,'cache_only_trust',side_effect=AssertionError('must not load')):
            with self.assertRaisesRegex(ValueError,'TOOLS_EXEC_NATIVE'):
                observe.role_worker('cl',Path.cwd(),profile)

    def test_source_scope_and_provenance_fences(self):
        self.assertEqual(len(observe.SOURCE_PATHS),7)
        self.assertEqual(len(set(observe.SOURCE_PATHS)),7)
        text=(HERE/'observe.py').read_text()
        self.assertIn('producerProvenanceIntegrationRequired',text)
        self.assertIn('"loadedModulesVerified": False',text)
        self.assertNotIn('rglob(',text)
        self.assertNotIn('os.walk(',text)
        self.assertNotIn('shell=True',text)
        baseline=observe.context_digest(b'original source context',None)
        self.assertEqual(observe.context_digest(b'original source context',baseline),baseline)
        with self.assertRaisesRegex(ValueError,'TOOLS_CONTEXT_CHANGED'):
            observe.context_digest(b'rewritten source context',baseline)

    def test_kernel_ast_preserves_actual_backend(self):
        old=ast.parse((HERE.parent/'windows-job-benign/windows-checkpoint-job.py').read_text())
        new=ast.parse((HERE/'job.py').read_text())
        named=lambda tree:{n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
        before,after=named(old),named(new)
        for name in ['BasicLimits','IoCounters','ExtendedLimits','CpuRate','Accounting','Startup','StartupEx','ProcessInfo','declare','checked','active','observed_process_handles','remaining_ms','wait_until','readback_policy','ParentCancel','write_parent_receipt']:
            self.assertEqual(ast.dump(before[name]),ast.dump(after[name]),name)
        a,b=before['run_job'],after['run_job']
        self.assertIsInstance(a.body[2],ast.Expr)
        self.assertIsInstance(b.body[2],ast.Assign)
        a.body[2]=b.body[2]
        a.body[3]=b.body[3]
        for index,node in enumerate(a.body):
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='atomic_suite' for t in node.targets):
                self.assertEqual(ast.dump(node.value),ast.dump(ast.parse('argv[5] == "suite"',mode='eval').body))
                self.assertEqual(ast.dump(b.body[index].value),ast.dump(ast.Constant(value=True)))
                a.body[index]=b.body[index]
        self.assertEqual(ast.dump(a),ast.dump(b))
        old_declarations=[n for n in old.body if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='declare']
        new_declarations=[n for n in new.body if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='declare']
        self.assertEqual(ast.dump(ast.Module(body=old_declarations,type_ignores=[])),ast.dump(ast.Module(body=new_declarations,type_ignores=[])))
        self.assertIn('atomic_suite = True', (HERE/'job.py').read_text())


if __name__ == '__main__':
    unittest.main()
