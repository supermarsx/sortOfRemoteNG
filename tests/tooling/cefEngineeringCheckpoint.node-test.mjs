import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
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
} from "node:fs/promises";
import path from "node:path";
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
  sha,
  validateIdentity,
  validateManifest,
  validateSeal,
  apiClient,
  downloadAsset,
  downloadHost,
  groupQuiet,
  processRows,
  observedLineage,
  sameObservedCohort,
  compileSlice,
  archiveCommand,
  graphDigest,
  graphInventory,
  GRAPH_LIMITS,
  assertGraphBudget,
  afterGnPhase,
  normalizeSdkLinks,
  selectedSdkPreflight,
  selectedSdkEnvironment,
  sdkLayoutRecord,
  withVerifiedGraph,
  restoreVerifiedGraph,
  restoreDownload,
  workspace,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  argumentsFor,
  main,
} from "../../scripts/cef-engineering-checkpoint.mjs";
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
    workflow,
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

async function sdkLinkFixture(t, alias = true) {
  const root = await scratch(t),
    developer = path.join(root, "Developer"),
    sdk = path.join(
      developer,
      "Platforms",
      "MacOSX.platform",
      "Developer",
      "SDKs",
      "MacOSX26.2.sdk",
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
  assert.equal(GRAPH_LIMITS.bytes, 2 * 1024 ** 3);
  const valid = {
    files: 50000,
    bytes: GRAPH_LIMITS.bytes,
    visited: GRAPH_LIMITS.visited,
    elapsed: 59999,
  };
  assert.doesNotThrow(() => assertGraphBudget(valid));
  for (const delta of [
    { files: 50001 },
    { bytes: GRAPH_LIMITS.bytes + 1 },
    { visited: 300001 },
    { elapsed: 60000 },
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
  test(`SDK preflight attributes ${scenario} to the command role before strict rejection`, async (t) => {
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
          observe: (value) => records.push(sdkLayoutRecord(value)),
          run: async () => ({
            stdout:
              [reported, f.platform, f.options.developerDir][index++] + "\n",
          }),
        },
        async () => {
          acquired = true;
        },
      ),
    );
    assert.equal(acquired, false);
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
    assert(records.some((row) => row.ok === false));
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
