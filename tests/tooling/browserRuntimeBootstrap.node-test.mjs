import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensurePublishedRuntime,
  validateRuntimeReleaseCatalog,
  RUNTIME_RELEASE_CATALOG,
} from "../../scripts/lib/browser-runtime-bootstrap.mjs";
import {
  parseArguments,
  validateBuildHost,
} from "../../scripts/browser-app-build.mjs";
import { TARGETS } from "../../scripts/browser-runtime-package.mjs";

// Synthetic descriptor identity. Never a downloadable or production engine pin.
const entry = {
  descriptorUrl:
    "https://github.com/example/fixture/releases/download/cef-test/runtime.json",
  descriptorSha256: "a".repeat(64),
};
const catalog = (targets = {}) => ({
  schemaVersion: 1,
  kind: "sorng-cef-runtime-releases",
  targets,
});
async function fixture(value = catalog({ [TARGETS[0]]: entry })) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-bootstrap-"));
  const catalogFile = path.join(root, "releases.json");
  await writeFile(catalogFile, JSON.stringify(value));
  const calls = [];
  return {
    calls,
    options: { cef: true, target: TARGETS[0], download: true },
    dependencies: {
      catalogFile,
      selectionFile: path.join(root, "selection.json"),
      cacheRoot: path.join(root, "cache"),
      fetchRuntime: async (request) => {
        calls.push(request);
        return { verified: true };
      },
    },
  };
}

test("checked-in catalog has no invented platform binaries", async () => {
  validateRuntimeReleaseCatalog(
    JSON.parse(await readFile(RUNTIME_RELEASE_CATALOG, "utf8")),
  );
});

test("catalog accepts pinned assets for all six targets", () => {
  const value = catalog(Object.fromEntries(TARGETS.map((t) => [t, entry])));
  assert.equal(validateRuntimeReleaseCatalog(value), value);
});

test("catalog rejects mutable, unpinned, credential-bearing and unknown entries", () => {
  for (const broken of [
    null,
    [],
    { ...catalog(), targets: [] },
    { ...catalog(), surprise: true },
    catalog({ unknown: entry }),
    catalog({ [TARGETS[0]]: { ...entry, descriptorSha256: "0".repeat(64) } }),
    catalog({ [TARGETS[0]]: { ...entry, descriptorSha256: "a".repeat(63) } }),
    catalog({ [TARGETS[0]]: { ...entry, extra: true } }),
    ...[
      "http://github.com/a/b/releases/download/v1/runtime.json",
      "https://token@github.com/a/b/releases/download/v1/runtime.json",
      "https://github.com/a/b/releases/latest/download/runtime.json",
      "https://github.com/a/b/releases/download/latest/runtime.json",
      "https://github.com/a/b/releases/download/rolling/runtime.json",
      "https://github.com/a/b/releases/download/main/runtime.json",
      "https://github.com/a/b/releases/download/../runtime.json",
      "https://example.com/runtime.json",
      "https://github.com/a/b/releases/download/v1/runtime.json?token=x",
    ].map((descriptorUrl) =>
      catalog({ [TARGETS[0]]: { ...entry, descriptorUrl } }),
    ),
  ])
    assert.throws(() => validateRuntimeReleaseCatalog(broken), /Invalid/);
});

test("normal build acquires exactly the reviewed target without source compilation", async () => {
  const f = await fixture();
  const result = await ensurePublishedRuntime(f.options, f.dependencies);
  assert.equal(result.acquired, true);
  assert.deepEqual(f.calls, [
    {
      ...entry,
      target: TARGETS[0],
      selectionFile: f.dependencies.selectionFile,
      cacheRoot: f.dependencies.cacheRoot,
      offline: false,
    },
  ]);
});

test("offline and download opt-out reach cache-only consumer", async () => {
  for (const restriction of [{ offline: true }, { download: false }]) {
    const f = await fixture();
    await ensurePublishedRuntime(
      { ...f.options, ...restriction },
      f.dependencies,
    );
    assert.equal(f.calls[0].offline, true);
  }
});

test("existing selections, even corrupt ones, are never replaced automatically", async () => {
  const f = await fixture();
  await writeFile(f.dependencies.selectionFile, "invalid retained content");
  const result = await ensurePublishedRuntime(f.options, f.dependencies);
  assert.equal(result.reason, "existing-selection");
  assert.equal(f.calls.length, 0);
  assert.equal(
    await readFile(f.dependencies.selectionFile, "utf8"),
    "invalid retained content",
  );
});

test("explicit SDKs and browser-disabled builds never read catalog or fetch", async () => {
  const f = await fixture();
  f.dependencies.catalogFile = path.join(f.dependencies.cacheRoot, "missing");
  for (const explicit of [
    { cef: false },
    { runtimeKind: "official" },
    { runtimeKind: "custom" },
    { customManifest: "reviewed.json" },
    { sourceLock: "source-lock.json" },
    { sdk: "sdk" },
    { artifactRoot: "artifacts" },
    { archive: "archive.tar.bz2" },
  ]) {
    const result = await ensurePublishedRuntime(
      { ...f.options, ...explicit },
      f.dependencies,
    );
    assert.equal(result.acquired, false);
  }
  assert.equal(f.calls.length, 0);
});

test("missing platform publication and download failures cannot select stock CEF", async () => {
  const f = await fixture(catalog());
  await assert.rejects(
    ensurePublishedRuntime(f.options, f.dependencies),
    /No reviewed patched CEF release.*No stock fallback or source rebuild/,
  );
  assert.equal(f.calls.length, 0);
  const g = await fixture();
  g.dependencies.fetchRuntime = async () => {
    throw new Error("hash mismatch");
  };
  await assert.rejects(
    ensurePublishedRuntime(g.options, g.dependencies),
    /hash mismatch/,
  );
  await assert.rejects(readFile(g.dependencies.selectionFile), {
    code: "ENOENT",
  });
});

test("pre-acquisition parsing validates arguments, target, feature opt-out and offline", () => {
  const options = { deferRuntime: true, selectionFile: "not-read.json" };
  for (const target of TARGETS) {
    const parsed = parseArguments(
      ["dev", "--target", target, "--cef-offline"],
      {},
      options,
    );
    assert.equal(parsed.cef, true);
    assert.equal(parsed.target, target);
    assert.equal(parsed.offline, true);
  }
  assert.throws(() => parseArguments(["bad-mode"], {}, options), /Usage/);
  assert.throws(
    () => parseArguments(["dev", "--cef-download"], {}, options),
    /reviewed release catalog/,
  );
  assert.throws(
    () => parseArguments(["dev", "--cef-unknown"], {}, options),
    /Unknown CEF/,
  );
  assert.throws(
    () =>
      parseArguments(["dev", "--cef-offline", "--cef-download"], {}, options),
    /cannot acquire/,
  );
  const reduced = parseArguments(
    ["build", "--features", "lean", "--", "--no-default-features"],
    {},
    options,
  );
  assert.equal(reduced.cef, false);
});

test("host validation occurs without acquisition and preserves build-only cross architecture", () => {
  assert.throws(
    () =>
      validateBuildHost(
        { cef: true, mode: "build", target: "aarch64-apple-darwin" },
        "win32",
        "x64",
      ),
    /matching host OS/,
  );
  assert.throws(
    () =>
      validateBuildHost(
        { cef: true, mode: "dev", target: "aarch64-pc-windows-msvc" },
        "win32",
        "x64",
      ),
    /native architecture/,
  );
  validateBuildHost(
    { cef: true, mode: "build", target: "aarch64-pc-windows-msvc" },
    "win32",
    "x64",
  );
  validateBuildHost(
    { cef: false, mode: "build", target: "aarch64-apple-darwin" },
    "win32",
    "x64",
  );
});
