import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArgs,
  resolveReleaseVersion,
} from "../../scripts/ci/resolve-release-version.mjs";

test("resolves one public tag to public and machine release identities", () => {
  assert.deepEqual(resolveReleaseVersion("v26.1", "26.1"), {
    publicTag: "v26.1",
    publicVersion: "26.1",
    machineVersion: "26.1.0",
  });
});

test("rejects non-public tag shapes and zero release counters", () => {
  for (const tag of ["26.1", "v26.1.0", "v2026.1", "v26.0", "v26.01"]) {
    assert.throws(() => resolveReleaseVersion(tag, "26.1"), /expected vYY\.N/);
  }
});

test("rejects a tag that differs from version.json", () => {
  assert.throws(
    () => resolveReleaseVersion("v26.2", "26.1"),
    /does not match version\.json public version 26\.1/,
  );
});

test("parses release resolver workflow arguments", () => {
  assert.deepEqual(
    parseArgs([
      "--tag=v26.1",
      "--version-file",
      "authority.json",
      "--github-output=output.txt",
    ]),
    {
      githubOutput: "output.txt",
      tag: "v26.1",
      versionFile: "authority.json",
    },
  );
});
