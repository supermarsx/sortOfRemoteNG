import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  acceptancePlan,
  acceptanceCodeIdentity,
  acceptanceExecution,
  assertNativeTarget,
  createAcceptanceBudget,
  createAcceptanceSeal,
  fixtureClientBuild,
  fixtureRunArguments,
  HTTP2_CHECKS,
  NATIVE_TARGETS,
  nativeChildEnvironment,
  producerSelection,
  runAcceptanceCommand,
  verifyAcceptanceBundle,
  verifyProducerMetadata,
  writeAcceptanceSeal,
  LINUX_SANDBOX_HELPER,
  linuxSandboxCommand,
  prepareLinuxSandbox,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";
import {
  WORKFLOW as ENGINEERING_WORKFLOW,
  TARGET as ENGINEERING_TARGET,
  SOURCE_ID as ENGINEERING_SOURCE,
  INPUTS as ENGINEERING_INPUTS,
  sdkSealName,
  createSdkCompletion,
  completionSha,
  canonical,
  SDK_NAMES,
  checkpointProfile,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
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

test("native acceptance writes a success-only attempt-specific seal separately from failure diagnostics", async () => {
  const module = await import("../../scripts/cef-runtime-acceptance-ci.mjs");
  assert.equal(typeof module.createAcceptanceSeal, "function");
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-runtime-acceptance.yml", "utf8"),
  );
  const seal = workflow.jobs.native.steps.find((step) =>
    step.name?.startsWith("Retain successful native acceptance seal"),
  );
  assert.ok(seal);
  assert.equal(
    seal.if,
    "success() && github.workflow_ref == format('{0}/.github/workflows/cef-runtime-acceptance.yml@{1}', github.repository, github.ref)",
  );
  assert.equal(seal.with["if-no-files-found"], "error");
  assert.equal(
    seal.with.name,
    "cef-native-acceptance-seal-${{ matrix.target }}-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  assert.match(seal.with.path, /\/seal\.json$/);
  assert.equal(workflow.jobs.native.steps.at(-1).if, "always()");
});

function sealFixture(producer = selected) {
  const native = NATIVE_TARGETS[producer.target];
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_ID: "11",
    GITHUB_RUN_ID: "999",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: "f".repeat(40),
    GITHUB_WORKFLOW_SHA: "f".repeat(40),
    GITHUB_REF: "refs/heads/Main",
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/cef-runtime-acceptance.yml@refs/heads/Main`,
  };
  const result = {
    schemaVersion: 1,
    kind: "sorng-cef-native-acceptance-run",
    target: producer.target,
    producer: { ...producer, sourceLockIdentity: "e".repeat(64) },
    ...(producer.producer === "owned-import"
      ? {
          ingestion: "operator-reviewed-local-bytes",
          hostedBuild: false,
        }
      : {}),
    acceptanceSourceSha: env.GITHUB_SHA,
    acceptanceWorkflowRunId: 999,
    nativeHost: { platform: native.platform, architecture: native.arch },
    sourceLockIdentity: "e".repeat(64),
    descriptorSha256: producer.descriptorSha256,
    reports: [
      { suite: "tls", accepted: true, reportSha256: "1".repeat(64) },
      ...HTTP2_CHECKS.map((check, i) => ({
        suite: "http2",
        check,
        accepted: true,
        reportSha256: String(i + 2).repeat(64),
      })),
    ],
    builds: ["tls", "http2"].map((suite) => ({
      suite,
      clientSha256: "a".repeat(64),
      cargoLockSha256: "b".repeat(64),
      ...(native.platform !== "win32" ? { helperSha256: "c".repeat(64) } : {}),
    })),
    ok: true,
    nativeExecutionPerformed: true,
    publicProviderAcceptance: false,
    productionReady: false,
    publicationAllowed: false,
  };
  return {
    env,
    result,
    options: {
      execution: acceptanceExecution(env),
      code: {
        sourceTree: "a".repeat(40),
        codeSha256: "b".repeat(64),
        codeDigestFormat: "git-ls-tree-r-z-sha256-v1",
      },
      reportSha256: "d".repeat(64),
    },
  };
}

test("seal preserves legacy, completed engineering and owned import identities without claiming hosted local compilation or publication", () => {
  const owned = {
    ...sdkSelected,
    producer: "owned-import",
    target: "x86_64-pc-windows-msvc",
    reviewedImport: "native/cef-owned-sdk-imports/example/review.json",
    reviewSha256: "e".repeat(64),
  };
  for (const producer of [selected, sdkSelected, owned]) {
    const { result, options } = sealFixture(producer);
    const seal = createAcceptanceSeal(result, options);
    assert.deepEqual(seal.producer, producer);
    assert.equal(seal.execution.runAttempt, 2);
    assert.equal(seal.execution.runId, 999);
    assert.equal(seal.nativeAcceptance, true);
    assert.equal(seal.productionReady, false);
    assert.equal(seal.publicationAllowed, false);
    assert.equal(seal.hostedBuild, producer === owned ? false : undefined);
    assert.deepEqual(seal.reports, result.reports);
    result.reports[0].accepted = false;
    assert.equal(seal.reports[0].accepted, true);
  }
  for (const patch of [
    { hostedBuild: true },
    { ingestion: "hosted-compiled" },
  ]) {
    const { result, options } = sealFixture(owned);
    assert.throws(() => createAcceptanceSeal({ ...result, ...patch }, options));
  }
});

test("seal rejects failed, partial, duplicate, wrong-owner/source/architecture and fabricated readiness evidence", () => {
  const mutations = [
    (v) => {
      v.ok = false;
    },
    (v) => {
      v.nativeExecutionPerformed = false;
    },
    (v) => {
      v.reports.pop();
    },
    (v) => {
      v.reports[8] = v.reports[7];
    },
    (v) => {
      v.reports[1].accepted = false;
    },
    (v) => {
      v.reports[1].check = "unknown";
    },
    (v) => {
      v.reports[1].reportSha256 = "0".repeat(64);
    },
    (v) => {
      v.reports[0].check = "multiplex";
    },
    (v) => {
      v.acceptanceWorkflowRunId++;
    },
    (v) => {
      v.acceptanceSourceSha = "a".repeat(40);
    },
    (v) => {
      v.producer.target = "x86_64-apple-darwin";
    },
    (v) => {
      v.descriptorSha256 = "a".repeat(64);
    },
    (v) => {
      v.sourceLockIdentity = "a".repeat(64);
    },
    (v) => {
      v.nativeHost.architecture = "x64";
    },
    (v) => {
      v.builds.pop();
    },
    (v) => {
      v.builds[1] = v.builds[0];
    },
    (v) => {
      v.builds[0].clientSha256 = "0".repeat(64);
    },
    (v) => {
      delete v.builds[0].helperSha256;
    },
    (v) => {
      v.productionReady = true;
    },
    (v) => {
      v.publicationAllowed = true;
    },
    (v) => {
      v.publicProviderAcceptance = true;
    },
  ];
  for (const mutate of mutations) {
    const { result, options } = sealFixture();
    mutate(result);
    assert.throws(() => createAcceptanceSeal(result, options));
  }
  const { result, options } = sealFixture();
  assert.throws(() =>
    createAcceptanceSeal(result, {
      ...options,
      execution: { ...options.execution, runAttempt: 0 },
    }),
  );
  assert.throws(() =>
    createAcceptanceSeal(result, {
      ...options,
      code: { ...options.code, codeDigestFormat: "unknown" },
    }),
  );
});

test("seal execution captures exact run attempt and workflow; rejects foreign, missing and rounded identifiers", () => {
  const { env } = sealFixture();
  for (const patch of [
    { GITHUB_RUN_ATTEMPT: undefined },
    { GITHUB_RUN_ATTEMPT: "02" },
    { GITHUB_RUN_ATTEMPT: "9007199254740993" },
    { GITHUB_REPOSITORY_ID: "0" },
    {
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/cef-owned-sdk-import.yml@refs/heads/Main`,
    },
    { GITHUB_REPOSITORY: "foreign/repo" },
    { GITHUB_WORKFLOW_SHA: "a".repeat(40) },
    { GITHUB_EVENT_NAME: "pull_request" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { GITHUB_REF: "refs/tags/v1" },
  ])
    assert.throws(() => acceptanceExecution({ ...env, ...patch }));
  assert.equal(
    acceptanceExecution({ ...env, GITHUB_RUN_ATTEMPT: "3" }).runAttempt,
    3,
  );
});

test("existing exact patched-runtime reusable caller executes native gates without direct-workflow seal authority", () => {
  const { env, result, options } = sealFixture();
  const caller = `${repository}/.github/workflows/cef-patched-runtime.yml@refs/heads/Main`;
  assert.equal(
    acceptanceExecution({ ...env, GITHUB_WORKFLOW_REF: caller }),
    null,
  );
  assert.throws(() =>
    createAcceptanceSeal(result, {
      ...options,
      execution: { ...options.execution, workflowRef: caller },
    }),
  );
  for (const patch of [
    {
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/Main`,
    },
    { GITHUB_WORKFLOW_REF: caller, GITHUB_WORKFLOW_SHA: "a".repeat(40) },
    { GITHUB_WORKFLOW_REF: caller, GITHUB_REF: "refs/heads/foreign" },
    { GITHUB_WORKFLOW_REF: caller.replace(repository, "foreign/repository") },
  ])
    assert.throws(() => acceptanceExecution({ ...env, ...patch }));
});

test("code identity observes a real clean Git commit and denies dirty code or a different workflow head", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-acceptance-code-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  await writeFile(path.join(root, "runner.mjs"), "export const gate = true;\n");
  git("add", "runner.mjs");
  git(
    "-c",
    "user.name=Acceptance Test",
    "-c",
    "user.email=acceptance@example.invalid",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "fixture",
  );
  const head = git("rev-parse", "HEAD").trim();
  const identity = acceptanceCodeIdentity(head, root);
  assert.equal(identity.sourceTree, git("rev-parse", "HEAD^{tree}").trim());
  assert.equal(
    identity.codeSha256,
    createHash("sha256")
      .update(
        execFileSync("git", [
          "-C",
          root,
          "ls-tree",
          "-r",
          "-z",
          "--full-tree",
          "HEAD",
        ]),
      )
      .digest("hex"),
  );
  assert.throws(
    () => acceptanceCodeIdentity("a".repeat(40), root),
    /workflow commit/,
  );
  await writeFile(
    path.join(root, "runner.mjs"),
    "export const gate = false;\n",
  );
  assert.throws(() => acceptanceCodeIdentity(head, root), /workflow commit/);
});

test("seal writer rechecks retained bytes and writes nothing for failures or report mutation", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-acceptance-seal-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const { result, options } = sealFixture();
  for (const row of result.reports) {
    const label = row.suite === "tls" ? "tls" : `http2-${row.check}`;
    await mkdir(path.join(root, label));
    // Synthetic serialization tests are never native runtime proof.
    const bytes = JSON.stringify({ synthetic: true, case: label });
    row.reportSha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path.join(root, label, "acceptance.json"), bytes);
  }
  const aggregate = path.join(root, "native-acceptance.json");
  await writeFile(aggregate, JSON.stringify(result));
  const input = {
    destination: root,
    result,
    execution: options.execution,
    code: options.code,
  };
  const absent = () =>
    assert.rejects(readFile(path.join(root, "seal.json")), {
      code: "ENOENT",
    });
  const original = result.reports[0].reportSha256;
  result.reports[0].reportSha256 = "c".repeat(64);
  await assert.rejects(writeAcceptanceSeal(input), /result differs/);
  await absent();
  await writeFile(aggregate, JSON.stringify(result));
  await assert.rejects(writeAcceptanceSeal(input), /case report differs/);
  await absent();
  result.reports[0].reportSha256 = original;
  result.ok = false;
  await writeFile(aggregate, JSON.stringify(result));
  await assert.rejects(writeAcceptanceSeal(input), /completed native/);
  await absent();
  result.ok = true;
  await writeFile(aggregate, JSON.stringify(result));
  const seal = await writeAcceptanceSeal(input);
  assert.equal(
    seal.report.sha256,
    createHash("sha256")
      .update(await readFile(aggregate))
      .digest("hex"),
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "seal.json"))),
    seal,
  );
  await assert.rejects(writeAcceptanceSeal(input), { code: "EEXIST" });
});

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
    "win32",
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

test("workflow retains read-only ordinary native acceptance, exact artifact download, isolated X11 and sequential security checks", async () => {
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
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
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

const sdkSelected = {
  ...selected,
  producer: "engineering-sdk",
  target: ENGINEERING_TARGET,
  runAttempt: 2,
  completionSha256: "d".repeat(64),
};
const sdkContext = { defaultBranch: "Main", repositoryId: 11, workflowId: 66 };
const sdkRun = {
  ...run,
  path: ENGINEERING_WORKFLOW,
  head_branch: "Main",
  run_attempt: 2,
  workflow_id: 66,
  head_repository: { full_name: repository, id: 11 },
  repository: { full_name: repository, id: 11 },
};
const sdkArtifact = {
  ...artifact,
  name: sdkSealName({ runId: selected.runId, attempt: 2 }),
};
test("engineering SDK selection is a separate exact producer variant; the legacy six-field contract stays closed", () => {
  assert.deepEqual(producerSelection([selected]), [selected]);
  assert.deepEqual(producerSelection([sdkSelected]), [sdkSelected]);
  for (const patch of [
    { producer: "engineering-checkpoint" },
    { runAttempt: 0 },
    { target: "x86_64-unknown-linux-gnu" },
    { completionSha256: "not-a-digest" },
    { runAttempt: undefined },
    { url: "https://other.invalid" },
  ])
    assert.throws(() => producerSelection([{ ...sdkSelected, ...patch }]));
  assert.throws(() => producerSelection([{ ...selected, runAttempt: 2 }]));
});
test("completed SDK metadata requires the exact successful default manual workflow, attempt and small independent seal", () => {
  assert.equal(
    verifyProducerMetadata(
      sdkSelected,
      sdkRun,
      sdkArtifact,
      repository,
      sdkArtifact.name,
      sdkContext,
    ),
    true,
  );
  for (const patch of [
    { path: ".github/workflows/cef-patched-runtime.yml" },
    { head_branch: "feature" },
    { run_attempt: 1 },
    { workflow_id: 77 },
    { conclusion: "failure" },
    { status: "in_progress" },
    { event: "push" },
    { repository: { full_name: repository, id: 12 } },
    { head_repository: { full_name: repository, id: 12 } },
  ])
    assert.throws(() =>
      verifyProducerMetadata(
        sdkSelected,
        { ...sdkRun, ...patch },
        sdkArtifact,
        repository,
        sdkArtifact.name,
        sdkContext,
      ),
    );
  assert.throws(() =>
    verifyProducerMetadata(
      sdkSelected,
      sdkRun,
      sdkArtifact,
      repository,
      sdkArtifact.name,
    ),
  );
  for (const patch of [
    { size_in_bytes: 1024 ** 2 },
    { name: "cef-engineering-seal-123-2" },
    { workflow_run: { id: 999, head_sha: selected.headSha } },
    { digest: "sha256:" + "f".repeat(64) },
  ])
    assert.throws(() =>
      verifyProducerMetadata(
        sdkSelected,
        sdkRun,
        { ...sdkArtifact, ...patch },
        repository,
        sdkArtifact.name,
        sdkContext,
      ),
    );
});
test("engineering planning binds the reviewed source and exact default workflow before scheduling a native host", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    const base = `https://api.github.com/repos/${repository}`;
    const data = {
      [base]: {
        id: 11,
        full_name: repository,
        private: false,
        default_branch: "Main",
      },
      [`${base}/actions/workflows/cef-engineering-checkpoint.yml`]: {
        id: 66,
        path: ENGINEERING_WORKFLOW,
      },
      [`${base}/actions/runs/123`]: sdkRun,
      [`${base}/actions/artifacts/456`]: sdkArtifact,
    }[url];
    assert.notEqual(data, undefined, String(url));
    return new Response(JSON.stringify(data));
  };
  const result = await acceptancePlan({
    producers: [sdkSelected],
    inputs: ENGINEERING_INPUTS,
    repository,
    fetcher,
  });
  assert.equal(result.matrix.include[0].producer, "engineering-sdk");
  assert.equal(result.matrix.include[0].sourceLockIdentity, ENGINEERING_SOURCE);
  assert.equal(result.matrix.include[0].runner, "macos-15-intel");
  assert.equal(result.nativeAcceptancePerformed, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(calls.length, 4);
  await assert.rejects(
    acceptancePlan({
      producers: [sdkSelected],
      inputs: "native/cef-build-inputs/20261022-registration-retirement",
      repository,
      fetcher,
    }),
    /source inputs differ/,
  );
});
test("native SDK consumption requires an independent completion digest and the identical five verified assets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdk-completion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("{}");
  await writeFile(path.join(root, "runtime.json"), bytes);
  const proof = createSdkCompletion({
    producer: {
      repository,
      repositoryId: 11,
      runId: selected.runId,
      attempt: 2,
      head: selected.headSha,
      branch: "Main",
      workflow: ENGINEERING_WORKFLOW,
    },
    identity: {
      target: ENGINEERING_TARGET,
      source: ENGINEERING_SOURCE,
      producer: "1".repeat(64),
      canonicalRoot: "/Users/runner/work/_temp/sorng-cef-engineering/pinned",
      image: "20260824.0482.1",
      tools: "2".repeat(64),
      graph: "3".repeat(64),
      siso: "4".repeat(64),
    },
    compile: {
      outcome: "compiler-complete",
      exitCode: 0,
      quiescent: true,
      groupId: 123,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: 123, start: "Sat Oct 24 00:00:00 2026" }],
    },
    distributionExitCode: 0,
    checked: {
      descriptor: { target: ENGINEERING_TARGET },
      identity: { sourceLockSha256: ENGINEERING_SOURCE },
      assets: SDK_NAMES.map((name) => ({
        name,
        size: 2,
        sha256: "f".repeat(64),
      })),
    },
  });
  await writeFile(
    path.join(root, "sdk-completion-proof.json"),
    canonical(proof) + "\n",
  );
  const selection = {
    ...sdkSelected,
    descriptorSha256: createHash("sha256").update(bytes).digest("hex"),
    completionSha256: completionSha(proof),
  };
  const checked = {
    descriptor: { target: ENGINEERING_TARGET },
    identity: { sourceLockSha256: ENGINEERING_SOURCE },
    assets: proof.bundleAssets.map((row) => ({
      name: row.name,
      size: row.bytes,
      sha256: row.sha256,
    })),
  };
  const options = {
    bundle: root,
    selection,
    repository,
    expectedLock: ENGINEERING_SOURCE,
    verifier: async () => checked,
  };
  assert.equal(await verifyAcceptanceBundle(options), checked);
  await assert.rejects(
    verifyAcceptanceBundle({
      ...options,
      selection: { ...selection, runAttempt: 1 },
    }),
    /producer\/source mismatch/,
  );
  await assert.rejects(
    verifyAcceptanceBundle({
      ...options,
      verifier: async () => ({
        ...checked,
        assets: checked.assets.map((row, i) =>
          i === 0 ? { ...row, sha256: "e".repeat(64) } : row,
        ),
      }),
    }),
    /actual verified bundle/,
  );
  await writeFile(
    path.join(root, "sdk-completion-proof.json"),
    canonical({
      ...proof,
      compile: { ...proof.compile, outcome: "slice-ended" },
    }) + "\n",
  );
  await assert.rejects(verifyAcceptanceBundle(options), /reviewed bytes/);
});
test("SDK transport authentication ends before native execution and validation supersedes older validation runs", async () => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-runtime-acceptance.yml", "utf8"),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  const steps = workflow.jobs.native.steps;
  const legacy = steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  assert.equal(
    legacy.if,
    "matrix.producer != 'engineering-sdk' && matrix.producer != 'owned-import'",
  );
  const download = steps.find((step) =>
    step.run?.includes("acceptance-ci.mjs download-sdk"),
  );
  assert.equal(download.if, "matrix.producer == 'engineering-sdk'");
  assert.equal(download.env.GH_TOKEN, "${{ github.token }}");
  const native = steps.find((step) =>
    step.name?.startsWith("Build native clients"),
  );
  assert.ok(steps.indexOf(download) < steps.indexOf(native));
  assert.equal(native.env.GH_TOKEN, undefined);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
});

test("draft-backed jobs have write-capable GET transport while ordinary native jobs remain read-only", async () => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-runtime-acceptance.yml", "utf8"),
  );
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(workflow.jobs.plan.permissions, {
    contents: "read",
    actions: "read",
  });
  assert.deepEqual(workflow.jobs.native.permissions, {
    contents: "read",
    actions: "read",
  });
  assert.deepEqual(workflow.jobs["native-draft"].permissions, {
    contents: "write",
    actions: "read",
  });
  assert.deepEqual(
    workflow.jobs["native-draft"].steps,
    workflow.jobs.native.steps,
  );
  for (const job of [workflow.jobs.native, workflow.jobs["native-draft"]]) {
    const execute = job.steps.find((step) =>
      step.name?.startsWith("Build native clients"),
    );
    assert.equal(execute.env.GH_TOKEN, undefined);
    assert.equal(execute.env.GITHUB_TOKEN, undefined);
    assert.match(execute.run, /acceptance-ci\.mjs run/);
    assert.equal(job["timeout-minutes"], 240);
  }
});

test("actual YAML partition preserves every validated row and rejects unsupported or unsafe Draft executions before output", async (t) => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-runtime-acceptance.yml", "utf8"),
  );
  const step = workflow.jobs.plan.steps.at(-1);
  assert.equal(step.id, "partition");
  assert.equal(
    step.env.CEF_VALIDATED_MATRIX,
    "${{ steps.plan.outputs.matrix }}",
  );
  assert.equal(step.env.GH_TOKEN, undefined);
  const source = step.run.match(/<<'NODE'\n([\s\S]*?)\nNODE\s*$/)?.[1];
  assert.ok(source, "execute the actual checked-in workflow JavaScript");
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-draft-partition-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  let sequence = 0;
  const execute = async (matrix, overrides = {}, success = true) => {
    const output = path.join(root, `output-${sequence++}`);
    const env = {
      ...process.env,
      CEF_VALIDATED_MATRIX: JSON.stringify(matrix),
      CEF_DEFAULT_BRANCH: "Main",
      CEF_REPOSITORY_VISIBILITY: "public",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/Main",
      GITHUB_OUTPUT: output,
      ...overrides,
    };
    if (!success) {
      assert.throws(() =>
        execFileSync(process.execPath, ["--input-type=module", "-e", source], {
          env,
          stdio: "pipe",
        }),
      );
      await assert.rejects(readFile(output), { code: "ENOENT" });
      return;
    }
    execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      env,
      stdio: "pipe",
    });
    const rows = Object.fromEntries(
      (await readFile(output, "utf8"))
        .trim()
        .split("\n")
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), JSON.parse(line.slice(at + 1))];
        }),
    );
    assert.equal(rows.has_ordinary, rows.ordinary_matrix.include.length > 0);
    assert.equal(rows.has_draft, rows.draft_matrix.include.length > 0);
    return rows;
  };
  const ordinary = {
    ...selected,
    runner: "macos-15",
    sourceLockIdentity: "d".repeat(64),
    artifactName: "exact-validated-artifact",
  };
  const owned = {
    ...ordinary,
    target: "x86_64-pc-windows-msvc",
    runner: "windows-2025",
    producer: "owned-import",
  };
  const engineering = {
    ...ordinary,
    target: "x86_64-apple-darwin",
    producer: "engineering-sdk",
  };
  for (const include of [
    [ordinary],
    [owned],
    [engineering],
    [ordinary, owned, engineering],
  ]) {
    const result = await execute({ include });
    assert.deepEqual(
      result.ordinary_matrix.include,
      include.filter((row) => !Object.hasOwn(row, "producer")),
    );
    assert.deepEqual(
      result.draft_matrix.include,
      include.filter((row) => Object.hasOwn(row, "producer")),
    );
    assert.equal(
      result.ordinary_matrix.include.length +
        result.draft_matrix.include.length,
      include.length,
    );
  }
  // Legacy reusable callers keep their prior branch behavior; Draft privileges require default branch.
  assert.equal(
    (
      await execute(
        { include: [ordinary] },
        { GITHUB_REF: "refs/heads/review" },
      )
    ).has_ordinary,
    true,
  );
  for (const row of [owned, engineering]) {
    for (const env of [
      { GITHUB_REF: "refs/heads/review" },
      { GITHUB_EVENT_NAME: "push" },
      { CEF_REPOSITORY_VISIBILITY: "private" },
      { CEF_DEFAULT_BRANCH: "" },
    ])
      await execute({ include: [row] }, env, false);
  }
  for (const matrix of [
    { include: [] },
    { include: [ordinary, ordinary] },
    { include: [{ ...ordinary, producer: "unknown" }] },
    { include: [{ ...ordinary, producer: null }] },
    { include: [{ ...ordinary, producer: "" }] },
    { include: [null] },
    { include: [ordinary], other: true },
    { include: "invalid" },
  ])
    await execute(matrix, {}, false);
  for (const [name, flag, matrix] of [
    ["native", "has_ordinary", "ordinary_matrix"],
    ["native-draft", "has_draft", "draft_matrix"],
  ]) {
    assert.equal(
      workflow.jobs[name].if,
      `needs.plan.outputs.${flag} == 'true'`,
    );
    assert.equal(
      workflow.jobs[name].strategy.matrix,
      `\${{ fromJSON(needs.plan.outputs.${matrix}) }}`,
    );
    assert.equal(
      workflow.jobs.plan.outputs[flag],
      `\${{ steps.partition.outputs.${flag} }}`,
    );
  }
});

test("Draft credential ceiling is limited to the exact reusable acceptance caller and downscoped in callee", async () => {
  const caller = YAML.parse(
    await readFile(".github/workflows/cef-patched-runtime.yml", "utf8"),
  );
  const callee = YAML.parse(
    await readFile(".github/workflows/cef-runtime-acceptance.yml", "utf8"),
  );
  assert.equal(caller.permissions.contents, "read");
  assert.deepEqual(caller.jobs["accept-native"].permissions, {
    contents: "write",
    actions: "read",
  });
  assert.equal(
    caller.jobs["accept-native"].uses,
    "./.github/workflows/cef-runtime-acceptance.yml",
  );
  assert.equal(caller.jobs["accept-native"].steps, undefined);
  assert.equal(caller.jobs["accept-native"].secrets, undefined);
  for (const name of ["plan", "native"])
    assert.deepEqual(callee.jobs[name].permissions, {
      contents: "read",
      actions: "read",
    });
  const direct = sealFixture();
  const callerExecution = acceptanceExecution({
    ...direct.env,
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/cef-patched-runtime.yml@refs/heads/Main`,
  });
  assert.equal(callerExecution, null);
});

test("write-capable Draft credentials still cannot mutate through either production download API", async () => {
  const { apiClient } =
    await import("../../scripts/lib/cef-engineering-checkpoint.mjs");
  const { ownedImportApi } =
    await import("../../scripts/lib/cef-owned-sdk-import.mjs");
  let requests = 0;
  const request = async (_url, options) => {
    requests++;
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    return new Response("{}");
  };
  const apis = [
    apiClient(repository, "synthetic-write-capable-credential", request, {
      readOnly: true,
    }),
    ownedImportApi(repository, "synthetic-write-capable-credential", request),
  ];
  for (const api of apis) {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"])
      await assert.rejects(
        api("releases/123", { method, body: { draft: false } }),
      );
    await assert.rejects(
      api("releases/123", { method: "GET", body: { unexpected: true } }),
    );
    await api("releases/123");
  }
  assert.equal(
    requests,
    2,
    "only the two allowed GET requests reached transport",
  );
  const source = await readFile(
    "scripts/cef-runtime-acceptance-ci.mjs",
    "utf8",
  );
  assert.match(
    source,
    /downloadSdkBundle\(\s*apiClient\(repository, token, fetch, \{ readOnly: true \}\)/,
  );
  const child = nativeChildEnvironment(
    {
      PATH: "native-tools",
      GH_TOKEN: "synthetic-write-capable-credential",
      GITHUB_TOKEN: "synthetic-write-capable-credential",
      ACTIONS_RUNTIME_TOKEN: "secret",
    },
    "",
    "/temporary-target",
  );
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN"])
    assert.equal(child[key], undefined);
});

test("ARM engineering SDK plans schedule real native ARM hosts and reject another reviewed target's source", async () => {
  for (const target of ["aarch64-apple-darwin", "aarch64-unknown-linux-gnu"]) {
    const p = checkpointProfile(target),
      row = { ...sdkSelected, target };
    const expectedName = sdkSealName(
      { runId: row.runId, attempt: row.runAttempt },
      target,
    );
    const fetcher = async (url) => {
      const base = `https://api.github.com/repos/${repository}`;
      const data = {
        [base]: {
          id: 11,
          full_name: repository,
          private: false,
          default_branch: "Main",
        },
        [`${base}/actions/workflows/cef-engineering-checkpoint.yml`]: {
          id: 66,
          path: ENGINEERING_WORKFLOW,
        },
        [`${base}/actions/runs/123`]: sdkRun,
        [`${base}/actions/artifacts/456`]: {
          ...sdkArtifact,
          name: expectedName,
        },
      }[url];
      assert.notEqual(data, undefined, String(url));
      return new Response(JSON.stringify(data));
    };
    const result = await acceptancePlan({
      producers: [row],
      inputs: p.inputs,
      repository,
      fetcher,
    });
    const entry = result.matrix.include[0];
    assert.equal(entry.target, target);
    assert.equal(entry.runner, p.acceptanceRunner);
    assert.equal(entry.sourceLockIdentity, p.source);
    assert.equal(NATIVE_TARGETS[target].arch, "arm64");
    assert.equal(result.nativeAcceptancePerformed, false);
    assert.equal(result.publicationAllowed, false);
    await assert.rejects(
      acceptancePlan({
        producers: [row],
        inputs: ENGINEERING_INPUTS,
        repository,
        fetcher,
      }),
    );
    const wrongSeal = async (url) =>
      String(url).endsWith("/artifacts/456")
        ? new Response(JSON.stringify(sdkArtifact))
        : fetcher(url);
    await assert.rejects(
      acceptancePlan({
        producers: [row],
        inputs: p.inputs,
        repository,
        fetcher: wrongSeal,
      }),
      /artifact|seal|identity/i,
    );
  }
});

test("all nine native runs keep their original gates and derive the H2 pin only from the verified source lock", () => {
  for (const patch of ["sorng-tls-v2-682c378-4", "sorng-tls-v2-682c378-5"]) {
    const lock = { bridge: { patchId: patch } };
    const tls = fixtureRunArguments(
      "tls",
      "owned-executable",
      "new-output",
      undefined,
      lock,
    );
    assert.deepEqual(tls, [
      "scripts/cef-browser-acceptance.mjs",
      "run-tls",
      "--executable",
      "owned-executable",
      "--output",
      "new-output",
    ]);
    assert.equal(HTTP2_CHECKS.length + 1, 9);
    for (const check of HTTP2_CHECKS) {
      const args = fixtureRunArguments(
        "http2",
        "owned-executable",
        "new-output",
        check,
        lock,
      );
      assert.deepEqual(args, [
        "scripts/cef-browser-acceptance.mjs",
        "run-http2",
        "--executable",
        "owned-executable",
        "--output",
        "new-output",
        "--check",
        check,
        "--http2-patch-id",
        patch,
      ]);
    }
  }
  for (const pin of [
    undefined,
    "",
    "sorng-tls-v2-682c378-3",
    "sorng-tls-v2-682c378-6",
  ])
    assert.throws(() =>
      fixtureRunArguments("http2", "owned", "new", "multiplex", {
        bridge: { patchId: pin },
      }),
    );
  assert.throws(() =>
    fixtureRunArguments("http2", "owned", "new", "force-quic", {
      bridge: { patchId: "sorng-tls-v2-682c378-5" },
    }),
  );
});

test("Linux native builds replace injected flags with executable-relative CEF RUNPATH only", () => {
  const inherited = {
    PATH: "native-tools",
    RUSTFLAGS: "untrusted",
    CARGO_ENCODED_RUSTFLAGS: "untrusted",
    RUST_ENCODED_RUSTFLAGS: "untrusted",
    LD_LIBRARY_PATH: "/untrusted",
    LD_PRELOAD: "/untrusted/preload.so",
    DYLD_LIBRARY_PATH: "/untrusted",
    GH_TOKEN: "secret",
    CHROME_DEVEL_SANDBOX: "",
  };
  const linux = nativeChildEnvironment(
    inherited,
    "/verified-sdk",
    "/owned-cargo",
    "linux",
  );
  assert.equal(
    linux.CARGO_ENCODED_RUSTFLAGS,
    ["-C", "link-arg=-Wl,-rpath,$ORIGIN"].join("\x1f"),
  );
  for (const name of [
    "RUSTFLAGS",
    "RUST_ENCODED_RUSTFLAGS",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "DYLD_LIBRARY_PATH",
    "GH_TOKEN",
    "CHROME_DEVEL_SANDBOX",
  ])
    assert.equal(linux[name], undefined);
  for (const platform of ["win32", "darwin"]) {
    const unchanged = nativeChildEnvironment(
      inherited,
      "/verified-sdk",
      "/owned-cargo",
      platform,
    );
    assert.deepEqual(unchanged, {
      PATH: "native-tools",
      CEF_PATH: "/verified-sdk",
      CARGO_TARGET_DIR: "/owned-cargo",
      CARGO_BUILD_JOBS: "2",
    });
  }
});

test("Linux sandbox preparation uses only the held-file root helper and a credential-free fixed command", async () => {
  const temp = path.resolve("owned-runner-temp"),
    destination = path.join(temp, "acceptance"),
    stage = path.join(destination, "stage-tls");
  const spec = {
    temp,
    destination,
    stage,
    suite: "tls",
    target: "x86_64-unknown-linux-gnu",
    expected: { size: 64, sha256: "a".repeat(64) },
    before: { uid: 1001n, dev: 88n, ino: 9007199254740999n },
  };
  const command = linuxSandboxCommand(spec);
  assert.equal(command.executable, "/usr/bin/sudo");
  assert.deepEqual(command.args.slice(0, 6), [
    "-n",
    "--",
    "/usr/bin/python3",
    "-I",
    "-B",
    "-c",
  ]);
  assert.equal(command.args[6], LINUX_SANDBOX_HELPER);
  assert.deepEqual(command.args.slice(7), [
    "--configure",
    temp,
    destination,
    "tls",
    "64",
    "a".repeat(64),
    "1001",
    "88",
    "9007199254740999",
    "62",
  ]);
  assert.deepEqual(command.env, {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
  });
  assert.equal(
    linuxSandboxCommand({
      ...spec,
      target: "aarch64-unknown-linux-gnu",
    }).args.at(-1),
    "183",
  );
  for (const changed of [
    { stage: path.join(destination, "foreign") },
    { destination: path.resolve("foreign") },
    { suite: "http3" },
    { target: "unreviewed" },
  ])
    assert.throws(() => linuxSandboxCommand({ ...spec, ...changed }));
  for (const platform of ["win32", "darwin"]) {
    let ran = false;
    await prepareLinuxSandbox({
      platform,
      run: async () => {
        ran = true;
      },
    });
    assert.equal(ran, false);
  }
  const source = await readFile(
    new URL("../../scripts/cef-runtime-acceptance-ci.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const stage = await stageAcceptance({"),
    setup = source.indexOf("await prepareLinuxSandbox({", start),
    firstRun = source.indexOf('for (const check of suite === "tls"', start);
  assert(start >= 0 && setup > start && firstRun > setup);
});

export const linuxSandboxValidationProgram = String.raw`import contextlib,hashlib,io,json,os,pathlib,stat,sys,tempfile
helper=bytes.fromhex(sys.argv[1]).decode('utf8')
rows=[]
for case in ('valid','sha','size','symlink-file','symlink-stage','symlink-ancestor','hardlink','mode','machine','owner','foreign','post-open-replace','content-mutation'):
    with tempfile.TemporaryDirectory(prefix='codex-sandbox-validation-') as temporary:
        root=pathlib.Path(temporary).resolve();output=root/'acceptance';output.mkdir(mode=0o700);stage=output/'stage-tls';stage.mkdir(mode=0o700)
        file=stage/'chrome-sandbox';header=bytearray(64);header[:6]=bytes([127,69,76,70,2,1]);header[18:20]=(62).to_bytes(2,'little');data=bytes(header)
        fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o644 if case=='mode' else 0o755)
        os.write(fd,data);os.close(fd);before=file.stat();expected_sha=hashlib.sha256(data).hexdigest()
        args=['--validate-only',str(root),str(output),'tls',str(len(data)),expected_sha,str(os.getuid()),str(before.st_dev),str(before.st_ino),'62']
        if case=='sha':args[5]='0'*64
        if case=='size':args[4]='65'
        if case=='owner':args[6]=str(os.getuid()+1)
        if case=='machine':args[9]='183'
        if case=='foreign':args[1]=str(root/'elsewhere')
        if case=='hardlink':os.link(file,stage/'another-link')
        if case=='symlink-file':file.rename(stage/'original');file.symlink_to('original')
        if case=='symlink-stage':stage.rename(output/'original-stage');stage.symlink_to('original-stage',target_is_directory=True)
        if case=='symlink-ancestor':
            alias=root/'alias';alias.symlink_to(output,target_is_directory=True);args[2]=str(alias)
        original_open=os.open;original_fstat=os.fstat;original_chown=os.fchown;original_chmod=os.fchmod;calls=0
        def forbidden(*unused):raise RuntimeError('Permission mutation forbidden in validation test')
        def opened(name,*positional,**keyword):
            result=original_open(name,*positional,**keyword)
            if case=='post-open-replace' and name=='chrome-sandbox':
                file.rename(stage/'original-held');replacement=original_open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o755);os.write(replacement,data);os.close(replacement)
            return result
        def fstated(handle):
            global calls
            result=original_fstat(handle)
            if case=='content-mutation' and stat.S_ISREG(result.st_mode):
                calls+=1
                if calls==2:
                    with file.open('r+b') as changed:changed.seek(63);changed.write(b'X')
            return result
        initial_fds=len(os.listdir('/proc/self/fd'))
        os.open=opened;os.fstat=fstated;os.fchown=forbidden;os.fchmod=forbidden
        original_argv=sys.argv;sys.argv=['reviewed-helper',*args];stdout=io.StringIO();status=0
        try:
            with contextlib.redirect_stdout(stdout):
                try:exec(compile(helper,'<reviewed-helper>','exec'),{})
                except SystemExit as e:status=e.code
        finally:
            sys.argv=original_argv;os.open=original_open;os.fstat=original_fstat;os.fchown=original_chown;os.fchmod=original_chmod
        assert len(os.listdir('/proc/self/fd'))==initial_fds,'Descriptor leak'
        proof=json.loads(stdout.getvalue());valid=case=='valid'
        assert (status==0)==valid,(case,proof)
        if valid:
            after=file.stat();assert proof['validationOnly'] and not proof['ready']
            assert (after.st_uid,after.st_gid,stat.S_IMODE(after.st_mode))==(before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode))
        else:assert proof['ready'] is False
        rows.append({'case':case,'exitCode':status,'valid':valid,'permissionsChanged':False,'descriptorsClosed':True})
for case in ('modeled-configure','modeled-chmod-failure','modeled-post-grant-path-swap'):
    from types import SimpleNamespace
    with tempfile.TemporaryDirectory(prefix='codex-sandbox-modeled-') as temporary:
        root=pathlib.Path(temporary).resolve();output=root/'acceptance';output.mkdir(mode=0o700);stage=output/'stage-tls';stage.mkdir(mode=0o700);file=stage/'chrome-sandbox'
        data=bytearray(64);data[:6]=bytes([127,69,76,70,2,1]);data[18:20]=(62).to_bytes(2,'little');data=bytes(data)
        fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o755);os.write(fd,data);os.close(fd);before=file.stat()
        uid=os.getuid() or 1001;model={'uid':uid,'gid':before.st_gid,'mode':0o755};operations=[]
        original_fstat=os.fstat;original_chown=os.fchown;original_chmod=os.fchmod;original_geteuid=os.geteuid;sudo_uid=os.environ.get('SUDO_UID')
        def modeled_stat(fd):
            s=original_fstat(fd);fields={key:getattr(s,key) for key in ('st_mode','st_uid','st_gid','st_size','st_nlink','st_dev','st_ino','st_mtime_ns')}
            fields['st_uid']=uid
            if stat.S_ISREG(s.st_mode):fields.update(st_uid=model['uid'],st_gid=model['gid'],st_mode=stat.S_IFREG|model['mode'])
            return SimpleNamespace(**fields)
        def modeled_chown(fd,owner,group):
            assert stat.S_ISREG(original_fstat(fd).st_mode);operations.append(['fchown',owner,group]);model.update(uid=owner,gid=group)
        def modeled_chmod(fd,mode):
            assert stat.S_ISREG(original_fstat(fd).st_mode);operations.append(['fchmod',mode])
            if case=='modeled-chmod-failure' and mode==0o4755:raise RuntimeError('Modeled chmod denial')
            model['mode']=mode
            if case=='modeled-post-grant-path-swap' and mode==0o4755:
                file.rename(stage/'held-original');replacement=os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o755);os.write(replacement,data);os.close(replacement)
        args=['--configure',str(root),str(output),'tls',str(len(data)),hashlib.sha256(data).hexdigest(),str(uid),str(before.st_dev),str(before.st_ino),'62']
        initial_fds=len(os.listdir('/proc/self/fd'));original_argv=sys.argv;sys.argv=['reviewed-helper',*args];stdout=io.StringIO();status=0
        os.fstat=modeled_stat;os.fchown=modeled_chown;os.fchmod=modeled_chmod;os.geteuid=lambda:0;os.environ['SUDO_UID']=str(uid)
        try:
            with contextlib.redirect_stdout(stdout):
                try:exec(compile(helper,'<reviewed-helper>','exec'),{})
                except SystemExit as e:status=e.code
        finally:
            sys.argv=original_argv;os.fstat=original_fstat;os.fchown=original_chown;os.fchmod=original_chmod;os.geteuid=original_geteuid
            if sudo_uid is None:os.environ.pop('SUDO_UID',None)
            else:os.environ['SUDO_UID']=sudo_uid
        assert len(os.listdir('/proc/self/fd'))==initial_fds,'Modeled descriptor leak'
        proof=json.loads(stdout.getvalue());valid=case=='modeled-configure'
        assert (status==0)==valid,(case,proof)
        assert operations[:2]==[['fchown',0,0],['fchmod',0o4755]]
        if valid:assert proof['ready'] and not proof['validationOnly']
        else:assert proof['privilegeRevoked'] and operations[2:]==[['fchmod',0o755],['fchown',uid,before.st_gid]]
        for current in stage.iterdir():
            s=current.stat();assert (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(before.st_uid,before.st_gid,0o755)
        rows.append({'case':case,'exitCode':status,'valid':valid,'permissionsChanged':False,'descriptorsClosed':True,'privilegedOperationsModeledOnly':operations})
print(json.dumps({'cases':rows,'payloadExecuted':False,'privilegedMutationInvoked':False,'uid':os.getuid()}))
`;

test(
  "actual Linux helper validate-only rejects unsafe files and never changes ownership or permissions",
  { skip: process.platform !== "linux" },
  () => {
    const result = JSON.parse(
      execFileSync(
        "/usr/bin/python3",
        [
          "-I",
          "-B",
          "-c",
          linuxSandboxValidationProgram,
          Buffer.from(LINUX_SANDBOX_HELPER).toString("hex"),
        ],
        { encoding: "utf8", timeout: 15000, env: { LANG: "C.UTF-8" } },
      ),
    );
    assert.equal(result.cases.length, 16);
    assert.equal(result.cases.filter((c) => c.valid).length, 2);
    assert(
      result.cases.every(
        (c) => c.permissionsChanged === false && c.descriptorsClosed,
      ),
    );
    assert.equal(result.privilegedMutationInvoked, false);
  },
);

test(
  "real Linux ELF client and helper find only their packaged library from a foreign cwd",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "cef-native-loader-")),
    );
    t.after(async () => {
      assert.equal(await realpath(root), root);
      await rm(root, { recursive: true, force: true });
    });
    const bundle = path.join(root, "bundle"),
      foreign = path.join(root, "foreign");
    await mkdir(bundle);
    await mkdir(foreign);
    await writeFile(
      path.join(root, "library.c"),
      "int owned_loader_value(void) { return 37; }\n",
    );
    await writeFile(
      path.join(root, "main.c"),
      "extern int owned_loader_value(void); int main(void) { return owned_loader_value() == 37 ? 0 : 23; }\n",
    );
    const env = nativeChildEnvironment(process.env, "", "", "linux");
    const run = (command, args, cwd = foreign) =>
      execFileSync(command, args, { cwd, env, timeout: 30000, stdio: "pipe" });
    run("cc", [
      "-shared",
      "-fPIC",
      path.join(root, "library.c"),
      "-Wl,-soname,libownedcefprobe.so",
      "-o",
      path.join(bundle, "libownedcefprobe.so"),
    ]);
    const common = [
      path.join(root, "main.c"),
      "-L" + bundle,
      "-lownedcefprobe",
    ];
    const old = path.join(bundle, "old-client");
    run("cc", [...common, "-o", old]);
    assert.throws(
      () => run(old, []),
      (error) =>
        error.status === 127 &&
        error.stderr.toString().includes("libownedcefprobe.so"),
    );
    const flags = env.CARGO_ENCODED_RUSTFLAGS.split("\x1f");
    assert.deepEqual(flags, ["-C", "link-arg=-Wl,-rpath,$ORIGIN"]);
    for (const name of ["client", "helper"]) {
      const executable = path.join(bundle, name);
      run("cc", [
        ...common,
        flags[1].slice("link-arg=".length),
        "-o",
        executable,
      ]);
      assert.match(
        run("readelf", ["-d", executable]).toString(),
        /\((?:RUNPATH|RPATH)\).*\[\$ORIGIN\]/,
      );
      run(executable, []);
    }
    assert.equal(env.LD_LIBRARY_PATH, undefined);
  },
);
