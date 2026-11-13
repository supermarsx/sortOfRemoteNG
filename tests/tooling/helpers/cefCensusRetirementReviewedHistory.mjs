import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  CURRENT_WITNESS_PRODUCER,
  beforeCensusWitnessCoreForHistory,
  beforeCensusWitnessRowsForHistory,
  beforeCensusWitnessDataForHistory,
} from "./cefCensusWitnessReviewedHistory.mjs";

// Test-only complete source history. This never grants a runtime/SDK exception.
const sha = (text) => createHash("sha256").update(text).digest("hex");
const ADDITION =
  '    // Retire the creation-owned census even when earlier pipe waits exhausted\n    // the original cleanup lease. Its close path still kills/detaches its own\n    // worker on an expired lease; this never proves compiler quiescence.\n    if (censusSession) {\n      try {\n        await censusSession.close(cleanupDeadline);\n      } catch (error) {\n        fail(error, "census-close");\n      }\n    }\n';
const ANCHOR = "    if (!pipeClosed) child.unref();\n";
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
export const BEFORE_CENSUS_PRODUCER =
  "9b5292077dabfe11c70fc083735c3555d1306fc3e85ff6444ee1e0976de6e681";
export const CURRENT_CENSUS_PRODUCER =
  "2ec4f0f98de64984cca59b97a44efacf3dba48ab0d6396bad072d5a302eb4333";
export const BEFORE_CENSUS_CORE = Object.freeze({
  bytes: 250010,
  sha256: "892d4b7384a6aa6eee7a3f1464c7d1fa1c02fed7c606e8103ca49a39f1f90fa2",
  blob: "1d01388d845d29485ea3e514fab6330f1c07f02b",
});
export const CURRENT_CENSUS_CORE = Object.freeze({
  bytes: 250406,
  sha256: "12f7ac17a1668387b63fa5dca687415032444420387295effb9ba9c19ba54f36",
  blob: "857ba720d69d8f937b6925bc94881ca748af27a8",
});
function pin(text, expected) {
  assert.equal(Buffer.byteLength(text), expected.bytes);
  assert.equal(sha(text), expected.sha256);
}
export function withoutCensusRetirementCore(text) {
  pin(text, CURRENT_CENSUS_CORE);
  assert.equal(text.split(ADDITION).length, 2);
  const before = text.replace(ADDITION, "");
  pin(before, BEFORE_CENSUS_CORE);
  return before;
}
export function withCensusRetirementCore(text) {
  pin(text, BEFORE_CENSUS_CORE);
  assert.equal(text.split(ANCHOR).length, 2);
  const current = text.replace(ANCHOR, () => ANCHOR + ADDITION);
  pin(current, CURRENT_CENSUS_CORE);
  return current;
}

// Already reviewed9b is a historical input, never an exemption to the strict
// current inverse above. Apply this once before existing mutation negatives.
export function beforeCensusCoreForHistory(text) {
  if (
    Buffer.byteLength(text) !== BEFORE_CENSUS_CORE.bytes ||
    sha(text) !== BEFORE_CENSUS_CORE.sha256
  )
    text = beforeCensusWitnessCoreForHistory(text);
  if (
    Buffer.byteLength(text) === BEFORE_CENSUS_CORE.bytes &&
    sha(text) === BEFORE_CENSUS_CORE.sha256
  )
    return text;
  return withoutCensusRetirementCore(text);
}
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
const treeDigest = (rows) =>
  codeTreeDigest(rows.map((row) => ({ type: "blob", ...row })));
function sourceShape(rows) {
  assert(Array.isArray(rows));
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  const digest = treeDigest(rows);
  assert(
    [
      BEFORE_CENSUS_PRODUCER,
      CURRENT_CENSUS_PRODUCER,
      CURRENT_WITNESS_PRODUCER,
    ].includes(digest),
  );
  return digest;
}
function oldRows(rows) {
  const matches = rows.filter((row) => row.path === CORE);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].mode, "100644");
  assert.equal(matches[0].sha, CURRENT_CENSUS_CORE.blob);
  const previous = rows.map((row) =>
    row.path === CORE ? { ...row, sha: BEFORE_CENSUS_CORE.blob } : row,
  );
  assert.equal(treeDigest(previous), BEFORE_CENSUS_PRODUCER);
  return previous;
}
export function beforeCensusRowsForHistory(rows, root) {
  if (sourceShape(rows) === BEFORE_CENSUS_PRODUCER) return rows;
  rows = beforeCensusWitnessRowsForHistory(rows, root);
  const raw = execFileSync("git", ["cat-file", "blob", "HEAD:" + CORE], {
    cwd: root,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1 << 20,
  });
  const current = beforeCensusWitnessCoreForHistory(raw.toString("utf8"));
  assert.equal(blob(Buffer.from(current)), CURRENT_CENSUS_CORE.blob);
  withoutCensusRetirementCore(current);
  return oldRows(rows);
}
export function beforeCensusDataForHistory(rows, files) {
  const digest = sourceShape(rows);
  assert(files instanceof Map);
  assert.equal(files.size, rows.length);
  for (const row of rows) {
    assert(Buffer.isBuffer(files.get(row.path)), row.path);
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  }
  if (digest === BEFORE_CENSUS_PRODUCER) return { rows, files };
  ({ rows, files } = beforeCensusWitnessDataForHistory(rows, files));
  const previousFiles = new Map(files);
  previousFiles.set(
    CORE,
    Buffer.from(withoutCensusRetirementCore(files.get(CORE).toString("utf8"))),
  );
  const previousRows = oldRows(rows);
  for (const row of previousRows)
    assert.equal(blob(previousFiles.get(row.path)), row.sha, row.path);
  return { rows: previousRows, files: previousFiles };
}
