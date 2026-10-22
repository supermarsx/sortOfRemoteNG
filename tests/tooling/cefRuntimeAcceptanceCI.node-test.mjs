import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  acceptancePlan,
  assertNativeTarget,
  createAcceptanceBudget,
  fixtureClientBuild,
  HTTP2_CHECKS,
  NATIVE_TARGETS,
  nativeChildEnvironment,
  producerSelection,
  runAcceptanceCommand,
  verifyAcceptanceBundle,
  verifyProducerMetadata,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";
import { releaseIdentity } from "../../scripts/cef-runtime-ci.mjs";

const repository = "supermarsx/sortOfRemoteNG";
const selected = {
  target: "aarch64-apple-darwin",
  runId: 123,
  headSha: "a".repeat(40),
  artifactId: 456,
  artifactSha256: "b".repeat(64),
  descriptorSha256: "c".repeat(64),
};
const artifactName = "cef-engine-bundle-reviewed-lock-aarch64-apple-darwin";
const run = {
  id: selected.runId,
  head_sha: selected.headSha,
  head_repository: { full_name: repository },
  repository: { full_name: repository },
  event: "workflow_dispatch",
  path: ".github/workflows/cef-patched-runtime.yml",
  status: "completed",
  conclusion: "success",
};
const artifact = {
  id: selected.artifactId,
  name: artifactName,
  expired: false,
  workflow_run: { id: selected.runId, head_sha: selected.headSha },
  digest: `sha256:${selected.artifactSha256}`,
  size_in_bytes: 12345,
};

test("reviewed producer selection is finite exact target/ID/digest data without URLs or arbitrary runners", () => {
  assert.deepEqual(producerSelection([selected]), [selected]);
  for (const patch of [
    { target: "toString" },
    { target: "other" },
    { artifactId: 0 },
    { runId: Number.MAX_SAFE_INTEGER + 1 },
    { headSha: "main" },
    { descriptorSha256: "0".repeat(64) },
    { artifactSha256: "https://arbitrary.invalid" },
    { runner: "paid-custom" },
  ])
    assert.throws(() => producerSelection([{ ...selected, ...patch }]));
  assert.throws(() => producerSelection([]));
  assert.throws(() => producerSelection([selected, selected]));
});

test("producer metadata must bind successful manual source workflow, repository, artifact ID/name/digest and run", () => {
  assert.equal(
    verifyProducerMetadata(selected, run, artifact, repository, artifactName),
    true,
  );
  for (const patch of [
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { head_sha: "d".repeat(40) },
    { event: "pull_request" },
    { path: ".github/workflows/other.yml" },
    { head_repository: { full_name: "foreign/fork" } },
    { repository: { full_name: "foreign/fork" } },
  ])
    assert.throws(() =>
      verifyProducerMetadata(
        selected,
        { ...run, ...patch },
        artifact,
        repository,
        artifactName,
      ),
    );
  for (const patch of [
    { expired: true },
    { id: 999 },
    { name: "wrong-target" },
    { digest: "sha256:" + "d".repeat(64) },
    { workflow_run: { id: 999, head_sha: selected.headSha } },
    { workflow_run: { id: selected.runId, head_sha: "d".repeat(40) } },
    { size_in_bytes: 4 * 1024 ** 3 },
  ])
    assert.throws(() =>
      verifyProducerMetadata(
        selected,
        run,
        { ...artifact, ...patch },
        repository,
        artifactName,
      ),
    );
});

test("native host mapping requires actual architecture, including ARM Mac acceptance on ARM rather than Intel", () => {
  assert.equal(Object.keys(NATIVE_TARGETS).length, 6);
  for (const [target, host] of Object.entries(NATIVE_TARGETS)) {
    assert.equal(assertNativeTarget(target, host.platform, host.arch), host);
    assert.throws(() =>
      assertNativeTarget(
        target,
        host.platform,
        host.arch === "arm64" ? "x64" : "arm64",
      ),
    );
  }
  assert.equal(NATIVE_TARGETS["aarch64-apple-darwin"].runner, "macos-15");
});

test("native process environment excludes CI credentials, inherited fixture overrides and injected loader/build flags", () => {
  const env = nativeChildEnvironment(
    {
      PATH: "native-tools",
      DISPLAY: ":99",
      XAUTHORITY: "/temporary/display-cookie",
      GH_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      NPM_TOKEN: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      SSH_AUTH_SOCK: "credential-agent",
      ACTIONS_RUNTIME_TOKEN: "secret",
      INPUT_PRODUCERS: "untrusted",
      CEF_PATH: "wrong-sdk",
      SORNG_CEF_HTTP2_EXPECT: "legacy",
      NODE_OPTIONS: "injected",
      RUSTFLAGS: "injected",
      LD_PRELOAD: "injected",
      DYLD_INSERT_LIBRARIES: "injected",
    },
    "/verified-sdk",
    "/owned-cargo",
  );
  assert.deepEqual(env, {
    PATH: "native-tools",
    DISPLAY: ":99",
    XAUTHORITY: "/temporary/display-cookie",
    CEF_PATH: "/verified-sdk",
    CARGO_TARGET_DIR: "/owned-cargo",
    CARGO_BUILD_JOBS: "2",
  });
});

test("native fixture build plans use Windows DLLs only and native Unix binaries with exact locked target", () => {
  for (const [target, host] of Object.entries(NATIVE_TARGETS)) {
    for (const suite of ["tls", "http2"]) {
      const build = fixtureClientBuild(target, suite);
      assert.ok(build.args.includes("--locked"));
      assert.ok(build.args.includes("-j2"));
      assert.equal(build.args[build.args.indexOf("--target") + 1], target);
      if (host.platform === "win32") {
        assert.ok(build.args.includes("--lib"));
        assert.ok(!build.args.includes("--bins"));
        assert.equal(build.client, `sorng_cef_${suite}_acceptance.dll`);
      } else {
        assert.ok(build.args.includes("--bins"));
        assert.ok(!build.args.includes("--lib"));
        assert.equal(build.client, `sorng-cef-${suite}-acceptance`);
      }
    }
  }
  assert.throws(() => fixtureClientBuild("aarch64-apple-darwin", "arbitrary"));
});

test("acceptance commands share one total deadline instead of restarting the budget per build or case", () => {
  let now = 0;
  const budget = createAcceptanceBudget(() => now, 1000);
  assert.equal(budget.timeout(5000), 1000);
  now = 900;
  assert.equal(budget.timeout(5000), 100);
  assert.equal(budget.timeout(50), 50);
  now = 1000;
  assert.throws(
    () => budget.timeout(),
    (error) => error.code === "ACCEPTANCE_BUDGET_EXHAUSTED",
  );
});

test("owned command runner retains output, rejects nonzero exit and bounds a synthetic stalled child", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-acceptance-command-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = (file) => ({
    env: nativeChildEnvironment(process.env, "", root),
    log: path.join(root, file),
    timeout: 2000,
  });
  await runAcceptanceCommand(
    process.execPath,
    ["-e", "console.log('synthetic command completed')"],
    options("normal.log"),
  );
  assert.match(
    await readFile(path.join(root, "normal.log"), "utf8"),
    /synthetic command completed/,
  );
  await assert.rejects(
    runAcceptanceCommand(
      process.execPath,
      ["-e", "process.exit(7)"],
      options("failure.log"),
    ),
    /command failed/,
  );
  await assert.rejects(
    runAcceptanceCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      ...options("deadline.log"),
      timeout: 500,
    }),
    /deadline exceeded/,
  );
});

test(
  "Unix command exit cannot conceal surviving inherited-group children",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "cef-acceptance-group-")),
    );
    t.after(() => rm(root, { recursive: true, force: true }));
    const log = path.join(root, "leftover.log");
    await assert.rejects(
      runAcceptanceCommand(
        process.execPath,
        [
          "-e",
          "const{spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).unref();",
        ],
        {
          env: nativeChildEnvironment(process.env, "", root),
          log,
          timeout: 5000,
        },
      ),
      /left owned process-group members/,
    );
    const receipt = JSON.parse(await readFile(`${log}.cleanup.json`, "utf8"));
    assert.equal(receipt.stateAfterCommand, "present");
    assert.equal(receipt.terminationRequested, true);
    assert.equal(receipt.groupGone, true);
  },
);

test("planning reads exact producer metadata and uses the reviewed lock artifact name without executing native work", async () => {
  const inputs = "native/cef-build-inputs/20261022-registration-retirement";
  const lock = JSON.parse(
    await readFile(path.join(inputs, "source-lock.json"), "utf8"),
  );
  const expectedName = `cef-engine-bundle-${releaseIdentity(lock, selected.target).key}`;
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return new Response(
      JSON.stringify(
        url.endsWith("/123") ? run : { ...artifact, name: expectedName },
      ),
    );
  };
  const result = await acceptancePlan({
    producers: [selected],
    inputs,
    repository,
    token: "read-only-test-token",
    fetcher,
  });
  assert.equal(result.matrix.include[0].artifactName, expectedName);
  assert.equal(result.matrix.include[0].runner, "macos-15");
  assert.equal(result.nativeAcceptancePerformed, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.ok(
      request.url.startsWith(
        `https://api.github.com/repos/${repository}/actions/`,
      ),
    );
    assert.equal(request.options.redirect, "error");
  }
  await assert.rejects(
    acceptancePlan({
      producers: [selected],
      inputs,
      repository,
      fetcher: async () => new Response("denied", { status: 403 }),
    }),
    /metadata request failed/,
  );
});

test("downloaded descriptor bytes are checked before bundle verifier and target/lock mismatches cannot count", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-acceptance-ci-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("synthetic descriptor data, never executed");
  await writeFile(path.join(root, "runtime.json"), bytes);
  let calls = 0;
  const verifier = async () => {
    calls++;
    return {
      descriptor: { target: selected.target },
      identity: { sourceLockSha256: "d".repeat(64) },
    };
  };
  await assert.rejects(
    verifyAcceptanceBundle({
      bundle: root,
      selection: selected,
      repository,
      expectedLock: "d".repeat(64),
      verifier,
    }),
    /descriptor differs/,
  );
  assert.equal(calls, 0);
  const selection = {
    ...selected,
    descriptorSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await verifyAcceptanceBundle({
    bundle: root,
    selection,
    repository,
    expectedLock: "d".repeat(64),
    verifier,
  });
  assert.equal(calls, 1);
  await assert.rejects(
    verifyAcceptanceBundle({
      bundle: root,
      selection,
      repository,
      expectedLock: "e".repeat(64),
      verifier,
    }),
    /target\/source lock/,
  );
  await assert.rejects(
    verifyAcceptanceBundle({
      bundle: root,
      selection: { ...selection, target: "x86_64-apple-darwin" },
      repository,
      expectedLock: "d".repeat(64),
      verifier,
    }),
    /target\/source lock/,
  );
});

test("workflow is explicit read-only native acceptance, exact artifact download, isolated X11, sequential security checks and no publication", async () => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-runtime-acceptance.yml", "utf8"),
  );
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "workflow_call",
    "workflow_dispatch",
  ]);
  assert.deepEqual(Object.keys(workflow.on.workflow_call), ["inputs"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs).sort(), [
    "producers",
    "reviewed_inputs",
  ]);
  for (const input of Object.values(workflow.on.workflow_call.inputs)) {
    assert.equal(input.required, true);
    assert.equal(input.type, "string");
  }
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const native = workflow.jobs.native;
  assert.equal(native["runs-on"], "${{ matrix.runner }}");
  const download = native.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  assert.equal(download.with["artifact-ids"], "${{ matrix.artifactId }}");
  assert.equal(download.with["run-id"], "${{ matrix.runId }}");
  assert.equal(download.with["merge-multiple"], true);
  const execute = native.steps.find((step) =>
    step.name?.startsWith("Build native clients"),
  );
  assert.match(execute.run, /xvfb-run -a/);
  assert.match(execute.run, /-nolisten tcp/);
  assert.doesNotMatch(
    execute.run,
    /--no-sandbox|disable.*sandbox|publish|GH_TOKEN/,
  );
  assert.equal(execute.env.GH_TOKEN, undefined);
  assert.deepEqual(HTTP2_CHECKS, [
    "multiplex",
    "deny",
    "delay",
    "revoke",
    "cross-authority",
    "wss",
    "h1-fallback",
    "permission-churn",
  ]);
  assert.equal(native.steps.at(-1).if, "always()");
  assert.equal(workflow.jobs.publish, undefined);
});
