import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyReleaseSnapshot } from "../../scripts/ci/resolve-release-version.mjs";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
  }).trim();
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createSnapshotRepository({
  machineVersionOverride = null,
  projectionVersion = "27.1",
  tamper = false,
  trailerSource = null,
} = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "sorng-snapshot-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "Release Test"]);
  git(repo, ["config", "user.email", "release@test.invalid"]);
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  writeFileSync(path.join(repo, "version.json"), json({ version: "26.1" }));
  writeFileSync(
    path.join(repo, "package.json"),
    json({ name: "snapshot-fixture", version: "26.1.0" }),
  );
  writeFileSync(
    path.join(repo, "scripts", "sync-version.mjs"),
    [
      'import fs from "node:fs";',
      'const index = process.argv.indexOf("--version");',
      'if (index < 0 || !process.argv[index + 1]) throw new Error("missing version");',
      "const version = process.argv[index + 1];",
      'const authority = JSON.parse(fs.readFileSync("version.json", "utf8"));',
      "authority.version = version;",
      'fs.writeFileSync("version.json", `${JSON.stringify(authority, null, 2)}\\n`);',
      'const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));',
      "packageJson.version = `${version}.0`;",
      'fs.writeFileSync("package.json", `${JSON.stringify(packageJson, null, 2)}\\n`);',
      "",
    ].join("\n"),
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "source"]);
  const sourceSha = git(repo, ["rev-parse", "HEAD"]);

  execFileSync(
    process.execPath,
    ["scripts/sync-version.mjs", "--write", "--version", projectionVersion],
    { cwd: repo },
  );
  if (machineVersionOverride) {
    const packagePath = path.join(repo, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.version = machineVersionOverride;
    writeFileSync(packagePath, json(packageJson));
  }
  if (tamper) {
    writeFileSync(
      path.join(repo, "unrelated.txt"),
      "not a version projection\n",
    );
  }
  git(repo, ["add", "-A"]);
  git(repo, [
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "chore(release): snapshot 27.1",
    "-m",
    `Release-Source-SHA: ${trailerSource ?? sourceSha}`,
  ]);
  const snapshotCommit = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["tag", "--no-sign", "27.1", snapshotCommit]);
  return { repo, snapshotCommit, sourceSha };
}

function addDescendantCandidate(fixture) {
  git(fixture.repo, ["checkout", "--quiet", "--detach", fixture.sourceSha]);
  writeFileSync(path.join(fixture.repo, "candidate.txt"), "next source\n");
  git(fixture.repo, ["add", "candidate.txt"]);
  git(fixture.repo, ["commit", "--quiet", "-m", "next source"]);
  return git(fixture.repo, ["rev-parse", "HEAD"]);
}

test("verifies tag target, parent, source trailer, version, and exact tree", () => {
  const fixture = createSnapshotRepository();
  const outputDirectory = mkdtempSync(
    path.join(os.tmpdir(), "sorng-snapshot-output-"),
  );
  try {
    const outputPath = path.join(outputDirectory, "github-output.txt");
    const scriptPath = fileURLToPath(
      new URL("../../scripts/ci/verify-release-snapshot.mjs", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--repo",
        fixture.repo,
        "--tag",
        "27.1",
        "--snapshot-commit",
        fixture.snapshotCommit,
        "--source-sha",
        fixture.sourceSha,
        "--public-version",
        "27.1",
        "--github-output",
        outputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /^verified=true$/m);
    assert.match(output, new RegExp(`^source_sha=${fixture.sourceSha}$`, "m"));
    assert.match(
      output,
      new RegExp(`^snapshot_commit=${fixture.snapshotCommit}$`, "m"),
    );
    assert.match(output, /^snapshot_tree=[0-9a-f]{40}$/m);
    assert.match(output, /^public_version=27\.1$/m);
    assert.match(output, /^public_tag=27\.1$/m);

    const resolverPath = fileURLToPath(
      new URL("../../scripts/ci/resolve-release-version.mjs", import.meta.url),
    );
    const rollover = spawnSync(
      process.execPath,
      [
        resolverPath,
        "--repo",
        fixture.repo,
        "--source-sha",
        fixture.sourceSha,
        "--year",
        "28",
      ],
      { encoding: "utf8" },
    );
    assert.equal(rollover.status, 0, rollover.stderr);
    assert.match(rollover.stdout, /^public_tag=27\.1$/m);
    assert.match(rollover.stdout, /^release_action=reuse$/m);
    assert.match(rollover.stdout, /^snapshot_tree=[0-9a-f]{40}$/m);
    assert.match(rollover.stdout, /^source_guard=passed$/m);
    assert.match(rollover.stdout, /^latest_release_tag=27\.1$/m);

    const descendantSource = addDescendantCandidate(fixture);
    const nextRelease = spawnSync(
      process.execPath,
      [
        resolverPath,
        "--repo",
        fixture.repo,
        "--source-sha",
        descendantSource,
        "--year",
        "27",
      ],
      { encoding: "utf8" },
    );
    assert.equal(nextRelease.status, 0, nextRelease.stderr);
    assert.match(nextRelease.stdout, /^public_tag=27\.2$/m);
    assert.match(nextRelease.stdout, /^release_action=create$/m);
    assert.match(nextRelease.stdout, /^source_guard=passed$/m);
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("rejects a snapshot tree containing changes beyond the projection", () => {
  const fixture = createSnapshotRepository({ tamper: true });
  try {
    assert.throws(
      () =>
        verifyReleaseSnapshot({
          repo: fixture.repo,
          tag: "27.1",
          snapshotCommit: fixture.snapshotCommit,
          sourceSha: fixture.sourceSha,
          publicVersion: "27.1",
        }),
      /does not match deterministic version projection tree/,
    );

    const descendantSource = addDescendantCandidate(fixture);
    const resolverPath = fileURLToPath(
      new URL("../../scripts/ci/resolve-release-version.mjs", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [
        resolverPath,
        "--repo",
        fixture.repo,
        "--source-sha",
        descendantSource,
        "--year",
        "27",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /does not match deterministic version projection tree/,
    );
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test("rejects a tag that does not target the claimed snapshot", () => {
  const fixture = createSnapshotRepository();
  try {
    assert.throws(
      () =>
        verifyReleaseSnapshot({
          repo: fixture.repo,
          tag: "27.1",
          snapshotCommit: fixture.sourceSha,
          sourceSha: fixture.sourceSha,
          publicVersion: "27.1",
        }),
      /not snapshot/,
    );
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test("rejects a snapshot whose sole parent is not the claimed source", () => {
  const fixture = createSnapshotRepository();
  try {
    assert.throws(
      () =>
        verifyReleaseSnapshot({
          repo: fixture.repo,
          tag: "27.1",
          snapshotCommit: fixture.snapshotCommit,
          sourceSha: fixture.snapshotCommit,
          publicVersion: "27.1",
        }),
      /parent .* does not match source/,
    );
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test("rejects a snapshot trailer that identifies another source", () => {
  const fixture = createSnapshotRepository({ trailerSource: "f".repeat(40) });
  try {
    assert.throws(
      () =>
        verifyReleaseSnapshot({
          repo: fixture.repo,
          tag: "27.1",
          snapshotCommit: fixture.snapshotCommit,
          sourceSha: fixture.sourceSha,
          publicVersion: "27.1",
        }),
      /trailer identifies .* not source/,
    );
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test("rejects snapshot public and machine version drift", () => {
  const fixture = createSnapshotRepository({ projectionVersion: "27.2" });
  try {
    assert.throws(
      () =>
        verifyReleaseSnapshot({
          repo: fixture.repo,
          tag: "27.1",
          snapshotCommit: fixture.snapshotCommit,
          sourceSha: fixture.sourceSha,
          publicVersion: "27.1",
        }),
      /version\.json contains "27\.2"; expected 27\.1/,
    );
  } finally {
    rmSync(fixture.repo, { recursive: true, force: true });
  }

  const machineFixture = createSnapshotRepository({
    machineVersionOverride: "27.9.0",
  });
  try {
    assert.throws(
      () =>
        verifyReleaseSnapshot({
          repo: machineFixture.repo,
          tag: "27.1",
          snapshotCommit: machineFixture.snapshotCommit,
          sourceSha: machineFixture.sourceSha,
          publicVersion: "27.1",
        }),
      /package\.json contains "27\.9\.0"; expected 27\.1\.0/,
    );
  } finally {
    rmSync(machineFixture.repo, { recursive: true, force: true });
  }
});
