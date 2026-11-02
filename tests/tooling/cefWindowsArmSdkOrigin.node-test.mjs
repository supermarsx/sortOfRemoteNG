import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import * as original from "../../scripts/lib/cef-windows-arm-sdk-origin.mjs";

const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const sort = (value) =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sort(value[key])]),
        )
      : value;
const raw = (value) => Buffer.from(JSON.stringify(sort(value)) + "\n");
const pin = (value) => ({ bytes: value.length, sha256: digest(value) });
test("pure independent seal reader preserves exact bytes without granting provenance", () => {
  const bytes = Buffer.from(' {\n  "b": 2, "a": 1\n}\n');
  for (const make of [
    () => artifact(bytes),
    () => artifact(bytes, true),
    () => zip64Artifact(bytes),
  ]) {
    const zip = make().raw;
    const decoded = original.extractIndependentSealBytes(zip);
    assert(Buffer.isBuffer(decoded));
    assert.deepEqual(decoded, bytes);
    zip.fill(0);
    assert.deepEqual(decoded, bytes);
  }
  const corrupt = artifact(bytes).raw;
  corrupt[39] ^= 1;
  assert.throws(() => original.extractIndependentSealBytes(corrupt), /ZIP_CRC/);
  for (const value of [
    {},
    null,
    Buffer.alloc(97),
    Buffer.alloc(1024 * 1024 + 1),
  ])
    assert.throws(
      () => original.extractIndependentSealBytes(value),
      /ZIP_BOUND/,
    );
});

test("seal reader addition preserves the complete existing SDK origin verifier", async () => {
  const source = (
    await fs.readFile("scripts/lib/cef-windows-arm-sdk-origin.mjs", "utf8")
  ).replaceAll("\r\n", "\n");
  const addition = String.raw`// BEGIN pure independent seal byte reader
// Decoding returns data only. Authentication and producer ownership are separate.
// Snapshot both boundaries so returned bytes never alias a caller-owned ZIP.
export function extractIndependentSealBytes(rawZip) {
  need(
    Buffer.isBuffer(rawZip) && rawZip.length >= 98 && rawZip.length <= MAX,
    "ZIP_BOUND",
  );
  return Buffer.from(independentSeal(Buffer.from(rawZip)));
}
// END pure independent seal byte reader`;
  assert.equal(source.split(addition).length, 2);
  const prior = source.replace("\n" + addition + "\n\n", "");
  assert.equal(
    digest(Buffer.from(prior)),
    "fdeb022f45923224d5e14de1696563b0cc5211b1b76e1f03ce6ead7a98fac22c",
  );
});
const H = "a".repeat(64);
const sourceTuples = {
  "20261030.294.1": {
    sourceLockIdentity:
      "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    sourceProfileSha256:
      "55367b9d7a76fb69fd584fa57a74efe29f10d361a5345303c378020c985fc041",
  },
  "20261021.278.1": {
    sourceLockIdentity:
      "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
    sourceProfileSha256:
      "3cbc0c31bb5e180724f6e890b8472e65a302c8bf11fbc18acb99234c51ad4637",
  },
};
const bridge = {
  abiVersion: 2,
  patchId: "sorng-tls-v2-682c378-5",
  headerSha256:
    "1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e",
  chromium: "a654841425914cbb703a2931e07b70a83aedbafd",
  cef: "682c378d70d5780061e96644dca16ddd8fd157a9",
};
// Exact planned native private-producer source inventory (105 paths); schema
// coverage only, never a claim these future FULL-SDK bytes exist here.
const PLANNED_PRODUCER_PATHS = [
  ".github/workflows/windows-x64-arm-toolchain.yml",
  "native/windows-arm-full-sdk/profile.json",
  "native/windows-arm-full-sdk/acquire.py",
  "native/windows-arm-full-sdk/extract.py",
  "native/windows-arm-full-sdk/environment.py",
  "native/windows-arm-full-sdk/producer.py",
  "native/windows-arm-full-sdk/checkpoint.py",
  "native/windows-arm-full-sdk/job.py",
  "native/windows-arm-full-sdk/test_producer.py",
  "native/windows-arm-full-sdk/source-driver.mjs",
  "tests/tooling/windowsArmFullSdk.node-test.mjs",
  ".github/workflows/windows-arm-source-preflight.yml",
  "native/windows-arm-full-sdk/image-qualified-current-profile.json",
  "native/windows-arm-full-sdk/image-qualified-20261021-profile.json",
  "native/windows-arm-full-sdk/image-qualified-current-driver.mjs",
  "native/windows-arm-full-sdk/image-qualified-20261021-driver.mjs",
  "native/windows-arm-full-sdk/source_metrics.py",
  "native/windows-arm-full-sdk/metrics_fixture.py",
  "native/windows-arm-full-sdk/test_image_dispatch.py",
  "native/windows-arm-full-sdk/test_source_metrics.py",
  "tests/tooling/windowsArmImageQualifiedSourceGn.node-test.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/native/cef-hosted-recipe.json",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/browser-runtime-package.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-custom-artifact-inventory.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-hosted-bootstrap.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-hosted-provision.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-patched-runtime.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/cef-runtime-ci.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-custom-runtime.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/browser-runtime-release.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-engineering-checkpoint.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-sdk-inventory.mjs",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-checkpoint-archive.py",
  "native/windows-arm-full-sdk/current-source-helpers/scripts/lib/cef-mac-source-metadata.mjs",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/cef-ci-runner-aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/gn/aarch64-pc-windows-msvc.gn",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/include/cef_sorng_tls_bridge.h",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0001-chromium-socket-admission.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0002-cef-native-bridge.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0003-cef-native-widget-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0004-chromium-soda-provisioning.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0005-chromium-proxy-route-probe.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0006-cef-explicit-download-destination.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0007-chromium-instance-tracer-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0008-chromium-same-authority-http2.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0009-cef-http2-bridge-capability.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0010-chromium-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0011-cef-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0012-cef-registration-retirement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0013-chromium-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0014-cef-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0015-chromium-owned-quic-job-selection.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0016-chromium-owned-quic-payload-advertisement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0018-chromium-owned-capsule-context-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0022-chromium-test-trace-processor-static-package-name.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/patches/0024-cef-external-webview-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/review-receipt.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/source-lock.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/tools/aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-current-source-gn/upstream-sha256.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/cef-ci-runner-aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/gn/aarch64-pc-windows-msvc.gn",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/include/cef_sorng_tls_bridge.h",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0001-chromium-socket-admission.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0002-cef-native-bridge.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0003-cef-native-widget-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0004-chromium-soda-provisioning.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0005-chromium-proxy-route-probe.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0006-cef-explicit-download-destination.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0007-chromium-instance-tracer-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0008-chromium-same-authority-http2.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0009-cef-http2-bridge-capability.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0010-chromium-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0011-cef-proxy-application-ack.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0012-cef-registration-retirement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0013-chromium-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0014-cef-owned-quic-datagrams.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0015-chromium-owned-quic-job-selection.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0016-chromium-owned-quic-payload-advertisement.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0017-chromium-instance-tracer-allocation-reentrancy.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0018-chromium-owned-capsule-context-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0019-chromium-owned-capsule-test-netlog-qualification.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0020-chromium-base-unittests-trace-processor-dependency.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0021-chromium-test-trace-processor-dependency-closure.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0022-chromium-test-trace-processor-static-package-name.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/patches/0024-cef-external-webview-lifetime.patch",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/review-receipt.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/source-lock.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/tools/aarch64-pc-windows-msvc.json",
  "native/cef-build-inputs/20261101-r5-windows-arm64-cross-x64-reviewed-20261021-source-gn/upstream-sha256.json",
  "native/windows-arm-full-sdk/engine-qualification-profile.json",
  "native/windows-arm-full-sdk/engine_qualification.py",
  "native/windows-arm-full-sdk/test_engine_qualification.py",
  "tests/tooling/windowsArmEngineQualification.node-test.mjs",
  "native/windows-arm-full-sdk/private-qualification-profile.json",
  "native/windows-arm-full-sdk/private_qualification.py",
  "native/windows-arm-full-sdk/test_private_qualification.py",
  "native/windows-arm-full-sdk/private-source-driver.mjs",
  "native/windows-arm-full-sdk/compiler_input_probe.cc",
  "tests/tooling/windowsArmPrivateQualification.node-test.mjs",
  ".github/workflows/windows-arm-compiler-input-qualification.yml",
];
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "buffer",
    maxBuffer: 4 * 1024 ** 2,
    timeout: 10000,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(root, "empty-config"),
    },
  });
}
async function fixture(t, mutate = () => {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "owned-windows-arm-origin-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, value) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), value);
  };
  const moduleName = "scripts/lib/cef-windows-arm-sdk-origin.mjs";
  await write(
    moduleName,
    await fs.readFile(new URL("../../" + moduleName, import.meta.url)),
  );
  // These are deliberately synthetic files in an owned disposable repository.
  // No real SDK origin policy or workflow is created in the product checkout.
  const workflow = Buffer.from("name: Synthetic contract fixture only\n"),
    input = Buffer.from("# synthetic producer source; never executed\n");
  await write(original.WINDOWS_ARM_SDK_WORKFLOW, workflow);
  await write("native/windows-arm-full-sdk/fixture.py", input);
  const policy = {
    schemaVersion: 1,
    kind: "sorng-windows-arm64-sdk-origin-policy",
    origin: original.WINDOWS_ARM_SDK_ORIGIN,
    target: original.WINDOWS_ARM_SDK_TARGET,
    workflow: original.WINDOWS_ARM_SDK_WORKFLOW,
    workflowPin: pin(workflow),
    sources: structuredClone(sourceTuples),
    bridge: structuredClone(bridge),
    recordSchemaVersion: 1,
    jobPolicy: {
      maxWorkMs: 3600000,
      cleanupMs: 30000,
      wholeMs: 7200000,
      finalReserveMs: 120000,
    },
    producerInputs: [
      { path: "native/windows-arm-full-sdk/fixture.py", ...pin(input) },
    ],
  };
  mutate(policy);
  await write(original.WINDOWS_ARM_SDK_POLICY, raw(policy));
  await write("empty-config", "");
  await fs.mkdir(path.join(root, "empty-hooks"));
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "core.hooksPath", path.join(root, "empty-hooks"));
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "Synthetic parser fixture only");
  const mod = await import(pathToFileURL(path.join(root, moduleName)).href);
  const receipt = await mod.loadWindowsArmSdkOrigin();
  t.after(async () => {
    try {
      await mod.closeWindowsArmSdkOrigin(receipt);
    } catch {
      /* Already retired by test. */
    }
  });
  return {
    root,
    mod,
    receipt,
    policy,
    policySha: digest(raw(policy)),
    head: git(root, "rev-parse", "HEAD").toString().trim(),
  };
}
function packet(f, image = "20261030.294.1") {
  const producer = {
    repository: "supermarsx/sortOfRemoteNG",
    repositoryId: 1010282954,
    runId: 123,
    attempt: 1,
    head: f.head,
    branch: "main",
    workflow: original.WINDOWS_ARM_SDK_WORKFLOW,
    workflowId: 456,
  };
  const base = {
    schemaVersion: 1,
    origin: original.WINDOWS_ARM_SDK_ORIGIN,
    target: original.WINDOWS_ARM_SDK_TARGET,
    originPolicySha256: f.policySha,
    producer,
    image,
    sourceLockIdentity: sourceTuples[image].sourceLockIdentity,
  };
  const source = {
    ...base,
    kind: "sorng-windows-arm64-full-sdk-source",
    sourceProfileSha256: sourceTuples[image].sourceProfileSha256,
    sourceLockRaw: { bytes: 17, sha256: H },
    bridge,
    argsSha256: H,
    graphSha256: H,
    toolsSha256: H,
    beforeSha256: H,
    afterSha256: H,
  };
  const job = {
    exitCode: 0,
    outcome: "success",
    quiescent: true,
    rootReaped: true,
    logReadersStopped: true,
    activeAtEnd: 0,
    processLimit: 64,
    memoryBytes: 8 * 1024 ** 3,
    cpuRate: 2500,
    workMs: 1000,
    cleanupMs: 30000,
    elapsedMs: 100,
  };
  const kernel = {
    kind: "owned-job-proof",
    started: true,
    assignedBeforeResume: true,
    resumed: true,
    jobCreated: true,
    handleListOnly: true,
    outcome: "success",
    rootExit: 0,
    cleanupVerified: true,
    activeAtEnd: 0,
    assignmentMode: "creation-attribute",
    policyReadback: {
      flags: 8712,
      activeProcessLimit: 64,
      jobMemoryBytes: String(8 * 1024 ** 3),
      cpuFlags: 5,
      cpuRate: 2500,
      inheritedHandles: 3,
      affinityChanged: false,
    },
    jobHandleInheritable: false,
    jobHandleInStdioAllowlist: false,
    rootPid: 1234,
    rootCreationFiletime: "123456789",
    assignedAtCreationVerified: true,
    rootReaped: true,
    finalRootExit: 0,
    observedChildrenReaped: 0,
    cleanupBudgetMs: 30000,
    logReadersStopped: true,
    capturedBytes: 0,
    outputCapBytes: 64 * 1024 ** 2,
    elapsedMs: 100,
    success: true,
  };
  const kernelRaw = Buffer.from(JSON.stringify(kernel, null, 2) + "\n");
  const jobReceipt = {
    ...pin(kernelRaw),
    base64: kernelRaw.toString("base64"),
  };
  const compile = {
    ...base,
    kind: "sorng-windows-arm64-full-sdk-compile",
    outcome: "compiler-complete",
    sourceRecordSha256: digest(raw(source)),
    argsSha256: H,
    graphSha256: H,
    toolsSha256: H,
    job,
    jobReceipt,
  };
  const assets = [
    "runtime.json",
    "source-lock.json",
    "manifest.json",
    "receipt.json",
    "sorng-cef-custom-" +
      base.sourceLockIdentity +
      "-" +
      base.target +
      ".tar.bz2",
  ].map((name) => ({ name, bytes: 17, sha256: H }));
  const pkg = {
    ...base,
    kind: "sorng-windows-arm64-full-sdk-package",
    outcome: "sdk-packaged",
    compileRecordSha256: digest(raw(compile)),
    job,
    jobReceipt: (() => {
      const data = Buffer.from(
        JSON.stringify({ ...kernel, rootPid: 1235 }, null, 2) + "\n",
      );
      return { ...pin(data), base64: data.toString("base64") };
    })(),
    engine: { machine: 0xaa64, sha256: H, exportsSha256: H },
    inventory: { files: 5, bytes: 85, sha256: H },
    assets,
  };
  const seal = {
    ...base,
    kind: "sorng-windows-arm64-full-sdk-seal",
    outcome: "full-sdk-complete",
    records: {
      source: pin(raw(source)),
      compile: pin(raw(compile)),
      package: pin(raw(pkg)),
    },
    release: {
      id: 789,
      tag: "windows-arm-full-sdk-123-1",
      carrierHead: f.head,
    },
    assets: assets.map((row, index) => ({ id: index + 1, ...row })),
    nativeAcceptance: false,
    runtimeReady: false,
    producerElapsedMs: 200,
  };
  return { source, compile, package: pkg, producerSeal: seal };
}
const encoded = (p) =>
  Object.fromEntries(
    Object.entries(p).map(([name, value]) => [name, raw(value)]),
  );
function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function artifact(seal, deflate = false) {
  const name = Buffer.from("seal.json"),
    content = deflate ? deflateRawSync(seal) : seal,
    crc = crc32(seal);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(deflate ? 8 : 0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(seal.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(deflate ? 8 : 0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(seal.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + content.length, 16);
  const zip = Buffer.concat([local, name, content, central, name, end]);
  return { pin: { id: 99, ...pin(zip) }, raw: zip };
}
function zip64Artifact(seal) {
  const input = artifact(seal).raw,
    oldEnd = input.length - 22,
    localBytes = input.readUInt32LE(oldEnd + 16);
  const central = Buffer.from(input.subarray(localBytes, oldEnd));
  const compressed = central.readUInt32LE(20),
    expanded = central.readUInt32LE(24);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt32LE(0xffffffff, 42);
  central.writeUInt16LE(28, 30);
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(1);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(expanded), 4);
  extra.writeBigUInt64LE(BigInt(compressed), 12);
  extra.writeBigUInt64LE(0n, 20);
  const directory = Buffer.concat([central, extra]),
    at = localBytes + directory.length;
  const large = Buffer.alloc(56);
  large.writeUInt32LE(0x06064b50);
  large.writeBigUInt64LE(44n, 4);
  large.writeBigUInt64LE(1n, 24);
  large.writeBigUInt64LE(1n, 32);
  large.writeBigUInt64LE(BigInt(directory.length), 40);
  large.writeBigUInt64LE(BigInt(localBytes), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(at), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  const zip = Buffer.concat([
    input.subarray(0, localBytes),
    directory,
    large,
    locator,
    end,
  ]);
  return { pin: { id: 99, ...pin(zip) }, raw: zip };
}
function apiFixture(f, seal, archive) {
  const repo = {
    id: 1010282954,
    full_name: "supermarsx/sortOfRemoteNG",
    private: false,
    default_branch: "main",
  };
  const tree = git(f.root, "ls-tree", "-r", "HEAD")
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const [, mode, sha, name] = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(line);
      return { mode, sha, path: name, type: "blob" };
    });
  const routes = {
    "": repo,
    "actions/workflows/windows-arm-full-sdk.yml": {
      id: 456,
      path: original.WINDOWS_ARM_SDK_WORKFLOW,
    },
    "actions/runs/123": {
      id: 123,
      run_attempt: 1,
      head_sha: f.head,
      head_branch: "main",
      path: original.WINDOWS_ARM_SDK_WORKFLOW,
      workflow_id: 456,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      repository: repo,
      head_repository: repo,
    },
    "actions/artifacts/99": {
      id: 99,
      expired: false,
      size_in_bytes: archive.raw.length,
      digest: "sha256:" + archive.pin.sha256,
      name: "windows-arm-full-sdk-seal-123-1",
      workflow_run: { id: 123, head_sha: f.head },
    },
    ["git/commits/" + f.head]: { tree: { sha: "b".repeat(40) } },
    ["git/trees/" + "b".repeat(40) + "?recursive=1"]: {
      truncated: false,
      tree,
    },
    "releases/789": {
      id: 789,
      draft: true,
      prerelease: true,
      tag_name: seal.release.tag,
      target_commitish: f.head,
    },
    "releases/789/assets?per_page=100": seal.assets.map((row) => ({
      id: row.id,
      name: row.name,
      size: row.bytes,
      digest: "sha256:" + row.sha256,
    })),
  };
  return {
    routes,
    api: async (route) => {
      assert(Object.hasOwn(routes, route));
      return structuredClone(routes[route]);
    },
  };
}

test("real checkout missing fixed policy denies; callers cannot supply a policy path or admitted flag", async () => {
  await assert.rejects(original.loadWindowsArmSdkOrigin());
  await assert.rejects(
    original.loadWindowsArmSdkOrigin({ policy: "elsewhere", admitted: true }),
    /ARGUMENTS/,
  );
});
test("actual fixed-path Git loader brands one opaque lifetime and clone/retired receipts deny", async (t) => {
  const f = await fixture(t),
    records = encoded(packet(f));
  const value = await f.mod.inspectWindowsArmSdkRecords(f.receipt, records);
  assert.equal(value.bundleVerified, false);
  assert.equal(value.producerVerified, false);
  assert.equal(value.nativeAcceptance, false);
  assert.throws(() => {
    value.producer.head = "f".repeat(40);
  }, TypeError);
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords({ ...f.receipt }, records),
    /OPAQUE_POLICY/,
  );
  await f.mod.closeWindowsArmSdkOrigin(f.receipt);
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords(f.receipt, records),
    /OPAQUE_POLICY/,
  );
});
test("fixed policy schema expresses all actual planned105 producer paths and denies unknown or traversing roots", async (t) => {
  const f = await fixture(t),
    policy = structuredClone(f.policy);
  assert.equal(PLANNED_PRODUCER_PATHS.length, 105);
  assert.equal(
    digest(raw(PLANNED_PRODUCER_PATHS)),
    "281ac8ed7cad5d31cc15079438092d9a909b9eeabd416f670c7ae170a0a2620f",
  );
  policy.producerInputs = PLANNED_PRODUCER_PATHS.map((name) => ({
    path: name,
    bytes: 17,
    sha256: H,
  }));
  const candidate = f.mod.inspectWindowsArmSdkOriginPolicy(raw(policy));
  assert.equal(candidate.producerInputs, 105);
  assert.equal(candidate.executionAdmitted, false);
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords(candidate, encoded(packet(f))),
    /OPAQUE_POLICY/,
  );
  for (const name of [
    "scripts/unreviewed.mjs",
    "native/cef-build-inputs/other/source-lock.json",
    "native/windows-arm-full-sdk/current-source-helpers/scripts/unknown.mjs",
    "native/windows-arm-full-sdk/../outside.py",
    "native/windows-arm-full-sdk//producer.py",
    ".github/workflows/ci.yml",
    "tests/tooling/unknown.node-test.mjs",
    "native/windows-arm-full-sdk/sdk-origin-review.json",
    "native/windows-arm-full-sdk/unadmitted.exe",
  ]) {
    policy.producerInputs = [{ path: name, bytes: 17, sha256: H }];
    assert.throws(
      () => f.mod.inspectWindowsArmSdkOriginPolicy(raw(policy)),
      /INPUT_PATH/,
    );
  }
});
test("ambient Git repository/config variables cannot redirect canonicalROOT metadata", async (t) => {
  const f = await fixture(t),
    foreign = await fixture(t);
  git(
    foreign.root,
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "Different foreign HEAD",
  );
  const variables = {
    GIT_DIR: path.join(foreign.root, ".git"),
    GIT_WORK_TREE: foreign.root,
    GIT_INDEX_FILE: path.join(foreign.root, ".git/index"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.repositoryformatversion",
    GIT_CONFIG_VALUE_0: "999",
  };
  const before = Object.fromEntries(
    Object.keys(variables).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, variables);
  try {
    assert.equal(
      (await f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(packet(f))))
        .producerVerified,
      false,
    );
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("held policy read checks FD identity before reading and bounds raced growth without readFile", async (t) => {
  for (const fault of ["identity", "growth"]) {
    const f = await fixture(t),
      file = path.join(f.root, original.WINDOWS_ARM_SDK_POLICY);
    const observed = await fs.open(file, "r"),
      proto = Object.getPrototypeOf(observed);
    await observed.close();
    const read = proto.read,
      stat = proto.stat,
      readFile = proto.readFile;
    let firstStat = true,
      firstRead = true,
      reads = 0,
      requested = 0;
    proto.readFile = () => {
      assert.fail("unbounded readFile must never be called");
    };
    proto.stat = async function (...args) {
      const result = await stat.apply(this, args);
      if (fault === "identity" && firstStat) {
        firstStat = false;
        return { ...result, ino: result.ino + 1n };
      }
      return result;
    };
    proto.read = async function (...args) {
      reads++;
      requested += args[2];
      if (fault === "growth" && firstRead) {
        firstRead = false;
        await fs.appendFile(file, Buffer.alloc(1024 * 1024 + 1));
      }
      return read.apply(this, args);
    };
    try {
      await assert.rejects(
        f.mod.loadWindowsArmSdkOrigin(),
        fault === "identity" ? /FD_CHANGED/ : /BOUND/,
      );
    } finally {
      proto.read = read;
      proto.stat = stat;
      proto.readFile = readFile;
    }
    if (fault === "identity") assert.equal(reads, 0);
    else {
      assert.equal(reads, 1);
      assert(requested < 65536);
    }
  }
});
test("only the new owned-review variant adds the exact fixed policy digest", async (t) => {
  const f = await fixture(t);
  const review = {
    schemaVersion: 1,
    kind: "sorng-cef-owned-import-review",
    origin: original.WINDOWS_ARM_SDK_ORIGIN,
    target: original.WINDOWS_ARM_SDK_TARGET,
    originPolicySha256: f.policySha,
    sourceLockIdentity: sourceTuples["20261030.294.1"].sourceLockIdentity,
    bundleSourceLockRawSha256: H,
    originalInputsSourceLockRawSha256: H,
    descriptorSha256: H,
    handoffSha256: H,
    reviewBinding: {},
    assets: [],
    engineSha256: H,
    filesVerified: 5,
  };
  assert.equal(
    (await f.mod.inspectWindowsArmSdkOriginReview(f.receipt, review))
      .bundleVerified,
    false,
  );
  for (const change of [
    { originPolicySha256: H },
    { origin: "existing-windows-package" },
    { target: "x86_64-pc-windows-msvc" },
    { sourceLockIdentity: H },
    { admitted: true },
  ])
    await assert.rejects(
      f.mod.inspectWindowsArmSdkOriginReview(f.receipt, {
        ...review,
        ...change,
      }),
    );
  const missing = { ...review };
  delete missing.originPolicySha256;
  await assert.rejects(
    f.mod.inspectWindowsArmSdkOriginReview(f.receipt, missing),
    /FIELDS/,
  );
});
test("fixed policy does not accept extra admission keys, arbitrary producer paths or unreviewed sources", async (t) => {
  for (const change of [
    (policy) => {
      policy.admitted = true;
    },
    (policy) => {
      policy.workflow = ".github/workflows/windows-arm-source-preflight.yml";
    },
    (policy) => {
      policy.producerInputs[0].path = "scripts/arbitrary.mjs";
    },
    (policy) => {
      policy.sources["20261030.294.1"].sourceLockIdentity = H;
    },
  ])
    await assert.rejects(fixture(t, change));
});
test("both truthful source/image tuples bind, without source aliases or prerequisite-as-SDK records", async (t) => {
  const f = await fixture(t);
  for (const image of Object.keys(sourceTuples))
    assert.equal(
      (
        await f.mod.inspectWindowsArmSdkRecords(
          f.receipt,
          encoded(packet(f, image)),
        )
      ).image,
      image,
    );
  const mutations = [
    (p) => {
      p.source.kind = "windows-arm-source-gn";
    },
    (p) => {
      p.compile.kind = "windows-arm-private-output-candidate";
      p.compile.outcome = "compiler-complete";
    },
    (p) => {
      p.producerSeal.outcome = "prerequisites-complete";
    },
    (p) => {
      p.source.sourceLockIdentity =
        "bdc724576452178e82a6d9732aaaf1a770e277ddf5ce5cad5a4d65ac242a9629";
    },
    (p) => {
      p.source.image = "20261021.278.1";
    },
    (p) => {
      p.source.bridge.patchId = "sorng-tls-v2-682c378-6";
    },
    (p) => {
      p.source.originPolicySha256 = H;
    },
    (p) => {
      p.source.producer.workflow =
        ".github/workflows/windows-arm-source-preflight.yml";
    },
  ];
  for (const mutate of mutations) {
    const p = structuredClone(packet(f));
    mutate(p);
    await assert.rejects(
      f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(p)),
    );
  }
});
test("partial compiler, failed packaging, resource/cleanup violations and broken cross-record pins deny", async (t) => {
  const f = await fixture(t);
  for (const [role, field, value] of [
    ["compile", "outcome", "compiler-stopped"],
    ["package", "outcome", "failed"],
  ]) {
    const p = packet(f);
    p[role][field] = value;
    await assert.rejects(
      f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(p)),
    );
  }
  for (const [key, value] of Object.entries({
    exitCode: 1,
    quiescent: false,
    rootReaped: false,
    logReadersStopped: false,
    activeAtEnd: 1,
    processLimit: 65,
    memoryBytes: 1,
    cpuRate: 0,
    workMs: 21600 * 1000 + 1,
    cleanupMs: 30001,
    elapsedMs: 40000,
  })) {
    const p = structuredClone(packet(f));
    p.compile.job[key] = value;
    await assert.rejects(
      f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(p)),
    );
  }
  for (const mutate of [
    (p) => {
      p.package.engine.machine = 0x8664;
    },
    (p) => {
      p.package.assets.pop();
    },
    (p) => {
      p.producerSeal.records.compile.sha256 = H;
    },
    (p) => {
      p.producerSeal.nativeAcceptance = true;
    },
    (p) => {
      p.compile.sourceRecordSha256 = H;
    },
  ]) {
    const p = structuredClone(packet(f));
    mutate(p);
    await assert.rejects(
      f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(p)),
    );
  }
});
test("actual canonical policy/workflow/native bytes and current HEAD stay held and bound", async (t) => {
  for (const relative of [
    original.WINDOWS_ARM_SDK_POLICY,
    original.WINDOWS_ARM_SDK_WORKFLOW,
    "native/windows-arm-full-sdk/fixture.py",
  ]) {
    const f = await fixture(t),
      p = path.join(f.root, relative),
      before = await fs.readFile(p);
    await fs.writeFile(p, Buffer.concat([before, Buffer.from(" ")]));
    await assert.rejects(
      f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(packet(f))),
      /FILE_CHANGED/,
    );
  }
  const f = await fixture(t);
  git(f.root, "commit", "--allow-empty", "--quiet", "-m", "new HEAD");
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(packet(f))),
    /HEAD_CHANGED/,
  );
});
test("missing workflow or nonregular Git policy mode cannot mint a new policy receipt", async (t) => {
  const missing = await fixture(t);
  await fs.unlink(path.join(missing.root, original.WINDOWS_ARM_SDK_WORKFLOW));
  await assert.rejects(missing.mod.loadWindowsArmSdkOrigin());
  const wrongMode = await fixture(t);
  const blob = git(
    wrongMode.root,
    "rev-parse",
    "HEAD:" + original.WINDOWS_ARM_SDK_POLICY,
  )
    .toString()
    .trim();
  git(
    wrongMode.root,
    "update-index",
    "--cacheinfo",
    "120000," + blob + "," + original.WINDOWS_ARM_SDK_POLICY,
  );
  git(
    wrongMode.root,
    "commit",
    "--quiet",
    "-m",
    "Synthetic nonregular Git policy mode",
  );
  await assert.rejects(wrongMode.mod.loadWindowsArmSdkOrigin(), /GIT_MODE/);
});
test("raw creation-assigned Job receipts and reviewed whole/reserve policy cannot be replaced by summary booleans", async (t) => {
  const f = await fixture(t);
  for (const mutate of [
    (value) => {
      value.cleanupVerified = false;
    },
    (value) => {
      value.assignedBeforeResume = false;
    },
    (value) => {
      value.policyReadback.flags = 0;
    },
    (value) => {
      value.logReadersStopped = false;
    },
    (value) => {
      value.elapsedMs = 101;
    },
    (value) => {
      value.arbitraryPath = "C:/private";
    },
  ]) {
    const p = structuredClone(packet(f));
    const value = JSON.parse(
      Buffer.from(p.compile.jobReceipt.base64, "base64"),
    );
    mutate(value);
    const data = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    p.compile.jobReceipt = { ...pin(data), base64: data.toString("base64") };
    await assert.rejects(
      f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(p)),
      /JOB_RECEIPT|JOB_READBACK|FIELDS/,
    );
  }
  const copied = structuredClone(packet(f));
  copied.package.jobReceipt = copied.compile.jobReceipt;
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(copied)),
    /JOB_TRANSACTION/,
  );
  const late = packet(f);
  late.producerSeal.producerElapsedMs = f.policy.jobPolicy.wholeMs;
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords(f.receipt, encoded(late)),
    /PRODUCER_LEASE/,
  );
  for (const change of [
    (p) => {
      p.jobPolicy.maxWorkMs = 21600001;
    },
    (p) => {
      p.jobPolicy.cleanupMs = 30001;
    },
    (p) => {
      p.jobPolicy.wholeMs = p.jobPolicy.maxWorkMs;
    },
  ])
    await assert.rejects(fixture(t, change), /JOB_POLICY/);
});
test("full producer API binds independent seal bytes, successful fixed workflow and all five assets", async (t) => {
  const f = await fixture(t),
    p = packet(f),
    records = encoded(p);
  for (const zip of [
    artifact(records.producerSeal),
    artifact(records.producerSeal, true),
    zip64Artifact(records.producerSeal),
  ]) {
    const { api } = apiFixture(f, p.producerSeal, zip);
    const binding = await f.mod.verifyWindowsArmSdkProducer(
      f.receipt,
      records,
      zip,
      api,
    );
    assert.equal(binding.producerVerified, true);
    assert.equal(binding.bundleVerified, false);
    assert.equal(binding.publicationAllowed, false);
    assert.equal(
      await f.mod.assertWindowsArmSdkProducerBinding(
        binding,
        f.receipt,
        digest(records.producerSeal),
      ),
      binding,
    );
    await assert.rejects(
      f.mod.assertWindowsArmSdkProducerBinding(
        { ...binding },
        f.receipt,
        digest(records.producerSeal),
      ),
      /OPAQUE_BINDING/,
    );
  }
});
test("exact API run, workflow, independent artifact, code tree and release asset mutations deny", async (t) => {
  const f = await fixture(t),
    p = packet(f),
    records = encoded(p),
    zip = artifact(records.producerSeal);
  const changes = [
    ["actions/runs/123", "conclusion", "failure"],
    ["actions/runs/123", "status", "in_progress"],
    ["actions/runs/123", "run_attempt", 2],
    ["actions/runs/123", "head_sha", "d".repeat(40)],
    ["actions/runs/123", "event", "push"],
    ["actions/runs/123", "head_branch", "private-proof"],
    [
      "actions/workflows/windows-arm-full-sdk.yml",
      "path",
      ".github/workflows/ci.yml",
    ],
    ["actions/artifacts/99", "digest", "sha256:" + H],
    ["actions/artifacts/99", "expired", true],
    ["releases/789", "draft", false],
    ["releases/789", "target_commitish", "d".repeat(40)],
  ];
  for (const [route, key, value] of changes) {
    const { api, routes } = apiFixture(f, p.producerSeal, zip);
    routes[route][key] = value;
    await assert.rejects(
      f.mod.verifyWindowsArmSdkProducer(f.receipt, records, zip, api),
    );
  }
  for (const mutate of [
    (r) => {
      r["git/trees/" + "b".repeat(40) + "?recursive=1"].tree = r[
        "git/trees/" + "b".repeat(40) + "?recursive=1"
      ].tree.filter(
        (entry) => entry.path !== original.WINDOWS_ARM_SDK_WORKFLOW,
      );
    },
    (r) => {
      r["releases/789/assets?per_page=100"][0].digest = H;
    },
    (r) => {
      r["git/trees/" + "b".repeat(40) + "?recursive=1"].tree.find(
        (entry) => entry.path === original.WINDOWS_ARM_SDK_WORKFLOW,
      ).mode = "100755";
    },
  ]) {
    const { api, routes } = apiFixture(f, p.producerSeal, zip);
    mutate(routes);
    await assert.rejects(
      f.mod.verifyWindowsArmSdkProducer(f.receipt, records, zip, api),
    );
  }
});
test("seal archive substitutions, CRC/entry ambiguity, duplicate JSON and mutable record fields deny", async (t) => {
  const f = await fixture(t),
    p = packet(f),
    records = encoded(p),
    zip = artifact(records.producerSeal),
    { api } = apiFixture(f, p.producerSeal, zip);
  const other = artifact(raw({ forged: true }));
  await assert.rejects(
    f.mod.verifyWindowsArmSdkProducer(f.receipt, records, other, api),
    /INDEPENDENT_SEAL/,
  );
  for (const at of [0, 39, zip.raw.length - 12]) {
    const mutated = Buffer.from(zip.raw);
    mutated[at] ^= 1;
    await assert.rejects(
      f.mod.verifyWindowsArmSdkProducer(
        f.receipt,
        records,
        { pin: { id: 99, ...pin(mutated) }, raw: mutated },
        api,
      ),
    );
  }
  await assert.rejects(
    f.mod.inspectWindowsArmSdkRecords(f.receipt, {
      ...records,
      source: Buffer.from('{"x":1,"x":1}\n'),
    }),
    /CANONICAL_JSON/,
  );
});
test("a late A-to-B record swap cannot bind the old A hash to an independent B seal", async (t) => {
  for (const inPlace of [false, true]) {
    const f = await fixture(t),
      b = packet(f),
      bRecords = encoded(b),
      a = structuredClone(b);
    a.package.assets.at(-1).sha256 = "f".repeat(64);
    a.producerSeal.assets.at(-1).sha256 = "f".repeat(64);
    a.producerSeal.records.package = pin(raw(a.package));
    const records = encoded(a),
      archive = artifact(bRecords.producerSeal),
      { api } = apiFixture(f, b.producerSeal, archive);
    const probe = await fs.open(
        path.join(f.root, original.WINDOWS_ARM_SDK_POLICY),
        "r",
      ),
      prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let calls = 0,
      swapped = false;
    prototype.stat = async function (...args) {
      const result = await originalStat.apply(this, args);
      if (++calls === 13) {
        for (const role of Object.keys(records)) {
          if (inPlace) {
            assert.equal(records[role].length, bRecords[role].length);
            bRecords[role].copy(records[role]);
          } else records[role] = Buffer.from(bRecords[role]);
        }
        swapped = true;
      }
      return result;
    };
    try {
      await assert.rejects(
        f.mod.verifyWindowsArmSdkProducer(f.receipt, records, archive, api),
        /INDEPENDENT_SEAL/,
      );
    } finally {
      prototype.stat = originalStat;
    }
    assert.equal(swapped, true);
  }
});
test("all raw records and artifact bytes/pins are captured before the first await", async (t) => {
  for (const replace of [false, true]) {
    const f = await fixture(t),
      p = packet(f),
      records = encoded(p),
      expectedSeal = digest(records.producerSeal);
    const archive = artifact(records.producerSeal),
      { api } = apiFixture(f, p.producerSeal, archive);
    const probe = await fs.open(
        path.join(f.root, original.WINDOWS_ARM_SDK_POLICY),
        "r",
      ),
      prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let mutated = false;
    prototype.stat = async function (...args) {
      const result = await originalStat.apply(this, args);
      if (!mutated) {
        mutated = true;
        for (const role of Object.keys(records)) {
          if (replace)
            records[role] = Buffer.from("malformed caller replacement");
          else records[role].fill(0);
        }
        if (replace) {
          archive.raw = Buffer.from("malformed artifact replacement");
          archive.pin = { id: 1, bytes: 1, sha256: H };
        } else {
          archive.raw.fill(0);
          archive.pin.id = 1;
          archive.pin.bytes = 1;
          archive.pin.sha256 = H;
        }
      }
      return result;
    };
    let binding;
    try {
      binding = await f.mod.verifyWindowsArmSdkProducer(
        f.receipt,
        records,
        archive,
        api,
      );
    } finally {
      prototype.stat = originalStat;
    }
    assert.equal(mutated, true);
    assert.equal(binding.sealSha256, expectedSeal);
    assert.equal(
      await f.mod.assertWindowsArmSdkProducerBinding(
        binding,
        f.receipt,
        expectedSeal,
      ),
      binding,
    );
  }
});
test("policy retirement or HEAD movement during final awaited reads prevents minting a producer binding", async (t) => {
  for (const retire of [true, false]) {
    const f = await fixture(t),
      p = packet(f),
      records = encoded(p),
      archive = artifact(records.producerSeal),
      { api } = apiFixture(f, p.producerSeal, archive);
    const probe = await fs.open(
        path.join(f.root, original.WINDOWS_ARM_SDK_POLICY),
        "r",
      ),
      prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalStat = prototype.stat;
    let calls = 0,
      entered = false;
    prototype.stat = async function (...args) {
      const result = await originalStat.apply(this, args);
      if (++calls === 24) {
        entered = true;
        if (retire) await f.mod.closeWindowsArmSdkOrigin(f.receipt);
        else
          git(
            f.root,
            "commit",
            "--allow-empty",
            "--quiet",
            "-m",
            "HEAD changes during final policy check",
          );
      }
      return result;
    };
    try {
      await assert.rejects(
        f.mod.verifyWindowsArmSdkProducer(f.receipt, records, archive, api),
        retire ? /OPAQUE_POLICY/ : /HEAD_CHANGED/,
      );
    } finally {
      prototype.stat = originalStat;
    }
    assert.equal(entered, true);
  }
});
test("actual retirement microtask between final policy await and public continuation denies mint and assert", async (t) => {
  for (const operation of ["mint", "assert"]) {
    const f = await fixture(t),
      p = packet(f),
      records = encoded(p),
      archive = artifact(records.producerSeal),
      { api } = apiFixture(f, p.producerSeal, archive);
    const binding =
      operation === "assert"
        ? await f.mod.verifyWindowsArmSdkProducer(
            f.receipt,
            records,
            archive,
            api,
          )
        : null;
    const originalGet = WeakMap.prototype.get;
    let armed = operation === "assert",
      checks = 0,
      retired = false,
      close;
    const observedApi = async (route) => {
      const result = await api(route);
      if (route.startsWith("git/trees/")) armed = true;
      return result;
    };
    WeakMap.prototype.get = function (key) {
      const result = originalGet.call(this, key);
      if (armed && key === f.receipt && result?.held && ++checks === 3) {
        queueMicrotask(() => {
          retired = true;
          close = f.mod.closeWindowsArmSdkOrigin(f.receipt);
        });
      }
      return result;
    };
    try {
      const action =
        operation === "mint"
          ? f.mod.verifyWindowsArmSdkProducer(
              f.receipt,
              records,
              archive,
              observedApi,
            )
          : f.mod.assertWindowsArmSdkProducerBinding(
              binding,
              f.receipt,
              digest(records.producerSeal),
            );
      await assert.rejects(action, /OPAQUE_POLICY/);
    } finally {
      WeakMap.prototype.get = originalGet;
      await close;
    }
    assert.equal(retired, true);
  }
});
