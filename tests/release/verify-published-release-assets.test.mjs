import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BUILD_TARGETS,
  expectedAssetNames,
  UPDATER_ARTIFACTS,
  UPDATER_PLATFORMS,
  updaterArtifactName,
  validatePublishedReleaseAssets as validatePublishedReleaseAssetsContract,
} from "../../scripts/ci/verify-published-release-assets.mjs";

const VERSION = "26.7.0";
const RELEASE_BASE_URL = "https://example.invalid/releases";

function validatePublishedReleaseAssets(options) {
  return validatePublishedReleaseAssetsContract({
    expectedReleaseBaseUrl: RELEASE_BASE_URL,
    ...options,
  });
}

function makeAssets(updaterMode) {
  const directory = mkdtempSync(path.join(tmpdir(), "sorng-release-assets-"));
  for (const name of expectedAssetNames(VERSION, updaterMode)) {
    writeFileSync(path.join(directory, name), "fixture\n");
  }
  for (const target of BUILD_TARGETS) {
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
  const platforms = {};
  for (const platform of UPDATER_PLATFORMS) {
    const artifact = updaterArtifactName(platform, VERSION, updaterMode);
    const signature = updaterMode === "signed" ? `signature-${platform}` : "";
    if (updaterMode === "signed") {
      writeFileSync(path.join(directory, `${artifact}.sig`), `${signature}\n`);
    }
    platforms[platform] = {
      signature,
      url: `${RELEASE_BASE_URL}/${artifact}`,
    };
  }
  writeFileSync(
    path.join(directory, "latest.json"),
    `${JSON.stringify({
      version: VERSION,
      pub_date: "2026-07-20T12:00:00Z",
      notes: "fixture",
      updater_signing: updaterMode === "signed",
      platforms,
    })}\n`,
  );
  return directory;
}

test("enumerates ARM, RPM, Flatpak, and portable assets in the exact public set", () => {
  assert.deepEqual(expectedAssetNames(VERSION, "unsigned"), [
    "latest.json",
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
  assert.deepEqual(BUILD_TARGETS, [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-aarch64",
    "linux-x86_64",
    "windows-aarch64",
    "windows-x86_64",
  ]);
  assert.equal(expectedAssetNames(VERSION, "unsigned").length, 23);
  assert.equal(expectedAssetNames(VERSION, "signed").length, 33);
  for (const artifactForVersion of Object.values(UPDATER_ARTIFACTS)) {
    assert.doesNotMatch(artifactForVersion(VERSION), /-portable\.zip$/u);
  }
});

test("separates build targets from per-installer updater platform keys", () => {
  // The MSI is an extra payload of the Windows build, not an extra build: it must
  // gain a manifest key without demanding a provenance document of its own.
  assert.deepEqual(UPDATER_PLATFORMS, [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-aarch64",
    "linux-x86_64",
    "windows-aarch64",
    "windows-aarch64-msi",
    "windows-x86_64",
    "windows-x86_64-msi",
  ]);
  const signed = expectedAssetNames(VERSION, "signed");
  for (const arch of ["x86_64", "aarch64"]) {
    // The bare key stays on NSIS so already-installed clients keep updating.
    assert.equal(
      UPDATER_ARTIFACTS[`windows-${arch}`](VERSION),
      `sortOfRemoteNG_${VERSION}_windows-${arch}-setup.exe`,
    );
    assert.equal(
      UPDATER_ARTIFACTS[`windows-${arch}-msi`](VERSION),
      `sortOfRemoteNG_${VERSION}_windows-${arch}.msi`,
    );
    assert.ok(signed.includes(`sortOfRemoteNG_${VERSION}_windows-${arch}.msi`));
    assert.ok(
      signed.includes(`sortOfRemoteNG_${VERSION}_windows-${arch}.msi.sig`),
    );
    // No `-nsis` counterpart: the NSIS fallback to `windows-<arch>` is deliberate.
    assert.ok(!UPDATER_PLATFORMS.includes(`windows-${arch}-nsis`));
    // No provenance document is expected for a per-installer key.
    assert.ok(
      !signed.includes(
        `sortOfRemoteNG_${VERSION}_windows-${arch}-msi.provenance.json`,
      ),
    );
  }
  // Requirement (iii): the unsigned set must carry no `.sig` at all.
  assert.deepEqual(
    expectedAssetNames(VERSION, "unsigned").filter((name) =>
      name.endsWith(".sig"),
    ),
    [],
  );
});

test("accepts the exact unsigned installer, provenance, and discovery feed set", () => {
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

test("requires an expected release base URL for published asset validation", () => {
  const assetDir = makeAssets("unsigned");
  try {
    const errors = validatePublishedReleaseAssetsContract({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "unsigned",
    });
    assert.ok(
      errors.includes(
        "Expected release base URL is required for published asset validation.",
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects a same-basename unsigned artifact URL on a foreign host", () => {
  const assetDir = makeAssets("unsigned");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    const artifact = updaterArtifactName("windows-x86_64", VERSION, "unsigned");
    feed.platforms["windows-x86_64"].url =
      `https://downloads.attacker.invalid/${artifact}`;
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);

    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "unsigned",
    });
    assert.ok(
      errors.includes(
        `platforms.windows-x86_64.url must equal ${RELEASE_BASE_URL}/${artifact}.`,
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("requires unsigned feeds to stay explicitly unsigned and use published DMGs", () => {
  const assetDir = makeAssets("unsigned");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    assert.match(feed.platforms["darwin-aarch64"].url, /\.dmg$/u);
    assert.equal(feed.platforms["darwin-aarch64"].signature, "");

    feed.platforms["windows-x86_64"].signature = "must-not-exist";
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "unsigned",
    });
    assert.ok(
      errors.includes(
        "platforms.windows-x86_64.signature must be empty in unsigned mode.",
      ),
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
    assert.equal(verified.length, UPDATER_PLATFORMS.length);
    assert.deepEqual(
      verified.map(([artifact]) => artifact).sort(),
      UPDATER_PLATFORMS.map((platform) =>
        UPDATER_ARTIFACTS[platform](VERSION),
      ).sort(),
    );
    // Requirement (ii): both MSI payloads go through the minisign verifier.
    assert.deepEqual(
      verified.filter(([artifact]) => artifact.endsWith(".msi")),
      [
        [
          `sortOfRemoteNG_${VERSION}_windows-aarch64.msi`,
          `sortOfRemoteNG_${VERSION}_windows-aarch64.msi.sig`,
        ],
        [
          `sortOfRemoteNG_${VERSION}_windows-x86_64.msi`,
          `sortOfRemoteNG_${VERSION}_windows-x86_64.msi.sig`,
        ],
      ],
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("refuses to pass a signed release when no signature verifier is supplied", () => {
  const assetDir = makeAssets("signed");
  try {
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
    });
    assert.ok(
      errors.includes(
        "Signed validation requires a signature verifier for every updater payload.",
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects a signed release missing an MSI updater signature", () => {
  const assetDir = makeAssets("signed");
  try {
    const signatureName = `sortOfRemoteNG_${VERSION}_windows-x86_64.msi.sig`;
    rmSync(path.join(assetDir, signatureName));
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });
    assert.ok(
      errors.some(
        (error) =>
          error.startsWith("Missing assets:") && error.includes(signatureName),
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects a feed that omits the MSI platform key", () => {
  const assetDir = makeAssets("signed");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    delete feed.platforms["windows-x86_64-msi"];
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);

    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });
    assert.ok(errors.includes("platforms.windows-x86_64-msi is required."));
    assert.ok(
      errors.includes(
        "latest.json must contain exactly the supported targets.",
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects an MSI platform key pointing at the NSIS installer", () => {
  const assetDir = makeAssets("signed");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    // The parallel-install hazard: an MSI install that resolves this key would
    // download the NSIS setup.exe and install a second copy beside itself.
    feed.platforms["windows-x86_64-msi"] = {
      ...feed.platforms["windows-x86_64"],
    };
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);

    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });
    assert.ok(
      errors.includes(
        `latest.json platform windows-x86_64-msi must reference sortOfRemoteNG_${VERSION}_windows-x86_64.msi.`,
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects a bare Windows platform key pointing at the MSI", () => {
  const assetDir = makeAssets("signed");
  try {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = JSON.parse(readFileSync(feedPath, "utf8"));
    // Requirement (i): old clients resolve `windows-x86_64` and must keep getting
    // the NSIS payload they were installed from.
    feed.platforms["windows-x86_64"] = {
      ...feed.platforms["windows-x86_64-msi"],
    };
    writeFileSync(feedPath, `${JSON.stringify(feed)}\n`);

    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });
    assert.ok(
      errors.includes(
        `latest.json platform windows-x86_64 must reference sortOfRemoteNG_${VERSION}_windows-x86_64-setup.exe.`,
      ),
    );
  } finally {
    rmSync(assetDir, { recursive: true, force: true });
  }
});

test("rejects a provenance document invented for a per-installer key", () => {
  const assetDir = makeAssets("signed");
  try {
    const strayName = `sortOfRemoteNG_${VERSION}_windows-x86_64-msi.provenance.json`;
    writeFileSync(
      path.join(assetDir, strayName),
      '{"target":"windows-x86_64-msi","os_signing":"authenticode-verified","updater_signing":true}\n',
    );
    const errors = validatePublishedReleaseAssets({
      assetDir,
      expectedVersion: VERSION,
      updaterMode: "signed",
      verifySignature() {},
    });
    assert.ok(
      errors.some(
        (error) =>
          error.startsWith("Unexpected assets:") && error.includes(strayName),
      ),
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
