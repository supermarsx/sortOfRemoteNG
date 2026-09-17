#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import nodeFs from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ALLOW_RUNNING_PRODUCTION_ENV,
  E2E_RUN_DIR_ENV,
  E2E_RUN_ID_ENV,
  E2E_WEBVIEW2_DIR_ENV,
  E2eIsolationRefusal,
  KEEP_RUN_DIR_ENV,
  README_CAPTURE_IDENTIFIER,
  RUN_LOCK_TOKEN_ENV,
  acquireRunLock,
  assertIsolatedBinary,
  checkWebView2PolicyOverride,
  cleanupIsolatedAutostart,
  cleanupIsolatedKeychain,
  createRunDir,
  defaultExec,
  inspectRunningProcesses,
  releaseRunLock,
  resolveRunProfile,
  runProfileProbe,
  wipeIsolatedProfile,
  wipeRunDir,
} from "./lib/e2e-profile-isolation.mjs";
import { validateReadmeScreenshot } from "./readme-screenshot-validation.mjs";

export { README_CAPTURE_IDENTIFIER };

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const artifactsDirectory = path.join(
  rootDirectory,
  ".artifacts",
  "readme-screenshot",
);
const cargoTargetDirectory = path.join(artifactsDirectory, "cargo-target");
const seedFile = path.join(artifactsDirectory, "seed.json");
const captureWorkPath = path.join(artifactsDirectory, "readme-screenshot.png");
const outputPath = path.join(
  rootDirectory,
  "docs",
  "assets",
  "readme-screenshot.png",
);
const composeFile = path.join(rootDirectory, "e2e", "docker-compose.yml");
const composeOverrideFile = path.join(
  rootDirectory,
  "e2e",
  "docker-compose.readme-screenshot.yml",
);
const composeEnvFile = path.join(rootDirectory, "e2e", ".env");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDirectory,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
      shell: false,
    });

    child.once("error", (error) => {
      reject(
        new Error(
          `Unable to start ${command}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${String(code)}`
          }`,
        ),
      );
    });
  });
}

async function runIgnoringFailure(command, args) {
  try {
    await run(command, args, { stdio: "ignore" });
  } catch {
    // Cleanup is idempotent: a missing process or container is already clean.
  }
}

/**
 * @typedef {object} CaptureIsolation
 * @property {string} identifier
 * @property {import("./lib/e2e-profile-isolation.mjs").EnvRecord} env
 * @property {import("./lib/e2e-profile-isolation.mjs").VerifiedBinary} verifiedBinary
 * @property {import("./lib/e2e-profile-isolation.mjs").RunProfile} runProfile
 * @property {import("./lib/e2e-profile-isolation.mjs").RunLock | null} lock
 * @property {import("./lib/e2e-profile-isolation.mjs").ProfileProbe | null} probe
 */

/** Run variables both capture phases inherit so they share one isolated run. */
export const CAPTURE_RUN_ENV_KEYS = Object.freeze([
  E2E_RUN_ID_ENV,
  E2E_RUN_DIR_ENV,
  E2E_WEBVIEW2_DIR_ENV,
  RUN_LOCK_TOKEN_ENV,
]);

/**
 * Proves the capture binary's isolated identity and prepares the one run both
 * WDIO phases share (`wipe: "none"` in `e2e/wdio.readme-screenshot.conf.ts`).
 *
 * The run id, run dir and WebView2 folder are pinned into `env` (the phases
 * inherit it), and the run lock is taken here and handed to both phases through
 * `SORNG_E2E_RUN_LOCK_TOKEN`. Before the seed phase the probe-asserted capture
 * roots (Roaming and LocalData), the capture keychain namespace and its
 * autostart value are wiped, so the seed starts from an empty profile and no
 * identifier-default EBWebView folder. Never touches the production profile.
 * @param {{
 *   applicationPath: string,
 *   env?: import("./lib/e2e-profile-isolation.mjs").EnvRecord,
 *   repoRoot?: string,
 *   platform?: NodeJS.Platform,
 *   fs?: typeof nodeFs,
 *   exec?: import("./lib/e2e-profile-isolation.mjs").Exec,
 *   spawnSync?: import("./lib/e2e-profile-isolation.mjs").SpawnSyncLike,
 *   lockDir?: string,
 *   tmpDir?: string,
 *   isAlive?: (pid: number) => boolean,
 *   selfPid?: number,
 *   log?: import("./lib/e2e-profile-isolation.mjs").Logger,
 * }} options
 * @returns {Promise<CaptureIsolation>}
 */
export async function prepareCaptureIsolation({
  applicationPath,
  env = process.env,
  repoRoot = rootDirectory,
  platform = process.platform,
  fs = nodeFs,
  exec = defaultExec,
  spawnSync,
  lockDir,
  tmpDir,
  isAlive,
  selfPid = process.pid,
  log = console,
}) {
  const identifier = README_CAPTURE_IDENTIFIER;
  const verifiedBinary = await assertIsolatedBinary({
    binary: applicationPath,
    expectedIdentifier: identifier,
    repoRoot,
    platform,
    fs,
  });
  checkWebView2PolicyOverride({
    binary: verifiedBinary.binary,
    platform,
    exec,
  });
  const processes = inspectRunningProcesses(verifiedBinary.binary, {
    platform,
    exec,
    selfPid,
  });
  const describe = (entries) =>
    entries
      .map(({ pid, name, reason }) => `pid ${pid} ${name}: ${reason}`)
      .join("; ");
  if (processes.sameBinary.length > 0) {
    throw new E2eIsolationRefusal(
      "E2E_BINARY_RUNNING",
      describe(processes.sameBinary),
    );
  }
  if (
    processes.production.length > 0 &&
    env[ALLOW_RUNNING_PRODUCTION_ENV] !== "1"
  ) {
    throw new E2eIsolationRefusal(
      "PRODUCTION_PROCESS_RUNNING",
      describe(processes.production),
    );
  }

  for (const key of CAPTURE_RUN_ENV_KEYS) {
    delete env[key];
  }
  /** @type {CaptureIsolation} */
  const state = {
    identifier,
    env,
    verifiedBinary,
    runProfile: resolveRunProfile({ env, identifier, platform, tmpDir }),
    lock: null,
    probe: null,
  };
  try {
    state.lock = acquireRunLock(identifier, {
      runId: state.runProfile.runId,
      lockDir,
      env,
      pid: selfPid,
      isAlive,
      fs,
      log,
    });
    env[RUN_LOCK_TOKEN_ENV] = state.lock.token;
    createRunDir(state.runProfile, { platform, fs });
    state.probe = runProfileProbe({
      verifiedBinary,
      expectedIdentifier: identifier,
      runProfile: state.runProfile,
      env,
      spawnSync,
      tmpDir,
      platform,
      fs,
    });
    wipeIsolatedProfile(state.probe, { platform, fs });
    cleanupIsolatedKeychain(identifier, { platform, exec, log });
    cleanupIsolatedAutostart(state.probe.autostartName, {
      expectedIdentifier: identifier,
      platform,
      exec,
      log,
    });
  } catch (error) {
    cleanupCaptureIsolation(state, { platform, fs, exec, log });
    throw error;
  }
  return state;
}

/**
 * Removes the capture run: the probe-asserted capture roots, keychain entries
 * and autostart value, the marker-verified run dir (unless
 * `SORNG_E2E_KEEP_RUN_DIR=1`), the lock and the pinned run variables. Returns
 * the failures instead of throwing so every step is attempted.
 * @param {CaptureIsolation} state
 * @param {{
 *   platform?: NodeJS.Platform,
 *   fs?: typeof nodeFs,
 *   exec?: import("./lib/e2e-profile-isolation.mjs").Exec,
 *   log?: import("./lib/e2e-profile-isolation.mjs").Logger,
 * }} [options]
 * @returns {string[]}
 */
export function cleanupCaptureIsolation(
  state,
  {
    platform = process.platform,
    fs = nodeFs,
    exec = defaultExec,
    log = console,
  } = {},
) {
  const errors = [];
  const attempt = (label, action) => {
    try {
      action();
    } catch (error) {
      errors.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  if (state.probe) {
    attempt("capture profile", () =>
      wipeIsolatedProfile(state.probe, { platform, fs }),
    );
    attempt("capture keychain", () =>
      cleanupIsolatedKeychain(state.identifier, { platform, exec, log }),
    );
    attempt("capture autostart", () =>
      cleanupIsolatedAutostart(state.probe.autostartName, {
        expectedIdentifier: state.identifier,
        platform,
        exec,
        log,
      }),
    );
  }
  if (state.lock && state.env[KEEP_RUN_DIR_ENV] !== "1") {
    attempt("run dir", () =>
      wipeRunDir(state.runProfile.runDir, {
        runRoot: state.runProfile.runRoot,
        platform,
        fs,
      }),
    );
  }
  if (state.lock) {
    attempt("run lock", () => releaseRunLock(state.lock, { fs }));
  }
  for (const key of CAPTURE_RUN_ENV_KEYS) {
    delete state.env[key];
  }
  return errors;
}

async function waitForPort(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for ${host}:${port} after ${timeoutMs}ms`,
          ),
        );
        return;
      }

      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 500);
      });
    };

    tryConnect();
  });
}

async function waitForPortToClose(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for ${host}:${port} to close after ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(probe, 250);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve();
      });
    };

    probe();
  });
}

/**
 * Pins the tauri-driver ports for both capture phases.
 *
 * `e2e/helpers/driver-ports.ts` otherwise allocates a fresh pair per WDIO run,
 * which would make the seed and capture phases use different ports and leave
 * the `waitForPortToClose` handshake between them watching the wrong port.
 * Allocating a free pair here keeps that handshake honest while still letting
 * this script run alongside a normal E2E run.
 */
export async function pinDriverPorts() {
  const servers = await Promise.all(
    [0, 0].map(
      (port) =>
        new Promise((resolve, reject) => {
          const server = net.createServer();
          server.once("error", reject);
          server.listen(port, "127.0.0.1", () => {
            resolve(server);
          });
        }),
    ),
  );

  const [driverPort, nativePort] = servers.map(
    (server) => server.address().port,
  );

  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );

  process.env.TAURI_DRIVER_PORT ??= String(driverPort);
  process.env.TAURI_NATIVE_DRIVER_PORT ??= String(nativePort);

  return Number.parseInt(process.env.TAURI_DRIVER_PORT, 10);
}

function dockerComposeArgs(args) {
  return [
    "compose",
    "-f",
    composeFile,
    "-f",
    composeOverrideFile,
    "--env-file",
    composeEnvFile,
    ...args,
  ];
}

export function assertLoopbackOnlySshFixturePorts(composeConfig) {
  const ports = composeConfig?.services?.["test-ssh"]?.ports;
  const binding = Array.isArray(ports) && ports.length === 1 ? ports[0] : null;
  const isExpectedBinding =
    binding?.host_ip === "127.0.0.1" &&
    Number(binding.target) === 2222 &&
    Number(binding.published) === 2222 &&
    binding.protocol === "tcp";

  if (!isExpectedBinding) {
    throw new Error(
      "README SSH fixture must publish exactly 127.0.0.1:2222:2222/tcp; " +
        `received ${JSON.stringify(ports ?? null)}`,
    );
  }
}

function verifySshFixturePortBinding() {
  const output = execFileSync(
    "docker",
    dockerComposeArgs(["config", "--format", "json"]),
    {
      cwd: rootDirectory,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  assertLoopbackOnlySshFixturePorts(JSON.parse(output));
}

async function startSshFixture() {
  await run("docker", dockerComposeArgs(["up", "-d", "test-ssh"]));
  await waitForPort("127.0.0.1", 2222, 60_000);
}

async function stopSshFixture() {
  await runIgnoringFailure(
    "docker",
    dockerComposeArgs(["rm", "-sf", "test-ssh"]),
  );
}

async function terminateCaptureApp(applicationPath) {
  if (!applicationPath) {
    return;
  }

  if (process.platform === "win32") {
    const escapedPath = path.resolve(applicationPath).replaceAll("'", "''");
    const script = [
      `$target = [IO.Path]::GetFullPath('${escapedPath}')`,
      "Get-CimInstance Win32_Process |",
      "Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target } |",
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ].join(" ");
    await runIgnoringFailure("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return;
  }

  await runIgnoringFailure("pkill", ["-f", path.resolve(applicationPath)]);
}

async function installedWebViewVersion() {
  if (process.platform !== "win32") {
    return null;
  }

  const programFilesRoots = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
  ].filter(Boolean);
  const versions = [];
  for (const programFilesRoot of programFilesRoots) {
    const applicationRoot = path.join(
      programFilesRoot,
      "Microsoft",
      "EdgeWebView",
      "Application",
    );
    const entries = await readdir(applicationRoot, {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name)) {
        versions.push(entry.name);
      }
    }
  }

  versions.sort((left, right) => {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    for (let index = 0; index < 4; index += 1) {
      if (leftParts[index] !== rightParts[index]) {
        return rightParts[index] - leftParts[index];
      }
    }
    return 0;
  });
  return versions[0] ?? null;
}

async function resolveNativeDriverPath() {
  const override = process.env.TAURI_NATIVE_DRIVER_PATH?.trim();
  if (override) {
    const metadata = await stat(override).catch(() => null);
    if (!metadata?.isFile()) {
      throw new Error(
        `TAURI_NATIVE_DRIVER_PATH does not point to a file: ${override}`,
      );
    }
    return path.resolve(override);
  }

  if (process.platform !== "win32") {
    return null;
  }

  const webViewVersion = await installedWebViewVersion();
  if (!webViewVersion) {
    throw new Error("Unable to resolve the installed WebView2 version");
  }

  const localDriver = path.join(
    rootDirectory,
    ".wdio-drivers",
    webViewVersion,
    "msedgedriver.exe",
  );
  const metadata = await stat(localDriver).catch(() => null);
  if (!metadata?.isFile()) {
    throw new Error(
      `A matching EdgeDriver ${webViewVersion} is required at ${localDriver}`,
    );
  }

  return localDriver;
}

async function verifyCapturePrerequisites() {
  await run("docker", ["info"], { stdio: "ignore" });
  verifySshFixturePortBinding();
  await run("tauri-driver", ["--help"], { stdio: "ignore" });

  const nativeDriverPath = await resolveNativeDriverPath();
  if (nativeDriverPath) {
    await run(nativeDriverPath, ["--version"]);
  }
  return nativeDriverPath;
}

async function findBuiltBinary() {
  const names =
    process.platform === "win32"
      ? ["app.exe", "sortOfRemoteNG.exe"]
      : ["app", "sortOfRemoteNG"];
  const candidates = [];

  for (const name of names) {
    candidates.push(path.join(cargoTargetDirectory, "debug", name));
  }

  const targetEntries = await readdir(cargoTargetDirectory, {
    withFileTypes: true,
  }).catch(() => []);
  for (const entry of targetEntries) {
    if (!entry.isDirectory() || entry.name === "debug") {
      continue;
    }

    for (const name of names) {
      candidates.push(
        path.join(cargoTargetDirectory, entry.name, "debug", name),
      );
    }
  }

  for (const candidate of candidates) {
    const metadata = await stat(candidate).catch(() => null);
    if (metadata?.isFile()) {
      return candidate;
    }
  }

  throw new Error(
    `Tauri build completed without a capture application under ${cargoTargetDirectory}`,
  );
}

async function runTypeScriptPreflight() {
  const tsc = path.join(
    rootDirectory,
    "node_modules",
    "typescript",
    "bin",
    "tsc",
  );
  await run(process.execPath, [tsc, "--noEmit", "--pretty", "false"]);
  await run(process.execPath, [
    tsc,
    "--project",
    "e2e/tsconfig.readme-screenshot.json",
    "--noEmit",
    "--pretty",
    "false",
  ]);
}

async function buildCaptureApplication() {
  const nativeBuildEnvironment = path.join(
    rootDirectory,
    "scripts",
    "native-build-env.mjs",
  );
  const tauriCli = path.join(
    rootDirectory,
    "node_modules",
    "@tauri-apps",
    "cli",
    "tauri.js",
  );
  await run(
    process.execPath,
    [
      nativeBuildEnvironment,
      process.execPath,
      tauriCli,
      "build",
      "--debug",
      "--no-bundle",
      "--config",
      "src-tauri/tauri.readme-screenshot.conf.json",
    ],
    {
      env: {
        ...process.env,
        CARGO_TARGET_DIR: cargoTargetDirectory,
      },
    },
  );

  return findBuiltBinary();
}

async function runCapturePhase(
  phase,
  applicationPath,
  nativeDriverPath,
  extraEnvironment = {},
) {
  const wdioCli = path.join(
    rootDirectory,
    "node_modules",
    "@wdio",
    "cli",
    "bin",
    "wdio.js",
  );
  await run(
    process.execPath,
    [wdioCli, "run", "e2e/wdio.readme-screenshot.conf.ts"],
    {
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--force-device-scale-factor=1",
        MSEDGEDRIVER_TELEMETRY_OPTOUT: "1",
        ...(nativeDriverPath
          ? { TAURI_NATIVE_DRIVER_PATH: nativeDriverPath }
          : {}),
        README_CAPTURE_PHASE: phase,
        README_CAPTURE_BINARY: applicationPath,
        README_CAPTURE_SEED_FILE: seedFile,
        README_CAPTURE_OUTPUT: captureWorkPath,
        ...extraEnvironment,
      },
    },
  );
}

async function readSeed() {
  const seed = JSON.parse(await readFile(seedFile, "utf8"));
  if (
    typeof seed.collectionId !== "string" ||
    seed.collectionId.length === 0 ||
    typeof seed.connectionId !== "string" ||
    seed.connectionId.length === 0
  ) {
    throw new Error(`Invalid README seed manifest: ${seedFile}`);
  }

  return seed;
}

async function main() {
  let fixtureWasStarted = false;
  let applicationPath = null;
  let isolation = null;

  await mkdir(artifactsDirectory, { recursive: true });
  await rm(seedFile, { force: true });
  await rm(captureWorkPath, { force: true });

  try {
    console.log("[readme-screenshot] checking current TypeScript gates");
    await runTypeScriptPreflight();

    console.log("[readme-screenshot] checking native capture prerequisites");
    const nativeDriverPath = await verifyCapturePrerequisites();
    const driverPort = await pinDriverPorts();
    console.log(`[readme-screenshot] using tauri-driver port ${driverPort}`);

    console.log(
      "[readme-screenshot] building isolated native Tauri application",
    );
    applicationPath = await buildCaptureApplication();

    console.log(
      "[readme-screenshot] proving the capture identity and wiping its isolated profile",
    );
    isolation = await prepareCaptureIsolation({ applicationPath });
    console.log(
      `[readme-screenshot] capture run ${isolation.runProfile.runId} (${isolation.runProfile.runDir})`,
    );

    console.log("[readme-screenshot] starting only the local test-ssh fixture");
    fixtureWasStarted = true;
    await startSshFixture();

    console.log("[readme-screenshot] seeding README Demo through the real app");
    await runCapturePhase("seed", applicationPath, nativeDriverPath);
    await terminateCaptureApp(applicationPath);
    await waitForPortToClose("127.0.0.1", driverPort, 10_000);
    const seed = await readSeed();

    console.log("[readme-screenshot] relaunching directly into Prototype SSH");
    const captureStartedAt = Date.now();
    await runCapturePhase("capture", applicationPath, nativeDriverPath, {
      README_COLLECTION_ID: seed.collectionId,
      README_CONNECTION_ID: seed.connectionId,
    });

    const validation = await validateReadmeScreenshot({
      filePath: captureWorkPath,
      freshSinceMs: captureStartedAt,
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(captureWorkPath, outputPath);
    await validateReadmeScreenshot({
      filePath: outputPath,
      freshSinceMs: captureStartedAt,
    });
    console.log(
      `[readme-screenshot] captured ${validation.width}x${validation.height} native app screenshot: ${validation.filePath}`,
    );
  } finally {
    await terminateCaptureApp(applicationPath);
    if (fixtureWasStarted) {
      await stopSshFixture();
    }
    if (isolation) {
      for (const error of cleanupCaptureIsolation(isolation)) {
        console.error(`[readme-screenshot] cleanup ${error}`);
        process.exitCode = 1;
      }
    }
    await rm(seedFile, { force: true });
    await rm(captureWorkPath, { force: true });
  }
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
