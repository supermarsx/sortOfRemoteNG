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
const RELEASE_BASE_URL = "https://example.invalid/v26.1";

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

test("parses an exact expected release base URL constraint", () => {
  assert.equal(
    parseArgs(["feed.json", "--expected-release-base-url", RELEASE_BASE_URL])
      .expectedReleaseBaseUrl,
    RELEASE_BASE_URL,
  );
});

test("accepts an explicitly unsigned discovery feed with empty signatures", () => {
  const feed = {
    version: "26.1.0",
    notes: "Release 26.1",
    pub_date: "2026-07-15T00:00:00Z",
    updater_signing: false,
    platforms: {
      "windows-x86_64": {
        signature: "",
        url: "https://example.invalid/v26.1/sortOfRemoteNG_26.1.0_windows-x86_64-setup.exe",
      },
    },
  };

  assert.deepEqual(
    validateUpdaterFeed(feed, {
      allowEmptySignatures: true,
      expectedReleaseBaseUrl: RELEASE_BASE_URL,
      expectedVersion: "26.1.0",
      updaterSigning: "unsigned",
    }),
    [],
  );

  feed.platforms["windows-x86_64"].signature = "unexpected-signature";
  assert.ok(
    validateUpdaterFeed(feed, {
      allowEmptySignatures: true,
      expectedReleaseBaseUrl: RELEASE_BASE_URL,
      expectedVersion: "26.1.0",
      updaterSigning: "unsigned",
    }).includes(
      "platforms.windows-x86_64.signature must be empty in unsigned mode.",
    ),
  );
});

test("rejects a same-basename platform URL outside the expected release", () => {
  const artifact = "sortOfRemoteNG_26.1.0_windows-x86_64-setup.exe";
  const feed = windowsFeed({
    "windows-x86_64": {
      ...NSIS_ENTRY,
      url: `https://downloads.attacker.invalid/${artifact}`,
    },
  });

  const errors = validateUpdaterFeed(feed, {
    expectedReleaseBaseUrl: RELEASE_BASE_URL,
  });
  assert.ok(
    errors.includes(
      `platforms.windows-x86_64.url must equal ${RELEASE_BASE_URL}/${artifact}.`,
    ),
  );
});

test("requires the feed signing marker to match the requested mode", () => {
  const feed = windowsFeed({ "windows-x86_64": { ...NSIS_ENTRY } });
  assert.ok(
    validateUpdaterFeed(feed, { updaterSigning: "signed" }).includes(
      "updater_signing must be true.",
    ),
  );

  feed.updater_signing = true;
  feed.platforms["windows-x86_64"].signature = "";
  assert.ok(
    validateUpdaterFeed(feed, {
      allowEmptySignatures: true,
      updaterSigning: "signed",
    }).includes("platforms.windows-x86_64.signature must not be empty."),
  );
});

function windowsFeed(platforms) {
  return {
    version: "26.1.0",
    notes: "Release 26.1",
    pub_date: "2026-07-15T00:00:00Z",
    platforms,
  };
}

const NSIS_ENTRY = {
  signature: "fixture-signature",
  url: "https://example.invalid/v26.1/sortOfRemoteNG_26.1.0_windows-x86_64-setup.exe",
};
const MSI_ENTRY = {
  signature: "fixture-msi-signature",
  url: "https://example.invalid/v26.1/sortOfRemoteNG_26.1.0_windows-x86_64.msi",
};

// The validator is generic over platform key names, so the per-installer
// `windows-<arch>-msi` keys need no production change here — only proof that
// `--require-platform` makes their omission a hard failure.
test("requires a per-installer MSI platform key when asked for one", () => {
  assert.deepEqual(
    validateUpdaterFeed(
      windowsFeed({
        "windows-x86_64": NSIS_ENTRY,
        "windows-x86_64-msi": MSI_ENTRY,
      }),
      {
        expectedVersion: "26.1.0",
        requiredPlatforms: ["windows-x86_64", "windows-x86_64-msi"],
      },
    ),
    [],
  );

  const errors = validateUpdaterFeed(
    windowsFeed({ "windows-x86_64": NSIS_ENTRY }),
    {
      expectedVersion: "26.1.0",
      requiredPlatforms: ["windows-x86_64", "windows-x86_64-msi"],
    },
  );
  assert.deepEqual(errors, ["platforms.windows-x86_64-msi is required."]);
});

test("rejects an MSI platform entry that ships without a signature", () => {
  const errors = validateUpdaterFeed(
    windowsFeed({
      "windows-x86_64": NSIS_ENTRY,
      "windows-x86_64-msi": { ...MSI_ENTRY, signature: "" },
    }),
    {
      expectedVersion: "26.1.0",
      requiredPlatforms: ["windows-x86_64-msi"],
    },
  );
  assert.ok(
    errors.includes(
      "platforms.windows-x86_64-msi.signature must not be empty.",
    ),
  );
});

test("collects repeated require-platform CLI flags", () => {
  assert.deepEqual(
    parseArgs([
      "feed.json",
      "--require-platform",
      "windows-x86_64",
      "--require-platform=windows-x86_64-msi",
      "--require-signature-files",
    ]).requiredPlatforms,
    ["windows-x86_64", "windows-x86_64-msi"],
  );
});

test("parses the unsigned feed contract and enables empty signatures", () => {
  const options = parseArgs(["feed.json", "--updater-signing", "unsigned"]);
  assert.equal(options.updaterSigning, "unsigned");
  assert.equal(options.allowEmptySignatures, true);
});
