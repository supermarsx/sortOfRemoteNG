import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  chmod,
  stat,
  readlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_V2,
  BRIDGE_PATCH_ID,
  UPSTREAM_CEF_COMMIT,
  UPSTREAM_CEF_VERSION_REFERENCES,
  UPSTREAM_CHROMIUM_COMMIT,
  UPSTREAM_DEPOT_TOOLS_COMMIT,
  identitySha256,
  validateSourceLock,
  validateCustomRuntimeManifest,
  preflightCustomRuntime,
  prepareCustomRuntime,
  verifyPreparedCustomRuntime,
  inspectCustomRuntimeExports,
  customRuntimeEnvironment,
  preflightSourceCheckout,
  customRuntimeBuildRecipe,
  sourceAcquisitionPlan,
  assessWindowsEnginePrerequisites,
  verifyToolchainFiles,
  verifySourceBuildIsolation,
  verifySourceCheckoutVersion,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  acquireSources,
  parseArguments,
  main,
} from "../../scripts/cef-patched-runtime.mjs";
import {
  parseArguments as parseAppArguments,
  stageApplicationPackage,
  bundleConfiguration,
  loadCustomRuntimeInputs,
} from "../../scripts/browser-app-build.mjs";
import { prepareWindowsInstallerBundles } from "../../scripts/lib/browser-installer-bundles.mjs";
import {
  CEF_PIN,
  TARGETS,
  packageManifest,
  inspectBundle,
} from "../../scripts/browser-runtime-package.mjs";

// Every byte/digest here is a synthetic test fixture, NEVER a production pin or
// a claim that the fixture files are executable CEF libraries/archives.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2);
const clone = (value) => structuredClone(value);
const pin = (name, bytes) => ({
  path: name,
  sha256: hash(bytes),
  size: Buffer.byteLength(bytes),
});
const smallPin = (name, bytes) => ({ path: name, sha256: hash(bytes) });

function gnArgs(target) {
  return `target_cpu="${target.startsWith("aarch64") ? "arm64" : "x64"}" is_component_build=false is_debug=false use_remoteexec=false use_siso=true${target.includes("apple") ? ' mac_deployment_target="14.0"' : target.includes("linux") ? " ozone_platform_x11=true" : ""}`;
}
function fixture() {
  const inputFiles = {
    "patches/bridge.patch":
      "fixture patch bytes; not an applicable upstream patch\n",
    "include/cef_sorng_tls_bridge.h":
      "fixture ABI header; not a production contract\n",
  };
  const python = "fixture Python executable bytes; never executed";
  const lock = {
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
      {
        repository: "cef",
        ...smallPin("patches/bridge.patch", inputFiles["patches/bridge.patch"]),
      },
    ],
    bridge: {
      ...BRIDGE_V2,
      patchId: BRIDGE_PATCH_ID,
      header: smallPin(
        "include/cef_sorng_tls_bridge.h",
        inputFiles["include/cef_sorng_tls_bridge.h"],
      ),
    },
    builds: TARGETS.map((target) => {
      const gn = `gn/${target}.gn`,
        toolchain = `tools/${target}.json`;
      inputFiles[gn] = gnArgs(target);
      inputFiles[toolchain] = json({
        schemaVersion: 1,
        kind: "sorng-cef-toolchain-lock",
        target,
        files: [pin("python-fixture", python)],
      });
      return {
        target,
        gnArgs: smallPin(gn, inputFiles[gn]),
        toolchainLock: smallPin(toolchain, inputFiles[toolchain]),
      };
    }),
  };
  const packages = TARGETS.map((target) => {
    const windows = target.includes("windows"),
      linux = target.includes("linux");
    const library = windows
      ? "Release/libcef.dll"
      : linux
        ? "Release/libcef.so"
        : "Release/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework";
    const sandbox = windows
      ? "Release/bootstrap.exe"
      : linux
        ? "Release/chrome-sandbox"
        : "Release/Chromium Embedded Framework.framework/Versions/A/Libraries/libcef_sandbox.dylib";
    const sdkFiles = {
      "include/cef_version.h": `#define CEF_VERSION "${CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${UPSTREAM_CEF_COMMIT}"\n#define CEF_SANDBOX_COMPAT_HASH "${windows ? CEF_PIN.sandboxCompat : ""}"\n`,
      "include/cef_sorng_tls_bridge.h":
        inputFiles["include/cef_sorng_tls_bridge.h"],
      "archive.json": json({ name: "fixture custom SDK metadata" }),
      "CREDITS.html": "fixture credits",
      [library]: "fixture library, not PE/ELF/MachO",
      [sandbox]: "fixture sandbox, not executable",
    };
    const artifact = {
      target,
      archive: pin(
        `sorng-cef-custom-fixture-${target}.tar.bz2`,
        "fixture archive, not compressed",
      ),
      provenance: null,
      sdkFiles: Object.entries(sdkFiles).map(([name, bytes]) => ({
        ...pin(name, bytes),
        type: "file",
      })),
      runtime: {
        library,
        sandbox,
        cefCommit: UPSTREAM_CEF_COMMIT,
        cefVersion: CEF_PIN.version,
        cefApiVersion: 15400,
        cefApiHash: hash("fixture API").slice(0, 40),
        sandboxCompat: windows ? CEF_PIN.sandboxCompat : "",
      },
    };
    const receipt = {
      schemaVersion: 1,
      kind: "sorng-cef-custom-build-receipt",
      target,
      sourceLockSha256: identitySha256(lock),
      archiveSha256: artifact.archive.sha256,
      sdkInventorySha256: identitySha256(artifact.sdkFiles),
      buildInputsSha256: identitySha256(
        lock.builds.find((b) => b.target === target),
      ),
    };
    artifact.provenance = pin(`receipt-${target}.json`, json(receipt));
    return { artifact, sdkFiles, receipt };
  });
  return {
    lock,
    inputFiles,
    python,
    packages,
    manifest: {
      schemaVersion: 1,
      kind: "sorng-cef-custom-runtime",
      sourceLockSha256: identitySha256(lock),
      artifacts: packages.map((p) => p.artifact),
    },
  };
}
async function writeTree(root, files) {
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
  }
}
async function diskFixture(t, selected = TARGETS[0]) {
  const data = fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "sorng-custom-cef-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputsRoot = path.join(root, "inputs"),
    sdkRoot = path.join(root, "sdk"),
    artifactRoot = path.join(root, "artifacts"),
    toolsRoot = path.join(root, "tools");
  const pkg = data.packages.find((p) => p.artifact.target === selected);
  await writeTree(inputsRoot, data.inputFiles);
  await writeTree(sdkRoot, pkg.sdkFiles);
  await writeTree(artifactRoot, {
    [pkg.artifact.archive.path]: "fixture archive, not compressed",
    [pkg.artifact.provenance.path]: json(pkg.receipt),
  });
  await writeTree(toolsRoot, { "python-fixture": data.python });
  return {
    ...data,
    root,
    inputsRoot,
    sdkRoot,
    artifactRoot,
    toolsRoot,
    pkg,
    target: selected,
    sourceLock: data.lock,
  };
}

test("canonical identity binds patch order and bytes, not JSON key order", () => {
  const { lock } = fixture();
  assert.equal(
    identitySha256(lock),
    identitySha256(Object.fromEntries(Object.entries(lock).reverse())),
  );
  const changed = clone(lock);
  changed.patches[0].sha256 = hash("changed");
  assert.notEqual(identitySha256(changed), identitySha256(lock));
  assert.notEqual(
    identitySha256(["first", "second"]),
    identitySha256(["second", "first"]),
  );
});

test("strict source pins and ABI reject branches, missing values, unsupported capabilities and extras", () => {
  for (const mutate of [
    (l) => (l.upstream.chromium.commit = "main"),
    (l) => (l.upstream.chromium.commit = hash("wrong revision").slice(0, 40)),
    (l) => (l.upstream.cef.commit = "0".repeat(40)),
    (l) => (l.upstream.depotTools.commit = "latest"),
    (l) => (l.upstream.cef.repository = "https://unreviewed.invalid/cef.git"),
    (l) => (l.bridge.symbol = "unreviewed_api"),
    (l) => (l.bridge.abiVersion = 1),
    (l) => (l.bridge.symbol = "cef_sorng_tls_get_api_v1"),
    (l) => (l.bridge.factorySymbol = "cef_sorng_tls_prepare_context_v1"),
    (l) => delete l.bridge.factorySymbol,
    (l) => (l.bridge.patchId = "sorng-tls-v1-test-fixture"),
    (l) => (l.bridge.patchId = "sorng-tls-v2-unreviewed"),
    (l) => l.bridge.capabilities.pop(),
    (l) => l.bridge.capabilities.push("ignore-certificate-errors"),
    (l) => (l.patches[0].path = "../escape.patch"),
    (l) => (l.patches[0].sha256 = null),
    (l) => l.patches.push(clone(l.patches[0])),
    (l) => (l.ready = true),
  ]) {
    const lock = clone(fixture().lock);
    mutate(lock);
    assert.throws(() => validateSourceLock(lock));
  }
  assert.equal(
    validateSourceLock(fixture().lock).bridge.symbol,
    "cef_sorng_tls_get_api_v2",
  );
});

test("packaging V2 identity matches the maintained native side ABI", async () => {
  const header = await readFile(
    new URL("../../native/cef-patches/cef_sorng_tls_bridge.h", import.meta.url),
    "utf8",
  );
  assert.match(header, /#define CEF_SORNG_TLS_ABI_V2 2u/);
  assert.match(header, new RegExp(`${BRIDGE_V2.symbol}\\(void\\)`));
  assert.match(header, new RegExp(`${BRIDGE_V2.factorySymbol}\\(`));
  for (const [bit, capability] of BRIDGE_V2.capabilities.entries()) {
    const define = capability.replaceAll("-", "_").toUpperCase();
    assert.ok(
      header.includes(`#define CEF_SORNG_TLS_CAP_${define} (1ull << ${bit})`),
    );
  }
  assert.equal(BRIDGE_V2.capabilities.length, 6);
  assert.doesNotMatch(header, /cef_sorng_tls_prepare_context_v[12]/);
});

test("six-target manifest requires distinct custom artifacts, exact identity and ABI inventory", () => {
  const { manifest, lock } = fixture();
  validateCustomRuntimeManifest(manifest, lock, { requireAllTargets: true });
  for (const mutate of [
    (m) => (m.kind = "official"),
    (m) => (m.sourceLockSha256 = hash("stale lock")),
    (m) => (m.artifacts[0].archive.path = "cef_binary_stock_minimal.tar.bz2"),
    (m) => (m.artifacts[0].archive.sha256 = "0".repeat(64)),
    (m) => (m.artifacts[0].archive.size = 0),
    (m) => (m.artifacts[0].runtime.sandboxCompat = "wrong"),
    (m) => (m.artifacts[0].runtime.cefApiVersion = 15300),
    (m) =>
      (m.artifacts[0].sdkFiles.find(
        (f) => f.path === lock.bridge.header.path,
      ).sha256 = hash("wrong ABI")),
    (m) => m.artifacts[0].sdkFiles.push(clone(m.artifacts[0].sdkFiles[0])),
    (m) => (m.artifacts[0].sdkFiles[0].path = "C:/outside"),
    (m) => (m.artifacts[0].sdkFiles[0].path = "include/CON"),
    (m) => m.artifacts.push(clone(m.artifacts[0])),
  ]) {
    const m = clone(manifest);
    mutate(m);
    assert.throws(() => validateCustomRuntimeManifest(m, lock));
  }
  const partial = clone(manifest);
  partial.artifacts.pop();
  validateCustomRuntimeManifest(partial, lock);
  assert.throws(
    () =>
      validateCustomRuntimeManifest(partial, lock, { requireAllTargets: true }),
    /All six/,
  );
});

test("upstream version derivation must exactly match before source build", async (t) => {
  const data = await diskFixture(t);
  const chromium = path.join(data.root, "source", "src");
  const directory = path.join(chromium, "cef", "tools");
  await mkdir(directory, { recursive: true });
  // Node stands in for Python in this subprocess contract test. No engine runs.
  await writeFile(
    path.join(directory, "cef_version.py"),
    'process.stdout.write("fixture-pinned-version\\n");',
  );
  await verifySourceCheckoutVersion(
    process.execPath,
    chromium,
    "fixture-pinned-version",
  );
  await assert.rejects(
    verifySourceCheckoutVersion(
      process.execPath,
      chromium,
      "fixture-other-version",
    ),
    /Upstream CEF version derivation differs.*metadata refs/,
  );
  const plan = sourceAcquisitionPlan(path.join(data.root, "other-source"));
  assert.deepEqual(
    plan.repositories.find((entry) => entry.name === "cef").versionReferences,
    UPSTREAM_CEF_VERSION_REFERENCES,
  );
  assert.equal(
    plan.repositories.find((entry) => entry.name === "cef").commit,
    UPSTREAM_CEF_COMMIT,
  );
});

test("source builds reject enclosing app modules but allow Chromium's own third-party modules", async (t) => {
  const data = await diskFixture(t);
  const chromium = path.join(data.root, "source", "src");
  await mkdir(path.join(chromium, "third_party", "node", "node_modules"), {
    recursive: true,
  });
  await verifySourceBuildIsolation(chromium);
  const enclosingModules = path.join(data.root, "node_modules");
  await mkdir(enclosingModules);
  await assert.rejects(
    verifySourceBuildIsolation(chromium),
    /Chromium source build would inherit.*node_modules.*dedicated source workspace/,
  );
  // Read-only rejection must never change a user's application dependencies.
  assert.ok((await stat(enclosingModules)).isDirectory());
});

for (const target of TARGETS)
  test(`preflight verifies supplied fixture bytes without claiming native capability: ${target}`, async (t) => {
    const data = await diskFixture(t, target);
    const result = await preflightCustomRuntime(data);
    assert.equal(result.filesVerified, 6);
    assert.equal(result.provenanceVerified, true);
    assert.equal(result.runtimeCapability, "not-probed");
    assert.equal(result.nativeAcceptance, "not-tested");
    assert.equal(result.productionReady, false);
    assert.match(result.cacheKey, /^custom\/[a-f0-9]{64}\//);
    assert.equal(result.bridge.patchId, data.lock.bridge.patchId);
  });

test("verified relative input paths stay anchored for subprocess working directories", async (t) => {
  const data = await diskFixture(t);
  const originalDirectory = process.cwd();
  try {
    process.chdir(data.root);
    const result = await preflightCustomRuntime({
      ...data,
      artifactRoot: "artifacts",
      sdkRoot: "sdk",
    });
    assert.equal(path.isAbsolute(result.archivePath), true);
    assert.equal(
      result.archivePath,
      path.join(data.artifactRoot, data.pkg.artifact.archive.path),
    );
    // git -C changes how relative patch paths resolve. All verified files use
    // this same path boundary, so a caller's relative root must not survive it.
    process.chdir(data.sdkRoot);
    assert.equal(
      await readFile(result.archivePath, "utf8"),
      "fixture archive, not compressed",
    );
  } finally {
    process.chdir(originalDirectory);
  }
});

test("missing artifact never falls back to stock; archive bytes and SDK extras reject", async (t) => {
  const data = await diskFixture(t);
  const missing = clone(data.manifest);
  missing.artifacts.shift();
  await assert.rejects(
    preflightCustomRuntime({ ...data, manifest: missing }),
    /no official fallback/,
  );
  await assert.rejects(
    preflightCustomRuntime({
      ...data,
      requiredCapabilities: ["tls-client-auth"],
    }),
    /Required capability absent/,
  );
  await writeFile(path.join(data.sdkRoot, "extra.dll"), "unlisted");
  await assert.rejects(preflightCustomRuntime(data), /inventory mismatch/);
  await rm(path.join(data.sdkRoot, "extra.dll"));
  await writeFile(
    path.join(data.artifactRoot, data.pkg.artifact.archive.path),
    "corrupt archive",
  );
  await assert.rejects(preflightCustomRuntime(data), /Digest\/size mismatch/);
});

test("receipt and SDK bytes are independently checked, not accepted on names", async (t) => {
  const data = await diskFixture(t);
  await writeFile(path.join(data.sdkRoot, "CREDITS.html"), "tampered");
  await assert.rejects(preflightCustomRuntime(data), /Digest\/size mismatch/);
  await writeFile(
    path.join(data.sdkRoot, "CREDITS.html"),
    data.pkg.sdkFiles["CREDITS.html"],
  );
  const receipt = { ...data.pkg.receipt, archiveSha256: hash("other archive") };
  data.pkg.artifact.provenance = pin(
    data.pkg.artifact.provenance.path,
    json(receipt),
  );
  await writeFile(
    path.join(data.artifactRoot, data.pkg.artifact.provenance.path),
    json(receipt),
  );
  await assert.rejects(preflightCustomRuntime(data), /does not bind/);
});

test("SDK version metadata cannot relabel a different CEF revision", async (t) => {
  const data = await diskFixture(t);
  const bytes = data.pkg.sdkFiles["include/cef_version.h"].replace(
    UPSTREAM_CEF_COMMIT,
    hash("other").slice(0, 40),
  );
  await writeFile(path.join(data.sdkRoot, "include/cef_version.h"), bytes);
  Object.assign(
    data.pkg.artifact.sdkFiles.find((f) => f.path === "include/cef_version.h"),
    pin("include/cef_version.h", bytes),
  );
  data.pkg.receipt.sdkInventorySha256 = identitySha256(
    data.pkg.artifact.sdkFiles,
  );
  data.pkg.artifact.provenance = pin(
    data.pkg.artifact.provenance.path,
    json(data.pkg.receipt),
  );
  await writeFile(
    path.join(data.artifactRoot, data.pkg.artifact.provenance.path),
    json(data.pkg.receipt),
  );
  await assert.rejects(preflightCustomRuntime(data), /version header mismatch/);
});

test("external SDK directory junctions cannot escape", async (t) => {
  const data = await diskFixture(t);
  await mkdir(path.join(data.root, "outside"));
  await writeFile(path.join(data.root, "outside", "untrusted"), "outside");
  try {
    await symlink(
      path.join(data.root, "outside"),
      path.join(data.sdkRoot, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  await assert.rejects(preflightCustomRuntime(data), /inventory mismatch/);
  const manifest = clone(data.manifest);
  manifest.artifacts[0].sdkFiles.push({
    path: "escape",
    type: "symlink",
    target: "../outside",
  });
  assert.throws(
    () => validateCustomRuntimeManifest(manifest, data.lock),
    /Unsafe relative path/,
  );
});

test("relative framework-style leaf symlinks retain their exact target text", async (t) => {
  const data = await diskFixture(t);
  const name = "bridge-header-link",
    destination = "include/cef_sorng_tls_bridge.h";
  try {
    await symlink(destination, path.join(data.sdkRoot, name), "file");
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink privilege unavailable");
    throw error;
  }
  data.pkg.artifact.sdkFiles.push({
    path: name,
    type: "symlink",
    target: destination,
  });
  data.pkg.receipt.sdkInventorySha256 = identitySha256(
    data.pkg.artifact.sdkFiles,
  );
  data.pkg.artifact.provenance = pin(
    data.pkg.artifact.provenance.path,
    json(data.pkg.receipt),
  );
  await writeFile(
    path.join(data.artifactRoot, data.pkg.artifact.provenance.path),
    json(data.pkg.receipt),
  );
  assert.equal((await preflightCustomRuntime(data)).filesVerified, 7);
});

for (const target of TARGETS)
  test(`pinned source recipe preserves sandbox/platform contract: ${target}`, async (t) => {
    const data = await diskFixture(t, target);
    const checkouts = sourceAcquisitionPlan(
      path.join(data.root, "source"),
    ).checkouts;
    const plan = await customRuntimeBuildRecipe({ ...data, checkouts });
    assert.equal(plan.executed, false);
    assert.equal(plan.productionReady, false);
    assert.equal(plan.environment.DEPOT_TOOLS_UPDATE, "0");
    const args = plan.commands[1].args;
    assert.ok(args.includes("cef"));
    if (target.includes("windows")) {
      assert.ok(args.includes("bootstrap"));
      assert.ok(args.includes("bootstrapc"));
    }
    if (target.includes("linux")) assert.ok(args.includes("chrome_sandbox"));
    if (target.includes("apple")) assert.ok(args.includes("cef_sandbox"));
    assert.ok(!JSON.stringify(plan).includes("--no-sandbox"));
  });

test("GN content/hash and toolchain inventory are mandatory before any build", async (t) => {
  const data = await diskFixture(t);
  const checkouts = sourceAcquisitionPlan(
    path.join(data.root, "source"),
  ).checkouts;
  const build = data.lock.builds[0];
  for (const bad of [
    gnArgs(data.target) + " enable_sandbox=false",
    gnArgs(data.target) + ' target_cpu="arm64"',
    'import("malicious.gni")',
  ]) {
    await writeFile(path.join(data.inputsRoot, build.gnArgs.path), bad);
    build.gnArgs.sha256 = hash(bad);
    await assert.rejects(
      customRuntimeBuildRecipe({ ...data, checkouts }),
      /Sandbox|GN argument/,
    );
  }
  const report = await verifyToolchainFiles({
    ...data,
    python: path.join(data.toolsRoot, "python-fixture"),
  });
  assert.equal(report.filesVerified, 1);
  await writeFile(
    path.join(data.toolsRoot, "python-fixture"),
    "different executable",
  );
  await assert.rejects(
    verifyToolchainFiles({
      ...data,
      python: path.join(data.toolsRoot, "python-fixture"),
    }),
    /Digest\/size/,
  );
});

test("source plan pins all upstream revisions and Siso; no acquisition is executed", () => {
  const plan = sourceAcquisitionPlan(path.resolve(".artifacts/cef-src"));
  assert.equal(plan.executed, false);
  assert.equal(plan.repositories.length, 3);
  assert.equal(plan.sourcePins.chromium, UPSTREAM_CHROMIUM_COMMIT);
  assert.match(
    plan.gclient.solutions[0].custom_vars.siso_version,
    /^git_revision:[a-f0-9]{40}$/,
  );
  assert.ok(plan.gclient.syncArgs.includes(`src@${UPSTREAM_CHROMIUM_COMMIT}`));
  assert.throws(() => sourceAcquisitionPlan(path.parse(process.cwd()).root));
});

test("source preflight rejects partial non-Git fixtures before applying anything", async (t) => {
  const data = await diskFixture(t);
  const checkouts = {
    cef: data.sdkRoot,
    chromium: data.artifactRoot,
    depotTools: data.toolsRoot,
  };
  await assert.rejects(
    preflightSourceCheckout({ ...data, checkouts }),
    /git|repository|checkout/i,
  );
  assert.equal(
    await readFile(path.join(data.sdkRoot, "CREDITS.html"), "utf8"),
    "fixture credits",
  );
});

test("Windows prerequisite assessment reports current missing SDK/compiler/debuggers honestly", () => {
  const report = assessWindowsEnginePrerequisites({
    visualStudioVersions: ["17.14.37111.16"],
    sdkVersions: ["10.0.26100.0"],
    nativePython: true,
  });
  assert.equal(report.ok, false);
  assert.equal(report.blockers.length, 3);
  const provisioned = assessWindowsEnginePrerequisites({
    visualStudioVersions: ["18.0.1"],
    sdkVersions: ["10.0.28000.0"],
    debuggerVersion: "10.0.26100.3323",
    nativePython: true,
  });
  assert.equal(provisioned.ok, true);
  assert.equal(provisioned.actualCompile, "not-tested");
});

test("CLI rejects ambiguous options and defaults to help without effects", async () => {
  assert.equal(parseArguments(["preflight", "--lock=x.json"]).lock, "x.json");
  for (const argv of [
    ["latest"],
    ["build", "--force"],
    ["build", "--execute=true"],
    ["build", "--lock"],
    ["build", "--lock=a", "--lock=b"],
  ])
    assert.throws(() => parseArguments(argv));
  assert.match(await main([]), /no stock fallback/);
  await assert.rejects(main(["build"]), /--lock is required/);
  await assert.rejects(
    main(["acquire", "--root=.artifacts/unused"]),
    /requires --execute/,
  );
});

test("source acquisition refuses an existing directory before Git/network effects", async (t) => {
  const data = await diskFixture(t);
  await assert.rejects(acquireSources(data.root), /EEXIST/);
  assert.equal(
    await readFile(path.join(data.sdkRoot, "CREDITS.html"), "utf8"),
    "fixture credits",
  );
});

test("normal app driver rejects incomplete/unknown custom selection without official fallback", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-custom-arguments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Incomplete input remains incomplete regardless of the developer's real registration.
  const selectionFile = path.join(root, "cef-local-selection.json");
  for (const env of [
    { SORNG_CEF_CUSTOM_MANIFEST: "custom.json" },
    { SORNG_CEF_SOURCE_LOCK: "lock.json" },
    { SORNG_CEF_RUNTIME_KIND: "custom" },
    { SORNG_CEF_RUNTIME_KIND: "unknown" },
  ])
    assert.throws(
      () => parseAppArguments(["build"], env, { selectionFile }),
      /no official fallback/,
    );
  await assert.rejects(stat(selectionFile), { code: "ENOENT" });
});

// Structural binaries exercise the real file inspectors without loading code.
// They are not runnable engines and can never serve as native acceptance.
function nativeFixture(target, symbols = [], library = false) {
  const bytes = Buffer.alloc(2048);
  const arm = target.startsWith("aarch64");
  if (target.includes("windows")) {
    bytes.write("MZ");
    bytes.writeUInt32LE(128, 60);
    bytes.writeUInt32LE(0x4550, 128);
    bytes.writeUInt16LE(arm ? 0xaa64 : 0x8664, 132);
    bytes.writeUInt16LE(1, 134);
    bytes.writeUInt16LE(240, 148);
    bytes.writeUInt16LE(0x2000, 150);
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
    symbols.forEach((symbol, i) => {
      bytes.writeUInt32LE(1800 + i, 560 + i * 4);
      bytes.writeUInt32LE(800 + i * 128, 600 + i * 4);
      bytes.writeUInt16LE(i, 640 + i * 2);
      bytes.write(symbol, 800 + i * 128);
    });
  } else if (target.includes("linux")) {
    bytes.writeUInt32LE(0x464c457f);
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(3, 16);
    bytes.writeUInt16LE(arm ? 183 : 62, 18);
    bytes.writeBigUInt64LE(128n, 40);
    bytes.writeUInt16LE(64, 58);
    bytes.writeUInt16LE(3, 60);
    bytes.writeUInt32LE(11, 196);
    bytes.writeBigUInt64LE(512n, 216);
    bytes.writeBigUInt64LE(BigInt(symbols.length * 24), 224);
    bytes.writeUInt32LE(2, 232);
    bytes.writeBigUInt64LE(24n, 248);
    bytes.writeUInt32LE(3, 260);
    bytes.writeBigUInt64LE(800n, 280);
    bytes.writeBigUInt64LE(512n, 288);
    symbols.forEach((symbol, i) => {
      const entry = 512 + i * 24;
      bytes.writeUInt32LE(i * 128, entry);
      bytes[entry + 4] = 0x12;
      bytes.writeUInt16LE(1, entry + 6);
      bytes.writeBigUInt64LE(1800n, entry + 8);
      bytes.write(symbol, 800 + i * 128);
    });
  } else {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(arm ? 0x100000c : 0x1000007, 4);
    bytes.writeUInt32LE(library ? 6 : 2, 12);
    bytes.writeUInt32LE(2, 16);
    bytes.writeUInt32LE(48, 20);
    bytes.writeUInt32LE(0x32, 32);
    bytes.writeUInt32LE(24, 36);
    bytes.writeUInt32LE(1, 40);
    bytes.writeUInt32LE(0xe0000, 44);
    bytes.writeUInt32LE(2, 56);
    bytes.writeUInt32LE(24, 60);
    bytes.writeUInt32LE(512, 64);
    bytes.writeUInt32LE(symbols.length, 68);
    bytes.writeUInt32LE(800, 72);
    bytes.writeUInt32LE(512, 76);
    symbols.forEach((symbol, i) => {
      const entry = 512 + i * 16;
      bytes.writeUInt32LE(i * 128, entry);
      bytes[entry + 4] = 0xf;
      bytes[entry + 5] = 1;
      bytes.writeBigUInt64LE(1800n, entry + 8);
      bytes.write(`_${symbol}`, 800 + i * 128);
    });
  }
  return bytes;
}

async function stagingFixture(
  t,
  target,
  { flat = false, symbols = [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol] } = {},
) {
  const data = await diskFixture(t, target);
  const layout = packageManifest(target, "fixture.app");
  const sdkFiles = data.pkg.sdkFiles;
  sdkFiles["include/cef_version.h"] += CEF_PIN.chromium
    .split(".")
    .map(
      (value, index) =>
        `#define CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]} ${value}\n`,
    )
    .join("");
  // Keep a conventional distribution layout, or exercise an already-flat SDK.
  for (const name of [...layout.runtimeFiles, layout.defaultLocale])
    sdkFiles[`Release/${name}`] ??= `fixture ${name}`;
  sdkFiles[data.pkg.artifact.runtime.library] = nativeFixture(
    target,
    symbols,
    true,
  );
  if (layout.platform === "macos") {
    // Windows test hosts can represent the framework's resolved layout without
    // needing symlink privileges. Link preservation has a separate Unix test.
    sdkFiles[
      `Release/Chromium Embedded Framework.framework/Chromium Embedded Framework`
    ] = sdkFiles[data.pkg.artifact.runtime.library];
    sdkFiles[
      "Release/Chromium Embedded Framework.framework/Libraries/libcef_sandbox.dylib"
    ] = sdkFiles[data.pkg.artifact.runtime.sandbox];
    sdkFiles[
      "Release/Chromium Embedded Framework.framework/Resources/en.lproj/locale_FEMININE.pak"
    ] = "extra locale bytes";
  } else sdkFiles["Resources/locales/pt-PT.pak"] = "extra locale bytes";
  Object.assign(sdkFiles, {
    "LICENSE.txt": "fixture license",
    "CMakeLists.txt": "fixture cmake",
    "cmake/cef_variables.cmake": "fixture wrapper settings",
    "libcef_dll/CMakeLists.txt": "fixture wrapper",
    "include/cef_api_versions.h": `#define CEF_API_VERSION_LAST CEF_API_VERSION_15400\n#if defined(${{ windows: "OS_WIN", linux: "OS_LINUX", macos: "OS_MAC" }[layout.platform]})\n#define CEF_API_HASH_15400 "${data.pkg.artifact.runtime.cefApiHash}"\n#endif\n`,
    ...(layout.platform === "windows"
      ? { "Release/libcef.lib": "fixture import library" }
      : {}),
    ...(layout.platform === "linux"
      ? { "Release/libminigbm.so": "fixture optional runtime" }
      : {}),
  });
  if (flat) {
    for (const [name, bytes] of Object.entries(sdkFiles))
      if (/^(Release|Resources)\//.test(name)) {
        delete sdkFiles[name];
        sdkFiles[name.replace(/^(Release|Resources)\//, "")] = bytes;
      }
    data.pkg.artifact.runtime.library =
      data.pkg.artifact.runtime.library.replace(/^Release\//, "");
    data.pkg.artifact.runtime.sandbox =
      data.pkg.artifact.runtime.sandbox.replace(/^Release\//, "");
  }
  // Use a new fixture SDK rather than replacing any prior disk tree.
  data.sdkRoot = path.join(data.root, "complete-sdk");
  await writeTree(data.sdkRoot, sdkFiles);
  if (process.platform !== "win32")
    for (const entry of layout.executableFiles)
      await chmod(
        path.join(data.sdkRoot, flat ? entry : `Release/${entry}`),
        0o755,
      );
  if (process.platform !== "win32" && layout.platform === "macos")
    await chmod(
      path.join(data.sdkRoot, data.pkg.artifact.runtime.library),
      0o755,
    );
  data.pkg.artifact.sdkFiles = Object.entries(sdkFiles).map(
    ([name, bytes]) => ({ ...pin(name, bytes), type: "file" }),
  );
  data.pkg.receipt.sdkInventorySha256 = identitySha256(
    data.pkg.artifact.sdkFiles,
  );
  data.pkg.artifact.provenance = pin(
    data.pkg.artifact.provenance.path,
    json(data.pkg.receipt),
  );
  await writeFile(
    path.join(data.artifactRoot, data.pkg.artifact.provenance.path),
    json(data.pkg.receipt),
  );
  const application = path.join(data.root, "compiled-app"),
    helper = path.join(data.root, "compiled-helper");
  const appBytes = nativeFixture(
    target,
    layout.platform === "windows" ? ["RunWinMain"] : [],
  );
  if (layout.platform === "windows")
    appBytes.write("__TAURI_BUNDLE_TYPE_VAR_UNK", 1600);
  await writeFile(application, appBytes);
  await writeFile(helper, nativeFixture(target));
  const appPlist = path.join(data.root, "Info.plist");
  await writeFile(
    appPlist,
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture.app</string><key>CFBundleIdentifier</key><string>com.example.fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>14.0</string></dict></plist>`,
  );
  return {
    ...data,
    python: process.platform === "win32" ? "python" : "python3",
    layout,
    application,
    helper,
    appPlist,
  };
}

for (const target of TARGETS)
  test(`normal custom app staging copies verified files and helpers: ${target}`, async (t) => {
    const data = await stagingFixture(t, target, {
      flat: target.startsWith("aarch64"),
    });
    const manifestFile = path.join(data.root, "manifest.json"),
      lockFile = path.join(data.root, "source-lock.json");
    await writeFile(manifestFile, json(data.manifest));
    await writeFile(lockFile, json(data.sourceLock));
    const options = parseAppArguments(
      [
        "build",
        "--target",
        target,
        "--cef-custom-manifest",
        manifestFile,
        "--cef-source-lock",
        lockFile,
        "--cef-sdk",
        data.sdkRoot,
        "--cef-artifact-root",
        data.artifactRoot,
      ],
      {},
      { selectionFile: path.join(data.root, "cef-local-selection.json") },
    );
    assert.equal(options.localRuntimeSelection, undefined);
    const loaded = await loadCustomRuntimeInputs(options);
    assert.equal(
      loaded.preflight.archivePath,
      path.join(data.artifactRoot, data.pkg.artifact.archive.path),
    );
    assert.equal(options.download, false);
    const prepared = await prepareCustomRuntime({
      ...loaded.inputs,
      output: path.join(data.root, "prepared-sdk"),
    });
    const plan = {
      ...prepared,
      root: data.root,
      target,
      platform: data.layout.platform,
      appName: "fixture.app",
      payload: path.join(data.root, "payload"),
    };
    const report = await stageApplicationPackage(plan, {
      ...data,
      output: plan.payload,
    });
    assert.equal(report.ok, true);
    assert.equal(report.productionReady, false);
    assert.equal(report.runtimeCapability, "not-probed");
    assert.equal(report.preflight.bridge.patchId, BRIDGE_PATCH_ID);
    assert.equal(
      report.preflight.archiveSdkRelationship,
      "reviewed-manifest-bound-not-extraction-tested",
    );
    assert.match(
      JSON.parse(await readFile(path.join(prepared.sdk, "archive.json"))).name,
      /_sorng-custom-/,
    );
    assert.equal(
      (await inspectBundle(plan.payload, prepared.sdk, target, plan.appName))
        .ok,
      true,
    );
    for (const name of data.layout.applicationFiles)
      assert.ok((await stat(path.join(plan.payload, name))).size > 0);
    const license =
      data.layout.platform === "macos"
        ? "Contents/Resources/cef-LICENSE.txt"
        : "cef-LICENSE.txt";
    assert.equal(
      await readFile(path.join(plan.payload, license), "utf8"),
      "fixture license",
    );
    const config = bundleConfiguration(
      { build: {}, bundle: { resources: { "user-locales": "locales/" } } },
      plan,
      [...data.layout.applicationFiles, license],
    );
    assert.equal(config.bundle.resources["user-locales"], "locales/");
    if (data.layout.platform === "macos") {
      assert.equal(Object.keys(config.bundle.macOS.files).length, 5);
      for (const file of data.layout.applicationFiles.filter(
        (name) =>
          name.startsWith("Contents/Frameworks/") &&
          name.endsWith("/Info.plist"),
      )) {
        const plist = await readFile(path.join(plan.payload, file), "utf8");
        assert.match(
          plist,
          /<key>NSCameraUsageDescription<\/key><string>[^<]+approve a camera request\./,
        );
        assert.match(
          plist,
          /<key>NSMicrophoneUsageDescription<\/key><string>[^<]+approve a microphone request\./,
        );
      }
    }
    if (data.layout.platform === "windows") {
      const installers = await prepareWindowsInstallerBundles({
        plan,
        bundleConfig: config,
      });
      assert.equal(installers.installers.length, 2);
      assert.equal(
        installers.bootstrap.sha256,
        hash(await readFile(path.join(prepared.sdk, "bootstrap.exe"))),
      );
      assert.equal(installers.bootstrap.modified, false);
      for (const installer of installers.installers)
        assert.notEqual(installer.clientSha256, installers.sourceClient.sha256);
    }
    // Watch rebuilds stage another retained payload from the same SDK.
    const second = await stageApplicationPackage(plan, {
      ...data,
      output: path.join(data.root, "watch-payload"),
    });
    assert.equal(second.ok, true);
    await assert.rejects(
      stageApplicationPackage(plan, { ...data, output: plan.payload }),
      { code: "EEXIST" },
    );
    const changed = path.join(prepared.sdk, data.layout.runtimeFiles[0]);
    await writeFile(changed, "modified runtime bytes");
    await assert.rejects(
      stageApplicationPackage(plan, {
        ...data,
        output: path.join(data.root, "must-not-stage"),
      }),
      /Digest\/size mismatch/,
    );
    await assert.rejects(stat(path.join(data.root, "must-not-stage")), {
      code: "ENOENT",
    });
  });

test("custom V2 export validation rejects stock/missing factory, wrong architecture and forged strings for every target", async (t) => {
  for (const target of TARGETS) {
    const data = await stagingFixture(t, target, {
      symbols: [BRIDGE_V2.symbol],
    });
    const file = path.join(data.sdkRoot, data.pkg.artifact.runtime.library);
    await assert.rejects(
      prepareCustomRuntime({
        ...data,
        output: path.join(data.root, "missing-factory"),
      }),
      /missing defined V2 export/,
    );
    await assert.rejects(stat(path.join(data.root, "missing-factory")), {
      code: "ENOENT",
    });
    const fake = nativeFixture(target, [], true);
    fake.write(`${BRIDGE_V2.symbol}\0${BRIDGE_V2.factorySymbol}`, 1400);
    await writeFile(file, fake);
    await assert.rejects(
      inspectCustomRuntimeExports(file, target),
      /missing defined V2 export/,
    );
    const other = target.replace(
      /^x86_64|^aarch64/,
      target.startsWith("aarch64") ? "x86_64" : "aarch64",
    );
    await writeFile(
      file,
      nativeFixture(other, [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol], true),
    );
    await assert.rejects(
      inspectCustomRuntimeExports(file, target),
      /architecture/,
    );
  }
});

test("custom preparation/staging rejects damaged provenance, SDK, and helper without stock fallback", async (t) => {
  const data = await stagingFixture(t, "x86_64-unknown-linux-gnu");
  const prepared = await prepareCustomRuntime({
    ...data,
    output: path.join(data.root, "prepared-sdk"),
  });
  const plan = { ...prepared, target: data.target, appName: "fixture.app" };
  await writeFile(data.helper, "invalid helper");
  const output = path.join(data.root, "bad-helper");
  await assert.rejects(
    stageApplicationPackage(plan, { ...data, output }),
    /Native binary/,
  );
  await assert.rejects(stat(output), { code: "ENOENT" });
  await writeFile(
    path.join(data.artifactRoot, data.pkg.artifact.archive.path),
    "tampered archive",
  );
  await assert.rejects(
    verifyPreparedCustomRuntime(plan),
    /Digest\/size mismatch/,
  );
});

test("custom Cargo environment blocks inherited stock download and SDK substitution while preserving normal build inputs", () => {
  const original = {
    FLATPAK: "1",
    NIX_CEF_BINARY: "stock",
    CEF_DOWNLOAD_URL: "https://stock.invalid",
    CEF_PATH: "verified-sdk",
    CARGO_TARGET_DIR: "compile",
    HTTPS_PROXY: "configured-proxy",
  };
  const env = customRuntimeEnvironment(original);
  assert.equal(env.FLATPAK, undefined);
  assert.equal(env.NIX_CEF_BINARY, undefined);
  assert.equal(env.CEF_DOWNLOAD_URL, "sorng-custom-no-download://blocked");
  assert.equal(env.CEF_PATH, original.CEF_PATH);
  assert.equal(env.CARGO_TARGET_DIR, original.CARGO_TARGET_DIR);
  assert.equal(env.HTTPS_PROXY, original.HTTPS_PROXY);
  assert.equal(original.FLATPAK, "1");
  const mixedCase = customRuntimeEnvironment({
    flatpak: "1",
    Nix_Cef_Binary: "stock",
    cef_download_url: "https://stock.invalid",
  });
  assert.deepEqual(mixedCase, {
    CEF_DOWNLOAD_URL: "sorng-custom-no-download://blocked",
  });
});

test("custom SDK preparation rejects incompatible build metadata and normalized collisions before writing output", async (t) => {
  for (const [name, mutate, expected] of [
    [
      "api-version",
      (files) => {
        files["include/cef_api_versions.h"] = files[
          "include/cef_api_versions.h"
        ].replace("LAST CEF_API_VERSION_15400", "LAST CEF_API_VERSION_15300");
      },
      /API selection/,
    ],
    [
      "api-hash",
      (files) => {
        files["include/cef_api_versions.h"] = files[
          "include/cef_api_versions.h"
        ].replace(/"[a-f0-9]{40}"/, `"${"a".repeat(40)}"`);
      },
      /API hash/,
    ],
    [
      "chromium",
      (files) => {
        files["include/cef_version.h"] = files["include/cef_version.h"].replace(
          "CHROME_VERSION_MAJOR 154",
          "CHROME_VERSION_MAJOR 153",
        );
      },
      /Chromium version/,
    ],
    [
      "collision",
      (files) => {
        files["libcef.dll"] = "second runtime";
      },
      /duplicate\/case-colliding/,
    ],
    [
      "version-fallback",
      (files) => {
        files[`${CEF_PIN.bindings.split("+")[1]}/windows_x86_64/libcef.dll`] =
          "unwanted fallback";
      },
      /fallback version/,
    ],
  ]) {
    const data = await stagingFixture(t, "x86_64-pc-windows-msvc");
    mutate(data.pkg.sdkFiles);
    for (const [file, bytes] of Object.entries(data.pkg.sdkFiles)) {
      await mkdir(path.dirname(path.join(data.sdkRoot, file)), {
        recursive: true,
      });
      await writeFile(path.join(data.sdkRoot, file), bytes);
    }
    data.pkg.artifact.sdkFiles = Object.entries(data.pkg.sdkFiles).map(
      ([file, bytes]) => ({ ...pin(file, bytes), type: "file" }),
    );
    data.pkg.receipt.sdkInventorySha256 = identitySha256(
      data.pkg.artifact.sdkFiles,
    );
    data.pkg.artifact.provenance = pin(
      data.pkg.artifact.provenance.path,
      json(data.pkg.receipt),
    );
    await writeFile(
      path.join(data.artifactRoot, data.pkg.artifact.provenance.path),
      json(data.pkg.receipt),
    );
    const output = path.join(data.root, name);
    await assert.rejects(prepareCustomRuntime({ ...data, output }), expected);
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
});

test("custom export checks reject forwarded, undefined and malformed symbol entries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custom-cef-exports-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const target of TARGETS) {
    const file = path.join(root, target);
    const bytes = nativeFixture(
      target,
      [BRIDGE_V2.symbol, BRIDGE_V2.factorySymbol],
      true,
    );
    if (target.includes("windows"))
      bytes.writeUInt32LE(700, 564); // PE forwarder, not local function
    else if (target.includes("linux"))
      bytes.writeUInt16LE(0, 542); // SHN_UNDEF
    else bytes[532] = 1; // N_UNDF | N_EXT
    await writeFile(file, bytes);
    await assert.rejects(
      inspectCustomRuntimeExports(file, target),
      /missing defined V2 export/,
    );
    await writeFile(file, bytes.subarray(0, 48));
    await assert.rejects(inspectCustomRuntimeExports(file, target));
  }
});

test(
  "custom SDK and payload preserve an internal macOS version link",
  {
    skip:
      process.platform === "win32"
        ? "file symlink creation requires Windows privilege"
        : false,
  },
  async (t) => {
    const data = await stagingFixture(t, "aarch64-apple-darwin");
    const name =
      "Release/Chromium Embedded Framework.framework/Chromium Embedded Framework";
    const link = "Versions/A/Chromium Embedded Framework";
    await rm(path.join(data.sdkRoot, name));
    await symlink(link, path.join(data.sdkRoot, name));
    data.pkg.artifact.sdkFiles = data.pkg.artifact.sdkFiles.map((entry) =>
      entry.path === name
        ? { path: name, type: "symlink", target: link }
        : entry,
    );
    data.pkg.receipt.sdkInventorySha256 = identitySha256(
      data.pkg.artifact.sdkFiles,
    );
    data.pkg.artifact.provenance = pin(
      data.pkg.artifact.provenance.path,
      json(data.pkg.receipt),
    );
    await writeFile(
      path.join(data.artifactRoot, data.pkg.artifact.provenance.path),
      json(data.pkg.receipt),
    );
    const prepared = await prepareCustomRuntime({
      ...data,
      output: path.join(data.root, "prepared-sdk"),
    });
    const plan = { ...prepared, target: data.target, appName: "fixture.app" };
    const output = path.join(data.root, "payload");
    await stageApplicationPackage(plan, { ...data, output });
    assert.equal(await readlink(path.join(prepared.sdk, name.slice(8))), link);
    assert.equal(
      await readlink(path.join(output, "Contents/Frameworks", name.slice(8))),
      link,
    );
  },
);
