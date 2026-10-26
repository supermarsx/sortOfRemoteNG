import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  authority,
  clock,
  admitDownload,
  errorCode,
  execute,
  ENTRY,
  BRANCH,
  REPOSITORY,
  WORKFLOW,
} from "../../native/linux-h2-final-close-proof/observe.mjs";

function fixture(inputs = {}) {
  const ref = `refs/heads/${BRANCH}`,
    head = "a".repeat(40);
  return {
    env: {
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_REPOSITORY_ID: "1010282954",
      CEF_DEFAULT_BRANCH: "main",
      GITHUB_REPOSITORY_VISIBILITY: "public",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: ref,
      GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOW}@${ref}`,
      GITHUB_SHA: head,
      GITHUB_WORKFLOW_SHA: head,
      GITHUB_RUN_ID: "777",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_EVENT_PATH: "/owned-event.json",
      RUNNER_TEMP: "/owned-temp",
    },
    event: {
      repository: {
        id: 1010282954,
        full_name: REPOSITORY,
        private: false,
        visibility: "public",
        default_branch: "main",
      },
      ref,
      inputs,
    },
  };
}
test("exact branch authority handles registered false defaults and genuine null without new inputs", () => {
  for (const inputs of [
    {},
    null,
    { metal_tools: false },
    { metal_tools: "false" },
  ]) {
    const { env, event } = fixture(inputs);
    assert.equal(authority(env, event).head, env.GITHUB_SHA);
  }
  const mutations = [
    (f) => delete f.event.inputs,
    (f) => (f.event.inputs = []),
    (f) => (f.event.inputs = ""),
    (f) => (f.event.inputs = { metal_tools: true }),
    (f) => (f.event.inputs = { metal_tools: "true" }),
    (f) => (f.event.inputs = { target: ENTRY.target }),
    (f) => (f.event.inputs = { metal_tools: false, extra: "" }),
    (f) => (f.env.GITHUB_REF = "refs/heads/main"),
    (f) => (f.event.ref = "main"),
    (f) => (f.env.GITHUB_WORKFLOW_SHA = "b".repeat(40)),
    (f) => (f.env.GITHUB_WORKFLOW_REF += "/other"),
    (f) => (f.env.GITHUB_REPOSITORY_ID = "1"),
    (f) => (f.env.GITHUB_REPOSITORY = "foreign/repo"),
    (f) => f.event.repository.id++,
    (f) => (f.event.repository.private = true),
    (f) => (f.event.repository.visibility = "private"),
    (f) => (f.event.repository.default_branch = "other"),
    (f) => (f.env.CEF_DEFAULT_BRANCH = "other"),
    (f) => (f.env.GITHUB_EVENT_NAME = "push"),
    (f) => (f.env.GITHUB_RUN_ID = "0"),
    (f) => (f.env.GITHUB_RUN_ATTEMPT = "1.5"),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => authority(f.env, f.event));
  }
});
test("one original wall and machine-monotonic budget floors down and reserves cleanup inside190 minutes", () => {
  const total = 190 * 60000,
    context = { wallStart: 1000, monoStart: "1000000" };
  let wall = 1000,
    mono = 1000000n;
  const remaining = clock(
    context,
    () => wall,
    () => mono,
  );
  assert.equal(remaining(3600000), 3600000);
  wall = 500;
  mono += 11000000000000n;
  assert.equal(remaining(total), total - 11000000 - 5000);
  wall = context.wallStart + total - 10000;
  mono = 1000000n;
  assert.equal(remaining(total), 5000);
  wall += 0.25;
  assert.equal(remaining(total), 4999);
  wall += 5000;
  assert.throws(() => remaining(1), /CLOSE_DEADLINE/);
  assert.throws(() => clock({ wallStart: 0.5, monoStart: "1" }), /CLOSE_CLOCK/);
  const late = clock(
    { wallStart: 0, monoStart: "0" },
    () => 150 * 60000,
    () => 150n * 60000n * 1000000n,
  );
  assert.throws(() => admitDownload(late), /CLOSE_DOWNLOAD_BUDGET/);
  assert.doesNotThrow(() => admitDownload((cap) => cap));
});
test("error metadata is closed and never copies raw private messages", () => {
  assert.equal(
    errorCode({ code: "COMMAND_EXIT_FAILED", message: "secret" }),
    "COMMAND_EXIT_FAILED",
  );
  for (const value of [
    null,
    false,
    { code: "SECRET_TOKEN" },
    { code: "COMMAND_URL\nprivate" },
  ])
    assert.equal(errorCode(value), "CLOSE_PHASE_FAILED");
});

// Execute the unchanged actual orchestrator with injected filesystem/API/command
// boundaries. No process, network, SDK or native fixture runs in these tests.
function harness({
  commandFailure,
  postFailure,
  reportFailure,
  cleanupGone = true,
} = {}) {
  const { env, event } = fixture(),
    identity = authority(env, event),
    source = [{ fixed: true }],
    calls = [],
    writes = new Map();
  const output = path.join("/owned-temp", "h2-final-close-proof-777-1");
  const context = {
    ...identity,
    wallStart: 1,
    monoStart: "1",
    selection: ENTRY,
    source,
    codeIdentity: { fixed: true },
  };
  const descriptor = {
    manifest: { path: "manifest.json" },
    archive: { path: "runtime.tar.gz" },
    sdk: { archiveRoot: "cef" },
  };
  const prepared = {
    sdk: `${output}/prepared-sdk`,
    customRuntime: { sdkFiles: Array.from({ length: 939 }, () => ({})) },
  };
  const dependencies = {
    assert,
    authority,
    json: async (file) => {
      if (file === env.GITHUB_EVENT_PATH) return event;
      if (file.endsWith("context.json")) return context;
      if (file.endsWith("manifest.json")) return {};
      if (file.endsWith("acceptance.json"))
        return { ok: true, nativeHttp2FixtureAccepted: true };
      if (file.endsWith(".cleanup.json")) return { groupGone: cleanupGone };
      throw Error("unexpected fixed read");
    },
    process: { platform: "linux", arch: "x64", execPath: "/fixed/node" },
    realpath: async (p) => p,
    lstat: async () => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }),
    path,
    clock: () => (cap) => cap,
    admitDownload,
    pins: async () => source,
    ENTRY,
    REPOSITORY,
    ROOT: "/source",
    acceptanceCodeIdentity: () => ({ fixed: true }),
    mkdir: async () => {},
    exclusive: async (file, value) => {
      if (reportFailure && file.endsWith("result.json")) throw reportFailure;
      writes.set(file, structuredClone(value));
    },
    errorCode,
    downloadOwnedSdk: async () => {},
    runAcceptanceCommand: async (exe, args, options) => {
      calls.push({ exe, args, options });
      if (commandFailure && options.log.endsWith("permission-churn.log"))
        throw commandFailure;
    },
    verifyAcceptanceBundle: async () => ({ descriptor }),
    verifiedAcceptanceSourceLock: async () => ({
      bridge: { patchId: "sorng-tls-v2-682c378-5" },
    }),
    nativeChildEnvironment: (_env, sdk, cargo) => ({
      CEF_PATH: sdk,
      CARGO_TARGET_DIR: cargo,
    }),
    RELEASE_LIMITS: { expanded: 32 * 1024 ** 3, members: 50000 },
    prepareCustomRuntime: async () => prepared,
    verifyPreparedCustomRuntime: async () => {
      calls.push({ postcheck: true });
      if (postFailure) throw postFailure;
    },
    fixtureClientBuild: (_target, suite) => {
      assert.equal(suite, "http2");
      return { client: "http2-client", args: ["fixed-http2-build"] };
    },
    stageAcceptance: async (options) => {
      calls.push({ stage: options });
      return { executable: `${output}/stage-http2/client` };
    },
    prepareLinuxSandbox: async (options) =>
      options.run("/fixed/sudo", ["fixed-sandbox"], {
        env: {},
        timeout: 30000,
      }),
    fixtureRunArguments: (suite, exe, destination, check) => {
      assert.equal(suite, "http2");
      assert.equal(check, "permission-churn");
      return ["fixed-http2-case", exe, destination, check];
    },
  };
  const run = new Function(
    ...Object.keys(dependencies),
    `return (${execute.toString()});`,
  )(...Object.values(dependencies));
  return { env, run, calls, writes, output };
}
test("actual orchestrator invokes exactly one H2 consumer plus helper and one case, then source/SDK postchecks", async () => {
  const h = harness();
  const result = await h.run("run", h.env);
  assert.equal(result.ok, true);
  assert.equal(result.fullNativeAcceptance, false);
  assert.equal(result.publicationAllowed, false);
  const commands = h.calls.filter((row) => row.exe);
  assert.deepEqual(
    commands.map((row) => path.basename(row.options.log)),
    [
      "extract.log",
      "build-helper.log",
      "build-http2.log",
      "sandbox-http2.log",
      "permission-churn.log",
    ],
  );
  assert.equal(commands[0].options.timeout, 1800000);
  assert.equal(commands.at(-1).options.timeout, 660000);
  assert(
    commands[1].args.includes("--locked") && commands[1].args.includes("-j2"),
  );
  assert.equal(h.calls.filter((row) => row.stage).length, 1);
  assert.equal(h.calls.filter((row) => row.postcheck).length, 1);
  assert(![...h.writes.keys()].some((file) => file.endsWith("seal.json")));
});
test("actual failed native command keeps partial first stage and still performs postchecks without another case", async () => {
  const original = Object.assign(Error("private original"), {
      code: "COMMAND_EXIT_FAILED",
    }),
    h = harness({ commandFailure: original });
  await assert.rejects(h.run("run", h.env), (error) => error === original);
  const result = h.writes.get(path.join(h.output, "result.json"));
  assert.equal(result.firstFailure.stage, "permission-churn");
  assert.equal(result.firstFailure.code, "COMMAND_EXIT_FAILED");
  assert.equal(result.ok, false);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(result.sourceSdkPostVerified, true);
  assert.equal(
    h.calls.filter(
      (row) => row.exe && row.options.log.endsWith("permission-churn.log"),
    ).length,
    1,
  );
});
test("actual first failure survives secondary postcheck and retention faults; unknown cleanup denies", async () => {
  const first = Object.assign(Error("first"), { code: "COMMAND_EXIT_FAILED" });
  const h = harness({
    commandFailure: first,
    postFailure: Error("secondary"),
    reportFailure: Error("retention"),
  });
  await assert.rejects(h.run("run", h.env), (error) => error === first);
  const unknown = harness({ cleanupGone: false });
  await assert.rejects(unknown.run("run", unknown.env), /CLOSE_CLEANUP/);
  assert.equal(
    unknown.writes.get(path.join(unknown.output, "result.json"))
      .cleanupConfirmed,
    false,
  );
});
test("actual download boundary preserves falsy primary failures without logging token or private values", async () => {
  for (const first of [
    null,
    false,
    Object.assign(Error("private message"), { code: "COMMAND_EXIT_FAILED" }),
  ]) {
    const h = harness();
    let rejected = false,
      actual;
    try {
      await h.run(
        "download",
        { ...h.env, GH_TOKEN: "fixed synthetic secret" },
        {
          download: async () => {
            throw first;
          },
        },
      );
    } catch (error) {
      rejected = true;
      actual = error;
    }
    assert(rejected);
    assert.equal(actual, first);
    const report = h.writes.get(path.join(h.output, "download.json"));
    assert.equal(report.ok, false);
    assert(!JSON.stringify(report).includes("private message"));
    assert(!JSON.stringify(report).includes("fixed synthetic secret"));
  }
});
test("registered carrier is branch-only, pinned, budgeted, token-isolated and retains no SDK/binary payloads", async () => {
  const raw = (
      await readFile(new URL(`../../${WORKFLOW}`, import.meta.url), "utf8")
    ).replaceAll("\r\n", "\n"),
    wf = YAML.parse(raw);
  assert.equal(wf.concurrency["cancel-in-progress"], true);
  assert.equal(wf.on.workflow_dispatch.inputs.metal_tools.default, false);
  const job = wf.jobs.proof;
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 240);
  assert(
    job.if.includes(`refs/heads/${BRANCH}`) &&
      job.if.includes("default_branch == 'main'"),
  );
  const tokenSteps = job.steps.filter((step) => step.env?.GH_TOKEN);
  assert.equal(tokenSteps.length, 1);
  assert(tokenSteps[0].run.endsWith(" download"));
  assert(
    job.steps
      .find((step) => step.run?.includes("xvfb-run"))
      .run.includes(" -nolisten tcp"),
  );
  const artifact = job.steps.at(-1);
  assert.equal(artifact.with["include-hidden-files"], true);
  assert(
    !/\/(?:bundle|prepared-sdk|cargo|extracted|stage-http2)\//.test(
      artifact.with.path,
    ),
  );
  assert(!artifact.with.path.includes("seal.json"));
  assert(artifact.with.path.includes("/http2-permission-churn/**"));
  assert.equal(ENTRY.runId, 40405703996);
  assert.equal(ENTRY.artifactId, 12690886375);
});
