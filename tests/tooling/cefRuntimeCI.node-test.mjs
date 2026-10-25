import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { Script } from "node:vm";
import {
  RUNNERS,
  engineeringSdkContinuation,
  engineeringBuildProfile,
  MAX_RELEASE_ASSET,
  WINDOWS_GIT_PROGRAMS,
  WINDOWS_GIT_TEMPLATE_SHA256,
  verifyWindowsGitProgram,
  prepareWindowsGitLauncher,
  PACK_PYTHON,
  boundedBuildCommands,
  build,
  cefHookArguments,
  buildEnvironment,
  createHostedBuildBudget,
  run as runBuildCommand,
  assertHostedBuildIdentity,
  assertHostedCapacity,
  hostedAdmissionRecorder,
  hostedBuildHost,
  descriptorFor,
  flattenSdk,
  githubClient,
  main,
  measure,
  parseArguments,
  plan,
  publish,
  releaseIdentity,
  sourceWorkspace,
  stableJson,
  validateRunnerMap,
  verifyBundle,
} from "../../scripts/cef-runtime-ci.mjs";
import { inventoryCustomArtifact } from "../../scripts/cef-custom-artifact-inventory.mjs";
import {
  acquisitionSourcePlan,
  acquireSources,
  gclientConfiguration,
} from "../../scripts/cef-patched-runtime.mjs";
import {
  BRIDGE_PATCH_ID,
  BRIDGE_V2,
  UPSTREAM_CEF_COMMIT,
  UPSTREAM_CHROMIUM_COMMIT,
  UPSTREAM_DEPOT_TOOLS_COMMIT,
  customRuntimeBuildRecipe,
  identitySha256,
  preflightCustomRuntime,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  CEF_PIN,
  TARGETS,
  inspectNativeBinary,
} from "../../scripts/browser-runtime-package.mjs";
import { RELEASE_LIMITS } from "../../scripts/lib/browser-runtime-release.mjs";
import { checkpointProfile } from "../../scripts/lib/cef-engineering-checkpoint.mjs";

// Synthetic fixture bytes below are not executable engines or production pins.
// No source fetch, CEF build, Cargo, system installer or live GitHub write occurs.
const exec = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pin = (name, bytes) => ({ path: name, sha256: hash(bytes) });
const target = "x86_64-pc-windows-msvc";
const repository = "fixture/engine";
const commit = "b".repeat(40);
const root = fileURLToPath(new URL("../../", import.meta.url));
const bridge = await readFile(
  path.join(root, "native/cef-patches/cef_sorng_tls_bridge.h"),
);
const runner = (selected = target) => ({
  schemaVersion: 1,
  kind: "sorng-cef-ci-runner",
  target: selected,
  python: "python/python.exe",
  path: ["native/bin"],
  syncJobs: 2,
  buildJobs: 4,
  environment: {
    GYP_MSVS_OVERRIDE_PATH: "@TOOLS@/native",
    GYP_MSVS_VERSION: "2026",
  },
});

test("macOS ARM cross-compilation binds the actual reviewed same-OS host image", () => {
  const macTarget = "aarch64-apple-darwin";
  const map = {
    ...runner(macTarget),
    schemaVersion: 2,
    hosted: {
      runner: "macos-15-intel",
      imageOS: "macos15",
      imageVersion: "20260824.0482.1",
      platform: "darwin",
      architecture: "x64",
      acceptanceRunner: "macos-15",
    },
  };
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
  };
  assert.equal(hostedBuildHost(macTarget).runner, "macos-15-intel");
  assert.equal(
    assertHostedBuildIdentity(map, macTarget, env, "darwin", "x64")
      .crossCompiled,
    true,
  );
  for (const patch of [
    { ImageVersion: "new-image" },
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
  ])
    assert.throws(
      () =>
        assertHostedBuildIdentity(
          map,
          macTarget,
          { ...env, ...patch },
          "darwin",
          "x64",
        ),
      /identity changed/,
    );
  assert.throws(
    () => assertHostedBuildIdentity(map, macTarget, env, "linux", "x64"),
    /identity changed/,
  );
  assert.throws(
    () =>
      validateRunnerMap(
        {
          ...map,
          hosted: { ...map.hosted, acceptanceRunner: "macos-15-intel" },
        },
        macTarget,
      ),
    /fixed target/,
  );
  assert.throws(
    () =>
      validateRunnerMap(
        { ...map, hosted: { ...map.hosted, runner: "arbitrary-paid-runner" } },
        macTarget,
      ),
    /fixed target/,
  );
  assert.throws(
    () => validateRunnerMap({ ...map, buildJobs: 5 }, macTarget),
    /parallelism/,
  );
  assert.doesNotThrow(() =>
    assertHostedCapacity({ availableGiB: 107, memoryGiB: 14, cpus: 4 }, map),
  );
  for (const patch of [{ availableGiB: 84 }, { memoryGiB: 7 }, { cpus: 2 }])
    assert.throws(
      () =>
        assertHostedCapacity(
          { availableGiB: 107, memoryGiB: 14, cpus: 4, ...patch },
          map,
        ),
      /capacity/,
    );
});

test("hosted admission retains actual capacity rejection and unchanged exact thresholds", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cef-admission-capacity-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = [
    { availableGiB: 99.99, memoryGiB: 8, cpus: 4 },
    { availableGiB: 100, memoryGiB: 8, cpus: 4 },
    { availableGiB: Number.NaN, memoryGiB: 8, cpus: 4 },
    { availableGiB: 100, memoryGiB: Number.POSITIVE_INFINITY, cpus: 4 },
    { availableGiB: 100, memoryGiB: 8, cpus: 3.5 },
  ];
  for (const [index, measured] of cases.entries()) {
    const logs = path.join(directory, String(index));
    await mkdir(logs);
    const recorder = await hostedAdmissionRecorder(logs);
    const expected = index === 1;
    try {
      const operation = recorder.run("capacity", () =>
        recorder.capacity(measured, { buildJobs: 4 }),
      );
      if (expected) await operation;
      else await assert.rejects(operation, /capacity is insufficient/);
    } finally {
      await recorder.close();
    }
    const rows = (
      await readFile(path.join(logs, "hosted-admission.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 4);
    const observation = rows[1];
    assert.equal(observation.status, "observed");
    assert.equal(
      observation.availableGiB,
      Number.isFinite(measured.availableGiB) ? measured.availableGiB : null,
    );
    assert.equal(
      observation.totalMemoryGiB,
      Number.isFinite(measured.memoryGiB) ? measured.memoryGiB : null,
    );
    assert.equal(
      observation.availableParallelism,
      Number.isSafeInteger(measured.cpus) ? measured.cpus : null,
    );
    assert.equal(observation.minimumFreeDiskGiB, 100);
    assert.equal(observation.minimumMemoryGiB, 8);
    assert.equal(observation.requiredParallelism, 4);
    assert.equal(observation.admitted, null);
    assert.deepEqual(rows[2], {
      admitted: expected,
      stage: "capacity",
      status: "admission",
    });
    assert.deepEqual(rows[3], {
      stage: "capacity",
      status: expected ? "pass" : "fail",
    });
  }
});

test("hosted admission closes stages, preserves original failures and never serializes secrets", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cef-admission-stage-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stages = [
    "identity",
    "capacity",
    "runner-map",
    "tool-pins",
    "runner-path",
    "workspace",
    "isolation",
    "workdir",
  ];
  for (const [index, boundary] of stages.entries()) {
    const logs = path.join(directory, String(index));
    await mkdir(logs);
    const recorder = await hostedAdmissionRecorder(logs);
    const secret = new Error(
      "credential=/private/owner/profile?token=never-retain",
    );
    let visited = 0;
    try {
      await assert.rejects(
        async () => {
          for (const stage of stages) {
            await recorder.run(stage, () => {
              visited++;
              if (stage === boundary) throw secret;
              return "an operation result is not diagnostic data";
            });
          }
        },
        (error) => error === secret,
      );
      assert.equal(visited, index + 1);
      await assert.rejects(
        recorder.run("arbitrary-secret-stage", () => assert.fail()),
        /Invalid hosted admission/,
      );
      await assert.rejects(
        recorder.run(boundary, () => assert.fail()),
        /Invalid hosted admission/,
      );
    } finally {
      await recorder.close();
      await recorder.close();
    }
    const raw = await readFile(
      path.join(logs, "hosted-admission.jsonl"),
      "utf8",
    );
    assert.ok(Buffer.byteLength(raw) < 16 * 1024);
    assert.doesNotMatch(
      raw,
      /credential|private|profile|token|operation result|arbitrary/,
    );
    const rows = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 2 * (index + 1));
    assert.deepEqual(rows.at(-1), { stage: boundary, status: "fail" });
    assert.ok(
      rows.every((row) => Object.keys(row).sort().join(",") === "stage,status"),
    );
    await assert.rejects(hostedAdmissionRecorder(logs), /EEXIST/);
  }
  const nullLogs = path.join(directory, "null");
  await mkdir(nullLogs);
  const recorder = await hostedAdmissionRecorder(nullLogs);
  try {
    let caught = false;
    try {
      await recorder.run("identity", () => {
        throw null;
      });
    } catch (error) {
      caught = true;
      assert.equal(error, null);
    }
    assert.ok(caught);
  } finally {
    await recorder.close();
  }
});

// Execute the actual build body with only owned temporary I/O and synthetic
// pre-acquisition dependencies. This is wiring evidence, not hosted admission.
test("actual build retains the failing early boundary before any source acquisition", async (t) => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-admission-build-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selected = "aarch64-unknown-linux-gnu";
  const profile = checkpointProfile(selected);
  const production = await readFile(
    path.join(root, "scripts/cef-runtime-ci.mjs"),
    "utf8",
  );
  const insideSource = production.match(
    /const inside = \(root, file\) => \{[\s\S]*?\n\};/,
  );
  assert.ok(
    insideSource,
    "Actual production path containment helper is required",
  );
  const actualInside = new Script(`${insideSource[0]}\ninside`).runInNewContext(
    { path },
  );
  const map = JSON.parse(
    await readFile(
      path.join(root, profile.inputs, `cef-ci-runner-${selected}.json`),
      "utf8",
    ),
  );
  map.path = ["usr/bin"];
  const stages = [
    "identity",
    "capacity",
    "runner-map",
    "tool-pins",
    "runner-path",
    "workspace",
    "isolation",
    "workdir",
  ];
  for (const [index, boundary] of stages.entries()) {
    const temporary = path.join(directory, String(index));
    const ownedTools = path.join(temporary, "tools");
    const workspace = path.join(temporary, "workspace");
    await mkdir(path.join(ownedTools, "usr/bin"), { recursive: true });
    await mkdir(workspace);
    const original = new Error("secret=/private/profile?credential=never-log");
    let preparation,
      acquisitions = 0;
    const dependency = (stage, operation) => {
      if (boundary === stage) throw original;
      return operation();
    };
    const sourceLock = {
      builds: [{ target: selected, toolchainLock: { path: "tools.json" } }],
    };
    const toolchain = { files: [{ path: "runner.json" }] };
    const synthetic = {
      ROOT: root,
      process: { platform: "linux", arch: "x64" },
      createHostedBuildBudget,
      checkpointHost: (target, platform, architecture) => {
        assert.equal(target, selected);
        assert.equal(platform, "linux");
        assert.equal(architecture, "x64");
      },
      repositoryName: () => {},
      plan: async () => ({ sourceLock, inputsRoot: ownedTools }),
      releaseIdentity: () => ({ sourceLockSha256: profile.source }),
      engineeringBuildProfile: (options) =>
        engineeringBuildProfile(options, "linux", "x64"),
      fail: (message) => {
        throw new Error(message);
      },
      realpath: (file) => {
        if (file === workspace)
          return dependency("workspace", () => realpath(file));
        if (file === path.join(ownedTools, "usr/bin"))
          return dependency("runner-path", () => realpath(file));
        return realpath(file);
      },
      toolchainShape: (value) => value,
      json: async (file) => (file === "tools.json" ? toolchain : map),
      pinned: async (_base, value) => value.path,
      mapName: () => "runner.json",
      mkdtemp: async (prefix) => {
        preparation = await mkdtemp(prefix);
        return preparation;
      },
      output: async () => {},
      writeFile,
      stableJson,
      path,
      hostedAdmissionRecorder,
      assertHostedBuildIdentity: (...args) =>
        dependency("identity", () =>
          assertHostedBuildIdentity(...args, "linux", "x64"),
        ),
      statfs: async () => ({
        bavail: (boundary === "capacity" ? 99 : 100) * 1024 ** 3,
        bsize: 1,
      }),
      os: { totalmem: () => 8 * 1024 ** 3, availableParallelism: () => 4 },
      validateRunnerMap: (...args) =>
        dependency("runner-map", () => validateRunnerMap(...args)),
      verifyToolchainFiles: async () => dependency("tool-pins", () => {}),
      inside: actualInside,
      verifySourceBuildIsolation: async () => dependency("isolation", () => {}),
      mkdir: (...args) => dependency("workdir", () => mkdir(...args)),
      buildEnvironment: () => {
        acquisitions++;
        throw new Error("unexpected acquisition");
      },
    };
    const actualBuild = new Script(`(${build.toString()})`).runInNewContext(
      synthetic,
    );
    await assert.rejects(
      actualBuild(
        {
          execute: true,
          repository,
          inputs: profile.inputs,
          target: selected,
          runnerMode: "hosted",
          engineering: { workspace, completeSdk: true },
        },
        {
          SORNG_CEF_TOOLS_ROOT: ownedTools,
          RUNNER_TEMP: temporary,
          GITHUB_ACTIONS: "true",
          RUNNER_ENVIRONMENT: "github-hosted",
          GITHUB_REPOSITORY_VISIBILITY: "public",
          ImageOS: map.hosted.imageOS,
          ImageVersion: map.hosted.imageVersion,
        },
      ),
      (error) =>
        boundary === "capacity"
          ? /capacity is insufficient/.test(error.message)
          : error === original,
    );
    assert.equal(acquisitions, 0);
    const raw = await readFile(
      path.join(preparation, "hosted-admission.jsonl"),
      "utf8",
    );
    const rows = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(rows.at(-1), { stage: boundary, status: "fail" });
    assert.deepEqual(
      rows.filter((row) => row.status === "start").map((row) => row.stage),
      stages.slice(0, index + 1),
    );
    assert.doesNotMatch(
      raw,
      /secret|private|profile|credential|unexpected acquisition/,
    );
  }
});

test("Linux ARM cross-build requires an explicit reviewed x64 map and retains native ARM acceptance", () => {
  const selected = "aarch64-unknown-linux-gnu";
  const map = {
    ...runner(selected),
    schemaVersion: 2,
    hosted: {
      runner: "ubuntu-24.04",
      imageOS: "ubuntu24",
      imageVersion: "reviewed-x64-image",
      platform: "linux",
      architecture: "x64",
      acceptanceRunner: "ubuntu-24.04-arm",
    },
  };
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    ImageOS: map.hosted.imageOS,
    ImageVersion: map.hosted.imageVersion,
  };
  assert.equal(hostedBuildHost(selected).runner, "ubuntu-24.04-arm");
  assert.equal(hostedBuildHost(selected, map).runner, "ubuntu-24.04");
  assert.equal(
    assertHostedBuildIdentity(map, selected, env, "linux", "x64").crossCompiled,
    true,
  );
  const native = {
    ...map,
    hosted: {
      ...map.hosted,
      runner: "ubuntu-24.04-arm",
      architecture: "arm64",
    },
  };
  assert.equal(
    assertHostedBuildIdentity(native, selected, env, "linux", "arm64")
      .crossCompiled,
    false,
  );
  for (const changes of [
    { runner: "arbitrary-runner" },
    { architecture: "arm64" },
    { platform: "darwin" },
    { acceptanceRunner: "ubuntu-24.04" },
  ])
    assert.throws(
      () =>
        validateRunnerMap(
          { ...map, hosted: { ...map.hosted, ...changes } },
          selected,
        ),
      /fixed target/,
    );
  assert.throws(
    () =>
      validateRunnerMap(
        { ...map, target: "x86_64-unknown-linux-gnu" },
        selected,
      ),
    /target\/schema/,
  );
  assert.throws(
    () => assertHostedBuildIdentity(map, selected, env, "linux", "arm64"),
    /identity changed/,
  );
  assert.throws(
    () =>
      assertHostedBuildIdentity(
        map,
        selected,
        { ...env, ImageVersion: "another-image" },
        "linux",
        "x64",
      ),
    /identity changed/,
  );
});

test("acquisition serializes the selected ARM64 sysroot CPU before sync without overriding the host CPU", async (t) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "cef-cross-acquisition-"),
  );
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, "not-created");
  const standard = acquisitionSourcePlan(destination);
  const nativeX64 = acquisitionSourcePlan(
    destination,
    "x86_64-unknown-linux-gnu",
  );
  assert.deepEqual(nativeX64, standard);
  assert.equal(gclientConfiguration(standard).includes("target_cpu"), false);
  const cross = acquisitionSourcePlan(destination, "aarch64-unknown-linux-gnu");
  assert.deepEqual(cross.gclient.target_cpu, ["arm64"]);
  const serialized = gclientConfiguration(cross);
  assert.match(serialized, /^target_cpu = \['arm64'\]$/m);
  assert.doesNotMatch(serialized, /target_cpu_only|host_cpu|custom_deps.*None/);
  assert.deepEqual(cross.sourcePins, standard.sourcePins);
  assert.deepEqual(cross.gclient.solutions, standard.gclient.solutions);
  const file = path.join(temporary, "gclient-fixture");
  await writeFile(file, serialized);
  // Parse actual emitted Python assignments as literals, without executing
  // depot_tools, fetching sources or replacing its host/target CPU policy.
  const python = process.platform === "win32" ? "python" : "python3";
  const parsed = await exec(python, [
    "-I",
    "-c",
    "import ast,json,sys; tree=ast.parse(open(sys.argv[1],encoding='utf-8').read()); print(json.dumps({n.targets[0].id:ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign)}))",
    file,
  ]);
  const actual = JSON.parse(parsed.stdout);
  assert.deepEqual(actual.target_cpu, ["arm64"]);
  assert.equal(actual.target_cpu_only, undefined);
  assert.equal(actual.solutions[0].url, standard.gclient.solutions[0].url);
  for (const invalid of [
    "all",
    "arm64",
    "aarch64-unknown-linux-gnu\n",
    "x'; print('unsafe')",
  ]) {
    assert.throws(() => acquisitionSourcePlan(destination, invalid), /target/);
    await assert.rejects(acquireSources(destination, invalid), /target/);
  }
  await assert.rejects(readFile(destination), /ENOENT/);
  assert.throws(
    () =>
      gclientConfiguration({
        ...cross,
        gclient: { ...cross.gclient, target_cpu: ["arm64", "x64"] },
      }),
    /CPU configuration/,
  );
});

test("Linux cross output must still be AArch64 ELF even though the build host is x64", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cef-cross-output-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const file = path.join(temporary, "cef-bootstrap");
  // Structural fixture only: exercise the real final-output architecture
  // inspector, never load or describe these bytes as a runnable CEF binary.
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0x464c457f, 0);
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  await writeFile(file, bytes);
  await assert.rejects(
    inspectNativeBinary(file, "aarch64-unknown-linux-gnu"),
    /does not match/,
  );
  bytes.writeUInt16LE(183, 18);
  await writeFile(file, bytes);
  await inspectNativeBinary(file, "aarch64-unknown-linux-gnu");
  await assert.rejects(
    inspectNativeBinary(file, "x86_64-unknown-linux-gnu"),
    /does not match/,
  );
});

test("one monotonic hosted budget is carried across stages rather than reset for every command", () => {
  let now = 10;
  const budget = createHostedBuildBudget(100, () => now);
  assert.equal(budget.remaining(), 100);
  now = 50;
  assert.equal(budget.remaining(), 60);
  budget.assertRemaining();
  now = 110;
  assert.equal(budget.remaining(), 0);
  assert.throws(() => budget.assertRemaining(), /budget exhausted/);
  assert.throws(() => createHostedBuildBudget(301 * 60_000), /bounded/);
});

test(
  "actual hosted deadline stops only its spawned child tree and retains failure diagnostics",
  { timeout: 15_000 },
  async (t) => {
    const root = await temp(t);
    const heartbeat = path.join(root, "heartbeat");
    const child = path.join(root, "child.cjs");
    const grandchild = path.join(root, "grandchild.cjs");
    await writeFile(
      grandchild,
      `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20);`,
    );
    await writeFile(
      child,
      `require('node:child_process').spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000);`,
    );
    await assert.rejects(
      runBuildCommand(process.execPath, [child], {
        cwd: root,
        env: process.env,
        logs: root,
        name: "deadline-fixture",
        budget: createHostedBuildBudget(2000),
      }),
      /budget exhausted/,
    );
    const receipt = JSON.parse(
      await readFile(path.join(root, "deadline-fixture.deadline.json"), "utf8"),
    );
    assert.equal(receipt.budgetExpired, true);
    assert.ok(
      ["owned-tree-terminated", "owned-group-terminated"].includes(
        receipt.cleanup,
      ),
    );
    assert.equal(receipt.productionReady, false);
    const observed = await readFile(heartbeat, "utf8");
    assert.ok(
      observed.length > 0,
      "the actual grandchild was running before the deadline",
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      await readFile(heartbeat, "utf8"),
      observed,
      "the owned grandchild must stop as well",
    );
  },
);

async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cef-ci-fixture-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, name, bytes) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
async function fixture(t, all = false) {
  const work = await temp(t),
    checkout = path.join(work, "checkout");
  const inputsRoot = path.join(checkout, "reviewed");
  const selected = all ? TARGETS : [target];
  const sourceLock = {
    schemaVersion: 1,
    kind: "sorng-cef-source-lock",
    upstream: {
      cef: {
        repository: "https://github.com/chromiumembedded/cef.git",
        commit: UPSTREAM_CEF_COMMIT,
        version: CEF_PIN.version,
      },
      chromium: {
        repository: "https://chromium.googlesource.com/chromium/src.git",
        commit: UPSTREAM_CHROMIUM_COMMIT,
      },
      depotTools: {
        repository:
          "https://chromium.googlesource.com/chromium/tools/depot_tools.git",
        commit: UPSTREAM_DEPOT_TOOLS_COMMIT,
      },
    },
    patches: [
      { repository: "cef", ...pin("patches/synthetic.patch", "fixture patch") },
    ],
    bridge: {
      ...BRIDGE_V2,
      patchId: BRIDGE_PATCH_ID,
      header: pin("include/cef_sorng_tls_bridge.h", bridge),
    },
    builds: [],
  };
  await put(inputsRoot, "patches/synthetic.patch", "fixture patch");
  await put(inputsRoot, sourceLock.bridge.header.path, bridge);
  for (const selectedTarget of selected) {
    const gn =
      `target_cpu="${selectedTarget.startsWith("aarch64") ? "arm64" : "x64"}"\nis_component_build=false\nis_debug=false\nuse_remoteexec=false\nuse_siso=true\n` +
      (selectedTarget.includes("linux")
        ? "ozone_platform_x11=true\n"
        : selectedTarget.includes("apple")
          ? 'mac_deployment_target="14.0"\n'
          : "");
    const map = stableJson(runner(selectedTarget));
    const tools = stableJson({
      schemaVersion: 1,
      kind: "sorng-cef-toolchain-lock",
      target: selectedTarget,
      files: [
        {
          ...pin(`cef-ci-runner-${selectedTarget}.json`, map),
          size: Buffer.byteLength(map),
        },
        { ...pin("python/python.exe", "fixture python"), size: 14 },
      ],
    });
    sourceLock.builds.push({
      target: selectedTarget,
      gnArgs: pin(`gn/${selectedTarget}.gn`, gn),
      toolchainLock: pin(`tools/${selectedTarget}.json`, tools),
    });
    await put(inputsRoot, `gn/${selectedTarget}.gn`, gn);
    await put(inputsRoot, `tools/${selectedTarget}.json`, tools);
  }
  await put(inputsRoot, "source-lock.json", stableJson(sourceLock));
  return { work, checkout, inputsRoot, sourceLock };
}

test("hosted planning verifies all actual image-map pin bytes before selecting fixed native/cross runners", async (t) => {
  const f = await fixture(t, true);
  for (const build of f.sourceLock.builds) {
    const host = hostedBuildHost(build.target);
    const nativeRunner =
      build.target === "aarch64-apple-darwin" ? "macos-15" : host.runner;
    const mapBytes = stableJson({
      ...runner(build.target),
      ...(WINDOWS_GIT_PROGRAMS[build.target]
        ? { git: WINDOWS_GIT_PROGRAMS[build.target] }
        : {}),
      schemaVersion: 2,
      hosted: {
        runner: host.runner,
        platform: host.platform,
        architecture: host.architecture,
        imageOS: "reviewed-image",
        imageVersion: "actual-observation-v1",
        acceptanceRunner: nativeRunner,
      },
    });
    const mapFile = `cef-ci-runner-${build.target}.json`;
    await put(f.inputsRoot, mapFile, mapBytes);
    const toolchain = JSON.parse(
      await readFile(path.join(f.inputsRoot, build.toolchainLock.path), "utf8"),
    );
    toolchain.files[0] = {
      ...pin(mapFile, mapBytes),
      size: Buffer.byteLength(mapBytes),
    };
    if (WINDOWS_GIT_PROGRAMS[build.target])
      toolchain.files.push({
        ...pin(WINDOWS_GIT_PROGRAMS[build.target], "inert native Git fixture"),
        size: Buffer.byteLength("inert native Git fixture"),
      });
    const tools = stableJson(toolchain);
    await put(f.inputsRoot, build.toolchainLock.path, tools);
    build.toolchainLock = pin(build.toolchainLock.path, tools);
  }
  await put(f.inputsRoot, "source-lock.json", stableJson(f.sourceLock));
  const planned = await plan({
    checkout: f.checkout,
    inputs: "reviewed",
    runnerMode: "hosted",
  });
  assert.equal(planned.matrix.include.length, 6);
  const armMac = planned.matrix.include.find(
    (row) => row.target === "aarch64-apple-darwin",
  );
  assert.equal(armMac.runners, "macos-15-intel");
  assert.equal(armMac.provisionTarget, "x86_64-apple-darwin");
  assert.ok(
    planned.matrix.include.every(
      (row) => row.runnerMode === "hosted" && typeof row.runners === "string",
    ),
  );
  await put(
    f.inputsRoot,
    "cef-ci-runner-aarch64-apple-darwin.json",
    "changed map",
  );
  await assert.rejects(
    plan({
      checkout: f.checkout,
      inputs: "reviewed",
      target,
      runnerMode: "hosted",
    }),
    /mismatch/,
  );
  await assert.rejects(
    plan({ checkout: f.checkout, inputs: "reviewed", runnerMode: "arbitrary" }),
    /runner mode/,
  );
});

// Minimal structural PE tables exercise the real inventory/export inspector;
// no fixture library is ever loaded or claimed as runnable.
function pe(symbols = [], library = false) {
  const bytes = Buffer.alloc(2048);
  bytes.write("MZ");
  bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(1, 134);
  bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(library ? 0x2000 : 0, 150);
  bytes.writeUInt16LE(0x20b, 152);
  bytes.writeUInt32LE(512, 264);
  bytes.writeUInt32LE(256, 268);
  bytes.writeUInt32LE(512, 404);
  bytes.writeUInt32LE(1536, 408);
  bytes.writeUInt32LE(512, 412);
  bytes.writeUInt32LE(symbols.length, 532);
  bytes.writeUInt32LE(symbols.length, 536);
  bytes.writeUInt32LE(560, 540);
  bytes.writeUInt32LE(600, 544);
  bytes.writeUInt32LE(640, 548);
  symbols.forEach((symbol, index) => {
    bytes.writeUInt32LE(1800 + index, 560 + index * 4);
    bytes.writeUInt32LE(800 + index * 128, 600 + index * 4);
    bytes.writeUInt16LE(index, 640 + index * 2);
    bytes.write(symbol, 800 + index * 128);
  });
  return bytes;
}
async function sdkFixture(t) {
  const f = await fixture(t);
  const distribution = path.join(f.work, "distribution"),
    archiveRoot = "cef_binary_fixture_minimal";
  for (const [name, bytes] of Object.entries({
    "Release/libcef.dll": pe([BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol], true),
    "Release/bootstrap.exe": pe(),
    "Release/libcef.lib": "fixture import library",
    "Resources/icudtl.dat": "fixture ICU",
    "Resources/locales/en-US.pak": "fixture locale",
    "include/cef_version.h":
      `#define CEF_VERSION "${CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${UPSTREAM_CEF_COMMIT}"\n#define CEF_SANDBOX_COMPAT_HASH "${CEF_PIN.sandboxCompat}"\n` +
      CEF_PIN.chromium
        .split(".")
        .map(
          (v, i) =>
            `#define CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][i]} ${v}\n`,
        )
        .join(""),
    "include/cef_api_versions.h": `#define CEF_API_VERSION_15400 15400\n#define CEF_API_VERSION_LAST CEF_API_VERSION_15400\n#if defined(OS_WIN)\n#define CEF_API_HASH_15400 "${hash("fixture api").slice(0, 40)}"\n#endif\n`,
    "cmake/fixture.cmake": "fixture cmake",
    "libcef_dll/fixture.cc": "fixture source",
    "CMakeLists.txt": "fixture CMake",
    "LICENSE.txt": "fixture license",
    "CREDITS.html": "fixture credits",
  }))
    await put(distribution, name, bytes);
  const sdk = await flattenSdk(
    distribution,
    path.join(f.work, archiveRoot),
    f.sourceLock,
    f.inputsRoot,
  );
  return { ...f, distribution, sdk, archiveRoot };
}
async function bundleFixture(t) {
  const f = await sdkFixture(t);
  const bundle = path.join(f.work, "bundle");
  const identity = releaseIdentity(f.sourceLock, target);
  // Some tests need only transport bytes, not tar extraction.
  await put(
    bundle,
    identity.archive,
    "synthetic transport fixture; not a tar archive",
  );
  await put(bundle, "source-lock.json", stableJson(f.sourceLock));
  await inventoryCustomArtifact({
    lock: path.join(bundle, "source-lock.json"),
    target,
    "artifact-root": bundle,
    sdk: f.sdk,
    archive: identity.archive,
    manifest: "manifest.json",
    receipt: "receipt.json",
  });
  const descriptor = await descriptorFor({
    bundle,
    sourceLock: f.sourceLock,
    target,
    repository,
    archiveRoot: f.archiveRoot,
  });
  await put(bundle, "runtime.json", stableJson(descriptor));
  return { ...f, bundle, identity, descriptor };
}
function fakeRelease() {
  let release = null;
  const entries = [],
    events = [];
  return {
    events,
    entries,
    get release() {
      return release;
    },
    client: {
      async get() {
        return release;
      },
      async create(input) {
        events.push("create");
        release = { id: 123, ...input };
        return release;
      },
      async assets() {
        return entries;
      },
      async digest(asset) {
        events.push(`compare:${asset.name}`);
        return { size: asset.size, sha256: hash(asset.bytes) };
      },
      async upload(id, item) {
        events.push(`upload:${item.name}`);
        const bytes = await readFile(item.file);
        const asset = {
          id: entries.length + 1,
          name: item.name,
          bytes,
          size: bytes.length,
          state: "uploaded",
        };
        entries.push(asset);
        return asset;
      },
      async finalize() {
        events.push("finalize");
        release.draft = false;
      },
    },
  };
}

test("all six targets have dedicated native self-hosted labels and reviewed plans", async (t) => {
  const f = await fixture(t, true);
  const result = await plan({
    checkout: f.checkout,
    inputs: "reviewed",
    target: "all",
  });
  assert.equal(result.matrix.include.length, 6);
  for (const entry of result.matrix.include) {
    assert.deepEqual(entry.runners, RUNNERS[entry.target]);
    assert.equal(entry.runners[0], "self-hosted");
    assert.ok(entry.runners.includes("sorng-cef-engine"));
    assert.ok(entry.runners.includes(`cef-${entry.target}`));
    assert.match(entry.key, /^[a-f0-9]{64}-/);
  }
});
test("missing target and missing runner map fail during plan, without acquisition", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    plan({ checkout: f.checkout, inputs: "reviewed", target: "all" }),
    /no reviewed build pin/,
  );
  const location = path.join(
    f.inputsRoot,
    f.sourceLock.builds[0].toolchainLock.path,
  );
  const tools = JSON.parse(await readFile(location));
  tools.files.shift();
  const bytes = stableJson(tools);
  await writeFile(location, bytes);
  f.sourceLock.builds[0].toolchainLock.sha256 = hash(bytes);
  await put(f.inputsRoot, "source-lock.json", stableJson(f.sourceLock));
  await assert.rejects(
    plan({ checkout: f.checkout, inputs: "reviewed", target }),
    /Missing reviewed runner map pin/,
  );
});
test("identity covers other targets' toolchains and all GN/patch pins, ignoring object key order", async (t) => {
  const f = await fixture(t, true),
    original = releaseIdentity(f.sourceLock, target);
  assert.equal(
    releaseIdentity(JSON.parse(stableJson(f.sourceLock)), target).key,
    original.key,
  );
  for (const edit of [
    (lock) => {
      lock.builds.at(-1).toolchainLock.sha256 = hash("changed toolchain");
    },
    (lock) => {
      lock.builds[0].gnArgs.sha256 = hash("changed GN");
    },
    (lock) => {
      lock.patches[0].sha256 = hash("changed patch");
    },
  ]) {
    const lock = structuredClone(f.sourceLock);
    edit(lock);
    assert.notEqual(releaseIdentity(lock, target).key, original.key);
  }
});
test("all six real build recipes use explicit bounded autoninja -j including Siso", async (t) => {
  const f = await fixture(t, true);
  for (const selected of TARGETS) {
    const recipe = await customRuntimeBuildRecipe({
      sourceLock: f.sourceLock,
      target: selected,
      inputsRoot: f.inputsRoot,
      checkouts: { cef: f.work, chromium: f.work, depotTools: f.work },
    });
    const commands = boundedBuildCommands(recipe, 4);
    assert.deepEqual(commands[1].args.slice(1, 3), ["-j", "4"]);
    assert.deepEqual(
      commands[1].args.slice(3),
      recipe.commands[1].args.slice(1),
    );
    assert.deepEqual(commands[0], recipe.commands[0]);
    assert.deepEqual(commands[2], recipe.commands[2]);
  }
  assert.throws(() => boundedBuildCommands({ commands: [] }, 4), /exactly one/);
  assert.throws(() => boundedBuildCommands({ commands: [] }, 0), /Bounded/);
});
test("CEF hook uses the reviewed Python for nested GN only, never a PATH wrapper", async (t) => {
  // Python getcwd() resolves aliases such as macOS /var -> /private/var.
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef hook driver ")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cef = path.join(directory, "CEF checkout");
  const tools = path.join(cef, "tools");
  const depot = path.join(directory, "pinned depot");
  const poison = path.join(directory, "poison PATH");
  await Promise.all(
    [tools, depot, poison].map((p) => mkdir(p, { recursive: true })),
  );
  const python = (
    await exec(process.platform === "win32" ? "python" : "python3", [
      "-B",
      "-c",
      "import sys;print(sys.executable)",
    ])
  ).stdout.trim();
  const trace = path.join(directory, "trace.jsonl");
  const marker = path.join(directory, "poison-ran");
  await writeFile(
    path.join(tools, "gclient_util.py"),
    `import json,os,subprocess
def RunAction(directory,command):
 with open(os.environ['TRACE'],'a') as f:f.write(json.dumps({'cwd':directory,'command':command})+'\\n')
 result=subprocess.run(command,cwd=directory)
 if result.returncode:raise SystemExit(result.returncode)
`,
  );
  await writeFile(
    path.join(tools, "gclient_hook.py"),
    `from gclient_util import RunAction
import os,sys
if os.environ.get('MODE')=='unsupported':
 RunAction(os.getcwd(),['gn','clean','out path'])
else:
 RunAction(os.getcwd(),[sys.executable,'-B',os.environ['OTHER'],'plain value','literal"quote'])
 RunAction(os.getcwd(),['gn','gen','out path','--kept=value with spaces'])
`,
  );
  const other = path.join(directory, "other child.py");
  await writeFile(
    other,
    "import sys;assert sys.argv[1:]==['plain value','literal\"quote']\n",
  );
  await writeFile(
    path.join(depot, "gn.py"),
    "import os,sys;assert sys.argv[1:]==['gen','out path','--kept=value with spaces'];sys.exit(int(os.environ.get('GN_EXIT','0')))\n",
  );
  await writeFile(
    path.join(poison, "gn.cmd"),
    `@echo poison>${marker}\r\n@exit /b 99\r\n`,
  );
  await writeFile(
    path.join(poison, "gn"),
    `#!/bin/sh\nprintf poison > '${marker.replaceAll("\\", "/")}'\nexit 99\n`,
    { mode: 0o755 },
  );
  const options = {
    cwd: directory,
    env: { ...process.env, PATH: poison, TRACE: trace, OTHER: other },
  };
  await exec(python, cefHookArguments(cef, depot), options);
  const rows = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(rows, [
    {
      cwd: directory,
      command: [python, "-B", other, "plain value", 'literal"quote'],
    },
    {
      cwd: directory,
      command: [
        python,
        "-B",
        path.join(depot, "gn.py"),
        "gen",
        "out path",
        "--kept=value with spaces",
      ],
    },
  ]);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  await assert.rejects(
    exec(python, cefHookArguments(cef, depot), {
      ...options,
      env: { ...options.env, GN_EXIT: "23" },
    }),
    (error) => error.code === 23,
  );
  const beforeUnsupported = await readFile(trace, "utf8");
  await assert.rejects(
    exec(python, cefHookArguments(cef, depot), {
      ...options,
      env: { ...options.env, MODE: "unsupported" },
    }),
    /Unsupported CEF GN invocation/,
  );
  assert.equal(await readFile(trace, "utf8"), beforeUnsupported);
  assert.throws(() => cefHookArguments("relative", depot), /absolute pinned/);
});

test("plan rejects mismatched pins, traversal and escaping reviewed-input junction", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    plan({ checkout: f.checkout, inputs: "../reviewed", target }),
    /Unsafe/,
  );
  await symlink(
    f.inputsRoot,
    path.join(f.work, "outside-link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await mkdir(path.join(f.work, "small-checkout"));
  await symlink(
    f.inputsRoot,
    path.join(f.work, "small-checkout", "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    plan({
      checkout: path.join(f.work, "small-checkout"),
      inputs: "escape",
      target,
    }),
    /inside the trusted checkout/,
  );
  await put(f.inputsRoot, "patches/synthetic.patch", "tampered");
  await assert.rejects(
    plan({ checkout: f.checkout, inputs: "reviewed", target }),
    /Reviewed input mismatch/,
  );
});
test("runner maps reject host paths, unsupported env, traversal and unbounded parallelism", () => {
  assert.deepEqual(validateRunnerMap(runner(), target), runner());
  for (const edit of [
    (value) => {
      value.python = "C:/Users/private/python.exe";
    },
    (value) => {
      value.path = ["../bin"];
    },
    (value) => {
      value.environment.GYP_MSVS_OVERRIDE_PATH = "F:/private/sdk";
    },
    (value) => {
      value.environment.GH_TOKEN = "secret";
    },
    (value) => {
      value.environment.SDKROOT = "@TOOLS@/../escape";
    },
    (value) => {
      value.syncJobs = 80;
    },
    (value) => {
      value.buildJobs = 100;
    },
    (value) => {
      value.target = "different";
    },
  ]) {
    const map = runner();
    edit(map);
    assert.throws(() => validateRunnerMap(map, target));
  }
});
test("actual Mac producer maps keep POSIX, drive and UNC roots absolute without double-root GN paths", async (t) => {
  const source = await readFile(
    new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url),
    "utf8",
  );
  // Execute the actual function with each platform's path implementation. This
  // checks POSIX behavior on Windows too, without adding a production override.
  const functionSource = source
    .slice(
      source.indexOf("export function buildEnvironment("),
      source.indexOf("export async function sourceWorkspace("),
    )
    .replace("export function", "function");
  const roots = [
    {
      api: path.posix,
      tools: "/",
      source: "/source/",
      depot: "/depot/",
      developer: "/Applications/Xcode_26.3.app/Contents/Developer",
      sourceToolchain: "/source/toolchain",
      depotSdk: "/depot/sdk",
    },
    {
      api: path.win32,
      tools: "C:\\",
      source: "C:\\source\\",
      depot: "C:\\depot\\",
      developer: "C:\\Applications\\Xcode_26.3.app\\Contents\\Developer",
      sourceToolchain: "C:\\source\\toolchain",
      depotSdk: "C:\\depot\\sdk",
    },
    {
      api: path.win32,
      tools: "\\\\server\\share\\",
      source: "\\\\server\\share\\source\\",
      depot: "\\\\server\\share\\depot\\",
      developer:
        "\\\\server\\share\\Applications\\Xcode_26.3.app\\Contents\\Developer",
      sourceToolchain: "\\\\server\\share\\source\\toolchain",
      depotSdk: "\\\\server\\share\\depot\\sdk",
    },
  ];
  for (const [selected, namespace] of [
    [
      "x86_64-apple-darwin",
      "20261023-registration-retirement-lf-macintel-xcode26-3-sdk26-2",
    ],
    [
      "aarch64-apple-darwin",
      "20261023-registration-retirement-lf-macarm-intelcross-xcode26-3-sdk26-2",
    ],
  ]) {
    const map = JSON.parse(
      await readFile(
        path.join(
          root,
          "native",
          "cef-build-inputs",
          namespace,
          `cef-ci-runner-${selected}.json`,
        ),
        "utf8",
      ),
    );
    validateRunnerMap(map, selected);
    for (const locations of roots) {
      await t.test(`${selected} ${locations.tools}`, () => {
        const actual = new Script(
          `${functionSource}\nbuildEnvironment;`,
        ).runInNewContext({ path: locations.api, process: { env: {} } });
        const value = actual(
          {
            ...map,
            environment: {
              ...map.environment,
              GYP_MSVS_OVERRIDE_PATH: "@SOURCE@/toolchain",
              WDK_DIR: "@DEPOT@/sdk",
            },
          },
          {
            toolsRoot: locations.tools,
            source: locations.source,
            depot: locations.depot,
            python: "/reviewed/python",
          },
          { GH_TOKEN: "never-forward", PATH: "system" },
        );
        assert.equal(value.DEVELOPER_DIR, locations.developer);
        assert.equal(
          value.SDKROOT,
          locations.developer +
            (locations.api === path.posix
              ? "/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
              : "\\Platforms\\MacOSX.platform\\Developer\\SDKs\\MacOSX.sdk"),
        );
        assert.equal(value.GYP_MSVS_OVERRIDE_PATH, locations.sourceToolchain);
        assert.equal(value.WDK_DIR, locations.depotSdk);
        assert.equal(value.MACOSX_DEPLOYMENT_TARGET, "14.0");
        assert.equal(
          value.CEF_ENABLE_ARM64,
          selected.startsWith("aarch64") ? "1" : undefined,
        );
        assert.equal(value.GH_TOKEN, undefined);
      });
    }
  }
});

test("child build env relocates reviewed paths and strips CI tokens and implicit build overrides", () => {
  const env = buildEnvironment(
    runner(),
    {
      toolsRoot: "/tools",
      source: "/source",
      depot: "/source/depot",
      python: "/tools/python/python",
    },
    {
      PATH: "/system",
      GH_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      GITHUB_OUTPUT: "/output",
      GN_DEFINES: "evil",
      NINJA_CORE_MULTIPLIER: "1000",
      RBE_SERVER: "remote",
      NODE_OPTIONS: "--require unsafe",
      PYTHONPATH: "unsafe",
      KEEP: "yes",
    },
  );
  for (const key of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_OUTPUT",
    "GN_DEFINES",
    "NINJA_CORE_MULTIPLIER",
    "RBE_SERVER",
    "NODE_OPTIONS",
    "PYTHONPATH",
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.GYP_MSVS_OVERRIDE_PATH, path.join("/tools", "native"));
  assert.equal(env.KEEP, "yes");
  assert.equal(env.DEPOT_TOOLS_UPDATE, "0");
});

test("only the explicit Mac ARM target enables its CEF configuration and the reviewed hook receives it", async (t) => {
  const f = await fixture(t, true);
  const locations = {
    toolsRoot: f.work,
    source: f.work,
    depot: f.work,
    python: process.execPath,
  };
  for (const selected of TARGETS) {
    const child = buildEnvironment(runner(selected), locations, {
      ...process.env,
      CEF_ENABLE_ARM64: "0",
      CEF_ENABLE_AMD64: "1",
      CEF_UNREVIEWED_OVERRIDE: "1",
    });
    assert.equal(
      child.CEF_ENABLE_ARM64,
      selected === "aarch64-apple-darwin" ? "1" : undefined,
    );
    assert.equal(child.CEF_ENABLE_AMD64, undefined);
    assert.equal(child.CEF_UNREVIEWED_OVERRIDE, undefined);
    const recipe = await customRuntimeBuildRecipe({
      sourceLock: f.sourceLock,
      target: selected,
      inputsRoot: f.inputsRoot,
      checkouts: { cef: f.work, chromium: f.work, depotTools: f.work },
    });
    // This is the same merge used immediately before invoking the real hook.
    Object.assign(child, recipe.environment);
    assert.equal(
      child.CEF_ENABLE_ARM64,
      selected === "aarch64-apple-darwin" ? "1" : undefined,
    );
    if (selected !== "aarch64-apple-darwin") continue;
    assert.equal(child.GN_OUT_CONFIGS, "Release_GN_arm64");
    assert.deepEqual(recipe.commands[0].args, ["cef/tools/gclient_hook.py"]);
    const observed = await runBuildCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify({flag:process.env.CEF_ENABLE_ARM64,configs:process.env.GN_OUT_CONFIGS}))",
      ],
      {
        cwd: f.work,
        env: child,
        logs: f.work,
        name: "portable-hook-environment",
        capture: true,
      },
    );
    assert.deepEqual(JSON.parse(observed), {
      flag: "1",
      configs: "Release_GN_arm64",
    });
  }
});
test("source workspace must be physically external and free of ancestor node_modules", async (t) => {
  const work = await temp(t),
    checkout = path.join(work, "repo"),
    external = path.join(work, "temp");
  await mkdir(checkout);
  await mkdir(external);
  await mkdir(path.join(checkout, "temp"));
  await assert.rejects(
    sourceWorkspace(path.join(checkout, "temp"), checkout),
    /outside/,
  );
  await symlink(
    path.join(checkout, "temp"),
    path.join(work, "junction"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    sourceWorkspace(path.join(work, "junction"), checkout),
    /outside/,
  );
  const created = await sourceWorkspace(external, checkout);
  assert.equal(
    path.dirname(created),
    await (await import("node:fs/promises")).realpath(external),
  );
  await mkdir(path.join(work, "node_modules"));
  await assert.rejects(sourceWorkspace(external, checkout), /node_modules/);
});
test("flat SDK preserves native/include/resources and noncircular custom metadata", async (t) => {
  const f = await sdkFixture(t);
  const names = await readdir(f.sdk);
  assert.ok(names.includes("libcef.dll"));
  assert.ok(names.includes("locales"));
  assert.ok(!names.includes("Release"));
  assert.deepEqual(
    await readFile(path.join(f.sdk, f.sourceLock.bridge.header.path)),
    bridge,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(f.sdk, "archive.json"))),
    {
      type: "minimal",
      kind: "sorng-cef-custom-sdk",
      sourceLockSha256: identitySha256(f.sourceLock),
    },
  );
  await assert.rejects(
    flattenSdk(f.distribution, f.sdk, f.sourceLock, f.inputsRoot),
    /must be new/,
  );
});
test("flattening refuses Release/Resources collisions and changed ABI headers", async (t) => {
  const f = await sdkFixture(t);
  await put(f.distribution, "Resources/libcef.dll", "collision");
  await assert.rejects(
    flattenSdk(
      f.distribution,
      path.join(f.work, "collision"),
      f.sourceLock,
      f.inputsRoot,
    ),
    /collision/,
  );
  await rm(path.join(f.distribution, "Resources/libcef.dll"));
  await put(f.distribution, f.sourceLock.bridge.header.path, "wrong ABI");
  await assert.rejects(
    flattenSdk(
      f.distribution,
      path.join(f.work, "wrong-header"),
      f.sourceLock,
      f.inputsRoot,
    ),
    /bridge header mismatch/,
  );
});
test("real tar roundtrip preserves flat inventory, metadata, and deterministic packaging", async (t) => {
  const python =
    process.env.CEF_TEST_PYTHON ??
    (process.platform === "win32" ? "python" : "python3");
  let version;
  try {
    version = JSON.parse(
      (
        await exec(
          python,
          [
            "-I",
            "-c",
            "import sys,json;print(json.dumps(list(sys.version_info[:2])))",
          ],
          { timeout: 15_000 },
        )
      ).stdout,
    );
  } catch {
    t.skip("Python >= 3.12 unavailable; no CEF build is attempted");
    return;
  }
  if (version[0] !== 3 || version[1] < 12) {
    t.skip("Python >= 3.12 required for safe fixture extraction");
    return;
  }
  const f = await sdkFixture(t),
    bundle = path.join(f.work, "bundle");
  await mkdir(bundle);
  await mkdir(path.join(f.sdk, "empty-directory"));
  const identity = releaseIdentity(f.sourceLock, target),
    archive = path.join(bundle, identity.archive);
  await exec(python, ["-I", "-c", PACK_PYTHON, f.sdk, archive]);
  await exec(python, ["-I", "-c", PACK_PYTHON, f.sdk, `${archive}.copy`]);
  assert.deepEqual(await measure(archive), await measure(`${archive}.copy`));
  await assert.rejects(exec(python, ["-I", "-c", PACK_PYTHON, f.sdk, archive]));
  await put(bundle, "source-lock.json", stableJson(f.sourceLock));
  await inventoryCustomArtifact({
    lock: path.join(bundle, "source-lock.json"),
    target,
    "artifact-root": bundle,
    sdk: f.sdk,
    archive: identity.archive,
    manifest: "manifest.json",
    receipt: "receipt.json",
  });
  await exec(python, [
    "-I",
    path.join(root, "scripts/lib/extract-custom-runtime.py"),
    archive,
    path.join(f.work, "extracted"),
    path.join(bundle, "manifest.json"),
    target,
    f.archiveRoot,
    String(RELEASE_LIMITS.expanded),
    String(RELEASE_LIMITS.members),
  ]);
  const manifest = JSON.parse(
    await readFile(path.join(bundle, "manifest.json")),
  );
  await preflightCustomRuntime({
    manifest,
    sourceLock: f.sourceLock,
    target,
    artifactRoot: bundle,
    sdkRoot: path.join(f.work, "extracted", f.archiveRoot),
  });
  assert.deepEqual(
    await readFile(
      path.join(f.work, "extracted", f.archiveRoot, "archive.json"),
    ),
    await readFile(path.join(f.sdk, "archive.json")),
  );
});
test("bundle validates shared descriptor/raw hashes and source+SDK+build receipt binding", async (t) => {
  const f = await bundleFixture(t);
  const checked = await verifyBundle(f.bundle, repository);
  assert.equal(checked.assets.length, 5);
  assert.equal(checked.identity.key, f.identity.key);
  assert.equal(
    checked.descriptorSha256,
    hash(await readFile(path.join(f.bundle, "runtime.json"))),
  );
  await assert.rejects(
    verifyBundle(f.bundle, "other/repository"),
    /same release/,
  );
  await put(f.bundle, f.identity.archive, "changed transport");
  await assert.rejects(
    verifyBundle(f.bundle, repository),
    /Reviewed input mismatch/,
  );
});
test("invalid receipt rejected even when descriptor/manifest transport hashes are recomputed", async (t) => {
  const f = await bundleFixture(t);
  const receipt = JSON.parse(
    await readFile(path.join(f.bundle, "receipt.json")),
  );
  receipt.buildInputsSha256 = hash("different inputs");
  await put(f.bundle, "receipt.json", stableJson(receipt));
  const manifest = JSON.parse(
    await readFile(path.join(f.bundle, "manifest.json")),
  );
  Object.assign(
    manifest.artifacts[0].provenance,
    await measure(path.join(f.bundle, "receipt.json")),
  );
  await put(f.bundle, "manifest.json", stableJson(manifest));
  const descriptor = await descriptorFor({
    bundle: f.bundle,
    sourceLock: f.sourceLock,
    target,
    repository,
    archiveRoot: f.archiveRoot,
  });
  await put(f.bundle, "runtime.json", stableJson(descriptor));
  await assert.rejects(
    verifyBundle(f.bundle, repository),
    /receipt does not bind/,
  );
});
test("release size checks happen before upload and disallow directories/symlinks", async (t) => {
  const work = await temp(t);
  await put(work, "bytes", "12345");
  await assert.rejects(measure(path.join(work, "bytes"), 4), /oversized/);
  await assert.rejects(measure(work), /regular asset/);
  assert.equal(MAX_RELEASE_ASSET, 2 ** 31 - 1);
});
test("publisher uploads descriptor last, finalizes engineering prerelease, then reuses exact bytes", async (t) => {
  const f = await bundleFixture(t),
    remote = fakeRelease();
  const options = { bundle: f.bundle, repository, execute: true, commit };
  const first = await publish(options, remote.client);
  assert.equal(first.uploaded, 5);
  assert.equal(first.productionReady, false);
  assert.equal(first.prerelease, true);
  assert.equal(
    remote.events.filter((event) => event.startsWith("upload:")).at(-1),
    "upload:runtime.json",
  );
  assert.equal(remote.events.at(-1), "finalize");
  assert.equal(remote.release.target_commitish, commit);
  remote.events.length = 0;
  const second = await publish(options, remote.client);
  assert.equal(second.uploaded, 0);
  assert.equal(second.reused, 5);
  assert.ok(remote.events.every((event) => event.startsWith("compare:")));
});
test("publisher compares every existing byte before any upload, preserving conflicting drafts", async (t) => {
  const f = await bundleFixture(t),
    remote = fakeRelease(),
    options = { bundle: f.bundle, repository, execute: true, commit };
  await publish(options, remote.client);
  remote.release.draft = true;
  remote.entries.pop(); // Simulate interrupted draft.
  remote.entries[1].bytes[0] ^= 1;
  remote.events.length = 0;
  await assert.rejects(
    publish(options, remote.client),
    /immutable asset differs/,
  );
  assert.ok(
    !remote.events.some(
      (event) => event.startsWith("upload:") || event === "finalize",
    ),
  );
  assert.equal(remote.release.draft, true);
});
test("publisher can resume exact partial draft but never mutates incomplete published release", async (t) => {
  const f = await bundleFixture(t),
    remote = fakeRelease(),
    options = { bundle: f.bundle, repository, execute: true, commit };
  await publish(options, remote.client);
  remote.entries.pop();
  remote.events.length = 0;
  await assert.rejects(publish(options, remote.client), /incomplete/);
  remote.release.draft = true;
  const result = await publish(options, remote.client);
  assert.equal(result.uploaded, 1);
  assert.equal(result.reused, 4);
});
test("publisher refuses nonengineering, duplicate and failed-upload release state", async (t) => {
  const f = await bundleFixture(t),
    remote = fakeRelease(),
    options = { bundle: f.bundle, repository, execute: true, commit };
  await publish(options, remote.client);
  remote.release.prerelease = false;
  await assert.rejects(
    publish(options, remote.client),
    /engineering prerelease/,
  );
  remote.release.prerelease = true;
  remote.entries[0].state = "starter";
  await assert.rejects(
    publish(options, remote.client),
    /immutable asset differs/,
  );
  remote.entries[0].state = "uploaded";
  remote.entries.push(remote.entries[0]);
  await assert.rejects(publish(options, remote.client), /duplicate assets/);
});
test("GitHub asset redirect cancels initial body, strips token and validates exact storage origin", async () => {
  let cancelled = false;
  const requests = [];
  const client = githubClient(
    repository,
    "fixture-token",
    async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1)
        return {
          status: 302,
          headers: new Headers({
            location:
              "https://release-assets.githubusercontent.com/object?signature=fixture",
          }),
          body: {
            async cancel() {
              cancelled = true;
            },
          },
        };
      return new Response("fixture");
    },
  );
  assert.deepEqual(await client.digest({ id: 1, size: 7 }), {
    size: 7,
    sha256: hash("fixture"),
  });
  assert.ok(cancelled);
  assert.ok(requests[0].options.headers.Authorization);
  assert.equal(requests[1].options.headers, undefined);
  for (const location of [
    "https://release-assets.githubusercontent.com:8443/object",
    "https://release-assets.githubusercontent.com/object#fragment",
    "https://evil.example/object",
    "https://user@objects.githubusercontent.com/object",
    "http://objects.githubusercontent.com/object",
  ]) {
    let calls = 0;
    const bad = githubClient(repository, "fixture-token", async () => {
      calls++;
      return new Response("", { status: 302, headers: { location } });
    });
    await assert.rejects(
      bad.digest({ id: 1, size: 7 }),
      /Unsafe release download redirect/,
    );
    assert.equal(calls, 1);
  }
});
test("GitHub comparison rejects oversized/mismatched responses and cancels failed bodies", async () => {
  const client = githubClient(
    repository,
    "token",
    async () => new Response("too many bytes"),
  );
  await assert.rejects(
    client.digest({ id: 1, size: 2 }),
    /exceeds declared size/,
  );
  let cancelled = false;
  const bad = githubClient(repository, "token", async () => ({
    status: 403,
    ok: false,
    body: {
      async cancel() {
        cancelled = true;
      },
    },
  }));
  await assert.rejects(bad.digest({ id: 1, size: 5 }), /HTTP 403/);
  assert.ok(cancelled);
});
test("CLI requires explicit execution and trusted default-branch dispatch; no implicit publication", async () => {
  assert.deepEqual(
    parseArguments(["plan", "--inputs", "reviewed", "--target", "all"]),
    { command: "plan", inputs: "reviewed", target: "all" },
  );
  assert.throws(
    () => parseArguments(["build", "--target", target, "--target", target]),
    /duplicate/,
  );
  assert.throws(() => parseArguments(["publish", "--unknown"]), /Unknown/);
  assert.throws(
    () =>
      parseArguments([
        "plan",
        "--runner-mode",
        "hosted",
        "--runner-mode",
        "dedicated",
      ]),
    /duplicate/,
  );
  await assert.rejects(
    main(["build", "--execute", "--repository", repository], {
      GITHUB_EVENT_NAME: "pull_request",
    }),
    /default-branch/,
  );
  await assert.rejects(
    main(["publish", "--execute", "--repository", repository], {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      CEF_DEFAULT_BRANCH: "main",
      GITHUB_REPOSITORY: repository,
    }),
    /Protected publish/,
  );
  const hostedEnv = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/reviewed-producer",
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_VISIBILITY: "public",
    RUNNER_ENVIRONMENT: "github-hosted",
  };
  await assert.rejects(
    main(
      ["build", "--runner-mode", "hosted", "--repository", repository],
      hostedEnv,
    ),
    /requires --execute/,
  );
  for (const patch of [
    { GITHUB_REPOSITORY_VISIBILITY: "private" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ])
    await assert.rejects(
      main(["build", "--runner-mode", "hosted", "--repository", repository], {
        ...hostedEnv,
        ...patch,
      }),
      /public hosted branch/,
    );
  await assert.rejects(
    main(["build", "--repository", repository], hostedEnv),
    /default-branch/,
  );
  await assert.rejects(
    main(["publish", "--repository", repository], hostedEnv),
    /default-branch/,
  );
});
test("hosted discovery and provision schedule only the requested native target", async () => {
  const workflow = YAML.parse(
    await readFile(
      path.join(root, ".github/workflows/cef-patched-runtime.yml"),
      "utf8",
    ),
  );
  const target = "x86_64-unknown-linux-gnu";
  for (const name of ["discover", "provision"]) {
    const job = workflow.jobs[name];
    // Evaluate the checked-in static matrix on the old workflow, or its actual
    // exported planner on the corrected one. This reproduces the six-runner
    // fan-out from the real workflow instead of a separately invented matrix.
    const actual =
      typeof job.strategy.matrix === "object"
        ? job.strategy.matrix
        : (
            await import("../../scripts/cef-hosted-bootstrap.mjs")
          ).hostedTargetMatrix(target);
    assert.deepEqual(
      actual.include.map((row) => row.target),
      [target],
      name,
    );
    assert.equal(job.needs, "hosted-plan");
    assert.equal(
      job.strategy.matrix,
      "${{ fromJSON(needs.hosted-plan.outputs.matrix) }}",
    );
  }
  const planned = workflow.jobs["hosted-plan"];
  assert.match(planned.if, /workflow_dispatch/);
  assert.match(planned.if, /visibility == 'public'/);
  assert.match(planned.if, /inputs.mode == 'discover'/);
  assert.match(planned.if, /inputs.mode == 'provision'/);
  assert.equal(planned.outputs.matrix, "${{ steps.plan.outputs.matrix }}");
  const step = planned.steps.find((entry) => entry.id === "plan");
  assert.equal(step.env.CEF_TARGET, "${{ inputs.target }}");
  assert.match(step.run, /hostedTargetMatrix\(process\.env\.CEF_TARGET\)/);
  assert.match(step.run, /appendFile\(process\.env\.GITHUB_OUTPUT/);
  assert.doesNotMatch(step.run, /\$\{\{\s*inputs\./);
});

test("the actual hosted planner step emits selected rows and rejects an unknown target before output", async (t) => {
  const workflow = YAML.parse(
    await readFile(
      path.join(root, ".github/workflows/cef-patched-runtime.yml"),
      "utf8",
    ),
  );
  const step = workflow.jobs["hosted-plan"].steps.find(
    (entry) => entry.id === "plan",
  );
  const source =
    /^node --input-type=module <<'NODE'\n([\s\S]*)\nNODE\n?$/u.exec(
      step.run,
    )?.[1];
  assert.ok(source, "execute the actual checked-in workflow JavaScript body");
  const { hostedTargetMatrix, RECIPE } =
    await import("../../scripts/cef-hosted-bootstrap.mjs");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cef-hosted-target-plan-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const target of [
    "all",
    ...TARGETS,
    "unknown-target\nmatrix=untrusted",
  ]) {
    const output = path.join(directory, "github-output");
    await writeFile(output, "");
    const result = exec(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd: root,
        env: { ...process.env, CEF_TARGET: target, GITHUB_OUTPUT: output },
        timeout: 10_000,
      },
    );
    if (target.startsWith("unknown")) {
      await assert.rejects(result, /Unknown hosted CEF target/);
      assert.equal(await readFile(output, "utf8"), "");
    } else {
      await result;
      const actual = await readFile(output, "utf8");
      assert.equal(
        actual,
        `matrix=${JSON.stringify(hostedTargetMatrix(target))}\n`,
      );
      const expected = RECIPE.targets
        .filter((row) => target === "all" || row.target === target)
        .map(({ target, runner, platform }) => ({ target, runner, platform }));
      assert.deepEqual(
        JSON.parse(actual.slice("matrix=".length)).include,
        expected,
      );
    }
  }
});

test("workflow has manual/default-branch guards, six targets, protected least-privilege publish and pinned actions", async () => {
  const raw = await readFile(
      path.join(root, ".github/workflows/cef-patched-runtime.yml"),
      "utf8",
    ),
    workflow = YAML.parse(raw);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.target.options, [
    "all",
    ...TARGETS,
  ]);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.publish.permissions.contents, "write");
  assert.equal(workflow.jobs.publish.environment, "cef-runtime-publish");
  assert.equal(workflow.jobs.build["runs-on"], "${{ matrix.runners }}");
  const prerequisiteUpload = workflow.jobs.build.steps.find(
    (step) =>
      step.with?.name === "cef-hosted-build-prerequisites-${{ matrix.key }}",
  );
  assert.match(prerequisiteUpload.if, /always\(\)/);
  assert.equal(
    prerequisiteUpload.with.path,
    "${{ runner.temp }}/cef-hosted-provision",
  );
  assert.doesNotMatch(prerequisiteUpload.if, /steps\.build\.outputs/);
  assert.match(workflow.jobs.publish.concurrency.group, /matrix.key/);
  assert.equal(workflow.concurrency, undefined);
  assert.equal(workflow.jobs.publish.concurrency["cancel-in-progress"], false);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.match(job.if, /workflow_dispatch/);
    if (name === "hosted-plan") {
      assert.match(job.if, /visibility == 'public'/);
      assert.match(job.if, /mode == 'discover'/);
      assert.match(job.if, /mode == 'provision'/);
      assert.doesNotMatch(
        job.if,
        /mode == 'build'|mode == 'hosted-build'|mode == 'acceptance'/,
      );
    } else if (["discover", "provision", "accept-native"].includes(name)) {
      assert.match(job.if, /visibility == 'public'/);
      assert.match(
        job.if,
        new RegExp(
          `mode == '${name === "accept-native" ? "acceptance" : name}'`,
        ),
      );
    } else {
      assert.match(job.if, /default_branch/);
      assert.match(job.if, /mode == 'build'/);
    }
    if (!["publish", "accept-native"].includes(name))
      assert.notEqual(job.permissions?.contents, "write");
    for (const step of job.steps ?? []) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout"))
        assert.equal(step.with["persist-credentials"], false);
      if (step.run) assert.doesNotMatch(step.run, /\$\{\{\s*inputs\./);
    }
  }
  assert.equal(
    workflow.jobs["accept-native"].uses,
    "./.github/workflows/cef-runtime-acceptance.yml",
  );
  assert.deepEqual(workflow.jobs["accept-native"].permissions, {
    contents: "write",
    actions: "read",
  });
  assert.equal(workflow.jobs["accept-native"].secrets, undefined);
  assert.ok(
    workflow.jobs.build.steps.some(
      (step) =>
        step.if?.includes("always()") &&
        step.uses?.startsWith("actions/upload-artifact"),
    ),
  );
  assert.doesNotMatch(
    raw,
    /(?:apt-get|brew install|choco install|cargo |npm ci)/,
  );
});

test("producer supersession cancels only the same validation purpose and actual target, preserving publication", async () => {
  const workflow = YAML.parse(
    await readFile(
      path.join(root, ".github/workflows/cef-patched-runtime.yml"),
      "utf8",
    ),
  );
  // Evaluate the actual closed variable expressions from the YAML. No eval and
  // no independently reimplemented group template that could hide YAML drift.
  const group = (job, context) => {
    const result = job.concurrency.group.replace(
      /\$\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/gu,
      (_, expression) => {
        const value = expression
          .split(".")
          .reduce((object, key) => object?.[key], context);
        assert.equal(
          typeof value,
          "string",
          `Missing concurrency input ${expression}`,
        );
        return value;
      },
    );
    assert.doesNotMatch(
      result,
      /\$\{\{/u,
      "Unsupported concurrency expression",
    );
    return result;
  };
  const context = {
    github: {
      ref: "refs/heads/engine-verification",
      sha: "a".repeat(40),
      run_id: "100",
    },
    inputs: {
      mode: "hosted-build",
      reviewed_inputs: "native/cef-build-inputs/reviewed-r4",
      target: "all",
    },
    matrix: { target: TARGETS[0], key: `reviewed-lock-${TARGETS[0]}` },
  };
  assert.equal(
    workflow.concurrency,
    undefined,
    "No caller-wide cancellation may interrupt publishing",
  );
  const nonpublishing = Object.entries(workflow.jobs).filter(
    ([name]) => name !== "publish",
  );
  for (const [name, job] of nonpublishing) {
    assert.equal(job.concurrency["cancel-in-progress"], true, name);
    assert.doesNotMatch(
      job.concurrency.group,
      /github\.(?:sha|run_id|run_number)/u,
    );
    assert.equal(
      group(job, context),
      group(job, {
        ...context,
        github: { ...context.github, sha: "b".repeat(40), run_id: "101" },
      }),
      `${name}: newer source must supersede earlier source`,
    );
    for (const changed of [
      {
        ...context,
        github: { ...context.github, ref: "refs/heads/another-branch" },
      },
      { ...context, inputs: { ...context.inputs, mode: "build" } },
      {
        ...context,
        inputs: {
          ...context.inputs,
          reviewed_inputs: "native/cef-build-inputs/another-reviewed-variant",
        },
      },
    ])
      assert.notEqual(group(job, context), group(job, changed), name);
  }
  assert.equal(
    new Set(nonpublishing.map(([, job]) => group(job, context))).size,
    nonpublishing.length,
  );
  for (const name of ["discover", "provision", "build"]) {
    const job = workflow.jobs[name];
    assert.equal(
      group(job, context),
      group(job, {
        ...context,
        inputs: { ...context.inputs, target: context.matrix.target },
      }),
      `${name}: all and single-target dispatches share the actual target key`,
    );
    const siblings = TARGETS.map((target) =>
      group(job, { ...context, matrix: { ...context.matrix, target } }),
    );
    assert.equal(
      new Set(siblings).size,
      TARGETS.length,
      `${name}: matrix siblings must not cancel each other`,
    );
  }
  assert.notEqual(
    group(workflow.jobs.plan, context),
    group(workflow.jobs.plan, {
      ...context,
      inputs: { ...context.inputs, target: TARGETS[0] },
    }),
  );
  const publish = workflow.jobs.publish;
  assert.deepEqual(publish.concurrency, {
    group: "cef-engine-publish-${{ matrix.key }}",
    "cancel-in-progress": false,
  });
  assert.equal(publish.environment, "cef-runtime-publish");
  assert.deepEqual(publish.permissions, { contents: "write" });
  assert.notEqual(
    group(publish, context),
    group(publish, {
      ...context,
      matrix: { ...context.matrix, key: `another-lock-${TARGETS[0]}` },
    }),
  );
});
const pinnedGitTemplate = Buffer.from(
  [
    "@echo off",
    "setlocal",
    "if not defined EDITOR set EDITOR=notepad",
    ":: Exclude the current directory when searching for executables.",
    ":: This is required for the SSO helper to run, which is written in Go.",
    ":: Without this set, the SSO helper may throw an error when resolving",
    ":: the `git` command (see https://pkg.go.dev/os/exec for more details).",
    'set "NoDefaultCurrentDirectoryInExePath=1"',
    'set "PATH=${GIT_PATH_PREPEND};%~dp0;%PATH%"',
    '"${GIT_PROGRAM}" %*',
    "",
  ].join("\n"),
);

test("Windows Git selection requires the exact reviewed native file and rejects missing or tampered pins before acquisition", async (t) => {
  const work = await temp(t);
  const bytes = Buffer.from("inert native Git fixture; never executed");
  const selected = WINDOWS_GIT_PROGRAMS[target];
  await put(work, selected, bytes);
  const toolchain = {
    files: [{ ...pin(selected, bytes), size: bytes.length }],
  };
  const map = { ...runner(), git: selected };
  const options = { runner: map, target, toolchain, toolsRoot: work };
  assert.equal(
    await verifyWindowsGitProgram(options),
    path.resolve(work, selected),
  );
  await assert.rejects(
    verifyWindowsGitProgram({ ...options, runner: runner() }),
    /explicit native Windows Git/,
  );
  await assert.rejects(
    verifyWindowsGitProgram({ ...options, toolchain: { files: [] } }),
    /no reviewed file pin/,
  );
  assert.throws(
    () =>
      validateRunnerMap(
        { ...map, git: "Program Files/Git/cmd/git.exe" },
        target,
      ),
    /target-native/,
  );
  await put(work, selected, "changed bytes");
  await assert.rejects(verifyWindowsGitProgram(options), /mismatch/);
  await rm(path.join(work, selected));
  await assert.rejects(verifyWindowsGitProgram(options), /ENOENT/);
});

test("the missing Windows git.bat is generated only from the pinned template and explicit executable, without bootstrapping", async (t) => {
  const work = await temp(t),
    depot = path.join(work, "owned depot"),
    logs = path.join(work, "logs");
  await mkdir(logs);
  await put(depot, "bootstrap/git.template.bat", pinnedGitTemplate);
  assert.equal(hash(pinnedGitTemplate), WINDOWS_GIT_TEMPLATE_SHA256);
  const gitExecutable = path.resolve(
    work,
    "Program Files/Git/ucrt64/bin/git.exe",
  );
  await assert.rejects(readFile(path.join(depot, "git.bat")), /ENOENT/);
  const receipt = await prepareWindowsGitLauncher({
    depot,
    gitExecutable,
    logs,
  });
  const launcher = await readFile(path.join(depot, "git.bat"));
  assert.ok(launcher.includes(Buffer.from('"' + gitExecutable + '" %*')));
  assert.ok(
    launcher.includes(
      Buffer.from("PATH=" + path.dirname(gitExecutable) + ";%~dp0;%PATH%"),
    ),
  );
  assert.equal(launcher.includes(Buffer.from("${")), false);
  assert.equal(receipt.launcherSha256, hash(launcher));
  assert.equal(receipt.bootstrapExecuted, false);
  assert.equal(receipt.globalGitConfigurationWritten, false);
  assert.equal(receipt.pathFallbackAllowed, false);
  assert.deepEqual(
    await readFile(path.join(depot, "bootstrap/git.template.bat")),
    pinnedGitTemplate,
  );
  await assert.rejects(
    prepareWindowsGitLauncher({ depot, gitExecutable, logs }),
    /EEXIST/,
  );
});

test("tampered launcher templates and command-sensitive explicit paths fail before creating any shim", async (t) => {
  const work = await temp(t),
    depot = path.join(work, "depot"),
    logs = path.join(work, "logs");
  await mkdir(logs);
  await put(
    depot,
    "bootstrap/git.template.bat",
    Buffer.concat([pinnedGitTemplate, Buffer.from("changed")]),
  );
  const gitExecutable = path.resolve(work, "git.exe");
  await assert.rejects(
    prepareWindowsGitLauncher({ depot, gitExecutable, logs }),
    /template mismatch/,
  );
  await assert.rejects(readFile(path.join(depot, "git.bat")), /ENOENT/);
  for (const dangerous of ["%PATH%", 'bad"quote', "bad&command", "bad\nline"])
    await assert.rejects(
      prepareWindowsGitLauncher({
        depot,
        gitExecutable: path.resolve(work, dangerous, "git.exe"),
        logs,
      }),
      /Unsafe/,
    );
});

test("engineering checkpoints cannot select a dedicated or foreign producer before acquisition", async () => {
  await assert.rejects(
    build({
      execute: true,
      repository: "owner/repo",
      target: "x86_64-apple-darwin",
      runnerMode: "dedicated",
      engineering: {},
    }),
    /Engineering checkpoint requires/,
  );
  await assert.rejects(
    build({
      execute: true,
      repository: "owner/repo",
      target: "x86_64-pc-windows-msvc",
      runnerMode: "hosted",
      engineering: {},
    }),
    /Unknown checkpoint target/,
  );
  assert.throws(
    () => parseArguments(["build", "--checkpoint", "yes"]),
    /Unknown\/duplicate/,
  );
});

test("actual engineering build gate binds all three closed profiles to their pinned source and x64 host", async () => {
  for (const target of [
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
  ]) {
    const profile = checkpointProfile(target);
    const { sourceLock } = await plan({
      inputs: profile.inputs,
      target,
      runnerMode: "hosted",
    });
    const sourceLockIdentity = releaseIdentity(
      sourceLock,
      target,
    ).sourceLockSha256;
    const options = {
      inputs: profile.inputs,
      target,
      runnerMode: "hosted",
      sourceLockIdentity,
    };
    assert.equal(
      engineeringBuildProfile(options, profile.platform, "x64"),
      profile,
    );
    for (const platform of [
      "win32",
      profile.platform === "darwin" ? "linux" : "darwin",
    ])
      assert.throws(
        () => engineeringBuildProfile(options, platform, "x64"),
        /Unreviewed checkpoint build host/,
      );
    assert.throws(
      () => engineeringBuildProfile(options, profile.platform, "arm64"),
      /Unreviewed checkpoint build host/,
    );
    assert.throws(
      () =>
        engineeringBuildProfile(
          { ...options, runnerMode: "dedicated" },
          profile.platform,
          "x64",
        ),
      /Engineering checkpoint requires/,
    );
    assert.throws(
      () =>
        engineeringBuildProfile(
          { ...options, inputs: "native/cef-build-inputs/unreviewed" },
          profile.platform,
          "x64",
        ),
      /exact reviewed inputs and source identity/,
    );
    assert.throws(
      () =>
        engineeringBuildProfile(
          { ...options, sourceLockIdentity: "0".repeat(64) },
          profile.platform,
          "x64",
        ),
      /exact reviewed inputs and source identity/,
    );
    const changedRevision = structuredClone(sourceLock);
    changedRevision.bridge.patchId = "sorng-tls-v2-682c378-5";
    assert.throws(
      () =>
        engineeringBuildProfile(
          { ...options, sourceLockIdentity: identitySha256(changedRevision) },
          profile.platform,
          "x64",
        ),
      /exact reviewed inputs and source identity/,
    );
  }
  for (const target of [
    "x86_64-pc-windows-msvc",
    "aarch64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
    "unknown",
  ])
    assert.throws(
      () =>
        engineeringBuildProfile(
          {
            inputs: "unreviewed",
            target,
            runnerMode: "hosted",
            sourceLockIdentity: "0".repeat(64),
          },
          "win32",
          "x64",
        ),
      /Unknown checkpoint target/,
    );
});

test("engineering packaging continues only for explicit complete-SDK intent and genuinely clean compiler completion", () => {
  const valid = {
    kind: "continue-sdk",
    compile: { outcome: "compiler-complete", exitCode: 0, quiescent: true },
  };
  assert.equal(engineeringSdkContinuation({ completeSdk: true }, valid), true);
  assert.equal(
    engineeringSdkContinuation({ completeSdk: true }, { checkpoint: true }),
    false,
  );
  assert.throws(() =>
    engineeringSdkContinuation({ completeSdk: false }, valid),
  );
  for (const compile of [
    { outcome: "slice-ended", exitCode: null, quiescent: true },
    { outcome: "compiler-failed", exitCode: 137, quiescent: true },
    { outcome: "compiler-complete", exitCode: 0, quiescent: false },
  ])
    assert.throws(() =>
      engineeringSdkContinuation(
        { completeSdk: true },
        { kind: "continue-sdk", compile },
      ),
    );
});

test("ordinary and engineering producers share Metal attestation after reviewed tool-map validation", async () => {
  const source = await readFile(
    new URL("../../scripts/cef-runtime-ci.mjs", import.meta.url),
    "utf8",
  );
  const verify = source.indexOf("await verifyToolchainFiles({");
  const prepare = source.indexOf(
    "const metal = await prepareMacMetalToolchain({",
  );
  const acquire = source.indexOf('"acquire",', prepare);
  assert.ok(verify >= 0 && prepare > verify && acquire > prepare);
  assert.match(source, /platform: expectedPlatform/);
  assert.match(source, /DEVELOPER_DIR: childEnv.DEVELOPER_DIR/);
  assert.match(source, /SDKROOT: childEnv.SDKROOT/);
  assert.match(source, /allowDownload: runnerMode === "hosted"/);
  assert.match(source, /mac-metal-toolchain\.json/);
  assert.match(source, /supplementalMetalPrePinned: false/);
  assert.match(source, /MAC_METAL_PRODUCER_DRIFT/);
  assert.ok(
    source.indexOf("const currentMetal = await prepareMacMetalToolchain") <
      source.indexOf("const decision = await engineering.compile"),
  );
});

async function armToolProbe() {
  const workflow = YAML.parse(
    await readFile(
      path.join(root, ".github/workflows/cef-patched-runtime.yml"),
      "utf8",
    ),
  );
  const step = workflow.jobs.provision.steps.find(
    (s) => s.name === "Observe bounded fixed native Windows ARM tool closure",
  );
  assert(step);
  const source = step.run
    .split("<<'NODE'\n")[1]
    .split("\ntry { await main(); }")[0];
  const module = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
  return { workflow, step, source, module };
}
function armPeFixture() {
  const b = Buffer.alloc(0x800);
  b.writeUInt16LE(0x5a4d);
  b.writeUInt32LE(0x80, 60);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0xaa64, 0x84);
  b.writeUInt16LE(1, 0x86);
  b.writeUInt16LE(240, 0x94);
  const op = 0x98;
  b.writeUInt16LE(0x20b, op);
  b.writeBigUInt64LE(0x140000000n, op + 24);
  b.writeUInt32LE(16, op + 108);
  const section = op + 240;
  b.writeUInt32LE(0x600, section + 8);
  b.writeUInt32LE(0x1000, section + 12);
  b.writeUInt32LE(0x600, section + 16);
  b.writeUInt32LE(0x200, section + 20);
  b.writeUInt32LE(0x1000, op + 112 + 8);
  b.writeUInt32LE(40, op + 112 + 12);
  b.writeUInt32LE(0x1100, 0x200 + 12);
  b.write("kernel32.dll\0", 0x300);
  b.writeUInt32LE(0x1200, op + 112 + 13 * 8);
  b.writeUInt32LE(64, op + 116 + 13 * 8);
  b.writeUInt32LE(1, 0x400);
  b.writeUInt32LE(0x1300, 0x404);
  b.write("api-ms-win-core-test-l1-1-0.dll\0", 0x500);
  return b;
}
function arMember(name, bytes) {
  const h = Buffer.alloc(60, 32);
  h.write(name);
  h.write(String(bytes.length).padEnd(10), 48);
  h.write("`\n", 58);
  return Buffer.concat([
    h,
    bytes,
    ...(bytes.length % 2 ? [Buffer.from("\n")] : []),
  ]);
}
test("optional Windows ARM observation stays in existing provision job with original defaults and authorities", async () => {
  const { workflow, step, source, module } = await armToolProbe();
  assert.equal(
    workflow.on.workflow_dispatch.inputs.windows_arm_tool_probe.default,
    false,
  );
  assert.equal(
    step.if,
    "inputs.windows_arm_tool_probe && inputs.mode == 'provision' && matrix.target == 'aarch64-pc-windows-msvc'",
  );
  assert.equal(step["timeout-minutes"], 11);
  assert.equal(
    module.PROGRAMS.git,
    "C:/Program Files/Git/clangarm64/bin/git.exe",
  );
  assert.equal(
    module.PROGRAMS.python,
    "C:/hostedtoolcache/windows/Python/3.13.17/arm64/python.exe",
  );
  assert.equal(workflow.jobs.provision["timeout-minutes"], 30);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(step.env.CEF_TARGET, "aarch64-pc-windows-msvc");
  assert.doesNotMatch(
    source,
    /Get-AuthenticodeSignature|LoadLibrary|vcvars|Set-ItemProperty|--no-sandbox|exec\(.+cl\.exe|npm (?:ci|install)/,
  );
  assert.match(source, /complete:false/);
  assert.match(source, /producerMapCreated:false/);
  assert.match(source, /setupCompatibility:null/);
});
test("actual extracted ARM PE reader bounds imports delay imports native machine and malformed ranges", async () => {
  const { module: m } = await armToolProbe(),
    good = armPeFixture();
  const result = m.pe(good);
  assert.equal(result.architecture, "arm64");
  assert.deepEqual(result.imports, ["kernel32.dll"]);
  assert.deepEqual(result.delayImports, ["api-ms-win-core-test-l1-1-0.dll"]);
  assert.equal(result.dynamicImportsComplete, false);
  for (const mutate of [
    (b) => b.writeUInt32LE(0xffffffff, 60),
    (b) => b.writeUInt16LE(97, 0x86),
    (b) => b.writeUInt32LE(0xffffffff, 0x20c),
    (b) => b.writeUInt32LE(20, 0x98 + 112 + 12),
    (b) => b.writeUInt32LE(0, 0x400),
    (b) => b.write("../foreign.dll\0", 0x300),
    (b) => b.writeUInt32LE(0x100, 0x98 + 240 + 20),
  ]) {
    const b = Buffer.from(good);
    mutate(b);
    assert.throws(() => m.pe(b));
  }
  assert.throws(() => m.pe(good.subarray(0, 60)));
});
test("actual extracted COFF reader classifies mixed ARM64EC archives without invented purity and rejects bad indexes", async () => {
  const { module: m } = await armToolProbe(),
    native = Buffer.alloc(20),
    ec = Buffer.alloc(56);
  native.writeUInt16LE(0xaa64);
  ec.writeUInt16LE(0xffff, 2);
  ec.writeUInt16LE(0xa641, 6);
  const b = Buffer.concat([
    Buffer.from("!<arch>\n"),
    arMember("/", Buffer.alloc(0)),
    arMember("/<ECSYMBOLS>/", Buffer.alloc(0)),
    arMember("native.obj/", native),
    arMember("ec.obj/", ec),
  ]);
  const parsed = m.coffArchive(b);
  assert.deepEqual(parsed.machines, { arm64: 1, arm64ec: 1 });
  assert.equal(parsed.nativeMap, true);
  assert.equal(parsed.ecMap, true);
  assert.equal(parsed.pureArm64, false);
  assert.equal(parsed.setupCompatibility, null);
  assert.throws(() => m.coffArchive(b.subarray(0, b.length - 1)));
  assert.throws(() =>
    m.coffArchive(
      Buffer.concat([Buffer.from("!<arch>\n"), arMember("/999", native)]),
    ),
  );
  const bad = Buffer.from(b);
  bad.write("9999999999", 8 + 48);
  assert.throws(() => m.coffArchive(bad));
});
test("ARM observation real owned-file hashing rejects links and metadata growth while preserving outside targets", async (t) => {
  const { module: m } = await armToolProbe();
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-arm-tool-observation-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "owned.h"),
    outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "sentinel"), "safe");
  await writeFile(file, "header");
  const state = () => ({ files: 0, bytes: 0, end: performance.now() + 10000 });
  const result = await m.fileObservation(file, state(), { parse: false });
  assert.equal(result.size, 6);
  assert.equal(
    result.sha256,
    createHash("sha256").update("header").digest("hex"),
  );
  await symlink(
    outside,
    path.join(root, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(m.noLinks(path.join(root, "alias", "sentinel")));
  assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "safe");
  const actual = await import("node:fs/promises");
  let changed = false;
  const io = {
    ...actual,
    open: async (...args) => {
      const h = await actual.open(...args);
      return {
        stat: () => h.stat({ bigint: true }),
        close: () => h.close(),
        read: async (...r) => {
          if (!changed) {
            changed = true;
            await actual.appendFile(file, "growth");
          }
          return h.read(...r);
        },
      };
    },
  };
  await assert.rejects(m.fileObservation(file, state(), { io, parse: false }));
  assert.throws(() => m.checkBudget({ files: 20000, bytes: 0, end: Infinity }));
  assert.throws(() =>
    m.checkBudget({ files: 0, bytes: 4 * 1024 ** 3, end: Infinity }, 1),
  );
  assert.throws(() => m.checkBudget({ files: 0, bytes: 0, end: 0 }));
});
test("ARM cache-only trust signature schema and WinTrust ABI remain explicit unknowns without network trust bypass", async () => {
  const { module: m } = await armToolProbe();
  const script = m.SIGNATURE_SCRIPT;
  assert.match(script, /flags=0x1000\|0x80/);
  assert.match(script, /ui=2,revocation=1,choice=1/);
  assert.match(script, /00AAC56B-CD44-11D0-8CC2-00C04FC295EE/);
  assert.match(script, /data.action=2;closed=unchecked/);
  assert.match(
    script,
    /Marshal.SizeOf<FILEINFO>\(\)!=32\|\|Marshal.SizeOf<DATA>\(\)!=88/,
  );
  assert.match(script, /C:\\Windows\\System32\\wintrust.dll/);
  assert.match(script, /FileShare.Read/);
  assert.doesNotMatch(
    script,
    /Get-AuthenticodeSignature|Download|LoadLibrary|Set-AuthenticodeSignature/,
  );
  const row = {
    schemaVersion: 1,
    status: 0x800b010e,
    closeStatus: 0,
    fileVersion: "3.13.17",
    cacheOnly: true,
    subjectObserved: false,
  };
  assert.equal(
    m.signatureObservation({ stdout: JSON.stringify(row) }).verified,
    false,
  );
  for (const patch of [
    { cacheOnly: false },
    { status: -1 },
    { fileVersion: "private\nsecret" },
    { extra: "secret" },
  ])
    assert.throws(() =>
      m.signatureObservation({ stdout: JSON.stringify({ ...row, ...patch }) }),
    );
});
test("ARM probe child timeout joins actual hidden owned child and refuses leaked output", async () => {
  const { module: m } = await armToolProbe();
  await assert.rejects(
    m.ownedCommand(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      {},
      performance.now() + 10000,
      { milliseconds: 30 },
    ),
    /ARM_TOOL_COMMAND_DEADLINE/,
  );
  await assert.rejects(
    m.ownedCommand(
      process.execPath,
      [
        "-e",
        'process.stdout.write("x".repeat(65537));setInterval(()=>{},1000)',
      ],
      {},
      performance.now() + 10000,
      { milliseconds: 2000 },
    ),
    /ARM_TOOL_OUTPUT_BOUND/,
  );
});

test("ARM inventory traversal stops at its file budget with a retained partial observation", async (t) => {
  const { module: m } = await armToolProbe();
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-arm-tool-walk-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "a.h"), "a");
  await writeFile(path.join(root, "b.h"), "b");
  const state = { files: 19999, bytes: 0, end: performance.now() + 10000 },
    rows = [];
  await assert.rejects(m.walk(root, state, rows), /ARM_TOOL_INVENTORY_BOUND/);
  assert.equal(rows.length, 1);
  assert.equal(state.files, 20000);
});
test("ARM child post-spawn failure retains original error until exact child close", async () => {
  const { module: m } = await armToolProbe(),
    { EventEmitter } = await import("node:events"),
    { PassThrough } = await import("node:stream");
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let closed = false,
    kills = 0,
    settled = false;
  const original = Error("secret-not-serialized");
  child.kill = () => {
    kills++;
    setTimeout(() => {
      closed = true;
      child.emit("close", null, "SIGKILL");
    }, 40);
    return true;
  };
  const promise = m.ownedCommand(
    process.execPath,
    [],
    {},
    performance.now() + 10000,
    {
      start: () => {
        setImmediate(() => child.emit("error", original));
        return child;
      },
    },
  );
  const checked = assert.rejects(
    promise.then(
      (v) => {
        settled = true;
        return v;
      },
      (e) => {
        settled = true;
        throw e;
      },
    ),
    (e) => e === original,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);
  await checked;
  assert.equal(closed, true);
  assert.equal(kills, 1);
});

test("ARM passive metadata uses one bounded held byte stream for parsing and authentication", async (t) => {
  const { module: m } = await armToolProbe();
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-arm-held-json-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "after"));
  for (const name of ["observation.json", "toolchain-candidate.json"])
    await writeFile(
      path.join(root, "after", name),
      JSON.stringify({
        schemaVersion: 1,
        target: "aarch64-pc-windows-msvc",
        native: { git: { candidates: [] } },
      }) + "\n",
    );
  const state = { files: 0, bytes: 0, end: performance.now() + 10000 };
  const result = await m.originalObservations(root, state);
  assert.equal(result.records.length, 2);
  for (const row of result.records) {
    const bytes = await readFile(path.join(root, "after", row.name));
    assert.equal(row.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(row.size, bytes.length);
  }
  assert.equal(state.files, 2);
  assert.doesNotMatch(m.originalObservations.toString(), /readFile/);
  await writeFile(
    path.join(root, "after", "observation.json"),
    Buffer.alloc(2 * 1024 ** 2 + 1, 32),
  );
  await assert.rejects(
    m.originalObservations(root, {
      files: 0,
      bytes: 0,
      end: performance.now() + 10000,
    }),
  );
});
test("ARM passive broad walk deduplicates prior canonical identity without inventing hash passes", async (t) => {
  const { module: m } = await armToolProbe();
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-arm-core-first-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "core.h");
  await writeFile(file, "original");
  const state = { files: 0, bytes: 0, end: performance.now() + 10000 };
  const rows = [await m.fileObservation(file, state, { parse: false })];
  assert.equal(state.files, 1);
  await m.walk(root, state, rows);
  assert.equal(state.files, 1);
  assert.equal(state.bytes, 8);
  assert.equal(rows.length, 1);
  await writeFile(file, "changed");
  await assert.rejects(m.walk(root, state, rows), /ARM_TOOL_FILE_CHANGED/);
  assert.equal(state.files, 1);
});
test("ARM main is passive only and persists core before broader inventory under one aggregate byte bound", async () => {
  const { module: m } = await armToolProbe(),
    source = m.main.toString();
  assert.doesNotMatch(source, /ownedCommand\(|SIGNATURE_SCRIPT|spawn\(/);
  assert.match(source, /passive-only-no-reviewed-job-backend/);
  assert.match(source, /status:'not-observed'/);
  assert(
    source.indexOf("'core-observation.json'") <
      source.indexOf("for(const root of roots)"),
  );
  assert(source.indexOf("const core=") < source.indexOf("const roots="));
  const bytes = m.outputBytes({ x: "bounded" }, 0, 100);
  assert.equal(bytes.at(-1), 10);
  assert.doesNotThrow(() =>
    m.outputBytes({ x: "bounded" }, 100 - bytes.length, 100),
  );
  assert.throws(
    () => m.outputBytes({ x: "bounded" }, 101 - bytes.length, 100),
    /ARM_TOOL_OUTPUT_BOUND/,
  );
});
