import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  validateUpdaterFeed,
} from "../../scripts/ci/validate-updater-feed.mjs";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function fixture(name) {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8"));
}

test("accepts an updater feed matching the expected machine SemVer", () => {
  assert.deepEqual(
    validateUpdaterFeed(fixture("updater-feed-valid.json"), {
      expectedVersion: "26.1.0",
    }),
    [],
  );
});

test("rejects a public YY.N value as updater transport metadata", () => {
  const errors = validateUpdaterFeed(
    fixture("updater-feed-public-version.json"),
    {
      allowEmptyPlatforms: true,
      expectedVersion: "26.1.0",
    },
  );
  assert.ok(errors.includes("version must be a valid SemVer value."));
  assert.ok(errors.includes("version must equal expected version 26.1.0."));
});

test("rejects platform metadata that drifts from the feed", () => {
  const errors = validateUpdaterFeed(
    fixture("updater-feed-platform-drift.json"),
    { expectedVersion: "26.1.0" },
  );
  assert.ok(
    errors.includes(
      "platforms.windows-x86_64.version must equal feed version 26.1.0.",
    ),
  );
});

test("parses an expected-version CLI constraint", () => {
  assert.equal(
    parseArgs(["feed.json", "--expected-version", "26.1.0"]).expectedVersion,
    "26.1.0",
  );
});
