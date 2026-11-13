import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";
import {
  CURRENT_CENSUS_PRODUCER,
  beforeCensusDataForHistory,
} from "./cefCensusRetirementReviewedHistory.mjs";
import { CURRENT_WITNESS_PRODUCER } from "./cefCensusWitnessReviewedHistory.mjs";

// An explicit model for feature/history tests unavailable in the temporary
// Linux-only old source selection. Never used by a producer or SDK admission.
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
const DATA_RAW = Buffer.from(
  (
    await readFile(
      new URL(
        "../../fixtures/cef/linux_window_feature_data.json",
        import.meta.url,
      ),
      "utf8",
    )
  ).replaceAll("\r\n", "\n"),
);
assert.equal(DATA_RAW.length, 18088);
assert.equal(
  sha(DATA_RAW),
  "839d1ed88e2a8dd35d2d715e937dade6c6cd4a1bd026d23d74c1afff9cc9b023",
);
const DATA = JSON.parse(DATA_RAW);
export const PREVIOUS_FEATURE_PRODUCER = DATA.previous.producer;
export const CURRENT_FEATURE_PRODUCER = DATA.current.producer;
const SELECTED = [
  "scripts",
  "native/cef-hosted-recipe.json",
  ".node-version",
  ".github/workflows/cef-engineering-checkpoint.yml",
];
const git = (root, args, options = {}) =>
  execFileSync("git", args, {
    cwd: root,
    timeout: 10000,
    windowsHide: true,
    maxBuffer: 1 << 24,
    ...options,
  });

function validateData(rows, files, expected) {
  assert(Array.isArray(rows));
  assert.equal(rows.length, expected.rows);
  assert.equal(new Set(rows.map((row) => row.path)).size, rows.length);
  assert(files instanceof Map);
  assert.equal(files.size, rows.length);
  for (const row of rows) {
    assert.equal(row.type, "blob");
    assert(["100644", "100755"].includes(row.mode));
    assert.equal(path.posix.normalize(row.path), row.path);
    assert(
      !row.path.startsWith("/") &&
        !row.path.includes("..") &&
        !row.path.includes("\\"),
    );
    assert(row.path.startsWith("scripts/") || SELECTED.includes(row.path));
    assert(Buffer.isBuffer(files.get(row.path)), row.path);
    assert.equal(blob(files.get(row.path)), row.sha, row.path);
  }
  assert.equal(codeTreeDigest(rows), expected.producer);
}

function pin(raw, expected) {
  assert.equal(raw.length, expected.bytes);
  assert.equal(sha(raw), expected.sha256);
  assert.equal(blob(raw), expected.blob);
}

// Both directions are complete, whole-pinned DATA transformations. No inverse
// function or current mutation-negative receives a special old-state exemption.
function transform(rows, files, forward) {
  validateData(rows, files, forward ? DATA.previous : DATA.current);
  const result = new Map(files);
  for (const edit of DATA.edits) {
    let raw = result.get(edit.path);
    pin(raw, forward ? edit.before : edit.after);
    let text = raw.toString("utf8");
    for (const pair of forward ? edit.pairs : [...edit.pairs].reverse()) {
      const before = forward ? pair.before : pair.after;
      const after = forward ? pair.after : pair.before;
      assert.equal(text.split(before).length, 2);
      text = text.replace(before, () => after);
    }
    raw = Buffer.from(text);
    pin(raw, forward ? edit.after : edit.before);
    result.set(edit.path, raw);
  }
  const added = DATA.added;
  if (forward) {
    assert(!result.has(added.path));
    const raw = Buffer.from(added.text);
    pin(raw, added);
    result.set(added.path, raw);
  } else {
    pin(result.get(added.path), added);
    assert(result.delete(added.path));
  }
  const resultRows = rows
    .filter((row) => forward || row.path !== added.path)
    .map((row) => ({ ...row, sha: blob(result.get(row.path)) }));
  if (forward)
    resultRows.push({
      mode: "100644",
      type: "blob",
      sha: added.blob,
      path: added.path,
    });
  resultRows.sort((a, b) => a.path.localeCompare(b.path));
  validateData(resultRows, result, forward ? DATA.current : DATA.previous);
  return { rows: resultRows, files: result };
}

export const reconstructCurrentFeatureData = (rows, files) =>
  transform(rows, files, true);
export const reconstructPreviousFeatureData = (rows, files) => {
  // Explicit historical DATA before the core-only cleanup change. Actual
  // worker producer/ROOT remain untouched and are returned separately below.
  const previous = beforeCensusDataForHistory(rows, files);
  return transform(previous.rows, previous.files, false);
};

export function actualFeatureSource(root) {
  const rows = git(root, ["ls-tree", "-r", "HEAD", "--", ...SELECTED])
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const [left, file] = line.split("\t"),
        [mode, type, hash] = left.split(" ");
      return { mode, type, sha: hash, path: file };
    });
  const producer = codeTreeDigest(rows);
  assert(
    [
      PREVIOUS_FEATURE_PRODUCER,
      CURRENT_FEATURE_PRODUCER,
      CURRENT_CENSUS_PRODUCER,
      CURRENT_WITNESS_PRODUCER,
    ].includes(producer),
    "Unreviewed source selection",
  );
  // One bounded native Git process reads every raw blob. Frame and verify each
  // response instead of launching a new process for each selected file.
  const output = git(root, ["cat-file", "--batch"], {
    input: rows.map((row) => `HEAD:${row.path}\n`).join(""),
  });
  const files = new Map();
  let offset = 0;
  for (const row of rows) {
    const end = output.indexOf(10, offset);
    assert(end >= offset);
    const header = output.subarray(offset, end).toString("ascii");
    const matched = /^([a-f0-9]{40}) blob (0|[1-9][0-9]{0,7})$/.exec(header);
    assert(matched);
    assert.equal(matched[1], row.sha);
    const bytes = Number(matched[2]);
    offset = end + 1;
    assert(offset + bytes < output.length);
    files.set(row.path, output.subarray(offset, offset + bytes));
    offset += bytes;
    assert.equal(output[offset++], 10);
  }
  assert.equal(offset, output.length);
  validateData(
    rows,
    files,
    producer === PREVIOUS_FEATURE_PRODUCER
      ? DATA.previous
      : [CURRENT_CENSUS_PRODUCER, CURRENT_WITNESS_PRODUCER].includes(producer)
        ? { rows: 132, producer }
        : DATA.current,
  );
  // Tests execute worktree modules: bind those raw bytes to the actual HEAD too.
  return {
    rows,
    files,
    producer,
    head: git(root, ["rev-parse", "HEAD"]).toString().trim(),
  };
}

const contexts = new Map();
export function assertOldFeatureContext(platform, target) {
  assert.equal(platform, "linux", "Old selection is Linux-only");
  assert.equal(
    target,
    "aarch64-unknown-linux-gnu",
    "Old selection is an explicit Linux engineering test context",
  );
}
export async function assertOldFeaturePhysicalBytes(root, actual) {
  validateData(actual.rows, actual.files, DATA.previous);
  for (const row of actual.rows) {
    assert.deepEqual(
      await readFile(path.join(root, row.path)),
      actual.files.get(row.path),
      row.path,
    );
  }
}
export function reviewedFeatureFixture(root) {
  if (!contexts.has(root)) contexts.set(root, createFixture(root));
  return contexts.get(root);
}

async function createFixture(root) {
  const actual = actualFeatureSource(root);
  if (actual.producer !== PREVIOUS_FEATURE_PRODUCER) {
    return {
      actual,
      root,
      modeled: false,
      authority: false,
      runtime: await import(
        pathToFileURL(path.join(root, "scripts/cef-runtime-ci.mjs"))
      ),
    };
  }
  assertOldFeatureContext(process.platform, process.env.CEF_ENGINEERING_TARGET);
  // Physical raw equality is an extra old-Linux activation check only.
  // Current ROOT keeps all of its existing raw payload/checkout controls.
  await assertOldFeaturePhysicalBytes(root, actual);
  const current = reconstructCurrentFeatureData(actual.rows, actual.files);
  const cache = path.join(root, ".cache");
  await mkdir(cache, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(cache, "reviewed-feature-DATA-"));
  const cleanup = async () => {
    assert.equal(path.dirname(fixtureRoot), cache);
    assert(path.basename(fixtureRoot).startsWith("reviewed-feature-DATA-"));
    await rm(fixtureRoot, { recursive: true, force: true });
  };
  try {
    for (const row of current.rows) {
      const file = path.join(fixtureRoot, row.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, current.files.get(row.path), {
        flag: "wx",
        mode: row.mode === "100755" ? 0o755 : 0o644,
      });
    }
    // These unchanged Mac filesystem history controls resolve ROOT from __file__.
    // Copy only their code and closed inverse DATA; no Linux worker uses this root.
    for (const name of [
      "mac_owned_source_fd_test.py",
      "mac_owned_source_noop_test.py",
      "mac_source_reuse_inverse.py",
      "resume_budget_inverse.json",
      "mac_resume_cost_inverse.json",
      "mac_cipd_canonical_inverse.json",
      "mac_lean_cache_inverse.json",
      "mac_framework_partial_inverse.json",
      "mac_source_reuse_inverse.json",
    ]) {
      const file = path.join("tests/fixtures/cef", name);
      const raw = git(root, ["cat-file", "blob", `HEAD:${file}`]);
      await mkdir(path.dirname(path.join(fixtureRoot, file)), {
        recursive: true,
      });
      await writeFile(path.join(fixtureRoot, file), raw, {
        flag: "wx",
        mode: 0o644,
      });
    }
    // A separate DATA repository is required by the unchanged strict history
    // helpers' cat-file HEAD readers. It is never actual HEAD or an SDK producer.
    const env = {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Feature fixture DATA",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Feature fixture DATA",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2026-11-12T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-11-12T00:00:00Z",
    };
    const run = (args, options) => git(fixtureRoot, args, { env, ...options });
    run(["init", "--quiet", "--initial-branch=feature-DATA", "--template="]);
    run(["config", "core.autocrlf", "false"]);
    run(["add", "--", ...SELECTED]);
    const tree = run(["write-tree"]).toString().trim();
    const head = run(["commit-tree", tree], {
      input: "TEST DATA ONLY; no SDK or native admission\n",
    })
      .toString()
      .trim();
    run(["update-ref", "HEAD", head]);
    const committed = actualFeatureSource(fixtureRoot);
    assert.equal(committed.producer, CURRENT_FEATURE_PRODUCER);
    assert.equal(actualFeatureSource(root).head, actual.head);
    return {
      actual,
      data: committed,
      root: fixtureRoot,
      modeled: true,
      authority: false,
      cleanup,
      runtime: await import(
        pathToFileURL(path.join(fixtureRoot, "scripts/cef-runtime-ci.mjs"))
      ),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function retireFeatureFixtures() {
  for (const pending of contexts.values()) {
    const fixture = await pending;
    await fixture.cleanup?.();
  }
  contexts.clear();
}
