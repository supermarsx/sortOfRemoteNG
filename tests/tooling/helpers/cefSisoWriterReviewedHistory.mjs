import {
  beforeAvfCompatRowsForHistory,
  beforeAvfCompatDataForHistory,
  beforeAvfCompatFileForHistory,
} from "./cefAvfCompatibilityReviewedHistory.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

import {
  beforeLinuxKernelCoreForHistory,
  beforeLinuxKernelDataForHistory,
  beforeLinuxKernelRowsForHistory,
} from "./cefLinuxKernelReviewedHistory.mjs";

// Closed test DATA only. This never issues source, process or SDK authority.
const RAW = readFileSync(
  new URL("../../fixtures/cef/siso_writer_inverse.json", import.meta.url),
);
assert.equal(RAW.length, 11844);
assert.equal(
  createHash("sha256").update(RAW).digest("hex"),
  "24694d452f214419c697e1b1938efb48a07963139f0a735120e463da5ae4049d",
);
const DATA = JSON.parse(RAW);
export const CURRENT_SISO_WRITER_PRODUCER = DATA.currentProducer;
export const BEFORE_SISO_WRITER_PRODUCER = DATA.beforeProducer;
export const CURRENT_SISO_WRITER_CORE = Object.freeze({ ...DATA.after });
export const BEFORE_SISO_WRITER_CORE = Object.freeze({ ...DATA.before });
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
const digest = (rows) =>
  codeTreeDigest(rows.map((row) => ({ type: "blob", ...row })));
function pin(raw, expected) {
  assert(Buffer.isBuffer(raw));
  assert.equal(raw.length, expected.bytes);
  assert.equal(sha(raw), expected.sha256);
  assert.equal(blob(raw), expected.blob);
}
export function inverseSisoWriterCore(text) {
  pin(Buffer.from(text), DATA.after);
  let previous = text;
  for (const pair of [...DATA.pairs].reverse()) {
    assert.equal(previous.split(pair.current).length, 2);
    previous = previous.replace(pair.current, () => pair.previous);
  }
  pin(Buffer.from(previous), DATA.before);
  return previous;
}
export function beforeSisoWriterCoreForHistory(text) {
  text = beforeLinuxKernelCoreForHistory(text);
  return Buffer.byteLength(text) === DATA.after.bytes &&
    sha(text) === DATA.after.sha256
    ? inverseSisoWriterCore(text)
    : text;
}
function rewindRows(rows) {
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  assert.equal(digest(rows), CURRENT_SISO_WRITER_PRODUCER);
  const core = rows.filter((row) => row.path === DATA.path);
  assert.equal(core.length, 1);
  assert.equal(core[0].mode, DATA.mode);
  assert.equal(core[0].sha, DATA.after.blob);
  const result = rows.map((row) =>
    row.path === DATA.path ? { ...row, sha: DATA.before.blob } : row,
  );
  assert.equal(digest(result), BEFORE_SISO_WRITER_PRODUCER);
  return result;
}
export function beforeSisoWriterDataForHistory(rows, files) {
  ({ rows, files } = beforeAvfCompatDataForHistory(rows, files));
  ({ rows, files } = beforeLinuxKernelDataForHistory(rows, files));
  if (digest(rows) !== CURRENT_SISO_WRITER_PRODUCER) return { rows, files };
  assert(files instanceof Map && files.size === rows.length);
  for (const row of rows)
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  const previous = new Map(files);
  previous.set(
    DATA.path,
    Buffer.from(inverseSisoWriterCore(files.get(DATA.path).toString("utf8"))),
  );
  const previousRows = rewindRows(rows);
  for (const row of previousRows)
    assert.equal(blob(previous.get(row.path)), row.sha, row.path);
  return { rows: previousRows, files: previous };
}
export function beforeSisoWriterRowsForHistory(rows, root) {
  rows = beforeAvfCompatRowsForHistory(rows, root);
  rows = beforeLinuxKernelRowsForHistory(rows, root);
  if (digest(rows) !== CURRENT_SISO_WRITER_PRODUCER) return rows;
  const headRaw = execFileSync(
    "git",
    ["cat-file", "blob", "HEAD:" + DATA.path],
    {
      cwd: root,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1 << 20,
    },
  );
  const raw = Buffer.from(
    beforeLinuxKernelCoreForHistory(
      beforeAvfCompatFileForHistory(headRaw, DATA.path).toString("utf8"),
    ),
  );
  pin(raw, DATA.after);
  inverseSisoWriterCore(raw.toString("utf8"));
  return rewindRows(rows);
}
