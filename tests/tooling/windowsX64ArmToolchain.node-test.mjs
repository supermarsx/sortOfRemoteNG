import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dir = path.join(root, "native/windows-x64-arm-toolchain");
const workflow = await readFile(
  path.join(root, ".github/workflows/windows-x64-arm-toolchain.yml"),
  "utf8",
);
const profileRaw = await readFile(path.join(dir, "profile.json"));
const profile = JSON.parse(profileRaw);
const sha = (b) => createHash("sha256").update(b).digest("hex");

test("workflow is manual public default-branch diagnostics with newer superseding older", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /github\.repository_id == '1010282954'/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /runs-on: windows-2025-vs2026/);
  assert.doesNotMatch(
    workflow,
    /contents: write|workflow_run:|schedule:|pull_request:/,
  );
});

test("profile carries exact original SDK limits and distinct host without source admission", () => {
  assert.equal(profile.host, "x86_64-pc-windows-msvc");
  assert.equal(profile.target, "aarch64-pc-windows-msvc");
  assert.equal(profile.sdkVersion, "10.0.28000.0");
  assert.equal(profile.buildAdmission, false);
  assert.equal(profile.sourceId, null);
  assert.equal(profile.sdk.packages.length, 4);
  assert.equal(
    profile.sdk.packages.reduce((n, p) => n + p.bytes, 0),
    370561596,
  );
  assert.equal(
    profile.sdk.packages.reduce((n, p) => n + p.members, 0),
    7434,
  );
  assert.equal(profile.sdk.limits.memberBytes, 128 * 1024 ** 2);
  assert.equal(profile.sdk.limits.files, 7500);
  assert.equal(profile.sdk.limits.expandedBytes, 1536 * 1024 ** 2);
  assert.equal(profile.installedMsvc14.length, 14);
});

test("archive expectations come from pinned DEPS and runtime extra is not selected on Windows", () => {
  assert.equal(
    profile.llvm.sha256,
    "4c4a15912845f39189784360a03ae62c65dba29b884ef60ec9c6b4d43754dca0",
  );
  assert.equal(
    profile.deferredRust.sha256,
    "14bc9cea5e00cb191f58204ef44d68a6794f856a76f885c50298a12d052035bc",
  );
  assert.equal(
    profile.conditionalRuntime.sha256,
    "51c15d0bc56eaf36b2c7b1eb6c2e9b70442201c6040abf438fb1c310e01882fe",
  );
  assert.equal(profile.conditionalRuntime.selected, false);
  assert.equal(profile.deferredRust.acquiredInThisSlice, false);
  assert.equal(profile.missingClosures.length, 4);
});

test("nine-path closure includes its tests and contains no selected engineering producer source", () => {
  assert.equal(profile.sourcePaths.length, 9);
  assert.equal(new Set(profile.sourcePaths).size, 9);
  assert(
    profile.sourcePaths.includes(
      "native/windows-x64-arm-toolchain/test_toolchain.py",
    ),
  );
  assert(
    profile.sourcePaths.includes(
      "tests/tooling/windowsX64ArmToolchain.node-test.mjs",
    ),
  );
  for (const file of profile.sourcePaths)
    assert(
      !file.startsWith("scripts/") &&
        !file.includes("cef-engineering-checkpoint"),
    );
});

test("source pins bind profile in both worker and unchanged-policy backend derivative", async () => {
  const [worker, backend] = await Promise.all([
    readFile(path.join(dir, "slice.py"), "utf8"),
    readFile(path.join(dir, "job.py"), "utf8"),
  ]);
  assert(worker.includes('PROFILE_SHA = "' + sha(profileRaw) + '"'));
  assert(backend.includes('PROFILE_SHA = "' + sha(profileRaw) + '"'));
  assert(backend.includes("512*1024**2"));
  assert(backend.includes("cpu.rate!=2500"));
  assert(backend.includes("limits.basic.active_limit!=8"));
  assert(
    backend.includes(
      "from slice import closed_worker_command, verified_sources",
    ),
  );
});

test("original clocks include prehash, original two-second grace and shared cleanup", () => {
  assert.match(
    workflow,
    /Math\.min\(begin\+workMs-Date\.now\(\), workMs-\(performance\.now\(\)-beginMono\)\)/,
  );
  assert.match(workflow, /remaining\(\)\+30000/);
  assert.match(workflow, /monotonicWorkEnd:mono\+remaining\(\)\/1000/);
  assert.match(workflow, /import time;print\(time\.monotonic\(\)\)/);
  assert.match(workflow, /outcome\.code===0/);
  assert.match(workflow, /actual\.stages\.length===13/);
});

function actualHeld(fakeFs = fs) {
  const script = workflow
    .split("node --input-type=module <<'NODE'\n")[1]
    .split("\n          NODE")[0]
    .split("\n")
    .map((x) => x.slice(10))
    .join("\n");
  const begin = script.indexOf("async function physical(");
  const end = script.indexOf(
    "\ntry{\n  assert.equal(process.env.GITHUB_EVENT_NAME",
  );
  assert(begin > 0 && end > begin);
  return new Function(
    "fs",
    "path",
    "assert",
    script.slice(begin, end) + ";return held;",
  )(fakeFs, path, assert);
}

test("actual workflow held reader reads a real owned file and rejects cap/hardlink aliases", async () => {
  const base = await mkdtemp(
    path.join(await realpath(tmpdir()), "sorng-toolchain-test-"),
  );
  try {
    const file = path.join(base, "fixed");
    await writeFile(file, "owned bytes");
    assert.equal((await actualHeld()(file)).toString(), "owned bytes");
    await assert.rejects(actualHeld()(file, 2));
    await fs.link(file, path.join(base, "hardlink"));
    await assert.rejects(actualHeld()(file));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("actual returned read is bounded if a file grows after initial stat", async () => {
  const state = {
    dev: 1n,
    ino: 2n,
    size: 1n,
    nlink: 1n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    birthtimeNs: 5n,
    mode: 6n,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  let closed = false,
    reads = 0;
  const fake = {
    realpath: async (p) => p,
    lstat: async () => state,
    open: async () => ({
      stat: async () => state,
      close: async () => {
        closed = true;
      },
      read: async (buffer, offset, length) => {
        reads++;
        buffer.fill(97, offset, offset + length);
        return { bytesRead: length };
      },
    }),
  };
  await assert.rejects(actualHeld(fake)(path.resolve("fixed-owned"), 2));
  assert.equal(reads, 1);
  assert.equal(closed, true);
});

test("artifact globs retain diagnostics without SDK/LLVM archives or generated images", () => {
  const output = workflow.split("path: |\n")[1];
  assert(output.includes("jobs/*/*.json"));
  assert(output.includes("results/*.json"));
  assert(output.includes("logs/*.log"));
  assert(
    !output.includes("archives") &&
      !output.includes("bin/*") &&
      !output.includes("llvm/**") &&
      !output.includes("environment-private"),
  );
});
