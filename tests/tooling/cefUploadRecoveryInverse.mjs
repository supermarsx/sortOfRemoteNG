import assert from "node:assert/strict";

// Test-only prefix: restore the COMPLETE reviewed pre-fix helper before the
// unchanged performance/native-history inverses. Production execution uses raw bytes.
export function withoutSourceVerifyGuard(text) {
  assert.equal(Buffer.byteLength(text), 240123);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "d5e9ac6002b5a36584d5f2a7fa6240a5627983ba16a32657ceaeb7a327d1f2d6",
  );
  const current =
    "        require(current == expected, 'source-metadata-postcheck')\n";
  assert.equal(text.split(current).length, 2);
  const previous = text.replace(current, "");
  assert.equal(Buffer.byteLength(previous), 240057);
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "ab584206c6d6bd4ad4acedf7ac0de90281a22e85967d28e19e98b6a03957fee4",
  );
  return previous;
}

// Change only the one proven archive blob; every other committed producer row
// remains the actual row, so this cannot retarget a capsule or admit a runtime.
export function withoutSourceVerifyGuardRows(rows, root) {
  const file = "scripts/lib/cef-checkpoint-archive.py";
  assert.equal(rows.filter((row) => row.path === file).length, 1);
  const text = execFileSync("git", ["cat-file", "blob", `HEAD:${file}`], {
    cwd: root,
    timeout: 10000,
    windowsHide: true,
    maxBuffer: 1 << 20,
  }).toString();
  assert.equal(rows.find((row) => row.path === file).sha, blobSha(text));
  const previous = withoutSourceVerifyGuard(text);
  return rows.map((row) =>
    row.path === file ? { ...row, sha: blobSha(previous) } : row,
  );
}

import { readFileSync } from "node:fs";
// Exact inverse of the Mac owned-source digest reuse / 5400 s budget / Mac reserve
// change, as (current text, previous text) pairs per file (see the JSON).
const readInverse = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/cef/${name}`, import.meta.url), "utf8"),
  );
// Applied newest first: the Mac resume cost cuts, the Mac CIPD canonical names, the lean cache, the framework time-cut change, then the digest-reuse change.
const MAC_INVERSES = [
  readInverse("resume_budget_inverse.json"),
  readInverse("accepted_images_inverse.json"),
  readInverse("mac_resume_cost_inverse.json"),
  readInverse("mac_cipd_canonical_inverse.json"),
  readInverse("mac_lean_cache_inverse.json"),
  readInverse("mac_framework_partial_inverse.json"),
  readInverse("mac_source_reuse_inverse.json"),
];
function macInverse(text, section) {
  let restored = text;
  for (const inverse of MAC_INVERSES) {
    if (inverse[section] === undefined) continue;
    const { pairs, helperStart, helperEnd } = inverse[section];
    if (helperStart !== undefined) {
      const start = restored.indexOf(helperStart);
      if (start < 0) continue;
      const end = restored.indexOf(helperEnd, start);
      if (
        end <= start ||
        restored.indexOf(helperStart, start + 1) >= 0 ||
        restored.indexOf(helperEnd, end + 1) >= 0
      )
        throw new Error("Mac reuse helper not found exactly once");
      restored = restored.slice(0, start) + restored.slice(end);
    }
    for (const [current, previous] of pairs) {
      if (restored.split(current).length !== 2)
        throw new Error(`Mac change ${section} not found exactly once`);
      restored = restored.replace(current, () => previous);
    }
  }
  return restored;
}
export const withoutMacReuseArchive = (text) =>
  macInverse(withoutSourceVerifyGuard(text), "archive");
export const withoutAcceptedImagesRuntime = (text) =>
  macInverse(text, "runtime");
// Exact inverse of the asset-upload recovery change in
// scripts/lib/cef-engineering-checkpoint.mjs. The historical-producer pin
// chains restore older bytes from the current file; this removes the recovery
// helper and puts back the two direct uploads so those chains stay exact.
const START = "export const UPLOAD_RECOVERY = ";
const END = "export async function verifyProducer(";
const direct = (name) =>
  "      const uploaded = await api(\n" +
  "        `releases/${release.id}/assets?name=${encodeURIComponent(" +
  name +
  ".name)}`,\n" +
  "        {\n" +
  '          method: "POST",\n' +
  "          upload: true,\n" +
  "          bodyBytes: " +
  name +
  ".bytes,\n" +
  "          body: createReadStream(path.join(bundle, " +
  name +
  ".name)),\n" +
  "        },\n" +
  "      );";
const recovered = (name) =>
  "      const uploaded = await uploadAssetWithRecovery(\n" +
  "        api,\n" +
  "        release.id,\n" +
  "        " +
  name +
  ",\n" +
  "        bundle,\n" +
  "      );";
export function withoutUploadRecovery(text) {
  text = macInverse(text, "lib");
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (
    start < 0 ||
    end <= start ||
    text.indexOf(START, start + 1) >= 0 ||
    text.indexOf(END, end + 1) >= 0
  )
    throw new Error("Upload recovery helper not found exactly once");
  let restored = text.slice(0, start) + text.slice(end);
  for (const name of ["p", "pin"]) {
    if (restored.split(recovered(name)).length !== 2)
      throw new Error(`Upload recovery call site ${name} not found once`);
    restored = restored.replace(recovered(name), () => direct(name));
  }
  return restored;
}

// Exact inverse of the CLI changes: the bounded failure-cause line in the
// final catch, and the optional Linux migration selection on the download route.
export function withoutCliCause(text) {
  text = macInverse(text, "cli");
  const catchOpen = "    .catch((error) => {\n";
  const start = text.indexOf(catchOpen);
  const marker = "      process.exitCode = 1;\n    });";
  const end = text.indexOf(marker, start);
  if (start < 0 || end < 0 || text.indexOf(catchOpen, start + 1) >= 0)
    throw new Error("CLI failure catch not found exactly once");
  const old =
    "    .catch(() => {\n" +
    "      console.error(\n" +
    '        "[cef-engineering-checkpoint] operation failed; retained logs and partial bytes are not acceptance",\n' +
    "      );\n";
  let restored = text.slice(0, start) + old + text.slice(end);
  const open = "// A restore normally needs no migration.";
  const from = restored.indexOf(open);
  const to = restored.indexOf("function migrationDownloadData(selection) {");
  if (from < 0 || to <= from || restored.indexOf(open, from + 1) >= 0)
    throw new Error("Optional selection helper not found exactly once");
  restored = restored.slice(0, from) + restored.slice(to);
  const call = "        ? await optionalLinuxMigrationSelection()\n";
  if (restored.split(call).length !== 2)
    throw new Error("Optional selection call not found exactly once");
  return restored.replace(
    call,
    () => "        ? await readLinuxMigrationSelection()\n",
  );
}

// Retained-producer rows: the pinned producer digest binds the pre-change
// bytes of the files this change touched. Each retained blob is rebuilt
// from the committed text through its exact inverse (no hard-coded blob).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export const blobSha = (text) =>
  createHash("sha1")
    .update(Buffer.from(`blob ${Buffer.byteLength(text)}\0`))
    .update(text)
    .digest("hex");
// Rows with this change's files restored to their pre-change blobs.
export function withoutRepinRows(rows, root) {
  const inverse = {
    "scripts/cef-engineering-checkpoint.mjs": withoutCliCause,
    "scripts/lib/cef-checkpoint-archive.py": withoutMacReuseArchive,
    "scripts/cef-runtime-ci.mjs": withoutAcceptedImagesRuntime,
  };
  return rows.map((row) => {
    // 43fc8360b (Windows ARM graph deadline) edited this producer file after
    // the retained digest was pinned; its prior blob is retained here.
    if (row.path === "scripts/lib/cef-windows-arm-sdk-origin.mjs")
      return { ...row, sha: "c0f2dfbf08fa94b0b10786847ee5a01d2df61fb6" };
    const undo = inverse[row.path];
    if (!undo) return row;
    const text = execFileSync("git", ["cat-file", "blob", `HEAD:${row.path}`], {
      cwd: root,
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1 << 24,
    }).toString();
    return { ...row, sha: blobSha(undo(text)) };
  });
}
