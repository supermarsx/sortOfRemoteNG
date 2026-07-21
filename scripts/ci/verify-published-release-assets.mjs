#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateReleaseArtifactNames } from "./validate-release-artifacts.mjs";
import { validateUpdaterFeed } from "./validate-updater-feed.mjs";

export const UPDATER_ARTIFACTS = {
  "darwin-aarch64": (version) =>
    `sortOfRemoteNG_${version}_darwin-aarch64.app.tar.gz`,
  "darwin-x86_64": (version) =>
    `sortOfRemoteNG_${version}_darwin-x86_64.app.tar.gz`,
  "linux-x86_64": (version) =>
    `sortOfRemoteNG_${version}_linux-x86_64.AppImage`,
  "windows-x86_64": (version) =>
    `sortOfRemoteNG_${version}_windows-x86_64-setup.exe`,
};

const TARGETS = Object.keys(UPDATER_ARTIFACTS).sort();

export function expectedAssetNames(version, updaterMode) {
  const names = [
    `sortOfRemoteNG_${version}_linux-x86_64.AppImage`,
    `sortOfRemoteNG_${version}_linux-x86_64.deb`,
    `sortOfRemoteNG_${version}_darwin-aarch64.dmg`,
    `sortOfRemoteNG_${version}_darwin-x86_64.dmg`,
    `sortOfRemoteNG_${version}_windows-x86_64.msi`,
    `sortOfRemoteNG_${version}_windows-x86_64-setup.exe`,
    ...TARGETS.map(
      (target) => `sortOfRemoteNG_${version}_${target}.provenance.json`,
    ),
  ];
  if (updaterMode === "signed") {
    const updaterArtifacts = TARGETS.map((target) =>
      UPDATER_ARTIFACTS[target](version),
    );
    names.push(
      ...updaterArtifacts.filter((name) => name.endsWith(".app.tar.gz")),
      ...updaterArtifacts.map((name) => `${name}.sig`),
      "latest.json",
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
  for (const target of TARGETS) {
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
    const allowedOsSigning =
      target === "linux-x86_64"
        ? ["not-applicable"]
        : target.startsWith("darwin-")
          ? ["developer-id-verified", "unsigned"]
          : ["authenticode-verified", "unsigned"];
    if (!allowedOsSigning.includes(provenance.os_signing)) {
      errors.push(
        `${fileName} os_signing must be one of ${allowedOsSigning.join(", ")}.`,
      );
    }
  }
}

export function validatePublishedReleaseAssets({
  assetDir,
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

  if (updaterMode === "signed" && missing.length === 0) {
    const feedPath = path.join(assetDir, "latest.json");
    const feed = readJson(feedPath, errors, "latest.json");
    if (feed) {
      errors.push(
        ...validateUpdaterFeed(feed, {
          distDir: assetDir,
          expectedVersion,
          requiredPlatforms: TARGETS,
          requireSignatureFiles: true,
        }),
      );
      const feedTargets = Object.keys(feed.platforms ?? {}).sort();
      if (feedTargets.join("\n") !== TARGETS.join("\n")) {
        errors.push(
          "latest.json must contain exactly the four supported targets.",
        );
      }
      for (const target of TARGETS) {
        const expectedArtifact = UPDATER_ARTIFACTS[target](expectedVersion);
        try {
          const actualArtifact = path.posix.basename(
            new URL(feed.platforms?.[target]?.url).pathname,
          );
          if (decodeURIComponent(actualArtifact) !== expectedArtifact) {
            errors.push(
              `latest.json platform ${target} must reference ${expectedArtifact}.`,
            );
          }
        } catch {
          // validateUpdaterFeed already reports missing or malformed URLs.
        }
      }
      if (verifySignature) {
        for (const target of TARGETS) {
          const artifactName = UPDATER_ARTIFACTS[target](expectedVersion);
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
    for (const required of ["assetDir", "expectedVersion", "updaterMode"]) {
      if (!options[required]) throw new Error(`--${required} is required.`);
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
