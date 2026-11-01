import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  MAC_NATIVE_CENSUS_ADMITTED,
  MAC_CENSUS_ABI,
  MAC_CENSUS_EVIDENCE,
  LIMITS,
  canonical,
  shape,
  nativeCensusRows,
  macCensusRequestBudget,
  createMacProcessCensusFactory,
  createMacCensusIntegrationProofFactory,
  observedQuiet,
  compileSlice,
  validateCompile,
  uploadCheckpoint,
  uploadSdkBundle,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  integrationCaseNames,
  runSupervisorProof,
} from "../fixtures/cef/mac_census_supervisor_proof.mjs";

const source = await readFile(
  "scripts/lib/cef-engineering-checkpoint.mjs",
  "utf8",
);
const target = "x86_64-apple-darwin";
const digest =
  "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef";
const scope = {
  target,
  source: digest,
  canonicalRoot: `/Users/runner/work/_temp/sorng-cef-engineering/${target}/${digest}`,
  scratch:
    "/owned/cef-mac-census-integration-12345678-1234-4123-8123-123456789abc",
  python:
    "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
  deadline: 100000,
};
const host = {
  platform: "darwin",
  arch: "x64",
  env: {
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_TEMP: "/owned",
  },
};
function scopeValidator(process = host) {
  const code = source.slice(
    source.indexOf("function censusScope("),
    source.indexOf("async function censusOwnedRoot("),
  );
  return vm.runInNewContext("(" + code + ")", {
    assert,
    shape,
    process,
    path,
    performance: { now: () => 0 },
    LIMITS,
    COMPILE_CLEANUP_MS: 30000,
    MAC_CENSUS_PYTHON: scope.python,
    MAC_CENSUS_SOURCES: {
      [target]: digest,
      "aarch64-apple-darwin":
        "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    },
  });
}
test("factory scope is exact before any IO and public admission remains false", async () => {
  assert.equal(MAC_NATIVE_CENSUS_ADMITTED, false);
  await assert.rejects(
    createMacProcessCensusFactory(null),
    /CENSUS_UNADMITTED/,
  );
  scopeValidator()(scope, true);
  for (const changed of [
    { source: "a".repeat(64) },
    { target: "arm64" },
    { canonicalRoot: scope.canonicalRoot + "/child" },
    { scratch: "/owned/foreign" },
    { python: "/usr/bin/python3" },
    { deadline: LIMITS.hostMs + 1 },
  ])
    assert.throws(() => scopeValidator()({ ...scope, ...changed }, true));
  for (const changed of [
    { platform: "linux" },
    { arch: "arm64" },
    { env: { ...host.env, ImageVersion: "20261021.278.1" } },
    { env: { ...host.env, RUNNER_ENVIRONMENT: "self-hosted" } },
  ])
    assert.throws(
      () => scopeValidator({ ...host, ...changed })(scope, true),
      /CENSUS_HOST/,
    );
  assert.throws(() => scopeValidator()(scope, false), /CENSUS_ROOT/);
  if (process.platform !== "darwin" || process.arch !== "x64")
    await assert.rejects(
      createMacCensusIntegrationProofFactory({
        ...scope,
        deadline: performance.now() + 10000,
      }),
      /CENSUS_HOST/,
    );
});
test("finite request budget covers maximum work and bounded cleanup without adopting a host lease", () => {
  assert.equal(LIMITS.maxCompileMs, 180 * 60 * 1000);
  assert.equal(macCensusRequestBudget(LIMITS.maxCompileMs), 43328);
  assert.equal(macCensusRequestBudget(1), 129);
  assert.equal(macCensusRequestBudget(LIMITS.maxCompileMs, "readonly"), 8);
  for (const ms of [0, -1, Infinity, 1.5, LIMITS.maxCompileMs + 1])
    assert.throws(() => macCensusRequestBudget(ms));
  assert.throws(() => macCensusRequestBudget(1, "unbounded"));
});
test("private worker directories remain0700 while an owned canonical0755 workspace needs no metadata mutation", async () => {
  const code = source.slice(
    source.indexOf("async function censusOwnedRoot("),
    source.indexOf("async function censusPythonPin("),
  );
  let mode = 0o40755n;
  const check = vm.runInNewContext("(" + code + ")", {
    assert,
    noLinks: async (p) => p,
    userInfo: () => ({ uid: 501 }),
    lstat: async () => ({ isDirectory: () => true, uid: 501n, mode }),
  });
  await check("/owned/source", { privateDirectory: false });
  await assert.rejects(check("/owned/private"), /CENSUS_ROOT/);
  mode = 0o40700n;
  await check("/owned/private");
  for (const bad of [0o40777n, 0o40775n, 0o40600n]) {
    mode = bad;
    await assert.rejects(
      check("/owned/source", { privateDirectory: false }),
      /CENSUS_ROOT/,
    );
  }
});
test("actual supervisor proof entry is closed, bounded and explicitly never a production mutation token", async () => {
  assert.deepEqual(integrationCaseNames(), [
    "normal",
    "slice-stop",
    "cancel",
    "reparent",
    "foreign",
    "worker-timeout",
  ]);
  const copy = integrationCaseNames();
  copy.push("unknown");
  assert.equal(integrationCaseNames().length, 6);
  if (process.platform !== "darwin" || process.arch !== "x64")
    await assert.rejects(
      runSupervisorProof("must-not-touch-files"),
      /INTEGRATION_HOST/,
    );
  const fixture = await readFile(
    "tests/fixtures/cef/mac_census_supervisor_proof.mjs",
    "utf8",
  );
  assert(fixture.includes("160000") && fixture.includes("130000"));
  assert(fixture.includes("milliseconds + 30000 < end"));
  assert(fixture.includes("pauseMacCensusIntegrationWorker(factory)"));
  assert(fixture.includes("Genuine in-process compile result required"));
  const py = await readFile("scripts/lib/cef-mac-process-census.py", "utf8");
  const worker = py.slice(
    py.indexOf("def native_worker("),
    py.indexOf("def integration_actor("),
  );
  assert(!worker.includes("subprocess") && !worker.includes("ORACLE"));
});
test("native identities are uniform portable data and cannot cause a PS fallback or forge a capability", async () => {
  const record = {
    outcome: "slice-ended",
    exitCode: null,
    quiescent: true,
    groupId: 123,
    quiescence: "observed-lineage-and-root-group",
    observed: [{ pid: 123, start: "darwin-v1:1793550000:1" }],
  };
  assert.equal(validateCompile(record), record);
  assert.throws(() =>
    validateCompile({
      ...record,
      observed: [
        ...record.observed,
        { pid: 124, start: "Sun Nov 1 12:00:00 2026" },
      ],
    }),
  );
  await assert.rejects(
    observedQuiet(record.observed, 123),
    /CENSUS_CAPABILITY/,
  );
  await assert.rejects(
    observedQuiet(record.observed, 123, {
      censusFactory: { kind: "scoped-mac-census-factory" },
    }),
    /CENSUS_CAPABILITY/,
  );
  await assert.rejects(
    compileSlice("not-spawned", [], { censusFactory: {}, env: {} }),
    /CENSUS_CAPABILITY/,
  );
  await assert.rejects(
    uploadCheckpoint(null, { censusFactory: {} }),
    /CENSUS_CAPABILITY/,
  );
  await assert.rejects(
    uploadSdkBundle(null, { censusFactory: {} }),
    /CENSUS_CAPABILITY/,
  );
  const compile = source.slice(
    source.indexOf("export async function compileSlice("),
    source.indexOf("const uploadObservers"),
  );
  assert(compile.includes("if (!censusBinding?.proofOnly)"));
  assert(
    compile.indexOf("await openCensusSession(") <
      compile.indexOf("child = spawn("),
  );
  for (const caller of [
    "stopObserved(",
    "observedQuiet(",
    "processSnapshot(",
  ]) {
    const positions = [
      ...compile.matchAll(new RegExp(caller.replace("(", "\\("), "g")),
    ].map((x) => x.index);
    assert(positions.length > 0);
    for (const index of positions)
      assert(
        compile.slice(index, index + 350).includes("censusSession"),
        caller,
      );
  }
});
test("native client accepts the pinned ABI and more than10000 bounded requests but never the next over-limit request", async () => {
  const text = source.slice(
    source.indexOf("function macCensusClient("),
    source.indexOf("async function processSnapshot("),
  );
  const create = vm.runInNewContext("(" + text + ")", {
    assert,
    shape,
    canonical,
    nativeCensusRows,
    MAC_CENSUS_ABI,
    JSON,
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
    positive: (x) => Number.isSafeInteger(x) && x > 0,
    COMPILE_CLEANUP_MS: 30000,
    censusFailureCode: () => "CENSUS_UNAVAILABLE",
    compileWithin: (operation) => operation(),
  });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(raw, _encoding, done) {
      const { request } = JSON.parse(raw);
      done();
      child.stdout.write(
        JSON.stringify({
          request,
          rows: [
            {
              pid: 100,
              parent: 1,
              group: 100,
              start: "darwin-v1:1793550000:1",
            },
          ],
          collectMicros: 1,
        }) + "\n",
      );
    },
  });
  child.stdin.on("finish", () =>
    queueMicrotask(() => child.emit("close", 0, null)),
  );
  child.kill = () =>
    assert.fail("healthy owned worker should close through EOF");
  child.unref = () => {};
  const client = create(child, {
    deadline: performance.now() + 10000,
    requestBudget: 43328,
    readyMilliseconds: 2000,
    contextSha256: "a".repeat(64),
  });
  child.stdout.write(
    JSON.stringify({
      kind: "mac-census-native-ready",
      abi: MAC_CENSUS_ABI,
      contextSha256: "a".repeat(64),
      productionAdmitted: false,
    }) + "\n",
  );
  await client.ready;
  for (let n = 0; n < 43328; n++) await client.snapshot();
  await assert.rejects(client.snapshot(), /CENSUS_REQUEST_BOUND/);
  const result = await client.close();
  assert.equal(result.requests, 43328);
  assert.equal(result.joined, true);
});
test("Python actual fixed worker context rejects scope/budget drift before libc and enforces the same finite protocol", () => {
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-S",
      "-c",
      String.raw`
import importlib.util,json,sys,pathlib,time,io
from unittest.mock import patch
s=importlib.util.spec_from_file_location('census',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
root=pathlib.Path('/owned/cef-mac-census-integration-12345678-1234-4123-8123-123456789abc/cef-mac-census-session-12345678-1234-4123-8123-123456789abc')
target='x86_64-apple-darwin';digest=m.NATIVE_SOURCES[target]
c={'kind':'mac-census-session','mode':'integration-proof','target':target,'source':digest,'canonicalRoot':'/Users/runner/work/_temp/sorng-cef-engineering/'+target+'/'+digest,'image':m.IMAGE,'phase':'compile','workMilliseconds':m.NATIVE_MAX_WORK_MS,'leaseMilliseconds':m.NATIVE_MAX_WORK_MS+30000,'wallEndMilliseconds':int(time.time()*1000)+m.NATIVE_MAX_WORK_MS,'requestBudget':43328,'evidence':m.NATIVE_EVIDENCE}
assert m.native_context(root,json.dumps(c))==c
for change in ({'source':'a'*64},{'image':'20261030.294.1'},{'requestBudget':43329},{'workMilliseconds':m.NATIVE_MAX_WORK_MS+1},{'canonicalRoot':c['canonicalRoot']+'/other'},{'mode':'production'},{'evidence':'0'*64},{'private':'unexpected'}):
 try:m.native_context(root,json.dumps({**c,**change}));raise AssertionError('bad scope admitted')
 except m.CensusError:pass
with patch.object(m,'native_root',side_effect=m.CensusError('CENSUS_ROOT')),patch.object(m,'held_bytes',side_effect=AssertionError('IO before root fence')),patch.object(m,'SysctlCensus',side_effect=AssertionError('libc before root fence')):
 try:m.native_worker('foreign');raise AssertionError('foreign root accepted')
 except m.CensusError:pass
class Input:buffer=io.BytesIO(b''.join((json.dumps({'request':n})+'\n').encode()for n in range(1,43330)))
class Output:
 count=0
 def write(self,value):
  if value!='\n':self.count+=1
 def flush(self):pass
class Provider:
 calls=0
 def __init__(self,abi):assert abi==m.NATIVE_ABI
 def snapshot(self):Provider.calls+=1;return [{'pid':1,'parent':0,'group':1,'start':'darwin-v1:1793550000:1'}]
out=Output()
with patch.object(m,'native_root',return_value=root),patch.object(m,'held_bytes',return_value=json.dumps(c).encode()),patch.object(m,'SysctlCensus',Provider),patch.object(sys,'stdin',Input()),patch.object(sys,'stdout',out):
 try:m.native_worker(root);raise AssertionError('request overflow accepted')
 except m.CensusError as e:assert str(e)=='CENSUS_REQUEST'
assert Provider.calls==43328 and out.count==43329
print('fixed native worker scope and43328request cap passed')
`,
      "scripts/lib/cef-mac-process-census.py",
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 8192, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("ABI and evidence pins describe the exact native proof, not compiler/runtime admission", () => {
  assert.equal(MAC_CENSUS_ABI.recordBytes, 648);
  assert.equal(MAC_CENSUS_ABI.microsBytes, 4);
  assert.equal(MAC_CENSUS_EVIDENCE.runId, 41339128028);
  assert.equal(
    MAC_CENSUS_EVIDENCE.sha256,
    "ec38df12b8469456d353614e2cb54e486ecc163b5ab15ddcb908b296d6fc1855",
  );
  assert.equal(MAC_NATIVE_CENSUS_ADMITTED, false);
});
