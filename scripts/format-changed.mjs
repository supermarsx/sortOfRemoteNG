#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv.includes("--write") ? "write" : "check";
const prettierEntrypoint = fileURLToPath(
  new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url),
);

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "pipe" : "inherit"],
  });
  if (result.status !== 0) {
    if (options.allowFailure) return "";
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function lines(output) {
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(items)];
}

function existingFiles(files) {
  return files.filter((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

function prBaseFiles() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) return [];
  const remoteRef = `origin/${baseRef}`;
  const mergeBase = runGit(["merge-base", "HEAD", remoteRef], {
    allowFailure: true,
    quiet: true,
  });
  if (!mergeBase) return [];
  return lines(
    runGit([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      `${mergeBase}...HEAD`,
    ]),
  );
}

function ciPushFiles() {
  if (!process.env.CI) return [];
  const parent = runGit(["rev-parse", "HEAD^"], {
    allowFailure: true,
    quiet: true,
  });
  if (!parent) return [];
  return lines(
    runGit(["diff", "--name-only", "--diff-filter=ACMR", `${parent}...HEAD`]),
  );
}

function localFiles() {
  return [
    ...lines(
      runGit(["diff", "--name-only", "--diff-filter=ACMR"], { quiet: true }),
    ),
    ...lines(
      runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
        quiet: true,
      }),
    ),
    ...lines(
      runGit(["ls-files", "--others", "--exclude-standard"], { quiet: true }),
    ),
  ];
}

const files = existingFiles(
  unique([...prBaseFiles(), ...ciPushFiles(), ...localFiles()]),
);

if (files.length === 0) {
  console.log("No changed files to format.");
  process.exit(0);
}

let exitCode = 0;
for (let i = 0; i < files.length; i += 100) {
  const chunk = files.slice(i, i + 100);
  const args = [
    mode === "write" ? "--write" : "--check",
    "--ignore-unknown",
    ...chunk,
  ];
  const result = spawnSync(process.execPath, [prettierEntrypoint, ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) exitCode = result.status ?? 1;
}

process.exit(exitCode);
