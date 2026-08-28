import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The WiX UpgradeCode identifies the installed product to Windows Installer. An MSI
// only upgrades an existing install in place when its UpgradeCode matches the one
// already on the machine; a different value silently produces a side-by-side install.
//
// Tauri derives the code as UUIDv5(DNS, `<productName>.exe.app.x64`) when it is not
// pinned, which means a `productName` rename would change it. `tauri.conf.json` pins
// the value so that can never happen. This test locks the pin to the value Tauri
// would derive today, so a future rename fails here instead of in the field.

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const configPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

// RFC 4122 namespace for DNS names.
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function uuidV5(name, namespace) {
  const digest = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(Buffer.from(name, "utf8"))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function readTauriConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

test("uuidV5 matches the RFC 4122 DNS namespace reference vector", () => {
  assert.equal(
    uuidV5("python.org", DNS_NAMESPACE),
    "886313e1-3b8a-5372-9b90-0c9aee199e5d",
  );
});

test("tauri.conf.json pins an explicit WiX UpgradeCode", () => {
  const upgradeCode = readTauriConfig().bundle?.windows?.wix?.upgradeCode;

  assert.equal(
    typeof upgradeCode,
    "string",
    "bundle.windows.wix.upgradeCode must be pinned so MSI upgrades stay in place",
  );
  assert.match(
    upgradeCode,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "the pinned UpgradeCode must be a lowercase RFC 4122 version 5 UUID",
  );
});

test("the pinned WiX UpgradeCode equals the value Tauri derives from productName", () => {
  const config = readTauriConfig();
  const productName = config.productName;

  assert.equal(
    typeof productName,
    "string",
    "productName must be set for the UpgradeCode derivation",
  );

  // Tauri hardcodes `x64` in this string for every architecture, so the x64 and
  // ARM64 MSIs deliberately share one UpgradeCode. That is upstream behaviour and
  // is what already ships -- do not "fix" it here.
  const derived = uuidV5(`${productName}.exe.app.x64`, DNS_NAMESPACE);

  assert.equal(
    config.bundle.windows.wix.upgradeCode,
    derived,
    `The pinned UpgradeCode no longer matches UUIDv5(DNS, "${productName}.exe.app.x64"). ` +
      "If productName changed, KEEP the pinned UpgradeCode and update this expectation " +
      "instead -- changing the code itself breaks in-place upgrades for every installed MSI.",
  );
});

test("the pinned WiX UpgradeCode is the known value for the current productName", () => {
  const config = readTauriConfig();

  assert.equal(config.productName, "sortOfRemoteNG");
  assert.equal(
    config.bundle.windows.wix.upgradeCode,
    "85ab83c0-18b0-5da3-b253-08141a06eaec",
  );
});
