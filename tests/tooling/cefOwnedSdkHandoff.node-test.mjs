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
import {
  ownedSdkHandoffPlan,
  verifyOwnedHandoffEvidence,
  checkOwnedSdkHandoff,
  ownedHandoffReviewBinding,
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
async function fixture(t) {
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
      "native/cef-build-inputs/20261023-registration-retirement-lf",
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
    ],
    true,
  );
  for (const [name, bytes] of Object.entries({
    "Release/libcef.dll": library,
    "Release/bootstrap.exe": pe(),
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
  const value = {
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
