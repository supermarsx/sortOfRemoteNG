import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import path from "node:path";
import { parse } from "acorn";
import YAML from "yaml";
import {
  BRANCH,
  WORKFLOW,
  WITNESSES,
  NEGATIVES,
  authority,
  budget,
  childEnvironment,
  validateReport,
  childFailure,
  parseGitWitness,
  hostObservation,
} from "../fixtures/cef/mac_clang_resource_carrier.mjs";
import { executeJoined } from "../fixtures/cef/mac_process_census_proof.mjs";
const UUID = "12345678-1234-4123-8123-123456789abc";
const qualified = () => ({
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  ImageOS: "macos15",
  ImageVersion: "20260824.0482.1",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: BRANCH,
  GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
  GITHUB_REPOSITORY_ID: "1010282954",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_REF: WORKFLOW,
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
  CEF_MAC_CLANG_JOB_STARTED_MS: "100000",
});
const expected = () => ({
  head: "a".repeat(40),
  runId: "123",
  runAttempt: "1",
  attemptId: UUID,
  sourceWitnessSha256: "b".repeat(64),
});
function report(identity = expected()) {
  return {
    schemaVersion: 3,
    kind: "sorng-mac-clang-resource-owned-proof",
    complete: true,
    ...identity,
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    image: "20260824.0482.1",
    cleanupConfirmed: true,
    proofWriterClosed: true,
    proofWriterRetired: true,
    observedHost: {
      source: "process-and-runner-environment",
      platform: "darwin",
      architecture: "x86_64",
      imageOS: "macos15",
      imageVersion: "20260824.0482.1",
      runnerEnvironment: "github-hosted",
      githubActions: true,
    },
    publicV3DeniedBefore: true,
    publicV3DeniedAfter: true,
    productionClangAdmission: false,
    productionInputWrites: false,
    sourceAcquisition: false,
    GNExecuted: false,
    compilerExecuted: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    runtimeReady: false,
    cases: [
      [
        "aarch64-apple-darwin",
        "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
        "sorng-macarm-owned-source-metadata-intel-20260824-v3-nearby-clang-literals",
      ],
      [
        "x86_64-apple-darwin",
        "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
        "sorng-macintel-owned-source-metadata-intel-20260824-v3-nearby-clang-literals",
      ],
    ].map(([target, source, policy]) => ({
      target,
      source,
      policy,
      schemaVersion: 3,
      recorded: true,
      recreatedDistinctInodes: true,
      applied: true,
      verified: true,
      nearbyLiteralRows: 5,
      compilerLiteralRows: 6,
      fullByteReadbackVerified: true,
      timestampReadbackVerified: true,
      sidecarUnchanged: true,
      macStatCacheCreated: false,
      syntheticGitInputs: true,
      negativeCases: Object.fromEntries(NEGATIVES.map((name) => [name, true])),
      complete: true,
    })),
  };
}
const gitPacket = (rows) =>
  Buffer.concat(
    rows.flatMap((raw) => [
      Buffer.from(
        `${createHash("sha1")
          .update(Buffer.from(`blob ${raw.length}\0`))
          .update(raw)
          .digest("hex")} blob ${raw.length}\n`,
      ),
      raw,
      Buffer.from("\n"),
    ]),
  );
test("private Mac proof authority denies every wrong host, image, branch, workflow and identity", () => {
  authority(qualified(), "darwin", "x64");
  for (const key of Object.keys(qualified()).filter(
    (k) => k !== "CEF_MAC_CLANG_JOB_STARTED_MS",
  ))
    assert.throws(
      () => authority({ ...qualified(), [key]: "foreign" }, "darwin", "x64"),
      key,
    );
  assert.throws(() => authority(qualified(), "linux", "x64"));
  assert.throws(() => authority(qualified(), "darwin", "arm64"));
  assert.throws(() =>
    authority(
      { ...qualified(), GITHUB_REF: "refs/heads/main" },
      "darwin",
      "x64",
    ),
  );
  assert.equal(
    hostObservation(
      { ...qualified(), ImageVersion: "20261026.353.1" },
      "darwin",
      "x64",
    ).imageVersion,
    "20261026.353.1",
  );
  assert.equal(
    hostObservation({ ...qualified(), ImageVersion: "SECRET" }, "darwin", "x64")
      .imageVersion,
    "other",
  );
});
test("original proof budget and closed child environment preserve one lease without credentials", () => {
  assert.equal(budget(100000, 100000), 100000);
  assert.equal(budget(100000, 350000), 20000);
  for (const [start, now] of [
    [0, 1],
    [100000, 99999],
    [100000, 350001],
    [NaN, 1],
    [100000, Infinity],
  ])
    assert.throws(() => budget(start, now));
  const child = childEnvironment(
    {
      ...qualified(),
      GITHUB_TOKEN: "SECRET",
      GH_TOKEN: "SECRET",
      OTHER: "SECRET",
      RUNNER_TRACKING_ID: "owned",
    },
    190000,
    UUID,
    "b".repeat(64),
  );
  assert.equal(child.PATH, "/usr/bin:/bin");
  assert.equal(child.RUNNER_TRACKING_ID, "owned");
  assert.equal(child.CEF_MAC_CLANG_CHILD_DEADLINE_MS, "190000");
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "OTHER", "GITHUB_OUTPUT"])
    assert.equal(child[name], undefined);
});
test("strict v3 report binds fresh attempt and all real cases while retaining false grants", () => {
  validateReport(report(), expected());
  for (const mutate of [
    (r) => (r.head = "c".repeat(40)),
    (r) => (r.attemptId = "other"),
    (r) => (r.runAttempt = "2"),
    (r) => (r.sourceWitnessSha256 = "c".repeat(64)),
    (r) => (r.complete = false),
    (r) => (r.publicV3DeniedAfter = false),
    (r) => (r.proofWriterClosed = false),
    (r) => (r.observedHost.imageVersion = "20261026.353.1"),
    (r) => (r.cases[1] = r.cases[0]),
    (r) => (r.cases[0].schemaVersion = 2),
    (r) => (r.cases[0].compilerLiteralRows = 5),
    (r) => (r.cases[0].macStatCacheCreated = true),
    (r) => (r.cases[0].syntheticGitInputs = false),
    (r) => (r.cases[0].negativeCases[NEGATIVES[0]] = false),
    (r) => (r.cases[0].negativeCases.extra = true),
    (r) => (r.extra = "SECRET"),
    ...[
      "productionClangAdmission",
      "productionInputWrites",
      "sourceAcquisition",
      "GNExecuted",
      "compilerExecuted",
      "sdkBuilt",
      "nativeAcceptance",
      "runtimeReady",
    ].map((name) => (r) => (r[name] = true)),
  ]) {
    const row = report();
    mutate(row);
    assert.throws(() => validateReport(row, expected()));
  }
  assert.throws(() =>
    validateReport(report(), { ...expected(), attemptId: undefined }),
  );
});
test("closed canonical Git witness parser requires exactly eleven actual blob bodies", () => {
  const rows = WITNESSES.map((name) => Buffer.from("committed " + name));
  const raw = gitPacket(rows);
  const actual = parseGitWitness(raw);
  assert.deepEqual(
    actual.map((r) => r.path),
    WITNESSES,
  );
  assert.equal(actual.length, 11);
  for (const bad of [
    raw.subarray(0, raw.length - 1),
    Buffer.concat([raw, Buffer.from("extra")]),
    gitPacket(rows.slice(1)),
    Buffer.from(raw.toString().replace(" blob ", " tree ")),
    Buffer.alloc(2 * 1024 ** 2 + 1),
  ])
    assert.throws(() => parseGitWitness(bad));
  const changed = Buffer.from(raw);
  changed[80] ^= 1;
  assert.throws(() => parseGitWitness(changed));
  const nonAsciiHeader = Buffer.from(raw);
  nonAsciiHeader[0] |= 128;
  assert.throws(() => parseGitWitness(nonAsciiHeader));
});
test("failure report exposes only a closed phase and never accepts complete success output", () => {
  const value = childFailure({
    stdout: JSON.stringify({
      kind: "sorng-mac-clang-resource-proof-failure",
      complete: false,
      stage: "intel",
      productionClangAdmission: false,
    }),
    stderr: "SECRET /private/path",
  });
  assert.equal(value.stage, "intel");
  assert(!JSON.stringify(value).includes("SECRET"));
  assert.equal(
    childFailure({ stdout: JSON.stringify(report()) }).complete,
    false,
  );
  assert.equal(childFailure({ stdout: "SECRET" }).stage, "unavailable");
});

// Exact module body in an isolated test realm; neither mocked pins nor these
// filesystem models qualify a real host or grant production module authority.
async function carrierModel({
  failure,
  rejectLeaf = false,
  late = false,
  drift = false,
  closeFailure = false,
  replaceReportRoot = false,
} = {}) {
  const source = await readFile(
    "tests/fixtures/cef/mac_clang_resource_carrier.mjs",
    "utf8",
  );
  const ast = parse(source, { sourceType: "module", ecmaVersion: "latest" });
  assert.equal(
    ast.body.filter((n) => n.type === "IfStatement").length,
    1,
    "only the CLI entry wrapper is omitted",
  );
  const body = ast.body
    .filter((n) => n.type !== "ImportDeclaration" && n.type !== "IfStatement")
    .map((n) =>
      source.slice(
        n.declaration?.start ?? n.start,
        n.declaration?.end ?? n.end,
      ),
    )
    .join("\n");
  const committed = new Map(
    WITNESSES.map((name) => [name, Buffer.from("committed " + name)]),
  );
  const visible = new Map(committed),
    writes = new Map(),
    calls = [];
  const python = Buffer.alloc(13592);
  let now = 10,
    root,
    index = 0,
    closed = false,
    replaced = false;
  const uid = 0n;
  const dir = {
    dev: 1n,
    ino: 2n,
    mode: 0o40700n,
    uid,
    gid: uid,
    birthtimeNs: 1n,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  const deps = {
    assert,
    path: path.posix,
    constants: await import("node:fs").then((x) => x.constants),
    pathToFileURL: () => {
      throw Error("NO_FOOTER");
    },
    createHash: (kind) => {
      const h = createHash(kind);
      let pinned = false;
      return {
        update(raw) {
          pinned ||= raw === python;
          h.update(raw);
          return this;
        },
        digest(format) {
          return pinned
            ? "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d"
            : h.digest(format);
        },
      };
    },
    randomUUID: () =>
      index++ === 0 ? UUID : "12345678-1234-4123-8123-123456789abd",
    process: {
      argv: ["node", "fixed"],
      platform: "darwin",
      arch: "x64",
      getuid: () => 0,
      env: {
        ...qualified(),
        RUNNER_TEMP: "/Users/runner/work/_temp",
        GITHUB_WORKSPACE: "/owned/checkout",
        GITHUB_OUTPUT: "/owned/output",
        TOKEN: "SECRET",
      },
    },
    performance: { now: () => now },
    Date: { now: () => 100000 },
    held: async (file) => {
      if (file.endsWith(".git/HEAD")) return Buffer.from("a".repeat(40) + "\n");
      if (file.endsWith("python3.14")) return python;
      if (writes.has(file)) return writes.get(file);
      const relative = file.replace(/^\/owned\/checkout\//, "");
      assert(visible.has(relative), file);
      return visible.get(relative);
    },
    fs: {
      realpath: async (name) => name,
      lstat: async (name) => {
        if (name.includes("cef-mac-clang-owned-proof-"))
          throw Object.assign(Error("absent"), { code: "ENOENT" });
        return replaced && name === root ? { ...dir, ino: 3n } : dir;
      },
      mkdir: async (name) => {
        root = name;
      },
      appendFile: async (...args) => calls.push(["output", ...args]),
      open: async (name) => {
        if (name === root)
          return {
            stat: async () => dir,
            close: async () => {
              closed = true;
              if (closeFailure) throw closeFailure;
            },
          };
        if (replaceReportRoot && name.endsWith("/proof.json")) replaced = true;
        return {
          writeFile: async (raw) => writes.set(name, raw),
          stat: async () => ({
            isFile: () => true,
            nlink: 1n,
            size: BigInt(writes.get(name).length),
          }),
          close: async () => {},
        };
      },
      readdir: async (name) =>
        [...writes.keys()]
          .filter((key) => path.dirname(key) === name)
          .map((key) => path.basename(key)),
    },
    execFile: () => {
      throw Error("NO_REAL_SPAWN_IN_MODEL");
    },
    executeJoined: async (file, args, options) => {
      calls.push([file, args, options]);
      assert.equal(options.env.TOKEN, undefined);
      if (file === "/usr/bin/git")
        return {
          stdout: gitPacket(WITNESSES.map((name) => committed.get(name))),
        };
      assert.equal(
        file,
        "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
      );
      assert.deepEqual(args.slice(0, 5), [
        "-I",
        "-B",
        "-S",
        "tests/fixtures/cef/mac_clang_resource_source_proof.py",
        "--output",
      ]);
      assert.equal(options.joinDeadline, 100010);
      assert.equal(options.env.GITHUB_TOKEN, undefined);
      if (rejectLeaf) throw failure;
      if (late) now = 100011;
      if (drift) visible.set(WITNESSES[0], Buffer.from("changed"));
      const identity = {
        ...expected(),
        sourceWitnessSha256: options.env.CEF_MAC_CLANG_SOURCE_WITNESS_SHA256,
      };
      return { stdout: JSON.stringify(report(identity)) };
    },
  };
  const api = new Function(...Object.keys(deps), body + "\nreturn {main};")(
    ...Object.values(deps),
  );
  return { api, writes, calls, closed: () => closed };
}
test("actual carrier module model requires its own fulfilled leaf and binds fixed command and report root", async () => {
  const model = await carrierModel();
  await model.api.main();
  assert(model.closed());
  assert.equal(model.writes.size, 2);
  const proof = [...model.writes.entries()].find(([p]) =>
    p.endsWith("/proof.json"),
  );
  assert(proof);
  assert.equal(JSON.parse(proof[1]).complete, true);
  assert.equal(
    model.calls.filter(([name]) => name === "/usr/bin/git").length,
    2,
  );
});
test("actual carrier rejects complete-looking child failure and preserves falsy first reasons through close failure", async () => {
  for (const reason of [
    Object.assign(Error("primary"), { stdout: JSON.stringify(report()) }),
    false,
    0,
    null,
    undefined,
  ]) {
    const model = await carrierModel({
      failure: reason,
      rejectLeaf: true,
      closeFailure: Error("secondary close"),
    });
    let caught = false,
      actual;
    try {
      await model.api.main();
    } catch (error) {
      caught = true;
      actual = error;
    }
    assert(caught);
    assert.equal(actual, reason);
    assert(model.closed());
    assert(
      ![...model.writes.keys()].some((name) => name.endsWith("/proof.json")),
    );
    assert.equal(JSON.parse([...model.writes.values()][0]).complete, false);
  }
});
test("late fulfilled result or changed committed checkout never writes a success proof", async () => {
  for (const options of [
    { late: true },
    { drift: true },
    { replaceReportRoot: true },
  ]) {
    const model = await carrierModel(options);
    await assert.rejects(model.api.main());
    assert(model.closed());
    assert(
      ![...model.writes.keys()].some((name) => name.endsWith("/proof.json")),
    );
  }
});
test("actual joined reader rejects a real benign leaf that prints success but exits unsuccessfully", async () => {
  const python = process.platform === "win32" ? "python" : "python3";
  let closed = false,
    observed;
  await assert.rejects(
    executeJoined(
      python,
      [
        "-I",
        "-B",
        "-S",
        "-c",
        'import sys;print("{\\\"complete\\\":true}");sys.exit(7)',
      ],
      {
        env: {
          PATH: process.env.PATH,
          ...(process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
        },
        timeout: 5000,
        joinDeadline: performance.now() + 6000,
        maxBuffer: 2048,
        windowsHide: true,
      },
      (file, args, options, callback) => {
        const child = execFile(file, args, options, (error, stdout, stderr) => {
          observed = stdout;
          callback(error, stdout, stderr);
        });
        child.once("close", () => {
          closed = true;
        });
        return child;
      },
    ),
    (error) => {
      assert.equal(error.code, 7);
      assert.equal(JSON.parse(observed).complete, true);
      return true;
    },
  );
  assert.equal(closed, true);
});
test("portable core tests keep real Linux semantics distinct from modeled Darwin facts", () => {
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-S",
      "tests/fixtures/cef/mac_clang_resource_metadata_test.py",
    ],
    { encoding: "utf8", timeout: 60000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 14 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
test(
  "new actual native fixture functions run the whole POSIX pipeline without mocked codec",
  { skip: process.platform === "win32" },
  () => {
    const code = String.raw`import importlib.util,pathlib,json,os
root=pathlib.Path.cwd()
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
u=load('clang_units',root/'tests/fixtures/cef/mac_clang_resource_metadata_test.py')
p=load('clang_proof',root/'tests/fixtures/cef/mac_clang_resource_source_proof.py')
t=u.PosixCodec();t.setUp()
try:
 with t.mac_model():
  m=u.m;b=m.Budget(40)
  observed={'source':'process-and-runner-environment','platform':'darwin','architecture':'x86_64','imageOS':'macos15','imageVersion':m.MAC_SOURCE_IMAGE,'runnerEnvironment':'github-hosted','githubActions':True}
  # Only the host/interpreter preflight is modeled. Actual main, creator,
  # all codec operations, real FDs/cleanup and final report execute unchanged.
  p.preflight=lambda args:(t.output,m,b,observed)
  os.environ.update(GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1',CEF_MAC_CLANG_ATTEMPT_ID='12345678-1234-4123-8123-123456789abc',CEF_MAC_CLANG_SOURCE_WITNESS_SHA256='b'*64)
  report=json.loads(p.main(['--output',str(t.output)]));rows=report['cases']
  assert report['complete']and report['cleanupConfirmed']and report['proofWriterRetired']and not t.output.exists()
  assert all(r['complete']and len(r['negativeCases'])==26 for r in rows)
  print(json.dumps({'cases':len(rows),'darwinFactsModeled':True,'nativeMacProof':False}))
finally:t.tearDown()
`;
    const value = spawnSync("python3", ["-I", "-B", "-S", "-c", code], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 65536,
      windowsHide: true,
    });
    assert.equal(value.status, 0, value.stdout + value.stderr);
    assert.deepEqual(JSON.parse(value.stdout), {
      cases: 2,
      darwinFactsModeled: true,
      nativeMacProof: false,
    });
  },
);
test("native leaf rejects unknown host before interpreter or filesystem and emits only fixed failure", () => {
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-B",
      "-S",
      "tests/fixtures/cef/mac_clang_resource_source_proof.py",
      "--bad",
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    kind: "sorng-mac-clang-resource-proof-failure",
    complete: false,
    stage: "arguments",
    productionClangAdmission: false,
  });
});
test("new workflow registers inertly and uploads exactly two reports without permissions or budget changes", async () => {
  const value = YAML.parse(
    await readFile(
      ".github/workflows/cef-mac-clang-resource-proof.yml",
      "utf8",
    ),
  );
  assert.deepEqual(value.permissions, { contents: "read" });
  const job = value.jobs.proof;
  assert(job.if.includes(`github.ref == '${BRANCH}'`));
  assert(job.if.includes("github.repository_id == '1010282954'"));
  assert.equal(job["runs-on"], "macos-15-intel");
  assert.equal(job["timeout-minutes"], 5);
  assert(job.steps[0].run.includes("CEF_MAC_CLANG_JOB_STARTED_MS"));
  const checkout = job.steps.find((s) =>
    s.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const leaf = job.steps.find((s) => s.id === "proof");
  assert.equal(leaf["timeout-minutes"], 3);
  assert.equal(
    leaf.run,
    "node tests/fixtures/cef/mac_clang_resource_carrier.mjs",
  );
  const upload = job.steps.find((s) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.deepEqual(upload.with.path.trim().split("\n"), [
    "${{ steps.proof.outputs.root }}/proof.json",
    "${{ steps.proof.outputs.root }}/carrier.json",
  ]);
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  assert(
    ci.includes("tests/tooling/cefMacClangResourceMetadata.node-test.mjs"),
  );
});
