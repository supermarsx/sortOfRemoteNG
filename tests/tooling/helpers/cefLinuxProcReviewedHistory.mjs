import {
  beforeAvfCompatRowsForHistory,
  beforeAvfCompatDataForHistory,
} from "./cefAvfCompatibilityReviewedHistory.mjs";
import {
  beforeCompositeLinuxFileForHistory,
  beforeCompositeLinuxDataForHistory,
  beforeCompositeLinuxRowsForHistory,
  compositeLinuxDataFromGit,
} from "./cefCompositeReviewedHistory.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

import {
  beforeLinuxFreshCoreForHistory,
  beforeLinuxFreshDataForHistory,
  beforeLinuxFreshRowsForHistory,
} from "./cefLinuxFreshReviewedHistory.mjs";

// Closed historical test DATA. It never confers source/process/SDK authority.
const RAW = readFileSync(
  new URL(
    "../../fixtures/cef/linux_proc_presentation_inverse.json",
    import.meta.url,
  ),
);
assert.equal(RAW.length, 22035);
assert.equal(
  createHash("sha256").update(RAW).digest("hex"),
  "2e7e21d30938af7be3a6561dfa818b7c601057cb4c3d67bee996860d697db9be",
);
const DATA = JSON.parse(RAW);
assert.equal(DATA.schemaVersion, 1);
assert.equal(DATA.authority, false);
export const CURRENT_LINUX_PROC_PRODUCER = DATA.currentProducer;
export const BEFORE_LINUX_PROC_PRODUCER = DATA.beforeProducer;
export const CURRENT_LINUX_PROC_CORE = Object.freeze({ ...DATA.after });
export const BEFORE_LINUX_PROC_CORE = Object.freeze({ ...DATA.before });
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
  assert.equal(digest(rows), CURRENT_LINUX_PROC_PRODUCER);
}
export function inverseLinuxProcCore(text) {
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
export function beforeLinuxProcCoreForHistory(text) {
  text = beforeCompositeLinuxFileForHistory(
    Buffer.from(text),
    "scripts/lib/cef-engineering-checkpoint.mjs",
  ).toString("utf8");
  text = beforeLinuxFreshCoreForHistory(text);
  return typeof text === "string" &&
    Buffer.byteLength(text) === DATA.after.bytes &&
    sha(text) === DATA.after.sha256
    ? inverseLinuxProcCore(text)
    : text;
}
function rewindRows(rows) {
  currentRows(rows);
  const result = rows.map((row) =>
    row.path === DATA.path ? { ...row, sha: DATA.before.blob } : row,
  );
  assert.equal(digest(result), BEFORE_LINUX_PROC_PRODUCER);
  return result;
}
export function beforeLinuxProcDataForHistory(rows, files) {
  ({ rows, files } = beforeAvfCompatDataForHistory(rows, files));
  ({ rows, files } = beforeCompositeLinuxDataForHistory(rows, files));
  ({ rows, files } = beforeLinuxFreshDataForHistory(rows, files));
  if (digest(rows) !== CURRENT_LINUX_PROC_PRODUCER) return { rows, files };
  return inverseLinuxProcData(rows, files);
}
export function inverseLinuxProcData(rows, files) {
  currentRows(rows);
  assert(files instanceof Map && files.size === 132);
  for (const row of rows) {
    assert(Buffer.isBuffer(files.get(row.path)));
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  }
  const result = new Map(files);
  result.set(
    DATA.path,
    Buffer.from(inverseLinuxProcCore(files.get(DATA.path).toString("utf8"))),
  );
  const previous = rewindRows(rows);
  for (const row of previous)
    assert.equal(blob(result.get(row.path)), row.sha, row.path);
  return { rows: previous, files: result };
}
export function beforeLinuxProcRowsForHistory(rows, root) {
  rows = beforeAvfCompatRowsForHistory(rows, root);
  rows = beforeCompositeLinuxRowsForHistory(rows, root);
  rows = beforeLinuxFreshRowsForHistory(rows, root);
  if (digest(rows) !== CURRENT_LINUX_PROC_PRODUCER) return rows;
  return inverseLinuxProcRows(rows, root);
}
export function inverseLinuxProcRows(rows, root) {
  const subject = compositeLinuxDataFromGit(rows, root);
  if (subject) return inverseLinuxProcData(subject.rows, subject.files).rows;
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
  const previous = beforeLinuxFreshDataForHistory(actual, files);
  currentRows(previous.rows);
  assert.deepEqual(simple(previous.rows), simple(rows));
  const rewound = new Map(
    inverseLinuxProcData(previous.rows, previous.files).rows.map((row) => [
      row.path,
      row,
    ]),
  );
  return rows.map((row) => ({ ...row, sha: rewound.get(row.path).sha }));
}
