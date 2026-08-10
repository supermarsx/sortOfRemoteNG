#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_RELEASE_TAG_PATTERN } from "./resolve-release-version.mjs";
import { projectVersion } from "../versioning.mjs";

function compareProjectedVersions(left, right) {
  if (left.year !== right.year) return left.year - right.year;
  return left.release - right.release;
}

export function highestAllocatedReleaseTag(tagNames) {
  if (!Array.isArray(tagNames)) {
    throw new TypeError("tagNames must be an array.");
  }

  const seen = new Set();
  let highest = null;
  for (const tagName of tagNames) {
    if (typeof tagName !== "string") continue;
    const normalized = tagName.trim();
    if (!PUBLIC_RELEASE_TAG_PATTERN.test(normalized)) continue;
    if (seen.has(normalized)) {
      throw new Error(`Duplicate allocated release tag ${normalized}`);
    }
    seen.add(normalized);

    const projection = projectVersion(normalized);
    if (!Number.isSafeInteger(projection.release)) {
      throw new Error(
        `Allocated release tag ${normalized} has a counter outside the supported integer range`,
      );
    }
    if (highest === null || compareProjectedVersions(projection, highest) > 0) {
      highest = projection;
    }
  }
  return highest?.publicVersion ?? "";
}

export function validateCanonicalVersionFloor({ canonicalVersion, tagNames }) {
  const canonical = projectVersion(canonicalVersion);
  if (!Number.isSafeInteger(canonical.release)) {
    throw new Error(
      `Canonical version ${canonical.publicVersion} has a counter outside the supported integer range`,
    );
  }
  const allocatedVersionFloor = highestAllocatedReleaseTag(tagNames);
  if (!allocatedVersionFloor) {
    return {
      canonicalVersion: canonical.publicVersion,
      allocatedVersionFloor: "",
    };
  }

  const floor = projectVersion(allocatedVersionFloor);
  if (compareProjectedVersions(canonical, floor) < 0) {
    throw new Error(
      `Canonical version ${canonical.publicVersion} is below highest allocated release tag ${floor.publicVersion}. ` +
        "Strict release tags remain consumed even when publication fails. " +
        `Run \`node scripts/sync-version.mjs --write --version ${floor.publicVersion}\` and commit the complete projection.`,
    );
  }

  return {
    canonicalVersion: canonical.publicVersion,
    allocatedVersionFloor: floor.publicVersion,
  };
}

export function readLocalReleaseTagNames(repo) {
  const output = execFileSync("git", ["-C", repo, "tag", "--list"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output ? output.split(/\r?\n/) : [];
}

export function parseArgs(argv) {
  const options = { repo: ".", versionFile: "version.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++index];
      if (!value) throw new Error(`${name} requires a value.`);
      return value;
    };

    if (arg === "--repo" || arg.startsWith("--repo=")) {
      options.repo = readValue("--repo");
    } else if (arg === "--version-file" || arg.startsWith("--version-file=")) {
      options.versionFile = readValue("--version-file");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function run({ repo = ".", versionFile = "version.json" } = {}) {
  const authorityPath = path.resolve(repo, versionFile);
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  const result = validateCanonicalVersionFloor({
    canonicalVersion: authority.version,
    tagNames: readLocalReleaseTagNames(repo),
  });
  if (result.allocatedVersionFloor) {
    console.log(
      `Canonical version ${result.canonicalVersion} satisfies allocated release floor ${result.allocatedVersionFloor}.`,
    );
  } else {
    console.log(
      `Canonical version ${result.canonicalVersion} is valid; no allocated release tags exist.`,
    );
  }
  return result;
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Usage: node scripts/ci/check-release-version-floor.mjs [--repo <path>] [--version-file <path>]",
    );
    process.exitCode = 1;
  }
}
