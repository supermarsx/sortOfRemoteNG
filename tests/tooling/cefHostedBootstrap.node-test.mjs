import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { UPSTREAM_CHROMIUM_COMMIT } from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  RECIPE,
  assertCleanupTarget,
  discoveryBlockers,
  inventoryFile,
  nativeWindowsShell,
  observe,
  peArchitecture,
  probeFailure,
  selectTarget,
} from "../../scripts/cef-hosted-bootstrap.mjs";

test("discovery covers six exact native standard-public targets, never paid or arbitrary labels", () => {
  assert.equal(RECIPE.chromiumCommit, UPSTREAM_CHROMIUM_COMMIT);
  assert.equal(RECIPE.targets.length, 6);
  assert.equal(new Set(RECIPE.targets.map((row) => row.target)).size, 6);
  assert.deepEqual(
    RECIPE.targets.map((row) => row.runner),
    [
      "windows-2025-vs2026",
      "windows-11-arm",
      "ubuntu-24.04",
      "ubuntu-24.04-arm",
      "macos-15-intel",
      "macos-15",
    ],
  );
  for (const row of RECIPE.targets)
    assert.equal(selectTarget(row.target, row.platform, row.architecture), row);
  assert.throws(() => selectTarget("arbitrary"), /Unknown/);
  assert.throws(
    () => selectTarget("aarch64-apple-darwin", "darwin", "x64"),
    /native target/,
  );
});

const adequate = {
  pythonVersion: [3, 12, 10],
  visualStudioVersion: "18.10.1",
  windowsSdk: "10.0.28000.0",
  debuggerVersion: "10.0.26100.3323 (WinBuild)",
  availableGiB: 120,
  memoryGiB: 16,
};
test("actual prerequisites do not silently downgrade VS, SDK, Python or capacity", () => {
  assert.deepEqual(discoveryBlockers(adequate, "win32"), []);
  assert.deepEqual(
    discoveryBlockers({ ...adequate, macSdkVersion: "15.0" }, "darwin"),
    [],
  );
  assert.ok(
    discoveryBlockers({ ...adequate, macSdkVersion: "14.9" }, "darwin").length,
  );
  assert.ok(discoveryBlockers(adequate, "darwin").length);
  assert.deepEqual(
    discoveryBlockers(
      {
        ...adequate,
        visualStudioVersion: undefined,
        windowsSdk: undefined,
        debuggerVersion: undefined,
        nativeProbeCompleted: false,
      },
      "win32",
    ),
    [],
  );
  for (const patch of [
    { pythonVersion: [3, 11, 0] },
    { pythonVersion: [3] },
    { pythonVersion: null },
    { visualStudioVersion: "17.14.1" },
    { visualStudioVersion: undefined },
    { windowsSdk: "10.0.26100.0" },
    { debuggerVersion: "10.0.26100.3322" },
    { debuggerVersion: null },
    { availableGiB: 84 },
    { availableGiB: NaN },
    { memoryGiB: 7 },
  ])
    assert.ok(
      discoveryBlockers({ ...adequate, ...patch }, "win32").length,
      JSON.stringify(patch),
    );
  assert.deepEqual(
    discoveryBlockers(
      { ...adequate, visualStudioVersion: null, windowsSdk: null },
      "linux",
    ),
    [],
  );
});

const pe = (machine) => {
  const bytes = Buffer.alloc(128);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x00004550, 64);
  bytes.writeUInt16LE(machine, 68);
  return bytes;
};
test("Windows probe uses only a fixed installed native-architecture PowerShell", async () => {
  assert.equal(peArchitecture(pe(0xaa64)), "arm64");
  assert.equal(peArchitecture(pe(0x8664)), "x64");
  assert.equal(peArchitecture(Buffer.from("not a PE")), null);
  const observed = [];
  const shell = await nativeWindowsShell(
    { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" },
    "arm64",
    async (file) => {
      observed.push(file);
      return file.endsWith("pwsh.exe") ? pe(0x8664) : pe(0xaa64);
    },
  );
  assert.equal(
    shell,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.deepEqual(observed, [
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    shell,
  ]);
  await assert.rejects(
    nativeWindowsShell({}, "arm64", async () => pe(0x8664)),
    /matching native/,
  );
  assert.equal(
    await nativeWindowsShell({}, "arm64", async () => pe(0xaa64)),
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  );
});

test("failed native discovery records only fixed stage, timeout and exit diagnostics", () => {
  assert.deepEqual(
    probeFailure(
      {
        killed: true,
        code: null,
        signal: "SIGTERM",
        message: "sensitive raw process text",
        stdout: "private output",
        stderr: "private error",
      },
      "windows-native-tools",
    ),
    {
      stage: "windows-native-tools",
      kind: "timeout",
      exitCode: null,
      signal: "SIGTERM",
    },
  );
  assert.equal(probeFailure({ code: 7 }, "native-tools").exitCode, 7);
  assert.equal(
    probeFailure(new SyntaxError("raw JSON content"), "native-tools").kind,
    "invalid-output",
  );
  assert.equal(
    probeFailure({ code: "NATIVE_SHELL_UNAVAILABLE" }, "windows-native-tools")
      .kind,
    "native-shell-unavailable",
  );
});

const hosted = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY_VISIBILITY: "public",
  RUNNER_TEMP: "/home/runner/work/_temp",
};
const cleanupOptions = {
  platform: "linux",
  env: hosted,
  checkout: "/home/runner/work/repo/repo",
};
test("cleanup accepts only exact reviewed disposable directories on public ephemeral Linux", () => {
  for (const candidate of RECIPE.linuxCleanupPaths)
    assert.equal(assertCleanupTarget(candidate, cleanupOptions), candidate);
  for (const candidate of [
    "/",
    "/opt",
    "/home/runner",
    "/usr/share/dotnet/../dotnet",
    "/usr/share/dotnet/subdir",
  ])
    assert.throws(() => assertCleanupTarget(candidate, cleanupOptions));
  for (const patch of [
    { platform: "win32" },
    { env: { ...hosted, RUNNER_ENVIRONMENT: "self-hosted" } },
    { env: { ...hosted, GITHUB_REPOSITORY_VISIBILITY: "private" } },
    { env: { ...hosted, GITHUB_ACTIONS: "false" } },
    { canonical: "/different" },
    { symlink: true },
    { checkout: "/usr/share/dotnet/source" },
    { temp: "/usr/share/dotnet/temp" },
  ])
    assert.throws(() =>
      assertCleanupTarget("/usr/share/dotnet", { ...cleanupOptions, ...patch }),
    );
});

test("tool candidate hashes measure actual bytes, change on tampering and cannot escape tools root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-hosted-inventory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "python-tool");
  await writeFile(file, "synthetic tool bytes, never an executable");
  const pin = await inventoryFile(
    file,
    await import("node:fs/promises").then((fs) => fs.realpath(root)),
  );
  assert.equal(pin.path, "python-tool");
  assert.equal(
    pin.size,
    Buffer.byteLength("synthetic tool bytes, never an executable"),
  );
  assert.equal(
    pin.sha256,
    createHash("sha256")
      .update("synthetic tool bytes, never an executable")
      .digest("hex"),
  );
  await writeFile(file, "changed");
  assert.notEqual((await inventoryFile(file, root)).sha256, pin.sha256);
  await assert.rejects(
    inventoryFile(file, path.join(root, "unrelated")),
    /escapes/,
  );
});

test("local or private execution refuses before observing or deleting anything", async () => {
  const native = RECIPE.targets.find(
    (row) =>
      row.platform === process.platform && row.architecture === process.arch,
  );
  assert.ok(native);
  await assert.rejects(
    observe({ target: native.target, output: "unused", cleanup: true }, {}),
    /public standard/,
  );
  await assert.rejects(
    observe(
      { target: native.target, output: "unused" },
      { ...hosted, GITHUB_REPOSITORY_VISIBILITY: "private" },
    ),
    /public standard/,
  );
});

test("discovery workflow is read-only, bounded, explicit, and cannot enter producer or publisher", async () => {
  const workflow = YAML.parse(
    await readFile(
      new URL(
        "../../.github/workflows/cef-patched-runtime.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.mode.default, "build");
  assert.deepEqual(inputs.mode.options, ["build", "discover"]);
  assert.equal(inputs.discovery_cleanup_linux.default, false);
  const job = workflow.jobs.discover;
  assert.match(job.if, /mode == 'discover'/);
  assert.match(job.if, /visibility == 'public'/);
  assert.equal(job["timeout-minutes"], 15);
  assert.equal(job["runs-on"], "${{ matrix.runner }}");
  assert.deepEqual(
    job.strategy.matrix.include.map(({ target, runner }) => ({
      target,
      runner,
    })),
    RECIPE.targets.map(({ target, runner }) => ({ target, runner })),
  );
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(job.environment, undefined);
  assert.equal(job.permissions, undefined);
  assert.ok(
    job.steps.some((step) => step.run?.includes("cef-hosted-bootstrap.mjs")),
  );
  assert.ok(
    job.steps.some(
      (step) =>
        step.uses?.startsWith("actions/upload-artifact") &&
        step.if === "always()",
    ),
  );
  for (const name of ["plan", "build", "publish"]) {
    assert.match(workflow.jobs[name].if, /mode != 'discover'/);
    assert.match(workflow.jobs[name].if, /default_branch/);
  }
});
