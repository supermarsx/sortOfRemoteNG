#!/usr/bin/env node
// Phase-one observations only. Never installs tools, builds CEF, or publishes pins.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  statfs,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
export const RECIPE = JSON.parse(
  await readFile(
    new URL("../native/cef-hosted-recipe.json", import.meta.url),
    "utf8",
  ),
);
const gib = (n) => Math.round((n / 1024 ** 3) * 100) / 100;
const fail = (message) => {
  throw new Error(message);
};
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return (
    rel === "" ||
    (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))
  );
};

export function selectTarget(
  target,
  platform = process.platform,
  architecture = process.arch,
) {
  const selected = RECIPE.targets.find((row) => row.target === target);
  if (!selected) fail("Unknown hosted CEF target");
  if (selected.platform !== platform || selected.architecture !== architecture)
    fail("Discovery requires the actual native target OS and architecture");
  return selected;
}

export function discoveryBlockers(
  {
    pythonVersion,
    visualStudioVersion,
    windowsSdk,
    debuggerVersion,
    macSdkVersion,
    availableGiB,
    memoryGiB,
    nativeProbeCompleted = true,
  },
  platform,
) {
  const blockers = [];
  if (
    !Array.isArray(pythonVersion) ||
    pythonVersion.length < 2 ||
    !pythonVersion.every(Number.isSafeInteger) ||
    pythonVersion[0] < 3 ||
    (pythonVersion[0] === 3 && pythonVersion[1] < RECIPE.minimumPython[1])
  )
    blockers.push("Python 3.12 or newer is required");
  if (platform === "win32" && nativeProbeCompleted) {
    if (
      Number.parseInt(visualStudioVersion, 10) <
        RECIPE.minimumWindowsVisualStudioMajor ||
      !/^\d+\./.test(visualStudioVersion ?? "")
    )
      blockers.push(
        "Visual Studio 2026 or newer with native desktop/ATL/MFC is required",
      );
    if (windowsSdk !== RECIPE.requiredWindowsSdk)
      blockers.push("The pinned Chromium Windows SDK is missing");
    const debuggerParts = /^(\d+)\.(\d+)\.(\d+)\.(\d+)/
      .exec(debuggerVersion ?? "")
      ?.slice(1)
      .map(Number);
    if (
      !debuggerParts ||
      debuggerParts.reduce(
        (order, value, index) =>
          order || Math.sign(value - RECIPE.minimumWindowsDebugger[index]),
        0,
      ) < 0
    )
      blockers.push(
        "The required Windows SDK debugging tools are missing or too old",
      );
  }
  if (
    platform === "darwin" &&
    (!/^\d+(?:\.\d+)*$/.test(macSdkVersion ?? "") ||
      Number.parseInt(macSdkVersion, 10) < RECIPE.minimumMacSdkMajor)
  )
    blockers.push("The pinned Chromium minimum macOS SDK is missing");
  if (
    !Number.isFinite(availableGiB) ||
    availableGiB < RECIPE.minimumFreeDiskGiB
  )
    blockers.push("Less than 100 GiB is available for the engine workspace");
  if (!Number.isFinite(memoryGiB) || memoryGiB < RECIPE.minimumMemoryGiB)
    blockers.push("Less than 8 GiB of RAM is available");
  return blockers;
}

export function assertCleanupTarget(
  candidate,
  {
    canonical = candidate,
    platform = process.platform,
    env = process.env,
    checkout = ROOT,
    temp = env.RUNNER_TEMP,
    symlink = false,
  } = {},
) {
  if (
    platform !== "linux" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY_VISIBILITY !== "public"
  )
    fail("Cleanup is limited to public GitHub-hosted Linux runners");
  if (
    !RECIPE.linuxCleanupPaths.includes(candidate) ||
    canonical !== candidate ||
    symlink
  )
    fail("Cleanup path is not an exact ordinary allowlisted directory");
  if (
    !temp ||
    [checkout, temp].some(
      (entry) =>
        inside(candidate, path.resolve(entry)) ||
        inside(path.resolve(entry), candidate),
    )
  )
    fail("Cleanup overlaps the checkout or runner workspace");
  return candidate;
}

export async function inventoryFile(
  file,
  toolsRoot,
  io = { realpath, lstat, createReadStream },
) {
  const resolved = await io.realpath(file);
  if (!inside(toolsRoot, resolved))
    fail("Discovered tool escapes the observed tools volume");
  const info = await io.lstat(resolved);
  if (!info.isFile() || info.size <= 0)
    fail("Discovered tool is not a nonempty regular file");
  const hash = createHash("sha256");
  for await (const bytes of io.createReadStream(resolved)) hash.update(bytes);
  return {
    path: path.relative(toolsRoot, resolved).split(path.sep).join("/"),
    size: info.size,
    sha256: hash.digest("hex"),
  };
}

async function command(exe, args, capture = exec, timeout = 30_000) {
  const { stdout } = await capture(exe, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 256 * 1024,
  });
  return stdout.trim();
}

export function peArchitecture(bytes) {
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) return null;
  const offset = bytes.readUInt32LE(0x3c);
  if (offset > bytes.length - 6 || bytes.readUInt32LE(offset) !== 0x00004550)
    return null;
  return (
    { 0x8664: "x64", 0xaa64: "arm64" }[bytes.readUInt16LE(offset + 4)] ?? null
  );
}

export async function nativeWindowsShell(
  env = process.env,
  architecture = process.arch,
  load = readFile,
) {
  // Fixed installation locations, not PATH lookup or caller-provided commands.
  const candidates = [
    path.win32.join(
      env.ProgramFiles ?? "C:\\Program Files",
      "PowerShell",
      "7",
      "pwsh.exe",
    ),
    path.win32.join(
      env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  ];
  for (const candidate of candidates) {
    const bytes = await load(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (bytes && peArchitecture(bytes) === architecture) return candidate;
  }
  const error = new Error(
    "No matching native PowerShell installation was observed",
  );
  error.code = "NATIVE_SHELL_UNAVAILABLE";
  throw error;
}

export function probeFailure(error, stage) {
  const kind =
    error?.code === "NATIVE_SHELL_UNAVAILABLE"
      ? "native-shell-unavailable"
      : error?.killed || error?.code === "ETIMEDOUT"
        ? "timeout"
        : error?.code === "ENOENT"
          ? "command-missing"
          : error instanceof SyntaxError
            ? "invalid-output"
            : "command-failed";
  return {
    stage,
    kind,
    exitCode: Number.isSafeInteger(error?.code) ? error.code : null,
    signal: ["SIGTERM", "SIGKILL"].includes(error?.signal)
      ? error.signal
      : null,
  };
}

// Fixed, reviewed discovery commands; no renderer/user text is executed.
const WINDOWS = String.raw`
$ErrorActionPreference='Stop'
$programFilesX86=[Environment]::GetFolderPath('ProgramFilesX86')
$vswhere=Join-Path $programFilesX86 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs=@(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Workload.NativeDesktop Microsoft.VisualStudio.Component.VC.ATLMFC -format json | ConvertFrom-Json)[0]
$files=@(); $missing=@(); $sdkVersion=$null; $compilerVersion=$null; $debuggerVersion=$null
if($vs){
  $vc=Get-ChildItem -LiteralPath (Join-Path $vs.installationPath 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  $arch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
  foreach($tail in @('include/vcruntime.h',"lib/$arch/libcmt.lib","atlmfc/lib/$arch/atls.lib")){ $p=Join-Path $vc.FullName $tail; if(Test-Path -LiteralPath $p -PathType Leaf){$files+=$p}else{$missing+=$tail} }
  $compiler=Join-Path $vc.FullName "bin/Host$arch/$arch/cl.exe"
  if(!(Test-Path -LiteralPath $compiler -PathType Leaf)){$compiler=Join-Path $vc.FullName "bin/Hostx64/$arch/cl.exe"}
  if(Test-Path -LiteralPath $compiler -PathType Leaf){$files+=$compiler;$compilerVersion=(Get-Item -LiteralPath $compiler).VersionInfo.FileVersion}else{$missing+='native cl.exe'}
}
$kits=Join-Path $programFilesX86 'Windows Kits/10'
if(Test-Path -LiteralPath (Join-Path $kits 'Include/10.0.28000.0/um/Windows.h')){$sdkVersion='10.0.28000.0'}
foreach($tail in @('Include/10.0.28000.0/um/Windows.h','Lib/10.0.28000.0/um/x64/kernel32.lib','Lib/10.0.28000.0/um/arm64/kernel32.lib','Debuggers/x64/dbghelp.dll')){ $p=Join-Path $kits $tail; if(Test-Path -LiteralPath $p -PathType Leaf){$files+=$p} }
$targetArch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
if(Test-Path -LiteralPath (Join-Path $kits 'Debuggers/x64/dbghelp.dll') -PathType Leaf){$debuggerVersion=(Get-Item -LiteralPath (Join-Path $kits 'Debuggers/x64/dbghelp.dll')).VersionInfo.FileVersion}
foreach($tail in @("Lib/10.0.28000.0/um/$targetArch/kernel32.lib",'Debuggers/x64/dbghelp.dll')){if(!(Test-Path -LiteralPath (Join-Path $kits $tail) -PathType Leaf)){$missing+=$tail}}
$sdkDirectories=@(); if(Test-Path -LiteralPath (Join-Path $kits 'Include')){ $sdkDirectories=@(Get-ChildItem -LiteralPath (Join-Path $kits 'Include') -Directory | Select-Object -ExpandProperty Name) }
@{visualStudioVersion=$vs.installationVersion;visualStudioPath=$vs.installationPath;compilerVersion=$compilerVersion;debuggerVersion=$debuggerVersion;windowsSdk=$sdkVersion;sdkDirectories=$sdkDirectories;files=$files;missing=$missing}|ConvertTo-Json -Depth 4 -Compress
`;

async function nativeTools(platform) {
  if (platform === "win32") {
    const shell = await nativeWindowsShell();
    const result = JSON.parse(
      await command(
        shell,
        ["-NoProfile", "-NonInteractive", "-Command", WINDOWS],
        exec,
        90_000,
      ),
    );
    return { ...result, shell, shellArchitecture: process.arch };
  }
  if (platform === "darwin") {
    const developer = await command("xcode-select", ["-p"]);
    const sdk = await command("xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
    const clang = await command("xcrun", ["--find", "clang"]);
    return {
      developer,
      sdk,
      xcodeVersion: await command("xcodebuild", ["-version"]),
      sdkVersion: await command("xcrun", [
        "--sdk",
        "macosx",
        "--show-sdk-version",
      ]),
      files: [
        clang,
        path.join(sdk, "SDKSettings.json"),
        path.join(sdk, "usr/lib/libSystem.tbd"),
      ],
    };
  }
  return {
    linkerVersion: await command("ld", ["--version"]),
    pkgConfigVersion: await command("pkg-config", ["--version"]),
    packages: await command("dpkg-query", [
      "-W",
      "-f=${Package} ${Version}\n",
      "libc6-dev",
      "pkg-config",
      "libglib2.0-dev",
      "libnss3-dev",
      "libx11-dev",
      "libxkbcommon-dev",
    ]).catch(
      () =>
        "Required package inventory incomplete; source-pinned build-dependency review still required",
    ),
    files: ["/usr/bin/ld", "/usr/bin/pkg-config", "/usr/include/stdio.h"],
  };
}

// The former four unconditional 120s deletions define the entire phase budget.
// GNU timeout runs privileged too: killing only Node's sudo child is insufficient.
export async function cleanupLinuxCapacity(
  { temp, destination, env, platform = process.platform, checkout = ROOT },
  io = {
    lstat,
    realpath,
    statfs,
    writeFile,
    command,
    now: () => performance.now(),
  },
) {
  const guards = { platform, env, checkout, temp };
  assertCleanupTarget(RECIPE.linuxCleanupPaths[0], guards);
  const began = io.now();
  const deadline = began + RECIPE.linuxCleanupPaths.length * 120_000;
  const required = RECIPE.minimumFreeDiskGiB * 1024 ** 3;
  const free = async () => {
    const disk = await io.statfs(temp);
    const bytes = disk.bavail * disk.bsize;
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      fail("Invalid cleanup capacity observation");
    return bytes;
  };
  const before = await free();
  const receipt = {
    reviewedAllowlist: RECIPE.linuxCleanupPaths,
    requiredFreeGiB: RECIPE.minimumFreeDiskGiB,
    freeDiskBeforeGiB: gib(before),
    freeDiskAfterGiB: gib(before),
    completed: [],
    attempts: [],
    inventory: [],
    pending: null,
    elapsedMs: 0,
    sufficient: before >= required,
  };
  const save = async () => {
    receipt.elapsedMs = Math.max(0, io.now() - began);
    await io.writeFile(
      path.join(destination, "cleanup.json"),
      JSON.stringify(receipt, null, 2),
    );
  };
  await save();
  if (receipt.sufficient) return receipt.completed;
  const validate = async (candidate) => {
    const info = await io.lstat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return false;
    assertCleanupTarget(candidate, {
      ...guards,
      canonical: await io.realpath(candidate),
      symlink: info.isSymbolicLink(),
    });
    if (!info.isDirectory()) fail("Cleanup candidate is not a directory");
    return true;
  };
  const timed = async (candidate, operation, budget) => {
    const outer = Math.floor(Math.min(budget, deadline - io.now()));
    if (outer < 3_000) fail("Cleanup phase budget exhausted");
    const margin = operation === "du" ? 2_000 : 10_000;
    if (outer <= margin) fail("Cleanup phase budget exhausted");
    return io.command(
      "sudo",
      [
        "-n",
        "timeout",
        "--signal=TERM",
        `--kill-after=${operation === "du" ? 1 : 5}s`,
        `${(outer - margin) / 1000}s`,
        ...(operation === "du"
          ? ["du", "-sx", "--block-size=1"]
          : ["rm", "-rf"]),
        "--",
        candidate,
      ],
      undefined,
      outer,
    );
  };
  for (const candidate of RECIPE.linuxCleanupPaths) {
    if (!(await validate(candidate))) continue;
    const row = { path: candidate, bytes: null, status: "unknown" };
    receipt.inventory.push(row);
    receipt.pending = candidate;
    await save();
    try {
      const result = await timed(candidate, "du", 10_000);
      const value = /^(\d+)(?:\s|$)/.exec(result);
      const size = value ? Number(value[1]) : NaN;
      if (Number.isSafeInteger(size) && size >= 0) {
        row.bytes = size;
        row.status = "measured";
      }
    } catch (error) {
      // Only an exited GNU timeout is a known bounded partial result. An outer
      // timeout/signal cannot prove the privileged subtree stopped: abort.
      if (error.killed || error.signal) {
        row.status = "outer-timeout";
        await save();
        throw error;
      }
      row.status = [124, 137].includes(error.code) ? "deadline" : "unavailable";
    }
    receipt.pending = null;
    await save();
  }
  // Smaller known directories finish first; expensive/unknown inventories last.
  const candidates = [...receipt.inventory].sort(
    (a, b) =>
      (a.bytes === null) - (b.bytes === null) ||
      (a.bytes ?? 0) - (b.bytes ?? 0),
  );
  for (const candidate of candidates) {
    const available = await free();
    receipt.freeDiskAfterGiB = gib(available);
    receipt.sufficient = available >= required;
    if (receipt.sufficient) break;
    if (!(await validate(candidate.path))) continue;
    const attempt = {
      path: candidate.path,
      status: "pending",
      freeBeforeGiB: gib(available),
      freeAfterGiB: gib(available),
      elapsedMs: 0,
    };
    receipt.attempts.push(attempt);
    receipt.pending = candidate.path;
    await save();
    const started = io.now();
    let progress = Promise.resolve();
    let progressError;
    const timer = setInterval(() => {
      progress = progress
        .then(async () => {
          receipt.freeDiskAfterGiB = gib(await free());
          attempt.elapsedMs = Math.max(0, io.now() - started);
          await save();
        })
        .catch((error) => {
          progressError = error;
        });
    }, 10_000);
    try {
      try {
        await timed(candidate.path, "rm", 120_000);
      } finally {
        clearInterval(timer);
        await progress;
      }
      if (progressError) throw progressError;
      // A successful rm is still not a completed directory if it reappeared.
      if (await validate(candidate.path)) attempt.status = "still-present";
      else {
        attempt.status = "removed";
        receipt.completed.push(candidate.path);
      }
    } catch (error) {
      attempt.status =
        [124, 137].includes(error.code) && !error.killed && !error.signal
          ? "partial-deadline"
          : "failed";
      attempt.elapsedMs = Math.max(0, io.now() - started);
      attempt.freeAfterGiB = receipt.freeDiskAfterGiB = gib(await free());
      await save();
      if (attempt.status === "failed") throw error;
    }
    attempt.elapsedMs = Math.max(0, io.now() - started);
    const after = await free();
    attempt.freeAfterGiB = receipt.freeDiskAfterGiB = gib(after);
    receipt.sufficient = after >= required;
    receipt.pending = null;
    await save();
    if (receipt.sufficient) break;
  }
  receipt.pending = null;
  const finalAvailable = await free();
  receipt.freeDiskAfterGiB = gib(finalAvailable);
  receipt.sufficient = finalAvailable >= required;
  await save();
  if (!receipt.sufficient)
    fail("Less than 100 GiB is available after bounded allowlisted cleanup");
  return receipt.completed;
}

export async function observe(
  { target, output, cleanup = false },
  env = process.env,
) {
  const selected = selectTarget(target);
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY_VISIBILITY !== "public"
  )
    fail("Discovery requires a public standard GitHub-hosted runner");
  if (!output || !env.RUNNER_TEMP)
    fail("An explicit output directory and runner workspace are required");
  const temp = await realpath(env.RUNNER_TEMP);
  const destination = path.resolve(output);
  if (!inside(temp, destination) || destination === temp)
    fail("Discovery output must be beneath the runner workspace");
  await mkdir(destination, { recursive: true });
  if (!inside(temp, await realpath(destination)))
    fail("Discovery output resolves outside the runner workspace");
  const diskBefore = await statfs(temp);
  const cleaned = cleanup
    ? await cleanupLinuxCapacity({ temp, destination, env })
    : [];
  const python = await command(
    process.platform === "win32" ? "python" : "python3",
    [
      "-I",
      "-c",
      "import json,sys; print(json.dumps({'path':sys.executable,'version':list(sys.version_info[:3])}))",
    ],
  )
    .then(JSON.parse)
    .catch(() => ({ path: null, version: null }));
  const native = await nativeTools(process.platform).catch((error) => ({
    files: [],
    probeFailed: true,
    failure: probeFailure(
      error,
      process.platform === "win32" ? "windows-native-tools" : "native-tools",
    ),
  }));
  const toolsRoot = path.parse(
    await realpath(python.path ?? process.execPath),
  ).root;
  const files = [];
  const errors = [];
  for (const file of [
    ...new Set([python.path, ...(native.files ?? [])].filter(Boolean)),
  ]) {
    try {
      files.push(await inventoryFile(file, toolsRoot));
    } catch {
      errors.push(`Required tool inventory failed: ${path.basename(file)}`);
    }
  }
  const disk = await statfs(temp);
  const facts = {
    pythonVersion: python.version,
    visualStudioVersion: native.visualStudioVersion,
    windowsSdk: native.windowsSdk,
    debuggerVersion: native.debuggerVersion,
    macSdkVersion: native.sdkVersion,
    availableGiB: gib(disk.bavail * disk.bsize),
    memoryGiB: gib(os.totalmem()),
    nativeProbeCompleted: native.probeFailed !== true,
  };
  const blockers = [...discoveryBlockers(facts, process.platform), ...errors];
  if (native.probeFailed)
    blockers.push("Native tool discovery did not complete");
  if (native.missing?.length)
    blockers.push(
      "Required native compiler, ATL/MFC, or SDK files are missing",
    );
  if (
    process.platform === "linux" &&
    native.packages?.startsWith("Required package inventory incomplete")
  )
    blockers.push("Required Linux build-dependency inventory is incomplete");
  const receipt = {
    schemaVersion: 1,
    kind: "sorng-cef-hosted-discovery",
    reviewStatus: "unreviewed-observations",
    engineBuildAttempted: false,
    publicationAllowed: false,
    target,
    runner: selected.runner,
    platform: process.platform,
    architecture: process.arch,
    image: { os: env.ImageOS ?? null, version: env.ImageVersion ?? null },
    observedAt: new Date().toISOString(),
    cpuCount: os.availableParallelism(),
    ...facts,
    freeDiskBeforeGiB: gib(diskBefore.bavail * diskBefore.bsize),
    cleaned,
    native,
    toolsRoot,
    files,
    blockers,
    note: "Actual observations, not reviewed pins or native engine acceptance. Discovery cannot authorize a build. SDK installation and cross-compilation require separate review.",
  };
  await writeFile(
    path.join(destination, "observation.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(
    path.join(destination, "toolchain-candidate.json"),
    `${JSON.stringify({ schemaVersion: 1, kind: "sorng-cef-toolchain-candidate", reviewStatus: "unreviewed-observations", target, files }, null, 2)}\n`,
    { flag: "wx" },
  );
  if (env.GITHUB_OUTPUT)
    await appendFile(env.GITHUB_OUTPUT, `observations=${destination}\n`);
  return receipt;
}

export async function main(args = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--target", "--output", "--cleanup"].includes(key) || key in flags)
      fail("Unknown or duplicate discovery argument");
    flags[key] = key === "--cleanup" ? true : args[++i];
  }
  return observe({
    target: flags["--target"],
    output: flags["--output"],
    cleanup: flags["--cleanup"],
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
