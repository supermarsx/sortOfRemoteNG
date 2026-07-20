import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  isCriticalRuntimeSource,
  measureCoverage,
  normalizeSourcePath,
  parseLcov,
} from "../../scripts/ci/check-backend-coverage.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(
  testDirectory,
  "..",
  "..",
  "scripts",
  "ci",
  "check-backend-coverage.mjs",
);

const withFixture = (contents, callback) => {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "sorng-backend-coverage-"),
  );
  const fixturePath = join(fixtureDirectory, "coverage.lcov");
  try {
    writeFileSync(fixturePath, contents);
    return callback(fixturePath);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
};

const runChecker = (fixturePath, ...arguments_) =>
  spawnSync(process.execPath, [checkerPath, fixturePath, ...arguments_], {
    encoding: "utf8",
  });

test("unions duplicate physical file and line records", () => {
  const report = parseLcov(
    `TN:\nSF:/runner/repo/src-tauri/crates/sorng-commands/src/../../sorng-vpn/src/lib.rs\nDA:10,0\nDA:11,0\nLF:2\nLH:0\nend_of_record\nSF:/runner/repo/src-tauri/crates/sorng-vpn/src/lib.rs\nDA:10,7\nDA:12,2\nLF:2\nLH:2\nend_of_record\n`,
  );
  const measurement = measureCoverage(report);

  assert.equal(report.records, 2);
  assert.equal(report.daEntries, 4);
  assert.equal(report.duplicateDaEntries, 1);
  assert.equal(report.files.size, 1);
  assert.deepEqual(
    {
      found: measurement.found,
      hit: measurement.hit,
      missed: measurement.missed,
    },
    { found: 3, hit: 2, missed: 1 },
  );
});

test("normalizes Windows and Linux LCOV source paths identically", () => {
  const windows = normalizeSourcePath(
    String.raw`C:\agent\repo\src-tauri\crates\sorng-rdp\src\session\..\lib.rs`,
  );
  const linux = normalizeSourcePath(
    "/home/runner/repo/src-tauri/crates/sorng-rdp/src/session/../lib.rs",
  );

  assert.equal(windows, "src-tauri/crates/sorng-rdp/src/lib.rs");
  assert.equal(linux, windows);
  assert.equal(isCriticalRuntimeSource(windows), true);
});

test("CLI passes and fails at the requested physical-line threshold", () => {
  const fixture = `SF:/repo/src-tauri/src/lib.rs\nDA:1,1\nDA:2,0\nend_of_record\nSF:/repo/src-tauri/crates/sorng-example/src/lib.rs\nDA:1,1\nDA:2,0\nend_of_record\n`;

  withFixture(fixture, (fixturePath) => {
    const passing = runChecker(
      fixturePath,
      "--workspace-threshold",
      "50",
      "--critical-threshold",
      "50",
    );
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(
      passing.stdout,
      /Workspace: 50\.00% \(2\/4 lines; 2 missed\), floor 50\.00%/u,
    );
    assert.match(
      passing.stdout,
      /Critical runtime: 50\.00% \(1\/2 lines; 1 missed\)/u,
    );

    const failing = runChecker(
      fixturePath,
      "--workspace-threshold",
      "50.01",
      "--critical-threshold",
      "50",
    );
    assert.equal(failing.status, 1);
    assert.match(
      failing.stderr,
      /workspace: 50\.00% \(2\/4 lines; 2 missed\)/u,
    );
    assert.match(failing.stderr, /Low-coverage summary for workspace/u);
  });
});

test("CLI enforces critical runtime independently of a passing workspace", () => {
  const nonCriticalLines = Array.from(
    { length: 8 },
    (_, index) => `DA:${index + 1},1`,
  ).join("\n");
  const fixture = `SF:/repo/src-tauri/crates/sorng-example/src/lib.rs\n${nonCriticalLines}\nend_of_record\nSF:/repo/src-tauri/crates/sorng-vpn/src/service.rs\nDA:1,0\nDA:2,0\nend_of_record\n`;

  withFixture(fixture, (fixturePath) => {
    const result = runChecker(
      fixturePath,
      "--workspace-threshold",
      "75",
      "--critical-threshold",
      "40",
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /Workspace: 80\.00% \(8\/10 lines; 2 missed\)/u,
    );
    assert.match(
      result.stdout,
      /Critical runtime: 0\.00% \(0\/2 lines; 2 missed\)/u,
    );
    assert.doesNotMatch(result.stderr, /Low-coverage summary for workspace/u);
    assert.match(result.stderr, /Low-coverage summary for critical runtime/u);
    assert.match(
      result.stderr,
      /src-tauri\/crates\/sorng-vpn\/src\/service\.rs/u,
    );
  });
});
