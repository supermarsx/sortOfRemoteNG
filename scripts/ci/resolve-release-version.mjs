#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectVersion } from "../versioning.mjs";

export const PUBLIC_RELEASE_TAG_PATTERN = /^v[0-9]{2}\.[1-9][0-9]*$/;

export function resolveReleaseVersion(tag, versionAuthority) {
  if (typeof tag !== "string" || !PUBLIC_RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      `Invalid release tag ${JSON.stringify(tag)}; expected vYY.N with N >= 1 (for example v26.1)`,
    );
  }

  const projection = projectVersion(versionAuthority);
  const tagPublicVersion = tag.slice(1);
  if (tagPublicVersion !== projection.publicVersion) {
    throw new Error(
      `Release tag ${tag} does not match version.json public version ${projection.publicVersion}`,
    );
  }

  return {
    publicTag: tag,
    publicVersion: projection.publicVersion,
    machineVersion: projection.machineVersion,
  };
}

export function parseArgs(argv) {
  const options = {
    githubOutput: null,
    tag: null,
    versionFile: "version.json",
  };

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
    } else if (arg === "--tag" || arg.startsWith("--tag=")) {
      options.tag = readValue("--tag");
    } else if (arg === "--version-file" || arg.startsWith("--version-file=")) {
      options.versionFile = readValue("--version-file");
    } else if (
      arg === "--github-output" ||
      arg.startsWith("--github-output=")
    ) {
      options.githubOutput = readValue("--github-output");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

const USAGE = `Usage: node scripts/ci/resolve-release-version.mjs --tag <vYY.N> [options]

Options:
  --version-file <path>    Public version authority (default: version.json).
  --github-output <path>   Append public_tag, public_version, and machine_version outputs.
  --help                   Show this help text.
`;

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    if (!options.tag) throw new Error("--tag is required.");

    const authority = JSON.parse(readFileSync(options.versionFile, "utf8"));
    const resolved = resolveReleaseVersion(options.tag, authority.version);
    const output = [
      `public_tag=${resolved.publicTag}`,
      `public_version=${resolved.publicVersion}`,
      `machine_version=${resolved.machineVersion}`,
    ].join("\n");

    if (options.githubOutput) {
      appendFileSync(options.githubOutput, `${output}\n`, "utf8");
    }
    console.log(output);
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
