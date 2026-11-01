// One closed Darwin scratch leaf. No report grants production admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { held, executeJoined } from "./mac_process_census_proof.mjs";

export const BRANCH =
  "refs/heads/codex/mac-nearby-source-qualification-20261101";
export const WORKFLOW =
  "supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-nearby-source-proof.yml@" +
  BRANCH;
const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
export const NEGATIVES = Object.freeze([
  "populated-gitlink",
  "wrong-target",
  "wrong-head",
  "wrong-gitmodules",
  "wrong-link-kind",
  "missing-gitlink",
  "unknown-missing-link",
  "same-length-corruption",
  "legacy-sidecar",
  "changed-literal-binding",
  "wrong-identity",
  "root-replacement",
  "held-fd-drift",
  "close-fault",
]);
const SOURCES = Object.freeze([
  [
    "aarch64-apple-darwin",
    "65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54",
    "sorng-macarm-owned-source-metadata-intel-20260824-v2-nearby-literals",
  ],
  [
    "x86_64-apple-darwin",
    "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef",
    "sorng-macintel-owned-source-metadata-intel-20260824-v2-nearby-literals",
  ],
]);
export function authority(env, platform, architecture) {
  assert(platform === "darwin" && architecture === "x64", "NEARBY_PROOF_HOST");
  assert(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.ImageOS === "macos15" &&
      env.ImageVersion === "20260824.0482.1",
    "NEARBY_PROOF_IMAGE",
  );
  assert(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === BRANCH &&
      env.GITHUB_REPOSITORY === "supermarsx/sortOfRemoteNG" &&
      env.GITHUB_REPOSITORY_ID === "1010282954" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_REF === WORKFLOW,
    "NEARBY_PROOF_AUTHORITY",
  );
}
export function budget(started, now) {
  assert(
    Number.isSafeInteger(started) &&
      started > 0 &&
      Number.isSafeInteger(now) &&
      now >= started,
    "NEARBY_PROOF_CLOCK",
  );
  const remaining = Math.min(100000, started + 300000 - now - 30000);
  assert(remaining >= 20000, "NEARBY_PROOF_DEADLINE");
  return remaining;
}
export function childEnvironment(env, childDeadline) {
  const result = { PATH: "/usr/bin:/bin" };
  for (const key of [
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
    "CEF_MAC_NEARBY_JOB_STARTED_MS",
  ])
    result[key] = env[key];
  if (typeof env.RUNNER_TRACKING_ID === "string" && env.RUNNER_TRACKING_ID)
    result.RUNNER_TRACKING_ID = env.RUNNER_TRACKING_ID;
  assert(Number.isSafeInteger(childDeadline), "NEARBY_PROOF_DEADLINE");
  result.CEF_MAC_NEARBY_CHILD_DEADLINE_MS = String(childDeadline);
  return result;
}
function exact(value, keys) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === keys.slice().sort().join(),
    "NEARBY_PROOF_SCHEMA",
  );
}
export function validateReport(value) {
  exact(value, [
    "schemaVersion",
    "kind",
    "complete",
    "hostPlatform",
    "hostArchitecture",
    "image",
    "productionLiteralAdmission",
    "scopedLiteralPolicyAvailable",
    "productionInputWrites",
    "compilerExecuted",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
    "publicDeniedBefore",
    "publicDeniedAfter",
    "cases",
    "failureStage",
    "failureCode",
    "cleanupConfirmed",
    "proofWriterClosed",
    "proofWriterRetired",
  ]);
  assert(
    value.schemaVersion === 2 &&
      value.kind === "sorng-mac-nearby-owned-source-proof" &&
      value.hostPlatform === "darwin" &&
      value.hostArchitecture === "x86_64" &&
      value.image === "20260824.0482.1" &&
      value.failureCode === null &&
      value.failureStage === null &&
      typeof value.scopedLiteralPolicyAvailable === "boolean",
    "NEARBY_PROOF_IDENTITY",
  );
  for (const key of [
    "complete",
    "publicDeniedBefore",
    "publicDeniedAfter",
    "cleanupConfirmed",
    "proofWriterClosed",
    "proofWriterRetired",
  ])
    assert(value[key] === true, "NEARBY_PROOF_INCOMPLETE");
  for (const key of [
    "productionLiteralAdmission",
    "productionInputWrites",
    "compilerExecuted",
    "sdkBuilt",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert(value[key] === false, "NEARBY_PROOF_ADMISSION");
  assert(Array.isArray(value.cases) && value.cases.length === 2);
  for (let index = 0; index < 2; index++) {
    const row = value.cases[index];
    exact(row, [
      "target",
      "source",
      "policy",
      "schemaVersion",
      "recorded",
      "recreatedDistinctInodes",
      "applied",
      "verified",
      "literalRows",
      "portableLiteralBindingVerified",
      "sidecarUnchanged",
      "noLinuxStatCache",
      "birthIdentityPortable",
      "negativeCases",
      "complete",
    ]);
    assert.deepEqual([row.target, row.source, row.policy], SOURCES[index]);
    assert(row.schemaVersion === 2 && row.literalRows === 5);
    assert(row.birthIdentityPortable === false);
    for (const key of [
      "recorded",
      "recreatedDistinctInodes",
      "applied",
      "verified",
      "portableLiteralBindingVerified",
      "sidecarUnchanged",
      "noLinuxStatCache",
      "complete",
    ])
      assert(row[key] === true, "NEARBY_PROOF_ROUNDTRIP");
    exact(row.negativeCases, NEGATIVES);
    assert(Object.values(row.negativeCases).every((fact) => fact === true));
  }
  return value;
}
export function childFailure(error) {
  const stages = [
    "arguments",
    "host",
    "authority",
    "python-pin",
    "output",
    "owned-root",
    "arm",
    "intel",
    "cleanup",
    "report",
  ];
  let stage = "unavailable";
  const stdout = typeof error?.stdout === "string" ? error.stdout : "";
  if (Buffer.byteLength(stdout) <= 2048)
    try {
      const value = JSON.parse(stdout);
      exact(value, ["kind", "complete", "stage", "productionLiteralAdmission"]);
      if (
        value.kind === "sorng-mac-nearby-proof-failure" &&
        value.complete === false &&
        value.productionLiteralAdmission === false &&
        stages.includes(value.stage)
      )
        stage = value.stage;
    } catch {
      /* Raw child output is not a diagnostic projection. */
    }
  return {
    kind: "sorng-mac-nearby-proof-carrier",
    complete: false,
    stage,
    exit:
      Number.isSafeInteger(error?.code) &&
      error.code >= 0 &&
      error.code <= 2147483647
        ? error.code
        : null,
    signal: ["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGBUS"].includes(
      error?.signal,
    )
      ? error.signal
      : null,
    productionLiteralAdmission: false,
    productionInputWrites: false,
    nativeAcceptance: false,
    runtimeReady: false,
  };
}
const rootStamp = (info) =>
  [
    info.dev,
    info.ino,
    info.mode,
    info.uid,
    info.gid,
    info.nlink,
    info.mtimeNs,
    info.ctimeNs,
  ]
    .map(String)
    .join(":");
async function outputRoot(output) {
  const info = await fs.lstat(output, { bigint: true });
  assert(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === BigInt(process.getuid()) &&
      (info.mode & 0o777n) === 0o700n &&
      (await fs.realpath(output)) === output,
    "NEARBY_PROOF_OUTPUT",
  );
  return info;
}
export async function main() {
  assert(process.argv.length === 2, "NEARBY_PROOF_ARGUMENTS");
  authority(process.env, process.platform, process.arch);
  const end =
    performance.now() +
    budget(Number(process.env.CEF_MAC_NEARBY_JOB_STARTED_MS), Date.now());
  const rawPython = await held(PYTHON, 13592);
  assert(
    rawPython.length === 13592 &&
      createHash("sha256").update(rawPython).digest("hex") ===
        "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
    "NEARBY_PROOF_PYTHON_PIN",
  );
  const temp = await fs.realpath(process.env.RUNNER_TEMP);
  assert(temp === "/Users/runner/work/_temp", "NEARBY_PROOF_TEMP");
  const output = path.posix.join(
    temp,
    "cef-mac-nearby-owned-proof-" + randomUUID(),
  );
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  await fs.appendFile(process.env.GITHUB_OUTPUT, `root=${output}\n`);
  const remaining = Math.floor(end - performance.now() - 5000);
  assert(remaining >= 15000, "NEARBY_PROOF_DEADLINE");
  let childClosed = false;
  try {
    await executeJoined(
      PYTHON,
      [
        "-I",
        "-B",
        "-S",
        "tests/fixtures/cef/mac_nearby_source_proof.py",
        "--output",
        output,
      ],
      {
        cwd: process.env.GITHUB_WORKSPACE,
        env: childEnvironment(process.env, Date.now() + remaining),
        timeout: Math.floor(end - performance.now() - 1000),
        joinDeadline: end,
        maxBuffer: 65536,
        killSignal: "SIGKILL",
        windowsHide: true,
      },
      (...args) => {
        const child = execFile(...args);
        child.once("close", () => {
          childClosed = true;
        });
        return child;
      },
    );
  } catch (error) {
    const record = childFailure(error);
    if (childClosed)
      try {
        try {
          await fs.mkdir(output, { mode: 0o700 });
        } catch (fault) {
          if (fault.code !== "EEXIST") throw fault;
        }
        await outputRoot(output);
        await fs.writeFile(
          output + "/carrier.json",
          JSON.stringify(record) + "\n",
          {
            flag: "wx",
            mode: 0o600,
          },
        );
      } catch {
        /* Preserve the identical original child failure. */
      }
    console.error(JSON.stringify(record));
    throw error;
  }
  assert(performance.now() < end, "NEARBY_PROOF_DEADLINE");
  const before = await outputRoot(output);
  const directory = await fs.open(
    output,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  let failed = false,
    selected;
  try {
    assert(
      rootStamp(await directory.stat({ bigint: true })) === rootStamp(before),
    );
    assert.deepEqual(await fs.readdir(output), ["proof.json"]);
    const raw = await held(output + "/proof.json", 128 * 1024);
    const report = validateReport(JSON.parse(raw.toString("utf8")));
    assert(
      rootStamp(await outputRoot(output)) === rootStamp(before) &&
        rootStamp(await directory.stat({ bigint: true })) ===
          rootStamp(before) &&
        performance.now() < end,
      "NEARBY_PROOF_CHANGED",
    );
    selected = {
      kind: report.kind,
      complete: true,
      rawProofSha256: createHash("sha256").update(raw).digest("hex"),
      productionLiteralAdmission: false,
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await directory.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
  assert(performance.now() < end, "NEARBY_PROOF_DEADLINE");
  console.log(JSON.stringify(selected));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  try {
    await main();
  } catch {
    console.error("MAC_NEARBY_PROOF_DENIED");
    process.exitCode = 1;
  }
