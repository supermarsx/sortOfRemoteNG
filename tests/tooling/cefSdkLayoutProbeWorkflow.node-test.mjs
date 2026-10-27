import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import YAML from "yaml";
import ts from "typescript";

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
  assert.equal(
    job["timeout-minutes"],
    "${{ (inputs.metal_tools || inputs.mac_arm_external) && 15 || 10 }}",
  );
  assert.deepEqual(workflow.concurrency, {
    group: "cef-sdk-layout-probe-${{ github.ref }}",
    "cancel-in-progress": true,
  });
  assert.deepEqual(workflow.defaults.run, { shell: "bash" });
});

test("SDK layout diagnostics run only fixed provisioning and the non-build probe", () => {
  const commands = job.steps
    .filter(
      (step) =>
        step.run &&
        ![
          "Diagnose selected Apple Metal tools",
          "Reject conflicting diagnostic modes",
        ].includes(step.name),
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
    if (
      ![
        "Diagnose selected Apple Metal tools",
        "Reject conflicting diagnostic modes",
      ].includes(step.name)
    )
      assert.equal(step.env, undefined);
  const metal = job.steps.find(
    (step) => step.name === "Diagnose selected Apple Metal tools",
  );
  assert.equal(
    metal.if,
    "inputs.metal_tools == true || inputs.mac_arm_external == true",
  );
  assert.deepEqual(metal.env, {
    METAL_TOOLS_ENABLED: "${{ inputs.metal_tools }}",
    MAC_ARM_EXTERNAL_ENABLED: "${{ inputs.mac_arm_external }}",
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
  const retention = job.steps.find(
    (step) => step.name === "Retain bounded diagnostic output",
  );
  assert.equal(retention.if, "always() && inputs.mac_arm_external != true");
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
  symlink,
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
  checkpointProfile,
  LIMITS,
} from "../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  plan as actualPlan,
  validateRunnerMap as actualRunnerMap,
  releaseIdentity,
  assertHostedBuildIdentity,
} from "../../scripts/cef-runtime-ci.mjs";
import * as actualMac from "../../scripts/lib/cef-mac-source-metadata.mjs";
import { fileURLToPath } from "node:url";

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
const findMetal = ["--find", "metal"];

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
    ...[
      ["--sdk", "macosx", "--find", "metal"],
      ["--sdk", "macosx", "--find", "metallib"],
      ["--sdk", "macosx", "metal", "--version"],
      ["--no-cache", "--find", "metal"],
      ["--no-cache", "--find", "metallib"],
      ["--no-cache", "metal", "--version"],
      ["--verbose", "--find", "metal"],
      ["--log", "--find", "metal"],
      ["--kill-cache"],
      ["--find", "metallib", "--version"],
      ["--find", "air-lld"],
      ["--find", "metal", "extra"],
      ["metal", "--find"],
      ["metallib", "--version"],
    ].map((args) => ["/usr/bin/xcrun", args]),
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

test("actual Metal classifier accepts only the three normal-cache short vectors with unchanged closed stages", async () => {
  const seen = [],
    saved = [];
  const exec = observer()(
    async (file, args) => {
      seen.push({ file, args });
      return { stdout: "owned fixture result" };
    },
    async (row) => saved.push(row),
  );
  for (const args of [
    ["--find", "metal"],
    ["--find", "metallib"],
    ["metal", "--version"],
  ])
    await exec("/usr/bin/xcrun", args, { timeout: 30000 });
  assert.deepEqual(
    saved.map((row) => row.stage),
    ["find-metal", "find-metallib", "metal-version"],
  );
  assert.equal(seen.length, 3);
  assert(seen.every((row) => row.file === "/usr/bin/xcrun"));
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

test("actual normal-cache Metal helper crosses the actual extracted carrier without extra commands or authority", async () => {
  const f = helperFixture("stable");
  const result = await prepareMacMetalToolchain(
    {
      selected: f.selected,
      env: f.env,
      platform: "darwin",
      allowDownload: true,
      remainingMilliseconds: () => 30000,
    },
    f.dependencies,
  );
  assert.deepEqual(
    f.records.map((row) => row.stage),
    [
      "find-metal",
      "verify-metal-signature",
      "metal-version",
      "find-metal",
      "find-metallib",
      "verify-metallib-signature",
      "find-metallib",
    ],
  );
  assert(
    f.records.every(
      (row) => row.result === "success" && row.timeoutMs === 30000,
    ),
  );
  assert.equal(result.downloaded, false);
  assert.equal(result.componentResourceClosureVerified, false);
  assert.equal(result.nativeCompatibilityVerified, false);
});

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
  const selected = checkpointHost("x86_64-apple-darwin", "darwin", "x64"),
    namespace = selected.inputs + "/";
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
  const closedNames = [];
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
    realpath: async (value) =>
      value === "/" ||
      value === "/Applications/Xcode_26.3.app/Contents/Developer"
        ? value
        : realpath(value),
    readFile: readActual,
    open: async (...args) => {
      const file = await open(...args);
      return {
        writeFile: (...values) => file.writeFile(...values),
        close: async () => {
          closed = true;
          closedNames.push(path.basename(args[0]));
          await file.close();
        },
      };
    },
    plan: async (options) => {
      calls.push("plan");
      assert.equal(options.inputs, selected.inputs);
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
    prepareMacMetalToolchain: async (options, dependencies) => {
      calls.push("metal");
      assert.equal(options.allowDownload, true);
      assert.equal(
        options.selected.DEVELOPER_DIR,
        "/Applications/Xcode_26.3.app/Contents/Developer",
      );
      assert.ok(options.remainingMilliseconds() <= 600000);
      assert.equal(
        await dependencies.realpath(options.selected.DEVELOPER_DIR),
        options.selected.DEVELOPER_DIR,
      );
      return { downloaded: false };
    },
    macMetalFingerprint: () => ({
      provenance: "newly-observed-apple-component-not-prepinned",
      tools: [],
    }),
  };
  const tree = ts.createSourceFile(
    "inline.mjs",
    metalBody,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "runMetalDiagnostic",
  );
  assert(declaration);
  const script =
    functionsBody +
    "\n" +
    declaration.getText(tree) +
    "\nglobalThis.run=runMetalDiagnostic;";
  return {
    root,
    env,
    calls,
    api,
    closed: () => closed,
    closedNames: () => closedNames,
    script,
  };
}

test("actual opt-in body verifies selected tool map and pins before invoking existing helper, without source acquisition", async (t) => {
  const f = await pipelineFixture(t),
    context = vm.createContext(f.api);
  new vm.Script(f.script).runInContext(context);
  await context.run();
  assert.deepEqual(f.calls, ["plan", "map", "pins", "metal"]);
  assert.equal(f.closed(), true);
  assert.deepEqual(f.closedNames().sort(), [
    "commands.jsonl",
    "realpaths.jsonl",
  ]);
  const observedPaths = (
    await readActual(
      path.join(f.root, "cef-metal-tools-probe/realpaths.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(observedPaths.length, 1);
  assert.equal(observedPaths[0].stage, "selected-developer");
  assert.equal(
    observedPaths[0].canonical,
    "/Applications/Xcode_26.3.app/Contents/Developer",
  );
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

function realpathObserver() {
  const context = vm.createContext({ path, Buffer, performance });
  new vm.Script(
    functionsBody + "\nglobalThis.observe=observeMetalRealpath;",
  ).runInContext(context);
  return context.observe;
}

test("canonical-path observer preserves original values/errors and bounds private paths without error dumps", async () => {
  const observe = realpathObserver(),
    rows = [],
    input = "/private/Apple/Metal.xctoolchain/usr/bin/metallib",
    result = "/private/Apple/Metal.xctoolchain/usr/bin/other-target";
  const resolve = observe(
    async (value) => {
      assert.equal(value, input);
      return result;
    },
    async (row) => rows.push(row),
    "/Applications/selected/Contents/Developer",
  );
  assert.equal(await resolve(input), result);
  assert.equal(rows[0].input, input);
  assert.equal(rows[0].canonical, result);
  assert.equal(rows[0].stage, "metallib");
  const long = "/" + "🙂".repeat(3000),
    bounded = observe(
      async () => long,
      async (row) => rows.push(row),
      "/selected",
    );
  assert.equal(await bounded(input), long);
  assert.ok(Buffer.byteLength(rows[1].canonical) <= 2048);
  assert.equal(rows[1].canonicalTruncated, true);
  assert.equal(rows[1].canonicalBytes, Buffer.byteLength(long));
  const error = Object.assign(
    new Error("private token and environment payload"),
    { code: "EACCES" },
  );
  await assert.rejects(
    observe(
      async () => {
        throw error;
      },
      async (row) => rows.push(row),
      "/selected",
    )(input),
    (e) => e === error,
  );
  assert.equal(rows.at(-1).failureCode, "EACCES");
  assert.equal(rows.at(-1).canonical, null);
  assert.doesNotMatch(
    JSON.stringify(rows),
    /private token|environment payload/,
  );
  await assert.rejects(
    observe(
      async () => {
        throw error;
      },
      async () => {
        throw Error("write failed");
      },
      "/selected",
    )(input),
    (e) => e === error,
  );
  let caught = false;
  try {
    await observe(
      async () => {
        throw null;
      },
      async () => {},
      "/selected",
    )(input);
  } catch (e) {
    caught = true;
    assert.equal(e, null);
  }
  assert.equal(caught, true);
});

test("canonical-path observer stops at32 observations without later filesystem calls", async () => {
  let calls = 0;
  const observed = realpathObserver()(
    async (value) => {
      calls++;
      return value;
    },
    async () => {},
    "/selected",
  );
  for (let i = 0; i < 32; i++) await observed("/selected");
  await assert.rejects(
    observed("/selected"),
    /METAL_DIAGNOSTIC_REALPATH_BOUND/,
  );
  assert.equal(calls, 32);
});

test("actual owned filesystem alias is observed without rewriting its canonical result", async (t) => {
  const f = await pipelineFixture(t),
    physical = path.join(f.root, "physical"),
    alias = path.join(f.root, "alias");
  await mkdir(physical);
  await writeFile(
    path.join(physical, "metallib"),
    "not executable; metadata fixture only",
  );
  await symlink(physical, alias, "junction");
  const input = path.join(alias, "metallib").replaceAll("\\", "/"),
    expected = await realpath(input),
    rows = [];
  const result = await realpathObserver()(
    realpath,
    async (row) => rows.push(row),
    "/selected",
  )(input);
  assert.equal(result, expected);
  assert.equal(rows[0].input, input);
  assert.equal(rows[0].canonical, expected);
  assert.equal(rows[0].stage, "metallib");
});

test("simulated differing metallib canonical target remains denied by unchanged Metal helper", async () => {
  const f = helperFixture("none"),
    rows = [];
  const resolve = async (value) =>
    value.endsWith("/metallib")
      ? value.replace(/metallib$/, "different-tool")
      : value;
  f.dependencies.realpath = realpathObserver()(
    resolve,
    async (row) => rows.push(row),
    f.selected.DEVELOPER_DIR,
  );
  await assert.rejects(
    prepareMacMetalToolchain(
      {
        selected: f.selected,
        env: f.env,
        platform: "darwin",
        allowDownload: true,
        remainingMilliseconds: () => 600000,
      },
      f.dependencies,
    ),
    /MAC_METAL_RESOLVED_PATH/,
  );
  const last = rows.at(-1);
  assert.equal(last.stage, "metallib");
  assert.ok(last.input.endsWith("/metallib"));
  assert.ok(last.canonical.endsWith("/different-tool"));
  assert.equal(
    f.records.filter((x) => x.stage === "verify-metallib-signature").length,
    0,
  );
  assert.equal(
    f.records.some((x) => x.stage === "download-component"),
    false,
  );
});

test("diagnostic wrapper records physical air-lld signature as metallib and keeps helper failures", async () => {
  for (const failure of [false, true]) {
    const f = helperFixture("available");
    f.dependencies.realpath = async (value) =>
      value.endsWith("/metallib")
        ? value.replace(/metallib$/, "air-lld")
        : value;
    const exec = f.dependencies.exec;
    f.dependencies.exec = async (exe, args, options) => {
      if (
        failure &&
        exe === "/usr/bin/codesign" &&
        args.at(-1).endsWith("/air-lld")
      ) {
        // Use the actual observer to preserve the failing physical command's record.
        return observer()(
          async () => {
            throw Object.assign(Error("private"), {
              code: 1,
              stderr: "original physical signature failure",
            });
          },
          async (row) => f.records.push(row),
        )(exe, args, options);
      }
      return exec(exe, args, options);
    };
    const run = () =>
      prepareMacMetalToolchain(
        {
          selected: f.selected,
          env: f.env,
          platform: "darwin",
          allowDownload: true,
        },
        f.dependencies,
      );
    if (failure) await assert.rejects(run(), /MAC_METAL_COMMAND_FAILED/);
    else {
      const result = await run();
      assert(result.tools[1].physicalPath.endsWith("/air-lld"));
      assert.equal(result.tools[1].version, null);
    }
    const records = f.records.filter(
      (r) => r.stage === "verify-metallib-signature",
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].result, failure ? "failed" : "success");
    assert.equal(
      f.records.filter((r) => r.stage === "download-component").length,
      0,
    );
  }
});

test("ARM passive mode is explicit, mutually exclusive and retains one existing Node heredoc and default Intel commands", () => {
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.mac_arm_external, {
    description:
      "Read-only ARM65 external inputs; permits only the existing typed missing-Metal component download",
    type: "boolean",
    required: false,
    default: false,
  });
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const raw = job.steps
    .filter((step) => step.run)
    .map((step) => step.run)
    .join("\n");
  assert.equal(
    (raw.match(/node --input-type=module <<'NODE'/g) ?? []).length,
    1,
  );
  const conflict = job.steps.findIndex(
    (step) => step.name === "Reject conflicting diagnostic modes",
  );
  assert(
    conflict >= 0 &&
      conflict <
        job.steps.findIndex(
          (step) =>
            step.name ===
            "Prepare existing fixed reviewed native prerequisites",
        ),
  );
  assert.match(
    job.steps[conflict].run,
    /METAL_TOOLS_ENABLED.*true.*MAC_ARM_EXTERNAL_ENABLED.*true/,
  );
  for (const name of [
    "Prepare existing fixed reviewed native prerequisites",
    "Probe selected native SDK links without acquiring sources",
  ])
    assert.equal(
      job.steps.find((step) => step.name === name).if,
      "inputs.mac_arm_external != true",
    );
  const retention = job.steps.find(
    (step) => step.name === "Retain bounded ARM external observation",
  );
  assert.equal(
    retention.if,
    "always() && inputs.mac_arm_external == true && steps.diagnostic.outputs.arm_output != ''",
  );
  assert.equal(
    retention.with.path,
    "${{ steps.diagnostic.outputs.arm_output }}",
  );
});

async function armFixture(fault = "") {
  const profile = checkpointProfile("aarch64-apple-darwin");
  const repo = fileURLToPath(new URL("../../", import.meta.url)).replaceAll(
    "\\",
    "/",
  );
  const map = JSON.parse(
    await read(profile.inputs + "/cef-ci-runner-aarch64-apple-darwin.json"),
  );
  const env = {
    RUNNER_TEMP: "/Users/runner/work/_temp",
    SORNG_CEF_TOOLS_ROOT: "/",
    GITHUB_OUTPUT: "/owned-output",
    MAC_ARM_EXTERNAL_ENABLED: "true",
    METAL_TOOLS_ENABLED: "false",
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
    ImageOS: map.hosted.imageOS,
    ImageVersion: map.hosted.imageVersion,
  };
  const files = new Map(),
    directories = new Set(),
    events = [],
    frames = [],
    reads = new Map(),
    timers = new Map();
  let clock = fault === "fractional" ? 0.25 : 0,
    hardTick,
    intervalCleared = false,
    exits = [],
    observation,
    uidCalls = 0,
    timerId = 0,
    releasePersistence;
  const marker = Error("PRIVATE_FIRST"),
    secondary = Error("PRIVATE_SECONDARY");
  let persistenceStartedResolve;
  const persistenceStarted = new Promise((resolve) => {
    persistenceStartedResolve = resolve;
  });
  const ino = (file) =>
    file.endsWith("external.json")
      ? 30n
      : file.endsWith("capability.json")
        ? 20n
        : 10n;
  const stat = (file, directory = false) => ({
    dev: 1n,
    ino: ino(file),
    mode: directory ? 0o40700n : 0o100600n,
    uid: 501n,
    gid: 20n,
    nlink: 1n,
    size: BigInt(directory ? 0 : (files.get(file)?.length ?? 0)),
    mtimeNs: 1n,
    ctimeNs: 2n,
    birthtimeNs: 3n,
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  });
  const sourceIo = {
    lstat: async (file) => ({
      ...stat(file, true),
      isSymbolicLink: () => file.endsWith("MacOSX26.2.sdk"),
    }),
    readlink: async () => (fault === "alias" ? "OTHER.sdk" : "MacOSX.sdk"),
    realpath: async (file) => file.replace("MacOSX26.2.sdk", "MacOSX.sdk"),
  };
  const root =
    "/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/" +
    "a".repeat(40) +
    "/Metal.xctoolchain/usr/bin/";
  const bytes = Buffer.alloc(16, 65),
    toolHash = hash(bytes);
  const makeCapability = () => {
    const rows = [];
    for (const [index, role] of [
      "file",
      "directory",
      "root",
      "symlink",
    ].entries())
      for (const kind of ["no-op", "past", "future"]) {
        const before = {
          dev: "1",
          ino: String(index + 1),
          mode: String(
            role === "file"
              ? 0o100600
              : role === "symlink"
                ? 0o120777
                : 0o40700,
          ),
          nlink: "1",
          size: "0",
          uid: "501",
          gid: "20",
          atime_ns: "1",
          mtime_ns: "10",
          ctime_ns: "12",
          birthtimeNsAvailable: false,
          birthtimeNs: null,
        };
        const requested =
            kind === "no-op" ? "10" : kind === "past" ? "5" : "20",
          after = { ...before, mtime_ns: requested };
        rows.push({
          role,
          case: kind,
          requestedMtimeNs: requested,
          before,
          after,
          heldBefore: role === "symlink" ? null : { ...before },
          heldAfter: role === "symlink" ? null : { ...after },
          exactMtimeReadback: true,
        });
      }
    if (fault === "cap-invalid") rows[0].unknown = "PRIVATE";
    const value = {
      schemaVersion: 1,
      kind: "sorng-macarm-owned-capability-observation",
      target: profile.target,
      complete: true,
      rows,
      cleanupConfirmed: true,
      objectsRemoved: true,
      handlesClosed: true,
      error: null,
      installedInputsWritten: false,
      sourceWriteAdmitted: false,
      nativeAcceptance: false,
      runtimeReady: false,
    };
    const raw = Buffer.from(JSON.stringify(value));
    files.set(observation.context.outputRoot + "/capability.json", raw);
    return {
      complete: true,
      kind: value.kind,
      rows: 12,
      observation: {
        name: "capability.json",
        bytes: raw.length,
        sha256: hash(raw),
      },
      sourceWriteAdmitted: false,
      nativeAcceptance: false,
      runtimeReady: false,
    };
  };
  const makeExternal = () => {
    const value = {
      schemaVersion: 1,
      kind: "sorng-macarm-external-input-observation",
      target: profile.target,
      policy: "sorng-macarm-readonly-external-inputs-v1",
      complete: true,
      externalSnapshotComplete: true,
      roles: ["sdk", "toolchain", "metal", "python"].map((role) => ({
        role,
        physicalRoot: observation.context.roots[role],
        snapshot: {
          entries: observation.context.requiredPins
            .filter((pin) => pin.role === role)
            .map((pin) => ({
              path: pin.path,
              kind: "file",
              mode: 0o100644,
              mtimeNs: "1",
              nlink: 1,
              uid: 0,
              gid: 0,
              size: pin.size,
              sha256: pin.sha256,
            })),
          rootMtimeNs: "1",
          gitHeads: {},
          bytes: observation.context.requiredPins
            .filter((pin) => pin.role === role)
            .reduce((sum, pin) => sum + pin.size, 0),
          root: { mode: 0o40755, mtimeNs: "1", uid: 0, gid: 0, nlink: 2 },
          localRoot: {
            dev: "1",
            ino: "2",
            ctimeNs: "3",
            birthtimeNsAvailable: false,
            birthtimeNs: null,
          },
        },
      })),
      entries: 10,
      bytes: observation.context.requiredPins.reduce(
        (sum, pin) => sum + pin.size,
        0,
      ),
      runnerUid: 501,
      historicalMetalResourceClosureVerified: false,
      sourceWriteAdmitted: false,
      nativeAcceptance: false,
      runtimeReady: false,
    };
    const raw = Buffer.from(JSON.stringify(value));
    files.set(observation.context.outputRoot + "/external.json", raw);
    return {
      complete: true,
      kind: value.kind,
      entries: value.entries,
      bytes: value.bytes,
      snapshot: { name: "external.json", bytes: raw.length, sha256: hash(raw) },
      sourceWriteAdmitted: false,
      nativeAcceptance: false,
      runtimeReady: false,
    };
  };
  const api = {
    path: path.posix,
    Buffer,
    performance: { now: () => clock },
    Date: { now: () => 1000000 + clock },
    createHash,
    identitySha256,
    fsConstants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
    process: {
      env,
      platform: "darwin",
      arch: "x64",
      cwd: () => repo,
      getuid: () => {
        uidCalls++;
        return 501;
      },
      exit: (code) => exits.push(code),
    },
    console: {
      error: (line) => {
        try {
          frames.push(JSON.parse(line));
        } catch {}
      },
    },
    setInterval: (fn) => {
      hardTick = fn;
      return 1;
    },
    clearInterval: () => {
      intervalCleared = true;
    },
    setTimeout: (fn) => {
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    sdkProbeAuthority,
    checkpointProfile,
    checkpointHost,
    releaseIdentity,
    plan: async (options) => {
      events.push("plan");
      const value = await actualPlan(options);
      return { ...value, inputsRoot: value.inputsRoot.replaceAll("\\", "/") };
    },
    validateRunnerMap: (value, target) => {
      events.push("map");
      return actualRunnerMap(value, target);
    },
    assertHostedBuildIdentity: (...args) => assertHostedBuildIdentity(...args),
    verifyToolchainFiles: async (options) => {
      events.push("pins");
      if (fault === "deadline") clock = 600001;
      assert.equal(options.target, profile.target);
      assert.equal(options.runnerMapFromInputs, true);
      return { filesVerified: fault === "pins" ? 8 : 9 };
    },
    buildEnvironment: (value, roots) =>
      Object.fromEntries(
        Object.entries(value.environment).map(([key, v]) => [
          key,
          v.replace(/^@TOOLS@\//, "/"),
        ]),
      ),
    realpath: async (file) => file,
    lstat: async (file) => {
      if (file.endsWith("capability-owned"))
        throw Object.assign(Error("absent"), { code: "ENOENT" });
      return stat(file, !files.has(file));
    },
    mkdir: async (file, options) => {
      assert.equal(options.mode, 0o700);
      assert(!directories.has(file));
      directories.add(file);
    },
    appendFile: async (file, text) => {
      assert.equal(file, env.GITHUB_OUTPUT);
      assert.match(text, /^arm_output=/);
    },
    readFile: async (file) => {
      const raw = await readActual(file);
      return fault === "map" &&
        file.endsWith("cef-ci-runner-aarch64-apple-darwin.json")
        ? Buffer.from("wrong map")
        : raw;
    },
    writeFile: async (file, raw, options) => {
      if (fault === "null-persist" && file.endsWith("outcome.json"))
        throw secondary;
      if (
        ["pending-persist", "null-pending"].includes(fault) &&
        file.endsWith("outcome.json")
      )
        return new Promise((resolve) => {
          persistenceStartedResolve();
          releasePersistence = () => {
            files.set(file, Buffer.from(raw));
            resolve();
          };
        });
      assert.equal(options.flag, "wx");
      assert(!files.has(file));
      files.set(file, Buffer.from(raw));
    },
    open: async (file, flags) => {
      if (flags === "wx")
        return { writeFile: async () => {}, close: async () => {} };
      const initial = stat(file);
      let position = 0;
      const grow =
        fault ===
        (file.endsWith("capability.json") ? "cap-growth" : "report-growth");
      const data = grow
        ? Buffer.concat([files.get(file), Buffer.alloc(1000)])
        : files.get(file);
      return {
        stat: async () => initial,
        read: async (buffer, offset, length) => {
          if (fault === "read-close" && file.endsWith("external.json"))
            throw marker;
          const count = Math.min(length, data.length - position);
          data.copy(buffer, offset, position, position + count);
          position += count;
          reads.set(file, position);
          return { bytesRead: count };
        },
        close: async () => {
          if (fault === "read-close" && file.endsWith("external.json"))
            throw secondary;
        },
      };
    },
    macSdkRelation: async (options) => {
      events.push("alias");
      return actualMac.macSdkRelation(options, sourceIo);
    },
    promisify: (fn) => fn,
    execFile: async (exe, args) =>
      exe === "/usr/bin/xcrun"
        ? {
            stdout: args.includes("--find")
              ? root + args.at(-1)
              : "Apple metal version 32023.104",
          }
        : {},
    prepareMacMetalToolchain: async (options, deps) => {
      events.push("metal");
      assert.equal(options.allowDownload, true);
      return prepareMacMetalToolchain(options, {
        ...deps,
        now: () => clock,
        realpath: async (file) =>
          file.endsWith("/metallib") ? root + "air-lld" : file,
        measure: async (file) => ({
          physicalPath: file,
          bytes: 16,
          sha256: toolHash,
        }),
      });
    },
    macMetalFingerprint: (
      await import("../../scripts/cef-hosted-provision.mjs")
    ).macMetalFingerprint,
    macExternalObservationPlan: (options) => {
      events.push("external-plan");
      observation = actualMac.macExternalObservationPlan(options);
      return observation;
    },
    archiveCommand: async (python, helper, args, options) => {
      const mode = args[0];
      events.push(mode);
      assert.equal(
        python,
        "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
      );
      assert(helper.endsWith("scripts/lib/cef-checkpoint-archive.py"));
      assert(
        Number.isSafeInteger(options.timeout) &&
          options.timeout > 0 &&
          options.timeout <=
            (mode === "mac-owned-capability-observe" ? 5000 : 600000),
      );
      if (mode === "mac-owned-capability-observe") return makeCapability();
      if (fault === "worker-unknown") {
        options.observeFailure({
          error: "source-external-input-unattested",
          externalPhase: "links",
          exitCode: 1,
          archiveCleanupUnknown: true,
        });
        throw marker;
      }
      if (["null-persist", "null-pending"].includes(fault)) {
        options.observeFailure({
          error: "source-external-input-unattested",
          exitCode: 1,
        });
        throw null;
      }
      return makeExternal();
    },
    readMacExternalObservation: async (...args) => {
      events.push("reader");
      return actualMac.readMacExternalObservation(...args);
    },
    macExternalToolsBinding: (...args) => {
      events.push("binding");
      return actualMac.macExternalToolsBinding(...args);
    },
    macExternalObservationEvidence: (...args) =>
      actualMac.macExternalObservationEvidence(...args),
    LIMITS,
  };
  const tree = ts.createSourceFile(
    "inline.mjs",
    metalBody,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "runArmExternalDiagnostic",
  );
  assert(declaration);
  const context = vm.createContext(api);
  new vm.Script(
    functionsBody +
      "\n" +
      declaration.getText(tree) +
      "\nglobalThis.run=runArmExternalDiagnostic;",
  ).runInContext(context);
  return {
    env,
    api,
    events,
    files,
    frames,
    reads,
    marker,
    secondary,
    run: () => context.run(),
    uidCalls: () => uidCalls,
    cleared: () => intervalCleared,
    exits,
    persistReady: () => Boolean(releasePersistence),
    persistenceStarted,
    expireWork: () => {
      clock = 600001;
      for (const fn of [...timers.values()]) fn();
    },
    expire: () => {
      clock = 630001;
      hardTick();
      for (const fn of [...timers.values()]) fn();
    },
    releasePersistence: () => releasePersistence?.(),
  };
}

test("actual ARM body verifies real checked-in source65 chain and crosses genuine opaque SDK/report binding APIs", async () => {
  const f = await armFixture();
  await f.run();
  assert.deepEqual(f.events, [
    "plan",
    "map",
    "pins",
    "alias",
    "metal",
    "external-plan",
    "mac-owned-capability-observe",
    "mac-external-observe",
    "reader",
    "binding",
  ]);
  assert.equal(f.uidCalls(), 1);
  assert.equal(f.cleared(), true);
  assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].complete, true);
  assert.equal(f.frames[0].actorsQuiet, true);
  const binding = JSON.parse(
    [...f.files.entries()].find(([name]) => name.endsWith("binding.json"))[1],
  );
  assert.equal(binding.macExternalInputs.externalSnapshotComplete, true);
  assert.equal(
    binding.sourceLockIdentity,
    checkpointProfile("aarch64-apple-darwin").source,
  );
  const outcome = JSON.parse(
    [...f.files.entries()].find(([name]) => name.endsWith("outcome.json"))[1],
  );
  assert.equal(outcome.complete, false);
  assert.equal(outcome.terminalCompletionRequired, true);
});

test("actual ARM authority, image, pin and alias denials cannot reach Metal download or census", async () => {
  for (const fault of [
    "private-ref",
    "token",
    "both",
    "image",
    "map",
    "pins",
    "alias",
  ]) {
    const f = await armFixture(fault);
    if (fault === "private-ref") f.env.GITHUB_REF = "refs/heads/private";
    if (fault === "token") f.env.GH_TOKEN = "PRIVATE";
    if (fault === "both") f.env.METAL_TOOLS_ENABLED = "true";
    if (fault === "image") f.env.ImageVersion = "foreign";
    await assert.rejects(f.run());
    assert(!f.events.includes("metal"));
    assert(!f.events.includes("mac-owned-capability-observe"));
    assert.equal(f.frames[0].complete, false);
    assert.doesNotMatch(JSON.stringify(f.frames), /PRIVATE/);
  }
});

test("fixed ARM capability and actual external reader FD adapters bound growing files and preserve primary read against close faults", async () => {
  for (const fault of [
    "cap-growth",
    "report-growth",
    "cap-invalid",
    "read-close",
  ]) {
    const f = await armFixture(fault);
    let caught;
    try {
      await f.run();
    } catch (error) {
      caught = error;
    }
    assert(caught);
    assert.equal(f.frames[0].complete, false);
    if (fault === "read-close") {
      assert.equal(caught, f.marker);
      assert.equal(f.frames[0].handleCleanupUnknown, true);
      assert.equal(f.frames[0].actorsQuiet, false);
    } else if (fault.endsWith("growth")) {
      const suffix =
        fault === "cap-growth" ? "capability.json" : "external.json";
      const [name, raw] = [...f.files.entries()].find(([name]) =>
        name.endsWith(suffix),
      );
      assert.equal(f.reads.get(name), raw.length + 1);
    }
  }
});

test("actual ARM null primary survives persistence failure and original630s watchdog remains through hanging persistence", async () => {
  const nullCase = await armFixture("null-persist");
  let caught = "missing";
  try {
    await nullCase.run();
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, null);
  assert.equal(nullCase.frames[0].firstWasNull, true);
  assert.equal(nullCase.frames[0].reportFailure, true);
  const f = await armFixture("pending-persist"),
    run = f.run();
  let timer;
  try {
    await Promise.race([
      f.persistenceStarted,
      run.then(() => {
        throw Error("unexpected pre-persistence completion");
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("bounded fixture setup")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(f.persistReady(), true);
  assert.equal(f.cleared(), false);
  f.expire();
  await assert.rejects(
    Promise.race([
      run,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("outer bounded test")), 500),
      ),
    ]),
  );
  assert.deepEqual(f.exits, [1]);
  assert.equal(f.frames[0].hardExpired, true);
  assert.equal(f.frames[0].actorsQuiet, false);
  f.releasePersistence();
  await new Promise((resolve) => setImmediate(resolve));
  assert(f.frames.every((frame) => frame.complete === false));
});

test("actual ARM shared clock floors fractional remaining budgets and expires before launching later phases", async () => {
  const fractional = await armFixture("fractional");
  await fractional.run();
  assert.equal(fractional.frames[0].complete, true);
  const expired = await armFixture("deadline");
  await assert.rejects(expired.run(), /MAC_ARM_EXTERNAL_DEADLINE/);
  assert(!expired.events.includes("alias"));
  assert(!expired.events.includes("metal"));
  assert(!expired.events.includes("mac-owned-capability-observe"));
});

test("actual ARM retains leaf cleanup uncertainty and null first fault through original hard deadline", async () => {
  const unknown = await armFixture("worker-unknown");
  await assert.rejects(unknown.run(), (error) => error === unknown.marker);
  assert.equal(unknown.frames[0].workerCleanupUnknown, true);
  assert.equal(unknown.frames[0].actorsQuiet, false);
  assert.equal(unknown.cleared(), false);
  const outcome = JSON.parse(
    [...unknown.files.entries()].find(([name]) =>
      name.endsWith("outcome.json"),
    )[1],
  );
  assert.equal(
    outcome.workerRecords.at(-1).failure.archiveCleanupUnknown,
    true,
  );
  assert.equal(
    outcome.workerRecords.at(-1).failure.error,
    "source-external-input-unattested",
  );
  const f = await armFixture("null-pending"),
    run = f.run();
  let timer;
  try {
    await Promise.race([
      f.persistenceStarted,
      run.then(() => {
        throw Error("unexpected completion");
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("bounded fixture setup")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  f.expire();
  let caught = "missing";
  try {
    await run;
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, null);
  assert.equal(f.frames[0].firstWasNull, true);
  assert.equal(f.frames[0].complete, false);
  assert.equal(f.frames[0].hardExpired, true);
  f.releasePersistence();
  await new Promise((resolve) => setImmediate(resolve));
  assert(f.frames.every((frame) => frame.complete === false));
});

// Exact inline body, fake clocks/owned handles only: no Apple process or filesystem.
async function delayedArmOpen(role, closeMode = "joined") {
  const f = await armFixture();
  const suffix = {
    "command-log": "metal-commands.jsonl",
    capability: "capability.json",
    "external-report": "external.json",
  }[role];
  const originalOpen = f.api.open,
    originalWrite = f.api.writeFile;
  let startedResolve,
    returnHandle,
    releaseClose,
    opened = 0,
    closes = 0,
    closeAttempts = 0;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  f.api.open = async (file, flags) => {
    if (!file.endsWith(suffix)) return originalOpen(file, flags);
    startedResolve();
    return new Promise((resolve) => {
      returnHandle = async () => {
        const fd = await originalOpen(file, flags),
          originalClose = fd.close;
        opened++;
        fd.close = async () => {
          closeAttempts++;
          if (closeMode === "failure") throw f.secondary;
          if (closeMode === "pending")
            await new Promise((r) => {
              releaseClose = r;
            });
          await originalClose();
          closes++;
        };
        resolve(fd);
      };
    });
  };
  f.api.writeFile = async (file, ...args) => {
    if (file.endsWith("outcome.json") && closeMode !== "past-cleanup") {
      await returnHandle();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return originalWrite(file, ...args);
  };
  return {
    f,
    started,
    releaseOpen: () => returnHandle(),
    releaseClose: () => releaseClose?.(),
    counts: () => ({ opened, closes, closeAttempts }),
  };
}
async function armSetupWithin(started, run) {
  let timer;
  try {
    await Promise.race([
      started,
      run.then(() => {
        throw Error("unexpected early completion");
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("bounded acquisition setup")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("actual ARM three fixed acquisitions dispose exact late handles before reporting quiet or clearing watchdog", async () => {
  for (const role of ["command-log", "capability", "external-report"]) {
    const x = await delayedArmOpen(role),
      run = x.f.run();
    await armSetupWithin(x.started, run);
    x.f.expireWork();
    await assert.rejects(run, /MAC_ARM_EXTERNAL_DEADLINE/);
    assert.deepEqual(
      x.counts(),
      { opened: 1, closes: 1, closeAttempts: 1 },
      role,
    );
    const frame = x.f.frames[0];
    assert.equal(frame.complete, false);
    assert.equal(frame.primaryReason, "MAC_ARM_EXTERNAL_DEADLINE");
    assert.equal(frame.pendingAcquisitions, 0);
    assert.equal(frame.ownedDescriptors, 0);
    assert.equal(frame.pendingOperations, 0);
    assert.equal(frame.openedDescriptors, frame.closedDescriptors);
    assert.equal(frame.lateDisposals, 1);
    assert.equal(frame.handleCleanupUnknown, false);
    assert.equal(frame.actorsQuiet, true);
    assert.equal(x.f.cleared(), true);
  }
});

test("actual ARM late close failure or unresolved close keeps exact handle ownership and original deadline watch", async () => {
  for (const closeMode of ["failure", "pending"]) {
    const x = await delayedArmOpen("capability", closeMode),
      run = x.f.run();
    await armSetupWithin(x.started, run);
    x.f.expireWork();
    await assert.rejects(run, /MAC_ARM_EXTERNAL_DEADLINE/);
    assert.deepEqual(x.counts(), { opened: 1, closes: 0, closeAttempts: 1 });
    const frame = x.f.frames[0];
    assert.equal(frame.ownedDescriptors, 1);
    assert.equal(frame.handleCleanupUnknown, true);
    assert.equal(frame.actorsQuiet, false);
    assert.equal(x.f.cleared(), false);
    x.f.expire();
    assert.deepEqual(x.f.exits, [1]);
    x.releaseClose();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(x.f.frames.length, 1);
    assert(x.f.frames.every((value) => value.complete === false));
    assert.equal(x.f.cleared(), false);
  }
});

test("actual ARM open still pending past original cleanup cannot dispose or claim joined using a new clock", async () => {
  const x = await delayedArmOpen("external-report", "past-cleanup"),
    run = x.f.run();
  await armSetupWithin(x.started, run);
  x.f.expireWork();
  await assert.rejects(run, /MAC_ARM_EXTERNAL_DEADLINE/);
  assert.equal(x.f.frames[0].pendingAcquisitions, 1);
  assert.equal(x.f.frames[0].actorsQuiet, false);
  assert.equal(x.f.frames[0].handleCleanupUnknown, true);
  assert.equal(x.f.cleared(), false);
  x.f.expire();
  await x.releaseOpen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(x.counts(), { opened: 1, closes: 0, closeAttempts: 0 });
  assert.deepEqual(x.f.exits, [1]);
  assert.equal(x.f.frames.length, 1);
  assert.equal(x.f.cleared(), false);
});

test("actual ARM acquisition rejection including null is retained without fabricated close or quiet", async () => {
  for (const rejection of [null, Error("PRIVATE_OPEN_REJECTION")]) {
    const f = await armFixture(),
      open = f.api.open;
    f.api.open = async (file, flags) => {
      if (file.endsWith("capability.json")) throw rejection;
      return open(file, flags);
    };
    let caught = "missing";
    try {
      await f.run();
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, rejection);
    assert.equal(f.frames[0].rejectedAcquisitions, 1);
    assert.equal(f.frames[0].pendingAcquisitions, 0);
    assert.equal(f.frames[0].openedDescriptors, f.frames[0].closedDescriptors);
    assert.equal(f.frames[0].actorsQuiet, false);
    assert.equal(f.frames[0].handleCleanupUnknown, true);
    assert.equal(f.frames[0].firstWasNull, rejection === null);
    assert.equal(f.cleared(), false);
    assert.doesNotMatch(JSON.stringify(f.frames), /PRIVATE_OPEN/);
    f.expire();
  }
});

test("actual ARM null read remains first when closing the same acquired descriptor fails", async () => {
  const f = await armFixture(),
    open = f.api.open;
  f.api.open = async (file, flags) => {
    const fd = await open(file, flags);
    if (file.endsWith("external.json")) {
      fd.read = async () => {
        throw null;
      };
      fd.close = async () => {
        throw f.secondary;
      };
    }
    return fd;
  };
  let caught = "missing";
  try {
    await f.run();
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, null);
  assert.equal(f.frames[0].firstWasNull, true);
  assert.equal(f.frames[0].ownedDescriptors, 1);
  assert.equal(f.frames[0].actorsQuiet, false);
  assert.equal(f.frames[0].handleCleanupUnknown, true);
  assert.equal(f.cleared(), false);
  assert.doesNotMatch(JSON.stringify(f.frames), /PRIVATE_SECONDARY/);
  f.expire();
});
