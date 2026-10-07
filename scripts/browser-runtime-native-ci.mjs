#!/usr/bin/env node
// Native six-target engineering builds. No production app launch or Ready grant.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadArchive,
  extractRuntime,
  packageManifest,
  stagePackage,
  inspectBundle,
} from "./browser-runtime-package.mjs";
import { runAcceptance } from "./cef-browser-acceptance.mjs";
import {
  assertIsolatedIdentifier,
  inspectProfileBinary,
  validateProfileProbe,
} from "./lib/e2e-profile-isolation.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));

// Exit-early proof of the actual app DLL entry, never app services or profiles.
// The bootstrap itself has no identity marker; scan its matching client DLL.
export async function probeWindowsAppEntry({
  bundle,
  runtime,
  target,
  output,
  identifier = "com.sortofremote.ng.cef-native-ci",
  appName = "sortofremoteng",
}) {
  if (process.platform !== "win32" || !target.endsWith("pc-windows-msvc"))
    throw new Error("Windows native entry probe requires a Windows runner");
  assertIsolatedIdentifier(identifier);
  packageManifest(target, appName); // Validate the component before path joins.
  const inspection = await inspectBundle(bundle, runtime, target, appName);
  if (!inspection.ok)
    throw new Error(`Entry package rejected: ${inspection.errors.join("; ")}`);
  const dll = path.resolve(bundle, `${appName}.dll`);
  const before = await inspectProfileBinary(dll);
  if (before.identifiers.length !== 1 || before.identifiers[0] !== identifier)
    throw new Error(
      "App client does not have the exact isolated identity; refusing launch",
    );
  output = path.resolve(output);
  await mkdir(output, { recursive: false });
  const probeFile = path.join(output, "profile-probe.json");
  const webview = path.join(output, "unused-webview2");
  const result = spawnSync(
    path.resolve(bundle, `${appName}.exe`),
    ["--sorng-profile-probe", `--sorng-webview2-user-data-folder=${webview}`],
    {
      cwd: path.resolve(bundle),
      windowsHide: true,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        SORNG_EXPECT_ISOLATED_PROFILE: identifier,
        SORNG_PROFILE_PROBE_OUT: probeFile,
        WEBVIEW2_USER_DATA_FOLDER: webview,
      },
    },
  );
  await writeFile(
    path.join(output, "process.json"),
    JSON.stringify(
      {
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        stdout: result.stdout,
        stderr: result.stderr,
        clientSha256: before.sha256,
        productionReady: false,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Isolated entry probe failed: ${result.status}`);
  const probe = JSON.parse(await readFile(probeFile, "utf8"));
  validateProfileProbe(probe, identifier, { expectedWebView2Folder: webview });
  if (probe.pid !== result.pid) throw new Error("Entry probe PID mismatch");
  if ((await inspectProfileBinary(dll)).sha256 !== before.sha256)
    throw new Error("App client changed during entry probe");
  return {
    ok: true,
    identifier,
    appName,
    clientSha256: before.sha256,
    entryDispatched: true,
    cefInitialized: false,
    rendererSandbox: "not-tested",
    productionReady: false,
  };
}
export function nativeBuildPlan(target, output) {
  const manifest = packageManifest(target);
  const platform = { windows: "win32", linux: "linux", macos: "darwin" }[
    manifest.platform
  ];
  const arch = target.startsWith("aarch64") ? "arm64" : "x64";
  const root = path.resolve(output);
  const cargo = path.join(root, "cargo");
  const base = [
    "--locked",
    "--offline",
    "--target",
    target,
    "--target-dir",
    cargo,
  ];
  const app = [
    manifest.platform === "windows" ? "rustc" : "build",
    "--manifest-path",
    path.join(repo, "src-tauri/Cargo.toml"),
    ...base,
    "--no-default-features",
    "--features",
    "native-browser",
    ...(manifest.platform === "windows"
      ? ["--lib", "--crate-type", "cdylib"]
      : ["--bin", "app"]),
  ];
  const helper = [
    "build",
    "--manifest-path",
    path.join(repo, "src-tauri/Cargo.toml"),
    ...base,
    "-p",
    "sorng-browser-host",
    "--features",
    "cef-host",
    "--bin",
    "sorng-cef-helper",
  ];
  const fixtureManifest = path.join(
    repo,
    "src-tauri/crates/sorng-browser-host/tests/native_acceptance/Cargo.toml",
  );
  const fixture = [
    "build",
    "--manifest-path",
    fixtureManifest,
    ...base,
    ...(manifest.platform === "windows"
      ? ["--lib"]
      : ["--bin", "sorng-cef-acceptance"]),
  ];
  return {
    manifest,
    platform,
    arch,
    root,
    cargo,
    app,
    helper,
    fixture,
    fixtureManifest,
  };
}

function command(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repo,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(executable)} exited ${code}`)),
    );
  });
}

function applicationPlist(name) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>${name}</string><key>CFBundleIdentifier</key><string>com.sortofremote.ng.cef-native-ci</string>
<key>CFBundleName</key><string>${name}</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/>
</dict></plist>`;
}

export function nativeAcquisitionPlan(
  target,
  output,
  { archivePath, offline = false } = {},
) {
  const manifest = packageManifest(target);
  if (offline && !archivePath)
    throw new Error("Offline native build requires an explicit local archive");
  return {
    archive: path.resolve(
      archivePath ?? path.join(output, manifest.artifact.name),
    ),
    downloadArchive: !archivePath,
    fetchCargo: !offline,
  };
}

export async function buildNativePackages(target, output, options = {}) {
  const plan = nativeBuildPlan(target, output);
  const acquisition = nativeAcquisitionPlan(target, output, options);
  if (process.platform !== plan.platform || process.arch !== plan.arch)
    throw new Error(
      "Use the matching native OS and architecture runner; cross-compilation is not runtime proof",
    );
  await mkdir(plan.root, { recursive: false });
  const archive = acquisition.archive;
  if (acquisition.downloadArchive)
    await downloadArchive({ target, output: archive });
  const sdk = await extractRuntime({
    target,
    archivePath: archive,
    output: path.join(plan.root, "sdk"),
  });
  const env = {
    ...process.env,
    CEF_PATH: sdk.runtime,
    TAURI_CONFIG: JSON.stringify({
      identifier: "com.sortofremote.ng.cef-native-ci",
    }),
    MACOSX_DEPLOYMENT_TARGET: "14.0",
    GDK_BACKEND: "x11",
  };
  delete env.FLATPAK;
  delete env.NIX_CEF_BINARY;
  if (plan.platform === "linux") {
    // Literal $ORIGIN is passed directly to rustc, never expanded by a shell.
    env.RUSTFLAGS =
      `${env.RUSTFLAGS ?? ""} -C link-arg=-Wl,-rpath,$ORIGIN`.trim();
  }
  // Explicit dependency acquisition precedes offline compilation. CEF was
  // independently verified above, so its build script cannot select latest.
  for (const manifest of acquisition.fetchCargo
    ? [path.join(repo, "src-tauri/Cargo.toml"), plan.fixtureManifest]
    : [])
    await command(
      "cargo",
      ["fetch", "--locked", "--target", target, "--manifest-path", manifest],
      env,
    );
  const cargoBuild = (args) =>
    command(
      process.execPath,
      [path.join(repo, "scripts/native-build-env.mjs"), "cargo", ...args],
      env,
    );
  await cargoBuild(plan.app);
  if (plan.platform !== "win32") await cargoBuild(plan.helper);
  await cargoBuild(plan.fixture);
  const binaries = path.join(plan.cargo, target, "debug");
  const staged = {};
  for (const name of ["sortofremoteng", "sorng-cef-acceptance"]) {
    const isApp = name === "sortofremoteng";
    const application = path.join(
      binaries,
      plan.platform === "win32"
        ? isApp
          ? "app_lib.dll"
          : "sorng_cef_acceptance.dll"
        : isApp
          ? "app"
          : "sorng-cef-acceptance",
    );
    let appPlist;
    if (plan.platform === "darwin") {
      appPlist = path.join(plan.root, `${name}.plist`);
      await writeFile(appPlist, applicationPlist(name), { flag: "wx" });
    }
    const bundle = path.join(
      plan.root,
      `${name}${plan.platform === "darwin" ? ".app" : "-bundle"}`,
    );
    const report = await stagePackage({
      target,
      archivePath: archive,
      application,
      helper: path.join(binaries, "sorng-cef-helper"),
      output: bundle,
      appName: name,
      appPlist,
    });
    await writeFile(
      path.join(plan.root, `${name}-package.json`),
      JSON.stringify(report, null, 2),
      { flag: "wx" },
    );
    staged[name] = bundle;
  }
  // Do not launch the app: this build gate uses a minimal feature app shell,
  // and the dedicated fixture creates only workspace-local synthetic profiles.
  const fixtureBundle = staged["sorng-cef-acceptance"];
  if (plan.platform === "win32") {
    const entry = await probeWindowsAppEntry({
      bundle: staged.sortofremoteng,
      runtime: sdk.runtime,
      target,
      output: path.join(plan.root, "app-entry"),
    });
    await writeFile(
      path.join(plan.root, "app-entry.json"),
      JSON.stringify(entry, null, 2),
      { flag: "wx" },
    );
  }
  const executable =
    plan.platform === "darwin"
      ? path.join(fixtureBundle, "Contents/MacOS/sorng-cef-acceptance")
      : path.join(
          fixtureBundle,
          `sorng-cef-acceptance${plan.platform === "win32" ? ".exe" : ""}`,
        );
  await writeFile(
    path.join(plan.root, "build.json"),
    JSON.stringify(
      {
        target,
        executable,
        appFeatureScope: "no-default-features,native-browser",
        acquisition,
        productionReady: false,
        staged,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  return { target, executable, staged };
}

async function main(args) {
  if (args[0] === "build-local" && args.length === 4)
    return buildNativePackages(args[1], args[3], {
      archivePath: args[2],
      offline: true,
    });
  if (args.length !== 3 || !["build", "run"].includes(args[0]))
    throw new Error(
      "Usage: browser-runtime-native-ci.mjs build-local TARGET LOCAL_ARCHIVE NEW_OUTPUT | build TARGET NEW_OUTPUT | run PACKAGED_FIXTURE NEW_OUTPUT",
    );
  if (args[0] === "build") return buildNativePackages(args[1], args[2]);
  return runAcceptance({ executable: args[1], output: args[2] });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
