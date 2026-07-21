import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs as parseSyncVersionArgs } from "../../scripts/sync-version.mjs";
import {
  cargoPackageName,
  formatPublicVersion,
  projectVersion,
  renderFrontendVersionModule,
  rewriteCargoLock,
  rewriteMemberCargoManifest,
  rewriteRootCargoManifest,
} from "../../scripts/versioning.mjs";

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
  assert.deepEqual(parseSyncVersionArgs(["--write", "--version", "26.9"]), {
    mode: "write",
    version: "26.9",
  });
  assert.deepEqual(parseSyncVersionArgs(["--check"]), {
    mode: "check",
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
});
