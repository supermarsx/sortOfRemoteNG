import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const seriesRoot = new URL(
  "../../native/cef-patches/154.0.8037.58-682c378/",
  import.meta.url,
);
const patchName = "0007-chromium-instance-tracer-reentrancy.patch";
const sourcePath =
  "base/allocator/partition_allocator/src/partition_alloc/pointers/instance_tracer.cc";

function untraceFromPatch(patch, after) {
  const lines = patch
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith(" ") ||
        (line.startsWith(after ? "+" : "-") &&
          !line.startsWith(after ? "+++" : "---")),
    )
    .map((line) => line.slice(1))
    .join("\n");
  const marker = "void InstanceTracer::UntraceImpl(uint64_t owner_id)";
  const start = lines.indexOf(marker);
  assert.ok(
    start >= 0,
    "Maintained hunk must include the complete actual function",
  );
  const brace = lines.indexOf("{", start);
  let depth = 1;
  for (let end = brace + 1; end < lines.length; end++) {
    if (lines[end] === "{") depth++;
    if (lines[end] === "}" && --depth === 0) return lines.slice(start, end + 1);
  }
  assert.fail(
    "Maintained function is incomplete; do not substitute a handwritten implementation",
  );
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    ...options,
  });
}

test("maintained tracer delta changes only node-destruction placement, not security flags", async () => {
  const patch = await readFile(new URL(patchName, seriesRoot), "utf8");
  assert.deepEqual(patch.match(/^diff --git .+$/gm), [
    `diff --git a/${sourcePath} b/${sourcePath}`,
  ]);
  const removed = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(
    removed.map((line) => line.slice(1).trim()),
    [
      "const std::lock_guard guard(GetStorageMutex());",
      "GetStorage().erase(owner_id);",
    ],
  );
  const before = untraceFromPatch(patch, false);
  const after = untraceFromPatch(patch, true);
  assert.match(before, /GetStorage\(\)\.erase\(owner_id\)/);
  assert.match(after, /PA_CHECK\(owner_id\)/);
  assert.match(after, /return GetStorage\(\)\.extract\(owner_id\)/);
  assert.doesNotMatch(
    patch,
    /recursive_mutex|thread_local|enable_backup_ref_ptr.*=|enable_dangling.*=|no-sandbox/,
  );
  const series = await readFile(new URL("series", seriesRoot), "utf8");
  assert.equal(
    series.split(/\r?\n/).filter((line) => line === `chromium ${patchName}`)
      .length,
    1,
  );
  const inventory = JSON.parse(
    await readFile(new URL("upstream-sha256.json", seriesRoot), "utf8"),
  );
  const row = inventory.filter(
    (entry) => entry.project === "chromium" && entry.path === sourcePath,
  );
  assert.equal(row.length, 1);
  assert.equal(
    row[0].sha256,
    "853a73637d8aa9cb5c6c93650ca4eead862426185eb37b51f97d6c8bd2283a67",
  );
});

test("actual patched Untrace passes allocator reentry; baseline detects the deadlock contract", async (t) => {
  const patch = await readFile(new URL(patchName, seriesRoot), "utf8");
  const fixture = await readFile(
    new URL("fixtures/cefInstanceTracerReentry.cc", import.meta.url),
    "utf8",
  );
  const candidates = process.env.CXX ? [process.env.CXX] : ["clang++", "g++"];
  let compiler;
  for (const candidate of candidates) {
    const version = run(candidate, ["--version"], { timeout: 5_000 });
    if (!version.error && version.status === 0) {
      compiler = candidate;
      t.diagnostic(version.stdout.split(/\r?\n/)[0]);
      break;
    }
  }
  assert.ok(
    compiler,
    "A C++17 clang++/g++ compiler is required; do not skip the regression",
  );
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "sorng-tracer-reentry-"));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-tracer-reentry-"));
    await rm(root, { recursive: true, force: true });
  });
  for (const after of [false, true]) {
    const name = after ? "patched" : "baseline";
    const source = path.join(root, `${name}.cc`);
    const binary = path.join(
      root,
      name + (process.platform === "win32" ? ".exe" : ""),
    );
    await writeFile(
      source,
      fixture.replace(
        "// EXACT_MAINTAINED_UNTRACE_FUNCTION",
        untraceFromPatch(patch, after),
      ),
    );
    const compiled = run(
      compiler,
      [
        "-std=c++17",
        "-pthread",
        "-O0",
        "-Wall",
        "-Wextra",
        "-Werror",
        source,
        "-o",
        binary,
      ],
      { cwd: root },
    );
    assert.ifError(compiled.error);
    assert.equal(
      compiled.status,
      0,
      `${name} compile failed:\n${compiled.stdout}\n${compiled.stderr}`,
    );
    const result = run(binary, [], { cwd: root, timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(
      result.status,
      after ? 0 : 42,
      `${name}:\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      result.stdout,
      after
        ? /PASS: .*259 allocator reentries/
        : /BASELINE_REENTRANT_FREE_UNDER_LOCK/,
    );
    t.diagnostic(`${name}: ${result.stdout.trim()}`);
  }
});
