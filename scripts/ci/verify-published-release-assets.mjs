#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateReleaseArtifactNames } from "./validate-release-artifacts.mjs";
import { validateUpdaterFeed } from "./validate-updater-feed.mjs";

// Build targets drive the per-build provenance files ("one provenance document per
// compiled artifact"). They are NOT the updater manifest key set: per-installer keys
// such as `windows-x86_64-msi` are additional payloads of the *same* build and have no
// provenance document of their own.
export const BUILD_TARGETS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-aarch64",
  "windows-x86_64",
].sort();

// Updater manifest platform keys -> the release asset each one must point at.
//
// `tauri-plugin-updater` resolves `{os}-{arch}-{installer}` before falling back to
// `{os}-{arch}`, so an MSI install takes `windows-<arch>-msi` while an NSIS install
// keeps resolving `windows-<arch>` exactly as it always has. The bare `windows-<arch>`
// keys must therefore keep pointing at the NSIS `-setup.exe`: clients already in the
// field depend on it, and pointing them at the `.msi` would break them.
export const UPDATER_ARTIFACTS = {
  "darwin-aarch64": (version) =>
    `sortOfRemoteNG_${version}_darwin-aarch64.app.tar.gz`,
  "darwin-x86_64": (version) =>
    `sortOfRemoteNG_${version}_darwin-x86_64.app.tar.gz`,
  "linux-aarch64": (version) =>
    `sortOfRemoteNG_${version}_linux-aarch64.AppImage`,
  "linux-x86_64": (version) =>
    `sortOfRemoteNG_${version}_linux-x86_64.AppImage`,
  "windows-aarch64": (version) =>
    `sortOfRemoteNG_${version}_windows-aarch64-setup.exe`,
  "windows-aarch64-msi": (version) =>
    `sortOfRemoteNG_${version}_windows-aarch64.msi`,
  "windows-x86_64": (version) =>
    `sortOfRemoteNG_${version}_windows-x86_64-setup.exe`,
  "windows-x86_64-msi": (version) =>
    `sortOfRemoteNG_${version}_windows-x86_64.msi`,
};

export const UPDATER_PLATFORMS = Object.keys(UPDATER_ARTIFACTS).sort();

export function updaterArtifactName(platform, version, updaterMode) {
  if (updaterMode === "unsigned" && platform === "darwin-aarch64") {
    return `sortOfRemoteNG_${version}_darwin-aarch64.dmg`;
  }
  if (updaterMode === "unsigned" && platform === "darwin-x86_64") {
    return `sortOfRemoteNG_${version}_darwin-x86_64.dmg`;
  }
  return UPDATER_ARTIFACTS[platform](version);
}

export function expectedAssetNames(version, updaterMode) {
  const names = [
    `sortOfRemoteNG_${version}_linux-aarch64.AppImage`,
    `sortOfRemoteNG_${version}_linux-aarch64.deb`,
    `sortOfRemoteNG_${version}_linux-aarch64.flatpak`,
    `sortOfRemoteNG_${version}_linux-aarch64.rpm`,
    `sortOfRemoteNG_${version}_linux-x86_64.AppImage`,
    `sortOfRemoteNG_${version}_linux-x86_64.deb`,
    `sortOfRemoteNG_${version}_linux-x86_64.flatpak`,
    `sortOfRemoteNG_${version}_linux-x86_64.rpm`,
    `sortOfRemoteNG_${version}_darwin-aarch64.dmg`,
    `sortOfRemoteNG_${version}_darwin-x86_64.dmg`,
    `sortOfRemoteNG_${version}_windows-aarch64.msi`,
    `sortOfRemoteNG_${version}_windows-aarch64-setup.exe`,
    `sortOfRemoteNG_${version}_windows-aarch64-portable.zip`,
    `sortOfRemoteNG_${version}_windows-x86_64.msi`,
    `sortOfRemoteNG_${version}_windows-x86_64-setup.exe`,
    `sortOfRemoteNG_${version}_windows-x86_64-portable.zip`,
    ...BUILD_TARGETS.map(
      (target) => `sortOfRemoteNG_${version}_${target}.provenance.json`,
    ),
    "latest.json",
  ];
  if (updaterMode === "signed") {
    // Every updater manifest key contributes a detached `.sig`, including the
    // per-installer `.msi` keys. The `.msi`/`-setup.exe` payloads themselves are
    // already listed above; only the macOS `.app.tar.gz` updater payload is extra.
    const updaterArtifacts = UPDATER_PLATFORMS.map((platform) =>
      UPDATER_ARTIFACTS[platform](version),
    );
    names.push(
      ...updaterArtifacts.filter((name) => name.endsWith(".app.tar.gz")),
      ...updaterArtifacts.map((name) => `${name}.sig`),
    );
  }
  return [...new Set(names)].sort();
}

function readJson(filePath, errors, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateProvenance(assetDir, version, updaterMode, errors) {
  for (const target of BUILD_TARGETS) {
    const fileName = `sortOfRemoteNG_${version}_${target}.provenance.json`;
    const provenance = readJson(
      path.join(assetDir, fileName),
      errors,
      fileName,
    );
    if (!provenance) continue;
    if (provenance.target !== target) {
      errors.push(`${fileName} target must equal ${target}.`);
    }
    if (provenance.updater_signing !== (updaterMode === "signed")) {
      errors.push(
        `${fileName} updater_signing must be ${updaterMode === "signed"}.`,
      );
    }
    const allowedOsSigning = target.startsWith("linux-")
      ? ["not-applicable"]
      : target.startsWith("darwin-")
        ? ["developer-id-verified", "unsigned"]
        : ["authenticode-verified", "unsigned"];
    if (!allowedOsSigning.includes(provenance.os_signing)) {
      errors.push(
        `${fileName} os_signing must be one of ${allowedOsSigning.join(", ")}.`,
      );
    }
    if (target.startsWith("linux-")) {
      const expectedArch = target.endsWith("aarch64") ? "aarch64" : "x86_64";
      const expectedRpm = {
        filename: `sortOfRemoteNG_${version}_${target}.rpm`,
        version,
        arch: expectedArch,
      };
      const expectedFlatpak = {
        filename: `sortOfRemoteNG_${version}_${target}.flatpak`,
        arch: expectedArch,
        app_ref: `app/com.sortofremote.ng/${expectedArch}/stable`,
        runtime_ref: `runtime/org.gnome.Platform/${expectedArch}/50`,
        sdk_ref: `runtime/org.gnome.Sdk/${expectedArch}/50`,
        builder_version: "1.4.2",
        manifest_path: "packaging/flatpak/com.sortofremote.ng.yml",
        resource_path: "/app/bin/resources/opkssh",
      };
      const linuxPackages = provenance.linux_packages;
      if (!linuxPackages || typeof linuxPackages !== "object") {
        errors.push(`${fileName} must contain linux_packages metadata.`);
        continue;
      }
      for (const [key, expected] of Object.entries(expectedRpm)) {
        if (linuxPackages.rpm?.[key] !== expected) {
          errors.push(
            `${fileName} linux_packages.rpm.${key} must equal ${expected}.`,
          );
        }
      }
      for (const [key, expected] of Object.entries(expectedFlatpak)) {
        if (linuxPackages.flatpak?.[key] !== expected) {
          errors.push(
            `${fileName} linux_packages.flatpak.${key} must equal ${expected}.`,
          );
        }
      }
      for (const key of ["runtime_commit", "sdk_commit", "manifest_sha256"]) {
        if (!/^[0-9a-f]{64}$/u.test(linuxPackages.flatpak?.[key] ?? "")) {
          errors.push(
            `${fileName} linux_packages.flatpak.${key} must be a lowercase SHA-256 value.`,
          );
        }
      }
    } else if (provenance.linux_packages !== undefined) {
      errors.push(`${fileName} must not contain linux_packages metadata.`);
    }
  }
}

export function validatePublishedReleaseAssets({
  assetDir,
  expectedReleaseBaseUrl,
  expectedVersion,
  updaterMode,
  verifySignature,
}) {
  const errors = [];
  if (updaterMode !== "signed" && updaterMode !== "unsigned") {
    return [
      `Updater mode must be signed or unsigned, received ${updaterMode}.`,
    ];
  }
  if (
    typeof expectedReleaseBaseUrl !== "string" ||
    !expectedReleaseBaseUrl.trim()
  ) {
    errors.push(
      "Expected release base URL is required for published asset validation.",
    );
  }

  const expectedNames = expectedAssetNames(expectedVersion, updaterMode);
  const actualNames = readdirSync(assetDir)
    .filter((name) => statSync(path.join(assetDir, name)).isFile())
    .sort();
  const missing = expectedNames.filter((name) => !actualNames.includes(name));
  const unexpected = actualNames.filter(
    (name) => !expectedNames.includes(name),
  );
  if (missing.length > 0) errors.push(`Missing assets: ${missing.join(", ")}.`);
  if (unexpected.length > 0) {
    errors.push(`Unexpected assets: ${unexpected.join(", ")}.`);
  }
  for (const name of actualNames) {
    if (statSync(path.join(assetDir, name)).size === 0) {
      errors.push(`${name} must not be empty.`);
    }
  }

  errors.push(...validateReleaseArtifactNames(actualNames, expectedVersion));
  validateProvenance(assetDir, expectedVersion, updaterMode, errors);

  if (updaterMode === "signed") {
    // Fail closed: a signed release whose caller forgot the minisign verifier would
    // otherwise publish an unverified updater payload without a single error.
    if (typeof verifySignature !== "function") {
      errors.push(
        "Signed validation requires a signature verifier for every updater payload.",
      );
    }
  }

  if (missing.length === 0) {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = readJson(feedPath, errors, "latest.json");
    if (feed) {
      errors.push(
        ...validateUpdaterFeed(feed, {
          allowEmptySignatures: updaterMode === "unsigned",
          distDir: assetDir,
          expectedReleaseBaseUrl,
          expectedVersion,
          requiredPlatforms: UPDATER_PLATFORMS,
          requireSignatureFiles: updaterMode === "signed",
          updaterSigning: updaterMode,
        }),
      );
      const feedPlatforms = Object.keys(feed.platforms ?? {}).sort();
      if (feedPlatforms.join("\n") !== UPDATER_PLATFORMS.join("\n")) {
        errors.push("latest.json must contain exactly the supported targets.");
      }
      for (const platform of UPDATER_PLATFORMS) {
        const expectedArtifact = updaterArtifactName(
          platform,
          expectedVersion,
          updaterMode,
        );
        try {
          const actualArtifact = path.posix.basename(
            new URL(feed.platforms?.[platform]?.url).pathname,
          );
          if (decodeURIComponent(actualArtifact) !== expectedArtifact) {
            errors.push(
              `latest.json platform ${platform} must reference ${expectedArtifact}.`,
            );
          }
        } catch {
          // validateUpdaterFeed already reports missing or malformed URLs.
        }
      }
      if (updaterMode === "signed" && typeof verifySignature === "function") {
        for (const platform of UPDATER_PLATFORMS) {
          const artifactName = UPDATER_ARTIFACTS[platform](expectedVersion);
          try {
            verifySignature(
              path.join(assetDir, artifactName),
              path.join(assetDir, `${artifactName}.sig`),
            );
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
    }
  }

  return errors;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    const separator = arg.indexOf("=");
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const value =
      separator === -1 ? argv[(index += 1)] : arg.slice(separator + 1);
    if (!value) throw new Error(`${name} requires a value.`);
    const property = {
      "--asset-dir": "assetDir",
      "--expected-release-base-url": "expectedReleaseBaseUrl",
      "--expected-version": "expectedVersion",
      "--updater-mode": "updaterMode",
      "--public-key-config": "publicKeyConfig",
      "--signature-verifier": "signatureVerifier",
    }[name];
    if (!property) throw new Error(`Unknown option: ${name}`);
    options[property] = value;
  }
  return options;
}

const USAGE = `Usage: node scripts/ci/verify-published-release-assets.mjs [options]

Options:
  --asset-dir <dir>             Directory containing the exact release asset set.
  --expected-release-base-url <url>
                                Exact HTTPS release directory required by every feed URL.
  --expected-version <semver>   Expected machine SemVer in every bundle filename/feed.
  --updater-mode <mode>         signed or unsigned.
  --public-key-config <file>    Tauri JSON config containing plugins.updater.pubkey.
  --signature-verifier <file>   Minisign verifier executable (required when signed).
`;

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    const requiredOptions = {
      assetDir: "--asset-dir",
      expectedReleaseBaseUrl: "--expected-release-base-url",
      expectedVersion: "--expected-version",
      updaterMode: "--updater-mode",
    };
    for (const [property, flag] of Object.entries(requiredOptions)) {
      if (!options[property]) throw new Error(`${flag} is required.`);
    }

    let verifySignature;
    if (options.updaterMode === "signed") {
      if (!options.publicKeyConfig || !options.signatureVerifier) {
        throw new Error(
          "Signed validation requires --public-key-config and --signature-verifier.",
        );
      }
      const config = JSON.parse(readFileSync(options.publicKeyConfig, "utf8"));
      const publicKey = config?.plugins?.updater?.pubkey;
      if (typeof publicKey !== "string" || !publicKey.trim()) {
        throw new Error("Tauri updater public key is missing.");
      }
      if (!existsSync(options.signatureVerifier)) {
        throw new Error(
          `Signature verifier ${options.signatureVerifier} does not exist.`,
        );
      }
      verifySignature = (artifactPath, signaturePath) => {
        const result = spawnSync(
          options.signatureVerifier,
          [publicKey, artifactPath, signaturePath],
          { encoding: "utf8" },
        );
        if (result.status !== 0) {
          throw new Error(
            `Cryptographic verification failed for ${path.basename(artifactPath)}: ${(result.stderr || result.stdout).trim()}`,
          );
        }
      };
    }

    const errors = validatePublishedReleaseAssets({
      ...options,
      assetDir: path.resolve(options.assetDir),
      verifySignature,
    });
    if (errors.length > 0) {
      console.error(`Invalid release assets in ${options.assetDir}:`);
      for (const error of errors) console.error(`- ${error}`);
      process.exit(1);
    }
    console.log(
      `Verified exact ${options.updaterMode} release asset set in ${options.assetDir}.`,
    );
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(1);
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}
