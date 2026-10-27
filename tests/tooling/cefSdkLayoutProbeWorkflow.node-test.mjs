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
  assert.equal(Object.keys(workflow.jobs).join(), "probe,sdk_wait");
  assert.equal(
    job.if,
    "inputs.sdk_wait_diagnostic != true && github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch) && github.event.repository.visibility == 'public'",
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
  const stripped = metalBody.replace(/^import .*;\r?$/gm, "");
  const script =
    stripped.slice(
      0,
      stripped.lastIndexOf("try { await runMetalDiagnostic(); }"),
    ) + "\nglobalThis.run=runMetalDiagnostic;";
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
import { EventEmitter } from "node:events";
import { execFile as actualExecFile } from "node:child_process";
import {
  authority as waitAuthority,
  clock as waitClock,
  bounded as waitBounded,
  queryEnvironment,
  query as waitQuery,
  cleanupOwned,
  main as waitMain,
  hardWatchdog as waitHardWatchdog,
  primaryReason as waitPrimaryReason,
} from "../../native/mac-sdk-wait-diagnostic.mjs";
const waitRoot =
  "/Users/runner/work/_temp/cef-mac-sdk-wait-11111111-1111-4111-8111-111111111111";
const waitSelected = {
  DEVELOPER_DIR: "/Applications/Xcode_26.3.app/Contents/Developer",
  SDKROOT:
    "/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
  MACOSX_DEPLOYMENT_TARGET: "14.0",
};
const waitEvent = {
  repository: {
    id: 1010282954,
    full_name: "supermarsx/sortOfRemoteNG",
    private: false,
    visibility: "public",
    default_branch: "main",
  },
  inputs: { sdk_wait_diagnostic: "true", metal_tools: "false" },
};
function waitEnv() {
  return {
    SDK_WAIT_DIAGNOSTIC: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REPOSITORY_ID: "1010282954",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    CEF_DEFAULT_BRANCH: "main",
    GITHUB_REF: "refs/heads/codex/ci-mac-sdk-wait-diagnostic-20261027",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-sdk-layout-probe.yml@refs/heads/codex/ci-mac-sdk-wait-diagnostic-20261027",
  };
}
function waitChild() {
  const c = new EventEmitter();
  return Object.assign(c, {
    pid: 42,
    exitCode: 0,
    signalCode: null,
    stdin: Object.assign(new EventEmitter(), { writableEnded: false }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
}
test("SDK wait route is a separate mutually exclusive branch-only job with fixed commands and no installed provisioning", async () => {
  const diagnostic = workflow.jobs.sdk_wait;
  assert.equal(
    workflow.on.workflow_dispatch.inputs.sdk_wait_diagnostic.default,
    false,
  );
  assert.match(
    diagnostic.if,
    /inputs.sdk_wait_diagnostic == true && inputs.metal_tools != true/,
  );
  assert.match(
    diagnostic.if,
    /refs\/heads\/codex\/ci-mac-sdk-wait-diagnostic-20261027/,
  );
  assert.equal(diagnostic["timeout-minutes"], 15);
  assert.deepEqual(
    diagnostic.steps.filter((s) => s.run).map((s) => s.run),
    ["node native/mac-sdk-wait-diagnostic.mjs --execute"],
  );
  assert.equal(
    diagnostic.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))
      .with.path,
    "${{ steps.sdk_wait.outputs.diagnostic_root }}",
  );
  waitAuthority(waitEnv(), waitEvent, "darwin", "x64");
  for (const [key, value] of [
    ["SDK_WAIT_DIAGNOSTIC", "false"],
    ["GITHUB_REPOSITORY", "foreign/repo"],
    ["GITHUB_REF", "refs/heads/main"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REPOSITORY_VISIBILITY", "private"],
  ])
    assert.throws(() =>
      waitAuthority({ ...waitEnv(), [key]: value }, waitEvent, "darwin", "x64"),
    );
  for (const inputs of [
    { sdk_wait_diagnostic: "true", metal_tools: "true" },
    { sdk_wait_diagnostic: "true", unknown: "x" },
    { sdk_wait_diagnostic: "false" },
  ])
    assert.throws(() =>
      waitAuthority(waitEnv(), { ...waitEvent, inputs }, "darwin", "x64"),
    );
  assert.throws(() => waitAuthority(waitEnv(), waitEvent, "linux", "x64"));
});
test("SDK wait A/B differ only by owned HOME and TMPDIR and preserve original keys and query cap", () => {
  const a = queryEnvironment(waitSelected, "A", waitRoot),
    b = queryEnvironment(waitSelected, "B", waitRoot);
  assert.deepEqual(a, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    ...waitSelected,
  });
  assert.deepEqual(b, {
    ...a,
    HOME: waitRoot + "/home",
    TMPDIR: waitRoot + "/tmp/",
  });
  assert(!("USER" in b) && !("LOGNAME" in b));
  assert.throws(() => queryEnvironment(waitSelected, "C", waitRoot));
  assert.throws(() => queryEnvironment(waitSelected, "B", "/foreign"));
});
test("SDK wait shared clock floors original wall/mono and does not reset cleanup", () => {
  let wall = 0,
    mono = 0n;
  const c = waitClock(600000, { wall: () => wall, mono: () => mono });
  wall = 100;
  mono = 100500000n;
  assert.equal(c.remaining(), 599899);
  wall = 600000;
  assert.throws(c.remaining);
  assert.equal(c.cleanup(), 30000);
  wall = 630000;
  assert.throws(c.cleanup);
});
test("SDK wait actual query records callback before close, consumes bounded pipes and preserves null before later faults", async () => {
  let callback,
    child,
    settled = false;
  const pending = waitQuery(
    "A",
    queryEnvironment(waitSelected, "A", waitRoot),
    () => 600000,
    {
      execute: (file, args, options, cb) => {
        assert.equal(file, "/usr/bin/xcrun");
        assert.deepEqual(args, ["-sdk", "macosx", "--show-sdk-path"]);
        assert.equal(options.timeout, 30000);
        assert.equal(options.maxBuffer, 65536);
        assert.equal(options.killSignal, "SIGKILL");
        callback = cb;
        child = waitChild();
        return child;
      },
    },
  ).then((row) => {
    settled = true;
    return row;
  });
  child.emit("spawn");
  child.stdout.emit("data", Buffer.alloc(70000, 120));
  child.stdin.emit("error", null);
  child.stderr.emit("error", new Error("secondary"));
  callback(undefined);
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit("exit", 0);
  child.stdout.emit("end");
  child.stdout.emit("close");
  child.stderr.emit("close");
  child.emit("close", 0);
  const row = await pending;
  assert.equal(row.primaryWasNull, true);
  assert.equal(row.failed, true);
  assert.equal(row.stdout.observed, 70000);
  assert.equal(row.stdout.retained, 65536);
  assert.equal(Buffer.from(row.stdout.base64, "base64").length, 65536);
  assert(row.events.some((v) => v.kind === "stdin-close") === false);
  assert.equal(row.stdinEnded, false);
  assert.equal(row.sampler.attempted, false);
});
test("SDK wait actual query clamps cap to remaining and retains both variant outcomes without retry", async () => {
  const rows = [];
  for (const variant of ["A", "B"]) {
    let callback, child;
    const pending = waitQuery(
      variant,
      queryEnvironment(waitSelected, variant, waitRoot),
      () => 1234.9,
      {
        execute: (_file, _args, options, cb) => {
          assert.equal(options.timeout, 1234);
          callback = cb;
          child = waitChild();
          return child;
        },
      },
    );
    callback(
      variant === "A"
        ? Object.assign(new Error("fixed"), { code: "ETIMEDOUT" })
        : undefined,
    );
    child.emit("exit");
    child.emit("close");
    rows.push(await pending);
  }
  assert.deepEqual(
    rows.map((r) => [r.variant, r.failed]),
    [
      ["A", true],
      ["B", false],
    ],
  );
});
test(
  "SDK wait pending persistence cannot outlive its original finite bound",
  { timeout: 1000 },
  async () => {
    const begin = performance.now();
    await assert.rejects(
      waitBounded(
        () => new Promise(() => {}),
        () => 25,
      ),
      /PENDING_IO_UNCONFIRMED/,
    );
    assert(performance.now() - begin < 500);
  },
);
test("SDK wait owned cleanup attempts every eligible object, preserves first null and never deletes replacement or unconfirmed actor namespace", async () => {
  const stamp = {
    dev: 1n,
    ino: 2n,
    mode: 0o40700n,
    birthtimeNs: 1n,
    uid: 1n,
    gid: 1n,
  };
  const stat = {
    ...stamp,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  const owned = ["home", "tmp"].map((n) => ({
    location: waitRoot + "/" + n,
    stamp,
  }));
  let calls = [];
  const io = {
    lstat: async () => stat,
    rm: async (p) => {
      calls.push(p);
      if (p.endsWith("/home")) throw null;
    },
  };
  const r = await cleanupOwned(owned, true, () => 100, {
    io,
    verify: async () => {},
  });
  assert.equal(r.failed, true);
  assert.equal(r.first, null);
  assert.equal(calls.length, 2);
  assert.equal(r.rows[1].removed, true);
  calls = [];
  const foreign = await cleanupOwned(owned, true, () => 100, {
    io: { ...io, lstat: async () => ({ ...stat, ino: 3n }) },
    verify: async () => {},
  });
  assert.equal(foreign.failed, true);
  assert.equal(calls.length, 0);
  const quiet = await cleanupOwned(owned, false, () => 100, {
    io,
    verify: async () => {},
  });
  assert.equal(quiet.failed, true);
  assert.equal(calls.length, 0);
});
test(
  "SDK wait real benign Node leaf proves timeout callback/exit/close behavior without an Apple runtime claim",
  { timeout: 3000 },
  async () => {
    const row = await waitQuery(
      "A",
      queryEnvironment(waitSelected, "A", waitRoot),
      () => 100,
      {
        execute: (_file, _args, options, cb) =>
          actualExecFile(
            process.execPath,
            ["-e", "setInterval(()=>{},1000)"],
            options,
            cb,
          ),
      },
    );
    assert.equal(row.failed, true);
    assert.equal(row.callbackSeen, true);
    assert.equal(row.exitSeen, true);
    assert.equal(row.closeSeen, true);
    assert(row.events.some((r) => r.kind === "exit"));
    assert(row.events.some((r) => r.kind === "close"));
  },
);

function waitParentFixture() {
  // Execute the actual parent body with controlled filesystem/tool/supervisor
  // boundaries. This proves wiring, not Darwin or installed-pin acceptance.
  const files = new Map(),
    launches = [];
  const stamp = {
    dev: 1n,
    ino: 2n,
    mode: 0o40700n,
    nlink: 1n,
    birthtimeNs: 1n,
    uid: 501n,
    gid: 20n,
    isDirectory: () => true,
  };
  const e = {
    ...waitEnv(),
    GITHUB_EVENT_PATH: "/owned/event.json",
    RUNNER_TEMP: "/Users/runner/work/_temp",
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
  };
  const inputs =
    "native/cef-build-inputs/20261025-r5-owned-http3-macarm-sdk26-2-capture-compat";
  const scope = {
    assert,
    path,
    clock: waitClock,
    bounded: waitBounded,
    authority: () => {},
    INPUTS: inputs,
    SOURCE: "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    DEVELOPER: waitSelected.DEVELOPER_DIR,
    SDK: waitSelected.SDKROOT,
    SELF: "/checkout/native/mac-sdk-wait-diagnostic.mjs",
    process: {
      platform: "darwin",
      arch: "x64",
      cwd: () => "/checkout",
      execPath: "/selected/node",
      hrtime: process.hrtime,
    },
    Date,
    console: { log: () => {}, error: () => {} },
    pendingIO: new Set(),
    hardWatchdog: waitHardWatchdog,
    primaryReason: waitPrimaryReason,
    checkpointHost: () => ({ inputs, target: "aarch64-apple-darwin" }),
    plan: async () => ({
      inputsRoot: "/selected-inputs",
      sourceLock: { synthetic: true },
    }),
    identitySha256: () =>
      "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    validateRunnerMap: (x) => x,
    verifyToolchainFiles: async (options) => {
      assert.equal(options.toolsRoot, "/");
      assert.equal(options.runnerMapFromInputs, true);
      return { filesVerified: 9 };
    },
    physical: async (p) => p,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    queryEnvironment,
    hash: (x) => createHash("sha256").update(x).digest("hex"),
    fs: {
      mkdir: async () => {},
      lstat: async () => stamp,
      writeFile: async (p, raw) => files.set(p, Buffer.from(raw)),
      appendFile: async () => {},
    },
    save: async (p, value) => files.set(p, Buffer.from(JSON.stringify(value))),
    cleanupOwned: async () => ({
      rows: [
        { role: "home", removed: true },
        { role: "tmp", removed: true },
      ],
      failed: false,
    }),
    held: async (p) =>
      p === e.GITHUB_EVENT_PATH
        ? Buffer.from(JSON.stringify(waitEvent))
        : p.includes("cef-ci-runner-")
          ? Buffer.from(
              JSON.stringify({
                hosted: { imageOS: e.ImageOS, imageVersion: e.ImageVersion },
                python: "fixed/python",
                environment: {
                  DEVELOPER_DIR: "@TOOLS@" + waitSelected.DEVELOPER_DIR,
                  SDKROOT: "@TOOLS@" + waitSelected.SDKROOT,
                  MACOSX_DEPLOYMENT_TARGET: "14.0",
                },
              }),
            )
          : files.get(p),
    compileSlice: async (executable, args, options) => {
      assert.equal(executable, "/selected/node");
      assert.equal(args[0], "/checkout/native/mac-sdk-wait-diagnostic.mjs");
      assert.equal(args[1], "--worker");
      assert.equal(args[2], waitRoot);
      assert.match(args[3], /^[a-f0-9]{64}$/);
      assert(
        Number.isSafeInteger(options.milliseconds) &&
          options.milliseconds === 35000,
      );
      const variant = args[4];
      launches.push(variant);
      assert.deepEqual(
        options.env,
        queryEnvironment(waitSelected, variant, waitRoot),
      );
      files.set(
        waitRoot + "/" + variant + "/query.json",
        Buffer.from(JSON.stringify({ variant, failed: variant === "A" })),
      );
      return {
        exitCode: 0,
        quiescent: true,
        observed: [{ pid: 42, start: "fixed" }],
        groupId: 42,
        quiescence: "observed-lineage-and-root-group",
        outcome: "compiler-complete",
      };
    },
  };
  const build = () =>
    new Function(
      ...Object.keys(scope),
      "return (" + waitMain.toString() + ");",
    )(...Object.values(scope));
  return { files, launches, scope, e, build };
}
test("SDK wait actual parent orchestration gives both fixed workers finite numeric budgets and preserves A failure before B success", async () => {
  const { files, launches, e, build } = waitParentFixture();
  const run = build();
  const result = await run(e);
  assert.deepEqual(launches, ["A", "B"]);
  assert.deepEqual(
    result.variants.map((v) => v.query.failed),
    [true, false],
  );
  const outcome = JSON.parse(files.get(waitRoot + "/outcome.json"));
  assert.equal(outcome.environmentCausalityProved, false);
  assert.equal(outcome.sourceWriteAdmitted, false);
  assert.equal(outcome.complete, false);
  assert.equal(outcome.observationComplete, true);
  assert.equal(outcome.terminalCompletionRequired, true);
});

test("SDK wait actual held reader preserves null across close faults and physically limits growth reads", async () => {
  const source = await read("native/mac-sdk-wait-diagnostic.mjs");
  const body = source.slice(
    source.indexOf("async function held("),
    source.indexOf("async function save("),
  );
  const stamp = {
    dev: 1n,
    ino: 2n,
    size: 1n,
    nlink: 1n,
    mode: 1n,
    mtimeNs: 1n,
    ctimeNs: 1n,
    birthtimeNs: 1n,
    isFile: () => true,
  };
  for (const growth of [false, true]) {
    let reads = 0,
      closes = 0;
    const primary = null;
    const fs = {
      lstat: async () => stamp,
      open: async () => ({
        stat: async () => stamp,
        read: async (buffer, offset, length) => {
          reads++;
          assert.equal(buffer.length, 2);
          assert.equal(length, 2);
          if (!growth) throw primary;
          return { bytesRead: 2 };
        },
        close: async () => {
          closes++;
          throw new Error("close secondary");
        },
      }),
    };
    const held = vm.runInNewContext(body + ";held", {
      assert,
      Buffer,
      BigInt,
      fs,
      physical: async () => {},
      bounded: waitBounded,
    });
    await assert.rejects(
      held("/owned/input", 1, () => 100),
      (e) => (growth ? e.code === "ERR_ASSERTION" : e === primary),
    );
    assert.equal(reads, 1);
    assert.equal(closes, 1);
  }
});

test("SDK wait absolute hard watchdog remains armed for unconfirmed I/O and clears only quiet ownership", () => {
  let wall = 0,
    mono = 0n,
    tick,
    cancelled = 0;
  const term = [];
  const dog = waitHardWatchdog(
    { wallEnd: 600000, monoEnd: "600000000000" },
    {
      wall: () => wall,
      mono: () => mono,
      schedule: (fn) => {
        tick = fn;
        return 1;
      },
      cancel: () => cancelled++,
      terminate: (fact) => term.push(fact),
      observe: () => ({ pendingIoCount: 1 }),
    },
  );
  assert.equal(dog.release(true, 1), false);
  assert.equal(dog.release(false, 0), false);
  wall = 629999;
  mono = 629999000000n;
  tick();
  assert.equal(term.length, 0);
  wall = 630000;
  mono = 630000000000n;
  tick();
  assert.equal(term.length, 1);
  assert.equal(term[0].pendingIoCount, 1);
  assert.equal(dog.release(true, 0), false);
  assert.equal(cancelled, 0);
  assert.throws(dog.assertActive, /HARD_DEADLINE/);
  const quiet = waitHardWatchdog(
    { wallEnd: 600000, monoEnd: "600000000000" },
    {
      wall: () => 0,
      mono: () => 0n,
      schedule: () => 1,
      cancel: () => cancelled++,
      terminate: () => assert.fail("quiet watchdog must clear"),
    },
  );
  assert.equal(quiet.release(true, 0), true);
  assert.equal(cancelled, 1);
  let delayedWall = 0,
    lateTerminated = 0;
  const delayed = waitHardWatchdog(
    { wallEnd: 600000, monoEnd: "600000000000" },
    {
      wall: () => delayedWall,
      mono: () => 0n,
      schedule: () => 1,
      cancel: () =>
        assert.fail("expired watchdog cleared before its delayed timer"),
      terminate: () => lateTerminated++,
    },
  );
  delayedWall = 630000;
  assert.equal(delayed.release(true, 0), false);
  assert.equal(lateTerminated, 1);
});
test(
  "SDK wait exact parent keeps hard watchdog through pending persistence and preserves original null with no late success",
  { timeout: 1000 },
  async () => {
    const f = waitParentFixture();
    let wall = 0,
      mono = 0n,
      tick,
      beginPersist,
      lateResolve;
    const began = new Promise((r) => (beginPersist = r)),
      terminations = [],
      terminals = [];
    f.scope.clock = () => ({
      wallEnd: 600000,
      monoEnd: "600000000000",
      remaining: () => 600000,
      cleanup: () => 30000,
    });
    f.scope.hardWatchdog = (budget, options) =>
      waitHardWatchdog(budget, {
        ...options,
        wall: () => wall,
        mono: () => mono,
        schedule: (fn) => {
          tick = fn;
          return 1;
        },
        cancel: () => assert.fail("unconfirmed watchdog cleared"),
        terminate: (fact) => terminations.push(fact),
      });
    f.scope.compileSlice = async () => {
      throw null;
    };
    f.scope.cleanupOwned = async () => ({
      rows: [{ removed: false }],
      failed: true,
      first: new Error("secondary"),
    });
    const save = f.scope.save;
    f.scope.save = async (file, value) => {
      if (!file.endsWith("/outcome.json")) return save(file, value);
      assert.equal(value.complete, false);
      assert.equal(value.primaryWasNull, true);
      const pending = new Promise((r) => (lateResolve = r));
      f.scope.pendingIO.add(pending);
      beginPersist();
      try {
        return await waitBounded(
          () => pending,
          () => 25,
        );
      } finally {
        pending.then(() => f.scope.pendingIO.delete(pending));
      }
    };
    f.scope.console = {
      log: (value) => terminals.push(JSON.parse(value)),
      error: () => {},
    };
    let rejected = false,
      original;
    const operation = f
      .build()(f.e)
      .catch((e) => {
        rejected = true;
        original = e;
      });
    await began;
    wall = 630000;
    mono = 630000000000n;
    tick();
    assert.equal(terminations.length, 1);
    assert.equal(terminations[0].primaryWasNull, true);
    assert.equal(terminations[0].pendingIoCount, 1);
    await operation;
    assert.equal(rejected, true);
    assert.equal(original, null);
    assert(terminals.every((v) => v.complete === false));
    lateResolve();
    await Promise.resolve();
    assert(terminals.every((v) => v.complete === false));
  },
);
test("SDK wait B is explicitly not run when A consumes the worst original stage allowance", async () => {
  const f = waitParentFixture();
  let wall = Date.now();
  f.scope.Date = { now: () => wall };
  const slice = f.scope.compileSlice;
  f.scope.compileSlice = async (...args) => {
    const result = await slice(...args);
    wall += 65000;
    return result;
  };
  await assert.rejects(f.build()(f.e), /SDK_WAIT_STAGE_ADMISSION/);
  assert.deepEqual(f.launches, ["A"]);
  const outcome = JSON.parse(f.files.get(waitRoot + "/outcome.json"));
  assert.equal(outcome.complete, false);
  assert.deepEqual(outcome.variants[1], {
    variant: "B",
    notRun: true,
    reason: "INSUFFICIENT_ORIGINAL_STAGE_BUDGET",
  });
});
test(
  "SDK wait actual benign CLI watchdog exits despite a live interval instead of relying on exitCode",
  { timeout: 3000 },
  async () => {
    const module = new URL(
      "../../native/mac-sdk-wait-diagnostic.mjs",
      import.meta.url,
    ).href;
    const program =
      "import(" +
      JSON.stringify(module) +
      ").then(({hardWatchdog})=>{hardWatchdog({wallEnd:Date.now()-29940,monoEnd:String(process.hrtime.bigint()-29940000000n)});setInterval(()=>{},1000);})";
    const result = await new Promise((resolve) =>
      actualExecFile(
        process.execPath,
        ["-e", program],
        { timeout: 1500, maxBuffer: 1024 },
        (error) => resolve(error),
      ),
    );
    assert.equal(result.code, 1);
    assert.equal(result.killed, false);
  },
);

import { fileURLToPath } from "node:url";
import {
  plan as waitMaintainedPlan,
  validateRunnerMap as waitMaintainedRunnerMap,
} from "../../scripts/cef-runtime-ci.mjs";
test("SDK wait actual maintained input-admission chain uses the checked-in namespace/map and required target", async () => {
  const f = waitParentFixture(),
    checkout = fileURLToPath(new URL("../../", import.meta.url));
  const profile = checkpointHost("aarch64-apple-darwin", "darwin", "x64");
  const admitted = await waitMaintainedPlan({
    inputs: profile.inputs,
    target: profile.target,
    checkout,
    runnerMode: "hosted",
  });
  assert.equal(
    identitySha256(admitted.sourceLock),
    "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
  );
  const raw = await readFile(
    path.join(admitted.inputsRoot, "cef-ci-runner-aarch64-apple-darwin.json"),
  );
  assert.equal(
    hash(raw),
    "d7667c93c6e5449e3765169a170bb72cca6916c86b5a83f687462ad057736af4",
  );
  const parsed = JSON.parse(raw);
  assert.throws(
    () => waitMaintainedRunnerMap(parsed),
    /Runner map target\/schema mismatch/,
  );
  assert.equal(
    waitMaintainedRunnerMap(parsed, profile.target).target,
    profile.target,
  );
  // Actual parent uses ALL maintained input APIs and real checked-in pinned bytes.
  // Later installed-tool, filesystem and process boundaries stay controlled: no Darwin claim.
  f.scope.checkpointHost = checkpointHost;
  f.scope.plan = waitMaintainedPlan;
  f.scope.identitySha256 = identitySha256;
  f.scope.validateRunnerMap = waitMaintainedRunnerMap;
  f.scope.process = { ...f.scope.process, cwd: () => checkout };
  const held = f.scope.held;
  f.scope.held = async (file, ...rest) =>
    file.includes("cef-ci-runner-") ? raw : held(file, ...rest);
  const result = await f.build()(f.e);
  assert.deepEqual(f.launches, ["A", "B"]);
  assert.equal(result.variants.length, 2);
});
test("SDK wait terminal reasons are closed before root creation and absent-root upload is skipped", () => {
  assert.equal(
    waitPrimaryReason(new Error("Runner map target/schema mismatch")),
    "SDK_WAIT_RUNNER_MAP_TARGET_SCHEMA",
  );
  assert.equal(waitPrimaryReason(null), "SDK_WAIT_NULL_PRIMARY");
  assert.equal(
    waitPrimaryReason(new Error("secret/path/token")),
    "SDK_WAIT_UNKNOWN_PRIMARY",
  );
  assert.equal(
    waitPrimaryReason({
      get message() {
        throw new Error("private getter");
      },
    }),
    "SDK_WAIT_UNKNOWN_PRIMARY",
  );
  assert.equal(
    workflow.jobs.sdk_wait.steps.find(
      (s) => s.name === "Retain bounded SDK wait diagnostics",
    ).if,
    "always() && steps.sdk_wait.outputs.diagnostic_root != ''",
  );
});
