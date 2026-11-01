import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as mac from "../../scripts/lib/cef-mac-source-metadata.mjs";
import {
  archiveFailureRecord,
  archiveCommand,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  authority,
  budget,
} from "../fixtures/cef/mac_python_package_proof.mjs";

const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const output =
  "/Users/runner/work/_temp/cef-mac-inputs-01234567-89ab-cdef-0123-456789abcdef";
const plan = () =>
  mac.macPythonPackageProofPlan({
    runnerTemp: "/Users/runner/work/_temp",
    output,
  });
test("actual new-mode leaf invocation disables site startup and excludes inherited secrets", async () => {
  const identified = spawnSync(
    "python",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(identified.status, 0, identified.stderr);
  const directory = await mkdtemp(path.join(tmpdir(), "sorng-package-leaf-"));
  const helper = path.join(directory, "leaf.py");
  const prior = process.env.PACKAGE_TEST_SECRET;
  process.env.PACKAGE_TEST_SECRET = "MUST_NOT_REACH_LEAF";
  try {
    await writeFile(
      helper,
      "import sys,os,json\nprint(json.dumps({'noSite':sys.flags.no_site,'isolated':sys.flags.isolated,'keys':sorted(os.environ),'secret':os.environ.get('PACKAGE_TEST_SECRET')}))\n",
      { flag: "wx" },
    );
    const result = await archiveCommand(
      identified.stdout.trim(),
      helper,
      ["mac-python-package-observe"],
      { timeout: 5000 },
    );
    assert.equal(result.noSite, 1);
    assert.equal(result.isolated, 1);
    assert.equal(result.secret, null);
    // MinGW's Windows runtime materializes these OS defaults even with an
    // explicit env block. They are not inherited into the Darwin proof.
    const runtimeDefaults =
      process.platform === "win32"
        ? [
            "HOMEDRIVE",
            "HOMEPATH",
            "LOGONSERVER",
            "SYSTEMDRIVE",
            "SYSTEMROOT",
            "TEMP",
            "USERDOMAIN",
            "USERNAME",
            "USERPROFILE",
            "WINDIR",
          ]
        : [];
    assert(
      result.keys.every((key) =>
        [
          "PATH",
          "ImageOS",
          "ImageVersion",
          "GITHUB_ACTIONS",
          "RUNNER_ENVIRONMENT",
          "GITHUB_REPOSITORY_VISIBILITY",
          "RUNNER_TRACKING_ID",
          "LC_CTYPE",
          ...runtimeDefaults,
        ].includes(key),
      ),
    );
  } finally {
    if (prior === undefined) delete process.env.PACKAGE_TEST_SECRET;
    else process.env.PACKAGE_TEST_SECRET = prior;
    await unlink(helper);
    await rmdir(directory);
  }
});
function reportFixture(
  mutate = () => {},
  { hashChanged = false, identityChanged = false, closeFailure = false } = {},
) {
  const selected = plan();
  const rows = new Map();
  const add = (name, kind, extra = {}) => {
    const parts = name.split("/");
    for (let n = 1; n < parts.length; n++) {
      const parent = parts.slice(0, n).join("/");
      if (!rows.has(parent))
        rows.set(parent, {
          path: parent,
          kind: "directory",
          mode: 0o40755,
          mtimeNs: "1",
          nlink: 1,
          uid: 501,
          gid: 20,
        });
    }
    rows.set(name, {
      path: name,
      kind,
      mode:
        kind === "symlink" ? 0o120777 : kind === "file" ? 0o100755 : 0o40755,
      mtimeNs: "1",
      nlink: 1,
      uid: 501,
      gid: 20,
      ...extra,
    });
  };
  const pin = selected.context.requiredPins[0];
  add(pin.path, "file", { size: pin.size, sha256: pin.sha256 });
  add("lib/python3.14/site-packages", "directory");
  const target = "../../../../../../lib/python3.14/site-packages";
  add(
    "Frameworks/Python.framework/Versions/3.14/lib/python3.14/site-packages",
    "symlink",
    { target, sha256: hash(target) },
  );
  const value = {
    schemaVersion: 1,
    kind: "sorng-mac-python-package-proof-observation",
    target: "python3.14.7-cellar",
    policy: "sorng-mac-python-package-proof-v1",
    complete: true,
    externalSnapshotComplete: true,
    roles: [
      {
        role: "python",
        physicalRoot: mac.MAC_PYTHON_PACKAGE_PROOF_ROOT,
        snapshot: {
          rootMtimeNs: "1",
          gitHeads: {},
          root: { mode: 0o40755, mtimeNs: "1", uid: 501, gid: 20, nlink: 2 },
          localRoot: {
            dev: "1",
            ino: "2",
            ctimeNs: "3",
            birthtimeNsAvailable: false,
            birthtimeNs: null,
          },
          bytes: pin.size,
          entries: [...rows.values()].sort((a, b) =>
            a.path < b.path ? -1 : 1,
          ),
        },
      },
    ],
    entries: rows.size,
    bytes: pin.size,
    runnerUid: 501,
    historicalMetalResourceClosureVerified: false,
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  mutate(value);
  const raw = Buffer.from(JSON.stringify(value));
  const result = {
    complete: true,
    kind: value.kind,
    entries: value.entries,
    bytes: value.bytes,
    snapshot: { name: "external.json", bytes: raw.length, sha256: hash(raw) },
    sourceWriteAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
  const file = {
    dev: 1n,
    ino: 2n,
    mode: 0o100600n,
    nlink: 1n,
    size: BigInt(raw.length),
    mtimeNs: 1n,
    ctimeNs: 2n,
    uid: 501n,
    gid: 20n,
    isFile: () => true,
  };
  const directory = {
    ...file,
    mode: 0o40700n,
    size: 32n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  let reads = 0,
    closed = 0;
  const io = {
    async realpath(file) {
      return file;
    },
    async lstat(name) {
      if (name !== output + "/external.json") return directory;
      reads++;
      return identityChanged && reads > 1 ? { ...file, ino: 3n } : file;
    },
    async open() {
      return {
        async stat() {
          return file;
        },
        async readFile() {
          return hashChanged
            ? Buffer.from(
                raw.toString().replace('"complete":true', '"complete":null'),
              )
            : raw;
        },
        async close() {
          closed++;
          if (closeFailure) throw Error("close fault");
        },
      };
    },
  };
  return { selected, result, io, closed: () => closed };
}
test("candidate plan is exactly one versioned package with the held executable prefix and one 100s lease", () => {
  const selected = plan();
  assert.deepEqual(selected.context.roots, {
    python: "/usr/local/Cellar/python@3.14/3.14.7",
  });
  assert.equal(
    selected.context.requiredPins[0].path,
    "Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  );
  assert.deepEqual(selected.argv(output + "/context.json", 100).slice(0, 5), [
    "-I",
    "-B",
    "-S",
    "scripts/lib/cef-checkpoint-archive.py",
    "mac-python-package-observe",
  ]);
  for (const seconds of [0, 101, Infinity, 1.5])
    assert.throws(() => selected.argv(output + "/context.json", seconds));
  for (const extra of [
    { roots: { python: "/usr/local" } },
    { target: "aarch64-apple-darwin" },
  ])
    assert.throws(() =>
      mac.macPythonPackageProofPlan({
        runnerTemp: "/Users/runner/work/_temp",
        output,
        ...extra,
      }),
    );
  assert.throws(
    () => (selected.context.roots.python = "/usr/local"),
    TypeError,
  );
});
test("full held candidate reader resolves the actual Framework-to-Cellar site-packages link but grants no producer authority", async () => {
  const fixture = reportFixture();
  const token = await mac.readMacPythonPackageProof(
    fixture.selected,
    fixture.result,
    () => {},
    fixture.io,
  );
  assert.equal(fixture.closed(), 1);
  assert.equal(
    mac.macPythonPackageProofEvidence(token).sourceWriteAdmitted,
    false,
  );
  for (const bind of [
    mac.macExternalToolsBinding,
    mac.macIntelExternalToolsBinding,
  ])
    assert.throws(() => bind({}, token), /MAC_EXTERNAL_ATTESTATION/);
  await assert.rejects(
    mac.readMacExternalObservation(
      fixture.selected,
      fixture.result,
      () => {},
      fixture.io,
    ),
    /MAC_EXTERNAL_PLAN/,
  );
  await assert.rejects(
    mac.readMacPythonPackageProof(
      { context: fixture.selected.context },
      fixture.result,
      () => {},
      fixture.io,
    ),
    /MAC_EXTERNAL_PLAN/,
  );
});
test("candidate closure denies missing destination, outside package, wrong version, cycles and cross-root inventories", async () => {
  for (const mutate of [
    (v) => {
      v.roles[0].snapshot.entries = v.roles[0].snapshot.entries.filter(
        (r) => r.path !== "lib/python3.14/site-packages",
      );
      v.entries--;
    },
    (v) => {
      const r = v.roles[0].snapshot.entries.find((r) => r.kind === "symlink");
      r.target = "/usr/local/lib/python3.14/site-packages";
      r.sha256 = hash(r.target);
    },
    (v) => (v.roles[0].physicalRoot = "/usr/local/Cellar/python@3.14/3.14.6"),
    (v) => {
      const r = v.roles[0].snapshot.entries.find((r) => r.kind === "symlink");
      r.target = "site-packages";
      r.sha256 = hash(r.target);
    },
    (v) => v.roles.push({ ...v.roles[0], role: "sdk" }),
  ]) {
    const f = reportFixture(mutate);
    await assert.rejects(
      mac.readMacPythonPackageProof(f.selected, f.result, () => {}, f.io),
    );
    assert.equal(f.closed(), 1);
  }
});
test("candidate held report rejects content/identity drift and failed close and preserves original deadline failure", async () => {
  for (const faults of [
    { hashChanged: true },
    { identityChanged: true },
    { closeFailure: true },
  ]) {
    const f = reportFixture(undefined, faults);
    await assert.rejects(
      mac.readMacPythonPackageProof(f.selected, f.result, () => {}, f.io),
    );
    assert.equal(f.closed(), 1);
  }
  const f = reportFixture(undefined, { closeFailure: true }),
    marker = Error("original clock");
  let checks = 0;
  await assert.rejects(
    mac.readMacPythonPackageProof(
      f.selected,
      f.result,
      () => {
        if (++checks > 10) throw marker;
      },
      f.io,
    ),
    (e) => e === marker,
  );
});
test("whole-job budget reserves reporting and cannot create a fresh lease after tiny proof", () => {
  assert.deepEqual(budget(1000, 1000), { total: 120000, seconds: 100 });
  assert.deepEqual(budget(1000, 251000), { total: 20000, seconds: 10 });
  assert.throws(() => budget(1000, 271000));
  assert.throws(() => budget(1000, 999));
});
test("package authority binds the exact public default-branch workflow and tested Intel image", () => {
  const env = {
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-owned-source-proof.yml@refs/heads/main",
  };
  authority(env, "darwin", "x64");
  for (const [key, value] of Object.entries({
    ImageVersion: "latest",
    GITHUB_REF: "refs/heads/feature",
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_REPOSITORY_VISIBILITY: "private",
  }))
    assert.throws(() => authority({ ...env, [key]: value }, "darwin", "x64"));
  assert.throws(() => authority(env, "darwin", "arm64"));
});
test("package mode receives closed archive diagnostics while unrelated source modes remain opaque", () => {
  const record = { complete: false, error: "source-mac-package-host" };
  assert.deepEqual(
    archiveFailureRecord(JSON.stringify(record), 1, {
      sourceMode: "mac-python-package-observe",
    }),
    { error: "source-mac-package-host", exitCode: 1 },
  );
  const frame = {
    complete: false,
    error: "source-external-input-unattested",
    externalRole: "python",
    externalPhase: "links",
  };
  assert.deepEqual(
    archiveFailureRecord(JSON.stringify(frame), 1, {
      sourceMode: "mac-python-package-observe",
    }),
    { error: frame.error, externalPhase: "links", exitCode: 1 },
  );
  const optional = { ...frame, externalLinkFailure: { private: "UNREVIEWED" } };
  const scoped = archiveFailureRecord(JSON.stringify(optional), 1, {
    sourceMode: "mac-python-package-observe",
  });
  assert.equal(scoped.error, frame.error);
  assert.equal(scoped.externalDiagnosticInvalid, true);
  assert(!JSON.stringify(scoped).includes("UNREVIEWED"));
  assert.deepEqual(
    archiveFailureRecord(JSON.stringify(optional), 1, {
      sourceMode: "source-apply",
    }),
    { error: "unknown", exitCode: 1 },
  );
  const diagnostic = spawnSync(
    "python",
    [
      "-I",
      "-B",
      "-S",
      "-c",
      String.raw`
import importlib.util,json,hashlib
spec=importlib.util.spec_from_file_location('archive','scripts/lib/cef-checkpoint-archive.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
roots={'python':'/usr/local/Cellar/python@3.14/3.14.7'};row={'path':'broken','kind':'symlink','target':'missing','sha256':hashlib.sha256(b'missing').hexdigest()};m.MAC_EXTERNAL_PHASE='links'
try:m.mac_external_links(roots,{'python':{'entries':[row]}},m.Budget(5))
except m.CheckpointError as error:print(json.dumps({'complete':False,'error':str(error),'externalPhase':'links',**m.external_link_fields(error)}))
`,
    ],
    { encoding: "utf8", timeout: 5000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(diagnostic.status, 0, diagnostic.stderr);
  const projected = archiveFailureRecord(diagnostic.stdout, 1, {
    sourceMode: "mac-python-package-observe",
  });
  assert.equal(projected.externalLinkFailure.originRole, "python");
  assert.equal(
    projected.externalLinkFailure.classification,
    "declared-role-entry-missing",
  );
  assert.deepEqual(
    archiveFailureRecord(diagnostic.stdout, 1, { sourceMode: "source-apply" }),
    { error: "unknown", exitCode: 1 },
  );
});
test("workflow shares its original five-minute job clock and independently retains the proof with no setup expansion", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/cef-mac-owned-source-proof.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert(
    workflow.indexOf("CEF_MAC_PACKAGE_JOB_STARTED_MS=") <
      workflow.indexOf("actions/checkout@"),
  );
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(
    workflow,
    /id: package\s+if: always\(\) && steps.checkout.outcome == 'success' && steps.node.outcome == 'success'\s+timeout-minutes: 2/,
  );
  assert.match(workflow, /if: always\(\) && steps.package.outputs.root != ''/);
  assert.match(workflow, /steps.package.outputs.root }}\/external.json/);
  assert.equal((workflow.match(/actions\/setup-node@/g) || []).length, 1);
  const source = await readFile(
    new URL(
      "../../scripts/lib/cef-engineering-checkpoint.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const argv = source.slice(
    source.indexOf("export async function archiveCommand("),
    source.indexOf("export async function archiveCommand(") + 9000,
  );
  assert.match(
    argv,
    /args\[0\] === "mac-python-package-observe" \? \["-S"\] : \[\]/,
  );
  assert(!argv.includes("...process.env"));
});
test("Python candidate validator denies broad roots before installed traversal; public producer root is exactly qualified Cellar", () => {
  const py = String.raw`
import importlib.util,pathlib,unittest,json,sys,os,tempfile,copy
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('archive','scripts/lib/cef-checkpoint-archive.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
context=json.loads(sys.stdin.read());root=pathlib.PurePosixPath(context['outputRoot']);environment={'ImageOS':'macos15','ImageVersion':'20260824.0482.1','GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY_VISIBILITY':'public'}
class Folder:
 def stat(self):return type('Info',(),{'st_uid':501,'st_mode':0o40700})()
 def __truediv__(self,leaf):return root/leaf
class Test(unittest.TestCase):
 def read(self,value):
  with patch.object(sys,'platform','darwin'),patch.object(m.platform,'machine',return_value='x86_64'),patch.dict(os.environ,environment,clear=True),patch.object(m,'source_read_bytes',return_value=json.dumps(value).encode()),patch.object(m,'safe',return_value=Folder()),patch.object(os,'geteuid',return_value=501,create=True),patch.object(os.path,'lexists',return_value=False):return m.mac_python_package_context(root/'context.json',root/'external.json',m.Budget(5))
 def test_candidate(self):self.assertEqual(self.read(context),context)
 def test_boundaries(self):
  for wrong in ['/usr/local','/usr/local/opt/python@3.14','/usr/local/Cellar/python@3.14','/usr/local/Cellar/python@3.14/3.14.6',context['roots']['python']+'/Frameworks/Python.framework']:
   value=json.loads(json.dumps(context));value['roots']['python']=wrong
   with self.assertRaisesRegex(m.CheckpointError,'source-mac-package-context'):self.read(value)
 def test_producer_unchanged(self):
  import inspect
  source=inspect.getsource(m.mac_external_context)
  self.assertIn("roots['python'] == _MAC_PYTHON_PACKAGE_QUALIFICATION[0]",source)
  self.assertIn('Frameworks/Python.framework/Versions/3.14/bin/python3.14',source)
  self.assertTrue(m.MAC_INTEL_SOURCE_WRITE_ADMITTED)
  with patch.object(m,'safe',side_effect=AssertionError('no public source IO')):
   with self.assertRaisesRegex(m.CheckpointError,'source-mac-(host|identity)-scope'):m.source_metadata_owned('source-record',None,None,{},platform_policy='mac-intel')
 def test_complete_and_readback_share_original_budget(self):
  with tempfile.TemporaryDirectory() as folder:
   budget=m.Budget(5);value=copy.deepcopy(context);value['roots']={'python':folder};value['requiredPins']=[];snapshot={'entries':[],'bytes':0};calls=[];written=[]
   def take(root,received,context,member_policy):
    self.assertIs(received,budget);self.assertEqual(root,pathlib.Path(folder));self.assertTrue(context['external']);calls.append(context['aggregate']);return snapshot
   def metadata(root,name,value,source):written.append(value);return {'name':name,'bytes':1,'sha256':'a'*64}
   with patch.object(m,'safe',side_effect=lambda p:p),patch.object(m,'source_snapshot',side_effect=take),patch.object(m,'mac_external_links') as links,patch.object(m,'metadata',side_effect=metadata),patch.object(m,'source_read_sidecar',side_effect=lambda *a:written[-1]),patch.object(os,'geteuid',return_value=501,create=True):
    self.assertTrue(m.mac_external_observe(value,pathlib.Path(folder)/'external.json',budget)['complete'])
    self.assertIs(links.call_args.args[2],budget);self.assertEqual(len(calls),2);self.assertIsNot(calls[0],calls[1])
   with patch.object(m,'safe',side_effect=lambda p:p),patch.object(m,'source_snapshot',side_effect=[snapshot,{'entries':[],'bytes':1}]),patch.object(m,'mac_external_links'),patch.object(m,'metadata') as write:
    with self.assertRaisesRegex(m.CheckpointError,'source-external-changed'):m.mac_external_observe(value,pathlib.Path(folder)/'external.json',m.Budget(5))
    write.assert_not_called()
 def test_mode_rejects_unreviewed_inputs_before_file_io(self):
  for tail in [['--generated-links','PRIVATE'],['--manifest','PRIVATE'],['--platform-policy','mac-arm'],['--seconds','101']]:
   with patch.object(sys,'argv',['archive','mac-python-package-observe','--input','PRIVATE','--output','PRIVATE','--seconds','5']+tail),patch.object(pathlib.Path,'read_bytes',side_effect=AssertionError('unreviewed read')):
    with self.assertRaisesRegex(m.CheckpointError,'source-mac-package-context'):m.main()
unittest.main(argv=['candidate'],verbosity=2)
`;
  const result = spawnSync("python", ["-I", "-B", "-c", py], {
    input: JSON.stringify(plan().context),
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 65536,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
