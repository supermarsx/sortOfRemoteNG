import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitFile(repo, name, contents, message) {
  writeFileSync(path.join(repo, name), contents, "utf8");
  git(repo, ["add", "--", name]);
  git(repo, ["commit", "--quiet", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function remoteRef(remote, ref) {
  return git(remote, ["rev-parse", ref]);
}

test("atomic release pushes update main and tag together or neither", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sorng-release-push-"));
  const remote = path.join(root, "remote.git");
  const releaseRepo = path.join(root, "release");
  const competingRepo = path.join(root, "competing");

  try {
    git(root, ["init", "--quiet", "--bare", remote]);
    git(root, ["init", "--quiet", releaseRepo]);
    git(releaseRepo, ["config", "user.name", "Release Test"]);
    git(releaseRepo, ["config", "user.email", "release-test@example.invalid"]);
    git(releaseRepo, ["branch", "-M", "main"]);
    git(releaseRepo, ["remote", "add", "origin", remote]);

    const sourceOne = commitFile(
      releaseRepo,
      "version.txt",
      "source-one\n",
      "source one",
    );
    git(releaseRepo, ["push", "--quiet", "-u", "origin", "main"]);
    const snapshotOne = commitFile(
      releaseRepo,
      "version.txt",
      "26.1.0\n",
      "chore(release): snapshot 26.1 [skip ci]",
    );
    git(releaseRepo, ["tag", "26.1", snapshotOne]);

    git(releaseRepo, [
      "push",
      "--quiet",
      "--atomic",
      `--force-with-lease=refs/heads/main:${sourceOne}`,
      "origin",
      "refs/tags/26.1:refs/tags/26.1",
      `${snapshotOne}:refs/heads/main`,
    ]);

    assert.equal(remoteRef(remote, "refs/heads/main"), snapshotOne);
    assert.equal(remoteRef(remote, "refs/tags/26.1"), snapshotOne);

    const sourceTwo = commitFile(
      releaseRepo,
      "source.txt",
      "source-two\n",
      "source two",
    );
    git(releaseRepo, ["push", "--quiet", "origin", "main"]);
    const snapshotTwo = commitFile(
      releaseRepo,
      "version.txt",
      "26.2.0\n",
      "chore(release): snapshot 26.2 [skip ci]",
    );
    git(releaseRepo, ["tag", "26.2", snapshotTwo]);

    git(root, ["clone", "--quiet", "--branch", "main", remote, competingRepo]);
    git(competingRepo, ["config", "user.name", "Competing Test"]);
    git(competingRepo, [
      "config",
      "user.email",
      "competing-test@example.invalid",
    ]);
    const competingMain = commitFile(
      competingRepo,
      "competing.txt",
      "main advanced\n",
      "advance main",
    );
    git(competingRepo, ["push", "--quiet", "origin", "main"]);

    const rejected = spawnSync(
      "git",
      [
        "-C",
        releaseRepo,
        "push",
        "--atomic",
        `--force-with-lease=refs/heads/main:${sourceTwo}`,
        "origin",
        "refs/tags/26.2:refs/tags/26.2",
        `${snapshotTwo}:refs/heads/main`,
      ],
      { encoding: "utf8" },
    );

    assert.notEqual(
      rejected.status,
      0,
      "stale source lease must reject the push",
    );
    assert.equal(remoteRef(remote, "refs/heads/main"), competingMain);
    const missingTag = spawnSync(
      "git",
      ["-C", remote, "rev-parse", "--verify", "refs/tags/26.2"],
      { encoding: "utf8" },
    );
    assert.notEqual(
      missingTag.status,
      0,
      "atomic rejection must not publish the release tag",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
