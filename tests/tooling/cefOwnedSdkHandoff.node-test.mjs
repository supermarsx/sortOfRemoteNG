import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  realpath,
  rm,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  LINUX_INCREMENTAL_ORIGIN,
  LINUX_ISOLATED_ORIGIN,
  LINUX_EXTERNAL_WEBVIEW_ORIGIN,
  LINUX_EXTERNAL_WEBVIEW_IDENTITY,
  LINUX_EXTERNAL_WEBVIEW_INPUT_RAW,
  LINUX_EXTERNAL_WEBVIEW_TRANSITION,
  LINUX_ISOLATED_OPERATION_ROOT,
  LINUX_ISOLATED_IDENTITY,
  LINUX_ISOLATED_INPUT_RAW,
  LINUX_ISOLATED_TRANSITION,
  LINUX_ISOLATED_EVIDENCE,
  LINUX_ISOLATED_LIMITS,
  LINUX_ISOLATED_COPY_TREES,
  LINUX_ISOLATED_INIT_ROOTS,
  LINUX_ISOLATED_FACT_KEYS,
  validateLinuxIsolatedProvenance,
  linuxIsolatedInitCode,
  LINUX_INCREMENTAL_IDENTITY,
  LINUX_INCREMENTAL_EVIDENCE,
  LINUX_INCREMENTAL_TOOL_PINS,
  LINUX_INCREMENTAL_SOURCE_PATHS,
  LINUX_INCREMENTAL_FACT_KEYS,
  ownedSdkHandoffPlan,
  verifyOwnedHandoffEvidence,
  checkOwnedSdkHandoff,
  ownedHandoffReviewBinding,
  WINDOWS_CAPSULE_ORIGIN,
  WINDOWS_OPERATION2_ORIGIN,
  WINDOWS_OPERATION2_EVIDENCE,
  WINDOWS_OPERATION2_CLANG,
  WINDOWS_CAPSULE_IDENTITY,
  WINDOWS_CAPSULE_EVIDENCE,
  WINDOWS_CAPSULE_SOURCE_PINS,
  WINDOWS_CAPSULE_TOOL_PINS,
  WINDOWS_CAPSULE_MACROS,
  WINDOWS_CAPSULE_PROFILES,
} from "../../scripts/lib/cef-owned-sdk-handoff.mjs";
import {
  identitySha256,
  BRIDGE_V2,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { CEF_PIN } from "../../scripts/browser-runtime-package.mjs";
import {
  flattenSdk,
  descriptorFor,
  stableJson,
  releaseIdentity,
  PACK_PYTHON,
} from "../../scripts/cef-runtime-ci.mjs";
import { inventoryCustomArtifact } from "../../scripts/cef-custom-artifact-inventory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)),
  exec = promisify(execFile),
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pin = (name, bytes) => ({
  path: name,
  size: bytes.length,
  sha256: hash(bytes),
});
const operation = "ec3c685e-8319-493d-b685-ef04843a0ebd",
  source = "a".repeat(40),
  controller = "b".repeat(40),
  digest = "c".repeat(64),
  image = "sha256:" + "d".repeat(64);
const linuxLockBytes = await readFile(
    path.join(
      root,
      "native/cef-build-inputs/20261024-registration-retirement-owned-linux-x64/source-lock.json",
    ),
  ),
  linuxLock = JSON.parse(linuxLockBytes);
function review(origin = "existing-windows-package") {
  const names =
    origin === "owned-linux-engine"
      ? [
          "prepared",
          "started",
          "container",
          "finished",
          "producer",
          "freshCheck",
        ]
      : ["build"];
  return {
    schemaVersion: 1,
    kind: "sorng-cef-owned-sdk-review",
    origin,
    target:
      origin === "owned-linux-engine"
        ? "x86_64-unknown-linux-gnu"
        : "x86_64-pc-windows-msvc",
    sourceLockIdentity:
      origin === "owned-linux-engine" ? identitySha256(linuxLock) : digest,
    descriptorSha256: digest,
    python: {
      path: path.resolve(root, "fixture-python"),
      size: 1,
      sha256: digest,
    },
    evidence: Object.fromEntries(
      names.map((name) => [
        name,
        { path: name + ".json", size: 1, sha256: digest },
      ]),
    ),
  };
}
function linuxRecords() {
  return {
    prepared: {
      plan: { operation, sourceCommit: source, image },
      sourceArchiveSha256: digest,
      planSha256: digest,
      sourceInventorySha256: digest,
      extraction: {
        rootOwned: true,
        sourceCommit: source,
        sourceArchiveSha256: digest,
        sourceInventorySha256: digest,
      },
      sealed: { sealed: true, planSha256: digest },
      tools: {
        filesVerified: 10,
        toolsRoot: "/work/tools",
        engineBuildAttempted: false,
        pythonStdlibDependency: "same immutable image /usr/lib/python3.12",
      },
    },
    freshCheck: {
      engineBuildAttempted: false,
      publicationAllowed: false,
      result: {
        plan: {
          operation,
          sourceCommit: source,
          imageId: image,
          sourceArchiveSha256: digest,
          sourceInventorySha256: digest,
          sourceLockSha256: hash(linuxLockBytes),
          target: "x86_64-unknown-linux-gnu",
          runnerMode: "dedicated",
          repository: "supermarsx/sortOfRemoteNG",
          provenance: "owned-local-container",
          productionReady: false,
          nativeAcceptance: "not-tested",
          publicationAllowed: false,
          paths: {
            checkout: "/opt/producer/checkout",
            archive: "/opt/producer/source.tar",
            inventory: "/opt/producer/source-inventory.json",
            tools: "/work/tools",
            temporary: "/work/build",
            scratch: "/work/tmp",
          },
        },
        sourceLock: linuxLock,
        confinement: "actual-kernel-validated",
        imageIdentityAuthority:
          "parent Docker inspect; not introspectable in child",
        productionReady: false,
        home: {
          uid: 10001,
          gid: 10001,
          mode: 0o700,
          privateCacheWriteVerified: true,
          cacheProbeRemoved: true,
          mountAndAliasVerified: true,
        },
      },
    },
    started: {
      operation,
      sourceCommit: source,
      image,
      sourceArchiveSha256: digest,
      planSha256: digest,
      controllerCommit: controller,
      replayAllowed: false,
    },
    container: {
      id: "e".repeat(64),
      name: `/sorng-cef-owned-engine-${operation}`,
      sourceCommit: source,
      controllerCommit: controller,
      image,
      networkMode: "bridge",
      user: "10001:10001",
      readonlyRoot: true,
      memory: 24 * 1024 ** 3,
      memorySwap: 24 * 1024 ** 3,
      nanoCpus: 8e9,
      pids: 512,
    },
    finished: {
      reason: "completed",
      result: { exitCode: 0 },
      sourceCommit: source,
      controllerCommit: controller,
      provenance: "owned-local-container",
      productionReady: false,
      nativeAcceptance: "not-tested",
      publicationAllowed: false,
    },
    producer: {
      state: "completed",
      operation,
      sourceCommit: source,
      imageIdReviewedExpectation: image,
      parentImageVerificationRequired: true,
      provenance: "owned-local-container",
      productionReady: false,
      nativeAcceptance: "not-tested",
      publicationAllowed: false,
      result: {
        target: "x86_64-unknown-linux-gnu",
        descriptorSha256: digest,
        nativeAcceptance: "not-tested",
        productionReady: false,
      },
    },
  };
}
test("review plan is closed, native x64/R4 only in verification, and never grants hosted/native/upload authority", () => {
  for (const origin of ["existing-windows-package", "owned-linux-engine"]) {
    const valid = review(origin),
      planned = ownedSdkHandoffPlan(valid);
    for (const field of [
      "productionReady",
      "hostedBuild",
      "publicationAllowed",
      "uploadAllowed",
    ])
      assert.equal(planned[field], false);
    assert.equal(planned.nativeAcceptance, "not-tested");
    for (const change of [
      (r) => (r.runId = 1),
      (r) => (r.productionReady = true),
      (r) => (r.origin = "hosted-build"),
      (r) => (r.target = "aarch64-pc-windows-msvc"),
      (r) => (r.descriptorSha256 = "unknown"),
      (r) => (r.evidence.extra = { path: "extra", size: 1, sha256: digest }),
      (r) => (Object.values(r.evidence)[0].path = "../foreign"),
      (r) => (r.python.path = "python"),
    ]) {
      const bad = structuredClone(valid);
      change(bad);
      assert.throws(() => ownedSdkHandoffPlan(bad));
    }
  }
});
test("Linux evidence requires exact completed cross-file source/controller/image/bundle and retains local provenance", () => {
  const input = review("owned-linux-engine"),
    actual = linuxRecords();
  assert.equal(verifyOwnedHandoffEvidence(input, actual).sourceCommit, source);
  for (const change of [
    (r) => (r.finished.reason = "host-deadline"),
    (r) => (r.finished.result.exitCode = 137),
    (r) => (r.finished.result.logFailure = true),
    (r) => (r.finished.nativeAcceptance = "accepted"),
    (r) => (r.finished.productionReady = true),
    (r) => (r.finished.provenance = "github-hosted"),
    (r) => (r.started.sourceArchiveSha256 = "f".repeat(64)),
    (r) => (r.container.controllerCommit = source),
    (r) => (r.container.image = "sha256:" + "a".repeat(64)),
    (r) => (r.container.networkMode = "host"),
    (r) => (r.container.memorySwap = 0),
    (r) => (r.producer.state = "started"),
    (r) => (r.producer.result.descriptorSha256 = "a".repeat(64)),
    (r) => (r.producer.result.target = "aarch64-unknown-linux-gnu"),
    (r) => (r.producer.parentImageVerificationRequired = false),
    (r) => delete r.freshCheck,
    (r) => (r.prepared.extraction.rootOwned = false),
    (r) => (r.prepared.extraction.sourceInventorySha256 = "f".repeat(64)),
    (r) => (r.prepared.sealed.planSha256 = "f".repeat(64)),
    (r) => (r.prepared.tools.filesVerified = 9),
    (r) => (r.prepared.tools.pythonStdlibDependency = "unverified prefix"),
    (r) => (r.freshCheck.result.plan.imageId = "sha256:" + "a".repeat(64)),
    (r) => (r.freshCheck.result.plan.sourceInventorySha256 = "f".repeat(64)),
    (r) => (r.freshCheck.result.plan.paths.scratch = "/tmp"),
    (r) =>
      (r.freshCheck.result.sourceLock.builds[0].toolchainLock.sha256 =
        "f".repeat(64)),
    (r) => (r.freshCheck.result.confinement = "self-asserted"),
    (r) => (r.freshCheck.result.home.mode = 0o750),
    (r) => (r.freshCheck.result.home.mountAndAliasVerified = false),
    (r) => (r.freshCheck.result.home.privateCacheWriteVerified = false),
  ]) {
    const bad = structuredClone(actual);
    change(bad);
    assert.throws(() => verifyOwnedHandoffEvidence(input, bad));
  }
});

test("portable review binding retains every exact raw evidence pin and digest without exposing Python path", () => {
  for (const origin of ["existing-windows-package", "owned-linux-engine"]) {
    const input = review(origin),
      bound = ownedHandoffReviewBinding(input);
    assert.equal(bound.canonicalReviewSha256, identitySha256(input));
    assert.deepEqual(bound.evidencePins, input.evidence);
    assert.equal(JSON.stringify(bound).includes(input.python.path), false);
    const changed = structuredClone(input);
    Object.values(changed.evidence)[0].sha256 = "f".repeat(64);
    assert.notEqual(
      ownedHandoffReviewBinding(changed).canonicalReviewSha256,
      bound.canonicalReviewSha256,
    );
  }
});
test("Windows evidence binds old engine and cannot turn historical acceptance-pending into a new build/native claim", () => {
  const input = review(),
    records = {
      build: {
        built: true,
        sourceLockSha256: digest,
        libcefSha256: "e".repeat(64),
        gnArgsUnchanged: true,
        acceptance: "pending",
      },
    };
  assert.equal(
    verifyOwnedHandoffEvidence(input, records).newEngineBuildClaimed,
    false,
  );
  for (const delta of [
    { built: false },
    { sourceLockSha256: "f".repeat(64) },
    { libcefSha256: "unknown" },
    { gnArgsUnchanged: false },
    { acceptance: "passed" },
  ])
    assert.throws(() =>
      verifyOwnedHandoffEvidence(input, {
        build: { ...records.build, ...delta },
      }),
    );
});
test("no implicit check executes Python or grants a local file producer-artifact authority", async () => {
  await assert.rejects(
    checkOwnedSdkHandoff({ review: review() }),
    /Explicit review-only/,
  );
  const result = await exec(
    process.execPath,
    [path.join(root, "scripts/cef-owned-sdk-handoff.mjs"), "upload"],
    { windowsHide: true },
  ).catch((error) => error);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no upload/);
});

// Structural PE fixture only: never loaded, launched, or claimed as a runtime.
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
function elfFixture(http3 = false) {
  const names = [
      BRIDGE_V2.symbol,
      BRIDGE_V2.factorySymbol,
      "cef_sorng_tls_apply_proxy_v2",
      "cef_sorng_tls_registry_stats_v2",
      ...(http3 ? ["cef_sorng_tls_configure_datagrams_v2"] : []),
    ],
    bytes = Buffer.alloc(2048);
  bytes.writeUInt32LE(0x464c457f);
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(3, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeBigUInt64LE(64n, 40);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(3, 60);
  bytes.writeUInt32LE(11, 64 + 64 + 4);
  bytes.writeBigUInt64LE(256n, 64 + 64 + 24);
  bytes.writeBigUInt64LE(BigInt(24 * names.length), 64 + 64 + 32);
  bytes.writeUInt32LE(2, 64 + 64 + 40);
  bytes.writeBigUInt64LE(24n, 64 + 64 + 56);
  bytes.writeBigUInt64LE(512n, 64 + 128 + 24);
  bytes.writeBigUInt64LE(1024n, 64 + 128 + 32);
  names.forEach((name, i) => {
    const symbol = 256 + 24 * i,
      offset = 128 * i;
    bytes.writeUInt32LE(offset, symbol);
    bytes[symbol + 4] = 0x12;
    bytes.writeUInt16LE(1, symbol + 6);
    bytes.writeBigUInt64LE(1800n + BigInt(i), symbol + 8);
    bytes.write(name, 512 + offset);
  });
  return bytes;
}
async function put(base, name, bytes) {
  const file = path.join(base, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
async function fixture(t, incremental = false) {
  await mkdir(path.join(root, ".artifacts"), { recursive: true });
  const temporaryRoot = await realpath(os.tmpdir()),
    work = await realpath(
      await mkdtemp(path.join(temporaryRoot, "owned-handoff-test-")),
    );
  t.after(async () => {
    assert.equal(path.dirname(work), temporaryRoot);
    assert.equal(await realpath(work), work);
    await rm(work, { recursive: true, force: true });
  });
  const inputs = path.join(work, "inputs"),
    sourceInputs = path.join(
      root,
      incremental === "linux-isolated"
        ? "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap"
        : ["linux-incremental", "linux-isolated"].includes(incremental)
          ? "native/cef-build-inputs/20261025-registration-retirement-owned-linux-x64-default-colormap"
          : ["capsule", "operation2"].includes(incremental)
            ? "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64"
            : incremental
              ? "native/cef-build-inputs/20261024-r5-instance-tracer-allocation-windows-x64"
              : "native/cef-build-inputs/20261023-registration-retirement-lf",
    );
  const lockBytes = await readFile(path.join(sourceInputs, "source-lock.json")),
    lock = JSON.parse(lockBytes),
    target = ["linux-incremental", "linux-isolated"].includes(incremental)
      ? "x86_64-unknown-linux-gnu"
      : "x86_64-pc-windows-msvc",
    build = lock.builds.find((row) => row.target === target);
  await put(inputs, "source-lock.json", lockBytes);
  for (const item of [
    ...lock.patches,
    lock.bridge.header,
    build.gnArgs,
    build.toolchainLock,
  ])
    await put(
      inputs,
      item.path,
      await readFile(path.join(sourceInputs, item.path)),
    );
  const distribution = path.join(work, "distribution"),
    archiveRoot = "sdk",
    sdk = path.join(work, archiveRoot),
    bundle = path.join(work, "bundle"),
    evidence = path.join(work, "evidence");
  const library = ["linux-incremental", "linux-isolated"].includes(incremental)
    ? elfFixture(incremental === "linux-isolated")
    : pe(
        [
          BRIDGE_V2.symbol,
          BRIDGE_V2.factorySymbol,
          "cef_sorng_tls_apply_proxy_v2",
          "cef_sorng_tls_registry_stats_v2",
          ...(incremental ? ["cef_sorng_tls_configure_datagrams_v2"] : []),
        ],
        true,
      );
  for (const [name, bytes] of Object.entries({
    ...(["linux-incremental", "linux-isolated"].includes(incremental)
      ? { "Release/libcef.so": library, "Release/chrome-sandbox": elfFixture() }
      : {
          "Release/libcef.dll": library,
          "Release/bootstrap.exe": pe(),
          ...(incremental ? { "Release/bootstrapc.exe": pe() } : {}),
          "Release/libcef.lib": "fixture import lib",
        }),
    "Resources/icudtl.dat": "fixture ICU",
    "Resources/locales/en-US.pak": "fixture locale",
    "include/cef_version.h":
      `#define CEF_VERSION "${CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${lock.upstream.cef.commit}"\n#define CEF_SANDBOX_COMPAT_HASH "${["linux-incremental", "linux-isolated"].includes(incremental) ? "" : CEF_PIN.sandboxCompat}"\n` +
      CEF_PIN.chromium
        .split(".")
        .map(
          (part, index) =>
            `#define CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]} ${part}\n`,
        )
        .join(""),
    "include/cef_api_versions.h": `#define CEF_API_VERSION_15400 15400\n#define CEF_API_VERSION_LAST CEF_API_VERSION_15400\n#if defined(${["linux-incremental", "linux-isolated"].includes(incremental) ? "OS_LINUX" : "OS_WIN"})\n#define CEF_API_HASH_15400 "${hash("fixture api").slice(0, 40)}"\n#endif\n`,
    "cmake/fixture.cmake": "fixture cmake",
    "libcef_dll/fixture.cc": "fixture source",
    "CMakeLists.txt": "fixture CMake",
    "LICENSE.txt": "fixture license",
    "CREDITS.html": "fixture credits",
  }))
    await put(distribution, name, bytes);
  await flattenSdk(distribution, sdk, lock, inputs);
  const identity = releaseIdentity(lock, target),
    pythonCommand = process.platform === "win32" ? "python" : "python3",
    python = await realpath(
      (
        await exec(
          pythonCommand,
          ["-I", "-c", "import sys;print(sys.executable)"],
          { windowsHide: true },
        )
      ).stdout.trim(),
    );
  await mkdir(bundle);
  await exec(
    python,
    ["-I", "-c", PACK_PYTHON, sdk, path.join(bundle, identity.archive)],
    { windowsHide: true, timeout: 30000 },
  );
  await put(bundle, "source-lock.json", stableJson(lock));
  await inventoryCustomArtifact({
    lock: path.join(bundle, "source-lock.json"),
    target,
    "artifact-root": bundle,
    sdk,
    archive: identity.archive,
    manifest: "manifest.json",
    receipt: "receipt.json",
  });
  const descriptor = await descriptorFor({
    bundle,
    sourceLock: lock,
    target,
    repository: "supermarsx/sortOfRemoteNG",
    archiveRoot,
  });
  const descriptorBytes = Buffer.from(stableJson(descriptor));
  await put(bundle, "runtime.json", descriptorBytes);
  const buildBytes = Buffer.from(
    JSON.stringify({
      built: true,
      sourceLockSha256: identitySha256(lock),
      libcefSha256: hash(library),
      gnArgsUnchanged: true,
      acceptance: "pending",
    }),
  );
  await put(evidence, "build.json", buildBytes);
  let value = {
    ...review(),
    sourceLockIdentity: identitySha256(lock),
    descriptorSha256: hash(descriptorBytes),
    python: {
      path: python,
      sha256: hash(await readFile(python)),
      size: (await lstat(python)).size,
    },
    evidence: { build: pin("build.json", buildBytes) },
  };
  if (
    incremental &&
    !["capsule", "linux-incremental", "linux-isolated"].includes(incremental)
  ) {
    const checkedManifest = JSON.parse(
      await readFile(path.join(bundle, "manifest.json"), "utf8"),
    );
    const packageAssets = await Promise.all(
      [
        "source-lock.json",
        "manifest.json",
        "receipt.json",
        identity.archive,
      ].map(async (pathName) => {
        const bytes = await readFile(path.join(bundle, pathName));
        return { path: pathName, bytes: bytes.length, sha256: hash(bytes) };
      }),
    );
    const f = incrementalFixture(lock, {
      library,
      bootstrap: pe(),
      sdkFiles: checkedManifest.artifacts[0].sdkFiles.length,
      archive: {
        path: descriptor.archive.path,
        size: descriptor.archive.size,
        sha256: descriptor.archive.sha256,
      },
      packageAssets,
    });
    for (const [name, record] of Object.entries(f.records))
      await put(
        evidence,
        f.input.evidence[name].path,
        typeof record === "string" ? record : JSON.stringify(record),
      );
    value = {
      ...f.input,
      python: value.python,
      descriptorSha256: hash(descriptorBytes),
    };
  }
  if (["linux-incremental", "linux-isolated"].includes(incremental)) {
    const f =
        incremental === "linux-isolated"
          ? linuxIsolatedFixture()
          : linuxIncrementalFixture(),
      pack = f.records.package.facts,
      manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"))),
      engine = {
        path: "libcef.so",
        size: library.length,
        sha256: hash(library),
      },
      sandbox = {
        path: "chrome-sandbox",
        size: (await lstat(path.join(sdk, "chrome-sandbox"))).size,
        sha256: hash(await readFile(path.join(sdk, "chrome-sandbox"))),
      };
    f.input.descriptorSha256 = hash(descriptorBytes);
    Object.assign(pack, {
      descriptorSha256: f.input.descriptorSha256,
      engine,
      sandbox,
      sdkFiles: manifest.artifacts[0].sdkFiles.length,
      assets: await Promise.all(
        [
          "runtime.json",
          "manifest.json",
          "receipt.json",
          "source-lock.json",
          identity.archive,
        ].map(async (name) => {
          const bytes = await readFile(path.join(bundle, name));
          return { name, size: bytes.length, sha256: hash(bytes) };
        }),
      ),
    });
    Object.assign(f.records.postchecks.facts, { engine, sandbox });
    if (incremental === "linux-isolated")
      f.records.postchecks.facts.linkAfter = engine;
    for (const role of ["distribution", "preparation"])
      f.records[role].facts.filesVerified = pack.sdkFiles;
    f.records.preparation.facts.inventorySha256 = pack.assets.find(
      (x) => x.name === "manifest.json",
    ).sha256;
    f.input.python = value.python;
    if (f.refresh) f.refresh();
    f.input.evidence = Object.fromEntries(
      await Promise.all(
        Object.entries(f.records).map(async ([role, row]) => {
          const bytes = Buffer.from(
              typeof row === "string" ? row : JSON.stringify(row),
            ),
            name =
              role +
              (["compileOutput", "gnOutput"].includes(role) ? ".log" : ".json");
          await put(evidence, name, bytes);
          return [role, pin(name, bytes)];
        }),
      ),
    );
    value = f.input;
  }
  if (["capsule", "operation2"].includes(incremental)) {
    const f = await capsuleFixture(incremental === "operation2"),
      manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json")));
    f.input.python = value.python;
    f.input.descriptorSha256 = hash(descriptorBytes);
    const outputs = (f.r.engine.operation ?? f.r.engine.engine).outputs;
    for (const [name, bytes] of [
      ["libcef.dll", library],
      ["bootstrap.exe", pe()],
      ["bootstrapc.exe", pe()],
      ["libcef.dll.lib", Buffer.from("fixture import lib")],
    ])
      Object.assign(
        outputs.find((row) => row.path === name),
        { bytes: bytes.length, sha256: hash(bytes) },
      );
    Object.assign(f.r.package, {
      engineSha256: hash(library),
      sdkFiles: manifest.artifacts[0].sdkFiles.length,
      preparedSdkFiles: manifest.artifacts[0].sdkFiles.length,
      archive: {
        path: descriptor.archive.path,
        size: descriptor.archive.size,
        sha256: descriptor.archive.sha256,
      },
      metadataAndArchiveHashes: await Promise.all(
        [
          "source-lock.json",
          "manifest.json",
          "receipt.json",
          identity.archive,
        ].map(async (name) => {
          const bytes = await readFile(path.join(bundle, name));
          return { path: name, bytes: bytes.length, sha256: hash(bytes) };
        }),
      ),
    });
    f.seal();
    for (const [name, record] of Object.entries(f.r))
      await put(
        evidence,
        f.input.evidence[name].path,
        typeof record === "string" ? record : JSON.stringify(record),
      );
    value = f.input;
  }
  const output = path.join(
    await realpath(path.join(root, ".artifacts")),
    "owned-sdk-handoff-" + randomUUID(),
  );
  t.after(async () => {
    try {
      assert.equal(await realpath(output), output);
      assert.equal(
        path.dirname(output),
        await realpath(path.join(root, ".artifacts")),
      );
      await rm(output, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  });
  return { work, bundle, inputs, evidence, output, review: value };
}
test("real archive extraction and existing SDK/source/export/image checks produce only review-only handoff", async (t) => {
  const f = await fixture(t),
    result = await checkOwnedSdkHandoff({ ...f, execute: true });
  assert.equal(
    result.archiveSdkRelationship,
    "extracted-and-inventory-verified",
  );
  assert.equal(result.hostedBuild, false);
  assert.equal(result.nativeAcceptance, "not-tested");
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.provenance.newEngineBuildClaimed, false);
  assert.deepEqual(result.reviewBinding.evidencePins, f.review.evidence);
  assert.equal(
    result.reviewBinding.canonicalReviewSha256,
    identitySha256(f.review),
  );
  await assert.rejects(checkOwnedSdkHandoff({ ...f, execute: true }), {
    code: "EEXIST",
  });
});
test("tampered evidence, original raw source input, descriptor or Python fail before extraction", async (t) => {
  const f = await fixture(t);
  for (const item of ["evidence", "source", "descriptor", "python"]) {
    const bad = structuredClone(f);
    if (item === "python") {
      bad.review.python.sha256 = "f".repeat(64);
      await assert.rejects(
        checkOwnedSdkHandoff({ ...bad, execute: true }),
        /Python executable mismatch/,
      );
      continue;
    }
    const file =
        item === "evidence"
          ? path.join(f.evidence, "build.json")
          : item === "source"
            ? path.join(f.inputs, "include/cef_sorng_tls_bridge.h")
            : path.join(f.bundle, "runtime.json"),
      before = await readFile(file);
    try {
      await writeFile(file, Buffer.concat([before, Buffer.from(" ")]));
      await assert.rejects(
        checkOwnedSdkHandoff({ ...bad, execute: true }),
        /pin mismatch|descriptor mismatch/,
      );
    } finally {
      await writeFile(file, before);
    }
  }
});

test("fresh check raw digest binds the actual original Linux input bytes before transport, separately from packaged JSON", async (t) => {
  const f = await fixture(t),
    inputs = path.join(f.work, "linux-inputs"),
    actualSource = path.join(
      root,
      "native/cef-build-inputs/20261024-registration-retirement-owned-linux-x64",
    );
  await put(inputs, "source-lock.json", linuxLockBytes);
  for (const item of [
    ...linuxLock.patches,
    linuxLock.bridge.header,
    linuxLock.builds[0].gnArgs,
    linuxLock.builds[0].toolchainLock,
  ])
    await put(
      inputs,
      item.path,
      await readFile(path.join(actualSource, item.path)),
    );
  for (const wrong of [true, false]) {
    const records = linuxRecords(),
      reviewed = review("owned-linux-engine");
    records.freshCheck.result.plan.sourceLockSha256 = wrong
      ? "f".repeat(64)
      : hash(await readFile(path.join(inputs, "source-lock.json")));
    for (const [name, record] of Object.entries(records)) {
      const bytes = Buffer.from(JSON.stringify(record));
      await put(f.evidence, name + ".json", bytes);
      reviewed.evidence[name] = pin(name + ".json", bytes);
    }
    reviewed.python = f.review.python;
    await assert.rejects(
      checkOwnedSdkHandoff({ ...f, inputs, review: reviewed, execute: true }),
      wrong
        ? /Fresh check does not bind original raw input lock/
        : /Reviewed raw descriptor mismatch/,
    );
  }
});

const incrementalNames = [
  "build",
  "beforeimage",
  "apply",
  "prerequisites",
  "nativeOutput",
  "continuation",
  "engineJob",
  "engine",
  "engineOutput",
  "symbols",
  "package",
  "distribution",
  "preparation",
];
const nativeNames = [
  "InstanceTracerStorageIntegrationTest.RealRawPtrAssignmentMovesTrackingBetweenAllocations",
  "InstanceTracerStorageIntegrationTest.RealMayDangleIsFilteredWithoutDroppingNormalOwner",
  "InstanceTracerStorageTest.TraceAllocationAndRemovalNeverHoldStorageMutex",
  "InstanceTracerStorageTest.SnapshotAllocationNeverHoldsStorageMutex",
  "InstanceTracerStorageTest.DuplicatePreservesOriginalAndDestroysUnusedNodeOutsideMutex",
  "InstanceTracerStorageTest.SnapshotIsCompleteSortedAndFiltersSlotAndMayDangle",
  "InstanceTracerStorageTest.NodeAllocatorCanReenterRemovalBeforeInsertion",
  "InstanceTracerStorageTest.SnapshotRetriesAfterCapacityAllocationAddsOwners",
  "InstanceTracerStorageTest.InfoConstructionCanReenterRemoval",
  "InstanceTracerStorageTest.GeometricCapacityProgressesDuringReserveTimeGrowth",
  "InstanceTracerStorageTest.FourConcurrentWritersAndSnapshotsFinishEmpty",
  "InstanceTracerStorageIntegrationTest.RealRawPtrCopyAndCleanupKeepExactRecords",
];
function incrementalFixture(lock, options = {}) {
  const id = identitySha256(lock),
    target = "x86_64-pc-windows-msvc",
    build = lock.builds.find((row) => row.target === target);
  const bytes = {
    library: options.library ?? Buffer.from("synthetic engine"),
    bootstrap: options.bootstrap ?? pe(),
    importLib: Buffer.from("fixture import lib"),
  };
  const evidencePin = (name, value) =>
    pin(
      name + (typeof value === "string" ? ".log" : ".json"),
      Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
    );
  const job = {
    kind: "owned-job-proof",
    started: true,
    assignedBeforeResume: true,
    resumed: true,
    handleListOnly: true,
    outcome: "success",
    rootExit: 0,
    finalRootExit: 0,
    rootReaped: true,
    cleanupVerified: true,
    activeAtEnd: 0,
    logReadersStopped: true,
    rootPid: 123,
    rootCreationFiletime: "134373327242795156",
    elapsedMs: 1000,
  };
  const r = {};
  r.build = {
    kind: "genuine-local-windows-x64-tracer17-build-evidence",
    sourceLockSha256: id,
    patchId: "sorng-tls-v2-682c378-5",
    abiVersion: 2,
    nativeTests: { passed: 12, failed: 0 },
    engineBuild: { exit: 0, steps: 370, ownedJobCleanup: true },
    source4Tool8ArgsFlagsPostchecks: true,
    nativeBrowserAcceptance: false,
    productionReady: false,
    runtimeSelected: false,
    published: false,
  };
  r.beforeimage = {
    kind: "sorng-tracer17-beforeimage",
    sourceLockIdentity: id,
    actualToolCount: 8,
    backupSha256: {
      "libcef.dll": "e".repeat(64),
      "args.gn": build.gnArgs.sha256,
    },
    gitHeads: Object.fromEntries(
      Object.entries(lock.upstream).map(([name, row]) => [
        name === "depot_tools" ? "depotTools" : name,
        row.commit,
      ]),
    ),
    preservedInputs: [
      ...lock.patches.slice(0, -1),
      lock.bridge.header,
      build.gnArgs,
      build.toolchainLock,
    ].map((row) => ({ path: row.path, sha256: row.sha256 })),
  };
  r.apply = {
    fourResultHashesExact: true,
    operations: [{ exit: 0 }, { exit: 0 }],
    files: Array.from({ length: 4 }, () => ({ sha256: digest })),
  };
  r.nativeOutput =
    nativeNames
      .map((name, index) => `[${index + 1}/12] ${name} (0 ms)`)
      .join("\n") + "\nSUCCESS: all tests passed.\n";
  r.prerequisites = {
    sourceLockIdentity: id,
    sourceHead: controller,
    outcome: "post-stage-validation-denied",
    postchecks: {
      fullEngineStageStarted: false,
      actual8ToolPins: true,
      actual4SourcePins: true,
      argsUnchanged: true,
    },
    stages: Array.from({ length: 4 }, (_, index) => ({
      index,
      outcome: "success",
      rootExit: 0,
      activeAtEnd: 0,
      cleanupVerified: true,
      logReadersStopped: true,
    })),
    files: [
      {
        ...evidencePin("nativeOutput", r.nativeOutput),
        path: "prior/3/stdout.log",
        bytes: Buffer.byteLength(r.nativeOutput),
      },
    ],
  };
  r.engineJob = { ...job };
  r.continuation = {
    kind: "owned-engine-continuation",
    success: true,
    outcome: "success",
    originalProof: {
      beforeimage: {
        sourceLockIdentity: id,
        sourceFileCount: 4,
        inputPinCount: 20,
        toolCount: 8,
      },
      native: { expectedTests: 12, passedTests: 12, uniqueTestNames: 12 },
    },
    job: { ...job },
    postbuild: { sourcePins: 4, installedToolPins: 8, argsUnchanged: true },
  };
  r.engineOutput =
    "[369/371] 8m00s F LINK ceftests.exe\nbuild finished\nnoexec:0 local:370 remote:0 cache:0 skip:88635\n";
  const fp = (name, value) => ({
    path: "original/" + name,
    bytes: value.length,
    sha256: hash(value),
  });
  r.symbols = {
    kind: "new-local-engine-symbol-and-output-proof",
    machine: "0x8664",
    matches: true,
    networkSymbolLookup: false,
    dllRsds: { guid: "d7de7603-3697-ce2d-4c4c-44205044422e", age: 1 },
    pdbInformationStream: {
      guid: "d7de7603-3697-ce2d-4c4c-44205044422e",
      age: 1,
    },
    files: [
      fp("libcef.dll", bytes.library),
      fp("libcef.dll.pdb", Buffer.from("synthetic pdb")),
      fp("libcef.dll.lib", bytes.importLib),
      fp("bootstrap.exe", bytes.bootstrap),
      fp("bootstrapc.exe", bytes.bootstrap),
    ],
  };
  r.engine = {
    kind: "actual-local-windows-x64-tracer17-engine-build",
    sourceLockIdentity: id,
    patch17: lock.patches.at(-1).sha256,
    outcome: "success",
    engineExit: 0,
    steps: 370,
    originalGuardFormatFailurePreserved: true,
    postbuild: { ...r.continuation.postbuild },
    cleanup: {
      rootPid: job.rootPid,
      rootCreationFiletime: job.rootCreationFiletime,
      rootReaped: true,
      activeAtEnd: 0,
      cleanupVerified: true,
      logReadersStopped: true,
    },
    newOutputs: structuredClone(r.symbols),
    rawBuildProofs: [
      ...[
        ["continuation", "/continuation.json"],
        ["engineJob", "/receipt.json"],
        ["engineOutput", "/stdout.log"],
      ].map(([role, suffix]) => ({
        path: "original" + suffix,
        sha256: evidencePin(role, r[role]).sha256,
        bytes: evidencePin(role, r[role]).size,
      })),
    ],
  };
  r.distribution = {
    receipt: { ...job },
    argv: [
      "original-python",
      "tools/make_distrib.py",
      "--ninja-build",
      "--x64-build",
      "--minimal",
      "--allow-partial",
      "--no-archive",
      "--no-docs",
    ],
  };
  r.preparation = { receipt: { ...job }, originalFailurePreserved: true };
  r.package = {
    kind: "immutable-local-tracer17-sdk-package",
    sourceLockIdentity: id,
    bridgePatchId: lock.bridge.patchId,
    headerSha256: lock.bridge.header.sha256,
    sdkFiles: options.sdkFiles ?? 25,
    preparedSdkFiles: options.sdkFiles ?? 25,
    snapshotRsdsPdbMatched: true,
    source4Tool8ArgsFlagsPostchecks: true,
    originalPreparationFailurePreserved: true,
    authorizedRecoveryFreshOnly: true,
    productionReady: false,
    selected: false,
    published: false,
    steps: [
      { phase: "prepare", exit: 1 },
      { phase: "prepare-recovery", exit: 0, cleanup: true, activeAtEnd: 0 },
    ],
    metadataAndArchiveHashes: [
      ...[
        ["build", "build-evidence.json"],
        ["distribution", "distribution-job-proof.json"],
        ["preparation", "prepare-recovery-job-proof.json"],
      ].map(([role, path]) => ({
        path,
        bytes: evidencePin(role, r[role]).size,
        sha256: evidencePin(role, r[role]).sha256,
      })),
      ...(options.packageAssets ?? []),
    ],
    archive: options.archive,
  };
  const input = {
    ...review(),
    origin: "owned-windows-incremental-engine",
    sourceLockIdentity: id,
    evidence: Object.fromEntries(
      incrementalNames.map((name) => [name, evidencePin(name, r[name])]),
    ),
  };
  return { input, records: r, lock };
}
async function revisionFiveLock() {
  return JSON.parse(
    await readFile(
      path.join(
        root,
        "native/cef-build-inputs/20261024-r5-instance-tracer-allocation-windows-x64/source-lock.json",
      ),
      "utf8",
    ),
  );
}

test("incremental Windows provenance consumes original R5 records without inventing legacy built flags", async () => {
  const f = incrementalFixture(await revisionFiveLock());
  const result = verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  assert.equal(result.incrementalBuild, true);
  assert.equal(result.pristineSourceBuild, false);
  assert.equal(result.originalBuildReplayed, false);
  assert.equal(result.nativeClassTestsPassed, 12);
  assert.equal(Object.hasOwn(f.records.build, "built"), false);
  assert.equal(Object.hasOwn(result, "nativeAcceptance"), false);
  assert.equal(JSON.stringify(result).includes("original/"), false);
  for (const change of [
    (r) => (r.engine.engineExit = 1),
    (r) => (r.engineJob.cleanupVerified = false),
    (r) => r.engine.cleanup.rootPid++,
    (r) =>
      (r.continuation.originalProof.beforeimage.sourceLockIdentity = "f".repeat(
        64,
      )),
    (r) => (r.beforeimage.backupSha256["args.gn"] = "f".repeat(64)),
    (r) => r.beforeimage.preservedInputs.pop(),
    (r) => r.symbols.pdbInformationStream.age++,
    (r) => (r.package.sourceLockIdentity = "f".repeat(64)),
    (r) => (r.prerequisites.outcome = "success"),
    (r) => (r.preparation.receipt.activeAtEnd = 1),
    (r) =>
      (r.engineOutput =
        "build finished\nnoexec:0 local:369 remote:0 cache:0 skip:1\n"),
    (r) =>
      (r.nativeOutput = r.nativeOutput.replace(nativeNames[1], nativeNames[0])),
    (r) =>
      (r.nativeOutput = r.nativeOutput.replace(
        nativeNames[0],
        "InstanceTracerStorageTest.UnreviewedCase",
      )),
  ]) {
    const bad = structuredClone(f.records);
    change(bad);
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, bad, f.lock));
  }
});

test("production nontracing GN identity cannot inherit old sixteen-d build or twelve-test records", async () => {
  const f = incrementalFixture(await revisionFiveLock()),
    future = structuredClone(f.lock);
  const gnPath = future.builds[0].gnArgs.path;
  const original = await readFile(
    path.join(
      root,
      "native/cef-build-inputs/20261024-r5-instance-tracer-allocation-windows-x64",
      gnPath,
    ),
    "utf8",
  );
  future.builds[0].gnArgs.sha256 = hash(
    original.replace(
      "enable_backup_ref_ptr_instance_tracer=true",
      "enable_backup_ref_ptr_instance_tracer=false",
    ),
  );
  const identity = identitySha256(future);
  assert.notEqual(identity, f.input.sourceLockIdentity);
  assert.equal(
    identity,
    "1381a26cc354669adc843224dcf066721adecb62cf75c0d8108d325a260edbdc",
  );
  assert.throws(() =>
    verifyOwnedHandoffEvidence(
      { ...f.input, sourceLockIdentity: identity },
      f.records,
      future,
    ),
  );
  const wrong = structuredClone(f.lock);
  wrong.bridge.patchId = "sorng-tls-v2-682c378-4";
  assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, wrong));
});

test("real structural R5 archive roundtrip keeps all thirteen original evidence roles and actual output pins", async (t) => {
  const f = await fixture(t, true),
    result = await checkOwnedSdkHandoff({ ...f, execute: true });
  assert.equal(result.sourceLockIdentity, f.review.sourceLockIdentity);
  assert.equal(result.provenance.incrementalBuild, true);
  assert.equal(result.provenance.pristineSourceBuild, false);
  assert.equal(result.nativeAcceptance, "not-tested");
  assert.equal(Object.keys(result.reviewBinding.evidencePins).length, 13);
  assert.equal(result.hostedBuild, false);
  assert.equal(result.publicationAllowed, false);
});

// Synthetic schema records only; these never attest a real engine or SDK.
async function capsuleFixture(operation2 = false) {
  const lock = JSON.parse(
    await readFile(
      path.join(
        root,
        "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64/source-lock.json",
      ),
    ),
  );
  assert.equal(identitySha256(lock), WINDOWS_CAPSULE_IDENTITY);
  const job = {
    kind: "owned-job-proof",
    success: true,
    started: true,
    assignedBeforeResume: true,
    resumed: true,
    handleListOnly: true,
    outcome: "success",
    rootExit: 0,
    finalRootExit: 0,
    rootReaped: true,
    cleanupVerified: true,
    activeAtEnd: 0,
    logReadersStopped: true,
    cleanupBudgetMs: 30000,
    rootPid: 42,
    rootCreationFiletime: "1234",
    elapsedMs: 100,
  };
  const deadline = {
    originalDeadlineUtc: "2026-10-25T00:35:33Z",
    originalMonotonicEnd: 1414850.593,
  };
  const nativePost = {
    source9ToolsFlagsRuntimeGraph: { verified: true },
    gitHeads: { verified: true },
    source22Inputs: { verified: true },
  };
  const native = {
    kind: "source22-fresh-native-continuation",
    success: true,
    native: {
      ...deadline,
      success: true,
      sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
      nativeRecords: 42,
      patch22Applied: true,
      finalDeadlineAdmission: { verified: true },
      postVerification: nativePost,
      stages: [
        "apply-check",
        "apply-test-dependency",
        "security-build",
        "owned-quic-lifetime-full-list",
        "owned-quic-lifetime-full-run",
        "brp-dpd-list",
        "brp-dpd-run",
        "sandbox-list",
        "sandbox-run",
      ].map((name) => ({ name, job: structuredClone(job) })),
    },
  };
  const r = {
    native,
    engineJob: job,
    engineOutput: "build finished\nnoexec:0 local:20 remote:0 cache:0 skip:0\n",
  };
  const nativeRows = [{ path: "continuation.json", bytes: 1, sha256: digest }];
  for (const [profile, out, list] of [
    ["owned-quic-lifetime-full", "nativeFocusedOutput", "nativeFocusedList"],
    ["brp-dpd", "nativeBrpOutput", "nativeBrpList"],
    ["sandbox", "nativeSandboxOutput", "nativeSandboxList"],
  ]) {
    const names = WINDOWS_CAPSULE_PROFILES[profile];
    r[out] =
      names
        .map((name, index) => `[${index + 1}/${names.length}] ${name} (1 ms)`)
        .join("\n") + "\nSUCCESS: all tests passed.\n";
    let suite = "";
    r[list] = "";
    for (const name of names) {
      const [next, test] = name.split(".");
      if (next !== suite) {
        suite = next;
        r[list] += suite + ".\n";
      }
      r[list] += "  " + test + "\n";
    }
    nativeRows.push(
      { path: profile + "-run/stdout.log", bytes: 1, sha256: digest },
      { path: profile + "-list/stdout.log", bytes: 1, sha256: digest },
    );
  }
  for (const row of native.native.stages)
    nativeRows.push({
      path: row.name + "/receipt.json",
      bytes: 1,
      sha256: digest,
    });
  while (nativeRows.length < 57)
    nativeRows.push({
      path: `retained-${nativeRows.length}.json`,
      bytes: 1,
      sha256: digest,
    });
  r.nativeJobs = {};
  r.engineSymbols = {
    machine: "AMD64",
    guid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    age: 1,
    scope:
      "Bounded PE RSDS / MSF7 PDB info-stream identity; not full PDB validation",
  };
  r.engine = {
    kind: "source22-engine-fresh-continuation",
    success: true,
    engineStarted: true,
    sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
    engine: {
      ...deadline,
      kind: "source22-one-owned-engine-build",
      success: true,
      sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
      job,
      argv: [
        "C:/Python/python.exe",
        "F:/tools/autoninja.py",
        "-j8",
        "-C",
        "out/Release_GN_x64",
        "cef",
        "cef_sandbox",
        "bootstrap",
        "bootstrapc",
      ],
      capSeconds: 3600,
      finalDeadlineAdmission: { verified: true },
      postVerification: {
        source9ToolsFlagsGraph: { verified: true },
        gitHeads: { verified: true },
        source22Inputs: { verified: true },
      },
      symbols: r.engineSymbols,
      outputs: [
        "libcef.dll",
        "libcef.dll.pdb",
        "bootstrap.exe",
        "bootstrapc.exe",
        "bootstrap.lib",
        "libcef.dll.lib",
        "obj/cef/cef_sandbox.lib",
      ].map((name) => ({ path: name, bytes: 100, sha256: "e".repeat(64) })),
    },
  };
  r.engineBeforeimage = [
    ...WINDOWS_CAPSULE_SOURCE_PINS.map((row) => ({ role: "source", ...row })),
    ...r.engine.engine.outputs.map((row) => ({
      role: "runtime",
      path: row.path,
      bytes: 50,
      sha256: "f".repeat(64),
    })),
  ];
  r.distribution = {
    receipt: job,
    argv: [
      "python.exe",
      "tools/make_distrib.py",
      "--ninja-build",
      "--x64-build",
      "--minimal",
      "--allow-partial",
      "--no-archive",
      "--no-docs",
    ],
  };
  r.preparation = { receipt: job };
  r.package = {
    kind: "immutable-local-capsule22-sdk-package",
    derivedFacts: true,
    sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
    engineSha256: "e".repeat(64),
    bridgePatchId: lock.bridge.patchId,
    headerSha256: lock.bridge.header.sha256,
    sdkFiles: 953,
    preparedSdkFiles: 953,
    snapshotRsdsPdbMatched: true,
    source9Tool8ArgsFlagsPostchecks: true,
    productionReady: false,
    selected: false,
    published: false,
  };
  r.build = {
    kind: "derived-local-windows-capsule-build-bindings",
    derivedFacts: true,
    sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
    controllerCommit: controller,
    policy: {
      cpuRate: 2000,
      memoryBytes: 32 * 1024 ** 3,
      processLimit: 128,
      inheritedHandles: 3,
      cleanupMs: 30000,
      jobs: 8,
      ...deadline,
    },
    recordDigests: {},
  };
  const input = {
    ...review(),
    origin: WINDOWS_CAPSULE_ORIGIN,
    sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
    evidence: {},
  };
  const textRoles = new Set([
    "engineOutput",
    "engineAccounting",
    "nativeFocusedOutput",
    "nativeBrpOutput",
    "nativeSandboxOutput",
    "nativeFocusedList",
    "nativeBrpList",
    "nativeSandboxList",
  ]);
  const encoded = (role) =>
    Buffer.from(textRoles.has(role) ? r[role] : JSON.stringify(r[role]));
  const wrap = (record) => {
    const rawUtf8 = JSON.stringify(record);
    return { rawUtf8, sha256: hash(rawUtf8) };
  };
  if (operation2) {
    input.origin = WINDOWS_OPERATION2_ORIGIN;
    const eng = r.engine.engine,
      rootMs = Date.parse("2026-10-25T01:09:11Z"),
      launchUtc = "2026-10-25T01:07:15Z",
      end = "2026-10-25T05:07:15Z";
    job.rootCreationFiletime = String(
      BigInt(rootMs) * 10000n + 116444736000000000n,
    );
    Object.assign(job, {
      compilerOutcome: "success",
      accountingOutcome: "verified",
      policyReadback: {
        cpuFlags: 5,
        cpuRate: 3000,
        limitFlags: 0x2208,
        activeProcessLimit: 128,
        jobMemoryBytes: "34359738368",
        explicitInheritedHandles: 3,
        affinityPolicyChanged: false,
      },
    });
    const row = (role, elapsedMs) => ({
      role,
      elapsedMs,
      user100ns: role === "initial" ? "0" : "9007199254740993",
      kernel100ns: "0",
      totalProcesses: 1,
      activeProcesses: role === "initial" ? 1 : 0,
      terminatedProcesses: role === "initial" ? 0 : 1,
      readOperations: "0",
      writeOperations: "0",
      otherOperations: "0",
      readBytes: "0",
      writeBytes: "0",
      otherBytes: "0",
      peakProcessMemoryBytes: "1024",
      peakJobMemoryBytes: "2048",
    });
    r.engineAccounting = JSON.stringify({
      kind: "owned-job-accounting-v1",
      available: true,
      intervalMs: 10000,
      queryClasses: [8, 9],
      rowLimit: 2048,
      byteLimit: 2097152,
      samples: [row("initial", 0), row("final", 100)],
      errors: [],
      processorGroupFacts: "not-collected",
      cpuDenominatorKnown: false,
      utilizationPercent: null,
    });
    job.accountingSha256 = hash(r.engineAccounting);
    Object.assign(eng, {
      kind: "owned-windows-source22-explicit-engine-operation2",
      operationDeadlineUtc: end,
      operationMonotonicEnd: 22222,
      originalAttemptDeadlineUtc: "2026-10-25T00:35:33Z",
      actualClang: structuredClone(WINDOWS_OPERATION2_CLANG),
      nativePrerequisites: {
        count: 42,
        executedInThisOperation: false,
        sameSourceToolsFlagsReverified: true,
        manifestSha256: digest,
      },
      postVerification: {
        actualClangSeparatelyObserved: { verified: true },
        source9ToolsFlagsGraph: { verified: true },
        gitHeads: { verified: true },
        source22Inputs: { verified: true },
      },
    });
    delete eng.originalDeadlineUtc;
    delete eng.originalMonotonicEnd;
    eng.argv[2] = "-j12";
    r.engine = {
      kind: "source22-explicit-engine-operation2-controller",
      success: true,
      engineStarted: true,
      sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
      actualClang: structuredClone(WINDOWS_OPERATION2_CLANG),
      operation: eng,
      controllerFinalDeadlineAdmission: { verified: true },
    };
    const oldJob = {
      ...structuredClone(job),
      success: false,
      outcome: "deadline",
      rootExit: null,
      finalRootExit: 124,
    };
    const oldReport = {
      kind: "source22-engine-fresh-continuation",
      sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
      success: false,
      engine: {
        success: false,
        originalDeadlineUtc: "2026-10-25T00:35:33Z",
        finalDeadlineAdmission: { verified: false },
        postVerification: {
          source9ToolsFlagsGraph: { verified: true },
          gitHeads: { verified: true },
          source22Inputs: { verified: true },
        },
        job: oldJob,
      },
    };
    const originalReport = wrap(oldReport),
      oldRows = Array.from({ length: 39 }, (_, i) => ({
        path: i === 0 ? "engine-continuation.json" : `synthetic-old-${i}`,
        bytes: i === 0 ? Buffer.byteLength(originalReport.rawUtf8) : 1,
        sha256: i === 0 ? originalReport.sha256 : digest,
      }));
    const originalManifest = wrap({
      kind: "actual-source22-first-engine-partial-deadline-raw-proof",
      files: oldRows,
      observationFiles: Array.from({ length: 4 }, () => ({
        sha256: digest,
        bytes: 1,
      })),
    });
    const originalReceipt = wrap({
      kind: "actual-source22-engine-partial-original-deadline",
      sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
      rawManifestSha256: originalManifest.sha256,
      fullEngineBuilt: false,
      actualJob: oldJob,
    });
    r.previousEngineAttempt = {
      kind: "derived-operation2-original-failed-attempt",
      derivedFacts: true,
      originalReport,
      originalManifest,
      originalReceipt,
    };
    eng.previousAttempt = {
      manifestSha256: originalManifest.sha256,
      receiptSha256: originalReceipt.sha256,
      originalDeadlineUtc: "2026-10-25T00:35:33Z",
      originalOutcome: "deadline",
      originalFinalRootExit: 124,
      originalSuccess: false,
      rootReaped: true,
      activeAtEnd: 0,
    };
    const operationEvidence = {
      controllerSha256:
        "b022ce4b19a8f103df347290fe119d33fecb9655e3f2ab0b690ad0259c3a1e5c",
      driverSha256:
        "0130b26e2fdea96396fe1bb5527f504859fef2c56d1f70b91a0cc6f665c559fa",
      phaseRecords: {},
    };
    operationEvidence.controllerLaunch = wrap({
      kind: "explicit-operation2-controller-launch",
      launchUtc,
      deadlineUtc: end,
      controllerSha256: operationEvidence.controllerSha256,
      driverSha256: operationEvidence.driverSha256,
    });
    for (const phase of ["phaseA", "phaseB"]) {
      const observedAtUtc = new Date(rootMs - 50).toISOString();
      const capacity = wrap({
        kind: "actual-host-capacity",
        observedAtUtc,
        availableBytes: 128 * 1024 ** 3,
        committedBytes: 32 * 1024 ** 3,
        commitLimitBytes: 256 * 1024 ** 3,
        logicalProcessors: 80,
      });
      const audit = wrap({
        kind: "sorng-scoped-engine-writer-audit",
        sourceRoot: "F:/cef-builds/sorng-20261007/src",
        depotRoot: "F:/cef-builds/sorng-20261007/depot_tools",
        observedAtUtc,
        blockingCount: 0,
        rows: [],
      });
      operationEvidence.phaseRecords[phase] = { capacity, audit };
      r.engine[phase] = {
        phase,
        capacitySha256: capacity.sha256,
        auditSha256: audit.sha256,
        writerCollectorSha256:
          "641fd1717e79f06c6e0dda72332ce8514f209f3540031b1c84b1b3cd7b5e4022",
        capacityQueryJob: structuredClone(job),
      };
    }
    r.build.operationEvidence = operationEvidence;
    r.build.policy.cpuRate = 3000;
    r.build.policy.jobs = 12;
    r.package.kind = "immutable-local-capsule22-operation2-sdk-package";
  }
  function seal() {
    for (const [role, suffix] of [
      ["native", "continuation.json"],
      ["nativeFocusedOutput", "owned-quic-lifetime-full-run/stdout.log"],
      ["nativeFocusedList", "owned-quic-lifetime-full-list/stdout.log"],
      ["nativeBrpOutput", "brp-dpd-run/stdout.log"],
      ["nativeBrpList", "brp-dpd-list/stdout.log"],
      ["nativeSandboxOutput", "sandbox-run/stdout.log"],
      ["nativeSandboxList", "sandbox-list/stdout.log"],
    ]) {
      Object.assign(
        nativeRows.find((row) => row.path === suffix),
        { bytes: encoded(role).length, sha256: hash(encoded(role)) },
      );
    }
    const stageReceipts = Object.fromEntries(
      native.native.stages.map((row) => [row.name, wrap(row.job)]),
    );
    for (const [name, wrapped] of Object.entries(stageReceipts))
      Object.assign(
        nativeRows.find((row) => row.path === name + "/receipt.json"),
        { bytes: Buffer.byteLength(wrapped.rawUtf8), sha256: wrapped.sha256 },
      );
    const observations = [0, 1, 2, 3].map((i) =>
      wrap({ syntheticObservation: i }),
    );
    const manifest = {
      files: nativeRows,
      observationFiles: observations.map((wrapped, i) => ({
        path: `observation-${i}`,
        sha256: wrapped.sha256,
        bytes: Buffer.byteLength(wrapped.rawUtf8),
      })),
    };
    const originalManifest = wrap(manifest),
      manifestSha = originalManifest.sha256;
    r.nativeJobs = {
      kind: "derived-capsule-original-native-records",
      derivedFacts: true,
      originalManifest,
      stageReceipts,
      observations,
    };
    if (operation2)
      r.engine.operation.nativePrerequisites.manifestSha256 = manifestSha;
    else r.engine.engine.native42ManifestSha256 = manifestSha;
    r.sourcePostchecks = {
      kind: "derived-capsule-original-postcheck-records",
      derivedFacts: true,
      nativeReceipt: wrap({
        kind: "actual-source22-genuine-native42-pass",
        sourceLockIdentity: WINDOWS_CAPSULE_IDENTITY,
        rawManifestSha256: manifestSha,
        nativePassingRecords: 42,
        allNativeJobsQuiescent: true,
        finalDeadlineAdmission: { verified: true },
        actualSource9: WINDOWS_CAPSULE_SOURCE_PINS,
        postVerification: nativePost,
      }),
      generatedFlags: wrap({
        macroCount: 61,
        macros: WINDOWS_CAPSULE_MACROS,
        actualTool8: WINDOWS_CAPSULE_TOOL_PINS,
      }),
    };
    r.package.originalRecordDigests = Object.fromEntries(
      ["distribution", "preparation"].map((role) => [
        role,
        hash(encoded(role)),
      ]),
    );
    r.engineSymbols = {
      kind: "derived-capsule-engine-symbol-identity",
      derivedFacts: true,
      originalEngineRecordSha256: hash(encoded("engine")),
      symbols: (operation2 ? r.engine.operation : r.engine.engine).symbols,
    };
    r.build.recordDigests = Object.fromEntries(
      (operation2 ? WINDOWS_OPERATION2_EVIDENCE : WINDOWS_CAPSULE_EVIDENCE)
        .filter((role) => role !== "build")
        .map((role) => [role, hash(encoded(role))]),
    );
    input.evidence = Object.fromEntries(
      (operation2 ? WINDOWS_OPERATION2_EVIDENCE : WINDOWS_CAPSULE_EVIDENCE).map(
        (role) => [role, pin(role + ".json", encoded(role))],
      ),
    );
  }
  seal();
  return { lock, r, input, seal };
}
test("capsule source22 has its own exact42 schema, without transferring browser acceptance", async () => {
  const f = await capsuleFixture(),
    p = verifyOwnedHandoffEvidence(f.input, f.r, f.lock);
  assert.equal(p.nativeClassTestsPassed, 42);
  assert.deepEqual(p.nativeProfileCounts, [36, 3, 3]);
  assert.equal(p.derivedFacts, true);
  const plan = ownedSdkHandoffPlan(f.input);
  assert.equal(plan.productionReady, false);
  assert.equal(plan.nativeAcceptance, "not-tested");
});
test("capsule schema rejects profile, policy, original-record, namespace and package drift", async () => {
  const mutations = [
    (f) => (f.r.native.native.stages[0].job.rootReaped = false),
    (f) => (f.r.native.native.nativeRecords = 12),
    (f) => (f.r.native.native.finalDeadlineAdmission.verified = false),
    (f) =>
      (f.r.nativeFocusedOutput = f.r.nativeFocusedOutput.replace(
        "[1/36]",
        "[2/36]",
      )),
    (f) =>
      (f.r.nativeBrpOutput = f.r.nativeBrpOutput.replace(
        "BackupRefPtrTest.Basic",
        "BackupRefPtrTest.Unknown",
      )),
    (f) => (f.r.nativeSandboxOutput += "\nRETRY\n"),
    (f) =>
      (f.r.nativeFocusedList = f.r.nativeFocusedList.replace(
        "  CloseReleasesFactoryAndStreamBeforeOwnerDies",
        "  DISABLED_CloseReleasesFactoryAndStreamBeforeOwnerDies",
      )),
    (f) => (f.r.engine.engine.job.activeAtEnd = 1),
    (f) => (f.r.engine.engine.finalDeadlineAdmission.verified = false),
    (f) => (f.r.engine.engine.argv[2] = "-j16"),
    (f) => (f.r.engine.engine.symbols.age = 0),
    (f) => (f.r.package.sourceLockIdentity = "f".repeat(64)),
    (f) => (f.r.package.engineSha256 = "a".repeat(64)),
    (f) => (f.r.build.policy.cpuRate = 10000),
    (f) => (f.r.engineBeforeimage[0].sha256 = "a".repeat(64)),
    (f) => f.lock.patches.push(f.lock.patches[0]),
  ];
  for (const mutate of mutations) {
    const f = await capsuleFixture();
    mutate(f);
    f.seal();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.r, f.lock));
  }
});
test("only capsule engine output gets64MiB allowance; total evidence remains96MiB", async () => {
  const f = await capsuleFixture();
  f.input.evidence.engineOutput.size = 64 * 1024 ** 2;
  assert.doesNotThrow(() => ownedSdkHandoffPlan(f.input));
  f.input.evidence.engineOutput.size++;
  assert.throws(() => ownedSdkHandoffPlan(f.input));
  const g = await capsuleFixture();
  g.input.evidence.nativeFocusedOutput.size = 64 * 1024 ** 2;
  assert.throws(() => ownedSdkHandoffPlan(g.input));
  for (const row of Object.values(g.input.evidence)) row.size = 1024 ** 2;
  g.input.evidence.engineOutput.size = 64 * 1024 ** 2;
  assert.doesNotThrow(() => ownedSdkHandoffPlan(g.input));
  g.input.origin = "owned-windows-incremental-engine";
  assert.throws(() => ownedSdkHandoffPlan(g.input));
});

test("capsule structural archive path preserves source22 and all eighteen original evidence roles", async (t) => {
  const f = await fixture(t, "capsule"),
    result = await checkOwnedSdkHandoff({ ...f, execute: true });
  assert.equal(result.provenance.nativeClassTestsPassed, 42);
  assert.equal(result.provenance.instanceTracerEnabled, false);
  assert.equal(Object.keys(result.reviewBinding.evidencePins).length, 18);
  assert.equal(result.nativeAcceptance, "not-tested");
});
test("capsule original flags/tools and raw evidence cannot be substituted behind re-pinned derived envelopes", async () => {
  for (const mutate of [
    (r) =>
      (r.sourcePostchecks.generatedFlags.rawUtf8 =
        r.sourcePostchecks.generatedFlags.rawUtf8.replace(
          '"macroCount":61',
          '"macroCount":60',
        )),
    (r) =>
      (r.sourcePostchecks.nativeReceipt.rawUtf8 =
        r.sourcePostchecks.nativeReceipt.rawUtf8.replace(
          '"nativePassingRecords":42',
          '"nativePassingRecords":12',
        )),
    (r) =>
      (r.nativeJobs.stageReceipts["sandbox-run"].rawUtf8 =
        r.nativeJobs.stageReceipts["sandbox-run"].rawUtf8.replace(
          '"rootReaped":true',
          '"rootReaped":false',
        )),
  ]) {
    const f = await capsuleFixture();
    mutate(f.r);
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.r, f.lock));
  }
});
test("capsule evidence loader denies invalid UTF8 before any extraction or Python invocation", async (t) => {
  const f = await fixture(t, "capsule"),
    bad = Buffer.from([0xff, 0xfe]);
  f.review.evidence.engineOutput = pin("engineOutput.json", bad);
  await put(f.evidence, "engineOutput.json", bad);
  await assert.rejects(checkOwnedSdkHandoff({ ...f, execute: true }), /UTF8/);
  await assert.rejects(lstat(f.output), { code: "ENOENT" });
});

test("re-pinning a derived envelope never authorizes changed security macros, tools or source records", async () => {
  const mutations = [
    (r) => {
      r.generatedFlags.macros[Object.keys(r.generatedFlags.macros)[0]] ^= 1;
    },
    (r) => {
      r.generatedFlags.actualTool8[0].sha256 = "a".repeat(64);
    },
    (r) => {
      r.nativeReceipt.actualSource9[0].sha256 = "a".repeat(64);
    },
    (r) => {
      r.nativeReceipt.rawManifestSha256 = "a".repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const f = await capsuleFixture();
    const decoded = {
      generatedFlags: JSON.parse(f.r.sourcePostchecks.generatedFlags.rawUtf8),
      nativeReceipt: JSON.parse(f.r.sourcePostchecks.nativeReceipt.rawUtf8),
    };
    mutate(decoded);
    for (const role of ["generatedFlags", "nativeReceipt"]) {
      const rawUtf8 = JSON.stringify(decoded[role]);
      f.r.sourcePostchecks[role] = { rawUtf8, sha256: hash(rawUtf8) };
    }
    const bytes = Buffer.from(JSON.stringify(f.r.sourcePostchecks));
    f.input.evidence.sourcePostchecks = pin("sourcePostchecks.json", bytes);
    f.r.build.recordDigests.sourcePostchecks = hash(bytes);
    f.input.evidence.build = pin(
      "build.json",
      Buffer.from(JSON.stringify(f.r.build)),
    );
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.r, f.lock));
  }
});
test("capsule public derived provenance contains digests and fixed facts without local records or paths", async () => {
  const f = await capsuleFixture(),
    p = verifyOwnedHandoffEvidence(f.input, f.r, f.lock),
    serialized = JSON.stringify(p);
  assert.doesNotMatch(serialized, /rawUtf8|[A-Z]:[\\/]|python|argv|rootPid/);
  assert.equal(
    p.reviewedEvidenceDigests.native,
    f.input.evidence.native.sha256,
  );
  f.input.evidence.engineOutput.size = 64 * 1024 ** 2;
  f.input.evidence.native.size = 17 * 1024 ** 2;
  f.input.evidence.nativeJobs.size = 17 * 1024 ** 2;
  assert.throws(() => ownedSdkHandoffPlan(f.input), /total/);
});

test("large-output verifier returns the bounded hashed stream when its path grows at EOF", async (t) => {
  const f = await fixture(t, "capsule"),
    file = path.join(f.evidence, f.review.evidence.engineOutput.path),
    original = fs.createReadStream;
  let changed = false;
  try {
    fs.createReadStream = (name, ...args) => {
      const stream = original(name, ...args);
      if (name === file)
        stream.once("end", () => {
          fs.writeFileSync(file, Buffer.alloc(65 * 1024 ** 2, 0x20));
          changed = true;
        });
      return stream;
    };
    syncBuiltinESMExports();
    const result = await checkOwnedSdkHandoff({ ...f, execute: true });
    assert.equal(changed, true);
    assert.equal((await lstat(file)).size, 65 * 1024 ** 2);
    assert.equal(
      result.reviewBinding.evidencePins.engineOutput.sha256,
      f.review.evidence.engineOutput.sha256,
    );
    assert.equal(result.productionReady, false);
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
});

test("large-output stream rejects growth beyond reviewed size before retaining the added chunk", async (t) => {
  const f = await fixture(t, "capsule"),
    file = path.join(f.evidence, f.review.evidence.engineOutput.path),
    original = fs.createReadStream;
  let changed = false;
  try {
    fs.createReadStream = (name, ...args) => {
      const stream =
        name === file
          ? original(name, { highWaterMark: 16 })
          : original(name, ...args);
      if (name === file)
        stream.once("data", () => {
          fs.appendFileSync(file, Buffer.alloc(1024, 0x20));
          changed = true;
        });
      return stream;
    };
    syncBuiltinESMExports();
    await assert.rejects(
      checkOwnedSdkHandoff({ ...f, execute: true }),
      /stream bound/,
    );
    assert.equal(changed, true);
    await assert.rejects(lstat(f.output), { code: "ENOENT" });
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
});

// Synthetic schema fixtures only; these records do not assert a genuine engine build.
test("operation2 preserves the failed attempt and validates distinct clock/accounting/Clang", async () => {
  const f = await capsuleFixture(true),
    p = verifyOwnedHandoffEvidence(f.input, f.r, f.lock);
  assert.equal(p.origin, WINDOWS_OPERATION2_ORIGIN);
  assert.equal(p.nativeClassTestsPassed, 42);
  assert.equal(p.engineOperationPolicy.jobs, 12);
  assert.equal(
    p.separatelyObservedClang.sha256,
    WINDOWS_OPERATION2_CLANG.sha256,
  );
  assert.equal(p.engineAccountingDigest, f.r.engineJob.accountingSha256);
  assert.equal(Object.keys(f.input.evidence).length, 20);
});
test("operation2 denies timing, original failure, accounting, compiler, policy and native drift", async () => {
  const changes = [
    (f) => (f.r.engine.operation.previousAttempt.originalSuccess = true),
    (f) => (f.r.engine.operation.actualClang.sha256 = digest),
    (f) => (f.r.engine.operation.argv[2] = "-j8"),
    (f) => (f.r.engineJob.policyReadback.cpuRate = 2000),
    (f) => (f.r.engine.operation.finalDeadlineAdmission.verified = false),
    (f) => (f.r.engine.controllerFinalDeadlineAdmission.verified = false),
    (f) =>
      (f.r.engine.operation.nativePrerequisites.executedInThisOperation = true),
    (f) =>
      (f.r.engine.operation.postVerification.actualClangSeparatelyObserved.verified = false),
    (f) => (f.r.engine.operation.operationDeadlineUtc = "2026-10-25T09:00:00Z"),
    (f) => (f.r.engine.phaseB.auditSha256 = digest),
    (f) => (f.r.engineJob.accountingSha256 = digest),
    (f) => {
      const a = JSON.parse(f.r.engineAccounting);
      a.samples[1].user100ns = 9007199254740992;
      f.r.engineAccounting = JSON.stringify(a);
      f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
    },
    (f) => {
      const a = JSON.parse(f.r.engineAccounting);
      a.samples[1].activeProcesses = 1;
      f.r.engineAccounting = JSON.stringify(a);
      f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
    },
    (f) => {
      const a = JSON.parse(f.r.engineAccounting);
      a.samples.push(a.samples[1]);
      f.r.engineAccounting = JSON.stringify(a);
      f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
    },
    (f) => {
      const a = JSON.parse(f.r.engineAccounting);
      a.utilizationPercent = 30;
      f.r.engineAccounting = JSON.stringify(a);
      f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
    },
    (f) =>
      (f.r.nativeFocusedOutput = f.r.nativeFocusedOutput.replace(
        "SUCCESS",
        "FAILED",
      )),
  ];
  for (const change of changes) {
    const f = await capsuleFixture(true);
    change(f);
    f.seal();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.r, f.lock));
  }
});
test("operation2 per-role and aggregate caps are closed without changing legacy roles", async () => {
  const f = await capsuleFixture(true);
  f.input.evidence.engineAccounting.size = 2 * 1024 ** 2 + 1;
  assert.throws(() => ownedSdkHandoffPlan(f.input));
  const g = await capsuleFixture(true);
  g.input.evidence.previousEngineAttempt.size = 1024 ** 2 + 1;
  assert.throws(() => ownedSdkHandoffPlan(g.input));
  const legacy = await capsuleFixture();
  legacy.input.evidence.engineAccounting = pin("extra.json", Buffer.from("{}"));
  assert.throws(() => ownedSdkHandoffPlan(legacy.input));
});

test("operation2 real archive verifier consumes exact20 roles including original bounded accounting bytes", async (t) => {
  const f = await fixture(t, "operation2"),
    value = await checkOwnedSdkHandoff({ ...f, execute: true });
  assert.equal(value.provenance.origin, WINDOWS_OPERATION2_ORIGIN);
  assert.equal(
    value.provenance.engineAccountingDigest,
    f.review.evidence.engineAccounting.sha256,
  );
  assert.equal(value.nativeAcceptance, "not-tested");
});

test("operation2 small accounting role returns only its bounded hashed bytes after EOF path growth", async (t) => {
  const f = await fixture(t, "operation2"),
    file = path.join(f.evidence, f.review.evidence.engineAccounting.path),
    original = fs.createReadStream;
  let changed = false;
  try {
    fs.createReadStream = (name, ...args) => {
      const stream = original(name, ...args);
      if (name === file)
        stream.once("end", () => {
          fs.writeFileSync(file, Buffer.alloc(3 * 1024 ** 2, 0x20));
          changed = true;
        });
      return stream;
    };
    syncBuiltinESMExports();
    const value = await checkOwnedSdkHandoff({ ...f, execute: true });
    assert.equal(changed, true);
    assert.equal(
      value.provenance.engineAccountingDigest,
      f.review.evidence.engineAccounting.sha256,
    );
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
});
test("operation2 accounting midstream growth is rejected before accepting extra bytes", async (t) => {
  const f = await fixture(t, "operation2"),
    file = path.join(f.evidence, f.review.evidence.engineAccounting.path),
    original = fs.createReadStream;
  let changed = false;
  try {
    fs.createReadStream = (name, ...args) => {
      const stream =
        name === file
          ? original(name, { highWaterMark: 16 })
          : original(name, ...args);
      if (name === file)
        stream.once("data", () => {
          fs.appendFileSync(file, Buffer.alloc(1024, 0x20));
          changed = true;
        });
      return stream;
    };
    syncBuiltinESMExports();
    await assert.rejects(
      checkOwnedSdkHandoff({ ...f, execute: true }),
      /stream bound/,
    );
    assert.equal(changed, true);
    await assert.rejects(lstat(f.output), { code: "ENOENT" });
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
});

test("operation2 malformed original JSON errors expose only a fixed label", async () => {
  const f = await capsuleFixture(true);
  f.r.engineAccounting = "PRIVATE_SENTINEL_NEVER_LOG";
  f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
  f.seal();
  assert.throws(
    () => verifyOwnedHandoffEvidence(f.input, f.r, f.lock),
    (e) =>
      e.message === "Original operation2 JSON invalid" &&
      !e.message.includes("PRIVATE_SENTINEL"),
  );
});

test("operation2 signed CPU and FILETIME bounds reject out-of-domain numeric identities", async () => {
  for (const which of ["cpu", "filetime"]) {
    const f = await capsuleFixture(true);
    if (which === "cpu") {
      const a = JSON.parse(f.r.engineAccounting);
      a.samples[1].user100ns = "9223372036854775808";
      f.r.engineAccounting = JSON.stringify(a);
      f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
    } else f.r.engineJob.rootCreationFiletime = "18446744073709551616";
    f.seal();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.r, f.lock));
  }
});

test("operation2 requires every original engine and phase-query Job success/cleanup field", async () => {
  const mutations = {
    success: false,
    rootExit: 23,
    finalRootExit: 23,
    rootReaped: false,
    cleanupVerified: false,
    activeAtEnd: 1,
    logReadersStopped: false,
    started: false,
    assignedBeforeResume: false,
    resumed: false,
    handleListOnly: false,
    outcome: "compiler-failure",
  };
  for (const role of ["engine", "phaseA", "phaseB"]) {
    for (const [key, value] of Object.entries(mutations)) {
      const f = await capsuleFixture(true),
        job =
          role === "engine" ? f.r.engineJob : f.r.engine[role].capacityQueryJob;
      job[key] = value;
      job.compilerOutcome = "success";
      f.seal();
      assert.throws(
        () => verifyOwnedHandoffEvidence(f.input, f.r, f.lock),
        undefined,
        `${role}/${key}`,
      );
    }
  }
});
test("operation2 denies contradictory audit rows, foreign roots and pre-operation observations", async () => {
  for (const phase of ["phaseA", "phaseB"]) {
    for (const mode of [
      "blocking-row",
      "wrong-source",
      "wrong-depot",
      "old-capacity",
      "old-audit",
    ]) {
      const f = await capsuleFixture(true),
        records = f.r.build.operationEvidence.phaseRecords[phase],
        role = mode === "old-capacity" ? "capacity" : "audit",
        raw = JSON.parse(records[role].rawUtf8);
      if (mode === "blocking-row") raw.rows = [{ blocks: true }];
      else if (mode === "wrong-source") raw.sourceRoot = "F:/foreign";
      else if (mode === "wrong-depot") raw.depotRoot = "F:/foreign";
      else raw.observedAtUtc = "2026-10-24T00:00:00Z";
      records[role].rawUtf8 = JSON.stringify(raw);
      records[role].sha256 = hash(records[role].rawUtf8);
      f.r.engine[phase][role + "Sha256"] = records[role].sha256;
      f.seal();
      assert.throws(
        () => verifyOwnedHandoffEvidence(f.input, f.r, f.lock),
        undefined,
        `${phase}/${mode}`,
      );
    }
  }
});
test("operation2 first periodic sample waits a full interval from the initial sample", async () => {
  const f = await capsuleFixture(true),
    a = JSON.parse(f.r.engineAccounting);
  a.samples.splice(1, 0, { ...a.samples[0], role: "sample", elapsedMs: 1 });
  f.r.engineAccounting = JSON.stringify(a);
  f.r.engineJob.accountingSha256 = hash(f.r.engineAccounting);
  f.seal();
  assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.r, f.lock));
});
test("synthetic coherent records exercise schema only, not independent execution authenticity", async () => {
  const f = await capsuleFixture(true);
  assert.notEqual(
    f.r.previousEngineAttempt.originalManifest.sha256,
    "782c4521a099a7f3a79beecda15f9ca42c5cfe2aa743e134d139613779806def",
  );
  assert.notEqual(
    f.r.previousEngineAttempt.originalReceipt.sha256,
    "0c5fc37f54887576b45d474374137e6b935b282224dc9e0e84fffd04fc6309ea",
  );
  const p = verifyOwnedHandoffEvidence(f.input, f.r, f.lock);
  assert.equal(p.originalBuildReplayed, false);
  assert.equal(ownedSdkHandoffPlan(f.input).nativeAcceptance, "not-tested");
  // Genuine use separately requires operator review of actual source and782c/0c5/new Job/raw accounting before a committed review/import/API. A self-declared digest is not attestation.
});

test("all operation2 nontext metadata rejects actual repinned invalid UTF8 before output", async (t) => {
  const f = await fixture(t, "operation2"),
    role = "engineJob",
    bytes = Buffer.concat([
      Buffer.from('{"sentinel":"PRIVATE_SENTINEL_'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
  const file = path.join(f.evidence, f.review.evidence[role].path);
  await writeFile(file, bytes);
  f.review.evidence[role] = {
    ...f.review.evidence[role],
    size: bytes.length,
    sha256: hash(bytes),
  };
  await assert.rejects(
    checkOwnedSdkHandoff({ ...f, execute: true }),
    (error) =>
      error.message === "Bounded UTF8 original metadata required" &&
      !error.message.includes("PRIVATE_SENTINEL"),
  );
  await assert.rejects(lstat(f.output), { code: "ENOENT" });
});

// Entire fixture is synthetic schema evidence; no incremental engine was run.
function linuxIncrementalFixture() {
  const lock = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "native/cef-build-inputs/20261025-registration-retirement-owned-linux-x64-default-colormap/source-lock.json",
        ),
      ),
    ),
    wrap = (x) => {
      const rawUtf8 = JSON.stringify(x);
      return {
        rawUtf8,
        size: Buffer.byteLength(rawUtf8),
        sha256: hash(rawUtf8),
      };
    },
    old = linuxRecords(),
    oldInput = review("owned-linux-engine");
  oldInput.evidence = Object.fromEntries(
    Object.entries(old).map(([name, row]) => [
      name,
      pin(name + ".json", Buffer.from(JSON.stringify(row))),
    ]),
  );
  const oldHandoff = {
    kind: "sorng-cef-owned-sdk-handoff",
    sourceLockIdentity: identitySha256(linuxLock),
    hostedBuild: false,
    nativeAcceptance: "not-tested",
    productionReady: false,
    publicationAllowed: false,
    uploadAllowed: false,
    descriptorSha256: oldInput.descriptorSha256,
    engineSha256: "1".repeat(64),
    reviewBinding: ownedHandoffReviewBinding(oldInput),
  };
  const oldManifest = {
    schemaVersion: 1,
    kind: "sorng-cef-custom-runtime",
    sourceLockSha256: identitySha256(linuxLock),
    artifacts: [
      {
        target: "x86_64-unknown-linux-gnu",
        sdkFiles: [
          {
            path: "libcef.so",
            type: "file",
            size: 1,
            sha256: oldHandoff.engineSha256,
          },
          {
            path: "chrome-sandbox",
            type: "file",
            size: 1,
            sha256: "2".repeat(64),
          },
        ],
      },
    ],
  };
  Object.assign(oldHandoff, {
    schemaVersion: 1,
    target: "x86_64-unknown-linux-gnu",
    originalInputsSourceLockRawSha256: hash(linuxLockBytes),
    filesVerified: 2,
    assets: [
      "runtime.json",
      "source-lock.json",
      "manifest.json",
      "receipt.json",
      "old.tar.bz2",
    ].map((name) => ({
      name,
      size: name === "manifest.json" ? wrap(oldManifest).size : 1,
      sha256:
        name === "manifest.json"
          ? wrap(oldManifest).sha256
          : name === "runtime.json"
            ? oldInput.descriptorSha256
            : "2".repeat(64),
    })),
  });
  const op = "a0000000-0000-4000-8000-000000000000",
    ctl = "a".repeat(40),
    sha = "2".repeat(64),
    fakePin = (name, sh = sha, size = 1) => ({ path: name, sha256: sh, size }),
    sourcePath = "cef/libcef/browser/native/window_x11.cc",
    before = fakePin(
      sourcePath,
      "0ccac4e8f1f8371e42bec473e2b60016f4f68370c3e072d7e44f42c50da3303a",
    ),
    after = fakePin(
      sourcePath,
      "d624ed223238b3b999e85a994be5a3c1340dd87ce64e3d60094e7c87e4dbd19d",
    ),
    kernel = {
      uid: 10001,
      gid: 10001,
      readonlyRoot: true,
      networkMode: "none",
      memory: 24 * 1024 ** 3,
      memorySwap: 24 * 1024 ** 3,
      nanoCpus: 8e9,
      pids: 512,
      capDrop: ["ALL"],
      noNewPrivileges: true,
      mountsVerified: true,
      diskFreeBytes: 200 * 1024 ** 3,
      diskMinimumBytes: 100 * 1024 ** 3,
      homeVerified: true,
      home: {
        uid: 10001,
        gid: 10001,
        mode: 0o700,
        mountAndAliasVerified: true,
        privateCacheWriteVerified: true,
      },
    },
    cache = "/work/build/cef-ci-qTkJO9/source/src",
    img =
      "sha256:5c3e8c42ac5a58ca0ec31df6dfc45d57af3c663ed53b8e4d7171e18f31480930",
    volume =
      "sorng-cef-preflight-20261023-6f4466b3-0e90-4275-b19a-57470e8f8af5-work",
    tools = structuredClone(LINUX_INCREMENTAL_TOOL_PINS),
    extra = Object.fromEntries(
      [
        "clang",
        "ldLld",
        "gn",
        "siso",
        "autoninja",
        "clangStamp",
        "sisoSpecification",
      ].map((x) => [x, fakePin(x)]),
    ),
    args = fakePin(
      "out/Release_GN_x64/args.gn",
      "80533e918b63db1e7696d910c8292d7cfbbd042506f53fed03f2100327061286",
    ),
    macros = [
      { name: "ENABLE_BACKUP_REF_PTR_INSTANCE_TRACER", value: 0 },
      { name: "ENABLE_DANGLING_RAW_PTR_CHECKS", value: 1 },
    ],
    output = "build finished\nnoexec:0 local:1 remote:0 cache:0 skip:1\n",
    engine = fakePin("libcef.so", "3".repeat(64)),
    sandbox = fakePin("chrome-sandbox"),
    assets = [
      "runtime.json",
      "source-lock.json",
      "manifest.json",
      "receipt.json",
      `sorng-cef-custom-${LINUX_INCREMENTAL_IDENTITY}-x86_64-unknown-linux-gnu.tar.bz2`,
    ].map((name) => ({ name, size: 1, sha256: sha }));
  const f = {
    predecessor: {
      sourceLock: {
        rawUtf8: linuxLockBytes.toString(),
        size: linuxLockBytes.length,
        sha256: hash(linuxLockBytes),
      },
      review: wrap(oldInput),
      handoff: wrap(oldHandoff),
      manifest: wrap(oldManifest),
      records: Object.fromEntries(
        Object.entries(old).map(([key, row]) => [key, wrap(row)]),
      ),
    },
    readiness: {
      exclusiveCache: true,
      cacheOutputs: {
        engine: fakePin("libcef.so", oldHandoff.engineSha256),
        sandbox: fakePin("chrome-sandbox"),
      },
      image: img,
      volume,
      cacheRoot: cache,
      sourceBefore: LINUX_INCREMENTAL_SOURCE_PATHS.map((name) =>
        name === sourcePath ? before : fakePin(name),
      ),
      toolFiles: tools,
      extraTools: extra,
      args,
      graph: fakePin("out/Release_GN_x64/build.ninja"),
      securityMacros: macros,
      securityHeader: fakePin("out/Release_GN_x64/gen/buildflags.h"),
      kernel,
      upstream: lock.upstream,
      reconstruction: {
        method: "git-pristine-plus-reviewed-old12",
        oldPatchPins: linuxLock.patches,
        verifiedSourcePins: LINUX_INCREMENTAL_SOURCE_PATHS.map((name) =>
          name === sourcePath ? before : fakePin(name),
        ),
      },
    },
    apply: {
      patch: fakePin(
        lock.patches.at(-1).path,
        lock.patches.at(-1).sha256,
        1073,
      ),
      before,
      after,
      onlyReviewedPatchApplied: true,
    },
    started: {
      startWallMs: 1000,
      startMonotonicMs: 1000,
      compileDeadlineWallMs: 3601000,
      compileBudgetMs: 3600000,
      cleanupBudgetMs: 30000,
      packagingBudgetMs: 900000,
      controllerPins: {
        controller: fakePin("controller.mjs"),
        guest: fakePin("guest.py"),
      },
      replayAllowed: false,
    },
    container: {
      id: sha,
      name: `/sorng-cef-linux-incremental-${op}`,
      image: img,
      volume,
      kernel,
    },
    compile: {
      argv: [
        "/work/tools/usr/bin/python3.12",
        "/work/build/cef-ci-qTkJO9/source/depot_tools/autoninja.py",
        "-j",
        "8",
        "-C",
        "out/Release_GN_x64",
        "cef",
        "chrome_sandbox",
      ],
      cwd: cache,
      beginWallMs: 1100,
      endWallMs: 1200,
      beginMonotonicMs: 1100,
      endMonotonicMs: 1200,
      elapsedMs: 100,
      exit: 0,
      outputSha256: hash(output),
      outputBytes: Buffer.byteLength(output),
      localSteps: 1,
      finished: true,
    },
    finished: {
      containerId: sha,
      reason: "completed",
      exit: 0,
      quiescent: true,
      processesLeft: 0,
      readersStopped: true,
      logFailure: false,
      cleanupElapsedMs: 1,
    },
    postchecks: {
      sourceAfter: LINUX_INCREMENTAL_SOURCE_PATHS.map((name) =>
        name === sourcePath ? after : fakePin(name),
      ),
      toolFiles: tools,
      extraTools: extra,
      args,
      securityMacros: macros,
      securityHeader: fakePin("out/Release_GN_x64/gen/buildflags.h"),
      upstream: lock.upstream,
      compileSha256: "",
      engine,
      sandbox,
    },
    package: {
      descriptorSha256: sha,
      originalInputsSourceLockRawSha256:
        "3f92807b495eaac55ad415fecbc423fc8763cc0024cb41be89efc5feabcbef23",
      sourceLockIdentity: LINUX_INCREMENTAL_IDENTITY,
      engine,
      sandbox,
      sdkFiles: 10,
      assets,
      beginWallMs: 1300,
      endWallMs: 1600,
      elapsedMs: 300,
    },
    distribution: {
      argv: [
        "/work/tools/usr/bin/python3.12",
        "tools/make_distrib.py",
        "--output-dir",
        `/work/linux-incremental-${op}/distribution`,
        "--ninja-build",
        "--x64-build",
        "--minimal",
        "--allow-partial",
        "--no-archive",
        "--no-docs",
      ],
      cwd: cache + "/cef",
      exit: 0,
      elapsedMs: 100,
      inventorySha256: sha,
      filesVerified: 10,
      quiescent: true,
      outputsFresh: true,
    },
    preparation: {
      method: "prepareCustomRuntime+verifyPreparedCustomRuntime",
      exit: 0,
      elapsedMs: 100,
      inventorySha256: sha,
      filesVerified: 10,
      quiescent: true,
      outputsFresh: true,
      archiveRoundtrip: true,
      elfMachine: "ELF64-x86-64",
      bridgeExports: 4,
    },
  };
  const records = Object.fromEntries(
    Object.entries(f).map(([role, facts]) => [
      role,
      {
        schemaVersion: 1,
        kind: `sorng-owned-linux-incremental-${role}`,
        operation: op,
        controllerCommit: ctl,
        sourceLockIdentity: LINUX_INCREMENTAL_IDENTITY,
        target: "x86_64-unknown-linux-gnu",
        facts,
      },
    ]),
  );
  records.compileOutput = output;
  const evidence = () =>
    Object.fromEntries(
      LINUX_INCREMENTAL_EVIDENCE.map((name) => [
        name,
        pin(
          name + (name === "compileOutput" ? ".log" : ".json"),
          Buffer.from(
            name === "compileOutput"
              ? records[name]
              : JSON.stringify(records[name]),
          ),
        ),
      ]),
    );
  records.postchecks.facts.compileSha256 = evidence().compile.sha256;
  const input = {
    ...review("owned-linux-engine"),
    origin: LINUX_INCREMENTAL_ORIGIN,
    sourceLockIdentity: LINUX_INCREMENTAL_IDENTITY,
    descriptorSha256: sha,
    evidence: evidence(),
  };
  return { input, records, lock, f };
}

// Synthetic records exercise the closed schema and raw relationships. They do
// not represent an observed workspace, compilation, SDK, or native acceptance.
const originalIsolatedPolicy = {
  origin: LINUX_ISOLATED_ORIGIN,
  identity: LINUX_ISOLATED_IDENTITY,
  raw: LINUX_ISOLATED_INPUT_RAW,
  transition: LINUX_ISOLATED_TRANSITION,
};
function linuxIsolatedFixture(external = false) {
  const LINUX_ISOLATED_ORIGIN = external
      ? LINUX_EXTERNAL_WEBVIEW_ORIGIN
      : originalIsolatedPolicy.origin,
    LINUX_ISOLATED_IDENTITY = external
      ? LINUX_EXTERNAL_WEBVIEW_IDENTITY
      : originalIsolatedPolicy.identity,
    LINUX_ISOLATED_INPUT_RAW = external
      ? LINUX_EXTERNAL_WEBVIEW_INPUT_RAW
      : originalIsolatedPolicy.raw,
    LINUX_ISOLATED_TRANSITION = external
      ? LINUX_EXTERNAL_WEBVIEW_TRANSITION
      : originalIsolatedPolicy.transition;
  const f = linuxIncrementalFixture(),
    r = f.records,
    op = r.readiness.operation,
    ctl = r.readiness.controllerCommit,
    img = r.readiness.facts.image,
    volume = `sorng-cef-linux-isolated-${op}-work`,
    cache = "/work/build/cef-ci-qTkJO9/source/src",
    sha = "2".repeat(64),
    wrap = (x) => {
      const rawUtf8 = JSON.stringify(x);
      return {
        rawUtf8,
        size: Buffer.byteLength(rawUtf8),
        sha256: hash(rawUtf8),
      };
    },
    fp = (path, sha256 = sha, size = 1) => ({ path, sha256, size });
  for (const [role, row] of Object.entries(r))
    if (role !== "compileOutput")
      row.kind = `sorng-owned-linux-isolated-${role}`;
  const present = (rows) =>
    rows
      .filter((x) => x.kind === "file")
      .map(({ kind, ...row }) => structuredClone(row));
  r.readiness.facts.sourceBefore = present(LINUX_ISOLATED_TRANSITION.before);
  r.readiness.facts.reconstruction.verifiedSourcePins = present(
    LINUX_ISOLATED_TRANSITION.before,
  );
  r.postchecks.facts.sourceAfter = present(LINUX_ISOLATED_TRANSITION.after);
  f.lock = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        external
          ? "native/cef-build-inputs/20261026-r5-owned-linux-x64-external-webview/source-lock.json"
          : "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap/source-lock.json",
      ),
    ),
  );
  r.apply.facts = {
    patches: structuredClone(f.lock.patches.slice(12)),
    before: structuredClone(LINUX_ISOLATED_TRANSITION.before),
    after: structuredClone(LINUX_ISOLATED_TRANSITION.after),
    onlyReviewedPatchesApplied: true,
  };
  r.preparation.facts.bridgeExports = 5;
  r.distribution.facts.argv[3] =
    LINUX_ISOLATED_OPERATION_ROOT + "/distribution";
  for (const row of Object.values(r))
    if (typeof row === "object")
      row.sourceLockIdentity = LINUX_ISOLATED_IDENTITY;
  r.package.facts.sourceLockIdentity = LINUX_ISOLATED_IDENTITY;
  r.package.facts.originalInputsSourceLockRawSha256 = LINUX_ISOLATED_INPUT_RAW;
  r.package.facts.assets.forEach((row) => {
    row.name = row.name.replaceAll(
      LINUX_INCREMENTAL_IDENTITY,
      LINUX_ISOLATED_IDENTITY,
    );
  });
  f.input.sourceLockIdentity = LINUX_ISOLATED_IDENTITY;
  r.readiness.facts.args.size = 646;
  r.postchecks.facts.args.size = 646;
  const envelope = (role, facts) => ({
    schemaVersion: 1,
    kind: `sorng-owned-linux-isolated-${role}`,
    operation: op,
    controllerCommit: ctl,
    sourceLockIdentity: LINUX_ISOLATED_IDENTITY,
    target: f.input.target,
    facts,
  });
  const copyEntry = (path, sha256 = sha, size = 1, index = 1) => ({
    tree: "out",
    path,
    size,
    sha256,
    mode: 420,
    mtimeNs: "1000",
    sourceDev: "1",
    sourceIno: String(index),
    targetDev: "2",
    targetIno: String(index + 100),
    sourceNlink: 1,
    targetNlink: 1,
  });
  const object = "obj/cef/libcef_static/window_x11.o";
  const entries = [
    copyEntry("libcef.so", "1".repeat(64), 1, 1),
    copyEntry("chrome_sandbox", sha, 1, 2),
    copyEntry("build.ninja", sha, 1, 3),
    copyEntry("args.gn", r.readiness.facts.args.sha256, 646, 4),
    copyEntry(object, "3".repeat(64), 1, 5),
  ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const selected = (path) =>
    path.startsWith("base/")
      ? ["base", path.slice(5)]
      : path.startsWith("net/")
        ? ["net", path.slice(4)]
        : path.startsWith("services/network/")
          ? ["network", path.slice(17)]
          : null;
  for (const [i, row] of LINUX_ISOLATED_TRANSITION.before.entries()) {
    const loc = selected(row.path);
    if (row.kind === "file" && loc)
      entries.push({
        ...copyEntry(loc[1], row.sha256, row.size, i + 100),
        tree: loc[0],
      });
  }
  entries.sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.tree + "/" + a.path),
      Buffer.from(b.tree + "/" + b.path),
    ),
  );
  const directoryMap = new Map();
  for (const row of entries) {
    const parts = row.path.split("/");
    parts.pop();
    while (parts.length) {
      const name = parts.join("/");
      directoryMap.set(row.tree + "/" + name, {
        tree: row.tree,
        path: name,
        mode: 493,
        uid: 10001,
        gid: 10001,
      });
      parts.pop();
    }
  }
  const directories = [...directoryMap.values()].sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.tree + "/" + a.path),
      Buffer.from(b.tree + "/" + b.path),
    ),
  );
  const sourceRoots = {
    base: "base",
    net: "net",
    network: "services/network",
    out: "out/Release_GN_x64",
  };
  const trees = Object.fromEntries(
    LINUX_ISOLATED_COPY_TREES.map((tree) => {
      const files = entries.filter((x) => x.tree === tree),
        dirs = directories.filter((x) => x.tree === tree);
      return [
        tree,
        {
          sourceRoot:
            cache.replace("/work/", "/opt/original-cache/") +
            "/" +
            sourceRoots[tree],
          targetRoot: cache + "/" + sourceRoots[tree],
          files: files.length,
          bytes: files.reduce((n, x) => n + x.size, 0),
          directories: dirs.length,
          inventorySha256: identitySha256({ files, directories: dirs }),
        },
      ];
    }),
  );
  const manifest = {
    trees,
    limits: {
      files: 500000,
      directories: 100000,
      bytes: 256 * 1024 ** 3,
      fileBytes: 8 * 1024 ** 3,
      pathBytes: 1024,
    },
    entries,
    directories,
    bytes: entries.reduce((n, x) => n + x.size, 0),
    files: entries.length,
    inventorySha256: identitySha256(entries),
    complete: true,
    unknownLinks: 0,
    independentFiles: true,
  };
  r.copyManifest = envelope("copyManifest", manifest);
  const mounts = [
    {
      type: "volume",
      source: r.readiness.facts.volume,
      target: "/work",
      readonly: true,
      subpath: "",
    },
    {
      type: "volume",
      source: r.readiness.facts.volume,
      target: "/opt/original-cache",
      readonly: true,
      subpath: "",
    },
    ...[
      ["base", cache + "/base"],
      ["net", cache + "/net"],
      ["network", cache + "/services/network"],
      ["cef", cache + "/cef"],
      ["out", cache + "/out/Release_GN_x64"],
      ["operation", LINUX_ISOLATED_OPERATION_ROOT],
    ].map(([subpath, target]) => ({
      type: "volume",
      source: volume,
      target,
      readonly: false,
      subpath,
    })),
  ];
  const initInspect = {
    Id: "4".repeat(64),
    Name: `/sorng-cef-linux-isolated-init-${op}`,
    Image: img,
    Config: {
      User: "0:0",
      Labels: { "com.sortofremoteng.isolated.operation": op },
      Entrypoint: ["/usr/bin/python3"],
      Cmd: ["-I", "-B", "-c", linuxIsolatedInitCode(op)],
    },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: ["CAP_CHOWN"],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: 16,
      NanoCpus: 1e9,
      Memory: 64 * 1024 ** 2,
      MemorySwap: 64 * 1024 ** 2,
      Privileged: false,
    },
    State: { Running: false, ExitCode: 0 },
    Mounts: [{ Type: "volume", Name: volume, Destination: "/owned", RW: true }],
  };
  const init = {
    id: initInspect.Id,
    name: initInspect.Name,
    inspect: wrap(initInspect),
    result: {
      operation: op,
      volume,
      directories: LINUX_ISOLATED_INIT_ROOTS.map((name, i) => ({
        name,
        dev: "2",
        ino: String(i + 1000),
        uid: 10001,
        gid: 10001,
        mode: 448,
      })),
    },
    exit: 0,
    quiescent: true,
  };
  r.workspace = envelope("workspace", {
    originalVolume: r.readiness.facts.volume,
    workspaceVolume: volume,
    originalReadonly: true,
    independentCopies: true,
    createdFresh: true,
    init,
    mounts,
    copyManifestSha256: "",
    copyFiles: manifest.files,
    copyBytes: manifest.bytes,
    copyDirectories: directories.length,
    startWallMs: 100,
    startMonotonicMs: 100,
    workDeadlineWallMs: 7800100,
    workBudgetMs: 7800000,
    cleanupBudgetMs: 30000,
    copyBudgetMs: 1800000,
    generationBudgetMs: 600000,
    gnBudgetMs: 900000,
    capacityBeforeBytes: manifest.bytes + 108 * 1024 ** 3,
    capacityAfterBytes: 108 * 1024 ** 3,
    diskMinimumBytes: 100 * 1024 ** 3,
    beginWallMs: 100,
    endWallMs: 200,
    elapsedMs: 100,
  });
  const inspected = {
    Id: r.container.facts.id,
    Name: `/sorng-cef-linux-isolated-${op}`,
    Image: img,
    Config: {
      User: "10001:10001",
      Labels: { "com.sortofremoteng.isolated.operation": op },
      Entrypoint: ["/usr/bin/python3"],
      Cmd: [
        "-I",
        "-B",
        "/opt/incremental/guest.py",
        "--execute-isolated-incremental",
      ],
    },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Memory: 24 * 1024 ** 3,
      MemorySwap: 24 * 1024 ** 3,
      NanoCpus: 8e9,
      PidsLimit: 512,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      Mounts: mounts.map((m) => ({
        Type: "volume",
        Source: m.source,
        Target: m.target,
        ReadOnly: m.readonly,
        VolumeOptions: {
          NoCopy: true,
          ...(m.subpath ? { Subpath: m.subpath } : {}),
        },
      })),
    },
    Mounts: mounts.map((m) => ({
      Type: "volume",
      Name: m.source,
      Destination: m.target,
      RW: !m.readonly,
    })),
  };
  for (const destination of [
    "/opt/context",
    "/opt/incremental",
    "/opt/producer/checkout",
  ]) {
    inspected.Mounts.push({
      Type: "bind",
      Source: "/owned-fixture",
      Destination: destination,
      RW: false,
    });
    inspected.HostConfig.Mounts.push({
      Type: "bind",
      Source: "/owned-fixture",
      Target: destination,
      ReadOnly: true,
    });
  }
  r.container.facts.name = inspected.Name;
  r.container.facts.inspect = wrap(inspected);
  const apiCached = Buffer.from(
      "ewogICJoYXNoZXMiOiB7CiAgICAiOTk5OTk4IjogewogICAgICAiY29tbWVudCI6ICJOZXh0IHZlcnNpb24gbGFzdCB1cGRhdGVkIE9jdG9iZXIgMjQsIDIwMjYuIiwKICAgICAgImxpbnV4IjogIjVjODM0NGFlN2Q3ZjY0MjFiYzgwMTQwMWUzNWQ0ZGJmNmQzOGUxMDEiLAogICAgICAibWFjIjogImU1Y2QyODA0N2ZjMWY4YmJiOTcyZTU0NjkyZmM2NjUwNDBjN2YwMzQiLAogICAgICAic2FuZGJveF9jb21wYXQiOiAiMjY1ZmNhOTI5M2U2YjZlZiIsCiAgICAgICJ3aW5kb3dzIjogIjcyNmRjNzM3NjNkYjIyZWRiMjg5ZTQxYWYyNDIxYTIzMjYxN2Y3ZjQiCiAgICB9LAogICAgIjk5OTk5OSI6IHsKICAgICAgImNvbW1lbnQiOiAiRXhwZXJpbWVudGFsIHZlcnNpb24gbGFzdCB1cGRhdGVkIE9jdG9iZXIgMjQsIDIwMjYuIiwKICAgICAgImxpbnV4IjogIjQ4ODU0ODUwOTk4MTAzMTQzM2FmMjJhZjA1YzliNTllNmYwNzg4YTkiLAogICAgICAibWFjIjogImEwNzUxZTA1ZDYyZWIwYjU1MDAwYmI5M2VkNDQ5YzM5NTgyODY4NGUiLAogICAgICAic2FuZGJveF9jb21wYXQiOiAiMjY1ZmNhOTI5M2U2YjZlZiIsCiAgICAgICJ3aW5kb3dzIjogImYxNGQyMGE1YjVmMmM4OWU3ZmU5M2RlMjhiNjAyNzhiMzgzMDBmODQiCiAgICB9CiAgfQp9",
      "base64",
    ),
    headerCached = Buffer.from(
      "Ly8gQ29weXJpZ2h0IChjKSAyMDI2IE1hcnNoYWxsIEEuIEdyZWVuYmxhdHQuIEFsbCByaWdodHMgcmVzZXJ2ZWQuCi8vCi8vIFJlZGlzdHJpYnV0aW9uIGFuZCB1c2UgaW4gc291cmNlIGFuZCBiaW5hcnkgZm9ybXMsIHdpdGggb3Igd2l0aG91dAovLyBtb2RpZmljYXRpb24sIGFyZSBwZXJtaXR0ZWQgcHJvdmlkZWQgdGhhdCB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnMgYXJlCi8vIG1ldDoKLy8KLy8gICAgKiBSZWRpc3RyaWJ1dGlvbnMgb2Ygc291cmNlIGNvZGUgbXVzdCByZXRhaW4gdGhlIGFib3ZlIGNvcHlyaWdodAovLyBub3RpY2UsIHRoaXMgbGlzdCBvZiBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIuCi8vICAgICogUmVkaXN0cmlidXRpb25zIGluIGJpbmFyeSBmb3JtIG11c3QgcmVwcm9kdWNlIHRoZSBhYm92ZQovLyBjb3B5cmlnaHQgbm90aWNlLCB0aGlzIGxpc3Qgb2YgY29uZGl0aW9ucyBhbmQgdGhlIGZvbGxvd2luZyBkaXNjbGFpbWVyCi8vIGluIHRoZSBkb2N1bWVudGF0aW9uIGFuZC9vciBvdGhlciBtYXRlcmlhbHMgcHJvdmlkZWQgd2l0aCB0aGUKLy8gZGlzdHJpYnV0aW9uLgovLyAgICAqIE5laXRoZXIgdGhlIG5hbWUgb2YgR29vZ2xlIEluYy4gbm9yIHRoZSBuYW1lIENocm9taXVtIEVtYmVkZGVkCi8vIEZyYW1ld29yayBub3IgdGhlIG5hbWVzIG9mIGl0cyBjb250cmlidXRvcnMgbWF5IGJlIHVzZWQgdG8gZW5kb3JzZQovLyBvciBwcm9tb3RlIHByb2R1Y3RzIGRlcml2ZWQgZnJvbSB0aGlzIHNvZnR3YXJlIHdpdGhvdXQgc3BlY2lmaWMgcHJpb3IKLy8gd3JpdHRlbiBwZXJtaXNzaW9uLgovLwovLyBUSElTIFNPRlRXQVJFIElTIFBST1ZJREVEIEJZIFRIRSBDT1BZUklHSFQgSE9MREVSUyBBTkQgQ09OVFJJQlVUT1JTCi8vICJBUyBJUyIgQU5EIEFOWSBFWFBSRVNTIE9SIElNUExJRUQgV0FSUkFOVElFUywgSU5DTFVESU5HLCBCVVQgTk9UCi8vIExJTUlURUQgVE8sIFRIRSBJTVBMSUVEIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORCBGSVRORVNTIEZPUgovLyBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBUkUgRElTQ0xBSU1FRC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIENPUFlSSUdIVAovLyBPV05FUiBPUiBDT05UUklCVVRPUlMgQkUgTElBQkxFIEZPUiBBTlkgRElSRUNULCBJTkRJUkVDVCwgSU5DSURFTlRBTCwKLy8gU1BFQ0lBTCwgRVhFTVBMQVJZLCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgKElOQ0xVRElORywgQlVUIE5PVAovLyBMSU1JVEVEIFRPLCBQUk9DVVJFTUVOVCBPRiBTVUJTVElUVVRFIEdPT0RTIE9SIFNFUlZJQ0VTOyBMT1NTIE9GIFVTRSwKLy8gREFUQSwgT1IgUFJPRklUUzsgT1IgQlVTSU5FU1MgSU5URVJSVVBUSU9OKSBIT1dFVkVSIENBVVNFRCBBTkQgT04gQU5ZCi8vIFRIRU9SWSBPRiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlQKLy8gKElOQ0xVRElORyBORUdMSUdFTkNFIE9SIE9USEVSV0lTRSkgQVJJU0lORyBJTiBBTlkgV0FZIE9VVCBPRiBUSEUgVVNFCi8vIE9GIFRISVMgU09GVFdBUkUsIEVWRU4gSUYgQURWSVNFRCBPRiBUSEUgUE9TU0lCSUxJVFkgT0YgU1VDSCBEQU1BR0UuCi8vCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQovLwovLyBUaGlzIGZpbGUgd2FzIGdlbmVyYXRlZCBieSB0aGUgbWFrZV9hcGlfdmVyc2lvbnNfaGVhZGVyLnB5IHRvb2wuIFZlcnNpb25zCi8vIGFyZSBtYW5hZ2VkIHVzaW5nIHRoZSB2ZXJzaW9uX21hbmFnZXIucHkgdG9vbC4gRm9yIHVzYWdlIGRldGFpbHMgc2VlCi8vIGh0dHBzOi8vY2hyb21pdW1lbWJlZGRlZC5naXRodWIuaW8vY2VmL2FwaV92ZXJzaW9uaW5nCi8vCgojaWZuZGVmIENFRl9JTkNMVURFX0NFRl9BUElfVkVSU0lPTlNfSF8KI2RlZmluZSBDRUZfSU5DTFVERV9DRUZfQVBJX1ZFUlNJT05TX0hfCgojaW5jbHVkZSAiaW5jbHVkZS9iYXNlL2NlZl9idWlsZC5oIgoKLy8gQWRkZWQgRmVicnVhcnkgMjEsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzMzAwIDEzMzAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDAgIjQ1ZDM5YzM2NjliYTc1NDY3ZTNlNjA5ZjYyNmMzMTUwNmMwZWFlMjIiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzMwMCAiODBjMGI1OWJhOWRkNzgzYWE3MWZhZTBhYTVmN2RhZDY0NjIwZThjOSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDAgIjI1MDhmM2YwYjBlNWRmYTE5MTAzNmZhNmMwNGY4ZGNmYTE4Yzk0YjkiCiNlbmRpZgoKLy8gQWRkZWQgRmVicnVhcnkgMjEsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzMzAxIDEzMzAxCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDEgIjcxMDk3MDIwMzhkNTE1MTJkMzVkZDJlZDc3MjMxZjkxMDBlMzgyMTQiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzMwMSAiZmRhNDBhNWRmNDQ2MjhjYWM1MGE1ODlmZjk3OWMwNzQ2MDExNTkxZSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDEgImFhMDczZGQxYzU4NjgxMjUwM2NhMjkzYzcxODM1ODQ2MGQ4YzJkZDYiCiNlbmRpZgoKLy8gQWRkZWQgRmVicnVhcnkgMjEsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzMzAyIDEzMzAyCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDIgIjE4Nzk5OTYxZjQ0NjFhOWNiYWUyYWVkODlhYzA0YjczYWI3YzM3ZjMiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzMwMiAiNGFhMjQ0NzBiYTNhNGJkOWMwNmJjMGU0YTIwMWI4OTYzOTRhODZiNSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDIgImQ1NTk3ZWJmYTMwMDgxOTUzNDI1ZTg5NzIwOWE4Mzg3Yjk1ODQyMDUiCiNlbmRpZgoKLy8gQWRkZWQgRmVicnVhcnkgMjEsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzMzAzIDEzMzAzCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDMgIjIwMDE2ZmQ2YTliODdlZjRjNTM5Y2QxZjQyYmYxY2EwOWI2OTAzY2EiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzMwMyAiZjJjZGNlMmI5YTRiNjM1YzI4YjViOTJjNDJjMzU2MjVhOTM3MzgwYyIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDMgImYzYTY5NmVlMzBjZTFlMDA0OTBhNThkZjAxNzM5M2MxMjZjODk3MDkiCiNlbmRpZgoKLy8gQWRkZWQgRmVicnVhcnkgMjEsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzMzA0IDEzMzA0CiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDQgIjE5YzAxNGFmMDA4MmFhOTAxMzk4ZTAwNjM4MWI2OTgwZTRmODA2ZTkiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzMwNCAiOTg5NjRjMzdiODkxN2Q4M2RhNGIxNzNlMjI5MDU1MDNkMzhhZDA4ZiIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTMzMDQgImYxYWJhYmI0ZmY1MWVjYmY3N2M0ODFjZWUzNzIxZWYwZWNhOWM4Y2EiCiNlbmRpZgoKLy8gQWRkZWQgRmVicnVhcnkgMjEsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzNDAwIDEzNDAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM0MDAgIjZhYjc0YjkwZTg4YjczOTdhYWI5OTExYmFhYzU0ODRmMTI0NjZlZWYiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzQwMCAiYmE1YWI3MWRiNGY5NDQ3ZjE5ZWI3YjE5NDMwMjQ5ODFjODgwNjRkZCIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM0MDAgImVhMjEwNmI1YmMwMTJjMjVkNzM1NTIxZTBjN2ZiNzE5ZDQzM2VhNGEiCiNlbmRpZgoKLy8gQWRkZWQgTWFyY2ggMTAsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzNDAxIDEzNDAxCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM0MDEgIjc1MTI1NTIwNGYwMDZiOGI4ODNhOGJhZjU1MmEyZGE3OTJmOGFhNDQiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzQwMSAiYjU0NzMyYjUyOGJjMjY2OTQ4MWVjMGNmMTdjN2I5N2IwMzM3MjBiOSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM0MDEgImIxNGJlZTJjMGZkMjUwZGE2N2ZhZWE0MjFmNjIwYjU4ZTVkZWE5YTIiCiNlbmRpZgoKLy8gQWRkZWQgTWFyY2ggMTIsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzNTAwIDEzNTAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM1MDAgIjNlNzhiNmZlNWZkMzFkNjkwNDk0OTk0NTA4NDlhZGExN2E3MjBhNTMiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzUwMCAiOTg2MjE3NzYzMWU4MDU5YTQ5N2Q2MDg2MDU4MTY4ZGQ0NzQ3N2FiNyIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM1MDAgIjViN2MyMjg0ZWQyNTQyY2Y2MjEyOTgxZDYyY2E5MTIyZmIyYTRlODgiCiNlbmRpZgoKLy8gQWRkZWQgQXByaWwgMDcsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzNjAwIDEzNjAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM2MDAgImE4ODMyNTE5YjRlYjA1ODU2N2Q2OGI2NWJlMWUxYzllODBhYWU1NjYiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzYwMCAiMjJjNzdkMWYyMzA1ZGU4YTYxNDdmMTRlNTJmMDc0YjRhNGU1MjIyYyIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM2MDAgImViMzUzYmE3YjhiOWJjYmVmODkwMjE3OTcxY2Q4ZWM0MWVmZWFhNzUiCiNlbmRpZgoKLy8gQWRkZWQgQXByaWwgMjIsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzNjAxIDEzNjAxCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM2MDEgIjExNmE0MTUzMDQ3ZWUxZWU2N2YxN2ZjOTM4ZjA4NGVlNzJiMjRlNTQiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzYwMSAiZmY4ODVmZTkyMWY5ZWFlMWE1Y2U2YTcxYjMwYjBjMzdiMzA2YmY1NiIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM2MDEgIjQwYjIyNGYyOTVhMjA2OTQyNDFjNWRiNDk3MjFiYzkwYTM3OTZmMzAiCiNlbmRpZgoKLy8gQWRkZWQgTWF5IDA3LCAyMDI1LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl8xMzcwMCAxMzcwMAojaWYgZGVmaW5lZChPU19XSU4pCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzEzNzAwICI2NWM3MTU3ZGQzZThlYmE5YmNjMzhkYjJiZDdmMjY1MDhjNzE3ZjNlIgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM3MDAgIjllODQwMDljOTJjMjVhYTgwOTM1NzI3YjVlNDUyNmIyMzQzOWE1NzUiCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzEzNzAwICJlNWFjMTJiMWJkODhiOWVjZTZjZWFhNTc4NDhhYWJhNjFhYjg1MjQyIgojZW5kaWYKCi8vIEFkZGVkIEp1bmUgMDIsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzEzODAwIDEzODAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM4MDAgIjFjZGUzZWMyN2Y5Mzc0N2JhNDJjMGYyYWEwMDQ2N2E1YTE2YWRmZDQiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzgwMCAiMDkxMTBjMWYzYmJlMGU4YThjMjZkZGY2ZGYzMzg4ZDczYTY1OTNkMSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTM4MDAgIjcyYzgzYTE0NTU3MDZjMGY5NjQ1MDVhNmVkY2JmMDBjNGEwMDU3NWQiCiNlbmRpZgoKLy8gQWRkZWQgSnVseSAwOSwgMjAyNS4KI2RlZmluZSBDRUZfQVBJX1ZFUlNJT05fMTM5MDAgMTM5MDAKI2lmIGRlZmluZWQoT1NfV0lOKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzkwMCAiNzA3NTA4YWI3MjA3MjExNmNlMDUwMGUzZDJiZGQ5ZjM0YjJkNWNkOCIKI2VsaWYgZGVmaW5lZChPU19NQUMpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzEzOTAwICI5YjNlZjMxNmQ5YTNmNTU0ODk5YzM2MTM5Y2ZjY2IxNzc2N2NhMjU0IgojZWxpZiBkZWZpbmVkKE9TX0xJTlVYKQojZGVmaW5lIENFRl9BUElfSEFTSF8xMzkwMCAiZmQwYjdmOGFiNTg2OTIyNDk3MjM0MDQ1NDY5MGE0MmU5MTkzOTQ4OCIKI2VuZGlmCgovLyBBZGRlZCBBdWd1c3QgMjUsIDIwMjUuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE0MDAwIDE0MDAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQwMDAgImE3NzgxMDUxMGZiZjBmZjVlZTk3NjhjZjU3Mjk0MWE5MzExYzMxNmMiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDAwMCAiYTI4MGUzNjgzMTBlOGVhNzVhMjFkYzdiYThmMTkyNjU3YjdjODQ1NSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQwMDAgImE5ZjU2MzBmNWE0ZmQ4ZjQzZTAwM2FmZjZmOGEyY2JhN2JjZmYxOGYiCiNlbmRpZgoKLy8gQWRkZWQgT2N0b2JlciAwNiwgMjAyNS4KI2RlZmluZSBDRUZfQVBJX1ZFUlNJT05fMTQxMDAgMTQxMDAKI2lmIGRlZmluZWQoT1NfV0lOKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDEwMCAiMjk0OGJlYzY4NWE0NjlhODI5ZDk5ZWIxZTZiMDhlZGUwZmY5YjE5NyIKI2VsaWYgZGVmaW5lZChPU19NQUMpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0MTAwICI5NTM3YmViOGQyODE3NWRjYTc3NTEwYzAzZjViZWE1NTYxN2E5ZjIyIgojZWxpZiBkZWZpbmVkKE9TX0xJTlVYKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDEwMCAiZjBmMjMxZWZhYjk0ZWI4MTgxMTQ0OTA4MDRiMTNmY2U2MWFiN2Y0ZSIKI2VuZGlmCgovLyBBZGRlZCBPY3RvYmVyIDE1LCAyMDI1LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl8xNDIwMCAxNDIwMAojaWYgZGVmaW5lZChPU19XSU4pCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0MjAwICIxY2UxZDA5NDVmYjkwNGNhNDhjMTZlMmMyYmRiYmYyNWJmYjdiMTJlIgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQyMDAgIjRlZjFjMTlhMDlhOGNhMmU1MjNmZWE0Zjc5MjE1YTY5MzRkZTEwNzEiCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0MjAwICIxODc2MWNkNDcyNTM5Mjg4M2UwZDc3YTFkYjUzYjA4YTRjYWU3YWM2IgojZW5kaWYKCi8vIEFkZGVkIE5vdmVtYmVyIDEwLCAyMDI1LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl8xNDMwMCAxNDMwMAojaWYgZGVmaW5lZChPU19XSU4pCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0MzAwICIxMjJiYWU2YWU5YTk5NjFmYjJmYzI3YmQxMGFlZGUxNTk4NThmODcwIgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQzMDAgIjVkNjExZjczOTZhYWYyZGVkZDBjMWU4MGM2ODAzNjBkOTk4Zjk3MWYiCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0MzAwICJhZDQ1OWNiNzU4ZTQ3ODNjNzc5NzcxZWQzNjE4NWU4YzlmZDQxMTMyIgojZW5kaWYKCi8vIEFkZGVkIERlY2VtYmVyIDE2LCAyMDI1LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl8xNDQwMCAxNDQwMAojaWYgZGVmaW5lZChPU19XSU4pCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0NDAwICI0MzBkMWM0ZTRjOTU4YjUzYThlMzgzZGIzYTVhMzgwMzdjYTlmNTFlIgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ0MDAgImZlMGRiZjRhMmNlM2I1YWNiMGFjYzA2YWFjNGQ3YWMzMDEwYzI0NzciCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0NDAwICJjNjRiM2YwZTVkZGYxMWYyZTdkMjk2YzQwNjdjZDg4N2FhNTA4NzhjIgojZW5kaWYKCi8vIEFkZGVkIEphbnVhcnkgMjAsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE0NTAwIDE0NTAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ1MDAgImZkMzExYWQ5YzAyZDIwNjNkMjBlNmZhMzYwMWQ2NjIyOTA4OWI2OWYiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDUwMCAiYjI1MTFiMDdlMTgyNjUzYmE1NThiZjE4NzNjYzQ1NzM4YmE1OThkYSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ1MDAgImY1N2U3MjJjYjcwYjViYTI1NjdhYWFhYmZkYTM1YWIyNGQxYmRmMTAiCiNlbmRpZgoKLy8gQWRkZWQgRmVicnVhcnkgMTcsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE0NjAwIDE0NjAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ2MDAgIjk5Njc2YThkNTg5NTFmZmIwYTI0ZjZjYmFlNmFhMDFmMzI0OWIyOWUiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDYwMCAiOGJhOTJkNGY2MzMwNmNlYTQ2YjU5OTJjZTY1YmYyY2QyYzc3NDBmZiIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ2MDAgIjdjZWM3NDI5NzJkNjczNWFhOGE5NTVmYzJlMDk4YTFmNjY2OWMzZDUiCiNlbmRpZgoKLy8gQWRkZWQgTWFyY2ggMjQsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE0NzAwIDE0NzAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ3MDAgIjFjZjMzZGJmMzU1ZWZmZmNkOTkzYWI0ZDJlYTM5MWU2NjMxZjk1ZjIiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDcwMCAiNGI1MTMwY2UyYWJlNDg5NzBhM2VkZjliM2QyZTU0MWMwMDdmNjkzOCIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ3MDAgImNhMDNlZTdhYTRkOWE3NjZkNDMzMDJjMDM2ODk2ODRkZTBiNzg5NjYiCiNlbmRpZgoKLy8gQWRkZWQgQXByaWwgMjIsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE0ODAwIDE0ODAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ4MDAgImE5ZmRkYjFmODZmMWZjNDI3YTZlZWUxOWEzNzBkYmVkYjE0NDY4Y2IiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNDgwMCAiYzRhMjViMGU3ZjBiZWI1MWI5ZjVkYjlmYjc1OTA0ZDExZGQ4NTZhMSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ4MDAgImFhMmRlNTRjMTQzZTlmZmZmZDE4MzE3N2YxNGMzMjU4MjBiNTkxNmEiCiNlbmRpZgoKLy8gQWRkZWQgTWF5IDIyLCAyMDI2LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl8xNDkwMCAxNDkwMAojaWYgZGVmaW5lZChPU19XSU4pCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0OTAwICJkZTUxMTRjMzRlNGMwYzNkNzI1MzEzYzM4ZjRlZDViMThjYmZkZWI0IgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTQ5MDAgIjIyZmQ4NDU1NTRlYjVlM2Y1NTE2OTY1MjEzZWZjYTk1MWEzZjgyNTYiCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE0OTAwICI3NzhmNjRlNThmZjAyNDg0MGUyOWZiNDliYjdiOWMzODE5ZjEyMTkxIgojZW5kaWYKCi8vIEFkZGVkIEp1bmUgMDQsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE1MDAwIDE1MDAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTUwMDAgIjcxMTQ2YjQzNTBhMDFkMzgwNWU3ZWE5OTBlYjAzNGU2ZWY0ZDUzZGIiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNTAwMCAiZTg1Yzg2OGFhOGE5NDdlMWU3Yzk5MDRjMDc0NWM2MGFlNDkwZmEwNSIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTUwMDAgIjIxMDc2NzcyNWE2ZmViMmU0YmVjZDM5NTZiNjQ4Y2FiNmEwMDY3MTIiCiNlbmRpZgoKLy8gQWRkZWQgSnVseSAxMCwgMjAyNi4KI2RlZmluZSBDRUZfQVBJX1ZFUlNJT05fMTUxMDAgMTUxMDAKI2lmIGRlZmluZWQoT1NfV0lOKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNTEwMCAiOWJmZDY0YmQwYjkyNDgxZDFjYzk3OGQ1NzE4MGJlZTJjNmJkNDYwNiIKI2VsaWYgZGVmaW5lZChPU19NQUMpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE1MTAwICJkZTFiMGZiMzdmMThmOWZmN2VlMWQ3YjFlMzIzMjQ3YzU1OWEzYmY4IgojZWxpZiBkZWZpbmVkKE9TX0xJTlVYKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNTEwMCAiYzE0MjFjYjMyZDM1ZmMzODM3Zjk5OTZlZGUwOGUyMjRkZTlkYjRlYiIKI2VuZGlmCgovLyBBZGRlZCBKdWx5IDE1LCAyMDI2LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl8xNTEwMSAxNTEwMQojaWYgZGVmaW5lZChPU19XSU4pCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE1MTAxICI1OTMzZTE4ZTFkMjg3OWUyMzIwNWM3MGM2MzdiZjgxN2MzZjMyNDU0IgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTUxMDEgIjJlMTM1OTVhMDk3MTI2MjY3OWJjZGMwMWM1ZDEzOTFiMTJiNWNmMGQiCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE1MTAxICI1YTMyMDQxY2YyZDdjNTBjNWZhYWQ4OTNjYWRkYTZjMGNiN2FlY2ZjIgojZW5kaWYKCi8vIEFkZGVkIEF1Z3VzdCAxNSwgMjAyNi4KI2RlZmluZSBDRUZfQVBJX1ZFUlNJT05fMTUyMDAgMTUyMDAKI2lmIGRlZmluZWQoT1NfV0lOKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNTIwMCAiMWRkZTNiYjU3MWE1ZWU1YWVkZDY0NmVkNDY5NGQ0YmM4ZDlhMmQ5NiIKI2VsaWYgZGVmaW5lZChPU19NQUMpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzE1MjAwICIxZTQ5ODE0OTlmZjBiYWNlOGRhMDMwYTIxYTE2YTY2MTNmNDY3MDNjIgojZWxpZiBkZWZpbmVkKE9TX0xJTlVYKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNTIwMCAiOWRkNzU5NjdjMzY5NGI4NzU1ZGMxNzMwYTAwOTdhNjNhMmViZmU0NCIKI2VuZGlmCgovLyBBZGRlZCBTZXB0ZW1iZXIgMDQsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzE1NDAwIDE1NDAwCiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTU0MDAgIjcyNmRjNzM3NjNkYjIyZWRiMjg5ZTQxYWYyNDIxYTIzMjYxN2Y3ZjQiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF8xNTQwMCAiZTVjZDI4MDQ3ZmMxZjhiYmI5NzJlNTQ2OTJmYzY2NTA0MGM3ZjAzNCIKI2VsaWYgZGVmaW5lZChPU19MSU5VWCkKI2RlZmluZSBDRUZfQVBJX0hBU0hfMTU0MDAgIjVjODM0NGFlN2Q3ZjY0MjFiYzgwMTQwMWUzNWQ0ZGJmNmQzOGUxMDEiCiNlbmRpZgoKLy8gTmV4dCB2ZXJzaW9uIGxhc3QgdXBkYXRlZCBPY3RvYmVyIDI0LCAyMDI2LgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl85OTk5OTggOTk5OTk4CiNpZiBkZWZpbmVkKE9TX1dJTikKI2RlZmluZSBDRUZfQVBJX0hBU0hfOTk5OTk4ICI3MjZkYzczNzYzZGIyMmVkYjI4OWU0MWFmMjQyMWEyMzI2MTdmN2Y0IgojZWxpZiBkZWZpbmVkKE9TX01BQykKI2RlZmluZSBDRUZfQVBJX0hBU0hfOTk5OTk4ICJlNWNkMjgwNDdmYzFmOGJiYjk3MmU1NDY5MmZjNjY1MDQwYzdmMDM0IgojZWxpZiBkZWZpbmVkKE9TX0xJTlVYKQojZGVmaW5lIENFRl9BUElfSEFTSF85OTk5OTggIjVjODM0NGFlN2Q3ZjY0MjFiYzgwMTQwMWUzNWQ0ZGJmNmQzOGUxMDEiCiNlbmRpZgoKLy8gRXhwZXJpbWVudGFsIHZlcnNpb24gbGFzdCB1cGRhdGVkIE9jdG9iZXIgMjQsIDIwMjYuCiNkZWZpbmUgQ0VGX0FQSV9WRVJTSU9OXzk5OTk5OSA5OTk5OTkKI2lmIGRlZmluZWQoT1NfV0lOKQojZGVmaW5lIENFRl9BUElfSEFTSF85OTk5OTkgImYxNGQyMGE1YjVmMmM4OWU3ZmU5M2RlMjhiNjAyNzhiMzgzMDBmODQiCiNlbGlmIGRlZmluZWQoT1NfTUFDKQojZGVmaW5lIENFRl9BUElfSEFTSF85OTk5OTkgImEwNzUxZTA1ZDYyZWIwYjU1MDAwYmI5M2VkNDQ5YzM5NTgyODY4NGUiCiNlbGlmIGRlZmluZWQoT1NfTElOVVgpCiNkZWZpbmUgQ0VGX0FQSV9IQVNIXzk5OTk5OSAiNDg4NTQ4NTA5OTgxMDMxNDMzYWYyMmFmMDVjOWI1OWU2ZjA3ODhhOSIKI2VuZGlmCgovLyBPbGRlc3Qgc3VwcG9ydGVkIENFRiB2ZXJzaW9uLgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl9NSU4gQ0VGX0FQSV9WRVJTSU9OXzEzMzAwCgovLyBOZXdlc3Qgc3VwcG9ydGVkIENFRiB2ZXJzaW9uLgojZGVmaW5lIENFRl9BUElfVkVSU0lPTl9MQVNUIENFRl9BUElfVkVSU0lPTl8xNTQwMAoKI2VuZGlmICAvLyBDRUZfSU5DTFVERV9DRUZfQVBJX1ZFUlNJT05TX0hfCg==",
      "base64",
    ),
    apiPrivate = Buffer.from(
      apiCached.toString().replaceAll("October 24, 2026", "October 25, 2026"),
    ),
    headerPrivate = Buffer.from(
      headerCached
        .toString()
        .replaceAll("October 24, 2026", "October 25, 2026"),
    );
  const body = (b) => ({
    base64: b.toString("base64"),
    size: b.length,
    sha256: hash(b),
  });
  assert.equal(
    hash(apiCached),
    "7ae7df88408c1920de87cb076a5abb9d6abaca311b06ecdf49c55c7262b86897",
  );
  assert.equal(
    hash(headerCached),
    "eff5e6316c47038e5fbe0ae85a5aab5acb3e574ab92be4f35b76b83a981fae93",
  );
  const projection = r.readiness.facts.sourceBefore
    .filter((x) => x.path.startsWith("cef/"))
    .map((x) => ({
      path: x.path.slice(4),
      size: x.size,
      sha256: x.sha256,
      mode: 420,
    }));
  for (let i = projection.length; i < 1897; i++)
    projection.push({
      path: `canonical/${String(i).padStart(4, "0")}.h`,
      size: 1,
      sha256: sha,
      mode: 420,
    });
  projection.sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  const overlap = projection
      .filter((x) => x.path !== "libcef/browser/native/window_x11.cc")
      .slice(0, 31)
      .map((x) => ({ ...x, path: "cef/" + x.path })),
    cacheRows = [
      ...overlap,
      {
        path: "cef/cef_api_untracked.json",
        size: apiCached.length,
        sha256: hash(apiCached),
        mode: 420,
      },
    ];
  for (let i = 0; i < 955; i++)
    cacheRows.push({
      path: `cef/generated/${String(i).padStart(4, "0")}.h`,
      size: 1,
      sha256: sha,
      mode: 420,
    });
  cacheRows.push(
    {
      path: "out/gen/cef/include/cef_version.h",
      size: 2385,
      sha256:
        "9c909033e029283aae0605c17b39742e11cd17fc1c8b927924bad8b6cd6c3413",
      mode: 420,
    },
    {
      path: "out/gen/cef/include/cef_api_versions.h",
      size: headerCached.length,
      sha256: hash(headerCached),
      mode: 420,
    },
    {
      path: "out/gen/cef/libcef_dll/cef_api_versions.inc",
      size: 1366,
      sha256:
        "3270282c2fe64e6d1f013817e970b8c1c17c41595af5266ecfa1436c2540956b",
      mode: 420,
    },
  );
  const base = new Map(projection.map((x) => [x.path, x]));
  for (const x of cacheRows)
    if (x.path.startsWith("cef/"))
      base.set(x.path.slice(4), { ...x, path: x.path.slice(4) });
  const oldFiles = [...base.values()]
    .map((x) =>
      x.path === "cef_api_untracked.json"
        ? { ...x, size: apiPrivate.length, sha256: hash(apiPrivate) }
        : x,
    )
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const afterCef = new Map(
    LINUX_ISOLATED_TRANSITION.after
      .filter((x) => x.path.startsWith("cef/"))
      .map((x) => [x.path.slice(4), x]),
  );
  const newFiles = oldFiles.map((x) =>
    afterCef.has(x.path)
      ? {
          ...x,
          size: afterCef.get(x.path).size,
          sha256: afterCef.get(x.path).sha256,
        }
      : x,
  );
  assert.equal(oldFiles.length, 2853);
  const window = {
      beginLocal: "2026-10-25T12:00:00.000000",
      endLocal: "2026-10-25T12:00:01.000000",
    },
    comments = ["Next version", "Experimental version"].map((label, i) => ({
      pointer: `/hashes/${["999998", "999999"][i]}/comment`,
      cached: `${label} last updated October 24, 2026.`,
      private: `${label} last updated October 25, 2026.`,
    })),
    dateProof = {
      policy: "cef-untracked-api-comment-dates-v1",
      literalSubstitutionExact: true,
      otherJsonFieldsEqual: true,
      cached: { size: apiCached.length, sha256: hash(apiCached) },
      private: { size: apiPrivate.length, sha256: hash(apiPrivate) },
      hookLocalWindow: window,
      comments,
    };
  const actions = [
      {
        path: "cef_version.h",
        size: 2385,
        sha256: cacheRows.at(-3).sha256,
        mode: 420,
        equal: true,
      },
      {
        path: "cef_api_versions.h",
        size: headerPrivate.length,
        sha256: hash(headerPrivate),
        mode: 420,
        equal: false,
      },
      {
        path: "cef_api_versions.inc",
        size: 1366,
        sha256: cacheRows.at(-1).sha256,
        mode: 420,
        equal: true,
      },
    ],
    actionPacket = structuredClone(actions);
  Object.assign(actionPacket[1], {
    comparisonPassed: true,
    rawByteEqual: false,
    dateCommentEquivalence: {
      literalSubstitutionExact: true,
      jsonDateProofSha256: identitySha256(dateProof),
      new23ApiBodySha256: hash(apiPrivate),
    },
  });
  const admission = {
      canonicalCef: {
        files: 1897,
        inventorySha256:
          "57a70a22d2953d44c57ca84eb8e17fdf8d9a1f2ba57a31a004686eb4d710947f",
        allCanonicalBytesMatched: true,
      },
    },
    postInputs = {
      admission,
      toolFiles: r.readiness.facts.toolFiles,
      runtimeFiles: [],
    };

  const queries = [
    ["rev-parse", "HEAD"],
    ["rev-list", "--count", "HEAD"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["log", "-n", "1", "--pretty=%d", "HEAD"],
    ["cherry", "origin/master", "HEAD"],
    ["ls-files", "--stage", "-z"],
    [
      "grep",
      "--no-color",
      "-n",
      "-E",
      "(CEF_NEXT|CEF_NEXT)|=next",
      "--",
      ":!include/cef_api_hash.h",
      "*.h",
      "*.cc",
    ],
  ].map((argv, i) => {
    const stdout =
      i === 0
        ? "682c378d70d5780061e96644dca16ddd8fd157a9\n"
        : "synthetic Git query";
    return {
      argv,
      exit: 0,
      stdoutBytes: Buffer.byteLength(stdout),
      stdoutSha256: hash(stdout),
      stderrBytes: 0,
      stderrSha256: hash(""),
      equal: true,
    };
  });
  const metadata = {
    "projection.json": wrap(projection),
    "cached-generated.json": wrap(cacheRows),
    "git-queries.json": wrap(queries),
    "old12-output.json": wrap({
      files: oldFiles,
      apiUntrackedBodies: {
        cached: body(apiCached),
        private: body(apiPrivate),
      },
      hookLocalWindow: window,
    }),
    "new23-output.json": wrap({
      files: newFiles,
      apiUntrackedBodies: {
        cached: body(apiCached),
        private: body(apiPrivate),
      },
      hookLocalWindow: window,
    }),
    "actions.json": wrap({
      files: actions,
      apiVersionHeaderBodies: {
        cached: body(headerCached),
        private: body(headerPrivate),
      },
    }),
    "post-inputs.json": wrap(postInputs),
  };
  const stageNames = [
      "formatter-selection",
      "resource-selection",
      "old12-hook",
      "new23-hook",
      "version-header",
      "api-headers",
    ],
    logs = Object.fromEntries(
      stageNames.map((name) => [name + ".log", wrap("synthetic " + name)]),
    );
  for (const value of Object.values(logs)) {
    value.rawUtf8 = JSON.parse(value.rawUtf8);
    value.size = Buffer.byteLength(value.rawUtf8);
    value.sha256 = hash(value.rawUtf8);
  }
  const generated = (files) => ({
    files: files.length,
    bytes: files.reduce((n, x) => n + x.size, 0),
    inventorySha256: identitySha256(files),
    comparisonPassed: true,
    rawByteEqual: false,
    dateCommentEquivalence: dateProof,
  });
  const packet = {
    kind: "sorng-linux-isolated-generation-reproduction",
    operation: op,
    controllerCommit: ctl,
    sourceLockIdentity: LINUX_ISOLATED_IDENTITY,
    workspaceVolume: volume,
    status: "reproduced",
    phase: "complete",
    failure: null,
    postchecks: true,
    cacheReadOnly: true,
    sourceAccepted: false,
    readinessPassed: false,
    buildExecuted: false,
    privatePatchApplied: true,
    baseline: {
      expectedFiles: 499,
      expectedContentBytes: 18867290,
      expectedInventorySha256:
        "45911abc56f8c7f9680f80be8302d8a864d334a371f818d86e9930214c9d042f",
      patchBaselineVerified: true,
      orderEquivalent: true,
      comparisons: Array.from({ length: 7 }, () => ({ setsEqual: true })),
    },
    projection: {
      files: 1897,
      bytes: projection.reduce((n, x) => n + x.size, 0),
      inventorySha256: identitySha256(projection),
    },
    admission,
    runtimeFiles: [],
    oldGenerated: generated(oldFiles),
    newGenerated: generated(newFiles),
    actions: actionPacket,
    postInputDigest: identitySha256(postInputs),
    stages: stageNames.map((name) => ({
      stage: name,
      exit: 0,
      elapsedMs: 1,
      output: {
        path: name + ".log",
        sha256: logs[name + ".log"].sha256,
        size: logs[name + ".log"].size,
      },
    })),
    evidence: Object.entries(metadata).map(([name, x]) => ({
      name,
      size: x.size,
      sha256: x.sha256,
    })),
    retentionFailure: null,
    unconfirmedLog: null,
  };

  const gitConfig =
    "[core]\nrepositoryformatversion=0\nfilemode=true\nbare=false\nautocrlf=false\nhooksPath=/dev/null\nfsmonitor=false\n";
  const originalGit =
    cache.replace("/work/", "/opt/original-cache/") + "/cef/.git";
  const metaEntries = Object.entries({
    HEAD: "ref: refs/heads/main\n",
    config: gitConfig,
    index: "synthetic Git index",
    "objects/info/alternates": originalGit + "/objects\n",
  })
    .map(([path, body], i) => ({
      path,
      size: Buffer.byteLength(body),
      sha256: hash(body),
      mode: 420,
      dev: "2",
      ino: String(i + 6000),
      nlink: 1,
      uid: 10001,
      gid: 10001,
    }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const cefDirs = new Set([
    ".git",
    ".git/objects",
    ".git/objects/info",
    ".git/refs",
    ".git/refs/heads",
    ".git/refs/remotes",
  ]);
  for (const name of [
    ...oldFiles.map((x) => x.path),
    ...newFiles.map((x) => x.path),
    ...metaEntries.map((x) => ".git/" + x.path),
  ]) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length) {
      cefDirs.add(parts.join("/"));
      parts.pop();
    }
  }
  r.workspace.facts.cefProjection = {
    method: "canonical-inputs-plus-reviewed-old12",
    root: cache + "/cef",
    sourceVolume: r.readiness.facts.volume,
    byteIdenticalCopy: false,
    old12InventorySha256: identitySha256(oldFiles),
    new23InventorySha256: identitySha256(newFiles),
    files: Math.max(oldFiles.length, newFiles.length),
    bytes: Math.max(
      ...[oldFiles, newFiles].map((rows) =>
        rows.reduce((n, x) => n + x.size, 0),
      ),
    ),
    directories: [...cefDirs].sort(),
    gitMetadata: {
      method: "private-refs-index-readonly-object-alternates",
      root: cache + "/cef/.git",
      originalRoot: originalGit,
      identity: { dev: "2", ino: "5000", uid: 10001, gid: 10001, mode: 448 },
      originalIdentity: {
        dev: "1",
        ino: "5000",
        uid: 10001,
        gid: 10001,
        mode: 493,
      },
      entries: metaEntries,
      bytes: metaEntries.reduce((n, x) => n + x.size, 0),
      inventorySha256: identitySha256(metaEntries),
    },
  };
  r.workspace.facts.capacityBeforeBytes +=
    r.workspace.facts.cefProjection.bytes +
    r.workspace.facts.cefProjection.gitMetadata.bytes;
  r.generation = envelope("generation", {
    packet: wrap(packet),
    metadata,
    logs,
    elapsedMs: 100,
  });
  const gnOutput = "Done. synthetic GN graph\n";
  r.gnOutput = gnOutput;
  r.gn = envelope("gn", {
    argv: [
      cache + "/buildtools/linux64/gn",
      "gen",
      cache + "/out/Release_GN_x64",
    ],
    cwd: cache,
    beginWallMs: 300,
    endWallMs: 400,
    elapsedMs: 100,
    exit: 0,
    outputSha256: hash(gnOutput),
    outputBytes: Buffer.byteLength(gnOutput),
    argsBefore: r.readiness.facts.args,
    argsAfter: r.readiness.facts.args,
    securityHeaderBefore: r.readiness.facts.securityHeader,
    securityHeaderAfter: r.readiness.facts.securityHeader,
    securityMacrosBefore: r.readiness.facts.securityMacros,
    securityMacrosAfter: r.readiness.facts.securityMacros,
    graphBefore: r.readiness.facts.graph,
    graphAfter: fp("out/Release_GN_x64/build.ninja"),
    objectEdge: {
      ninjaFile: fp("obj/cef/libcef_static.ninja"),
      edgeSha256: sha,
      rule: "cxx",
      source: "cef/libcef/browser/native/window_x11.cc",
      output: object,
      before: fp(object, "3".repeat(64)),
    },
    linkEdge: {
      ninjaFile: fp("build.ninja"),
      edgeSha256: sha,
      rule: "solink",
      source: "cef",
      output: "libcef.so",
      before: r.readiness.facts.cacheOutputs.engine,
    },
    sourceAfterSha256: identitySha256(r.postchecks.facts.sourceAfter),
    generationSha256: "",
  });
  Object.assign(r.postchecks.facts, {
    objectAfter: fp(object, "4".repeat(64), 2),
    linkAfter: r.postchecks.facts.engine,
    workspaceSha256: "",
    generationSha256: "",
    gnSha256: "",
  });
  f.input.origin = LINUX_ISOLATED_ORIGIN;
  const refresh = () => {
    const evidence = () =>
      Object.fromEntries(
        LINUX_ISOLATED_EVIDENCE.map((role) => [
          role,
          pin(
            role +
              (["compileOutput", "gnOutput"].includes(role) ? ".log" : ".json"),
            Buffer.from(
              ["compileOutput", "gnOutput"].includes(role)
                ? r[role]
                : JSON.stringify(r[role]),
            ),
          ),
        ]),
      );
    r.workspace.facts.copyManifestSha256 = evidence().copyManifest.sha256;
    r.gn.facts.generationSha256 = evidence().generation.sha256;
    r.postchecks.facts.compileSha256 = evidence().compile.sha256;
    r.postchecks.facts.workspaceSha256 = evidence().workspace.sha256;
    r.postchecks.facts.generationSha256 = evidence().generation.sha256;
    r.postchecks.facts.gnSha256 = evidence().gn.sha256;
    f.input.evidence = evidence();
  };
  addQuicheMetadataFixture(f);
  addOutAliasesFixture(f);
  const complete = { ...f, refresh };
  refreshIsolatedCopyFacts(complete);
  return complete;
}

test("isolated Linux origin binds independent copied objects, generation raw bytes, GN, real new object/link and fresh package", () => {
  const f = linuxIsolatedFixture(),
    p = verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  assert.equal(p.origin, LINUX_ISOLATED_ORIGIN);
  assert.equal(p.originalCacheReadonly, true);
  assert.equal(p.workspaceCopied, true);
  assert.equal(p.isolatedBuild, true);
  assert.equal(p.pristineSourceBuild, false);
  assert.equal(p.originalBuildReplayed, false);
  assert.equal("nativeAcceptance" in p, false);
  assert.equal(p.workspaceManifestSha256, f.input.evidence.copyManifest.sha256);
  const review = {
    origin: LINUX_ISOLATED_ORIGIN,
    sourceLockIdentity: LINUX_ISOLATED_IDENTITY,
    target: f.input.target,
    engineSha256: p.engineSha256,
    originalInputsSourceLockRawSha256: p.originalInputsSourceLockRawSha256,
    reviewBinding: { evidencePins: f.input.evidence },
  };
  validateLinuxIsolatedProvenance(p, review);
  assert.equal(Object.keys(LINUX_ISOLATED_FACT_KEYS).length, 15);
});

test("isolated R5 preserves finite raw cleanup milliseconds within the original budget", () => {
  // Only this duration comes from actual operation 00bcc's finished record.
  // All other fixture facts are synthetic, not engine execution evidence.
  const observed = 832.4805999998935;
  assert.equal(Number.isSafeInteger(observed), false);
  const verify = (value, isolated = true, mutate = () => {}) => {
    const f = isolated ? linuxIsolatedFixture() : linuxIncrementalFixture();
    f.records.finished.facts.cleanupElapsedMs = value;
    mutate(f.records.finished.facts);
    if (isolated) f.refresh();
    else {
      const role = "finished";
      f.input.evidence[role] = pin(
        role + ".json",
        Buffer.from(JSON.stringify(f.records[role])),
      );
    }
    return verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  };
  for (const value of [0, 0.125, observed, 30000])
    assert.equal(verify(value).isolatedBuild, true);
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    "832.4805999998935",
    true,
    false,
    null,
    undefined,
    -0.001,
    30000.001,
    Number.MAX_SAFE_INTEGER,
  ])
    assert.throws(() => verify(value));
  for (const mutate of [
    (end) => delete end.cleanupElapsedMs,
    (end) => (end.containerId = "f".repeat(64)),
    (end) => (end.reason = "timeout"),
    (end) => (end.exit = 1),
    (end) => (end.quiescent = false),
    (end) => (end.processesLeft = 1),
    (end) => (end.readersStopped = false),
    (end) => (end.logFailure = true),
  ])
    assert.throws(() => verify(observed, true, mutate));
  assert.throws(() => verify(observed, false));
  assert.equal(verify(1, false).origin, LINUX_INCREMENTAL_ORIGIN);
});

test("isolated R5 accepts pinned Siso handler counts with positive local work and one strict summary", () => {
  // Portable excerpt of the retained 4625 compile log. Other fixture facts are
  // synthetic: this test is source-contract proof, never execution evidence.
  // Owner's separate retained-log replay uses the full 467179-byte raw body.
  const observed =
    "build finished\nnoexec:36 local:2457 remote:0 cache:0 skip:84607\n";
  const summary = "noexec:36 local:2457 remote:0 cache:0 skip:84607";
  const oldPredicate = /^noexec:0 local:(\d+) remote:0 cache:0 skip:\d+\r?$/m;
  assert.equal(oldPredicate.exec(observed), null);
  const candidate = (body, localSteps = 2457, isolated = true) => {
    const f = isolated ? linuxIsolatedFixture() : linuxIncrementalFixture();
    f.records.compileOutput = body;
    Object.assign(f.records.compile.facts, {
      outputBytes: Buffer.byteLength(body),
      outputSha256: createHash("sha256").update(body).digest("hex"),
      localSteps,
    });
    if (isolated) f.refresh();
    else {
      const evidence = () =>
        Object.fromEntries(
          LINUX_INCREMENTAL_EVIDENCE.map((name) => [
            name,
            pin(
              name + (name === "compileOutput" ? ".log" : ".json"),
              Buffer.from(
                name === "compileOutput"
                  ? f.records[name]
                  : JSON.stringify(f.records[name]),
              ),
            ),
          ]),
        );
      f.records.postchecks.facts.compileSha256 = evidence().compile.sha256;
      f.input.evidence = evidence();
    }
    return verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  };
  assert.equal(candidate(observed).isolatedBuild, true);
  assert.equal(
    candidate(observed.replaceAll("\n", "\r\n")).isolatedBuild,
    true,
  );
  assert.equal(
    candidate(observed.replace("noexec:36", "noexec:0")).isolatedBuild,
    true,
  );
  const malformed = [
    summary.replace("local:2457", "local:0"),
    summary.replace("remote:0", "remote:1"),
    summary.replace("cache:0", "cache:1"),
    summary.replace("noexec:36", "noexec:-1"),
    summary.replace("noexec:36", "noexec:1.5"),
    summary.replace("noexec:36", "noexec:036"),
    summary.replace("noexec:36", "noexec:" + "9".repeat(50)),
    summary.replace("local:2457", "local:invalid"),
    summary + " unknown:1",
    summary + " ",
  ];
  for (const bad of malformed)
    assert.throws(() => candidate(observed.replace(summary, bad)), /Linux/);
  for (const extra of [
    summary,
    "noexec:0 local:1 remote:1 cache:0 skip:0",
    "noexec:unknown",
  ])
    assert.throws(() => candidate(observed + extra + "\n"), /Linux/);
  for (const marker of [
    "FAILED: object",
    "ninja: build stopped: failed",
    "FATAL failure",
  ])
    assert.throws(() => candidate(observed + marker + "\n"), /Linux/);
  assert.throws(() => candidate(observed, 1), /Linux/);
  assert.throws(
    () => candidate(observed.replace("build finished\n", "")),
    /Linux/,
  );
  // This is the existing non-isolated R4 branch, not a widened origin.
  assert.throws(() => candidate(observed, 2457, false), /Linux/);
});

test("isolated Linux refuses shared/corrupt copy, old-volume writes, unsafe init, unknown mounts, incomplete generation/GN and stale object/link", () => {
  const changes = [
    (f) => (f.records.workspace.facts.originalReadonly = false),
    (f) =>
      (f.records.workspace.facts.workspaceVolume =
        f.records.workspace.facts.originalVolume),
    (f) =>
      (f.records.copyManifest.facts.entries[0].targetIno =
        f.records.copyManifest.facts.entries[0].sourceIno),
    (f) => (f.records.copyManifest.facts.entries[0].sha256 = "0".repeat(64)),
    (f) => (f.records.copyManifest.facts.complete = false),
    (f) => (f.records.copyManifest.facts.unknownLinks = 1),
    (f) => (f.records.workspace.facts.capacityAfterBytes = 100 * 1024 ** 3 - 1),
    (f) => f.records.workspace.facts.workBudgetMs++,
    (f) => (f.records.workspace.facts.mounts[0].readonly = false),
    (f) => (f.records.workspace.facts.init.result.directories[0].uid = 0),
    (f) => (f.records.generation.facts.elapsedMs = 600001),
    (f) => f.records.gn.facts.argv.push("--args=unsafe"),
    (f) => (f.records.gn.facts.exit = 1),
    (f) =>
      (f.records.gn.facts.sourceAfterSha256 =
        "d624ed223238b3b999e85a994be5a3c1340dd87ce64e3d60094e7c87e4dbd19d"),
    (f) =>
      (f.records.postchecks.facts.objectAfter.sha256 =
        f.records.gn.facts.objectEdge.before.sha256),
    (f) =>
      (f.records.postchecks.facts.linkAfter.sha256 =
        f.records.gn.facts.linkEdge.before.sha256),
    (f) => (f.records.finished.facts.processesLeft = 1),
    (f) => (f.records.preparation.facts.archiveRoundtrip = false),
  ];
  for (const change of changes) {
    const f = linuxIsolatedFixture();
    change(f);
    f.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});

test("isolated Linux raw generation changes cannot be disguised by recomputing outer reviewed pins", () => {
  for (const mutate of [
    (p) => (p.status = "blocked"),
    (p) => (p.sourceAccepted = true),
    (p) =>
      (p.newGenerated.dateCommentEquivalence.private.sha256 = "0".repeat(64)),
    (p) => (p.actions[1].equal = true),
    (p) => (p.baseline.orderEquivalent = false),
    (p) => (p.privatePatchApplied = false),
  ]) {
    const f = linuxIsolatedFixture(),
      raw = JSON.parse(f.records.generation.facts.packet.rawUtf8);
    mutate(raw);
    const text = JSON.stringify(raw);
    f.records.generation.facts.packet = {
      rawUtf8: text,
      size: Buffer.byteLength(text),
      sha256: hash(text),
    };
    f.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
  const old = linuxIncrementalFixture();
  assert.throws(() =>
    verifyOwnedHandoffEvidence(
      { ...old.input, origin: LINUX_ISOLATED_ORIGIN },
      old.records,
      old.lock,
    ),
  );
  const current = linuxIsolatedFixture();
  assert.throws(() =>
    verifyOwnedHandoffEvidence(
      { ...current.input, origin: LINUX_INCREMENTAL_ORIGIN },
      current.records,
      current.lock,
    ),
  );
});

test("Linux incremental binds separate predecessor and genuine new-operation schema without fresh-acquisition claims", () => {
  const f = linuxIncrementalFixture(),
    p = verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  assert.equal(p.sourceLockIdentity, LINUX_INCREMENTAL_IDENTITY);
  assert.equal(p.actualToolFilesVerified, 8);
  assert.equal(p.incrementalBuild, true);
  assert.equal(p.pristineSourceBuild, false);
  assert.equal(p.originalBuildReplayed, false);
  assert.equal("freshCheck" in p, false);
  assert.equal("nativeClassTestsPassed" in p, false);
  assert.deepEqual(
    Object.keys(f.records).sort(),
    [...LINUX_INCREMENTAL_EVIDENCE].sort(),
  );
  assert.deepEqual(
    Object.keys(f.f).sort(),
    Object.keys(LINUX_INCREMENTAL_FACT_KEYS).sort(),
  );
  assert.equal(JSON.stringify(p).includes("/work/"), false);
});

test("Linux incremental rejects stale history, changed source/tools/flags, deadline, output and packaging contradictions", () => {
  const mutations = [
    (f) => (f.input.sourceLockIdentity = identitySha256(linuxLock)),
    (f) => (f.records.predecessor.facts.freshCheck = {}),
    (f) => (f.records.readiness.facts.args.sha256 = digest),
    (f) => (f.records.readiness.facts.cacheOutputs.engine.sha256 = digest),
    (f) => (f.records.readiness.facts.exclusiveCache = false),
    (f) => f.records.readiness.facts.sourceBefore.pop(),
    (f) => (f.records.readiness.facts.kernel.diskFreeBytes = 1),
    (f) => (f.records.readiness.facts.kernel.home.mode = 0o777),
    (f) => (f.records.readiness.facts.toolFiles[0].sha256 = digest),
    (f) => (f.records.apply.facts.after.sha256 = digest),
    (f) => (f.records.apply.facts.onlyReviewedPatchApplied = false),
    (f) => f.records.started.facts.compileBudgetMs++,
    (f) => (f.records.container.facts.kernel.networkMode = "bridge"),
    (f) => (f.records.container.facts.id = "bad"),
    (f) => f.records.compile.facts.argv.push("--no-sandbox"),
    (f) => (f.records.compile.facts.exit = 124),
    (f) => (f.records.compile.facts.endMonotonicMs = 99999999),
    (f) => (f.records.compileOutput += "secret-private-raw-error"),
    (f) => (f.records.finished.facts.quiescent = false),
    (f) => (f.records.finished.facts.processesLeft = 1),
    (f) => (f.records.finished.facts.logFailure = true),
    (f) => (f.records.postchecks.facts.sourceAfter[0].sha256 = digest),
    (f) => (f.records.postchecks.facts.securityMacros[0].value = 1),
    (f) => (f.records.package.facts.originalInputsSourceLockRawSha256 = digest),
    (f) => (f.records.package.facts.engine.sha256 = "1".repeat(64)),
    (f) => f.records.package.facts.assets.pop(),
    (f) => (f.records.distribution.facts.outputsFresh = false),
    (f) => (f.records.preparation.facts.archiveRoundtrip = false),
    (f) => (f.records.preparation.facts.bridgeExports = 3),
    (f) => (f.records.postchecks.operation = operation),
  ];
  for (const change of mutations) {
    const f = linuxIncrementalFixture();
    change(f);
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});

test("Linux incremental roles and byte bounds cannot widen legacy origins or expose malformed raw JSON", () => {
  for (const change of [
    (f) => (f.input.origin = "owned-linux-engine"),
    (f) => delete f.input.evidence.postchecks,
    (f) => (f.input.evidence.compileOutput.size = 64 * 1024 ** 2 + 1),
    (f) => (f.input.evidence.readiness.size = 1024 ** 2 + 1),
    (f) =>
      (f.records.predecessor.facts.review.rawUtf8 =
        "private-secret-invalid-json"),
  ]) {
    const f = linuxIncrementalFixture();
    change(f);
    assert.throws(
      () => verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
      (e) => !e.message.includes("private-secret"),
    );
  }
});

test("Linux incremental real synthetic archive passes all maintained five-asset/extractor/inventory/ELF/export gates", async (t) => {
  const f = await fixture(t, "linux-incremental"),
    result = await checkOwnedSdkHandoff({ ...f, execute: true });
  assert.equal(result.sourceLockIdentity, LINUX_INCREMENTAL_IDENTITY);
  assert.equal(result.provenance.incrementalBuild, true);
  assert.equal(result.hostedBuild, false);
  assert.equal(result.nativeAcceptance, "not-tested");
  assert.equal(result.productionReady, false);
  const packageFile = path.join(f.evidence, "package.json"),
    bytes = await readFile(packageFile),
    row = JSON.parse(bytes);
  row.facts.sandbox.sha256 = "4".repeat(64);
  const changed = Buffer.from(JSON.stringify(row));
  await writeFile(packageFile, changed);
  const review = structuredClone(f.review);
  review.evidence.package = pin("package.json", changed);
  await assert.rejects(checkOwnedSdkHandoff({ ...f, review, execute: true }));
});

test("Linux incremental metadata is bounded once at EOF and rejects invalid UTF8 before output", async (t) => {
  const f = await fixture(t, "linux-incremental"),
    file = path.join(f.evidence, "readiness.json"),
    original = fs.createReadStream;
  let changed = false;
  try {
    fs.createReadStream = (name, ...args) => {
      const stream = original(name, ...args);
      if (name === file)
        stream.once("end", () => {
          fs.writeFileSync(file, Buffer.alloc(2 * 1024 ** 2, 0x20));
          changed = true;
        });
      return stream;
    };
    syncBuiltinESMExports();
    const value = await checkOwnedSdkHandoff({ ...f, execute: true });
    assert.equal(changed, true);
    assert.equal(value.provenance.incrementalBuild, true);
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
  const g = await fixture(t, "linux-incremental"),
    invalid = Buffer.from([0xff, 0x7b, 0x7d]);
  await writeFile(path.join(g.evidence, "readiness.json"), invalid);
  g.review.evidence.readiness = pin("readiness.json", invalid);
  await assert.rejects(checkOwnedSdkHandoff({ ...g, execute: true }), {
    message: "Bounded UTF8 original metadata required",
  });
  await assert.rejects(lstat(g.output), { code: "ENOENT" });
});

test("Linux incremental rejects a re-pinned wrong packaged engine after actual archive verification", async (t) => {
  const f = await fixture(t, "linux-incremental");
  for (const role of ["postchecks", "package"]) {
    const file = path.join(f.evidence, role + ".json"),
      row = JSON.parse(await readFile(file));
    row.facts.engine.sha256 = "5".repeat(64);
    const bytes = Buffer.from(JSON.stringify(row));
    await writeFile(file, bytes);
    f.review.evidence[role] = pin(role + ".json", bytes);
  }
  await assert.rejects(checkOwnedSdkHandoff({ ...f, execute: true }), {
    message: "Incremental Linux packaged output differs",
  });
});

test("Linux incremental distribution requires no-archive and no-docs before maintained packing", () => {
  const f = linuxIncrementalFixture();
  for (const flag of ["--no-archive", "--no-docs"])
    if (!f.records.distribution.facts.argv.includes(flag))
      f.records.distribution.facts.argv.push(flag);
  assert.doesNotThrow(() =>
    verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
  );
  for (const missing of ["--no-archive", "--no-docs"]) {
    const g = structuredClone(f);
    g.records.distribution.facts.argv =
      g.records.distribution.facts.argv.filter((flag) => flag !== missing);
    assert.throws(() => verifyOwnedHandoffEvidence(g.input, g.records, g.lock));
  }
});

test("isolated R5 transition rejects missing H3/lifetime, stale R4, absent-preimage lies and incomplete source proofs", () => {
  const fixture = linuxIsolatedFixture();
  assert.equal(fixture.lock.bridge.capabilities.length, 9);
  assert.equal(fixture.records.preparation.facts.bridgeExports, 5);
  assert.equal(fixture.records.apply.facts.before.length, 69);
  assert.equal(
    fixture.records.apply.facts.before.filter((x) => x.kind === "absent")
      .length,
    9,
  );
  const changes = [
    (f) => {
      f.input.sourceLockIdentity = LINUX_INCREMENTAL_IDENTITY;
    },
    (f) => {
      f.lock.bridge.capabilities.pop();
    },
    (f) => {
      f.records.apply.facts.patches.splice(0, 1);
    },
    (f) => {
      f.records.apply.facts.patches.reverse();
    },
    (f) => {
      f.records.apply.facts.before.find((x) => x.kind === "absent").kind =
        "file";
    },
    (f) => {
      f.records.apply.facts.before.find((x) => x.kind === "file").sha256 =
        digest;
    },
    (f) => {
      f.records.apply.facts.after.find((x) =>
        x.path.includes("sorng_capsule_datagram_client_socket.cc"),
      ).sha256 = digest;
    },
    (f) => {
      f.records.postchecks.facts.sourceAfter.find((x) =>
        x.path.includes("instance_tracer.cc"),
      ).sha256 = digest;
    },
    (f) => {
      f.records.postchecks.facts.sourceAfter.pop();
    },
    (f) => {
      f.records.postchecks.facts.sourceAfter.push({
        path: "unknown.cc",
        size: 1,
        sha256: digest,
      });
    },
    (f) => {
      f.records.preparation.facts.bridgeExports = 4;
    },
    (f) => {
      f.records.gn.facts.sourceAfterSha256 =
        "b9fd179fcef5c1e5755be9c9956ab7cc792ff07393ae8760e2601a1e5d9d7a82";
    },
    (f) => {
      f.records.apply.facts.onlyReviewedPatchesApplied = false;
    },
    (f) => {
      f.records.generation.sourceLockIdentity = LINUX_INCREMENTAL_IDENTITY;
    },
  ];
  for (const change of changes) {
    const f = linuxIsolatedFixture();
    change(f);
    f.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
  for (const role of LINUX_ISOLATED_EVIDENCE) {
    const f = linuxIsolatedFixture();
    delete f.records[role];
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});

test(
  "isolated R5 pristine Git replay plus independent official116 goldens preserves all other66 rows",
  { timeout: 120000 },
  async (t) => {
    const lock = JSON.parse(
      await readFile(
        path.join(
          root,
          "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap/source-lock.json",
        ),
      ),
    );
    const publicRoots = {
      chromium: "F:/cef-builds/sorng-20261007/src",
      cef: "F:/cef-builds/sorng-20261007/src/cef",
    };
    const run = (args, cwd) =>
      spawnSync("git", ["-c", "core.autocrlf=false", ...args], {
        cwd,
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 16 * 1024 * 1024,
      });
    for (const repo of Object.keys(publicRoots))
      if (
        run(
          [
            "-C",
            publicRoots[repo],
            "cat-file",
            "-e",
            lock.upstream[repo].commit + "^{commit}",
          ],
          root,
        ).status !== 0
      )
        return t.skip(
          "Pinned public Git objects unavailable; this is not replaced by mocked proof",
        );
    const parent = await realpath(path.join(root, ".artifacts")),
      work = await mkdtemp(path.join(parent, "r5-transition-test-")),
      identity = await lstat(work, { bigint: true });
    t.after(async () => {
      const current = await lstat(work, { bigint: true });
      assert.equal(current.dev, identity.dev);
      assert.equal(current.ino, identity.ino);
      assert(!current.isSymbolicLink());
      assert.equal(await realpath(work), work);
      await rm(work, { recursive: true });
    });
    const dirs = {};
    for (const repo of Object.keys(publicRoots)) {
      dirs[repo] = path.join(work, repo);
      await mkdir(dirs[repo]);
      assert.equal(run(["init", "-q"], dirs[repo]).status, 0);
    }
    const names = new Set();
    for (const row of lock.patches) {
      const text = await readFile(
        path.join(
          root,
          "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap",
          row.path,
        ),
        "utf8",
      );
      for (const m of text.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm))
        names.add((row.repository === "cef" ? "cef/" : "") + m[2]);
    }
    assert.deepEqual(
      [...names].sort(),
      LINUX_ISOLATED_TRANSITION.before.map((x) => x.path),
    );
    for (const name of names) {
      const repo = name.startsWith("cef/") ? "cef" : "chromium",
        member = repo === "cef" ? name.slice(4) : name;
      const result = run(
        [
          "-C",
          publicRoots[repo],
          "cat-file",
          "blob",
          lock.upstream[repo].commit + ":" + member,
        ],
        root,
      );
      if (result.status !== 0) {
        assert.equal(result.status, 128);
        continue;
      }
      const file = path.join(dirs[repo], member);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, result.stdout);
    }
    const state = () =>
      [...names].sort().map((name) => {
        const repo = name.startsWith("cef/") ? "cef" : "chromium",
          file = path.join(dirs[repo], repo === "cef" ? name.slice(4) : name);
        if (!fs.existsSync(file)) return { path: name, kind: "absent" };
        const body = fs.readFileSync(file);
        return {
          path: name,
          kind: "file",
          size: body.length,
          sha256: hash(body),
        };
      });
    let before;
    for (let i = 0; i < 23; i++) {
      const row = lock.patches[i],
        patch = path.join(
          root,
          "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap",
          row.path,
        );
      for (const args of [
        ["apply", "--check", patch],
        ["apply", patch],
        ["apply", "--reverse", "--check", patch],
      ]) {
        const result = run(args, dirs[row.repository]);
        assert.equal(
          result.status,
          0,
          row.path + ": " + result.stderr.toString(),
        );
      }
      if (i === 11) before = state();
    }
    const withOfficialBaseline = (rows, which) =>
      rows.map((row) => {
        const golden = OFFICIAL_MAP_GOLDENS.find(
          (x) => x.which === which && x.path === row.path,
        );
        if (!golden) return row;
        assert.deepEqual(row, golden.pristine);
        return golden.official;
      });
    // This bounded test replays pristine public Git plus our patches. The six
    // independent goldens come from the retained full116/499 replay, not this
    // pristine fixture or the production expected map.
    assert.deepEqual(
      withOfficialBaseline(before, "before"),
      LINUX_ISOLATED_TRANSITION.before,
    );
    assert.deepEqual(
      withOfficialBaseline(state(), "after"),
      LINUX_ISOLATED_TRANSITION.after,
    );
    assert.equal(before.filter((x) => x.kind === "absent").length, 9);
    for (const row of [...lock.patches.slice(12)].reverse()) {
      const result = run(
        [
          "apply",
          "--reverse",
          path.join(
            root,
            "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap",
            row.path,
          ),
        ],
        dirs[row.repository],
      );
      assert.equal(result.status, 0, result.stderr.toString());
    }
    assert.deepEqual(state(), before);
    assert.notDeepEqual(
      before,
      LINUX_ISOLATED_TRANSITION.after,
      "Old12 cache cannot masquerade as H3/lifetime source23",
    );
    t.diagnostic(
      "Actual pristine Git old12/new23/reversed-old12 replay plus six independent official116 golden rows matches the reviewed maps; no vendor hooks or engine execution",
    );
  },
);

test("isolated R5 synthetic ELF archive requires all five bridge exports through maintained gates", async (t) => {
  const f = await fixture(t, "linux-isolated"),
    result = await checkOwnedSdkHandoff({ ...f, execute: true });
  assert.equal(result.sourceLockIdentity, LINUX_ISOLATED_IDENTITY);
  assert.equal(result.provenance.workspaceCopied, true);
  assert.equal(result.hostedBuild, false);
  assert.equal(result.nativeAcceptance, "not-tested");
  assert.equal(result.uploadAllowed, false);
  // Removing the fifth structural symbol must fail the real maintained export parser.
  const { inspectCustomRuntimeExports } =
    await import("../../scripts/lib/browser-custom-runtime.mjs");
  const file = path.join(f.work ?? path.dirname(f.inputs), "four-only.so");
  await writeFile(file, elfFixture(false));
  await assert.rejects(
    inspectCustomRuntimeExports(
      file,
      "x86_64-unknown-linux-gnu",
      "sorng-tls-v2-682c378-5",
    ),
  );
});

function refreshIsolatedCopyFacts(f) {
  const c = f.records.copyManifest.facts,
    w = f.records.workspace.facts;
  c.entries.sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.tree + "/" + a.path),
      Buffer.from(b.tree + "/" + b.path),
    ),
  );
  c.directories.sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.tree + "/" + a.path),
      Buffer.from(b.tree + "/" + b.path),
    ),
  );
  c.files = c.entries.length;
  c.bytes = c.entries.reduce((n, r) => n + r.size, 0);
  c.inventorySha256 = identitySha256(c.entries);
  c.aliasesSha256 = identitySha256(c.aliases);
  c.excludedLogAliasesSha256 = identitySha256(c.excludedLogAliases);
  c.completeTreeInventorySha256 = identitySha256({
    files: c.entries,
    directories: c.directories,
    aliases: c.aliases,
    excludedLogAliases: c.excludedLogAliases,
  });
  for (const tree of LINUX_ISOLATED_COPY_TREES) {
    const files = c.entries.filter((x) => x.tree === tree),
      directories = c.directories.filter((x) => x.tree === tree),
      aliases = c.aliases.filter((x) => x.tree === tree),
      excludedLogAliases = c.excludedLogAliases.filter((x) => x.tree === tree);
    Object.assign(c.trees[tree], {
      files: files.length,
      bytes: files.reduce((n, r) => n + r.size, 0),
      directories: directories.length,
      inventorySha256: identitySha256({ files, directories }),
      aliases: aliases.length,
      excludedLogAliases: excludedLogAliases.length,
      completeTreeInventorySha256: identitySha256({
        files,
        directories,
        aliases,
        excludedLogAliases,
      }),
    });
  }
  Object.assign(w, {
    copyFiles: c.files,
    copyBytes: c.bytes,
    copyDirectories: c.directories.length,
  });
  f.refresh();
}

test("isolated R5 topology requires six owned roots, complete copy trees and separate projected CEF metadata", () => {
  const f = linuxIsolatedFixture(),
    w = f.records.workspace.facts,
    c = f.records.copyManifest.facts;
  assert.deepEqual(
    w.init.result.directories.map((x) => x.name),
    ["base", "net", "network", "cef", "out", "operation"],
  );
  assert.deepEqual(
    w.mounts.filter((x) => !x.readonly).map((x) => x.subpath),
    ["base", "net", "network", "cef", "out", "operation"],
  );
  assert.deepEqual(Object.keys(c.trees), ["base", "net", "network", "out"]);
  assert.equal(w.cefProjection.byteIdenticalCopy, false);
  assert.equal(w.cefProjection.gitMetadata.entries.length, 4);
  assert(
    !c.entries.some((x) => x.tree === "cef"),
    "Projected CEF is never represented as a byte-identical cache copy",
  );
  assert.doesNotThrow(() =>
    verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
  );
  const mutations = [
    (f) => {
      f.records.workspace.facts.mounts.splice(0, 1);
    },
    (f) => {
      f.records.workspace.facts.mounts.find(
        (x) => x.subpath === "base",
      ).target += "/nested";
    },
    (f) => {
      f.records.workspace.facts.mounts.find((x) => x.subpath === "net").source =
        f.records.readiness.facts.volume;
    },
    (f) => {
      f.records.workspace.facts.mounts.find(
        (x) => x.subpath === "network",
      ).readonly = true;
    },
    (f) => {
      f.records.workspace.facts.mounts.push({
        ...f.records.workspace.facts.mounts.find((x) => x.subpath === "net"),
        subpath: "chrome",
      });
    },
    (f) => {
      f.records.workspace.facts.init.result.directories =
        f.records.workspace.facts.init.result.directories.filter(
          (x) => x.name !== "base",
        );
    },
    (f) => {
      f.records.copyManifest.facts.entries.find(
        (x) => x.tree === "base",
      ).sha256 = digest;
    },
    (f) => {
      f.records.copyManifest.facts.entries.push({
        ...f.records.copyManifest.facts.entries[0],
      });
    },
    (f) => {
      const x = f.records.copyManifest.facts.entries[0];
      x.targetDev = x.sourceDev;
      x.targetIno = x.sourceIno;
    },
    (f) => {
      f.records.copyManifest.facts.entries[0].targetNlink = 2;
    },
    (f) => {
      f.records.copyManifest.facts.entries[0].tree = "cef";
    },
    (f) => {
      f.records.copyManifest.facts.trees.network.sourceRoot =
        "/work/build/cef-ci-qTkJO9/source/src/services/network";
    },
    (f) => {
      f.records.copyManifest.facts.directories =
        f.records.copyManifest.facts.directories.filter(
          (x) =>
            !(
              x.tree === "base" &&
              x.path ===
                "allocator/partition_allocator/src/partition_alloc/pointers"
            ),
        );
    },
    (f) => {
      const x = f.records.copyManifest.facts.entries[0];
      f.records.copyManifest.facts.entries.push({
        ...x,
        tree: "net",
        path: "socket/sorng_capsule_datagram_client_socket.cc",
        sourceIno: "90001",
        targetIno: "90002",
      });
    },
    (f) => {
      f.records.copyManifest.facts.entries[0].targetDev = "99";
    },
    (f) => {
      f.records.workspace.facts.cefProjection.byteIdenticalCopy = true;
    },
    (f) => {
      f.records.workspace.facts.cefProjection.old12InventorySha256 = digest;
    },
    (f) => {
      f.records.workspace.facts.cefProjection.new23InventorySha256 = digest;
    },
    (f) => {
      f.records.workspace.facts.cefProjection.directories.push("unobserved");
    },
    (f) => {
      const m = f.records.workspace.facts.cefProjection.gitMetadata;
      m.identity = { ...m.originalIdentity, mode: 448 };
    },
    (f) => {
      f.records.workspace.facts.cefProjection.gitMetadata.entries[0].nlink = 2;
    },
    (f) => {
      const m = f.records.workspace.facts.cefProjection.gitMetadata;
      m.entries.find((x) => x.path === "config").sha256 = digest;
      m.inventorySha256 = identitySha256(m.entries);
    },
    (f) => {
      const m = f.records.workspace.facts.cefProjection.gitMetadata;
      m.entries.find((x) => x.path === "objects/info/alternates").sha256 =
        digest;
      m.inventorySha256 = identitySha256(m.entries);
    },
    (f) => {
      const m = f.records.workspace.facts.cefProjection.gitMetadata;
      m.entries[0].path = "hooks/post-checkout";
      m.inventorySha256 = identitySha256(m.entries);
    },
  ];
  for (const mutate of mutations) {
    const f = linuxIsolatedFixture();
    mutate(f);
    refreshIsolatedCopyFacts(f);
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});

test("isolated R5 aggregate census includes projected CEF and its metadata instead of resetting each tree budget", () => {
  const f = linuxIsolatedFixture(),
    c = f.records.copyManifest.facts,
    w = f.records.workspace.facts,
    cef = w.cefProjection;
  const originalBytes = c.bytes,
    projectedBytes = cef.bytes + cef.gitMetadata.bytes,
    unit = 8 * 1024 ** 3;
  for (let i = 0; i < 32; i++)
    c.entries.push({
      tree: "out",
      path: "large-" + i + ".bin",
      size:
        i === 31 ? unit - originalBytes - Math.floor(projectedBytes / 2) : unit,
      sha256: digest,
      mode: 420,
      mtimeNs: "1000",
      sourceDev: "1",
      sourceIno: String(i + 90000),
      targetDev: "2",
      targetIno: String(i + 90000),
      sourceNlink: 1,
      targetNlink: 1,
    });
  refreshIsolatedCopyFacts(f);
  w.capacityBeforeBytes = c.bytes + projectedBytes + 108 * 1024 ** 3;
  f.refresh();
  assert(c.bytes <= 256 * 1024 ** 3);
  assert(c.bytes + projectedBytes > 256 * 1024 ** 3);
  assert(c.entries.every((x) => x.size <= unit));
  assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
});

test("isolated R5 inspected mounts and private Git queries cannot borrow original writable metadata", () => {
  for (const kind of [
    "extra-mount",
    "wrong-subpath",
    "query-head",
    "query-equivalence",
  ]) {
    const f = linuxIsolatedFixture(),
      wrap = (x) => {
        const rawUtf8 = JSON.stringify(x);
        return {
          rawUtf8,
          size: Buffer.byteLength(rawUtf8),
          sha256: hash(rawUtf8),
        };
      };
    if (
      kind.includes("mount") ||
      kind === "wrong-subpath" ||
      kind === "foreign-tmpfs"
    ) {
      const parsed = JSON.parse(f.records.container.facts.inspect.rawUtf8);
      if (kind === "extra-mount") {
        parsed.Mounts.push({
          Type: "volume",
          Name: f.records.readiness.facts.volume,
          Destination: "/foreign",
          RW: true,
        });
        parsed.HostConfig.Mounts.push({
          Type: "volume",
          Source: f.records.readiness.facts.volume,
          Target: "/foreign",
          ReadOnly: false,
        });
      } else
        parsed.HostConfig.Mounts.find((x) =>
          x.Target.endsWith("/services/network"),
        ).VolumeOptions.Subpath = "net";
      f.records.container.facts.inspect = wrap(parsed);
    } else {
      const g = f.records.generation.facts,
        queries = JSON.parse(g.metadata["git-queries.json"].rawUtf8);
      if (kind === "query-head") queries[0].stdoutSha256 = digest;
      else queries[0].equal = false;
      g.metadata["git-queries.json"] = wrap(queries);
      const packet = JSON.parse(g.packet.rawUtf8),
        row = packet.evidence.find((x) => x.name === "git-queries.json");
      Object.assign(row, {
        size: g.metadata["git-queries.json"].size,
        sha256: g.metadata["git-queries.json"].sha256,
      });
      g.packet = wrap(packet);
    }
    f.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});

test("isolated init authority allows only omitted/null/typed-empty fields and denies all five excess capabilities", () => {
  const f = linuxIsolatedFixture(),
    original = JSON.parse(f.records.workspace.facts.init.inspect.rawUtf8);
  const fields = [
    "Devices",
    "DeviceRequests",
    "PidMode",
    "VolumesFrom",
    "Binds",
  ];
  const check = (mutate) => {
    const inspect = structuredClone(original);
    mutate(inspect.HostConfig);
    const rawUtf8 = JSON.stringify(inspect);
    f.records.workspace.facts.init.inspect = {
      rawUtf8,
      size: Buffer.byteLength(rawUtf8),
      sha256: hash(rawUtf8),
    };
    f.refresh();
    return () => verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  };
  assert.doesNotThrow(
    check((h) => {
      for (const name of fields) delete h[name];
    }),
  );
  assert.doesNotThrow(
    check((h) => {
      for (const name of fields) h[name] = null;
    }),
  );
  assert.doesNotThrow(
    check((h) => {
      for (const name of fields) h[name] = name === "PidMode" ? "" : [];
    }),
  );
  const excess = {
    Devices: [
      {
        PathOnHost: "/dev/null",
        PathInContainer: "/dev/synthetic",
        CgroupPermissions: "rwm",
      },
    ],
    DeviceRequests: [
      { Driver: "synthetic", Count: -1, Capabilities: [["gpu"]] },
    ],
    PidMode: "host",
    VolumesFrom: ["synthetic-foreign:rw"],
    Binds: ["/synthetic-host:/synthetic-container:rw"],
  };
  for (const name of fields)
    assert.throws(
      check((h) => {
        h[name] = excess[name];
      }),
      /Closed isolated Linux workspace evidence mismatch/,
      name + " must deny even when Mounts is unchanged",
    );
  for (const name of fields) {
    const malformed =
      name === "PidMode"
        ? [[], {}, 0, false, { length: 0 }]
        : [{}, "", 0, false, { length: 0 }, "nonempty"];
    for (const value of malformed)
      assert.throws(
        check((h) => {
          h[name] = value;
        }),
        /Closed isolated Linux workspace evidence mismatch/,
        name +
          " rejects malformed authority rather than coercing truthiness or length",
      );
  }
});

// Independent goldens: full seven-repository official116/old12 replay matched
// actual499 digest45911abc; independent target69 replay3b0dc7a8 agreed.
// These values are observed fixture facts, never read from the production map.
const OFFICIAL_MAP_GOLDENS = [
  {
    which: "before",
    official: {
      kind: "file",
      path: "base/test/BUILD.gn",
      sha256:
        "ddafdef39dbcff4330459ab76cc71c1167091bb5da8d8ade01426f181c9f832e",
      size: 27681,
    },
    path: "base/test/BUILD.gn",
    pristine: {
      kind: "file",
      path: "base/test/BUILD.gn",
      sha256:
        "f9b9b5c2e9805bb1901e6442e0e3453d844cbfd52e543662d65b2d012a541e35",
      size: 28854,
    },
  },
  {
    which: "before",
    official: {
      kind: "file",
      path: "services/network/network_context.cc",
      sha256:
        "b84a5c15c3b7c91c796b9f4b1ffb2f9e1dce9c20f4fc41f4b1ed469cae92ed53",
      size: 176767,
    },
    path: "services/network/network_context.cc",
    pristine: {
      kind: "file",
      path: "services/network/network_context.cc",
      sha256:
        "8a20ddbdb8b2434b5fe1de83e17541a5190172bb97a5a694f762d4a5438f8c2b",
      size: 176612,
    },
  },
  {
    which: "before",
    official: {
      kind: "file",
      path: "services/network/public/mojom/network_context.mojom",
      sha256:
        "924cfd6f22d96a11187e684d72ba0607f4b59cc39d023b5b83f67f20357c8ffd",
      size: 93503,
    },
    path: "services/network/public/mojom/network_context.mojom",
    pristine: {
      kind: "file",
      path: "services/network/public/mojom/network_context.mojom",
      sha256:
        "cc7f6c6dfcb085832f95d673aeaadb9c540487533d6a77ac33c92bf3112a5ba5",
      size: 93392,
    },
  },
  {
    which: "after",
    official: {
      kind: "file",
      path: "base/test/BUILD.gn",
      sha256:
        "ef64d54196d1b101e0eca9dfd7dbda029c033663ff7b118892a0bfe306298ba0",
      size: 27780,
    },
    path: "base/test/BUILD.gn",
    pristine: {
      kind: "file",
      path: "base/test/BUILD.gn",
      sha256:
        "c57dbfc40278fdc9af67558f6209b17b8531066b1672a2f3e3e6c6851b8bbc37",
      size: 28953,
    },
  },
  {
    which: "after",
    official: {
      kind: "file",
      path: "services/network/network_context.cc",
      sha256:
        "c0e69a996e417c0af4d9f49547cb9ddbc60610ca27e05410f389c243ba44d568",
      size: 179211,
    },
    path: "services/network/network_context.cc",
    pristine: {
      kind: "file",
      path: "services/network/network_context.cc",
      sha256:
        "4399b126f358e0c13e8f47cb75d9634f76fed94821c54067a103d55b9aa7ffe1",
      size: 179056,
    },
  },
  {
    which: "after",
    official: {
      kind: "file",
      path: "services/network/public/mojom/network_context.mojom",
      sha256:
        "c98c633f53b585cd18938afa348164b94d87b8716146664c7d326fdb764e2285",
      size: 93684,
    },
    path: "services/network/public/mojom/network_context.mojom",
    pristine: {
      kind: "file",
      path: "services/network/public/mojom/network_context.mojom",
      sha256:
        "cae7e451c042e56d8b6832a1bf53e9dc98bb5b81f08c051b05c21f142c7f0ba8",
      size: 93573,
    },
  },
];

function applyOfficialObservedRow(f, which, row) {
  const size = row.size,
    sha256 = row.sha256;
  Object.assign(
    f.records.apply.facts[which].find((x) => x.path === row.path),
    { size, sha256 },
  );
  if (which === "before") {
    for (const list of [
      f.records.readiness.facts.sourceBefore,
      f.records.readiness.facts.reconstruction.verifiedSourcePins,
    ])
      Object.assign(
        list.find((x) => x.path === row.path),
        { size, sha256 },
      );
    const location = row.path.startsWith("base/")
      ? ["base", row.path.slice(5)]
      : ["network", row.path.slice(17)];
    Object.assign(
      f.records.copyManifest.facts.entries.find(
        (x) => x.tree === location[0] && x.path === location[1],
      ),
      { size, sha256 },
    );
  } else
    Object.assign(
      f.records.postchecks.facts.sourceAfter.find((x) => x.path === row.path),
      { size, sha256 },
    );
}
function officialObservedFixture() {
  const f = linuxIsolatedFixture();
  for (const row of OFFICIAL_MAP_GOLDENS)
    applyOfficialObservedRow(f, row.which, row.official);
  refreshIsolatedCopyFacts(f);
  const w = f.records.workspace.facts,
    c = f.records.copyManifest.facts;
  w.capacityBeforeBytes =
    c.bytes +
    w.cefProjection.bytes +
    w.cefProjection.gitMetadata.bytes +
    108 * 1024 ** 3;
  f.records.gn.facts.sourceAfterSha256 = identitySha256(
    f.records.postchecks.facts.sourceAfter,
  );
  f.refresh();
  return f;
}
test("official116 actual499 golden facts pass the real isolated verifier instead of a pristine-only map", () => {
  const f = officialObservedFixture();
  assert.equal(f.records.apply.facts.before.length, 69);
  assert.equal(f.records.apply.facts.after.length, 69);
  assert.doesNotThrow(() =>
    verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
  );
});
test("official116 map denies each consistently repinned pristine-only before or after row", () => {
  for (const row of OFFICIAL_MAP_GOLDENS) {
    const f = officialObservedFixture();
    applyOfficialObservedRow(f, row.which, row.pristine);
    refreshIsolatedCopyFacts(f);
    const w = f.records.workspace.facts,
      c = f.records.copyManifest.facts;
    w.capacityBeforeBytes =
      c.bytes +
      w.cefProjection.bytes +
      w.cefProjection.gitMetadata.bytes +
      108 * 1024 ** 3;
    f.records.gn.facts.sourceAfterSha256 = identitySha256(
      f.records.postchecks.facts.sourceAfter,
    );
    f.refresh();
    assert.throws(
      () => verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
      /Linux incremental evidence mismatch/,
    );
  }
});

test("isolated R5 fixed operation root accepts only truthful fixed mounts and distribution while R4 stays historical", () => {
  const fixed = LINUX_ISOLATED_OPERATION_ROOT;
  assert.equal(fixed, "/sorng-r5-generation-operation");
  const accept = (f) => verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
  const good = linuxIsolatedFixture();
  assert.equal(good.records.workspace.facts.mounts.at(-1).target, fixed);
  assert.equal(
    good.records.distribution.facts.argv[3],
    fixed + "/distribution",
  );
  assert.equal(accept(good).origin, LINUX_ISOLATED_ORIGIN);
  const legacy = linuxIncrementalFixture();
  assert.equal(
    legacy.records.distribution.facts.argv[3],
    `/work/linux-incremental-${legacy.records.readiness.operation}/distribution`,
  );
  assert.equal(accept(legacy).origin, LINUX_INCREMENTAL_ORIGIN);
  const wrap = (value) => {
    const rawUtf8 = JSON.stringify(value);
    return { rawUtf8, size: Buffer.byteLength(rawUtf8), sha256: hash(rawUtf8) };
  };
  const retarget = (f, target) => {
    f.records.workspace.facts.mounts.at(-1).target = target;
    const parsed = JSON.parse(f.records.container.facts.inspect.rawUtf8);
    parsed.HostConfig.Mounts.find((m) => m.Target === fixed).Target = target;
    parsed.Mounts.find((m) => m.Destination === fixed).Destination = target;
    f.records.container.facts.inspect = wrap(parsed);
    f.records.distribution.facts.argv[3] = target + "/distribution";
  };
  const mutations = [
    (f) =>
      retarget(f, `/work/linux-incremental-${f.records.readiness.operation}`),
    (f) => retarget(f, fixed + "/"),
    (f) => retarget(f, fixed + "/../foreign"),
    (f) => retarget(f, "/sorng-r5-operation"),
    (f) => {
      const parsed = JSON.parse(f.records.container.facts.inspect.rawUtf8);
      parsed.Mounts.find((m) => m.Destination === fixed).Destination =
        "/foreign";
      f.records.container.facts.inspect = wrap(parsed);
    },
    (f) => (f.records.workspace.facts.mounts.at(-1).source = "foreign-volume"),
    (f) => (f.records.workspace.facts.mounts.at(-1).subpath = "out"),
    (f) => (f.records.workspace.facts.mounts.at(-1).readonly = true),
    (f) => f.records.workspace.facts.mounts.pop(),
    (f) =>
      (f.records.distribution.facts.argv[3] = `/work/linux-incremental-${f.records.readiness.operation}/distribution`),
    (f) =>
      (f.records.readiness.sourceLockIdentity = LINUX_INCREMENTAL_IDENTITY),
    (f) => (f.records.readiness.controllerCommit = "f".repeat(40)),
  ];
  for (const mutate of mutations) {
    const f = linuxIsolatedFixture();
    mutate(f);
    f.refresh();
    assert.throws(() => accept(f));
  }
});

test("isolated init requires Docker canonical singleton CAP_CHOWN and rejects aliases or additional authority", () => {
  const f = linuxIsolatedFixture();
  const inspect = JSON.parse(f.records.workspace.facts.init.inspect.rawUtf8);
  assert.deepEqual(inspect.HostConfig.CapAdd, ["CAP_CHOWN"]);
  assert.doesNotThrow(() =>
    verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
  );
  for (const capabilities of [
    ["CHOWN"],
    [],
    ["CAP_CHOWN", "CAP_CHOWN"],
    ["CAP_CHOWN", "CHOWN"],
    ["CAP_CHOWN", "CAP_SYS_ADMIN"],
    ["CAP_SYS_ADMIN"],
    "CAP_CHOWN",
    null,
  ]) {
    const g = linuxIsolatedFixture();
    const changed = JSON.parse(g.records.workspace.facts.init.inspect.rawUtf8);
    changed.HostConfig.CapAdd = capabilities;
    const rawUtf8 = JSON.stringify(changed);
    g.records.workspace.facts.init.inspect = {
      rawUtf8,
      size: Buffer.byteLength(rawUtf8),
      sha256: hash(rawUtf8),
    };
    g.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(g.input, g.records, g.lock));
  }
});

function addQuicheMetadataFixture(f) {
  // Synthetic complete metadata rows exercise admission; these are not cache evidence.
  const c = f.records.copyManifest.facts,
    prefix = "third_party/quiche/src/.git";
  for (const p of [
    "third_party",
    "third_party/quiche",
    "third_party/quiche/src",
    prefix,
    prefix + "/hooks",
    prefix + "/objects",
  ])
    c.directories.push({
      tree: "net",
      path: p,
      mode: 0o755,
      uid: 10001,
      gid: 10001,
    });
  for (const [i, [name, bytes, mode]] of [
    ["HEAD", Buffer.from("80bf9559d3a4c08dde4b85abc46d190a88ffef64\n"), 0o644],
    ["hooks/example.sample", Buffer.from("never executed\n"), 0o755],
    ["objects/example", Buffer.from("independent object fixture\n"), 0o444],
  ].entries())
    c.entries.push({
      tree: "net",
      path: prefix + "/" + name,
      size: bytes.length,
      sha256: hash(bytes),
      mode,
      mtimeNs: "1700000000000000000",
      sourceDev: "1",
      sourceIno: String(81000 + i),
      targetDev: "2",
      targetIno: String(82000 + i),
      sourceNlink: 1,
      targetNlink: 1,
    });
  f.records.workspace.facts.capacityBeforeBytes += c.entries
    .filter((x) => x.tree === "net" && x.path.startsWith(prefix + "/"))
    .reduce((n, x) => n + x.size, 0);
}

const outAliasBase = "fb5c91b2895aa445d23aebf7f9e2189c-le64.cache-";
const outLogLiteral =
  "/work/tmp/siso.93e291ffbfc6.builder.log.INFO.20261024-064817.29784";

function aliasMetadata(literal, dev, ino) {
  return {
    type: "symlink",
    mode: 0o777,
    nlink: 1,
    uid: 10001,
    gid: 10001,
    size: Buffer.byteLength(literal),
    dev,
    ino,
    mtimeNs: "1700000000000000000",
    ctimeNs: "1700000000000000000",
    literal,
  };
}

function addOutAliasesFixture(f) {
  // Public actual literals, synthetic identities and referent body. This fixture
  // does not assert that the real cached referent has been opened or verified.
  const c = f.records.copyManifest.facts,
    bytes = Buffer.from("owned cache fixture\n"),
    literal = outAliasBase + "12";
  c.entries.push({
    tree: "out",
    path: "fontconfig_caches/" + literal,
    size: bytes.length,
    sha256: hash(bytes),
    mode: 0o644,
    mtimeNs: "1700000000000000000",
    sourceDev: "1",
    sourceIno: "85000",
    targetDev: "2",
    targetIno: "86000",
    sourceNlink: 1,
    targetNlink: 1,
  });
  c.directories.push({
    tree: "out",
    path: "fontconfig_caches",
    mode: 0o755,
    uid: 10001,
    gid: 10001,
  });
  c.aliases = ["10", "11", "9"].map((n, i) => {
    const sourceBefore = aliasMetadata(literal, "1", String(87000 + i));
    return {
      tree: "out",
      path: "fontconfig_caches/" + outAliasBase + n,
      literal,
      sourceBefore,
      sourceAfter: structuredClone(sourceBefore),
      destination: aliasMetadata(literal, "2", String(88000 + i)),
      targetPath: "fontconfig_caches/" + literal,
      targetSize: bytes.length,
      targetSha256: hash(bytes),
    };
  });
  const sourceBefore = aliasMetadata(outLogLiteral, "1", "89000");
  c.excludedLogAliases = [
    {
      tree: "out",
      path: "siso.INFO",
      literal: outLogLiteral,
      sourceBefore,
      sourceAfter: structuredClone(sourceBefore),
      destinationAbsent: true,
      reason: "temporary-siso-log-not-copied",
    },
  ];
  c.outProjection =
    "independent-regular-files-and-literal-aliases-with-declared-log-exclusion";
  f.records.workspace.facts.capacityBeforeBytes += bytes.length;
}

test("isolated OUT actual alias literals require the new typed schema instead of the exact historical key-shape model", () => {
  const f = linuxIsolatedFixture();
  // Self-contained exact copyManifest key list and shape() body from helper
  // raw SHA aabf6f774068453fb570bae41cfcdcc1c75a957b5d3cce9845c4420bc2e6d096.
  // This models only historical closed-schema rejection, not its entire
  // verifier. No historical Git object/fetch/full-history checkout is required.
  const oldKeys = [
    "limits",
    "trees",
    "entries",
    "directories",
    "bytes",
    "files",
    "inventorySha256",
    "complete",
    "unknownLinks",
    "independentFiles",
  ];
  function oldShape(value, keys) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))
    )
      throw Error("Closed reviewed handoff fields required");
  }
  assert.throws(
    () => oldShape(f.records.copyManifest.facts, oldKeys),
    /Closed reviewed handoff fields required/,
  );
  assert.doesNotThrow(() =>
    oldShape(
      Object.fromEntries(
        oldKeys.map((key) => [key, f.records.copyManifest.facts[key]]),
      ),
      oldKeys,
    ),
  );
  assert.doesNotThrow(() =>
    verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
  );
  const legacy = linuxIsolatedFixture(),
    c = legacy.records.copyManifest.facts;
  for (const key of [
    "aliases",
    "aliasesSha256",
    "excludedLogAliases",
    "excludedLogAliasesSha256",
    "completeTreeInventorySha256",
    "outProjection",
  ])
    delete c[key];
  legacy.refresh();
  assert.throws(() =>
    verifyOwnedHandoffEvidence(legacy.input, legacy.records, legacy.lock),
  );
});

test("isolated OUT alias proof denies retargets, target substitutions, identity races and undisclosed exclusions", () => {
  const mutations = [
    (c) => c.aliases.pop(),
    (c) => c.aliases.push(structuredClone(c.aliases[0])),
    (c) => c.aliases.reverse(),
    (c) => (c.aliases[0].tree = "net"),
    (c) => (c.aliases[0].path += "x"),
    (c) => (c.aliases[0].literal = "../outside"),
    (c) => (c.aliases[0].targetPath = "outside"),
    (c) => (c.aliases[0].targetSha256 = "0".repeat(64)),
    (c) => c.aliases[0].targetSize++,
    (c) =>
      (c.entries = c.entries.filter((r) => r.path !== c.aliases[0].targetPath)),
    (c) =>
      (c.directories = c.directories.filter(
        (r) => r.path !== "fontconfig_caches",
      )),
    (c) => c.aliases[0].sourceAfter.ino++,
    (c) => (c.aliases[0].sourceAfter.literal = "other"),
    (c) => (c.aliases[0].destination.type = "file"),
    (c) => (c.aliases[0].destination.mode = 0o755),
    (c) => (c.aliases[0].destination.uid = 0),
    (c) => (c.aliases[0].destination.nlink = 2),
    (c) => c.aliases[0].destination.size++,
    (c) => (c.aliases[0].destination.literal = "other"),
    (c) =>
      (c.aliases[0].destination = structuredClone(c.aliases[0].sourceBefore)),
    (c) =>
      (c.aliases[1].destination = structuredClone(c.aliases[0].destination)),
    (c) =>
      (c.aliases[0].sourceBefore.type = c.aliases[0].sourceAfter.type = "file"),
    (c) =>
      (c.aliases[0].sourceBefore.mode = c.aliases[0].sourceAfter.mode = 0o755),
    (c) => (c.aliases[0].sourceBefore.uid = c.aliases[0].sourceAfter.uid = 0),
    (c) =>
      (c.aliases[0].sourceBefore.nlink = c.aliases[0].sourceAfter.nlink = 2),
    (c) => (c.aliases[0].destination.ino = c.entries[0].targetIno),
    (c) =>
      (c.entries.find((r) => r.path === c.aliases[0].targetPath).targetNlink =
        2),
    (c) =>
      c.entries.push({ ...c.entries[0], tree: "out", path: c.aliases[0].path }),
    (c) => (c.excludedLogAliases = []),
    (c) => c.excludedLogAliases.push(structuredClone(c.excludedLogAliases[0])),
    (c) => (c.excludedLogAliases[0].tree = "base"),
    (c) => (c.excludedLogAliases[0].path = "siso.ERROR"),
    (c) => (c.excludedLogAliases[0].literal = "new-compile-log"),
    (c) => c.excludedLogAliases[0].sourceAfter.ino++,
    (c) => (c.excludedLogAliases[0].destinationAbsent = false),
    (c) => (c.excludedLogAliases[0].reason = "all-logs-skipped"),
    (c) => (c.outProjection = "identical-whole-tree"),
  ];
  for (const [i, mutate] of mutations.entries()) {
    const f = linuxIsolatedFixture();
    mutate(f.records.copyManifest.facts);
    refreshIsolatedCopyFacts(f);
    assert.throws(
      () => verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
      undefined,
      `repinned alias mutation ${i} must fail`,
    );
  }
  for (const key of [
    "aliasesSha256",
    "excludedLogAliasesSha256",
    "completeTreeInventorySha256",
  ]) {
    const f = linuxIsolatedFixture();
    f.records.copyManifest.facts[key] = "0".repeat(64);
    f.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});

test(
  "isolated OUT owned POSIX fixture preserves regular bytes and literal symlink types without following excluded targets",
  {
    timeout: 30000,
    skip:
      process.platform !== "linux"
        ? "Linux-only R5 O_PATH/readlinkat fixture; portable schema checks still run"
        : false,
  },
  async () => {
    const script = String.raw`
import os, stat, tempfile, pathlib, hashlib, json, shutil
base='fb5c91b2895aa445d23aebf7f9e2189c-le64.cache-'
literal=base+'12'
log='/work/tmp/siso.93e291ffbfc6.builder.log.INFO.20261024-064817.29784'
def meta(p):
    s=p.lstat()
    assert stat.S_ISLNK(s.st_mode) and s.st_nlink==1
    fd=os.open(p,os.O_PATH|os.O_NOFOLLOW)
    try:
        held=os.fstat(fd)
        assert (s.st_dev,s.st_ino,s.st_mode,s.st_size)==(held.st_dev,held.st_ino,held.st_mode,held.st_size)
        raw=os.readlink('',dir_fd=fd)
    finally:os.close(fd)
    after=p.lstat()
    assert (s.st_dev,s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_ctime_ns)
    return dict(type='symlink',mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,uid=s.st_uid,gid=s.st_gid,size=s.st_size,dev=str(s.st_dev),ino=str(s.st_ino),mtimeNs=str(s.st_mtime_ns),ctimeNs=str(s.st_ctime_ns),literal=raw)
with tempfile.TemporaryDirectory(prefix='sorng-out-alias-owned-') as tmp:
    root=pathlib.Path(tmp);src=root/'source';dst=root/'destination'
    for p in (src,dst): (p/'fontconfig_caches').mkdir(parents=True)
    data=b'owned physical fontconfig fixture\n';target=src/'fontconfig_caches'/literal
    target.write_bytes(data);target.chmod(0o644)
    for n in ('10','11','9'):os.symlink(literal,src/'fontconfig_caches'/(base+n))
    os.symlink(log,src/'siso.INFO')
    before={n:meta(src/'fontconfig_caches'/(base+n)) for n in ('10','11','9')}
    log_before=meta(src/'siso.INFO');s=target.lstat()
    assert stat.S_ISREG(s.st_mode) and s.st_nlink==1
    assert sorted(p.name for p in (src/'fontconfig_caches').iterdir())==sorted([base+n for n in ('9','10','11','12')])
    # Only the independent ordinary regular target is opened. Alias targets
    # are never traversed, and the absolute excluded log target is untouched.
    fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
    out=dst/'fontconfig_caches'/literal
    w=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        raw=os.read(fd,1024);assert raw==data and os.read(fd,1)==b''
        os.write(w,raw);os.fchmod(w,0o644)
    finally:os.close(fd);os.close(w)
    t=out.lstat();assert stat.S_ISREG(t.st_mode) and t.st_nlink==1
    assert (s.st_dev,s.st_ino)!=(t.st_dev,t.st_ino)
    assert target.read_bytes()==data and out.read_bytes()==data
    rows=[]
    for n in ('10','11','9'):
        p=dst/'fontconfig_caches'/(base+n);os.symlink(literal,p)
        after=meta(src/'fontconfig_caches'/(base+n));assert after==before[n]
        d=meta(p);assert d['literal']==literal and (d['dev'],d['ino'])!=(after['dev'],after['ino'])
        try:os.symlink(literal,p)
        except FileExistsError:pass
        else:raise AssertionError('destination overwrite')
        rows.append(dict(tree='out',path='fontconfig_caches/'+base+n,literal=literal,sourceBefore=before[n],sourceAfter=after,destination=d,targetPath='fontconfig_caches/'+literal,targetSize=len(data),targetSha256=hashlib.sha256(data).hexdigest()))
    assert not os.path.lexists(dst/'siso.INFO') and meta(src/'siso.INFO')==log_before
    assert len(list((dst/'fontconfig_caches').iterdir()))==4
    regular=dict(tree='out',path='fontconfig_caches/'+literal,size=len(data),sha256=hashlib.sha256(data).hexdigest(),mode=stat.S_IMODE(t.st_mode),mtimeNs=str(t.st_mtime_ns),sourceDev=str(s.st_dev),sourceIno=str(s.st_ino),targetDev=str(t.st_dev),targetIno=str(t.st_ino),sourceNlink=s.st_nlink,targetNlink=t.st_nlink)
    print(json.dumps(dict(aliases=rows,regular=regular,log=dict(tree='out',path='siso.INFO',literal=log,sourceBefore=log_before,sourceAfter=meta(src/'siso.INFO'),destinationAbsent=True,reason='temporary-siso-log-not-copied'),physicalUid=os.getuid(),physicalGid=os.getgid(),targetBodiesOpenedThroughAlias=0,excludedTargetOperations=0,destinationPreexistenceDenied=True)))
`;
    const command = "python3",
      args = ["-I", "-B", "-c", script],
      { stdout } = await exec(command, args, {
        timeout: 20000,
        maxBuffer: 65536,
        windowsHide: true,
      }),
      observed = JSON.parse(stdout),
      f = linuxIsolatedFixture(),
      c = f.records.copyManifest.facts;
    assert.equal(observed.targetBodiesOpenedThroughAlias, 0);
    assert.equal(observed.excludedTargetOperations, 0);
    assert.equal(observed.destinationPreexistenceDenied, true);
    assert(
      observed.aliases.every(
        (x) =>
          x.sourceBefore.uid === observed.physicalUid &&
          x.destination.uid === observed.physicalUid,
      ),
    );
    // Physical POSIX types/literals/inodes/modes/hash are real; the verifier's
    // UID10001 role is explicitly simulated. No chown or privileged action runs.
    const role = (x) => ({ ...x, uid: 10001, gid: 10001 });
    c.aliases = observed.aliases.map((x) => ({
      ...x,
      sourceBefore: role(x.sourceBefore),
      sourceAfter: role(x.sourceAfter),
      destination: role(x.destination),
    }));
    c.excludedLogAliases = [
      {
        ...observed.log,
        sourceBefore: role(observed.log.sourceBefore),
        sourceAfter: role(observed.log.sourceAfter),
      },
    ];
    const previousTarget = c.entries.find(
      (x) => x.path === observed.regular.path,
    );
    f.records.workspace.facts.capacityBeforeBytes +=
      observed.regular.size - previousTarget.size;
    c.entries = c.entries.filter((x) => x.path !== observed.regular.path);
    c.entries.push(observed.regular);
    // The surrounding init/other OUT rows remain synthetic; align their
    // declared filesystem with the actual physical referent observation.
    f.records.workspace.facts.init.result.directories.find(
      (x) => x.name === "out",
    ).dev = observed.regular.targetDev;
    for (const row of c.entries.filter((x) => x.tree === "out"))
      row.targetDev = observed.regular.targetDev;
    refreshIsolatedCopyFacts(f);
    assert.doesNotThrow(() =>
      verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
    );
    c.aliases[0].sourceAfter.ino = "999999999999";
    refreshIsolatedCopyFacts(f);
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  },
);

test("isolated R5 copies exact pinned Quiche metadata with unchanged generic git denial", () => {
  const f = linuxIsolatedFixture();
  assert.doesNotThrow(() =>
    verifyOwnedHandoffEvidence(f.input, f.records, f.lock),
  );
  const q = f.records.copyManifest.facts.entries.filter((x) =>
    x.path.startsWith("third_party/quiche/src/.git/"),
  );
  assert.deepEqual(q.map((x) => x.mode).sort(), [0o444, 0o644, 0o755]);
  for (const mutate of [
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).sha256 = "0".repeat(64);
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).size = 40;
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).tree = "base";
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).path = "other/.git/HEAD";
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).path += "/.git/x";
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).sourceNlink = 2;
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).targetIno = "81000";
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).targetDev = "1";
    },
    (f) => {
      f.records.copyManifest.facts.directories =
        f.records.copyManifest.facts.directories.filter(
          (x) => !x.path.endsWith("/.git"),
        );
    },
    (f) => {
      f.records.copyManifest.facts.entries.find((x) =>
        x.path.endsWith("/.git/HEAD"),
      ).path = "third_party/quiche/src/.git";
    },
  ]) {
    const bad = linuxIsolatedFixture();
    mutate(bad);
    refreshIsolatedCopyFacts(bad);
    assert.throws(
      () => verifyOwnedHandoffEvidence(bad.input, bad.records, bad.lock),
      /isolated Linux|Linux incremental/,
    );
  }
});

test("external-only WebView and CHAR source25 is a new closed origin; old source23 stays valid", () => {
  for (const external of [false, true]) {
    const f = linuxIsolatedFixture(external);
    const p = verifyOwnedHandoffEvidence(f.input, f.records, f.lock);
    assert.equal(
      p.origin,
      external ? LINUX_EXTERNAL_WEBVIEW_ORIGIN : LINUX_ISOLATED_ORIGIN,
    );
    assert.equal(
      p.sourceLockIdentity,
      external ? LINUX_EXTERNAL_WEBVIEW_IDENTITY : LINUX_ISOLATED_IDENTITY,
    );
    assert.equal(p.isolatedBuild, true);
    assert.equal("nativeAcceptance" in p, false);
    validateLinuxIsolatedProvenance(p, {
      origin: p.origin,
      sourceLockIdentity: p.sourceLockIdentity,
      target: f.input.target,
      engineSha256: p.engineSha256,
      originalInputsSourceLockRawSha256: p.originalInputsSourceLockRawSha256,
      reviewBinding: { evidencePins: f.input.evidence },
    });
  }
});
test("external-only WebView cannot inherit old origin, maps, source or omitted patch", () => {
  const cases = [
    (f) => {
      f.input.origin = LINUX_ISOLATED_ORIGIN;
    },
    (f) => {
      f.input.origin = "owned-linux-external-webview-engine-unknown";
    },
    (f) => {
      f.input.sourceLockIdentity = LINUX_ISOLATED_IDENTITY;
    },
    (f) => {
      f.records.apply.facts.after = structuredClone(
        LINUX_ISOLATED_TRANSITION.after,
      );
    },
    (f) => {
      f.records.postchecks.facts.sourceAfter = LINUX_ISOLATED_TRANSITION.after
        .filter((x) => x.kind === "file")
        .map(({ kind, ...r }) => r);
    },
    (f) => {
      f.records.apply.facts.patches.pop();
    },
    (f) => {
      f.lock.patches.pop();
    },
    (f) => {
      f.lock.patches[2].sha256 = "0".repeat(64);
    },
    (f) => {
      f.records.package.facts.originalInputsSourceLockRawSha256 =
        LINUX_ISOLATED_INPUT_RAW;
    },
  ];
  for (const mutate of cases) {
    const f = linuxIsolatedFixture(true);
    mutate(f);
    f.refresh();
    assert.throws(() => verifyOwnedHandoffEvidence(f.input, f.records, f.lock));
  }
});
