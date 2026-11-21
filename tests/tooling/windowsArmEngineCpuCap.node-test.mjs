import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { withoutHooksBudget } from "./helpers/cefWindowsEngineHostHistory.mjs";

// The hosted windows-11-arm runner has 4 cores; the engine Job was hard-capped at
// 25 % (one core), so the Chromium compile and the checkpoint-seal hashing ran on
// one core. The engine roles now run at 75 % (three cores) and leave one core for
// the runner agent, the telemetry sampler and the watchdog. The source stages keep
// 25 %. The compile must still end before the seal reserve.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dir = "native/windows-arm-full-sdk/";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = async (leaf) =>
  (await fs.readFile(path.join(root, dir, leaf), "utf8")).replaceAll(
    "\r\n",
    "\n",
  );

test("engine Job CPU cap is 7500 end to end and the source stages keep 2500", async () => {
  const engine = await read("full_sdk_engine.py");
  assert.match(engine, /^ENGINE_CPU_RATE = 7500$/m);
  assert.match(engine, /'cpuRate': ENGINE_CPU_RATE\}/);
  assert.match(engine, /cpuRate=ENGINE_CPU_RATE, inheritedHandles=3/);
  assert.doesNotMatch(engine, /cpuRate=2500|'cpuRate': 2500/);
  const worker = await read("full-sdk-engine-worker.mjs");
  assert.match(worker, /cpuFlags: 5,\n {4}cpuRate: 7500,/);
  const checkpoint = await read("compiled_checkpoint.py");
  assert.match(
    checkpoint,
    /cpuRate=2500 if output_cap == 131072 else 7500, inheritedHandles=3/,
  );
  // The shared Job kernel applies the policy it reads back, never a literal.
  const job = await read("job.py");
  assert.match(
    job,
    /cpu = CpuRate\(1 \| 4, policy\['cpuRate'\] if _test_fault != "policy" else 10001\)/,
  );
  assert.doesNotMatch(job, /CpuRate\(1 \| 4, 2500/);
  assert.match(job, /cpu\.rate!=policy\['cpuRate'\]/);
  // Source and data policies are untouched.
  for (const leaf of ["producer.py", "full_sdk_source.py"])
    assert.match(await read(leaf), /'cpuRate': 2500\}/);
  // The controller proves each Job receipt against its role rate: source stages
  // 2500 (the default), the engine roles 7500.
  const control = await read("full_sdk_control.mjs");
  assert.match(
    control,
    /function inspectJob\(record, large, cpuRate = 2500\) \{/,
  );
  assert.match(control, /p\.cpuRate === cpuRate &&/);
  assert.match(control, /inspectJob\(jobRecord, true, 7500\);/);
});

test("checkpoint seal reserve keeps the seal inside the original lease with margin", async () => {
  const control = await read("full_sdk_control.mjs");
  const match = /const reserve = role === "cef-engine" \? (\d+) : 150000,/.exec(
    control,
  );
  assert.ok(match);
  const reserveMs = Number(match[1]);
  assert.equal(reserveMs, 4800000);
  // Measured seal (run 44853666176): 4146 s of Job time, 4429 s from the compile
  // end to the seal finishing; with a 75 min reserve it ended 79 s past the lease
  // deadline. Keep at least 3 min of margin over that.
  const sealFromCompileEndMinutes = 74;
  assert.ok(reserveMs / 60000 - 2.5 - sealFromCompileEndMinutes >= 3);
  // The controller still requires the compile end to respect the older bound.
  assert.ok(reserveMs >= 3600000);
  // A fresh run reaches the compile after about 140 min (73 min acquisition +
  // 62 min hooks/GN + probes) and a continuation after about 80 min; the window
  // up to the reserve is large enough for the 120 / 150 min compile caps.
  const job = 360;
  assert.ok(job - reserveMs / 60000 - 140 >= 120);
  assert.ok(job - reserveMs / 60000 - 100 >= 150);
});

test("engine CPU cap history layers invert every changed file exactly", async () => {
  const specs = JSON.parse(
    await fs.readFile(
      path.join(root, "tests/fixtures/cef/windows_hooks_budget_inverse.json"),
      "utf8",
    ),
  );
  for (const leaf of [
    "checkpoint_inputs.py",
    "compiled_checkpoint.py",
    "full_sdk_control.mjs",
    "full_sdk_engine.py",
    "full-sdk-engine-worker.mjs",
    "job.py",
    "sdk-origin-review.json",
  ]) {
    const file = dir + leaf,
      current = await read(leaf),
      spec = specs[file];
    assert.ok(spec, file);
    assert.equal(sha(current), spec.sha256, file);
    const previous = withoutHooksBudget(current, file);
    assert.notEqual(previous, current, file);
    assert.equal(sha(previous), spec.beforeSha256, file);
    assert.equal(Buffer.byteLength(previous), spec.beforeBytes, file);
    assert.equal(withoutHooksBudget(current + "\n", file), current + "\n");
  }
  const review = JSON.parse(await read("sdk-origin-review.json"));
  for (const row of review.producerInputs) {
    if (!row.path.startsWith(dir) || row.path.endsWith("node-test.mjs"))
      continue;
    const raw = await fs.readFile(path.join(root, row.path));
    const text = raw.toString("utf8").replaceAll("\r\n", "\n");
    // Every pinned producer input equals its pin (modeled rows are refreshed elsewhere).
    if (row.path.endsWith("test_full_sdk_source.py")) continue;
    assert.equal(sha(Buffer.from(text)), row.sha256, row.path);
  }
});
