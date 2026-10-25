import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import YAML from "yaml";

const read = (file) =>
  readFile(new URL(`../../${file}`, import.meta.url), "utf8");
const workflow = YAML.parse(
  await read(".github/workflows/cef-sdk-layout-probe.yml"),
);
const job = workflow.jobs.probe;

test("SDK layout diagnostics require an explicit public default-branch run", () => {
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.metal_tools, {
    description:
      "Observe selected Apple Metal commands; permits the existing fixed missing-component download",
    type: "boolean",
    required: false,
    default: false,
  });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(Object.keys(workflow.jobs).join(), "probe");
  assert.equal(
    job.if,
    "github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch) && github.event.repository.visibility == 'public'",
  );
  assert.equal(job.permissions, undefined);
  assert.equal(job["runs-on"], "macos-15-intel");
  assert.equal(job["timeout-minutes"], "${{ inputs.metal_tools && 15 || 10 }}");
  assert.deepEqual(workflow.concurrency, {
    group: "cef-sdk-layout-probe-${{ github.ref }}",
    "cancel-in-progress": true,
  });
  assert.deepEqual(workflow.defaults.run, { shell: "bash" });
});

test("SDK layout diagnostics run only fixed provisioning and the non-build probe", () => {
  const commands = job.steps
    .filter(
      (step) => step.run && step.name !== "Diagnose selected Apple Metal tools",
    )
    .map((step) => step.run);
  assert.deepEqual(commands, [
    'node scripts/cef-hosted-provision.mjs --target x86_64-apple-darwin --output "$RUNNER_TEMP/cef-sdk-probe-prerequisites" --execute',
    'node scripts/cef-engineering-checkpoint.mjs probe-sdk 2>&1 | tee "$RUNNER_TEMP/cef-sdk-layout-probe.log"',
  ]);
  assert.deepEqual(job.env, {
    CEF_DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
    GITHUB_REPOSITORY_VISIBILITY: "${{ github.event.repository.visibility }}",
    SORNG_CEF_TOOLS_ROOT: "/",
  });
  for (const step of job.steps)
    if (step.name !== "Diagnose selected Apple Metal tools")
      assert.equal(step.env, undefined);
  const metal = job.steps.find(
    (step) => step.name === "Diagnose selected Apple Metal tools",
  );
  assert.equal(metal.if, "inputs.metal_tools == true");
  assert.deepEqual(metal.env, {
    METAL_TOOLS_ENABLED: "${{ inputs.metal_tools }}",
  });
  assert.equal(job.environment, undefined);
  assert.equal(job.container, undefined);
  assert.equal(job.services, undefined);
});

test("SDK layout diagnostics use pinned actions without persisted credentials", () => {
  assert.deepEqual(
    job.steps.filter((step) => step.uses).map((step) => step.uses),
    [
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
    ],
  );
  assert.deepEqual(job.steps[0].with, { "persist-credentials": false });
  assert.deepEqual(job.steps[1].with, {
    "node-version-file": ".node-version",
    "package-manager-cache": false,
  });
});

test("SDK diagnostic retention preserves failure output without a runtime seal", () => {
  const retention = job.steps.at(-1);
  assert.equal(retention.if, "always()");
  assert.deepEqual(retention.with, {
    name: "cef-sdk-layout-probe-${{ github.run_id }}-${{ github.run_attempt }}",
    path: "${{ runner.temp }}/cef-sdk-layout-probe.log\n${{ runner.temp }}/cef-sdk-probe-prerequisites\n${{ runner.temp }}/cef-metal-tools-probe\n",
    "retention-days": 14,
    "if-no-files-found": "warn",
  });
  assert.equal(job.outputs, undefined);
});

test("the existing native tooling cohort includes the SDK probe workflow guard", async () => {
  const ci = YAML.parse(await read(".github/workflows/ci.yml"));
  const steps = Object.values(ci.jobs).flatMap((entry) => entry.steps ?? []);
  const run = steps.find((step) =>
    step.run?.includes("tests/tooling/cefEngineeringCheckpoint.node-test.mjs"),
  )?.run;
  assert.ok(run);
  assert.equal(
    run
      .split(/\s+/)
      .filter(
        (word) =>
          word === "tests/tooling/cefSdkLayoutProbeWorkflow.node-test.mjs",
      ).length,
    1,
  );
});
import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readFile as readActual,
  rm,
  open,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { identitySha256 } from "../../scripts/lib/browser-custom-runtime.mjs";
import { prepareMacMetalToolchain } from "../../scripts/cef-hosted-provision.mjs";
import {
  sdkProbeAuthority,
  checkpointHost,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";

const metalStep = job.steps.find(
  (step) => step.name === "Diagnose selected Apple Metal tools",
);
const metalBody = metalStep.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const functionsBody = metalBody.slice(
  metalBody.indexOf("function metalCommandStage"),
  metalBody.indexOf("async function runMetalDiagnostic"),
);
function observer() {
  const context = vm.createContext({ path, Buffer, performance });
  new vm.Script(
    functionsBody + "\nglobalThis.observeMetalExec=observeMetalExec;",
  ).runInContext(context);
  return context.observeMetalExec;
}
const findMetal = ["--sdk", "macosx", "--find", "metal"];

test("Metal command observation preserves actual result/error identity and bounds private raw output without argv/env/error dumps", async () => {
  const observe = observer(),
    saved = [],
    result = { stdout: "original stdout", stderr: "original stderr" },
    options = {
      timeout: 30000,
      env: { SECRET: "private-environment" },
      maxBuffer: 65536,
    };
  const exec = observe(
    async (exe, args, opts) => {
      assert.equal(exe, "/usr/bin/xcrun");
      assert.equal(args, findMetal);
      assert.equal(opts, options);
      return result;
    },
    async (row, out, err) => saved.push({ row, out, err }),
  );
  assert.equal(await exec("/usr/bin/xcrun", findMetal, options), result);
  assert.equal(saved[0].row.stage, "find-metal");
  assert.equal(saved[0].out.toString(), result.stdout);
  assert.equal(saved[0].err.toString(), result.stderr);
  const failure = Object.assign(
    new Error("private arbitrary error path and token"),
    {
      code: 7,
      signal: "SIGKILL",
      stdout: Buffer.alloc(70000, 65),
      stderr: Buffer.alloc(70001, 66),
    },
  );
  const failing = observe(
    async () => {
      throw failure;
    },
    async (row, out, err) => saved.push({ row, out, err }),
  );
  await assert.rejects(
    failing("/usr/bin/xcrun", findMetal, options),
    (e) => e === failure,
  );
  const row = saved[1];
  assert.equal(row.out.length, 65536);
  assert.equal(row.err.length, 65536);
  assert.equal(row.row.exit, 7);
  assert.equal(row.row.signal, "SIGKILL");
  assert.equal(row.row.stdoutTruncated, true);
  assert.equal(row.row.stderrObservedBytes, 70001);
  assert.doesNotMatch(
    JSON.stringify(saved.map((x) => x.row)),
    /private|SECRET|environment|arbitrary|args|stderr.*BBBB/,
  );
  await assert.rejects(
    observe(
      async () => {
        throw failure;
      },
      async () => {
        throw Error("log failed");
      },
    )("/usr/bin/xcrun", findMetal, options),
    (e) => e === failure,
  );
  await assert.rejects(
    observe(
      async () => result,
      async () => {
        throw Error("private log path");
      },
    )("/usr/bin/xcrun", findMetal, options),
    /METAL_DIAGNOSTIC_PERSIST_FAILED/,
  );
  let rejected = false;
  try {
    await observe(
      async () => {
        throw null;
      },
      async () => {},
    )("/usr/bin/xcrun", findMetal, options);
  } catch (e) {
    rejected = true;
    assert.equal(e, null);
  }
  assert.equal(rejected, true);
});

test("Metal observer denies unknown command vectors and bounds attempts before executing later commands", async () => {
  const observe = observer();
  let calls = 0;
  const exec = observe(
    async () => {
      calls++;
      return {};
    },
    async () => {},
  );
  for (const [exe, args] of [
    ["/bin/sh", ["private shell"]],
    ["/usr/bin/xcrun", ["--sdk", "macosx", "metallib", "--version"]],
    ["/usr/bin/xcodebuild", ["-downloadAllPlatforms"]],
  ])
    await assert.rejects(
      exec(exe, args, { timeout: 30000 }),
      /METAL_DIAGNOSTIC_COMMAND_DENIED/,
    );
  assert.equal(calls, 0);
  for (let i = 0; i < 32; i++)
    await exec("/usr/bin/xcrun", findMetal, { timeout: 30000 });
  await assert.rejects(
    exec("/usr/bin/xcrun", findMetal, { timeout: 30000 }),
    /METAL_DIAGNOSTIC_COMMAND_BOUND/,
  );
  assert.equal(calls, 32);
});

function helperFixture(kind) {
  const records = [],
    outputs = [];
  let downloaded = false;
  const selected = {
    DEVELOPER_DIR: "/Applications/Xcode_26.3.app/Contents/Developer",
    SDKROOT:
      "/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
  };
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    HOME: "/Users/runner",
    TMPDIR: "/private/tmp",
    GH_TOKEN: "private-env",
  };
  const execute = async (exe, args, options) => {
    assert.equal(options.env.GH_TOKEN, undefined);
    if (exe === "/usr/bin/xcodebuild") {
      assert.deepEqual(args, ["-downloadComponent", "MetalToolchain"]);
      downloaded = true;
      return {};
    }
    if (exe === "/usr/bin/codesign") {
      if (kind === "signature")
        throw Object.assign(new Error("private exception body"), {
          code: 1,
          stderr: "original Apple signature failure",
        });
      return {};
    }
    if (args.includes("--find"))
      return {
        stdout: `/private/var/Apple/Metal.xctoolchain/usr/bin/${args.at(-1)}`,
      };
    if (kind === "missing" && !downloaded)
      throw Object.assign(new Error("private"), {
        code: 1,
        stderr: "missing Metal Toolchain",
      });
    return { stdout: "Apple metal version 32023.104\n" };
  };
  const dependencies = {
    exec: observer()(execute, async (row, out, err) => {
      records.push(row);
      outputs.push({ out, err });
    }),
    realpath: async (value) => value,
    measure: async (file) => ({
      physicalPath: file,
      bytes: 16,
      sha256: "a".repeat(64),
    }),
    now: () => 0,
  };
  return { records, outputs, selected, env, dependencies };
}

test("existing Metal helper still downloads only typed missing and preserves signature failure with the diagnostic wrapper", async () => {
  const f = helperFixture("missing"),
    result = await prepareMacMetalToolchain(
      {
        selected: f.selected,
        env: f.env,
        platform: "darwin",
        allowDownload: true,
        remainingMilliseconds: () => 600000,
      },
      f.dependencies,
    );
  assert.equal(result.downloaded, true);
  assert.equal(
    f.records.filter((x) => x.stage === "download-component").length,
    1,
  );
  assert.equal(result.componentResourceClosureVerified, false);
  assert.equal(result.nativeCompatibilityVerified, false);
  const g = helperFixture("signature");
  await assert.rejects(
    prepareMacMetalToolchain(
      {
        selected: g.selected,
        env: g.env,
        platform: "darwin",
        allowDownload: true,
        remainingMilliseconds: () => 600000,
      },
      g.dependencies,
    ),
    /MAC_METAL_COMMAND_FAILED/,
  );
  assert.equal(g.records.at(-1).stage, "verify-metal-signature");
  assert.equal(g.records.at(-1).exit, 1);
  assert.equal(
    g.outputs.at(-1).err.toString(),
    "original Apple signature failure",
  );
  assert.equal(
    g.records.some((x) => x.stage === "download-component"),
    false,
  );
});

async function pipelineFixture(t) {
  const temporary = await realpath(os.tmpdir()),
    root = await realpath(
      await mkdtemp(path.join(temporary, "metal-diagnostic-source-")),
    );
  t.after(async () => {
    assert.equal(path.dirname(root), temporary);
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  const inputs = path.join(root, "inputs");
  await mkdir(inputs);
  const namespace =
    "native/cef-build-inputs/20261024-registration-retirement-lf-macintel-sdk26-2-capture-compat/";
  const lock = JSON.parse(await read(namespace + "source-lock.json"));
  const build = lock.builds.find((row) => row.target === "x86_64-apple-darwin");
  const tools = Buffer.from(await read(namespace + build.toolchainLock.path));
  const mapBytes = await read(
    namespace + "cef-ci-runner-x86_64-apple-darwin.json",
  );
  await mkdir(path.dirname(path.join(inputs, build.toolchainLock.path)), {
    recursive: true,
  });
  await writeFile(path.join(inputs, build.toolchainLock.path), tools);
  await writeFile(
    path.join(inputs, "cef-ci-runner-x86_64-apple-darwin.json"),
    mapBytes,
  );
  const env = {
    RUNNER_TEMP: root,
    SORNG_CEF_TOOLS_ROOT: "/",
    METAL_TOOLS_ENABLED: "true",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_REPOSITORY_ID: "1",
    GITHUB_RUN_ID: "2",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-sdk-layout-probe.yml@refs/heads/main",
  };
  const calls = [];
  let closed = false;
  const api = {
    ...Object.fromEntries(
      ["mkdir", "writeFile"].map((name) => [name, { mkdir, writeFile }[name]]),
    ),
    path,
    Buffer,
    performance,
    createHash,
    identitySha256,
    process: { env, platform: "darwin", arch: "x64", cwd: () => root },
    console: { error() {} },
    sdkProbeAuthority,
    checkpointHost,
    realpath: async (value) => (value === "/" ? "/" : realpath(value)),
    readFile: readActual,
    open: async (...args) => {
      const file = await open(...args);
      return {
        writeFile: (...values) => file.writeFile(...values),
        close: async () => {
          closed = true;
          await file.close();
        },
      };
    },
    plan: async (options) => {
      calls.push("plan");
      assert.equal(options.runnerMode, "hosted");
      assert.equal(options.target, "x86_64-apple-darwin");
      return { inputsRoot: inputs, sourceLock: lock };
    },
    validateRunnerMap: (value, target) => {
      calls.push("map");
      assert.equal(value.target, target);
      return value;
    },
    verifyToolchainFiles: async (options) => {
      calls.push("pins");
      assert.equal(options.runnerMapFromInputs, true);
      return { filesVerified: JSON.parse(tools).files.length };
    },
    buildEnvironment: () => ({
      DEVELOPER_DIR: "/Applications/Xcode_26.3.app/Contents/Developer",
      SDKROOT:
        "/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
    }),
    promisify: (fn) => fn,
    execFile: async () => ({ stdout: "", stderr: "" }),
    prepareMacMetalToolchain: async (options) => {
      calls.push("metal");
      assert.equal(options.allowDownload, true);
      assert.equal(
        options.selected.DEVELOPER_DIR,
        "/Applications/Xcode_26.3.app/Contents/Developer",
      );
      assert.ok(options.remainingMilliseconds() <= 600000);
      return { downloaded: false };
    },
    macMetalFingerprint: () => ({
      provenance: "newly-observed-apple-component-not-prepinned",
      tools: [],
    }),
  };
  const stripped = metalBody.replace(/^import .*;\r?$/gm, "");
  const script =
    stripped.slice(
      0,
      stripped.lastIndexOf("try { await runMetalDiagnostic(); }"),
    ) + "\nglobalThis.run=runMetalDiagnostic;";
  return { root, env, calls, api, closed: () => closed, script };
}

test("actual opt-in body verifies selected tool map and pins before invoking existing helper, without source acquisition", async (t) => {
  const f = await pipelineFixture(t),
    context = vm.createContext(f.api);
  new vm.Script(f.script).runInContext(context);
  await context.run();
  assert.deepEqual(f.calls, ["plan", "map", "pins", "metal"]);
  assert.equal(f.closed(), true);
  const outcome = JSON.parse(
    await readActual(path.join(f.root, "cef-metal-tools-probe/outcome.json")),
  );
  assert.equal(outcome.result, "success");
  assert.equal(outcome.chromiumAcquisition, false);
  assert.equal(outcome.nativeAcceptance, false);
  assert.doesNotMatch(
    JSON.stringify(outcome),
    /DEVELOPER_DIR|SDKROOT|\/Applications|GITHUB|TOKEN/,
  );
});

test("actual opt-in body preserves unknown early failure, closes logs, and denies implicit execution", async (t) => {
  const f = await pipelineFixture(t),
    marker = new Error("MAC_METAL_PRIVATE_SECRET");
  f.api.verifyToolchainFiles = async () => {
    f.calls.push("pins");
    throw marker;
  };
  const context = vm.createContext(f.api);
  new vm.Script(f.script).runInContext(context);
  await assert.rejects(context.run(), (e) => e === marker);
  assert.deepEqual(f.calls, ["plan", "map", "pins"]);
  assert.equal(f.closed(), true);
  const outcome = JSON.parse(
    await readActual(path.join(f.root, "cef-metal-tools-probe/outcome.json")),
  );
  assert.equal(outcome.phase, "selected-tool-pins");
  assert.equal(outcome.reason, "UNCLASSIFIED");
  assert.doesNotMatch(JSON.stringify(outcome), /PRIVATE_SECRET/);
  const g = await pipelineFixture(t);
  g.env.METAL_TOOLS_ENABLED = "false";
  const denied = vm.createContext(g.api);
  new vm.Script(g.script).runInContext(denied);
  await assert.rejects(denied.run(), /METAL_DIAGNOSTIC_OPT_IN_HOST_REQUIRED/);
  assert.deepEqual(g.calls, []);
});

test("actual opt-in body rejects changed source or map pins before helper execution", async (t) => {
  for (const kind of ["source", "map"]) {
    const f = await pipelineFixture(t);
    if (kind === "source") {
      const planned = f.api.plan;
      f.api.plan = async (options) => {
        const result = await planned(options);
        result.sourceLock = structuredClone(result.sourceLock);
        result.sourceLock.upstream.cef.commit = "b".repeat(40);
        return result;
      };
    } else {
      const original = f.api.readFile;
      f.api.readFile = async (file, ...args) =>
        String(file).endsWith("cef-ci-runner-x86_64-apple-darwin.json")
          ? Buffer.from("private-invalid-map")
          : original(file, ...args);
    }
    const context = vm.createContext(f.api);
    new vm.Script(f.script).runInContext(context);
    await assert.rejects(context.run(), /METAL_DIAGNOSTIC_TOOL_MAP_DENIED/);
    assert.equal(f.calls.includes("metal"), false);
    assert.equal(f.calls.includes("pins"), false);
    assert.equal(f.closed(), true);
  }
});
