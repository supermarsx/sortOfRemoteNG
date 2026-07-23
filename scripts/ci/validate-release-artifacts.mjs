#!/usr/bin/env node

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSemVer } from "./semver.mjs";

const BUNDLE_SUFFIXES = [
  ".AppImage",
  ".app.tar.gz",
  ".deb",
  ".dmg",
  ".exe",
  ".flatpak",
  ".msi",
  ".rpm",
  ".zip",
];
const VERSION_TOKEN_PATTERN =
  /(?<!\d)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?!\.\d)/g;

function isBundleArtifact(fileName) {
  return BUNDLE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

export function validateReleaseArtifactNames(fileNames, expectedVersion) {
  const errors = [];
  if (!isSemVer(expectedVersion)) {
    return [
      `Expected version ${JSON.stringify(expectedVersion)} must be valid SemVer.`,
    ];
  }

  const artifacts = fileNames.filter(isBundleArtifact);
  if (artifacts.length === 0) {
    return [
      "Release artifact directory must contain at least one supported bundle.",
    ];
  }

  let expectedVersionSeen = false;
  for (const fileName of artifacts) {
    const versions = [...fileName.matchAll(VERSION_TOKEN_PATTERN)].map(
      (match) => match[0],
    );
    if (versions.includes(expectedVersion)) expectedVersionSeen = true;

    for (const version of versions) {
      if (version !== expectedVersion) {
        errors.push(
          `${fileName} contains version ${version}; expected ${expectedVersion}.`,
        );
      }
    }
  }

  if (!expectedVersionSeen) {
    errors.push(
      `At least one bundle filename must contain the expected machine version ${expectedVersion}.`,
    );
  }

  return errors;
}

export function validateReleaseArtifacts(distDir, expectedVersion) {
  return validateReleaseArtifactNames(readdirSync(distDir), expectedVersion);
}

export function parseArgs(argv) {
  const options = { distDir: null, expectedVersion: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++index];
      if (!value) throw new Error(`${name} requires a value.`);
      return value;
    };

    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--dist-dir" || arg.startsWith("--dist-dir=")) {
      options.distDir = readValue("--dist-dir");
    } else if (
      arg === "--expected-version" ||
      arg.startsWith("--expected-version=")
    ) {
      options.expectedVersion = readValue("--expected-version");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

const USAGE = `Usage: node scripts/ci/validate-release-artifacts.mjs --dist-dir <dir> --expected-version <semver>

Rejects versioned bundle filenames that drift from the expected machine SemVer.
`;

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    if (!options.distDir) throw new Error("--dist-dir is required.");
    if (!options.expectedVersion)
      throw new Error("--expected-version is required.");

    const errors = validateReleaseArtifacts(
      options.distDir,
      options.expectedVersion,
    );
    if (errors.length > 0) {
      console.error(`Invalid release artifacts in ${options.distDir}:`);
      for (const error of errors) console.error(`- ${error}`);
      process.exit(1);
    }
    console.log(
      `Validated release artifacts in ${options.distDir} against ${options.expectedVersion}.`,
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
