import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

const allocationPatchName =
  "0017-chromium-instance-tracer-allocation-reentrancy.patch";
const allocationRoot =
  "base/allocator/partition_allocator/src/partition_alloc/";

function patchFile(patch, relative) {
  const expected = `diff --git a/${relative} b/${relative}`;
  const sections = patch.replace(/\r\n/g, "\n").split(/(?=^diff --git )/m);
  const matches = sections.filter(
    (section) => section.split("\n")[0] === expected,
  );
  assert.equal(
    matches.length,
    1,
    `Exactly one maintained delta for ${relative}`,
  );
  return matches[0];
}

function addedFile(patch, relative) {
  const section = patchFile(patch, relative);
  assert.match(section, /^new file mode 100644$/m);
  assert.match(section, /^--- \/dev\/null$/m);
  const hunks = [...section.matchAll(/^@@ -0,0 \+1,([1-9][0-9]*) @@$/gm)];
  assert.equal(hunks.length, 1, "Extract the complete actual added file");
  const body = section.slice(hunks[0].index + hunks[0][0].length + 1);
  const lines = body.split("\n");
  assert.equal(lines.pop(), "", "Maintained source ends with a newline");
  assert.equal(lines.length, Number(hunks[0][1]));
  assert.ok(lines.every((line) => line.startsWith("+")));
  return lines.map((line) => line.slice(1)).join("\n") + "\n";
}

// Mask lexical non-code without joining statements across source lines.
function cppCode(source) {
  return source.replace(
    /R"([^ ()\\\t\r\n]{0,16})\([\s\S]*?\)\1"|\/\*[\s\S]*?\*\/|\/\/(?:\\\r?\n|[^\n])*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (token) => token.replace(/[^\n]/g, " "),
  );
}

function assertDelegation(source) {
  assert.doesNotMatch(
    source,
    /\\\r?\n/,
    "Line splicing is unsupported in the maintained delegation projection",
  );
  const implementation = cppCode(source);
  assert.match(implementation, /InstanceTracerStorage<Info>/);
  assert.match(
    implementation,
    /^[ \t]*GetStorage\(\)\.Trace\(owner_id, slot_count, may_dangle\);[ \t]*$/m,
  );
  assert.match(
    implementation,
    /^[ \t]*GetStorage\(\)\.Untrace\(owner_id\);[ \t]*$/m,
  );
  assert.match(
    implementation,
    /^[ \t]*return GetStorage\(\)\.GetStackTracesForAllocation\(allocation\);[ \t]*$/m,
  );
  assert.doesNotMatch(
    implementation,
    /recursive_mutex|thread_local|enable_backup_ref_ptr.*=/,
  );
}

async function allocationSources() {
  const [patch, series] = await Promise.all([
    readFile(new URL(allocationPatchName, seriesRoot), "utf8"),
    readFile(new URL("series", seriesRoot), "utf8"),
  ]);
  assert.equal(
    series
      .split(/\r?\n/)
      .filter((line) => line === `chromium ${allocationPatchName}`).length,
    1,
    "The allocation fix must be registered exactly once",
  );
  const implementation = patchFile(patch, sourcePath)
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith(" ") ||
        (line.startsWith("+") && !line.startsWith("+++")),
    )
    .map((line) => line.slice(1))
    .join("\n");
  assertDelegation(implementation);
  return {
    header: addedFile(
      patch,
      allocationRoot + "pointers/instance_tracer_storage.h",
    ),
    tests: addedFile(
      patch,
      allocationRoot + "pointers/instance_tracer_storage_unittest.cc",
    ),
  };
}

test("delegation statements must be code, including across patch context lines", () => {
  const statements = [
    "InstanceTracerStorage<Info>",
    "GetStorage().Trace(owner_id, slot_count, may_dangle);",
    "GetStorage().Untrace(owner_id);",
    "return GetStorage().GetStackTracesForAllocation(allocation);",
  ];
  assertDelegation(statements.join("\n"));
  assert.throws(() =>
    assertDelegation("/" + "\\" + "\n*\n" + statements.join("\n") + "\n*/"),
  );
  for (let index = 1; index < statements.length; index++) {
    for (const hide of [
      (line) => `/*\n${line}\n*/`,
      (line) => `// ${line}`,
      (line) => `"escaped \\"\n${line}\n"`,
      (line) => `R"tag(\n${line}\n)tag"`,
    ]) {
      const changed = [...statements];
      changed[index] = hide(changed[index]);
      assert.throws(() => assertDelegation(changed.join("\n")));
    }
  }
});

test("patch 17 binds the tested storage to every real tracer operation", async () => {
  const sources = await allocationSources();
  assert.match(sources.header, /class InstanceTracerStorage/);
  assert.match(
    sources.tests,
    /#include "partition_alloc\/pointers\/instance_tracer_storage\.h"/,
  );
  assert.match(sources.tests, /InstanceTracerStorageIntegrationTest/);
});

test("patch 17 actual shared header and same nine tests compile and run without Chromium initialization", async (t) => {
  const sources = await allocationSources();
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
    "A C++17 compiler is required to execute maintained storage regressions",
  );
  const parent = await realpath(os.tmpdir());
  const parentStamp = await lstat(parent, { bigint: true });
  const root = await mkdtemp(path.join(parent, "sorng-tracer-allocation-"));
  const rootStamp = await lstat(root, { bigint: true });
  t.after(async () => {
    const currentParent = await lstat(parent, { bigint: true });
    const currentRoot = await lstat(root, { bigint: true });
    assert.ok(currentRoot.isDirectory() && !currentRoot.isSymbolicLink());
    assert.equal(await realpath(root), root);
    assert.equal(await realpath(parent), parent);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sorng-tracer-allocation-"));
    for (const field of ["dev", "ino"]) {
      assert.equal(currentRoot[field], rootStamp[field]);
      assert.equal(currentParent[field], parentStamp[field]);
    }
    await rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "partition_alloc", "pointers");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "instance_tracer_storage.h"),
    sources.header,
    { flag: "wx" },
  );
  const source = path.join(root, "instance_tracer_storage_unittest.cc");
  await writeFile(source, sources.tests, { flag: "wx" });
  const binary = path.join(
    root,
    "storage-tests" + (process.platform === "win32" ? ".exe" : ""),
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
      "-DSORNG_INSTANCE_TRACER_STORAGE_STANDALONE",
      "-I",
      root,
      source,
      "-o",
      binary,
    ],
    { cwd: root },
  );
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
  const result = run(binary, [], { cwd: root, timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^tests=9 failures=0\r?$/m);
  t.diagnostic(
    "Nine tests executed from the exact patch header and test source; real raw_ptr/engine acceptance is a separate gate",
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
