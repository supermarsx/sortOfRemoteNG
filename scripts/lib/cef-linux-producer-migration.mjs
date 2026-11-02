// Fixed Linux migration: only the context-bound complete transaction can execute.
// Standalone preparation APIs stay closed; matching JSON grants no authority.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// BEGIN inactive fixed transaction imports
import {
  assertLiveLinuxSourceContext,
  revalidateLinuxSourceOwner,
  assertLinuxSourceOwnerReceipt,
} from "../cef-runtime-ci.mjs";
// END inactive fixed transaction imports
import {
  AUTO_SLICE,
  LIMITS,
  SOURCE_METADATA_MAX_BYTES,
  WORKFLOW,
  archiveCommand,
  authority,
  canonical,
  checkpointProfile,
  codeTreeDigest,
  filePin,
  graphDigest,
  installRestoredDirectory,
  hostRemaining,
  linuxArmRecipe,
  noLinks,
  sha,
  sourceMetadataResult,
  validateIdentity,
  validateManifest,
  validateSeal,
  verifyGraph,
} from "./cef-engineering-checkpoint.mjs";

export const LINUX_MIGRATION = Object.freeze({
  target: "aarch64-unknown-linux-gnu",
  source: "8c5af5d375371adef2e1a32d872f5c55f907d26786b698e5ab2aef0fdfb9f8eb",
  head: "3aa7d04278d75d64c53ff0a6d5bf8d56c94e5d3c",
  producer: "a4f715ed5755b718210cafb2aacb9d4179c7e3f49e0961ce800cca8fa4098837",
  sourceFiles: 129,
  policyPath:
    "native/cef-checkpoint-migrations/linux-arm-a4f715ed-mac-source-v1.json",
  sidecar: ".siso_sorng_source_metadata.json",
  metadataPolicy: "sorng-linuxarm-complete-owned-inputs-v2-nearby-literals",
  epoch: "1790626028",
});
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELPER = fileURLToPath(
  new URL("./cef-checkpoint-archive.py", import.meta.url),
);
const RETIREMENT_HELPER = fileURLToPath(
  new URL("./cef-linux-sidecar-retirement.py", import.meta.url),
);
const RETIREMENT_HELPER_PIN = Object.freeze({
  bytes: 8967,
  sha256: "a41c8291078052487beff04c7cd3482a38afca0823cbf7364e3e250387c77cf9",
});
const PREPARATION_ONLY = true;
const candidates = new WeakMap();
const creators = new WeakMap();
const toolContexts = new WeakMap();
const cleanupReports = new WeakMap();
const retirementReports = new WeakMap();
// No setter exists in this inactive slice. Only a future, separately reviewed
// genuine GN/join + old-apply transaction may mint retirement readiness.
const retirementReadiness = new WeakMap();
// Proof authority is disjoint. These objects are never inserted into any of
// the production candidate, tool-context, creator or readiness maps.
const proofScopes = new WeakMap();
const proofCreators = new WeakMap();
const ownedRetirements = new WeakMap();
let proofActive = false;
let lastProofObservation = null;
const PROOF = Object.freeze({
  branch: "refs/heads/codex/linux-arm-final-helper-proof-20261102",
  workflow: ".github/workflows/cef-linux-producer-migration-proof.yml",
  temp: "/home/runner/work/_temp",
  python: "/usr/bin/python3.12",
  pythonPin: Object.freeze({
    bytes: 8020928,
    sha256: "e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f",
  }),
  archivePin: Object.freeze({
    bytes: 203191,
    sha256: "3be8d4b159293e677d0d49ce7b6f09f661363481db655f936e436f694a9ef8b8",
  }),
  modules: "tests/fixtures/cef/mac_nearby.gitmodules",
  modulesPin: Object.freeze({
    bytes: 1512,
    sha256: "3914e148331ecf23a42bbe017c0cc8a0efd0f0cf47ccc5b3ad08212ce4a2986f",
  }),
  nearby: "src/third_party/nearby/src",
  nearbyHead: "0bad8b0c9877f92eeeb550654f1ea51a71a085e4",
  oldProducer: sha("sorng-linux-owned-proof-synthetic-old-v1"),
  newProducer: sha("sorng-linux-owned-proof-synthetic-new-v1"),
});
const PROOF_LINKS = Object.freeze(
  [
    [
      "third_party/google-toolbox-for-mac/include/GTMDefines.h",
      "../google-toolbox-for-mac/GTMDefines.h",
      "third_party/google-toolbox-for-mac/google-toolbox-for-mac",
    ],
    [
      "third_party/google-toolbox-for-mac/include/GoogleToolboxForMac/GTMLogger.h",
      "../../google-toolbox-for-mac/Foundation/GTMLogger.h",
      "third_party/google-toolbox-for-mac/google-toolbox-for-mac",
    ],
    [
      "third_party/securemessage/include/securemessage",
      "../securemessage/cpp/include/securemessage",
      "third_party/securemessage/securemessage",
    ],
    [
      "third_party/smhasher/include/src",
      "../../smhasher/smhasher/src",
      "third_party/smhasher/smhasher",
    ],
    [
      "third_party/ukey2/include/securegcm",
      "../ukey2/src/main/cpp/include/securegcm",
      "third_party/ukey2/ukey2",
    ],
  ].map(Object.freeze),
);
const IDENTITY_FIELDS = [
  "target",
  "source",
  "canonicalRoot",
  "image",
  "tools",
  "graph",
  "siso",
];
const CHANGED_PATHS = new Set([
  // BEGIN closed migration CLI source delta
  "scripts/lib/cef-windows-arm-sdk-origin.mjs",
  // END closed migration CLI source delta
  "scripts/lib/cef-linux-producer-migration.mjs",
  "scripts/cef-engineering-checkpoint.mjs",
  "scripts/cef-runtime-ci.mjs",
  "scripts/lib/cef-engineering-checkpoint.mjs",
  "scripts/lib/cef-checkpoint-archive.py",
  "scripts/lib/cef-mac-source-metadata.mjs",
  "scripts/lib/cef-linux-sidecar-retirement.py",
  WORKFLOW,
]);
const hex = (value, length = 64) =>
  typeof value === "string" &&
  new RegExp("^[a-f0-9]{" + length + "}$").test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
function need(condition, reason) {
  assert(condition, "LINUX_MIGRATION_" + reason);
}
function exact(value, fields) {
  need(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === fields.slice().sort().join(),
    "SHAPE",
  );
}
function json(raw, maximum) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= maximum,
    "BOUND",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const value = JSON.parse(text);
  // All three inputs are written by their fixed canonical writers. This also
  // denies duplicate keys, alternate encodings and ambiguous JSON spellings.
  const normalized = canonical(value);
  // The archive writer uses Python's ensure_ascii=True, while the seal and
  // policy writers use canonical JavaScript JSON. Both are unambiguous.
  const ascii = normalized.replace(
    /[^\x00-\x7f]/g,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  need(text === normalized + "\n" || text === ascii + "\n", "CANONICAL_JSON");
  return value;
}
function pin(value, maximum) {
  exact(value, ["bytes", "sha256"]);
  need(
    positive(value.bytes) && value.bytes <= maximum && hex(value.sha256),
    "PIN",
  );
}
function matches(raw, expected, maximum) {
  pin(expected, maximum);
  need(
    Buffer.isBuffer(raw) &&
      raw.length === expected.bytes &&
      sha(raw) === expected.sha256,
    "PIN_MISMATCH",
  );
}
const stamp = (info) =>
  [
    info.dev,
    info.ino,
    info.uid,
    info.mode,
    info.nlink,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
const directoryIdentity = (info) =>
  [info.dev, info.ino, info.uid, info.mode].join(":");
async function heldFile(
  file,
  maximum,
  expected,
  check,
  observeFailureClose,
  retainRaw = true,
) {
  check();
  await noLinks(file);
  const before = await fs.lstat(file, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(maximum),
    "REGULAR_FILE",
  );
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let failed = false;
  try {
    need(
      stamp(await handle.stat({ bigint: true })) === stamp(before),
      "FILE_SWAP",
    );
    const digest = createHash("sha256");
    const blocks = [];
    let count = 0;
    for (;;) {
      check();
      const buffer = Buffer.alloc(Math.min(1024 * 1024, maximum + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      need(count <= maximum, "BOUND");
      digest.update(buffer.subarray(0, bytesRead));
      if (!expected && retainRaw) blocks.push(buffer.subarray(0, bytesRead));
    }
    need(
      BigInt(count) === before.size &&
        stamp(await handle.stat({ bigint: true })) === stamp(before) &&
        stamp(await fs.lstat(file, { bigint: true })) === stamp(before),
      "FILE_CHANGED",
    );
    const actual = { bytes: count, sha256: digest.digest("hex") };
    if (expected)
      need(
        actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
        "PIN_MISMATCH",
      );
    check();
    return {
      handle,
      identity: stamp(before),
      owner: before.uid,
      pin: actual,
      raw: expected || !retainRaw ? null : Buffer.concat(blocks),
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) {
      let failures = 0;
      try {
        await handle.close();
      } catch {
        failures = 1;
      }
      try {
        observeFailureClose?.({ descriptors: 1, closeFailures: failures });
      } catch {
        /* Observation never replaces the primary. */
      }
    }
  }
}
function git(root, args, input) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:GIT_|GCM_|SSH_ASKPASS$)/i.test(key),
    ),
  );
  return execFileSync("git", ["--no-replace-objects", "-C", root, ...args], {
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
    },
    input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });
}
function committedBlobs(root, rows) {
  const raw = git(
    root,
    ["cat-file", "--batch"],
    rows.map((row) => row.sha).join("\n") + "\n",
  );
  let offset = 0;
  const result = rows.map((row) => {
    const end = raw.indexOf(10, offset);
    need(end > offset, "GIT_BLOB");
    const match = /^([a-f0-9]{40}) blob ([1-9][0-9]*)$/.exec(
      raw.subarray(offset, end).toString("ascii"),
    );
    need(
      match && match[1] === row.sha && Number(match[2]) <= 4 * 1024 * 1024,
      "GIT_BLOB",
    );
    const start = end + 1,
      next = start + Number(match[2]);
    need(next < raw.length && raw[next] === 10, "GIT_BLOB");
    offset = next + 1;
    return raw.subarray(start, next);
  });
  need(offset === raw.length, "GIT_BLOB");
  return result;
}
function tree(raw) {
  if (!raw.toString("utf8").trim()) return [];
  return raw
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      need(match, "GIT_TREE");
      return { mode: match[1], type: "blob", sha: match[2], path: match[3] };
    });
}
function producer(value, old = false) {
  exact(value, [
    "repository",
    "repositoryId",
    "runId",
    "attempt",
    "head",
    "branch",
    "workflow",
  ]);
  need(
    value.repository === "supermarsx/sortOfRemoteNG" &&
      value.repositoryId === 1010282954 &&
      value.branch === "main" &&
      value.workflow === WORKFLOW &&
      positive(value.runId) &&
      positive(value.attempt) &&
      hex(value.head, 40),
    "PRODUCER",
  );
  if (old) need(value.head === LINUX_MIGRATION.head, "OLD_PRODUCER");
}

// An estimate against the ORIGINAL host start, never a replacement lease.
// GN, restore and retirement cost must still fit in the caller's remaining time.
export function inspectLinuxMigrationBudget({
  startedMs,
  nowMs,
  sliceMs = "auto",
}) {
  need(
    positive(startedMs) && positive(nowMs) && nowMs >= startedMs,
    "ORIGINAL_CLOCK",
  );
  const remainingMs = LIMITS.hostMs - (nowMs - startedMs);
  const metadataMs = 3 * LIMITS.linuxSourceMetadataMs;
  const availableMs = remainingMs - metadataMs - AUTO_SLICE.reserveMs;
  need(availableMs >= AUTO_SLICE.floorMs, "INSUFFICIENT_ORIGINAL_LEASE");
  const compileMs =
    sliceMs === "auto"
      ? Math.min(availableMs, AUTO_SLICE.ceilingMs, LIMITS.maxCompileMs)
      : sliceMs;
  need(
    positive(compileMs) &&
      compileMs >= AUTO_SLICE.floorMs &&
      compileMs <= LIMITS.maxCompileMs &&
      compileMs <= availableMs,
    "REQUESTED_SLICE",
  );
  return Object.freeze({
    authorizing: false,
    lowerBoundOnly: true,
    startedMs,
    remainingMs,
    metadataPasses: 3,
    metadataMs,
    reserveMs: AUTO_SLICE.reserveMs,
    compileMs,
    additionalStageBudgetMs: availableMs - compileMs,
  });
}

// Pure inspection of actual bytes and pins, not proof that a caller's report
// came from GitHub. Integration must obtain these inputs from restoreDownload.
// The returned candidate is deliberately incapable of authorizing mutations.
export async function inspectLinuxMigrationCandidate({
  repositoryRoot = ROOT,
  restoreRun,
  currentProducer,
  freshIdentity,
  oldManifestBytes,
  oldSealBytes,
  oldSealArtifact,
  oldInventoryBytes,
  check = () => {},
}) {
  need(positive(restoreRun), "FIXED_RUN");
  producer(currentProducer);
  // BEGIN fixed same-producer capsule head
  const expectedCurrentHead = currentProducer.head;
  // END fixed same-producer capsule head
  check();
  const root = await noLinks(repositoryRoot);
  need(
    git(root, ["rev-parse", "HEAD"]).toString().trim() === currentProducer.head,
    "CURRENT_HEAD",
  );
  const entries = tree(
    git(root, [
      "ls-tree",
      "-r",
      "HEAD",
      "--",
      "scripts",
      "native/cef-hosted-recipe.json",
      ".node-version",
      WORKFLOW,
    ]),
  );
  const currentDigest = codeTreeDigest(entries);
  need(freshIdentity.producer === currentDigest, "CURRENT_CODE");
  const committed = committedBlobs(root, entries);
  for (const [index, row] of entries.entries()) {
    const raw = committed[index];
    const file = await heldFile(
      path.join(root, row.path),
      4 * 1024 * 1024,
      { bytes: raw.length, sha256: sha(raw) },
      check,
    );
    await file.handle.close();
  }
  const policyRows = tree(
    git(root, ["ls-tree", "HEAD", "--", LINUX_MIGRATION.policyPath]),
  );
  need(policyRows.length === 1, "POLICY_MISSING");
  const policyRaw = git(root, [
    "cat-file",
    "blob",
    "HEAD:" + LINUX_MIGRATION.policyPath,
  ]);
  const policyFile = await heldFile(
    path.join(root, LINUX_MIGRATION.policyPath),
    128 * 1024,
    { bytes: policyRaw.length, sha256: sha(policyRaw) },
    check,
  );
  await policyFile.handle.close();
  const policy = json(policyRaw, 128 * 1024);
  exact(policy, [
    "schemaVersion",
    "kind",
    "target",
    "source",
    "linuxMetadata",
    "from",
    "toProducer",
    "oldSourceTree",
    "changedSources",
  ]);
  need(
    policy.schemaVersion === 1 &&
      policy.kind === "sorng-linuxarm-exact-producer-migration" &&
      policy.target === LINUX_MIGRATION.target &&
      policy.source === LINUX_MIGRATION.source &&
      policy.toProducer === currentDigest &&
      policy.toProducer !== LINUX_MIGRATION.producer,
    "POLICY_SCOPE",
  );
  exact(policy.linuxMetadata, [
    "schemaVersion",
    "kind",
    "policy",
    "sourceDateEpoch",
  ]);
  need(
    policy.linuxMetadata.schemaVersion === 1 &&
      policy.linuxMetadata.kind === "sorng-linuxarm-source-metadata" &&
      policy.linuxMetadata.policy === LINUX_MIGRATION.metadataPolicy &&
      policy.linuxMetadata.sourceDateEpoch === LINUX_MIGRATION.epoch,
    "LINUX_METADATA",
  );
  exact(policy.from, [
    "producer",
    "checkpointProducer",
    "identitySha256",
    "sealArtifact",
    "seal",
    "manifest",
    "inventory",
    "sidecar",
  ]);
  // BEGIN fixed same-producer capsule selector
  // Run41378060040 is historical seed evidence, not an execution selector.
  // Only this exact held current-Git capsule selects a reviewed run/attempt.
  producer(policy.from.checkpointProducer, true);
  need(restoreRun === policy.from.checkpointProducer.runId, "FIXED_RUN");
  // END fixed same-producer capsule selector
  need(policy.from.producer === LINUX_MIGRATION.producer, "FROM_DIGEST");
  need(
    Array.isArray(policy.oldSourceTree) &&
      policy.oldSourceTree.length === LINUX_MIGRATION.sourceFiles &&
      codeTreeDigest(policy.oldSourceTree) === LINUX_MIGRATION.producer,
    "OLD_SOURCE",
  );
  const oldRows = new Map(policy.oldSourceTree.map((row) => [row.path, row]));
  need(oldRows.size === LINUX_MIGRATION.sourceFiles, "OLD_SOURCE");
  const newRows = new Map(entries.map((row) => [row.path, row]));
  need(newRows.size === entries.length, "CURRENT_SOURCE");
  const changed = [];
  for (const name of [
    ...new Set([...oldRows.keys(), ...newRows.keys()]),
  ].sort()) {
    const before = oldRows.get(name);
    const after = newRows.get(name);
    if (before?.sha === after?.sha && before?.mode === after?.mode) continue;
    need(CHANGED_PATHS.has(name) && after, "UNREVIEWED_SOURCE_DELTA");
    changed.push({
      path: name,
      before: before ? { mode: before.mode, sha: before.sha } : null,
      after: { mode: after.mode, sha: after.sha },
    });
  }
  need(
    changed.length > 0 &&
      changed.length <= CHANGED_PATHS.size &&
      canonical(changed) === canonical(policy.changedSources),
    "SOURCE_DELTA",
  );
  pin(policy.from.manifest, LIMITS.seal);
  pin(policy.from.seal, LIMITS.seal);
  pin(policy.from.inventory, LIMITS.metadata);
  pin(policy.from.sidecar, SOURCE_METADATA_MAX_BYTES);
  exact(policy.from.sealArtifact, ["id", "bytes", "sha256"]);
  need(positive(policy.from.sealArtifact.id), "SEAL_ARTIFACT");
  pin(
    {
      bytes: policy.from.sealArtifact.bytes,
      sha256: policy.from.sealArtifact.sha256,
    },
    LIMITS.seal,
  );
  need(
    canonical(oldSealArtifact) === canonical(policy.from.sealArtifact),
    "SEAL_ARTIFACT",
  );
  matches(oldManifestBytes, policy.from.manifest, LIMITS.seal);
  matches(oldSealBytes, policy.from.seal, LIMITS.seal);
  matches(oldInventoryBytes, policy.from.inventory, LIMITS.metadata);
  const manifest = validateManifest(
    json(oldManifestBytes, LIMITS.seal),
    policy.from.identitySha256,
  );
  producer(manifest.producer, true);
  // BEGIN fixed same-producer capsule record binding
  need(
    canonical(manifest.producer) === canonical(policy.from.checkpointProducer),
    "CAPSULE_PRODUCER",
  );
  // END fixed same-producer capsule record binding
  need(manifest.identity.producer === LINUX_MIGRATION.producer, "OLD_CODE");
  const seal = validateSeal(
    json(oldSealBytes, LIMITS.seal),
    manifest.producer,
    LINUX_MIGRATION.target,
  );
  need(
    seal.identitySha256 === manifest.identitySha256 &&
      seal.manifest.bytes === oldManifestBytes.length &&
      seal.manifest.sha256 === sha(oldManifestBytes),
    "SEAL_BINDING",
  );
  const expectedAssets = [
    { name: "manifest.json", ...policy.from.manifest },
    { name: "inventory.json", ...policy.from.inventory },
    ...manifest.archive.chunks,
  ];
  need(seal.assets.length === expectedAssets.length, "SEALED_ASSET");
  for (const expected of expectedAssets) {
    const asset = seal.assets.find((row) => row.name === expected.name);
    need(
      asset?.bytes === expected.bytes && asset?.sha256 === expected.sha256,
      "SEALED_ASSET",
    );
  }
  validateIdentity(freshIdentity);
  need(
    freshIdentity.target === LINUX_MIGRATION.target &&
      freshIdentity.source === LINUX_MIGRATION.source &&
      IDENTITY_FIELDS.every(
        (field) => freshIdentity[field] === manifest.identity[field],
      ),
    "IDENTITY_FIELDS",
  );
  const inventory = json(oldInventoryBytes, LIMITS.metadata);
  need(
    inventory.schemaVersion === 1 &&
      manifest.archive.inventory.bytes === oldInventoryBytes.length &&
      manifest.archive.inventory.sha256 === sha(oldInventoryBytes) &&
      Array.isArray(inventory.entries) &&
      Array.isArray(inventory.files) &&
      inventory.entries.length <= 300000 &&
      inventory.files.length <= 300000,
    "INVENTORY",
  );
  const sidecars = inventory.files.filter(
    (row) => row.path === LINUX_MIGRATION.sidecar,
  );
  const sidecarRows = inventory.entries.filter(
    (row) => row.path === LINUX_MIGRATION.sidecar,
  );
  need(
    sidecars.length === 1 &&
      sidecars[0].sha256 === policy.from.sidecar.sha256 &&
      sidecarRows.length === 1 &&
      sidecarRows[0].kind === "file" &&
      sidecarRows[0].stamp?.[0] === policy.from.sidecar.bytes,
    "EXISTING_SIDECAR",
  );
  check();
  // BEGIN fixed same-producer capsule final head
  need(
    git(root, ["rev-parse", "HEAD"]).toString().trim() === expectedCurrentHead,
    "CURRENT_HEAD",
  );
  // END fixed same-producer capsule final head
  const candidate = Object.freeze({
    kind: "linux-arm-migration-candidate",
    authorizing: false,
    activation: "not-implemented",
    policyBlob: policyRows[0].sha,
    policySha256: sha(policyRaw),
    fromProducer: LINUX_MIGRATION.producer,
    fromRunId: policy.from.checkpointProducer.runId,
    fromAttempt: policy.from.checkpointProducer.attempt,
    toProducer: currentDigest,
  });
  candidates.set(candidate, {
    repositoryRoot: root,
    currentProducer: structuredClone(currentProducer),
    manifest,
    manifestPin: structuredClone(policy.from.manifest),
    inventoryPin: structuredClone(policy.from.inventory),
    freshIdentity: structuredClone(freshIdentity),
    sidecar: structuredClone(policy.from.sidecar),
    // BEGIN inactive fixed transaction policy pin
    policyPin: { bytes: policyRaw.length, sha256: sha(policyRaw) },
    // END inactive fixed transaction policy pin
  });
  return candidate;
}

// Read-only issuer: it repeats the actual reviewed verification, rather than
// branding a caller's Python path or a serialized "verified" object. This can
// only run in the real current default-branch producer checkout. The public
// restore/retirement gates remain unconditionally disabled below.
function checkedToolchainLock(raw, expected, target) {
  exact(expected, ["path", "sha256"]);
  need(
    Buffer.isBuffer(raw) &&
      raw.length > 0 &&
      raw.length <= 4 * 1024 * 1024 &&
      hex(expected.sha256) &&
      sha(raw) === expected.sha256,
    "TOOLS_LOCK_PIN",
  );
  const lock = JSON.parse(raw);
  exact(lock, ["schemaVersion", "kind", "target", "files"]);
  need(
    lock.schemaVersion === 1 &&
      lock.kind === "sorng-cef-toolchain-lock" &&
      lock.target === target &&
      Array.isArray(lock.files) &&
      lock.files.length > 0 &&
      lock.files.length <= 4096,
    "TOOLS_LOCK",
  );
  return lock;
}

function installedToolPin(row, maximum) {
  exact(row, ["path", "size", "sha256"]);
  need(
    typeof row.path === "string" &&
      row.path.length > 0 &&
      positive(row.size) &&
      row.size <= maximum &&
      hex(row.sha256),
    "TOOLS_INSTALLED_PIN",
  );
  return { bytes: row.size, sha256: row.sha256 };
}

export async function createVerifiedLinuxMigrationTools(candidate) {
  const selected = candidates.get(candidate);
  need(selected, "OPAQUE_CANDIDATE");
  need(selected.repositoryRoot === path.resolve(ROOT), "FIXED_CHECKOUT");
  need(process.platform === "linux" && process.arch === "x64", "TOOLS_HOST");
  need(
    git(ROOT, ["rev-parse", "HEAD"]).toString().trim() ===
      selected.currentProducer.head,
    "CURRENT_HEAD",
  );
  const env = Object.fromEntries(
    [
      "GITHUB_EVENT_NAME",
      "GITHUB_ACTIONS",
      "RUNNER_ENVIRONMENT",
      "GITHUB_REPOSITORY_VISIBILITY",
      "CEF_DEFAULT_BRANCH",
      "GITHUB_REF",
      "GITHUB_REPOSITORY",
      "GITHUB_REPOSITORY_ID",
      "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT",
      "GITHUB_SHA",
      "GITHUB_WORKFLOW_REF",
      "ImageOS",
      "ImageVersion",
      "SORNG_CEF_TOOLS_ROOT",
      "CEF_ENGINEERING_JOB_STARTED_MS",
      "RUNNER_TEMP",
    ].map((key) => [key, process.env[key]]),
  );
  need(
    canonical(authority(env)) === canonical(selected.currentProducer),
    "TOOLS_AUTHORITY",
  );
  const originalRemaining = hostRemaining(env);
  const end = performance.now() + originalRemaining;
  const remaining = () => {
    const value = Math.floor(
      Math.min(end - performance.now(), hostRemaining(env)),
    );
    need(value > 0, "ORIGINAL_LEASE");
    return value;
  };
  remaining();
  const {
    plan,
    releaseIdentity,
    validateRunnerMap,
    assertHostedBuildIdentity,
  } = await import("../cef-runtime-ci.mjs");
  const { verifyToolchainFiles } = await import("./browser-custom-runtime.mjs");
  const profile = checkpointProfile(LINUX_MIGRATION.target);
  const reviewed = await plan({
    inputs: profile.inputs,
    target: profile.target,
    checkout: ROOT,
    runnerMode: "hosted",
  });
  need(
    releaseIdentity(reviewed.sourceLock, profile.target).sourceLockSha256 ===
      LINUX_MIGRATION.source,
    "TOOLS_SOURCE",
  );
  const build = reviewed.sourceLock.builds.find(
    (row) => row.target === profile.target,
  );
  const held = [];
  const failureClose = { descriptors: 0, closeFailures: 0 };
  const observedClose = (fact) => {
    failureClose.descriptors += fact.descriptors;
    failureClose.closeFailures += fact.closeFailures;
  };
  let failed = false,
    primary,
    result;
  try {
    const lockFile = await heldFile(
      path.join(reviewed.inputsRoot, build.toolchainLock.path),
      4 * 1024 * 1024,
      null,
      remaining,
      observedClose,
    );
    held.push(lockFile);
    const lock = checkedToolchainLock(
      lockFile.raw,
      build.toolchainLock,
      profile.target,
    );
    const mapName = `cef-ci-runner-${profile.target}.json`;
    const mapPin = lock.files.find((row) => row.path === mapName);
    need(mapPin, "TOOLS_MAP");
    const mapFile = await heldFile(
      path.join(reviewed.inputsRoot, mapName),
      1024 * 1024,
      null,
      remaining,
      observedClose,
    );
    held.push(mapFile);
    need(
      mapFile.pin.bytes === installedToolPin(mapPin, 1024 * 1024).bytes &&
        mapFile.pin.sha256 === mapPin.sha256,
      "TOOLS_MAP_PIN",
    );
    const map = validateRunnerMap(JSON.parse(mapFile.raw), profile.target);
    assertHostedBuildIdentity(map, profile.target, env);
    const toolsRoot = await noLinks(env.SORNG_CEF_TOOLS_ROOT);
    const python = path.join(toolsRoot, map.python);
    const pythonPin = lock.files.find((row) => row.path === map.python);
    need(pythonPin, "TOOLS_PYTHON");
    await verifyToolchainFiles({
      sourceLock: reviewed.sourceLock,
      target: profile.target,
      inputsRoot: reviewed.inputsRoot,
      toolsRoot,
      python,
      runnerMapFromInputs: true,
    });
    const pythonFile = await heldFile(
      python,
      256 * 1024 * 1024,
      installedToolPin(pythonPin, 256 * 1024 * 1024),
      remaining,
      observedClose,
    );
    held.push(pythonFile);
    const helperFiles = [];
    for (const name of [HELPER, RETIREMENT_HELPER]) {
      const relative = path.relative(ROOT, name).split(path.sep).join("/");
      const raw = git(ROOT, [
        "cat-file",
        "blob",
        selected.currentProducer.head + ":" + relative,
      ]);
      if (name === RETIREMENT_HELPER)
        need(
          raw.length === RETIREMENT_HELPER_PIN.bytes &&
            sha(raw) === RETIREMENT_HELPER_PIN.sha256,
          "RETIREMENT_HELPER_PIN",
        );
      const file = await heldFile(
        name,
        4 * 1024 * 1024,
        { bytes: raw.length, sha256: sha(raw) },
        remaining,
        observedClose,
      );
      held.push(file);
      helperFiles.push(file);
    }
    const mode = (await pythonFile.handle.stat({ bigint: true })).mode;
    need((mode & 0o022n) === 0n && (mode & 0o111n) !== 0n, "TOOLS_PYTHON_MODE");
    const temp = await noLinks(env.RUNNER_TEMP);
    const work = path.join(
      temp,
      "sorng-cef-engineering",
      profile.target,
      profile.source,
    );
    need(work === selected.freshIdentity.canonicalRoot, "TOOLS_WORKSPACE");
    const chromium = path.join(work, "source/src"),
      out = path.join(chromium, "out", profile.outConfig);
    const linuxRecipe = await linuxArmRecipe(chromium, out);
    const linkRecipe = linuxRecipe.generatedLinks;
    const fingerprint = {
      toolchain: lock,
      linkRecipe,
      linuxRecipe,
      nodeVersion: process.version,
      nodeExecutable: await filePin(
        await fs.realpath(process.execPath),
        256 * 1024 * 1024,
      ),
    };
    need(
      sha(canonical(fingerprint)) === selected.freshIdentity.tools,
      "TOOLS_BINDING",
    );
    need(
      (
        await filePin(
          path.join(chromium, "third_party/siso/cipd/siso"),
          256 * 1024 * 1024,
        )
      ).sha256 === selected.freshIdentity.siso,
      "TOOLS_SISO",
    );
    await verifyGraph(out, selected.freshIdentity.graph);
    const recipePath = path.join(work, "logs/generated-sdk-links.json");
    const recipePin = {
      bytes: Buffer.byteLength(canonical(linkRecipe)),
      sha256: sha(canonical(linkRecipe)),
    };
    for (const [file, name] of [
      [lockFile, path.join(reviewed.inputsRoot, build.toolchainLock.path)],
      [mapFile, path.join(reviewed.inputsRoot, mapName)],
      [pythonFile, python],
    ])
      await revalidateHeldFile(file, name, remaining);
    for (const [file, name] of [
      [helperFiles[0], HELPER],
      [helperFiles[1], RETIREMENT_HELPER],
    ])
      await revalidateHeldFile(file, name, remaining);
    remaining();
    need(
      git(ROOT, ["rev-parse", "HEAD"]).toString().trim() ===
        selected.currentProducer.head,
      "CURRENT_HEAD",
    );
    const token = Object.freeze({
      kind: "verified-linux-migration-tools",
      authorizing: false,
    });
    toolContexts.set(token, {
      python,
      pythonFile,
      archiveFile: helperFiles[0],
      retirementFile: helperFiles[1],
      held: held.splice(2),
      candidate,
      remaining,
      recipePath,
      recipePin,
      bundle: path.join(temp, "cef-engineering-download"),
      originalEndMs: Number(env.CEF_ENGINEERING_JOB_STARTED_MS) + LIMITS.hostMs,
      // BEGIN inactive fixed transaction tool binding
      toolsRoot,
      work,
      chromium,
      out,
      linuxRecipeJson: canonical(linuxRecipe),
      // END inactive fixed transaction tool binding
    });
    // Executable inputs stay held until explicit context retirement.
    result = token;
  } catch (error) {
    failed = true;
    primary = error;
  }
  const closed = await closeHeld(held);
  recordCleanup(
    candidate,
    "tools-locks",
    held.length + failureClose.descriptors,
    closed.length + failureClose.closeFailures,
  );
  if (closed.length && !failed) {
    failed = true;
    primary = closed[0];
  }
  if (!failed) {
    try {
      remaining();
    } catch (error) {
      failed = true;
      primary = error;
    }
  }
  if (failed) {
    if (result) {
      const issued = toolContexts.get(result);
      toolContexts.delete(result);
      if (issued) {
        const extra = await closeHeld(issued.held);
        recordCleanup(
          result,
          "tools-close-after-failure",
          issued.held.length,
          extra.length,
        );
        recordCleanup(
          candidate,
          "tools-failed-closure",
          held.length + failureClose.descriptors + issued.held.length,
          closed.length + failureClose.closeFailures + extra.length,
        );
      }
    }
  }
  if (failed) throw primary;
  return result;
}

async function closeHeld(files) {
  const failures = [];
  for (const file of files) {
    try {
      await file.handle.close();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function recordCleanup(token, phase, descriptors, failures) {
  cleanupReports.set(
    token,
    Object.freeze({
      phase,
      descriptors,
      closeFailures: failures,
      descriptorsClosed: failures === 0,
    }),
  );
}

export function inspectLinuxMigrationCleanup(token) {
  need(cleanupReports.has(token), "NO_CLEANUP_OBSERVATION");
  return cleanupReports.get(token);
}

async function revalidateHeldFile(file, name, check) {
  check();
  await noLinks(name);
  need(
    stamp(await file.handle.stat({ bigint: true })) === file.identity &&
      stamp(await fs.lstat(name, { bigint: true })) === file.identity,
    "FILE_CHANGED",
  );
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024);
  let count = 0;
  for (;;) {
    check();
    const { bytesRead } = await file.handle.read(
      buffer,
      0,
      buffer.length,
      count,
    );
    if (!bytesRead) break;
    count += bytesRead;
    need(count <= file.pin.bytes, "BOUND");
    hash.update(buffer.subarray(0, bytesRead));
  }
  need(
    count === file.pin.bytes &&
      hash.digest("hex") === file.pin.sha256 &&
      stamp(await file.handle.stat({ bigint: true })) === file.identity &&
      stamp(await fs.lstat(name, { bigint: true })) === file.identity,
    "FILE_CHANGED",
  );
  check();
}

export async function closeVerifiedLinuxMigrationTools(token) {
  const selected = toolContexts.get(token);
  need(selected, "OPAQUE_TOOLS");
  toolContexts.delete(token);
  const failures = await closeHeld(selected.held);
  recordCleanup(token, "tools-close", selected.held.length, failures.length);
  if (failures.length) throw failures[0];
}

// Kept private and unreachable from the inactive public preparation entrypoint.
// This is the ONLY creator of an ownership token. Matching a filename, contents,
// a JSON result, or a caller-supplied "restore" callback cannot create one.
async function restoreAndInstallOwnedSidecar(candidate, toolsToken) {
  const selected = candidates.get(candidate),
    tools = toolContexts.get(toolsToken);
  need(selected && tools?.candidate === candidate, "OPAQUE_TOOLS");
  return restoreOwnedCommon(selected, tools, candidate, creators);
}

async function restoreOwnedCommon(selected, tools, observationKey, ledger) {
  need(ledger === creators || ledger === proofCreators, "OWNERSHIP_LEDGER");
  const check = tools.remaining,
    held = [],
    inputs = [];
  const failureClose = { descriptors: 0, closeFailures: 0 };
  const observedClose = (fact) => {
    failureClose.descriptors += fact.descriptors;
    failureClose.closeFailures += fact.closeFailures;
  };
  let failed = false,
    primary,
    result,
    bundleHandle,
    bundleBefore;
  const validateInputs = async () => {
    check();
    need(
      stamp(await bundleHandle.stat({ bigint: true })) ===
        stamp(bundleBefore) &&
        stamp(await fs.lstat(tools.bundle, { bigint: true })) ===
          stamp(bundleBefore),
      "BUNDLE_CHANGED",
    );
    for (const [file, name] of inputs)
      await revalidateHeldFile(file, name, check);
    for (const [file, name] of [
      [tools.pythonFile, tools.python],
      [tools.archiveFile, HELPER],
    ])
      await revalidateHeldFile(file, name, check);
    check();
  };
  try {
    check();
    await noLinks(tools.bundle);
    bundleBefore = await fs.lstat(tools.bundle, { bigint: true });
    need(
      process.platform === "linux" &&
        bundleBefore.isDirectory() &&
        bundleBefore.uid === BigInt(process.getuid()),
      "RESTORE_OWNER",
    );
    bundleHandle = await fs.open(
      tools.bundle,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    held.push({ handle: bundleHandle });
    need(
      stamp(await bundleHandle.stat({ bigint: true })) === stamp(bundleBefore),
      "BUNDLE_CHANGED",
    );
    for (const [name, expected, maximum] of [
      [
        path.join(tools.bundle, "manifest.json"),
        selected.manifestPin,
        LIMITS.seal,
      ],
      [
        path.join(tools.bundle, "inventory.json"),
        selected.inventoryPin,
        LIMITS.metadata,
      ],
      [tools.recipePath, tools.recipePin, 16 * 1024],
    ]) {
      const file = await heldFile(
        name,
        maximum,
        expected,
        check,
        observedClose,
      );
      held.push(file);
      inputs.push([file, name]);
    }
    await validateInputs();
    result = await restorePreparedCommon(selected, {
      bundle: tools.bundle,
      python: tools.python,
      check,
      recipePath: tools.recipePath,
      beforeInstall: validateInputs,
      ledger,
      observationKey,
    });
    // Inputs remain held through real child completion AND install. This final
    // check also makes a late local mutation a failed transaction.
    await validateInputs();
  } catch (error) {
    failed = true;
    primary = error;
  }
  const creatorFailure = cleanupReports.get(observationKey);
  const failures = await closeHeld(held);
  recordCleanup(
    observationKey,
    "restore-inputs",
    held.length + failureClose.descriptors,
    failures.length + failureClose.closeFailures,
  );
  if (failures.length && !failed) {
    failed = true;
    primary = failures[0];
  }
  if (!failed) {
    try {
      check();
    } catch (error) {
      failed = true;
      primary = error;
    }
  }
  if (failed) {
    // Never expose an observation from a transaction with uncertain inputs or
    // closure. Post-install failure is reported; no rollback/unlink is guessed.
    if (result && ledger.has(result)) {
      try {
        await closeCreatedObservation(result, ledger);
      } catch {
        /* Recorded on its opaque observation. */
      }
    }
    const createdClose = result ? cleanupReports.get(result) : null;
    recordCleanup(
      observationKey,
      "restore-failed-closure",
      held.length +
        failureClose.descriptors +
        (creatorFailure?.phase === "creator-after-failure"
          ? creatorFailure.descriptors
          : 0) +
        (createdClose?.descriptors ?? 0),
      failures.length +
        failureClose.closeFailures +
        (creatorFailure?.phase === "creator-after-failure"
          ? creatorFailure.closeFailures
          : 0) +
        (createdClose?.closeFailures ?? 0),
    );
    throw primary;
  }
  return result;
}

async function restorePreparedCommon(
  selected,
  { bundle, python, check, recipePath, beforeInstall, ledger, observationKey },
) {
  need(selected, "OPAQUE_CANDIDATE");
  const remaining = () => {
    const value = check();
    need(positive(value) && value <= LIMITS.hostMs, "ORIGINAL_LEASE");
    return value;
  };
  remaining();
  check();
  const fresh = path.join(
    selected.freshIdentity.canonicalRoot,
    "source/src/out/Release_GN_arm64",
  );
  await noLinks(fresh);
  const freshBefore = await fs.lstat(fresh, { bigint: true });
  need(
    freshBefore.isDirectory() &&
      process.platform === "linux" &&
      freshBefore.uid === BigInt(process.getuid()),
    "RESTORE_OWNER",
  );
  const restored = path.join(path.dirname(fresh), "checkpoint-restored");
  await assert.rejects(fs.lstat(restored), { code: "ENOENT" });
  await assert.rejects(fs.lstat(fresh + ".fresh-gn"), { code: "ENOENT" });
  const result = await archiveCommand(
    python,
    HELPER,
    [
      "restore",
      "--input",
      bundle,
      "--output",
      restored,
      "--manifest",
      path.join(bundle, "manifest.json"),
      "--generated-links",
      recipePath,
    ],
    { timeout: Math.min(LIMITS.archiveMs, remaining()) },
  );
  need(result.complete === true && result.linksExtracted === false, "RESTORE");
  check();
  await noLinks(restored);
  const created = await fs.lstat(restored, { bigint: true });
  need(
    created.isDirectory() && created.uid === freshBefore.uid,
    "RESTORE_OWNER",
  );
  const rootHandle = await fs.open(
    restored,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  let opened;
  const failureClose = { descriptors: 0, closeFailures: 0 };
  try {
    need(
      directoryIdentity(await rootHandle.stat({ bigint: true })) ===
        directoryIdentity(created),
      "RESTORE_SWAP",
    );
    await verifyGraph(restored, selected.freshIdentity.graph);
    opened = await heldFile(
      path.join(restored, LINUX_MIGRATION.sidecar),
      SOURCE_METADATA_MAX_BYTES,
      selected.sidecar,
      check,
      (fact) => {
        failureClose.descriptors += fact.descriptors;
        failureClose.closeFailures += fact.closeFailures;
      },
    );
    need(opened.owner === created.uid, "SIDECAR_OWNER");
    await beforeInstall();
    need(
      directoryIdentity(await fs.lstat(fresh, { bigint: true })) ===
        directoryIdentity(freshBefore),
      "FRESH_SWAP",
    );
    check();
    await installRestoredDirectory(fresh, restored);
    await noLinks(fresh);
    need(
      directoryIdentity(await fs.lstat(fresh, { bigint: true })) ===
        directoryIdentity(created) &&
        directoryIdentity(await rootHandle.stat({ bigint: true })) ===
          directoryIdentity(created) &&
        stamp(
          await fs.lstat(path.join(fresh, LINUX_MIGRATION.sidecar), {
            bigint: true,
          }),
        ) === opened.identity &&
        stamp(await opened.handle.stat({ bigint: true })) === opened.identity,
      "INSTALL_SWAP",
    );
    check();
    const token = Object.freeze({
      kind: "restored-sidecar-creation-observation",
    });
    ledger.set(token, {
      ...opened,
      root: fresh,
      rootIdentity: created,
      rootHandle,
    });
    return token;
  } catch (error) {
    const failures = await closeHeld([
      ...(opened ? [opened] : []),
      { handle: rootHandle },
    ]);
    recordCleanup(
      observationKey,
      "creator-after-failure",
      (opened ? 1 : 0) + 1 + failureClose.descriptors,
      failures.length + failureClose.closeFailures,
    );
    throw error;
  }
}

export async function prepareLinuxMigrationRestore(candidate, options) {
  need(candidates.has(candidate), "OPAQUE_CANDIDATE");
  need(!PREPARATION_ONLY, "NOT_ACTIVATED");
  return restoreAndInstallOwnedSidecar(candidate, options);
}

function fileStampObject(info) {
  return Object.fromEntries(
    [
      ["dev", info.dev],
      ["ino", info.ino],
      ["uid", info.uid],
      ["mode", info.mode],
      ["nlink", info.nlink],
      ["size", info.size],
      ["mtimeNs", info.mtimeNs],
      ["ctimeNs", info.ctimeNs],
    ].map(([key, value]) => [key, String(value)]),
  );
}

function directoryStampObject(info) {
  const value = fileStampObject(info);
  return Object.fromEntries(
    ["dev", "ino", "uid", "mode"].map((key) => [key, value[key]]),
  );
}

function retirementResult(raw) {
  need(raw.length > 0 && raw.length <= 16 * 1024, "RETIREMENT_REPORT");
  const value = JSON.parse(raw.toString("utf8"));
  exact(value, [
    "schemaVersion",
    "kind",
    "complete",
    "phase",
    "renamed",
    "readback",
    "descriptorsClosed",
    "closeFailures",
    "migrationAdmitted",
    "nativeAcceptance",
    "runtimeReady",
    ...(value.complete === false ? ["error", "errno"] : []),
  ]);
  need(
    value.schemaVersion === 1 &&
      value.kind === "sorng-linux-owned-sidecar-retirement-result" &&
      [
        "input",
        "validation",
        "precheck",
        "rename",
        "readback",
        "complete",
      ].includes(value.phase) &&
      ["complete", "renamed", "readback", "descriptorsClosed"].every(
        (key) => typeof value[key] === "boolean",
      ) &&
      Number.isSafeInteger(value.closeFailures) &&
      value.closeFailures >= 0 &&
      value.closeFailures <= 3 &&
      value.migrationAdmitted === false &&
      value.nativeAcceptance === false &&
      value.runtimeReady === false,
    "RETIREMENT_REPORT",
  );
  need(
    (!value.readback || value.renamed) &&
      value.descriptorsClosed === (value.closeFailures === 0) &&
      (!value.renamed ||
        ["rename", "readback", "complete"].includes(value.phase)),
    "RETIREMENT_REPORT",
  );
  if (!value.complete)
    need(
      [
        "RETIRE_HOST",
        "RETIRE_SHAPE",
        "RETIRE_SCOPE",
        "RETIRE_DEADLINE",
        "RETIRE_STAMP",
        "RETIRE_FILE",
        "RETIRE_PIN",
        "RETIRE_DIRECTORY",
        "RETIRE_ALIAS",
        "RETIRE_DESTINATION_EXISTS",
        "RETIRE_SOURCE_REMAINS",
        "RETIRE_UNSUPPORTED",
        "RETIRE_READBACK",
        "RETIRE_ARGUMENTS",
        "RETIRE_INPUT",
        "RETIRE_OPERATION",
      ].includes(value.error) &&
        (value.errno === null ||
          [17, 22, 38, 18, 9, 13, 1, 2, 5].includes(value.errno)),
      "RETIREMENT_REPORT",
    );
  else
    need(
      value.phase === "complete" &&
        value.renamed &&
        value.readback &&
        value.descriptorsClosed &&
        value.closeFailures === 0,
      "RETIREMENT_REPORT",
    );
  return Object.freeze(value);
}

// Fixed current Python leaf; inherited FDs are duplicated by spawn itself.
// Destination absence is atomic. Source-inode CAS is NOT provided by renameat2;
// a substituted leaf is detected by readback and never admitted or rolled back.
async function runRetirementLeaf(token, tools, created, destination) {
  tools.remaining();
  await revalidateHeldFile(tools.pythonFile, tools.python, tools.remaining);
  await revalidateHeldFile(
    tools.retirementFile,
    RETIREMENT_HELPER,
    tools.remaining,
  );
  need(
    tools.retirementFile.pin.bytes === RETIREMENT_HELPER_PIN.bytes &&
      tools.retirementFile.pin.sha256 === RETIREMENT_HELPER_PIN.sha256,
    "RETIREMENT_HELPER_PIN",
  );
  const record = {
    schemaVersion: 1,
    kind: "sorng-linux-owned-sidecar-retirement",
    originalEndMs: tools.originalEndMs,
    file: fileStampObject(await created.handle.stat({ bigint: true })),
    sourceDirectory: directoryStampObject(
      await created.rootHandle.stat({ bigint: true }),
    ),
    destinationDirectory: directoryStampObject(
      await destination.handle.stat({ bigint: true }),
    ),
    sha256: created.pin.sha256,
  };
  const input = Buffer.from(canonical(record) + "\n");
  need(input.length <= 4096, "RETIREMENT_INPUT");
  const timeout = Math.min(LIMITS.archiveMs, tools.remaining());
  const end = performance.now() + timeout,
    reserve = Math.min(5000, Math.max(1, Math.floor(timeout / 4)));
  return new Promise((resolve, reject) => {
    let child,
      workTimer,
      endTimer,
      failed = false,
      first,
      settled = false;
    let rootExited = false,
      childClosed = false,
      stdoutClosed = false,
      stderrClosed = false,
      stdinClosed = false;
    let cleanupFault = false,
      count = 0,
      code = null;
    const chunks = [];
    const joined = () =>
      childClosed && rootExited && stdoutClosed && stderrClosed && stdinClosed;
    const finish = () => {
      if (settled) return;
      settled = true; // Pipe destruction may synchronously deliver close events.
      const checkEnd = () => {
        if (!failed) {
          try {
            need(performance.now() < end, "RETIREMENT_DEADLINE");
            tools.remaining();
          } catch (error) {
            failed = true;
            first = error;
          }
        }
      };
      checkEnd();
      let report = null;
      try {
        report = retirementResult(Buffer.concat(chunks));
      } catch (error) {
        if (!failed) {
          failed = true;
          first = error;
        }
      }
      checkEnd();
      if (
        !joined() ||
        cleanupFault ||
        code !== 0 ||
        report?.complete !== true
      ) {
        if (!failed) {
          failed = true;
          first = new Error("LINUX_MIGRATION_RETIREMENT_FAILED");
        }
      }
      let childHandleRetired = false;
      if (!joined()) {
        // No grace extension or host scan: retire only these exact creation
        // handles. Unknown root/pipe completion stays unknown in the report.
        for (const stream of [child?.stdin, child?.stdout, child?.stderr]) {
          try {
            stream?.destroy();
          } catch {
            cleanupFault = true;
          }
          try {
            stream?.unref?.();
          } catch {
            cleanupFault = true;
          }
        }
        try {
          if (child) {
            child.unref();
            childHandleRetired = true;
          }
        } catch {
          cleanupFault = true;
        }
      }
      retirementReports.set(
        token,
        Object.freeze({
          phase: "retirement-leaf",
          childJoined: joined(),
          cleanupFault,
          childHandleRetired,
          renamed: report?.renamed ?? null,
          readback: report?.readback ?? false,
          helperDescriptorsClosed: report?.descriptorsClosed ?? null,
          helperCloseFailures: report?.closeFailures ?? null,
          leafAccepted: !failed,
          accepted: false,
          sourceInodeCas: false,
        }),
      );
      clearTimeout(workTimer);
      clearTimeout(endTimer);
      if (failed) reject(first);
      else resolve(report);
    };
    const stop = () => {
      if (child?.pid && !rootExited) {
        try {
          if (!child.kill("SIGKILL")) cleanupFault = true;
        } catch {
          cleanupFault = true;
        }
      }
      for (const stream of [child?.stdin, child?.stdout, child?.stderr]) {
        try {
          stream?.destroy();
        } catch {
          cleanupFault = true;
        }
      }
    };
    const fail = (error) => {
      if (settled) return;
      if (!failed) {
        failed = true;
        first = error;
      }
      stop();
      if (joined()) finish();
    };
    const onClose = () => {
      if (!settled && joined()) finish();
    };
    workTimer = setTimeout(
      () => fail(new Error("LINUX_MIGRATION_RETIREMENT_DEADLINE")),
      Math.max(0, timeout - reserve),
    );
    endTimer = setTimeout(
      () => {
        fail(new Error("LINUX_MIGRATION_RETIREMENT_DEADLINE"));
        finish();
      },
      Math.max(0, end - performance.now()),
    );
    try {
      child = spawn(tools.python, ["-I", "-B", "-S", RETIREMENT_HELPER], {
        shell: false,
        windowsHide: true,
        detached: false,
        env: {
          PATH: path.dirname(tools.python),
          LANG: "C.UTF-8",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONNOUSERSITE: "1",
        },
        stdio: [
          "pipe",
          "pipe",
          "pipe",
          created.rootHandle.fd,
          created.handle.fd,
          destination.handle.fd,
        ],
      });
      child.on("error", fail);
      child.on("exit", (value) => {
        rootExited = true;
        code = value;
        onClose();
      });
      child.on("close", () => {
        childClosed = true;
        if (!child.pid) rootExited = true;
        onClose();
      });
      for (const [stream, role] of [
        [child.stdin, "stdin"],
        [child.stdout, "stdout"],
        [child.stderr, "stderr"],
      ]) {
        stream.on("error", fail);
        stream.on("close", () => {
          if (role === "stdin") stdinClosed = true;
          else if (role === "stdout") stdoutClosed = true;
          else stderrClosed = true;
          onClose();
        });
        if (role !== "stdin")
          stream.on("data", (part) => {
            if (settled) return;
            count += part.length;
            if (count > 16 * 1024)
              return fail(new Error("LINUX_MIGRATION_RETIREMENT_OUTPUT_BOUND"));
            if (role === "stdout") chunks.push(Buffer.from(part));
          });
      }
      child.stdin.end(input);
    } catch (error) {
      if (!child) {
        rootExited = true;
        childClosed = true;
        stdoutClosed = true;
        stderrClosed = true;
        stdinClosed = true;
      }
      fail(error);
      if (joined()) finish();
    }
  });
}

async function retireCreationOwnedSidecar(token, toolsToken) {
  const created = creators.get(token),
    tools = toolContexts.get(toolsToken);
  need(created && tools, "OPAQUE_CREATOR");
  // No caller boolean, callback, report or path can satisfy this map. It stays
  // empty until genuine production GN/apply integration is separately reviewed.
  need(
    retirementReadiness.get(token)?.toolsToken === toolsToken,
    "GENUINE_GN_AND_APPLIES_REQUIRED",
  );
  retirementReadiness.delete(token);
  return retireOwnedCommon(
    token,
    tools,
    created,
    creators,
    candidates.get(tools.candidate).freshIdentity.canonicalRoot,
  );
}

async function retireOwnedCommon(token, tools, created, ledger, work) {
  need(ledger === creators || ledger === proofCreators, "OWNERSHIP_LEDGER");
  need(ledger.get(token) === created, "OPAQUE_CREATOR");
  ledger.delete(token);
  const destinationPath = path.join(
    work,
    "linux-migration-retired-" + randomUUID(),
  );
  let destination,
    failed = false,
    primary,
    result;
  try {
    tools.remaining();
    await revalidateHeldFile(
      created,
      path.join(created.root, LINUX_MIGRATION.sidecar),
      tools.remaining,
    );
    need(
      directoryIdentity(await fs.lstat(created.root, { bigint: true })) ===
        directoryIdentity(created.rootIdentity),
      "INSTALL_SWAP",
    );
    await fs.mkdir(destinationPath, { mode: 0o700 });
    await noLinks(destinationPath);
    const info = await fs.lstat(destinationPath, { bigint: true });
    need(
      info.isDirectory() &&
        info.uid === BigInt(process.getuid()) &&
        (info.mode & 0o777n) === 0o700n,
      "RETIREMENT_DESTINATION",
    );
    ownedRetirements.set(token, {
      path: destinationPath,
      directory: info,
      complete: false,
    });
    destination = await fs.open(
      destinationPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    need(
      directoryIdentity(await destination.stat({ bigint: true })) ===
        directoryIdentity(info),
      "RETIREMENT_DESTINATION",
    );
    result = await runRetirementLeaf(token, tools, created, {
      handle: destination,
    });
    await revalidateHeldFile(tools.pythonFile, tools.python, tools.remaining);
    await revalidateHeldFile(
      tools.retirementFile,
      RETIREMENT_HELPER,
      tools.remaining,
    );
    const retiredPath = path.join(destinationPath, LINUX_MIGRATION.sidecar);
    const retired = await created.handle.stat({ bigint: true });
    need(
      directoryIdentity(await fs.lstat(destinationPath, { bigint: true })) ===
        directoryIdentity(info) &&
        directoryIdentity(await destination.stat({ bigint: true })) ===
          directoryIdentity(info) &&
        directoryIdentity(await fs.lstat(created.root, { bigint: true })) ===
          directoryIdentity(created.rootIdentity),
      "RETIREMENT_DESTINATION",
    );
    // The known rename may advance ctime. Every other field and the complete
    // old sealed bytes must still match the creation-owned held descriptor.
    need(
      stamp(retired).split(":").slice(0, 7).join(":") ===
        created.identity.split(":").slice(0, 7).join(":"),
      "RETIREMENT_READBACK",
    );
    await revalidateHeldFile(
      { ...created, identity: stamp(retired) },
      retiredPath,
      tools.remaining,
    );
    await assert.rejects(
      fs.lstat(path.join(created.root, LINUX_MIGRATION.sidecar)),
      { code: "ENOENT" },
    );
    ownedRetirements.set(token, {
      path: destinationPath,
      directory: info,
      file: retired,
      complete: true,
    });
  } catch (error) {
    failed = true;
    primary = error;
  }
  const descriptors = [
    { handle: created.handle },
    { handle: created.rootHandle },
    ...(destination ? [{ handle: destination }] : []),
  ];
  const failures = await closeHeld(descriptors);
  recordCleanup(
    token,
    "retirement-parent-close",
    descriptors.length,
    failures.length,
  );
  if (failures.length && !failed) {
    failed = true;
    primary = failures[0];
  }
  const observed = retirementReports.get(token);
  if (!failed) {
    try {
      tools.remaining();
    } catch (error) {
      failed = true;
      primary = error;
    }
  }
  retirementReports.set(
    token,
    Object.freeze({
      ...(observed ?? {
        renamed: null,
        readback: false,
        sourceInodeCas: false,
      }),
      phase: "retirement-transaction",
      accepted: !failed,
      parentDescriptorsClosed: failures.length === 0,
      parentCloseFailures: failures.length,
    }),
  );
  if (failed) throw primary;
  return result;
}

export function inspectLinuxRetirementObservation(token) {
  need(retirementReports.has(token), "NO_RETIREMENT_OBSERVATION");
  return retirementReports.get(token);
}

export async function prepareLinuxMigrationRetirement(token, toolsToken) {
  need(creators.has(token), "OPAQUE_CREATOR");
  need(!PREPARATION_ONLY, "NOT_ACTIVATED");
  return retireCreationOwnedSidecar(token, toolsToken);
}

export function inspectSidecarRetirementContract(token) {
  const created = creators.get(token);
  need(created, "OPAQUE_CREATOR");
  return Object.freeze({
    kind: "linux-sidecar-retirement-contract",
    authorizing: false,
    executorAvailable: false,
    sidecar: LINUX_MIGRATION.sidecar,
    bytes: created.pin.bytes,
    sha256: created.pin.sha256,
    requiredTransition:
      "held-creation-owned-sidecar-to-exclusive-private-destination",
    cacheAction: "unchanged",
  });
}

export async function closeSidecarCreationObservation(token) {
  return closeCreatedObservation(token, creators);
}

async function closeCreatedObservation(token, ledger) {
  need(ledger === creators || ledger === proofCreators, "OWNERSHIP_LEDGER");
  const created = ledger.get(token);
  need(created, "OPAQUE_CREATOR");
  ledger.delete(token); // Retire authority even if the real close reports fault.
  let primary,
    failed = false,
    failures = 0;
  try {
    await created.handle.close();
  } catch (error) {
    failures++;
    primary = error;
    failed = true;
  }
  try {
    await created.rootHandle.close();
  } catch (error) {
    failures++;
    if (!failed) {
      primary = error;
      failed = true;
    }
  }
  recordCleanup(token, "creator-close", 2, failures);
  if (failed) throw primary;
}

// BEGIN inactive fixed migration transaction
const TRANSACTION_ADMITTED = true;
const activeMigrationTransactions = new WeakMap();
const spentMigrationContexts = new WeakSet();
const completedMigrationTransactions = new WeakMap();
function transactionCompletionBinding(live) {
  return canonical(
    [
      "target",
      "sourceLockIdentity",
      "canonicalRoot",
      "toolsRoot",
      "python",
      "cef",
      "depot",
      "cwd",
      "logs",
    ].map((key) => live[key]),
  );
}
function transactionSourceBinding(live, selected, tools) {
  need(
    live.target === LINUX_MIGRATION.target &&
      live.sourceLockIdentity === LINUX_MIGRATION.source &&
      live.canonicalRoot === selected.freshIdentity.canonicalRoot &&
      live.canonicalRoot === tools.work &&
      live.python === tools.python &&
      live.toolsRoot === tools.toolsRoot &&
      live.cef === path.join(tools.chromium, "cef") &&
      live.depot === path.join(tools.work, "source/depot_tools") &&
      live.cwd === tools.chromium &&
      live.logs === path.join(tools.work, "logs") &&
      live.initialCohortQuietProven === true,
    "TRANSACTION_SOURCE_OWNER",
  );
}
function transactionCheck(state) {
  need(
    state.active && activeMigrationTransactions.get(state.context) === state,
    "TRANSACTION_RETIRED",
  );
  need(
    candidates.get(state.candidate) === state.selected &&
      toolContexts.get(state.toolsToken) === state.originalTools,
    "TRANSACTION_TOKENS",
  );
  const live = assertLiveLinuxSourceContext(state.context);
  transactionSourceBinding(live, state.selected, state.originalTools);
  need(live.revalidationUsed === state.gnUsed, "TRANSACTION_GN_ORDER");
  return Math.min(live.remainingMilliseconds, state.originalTools.remaining());
}
async function transactionPhase(state, action) {
  transactionCheck(state);
  const result = await action();
  transactionCheck(state); // Before any subsequent mutation/branding.
  return result;
}
async function transactionRecheck(state) {
  const check = () => transactionCheck(state),
    tools = state.originalTools;
  check();
  need(
    git(ROOT, ["rev-parse", "HEAD"]).toString().trim() ===
      state.selected.currentProducer.head,
    "CURRENT_HEAD",
  );
  const capsule = await heldFile(
    path.join(ROOT, LINUX_MIGRATION.policyPath),
    128 * 1024,
    state.selected.policyPin,
    check,
  );
  let failed = false,
    primary;
  try {
    await revalidateHeldFile(
      capsule,
      path.join(ROOT, LINUX_MIGRATION.policyPath),
      check,
    );
  } catch (error) {
    failed = true;
    primary = error;
  }
  const capsuleClose = await closeHeld([capsule]);
  if (failed) throw primary;
  if (capsuleClose.length) throw capsuleClose[0];
  check();
  for (const [file, name] of [
    [tools.pythonFile, tools.python],
    [tools.archiveFile, HELPER],
    [tools.retirementFile, RETIREMENT_HELPER],
    ...state.identities.map((row) => [row, row.path]),
  ])
    await revalidateHeldFile(file, name, check);
  need(
    directoryIdentity(await fs.lstat(state.source, { bigint: true })) ===
      state.sourceIdentity &&
      directoryIdentity(await state.sourceHandle.stat({ bigint: true })) ===
        state.sourceIdentity,
    "TRANSACTION_SOURCE_ROOT",
  );
  need(
    directoryIdentity(await fs.lstat(state.logs, { bigint: true })) ===
      state.logsIdentity &&
      directoryIdentity(await state.logsHandle.stat({ bigint: true })) ===
        state.logsIdentity,
    "TRANSACTION_LOG_ROOT",
  );
  if (state.controlHandle)
    need(
      directoryIdentity(await fs.lstat(state.control, { bigint: true })) ===
        state.controlIdentity &&
        directoryIdentity(await state.controlHandle.stat({ bigint: true })) ===
          state.controlIdentity,
      "TRANSACTION_CONTROL_ROOT",
    );
  if (state.creator && creators.has(state.creator)) {
    const created = creators.get(state.creator);
    need(
      directoryIdentity(await fs.lstat(created.root, { bigint: true })) ===
        directoryIdentity(created.rootIdentity) &&
        directoryIdentity(await created.rootHandle.stat({ bigint: true })) ===
          directoryIdentity(created.rootIdentity),
      "INSTALL_SWAP",
    );
    await revalidateHeldFile(
      created,
      path.join(created.root, LINUX_MIGRATION.sidecar),
      check,
    );
  }
  check();
}
async function transactionControlDirectory(state, file, handle) {
  const check = () => transactionCheck(state);
  await noLinks(state.logs);
  check();
  need(
    directoryIdentity(await fs.lstat(state.logs, { bigint: true })) ===
      state.logsIdentity &&
      directoryIdentity(await state.logsHandle.stat({ bigint: true })) ===
        state.logsIdentity,
    "TRANSACTION_LOG_ROOT",
  );
  check();
  if (state.controlHandle) {
    await noLinks(state.control);
    check();
    need(
      directoryIdentity(await fs.lstat(state.control, { bigint: true })) ===
        state.controlIdentity &&
        directoryIdentity(await state.controlHandle.stat({ bigint: true })) ===
          state.controlIdentity,
      "TRANSACTION_CONTROL_ROOT",
    );
    check();
  }
  if (handle) {
    const named = await fs.lstat(file, { bigint: true });
    check();
    const held = await handle.stat({ bigint: true });
    check();
    need(
      named.isFile() &&
        named.nlink === 1n &&
        named.uid === BigInt(process.getuid()) &&
        stamp(named) === stamp(held),
      "TRANSACTION_IDENTITY_FILE",
    );
  }
  check();
}
async function transactionControls(state) {
  const check = () => transactionCheck(state),
    tools = state.originalTools;
  state.source = path.join(tools.work, "source");
  await noLinks(state.source);
  check();
  state.sourceHandle = await fs.open(
    state.source,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  state.handles.push({ handle: state.sourceHandle });
  check();
  const sourceInfo = await state.sourceHandle.stat({ bigint: true });
  check();
  need(sourceInfo.uid === BigInt(process.getuid()), "TRANSACTION_SOURCE_ROOT");
  state.sourceIdentity = directoryIdentity(sourceInfo);
  state.logs = path.join(tools.work, "logs");
  await noLinks(state.logs);
  check();
  state.logsHandle = await fs.open(
    state.logs,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  state.handles.push({ handle: state.logsHandle });
  check();
  const logsInfo = await state.logsHandle.stat({ bigint: true });
  check();
  need(logsInfo.uid === BigInt(process.getuid()), "TRANSACTION_LOG_ROOT");
  state.logsIdentity = directoryIdentity(logsInfo);
  state.control = path.join(
    tools.work,
    "logs",
    "linux-migration-transaction-" + randomUUID(),
  );
  await transactionControlDirectory(state);
  check();
  check();
  await fs.mkdir(state.control, { mode: 0o700 });
  check();
  state.controlHandle = await fs.open(
    state.control,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  state.handles.push({ handle: state.controlHandle });
  check();
  const controlInfo = await state.controlHandle.stat({ bigint: true });
  check();
  need(
    controlInfo.uid === BigInt(process.getuid()) &&
      (controlInfo.mode & 0o777n) === 0o700n,
    "TRANSACTION_CONTROL_ROOT",
  );
  state.controlIdentity = directoryIdentity(controlInfo);
  for (const [name, identity] of [
    ["old", state.selected.manifest.identity],
    ["new", state.selected.freshIdentity],
  ]) {
    const file = path.join(state.control, name + ".json"),
      raw = Buffer.from(canonical(identity));
    need(raw.length <= 16 * 1024, "TRANSACTION_IDENTITY");
    await transactionControlDirectory(state);
    check();
    check();
    const handle = await fs.open(
      file,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_RDWR,
      0o600,
    );
    state.handles.push({ handle });
    check();
    await transactionControlDirectory(state, file, handle);
    check();
    await handle.writeFile(raw);
    check();
    await transactionControlDirectory(state, file, handle);
    check();
    await handle.sync();
    check();
    const info = await handle.stat({ bigint: true });
    check();
    state.identities.push({
      handle,
      path: file,
      identity: stamp(info),
      pin: { bytes: raw.length, sha256: sha(raw) },
    });
  }
}
async function transactionSourceMode(state, mode, which) {
  need(
    (mode === "source-apply" && which === "old") ||
      (mode === "source-record" && which === "new"),
    "TRANSACTION_METADATA_MODE",
  );
  const timeout = Math.floor(
    Math.min(LIMITS.linuxSourceMetadataMs, transactionCheck(state)),
  );
  need(timeout > 0, "ORIGINAL_LEASE");
  const seconds = Math.max(
    1,
    Math.floor(
      (timeout > 2 * LIMITS.linuxSourceMetadataGraceMs
        ? timeout - LIMITS.linuxSourceMetadataGraceMs
        : timeout) / 1000,
    ),
  );
  const identity = state.identities.find(
    (row) => path.basename(row.path) === which + ".json",
  );
  need(identity, "TRANSACTION_IDENTITY");
  transactionCheck(state);
  return sourceMetadataResult(
    await archiveCommand(
      state.originalTools.python,
      HELPER,
      [
        mode,
        "--input",
        state.source,
        "--output",
        path.join(state.originalTools.out, LINUX_MIGRATION.sidecar),
        "--manifest",
        identity.path,
        "--seconds",
        String(seconds),
      ],
      { timeout },
    ),
    mode,
  );
}
async function transactionNewRecord(state, recorded) {
  need(
    recorded.timing?.reusedFiles === 0 &&
      recorded.timing.hashedFiles > 0 &&
      recorded.timing.hashedFiles <= recorded.entries &&
      recorded.timing.hashedBytes === recorded.bytes,
    "TRANSACTION_FULL_RECORD",
  );
  const check = () => transactionCheck(state);
  const sidecar = await heldFile(
    path.join(state.originalTools.out, LINUX_MIGRATION.sidecar),
    SOURCE_METADATA_MAX_BYTES,
    { bytes: recorded.sidecar.bytes, sha256: recorded.sidecar.sha256 },
    check,
  );
  state.handles.push(sidecar);
  check();
  const cachePath = path.join(
    state.source,
    "acquisition-logs/.sorng-source-stat-cache.json",
  );
  const cache = await heldFile(
    cachePath,
    1024 ** 3,
    null,
    check,
    undefined,
    false,
  );
  state.handles.push(cache);
  check();
  need(
    sidecar.owner === BigInt(process.getuid()) &&
      cache.owner === sidecar.owner &&
      recorded.sidecar.name === LINUX_MIGRATION.sidecar,
    "TRANSACTION_CACHE_OWNER",
  );
  // The fixed helper writes these four header fields before its large entries
  // array. Authenticate the whole held stream, inspect only this bounded prefix.
  const prefix = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      kind: "sorng-linuxarm-source-stat-cache",
      sidecarSha256: sidecar.pin.sha256,
      identity: JSON.parse(canonical(state.selected.freshIdentity)),
    }).slice(0, -1) + ',"entries":[',
  );
  need(prefix.length <= 16 * 1024, "TRANSACTION_CACHE_HEADER");
  const bytes = Buffer.alloc(prefix.length);
  const read = await cache.handle.read(bytes, 0, bytes.length, 0);
  check();
  need(
    read.bytesRead === prefix.length && bytes.equals(prefix),
    "TRANSACTION_CACHE_BINDING",
  );
  await revalidateHeldFile(cache, cachePath, check);
  await revalidateHeldFile(
    sidecar,
    path.join(state.originalTools.out, LINUX_MIGRATION.sidecar),
    check,
  );
}
async function runClosedLinuxMigrationTransaction(
  context,
  candidate,
  toolsToken,
) {
  const initial = assertLiveLinuxSourceContext(context);
  need(initial.revalidationUsed === false, "TRANSACTION_GN_ALREADY_USED");
  const selected = candidates.get(candidate),
    originalTools = toolContexts.get(toolsToken);
  need(selected && originalTools?.candidate === candidate, "OPAQUE_TOOLS");
  transactionSourceBinding(initial, selected, originalTools);
  need(!spentMigrationContexts.has(context), "TRANSACTION_ALREADY_USED");
  spentMigrationContexts.add(context);
  const state = {
    context,
    candidate,
    toolsToken,
    selected,
    originalTools,
    active: true,
    gnUsed: false,
    handles: [],
    identities: [],
    creator: null,
    sourceHandle: null,
    controlHandle: null,
  };
  activeMigrationTransactions.set(context, state);
  const tools = { ...originalTools, remaining: () => transactionCheck(state) };
  let failed = false,
    primary,
    result;
  const remember = (error) => {
    if (!failed) {
      failed = true;
      primary = error;
    }
  };
  try {
    await transactionPhase(state, () => transactionControls(state));
    await transactionPhase(state, () => transactionRecheck(state));
    await transactionPhase(state, async () => {
      state.creator = await restoreOwnedCommon(
        selected,
        tools,
        candidate,
        creators,
      );
    });
    await transactionPhase(state, () => transactionRecheck(state));
    await transactionPhase(state, () =>
      transactionSourceMode(state, "source-apply", "old"),
    );
    await transactionPhase(state, () => transactionRecheck(state));
    const receipt = await transactionPhase(state, async () => {
      const pending = revalidateLinuxSourceOwner(context);
      state.gnUsed = true;
      return await pending;
    });
    const gn = assertLinuxSourceOwnerReceipt(context, receipt);
    need(
      gn.cohortQuietProven === true && gn.commandCompleted === true,
      "TRANSACTION_GN_UNCONFIRMED",
    );
    await transactionPhase(state, () =>
      verifyGraph(originalTools.out, selected.freshIdentity.graph),
    );
    const recipe = await transactionPhase(state, () =>
      linuxArmRecipe(originalTools.chromium, originalTools.out),
    );
    need(
      canonical(recipe) === originalTools.linuxRecipeJson,
      "TRANSACTION_RECIPE_CHANGED",
    );
    await transactionPhase(state, () =>
      transactionSourceMode(state, "source-apply", "old"),
    );
    await transactionPhase(state, () => transactionRecheck(state));
    transactionCheck(state);
    assertLinuxSourceOwnerReceipt(context, receipt);
    const created = creators.get(state.creator);
    need(created, "OPAQUE_CREATOR");
    retirementReadiness.set(state.creator, {
      toolsToken,
      transaction: state,
    });
    const ready = retirementReadiness.get(state.creator);
    need(
      ready?.transaction === state && ready.toolsToken === toolsToken,
      "TRANSACTION_READINESS",
    );
    retirementReadiness.delete(state.creator); // Consume BEFORE any retirement await.
    await transactionPhase(state, () =>
      retireOwnedCommon(
        state.creator,
        tools,
        created,
        creators,
        originalTools.work,
      ),
    );
    const retired = retirementReports.get(state.creator);
    need(
      retired?.accepted === true &&
        retired.childJoined === true &&
        retired.parentDescriptorsClosed === true &&
        retired.sourceInodeCas === false,
      "TRANSACTION_RETIREMENT_UNCONFIRMED",
    );
    await transactionPhase(state, () => transactionRecheck(state));
    const recorded = await transactionPhase(state, () =>
      transactionSourceMode(state, "source-record", "new"),
    );
    await transactionPhase(state, () => transactionNewRecord(state, recorded));
    await transactionPhase(state, () => transactionRecheck(state));
    result = {
      sourceInputsRevalidated: true,
      oldApplies: 2,
      cohortQuietProven: true,
      newRecord: true,
      newRecordReusedFiles: 0,
      newCacheHeaderBinding: true,
      completeCacheStructureValidated: false,
    };
  } catch (error) {
    remember(error);
  }
  // Revoke every authority synchronously before any awaited close/join. Retain
  // forensic files/partial states; never unlink/rollback an unknown object.
  state.active = false;
  activeMigrationTransactions.delete(context);
  if (state.creator) retirementReadiness.delete(state.creator);
  candidates.delete(candidate);
  const createdToClose = state.creator ? creators.get(state.creator) : null;
  if (state.creator) creators.delete(state.creator);
  const toolsToClose = toolContexts.get(toolsToken);
  toolContexts.delete(toolsToken);
  const closes = [];
  if (createdToClose)
    closes.push(
      closeHeld([
        { handle: createdToClose.handle },
        { handle: createdToClose.rootHandle },
      ]).then((failures) => {
        recordCleanup(state.creator, "creator-close", 2, failures.length);
        if (failures.length) throw failures[0];
      }),
    );
  if (toolsToClose)
    closes.push(
      closeHeld(toolsToClose.held).then((failures) => {
        recordCleanup(
          toolsToken,
          "tools-close",
          toolsToClose.held.length,
          failures.length,
        );
        if (failures.length) throw failures[0];
      }),
    );
  closes.push(
    closeHeld(state.handles).then((failures) => {
      if (failures.length) throw failures[0];
    }),
  );
  for (const closing of closes) void closing.catch(() => {});
  for (const closing of closes)
    try {
      await closing;
    } catch (error) {
      remember(error);
    }
  if (!failed) {
    try {
      transactionSourceBinding(
        assertLiveLinuxSourceContext(context),
        selected,
        originalTools,
      );
      originalTools.remaining();
      need(
        git(ROOT, ["rev-parse", "HEAD"]).toString().trim() ===
          selected.currentProducer.head,
        "CURRENT_HEAD",
      );
    } catch (error) {
      remember(error);
    }
  }
  if (failed) throw primary;
  const completion = Object.freeze({
    kind: "closed-linux-migration-completion",
    authorizing: false,
  });
  completedMigrationTransactions.set(
    completion,
    Object.freeze({
      context,
      sourceBinding: transactionCompletionBinding(initial),
      result: Object.freeze(result),
    }),
  );
  return completion; // Plain JSON never becomes a compile capability.
}
export async function prepareLinuxMigrationTransaction(
  context,
  candidate,
  toolsToken,
) {
  const live = assertLiveLinuxSourceContext(context);
  need(live.revalidationUsed === false, "TRANSACTION_GN_ALREADY_USED");
  need(TRANSACTION_ADMITTED, "TRANSACTION_NOT_ACTIVATED");
  let completion;
  try {
    completion = await runClosedLinuxMigrationTransaction(
      context,
      candidate,
      toolsToken,
    );
    const record = completedMigrationTransactions.get(completion);
    need(record?.context === context, "TRANSACTION_COMPLETION_CONTEXT");
    const current = assertLiveLinuxSourceContext(context);
    need(
      current.revalidationUsed === true &&
        current.initialCohortQuietProven === true &&
        transactionCompletionBinding(current) === record.sourceBinding,
      "TRANSACTION_COMPLETION_CONTEXT",
    );
    return completion; // No await after the final live/private-context check.
  } catch (error) {
    if (completion !== undefined)
      completedMigrationTransactions.delete(completion);
    throw error;
  }
}
// END inactive fixed migration transaction

// BEGIN closed migration CLI data and completion
async function fixedLinuxMigrationSelection(root, currentProducer, check) {
  producer(currentProducer);
  check();
  root = await noLinks(root);
  need(
    git(root, ["rev-parse", "HEAD"]).toString().trim() === currentProducer.head,
    "CURRENT_HEAD",
  );
  const policyRows = tree(
    git(root, ["ls-tree", "HEAD", "--", LINUX_MIGRATION.policyPath]),
  );
  if (!policyRows.length) {
    check();
    need(
      git(root, ["rev-parse", "HEAD"]).toString().trim() ===
        currentProducer.head,
      "CURRENT_HEAD",
    );
    // An uncommitted policy is not an absent reviewed policy.
    try {
      await fs.lstat(path.join(root, LINUX_MIGRATION.policyPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      check();
      need(
        git(root, ["rev-parse", "HEAD"]).toString().trim() ===
          currentProducer.head,
        "CURRENT_HEAD",
      );
      return null;
    }
    need(false, "POLICY_UNCOMMITTED");
  }
  need(policyRows.length === 1, "POLICY_MISSING");
  const raw = git(root, [
    "cat-file",
    "blob",
    "HEAD:" + LINUX_MIGRATION.policyPath,
  ]);
  const file = await heldFile(
    path.join(root, LINUX_MIGRATION.policyPath),
    128 * 1024,
    { bytes: raw.length, sha256: sha(raw) },
    check,
  );
  await file.handle.close();
  check();
  const policy = json(raw, 128 * 1024);
  exact(policy, [
    "schemaVersion",
    "kind",
    "target",
    "source",
    "linuxMetadata",
    "from",
    "toProducer",
    "oldSourceTree",
    "changedSources",
  ]);
  const entries = tree(
    git(root, [
      "ls-tree",
      "-r",
      "HEAD",
      "--",
      "scripts",
      "native/cef-hosted-recipe.json",
      ".node-version",
      WORKFLOW,
    ]),
  );
  need(
    policy.schemaVersion === 1 &&
      policy.kind === "sorng-linuxarm-exact-producer-migration" &&
      policy.target === LINUX_MIGRATION.target &&
      policy.source === LINUX_MIGRATION.source &&
      policy.toProducer === codeTreeDigest(entries) &&
      policy.toProducer !== LINUX_MIGRATION.producer,
    "POLICY_SCOPE",
  );
  exact(policy.linuxMetadata, [
    "schemaVersion",
    "kind",
    "policy",
    "sourceDateEpoch",
  ]);
  need(
    policy.linuxMetadata.schemaVersion === 1 &&
      policy.linuxMetadata.kind === "sorng-linuxarm-source-metadata" &&
      policy.linuxMetadata.policy === LINUX_MIGRATION.metadataPolicy &&
      policy.linuxMetadata.sourceDateEpoch === LINUX_MIGRATION.epoch,
    "LINUX_METADATA",
  );
  exact(policy.from, [
    "producer",
    "checkpointProducer",
    "identitySha256",
    "sealArtifact",
    "seal",
    "manifest",
    "inventory",
    "sidecar",
  ]);
  producer(policy.from.checkpointProducer, true);
  need(
    policy.from.producer === LINUX_MIGRATION.producer &&
      hex(policy.from.identitySha256) &&
      Array.isArray(policy.oldSourceTree) &&
      policy.oldSourceTree.length === LINUX_MIGRATION.sourceFiles &&
      codeTreeDigest(policy.oldSourceTree) === LINUX_MIGRATION.producer,
    "OLD_SOURCE",
  );
  exact(policy.from.sealArtifact, ["id", "bytes", "sha256"]);
  need(positive(policy.from.sealArtifact.id), "SEAL_ARTIFACT");
  pin(
    {
      bytes: policy.from.sealArtifact.bytes,
      sha256: policy.from.sealArtifact.sha256,
    },
    LIMITS.seal,
  );
  pin(policy.from.seal, LIMITS.seal);
  pin(policy.from.manifest, LIMITS.seal);
  pin(policy.from.inventory, LIMITS.metadata);
  pin(policy.from.sidecar, SOURCE_METADATA_MAX_BYTES);
  check();
  need(
    git(root, ["rev-parse", "HEAD"]).toString().trim() === currentProducer.head,
    "CURRENT_HEAD",
  );
  return Object.freeze({
    kind: "linux-migration-download-selection-data",
    authorizing: false,
    policySha256: sha(raw),
    policyBlob: policyRows[0].sha,
    toProducer: policy.toProducer,
    checkpointProducer: Object.freeze({ ...policy.from.checkpointProducer }),
    sealArtifact: Object.freeze({ ...policy.from.sealArtifact }),
    seal: Object.freeze({ ...policy.from.seal }),
    manifest: Object.freeze({ ...policy.from.manifest }),
    inventory: Object.freeze({ ...policy.from.inventory }),
  });
}
export async function readLinuxMigrationSelection(...args) {
  need(args.length === 0, "SELECTION_ARGUMENTS");
  const currentProducer = authority(process.env);
  const check = () => need(hostRemaining(process.env) > 0, "SELECTION_LEASE");
  return await fixedLinuxMigrationSelection(ROOT, currentProducer, check);
}
export function consumeLinuxMigrationCompletion(context, completion) {
  const record = completedMigrationTransactions.get(completion);
  need(record?.context === context, "TRANSACTION_COMPLETION_CONTEXT");
  const current = assertLiveLinuxSourceContext(context);
  need(
    current.revalidationUsed === true &&
      current.initialCohortQuietProven === true &&
      transactionCompletionBinding(current) === record.sourceBinding,
    "TRANSACTION_COMPLETION_CONTEXT",
  );
  completedMigrationTransactions.delete(completion);
  return Object.freeze({ ...record.result }); // Diagnostic only, already consumed.
}
// END closed migration CLI data and completion

function proofAuthority() {
  need(process.platform === "linux" && process.arch === "x64", "PROOF_HOST");
  const env = process.env;
  need(
    env.ImageOS === "ubuntu24" &&
      env.ImageVersion === "20261026.354.1" &&
      env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REF === PROOF.branch &&
      env.GITHUB_WORKFLOW_REF ===
        "supermarsx/sortOfRemoteNG/" + PROOF.workflow + "@" + PROOF.branch &&
      hex(env.GITHUB_SHA, 40) &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      /^[1-9][0-9]{0,14}$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]{0,2}$/.test(env.GITHUB_RUN_ATTEMPT ?? "") &&
      env.RUNNER_TEMP === PROOF.temp &&
      !env.GH_TOKEN &&
      !env.GITHUB_TOKEN,
    "PROOF_AUTHORITY",
  );
  const started = Number(env.CEF_LINUX_MIGRATION_PROOF_STARTED_MS),
    now = Date.now();
  need(
    Number.isSafeInteger(started) && started > 0 && now >= started,
    "PROOF_CLOCK",
  );
  const budget = Math.min(160000, started + 300000 - now - 30000);
  need(Number.isSafeInteger(budget) && budget > 0, "PROOF_CLOCK");
  const end = performance.now() + budget,
    wallEnd = now + budget;
  return {
    head: env.GITHUB_SHA,
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    originalEndMs: wallEnd,
    remaining() {
      const value = Math.floor(
        Math.min(end - performance.now(), wallEnd - Date.now()),
      );
      need(value > 0, "PROOF_DEADLINE");
      return value;
    },
  };
}

function proofGeneration(info, kind) {
  return [
    info.dev,
    info.ino,
    info.uid,
    info.gid,
    info.mode,
    ...(kind === "directory" ? [] : [info.nlink, info.size]),
  ].join(":");
}

function proofPath(state, relative) {
  need(
    typeof relative === "string" &&
      relative.length <= 512 &&
      !relative.includes("\\") &&
      !path.isAbsolute(relative) &&
      (relative === "" ||
        relative
          .split("/")
          .every((part) => part && part !== "." && part !== "..")),
    "PROOF_PATH",
  );
  const result = path.join(state.root, relative);
  need(
    result === state.root || result.startsWith(state.root + path.sep),
    "PROOF_PATH",
  );
  return result;
}

async function proofRootCurrent(state, retired = false) {
  state.remaining();
  if (!retired) need(proofScopes.get(state.scope) === state, "PROOF_SCOPE");
  await noLinks(state.root);
  need(
    proofGeneration(
      await fs.lstat(state.root, { bigint: true }),
      "directory",
    ) === state.rootGeneration &&
      proofGeneration(
        await state.rootHandle.stat({ bigint: true }),
        "directory",
      ) === state.rootGeneration &&
      directoryIdentity(await fs.lstat(PROOF.temp, { bigint: true })) ===
        state.parentGeneration &&
      directoryIdentity(await state.parentHandle.stat({ bigint: true })) ===
        state.parentGeneration,
    "PROOF_ROOT_CHANGED",
  );
  state.remaining();
}

async function proofRemember(state, relative, kind, target) {
  const name = proofPath(state, relative),
    info = await fs.lstat(name, { bigint: true });
  need(
    info.uid === BigInt(process.getuid()) &&
      (kind === "directory"
        ? info.isDirectory()
        : kind === "file"
          ? info.isFile() && info.nlink === 1n
          : info.isSymbolicLink() && info.nlink === 1n),
    "PROOF_OWNERSHIP",
  );
  if (kind !== "link") await noLinks(name);
  else need((await fs.readlink(name)) === target, "PROOF_LINK");
  need(state.entries.size < 256 || state.entries.has(relative), "PROOF_BOUND");
  state.entries.set(relative, {
    kind,
    target,
    generation: proofGeneration(info, kind),
  });
}

async function proofCheckEntry(state, relative) {
  const expected = state.entries.get(relative);
  need(expected, "PROOF_OWNERSHIP");
  const name = proofPath(state, relative),
    info = await fs.lstat(name, { bigint: true });
  need(
    proofGeneration(info, expected.kind) === expected.generation,
    "PROOF_OWNERSHIP",
  );
  if (expected.kind === "link")
    need((await fs.readlink(name)) === expected.target, "PROOF_LINK");
  else await noLinks(name);
}

async function proofMkdir(state, relative) {
  await proofRootCurrent(state);
  if (relative === "" || relative === ".") return;
  const parts = relative.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const item = parts.slice(0, i).join("/");
    if (state.entries.has(item)) {
      await proofCheckEntry(state, item);
      continue;
    }
    await fs.mkdir(proofPath(state, item), { mode: 0o700 });
    await proofRemember(state, item, "directory");
  }
}

async function proofWrite(state, relative, raw) {
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 1024 * 1024,
    "PROOF_BOUND",
  );
  await proofMkdir(state, path.posix.dirname(relative));
  await fs.writeFile(proofPath(state, relative), raw, {
    flag: "wx",
    mode: 0o600,
  });
  await proofRemember(state, relative, "file");
  state.remaining();
}

async function proofRead(state, relative, maximum = 1024 * 1024) {
  await proofRootCurrent(state);
  const file = await heldFile(
    proofPath(state, relative),
    maximum,
    null,
    state.remaining,
    (fact) => {
      state.closeFailures += fact.closeFailures;
    },
  );
  let failed = false,
    primary;
  try {
    await revalidateHeldFile(file, proofPath(state, relative), state.remaining);
  } catch (error) {
    failed = true;
    primary = error;
  }
  const closed = await closeHeld([file]);
  if (closed.length) state.closeFailures += closed.length;
  if (closed.length && !failed) {
    failed = true;
    primary = closed[0];
  }
  if (failed) throw primary;
  return { raw: file.raw, pin: file.pin };
}

async function proofOverwrite(state, relative, raw) {
  await proofRootCurrent(state);
  await proofCheckEntry(state, relative);
  need(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 1024 * 1024,
    "PROOF_BOUND",
  );
  const handle = await fs.open(
    proofPath(state, relative),
    constants.O_WRONLY | constants.O_NOFOLLOW,
  );
  let failed = false,
    primary;
  try {
    need(
      proofGeneration(await handle.stat({ bigint: true }), "file") ===
        state.entries.get(relative).generation,
      "PROOF_OWNERSHIP",
    );
    await handle.truncate(0);
    await handle.writeFile(raw);
    state.remaining();
    const after = await handle.stat({ bigint: true });
    need(
      proofGeneration(
        await fs.lstat(proofPath(state, relative), { bigint: true }),
        "file",
      ) === proofGeneration(after, "file"),
      "PROOF_OWNERSHIP",
    );
  } catch (error) {
    failed = true;
    primary = error;
  }
  const closed = await closeHeld([{ handle }]);
  if (closed.length) state.closeFailures += closed.length;
  if (closed.length && !failed) {
    failed = true;
    primary = closed[0];
  }
  if (failed) throw primary;
  await proofRemember(state, relative, "file");
}

function proofMoveLedger(state, from, to) {
  const rows = [...state.entries].filter(
    ([name]) => name === from || name.startsWith(from + "/"),
  );
  need(rows.length > 0 && !state.entries.has(to), "PROOF_OWNERSHIP");
  for (const [name] of rows) state.entries.delete(name);
  for (const [name, value] of rows)
    state.entries.set(to + name.slice(from.length), value);
}

async function proofArchive(state, args) {
  await proofRootCurrent(state);
  for (const [file, name] of [
    [state.tools.pythonFile, PROOF.python],
    [state.tools.archiveFile, HELPER],
  ])
    await revalidateHeldFile(file, name, state.remaining);
  state.childJoinKnown = false;
  state.lastArchiveFailure = null;
  const result = await archiveCommand(PROOF.python, HELPER, args, {
    timeout: Math.min(LIMITS.archiveMs, state.remaining()),
    observeFailure(value) {
      state.childJoinKnown = value.archiveCleanupUnknown !== true;
      const content = value.sourceContentFailure;
      state.lastArchiveFailure = Object.freeze({
        contentChanged:
          value.error === "source-content-changed" &&
          value.exitCode === 1 &&
          value.archiveCleanupUnknown !== true &&
          value.sourceCloseFailure !== true &&
          value.sourceJoinFailure !== true &&
          value.sourceContentFailureInvalid !== true &&
          content?.mode === "source-verify" &&
          content.stage === "content" &&
          content.changed === 1 &&
          content.missing === 0 &&
          content.added === 0 &&
          content.reordered === false &&
          Array.isArray(content.samples) &&
          content.samples.some(
            (sample) =>
              sample.kind === "changed" &&
              canonical(sample.fields) === canonical(["sha256"]) &&
              sample.candidate?.sha256 === sha("src/input.cc"),
          ),
        childJoined: state.childJoinKnown,
      });
    },
  });
  state.childJoinKnown = true;
  for (const [file, name] of [
    [state.tools.pythonFile, PROOF.python],
    [state.tools.archiveFile, HELPER],
  ])
    await revalidateHeldFile(file, name, state.remaining);
  return result;
}

async function proofSourceMode(state, mode, identityName) {
  need(
    ["source-record", "source-apply", "source-verify"].includes(mode) &&
      ["old", "new"].includes(identityName),
    "PROOF_MODE",
  );
  const timeout = Math.min(LIMITS.archiveMs, state.remaining());
  const seconds = Math.max(
    1,
    Math.floor(
      (timeout - Math.min(5000, Math.max(1, Math.floor(timeout / 4)))) / 1000,
    ),
  );
  const result = sourceMetadataResult(
    await proofArchive(state, [
      mode,
      "--input",
      path.join(state.work, "source"),
      "--output",
      path.join(state.out, LINUX_MIGRATION.sidecar),
      "--manifest",
      proofPath(state, "identities/" + identityName + ".json"),
      "--seconds",
      String(seconds),
    ]),
    mode,
  );
  if (mode !== "source-verify") {
    // Adoption is only after the actual current joined helper action; callers
    // cannot register a pathname, report or inode as their own creation.
    await proofRemember(
      state,
      "work/source/src/out/Release_GN_arm64/" + LINUX_MIGRATION.sidecar,
      "file",
    );
    await proofRemember(
      state,
      "work/source/acquisition-logs/.sorng-source-stat-cache.json",
      "file",
    );
  }
  return result;
}

async function proofSeed(state, modules) {
  for (const name of ["src", "src/cef", "depot_tools", PROOF.nearby])
    await proofWrite(
      state,
      "work/source/" + name + "/.git/HEAD",
      Buffer.from(
        (name === PROOF.nearby ? PROOF.nearbyHead : "a".repeat(40)) + "\n",
      ),
    );
  await proofWrite(
    state,
    "work/source/.gclient_entries",
    Buffer.from(
      "entries = {'src': 'https://public.example/src', '" +
        PROOF.nearby +
        "': 'https://public.example/nearby'}\n",
    ),
  );
  for (const [name, raw] of [
    ["src/input.cc", "owned input\n"],
    ["src/cef/include/generated.h", "owned generated-header fixture\n"],
    ["src/.ignored-but-input", "owned ignored input\n"],
    ["depot_tools/helper.py", "# owned source input, never executed\n"],
  ])
    await proofWrite(state, "work/source/" + name, Buffer.from(raw));
  await proofWrite(
    state,
    "work/source/" + PROOF.nearby + "/.gitmodules",
    modules,
  );
  for (const [origin, target, gitlink] of PROOF_LINKS) {
    await proofMkdir(state, "work/source/" + PROOF.nearby + "/" + gitlink);
    const relative = "work/source/" + PROOF.nearby + "/" + origin;
    await proofMkdir(state, path.posix.dirname(relative));
    await fs.symlink(target, proofPath(state, relative));
    await proofRemember(state, relative, "link", target);
  }
  await proofMkdir(state, "work/source/acquisition-logs");
  await proofMkdir(state, "work/source/src/out/Release_GN_arm64");
  await proofWrite(
    state,
    "work/source/src/out/Release_GN_arm64/build.ninja",
    Buffer.from("# fixed graph fixture; GN and compilers are never executed\n"),
  );
  await proofWrite(
    state,
    "work/source/src/out/Release_GN_arm64/args.gn",
    Buffer.from('target_cpu="arm64"\n'),
  );
}

async function proofCleanupTree(state) {
  await proofRootCurrent(state, true);
  need(state.childJoinKnown, "PROOF_CHILD_UNJOINED");
  // Validate the complete creation ledger before removing anything. Unknown or
  // replaced objects are preserved; deletion is nonrecursive and never follows
  // the five fixture symlinks.
  for (const [relative, entry] of state.entries) {
    state.remaining();
    await proofCheckEntry(state, relative);
    if (entry.kind === "directory") {
      const actual = (await fs.readdir(proofPath(state, relative))).sort();
      const prefix = relative ? relative + "/" : "";
      const expected = [...state.entries.keys()]
        .filter(
          (name) =>
            name !== relative &&
            name.startsWith(prefix) &&
            !name.slice(prefix.length).includes("/"),
        )
        .map((name) => name.slice(prefix.length))
        .sort();
      need(canonical(actual) === canonical(expected), "PROOF_UNKNOWN_ENTRY");
    }
  }
  for (const [relative, entry] of [...state.entries].sort(
    ([a], [b]) =>
      b.split("/").length - a.split("/").length || b.length - a.length,
  )) {
    if (!relative) continue;
    state.remaining();
    await proofCheckEntry(state, relative);
    if (entry.kind === "directory") await fs.rmdir(proofPath(state, relative));
    else await fs.unlink(proofPath(state, relative));
    state.entries.delete(relative);
  }
  await proofRootCurrent(state, true);
  await fs.rmdir(state.root);
  await assert.rejects(fs.lstat(state.root), { code: "ENOENT" });
  state.entries.delete("");
  state.remaining();
}

async function proofWitness(state) {
  need(
    git(ROOT, ["rev-parse", "HEAD"]).toString().trim() === state.head,
    "PROOF_HEAD",
  );
  const rows = tree(
    git(ROOT, [
      "ls-tree",
      "-r",
      "HEAD",
      "--",
      "scripts",
      "native/cef-hosted-recipe.json",
      ".node-version",
      WORKFLOW,
    ]),
  );
  const raw = committedBlobs(ROOT, rows);
  state.codeDigest = codeTreeDigest(rows);
  for (const [index, row] of rows.entries()) {
    state.remaining();
    const held = await heldFile(
      path.join(ROOT, row.path),
      4 * 1024 * 1024,
      { bytes: raw[index].length, sha256: sha(raw[index]) },
      state.remaining,
      (fact) => {
        state.closeFailures += fact.closeFailures;
      },
    );
    const errors = await closeHeld([held]);
    state.closeFailures += errors.length;
    if (errors.length) throw errors[0];
  }
  for (const name of [PROOF.workflow, PROOF.modules]) {
    const data = git(ROOT, ["cat-file", "blob", state.head + ":" + name]);
    const held = await heldFile(
      path.join(ROOT, name),
      1024 * 1024,
      null,
      state.remaining,
      (fact) => {
        state.closeFailures += fact.closeFailures;
      },
    );
    state.handles.push(held);
    need(
      held.pin.bytes === data.length && held.pin.sha256 === sha(data),
      "PROOF_CODE_CHANGED",
    );
    if (name === PROOF.modules) {
      need(
        held.pin.bytes === PROOF.modulesPin.bytes &&
          held.pin.sha256 === PROOF.modulesPin.sha256,
        "PROOF_MODULES_PIN",
      );
      state.modules = held.raw;
    }
  }
  const held = [];
  for (const [name, expected] of [
    [PROOF.python, PROOF.pythonPin],
    [HELPER, PROOF.archivePin],
    [RETIREMENT_HELPER, RETIREMENT_HELPER_PIN],
  ]) {
    const file = await heldFile(
      name,
      16 * 1024 * 1024,
      expected,
      state.remaining,
      (fact) => {
        state.closeFailures += fact.closeFailures;
      },
    );
    state.handles.push(file);
    held.push(file);
  }
  need(
    (await held[0].handle.stat({ bigint: true })).mode & 0o111n,
    "PROOF_PYTHON_MODE",
  );
  state.tools = {
    python: PROOF.python,
    pythonFile: held[0],
    archiveFile: held[1],
    retirementFile: held[2],
    remaining: state.remaining,
    originalEndMs: state.originalEndMs,
  };
  need(
    git(ROOT, ["rev-parse", "HEAD"]).toString().trim() === state.head,
    "PROOF_HEAD",
  );
  state.remaining();
}

async function proofCreateScope(state) {
  const parent = await noLinks(PROOF.temp),
    parentInfo = await fs.lstat(parent, { bigint: true });
  need(
    parentInfo.isDirectory() && parentInfo.uid === BigInt(process.getuid()),
    "PROOF_PARENT",
  );
  state.parentHandle = await fs.open(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  state.handles.push({ handle: state.parentHandle });
  state.parentGeneration = directoryIdentity(parentInfo);
  need(
    directoryIdentity(await state.parentHandle.stat({ bigint: true })) ===
      state.parentGeneration,
    "PROOF_PARENT",
  );
  state.root = path.join(
    parent,
    "cef-linux-migration-owned-proof-" + randomUUID(),
  );
  need(
    path.dirname(state.root) === PROOF.temp &&
      /^cef-linux-migration-owned-proof-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        path.basename(state.root),
      ),
    "PROOF_PATH",
  );
  await fs.mkdir(state.root, { mode: 0o700 });
  state.rootCreated = true;
  const rootInfo = await fs.lstat(state.root, { bigint: true });
  need(
    rootInfo.isDirectory() &&
      rootInfo.uid === BigInt(process.getuid()) &&
      (rootInfo.mode & 0o777n) === 0o700n,
    "PROOF_ROOT",
  );
  state.rootHandle = await fs.open(
    state.root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  state.handles.push({ handle: state.rootHandle });
  state.rootGeneration = proofGeneration(rootInfo, "directory");
  state.scope = Object.freeze({ kind: "linux-owned-migration-proof-scope" });
  proofScopes.set(state.scope, state);
  await proofRootCurrent(state);
  await proofRemember(state, "", "directory");
  state.work = path.join(state.root, "work");
  state.out = path.join(state.work, "source/src/out/Release_GN_arm64");
}

function proofManifest(identity, archive) {
  // Full envelope required by the real archive decoder, explicitly synthetic.
  // PID/head/run below are fixture literals, never a compile or seal claim.
  return {
    schemaVersion: 1,
    kind: "sorng-cef-engineering-checkpoint",
    identity,
    identitySha256: validateIdentity(identity),
    producer: {
      repository: "supermarsx/sortOfRemoteNG",
      repositoryId: 1010282954,
      runId: 1,
      attempt: 1,
      head: "0".repeat(40),
      branch: "synthetic-owned-proof",
      workflow: WORKFLOW,
    },
    archive,
    compile: {
      outcome: "slice-ended",
      exitCode: null,
      quiescent: true,
      groupId: 1,
      quiescence: "observed-lineage-and-root-group",
      observed: [{ pid: 1, start: "Sun Nov 1 00:00:00 2026" }],
    },
    nativeAcceptance: false,
    runtimeReady: false,
  };
}

async function proofAdoptArchive(state, inventory) {
  need(
    Array.isArray(inventory.entries) &&
      inventory.entries.length === 3 &&
      inventory.entries.every((row) => row.kind === "file") &&
      canonical(inventory.entries.map((row) => row.path).sort()) ===
        canonical(["args.gn", "build.ninja", LINUX_MIGRATION.sidecar].sort()),
    "PROOF_ARCHIVE_LAYOUT",
  );
  const base = "work/source/src/out/Release_GN_arm64";
  await proofRemember(state, base, "directory");
  for (const row of inventory.entries) {
    const read = await proofRead(state, base + "/" + row.path);
    const expected = inventory.files.find((item) => item.path === row.path);
    need(
      expected &&
        read.pin.sha256 === expected.sha256 &&
        read.pin.bytes === row.stamp[0],
      "PROOF_ARCHIVE_PIN",
    );
    await proofRemember(state, base + "/" + row.path, "file");
  }
}

async function proofPipeline(state) {
  state.phase = "seed";
  await proofSeed(state, state.modules);
  const sourcePath = path.join(state.work, "source");
  state.sourceHandle = await fs.open(
    sourcePath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  state.handles.push({ handle: state.sourceHandle });
  state.sourceGeneration = directoryIdentity(
    await state.sourceHandle.stat({ bigint: true }),
  );
  const identity = {
    target: LINUX_MIGRATION.target,
    source: LINUX_MIGRATION.source,
    producer: PROOF.oldProducer,
    canonicalRoot: state.work,
    image: "20261026.354.1",
    tools: sha("synthetic-proof-tools-not-production"),
    graph: await graphDigest(state.out),
    siso: sha("synthetic-proof-siso-never-executed"),
  };
  const next = { ...identity, producer: PROOF.newProducer };
  await proofWrite(
    state,
    "identities/old.json",
    Buffer.from(canonical(identity)),
  );
  await proofWrite(state, "identities/new.json", Buffer.from(canonical(next)));
  state.phase = "old-record";
  await proofSourceMode(state, "source-record", "old");
  const sidecarRelative =
    "work/source/src/out/Release_GN_arm64/" + LINUX_MIGRATION.sidecar;
  const old = await proofRead(state, sidecarRelative),
    stored = JSON.parse(old.raw);
  need(
    stored.schemaVersion === 1 &&
      stored.kind === "sorng-linuxarm-source-metadata" &&
      stored.policy === LINUX_MIGRATION.metadataPolicy &&
      stored.sourceDateEpoch === LINUX_MIGRATION.epoch &&
      canonical(stored.identity) === canonical(identity) &&
      stored.snapshot.literalLinks.length === 5,
    "PROOF_SIDECAR",
  );
  const inputStamp = stored.snapshot.entries.find(
    (row) => row.path === "src/input.cc",
  ).mtimeNs;
  const headerStamp = stored.snapshot.entries.find(
    (row) => row.path === "src/cef/include/generated.h",
  ).mtimeNs;
  state.literalLinks = 5;
  state.phase = "out-pack";
  const bundleRelative = "bundle";
  state.tools.bundle = proofPath(state, bundleRelative);
  const archive = await proofArchive(state, [
    "pack",
    "--input",
    state.out,
    "--output",
    state.tools.bundle,
  ]);
  need(
    archive.complete === true &&
      archive.linksIncluded === false &&
      archive.chunks.length === 1,
    "PROOF_PACK",
  );
  await proofRemember(state, bundleRelative, "directory");
  for (const row of [...archive.chunks, archive.inventory]) {
    need(
      ["checkpoint-00000.bin", "inventory.json"].includes(row.name),
      "PROOF_PACK",
    );
    const read = await proofRead(state, bundleRelative + "/" + row.name);
    need(
      read.pin.bytes === row.bytes && read.pin.sha256 === row.sha256,
      "PROOF_PACK",
    );
    await proofRemember(state, bundleRelative + "/" + row.name, "file");
  }
  const inventory = await proofRead(state, "bundle/inventory.json");
  const envelope = proofManifest(identity, archive),
    manifestRaw = Buffer.from(canonical(envelope) + "\n");
  validateManifest(envelope);
  await proofWrite(state, "bundle/manifest.json", manifestRaw);
  state.bundlePin = pinOfArchive(archive);
  await proofCheckEntry(state, "work/source/src/out/Release_GN_arm64");
  await fs.rename(state.out, proofPath(state, "packed-old-out"));
  proofMoveLedger(
    state,
    "work/source/src/out/Release_GN_arm64",
    "packed-old-out",
  );
  await proofMkdir(state, "work/source/src/out/Release_GN_arm64");
  await proofWrite(
    state,
    "work/source/src/out/Release_GN_arm64/build.ninja",
    Buffer.from("# fixed graph fixture; GN and compilers are never executed\n"),
  );
  await proofWrite(
    state,
    "work/source/src/out/Release_GN_arm64/args.gn",
    Buffer.from('target_cpu="arm64"\n'),
  );
  await proofWrite(
    state,
    "work/logs/generated-sdk-links.json",
    Buffer.from("{}"),
  );
  state.tools.recipePath = proofPath(
    state,
    "work/logs/generated-sdk-links.json",
  );
  state.tools.recipePin = { bytes: 2, sha256: sha("{}") };
  state.phase = "restore";
  state.childJoinKnown = false;
  const selected = {
    freshIdentity: next,
    sidecar: old.pin,
    manifestPin: { bytes: manifestRaw.length, sha256: sha(manifestRaw) },
    inventoryPin: inventory.pin,
  };
  state.creator = await restoreOwnedCommon(
    selected,
    state.tools,
    state.scope,
    proofCreators,
  );
  state.childJoinKnown = true;
  proofMoveLedger(
    state,
    "work/source/src/out/Release_GN_arm64",
    "work/source/src/out/Release_GN_arm64.fresh-gn",
  );
  await proofAdoptArchive(state, JSON.parse(inventory.raw));
  need(
    proofCreators.has(state.creator) &&
      !creators.has(state.creator) &&
      !candidates.has(state.scope) &&
      !toolContexts.has(state.scope) &&
      !retirementReadiness.has(state.creator),
    "PROOF_NAMESPACE",
  );
  state.phase = "old-applies-no-gn";
  for (const [relative, expected] of [
    ["src/input.cc", inputStamp],
    ["src/cef/include/generated.h", headerStamp],
  ]) {
    await fs.utimes(
      path.join(sourcePath, relative),
      new Date(),
      new Date(Date.now() + 5000),
    );
    await proofSourceMode(state, "source-apply", "old");
    need(
      String(
        (await fs.lstat(path.join(sourcePath, relative), { bigint: true }))
          .mtimeNs,
      ) === expected,
      "PROOF_OLD_APPLY",
    );
    state.oldApplies++;
  }
  need(
    state.oldApplies === 2 && !retirementReadiness.has(state.creator),
    "PROOF_NAMESPACE",
  );
  const cacheRelative =
    "work/source/acquisition-logs/.sorng-source-stat-cache.json";
  const oldCache = await proofRead(state, cacheRelative);
  const cacheHeld = await heldFile(
    proofPath(state, cacheRelative),
    1024 * 1024,
    oldCache.pin,
    state.remaining,
    (fact) => {
      state.closeFailures += fact.closeFailures;
    },
  );
  let failed = false,
    primary;
  try {
    state.phase = "retirement";
    state.retiredCreator = state.creator;
    await retireOwnedCommon(
      state.creator,
      state.tools,
      proofCreators.get(state.creator),
      proofCreators,
      state.work,
    );
    state.creator = null;
    const retirement = retirementReports.get(state.retiredCreator);
    need(
      retirement?.accepted === true &&
        retirement.childJoined &&
        retirement.sourceInodeCas === false,
      "PROOF_RETIREMENT",
    );
    const owned = ownedRetirements.get(state.retiredCreator);
    need(
      owned?.complete === true &&
        directoryIdentity(await fs.lstat(owned.path, { bigint: true })) ===
          directoryIdentity(owned.directory),
      "PROOF_RETIREMENT",
    );
    const retiredRelative = path
      .relative(state.root, owned.path)
      .split(path.sep)
      .join("/");
    await proofRemember(state, retiredRelative, "directory");
    await proofRemember(
      state,
      retiredRelative + "/" + LINUX_MIGRATION.sidecar,
      "file",
    );
    state.entries.delete(sidecarRelative);
    await revalidateHeldFile(
      cacheHeld,
      proofPath(state, cacheRelative),
      state.remaining,
    );
    state.cacheUnchangedDuringRetirement = true;
  } catch (error) {
    failed = true;
    primary = error;
  }
  const cacheClosed = await closeHeld([cacheHeld]);
  state.closeFailures += cacheClosed.length;
  if (cacheClosed.length && !failed) {
    failed = true;
    primary = cacheClosed[0];
  }
  if (failed) throw primary;
  state.phase = "new-record";
  const recorded = await proofSourceMode(state, "source-record", "new");
  const fresh = await proofRead(state, sidecarRelative),
    freshSidecar = JSON.parse(fresh.raw);
  const files = freshSidecar.snapshot.entries.filter(
    (row) => row.kind === "file",
  );
  const fullBytes = files.reduce((sum, row) => sum + row.size, 0);
  need(
    recorded.timing.reusedFiles === 0 &&
      recorded.timing.hashedFiles === files.length &&
      recorded.timing.hashedBytes === fullBytes &&
      files.length > 0 &&
      canonical(freshSidecar.identity) === canonical(next),
    "PROOF_FULL_RECORD",
  );
  state.newRecordHashedFiles = recorded.timing.hashedFiles;
  state.newRecordReusedFiles = recorded.timing.reusedFiles;
  const freshCache = await proofRead(state, cacheRelative),
    bound = JSON.parse(freshCache.raw);
  need(
    canonical(bound.identity) === canonical(next) &&
      bound.sidecarSha256 === fresh.pin.sha256,
    "PROOF_NEW_CACHE",
  );
  state.newCacheBinding = true;
  state.phase = "new-verify";
  await proofSourceMode(state, "source-verify", "new");
  state.newVerified = true;
  state.phase = "old-cache-rejected";
  await proofOverwrite(state, cacheRelative, oldCache.raw);
  const fallback = await proofSourceMode(state, "source-verify", "new");
  need(
    fallback.timing.hashedFiles === files.length &&
      fallback.timing.hashedBytes === fullBytes &&
      fallback.timing.reusedFiles === files.length,
    "PROOF_OLD_CACHE",
  );
  // Verify hashes the entire first pass when the old cache is rejected, then
  // reuses only those freshly calculated hashes in its own mandatory postcheck.
  state.oldCacheFallbackHashedFiles = fallback.timing.hashedFiles;
  state.oldCachePostcheckReusedFiles = fallback.timing.reusedFiles;
  state.oldCacheRejected = true;
  await proofOverwrite(state, cacheRelative, freshCache.raw);
  const reused = await proofSourceMode(state, "source-verify", "new");
  need(
    reused.timing.hashedFiles === 0 &&
      reused.timing.reusedFiles === 2 * files.length,
    "PROOF_NEW_CACHE",
  );
  state.newCacheReuseObserved = true;
  state.phase = "modified-source-denial";
  const inputRelative = "work/source/src/input.cc";
  const originalInput = await proofRead(state, inputRelative);
  const changedInput = Buffer.from(originalInput.raw);
  changedInput[0] ^= 1;
  need(
    changedInput.length === originalInput.raw.length &&
      sha(changedInput) !== originalInput.pin.sha256,
    "PROOF_MUTATION",
  );
  await proofOverwrite(state, inputRelative, changedInput);
  let modifiedDenied = false;
  try {
    await proofSourceMode(state, "source-verify", "new");
  } catch (error) {
    if (
      !state.lastArchiveFailure?.contentChanged ||
      !state.lastArchiveFailure.childJoined
    )
      throw error;
    modifiedDenied = true;
  }
  need(
    modifiedDenied && state.childJoinKnown,
    "PROOF_MODIFIED_SOURCE_ACCEPTED",
  );
  state.modifiedSourceDenied = true;
  state.phase = "restore-source-verified";
  await proofOverwrite(state, inputRelative, originalInput.raw);
  await proofSourceMode(state, "source-apply", "new");
  await proofSourceMode(state, "source-verify", "new");
  const restoredInput = await proofRead(state, inputRelative);
  need(
    restoredInput.pin.bytes === originalInput.pin.bytes &&
      restoredInput.pin.sha256 === originalInput.pin.sha256,
    "PROOF_RESTORED_SOURCE",
  );
  state.restoredSourceVerified = true;
  need(
    directoryIdentity(await fs.lstat(sourcePath, { bigint: true })) ===
      state.sourceGeneration &&
      directoryIdentity(await state.sourceHandle.stat({ bigint: true })) ===
        state.sourceGeneration,
    "PROOF_SOURCE_REPLACED",
  );
  state.samePhysicalSource = true;
  // The repaired source has legitimate new ctime/cache records. Require its
  // current new-identity/sidecar binding, not historical cache JSON equality.
  const finalCache = await proofRead(state, cacheRelative);
  const finalBinding = JSON.parse(finalCache.raw);
  const finalSidecar = await proofRead(state, sidecarRelative);
  need(
    canonical(finalBinding.identity) === canonical(next) &&
      finalBinding.sidecarSha256 === finalSidecar.pin.sha256 &&
      finalSidecar.pin.sha256 === fresh.pin.sha256,
    "PROOF_NEW_CACHE",
  );
  for (const row of [
    ...archive.chunks,
    archive.inventory,
    {
      name: "manifest.json",
      bytes: manifestRaw.length,
      sha256: sha(manifestRaw),
    },
  ]) {
    const unchanged = await proofRead(state, "bundle/" + row.name);
    need(
      unchanged.pin.bytes === row.bytes && unchanged.pin.sha256 === row.sha256,
      "PROOF_PACK_CHANGED",
    );
  }
  state.originalArchiveUnchanged = true;
  state.phase = "complete";
}

function pinOfArchive(archive) {
  return sha(
    canonical({ chunks: archive.chunks, inventory: archive.inventory }),
  );
}

export function readLinuxMigrationProofObservation(...args) {
  need(args.length === 0, "PROOF_ARGUMENTS");
  return lastProofObservation;
}

export async function runLinuxMigrationOwnedProof(...args) {
  need(!proofActive, "PROOF_BUSY");
  lastProofObservation = null;
  need(args.length === 0, "PROOF_ARGUMENTS");
  const authority = proofAuthority();
  const state = {
    ...authority,
    attempt: randomUUID(),
    phase: "witness",
    handles: [],
    entries: new Map(),
    closeFailures: 0,
    childJoinKnown: true,
    rootCreated: false,
    rootRemoved: false,
    oldApplies: 0,
    cacheUnchangedDuringRetirement: false,
    newCacheBinding: false,
    newVerified: false,
    oldCacheRejected: false,
    newCacheReuseObserved: false,
    samePhysicalSource: false,
    newRecordHashedFiles: 0,
    newRecordReusedFiles: null,
    literalLinks: 0,
    originalArchiveUnchanged: false,
    modifiedSourceDenied: false,
    restoredSourceVerified: false,
    oldCacheFallbackHashedFiles: 0,
    oldCachePostcheckReusedFiles: 0,
  };
  proofActive = true;
  let failed = false,
    primary;
  try {
    await proofWitness(state);
    await proofCreateScope(state);
    await proofPipeline(state);
  } catch (error) {
    failed = true;
    primary = error;
  }
  const failedPhase = failed ? state.phase : null;
  // Retire proof authority BEFORE cleanup/descriptor close. No report is a cap.
  if (state.scope) proofScopes.delete(state.scope);
  if (state.creator && proofCreators.has(state.creator)) {
    try {
      await closeCreatedObservation(state.creator, proofCreators);
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  const retired = state.retiredCreator
    ? retirementReports.get(state.retiredCreator)
    : null;
  if (retired && !retired.childJoined) state.childJoinKnown = false;
  if (state.rootCreated) {
    try {
      await proofCleanupTree(state);
      state.rootRemoved = true;
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  for (const token of new Set(
    [state.scope, state.creator, state.retiredCreator].filter(Boolean),
  ))
    state.closeFailures += cleanupReports.get(token)?.closeFailures ?? 0;
  if (retired?.helperCloseFailures)
    state.closeFailures += retired.helperCloseFailures;
  const closed = await closeHeld(state.handles);
  state.closeFailures += closed.length;
  if (closed.length && !failed) {
    failed = true;
    primary = closed[0];
  }
  try {
    state.remaining();
  } catch (error) {
    if (!failed) {
      failed = true;
      primary = error;
    }
  }
  if (!failed) {
    try {
      need(
        state.rootRemoved &&
          state.closeFailures === 0 &&
          state.childJoinKnown &&
          state.literalLinks === 5 &&
          state.oldApplies === 2 &&
          state.samePhysicalSource &&
          state.cacheUnchangedDuringRetirement &&
          state.newCacheBinding &&
          state.newVerified &&
          state.oldCacheRejected &&
          state.newCacheReuseObserved &&
          state.originalArchiveUnchanged &&
          state.modifiedSourceDenied &&
          state.restoredSourceVerified &&
          state.newRecordHashedFiles > 0 &&
          state.newRecordReusedFiles === 0 &&
          retired?.accepted === true &&
          retired.helperDescriptorsClosed === true &&
          (!state.scope || !proofScopes.has(state.scope)),
        "PROOF_INCOMPLETE",
      );
    } catch (error) {
      failed = true;
      primary = error;
    }
  }
  const report = Object.freeze({
    schemaVersion: 1,
    kind: "sorng-linux-owned-migration-proof",
    attempt: state.attempt,
    head: state.head,
    runId: state.runId,
    runAttempt: state.runAttempt,
    complete: !failed && state.rootRemoved && state.closeFailures === 0,
    failurePhase: failedPhase ?? (failed ? "cleanup" : null),
    codeDigest: state.codeDigest ?? null,
    syntheticFixtureIdentity: true,
    syntheticArchiveEnvelope: true,
    GNExecuted: false,
    oldSealValidated: false,
    productionToolchainVerified: false,
    productionReadinessIssued: false,
    sourceMigrationAdmitted: false,
    nativeAcceptance: false,
    runtimeReady: false,
    literalLinks: state.literalLinks,
    oldApplies: state.oldApplies,
    samePhysicalSource: state.samePhysicalSource,
    cacheUnchangedDuringRetirement: state.cacheUnchangedDuringRetirement,
    newRecordHashedFiles: state.newRecordHashedFiles,
    newRecordReusedFiles: state.newRecordReusedFiles,
    newCacheBinding: state.newCacheBinding,
    newVerified: state.newVerified,
    oldCacheRejected: state.oldCacheRejected,
    oldCacheFallbackHashedFiles: state.oldCacheFallbackHashedFiles,
    oldCachePostcheckReusedFiles: state.oldCachePostcheckReusedFiles,
    newCacheReuseObserved: state.newCacheReuseObserved,
    retired: retired?.renamed ?? null,
    retirementReadback: retired?.readback ?? false,
    sourceInodeCas: false,
    childJoinKnown: state.childJoinKnown,
    proofScopeRetired: !state.scope || !proofScopes.has(state.scope),
    descriptorsClosed:
      state.closeFailures === 0 &&
      state.childJoinKnown &&
      (!retired || retired.helperDescriptorsClosed === true),
    closeFailures: state.closeFailures,
    fixtureRootRemoved: state.rootRemoved,
    originalArchiveUnchanged: state.originalArchiveUnchanged,
    modifiedSourceDenied: state.modifiedSourceDenied,
    restoredSourceVerified: state.restoredSourceVerified,
  });
  lastProofObservation = report;
  proofActive = false;
  if (failed) throw primary;
  return report;
}
