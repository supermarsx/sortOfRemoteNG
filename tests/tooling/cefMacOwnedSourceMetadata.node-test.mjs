import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const python = process.platform === "win32" ? "python" : "python3";

test("Mac ARM codec routing, identity, cancellation and bounds regressions use the actual helper", () => {
  const result = spawnSync(
    python,
    ["-I", "-B", "tests/fixtures/cef/mac_owned_source_metadata_test.py"],
    {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 19 tests/);
  assert.match(result.stderr, /\bOK\b/);
});

test("closed native proof rejects unknown arguments without disclosing raw failures", () => {
  const result = spawnSync(
    python,
    [
      "-I",
      "-B",
      "tests/fixtures/cef/mac_owned_source_proof.py",
      "--unexpected",
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 4096, windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    kind: "sorng-macarm-owned-source-preflight",
    complete: false,
    stage: "arguments",
    failure: "OWNED_SOURCE_PROOF_DENIED",
    sourceWriteAdmitted: false,
  });
  assert(result.stdout.length <= 2048);
  assert.equal(result.stderr, "");
});
