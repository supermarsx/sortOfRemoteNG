import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

// Explicit complete historical subjects only. Never imported by production.
const RAW = readFileSync(
  new URL("../../fixtures/cef/composite_source_inverse.json", import.meta.url),
);
assert.equal(RAW.length, 193181);
assert.equal(
  createHash("sha256").update(RAW).digest("hex"),
  "0dc0c2ca7fe730beabe4374321fb7e0900f77ec31318c4374665c350b37e1371",
);
const DATA = JSON.parse(RAW);
assert.equal(DATA.authority, false);
export const CURRENT_COMPOSITE_PRODUCER = DATA.currentProducer;
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
function current(rows) {
  assert(Array.isArray(rows) && rows.length === 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  assert.deepEqual(simple(rows), DATA.currentRows);
  assert.equal(digest(rows), CURRENT_COMPOSITE_PRODUCER);
}
function inverseFile(raw, file, endpoint) {
  const spec = DATA.endpoints[endpoint].files.find((row) => row.path === file);
  assert(spec, "Unreviewed composite historical file");
  pin(raw, spec.after);
  let text = raw.toString("utf8");
  for (const pair of [...spec.pairs].reverse()) {
    assert.equal(text.split(pair.current).length, 2);
    text = text.replace(pair.current, () => pair.previous);
  }
  const before = Buffer.from(text);
  pin(before, spec.before);
  return before;
}
function prefixFile(raw, file, endpoint) {
  const spec = DATA.endpoints[endpoint].files.find((row) => row.path === file);
  return spec &&
    raw.length === spec.after.bytes &&
    sha(raw) === spec.after.sha256
    ? inverseFile(raw, file, endpoint)
    : raw;
}
function inverseData(rows, files, endpoint) {
  current(rows);
  assert(files instanceof Map && files.size === 132);
  for (const row of rows) {
    assert(Buffer.isBuffer(files.get(row.path)));
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  }
  const result = new Map(files),
    subject = DATA.endpoints[endpoint];
  for (const spec of subject.files)
    result.set(
      spec.path,
      inverseFile(files.get(spec.path), spec.path, endpoint),
    );
  const before = rows.map((row) => {
    const spec = subject.files.find((spec) => spec.path === row.path);
    if (!spec) return row;
    assert.equal(row.mode, spec.mode);
    return { ...row, sha: spec.before.blob };
  });
  assert.deepEqual(simple(before), subject.rows);
  assert.equal(digest(before), subject.producer);
  for (const row of before) assert.equal(blob(result.get(row.path)), row.sha);
  return { rows: before, files: result };
}
function prefixData(rows, files, endpoint) {
  return digest(rows) === CURRENT_COMPOSITE_PRODUCER
    ? inverseData(rows, files, endpoint)
    : { rows, files };
}
function actualData(root) {
  const git = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: root,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 16 << 20,
      ...options,
    });
  const rows = git([
    "ls-tree",
    "-r",
    "HEAD",
    "--",
    "scripts",
    "native/cef-hosted-recipe.json",
    ".node-version",
    ".github/workflows/cef-engineering-checkpoint.yml",
  ])
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const matched =
        /^(100644|100755) blob ([a-f0-9]{40})\t([^\0\r\n]+)$/.exec(line);
      assert(matched);
      return { mode: matched[1], sha: matched[2], path: matched[3] };
    });
  if (digest(rows) !== CURRENT_COMPOSITE_PRODUCER) return null;
  current(rows);
  const output = git(["cat-file", "--batch"], {
    input: rows.map((row) => `HEAD:${row.path}\n`).join(""),
  });
  const files = new Map();
  let offset = 0;
  for (const row of rows) {
    const end = output.indexOf(10, offset);
    assert(end >= offset);
    const matched = /^([a-f0-9]{40}) blob (0|[1-9][0-9]{0,7})$/.exec(
      output.subarray(offset, end).toString("ascii"),
    );
    assert(matched && matched[1] === row.sha);
    offset = end + 1;
    const length = Number(matched[2]);
    assert(length <= 16 << 20 && offset + length < output.length);
    files.set(row.path, output.subarray(offset, offset + length));
    offset += length;
    assert.equal(output[offset++], 10);
  }
  assert.equal(offset, output.length);
  return { rows, files };
}
function historicalDataFromGit(rows, root, endpoint) {
  const value = digest(rows),
    subject = DATA.endpoints[endpoint];
  if (![CURRENT_COMPOSITE_PRODUCER, subject.producer].includes(value))
    return null;
  const actual = actualData(root);
  if (!actual) return null;
  const before = inverseData(actual.rows, actual.files, endpoint);
  if (value === CURRENT_COMPOSITE_PRODUCER) current(rows);
  else assert.deepEqual(simple(rows), simple(before.rows));
  const preserved = rows.map((row) => ({
    ...row,
    sha: before.rows.find((old) => old.path === row.path).sha,
  }));
  return { ...before, rows: preserved };
}
function prefixRows(rows, root, endpoint) {
  return digest(rows) === CURRENT_COMPOSITE_PRODUCER
    ? historicalDataFromGit(rows, root, endpoint).rows
    : rows;
}
export const beforeCompositeMacFileForHistory = (raw, file) =>
  prefixFile(raw, file, "mac");
export const beforeCompositeLinuxFileForHistory = (raw, file) =>
  prefixFile(raw, file, "linux");
export const beforeCompositeMacDataForHistory = (rows, files) =>
  prefixData(rows, files, "mac");
export const beforeCompositeLinuxDataForHistory = (rows, files) =>
  prefixData(rows, files, "linux");
export const beforeCompositeMacRowsForHistory = (rows, root) =>
  prefixRows(rows, root, "mac");
export const beforeCompositeLinuxRowsForHistory = (rows, root) =>
  prefixRows(rows, root, "linux");
export const compositeMacDataFromGit = (rows, root) =>
  historicalDataFromGit(rows, root, "mac");
export const compositeLinuxDataFromGit = (rows, root) =>
  historicalDataFromGit(rows, root, "linux");
export const inverseCompositeMacData = (rows, files) =>
  inverseData(rows, files, "mac");
export const inverseCompositeLinuxData = (rows, files) =>
  inverseData(rows, files, "linux");

export const beforeCompositeFreshFileForHistory = (raw, file) =>
  prefixFile(raw, file, "fresh");
export const beforeCompositeFreshDataForHistory = (rows, files) =>
  prefixData(rows, files, "fresh");
export const compositeFreshDataFromGit = (rows, root) =>
  historicalDataFromGit(rows, root, "fresh");
export const inverseCompositeFreshData = (rows, files) =>
  inverseData(rows, files, "fresh");
