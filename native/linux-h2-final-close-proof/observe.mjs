import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptanceCodeIdentity,
  downloadOwnedSdk,
  fixtureClientBuild,
  fixtureRunArguments,
  nativeChildEnvironment,
  prepareLinuxSandbox,
  runAcceptanceCommand,
  verifyAcceptanceBundle,
  verifiedAcceptanceSourceLock,
} from "../../scripts/cef-runtime-acceptance-ci.mjs";
import {
  prepareCustomRuntime,
  verifyPreparedCustomRuntime,
} from "../../scripts/lib/browser-custom-runtime.mjs";
import { RELEASE_LIMITS } from "../../scripts/lib/browser-runtime-release.mjs";
import { stageAcceptance } from "../../scripts/cef-browser-acceptance.mjs";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BRANCH = "codex/ci-linux-h2-final-close-proof-20261026";
export const REPOSITORY = "supermarsx/sortOfRemoteNG";
export const WORKFLOW = ".github/workflows/cef-sdk-layout-probe.yml";
export const ENTRY = Object.freeze({
  target: "x86_64-unknown-linux-gnu",
  producer: "owned-import",
  runId: 40405703996,
  runAttempt: 1,
  headSha: "7d2aeca6c30588afb89bfa8087236b4683a5ab19",
  artifactId: 12690886375,
  artifactSha256:
    "f080328422abd3458817da788752e77822afe3ff99c06036c743fdafda3c5245",
  descriptorSha256:
    "5f8c8dd960303b1046d4669b89f4a10c47dd01e70f639a4d6d52ca2c601a7db3",
  completionSha256:
    "782bbad7b82566ac76ca8a46382311589fa6f497377c78df6eb937e60a0decf8",
  reviewedImport:
    "native/cef-owned-sdk-imports/linux-x64-source25-external-webview-20261026/review.json",
  reviewSha256:
    "830aa9751d8492b403341cee66129409dba107cfd8c52f013785eadb30876b5c",
  sourceLockIdentity:
    "8e8641855d7f7ddc63ce7bfd3e9b5adcc5f5ffc64103b0fc469c69608538f279",
});
const SOURCES = [
  WORKFLOW,
  "native/linux-h2-final-close-proof/observe.mjs",
  "src-tauri/crates/sorng-browser-host/tests/native_http2_acceptance/src/permission_churn_fixture.rs",
  "src-tauri/crates/sorng-browser-host/tests/native_http2_acceptance/src/proxy_retry_fixture.rs",
  "src-tauri/crates/sorng-browser-host/tests/native_http2_acceptance/Cargo.lock",
  "scripts/cef-runtime-acceptance-ci.mjs",
  "scripts/cef-browser-acceptance.mjs",
  "scripts/lib/browser-custom-runtime.mjs",
  "scripts/lib/extract-custom-runtime.py",
  "scripts/native-build-env.mjs",
  ENTRY.reviewedImport,
];
const positive = (value) =>
  /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function authority(env, event) {
  assert(
    env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_REPOSITORY_ID === "1010282954",
    "CLOSE_REPOSITORY",
  );
  assert(
    event?.repository?.id === 1010282954 &&
      event.repository.full_name === REPOSITORY &&
      event.repository.private === false &&
      event.repository.visibility === "public" &&
      event.repository.default_branch === "main" &&
      env.CEF_DEFAULT_BRANCH === "main" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public",
    "CLOSE_PUBLIC_DEFAULT",
  );
  const ref = `refs/heads/${BRANCH}`;
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === ref &&
      [ref, BRANCH].includes(event.ref) &&
      env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${WORKFLOW}@${ref}` &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA) &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      positive(env.GITHUB_RUN_ID) &&
      positive(env.GITHUB_RUN_ATTEMPT),
    "CLOSE_EXECUTION",
  );
  assert(Object.hasOwn(event, "inputs"), "CLOSE_INPUTS");
  const inputs = event.inputs;
  assert(
    inputs === null ||
      (Object.getPrototypeOf(inputs) === Object.prototype &&
        (Object.keys(inputs).length === 0 ||
          (Object.keys(inputs).length === 1 &&
            Object.hasOwn(inputs, "metal_tools") &&
            [false, "false"].includes(inputs.metal_tools)))),
    "CLOSE_INPUTS",
  );
  return {
    head: env.GITHUB_SHA,
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    ref,
  };
}
export function clock(
  context,
  wall = () => Date.now(),
  mono = () => process.hrtime.bigint(),
) {
  assert(
    Number.isSafeInteger(context.wallStart) &&
      /^[0-9]+$/.test(context.monoStart),
    "CLOSE_CLOCK",
  );
  const work = 190 * 60000;
  return (cap) => {
    const remaining = Math.floor(
      Math.min(
        context.wallStart + work - wall(),
        work - Number(mono() - BigInt(context.monoStart)) / 1e6,
      ),
    );
    assert(
      Number.isSafeInteger(cap) && cap > 0 && remaining > 5000,
      "CLOSE_DEADLINE",
    );
    return Math.min(cap, remaining - 5000); // Maintained cleanup stays inside the original clock.
  };
}
export function admitDownload(remaining) {
  // The unchanged importer owns a40-minute API clock, a20-minute asset clock
  // and a15-second seal extractor. Never start that bounded transaction late.
  const requested = 60 * 60000 + 15000;
  assert(remaining(requested) === requested, "CLOSE_DOWNLOAD_BUDGET");
}
async function json(file) {
  const s = await lstat(file);
  assert(
    s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= 1024 * 1024,
    "CLOSE_JSON",
  );
  return JSON.parse(await readFile(file, "utf8"));
}
async function pins() {
  const rows = [];
  for (const name of SOURCES) {
    const file = path.join(ROOT, name),
      before = await lstat(file, { bigint: true });
    assert(
      before.isFile() &&
        !before.isSymbolicLink() &&
        before.nlink === 1n &&
        before.size < 32n * 1024n ** 2n,
      "CLOSE_SOURCE",
    );
    const raw = await readFile(file),
      after = await lstat(file, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"])
      assert(before[key] === after[key], "CLOSE_SOURCE_CHANGED");
    rows.push({ path: name, bytes: raw.length, sha256: sha(raw) });
  }
  return rows;
}
export function errorCode(error) {
  if (
    typeof error?.message === "string" &&
    /^CLOSE_[A-Z0-9_]{1,64}$/.test(error.message)
  )
    return error.message;
  const value = error?.code;
  return typeof value === "string" &&
    /^(?:COMMAND|ACCEPTANCE|CLOSE)_[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : "CLOSE_PHASE_FAILED";
}
async function exclusive(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
export async function execute(mode, env = process.env, deps = {}) {
  assert(["prepare", "download", "run"].includes(mode), "CLOSE_MODE");
  const identity = authority(env, await json(env.GITHUB_EVENT_PATH));
  assert(
    process.platform === "linux" && process.arch === "x64",
    "CLOSE_PLATFORM",
  );
  const temp = await realpath(env.RUNNER_TEMP),
    output = path.join(
      temp,
      `h2-final-close-proof-${identity.runId}-${identity.attempt}`,
    );
  assert(
    (await lstat(temp)).isDirectory() && !(await lstat(temp)).isSymbolicLink(),
    "CLOSE_TEMP",
  );
  const contextFile = path.join(output, "context.json"),
    bundle = path.join(output, "bundle");
  if (mode === "prepare") {
    assert(!env.GH_TOKEN, "CLOSE_PREPARE_TOKEN");
    const wallStart = Date.now(),
      monoStart = process.hrtime.bigint().toString();
    const codeIdentity = acceptanceCodeIdentity(identity.head, ROOT),
      source = await pins();
    await mkdir(output);
    await exclusive(contextFile, {
      ...identity,
      wallStart,
      monoStart,
      codeIdentity,
      source,
      selection: ENTRY,
      fullNativeAcceptance: false,
      publicationAllowed: false,
    });
    return;
  }
  assert((await realpath(output)) === output, "CLOSE_OUTPUT_ALIAS");
  const context = await json(contextFile),
    remaining = clock(context);
  for (const key of ["head", "runId", "attempt", "ref"])
    assert(context[key] === identity[key], "CLOSE_CONTEXT");
  assert(
    JSON.stringify(context.selection) === JSON.stringify(ENTRY),
    "CLOSE_SELECTION",
  );
  assert(
    JSON.stringify(await pins()) === JSON.stringify(context.source),
    "CLOSE_SOURCE_CHANGED",
  );
  remaining(1);
  if (mode === "download") {
    let failed = false,
      first;
    try {
      admitDownload(remaining);
      await (deps.download ?? downloadOwnedSdk)({
        entry: ENTRY,
        bundle,
        repository: REPOSITORY,
        token: env.GH_TOKEN,
        env,
      });
      remaining(1);
    } catch (error) {
      failed = true;
      first = error;
    }
    let reporting,
      reportingFailed = false;
    try {
      await exclusive(path.join(output, "download.json"), {
        ok: !failed,
        firstFailure: failed ? errorCode(first) : null,
        sourceLock: ENTRY.sourceLockIdentity,
      });
    } catch (error) {
      reportingFailed = true;
      reporting = error;
    }
    if (failed) throw first;
    if (reportingFailed) throw reporting;
    return;
  }
  assert(!env.GH_TOKEN, "CLOSE_RUN_TOKEN");
  assert.deepEqual(
    acceptanceCodeIdentity(identity.head, ROOT),
    context.codeIdentity,
    "CLOSE_CODE",
  );
  const commands = [],
    result = {
      kind: "isolated-h2-final-close-proof",
      ...identity,
      fullNativeAcceptance: false,
      publicationAllowed: false,
      ok: false,
      stage: "verify-bundle",
      firstFailure: null,
      postFailure: null,
      cleanupConfirmed: false,
    };
  let failed = false,
    first,
    prepared;
  const invoke = deps.command ?? runAcceptanceCommand;
  const command = async (label, exe, args, options = {}) => {
    const row = { label, status: "running" },
      started = Date.now();
    commands.push(row);
    result.stage = label;
    try {
      await invoke(exe, args, {
        ...options,
        timeout: remaining(options.timeout ?? 3600000),
        log: path.join(output, `${label}.log`),
        cwd: ROOT,
      });
      row.status = "success";
    } catch (error) {
      row.status = errorCode(error);
      throw error;
    } finally {
      row.elapsedMs = Math.max(0, Date.now() - started);
    }
  };
  try {
    const checked = await verifyAcceptanceBundle({
      bundle,
      selection: ENTRY,
      repository: REPOSITORY,
      expectedLock: ENTRY.sourceLockIdentity,
    });
    const sourceLock = await verifiedAcceptanceSourceLock(bundle, checked),
      descriptor = checked.descriptor;
    const manifest = await json(path.join(bundle, descriptor.manifest.path));
    const extracted = path.join(output, "extracted"),
      cargo = path.join(output, "cargo");
    const extractionEnv = nativeChildEnvironment(env, "", cargo);
    await command(
      "extract",
      "python3",
      [
        "-I",
        path.join(ROOT, "scripts/lib/extract-custom-runtime.py"),
        path.join(bundle, descriptor.archive.path),
        extracted,
        path.join(bundle, descriptor.manifest.path),
        ENTRY.target,
        descriptor.sdk.archiveRoot,
        String(RELEASE_LIMITS.expanded),
        String(RELEASE_LIMITS.members),
      ],
      { env: extractionEnv, timeout: 1800000 },
    );
    result.stage = "prepare-sdk";
    remaining(1);
    prepared = await prepareCustomRuntime({
      manifest,
      sourceLock,
      target: ENTRY.target,
      artifactRoot: bundle,
      sdkRoot: path.join(extracted, descriptor.sdk.archiveRoot),
      output: path.join(output, "prepared-sdk"),
    });
    assert(prepared.customRuntime.sdkFiles.length === 939, "CLOSE_SDK_COUNT");
    const plan = { ...prepared, target: ENTRY.target, runtimeKind: "custom" },
      planFile = path.join(output, "prepared-plan.json");
    await exclusive(planFile, plan);
    const childEnv = nativeChildEnvironment(env, prepared.sdk, cargo),
      bins = path.join(cargo, ENTRY.target, "debug");
    await command(
      "build-helper",
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
        ENTRY.target,
        "-j2",
      ],
      { env: childEnv },
    );
    const build = fixtureClientBuild(ENTRY.target, "http2");
    await command("build-http2", process.execPath, build.args, {
      env: childEnv,
    });
    result.stage = "stage-http2";
    remaining(1);
    const stage = await stageAcceptance({
      customPlan: planFile,
      client: path.join(bins, build.client),
      helper: path.join(bins, "sorng-cef-helper"),
      output: path.join(output, "stage-http2"),
      target: ENTRY.target,
      suite: "http2",
    });
    await prepareLinuxSandbox({
      runnerTemp: temp,
      destination: output,
      stage: path.dirname(stage.executable),
      suite: "http2",
      target: ENTRY.target,
      sdkFiles: prepared.customRuntime.sdkFiles,
      run: (exe, args, options) => command("sandbox-http2", exe, args, options),
    });
    await command(
      "permission-churn",
      process.execPath,
      fixtureRunArguments(
        "http2",
        stage.executable,
        path.join(output, "http2-permission-churn"),
        "permission-churn",
        sourceLock,
      ),
      { env: childEnv, timeout: 660000 },
    );
    const acceptance = await json(
      path.join(output, "http2-permission-churn/acceptance.json"),
    );
    assert(
      acceptance.ok === true && acceptance.nativeHttp2FixtureAccepted === true,
      "CLOSE_ASSESSOR",
    );
    result.caseAccepted = true;
  } catch (error) {
    failed = true;
    first = error;
    result.firstFailure = { stage: result.stage, code: errorCode(error) };
  }
  try {
    remaining(1);
    if (prepared)
      await verifyPreparedCustomRuntime({
        ...prepared,
        target: ENTRY.target,
        runtimeKind: "custom",
      });
    assert.deepEqual(await pins(), context.source, "CLOSE_SOURCE_CHANGED");
    assert.deepEqual(
      acceptanceCodeIdentity(identity.head, ROOT),
      context.codeIdentity,
      "CLOSE_CODE_CHANGED",
    );
    result.sourceSdkPostVerified = !!prepared;
  } catch (error) {
    result.postFailure = errorCode(error);
    if (!failed) {
      failed = true;
      first = error;
      result.firstFailure = { stage: "postcheck", code: errorCode(error) };
    }
  }
  const cleanup = [];
  for (const row of commands) {
    try {
      const proof = await json(
        path.join(output, `${row.label}.log.cleanup.json`),
      );
      cleanup.push({ label: row.label, groupGone: proof.groupGone === true });
    } catch {
      cleanup.push({ label: row.label, groupGone: false });
    }
  }
  result.cleanupConfirmed =
    cleanup.length > 0 && cleanup.every((row) => row.groupGone);
  result.commands = commands;
  result.cleanup = cleanup;
  result.ok =
    !failed && result.cleanupConfirmed && result.caseAccepted === true;
  let reporting,
    reportingFailed = false;
  try {
    await exclusive(path.join(output, "commands.json"), commands);
    await exclusive(path.join(output, "result.json"), result);
  } catch (error) {
    reportingFailed = true;
    reporting = error;
  }
  if (failed) throw first;
  if (reportingFailed) throw reporting;
  assert(result.ok, "CLOSE_CLEANUP");
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  execute(process.argv.length === 3 ? process.argv[2] : "").catch((error) => {
    console.error(errorCode(error));
    process.exitCode = 1;
  });
}
