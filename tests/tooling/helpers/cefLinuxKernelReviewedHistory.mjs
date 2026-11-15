import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

import {
  beforeLinuxProcCoreForHistory,
  beforeLinuxProcDataForHistory,
  beforeLinuxProcRowsForHistory,
} from "./cefLinuxProcReviewedHistory.mjs";

// Closed historical test DATA. It never confers source/process/SDK authority.
const RAW = readFileSync(
  new URL(
    "../../fixtures/cef/linux_kernel_identity_inverse.json",
    import.meta.url,
  ),
);
assert.equal(RAW.length, 35784);
assert.equal(
  createHash("sha256").update(RAW).digest("hex"),
  "52d83ea9c33432cf7887ba6368e4c74973c43244da7e7183c4a6ac8e05982676",
);
const DATA = JSON.parse(RAW);
assert.equal(DATA.schemaVersion, 1);
assert.equal(DATA.authority, false);
export const CURRENT_LINUX_KERNEL_PRODUCER = DATA.currentProducer;
export const BEFORE_LINUX_KERNEL_PRODUCER = DATA.beforeProducer;
export const CURRENT_LINUX_KERNEL_CORE = Object.freeze({ ...DATA.after });
export const BEFORE_LINUX_KERNEL_CORE = Object.freeze({ ...DATA.before });
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
const digest = (rows) =>
  codeTreeDigest(rows.map((row) => ({ type: "blob", ...row })));
const simple = (rows) =>
  rows
    .map(({ path, mode, sha }) => ({ path, mode, sha }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
function pin(raw, expected) {
  assert(Buffer.isBuffer(raw));
  assert.equal(raw.length, expected.bytes);
  assert.equal(sha(raw), expected.sha256);
  assert.equal(blob(raw), expected.blob);
}
function currentRows(rows) {
  assert(Array.isArray(rows));
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  assert.deepEqual(simple(rows), simple(DATA.rows));
  assert.equal(digest(rows), CURRENT_LINUX_KERNEL_PRODUCER);
}
export function inverseLinuxKernelCore(text) {
  assert.equal(typeof text, "string");
  pin(Buffer.from(text), DATA.after);
  let previous = text;
  for (const pair of [...DATA.pairs].reverse()) {
    assert.equal(previous.split(pair.current).length, 2);
    previous = previous.replace(pair.current, () => pair.previous);
  }
  pin(Buffer.from(previous), DATA.before);
  return previous;
}
export function beforeLinuxKernelCoreForHistory(text) {
  text = beforeLinuxProcCoreForHistory(text);
  return typeof text === "string" &&
    Buffer.byteLength(text) === DATA.after.bytes &&
    sha(text) === DATA.after.sha256
    ? inverseLinuxKernelCore(text)
    : text;
}
function rewindRows(rows) {
  currentRows(rows);
  const result = rows.map((row) =>
    row.path === DATA.path ? { ...row, sha: DATA.before.blob } : row,
  );
  assert.equal(digest(result), BEFORE_LINUX_KERNEL_PRODUCER);
  return result;
}
export function beforeLinuxKernelDataForHistory(rows, files) {
  ({ rows, files } = beforeLinuxProcDataForHistory(rows, files));
  if (digest(rows) !== CURRENT_LINUX_KERNEL_PRODUCER) return { rows, files };
  return inverseLinuxKernelData(rows, files);
}
export function inverseLinuxKernelData(rows, files) {
  currentRows(rows);
  assert(files instanceof Map && files.size === 132);
  for (const row of rows) {
    assert(Buffer.isBuffer(files.get(row.path)));
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  }
  const result = new Map(files);
  result.set(
    DATA.path,
    Buffer.from(inverseLinuxKernelCore(files.get(DATA.path).toString("utf8"))),
  );
  const previous = rewindRows(rows);
  for (const row of previous)
    assert.equal(blob(result.get(row.path)), row.sha, row.path);
  return { rows: previous, files: result };
}
export function beforeLinuxKernelRowsForHistory(rows, root) {
  rows = beforeLinuxProcRowsForHistory(rows, root);
  if (digest(rows) !== CURRENT_LINUX_KERNEL_PRODUCER) return rows;
  return inverseLinuxKernelRows(rows, root);
}
export function inverseLinuxKernelRows(rows, root) {
  currentRows(rows);
  const git = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: root,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 16 << 20,
      ...options,
    });
  const tree = git([
    "ls-tree",
    "-r",
    "HEAD",
    "--",
    "scripts",
    "native/cef-hosted-recipe.json",
    ".node-version",
    ".github/workflows/cef-engineering-checkpoint.yml",
  ]).toString("utf8");
  assert(tree.endsWith("\n"));
  const actual = tree
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      const m = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0\r\n]+)$/.exec(
        line,
      );
      assert(m);
      return { mode: m[1], sha: m[2], path: m[3] };
    });
  const output = git(["cat-file", "--batch"], {
    input: actual.map((row) => `HEAD:${row.path}\n`).join(""),
  });
  const files = new Map();
  let offset = 0;
  for (const row of actual) {
    const end = output.indexOf(10, offset);
    assert(end >= offset);
    const m = /^([a-f0-9]{40}) blob (0|[1-9][0-9]{0,7})$/.exec(
      output.subarray(offset, end).toString("ascii"),
    );
    assert(m);
    assert.equal(m[1], row.sha);
    const size = Number(m[2]);
    offset = end + 1;
    assert(size <= 16 << 20 && offset + size < output.length);
    const raw = output.subarray(offset, offset + size);
    assert.equal(blob(raw), row.sha);
    files.set(row.path, raw);
    offset += size;
    assert.equal(output[offset++], 10);
  }
  assert.equal(offset, output.length);
  const normalized = beforeLinuxProcDataForHistory(actual, files);
  currentRows(normalized.rows);
  assert.deepEqual(simple(normalized.rows), simple(rows));
  return inverseLinuxKernelData(rows, normalized.files).rows;
}
