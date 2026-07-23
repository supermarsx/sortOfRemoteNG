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
      : target.startsWith("windows-")
        ? "authenticode-verified"
        : "not-applicable";
    const provenance = {
      target,
      os_signing: osSigning,
      updater_signing: updaterMode === "signed",
    };
    if (target.startsWith("linux-")) {
      const arch = target.endsWith("aarch64") ? "aarch64" : "x86_64";
      provenance.linux_packages = {
        rpm: {
          filename: `sortOfRemoteNG_${VERSION}_${target}.rpm`,
          version: VERSION,
          arch,
        },
        flatpak: {
          filename: `sortOfRemoteNG_${VERSION}_${target}.flatpak`,
          arch,
          app_ref: `app/com.sortofremote.ng/${arch}/stable`,
          runtime_ref: `runtime/org.gnome.Platform/${arch}/50`,
          runtime_commit: "a".repeat(64),
          sdk_ref: `runtime/org.gnome.Sdk/${arch}/50`,
          sdk_commit: "b".repeat(64),
          builder_version: "1.4.2",
          manifest_path: "packaging/flatpak/com.sortofremote.ng.yml",
          manifest_sha256: "c".repeat(64),
          resource_path: "/app/bin/resources/opkssh",
        },
      };
    }
    writeFileSync(
      path.join(
        directory,
        `sortOfRemoteNG_${VERSION}_${target}.provenance.json`,
      ),
      `${JSON.stringify(provenance)}\n`,
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

test("enumerates ARM, RPM, Flatpak, and portable assets in the exact public set", () => {
  assert.deepEqual(expectedAssetNames(VERSION, "unsigned"), [
    `sortOfRemoteNG_${VERSION}_darwin-aarch64.dmg`,
    `sortOfRemoteNG_${VERSION}_darwin-aarch64.provenance.json`,
    `sortOfRemoteNG_${VERSION}_darwin-x86_64.dmg`,
    `sortOfRemoteNG_${VERSION}_darwin-x86_64.provenance.json`,
    `sortOfRemoteNG_${VERSION}_linux-aarch64.AppImage`,
    `sortOfRemoteNG_${VERSION}_linux-aarch64.deb`,
    `sortOfRemoteNG_${VERSION}_linux-aarch64.flatpak`,
    `sortOfRemoteNG_${VERSION}_linux-aarch64.provenance.json`,
    `sortOfRemoteNG_${VERSION}_linux-aarch64.rpm`,
    `sortOfRemoteNG_${VERSION}_linux-x86_64.AppImage`,
    `sortOfRemoteNG_${VERSION}_linux-x86_64.deb`,
    `sortOfRemoteNG_${VERSION}_linux-x86_64.flatpak`,
    `sortOfRemoteNG_${VERSION}_linux-x86_64.provenance.json`,
    `sortOfRemoteNG_${VERSION}_linux-x86_64.rpm`,
    `sortOfRemoteNG_${VERSION}_windows-aarch64-portable.zip`,
    `sortOfRemoteNG_${VERSION}_windows-aarch64-setup.exe`,
    `sortOfRemoteNG_${VERSION}_windows-aarch64.msi`,
    `sortOfRemoteNG_${VERSION}_windows-aarch64.provenance.json`,
    `sortOfRemoteNG_${VERSION}_windows-x86_64-portable.zip`,
    `sortOfRemoteNG_${VERSION}_windows-x86_64-setup.exe`,
    `sortOfRemoteNG_${VERSION}_windows-x86_64.msi`,
    `sortOfRemoteNG_${VERSION}_windows-x86_64.provenance.json`,
  ]);
  assert.deepEqual(Object.keys(UPDATER_ARTIFACTS).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-aarch64",
    "linux-x86_64",
    "windows-aarch64",
    "windows-x86_64",
  ]);
  assert.equal(expectedAssetNames(VERSION, "unsigned").length, 22);
  assert.equal(expectedAssetNames(VERSION, "signed").length, 31);
  for (const artifactForVersion of Object.values(UPDATER_ARTIFACTS)) {
    assert.doesNotMatch(artifactForVersion(VERSION), /-portable\.zip$/u);
  }
});

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

test("rejects Linux package architecture and Flatpak contract drift", () => {
  const assetDir = makeAssets("unsigned");
  try {
    const provenancePath = path.join(
      assetDir,
      `sortOfRemoteNG_${VERSION}_linux-aarch64.provenance.json`,
    );
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    provenance.linux_packages.rpm.arch = "x86_64";
    provenance.linux_packages.flatpak.app_ref =
      "app/com.sortofremote.ng/x86_64/stable";
    provenance.linux_packages.flatpak.resource_path = "/app/resources/opkssh";
    writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);

    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "unsigned",
    });
    assert.ok(
      errors.some((error) =>
        error.includes("linux_packages.rpm.arch must equal aarch64"),
      ),
    );
    assert.ok(
      errors.some((error) =>
        error.includes(
          "linux_packages.flatpak.app_ref must equal app/com.sortofremote.ng/aarch64/stable",
        ),
      ),
    );
    assert.ok(
      errors.some((error) =>
        error.includes(
          "linux_packages.flatpak.resource_path must equal /app/bin/resources/opkssh",
        ),
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("requires cryptographic verification of every signed payload", () => {
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
    assert.equal(verified.length, Object.keys(UPDATER_ARTIFACTS).length);
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

test("requires the updater feed to contain exactly every supported target", () => {
  const assetDir = makeAssets("signed");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    delete feed.platforms["windows-aarch64"];
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);

    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });

    assert.ok(
      errors.includes(
        "latest.json must contain exactly the supported targets.",
      ),
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
