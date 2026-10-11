import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  "src-tauri/crates/sorng-browser-host/src/native_login_client.js",
  "utf8",
);
// Exercise the exact private implementation without adding a production export.
const helpers = source.slice(
  source.indexOf("  function sha256("),
  source.indexOf("  // Dedicated provider contracts."),
);
const load = (crypto) =>
  new Function("crypto", `${helpers}; return { sha256, credentialDigest };`)(
    crypto,
  );

test("HTTP SHA-256 matches Node across padding boundaries and multiple blocks", () => {
  const { sha256 } = load({});
  for (const length of [
    ...Array.from({ length: 130 }, (_, i) => i),
    1000,
    8192,
  ]) {
    const input = Uint8Array.from({ length }, (_, i) => (i * 37) & 255);
    const before = input.slice();
    assert.equal(
      Buffer.from(sha256(input)).toString("hex"),
      createHash("sha256").update(input).digest("hex"),
      `length ${length}`,
    );
    assert.deepEqual(input, before, "hashing must not mutate caller data");
  }
});

test("HTTP salted credential receipts match WebCrypto for Unicode and long values", async () => {
  const fallback = load({}).credentialDigest;
  const secure = load(webcrypto).credentialDigest;
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
  for (const value of [
    "",
    "abc",
    "a".repeat(39),
    "b".repeat(40),
    "c".repeat(48),
    "d".repeat(4096),
    "päss🔐漢字",
    "\ud800",
  ]) {
    const expected = [
      ...createHash("sha256").update(salt).update(value).digest(),
    ].join(",");
    assert.equal(await fallback(value, salt), expected);
    assert.equal(await secure(value, salt), expected);
    assert.deepEqual(
      salt,
      Uint8Array.from({ length: 16 }, (_, i) => i),
    );
  }
  assert.notEqual(
    await fallback("secret", salt),
    await fallback("secret", new Uint8Array(16)),
  );
  assert.notEqual(
    await fallback("secret", salt),
    await fallback("manual-edit", salt),
  );
});
