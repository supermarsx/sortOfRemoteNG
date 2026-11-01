// Fixed Intel source-codec scratch proof; never promotes public write admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { authority } from "./mac_python_package_proof.mjs";
import { held, executeJoined } from "./mac_process_census_proof.mjs";

const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const SOURCE =
  "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef";
const STAGES = [
  "arguments",
  "host",
  "image",
  "runner",
  "python-executable",
  "python-pin",
  "temp",
  "output",
  "helper-import",
  "admission",
  "owned-root",
  "capability",
  "public-gates",
  "roundtrip",
  "cleanup",
  "report",
];
function exact(value, keys) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === keys.slice().sort().join(),
    "INTEL_PROOF_SCHEMA",
  );
}
function stats(value) {
  exact(value, [
    "atime_ns",
    "birthtimeNs",
    "birthtimeNsAvailable",
    "ctime_ns",
    "dev",
    "gid",
    "ino",
    "mode",
    "mtime_ns",
    "nlink",
    "size",
    "uid",
  ]);
  for (const key of [
    "atime_ns",
    "ctime_ns",
    "dev",
    "gid",
    "ino",
    "mode",
    "mtime_ns",
    "nlink",
    "size",
    "uid",
  ])
    assert(
      typeof value[key] === "string" &&
        /^(?:0|[1-9][0-9]{0,23})$/.test(value[key]),
      "INTEL_PROOF_STAT",
    );
  assert(
    typeof value.birthtimeNsAvailable === "boolean" &&
      (value.birthtimeNsAvailable
        ? typeof value.birthtimeNs === "string" &&
          /^(?:0|[1-9][0-9]{0,18})$/.test(value.birthtimeNs)
        : value.birthtimeNs === null),
    "INTEL_PROOF_BIRTH",
  );
}
export function intelBudget(started, now) {
  assert(
    Number.isSafeInteger(started) &&
      Number.isSafeInteger(now) &&
      started > 0 &&
      now >= started,
    "INTEL_PROOF_CLOCK",
  );
  const total = Math.min(100000, started + 300000 - now - 30000);
  assert(total >= 15000, "INTEL_PROOF_DEADLINE");
  return total;
}
export function childEnvironment(env) {
  return {
    PATH: "/usr/bin:/bin",
    RUNNER_TEMP: env.RUNNER_TEMP,
    GITHUB_WORKSPACE: env.GITHUB_WORKSPACE,
    CEF_MAC_PACKAGE_JOB_STARTED_MS: env.CEF_MAC_PACKAGE_JOB_STARTED_MS,
    ImageOS: env.ImageOS,
    ImageVersion: env.ImageVersion,
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY_VISIBILITY: "public",
    ...(env.RUNNER_TRACKING_ID
      ? { RUNNER_TRACKING_ID: env.RUNNER_TRACKING_ID }
      : {}),
  };
}
export function childFailure(error) {
  try {
    assert(
      typeof error.stdout === "string" &&
        Buffer.byteLength(error.stdout) <= 2048,
    );
    const value = JSON.parse(error.stdout);
    assert(
      Object.keys(value).sort().join() ===
        "complete,failure,kind,sourceWriteAdmitted,stage" &&
        value.kind === "sorng-macintel-owned-source-preflight" &&
        value.complete === false &&
        value.failure === "OWNED_INTEL_SOURCE_PROOF_DENIED" &&
        value.sourceWriteAdmitted === false &&
        STAGES.includes(value.stage),
    );
    return value;
  } catch {
    return {
      kind: "sorng-macintel-owned-source-carrier",
      complete: false,
      failure: "OWNED_INTEL_PROOF_CHILD_FAILED",
      sourceWriteAdmitted: false,
    };
  }
}
export function validateReport(report) {
  assert(
    Object.keys(report).sort().join() ===
      [
        "schemaVersion",
        "kind",
        "complete",
        "hostPlatform",
        "hostArchitecture",
        "targetArchitecture",
        "image",
        "sourceLockReference",
        "sourceWriteAdmitted",
        "productionInputWrites",
        "publicIntelAdmissionDeniedBefore",
        "publicIntelAdmissionDeniedAfter",
        "nativeAcceptance",
        "runtimeReady",
        "failure",
        "capability",
        "roundtrip",
        "cleanupConfirmed",
      ]
        .sort()
        .join(),
    "INTEL_PROOF_SCHEMA",
  );
  assert(
    report.schemaVersion === 1 &&
      report.kind === "sorng-macintel-owned-source-proof" &&
      report.hostPlatform === "darwin" &&
      report.hostArchitecture === "x86_64" &&
      report.targetArchitecture === "x64" &&
      report.image === "20260824.0482.1" &&
      report.sourceLockReference === SOURCE &&
      report.failure === null,
    "INTEL_PROOF_IDENTITY",
  );
  for (const key of [
    "complete",
    "cleanupConfirmed",
    "publicIntelAdmissionDeniedBefore",
    "publicIntelAdmissionDeniedAfter",
  ])
    assert(report[key] === true, "INTEL_PROOF_INCOMPLETE");
  for (const key of [
    "sourceWriteAdmitted",
    "productionInputWrites",
    "nativeAcceptance",
    "runtimeReady",
  ])
    assert(report[key] === false, "INTEL_PROOF_ADMISSION");
  const cap = report.capability;
  exact(cap, [
    "schemaVersion",
    "kind",
    "target",
    "source",
    "complete",
    "rows",
    "cleanupConfirmed",
    "objectsRemoved",
    "handlesClosed",
    "sourceWriteAdmitted",
    "error",
    "installedInputsWritten",
    "nativeAcceptance",
    "runtimeReady",
  ]);
  assert(
    cap?.schemaVersion === 1 &&
      cap.error === null &&
      cap.kind === "sorng-macintel-owned-capability-observation" &&
      cap.target === "x86_64-apple-darwin" &&
      cap.source === SOURCE &&
      cap.complete === true &&
      cap.cleanupConfirmed === true &&
      cap.objectsRemoved === true &&
      cap.handlesClosed === true &&
      cap.installedInputsWritten === false &&
      cap.sourceWriteAdmitted === false &&
      cap.nativeAcceptance === false &&
      cap.runtimeReady === false &&
      Array.isArray(cap.rows) &&
      cap.rows.length === 12,
    "INTEL_PROOF_CAPABILITY",
  );
  const cases = new Set();
  for (const row of cap.rows) {
    exact(row, [
      "role",
      "case",
      "requestedMtimeNs",
      "before",
      "after",
      "heldBefore",
      "heldAfter",
      "exactMtimeReadback",
      "symlinkTargetUnchanged",
      "birthTransition",
    ]);
    assert(
      ["file", "directory", "root", "symlink"].includes(row.role) &&
        ["no-op", "past", "future"].includes(row.case) &&
        row.exactMtimeReadback === true &&
        row.symlinkTargetUnchanged === true,
      "INTEL_PROOF_TIMESTAMP",
    );
    const birth = row.birthTransition;
    exact(birth, ["kind", "before", "after", "changed"]);
    const token = (v) =>
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[1] === "string" &&
      v[1].length <= 64 &&
      (v[0] === "birthtime-ns"
        ? /^(?:0|[1-9][0-9]{0,18})$/.test(v[1])
        : v[0] === "darwin-birthtime-float-hex" &&
          /^0x[0-9a-f]+\.[0-9a-f]+p[+-][0-9]{1,3}$/.test(v[1]));
    assert(
      birth?.kind === "owned-utime-birth-observation" &&
        token(birth.before) &&
        token(birth.after) &&
        birth.changed ===
          (JSON.stringify(birth.before) !== JSON.stringify(birth.after)),
      "INTEL_PROOF_BIRTH",
    );
    stats(row.before);
    stats(row.after);
    assert(
      row.after.mtime_ns === row.requestedMtimeNs,
      "INTEL_PROOF_TIMESTAMP",
    );
    if (row.role === "symlink")
      assert(
        row.heldBefore === null && row.heldAfter === null,
        "INTEL_PROOF_STAT",
      );
    else {
      stats(row.heldBefore);
      stats(row.heldAfter);
      assert(
        row.heldAfter.mtime_ns === row.requestedMtimeNs,
        "INTEL_PROOF_TIMESTAMP",
      );
    }
    cases.add(row.role + ":" + row.case);
  }
  assert(cases.size === 12, "INTEL_PROOF_CASES");
  const trip = report.roundtrip;
  exact(trip, [
    "complete",
    "recorded",
    "recreatedInode",
    "corruptBytesDeniedBeforeUtime",
    "driftDetected",
    "applied",
    "verified",
    "sidecarKind",
    "sidecarUnchanged",
    "noLinuxStatCache",
    "identityKind",
    "birthIdentityPortable",
    "entries",
    "cleanupConfirmed",
  ]);
  assert(
    trip?.sidecarKind === "sorng-macintel-source-metadata" &&
      trip.identityKind === "synthetic-owned-intel-proof" &&
      trip.birthIdentityPortable === false &&
      Number.isSafeInteger(trip.entries) &&
      trip.entries > 0 &&
      trip.entries <= 100,
    "INTEL_PROOF_ROUNDTRIP",
  );
  for (const key of [
    "complete",
    "recorded",
    "recreatedInode",
    "corruptBytesDeniedBeforeUtime",
    "driftDetected",
    "applied",
    "verified",
    "sidecarUnchanged",
    "noLinuxStatCache",
    "cleanupConfirmed",
  ])
    assert(trip[key] === true, "INTEL_PROOF_ROUNDTRIP");
}
export async function main() {
  authority(process.env, process.platform, process.arch);
  assert(process.argv.length === 2, "INTEL_PROOF_ARGUMENTS");
  const end =
    performance.now() +
    intelBudget(Number(process.env.CEF_MAC_PACKAGE_JOB_STARTED_MS), Date.now());
  const python = await held(PYTHON, 13592);
  assert(
    python.length === 13592 &&
      createHash("sha256").update(python).digest("hex") ===
        "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
    "INTEL_PROOF_PYTHON_PIN",
  );
  const temp = await fs.realpath(process.env.RUNNER_TEMP);
  assert(temp === "/Users/runner/work/_temp", "INTEL_PROOF_TEMP");
  const output = path.posix.join(
    temp,
    "cef-mac-intel-owned-proof-" + randomUUID(),
  );
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  assert(performance.now() < end - 15000, "INTEL_PROOF_DEADLINE");
  await fs.appendFile(process.env.GITHUB_OUTPUT, `root=${output}\n`);
  let childClosed = false;
  try {
    await executeJoined(
      PYTHON,
      [
        "-I",
        "-B",
        "-S",
        "tests/fixtures/cef/mac_intel_owned_source_proof.py",
        "--output",
        output,
      ],
      {
        cwd: process.env.GITHUB_WORKSPACE,
        env: childEnvironment(process.env),
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
    console.error(JSON.stringify(record));
    // Only the namespace proven absent before our leaf child may receive this
    // fixed diagnostic after the child has closed; no raw child output retained.
    if (childClosed)
      try {
        try {
          await fs.mkdir(output, { mode: 0o700 });
        } catch (fault) {
          if (fault.code !== "EEXIST") throw fault;
        }
        const info = await fs.lstat(output);
        assert(
          info.isDirectory() &&
            !info.isSymbolicLink() &&
            info.uid === process.getuid() &&
            (info.mode & 0o777) === 0o700 &&
            (await fs.realpath(output)) === output,
          "INTEL_PROOF_OUTPUT",
        );
        await fs.writeFile(
          output + "/carrier.json",
          JSON.stringify(record) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      } catch {
        /* Preserve the exact child failure, including unconfirmed cleanup. */
      }
    throw error;
  }
  assert(performance.now() < end, "INTEL_PROOF_DEADLINE");
  const report = JSON.parse(
    (await held(output + "/proof.json", 128 * 1024)).toString("utf8"),
  );
  validateReport(report);
  assert(performance.now() < end, "INTEL_PROOF_DEADLINE");
  console.log("OWNED_INTEL_SOURCE_PROOF_COMPLETE");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.error("OWNED_INTEL_SOURCE_PROOF_FAILED");
    process.exitCode = 1;
  }
}
