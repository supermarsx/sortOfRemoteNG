// Private Linux x64 metadata fixture only. Reports never grant migration or SDK admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BRANCH = "refs/heads/codex/linux-arm-final-helper-proof-20261102";
export const WORKFLOW =
  "supermarsx/sortOfRemoteNG/.github/workflows/cef-linux-producer-migration-proof.yml@" +
  BRANCH;
export const CODE_DIGEST =
  "d060f671e8a784046f16cd50f8661da8c9883b623c376e23eccf2f4ccc4a9472";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SELF = "tests/fixtures/cef/linux_migration_proof_carrier.mjs";
const CORE = "scripts/lib/cef-linux-producer-migration.mjs";
const MAX_REPORT = 128 * 1024;
const PHASES = Object.freeze([
  "witness",
  "seed",
  "old-record",
  "out-pack",
  "restore",
  "old-applies-no-gn",
  "retirement",
  "new-record",
  "new-verify",
  "old-cache-rejected",
  "modified-source-denial",
  "restore-source-verified",
  "complete",
  "cleanup",
]);
const TRUE_FACTS = Object.freeze([
  "syntheticFixtureIdentity",
  "syntheticArchiveEnvelope",
  "samePhysicalSource",
  "cacheUnchangedDuringRetirement",
  "newCacheBinding",
  "newVerified",
  "oldCacheRejected",
  "newCacheReuseObserved",
  "retired",
  "retirementReadback",
  "childJoinKnown",
  "proofScopeRetired",
  "descriptorsClosed",
  "fixtureRootRemoved",
  "originalArchiveUnchanged",
  "modifiedSourceDenied",
  "restoredSourceVerified",
]);
const FALSE_FACTS = Object.freeze([
  "GNExecuted",
  "oldSealValidated",
  "productionToolchainVerified",
  "productionReadinessIssued",
  "sourceMigrationAdmitted",
  "nativeAcceptance",
  "runtimeReady",
  "sourceInodeCas",
]);
const COUNTERS = Object.freeze([
  "literalLinks",
  "oldApplies",
  "newRecordHashedFiles",
  "newRecordReusedFiles",
  "oldCacheFallbackHashedFiles",
  "oldCachePostcheckReusedFiles",
  "closeFailures",
]);
const KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "attempt",
  "head",
  "runId",
  "runAttempt",
  "complete",
  "failurePhase",
  "codeDigest",
  ...TRUE_FACTS,
  ...FALSE_FACTS,
  ...COUNTERS,
]);
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CODES = new Set([
  "ARGUMENTS",
  "HOST",
  "IMAGE",
  "AUTHORITY",
  "CLOCK",
  "DEADLINE",
  "GIT",
  "SOURCE",
  "REPORT_SCHEMA",
  "REPORT_IDENTITY",
  "REPORT_INCOMPLETE",
  "RUN_REJECTED",
  "STALE_REPORT",
  "OWNED_OUTPUT",
  "CLOSE",
  "OPERATION",
]);
const failures = new WeakMap();
function need(value, code) {
  if (!value) {
    assert(CODES.has(code));
    const error = new assert.AssertionError({
      message: "LINUX_PROOF_CARRIER_" + code,
    });
    failures.set(error, code);
    throw error;
  }
}
export function failureCode(error) {
  // Never inspect arbitrary messages, URLs, child output, paths or thrown strings.
  return error && (typeof error === "object" || typeof error === "function")
    ? (failures.get(error) ?? "OPERATION")
    : "OPERATION";
}
export function authority(env, platform, architecture) {
  need(platform === "linux" && architecture === "x64", "HOST");
  need(
    env.ImageOS === "ubuntu24" && env.ImageVersion === "20261026.354.1",
    "IMAGE",
  );
  need(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === BRANCH &&
      env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF === WORKFLOW &&
      /^[1-9][0-9]{0,14}$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]{0,2}$/.test(env.GITHUB_RUN_ATTEMPT ?? "") &&
      env.RUNNER_TEMP === "/home/runner/work/_temp" &&
      !env.GH_TOKEN &&
      !env.GITHUB_TOKEN,
    "AUTHORITY",
  );
}
export function budget(started, now) {
  need(
    Number.isSafeInteger(started) &&
      started > 0 &&
      Number.isSafeInteger(now) &&
      now >= started,
    "CLOCK",
  );
  const remaining = started + 300000 - now;
  need(remaining > 30000, "DEADLINE");
  return Object.freeze({
    wholeJobRemaining: remaining,
    coreMaximum: Math.min(160000, remaining - 30000),
  });
}
function data(value) {
  need(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    "REPORT_SCHEMA",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  need(
    Object.keys(descriptors).sort().join() === KEYS.slice().sort().join(),
    "REPORT_SCHEMA",
  );
  need(
    Object.values(descriptors).every(
      (entry) => "value" in entry && entry.enumerable,
    ),
    "REPORT_SCHEMA",
  );
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, entry]) => [key, entry.value]),
  );
}
export function validateReport(value, env) {
  const row = data(value);
  need(
    row.schemaVersion === 1 &&
      row.kind === "sorng-linux-owned-migration-proof" &&
      typeof row.attempt === "string" &&
      row.attempt.length === 36 &&
      UUID.test(row.attempt) &&
      row.head === env.GITHUB_SHA &&
      row.runId === Number(env.GITHUB_RUN_ID) &&
      row.runAttempt === Number(env.GITHUB_RUN_ATTEMPT) &&
      typeof row.complete === "boolean" &&
      (row.failurePhase === null || PHASES.includes(row.failurePhase)) &&
      (row.codeDigest === null || row.codeDigest === CODE_DIGEST),
    "REPORT_IDENTITY",
  );
  for (const key of [...TRUE_FACTS, ...FALSE_FACTS])
    need(
      typeof row[key] === "boolean" || (key === "retired" && row[key] === null),
      "REPORT_SCHEMA",
    );
  for (const key of COUNTERS)
    need(
      (key === "newRecordReusedFiles" && row[key] === null) ||
        (Number.isSafeInteger(row[key]) &&
          row[key] >= 0 &&
          row[key] <= 3000000),
      "REPORT_SCHEMA",
    );
  // These facts are immutable even on a partially completed fixture.
  for (const key of FALSE_FACTS) need(row[key] === false, "REPORT_INCOMPLETE");
  need(
    row.syntheticFixtureIdentity === true &&
      row.syntheticArchiveEnvelope === true,
    "REPORT_INCOMPLETE",
  );
  return Object.freeze(row);
}
export function selectSuccess(
  { fulfilled, returned, observed, previous },
  env,
) {
  need(fulfilled === true, "RUN_REJECTED");
  need(returned === observed && Object.isFrozen(observed), "STALE_REPORT");
  const row = validateReport(observed, env);
  need(row.attempt !== previous?.attempt, "STALE_REPORT");
  need(
    row.complete && row.failurePhase === null && row.codeDigest === CODE_DIGEST,
    "REPORT_INCOMPLETE",
  );
  for (const key of TRUE_FACTS) need(row[key] === true, "REPORT_INCOMPLETE");
  need(
    row.literalLinks === 5 &&
      row.oldApplies === 2 &&
      row.newRecordHashedFiles > 0 &&
      row.newRecordReusedFiles === 0 &&
      row.closeFailures === 0 &&
      row.oldCacheFallbackHashedFiles === row.newRecordHashedFiles &&
      row.oldCachePostcheckReusedFiles === row.newRecordHashedFiles,
    "REPORT_INCOMPLETE",
  );
  return row;
}
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
// BEGIN current final-helper subject pin
export function verifySubjectBytes(raw) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length === 114826 &&
      sha(raw) ===
        "3cb94d746b48fa030c3a8f300c65f043f83296849d281c5149c87c2eea45e275",
    "SOURCE",
  );
}
// END current final-helper subject pin
const generation = (s) => [s.dev, s.ino, s.mode, s.uid, s.gid].join(":");
const fileGeneration = (s) =>
  [generation(s), s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(":");
async function heldFile(name, limit, handles) {
  need((await fs.realpath(name)) === name, "SOURCE");
  const before = await fs.lstat(name, { bigint: true });
  need(
    before.isFile() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(limit),
    "SOURCE",
  );
  const handle = await fs.open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
  handles.push(handle);
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < buffer.length) {
    const part = await handle.read(buffer, size, buffer.length - size, size);
    if (part.bytesRead === 0) break;
    size += part.bytesRead;
  }
  need(size <= limit, "SOURCE");
  const raw = buffer.subarray(0, size);
  const check = async () => {
    need(
      fileGeneration(await handle.stat({ bigint: true })) ===
        fileGeneration(before) &&
        fileGeneration(await fs.lstat(name, { bigint: true })) ===
          fileGeneration(before),
      "SOURCE",
    );
  };
  await check();
  need(raw.length === Number(before.size), "SOURCE");
  return { raw, check };
}
function git(args, remaining) {
  const timeout = Math.min(10000, remaining());
  const raw = execFileSync("/usr/bin/git", args, {
    cwd: ROOT,
    timeout,
    maxBuffer: 256 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  remaining();
  return raw;
}
async function closeAll(handles) {
  let failed = false,
    first;
  for (const handle of handles.splice(0).reverse())
    try {
      await handle.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
    }
  if (failed) throw first;
}
async function outputRoot(root) {
  const handles = [];
  let failed = false,
    primary;
  try {
    const name = process.env.GITHUB_OUTPUT;
    need(
      typeof name === "string" &&
        name.startsWith("/home/runner/work/_temp/_runner_file_commands/") &&
        !name.includes("\n") &&
        (await fs.realpath(name)) === name,
      "OWNED_OUTPUT",
    );
    const before = await fs.lstat(name, { bigint: true });
    need(
      before.isFile() &&
        before.uid === BigInt(process.getuid()) &&
        before.nlink === 1n &&
        before.size <= 65536n,
      "OWNED_OUTPUT",
    );
    const handle = await fs.open(
      name,
      constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
    );
    handles.push(handle);
    need(
      generation(await handle.stat({ bigint: true })) === generation(before),
      "OWNED_OUTPUT",
    );
    await handle.writeFile("root=" + root + "\n");
    need(
      generation(await fs.lstat(name, { bigint: true })) === generation(before),
      "OWNED_OUTPUT",
    );
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await closeAll(handles);
  } catch (error) {
    if (!failed) {
      failed = true;
      primary = error;
    }
  }
  if (failed) throw primary;
}
async function writeReports(
  root,
  rootHandle,
  rootGeneration,
  proof,
  carrier,
  remaining,
) {
  const check = async () => {
    remaining();
    need(
      (await fs.realpath(root)) === root &&
        generation(await fs.lstat(root, { bigint: true })) === rootGeneration &&
        generation(await rootHandle.stat({ bigint: true })) === rootGeneration,
      "OWNED_OUTPUT",
    );
  };
  await check();
  const rows = [
    ["proof.json", proof],
    ["carrier.json", carrier],
  ];
  let total = 0;
  for (const [name, value] of rows) {
    const raw = Buffer.from(JSON.stringify(value) + "\n");
    total += raw.length;
    need(total <= MAX_REPORT, "OWNED_OUTPUT");
    await check();
    const handle = await fs.open(
      path.join(root, name),
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    let failed = false,
      primary;
    try {
      await handle.writeFile(raw);
      await handle.sync();
      const stat = await handle.stat({ bigint: true });
      need(
        stat.isFile() &&
          stat.nlink === 1n &&
          stat.uid === BigInt(process.getuid()) &&
          stat.size === BigInt(raw.length),
        "OWNED_OUTPUT",
      );
      const readback = Buffer.alloc(raw.length);
      need(
        (await handle.read(readback, 0, readback.length, 0)).bytesRead ===
          raw.length &&
          readback.equals(raw) &&
          fileGeneration(
            await fs.lstat(path.join(root, name), { bigint: true }),
          ) === fileGeneration(stat),
        "OWNED_OUTPUT",
      );
      await check();
    } catch (error) {
      failed = true;
      primary = error;
    }
    try {
      await handle.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
    if (failed) throw primary;
  }
  need(
    (await fs.readdir(root)).sort().join() === "carrier.json,proof.json",
    "OWNED_OUTPUT",
  );
  await check();
}
export async function main(...args) {
  need(args.length === 0 && process.argv.length === 2, "ARGUMENTS");
  authority(process.env, process.platform, process.arch);
  const started = Number(process.env.CEF_LINUX_MIGRATION_PROOF_STARTED_MS);
  budget(started, Date.now());
  const initialWall = Date.now(),
    initialMono = performance.now();
  const remaining = () => {
    const now = Math.max(
      Date.now(),
      initialWall + Math.ceil(performance.now() - initialMono),
    );
    need(now < started + 300000, "DEADLINE");
    return started + 300000 - now;
  };
  const handles = [];
  const witnesses = [];
  let failed = false,
    primary,
    root,
    rootHandle,
    rootGeneration,
    proof = null,
    fulfilled = false;
  let attempt = null,
    core,
    previous,
    returned,
    observed;
  try {
    need(
      git(["rev-parse", "HEAD"], remaining).toString().trim() ===
        process.env.GITHUB_SHA,
      "GIT",
    );
    for (const name of [SELF, CORE]) {
      const held = await heldFile(path.join(ROOT, name), 256 * 1024, handles);
      need(held.raw.equals(git(["show", "HEAD:" + name], remaining)), "SOURCE");
      if (name === CORE) verifySubjectBytes(held.raw);
      witnesses.push(held.check);
    }
    need(
      (await fs.realpath(process.env.RUNNER_TEMP)) === process.env.RUNNER_TEMP,
      "OWNED_OUTPUT",
    );
    const parent = await fs.open(
      process.env.RUNNER_TEMP,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    handles.push(parent);
    const parentGeneration = generation(await parent.stat({ bigint: true }));
    root = path.join(
      process.env.RUNNER_TEMP,
      "cef-linux-migration-reports-" + randomUUID(),
    );
    await fs.mkdir(root, { mode: 0o700 });
    rootHandle = await fs.open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const stat = await rootHandle.stat({ bigint: true });
    rootGeneration = generation(stat);
    need(
      stat.isDirectory() &&
        stat.uid === BigInt(process.getuid()) &&
        (stat.mode & 0o777n) === 0o700n &&
        generation(await fs.lstat(root, { bigint: true })) === rootGeneration &&
        generation(
          await fs.lstat(process.env.RUNNER_TEMP, { bigint: true }),
        ) === parentGeneration,
      "OWNED_OUTPUT",
    );
    await outputRoot(root);
    core = await import(new URL("../../../" + CORE, import.meta.url));
    previous = core.readLinuxMigrationProofObservation();
    returned = await core.runLinuxMigrationOwnedProof();
    fulfilled = true;
    observed = core.readLinuxMigrationProofObservation();
    proof = selectSuccess(
      { fulfilled, returned, observed, previous },
      process.env,
    );
    attempt = proof.attempt;
    need(
      git(["rev-parse", "HEAD"], remaining).toString().trim() ===
        process.env.GITHUB_SHA,
      "GIT",
    );
  } catch (error) {
    failed = true;
    primary = error;
  }
  if (!proof && core) {
    try {
      observed = core.readLinuxMigrationProofObservation();
      if (observed?.attempt !== previous?.attempt) {
        proof = validateReport(observed, process.env);
        attempt = proof.attempt;
      }
    } catch {
      /* A malformed/stale diagnostic is never published as a core report. */
    }
  }
  for (const check of witnesses)
    try {
      await check();
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  try {
    await closeAll(handles);
  } catch (error) {
    if (!failed) {
      failed = true;
      primary = error;
    }
  }
  if (rootHandle) {
    try {
      await writeReports(
        root,
        rootHandle,
        rootGeneration,
        proof ?? {
          schemaVersion: 1,
          kind: "sorng-linux-migration-proof-unavailable",
          complete: false,
        },
        {
          schemaVersion: 1,
          kind: "sorng-linux-migration-proof-carrier",
          head: process.env.GITHUB_SHA,
          runId: Number(process.env.GITHUB_RUN_ID),
          runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
          image: "20261026.354.1",
          attempt,
          fulfilled,
          complete: !failed,
          failureCode: failed ? failureCode(primary) : null,
          reportsGrantAuthority: false,
          reportWriterClosureRequiresSuccessfulStep: true,
        },
        remaining,
      );
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
    try {
      await rootHandle.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = error;
      }
    }
  }
  if (failed) throw primary;
  remaining();
  return Object.freeze({ complete: true, attempt });
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main()
    .then(() => console.log("LINUX_MIGRATION_PRIVATE_PROOF_COMPLETE"))
    .catch((error) => {
      console.error(
        "LINUX_MIGRATION_PRIVATE_PROOF_DENIED " + failureCode(error),
      );
      process.exitCode = 1;
    });
