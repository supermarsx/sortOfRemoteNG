#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseSnapshot } from "./resolve-release-version.mjs";

export function parseArgs(argv) {
  const options = {
    githubOutput: null,
    publicVersion: null,
    repo: ".",
    snapshotCommit: null,
    sourceSha: null,
    tag: null,
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
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      options.repo = readValue("--repo");
    } else if (arg === "--tag" || arg.startsWith("--tag=")) {
      options.tag = readValue("--tag");
    } else if (
      arg === "--snapshot-commit" ||
      arg.startsWith("--snapshot-commit=")
    ) {
      options.snapshotCommit = readValue("--snapshot-commit");
    } else if (arg === "--source-sha" || arg.startsWith("--source-sha=")) {
      options.sourceSha = readValue("--source-sha");
    } else if (
      arg === "--public-version" ||
      arg.startsWith("--public-version=")
    ) {
      options.publicVersion = readValue("--public-version");
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

const USAGE = `Usage: node scripts/ci/verify-release-snapshot.mjs [options]

Required:
  --tag <YY.N>              Local immutable public tag to verify.
  --snapshot-commit <sha>   Expected tag target snapshot commit.
  --source-sha <sha>        Expected sole parent and trailer source.
  --public-version <YY.N>   Expected public and machine projection.

Options:
  --repo <path>             Git repository (default: .).
  --github-output <path>    Append verified snapshot metadata outputs.
  --help                    Show this help text.
`;

function renderOutput(result) {
  return [
    `verified=${result.verified}`,
    `source_sha=${result.sourceSha}`,
    `snapshot_commit=${result.snapshotCommit}`,
    `snapshot_tree=${result.snapshotTree}`,
    `public_version=${result.publicVersion}`,
    `public_tag=${result.publicTag}`,
  ].join("\n");
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    for (const [name, value] of [
      ["--tag", options.tag],
      ["--snapshot-commit", options.snapshotCommit],
      ["--source-sha", options.sourceSha],
      ["--public-version", options.publicVersion],
    ]) {
      if (!value) throw new Error(`${name} is required.`);
    }

    const result = verifyReleaseSnapshot({
      repo: options.repo,
      tag: options.tag,
      snapshotCommit: options.snapshotCommit,
      sourceSha: options.sourceSha,
      publicVersion: options.publicVersion,
    });
    const output = renderOutput(result);
    if (options.githubOutput) {
      appendFileSync(options.githubOutput, `${output}\n`, "utf8");
    }
    console.log(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}
