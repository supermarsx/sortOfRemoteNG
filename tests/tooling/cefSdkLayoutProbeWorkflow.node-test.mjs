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

test("SDK layout defaults remain public/default-branch and census requires its exact opt-in branch", () => {
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
    "github.event_name == 'workflow_dispatch' && github.event.repository.visibility == 'public' && ((inputs.external_census == true && github.repository == 'supermarsx/sortOfRemoteNG' && github.ref == 'refs/heads/codex/ci-mac-external-census-20261026') || (inputs.external_census != true && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)))",
  );
  assert.equal(job.permissions, undefined);
  assert.equal(job["runs-on"], "macos-15-intel");
  assert.equal(
    job["timeout-minutes"],
    "${{ (inputs.metal_tools || inputs.external_census) && 15 || 10 }}",
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
        step.name !== "Diagnose selected Apple Metal tools" &&
        step.name !==
          "Observe closed Mac external inputs and owned capabilities",
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
      step.name !== "Diagnose selected Apple Metal tools" &&
      step.name !== "Observe closed Mac external inputs and owned capabilities"
    )
      assert.equal(step.env, undefined);
  const metal = job.steps.find(
    (step) => step.name === "Diagnose selected Apple Metal tools",
  );
  assert.equal(
    metal.if,
    "inputs.metal_tools == true && inputs.external_census != true",
  );
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
    path: "${{ runner.temp }}/cef-sdk-layout-probe.log\n${{ runner.temp }}/cef-sdk-probe-prerequisites\n${{ runner.temp }}/cef-metal-tools-probe\n${{ steps.external_census.outputs.census_root }}\n",
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
import {
  prepareMacMetalToolchain,
  macMetalFingerprint,
} from "../../scripts/cef-hosted-provision.mjs";
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
import { constants as censusFsConstants } from "node:fs";
import { execFile as censusActualExecFile } from "node:child_process";
import {
  macExternalObservationPlan as sharedExternalPlan,
  macSdkRelation as sharedSdkRelation,
} from "../../scripts/lib/cef-mac-source-metadata.mjs";
const censusStep = job.steps.find((step) => step.id === "external_census");
const censusBody = censusStep.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
const censusFunctions = censusBody.slice(
  censusBody.indexOf("const CENSUS_BRANCH"),
  censusBody.indexOf("async function runExternalCensus"),
);
const censusProgram = censusBody.slice(
  censusBody.indexOf("const CENSUS_BRANCH"),
  censusBody.lastIndexOf("\ntry {"),
);
const censusRoot =
  "/Users/runner/work/_temp/cef-mac-inputs-11111111-1111-4111-8111-111111111111";
function censusEnv() {
  return {
    EXTERNAL_CENSUS_ENABLED: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_REPOSITORY: "supermarsx/sortOfRemoteNG",
    GITHUB_REF: "refs/heads/codex/ci-mac-external-census-20261026",
    GITHUB_WORKFLOW_REF:
      "supermarsx/sortOfRemoteNG/.github/workflows/cef-sdk-layout-probe.yml@refs/heads/codex/ci-mac-external-census-20261026",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "1",
    GITHUB_RUN_ATTEMPT: "1",
    RUNNER_TEMP: "/Users/runner/work/_temp",
    GITHUB_OUTPUT: "/owned/github-output",
  };
}
function censusApi(extra = {}) {
  const context = vm.createContext({
    assert,
    path,
    Buffer,
    performance,
    Date,
    setTimeout,
    clearTimeout,
    constants: censusFsConstants,
    createHash,
    process: { platform: "darwin", arch: "x64", getuid: () => 501 },
    ...extra,
  });
  new vm.Script(
    censusFunctions +
      "\nglobalThis.api={censusAuthority,censusClock,censusAppleTimeout,fixedAppleCommand,censusWorker,readCapability};",
  ).runInContext(context);
  return { context, ...context.api };
}
function fakeWorkerPlan() {
  return {
    python: "/selected/python",
    context: { outputRoot: censusRoot },
    argv: (mode, file) => [
      "-I",
      "-B",
      "scripts/lib/cef-checkpoint-archive.py",
      mode,
      "--input",
      file,
      "--output",
      censusRoot +
        (mode === "mac-external-observe"
          ? "/external.json"
          : "/capability.json"),
      "--seconds",
      "1",
    ],
  };
}
function fakeChild() {
  const child = new EventEmitter();
  return Object.assign(child, {
    pid: 1234,
    stdout: { destroy() {} },
    stderr: { destroy() {} },
    kill() {
      child.kills = (child.kills ?? 0) + 1;
      return true;
    },
    unref() {
      child.unreferenced = true;
    },
  });
}

test("census dispatch matrix preserves defaults and requires exact private opt-in branch", () => {
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.external_census, {
    description:
      "Observe closed ARM-target Mac external inputs and owned timestamp capabilities; permits reviewed fixed Metal preparation",
    type: "boolean",
    required: false,
    default: false,
  });
  const allow = (
    external,
    ref,
    repository = "supermarsx/sortOfRemoteNG",
    visibility = "public",
  ) =>
    vm.runInNewContext(job.if, {
      inputs: { external_census: external },
      github: {
        event_name: "workflow_dispatch",
        repository,
        ref,
        event: { repository: { visibility, default_branch: "main" } },
      },
      format: (s, v) => s.replace("{0}", v),
    });
  assert.equal(allow(false, "refs/heads/main"), true);
  assert.equal(
    allow(false, "refs/heads/codex/ci-mac-external-census-20261026"),
    false,
  );
  assert.equal(allow(true, "refs/heads/main"), false);
  assert.equal(
    allow(true, "refs/heads/codex/ci-mac-external-census-20261026"),
    true,
  );
  assert.equal(
    allow(
      true,
      "refs/heads/codex/ci-mac-external-census-20261026",
      "fork/repo",
    ),
    false,
  );
  assert.equal(
    allow(
      true,
      "refs/heads/codex/ci-mac-external-census-20261026",
      "supermarsx/sortOfRemoteNG",
      "private",
    ),
    false,
  );
  for (const step of job.steps.filter((s) =>
    [
      "Prepare existing fixed reviewed native prerequisites",
      "Probe selected native SDK links without acquiring sources",
    ].includes(s.name),
  ))
    assert.equal(step.if, "inputs.external_census != true");
  assert.equal(censusStep.if, "inputs.external_census == true");
  assert.equal(
    metalStep.if,
    "inputs.metal_tools == true && inputs.external_census != true",
  );
  assert.match(censusBody, /await prepareMacMetalToolchain/);
  assert.equal(
    (censusBody.match(/await prepareMacMetalToolchain/g) ?? []).length,
    1,
  );
});
test("actual census authority denies before IO and numeric adapter keeps original floor-down clocks", () => {
  const api = censusApi();
  api.censusAuthority(censusEnv(), "darwin", "x64");
  for (const [key, value] of [
    ["EXTERNAL_CENSUS_ENABLED", "false"],
    ["GITHUB_REF", "refs/heads/main"],
    ["GITHUB_WORKFLOW_REF", "other"],
    ["GITHUB_REPOSITORY", "fork/repo"],
    ["GH_TOKEN", "secret"],
    ["RUNNER_TEMP", "/other"],
  ])
    assert.throws(
      () =>
        api.censusAuthority({ ...censusEnv(), [key]: value }, "darwin", "x64"),
      /CENSUS_AUTHORITY/,
    );
  let mono = 0,
    wall = 1000;
  const clock = api.censusClock(
    () => mono,
    () => wall,
  );
  mono = 0.8;
  assert.equal(clock.remaining(), 599999);
  assert.ok(Number.isSafeInteger(clock.remaining()));
  mono = 600000;
  assert.throws(() => clock.remaining(), /DEADLINE/);
  assert.equal(clock.cleanup(), 30000);
  mono = 630000;
  assert.throws(() => clock.cleanup(), /CLEANUP_UNCONFIRMED/);
  const before = censusApi({
    realpath: () => {
      throw new Error("IO must not start");
    },
    process: { env: {}, platform: "darwin", arch: "x64" },
  }).context;
  new vm.Script(
    censusProgram.slice(
      censusProgram.indexOf("async function runExternalCensus"),
    ) + "\nglobalThis.run=runExternalCensus;",
  ).runInContext(before);
  return assert.rejects(before.run(), /CENSUS_AUTHORITY/);
});
test("census Apple command surface accepts only existing exact prerequisite vectors", () => {
  const { fixedAppleCommand: check } = censusApi();
  check("/usr/bin/xcrun", ["-sdk", "macosx", "--show-sdk-path"]);
  check("/usr/bin/xcodebuild", ["-downloadComponent", "MetalToolchain"]);
  check("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--all-architectures",
    "-R=anchor apple",
    "/owned/air-lld",
  ]);
  for (const [f, a] of [
    ["sh", ["-c", "x"]],
    ["/usr/bin/xcodebuild", ["-downloadAllPlatforms"]],
    ["/usr/bin/xcrun", ["clang", "--version"]],
  ])
    assert.throws(() => check(f, a), /CENSUS_APPLE_COMMAND/);
});
test("actual closed worker waits for callback AND close, preserves null/error and bounds retained output", async () => {
  const api = censusApi(),
    plan = fakeWorkerPlan(),
    rows = [];
  let child, callback;
  const execute = (file, args, options, cb) => {
    assert.equal(file, plan.python);
    assert.equal(options.killSignal, "SIGKILL");
    assert.equal(options.timeout, 1000);
    assert.equal(options.maxBuffer, 1048576);
    callback = cb;
    child = fakeChild();
    return child;
  };
  const pending = api.censusWorker(
    plan,
    "mac-external-observe",
    censusRoot + "/context.json",
    () => 1000,
    () => 2000,
    async (row, out, err) => rows.push({ row, out, err }),
    execute,
  );
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  callback(null, JSON.stringify({ complete: true }), "x".repeat(70000));
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit("exit", 0);
  child.emit("close", 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), {
    complete: true,
  });
  assert.equal(rows[0].err.length, 65536);
  assert.equal(rows[0].row.stderrTruncated, true);
  assert.equal(rows[0].row.closed, true);
  const marker = new Error("original");
  for (const value of [null, marker, false]) {
    let c;
    const p = api.censusWorker(
      plan,
      "mac-external-observe",
      censusRoot + "/context.json",
      () => 1000,
      () => 2000,
      async () => {
        throw new Error("secondary");
      },
      (_f, _a, _o, cb) => {
        c = fakeChild();
        queueMicrotask(() => {
          c.emit("error", value);
          cb(marker, "", "");
          c.emit("exit", 7);
          c.emit("close", 7);
        });
        return c;
      },
    );
    await assert.rejects(p, (e) => e === value);
  }
});
test("closed worker denies wrong mode/argv before spawn and records unconfirmed callback without extending cleanup", async () => {
  const api = censusApi(),
    plan = fakeWorkerPlan();
  let calls = 0;
  const execute = () => {
    calls++;
    return fakeChild();
  };
  assert.throws(
    () =>
      api.censusWorker(
        plan,
        "other",
        censusRoot + "/context.json",
        () => 1,
        () => 2,
        () => {},
        execute,
      ),
    /MODE/,
  );
  assert.throws(
    () =>
      api.censusWorker(
        { ...plan, argv: () => ["bad"] },
        "mac-external-observe",
        censusRoot + "/context.json",
        () => 1,
        () => 2,
        () => {},
        execute,
      ),
    /ARGV/,
  );
  assert.equal(calls, 0);
  let child;
  const began = performance.now();
  await assert.rejects(
    api.censusWorker(
      plan,
      "mac-external-observe",
      censusRoot + "/context.json",
      () => 5,
      () => 25,
      () => {},
      () => {
        child = fakeChild();
        return child;
      },
    ),
    /DEADLINE/,
  );
  assert.ok(performance.now() - began < 1000);
  assert.equal(child.unreferenced, true);
  assert.ok(child.kills >= 1);
});
test("actual closed adapter kills and joins a real benign timed child before rejecting", async () => {
  const api = censusApi(),
    plan = fakeWorkerPlan(),
    rows = [];
  let actual;
  await assert.rejects(
    api.censusWorker(
      plan,
      "mac-external-observe",
      censusRoot + "/context.json",
      () => 100,
      () => 2000,
      async (row) => rows.push(row),
      (_file, _args, options, callback) => {
        actual = censusActualExecFile(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)"],
          options,
          callback,
        );
        return actual;
      },
    ),
  );
  const terminal = rows.filter((row) => row.snapshot === "terminal");
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].closed, true);
  assert.equal(terminal[0].exitSeen, true);
  assert.notEqual(actual.signalCode, null);
});
function capabilityFixture() {
  const stat = () =>
    Object.fromEntries(
      [
        "dev",
        "ino",
        "mode",
        "nlink",
        "size",
        "uid",
        "gid",
        "atime_ns",
        "mtime_ns",
        "ctime_ns",
      ]
        .map((k) => [k, "1"])
        .concat([
          ["birthtimeNsAvailable", false],
          ["birthtimeNs", null],
        ]),
    );
  const value = {
    schemaVersion: 1,
    kind: "sorng-macarm-owned-capability-observation",
    target: "aarch64-apple-darwin",
    complete: true,
    cleanupConfirmed: true,
    objectsRemoved: true,
    handlesClosed: true,
    error: null,
    sourceWriteAdmitted: false,
    installedInputsWritten: false,
    nativeAcceptance: false,
    runtimeReady: false,
    rows: ["file", "directory", "root", "symlink"].flatMap((role) =>
      ["no-op", "past", "future"].map((case_) => ({
        role,
        case: case_,
        requestedMtimeNs: "1",
        before: stat(),
        after: stat(),
        heldBefore: role === "symlink" ? null : stat(),
        heldAfter: role === "symlink" ? null : stat(),
        exactMtimeReadback: false,
      })),
    ),
  };
  return value;
}
function capabilityRead(getBody) {
  return async (buffer, offset, length, position) => {
    const body = getBody();
    const chunk = body.subarray(position, position + length);
    chunk.copy(buffer, offset);
    return { bytesRead: chunk.length };
  };
}
function capabilityIo(value = capabilityFixture()) {
  const body = Buffer.from(JSON.stringify(value)),
    pin = { name: "capability.json", bytes: body.length, sha256: hash(body) };
  const parent = {
    dev: 1n,
    ino: 2n,
    mode: 0o40700n,
    uid: 501n,
    gid: 20n,
    birthtimeNs: 0n,
    isDirectory: () => true,
  };
  const file = {
    ...parent,
    ino: 3n,
    mode: 0o100600n,
    nlink: 1n,
    size: BigInt(body.length),
    mtimeNs: 1n,
    ctimeNs: 1n,
    isFile: () => true,
  };
  let closed = 0;
  const io = {
    lstat: async (p) => (p === censusRoot ? parent : file),
    open: async () => ({
      stat: async () => file,
      readFile: async () => body,
      read: capabilityRead(() => body),
      close: async () => {
        closed++;
      },
    }),
  };
  return { body, pin, parent, file, io, closed: () => closed };
}
test("actual capability reader verifies held bytes/parent/closed schema without inventing timestamp policy", async () => {
  const api = censusApi(),
    f = capabilityIo();
  const result = await api.readCapability(
    censusRoot + "/capability.json",
    f.pin,
    () => {},
    f.parent,
    f.io,
    501,
  );
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows[0].exactMtimeReadback, false);
  assert.equal(f.closed(), 1);
  for (const mutate of [
    (v) => (v.sourceWriteAdmitted = true),
    (v) => (v.extra = true),
    (v) => (v.rows[0].role = "other"),
    (v) => (v.rows[0].before = null),
    (v) => (v.rows[0].after.birthtimeNs = "invented"),
    (v) => (v.rows[1] = { ...v.rows[0] }),
  ]) {
    const value = capabilityFixture();
    mutate(value);
    const bad = capabilityIo(value);
    await assert.rejects(
      api.readCapability(
        censusRoot + "/capability.json",
        bad.pin,
        () => {},
        bad.parent,
        bad.io,
        501,
      ),
      /CENSUS_CAPABILITY/,
    );
    assert.equal(bad.closed(), 1);
  }
});
test("capability reader rejects unknown path/link/overbound/retarget and preserves null through close failure", async () => {
  const api = censusApi(),
    f = capabilityIo();
  await assert.rejects(
    api.readCapability(
      "/other/capability.json",
      f.pin,
      () => {},
      f.parent,
      f.io,
      501,
    ),
    /PATH/,
  );
  await assert.rejects(
    api.readCapability(
      censusRoot + "/capability.json",
      { ...f.pin, bytes: 65537 },
      () => {},
      f.parent,
      f.io,
      501,
    ),
    /PIN/,
  );
  const link = capabilityIo();
  link.file.isFile = () => false;
  await assert.rejects(
    api.readCapability(
      censusRoot + "/capability.json",
      link.pin,
      () => {},
      link.parent,
      link.io,
      501,
    ),
    /FILE/,
  );
  const bad = capabilityIo();
  let checks = 0;
  bad.io.open = async () => ({
    stat: async () => bad.file,
    readFile: async () => bad.body,
    read: capabilityRead(() => bad.body),
    close: async () => {
      throw new Error("secondary");
    },
  });
  await assert.rejects(
    api.readCapability(
      censusRoot + "/capability.json",
      bad.pin,
      () => {
        if (++checks === 2) throw null;
      },
      bad.parent,
      bad.io,
      501,
    ),
    (e) => e === null,
  );
  const replaced = capabilityIo();
  let stats = 0;
  replaced.io.open = async () => ({
    stat: async () =>
      ++stats === 1 ? replaced.file : { ...replaced.file, ino: 99n },
    readFile: async () => replaced.body,
    read: capabilityRead(() => replaced.body),
    close: async () => {},
  });
  await assert.rejects(
    api.readCapability(
      censusRoot + "/capability.json",
      replaced.pin,
      () => {},
      replaced.parent,
      replaced.io,
      501,
    ),
    /IDENTITY/,
  );
});
async function censusPipelineFixture() {
  const target = "aarch64-apple-darwin",
    profile = checkpointHost(target, "darwin", "x64"),
    base = profile.inputs + "/";
  const lock = JSON.parse(await read(base + "source-lock.json")),
    build = lock.builds.find((row) => row.target === target),
    toolBytes = Buffer.from(await read(base + build.toolchainLock.path)),
    toolchain = JSON.parse(toolBytes),
    mapBytes = Buffer.from(
      await read(base + "cef-ci-runner-aarch64-apple-darwin.json"),
    );
  const developer = "/Applications/Xcode_26.3.app/Contents/Developer",
    metalRoot =
      "/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/" +
      "a".repeat(40) +
      "/Metal.xctoolchain";
  const metal = {
    kind: "selected-mac-metal-observation",
    provenance: "newly-observed-apple-component-not-prepinned",
    developerDir: developer,
    componentResourceClosureVerified: false,
    downloaded: true,
    tools: [
      {
        role: "metal",
        location: "external-metal-toolchain",
        appleAnchorVerified: true,
        bytes: 10,
        sha256: "b".repeat(64),
        version: "1.0",
        versionSource: "tool-output",
        pairedCompilerVersion: null,
        physicalPath: metalRoot + "/usr/bin/metal",
      },
      {
        role: "metallib",
        location: "external-metal-toolchain",
        appleAnchorVerified: true,
        bytes: 20,
        sha256: "c".repeat(64),
        version: null,
        versionSource: "not-observed",
        pairedCompilerVersion: "1.0",
        physicalPath: metalRoot + "/usr/bin/air-lld",
      },
    ],
  };
  const files = new Map(),
    calls = [],
    transport = [],
    rootStat = {
      dev: 1n,
      ino: 2n,
      uid: 501n,
      gid: 20n,
      mode: 0o40700n,
      birthtimeNs: 0n,
      isDirectory: () => true,
    };
  const stat = (file) =>
    file === censusRoot
      ? rootStat
      : {
          ...rootStat,
          ino: 3n,
          mode: 0o100600n,
          nlink: 1n,
          size: BigInt(files.get(file)?.length ?? 0),
          mtimeNs: 1n,
          ctimeNs: 1n,
          isFile: () => true,
        };
  const api = {
    path: path.posix,
    process: {
      env: censusEnv(),
      platform: "darwin",
      arch: "x64",
      getuid: () => 501,
      cwd: () => "/checkout",
    },
    randomUUID: () =>
      path.posix.basename(censusRoot).slice("cef-mac-inputs-".length),
    checkpointHost,
    canonical: JSON.stringify,
    identitySha256,
    macMetalFingerprint,
    macExternalObservationPlan: sharedExternalPlan,
    macSdkRelation: async (options) =>
      sharedSdkRelation(options, {
        lstat: async (name) => ({
          dev: 1n,
          ino: 1n,
          nlink: 1n,
          size: 1n,
          mode: 1n,
          birthtimeNs: 1n,
          mtimeNs: 1n,
          ctimeNs: 1n,
          isSymbolicLink: () => name.endsWith("MacOSX26.2.sdk"),
          isDirectory: () => name.endsWith("/MacOSX.sdk"),
        }),
        readlink: async () => "MacOSX.sdk",
        realpath: async () =>
          developer + "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
      }),
    realpath: async (value) => value,
    mkdir: async (value, options) => {
      assert.equal(value, censusRoot);
      assert.equal(options.mode, 0o700);
      calls.push("mkdir");
    },
    lstat: async (file) => stat(file),
    appendFile: async (file, line) => {
      assert.equal(file, "/owned/github-output");
      assert.equal(line, "census_root=" + censusRoot + "\n");
    },
    writeFile: async (file, body, options) => {
      assert.equal(options.flag, "wx");
      assert.ok(file.startsWith(censusRoot + "/"));
      assert.equal(files.has(file), false);
      files.set(file, Buffer.from(body));
    },
    readFile: async (file) => {
      if (file === "/selected-inputs/" + build.toolchainLock.path)
        return toolBytes;
      if (file === "/selected-inputs/cef-ci-runner-aarch64-apple-darwin.json")
        return mapBytes;
      throw new Error("unexpected input read");
    },
    open: async (file) => {
      assert.equal(file, censusRoot + "/capability.json");
      return {
        stat: async () => stat(file),
        readFile: async () => files.get(file),
        read: capabilityRead(() => files.get(file)),
        close: async () => calls.push("cap-close"),
      };
    },
    plan: async (options) => {
      assert.equal(options.target, target);
      assert.equal(options.inputs, profile.inputs);
      assert.equal(options.runnerMode, "hosted");
      calls.push("plan");
      return { sourceLock: lock, inputsRoot: "/selected-inputs" };
    },
    validateRunnerMap: (value) => {
      calls.push("map");
      return value;
    },
    assertHostedBuildIdentity: () => calls.push("host"),
    verifyToolchainFiles: async (options) => {
      assert.equal(options.python, "/" + JSON.parse(mapBytes).python);
      assert.equal(options.runnerMapFromInputs, true);
      calls.push("pins");
      return { filesVerified: toolchain.files.length };
    },
    selectedSdkPreflight: async (options) => {
      calls.push("sdk");
      await options.run(
        "/usr/bin/xcrun",
        ["-sdk", "macosx", "--show-sdk-path"],
        { timeout: 5000 },
      );
    },
    prepareMacMetalToolchain: async (options, dependencies) => {
      calls.push("metal");
      assert.equal(options.allowDownload, true);
      assert.ok(Number.isSafeInteger(options.remainingMilliseconds()));
      await dependencies.exec(
        "/usr/bin/xcodebuild",
        ["-downloadComponent", "MetalToolchain"],
        { timeout: 600000 },
      );
      return metal;
    },
    execFile: () => {
      throw new Error("unexpected direct exec");
    },
    promisify: () => async (_file, _args, options) => {
      transport.push(options);
      assert.ok(Number.isSafeInteger(options.timeout));
      assert.equal(options.killSignal, "SIGKILL");
      return { stdout: "fixed owned tool output", stderr: "" };
    },
    readMacExternalObservation: async (_plan, summary, check) => {
      calls.push("reader");
      check();
      assert.equal(summary.complete, true);
      return { proof: true };
    },
    macExternalToolsBinding: (_base, proof) => {
      assert.equal(proof.proof, true);
      return { macExternalInputs: { roles: [], sourceWriteAdmitted: false } };
    },
    macExternalObservationEvidence: () => ({
      snapshot: { name: "external.json", bytes: 1, sha256: "d".repeat(64) },
      physicalRoots: { sdk: developer },
      sourceWriteAdmitted: false,
    }),
  };
  const context = censusApi(api).context;
  new vm.Script(
    censusProgram.slice(
      censusProgram.indexOf("async function runExternalCensus"),
    ) + "\nglobalThis.run=runExternalCensus;",
  ).runInContext(context);
  context.censusWorker = async (
    selected,
    mode,
    contextFile,
    remaining,
    cleanup,
    persist,
  ) => {
    assert.equal(selected.context.outputRoot, censusRoot);
    assert.equal(contextFile, censusRoot + "/context.json");
    assert.ok(Number.isSafeInteger(remaining()));
    assert.ok(cleanup() > 0);
    calls.push(mode);
    await persist(
      {
        mode,
        snapshot: "terminal",
        closed: true,
        exitSeen: true,
        failed: false,
        stdoutObserved: 0,
        stdoutTruncated: false,
        stderrObserved: 0,
        stderrTruncated: false,
      },
      Buffer.alloc(0),
      Buffer.alloc(0),
    );
    if (mode === "mac-owned-capability-observe") {
      const body = Buffer.from(JSON.stringify(capabilityFixture()));
      files.set(censusRoot + "/capability.json", body);
      return {
        complete: true,
        kind: "sorng-macarm-owned-capability-observation",
        rows: 12,
        observation: {
          name: "capability.json",
          bytes: body.length,
          sha256: hash(body),
        },
      };
    }
    return { complete: true, kind: "sorng-macarm-external-input-observation" };
  };
  return {
    context,
    calls,
    files,
    transport,
    readOutcome: () => JSON.parse(files.get(censusRoot + "/outcome.json")),
  };
}
test("actual census pipeline verifies cross profile/tools, prepares once, then observes capability before readonly census", async () => {
  const f = await censusPipelineFixture();
  const result = await f.context.run();
  assert.equal(result.complete, true);
  assert.equal(result.target, "aarch64-apple-darwin");
  assert.equal(result.hostArchitecture, "x64");
  assert.equal(result.sourceWriteAdmitted, false);
  assert.equal(result.sourceWritten, false);
  assert.equal(result.installedInputsWrittenByCapability, false);
  assert.equal(result.externalCensusWritesInstalledInputs, false);
  assert.equal(result.metalPreparationDownloaded, true);
  assert.equal(result.capabilityFixtureWritten, true);
  assert.equal(result.capability.exactMtimeReadback, false);
  assert.deepEqual(f.calls, [
    "mkdir",
    "plan",
    "map",
    "host",
    "pins",
    "sdk",
    "metal",
    "mac-owned-capability-observe",
    "cap-close",
    "mac-external-observe",
    "reader",
  ]);
  assert.equal(f.calls.filter((x) => x === "metal").length, 1);
  assert.equal(f.transport.length, 2);
  assert.ok(f.files.has(censusRoot + "/context.json"));
  assert.equal(f.readOutcome().nativeAcceptance, false);
  assert.equal(f.readOutcome().checkpointReady, false);
});
test("actual census pipeline preserves first null and stops at tool/Metal/capability failures without fabricated write proof", async () => {
  for (const phase of ["pins", "metal", "capability"]) {
    const f = await censusPipelineFixture();
    if (phase === "pins")
      f.context.verifyToolchainFiles = async () => {
        throw null;
      };
    if (phase === "metal")
      f.context.prepareMacMetalToolchain = async () => {
        throw null;
      };
    if (phase === "capability")
      f.context.censusWorker = async () => {
        throw null;
      };
    await assert.rejects(f.context.run(), (e) => e === null);
    const outcome = f.readOutcome();
    assert.equal(outcome.complete, false);
    assert.equal(outcome.sourceWriteAdmitted, false);
    assert.equal(
      outcome.capabilityFixtureWritten,
      phase === "capability" ? null : false,
    );
    assert.equal(f.calls.includes("mac-external-observe"), false);
  }
});
test("timed worker retains bounded partial bytes before cleanup and never reports late close as success", async () => {
  const api = censusApi(),
    plan = fakeWorkerPlan(),
    records = [];
  let child, callback;
  const pending = api.censusWorker(
    plan,
    "mac-external-observe",
    censusRoot + "/context.json",
    () => 10,
    () => 35,
    async (row, out, err) => records.push({ row, out, err }),
    (_f, _a, _o, cb) => {
      callback = cb;
      child = fakeChild();
      child.stdout = Object.assign(new EventEmitter(), { destroy() {} });
      child.stderr = Object.assign(new EventEmitter(), { destroy() {} });
      return child;
    },
  );
  child.stdout.emit("data", Buffer.alloc(70000, 120));
  await assert.rejects(pending, /DEADLINE/);
  assert.equal(records.length, 1);
  assert.equal(records[0].row.snapshot, "work-timeout");
  assert.equal(records[0].row.closed, false);
  assert.equal(records[0].out.length, 65536);
  assert.equal(records[0].row.stdoutObserved, 70000);
  assert.equal(records[0].row.stdoutTruncated, true);
  callback(null, '{"complete":true}', "");
  child.emit("exit", 0);
  child.emit("close", 0);
  await Promise.resolve();
  assert.equal(records.length, 1);
});

test("actual worker keeps original cleanup deadline through hanging persistence and preserves first null/error", async () => {
  for (const primary of [undefined, null, new Error("original")]) {
    const diagnostics = [],
      api = censusApi({
        console: { error: (value) => diagnostics.push(JSON.parse(value)) },
      }),
      plan = fakeWorkerPlan();
    let child, release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const started = performance.now();
    const operation = api.censusWorker(
      plan,
      "mac-external-observe",
      censusRoot + "/context.json",
      () => 10,
      () => 45,
      () => held,
      (_file, _args, _options, callback) => {
        child = fakeChild();
        queueMicrotask(() => {
          if (primary !== undefined) child.emit("error", primary);
          callback(null, '{"complete":true}', "");
          child.emit("exit", 0);
          child.emit("close", 0);
        });
        return child;
      },
    );
    const outcome = await Promise.race([
      operation.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve({ outerGuard: true }), 200),
      ),
    ]);
    assert.notEqual(
      outcome.outerGuard,
      true,
      "actual cleanup timer must bound pending persistence",
    );
    assert.equal(outcome.ok, false);
    if (primary === undefined)
      assert.match(outcome.error.message, /PERSISTENCE_UNCONFIRMED/);
    else assert.equal(outcome.error, primary);
    assert.ok(performance.now() - started < 180);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].childClosed, true);
    assert.equal(diagnostics[0].persistencePending, true);
    assert.equal(diagnostics[0].persistenceJoined, false);
    assert.equal(diagnostics[0].cleanupConfirmed, false);
    release();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(outcome.ok, false);
  }
});
test("actual capability FD reads remain within pinned bytes plus one when content grows after open", async () => {
  const api = censusApi(),
    fixture = capabilityIo(),
    growth = Buffer.concat([fixture.body, Buffer.alloc(100000, 120)]),
    requests = [];
  let closed = 0,
    readFileCalled = false;
  fixture.io.open = async () => ({
    stat: async () => fixture.file,
    readFile: async () => {
      readFileCalled = true;
      return growth;
    },
    read: async (buffer, offset, length, position) => {
      requests.push({ allocated: buffer.length, length, position });
      const part = growth.subarray(position, position + length);
      part.copy(buffer, offset);
      return { bytesRead: part.length };
    },
    close: async () => {
      closed++;
    },
  });
  await assert.rejects(
    api.readCapability(
      censusRoot + "/capability.json",
      fixture.pin,
      () => {},
      fixture.parent,
      fixture.io,
      501,
    ),
    /CENSUS_CAPABILITY_BOUND/,
  );
  assert.equal(readFileCalled, false);
  assert.equal(closed, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].allocated, fixture.pin.bytes + 1);
  assert.equal(requests[0].length, fixture.pin.bytes + 1);
  assert.ok(requests[0].allocated <= 65537);
});

test("census first exact SDK query has a bounded 30s candidate cap within the original clock", () => {
  const { censusAppleTimeout: timeout } = censusApi();
  const file = "/usr/bin/xcrun",
    args = ["-sdk", "macosx", "--show-sdk-path"];
  assert.equal(
    timeout(file, args, { timeout: 5000 }, () => 600000, 1),
    30000,
  );
  assert.equal(
    timeout(file, args, { timeout: 5000 }, () => 7000.9, 1),
    7000,
  );
  assert.equal(
    timeout(file, args, { timeout: 5000 }, () => 600000, 2),
    5000,
  );
  assert.equal(
    timeout(
      file,
      ["-sdk", "macosx", "--show-sdk-platform-path"],
      { timeout: 5000 },
      () => 600000,
      1,
    ),
    5000,
  );
  assert.equal(
    timeout(
      "/usr/bin/xcode-select",
      ["-print-path"],
      { timeout: 5000 },
      () => 600000,
      1,
    ),
    5000,
  );
  assert.throws(
    () => timeout(file, args, { timeout: 5000 }, () => 0, 1),
    /CENSUS_APPLE_DEADLINE/,
  );
});
