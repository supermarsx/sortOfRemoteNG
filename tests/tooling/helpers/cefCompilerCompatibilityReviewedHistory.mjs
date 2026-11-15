import {
  beforeCompositeMacFileForHistory,
  beforeCompositeMacDataForHistory,
  compositeMacDataFromGit,
} from "./cefCompositeReviewedHistory.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

// Closed test DATA only: no source, process, graph, SDK or native authority.
const RAW = readFileSync(
  new URL("../../fixtures/cef/compiler_compat_inverse.json", import.meta.url),
);
assert.equal(RAW.length, 30210);
assert.equal(
  createHash("sha256").update(RAW).digest("hex"),
  "b69d5e1f82821f4dbf6e7e894eb83cecf9f696a08ffa9c984e1f68149836c6da",
);
const DATA = JSON.parse(RAW);
export const CURRENT_COMPILER_COMPAT_PRODUCER = DATA.currentProducer;
export const BEFORE_COMPILER_COMPAT_PRODUCER = DATA.beforeProducer;
const CORE = "scripts/lib/cef-engineering-checkpoint.mjs";
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
export function inverseCompilerCompatFile(raw, file) {
  const spec = DATA.files.find((row) => row.path === file);
  assert(spec, "Unknown compiler compatibility file");
  pin(raw, spec.after);
  let text = raw.toString("utf8");
  for (const pair of [...spec.pairs].reverse()) {
    assert.equal(text.split(pair.current).length, 2);
    text = text.replace(pair.current, () => pair.previous);
  }
  const previous = Buffer.from(text);
  pin(previous, spec.before);
  return previous;
}
export function beforeCompilerCompatFileForHistory(raw, file) {
  raw = beforeCompositeMacFileForHistory(raw, file);
  const spec = DATA.files.find((row) => row.path === file);
  return spec &&
    raw.length === spec.after.bytes &&
    sha(raw) === spec.after.sha256
    ? inverseCompilerCompatFile(raw, file)
    : raw;
}
export function beforeCompilerCompatCoreForHistory(text) {
  return beforeCompilerCompatFileForHistory(Buffer.from(text), CORE).toString(
    "utf8",
  );
}
function rewindRows(rows) {
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  assert.equal(digest(rows), CURRENT_COMPILER_COMPAT_PRODUCER);
  const result = rows.map((row) => {
    const spec = DATA.files.find((spec) => spec.path === row.path);
    if (!spec) return row;
    assert.equal(row.mode, spec.mode);
    assert.equal(row.sha, spec.after.blob);
    return { ...row, sha: spec.before.blob };
  });
  assert.equal(digest(result), BEFORE_COMPILER_COMPAT_PRODUCER);
  return result;
}
export function beforeCompilerCompatDataForHistory(rows, files) {
  ({ rows, files } = beforeCompositeMacDataForHistory(rows, files));
  if (digest(rows) !== CURRENT_COMPILER_COMPAT_PRODUCER) return { rows, files };
  assert(files instanceof Map && files.size === rows.length);
  for (const row of rows)
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  const previous = new Map(files);
  for (const spec of DATA.files)
    previous.set(
      spec.path,
      inverseCompilerCompatFile(files.get(spec.path), spec.path),
    );
  const previousRows = rewindRows(rows);
  for (const row of previousRows)
    assert.equal(blob(previous.get(row.path)), row.sha, row.path);
  return { rows: previousRows, files: previous };
}
export function beforeCompilerCompatRowsForHistory(rows, root) {
  const subject = compositeMacDataFromGit(rows, root);
  if (subject)
    return beforeCompilerCompatDataForHistory(subject.rows, subject.files).rows;
  if (digest(rows) !== CURRENT_COMPILER_COMPAT_PRODUCER) return rows;
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 2 << 20,
    input: DATA.files.map((spec) => "HEAD:" + spec.path + "\n").join(""),
  });
  let offset = 0;
  for (const spec of DATA.files) {
    const end = raw.indexOf(10, offset);
    assert(end >= offset);
    const matched = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(
      raw.subarray(offset, end).toString(),
    );
    assert(matched);
    assert.equal(matched[1], spec.after.blob);
    const bytes = Number(matched[2]);
    offset = end + 1;
    inverseCompilerCompatFile(raw.subarray(offset, offset + bytes), spec.path);
    offset += bytes;
    assert.equal(raw[offset++], 10);
  }
  assert.equal(offset, raw.length);
  return rewindRows(rows);
}
