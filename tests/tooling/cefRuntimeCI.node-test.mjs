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
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  RUNNERS,
  MAX_RELEASE_ASSET,
  PACK_PYTHON,
  boundedBuildCommands,
  buildEnvironment,
  createHostedBuildBudget,
  run as runBuildCommand,
  assertHostedBuildIdentity,
  assertHostedCapacity,
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
  BRIDGE_PATCH_ID,
  BRIDGE_V2,
  UPSTREAM_CEF_COMMIT,
  UPSTREAM_CHROMIUM_COMMIT,
  UPSTREAM_DEPOT_TOOLS_COMMIT,
  customRuntimeBuildRecipe,
  identitySha256,
  preflightCustomRuntime,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { CEF_PIN, TARGETS } from "../../scripts/browser-runtime-package.mjs";
import { RELEASE_LIMITS } from "../../scripts/lib/browser-runtime-release.mjs";

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

test("hosted builds bind actual reviewed image and only explicit same-OS macOS ARM cross-compilation", () => {
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
  assert.equal(env.GYP_MSVS_OVERRIDE_PATH, `/tools${path.sep}native`);
  assert.equal(env.KEEP, "yes");
  assert.equal(env.DEPOT_TOOLS_UPDATE, "0");
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
    if (["discover", "provision", "accept-native"].includes(name)) {
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
    if (name !== "publish") assert.notEqual(job.permissions?.contents, "write");
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
    contents: "read",
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
