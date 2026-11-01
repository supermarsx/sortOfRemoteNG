import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  intelBudget,
  childEnvironment,
  childFailure,
  validateReport,
} from "../fixtures/cef/mac_intel_owned_source_carrier.mjs";
const SOURCE =
  "684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef";
const python = process.platform === "win32" ? "python" : "python3";
function report() {
  const stat = {
    atime_ns: "1",
    birthtimeNs: null,
    birthtimeNsAvailable: false,
    ctime_ns: "2",
    dev: "3",
    gid: "20",
    ino: "4",
    mode: "33152",
    mtime_ns: "5",
    nlink: "1",
    size: "6",
    uid: "501",
  };
  const rows = [];
  for (const role of ["file", "directory", "root", "symlink"])
    for (const sample of ["no-op", "past", "future"]) {
      rows.push({
        role,
        case: sample,
        requestedMtimeNs: "5",
        before: { ...stat },
        after: { ...stat },
        heldBefore: role === "symlink" ? null : { ...stat },
        heldAfter: role === "symlink" ? null : { ...stat },
        exactMtimeReadback: true,
        symlinkTargetUnchanged: true,
        birthTransition: {
          kind: "owned-utime-birth-observation",
          before: ["darwin-birthtime-float-hex", "0x1.0p+30"],
          after: ["darwin-birthtime-float-hex", "0x1.0p+30"],
          changed: false,
        },
      });
    }
  return {
    schemaVersion: 1,
    kind: "sorng-macintel-owned-source-proof",
    complete: true,
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    targetArchitecture: "x64",
    image: "20260824.0482.1",
    sourceLockReference: SOURCE,
    sourceWriteAdmitted: false,
    productionInputWrites: false,
    publicOutOfScopeDeniedBefore: true,
    publicOutOfScopeDeniedAfter: true,
    scopedSourceWritesSupported: true,
    scopedSourcePolicy:
      "sorng-macintel-owned-source-metadata-intel-20260824-v1",
    nativeAcceptance: false,
    runtimeReady: false,
    failure: null,
    failureCode: null,
    proofWriterClosed: true,
    proofWriterCapabilityRetired: true,
    cleanupConfirmed: true,
    capability: {
      schemaVersion: 1,
      kind: "sorng-macintel-owned-capability-observation",
      target: "x86_64-apple-darwin",
      source: SOURCE,
      complete: true,
      rows,
      cleanupConfirmed: true,
      objectsRemoved: true,
      handlesClosed: true,
      sourceWriteAdmitted: false,
      error: null,
      installedInputsWritten: false,
      nativeAcceptance: false,
      runtimeReady: false,
    },
    roundtrip: {
      complete: true,
      recorded: true,
      recreatedInode: true,
      corruptBytesDeniedBeforeUtime: true,
      driftDetected: true,
      applied: true,
      verified: true,
      sidecarKind: "sorng-macintel-source-metadata",
      sidecarUnchanged: true,
      noLinuxStatCache: true,
      identityKind: "synthetic-owned-intel-proof",
      birthIdentityPortable: false,
      entries: 13,
      cleanupConfirmed: true,
    },
  };
}
test("actual Intel codec regressions preserve scoped public admission and full owned identity/hash guards", () => {
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "-S",
      "tests/fixtures/cef/mac_intel_owned_source_metadata_test.py",
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 16 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
test("fixed Intel entry denies unknown arguments without raw path, argument or exception", () => {
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "-S",
      "tests/fixtures/cef/mac_intel_owned_source_proof.py",
      "--PRIVATE_TOKEN",
    ],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    kind: "sorng-macintel-owned-source-preflight",
    complete: false,
    stage: "arguments",
    failure: "OWNED_INTEL_SOURCE_PROOF_DENIED",
    sourceWriteAdmitted: false,
  });
  assert.equal(result.stderr, "");
});
test("Intel proof gets one remaining100s lease inside original300s with30s reporting reserve", () => {
  assert.equal(intelBudget(1000, 1000), 100000);
  assert.equal(intelBudget(1000, 251000), 20000);
  for (const [start, now] of [
    [1000, 257000],
    [1000, 999],
    [0, 1000],
    [1000, Infinity],
  ])
    assert.throws(() => intelBudget(start, now));
});
test("Intel proof child receives only closed host/job facts and optional runner tracking", () => {
  const env = childEnvironment({
    RUNNER_TEMP: "/temp",
    GITHUB_WORKSPACE: "/checkout",
    CEF_MAC_PACKAGE_JOB_STARTED_MS: "1",
    ImageOS: "macos15",
    ImageVersion: "20260824.0482.1",
    RUNNER_TRACKING_ID: "tracking",
    GH_TOKEN: "PRIVATE",
    PYTHONPATH: "PRIVATE",
    NODE_OPTIONS: "PRIVATE",
  });
  assert.equal(env.RUNNER_TRACKING_ID, "tracking");
  assert.equal(env.CEF_MAC_PACKAGE_JOB_STARTED_MS, "1");
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert(!JSON.stringify(env).includes("PRIVATE"));
});
test("Intel selector requires exact scope,12unique kernel cases,recreatedinode,prewritecorruption denial and allcleanup", () => {
  validateReport(report());
  for (const change of [
    (v) => (v.sourceWriteAdmitted = true),
    (v) => (v.productionInputWrites = true),
    (v) => (v.sourceLockReference = "0".repeat(64)),
    (v) => (v.hostArchitecture = "arm64"),
    (v) => (v.image = "latest"),
    (v) => (v.publicOutOfScopeDeniedAfter = false),
    (v) => (v.scopedSourceWritesSupported = false),
    (v) => (v.scopedSourcePolicy = "unreviewed"),
    (v) => (v.proofWriterClosed = false),
    (v) => (v.proofWriterCapabilityRetired = false),
    (v) => (v.failureCode = "PRIVATE"),
    (v) => (v.roundtrip.recreatedInode = false),
    (v) => (v.roundtrip.corruptBytesDeniedBeforeUtime = false),
    (v) => (v.roundtrip.sidecarKind = "sorng-macarm-source-metadata"),
    (v) => (v.roundtrip.birthIdentityPortable = true),
    (v) => (v.roundtrip.sidecarUnchanged = false),
    (v) => (v.capability.handlesClosed = false),
    (v) => (v.capability.rows[0] = v.capability.rows[1]),
    (v) => (v.capability.rows[0].heldAfter.mtime_ns = "PRIVATE"),
    (v) =>
      (v.capability.rows[0].birthTransition.after = [
        "birthtime-ns",
        "made-up",
      ]),
    (v) => (v.capability.rows[0].birthTransition.changed = true),
    (v) => (v.capability.private = "PRIVATE"),
    (v) => (v.roundtrip.private = "PRIVATE"),
    (v) => (v.private = "PRIVATE"),
  ]) {
    const value = report();
    change(value);
    assert.throws(() => validateReport(value));
  }
});
test("Intel failure projection preserves only bounded closed stages and never raw child errors", () => {
  const value = {
    kind: "sorng-macintel-owned-source-preflight",
    complete: false,
    stage: "roundtrip",
    failure: "OWNED_INTEL_SOURCE_PROOF_DENIED",
    sourceWriteAdmitted: false,
  };
  assert.deepEqual(childFailure({ stdout: JSON.stringify(value) }), value);
  for (const stdout of [
    "PRIVATE_TOKEN",
    JSON.stringify({ ...value, private: "PRIVATE" }),
    JSON.stringify({ ...value, stage: "PRIVATE" }),
    "x".repeat(2049),
  ])
    assert(
      !JSON.stringify(
        childFailure({ stdout, stderr: "PRIVATE", message: "PRIVATE" }),
      ).includes("PRIVATE"),
    );
});
test("workflow retains an independent Intel proof under unchangedwholejobclock andfixedjoined leaf", async () => {
  const workflow = YAML.parse(
    await readFile(".github/workflows/cef-mac-owned-source-proof.yml", "utf8"),
  );
  const job = workflow.jobs.proof;
  assert.equal(job["timeout-minutes"], 5);
  assert.equal(job["runs-on"], "macos-15-intel");
  const step = job.steps.find((s) => s.id === "intel");
  assert.equal(step["timeout-minutes"], 2);
  assert.equal(
    step.run,
    "node tests/fixtures/cef/mac_intel_owned_source_carrier.mjs",
  );
  assert.equal(
    step.if,
    "always() && steps.checkout.outcome == 'success' && steps.node.outcome == 'success'",
  );
  assert.equal(
    job.steps.filter((s) => s.uses?.startsWith("actions/setup-node@")).length,
    1,
  );
  const upload = job.steps.find((s) =>
    s.with?.name?.startsWith("cef-mac-intel-owned-source-proof-"),
  );
  assert.equal(upload.if, "always() && steps.intel.outputs.root != ''");
  assert.equal(
    upload.with.path.trim(),
    "${{ steps.intel.outputs.root }}/proof.json\n${{ steps.intel.outputs.root }}/carrier.json",
  );
  const carrier = await readFile(
    "tests/fixtures/cef/mac_intel_owned_source_carrier.mjs",
    "utf8",
  );
  assert.match(
    carrier,
    /executeJoined\(\s*PYTHON,\s*\[\s*"-I",\s*"-B",\s*"-S"/,
  );
  assert.match(carrier, /joinDeadline:\s*end/);
  assert.match(carrier, /if\s*\(childClosed\)/);
  assert(!carrier.includes("...process.env"));
});
