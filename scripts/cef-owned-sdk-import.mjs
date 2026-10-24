#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, realpath, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OWNED_REPOSITORY,
  OWNED_WORKFLOW,
  readOwnedImportReview,
  validateLocalHandoff,
  quarantineOwnedBundle,
  ownedImportApi,
  sealOwnedImport,
  importCodeDigest,
  freshLocalHandoff,
} from "./lib/cef-owned-sdk-import.mjs";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
export function importArguments(argv) {
  const args = [...argv],
    mode = args.shift(),
    options = {};
  assert(
    ["plan", "quarantine-upload", "seal"].includes(mode),
    "Closed owned import mode required",
  );
  const fields = {
    "--reviewed": "reviewed",
    "--review-sha256": "reviewSha",
    "--bundle": "bundle",
    "--handoff": "handoff",
    "--commit": "commit",
    "--local-review": "localReview",
    "--inputs": "inputs",
    "--evidence": "evidence",
    "--verify-output": "verifyOutput",
  };
  while (args.length) {
    const key = args.shift();
    if (key === "--execute") {
      assert(!options.execute, "Duplicate execution");
      options.execute = true;
      continue;
    }
    assert(
      fields[key] && args.length && !Object.hasOwn(options, fields[key]),
      "Unknown/duplicate owned import argument",
    );
    options[fields[key]] = args.shift();
  }
  const expected =
    mode === "seal"
      ? []
      : mode === "plan"
        ? ["reviewed", "reviewSha"]
        : [
            "reviewed",
            "reviewSha",
            "bundle",
            "handoff",
            "commit",
            "execute",
            "localReview",
            "inputs",
            "evidence",
            "verifyOutput",
          ];
  assert(
    Object.keys(options).sort().join() === expected.sort().join(),
    "Exact explicit import arguments required",
  );
  return { mode, ...options };
}
function git(args) {
  return execFileSync("git", ["--no-pager", ...args], {
    cwd: ROOT,
    windowsHide: true,
    maxBuffer: 8 * 1024 ** 2,
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function committedReview(relative, reviewSha) {
  const review = await readOwnedImportReview(ROOT, relative, reviewSha);
  const bytes = await readFile(path.join(ROOT, relative));
  assert(
    git(["show", `HEAD:${relative}`]).equals(bytes),
    "Review must be committed raw bytes; preserve namespace -text",
  );
  return review;
}
async function ownCodeDigest() {
  const entries = git([
    "ls-tree",
    "-r",
    "-z",
    "HEAD",
    "--",
    "scripts",
    ".node-version",
    OWNED_WORKFLOW,
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const m = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      assert(m, "Regular committed importer source required");
      return { mode: m[1], type: "blob", sha: m[2], path: m[3] };
    });
  for (const row of entries) {
    const bytes = await readFile(path.join(ROOT, row.path));
    assert(
      createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex") === row.sha,
      "Uncommitted importer code forbidden",
    );
  }
  return importCodeDigest(entries);
}
async function privateOutput(temp, value, base) {
  const root = await realpath(temp),
    parent = await realpath(path.dirname(path.resolve(value)));
  assert(
    parent === root && path.basename(value) === base,
    "Fixed ephemeral import output required",
  );
  const result = path.join(parent, base);
  try {
    await lstat(result);
    assert.fail("New output required");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return result;
}
function python() {
  return execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-B", "-c", "import sys;print(sys.executable)"],
    {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
      },
    },
  ).trim();
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = importArguments(argv);
  if (options.mode !== "seal") {
    const review = await committedReview(options.reviewed, options.reviewSha);
    if (options.mode === "plan")
      return {
        reviewedImport: options.reviewed,
        reviewSha256: options.reviewSha,
        origin: review.origin,
        target: review.target,
        sourceLockIdentity: review.sourceLockIdentity,
        ingestion: "operator-reviewed-local-bytes",
        hostedBuild: false,
        nativeAcceptance: false,
        publicationAllowed: false,
      };
    const handoff = await readFile(options.handoff);
    validateLocalHandoff(review, handoff);
    assert(
      git(["rev-parse", "HEAD"]).toString().trim() === options.commit,
      "Explicit checkout commit required",
    );
    await freshLocalHandoff(options, review);
    return quarantineOwnedBundle(
      ownedImportApi(OWNED_REPOSITORY, env.GH_TOKEN, fetch, {
        write: true,
        review,
        reviewSha: options.reviewSha,
      }),
      { ...options, review, handoff, execute: options.execute },
    );
  }
  assert(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY_VISIBILITY === "public" &&
      env.GITHUB_REPOSITORY === OWNED_REPOSITORY &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "Public ephemeral manual importer only",
  );
  const review = await committedReview(
      env.CEF_OWNED_REVIEW,
      env.CEF_OWNED_REVIEW_SHA256,
    ),
    api = ownedImportApi(OWNED_REPOSITORY, env.GH_TOKEN);
  const [repo, workflow] = await Promise.all([
    api(""),
    api("actions/workflows/cef-owned-sdk-import.yml"),
  ]);
  assert(
    repo.private === false &&
      env.GITHUB_REF === `refs/heads/${repo.default_branch}` &&
      env.GITHUB_WORKFLOW_REF ===
        `${OWNED_REPOSITORY}/${OWNED_WORKFLOW}@refs/heads/${repo.default_branch}` &&
      git(["rev-parse", "HEAD"]).toString().trim() === env.GITHUB_SHA,
    "Exact default-branch importer source required",
  );
  const producer = {
    repository: OWNED_REPOSITORY,
    repositoryId: repo.id,
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    head: env.GITHUB_SHA,
    branch: repo.default_branch,
    workflow: OWNED_WORKFLOW,
    workflowId: workflow.id,
    codeSha256: await ownCodeDigest(),
  };
  const bundle = await privateOutput(
      env.RUNNER_TEMP,
      env.CEF_OWNED_BUNDLE,
      "cef-owned-import-bundle",
    ),
    output = await privateOutput(
      env.RUNNER_TEMP,
      env.CEF_OWNED_OUTPUT,
      "cef-owned-import-proof",
    );
  return sealOwnedImport(api, {
    review,
    reviewSha: env.CEF_OWNED_REVIEW_SHA256,
    reviewedImport: env.CEF_OWNED_REVIEW,
    releaseId: Number(env.CEF_OWNED_RELEASE_ID),
    bundle,
    output,
    producer,
    token: env.GH_TOKEN,
    python: python(),
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(async () => {
      // No raw errors, original machine paths, signed URLs or tokens are printed.
      console.error(
        "Owned SDK import failed; no hosted-build/native-acceptance/publication authority granted",
      );
      process.exitCode = 1;
    });
