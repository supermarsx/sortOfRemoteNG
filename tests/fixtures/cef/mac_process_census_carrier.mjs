// Strict control and report selection for a proof; never production admission.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { authority } from "./mac_python_links_proof.mjs";

const PYTHON =
  "/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const fields = [
  "dev",
  "ino",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
  "uid",
  "gid",
];
const stamp = (info) => fields.map((key) => String(info[key])).join(":");
const exact = (value, keys) =>
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === [...keys].sort().join("|"),
    "CENSUS_REPORT_KEYS",
  );
const integer = (value, low, high) =>
  Number.isSafeInteger(value) && value >= low && value <= high;
export async function heldBytes(file, maximum, io = fs) {
  const before = await io.lstat(file, { bigint: true });
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(maximum),
    "CENSUS_FILE",
  );
  assert((await io.realpath(file)) === file, "CENSUS_FILE_ALIAS");
  const handle = await io.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let failed = false;
  try {
    assert(
      stamp(await handle.stat({ bigint: true })) === stamp(before),
      "CENSUS_FILE_IDENTITY",
    );
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    assert(
      count === Number(before.size) && count <= maximum,
      "CENSUS_FILE_BYTES",
    );
    assert(
      stamp(await handle.stat({ bigint: true })) === stamp(before) &&
        stamp(await io.lstat(file, { bigint: true })) === stamp(before),
      "CENSUS_FILE_CHANGED",
    );
    return buffer.subarray(0, count);
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
}
export function validateReport(report) {
  const truths = [
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
  ];
  const falses = [
    "productionAdmitted",
    "productionInputWrites",
    "nativeAcceptance",
    "runtimeReady",
  ];
  exact(report, [
    "schemaVersion",
    "kind",
    "hostPlatform",
    "hostArchitecture",
    "image",
    "abi",
    "samples",
    "censusWorkerProcesses",
    "periodicNativeProbeSpawns",
    "requestDeadlineMs",
    "cadenceMs",
    ...truths,
    ...falses,
  ]);
  assert(
    report.schemaVersion === 1 &&
      report.kind === "sorng-mac-process-census-proof",
    "CENSUS_REPORT_KIND",
  );
  assert(
    report.hostPlatform === "darwin" &&
      report.hostArchitecture === "x86_64" &&
      report.image === "20260824.0482.1",
    "CENSUS_REPORT_HOST",
  );
  for (const key of truths)
    assert(report[key] === true, "CENSUS_REPORT_INCOMPLETE");
  for (const key of falses)
    assert(report[key] === false, "CENSUS_REPORT_ADMISSION");
  assert(
    report.censusWorkerProcesses === 1 &&
      report.periodicNativeProbeSpawns === 0 &&
      report.requestDeadlineMs === 2000 &&
      report.cadenceMs === 250,
    "CENSUS_REPORT_BOUNDS",
  );
  const names = ["pid", "parent", "group", "seconds", "micros"];
  const abi = report.abi;
  exact(abi, [
    "recordBytes",
    "pointerBytes",
    "longBytes",
    "mib",
    ...names.flatMap((name) => [name + "Offset", name + "Bytes"]),
  ]);
  assert(
    integer(abi.recordBytes, 128, 1024) &&
      abi.pointerBytes === 8 &&
      abi.longBytes === 8,
    "CENSUS_REPORT_ABI",
  );
  assert(
    Array.isArray(abi.mib) &&
      abi.mib.length === 4 &&
      abi.mib.every((v) => integer(v, 0, 1024)) &&
      abi.mib.at(-1) === 0,
    "CENSUS_REPORT_ABI",
  );
  const used = new Set();
  for (const name of names) {
    const start = abi[name + "Offset"],
      size = abi[name + "Bytes"];
    assert(
      integer(start, 0, abi.recordBytes) &&
        [4, 8].includes(size) &&
        (!["pid", "parent", "group"].includes(name) || size === 4) &&
        start + size <= abi.recordBytes,
      "CENSUS_REPORT_ABI",
    );
    for (let byte = start; byte < start + size; byte++) {
      assert(!used.has(byte), "CENSUS_REPORT_ABI");
      used.add(byte);
    }
  }
  const sample = (row) => {
    exact(row, ["count", "p50Micros", "p95Micros", "maxMicros"]);
    assert(
      row.count === 64 &&
        integer(row.p50Micros, 0, 2000000) &&
        integer(row.p95Micros, row.p50Micros, 2000000) &&
        integer(row.maxMicros, row.p95Micros, 2000000),
      "CENSUS_REPORT_SAMPLES",
    );
  };
  exact(report.samples, ["ps", "native"]);
  sample(report.samples.ps);
  exact(report.samples.native, [
    "count",
    "p50Micros",
    "p95Micros",
    "maxMicros",
    "collect",
  ]);
  const { collect, ...native } = report.samples.native;
  sample(native);
  sample(collect);
  return report;
}
export function outputPath(file, temp) {
  assert(
    temp === "/Users/runner/work/_temp" &&
      path.posix.dirname(file) === temp &&
      /^cef-mac-census-proof-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        path.posix.basename(file),
      ),
    "CENSUS_OUTPUT",
  );
  return file;
}
export async function main() {
  authority(process.env, process.platform, process.arch);
  assert(
    process.argv.length === 3 &&
      ["prepare", "validate"].includes(process.argv[2]),
    "CENSUS_CARRIER_ARGUMENTS",
  );
  const temp = await fs.realpath(process.env.RUNNER_TEMP);
  assert(temp === "/Users/runner/work/_temp", "CENSUS_TEMP");
  if (process.argv[2] === "prepare") {
    const python = await heldBytes(PYTHON, 13592);
    assert(
      python.length === 13592 &&
        createHash("sha256").update(python).digest("hex") ===
          "b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d",
      "CENSUS_PYTHON_PIN",
    );
    const output = outputPath(
      path.posix.join(temp, "cef-mac-census-proof-" + randomUUID()),
      temp,
    );
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
    await fs.appendFile(process.env.GITHUB_OUTPUT, `output=${output}\n`);
  } else {
    const output = outputPath(process.env.CEF_CENSUS_OUTPUT, temp);
    const directory = await fs.lstat(output, { bigint: true });
    assert(
      directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        directory.uid === BigInt(process.getuid()) &&
        (directory.mode & 0o777n) === 0o700n &&
        (await fs.realpath(output)) === output,
      "CENSUS_REPORT_DIRECTORY",
    );
    const report = validateReport(
      JSON.parse(
        (
          await heldBytes(path.posix.join(output, "proof.json"), 128 * 1024)
        ).toString("utf8"),
      ),
    );
    const after = await fs.lstat(output, { bigint: true });
    assert(
      after.isDirectory() &&
        !after.isSymbolicLink() &&
        after.dev === directory.dev &&
        after.ino === directory.ino &&
        after.uid === directory.uid &&
        (await fs.realpath(output)) === output,
      "CENSUS_REPORT_DIRECTORY_CHANGED",
    );
    console.log(
      JSON.stringify({
        kind: report.kind,
        complete: true,
        abiConfirmed: true,
        samples: report.samples,
        productionAdmitted: false,
        nativeAcceptance: false,
        runtimeReady: false,
      }),
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.error("MAC_CENSUS_CARRIER_FAILED");
    process.exitCode = 1;
  }
}
