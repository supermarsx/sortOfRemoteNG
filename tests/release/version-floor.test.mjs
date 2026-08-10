import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  highestAllocatedReleaseTag,
  parseArgs,
  readLocalReleaseTagNames,
  validateCanonicalVersionFloor,
} from "../../scripts/ci/check-release-version-floor.mjs";

const checkerPath = fileURLToPath(
  new URL("../../scripts/ci/check-release-version-floor.mjs", import.meta.url),
);

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeVersion(repo, publicVersion) {
  writeFileSync(
    path.join(repo, "version.json"),
    `${JSON.stringify({ version: publicVersion }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(repo, "package.json"),
    `${JSON.stringify({ version: `${publicVersion}.0` }, null, 2)}\n`,
    "utf8",
  );
}

function commitAll(repo, message, body = null) {
  git(repo, ["add", "."]);
  const args = ["commit", "--quiet", "-m", message];
  if (body) args.push("-m", body);
  git(repo, args);
  return git(repo, ["rev-parse", "HEAD"]);
}

test("selects the highest strict allocated tag across release years", () => {
  assert.equal(
    highestAllocatedReleaseTag([
      "v99.999",
      "notes",
      "26.3",
      "26.27",
      "27.1",
      "26.999",
    ]),
    "27.1",
  );
  assert.equal(highestAllocatedReleaseTag(["v26.9", "26.0"]), "");
  assert.throws(
    () => highestAllocatedReleaseTag(["26.1", "26.1"]),
    /Duplicate allocated release tag 26\.1/,
  );
  assert.throws(
    () => highestAllocatedReleaseTag(["26.999999999999999999999"]),
    /outside the supported integer range/,
  );
});

test("rejects canonical versions below every allocated tag, published or not", () => {
  assert.deepEqual(
    validateCanonicalVersionFloor({
      canonicalVersion: "26.26",
      tagNames: ["26.25", "26.26"],
    }),
    { canonicalVersion: "26.26", allocatedVersionFloor: "26.26" },
  );
  assert.equal(
    validateCanonicalVersionFloor({
      canonicalVersion: "27.1",
      tagNames: ["26.999"],
    }).canonicalVersion,
    "27.1",
  );
  assert.throws(
    () =>
      validateCanonicalVersionFloor({
        canonicalVersion: "26.26",
        // A strict tag is consumed at allocation time. Publication state is
        // intentionally not an input to this invariant.
        tagNames: ["26.27"],
      }),
    /below highest allocated release tag 26\.27.*remain consumed/s,
  );
  assert.throws(
    () =>
      validateCanonicalVersionFloor({
        canonicalVersion: "26.999999999999999999999",
        tagNames: [],
      }),
    /Canonical version .* outside the supported integer range/,
  );
});

test("accepts repositories without an allocated release tag", () => {
  assert.deepEqual(
    validateCanonicalVersionFloor({
      canonicalVersion: "26.1",
      tagNames: ["v26.50", "notes"],
    }),
    { canonicalVersion: "26.1", allocatedVersionFloor: "" },
  );
});

test("parses repository and version-file CLI options", () => {
  assert.deepEqual(
    parseArgs(["--repo=checkout", "--version-file", "config/version.json"]),
    { repo: "checkout", versionFile: "config/version.json" },
  );
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);
});

test("blocks a post-snapshot source regression without inventing tag ancestry", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "sorng-version-floor-"));
  try {
    git(repo, ["init", "--quiet"]);
    git(repo, ["config", "core.autocrlf", "false"]);
    git(repo, ["config", "user.name", "Version Floor Test"]);
    git(repo, ["config", "user.email", "version-floor@test.invalid"]);

    writeVersion(repo, "26.25");
    const source = commitAll(repo, "source before release");

    writeVersion(repo, "26.26");
    const snapshot = commitAll(
      repo,
      "chore(release): snapshot 26.26",
      `Release-Source-SHA: ${source}`,
    );
    git(repo, ["tag", "26.26", snapshot]);

    git(repo, ["checkout", "--quiet", "-b", "post-release-source", source]);
    writeFileSync(path.join(repo, "later.txt"), "later source work\n", "utf8");
    commitAll(repo, "later source work based on the pre-snapshot commit");
    const regressedHead = git(repo, ["rev-parse", "HEAD"]);

    const ancestry = spawnSync(
      "git",
      ["-C", repo, "merge-base", "--is-ancestor", snapshot, regressedHead],
      { encoding: "utf8" },
    );
    assert.equal(
      ancestry.status,
      1,
      "fixture must preserve the real side-snapshot history",
    );
    assert.deepEqual(readLocalReleaseTagNames(repo), ["26.26"]);

    const rejected = spawnSync(
      process.execPath,
      [checkerPath, "--repo", repo],
      { encoding: "utf8" },
    );
    assert.equal(rejected.status, 1);
    assert.match(
      rejected.stderr,
      /Canonical version 26\.25 is below highest allocated release tag 26\.26/,
    );

    // Repair the projection while retaining honest history: the source branch
    // still does not descend from the immutable snapshot commit.
    writeVersion(repo, "26.26");
    commitAll(repo, "repair canonical version floor");
    const repairedHead = git(repo, ["rev-parse", "HEAD"]);
    const repairedAncestry = spawnSync(
      "git",
      ["-C", repo, "merge-base", "--is-ancestor", snapshot, repairedHead],
      { encoding: "utf8" },
    );
    assert.equal(repairedAncestry.status, 1);

    const accepted = spawnSync(
      process.execPath,
      [checkerPath, `--repo=${repo}`],
      { encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(
      accepted.stdout,
      /Canonical version 26\.26 satisfies allocated release floor 26\.26/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
