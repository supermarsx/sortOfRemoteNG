#!/usr/bin/env node
/**
 * Build the OPKSSH vendor DLL *with* the embedded Go `libopkssh` runtime.
 *
 * Why this is a separate script from `stage:opkssh-vendor`:
 *
 * The Go bridge is compiled with `go build -buildmode=c-archive`, which emits a
 * GNU-format static archive. MSVC's linker cannot consume that, so the ordinary
 * MSVC build of this crate deliberately produces a metadata-only wrapper.
 *
 * The app does not static-link the vendor crate at runtime - `sorng-opkssh`'s
 * `binary.rs` dlopens the staged DLL via `libloading` and calls a small C ABI
 * (`sorng_opkssh_vendor_login_json`, `..._load_client_config_json`, ...).
 * Because the boundary is C ABI, the DLL does not have to be built with the
 * same toolchain as the app. Build natively with GNU (x64) or LLVM-MinGW
 * (ARM64), where CGO static linking works; the MSVC app loads the same C ABI.
 *
 * Usage:
 *   node scripts/build-opkssh-vendor-bridge.mjs [--checkout] [--debug] [--skip-stage]
 *
 *   --checkout    Clone/refresh the pinned upstream checkout, then exit.
 *   --debug       Build the debug profile instead of release.
 *   --skip-stage  Build but do not copy into the bundle directory.
 *   --target      x86_64-pc-windows-gnu or aarch64-pc-windows-gnullvm.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  opksshWindowsBridgeBuildArgs,
  opksshWindowsBridgeEnvironment,
  opksshWindowsBridgePlan,
  verifyOpksshVendorArtifact,
} from "./opkssh-vendor-artifact.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const vendorCrate = path.join(
  repoRoot,
  "src-tauri",
  "crates",
  "sorng-opkssh-vendor",
);
const manifestPath = path.join(vendorCrate, "Cargo.toml");
const checkoutDir = process.env.SORNG_OPKSSH_VENDOR_CHECKOUT
  ? path.resolve(process.env.SORNG_OPKSSH_VENDOR_CHECKOUT)
  : path.join(repoRoot, ".cache", "opkssh-upstream");
const targetDir = path.join(repoRoot, "src-tauri", "target-opkssh-gnu");
const UPSTREAM_REPO = "https://github.com/openpubkey/opkssh";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const isRelease = !hasFlag("--debug");

function fail(message) {
  process.stderr.write(`\n[opkssh-bridge] ERROR: ${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[opkssh-bridge] ${message}\n`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} exited with ${result.status}`);
  }
  return result;
}

function capture(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

/**
 * Read `PINNED_UPSTREAM_REV` straight out of build.rs so the script and the
 * build script can never disagree about which revision the overlay targets.
 */
function pinnedRevision() {
  const buildScript = readFileSync(path.join(vendorCrate, "build.rs"), "utf8");
  const match = buildScript.match(
    /PINNED_UPSTREAM_REV:\s*&str\s*=\s*"([0-9a-f]{40})"/,
  );
  if (!match) {
    fail("could not read PINNED_UPSTREAM_REV from build.rs");
  }
  return match[1];
}

function ensureCheckout() {
  const rev = pinnedRevision();

  if (!existsSync(path.join(checkoutDir, ".git"))) {
    log(`cloning ${UPSTREAM_REPO} into ${checkoutDir}`);
    mkdirSync(path.dirname(checkoutDir), { recursive: true });
    run("git", ["clone", "--filter=blob:none", UPSTREAM_REPO, checkoutDir]);
  }

  const head = capture("git", ["rev-parse", "HEAD"], { cwd: checkoutDir });
  if (head.status === 0 && head.stdout.trim() === rev) {
    log(`checkout already at pinned revision ${rev}`);
    return;
  }

  log(`checking out pinned revision ${rev}`);
  const checkout = capture("git", ["checkout", "--detach", rev], {
    cwd: checkoutDir,
  });
  if (checkout.status !== 0) {
    log("pinned revision not present locally; fetching");
    run("git", ["fetch", "--filter=blob:none", "origin", rev], {
      cwd: checkoutDir,
    });
    run("git", ["checkout", "--detach", rev], { cwd: checkoutDir });
  }
}

function requireToolchain(plan, env) {
  const go = capture(process.env.SORNG_OPKSSH_VENDOR_GO || "go", ["version"]);
  if (go.status !== 0) {
    fail(
      "Go toolchain not found on PATH. Install Go compatible with the pinned upstream go.mod (>= 1.24) and re-run; " +
        "without it the vendor DLL can only be built metadata-only.",
    );
  }
  log(go.stdout.trim());

  if (plan.toolchain) {
    const toolchains = capture("rustup", ["toolchain", "list"]);
    if (
      toolchains.status !== 0 ||
      !toolchains.stdout.includes(plan.toolchain)
    ) {
      fail(
        `Rust toolchain ${plan.toolchain} is missing. Install it explicitly with rustup toolchain install ${plan.toolchain}, then retry. No toolchains were installed.`,
      );
    }
  } else {
    // Use the runner's active/pinned native ARM toolchain, not an unpinned override.
    const targets = capture("rustup", ["target", "list", "--installed"]);
    if (
      targets.status !== 0 ||
      !targets.stdout.split(/\r?\n/).includes(plan.triple)
    )
      fail(
        `Rust target ${plan.triple} is missing from the active toolchain. Run rustup target add ${plan.triple}, then retry. No toolchains were installed.`,
      );
  }

  const compiler = capture(env[plan.linkerEnv], ["--version"], { env });
  if (compiler.status !== 0) {
    fail(
      plan.archKey === "arm64"
        ? "LLVM-MinGW aarch64-w64-mingw32-clang not found. Set SORNG_OPKSSH_LLVM_MINGW_BIN to the verified native ARM64 LLVM-MinGW bin directory documented in docs/opkssh-vendor-bridge.md."
        : "MinGW gcc not found on PATH. CGO needs a C compiler for the windows-gnu " +
            "target (e.g. MSYS2: pacman -S mingw-w64-x86_64-gcc, then add " +
            "C:/msys64/mingw64/bin to PATH).",
    );
  }
  log(compiler.stdout.split(/\r?\n/)[0]);
}

function buildBridge(plan, env) {
  const cargoArgs = opksshWindowsBridgeBuildArgs(plan, {
    manifestPath,
    targetDir,
    release: isRelease,
  });

  log(`cargo ${cargoArgs.join(" ")}`);
  run("cargo", cargoArgs, {
    env: {
      ...env,
      // Let build.rs discover the durable checkout itself; setting it here
      // keeps the build honest even if the default ever moves.
      SORNG_OPKSSH_VENDOR_CHECKOUT: checkoutDir,
    },
  });

  return path.join(
    targetDir,
    plan.triple,
    isRelease ? "release" : "debug",
    "sorng_opkssh_vendor.dll",
  );
}

/**
 * The whole point of this script is that the DLL carries the Go runtime, so
 * verify that rather than trusting a zero exit code. A metadata-only build also
 * links and stages perfectly happily - that is exactly how the broken artifact
 * shipped unnoticed.
 */
function verifyArtifact(dllPath, plan) {
  try {
    const { goVersion } = verifyOpksshVendorArtifact(dllPath, {
      osKey: "windows",
      archKey: plan.archKey,
    });
    log(
      `verified: ${goVersion}, Windows ${plan.archKey}, all eight C ABI exports, no metadata stub or MinGW runtime dependency`,
    );
  } catch (error) {
    fail(error.message);
  }
}

function stageArtifact(dllPath, plan) {
  const stagedDir = path.join(
    vendorCrate,
    "bundle",
    "opkssh",
    `windows-${plan.archKey}`,
  );
  mkdirSync(stagedDir, { recursive: true });
  const stagedPath = path.join(stagedDir, "sorng_opkssh_vendor.dll");
  copyFileSync(dllPath, stagedPath);
  log(`staged -> ${stagedPath}`);
  return stagedPath;
}

function main() {
  if (process.platform !== "win32") {
    fail(
      "This script builds the Windows vendor DLL and must run on native Windows.",
    );
  }

  if (hasFlag("--checkout")) {
    ensureCheckout();
    log("checkout ready; exiting because --checkout was passed");
    return;
  }

  const hostResult = capture("rustc", ["-vV"]);
  const host =
    hostResult.status === 0
      ? hostResult.stdout.match(/^host:\s*(\S+)/m)?.[1]
      : undefined;
  const targetIndex = args.indexOf("--target");
  const inlineTarget = args.find((arg) => arg.startsWith("--target="));
  const requested = inlineTarget
    ? inlineTarget.slice("--target=".length)
    : targetIndex >= 0
      ? args[targetIndex + 1]
      : undefined;
  if (
    (inlineTarget || targetIndex >= 0) &&
    (!requested || requested.startsWith("--"))
  )
    fail("--target requires a value");
  let plan;
  let bridgeEnv;
  try {
    plan = opksshWindowsBridgePlan(
      requested ||
        (host?.startsWith("aarch64-")
          ? "aarch64-pc-windows-gnullvm"
          : "x86_64-pc-windows-gnu"),
      host,
    );
    bridgeEnv = opksshWindowsBridgeEnvironment(plan);
  } catch (error) {
    fail(error.message);
  }
  requireToolchain(plan, bridgeEnv);
  ensureCheckout();
  const dllPath = buildBridge(plan, bridgeEnv);
  verifyArtifact(dllPath, plan);

  if (hasFlag("--skip-stage")) {
    log(`built ${dllPath}; not staging because --skip-stage was passed`);
    return;
  }

  stageArtifact(dllPath, plan);
  log("done - the app will now report an embedded libopkssh runtime.");
}

main();
