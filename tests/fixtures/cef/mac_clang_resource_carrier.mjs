// Private scratch metadata proof only. Reports never mint production authority.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { held, executeJoined } from "./mac_process_census_proof.mjs";

export const BRANCH = "refs/heads/codex/mac-clang-resource-metadata-20261102";
export const WORKFLOW =
  "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-clang-resource-proof.yml@" +
  BRANCH;
const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const PYTHON_SHA =
  "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d";
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
export const WITNESSES = Object.freeze([
  "scripts/lib/cef-checkpoint-archive.py",
  "tests/fixtures/cef/mac_clang_resource_source_proof.py",
  "tests/fixtures/cef/mac_clang_resource_carrier.mjs",
  "tests/fixtures/cef/mac_clang_chromium.DEPS",
  "tests/fixtures/cef/mac_clang_openscreen.DEPS",
  "tests/fixtures/cef/mac_nearby.gitmodules",
  "tests/fixtures/cef/mac_owned_source_proof.py",
  "tests/fixtures/cef/mac_intel_owned_source_proof.py",
  "tests/fixtures/cef/mac_nearby_source_proof.py",
  "tests/fixtures/cef/mac_process_census_proof.mjs",
  ".github/workflows/cef-mac-clang-resource-proof.yml",
]);
export const NEGATIVES = Object.freeze([
  "missing-link",
  "extra-row",
  "wrong-link-kind",
  "wrong-literal",
  "target-file",
  "target-directory",
  "target-symlink",
  "changed-deps",
  "changed-head",
  "same-length-corruption",
  "changed-provenance",
  "missing-compiler-rows",
  "schema1",
  "schema2",
  "v3-to-v2-writer",
  "linux-kind-spoof",
  "wrong-target",
  "wrong-source",
  "wrong-image",
  "wrong-mode",
  "unknown-dangling",
  "root-replacement",
  "held-fd-rebinding",
  "absence-transition",
  "creator-expiry",
  "close-fault",
]);
const SOURCES = Object.freeze([
  [
    "aarch64-apple-darwin",
    "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    "sorng-macarm-owned-source-metadata-intel-20260824-v3-nearby-clang-literals",
  ],
  [
    "x86_64-apple-darwin",
    "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
    "sorng-macintel-owned-source-metadata-intel-20260824-v3-nearby-clang-literals",
  ],
]);
export function hostObservation(env, platform, architecture) {
  return Object.freeze({
    source: "process-and-runner-environment",
    platform: ["darwin", "linux", "win32"].includes(platform)
      ? platform
      : "other",
    architecture: ["x64", "arm64", "ia32"].includes(architecture)
      ? architecture
      : "other",
    imageOS: ["macos15", "ubuntu24", "win25"].includes(env.ImageOS)
      ? env.ImageOS
      : "other",
    imageVersion: /^[0-9]{8}\.[0-9]{1,6}\.[0-9]{1,6}$/.test(
      env.ImageVersion ?? "",
    )
      ? env.ImageVersion
      : "other",
    runnerEnvironment: ["github-hosted", "self-hosted"].includes(
      env.RUNNER_ENVIRONMENT,
    )
      ? env.RUNNER_ENVIRONMENT
      : "other",
    githubActions: env.GITHUB_ACTIONS === "true",
  });
}
export function authority(env, platform, architecture) {
  assert(platform === "darwin" && architecture === "x64", "CLANG_PROOF_HOST");
  assert(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.ImageOS === "macos15" &&
      env.ImageVersion === "20260824.0482.1",
    "CLANG_PROOF_IMAGE",
  );
  assert(
    env.GITHUB_REF === BRANCH &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF === WORKFLOW &&
      [env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT].every((v) =>
        /^[1-9][0-9]{0,19}$/.test(v ?? ""),
      ),
    "CLANG_PROOF_AUTHORITY",
  );
}
export function budget(started, now) {
  assert(
    Number.isSafeInteger(started) &&
      started > 0 &&
      Number.isSafeInteger(now) &&
      now >= started,
    "CLANG_PROOF_CLOCK",
  );
  const remaining = Math.min(100000, started + 300000 - now - 30000);
  assert(remaining >= 20000, "CLANG_PROOF_DEADLINE");
  return remaining;
}
export function childEnvironment(env, deadline, attemptId, witness) {
  assert(
    Number.isSafeInteger(deadline) &&
      UUID.test(attemptId) &&
      /^[a-f0-9]{64}$/.test(witness),
    "CLANG_PROOF_CHILD",
  );
  const result = { PATH: "/usr/bin:/bin" };
  for (const name of [
    "RUNNER_TEMP",
    "GITHUB_WORKSPACE",
    "ImageOS",
    "ImageVersion",
    "GITHUB_ACTIONS",
    "RUNNER_ENVIRONMENT",
    "GITHUB_REPOSITORY_VISIBILITY",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_EVENT_NAME",
    "GITHUB_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "CEF_MAC_CLANG_JOB_STARTED_MS",
  ])
    result[name] = env[name];
  if (typeof env.RUNNER_TRACKING_ID === "string" && env.RUNNER_TRACKING_ID)
    result.RUNNER_TRACKING_ID = env.RUNNER_TRACKING_ID;
  return {
    ...result,
    CEF_MAC_CLANG_CHILD_DEADLINE_MS: String(deadline),
    CEF_MAC_CLANG_ATTEMPT_ID: attemptId,
    CEF_MAC_CLANG_SOURCE_WITNESS_SHA256: witness,
  };
}
function exact(value, names) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === names.slice().sort().join(),
    "CLANG_PROOF_SCHEMA",
  );
}
export function validateReport(value, expected) {
  exact(expected, [
    "head",
    "runId",
    "runAttempt",
    "attemptId",
    "sourceWitnessSha256",
  ]);
  assert(
    /^[a-f0-9]{40}$/.test(expected.head) &&
      UUID.test(expected.attemptId) &&
      /^[a-f0-9]{64}$/.test(expected.sourceWitnessSha256) &&
      [expected.runId, expected.runAttempt].every((v) =>
        /^[1-9][0-9]{0,19}$/.test(v),
      ),
    "CLANG_PROOF_EXPECTED_IDENTITY",
  );
  exact(value, [
    "schemaVersion",
    "kind",
    "complete",
    "head",
    "runId",
    "runAttempt",
    "attemptId",
    "sourceWitnessSha256",
    "hostPlatform",
    "hostArchitecture",
    "image",
    "observedHost",
    "cases",
    "cleanupConfirmed",
    "proofWriterClosed",
    "proofWriterRetired",
    "publicV3DeniedBefore",
    "publicV3DeniedAfter",
    "productionClangAdmission",
    "productionInputWrites",
    "sourceAcquisition",
    "GNExecuted",
    "compilerExecuted",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    value.schemaVersion === 3 &&
      value.kind === "sorng-mac-clang-resource-owned-proof" &&
      value.complete === true &&
      value.head === expected.head &&
      value.runId === expected.runId &&
      value.runAttempt === expected.runAttempt &&
      value.attemptId === expected.attemptId &&
      value.sourceWitnessSha256 === expected.sourceWitnessSha256 &&
      value.hostPlatform === "darwin" &&
      value.hostArchitecture === "x86_64" &&
      value.image === "20260824.0482.1",
    "CLANG_PROOF_IDENTITY",
  );
  exact(value.observedHost, [
    "source",
    "platform",
    "architecture",
    "imageOS",
    "imageVersion",
    "runnerEnvironment",
    "githubActions",
  ]);
  assert.deepEqual(
    value.observedHost,
    {
      source: "process-and-runner-environment",
      platform: "darwin",
      architecture: "x86_64",
      imageOS: "macos15",
      imageVersion: "20260824.0482.1",
      runnerEnvironment: "github-hosted",
      githubActions: true,
    },
    "CLANG_PROOF_OBSERVED_HOST",
  );
  for (const name of [
    "cleanupConfirmed",
    "proofWriterClosed",
    "proofWriterRetired",
    "publicV3DeniedBefore",
    "publicV3DeniedAfter",
  ])
    assert.equal(value[name], true, name);
  for (const name of [
    "productionClangAdmission",
    "productionInputWrites",
    "sourceAcquisition",
    "GNExecuted",
    "compilerExecuted",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert.equal(value[name], false, name);
  assert(
    Array.isArray(value.cases) && value.cases.length === 2,
    "CLANG_PROOF_CASES",
  );
  for (const [index, row] of value.cases.entries()) {
    exact(row, [
      "target",
      "source",
      "policy",
      "schemaVersion",
      "recorded",
      "recreatedDistinctInodes",
      "applied",
      "verified",
      "nearbyLiteralRows",
      "compilerLiteralRows",
      "fullByteReadbackVerified",
      "timestampReadbackVerified",
      "sidecarUnchanged",
      "macStatCacheCreated",
      "syntheticGitInputs",
      "negativeCases",
      "complete",
    ]);
    assert(
      row.target === SOURCES[index][0] &&
        row.source === SOURCES[index][1] &&
        row.policy === SOURCES[index][2] &&
        row.schemaVersion === 3 &&
        row.nearbyLiteralRows === 5 &&
        row.compilerLiteralRows === 6 &&
        row.macStatCacheCreated === false,
      "CLANG_PROOF_CASE",
    );
    for (const name of [
      "recorded",
      "recreatedDistinctInodes",
      "applied",
      "verified",
      "fullByteReadbackVerified",
      "timestampReadbackVerified",
      "sidecarUnchanged",
      "syntheticGitInputs",
      "complete",
    ])
      assert.equal(row[name], true, name);
    exact(row.negativeCases, NEGATIVES);
    for (const name of NEGATIVES)
      assert.equal(row.negativeCases[name], true, name);
  }
  return value;
}
export function childFailure(error) {
  let stage = "unavailable";
  if (
    typeof error?.stdout === "string" &&
    Buffer.byteLength(error.stdout) <= 2048
  )
    try {
      const value = JSON.parse(error.stdout);
      exact(value, ["kind", "complete", "stage", "productionClangAdmission"]);
      if (
        value.kind === "sorng-mac-clang-resource-proof-failure" &&
        value.complete === false &&
        value.productionClangAdmission === false &&
        [
          "arguments",
          "authority",
          "python-pin",
          "source-witness",
          "owned-root",
          "arm",
          "intel",
          "cleanup",
          "report",
        ].includes(value.stage)
      )
        stage = value.stage;
    } catch {
      /* No raw error/paths/output is a diagnostic projection. */
    }
  return {
    kind: "sorng-mac-clang-resource-carrier",
    complete: false,
    stage,
    productionClangAdmission: false,
    compilerExecuted: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
}
function checkEnd(end) {
  assert(performance.now() < end, "CLANG_PROOF_DEADLINE");
}
const stable = (s) =>
  [s.dev, s.ino, s.mode, s.uid, s.gid, s.birthtimeNs].map(String).join(":");
async function physical(name, end) {
  checkEnd(end);
  assert(
    path.isAbsolute(name) && path.resolve(name) === name,
    "CLANG_PROOF_PATH",
  );
  let current = path.parse(name).root;
  for (const piece of name
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, piece);
    const info = await fs.lstat(current, { bigint: true });
    assert(info.isDirectory() && !info.isSymbolicLink(), "CLANG_PROOF_PATH");
    checkEnd(end);
  }
  assert((await fs.realpath(name)) === name, "CLANG_PROOF_ALIAS");
  checkEnd(end);
}
export function parseGitWitness(raw) {
  assert(
    Buffer.isBuffer(raw) && raw.length <= 2 * 1024 ** 2,
    "CLANG_PROOF_GIT_BOUND",
  );
  let at = 0;
  const result = [];
  for (const name of WITNESSES) {
    const end = raw.indexOf(10, at);
    assert(end >= at && end - at <= 128, "CLANG_PROOF_GIT_HEADER");
    assert(
      raw.subarray(at, end).every((byte) => byte >= 32 && byte <= 126),
      "CLANG_PROOF_GIT_HEADER",
    );
    const match = /^([a-f0-9]{40}) blob ([1-9][0-9]{0,6})$/.exec(
      raw.toString("ascii", at, end),
    );
    assert(match, "CLANG_PROOF_GIT_HEADER");
    const size = Number(match[2]);
    assert(
      size <= 512 * 1024 && end + 1 + size < raw.length,
      "CLANG_PROOF_GIT_BOUND",
    );
    const bytes = raw.subarray(end + 1, end + 1 + size);
    assert.equal(
      createHash("sha1")
        .update(Buffer.from(`blob ${size}\0`))
        .update(bytes)
        .digest("hex"),
      match[1],
      "CLANG_PROOF_GIT_HASH",
    );
    at = end + 1 + size;
    assert.equal(raw[at++], 10, "CLANG_PROOF_GIT_DELIMITER");
    result.push({ path: name, bytes, sha256: sha(bytes) });
  }
  assert.equal(at, raw.length, "CLANG_PROOF_GIT_EXTRA");
  return result;
}
async function verifyCheckout(env, end) {
  const workspace = env.GITHUB_WORKSPACE;
  await physical(workspace, end);
  assert.equal(
    (await held(path.join(workspace, ".git/HEAD"), 41)).toString("ascii"),
    env.GITHUB_SHA + "\n",
    "CLANG_PROOF_GIT_HEAD",
  );
  const input = WITNESSES.map((name) => `${env.GITHUB_SHA}:${name}\n`).join("");
  const result = await executeJoined(
    "/usr/bin/git",
    ["-C", workspace, "cat-file", "--batch"],
    {
      cwd: workspace,
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
      encoding: "buffer",
      timeout: Math.max(1, Math.min(10000, end - performance.now() - 1000)),
      joinDeadline: end,
      maxBuffer: 2 * 1024 ** 2,
      killSignal: "SIGKILL",
      windowsHide: true,
    },
    (file, args, options, done) => {
      const child = execFile(file, args, options, done);
      child.stdin.on("error", () => {});
      child.stdin.end(input);
      return child;
    },
  );
  checkEnd(end);
  const rows = parseGitWitness(result.stdout);
  for (const row of rows) {
    await physical(path.dirname(path.join(workspace, row.path)), end);
    assert(
      (await held(path.join(workspace, row.path), 512 * 1024)).equals(
        row.bytes,
      ),
      "CLANG_PROOF_CHECKOUT_DRIFT",
    );
    checkEnd(end);
  }
  assert.equal(
    (await held(path.join(workspace, ".git/HEAD"), 41)).toString("ascii"),
    env.GITHUB_SHA + "\n",
    "CLANG_PROOF_GIT_HEAD",
  );
  return rows.map((row) => ({
    path: row.path,
    bytes: row.bytes.length,
    sha256: row.sha256,
  }));
}
async function reportRootCurrent(state, end) {
  checkEnd(end);
  await physical(state.root, end);
  const named = await fs.lstat(state.root, { bigint: true }),
    opened = await state.fd.stat({ bigint: true });
  assert(
    stable(named) === state.identity &&
      stable(opened) === state.identity &&
      named.uid === BigInt(process.getuid()) &&
      (named.mode & 0o777n) === 0o700n,
    "CLANG_PROOF_REPORT_ROOT",
  );
  checkEnd(end);
}
async function writeReport(state, name, value, end) {
  assert(
    ["proof.json", "carrier.json"].includes(name) && !state.written.has(name),
    "CLANG_PROOF_REPORT_NAME",
  );
  await reportRootCurrent(state, end);
  const raw = Buffer.from(JSON.stringify(value) + "\n");
  assert(raw.length <= 128 * 1024, "CLANG_PROOF_REPORT_BOUND");
  const handle = await fs.open(
    path.join(state.root, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let failed = false;
  try {
    await reportRootCurrent(state, end);
    await handle.writeFile(raw);
    checkEnd(end);
    const before = await handle.stat({ bigint: true });
    assert(
      before.isFile() &&
        before.nlink === 1n &&
        before.size === BigInt(raw.length),
      "CLANG_PROOF_REPORT_FILE",
    );
    state.written.add(name);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
  assert(
    (await held(path.join(state.root, name), 128 * 1024)).equals(raw),
    "CLANG_PROOF_REPORT_READBACK",
  );
  await reportRootCurrent(state, end);
  return { bytes: raw.length, sha256: sha(raw) };
}
export async function main() {
  assert(process.argv.length === 2, "CLANG_PROOF_ARGUMENTS");
  const observedHost = hostObservation(
    process.env,
    process.platform,
    process.arch,
  );
  authority(process.env, process.platform, process.arch);
  const env = process.env,
    end =
      performance.now() +
      budget(Number(env.CEF_MAC_CLANG_JOB_STARTED_MS), Date.now());
  const witness = await verifyCheckout(env, end),
    witnessSha = sha(Buffer.from(JSON.stringify(witness)));
  assert(
    sha(await held(PYTHON, 13592)) === PYTHON_SHA,
    "CLANG_PROOF_PYTHON_PIN",
  );
  checkEnd(end);
  const temp = env.RUNNER_TEMP;
  assert(temp === "/Users/runner/work/_temp", "CLANG_PROOF_TEMP");
  await physical(temp, end);
  const attemptId = randomUUID(),
    root = path.join(temp, "cef-mac-clang-report-" + randomUUID());
  await fs.mkdir(root, { mode: 0o700 });
  const info = await fs.lstat(root, { bigint: true });
  const fd = await fs.open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const state = { root, fd, identity: stable(info), written: new Set() };
  let failed = false;
  try {
    await reportRootCurrent(state, end);
    await fs.appendFile(env.GITHUB_OUTPUT, `root=${root}\n`);
    checkEnd(end);
    const scratch = path.join(temp, "cef-mac-clang-owned-proof-" + attemptId);
    await assert.rejects(fs.lstat(scratch), { code: "ENOENT" });
    const childEnd = Date.now() + Math.floor(end - performance.now() - 5000);
    assert(childEnd > Date.now() + 10000, "CLANG_PROOF_DEADLINE");
    // This await must fulfill. A caught failure or report.complete can never
    // enter the successful proof write branch below.
    const result = await executeJoined(
      PYTHON,
      [
        "-I",
        "-B",
        "-S",
        "tests/fixtures/cef/mac_clang_resource_source_proof.py",
        "--output",
        scratch,
      ],
      {
        cwd: env.GITHUB_WORKSPACE,
        env: childEnvironment(env, childEnd, attemptId, witnessSha),
        timeout: Math.floor(end - performance.now() - 1000),
        joinDeadline: end,
        maxBuffer: 256 * 1024,
        killSignal: "SIGKILL",
        windowsHide: true,
      },
    );
    checkEnd(end);
    assert(
      typeof result.stdout === "string" &&
        Buffer.byteLength(result.stdout) <= 128 * 1024,
      "CLANG_PROOF_STDOUT",
    );
    const report = validateReport(JSON.parse(result.stdout), {
      head: env.GITHUB_SHA,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      attemptId,
      sourceWitnessSha256: witnessSha,
    });
    assert.deepEqual(
      await verifyCheckout(env, end),
      witness,
      "CLANG_PROOF_SOURCE_CHANGED",
    );
    await assert.rejects(fs.lstat(scratch), { code: "ENOENT" });
    const pin = await writeReport(state, "proof.json", report, end);
    await writeReport(
      state,
      "carrier.json",
      {
        kind: "sorng-mac-clang-resource-carrier",
        complete: true,
        head: env.GITHUB_SHA,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        attemptId,
        rawProofBytes: pin.bytes,
        rawProofSha256: pin.sha256,
        sourceWitnessSha256: witnessSha,
        observedHost,
        productionClangAdmission: false,
        compilerExecuted: false,
        nativeAcceptance: false,
        runtimeReady: false,
      },
      end,
    );
    assert.deepEqual((await fs.readdir(root)).sort(), [
      "carrier.json",
      "proof.json",
    ]);
    await reportRootCurrent(state, end);
  } catch (error) {
    failed = true;
    try {
      await writeReport(
        state,
        "carrier.json",
        { ...childFailure(error), observedHost },
        end,
      );
    } catch {
      /* Preserve exact first failure, including falsy reasons. */
    }
    throw error;
  } finally {
    try {
      await fd.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
  checkEnd(end);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ...childFailure(error),
        observedHost: hostObservation(
          process.env,
          process.platform,
          process.arch,
        ),
      }),
    );
    process.exitCode = 1;
  });
