import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  expectedAssetNames,
  UPDATER_ARTIFACTS,
  validatePublishedReleaseAssets,
} from "../../scripts/ci/verify-published-release-assets.mjs";

const VERSION = "26.7.0";

function makeAssets(updaterMode) {
  const directory = mkdtempSync(path.join(tmpdir(), "sorng-release-assets-"));
  for (const name of expectedAssetNames(VERSION, updaterMode)) {
    writeFileSync(path.join(directory, name), "fixture\n");
  }
  for (const target of Object.keys(UPDATER_ARTIFACTS)) {
    const osSigning = target.startsWith("darwin-")
      ? "developer-id-verified"
      : target === "windows-x86_64"
        ? "authenticode-verified"
        : "not-applicable";
    writeFileSync(
      path.join(
        directory,
        `sortOfRemoteNG_${VERSION}_${target}.provenance.json`,
      ),
      `${JSON.stringify({
        target,
        os_signing: osSigning,
        updater_signing: updaterMode === "signed",
      })}\n`,
    );
  }
  if (updaterMode === "signed") {
    const platforms = {};
    for (const [target, artifactForVersion] of Object.entries(
      UPDATER_ARTIFACTS,
    )) {
      const artifact = artifactForVersion(VERSION);
      const signature = `signature-${target}`;
      writeFileSync(path.join(directory, `${artifact}.sig`), `${signature}\n`);
      platforms[target] = {
        signature,
        url: `https://example.invalid/releases/${artifact}`,
      };
    }
    writeFileSync(
      path.join(directory, "latest.json"),
      `${JSON.stringify({
        version: VERSION,
        pub_date: "2026-07-20T12:00:00Z",
        notes: "fixture",
        platforms,
      })}\n`,
    );
  }
  return directory;
}

test("accepts the exact unsigned installer and provenance set", () => {
  const assetDir = makeAssets("unsigned");
  try {
    assert.deepEqual(
      validatePublishedReleaseAssets({
        assetDir,
        expectedVersion: VERSION,
        updaterMode: "unsigned",
      }),
      [],
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects missing, unexpected, and invalid provenance assets", () => {
  const assetDir = makeAssets("unsigned");
  try {
    writeFileSync(path.join(assetDir, "unexpected.bin"), "unexpected\n");
    writeFileSync(
      path.join(
        assetDir,
        `sortOfRemoteNG_${VERSION}_windows-x86_64.provenance.json`,
      ),
      '{"target":"windows-x86_64","os_signing":"claimed","updater_signing":false}\n',
    );
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "unsigned",
    });
    assert.ok(errors.some((error) => error.includes("Unexpected assets")));
    assert.ok(errors.some((error) => error.includes("os_signing")));
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("requires cryptographic verification of all four signed payload bytes", () => {
  const assetDir = makeAssets("signed");
  try {
    const verified = [];
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature(artifactPath, signaturePath) {
        verified.push([
          path.basename(artifactPath),
          path.basename(signaturePath),
        ]);
      },
    });
    assert.deepEqual(errors, []);
    assert.equal(verified.length, 4);
    assert.deepEqual(
      verified.map(([artifact]) => artifact).sort(),
      Object.values(UPDATER_ARTIFACTS)
        .map((artifactForVersion) => artifactForVersion(VERSION))
        .sort(),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects updater feed URLs swapped between macOS architectures", () => {
  const assetDir = makeAssets("signed");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    const arm = feed.platforms["darwin-aarch64"];
    feed.platforms["darwin-aarch64"] = feed.platforms["darwin-x86_64"];
    feed.platforms["darwin-x86_64"] = arm;
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });
    assert.ok(
      errors.some((error) =>
        error.includes(
          "platform darwin-aarch64 must reference sortOfRemoteNG_26.7.0_darwin-aarch64.app.tar.gz",
        ),
      ),
    );
    assert.ok(
      errors.some((error) =>
        error.includes(
          "platform darwin-x86_64 must reference sortOfRemoteNG_26.7.0_darwin-x86_64.app.tar.gz",
        ),
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});
