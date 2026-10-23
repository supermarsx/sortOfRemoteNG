import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { UPSTREAM_CHROMIUM_COMMIT } from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  RECIPE,
  assertCleanupTarget,
  cleanupLinuxCapacity,
  discoveryBlockers,
  hostedTargetMatrix,
  inventoryFile,
  nativeWindowsShell,
  observe,
  observeWindowsGit,
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

test("hosted scheduling selects all or one exact recipe target without aliases or environment fallback", () => {
  const expected = RECIPE.targets.map(({ target, runner, platform }) => ({
    target,
    runner,
    platform,
  }));
  assert.deepEqual(hostedTargetMatrix("all"), { include: expected });
  for (const row of expected) {
    assert.deepEqual(hostedTargetMatrix(row.target), { include: [row] });
  }
  for (const target of [
    undefined,
    null,
    "",
    "unknown",
    "linux",
    "ubuntu-24.04",
    "all ",
    "ALL",
    "x86_64-unknown-linux-gnu\n",
    [expected[0].target],
  ]) {
    assert.throws(
      () => hostedTargetMatrix(target),
      /Unknown hosted CEF target/,
    );
  }
  const mutable = hostedTargetMatrix("all");
  mutable.include[0].runner = "arbitrary-runner";
  mutable.include.pop();
  assert.deepEqual(hostedTargetMatrix("all"), { include: expected });
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

test("multiple observed Git installations are review candidates, while missing or failed observations still block", () => {
  for (const gitStatus of ["available", "ambiguous"])
    assert.deepEqual(
      discoveryBlockers({ ...adequate, gitStatus }, "win32"),
      [],
    );
  for (const gitStatus of ["missing", "unavailable"])
    assert.ok(
      discoveryBlockers({ ...adequate, gitStatus }, "win32").some((message) =>
        message.includes("Git"),
      ),
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

test("Windows Git observation records actual canonical bytes, PE architecture and version", async () => {
  for (const [machine, architecture] of [
    [0x8664, "x64"],
    [0xaa64, "arm64"],
  ]) {
    const bytes = pe(machine);
    const file = "C:\\Program Files\\Git\\bin\\git.exe";
    const result = await observeWindowsGit(
      ["C:\\PROGRA~1\\Git\\bin\\git.exe"],
      {
        realpath: async () => file,
        readFile: async (actual) => {
          assert.equal(actual, file);
          return bytes;
        },
        version: async (actual) => {
          assert.equal(actual, file);
          return "git version 2.56.0.windows.2";
        },
      },
    );
    assert.deepEqual(result, {
      status: "available",
      candidates: [
        {
          path: file,
          architecture,
          version: "git version 2.56.0.windows.2",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    });
    bytes[100] ^= 1;
    const changed = await observeWindowsGit([file], {
      realpath: async () => file,
      readFile: async () => bytes,
      version: async () => "git version 2.56.0.windows.2",
    });
    assert.notEqual(changed.candidates[0].sha256, result.candidates[0].sha256);
  }
});

test("Git observation deduplicates canonical aliases but never chooses between distinct installations", async () => {
  let versions = 0;
  const io = {
    realpath: async (file) => file.replace("PROGRA~1", "Program Files"),
    readFile: async () => pe(0xaa64),
    version: async () => {
      versions++;
      return "git version 2.56.0.windows.2";
    },
  };
  const aliases = await observeWindowsGit(
    ["C:\\PROGRA~1\\Git\\bin\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe"],
    io,
  );
  assert.equal(aliases.status, "available");
  assert.equal(aliases.candidates.length, 1);
  assert.equal(versions, 1);
  const distinct = await observeWindowsGit(
    ["C:\\Program Files\\Git\\bin\\git.exe", "C:\\Other Git\\git.exe"],
    io,
  );
  assert.equal(distinct.status, "ambiguous");
  assert.equal(distinct.candidates.length, 2);
});

test("missing, malformed or excessive Git candidates cannot invent an executable or invoke a fallback", async () => {
  const untouched = {
    realpath: async () =>
      assert.fail("must not resolve an absent or invalid candidate"),
    readFile: async () =>
      assert.fail("must not read an absent or invalid candidate"),
    version: async () => assert.fail("must not execute a fallback"),
  };
  assert.deepEqual(await observeWindowsGit([], untouched), {
    status: "missing",
    candidates: [],
  });
  for (const candidates of [
    undefined,
    Array(9).fill("C:\\Git\\git.exe"),
    ["git.exe"],
    ["\\\\server\\Git\\git.exe"],
    ["C:\\Git\\git.exe\n"],
  ]) {
    assert.deepEqual(await observeWindowsGit(candidates, untouched), {
      status: "unavailable",
      candidates: [],
      reason: "invalid-candidates",
    });
  }
  let versions = 0;
  const invalidPe = await observeWindowsGit(["C:\\Git\\git.exe"], {
    realpath: async (file) => file,
    readFile: async () => Buffer.from("not a PE executable"),
    version: async () => {
      versions++;
      return "git version 1.0";
    },
  });
  assert.equal(invalidPe.status, "unavailable");
  assert.equal(versions, 0);
});

test("failed Git version commands retain only fixed bounded failure metadata", async () => {
  const result = await observeWindowsGit(["C:\\Git\\git.exe"], {
    realpath: async (file) => file,
    readFile: async () => pe(0x8664),
    version: async () => {
      throw {
        code: "ETIMEDOUT",
        killed: true,
        message: "private error",
        stdout: "private output",
      };
    },
  });
  assert.deepEqual(result, {
    status: "unavailable",
    candidates: [],
    failure: {
      stage: "windows-git",
      kind: "timeout",
      exitCode: null,
      signal: null,
    },
  });
});
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
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-hosted-inventory-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "python-tool");
  await writeFile(file, "synthetic tool bytes, never an executable");
  const pin = await inventoryFile(file, root);
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

test("inventory resolves aliased file names against a canonical tools root before reading", async () => {
  const root = path.resolve("canonical-tools");
  const resolved = path.join(root, "python-tool");
  const bytes = Buffer.from("synthetic tool");
  let reads = 0;
  const io = {
    realpath: async () => resolved,
    lstat: async (file) => {
      assert.equal(file, resolved);
      return { isFile: () => true, size: bytes.length };
    },
    createReadStream: async function* (file) {
      assert.equal(file, resolved);
      reads++;
      yield bytes;
    },
  };
  const pin = await inventoryFile(
    path.resolve("lexical-alias", "python-tool"),
    root,
    io,
  );
  assert.equal(pin.path, "python-tool");
  assert.equal(pin.sha256, createHash("sha256").update(bytes).digest("hex"));
  await assert.rejects(
    inventoryFile(resolved, root, {
      ...io,
      realpath: async () => path.resolve("outside-tools", "python-tool"),
    }),
    /escapes/,
  );
  assert.equal(
    reads,
    1,
    "a resolved escape must be rejected before reading bytes",
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
  assert.deepEqual(inputs.mode.options, [
    "build",
    "discover",
    "provision",
    "hosted-build",
    "acceptance",
  ]);
  assert.equal(inputs.discovery_cleanup_linux.default, false);
  const job = workflow.jobs.discover;
  assert.match(job.if, /mode == 'discover'/);
  assert.match(job.if, /visibility == 'public'/);
  assert.equal(job["timeout-minutes"], 15);
  assert.equal(job["runs-on"], "${{ matrix.runner }}");
  assert.deepEqual(
    hostedTargetMatrix("all").include.map(({ target, runner }) => ({
      target,
      runner,
    })),
    RECIPE.targets.map(({ target, runner }) => ({ target, runner })),
  );
  assert.equal(job.needs, "hosted-plan");
  assert.equal(
    job.strategy.matrix,
    "${{ fromJSON(needs.hosted-plan.outputs.matrix) }}",
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
    assert.match(workflow.jobs[name].if, /mode == 'build'/);
    assert.match(workflow.jobs[name].if, /default_branch/);
  }
});

function capacityFixture({
  freeGiB = 85,
  sizes = [30, 8, 10, 2],
  gains = {},
} = {}) {
  const present = new Set(RECIPE.linuxCleanupPaths);
  let bytes = freeGiB * 1024 ** 3;
  let now = 0;
  const calls = [],
    receipts = [];
  const io = {
    now: () => now,
    statfs: async () => ({ bavail: bytes, bsize: 1 }),
    realpath: async (p) => p,
    lstat: async (p) => {
      if (!present.has(p))
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isDirectory: () => true, isSymbolicLink: () => false };
    },
    writeFile: async (_, body) => receipts.push(JSON.parse(body)),
    command: async (exe, args, _, timeout) => {
      const candidate = args.at(-1),
        operation = args.includes("du") ? "du" : "rm";
      calls.push({ exe, args, timeout, operation, candidate });
      now += 100;
      if (operation === "du") {
        const value = sizes[RECIPE.linuxCleanupPaths.indexOf(candidate)];
        if (value === null)
          throw Object.assign(new Error("bounded inventory"), { code: 124 });
        return `${value * 1024 ** 3}\t${candidate}`;
      }
      bytes += (gains[candidate] ?? 0) * 1024 ** 3;
      present.delete(candidate);
      return "";
    },
  };
  return {
    io,
    calls,
    receipts,
    present,
    advance: (ms) => {
      now += ms;
    },
    addFree: (giB) => {
      bytes += giB * 1024 ** 3;
    },
  };
}
const capacityOptions = {
  temp: hosted.RUNNER_TEMP,
  destination: "/home/runner/work/_temp/cleanup",
  env: hosted,
  platform: "linux",
  checkout: "/home/runner/work/repo/repo",
};

test("capacity already sufficient touches no disposable directory or command", async () => {
  const f = capacityFixture({ freeGiB: 100 });
  f.io.lstat = async () => {
    throw new Error("must not inspect");
  };
  assert.deepEqual(await cleanupLinuxCapacity(capacityOptions, f.io), []);
  assert.equal(f.calls.length, 0);
  assert.equal(f.receipts.at(-1).sufficient, true);
  const missing = capacityFixture();
  missing.present.clear();
  let checks = 0;
  missing.io.statfs = async () => ({
    bavail: (++checks === 1 ? 85 : 100) * 1024 ** 3,
    bsize: 1,
  });
  assert.deepEqual(await cleanupLinuxCapacity(capacityOptions, missing.io), []);
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.receipts.at(-1).sufficient, true);
  await assert.rejects(
    cleanupLinuxCapacity({ ...capacityOptions, platform: "win32" }, f.io),
    /Linux/,
  );
});

test("measured smaller candidates reclaim enough capacity before expensive Android removal", async () => {
  const f = capacityFixture({
    gains: {
      "/opt/hostedtoolcache/CodeQL": 2,
      "/usr/share/dotnet": 8,
      "/opt/ghc": 10,
    },
  });
  const removed = await cleanupLinuxCapacity(capacityOptions, f.io);
  assert.deepEqual(removed, [
    "/opt/hostedtoolcache/CodeQL",
    "/usr/share/dotnet",
    "/opt/ghc",
  ]);
  assert(f.present.has("/usr/local/lib/android"));
  for (const call of f.calls) {
    assert.equal(call.exe, "sudo");
    assert.deepEqual(call.args.slice(0, 3), ["-n", "timeout", "--signal=TERM"]);
    assert(call.timeout <= 120000);
    assert.equal(call.args.at(-2), "--");
  }
  assert.equal(f.receipts.at(-1).freeDiskAfterGiB, 105);
  assert.equal(f.receipts.at(-1).sufficient, true);
});

test("unknown inventory runs last and timed-out partial removal is never called completed", async () => {
  const f = capacityFixture({ sizes: [null, 8, 10, 2] });
  const command = f.io.command;
  f.io.command = async (...args) => {
    if (args[1].includes("rm")) {
      f.calls.push({ operation: "rm", candidate: args[1].at(-1) });
      f.addFree(16);
      throw Object.assign(new Error("root-owned timeout exited"), {
        code: 124,
      });
    }
    return command(...args);
  };
  assert.deepEqual(await cleanupLinuxCapacity(capacityOptions, f.io), []);
  const receipt = f.receipts.at(-1);
  assert.equal(receipt.attempts[0].path, "/opt/hostedtoolcache/CodeQL");
  assert.equal(receipt.attempts[0].status, "partial-deadline");
  assert.equal(receipt.sufficient, true);
  assert.equal(receipt.freeDiskAfterGiB, 101);
  assert.equal(f.present.size, 4);
  const insufficient = capacityFixture({ sizes: [null, 8, 10, 2] });
  await assert.rejects(
    cleanupLinuxCapacity(capacityOptions, insufficient.io),
    /100 GiB/,
  );
  assert.deepEqual(
    insufficient.calls
      .filter((call) => call.operation === "rm")
      .map((call) => call.candidate),
    [
      "/opt/hostedtoolcache/CodeQL",
      "/usr/share/dotnet",
      "/opt/ghc",
      "/usr/local/lib/android",
    ],
  );
});

test("cleanup refuses symlink swaps before removal and never treats low final capacity as success", async () => {
  const f = capacityFixture();
  const lstat = f.io.lstat;
  let reads = 0;
  f.io.lstat = async (p) => {
    const value = await lstat(p);
    if (++reads > 4) return { ...value, isSymbolicLink: () => true };
    return value;
  };
  await assert.rejects(
    cleanupLinuxCapacity(capacityOptions, f.io),
    /ordinary allowlisted/,
  );
  assert.equal(f.calls.filter((call) => call.operation === "rm").length, 0);
  const low = capacityFixture();
  await assert.rejects(
    cleanupLinuxCapacity(capacityOptions, low.io),
    /Less than 100 GiB/,
  );
  assert.equal(low.receipts.at(-1).sufficient, false);
  const oneByteShort = capacityFixture({ freeGiB: 100 - 1 / 1024 ** 3 });
  await assert.rejects(
    cleanupLinuxCapacity(capacityOptions, oneByteShort.io),
    /100 GiB/,
  );
  assert.equal(oneByteShort.receipts.at(-1).freeDiskAfterGiB, 100);
  assert.equal(
    oneByteShort.receipts.at(-1).sufficient,
    false,
    "rounded display must not weaken the byte-level threshold",
  );
});

test("inventory and removals share the original480-second budget and outer termination fails closed", async () => {
  const f = capacityFixture();
  const command = f.io.command;
  f.io.command = async (...args) => {
    const result = await command(...args);
    f.advance(args[3] - 100 - 0.25);
    return result;
  };
  await assert.rejects(
    cleanupLinuxCapacity(capacityOptions, f.io),
    /100 GiB|budget/,
  );
  assert(f.receipts.at(-1).elapsedMs <= 480000);
  const removals = f.calls.filter((call) => call.operation === "rm");
  assert.equal(removals.at(-1).timeout, 80001);
  assert(f.calls.every((call) => Number.isInteger(call.timeout)));
  const killed = capacityFixture();
  killed.io.command = async () => {
    throw Object.assign(new Error("outer timeout"), {
      code: "ETIMEDOUT",
      killed: true,
      signal: "SIGTERM",
    });
  };
  await assert.rejects(
    cleanupLinuxCapacity(capacityOptions, killed.io),
    /outer timeout/,
  );
});
