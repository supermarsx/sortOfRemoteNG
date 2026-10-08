import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPlan,
  parseArgs as parseSyncVersionArgs,
  rootWorkspaceMemberManifests,
  rewriteShellAssignment,
  versionDerivedTextMatches,
} from "../../scripts/sync-version.mjs";
import {
  cargoPackageName,
  formatPublicVersion,
  projectVersion,
  renderFrontendVersionModule,
  rewriteCargoLock,
  rewriteMemberCargoManifest,
  rewriteRootCargoManifest,
} from "../../scripts/versioning.mjs";

test("root member discovery follows the canonical workspace rather than nested fixtures", () => {
  const source =
    '[workspace]\r\nmembers = [\r\n "crates/one", # member\r\n "crates/two",\r\n]\r\n[workspace.package]\r\nversion = "26.50.0"\r\n';
  assert.deepEqual(rootWorkspaceMemberManifests(source), [
    "src-tauri/crates/one/Cargo.toml",
    "src-tauri/crates/two/Cargo.toml",
  ]);
  for (const members of [
    '"crates/one", "crates/one"',
    '"crates/*"',
    '"../outside"',
    '"crates/../outside"',
    "null",
  ]) {
    assert.throws(() =>
      rootWorkspaceMemberManifests(`[workspace]\nmembers = [${members}]\n`),
    );
  }
  assert.throws(() =>
    rootWorkspaceMemberManifests(
      '[workspace]\n# members = ["crates/not-a-member"]\n',
    ),
  );
  assert.throws(() =>
    rootWorkspaceMemberManifests("[workspace]\nmembers = []\nmembers = []\n"),
  );
});

test("version planning preserves standalone acceptance versions and only updates root packages in their locks", () => {
  // Planning is read-only. Exercise a different version so every accidental
  // fixture rewrite is visible without changing any manifests or lockfiles.
  const plan = buildPlan("99.1");
  const rootManifest = readFileSync(
    new URL("../../src-tauri/Cargo.toml", import.meta.url),
    "utf8",
  );
  const members = rootWorkspaceMemberManifests(rootManifest);
  assert.equal(plan.memberManifestCount, members.length);
  assert.equal(plan.firstPartyPackageCount, members.length + 1);
  for (const [directory, packageName] of [
    ["native_acceptance", "sorng-cef-acceptance"],
    ["native_tls_acceptance", "sorng-cef-tls-acceptance"],
  ]) {
    const prefix = `src-tauri/crates/sorng-browser-host/tests/${directory}`;
    const manifestPath = `${prefix}/Cargo.toml`;
    assert.ok(!members.includes(manifestPath));
    assert.ok(
      !plan.changes.some((change) => change.relativePath === manifestPath),
    );
    const manifest = readFileSync(
      new URL(`../../${manifestPath}`, import.meta.url),
      "utf8",
    );
    assert.match(manifest, /^\[workspace\]\r?$/m);
    const fixtureVersion = /^version = "([^"]+)"\r?$/m.exec(manifest)[1];
    const lockChange = plan.changes.find(
      (change) => change.relativePath === `${prefix}/Cargo.lock`,
    );
    assert.ok(
      lockChange,
      "root dependency versions remain synchronized in fixture locks",
    );
    const fixtureBlock = lockChange.expected
      .split(/(?=^\[\[package\]\])/m)
      .find((block) => block.includes(`name = "${packageName}"`));
    assert.ok(fixtureBlock.includes(`version = "${fixtureVersion}"`));
    const firstPartyNames = new Set([
      cargoPackageName(rootManifest),
      ...members.map((member) =>
        cargoPackageName(
          readFileSync(new URL(`../../${member}`, import.meta.url), "utf8"),
        ),
      ),
    ]);
    assert.equal(
      lockChange.expected,
      rewriteCargoLock(lockChange.current, firstPartyNames, "99.1.0").text,
    );
  }
});

test("projects the public YY.N version to machine-only SemVer", () => {
  assert.deepEqual(projectVersion("26.1"), {
    publicVersion: "26.1",
    machineVersion: "26.1.0",
    year: 26,
    release: 1,
  });
  assert.throws(() => projectVersion("26.0"), /expected YY\.N/);
  assert.throws(() => projectVersion("26.1.0"), /expected YY\.N/);
  assert.throws(() => projectVersion("2026.1"), /expected YY\.N/);
});

test("accepts platform line endings without hiding version drift", () => {
  const expected = '{\n  "version": "26.1.0"\n}\n';
  const asCrlf = (value) => value.split("\n").join("\r\n");
  assert.equal(versionDerivedTextMatches(asCrlf(expected), expected), true);
  assert.equal(
    versionDerivedTextMatches(
      asCrlf(expected.replace("26.1.0", "26.2.0")),
      expected,
    ),
    false,
  );
  assert.equal(versionDerivedTextMatches(null, expected), false);
});

test("formats updater SemVer as the public YY.N identity", () => {
  assert.equal(formatPublicVersion("26.1.0"), "26.1");
  assert.equal(formatPublicVersion("v26.2.0"), "26.2");
  assert.equal(formatPublicVersion("26.3.7-beta.1"), "26.3");
  assert.equal(formatPublicVersion(null), "-");
  assert.equal(formatPublicVersion("not-a-version"), "not-a-version");
});

test("rewrites root and member Cargo package versions to workspace inheritance", () => {
  const root = [
    "[workspace]",
    'members = ["crates/example"]',
    "",
    "[workspace.dependencies]",
    'serde = "1"',
    "",
    "[package]",
    'name = "app"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'serde = { version = "1", workspace = true }',
    "",
  ].join("\n");
  const rewrittenRoot = rewriteRootCargoManifest(root, "26.1.0");
  assert.match(rewrittenRoot, /\[workspace\.package\]/);
  assert.match(rewrittenRoot, /version = "26\.1\.0"/);
  assert.match(rewrittenRoot, /\[package\][\s\S]*version\.workspace = true/);
  assert.match(rewrittenRoot, /serde = \{ version = "1", workspace = true \}/);
  assert.equal(
    rewriteRootCargoManifest(rewrittenRoot, "26.1.0"),
    rewrittenRoot,
  );

  const member = [
    "[package]",
    'name = "sorng-example"',
    'version = "0.1.0"',
    "",
    "[dependencies]",
    'example = "0.1.0"',
    "",
  ].join("\n");
  const rewrittenMember = rewriteMemberCargoManifest(member);
  assert.equal(cargoPackageName(rewrittenMember), "sorng-example");
  assert.match(rewrittenMember, /version\.workspace = true/);
  assert.match(rewrittenMember, /example = "0\.1\.0"/);
});

test("updates only named first-party Cargo.lock packages", () => {
  const lock = [
    "version = 4",
    "",
    "[[package]]",
    'name = "sorng-example"',
    'version = "0.1.0"',
    "",
    "[[package]]",
    'name = "third-party"',
    'version = "0.1.0"',
    'source = "registry+https://example.invalid/index"',
    "",
  ].join("\n");
  const rewritten = rewriteCargoLock(
    lock,
    new Set(["sorng-example"]),
    "26.1.0",
  );
  assert.deepEqual([...rewritten.found], ["sorng-example"]);
  assert.match(rewritten.text, /name = "sorng-example"\nversion = "26\.1\.0"/);
  assert.match(rewritten.text, /name = "third-party"\nversion = "0\.1\.0"/);
});

test("generates separate public and explicitly machine-only frontend values", () => {
  const generated = renderFrontendVersionModule("26.1", "26.1.0");
  assert.match(generated, /APP_VERSION = "26\.1"/);
  assert.match(generated, /Machine-only SemVer projection/);
  assert.match(generated, /APP_MACHINE_VERSION = "26\.1\.0"/);
  assert.match(generated, /formatAppVersion/);
});

test("accepts an explicit rolling release projection for CI snapshots", () => {
  assert.deepEqual(
    parseSyncVersionArgs([
      "--write",
      "--version",
      "26.9",
      "--source-sha",
      "a".repeat(40),
    ]),
    {
      mode: "write",
      sourceSha: "a".repeat(40),
      version: "26.9",
    },
  );
  assert.deepEqual(parseSyncVersionArgs(["--check"]), {
    mode: "check",
    sourceSha: null,
    version: null,
  });
  assert.throws(
    () => parseSyncVersionArgs(["--write", "--version", "v26.9"]),
    /expected YY\.N/,
  );
  assert.throws(
    () => parseSyncVersionArgs(["--write", "--check"]),
    /exactly one/,
  );
  assert.throws(
    () => parseSyncVersionArgs(["--write", "--source-sha", "not-a-sha"]),
    /lowercase 40-character SHA/,
  );
});

test("rewrites one package recipe assignment without disturbing the recipe", () => {
  const recipe = [
    "pkgname=sortofremoteng",
    "pkgver=26.1.0",
    `_commit=${"a".repeat(40)}`,
    "pkgrel=1",
    "",
  ].join("\n");
  const versioned = rewriteShellAssignment(recipe, "pkgver", "26.9.0");
  const pinned = rewriteShellAssignment(versioned, "_commit", "b".repeat(40));

  assert.match(pinned, /^pkgver=26\.9\.0$/m);
  assert.match(pinned, new RegExp(`^_commit=${"b".repeat(40)}$`, "m"));
  assert.match(pinned, /^pkgrel=1$/m);
  assert.throws(
    () => rewriteShellAssignment(recipe, "missing", "value"),
    /found 0/,
  );
});
