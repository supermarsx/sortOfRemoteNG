import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseArgs,
  parseReleaseSourceSha,
  readLocalReleaseTagRecords,
  resolveReleaseVersion,
  resolveRollingRelease,
  utcReleaseYear,
  validateMonotonicReleaseSources,
} from "../../scripts/ci/resolve-release-version.mjs";

const SOURCE_A = "a".repeat(40);
const SOURCE_B = "b".repeat(40);
const SNAPSHOT_A = "1".repeat(40);
const SNAPSHOT_B = "2".repeat(40);

function releaseTag(name, sourceSha, commitSha = SNAPSHOT_A) {
  return {
    name,
    commitSha,
    message: `chore(release): snapshot ${name}\n\nRelease-Source-SHA: ${sourceSha}\n`,
    parentShas: [sourceSha],
    publicVersion: name,
    machineVersion: `${name}.0`,
  };
}

test("resolves one bare public tag to public and machine identities", () => {
  assert.deepEqual(resolveReleaseVersion("26.1", "26.1"), {
    publicTag: "26.1",
    publicVersion: "26.1",
    machineVersion: "26.1.0",
  });
});

test("rejects prefixed, semver, long-year, zero, and leading-zero tags", () => {
  for (const tag of ["v26.1", "26.1.0", "2026.1", "26.0", "26.01"]) {
    assert.throws(() => resolveReleaseVersion(tag, "26.1"), /bare YY\.N/);
  }
});

test("rejects a tag that differs from version.json", () => {
  assert.throws(
    () => resolveReleaseVersion("26.2", "26.1"),
    /does not match version\.json public version 26\.1/,
  );
});

test("derives a strict two-digit year from UTC", () => {
  assert.equal(utcReleaseYear(new Date("2026-12-31T23:59:59Z")), "26");
  assert.equal(utcReleaseYear(new Date("2030-01-01T00:00:00Z")), "30");
  assert.throws(() => utcReleaseYear(new Date("invalid")), /valid Date/);
});

test("starts at YY.1 when no current-year public tags exist", () => {
  assert.deepEqual(
    resolveRollingRelease({
      tagRecords: [
        releaseTag("25.91", SOURCE_B),
        { name: "v26.99" },
        { name: "26.01" },
        { name: "notes" },
      ],
      sourceSha: SOURCE_A.toUpperCase(),
      year: "26",
    }),
    {
      publicTag: "26.1",
      publicVersion: "26.1",
      machineVersion: "26.1.0",
      releaseAction: "create",
      sourceSha: SOURCE_A,
      snapshotCommit: "",
    },
  );
});

test("increments the maximum current-year counter and ignores gaps", () => {
  const resolved = resolveRollingRelease({
    tagRecords: [
      releaseTag("26.1", "c".repeat(40), SNAPSHOT_A),
      releaseTag("26.7", "d".repeat(40), SNAPSHOT_B),
      releaseTag("27.300", "e".repeat(40), "3".repeat(40)),
      { name: "v26.400" },
    ],
    sourceSha: SOURCE_A,
    year: "26",
  });

  assert.equal(resolved.publicTag, "26.8");
  assert.equal(resolved.machineVersion, "26.8.0");
  assert.equal(resolved.releaseAction, "create");
});

test("reuses the one snapshot tag that identifies the same source SHA", () => {
  assert.deepEqual(
    resolveRollingRelease({
      tagRecords: [releaseTag("26.4", SOURCE_A, SNAPSHOT_B)],
      sourceSha: SOURCE_A.toUpperCase(),
      year: "26",
    }),
    {
      publicTag: "26.4",
      publicVersion: "26.4",
      machineVersion: "26.4.0",
      releaseAction: "reuse",
      sourceSha: SOURCE_A,
      snapshotCommit: SNAPSHOT_B,
    },
  );
});

test("reuses a prior-year tag for the same source after UTC year rollover", () => {
  const resolved = resolveRollingRelease({
    tagRecords: [releaseTag("26.19", SOURCE_A, SNAPSHOT_B)],
    sourceSha: SOURCE_A,
    year: "27",
  });
  assert.equal(resolved.publicTag, "26.19");
  assert.equal(resolved.releaseAction, "reuse");
  assert.equal(resolved.snapshotCommit, SNAPSHOT_B);
});

test("prior-year releases do not advance the new year's counter", () => {
  const resolved = resolveRollingRelease({
    tagRecords: [releaseTag("26.91", SOURCE_B, SNAPSHOT_B)],
    sourceSha: SOURCE_A,
    year: "27",
  });
  assert.equal(resolved.publicTag, "27.1");
  assert.equal(resolved.releaseAction, "create");
});

test("fails closed for malformed current-year snapshot state", () => {
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [
          { name: "26.1", commitSha: SNAPSHOT_A, message: "no trailer" },
        ],
        sourceSha: SOURCE_A,
        year: "26",
      }),
    /missing Release-Source-SHA/,
  );
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [
          {
            ...releaseTag("26.1", SOURCE_A),
            message: `Release-Source-SHA: ${SOURCE_A}\nRelease-Source-SHA: ${SOURCE_B}`,
          },
        ],
        sourceSha: SOURCE_A,
        year: "26",
      }),
    /2 Release-Source-SHA trailers/,
  );
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [releaseTag("26.1", "short")],
        sourceSha: SOURCE_A,
        year: "26",
      }),
    /Invalid source SHA/,
  );
});

test("fails closed when two release tags identify the same source", () => {
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [
          releaseTag("26.99", SOURCE_A, SNAPSHOT_A),
          releaseTag("27.1", SOURCE_A, SNAPSHOT_B),
        ],
        sourceSha: SOURCE_B,
        year: "26",
      }),
    /Conflicting release state/,
  );
});

test("valid prior-year release state is validated instead of silently skipped", () => {
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [
          {
            ...releaseTag("26.4", SOURCE_B),
            parentShas: [SOURCE_A],
          },
        ],
        sourceSha: SOURCE_A,
        year: "27",
      }),
    /snapshot parent .* does not match trailer source/,
  );
});

test("fails closed before an unsafe release counter can wrap", () => {
  const highest = String(Number.MAX_SAFE_INTEGER);
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [releaseTag(`26.${highest}`, SOURCE_B)],
        sourceSha: SOURCE_A,
        year: "26",
      }),
    /supported integer range exhausted/,
  );
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: [releaseTag("26.999999999999999999999", SOURCE_B)],
        sourceSha: SOURCE_A,
        year: "26",
      }),
    /outside the supported integer range/,
  );
});

test("explicit reuse accepts an existing cross-year tag only for the same source", () => {
  const records = [releaseTag("26.3", SOURCE_A, SNAPSHOT_A)];
  assert.equal(
    resolveRollingRelease({
      tagRecords: records,
      sourceSha: SOURCE_A,
      year: "27",
      requestedTag: "26.3",
    }).releaseAction,
    "reuse",
  );
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: records,
        sourceSha: SOURCE_B,
        year: "27",
        requestedTag: "26.3",
      }),
    /not requested source/,
  );
  assert.throws(
    () =>
      resolveRollingRelease({
        tagRecords: records,
        sourceSha: SOURCE_A,
        year: "27",
        requestedTag: "27.4",
      }),
    /not present/,
  );
});

test("monotonic guard accepts a descendant candidate and latest-source retry", () => {
  const records = [
    releaseTag("26.1", SOURCE_A, SNAPSHOT_A),
    releaseTag("26.2", SOURCE_B, SNAPSHOT_B),
  ];
  const ancestry = new Map([
    [`${SOURCE_A}:${SOURCE_B}`, true],
    [`${SOURCE_A}:${"c".repeat(40)}`, true],
    [`${SOURCE_B}:${"c".repeat(40)}`, true],
  ]);
  const isAncestor = (ancestor, descendant) =>
    ancestor === descendant ||
    ancestry.get(`${ancestor}:${descendant}`) === true;

  assert.deepEqual(
    validateMonotonicReleaseSources({
      tagRecords: records,
      candidateSourceSha: "c".repeat(40),
      isAncestor,
    }),
    {
      sourceGuard: "passed",
      latestReleasedSource: SOURCE_B,
      latestReleaseTag: "26.2",
    },
  );
  assert.equal(
    validateMonotonicReleaseSources({
      tagRecords: records,
      candidateSourceSha: SOURCE_B,
      isAncestor,
    }).sourceGuard,
    "passed",
  );
});

test("monotonic guard accepts the first release with empty prior-source outputs", () => {
  assert.deepEqual(
    validateMonotonicReleaseSources({
      tagRecords: [{ name: "v26.99" }],
      candidateSourceSha: SOURCE_A,
      isAncestor: () => {
        throw new Error("ancestry must not be queried without release tags");
      },
    }),
    {
      sourceGuard: "passed",
      latestReleasedSource: "",
      latestReleaseTag: "",
    },
  );
});

test("monotonic guard rejects stale and diverged release sources", () => {
  const records = [
    releaseTag("26.1", SOURCE_A, SNAPSHOT_A),
    releaseTag("26.2", SOURCE_B, SNAPSHOT_B),
  ];
  const linearAncestor = (ancestor, descendant) =>
    ancestor === descendant ||
    (ancestor === SOURCE_A && descendant === SOURCE_B);
  assert.throws(
    () =>
      validateMonotonicReleaseSources({
        tagRecords: records,
        candidateSourceSha: SOURCE_A,
        isAncestor: linearAncestor,
      }),
    /Stale release source.*descendant/,
  );
  assert.throws(
    () =>
      validateMonotonicReleaseSources({
        tagRecords: records,
        candidateSourceSha: "c".repeat(40),
        isAncestor: () => false,
      }),
    /Diverged release state/,
  );
});

test("monotonic guard compares real Git ancestry and rejects a side branch", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "sorng-release-order-"));
  try {
    execFileSync("git", ["init", "--quiet", repo]);
    execFileSync("git", ["-C", repo, "config", "core.autocrlf", "false"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Release Test"]);
    execFileSync("git", [
      "-C",
      repo,
      "config",
      "user.email",
      "release@test.invalid",
    ]);
    const commit = (contents, message) => {
      writeFileSync(path.join(repo, "lineage.txt"), `${contents}\n`, "utf8");
      execFileSync("git", ["-C", repo, "add", "lineage.txt"]);
      execFileSync("git", ["-C", repo, "commit", "--quiet", "-m", message]);
      return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
    };
    const sourceA = commit("a", "source a");
    const sourceB = commit("b", "source b");
    const sourceC = commit("c", "source c");
    const records = [
      releaseTag("26.1", sourceA),
      releaseTag("26.2", sourceB, SNAPSHOT_B),
    ];
    assert.equal(
      validateMonotonicReleaseSources({
        tagRecords: records,
        candidateSourceSha: sourceC,
        repo,
      }).sourceGuard,
      "passed",
    );
    assert.throws(
      () =>
        validateMonotonicReleaseSources({
          tagRecords: records,
          candidateSourceSha: sourceA,
          repo,
        }),
      /Stale release source/,
    );

    execFileSync("git", [
      "-C",
      repo,
      "checkout",
      "--quiet",
      "--detach",
      sourceA,
    ]);
    const sideBranch = commit("side", "side branch");
    assert.throws(
      () =>
        validateMonotonicReleaseSources({
          tagRecords: records,
          candidateSourceSha: sideBranch,
          repo,
        }),
      /Diverged release source/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("parses rolling resolver workflow arguments", () => {
  assert.deepEqual(
    parseArgs([
      `--source-sha=${SOURCE_A}`,
      "--repo",
      "checkout",
      "--year=26",
      "--github-output=output.txt",
    ]),
    {
      githubOutput: "output.txt",
      repo: "checkout",
      sourceSha: SOURCE_A,
      tag: null,
      versionFile: "version.json",
      year: "26",
    },
  );
});

test("extracts exactly one strict snapshot source trailer", () => {
  assert.equal(
    parseReleaseSourceSha(`subject\n\nRelease-Source-SHA: ${SOURCE_A}\n`),
    SOURCE_A,
  );
  assert.equal(parseReleaseSourceSha("subject only"), null);
});

test("reads strict release tags across years from git commit targets", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "sorng-release-tags-"));
  try {
    execFileSync("git", ["init", "--quiet", repo]);
    execFileSync("git", ["-C", repo, "config", "core.autocrlf", "false"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Release Test"]);
    execFileSync("git", [
      "-C",
      repo,
      "config",
      "user.email",
      "release@test.invalid",
    ]);
    writeFileSync(path.join(repo, "snapshot.txt"), "snapshot\n", "utf8");
    writeFileSync(
      path.join(repo, "version.json"),
      '{"version":"26.3"}\n',
      "utf8",
    );
    writeFileSync(
      path.join(repo, "package.json"),
      '{"version":"26.3.0"}\n',
      "utf8",
    );
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", [
      "-C",
      repo,
      "commit",
      "--quiet",
      "-m",
      "chore(release): snapshot 26.3",
      "-m",
      `Release-Source-SHA: ${SOURCE_A}`,
    ]);
    execFileSync("git", ["-C", repo, "tag", "26.3"]);
    execFileSync("git", ["-C", repo, "tag", "v26.99"]);
    execFileSync("git", ["-C", repo, "tag", "25.2"]);

    const records = readLocalReleaseTagRecords(repo);
    assert.deepEqual(records.map((record) => record.name).sort(), [
      "25.2",
      "26.3",
    ]);
    assert.match(records[0].commitSha, /^[0-9a-f]{40}$/);
    assert.equal(parseReleaseSourceSha(records[0].message), SOURCE_A);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
