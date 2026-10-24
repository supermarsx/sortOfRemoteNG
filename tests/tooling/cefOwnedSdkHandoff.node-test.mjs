import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
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
  ownedSdkHandoffPlan,
  verifyOwnedHandoffEvidence,
  checkOwnedSdkHandoff,
  ownedHandoffReviewBinding,
  WINDOWS_CAPSULE_ORIGIN,
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
      incremental === "capsule"
        ? "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64"
        : incremental
          ? "native/cef-build-inputs/20261024-r5-instance-tracer-allocation-windows-x64"
          : "native/cef-build-inputs/20261023-registration-retirement-lf",
    );
  const lockBytes = await readFile(path.join(sourceInputs, "source-lock.json")),
    lock = JSON.parse(lockBytes),
    target = "x86_64-pc-windows-msvc",
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
  const library = pe(
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
    "Release/libcef.dll": library,
    "Release/bootstrap.exe": pe(),
    ...(incremental ? { "Release/bootstrapc.exe": pe() } : {}),
    "Release/libcef.lib": "fixture import lib",
    "Resources/icudtl.dat": "fixture ICU",
    "Resources/locales/en-US.pak": "fixture locale",
    "include/cef_version.h":
      `#define CEF_VERSION "${CEF_PIN.version}"\n#define CEF_COMMIT_HASH "${lock.upstream.cef.commit}"\n#define CEF_SANDBOX_COMPAT_HASH "${CEF_PIN.sandboxCompat}"\n` +
      CEF_PIN.chromium
        .split(".")
        .map(
          (part, index) =>
            `#define CHROME_VERSION_${["MAJOR", "MINOR", "BUILD", "PATCH"][index]} ${part}\n`,
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
  if (incremental && incremental !== "capsule") {
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
  if (incremental === "capsule") {
    const f = await capsuleFixture(),
      manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json")));
    f.input.python = value.python;
    f.input.descriptorSha256 = hash(descriptorBytes);
    const outputs = f.r.engine.engine.outputs;
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
async function capsuleFixture() {
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
    r.engine.engine.native42ManifestSha256 = manifestSha;
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
      symbols: r.engine.engine.symbols,
    };
    r.build.recordDigests = Object.fromEntries(
      WINDOWS_CAPSULE_EVIDENCE.filter((role) => role !== "build").map(
        (role) => [role, hash(encoded(role))],
      ),
    );
    input.evidence = Object.fromEntries(
      WINDOWS_CAPSULE_EVIDENCE.map((role) => [
        role,
        pin(role + ".json", encoded(role)),
      ]),
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
