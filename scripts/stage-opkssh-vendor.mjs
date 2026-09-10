#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyOpksshVendorArtifact } from "./opkssh-vendor-artifact.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const gate = "SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE";
const enabled = (value) =>
  ["1", "true", "yes", "on", "enable", "enabled"].includes(
    value?.trim().toLowerCase(),
  );
const disabled = (value) =>
  ["0", "false", "no", "off", "disable", "disabled"].includes(
    value?.trim().toLowerCase(),
  );
function argumentValue(argv, key) {
  const inline = argv.find((arg) => arg.startsWith(`${key}=`));
  if (inline) {
    const value = inline.slice(key.length + 1);
    if (!value) throw new Error(`${key} requires a value`);
    return value;
  }
  const index = argv.indexOf(key);
  if (index >= 0 && (!argv[index + 1] || argv[index + 1].startsWith("--")))
    throw new Error(`${key} requires a value`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function opksshTarget(
  argv = [],
  env = process.env,
  platform = process.platform,
  arch = process.arch,
) {
  const triple =
    argumentValue(argv, "--target") ||
    env.CARGO_BUILD_TARGET ||
    env.TAURI_ENV_TARGET_TRIPLE ||
    env.TARGET;
  const osKey = triple
    ? /windows/.test(triple)
      ? "windows"
      : /darwin|apple/.test(triple)
        ? "macos"
        : /linux/.test(triple)
          ? "linux"
          : null
    : { win32: "windows", darwin: "macos", linux: "linux" }[platform];
  const archKey = triple
    ? /^(aarch64|arm64)-/.test(triple)
      ? "arm64"
      : /^(x86_64|amd64)-/.test(triple)
        ? "amd64"
        : null
    : { arm64: "arm64", x64: "amd64" }[arch];
  if (!osKey || !archKey)
    throw new Error(
      `Unsupported OPKSSH target: ${triple || `${platform}-${arch}`}`,
    );
  return { osKey, archKey, triple };
}

export function opksshStagingEnabled(argv = [], env = process.env) {
  if (
    argv.includes("--disable") ||
    enabled(env.SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE)
  )
    return false;
  if (argv.includes("--enable")) return true;
  if (disabled(env[gate])) return false;
  if (env[gate] && !enabled(env[gate]))
    throw new Error(`${gate} must be a boolean value`);
  return true;
}

/** Import-safe and injectable for tests: no Cargo, network or file changes on import. */
export function stageVendorArtifact({
  argv = process.argv.slice(2),
  env = process.env,
  root = repoRoot,
  platform = process.platform,
  arch = process.arch,
  run = spawnSync,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const target = opksshTarget(argv, env, platform, arch);
  const artifact =
    target.osKey === "windows"
      ? "sorng_opkssh_vendor.dll"
      : target.osKey === "macos"
        ? "libsorng_opkssh_vendor.dylib"
        : "libsorng_opkssh_vendor.so";
  const crate = path.join(root, "src-tauri", "crates", "sorng-opkssh-vendor");
  const bundleRoot = path.join(crate, "bundle", "opkssh");
  const destination = path.join(
    bundleRoot,
    `${target.osKey}-${target.archKey}`,
    artifact,
  );
  if (!opksshStagingEnabled(argv, env)) {
    // Opt-out removes only this exact target artifact; never other architectures.
    rmSync(destination, { force: true });
    mkdirSync(bundleRoot, { recursive: true });
    log(
      `OPKSSH embedded runtime explicitly disabled for ${target.osKey}-${target.archKey}; external CLI is required.`,
    );
    return { disabled: true, destination };
  }
  const verify = (file) => verifyOpksshVendorArtifact(file, target);
  const prebuilt = env.SORNG_OPKSSH_VENDOR_ARTIFACT;
  if (!prebuilt && existsSync(destination)) {
    try {
      verify(destination);
      log(`Verified and preserved embedded OPKSSH bridge: ${destination}`);
      return { reused: true, destination };
    } catch {
      // Replace a stale metadata wrapper only after its replacement verifies.
    }
  }
  const execute = (command, args, options = {}) => {
    const result = run(command, args, {
      cwd: root,
      env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
    if (result.stdout) log(result.stdout.trimEnd());
    if (result.stderr) log(result.stderr.trimEnd());
    if (result.error || result.status !== 0)
      throw new Error(
        `OPKSSH bridge build failed (${result.error?.message ?? `exit ${result.status}`}); existing staged artifacts were preserved. See docs/opkssh-vendor-bridge.md.`,
      );
    return result;
  };
  let source;
  if (prebuilt) {
    if (!path.isAbsolute(prebuilt))
      throw new Error(
        "SORNG_OPKSSH_VENDOR_ARTIFACT must be an absolute path to a matching prebuilt bridge",
      );
    source = prebuilt;
  } else if (target.osKey === "windows") {
    if (platform !== "win32")
      throw new Error(
        `OPKSSH Windows bridges require a native Windows runner or SORNG_OPKSSH_VENDOR_ARTIFACT with a verified ${target.osKey}-${target.archKey} bridge.`,
      );
    const bridgeTarget =
      target.archKey === "arm64"
        ? "aarch64-pc-windows-gnullvm"
        : "x86_64-pc-windows-gnu";
    const cached = path.join(
      root,
      "src-tauri",
      "target-opkssh-gnu",
      bridgeTarget,
      "release",
      artifact,
    );
    try {
      verify(cached);
      source = cached;
    } catch {
      /* Build a missing/invalid real bridge. */
    }
    if (!source) {
      execute(process.execPath, [
        path.join(root, "scripts", "build-opkssh-vendor-bridge.mjs"),
        "--target",
        bridgeTarget,
        "--skip-stage",
      ]);
      source = cached;
    }
  } else {
    const cargoArgs = argv.filter(
      (arg) => !["--enable", "--disable"].includes(arg),
    );
    if (!argumentValue(argv, "--target") && target.triple)
      cargoArgs.push("--target", target.triple);
    // Staging never contends with the app watcher's build directory by default.
    const targetDir =
      argumentValue(argv, "--target-dir") ||
      env.CARGO_TARGET_DIR ||
      path.join(root, ".artifacts", "cargo-opkssh-vendor");
    if (!argumentValue(argv, "--target-dir"))
      cargoArgs.push("--target-dir", targetDir);
    const result = execute("cargo", [
      "build",
      "--manifest-path",
      path.join(crate, "Cargo.toml"),
      "--message-format=json-render-diagnostics",
      ...cargoArgs,
    ]);
    for (const line of (result.stdout ?? "").split(/\r?\n/)) {
      try {
        const message = JSON.parse(line);
        if (
          message.reason === "compiler-artifact" &&
          ["sorng-opkssh-vendor", "sorng_opkssh_vendor"].includes(
            message.target?.name,
          )
        )
          source =
            message.filenames?.find(
              (file) => path.basename(file) === artifact,
            ) ?? source;
      } catch {
        /* Cargo may emit non-JSON progress lines. */
      }
    }
    if (!source)
      throw new Error(
        "Cargo did not report the OPKSSH vendor library artifact",
      );
  }
  verify(source);
  if (path.resolve(source) === path.resolve(destination))
    return { reused: true, destination };
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.staging`;
  try {
    copyFileSync(source, temporary);
    verify(temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  log(`Verified embedded OPKSSH bridge staged: ${source} -> ${destination}`);
  return { reused: false, destination };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    stageVendorArtifact();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
