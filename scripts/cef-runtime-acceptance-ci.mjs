#!/usr/bin/env node
// Read-only, explicitly selected native acceptance. Never publishes or selects a runtime.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBundle, releaseIdentity } from "./cef-runtime-ci.mjs";
import {
  prepareCustomRuntime,
  validateSourceLock,
} from "./lib/browser-custom-runtime.mjs";
import { stageAcceptance } from "./cef-browser-acceptance.mjs";
import {
  releaseRelativePath,
  RELEASE_LIMITS,
} from "./lib/browser-runtime-release.mjs";

import {
  WORKFLOW as ENGINEERING_WORKFLOW,
  TARGET as ENGINEERING_TARGET,
  SOURCE_ID as ENGINEERING_SOURCE,
  LIMITS as CHECKPOINT_LIMITS,
  sdkSealName,
  validateSdkCompletion,
  completionSha,
  canonical,
  apiClient,
  downloadSdkBundle,
} from "./lib/cef-engineering-checkpoint.mjs";
import {
  OWNED_WORKFLOW,
  OWNED_REPOSITORY,
  OWNED_LIMITS,
  reviewedImportPath,
  readOwnedImportReview,
  importSealName,
  validateImportCompletion,
  ownedCompletionSha,
  ownedImportApi,
  parseOwnedJson,
  downloadOwnedImport,
} from "./lib/cef-owned-sdk-import.mjs";
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const NATIVE_TARGETS = Object.freeze({
  "x86_64-pc-windows-msvc": {
    runner: "windows-2025-vs2026",
    platform: "win32",
    arch: "x64",
  },
  "aarch64-pc-windows-msvc": {
    runner: "windows-11-arm",
    platform: "win32",
    arch: "arm64",
  },
  "x86_64-unknown-linux-gnu": {
    runner: "ubuntu-24.04",
    platform: "linux",
    arch: "x64",
  },
  "aarch64-unknown-linux-gnu": {
    runner: "ubuntu-24.04-arm",
    platform: "linux",
    arch: "arm64",
  },
  "x86_64-apple-darwin": {
    runner: "macos-15-intel",
    platform: "darwin",
    arch: "x64",
  },
  "aarch64-apple-darwin": {
    runner: "macos-15",
    platform: "darwin",
    arch: "arm64",
  },
});
export const HTTP2_CHECKS = Object.freeze([
  "multiplex",
  "deny",
  "delay",
  "revoke",
  "cross-authority",
  "wss",
  "h1-fallback",
  "permission-churn",
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fail(message) {
  throw new Error(message);
}
function commandError(message, code) {
  return Object.assign(new Error(message), { code });
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    fail("Exact reviewed producer fields required");
}
function digest(value, length = 64) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[a-f0-9]{${length}}$`).test(value) ||
    /^0+$/.test(value)
  )
    fail("Invalid reviewed digest");
}
function identifier(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    fail("Positive exact GitHub identifier required");
}
const ACCEPTANCE_WORKFLOW = ".github/workflows/cef-runtime-acceptance.yml";

export function acceptanceExecution(env) {
  const direct = `${OWNED_REPOSITORY}/${ACCEPTANCE_WORKFLOW}@${env.GITHUB_REF}`;
  const reusableCaller = `${OWNED_REPOSITORY}/.github/workflows/cef-patched-runtime.yml@${env.GITHUB_REF}`;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY_VISIBILITY !== "public" ||
    env.GITHUB_REPOSITORY !== OWNED_REPOSITORY ||
    !/^refs\/heads\/[^\s\x00-\x1f\x7f]{1,240}$/.test(env.GITHUB_REF ?? "") ||
    ![direct, reusableCaller].includes(env.GITHUB_WORKFLOW_REF) ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
  )
    fail("Exact public manual native acceptance workflow required for seal");
  digest(env.GITHUB_SHA, 40);
  for (const key of [
    "GITHUB_REPOSITORY_ID",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
  ])
    if (!/^[1-9][0-9]*$/.test(env[key] ?? ""))
      fail("Exact native acceptance identifiers required");
    else identifier(Number(env[key]));
  // Reusable workflows retain the caller's GitHub context. Preserve the existing
  // exact native-gate caller without minting a direct-workflow acceptance seal.
  if (env.GITHUB_WORKFLOW_REF === reusableCaller) return null;
  return {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    sourceSha: env.GITHUB_SHA,
    workflow: ACCEPTANCE_WORKFLOW,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    ref: env.GITHUB_REF,
    event: "workflow_dispatch",
  };
}

// Git object identities describe committed code regardless of checkout EOLs.
// A tracked modification anywhere in that checkout invalidates the seal.
export function acceptanceCodeIdentity(sourceSha, root = ROOT) {
  digest(sourceSha, 40);
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      timeout: 10_000,
      maxBuffer: 8 * 1024 ** 2,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  if (
    git(["rev-parse", "HEAD"]).toString().trim() !== sourceSha ||
    git(["status", "--porcelain=v1", "--untracked-files=no"]).length
  )
    fail("Native acceptance code must match the clean workflow commit");
  const sourceTree = git(["rev-parse", "HEAD^{tree}"]).toString().trim();
  digest(sourceTree, 40);
  return {
    sourceTree,
    codeSha256: sha(git(["ls-tree", "-r", "-z", "--full-tree", "HEAD"])),
    codeDigestFormat: "git-ls-tree-r-z-sha256-v1",
  };
}

export function createAcceptanceSeal(
  result,
  { execution, code, reportSha256 },
) {
  // These are evidence checks, not a replacement for executing native gates.
  // The future publisher must independently authenticate the workflow/artifact.
  exact(execution, [
    "repository",
    "repositoryId",
    "runId",
    "runAttempt",
    "sourceSha",
    "workflow",
    "workflowRef",
    "ref",
    "event",
  ]);
  const observedExecution = acceptanceExecution({
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    GITHUB_EVENT_NAME: execution.event,
    GITHUB_REPOSITORY: execution.repository,
    GITHUB_REPOSITORY_ID: String(execution.repositoryId),
    GITHUB_RUN_ID: String(execution.runId),
    GITHUB_RUN_ATTEMPT: String(execution.runAttempt),
    GITHUB_SHA: execution.sourceSha,
    GITHUB_WORKFLOW_SHA: execution.sourceSha,
    GITHUB_WORKFLOW_REF: execution.workflowRef,
    GITHUB_REF: execution.ref,
  });
  if (
    !observedExecution ||
    canonical(observedExecution) !== canonical(execution)
  )
    fail("Native acceptance workflow differs");
  exact(code, ["sourceTree", "codeSha256", "codeDigestFormat"]);
  digest(code.sourceTree, 40);
  digest(code.codeSha256);
  digest(reportSha256);
  if (code.codeDigestFormat !== "git-ls-tree-r-z-sha256-v1")
    fail("Unknown native acceptance code digest");
  const owned = result.producer?.producer === "owned-import";
  exact(result, [
    "schemaVersion",
    "kind",
    "target",
    "producer",
    "acceptanceSourceSha",
    "acceptanceWorkflowRunId",
    "nativeHost",
    "sourceLockIdentity",
    "descriptorSha256",
    "reports",
    "builds",
    "ok",
    "nativeExecutionPerformed",
    "publicProviderAcceptance",
    "productionReady",
    "publicationAllowed",
    ...(owned ? ["ingestion", "hostedBuild"] : []),
  ]);
  if (
    result.schemaVersion !== 1 ||
    result.kind !== "sorng-cef-native-acceptance-run" ||
    result.ok !== true ||
    result.nativeExecutionPerformed !== true ||
    result.publicProviderAcceptance !== false ||
    result.productionReady !== false ||
    result.publicationAllowed !== false ||
    result.acceptanceSourceSha !== execution.sourceSha ||
    result.acceptanceWorkflowRunId !== execution.runId ||
    (owned &&
      (result.ingestion !== "operator-reviewed-local-bytes" ||
        result.hostedBuild !== false))
  )
    fail("Only completed native acceptance may create a seal");
  const producer = selectedProducer(result.producer);
  producerSelection([producer]);
  if (
    producer.target !== result.target ||
    producer.descriptorSha256 !== result.descriptorSha256 ||
    result.producer.sourceLockIdentity !== result.sourceLockIdentity
  )
    fail("Native acceptance producer/descriptor/source differs");
  digest(result.sourceLockIdentity);
  const native = NATIVE_TARGETS[result.target];
  exact(result.nativeHost, ["platform", "architecture"]);
  if (
    result.nativeHost.platform !== native.platform ||
    result.nativeHost.architecture !== native.arch
  )
    fail("Native acceptance host architecture differs");
  const expected = ["tls", ...HTTP2_CHECKS.map((check) => `http2-${check}`)];
  if (
    !Array.isArray(result.reports) ||
    result.reports.length !== expected.length
  )
    fail("All nine native acceptance reports required");
  const seen = new Set();
  for (const report of result.reports) {
    exact(report, [
      "suite",
      "accepted",
      "reportSha256",
      ...(report.suite === "http2" ? ["check"] : []),
    ]);
    const label =
      report.suite === "tls" ? "tls" : `${report.suite}-${report.check}`;
    if (
      report.accepted !== true ||
      !expected.includes(label) ||
      seen.has(label)
    )
      fail("Unique successful TLS and H2 reports required");
    seen.add(label);
    digest(report.reportSha256);
  }
  if (!Array.isArray(result.builds) || result.builds.length !== 2)
    fail("Both native fixture builds required");
  const suites = new Set();
  for (const build of result.builds) {
    exact(build, [
      "suite",
      "clientSha256",
      "cargoLockSha256",
      ...(native.platform !== "win32" ? ["helperSha256"] : []),
    ]);
    if (!["tls", "http2"].includes(build.suite) || suites.has(build.suite))
      fail("Unique native fixture builds required");
    suites.add(build.suite);
    for (const key of Object.keys(build).filter((key) => key !== "suite"))
      digest(build[key]);
  }
  return {
    schemaVersion: 1,
    kind: "sorng-cef-native-acceptance-seal",
    execution: { ...execution, ...code },
    target: result.target,
    producer,
    sourceLockIdentity: result.sourceLockIdentity,
    descriptorSha256: result.descriptorSha256,
    nativeHost: { ...result.nativeHost },
    report: { path: "native-acceptance.json", sha256: reportSha256 },
    reports: structuredClone(result.reports),
    builds: structuredClone(result.builds),
    ...(owned ? { ingestion: result.ingestion, hostedBuild: false } : {}),
    nativeAcceptance: true,
    productionReady: false,
    publicationAllowed: false,
  };
}

export async function writeAcceptanceSeal({
  destination,
  result,
  execution,
  code,
}) {
  const report = await readFile(
    path.join(destination, "native-acceptance.json"),
  );
  if (canonical(JSON.parse(report)) !== canonical(result))
    fail("Retained native acceptance result differs");
  const seal = createAcceptanceSeal(result, {
    execution,
    code,
    reportSha256: sha(report),
  });
  for (const row of seal.reports) {
    const label = row.suite === "tls" ? "tls" : `http2-${row.check}`;
    if (
      (await hashFile(path.join(destination, label, "acceptance.json"))) !==
      row.reportSha256
    )
      fail("Retained native case report differs");
  }
  // LAST and exclusive. Failed/partial runs retain diagnostics but no seal.
  await writeFile(
    path.join(destination, "seal.json"),
    JSON.stringify(seal, null, 2),
    { flag: "wx" },
  );
  return seal;
}
function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? ""))
    fail("Invalid repository");
  return value;
}
const LEGACY_PRODUCER_FIELDS = [
  "target",
  "runId",
  "headSha",
  "artifactId",
  "artifactSha256",
  "descriptorSha256",
];
const SDK_PRODUCER_FIELDS = [
  ...LEGACY_PRODUCER_FIELDS,
  "producer",
  "runAttempt",
  "completionSha256",
];
const OWNED_PRODUCER_FIELDS = [
  ...SDK_PRODUCER_FIELDS,
  "reviewedImport",
  "reviewSha256",
];
function selectedProducer(row) {
  return Object.fromEntries(
    (row.producer === "owned-import"
      ? OWNED_PRODUCER_FIELDS
      : row.producer === "engineering-sdk"
        ? SDK_PRODUCER_FIELDS
        : LEGACY_PRODUCER_FIELDS
    ).map((key) => [key, row[key]]),
  );
}
export function producerSelection(value) {
  if (!Array.isArray(value) || !value.length || value.length > 6)
    fail("One to six reviewed producers required");
  const seen = new Set();
  for (const row of value) {
    const sdk = row.producer === "engineering-sdk",
      owned = row.producer === "owned-import";
    exact(
      row,
      owned
        ? OWNED_PRODUCER_FIELDS
        : sdk
          ? SDK_PRODUCER_FIELDS
          : LEGACY_PRODUCER_FIELDS,
    );
    if (
      typeof row.target !== "string" ||
      !Object.hasOwn(NATIVE_TARGETS, row.target) ||
      seen.has(row.target) ||
      (sdk && row.target !== ENGINEERING_TARGET) ||
      (owned &&
        !["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"].includes(
          row.target,
        ))
    )
      fail("Unknown or duplicate native target");
    seen.add(row.target);
    identifier(row.runId);
    identifier(row.artifactId);
    digest(row.headSha, 40);
    digest(row.artifactSha256);
    digest(row.descriptorSha256);
    if (owned) {
      reviewedImportPath(row.reviewedImport);
      digest(row.reviewSha256);
    }
    if (sdk || owned) {
      identifier(row.runAttempt);
      digest(row.completionSha256);
    }
  }
  return value.map((row) => ({ ...row }));
}
export function verifyProducerMetadata(
  selection,
  run,
  artifact,
  repository,
  expectedName,
  context = {},
) {
  repositoryName(repository);
  const sdk = selection.producer === "engineering-sdk",
    owned = selection.producer === "owned-import";
  if (
    run.id !== selection.runId ||
    run.head_sha !== selection.headSha ||
    run.head_repository?.full_name !== repository ||
    run.repository?.full_name !== repository ||
    run.event !== "workflow_dispatch" ||
    run.path !==
      (owned
        ? OWNED_WORKFLOW
        : sdk
          ? ENGINEERING_WORKFLOW
          : ".github/workflows/cef-patched-runtime.yml") ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    fail(
      "Producer run is not the exact successful reviewed repository workflow",
    );
  if (
    (sdk || owned) &&
    (!context.defaultBranch ||
      run.head_branch !== context.defaultBranch ||
      run.run_attempt !== selection.runAttempt ||
      run.workflow_id !== context.workflowId ||
      run.repository.id !== context.repositoryId ||
      run.head_repository.id !== context.repositoryId)
  )
    fail("Completed SDK run is not exact default-branch producer authority");
  if (
    artifact.id !== selection.artifactId ||
    artifact.name !== expectedName ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== selection.runId ||
    artifact.workflow_run?.head_sha !== selection.headSha ||
    artifact.digest !== `sha256:${selection.artifactSha256}` ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 1 ||
    artifact.size_in_bytes >
      (owned
        ? OWNED_LIMITS.seal - 1
        : sdk
          ? CHECKPOINT_LIMITS.seal - 1
          : 3 * 1024 ** 3)
  )
    fail("Producer artifact identity, digest, size, expiry or run mismatch");
  return true;
}
export function assertNativeTarget(
  target,
  platform = process.platform,
  arch = process.arch,
) {
  const expected = NATIVE_TARGETS[target];
  if (!expected || expected.platform !== platform || expected.arch !== arch)
    fail(
      "Acceptance requires the exact native target host; cross/emulated execution is not accepted",
    );
  return expected;
}
function inside(root, file) {
  const rel = path.relative(root, file);
  return (
    !!rel &&
    !path.isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`)
  );
}
async function api(repository, suffix, token, fetcher) {
  const response = await fetcher(
    `https://api.github.com/repos/${repository}${suffix ? `/${suffix}` : ""}`,
    {
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) fail(`GitHub metadata request failed (${response.status})`);
  const bytes = await response.text();
  if (Buffer.byteLength(bytes) > 2 * 1024 * 1024)
    fail("GitHub metadata exceeds bound");
  return JSON.parse(bytes);
}
export async function acceptancePlan({
  producers,
  inputs,
  repository,
  token,
  fetcher = fetch,
  ownedReviewLoader = readOwnedImportReview,
}) {
  repositoryName(repository);
  releaseRelativePath(inputs);
  const inputRoot = await realpath(path.resolve(ROOT, inputs));
  if (!inside(ROOT, inputRoot)) fail("Reviewed inputs escape checkout");
  const lock = validateSourceLock(
    JSON.parse(
      await readFile(path.join(inputRoot, "source-lock.json"), "utf8"),
    ),
  );
  const include = [];
  const selected = producerSelection(producers);
  let sdkContext = {},
    ownedContext = {};
  if (selected.some((row) => row.producer === "owned-import")) {
    if (repository !== OWNED_REPOSITORY)
      fail("Owned import repository mismatch");
    const [repo, workflow] = await Promise.all([
      api(repository, "", token, fetcher),
      api(
        repository,
        "actions/workflows/cef-owned-sdk-import.yml",
        token,
        fetcher,
      ),
    ]);
    if (
      repo.full_name !== repository ||
      repo.private !== false ||
      workflow.path !== OWNED_WORKFLOW
    )
      fail("Owned import repository/workflow mismatch");
    ownedContext = {
      defaultBranch: repo.default_branch,
      repositoryId: repo.id,
      workflowId: workflow.id,
    };
  }
  if (selected.some((row) => row.producer === "engineering-sdk")) {
    const [repo, workflow] = await Promise.all([
      api(repository, "", token, fetcher),
      api(
        repository,
        "actions/workflows/cef-engineering-checkpoint.yml",
        token,
        fetcher,
      ),
    ]);
    if (
      repo.full_name !== repository ||
      repo.private !== false ||
      workflow.path !== ENGINEERING_WORKFLOW
    )
      fail("Engineering SDK repository/workflow mismatch");
    sdkContext = {
      defaultBranch: repo.default_branch,
      repositoryId: repo.id,
      workflowId: workflow.id,
    };
  }
  for (const row of selected) {
    const owned = row.producer === "owned-import";
    const review = owned
      ? await ownedReviewLoader(ROOT, row.reviewedImport, row.reviewSha256)
      : null;
    if (
      owned &&
      (review.target !== row.target ||
        review.descriptorSha256 !== row.descriptorSha256)
    )
      fail("Owned reviewed source/target/descriptor mismatch");
    const identity = owned
      ? { sourceLockSha256: review.sourceLockIdentity }
      : releaseIdentity(lock, row.target);
    const sdk = row.producer === "engineering-sdk";
    if (sdk && identity.sourceLockSha256 !== ENGINEERING_SOURCE)
      fail("Engineering SDK source inputs differ from reviewed producer");
    const name = owned
      ? importSealName(row.runId, row.runAttempt)
      : sdk
        ? sdkSealName({ runId: row.runId, attempt: row.runAttempt })
        : `cef-engine-bundle-${identity.key}`;
    const [run, artifact] = await Promise.all([
      api(repository, `actions/runs/${row.runId}`, token, fetcher),
      api(repository, `actions/artifacts/${row.artifactId}`, token, fetcher),
    ]);
    verifyProducerMetadata(
      row,
      run,
      artifact,
      repository,
      name,
      owned ? ownedContext : sdkContext,
    );
    include.push({
      ...row,
      runner: NATIVE_TARGETS[row.target].runner,
      sourceLockIdentity: identity.sourceLockSha256,
      artifactName: name,
    });
  }
  return {
    matrix: { include },
    nativeAcceptancePerformed: false,
    publicationAllowed: false,
  };
}
export function nativeChildEnvironment(source, sdk, cargoTarget) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      /^(GH_|GITHUB_|ACTIONS_|INPUT_|SORNG_|CEF_|SSH_AUTH_SOCK$|SSH_ASKPASS$|GIT_ASKPASS$|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|RUSTFLAGS$|CARGO_ENCODED_RUSTFLAGS$|LD_PRELOAD$|DYLD_)/i.test(
        key,
      ) ||
      /TOKEN|PASSWORD|SECRET|PRIVATE_KEY|ACCESS_KEY|AUTHORIZATION|CREDENTIAL/i.test(
        key,
      )
    )
      continue;
    env[key] = value;
  }
  return {
    ...env,
    CEF_PATH: sdk,
    CARGO_TARGET_DIR: cargoTarget,
    CARGO_BUILD_JOBS: "2",
  };
}
export function fixtureClientBuild(target, suite) {
  if (
    !Object.hasOwn(NATIVE_TARGETS, target) ||
    !["tls", "http2"].includes(suite)
  )
    fail("Unknown native fixture build");
  const windows = NATIVE_TARGETS[target].platform === "win32";
  const stem = `sorng_cef_${suite}_acceptance`;
  return {
    stem,
    client: windows ? `${stem}.dll` : stem.replaceAll("_", "-"),
    args: [
      "scripts/native-build-env.mjs",
      "cargo",
      "build",
      "--manifest-path",
      `src-tauri/crates/sorng-browser-host/tests/native_${suite}_acceptance/Cargo.toml`,
      windows ? "--lib" : "--bins",
      "--locked",
      "--target",
      target,
      "-j2",
    ],
  };
}
export function createAcceptanceBudget(
  now = () => performance.now(),
  milliseconds = 190 * 60_000,
) {
  const deadline = now() + milliseconds;
  return {
    timeout(requested = 3600_000) {
      const remaining = deadline - now();
      if (remaining <= 0)
        throw commandError(
          "Native acceptance total budget exhausted; inspect retained diagnostics",
          "ACCEPTANCE_BUDGET_EXHAUSTED",
        );
      return Math.min(requested, remaining);
    },
  };
}
export async function runAcceptanceCommand(
  executable,
  args,
  { env, log, cwd = ROOT, timeout = 3600_000 },
) {
  const { createWriteStream } = await import("node:fs");
  const stream = createWriteStream(log, { flags: "wx" });
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    let expired = false,
      settled = false,
      grace;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      child.stdout.unpipe(stream);
      child.stderr.unpipe(stream);
      stream.end(() => (error ? reject(error) : resolve()));
    };
    const stop = () => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => {});
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    };
    const timer = setTimeout(() => {
      expired = true;
      stop();
      grace = setTimeout(() => {
        void writeFile(
          `${log}.deadline.json`,
          JSON.stringify({
            timedOut: true,
            cleanup: "owned-command-exit-unconfirmed",
          }),
        )
          .catch(() => {})
          .then(() =>
            finish(
              commandError(
                "Acceptance command deadline exceeded; cleanup unconfirmed; inspect retained diagnostics",
                "COMMAND_CLEANUP_UNCONFIRMED",
              ),
            ),
          );
      }, 5000);
    }, timeout);
    stream.once("error", () => {
      stop();
      finish(
        commandError(
          "Acceptance command log could not be retained",
          "COMMAND_LOG_FAILED",
        ),
      );
    });
    child.once("error", () => {
      finish(
        commandError(
          "Acceptance build command could not start",
          "COMMAND_START_FAILED",
        ),
      );
    });
    child.once("close", async (code) => {
      clearTimeout(timer);
      clearTimeout(grace);
      let leftover = false;
      if (process.platform !== "win32" && child.pid) {
        const state = () => {
          try {
            process.kill(-child.pid, 0);
            return "present";
          } catch (error) {
            return error.code === "ESRCH" ? "absent" : "unknown";
          }
        };
        const before = state();
        leftover = before !== "absent";
        if (leftover) stop();
        const end = performance.now() + 2000;
        while (leftover && state() !== "absent" && performance.now() < end)
          await new Promise((resolve) => setTimeout(resolve, 25));
        try {
          await writeFile(
            `${log}.cleanup.json`,
            JSON.stringify({
              ownedProcessGroup: child.pid,
              stateAfterCommand: before,
              terminationRequested: leftover,
              groupGone: state() === "absent",
            }),
            { flag: "wx" },
          );
        } catch {
          leftover = true;
        }
      }
      finish(
        code === 0 && !expired && !leftover
          ? undefined
          : commandError(
              leftover
                ? "Acceptance command left owned process-group members; cleanup attempted; inspect retained diagnostics"
                : expired
                  ? "Acceptance build command deadline exceeded; inspect retained diagnostics"
                  : "Acceptance build command failed; inspect retained diagnostics",
              leftover
                ? "COMMAND_GROUP_NOT_CLEAN"
                : expired
                  ? "COMMAND_TIMEOUT"
                  : "COMMAND_EXIT_FAILED",
            ),
      );
    });
  });
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
export async function verifyAcceptanceBundle({
  bundle,
  selection,
  repository,
  expectedLock,
  verifier = verifyBundle,
  ownedReviewLoader = readOwnedImportReview,
}) {
  const raw = await readFile(path.join(bundle, "runtime.json"));
  if (
    raw.length > RELEASE_LIMITS.descriptor ||
    sha(raw) !== selection.descriptorSha256
  )
    fail("Downloaded descriptor differs from independently reviewed bytes");
  const checked = await verifier(bundle, repository);
  if (
    checked.descriptor.target !== selection.target ||
    checked.identity.sourceLockSha256 !== expectedLock
  )
    fail("Downloaded bundle differs from reviewed target/source lock");
  if (selection.producer === "owned-import") {
    const bytes = await readFile(
      path.join(bundle, "owned-import-completion.json"),
    );
    if (
      bytes.length >= OWNED_LIMITS.seal ||
      sha(bytes) !== selection.completionSha256
    )
      fail("Owned completion raw digest differs");
    const completion = validateImportCompletion(parseOwnedJson(bytes));
    const review = await ownedReviewLoader(
      ROOT,
      selection.reviewedImport,
      selection.reviewSha256,
    );
    if (
      ownedCompletionSha(completion) !== selection.completionSha256 ||
      completion.reviewSha256 !== selection.reviewSha256 ||
      completion.reviewedImport !== selection.reviewedImport ||
      canonical(completion.review) !== canonical(review) ||
      review.target !== selection.target ||
      review.sourceLockIdentity !== expectedLock ||
      completion.producer.runId !== selection.runId ||
      completion.producer.attempt !== selection.runAttempt ||
      completion.producer.head !== selection.headSha ||
      completion.producer.repository !== repository ||
      completion.producer.workflow !== OWNED_WORKFLOW
    )
      fail("Owned completion review/source/attempt differs");
    const actual = checked.assets
      .map(({ name, size, sha256 }) => ({ name, bytes: size, sha256 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const expected = [...review.assets].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    if (canonical(actual) !== canonical(expected))
      fail("Owned completion does not bind all actual raw bundle assets");
  }
  if (selection.producer === "engineering-sdk") {
    const proofBytes = await readFile(
      path.join(bundle, "sdk-completion-proof.json"),
    );
    if (
      proofBytes.length >= CHECKPOINT_LIMITS.seal ||
      sha(proofBytes) !== selection.completionSha256
    )
      fail("SDK completion proof differs from independently reviewed bytes");
    const proof = validateSdkCompletion(JSON.parse(proofBytes));
    if (
      completionSha(proof) !== selection.completionSha256 ||
      proof.target !== selection.target ||
      proof.sourceLockSha256 !== expectedLock ||
      proof.producer.repository !== repository ||
      proof.producer.runId !== selection.runId ||
      proof.producer.head !== selection.headSha ||
      proof.producer.attempt !== selection.runAttempt ||
      proof.producer.workflow !== ENGINEERING_WORKFLOW
    )
      fail("SDK completion proof producer/source mismatch");
    const actual = checked.assets
      .map((row) => ({ name: row.name, bytes: row.size, sha256: row.sha256 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (canonical(actual) !== canonical(proof.bundleAssets))
      fail("SDK completion proof does not bind actual verified bundle");
  }
  return checked;
}
export async function downloadEngineeringSdk({
  entry,
  bundle,
  repository,
  token,
  env = process.env,
}) {
  producerSelection([selectedProducer(entry)]);
  if (
    entry.producer !== "engineering-sdk" ||
    entry.sourceLockIdentity !== ENGINEERING_SOURCE
  )
    fail("Explicit completed SDK entry required");
  assertNativeTarget(entry.target);
  const temp = await realpath(env.RUNNER_TEMP),
    parent = await realpath(path.dirname(path.resolve(bundle))),
    destination = path.join(parent, path.basename(bundle));
  if (!inside(temp, destination))
    fail("SDK transport output escapes ephemeral runner");
  const python = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-c", "import sys;print(sys.executable)"],
    {
      encoding: "utf8",
      timeout: 5000,
      env: nativeChildEnvironment(
        env,
        "",
        path.join(temp, "cef-sdk-download-cargo"),
      ),
      windowsHide: true,
    },
  ).trim();
  return downloadSdkBundle(
    apiClient(repository, token, fetch, { readOnly: true }),
    {
      selection: entry,
      repository,
      token,
      destination,
      python,
      helper: path.join(ROOT, "scripts/lib/cef-checkpoint-archive.py"),
    },
  );
}
export async function downloadOwnedSdk({
  entry,
  bundle,
  repository,
  token,
  env = process.env,
}) {
  producerSelection([selectedProducer(entry)]);
  if (entry.producer !== "owned-import" || repository !== OWNED_REPOSITORY)
    fail("Explicit owned-import entry required");
  assertNativeTarget(entry.target);
  const review = await readOwnedImportReview(
    ROOT,
    entry.reviewedImport,
    entry.reviewSha256,
  );
  if (
    review.sourceLockIdentity !== entry.sourceLockIdentity ||
    review.target !== entry.target
  )
    fail("Owned source differs from independent review");
  const temp = await realpath(env.RUNNER_TEMP),
    parent = await realpath(path.dirname(path.resolve(bundle))),
    destination = path.join(parent, path.basename(bundle));
  if (!inside(temp, destination))
    fail("Owned SDK output escapes ephemeral runner");
  const python = execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: nativeChildEnvironment(
        env,
        "",
        path.join(temp, "cef-owned-download-cargo"),
      ),
    },
  ).trim();
  try {
    return await downloadOwnedImport(ownedImportApi(repository, token), {
      selection: entry,
      review,
      repository,
      token,
      destination,
      python,
    });
  } catch {
    fail(
      "Owned import transport verification failed; no native authority granted",
    );
  }
}
export async function executeAcceptance(
  { entry, bundle, output, repository, env = process.env },
  dependencies = {},
) {
  const { target } = entry;
  assertNativeTarget(target);
  digest(env.GITHUB_SHA, 40);
  identifier(Number(env.GITHUB_RUN_ID));
  const execution = acceptanceExecution(env);
  const code = execution ? acceptanceCodeIdentity(execution.sourceSha) : null;
  producerSelection([selectedProducer(entry)]);
  digest(entry.sourceLockIdentity);
  const temp = await realpath(env.RUNNER_TEMP);
  const requestedOutput = path.resolve(output);
  const destination = path.join(
    await realpath(path.dirname(requestedOutput)),
    path.basename(requestedOutput),
  );
  if (!inside(temp, destination))
    fail("Acceptance output must be inside ephemeral runner temp");
  await mkdir(destination);
  const checked = await verifyAcceptanceBundle({
    bundle,
    selection: entry,
    repository,
    expectedLock: entry.sourceLockIdentity,
  });
  const descriptor = checked.descriptor;
  const sourceLock = JSON.parse(
    await readFile(path.join(bundle, descriptor.sourceLock.path), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(path.join(bundle, descriptor.manifest.path), "utf8"),
  );
  const invoke = dependencies.command ?? runAcceptanceCommand;
  const budget = createAcceptanceBudget();
  await writeFile(
    path.join(destination, "acceptance-budget.json"),
    JSON.stringify({
      budgetMinutes: 190,
      jobMinutes: 240,
      scope:
        "Shared across preparation, builds and sequential native checks; cleanup grace remains bounded",
    }),
    { flag: "wx" },
  );
  const runCommand = async (executable, args, options) => {
    let timeout;
    try {
      timeout = budget.timeout(options.timeout);
    } catch (error) {
      await writeFile(
        path.join(destination, "acceptance-budget-exhausted.json"),
        JSON.stringify({ exhausted: true, nativeAcceptanceConfirmed: false }),
      );
      throw error;
    }
    return invoke(executable, args, { ...options, timeout });
  };
  const python = process.platform === "win32" ? "python" : "python3";
  const extracted = path.join(destination, "extracted");
  const extractionEnv = nativeChildEnvironment(
    env,
    "",
    path.join(destination, "cargo"),
  );
  await runCommand(
    python,
    [
      "-I",
      path.join(ROOT, "scripts/lib/extract-custom-runtime.py"),
      path.join(bundle, descriptor.archive.path),
      extracted,
      path.join(bundle, descriptor.manifest.path),
      target,
      descriptor.sdk.archiveRoot,
      String(RELEASE_LIMITS.expanded),
      String(RELEASE_LIMITS.members),
    ],
    {
      env: extractionEnv,
      log: path.join(destination, "extract.log"),
      timeout: 1800_000,
    },
  );
  const prepared = await prepareCustomRuntime({
    manifest,
    sourceLock,
    target,
    artifactRoot: bundle,
    sdkRoot: path.join(extracted, descriptor.sdk.archiveRoot),
    output: path.join(destination, "prepared-sdk"),
  });
  const preparedPlan = { ...prepared, target, runtimeKind: "custom" };
  const customPlan = path.join(destination, "prepared-plan.json");
  await writeFile(customPlan, JSON.stringify(preparedPlan, null, 2), {
    flag: "wx",
  });
  const cargo = path.join(destination, "cargo");
  const childEnv = nativeChildEnvironment(env, prepared.sdk, cargo);
  const windows = process.platform === "win32";
  const binRoot = path.join(cargo, target, "debug");
  let helper;
  if (!windows) {
    await runCommand(
      process.execPath,
      [
        "scripts/native-build-env.mjs",
        "cargo",
        "build",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "-p",
        "sorng-browser-host",
        "--features",
        "cef-host",
        "--bin",
        "sorng-cef-helper",
        "--locked",
        "--target",
        target,
        "-j2",
      ],
      { env: childEnv, log: path.join(destination, "build-helper.log") },
    );
    helper = path.join(binRoot, "sorng-cef-helper");
  }
  const reports = [],
    builds = [];
  for (const suite of ["tls", "http2"]) {
    const build = fixtureClientBuild(target, suite);
    const { stem } = build;
    await runCommand(process.execPath, build.args, {
      env: childEnv,
      log: path.join(destination, `build-${suite}.log`),
    });
    builds.push({
      suite,
      clientSha256: await hashFile(path.join(binRoot, build.client)),
      cargoLockSha256: await hashFile(
        path.join(
          ROOT,
          `src-tauri/crates/sorng-browser-host/tests/native_${suite}_acceptance/Cargo.lock`,
        ),
      ),
      ...(helper ? { helperSha256: await hashFile(helper) } : {}),
    });
    let appPlist;
    if (process.platform === "darwin") {
      appPlist = path.join(destination, `${suite}-Info.plist`);
      await writeFile(
        appPlist,
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.sortofremoteng.acceptance.${suite}</string><key>CFBundleExecutable</key><string>${stem}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>14.0</string></dict></plist>`,
        { flag: "wx" },
      );
    }
    const stage = await stageAcceptance({
      customPlan,
      client: path.join(binRoot, build.client),
      helper,
      appPlist,
      output: path.join(
        destination,
        `stage-${suite}${process.platform === "darwin" ? ".app" : ""}`,
      ),
      target,
      suite,
    });
    for (const check of suite === "tls" ? [undefined] : HTTP2_CHECKS) {
      const label = suite === "tls" ? "tls" : `http2-${check}`;
      const reportOutput = path.join(destination, label);
      let commandSucceeded = true;
      try {
        await runCommand(
          process.execPath,
          [
            "scripts/cef-browser-acceptance.mjs",
            suite === "tls" ? "run-tls" : "run-http2",
            "--executable",
            stage.executable,
            "--output",
            reportOutput,
            ...(check ? ["--check", check] : []),
          ],
          {
            env: childEnv,
            log: path.join(destination, `${label}-runner.log`),
            timeout: 660_000,
          },
        );
      } catch (error) {
        if (error.code !== "COMMAND_EXIT_FAILED") throw error;
        commandSucceeded = false;
      }
      // A missing/invalid report aborts; a real negative receipt is retained and
      // the remaining sequential cases still run for useful diagnostics.
      const report = JSON.parse(
        await readFile(path.join(reportOutput, "acceptance.json"), "utf8"),
      );
      const accepted =
        commandSucceeded &&
        report.ok === true &&
        (suite === "tls"
          ? report.nativeTlsFixtureAccepted === true
          : report.nativeHttp2FixtureAccepted === true);
      reports.push({
        suite,
        ...(check ? { check } : {}),
        accepted,
        reportSha256: await hashFile(
          path.join(reportOutput, "acceptance.json"),
        ),
      });
      await writeFile(
        path.join(destination, "acceptance-progress.json"),
        JSON.stringify({ target, reports, publicationAllowed: false }, null, 2),
      );
    }
  }
  const result = {
    schemaVersion: 1,
    kind: "sorng-cef-native-acceptance-run",
    target,
    producer: entry,
    ...(entry.producer === "owned-import"
      ? { ingestion: "operator-reviewed-local-bytes", hostedBuild: false }
      : {}),
    acceptanceSourceSha: env.GITHUB_SHA,
    acceptanceWorkflowRunId: Number(env.GITHUB_RUN_ID),
    nativeHost: { platform: process.platform, architecture: process.arch },
    sourceLockIdentity: checked.identity.sourceLockSha256,
    descriptorSha256: entry.descriptorSha256,
    reports,
    builds,
    ok: reports.length === 9 && reports.every((report) => report.accepted),
    nativeExecutionPerformed: true,
    publicProviderAcceptance: false,
    productionReady: false,
    publicationAllowed: false,
  };
  await writeFile(
    path.join(destination, "native-acceptance.json"),
    JSON.stringify(result, null, 2),
    { flag: "wx" },
  );
  if (!result.ok)
    fail(
      "One or more native acceptance gates failed; inspect retained receipts",
    );
  if (execution) {
    if (
      canonical(acceptanceCodeIdentity(execution.sourceSha)) !== canonical(code)
    )
      fail("Native acceptance code changed during execution");
    await writeAcceptanceSeal({ destination, result, execution, code });
  }
  return result;
}
async function main() {
  const [mode] = process.argv.slice(2);
  const env = process.env;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY_VISIBILITY !== "public" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  )
    fail("Explicit public ephemeral hosted workflow required");
  if (mode === "plan") {
    const result = await acceptancePlan({
      producers: JSON.parse(env.CEF_PRODUCERS),
      inputs: env.CEF_REVIEWED_INPUTS,
      repository: env.GITHUB_REPOSITORY,
      token: env.GH_TOKEN,
    });
    if (env.GITHUB_OUTPUT) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(
        env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify(result.matrix)}\n`,
      );
    }
    return result;
  }
  if (mode === "download-sdk")
    return downloadEngineeringSdk({
      entry: JSON.parse(env.CEF_ENTRY),
      bundle: env.CEF_BUNDLE,
      repository: env.GITHUB_REPOSITORY,
      token: env.GH_TOKEN,
      env,
    });
  if (mode === "download-owned")
    return downloadOwnedSdk({
      entry: JSON.parse(env.CEF_ENTRY),
      bundle: env.CEF_BUNDLE,
      repository: env.GITHUB_REPOSITORY,
      token: env.GH_TOKEN,
    });
  if (mode === "run")
    return executeAcceptance({
      entry: JSON.parse(env.CEF_ENTRY),
      bundle: env.CEF_BUNDLE,
      output: env.CEF_ACCEPTANCE_OUTPUT,
      repository: env.GITHUB_REPOSITORY,
    });
  fail("Expected plan, download-sdk, download-owned or run");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`[cef-runtime-acceptance-ci] ${error.message}`);
      process.exitCode = 1;
    });
