import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { codeTreeDigest } from "../../../scripts/lib/cef-engineering-checkpoint.mjs";

// Test-only inverse of the complete reviewed Windows origin reader. Historical
// capsules and their producer/source identities remain byte-for-byte unchanged.
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const blob = (raw) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(raw)}\0`)
    .update(raw)
    .digest("hex");
export function withoutWindowsImageOrigin(raw) {
  assert.equal(Buffer.byteLength(raw), 93023);
  assert.equal(
    sha(raw),
    "6dc79f277efc50c6105aa737bc348aec04a1c9aa45854630462606664e83dda5",
  );
  assert.equal(raw.split('"20261103.298.1"').length, 3);
  const imageProfile =
    "5aec31b972bdd30bc05a480a9d21af700aed90ed12364c9986f8d1a4dc82e3cd";
  assert.equal(raw.split(imageProfile).length, 2);
  const previous = raw
    .replaceAll('"20261103.298.1"', '"20261030.294.1"')
    .replace(
      imageProfile,
      "e72be803a6e4a9acf8ff33c4ef471e41c2a391ee402b4f6b1fd8520536e22f05",
    );
  assert.equal(Buffer.byteLength(previous), 93023);
  assert.equal(
    sha(previous),
    "4bca898b94165d8c3cfc313326069fe94ab8a54bb2665e278dc651c7e39d0f8a",
  );
  return previous;
}

export function withoutWindowsImageRows(rows, root) {
  assert.equal(rows.length, 132);
  assert.equal(new Set(rows.map((row) => row.path)).size, 132);
  const digest = (value) =>
    codeTreeDigest(
      value.map((row) => ({
        type: "blob",
        ...row,
      })),
    );
  assert.equal(
    digest(rows),
    "9b5292077dabfe11c70fc083735c3555d1306fc3e85ff6444ee1e0976de6e681",
  );
  const file = "scripts/lib/cef-windows-arm-sdk-origin.mjs";
  const raw = execFileSync("git", ["cat-file", "blob", `HEAD:${file}`], {
    cwd: root,
    timeout: 10000,
    windowsHide: true,
    maxBuffer: 1 << 20,
  }).toString();
  const matching = rows.filter((row) => row.path === file);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].mode, "100644");
  assert.equal(matching[0].sha, blob(raw));
  const previous = withoutWindowsImageOrigin(raw);
  const restored = rows.map((row) =>
    row.path === file ? { ...row, sha: blob(previous) } : row,
  );
  assert.equal(
    digest(restored),
    "bfb8e437e987d458a839ce8699b7cc249960f19f81a9be77764fd9d17516c45b",
  );
  return restored;
}
