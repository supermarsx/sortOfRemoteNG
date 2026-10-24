// Review local bytes and pinned local evidence. This is not a hosted producer,
// native acceptance, an upload, or authorization to publish a runtime.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  readFile,
  lstat,
  realpath,
  readdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundle } from "../cef-runtime-ci.mjs";
import {
  validateSourceLock,
  identitySha256,
  preflightCustomRuntime,
  inspectCustomRuntimeExports,
} from "./browser-custom-runtime.mjs";
import {
  RELEASE_LIMITS,
  releaseRelativePath,
} from "./browser-runtime-release.mjs";
import { inspectNativeBinary } from "../browser-runtime-package.mjs";

const exec = promisify(execFile),
  ROOT = fileURLToPath(new URL("../../", import.meta.url)),
  hex = /^[a-f\d]{64}$/,
  commit = /^[a-f\d]{40}$/;
const origins = {
  "owned-linux-engine": "x86_64-unknown-linux-gnu",
  "existing-windows-package": "x86_64-pc-windows-msvc",
};
const evidenceNames = (origin) =>
  origin === "owned-linux-engine"
    ? ["prepared", "started", "container", "finished", "producer", "freshCheck"]
    : ["build"];
const fail = (message) => {
  throw Error(message);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function shape(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("Closed reviewed handoff fields required");
}
function pin(value) {
  shape(value, ["path", "sha256", "size"]);
  releaseRelativePath(value.path);
  if (
    !hex.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > RELEASE_LIMITS.metadata
  )
    fail("Bounded raw metadata pin required");
}

export function ownedSdkHandoffPlan(review) {
  shape(review, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "sourceLockIdentity",
    "descriptorSha256",
    "python",
    "evidence",
  ]);
  if (
    review.schemaVersion !== 1 ||
    review.kind !== "sorng-cef-owned-sdk-review" ||
    !Object.hasOwn(origins, review.origin) ||
    review.target !== origins[review.origin] ||
    !hex.test(review.sourceLockIdentity) ||
    !hex.test(review.descriptorSha256)
  )
    fail("Closed local SDK identity required");
  shape(review.python, ["path", "sha256", "size"]);
  if (
    !path.isAbsolute(review.python.path) ||
    !hex.test(review.python.sha256) ||
    !Number.isSafeInteger(review.python.size) ||
    review.python.size < 1 ||
    review.python.size > 64 * 1024 ** 2
  )
    fail("Explicit reviewed Python executable pin required");
  shape(review.evidence, evidenceNames(review.origin));
  for (const value of Object.values(review.evidence)) pin(value);
  return {
    ...structuredClone(review),
    verificationScope: "reviewed-local-bytes-and-evidence-bindings",
    productionReady: false,
    nativeAcceptance: "not-tested",
    hostedBuild: false,
    publicationAllowed: false,
    uploadAllowed: false,
  };
}

export function ownedHandoffReviewBinding(review) {
  ownedSdkHandoffPlan(review);
  return {
    canonicalReviewSha256: identitySha256(review),
    evidencePins: structuredClone(review.evidence),
    verificationPython: {
      sha256: review.python.sha256,
      size: review.python.size,
    },
  };
}

// These cross-file checks do not make JSON an authority. The operator must first
// review genuine records and pin their exact bytes in the closed review input.
export function verifyOwnedHandoffEvidence(review, records) {
  ownedSdkHandoffPlan(review);
  shape(records, evidenceNames(review.origin));
  if (review.origin === "existing-windows-package") {
    const e = records.build;
    if (
      e.built !== true ||
      e.sourceLockSha256 !== review.sourceLockIdentity ||
      !hex.test(e.libcefSha256) ||
      e.gnArgsUnchanged !== true ||
      e.acceptance !== "pending"
    )
      fail("Original Windows build evidence mismatch");
    return {
      origin: review.origin,
      engineSha256: e.libcefSha256,
      originalBuildRecordPinned: true,
      newEngineBuildClaimed: false,
    };
  }
  const {
    prepared: p,
    started: s,
    container: c,
    finished: f,
    producer: b,
    freshCheck: check,
  } = records;
  const operation = p.plan?.operation,
    source = p.plan?.sourceCommit,
    image = p.plan?.image;
  if (
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(operation ?? "") ||
    !commit.test(source ?? "") ||
    !/^sha256:[a-f\d]{64}$/.test(image ?? "") ||
    !hex.test(p.sourceArchiveSha256 ?? "") ||
    !hex.test(p.planSha256 ?? "") ||
    s.operation !== operation ||
    s.sourceCommit !== source ||
    s.image !== image ||
    s.sourceArchiveSha256 !== p.sourceArchiveSha256 ||
    s.planSha256 !== p.planSha256 ||
    s.replayAllowed !== false
  )
    fail("Prepared source and one-shot engine record mismatch");
  const x = check.result,
    fp = x?.plan,
    lock = validateSourceLock(x?.sourceLock);
  if (
    !hex.test(p.sourceInventorySha256 ?? "") ||
    p.extraction?.rootOwned !== true ||
    p.extraction?.sourceCommit !== source ||
    p.extraction?.sourceArchiveSha256 !== p.sourceArchiveSha256 ||
    p.extraction?.sourceInventorySha256 !== p.sourceInventorySha256 ||
    p.sealed?.sealed !== true ||
    p.sealed?.planSha256 !== p.planSha256 ||
    p.tools?.filesVerified !== 10 ||
    p.tools?.toolsRoot !== "/work/tools" ||
    p.tools?.engineBuildAttempted !== false ||
    p.tools?.pythonStdlibDependency !==
      "same immutable image /usr/lib/python3.12"
  )
    fail(
      "Prepared extraction, sealed inventory and actual tool check required",
    );
  if (
    check.engineBuildAttempted !== false ||
    check.publicationAllowed !== false ||
    fp?.operation !== operation ||
    fp.sourceCommit !== source ||
    fp.imageId !== image ||
    fp.sourceArchiveSha256 !== p.sourceArchiveSha256 ||
    fp.sourceInventorySha256 !== p.sourceInventorySha256 ||
    !hex.test(fp.sourceLockSha256 ?? "") ||
    fp.target !== review.target ||
    fp.runnerMode !== "dedicated" ||
    fp.repository !== "supermarsx/sortOfRemoteNG" ||
    fp.provenance !== "owned-local-container" ||
    fp.productionReady !== false ||
    fp.nativeAcceptance !== "not-tested" ||
    fp.publicationAllowed !== false ||
    identitySha256(lock) !== review.sourceLockIdentity ||
    x.confinement !== "actual-kernel-validated" ||
    x.imageIdentityAuthority !==
      "parent Docker inspect; not introspectable in child" ||
    x.productionReady !== false
  )
    fail("Fresh native source, image, toolchain and kernel check mismatch");
  if (
    identitySha256(fp.paths) !==
      identitySha256({
        checkout: "/opt/producer/checkout",
        archive: "/opt/producer/source.tar",
        inventory: "/opt/producer/source-inventory.json",
        tools: "/work/tools",
        temporary: "/work/build",
        scratch: "/work/tmp",
      }) ||
    x.home?.uid !== 10001 ||
    x.home?.gid !== 10001 ||
    x.home?.mode !== 0o700 ||
    x.home?.privateCacheWriteVerified !== true ||
    x.home?.cacheProbeRemoved !== true ||
    x.home?.mountAndAliasVerified !== true
  )
    fail("Fresh private HOME and fixed mount paths required");
  if (
    !commit.test(s.controllerCommit ?? "") ||
    c.controllerCommit !== s.controllerCommit ||
    f.controllerCommit !== s.controllerCommit ||
    c.sourceCommit !== source ||
    f.sourceCommit !== source ||
    c.image !== image ||
    c.name !== `/sorng-cef-owned-engine-${operation}` ||
    !hex.test(c.id ?? "") ||
    c.networkMode !== "bridge" ||
    c.user !== "10001:10001" ||
    c.readonlyRoot !== true ||
    c.memory !== 24 * 1024 ** 3 ||
    c.memorySwap !== c.memory ||
    c.nanoCpus !== 8e9 ||
    c.pids !== 512
  )
    fail("Owned engine identity or confinement record mismatch");
  if (
    f.reason !== "completed" ||
    f.result?.exitCode !== 0 ||
    f.result?.logFailure ||
    f.result?.streamExceeded ||
    f.result?.controllerFailure ||
    f.provenance !== "owned-local-container" ||
    f.productionReady !== false ||
    f.nativeAcceptance !== "not-tested" ||
    f.publicationAllowed !== false
  )
    fail("Completed owned engine without log failure required");
  if (
    b.state !== "completed" ||
    b.operation !== operation ||
    b.sourceCommit !== source ||
    b.imageIdReviewedExpectation !== image ||
    b.parentImageVerificationRequired !== true ||
    b.provenance !== "owned-local-container" ||
    b.productionReady !== false ||
    b.nativeAcceptance !== "not-tested" ||
    b.publicationAllowed !== false ||
    b.result?.target !== review.target ||
    b.result?.descriptorSha256 !== review.descriptorSha256 ||
    b.result?.nativeAcceptance !== "not-tested" ||
    b.result?.productionReady !== false
  )
    fail("Actual completed child bundle receipt required");
  return {
    origin: review.origin,
    operation,
    sourceCommit: source,
    controllerCommit: s.controllerCommit,
    image,
    sourceArchiveSha256: p.sourceArchiveSha256,
    sourceInventorySha256: p.sourceInventorySha256,
    originalInputsSourceLockRawSha256: fp.sourceLockSha256,
    toolchainLockSha256: lock.builds.find((row) => row.target === review.target)
      ?.toolchainLock.sha256,
    actualToolFilesVerified: p.tools.filesVerified,
    completedEngineRecordsPinned: true,
  };
}

async function regular(file, limit) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > limit ||
    (await realpath(file)) !== file
  )
    fail("Bounded canonical regular file required");
  return info;
}
async function pinned(root, value) {
  pin(value);
  const file = path.join(root, value.path);
  const info = await regular(file, RELEASE_LIMITS.metadata);
  const bytes = await readFile(file);
  if (
    info.size !== value.size ||
    bytes.length !== value.size ||
    hash(bytes) !== value.sha256
  )
    fail("Reviewed evidence raw pin mismatch");
  return bytes;
}
async function sourceInputs(inputs, identity, target) {
  await regular(path.join(inputs, "source-lock.json"), RELEASE_LIMITS.metadata);
  const bytes = await readFile(path.join(inputs, "source-lock.json"));
  const lock = validateSourceLock(JSON.parse(bytes));
  if (
    identitySha256(lock) !== identity ||
    lock.bridge.abiVersion !== 2 ||
    lock.bridge.patchId !== "sorng-tls-v2-682c378-4" ||
    lock.bridge.capabilities.length !== 8
  )
    fail("Original R4 input identity required without relabeling");
  const build = lock.builds.find((row) => row.target === target);
  if (!build) fail("Reviewed native target absent");
  for (const value of [
    ...lock.patches,
    lock.bridge.header,
    build.gnArgs,
    build.toolchainLock,
  ]) {
    releaseRelativePath(value.path);
    const file = path.join(inputs, value.path);
    await regular(file, RELEASE_LIMITS.metadata);
    if (hash(await readFile(file)) !== value.sha256)
      fail("Original source input raw pin mismatch");
  }
  return {
    lock,
    rawSha256: hash(bytes),
  };
}

export async function checkOwnedSdkHandoff({
  review,
  bundle,
  inputs,
  evidence,
  output,
  execute = false,
}) {
  if (execute !== true)
    fail("Explicit review-only local verification required");
  const plan = ownedSdkHandoffPlan(review),
    bundleRoot = await realpath(bundle),
    inputsRoot = await realpath(inputs),
    evidenceRoot = await realpath(evidence);
  const records = {};
  for (const [name, value] of Object.entries(review.evidence))
    records[name] = JSON.parse(await pinned(evidenceRoot, value));
  const provenance = verifyOwnedHandoffEvidence(review, records);
  const verifiedInputs = await sourceInputs(
    inputsRoot,
    review.sourceLockIdentity,
    review.target,
  );
  if (
    review.origin === "owned-linux-engine" &&
    records.freshCheck.result.plan.sourceLockSha256 !== verifiedInputs.rawSha256
  )
    fail("Fresh check does not bind original raw input lock");
  const descriptorFile = path.join(bundleRoot, "runtime.json");
  await regular(descriptorFile, RELEASE_LIMITS.descriptor);
  if (hash(await readFile(descriptorFile)) !== review.descriptorSha256)
    fail("Reviewed raw descriptor mismatch");
  const checked = await verifyBundle(bundleRoot, "supermarsx/sortOfRemoteNG");
  if (
    checked.identity.sourceLockSha256 !== review.sourceLockIdentity ||
    checked.descriptor.target !== review.target
  )
    fail("Transport source or target differs from original reviewed build");
  const expected = new Set(
    checked.assets.map((row) => path.basename(row.file)),
  );
  for (const name of await readdir(bundleRoot)) {
    if (!expected.has(name)) fail("Unexpected bundle entry");
    await regular(
      path.join(bundleRoot, name),
      name === checked.descriptor.archive.path
        ? RELEASE_LIMITS.archive
        : RELEASE_LIMITS.metadata,
    );
  }
  if (expected.size !== 5) fail("Exact five-asset transport bundle required");
  const python = await realpath(review.python.path),
    pythonInfo = await regular(python, 64 * 1024 ** 2);
  if (
    python !== review.python.path ||
    pythonInfo.size !== review.python.size ||
    hash(await readFile(python)) !== review.python.sha256
  )
    fail("Reviewed Python executable mismatch");
  const base = await realpath(path.join(ROOT, ".artifacts")),
    destination = path.resolve(output ?? "");
  if (
    path.dirname(destination) !== base ||
    !/^owned-sdk-handoff-[a-f\d-]{36}$/.test(path.basename(destination))
  )
    fail("New immediate owned artifact child required");
  await mkdir(destination, { mode: 0o700 });
  if ((await realpath(destination)) !== destination)
    fail("Owned output alias forbidden");
  const sourceBytes = await readFile(
      path.join(bundleRoot, checked.descriptor.sourceLock.path),
    ),
    manifestBytes = await readFile(
      path.join(bundleRoot, checked.descriptor.manifest.path),
    );
  if (
    hash(sourceBytes) !== checked.descriptor.sourceLock.sha256 ||
    hash(manifestBytes) !== checked.descriptor.manifest.sha256
  )
    fail("Pinned metadata changed during local verification");
  const archive = path.join(bundleRoot, checked.descriptor.archive.path),
    manifestFile = path.join(destination, "manifest.json"),
    roundtrip = path.join(destination, "roundtrip");
  await writeFile(manifestFile, manifestBytes, { flag: "wx" });
  const env = {
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  await exec(
    python,
    [
      "-I",
      "-B",
      path.join(ROOT, "scripts/lib/extract-custom-runtime.py"),
      archive,
      roundtrip,
      manifestFile,
      review.target,
      checked.descriptor.sdk.archiveRoot,
      String(RELEASE_LIMITS.expanded),
      String(RELEASE_LIMITS.members),
    ],
    { env, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 ** 2 },
  );
  const sdk = path.join(roundtrip, checked.descriptor.sdk.archiveRoot),
    sourceLock = validateSourceLock(JSON.parse(sourceBytes)),
    manifest = JSON.parse(manifestBytes);
  const preflight = await preflightCustomRuntime({
    sourceLock,
    manifest,
    target: review.target,
    artifactRoot: bundleRoot,
    sdkRoot: sdk,
  });
  const library = path.join(
    sdk,
    review.target.includes("windows") ? "libcef.dll" : "libcef.so",
  );
  await inspectNativeBinary(library, review.target);
  await inspectCustomRuntimeExports(
    library,
    review.target,
    sourceLock.bridge.patchId,
  );
  const engineSha256 = hash(await readFile(library));
  if (provenance.engineSha256 && provenance.engineSha256 !== engineSha256)
    fail("Transport engine differs from original Windows build evidence");
  const result = {
    kind: "sorng-cef-owned-sdk-handoff",
    schemaVersion: 1,
    target: review.target,
    sourceLockIdentity: checked.identity.sourceLockSha256,
    bundleSourceLockRawSha256: checked.descriptor.sourceLock.sha256,
    originalInputsSourceLockRawSha256: verifiedInputs.rawSha256,
    descriptorSha256: review.descriptorSha256,
    assets: checked.assets.map(({ name, sha256, size }) => ({
      name,
      sha256,
      size,
    })),
    provenance,
    reviewBinding: ownedHandoffReviewBinding(review),
    engineSha256,
    filesVerified: preflight.filesVerified,
    archiveSdkRelationship: "extracted-and-inventory-verified",
    verificationScope: plan.verificationScope,
    productionReady: false,
    nativeAcceptance: "not-tested",
    hostedBuild: false,
    publicationAllowed: false,
    uploadAllowed: false,
  };
  await writeFile(
    path.join(destination, "handoff.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  return result;
}

export async function readOwnedSdkReview(file) {
  const resolved = await realpath(file);
  await regular(resolved, 1024 * 1024);
  const review = JSON.parse(await readFile(resolved, "utf8"));
  ownedSdkHandoffPlan(review);
  return review;
}
