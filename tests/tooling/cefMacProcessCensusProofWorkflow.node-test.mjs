import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  heldBytes,
  outputPath,
  validateReport,
} from "../fixtures/cef/mac_process_census_carrier.mjs";

function report() {
  const values = {
    schemaVersion: 1,
    kind: "sorng-mac-process-census-proof",
    hostPlatform: "darwin",
    hostArchitecture: "x86_64",
    image: "20260824.0482.1",
    censusWorkerProcesses: 1,
    periodicNativeProbeSpawns: 0,
    requestDeadlineMs: 2000,
    cadenceMs: 250,
    abi: {
      recordBytes: 648,
      pidOffset: 40,
      pidBytes: 4,
      parentOffset: 560,
      parentBytes: 4,
      groupOffset: 564,
      groupBytes: 4,
      secondsOffset: 0,
      secondsBytes: 8,
      microsOffset: 8,
      microsBytes: 4,
      pointerBytes: 8,
      longBytes: 8,
      mib: [1, 14, 0, 0],
    },
  };
  for (const key of [
    "complete",
    "abiConfirmed",
    "canonicalStartTokens",
    "ownedRelationsVerified",
    "reparentedChildRetained",
    "foreignUntouched",
    "cleanupConfirmed",
    "handlesClosed",
    "ownedProcessesRemoved",
    "oracleCompilerUsed",
    "oracleCompilerQuiescent",
    "oracleCompilerJoined",
    "oracleCompilerNaturalExitZero",
  ])
    values[key] = true;
  for (const key of [
    "productionAdmitted",
    "productionInputWrites",
    "nativeAcceptance",
    "runtimeReady",
  ])
    values[key] = false;
  const sample = {
    count: 64,
    p50Micros: 1000,
    p95Micros: 2000,
    maxMicros: 3000,
  };
  values.samples = {
    ps: { ...sample },
    native: { ...sample, collect: { ...sample } },
  };
  return values;
}

test("standalone workflow binds one reviewed Intel image and retains independent reports only", async () => {
  const workflow = YAML.parse(
    await readFile(
      new URL(
        "../../.github/workflows/cef-mac-process-census-proof.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.proof;
  assert.equal(job["runs-on"], "macos-15-intel");
  assert.equal(job["timeout-minutes"], 5);
  assert.match(job.if, /repository_id == '1010282954'/);
  assert.match(job.if, /visibility == 'public'/);
  const prepare = job.steps.find((row) => row.id === "prepare");
  assert.equal(prepare.if, "always()");
  const proof = job.steps.find((row) =>
    row.run?.includes("mac_process_census_proof.mjs --output"),
  );
  assert.equal(proof["timeout-minutes"], 4);
  assert.match(proof.if, /always\(\).*prepare.outcome == 'success'/);
  const upload = job.steps.at(-1);
  assert.equal(upload.if, "always()");
  assert.deepEqual(upload.with.path.trim().split("\n"), [
    "${{ runner.temp }}/cef-mac-census-proof-*/proof.json",
    "${{ runner.temp }}/cef-mac-census-proof-*/checkpoint-compile.stdout.log",
    "${{ runner.temp }}/cef-mac-census-proof-*/checkpoint-compile.stderr.log",
    "${{ runner.temp }}/cef-mac-python-links-proof-*/proof.json",
  ]);
  assert.equal(job.steps[0].with["persist-credentials"], false);
  for (const row of job.steps.filter((row) => row.uses))
    assert.match(row.uses, /@[a-f0-9]{40}$/);
  const text = JSON.stringify(workflow);
  assert.doesNotMatch(
    text,
    /cef-runtime-ci|cef-engineering-checkpoint\.mjs|--execute|source-record|GH_TOKEN|GITHUB_TOKEN|downloadComponent/,
  );
});

test("selector accepts only completed ABI and owned cleanup proof with production closed", () => {
  const good = report();
  assert.equal(validateReport(good), good);
  for (const mutate of [
    (r) => (r.complete = false),
    (r) => (r.productionAdmitted = true),
    (r) => (r.productionInputWrites = true),
    (r) => (r.cleanupConfirmed = false),
    (r) => (r.ownedProcessesRemoved = false),
    (r) => (r.foreignUntouched = false),
    (r) => (r.oracleCompilerQuiescent = false),
    (r) => (r.oracleCompilerJoined = false),
    (r) => (r.oracleCompilerNaturalExitZero = false),
    (r) => (r.image = "other"),
    (r) => (r.abi.pointerBytes = 4),
    (r) => (r.abi.pidOffset = 99999),
    (r) => (r.abi.pidBytes = 8),
    (r) => (r.abi.parentOffset = r.abi.pidOffset),
    (r) => r.abi.mib.push(0),
    (r) => (r.censusWorkerProcesses = 2),
    (r) => (r.periodicNativeProbeSpawns = 1),
    (r) => (r.requestDeadlineMs = 3000),
    (r) => (r.samples.ps.count = 63),
    (r) => (r.samples.native.maxMicros = 2000001),
    (r) => (r.samples.native.collect.p95Micros = 0),
    (r) => (r.owned = [{ pid: 99 }]),
    (r) => (r.privateError = "SECRET"),
  ]) {
    const bad = report();
    mutate(bad);
    assert.throws(() => validateReport(bad));
  }
});

test("output is one absent UUID child of the exact runner temp namespace", () => {
  const temp = "/Users/runner/work/_temp",
    output =
      temp + "/cef-mac-census-proof-11111111-1111-4111-8111-111111111111";
  assert.equal(outputPath(output, temp), output);
  for (const file of [
    output + "/extra",
    output.replace("_temp", "_temp2"),
    output.replace("4111", "1111"),
    temp + "/other",
  ])
    assert.throws(() => outputPath(file, temp));
});

function fileIo({
  alias = false,
  oversized = false,
  drift = false,
  closeFails = false,
} = {}) {
  const raw = Buffer.from("bounded-json"),
    before = {
      dev: 1n,
      ino: 2n,
      mode: 0o100600n,
      nlink: 1n,
      size: BigInt(oversized ? 1000 : raw.length),
      mtimeNs: 3n,
      ctimeNs: 4n,
      uid: 501n,
      gid: 20n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
  let opened = 0,
    closed = 0,
    reads = 0;
  return {
    raw,
    opened: () => opened,
    closed: () => closed,
    io: {
      async lstat() {
        return before;
      },
      async realpath(file) {
        return alias ? "/PRIVATE" : file;
      },
      async open() {
        opened++;
        return {
          async stat() {
            return drift && reads ? { ...before, ino: 99n } : before;
          },
          async read(buffer, offset, length, position) {
            reads++;
            const slice = raw.subarray(position, position + length);
            slice.copy(buffer, offset);
            return { bytesRead: slice.length };
          },
          async close() {
            closed++;
            if (closeFails) throw new Error("PRIVATE_CLOSE");
          },
        };
      },
    },
  };
}

test("report and Python readers reject alias, byte bounds and mutation while closing exact handle", async () => {
  const good = fileIo();
  assert.deepEqual(await heldBytes("/fixed", 64, good.io), good.raw);
  assert.equal(good.closed(), 1);
  for (const [options, message] of [
    [{ alias: true }, /ALIAS/],
    [{ oversized: true }, /CENSUS_FILE/],
    [{ drift: true, closeFails: true }, /CHANGED/],
  ]) {
    const f = fileIo(options);
    await assert.rejects(heldBytes("/fixed", 64, f.io), message);
    assert.equal(f.closed(), f.opened());
  }
});

test("Python bytes and proof contents remain bounded held readers; carrier never spawns a helper", async () => {
  const source = await readFile(
    new URL("../fixtures/cef/mac_process_census_carrier.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /13592/);
  assert.match(
    source,
    /b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d/,
  );
  assert.match(source, /128 \* 1024/);
  assert.match(source, /constants\.O_NOFOLLOW/);
  assert.doesNotMatch(source, /child_process|spawn\(|execFile\(/);
});
