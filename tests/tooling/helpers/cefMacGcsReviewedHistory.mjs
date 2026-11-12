import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { withoutWindowsImageRows } from "./cefWindowsImageProducerRows.mjs";
import { beforeCensusRowsForHistory } from "./cefCensusRetirementReviewedHistory.mjs";

// Test-only whole-file inverse. This never changes runtime admission or a capsule.
const sha = (text) => createHash("sha256").update(text).digest("hex");
const blob = (text) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
const INSERTION =
  '  // Fixed bookkeeping preparation precedes CEF/GN and every source snapshot.\n  // It never runs inside source verification or grants old checkpoint reuse.\n  if (\n    engineering?.sourceMetadata === "mac-intel" ||\n    engineering?.sourceMetadata === "mac-arm"\n  ) {\n    if (\n      !budget ||\n      (engineering.sourceMetadata === "mac-intel"\n        ? target !== "x86_64-apple-darwin"\n        : target !== "aarch64-apple-darwin")\n    )\n      fail("Mac bookkeeping preparation requires its exact hosted target");\n    budget.assertRemaining();\n    const deadline =\n      Date.now() + Math.min(5000, Math.floor(budget.remaining()));\n    await observePreparationPhase(logs, "mac-gcs-preparation", () =>\n      call(\n        python,\n        [\n          "-I",\n          "-B",\n          path.join(checkout, "scripts/lib/cef-mac-gcs-normalize.py"),\n          target,\n          source,\n          String(deadline),\n        ],\n        "mac-gcs-preparation",\n        source,\n      ),\n    );\n  }\n';
const PHASES_BEFORE =
  'const PREPARATION_PHASES = new Set(["environment", "metal", "external-inputs"]);\n';
const PHASES_AFTER =
  'const PREPARATION_PHASES = new Set([\n  "environment",\n  "metal",\n  "external-inputs",\n  "mac-gcs-preparation",\n]);\n';
export function withoutMacGcsPreparationRuntime(text) {
  assert.equal(Buffer.byteLength(text), 79231);
  assert.equal(
    sha(text),
    "ca058c1f0b5cf34c6f12ddf97cb48067ab40cfeded73dca43c1ae179f4b200c5",
  );
  assert.equal(text.split(INSERTION).length, 2);
  assert.equal(text.split(PHASES_AFTER).length, 2);
  const previous = text
    .replace(INSERTION, "")
    .replace(PHASES_AFTER, PHASES_BEFORE);
  assert.equal(Buffer.byteLength(previous), 78215);
  assert.equal(
    sha(previous),
    "1bb87be232f4c31256a920a999abf629c698e1933e5ec241a5deaa4b998b7e1e",
  );
  return previous;
}

// Prove all132 actual producer rows first; remove only the two whole-pinned Mac
// preparation deltas to recover the unchanged131-row historical producer.
export function withoutMacGcsPreparationRows(rows, root) {
  rows = beforeCensusRowsForHistory(rows, root);
  rows = withoutWindowsImageRows(rows, root);
  const runtimePath = "scripts/cef-runtime-ci.mjs";
  const helperPath = "scripts/lib/cef-mac-gcs-normalize.py";
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  const read = (file) =>
    execFileSync("git", ["cat-file", "blob", `HEAD:${file}`], {
      cwd: root,
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1 << 20,
    }).toString();
  const runtime = read(runtimePath),
    helper = read(helperPath);
  for (const file of [runtimePath, helperPath]) {
    const matching = rows.filter((row) => row.path === file);
    assert.equal(matching.length, 1);
    assert.equal(matching[0].mode, "100644");
    assert.equal(
      matching[0].sha,
      blob(file === runtimePath ? runtime : helper),
    );
  }
  assert.equal(Buffer.byteLength(helper), 11223);
  assert.equal(
    sha(helper),
    "8102419d2f16b149743d2546fe670044a03dbd5f1ab9c2dde5095f178190d236",
  );
  const previous = withoutMacGcsPreparationRuntime(runtime);
  return rows
    .filter((row) => row.path !== helperPath)
    .map((row) =>
      row.path === runtimePath ? { ...row, sha: blob(previous) } : row,
    );
}
