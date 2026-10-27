import assert from "node:assert/strict";
// SOURCE I/O diagnostics are optional, never authority for a path or caller.
test("source IO normal directory EOF performs no diagnostic work and unexpected StopIteration remains visible", () => {
  const result = python(
    String.raw`
import pathlib,types,sys,tempfile
from unittest.mock import patch
file=pathlib.Path(sys.argv[1]);m=types.ModuleType('eof_proof');m.__file__=str(file)
exec(compile(file.read_bytes(),str(file),'exec'),m.__dict__)
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder);(root/'src').mkdir();(root/'src/input.cc').write_bytes(b'owned')
 with m.source_io_scope('source-record'):
  m.SOURCE_IO_CONTEXT.set(('source-record',root))
  with patch.object(m,'source_io_record',wraps=m.source_io_record) as record:
   with m.source_directory(root,pathlib.Path('src'),None,m.Budget(2)) as entries:
    assert [entry.name for entry in entries]==['input.cc']
   record.assert_not_called()
  expected=OSError(5,'PRIVATE');closed=[]
  class Entries:
   def __next__(self):raise expected
   def close(self):closed.append(True)
  with patch.object(m.os,'scandir',return_value=Entries()):
   try:
    with m.source_directory(root,pathlib.Path('src'),None,m.Budget(2)) as entries:list(entries)
   except OSError as error:assert error is expected
   else:raise AssertionError('iteration error swallowed')
  assert closed==[True] and m.source_io_failure_fields(expected,'source-record')['sourceIoFailure']['stage']=='directory-next'
  unexpected=StopIteration('PRIVATE')
  def fail():raise unexpected
  try:m.source_io_call('file-read',root/'src/input.cc',fail)
  except StopIteration as error:assert error is unexpected
  else:raise AssertionError('unexpected non-EOF StopIteration swallowed')
  assert m.source_io_failure_fields(unexpected,'source-record')['sourceIoFailure']['stage']=='file-read'
 assert m.SOURCE_IO_CONTEXT.get() is None
print('actual directory EOF zero diagnostic calls; identical iteration OSError and non-EOF StopIteration preserved PASS')
`,
    [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("source IO actual Python exceptions keep scoped reader context, primary and privacy", () => {
  const result = python(
    String.raw`
import pathlib,types,sys,json,tempfile,os,concurrent.futures,threading
from unittest.mock import patch
file=pathlib.Path(sys.argv[1]);m=types.ModuleType('io_proof');m.__file__=str(file)
exec(compile(file.read_bytes(),str(file),'exec'),m.__dict__)
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder);(root/'src').mkdir();(root/'src/a').write_bytes(b'a');(root/'src/b').write_bytes(b'b')
 with m.source_io_scope('source-record'):
  m.SOURCE_IO_CONTEXT.set(('source-record',root))
  cause=RuntimeError('SECRET_CAUSE');first=PermissionError(13,'SECRET_MESSAGE','SECRET_FILENAME');first.__cause__=cause
  def fail():raise first
  try:m.source_io_call('file-read',root/'src/a',fail)
  except Exception as error:assert error is first and error.__cause__ is cause
  facts=m.source_io_failure_fields(first,'source-record')['sourceIoFailure']
  assert facts['kind']=='Permission' and facts['errno']==13 and facts['candidate']['name']=='src/a'
  def close():raise OSError(5,'SECRET_CLOSE')
  m.source_close(lambda:m.source_io_call('file-close',root/'src/a',close),first)
  assert m.SOURCE_CLOSE_FAILURE and m.source_io_failure_fields(first,'source-record')['sourceIoFailure']==facts
  barrier=threading.Barrier(2)
  def worker(name):
   def read():barrier.wait(timeout=2);raise FileNotFoundError(2,'SECRET',str(root/name))
   try:m.source_io_call('file-read',root/name,read)
   except Exception as error:return error
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   futures=[pool.submit(m.copy_context().run,worker,name) for name in ('src/a','src/b')]
   errors=[f.result(timeout=3) for f in futures]
  assert [m.source_io_failure_fields(e,'source-record')['sourceIoFailure']['candidate']['name'] for e in errors]==['src/a','src/b']
  try:m.source_link_target(root,root/'src/link','missing/../a',m.Budget(2))
  except FileNotFoundError as error:
   detail=m.source_io_failure_fields(error,'source-record')['sourceIoFailure']
   assert detail['stage']=='link-target-stat' and detail['candidate']['name']=='src/missing'
  else:raise AssertionError('missing traversal accepted')
  for stage,call in [('directory-open',lambda:list(m.source_directory(root,pathlib.Path('absent'),None,m.Budget(2)).__enter__()))]:
   try:call()
   except FileNotFoundError as error:assert m.source_io_failure_fields(error,'source-record')['sourceIoFailure']['stage']==stage
  for code in (True,-1,4096,'13'):
   error=OSError();error.errno=code;m.source_io_record(error,'file-read',root/'src/a')
   assert m.source_io_failure_fields(error,'source-record')['sourceIoFailure']['errno'] is None
  error=RuntimeError('SECRET');m.source_io_record(error,'file-read',root.parent/'SECRET_PRIVATE')
  assert 'candidate' not in m.source_io_failure_fields(error,'source-record')['sourceIoFailure']
  error=RuntimeError('SECRET');m.source_io_record(error,'file-read',root/'src/unicode-\u2603')
  assert 'name' not in m.source_io_failure_fields(error,'source-record')['sourceIoFailure']['candidate']
  with patch.object(m.hashlib,'sha256',side_effect=RuntimeError('SECRET_FORMAT')):
   error=RuntimeError('SECRET');m.source_io_record(error,'file-read',root/'src/a')
  assert m.source_io_failure_fields(error,'source-record')=={'sourceIoFailureInvalid':True}
  error=ValueError('SECRET_PARSE')
  assert m.source_io_failure_fields(error,'source-record')['sourceIoFailure']=={'mode':'source-record','stage':'unlocated','kind':'Value','errno':None}
  try:m.metadata(root/'src',m.SOURCE_METADATA_NAME,{'invalid':object()},source=True)
  except TypeError as error:
   assert m.source_io_failure_fields(error,'source-record')['sourceIoFailure']['stage']=='sidecar-encode'
  else:raise AssertionError('serialization failed to deny')
 assert m.SOURCE_IO_CONTEXT.get() is None
 error=OSError(2,'SECRET');m.source_io_record(error,'file-read',root/'src/a')
 assert not hasattr(error,'sourceIoFailure')
 assert m.source_io_failure_fields(first,'pack')=={} and m.source_io_failure_fields(first,'source-verify')=={'sourceIoFailureInvalid':True}
 assert 'SECRET' not in json.dumps(facts)
print('actual Python scoped exceptions, concurrent readers, link target, first close and privacy PASS')
`,
    [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("source IO actual hash/snapshot and directory cleanup preserve the first exception", () => {
  const result = python(
    String.raw`
import pathlib,types,sys,tempfile,os,threading,concurrent.futures
from unittest.mock import patch
from contextlib import nullcontext
file=pathlib.Path(sys.argv[1]);m=types.ModuleType('actual_io');m.__file__=str(file)
exec(compile(file.read_bytes(),str(file),'exec'),m.__dict__)
with tempfile.TemporaryDirectory() as folder:
 root=pathlib.Path(folder).resolve();(root/'src').mkdir();p=root/'src/a';p.write_bytes(b'owned')
 info=p.stat();row={'path':'src/a','kind':'file','stamp':m.stamp(info),'ctimeNs':info.st_ctime_ns}
 with m.source_io_scope('source-record'):
  m.SOURCE_IO_CONTEXT.set(('source-record',root))
  first=OSError(5,'SECRET_FIRST');cause=ValueError('SECRET_CAUSE');first.__cause__=cause
  actual_open=pathlib.Path.open;closed=[]
  class Stream:
   def __init__(self,real):self.real=real
   def fileno(self):return self.real.fileno()
   def read(self,n):raise first
   def close(self):self.real.close();closed.append(True);raise RuntimeError('SECRET_CLOSE')
  # This is a first-error control-flow fixture, not Windows source admission.
  # Windows path/FD ctime availability differs: supply an identity-satisfied
  # witness there so the intended read fault is reached deterministically.
  fd_identity=patch.object(m.os,'fstat',return_value=info) if os.name=='nt' else nullcontext()
  with patch.object(pathlib.Path,'open',lambda path,*a,**kw:Stream(actual_open(path,*a,**kw))),fd_identity:
   try:m.source_hash(root,row,m.Budget(2))
   except OSError as error:assert error is first and error.__cause__ is cause
   else:raise AssertionError('read fault ignored')
  assert closed==[True] and m.SOURCE_CLOSE_FAILURE
  assert m.source_io_failure_fields(first,'source-record')['sourceIoFailure']['stage']=='file-read'
  directory_error=PermissionError(13,'SECRET_DIRECTORY');ended=[]
  class Entries:
   def __iter__(self):return self
   def __next__(self):raise directory_error
   def close(self):ended.append(True);raise OSError(5,'SECRET_CLOSE')
  with patch.object(m.os,'scandir',return_value=Entries()):
   try:
    with m.source_directory(root,pathlib.Path('src'),None,m.Budget(2)) as entries:list(entries)
   except PermissionError as error:assert error is directory_error
   else:raise AssertionError('directory fault ignored')
  assert ended==[True] and m.source_io_failure_fields(directory_error,'source-record')['sourceIoFailure']['stage']=='directory-next'
  # Exercise the ACTUAL source_snapshot executor submission and shutdown paths.
  # Only unrelated namespace requirements are fixed fixture values; no vendor IO.
  barrier=threading.Barrier(2);seen=[];original_shutdown=concurrent.futures.ThreadPoolExecutor.shutdown
  failures={name:OSError(5,'SECRET_READER') for name in ('src/a','src/b')}
  rows=[{**row,'path':name} for name in failures]
  def failing_hash(root,row,budget,*unused):
   def read():barrier.wait(timeout=2);raise failures[row['path']]
   return m.source_io_call('file-read',root/row['path'],read)
  def shutdown(pool,*a,**kw):
   original_shutdown(pool,*a,**kw);seen.append(True);raise RuntimeError('SECRET_JOIN')
  # On Windows this pure control-flow fixture substitutes only POSIX uid access.
  with patch.object(m.os,'geteuid',return_value=info.st_uid,create=True),patch.object(m,'source_repositories',return_value={}),patch.object(m,'inventory',return_value=(rows,10)),patch.object(m,'source_hash',side_effect=failing_hash),patch.object(concurrent.futures.ThreadPoolExecutor,'shutdown',shutdown):
   try:m.source_snapshot(root,m.Budget(3))
   except OSError as error:assert any(error is value for value in failures.values())
   else:raise AssertionError('reader error ignored')
  assert seen==[True] and m.SOURCE_JOIN_FAILURE
  assert [m.source_io_failure_fields(error,'source-record')['sourceIoFailure']['candidate']['name'] for error in failures.values()]==['src/a','src/b']
 assert m.SOURCE_IO_CONTEXT.get() is None
 # A later ordinary/external-style call cannot inherit the prior source context.
 error=OSError(5,'SECRET_LATER');m.source_io_record(error,'file-read',p);assert not hasattr(error,'sourceIoFailure')
print('actual hash/read-close, directory-next-close, snapshot concurrent first-error/join PASS')
`,
    [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("source IO optional schema is closed and actual caller/primary scoped", () => {
  const facts = {
    mode: "source-record",
    stage: "file-read",
    kind: "Permission",
    errno: 13,
    candidate: {
      name: "src/a",
      bytes: 5,
      sha256: hashObject("sha256").update("src/a").digest("hex"),
    },
  };
  const base = {
    complete: false,
    error: "archive-io-error",
    sourceCloseFailure: true,
    sourceJoinFailure: true,
  };
  const primary = {
    error: base.error,
    sourceCloseFailure: true,
    sourceJoinFailure: true,
    exitCode: 1,
  };
  const record = (value, sourceMode = "source-record", error = base.error) =>
    archiveFailureRecord(
      JSON.stringify({ ...base, error, sourceIoFailure: value }),
      1,
      { sourceMode },
    );
  assert.deepEqual(record(facts), { ...primary, sourceIoFailure: facts });
  for (const value of [
    null,
    [],
    {},
    { ...facts, extra: true },
    { ...facts, stage: "SECRET" },
    { ...facts, kind: "SECRET" },
    { ...facts, errno: true },
    { ...facts, errno: 4096 },
    { ...facts, mode: "source-verify" },
    { ...facts, candidate: { ...facts.candidate, bytes: 0 } },
    { ...facts, candidate: { ...facts.candidate, name: "src/../SECRET" } },
    { ...facts, candidate: { ...facts.candidate, sha256: "0".repeat(64) } },
  ]) {
    assert.deepEqual(record(value), {
      ...primary,
      sourceIoFailureInvalid: true,
    });
  }
  for (const sourceMode of [
    null,
    "pack",
    "restore",
    "seal",
    "mac-external-observe",
    "unknown",
  ])
    assert.deepEqual(record(facts, sourceMode), {
      error: "unknown",
      exitCode: 1,
    });
  assert.deepEqual(record(facts, "source-record", "member-path"), {
    error: "unknown",
    exitCode: 1,
  });
});

test(
  "source IO actual Linux CLI retains precise missing-target stage without private paths",
  {
    skip:
      process.platform !== "linux"
        ? "Actual owned POSIX symlink CLI fixture"
        : false,
  },
  () => {
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const code =
      setup +
      String.raw`
import subprocess
with fixture(record=False) as (root,sidecar,identity):
 os.symlink('missing/../input.cc',root/'src/broken-link')
 context=root.parent/'identity.json';context.write_text(json.dumps(identity))
 result=subprocess.run([sys.executable,'-I','-B',sys.argv[1],'source-record','--input',str(root),'--output',str(sidecar),'--manifest',str(context),'--seconds','5'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env={'PATH':str(pathlib.Path(sys.executable).parent)})
 assert result.returncode==1 and not sidecar.exists() and not result.stderr
 value=json.loads(result.stdout);assert value['complete']is False and value['error']=='archive-io-error'
 facts=value['sourceIoFailure'];assert facts['mode']=='source-record' and facts['stage']=='link-target-stat' and facts['kind']=='FileNotFound' and facts['errno']==2
 assert facts['candidate']['name']=='src/missing' and str(root).encode() not in result.stdout
 assert m.SOURCE_IO_CONTEXT.get() is None
 print('actual Linux CLI source-record missing-target exception exact bounded transport PASS')
`;
    const result = python(code, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);

test(
  "source IO actual archiveCommand refuses ordinary masquerades and retains first cleanup flags",
  { timeout: 15000 },
  async (t) => {
    const folder = await scratch(t),
      executable = python("import sys;print(sys.executable)").stdout.trim();
    const script = path.join(folder, "source-io-fixture.py");
    await writeFile(
      script,
      "import json,sys\nprint(json.dumps({'complete':False,'error':'archive-io-error','sourceCloseFailure':True,'sourceJoinFailure':True,'sourceIoFailure':{'mode':'source-record','stage':'file-read','kind':'OS','errno':5}}))\nsys.exit(1)\n",
      { flag: "wx" },
    );
    for (const mode of [
      "source-record",
      "source-verify",
      "pack",
      "restore",
      "mac-external-observe",
    ]) {
      const records = [];
      await assert.rejects(
        archiveCommand(executable, script, [mode], {
          timeout: 2000,
          observeFailure: (r) => records.push(r),
        }),
        /Checkpoint archive rejected/,
      );
      assert.equal(records.length, 1);
      assert.equal(
        records[0].error,
        mode.startsWith("source-") ? "archive-io-error" : "unknown",
      );
      if (mode === "source-record")
        assert.equal(records[0].sourceIoFailure.stage, "file-read");
      if (mode === "source-verify")
        assert.equal(records[0].sourceIoFailureInvalid, true);
    }
  },
);
import { createHash as hashObject } from "node:crypto";
import test from "node:test";
import { EventEmitter } from "node:events";
// Exact pre-fix archiveCommand declaration from reviewed6c853; data-only baseline.
const ARCHIVE_COMMAND_BEFORE =
  'export async function archiveCommand(\n  python,\n  helper,\n  args,\n  { timeout = LIMITS.archiveMs, observeFailure } = {},\n) {\n  assert(\n    path.isAbsolute(python) &&\n      path.isAbsolute(helper) &&\n      positive(timeout) &&\n      timeout <= LIMITS.archiveMs,\n    "Verified archive tool required",\n  );\n  return new Promise((resolve, reject) => {\n    const child = spawn(python, ["-I", "-B", helper, ...args], {\n      shell: false,\n      windowsHide: true,\n      detached: process.platform !== "win32",\n      env: { PATH: path.dirname(python) },\n      stdio: ["ignore", "pipe", "pipe"],\n    });\n    let stdout = "",\n      overflow = false,\n      diagnosticEmitted = false;\n    const diagnostic = (code, options = {}) => {\n      if (diagnosticEmitted || !observeFailure) return;\n      diagnosticEmitted = true;\n      try {\n        observeFailure(archiveFailureRecord(stdout, code, options));\n      } catch {\n        /* Diagnostics cannot hide an existing failure or escape an event callback. */\n      }\n    };\n    child.stdout.on("data", (data) => {\n      stdout += data;\n      if (stdout.length > LIMITS.seal) {\n        overflow = true;\n        diagnostic(null, { overflow: true });\n        void stopGroup(child);\n      }\n    });\n    child.stderr.resume();\n    const timer = setTimeout(() => {\n      diagnostic(null, { deadline: true });\n      void stopGroup(child).then(\n        () => reject(new Error("Archive deadline; partial is not admitted")),\n        reject,\n      );\n    }, timeout);\n    child.once("error", (error) => {\n      clearTimeout(timer);\n      diagnostic(null);\n      reject(error);\n    });\n    child.once("close", (code) => {\n      clearTimeout(timer);\n      if (code !== 0 || overflow) {\n        diagnostic(code, { overflow });\n        return reject(new Error("Checkpoint archive rejected"));\n      }\n      try {\n        resolve(JSON.parse(stdout));\n      } catch {\n        diagnostic(code);\n        reject(new Error("Malformed archive result"));\n      }\n    });\n  });\n}';
const ARCHIVE_COMMAND_BEFORE_SHA256 =
  "95779212317428382040cf705a8e5535b277396935c0057ec9c7d8589de51cc7";
import { gunzipSync } from "node:zlib";
import { finished } from "node:stream/promises";
import YAML from "yaml";
import ts from "typescript";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import {
  writeFileSync,
  fstatSync,
  renameSync,
  createWriteStream,
} from "node:fs";
import { PassThrough, Readable, Writable, Transform } from "node:stream";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  readlink,
  unlink,
  realpath,
  lstat,
  rename,
  open,
  cp,
} from "node:fs/promises";
import path from "node:path";
import { hostname, tmpdir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  executionOptions,
  hostRemaining,
  sliceBudget,
  SDK_NAMES,
  SDK_ARCHIVE,
  createSdkCompletion,
  validateSdkCompletion,
  validateSdkSeal,
  completionSha,
  sdkSealName,
  downloadSdkBundle,
  TARGET,
  SOURCE_ID,
  WORKFLOW,
  authority,
  sdkProbeAuthority,
  SDK_PROBE_WORKFLOW,
  codeTreeDigest,
  canonical,
  checkpointLog,
  sha,
  validateIdentity,
  validateManifest,
  validateSeal,
  apiClient,
  createUploadObserver,
  uploadPhase,
  uploadCheckpoint,
  downloadAsset,
  downloadHost,
  groupQuiet,
  processRows,
  compileMonitorRecord,
  compileMonitorDetails,
  observedLineage,
  sameObservedCohort,
  compileSlice,
  archiveCommand,
  archiveFailureRecord,
  graphDigest,
  graphInventory,
  noLinks,
  GRAPH_LIMITS,
  assertGraphBudget,
  graphInventoryRecord,
  graphPinSnapshot,
  createRestoreObserver,
  restorePhase,
  restoreIdentityComparison,
  generatedLinkInventory,
  persistGeneratedLinkInventory,
  LINK_DIAGNOSTIC_LIMITS,
  filePin,
  afterGnPhase,
  normalizeSdkLinks,
  FRAMEWORK_LINKS,
  checkpointLinkRecipe,
  attestFrameworkLinks,
  removeQuiescentSisoLog,
  sisoLoggerIdentity,
  observeThenRemoveSisoLog,
  selectedSdkPreflight,
  selectedSdkEnvironment,
  sdkLayoutRecord,
  withVerifiedGraph,
  restoreVerifiedGraph,
  sourceMetadataPlan,
  sourceMetadataResult,
  SOURCE_METADATA_DATE_EPOCH,
  SOURCE_METADATA_MAX_BYTES,
  restoreDownload,
  workspace,
  checkpointProfile,
  checkpointHost,
  checkpointCompileArguments,
  sdkNames,
  linuxArmRecipe,
  linuxArmGcsDeclaration,
  linuxArmGcsArchive,
  assertNoGeneratedLinks,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  plan,
  releaseIdentity,
  assertHostedBuildIdentity,
  assertHostedCapacity,
  buildEnvironment,
} from "../../scripts/cef-runtime-ci.mjs";
import {
  argumentsFor,
  main,
} from "../../scripts/cef-engineering-checkpoint.mjs";
import {
  identitySha256,
  validateSourceLock,
} from "../../scripts/lib/browser-custom-runtime.mjs";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const producer = {
  repository: "owner/repo",
  repositoryId: 11,
  runId: 22,
  attempt: 1,
  head: "a".repeat(40),
  branch: "Main",
  workflow: WORKFLOW,
};
const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  CEF_DEFAULT_BRANCH: "Main",
  GITHUB_REF: "refs/heads/Main",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_REPOSITORY_ID: "11",
  GITHUB_RUN_ID: "22",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: producer.head,
  GITHUB_WORKFLOW_REF: `owner/repo/${WORKFLOW}@refs/heads/Main`,
};
const identity = {
  target: TARGET,
  source: SOURCE_ID,
  producer: "b".repeat(64),
  canonicalRoot: "/Users/runner/work/_temp/sorng-cef-engineering/pinned",
  image: "20260824.0482.1",
  tools: "c".repeat(64),
  graph: "d".repeat(64),
  siso: "e".repeat(64),
};
const asset = (name, bytes = 10) => ({ name, bytes, sha256: "f".repeat(64) });
function manifest() {
  return {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-checkpoint",
    identity: { ...identity },
    identitySha256: validateIdentity(identity),
    producer: { ...producer },
    archive: {
      complete: true,
      chunks: [asset("checkpoint-00000.bin")],
      inventory: asset("inventory.json"),
      rawBytes: 100,
      compressedBytes: 10,
      entries: 2,
      linksIncluded: false,
    },
    compile: {
      outcome: "slice-ended",
      exitCode: null,
      quiescent: true,
      groupId: 123456,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: 123456, start: "Sat Oct 24 00:00:00 2026" }],
    },
    nativeAcceptance: false,
    runtimeReady: false,
  };
}
async function scratch(t) {
  await mkdir(path.join(ROOT, ".cache"), { recursive: true });
  const root = await mkdtemp(path.join(ROOT, ".cache", "checkpoint-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(ROOT, ".cache"));
    assert.match(path.basename(root), /^checkpoint-test-/);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
function python(code, args = []) {
  return spawnSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", code, ...args],
    {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
}

test("typed framework recipe is static and admits only the three SDK roles", () => {
  const sdk = {
    "sdk/xcode_links/MacOSX26.2.sdk": "/owned/MacOSX26.2.sdk",
    "sdk/xcode_links/MacOSX.platform": "/owned/MacOSX.platform",
    "sdk/xcode_links/XcodeDefault.xctoolchain":
      "/owned/XcodeDefault.xctoolchain",
  };
  const recipe = checkpointLinkRecipe(sdk);
  assert.equal(Object.keys(recipe).length, 7);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(recipe).filter(([name]) => name in FRAMEWORK_LINKS),
    ),
    FRAMEWORK_LINKS,
  );
  assert.throws(() => checkpointLinkRecipe({ ...sdk, unexpected: "/foreign" }));
  assert.throws(() =>
    checkpointLinkRecipe({
      ...sdk,
      "sdk/xcode_links/MacOSX.platform": "relative",
    }),
  );
});

async function frameworkFixture(t, state = "pending") {
  const f = await sdkLinkFixture(t),
    base = path.join(f.out, "Chromium Embedded Framework.framework");
  if (state === "absent") return { ...f, base };
  await mkdir(path.join(base, "Versions", "A"), { recursive: true });
  if (state === "present") {
    for (const name of ["Resources", "Libraries"])
      await mkdir(path.join(base, "Versions", "A", name));
    await writeFile(
      path.join(base, "Versions", "A", "Resources", "owned-resource"),
      "retained-resource",
    );
    await writeFile(
      path.join(base, "Versions", "A", "Chromium Embedded Framework"),
      "retained-binary",
    );
  }
  for (const [member, spec] of Object.entries(FRAMEWORK_LINKS))
    await symlink(
      spec.role === "version"
        ? "A"
        : `Versions/Current/${path.basename(member)}`,
      path.join(f.out, member),
      spec.kind === "directory" ? "dir" : "file",
    );
  return { ...f, base };
}
for (const state of ["absent", "pending", "present"])
  test(
    `framework ${state} normalizes to a stable source-derived recipe`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await frameworkFixture(t, state),
        sdk = await normalizeSdkLinks(f.out, f.options),
        before = checkpointLinkRecipe(sdk);
      const observed = await attestFrameworkLinks(f.out);
      assert.equal(
        observed.framework,
        state === "absent" ? "absent" : "factory",
      );
      assert.deepEqual(checkpointLinkRecipe(sdk), before);
      if (state !== "absent") {
        assert.equal(observed.targets.version, "present");
        assert.equal(observed.targets.binary, state);
        for (const [member, spec] of Object.entries(FRAMEWORK_LINKS))
          assert.equal(await readlink(path.join(f.out, member)), spec.raw);
        assert.deepEqual(await attestFrameworkLinks(f.out), observed);
      }
    },
  );
for (const fault of [
  "foreign-alias",
  "unreleased-canonical-alias",
  "missing-version",
  "wrong-kind",
  "missing-alias",
  "linked-target",
  "partial-root",
])
  test(
    `framework denies ${fault} before changing any alias`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await frameworkFixture(t),
        resources = path.join(f.base, "Resources"),
        binary = path.join(
          f.base,
          "Versions",
          "A",
          "Chromium Embedded Framework",
        );
      if (fault === "foreign-alias") {
        await unlink(resources);
        await symlink("/foreign", resources);
      }
      if (fault === "unreleased-canonical-alias") {
        await unlink(resources);
        await symlink("Versions/A/Resources", resources);
      }
      if (fault === "missing-version")
        await rm(path.join(f.base, "Versions", "A"), { recursive: true });
      if (fault === "wrong-kind") await mkdir(binary);
      if (fault === "linked-target") await symlink(f.root, binary);
      if (fault === "missing-alias") await unlink(resources);
      if (fault === "partial-root")
        for (const member of Object.keys(FRAMEWORK_LINKS))
          await unlink(path.join(f.out, member));
      const original = await readlink(path.join(f.base, "Libraries")).catch(
        () => null,
      );
      await assert.rejects(attestFrameworkLinks(f.out));
      assert.equal(
        await readlink(path.join(f.base, "Libraries")).catch(() => null),
        original,
      );
    },
  );

// Kept as a constant so the exact same owned-fixture proof can run with an
// existing POSIX Python when this host's Node cannot create POSIX symlinks.
const FRAMEWORK_TRANSPORT_PROOF = String.raw`
import importlib.util,pathlib,os,sys,json,subprocess
p=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('checkpoint',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sdk={}
for name in ['MacOSX26.2.sdk','MacOSX.platform','XcodeDefault.xctoolchain']:
 t=p/name;t.mkdir();sdk['sdk/xcode_links/'+name]=str(t)
recipe={**sdk,**m.FRAMEWORK_ROLES}
assert len(m.link_recipe(recipe))==7
for state in ['absent','pending','present']:
 s=p/state;s.mkdir();(s/'sdk'/'xcode_links').mkdir(parents=True)
 for name,target in sdk.items():os.symlink(target,s/name)
 if state!='absent':
  (s/m.FRAMEWORK/'Versions'/'A').mkdir(parents=True)
  if state=='present':
   (s/m.FRAMEWORK/'Versions'/'A'/'Resources').mkdir()
   (s/m.FRAMEWORK/'Versions'/'A'/'Resources'/'owned').write_bytes(b'resource')
   (s/m.FRAMEWORK/'Versions'/'A'/'Libraries').mkdir()
   (s/m.FRAMEWORK/'Versions'/'A'/'Chromium Embedded Framework').write_bytes(b'binary')
  if len(sys.argv)>3:
   done=subprocess.run([sys.executable,'-I','-B',sys.argv[3],'--framework',str(s/m.FRAMEWORK),'--stamp',str(s/'factory.stamp'),'--version','A','--contents','Chromium Embedded Framework','Libraries','Resources'],capture_output=True,timeout=10)
   assert done.returncode==0,done.stderr
  else:
   for name,row in m.FRAMEWORK_ROLES.items():os.symlink(row['raw'],s/name)
 archive=m.pack(s,p/(state+'-bundle'),generated_links=recipe)
 index=json.loads((p/(state+'-bundle')/'inventory.json').read_bytes())
 assert index['generatedState']['framework']==('absent' if state=='absent' else 'factory')
 if state!='absent':assert index['generatedState']['targets']['binary']==state
 # No original out tree may satisfy restored target validation.
 moved=p/(state+'-original');s.rename(moved)
 r=p/(state+'-restored');m.restore(p/(state+'-bundle'),r,archive,generated_links=recipe)
 if state=='present':assert (r/m.FRAMEWORK/'Chromium Embedded Framework').read_bytes()==b'binary'
 if state!='absent':
  for name,row in m.FRAMEWORK_ROLES.items():assert os.readlink(r/name)==row['raw']
  final=p/(state+'-final');r.rename(final)
  if state=='present':assert (final/m.FRAMEWORK/'Resources'/'owned').read_bytes()==b'resource'
 # Independently reject closed-role/kind/target changes, even through direct Python API.
 for field,value in [('kind','directory'),('target','foreign'),('role','unknown')]:
  bad={**recipe,m.FRAMEWORK+'/Chromium Embedded Framework':{**recipe[m.FRAMEWORK+'/Chromium Embedded Framework'],field:value}}
  try:m.link_recipe(bad);raise AssertionError('forged recipe')
  except m.CheckpointError:pass
 if state=='pending':
  # A preexisting old sibling binary must never fill a missing extracted binary.
  assert not (final/m.FRAMEWORK/'Versions'/'A'/'Chromium Embedded Framework').exists()
  os.symlink('/foreign',final/'unknown')
  try:m.pack(final,p/'unknown-bundle',generated_links=recipe);raise AssertionError('unknown link')
  except m.CheckpointError:pass
print(json.dumps({'states':3,'ownedFixture':True,'nativeAcceptance':False}))
`;
const FRAMEWORK_DENIAL_PROOF = String.raw`
import importlib.util,pathlib,os,sys,json
p=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('checkpoint',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sdk={}
for name in ['MacOSX26.2.sdk','MacOSX.platform','XcodeDefault.xctoolchain']:
 t=p/name;t.mkdir();sdk['sdk/xcode_links/'+name]=str(t)
recipe={**sdk,**m.FRAMEWORK_ROLES}
def fixture(name):
 s=p/name;s.mkdir();(s/'sdk'/'xcode_links').mkdir(parents=True);(s/m.FRAMEWORK/'Versions'/'A').mkdir(parents=True)
 for member,target in sdk.items():os.symlink(target,s/member)
 for member,row in m.FRAMEWORK_ROLES.items():os.symlink(row['raw'],s/member)
 (s/m.FRAMEWORK/'Versions'/'A'/'Chromium Embedded Framework').write_bytes(b'binary')
 return s
faults=['foreign-alias','unreleased-canonical-alias','wrong-binary-kind','missing-version','missing-alias','linked-target','hardlinked-file','unknown-directory-link','unknown-file-link']
for fault in faults:
 s=fixture(fault);binary=s/m.FRAMEWORK/'Versions'/'A'/'Chromium Embedded Framework';alias=s/m.FRAMEWORK/'Resources'
 if fault=='foreign-alias':alias.unlink();os.symlink('/foreign',alias)
 if fault=='unreleased-canonical-alias':alias.unlink();os.symlink('Versions/A/Resources',alias)
 if fault=='wrong-binary-kind':binary.unlink();binary.mkdir()
 if fault=='missing-version':binary.unlink();binary.parent.rmdir()
 if fault=='missing-alias':alias.unlink()
 if fault=='linked-target':binary.unlink();os.symlink(str(p),binary)
 if fault=='hardlinked-file':os.link(binary,s/'second-link')
 if fault=='unknown-directory-link':os.symlink(str(p),s/m.FRAMEWORK/'foreign')
 if fault=='unknown-file-link':os.symlink(str(binary),s/'foreign')
 try:m.pack(s,p/(fault+'-bundle'),generated_links=recipe);raise AssertionError(fault)
 except m.CheckpointError:pass
s=fixture('mutation');original=m.HashedReader
class MutatingReader(original):
 def read(self,count):
  data=super().read(count)
  alias=s/m.FRAMEWORK/'Resources'
  if data and os.readlink(alias)!='foreign':alias.unlink();os.symlink('foreign',alias)
  return data
m.HashedReader=MutatingReader
try:m.pack(s,p/'mutation-bundle',generated_links=recipe);raise AssertionError('mutation admitted')
except m.CheckpointError:pass
m.HashedReader=original
s=fixture('bad-state');a=m.pack(s,p/'bad-state-bundle',generated_links=recipe)
index_path=p/'bad-state-bundle'/'inventory.json';index=json.loads(index_path.read_bytes());index['generatedState']['targets']['binary']='pending'
data=(json.dumps(index,sort_keys=True,separators=(',',':'))+'\n').encode();index_path.write_bytes(data)
import hashlib
a['inventory']={'name':'inventory.json','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
try:m.restore(p/'bad-state-bundle',p/'state-restored',a,generated_links=recipe);raise AssertionError('forged state')
except m.CheckpointError:pass
print(json.dumps({'denied':11,'nativeAcceptance':False}))
`;
test(
  "typed framework archive denies unsafe links, wrong kinds, hardlinks and pack mutation",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await scratch(t),
      result = python(FRAMEWORK_DENIAL_PROOF, [
        root,
        path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).denied, 11);
  },
);
test(
  "typed framework archive restores absent, pending and full output without borrowing old out",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await scratch(t),
      result = python(FRAMEWORK_TRANSPORT_PROOF, [
        root,
        path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {
      states: 3,
      ownedFixture: true,
      nativeAcceptance: false,
    });
  },
);
test("Python independently rejects malformed framework roles and unknown SDK aliases", () => {
  const result = python(
    String.raw`import importlib.util,sys
s=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
for bad in [{'unknown':'/foreign'},{'sdk/xcode_links/unknown':'/foreign'},m.FRAMEWORK_ROLES]:
 try:m.link_recipe(bad);raise AssertionError('unreviewed recipe')
 except m.CheckpointError:pass
print('{}')`,
    [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test(
  "exact Siso log alias is removed only after actual owned compiler quiescence; target survives",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await scratch(t),
      compile = await compileSlice(
        process.execPath,
        [
          "-e",
          "require('node:fs').writeFileSync('siso-test-time',new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14));setTimeout(()=>{},200)",
        ],
        {
          cwd: root,
          env: { PATH: path.dirname(process.execPath) },
          logs: root,
          out: root,
          milliseconds: 2000,
        },
      );
    const stamp = await readFile(path.join(root, "siso-test-time"), "utf8");
    const time = `${stamp.slice(0, 8)}-${stamp.slice(8)}`;
    const target = path.join(
      tmpdir(),
      `${sisoLoggerIdentity(hostname(), userInfo().username).prefix}${time}.${compile.groupId}`,
    );
    await writeFile(target, "target-must-survive", { flag: "wx" });
    t.after(() => unlink(target));
    await symlink(target, path.join(root, "siso.INFO"));
    await assert.rejects(
      removeQuiescentSisoLog(root, compile, {
        beforeUnlink: async () => {
          throw new Error("evidence write denied");
        },
      }),
      /evidence write denied/,
    );
    assert.equal(await readlink(path.join(root, "siso.INFO")), target);
    let before = 0;
    const result = await removeQuiescentSisoLog(root, compile, {
      beforeUnlink: async (record) => {
        assert.equal(record.link.target, target);
        assert.equal(await readlink(path.join(root, "siso.INFO")), target);
        before++;
      },
    });
    assert.equal(before, 1);
    assert.equal(result.removed, true);
    assert.equal(await readFile(target, "utf8"), "target-must-survive");
    assert.equal((await removeQuiescentSisoLog(root, compile)).absent, true);
    for (const foreign of [
      path.join(root, path.basename(target)),
      path.join(
        tmpdir(),
        `siso.foreign.runner.log.INFO.${time}.${compile.groupId}`,
      ),
      path.join(
        tmpdir(),
        `${sisoLoggerIdentity(hostname(), userInfo().username).prefix}${time}.1`,
      ),
    ]) {
      await symlink(foreign, path.join(root, "siso.INFO"));
      await assert.rejects(removeQuiescentSisoLog(root, compile));
      assert.equal(await readlink(path.join(root, "siso.INFO")), foreign);
      await unlink(path.join(root, "siso.INFO"));
    }
    for (const rejected of [
      "20260230-010101",
      "20000101-000000",
      "20990101-000000",
    ]) {
      const foreign = path.join(
        tmpdir(),
        `${sisoLoggerIdentity(hostname(), userInfo().username).prefix}${rejected}.${compile.groupId}`,
      );
      await symlink(foreign, path.join(root, "siso.INFO"));
      await assert.rejects(
        removeQuiescentSisoLog(root, compile),
        /Invalid Siso UTC|outside actual compile window/,
      );
      assert.equal(await readlink(path.join(root, "siso.INFO")), foreign);
      await unlink(path.join(root, "siso.INFO"));
    }
    await symlink(target, path.join(root, "siso.INFO"));
    await assert.rejects(
      removeQuiescentSisoLog(root, JSON.parse(JSON.stringify(compile))),
      /Genuine in-process/,
    );
    const other = path.join(root, "different-out");
    await mkdir(other);
    await assert.rejects(
      removeQuiescentSisoLog(other, compile),
      /Compile output path differs/,
    );
    assert.equal(await readlink(path.join(root, "siso.INFO")), target);
  },
);

test(
  "Siso cleanup rejects a self-asserted quiescent receipt while its exact owned child remains alive",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await scratch(t),
      child = spawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"], {
        detached: true,
        stdio: "ignore",
      });
    const closed = new Promise((resolve) => child.once("close", resolve));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    });
    const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
    });
    assert.equal(ps.status, 0);
    const actual = processRows(ps.stdout).find((row) => row.pid === child.pid);
    assert.ok(actual);
    const target = path.join(
        tmpdir(),
        `${sisoLoggerIdentity(hostname(), userInfo().username).prefix}20261025-000000.${child.pid}`,
      ),
      file = path.join(root, "siso.INFO");
    await symlink(target, file);
    await assert.rejects(
      removeQuiescentSisoLog(root, {
        outcome: "slice-ended",
        exitCode: 0,
        quiescent: true,
        groupId: child.pid,
        quiescence: "observed-lineage-and-root-group",
        observed: [{ pid: actual.pid, start: actual.start }],
      }),
      /Genuine in-process/,
    );
    assert.equal(await readlink(file), target);
  },
);
test("decoded compiler receipts cannot authorize cleanup, even with no alias present", async (t) => {
  const root = await scratch(t);
  await assert.rejects(
    removeQuiescentSisoLog(root, {
      outcome: "slice-ended",
      exitCode: null,
      quiescent: true,
      groupId: 123,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: 123, start: "Sat Oct 24 00:00:00 2026" }],
    }),
    /Genuine in-process/,
  );
  assert.deepEqual(await readdir(root), []);
});
test("manual checkpoint authority is exact, public and default-only", () => {
  assert.deepEqual(authority(env), producer);
  for (const change of [
    { GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { GITHUB_WORKFLOW_REF: "owner/repo/other.yml@refs/heads/Main" },
    { GITHUB_RUN_ID: "22oops" },
  ])
    assert.throws(() => authority({ ...env, ...change }));
});
test("closed CLI exposes no arbitrary input/target/budget or publication", () => {
  assert.deepEqual(argumentsFor(["download", "--restore-run", "123"]), {
    mode: "download",
    "--restore-run": 123,
  });
  for (const argv of [
    ["publish"],
    ["compile", "--target", "all"],
    ["compile", "--restore-run", "1"],
    ["download", "--restore-run", "-1"],
    ["download", "--restore-run", "1", "--restore-run", "2"],
  ])
    assert.throws(() => argumentsFor(argv));
});
test("identity binds source, image, tool, graph, Siso and exact canonical path", () => {
  const digest = validateIdentity(identity);
  assert.equal(digest, sha(canonical(identity)));
  for (const key of [
    "image",
    "tools",
    "graph",
    "siso",
    "canonicalRoot",
    "producer",
  ]) {
    const changed = {
      ...identity,
      [key]:
        key === "image"
          ? "other-image"
          : key === "canonicalRoot"
            ? "/Users/runner/other"
            : "1".repeat(64),
    };
    assert.notEqual(validateIdentity(changed), digest);
  }
  assert.throws(() =>
    validateIdentity({ ...identity, source: "0".repeat(64) }),
  );
  assert.throws(() =>
    validateIdentity({ ...identity, target: "aarch64-apple-darwin" }),
  );
});
test("manifest never claims native readiness and rejects partial or unbounded bytes", () => {
  assert.equal(validateManifest(manifest()).runtimeReady, false);
  const edits = [
    (m) => (m.runtimeReady = true),
    (m) => (m.nativeAcceptance = true),
    (m) => (m.archive.complete = false),
    (m) => (m.archive.linksIncluded = true),
    (m) => (m.archive.chunks[0].bytes = LIMITS.chunk + 1),
    (m) => (m.archive.chunks[0].name = "../outside"),
    (m) => (m.compile.quiescent = false),
    (m) => (m.compile.outcome = "137 means timeout"),
    (m) => (m.identity.graph = "0".repeat(64)),
  ];
  for (const edit of edits) {
    const m = manifest();
    edit(m);
    assert.throws(() => validateManifest(m));
  }
});
test("independent seal binds immutable run metadata, exact draft and asset identities", () => {
  const m = manifest(),
    pin = asset("manifest.json"),
    seal = {
      schemaVersion: 1,
      kind: "sorng-cef-engineering-seal",
      producer,
      identitySha256: m.identitySha256,
      release: {
        id: 33,
        tag: `cef-checkpoint-${TARGET}-${m.identitySha256.slice(0, 16)}-22-1`,
      },
      manifest: pin,
      assets: [...m.archive.chunks, m.archive.inventory, pin].map((a, i) => ({
        id: i + 1,
        ...a,
      })),
    };
  assert.equal(validateSeal(seal, producer), seal);
  assert.throws(() =>
    validateSeal(
      { ...seal, producer: { ...producer, head: "0".repeat(40) } },
      producer,
    ),
  );
  assert.throws(() =>
    validateSeal(
      { ...seal, assets: [seal.assets[0], seal.assets[0], seal.assets[2]] },
      producer,
    ),
  );
  assert.throws(() =>
    validateSeal(
      { ...seal, release: { ...seal.release, tag: "v26.51.0" } },
      producer,
    ),
  );
});
test("restore client is closed GET-only and cannot reach foreign repo endpoints", async () => {
  const calls = [],
    api = apiClient(
      "owner/repo",
      "secret",
      async (url, opts) => {
        calls.push({ url, opts });
        return new Response("{}");
      },
      { readOnly: true },
    );
  await api("actions/runs/22");
  assert.equal(calls.length, 1);
  for (const options of [
    { method: "POST", body: {} },
    { method: "DELETE" },
    { upload: true },
  ])
    await assert.rejects(api("releases", options));
  await assert.rejects(
    api("https://api.github.com/repos/foreign/repo/releases"),
  );
  assert.equal(calls.length, 1);
});
test("Actions ZIP negotiates JSON before signed bytes; release assets retain octet-stream", async (t) => {
  const root = await scratch(t),
    bytes = Buffer.from("sealed-owned-bytes");
  for (const [route, accept, host] of [
    [
      "/actions/artifacts/55/zip",
      "application/vnd.github+json",
      "productionresultssa0.blob.core.windows.net",
    ],
    [
      "/releases/assets/44",
      "application/octet-stream",
      "release-assets.githubusercontent.com",
    ],
  ]) {
    const calls = [];
    const file = path.join(
      root,
      route.startsWith("/actions/") ? "actions.zip" : "release.bin",
    );
    await downloadAsset(
      "owner/repo",
      "credential",
      route,
      file,
      { bytes: bytes.length, sha256: sha(bytes) },
      {
        request: async (url, opts) => {
          calls.push({ url: String(url), opts });
          if (calls.length === 1)
            return opts.headers.Accept === accept
              ? new Response(null, {
                  status: 302,
                  headers: {
                    location: `https://${host}/owned?signature=private`,
                  },
                })
              : new Response(null, { status: 415 });
          return new Response(bytes);
        },
      },
    );
    assert.equal(
      calls[0].url,
      `https://api.github.com/repos/owner/repo${route}`,
    );
    assert.equal(calls[0].opts.headers.Accept, accept);
    assert.equal(calls[0].opts.headers.Authorization, "Bearer credential");
    assert.equal(calls[0].opts.redirect, "manual");
    assert.equal(calls[1].opts.headers, undefined);
    assert.equal(calls[1].opts.redirect, "error");
    assert.deepEqual(await readFile(file), bytes);
  }
});

test("download strips auth on verified redirect and rejects hostile redirects before request", async (t) => {
  const root = await scratch(t),
    bytes = Buffer.from("owned-bytes"),
    calls = [];
  const request = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/owned?signature=private",
          },
        })
      : new Response(bytes);
  };
  await downloadAsset(
    "owner/repo",
    "credential",
    "/releases/assets/44",
    path.join(root, "asset"),
    { bytes: bytes.length, sha256: sha(bytes) },
    { request },
  );
  assert.equal(calls[0].opts.headers.Authorization, "Bearer credential");
  assert.equal(calls[1].opts.headers, undefined);
  assert.equal(calls[1].opts.redirect, "error");
  for (const target of [
    "http://release-assets.githubusercontent.com/a",
    "https://evil.invalid/a",
    "https://user:pass@release-assets.githubusercontent.com/a",
  ]) {
    let count = 0;
    await assert.rejects(
      downloadAsset(
        "owner/repo",
        "credential",
        "/releases/assets/44",
        path.join(root, `bad-${count}`),
        { bytes: bytes.length, sha256: sha(bytes) },
        {
          request: async () => {
            count++;
            return new Response(null, {
              status: 302,
              headers: { location: target },
            });
          },
        },
      ),
    );
    assert.equal(count, 1);
  }
});
test("asset tamper or oversized stream never becomes an admitted download", async (t) => {
  const root = await scratch(t);
  await assert.rejects(
    downloadAsset(
      "owner/repo",
      "credential",
      "/releases/assets/44",
      path.join(root, "bad"),
      { bytes: 1, sha256: sha("x") },
      { request: async () => new Response("xx") },
    ),
  );
  await assert.rejects(
    downloadAsset(
      "owner/repo",
      "credential",
      "/releases/assets/44",
      path.join(root, "changed"),
      { bytes: 1, sha256: sha("x") },
      { request: async () => new Response("y") },
    ),
  );
});

test("both download routes reject failed statuses, byte tamper and short or oversized bodies without fallback", async (t) => {
  const root = await scratch(t);
  let index = 0;
  for (const route of ["/actions/artifacts/55/zip", "/releases/assets/44"]) {
    for (const [body, status] of [
      ["", 403],
      ["", 415],
      ["", 500],
      ["", 200],
      ["y", 200],
      ["xx", 200],
    ]) {
      let calls = 0;
      const file = path.join(root, `denied-${index++}`);
      await assert.rejects(
        downloadAsset(
          "owner/repo",
          "credential",
          route,
          file,
          { bytes: 1, sha256: sha("x") },
          {
            request: async () => {
              calls++;
              return new Response(body, { status });
            },
          },
        ),
      );
      assert.equal(calls, 1);
      if (status !== 200)
        await assert.rejects(readFile(file), { code: "ENOENT" });
    }
    let calls = 0;
    await assert.rejects(
      downloadAsset(
        "owner/repo",
        "credential",
        route,
        path.join(root, `unsafe-${index++}`),
        { bytes: 1, sha256: sha("x") },
        {
          request: async () => {
            calls++;
            return new Response(null, {
              status: 302,
              headers: {
                location: "https://foreign.invalid/owned?secret=private",
              },
            });
          },
        },
      ),
      /Unreviewed asset download domain/,
    );
    assert.equal(calls, 1);
  }
});

test("route media negotiation cannot admit another route or bypass the carried deadline or expected-byte bound", async (t) => {
  const root = await scratch(t);
  let requests = 0;
  const request = async () => {
    requests++;
    return new Response("x");
  };
  for (const route of [
    "/actions/artifacts/55/tar",
    "/actions/artifacts/55/zip?redirect=foreign",
    "/releases/assets/0",
    "https://foreign.invalid/zip",
  ]) {
    await assert.rejects(
      downloadAsset(
        "owner/repo",
        "credential",
        route,
        path.join(root, "none"),
        { bytes: 1, sha256: sha("x") },
        { request },
      ),
    );
  }
  await assert.rejects(
    downloadAsset(
      "owner/repo",
      "credential",
      "/actions/artifacts/55/zip",
      path.join(root, "expired"),
      { bytes: 1, sha256: sha("x") },
      { request, deadline: Date.now() - 1 },
    ),
  );
  await assert.rejects(
    downloadAsset(
      "owner/repo",
      "credential",
      "/actions/artifacts/55/zip",
      path.join(root, "oversized"),
      { bytes: 2, sha256: sha("xx") },
      { request, maximum: 1 },
    ),
  );
  assert.equal(requests, 0);
});
test("quiescence does not mistake a remaining owned group for safe archive input", async () => {
  assert.equal(
    await groupQuiet(42, {
      kill: () => {
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
      },
      wait: async () => {},
    }),
    true,
  );
  assert.equal(
    await groupQuiet(42, { kill: () => {}, wait: async () => {} }),
    false,
  );
  await assert.rejects(
    groupQuiet(42, {
      kill: () => {
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      },
      wait: async () => {},
    }),
  );
});
test("canonical workspace never reuses an existing local tree", async (t) => {
  const root = await scratch(t);
  const created = await workspace(root, SOURCE_ID);
  assert.ok(created.startsWith(root));
  await assert.rejects(workspace(root, SOURCE_ID));
});
test("real stdlib full pack/restore, independent hardlinks, tamper, paths and byte cap", async (t) => {
  const root = await scratch(t),
    helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const result = python(
    `import importlib.util,pathlib,os,json,tarfile,gzip,hashlib,io
p=pathlib.Path(__import__('sys').argv[1]); spec=importlib.util.spec_from_file_location('checkpoint',__import__('sys').argv[2]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
s=p/'input';s.mkdir();(s/'nested').mkdir();(s/'owned.bat').write_bytes(b'@exit /b 0');(s/'nested'/'data').write_bytes(os.urandom(12000));os.link(s/'nested'/'data',s/'hardlink')
with (s/'owned.bat').open('rb') as f:
 opened=os.fstat(f.fileno());expected=m.stamp(opened);assert m.opened_identity_matches(expected,opened)
 for i in [0,1,2,3,5]:
  changed=list(expected);changed[i]+=1;assert not m.opened_identity_matches(changed,opened)
 for mode in [expected[4]^0o200,(expected[4]&0o777)|0o040000]:
  changed=list(expected);changed[4]=mode;assert not m.opened_identity_matches(changed,opened)
a=m.pack(s,p/'bundle',cap=100000,chunk_size=4096);assert a['rawBytes']==24010 and len(a['chunks'])>1
index=json.loads((p/'bundle'/'inventory.json').read_bytes());assert all(isinstance(row['stamp'][i],str) for row in index['entries'] for i in [1,2,3])
r=m.restore(p/'bundle',p/'restored',a);assert r['complete'] and (p/'restored'/'hardlink').read_bytes()==(s/'hardlink').read_bytes()
with (p/'bundle'/a['chunks'][0]['name']).open('ab') as out:out.write(b'x')
try:m.restore(p/'bundle',p/'tampered',a);raise AssertionError('tamper accepted')
except ValueError:assert not (p/'tampered').exists()
try:m.pack(s,p/'capped',cap=100);raise AssertionError('cap accepted')
except ValueError:assert sum(x.stat().st_size for x in (p/'capped').iterdir())<=100
for name in ['../escape','/absolute','a\\\\b','a//b','a/./b','x:y','CON','nested/aux.txt','trailing.','space ']:
 try:m.relative(name);raise AssertionError('unsafe path accepted')
 except ValueError:pass
print(json.dumps({'fullRoundtrip':True,'hardlinksRegular':True,'tamperRejected':True,'byteCap':True,'paths':True}))`,
    [root, helper],
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).fullRoundtrip, true);
});
test("real stdlib refuses archive link entries and reads only bounded seal.json", async (t) => {
  const root = await scratch(t),
    helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const result = python(
    `import importlib.util,pathlib,json,tarfile,gzip,hashlib,zipfile,subprocess,sys
p=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('checkpoint',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
b=p/'bundle';b.mkdir();f=b/'checkpoint-00000.bin'
with tarfile.open(f,'w:gz') as out:
 t=tarfile.TarInfo('link');t.type=tarfile.SYMTYPE;t.linkname='../escape';out.addfile(t)
index={'schemaVersion':1,'entries':[{'path':'link','kind':'file','stamp':[0,'0','0','0',33188,1]}],'files':[{'path':'link','sha256':hashlib.sha256(b'').hexdigest()}],'generatedLinks':{}}
pin=m.metadata(b,'inventory.json',index);a={'chunks':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}],'inventory':pin}
try:m.restore(b,p/'result',a);raise AssertionError('link accepted')
except ValueError:assert not (p/'escape').exists()
z=p/'seal.zip'
with zipfile.ZipFile(z,'w') as out:out.writestr('../seal.json','{}')
r=subprocess.run([sys.executable,'-I','-B',sys.argv[2],'seal','--input',str(z),'--output',str(p)],capture_output=True,text=True);assert r.returncode==1
print('{}')`,
    [root, helper],
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
test(
  "Unix actual controlled timer differs from compiler137 and reaps descendants",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await scratch(t);
    const env = { PATH: path.dirname(process.execPath) };
    const timed = await compileSlice(
      process.execPath,
      [
        "-e",
        "require('node:child_process').spawn(process.execPath,['-e','const hold=setInterval(()=>{},1000);setTimeout(()=>clearInterval(hold),5000)'],{stdio:'ignore',detached:true});setInterval(()=>{},1000);setTimeout(()=>process.exit(99),10000)",
      ],
      { cwd: root, env, logs: root, milliseconds: 500 },
    );
    assert.equal(timed.outcome, "slice-ended");
    assert.equal(timed.quiescent, true);
    assert.ok(
      timed.observed.length >= 2,
      "Detached grandchild must actually have been observed and reaped",
    );
    const next = await scratch(t);
    const failed = await compileSlice(
      process.execPath,
      ["-e", "setTimeout(()=>process.exit(137),200)"],
      { cwd: next, env, logs: next, milliseconds: 1000 },
    );
    assert.equal(failed.outcome, "compiler-failed");
    assert.equal(failed.exitCode, 137);
  },
);
test("workflow keeps credentials only in audited download/upload, sealed last, explicit fixed inputs", async () => {
  const workflow = await readFile(path.join(ROOT, WORKFLOW), "utf8");
  assert.equal((workflow.match(/GH_TOKEN:/g) || []).length, 2);
  assert.match(
    workflow,
    /Download exact independently sealed prior checkpoint/,
  );
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /restore_run:/);
  const preflight = workflow.indexOf(
    "node --test tests/tooling/cefEngineeringCheckpoint.node-test.mjs",
  );
  assert.ok(
    preflight > workflow.indexOf("node scripts/cef-hosted-provision.mjs"),
    "real platform tests run after fixed prerequisites",
  );
  assert.ok(
    preflight <
      workflow.indexOf("node scripts/cef-engineering-checkpoint.mjs download"),
    "real platform tests must pass before any restore or source/compiler work",
  );
  const preflightStep = workflow
    .split(/\n      - /)
    .find((step) =>
      step.includes(
        "node --test tests/tooling/cefEngineeringCheckpoint.node-test.mjs",
      ),
    );
  assert.doesNotMatch(
    preflightStep,
    /GH_TOKEN|GITHUB_TOKEN|npm (?:ci|install)|continue-on-error:/,
  );
  assert.doesNotMatch(
    workflow.replace(
      "run: npm ci --ignore-scripts --no-audit --no-fund",
      "run: locked-checkpoint-contract-dependencies",
    ),
    /actions\/cache@|npm (?:ci|install)|target_commitish:|\$\{\{ inputs\.restore_run \}\}.*node /,
  );
  assert.ok(
    workflow.indexOf("Seal immutable checkpoint metadata LAST") >
      workflow.indexOf("checkpoint.mjs upload"),
  );
  assert.ok(
    workflow.indexOf("checkpoint.mjs outcome") >
      workflow.indexOf("Seal immutable checkpoint metadata LAST"),
  );
});

test("producer code authority is independently bound to exact committed source tree", () => {
  const entries = [
    { path: WORKFLOW, type: "blob", mode: "100644", sha: "1".repeat(40) },
    {
      path: "scripts/lib/cef-checkpoint-archive.py",
      type: "blob",
      mode: "100644",
      sha: "2".repeat(40),
    },
  ];
  assert.match(codeTreeDigest(entries), /^[a-f0-9]{64}$/);
  assert.equal(
    codeTreeDigest([
      ...entries,
      {
        path: "scripts/lib",
        type: "tree",
        mode: "040000",
        sha: "9".repeat(40),
      },
    ]),
    codeTreeDigest(entries),
  );
  assert.throws(() => codeTreeDigest(entries.slice(0, 1)));
  assert.throws(() =>
    codeTreeDigest([entries[0], { ...entries[1], mode: "120000" }]),
  );
  assert.notEqual(
    codeTreeDigest(entries),
    codeTreeDigest([entries[0], { ...entries[1], sha: "3".repeat(40) }]),
  );
});

test("real seal ZIP plus mocked read-only GitHub transfer binds run/code/draft before chunks", async (t) => {
  const root = await scratch(t),
    helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const entries = [
    { path: WORKFLOW, type: "blob", mode: "100644", sha: "1".repeat(40) },
    {
      path: "scripts/lib/cef-checkpoint-archive.py",
      type: "blob",
      mode: "100644",
      sha: "2".repeat(40),
    },
  ];
  const m = manifest();
  m.identity.producer = codeTreeDigest(entries);
  m.identitySha256 = validateIdentity(m.identity);
  const chunk = Buffer.from("compressed"),
    inventory = Buffer.from("inventory");
  m.archive.chunks = [
    { name: "checkpoint-00000.bin", bytes: chunk.length, sha256: sha(chunk) },
  ];
  m.archive.compressedBytes = chunk.length;
  m.archive.inventory = {
    name: "inventory.json",
    bytes: inventory.length,
    sha256: sha(inventory),
  };
  const bytes = Buffer.from(canonical(m) + "\n"),
    mp = { name: "manifest.json", bytes: bytes.length, sha256: sha(bytes) };
  const assets = [...m.archive.chunks, m.archive.inventory, mp].map(
    (pin, i) => ({ id: 44 + i, ...pin }),
  );
  const seal = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-seal",
    producer,
    identitySha256: m.identitySha256,
    release: {
      id: 33,
      tag: `cef-checkpoint-${TARGET}-${m.identitySha256.slice(0, 16)}-22-1`,
    },
    manifest: mp,
    assets,
  };
  const zip = path.join(root, "seal.zip");
  const packed = python(
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('seal.json',sys.argv[2]);z.close()",
    [zip, canonical(seal)],
  );
  assert.equal(packed.status, 0, packed.stderr);
  const zipBytes = await readFile(zip),
    pythonExe = python("import sys;print(sys.executable)").stdout.trim();
  const calls = [];
  let truncate = false;
  const request = async (url, options) => {
    assert.equal(options.method ?? "GET", "GET");
    calls.push(String(url));
    const base = "https://api.github.com/repos/owner/repo";
    const suffix =
      String(url) === base
        ? ""
        : String(url).startsWith(base + "/")
          ? String(url).slice(base.length + 1)
          : undefined;
    assert.notEqual(suffix, undefined);
    if (suffix === "actions/artifacts/55/zip") return new Response(zipBytes);
    if (suffix === "releases/assets/44") return new Response(chunk);
    if (suffix === "releases/assets/45") return new Response(inventory);
    if (suffix === "releases/assets/46") return new Response(bytes);
    const data = {
      "": {
        id: 11,
        full_name: "owner/repo",
        private: false,
        default_branch: "Main",
      },
      "actions/workflows/cef-engineering-checkpoint.yml": {
        id: 66,
        path: WORKFLOW,
      },
      "actions/runs/22": {
        workflow_id: 66,
        event: "workflow_dispatch",
        head_sha: producer.head,
        head_branch: "Main",
        head_repository: { id: 11 },
        run_attempt: 1,
        status: "completed",
        conclusion: "failure",
      },
      "actions/runs/22/artifacts?per_page=100": {
        total_count: 1,
        artifacts: [
          {
            id: 55,
            name: "cef-engineering-seal-22-1",
            expired: false,
            size_in_bytes: zipBytes.length,
            digest: `sha256:${sha(zipBytes)}`,
            workflow_run: { head_sha: producer.head },
          },
        ],
      },
      "releases/33/assets?per_page=100": assets.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.bytes,
        digest: `sha256:${a.sha256}`,
        state: "uploaded",
      })),
      "releases/33": {
        draft: true,
        prerelease: true,
        tag_name: seal.release.tag,
        target_commitish: producer.head,
        assets: assets.map((a) => ({
          id: a.id,
          name: a.name,
          size: a.bytes,
          digest: `sha256:${a.sha256}`,
          state: "uploaded",
        })),
      },
      [`git/commits/${producer.head}`]: {
        sha: producer.head,
        tree: { sha: "7".repeat(40) },
      },
      [`git/trees/${"7".repeat(40)}?recursive=1`]: {
        sha: "7".repeat(40),
        truncated: truncate,
        tree: entries,
      },
    }[suffix];
    assert.notEqual(data, undefined, suffix);
    return new Response(JSON.stringify(data));
  };
  const result = await restoreDownload(
    apiClient("owner/repo", "credential", request, { readOnly: true }),
    {
      repository: "owner/repo",
      token: "credential",
      runId: 22,
      destination: path.join(root, "download"),
      python: pythonExe,
      helper,
      request,
    },
  );
  assert.equal(result.manifest.identitySha256, m.identitySha256);
  assert.equal(result.nativeAcceptance, false);
  assert.ok(
    calls.findIndex((x) => x.includes("git/trees/")) <
      calls.findIndex((x) => x.endsWith("releases/assets/44")),
  );
  calls.length = 0;
  truncate = true;
  await assert.rejects(
    restoreDownload(
      apiClient("owner/repo", "credential", request, { readOnly: true }),
      {
        repository: "owner/repo",
        token: "credential",
        runId: 22,
        destination: path.join(root, "bad-tree"),
        python: pythonExe,
        helper,
        request,
      },
    ),
  );
  assert.equal(
    calls.some((x) => x.endsWith("releases/assets/44")),
    false,
  );
});
test(
  "exact current generated SDK recipe is the only permitted link regeneration",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await scratch(t),
      helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
    const result = python(
      `import importlib.util,pathlib,os,json,sys
p=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('checkpoint',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
s=p/'input';s.mkdir();(s/'sdk'/'xcode_links').mkdir(parents=True);(s/'file').write_bytes(b'owned')
recipe={}
for name in ['MacOSX26.2.sdk','MacOSX.platform','XcodeDefault.xctoolchain']:
 target=p/name;target.mkdir();relative='sdk/xcode_links/'+name;os.symlink(str(target),s/relative);recipe[relative]=str(target)
a=m.pack(s,p/'bundle',generated_links=recipe)
try:m.restore(p/'bundle',p/'bad',a,generated_links={});raise AssertionError('foreign recipe accepted')
except ValueError:assert not (p/'bad').exists()
r=m.restore(p/'bundle',p/'restored',a,generated_links=recipe);assert r['complete'] and not r['linksExtracted']
for relative,target in recipe.items():assert os.readlink(p/'restored'/relative)==target
os.symlink(str(p),s/'unreviewed')
try:m.pack(s,p/'unreviewed-bundle',generated_links=recipe);raise AssertionError('unknown link accepted')
except ValueError:pass
print('{}')`,
      [root, helper],
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  },
);

test("hostile PAX metadata is rejected before stdlib allocation or extraction", async (t) => {
  const root = await scratch(t),
    helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const result = python(
    `import importlib.util,pathlib,tarfile,gzip,hashlib,sys
p=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('checkpoint',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
b=p/'bundle';b.mkdir();f=b/'checkpoint-00000.bin';t=tarfile.TarInfo('metadata');t.type=tarfile.XHDTYPE;t.size=20*1024**2
f.write_bytes(gzip.compress(t.tobuf()))
index={'schemaVersion':1,'entries':[{'path':'file','kind':'file','stamp':[0,'0','0','0',33188,1]}],'files':[{'path':'file','sha256':hashlib.sha256(b'').hexdigest()}],'generatedLinks':{}}
pin=m.metadata(b,'inventory.json',index);a={'chunks':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}],'inventory':pin}
try:m.restore(b,p/'output',a);raise AssertionError('huge PAX accepted')
except m.CheckpointError as error:assert str(error)=='member-pax-bound'
print('{}')`,
    [root, helper],
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("redirect storage accounts are the closed primary Actions inventory, never Azure-wide", () => {
  for (const host of [
    "productionresultssa0.blob.core.windows.net",
    "productionresultssa19.blob.core.windows.net",
    "productionresultssa30.blob.core.windows.net",
    "productionresultssa49.blob.core.windows.net",
    "productionresultssa100.blob.core.windows.net",
    "productionresultssa199.blob.core.windows.net",
  ])
    assert.equal(downloadHost(host), true);
  for (const host of [
    "productionresultssa20.blob.core.windows.net",
    "productionresultssa50.blob.core.windows.net",
    "productionresultssa200.blob.core.windows.net",
    "productionresultssa01.blob.core.windows.net",
    "arbitrary.blob.core.windows.net",
    "release-assets.githubusercontent.com.evil.invalid",
  ])
    assert.equal(downloadHost(host), false);
});

test("process ownership parser rejects ambiguous identities and follows observed children only", () => {
  const rows = processRows(
    " 10 1 Sat Oct 24 00:00:00 2026\n 11 10 Sat Oct 24 00:00:01 2026\n 12 11 Sat Oct 24 00:00:02 2026\n 99 1 Sat Oct 24 00:00:00 2026",
  );
  assert.deepEqual(
    observedLineage(rows, [{ pid: 10, start: rows[0].start }]).map(
      (r) => r.pid,
    ),
    [10, 11, 12],
  );
  assert.throws(() =>
    observedLineage(rows, [{ pid: 10, start: "Fri Oct 23 00:00:00 2026" }]),
  );
  assert.throws(() =>
    processRows("10 1 Sat Oct 24 00:00:00 2026\n10 2 Sat Oct 24 00:00:00 2026"),
  );
  assert.throws(() => processRows("raw process command or malformed identity"));
});

test("repository identity request uses GitHub's exact root route, not the404 trailing alias", async () => {
  let seen;
  const api = apiClient(
    "owner/repo",
    "credential",
    async (url) => {
      seen = url;
      return new Response("{}");
    },
    { readOnly: true },
  );
  await api("");
  assert.equal(seen, "https://api.github.com/repos/owner/repo");
});

test("actual production CLI restores the FULL sealed manifest envelope, never a bare archive alias", async (t) => {
  const root = await scratch(t),
    input = path.join(root, "input"),
    bundle = path.join(root, "bundle"),
    restored = path.join(root, "restored"),
    helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  await mkdir(input);
  await writeFile(path.join(input, "owned"), "full-CLI-envelope");
  const pythonExe = python("import sys;print(sys.executable)").stdout.trim();
  const archive = await archiveCommand(pythonExe, helper, [
    "pack",
    "--input",
    input,
    "--output",
    bundle,
  ]);
  const full = manifest();
  full.archive = archive;
  validateManifest(full);
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, canonical(full));
  const result = await archiveCommand(pythonExe, helper, [
    "restore",
    "--input",
    bundle,
    "--output",
    restored,
    "--manifest",
    manifestPath,
  ]);
  assert.equal(result.complete, true);
  assert.equal(
    await readFile(path.join(restored, "owned"), "utf8"),
    "full-CLI-envelope",
  );
  const bare = path.join(root, "bare.json");
  await writeFile(bare, canonical(archive));
  await assert.rejects(
    archiveCommand(pythonExe, helper, [
      "restore",
      "--input",
      bundle,
      "--output",
      path.join(root, "bare-restore"),
      "--manifest",
      bare,
    ]),
  );
});

test("actual graph guard denies a changed compile or pack graph before a usable snapshot", async (t) => {
  const root = await scratch(t);
  await writeFile(path.join(root, "build.ninja"), "reviewed-graph");
  await writeFile(path.join(root, "args.gn"), 'target_cpu="x64"');
  const digest = await graphDigest(root);
  let packs = 0;
  await writeFile(path.join(root, "build.ninja"), "changed-after-compile");
  await assert.rejects(
    withVerifiedGraph(root, digest, async () => {
      packs++;
      return "snapshot";
    }),
    /graph differs/,
  );
  assert.equal(packs, 0);
  await writeFile(path.join(root, "build.ninja"), "reviewed-graph");
  await assert.rejects(
    withVerifiedGraph(root, digest, async () => {
      packs++;
      await writeFile(path.join(root, "build.ninja"), "changed-during-pack");
      return "snapshot";
    }),
    /graph differs/,
  );
  assert.equal(packs, 1);
});

test("restored graph is checked before install and genuine revalidation precedes reuse", async (t) => {
  const root = await scratch(t),
    fresh = path.join(root, "out"),
    restored = path.join(root, "checkpoint-restored");
  for (const directory of [fresh, restored]) {
    await mkdir(path.join(directory, "gen"), { recursive: true });
    await writeFile(path.join(directory, "build.ninja"), "reviewed");
    await writeFile(path.join(directory, "args.gn"), "current-args");
  }
  await writeFile(path.join(fresh, "gen/header.h"), "CURRENT generated header");
  await writeFile(path.join(restored, "gen/header.h"), "cached older header");
  const digest = await graphDigest(fresh);
  let rerun = 0,
    links = 0;
  await writeFile(path.join(restored, "build.ninja"), "tampered-cached-graph");
  await assert.rejects(
    restoreVerifiedGraph({
      fresh,
      restored,
      expectedGraph: digest,
      revalidateGn: async () => {
        rerun++;
      },
      verifyGenerated: async () => {
        links++;
      },
    }),
    /graph differs/,
  );
  assert.equal(
    await readFile(path.join(fresh, "gen/header.h"), "utf8"),
    "CURRENT generated header",
  );
  assert.equal(rerun, 0);
  await writeFile(path.join(restored, "build.ninja"), "reviewed");
  await restoreVerifiedGraph({
    fresh,
    restored,
    expectedGraph: digest,
    revalidateGn: async () => {
      rerun++;
      assert.equal(
        await readFile(path.join(fresh, "gen/header.h"), "utf8"),
        "cached older header",
      );
      await writeFile(
        path.join(fresh, "gen/header.h"),
        await readFile(path.join(fresh + ".fresh-gn", "gen/header.h")),
      );
    },
    verifyGenerated: async () => {
      links++;
    },
  });
  assert.equal(rerun, 1);
  assert.equal(links, 1);
  assert.equal(
    await readFile(path.join(fresh, "gen/header.h"), "utf8"),
    "CURRENT generated header",
  );
});

test(
  "natural compiler exits never admit a later observed detached output writer",
  { skip: process.platform === "win32" },
  async (t) => {
    for (const exitCode of [0, 137]) {
      const root = await scratch(t),
        output = path.join(root, "late-output");
      const writer =
        "const fs=require('node:fs');const file=process.argv[1];const interval=setInterval(()=>fs.appendFileSync(file,'x'),20);setTimeout(()=>clearInterval(interval),2000);";
      const parent =
        "setTimeout(()=>{require('node:child_process').spawn(process.execPath,['-e'," +
        JSON.stringify(writer) +
        ",process.argv[1]],{detached:true,stdio:'ignore'});},100);setTimeout(()=>process.exit(" +
        exitCode +
        "),800);";
      await assert.rejects(
        compileSlice(process.execPath, ["-e", parent, output], {
          cwd: root,
          env: {
            PATH: path.dirname(process.execPath),
            ...(process.env.RUNNER_TRACKING_ID
              ? { RUNNER_TRACKING_ID: process.env.RUNNER_TRACKING_ID }
              : {}),
          },
          logs: root,
          milliseconds: 5000,
        }),
        /descendants survived compiler exit/,
      );
      const before = (await readFile(output)).length;
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await readFile(output)).length, before);
      const outcome = JSON.parse(
        await readFile(
          path.join(root, "checkpoint-compile.outcome.json"),
          "utf8",
        ),
      );
      assert.equal(outcome.exitCode, exitCode);
      assert.equal(outcome.ownTimerExpired, false);
      assert.equal(outcome.checkpointAllowed, false);
    }
  },
);

function completedSdk(overrides = {}) {
  return createSdkCompletion({
    producer: { ...producer },
    identity: { ...identity },
    compile: {
      ...manifest().compile,
      outcome: "compiler-complete",
      exitCode: 0,
    },
    distributionExitCode: 0,
    checked: {
      descriptor: { target: TARGET },
      identity: { sourceLockSha256: SOURCE_ID },
      assets: SDK_NAMES.map((name) => ({
        name,
        size: 10,
        sha256: "f".repeat(64),
      })),
    },
    ...overrides,
  });
}
test("explicit engineering modes and slices reserve the bounded host budget without silent shortening", () => {
  assert.deepEqual(executionOptions(), {
    mode: "checkpoint",
    minutes: 15,
    milliseconds: 900000,
  });
  for (const mode of ["checkpoint", "complete-sdk"])
    for (const minutes of [15, 30, 60, 120, 180]) {
      const options = executionOptions(mode, String(minutes));
      assert.equal(sliceBudget(options, LIMITS.hostMs), minutes * 60000);
      assert.deepEqual(
        argumentsFor([
          "compile",
          "--mode",
          mode,
          "--slice-minutes",
          String(minutes),
        ]),
        { mode: "compile", "--mode": mode, "--slice-minutes": String(minutes) },
      );
    }
  for (const [mode, minutes] of [
    ["publish", "15"],
    ["checkpoint", "300"],
    ["complete-sdk", "015"],
    ["checkpoint", "15.0"],
  ])
    assert.throws(() => executionOptions(mode, minutes));
  const start = 123000;
  assert.equal(
    hostRemaining(
      { CEF_ENGINEERING_JOB_STARTED_MS: String(start) },
      start + 1000,
    ),
    LIMITS.hostMs - 1000,
  );
  assert.throws(() => hostRemaining({}, start));
  assert.throws(() =>
    hostRemaining(
      { CEF_ENGINEERING_JOB_STARTED_MS: String(start) },
      start + LIMITS.hostMs,
    ),
  );
  assert.throws(() =>
    sliceBudget(executionOptions("complete-sdk", "180"), 239 * 60000),
  );
  assert.equal(
    sliceBudget(executionOptions("complete-sdk", "180"), 240 * 60000),
    180 * 60000,
  );
});
test("completed SDK authority requires natural compiler zero, quiescence, packaging zero and all five verified assets", () => {
  const value = completedSdk();
  assert.equal(validateSdkCompletion(value), value);
  assert.equal(value.nativeAcceptance, false);
  assert.equal(value.runtimeReady, false);
  for (const patch of [
    { outcome: "slice-ended", exitCode: null },
    { outcome: "compiler-failed", exitCode: 137 },
    { quiescent: false },
    { observed: [] },
  ]) {
    assert.throws(() =>
      completedSdk({ compile: { ...value.compile, ...patch } }),
    );
  }
  assert.throws(() => completedSdk({ distributionExitCode: 23 }));
  assert.throws(() => validateSdkCompletion(manifest()));
  for (const patch of [
    { nativeAcceptance: true },
    { runtimeReady: true },
    { target: "aarch64-apple-darwin" },
    { sourceLockSha256: "1".repeat(64) },
    { bundleVerified: false },
    { bundleAssets: value.bundleAssets.slice(1) },
    { producer: { ...producer, attempt: 0 } },
    {
      bundleAssets: value.bundleAssets.map((row, i) =>
        i === 0 ? { ...row, name: "../runtime.json" } : row,
      ),
    },
  ])
    assert.throws(() => validateSdkCompletion({ ...value, ...patch }));
  const seal = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-sdk-seal",
    producer,
    release: {
      id: 33,
      tag: `cef-sdk-checkpoint-${TARGET}-${value.identitySha256.slice(0, 16)}-22-1`,
    },
    completion: value,
    completionSha256: completionSha(value),
    assets: value.bundleAssets.map((row, i) => ({ id: 44 + i, ...row })),
  };
  assert.equal(validateSdkSeal(seal, producer), seal);
  assert.notEqual(sdkSealName(producer), "cef-engineering-seal-22-1");
  for (const patch of [
    { kind: "sorng-cef-engineering-seal" },
    { completionSha256: "1".repeat(64) },
    {
      assets: seal.assets.map((row, i) =>
        i === 0 ? { ...row, sha256: "1".repeat(64) } : row,
      ),
    },
    { release: { id: 33, tag: "cef-checkpoint-old" } },
  ])
    assert.throws(() => validateSdkSeal({ ...seal, ...patch }, producer));
});
test("SDK upload endpoint role is closed and does not broaden the checkpoint role", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return new Response("{}");
  };
  const ordinary = apiClient("owner/repo", "test", request);
  await assert.rejects(
    ordinary("releases/33/assets?name=runtime.json", {
      method: "POST",
      upload: true,
      body: Buffer.from("x"),
      bodyBytes: 1,
    }),
  );
  const sdk = apiClient("owner/repo", "test", request, { sdk: true });
  for (const name of SDK_NAMES)
    await sdk(`releases/33/assets?name=${encodeURIComponent(name)}`, {
      method: "POST",
      upload: true,
      body: Buffer.from("x"),
      bodyBytes: 1,
    });
  for (const name of [
    "checkpoint-00000.bin",
    "../runtime.json",
    "unknown.json",
  ])
    await assert.rejects(
      sdk(`releases/33/assets?name=${encodeURIComponent(name)}`, {
        method: "POST",
        upload: true,
        body: Buffer.from("x"),
        bodyBytes: 1,
      }),
    );
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.headers["Content-Length"], "1");
  }
});

test("actual SDK seal ZIP transfer verifies independent producer and five immutable byte pins before native use", async (t) => {
  const root = await scratch(t),
    helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const entries = [
    { path: WORKFLOW, type: "blob", mode: "100644", sha: "1".repeat(40) },
    {
      path: "scripts/lib/cef-checkpoint-archive.py",
      type: "blob",
      mode: "100644",
      sha: "2".repeat(40),
    },
  ];
  const blobs = SDK_NAMES.map((name) => Buffer.from(name));
  const proof = completedSdk({
    identity: { ...identity, producer: codeTreeDigest(entries) },
    checked: {
      descriptor: { target: TARGET },
      identity: { sourceLockSha256: SOURCE_ID },
      assets: SDK_NAMES.map((name, i) => ({
        name,
        size: blobs[i].length,
        sha256: sha(blobs[i]),
      })),
    },
  });
  const seal = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-sdk-seal",
    producer,
    release: {
      id: 33,
      tag: `cef-sdk-checkpoint-${TARGET}-${proof.identitySha256.slice(0, 16)}-22-1`,
    },
    completion: proof,
    completionSha256: completionSha(proof),
    assets: proof.bundleAssets.map((row) => ({
      id: 44 + SDK_NAMES.indexOf(row.name),
      ...row,
    })),
  };
  const zip = path.join(root, "sdk.zip");
  assert.equal(
    python(
      "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('seal.json',sys.argv[2]);z.close()",
      [zip, canonical(seal)],
    ).status,
    0,
  );
  const zipBytes = await readFile(zip),
    pythonExe = python("import sys;print(sys.executable)").stdout.trim();
  const selected = {
    producer: "engineering-sdk",
    target: TARGET,
    runId: 22,
    runAttempt: 1,
    headSha: producer.head,
    artifactId: 55,
    artifactSha256: sha(zipBytes),
    completionSha256: completionSha(proof),
    descriptorSha256: sha(blobs[SDK_NAMES.indexOf("runtime.json")]),
  };
  const calls = [];
  let badDraft = false,
    failedRun = false,
    truncatedTree = false,
    corrupt = false;
  const request = async (url, options) => {
    assert.equal(options.method ?? "GET", "GET");
    const base = "https://api.github.com/repos/owner/repo";
    assert.ok(String(url) === base || String(url).startsWith(base + "/"));
    const suffix = String(url).slice(base.length).replace(/^\//, "");
    calls.push(suffix);
    if (suffix === "actions/artifacts/55/zip") return new Response(zipBytes);
    const match = /^releases\/assets\/(4[4-8])$/.exec(suffix);
    if (match)
      return new Response(
        corrupt ? Buffer.from("bad") : blobs[Number(match[1]) - 44],
      );
    const data = {
      "": {
        id: 11,
        full_name: "owner/repo",
        private: false,
        default_branch: "Main",
      },
      "actions/workflows/cef-engineering-checkpoint.yml": {
        id: 66,
        path: WORKFLOW,
      },
      "actions/runs/22": {
        id: 22,
        workflow_id: 66,
        event: "workflow_dispatch",
        head_sha: producer.head,
        head_branch: "Main",
        head_repository: { id: 11 },
        run_attempt: 1,
        status: "completed",
        conclusion: failedRun ? "failure" : "success",
      },
      "actions/runs/22/artifacts?per_page=100": {
        total_count: 1,
        artifacts: [
          {
            id: 55,
            name: sdkSealName(producer),
            expired: false,
            size_in_bytes: zipBytes.length,
            digest: `sha256:${sha(zipBytes)}`,
            workflow_run: { id: 22, head_sha: producer.head },
          },
        ],
      },
      "releases/33": {
        draft: true,
        prerelease: true,
        tag_name: seal.release.tag,
        target_commitish: producer.head,
      },
      "releases/33/assets?per_page=100": seal.assets.map((row, i) => ({
        id: row.id,
        name: row.name,
        size: row.bytes,
        state: "uploaded",
        digest: `sha256:${badDraft && i === 0 ? "0".repeat(64) : row.sha256}`,
      })),
      [`git/commits/${producer.head}`]: {
        sha: producer.head,
        tree: { sha: "7".repeat(40) },
      },
      [`git/trees/${"7".repeat(40)}?recursive=1`]: {
        sha: "7".repeat(40),
        truncated: truncatedTree,
        tree: entries,
      },
    }[suffix];
    assert.notEqual(data, undefined, suffix);
    return new Response(JSON.stringify(data));
  };
  const transfer = (name) =>
    downloadSdkBundle(
      apiClient("owner/repo", "test", request, { readOnly: true }),
      {
        selection: selected,
        repository: "owner/repo",
        token: "test",
        destination: path.join(root, name),
        python: pythonExe,
        helper,
        request,
      },
    );
  assert.equal((await transfer("good")).sdkComplete, true);
  assert.equal(
    sha(await readFile(path.join(root, "good", "sdk-completion-proof.json"))),
    selected.completionSha256,
  );
  assert.ok(
    calls.indexOf(`git/trees/${"7".repeat(40)}?recursive=1`) <
      calls.indexOf("releases/assets/44"),
  );
  calls.length = 0;
  failedRun = true;
  await assert.rejects(transfer("failed-run"));
  assert.equal(calls.includes("actions/artifacts/55/zip"), false);
  failedRun = false;
  calls.length = 0;
  truncatedTree = true;
  await assert.rejects(transfer("bad-code"));
  assert.equal(
    calls.some((row) => row.startsWith("releases/assets/")),
    false,
  );
  truncatedTree = false;
  badDraft = true;
  await assert.rejects(transfer("bad-draft"));
  badDraft = false;
  corrupt = true;
  await assert.rejects(transfer("bad-bytes"));
});

test("active compiler lineage survives more than4096 sequential children without retaining historical identities", () => {
  const root = { pid: 10, start: "Sat Oct 24 00:00:00 2026" };
  let cohort = [root];
  for (let cycle = 0; cycle < 5000; cycle++) {
    const child = {
      pid: 100 + cycle,
      parent: 10,
      start: "Sat Oct 24 00:00:01 2026",
    };
    cohort = observedLineage([{ ...root, parent: 1 }, child], cohort);
    assert.deepEqual(cohort, [root, { pid: child.pid, start: child.start }]);
  }
  assert.deepEqual(observedLineage([{ ...root, parent: 1 }], cohort), [root]);
});
test("active compiler lineage discovers before pruning and retains live reparented identities but never a reused foreign PID", () => {
  const root = { pid: 10, start: "Sat Oct 24 00:00:00 2026" };
  const child = { pid: 20, start: "Sat Oct 24 00:00:01 2026" };
  const detached = { pid: 30, start: "Sat Oct 24 00:00:02 2026" };
  const rows = [
    { ...root, parent: 1 },
    { ...detached, parent: 1 },
    { pid: 40, parent: 20, start: "Sat Oct 24 00:00:03 2026" },
    { pid: 50, parent: 30, start: "Sat Oct 24 00:00:04 2026" },
  ];
  assert.deepEqual(observedLineage(rows, [root, child, detached]), [
    root,
    detached,
    { pid: 40, start: rows[2].start },
    { pid: 50, start: rows[3].start },
  ]);
  const reused = { pid: 20, parent: 1, start: "Sat Oct 24 01:00:00 2026" };
  assert.deepEqual(
    observedLineage(
      [
        { ...root, parent: 1 },
        reused,
        { pid: 60, parent: 20, start: rows[3].start },
      ],
      [root, child],
    ),
    [root],
  );
  // Even a changed occupant claiming the root as parent is excluded in this snapshot.
  assert.deepEqual(
    observedLineage(
      [
        { ...root, parent: 1 },
        { ...reused, parent: 10 },
      ],
      [root, child],
    ),
    [root],
  );
  assert.throws(
    () =>
      observedLineage(
        [{ ...root, parent: 1, start: reused.start }],
        [root, child],
      ),
    /root PID identity changed/,
  );
  const tooMany = Array.from({ length: 4096 }, (_, i) => ({
    pid: 100 + i,
    parent: 10,
    start: child.start,
  }));
  assert.throws(
    () => observedLineage([{ ...root, parent: 1 }, ...tooMany], [root]),
    /active descendant bound/,
  );
});

test("reaper stability compares exact process identities rather than equal cardinality", () => {
  const root = { pid: 10, start: "Sat Oct 24 00:00:00 2026" },
    a = { pid: 20, start: "Sat Oct 24 00:00:01 2026" },
    b = { pid: 30, start: "Sat Oct 24 00:00:02 2026" };
  assert.equal(sameObservedCohort([root, a], [root, b]), false);
  assert.equal(
    sameObservedCohort([root, a], [root, { ...a, start: b.start }]),
    false,
  );
  assert.equal(sameObservedCohort([root, b], [b, root]), true);
  assert.equal(sameObservedCohort([root, a], [root, a, b]), false);
});

async function sdkLinkFixture(
  t,
  alias = true,
  physicalName = "MacOSX26.2.sdk",
) {
  const root = await scratch(t),
    developer = path.join(root, "Developer"),
    sdk = path.join(
      developer,
      "Platforms",
      "MacOSX.platform",
      "Developer",
      "SDKs",
      physicalName,
    ),
    platform = path.join(developer, "Platforms", "MacOSX.platform"),
    toolchain = path.join(developer, "Toolchains", "XcodeDefault.xctoolchain");
  await mkdir(sdk, { recursive: true });
  await mkdir(toolchain, { recursive: true });
  await writeFile(path.join(sdk, "verified-marker"), "verified-sdk");
  const rawSdk = alias ? path.join(path.dirname(sdk), "MacOSX.sdk") : sdk;
  const type = process.platform === "win32" ? "junction" : "dir";
  if (alias) await symlink(sdk, rawSdk, type);
  const directory = path.join(root, "out", "sdk", "xcode_links");
  await mkdir(directory, { recursive: true });
  for (const target of [rawSdk, platform, toolchain])
    await symlink(target, path.join(directory, path.basename(target)), type);
  const expectedTargets = await Promise.all(
    [sdk, platform, toolchain].map((value) => realpath(value)),
  );
  return {
    root,
    out: path.join(root, "out"),
    directory,
    sdk,
    rawSdk,
    platform,
    toolchain,
    type,
    options: { developerDir: developer, sdkRoot: rawSdk, expectedTargets },
  };
}
test("SDK raw GN link names survive exact physical-target normalization without changing the installed SDK", async (t) => {
  const f = await sdkLinkFixture(t),
    sdkLink = path.join(f.directory, "MacOSX.sdk");
  assert.equal(await readlink(sdkLink), f.rawSdk);
  await assert.rejects(readlink(path.join(f.directory, "MacOSX26.2.sdk")));
  const unchanged = await lstat(path.join(f.directory, "MacOSX.platform"));
  const recipe = await normalizeSdkLinks(f.out, f.options);
  assert.deepEqual(
    Object.keys(recipe).sort(),
    [
      "sdk/xcode_links/MacOSX.platform",
      "sdk/xcode_links/MacOSX.sdk",
      "sdk/xcode_links/XcodeDefault.xctoolchain",
    ].sort(),
  );
  assert.equal(recipe["sdk/xcode_links/MacOSX.sdk"], await realpath(f.sdk));
  assert.equal(await readlink(sdkLink), await realpath(f.sdk));
  assert.equal(
    await readlink(f.rawSdk),
    f.sdk,
    "installed SDK alias never rewritten",
  );
  assert.equal(
    await readFile(path.join(f.sdk, "verified-marker"), "utf8"),
    "verified-sdk",
  );
  assert.equal(
    (await lstat(path.join(f.directory, "MacOSX.platform"))).ino,
    unchanged.ino,
    "already canonical generated links are not rewritten",
  );
  assert.deepEqual(
    await normalizeSdkLinks(f.out, f.options),
    recipe,
    "canonical restore output is accepted without broadening",
  );
});
test("nonalias SDK links are unchanged and fresh-GN alias recreation normalizes to the same recipe", async (t) => {
  const direct = await sdkLinkFixture(t, false),
    link = path.join(direct.directory, "MacOSX26.2.sdk"),
    before = await lstat(link);
  const recipe = await normalizeSdkLinks(direct.out, direct.options);
  assert.equal((await lstat(link)).ino, before.ino);
  assert.equal(
    recipe["sdk/xcode_links/MacOSX26.2.sdk"],
    await realpath(direct.sdk),
  );
  const f = await sdkLinkFixture(t),
    first = await normalizeSdkLinks(f.out, f.options),
    sdkLink = path.join(f.directory, "MacOSX.sdk");
  await unlink(sdkLink);
  await symlink(f.rawSdk, sdkLink, f.type); // Real pinned GN replaces canonical link with its raw xcrun alias.
  assert.deepEqual(await normalizeSdkLinks(f.out, f.options), first);
});
for (const scenario of [
  "wrong-physical",
  "outside-target",
  "extra-alias",
  "foreign-name",
  "regular-file",
  "alias-cycle",
  "sdk-root-replaced",
]) {
  test(`SDK normalization rejects ${scenario} before changing any other generated link`, async (t) => {
    const f = await sdkLinkFixture(t),
      sdkLink = path.join(f.directory, "MacOSX.sdk");
    if (scenario === "extra-alias")
      await symlink(f.sdk, path.join(f.directory, "MacOSX26.2.sdk"), f.type);
    else if (scenario === "foreign-name") {
      await unlink(path.join(f.directory, "MacOSX.platform"));
      await symlink(
        f.platform,
        path.join(f.directory, "other.platform"),
        f.type,
      );
    } else if (scenario === "regular-file") {
      await unlink(path.join(f.directory, "XcodeDefault.xctoolchain"));
      await writeFile(
        path.join(f.directory, "XcodeDefault.xctoolchain"),
        "not-a-link",
      );
    } else if (scenario === "alias-cycle") {
      await unlink(path.join(f.directory, "MacOSX.platform"));
      await symlink(
        path.join(f.directory, "MacOSX.platform"),
        path.join(f.directory, "MacOSX.platform"),
        f.type,
      );
    } else if (scenario === "sdk-root-replaced") {
      const other = path.join(path.dirname(f.sdk), "MacOSX99.0.sdk");
      await mkdir(other);
      await unlink(f.rawSdk);
      await symlink(other, f.rawSdk, f.type);
    } else {
      const target =
        scenario === "outside-target"
          ? path.join(f.root, "foreign")
          : path.join(path.dirname(f.sdk), "MacOSX99.0.sdk");
      await mkdir(target);
      await unlink(path.join(f.directory, "MacOSX.platform"));
      await symlink(target, path.join(f.directory, "MacOSX.platform"), f.type);
    }
    const observations = [];
    await assert.rejects(
      normalizeSdkLinks(f.out, {
        ...f.options,
        observe: (row) => observations.push(sdkLayoutRecord(row)),
      }),
    );
    const failure = observations.find((row) => row.ok === false);
    assert.equal(
      failure.reason,
      {
        "extra-alias": "entry-count",
        "foreign-name": "entry-kind-name",
        "regular-file": "entry-kind-name",
        "alias-cycle": "filesystem",
        "sdk-root-replaced": "physical-rebind",
        "wrong-physical": "raw-target",
        "outside-target": "raw-target",
      }[scenario],
    );
    assert.equal(JSON.stringify(observations).includes(f.root), false);
    assert.equal(
      await readlink(sdkLink),
      f.rawSdk,
      "all entries must validate before normalization",
    );
  });
}
test("after-GN diagnostics expose closed phases and fixed codes without raw error fields", async () => {
  const lines = [];
  const raw = Object.assign(
    new Error("secret-token https://private.example/credential"),
    { code: "ENOENT", path: "private/path" },
  );
  await assert.rejects(
    afterGnPhase(
      "sdk-links",
      () => {
        throw raw;
      },
      (line) => lines.push(line),
    ),
    (error) => error === raw,
  );
  assert.deepEqual(lines, [
    "[cef-engineering-checkpoint] after-gn phase=sdk-links",
    "[cef-engineering-checkpoint] after-gn failed phase=sdk-links code=ENOENT",
  ]);
  lines.length = 0;
  await assert.rejects(
    afterGnPhase(
      "sdk-links",
      () => {
        throw Object.assign(new Error("private"), { code: "secret\nTOKEN" });
      },
      (line) => lines.push(line),
    ),
  );
  assert.equal(
    lines.at(-1),
    "[cef-engineering-checkpoint] after-gn failed phase=sdk-links code=CHECK_FAILED",
  );
  assert.doesNotMatch(
    lines.join("\n"),
    /secret|TOKEN|private|credential|https:/,
  );
  assert.equal(
    await afterGnPhase(
      "siso-pin",
      () => 7,
      () => {},
    ),
    7,
  );
  await assert.rejects(
    afterGnPhase(
      "private/path",
      () => {},
      () => assert.fail("unreviewed stage logged"),
    ),
  );
});
test("graph inventory accepts an actual10001-target writer layout with finite file-byte-time limits", async (t) => {
  const root = await scratch(t);
  await writeFile(path.join(root, "build.ninja"), "subninja target rules");
  await writeFile(path.join(root, "args.gn"), "is_debug=false");
  for (let start = 0; start < 10001; start += 64)
    await Promise.all(
      Array.from({ length: Math.min(64, 10001 - start) }, (_, offset) =>
        writeFile(
          path.join(root, `target-${start + offset}.ninja`),
          "build target: phony\n",
        ),
      ),
    );
  const result = await graphInventory(root);
  assert.equal(result.files, 10003);
  assert.ok(result.bytes > 0);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.visited, 10003);
  assert.equal(GRAPH_LIMITS.files, 50000);
  assert.equal(GRAPH_LIMITS.bytes, 8 * 1024 ** 3);
  assert.equal(GRAPH_LIMITS.readers, 4);
  const valid = {
    files: 50000,
    bytes: GRAPH_LIMITS.bytes,
    visited: GRAPH_LIMITS.visited,
    elapsed: 179999,
  };
  assert.doesNotThrow(() => assertGraphBudget(valid));
  for (const delta of [
    { files: 50001 },
    { bytes: GRAPH_LIMITS.bytes + 1 },
    { visited: 300001 },
    { elapsed: 180000 },
  ])
    assert.throws(
      () => assertGraphBudget({ ...valid, ...delta }),
      (error) => error.code === "GRAPH_BOUND",
    );
  const lines = [];
  await assert.rejects(
    afterGnPhase(
      "graph-inventory",
      () => assertGraphBudget({ ...valid, files: 50001 }),
      (line) => lines.push(line),
    ),
  );
  assert.equal(
    lines.at(-1),
    `[cef-engineering-checkpoint] graph files=50001 bytes=${GRAPH_LIMITS.bytes} visited=300000`,
  );
});

test("actual Mac partial graph counters fit the reviewed finite budget, not the old 2GiB cap", () => {
  const observed = {
    files: 11868,
    bytes: 2147845046,
    visited: 16133,
    elapsed: 46816,
  };
  assert.ok(observed.bytes > 2 * 1024 ** 3);
  assert.doesNotThrow(() => assertGraphBudget(observed));
  assert.throws(
    () => assertGraphBudget({ ...observed, bytes: 8 * 1024 ** 3 + 1 }),
    (error) => error.code === "GRAPH_BOUND",
  );
});

async function smallGraph(t, count = 8) {
  const root = await scratch(t);
  await writeFile(path.join(root, "args.gn"), "is_debug=false");
  await writeFile(path.join(root, "build.ninja"), "subninja obj/rules.ninja\n");
  await mkdir(path.join(root, "obj"));
  await writeFile(
    path.join(root, "obj/toolchain.ninja"),
    "rule cxx\n command = clang\n",
  );
  for (let i = 0; i < count; i++)
    await writeFile(
      path.join(root, `obj/target-${i}.ninja`),
      `build target-${i}: phony\n`,
    );
  await writeFile(path.join(root, "ignored.o"), "not graph authority");
  return root;
}

// Exact historical production declaration from 8bdc3413f2d860673c8291b0dd08f3b3a95d020e.
// Self-contained for depth-one engineering checkouts; no runtime ancestor fetch.
const LEGACY_GRAPH_DECLARATION = String.raw`export async function graphInventory(
  root,
  { observe = () => {}, signal, timeoutMs = GRAPH_LIMITS.milliseconds } = {},
) {
  assert(
    Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= GRAPH_LIMITS.milliseconds,
    "Invalid graph deadline",
  );
  const began = performance.now();
  const controller = new AbortController();
  let visited = 0,
    totalBytes = 0,
    active = 0,
    peak = 0;
  const candidates = [],
    pins = [],
    pending = [root];
  const categories = Object.fromEntries(
    ["args", "build", "toolchain", "target"].map((key) => [
      key,
      { files: 0, bytes: 0 },
    ]),
  );
  const counts = () => ({
    files: candidates.length,
    bytes: totalBytes,
    visited,
  });
  const bound = () =>
    Object.assign(new Error("Graph inventory bound"), {
      code: "GRAPH_BOUND",
      graphCounts: counts(),
    });
  const stop = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const externalAbort = () => stop(bound());
  signal?.addEventListener("abort", externalAbort, { once: true });
  if (signal?.aborted) externalAbort();
  // This single timer covers metadata, hashing and cleanup. Tests may shorten
  // it; neither a caller nor a workflow can extend the reviewed upper bound.
  const timer = setTimeout(() => stop(bound()), timeoutMs);
  const check = (includeBytes = true) => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (performance.now() - began >= timeoutMs) {
      stop(bound());
      throw controller.signal.reason;
    }
    try {
      assertGraphBudget({
        ...counts(),
        bytes: includeBytes ? totalBytes : 0,
        elapsed: performance.now() - began,
      });
    } catch (error) {
      // Metadata may exceed the content-read budget while bounded enumeration
      // finishes. Any other limit still reports the actual measured bytes.
      if (error.code === "GRAPH_BOUND") error.graphCounts = counts();
      throw error;
    }
  };
  const emit = (phase) => {
    observe(
      Object.freeze({
        phase,
        ...counts(),
        active,
        elapsedMs: Math.min(
          GRAPH_LIMITS.milliseconds,
          Math.floor(performance.now() - began),
        ),
        categories: Object.freeze(
          Object.fromEntries(
            Object.entries(categories).map(([key, value]) => [
              key,
              Object.freeze({ ...value }),
            ]),
          ),
        ),
      }),
    );
  };
  const same = (a, b) =>
    a.isFile() &&
    b.isFile() &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ino === b.ino &&
    a.dev === b.dev;
  const workers = [];
  try {
    while (pending.length) {
      check(false);
      const directory = pending.pop();
      for (const item of await readdir(directory, { withFileTypes: true })) {
        visited++;
        check(false);
        // Links are not used as graph authority and will fail closed at pack time.
        if (item.isSymbolicLink()) continue;
        const file = path.join(directory, item.name);
        if (item.isDirectory()) pending.push(file);
        else if (item.name.endsWith(".ninja") || item.name === "args.gn") {
          await noLinks(file);
          check(false);
          const metadata = await stat(file);
          check(false);
          assert(
            metadata.isFile() &&
              metadata.size > 0 &&
              metadata.size <= GRAPH_LIMITS.fileBytes,
            "Checkpoint asset size",
          );
          candidates.push({ file, path: path.relative(root, file), metadata });
          totalBytes += metadata.size;
          const category =
            item.name === "args.gn"
              ? "args"
              : item.name === "build.ninja"
                ? "build"
                : item.name === "toolchain.ninja"
                  ? "toolchain"
                  : "target";
          categories[category].files++;
          categories[category].bytes += metadata.size;
          // Finish a bounded metadata inventory even when aggregate bytes are
          // over budget. No content stream is opened before the final check.
          check(false);
        }
      }
    }
    emit("metadata");
    check();
    assert(
      candidates.some((p) => p.path === "build.ninja") &&
        candidates.some((p) => p.path === "args.gn"),
      "Fresh complete GN graph required",
    );
    let next = 0;
    async function worker() {
      while (next < candidates.length) {
        check();
        const candidate = candidates[next++];
        let handle, stream;
        active++;
        try {
          if (active > peak) {
            peak = active;
            emit("hashing");
          }
          check();
          await noLinks(candidate.file);
          check();
          const before = await stat(candidate.file);
          check();
          assert(same(candidate.metadata, before), "Checkpoint asset changed");
          handle = await open(candidate.file, "r");
          check();
          assert(same(before, await handle.stat()), "Checkpoint asset changed");
          check();
          stream = handle.createReadStream({
            autoClose: false,
            signal: controller.signal,
          });
          const hash = createHash("sha256");
          for await (const block of stream) {
            check();
            hash.update(block);
          }
          assert(
            same(before, await handle.stat()) &&
              same(before, await stat(candidate.file)),
            "Checkpoint asset changed",
          );
          check();
          pins.push({
            path: candidate.path,
            name: path.basename(candidate.file),
            bytes: before.size,
            sha256: hash.digest("hex"),
          });
        } catch (error) {
          stop(error);
          throw error;
        } finally {
          try {
            if (stream) {
              stream.destroy();
              await finished(stream).catch(() => {});
            }
            await handle?.close();
          } finally {
            active--;
          }
        }
      }
    }
    for (
      let index = 0;
      index < Math.min(GRAPH_LIMITS.readers, candidates.length);
      index++
    )
      workers.push(worker());
    await Promise.all(workers);
    check();
    assert(pins.length === candidates.length, "Complete graph pins required");
    const digest = sha(
      canonical(
        pins.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      ),
    );
    check();
    emit("complete");
    check();
    return {
      files: pins.length,
      bytes: totalBytes,
      visited,
      sha256: digest,
    };
  } catch (error) {
    stop(error);
    await Promise.allSettled(workers);
    try {
      emit("stopped");
    } catch {
      /* Preserve the original inventory failure. */
    }
    throw controller.signal.reason;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", externalAbort);
  }
}`;
function historicalGraphDeclaration(raw = LEGACY_GRAPH_DECLARATION) {
  assert.equal(
    sha(Buffer.from(raw)),
    "0464fc815551a10002a2ade800c2c503a34e763187cb7e2e61b1d4841ac2af52",
    "Pinned historical graph declaration changed",
  );
  return raw;
}

async function exactGraphFunction({ old = false, overrides = {} } = {}) {
  const source = old
    ? historicalGraphDeclaration()
    : await readFile(
        new URL(
          "../../scripts/lib/cef-engineering-checkpoint.mjs",
          import.meta.url,
        ),
        "utf8",
      );
  const tree = ts.createSourceFile(
    "graph.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const node = tree.statements.find(
    (value) =>
      ts.isFunctionDeclaration(value) && value.name?.text === "graphInventory",
  );
  assert(node, "actual production graphInventory declaration");
  const body = node.getText(tree).replace(/^export\s+/, "");
  const io = await import("node:fs/promises"),
    crypto = await import("node:crypto");
  const globals = {
    assert,
    GRAPH_LIMITS,
    assertGraphBudget,
    performance,
    AbortController,
    setTimeout,
    clearTimeout,
    noLinks,
    readdir: io.readdir,
    stat: io.stat,
    open: io.open,
    path,
    createHash: crypto.createHash,
    finished,
    sha,
    canonical,
    ...overrides,
  };
  return new Function(
    ...Object.keys(globals),
    `${body};return graphInventory;`,
  )(...Object.values(globals));
}

test("historical graph declaration is SHA-bound and works with its Git ancestor absent from a real shallow repository", async (t) => {
  assert.throws(
    () =>
      historicalGraphDeclaration(
        LEGACY_GRAPH_DECLARATION.replace("const began", "const changed"),
      ),
    /Pinned historical/,
  );
  const root = await scratch(t),
    repo = path.join(root, "repo"),
    empty = path.join(root, "empty-template");
  await mkdir(repo);
  await mkdir(empty);
  const env = Object.fromEntries(
    ["SystemRoot", "WINDIR", "SystemDrive", "TEMP", "TMP", "PATH", "Path"]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    HOME: repo,
    USERPROFILE: repo,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  });
  const git = (args) =>
    execFileSync("git", ["-c", `core.hooksPath=${empty}`, ...args], {
      cwd: repo,
      env,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(["init", "--quiet", "--initial-branch=fixture", `--template=${empty}`]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture.invalid",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "own shallow fixture",
  ]);
  const head = git(["rev-parse", "HEAD"]).trim();
  await writeFile(path.join(repo, ".git/shallow"), head + "\n");
  assert.equal(git(["rev-parse", "--is-shallow-repository"]).trim(), "true");
  assert.throws(
    () =>
      git([
        "cat-file",
        "-e",
        "8bdc3413f2d860673c8291b0dd08f3b3a95d020e^{commit}",
      ]),
    { status: 128 },
  );
  const graphRoot = await smallGraph(t, 3),
    previous = process.cwd();
  try {
    process.chdir(repo);
    const old = await exactGraphFunction({ old: true });
    assert.deepEqual(await old(graphRoot), await graphInventory(graphRoot));
  } finally {
    process.chdir(previous);
  }
  t.diagnostic(
    "Actual shallow Git repository has no pinned ancestor object; exact SHA-bound old declaration and current production factory both remain executable without fetch.",
  );
});

test("four metadata admissions preserve the exact old raw graph digest and beat serial controlled latency under the same deadline", async (t) => {
  const root = await smallGraph(t, 40),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await writeFile(path.join(root, "target-π.ninja"), "build unicode: phony\n");
  const execute = async (old) => {
    let metadata = true,
      active = 0,
      peak = 0,
      calls = 0;
    const graph = await exactGraphFunction({
      old,
      overrides: {
        noLinks: async (file) => {
          calls++;
          if (!metadata) return noLinks(file);
          active++;
          peak = Math.max(peak, active);
          try {
            await delay(40);
            return await noLinks(file);
          } finally {
            active--;
          }
        },
      },
    });
    const events = [];
    let result, failure;
    try {
      result = await graph(root, {
        timeoutMs: 1200,
        observe: (value) => {
          events.push(value);
          if (value.phase === "metadata") metadata = false;
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.equal(active, 0, "every scheduled metadata admission joined");
    return { result, failure, peak, calls, events };
  };
  const old = await execute(true);
  assert.equal(old.failure.code, "GRAPH_BOUND");
  assert.equal(old.peak, 1);
  const current = await execute(false);
  assert.equal(current.failure, undefined);
  assert.equal(current.peak, 4);
  const original = await (await exactGraphFunction({ old: true }))(root);
  assert.deepEqual(current.result, original);
  const reversed = await exactGraphFunction({
    overrides: {
      readdir: async (...args) => (await readdir(...args)).reverse(),
    },
  });
  assert.deepEqual(
    await reversed(root),
    original,
    "complete canonical digest ignores traversal and admission completion order",
  );
  assert.equal(
    current.calls,
    original.files * 2,
    "every metadata and hashing noLinks guard retained",
  );
  assert.equal(current.events.at(-1).completedHashedFiles, original.files);
  assert.equal(current.events.at(-1).completedHashedBytes, original.bytes);
  t.diagnostic(
    "Controlled per-metadata latency only; not an actual Mac GN performance claim.",
  );
});

test("metadata failure and cancellation preserve first error, join every admission and open no content stream", async (t) => {
  const root = await smallGraph(t, 8);
  for (const cancelled of [false, true]) {
    const primary = new Error("owned metadata failure"),
      abort = new AbortController();
    let active = 0,
      peak = 0,
      completed = 0,
      streams = 0;
    const graph = await exactGraphFunction({
      overrides: {
        noLinks: async (file) => {
          active++;
          peak = Math.max(peak, active);
          const first = peak === 1;
          try {
            await new Promise((resolve) =>
              setTimeout(resolve, first ? 10 : 30),
            );
            if (first) {
              if (cancelled) abort.abort();
              else throw primary;
            }
            return await noLinks(file);
          } finally {
            active--;
            completed++;
          }
        },
        open: async () => {
          streams++;
          throw new Error("content must not open");
        },
      },
    });
    await assert.rejects(graph(root, { signal: abort.signal }), (error) =>
      cancelled ? error.code === "GRAPH_BOUND" : error === primary,
    );
    assert.equal(active, 0);
    assert.equal(streams, 0);
    assert(peak <= 4);
    const joined = completed;
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(completed, joined);
  }
});

test("actual deep many-file old and current inventory benchmark retains exact digest and bounded statistics", async (t) => {
  const root = await scratch(t);
  let leaf = root;
  for (let i = 0; i < 10; i++) {
    leaf = path.join(leaf, `level-${i}`);
    await mkdir(leaf);
  }
  await writeFile(path.join(root, "args.gn"), "is_debug=false");
  await writeFile(path.join(root, "build.ninja"), "subninja graph");
  for (let start = 0; start < 2000; start += 64)
    await Promise.all(
      Array.from({ length: Math.min(64, 2000 - start) }, (_, index) =>
        writeFile(
          path.join(leaf, `target-${start + index}.ninja`),
          `build target-${start + index}: phony\n`,
        ),
      ),
    );
  const oldFn = await exactGraphFunction({ old: true }),
    newFn = await exactGraphFunction();
  let began = performance.now();
  const old = await oldFn(root);
  const oldMs = performance.now() - began;
  const events = [];
  began = performance.now();
  const current = await newFn(root, { observe: (value) => events.push(value) });
  const newMs = performance.now() - began;
  assert.deepEqual(current, old);
  assert.equal(current.files, 2002);
  assert(events.length <= 36);
  for (const event of events)
    assert.doesNotThrow(() => graphInventoryRecord(event));
  t.diagnostic(
    JSON.stringify({
      actualDeepFiles: current.files,
      bytes: current.bytes,
      oldMs: Math.round(oldMs),
      newMs: Math.round(newMs),
      sameDigest: true,
      qualification:
        "owned real filesystem benchmark, not Mac GN or hosted timing proof",
    }),
  );
});

test("metadata precedes every hash, four readers are bounded, and full raw pins match legacy digest", async (t) => {
  const root = await smallGraph(t);
  const events = [];
  const actual = await graphInventory(root, {
    observe: (record) => events.push(record),
  });
  const pins = [];
  for (const relative of [
    "args.gn",
    "build.ninja",
    "obj/toolchain.ninja",
    ...Array.from({ length: 8 }, (_, i) => `obj/target-${i}.ninja`),
  ]) {
    const relativeNative = relative.split("/").join(path.sep);
    pins.push({
      path: relativeNative,
      ...(await filePin(
        path.join(root, relativeNative),
        GRAPH_LIMITS.fileBytes,
      )),
    });
  }
  assert.equal(
    actual.sha256,
    sha(
      canonical(
        pins.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      ),
    ),
  );
  assert.equal(actual.files, 11);
  assert.equal(events[0].phase, "metadata");
  assert.equal(events[0].active, 0);
  assert.deepEqual(events[0].categories, {
    args: { files: 1, bytes: Buffer.byteLength("is_debug=false") },
    build: { files: 1, bytes: Buffer.byteLength("subninja obj/rules.ninja\n") },
    toolchain: {
      files: 1,
      bytes: Buffer.byteLength("rule cxx\n command = clang\n"),
    },
    target: {
      files: 8,
      bytes: 8 * Buffer.byteLength("build target-0: phony\n"),
    },
  });
  assert.equal(Math.max(...events.map((event) => event.active)), 4);
  assert.equal(events.at(-1).phase, "complete");
  assert.equal(events.at(-1).active, 0);
  for (const record of events)
    assert.doesNotThrow(() => graphInventoryRecord(record));
});

test("metadata failure opens no graph streams and never admits a partial manifest", async (t) => {
  const root = await smallGraph(t);
  const events = [];
  await assert.rejects(
    graphInventory(root, {
      observe(record) {
        events.push(record);
        if (record.phase === "metadata") throw new Error("metadata rejected");
      },
    }),
    /metadata rejected/,
  );
  assert.ok(events.every((event) => event.active === 0));
  assert.equal(events.at(-1).phase, "stopped");
});

test("metadata-to-hash mutation is rejected before admitting a graph", async (t) => {
  const root = await smallGraph(t);
  const events = [];
  await assert.rejects(
    graphInventory(root, {
      observe(record) {
        events.push(record);
        if (record.phase === "metadata")
          writeFileSync(
            path.join(root, "build.ninja"),
            "changed graph after metadata\n",
          );
      },
    }),
    /asset changed/,
  );
  assert.equal(events.at(-1).phase, "stopped");
  assert.equal(events.at(-1).active, 0);
});

test("same-sized pathname replacement cannot reuse metadata from another inode", async (t) => {
  const root = await smallGraph(t);
  const target = path.join(root, "build.ninja");
  const contents = await readFile(target);
  const originalInode = (await lstat(target)).ino;
  await assert.rejects(
    graphInventory(root, {
      observe(record) {
        if (record.phase === "metadata") {
          renameSync(target, target + ".saved");
          writeFileSync(target, contents);
        }
      },
    }),
    /asset changed/,
  );
  assert.notEqual((await lstat(target)).ino, originalInode);
});

test("graph root aliases are rejected and linked child directories are not followed", async (t) => {
  const root = await smallGraph(t);
  const holder = await scratch(t);
  const alias = path.join(holder, "alias");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(graphInventory(alias), /links|alias/);
  const original = await graphInventory(root);
  await symlink(
    holder,
    path.join(root, "foreign"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal((await graphInventory(root)).sha256, original.sha256);
});

test("empty graph files fail metadata admission before any content reader", async (t) => {
  const root = await smallGraph(t);
  await writeFile(path.join(root, "obj/target-0.ninja"), "");
  const events = [];
  await assert.rejects(
    graphInventory(root, { observe: (record) => events.push(record) }),
    /asset size/,
  );
  assert.ok(events.every((record) => record.active === 0));
});

test("mutation during a real stream is rejected using handle and path metadata", async (t) => {
  const root = await smallGraph(t);
  const target = path.join(root, "build.ninja");
  await writeFile(target, Buffer.alloc(1024 * 1024, 65));
  const inode = (await lstat(target)).ino;
  const handle = await open(target, "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const original = prototype.createReadStream;
  let mutated = false;
  t.mock.method(prototype, "createReadStream", function (options) {
    const matches = fstatSync(this.fd).ino === inode;
    const stream = original.call(this, options);
    if (matches)
      stream.once("data", () => {
        mutated = true;
        writeFileSync(target, "mutated while hash stream was open");
      });
    return stream;
  });
  await assert.rejects(graphInventory(root), /asset changed/);
  assert.equal(mutated, true);
});

test("an early stream failure aborts and drains every reader before rejection", async (t) => {
  const root = await smallGraph(t);
  const handle = await open(path.join(root, "build.ninja"), "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const original = prototype.createReadStream;
  const streams = [],
    events = [];
  t.mock.method(prototype, "createReadStream", function (options) {
    const stream = original.call(this, options);
    streams.push(stream);
    if (streams.length === 1)
      queueMicrotask(() => stream.destroy(new Error("owned stream failure")));
    return stream;
  });
  await assert.rejects(
    graphInventory(root, { observe: (record) => events.push(record) }),
    /owned stream failure/,
  );
  assert.ok(streams.length > 0 && streams.length <= 4);
  assert.ok(streams.every((stream) => stream.destroyed && stream.closed));
  assert.equal(events.at(-1).phase, "stopped");
  assert.equal(events.at(-1).active, 0);
  const length = events.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, length, "no late background inventory work");
});

test("one absolute deadline aborts stalled readers and drains them before returning", async (t) => {
  const root = await smallGraph(t);
  const handle = await open(path.join(root, "build.ninja"), "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const streams = [],
    events = [];
  t.mock.method(prototype, "createReadStream", function (options) {
    const stream = new PassThrough();
    streams.push(stream);
    const cancel = () => stream.destroy(options.signal.reason);
    options.signal.addEventListener("abort", cancel, { once: true });
    stream.once("close", () =>
      options.signal.removeEventListener("abort", cancel),
    );
    if (options.signal.aborted) cancel();
    return stream;
  });
  await assert.rejects(
    graphInventory(root, {
      timeoutMs: 500,
      observe: (record) => events.push(record),
    }),
    (error) => error.code === "GRAPH_BOUND",
  );
  assert.equal(streams.length, 4);
  assert.ok(streams.every((stream) => stream.destroyed && stream.closed));
  assert.equal(events.at(-1).active, 0);
  assert.equal(events.at(-1).phase, "stopped");
  await assert.rejects(
    graphInventory(root, { timeoutMs: 180001 }),
    /Invalid graph deadline/,
  );
});

test("external cancellation cannot leave queued readers running", async (t) => {
  const root = await smallGraph(t);
  const abort = new AbortController(),
    events = [];
  await assert.rejects(
    graphInventory(root, {
      signal: abort.signal,
      observe(record) {
        events.push(record);
        if (record.phase === "hashing") abort.abort();
      },
    }),
    (error) => error.code === "GRAPH_BOUND",
  );
  assert.equal(events.at(-1).phase, "stopped");
  assert.equal(events.at(-1).active, 0);
});

test("synchronous final reporting cannot admit an inventory past its absolute deadline", async (t) => {
  const root = await smallGraph(t, 1);
  let completed = false;
  await assert.rejects(
    graphInventory(root, {
      timeoutMs: 500,
      observe(record) {
        if (record.phase === "complete") {
          completed = true;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
        }
      },
    }),
    (error) => error.code === "GRAPH_BOUND",
  );
  assert.equal(completed, true);
});

test("graph diagnostic schema rejects raw fields and invalid counters but permits complete over-budget totals", () => {
  const metadata = {
    phase: "metadata",
    files: 33,
    bytes: 8 * 1024 ** 3 + 1,
    visited: 33,
    active: 0,
    elapsedMs: 1,
    completedHashedFiles: 0,
    completedHashedBytes: 0,
    categories: {
      args: { files: 0, bytes: 0 },
      build: { files: 0, bytes: 0 },
      toolchain: { files: 0, bytes: 0 },
      target: { files: 33, bytes: 8 * 1024 ** 3 + 1 },
    },
  };
  assert.doesNotThrow(() => graphInventoryRecord(metadata));
  assert.throws(
    () => assertGraphBudget({ ...metadata, elapsed: 1 }),
    (error) => error.code === "GRAPH_BOUND",
  );
  for (const bad of [
    { ...metadata, rawPath: "PRIVATE" },
    { ...metadata, bytes: "123" },
    { ...metadata, active: 5 },
    { ...metadata, completedHashedFiles: 34 },
    { ...metadata, completedHashedBytes: metadata.bytes + 1 },
    { ...metadata, completedHashedBytes: -1 },
    { ...metadata, phase: "PRIVATE" },
    { ...metadata, categories: { ...metadata.categories, token: "PRIVATE" } },
  ])
    assert.throws(() => graphInventoryRecord(bad));
});

// The following exact fixture function is Copyright2014 The Chromium Authors.
// Copyright 2015 The Chromium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google LLC nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
// sdk_info.py at pinned a654841425914cbb703a2931e07b70a83aedbafd.
// Preserve the actual factory here so its raw-basename behavior is exercised,
// rather than replacing it with a model of our own guard.
const PINNED_SDK_LINK_FACTORY =
  'def CreateXcodeSymlinkAt(src, dst, root_build_dir):\n    """Create symlink to Xcode directory at target location."""\n\n    if not os.path.isdir(dst):\n        os.makedirs(dst)\n\n    dst = os.path.join(dst, os.path.basename(src))\n    updated_value = os.path.join(root_build_dir, dst)\n\n    # Update the symlink only if it is different from the current destination.\n    if os.path.islink(dst):\n        current_src = os.readlink(dst)\n        if current_src == src:\n            return updated_value\n        os.unlink(dst)\n        sys.stderr.write(\n            \'existing symlink %s points %s; want %s. Removed.\'\n            % (dst, current_src, src)\n        )\n    os.symlink(src, dst)\n    return updated_value';
const PINNED_SDK_LINK_FACTORY_SHA =
  "393274ed01a39d8ab38302d4e02b723914b7af8544d18d9bf598a2f87de392f6";

test(
  "actual pinned SDK factory aliases normalize through the production Node boundary and strict Python archive restore",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await sdkLinkFixture(t),
      helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
    assert.equal(
      sha(Buffer.from(PINNED_SDK_LINK_FACTORY)),
      PINNED_SDK_LINK_FACTORY_SHA,
    );
    for (const entry of await readdir(f.directory))
      await unlink(path.join(f.directory, entry));
    const made = python(
      "import os,sys\n" +
        PINNED_SDK_LINK_FACTORY +
        "\nfor target in sys.argv[2:]:CreateXcodeSymlinkAt(target,sys.argv[1],'//out')",
      [f.directory, f.rawSdk, f.platform, f.toolchain],
    );
    assert.equal(made.status, 0, made.stderr || made.stdout);
    assert.equal(
      await readlink(path.join(f.directory, "MacOSX.sdk")),
      f.rawSdk,
    );
    await assert.rejects(
      readlink(path.join(f.directory, "MacOSX26.2.sdk")),
      "old canonical-basename guard cannot find valid raw factory link",
    );
    const recipe = await normalizeSdkLinks(f.out, f.options),
      recipePath = path.join(f.root, "recipe.json");
    await writeFile(recipePath, canonical(recipe));
    await writeFile(path.join(f.out, "owned"), "retained-object");
    const pythonExe = python("import sys;print(sys.executable)").stdout.trim(),
      bundle = path.join(f.root, "bundle");
    const archive = await archiveCommand(pythonExe, helper, [
      "pack",
      "--input",
      f.out,
      "--output",
      bundle,
      "--generated-links",
      recipePath,
    ]);
    const envelope = path.join(f.root, "manifest.json");
    await writeFile(envelope, canonical({ ...manifest(), archive }));
    const restored = path.join(f.root, "restored");
    const result = await archiveCommand(pythonExe, helper, [
      "restore",
      "--input",
      bundle,
      "--output",
      restored,
      "--manifest",
      envelope,
      "--generated-links",
      recipePath,
    ]);
    assert.equal(result.complete, true);
    assert.equal(result.linksExtracted, false);
    assert.equal(
      await readFile(path.join(restored, "owned"), "utf8"),
      "retained-object",
    );
    for (const [relative, target] of Object.entries(recipe))
      assert.equal(await readlink(path.join(restored, relative)), target);
    assert.equal(
      await readlink(f.rawSdk),
      f.sdk,
      "installed SDK remains untouched",
    );
  },
);

test("selected SDK preflight uses actual factory argv and token-free environment before acquisition", async (t) => {
  const f = await sdkLinkFixture(t),
    commands = [],
    records = [];
  let acquired = 0;
  const selected = {
    DEVELOPER_DIR: f.options.developerDir,
    SDKROOT: f.rawSdk,
    MACOSX_DEPLOYMENT_TARGET: "14.0",
    GH_TOKEN: "secret",
    GITHUB_TOKEN: "secret",
    ACTIONS_SECRET: "secret",
  };
  await selectedSdkPreflight(
    {
      temp: f.root,
      selected,
      expectedTargets: f.options.expectedTargets,
      observe: (row) => records.push(sdkLayoutRecord(row)),
      run: async (file, args, options) => {
        commands.push([file, args]);
        assert.deepEqual(options.env, selectedSdkEnvironment(selected));
        assert.equal(options.timeout, 5000);
        assert.equal(options.maxBuffer, 4096);
        assert.equal(JSON.stringify(options).includes("secret"), false);
        return {
          stdout:
            [f.rawSdk, f.platform, f.options.developerDir][
              commands.length - 1
            ] + "\n",
        };
      },
    },
    async () => {
      acquired++;
      assert.equal(
        (await readdir(f.root)).some((name) =>
          name.startsWith("cef-checkpoint-sdk-probe-"),
        ),
        false,
      );
    },
  );
  assert.equal(acquired, 1);
  assert.deepEqual(commands, [
    ["/usr/bin/xcrun", ["-sdk", "macosx", "--show-sdk-path"]],
    ["/usr/bin/xcrun", ["-sdk", "macosx", "--show-sdk-platform-path"]],
    ["/usr/bin/xcode-select", ["-print-path"]],
  ]);
  assert(
    records.some(
      (row) =>
        row.role === "sdk" &&
        row.rawAlias === true &&
        row.physicalMatch === true,
    ),
  );
  assert.equal(JSON.stringify(records).includes(f.root), false);
  const cli = await readFile(
    path.join(ROOT, "scripts/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const compile = cli.slice(cli.indexOf('if (options.mode === "compile") {'));
  assert(
    compile.indexOf('afterGnPhase("sdk-preflight"') <
      compile.indexOf("await workspace("),
  );
  assert(
    compile.indexOf('afterGnPhase("sdk-preflight"') <
      compile.indexOf("await build("),
  );
  assert.deepEqual(argumentsFor(["probe-sdk"]), { mode: "probe-sdk" });
  assert.throws(() => argumentsFor(["probe-sdk", "--mode", "checkpoint"]));
});

for (const scenario of [
  "foreign-sdk",
  "foreign-platform",
  "foreign-toolchain",
  "relative",
  "control",
  "oversize",
  "command-failure",
]) {
  test(`selected SDK preflight rejects ${scenario} without acquisition or raw diagnostics`, async (t) => {
    const f = await sdkLinkFixture(t),
      records = [];
    const foreign = path.join(f.root, "private-token-hostname");
    await mkdir(foreign);
    let index = 0,
      acquired = false;
    await assert.rejects(
      selectedSdkPreflight(
        {
          temp: f.root,
          selected: {
            DEVELOPER_DIR: f.options.developerDir,
            SDKROOT: f.rawSdk,
            MACOSX_DEPLOYMENT_TARGET: "14.0",
          },
          expectedTargets: f.options.expectedTargets,
          observe: (row) => records.push(sdkLayoutRecord(row)),
          run: async () => {
            const values = [f.rawSdk, f.platform, f.options.developerDir];
            if (scenario.startsWith("foreign-"))
              values[
                [
                  "foreign-sdk",
                  "foreign-platform",
                  "foreign-toolchain",
                ].indexOf(scenario)
              ] = foreign;
            if (scenario === "relative") values[0] = "relative";
            if (scenario === "control") values[0] += "\nsecret";
            if (scenario === "oversize") values[0] = "/" + "s".repeat(4096);
            if (scenario === "command-failure")
              throw new Error("secret https://private.invalid/token");
            return { stdout: values[index++] + "\n" };
          },
        },
        async () => {
          acquired = true;
        },
      ),
    );
    assert.equal(acquired, false);
    assert.equal(
      (await readdir(f.root)).some((name) =>
        name.startsWith("cef-checkpoint-sdk-probe-"),
      ),
      false,
    );
    assert.equal(JSON.stringify(records).includes("private-token"), false);
    assert.equal(JSON.stringify(records).includes(f.root), false);
  });
}

test("SDK diagnostic projection drops unknown fields, labels, paths and unbounded numbers", () => {
  assert.deepEqual(
    sdkLayoutRecord({
      reason: "raw-target",
      role: "sdk",
      absolute: true,
      rawAlias: false,
      physicalMatch: true,
      count: 5,
      path: "/secret",
      error: "secret",
      token: "secret",
    }),
    {
      reason: "raw-target",
      role: "sdk",
      absolute: true,
      rawAlias: false,
      physicalMatch: true,
    },
  );
  assert.deepEqual(sdkLayoutRecord({ reason: "/secret", role: "sdk" }), {
    reason: "unavailable",
    role: "unknown",
  });
});

for (const scenario of [
  "absolute-roots",
  "sdk-containment",
  "sdk-name",
  "expected-targets",
  "raw-alias",
]) {
  test(`SDK diagnostics identify ${scenario} without weakening the check`, async (t) => {
    const f = await sdkLinkFixture(t),
      observations = [],
      options = {
        ...f.options,
        observe: (row) => observations.push(sdkLayoutRecord(row)),
      };
    if (scenario === "absolute-roots") options.sdkRoot = "relative";
    if (scenario === "sdk-containment") options.sdkRoot = f.toolchain;
    if (scenario === "sdk-name") {
      const alias = path.join(path.dirname(f.sdk), "unapproved-name");
      await symlink(f.sdk, alias, f.type);
      options.sdkRoot = alias;
    }
    if (scenario === "expected-targets") options.expectedTargets = [];
    if (scenario === "raw-alias") {
      const alias = path.join(f.root, "foreign-alias");
      await symlink(f.sdk, alias, f.type);
      await unlink(path.join(f.directory, "MacOSX.sdk"));
      await symlink(alias, path.join(f.directory, "MacOSX.sdk"), f.type);
    }
    await assert.rejects(normalizeSdkLinks(f.out, options));
    const failure = observations.find((row) => row.ok === false);
    assert.equal(
      failure.reason,
      scenario === "raw-alias" ? "raw-target" : scenario,
    );
    if (scenario === "raw-alias")
      assert.deepEqual(failure, {
        reason: "raw-target",
        role: "sdk",
        ok: false,
        absolute: true,
        rawAlias: false,
        canonical: false,
        physicalMatch: true,
      });
    assert.equal(JSON.stringify(observations).includes(f.root), false);
  });
}

test("selected SDK probe refuses recursive cleanup after its output becomes a foreign alias", async (t) => {
  const f = await sdkLinkFixture(t),
    foreign = path.join(f.root, "foreign-preserved");
  await mkdir(foreign);
  await writeFile(path.join(foreign, "marker"), "must remain");
  let owned,
    retained,
    acquired = false;
  await assert.rejects(
    selectedSdkPreflight(
      {
        temp: f.root,
        selected: {
          DEVELOPER_DIR: f.options.developerDir,
          SDKROOT: f.rawSdk,
          MACOSX_DEPLOYMENT_TARGET: "14.0",
        },
        expectedTargets: f.options.expectedTargets,
        observe: () => {},
        run: async () => {
          owned = path.join(
            f.root,
            (await readdir(f.root)).find((name) =>
              name.startsWith("cef-checkpoint-sdk-probe-"),
            ),
          );
          retained = path.join(f.root, "retained-probe");
          await rename(owned, retained);
          await symlink(foreign, owned, f.type);
          throw new Error("controlled probe failure");
        },
      },
      async () => {
        acquired = true;
      },
    ),
    /cleanup containment changed/,
  );
  assert.equal(acquired, false);
  assert.equal(
    await readFile(path.join(foreign, "marker"), "utf8"),
    "must remain",
  );
  assert((await lstat(owned)).isSymbolicLink());
  assert((await lstat(retained)).isDirectory());
  // Fixture-owned alias is explicitly unlinked only after proving cleanup denied it.
  await unlink(owned);
});

test("SDK diagnostic authority is separate from every producer command and exact default-only", async () => {
  const probeEnv = {
    ...env,
    GITHUB_WORKFLOW_REF: `owner/repo/${SDK_PROBE_WORKFLOW}@refs/heads/Main`,
  };
  assert.deepEqual(sdkProbeAuthority(probeEnv), {
    diagnosticOnly: true,
    nativeAcceptance: false,
  });
  assert.throws(
    () => sdkProbeAuthority(env),
    /Exact checkpoint workflow required/,
  );
  assert.throws(
    () => authority(probeEnv),
    /Exact checkpoint workflow required/,
  );
  for (const mode of ["compile", "download", "upload", "outcome"])
    await assert.rejects(
      main([mode], probeEnv),
      /Exact checkpoint workflow required/,
    );
  await assert.rejects(
    main(["probe-sdk"], env),
    /Exact checkpoint workflow required/,
  );
  for (const change of [
    { GITHUB_REF: "refs/heads/other" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    {
      GITHUB_WORKFLOW_REF: `foreign/repo/${SDK_PROBE_WORKFLOW}@refs/heads/Main`,
    },
    { GITHUB_SHA: "invalid" },
    { GITHUB_RUN_ID: "0" },
    { GITHUB_RUN_ATTEMPT: "bad" },
    { GITHUB_REPOSITORY_ID: "bad" },
    { GH_TOKEN: "never pass" },
    { GITHUB_TOKEN: "never pass" },
  ])
    assert.throws(() => sdkProbeAuthority({ ...probeEnv, ...change }));
  assert.deepEqual(authority(env), producer);
});

for (const scenario of [
  "unknown-name-same-physical",
  "known-name-wrong-physical",
]) {
  test(`SDK preflight attributes ${scenario} and preserves exact selected-command authority`, async (t) => {
    const f = await sdkLinkFixture(t),
      records = [];
    const reported =
      scenario === "unknown-name-same-physical"
        ? path.join(path.dirname(f.sdk), "MacOSX99.7.sdk")
        : path.join(f.root, "foreign-sdk", path.basename(f.sdk));
    if (scenario === "unknown-name-same-physical")
      await symlink(f.sdk, reported, f.type);
    else await mkdir(reported, { recursive: true });
    let index = 0,
      acquired = false;
    const preflight = selectedSdkPreflight(
      {
        temp: f.root,
        selected: {
          DEVELOPER_DIR: f.options.developerDir,
          SDKROOT: f.rawSdk,
          MACOSX_DEPLOYMENT_TARGET: "14.0",
        },
        expectedTargets: f.options.expectedTargets,
        observe: (value) => records.push(sdkLayoutRecord(value)),
        run: async () => ({
          stdout:
            [reported, f.platform, f.options.developerDir][index++] + "\n",
        }),
      },
      async () => {
        acquired = true;
      },
    );
    if (scenario === "unknown-name-same-physical") await preflight;
    else await assert.rejects(preflight);
    assert.equal(acquired, scenario === "unknown-name-same-physical");
    const sdk = records.find(
      (row) => row.reason === "probe-target" && row.role === "sdk",
    );
    assert.equal(sdk.rawAlias, false);
    assert.equal(sdk.canonical, false);
    assert.equal(sdk.physicalMatch, scenario === "unknown-name-same-physical");
    assert.equal(sdk.basenameKnown, scenario !== "unknown-name-same-physical");
    if (scenario === "unknown-name-same-physical") {
      assert.equal(sdk.reportedSdkVersion, "99.7");
      assert.equal(sdk.expectedSdkVersion, "26.2");
    }
    assert.equal(
      records.some((row) => row.ok === false || row.physicalMatch === false),
      scenario !== "unknown-name-same-physical",
    );
    assert.equal(JSON.stringify(records).includes(f.root), false);
    assert.equal(JSON.stringify(records).includes("foreign-sdk"), false);
  });
}

test("SDK pre-link diagnostics keep only numeric version components and fixed boolean facts", () => {
  assert.deepEqual(
    sdkLayoutRecord({
      reason: "probe-target",
      role: "sdk",
      basenameKnown: true,
      reportedSdkVersion: "26.2",
      expectedSdkVersion: "26.2.1",
      path: "/private-path",
    }),
    {
      reason: "probe-target",
      role: "sdk",
      basenameKnown: true,
      reportedSdkVersion: "26.2",
      expectedSdkVersion: "26.2.1",
    },
  );
  for (const invalid of [
    "/Applications/MacOSX26.2.sdk",
    "secret",
    "1.2.3.4",
    "1".repeat(17),
    "26.2\nsecret",
  ])
    assert.equal(
      sdkLayoutRecord({
        reason: "probe-target",
        role: "sdk",
        reportedSdkVersion: invalid,
      }).reportedSdkVersion,
      undefined,
    );
});

async function reverseSelectedSdk(t) {
  const f = await sdkLinkFixture(t, false, "MacOSX.sdk");
  const reported = path.join(path.dirname(f.sdk), "MacOSX26.2.sdk");
  await symlink(f.sdk, reported, f.type);
  await unlink(path.join(f.directory, "MacOSX.sdk"));
  await symlink(reported, path.join(f.directory, "MacOSX26.2.sdk"), f.type);
  let index = 0;
  const options = {
    temp: f.root,
    selected: {
      DEVELOPER_DIR: f.options.developerDir,
      SDKROOT: f.sdk,
      MACOSX_DEPLOYMENT_TARGET: "14.0",
    },
    expectedTargets: f.options.expectedTargets,
    observe: () => {},
    run: async () => ({
      stdout:
        [reported, f.platform, f.options.developerDir][index++ % 3] + "\n",
    }),
  };
  return { f, reported, options };
}

test("exact selected-command versioned reverse alias is process-attested and canonicalized", async (t) => {
  const { f, reported, options } = await reverseSelectedSdk(t);
  await assert.rejects(
    normalizeSdkLinks(f.out, f.options),
    /SDK layout check failed/,
  );
  const publicResult = await selectedSdkPreflight(options);
  assert.deepEqual(publicResult, { sdkProbe: true, nativeAcceptance: false });
  assert.equal(JSON.stringify(publicResult).includes(f.root), false);
  const aliasAttestation = await selectedSdkPreflight(
    options,
    async (token) => token,
  );
  assert.equal(JSON.stringify(aliasAttestation), "{}");
  await assert.rejects(
    normalizeSdkLinks(f.out, {
      ...f.options,
      aliasAttestation: JSON.parse(JSON.stringify(aliasAttestation)),
    }),
    /attestation required/,
  );
  const recipe = await normalizeSdkLinks(f.out, {
    ...f.options,
    aliasAttestation,
  });
  assert.equal(recipe["sdk/xcode_links/MacOSX26.2.sdk"], await realpath(f.sdk));
  assert.equal(
    await readlink(reported),
    f.sdk,
    "installed selected alias is never rewritten",
  );
  await unlink(path.join(f.directory, "MacOSX26.2.sdk"));
  await symlink(reported, path.join(f.directory, "MacOSX26.2.sdk"), f.type);
  assert.deepEqual(
    await normalizeSdkLinks(f.out, { ...f.options, aliasAttestation }),
    recipe,
    "post-GN raw regeneration uses same attestation",
  );
});

for (const scenario of [
  "alias-replaced",
  "unattested-name",
  "unattested-raw-target",
]) {
  test(`selected alias attestation denies ${scenario} before any generated-link mutation`, async (t) => {
    const { f, reported, options } = await reverseSelectedSdk(t);
    const aliasAttestation = await selectedSdkPreflight(
      options,
      async (token) => token,
    );
    const generated = path.join(f.directory, "MacOSX26.2.sdk");
    if (scenario === "alias-replaced") {
      const foreign = path.join(f.root, "foreign");
      await mkdir(foreign);
      await unlink(reported);
      await symlink(foreign, reported, f.type);
    } else {
      const other = path.join(
        f.root,
        scenario === "unattested-name" ? "MacOSX26.2.1.sdk" : "MacOSX26.2.sdk",
      );
      await symlink(f.sdk, other, f.type);
      await unlink(generated);
      await symlink(
        other,
        scenario === "unattested-name"
          ? path.join(f.directory, "MacOSX26.2.1.sdk")
          : generated,
        f.type,
      );
    }
    const names = await readdir(f.directory),
      before = await Promise.all(
        names.map(async (name) => [
          name,
          await readlink(path.join(f.directory, name)),
        ]),
      );
    await assert.rejects(
      normalizeSdkLinks(f.out, { ...f.options, aliasAttestation }),
    );
    assert.deepEqual(
      await Promise.all(
        names.map(async (name) => [
          name,
          await readlink(path.join(f.directory, name)),
        ]),
      ),
      before,
    );
  });
}

test(
  "versioned reverse alias canonical recipe survives unchanged Python pack and restore",
  { skip: process.platform === "win32" },
  async (t) => {
    const { f, options } = await reverseSelectedSdk(t);
    const aliasAttestation = await selectedSdkPreflight(
      options,
      async (token) => token,
    );
    const recipe = await normalizeSdkLinks(f.out, {
      ...f.options,
      aliasAttestation,
    });
    const recipePath = path.join(f.root, "recipe.json"),
      helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
    await writeFile(recipePath, canonical(recipe));
    await writeFile(path.join(f.out, "owned"), "retained-object");
    const pythonExe = python("import sys;print(sys.executable)").stdout.trim(),
      bundle = path.join(f.root, "bundle");
    const archive = await archiveCommand(pythonExe, helper, [
      "pack",
      "--input",
      f.out,
      "--output",
      bundle,
      "--generated-links",
      recipePath,
    ]);
    const envelope = path.join(f.root, "manifest.json"),
      restored = path.join(f.root, "restored");
    await writeFile(envelope, canonical({ ...manifest(), archive }));
    const result = await archiveCommand(pythonExe, helper, [
      "restore",
      "--input",
      bundle,
      "--output",
      restored,
      "--manifest",
      envelope,
      "--generated-links",
      recipePath,
    ]);
    assert.equal(result.complete, true);
    assert.equal(result.linksExtracted, false);
    assert.equal(
      await readFile(path.join(restored, "owned"), "utf8"),
      "retained-object",
    );
    for (const [name, target] of Object.entries(recipe))
      assert.equal(await readlink(path.join(restored, name)), target);
  },
);

test("closed Unix profiles bind ARM outputs to reviewed x64 builders and distinct native ARM acceptance", () => {
  assert.equal(checkpointProfile().source, SOURCE_ID);
  assert.equal(
    checkpointProfile().inputs,
    "native/cef-build-inputs/20261025-r5-owned-http3-macintel-sdk26-2-capture-compat",
  );
  for (const target of ["aarch64-apple-darwin", "aarch64-unknown-linux-gnu"]) {
    const p = checkpointProfile(target);
    assert.equal(p.architecture, "x64");
    assert.equal(p.acceptanceArchitecture, "arm64");
    assert.equal(p.outConfig, "Release_GN_arm64");
    assert.equal(checkpointHost(target, p.platform, "x64"), p);
    assert.throws(
      () => checkpointHost(target, p.platform, "arm64"),
      /build host/,
    );
    assert.throws(() => checkpointHost(target, "win32", "x64"), /build host/);
    assert.throws(
      () => validateIdentity({ ...identity, target, source: SOURCE_ID }),
      /source/,
    );
    assert.equal(
      typeof validateIdentity({ ...identity, target, source: p.source }),
      "string",
    );
    assert.notEqual(sdkSealName(producer, target), sdkSealName(producer));
    assert.notDeepEqual(sdkNames(target), SDK_NAMES);
    assert(Object.isFrozen(p));
  }
  assert.throws(() => checkpointProfile("aarch64-unreviewed"), /Unknown/);
});

const refreshedLinuxArmInputs =
  "native/cef-build-inputs/20261026-r5-linuxarm-cross-sysroot-external-webview-char";
const refreshedLinuxArmSource =
  "5987a2543510975afb13ec6bd158e2c3fc5f06ab9e0b96e1f5f1f6d0f55669d2";
const source23LinuxArmInputs =
  "native/cef-build-inputs/20261025-r5-linuxarm-cross-sysroot-default-colormap";
const source23LinuxArmSource =
  "ae1b288037e59fa68a14ee534a802da3fc60a806552933ce4ab73665f1a78588";
const historicalLinuxArmInputs =
  "native/cef-build-inputs/20261025-registration-retirement-linuxarm-cross-sysroot-default-colormap";
const historicalLinuxArmSource =
  "c5c9f343463480994de7b7ec8c6320a68f0f56f727d56629af5eb2599ad93e2e";
const previousLinuxArmInputs =
  "native/cef-build-inputs/20261023-registration-retirement-lf-linuxarm-cross-sysroot";

test("Linux ARM observed image rejects the old exact guard and requires the new reviewed profile", async () => {
  const target = "aarch64-unknown-linux-gnu";
  const previous = JSON.parse(
    await readFile(
      path.join(ROOT, previousLinuxArmInputs, `cef-ci-runner-${target}.json`),
      "utf8",
    ),
  );
  const observed = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    ImageOS: "ubuntu24",
    ImageVersion: "20261023.334.3",
  };
  assert.throws(
    () => assertHostedBuildIdentity(previous, target, observed, "linux", "x64"),
    /reviewed image identity changed/,
  );
  const proposed = structuredClone(previous);
  proposed.hosted.imageVersion = observed.ImageVersion;
  assert.equal(
    assertHostedBuildIdentity(proposed, target, observed, "linux", "x64")
      .crossCompiled,
    true,
  );
  for (const [environment, platform, arch] of [
    [{ ...observed, ImageVersion: "unreviewed" }, "linux", "x64"],
    [observed, "linux", "arm64"],
    [observed, "darwin", "x64"],
  ])
    assert.throws(
      () =>
        assertHostedBuildIdentity(
          proposed,
          target,
          environment,
          platform,
          arch,
        ),
      /reviewed image identity changed/,
    );
  assertHostedCapacity(
    { availableGiB: 102.38, memoryGiB: 15.61, cpus: 4 },
    proposed,
  );
  assert.throws(
    () =>
      assertHostedCapacity(
        { availableGiB: 99, memoryGiB: 15.61, cpus: 4 },
        proposed,
      ),
    /insufficient/,
  );
  assert.equal(checkpointProfile(target).inputs, refreshedLinuxArmInputs);
  assert.equal(checkpointProfile(target).source, refreshedLinuxArmSource);
});

test("historical Linux ARM image namespace retains fifteen raw payloads and four native pins while selected R5 stays exact", async () => {
  const target = "aarch64-unknown-linux-gnu",
    p = checkpointProfile(target);
  const old = path.join(ROOT, previousLinuxArmInputs),
    fresh = path.join(ROOT, historicalLinuxArmInputs);
  const previous = JSON.parse(
    await readFile(path.join(old, "source-lock.json"), "utf8"),
  );
  const review = JSON.parse(
    await readFile(path.join(fresh, "review-receipt.json"), "utf8"),
  );
  const preserved = [
    ...previous.patches.map((f) => f.path),
    previous.bridge.header.path,
    previous.builds[0].gnArgs.path,
    "normalization-receipt.json",
  ];
  assert.equal(preserved.length, 15);
  for (const file of preserved)
    assert.deepEqual(
      await readFile(path.join(fresh, file)),
      await readFile(path.join(old, file)),
    );
  const runnerFile = `cef-ci-runner-${target}.json`,
    toolFile = `tools/${target}.json`;
  const oldRunner = JSON.parse(
    await readFile(path.join(old, runnerFile), "utf8"),
  );
  const newRunner = JSON.parse(
    await readFile(path.join(fresh, runnerFile), "utf8"),
  );
  const expected = structuredClone(oldRunner);
  expected.hosted.imageVersion = "20261023.334.3";
  assert.deepEqual(newRunner, expected);
  const priorTools = JSON.parse(
    await readFile(path.join(old, toolFile), "utf8"),
  );
  const tools = JSON.parse(await readFile(path.join(fresh, toolFile), "utf8"));
  const nativePins = tools.files.filter((f) => f.path !== runnerFile);
  assert.equal(nativePins.length, 4);
  assert.deepEqual(
    nativePins,
    priorTools.files.filter((f) => f.path !== runnerFile),
  );
  assert.deepEqual(
    nativePins,
    review.actualObservedPrerequisites.exactNativeToolPins,
  );
  assert.equal(review.actualObservedPrerequisites.runId, 40123615504);
  assert.equal(review.actualObservedPrerequisites.artifact.id, 12571449269);
  assert.equal(
    review.actualObservedPrerequisites.observationTarget,
    "x86_64-unknown-linux-gnu",
  );
  assert.equal(review.nativeAcceptancePerformed, false);
  assert.equal(review.engineCompiled, false);
  assert.equal(review.publicationAllowed, false);
  assert.equal(p.acceptanceRunner, "ubuntu-24.04-arm");
  assert.equal(p.acceptanceArchitecture, "arm64");
  const reviewed = await plan({
    inputs: p.inputs,
    target,
    checkout: ROOT,
    runnerMode: "hosted",
  });
  assert.equal(
    releaseIdentity(reviewed.sourceLock, target).sourceLockSha256,
    refreshedLinuxArmSource,
  );
  const oldSource = releaseIdentity(previous, target).sourceLockSha256;
  assert.notEqual(oldSource, refreshedLinuxArmSource);
  const expectedIdentity = {
    ...identity,
    target,
    source: refreshedLinuxArmSource,
    image: "20261023.334.3",
  };
  const checkpoint = manifest();
  checkpoint.identity = expectedIdentity;
  checkpoint.identitySha256 = validateIdentity(expectedIdentity);
  assert.doesNotThrow(() =>
    validateManifest(checkpoint, checkpoint.identitySha256),
  );
  assert.throws(
    () =>
      validateManifest(
        { ...checkpoint, identity: { ...expectedIdentity, source: oldSource } },
        checkpoint.identitySha256,
      ),
    /source/,
  );
  const workflow = YAML.parse(
    await readFile(path.join(ROOT, WORKFLOW), "utf8"),
  );
  assert(
    workflow.jobs.checkpoint.concurrency.group.includes(
      refreshedLinuxArmSource,
    ),
  );
  assert(!workflow.jobs.checkpoint.concurrency.group.includes(oldSource));
  assert.equal(checkpointProfile().source, SOURCE_ID);
  assert.equal(
    checkpointProfile("aarch64-apple-darwin").source,
    "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
  );
});

test("selected Linux ARM R5 preserves reviewed configuration while requiring its new header and capability identity", async () => {
  const target = "aarch64-unknown-linux-gnu",
    profile = checkpointProfile(target),
    next = path.join(ROOT, refreshedLinuxArmInputs),
    old = path.join(ROOT, historicalLinuxArmInputs);
  const lock = validateSourceLock(
      JSON.parse(await readFile(path.join(next, "source-lock.json"), "utf8")),
    ),
    prior = validateSourceLock(
      JSON.parse(await readFile(path.join(old, "source-lock.json"), "utf8")),
    );
  assert.equal(identitySha256(lock), refreshedLinuxArmSource);
  assert.equal(identitySha256(prior), historicalLinuxArmSource);
  assert.equal(lock.bridge.patchId, "sorng-tls-v2-682c378-5");
  assert.equal(lock.bridge.capabilities.length, 9);
  assert(lock.bridge.capabilities.includes("owned-http3"));
  assert.equal(prior.bridge.patchId, "sorng-tls-v2-682c378-4");
  assert.deepEqual(lock.upstream, prior.upstream);
  assert.deepEqual(lock.builds, prior.builds);
  assert.deepEqual(lock.patches.slice(0, 12), prior.patches.slice(0, 12));
  assert.equal(lock.patches.length, 25);
  const source23 = JSON.parse(
    await readFile(
      path.join(ROOT, source23LinuxArmInputs, "source-lock.json"),
      "utf8",
    ),
  );
  assert.equal(identitySha256(source23), source23LinuxArmSource);
  assert.deepEqual(lock.patches.slice(0, 23), source23.patches);
  const common25 = JSON.parse(
    await readFile(
      path.join(
        ROOT,
        "native/cef-build-inputs/20261026-r5-owned-linux-x64-external-webview/source-lock.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(lock.patches.slice(23), common25.patches.slice(23));
  for (const file of [
    `gn/${target}.gn`,
    `tools/${target}.json`,
    `cef-ci-runner-${target}.json`,
    "normalization-receipt.json",
  ])
    assert.deepEqual(
      await readFile(path.join(next, file)),
      await readFile(path.join(old, file)),
    );
  const windows = path.join(
    ROOT,
    "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64",
  );
  for (const patch of lock.patches.slice(12, 22)) {
    const raw = await readFile(path.join(next, patch.path));
    assert.deepEqual(raw, await readFile(path.join(windows, patch.path)));
    assert.equal(sha(raw), patch.sha256);
  }
  assert.deepEqual(
    await readFile(path.join(next, lock.patches[22].path)),
    await readFile(path.join(old, prior.patches.at(-1).path)),
  );
  const header = await readFile(path.join(next, lock.bridge.header.path));
  assert.equal(header.length, 8886);
  assert.equal(
    sha(header),
    "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
  );
  assert.equal(lock.bridge.header.sha256, sha(header));
  assert(!header.includes(13));
  const review = JSON.parse(
    await readFile(path.join(next, "review-receipt.json"), "utf8"),
  );
  assert.equal(review.sourceLockIdentity, refreshedLinuxArmSource);
  assert.equal(review.predecessorIdentity, source23LinuxArmSource);
  assert.equal(review.patchCount, 25);
  // The copied normalization receipt is retained history, not a new R5 header proof.
  assert.notEqual(
    review.historicalNormalization.sourceLockIdentity,
    refreshedLinuxArmSource,
  );
  assert.equal(
    (await readdir(next, { recursive: true, withFileTypes: true })).filter(
      (entry) => entry.isFile(),
    ).length,
    32,
  );
  assert.equal(profile.acceptanceRunner, "ubuntu-24.04-arm");
  assert.equal(profile.acceptanceArchitecture, "arm64");
  assert.throws(
    () =>
      validateIdentity({
        ...identity,
        target,
        source: historicalLinuxArmSource,
      }),
    /source/,
  );
  assert.throws(
    () =>
      validateIdentity({ ...identity, target, source: source23LinuxArmSource }),
    /source/,
  );
  const workflow = YAML.parse(
    await readFile(path.join(ROOT, WORKFLOW), "utf8"),
  );
  assert(
    workflow.jobs.checkpoint.concurrency.group.includes(
      refreshedLinuxArmSource,
    ),
  );
  assert(
    !workflow.jobs.checkpoint.concurrency.group.includes(
      historicalLinuxArmSource,
    ),
  );
});

test("Linux ARM R5 rejects header and HTTP3 patch mutation before source acquisition", async (t) => {
  const root = await scratch(t),
    inputs = "inputs",
    target = "aarch64-unknown-linux-gnu";
  await cp(path.join(ROOT, refreshedLinuxArmInputs), path.join(root, inputs), {
    recursive: true,
  });
  const lock = JSON.parse(
    await readFile(path.join(root, inputs, "source-lock.json"), "utf8"),
  );
  for (const file of [lock.bridge.header.path, lock.patches[12].path]) {
    const destination = path.join(root, inputs, file),
      original = await readFile(destination);
    await writeFile(destination, Buffer.concat([original, Buffer.from("\n")]));
    await assert.rejects(
      plan({ inputs, target, checkout: root, runnerMode: "hosted" }),
      (error) => error.message === `Reviewed input mismatch: ${file}`,
    );
    await writeFile(destination, original);
  }
});

test("Linux ARM source plan rejects altered GN, runner, and toolchain raw bytes before acquisition", async (t) => {
  const root = await scratch(t),
    inputs = "inputs";
  await cp(path.join(ROOT, refreshedLinuxArmInputs), path.join(root, inputs), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  for (const file of [
    "gn/aarch64-unknown-linux-gnu.gn",
    "cef-ci-runner-aarch64-unknown-linux-gnu.json",
    "tools/aarch64-unknown-linux-gnu.json",
  ]) {
    const targetPath = path.join(root, inputs, file),
      raw = await readFile(targetPath);
    await writeFile(targetPath, Buffer.concat([raw, Buffer.from("\n")]));
    await assert.rejects(
      plan({
        inputs,
        target: "aarch64-unknown-linux-gnu",
        checkout: root,
        runnerMode: "hosted",
      }),
      /Reviewed input mismatch|pin|SHA|bytes|hash|size/i,
    );
    await writeFile(targetPath, raw);
  }
});

test("all three selected recipes validate; historical MacARM capture compatibility preserves every original payload and runner byte", async () => {
  for (const target of [
    TARGET,
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
  ]) {
    const p = checkpointProfile(target);
    const reviewed = await plan({
      inputs: p.inputs,
      target,
      checkout: ROOT,
      runnerMode: "hosted",
    });
    assert.equal(
      releaseIdentity(reviewed.sourceLock, target).sourceLockSha256,
      p.source,
    );
  }
  const old = path.join(
    ROOT,
    "native/cef-build-inputs/20261023-registration-retirement-lf-macarm-intelcross-xcode26-3-sdk26-2",
  );
  const next = path.join(
    ROOT,
    "native/cef-build-inputs/20261024-registration-retirement-lf-macarm-sdk26-2-capture-compat",
  );
  const lock = JSON.parse(
    await readFile(path.join(old, "source-lock.json"), "utf8"),
  );
  const fresh = JSON.parse(
    await readFile(path.join(next, "source-lock.json"), "utf8"),
  );
  assert.deepEqual(fresh.patches.slice(0, -1), lock.patches);
  assert.equal(fresh.patches.length, lock.patches.length + 1);
  const files = [
    ...lock.patches,
    lock.bridge.header,
    ...lock.builds.flatMap((b) => [b.gnArgs, b.toolchainLock]),
  ];
  // Header schema is an object pin, as are the build recipe pins.
  for (const row of files) {
    assert(row && typeof row.path === "string");
    assert.deepEqual(
      await readFile(path.join(next, row.path)),
      await readFile(path.join(old, row.path)),
    );
  }
  const runner = "cef-ci-runner-aarch64-apple-darwin.json";
  assert.deepEqual(
    await readFile(path.join(next, runner)),
    await readFile(path.join(old, runner)),
  );
  const patch = fresh.patches.at(-1).path;
  assert.deepEqual(
    await readFile(path.join(next, patch)),
    await readFile(
      path.join(
        ROOT,
        "native/cef-build-inputs/20261024-registration-retirement-lf-macintel-sdk26-2-capture-compat",
        patch,
      ),
    ),
  );
});

test("ARM checkpoint and SDK proofs cannot be rebound to Intel or another ARM target", () => {
  const target = "aarch64-apple-darwin",
    p = checkpointProfile(target);
  const own = { ...identity, target, source: p.source };
  const proof = createSdkCompletion({
    producer,
    identity: own,
    compile: {
      ...manifest().compile,
      outcome: "compiler-complete",
      exitCode: 0,
    },
    distributionExitCode: 0,
    checked: {
      descriptor: { target },
      identity: { sourceLockSha256: p.source },
      assets: sdkNames(target).map((name) => ({
        name,
        size: 10,
        sha256: "a".repeat(64),
      })),
    },
  });
  assert.equal(validateSdkCompletion(proof).target, target);
  assert.throws(() => validateSdkCompletion({ ...proof, target: TARGET }));
  assert.throws(() =>
    validateSdkCompletion({ ...proof, sourceLockSha256: SOURCE_ID }),
  );
  assert.throws(() =>
    validateSdkCompletion({ ...proof, bundleAssets: SDK_NAMES.map(asset) }),
  );
  const old = manifest();
  const seal = {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-seal",
    producer,
    identitySha256: old.identitySha256,
    release: {
      id: 33,
      tag: `cef-checkpoint-${TARGET}-${old.identitySha256.slice(0, 16)}-22-1`,
    },
    manifest: asset("manifest.json"),
    assets: [
      asset("manifest.json"),
      asset("inventory.json"),
      asset("checkpoint-00000.bin"),
    ].map((row, index) => ({ id: index + 1, ...row })),
  };
  assert.throws(() => validateSeal(seal, producer, target), /release mismatch/);
});

test("Linux generated links remain denied independently of first-class transport", async (t) => {
  const root = await scratch(t),
    out = path.join(root, "out"),
    foreign = path.join(root, "foreign");
  await mkdir(out);
  await mkdir(foreign);
  await symlink(foreign, path.join(out, "unexpected-sdk"), "junction");
  await assert.rejects(assertNoGeneratedLinks(out), /generated link/);
});

test("compile recipes preserve target output and platform sandbox without cross-target substitution", () => {
  for (const target of [
    TARGET,
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
  ]) {
    const p = checkpointProfile(target),
      args = [
        "/pinned/depot/autoninja.py",
        "-j",
        "4",
        "-C",
        `out/${p.outConfig}`,
        "cef",
        p.platform === "linux" ? "chrome_sandbox" : "cef_sandbox",
      ];
    assert.equal(checkpointCompileArguments(target, args), args);
    for (const [index, value] of [
      [2, "8"],
      [4, "out/Debug_GN_arm64"],
      [6, "bootstrap"],
      [5, "all"],
    ]) {
      const altered = [...args];
      altered[index] = value;
      assert.throws(
        () => checkpointCompileArguments(target, altered),
        /compile recipe/,
      );
    }
  }
});

test("manual workflow chooses only fixed cross-build hosts while seals retain the selected target", async () => {
  const yaml = await readFile(path.join(ROOT, WORKFLOW), "utf8");
  const document = YAML.parse(yaml);
  assert.deepEqual(document.on.workflow_dispatch.inputs.target.options, [
    TARGET,
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
  ]);
  assert.equal(document.on.workflow_dispatch.inputs.target.default, TARGET);
  for (const target of document.on.workflow_dispatch.inputs.target.options)
    assert(
      document.jobs.checkpoint.concurrency.group.includes(
        checkpointProfile(target).source,
      ),
    );
  assert.match(
    yaml,
    /runs-on:.*aarch64-unknown-linux-gnu.*ubuntu-24\.04.*macos-15-intel/,
  );
  assert.match(yaml, /--target "\$CEF_PROVISION_TARGET"/);
  assert.match(
    yaml,
    /checkpointProfile\(process\.env\.CEF_ENGINEERING_TARGET\)/,
  );
  assert.match(
    yaml,
    /name: cef-engineering-sdk-seal-\$\{\{ steps.profile.outputs.source \}\}-\$\{\{ inputs.target \}\}/,
  );
  assert.doesNotMatch(yaml, /continue-on-error:|restore-keys:|actions\/cache@/);
});

test("checkpoint contracts install locked dependencies before importing YAML", async () => {
  const workflow = YAML.parse(
    await readFile(path.join(ROOT, WORKFLOW), "utf8"),
  );
  const steps = workflow.jobs.checkpoint.steps;
  const install = steps.findIndex(
    (step) => step.name === "Install locked checkpoint contract dependencies",
  );
  const contracts = steps.findIndex(
    (step) =>
      step.run ===
      "node --test tests/tooling/cefEngineeringCheckpoint.node-test.mjs",
  );
  assert(install >= 0 && install < contracts);
  assert.equal(
    steps[install].run,
    "npm ci --ignore-scripts --no-audit --no-fund",
  );
  assert.equal(
    steps[contracts].name,
    "Verify checkpoint contracts on the actual native host",
  );
});

test("checkpoint provisioning enables only the existing Linux cleanup opt-in", async () => {
  const workflow = YAML.parse(
    await readFile(path.join(ROOT, WORKFLOW), "utf8"),
  );
  const step = workflow.jobs.checkpoint.steps.find(
    (entry) =>
      entry.name === "Prepare existing fixed reviewed native prerequisites",
  );
  const command =
    'node scripts/cef-hosted-provision.mjs --target "$CEF_PROVISION_TARGET" --output "$RUNNER_TEMP/cef-checkpoint-prerequisites" --execute';
  const expected = `if [ "$CEF_ENGINEERING_TARGET" = "aarch64-unknown-linux-gnu" ]; then\n  ${command} --cleanup\nelse\n  ${command}\nfi\n`;
  assert.equal(step.run, expected);
  for (const target of [
    TARGET,
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
  ]) {
    const profile = checkpointProfile(target);
    const branch =
      step.run.split("\n")[target === "aarch64-unknown-linux-gnu" ? 1 : 3];
    assert.equal(branch.includes("--cleanup"), profile.platform === "linux");
  }
  assert.equal(
    step.env.CEF_PROVISION_TARGET,
    "${{ steps.profile.outputs.provision }}",
  );
});

test("post-slice diagnostics identify fixed stages without changing the original failure", async () => {
  const { checkpointPhase } =
    await import("../../scripts/lib/cef-engineering-checkpoint.mjs");
  assert.equal(typeof checkpointPhase, "function");
  for (const phase of [
    "compile-result",
    "capacity",
    "graph-before",
    "pack",
    "graph-after",
    "manifest",
    "state",
  ]) {
    const lines = [];
    const original = Object.assign(
      new Error("private https://secret.invalid/token"),
      { code: "ENOSPC" },
    );
    await assert.rejects(
      checkpointPhase(
        phase,
        () => {
          throw original;
        },
        (line) => lines.push(line),
      ),
      (error) => error === original,
    );
    assert.deepEqual(lines, [
      `[cef-engineering-checkpoint] checkpoint stage=${phase} event=begin`,
      `[cef-engineering-checkpoint] checkpoint stage=${phase} event=failed code=ENOSPC`,
    ]);
    assert.doesNotMatch(lines.join("\n"), /private|secret|token|https:/);
  }
});

test("post-slice graph diagnostics distinguish before/after failures and preserve both immutable guards", async (t) => {
  const root = await scratch(t);
  await writeFile(path.join(root, "build.ninja"), "reviewed");
  await writeFile(path.join(root, "args.gn"), "is_debug=false");
  const digest = await graphDigest(root);
  let packs = 0;
  const lines = [];
  const log = (line) => lines.push(line);
  await writeFile(path.join(root, "build.ninja"), "changed-before");
  await assert.rejects(
    withVerifiedGraph(
      root,
      digest,
      async () => {
        packs++;
      },
      { log },
    ),
    /graph differs/,
  );
  assert.equal(packs, 0);
  const graphRecords = lines.filter((line) =>
    line.startsWith("[cef-engineering-checkpoint] checkpoint graph="),
  );
  assert.ok(graphRecords.length > 0);
  for (const line of graphRecords) {
    const record = JSON.parse(line.slice(line.indexOf("graph=") + 6));
    assert.equal(
      typeof record,
      "object",
      "graph counters must be encoded exactly once",
    );
    assert.equal(typeof record.files, "number");
    assert.equal(typeof record.bytes, "number");
  }
  assert.ok(
    lines.includes(
      "[cef-engineering-checkpoint] checkpoint stage=graph-before event=failed code=GRAPH_MISMATCH",
    ),
  );
  assert.ok(!lines.some((line) => line.includes("stage=graph-after")));
  await writeFile(path.join(root, "build.ninja"), "reviewed");
  lines.length = 0;
  await assert.rejects(
    withVerifiedGraph(
      root,
      digest,
      async () => {
        packs++;
        await writeFile(path.join(root, "build.ninja"), "changed-during");
      },
      { log },
    ),
    /graph differs/,
  );
  assert.equal(packs, 1);
  assert.ok(
    lines.includes(
      "[cef-engineering-checkpoint] checkpoint stage=graph-before event=complete",
    ),
  );
  assert.ok(
    lines.includes(
      "[cef-engineering-checkpoint] checkpoint stage=graph-after event=failed code=GRAPH_MISMATCH",
    ),
  );
  assert.doesNotMatch(
    lines.join("\n"),
    /changed-before|changed-during|reviewed|checkpoint-test-/,
  );
});

test("post-slice capacity/error observations use only closed labels and finite counts", async () => {
  const { checkpointPhase, checkpointCapacityRecord, archiveFailureRecord } =
    await import("../../scripts/lib/cef-engineering-checkpoint.mjs");
  assert.deepEqual(checkpointCapacityRecord(123, 456), {
    availableBytes: 123,
    requiredBytes: 456,
  });
  for (const value of [
    "secret",
    Infinity,
    NaN,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    {},
  ])
    assert.deepEqual(checkpointCapacityRecord(value, 456), {
      availableBytes: null,
      requiredBytes: 456,
    });
  assert.deepEqual(
    archiveFailureRecord('{"complete":false,"error":"source-changed"}', 7),
    { error: "source-changed", exitCode: 7 },
  );
  for (const output of [
    '{"complete":false,"error":"secret https://private/path"}',
    '{"complete":false,"error":"source-changed","path":"secret"}',
    '{"complete":true,"error":"source-changed"}',
    "not-json",
  ])
    assert.deepEqual(archiveFailureRecord(output, 1), {
      error: "unknown",
      exitCode: 1,
    });
  assert.deepEqual(archiveFailureRecord("x".repeat(LIMITS.seal + 1), 1), {
    error: "archive-output-bound",
    exitCode: 1,
  });
  assert.deepEqual(archiveFailureRecord("secret", null, { deadline: true }), {
    error: "archive-deadline",
    exitCode: null,
  });
  const rows = [];
  await assert.rejects(
    checkpointPhase(
      "state",
      () => {
        throw Object.assign(new Error("private"), { code: "TOKEN\nprivate" });
      },
      (line) => rows.push(line),
    ),
  );
  assert.match(rows.at(-1), /code=CHECK_FAILED$/);
  assert.doesNotMatch(rows.join("\n"), /TOKEN|private/);
  await assert.rejects(
    checkpointPhase(
      "untrusted/path",
      () => assert.fail("unexpected operation"),
      () => assert.fail("unexpected log"),
    ),
    /Closed checkpoint phase/,
  );
  assert.equal(
    await checkpointPhase(
      "manifest",
      () => 42,
      () => {
        throw Error("observer failed");
      },
    ),
    42,
  );
  const original = Error("original");
  await assert.rejects(
    checkpointPhase(
      "state",
      () => {
        throw original;
      },
      () => {
        throw Error("observer failed");
      },
    ),
    (e) => e === original,
  );
});

function archiveDeclaration(source) {
  const ast = ts.createSourceFile(
    "archive.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "archiveCommand",
  );
  assert(node);
  return node.getText(ast).replace(/^export\s+/, "");
}
function archiveFactory(declaration, spawnChild, clock = {}) {
  return new Function(
    "assert",
    "positive",
    "path",
    "spawn",
    "LIMITS",
    "archiveFailureRecord",
    "setTimeout",
    "clearTimeout",
    "performance",
    declaration.replace(/^export\s+/, "") + ";return archiveCommand;",
  )(
    assert,
    (value) => Number.isSafeInteger(value) && value > 0,
    path,
    spawnChild,
    LIMITS,
    archiveFailureRecord,
    clock.setTimeout ?? setTimeout,
    clock.clearTimeout ?? clearTimeout,
    clock.performance ?? performance,
  );
}
test("archiveCommand actual baseline overflow and timeout callbacks reproduce missing stopGroup without starting a process", async () => {
  assert.equal(sha(ARCHIVE_COMMAND_BEFORE), ARCHIVE_COMMAND_BEFORE_SHA256);
  for (const mode of ["overflow", "timeout"]) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let stops = 0,
      callback;
    const diagnostics = [];
    child.kill = () => {
      stops++;
      return true;
    };
    const old = archiveFactory(ARCHIVE_COMMAND_BEFORE, () => child, {
      setTimeout: (fn) => {
        callback = fn;
        return 1;
      },
      clearTimeout: () => {},
    });
    const pending = old("/fixed/python", "/fixed/helper", [], {
      timeout: 100,
      observeFailure: (row) => diagnostics.push(row),
    }).catch((error) => error);
    assert.throws(
      () =>
        mode === "overflow"
          ? child.stdout.emit("data", Buffer.alloc(LIMITS.seal + 1, 97))
          : callback(),
      (error) =>
        error instanceof ReferenceError && error.message.includes("stopGroup"),
    );
    child.emit("close", 1);
    assert((await pending) instanceof Error);
    assert.equal(stops, 0);
    assert.equal(diagnostics.length, 1);
    child.stdout.destroy();
    child.stderr.destroy();
  }
});
test("archiveCommand real owned leaf helpers succeed or are reaped on original timeout and byte overflow", async (t) => {
  const folder = await scratch(t),
    helper = path.join(folder, "owned-leaf.py");
  await writeFile(
    helper,
    "import sys,time,json,os\nmode=sys.argv[1]\nif mode=='success':\n print(json.dumps({'ok':True,'pid':os.getpid()}),flush=True)\nelse:\n if mode=='overflow':sys.stdout.buffer.write(b'x'*(1048576+65536));sys.stdout.buffer.flush()\n time.sleep(30)\n",
  );
  const pythonExe = python("import sys;print(sys.executable)").stdout.trim();
  const declaration = archiveDeclaration(
    await readFile(
      path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
      "utf8",
    ),
  );
  for (const mode of ["success", "timeout", "overflow"]) {
    let child,
      exited = false,
      closed = false;
    const diagnostics = [];
    const run = archiveFactory(declaration, (...args) => {
      child = spawn(...args);
      child.once("exit", () => {
        exited = true;
      });
      child.once("close", () => {
        closed = true;
      });
      return child;
    });
    const start = performance.now();
    try {
      const result = run(pythonExe, helper, [mode], {
        timeout: 2000,
        observeFailure: (row) => diagnostics.push(row),
      });
      if (mode === "success") {
        assert.equal((await result).ok, true);
        assert.deepEqual(diagnostics, []);
      } else {
        await assert.rejects(
          result,
          mode === "timeout"
            ? /Archive deadline/
            : /Checkpoint archive rejected/,
        );
        assert.equal(diagnostics.length, 1);
        assert.equal(
          diagnostics[0].error,
          mode === "timeout" ? "archive-deadline" : "archive-output-bound",
        );
        assert(!diagnostics[0].archiveCleanupUnknown);
      }
      assert(exited && closed && child.stdout.closed && child.stderr.closed);
      assert(
        performance.now() - start < 2500,
        "Owned leaf work and joins remain finite",
      );
    } finally {
      if (child && !exited) {
        const joined = new Promise((resolve) => child.once("close", resolve));
        try {
          child.kill("SIGKILL");
        } catch {}
        let cleanupTimer;
        try {
          await Promise.race([
            joined,
            new Promise((_, reject) => {
              cleanupTimer = setTimeout(
                () => reject(Error("Owned fixture cleanup unconfirmed")),
                500,
              );
            }),
          ]);
        } finally {
          clearTimeout(cleanupTimer);
        }
      }
    }
  }
});
test("archiveCommand preserves original failures and once-only diagnostics through kill and pipe-close faults", async () => {
  const declaration = archiveDeclaration(
    await readFile(
      path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
      "utf8",
    ),
  );
  for (const observer of ["normal", "throws", "rejects", "pending"]) {
    const child = new EventEmitter();
    child.pid = 123456;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const original = Error("fixed original read failure"),
      secondary = Error("fixed cleanup failure");
    let kills = 0,
      unrefs = 0;
    const rows = [];
    child.kill = () => {
      kills++;
      throw secondary;
    };
    child.unref = () => {
      unrefs++;
    };
    const close = child.stdout.destroy.bind(child.stdout);
    child.stdout.destroy = () => {
      throw secondary;
    };
    const run = archiveFactory(declaration, () => child);
    const pending = run("/fixed/python", "/fixed/helper", [], {
      timeout: 200,
      observeFailure: (row) => {
        rows.push(row);
        if (observer === "throws") throw secondary;
        if (observer === "rejects") return Promise.reject(secondary);
        if (observer === "pending") return new Promise(() => {});
      },
    });
    child.stdout.emit("error", original);
    await assert.rejects(pending, (error) => error === original);
    assert.equal(kills, 1);
    assert.equal(unrefs, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].archiveCleanupUnknown, true);
    close();
    await new Promise((resolve) => setImmediate(resolve));
  }
});
test("archiveCommand actual byte boundary, falsy first errors and decode deadline remain fail-closed", async () => {
  const declaration = archiveDeclaration(
    await readFile(
      path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
      "utf8",
    ),
  );
  const fixture = (clock = {}) => {
    const child = new EventEmitter();
    child.pid = 123456;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {};
    for (const stream of [child.stdout, child.stderr])
      stream.destroy = () => stream.emit("close");
    child.kill = () => {
      child.emit("exit", 1);
      child.emit("close", 1);
      return true;
    };
    const rows = [],
      run = archiveFactory(declaration, () => child, clock);
    const finish = () => {
      child.stdout.emit("close");
      child.stderr.emit("close");
      child.emit("exit", 0);
      child.emit("close", 0);
    };
    return { child, rows, run, finish };
  };
  const exact = fixture();
  const success = exact.run("/fixed/python", "/fixed/helper", [], {
    timeout: 1000,
  });
  exact.child.stdout.emit(
    "data",
    Buffer.from("{}" + " ".repeat(LIMITS.seal - 2)),
  );
  exact.finish();
  assert.deepEqual(await success, {});
  for (const original of [null, false, undefined]) {
    const f = fixture(),
      pending = f.run("/fixed/python", "/fixed/helper", [], {
        timeout: 1000,
        observeFailure: (row) => f.rows.push(row),
      });
    f.child.stdout.emit("error", original);
    let rejected = false,
      actual;
    try {
      await pending;
    } catch (error) {
      rejected = true;
      actual = error;
    }
    assert(rejected);
    assert.equal(actual, original);
    assert.equal(f.rows.length, 1);
    assert(!f.rows[0].archiveCleanupUnknown);
  }
  let reads = 0;
  const late = fixture({
    performance: { now: () => (++reads >= 3 ? 1001 : 0) },
  });
  const pending = late.run("/fixed/python", "/fixed/helper", [], {
    timeout: 1000,
    observeFailure: (row) => late.rows.push(row),
  });
  late.child.stdout.emit("data", Buffer.from("{}"));
  late.finish();
  await assert.rejects(pending, /Archive deadline/);
  assert.equal(late.rows[0].error, "archive-deadline");
});
test("actual archive child retains a whitelisted failure reason without exposing helper stderr or unknown fields", async (t) => {
  const root = await scratch(t),
    helper = path.join(root, "failing-helper.py");
  const pythonExe = python("import sys;print(sys.executable)").stdout.trim();
  const run = async (output) => {
    await writeFile(
      helper,
      `import sys\nprint(${JSON.stringify(JSON.stringify(output))})\nprint('secret https://private.invalid/password',file=sys.stderr)\nsys.exit(7)\n`,
    );
    const rows = [];
    await assert.rejects(
      archiveCommand(pythonExe, helper, [], {
        observeFailure: (row) => rows.push(row),
      }),
      /Checkpoint archive rejected/,
    );
    assert.equal(rows.length, 1);
    return rows;
  };
  assert.deepEqual(
    await run({ complete: false, error: "unreviewed-generated-link" }),
    [{ error: "unreviewed-generated-link", exitCode: 7 }],
  );
  assert.deepEqual(
    await run({
      complete: false,
      error: "secret https://private.invalid/password",
    }),
    [{ error: "unknown", exitCode: 7 }],
  );
  await assert.rejects(
    archiveCommand(pythonExe, helper, [], {
      observeFailure: () => {
        throw Error("observer-secret");
      },
    }),
    /Checkpoint archive rejected/,
  );
});

test("production CLI wires each post-slice boundary and pack failure observer without changing the native recipe", async () => {
  const source = await readFile(
    path.join(ROOT, "scripts/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const compile = source.slice(
    source.indexOf("async compile(context)"),
    source.indexOf("if (result.sdkCompletion)"),
  );
  for (const stage of [
    "compile-result",
    "capacity",
    "pack",
    "manifest",
    "state",
  ])
    assert.ok(compile.includes(`checkpointPhase("${stage}"`));
  assert.ok(
    compile.indexOf('checkpointPhase("compile-result"') <
      compile.indexOf('checkpointPhase("capacity"'),
  );
  assert.ok(
    compile.indexOf('checkpointPhase("pack"') <
      compile.indexOf('checkpointPhase("manifest"'),
  );
  assert.ok(
    compile.indexOf('checkpointPhase("manifest"') <
      compile.indexOf('checkpointPhase("state"'),
  );
  assert.match(compile, /observeFailure:/);
  assert.match(compile, /LIMITS\.compressed \+ 2 \* 1024 \*\* 3/);
  assert.match(compile, /withVerifiedGraph\(out, identity\.graph/);
  assert.match(compile, /const compile = await checkpointPhase/);
  assert.match(compile, /out: context\.checkpoint\.out/);
  const guarded = compile.slice(
    compile.indexOf("const archive = await withVerifiedGraph("),
    compile.indexOf("const manifest ="),
  );
  const positions = [
    /async \(\) => \{/,
    /await observeThenRemoveSisoLog\(\s*out,\s*context\.logs,\s*compile,/,
    /await attestFrameworkLinks\(out\)/,
    /checkpointPhase\("pack"/,
  ].map((pattern) => {
    const found = pattern.exec(guarded);
    assert.ok(found, String(pattern));
    return found.index;
  });
  for (let i = 1; i < positions.length; i++)
    assert.ok(positions[i - 1] < positions[i]);
  assert.doesNotMatch(guarded, /JSON\.parse|\.\.\.compile/);
  const helper = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const observer = helper.slice(
    helper.indexOf("export async function observeThenRemoveSisoLog"),
    helper.indexOf("export async function removeQuiescentSisoLog"),
  );
  assert.ok(
    observer.indexOf("await observe(out, logs)") <
      observer.indexOf("dependencies.remove ?? removeQuiescentSisoLog"),
  );
});

test("post-slice link diagnostic preserves real rejected outside, loop and junction evidence without following", async (t) => {
  const root = await scratch(t),
    out = path.join(root, "out"),
    logs = path.join(root, "logs"),
    outside = path.join(root, "outside");
  await mkdir(out);
  await mkdir(logs);
  await mkdir(outside);
  await writeFile(
    path.join(outside, "must-not-visit"),
    "private outside bytes",
  );
  await writeFile(path.join(out, "args.gn"), 'target_cpu="arm64"\n');
  // Models a real same-owner build action after GN, not an accepted checkpoint.
  await symlink(
    outside,
    path.join(out, "outside-dir"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await symlink(
    process.platform === "win32" ? out : "loop",
    path.join(out, "loop"),
    process.platform === "win32" ? "junction" : "file",
  );
  const record = await generatedLinkInventory(out);
  assert.equal(record.complete, true);
  assert.equal(record.authority, false);
  assert.equal(record.visited, 3);
  assert.equal(
    record.links.find((r) => r.member === "outside-dir").classification,
    "absolute",
  );
  assert.equal(
    record.links.some((r) => r.member.includes("must-not-visit")),
    false,
  );
  const original = await readlink(path.join(out, "outside-dir"));
  assert.equal(
    record.links.find((r) => r.member === "outside-dir").target,
    original,
  );
  assert.deepEqual(await persistGeneratedLinkInventory(out, logs), {
    persisted: true,
    complete: true,
  });
  assert.deepEqual(
    JSON.parse(
      await readFile(
        path.join(logs, "post-slice-generated-links.json"),
        "utf8",
      ),
    ),
    record,
  );
  assert.deepEqual(await persistGeneratedLinkInventory(out, logs), {
    persisted: false,
    complete: false,
  });
  const helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py");
  const packed = python(
    "import runpy,sys;m=runpy.run_path(sys.argv[1]);\ntry:m['pack'](m['Path'](sys.argv[2]),m['Path'](sys.argv[3]))\nexcept m['CheckpointError'] as e: print(str(e));sys.exit(7)",
    [helper, out, path.join(root, "pack")],
  );
  assert.equal(packed.status, 7, packed.stderr);
  assert.equal(
    packed.stdout.trim(),
    process.platform === "win32" ? "input-link" : "unreviewed-generated-link",
  );
  assert.equal(await readlink(path.join(out, "outside-dir")), original);
});

test("post-slice link diagnostic bounds traversal, link count, target and escaped output", async (t) => {
  const parent = await scratch(t);
  // Hosted Windows workspaces also have an ancestor named "a" (D:\a).
  const root = path.join(parent, "a", "out");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "a"), "a");
  await writeFile(path.join(root, "b"), "b");
  assert.equal(
    (await generatedLinkInventory(root, { limits: { entries: 1 } })).failure,
    "entry-bound",
  );
  const fakeLink = {
    isSymbolicLink: () => true,
    isDirectory: () => false,
    dev: 1,
    ino: 1,
    mode: 1,
    mtimeMs: 1,
  };
  const linked = {
    lstat: async (file) =>
      file === path.join(root, "a") || file === path.join(root, "b")
        ? fakeLink
        : lstat(file),
    readlink: async () => '../outside\n"secret-shaped-target"',
  };
  const escaped = await generatedLinkInventory(root, { io: linked });
  assert.equal(escaped.complete, true, canonical(escaped));
  assert.equal(
    JSON.parse(canonical(escaped)).links[0].target,
    '../outside\n"secret-shaped-target"',
  );
  assert.equal(
    (await generatedLinkInventory(root, { io: linked, limits: { links: 1 } }))
      .failure,
    "link-bound",
  );
  const oversized = await generatedLinkInventory(root, {
    io: linked,
    limits: { targetBytes: 2 },
  });
  assert.equal(oversized.failure, "target-bound");
  assert.equal(oversized.complete, false);
  assert.equal(oversized.links[0].target, null);
  const huge = { ...linked, readlink: async () => "x".repeat(1800) };
  const output = await generatedLinkInventory(root, {
    io: huge,
    limits: { outputBytes: 2048 },
  });
  assert.equal(output.failure, "output-bound");
  assert.ok(Buffer.byteLength(canonical(output)) < 2048);
  assert.ok(LINK_DIAGNOSTIC_LIMITS.entries <= 300000);
  assert.equal(LINK_DIAGNOSTIC_LIMITS.milliseconds, 180000);
});

test("post-slice link diagnostic closes own directory on denial and hung read deadline with fixed errors", async (t) => {
  const root = await scratch(t);
  await writeFile(path.join(root, "a"), "a");
  const denied = await generatedLinkInventory(root, {
    io: {
      readlink: async () => {
        throw new Error("raw-secret");
      },
      lstat: async (file) => {
        if (file === path.join(root, "a"))
          throw Object.assign(new Error("raw-secret"), { code: "EACCES" });
        return lstat(file);
      },
    },
  });
  assert.equal(denied.failure, "access-denied");
  assert.equal(canonical(denied).includes("raw-secret"), false);
  let closed = 0,
    pending = true,
    settleRead;
  const result = await generatedLinkInventory(root, {
    limits: { milliseconds: 20 },
    io: {
      opendir: async () => ({
        read: () =>
          new Promise((resolve) => {
            settleRead = () => {
              pending = false;
              resolve(null);
            };
          }),
        close: async () => {
          if (pending)
            throw Object.assign(new Error("concurrent read"), {
              code: "ERR_DIR_CONCURRENT_OPERATION",
            });
          closed++;
        },
      }),
    },
  });
  assert.equal(result.failure, "deadline");
  assert.equal(result.complete, false);
  assert.equal(closed, 0);
  settleRead();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1); // No double-close after late read completion.
  assert.equal(result.deadlineScope, "collection-observation");
  assert.equal(result.filesystemCallsCancellable, false);
});

test("post-slice link diagnostic closes late opendir handles and rejects undersized fixed envelopes", async (t) => {
  const root = await scratch(t);
  let settleOpen,
    closed = 0;
  const result = await generatedLinkInventory(root, {
    limits: { milliseconds: 20 },
    io: {
      opendir: () =>
        new Promise((resolve) => {
          settleOpen = () =>
            resolve({
              close: async () => {
                closed++;
              },
            });
        }),
    },
  });
  assert.equal(result.failure, "deadline");
  assert.equal(closed, 0);
  settleOpen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  await assert.rejects(
    generatedLinkInventory(root, { limits: { outputBytes: 1 } }),
    /error-envelope capacity/,
  );
  const minimum = await generatedLinkInventory(root, {
    limits: { outputBytes: 512 },
    io: {
      lstat: async () => {
        throw new Error("raw-private-error");
      },
    },
  });
  assert.equal(minimum.failure, "io-error");
  assert.ok(Buffer.byteLength(canonical(minimum)) <= 512);
});

test("post-slice link diagnostic denies root aliases and changed directory identities", async (t) => {
  const root = await scratch(t),
    alias = path.join(root, "alias"),
    target = path.join(root, "target");
  await mkdir(target);
  await symlink(
    target,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (await generatedLinkInventory(alias)).failure,
    "root-link-or-type",
  );
  let opened = false;
  const changed = await generatedLinkInventory(target, {
    io: {
      opendir: async (...args) => {
        const { opendir } = await import("node:fs/promises");
        const dir = await opendir(...args);
        opened = true;
        return dir;
      },
      lstat: async (file) => {
        const value = await lstat(file);
        if (opened && file === target)
          Object.defineProperty(value, "ino", {
            value: value.ino === 0 ? 1 : 0,
          });
        return value;
      },
    },
  });
  assert.equal(changed.failure, "directory-changed");
});

const LINUX_GCS_SUM =
  "c7176a4c7aacbf46bda58a029f39f79a68008d3dee6518f154dcf5161a5486d8";
const LINUX_GCS_DECLARATION = `  'src/build/linux/debian_bullseye_arm64-sysroot': {
    'bucket': 'chrome-linux-sysroot',
    'condition': 'checkout_linux and checkout_arm64 and non_git_source',
    'dep_type': 'gcs',
    'objects': [
      {
        'generation': 1770327978874031,
        'object_name': '${LINUX_GCS_SUM}',
        'sha256sum': '${LINUX_GCS_SUM}',
        'size_bytes': 18420984,
      },
    ],
  },`;
async function linuxGcsFixture(t, archive) {
  const root = await scratch(t),
    out = path.join(root, "out"),
    sysroot = path.join(root, "build/linux/debian_bullseye_arm64-sysroot");
  await mkdir(out);
  await mkdir(path.join(root, "build/linux/sysroot_scripts"), {
    recursive: true,
  });
  await mkdir(sysroot);
  await mkdir(path.join(root, "third_party/gperf/cipd/bin"), {
    recursive: true,
  });
  const metadata = {
    bullseye_arm64: {
      Sha256Sum: LINUX_GCS_SUM,
      SysrootDir: path.basename(sysroot),
      URL: "https://commondatastorage.googleapis.com/chrome-linux-sysroot",
      Tarball: "debian_bullseye_arm64_sysroot.tar.xz",
    },
  };
  await writeFile(
    path.join(root, "build/linux/sysroot_scripts/sysroots.json"),
    JSON.stringify(metadata),
  );
  await writeFile(
    path.join(root, "DEPS"),
    LINUX_GCS_DECLARATION +
      "\ninfra/3pp/tools/gperf/${{platform}} version:3@3.2\n",
  );
  await writeFile(
    path.join(sysroot, `.${LINUX_GCS_SUM}_hash`),
    LINUX_GCS_SUM + "\n",
  );
  await writeFile(
    path.join(sysroot, `.${LINUX_GCS_SUM}_is_first_class_gcs`),
    "1\n",
  );
  await writeFile(
    path.join(root, "third_party/gperf/cipd/bin/gperf"),
    "synthetic host tool observation; never executed",
  );
  if (archive)
    await cp(archive, path.join(sysroot, `.${LINUX_GCS_SUM}`), {
      errorOnExist: true,
      force: false,
    });
  return { root, out, sysroot, metadata };
}
test(
  "Linux ARM actual reviewed first-class archive is admitted without a legacy stamp",
  { skip: !process.env.CEF_TEST_REVIEWED_SYSROOT_ARCHIVE },
  async (t) => {
    const { root, out, sysroot } = await linuxGcsFixture(
      t,
      process.env.CEF_TEST_REVIEWED_SYSROOT_ARCHIVE,
    );
    const recipe = await linuxArmRecipe(root, out);
    assert.equal(recipe.sysrootSha256, LINUX_GCS_SUM);
    assert.equal(recipe.sysrootTransport, "first-class-gcs");
    assert.equal(recipe.sysrootArchive.bytes, 18420984);
    assert.equal(recipe.sysrootArchive.sha256, LINUX_GCS_SUM);
    assert.deepEqual(recipe.generatedLinks, {});
    const gperf = path.join(root, "third_party/gperf/cipd/bin/gperf");
    await unlink(gperf);
    await assert.rejects(
      linuxArmRecipe(root, out),
      (e) => e.code === "ENOENT" && e.linuxDependencyRole === "gperf",
    );
    await writeFile(gperf, "synthetic host tool; not executed");
    const archive = await open(path.join(sysroot, `.${LINUX_GCS_SUM}`), "r+");
    try {
      await archive.write(Buffer.from("!"), 0, 1, 0);
    } finally {
      await archive.close();
    }
    await assert.rejects(
      linuxArmRecipe(root, out),
      (e) =>
        e.linuxDependencyRole === "gcs-archive" &&
        /archive pin/.test(e.message),
    );
  },
);

test("Linux ARM pure first-class contract accepts simulated exact observations and rejects changed source or pins", async (t) => {
  const { root, metadata } = await linuxGcsFixture(t),
    deps = await readFile(path.join(root, "DEPS"), "utf8");
  assert.equal(linuxArmGcsDeclaration(metadata, deps).sha256, LINUX_GCS_SUM);
  const simulated = {
    name: `.${LINUX_GCS_SUM}`,
    bytes: 18420984,
    sha256: LINUX_GCS_SUM,
  };
  assert.deepEqual(linuxArmGcsArchive(simulated), simulated); // Simulated metadata, no claim of a real archive.
  for (const mutate of [
    (m) => (m.bullseye_arm64.Sha256Sum = "0".repeat(64)),
    (m) => (m.bullseye_arm64.SysrootDir = "host-libc"),
    (m) => (m.bullseye_arm64.URL = "https://private.invalid"),
    (m) => (m.bullseye_arm64.Tarball = "different.tar"),
  ]) {
    const m = structuredClone(metadata);
    mutate(m);
    assert.throws(() => linuxArmGcsDeclaration(m, deps), /sysroot recipe/);
  }
  for (const bad of [
    deps.replace("1770327978874031", "1770327978874032"),
    deps.replace("18420984", "18420985"),
    deps.replace("'chrome-linux-sysroot'", "'host-libc'"),
    deps.replace(
      "checkout_linux and checkout_arm64 and non_git_source",
      "checkout_linux",
    ),
    deps.replaceAll(LINUX_GCS_SUM, "0".repeat(64)),
    deps + "\n" + LINUX_GCS_DECLARATION,
  ])
    assert.throws(
      () => linuxArmGcsDeclaration(metadata, bad),
      /first-class GCS/,
    );
  for (const bad of [
    { ...simulated, bytes: 18420985 },
    { ...simulated, sha256: "0".repeat(64) },
    { ...simulated, name: ".different" },
  ])
    assert.throws(() => linuxArmGcsArchive(bad), /archive pin/);
});
test("Linux ARM actual filesystem evidence denies missing/changed/link markers and never falls back to legacy stamp", async (t) => {
  const { root, out, sysroot } = await linuxGcsFixture(t),
    hashFile = path.join(sysroot, `.${LINUX_GCS_SUM}_hash`),
    toggle = path.join(sysroot, `.${LINUX_GCS_SUM}_is_first_class_gcs`);
  // All real marker reads pass, but no archive exists. No simulated production reader.
  await assert.rejects(
    linuxArmRecipe(root, out),
    (e) => e.code === "ENOENT" && e.linuxDependencyRole === "gcs-archive",
  );
  await unlink(hashFile);
  await writeFile(
    path.join(sysroot, ".stamp"),
    `https://commondatastorage.googleapis.com/chrome-linux-sysroot/${LINUX_GCS_SUM}`,
  );
  await assert.rejects(
    linuxArmRecipe(root, out),
    (e) => e.code === "ENOENT" && e.linuxDependencyRole === "gcs-hash-marker",
  );
  for (const value of [LINUX_GCS_SUM, LINUX_GCS_SUM + "\r\n", "wrong\n"]) {
    await writeFile(hashFile, value);
    await assert.rejects(
      linuxArmRecipe(root, out),
      (e) => e.linuxDependencyRole === "gcs-hash-marker",
    );
  }
  await writeFile(hashFile, LINUX_GCS_SUM + "\n");
  for (const value of ["0\n", "1", "1\r\n"]) {
    await writeFile(toggle, value);
    await assert.rejects(
      linuxArmRecipe(root, out),
      (e) => e.linuxDependencyRole === "gcs-toggle",
    );
  }
  await writeFile(toggle, "1\n");
  await unlink(hashFile);
  const foreign = path.join(root, "foreign-marker");
  if (process.platform === "win32") await mkdir(foreign);
  else await writeFile(foreign, LINUX_GCS_SUM + "\n");
  await symlink(
    foreign,
    hashFile,
    process.platform === "win32" ? "junction" : "file",
  );
  await assert.rejects(
    linuxArmRecipe(root, out),
    (e) => e.linuxDependencyRole === "gcs-hash-marker",
  );
});
test("Linux dependency role diagnostics are fixed and never emit paths, messages, or unrecognized roles", async () => {
  for (const role of [
    "gcs-hash-marker",
    "gcs-archive",
    "private/token https://secret.invalid",
  ]) {
    const lines = [];
    const error = Object.assign(new Error("secret credential /home/private"), {
      code: "ENOENT",
      linuxDependencyRole: role,
    });
    await assert.rejects(
      afterGnPhase(
        "sdk-roots",
        () => {
          throw error;
        },
        (line) => lines.push(line),
      ),
      (e) => e === error,
    );
    assert.equal(lines.length, role.startsWith("gcs-") ? 3 : 2);
    if (role.startsWith("gcs-"))
      assert.equal(
        lines[2],
        `[cef-engineering-checkpoint] linux-dependency role=${role}`,
      );
    assert.doesNotMatch(
      lines.join("\n"),
      /secret|credential|private|https:|home/,
    );
  }
});

test("pre-rejection Siso observation survives the original guard error and reports only closed reasons", async () => {
  const order = [];
  const messages = [];
  const original = new Error("Siso log PID not observed");
  await assert.rejects(
    observeThenRemoveSisoLog(
      "out",
      "logs",
      {},
      { log: (line) => messages.push(line) },
      {
        observe: async () => {
          order.push("observe");
          return { persisted: true, complete: true };
        },
        remove: async () => {
          order.push("guard");
          throw original;
        },
      },
    ),
    (error) => error === original,
  );
  assert.deepEqual(order, ["observe", "guard"]);
  assert.ok(messages.every((line) => !line.includes("must-not-log")));
  assert.ok(messages.some((line) => line.includes("SISO_PID_UNOBSERVED")));
  const privateError = new Error("private absolute path/token");
  await assert.rejects(
    observeThenRemoveSisoLog(
      "out",
      "logs",
      {},
      {
        log: () => {
          throw privateError;
        },
      },
      {
        observe: async () => {
          throw privateError;
        },
        remove: async () => {
          throw original;
        },
      },
    ),
    (error) => error === original,
  );
});

test("Mac supplemental compiler identity participates in fresh checkpoint identity before restore", async () => {
  const source = await readFile(
    new URL("../../scripts/cef-engineering-checkpoint.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /supplementalMetal: macMetalFingerprint\(context\.metal\)/,
  );
  assert.ok(
    source.indexOf("macMetalFingerprint(context.metal)") <
      source.indexOf('afterGnPhase("restore"'),
  );
  assert.match(
    source,
    /await observeThenRemoveSisoLog\(\s*out,\s*context\.logs,\s*compile,/,
  );
  const currentIdentity = { ...identity, tools: "a".repeat(64) };
  const altered = { ...currentIdentity, tools: "b".repeat(64) };
  assert.notEqual(validateIdentity(currentIdentity), validateIdentity(altered));
  const prior = manifest();
  const drifted = manifest();
  drifted.identity.tools = altered.tools;
  drifted.identitySha256 = validateIdentity(drifted.identity);
  assert.throws(
    () => validateManifest(drifted, prior.identitySha256),
    /identity mismatch/,
  );
});

test("actual checkpoint download pipeline handles repeated disk backpressure without listener growth", async (t) => {
  const root = await scratch(t);
  const chunk = Buffer.alloc(65536, 42);
  const expected = Buffer.concat(Array.from({ length: 32 }, () => chunk));
  const warnings = [];
  const warning = (value) => warnings.push(value);
  process.on("warning", warning);
  t.after(() => process.removeListener("warning", warning));
  let destination;
  let drains = 0;
  const counts = [];
  let sourceClosed = false;
  const source = Readable.from(
    (async function* () {
      try {
        for (let i = 0; i < 32; i++) yield chunk;
      } finally {
        sourceClosed = true;
      }
    })(),
  );
  await downloadAsset(
    "owner/repo",
    "private-token",
    "/releases/assets/44",
    path.join(root, "asset"),
    { bytes: expected.length, sha256: sha(expected) },
    {
      request: async () => ({ ok: true, status: 200, body: source }),
      createOutput(file, options) {
        destination = createWriteStream(file, { ...options, highWaterMark: 1 });
        destination.on("drain", () => {
          drains++;
          counts.push(destination.listenerCount("error"));
        });
        return destination;
      },
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(drains > 10, `observed ${drains} drains`);
  assert.equal(
    new Set(counts).size,
    1,
    "error listener count must stay constant across drains",
  );
  assert.ok(Math.max(...counts) <= 5);
  assert.ok(
    warnings.every((value) => value.name !== "MaxListenersExceededWarning"),
  );
  assert.ok(sourceClosed && source.destroyed && destination.closed);
  t.diagnostic(
    `drains=${drains}; errorListenerMin=${Math.min(...counts)}; errorListenerMax=${Math.max(...counts)}; maxListenerWarnings=${warnings.filter((value) => value.name === "MaxListenersExceededWarning").length}; sourceClosed=${sourceClosed}; destinationClosed=${destination.closed}`,
  );
  assert.deepEqual(await readFile(path.join(root, "asset")), expected);
});

test("early real destination failure cancels and closes source promptly without token or signed URL leak", async (t) => {
  const root = await scratch(t);
  let cancelled = false;
  let output;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(Buffer.alloc(65536));
    },
    cancel() {
      cancelled = true;
    },
  });
  const begin = performance.now();
  await assert.rejects(
    downloadAsset(
      "owner/repo",
      "private-token",
      "/releases/assets/44",
      root,
      { bytes: 1024 ** 3, sha256: "a".repeat(64) },
      {
        deadline: Date.now() + 2000,
        request: async () => ({ ok: true, status: 200, body }),
        createOutput(file, options) {
          output = createWriteStream(file, options);
          return output;
        },
      },
    ),
    (error) =>
      !error.message.includes("private-token") &&
      !error.message.includes("signature="),
  );
  assert.ok(performance.now() - begin < 1800);
  assert.ok(cancelled && output.closed);
  t.diagnostic(
    `writeFailureElapsedMs=${Math.round(performance.now() - begin)}; sourceCancelled=${cancelled}; destinationClosed=${output.closed}`,
  );
  assert.equal(body.locked, false);
});

async function dependencyLifecycleFixture(t) {
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "cef-contract-retire-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const checkout = path.join(scratch, "checkout"),
    temp = path.join(scratch, "temp");
  await mkdir(checkout);
  await mkdir(temp);
  const root = path.join(temp, "cef-checkpoint-contract-dependencies");
  await mkdir(root, { mode: 0o700 });
  const workflow = YAML.parse(
    await readFile(path.join(ROOT, WORKFLOW), "utf8"),
  );
  const steps = workflow.jobs.checkpoint.steps;
  const body = steps.find(
    (s) =>
      s.name ===
      "Create exclusive task-private contract dependency ownership records",
  ).run;
  const source = body.split("<<'NODE'\n")[1].split("\nNODE\n")[0] + "\n";
  const file = path.join(root, "lifecycle.mjs");
  await writeFile(file, source);
  const module = await import(
    (await import("node:url")).pathToFileURL(file).href
  );
  const env = { GITHUB_WORKSPACE: checkout, RUNNER_TEMP: temp };
  return { scratch, checkout, temp, root, file, module, env, steps, source };
}
async function installDependencyFixture(f) {
  await f.module.prepare(f.env);
  await mkdir(path.join(f.checkout, "node_modules"));
  await writeFile(path.join(f.checkout, "node_modules", "fixture"), "owned");
  await f.module.capture(f.env);
}
test("contract retirement removes only installed own roots and never follows nested bin links", async (t) => {
  const f = await dependencyLifecycleFixture(t);
  await installDependencyFixture(f);
  const outside = path.join(f.scratch, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "sentinel"), "preserved");
  await symlink(
    outside,
    path.join(f.checkout, "node_modules", ".bin"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await f.module.retire(f.env);
  await assert.rejects(lstat(path.join(f.checkout, "node_modules")), {
    code: "ENOENT",
  });
  await assert.rejects(lstat(path.join(f.root, "cache")), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(outside, "sentinel"), "utf8"),
    "preserved",
  );
  const receipt = JSON.parse(
    await readFile(path.join(f.root, "retired.json"), "utf8"),
  );
  assert.equal(receipt.complete, true);
  assert.equal(receipt.capacityAdmitted, false);
  assert.match(receipt.freeBeforeBytes, /^\d+$/);
  assert.match(receipt.freeAfterBytes, /^\d+$/);
});
test("dependency ownership denies preexisting modules, replaced roots and foreign cache links", async (t) => {
  const pre = await dependencyLifecycleFixture(t);
  await mkdir(path.join(pre.checkout, "node_modules"));
  await assert.rejects(pre.module.prepare(pre.env));
  const f = await dependencyLifecycleFixture(t);
  await installDependencyFixture(f);
  const modules = path.join(f.checkout, "node_modules");
  await rename(modules, path.join(f.checkout, "saved-modules"));
  await mkdir(modules);
  await assert.rejects(f.module.retire(f.env));
  await writeFile(path.join(modules, "foreign"), "preserved");
  assert.equal(
    await readFile(path.join(modules, "foreign"), "utf8"),
    "preserved",
  );
  const c = await dependencyLifecycleFixture(t);
  await installDependencyFixture(c);
  const outside = path.join(c.scratch, "foreign-cache");
  await mkdir(outside);
  await writeFile(path.join(outside, "sentinel"), "preserved");
  await rename(path.join(c.root, "cache"), path.join(c.root, "saved-cache"));
  await symlink(
    outside,
    path.join(c.root, "cache"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(c.module.clean(c.env));
  assert.equal(
    await readFile(path.join(outside, "sentinel"), "utf8"),
    "preserved",
  );
  assert((await lstat(path.join(c.checkout, "node_modules"))).isDirectory());
});
test("cleanup timeout kills its exact child and waits for close before rejecting", async (t) => {
  const f = await dependencyLifecycleFixture(t);
  let child;
  await assert.rejects(
    f.module.superviseCleanup(
      () => {
        child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
          stdio: "ignore",
          windowsHide: true,
        });
        return child;
      },
      { milliseconds: 30, reapMilliseconds: 5000 },
    ),
    /DEPENDENCY_CLEANUP_DEADLINE/,
  );
  assert(
    child.exitCode !== null || child.signalCode !== null,
    "owned child has terminal status",
  );
});
test("workflow gates ownership retirement on full successful contracts and keeps original admission", async (t) => {
  const f = await dependencyLifecycleFixture(t),
    steps = f.steps;
  const index = (name) => steps.findIndex((s) => s.name === name);
  const install = index("Install locked checkpoint contract dependencies"),
    capture = index(
      "Attest only the dependency tree created by this locked install",
    );
  const contracts = index(
      "Verify checkpoint contracts on the actual native host",
    ),
    retire = index(
      "Retire only task-owned dependencies after every contract passes",
    );
  assert(
    install < capture &&
      capture < contracts &&
      contracts < retire &&
      retire < index("Download exact independently sealed prior checkpoint"),
  );
  assert.equal(
    steps[install].run,
    "npm ci --ignore-scripts --no-audit --no-fund",
  );
  assert.equal(
    steps[install].env.npm_config_cache,
    "${{ runner.temp }}/cef-checkpoint-contract-dependencies/cache",
  );
  assert.equal(
    steps[contracts].run,
    "node --test tests/tooling/cefEngineeringCheckpoint.node-test.mjs",
  );
  assert.equal(steps[contracts].timeout_minutes, undefined);
  assert.equal(steps[contracts]["timeout-minutes"], 5);
  assert.equal(steps[retire].if, undefined);
  assert.equal(steps[retire]["continue-on-error"], undefined);
  assert.equal(
    YAML.parse(await readFile(path.join(ROOT, WORKFLOW), "utf8")).jobs
      .checkpoint["timeout-minutes"],
    300,
  );
  assert.doesNotMatch(
    f.source,
    /sudo|process\.env\.(?:GH_TOKEN|GITHUB_TOKEN)|process\.kill\(/,
  );
});
function producerSpecifiers(text) {
  const source = ts.createSourceFile(
      "producer.mjs",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    result = [];
  function visit(node) {
    let specifier;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      assert(ts.isStringLiteral(node.moduleSpecifier));
      specifier = node.moduleSpecifier.text;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      assert.equal(node.arguments.length, 1);
      assert(
        ts.isStringLiteral(node.arguments[0]),
        "Computed producer import forbidden",
      );
      specifier = node.arguments[0].text;
    }
    if (specifier) {
      assert(
        specifier.startsWith("node:") ||
          specifier.startsWith("./") ||
          specifier.startsWith("../"),
        "Bare producer dependency forbidden",
      );
      if (!specifier.startsWith("node:")) result.push(specifier);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["require", "createRequire"].includes(node.expression.text)
    )
      assert.fail("Producer require forbidden");
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
test("actual eleven-module producer imports without dependencies and rejects bare or computed dependency drift", async (t) => {
  assert.throws(
    () => producerSpecifiers('import YAML from "yaml";'),
    /Bare producer/,
  );
  assert.throws(
    () => producerSpecifiers("await import(process.env.MODULE);"),
    /Computed producer/,
  );
  const scratch = await realpath(
    await mkdtemp(path.join(tmpdir(), "cef-producer-no-deps-")),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const pending = ["scripts/cef-engineering-checkpoint.mjs"],
    seen = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    assert(relative.startsWith("scripts/") && !relative.includes(".."));
    seen.add(relative);
    const source = await readFile(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(
      source,
      /\b(?:npm|npx)\b/,
      "producer must not request dependency installation after retirement",
    );
    for (const specifier of producerSpecifiers(source))
      pending.push(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(relative), specifier),
        ),
      );
    const target = path.join(scratch, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  assert.equal(seen.size, 11);
  assert(seen.has("scripts/lib/cef-mac-source-metadata.mjs"));
  await mkdir(path.join(scratch, "native"));
  await cp(
    path.join(ROOT, "native/cef-hosted-recipe.json"),
    path.join(scratch, "native/cef-hosted-recipe.json"),
  );
  await assert.rejects(lstat(path.join(scratch, "node_modules")), {
    code: "ENOENT",
  });
  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'await import("./scripts/cef-engineering-checkpoint.mjs")',
    ],
    {
      cwd: scratch,
      env: {},
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
});

test("dependency retirement denies replaced checkout or temp parents even when child inodes survive", async (t) => {
  for (const parent of ["checkout", "temp"]) {
    const f = await dependencyLifecycleFixture(t);
    await installDependencyFixture(f);
    const modules = path.join(f.checkout, "node_modules"),
      before = await lstat(modules, { bigint: true });
    const old = f[parent],
      saved = path.join(f.scratch, `saved-${parent}`);
    await rename(old, saved);
    await mkdir(old);
    if (parent === "checkout")
      await rename(path.join(saved, "node_modules"), modules);
    else
      await rename(
        path.join(saved, "cef-checkpoint-contract-dependencies"),
        f.root,
      );
    const after = await lstat(modules, { bigint: true });
    assert.equal(after.ino, before.ino);
    assert.equal(after.dev, before.dev);
    await assert.rejects(f.module.retire(f.env));
    assert.equal(
      await readFile(path.join(modules, "fixture"), "utf8"),
      "owned",
    );
    assert((await lstat(path.join(f.root, "cache"))).isDirectory());
  }
});
test("post-spawn cleanup errors retain first error and join the exact child before rejection", async (t) => {
  const f = await dependencyLifecycleFixture(t),
    { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 123;
  let kills = 0,
    closed = false,
    settled = false;
  const original = new Error("original-owned-error"),
    killError = new Error("failed-kill-observation");
  child.kill = () => {
    kills++;
    child.emit("error", killError);
    setTimeout(() => {
      closed = true;
      child.emit("close", null, "SIGKILL");
    }, 40);
    return false;
  };
  const result = f.module.superviseCleanup(
    () => {
      setImmediate(() => child.emit("error", original));
      return child;
    },
    { milliseconds: 100, reapMilliseconds: 100 },
  );
  const observed = result.then(
    () => {
      settled = true;
    },
    (error) => {
      settled = true;
      throw error;
    },
  );
  const assertion = assert.rejects(observed, (error) => error === original);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(settled, false);
  assert.equal(closed, false);
  await assertion;
  assert.equal(closed, true);
  assert.equal(kills, 1);
});
test("cleanup spawn failure has no kill while unjoined post-spawn failure is explicitly bounded", async (t) => {
  const f = await dependencyLifecycleFixture(t),
    { EventEmitter } = await import("node:events");
  const failed = new EventEmitter(),
    spawnError = new Error("spawn-failed");
  let kills = 0;
  failed.kill = () => {
    kills++;
  };
  await assert.rejects(
    f.module.superviseCleanup(
      () => {
        setImmediate(() => failed.emit("error", spawnError));
        return failed;
      },
      { milliseconds: 20, reapMilliseconds: 30 },
    ),
    (error) => error === spawnError,
  );
  assert.equal(kills, 0);
  const live = new EventEmitter(),
    original = new Error("live-error");
  live.pid = 456;
  live.kill = () => {
    kills++;
    return false;
  };
  const began = performance.now();
  await assert.rejects(
    f.module.superviseCleanup(
      () => {
        setImmediate(() => live.emit("error", original));
        return live;
      },
      { milliseconds: 20, reapMilliseconds: 30 },
    ),
    (error) =>
      error.message === "DEPENDENCY_CLEANUP_REAP_UNCONFIRMED" &&
      error.cause === original,
  );
  assert.equal(kills, 1);
  assert(performance.now() - began < 1000, "bounded failed-join observation");
});

test("pinned glog identity shortens first host dot and maps username Unicode code points exactly", () => {
  assert.equal(
    sisoLoggerIdentity("Host.domain.example", "User-name.é😀").prefix,
    "siso.Host.User_name___.log.INFO.",
  );
  assert.equal(
    sisoLoggerIdentity("Host", "User09").prefix,
    "siso.Host.User09.log.INFO.",
  );
  assert.equal(
    sisoLoggerIdentity("Host.domain", "User09").hostWasShortened,
    true,
  );
  assert.equal(sisoLoggerIdentity("Host", "User09").userWasSanitized, false);
  assert.notEqual(
    sisoLoggerIdentity("Host.domain", "u-ser").prefix,
    "siso.Host.domain.u-ser.log.INFO.",
  );
  for (const invalid of [
    "",
    ".domain",
    "a/b",
    "a\\b",
    "a\n",
    "a\0",
    "x".repeat(1025),
    "\ud800",
  ])
    assert.throws(
      () => sisoLoggerIdentity(invalid, "user"),
      /Siso OS identity/,
    );
  for (const invalid of ["", "a/b", "a\0", "\ud800"])
    assert.throws(
      () => sisoLoggerIdentity("host", invalid),
      /Siso OS identity/,
    );
});

test("exact Siso cleanup body uses proven logger identity and preserves all alias guards", async () => {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "removeQuiescentSisoLog",
  );
  const original = manifest().compile;
  const now = Date.UTC(2026, 9, 25, 0, 0, 0);
  const root = { dev: 1n, ino: 2n, uid: 10n, mode: 0o700n };
  const link = {
    dev: 1n,
    ino: 3n,
    uid: 10n,
    mode: 0o777n,
    nlink: 1n,
    isSymbolicLink: () => true,
  };
  const prefix = "siso.Host.User_name___.log.INFO.";
  let raw = "/tmp/" + prefix + "20261025-000000.123456",
    quiet = true,
    exists = true,
    unlinked = 0;
  const proof = {
    canonicalOut: "/out",
    groupId: original.groupId,
    observed: original.observed,
    beginWallMs: now,
    endWallMs: now + 999,
    outIdentity: root,
    uid: 10n,
    loggerIdentity: sisoLoggerIdentity("Host.domain", "User-name.é😀"),
  };
  const dependencies = {
    assert,
    validateCompile: (value) => assert.deepEqual(value, original),
    liveCompileSlices: new WeakMap([[original, proof]]),
    sameObservedCohort,
    noLinks: async (value) => value,
    observedQuiet: async () => quiet,
    lstat: async (value) => (value === "/out" ? root : link),
    path: path.posix,
    optionalLinkStat: async () => (exists ? link : null),
    readlink: async () => raw,
    tmpdir: () => "/tmp",
    realpath: async (value) => value,
    checkpointLog: (sink, record) => {
      try {
        sink(record);
      } catch {}
    },
    sha,
    sameLinkIdentity: (a, b) => a === b,
    unlink: async (value) => {
      assert.equal(value, "/out/siso.INFO");
      exists = false;
      unlinked++;
    },
  };
  const execute = new Function(
    ...Object.keys(dependencies),
    "return (" + declaration.getText(ast).replace(/^export /, "") + ")",
  )(...Object.values(dependencies));
  const messages = [];
  for (const filename of [
    "siso.Host.domain.User-name.é😀.log.INFO.20261025-000000.123456",
    "siso.Other.User_name___.log.INFO.20261025-000000.123456",
    prefix + "20261025-000000.1",
    prefix + "20000101-000000.123456",
  ]) {
    raw = "/tmp/" + filename;
    await assert.rejects(
      execute("/out", original, {
        observeIdentity: (row) => messages.push(row),
      }),
    );
    assert.equal(unlinked, 0);
    assert.equal(exists, true);
  }
  raw = "/tmp/" + prefix + "20261025-000000.123456";
  await assert.rejects(
    execute("/out", JSON.parse(JSON.stringify(original))),
    /Genuine in-process/,
  );
  quiet = false;
  await assert.rejects(execute("/out", original), /quiescent/);
  quiet = true;
  const result = await execute("/out", original, {
    observeIdentity: () => {
      throw Error("private token");
    },
  });
  assert.equal(result.removed, true);
  assert.equal(unlinked, 1);
  assert.ok(messages.some((row) => row.prefixMatched === false));
  assert.ok(
    messages.every(
      (row) =>
        row.contract === "siso-glog-1.2.5" &&
        !JSON.stringify(row).includes("Host"),
    ),
  );
  assert.match(
    source,
    /liveCompileSlices.set\(result, \{\s*loggerIdentity,\s*uid: BigInt\(owner.uid\)/,
  );
});

test("diagnostic logger rejection or pending promise cannot replace or hold an operation", async () => {
  const reason = new Error("private token and URL");
  checkpointLog(() => Promise.reject(reason), "fixed");
  checkpointLog(() => new Promise(() => {}), "fixed");
  checkpointLog(
    () => ({
      get then() {
        throw reason;
      },
    }),
    "fixed",
  );
  await new Promise((resolve) => setImmediate(resolve));
});

test("upload diagnostic observer is closed, bounded and does not forward hostile fields", async () => {
  const records = [],
    observe = createUploadObserver((record) => records.push(record));
  for (let i = 0; i < 200; i++)
    observe({
      stage: "https://signed.invalid/secret",
      event: "raw body",
      errorCode: "Bearer SECRET",
      httpStatus: 999,
      token: "SECRET",
    });
  assert.equal(records.length, 128);
  assert.ok(Buffer.byteLength(JSON.stringify(records)) < 64 * 1024);
  assert.ok(
    records.every(
      (row) =>
        JSON.stringify(Object.keys(row)) ===
        JSON.stringify(["kind", "stage", "event", "errorCode", "httpStatus"]),
    ),
  );
  assert.ok(
    records.every(
      (row) =>
        row.stage === "upload" &&
        row.event === "failed" &&
        row.errorCode === "UNAVAILABLE" &&
        row.httpStatus === null,
    ),
  );
  assert.doesNotMatch(JSON.stringify(records), /SECRET|signed|raw body/);
  assert.equal(createUploadObserver(observe), observe);
  for (const sink of [
    () => {
      throw Error("secret");
    },
    () => Promise.reject(Error("secret")),
    () => new Promise(() => {}),
  ]) {
    const original = Error("https://signed.invalid/secret");
    await assert.rejects(
      uploadPhase(createUploadObserver(sink), "state-read", () => {
        throw original;
      }),
      (error) => error === original,
    );
    const value = { same: true };
    assert.equal(
      await uploadPhase(createUploadObserver(sink), "seal-write", () => value),
      value,
    );
  }
});

test("upload API retains closed stages and HTTP status without provider bodies or credentials", async () => {
  for (const status of [401, 403, 422, 500]) {
    const records = [],
      calls = [],
      observer = createUploadObserver((row) => records.push(row));
    const api = apiClient(
      "owner/repo",
      "SECRET",
      async (url, options) => {
        calls.push({ url, options });
        return new Response("signed URL and SECRET", { status });
      },
      { observer },
    );
    await assert.rejects(
      api("releases", { method: "POST", body: {} }),
      /Checkpoint GitHub operation failed/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, "error");
    assert.ok(
      records.some(
        (row) =>
          row.stage === "draft-create" &&
          row.event === "response" &&
          row.httpStatus === status &&
          row.errorCode === "HTTP",
      ),
    );
    assert.ok(
      records.some(
        (row) =>
          row.event === "failed" &&
          row.errorCode === "HTTP" &&
          row.httpStatus === status,
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(records),
      /SECRET|signed|https:|owner|repo/,
    );
  }
});

test("upload API distinguishes success decode failure and transport error while preserving original errors", async () => {
  const records = [],
    observer = createUploadObserver((row) => records.push(row));
  const api = apiClient(
    "owner/repo",
    "SECRET",
    async () => new Response('{"ok":true}', { status: 201 }),
    { observer },
  );
  assert.deepEqual(await api("releases", { method: "POST", body: {} }), {
    ok: true,
  });
  assert.ok(
    records.some((row) => row.event === "response" && row.httpStatus === 201),
  );
  const malformed = apiClient(
    "owner/repo",
    "SECRET",
    async () => new Response("SECRET signed", { status: 200 }),
    { observer },
  );
  await assert.rejects(malformed(""), SyntaxError);
  assert.ok(records.some((row) => row.errorCode === "JSON"));
  const original = Error("token=SECRET https://signed.invalid");
  const failed = apiClient(
    "owner/repo",
    "SECRET",
    async () => {
      throw original;
    },
    { observer },
  );
  await assert.rejects(
    failed("git/commits/" + "a".repeat(40)),
    (error) => error === original,
  );
  assert.ok(
    records.some(
      (row) =>
        row.stage === "source-commit" &&
        row.event === "failed" &&
        row.errorCode === "UNAVAILABLE",
    ),
  );
  assert.doesNotMatch(JSON.stringify(records), /SECRET|signed|https:|token/);
});

test("upload credential and endpoint refusals are observed before any request with unchanged guard", async () => {
  const records = [],
    observer = createUploadObserver((row) => records.push(row));
  let requests = 0;
  const request = async () => {
    requests++;
    throw Error("must not request");
  };
  assert.throws(
    () => apiClient("owner/repo", "", request, { observer }),
    /Scoped GitHub credential required/,
  );
  assert.ok(
    records.some(
      (row) => row.stage === "credential" && row.errorCode === "CREDENTIAL",
    ),
  );
  const api = apiClient("owner/repo", "SECRET", request, { observer });
  await assert.rejects(
    api("https://foreign.invalid/SECRET"),
    /Closed same-repository/,
  );
  await assert.rejects(
    api("releases/1/assets?name=other", {
      method: "POST",
      upload: true,
      bodyBytes: 10,
    }),
    /Closed same-repository/,
  );
  assert.equal(requests, 0);
  assert.ok(records.some((row) => row.errorCode === "ENDPOINT"));
  assert.doesNotMatch(JSON.stringify(records), /SECRET|foreign/);
});

test("each closed upload preflight records begin and original failure with fixed guard codes", async () => {
  for (const [stage, message, code] of [
    ["producer-validation", "Current producer mismatch", "PRODUCER"],
    [
      "code-validation",
      "Producer code differs from sealed checkpoint",
      "CODE_DIGEST",
    ],
    ["quiescence", "Compiler group no longer quiescent", "QUIESCENCE"],
    ["asset-verification", "Changed upload asset", "ASSET_CHANGED"],
    ["manifest-generation", "Manifest bound", "MANIFEST_BOUND"],
    [
      "response-validation",
      "Uploaded checkpoint asset mismatch",
      "ASSET_RESPONSE",
    ],
    ["seal-write", "Seal size bound", "SEAL_BOUND"],
  ]) {
    const records = [],
      original = Error(message);
    await assert.rejects(
      uploadPhase(
        createUploadObserver((row) => records.push(row)),
        stage,
        () => {
          throw original;
        },
      ),
      (error) => error === original,
    );
    assert.deepEqual(
      records.map((row) => [row.stage, row.event, row.errorCode]),
      [
        [stage, "begin", "NONE"],
        [stage, "failed", code],
      ],
    );
  }
  const records = [];
  let called = false;
  await assert.rejects(
    uploadCheckpoint(
      () => {
        called = true;
      },
      {
        bundle: "unused",
        manifest: {},
        producer,
        observer: createUploadObserver((row) => records.push(row)),
      },
    ),
  );
  assert.equal(called, false);
  assert.deepEqual(
    records.map((row) => [row.stage, row.event]),
    [
      ["upload", "begin"],
      ["state-validation", "begin"],
      ["state-validation", "failed"],
      ["upload", "failed"],
    ],
  );
});

test("CLI upload logs a bounded closed failure before state reads without exposing private environment", async () => {
  const lines = [],
    original = console.error;
  console.error = (line) => lines.push(line);
  try {
    await assert.rejects(
      main(["upload"], {
        CEF_ENGINEERING_TARGET: "SECRET=https://signed.invalid",
      }),
    );
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 2);
  const records = lines.map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map((row) => row.event),
    ["begin", "failed"],
  );
  assert.doesNotMatch(JSON.stringify(records), /SECRET|signed|https:/);
});

test("upload diagnostics reserve a bounded final slot for a failure after a record flood", () => {
  const records = [],
    observe = createUploadObserver((row) => records.push(row));
  for (let i = 0; i < 500; i++)
    observe({ stage: "chunk-upload", event: "complete", errorCode: "NONE" });
  assert.equal(records.length, 127);
  observe({ stage: "seal-write", event: "failed", errorCode: "ENOSPC" });
  assert.equal(records.length, 128);
  assert.equal(records.at(-1).stage, "seal-write");
  assert.equal(records.at(-1).errorCode, "ENOSPC");
});

test("observability preserves every existing API uploader and CLI policy assertion", async () => {
  // AST signatures frozen from reviewed pre-observer concern05eb; requires no Git history in shallow CI.
  const expected = {
    apiClient:
      "34e962b7da0e36b9afb729a450945ccbfe4f9981fb9a5a328b8ac5380f40b434",
    uploadCheckpoint:
      "f9040f0177001c7e11445f28df50649cbbdd208c1214f97e716c6d8241c0e6d3",
    uploadSdkBundle:
      "74b41d0214b40611d0fe4936458a07d3feadce5e56571f7daed056d46d87140f",
    main: "877950163b8bf9fd175e59d687814ab10d3057945f912659caa0f9db97e8ea91",
  };
  const signature = (source, name) => {
    const ast = ts.createSourceFile(
      "source.mjs",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const fn = ast.statements.find(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
    );
    const rows = [],
      sourceMetadataGuards = [],
      macSourceGuards = [];
    const serialize = (node) => {
      const kids = node
        .getChildren(ast)
        .filter((n) => n.kind !== ts.SyntaxKind.CommaToken);
      return kids.length
        ? [node.kind, ...kids.map(serialize)]
        : [node.kind, node.getText(ast)];
    };
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ["assert", "fail"].includes(n.expression.getText(ast))
      ) {
        const message = n.arguments[1]?.text;
        if (
          name === "checkpointMain" &&
          [
            "Fixed source bytecode policy",
            "Source metadata original host deadline",
          ].includes(message)
        ) {
          sourceMetadataGuards.push([
            message,
            n.arguments[0].getText(ast).replace(/\s+/g, ""),
          ]);
        } else if (
          name === "checkpointMain" &&
          [
            "Mac external owned output alias",
            "Mac external original host deadline",
            "Mac metadata original host deadline",
            "Mac external fingerprint unchanged before source metadata",
          ].includes(message)
        ) {
          macSourceGuards.push([
            message,
            n.arguments[0]
              .getText(ast)
              .replace(/\s+/g, "")
              .replace(/,\)/g, ")"),
          ]);
        } else rows.push(n.arguments.map(serialize));
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    if (name === "checkpointMain") {
      assert.deepEqual(sourceMetadataGuards, [
        [
          "Fixed source bytecode policy",
          'context.env.PYTHONDONTWRITEBYTECODE==="1"&&context.env.PYTHONPYCACHEPREFIX===undefined&&context.env.SOURCE_DATE_EPOCH===SOURCE_METADATA_DATE_EPOCH',
        ],
        ["Source metadata original host deadline", "timeout>0"],
      ]);
      assert.deepEqual(macSourceGuards, [
        ["Mac external owned output alias", "(awaitrealpath(output))===output"],
        ["Mac external original host deadline", "timeout>=1000"],
        ["Mac external original host deadline", "hostRemaining(env)>0"],
        ["Mac metadata original host deadline", "hostRemaining(env)>0"],
        [
          "Mac external fingerprint unchanged before source metadata",
          "canonical(macExternalToolsBinding({},fresh))===canonical(macExternalToolsBinding({},context.macExternalInputs))",
        ],
      ]);
    }
    return sha(JSON.stringify(rows));
  };
  const helper = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const cli = await readFile(
    new URL("../../scripts/cef-engineering-checkpoint.mjs", import.meta.url),
    "utf8",
  );
  for (const name of ["apiClient", "uploadCheckpoint", "uploadSdkBundle"])
    assert.equal(signature(helper, name), expected[name]);
  assert.equal(signature(cli, "checkpointMain"), expected.main);
});

test("response diagnostic getters cannot replace the original API result or add guard reads", async () => {
  const records = [];
  let reads = 0;
  const result = {
    get status() {
      throw Error("private status");
    },
    get ok() {
      reads++;
      return true;
    },
  };
  const api = apiClient("owner/repo", "SECRET", async () => result, {
    observer: createUploadObserver((row) => records.push(row)),
  });
  assert.equal(await api("", { raw: true }), result);
  assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify(records), /private|SECRET/);
});

async function compileSupervisorModel(options = {}) {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = (name) =>
    ast.statements
      .find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      )
      .getText(ast)
      .replace(/^export /, "");
  let clockOffset = 0;
  const clock = { now: () => performance.now() + clockOffset };
  const within = new Function(
    "assert",
    "performance",
    "return (" + body("compileWithin") + ")",
  )(assert, clock);
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 100,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const sentinel = Object.hasOwn(options, "error")
    ? options.error
    : Error("fixed injected primary fault");
  const state = {
    snapshots: 0,
    stops: 0,
    kills: 0,
    unrefs: 0,
    proofs: 0,
    writes: [],
    signals: [],
    streams: [],
    primary: sentinel,
    forwarded: [],
  };
  const close = (code = null) => {
    child.exitCode = code;
    child.emit("exit", code);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  };
  child.kill = () => {
    state.kills++;
    child.signalCode = "SIGKILL";
    child.emit("exit", null, "SIGKILL");
    if (!options.holdPipes) close();
    return true;
  };
  child.unref = () => state.unrefs++;
  const root = { pid: 100, parent: 200, start: "Sat Oct 24 00:00:00 2026" };
  const dependencies = {
    assert,
    process: {
      platform: "darwin",
      pid: 200,
      kill: () => assert.fail("no global signals"),
    },
    positive: (n) => Number.isSafeInteger(n) && n > 0,
    LIMITS: { compileMs: 20, maxCompileMs: 1000 },
    COMPILE_CLEANUP_MS: 80,
    performance: clock,
    userInfo: () => ({ uid: 10, username: "Model" }),
    hostname: () => "model.host",
    sisoLoggerIdentity,
    compileMonitorDetails,
    compileMonitorGuard: (ok, message, code) => {
      try {
        assert(ok, message);
      } catch (error) {
        throw compileMonitorRecord(error, code);
      }
    },
    compileWithin: within,
    checkpointLog: (sink, line) => (state.diagnostic = line),
    console: { error: () => {} },
    noLinks: async (value) => value,
    lstat: async () => ({ isDirectory: () => true }),
    path,
    Transform,
    createWriteStream: () => {
      const stream = new Writable({
        write(data, encoding, done) {
          state.forwarded.push(Buffer.from(data));
          if (!options.stalledWriter) done();
        },
      });
      state.streams.push(stream);
      return stream;
    },
    spawn: () => {
      if (options.chunks)
        setTimeout(() => {
          for (const [channel, data] of options.chunks)
            child[channel].write(data);
        }, 3);
      if (options.cleanExit) setTimeout(() => close(0), 8);
      if (options.naturalExit)
        setTimeout(() => {
          child.exitCode = 0;
          child.emit("exit", 0);
        }, 5);
      if (options.streamError)
        setTimeout(() => state.streams[0].emit("error", sentinel), 5);
      return child;
    },
    finished: options.neverFinished ? () => new Promise(() => {}) : finished,
    processSnapshot: async () => {
      state.snapshots++;
      if (options.neverSnapshot) return new Promise(() => {});
      if (options.badOwner) return [];
      if (options.monitorError && state.snapshots > 1) throw sentinel;
      return [root];
    },
    observedLineage: (_, owned) => owned,
    stopObserved: async (_, owned) => {
      state.stops++;
      if (options.stopError) throw sentinel;
      child.kill("SIGKILL");
      return owned;
    },
    observedQuiet: async () =>
      options.naturalExit ? state.stops > 0 : options.stopError ? false : true,
    writeFile: async (file, data) => state.writes.push({ file, data }),
    canonical,
    liveCompileSlices: { set: () => state.proofs++ },
    setTimeout: (callback, ms, ...args) =>
      setTimeout(
        () => {
          if (options.delayedTimer && ms !== 250) clockOffset = 200;
          callback(...args);
        },
        ms === 250 ? 10 : ms,
      ),
    clearTimeout,
  };
  const execute = new Function(
    ...Object.keys(dependencies),
    "return (" + body("compileSlice") + ")",
  )(...Object.values(dependencies));
  const began = performance.now();
  let result, error, modelAlarm;
  const run = execute("synthetic", [], {
    cwd: "/fake",
    env: {},
    logs: "/fake",
    milliseconds: 20,
    ...(options.outputLedger === undefined
      ? {}
      : { outputLedger: options.outputLedger }),
    ...(options.observeRoot === undefined
      ? {}
      : {
          observeRoot: (root, control) => {
            state.root = root;
            state.control = control;
            return options.observeRoot(state, root, control);
          },
        }),
  });
  run.catch(() => {});
  try {
    result = await Promise.race([
      run,
      new Promise((_, reject) => {
        modelAlarm = setTimeout(
          () => reject(Error("model failed to terminate")),
          750,
        );
      }),
    ]);
    /* exact production arguments are supplied above */
  } catch (reason) {
    state.failed = true;
    error = reason;
  } finally {
    clearTimeout(modelAlarm);
  }
  state.elapsedMs = Math.round(performance.now() - began);
  state.error = error;
  state.result = result;
  assert.ok(
    state.elapsedMs < 1000,
    "short model must terminate without a pipe EOF supplied by test teardown",
  );
  // Release synthetic endpoints only; no real processes were spawned.
  child.stdout.destroy();
  child.stderr.destroy();
  for (const stream of state.streams) stream.destroy();
  return state;
}

test("single supervisor returns finite original cleanup failure despite inherited open pipes", async () => {
  const state = await compileSupervisorModel({
    stopError: true,
    holdPipes: true,
  });
  assert.equal(state.error, state.primary);
  assert.equal(state.stops, 1);
  assert.equal(state.proofs, 0);
  assert.equal(state.writes.length, 0);
  assert.equal(state.kills, 1);
  assert.equal(state.unrefs, 1);
  const diagnostic = JSON.parse(
    state.diagnostic.split("compile-supervision=")[1],
  );
  assert.equal(diagnostic.failureStage, "reap");
  assert.equal(diagnostic.phase, "denied");
  assert.equal(diagnostic.cohortQuiet, false);
  assert.doesNotMatch(state.diagnostic, /fixed injected|fake|synthetic/);
});
test("monitor failure still attempts cohort cleanup and retains the original error", async () => {
  const state = await compileSupervisorModel({ monitorError: true });
  assert.equal(state.error, state.primary);
  assert.equal(state.stops, 1);
  assert.equal(state.proofs, 0);
  assert.equal(state.writes.length, 0);
});
test("never resolving initial snapshot denies admission finitely without guessed cohort signals", async () => {
  const state = await compileSupervisorModel({
    neverSnapshot: true,
    holdPipes: true,
  });
  assert.match(state.error.message, /cleanup deadline/);
  assert.equal(state.stops, 0);
  assert.equal(state.proofs, 0);
  assert.equal(state.kills, 1);
});
test("writer failure remains primary through cleanup and natural detached pipe writers are denied", async () => {
  const writer = await compileSupervisorModel({
    streamError: true,
    holdPipes: true,
  });
  assert.equal(writer.error, writer.primary);
  assert.equal(writer.stops, 1);
  assert.equal(writer.proofs, 0);
  const natural = await compileSupervisorModel({ naturalExit: true });
  assert.match(natural.error.message, /descendants survived/);
  assert.equal(natural.stops, 1);
  assert.equal(natural.proofs, 0);
  assert.equal(JSON.parse(natural.writes[0].data).checkpointAllowed, false);
});
test("only confirmed reaping exit pipe and writer joins create a compile proof", async () => {
  const clean = await compileSupervisorModel();
  assert.equal(clean.error, undefined);
  assert.equal(clean.result.outcome, "slice-ended");
  assert.equal(clean.proofs, 1);
  assert.equal(clean.stops, 1);
  assert.equal(clean.writes.length, 1);
  const pending = await compileSupervisorModel({ neverFinished: true });
  assert.match(pending.error.message, /cleanup deadline/);
  assert.equal(pending.proofs, 0);
  assert.equal(pending.writes.length, 0);
});
test("missing live root identity denies proof and never reaches observed-cohort signal logic", async () => {
  const state = await compileSupervisorModel({ badOwner: true });
  assert.match(state.error.message, /Exact live child ownership/);
  assert.equal(state.stops, 0);
  assert.equal(state.proofs, 0);
});

test("identity-guarded reaper never signals a replacement root or a foreign process", async () => {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = ast.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "stopObserved",
    )
    .getText(ast);
  const original = { pid: 100, start: "Sat Oct 24 00:00:00 2026" },
    signals = [];
  const dependencies = {
    assert,
    process: { kill: (pid, signal) => signals.push({ pid, signal }) },
    processSnapshot: async () => [
      { pid: 100, parent: 200, start: "Sat Oct 24 00:00:01 2026" },
      { pid: 999, parent: 1, start: original.start },
    ],
    observedLineage,
    sameObservedCohort,
    observedQuiet: async () => false,
  };
  const reap = new Function(
    ...Object.keys(dependencies),
    "return (" + body + ")",
  )(...Object.values(dependencies));
  await assert.rejects(
    reap({ pid: 100 }, [original], { deadline: performance.now() + 100 }),
    /Owned root PID identity changed/,
  );
  assert.deepEqual(signals, []);
});

test("fixed ps timeout kills only its creation-owned helper and cannot retain stdout handles", async () => {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = ast.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "processSnapshot",
    )
    .getText(ast);
  const ps = new EventEmitter();
  ps.stdout = new PassThrough();
  let killed = 0,
    unref = 0;
  ps.kill = (signal) => {
    assert.equal(signal, "SIGKILL");
    killed++;
  };
  ps.unref = () => unref++;
  const dependencies = {
    assert,
    spawn: (file, args, options) => {
      assert.equal(file, "/bin/ps");
      assert.deepEqual(args, ["-axo", "pid=,ppid=,lstart="]);
      assert.deepEqual(options.env, {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        TZ: "UTC",
      });
      return ps;
    },
    processRows,
    compileMonitorRecord,
    compileMonitorGuard: (ok, message, code) => {
      try {
        assert(ok, message);
      } catch (error) {
        throw compileMonitorRecord(error, code);
      }
    },
    setTimeout: (callback) => setTimeout(callback, 5),
    clearTimeout,
  };
  const snapshot = new Function(
    ...Object.keys(dependencies),
    "return (" + body + ")",
  )(...Object.values(dependencies));
  await assert.rejects(
    snapshot({ deadline: performance.now() + 100 }),
    /Ownership snapshot deadline/,
  );
  assert.equal(killed, 1);
  assert.equal(unref, 1);
  assert.equal(ps.stdout.destroyed, true);
});

test("a null primary rejection remains null through subsequent cleanup failures", async () => {
  const state = await compileSupervisorModel({
    monitorError: true,
    stopError: true,
    error: null,
    holdPipes: true,
  });
  assert.equal(state.error, null);
  assert.equal(state.proofs, 0);
  assert.equal(state.stops, 1);
});

test("same-clock supervisor rechecks deadline immediately before a queued operation", async () => {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = ast.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "compileWithin",
    )
    .getText(ast);
  let reads = 0,
    calls = 0;
  const within = new Function("assert", "performance", "return (" + body + ")")(
    assert,
    { now: () => (reads++ === 0 ? 0 : 100) },
  );
  await assert.rejects(
    within(() => {
      calls++;
    }, 50),
    /cleanup deadline/,
  );
  assert.equal(calls, 0);
});

test("delayed work timer cannot mint cleanup time beyond the original admission bound", async () => {
  // Shared injected clock advances200ms at the20ms work timer; the original
  // work+80ms model cleanup allowance has already expired. This is a clock
  // domain model, not a claim of physical scheduling latency.
  const state = await compileSupervisorModel({
    delayedTimer: true,
    holdPipes: true,
  });
  assert.match(state.error.message, /cleanup deadline/);
  assert.equal(state.stops, 0);
  assert.equal(state.proofs, 0);
  assert.equal(state.writes.length, 0);
});

test("restore stages preserve primary objects, await observers and redact unknown failure data", async () => {
  const records = [],
    original = Object.assign(Error("TOKEN https://private.invalid/secret"), {
      code: "private/path",
    });
  let joined = false;
  const observe = createRestoreObserver(async (record) => {
    await Promise.resolve();
    records.push(record);
    joined = true;
  });
  await assert.rejects(
    restorePhase(observe, "manifest-digest", () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert(joined);
  assert.deepEqual(
    records.map(({ stage, event, errorCode }) => ({ stage, event, errorCode })),
    [
      { stage: "manifest-digest", event: "begin", errorCode: "NONE" },
      { stage: "manifest-digest", event: "failed", errorCode: "GUARD_FAILED" },
    ],
  );
  assert.doesNotMatch(JSON.stringify(records), /TOKEN|private|secret/);
  for (const sink of [
    () => {
      throw Error("logger");
    },
    async () => {
      throw Error("writer");
    },
  ]) {
    assert.equal(await restorePhase(sink, "archive-result", () => 42), 42);
    await assert.rejects(
      restorePhase(sink, "archive-result", () => {
        throw original;
      }),
      (error) => error === original,
    );
  }
  const capped = [],
    bounded = createRestoreObserver((record) => capped.push(record));
  for (let n = 0; n < 100; n++)
    await bounded({ stage: "proof-read", event: "begin", path: "secret" });
  await bounded({ stage: "proof-read", event: "failed", errorCode: "ENOENT" });
  assert.equal(capped.length, 32);
  assert.equal(capped.at(-1).errorCode, "ENOENT");
  assert(Buffer.byteLength(canonical(capped)) < 64 * 1024);
  await bounded({ stage: "secret", event: "failed" });
  assert.equal(capped.length, 32);
});

test("restore identity facts expose only intrinsically validated field matches", async () => {
  const prior = manifest(),
    rows = [],
    observe = createRestoreObserver((record) => rows.push(record));
  assert(
    Object.values(restoreIdentityComparison(identity, prior).matches).every(
      Boolean,
    ),
  );
  for (const field of [
    "producer",
    "image",
    "tools",
    "graph",
    "siso",
    "canonicalRoot",
  ]) {
    const changed = {
      ...identity,
      [field]:
        field === "canonicalRoot"
          ? "/private/different"
          : field === "image"
            ? "different-image"
            : "1".repeat(64),
    };
    const comparison = restoreIdentityComparison(changed, prior);
    assert.equal(comparison.available, true);
    assert.deepEqual(
      Object.entries(comparison.matches)
        .filter(([, match]) => !match)
        .map(([name]) => name),
      [field],
    );
    await observe({
      stage: "identity-comparison",
      event: "complete",
      comparison,
    });
  }
  for (const invalid of [
    { ...identity, source: "1".repeat(64) },
    { ...identity, target: "unknown" },
    { ...identity, tools: "https://secret" },
    { ...identity, extra: "private" },
  ]) {
    const comparison = restoreIdentityComparison(invalid, prior);
    assert.deepEqual(comparison, { available: false });
    await observe({
      stage: "identity-comparison",
      event: "complete",
      comparison,
    });
    assert.equal(Object.hasOwn(rows.at(-1), "matches"), false);
  }
  assert.doesNotMatch(canonical(rows), /private|different-image|https|\/Users/);
  assert.deepEqual(Object.keys(rows[0].matches).sort(), [
    "canonicalRoot",
    "graph",
    "image",
    "producer",
    "siso",
    "source",
    "target",
    "tools",
  ]);
});

async function actualRestoreBlock(overrides = {}) {
  const source = await readFile(
    path.join(ROOT, "scripts/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "checkpoint.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let body;
  const find = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "afterGnPhase" &&
      node.arguments[0]?.text === "restore"
    )
      body = node.arguments[1].getText(tree);
    ts.forEachChild(node, find);
  };
  find(tree);
  assert(body, "actual production restore body");
  const prior = manifest(),
    raw = Buffer.from(canonical(prior)),
    records = [],
    calls = [];
  const values = {
    restorePhase,
    restoreIdentityComparison,
    createRestoreObserver,
    restoreObserver: createRestoreObserver((record) => records.push(record)),
    json: async () => ({ manifest: prior }),
    path,
    download: "/owned/download",
    readFile: async () => raw,
    env: { CEF_RESTORE_MANIFEST_SHA: sha(raw) },
    sha,
    canonical,
    JSON,
    fail: (ok, message) => assert(ok, message),
    validateManifest,
    digest: validateIdentity(identity),
    identity,
    out: "/owned/out",
    statfs: async () => ({ bavail: 100 * 1024 ** 3, bsize: 1 }),
    verified: { python: "not-executed" },
    HELPER: "not-executed",
    recipePath: "/owned/recipe",
    context: { revalidateGn: async () => {} },
    sourceMetadata: undefined,
    resumedSource: false,
    archiveCommand: async () => {
      calls.push("archive");
      return { complete: true, linksExtracted: false };
    },
    restoreVerifiedGraph: async () => {
      calls.push("install");
    },
    ...overrides,
  };
  const operation = new Function(
    ...Object.keys(values),
    "return (" + body + ")",
  )(...Object.values(values));
  return { operation, records, calls };
}

test("actual production restore closure attributes each preflight denial without advancing", async () => {
  const original = Object.assign(Error("secret failure"), { code: "EIO" });
  const cases = [
    [
      "proof-read",
      {
        json: async () => {
          throw original;
        },
      },
      original,
    ],
    [
      "manifest-read",
      {
        readFile: async () => {
          throw original;
        },
      },
      original,
    ],
    ["manifest-digest", { env: { CEF_RESTORE_MANIFEST_SHA: "0".repeat(64) } }],
    ["proof-match", { json: async () => ({ manifest: {} }) }],
    ["manifest-validation", { digest: "0".repeat(64) }],
    ["disk-capacity", { statfs: async () => ({ bavail: 0, bsize: 1 }) }],
    [
      "archive-restore",
      {
        archiveCommand: async () => {
          throw original;
        },
      },
      original,
    ],
    [
      "archive-result",
      {
        archiveCommand: async () => ({ complete: false, linksExtracted: true }),
      },
    ],
  ];
  for (const [stage, overrides, expected] of cases) {
    const { operation, records, calls } = await actualRestoreBlock(overrides);
    await assert.rejects(
      operation(),
      expected ? (error) => error === expected : undefined,
    );
    assert.equal(records.at(-1).stage, stage);
    assert.equal(records.at(-1).event, "failed");
    assert(!calls.includes("install"));
    assert.doesNotMatch(canonical(records), /secret|owned\/|not-executed/);
  }
  const success = await actualRestoreBlock();
  await success.operation();
  assert.deepEqual(success.calls, ["archive", "install"]);
  const absent = await actualRestoreBlock({
    json: async () => {
      throw Object.assign(Error("missing"), { code: "ENOENT" });
    },
  });
  await absent.operation();
  assert.deepEqual(absent.calls, []);
});

test("actual restoreVerifiedGraph preserves exact order and stops at every original substage", async () => {
  const source = await readFile(
    path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = tree.statements
    .find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "restoreVerifiedGraph",
    )
    .getText(tree)
    .replace(/^export /, "");
  const stages = [
    "restored-graph",
    "adjacent-install",
    "fresh-gn",
    "fresh-graph",
    "generated-bindings",
  ];
  for (const failed of [null, ...stages]) {
    const calls = [],
      records = [],
      original = Error("owned original");
    const step = (name) => {
      calls.push(name);
      if (name === failed) throw original;
    };
    const restore = new Function(
      "assert",
      "restorePhase",
      "verifyGraph",
      "installRestoredDirectory",
      "return (" + declaration + ")",
    )(
      assert,
      restorePhase,
      async (root) =>
        step(root === "restored" ? "restored-graph" : "fresh-graph"),
      async () => step("adjacent-install"),
    );
    const operation = restore({
      fresh: "fresh",
      restored: "restored",
      expectedGraph: "verified",
      revalidateGn: async () => step("fresh-gn"),
      verifyGenerated: async () => step("generated-bindings"),
      observe: createRestoreObserver((record) => records.push(record)),
    });
    if (failed) {
      await assert.rejects(operation, (error) => error === original);
      assert.deepEqual(calls, stages.slice(0, stages.indexOf(failed) + 1));
      assert.equal(records.at(-1).stage, failed);
      assert.equal(records.at(-1).event, "failed");
    } else {
      await operation;
      assert.deepEqual(calls, stages);
    }
  }
});

test("fresh graph snapshot is complete, defensive and keeps the existing absolute clock", async (t) => {
  const root = await scratch(t);
  await writeFile(path.join(root, "args.gn"), "owned\n");
  await writeFile(path.join(root, "build.ninja"), "rule owned\n");
  const baseline = await graphInventory(root);
  let snapshot,
    returned = false;
  const observed = await graphInventory(root, {
    async observePins(value) {
      snapshot = JSON.parse(graphPinSnapshot(value));
      value.pins[0].path = "/private/tamper";
      value.pins.length = 0;
      await Promise.resolve();
      returned = true;
    },
  });
  assert(returned);
  assert.equal(observed.sha256, baseline.sha256);
  assert.equal(snapshot.sha256, baseline.sha256);
  assert.equal(snapshot.pins.length, 2);
  assert(snapshot.complete);
  assert.equal(
    (
      await graphInventory(root, {
        observePins: async () => {
          throw Error("writer denied");
        },
      })
    ).sha256,
    baseline.sha256,
  );
  await assert.rejects(
    graphInventory(root, {
      timeoutMs: 200,
      observePins: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      },
    }),
    (error) => error.code === "GRAPH_BOUND",
  );
});

test("graph snapshot rejects unsafe, duplicate, tampered and oversized pin projections", () => {
  const row = { path: "args.gn", name: "args.gn", bytes: 0, sha256: sha("") };
  const value = (pins) => ({
    files: pins.length,
    bytes: pins.reduce((total, pin) => total + pin.bytes, 0),
    sha256: sha(canonical(pins)),
    pins,
  });
  assert(JSON.parse(graphPinSnapshot(value([row]))).complete);
  for (const name of [
    "/args.gn",
    "../args.gn",
    "C:/args.gn",
    "a\\args.gn",
    "a//args.gn",
    "a/./args.gn",
    "a/\u0000args.gn",
  ])
    assert.throws(() => graphPinSnapshot(value([{ ...row, path: name }])));
  assert.throws(() => graphPinSnapshot(value([row, row])));
  assert.throws(() => graphPinSnapshot(value([{ ...row, sha256: "private" }])));
  assert.throws(() =>
    graphPinSnapshot({ ...value([row]), sha256: "0".repeat(64) }),
  );
  assert.throws(() => graphPinSnapshot({ ...value([row]), files: 50001 }));
  const huge = Array.from({ length: 4500 }, (_, index) => ({
    ...row,
    path: "a".repeat(3990) + "/" + String(index).padStart(4, "0") + "/args.gn",
  }));
  assert.throws(() => graphPinSnapshot(value(huge)), /snapshot byte bound/);
});

const macR5Inputs = [
  {
    target: "x86_64-apple-darwin",
    old: "20261024-registration-retirement-lf-macintel-sdk26-2-capture-compat",
    next: "20261025-r5-owned-http3-macintel-sdk26-2-capture-compat",
    identity:
      "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
  },
  {
    target: "aarch64-apple-darwin",
    old: "20261024-registration-retirement-lf-macarm-sdk26-2-capture-compat",
    next: "20261025-r5-owned-http3-macarm-sdk26-2-capture-compat",
    identity:
      "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
  },
];
const macWindowsR5Reference =
  "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64";

test("Mac R5 projection preserves old LF and target inputs while binding common fixes and a new LF ABI header", async () => {
  const windows = validateSourceLock(
    JSON.parse(
      await readFile(
        path.join(ROOT, macWindowsR5Reference, "source-lock.json"),
        "utf8",
      ),
    ),
  );
  for (const row of macR5Inputs) {
    const old = path.join(ROOT, "native/cef-build-inputs", row.old),
      next = path.join(ROOT, "native/cef-build-inputs", row.next);
    const prior = validateSourceLock(
        JSON.parse(await readFile(path.join(old, "source-lock.json"), "utf8")),
      ),
      lock = validateSourceLock(
        JSON.parse(await readFile(path.join(next, "source-lock.json"), "utf8")),
      );
    assert.equal(identitySha256(lock), row.identity);
    assert.equal(checkpointProfile(row.target).source, row.identity);
    assert.equal(lock.bridge.patchId, "sorng-tls-v2-682c378-5");
    assert.equal(lock.bridge.capabilities.length, 9);
    assert(lock.bridge.capabilities.includes("owned-http3"));
    assert.equal(prior.bridge.patchId, "sorng-tls-v2-682c378-4");
    assert.equal(prior.patches.length, 13);
    assert.deepEqual(lock.upstream, prior.upstream);
    assert.deepEqual(lock.upstream, windows.upstream);
    assert.deepEqual(lock.builds, prior.builds);
    assert.deepEqual(lock.patches.slice(0, 12), prior.patches.slice(0, 12));
    assert.deepEqual(lock.patches.slice(12, 22), windows.patches.slice(12));
    assert.equal(lock.patches.length, 23);
    for (const [index, patch] of lock.patches.entries()) {
      const source =
        index < 12
          ? path.join(old, patch.path)
          : index < 22
            ? path.join(ROOT, macWindowsR5Reference, patch.path)
            : path.join(old, prior.patches[12].path);
      const raw = await readFile(path.join(next, patch.path));
      assert.deepEqual(raw, await readFile(source));
      assert.equal(sha(raw), patch.sha256);
      assert(!raw.includes(13), "copied patch must retain existing LF bytes");
    }
    assert.equal(
      lock.patches[22].path,
      "patches/0023-webrtc-macos-legacy-capture-deprecation-compat.patch",
    );
    for (const file of [
      lock.builds[0].gnArgs.path,
      lock.builds[0].toolchainLock.path,
      `cef-ci-runner-${row.target}.json`,
    ])
      assert.deepEqual(
        await readFile(path.join(next, file)),
        await readFile(path.join(old, file)),
      );
    const header = await readFile(path.join(next, lock.bridge.header.path));
    assert.equal(header.length, 8886);
    assert(!header.includes(13));
    assert.equal(
      sha(header),
      "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
    );
    assert.equal(lock.bridge.header.sha256, sha(header));
    const windowsHeader = await readFile(
      path.join(ROOT, macWindowsR5Reference, windows.bridge.header.path),
    );
    assert.notEqual(sha(header), sha(windowsHeader));
    assert.equal(
      header.toString(),
      windowsHeader.toString().replaceAll("\r\n", "\n"),
    );
    const reviewed = await plan({
      inputs: checkpointProfile(row.target).inputs,
      target: row.target,
      checkout: ROOT,
      runnerMode: "hosted",
    });
    assert.equal(
      releaseIdentity(reviewed.sourceLock, row.target).sourceLockSha256,
      row.identity,
    );
    assert.throws(
      () =>
        validateIdentity({
          ...identity,
          target: row.target,
          source: identitySha256(prior),
        }),
      /source/,
    );
    const review = JSON.parse(
      await readFile(path.join(next, "review-receipt.json"), "utf8"),
    );
    assert.equal(review.engineBuilt, false);
    assert.equal(review.nativeAcceptancePassed, false);
    assert.equal(review.oldNativeProofTransferred, false);
    assert.equal(review.implicitTracerPolicyVerified, false);
    assert.equal(review.componentResourceClosureVerified, false);
    const inventory = await readdir(next, {
      recursive: true,
      withFileTypes: true,
    });
    assert.equal(inventory.filter((entry) => entry.isFile()).length, 29);
  }
});

test("Mac R5 source plan refuses changed LF patches, CRLF header substitution and revision downgrade", async (t) => {
  const root = await scratch(t),
    row = macR5Inputs[0],
    inputs = "inputs";
  await cp(
    path.join(ROOT, "native/cef-build-inputs", row.next),
    path.join(root, inputs),
    { recursive: true },
  );
  const lock = JSON.parse(
    await readFile(path.join(root, inputs, "source-lock.json"), "utf8"),
  );
  for (const file of [
    lock.patches[7].path,
    lock.patches[12].path,
    lock.bridge.header.path,
  ]) {
    const target = path.join(root, inputs, file),
      before = await readFile(target);
    await writeFile(target, before.toString().replaceAll("\n", "\r\n"));
    await assert.rejects(
      plan({
        inputs,
        target: row.target,
        checkout: root,
        runnerMode: "hosted",
      }),
      (error) => error.message === `Reviewed input mismatch: ${file}`,
    );
    await writeFile(target, before);
  }
  const downgrade = structuredClone(lock);
  downgrade.bridge.capabilities = downgrade.bridge.capabilities.filter(
    (capability) => capability !== "owned-http3",
  );
  assert.throws(() => validateSourceLock(downgrade), /capabilities/);
  await assert.rejects(
    plan({
      inputs,
      target: "aarch64-apple-darwin",
      checkout: root,
      runnerMode: "hosted",
    }),
    /target|build/i,
  );
});

test("actual R5 header patch reconstructs the exact new Mac LF postimage in an owned private Git fixture", async (t) => {
  const root = await scratch(t),
    old = path.join(ROOT, "native/cef-build-inputs", macR5Inputs[0].old),
    next = path.join(ROOT, "native/cef-build-inputs", macR5Inputs[0].next);
  await mkdir(path.join(root, "include"));
  await mkdir(path.join(root, "empty-hooks"));
  const file = path.join(root, "include/cef_sorng_tls_bridge.h"),
    original = await readFile(path.join(old, "include/cef_sorng_tls_bridge.h"));
  await writeFile(file, original);
  const env = {
    PATH: process.env.PATH ?? process.env.Path,
    SystemRoot: process.env.SystemRoot ?? "C:/Windows",
    HOME: root,
    USERPROFILE: root,
    TEMP: root,
    TMP: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (args) =>
    execFileSync(
      "git",
      [
        "-c",
        `core.hooksPath=${path.join(root, "empty-hooks")}`,
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      { cwd: root, env, timeout: 5000, maxBuffer: 1048576, windowsHide: true },
    );
  git(["init", "--quiet"]);
  const patch = path.join(
      ROOT,
      macWindowsR5Reference,
      "patches/0014-cef-owned-quic-datagrams.patch",
    ),
    args = [
      "apply",
      "--include=include/cef_sorng_tls_bridge.h",
      "--whitespace=error-all",
    ];
  git([...args, "--check", patch]);
  git([...args, patch]);
  assert.deepEqual(
    await readFile(file),
    await readFile(path.join(next, "include/cef_sorng_tls_bridge.h")),
  );
  git([...args, "--reverse", "--check", patch]);
  git([...args, "--reverse", patch]);
  assert.deepEqual(await readFile(file), original);
});

test("monitor process rows and lineage retain closed guard reasons without raw identities", () => {
  const failures = [
    [() => processRows("SECRET_PROCESS_ROW"), "PS_ROWS_SYNTAX"],
    [() => processRows("1 0 secret-start"), "PS_ROWS_IDENTITY"],
    [
      () =>
        processRows(
          "1 0 Sun Oct 25 00:00:00 2026\n1 0 Sun Oct 25 00:00:00 2026",
        ),
      "PS_ROWS_IDENTITY",
    ],
    [
      () =>
        processRows(
          Array.from(
            { length: 32769 },
            (_, i) => `${i + 1} 0 Sun Oct 25 00:00:00 2026`,
          ).join("\n"),
        ),
      "PS_ROWS_COUNT",
    ],
    [() => observedLineage([], []), "OWN_SEED_BOUND"],
    [
      () =>
        observedLineage(
          [{ pid: 1, parent: 0, start: "different" }],
          [{ pid: 1, start: "secret-old" }],
        ),
      "OWN_ROOT_REPLACED",
    ],
    [
      () =>
        observedLineage(
          [
            { pid: 1, parent: 0, start: "same" },
            ...Array.from({ length: 4096 }, (_, i) => ({
              pid: i + 2,
              parent: 1,
              start: "same",
            })),
          ],
          [{ pid: 1, start: "same" }],
        ),
      "OWN_ACTIVE_BOUND",
    ],
  ];
  for (const [run, code] of failures) {
    assert.throws(run, (error) => {
      const diagnostic = compileMonitorDetails(error);
      assert.equal(diagnostic.code, code);
      const raw = JSON.stringify(diagnostic);
      assert(Buffer.byteLength(raw) <= 4096);
      assert(!/SECRET|secret|different|same/.test(raw));
      return true;
    });
  }
  const marker = new Error("SECRET_UNCLASSIFIED_MESSAGE");
  assert.deepEqual(compileMonitorDetails(marker), { code: "UNKNOWN" });
  assert.equal(
    compileMonitorRecord(marker, "not-allowlisted", {
      snapshotChars: Infinity,
      arbitrary: "SECRET",
    }),
    marker,
  );
  assert.deepEqual(compileMonitorDetails(marker), { code: "UNKNOWN" });
  assert.equal(compileMonitorRecord(null, "PS_SPAWN"), null);
});

test("actual processSnapshot branches preserve original errors and closed numeric failure observations", async () => {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "checkpoint.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = (name) =>
    ast.statements
      .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
      .getText(ast)
      .replace(/^export /, "");
  for (const mode of [
    "success",
    "spawn",
    "reader",
    "bound",
    "exit",
    "syntax",
    "identity",
    "deadline",
    "abort",
  ]) {
    const ps = new EventEmitter();
    ps.stdout = new PassThrough();
    const marker = new Error("SECRET_PARSER_OR_PROVIDER_PATH");
    const controller = new AbortController();
    let kills = 0,
      unrefs = 0;
    ps.kill = () => {
      kills++;
      return true;
    };
    ps.unref = () => {
      unrefs++;
    };
    const fakeSpawn = (file, args, options) => {
      assert.equal(file, "/bin/ps");
      assert.deepEqual(args, ["-axo", "pid=,ppid=,lstart="]);
      assert.deepEqual(options.env, {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        TZ: "UTC",
      });
      setImmediate(() => {
        if (mode === "deadline") return;
        if (mode === "abort") return controller.abort();
        if (mode === "spawn") return ps.emit("error", marker);
        if (mode === "reader") return ps.stdout.emit("error", marker);
        if (mode === "bound")
          return ps.stdout.write(Buffer.alloc(4 * 1024 ** 2 + 1, 65));
        ps.stdout.write(
          mode === "syntax"
            ? "SECRET_RAW_ROW"
            : mode === "identity"
              ? "1 0 secret-start"
              : "1 0 Sun Oct 25 00:00:00 2026",
        );
        ps.stdout.end();
        ps.emit("close", mode === "exit" ? 7 : 0);
      });
      return ps;
    };
    const snapshot = new Function(
      "assert",
      "spawn",
      "processRows",
      "compileMonitorRecord",
      "performance",
      "setTimeout",
      "clearTimeout",
      body("compileMonitorGuard") +
        "\nreturn (" +
        body("processSnapshot") +
        ")",
    )(
      assert,
      fakeSpawn,
      processRows,
      compileMonitorRecord,
      performance,
      setTimeout,
      clearTimeout,
    );
    const run = snapshot({
      deadline: performance.now() + 100,
      signal: controller.signal,
    });
    if (mode === "success") {
      const rows = await run;
      const facts = compileMonitorDetails(rows);
      assert.equal(facts.code, "NONE");
      assert.equal(facts.snapshotRows, 1);
      assert.equal(facts.snapshotExitCode, 0);
    } else {
      const codes = {
        spawn: "PS_SPAWN",
        reader: "PS_STDOUT_READ",
        bound: "PS_STDOUT_BOUND",
        exit: "PS_EXIT_NONZERO",
        syntax: "PS_ROWS_SYNTAX",
        identity: "PS_ROWS_IDENTITY",
        deadline: "PS_DEADLINE",
        abort: "PS_ABORT",
      };
      await assert.rejects(run, (error) => {
        if (["spawn", "reader"].includes(mode)) assert.equal(error, marker);
        const facts = compileMonitorDetails(error);
        assert.equal(facts.code, codes[mode]);
        assert(Number.isSafeInteger(facts.snapshotElapsedMs));
        assert(Number.isSafeInteger(facts.snapshotChars));
        if (mode === "exit") assert.equal(facts.snapshotExitCode, 7);
        assert(!JSON.stringify(facts).includes("SECRET"));
        return true;
      });
    }
    assert.equal(
      kills,
      ["reader", "bound", "deadline", "abort"].includes(mode) ? 1 : 0,
    );
    assert.equal(unrefs, kills);
    ps.stdout.destroy();
  }
});

test("monitor rejected promise is distinguished from an unjoined live task without changing primary denial", async () => {
  const marker = compileMonitorRecord(
    new Error("SECRET_MONITOR_ERROR"),
    "PS_STDOUT_BOUND",
    { snapshotChars: 4194305 },
  );
  const state = await compileSupervisorModel({
    monitorError: true,
    error: marker,
  });
  assert.equal(state.error, marker);
  assert.equal(state.proofs, 0);
  const facts = JSON.parse(state.diagnostic.split("compile-supervision=")[1]);
  assert.equal(facts.failure, "UNCONFIRMED");
  assert.equal(facts.failureStage, "monitor");
  assert.equal(facts.monitorJoined, false);
  assert.equal(facts.monitorSettled, true);
  assert.equal(facts.monitorResult, "rejected");
  assert.equal(facts.monitorFailure.code, "PS_STDOUT_BOUND");
  assert.equal(facts.monitorFailure.snapshotOrdinal, 2);
  assert.equal(facts.monitorFailure.snapshotChars, 4194305);
  assert(Buffer.byteLength(JSON.stringify(facts.monitorFailure)) <= 4096);
  assert(!/SECRET|pid|start/.test(JSON.stringify(facts.monitorFailure)));
});

test("actual monitor guard delegates the original assertion and tags the identical thrown object", async () => {
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "checkpoint.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const body = ast.statements
    .find(
      (n) =>
        ts.isFunctionDeclaration(n) && n.name?.text === "compileMonitorGuard",
    )
    .getText(ast);
  const make = (originalAssert) =>
    new Function(
      "assert",
      "compileMonitorRecord",
      body + "\nreturn compileMonitorGuard;",
    )(originalAssert, compileMonitorRecord);
  let original;
  try {
    assert(false, "original classification");
  } catch (error) {
    original = error;
  }
  assert.equal(original.code, "ERR_ASSERTION");
  const guard = make(assert);
  assert.throws(
    () => guard(false, "original classification", "PS_ROWS_SYNTAX"),
    (error) => {
      for (const key of [
        "name",
        "code",
        "actual",
        "expected",
        "operator",
        "message",
      ])
        assert.equal(error[key], original[key], key);
      assert.equal(error.constructor, original.constructor);
      assert.equal(compileMonitorDetails(error).code, "PS_ROWS_SYNTAX");
      return true;
    },
  );
  const exact = make(() => {
    throw original;
  });
  assert.throws(
    () => exact(false, "unchanged", "PS_ROWS_SYNTAX"),
    (error) => error === original,
  );
  const nullGuard = make(() => {
    throw null;
  });
  assert.throws(
    () => nullGuard(false, "unchanged", "PS_ROWS_SYNTAX"),
    (error) => error === null,
  );
  assert.equal(guard(true, "true guard", "PS_ROWS_SYNTAX"), undefined);
});

// Exact reviewed 9e6 Linux helper; bounded data fixture works in shallow CI without fetching history.
// Genuine historical public registry: data only, never executed as Python.
// It is not the failed hosted registry and does not identify its first key.
const GCLIENT_REGISTRY_GZIP =
  "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";
const SOURCE_REPOSITORIES_BEFORE =
  "def source_repositories(root, budget):\n    import ast\n    names = {'src', 'src/cef', 'depot_tools'}\n    entry_file = safe(root / '.gclient_entries')\n    require(entry_file.is_file() and entry_file.stat().st_size <= 4 * 1024**2, 'source-repositories-bound')\n    registry_raw = source_read_bytes(entry_file, budget, 4 * 1024**2)\n    body = ast.parse(registry_raw)\n    require(len(body.body) == 1 and isinstance(body.body[0], ast.Assign) and\n            len(body.body[0].targets) == 1 and isinstance(body.body[0].targets[0], ast.Name) and\n            body.body[0].targets[0].id == 'entries', 'source-repositories-shape')\n    require(isinstance(body.body[0].value, ast.Dict), 'source-repositories-shape')\n    entries = ast.literal_eval(body.body[0].value)\n    require(len(entries) == len(body.body[0].value.keys), 'source-repositories-shape')\n    require(isinstance(entries, dict) and len(entries) <= 10000, 'source-repositories-bound')\n    for name, value in entries.items():\n        budget.check();relative(name)\n        require(name == 'src' or name.startswith('src/'), 'source-repository-root')\n        require(value is None or isinstance(value, str) and len(value) <= 8192, 'source-repository-value')\n        names.add(name)\n    return {'repositories': names, 'gitHeads': {}, 'registrySha256':hashlib.sha256(registry_raw).hexdigest()}";
const SOURCE_REPOSITORIES_BEFORE_SHA =
  "2ca5a0abdb91391a6c347fbbf2f295e37ebf0bf144cd32f2327931f3fb104f06";
const SOURCE_REGISTRY_PROOF =
  "import ast,hashlib,json,os,pathlib,sys,tempfile,types,unittest\nm=types.ModuleType('registry_candidate');m.__file__=sys.argv[1]\nexec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)\nhistorical=pathlib.Path(sys.argv[2]).read_bytes()\nassert hashlib.sha256(historical).hexdigest()=='726a5d7fe3f1897aec82d8d92acfa1607161a6972eef628d632ff2ca0ac7a086'\nold_scope=dict(m.__dict__);exec(compile(pathlib.Path(sys.argv[3]).read_bytes(),'frozen8000-source_repositories','exec'),old_scope)\nslot=chr(36)+'{platform}'\nclass RegistryProof(unittest.TestCase):\n def setUp(self):\n  if sys.platform=='win32':\n   # The production transaction is Linux-only. Windows exercises the actual\n   # registry parser with a controlled physical-fixture byte reader; Ubuntu\n   # exercises the unmodified held source reader and full transaction.\n   before=m.source_read_bytes;old_before=old_scope['source_read_bytes']\n   def reader(path,budget,maximum):\n    budget.check();raw=pathlib.Path(path).read_bytes();self.assertLessEqual(len(raw),maximum);return raw\n   m.source_read_bytes=reader;old_scope['source_read_bytes']=reader\n   self.addCleanup(lambda:setattr(m,'source_read_bytes',before))\n   self.addCleanup(lambda:old_scope.__setitem__('source_read_bytes',old_before))\n def owned(self, raw):\n  owner=tempfile.TemporaryDirectory(prefix='owned-gclient-registry-');self.addCleanup(owner.cleanup)\n  root=pathlib.Path(owner.name).resolve();file=root/'.gclient_entries';file.write_bytes(raw)\n  return root\n def registry(self, entries):return self.owned(('entries = '+repr(entries)+'\\n').encode())\n def test_actual_historical_245_old_red_new_green(self):\n  root=self.owned(historical)\n  with self.assertRaisesRegex(m.CheckpointError,'^member-path$'):old_scope['source_repositories'](root,m.Budget(5))\n  value=m.source_repositories(root,m.Budget(5));entries=ast.literal_eval(ast.parse(historical).body[0].value)\n  self.assertEqual(len(entries),245);self.assertEqual(sum(':'in k for k in entries),90)\n  self.assertEqual(value,{'repositories':{'src','src/cef','depot_tools'}|{k for k in entries if ':'not in k},'gitHeads':{},'registrySha256':hashlib.sha256(historical).hexdigest()})\n  self.assertFalse(any(':'in k for k in value['repositories']))\n def test_exact_constructor_relations_and_raw_registry_binding(self):\n  key='src/cipd:infra/tools/'+slot\n  rows={'src':'https://public.example/src','src/disabled':None,'src/gcs:object/file-abc':'gs://chromium-browser-clang/object/file-abc',key:'https://chrome-infra-packages.appspot.com/infra/tools/'+slot+'@git_revision:abc'}\n  for k,v in rows.items():self.assertEqual(m.source_registry_repository(k,v),None if ':'in k else k)\n  root=self.registry(rows);value=m.source_repositories(root,m.Budget(5))\n  self.assertNotIn('src/cipd',value['repositories']);self.assertNotIn('src/gcs',value['repositories'])\n  self.assertEqual(value['registrySha256'],hashlib.sha256((root/'.gclient_entries').read_bytes()).hexdigest())\n  changed=dict(rows);changed[key]=rows[key].replace(':abc',':def')\n  self.assertNotEqual(value['registrySha256'],m.source_repositories(self.registry(changed),m.Budget(5))['registrySha256'])\n def test_closed_uri_authority_and_unsupported_pin_expansion(self):\n  pairs=[('src/a:pkg',v) for v in ['https://elsewhere.example/pkg@v','https://user@chrome-infra-packages.appspot.com/pkg@v','https://chrome-infra-packages.appspot.com:443/pkg@v','https://chrome-infra-packages.appspot.com/pkg@v?q=x','https://chrome-infra-packages.appspot.com/pkg@v#x','https://chrome-infra-packages.appspot.com/other@v','https://chrome-infra-packages.appspot.com/p/pkg/+/revision','https://chrome-infra-packages.appspot.com/pkg@','https://chrome-infra-packages.appspot.com/pkg@../v',None]]\n  pairs += [('src/a:object',v) for v in ['gs://bucket/other','gs://user@bucket/object','gs://bucket:99/object','gs://bucket/object?x','gs://bucket/object#x','gs://bucket//object','GS://bucket/object','file:///object']]\n  for key,value in pairs:\n   with self.subTest(key=key,value=value),self.assertRaises(m.CheckpointError):m.source_registry_repository(key,value)\n def test_path_value_duplicate_shape_guards_are_unchanged(self):\n  for key in ['src/a:','src/a:pkg:extra','/src/a:pkg','src/../a:pkg','src/a\\\\b:pkg','src/a:../pkg','src/a:/pkg','src/a:pkg//x','src/a:pkg\\\\x','src/a:pkg\\nx','src/a:pkg/'+chr(36)+'{unknown}','src/a:pkg/./x','outside:pkg','src/'+('a'*1020)+':pkg',None,1,True]:\n   with self.subTest(key=key),self.assertRaises(m.CheckpointError):m.source_registry_repository(key,'https://chrome-infra-packages.appspot.com/pkg@v')\n  for key in ['src/aux/file','src/a.','src/a ','src/../a','src/a:b']:\n   with self.subTest(key=key),self.assertRaises(m.CheckpointError):m.relative(key)\n  for value in [1,True,{},'a'*8193]:\n   with self.subTest(valueType=type(value).__name__),self.assertRaises(m.CheckpointError):m.source_registry_repository('src',value)\n  for raw in [b\"entries = {'src':None,'src':None}\\n\",b\"entries = {}\\nother = 1\\n\"]:\n   with self.assertRaisesRegex(m.CheckpointError,'source-repositories-shape'):m.source_repositories(self.owned(raw),m.Budget(5))\n def test_logical_dependency_never_authorizes_git_admin(self):\n  root=self.registry({'src':'https://public.example/src','src/cipd:pkg':'https://chrome-infra-packages.appspot.com/pkg@version:1'})\n  policy=m.source_repositories(root,m.Budget(5));(root/'src/cipd/.git').mkdir(parents=True)\n  with self.assertRaisesRegex(m.CheckpointError,'source-unknown-git-root'):m.source_admin(root,'src/cipd/.git',policy,m.Budget(5))\nunittest.main(argv=['owned-registry-proof'])\n";
async function registryProofFiles(t) {
  const root = await scratch(t);
  const registry = gunzipSync(Buffer.from(GCLIENT_REGISTRY_GZIP, "base64"), {
    maxOutputLength: 4 * 1024 ** 2,
  });
  assert.equal(registry.length, 42402);
  assert.equal(
    sha(registry),
    "726a5d7fe3f1897aec82d8d92acfa1607161a6972eef628d632ff2ca0ac7a086",
  );
  assert.equal(
    sha(Buffer.from(SOURCE_REPOSITORIES_BEFORE)),
    SOURCE_REPOSITORIES_BEFORE_SHA,
  );
  const historical = path.join(root, "historical-gclient-entries.data");
  const before = path.join(root, "frozen8000-source-repositories.data");
  await writeFile(historical, registry, { flag: "wx" });
  await writeFile(before, SOURCE_REPOSITORIES_BEFORE, { flag: "wx" });
  return { historical, before };
}
test("gclient actual physical registry classifies pinned logical labels without filesystem or Git authority", async (t) => {
  const { historical, before } = await registryProofFiles(t);
  const result = python(SOURCE_REGISTRY_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    historical,
    before,
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 5 tests/);
});
test(
  "Linux logical registry still binds all real unpacked input bytes and exact source schema",
  {
    skip:
      process.platform !== "linux"
        ? "Actual Linux metadata transaction; portable registry test runs on every OS"
        : false,
  },
  async (t) => {
    const { before } = await registryProofFiles(t);
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const result = python(
      setup +
        "\nwith fixture(record=False) as (root,sidecar,identity):\n slot=chr(36)+'{platform}'\n entries={'src':'https://public.example/src','src/gcs:object/file':'gs://bucket/object/file','src/cipd:infra/tool/'+slot:'https://chrome-infra-packages.appspot.com/infra/tool/'+slot+'@version:1'}\n registry=root/'.gclient_entries';registry.write_text('entries = '+repr(entries)+'\\n')\n for name in ['src/gcs/file','src/cipd/bin/tool']:\n  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'actual owned payload bytes')\n old_scope=dict(m.__dict__);exec(compile(pathlib.Path(sys.argv[2]).read_bytes(),'frozen8000-registry','exec'),old_scope)\n try:old_scope['source_repositories'](root,m.Budget(5))\n except m.CheckpointError as e:assert str(e)=='member-path'\n else:raise AssertionError('actual old accepted logical registry')\n result=m.source_metadata('source-record',root,sidecar,identity,60);assert result['complete']\n stored=json.loads(sidecar.read_bytes());paths={r['path'] for r in stored['snapshot']['entries']}\n assert {'src/gcs/file','src/cipd/bin/tool','.gclient_entries'}<=paths\n assert not any(':' in p for p in paths)\n assert set(stored)=={'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'}\n assert m.source_metadata('source-verify',root,sidecar,identity,60)['complete']\n for name in ['src/gcs/file','src/cipd/bin/tool']:\n  p=root/name;before=p.read_bytes();p.write_bytes(b'changed real dependency')\n  try:m.source_metadata('source-apply',root,sidecar,identity,60)\n  except m.CheckpointError as e:assert str(e) in ('source-content-changed','source-repository-or-total-changed')\n  else:raise AssertionError('logical dependency payload escaped complete census')\n  p.write_bytes(before)\n m.source_metadata('source-apply',root,sidecar,identity,60)\n raw=registry.read_bytes();registry.write_bytes(raw.replace(b'version:1',b'version:2'))\n try:m.source_metadata('source-apply',root,sidecar,identity,60)\n except m.CheckpointError as e:assert str(e) in ('source-content-changed','source-repository-or-total-changed')\n else:raise AssertionError('raw logical registry mutation escaped binding')\nprint('actual logical registry oldRED/newGREEN; complete physical payload and raw registry binding PASS')\n",
      [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"), before],
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /complete physical payload and raw registry binding PASS/,
    );
  },
);

const SOURCE_PATH_DIAGNOSTIC_PROOF =
  "import pathlib,sys,types,unittest,hashlib,copy\nfrom unittest.mock import patch\nm=types.ModuleType('path_diagnostic_candidate');m.__file__=sys.argv[1]\nexec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)\nclass PathDiagnosticProof(unittest.TestCase):\n def setUp(self):m.SOURCE_PATH_MODE='source-record'\n def test_exact_predicates_and_bounded_public_names(self):\n  cases=[(1,'type'),('','length'),('src/'+('a'*1024),'length'),('/private/path','absolute'),('src/a\\\\b','separator'),('src/a:b','colon'),('src/aux/file','component'),('src/a\\x01b','control')]\n  for value,predicate in cases:\n   with self.subTest(predicate=predicate),self.assertRaises(m.CheckpointError)as caught:m.source_relative(value,'filesystem-member')\n   error=caught.exception;self.assertEqual(error.args,('member-path',))\n   fields=m.source_failure_fields(error)['sourcePathFailure'];self.assertEqual(fields['predicate'],predicate)\n   if isinstance(value,str):self.assertEqual(fields['sha256'],hashlib.sha256(value.encode()).hexdigest())\n   if value=='src/aux/file':self.assertEqual(fields['name'],value)\n   else:self.assertNotIn('name',fields)\n def test_source_mode_only_and_unchanged_direct_guard(self):\n  for mode in (None,'pack','restore','mac-external-observe'):\n   m.SOURCE_PATH_MODE=mode\n   with self.assertRaises(m.CheckpointError)as caught:m.source_relative('src/aux','registry-key')\n   self.assertEqual(m.source_failure_fields(caught.exception),{})\n  m.SOURCE_PATH_MODE='source-record'\n  with self.assertRaises(m.CheckpointError)as caught:m.relative('src/aux')\n  self.assertEqual(m.source_failure_fields(caught.exception),{})\n def test_original_error_and_cause_survive_diagnostic_fault(self):\n  cause=RuntimeError('private cause');primary=m.CheckpointError('member-path');primary.__cause__=cause\n  with patch.object(m,'relative',side_effect=primary),patch.object(m,'source_path_failure',side_effect=RuntimeError('private reporting error')):\n   with self.assertRaises(m.CheckpointError)as caught:m.source_relative('src/aux','registry-key')\n  self.assertIs(caught.exception,primary);self.assertIs(primary.__cause__,cause)\n  self.assertEqual(m.source_failure_fields(primary),{'sourcePathFailureInvalid':True})\n  for unknown in (RuntimeError('private'),KeyboardInterrupt('private')):\n   with patch.object(m,'relative',side_effect=unknown):\n    with self.assertRaises(BaseException)as caught:m.source_relative('src/aux','registry-key')\n   self.assertIs(caught.exception,unknown)\n def test_malformed_optional_fields_never_leak_or_replace_primary(self):\n  good=m.source_path_failure('src/aux','filesystem-member')\n  for mutation in ({'name':'/private/secret'},{'name':'src/aux\\n'},{'bytes':True},{'sha256':'a'*64+'\\n'},{'mode':'pack'},{'phase':'private'},{'extra':'secret'}):\n   error=m.CheckpointError('member-path');value=copy.deepcopy(good);value.update(mutation);error.sourcePathFailure=value\n   self.assertEqual(m.source_failure_fields(error),{'sourcePathFailureInvalid':True});self.assertEqual(error.args,('member-path',))\n  error=m.CheckpointError('member-path');self.assertEqual(m.source_failure_fields(error),{})\n def test_registry_prefix_wrapper_keeps_exact_member_denial(self):\n  with self.assertRaises(m.CheckpointError)as caught:m.source_registry_repository('src/aux','https://public.example/src')\n  fields=m.source_failure_fields(caught.exception)['sourcePathFailure'];self.assertEqual(fields['phase'],'registry-key');self.assertEqual(fields['predicate'],'component');self.assertEqual(fields['name'],'src/aux')\nunittest.main(argv=['source-path-diagnostic-proof'])\n";
test("source path diagnostics preserve actual guard error objects and closed privacy predicates", () => {
  const result = python(SOURCE_PATH_DIAGNOSTIC_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 5 tests/);
});
test("archive failure projection keeps primary and cleanup while rejecting only malformed optional source facts", () => {
  const name = "src/aux/file",
    facts = {
      mode: "source-record",
      phase: "filesystem-member",
      predicate: "component",
      bytes: Buffer.byteLength(name),
      sha256: sha(Buffer.from(name)),
      name,
    };
  const base = {
    complete: false,
    error: "member-path",
    sourceCloseFailure: true,
    sourceJoinFailure: true,
  };
  const primary = {
    error: "member-path",
    archiveCleanupUnknown: true,
    sourceCloseFailure: true,
    sourceJoinFailure: true,
    exitCode: 1,
  };
  assert.deepEqual(
    archiveFailureRecord(JSON.stringify(base), 1, {
      cleanupUnknown: true,
      sourceMode: "source-record",
    }),
    primary,
  );
  assert.deepEqual(
    archiveFailureRecord(
      JSON.stringify({ ...base, sourcePathFailure: facts }),
      1,
      { cleanupUnknown: true, sourceMode: "source-record" },
    ),
    { ...primary, sourcePathFailure: facts },
  );
  const mutants = [
    null,
    [],
    "secret",
    { ...facts, mode: "pack" },
    { ...facts, phase: "secret" },
    { ...facts, predicate: "secret" },
    { ...facts, bytes: -1 },
    { ...facts, bytes: 1.5 },
    { ...facts, bytes: true },
    { ...facts, bytes: 4194305 },
    { ...facts, sha256: "a".repeat(64) + "\n" },
    { ...facts, sha256: "A".repeat(64) },
    { ...facts, name: "/private/secret" },
    { ...facts, name: "src/a\n" },
    { ...facts, name: "src/../secret" },
    { ...facts, name: "src/a:b" },
    { ...facts, name: "src/aux/file", sha256: "a".repeat(64) },
    { ...facts, extra: "secret" },
    { mode: "source-record" },
  ];
  for (const value of mutants) {
    const result = archiveFailureRecord(
      JSON.stringify({ ...base, sourcePathFailure: value }),
      1,
      { cleanupUnknown: true, sourceMode: "source-record" },
    );
    assert.deepEqual(result, { ...primary, sourcePathFailureInvalid: true });
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
  for (const value of [true, false, null, "secret"]) {
    assert.deepEqual(
      archiveFailureRecord(
        JSON.stringify({
          ...base,
          sourcePathFailure: facts,
          sourcePathFailureInvalid: value,
        }),
        1,
        { cleanupUnknown: true, sourceMode: "source-record" },
      ),
      { ...primary, sourcePathFailureInvalid: true },
    );
  }
  assert.deepEqual(
    archiveFailureRecord(
      JSON.stringify({
        complete: false,
        error: "member-path",
        sourcePathFailure: {
          mode: "source-verify",
          phase: "registry-key",
          predicate: "type",
          bytes: null,
          sha256: null,
        },
      }),
      1,
      { sourceMode: "source-verify" },
    ),
    {
      error: "member-path",
      sourcePathFailure: {
        mode: "source-verify",
        phase: "registry-key",
        predicate: "type",
        bytes: null,
        sha256: null,
      },
      exitCode: 1,
    },
  );
  for (const error of [
    "source-registry-name",
    "source-registry-kind",
    "source-registry-label",
    "source-registry-value",
  ]) {
    assert.deepEqual(
      archiveFailureRecord(JSON.stringify({ complete: false, error }), 1),
      { error, exitCode: 1 },
    );
  }
});
test(
  "actual helper CLI failure envelope reaches actual archiveCommand observer and existing checkpoint log",
  { timeout: 10000 },
  async (t) => {
    const folder = await scratch(t),
      helper = path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      executable = python("import sys;print(sys.executable)").stdout.trim(),
      script = path.join(folder, "closed-cli-fixture.py");
    assert(path.isAbsolute(executable));
    await writeFile(
      script,
      "HELPER=" +
        JSON.stringify(helper) +
        "\n" +
        "import ast,pathlib,types\nsource=pathlib.Path(HELPER).read_bytes();module=types.ModuleType('actual_helper');module.__file__=HELPER\nexec(compile(source,HELPER,'exec'),module.__dict__)\ndef fixture_main():\n module.SOURCE_PATH_MODE='source-record'\n module.SOURCE_CLOSE_FAILURE=True\n module.SOURCE_JOIN_FAILURE=True\n module.source_relative('src/aux/file','filesystem-member')\nmodule.main=fixture_main;module.__dict__['__name__']='__main__'\nstatement=ast.parse(source).body[-1]\nassert isinstance(statement,ast.If)\nexec(compile(ast.Module(body=[statement],type_ignores=[]),HELPER,'exec'),module.__dict__)\n",
      { flag: "wx" },
    );
    const records = [],
      lines = [];
    await assert.rejects(
      archiveCommand(executable, script, ["source-record"], {
        timeout: 3000,
        observeFailure: (record) => {
          records.push(record);
          checkpointLog(
            (line) => lines.push(line),
            "[cef-engineering-checkpoint] source-metadata-failure=" +
              canonical({ mode: "source-record", ...record }),
          );
        },
      }),
      /Checkpoint archive rejected/,
    );
    assert.equal(records.length, 1);
    assert.equal(lines.length, 1);
    assert.equal(records[0].error, "member-path");
    assert.equal(records[0].exitCode, 1);
    assert.equal(records[0].sourceCloseFailure, true);
    assert.equal(records[0].sourceJoinFailure, true);
    assert.equal(records[0].sourcePathFailure.name, "src/aux/file");
    assert.equal(records[0].sourcePathFailure.phase, "filesystem-member");
    assert.match(lines[0], /source-metadata-failure=/);
    assert.doesNotMatch(lines[0], /private|https:/);
  },
);
test(
  "actual Linux source-record CLI retains bounded offending path without changing original denial",
  {
    skip:
      process.platform !== "linux"
        ? "Actual Linux source-record child; portable actual CLI-envelope test runs on every OS"
        : false,
  },
  () => {
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const result = python(
      setup +
        "\nimport subprocess\nwith fixture(record=False)as(root,sidecar,identity):\n (root/'src/aux').write_bytes(b'public-source filename fixture')\n context=root.parent/'identity.json';context.write_text(json.dumps(identity))\n result=subprocess.run([sys.executable,'-I','-B',sys.argv[1],'source-record','--input',str(root),'--output',str(sidecar),'--manifest',str(context),'--seconds','5'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env={'PATH':str(pathlib.Path(sys.executable).parent)})\n assert result.returncode==1 and not sidecar.exists()\n value=json.loads(result.stdout);assert value['complete']is False and value['error']=='member-path'\n path=value['sourcePathFailure'];assert path['mode']=='source-record' and path['phase']=='filesystem-member' and path['predicate']=='component' and path['name']=='src/aux'\n assert not result.stderr\n print(json.dumps(value))\nprint('actual Linux source-record CLI failure transport PASS; no sidecar written')\n",
      [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const value = JSON.parse(result.stdout.split("\n")[0]);
    assert.equal(value.error, "member-path");
    assert.equal(value.sourcePathFailure.name, "src/aux");
    assert.deepEqual(
      archiveFailureRecord(JSON.stringify(value), 1, {
        sourceMode: "source-record",
      }).sourcePathFailure,
      value.sourcePathFailure,
    );
    assert.match(
      result.stdout,
      /actual Linux source-record CLI failure transport PASS/,
    );
  },
);

test("actual archive failure body preserves primary through optional validator exceptions", () => {
  for (const reason of [null, false, new Error("private diagnostic error")]) {
    const actual = new Function(
      "LIMITS",
      "ARCHIVE_FAILURES",
      "sourcePathFailure",
      "return (" + archiveFailureRecord.toString() + ")",
    )(LIMITS, new Set(["member-path"]), () => {
      throw reason;
    });
    assert.deepEqual(
      actual(
        JSON.stringify({
          complete: false,
          error: "member-path",
          sourceCloseFailure: true,
          sourcePathFailure: {},
        }),
        1,
        { cleanupUnknown: true, sourceMode: "source-record" },
      ),
      {
        error: "member-path",
        sourceCloseFailure: true,
        archiveCleanupUnknown: true,
        sourcePathFailureInvalid: true,
        exitCode: 1,
      },
    );
  }
});

test(
  "actual archiveCommand binds source diagnostics to caller mode and rejects pack restore masquerades",
  { timeout: 20000 },
  async (t) => {
    const folder = await scratch(t),
      executable = python("import sys;print(sys.executable)").stdout.trim(),
      script = path.join(folder, "untrusted-helper-fixture.py"),
      name = "src/aux/file";
    const facts = {
      mode: "source-record",
      phase: "filesystem-member",
      predicate: "component",
      bytes: Buffer.byteLength(name),
      sha256: sha(Buffer.from(name)),
      name,
    };
    const payload = {
      complete: false,
      error: "member-path",
      sourceCloseFailure: true,
      sourceJoinFailure: true,
      sourcePathFailure: facts,
    };
    await writeFile(
      script,
      "import sys\nsys.stdout.write(" +
        JSON.stringify(JSON.stringify(payload) + "\n") +
        ")\nraise SystemExit(1)\n",
      { flag: "wx" },
    );
    for (const mode of [
      "pack",
      "restore",
      null,
      "source-invented",
      "source-verify",
      "source-apply",
    ]) {
      const records = [];
      await assert.rejects(
        archiveCommand(executable, script, mode === null ? [] : [mode], {
          timeout: 3000,
          observeFailure: (r) => records.push(r),
        }),
        /Checkpoint archive rejected/,
      );
      assert.equal(records.length, 1);
      assert.equal(Object.hasOwn(records[0], "sourcePathFailure"), false);
      if (mode === "source-verify" || mode === "source-apply")
        assert.deepEqual(records[0], {
          error: "member-path",
          sourceCloseFailure: true,
          sourceJoinFailure: true,
          sourcePathFailureInvalid: true,
          exitCode: 1,
        });
      else assert.deepEqual(records[0], { error: "unknown", exitCode: 1 });
    }
    assert.deepEqual(
      archiveFailureRecord(
        JSON.stringify({ ...payload, error: "source-changed" }),
        1,
        { sourceMode: "source-record" },
      ),
      { error: "unknown", exitCode: 1 },
    );
  },
);

const SOURCE_SIDECAR_SIZING_PROOF =
  "import pathlib,sys,types,tempfile,json,hashlib,stat,unittest\nfrom unittest.mock import patch\nm=types.ModuleType('source_sizing_candidate');m.__file__=sys.argv[1]\nexec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)\nclass SizedBytes(bytes):\n def __new__(cls,size):value=super().__new__(cls,b'{}');value.virtual_size=size;return value\n def __len__(self):return self.virtual_size\nclass Serialized(str):\n def __new__(cls,size):value=super().__new__(cls,'{}');value.virtual_size=size;return value\n def __add__(self,other):return self\n def encode(self,*a,**k):return SizedBytes(self.virtual_size)\nclass SizingProof(unittest.TestCase):\n def value(self,work):\n  identity={k:'a'*64 for k in ['source','producer','tools','graph','siso']};identity.update(canonicalRoot=str(work),target='aarch64-unknown-linux-gnu',image='20261023.334.3')\n  return {'schemaVersion':1,'kind':'sorng-linuxarm-source-metadata','policy':m.SOURCE_METADATA_POLICY,'sourceDateEpoch':m.SOURCE_METADATA_DATE_EPOCH,'identity':identity,'snapshot':{}}\n def test_dedicated_limit_and_known_precharge_with_no_large_allocation(self):\n  self.assertEqual(m.MAX_METADATA,128*1024**2);self.assertEqual(m.SOURCE_METADATA_MAX_BYTES,512*1024**2)\n  self.assertEqual(m.source_metadata_limit(),m.MAX_METADATA);self.assertEqual(m.source_metadata_limit(True),m.SOURCE_METADATA_MAX_BYTES)\n  for size in (202657645,m.SOURCE_METADATA_MAX_BYTES):self.assertIsNone(m.source_metadata_precharge(size,True))\n  for size,owned in ((202657645,False),(m.MAX_METADATA+1,False),(m.SOURCE_METADATA_MAX_BYTES+1,True),(-1,True),(True,True),(1.5,True)):\n   with self.subTest(size=size,owned=owned),self.assertRaisesRegex(m.CheckpointError,'source-sidecar-bound'):m.source_metadata_precharge(size,owned)\n  self.assertIsNone(m.source_metadata_precharge(m.MAX_METADATA,False))\n  for flag in (1,None,{},'true'):\n   with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):m.source_metadata_limit(flag)\n def test_actual_reader_virtual_stat_rejects_before_open(self):\n  for owned,size,allowed in [(False,m.MAX_METADATA,True),(False,m.MAX_METADATA+1,False),(True,m.MAX_METADATA+1,True),(True,m.SOURCE_METADATA_MAX_BYTES,True),(True,m.SOURCE_METADATA_MAX_BYTES+1,False)]:\n   opened=[];primary=RuntimeError('owned open boundary')\n   class Input:\n    def __fspath__(self):return '/owned/'+m.SOURCE_METADATA_NAME\n    def stat(self):return types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_nlink=1,st_size=size)\n    def open(self,*args):opened.append(True);raise primary\n   item=Input()\n   with self.subTest(owned=owned,size=size),patch.object(m,'safe',return_value=item):\n    try:m.source_read_sidecar(item,m.Budget(5),owned_sidecar=owned)\n    except BaseException as error:\n     if allowed:self.assertIs(error,primary);self.assertEqual(opened,[True])\n     else:self.assertIs(type(error),m.CheckpointError);self.assertEqual(str(error),'source-metadata-read-bound');self.assertEqual(opened,[])\n    else:self.fail('virtual reader unexpectedly returned')\n def test_owned_reader_leaf_and_external_default(self):\n  with patch.object(m,'source_read_bytes',return_value=b'{}')as read:\n   self.assertEqual(m.source_read_sidecar(pathlib.Path('/external/report.json'),m.Budget(5)),{})\n   self.assertEqual(read.call_args.args[2],m.MAX_METADATA)\n   with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):m.source_read_sidecar(pathlib.Path('/external/report.json'),m.Budget(5),owned_sidecar=True)\n   self.assertEqual(read.call_count,1)\n def test_actual_writer_virtual_length_rejects_before_open(self):\n  for owned,size,allowed in [(False,m.MAX_METADATA,True),(False,m.MAX_METADATA+1,False),(True,m.MAX_METADATA+1,True),(True,m.SOURCE_METADATA_MAX_BYTES,True),(True,m.SOURCE_METADATA_MAX_BYTES+1,False)]:\n   opened=[];primary=RuntimeError('owned writer open boundary');work=pathlib.Path('/owned/work');value=self.value(work)\n   class Root:\n    def __fspath__(self):return str(work/'source/src/out/Release_GN_arm64')\n    def __truediv__(self,name):return self\n    def open(self,*args):opened.append(True);raise primary\n   with self.subTest(owned=owned,size=size),patch.object(m.json,'dumps',return_value=Serialized(size)):\n    try:m.metadata(Root(),m.SOURCE_METADATA_NAME,value,source=True,owned_sidecar=owned)\n    except BaseException as error:\n     if allowed:self.assertIs(error,primary);self.assertEqual(opened,[True])\n     else:self.assertIs(type(error),m.CheckpointError);self.assertEqual(str(error),'metadata-bound');self.assertEqual(opened,[])\n    else:self.fail('virtual writer unexpectedly returned')\n def test_wrong_role_cannot_expand_external_or_generic_writer(self):\n  work=pathlib.Path('/owned/work');root=work/'source/src/out/Release_GN_arm64';good=self.value(work)\n  for name,source,value in [('report.json',True,good),(m.SOURCE_METADATA_NAME,False,good),(m.SOURCE_METADATA_NAME,True,{**good,'kind':'sorng-mac-external-inputs'}),(m.SOURCE_METADATA_NAME,True,{**good,'schemaVersion':True})]:\n   with self.subTest(name=name,source=source),patch.object(m.json,'dumps')as dump:\n    with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-role'):m.metadata(root,name,value,source=source,owned_sidecar=True)\n    dump.assert_not_called()\n def test_tiny_actual_owned_writer_and_external_default_remain_exact(self):\n  with tempfile.TemporaryDirectory(prefix='owned-sidecar-writer-')as folder:\n   work=pathlib.Path(folder).resolve();root=work/'source/src/out/Release_GN_arm64';root.mkdir(parents=True);value=self.value(work)\n   pin=m.metadata(root,m.SOURCE_METADATA_NAME,value,source=True,owned_sidecar=True);raw=(root/m.SOURCE_METADATA_NAME).read_bytes()\n   expected=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\\n').encode()\n   self.assertEqual(raw,expected);self.assertEqual(pin,{'name':m.SOURCE_METADATA_NAME,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})\n   with self.assertRaises(FileExistsError):m.metadata(root,m.SOURCE_METADATA_NAME,value,source=True,owned_sidecar=True)\n   with patch.object(m,'MAX_METADATA',1):\n    with self.assertRaisesRegex(m.CheckpointError,'metadata-bound'):m.metadata(root,'external-report.json',{},source=True)\n   self.assertFalse((root/'external-report.json').exists())\n def test_owned_writer_short_flush_and_close_errors_preserve_original(self):\n  work=pathlib.Path('/owned/work');value=self.value(work)\n  for outcome in ('short','flush','close'):\n   closed=[];primary=RuntimeError('private primary');secondary=RuntimeError('private secondary')\n   class Stream:\n    def write(self,data):return len(data)-1 if outcome=='short' else len(data)\n    def flush(self):\n     if outcome=='flush':raise primary\n    def close(self):closed.append(True);raise primary if outcome=='close' else secondary\n   class Root:\n    def __fspath__(self):return str(work/'source/src/out/Release_GN_arm64')\n    def __truediv__(self,name):return self\n    def open(self,*args):return Stream()\n   m.SOURCE_CLOSE_FAILURE=False\n   with self.subTest(outcome=outcome):\n    try:m.metadata(Root(),m.SOURCE_METADATA_NAME,value,source=True,owned_sidecar=True)\n    except BaseException as error:\n     if outcome=='short':self.assertIs(type(error),m.CheckpointError);self.assertEqual(str(error),'short-write')\n     else:self.assertIs(error,primary)\n    else:self.fail('owned writer error was lost')\n    self.assertEqual(closed,[True]);self.assertTrue(m.SOURCE_CLOSE_FAILURE)\nunittest.main(argv=['source-sidecar-sizing-proof'])\n";
test("dedicated source-sidecar bounds use actual reader writer and counters without giant allocation", () => {
  const result = python(SOURCE_SIDECAR_SIZING_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 7 tests/);
});
test("source descriptor512MiB is separate from ordinary128MiB checkpoint metadata", () => {
  assert.equal(SOURCE_METADATA_MAX_BYTES, 512 * 1024 ** 2);
  assert.equal(LIMITS.metadata, 128 * 1024 ** 2);
  const value = {
    complete: true,
    mode: "source-record",
    entries: 1,
    bytes: 0,
    sidecar: asset(
      ".siso_sorng_source_metadata.json",
      SOURCE_METADATA_MAX_BYTES,
    ),
  };
  assert.equal(sourceMetadataResult(value, "source-record"), value);
  for (const bytes of [
    SOURCE_METADATA_MAX_BYTES + 1,
    0,
    1.5,
    Number.MAX_SAFE_INTEGER,
  ])
    assert.throws(() =>
      sourceMetadataResult(
        { ...value, sidecar: { ...value.sidecar, bytes } },
        "source-record",
      ),
    );
  const ordinary = manifest();
  ordinary.archive.inventory.bytes = LIMITS.metadata;
  assert.doesNotThrow(() => validateManifest(ordinary));
  ordinary.archive.inventory.bytes = LIMITS.metadata + 1;
  assert.throws(() => validateManifest(ordinary));
});
test(
  "Linux tiny owned-source sidecar survives unchanged checkpoint transport and same-root source verification",
  {
    skip:
      process.platform !== "linux"
        ? "Actual Linux checkpoint/source transaction; portable bounds run everywhere"
        : false,
  },
  () => {
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const result = python(
      setup +
        "\nimport hashlib\n" +
        "\nwith fixture()as(root,sidecar,identity):\n original=sidecar.read_bytes();bundle=root.parent/'tiny-checkpoint';out=sidecar.parent;old_out=root.parent/'owned-old-out'\n archive=m.pack(out,bundle,seconds=10,chunk_size=4096)\n inventory=json.loads((bundle/archive['inventory']['name']).read_bytes())\n row=next(r for r in inventory['files']if r['path']==m.SOURCE_METADATA_NAME)\n assert row['sha256']==hashlib.sha256(original).hexdigest()\n assert archive['inventory']['bytes']<=m.MAX_METADATA\n out.rename(old_out)\n m.restore(bundle,out,archive,seconds=10)\n assert sidecar.read_bytes()==original\n assert m.source_metadata('source-verify',root,sidecar,identity,10)['complete']\n p=root/'src/input.cc';s=p.stat();os.utime(p,ns=(s.st_atime_ns,s.st_mtime_ns+1000000000))\n assert m.source_metadata('source-apply',root,sidecar,identity,10)['complete']\n assert sidecar.read_bytes()==original\nprint('tiny owned-source sidecar ordinary checkpoint pack/restore/hash and apply/verify PASS')\n",
      [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /ordinary checkpoint pack\/restore\/hash and apply\/verify PASS/,
    );
  },
);

const LINUX_SOURCE_BASELINE_SHA256 =
  "398aa93fc914e305e9856466db00164de7b91eaa0904438f32364ea5ca3d8659";
const LINUX_SOURCE_BASELINE_GZIP =
  "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";
const SOURCE_METADATA_PROOF = String.raw`import types, pathlib, tempfile, os, json, copy, unittest, time
from contextlib import contextmanager
from unittest.mock import patch
import sys
m=types.ModuleType('owned_source_helper');m.__file__=sys.argv[1]
exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)
@contextmanager
def fixture(record=True):
 with tempfile.TemporaryDirectory(prefix='sorng-source-metadata-') as folder:
  work=pathlib.Path(folder).resolve();root=work/'source';out=root/'src/out/Release_GN_arm64';out.mkdir(parents=True);(root/'src/cef/include').mkdir(parents=True);(root/'depot_tools').mkdir();(root/'.gclient_entries').write_text("entries = {'src': 'https://public.example/src'}\n")
  for name in ['src','src/cef','depot_tools']:
   admin=root/name/'.git';admin.mkdir();(admin/'HEAD').write_text('a'*40+'\n')
  for name in ['src/input.cc','src/cef/include/generated.h','src/.ignored-but-input','depot_tools/helper.py','src/__pycache__/already_owned.pyc','src/third_party/cpython3/linux-amd64/bin/python3']:
   p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(('owned '+name+'\n').encode())
  os.symlink('linux-amd64',root/'src/third_party/cpython3/host')
  identity={k:'a'*64 for k in ['source','producer','tools','graph','siso']};identity.update(target='aarch64-unknown-linux-gnu',canonicalRoot=str(work),image='20261023.334.3');sidecar=out/m.SOURCE_METADATA_NAME
  if record:m.source_metadata('source-record',root,sidecar,identity,60)
  yield root,sidecar,identity
class SourceMetadataProof(unittest.TestCase):
 def test_diagnostic_only_acquisition_logs_excluded_but_other_logs_are_inputs(self):
  with fixture(record=False)as(root,sidecar,identity):
   logs=root/'acquisition-logs';logs.mkdir();(logs/'result.json').write_bytes(b'first PID and time')
   (root/'src/compiler.log').write_bytes(b'input with a log suffix')
   m.source_metadata('source-record',root,sidecar,identity,60)
   (logs/'result.json').write_bytes(b'different PID and time')
   self.assertTrue(m.source_metadata('source-verify',root,sidecar,identity,60)['complete'])
   (root/'src/compiler.log').write_bytes(b'changed input')
   with self.assertRaisesRegex(m.CheckpointError,'source-content-changed|source-repository-or-total-changed'):m.source_metadata('source-apply',root,sidecar,identity,60)
  for kind in ['link','file']:
   with self.subTest(kind=kind),fixture(record=False)as(root,sidecar,identity):
    if kind=='link':os.symlink('src',root/'acquisition-logs')
    else:(root/'acquisition-logs').write_bytes(b'not directory')
    with self.assertRaisesRegex(m.CheckpointError,'source-diagnostic-root'):m.source_metadata('source-record',root,sidecar,identity,60)
 def test_links_into_excluded_regions_deny_before_target_metadata(self):
  for target in ['.git/config','out/generated.h','../acquisition-logs/result.json']:
   with self.subTest(target=target),fixture(record=False)as(root,sidecar,identity):
    (root/'src/.git/config').write_bytes(b'first input')
    (root/'src/out/generated.h').write_bytes(b'generated output')
    logs=root/'acquisition-logs';logs.mkdir();(logs/'result.json').write_bytes(b'owned diagnostic')
    os.symlink(target,root/'src/config-link')
    original=pathlib.Path.lstat
    blocked={root/'src/.git',root/'src/out',logs}
    def no_excluded_target(path,*args,**kwargs):
     if path in blocked:raise AssertionError('link must deny before excluded target metadata')
     return original(path,*args,**kwargs)
    with patch.object(pathlib.Path,'lstat',autospec=True,side_effect=no_excluded_target):
     with self.assertRaisesRegex(m.CheckpointError,'source-excluded-link'):m.source_link_target(root,root/'src/config-link',target,m.Budget(60))
    with self.assertRaisesRegex(m.CheckpointError,'source-excluded-link'):m.source_metadata('source-record',root,sidecar,identity,60)
 def test_record_apply_same_hash_and_all_ignored_generated_tool_inputs(self):
  with fixture() as (root,sidecar,identity):
   old=json.loads(sidecar.read_bytes());self.assertEqual(old['sourceDateEpoch'],'1790626028');paths={r['path']for r in old['snapshot']['entries']}
   for name in ['src/input.cc','src/cef/include/generated.h','src/.ignored-but-input','depot_tools/helper.py','src/__pycache__/already_owned.pyc','src/third_party/cpython3/host']:self.assertIn(name,paths)
   self.assertFalse(any('/.git' in n or n.startswith('src/out')for n in paths))
   for name in ['src/input.cc','src/cef/include/generated.h','src/.ignored-but-input','depot_tools/helper.py','src/__pycache__/already_owned.pyc']:
    p=root/name;s=p.stat();os.utime(p,ns=(s.st_atime_ns,s.st_mtime_ns+1000000000))
   with self.assertRaisesRegex(m.CheckpointError,'source-metadata-postcheck'):m.source_metadata('source-verify',root,sidecar,identity,60)
   self.assertTrue(m.source_metadata('source-apply',root,sidecar,identity,60)['complete'])
   self.assertTrue(m.source_metadata('source-verify',root,sidecar,identity,60)['complete'])
   self.assertEqual(m.source_snapshot(root,m.Budget(60)),old['snapshot'])
 def test_no_timestamp_write_before_all_content_hashes_pass(self):
  for change in ['bytes','extra','missing','mode','generated-header','pycache']:
   with self.subTest(change=change),fixture() as (root,sidecar,identity):
    p=root/'src/input.cc'
    if change=='bytes':p.write_bytes(b'changed')
    elif change=='extra':(root/'src/untracked-input').write_bytes(b'new')
    elif change=='missing':p.unlink()
    elif change=='mode':p.chmod(p.stat().st_mode^0o100)
    elif change=='generated-header':(root/'src/cef/include/generated.h').write_bytes(b'changed')
    elif change=='pycache':(root/'src/__pycache__/new.pyc').write_bytes(b'new')
    with patch.object(m.os,'utime',side_effect=AssertionError('no timestamp write before complete match')) as writes:
     with self.assertRaisesRegex(m.CheckpointError,'source-content-changed|source-repository-or-total-changed'):m.source_metadata('source-apply',root,sidecar,identity,60)
     writes.assert_not_called()
 def test_every_identity_and_policy_mismatch_denies(self):
  for key in ['source','producer','tools','graph','siso','target','canonicalRoot','image','policy','sourceDateEpoch','extra']:
   with self.subTest(key=key),fixture() as (root,sidecar,identity):
    value=json.loads(sidecar.read_bytes())
    if key in ('policy','sourceDateEpoch'):value[key]='unknown'
    elif key=='extra':value['extra']=True
    else:value['identity'][key]='wrong'
    sidecar.write_text(json.dumps(value))
    with patch.object(m.os,'utime',side_effect=AssertionError('no writes')) as writes:
     with self.assertRaisesRegex(m.CheckpointError,'source-sidecar-binding'):m.source_metadata('source-apply',root,sidecar,identity,60)
     writes.assert_not_called()
 def test_missing_old_sidecar_rejects_before_source_scan(self):
  with fixture(record=False) as (root,sidecar,identity),patch.object(m,'source_snapshot',side_effect=AssertionError('old checkpoint must not scan')) as scan:
   with self.assertRaises(FileNotFoundError):m.source_metadata('source-apply',root,sidecar,identity,60)
   scan.assert_not_called()
 def test_repo_head_unknown_admin_and_external_link_deny(self):
  for change in ['head','unknown-git','external-link','hardlink','alias']:
   with self.subTest(change=change),fixture() as (root,sidecar,identity):
    if change=='head':(root/'src/.git/HEAD').write_text('b'*40+'\n')
    elif change=='unknown-git':
     p=root/'src/unregistered/.git';p.mkdir(parents=True);(p/'HEAD').write_text('a'*40+'\n')
    elif change=='external-link':os.symlink('/etc/passwd',root/'src/external')
    elif change=='hardlink':os.link(root/'src/input.cc',root/'src/aliased.cc')
    else:(root/'src/INPUT.cc').write_bytes(b'case alias')
    with patch.object(m.os,'utime',side_effect=AssertionError('no writes')) as writes:
     with self.assertRaises(m.CheckpointError):m.source_metadata('source-apply',root,sidecar,identity,60)
     writes.assert_not_called()
 def test_bound_and_original_deadline_denials(self):
  for key,value in [('SOURCE_MAX_ENTRIES',1),('SOURCE_MAX_FILE',1),('MAX_RAW',1),('SOURCE_METADATA_MAX_BYTES',128)]:
   with self.subTest(bound=key),fixture(record=False) as (root,sidecar,identity),patch.object(m,key,value):
    with self.assertRaises(m.CheckpointError):m.source_metadata('source-record',root,sidecar,identity,60)
    self.assertFalse(sidecar.exists())
  with fixture(record=False) as (root,sidecar,identity):
   budget=m.Budget(1);budget.end=time.monotonic()-1
   with self.assertRaisesRegex(m.CheckpointError,'archive-deadline'):m.source_metadata('source-record',root,sidecar,identity,60,budget=budget)
 def test_invalid_mtime_and_symlink_literal_cannot_bypass_namespace(self):
  for change in ['mtime','link']:
   with self.subTest(change=change),fixture() as (root,sidecar,identity):
    value=json.loads(sidecar.read_bytes());row=next(r for r in value['snapshot']['entries']if r['kind']==('symlink'if change=='link'else'file'))
    if change=='mtime':row['mtimeNs']='-1'
    else:row['target']='../../../../etc/passwd'
    sidecar.write_text(json.dumps(value))
    with patch.object(m.os,'utime',side_effect=AssertionError('no writes')):
     with self.assertRaises(m.CheckpointError):m.source_metadata('source-apply',root,sidecar,identity,60)
 def test_source_read_primary_identity_and_close_only_error_objects(self):
  with fixture(record=False) as (root,sidecar,identity):
   p=root/'src/input.cc';original=pathlib.Path.open;primary=m.CheckpointError('source-file-changed');secondary=OSError('owned close fault')
   class Reader:
    def __init__(self,s,fail):self.s=s;self.fail=fail
    def fileno(self):return self.s.fileno()
    def read(self,n):
     if self.fail:raise primary
     return self.s.read(n)
    def close(self):self.s.close();raise secondary
   for fail in [True,False]:
    m.SOURCE_CLOSE_FAILURE=False
    def opened(path,*args,**kwargs):
     s=original(path,*args,**kwargs);return Reader(s,fail)if path==p and args==('rb',)else s
    with patch.object(pathlib.Path,'open',autospec=True,side_effect=opened):
     with self.assertRaises(BaseException)as caught:m.source_read_bytes(p,m.Budget(60),1024)
     self.assertIs(caught.exception,primary if fail else secondary)
    self.assertTrue(m.SOURCE_CLOSE_FAILURE)
 def test_internal_link_chain_and_external_target_never_followed(self):
  with fixture(record=False)as(root,sidecar,identity):
   os.symlink('host',root/'src/third_party/cpython3/host_alias')
   self.assertTrue(m.source_metadata('source-record',root,sidecar,identity,60)['complete'])
  with fixture(record=False)as(root,sidecar,identity):
   os.symlink('/etc/passwd',root/'src/external')
   original=pathlib.Path.lstat
   def no_external(path,*args,**kwargs):
    if str(path)=='/etc/passwd':raise AssertionError('external target metadata must not be read')
    return original(path,*args,**kwargs)
   with patch.object(pathlib.Path,'lstat',autospec=True,side_effect=no_external):
    with self.assertRaisesRegex(m.CheckpointError,'source-external-link'):m.source_metadata('source-record',root,sidecar,identity,60)
 def test_duplicate_keys_and_numeric_type_substitution_deny(self):
  with self.assertRaisesRegex(m.CheckpointError,'source-json-duplicate'):m.source_json(b'{"a":1,"a":2}')
  for key in ['schema','mode','size']:
   with self.subTest(key=key),fixture()as(root,sidecar,identity):
    value=json.loads(sidecar.read_bytes())
    if key=='schema':value['schemaVersion']=True
    else:
     row=next(r for r in value['snapshot']['entries']if r['kind']=='file');row[key]=float(row[key])
    sidecar.write_text(json.dumps(value))
    with patch.object(m.os,'utime',side_effect=AssertionError('no writes')):
     with self.assertRaises(m.CheckpointError):m.source_metadata('source-apply',root,sidecar,identity,60)
 def test_worker_first_failure_survives_join_failure_and_all_workers_join(self):
  import concurrent.futures
  with fixture(record=False)as(root,sidecar,identity):
   original=concurrent.futures.ThreadPoolExecutor.shutdown;primary=m.CheckpointError('source-file-changed');secondary=OSError('owned shutdown fault');joined=[]
   def shutdown(pool,*args,**kwargs):original(pool,*args,**kwargs);joined.append(True);raise secondary
   m.SOURCE_JOIN_FAILURE=False
   with patch.object(m,'source_hash',side_effect=primary),patch.object(concurrent.futures.ThreadPoolExecutor,'shutdown',shutdown):
    with self.assertRaises(m.CheckpointError)as caught:m.source_snapshot(root,m.Budget(60))
    self.assertIs(caught.exception,primary)
   self.assertEqual(joined,[True]);self.assertTrue(m.SOURCE_JOIN_FAILURE)
 def test_namespace_race_after_hash_denies_before_metadata_writes(self):
  import threading
  with fixture()as(root,sidecar,identity):
   original=m.source_hash;changed=[];lock=threading.Lock()
   def hash_then_change(*args,**kwargs):
    value=original(*args,**kwargs)
    with lock:
     if not changed:(root/'src/late-input').write_bytes(b'late');changed.append(True)
    return value
   with patch.object(m,'source_hash',side_effect=hash_then_change),patch.object(m.os,'utime',side_effect=AssertionError('no writes'))as writes:
    with self.assertRaisesRegex(m.CheckpointError,'source-tree-changed'):m.source_metadata('source-apply',root,sidecar,identity,60)
    writes.assert_not_called()
 def test_no_file_bytes_or_metadata_writes_outside_owned_root(self):
  with fixture(record=False)as(root,sidecar,identity):
   bad=dict(identity,canonicalRoot=str(root.parent.parent))
   with self.assertRaisesRegex(m.CheckpointError,'source-fixed-paths'):m.source_metadata('source-record',root,sidecar,bad,60)
   with self.assertRaisesRegex(m.CheckpointError,'source-fixed-paths'):m.source_metadata('source-record',root,sidecar.with_name('arbitrary.json'),identity,60)
unittest.main(argv=['owned-source-proof'],verbosity=1)
`;

test("source metadata closed Linux plan, exact bounded results and fixed cache environment", () => {
  const target = "aarch64-unknown-linux-gnu";
  const selected = {
    ...identity,
    target,
    source: checkpointProfile(target).source,
    canonicalRoot: "/owned",
  };
  const out = "/owned/source/src/out/Release_GN_arm64";
  assert.deepEqual(sourceMetadataPlan(selected, out, "source-record"), {
    mode: "source-record",
    source: "/owned/source",
    sidecar: out + "/.siso_sorng_source_metadata.json",
  });
  for (const mode of ["source-record", "source-apply", "source-verify"]) {
    const good = {
      complete: true,
      mode,
      entries: 1,
      bytes: 0,
      ...(mode === "source-record"
        ? { sidecar: asset(".siso_sorng_source_metadata.json", 1) }
        : {}),
    };
    assert.equal(sourceMetadataResult(good, mode), good);
    for (const bad of [
      { ...good, complete: false },
      { ...good, entries: 1000001 },
      { ...good, bytes: 256 * 1024 ** 3 + 1 },
      { ...good, extra: true },
      { ...good, entries: -1 },
    ])
      assert.throws(() => sourceMetadataResult(bad, mode));
  }
  assert.throws(() =>
    sourceMetadataPlan(selected, out + "/../other", "source-apply"),
  );
  assert.throws(() => sourceMetadataPlan(selected, out, "unknown"));
  assert.throws(() =>
    sourceMetadataResult(
      { complete: true, mode: "unknown", entries: 1, bytes: 0 },
      "unknown",
    ),
  );
  assert.throws(() =>
    sourceMetadataPlan(
      { ...selected, canonicalRoot: "/owned/../other" },
      out,
      "source-record",
    ),
  );
  const map = {
    target,
    path: [],
    environment: {
      PYTHONPYCACHEPREFIX: "/untrusted/cache",
      PYTHONDONTWRITEBYTECODE: "0",
      SOURCE_DATE_EPOCH: "untrusted",
    },
  };
  const locations = {
    toolsRoot: "/tools",
    source: "/owned/source",
    depot: "/owned/source/depot_tools",
    python: "/tools/python3",
  };
  const old = buildEnvironment(map, locations, { PATH: "/bin" });
  assert.equal(old.PYTHONPYCACHEPREFIX, "/untrusted/cache");
  assert.equal(old.PYTHONDONTWRITEBYTECODE, "0");
  assert.equal(old.SOURCE_DATE_EPOCH, "untrusted");
  const current = buildEnvironment(map, locations, { PATH: "/bin" }, true);
  assert.equal(current.PYTHONPYCACHEPREFIX, undefined);
  assert.equal(current.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(current.SOURCE_DATE_EPOCH, SOURCE_METADATA_DATE_EPOCH);
  assert.throws(() =>
    buildEnvironment(
      { ...map, target: "x86_64-apple-darwin" },
      locations,
      {},
      true,
    ),
  );
  assert.throws(() => buildEnvironment(map, locations, {}, "true"));
});

test(
  "source metadata actual Linux production functions validate all bytes before timestamp writes",
  {
    skip:
      process.platform !== "linux"
        ? "Linux-only metadata writes; portable contracts run on every OS"
        : false,
  },
  () => {
    const result = python(SOURCE_METADATA_PROOF, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Ran 15 tests/);
  },
);

test("source metadata actual restored graph callback order stops before GN or compiler on failure", async () => {
  const source = await readFile(
    path.join(ROOT, "scripts/lib/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = tree.statements
    .find(
      (n) =>
        ts.isFunctionDeclaration(n) && n.name?.text === "restoreVerifiedGraph",
    )
    .getText(tree)
    .replace(/^export /, "");
  const ordered = [
    "restored-graph",
    "adjacent-install",
    "source-before-gn",
    "fresh-gn",
    "fresh-graph",
    "generated-bindings",
    "source-after-gn",
  ];
  for (const failAt of [
    null,
    "source-before-gn",
    "fresh-gn",
    "source-after-gn",
  ]) {
    const calls = [],
      original = Error("owned source metadata failure");
    const call = (name) => {
      calls.push(name);
      if (name === failAt) throw original;
    };
    const restore = new Function(
      "assert",
      "restorePhase",
      "verifyGraph",
      "installRestoredDirectory",
      "return (" + declaration + ")",
    )(
      assert,
      restorePhase,
      async (root) =>
        call(root === "restored" ? "restored-graph" : "fresh-graph"),
      async () => call("adjacent-install"),
    );
    const operation = restore({
      fresh: "fresh",
      restored: "restored",
      expectedGraph: "verified",
      revalidateGn: async () => call("fresh-gn"),
      verifyGenerated: async () => call("generated-bindings"),
      beforeAuthoritativeGn: async () => call("source-before-gn"),
      afterAuthoritativeGn: async () => call("source-after-gn"),
    });
    if (failAt) {
      await assert.rejects(operation, (error) => error === original);
      assert.deepEqual(calls, ordered.slice(0, ordered.indexOf(failAt) + 1));
    } else {
      await operation;
      assert.deepEqual(calls, ordered);
    }
  }
});

test("source metadata production CLI verifies closure before either SDK continuation or checkpoint pack", async () => {
  const cli = await readFile(
    path.join(ROOT, "scripts/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const compile = cli.slice(
    cli.indexOf("async compile(context)"),
    cli.indexOf("async compile(context)") + 7000,
  );
  const verify = compile.indexOf(
    'context.checkpoint.sourceMetadata("source-verify")',
  );
  assert(verify > compile.indexOf("compileSlice("));
  assert(verify < compile.indexOf('kind: "continue-sdk"'));
  assert(verify < compile.indexOf('checkpointPhase("pack"'));
  assert.match(
    cli,
    /if\s*\(sourceMetadata\s*&&\s*!resumedSource\)\s*await sourceMetadata\("source-record"\)/,
  );
  assert.match(
    cli,
    /sourceMetadata:\s*TARGET === "aarch64-unknown-linux-gnu"\s*\?\s*true/,
  );
  assert.match(cli, /TARGET === "aarch64-apple-darwin"\s*\?\s*"mac-arm"/);
});

test("source metadata helper failures retain only fixed labels and separate cleanup flags", () => {
  assert.deepEqual(
    archiveFailureRecord(
      JSON.stringify({
        complete: false,
        error: "source-content-changed",
        sourceCloseFailure: true,
        sourceJoinFailure: true,
      }),
      1,
    ),
    {
      error: "source-content-changed",
      exitCode: 1,
      sourceCloseFailure: true,
      sourceJoinFailure: true,
    },
  );
  for (const value of [
    { complete: false, error: "private/path", sourceCloseFailure: true },
    {
      complete: false,
      error: "source-content-changed",
      sourceCloseFailure: "private",
    },
    { complete: false, error: "source-content-changed", private: "private" },
  ])
    assert.equal(
      archiveFailureRecord(JSON.stringify(value), 1).error,
      "unknown",
    );
});

const CEF_EPOCH_COMMIT = String.raw`tree 6c3ac976c98edc5f49b2a9f1de95dc93bbc32e9a
parent 3e7bc502d6c5abb63dd1da8142c900f6f91c5966
author Marshall Greenblatt <magreenblatt@gmail.com> 1790625937 -0400
committer Marshall Greenblatt <magreenblatt@gmail.com> 1790626028 -0400

ceftests: Speculative fix for flaky MediaAccessTest
`;
const CEF_EPOCH_HASH_PREDICATE = String.raw`def compute_api_hashes(api_version: str,
                       hasher: CefApiHasher,
                       next_allowed: bool,
                       src_dir: str) -> Dict[str, str]:
  """ Computes API hashes for the specified |api_version|. """
  if not next_allowed:
    # Next usage is banned with explicit API versions.
    assert api_version not in UNTRACKED_VERSIONS, api_version
    added_defines = [
        # Using CEF_API_VERSION_NEXT is an error.
        'CEF_API_VERSION_NEXT="Please_specify_an_exact_CEF_version"',
    ]
  else:
    added_defines = []

  hashes = hasher.calculate(api_version, added_defines)
  if hashes:
    # Add sandbox compatibility hash.
    sandbox_files = [os.path.join(src_dir, f) for f in SANDBOX_COMPAT_FILES]
    hashes['sandbox_compat'] = calculate_sandbox_compat_hash(sandbox_files)

    if not os.environ.get("SOURCE_DATE_EPOCH"):
      if api_version in UNTRACKED_VERSIONS:
        label = version_label(api_version)
        label = label[0:1].upper() + label[1:]
        hashes['comment'] = f'{label} last updated {get_date()}.'
      else:
        hashes['comment'] = f'Added {get_date()}.'
  return hashes`;

test("source metadata reproducibility epoch is pinned CEF commit input and reaches actual child env", async () => {
  const body = Buffer.from(CEF_EPOCH_COMMIT);
  assert.equal(
    hashObject("sha1")
      .update(Buffer.from(`commit ${body.length}\0`))
      .update(body)
      .digest("hex"),
    "682c378d70d5780061e96644dca16ddd8fd157a9",
  );
  const epoch = /^committer .* ([0-9]+) [+-][0-9]{4}$/m.exec(
    CEF_EPOCH_COMMIT,
  )[1];
  assert.equal(SOURCE_METADATA_DATE_EPOCH, epoch);
  const target = "aarch64-unknown-linux-gnu";
  const map = {
    target,
    path: [],
    environment: { SOURCE_DATE_EPOCH: "bad-late-user-value" },
  };
  const env = buildEnvironment(
    map,
    {
      toolsRoot: "/tools",
      source: "/owned/source",
      depot: "/owned/source/depot_tools",
      python: "/tools/python3",
    },
    { PATH: process.env.PATH },
    true,
  );
  const child = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-B",
      "-c",
      'import os,json;print(json.dumps({k:os.environ.get(k)for k in ("SOURCE_DATE_EPOCH","PYTHONDONTWRITEBYTECODE","PYTHONPYCACHEPREFIX")}))',
    ],
    {
      env: { ...env, PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    SOURCE_DATE_EPOCH: epoch,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPYCACHEPREFIX: null,
  });
  const runtime = await readFile(
    path.join(ROOT, "scripts/cef-runtime-ci.mjs"),
    "utf8",
  );
  const build = runtime.slice(runtime.indexOf("export async function build("));
  assert(
    build.indexOf("const childEnv = buildEnvironment(") <
      build.indexOf('"acquire"'),
  );
  const helper = await readFile(
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    "utf8",
  );
  assert(helper.includes("SOURCE_METADATA_DATE_EPOCH = '" + epoch + "'"));
});

test("source metadata pinned CEF predicate suppresses only date comments across date changes", () => {
  assert.equal(
    sha(CEF_EPOCH_HASH_PREDICATE),
    "5a6ecbd37ca666b97388d18f427c00a44c68f059d07893e9b64e35c0d332bef8",
  );
  const result = python(
    String.raw`import ast,os,sys
from typing import Dict
from unittest.mock import patch
source=sys.argv[1];epoch=sys.argv[2];date=["October 26, 2026"];calls=[]
class Hasher:
 def calculate(self,*args):return {'linux':'L','mac':'M','windows':'W'}
def get_date():calls.append(date[0]);return date[0]
ns={'Dict':Dict,'CefApiHasher':object,'UNTRACKED_VERSIONS':('999998','999999'),'SANDBOX_COMPAT_FILES':('public.h',),'calculate_sandbox_compat_hash':lambda paths:'S','version_label':lambda version:'Next version'if version=='999998'else'Experimental version','get_date':get_date,'os':os}
exec(compile(ast.parse(source),'<pinned-CEF-predicate>','exec'),ns)
f=ns['compute_api_hashes']
with patch.dict(os.environ,{},clear=True):
 first=f('999998',Hasher(),True,'/owned');date[0]='October 27, 2026';second=f('999998',Hasher(),True,'/owned')
 assert first['comment']!=second['comment'] and len(calls)==2
with patch.dict(os.environ,{'SOURCE_DATE_EPOCH':epoch},clear=True):
 calls.clear();first=f('999998',Hasher(),True,'/owned');date[0]='October 28, 2026';second=f('999998',Hasher(),True,'/owned')
 assert first==second=={'linux':'L','mac':'M','windows':'W','sandbox_compat':'S'} and calls==[]
print('actual pinned predicate old date drift / fixed epoch stable')`,
    [CEF_EPOCH_HASH_PREDICATE, SOURCE_METADATA_DATE_EPOCH],
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("Mac source policy cannot be admitted by an external context, result or environment", async () => {
  const mac = await import("../../scripts/lib/cef-mac-source-metadata.mjs");
  const source = checkpointProfile("aarch64-apple-darwin").source;
  const selected = {
    ...identity,
    target: "aarch64-apple-darwin",
    source,
    canonicalRoot:
      "/Users/runner/work/_temp/sorng-cef-engineering/aarch64-apple-darwin/" +
      source,
  };
  for (const mode of ["source-record", "source-apply", "source-verify"])
    assert.throws(
      () =>
        sourceMetadataPlan(
          selected,
          selected.canonicalRoot + "/source/src/out/Release_GN_arm64",
          mode,
        ),
      /MAC_SOURCE_DARWIN_CAPABILITY_UNREVIEWED/,
    );
  assert.throws(
    () =>
      mac.macSourceMetadataPlan(
        { ...selected, canonicalRoot: "/arbitrary" },
        "/arbitrary/source/src/out/Release_GN_arm64",
        "source-record",
      ),
    /MAC_SOURCE_ROOT/,
  );
  assert.throws(
    () =>
      mac.macExternalToolsBinding(
        {},
        { complete: true, sourceWriteAdmitted: true },
      ),
    /MAC_EXTERNAL_ATTESTATION/,
  );
  assert.equal(mac.MAC_SOURCE_POLICY.darwinWriteAdmitted, false);
  const worker = await readFile(
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    "utf8",
  );
  assert.match(worker, /MAC_SOURCE_WRITE_ADMITTED = False/);
  assert.match(
    worker,
    /require\(MAC_SOURCE_WRITE_ADMITTED, 'source-mac-darwin-capability-unreviewed'\)/,
  );
});

test("copied Mac authoritative GN hook preserves exact ordering and original first rejection", async () => {
  const { authoritativeGn } =
    await import("../../scripts/lib/cef-mac-source-metadata.mjs");
  for (const stop of [
    null,
    "apply",
    "first-verify",
    "gn",
    "second-verify",
    "collect",
  ]) {
    const events = [],
      marker = Error("fixed owned operation failure"),
      transition = { fixedFive: true };
    let verifies = 0;
    const step = (name) => {
      events.push(name);
      if (stop === name) throw marker;
    };
    const context = { revalidateGn: async () => step("gn") };
    const operation = authoritativeGn(context, {
      apply: async () => {
        step("apply");
        return transition;
      },
      verify: async (actual, value) => {
        assert.equal(actual, context);
        assert.equal(value, transition);
        step(++verifies === 1 ? "first-verify" : "second-verify");
      },
      collect: async () => {
        step("collect");
        return "captured";
      },
    });
    if (stop === null) assert.equal(await operation, "captured");
    else await assert.rejects(operation, (error) => error === marker);
    const expected = [
      "apply",
      "first-verify",
      "gn",
      "second-verify",
      "collect",
    ];
    assert.deepEqual(
      events,
      stop === null ? expected : expected.slice(0, expected.indexOf(stop) + 1),
    );
  }
});

test("Mac helper failures retain only closed roles, phases and independent reporting failure", () => {
  const good = {
    complete: false,
    error: "source-external-changed",
    externalRole: "metal",
    externalPhase: "readback",
    macReportingFailure: true,
  };
  assert.deepEqual(archiveFailureRecord(JSON.stringify(good), 1), {
    error: good.error,
    externalRole: "metal",
    externalPhase: "readback",
    macReportingFailure: true,
    exitCode: 1,
  });
  for (const field of ["externalRole", "externalPhase"]) {
    const bad = { ...good, [field]: "PRIVATE_PATH_OR_CONTENT" };
    assert.deepEqual(archiveFailureRecord(JSON.stringify(bad), 1), {
      error: "unknown",
      exitCode: 1,
    });
  }
  assert.deepEqual(
    archiveFailureRecord(
      JSON.stringify({ complete: false, error: "source-content-changed" }),
      1,
    ),
    {
      error: "source-content-changed",
      exitCode: 1,
    },
  );
});

function sdkRelationIo(overrides = {}) {
  const base =
    "/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/";
  return {
    lstat: async (name) => ({
      dev: 1n,
      ino: name.endsWith("26.2.sdk") ? 2n : 3n,
      nlink: 1n,
      size: 10n,
      mode: 0o40755n,
      birthtimeNs: 1n,
      mtimeNs: 1n,
      ctimeNs: 1n,
      isSymbolicLink: () => name === base + "MacOSX26.2.sdk",
      isDirectory: () => name === base + "MacOSX.sdk",
    }),
    readlink: async () => "MacOSX.sdk",
    realpath: async () => base + "MacOSX.sdk",
    ...overrides,
  };
}

async function macExternalFixture(moduleOverride = null) {
  const mac =
    moduleOverride ??
    (await import("../../scripts/lib/cef-mac-source-metadata.mjs"));
  const namespace = path.join(
    ROOT,
    "native/cef-build-inputs/20261025-r5-owned-http3-macarm-sdk26-2-capture-compat",
  );
  const map = JSON.parse(
    await readFile(
      path.join(namespace, "cef-ci-runner-aarch64-apple-darwin.json"),
    ),
  );
  const toolchain = JSON.parse(
    await readFile(path.join(namespace, "tools/aarch64-apple-darwin.json")),
  );
  const developer = "/Applications/Xcode_26.3.app/Contents/Developer";
  const metalRoot =
    "/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/" +
    "a".repeat(40) +
    "/Metal.xctoolchain";
  const metal = {
    kind: "selected-mac-metal-observation",
    provenance: "newly-observed-apple-component-not-prepinned",
    developerDir: developer,
    componentResourceClosureVerified: false,
    tools: [
      {
        role: "metal",
        location: "external-metal-toolchain",
        appleAnchorVerified: true,
        bytes: 10,
        sha256: "b".repeat(64),
        version: "1.0",
        versionSource: "tool-output",
        pairedCompilerVersion: null,
        physicalPath: metalRoot + "/usr/bin/metal",
      },
      {
        role: "metallib",
        location: "external-metal-toolchain",
        appleAnchorVerified: true,
        bytes: 20,
        sha256: "c".repeat(64),
        version: null,
        versionSource: "not-observed",
        pairedCompilerVersion: "1.0",
        physicalPath: metalRoot + "/usr/bin/air-lld",
      },
    ],
  };
  const options = {
    map,
    toolchain,
    metal,
    selected: {
      DEVELOPER_DIR: developer,
      SDKROOT:
        developer + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
    },
    sdkTargets: [
      developer + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
      developer + "/Platforms/MacOSX.platform",
      developer + "/Toolchains/XcodeDefault.xctoolchain",
    ],
    runnerTemp: "/Users/runner/work/_temp",
    output:
      "/Users/runner/work/_temp/cef-mac-inputs-11111111-1111-4111-8111-111111111111",
    remainingMilliseconds: () => 500999.9,
  };
  options.sdkRelation = await mac.macSdkRelation(
    { ...options, check: () => {} },
    sdkRelationIo(),
  );
  return { mac, options, plan: mac.macExternalObservationPlan(options) };
}

test("Mac external plan closes exact roots, fixed pinned Python and original floor-down clock", async () => {
  const { mac, options, plan } = await macExternalFixture();
  assert.equal(plan.context.requiredPins.length, 10);
  assert.equal(plan.context.historicalMetalResourceClosureVerified, false);
  assert.equal(
    plan.context.roots.metal,
    options.metal.tools[0].physicalPath.slice(0, -14),
  );
  const argv = plan.argv(
    "mac-external-observe",
    options.output + "/context.json",
  );
  assert.deepEqual(argv.slice(0, 4), [
    "-I",
    "-B",
    "scripts/lib/cef-checkpoint-archive.py",
    "mac-external-observe",
  ]);
  assert.equal(argv.at(-1), "500");
  assert.equal(
    plan
      .argv("mac-owned-capability-observe", options.output + "/context.json")
      .at(-1),
    "5",
  );
  assert.throws(() =>
    plan.argv("source-apply", options.output + "/context.json"),
  );
  assert.throws(() =>
    plan.argv("mac-external-observe", options.output + "/../context.json"),
  );
  for (const mutate of [
    (value) => (value.map.target = "x86_64-apple-darwin"),
    (value) => (value.map.python = "usr/bin/python3"),
    (value) => (value.sdkTargets[0] = value.sdkTargets[0] + "/.."),
    (value) => (value.metal.tools[0].physicalPath = "/arbitrary/usr/bin/metal"),
    (value) => (value.metal.componentResourceClosureVerified = true),
    (value) => (value.toolchain.files[0].sha256 = "unknown"),
    (value) => (value.runnerTemp = "/tmp"),
  ]) {
    const bad = structuredClone({
      ...options,
      remainingMilliseconds: undefined,
    });
    bad.remainingMilliseconds = () => 600000;
    mutate(bad);
    assert.throws(() => mac.macExternalObservationPlan(bad));
  }
  const nearlyExpired = mac.macExternalObservationPlan({
    ...options,
    remainingMilliseconds: () => 999.9,
  });
  assert.throws(
    () =>
      nearlyExpired.argv(
        "mac-external-observe",
        options.output + "/context.json",
      ),
    /MAC_EXTERNAL_DEADLINE/,
  );
  assert.throws(() => {
    plan.context.roots.sdk = "/arbitrary";
  }, TypeError);
});

// Actual V1 branch from frozen721511, SHA 6a3f06c24a6aaefa05dba25688ac28361f900fd87832db60278a869a8cd90aa6. Data-only historical regression, never admission.
const MAC_V1_LEXICAL_TARGET =
  '{\n          assert(\n            typeof item.target === "string" &&\n              Buffer.byteLength(item.target) > 0 &&\n              Buffer.byteLength(item.target) <= 4096 &&\n              !/[\\x00-\\x1f\\x7f]/.test(item.target) &&\n              createHash("sha256").update(item.target).digest("hex") ===\n                item.sha256,\n            "MAC_EXTERNAL_ENTRY",\n          );\n          const target = path.posix.normalize(\n            item.target.startsWith("/")\n              ? item.target\n              : path.posix.join(\n                  plan.context.roots[role],\n                  path.posix.dirname(item.path),\n                  item.target,\n                ),\n          );\n          const candidates = Object.entries(plan.context.roots).filter(\n            ([, root]) => target === root || target.startsWith(root + "/"),\n          );\n          assert(candidates.length > 0, "MAC_EXTERNAL_ENTRY_TARGET");\n          const selected =\n            candidates.find(([name]) => name === role) ??\n            candidates.sort((a, b) => b[1].length - a[1].length)[0];\n          // This is the declared external-role address, never a GN graph rewrite.\n          // The raw literal and its hash remain in the held operational report.\n          portable.target = {\n            role: selected[0],\n            path: target.slice(selected[1].length).replace(/^\\//, ""),\n          };\n          if (!item.target.startsWith("/"))\n            portable.relativeLiteral = item.target;\n        }';
test("Mac external resolver processes symlinks before parents and preserves missing, file and trailing-slash semantics", async () => {
  const { resolveMacExternalTarget: resolve } =
    await import("../../scripts/lib/cef-mac-source-metadata.mjs");
  const roots = {
    sdk: "/sdk",
    toolchain: "/tools",
    metal: "/metal",
    python: "/python",
  };
  const rows = {
    sdk: [
      { path: "file", kind: "file" },
      { path: "alias", kind: "symlink", target: "/tools/subdir" },
    ],
    toolchain: [{ path: "subdir", kind: "directory" }],
    metal: [],
    python: [],
  };
  assert.equal(
    sha(MAC_V1_LEXICAL_TARGET),
    "6a3f06c24a6aaefa05dba25688ac28361f900fd87832db60278a869a8cd90aa6",
  );
  const old = new Function(
    "path",
    "assert",
    "plan",
    "role",
    "item",
    "portable",
    "createHash",
    MAC_V1_LEXICAL_TARGET + ";return portable;",
  );
  assert.deepEqual(
    old(
      path,
      assert,
      { context: { roots } },
      "sdk",
      {
        path: "jump",
        target: "alias/../file",
        sha256: hashObject("sha256").update("alias/../file").digest("hex"),
      },
      {},
      hashObject,
    ).target,
    { role: "sdk", path: "file" },
  );
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "alias/../file"),
    /MAC_EXTERNAL_ENTRY_TARGET/,
  );
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "missing/../file"),
    /MAC_EXTERNAL_ENTRY_TARGET/,
  );
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "file/../file"),
    /MAC_EXTERNAL_ENTRY_KIND/,
  );
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "file/"),
    /MAC_EXTERNAL_ENTRY_KIND/,
  );
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "//sdk/file"),
    /MAC_EXTERNAL_ENTRY_TARGET/,
  );
  rows.toolchain.push({ path: "file", kind: "file" });
  assert.deepEqual(
    resolve(roots, rows, "sdk", "jump", "alias/../file").resolved,
    { role: "toolchain", path: "file", kind: "file" },
  );
  assert.deepEqual(
    resolve(roots, rows, "sdk", "jump", "../tools/file").resolved,
    { role: "toolchain", path: "file", kind: "file" },
  );
  assert.deepEqual(
    resolve(roots, rows, "sdk", "jump", "/tools/subdir/../file").resolved,
    { role: "toolchain", path: "file", kind: "file" },
  );
  assert.deepEqual(
    resolve(roots, rows, "sdk", "jump", "alias/../subdir/").resolved,
    { role: "toolchain", path: "subdir", kind: "directory" },
  );
  assert.deepEqual(resolve(roots, rows, "sdk", "jump", "./file").resolved, {
    role: "sdk",
    path: "file",
    kind: "file",
  });
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "../unattested/../tools/file"),
    /MAC_EXTERNAL_ENTRY_TARGET/,
  );
  rows.sdk.push({ path: "loop", kind: "symlink", target: "loop" });
  assert.throws(
    () => resolve(roots, rows, "sdk", "jump", "loop"),
    /MAC_EXTERNAL_ENTRY_CYCLE/,
  );
  const marker = Error("fixed original clock");
  assert.throws(
    () =>
      resolve(roots, rows, "sdk", "jump", "file", () => {
        throw marker;
      }),
    (error) => error === marker,
  );
});

test("Mac external report actual reader preserves null/read/hash errors across close faults and denies close-only failure", async () => {
  const { mac, plan, options } = await macExternalFixture();
  const value = {
    schemaVersion: 1,
    kind: "sorng-macarm-external-input-observation",
    target: "aarch64-apple-darwin",
    policy: "sorng-macarm-readonly-external-inputs-v1",
    complete: true,
    externalSnapshotComplete: true,
    roles: Object.entries(plan.context.roots).map(([role, physicalRoot]) => ({
      role,
      physicalRoot,
      snapshot: {
        rootMtimeNs: "1",
        gitHeads: {},
        root: { mode: 0o40755, mtimeNs: "1", uid: 0, gid: 0, nlink: 2 },
        localRoot: {
          dev: "1",
          ino: "2",
          ctimeNs: "3",
          birthtimeNsAvailable: true,
          birthtimeNs: "4",
        },
        bytes: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .reduce((sum, pin) => sum + pin.size, 0),
        entries: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .map((pin) => ({
            path: pin.path,
            kind: "file",
            mode: 0o100644,
            mtimeNs: "1",
            nlink: 1,
            uid: 0,
            gid: 0,
            size: pin.size,
            sha256: pin.sha256,
          })),
      },
    })),
    entries: 10,
    bytes: plan.context.requiredPins.reduce((sum, pin) => sum + pin.size, 0),
    runnerUid: 501,
    historicalMetalResourceClosureVerified: false,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  const raw = Buffer.from(JSON.stringify(value));
  const result = {
    complete: true,
    kind: value.kind,
    entries: value.entries,
    bytes: value.bytes,
    snapshot: {
      name: "external.json",
      bytes: raw.length,
      sha256: hashObject("sha256").update(raw).digest("hex"),
    },
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  const identity = {
    dev: 1n,
    ino: 2n,
    mode: 0o100600n,
    nlink: 1n,
    size: BigInt(raw.length),
    mtimeNs: 1n,
    ctimeNs: 2n,
    birthtimeNs: 3n,
    isFile: () => true,
  };
  for (const scenario of [
    "success",
    "read",
    "null",
    "hash",
    "identity",
    "close",
  ]) {
    let closes = 0;
    const marker = Error("fixed injected read failure"),
      close = Error("fixed injected close failure");
    const fd = {
      stat: async () =>
        scenario === "identity" ? { ...identity, ino: 3n } : identity,
      readFile: async () => {
        if (scenario === "read") throw marker;
        if (scenario === "null") throw null;
        return raw;
      },
      close: async () => {
        closes++;
        if (scenario !== "success") throw close;
      },
    };
    const io = {
      lstat: async (file) =>
        file.endsWith("/external.json")
          ? identity
          : {
              ...identity,
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
      realpath: async (file) => file,
      open: async () => fd,
    };
    const selected =
      scenario === "hash"
        ? {
            ...result,
            snapshot: { ...result.snapshot, sha256: "d".repeat(64) },
          }
        : result;
    if (scenario === "success") {
      const proof = await mac.readMacExternalObservation(
        plan,
        selected,
        () => {},
        io,
      );
      assert.equal(
        mac.macExternalToolsBinding({ static: "fixed" }, proof)
          .macExternalInputs.historicalMetalResourceClosureVerified,
        false,
      );
      assert.throws(
        () => mac.macExternalToolsBinding({}, { ...proof }),
        /MAC_EXTERNAL_ATTESTATION/,
      );
      const freshPlan = mac.macExternalObservationPlan({
        ...options,
        metal: {
          ...options.metal,
          tools: options.metal.tools.map((tool) => ({
            ...tool,
            physicalPath: tool.physicalPath.replace(
              "a".repeat(40),
              "e".repeat(40),
            ),
          })),
        },
      });
      const freshValue = structuredClone(value);
      for (const row of freshValue.roles) {
        row.physicalRoot = freshPlan.context.roots[row.role];
        row.snapshot.localRoot = {
          dev: "10",
          ino: "20",
          ctimeNs: "30",
          birthtimeNsAvailable: true,
          birthtimeNs: "40",
        };
      }
      const admitSynthetic = async (report) => {
        const body = Buffer.from(JSON.stringify(report));
        const summary = {
          ...result,
          snapshot: {
            name: "external.json",
            bytes: body.length,
            sha256: hashObject("sha256").update(body).digest("hex"),
          },
        };
        const stat = { ...identity, size: BigInt(body.length) };
        return mac.readMacExternalObservation(freshPlan, summary, () => {}, {
          lstat: async (file) =>
            file.endsWith("/external.json")
              ? stat
              : {
                  ...stat,
                  isDirectory: () => true,
                  isSymbolicLink: () => false,
                },
          realpath: async (file) => file,
          open: async () => ({
            stat: async () => stat,
            readFile: async () => body,
            close: async () => {},
          }),
        });
      };
      const freshProof = await admitSynthetic(freshValue);
      assert.deepEqual(
        mac.macExternalToolsBinding({}, proof),
        mac.macExternalToolsBinding({}, freshProof),
      );
      assert.notEqual(
        mac.macExternalObservationEvidence(proof).snapshot.sha256,
        mac.macExternalObservationEvidence(freshProof).snapshot.sha256,
      );
      const unavailable = structuredClone(freshValue);
      for (const row of unavailable.roles) {
        row.snapshot.localRoot.birthtimeNsAvailable = false;
        row.snapshot.localRoot.birthtimeNs = null;
      }
      const unavailableProof = await admitSynthetic(unavailable);
      assert.deepEqual(
        mac.macExternalToolsBinding({}, freshProof),
        mac.macExternalToolsBinding({}, unavailableProof),
      );
      // These are freshly hash-bound reports: rejection must be schema/pair
      // validation, not a stale report hash or the opaque attestation guard.
      for (const [available, birth] of [
        [false, "40"],
        [true, null],
        ["false", null],
        [0, null],
        [true, 40],
        [true, "-1"],
        [true, "1.5"],
        [true, "01"],
        [true, "9223372036854775808"],
        [true, "NaN"],
      ]) {
        const invalid = structuredClone(unavailable);
        Object.assign(invalid.roles[0].snapshot.localRoot, {
          birthtimeNsAvailable: available,
          birthtimeNs: birth,
        });
        await assert.rejects(admitSynthetic(invalid), /MAC_EXTERNAL_ROLE/);
      }
      for (const key of ["birthtimeNsAvailable", "birthtimeNs"]) {
        const missing = structuredClone(unavailable);
        delete missing.roles[0].snapshot.localRoot[key];
        await assert.rejects(admitSynthetic(missing), /MAC_EXTERNAL_ROLE/);
      }
      const extra = structuredClone(unavailable);
      extra.roles[0].snapshot.localRoot.floatBirthtime = 1.25;
      await assert.rejects(admitSynthetic(extra), /MAC_EXTERNAL_ROLE/);
      freshValue.roles[0].snapshot.rootMtimeNs = "2";
      freshValue.roles[0].snapshot.root.mtimeNs = "2";
      const drifted = await admitSynthetic(freshValue);
      assert.notDeepEqual(
        mac.macExternalToolsBinding({}, proof),
        mac.macExternalToolsBinding({}, drifted),
      );
    } else
      await assert.rejects(
        mac.readMacExternalObservation(plan, selected, () => {}, io),
        (error) => {
          if (scenario === "null") return error === null;
          if (scenario === "read") return error === marker;
          if (scenario === "close") return error === close;
          return (
            /MAC_EXTERNAL_REPORT_(?:HASH|IDENTITY)|MAC_EXTERNAL_REPORT/.test(
              error.message,
            ) && error !== close
          );
        },
      );
    assert.equal(closes, 1);
  }
});

const MAC_WORKER_PROOF = String.raw`import pathlib,sys,types,unittest,copy
from unittest.mock import patch
m=types.ModuleType('mac_worker');m.__file__=sys.argv[1]
exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)
class Proof(unittest.TestCase):
 def test_cleanup_attempts_every_closer_and_preserves_original(self):
  calls=[];first=RuntimeError('fixed primary');secondary=OSError('fixed close')
  def close():calls.append('close');raise secondary
  m.source_cleanup_all([close,lambda:calls.append('second')],first)
  self.assertEqual(calls,['close','second']);self.assertTrue(m.SOURCE_CLOSE_FAILURE)
  with self.assertRaises(OSError)as raised:m.source_cleanup_all([close],None)
  self.assertIs(raised.exception,secondary)
 def test_birth_requires_observed_integer_ns(self):
  for value in [None,1.5,True,-1,2**63]:
   with self.subTest(value=value),self.assertRaises(m.CheckpointError):m.source_birth(types.SimpleNamespace(st_birthtime_ns=value))
  self.assertEqual(m.source_birth(types.SimpleNamespace(st_birthtime_ns=123)),123)
 def test_aggregate_limits_apply_before_hash_work(self):
  for field,value in [('entries',m.SOURCE_MAX_ENTRIES),('bytes',m.MAX_RAW),('metadata',m.MAX_METADATA)]:
   state={'entries':0,'bytes':0,'metadata':0};state[field]=value
   with self.subTest(field=field),self.assertRaisesRegex(m.CheckpointError,'source-external-aggregate'):
    m.source_aggregate({'external':True,'aggregate':state},'file',1)
 def test_links_use_only_literal_known_inventory_without_target_io(self):
  roots={'sdk':'/sdk','toolchain':'/tools','metal':'/metal','python':'/python'}
  snapshots={role:{'entries':[]}for role in roots}
  snapshots['sdk']['entries']=[{'path':'alias','kind':'symlink','target':'/private/not-admitted'}]
  with patch.object(pathlib.Path,'stat',side_effect=AssertionError('no target stat')),patch.object(pathlib.Path,'open',side_effect=AssertionError('no target read')):
   with self.assertRaisesRegex(m.CheckpointError,'source-external-input-unattested'):m.mac_external_links(roots,snapshots,m.Budget(5))
  snapshots['sdk']['entries']=[{'path':'alias','kind':'symlink','target':'/tools/file'}]
  snapshots['toolchain']['entries']=[{'path':'file','kind':'file'}]
  m.mac_external_links(roots,snapshots,m.Budget(5))
  snapshots['toolchain']['entries']=[{'path':'file','kind':'symlink','target':'/sdk/alias'}]
  with self.assertRaisesRegex(m.CheckpointError,'source-external-link-cycle'):m.mac_external_links(roots,snapshots,m.Budget(5))
 def test_source_darwin_gate_precedes_all_path_access_and_writes(self):
  with patch.object(sys,'platform','darwin'),patch.object(pathlib.Path,'lstat',side_effect=AssertionError('no source metadata access')),patch.object(m.os,'utime',side_effect=AssertionError('no writes')):
   for mode in ['source-record','source-apply','source-verify']:
    with self.subTest(mode=mode),self.assertRaisesRegex(m.CheckpointError,'source-mac-darwin-capability-unreviewed'):
     m.source_metadata(mode,pathlib.Path('/not-read'),pathlib.Path('/not-written'),{},5,platform_policy='mac-arm')
 def snapshots(self):
   roots={'sdk':'/sdk','toolchain':'/tools','metal':'/metal','python':'/python'}
   return roots,{r:{'entries':[]} for r in roots}
 def test_mac_intermediate_symlink_dotdot_old_red_new_deny_and_real_target_green(self):
   roots,s=self.snapshots();s['sdk']['entries']=[{'path':'file','kind':'file'},{'path':'alias','kind':'symlink','target':'/tools/subdir'},{'path':'jump','kind':'symlink','target':'alias/../file'}];s['toolchain']['entries']=[{'path':'subdir','kind':'directory'}]
   with self.assertRaisesRegex(m.CheckpointError,'source-external-input-unattested'):m.mac_external_links(roots,s,m.Budget(5))
   s['toolchain']['entries'].append({'path':'file','kind':'file'});m.mac_external_links(roots,s,m.Budget(5))
 def test_mac_missing_nondirectory_trailing_and_unknown_ancestor_deny(self):
   for target in ['missing/../file','file/../file','file/','../unknown/../sdk/file']:
    roots,s=self.snapshots();s['sdk']['entries']=[{'path':'file','kind':'file'},{'path':'jump','kind':'symlink','target':target}]
    with self.subTest(target=target),self.assertRaises((m.CheckpointError,FileNotFoundError)):m.mac_external_links(roots,s,m.Budget(5))
 def test_mac_relative_crossrole_and_directory_dotdot_positive(self):
   roots,s=self.snapshots();s['sdk']['entries']=[{'path':'dir','kind':'directory'},{'path':'file','kind':'file'},{'path':'local','kind':'symlink','target':'dir/../file'},{'path':'other','kind':'symlink','target':'../tools/file'}];s['toolchain']['entries']=[{'path':'file','kind':'file'}];m.mac_external_links(roots,s,m.Budget(5))
 def test_mac_cycles_bounds_deadline_and_no_target_io(self):
   roots,s=self.snapshots();s['sdk']['entries']=[{'path':'link','kind':'symlink','target':'link'}]
   with self.assertRaisesRegex(m.CheckpointError,'cycle'):m.mac_external_links(roots,s,m.Budget(5))
   s['sdk']['entries'][0]['target']='x'*4097
   with self.assertRaisesRegex(m.CheckpointError,'source-link'):m.mac_external_links(roots,s,m.Budget(5))
   s['sdk']['entries']=[{'path':'file','kind':'file'},{'path':'link','kind':'symlink','target':'file'}]
   budget=m.Budget(5);budget.end=0
   with self.assertRaisesRegex(m.CheckpointError,'deadline'):m.mac_external_links(roots,s,budget)
   with patch.object(pathlib.Path,'stat',side_effect=AssertionError('no target stat')),patch.object(pathlib.Path,'open',side_effect=AssertionError('no target read')):m.mac_external_links(roots,s,m.Budget(5))
unittest.main(argv=['mac-worker-pure'],verbosity=1)
`;
test("Mac worker pure cleanup, birth, aggregate and literal-link boundaries", () => {
  const result = python(MAC_WORKER_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
});

test("actual Linux CLI source transaction retains exact reviewed worker argv and original timeout", async () => {
  const source = await readFile(
    path.join(ROOT, "scripts/cef-engineering-checkpoint.mjs"),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "checkpoint.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let arrow;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(ast) === "sourceMetadata" &&
      ts.isArrowFunction(node.right)
    )
      arrow = node.right.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert(arrow);
  const selected = {
    ...identity,
    target: "aarch64-unknown-linux-gnu",
    source: checkpointProfile("aarch64-unknown-linux-gnu").source,
    canonicalRoot: "/owned",
  };
  const calls = [];
  const fn = new Function(
    "sourceMetadataPlan",
    "identity",
    "out",
    "LIMITS",
    "hostRemaining",
    "env",
    "fail",
    "sourceMetadataResult",
    "archiveCommand",
    "verified",
    "HELPER",
    "identityFile",
    "checkpointLog",
    "canonical",
    "console",
    "TARGET",
    "context",
    `return (${arrow});`,
  )(
    sourceMetadataPlan,
    selected,
    "/owned/source/src/out/Release_GN_arm64",
    LIMITS,
    () => 600000,
    {},
    assert,
    sourceMetadataResult,
    async (python, helper, args, options) => {
      calls.push({ python, helper, args, timeout: options.timeout });
      return {
        complete: true,
        mode: args[0],
        entries: 1,
        bytes: 0,
        ...(args[0] === "source-record"
          ? {
              sidecar: {
                name: ".siso_sorng_source_metadata.json",
                bytes: 1,
                sha256: "a".repeat(64),
              },
            }
          : {}),
      };
    },
    { python: "/fixed/python" },
    "/fixed/helper",
    "/fixed/identity.json",
    () => {},
    JSON.stringify,
    { log() {} },
    "aarch64-unknown-linux-gnu",
    {},
  );
  for (const mode of ["source-record", "source-apply", "source-verify"]) {
    assert.equal((await fn(mode)).mode, mode);
    assert.deepEqual(calls.at(-1), {
      python: "/fixed/python",
      helper: "/fixed/helper",
      timeout: 600000,
      args: [
        mode,
        "--input",
        "/owned/source",
        "--output",
        "/owned/source/src/out/Release_GN_arm64/.siso_sorng_source_metadata.json",
        "--manifest",
        "/fixed/identity.json",
        "--seconds",
        "600",
      ],
    });
  }
});

const MAC_ORDERED_POSIX_PROOF = String.raw`import pathlib,sys,types,unittest,tempfile,os,json,time
from unittest.mock import patch
m=types.ModuleType('actual_v2');m.__file__=sys.argv[1];exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)
class Proof(unittest.TestCase):
 def snapshots(self):
  roots={'sdk':'/sdk','toolchain':'/tools','metal':'/metal','python':'/python'}
  return roots,{r:{'entries':[]} for r in roots}
 def test_mac_intermediate_symlink_dotdot_old_red_new_deny_and_real_target_green(self):
  roots,s=self.snapshots();s['sdk']['entries']=[{'path':'file','kind':'file'},{'path':'alias','kind':'symlink','target':'/tools/subdir'},{'path':'jump','kind':'symlink','target':'alias/../file'}];s['toolchain']['entries']=[{'path':'subdir','kind':'directory'}]
  with self.assertRaisesRegex(m.CheckpointError,'source-external-input-unattested'):m.mac_external_links(roots,s,m.Budget(5))
  s['toolchain']['entries'].append({'path':'file','kind':'file'});m.mac_external_links(roots,s,m.Budget(5))
 def test_mac_missing_nondirectory_trailing_and_unknown_ancestor_deny(self):
  for target in ['missing/../file','file/../file','file/','../unknown/../sdk/file']:
   roots,s=self.snapshots();s['sdk']['entries']=[{'path':'file','kind':'file'},{'path':'jump','kind':'symlink','target':target}]
   with self.subTest(target=target),self.assertRaises((m.CheckpointError,FileNotFoundError)):m.mac_external_links(roots,s,m.Budget(5))
 def test_mac_relative_crossrole_and_directory_dotdot_positive(self):
  roots,s=self.snapshots();s['sdk']['entries']=[{'path':'dir','kind':'directory'},{'path':'file','kind':'file'},{'path':'local','kind':'symlink','target':'dir/../file'},{'path':'other','kind':'symlink','target':'../tools/file'}];s['toolchain']['entries']=[{'path':'file','kind':'file'}];m.mac_external_links(roots,s,m.Budget(5))
 def test_mac_cycles_bounds_deadline_and_no_target_io(self):
  roots,s=self.snapshots();s['sdk']['entries']=[{'path':'link','kind':'symlink','target':'link'}]
  with self.assertRaisesRegex(m.CheckpointError,'cycle'):m.mac_external_links(roots,s,m.Budget(5))
  s['sdk']['entries'][0]['target']='x'*4097
  with self.assertRaisesRegex(m.CheckpointError,'source-link'):m.mac_external_links(roots,s,m.Budget(5))
  s['sdk']['entries']=[{'path':'file','kind':'file'},{'path':'link','kind':'symlink','target':'file'}]
  budget=m.Budget(5);budget.end=0
  with self.assertRaisesRegex(m.CheckpointError,'deadline'):m.mac_external_links(roots,s,budget)
  with patch.object(pathlib.Path,'stat',side_effect=AssertionError('no target stat')),patch.object(pathlib.Path,'open',side_effect=AssertionError('no target read')):m.mac_external_links(roots,s,m.Budget(5))
 def test_linux_actual_excluded_output_bypass_old_red_new_deny(self):
  with tempfile.TemporaryDirectory(prefix='ordered-linux-') as folder:
   root=pathlib.Path(folder)/'source';some=root/'src/some';some.mkdir(parents=True);(root/'src/foo').mkdir();(some/'out').mkdir();(root/'src/out').mkdir();(some/'out/file').write_bytes(b'decoy');(root/'src/out/file').write_bytes(b'excluded');os.symlink('../foo',some/'alias');os.symlink('alias/../out/file',some/'jump')
   self.assertEqual((some/'jump').resolve(strict=True),root/'src/out/file')
   self.assertEqual(m.source_link_target(root,some/'alias','../foo',m.Budget(5)),root/'src/foo')
   with self.assertRaisesRegex(m.CheckpointError,'source-excluded-link'):m.source_link_target(root,some/'jump',os.readlink(some/'jump'),m.Budget(5))
 def test_linux_missing_nondirectory_trailing_external_and_cycle(self):
  with tempfile.TemporaryDirectory(prefix='ordered-linux-negative-') as folder:
   root=pathlib.Path(folder);(root/'file').write_bytes(b'owned');(root/'dir').mkdir();os.symlink('cycle',root/'cycle')
   self.assertEqual(m.source_link_target(root,root/'link','dir/../file',m.Budget(5)),root/'file')
   for target in ['missing/../file','file/../file','file/','../outside','cycle']:
    with self.subTest(target=target),self.assertRaises((m.CheckpointError,FileNotFoundError)):m.source_link_target(root,root/'link',target,m.Budget(5))
 def capability_fault(self,setup,expected):
  with tempfile.TemporaryDirectory(prefix='capability-fault-') as folder:
   output=pathlib.Path(folder);report={};marker=OSError('controlled primary');owned=output/'capability-owned'
   def emit(root,name,value,source=False):report.update(value);return {'name':name}
   with patch.object(m,'metadata',side_effect=emit),patch.object(m,'source_read_sidecar',side_effect=lambda *_:report),setup(marker):
    with self.assertRaises(OSError) as raised:m.mac_owned_capability_observe({'outputRoot':str(output),'target':'aarch64-apple-darwin'},output/'capability.json',m.Budget(5))
   self.assertIs(raised.exception,marker);self.assertEqual(owned.exists(),expected);self.assertFalse(report['complete']);self.assertEqual(report['objectsRemoved'],not expected);self.assertTrue(report['handlesClosed'])
 def test_capability_write_failure_removes_immediately_owned_file(self):
  self.capability_fault(lambda marker:patch.object(m.os,'write',side_effect=marker),False)
 def test_capability_symlink_creation_failure_cleans_file_and_directory(self):
  self.capability_fault(lambda marker:patch.object(m.os,'symlink',side_effect=marker),False)
 def test_capability_directory_open_failure_cleans_all_created_objects(self):
  original=m.os.open
  def setup(marker):
   def open_(path,flags,*args,**kwargs):
    if pathlib.Path(path).name=='directory':raise marker
    return original(path,flags,*args,**kwargs)
   return patch.object(m.os,'open',side_effect=open_)
  self.capability_fault(setup,False)
 def test_capability_cleanup_attempts_all_eligible_and_preserves_first(self):
  with tempfile.TemporaryDirectory(prefix='capability-cleanup-') as folder:
   output=pathlib.Path(folder);report={};first=OSError('primary');second=OSError('cleanup');real_unlink=m.os.unlink
   def unlink(path,*args,**kwargs):
    if pathlib.Path(path).name=='link':raise second
    return real_unlink(path,*args,**kwargs)
   def emit(root,name,value,source=False):report.update(value);return {'name':name}
   with patch.object(m,'metadata',side_effect=emit),patch.object(m,'source_read_sidecar',side_effect=lambda *_:report),patch.object(m.os,'utime',side_effect=first),patch.object(m.os,'unlink',side_effect=unlink):
    with self.assertRaises(OSError) as raised:m.mac_owned_capability_observe({'outputRoot':str(output),'target':'aarch64-apple-darwin'},output/'capability.json',m.Budget(5))
   self.assertIs(raised.exception,first);owned=output/'capability-owned';self.assertTrue((owned/'link').is_symlink());self.assertFalse((owned/'file').exists());self.assertFalse((owned/'directory').exists());self.assertFalse(report['cleanupConfirmed']);self.assertTrue(report['handlesClosed']);(owned/'link').unlink();owned.rmdir()
 def test_capability_normal_twelve_observations_and_cleanup(self):
  with tempfile.TemporaryDirectory(prefix='capability-positive-') as folder:
   output=pathlib.Path(folder);result=m.mac_owned_capability_observe({'outputRoot':str(output),'target':'aarch64-apple-darwin'},output/'capability.json',m.Budget(5));report=json.loads((output/'capability.json').read_bytes());self.assertEqual(result['rows'],12);self.assertTrue(report['cleanupConfirmed']);self.assertFalse((output/'capability-owned').exists());self.assertFalse(report['sourceWriteAdmitted'])
 def test_capability_foreign_replacement_is_not_deleted(self):
  with tempfile.TemporaryDirectory(prefix='capability-foreign-') as folder:
   output=pathlib.Path(folder);report={};primary=OSError('controlled primary');owned=output/'capability-owned'
   def replace(*args,**kwargs):
    (owned/'file').unlink();(owned/'file').write_bytes(b'owned-test-replacement');raise primary
   def emit(root,name,value,source=False):report.update(value);return {'name':name}
   with patch.object(m,'metadata',side_effect=emit),patch.object(m,'source_read_sidecar',side_effect=lambda *_:report),patch.object(m.os,'utime',side_effect=replace):
    with self.assertRaises(OSError) as raised:m.mac_owned_capability_observe({'outputRoot':str(output),'target':'aarch64-apple-darwin'},output/'capability.json',m.Budget(5))
   self.assertIs(raised.exception,primary);self.assertEqual((owned/'file').read_bytes(),b'owned-test-replacement');self.assertFalse((owned/'link').exists());self.assertFalse((owned/'directory').exists());self.assertFalse(report['cleanupConfirmed']);self.assertTrue(report['handlesClosed']);(owned/'file').unlink();owned.rmdir()
unittest.main(argv=['ordered-links-and-capability'],verbosity=2)
`;
test(
  "ordered Linux and Mac resolver/capability regressions use real owned POSIX fixtures",
  {
    skip:
      process.platform !== "linux"
        ? "POSIX symlink/FD fixture; no Darwin capability claim"
        : false,
  },
  () => {
    const result = python(MAC_ORDERED_POSIX_PROOF, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Ran 12 tests/);
  },
);

const MAC_WORKER_IO_PROOF = String.raw`import sys,pathlib,types,tempfile,os,json
from unittest.mock import patch
m=types.ModuleType('owned_mac_fixture');m.__file__=sys.argv[1]
exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)
with tempfile.TemporaryDirectory(prefix='mac-external-io-fixture-') as name:
 root=pathlib.Path(name)/'inputs';root.mkdir();(root/'directory').mkdir()
 (root/'file').write_bytes(b'fixed-owned-input');os.link(root/'file',root/'hardlink');os.symlink('file',root/'alias')
 with patch.object(m,'source_birth',return_value=1):
  snapshot=m.source_snapshot(root,m.Budget(5),context={'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}})
  rows={row['path']:row for row in snapshot['entries']}
  assert rows['file']['sha256']==rows['hardlink']['sha256'] and rows['file']['nlink']==2
  assert rows['alias']['target']=='file' and len(rows)==4
  with patch.object(m,'SOURCE_MAX_ENTRIES',1):
   try:m.source_snapshot(root,m.Budget(5),context={'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}})
   except m.CheckpointError as error:assert str(error)=='source-external-aggregate'
   else:raise AssertionError('aggregate bypass')
 output=pathlib.Path(name)/'operation';output.mkdir()
 result=m.mac_owned_capability_observe({'outputRoot':str(output),'target':'aarch64-apple-darwin'},output/'capability.json',m.Budget(5))
 report=json.loads((output/'capability.json').read_bytes())
 assert result['rows']==12 and report['cleanupConfirmed'] and report['handlesClosed'] and report['objectsRemoved']
 assert not (output/'capability-owned').exists() and report['sourceWriteAdmitted'] is False and report['installedInputsWritten'] is False
 assert all(row['exactMtimeReadback'] for row in report['rows'])
print('Linux owned external/capability IO fixture PASS; no Darwin capability claim')
`;
test(
  "Mac shared reader and owned capability cleanup use real bounded Linux fixture IO without a Darwin claim",
  {
    skip:
      process.platform !== "linux"
        ? "POSIX FD/directory/symlink fixture; Darwin remains unobserved"
        : false,
  },
  () => {
    const result = python(MAC_WORKER_IO_PROOF, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /no Darwin capability claim/);
  },
);

test(
  "Linux source v2 policy rejects legacy sidecars and preserves reviewed payload/schema outside explicit literal witnesses",
  {
    skip:
      process.platform !== "linux"
        ? "Actual Linux filesystem equivalence; portable Mac policy checks run on every OS"
        : false,
  },
  async (t) => {
    const folder = await scratch(t),
      baseline = path.join(folder, "reviewed-linux.py");
    const reviewed = gunzipSync(
      Buffer.from(LINUX_SOURCE_BASELINE_GZIP, "base64"),
      { maxOutputLength: 256 * 1024 },
    );
    assert.equal(sha(reviewed), LINUX_SOURCE_BASELINE_SHA256);
    await writeFile(baseline, reviewed, { flag: "wx" });
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const code =
      setup +
      String.raw`
import types
old=types.ModuleType('reviewed_linux');old.__file__=sys.argv[2]
exec(compile(pathlib.Path(sys.argv[2]).read_bytes(),sys.argv[2],'exec'),old.__dict__)
with fixture(record=False) as (root,sidecar,identity):
 before=old.source_metadata('source-record',root,sidecar,identity,60);raw=sidecar.read_bytes()
 assert old.source_metadata('source-verify',root,sidecar,identity,60)['complete']
 with patch.object(m.os,'utime',side_effect=AssertionError('legacy policy must deny before writes')) as writes:
  try:m.source_metadata('source-apply',root,sidecar,identity,60)
  except m.CheckpointError as error:assert str(error)=='source-sidecar-binding'
  else:raise AssertionError('legacy policy admitted')
  writes.assert_not_called()
 sidecar.unlink();after=m.source_metadata('source-record',root,sidecar,identity,60);fresh=sidecar.read_bytes()
 legacy=json.loads(raw);current=json.loads(fresh)
 assert legacy['policy']!=current['policy'] and current['policy']==m.SOURCE_METADATA_POLICY
 assert current['snapshot'].pop('literalLinks')==[]
 current['policy']=legacy['policy'];assert current==legacy,'only-policy-and-fixed-witness-schema-difference'
 assert {k:v for k,v in before.items() if k!='sidecar'}=={k:v for k,v in after.items() if k!='sidecar'}
 assert m.source_metadata('source-verify',root,sidecar,identity,60)['complete']
 file=root/'src/input.cc';s=file.stat();shift=s.st_mtime_ns+1000000000
 sidecar.write_bytes(raw);os.utime(file,ns=(s.st_atime_ns,shift));first=old.source_metadata('source-apply',root,sidecar,identity,60);old_time=file.stat().st_mtime_ns
 sidecar.write_bytes(fresh);os.utime(file,ns=(s.st_atime_ns,shift));second=m.source_metadata('source-apply',root,sidecar,identity,60)
 assert first==second and file.stat().st_mtime_ns==old_time and fresh==sidecar.read_bytes(),'same-content-and-timestamp-transaction'
 assert set(json.loads(fresh))=={'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'}
 assert all('birthNs' not in row and 'uid' not in row and 'nlink' not in row for row in json.loads(fresh)['snapshot']['entries'])
 some=root/'src/some';some.mkdir();(root/'src/foo').mkdir();(some/'out').mkdir()
 (some/'out/file').write_bytes(b'owned lexical decoy');(root/'src/out/file').write_bytes(b'owned excluded fixture')
 os.symlink('../foo',some/'alias');os.symlink('alias/../out/file',some/'jump')
 assert (some/'jump').resolve(strict=True)==root/'src/out/file'
 assert old.source_link_target(root,some/'jump','alias/../out/file',old.Budget(5))==some/'out/file','actual-old-unsafe-accept'
 try:m.source_link_target(root,some/'jump','alias/../out/file',m.Budget(5))
 except m.CheckpointError as error:assert str(error)=='source-excluded-link','new-strict-denial'
 else:raise AssertionError('new resolver accepted actual excluded traversal')
print('reviewed-Linux payload and transaction parity; explicit new policy and witness schema PASS')
`;
    const result = python(code, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      baseline,
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /explicit new policy and witness schema PASS/);
  },
);

test("optional shared output ledger precharges both streams before forwarding and persists across actual supervisor invocations", async () => {
  const cap = 64 * 1024 ** 2,
    ledger = { bytes: cap - 3, cap };
  const first = await compileSupervisorModel({
    outputLedger: ledger,
    chunks: [["stdout", "ab"]],
    cleanExit: true,
  });
  assert.equal(first.failed, undefined);
  assert.equal(first.result.quiescent, true);
  assert.equal(ledger.bytes, cap - 1);
  assert.equal(Buffer.concat(first.forwarded).toString(), "ab");
  const second = await compileSupervisorModel({
    outputLedger: ledger,
    chunks: [
      ["stderr", "c"],
      ["stdout", "rejected"],
    ],
  });
  assert.equal(second.failed, true);
  assert.match(second.error.message, /Shared compile output bound/);
  assert.equal(ledger.bytes, cap);
  assert.equal(Buffer.concat(second.forwarded).toString(), "c");
  assert.equal(second.proofs, 0);
  assert.equal(second.stops, 1);
  assert.equal(
    JSON.parse(second.diagnostic.split("compile-supervision=")[1]).failureStage,
    "output-bound",
  );
  for (const invalid of [
    { bytes: -1, cap },
    { bytes: 0, cap: cap + 1 },
    { bytes: 0.5, cap },
    { bytes: cap + 1, cap },
  ]) {
    const denied = await compileSupervisorModel({ outputLedger: invalid });
    assert.match(denied.error.message, /Fixed shared output ledger/);
    assert.equal(denied.proofs, 0);
  }
});

test("optional actual supervisor observer is creation-bound, tracked without blocking monitoring and joined under original cleanup deadline", async () => {
  const state = await compileSupervisorModel({
    cleanExit: true,
    observeRoot: async (state, root, control) => {
      assert.deepEqual(root, {
        pid: 100,
        parent: 200,
        start: "Sat Oct 24 00:00:00 2026",
      });
      assert.equal(Object.isFrozen(root), true);
      assert.equal(Object.isFrozen(control), true);
      assert.equal(control.rootExited(), false);
      await new Promise((resolve) =>
        control.signal.addEventListener("abort", resolve, { once: true }),
      );
      state.observerJoined = true;
      assert.equal(control.rootExited(), true);
    },
  });
  assert.equal(state.observerJoined, true);
  assert.equal(state.result.quiescent, true);
  assert.equal(state.proofs, 1);
  const denied = await compileSupervisorModel({
    badOwner: true,
    observeRoot: () => assert.fail("foreign root observer must never run"),
  });
  assert.equal(denied.root, undefined);
  assert.equal(denied.proofs, 0);
  const hung = await compileSupervisorModel({
    cleanExit: true,
    observeRoot: () => new Promise(() => {}),
  });
  assert.match(hung.error.message, /cleanup deadline/);
  assert.equal(hung.proofs, 0);
  assert.equal(
    JSON.parse(hung.diagnostic.split("compile-supervision=")[1]).failureStage,
    "observer-join",
  );
  assert.ok(hung.elapsedMs < 300);
});

test("optional observer first errors including falsy values survive later writer failure and stalled writer cannot admit", async () => {
  for (const primary of [
    null,
    0,
    undefined,
    new Error("private original observer"),
  ]) {
    const state = await compileSupervisorModel({
      streamError: true,
      observeRoot: () => {
        throw primary;
      },
    });
    assert.equal(state.failed, true);
    assert.equal(state.error, primary);
    assert.equal(state.stops, 1);
    assert.equal(state.proofs, 0);
  }
  const writer = await compileSupervisorModel({
    outputLedger: { bytes: 0, cap: 64 * 1024 ** 2 },
    chunks: [["stdout", "held writer"]],
    stalledWriter: true,
    cleanExit: true,
  });
  assert.match(writer.error.message, /cleanup deadline/);
  assert.equal(writer.proofs, 0);
  assert.ok(writer.elapsedMs < 300);
  assert.equal(
    writer.streams.every((stream) => stream.destroyed),
    true,
  );
});

test(
  "Linux benign owned gate admits a short actor but denies root-exit inherited-output descendants with optional observer and ledger",
  {
    skip:
      process.platform !== "linux"
        ? "requires actual Linux Node and /proc; Windows is not POSIX proof"
        : false,
    timeout: 45000,
  },
  async (t) => {
    for (const descendant of [false, true]) {
      const root = await scratch(t),
        gate = path.join(root, "owned-ready-gate"),
        ledger = { bytes: 0, cap: 64 * 1024 ** 2 };
      const leaf =
        "process.stdout.write('owned-child\\n');setInterval(()=>{},100);";
      const action = descendant
        ? `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:['ignore',1,2]});setTimeout(()=>process.exit(0),900);`
        : "process.stdout.write('owned-short\\n');";
      const actor = `const fs=require('node:fs'),path=require('node:path');const gate=process.argv[1];let done=false;const watch=fs.watch(path.dirname(gate),start);const timer=setTimeout(()=>process.exit(77),4000);function start(){if(done||!fs.existsSync(gate))return;done=true;watch.close();clearTimeout(timer);${action}}start();`;
      let observed = false,
        joined = false;
      const call = compileSlice(process.execPath, ["-e", actor, gate], {
        cwd: root,
        env: { PATH: path.dirname(process.execPath) },
        logs: root,
        milliseconds: 6000,
        outputLedger: ledger,
        observeRoot: async (identity, control) => {
          assert.equal(identity.parent, process.pid);
          assert.equal(Object.isFrozen(identity), true);
          assert.equal(control.rootExited(), false);
          observed = true;
          await writeFile(gate, "ready", { flag: "wx" });
          if (!control.signal.aborted)
            await new Promise((resolve) =>
              control.signal.addEventListener("abort", resolve, { once: true }),
            );
          joined = true;
        },
      });
      if (descendant)
        await assert.rejects(call, /descendants survived compiler exit/);
      else {
        const result = await call;
        assert.equal(result.quiescent, true);
        assert.equal(result.exitCode, 0);
      }
      assert.equal(observed, true);
      assert.equal(joined, true);
      const before = await readFile(
        path.join(root, "checkpoint-compile.stdout.log"),
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(
        await readFile(path.join(root, "checkpoint-compile.stdout.log")),
        before,
      );
      assert.ok(ledger.bytes > 0 && ledger.bytes <= 64 * 1024 ** 2);
    }
  },
);

const NEARBY_LITERAL_PROOF = String.raw`
import base64,hashlib
MODULES=base64.b64decode('W3N1Ym1vZHVsZSAidGhpcmRfcGFydHkvcHJvdG9idWYiXQoJcGF0aCA9IHRoaXJkX3BhcnR5L3Byb3RvYnVmCgl1cmwgPSBodHRwczovL2dpdGh1Yi5jb20vcHJvdG9jb2xidWZmZXJzL3Byb3RvYnVmCglicmFuY2ggPSAzLjE5LngKW3N1Ym1vZHVsZSAidGhpcmRfcGFydHkvZ3Rlc3QiXQoJcGF0aCA9IHRoaXJkX3BhcnR5L2d0ZXN0Cgl1cmwgPSBodHRwczovL2dpdGh1Yi5jb20vZ29vZ2xlL2dvb2dsZXRlc3QKCWJyYW5jaCA9IG1haW4KW3N1Ym1vZHVsZSAidGhpcmRfcGFydHkvYWJzbCJdCglwYXRoID0gdGhpcmRfcGFydHkvYWJzbAoJdXJsID0gaHR0cHM6Ly9naXRodWIuY29tL2Fic2VpbC9hYnNlaWwtY3BwCglicmFuY2ggPSBtYXN0ZXIKW3N1Ym1vZHVsZSAidGhpcmRfcGFydHkvZGVwb3RfdG9vbHMiXQoJcGF0aCA9IHRoaXJkX3BhcnR5L2RlcG90X3Rvb2xzCgl1cmwgPSBodHRwczovL2Nocm9taXVtLmdvb2dsZXNvdXJjZS5jb20vY2hyb21pdW0vdG9vbHMvZGVwb3RfdG9vbHMuZ2l0CglicmFuY2ggPSBtYWluCltzdWJtb2R1bGUgInRoaXJkX3BhcnR5L3VrZXkyL3VrZXkyIl0KCXBhdGggPSB0aGlyZF9wYXJ0eS91a2V5Mi91a2V5MgoJdXJsID0gaHR0cHM6Ly9naXRodWIuY29tL2dvb2dsZS91a2V5MgoJYnJhbmNoID0gbWFzdGVyCltzdWJtb2R1bGUgInRoaXJkX3BhcnR5L3NtaGFzaGVyL3NtaGFzaGVyIl0KCXBhdGggPSB0aGlyZF9wYXJ0eS9zbWhhc2hlci9zbWhhc2hlcgoJdXJsID0gaHR0cHM6Ly9naXRodWIuY29tL2FhcHBsZWJ5L3NtaGFzaGVyCglicmFuY2ggPSBtYXN0ZXIKW3N1Ym1vZHVsZSAidGhpcmRfcGFydHkvc2VjdXJlbWVzc2FnZS9zZWN1cmVtZXNzYWdlIl0KCXBhdGggPSB0aGlyZF9wYXJ0eS9zZWN1cmVtZXNzYWdlL3NlY3VyZW1lc3NhZ2UKCXVybCA9IGh0dHBzOi8vZ2l0aHViLmNvbS9nb29nbGUvc2VjdXJlbWVzc2FnZS5naXQKCWJyYW5jaCA9IG1hc3Rlcgpbc3VibW9kdWxlICJ0aGlyZF9wYXJ0eS9nb29nbGUtdG9vbGJveC1mb3ItbWFjL2dvb2dsZS10b29sYm94LWZvci1tYWMiXQoJcGF0aCA9IHRoaXJkX3BhcnR5L2dvb2dsZS10b29sYm94LWZvci1tYWMvZ29vZ2xlLXRvb2xib3gtZm9yLW1hYwoJdXJsID0gaHR0cHM6Ly9naXRodWIuY29tL2dvb2dsZS9nb29nbGUtdG9vbGJveC1mb3ItbWFjLmdpdAoJYnJhbmNoID0gbWFpbgpbc3VibW9kdWxlICJ0aGlyZF9wYXJ0eS9tYmVkdGxzIl0KCXBhdGggPSB0aGlyZF9wYXJ0eS9tYmVkdGxzCgl1cmwgPSBodHRwczovL2dpdGh1Yi5jb20vQVJNbWJlZC9tYmVkdGxzCltzdWJtb2R1bGUgInRoaXJkX3BhcnR5L2pzb24vanNvbiJdCglwYXRoID0gdGhpcmRfcGFydHkvanNvbi9qc29uCgl1cmwgPSBodHRwczovL2dpdGh1Yi5jb20vbmxvaG1hbm4vanNvbgoJYnJhbmNoID0gbWFzdGVyCltzdWJtb2R1bGUgInRoaXJkX3BhcnR5L21pY3JvLWVjYyJdCglwYXRoID0gdGhpcmRfcGFydHkvbWljcm8tZWNjCgl1cmwgPSBodHRwczovL2dpdGh1Yi5jb20va21hY2theS9taWNyby1lY2MK')
assert len(MODULES)==1512 and hashlib.sha256(MODULES).hexdigest()==m.NEARBY_MODULES_SHA256
@contextmanager
def nearby_fixture():
 with fixture(record=False) as (root,sidecar,identity):
  nearby=root/m.NEARBY_ROOT;nearby.mkdir(parents=True)
  (nearby/'.git').mkdir();(nearby/'.git/HEAD').write_text(m.NEARBY_HEAD+'\n')
  (nearby/'.gitmodules').write_bytes(MODULES)
  (root/'.gclient_entries').write_text('entries = '+repr({'src':'https://public.example/src',m.NEARBY_ROOT:'https://chromium.googlesource.com/external/github.com/google/nearby-connections@'+m.NEARBY_HEAD})+'\n')
  for origin,target,gitlink,commit,remainder in m.NEARBY_LITERAL_LINKS:
   link=nearby/origin;link.parent.mkdir(parents=True,exist_ok=True)
   (nearby/gitlink).mkdir(parents=True,exist_ok=True);os.symlink(target,link)
  yield root,sidecar,identity
class NearbyLiteralProof(unittest.TestCase):
 def test_actual_five_literals_strict_old_red_new_record_apply_verify_green(self):
  with nearby_fixture() as (root,sidecar,identity):
   link=root/m.NEARBY_ROOT/'third_party/securemessage/include/securemessage'
   with self.assertRaises(FileNotFoundError) as caught:m.source_link_target(root,link,os.readlink(link),m.Budget(5))
   self.assertEqual(pathlib.Path(caught.exception.filename),root/m.NEARBY_ROOT/'third_party/securemessage/securemessage/cpp')
   self.assertTrue(m.source_metadata('source-record',root,sidecar,identity,60)['complete'])
   stored=json.loads(sidecar.read_bytes());w=stored['snapshot']['literalLinks'];self.assertEqual(len(w),5)
   rows={row['path']:row for row in stored['snapshot']['entries']}
   for origin,target,gitlink,commit,remainder in m.NEARBY_LITERAL_LINKS:
    self.assertEqual(rows[m.NEARBY_ROOT+'/'+origin]['target'],target)
    self.assertEqual(rows[m.NEARBY_ROOT+'/'+gitlink]['kind'],'directory')
   file=root/'src/input.cc';info=file.stat();os.utime(file,ns=(info.st_atime_ns,info.st_mtime_ns+1000000000))
   self.assertTrue(m.source_metadata('source-apply',root,sidecar,identity,60)['complete'])
   self.assertTrue(m.source_metadata('source-verify',root,sidecar,identity,60)['complete'])
   self.assertEqual(json.loads(sidecar.read_bytes()),stored)
 def test_binding_and_absence_mutants_deny_before_writes(self):
  for change in ('head','modules','target','nonempty','gitlink-alias','origin-alias','witness','old-policy','setid','header-hardlink','prefix-alias'):
   with self.subTest(change=change),nearby_fixture() as (root,sidecar,identity):
    m.source_metadata('source-record',root,sidecar,identity,60)
    nearby=root/m.NEARBY_ROOT;origin=nearby/m.NEARBY_LITERAL_LINKS[2][0];directory=nearby/m.NEARBY_LITERAL_LINKS[2][2]
    if change=='head':(nearby/'.git/HEAD').write_text('b'*40+'\n')
    elif change=='modules':(nearby/'.gitmodules').write_bytes(MODULES.replace(b'https:',b'httpx:'))
    elif change=='target':origin.unlink();os.symlink('../../../../outside',origin)
    elif change=='nonempty':(directory/'cpp').mkdir()
    elif change=='gitlink-alias':directory.rmdir();os.symlink('../include',directory)
    elif change=='origin-alias':origin.unlink();os.symlink('../securemessage/cpp/include/securemessage/..',origin)
    elif change=='setid':directory.chmod(directory.stat().st_mode|0o2000)
    elif change=='header-hardlink':os.link(nearby/'.gitmodules',root/'modules-copy')
    elif change=='prefix-alias':
     prefix=origin.parent;prefix.rename(prefix.with_name('saved'));os.symlink('saved',prefix)
    else:
     saved=json.loads(sidecar.read_bytes())
     if change=='witness':saved['snapshot']['literalLinks'][2]['gitlinkCommit']='b'*40
     else:saved['policy']='sorng-linuxarm-complete-owned-inputs-v1'
     sidecar.write_text(json.dumps(saved))
    with patch.object(m.os,'utime',side_effect=AssertionError('no write admitted')) as writes:
     with self.assertRaises((m.CheckpointError,FileNotFoundError)):m.source_metadata('source-apply',root,sidecar,identity,60)
     writes.assert_not_called()
 def test_held_absence_changes_and_replacement_deny(self):
  for change in ('entry','replace','header','link'):
   with self.subTest(change=change),nearby_fixture() as (root,sidecar,identity):
    policy=m.source_repositories(root,m.Budget(5));nearby=root/m.NEARBY_ROOT
    with self.assertRaises(m.CheckpointError):
     with m.source_nearby_literals(root,policy,m.Budget(5)):
      directory=nearby/m.NEARBY_LITERAL_LINKS[2][2]
      if change=='entry':(directory/'cpp').mkdir()
      elif change=='replace':directory.rename(directory.with_name('saved'));directory.mkdir()
      elif change=='header':(nearby/'.git/HEAD').write_text('b'*40+'\n')
      else:
       origin=nearby/m.NEARBY_LITERAL_LINKS[2][0];origin.unlink();os.symlink(m.NEARBY_LITERAL_LINKS[2][1],origin)
 def test_record_checks_original_held_witness_after_sidecar_write(self):
  with nearby_fixture() as (root,sidecar,identity):
   directory=root/m.NEARBY_ROOT/m.NEARBY_LITERAL_LINKS[2][2];original=m.metadata
   def replace_after_write(*args,**kwargs):
    result=original(*args,**kwargs);directory.rename(directory.with_name('saved'));directory.mkdir();return result
   with patch.object(m,'metadata',side_effect=replace_after_write):
    with self.assertRaisesRegex(m.CheckpointError,'source-nearby-changed'):m.source_metadata('source-record',root,sidecar,identity,60)
 def test_unlisted_links_stay_strict_and_first_error_survives_close(self):
  for target in ('missing/../input.cc','input.cc/../input.cc','../out/file'):
   with self.subTest(target=target),nearby_fixture() as (root,sidecar,identity):
    os.symlink(target,root/'src/unlisted')
    with self.assertRaises((m.CheckpointError,FileNotFoundError)):m.source_metadata('source-record',root,sidecar,identity,60)
  with nearby_fixture() as (root,sidecar,identity):
   first=RuntimeError('primary');close=m.os.close
   def close_fault(fd):close(fd);raise OSError('secondary')
   with patch.object(m.os,'close',side_effect=close_fault):
    try:
     with m.source_nearby_literals(root,m.source_repositories(root,m.Budget(5)),m.Budget(5)):raise first
    except RuntimeError as error:self.assertIs(error,first)
    else:self.fail('primary lost')
unittest.main(argv=['nearby-literal-proof'])
`;

test(
  "Nearby exact pinned empty-gitlink literals preserve full owned inventory and deny mutations before apply",
  {
    skip:
      process.platform !== "linux"
        ? "Actual POSIX symlink and held directory witnesses"
        : false,
  },
  () => {
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const result = python(setup + NEARBY_LITERAL_PROOF, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Ran 5 tests/);
  },
);

test("Mac SDK relation requires exact observed physical root and held logical 26.2 alias", async () => {
  const { mac, options } = await macExternalFixture();
  assert.equal(options.sdkRelation.physical, options.sdkTargets[0]);
  assert.equal(options.sdkRelation.literal, "MacOSX.sdk");
  const proof = options.sdkRelation;
  assert.throws(
    () =>
      mac.macExternalObservationPlan({ ...options, sdkRelation: { ...proof } }),
    /SDK_RELATION/,
  );
  assert.throws(
    () =>
      mac.macExternalObservationPlan({ ...options, sdkRelation: undefined }),
    /SDK_RELATION/,
  );
  for (const io of [
    sdkRelationIo({ readlink: async () => "MacOSX26.1.sdk" }),
    sdkRelationIo({ readlink: async () => "../SDKs/MacOSX.sdk" }),
    sdkRelationIo({ realpath: async () => "/foreign/MacOSX.sdk" }),
    sdkRelationIo({ lstat: async () => ({ isSymbolicLink: () => false }) }),
  ])
    await assert.rejects(
      mac.macSdkRelation({ ...options, check: () => {} }, io),
      /SDK_RELATION/,
    );
  let reads = 0;
  const stableIo = sdkRelationIo();
  await assert.rejects(
    mac.macSdkRelation(
      { ...options, check: () => {} },
      sdkRelationIo({
        lstat: async (...args) => ({
          ...(await stableIo.lstat(...args)),
          ino: BigInt(++reads),
        }),
      }),
    ),
    /SDK_RELATION_CHANGED/,
  );
  await assert.rejects(
    mac.macSdkRelation(
      {
        ...options,
        sdkTargets: [
          options.sdkTargets[0].replace("MacOSX.sdk", "MacOSX26.2.sdk"),
          ...options.sdkTargets.slice(1),
        ],
        check: () => {},
      },
      sdkRelationIo(),
    ),
    /SDK_RELATION/,
  );
  let ioCount = 0;
  await assert.rejects(
    mac.macSdkRelation(
      {
        ...options,
        check: () => {
          throw new Error("EXPIRED");
        },
      },
      sdkRelationIo({
        lstat: async () => {
          ioCount++;
        },
      }),
    ),
    /EXPIRED/,
  );
  assert.equal(ioCount, 0);
});

test("actual Python Mac context root admission matches the fixed physical SDK and denies versioned or foreign roots", () => {
  const result = python(
    String.raw`import ast,sys,pathlib,types,json,copy
from unittest.mock import patch
m=types.ModuleType('sdk_context');exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)
tree=ast.parse(pathlib.Path(sys.argv[1]).read_bytes());node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='mac_external_context')
# Actual production prefix through roots admission; no output filesystem access or full-runtime claim.
end=next(i for i,n in enumerate(node.body)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='names'for t in n.targets));node.body=node.body[:end]+[ast.Return(ast.Name(id='context',ctx=ast.Load()))]
exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'actual-context-prefix','exec'),m.__dict__)
d='/Applications/Xcode_26.3.app/Contents/Developer';root='/Users/runner/work/_temp/cef-mac-inputs-11111111-1111-4111-8111-111111111111'
c={'schemaVersion':1,'kind':'sorng-macarm-external-input-context','target':'aarch64-apple-darwin','roots':{'sdk':d+'/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk','toolchain':d+'/Toolchains/XcodeDefault.xctoolchain','metal':d+'/Toolchains/XcodeDefault.xctoolchain','python':'/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework'},'runnerTemp':'/Users/runner/work/_temp','outputRoot':root,'requiredPins':[],'limits':{'entries':1000000,'fileBytes':8*1024**3,'bytes':256*1024**3,'metadataBytes':128*1024**2,'readers':4,'seconds':600,'capabilitySeconds':5},'originalMetalFingerprint':{},'historicalMetalResourceClosureVerified':False}
def run(value):
 with patch.object(sys,'platform','darwin'),patch.object(m,'source_read_bytes',return_value=json.dumps(value).encode()):return m.mac_external_context(pathlib.PurePosixPath(root+'/context.json'),pathlib.PurePosixPath(root+'/external.json'),'mac-external-observe',m.Budget(5))
assert run(c)['roots']['sdk']==c['roots']['sdk']
for name in ['MacOSX26.2.sdk','MacOSX26.3.sdk','Foreign.sdk','MacOSX.sdk/..']:
 bad=copy.deepcopy(c);bad['roots']['sdk']=d+'/Platforms/MacOSX.platform/Developer/SDKs/'+name
 try:run(bad);raise AssertionError(name)
 except m.CheckpointError as e:assert str(e)=='source-mac-roots'
print('actual roots prefix: physical GREEN; four alias/foreign mutations DENY; admission-only')
`,
    [path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py")],
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /physical GREEN/);
});

const MAC_BIRTH_AVAILABILITY_PROOF = String.raw`import sys,pathlib,types,stat,unittest,tempfile,os,hashlib
from unittest.mock import patch
m=types.ModuleType('birth_fixture');m.__file__=sys.argv[1]
exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],'exec'),m.__dict__)
# Exact pre-correction function (b7b9676f): a data-only causal baseline.
old_source="def source_birth(info):\n    value = getattr(info, 'st_birthtime_ns', None)\n    require(type(value) is int and 0 <= value < 2**63, 'source-mac-birth-unavailable')\n    return value\n"
old={'require':m.require};exec(compile(old_source,'reviewed-b7-source-birth','exec'),old)
external={'mac':True,'external':True}
class BirthAvailability(unittest.TestCase):
 def info(self,**extra):
  return types.SimpleNamespace(st_size=3,st_mtime_ns=11,st_dev=1,st_ino=2,st_mode=stat.S_IFREG|0o644,st_nlink=1,st_ctime_ns=12,st_uid=0,st_gid=0,**extra)
 def test_actual_old_red_external_unavailable_green_strict_default_stays_red(self):
  info=self.info(st_birthtime=1.25)
  with self.assertRaisesRegex(m.CheckpointError,'source-mac-birth-unavailable'):old['source_birth'](info)
  self.assertIsNone(m.source_birth(info,external))
  for policy in [None,{}, {'mac':True}, {'mac':True,'external':False}, {'mac':False,'external':True}, {'mac':True,'external':1}]:
   with self.subTest(policy=policy),self.assertRaisesRegex(m.CheckpointError,'source-mac-birth-unavailable'):m.source_birth(info,policy)
  self.assertFalse(m.MAC_SOURCE_WRITE_ADMITTED)
 def test_available_exact_and_all_malformed_attributes_deny(self):
  for value in [0,1770000000123456789,2**63-1]:
   self.assertEqual(m.source_birth(self.info(st_birthtime_ns=value),external),value)
  for value in [None,False,True,-1,2**63,1.25,'12',float('nan'),float('inf')]:
   with self.subTest(value=repr(value)),self.assertRaisesRegex(m.CheckpointError,'source-mac-birth-unavailable'):m.source_birth(self.info(st_birthtime_ns=value),external)
 def test_actual_local_and_row_identity_preserve_availability_and_all_other_fields(self):
  missing=self.info();available=self.info(st_birthtime_ns=17)
  self.assertNotEqual(m.source_local(missing,external),m.source_local(available,external))
  self.assertNotEqual(m.source_local(available,external),m.source_local(self.info(st_birthtime_ns=18),external))
  base=m.source_local(missing,external)
  for key in ['st_dev','st_ino','st_nlink','st_mode','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_gid']:
   changed=self.info();setattr(changed,key,getattr(changed,key)+1);self.assertNotEqual(base,m.source_local(changed,external),key)
  row={};m.source_mac_row(row,missing,external);self.assertIsNone(row['birthNs'])
  row={};m.source_mac_row(row,available,external);self.assertEqual(row['birthNs'],17)
 @unittest.skipUnless(sys.platform=='linux','owned POSIX snapshot fixture; not a Darwin kernel claim')
 def test_actual_physical_snapshot_hash_and_root_null_pair(self):
  with tempfile.TemporaryDirectory(prefix='birth-snapshot-') as folder:
   root=pathlib.Path(folder);(root/'dir').mkdir();(root/'file').write_bytes(b'owned birth availability');os.symlink('file',root/'alias')
   original=(root/'file').stat();snapshot=m.source_snapshot(root,m.Budget(5),context={**external,'aggregate':{'entries':0,'bytes':0,'metadata':0}})
   self.assertEqual(snapshot['localRoot']['birthtimeNsAvailable'],False);self.assertIsNone(snapshot['localRoot']['birthtimeNs'])
   rows={row['path']:row for row in snapshot['entries']};self.assertEqual(len(rows),3);self.assertEqual(rows['file']['sha256'],hashlib.sha256(b'owned birth availability').hexdigest());self.assertEqual(rows['alias']['target'],'file');self.assertEqual(m.stamp(original),m.stamp((root/'file').stat()))
   with patch.object(m,'source_birth',return_value=17):
    present=m.source_snapshot(root,m.Budget(5),context={**external,'aggregate':{'entries':0,'bytes':0,'metadata':0}})
   self.assertEqual(present['localRoot']['birthtimeNsAvailable'],True);self.assertEqual(present['localRoot']['birthtimeNs'],'17');self.assertEqual(snapshot['entries'],present['entries'])
   s=(root/'file').stat();row={'path':'file','stamp':m.stamp(s),'ctimeNs':s.st_ctime_ns,'uid':s.st_uid,'gid':s.st_gid,'birthNs':17}
   with self.assertRaisesRegex(m.CheckpointError,'source-mac-file-identity'):m.source_hash(root,row,m.Budget(5),external)
   row['birthNs']=None
   with patch.object(m,'source_birth',return_value=17),self.assertRaisesRegex(m.CheckpointError,'source-mac-file-identity'):m.source_hash(root,row,m.Budget(5),external)
   for transition in [2,4]:
    calls=0;observed={}
    def file_drift(info,policy=None):
     nonlocal calls
     calls+=1
     # A captured stat result is immutable: repeated checks of the SAME
     # pre-read object must retain its original value, unlike new observations.
     key=id(info)
     if key not in observed:observed[key]=(info,None if calls<transition else 17)
     return observed[key][1]
    with patch.object(m,'source_birth',side_effect=file_drift),self.assertRaisesRegex(m.CheckpointError,'source-mac-file-(identity|changed)'):m.source_hash(root,row,m.Budget(5),external)
   calls=0
   def drift(info,policy=None):
    nonlocal calls
    calls+=1
    return None if calls==1 else 17
   with patch.object(m,'source_birth',side_effect=drift),self.assertRaises(m.CheckpointError):m.source_snapshot(root,m.Budget(5),context={**external,'aggregate':{'entries':0,'bytes':0,'metadata':0}})
unittest.main(argv=['birth-availability'],verbosity=2)
`;

test("Mac external birth availability uses actual guards with strict nonexternal semantics", () => {
  const result = python(MAC_BIRTH_AVAILABILITY_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 4 tests/);
});

const MAC_MEMBER_DIAGNOSTIC_PROOF = String.raw`
import ast,contextlib,hashlib,importlib.util,io,json,pathlib,sys,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('member_subject',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=pathlib.Path(sys.argv[1]).read_bytes();tree=ast.parse(source)
ROOT=pathlib.PurePosixPath('/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk')
POLICY={'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}}
class MemberDiagnostic(unittest.TestCase):
 def failure(self,name,policy=None,role='sdk',phase='snapshot',projection=None):
  originals=[];calls=[];original_relative=m.relative
  class Entry:
   def __init__(self):self.name=name
   def stat(self,**kwargs):calls.append('stat');raise AssertionError('denial must precede metadata')
  @contextlib.contextmanager
  def namespace(*args,**kwargs):yield iter([Entry()])
  def authority(value):
   try:return original_relative(value)
   except m.CheckpointError as error:originals.append(error);raise
  with contextlib.ExitStack() as stack:
   for attribute,value in [('Path',pathlib.PurePosixPath),('source_directory',namespace),('relative',authority),('MAC_EXTERNAL_ROLE',role),('MAC_EXTERNAL_PHASE',phase)]:stack.enter_context(patch.object(m,attribute,value))
   if projection is not None:stack.enter_context(patch.object(m,'external_member_diagnostic',projection))
   try:m.inventory(ROOT,m.Budget(5),source_policy=POLICY if policy is None else policy)
   except m.CheckpointError as error:
    self.assertEqual(len(originals),1);self.assertIs(error,originals[0]);self.assertEqual(str(error),'member-path');self.assertEqual(calls,[])
    fields=m.external_member_fields(error)
    # Execute the actual existing top-level exception output/exit body only.
    handler=tree.body[-1].body[0].handlers[0];scope=dict(m.__dict__);scope['error']=error
    captured=io.StringIO()
    with contextlib.redirect_stdout(captured),self.assertRaises(SystemExit) as exit:
     exec(compile(ast.Module(body=handler.body,type_ignores=[]),'<actual-error-printer>','exec'),scope)
    self.assertEqual(exit.exception.code,1);printed=json.loads(captured.getvalue());self.assertEqual(printed['error'],'member-path');self.assertIs(printed['complete'],False)
    self.assertEqual(printed.get('externalMemberFailure'),fields.get('externalMemberFailure'))
    return error,fields,printed
   self.fail('expected original member-path denial')
 def test_relative_ast_and_valid_names_unchanged(self):
  node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='relative')
  self.assertEqual(hashlib.sha256(ast.dump(node,include_attributes=False).encode()).hexdigest(),'4359080f3212ff3b5d0a7707c3b00719f243bd5724229e10e84c1ee0ecc9c7f4')
  for value in ['usr/include/header.h','System/Library/Frameworks/public.h','public/Unicode-Ł-😀.h']:
   self.assertEqual(m.relative(value),value);self.assertIsNone(m.external_member_diagnostic(value))
 def test_actual_inventory_group_diagnostics_keep_original_denial_and_no_io(self):
  cases=[('x'*1025,'type-or-byte-bound','byte-bound'),('public:header.h','absolute-backslash-or-colon','colon'),('public\\header.h','absolute-backslash-or-colon','backslash'),('public/trailing.','component-syntax','trailing-space-or-dot'),('public/CON.h','component-syntax','dos-reserved-component'),('public/control\x01.h','control-character','control')]
  for name,predicate,subpredicate in cases:
   with self.subTest(name=name[:32]):
    error,fields,printed=self.failure(name);row=fields['externalMemberFailure'];self.assertEqual(row['predicate'],predicate);self.assertEqual(row['subpredicate'],subpredicate);self.assertEqual(row['role'],'sdk');self.assertEqual(row['phase'],'snapshot');self.assertEqual(row['site'],'inventory-relative');self.assertLessEqual(len(row['pathPrefix']),256);self.assertLessEqual(len(json.dumps(row,ensure_ascii=True).encode()),4096)
 def test_nonexternal_linux_and_other_roles_omit_all_member_values(self):
  for policy,role,phase in [({'mac':False,'external':True},'sdk','snapshot'),({'mac':True,'external':False},'sdk','snapshot'),(POLICY,'metal','snapshot'),(POLICY,None,'snapshot'),(POLICY,'sdk','pins')]:
   error,fields,printed=self.failure('public/CON.h',policy,role,phase);self.assertEqual(fields,{});self.assertFalse(hasattr(error,'external_member_failure'));self.assertNotIn('externalMemberFailure',printed)
 def test_projection_failure_never_masks_original(self):
  def broken(value):raise RuntimeError('private projection error')
  error,fields,printed=self.failure('public/CON.h',projection=broken);self.assertEqual(fields,{});self.assertNotIn('externalMemberFailure',printed);self.assertNotIn('private',json.dumps(printed))
 def test_private_absolute_and_parent_values_omitted_and_escaping_bounded(self):
  for name in ['/Users/private/secret.h','public/../private/secret.h',r'C:\Users\private\secret.h',r'C:private\secret.h',r'\\server\private\secret.h','~/private/secret.h.']:
   error,fields,printed=self.failure(name);row=fields['externalMemberFailure'];self.assertIsNone(row['pathPrefix']);self.assertIs(row['pathOmitted'],True);self.assertNotIn('secret',json.dumps(printed));self.assertNotIn('private',json.dumps(printed))
  public=m.external_member_diagnostic('public:header.h');self.assertEqual(public['pathPrefix'],'public:header.h');self.assertEqual(public['subpredicate'],'colon');self.assertIs(public['pathOmitted'],False)
  row=m.external_member_diagnostic('😀'*1025);self.assertIsNone(row['characterCount']);self.assertEqual(row['characterCountAtLeast'],1025);self.assertIsNone(row['utf8Bytes']);self.assertEqual(len(row['pathPrefix']),256);self.assertLessEqual(len(json.dumps(row,ensure_ascii=True).encode()),4096)
  for name in ['public/.','public/..','public//file','public/trailing ','public/\x7f.h']:
   row=m.external_member_diagnostic(name);self.assertIsNotNone(row);self.assertLessEqual(len(json.dumps(row,ensure_ascii=True).encode()),4096)
 def test_forged_unknown_and_overbound_attributes_not_serialized(self):
  m.MAC_EXTERNAL_ROLE='sdk';m.MAC_EXTERNAL_PHASE='snapshot'
  original=m.external_member_diagnostic('public/CON.h')
  for change in [{'unknown':'private'}, {'pathPrefix':'/Users/private/secret'}, {'pathPrefix':r'C:\Users\private\secret.h'}, {'pathPrefix':r'C:private\secret.h'}, {'pathPrefix':'x'*257}, {'utf8Bytes':'private'}, {'characterCount':True}]:
   error=m.CheckpointError('member-path');error.external_member_failure={**original,**change};self.assertEqual(m.external_member_fields(error),{})
unittest.main(argv=['external-member-diagnostic'],verbosity=2)
`;

test("Mac external SDK member diagnostics preserve actual relative denial and closed error output", () => {
  const result = python(MAC_MEMBER_DIAGNOSTIC_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 6 tests/);
});

const MAC_EXTERNAL_FULLMODE_PHYSICAL = String.raw`import hashlib,importlib.util,json,os,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('fullmode_subject',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert sys.platform=='linux','owned POSIX fixture only; not Darwin installed SDK evidence'
with tempfile.TemporaryDirectory(prefix='external-fullmode-')as folder:
 root=pathlib.Path(folder)/'sdk';(root/'directory').mkdir(parents=True);(root/'file').write_bytes(b'owned full st_mode fixture\n');os.symlink('file',root/'alias')
 policy={'mac':True,'external':True,'aggregate':{'entries':0,'bytes':0,'metadata':0}}
 before={str(p.relative_to(root)):m.source_local(p.lstat(),policy)for p in [root,*root.rglob('*')]}
 snapshot=m.source_snapshot(root,m.Budget(5),context=policy)
 after={str(p.relative_to(root)):m.source_local(p.lstat(),policy)for p in [root,*root.rglob('*')]};assert before==after
 assert snapshot['root']['mode']==root.stat().st_mode
 for row in snapshot['entries']:assert row['mode']==(root/row['path']).lstat().st_mode
 assert next(r for r in snapshot['entries']if r['path']=='file')['sha256']==hashlib.sha256(b'owned full st_mode fixture\n').hexdigest()
 print(json.dumps(snapshot,separators=(',',':')))
`;

function externalFullModeReport(plan, snapshot = null) {
  const value = {
    schemaVersion: 1,
    kind: "sorng-macarm-external-input-observation",
    target: "aarch64-apple-darwin",
    policy: "sorng-macarm-readonly-external-inputs-v1",
    complete: true,
    externalSnapshotComplete: true,
    roles: Object.entries(plan.context.roots).map(([role, physicalRoot]) => ({
      role,
      physicalRoot,
      snapshot: {
        rootMtimeNs: "1",
        gitHeads: {},
        root: { mode: 0o40755, mtimeNs: "1", uid: 0, gid: 0, nlink: 2 },
        localRoot: {
          dev: "1",
          ino: "2",
          ctimeNs: "3",
          birthtimeNsAvailable: false,
          birthtimeNs: null,
        },
        bytes: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .reduce((sum, pin) => sum + pin.size, 0),
        entries: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .map((pin) => ({
            path: pin.path,
            kind: "file",
            mode: 0o100644,
            mtimeNs: "1",
            nlink: 1,
            uid: 0,
            gid: 0,
            size: pin.size,
            sha256: pin.sha256,
          })),
      },
    })),
    entries: 10,
    bytes: plan.context.requiredPins.reduce((sum, pin) => sum + pin.size, 0),
    runnerUid: 501,
    historicalMetalResourceClosureVerified: false,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  if (snapshot) {
    const sdk = value.roles.find((row) => row.role === "sdk").snapshot;
    value.runnerUid = snapshot.root.uid;
    sdk.root = snapshot.root;
    sdk.localRoot = snapshot.localRoot;
    sdk.rootMtimeNs = snapshot.rootMtimeNs;
    sdk.entries.push(...snapshot.entries);
    sdk.bytes += snapshot.bytes;
    value.entries += snapshot.entries.length;
    value.bytes += snapshot.bytes;
  }
  return value;
}

async function admitExternalFullMode(mac, plan, value) {
  const raw = Buffer.from(JSON.stringify(value));
  const identity = {
    dev: 1n,
    ino: 2n,
    mode: 0o100600n,
    nlink: 1n,
    size: BigInt(raw.length),
    mtimeNs: 1n,
    ctimeNs: 2n,
    birthtimeNs: 3n,
    isFile: () => true,
  };
  const summary = {
    complete: true,
    kind: value.kind,
    entries: value.entries,
    bytes: value.bytes,
    snapshot: {
      name: "external.json",
      bytes: raw.length,
      sha256: hashObject("sha256").update(raw).digest("hex"),
    },
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  let closed = 0;
  try {
    return await mac.readMacExternalObservation(plan, summary, () => {}, {
      lstat: async (file) =>
        file.endsWith("/external.json")
          ? identity
          : {
              ...identity,
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
      realpath: async (file) => file,
      open: async () => ({
        stat: async () => identity,
        readFile: async () => raw,
        close: async () => {
          closed++;
        },
      }),
    });
  } finally {
    assert.equal(closed, 1);
  }
}

test("actual Mac external mode reader preserves full typed producer modes and denies permission-only, wrong-kind and malformed modes", async () => {
  const { mac, plan } = await macExternalFixture();
  const value = externalFullModeReport(plan);
  const snapshot = value.roles[0].snapshot;
  for (const [name, kind, mode, extra] of [
    [
      "file",
      "file",
      0o100640,
      { size: 0, sha256: hashObject("sha256").update("").digest("hex") },
    ],
    ["directory", "directory", 0o41750, {}],
    [
      "alias",
      "symlink",
      0o120777,
      {
        target: "file",
        sha256: hashObject("sha256").update("file").digest("hex"),
      },
    ],
  ]) {
    snapshot.entries.push({
      path: name,
      kind,
      mode,
      mtimeNs: "1",
      nlink: 1,
      uid: 0,
      gid: 0,
      ...extra,
    });
    value.entries++;
  }
  const proof = await admitExternalFullMode(mac, plan, value);
  const binding = mac.macExternalToolsBinding({}, proof);
  for (const row of snapshot.entries)
    assert.equal(
      binding.macExternalInputs.roles[0].entries.find(
        (item) => item.path === row.path,
      ).mode,
      row.mode,
    );
  assert.throws(
    () => mac.macExternalToolsBinding({}, { ...proof }),
    /MAC_EXTERNAL_ATTESTATION/,
  );
  const badModes = [
    0,
    0o755,
    0o644,
    0o7777,
    -1,
    1.5,
    "16877",
    true,
    null,
    NaN,
    Infinity,
    0x10000,
    0x14000,
    0o020644,
    0o060644,
    0o140644,
  ];
  for (const mode of badModes) {
    const bad = structuredClone(value);
    bad.roles[0].snapshot.root.mode = mode;
    await assert.rejects(
      admitExternalFullMode(mac, plan, bad),
      /MAC_EXTERNAL_ROLE/,
    );
  }
  for (const kind of ["file", "directory", "symlink"]) {
    const at = value.roles[0].snapshot.entries.findIndex(
      (row) => row.kind === kind,
    );
    for (const mode of [...badModes, 0o100644, 0o40755, 0o120777].filter(
      (mode) =>
        !(
          { file: 0o100000, directory: 0o040000, symlink: 0o120000 }[kind] ===
            (mode & 0xf000) &&
          Number.isInteger(mode) &&
          mode >= 0 &&
          mode <= 0xffff
        ),
    )) {
      const bad = structuredClone(value);
      bad.roles[0].snapshot.entries[at].mode = mode;
      await assert.rejects(
        admitExternalFullMode(mac, plan, bad),
        /MAC_EXTERNAL_ENTRY/,
      );
    }
  }
});

test(
  "physical POSIX full-mode snapshot crosses the actual opaque report reader without mode conversion",
  {
    skip:
      process.platform !== "linux"
        ? "Linux owned fixture; no Darwin SDK/kernel claim"
        : false,
  },
  async () => {
    const result = python(MAC_EXTERNAL_FULLMODE_PHYSICAL, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const snapshot = JSON.parse(result.stdout);
    const { mac, plan } = await macExternalFixture();
    const value = externalFullModeReport(plan, snapshot);
    const proof = await admitExternalFullMode(mac, plan, value);
    const binding = mac.macExternalToolsBinding({}, proof);
    for (const row of snapshot.entries) {
      const portable = binding.macExternalInputs.roles[0].entries.find(
        (item) => item.path === row.path,
      );
      assert.equal(portable.mode, row.mode);
      if (row.kind === "file") assert.equal(portable.sha256, row.sha256);
    }
    assert.equal(value.roles[0].snapshot.root.mode, snapshot.root.mode);
  },
);

const MAC_SDK_COLON_PROOF = String.raw`import ast,contextlib,hashlib,importlib.util,json,os,pathlib,sys,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('colon_subject',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NAME='usr/share/man/mann/ttk::progressbar.ntcl'
EXTERNAL={'mac':True,'external':True}
def policy():return {**EXTERNAL,'aggregate':{'entries':0,'bytes':0,'metadata':0}}
class SdkColon(unittest.TestCase):
 def test_relative_ast_and_strict_archive_default_and_apply_member_calls_unchanged(self):
  tree=ast.parse(pathlib.Path(sys.argv[1]).read_bytes());node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='relative')
  self.assertEqual(hashlib.sha256(ast.dump(node,include_attributes=False).encode()).hexdigest(),'4359080f3212ff3b5d0a7707c3b00719f243bd5724229e10e84c1ee0ecc9c7f4')
  for name in [NAME,'public:header','file:stream','C:relative','C:/absolute']:
   with self.assertRaisesRegex(m.CheckpointError,'member-path'):m.relative(name)
  # Current typed registry/source-IO wrappers still reach the unchanged guard.
  # Inspect the real current call chain, not the old private direct-call layout.
  for fn,callee in [('link_recipe','relative'),('source_repositories','source_registry_repository'),('source_registry_repository','source_relative'),('source_relative','relative'),('source_metadata','source_metadata_owned'),('source_metadata_owned','relative')]:
   node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name==fn)
   self.assertTrue(any(isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id==callee for n in ast.walk(node)),fn+' -> '+callee)
  with self.assertRaisesRegex(m.CheckpointError,'member-path'):m.source_relative('src/public:header','filesystem-member')
  with self.assertRaisesRegex(m.CheckpointError,'^source-registry-kind$'):m.source_registry_repository('src/public:header','https://public.example/repository')
 def test_literal_colon_and_all_prior_unsafe_components_remain_closed(self):
  for name in [NAME,'public:header','dir/Unicode-Ł-😀:header']:
   self.assertEqual(m.mac_external_sdk_relative(name),name)
  for name in ['',None,42,'/abs','C:relative','c:/absolute',r'c:\absolute',r'\\host\share','a/../b','a/./b','a//b','a/','a/trailing.','a/trailing ','a/CON.h','a/NUL','a/com9.txt','a/control\x00','a/control\x7f','Ł'*513]:
   with self.subTest(name=repr(name)),self.assertRaisesRegex(m.CheckpointError,'member-path'):m.mac_external_sdk_relative(name)
 def test_capability_cannot_be_json_global_or_foreign_root_selected(self):
  root=pathlib.Path(m._MAC_EXTERNAL_SDK_ROOT)
  self.assertIs(m.source_member_policy(root,policy(),m._MAC_EXTERNAL_SDK_MEMBERS),m.mac_external_sdk_relative)
  for value in [None,True,'sdk',{'sdk':True},object()]:
   if value is None:self.assertIs(m.source_member_policy(root,{**policy(),'allowColon':True},value),m.relative)
   else:
    with self.assertRaisesRegex(m.CheckpointError,'source-member-policy'):m.source_member_policy(root,policy(),value)
  for p in [None,{}, {'mac':False,'external':True},{'mac':True,'external':False},{'mac':1,'external':True}]:
   with self.assertRaisesRegex(m.CheckpointError,'source-member-policy'):m.source_member_policy(root,p,m._MAC_EXTERNAL_SDK_MEMBERS)
  # Rejection occurs before any Path.stat/read side effect, even on PurePath.
  with self.assertRaisesRegex(m.CheckpointError,'source-member-policy'):m.source_snapshot(pathlib.PurePosixPath('/wrong'),m.Budget(5),context=policy(),member_policy=m._MAC_EXTERNAL_SDK_MEMBERS)
  with patch.object(m,'MAC_EXTERNAL_ROLE','sdk'),patch.object(m,'MAC_EXTERNAL_PHASE','snapshot'):
   self.assertIs(m.source_member_policy(root,policy(),None),m.relative)
 def test_exact_validated_sdk_branch_propagates_token_to_both_outer_passes(self):
  root=m._MAC_EXTERNAL_SDK_ROOT;context={'roots':{'sdk':root,'toolchain':'/toolchain','metal':'/metal','python':'/python'},'requiredPins':[],'target':'aarch64-apple-darwin'}
  calls=[];snapshot={'entries':[]};value={}
  class Root(pathlib.PurePosixPath):
   def is_dir(self):return True
  def capture(root,budget,guards=None,context=None,*,member_policy=None):
   calls.append((str(root),member_policy));return snapshot
  def store(root,name,v,source=False):value.update(v);return {'name':name}
  with patch.object(m.os,'geteuid',return_value=501,create=True),patch.object(m,'Path',Root),patch.object(m,'safe',side_effect=lambda p:p),patch.object(m,'source_snapshot',side_effect=capture),patch.object(m,'mac_external_links'),patch.object(m,'metadata',side_effect=store),patch.object(m,'source_read_sidecar',side_effect=lambda *a:value):
   result=m.mac_external_observe(context,Root('/owned/external.json'),m.Budget(5))
  self.assertTrue(result['complete']);self.assertEqual(len(calls),8)
  for path,token in calls:self.assertIs(token,m._MAC_EXTERNAL_SDK_MEMBERS if path==root else None)
 @unittest.skipUnless(sys.platform=='linux','actual owned POSIX tree; not a Darwin installed SDK claim')
 def test_physical_old_red_scoped_snapshot_json_readback_hash_links_and_source_unchanged(self):
  with tempfile.TemporaryDirectory(prefix='sdk-colon-')as folder:
   temp=pathlib.Path(folder);root=temp/'sdk';(root/pathlib.Path(NAME).parent).mkdir(parents=True);body=b'owned SDK colon fixture\n';(root/NAME).write_bytes(body);os.symlink(NAME,root/'alias:header')
   before={str(p.relative_to(root)):m.source_local(p.lstat(),policy())for p in [root,*root.rglob('*')]}
   # Only the fixed-root constant is mapped to an owned fixture; production
   # exact-root admission itself is separately exercised above without IO.
   with patch.object(m,'_MAC_EXTERNAL_SDK_ROOT',str(root)):
    with self.assertRaisesRegex(m.CheckpointError,'member-path'):m.source_snapshot(root,m.Budget(5),context=policy())
    for extra in [{'allowColon':True},{'member_policy':'sdk'},{'sdk':True}]:
     with self.assertRaisesRegex(m.CheckpointError,'member-path'):m.source_snapshot(root,m.Budget(5),context={**policy(),**extra})
    snapshot=m.source_snapshot(root,m.Budget(5),context=policy(),member_policy=m._MAC_EXTERNAL_SDK_MEMBERS)
    self.assertEqual(snapshot,m.source_snapshot(root,m.Budget(5),context=policy(),member_policy=m._MAC_EXTERNAL_SDK_MEMBERS))
    rows={r['path']:r for r in snapshot['entries']};self.assertEqual(rows[NAME]['sha256'],hashlib.sha256(body).hexdigest());self.assertEqual(rows[NAME]['size'],len(body));self.assertEqual(rows['alias:header']['target'],NAME)
    roots={role:str(root if role=='sdk'else temp/role)for role in ['sdk','toolchain','metal','python']};snapshots={role:snapshot if role=='sdk'else {'entries':[]}for role in roots};m.mac_external_links(roots,snapshots,m.Budget(5))
    written=m.metadata(temp,'external.json',snapshot,source=True);self.assertEqual(m.source_read_sidecar(temp/'external.json',m.Budget(5)),snapshot);self.assertEqual(written['sha256'],hashlib.sha256((temp/'external.json').read_bytes()).hexdigest())
   after={str(p.relative_to(root)):m.source_local(p.lstat(),policy())for p in [root,*root.rglob('*')]};self.assertEqual(before,after);print('SDK_COLON_SNAPSHOT:'+json.dumps(snapshot,separators=(',',':')))
 @unittest.skipUnless(sys.platform=='linux','actual owned POSIX tree; not a Darwin installed SDK claim')
 def test_physical_second_inventory_mutation_and_held_hash_identity_still_deny(self):
  with tempfile.TemporaryDirectory(prefix='sdk-colon-drift-')as folder:
   root=pathlib.Path(folder);(root/NAME).parent.mkdir(parents=True);(root/NAME).write_bytes(b'first');original=m.inventory;calls=0
   def drift(*args,**kwargs):
    nonlocal calls
    calls+=1
    if calls==2:(root/NAME).write_bytes(b'second-longer')
    return original(*args,**kwargs)
   with patch.object(m,'_MAC_EXTERNAL_SDK_ROOT',str(root)),patch.object(m,'inventory',side_effect=drift),self.assertRaisesRegex(m.CheckpointError,'source-tree-changed'):m.source_snapshot(root,m.Budget(5),context=policy(),member_policy=m._MAC_EXTERNAL_SDK_MEMBERS)
   info=(root/NAME).stat();row={'path':NAME,'stamp':m.stamp(info),'ctimeNs':info.st_ctime_ns,'birthNs':None,'uid':info.st_uid,'gid':info.st_gid};(root/NAME).write_bytes(b'third')
   with self.assertRaisesRegex(m.CheckpointError,'source-file-identity'):m.source_hash(root,row,m.Budget(5),EXTERNAL)
unittest.main(argv=['sdk-colon-readonly'],verbosity=2)
`;

test("Mac external SDK literal-colon capability keeps actual strict paths and physical snapshot roundtrip guards", () => {
  const result = python(MAC_SDK_COLON_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 6 tests/);
});

test("actual Mac external reader binds SDK literal-colon rows and rejects other roles, drives and unsafe components", async () => {
  const { mac, plan } = await macExternalFixture();
  const fixture = () => ({
    schemaVersion: 1,
    kind: "sorng-macarm-external-input-observation",
    target: "aarch64-apple-darwin",
    policy: "sorng-macarm-readonly-external-inputs-v1",
    complete: true,
    externalSnapshotComplete: true,
    roles: Object.entries(plan.context.roots).map(([role, physicalRoot]) => ({
      role,
      physicalRoot,
      snapshot: {
        rootMtimeNs: "1",
        gitHeads: {},
        root: { mode: 0o40755, mtimeNs: "1", uid: 0, gid: 0, nlink: 2 },
        localRoot: {
          dev: "1",
          ino: "2",
          ctimeNs: "3",
          birthtimeNsAvailable: false,
          birthtimeNs: null,
        },
        bytes: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .reduce((sum, pin) => sum + pin.size, 0),
        entries: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .map((pin) => ({
            path: pin.path,
            kind: "file",
            mode: 0o100644,
            mtimeNs: "1",
            nlink: 1,
            uid: 0,
            gid: 0,
            size: pin.size,
            sha256: pin.sha256,
          })),
      },
    })),
    entries: 10,
    bytes: plan.context.requiredPins.reduce((sum, pin) => sum + pin.size, 0),
    runnerUid: 501,
    historicalMetalResourceClosureVerified: false,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  });
  const name = "usr/share/man/mann/ttk::progressbar.ntcl";
  const body = Buffer.from("owned SDK colon fixture\n");
  const fileRow = {
    path: name,
    kind: "file",
    mode: 0o100644,
    mtimeNs: "1",
    nlink: 1,
    uid: 0,
    gid: 0,
    size: body.length,
    sha256: hashObject("sha256").update(body).digest("hex"),
  };
  const add = (value, role, row) => {
    const snapshot = value.roles.find((entry) => entry.role === role).snapshot;
    snapshot.entries.push(row);
    value.entries++;
    if (row.kind === "file") {
      snapshot.bytes += row.size;
      value.bytes += row.size;
    }
  };
  const admit = async (value) => {
    const raw = Buffer.from(JSON.stringify(value));
    const identity = {
      dev: 1n,
      ino: 2n,
      mode: 0o100600n,
      nlink: 1n,
      size: BigInt(raw.length),
      mtimeNs: 1n,
      ctimeNs: 2n,
      birthtimeNs: 3n,
      isFile: () => true,
    };
    const summary = {
      complete: true,
      kind: value.kind,
      entries: value.entries,
      bytes: value.bytes,
      snapshot: {
        name: "external.json",
        bytes: raw.length,
        sha256: hashObject("sha256").update(raw).digest("hex"),
      },
      sourceWriteAdmitted: false,
      nativeAcceptance: false,
      runtimeReady: false,
    };
    let closed = 0;
    try {
      return await mac.readMacExternalObservation(plan, summary, () => {}, {
        lstat: async (file) =>
          file.endsWith("/external.json")
            ? identity
            : {
                ...identity,
                isDirectory: () => true,
                isSymbolicLink: () => false,
              },
        realpath: async (file) => file,
        open: async () => ({
          stat: async () => identity,
          readFile: async () => raw,
          close: async () => {
            closed++;
          },
        }),
      });
    } finally {
      assert.equal(closed, 1);
    }
  };
  const value = fixture();
  add(value, "sdk", fileRow);
  const proof = await admit(value);
  const binding = mac.macExternalToolsBinding({}, proof);
  assert.deepEqual(
    binding.macExternalInputs.roles
      .find((row) => row.role === "sdk")
      .entries.at(-1),
    fileRow,
  );
  assert.throws(
    () => mac.macExternalToolsBinding({}, { ...proof }),
    /MAC_EXTERNAL_ATTESTATION/,
  );
  for (const role of ["toolchain", "metal", "python"]) {
    const bad = fixture();
    add(bad, role, fileRow);
    await assert.rejects(admit(bad), /MAC_EXTERNAL_ENTRY/);
  }
  for (const invalid of [
    "/abs",
    "C:relative",
    "c:/absolute",
    "c:\\absolute",
    "\\\\host\\share",
    "a/../b",
    "a/./b",
    "a//b",
    "a/",
    "a/trailing.",
    "a/trailing ",
    "a/CON.h",
    "a/NUL",
    "a/com9.txt",
    "a/control\x00",
    "a/control\x7f",
    "Ł".repeat(513),
  ]) {
    const bad = fixture();
    add(bad, "sdk", { ...fileRow, path: invalid });
    await assert.rejects(admit(bad), /MAC_EXTERNAL_ENTRY/);
  }
  const ads = fixture();
  add(ads, "sdk", { ...fileRow, path: "public:header" });
  await admit(ads); // A literal SDK JSON name, never an archive/Windows ADS write.
});

test(
  "physical SDK colon snapshot roundtrips through actual reader and opaque binding unchanged",
  {
    skip:
      process.platform !== "linux"
        ? "Linux owned POSIX fixture, not installed Darwin SDK evidence"
        : false,
  },
  async () => {
    const result = python(MAC_SDK_COLON_PROOF, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const line = result.stdout
      .split(/\r?\n/)
      .find((value) => value.startsWith("SDK_COLON_SNAPSHOT:"));
    assert(line);
    const snapshot = JSON.parse(line.slice("SDK_COLON_SNAPSHOT:".length));
    const { mac, plan } = await macExternalFixture();
    const value = externalFullModeReport(plan, snapshot),
      proof = await admitExternalFullMode(mac, plan, value),
      binding = mac.macExternalToolsBinding({}, proof);
    const sdk = binding.macExternalInputs.roles.find(
        (row) => row.role === "sdk",
      ),
      name = "usr/share/man/mann/ttk::progressbar.ntcl";
    for (const row of snapshot.entries) {
      const portable = sdk.entries.find((item) => item.path === row.path);
      assert(portable);
      assert.equal(portable.mode, row.mode);
      assert.equal(portable.path, row.path);
      if (row.kind === "file") assert.equal(portable.sha256, row.sha256);
    }
    assert.equal(
      sdk.entries.find((row) => row.path === "alias:header").relativeLiteral,
      name,
    );
    assert.deepEqual(sdk.root, snapshot.root);
    assert.throws(
      () => mac.macExternalToolsBinding({}, { ...proof }),
      /MAC_EXTERNAL_ATTESTATION/,
    );
  },
);

const MAC_EXTERNAL_LINK_DIAGNOSTIC_PROOF = String.raw`import ast,contextlib,copy,hashlib,importlib.util,io,json,pathlib,sys,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('link_subject',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=pathlib.Path(sys.argv[1]).read_bytes();tree=ast.parse(source)
developer='/Applications/Xcode_26.3.app/Contents/Developer'
ROOTS={'sdk':m._MAC_EXTERNAL_SDK_ROOT,'toolchain':developer+'/Toolchains/XcodeDefault.xctoolchain','metal':'/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/'+'a'*40+'/Metal.xctoolchain','python':'/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework'}
def inventories():return {role:{'entries':[]}for role in ROOTS}
def link(values,role,name,target):
 values[role]['entries'].append({'path':name,'kind':'symlink','target':target,'sha256':hashlib.sha256(target.encode()).hexdigest()})
def entry(values,role,name,kind='file'):values[role]['entries'].append({'path':name,'kind':kind})
class ExternalLinkDiagnostic(unittest.TestCase):
 def printed(self,error):
  handler=tree.body[-1].body[0].handlers[0];scope=dict(m.__dict__);scope['error']=error;out=io.StringIO()
  with contextlib.redirect_stdout(out),self.assertRaises(SystemExit)as exit:exec(compile(ast.Module(body=handler.body,type_ignores=[]),'<actual-error-output>','exec'),scope)
  self.assertEqual(exit.exception.code,1);return json.loads(out.getvalue())
 def failure(self,values,reason='source-external-input-unattested',projection=None):
  original=m.require;errors=[];events=[]
  def checked(ok,label):
   try:return original(ok,label)
   except m.CheckpointError as error:
    if label==reason:errors.append(error);events.append('original')
    raise
  def noio(*args,**kwargs):raise AssertionError('resolver/diagnostic must not perform filesystem IO')
  with contextlib.ExitStack()as stack:
   for name,value in [('require',checked),('MAC_EXTERNAL_ROLE','python'),('MAC_EXTERNAL_PHASE','links')]:stack.enter_context(patch.object(m,name,value))
   for name in ['stat','lstat','readlink','scandir','open']:stack.enter_context(patch.object(m.os,name,noio))
   if projection is not None:
    def project(*args,**kwargs):events.append('diagnostic');return projection(*args,**kwargs)
    stack.enter_context(patch.object(m,'external_link_diagnostic',project))
   try:m.mac_external_links(ROOTS,values,m.Budget(5))
   except m.CheckpointError as error:
    self.assertEqual(str(error),reason);self.assertEqual(len(errors),1);self.assertIs(error,errors[0]);printed=self.printed(error);self.assertIs(printed['complete'],False);self.assertEqual(printed['error'],reason);return error,printed,events
   self.fail('expected original validator denial')
 def test_missing_declared_row_binds_actual_origin_not_stale_global(self):
  values=inventories();link(values,'sdk','origin','missing')
  error,out,_=self.failure(values);d=out['externalLinkFailure'];self.assertEqual(error.external_link_failure,d);self.assertEqual(out['externalRole'],'sdk');self.assertEqual(d['originRole'],'sdk');self.assertEqual(d['originPath']['prefix'],'origin');self.assertEqual(d['classification'],'declared-role-entry-missing');self.assertEqual(d['attemptedDeclaredRole'],'sdk');self.assertEqual(d['attemptedAddress']['scope'],'declared-role');self.assertEqual(d['attemptedAddress']['prefix'],'missing')
 def test_real_boundary_ancestor_and_underflow_denials_keep_original_error(self):
  for target,site,classification in [('/Users/private/secret','declared-root-boundary','outside-declared-roots'),('/Applications','declared-root-boundary','verified-root-ancestor-not-final'),('/..','absolute-root-underflow','absolute-root-underflow')]:
   with self.subTest(target=target):
    values=inventories();link(values,'sdk','origin',target);error,out,_=self.failure(values);self.assertEqual(out['externalLinkFailure']['site'],site);self.assertEqual(out['externalLinkFailure']['classification'],classification);self.assertNotIn('secret',json.dumps(out))
 def test_nested_crossrole_preserves_origin_and_last_expansion_separately(self):
  values=inventories();link(values,'sdk','origin',ROOTS['metal']+'/relay');link(values,'metal','relay','/Users/private/secret')
  error,out,_=self.failure(values);d=out['externalLinkFailure'];self.assertEqual(out['externalRole'],'sdk');self.assertEqual(d['lastExpandedRole'],'metal');self.assertEqual(d['target']['role'],'metal');self.assertEqual(d['target']['prefix'],'relay');self.assertTrue(d['lastExpandedTarget']['omitted']);self.assertNotIn('secret',json.dumps(out));self.assertNotIn('/Users/',json.dumps(out))
 def test_public_labels_are_disclosure_only_and_unknown_private_targets_hash_only(self):
  for label,root in m._EXTERNAL_LINK_PUBLIC_PREFIXES.items():
   # Real resolver still denies a missing/unattested public location.
   values=inventories();link(values,'sdk','origin',root+'missing')
   error,out,_=self.failure(values);projected=out['externalLinkFailure']['target'];self.assertEqual(projected['scope'],'public-prefix');self.assertEqual(projected['publicPrefix'],label);self.assertEqual(projected['prefix'],'missing')
  for target in ['/Users/private/secret','/private/tmp/secret','/var/private/secret','/etc/private/secret','/home/private/secret','/usr/local/Cellar/unknown/99/secret','/usr/local/Cellar/python@3.14/3.14.8/secret','/System/Library/../Users/private/secret']:
   with self.subTest(target=target):
    values=inventories();link(values,'sdk','origin',target);error,out,_=self.failure(values);p=out['externalLinkFailure']['target'];self.assertTrue(p['omitted']);self.assertIsNone(p['prefix']);self.assertEqual(p['sha256'],hashlib.sha256(target.encode()).hexdigest());self.assertNotIn('secret',json.dumps(out))
  for target in ['../private/secret',r'C:\private\secret',r'\\host\private\secret','~/private/secret','safe\x01secret']:
   p=m.external_link_text(target,ROOTS,'sdk');self.assertTrue(p['omitted']);self.assertIsNone(p['prefix']);self.assertNotIn('secret',json.dumps(p))
 def test_diagnostic_fault_occurs_after_primary_and_never_masks_or_attributes(self):
  def broken(*args):raise RuntimeError('private diagnostic failure')
  values=inventories();link(values,'sdk','origin','missing');error,out,events=self.failure(values,projection=broken);self.assertEqual(events,['original','diagnostic']);self.assertNotIn('externalLinkFailure',out);self.assertNotIn('externalRole',out);self.assertEqual(out['externalPhase'],'links');self.assertNotIn('private',json.dumps(out))
  for forged in [{}, {'originRole':'sdk','private':'secret'}, None]:
   error,out,events=self.failure(values,projection=lambda *args:forged);self.assertNotIn('externalRole',out);self.assertNotIn('externalLinkFailure',out);self.assertNotIn('secret',json.dumps(out));self.assertEqual(events,['original','diagnostic'])
 def test_forged_unknown_private_and_malformed_projection_fields_are_not_output(self):
  values=inventories();link(values,'sdk','origin','missing');error,out,_=self.failure(values);original=out['externalLinkFailure'];m.MAC_EXTERNAL_PHASE='links';m.MAC_EXTERNAL_ROLE='python'
  cases=[lambda d:d.update(private='secret'),lambda d:d['originPath'].update(prefix=''),lambda d:d.update(originRole='unknown'),lambda d:d.update(lastExpandedRole=None),lambda d:d.update(expansions=True),lambda d:d.update(expansions=65),lambda d:d['originPath'].update(prefix='/Users/private/secret'),lambda d:d['originPath'].update(prefix=r'C:\private\secret'),lambda d:d['target'].update(publicPrefix='private-home'),lambda d:d['target'].update(utf8Bytes=True),lambda d:d['target'].update(sha256='private'),lambda d:d['target'].update(prefix='😀'*128),lambda d:d['target'].update(unknown='private'),lambda d:d['target'].update(omitted=True),lambda d:d.update(attemptedDeclaredRole=None)]
  for change in cases:
   d=copy.deepcopy(original);change(d);error.external_link_failure=d;self.assertEqual(m.external_link_fields(error),{});printed=self.printed(error);self.assertNotIn('externalLinkFailure',printed);self.assertNotIn('externalRole',printed);self.assertNotIn('secret',json.dumps(printed))
  error.external_link_failure=original
  for phase in ['snapshot','pins','readback',None]:
   m.MAC_EXTERNAL_PHASE=phase;self.assertEqual(m.external_link_fields(error),{})
  m.MAC_EXTERNAL_PHASE='links';other=m.CheckpointError('archive-deadline');other.external_link_failure=original;self.assertEqual(m.external_link_fields(other),{})
 def test_escaping_and_attempted_address_budgets_stay_physical_json_bounds(self):
  name='😀'*200;values=inventories();link(values,'sdk',name,'/Users/private/'+'x'*3000);error,out,_=self.failure(values);d=out['externalLinkFailure'];self.assertLessEqual(len(json.dumps(d,ensure_ascii=True).encode()),4096);self.assertTrue(d['originPath']['truncated']);self.assertLessEqual(len(json.dumps(d['originPath']['prefix'],ensure_ascii=True).encode()),512);self.assertEqual(d['originPath']['sha256'],hashlib.sha256(name.encode()).hexdigest())
  for target in ['x'*4097,None,42]:
   p=m.external_link_text(target,ROOTS,'sdk');self.assertEqual(p['omittedReason'],'UNAVAILABLE');self.assertIsNone(p['sha256'])
  p=m.external_link_address(['x']*1025,ROOTS,'sdk');self.assertEqual(p['omittedReason'],'UNAVAILABLE');self.assertIsNone(p['prefix'])
 def test_success_and_existing_kind_cycle_deadline_guards_are_unchanged(self):
  values=inventories();entry(values,'sdk','file');entry(values,'sdk','directory','directory');link(values,'sdk','jump','directory');link(values,'sdk','origin','jump/../file');m.mac_external_links(ROOTS,values,m.Budget(5))
  values=inventories();entry(values,'sdk','file');link(values,'sdk','origin','file/child');error,out,_=self.failure(values,'source-external-link-kind');self.assertNotIn('externalLinkFailure',out);self.assertNotIn('externalRole',out)
  values=inventories();link(values,'sdk','origin','origin');error,out,_=self.failure(values,'source-external-link-cycle');self.assertNotIn('externalLinkFailure',out)
  class Expired:
   def check(self):raise marker
  marker=m.CheckpointError('archive-deadline')
  with self.assertRaises(m.CheckpointError)as caught:m.mac_external_links(ROOTS,values,Expired())
  self.assertIs(caught.exception,marker);self.assertFalse(hasattr(marker,'external_link_failure'));self.assertFalse(m.MAC_SOURCE_WRITE_ADMITTED)
unittest.main(argv=['external-link-diagnostic'],verbosity=2)
`;

test("Mac external link diagnostic executes actual table denials and error output without IO, stale role or private leakage", () => {
  const result = python(MAC_EXTERNAL_LINK_DIAGNOSTIC_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 8 tests/);
});

let externalFailureFrames;
function actualExternalFailureFrames() {
  if (externalFailureFrames) return externalFailureFrames;
  const frames = (proof, tail) => {
    const end = proof.lastIndexOf("\nunittest.main(");
    assert(end > 0);
    const result = python(proof.slice(0, end) + "\n" + tail, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const links = frames(
    MAC_EXTERNAL_LINK_DIAGNOSTIC_PROOF,
    String.raw`
case=ExternalLinkDiagnostic();rows=[]
for target in ['missing','/Users/private/secret','/System/Library/missing']:
 values=inventories();link(values,'sdk','origin',target);rows.append(case.failure(values)[1])
values=inventories();link(values,'sdk','origin','missing');rows.append(case.failure(values,projection=lambda *args:None)[1])
print(json.dumps(rows))
`,
  );
  const members = frames(
    MAC_MEMBER_DIAGNOSTIC_PROOF,
    String.raw`
case=MemberDiagnostic();rows=[]
for name in ['public/CON.h','public:header.h','public/control\x01.h']:
 rows.append(case.failure(name)[2])
print(json.dumps(rows))
`,
  );
  return (externalFailureFrames = { links, members });
}

test("actual Python external table and CLI failures cross the actual mode-scoped archive projector", () => {
  const { links, members } = actualExternalFailureFrames();
  for (const frame of [...links.slice(0, 3), ...members.slice(0, 2)]) {
    const output = archiveFailureRecord(JSON.stringify(frame), 1, {
      sourceMode: "mac-external-observe",
    });
    assert.equal(output.error, frame.error);
    assert.equal(output.exitCode, 1);
    for (const key of ["externalMemberFailure", "externalLinkFailure"])
      if (Object.hasOwn(frame, key)) assert.deepEqual(output[key], frame[key]);
    assert.equal(output.externalDiagnosticInvalid, undefined);
  }
  const noRole = links[3];
  assert.equal(noRole.externalRole, undefined);
  assert.deepEqual(
    archiveFailureRecord(JSON.stringify(noRole), 1, {
      sourceMode: "mac-external-observe",
    }),
    {
      error: "source-external-input-unattested",
      externalPhase: "links",
      exitCode: 1,
    },
  );
  const stale = { ...noRole, externalRole: "python" };
  const output = archiveFailureRecord(JSON.stringify(stale), 1, {
    sourceMode: "mac-external-observe",
  });
  assert.equal(output.error, stale.error);
  assert.equal(output.externalRole, undefined);
  // Node intentionally omits a stricter-disclosure control-name diagnostic.
  const control = archiveFailureRecord(JSON.stringify(members[2]), 1, {
    sourceMode: "mac-external-observe",
  });
  assert.equal(control.error, "member-path");
  assert.equal(control.externalMemberFailure, undefined);
  assert.equal(control.externalDiagnosticInvalid, true);
});

test("external archive diagnostics remain unavailable in every unrelated or absent mode and invalid base context", () => {
  const frame = actualExternalFailureFrames().links[0];
  for (const sourceMode of [
    undefined,
    null,
    "source-record",
    "source-verify",
    "source-apply",
    "mac-owned-capability-observe",
    "unknown",
  ])
    assert.deepEqual(
      archiveFailureRecord(JSON.stringify(frame), 1, { sourceMode }),
      { error: "unknown", exitCode: 1 },
    );
  for (const changes of [
    { complete: true },
    { error: "PRIVATE_UNKNOWN_ERROR" },
    { externalRole: "private-role" },
    { externalPhase: "private-phase" },
    { privateTop: "PRIVATE_UNKNOWN_TOP" },
  ])
    assert.deepEqual(
      archiveFailureRecord(JSON.stringify({ ...frame, ...changes }), 1, {
        sourceMode: "mac-external-observe",
      }),
      { error: "unknown", exitCode: 1 },
    );
  const noRole = actualExternalFailureFrames().links[3];
  assert.deepEqual(archiveFailureRecord(JSON.stringify(noRole), 1), {
    error: "unknown",
    exitCode: 1,
  });
});

test("malformed optional Mac projections never replace valid base error, exit, close or join facts or disclose private fields", () => {
  const { links, members } = actualExternalFailureFrames();
  const cases = [];
  const linkChange = (change) => {
    const frame = structuredClone(links[0]);
    change(frame.externalLinkFailure, frame);
    cases.push(frame);
  };
  linkChange((value) => {
    value.privateUnknown = "PRIVATE_UNKNOWN_FIELD";
  });
  linkChange((value) => {
    value.originRole = "python";
  });
  linkChange((value) => {
    value.expansions = 65;
  });
  linkChange((value) => {
    value.expansions = true;
  });
  linkChange((value) => {
    value.expansions = -1;
  });
  linkChange((value) => {
    value.expansions = 0.5;
  });
  linkChange((value) => {
    value.site = "PRIVATE_SITE";
  });
  linkChange((value) => {
    value.attemptedDeclaredRole = null;
  });
  linkChange((value) => {
    value.ancestorNavigation = 1;
  });
  linkChange((value) => {
    value.lastExpandedRole = "PRIVATE_ROLE";
  });
  linkChange((value) => {
    value.classification = "PRIVATE_CLASSIFICATION";
  });
  linkChange((value) => {
    value.originPath.prefix = "/Users/private/PRIVATE_PATH";
  });
  linkChange((value) => {
    value.target.publicPrefix = "PRIVATE_PREFIX";
  });
  linkChange((value) => {
    value.target.scope = "PRIVATE_SCOPE";
  });
  linkChange((value) => {
    value.target.role = "PRIVATE_ROLE";
  });
  linkChange((value) => {
    value.target.sha256 = "not-a-hash";
  });
  linkChange((value) => {
    value.target.utf8Bytes = false;
  });
  linkChange((value) => {
    value.target.omitted = true;
  });
  linkChange((value) => {
    value.target.omittedReason = "PRIVATE_REASON";
  });
  linkChange((value) => {
    value.originPath.prefix = "\ud800";
  });
  linkChange((value) => {
    value.originPath.prefix = "😀".repeat(100);
  });
  linkChange((value) => {
    value.originPath.prefix = "x".repeat(5000);
  });
  linkChange((value, frame) => {
    frame.externalRole = "python";
  });
  linkChange((value, frame) => {
    frame.externalPhase = "readback";
  });
  linkChange((value, frame) => {
    frame.error = "source-external-changed";
  });
  for (const changes of [
    { pathPrefix: "C:PRIVATE_DRIVE" },
    { pathPrefix: "~/PRIVATE_HOME" },
    { pathPrefix: "public/../PRIVATE_PARENT" },
    { utf8Bytes: true },
    { utf8Bytes: 0 },
    { characterCount: -1 },
    { characterCount: 1.5 },
    { characterCountAtLeast: 1025 },
    { pathTruncated: true },
    { pathOmitted: true },
    { pathPrefix: "\ud800" },
    { predicate: "PRIVATE_PREDICATE" },
    { subpredicate: "PRIVATE_SUBPREDICATE" },
    { privateUnknown: "PRIVATE_MEMBER_FIELD" },
    { pathPrefix: "x".repeat(5000) },
  ]) {
    const frame = structuredClone(members[0]);
    Object.assign(frame.externalMemberFailure, changes);
    cases.push(frame);
  }
  for (const frame of cases) {
    frame.sourceCloseFailure = true;
    frame.sourceJoinFailure = true;
    const output = archiveFailureRecord(JSON.stringify(frame), 7, {
      sourceMode: "mac-external-observe",
      cleanupUnknown: true,
    });
    assert.equal(output.error, frame.error);
    assert.equal(output.exitCode, 7);
    assert.equal(output.sourceCloseFailure, true);
    assert.equal(output.sourceJoinFailure, true);
    assert.equal(output.archiveCleanupUnknown, true);
    assert.equal(output.externalDiagnosticInvalid, true);
    assert.equal(output.externalLinkFailure, undefined);
    assert.equal(output.externalMemberFailure, undefined);
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE_|😀/);
  }
});

const SOURCE_BOUND_PROOF = String.raw`import ast,pathlib,types,sys,json,copy
from unittest.mock import patch
file=pathlib.Path(sys.argv[1]);m=types.ModuleType('source_bound');m.__file__=str(file)
exec(compile(file.read_bytes(),str(file),'exec'),m.__dict__)
tree=ast.parse(file.read_bytes());inv=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='inventory')
label=lambda n:isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Name)and n.value.func.id=='require'and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant)and n.value.args[1].value=='input-bound'
block=next(n for n in ast.walk(inv)if isinstance(n,ast.Try)and len(n.body)==1 and label(n.body[0]))
original=ast.parse("require(len(rows) <= (SOURCE_MAX_ENTRIES if source_policy is not None else MAX_ENTRIES) and raw <= MAX_RAW, 'input-bound')").body[0]
assert ast.dump(block.body[0],include_attributes=False)==ast.dump(original,include_attributes=False)
def compile_body(body,name):
 fn=ast.FunctionDef(name=name,args=ast.arguments(posonlyargs=[],args=[ast.arg(arg=n)for n in ('rows','raw','source_policy')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=[copy.deepcopy(body)],decorator_list=[])
 exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'actual-inventory-bound','exec'),m.__dict__)
 return m.__dict__[name]
old=compile_body(original,'old_guard');new=compile_body(block,'new_guard')
class Rows:
 def __init__(self,n):self.n=n
 def __len__(self):return self.n
maximum=m.SOURCE_MAX_ENTRIES;rawmax=m.MAX_RAW
for count,raw,denied in ((maximum,rawmax,False),(maximum+1,0,True),(1,rawmax+1,True),(maximum+1,rawmax+1,True)):
 for fn in (old,new):
  first=m.CheckpointError('input-bound');cause=RuntimeError('PRIVATE_CAUSE');first.__cause__=cause
  require=m.require
  def guard(condition,message):
   if not condition:raise first
  with patch.object(m,'require',side_effect=guard):
   with m.source_io_scope('source-record'):
    m.SOURCE_IO_CONTEXT.set(('source-record',pathlib.Path('/owned')))
    try:fn(Rows(count),raw,{})
    except m.CheckpointError as error:
     assert denied and error is first and error.__cause__ is cause
     fields=m.source_bound_failure_fields(error,'source-record')
     if fn is old:assert fields=={}
     else:assert fields['sourceBoundFailure']==dict(mode='source-record',stage='inventory-append',entries=count,rawBytes=raw,maximumEntries=maximum,maximumRawBytes=rawmax)
    else:assert not denied
with m.source_io_scope('source-record'):
 m.SOURCE_IO_CONTEXT.set(('source-record',pathlib.Path('/owned')))
 with patch.object(m,'source_bound_record',side_effect=AssertionError('normal capture')),patch.object(m.json,'dumps',side_effect=AssertionError('normal JSON')):new(Rows(maximum),rawmax,{})
for context,policy in ((None,{}),(('pack',pathlib.Path('/owned')),{}),(('source-record',None),{}),(('source-record',pathlib.Path('/owned')),None),(('source-record',pathlib.Path('/owned')),{'external':True})):
 token=m.SOURCE_IO_CONTEXT.set(context)
 try:
  try:new(Rows(maximum+1),0,policy)
  except m.CheckpointError as error:assert m.source_bound_failure_fields(error,'source-record')=={}
  else:raise AssertionError('old guard weakened')
 finally:m.SOURCE_IO_CONTEXT.reset(token)
with m.source_io_scope('source-record'):
 m.SOURCE_IO_CONTEXT.set(('source-record',pathlib.Path('/owned')))
 first=m.CheckpointError('input-bound')
 with patch.object(m.json,'dumps',side_effect=RuntimeError('PRIVATE_REPORT_FAILURE')):m.source_bound_record(first,maximum+1,0,{})
 assert m.source_bound_failure_fields(first,'source-record')=={'sourceBoundFailureInvalid':True}
 first=m.CheckpointError('input-bound');m.source_bound_record(first,maximum+1,0,{})
 original=copy.deepcopy(first.sourceBoundFailure)
 m.source_bound_record(first,1,rawmax+1,{})
 assert first.sourceBoundFailure==original
 m.SOURCE_CLOSE_FAILURE=False
 def close_fault():raise OSError('PRIVATE_CLOSE')
 m.source_close(close_fault,first)
 assert m.SOURCE_CLOSE_FAILURE and m.source_bound_failure_fields(first,'source-record')['sourceBoundFailure']==original
 assert m.source_bound_failure_fields(first,'pack')=={}
 assert m.source_bound_failure_fields(first,'source-apply')=={'sourceBoundFailureInvalid':True}
 for mutation in ({'entries':True},{'rawBytes':1.5},{'maximumEntries':maximum+1},{'rawBytes':-1},{'extra':'PRIVATE'},{'stage':'PRIVATE'},{'entries':1,'rawBytes':0}):
  first.sourceBoundFailure={**original,**mutation}
  assert m.source_bound_failure_fields(first,'source-record')=={'sourceBoundFailureInvalid':True}
assert m.SOURCE_IO_CONTEXT.get()is None
print('actual original guard AST/outcomes unchanged; virtual entries/raw boundary diagnostics, success zero capture/JSON, modes/firstcause/close/invalid PASS')
`;

test("source bound actual predicate keeps old outcomes and exception-bound counters without allocation or success work", () => {
  const result = python(SOURCE_BOUND_PROOF, [
    path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

const SOURCE_BOUND_PHYSICAL = String.raw`
for mode in ('source-record','source-verify','source-apply'):
 with fixture() as(root,sidecar,identity):
  before=sidecar.read_bytes();cap=len(json.loads(before)['snapshot']['entries'])
  (root/'src/new-owned-input.cc').write_bytes(b'added synthetic input')
  # Explicitly synthetic SMALL test cap. Production remains1M/256GiB.
  with patch.object(m,'SOURCE_MAX_ENTRIES',cap):
   try:m.source_metadata(mode,root,sidecar,identity,60)
   except m.CheckpointError as error:
    assert str(error)=='input-bound'
    facts=m.source_bound_failure_fields(error,mode)['sourceBoundFailure']
    assert facts['entries']==cap+1 and facts['maximumEntries']==cap and facts['maximumRawBytes']==m.MAX_RAW
    assert facts['rawBytes']>=0 and facts['mode']==mode and facts['stage']=='inventory-append'
   else:raise AssertionError('tiny real inventory admitted')
  assert sidecar.read_bytes()==before and m.SOURCE_IO_CONTEXT.get()is None
print('actual POSIX source record/verify/apply tiny inventory reaches original bound with numeric evidence and byte-unchanged prior sidecar PASS; synthetic cap only')
`;

test(
  "source bound actual tiny POSIX inventory records the failing counters before writes",
  {
    skip:
      process.platform !== "linux"
        ? "Actual owned POSIX source fixture"
        : false,
  },
  () => {
    const setup = SOURCE_METADATA_PROOF.slice(
      0,
      SOURCE_METADATA_PROOF.indexOf("class SourceMetadataProof"),
    );
    const result = python(setup + SOURCE_BOUND_PHYSICAL, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);

const sourceBoundFacts = (mode = "source-record") => ({
  mode,
  stage: "inventory-append",
  entries: 1_000_001,
  rawBytes: 0,
  maximumEntries: 1_000_000,
  maximumRawBytes: 256 * 1024 ** 3,
});

test("source bound projection closes actual caller primary exact maxima and malformed optional facts", () => {
  const facts = sourceBoundFacts(),
    base = {
      complete: false,
      error: "input-bound",
      sourceCloseFailure: true,
      sourceJoinFailure: true,
    };
  const primary = {
    error: "input-bound",
    sourceCloseFailure: true,
    sourceJoinFailure: true,
    exitCode: 1,
  };
  const record = (
    detail,
    sourceMode = "source-record",
    error = "input-bound",
  ) =>
    archiveFailureRecord(
      JSON.stringify({ ...base, error, sourceBoundFailure: detail }),
      1,
      { sourceMode },
    );
  assert.deepEqual(record(facts), { ...primary, sourceBoundFailure: facts });
  assert.deepEqual(
    record({ ...facts, entries: 1, rawBytes: 256 * 1024 ** 3 + 1 }),
    {
      ...primary,
      sourceBoundFailure: {
        ...facts,
        entries: 1,
        rawBytes: 256 * 1024 ** 3 + 1,
      },
    },
  );
  for (const detail of [
    null,
    [],
    {},
    { ...facts, mode: "source-verify" },
    { ...facts, extra: "PRIVATE" },
    { ...facts, entries: true },
    { ...facts, entries: 1.5 },
    { ...facts, entries: 1_000_002 },
    { ...facts, entries: 1, rawBytes: 0 },
    { ...facts, rawBytes: -1 },
    { ...facts, rawBytes: 264 * 1024 ** 3 + 1 },
    { ...facts, maximumEntries: "1000000" },
    { ...facts, maximumRawBytes: 128 * 1024 ** 3 },
    { ...facts, stage: "PRIVATE" },
    { ...facts, private: "x".repeat(1024) },
  ])
    assert.deepEqual(record(detail), {
      ...primary,
      sourceBoundFailureInvalid: true,
    });
  for (const sourceMode of [
    null,
    "pack",
    "restore",
    "seal",
    "mac-external-observe",
    "mac-owned-capability-observe",
    "unknown",
  ])
    assert.deepEqual(record(facts, sourceMode), {
      error: "unknown",
      exitCode: 1,
    });
  for (const error of ["member-path", "archive-io-error", "source-changed"])
    assert.deepEqual(record(facts, "source-record", error), {
      error: "unknown",
      exitCode: 1,
    });
  assert.deepEqual(
    archiveFailureRecord(
      JSON.stringify({
        ...base,
        sourceBoundFailure: facts,
        sourceBoundFailureInvalid: false,
      }),
      1,
      { sourceMode: "source-record", cleanupUnknown: true },
    ),
    {
      ...primary,
      archiveCleanupUnknown: true,
      sourceBoundFailureInvalid: true,
    },
  );
  assert.deepEqual(
    archiveFailureRecord(
      JSON.stringify({ ...base, untrusted: true, sourceBoundFailure: facts }),
      1,
      { sourceMode: "source-record" },
    ),
    { error: "unknown", exitCode: 1 },
  );
  const parse = JSON.parse;
  try {
    JSON.parse = () => ({
      ...base,
      sourceBoundFailure: new Proxy(
        {},
        {
          ownKeys() {
            throw Error("PRIVATE_VALIDATOR");
          },
        },
      ),
    });
    assert.deepEqual(
      archiveFailureRecord("{}", 1, { sourceMode: "source-record" }),
      { ...primary, sourceBoundFailureInvalid: true },
    );
  } finally {
    JSON.parse = parse;
  }
});

test(
  "source bound actual archiveCommand keeps primary cleanup and refuses unrelated caller masquerades",
  { timeout: 15000 },
  async (t) => {
    const folder = await scratch(t),
      executable = python("import sys;print(sys.executable)").stdout.trim(),
      script = path.join(folder, "bound-fixture.py");
    const payload = {
      complete: false,
      error: "input-bound",
      sourceCloseFailure: true,
      sourceJoinFailure: true,
      sourceBoundFailure: sourceBoundFacts(),
    };
    // Fixed fixture data is decoded by Python, never treated as source instructions.
    await writeFile(
      script,
      "import json,sys\nprint(json.dumps(json.loads(" +
        JSON.stringify(JSON.stringify(payload)) +
        ")))\nsys.exit(1)\n",
      { flag: "wx" },
    );
    for (const mode of [
      "source-record",
      "source-verify",
      "source-apply",
      "pack",
      "restore",
      "mac-external-observe",
      "mac-owned-capability-observe",
    ]) {
      const rows = [];
      await assert.rejects(
        archiveCommand(executable, script, [mode], {
          timeout: 2000,
          observeFailure: (row) => rows.push(row),
        }),
        /Checkpoint archive rejected/,
      );
      assert.equal(rows.length, 1);
      if (mode === "source-record")
        assert.deepEqual(rows[0], {
          error: "input-bound",
          sourceCloseFailure: true,
          sourceJoinFailure: true,
          sourceBoundFailure: payload.sourceBoundFailure,
          exitCode: 1,
        });
      else if (mode.startsWith("source-"))
        assert.deepEqual(rows[0], {
          error: "input-bound",
          sourceCloseFailure: true,
          sourceJoinFailure: true,
          sourceBoundFailureInvalid: true,
          exitCode: 1,
        });
      else assert.deepEqual(rows[0], { error: "unknown", exitCode: 1 });
    }
  },
);
