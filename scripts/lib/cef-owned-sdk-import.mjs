// Explicit operator-reviewed local byte ingestion. This never proves a hosted
// build, native acceptance, runtime readiness or publication authority.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  readdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundle } from "../cef-runtime-ci.mjs";
import {
  identitySha256,
  validateSourceLock,
  preflightCustomRuntime,
  inspectCustomRuntimeExports,
} from "./browser-custom-runtime.mjs";
import { inspectNativeBinary } from "../browser-runtime-package.mjs";
import {
  WINDOWS_INCREMENTAL_EVIDENCE,
  WINDOWS_INCREMENTAL_PROVENANCE,
  WINDOWS_OPERATION2_ORIGIN,
  WINDOWS_OPERATION2_PROVENANCE,
  WINDOWS_OPERATION2_CLANG,
  isWindowsCapsuleOrigin,
  ownedCapsuleEvidence,
  WINDOWS_CAPSULE_IDENTITY,
  WINDOWS_CAPSULE_PROVENANCE,
  ownedEvidenceLimit,
} from "./cef-owned-sdk-handoff.mjs";
import {
  RELEASE_LIMITS,
  releaseRelativePath,
} from "./browser-runtime-release.mjs";
import {
  downloadAsset,
  archiveCommand,
  canonical,
} from "./cef-engineering-checkpoint.mjs";

export const OWNED_WORKFLOW = ".github/workflows/cef-owned-sdk-import.yml";
export const OWNED_REPOSITORY = "supermarsx/sortOfRemoteNG";
export const REVIEW_PREFIX = "native/cef-owned-sdk-imports/";
export const OWNED_LIMITS = Object.freeze({
  review: 1024 ** 2,
  seal: 1024 ** 2,
  metadata: 16 * 1024 ** 2,
  milliseconds: 40 * 60_000,
});
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const origins = {
  "existing-windows-package": "x86_64-pc-windows-msvc",
  "owned-linux-engine": "x86_64-unknown-linux-gnu",
  "owned-windows-incremental-engine": "x86_64-pc-windows-msvc",
  "owned-windows-capsule-lifetime-engine": "x86_64-pc-windows-msvc",
  "owned-windows-capsule-lifetime-operation2": "x86_64-pc-windows-msvc",
};
export function parseOwnedJson(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    throw new Error("Invalid owned-import JSON");
  }
}
export const ownedSha = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const digest = (value) =>
  assert(
    typeof value === "string" &&
      /^[a-f0-9]{64}$/.test(value) &&
      !/^0+$/.test(value),
    "Reviewed digest required",
  );
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function exact(value, keys) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === [...keys].sort().join(),
    "Closed owned-import fields required",
  );
}
function rawPin(pin, maximum = RELEASE_LIMITS.metadata) {
  exact(pin, ["path", "sha256", "size"]);
  releaseRelativePath(pin.path);
  digest(pin.sha256);
  assert(
    pin.path.length <= 256 && positive(pin.size) && pin.size <= maximum,
    "Bounded relative raw evidence pin required",
  );
}
export function reviewedImportPath(value) {
  assert(
    typeof value === "string" &&
      /^native\/cef-owned-sdk-imports\/[a-z0-9][a-z0-9.-]{0,95}\/review\.json$/.test(
        value,
      ),
    "Committed owned-import review namespace required",
  );
  return value;
}
export function validateOwnedReview(review) {
  exact(review, [
    "schemaVersion",
    "kind",
    "origin",
    "target",
    "sourceLockIdentity",
    "bundleSourceLockRawSha256",
    "originalInputsSourceLockRawSha256",
    "descriptorSha256",
    "handoffSha256",
    "reviewBinding",
    "assets",
    "engineSha256",
    "filesVerified",
  ]);
  assert(
    review.schemaVersion === 1 &&
      review.kind === "sorng-cef-owned-import-review" &&
      Object.hasOwn(origins, review.origin) &&
      origins[review.origin] === review.target,
    "Closed operator-reviewed local provenance required",
  );
  for (const key of [
    "sourceLockIdentity",
    "bundleSourceLockRawSha256",
    "originalInputsSourceLockRawSha256",
    "descriptorSha256",
    "handoffSha256",
    "engineSha256",
  ])
    digest(review[key]);
  assert(
    positive(review.filesVerified) &&
      review.filesVerified <= RELEASE_LIMITS.members,
    "Bounded verified SDK inventory required",
  );
  exact(review.reviewBinding, [
    "canonicalReviewSha256",
    "evidencePins",
    "verificationPython",
  ]);
  digest(review.reviewBinding.canonicalReviewSha256);
  const names = isWindowsCapsuleOrigin(review.origin)
    ? ownedCapsuleEvidence(review.origin)
    : review.origin === "owned-windows-incremental-engine"
      ? WINDOWS_INCREMENTAL_EVIDENCE
      : review.origin === "existing-windows-package"
        ? ["build"]
        : [
            "prepared",
            "started",
            "container",
            "finished",
            "producer",
            "freshCheck",
          ];
  exact(review.reviewBinding.evidencePins, names);
  for (const [role, pin] of Object.entries(review.reviewBinding.evidencePins))
    rawPin(pin, ownedEvidenceLimit(review.origin, role));
  if (isWindowsCapsuleOrigin(review.origin))
    assert(
      review.sourceLockIdentity === WINDOWS_CAPSULE_IDENTITY &&
        Object.values(review.reviewBinding.evidencePins).reduce(
          (sum, pin) => sum + pin.size,
          0,
        ) <=
          96 * 1024 ** 2,
      "Closed capsule identity and evidence total required",
    );
  exact(review.reviewBinding.verificationPython, ["sha256", "size"]);
  digest(review.reviewBinding.verificationPython.sha256);
  assert(
    positive(review.reviewBinding.verificationPython.size) &&
      review.reviewBinding.verificationPython.size <= 64 * 1024 ** 2,
    "Original verifier digest required; private paths forbidden",
  );
  assert(
    Array.isArray(review.assets) && review.assets.length === 5,
    "Exact five bundle assets required",
  );
  const expected = new Set([
    "runtime.json",
    "source-lock.json",
    "manifest.json",
    "receipt.json",
    `sorng-cef-custom-${review.sourceLockIdentity}-${review.target}.tar.bz2`,
  ]);
  for (const row of review.assets) {
    exact(row, ["name", "bytes", "sha256"]);
    digest(row.sha256);
    assert(
      expected.delete(row.name) &&
        positive(row.bytes) &&
        row.bytes <=
          (row.name.endsWith(".tar.bz2")
            ? RELEASE_LIMITS.archive
            : RELEASE_LIMITS.metadata),
      "Unknown/duplicate/unbounded owned bundle asset",
    );
  }
  assert(
    expected.size === 0 &&
      review.assets.find((row) => row.name === "runtime.json").sha256 ===
        review.descriptorSha256 &&
      review.assets.find((row) => row.name === "source-lock.json").sha256 ===
        review.bundleSourceLockRawSha256,
    "Raw descriptor/source binding differs",
  );
  return review;
}
async function noLinks(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const segment of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    assert(
      !(await lstat(current)).isSymbolicLink(),
      "Owned import paths cannot contain links",
    );
  }
}
async function regular(file, maximum) {
  await noLinks(file);
  const info = await lstat(file);
  assert(
    info.isFile() && positive(info.size) && info.size <= maximum,
    "Bounded regular import file required",
  );
  return info;
}
export async function readOwnedImportReview(root, relative, expectedSha) {
  reviewedImportPath(relative);
  digest(expectedSha);
  const base = await realpath(root),
    file = path.join(base, relative);
  await regular(file, OWNED_LIMITS.review);
  const bytes = await readFile(file);
  assert(
    ownedSha(bytes) === expectedSha,
    "Independently reviewed raw review bytes differ",
  );
  return validateOwnedReview(parseOwnedJson(bytes));
}
export function validateLocalHandoff(review, bytes) {
  validateOwnedReview(review);
  assert(
    bytes.length <= OWNED_LIMITS.review &&
      ownedSha(bytes) === review.handoffSha256,
    "Genuine current handoff raw digest required",
  );
  const value = parseOwnedJson(bytes);
  exact(value, [
    "kind",
    "schemaVersion",
    "target",
    "sourceLockIdentity",
    "bundleSourceLockRawSha256",
    "originalInputsSourceLockRawSha256",
    "descriptorSha256",
    "assets",
    "provenance",
    "reviewBinding",
    "engineSha256",
    "filesVerified",
    "archiveSdkRelationship",
    "verificationScope",
    "productionReady",
    "nativeAcceptance",
    "hostedBuild",
    "publicationAllowed",
    "uploadAllowed",
  ]);
  assert(
    value.kind === "sorng-cef-owned-sdk-handoff" &&
      value.schemaVersion === 1 &&
      value.hostedBuild === false &&
      value.nativeAcceptance === "not-tested" &&
      value.productionReady === false &&
      value.publicationAllowed === false &&
      value.uploadAllowed === false &&
      value.archiveSdkRelationship === "extracted-and-inventory-verified" &&
      value.verificationScope ===
        "reviewed-local-bytes-and-evidence-bindings" &&
      value.provenance?.origin === review.origin,
    "Local handoff is not build/publication authority",
  );
  if (review.origin === "existing-windows-package") {
    exact(value.provenance, [
      "origin",
      "engineSha256",
      "originalBuildRecordPinned",
      "newEngineBuildClaimed",
    ]);
    assert(
      value.provenance.originalBuildRecordPinned === true &&
        value.provenance.newEngineBuildClaimed === false &&
        value.provenance.engineSha256 === review.engineSha256,
      "Original Windows evidence identity differs",
    );
  } else if (isWindowsCapsuleOrigin(review.origin)) {
    const operation2 = review.origin === WINDOWS_OPERATION2_ORIGIN;
    exact(
      value.provenance,
      operation2 ? WINDOWS_OPERATION2_PROVENANCE : WINDOWS_CAPSULE_PROVENANCE,
    );
    const p = value.provenance;
    digest(p.baselineEngineSha256);
    exact(
      p.reviewedEvidenceDigests,
      ownedCapsuleEvidence(review.origin).filter((role) => role !== "build"),
    );
    for (const [role, sha] of Object.entries(p.reviewedEvidenceDigests))
      assert(
        sha === review.reviewBinding.evidencePins[role].sha256,
        "Original capsule raw evidence differs",
      );
    exact(p.nestedOriginalRecordDigests, [
      "nativeManifest",
      "nativeStageReceipts",
      "nativeObservations",
      "nativeReceipt",
      "generatedFlags",
      "engineRecord",
      ...(operation2 ? ["previousEngineAttempt", "engineAccounting"] : []),
    ]);
    const nested = p.nestedOriginalRecordDigests;
    for (const role of [
      "nativeManifest",
      "nativeReceipt",
      "generatedFlags",
      "engineRecord",
      ...(operation2 ? ["engineAccounting"] : []),
    ])
      digest(nested[role]);
    exact(nested.nativeStageReceipts, [
      "apply-check",
      "apply-test-dependency",
      "security-build",
      "owned-quic-lifetime-full-list",
      "owned-quic-lifetime-full-run",
      "brp-dpd-list",
      "brp-dpd-run",
      "sandbox-list",
      "sandbox-run",
    ]);
    for (const sha of Object.values(nested.nativeStageReceipts)) digest(sha);
    assert(
      Array.isArray(nested.nativeObservations) &&
        nested.nativeObservations.length === 4,
      "Original observation digest set required",
    );
    for (const sha of nested.nativeObservations) digest(sha);
    assert(
      nested.engineRecord === review.reviewBinding.evidencePins.engine.sha256,
      "Original engine record digest differs",
    );
    if (operation2) {
      digest(p.previousFailedAttemptDigest);
      digest(p.engineAccountingDigest);
      exact(nested.previousEngineAttempt, ["report", "manifest", "receipt"]);
      for (const sha of Object.values(nested.previousEngineAttempt))
        digest(sha);
      assert(
        p.previousFailedAttemptDigest ===
          review.reviewBinding.evidencePins.previousEngineAttempt.sha256 &&
          p.engineAccountingDigest ===
            review.reviewBinding.evidencePins.engineAccounting.sha256 &&
          nested.engineAccounting === p.engineAccountingDigest,
        "Operation2 original evidence digests differ",
      );
      exact(p.separatelyObservedClang, ["sha256", "bytes", "qualification"]);
      assert(
        p.separatelyObservedClang.sha256 === WINDOWS_OPERATION2_CLANG.sha256 &&
          p.separatelyObservedClang.bytes === WINDOWS_OPERATION2_CLANG.bytes &&
          p.separatelyObservedClang.qualification ===
            WINDOWS_OPERATION2_CLANG.provenance,
        "Separately observed Clang identity differs",
      );
      exact(p.engineOperationPolicy, [
        "jobs",
        "cpuRate",
        "memoryBytes",
        "activeLimit",
        "deadlineUtc",
        "originalFailedDeadlineUtc",
      ]);
      const policy = p.engineOperationPolicy;
      assert(
        policy.jobs === 12 &&
          policy.cpuRate === 3000 &&
          policy.memoryBytes === "34359738368" &&
          policy.activeLimit === 128 &&
          Number.isFinite(Date.parse(policy.deadlineUtc)) &&
          policy.originalFailedDeadlineUtc === "2026-10-25T00:35:33Z",
        "Operation2 policy differs",
      );
    }
    assert(
      p.engineSha256 === review.engineSha256 &&
        p.baselineEngineSha256 !== review.engineSha256 &&
        /^[a-f0-9]{40}$/.test(p.originalControllerCommit) &&
        p.actualToolFilesVerified === 8 &&
        p.nativeClassTestsPassed === 42 &&
        JSON.stringify(p.nativeProfileCounts) === "[36,3,3]" &&
        p.actualSourceFilesVerified === 9 &&
        p.securityMacroCount === 61 &&
        p.instanceTracerEnabled === false &&
        p.incrementalBuild === true &&
        p.originalBuildRecordsPinned === true &&
        p.originalBuildReplayed === false &&
        p.pristineSourceBuild === false &&
        p.derivedFacts === true,
      "Original capsule Windows evidence identity differs",
    );
  } else if (review.origin === "owned-windows-incremental-engine") {
    exact(value.provenance, WINDOWS_INCREMENTAL_PROVENANCE);
    digest(value.provenance.baselineEngineSha256);
    assert(
      value.provenance.engineSha256 === review.engineSha256 &&
        value.provenance.baselineEngineSha256 !== review.engineSha256 &&
        /^[a-f0-9]{40}$/.test(value.provenance.originalControllerCommit) &&
        value.provenance.actualToolFilesVerified === 8 &&
        value.provenance.nativeClassTestsPassed === 12 &&
        value.provenance.incrementalBuild === true &&
        value.provenance.originalBuildRecordsPinned === true &&
        value.provenance.originalBuildReplayed === false &&
        value.provenance.pristineSourceBuild === false,
      "Original incremental Windows evidence identity differs",
    );
  } else {
    exact(value.provenance, [
      "origin",
      "operation",
      "sourceCommit",
      "controllerCommit",
      "image",
      "sourceArchiveSha256",
      "sourceInventorySha256",
      "originalInputsSourceLockRawSha256",
      "toolchainLockSha256",
      "actualToolFilesVerified",
      "completedEngineRecordsPinned",
    ]);
    assert(
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        value.provenance.operation,
      ) &&
        /^[a-f0-9]{40}$/.test(value.provenance.sourceCommit) &&
        /^[a-f0-9]{40}$/.test(value.provenance.controllerCommit) &&
        /^sha256:[a-f0-9]{64}$/.test(value.provenance.image) &&
        value.provenance.originalInputsSourceLockRawSha256 ===
          review.originalInputsSourceLockRawSha256 &&
        positive(value.provenance.actualToolFilesVerified) &&
        value.provenance.actualToolFilesVerified <= 64 &&
        value.provenance.completedEngineRecordsPinned === true,
      "Original owned Linux evidence identity differs",
    );
    for (const key of [
      "sourceArchiveSha256",
      "sourceInventorySha256",
      "toolchainLockSha256",
    ])
      digest(value.provenance[key]);
  }
  for (const key of [
    "target",
    "sourceLockIdentity",
    "bundleSourceLockRawSha256",
    "originalInputsSourceLockRawSha256",
    "descriptorSha256",
    "engineSha256",
    "filesVerified",
  ])
    assert(value[key] === review[key], "Reviewed handoff identity differs");
  assert(
    canonical(value.reviewBinding) === canonical(review.reviewBinding),
    "Reviewed original evidence differs",
  );
  const assets = value.assets.map(({ name, size, sha256 }) => ({
    name,
    bytes: size,
    sha256,
  }));
  assert(
    canonical(ordered(assets)) === canonical(ordered(review.assets)),
    "Reviewed handoff asset set differs",
  );
  return value;
}
const ordered = (rows) =>
  [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
export async function verifyOwnedBundle(
  bundle,
  review,
  repository = OWNED_REPOSITORY,
) {
  validateOwnedReview(review);
  assert(repository === OWNED_REPOSITORY, "Owned repository required");
  const root = await realpath(bundle);
  await noLinks(root);
  const entries = await readdir(root);
  assert(entries.length === 5, "Owned bundle must contain exactly five files");
  for (const pin of review.assets) {
    const file = path.join(root, pin.name);
    assert(
      (await regular(file, pin.bytes)).size === pin.bytes,
      "Owned asset size differs",
    );
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
      bytes += chunk.length;
      assert(bytes <= pin.bytes, "Owned asset grew");
      hash.update(chunk);
    }
    assert(
      bytes === pin.bytes && hash.digest("hex") === pin.sha256,
      "Owned asset raw bytes differ",
    );
  }
  const checked = await verifyBundle(root, repository);
  assert(
    checked.descriptor.target === review.target &&
      checked.identity.sourceLockSha256 === review.sourceLockIdentity &&
      checked.descriptorSha256 === review.descriptorSha256,
    "Owned source/target/descriptor differs",
  );
  assert(
    canonical(
      ordered(
        checked.assets.map(({ name, size, sha256 }) => ({
          name,
          bytes: size,
          sha256,
        })),
      ),
    ) === canonical(ordered(review.assets)),
    "Verified five assets differ",
  );
  return checked;
}
export async function verifyOwnedArchive(
  bundle,
  review,
  output,
  python,
  { verify = verifyOwnedBundle } = {},
) {
  const checked = await verify(bundle, review);
  await mkdir(output);
  await noLinks(output);
  const manifest = path.join(bundle, checked.descriptor.manifest.path),
    roundtrip = path.join(output, "roundtrip");
  await execute(
    python,
    [
      "-I",
      "-B",
      path.join(ROOT, "scripts/lib/extract-custom-runtime.py"),
      path.join(bundle, checked.descriptor.archive.path),
      roundtrip,
      manifest,
      review.target,
      checked.descriptor.sdk.archiveRoot,
      String(RELEASE_LIMITS.expanded),
      String(RELEASE_LIMITS.members),
    ],
    {
      env: {
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        PYTHONDONTWRITEBYTECODE: "1",
      },
      windowsHide: true,
      timeout: 20 * 60_000,
      maxBuffer: 2 * 1024 ** 2,
    },
  );
  const sdk = path.join(roundtrip, checked.descriptor.sdk.archiveRoot);
  const sourceLock = validateSourceLock(
    JSON.parse(
      await readFile(path.join(bundle, checked.descriptor.sourceLock.path)),
    ),
  );
  const preflight = await preflightCustomRuntime({
    sourceLock,
    manifest: JSON.parse(await readFile(manifest)),
    target: review.target,
    artifactRoot: bundle,
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
  assert(
    preflight.filesVerified === review.filesVerified &&
      ownedSha(await readFile(library)) === review.engineSha256,
    "Reviewed engine/inventory differs",
  );
  return checked;
}
export function importSealName(runId, attempt) {
  assert(positive(runId) && positive(attempt), "Exact import attempt required");
  return `cef-owned-import-seal-${runId}-${attempt}`;
}
export function quarantineTag(review, reviewSha) {
  validateOwnedReview(review);
  digest(reviewSha);
  return `cef-owned-quarantine-${review.target}-${reviewSha}`;
}
export function validateImportProducer(producer) {
  exact(producer, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
    "workflowId",
    "codeSha256",
  ]);
  assert(
    producer.repository === OWNED_REPOSITORY &&
      positive(producer.repositoryId) &&
      positive(producer.runId) &&
      positive(producer.attempt) &&
      positive(producer.workflowId) &&
      /^[a-f0-9]{40}$/.test(producer.head) &&
      typeof producer.branch === "string" &&
      producer.branch.length > 0 &&
      producer.branch.length <= 256 &&
      producer.workflow === OWNED_WORKFLOW,
    "Exact manual importer identity required",
  );
  digest(producer.codeSha256);
  return producer;
}
export async function verifyImportProducer(
  api,
  producer,
  { completed = false } = {},
) {
  validateImportProducer(producer);
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api("actions/workflows/cef-owned-sdk-import.yml"),
    api(`actions/runs/${producer.runId}`),
  ]);
  assert(
    repo.full_name === producer.repository &&
      repo.id === producer.repositoryId &&
      repo.private === false &&
      repo.default_branch === producer.branch &&
      workflow.path === OWNED_WORKFLOW &&
      workflow.id === producer.workflowId,
    "Default-branch public importer required",
  );
  assert(
    run.id === producer.runId &&
      run.head_sha === producer.head &&
      run.head_branch === producer.branch &&
      run.run_attempt === producer.attempt &&
      run.workflow_id === producer.workflowId &&
      run.event === "workflow_dispatch" &&
      run.path === OWNED_WORKFLOW &&
      run.repository?.id === repo.id &&
      run.repository?.full_name === repo.full_name &&
      run.head_repository?.id === repo.id &&
      run.head_repository?.full_name === repo.full_name &&
      (completed
        ? run.status === "completed" && run.conclusion === "success"
        : run.status === "in_progress"),
    "Exact successful importer run/attempt required",
  );
  const commit = await api(`git/commits/${producer.head}`);
  assert(
    /^[a-f0-9]{40}$/.test(commit.tree?.sha),
    "Importer source tree required",
  );
  const tree = await api(`git/trees/${commit.tree.sha}?recursive=1`);
  assert(
    tree.truncated === false &&
      Array.isArray(tree.tree) &&
      tree.tree.length <= 100000,
    "Complete bounded importer source tree required",
  );
  assert(
    importCodeDigest(tree.tree) === producer.codeSha256,
    "Importer source code differs",
  );
  return run;
}
export function importCodeDigest(entries) {
  const rows = entries
    .filter((row) => row.type !== "tree")
    .filter(
      (row) =>
        row.path?.startsWith("scripts/") ||
        row.path === ".node-version" ||
        row.path === OWNED_WORKFLOW,
    )
    .map(({ mode, type, sha, path: name }) => ({
      mode,
      type,
      sha,
      path: name,
    }));
  assert(
    rows.length > 3 &&
      rows.some((row) => row.path === OWNED_WORKFLOW) &&
      rows.some((row) => row.path === "scripts/lib/cef-owned-sdk-import.mjs") &&
      rows.some((row) => row.path === ".node-version") &&
      rows.every(
        (row) =>
          ["100644", "100755"].includes(row.mode) &&
          row.type === "blob" &&
          /^[a-f0-9]{40}$/.test(row.sha),
      ),
    "Complete regular committed importer code required",
  );
  return identitySha256(
    rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
}
function validateAssets(review, assets) {
  assert(
    Array.isArray(assets) &&
      assets.length === 5 &&
      new Set(assets.map((row) => row.id)).size === 5,
    "Exact five unique draft assets required",
  );
  for (const pin of review.assets) {
    const row = assets.find((value) => value.name === pin.name);
    assert(
      row &&
        positive(row.id) &&
        row.state === "uploaded" &&
        row.size === pin.bytes &&
        row.digest === `sha256:${pin.sha256}`,
      "Draft asset differs from independent raw review",
    );
  }
  return ordered(
    assets.map((row) => ({
      id: row.id,
      name: row.name,
      bytes: row.size,
      sha256: row.digest.slice(7),
    })),
  );
}
export async function ownedDraft(api, review, reviewSha, releaseId) {
  assert(positive(releaseId), "Exact quarantine release required");
  const [release, assets] = await Promise.all([
    api(`releases/${releaseId}`),
    api(`releases/${releaseId}/assets?per_page=100`),
  ]);
  assert(
    release.id === releaseId &&
      release.draft === true &&
      release.prerelease === true &&
      release.tag_name === quarantineTag(review, reviewSha),
    "Owned draft quarantine required; no published release accepted",
  );
  assert(
    /^[a-f0-9]{40}$/.test(release.target_commitish),
    "Exact quarantine commit required",
  );
  return {
    release: {
      id: releaseId,
      tag: release.tag_name,
      targetCommit: release.target_commitish,
    },
    assets: validateAssets(review, assets),
  };
}
export function validateImportCompletion(value) {
  exact(value, [
    "schemaVersion",
    "kind",
    "producer",
    "reviewedImport",
    "reviewSha256",
    "review",
    "release",
    "assets",
    "ingestion",
    "hostedBuild",
    "originalBuildReplayed",
    "bundleVerified",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    value.schemaVersion === 1 &&
      value.kind === "sorng-cef-owned-import-completion" &&
      value.ingestion === "operator-reviewed-local-bytes" &&
      value.hostedBuild === false &&
      value.originalBuildReplayed === false &&
      value.bundleVerified === true &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "Only reviewed local byte ingestion is attested",
  );
  validateImportProducer(value.producer);
  reviewedImportPath(value.reviewedImport);
  digest(value.reviewSha256);
  validateOwnedReview(value.review);
  exact(value.release, ["id", "tag", "targetCommit"]);
  assert(
    /^[a-f0-9]{40}$/.test(value.release.targetCommit) &&
      positive(value.release.id) &&
      value.release.tag === quarantineTag(value.review, value.reviewSha256),
    "Owned quarantine binding required",
  );
  assert(
    Array.isArray(value.assets) && value.assets.length === 5,
    "Sealed asset set required",
  );
  for (const row of value.assets) exact(row, ["id", "name", "bytes", "sha256"]);
  validateAssets(
    value.review,
    value.assets.map((row) => ({
      id: row.id,
      name: row.name,
      size: row.bytes,
      digest: `sha256:${row.sha256}`,
      state: "uploaded",
    })),
  );
  return value;
}
export const ownedCompletionSha = (value) => ownedSha(canonical(value) + "\n");
export function validateImportSeal(seal) {
  exact(seal, ["schemaVersion", "kind", "completion", "completionSha256"]);
  assert(
    seal.schemaVersion === 1 && seal.kind === "sorng-cef-owned-import-seal",
    "Owned seal kind required",
  );
  validateImportCompletion(seal.completion);
  assert(
    ownedCompletionSha(seal.completion) === seal.completionSha256,
    "Owned completion digest differs",
  );
  return seal;
}
// The uploader retains its API token; no verifier/Python descendant inherits it.
export async function tokenFreeNode(
  script,
  args,
  { environment = process.env } = {},
) {
  return execute(process.execPath, [script, ...args], {
    env: {
      ...(environment.SystemRoot ? { SystemRoot: environment.SystemRoot } : {}),
    },
    windowsHide: true,
    timeout: 10 * 60_000,
    maxBuffer: 2 * 1024 ** 2,
  });
}
export async function freshLocalHandoff(
  { bundle, localReview, inputs, evidence, verifyOutput },
  review,
) {
  await tokenFreeNode(path.join(ROOT, "scripts/cef-owned-sdk-handoff.mjs"), [
    "check",
    "--reviewed",
    localReview,
    "--bundle",
    bundle,
    "--inputs",
    inputs,
    "--evidence",
    evidence,
    "--output",
    verifyOutput,
    "--execute",
  ]);
  const fresh = await readFile(path.join(verifyOutput, "handoff.json"));
  validateLocalHandoff(review, fresh);
  return fresh;
}
export async function quarantineOwnedBundle(
  api,
  { bundle, review, reviewSha, handoff, commit, execute: confirmed = false },
  { verify = verifyOwnedBundle } = {},
) {
  assert(
    confirmed === true && /^[a-f0-9]{40}$/.test(commit ?? ""),
    "Explicit quarantine upload and commit required",
  );
  digest(reviewSha);
  validateLocalHandoff(review, handoff);
  await verify(bundle, review);
  const tag = quarantineTag(review, reviewSha);
  const release = await api("releases", {
    method: "POST",
    body: {
      tag_name: tag,
      target_commitish: commit,
      name: tag,
      draft: true,
      prerelease: true,
      make_latest: "false",
      body: "Operator-reviewed local SDK quarantine. Not a hosted build, native acceptance or runtime release.",
    },
  });
  assert(
    positive(release.id) && release.draft === true && release.tag_name === tag,
    "New draft required",
  );
  const uploadedIds = new Set();
  for (const pin of review.assets) {
    const body = createReadStream(path.join(bundle, pin.name));
    try {
      const row = await api(
        `releases/${release.id}/assets?name=${encodeURIComponent(pin.name)}`,
        { method: "POST", upload: true, body, bytes: pin.bytes },
      );
      assert(
        positive(row.id) &&
          !uploadedIds.has(row.id) &&
          row.name === pin.name &&
          row.size === pin.bytes &&
          row.digest === `sha256:${pin.sha256}` &&
          row.state === "uploaded",
        "New uploaded asset differs",
      );
      uploadedIds.add(row.id);
    } finally {
      body.destroy();
    }
  }
  const draft = await ownedDraft(api, review, reviewSha, release.id);
  return {
    ...draft,
    hostedBuild: false,
    nativeAcceptance: false,
    publicationAllowed: false,
  };
}
export async function sealOwnedImport(
  api,
  {
    review,
    reviewSha,
    reviewedImport,
    releaseId,
    bundle,
    output,
    producer,
    repository = OWNED_REPOSITORY,
    token,
    python,
    request = fetch,
  },
  { verify = verifyOwnedArchive, download = downloadAsset } = {},
) {
  validateOwnedReview(review);
  digest(reviewSha);
  reviewedImportPath(reviewedImport);
  validateImportProducer(producer);
  await verifyImportProducer(api, producer);
  const before = await ownedDraft(api, review, reviewSha, releaseId);
  await mkdir(bundle);
  await noLinks(bundle);
  await mkdir(output);
  await noLinks(output);
  const deadline = Date.now() + 20 * 60_000;
  for (const pin of before.assets)
    await download(
      repository,
      token,
      `/releases/assets/${pin.id}`,
      path.join(bundle, pin.name),
      pin,
      {
        request,
        maximum: pin.name.endsWith(".tar.bz2")
          ? RELEASE_LIMITS.archive
          : RELEASE_LIMITS.metadata,
        deadline,
      },
    );
  await verify(bundle, review, path.join(output, "verified"), python);
  const after = await ownedDraft(api, review, reviewSha, releaseId);
  assert(
    canonical(before) === canonical(after),
    "Draft changed during verification",
  );
  await verifyImportProducer(api, producer);
  const completion = validateImportCompletion({
    schemaVersion: 1,
    kind: "sorng-cef-owned-import-completion",
    producer,
    reviewedImport,
    reviewSha256: reviewSha,
    review,
    release: after.release,
    assets: after.assets,
    ingestion: "operator-reviewed-local-bytes",
    hostedBuild: false,
    originalBuildReplayed: false,
    bundleVerified: true,
    nativeAcceptance: false,
    runtimeReady: false,
  });
  const seal = validateImportSeal({
    schemaVersion: 1,
    kind: "sorng-cef-owned-import-seal",
    completion,
    completionSha256: ownedCompletionSha(completion),
  });
  const bytes = Buffer.from(canonical(seal) + "\n");
  assert(bytes.length < OWNED_LIMITS.seal, "Owned seal bound");
  // LAST: no failure path above creates success authority.
  await writeFile(path.join(output, "seal.json"), bytes, { flag: "wx" });
  return seal;
}
export function ownedImportApi(
  repository,
  token,
  request = fetch,
  { write = false, review, reviewSha } = {},
) {
  assert(
    repository === OWNED_REPOSITORY &&
      typeof token === "string" &&
      token.length > 0,
    "Scoped owned-repository token required",
  );
  const deadline = Date.now() + OWNED_LIMITS.milliseconds;
  if (write) {
    validateOwnedReview(review);
    digest(reviewSha);
  }
  return async (
    route,
    { method = "GET", body, upload = false, bytes } = {},
  ) => {
    assert(Date.now() < deadline, "Owned import transport deadline");
    const read =
      /^(?:|actions\/workflows\/cef-owned-sdk-import\.yml|actions\/runs\/[1-9][0-9]*(?:\/artifacts\?per_page=100)?|actions\/artifacts\/[1-9][0-9]*|releases\/[1-9][0-9]*(?:\/assets\?per_page=100)?|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/;
    const append = /^releases\/[1-9][0-9]*\/assets\?name=[A-Za-z0-9_.%-]+$/;
    assert(
      (method === "GET" && !upload && !body && read.test(route)) ||
        (write &&
          method === "POST" &&
          ((route === "releases" && !upload) ||
            (upload &&
              append.test(route) &&
              positive(bytes) &&
              bytes <= RELEASE_LIMITS.archive))),
      "Closed append-only owned import API required",
    );
    if (method === "POST" && !upload) {
      exact(body, [
        "tag_name",
        "target_commitish",
        "name",
        "draft",
        "prerelease",
        "make_latest",
        "body",
      ]);
      assert(
        body.draft === true &&
          body.prerelease === true &&
          body.make_latest === "false" &&
          body.tag_name === quarantineTag(review, reviewSha) &&
          body.name === body.tag_name &&
          /^[a-f0-9]{40}$/.test(body.target_commitish) &&
          body.body ===
            "Operator-reviewed local SDK quarantine. Not a hosted build, native acceptance or runtime release.",
        "Only a new owned draft can be created",
      );
    }
    if (upload)
      assert(
        review.assets.some(
          (pin) =>
            route.endsWith(`?name=${encodeURIComponent(pin.name)}`) &&
            bytes === pin.bytes,
        ),
        "Only reviewed five assets may be appended",
      );
    const response = await request(
      `${upload ? "https://uploads.github.com" : "https://api.github.com"}/repos/${repository}${route ? `/${route}` : ""}`,
      {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(upload
            ? {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(bytes),
              }
            : { "Content-Type": "application/json" }),
        },
        ...(body
          ? {
              body: upload ? body : JSON.stringify(body),
              ...(upload ? { duplex: "half" } : {}),
            }
          : {}),
        signal: AbortSignal.timeout(
          Math.min(10 * 60_000, deadline - Date.now()),
        ),
      },
    );
    assert(response.ok, "Owned import API failed");
    const chunks = [];
    let size = 0;
    for await (const part of response.body) {
      size += part.length;
      assert(size <= OWNED_LIMITS.metadata, "Owned import metadata bound");
      chunks.push(part);
    }
    return parseOwnedJson(Buffer.concat(chunks).toString("utf8"));
  };
}
export async function downloadOwnedImport(
  api,
  {
    selection,
    review,
    repository = OWNED_REPOSITORY,
    token,
    destination,
    python,
    request = fetch,
  },
  { download = downloadAsset, extract = archiveCommand } = {},
) {
  validateOwnedReview(review);
  assert(
    selection.producer === "owned-import",
    "Explicit owned import selection required",
  );
  const [repo, workflow, run] = await Promise.all([
    api(""),
    api("actions/workflows/cef-owned-sdk-import.yml"),
    api(`actions/runs/${selection.runId}`),
  ]);
  const producer = {
    repository,
    repositoryId: repo.id,
    runId: selection.runId,
    attempt: selection.runAttempt,
    head: selection.headSha,
    branch: repo.default_branch,
    workflow: OWNED_WORKFLOW,
    workflowId: workflow.id,
    codeSha256: "0".repeat(64),
  };
  assert(
    repository === OWNED_REPOSITORY &&
      repo.full_name === repository &&
      repo.private === false &&
      positive(repo.id) &&
      workflow.path === OWNED_WORKFLOW &&
      positive(workflow.id) &&
      run.id === selection.runId &&
      run.head_sha === selection.headSha &&
      run.head_branch === repo.default_branch &&
      run.run_attempt === selection.runAttempt &&
      run.workflow_id === workflow.id &&
      run.path === OWNED_WORKFLOW &&
      run.event === "workflow_dispatch" &&
      run.repository?.id === repo.id &&
      run.head_repository?.id === repo.id &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository,
    "Default-branch owned importer metadata differs before download",
  );
  // Source digest is taken only from the independently hashed seal below.
  assert(
    run.status === "completed" && run.conclusion === "success",
    "Successful owned importer required",
  );
  const artifact = await api(`actions/artifacts/${selection.artifactId}`);
  assert(
    artifact.id === selection.artifactId &&
      artifact.name === importSealName(selection.runId, selection.runAttempt) &&
      artifact.expired === false &&
      artifact.digest === `sha256:${selection.artifactSha256}` &&
      artifact.workflow_run?.id === selection.runId &&
      artifact.workflow_run?.head_sha === selection.headSha &&
      positive(artifact.size_in_bytes) &&
      artifact.size_in_bytes < OWNED_LIMITS.seal,
    "Independent owned seal identity differs",
  );
  await mkdir(destination);
  await noLinks(destination);
  const deadline = Date.now() + 20 * 60_000;
  await download(
    repository,
    token,
    `/actions/artifacts/${artifact.id}/zip`,
    path.join(destination, "owned-seal.zip"),
    { bytes: artifact.size_in_bytes, sha256: selection.artifactSha256 },
    { request, maximum: OWNED_LIMITS.seal, deadline },
  );
  const seal = validateImportSeal(
    await extract(
      python,
      path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
      [
        "seal",
        "--input",
        path.join(destination, "owned-seal.zip"),
        "--output",
        destination,
      ],
      { timeout: 15000 },
    ),
  );
  producer.codeSha256 = seal.completion.producer.codeSha256;
  assert(
    canonical(producer) === canonical(seal.completion.producer) &&
      seal.completionSha256 === selection.completionSha256 &&
      seal.completion.reviewSha256 === selection.reviewSha256 &&
      seal.completion.reviewedImport === selection.reviewedImport &&
      canonical(seal.completion.review) === canonical(review) &&
      review.descriptorSha256 === selection.descriptorSha256,
    "Independently reviewed owned completion differs",
  );
  await verifyImportProducer(api, producer, { completed: true });
  const draft = await ownedDraft(
    api,
    review,
    selection.reviewSha256,
    seal.completion.release.id,
  );
  assert(
    canonical(draft.release) === canonical(seal.completion.release) &&
      canonical(draft.assets) === canonical(seal.completion.assets),
    "Sealed draft changed",
  );
  for (const pin of draft.assets)
    await download(
      repository,
      token,
      `/releases/assets/${pin.id}`,
      path.join(destination, pin.name),
      pin,
      {
        request,
        maximum: pin.name.endsWith(".tar.bz2")
          ? RELEASE_LIMITS.archive
          : RELEASE_LIMITS.metadata,
        deadline,
      },
    );
  const after = await ownedDraft(
    api,
    review,
    selection.reviewSha256,
    draft.release.id,
  );
  assert(
    canonical(after) === canonical(draft),
    "Draft changed during acceptance download",
  );
  await writeFile(
    path.join(destination, "owned-import-completion.json"),
    canonical(seal.completion) + "\n",
    { flag: "wx" },
  );
  return seal.completion;
}
