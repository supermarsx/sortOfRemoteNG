#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(
  repoRoot,
  "src-tauri",
  "crates",
  "sorng-opkssh-vendor",
  "Cargo.toml",
);
const bundleRoot = path.join(
  repoRoot,
  "src-tauri",
  "crates",
  "sorng-opkssh-vendor",
  "bundle",
  "opkssh",
);
const targetNames = new Set(["sorng-opkssh-vendor", "sorng_opkssh_vendor"]);
const userArgs = process.argv.slice(2);
const bundleGateEnv = "SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE";
const goBinaryEnv = "SORNG_OPKSSH_VENDOR_GO";

function candidateGoBinaries() {
  const candidates = [];

  if (process.env[goBinaryEnv]) {
    candidates.push(process.env[goBinaryEnv]);
  }

  if (process.platform === "win32") {
    candidates.push(
      "C:/Users/Mariana/scoop/apps/go/current/bin/go.exe",
      "C:/Users/Mariana/scoop/shims/go.exe",
    );
  }

  return candidates.filter(Boolean);
}

function resolveGoBinary() {
  for (const candidate of candidateGoBinaries()) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(repoRoot, candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

function pathEnvKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function cargoBuildEnv() {
  const env = { ...process.env };
  const goBinary = resolveGoBinary();
  if (!goBinary) {
    return env;
  }

  const goDir = path.dirname(goBinary);
  const pathKey = pathEnvKey(env);
  const currentPath = env[pathKey] || "";
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean);
  if (!pathEntries.includes(goDir)) {
    env[pathKey] = [goDir, ...pathEntries].join(path.delimiter);
  }
  env[goBinaryEnv] = goBinary;
  return env;
}

function hasFlag(flag) {
  return userArgs.includes(flag);
}

function cargoUserArgs() {
  return userArgs.filter((arg) => arg !== "--enable" && arg !== "--disable");
}

function readArgValue(flag) {
  const index = userArgs.indexOf(flag);
  if (index === -1 || index === userArgs.length - 1) {
    return null;
  }

  return userArgs[index + 1];
}

function hostTargetSpec() {
  let osKey;
  if (process.platform === "win32") {
    osKey = "windows";
  } else if (process.platform === "darwin") {
    osKey = "macos";
  } else if (process.platform === "linux") {
    osKey = "linux";
  }

  let archKey;
  if (process.arch === "arm64") {
    archKey = "arm64";
  } else if (process.arch === "x64") {
    archKey = "amd64";
  }

  if (!osKey || !archKey) {
    throw new Error(
      `Unsupported OPKSSH vendor host platform: ${process.platform}-${process.arch}`,
    );
  }

  return { triple: null, osKey, archKey };
}

function normalizeTargetSpec(targetTriple) {
  if (!targetTriple) {
    return hostTargetSpec();
  }

  const triple = targetTriple.toLowerCase();
  let osKey;
  if (triple.includes("windows")) {
    osKey = "windows";
  } else if (triple.includes("darwin") || triple.includes("apple")) {
    osKey = "macos";
  } else if (triple.includes("linux")) {
    osKey = "linux";
  }

  let archKey;
  if (triple.startsWith("aarch64") || triple.startsWith("arm64")) {
    archKey = "arm64";
  } else if (triple.startsWith("x86_64") || triple.startsWith("amd64")) {
    archKey = "amd64";
  }

  if (!osKey || !archKey) {
    throw new Error(`Unsupported OPKSSH vendor target triple: ${targetTriple}`);
  }

  return { triple: targetTriple, osKey, archKey };
}

function inferTargetTriple() {
  return (
    readArgValue("--target") ||
    process.env.CARGO_BUILD_TARGET ||
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.TARGET ||
    null
  );
}

function artifactNameFor(osKey) {
  if (osKey === "windows") {
    return "sorng_opkssh_vendor.dll";
  }
  if (osKey === "macos") {
    return "libsorng_opkssh_vendor.dylib";
  }
  return "libsorng_opkssh_vendor.so";
}

function envFlagEnabled(value) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on", "enable", "enabled"].includes(
    value.trim().toLowerCase(),
  );
}

function stagingEnabled() {
  if (hasFlag("--enable")) {
    return true;
  }

  if (hasFlag("--disable")) {
    return false;
  }

  return envFlagEnabled(process.env[bundleGateEnv]);
}

function resolveTargetDir() {
  const targetDirArg = readArgValue("--target-dir");
  if (targetDirArg) {
    return path.resolve(repoRoot, targetDirArg);
  }

  if (process.env.CARGO_TARGET_DIR) {
    return path.resolve(repoRoot, process.env.CARGO_TARGET_DIR);
  }

  return path.join(repoRoot, "src-tauri", "target");
}

function resolveProfileDir() {
  if (hasFlag("--release")) {
    return "release";
  }

  return readArgValue("--profile") || "debug";
}

function resolveFallbackArtifactPath(targetSpec, expectedArtifactName) {
  const baseTargetDir = resolveTargetDir();
  const profileDir = resolveProfileDir();

  if (targetSpec.triple) {
    return path.join(
      baseTargetDir,
      targetSpec.triple,
      profileDir,
      expectedArtifactName,
    );
  }

  return path.join(baseTargetDir, profileDir, expectedArtifactName);
}

function parseArtifactPath(stdout, expectedArtifactName) {
  let discoveredPath = null;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      const message = JSON.parse(line);
      if (message.reason !== "compiler-artifact") {
        continue;
      }

      if (!targetNames.has(message.target?.name)) {
        continue;
      }

      for (const filename of message.filenames || []) {
        if (path.basename(filename) === expectedArtifactName) {
          discoveredPath = filename;
        }
      }
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }

  return discoveredPath;
}

function scrubStagedArtifacts() {
  rmSync(bundleRoot, { recursive: true, force: true });
  mkdirSync(bundleRoot, { recursive: true });
}

function stageVendorArtifact() {
  if (!stagingEnabled()) {
    scrubStagedArtifacts();
    process.stdout.write(
      `OPKSSH vendor bundle staging disabled; scrubbed ${bundleRoot}. Set ${bundleGateEnv}=1 or pass --enable to stage the wrapper.\n`,
    );
    return;
  }

  const targetSpec = normalizeTargetSpec(inferTargetTriple());
  const expectedArtifactName = artifactNameFor(targetSpec.osKey);
  const cargoArgs = [
    "build",
    "--manifest-path",
    manifestPath,
    "--message-format=json-render-diagnostics",
    ...cargoUserArgs(),
  ];

  if (!readArgValue("--target") && targetSpec.triple) {
    cargoArgs.push("--target", targetSpec.triple);
  }

  const build = spawnSync("cargo", cargoArgs, {
    cwd: repoRoot,
    env: cargoBuildEnv(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (build.stdout) {
    process.stdout.write(build.stdout);
  }
  if (build.stderr) {
    process.stderr.write(build.stderr);
  }

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const sourceArtifactPath =
    parseArtifactPath(build.stdout || "", expectedArtifactName) ||
    resolveFallbackArtifactPath(targetSpec, expectedArtifactName);

  if (!existsSync(sourceArtifactPath)) {
    throw new Error(
      `Built OPKSSH vendor artifact was not found at ${sourceArtifactPath}`,
    );
  }

  const platformDir = `${targetSpec.osKey}-${targetSpec.archKey}`;
  const stagedDir = path.join(bundleRoot, platformDir);
  const stagedArtifactPath = path.join(stagedDir, expectedArtifactName);

  scrubStagedArtifacts();
  mkdirSync(stagedDir, { recursive: true });
  copyFileSync(sourceArtifactPath, stagedArtifactPath);

  if (!existsSync(stagedArtifactPath)) {
    throw new Error(
      `Failed to stage OPKSSH vendor artifact into ${stagedArtifactPath}`,
    );
  }

  process.stdout.write(
    `Staged ${sourceArtifactPath} -> ${stagedArtifactPath} (${bundleGateEnv}=1)\n`,
  );
}

try {
  stageVendorArtifact();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}