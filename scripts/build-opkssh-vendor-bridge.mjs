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
 * same toolchain as the app. So we build it for `x86_64-pc-windows-gnu`, where
 * CGO static linking works, and the MSVC app loads it unchanged.
 *
 * Usage:
 *   node scripts/build-opkssh-vendor-bridge.mjs [--checkout] [--debug] [--skip-stage]
 *
 *   --checkout    Clone/refresh the pinned upstream checkout, then exit.
 *   --debug       Build the debug profile instead of release.
 *   --skip-stage  Build but do not copy into the bundle directory.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const vendorCrate = path.join(
  repoRoot,
  "src-tauri",
  "crates",
  "sorng-opkssh-vendor",
);
const manifestPath = path.join(vendorCrate, "Cargo.toml");
const checkoutDir = path.join(repoRoot, ".cache", "opkssh-upstream");
const targetDir = path.join(repoRoot, "src-tauri", "target-opkssh-gnu");
const TRIPLE = "x86_64-pc-windows-gnu";
const GNU_TOOLCHAIN = "stable-x86_64-pc-windows-gnu";
const UPSTREAM_REPO = "https://github.com/openpubkey/opkssh";
const STUB_MARKER =
  "embedded OPKSSH runtime is not available in this wrapper build";

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

function requireToolchain() {
  const go = capture("go", ["version"]);
  if (go.status !== 0) {
    fail(
      "Go toolchain not found on PATH. Install Go (>= 1.21) and re-run; " +
        "without it the vendor DLL can only be built metadata-only.",
    );
  }
  log(go.stdout.trim());

  const toolchains = capture("rustup", ["toolchain", "list"]);
  if (toolchains.status !== 0) {
    fail("rustup not found on PATH.");
  }
  if (!toolchains.stdout.includes(GNU_TOOLCHAIN)) {
    log(`installing missing Rust toolchain ${GNU_TOOLCHAIN}`);
    run("rustup", ["toolchain", "install", GNU_TOOLCHAIN]);
  }

  const gcc = capture("gcc", ["--version"]);
  if (gcc.status !== 0) {
    fail(
      "MinGW gcc not found on PATH. CGO needs a C compiler for the windows-gnu " +
        "target (e.g. MSYS2: pacman -S mingw-w64-x86_64-gcc, then add " +
        "C:/msys64/mingw64/bin to PATH).",
    );
  }
  log(gcc.stdout.split(/\r?\n/)[0]);
}

function buildBridge() {
  const cargoArgs = [
    `+${GNU_TOOLCHAIN}`,
    "build",
    "--manifest-path",
    manifestPath,
    "--target",
    TRIPLE,
    "--target-dir",
    targetDir,
  ];
  if (isRelease) {
    cargoArgs.push("--release");
  }

  log(`cargo ${cargoArgs.join(" ")}`);
  run("cargo", cargoArgs, {
    env: {
      ...process.env,
      CGO_ENABLED: "1",
      // Let build.rs discover the durable checkout itself; setting it here
      // keeps the build honest even if the default ever moves.
      SORNG_OPKSSH_VENDOR_CHECKOUT: checkoutDir,
    },
  });

  return path.join(
    targetDir,
    TRIPLE,
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
function verifyArtifact(dllPath) {
  if (!existsSync(dllPath)) {
    fail(`expected artifact was not produced at ${dllPath}`);
  }

  const bytes = readFileSync(dllPath);
  const text = bytes.toString("latin1");

  if (text.includes(STUB_MARKER)) {
    fail(
      `${dllPath} is a metadata-only build (contains the stub marker). ` +
        "The Go bridge did not compile in - re-read the cargo warnings above.",
    );
  }

  const goMarkers = ["runtime.goexit", "golang.org", "go1."];
  const missing = goMarkers.filter((marker) => !text.includes(marker));
  if (missing.length > 0) {
    fail(`${dllPath} is missing Go runtime markers: ${missing.join(", ")}`);
  }

  const requiredExports = [
    "sorng_opkssh_vendor_abi_version",
    "sorng_opkssh_vendor_embedded_runtime",
    "sorng_opkssh_vendor_backend_callable",
    "sorng_opkssh_vendor_login_json",
    "sorng_opkssh_vendor_load_client_config_json",
    "sorng_opkssh_vendor_free_string",
  ];
  const missingExports = requiredExports.filter(
    (symbol) => !text.includes(symbol),
  );
  if (missingExports.length > 0) {
    fail(
      `${dllPath} is missing required C ABI exports: ${missingExports.join(", ")}`,
    );
  }

  // A dependency on libgcc_s_seh-1.dll would make the DLL unloadable on
  // machines without MinGW installed.
  if (text.includes("libgcc_s_seh-1.dll")) {
    fail(
      `${dllPath} depends on libgcc_s_seh-1.dll, which is not present on user ` +
        "machines. The static-unwinder shim in build.rs did not apply.",
    );
  }

  const goVersion = text.match(/go1\.\d+(\.\d+)?/);
  log(
    `verified: embedded Go runtime present (${goVersion ? goVersion[0] : "unknown version"}), ` +
      `no stub marker, all ${requiredExports.length} C ABI exports present, ` +
      "no MinGW runtime dependency",
  );
}

function stageArtifact(dllPath) {
  const stagedDir = path.join(vendorCrate, "bundle", "opkssh", "windows-amd64");
  mkdirSync(stagedDir, { recursive: true });
  const stagedPath = path.join(stagedDir, "sorng_opkssh_vendor.dll");
  copyFileSync(dllPath, stagedPath);
  log(`staged -> ${stagedPath}`);
  return stagedPath;
}

function main() {
  if (process.platform !== "win32") {
    fail(
      "This script builds the windows-amd64 vendor DLL and must run on Windows.",
    );
  }

  ensureCheckout();
  if (hasFlag("--checkout")) {
    log("checkout ready; exiting because --checkout was passed");
    return;
  }

  requireToolchain();
  const dllPath = buildBridge();
  verifyArtifact(dllPath);

  if (hasFlag("--skip-stage")) {
    log(`built ${dllPath}; not staging because --skip-stage was passed`);
    return;
  }

  stageArtifact(dllPath);
  log("done - the app will now report an embedded libopkssh runtime.");
}

main();
