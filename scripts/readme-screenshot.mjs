#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateReadmeScreenshot } from "./readme-screenshot-validation.mjs";

export const README_CAPTURE_IDENTIFIER = "com.sortofremote.ng.readme-capture";

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

function appDataBaseDirectory() {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  );
}

export function captureAppDataDirectory() {
  return path.resolve(appDataBaseDirectory(), README_CAPTURE_IDENTIFIER);
}

async function removeCaptureAppData() {
  const baseDirectory = path.resolve(appDataBaseDirectory());
  const appDataDirectory = captureAppDataDirectory();
  if (
    path.dirname(appDataDirectory) !== baseDirectory ||
    path.basename(appDataDirectory) !== README_CAPTURE_IDENTIFIER
  ) {
    throw new Error(
      `Refusing to remove unexpected app-data path: ${appDataDirectory}`,
    );
  }

  await rm(appDataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });
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

  await mkdir(artifactsDirectory, { recursive: true });
  await rm(seedFile, { force: true });
  await rm(captureWorkPath, { force: true });

  try {
    console.log("[readme-screenshot] checking current TypeScript gates");
    await runTypeScriptPreflight();

    console.log("[readme-screenshot] checking native capture prerequisites");
    const nativeDriverPath = await verifyCapturePrerequisites();

    console.log(
      "[readme-screenshot] building isolated native Tauri application",
    );
    await removeCaptureAppData();
    applicationPath = await buildCaptureApplication();

    console.log("[readme-screenshot] starting only the local test-ssh fixture");
    fixtureWasStarted = true;
    await startSshFixture();

    console.log("[readme-screenshot] seeding README Demo through the real app");
    await runCapturePhase("seed", applicationPath, nativeDriverPath);
    await terminateCaptureApp(applicationPath);
    await waitForPortToClose(
      "127.0.0.1",
      Number.parseInt(process.env.TAURI_DRIVER_PORT ?? "4444", 10),
      10_000,
    );
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
    await removeCaptureAppData();
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
