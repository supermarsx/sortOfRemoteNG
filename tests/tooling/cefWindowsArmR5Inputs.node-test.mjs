import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  identitySha256,
  validateSourceLock,
} from "../../scripts/lib/browser-custom-runtime.mjs";

import { validateRunnerMap } from "../../scripts/cef-runtime-ci.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const namespace =
  "native/cef-build-inputs/20261025-r5-capsule22-windows-arm64-native";
const base =
  "native/cef-build-inputs/20261024-r5-trace-helper-static-package-name-windows-x64";
const raw = async (name) => readFile(path.join(root, name));
const json = async (name) => JSON.parse(await raw(name));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lock = await json(namespace + "/source-lock.json"),
  old = await json(base + "/source-lock.json"),
  review = await json(namespace + "/review-receipt.json");
const gn = "gn/aarch64-pc-windows-msvc.gn",
  tools = "tools/aarch64-pc-windows-msvc.json",
  runner = "cef-ci-runner-aarch64-pc-windows-msvc.json";
const copied = [
  ...old.patches.map((p) => p.path),
  old.bridge.header.path,
  "upstream-sha256.json",
].sort();
const expected = [
  ...copied,
  gn,
  tools,
  runner,
  "source-lock.json",
  "review-receipt.json",
].sort();
async function files(directory, prefix = "") {
  const rows = [];
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name),
      s = await lstat(file);
    assert(!s.isSymbolicLink());
    if (s.isDirectory()) rows.push(...(await files(file, prefix + name + "/")));
    else {
      assert(s.isFile());
      rows.push(prefix + name);
    }
  }
  return rows.sort();
}
function exactGnProjection(original, projected) {
  assert.equal(original.toString().split('target_cpu="x64"').length, 2);
  assert.deepEqual(
    projected,
    Buffer.from(
      original.toString().replace('target_cpu="x64"', 'target_cpu="arm64"'),
    ),
  );
}

test("native ARM candidate has exact29 paths, no extra input or source publication", async () => {
  assert.equal(expected.length, 29);
  assert.equal(new Set(expected).size, 29);
  assert.deepEqual(await files(path.join(root, namespace)), expected);
  const attrs = (await raw(".gitattributes")).toString(),
    ignore = (await raw(".prettierignore")).toString();
  assert.equal(attrs.split(namespace + "/** -text -whitespace").length, 2);
  assert.equal(ignore.split(namespace + "/").length, 2);
});

test("all24 inherited patch/header/upstream payloads remain byte-identical", async () => {
  assert.equal(copied.length, 24);
  assert.equal(old.patches.length, 22);
  assert.deepEqual(review.inheritedRawFiles.map((r) => r.path).sort(), copied);
  for (const file of copied) {
    const original = await raw(base + "/" + file),
      candidate = await raw(namespace + "/" + file);
    assert.deepEqual(candidate, original, file);
    const pin = review.inheritedRawFiles.find((r) => r.path === file);
    assert.equal(pin.bytes, original.length);
    assert.equal(pin.sha256, digest(original));
  }
  assert.deepEqual(lock.upstream, old.upstream);
  assert.deepEqual(lock.patches, old.patches);
  assert.deepEqual(lock.bridge, old.bridge);
});

test("GN changes only target CPU and retains the complete R5 flags", async () => {
  const original = await raw(base + "/gn/x86_64-pc-windows-msvc.gn"),
    projected = await raw(namespace + "/" + gn);
  exactGnProjection(original, projected);
  assert.match(
    projected.toString(),
    /enable_backup_ref_ptr_instance_tracer=false/,
  );
  assert.doesNotMatch(
    projected.toString(),
    /is_clang=false|host_cpu=|enable_backup_ref_ptr_support=false/,
  );
  assert.throws(() =>
    exactGnProjection(
      original,
      Buffer.from(projected.toString() + "is_clang=false\n"),
    ),
  );
  assert.throws(() =>
    exactGnProjection(
      original,
      Buffer.from(
        projected.toString().replace("symbol_level=1", "symbol_level=0"),
      ),
    ),
  );
  assert.equal(digest(projected), lock.builds[0].gnArgs.sha256);
});

test("maintained source schema and canonical identity bind exact ARM build inputs", async () => {
  validateSourceLock(lock);
  assert.equal(
    identitySha256(lock),
    "839fdbee4973c236e111445af98f5de8c3c165563f1f64b1be781d69f1074b34",
  );
  assert.equal(review.sourceLockIdentity, identitySha256(lock));
  assert.equal(
    review.sourceLockRawSha256,
    digest(await raw(namespace + "/source-lock.json")),
  );
  assert.equal(lock.builds.length, 1);
  assert.equal(lock.builds[0].target, "aarch64-pc-windows-msvc");
  assert.equal(lock.builds[0].gnArgs.path, gn);
  assert.equal(lock.builds[0].toolchainLock.path, tools);
  assert.equal(
    lock.builds[0].toolchainLock.sha256,
    digest(await raw(namespace + "/" + tools)),
  );
  const changed = structuredClone(lock);
  changed.builds[0].gnArgs.sha256 = "0".repeat(64);
  assert.notEqual(identitySha256(changed), review.sourceLockIdentity);
  const invalid = structuredClone(lock);
  invalid.builds[0].target = "arm64-unknown";
  assert.throws(() => validateSourceLock(invalid));
});

test("tool projection contains only genuine historical25 rows plus own pinned runner map", async () => {
  const profile = await json("native/windows-arm-native-compile/profile.json"),
    tool = await json(namespace + "/" + tools),
    map = await json(namespace + "/" + runner);
  assert.equal(profile.files.length, 25);
  assert.equal(tool.files.length, 26);
  assert.equal(tool.target, "aarch64-pc-windows-msvc");
  assert.deepEqual(
    tool.files.slice(0, 25),
    profile.files.map((row) => ({
      path: row.path.slice(3),
      size: row.size,
      sha256: row.sha256,
    })),
  );
  assert.equal(tool.files[25].path, runner);
  const bytes = await raw(namespace + "/" + runner);
  assert.equal(tool.files[25].size, bytes.length);
  assert.equal(tool.files[25].sha256, digest(bytes));
  validateRunnerMap(map, "aarch64-pc-windows-msvc");
  assert.equal(map.hosted.imageVersion, profile.image);
  assert.equal(map.hosted.architecture, "arm64");
  assert.equal(map.hosted.runner, "windows-11-arm");
  assert.equal(map.python, profile.python.path.slice(3));
  assert.equal(
    map.git,
    profile.files.find((r) => r.role === profile.programs.git).path.slice(3),
  );
  assert.equal(map.environment.GYP_MSVS_VERSION, "2026");
  assert(
    !tool.files.some((r) =>
      /clang-cl|lld-link|siso|gn\.exe|rustc/i.test(r.path),
    ),
  );
});

test("candidate explicitly denies build/acceptance claims and keeps unknown engine closure", () => {
  assert.equal(review.engineCompilerClosure.complete, false);
  for (const [key, value] of Object.entries(review.engineCompilerClosure))
    if (key !== "complete") assert.equal(value, "unknown", key);
  for (const key of [
    "engineAcquired",
    "engineCompiled",
    "nativeTestsRun",
    "sdkCreated",
    "runtimeAcceptance",
    "oldNativeProofTransferred",
    "defaultSelectionChanged",
    "publicationAllowed",
    "buildAdmissionGranted",
  ])
    assert.equal(review[key], false, key);
  assert.equal(review.observedToolFoundation.setupSelection, null);
  assert.equal(
    review.observedToolFoundation.currentDiagnosticResultTransferred,
    false,
  );
  assert.equal(review.bridgeAbiVersion, 2);
  assert.equal(review.bridgeRevision, 5);
  assert.equal(review.capabilities.length, 9);
});
