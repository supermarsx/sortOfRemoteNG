#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectVersion } from "../versioning.mjs";

export const PUBLIC_RELEASE_TAG_PATTERN = /^(\d{2})\.([1-9][0-9]*)$/;
export const RELEASE_SOURCE_TRAILER = "Release-Source-SHA";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function utcReleaseYear(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new TypeError("Release date must be a valid Date.");
  }
  return String(date.getUTCFullYear() % 100).padStart(2, "0");
}

function normalizeSourceSha(sourceSha) {
  if (typeof sourceSha !== "string" || !COMMIT_SHA_PATTERN.test(sourceSha)) {
    throw new Error(
      `Invalid source SHA ${JSON.stringify(sourceSha)}; expected a full 40-character commit SHA`,
    );
  }
  return sourceSha.toLowerCase();
}

function validateYear(year) {
  if (typeof year !== "string" || !/^[0-9]{2}$/.test(year)) {
    throw new Error(
      `Invalid release year ${JSON.stringify(year)}; expected YY`,
    );
  }
  return year;
}

export function parseReleaseSourceSha(message) {
  if (typeof message !== "string") {
    throw new TypeError("Snapshot commit message must be a string.");
  }

  const trailerPattern = new RegExp(
    `^${RELEASE_SOURCE_TRAILER}:[ \\t]*(\\S+)[ \\t]*$`,
    "gm",
  );
  const values = [...message.matchAll(trailerPattern)].map((match) => match[1]);
  if (values.length === 0) return null;
  if (values.length !== 1) {
    throw new Error(
      `Snapshot commit has ${values.length} ${RELEASE_SOURCE_TRAILER} trailers; expected exactly one`,
    );
  }
  return normalizeSourceSha(values[0]);
}

export function resolveReleaseVersion(tag, versionAuthority) {
  if (typeof tag !== "string" || !PUBLIC_RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      `Invalid release tag ${JSON.stringify(tag)}; expected bare YY.N with N >= 1 (for example 26.1)`,
    );
  }

  const projection = projectVersion(versionAuthority);
  if (tag !== projection.publicVersion) {
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

/**
 * Resolve an idempotent rolling-release plan from locally visible tag records.
 * Malformed tags are intentionally ignored. Every valid YY.N tag is scanned
 * for same-source reuse across year boundaries, while only the selected UTC
 * year's counters participate in next-version allocation. Valid public tag
 * state is validated strictly and any source ambiguity fails closed.
 */
export function resolveRollingRelease({
  tagRecords,
  sourceSha,
  year = utcReleaseYear(),
  requestedTag = null,
}) {
  if (!Array.isArray(tagRecords)) {
    throw new TypeError("tagRecords must be an array.");
  }

  const normalizedSourceSha = normalizeSourceSha(sourceSha);
  const releaseYear = validateYear(year);
  const seenTags = new Set();
  const seenSources = new Map();
  const releases = [];

  for (const record of tagRecords) {
    if (!record || typeof record.name !== "string") continue;
    const match = PUBLIC_RELEASE_TAG_PATTERN.exec(record.name);
    if (!match) continue;

    if (seenTags.has(record.name)) {
      throw new Error(`Duplicate release tag record ${record.name}`);
    }
    seenTags.add(record.name);

    const counter = Number(match[2]);
    if (!Number.isSafeInteger(counter)) {
      throw new Error(
        `Release tag ${record.name} has a counter outside the supported integer range`,
      );
    }

    const snapshotCommit = normalizeSourceSha(record.commitSha);
    const taggedSourceSha = parseReleaseSourceSha(record.message);
    if (!taggedSourceSha) {
      throw new Error(
        `Release tag ${record.name} targets ${snapshotCommit}, whose snapshot commit is missing ${RELEASE_SOURCE_TRAILER}`,
      );
    }

    if (!Array.isArray(record.parentShas) || record.parentShas.length !== 1) {
      throw new Error(
        `Release tag ${record.name} snapshot ${snapshotCommit} must have exactly one parent`,
      );
    }
    const parentSha = normalizeSourceSha(record.parentShas[0]);
    if (parentSha !== taggedSourceSha) {
      throw new Error(
        `Release tag ${record.name} snapshot parent ${parentSha} does not match trailer source ${taggedSourceSha}`,
      );
    }
    if (record.publicVersion !== record.name) {
      throw new Error(
        `Release tag ${record.name} snapshot version.json contains ${JSON.stringify(record.publicVersion)}`,
      );
    }
    const expectedMachineVersion = `${record.name}.0`;
    if (record.machineVersion !== expectedMachineVersion) {
      throw new Error(
        `Release tag ${record.name} snapshot package.json contains ${JSON.stringify(record.machineVersion)}; expected ${expectedMachineVersion}`,
      );
    }

    const previousTag = seenSources.get(taggedSourceSha);
    if (previousTag) {
      throw new Error(
        `Conflicting release state: source ${taggedSourceSha} is identified by both ${previousTag} and ${record.name}`,
      );
    }
    seenSources.set(taggedSourceSha, record.name);

    releases.push({
      counter,
      name: record.name,
      parentSha,
      snapshotCommit,
      sourceSha: taggedSourceSha,
      year: match[1],
    });
  }

  if (requestedTag !== null) {
    if (
      typeof requestedTag !== "string" ||
      !PUBLIC_RELEASE_TAG_PATTERN.test(requestedTag)
    ) {
      throw new Error(
        `Invalid requested release tag ${JSON.stringify(requestedTag)}; expected bare YY.N`,
      );
    }
    const requested = releases.find((release) => release.name === requestedTag);
    if (!requested) {
      throw new Error(
        `Requested existing release tag ${requestedTag} is not present in validated release state`,
      );
    }
    if (requested.sourceSha !== normalizedSourceSha) {
      throw new Error(
        `Release tag ${requestedTag} identifies source ${requested.sourceSha}, not requested source ${normalizedSourceSha}`,
      );
    }
    return releaseResult(requested, "reuse", normalizedSourceSha);
  }

  const existing = releases.find(
    (release) => release.sourceSha === normalizedSourceSha,
  );
  if (existing) return releaseResult(existing, "reuse", normalizedSourceSha);

  const currentYearReleases = releases.filter(
    (release) => release.year === releaseYear,
  );
  const highestCounter = currentYearReleases.reduce((highest, release) => {
    return Math.max(highest, release.counter);
  }, 0);
  if (highestCounter >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Cannot increment release counter ${highestCounter}; supported integer range exhausted`,
    );
  }
  const nextCounter = highestCounter + 1;
  const publicVersion = `${releaseYear}.${nextCounter}`;
  return {
    publicTag: publicVersion,
    publicVersion,
    machineVersion: `${publicVersion}.0`,
    releaseAction: "create",
    sourceSha: normalizedSourceSha,
    snapshotCommit: "",
  };
}

function releaseResult(release, releaseAction, sourceSha) {
  return {
    publicTag: release.name,
    publicVersion: release.name,
    machineVersion: `${release.name}.0`,
    releaseAction,
    sourceSha,
    snapshotCommit: release.snapshotCommit,
  };
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readJsonAtCommit(repo, commitSha, filePath, tagName) {
  let source;
  try {
    source = git(repo, ["show", `${commitSha}:${filePath}`]);
  } catch {
    throw new Error(`Release tag ${tagName} snapshot is missing ${filePath}`);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(
      `Release tag ${tagName} snapshot contains malformed ${filePath}`,
    );
  }
}

export function readLocalReleaseTagRecords(repo) {
  const tagOutput = git(repo, ["tag", "--list"]);
  if (!tagOutput) return [];

  const names = tagOutput.split(/\r?\n/);
  return names
    .filter((name) => PUBLIC_RELEASE_TAG_PATTERN.test(name))
    .map((name) => {
      let commitSha;
      try {
        commitSha = git(repo, ["rev-parse", `${name}^{commit}`]);
      } catch {
        throw new Error(`Release tag ${name} does not resolve to a commit`);
      }
      const commitAndParents = git(repo, [
        "rev-list",
        "--parents",
        "-n",
        "1",
        commitSha,
      ]).split(/\s+/);
      const versionAuthority = readJsonAtCommit(
        repo,
        commitSha,
        "version.json",
        name,
      );
      const packageAuthority = readJsonAtCommit(
        repo,
        commitSha,
        "package.json",
        name,
      );
      return {
        name,
        commitSha,
        message: git(repo, ["show", "-s", "--format=%B", commitSha]),
        parentShas: commitAndParents.slice(1),
        publicVersion: versionAuthority.version,
        machineVersion: packageAuthority.version,
      };
    });
}

function expectedSnapshotTree(repo, sourceSha, publicVersion) {
  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "sorng-release-tree-verification-"),
  );
  const checkout = path.join(tempRoot, "source");
  try {
    execFileSync(
      "git",
      [
        "clone",
        "--quiet",
        "--no-hardlinks",
        "--no-checkout",
        path.resolve(repo),
        checkout,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    git(checkout, ["config", "core.autocrlf", "false"]);
    git(checkout, ["checkout", "--quiet", "--detach", sourceSha]);
    execFileSync(
      process.execPath,
      [
        path.join(checkout, "scripts", "sync-version.mjs"),
        "--write",
        "--version",
        publicVersion,
      ],
      {
        cwd: checkout,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    git(checkout, ["add", "-A"]);
    return normalizeSourceSha(git(checkout, ["write-tree"]));
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(
      `Unable to construct expected release snapshot tree${detail ? `: ${detail}` : ""}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function verifyReleaseSnapshot({
  repo,
  tag,
  snapshotCommit,
  sourceSha,
  publicVersion,
}) {
  if (typeof tag !== "string" || !PUBLIC_RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      `Invalid release tag ${JSON.stringify(tag)}; expected bare YY.N`,
    );
  }
  const projection = projectVersion(publicVersion);
  if (tag !== projection.publicVersion) {
    throw new Error(
      `Release tag ${tag} does not match public version ${projection.publicVersion}`,
    );
  }
  const normalizedSnapshot = normalizeSourceSha(snapshotCommit);
  const normalizedSource = normalizeSourceSha(sourceSha);

  let taggedCommit;
  try {
    taggedCommit = normalizeSourceSha(
      git(repo, ["rev-parse", `refs/tags/${tag}^{commit}`]),
    );
  } catch {
    throw new Error(`Release tag ${tag} does not resolve to a commit`);
  }
  if (taggedCommit !== normalizedSnapshot) {
    throw new Error(
      `Release tag ${tag} resolves to ${taggedCommit}, not snapshot ${normalizedSnapshot}`,
    );
  }

  const commitAndParents = git(repo, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    normalizedSnapshot,
  ]).split(/\s+/);
  if (commitAndParents.length !== 2) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} must have exactly one parent`,
    );
  }
  const parentSha = normalizeSourceSha(commitAndParents[1]);
  if (parentSha !== normalizedSource) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} parent ${parentSha} does not match source ${normalizedSource}`,
    );
  }

  const message = git(repo, ["show", "-s", "--format=%B", normalizedSnapshot]);
  const trailerSource = parseReleaseSourceSha(message);
  if (!trailerSource) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} is missing ${RELEASE_SOURCE_TRAILER}`,
    );
  }
  if (trailerSource !== normalizedSource) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} trailer identifies ${trailerSource}, not source ${normalizedSource}`,
    );
  }

  const versionAuthority = readJsonAtCommit(
    repo,
    normalizedSnapshot,
    "version.json",
    tag,
  );
  if (versionAuthority.version !== projection.publicVersion) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} version.json contains ${JSON.stringify(versionAuthority.version)}; expected ${projection.publicVersion}`,
    );
  }
  const packageAuthority = readJsonAtCommit(
    repo,
    normalizedSnapshot,
    "package.json",
    tag,
  );
  if (packageAuthority.version !== projection.machineVersion) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} package.json contains ${JSON.stringify(packageAuthority.version)}; expected ${projection.machineVersion}`,
    );
  }

  const snapshotTree = normalizeSourceSha(
    git(repo, ["rev-parse", `${normalizedSnapshot}^{tree}`]),
  );
  const expectedTree = expectedSnapshotTree(
    repo,
    normalizedSource,
    projection.publicVersion,
  );
  if (snapshotTree !== expectedTree) {
    throw new Error(
      `Release snapshot ${normalizedSnapshot} tree ${snapshotTree} does not match deterministic version projection tree ${expectedTree}`,
    );
  }

  return {
    verified: true,
    sourceSha: normalizedSource,
    snapshotCommit: normalizedSnapshot,
    snapshotTree,
    publicVersion: projection.publicVersion,
    publicTag: tag,
  };
}

function gitIsAncestor(repo, ancestorSha, descendantSha) {
  try {
    execFileSync(
      "git",
      ["-C", repo, "merge-base", "--is-ancestor", ancestorSha, descendantSha],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) return false;
    throw new Error(
      `Unable to compare release source ancestry ${ancestorSha} -> ${descendantSha}`,
    );
  }
}

export function validateMonotonicReleaseSources({
  tagRecords,
  candidateSourceSha,
  repo = ".",
  isAncestor = (ancestor, descendant) =>
    gitIsAncestor(repo, ancestor, descendant),
}) {
  if (!Array.isArray(tagRecords)) {
    throw new TypeError("tagRecords must be an array.");
  }
  if (typeof isAncestor !== "function") {
    throw new TypeError("isAncestor must be a function.");
  }
  const candidate = normalizeSourceSha(candidateSourceSha);
  const releases = [];
  const seenSources = new Map();

  for (const record of tagRecords) {
    if (!record || typeof record.name !== "string") continue;
    if (!PUBLIC_RELEASE_TAG_PATTERN.test(record.name)) continue;
    const sourceSha = parseReleaseSourceSha(record.message);
    if (!sourceSha) {
      throw new Error(
        `Release tag ${record.name} is missing ${RELEASE_SOURCE_TRAILER}`,
      );
    }
    const previous = seenSources.get(sourceSha);
    if (previous) {
      throw new Error(
        `Conflicting release state: source ${sourceSha} is identified by both ${previous} and ${record.name}`,
      );
    }
    seenSources.set(sourceSha, record.name);
    releases.push({ tag: record.name, sourceSha });
  }

  let latest = null;
  for (const release of releases) {
    if (!latest) {
      latest = release;
      continue;
    }
    const latestBeforeRelease = isAncestor(latest.sourceSha, release.sourceSha);
    const releaseBeforeLatest = isAncestor(release.sourceSha, latest.sourceSha);
    if (latestBeforeRelease === releaseBeforeLatest) {
      throw new Error(
        `Diverged release state: ${latest.tag} source ${latest.sourceSha} and ${release.tag} source ${release.sourceSha} do not form one strict ancestry chain`,
      );
    }
    if (latestBeforeRelease) latest = release;
  }

  for (const release of releases) {
    if (release.sourceSha === candidate) continue;
    const candidateBeforeRelease = isAncestor(candidate, release.sourceSha);
    const releaseBeforeCandidate = isAncestor(release.sourceSha, candidate);
    if (candidateBeforeRelease) {
      throw new Error(
        `Stale release source ${candidate}: released tag ${release.tag} identifies descendant ${release.sourceSha}`,
      );
    }
    if (!releaseBeforeCandidate) {
      throw new Error(
        `Diverged release source ${candidate}: it is not in the ancestry chain of released tag ${release.tag} source ${release.sourceSha}`,
      );
    }
  }

  return {
    sourceGuard: "passed",
    latestReleasedSource: latest?.sourceSha ?? "",
    latestReleaseTag: latest?.tag ?? "",
  };
}

export function parseArgs(argv) {
  const options = {
    githubOutput: null,
    repo: ".",
    sourceSha: null,
    tag: null,
    versionFile: "version.json",
    year: null,
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
    } else if (arg === "--source-sha" || arg.startsWith("--source-sha=")) {
      options.sourceSha = readValue("--source-sha");
    } else if (arg === "--year" || arg.startsWith("--year=")) {
      options.year = readValue("--year");
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      options.repo = readValue("--repo");
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

const USAGE = `Usage:
  node scripts/ci/resolve-release-version.mjs --source-sha <sha> [options]
  node scripts/ci/resolve-release-version.mjs --tag <YY.N> [options]

Rolling options:
  --source-sha <sha>       Exact source commit to release.
  --repo <path>            Git repository with fetched tags (default: .).
  --year <YY>              UTC release year override (tests only by convention).
  --tag <YY.N>             Reuse this existing tag; requires --source-sha.

Tag-validation options:
  --tag <YY.N>             Bare public tag to validate against version.json.
  --version-file <path>    Public version authority (default: version.json).

Common options:
  --github-output <path>   Append release identity and action outputs.
  --help                   Show this help text.
`;

function renderOutput(resolved) {
  const output = [
    `public_tag=${resolved.publicTag}`,
    `public_version=${resolved.publicVersion}`,
    `machine_version=${resolved.machineVersion}`,
  ];
  if (resolved.releaseAction) {
    output.push(
      `release_action=${resolved.releaseAction}`,
      `source_sha=${resolved.sourceSha}`,
      `snapshot_commit=${resolved.snapshotCommit}`,
      `snapshot_tree=${resolved.snapshotTree ?? ""}`,
      `source_guard=${resolved.sourceGuard ?? ""}`,
      `latest_released_source=${resolved.latestReleasedSource ?? ""}`,
      `latest_release_tag=${resolved.latestReleaseTag ?? ""}`,
    );
  }
  return output.join("\n");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }

    let resolved;
    if (options.sourceSha) {
      const year = options.year ?? utcReleaseYear();
      const records = readLocalReleaseTagRecords(options.repo);
      resolved = resolveRollingRelease({
        tagRecords: records,
        sourceSha: options.sourceSha,
        year,
        requestedTag: options.tag,
      });
      const sourceGuard = validateMonotonicReleaseSources({
        tagRecords: records,
        candidateSourceSha: resolved.sourceSha,
        repo: options.repo,
      });
      resolved = { ...resolved, ...sourceGuard };
      let latestVerification = null;
      if (sourceGuard.latestReleaseTag) {
        const latestRecord = records.find(
          (record) => record.name === sourceGuard.latestReleaseTag,
        );
        if (!latestRecord) {
          throw new Error(
            `Latest release tag ${sourceGuard.latestReleaseTag} disappeared from validated tag state`,
          );
        }
        latestVerification = verifyReleaseSnapshot({
          repo: options.repo,
          tag: latestRecord.name,
          snapshotCommit: latestRecord.commitSha,
          sourceSha: sourceGuard.latestReleasedSource,
          publicVersion: latestRecord.name,
        });
      }
      if (resolved.releaseAction === "reuse") {
        if (resolved.publicTag !== sourceGuard.latestReleaseTag) {
          throw new Error(
            `Refusing reuse of non-latest release tag ${resolved.publicTag}`,
          );
        }
        resolved = {
          ...resolved,
          snapshotTree: latestVerification.snapshotTree,
        };
      }
    } else {
      if (!options.tag) throw new Error("--source-sha or --tag is required.");
      if (options.year) {
        throw new Error("--year requires --source-sha.");
      }
      const authority = JSON.parse(readFileSync(options.versionFile, "utf8"));
      resolved = resolveReleaseVersion(options.tag, authority.version);
    }

    const output = renderOutput(resolved);
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
