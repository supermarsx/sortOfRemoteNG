#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CARGO_UPDATE_ARTIFACT = "src-tauri/Cargo.lock";

function normalizePaths(paths) {
  return [...new Set(paths.map((entry) => entry.replaceAll("\\", "/")))].sort();
}

export function assertCargoUpdateBoundary({
  changedPaths = [],
  untrackedPaths = [],
} = {}) {
  const changed = normalizePaths(changedPaths);
  const untracked = normalizePaths(untrackedPaths);
  const escaped = [...changed, ...untracked].filter(
    (entry) => entry !== CARGO_UPDATE_ARTIFACT,
  );

  if (escaped.length > 0) {
    throw new Error(
      `Cargo update touched files outside ${CARGO_UPDATE_ARTIFACT}: ${[
        ...new Set(escaped),
      ].join(", ")}`,
    );
  }
  if (untracked.includes(CARGO_UPDATE_ARTIFACT)) {
    throw new Error(
      `${CARGO_UPDATE_ARTIFACT} must remain a tracked repository file.`,
    );
  }

  return {
    changed: changed.includes(CARGO_UPDATE_ARTIFACT),
    files: changed.includes(CARGO_UPDATE_ARTIFACT)
      ? [CARGO_UPDATE_ARTIFACT]
      : [],
  };
}

function splitNullDelimited(output) {
  return output.split("\0").filter(Boolean);
}

function runGit(repo, args) {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "core.quotepath=false", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function cargoLockSha256(repo = ".") {
  const repositoryRoot = fs.realpathSync(path.resolve(repo));
  const lockPath = path.resolve(repositoryRoot, CARGO_UPDATE_ARTIFACT);
  const lockStat = fs.lstatSync(lockPath);
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
    throw new Error(`${CARGO_UPDATE_ARTIFACT} must be a regular file.`);
  }
  return createHash("sha256").update(fs.readFileSync(lockPath)).digest("hex");
}

export function inspectCargoUpdateCandidate(repo = ".") {
  const repositoryRoot = fs.realpathSync(path.resolve(repo));
  const changedPaths = splitNullDelimited(
    runGit(repositoryRoot, [
      "diff",
      "--name-only",
      "--no-ext-diff",
      "-z",
      "HEAD",
      "--",
    ]),
  );
  const untrackedPaths = splitNullDelimited(
    runGit(repositoryRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
    ]),
  );
  const boundary = assertCargoUpdateBoundary({ changedPaths, untrackedPaths });
  return {
    ...boundary,
    sha256: cargoLockSha256(repositoryRoot),
  };
}

export function assertCandidateSeal(actualSha256, expectedSha256) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) {
    throw new Error(
      "Expected candidate seal must be a lowercase SHA-256 digest.",
    );
  }
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Cargo update candidate seal changed: expected ${expectedSha256}, received ${actualSha256}.`,
    );
  }
}

function normalizedOperation(operation) {
  return operation || "none";
}

export function validatePullRequestDeliveryState(state) {
  const {
    changed,
    outcome,
    pullRequestNumber = "",
    pullRequestUrl = "",
    openPullRequests = [],
    remoteFiles = [],
    remoteCargoLockSha256 = "",
    expectedSha256 = "",
    actionHeadSha = "",
    initialHeadSha = "",
    finalHeadSha = "",
    sourceSha = "",
    beforeMainSha = "",
    afterMainSha = "",
    repository = "",
  } = state;
  const operation = normalizedOperation(state.operation);

  if (outcome !== "success") {
    throw new Error(
      `create-pull-request outcome must be success; received ${outcome || "skipped"}.`,
    );
  }
  if (!Array.isArray(openPullRequests)) {
    throw new TypeError("openPullRequests must be an array.");
  }
  if (
    !/^[0-9a-f]{40}$/.test(sourceSha) ||
    beforeMainSha !== sourceSha ||
    afterMainSha !== sourceSha
  ) {
    throw new Error(
      "The main branch must equal the immutable candidate source before and after delivery.",
    );
  }

  if (!changed) {
    if (!new Set(["closed", "none"]).has(operation)) {
      throw new Error(
        `A no-change run must close an obsolete fixed-branch PR or no-op; operation was ${operation}.`,
      );
    }
    if (openPullRequests.length !== 0) {
      throw new Error(
        `A no-change run requires exactly zero open fixed-branch PRs; found ${openPullRequests.length}.`,
      );
    }
    return { changed: false, operation, pullRequest: null };
  }

  if (!new Set(["created", "updated", "none"]).has(operation)) {
    throw new Error(
      `A changed run must create, update, or reuse the fixed-branch PR; operation was ${operation}.`,
    );
  }
  if (!/^\d+$/.test(String(pullRequestNumber)) || !pullRequestUrl) {
    throw new Error(
      `A changed ${operation} result requires a nonempty pull-request number and URL.`,
    );
  }
  if (openPullRequests.length !== 1) {
    throw new Error(
      `A changed run requires exactly one open fixed-branch PR; found ${openPullRequests.length}.`,
    );
  }

  const pullRequest = openPullRequests[0];
  const number = Number(pullRequestNumber);
  const expectedUrl = `https://github.com/${repository}/pull/${number}`;
  if (
    pullRequest.number !== number ||
    pullRequest.url !== pullRequestUrl ||
    pullRequestUrl !== expectedUrl
  ) {
    throw new Error("create-pull-request identity does not match the open PR.");
  }
  if (
    pullRequest.headRefName !== "automation/cargo-update" ||
    pullRequest.baseRefName !== "main" ||
    pullRequest.baseRefOid !== sourceSha ||
    pullRequest.headRepository !== repository ||
    pullRequest.baseRepository !== repository ||
    pullRequest.isDraft !== true
  ) {
    throw new Error("The open updater PR is not the expected fixed draft PR.");
  }
  if (
    !Array.isArray(remoteFiles) ||
    remoteFiles.length !== 1 ||
    remoteFiles[0] !== CARGO_UPDATE_ARTIFACT
  ) {
    throw new Error(
      `Remote updater PR must change only ${CARGO_UPDATE_ARTIFACT}.`,
    );
  }
  assertCandidateSeal(remoteCargoLockSha256, expectedSha256);
  if (
    !/^[0-9a-f]{40}$/.test(actionHeadSha) ||
    actionHeadSha !== initialHeadSha ||
    initialHeadSha !== pullRequest.headRefOid ||
    finalHeadSha !== initialHeadSha
  ) {
    throw new Error("The updater PR head changed during remote verification.");
  }

  return {
    changed: true,
    operation,
    pullRequest: { number, url: pullRequestUrl },
  };
}

export function parseArgs(argv) {
  const options = {
    repo: ".",
    githubOutput: "",
    expectedSha256: "",
    deliveryState: "",
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

    if (arg === "--repo" || arg.startsWith("--repo=")) {
      options.repo = readValue("--repo");
    } else if (
      arg === "--expect-sha256" ||
      arg.startsWith("--expect-sha256=")
    ) {
      options.expectedSha256 = readValue("--expect-sha256");
    } else if (arg === "--github-output") {
      if (!process.env.GITHUB_OUTPUT) {
        throw new Error(
          "--github-output requires the GITHUB_OUTPUT environment variable.",
        );
      }
      options.githubOutput = process.env.GITHUB_OUTPUT;
    } else if (arg.startsWith("--github-output=")) {
      options.githubOutput = readValue("--github-output");
    } else if (
      arg === "--delivery-state" ||
      arg.startsWith("--delivery-state=")
    ) {
      options.deliveryState = readValue("--delivery-state");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function run(options = {}) {
  if (options.deliveryState) {
    const state = JSON.parse(fs.readFileSync(options.deliveryState, "utf8"));
    const result = validatePullRequestDeliveryState(state);
    console.log(
      result.pullRequest
        ? `Verified Cargo updater PR #${result.pullRequest.number}.`
        : "Verified zero open Cargo updater PRs after no-change reconciliation.",
    );
    return result;
  }

  const candidate = inspectCargoUpdateCandidate(options.repo ?? ".");
  if (options.expectedSha256) {
    assertCandidateSeal(candidate.sha256, options.expectedSha256);
  }
  if (options.githubOutput) {
    fs.appendFileSync(
      options.githubOutput,
      `changed=${candidate.changed}\ncandidate-sha256=${candidate.sha256}\n`,
      "utf8",
    );
  }
  console.log(
    candidate.changed
      ? `Validated sealed Cargo update candidate ${candidate.sha256}.`
      : `Cargo.lock is unchanged; validated no-change seal ${candidate.sha256}.`,
  );
  return candidate;
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
