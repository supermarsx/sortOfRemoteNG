import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import {
  BRANCH,
  WORKFLOW,
  NEGATIVES,
  authority,
  budget,
  childEnvironment,
  validateReport,
  childFailure,
  main,
} from "../fixtures/cef/mac_nearby_source_carrier.mjs";
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
  CEF_MAC_NEARBY_JOB_STARTED_MS: "100000",
});
function report() {
  return {
    schemaVersion: 1,
    kind: "sorng-mac-nearby-owned-source-proof",
    complete: true,
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    image: "20260824.0482.1",
    productionLiteralAdmission: false,
    productionInputWrites: false,
    compilerExecuted: false,
    sdkBuilt: false,
    nativeAcceptance: false,
    runtimeReady: false,
    publicDeniedBefore: true,
    publicDeniedAfter: true,
    failureStage: null,
    failureCode: null,
    cleanupConfirmed: true,
    proofWriterClosed: true,
    proofWriterRetired: true,
    cases: [
      [
        "aarch64-apple-darwin",
        "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
        "sorng-macarm-owned-source-metadata-intel-20260824-v2-nearby-literals",
      ],
      [
        "x86_64-apple-darwin",
        "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
        "sorng-macintel-owned-source-metadata-intel-20260824-v2-nearby-literals",
      ],
    ].map(([target, source, policy]) => ({
      target,
      source,
      policy,
      schemaVersion: 2,
      recorded: true,
      recreatedDistinctInodes: true,
      applied: true,
      verified: true,
      literalRows: 5,
      portableLiteralBindingVerified: true,
      sidecarUnchanged: true,
      noLinuxStatCache: true,
      birthIdentityPortable: false,
      complete: true,
      negativeCases: Object.fromEntries(NEGATIVES.map((name) => [name, true])),
    })),
  };
}
test("proof authority accepts only the exact private branch source and qualified Intel image", () => {
  authority(qualified(), "darwin", "x64");
  for (const key of Object.keys(qualified()).filter(
    (key) => key !== "CEF_MAC_NEARBY_JOB_STARTED_MS",
  ))
    assert.throws(() =>
      authority({ ...qualified(), [key]: "foreign" }, "darwin", "x64"),
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
});
test("one remaining job budget reserves cleanup and never opens a second lease", () => {
  assert.equal(budget(100000, 100000), 100000);
  assert.equal(budget(100000, 350000), 20000);
  for (const [started, now] of [
    [100000, 350001],
    [100000, 99999],
    [0, 1],
    [NaN, 1],
    [100000, Infinity],
  ])
    assert.throws(() => budget(started, now));
});
test("leaf environment is closed, token-free and retains the runner containment ID", () => {
  const env = childEnvironment(
    {
      ...qualified(),
      GITHUB_TOKEN: "SECRET",
      OTHER: "SECRET",
      RUNNER_TRACKING_ID: "owned",
    },
    190000,
  );
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.OTHER, undefined);
  assert.equal(env.RUNNER_TRACKING_ID, "owned");
  assert.equal(env.CEF_MAC_NEARBY_CHILD_DEADLINE_MS, "190000");
  assert.equal(env.GITHUB_REF, BRANCH);
});
test("strict report binds both exact v2 policies, all negatives and writer retirement without admission", () => {
  validateReport(report());
  const mutations = [
    (r) => (r.productionLiteralAdmission = true),
    (r) => (r.nativeAcceptance = true),
    (r) => (r.proofWriterRetired = false),
    (r) => (r.cleanupConfirmed = false),
    (r) => (r.publicDeniedAfter = false),
    (r) => (r.cases[1] = r.cases[0]),
    (r) => (r.cases[0].schemaVersion = 1),
    (r) => (r.cases[0].literalRows = 4),
    (r) => (r.cases[0].recreatedDistinctInodes = false),
    (r) => (r.cases[0].birthIdentityPortable = true),
    (r) => (r.cases[0].negativeCases["same-length-corruption"] = false),
    (r) => (r.cases[0].negativeCases.extra = true),
    (r) => (r.extra = "SECRET"),
  ];
  for (const mutate of mutations) {
    const value = report();
    mutate(value);
    assert.throws(() => validateReport(value));
  }
});
test("failure observer retains only a closed stage, never raw child output or paths", () => {
  const value = childFailure({
    code: 1,
    stdout: JSON.stringify({
      kind: "sorng-mac-nearby-proof-failure",
      complete: false,
      stage: "arm",
      productionLiteralAdmission: false,
    }),
    stderr: "SECRET /private/path",
  });
  assert.equal(value.stage, "arm");
  assert(!JSON.stringify(value).includes("SECRET"));
  assert.equal(
    childFailure({ stdout: "SECRET /private/path" }).stage,
    "unavailable",
  );
  assert.equal(
    childFailure({ stdout: JSON.stringify({ ...value, stage: "SECRET" }) })
      .stage,
    "unavailable",
  );
});
test("portable private creator, real writer, actual snapshot projection and denial tests pass", () => {
  const value = spawnSync(
    "python",
    ["-I", "-B", "-S", "tests/fixtures/cef/mac_nearby_source_metadata_test.py"],
    { encoding: "utf8", timeout: 60000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(value.status, 0, value.stdout + value.stderr);
  assert.match(value.stderr, /Ran 12 tests/);
  assert.match(value.stderr, /\bOK\b/);
});
test("actual carrier passes one joined stdlib leaf the original deadline and exact pin/argv", async () => {
  const expected = new Error("identical primary"),
    observations = [],
    bytes = Buffer.alloc(13592),
    python =
      "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
  const dependencies = {
    assert,
    authority,
    budget,
    childEnvironment,
    childFailure,
    PYTHON: python,
    process: {
      argv: ["node", "fixed-carrier"],
      platform: "darwin",
      arch: "x64",
      env: {
        ...qualified(),
        RUNNER_TEMP: "/Users/runner/work/_temp",
        GITHUB_WORKSPACE: "/owned/checkout",
        GITHUB_OUTPUT: "/owned/output",
        TOKEN: "SECRET",
      },
    },
    performance: { now: () => 10 },
    Date: { now: () => 100000 },
    held: async (file, size) => {
      assert.equal(file, python);
      assert.equal(size, 13592);
      return bytes; // This is only a command-wiring fixture, not a native pin.
    },
    createHash: () => ({
      update(value) {
        assert.equal(value, bytes);
        return this;
      },
      digest: () =>
        "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
    }),
    fs: {
      realpath: async () => "/Users/runner/work/_temp",
      lstat: async () => {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      },
      appendFile: async (...args) => observations.push(args),
    },
    path: await import("node:path"),
    randomUUID: () => "12345678-1234-4123-8123-123456789abc",
    executeJoined: async (file, args, options) => {
      assert.equal(file, python);
      assert.deepEqual(args.slice(0, 4), [
        "-I",
        "-B",
        "-S",
        "tests/fixtures/cef/mac_nearby_source_proof.py",
      ]);
      assert.equal(options.maxBuffer, 65536);
      assert.equal(options.killSignal, "SIGKILL");
      assert.equal(options.joinDeadline, 100010);
      assert.equal(options.env.CEF_MAC_NEARBY_CHILD_DEADLINE_MS, "195000");
      assert.equal(options.env.TOKEN, undefined);
      throw expected;
    },
    console: { error() {} },
  };
  const run = new Function(
    ...Object.keys(dependencies),
    `return (${main.toString()});`,
  )(...Object.values(dependencies));
  await assert.rejects(run(), (error) => error === expected);
  assert.equal(observations.length, 1);
});
test("branch-only workflow can register on main without granting main execution or broad artifacts", async () => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-mac-nearby-source-proof.yml", "utf8"),
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.proof;
  assert(job.if.includes(`github.ref == '${BRANCH}'`));
  assert(job.if.includes("github.repository_id == '1010282954'"));
  assert.equal(job["runs-on"], "macos-15-intel");
  assert.equal(job["timeout-minutes"], 5);
  assert(job.steps[0].run.includes("CEF_MAC_NEARBY_JOB_STARTED_MS"));
  const checkout = job.steps.find((s) =>
    s.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const proof = job.steps.find((s) => s.id === "proof");
  assert.equal(proof["timeout-minutes"], 3);
  assert.equal(
    proof.run,
    "node tests/fixtures/cef/mac_nearby_source_carrier.mjs",
  );
  const upload = job.steps.find((s) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.deepEqual(upload.with.path.trim().split("\n"), [
    "${{ steps.proof.outputs.root }}/proof.json",
    "${{ steps.proof.outputs.root }}/carrier.json",
  ]);
  assert.equal(upload.with["include-hidden-files"], undefined);
});
