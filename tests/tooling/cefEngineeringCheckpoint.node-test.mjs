import assert from "node:assert/strict";
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
import { PassThrough, Readable, Writable } from "node:stream";
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
    createWriteStream: () => {
      const stream = new Writable({
        write(data, encoding, done) {
          done();
        },
      });
      state.streams.push(stream);
      return stream;
    },
    spawn: () => {
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
  for key,value in [('SOURCE_MAX_ENTRIES',1),('SOURCE_MAX_FILE',1),('MAX_RAW',1),('MAX_METADATA',128)]:
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

async function macExternalFixture() {
  const mac = await import("../../scripts/lib/cef-mac-source-metadata.mjs");
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
      developer + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.2.sdk",
      developer + "/Platforms/MacOSX.platform",
      developer + "/Toolchains/XcodeDefault.xctoolchain",
    ],
    runnerTemp: "/Users/runner/work/_temp",
    output:
      "/Users/runner/work/_temp/cef-mac-inputs-11111111-1111-4111-8111-111111111111",
    remainingMilliseconds: () => 500999.9,
  };
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
        root: { mode: 0o755, mtimeNs: "1", uid: 0, gid: 0, nlink: 2 },
        localRoot: { dev: "1", ino: "2", ctimeNs: "3", birthtimeNs: "4" },
        bytes: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .reduce((sum, pin) => sum + pin.size, 0),
        entries: plan.context.requiredPins
          .filter((pin) => pin.role === role)
          .map((pin) => ({
            path: pin.path,
            kind: "file",
            mode: 0o644,
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
  "Linux source transaction and sidecar bytes match the reviewed 9e6 implementation exactly",
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
 before=old.source_metadata('source-record',root,sidecar,identity,60);raw=sidecar.read_bytes();sidecar.unlink()
 after=m.source_metadata('source-record',root,sidecar,identity,60)
 assert before==after and raw==sidecar.read_bytes(), 'exact-record-sidecar'
 assert old.source_metadata('source-verify',root,sidecar,identity,60)==m.source_metadata('source-verify',root,sidecar,identity,60),'exact-verify'
 file=root/'src/input.cc';s=file.stat();shift=s.st_mtime_ns+1000000000
 os.utime(file,ns=(s.st_atime_ns,shift));first=old.source_metadata('source-apply',root,sidecar,identity,60);old_time=file.stat().st_mtime_ns
 os.utime(file,ns=(s.st_atime_ns,shift));second=m.source_metadata('source-apply',root,sidecar,identity,60)
 assert first==second and file.stat().st_mtime_ns==old_time and raw==sidecar.read_bytes(),'exact-apply-sidecar'
 assert set(json.loads(raw))=={'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'}
 assert all('birthNs' not in row and 'uid' not in row and 'nlink' not in row for row in json.loads(raw)['snapshot']['entries'])
 some=root/'src/some';some.mkdir();(root/'src/foo').mkdir();(some/'out').mkdir()
 (some/'out/file').write_bytes(b'owned lexical decoy');(root/'src/out/file').write_bytes(b'owned excluded fixture')
 os.symlink('../foo',some/'alias');os.symlink('alias/../out/file',some/'jump')
 assert (some/'jump').resolve(strict=True)==root/'src/out/file'
 assert old.source_link_target(root,some/'jump','alias/../out/file',old.Budget(5))==some/'out/file','actual-old-unsafe-accept'
 try:m.source_link_target(root,some/'jump','alias/../out/file',m.Budget(5))
 except m.CheckpointError as error:assert str(error)=='source-excluded-link','new-strict-denial'
 else:raise AssertionError('new resolver accepted actual excluded traversal')
print('reviewed-Linux exact record/apply/verify sidecar/schema PASS')
`;
    const result = python(code, [
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      baseline,
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /exact record\/apply\/verify sidecar\/schema PASS/,
    );
  },
);
