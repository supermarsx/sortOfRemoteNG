#!/usr/bin/env node
// Normal Tauri build/dev with a mandatory, pinned CEF native entry. Never grants
// browser admission. No production application is launched by the build verb.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  downloadArchive,
  extractRuntime,
  inspectRuntime,
  inspectBundle,
  packageManifest,
  stagePackage,
  verifyArtifact,
} from "./browser-runtime-package.mjs";
import { buildNativeChildEnvironment } from "./lib/native-child-env.mjs";
import {
  stageWindowsNativeRuntime,
  runtimeDllsForArchitecture,
} from "./stage-windows-native-runtime.mjs";
import { stageOpenH264Runtime } from "./stage-openh264-runtime.mjs";
import {
  preflightCustomRuntime,
  customRuntimeEnvironment,
  prepareCustomRuntime,
  stageCustomRuntimePackage,
  verifyPreparedCustomRuntime,
  identitySha256,
} from "./lib/browser-custom-runtime.mjs";
import {
  bundleArguments,
  prepareWindowsInstallerBundles,
} from "./lib/browser-installer-bundles.mjs";
import {
  LOCAL_RUNTIME_SELECTION_FILE,
  resolveLocalRuntime,
  sameLocalPath,
  verifyLocalRuntimeSelection,
} from "./lib/browser-local-runtime.mjs";
import { ensurePublishedRuntime } from "./lib/browser-runtime-bootstrap.mjs";
import { ensureBrowserSandboxAccess } from "./lib/browser-sandbox-access.mjs";
import { validateBrowserClientImports } from "./lib/browser-client-imports.mjs";
import {
  digestFile,
  immutableDevCache,
  prepareDevSdkCache,
} from "./lib/browser-dev-sdk-cache.mjs";
export {
  immutableDevCache,
  prepareDevSdkCache,
} from "./lib/browser-dev-sdk-cache.mjs";
export { prepareWindowsInstallerBundles } from "./lib/browser-installer-bundles.mjs";

const driver = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(driver), "..");
const tauriDir = path.join(repo, "src-tauri");
const cli = path.join(repo, "node_modules/@tauri-apps/cli/tauri.js");
const framework = "Chromium Embedded Framework.framework";
const exists = async (file) =>
  stat(file).then(
    () => true,
    (e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

// Only default dev launches share immutable build inputs. Explicit output and
// build/bundle invocations retain their private, inspectable artifact layouts.
export const reuseDevInputs = (options) =>
  options.mode === "dev" && !options.output;

export async function prepareDevRunnerCache(
  {
    cacheRoot,
    source,
    compilerIdentity,
    env,
    platform = process.platform,
    arch = process.arch,
  },
  build = child,
) {
  const sourceDigest = await digestFile(source);
  const identity = {
    schema: 1,
    sourceDigest,
    compilerIdentity,
    platform,
    arch,
  };
  const key = identitySha256(identity);
  const filename = `cef-cargo-runner${platform === "win32" ? ".exe" : ""}`;
  const directory = await immutableDevCache({
    cacheRoot,
    kind: "runner",
    key,
    create: async (temporary) => {
      const runner = path.join(temporary, filename);
      await build("rustc", ["--edition=2021", source, "-o", runner], env);
      if ((await digestFile(source)) !== sourceDigest)
        throw new Error("CEF runner source changed during compilation");
      await save(path.join(temporary, "runner.json"), {
        identity,
        sha256: await digestFile(runner),
      });
    },
    verify: async (entry) => {
      const receipt = path.join(entry, "runner.json");
      const runner = path.join(entry, filename);
      const info = await lstat(runner);
      if (
        !(await lstat(receipt)).isFile() ||
        !info.isFile() ||
        !info.size ||
        (platform !== "win32" && !(info.mode & 0o111))
      )
        throw new Error("Invalid cached CEF runner");
      const recorded = await json(receipt);
      if (
        identitySha256(recorded.identity) !== key ||
        (await digestFile(runner)) !== recorded.sha256
      )
        throw new Error(
          "Cached CEF runner integrity changed; refusing replacement",
        );
    },
  });
  return path.join(directory, filename);
}

export function stableDevConfiguration(config, runner) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const result = structuredClone(config);
  (result.build ??= {}).runner = { cmd: runner };
  return canonical(result);
}

export function mergeConfig(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === null) delete result[key];
    else
      result[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? mergeConfig(
              result[key] &&
                typeof result[key] === "object" &&
                !Array.isArray(result[key])
                ? result[key]
                : {},
              value,
            )
          : structuredClone(value);
  }
  return result;
}

export function hostTarget(platform = process.platform, arch = process.arch) {
  const cpu = { x64: "x86_64", arm64: "aarch64" }[arch];
  const os = {
    win32: "pc-windows-msvc",
    linux: "unknown-linux-gnu",
    darwin: "apple-darwin",
  }[platform];
  if (!cpu || !os)
    throw new Error(
      "CEF requires a supported native x64/ARM64 Windows, Linux or macOS runner",
    );
  return `${cpu}-${os}`;
}

export function parseArguments(
  argv,
  env = process.env,
  { selectionFile = LOCAL_RUNTIME_SELECTION_FILE, deferRuntime = false } = {},
) {
  const [mode, ...rawArgs] = argv;
  const boundary = rawArgs.indexOf("--");
  const args = rawArgs.flatMap((argument, index) => {
    if (boundary >= 0 && index >= boundary) return [argument];
    const equals = argument.startsWith("--") ? argument.indexOf("=") : -1;
    return equals > 0
      ? [argument.slice(0, equals), argument.slice(equals + 1)]
      : [argument];
  });
  if (!["build", "dev"].includes(mode))
    throw new Error(
      "Usage: browser-app-build.mjs build|dev [Tauri options] [--cef-archive PATH] [--cef-sdk PATH] [--cef-output NEW_DIR] [--cef-offline] [--cef-download]",
    );
  const options = {
    mode,
    target: env.CARGO_BUILD_TARGET || hostTarget(),
    configs: [],
    tauriArgs: [],
    cargoArgs: [],
    features: [],
    archive: env.SORNG_CEF_ARCHIVE,
    sdk: env.SORNG_CEF_SDK || env.CEF_PATH,
    runtimeKind: env.SORNG_CEF_RUNTIME_KIND,
    officialRuntimeExplicit: false,
    customManifest: env.SORNG_CEF_CUSTOM_MANIFEST,
    sourceLock: env.SORNG_CEF_SOURCE_LOCK,
    artifactRoot: env.SORNG_CEF_ARTIFACT_ROOT,
    output: env.SORNG_CEF_OUTPUT,
    // Cargo already adds the target triple. Repeating it in this root made
    // MSBuild's native try-compile .tlog paths exceed MAX_PATH (FTK1011).
    cargoTarget:
      env.SORNG_CEF_CARGO_TARGET_DIR || path.join(repo, ".cache/cef-target"),
    nativePrepared: env.SORNG_CEF_NATIVE_PREPARED === "1",
    offline: env.CARGO_NET_OFFLINE === "true",
    download: env.SORNG_CEF_ACQUIRE !== "0",
    downloadRequested: false,
    dynamic: mode === "build",
    prepareOnly: false,
    noBundle: false,
    debug: mode === "dev",
  };
  options.publicTarget =
    env.SORNG_CEF_PUBLIC_TARGET_DIR || env.CARGO_TARGET_DIR;
  const values = {
    "--cef-archive": "archive",
    "--cef-sdk": "sdk",
    "--cef-runtime-kind": "runtimeKind",
    "--cef-custom-manifest": "customManifest",
    "--cef-source-lock": "sourceLock",
    "--cef-artifact-root": "artifactRoot",
    "--cef-output": "output",
    "--cef-cargo-target-dir": "cargoTarget",
    "--cef-public-target-dir": "publicTarget",
    "--target": "target",
    "-t": "target",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error(`${arg} requires a value`);
      return args[++i];
    };
    if (arg === "--") {
      options.cargoArgs = args.slice(i + 1);
      break;
    }
    if (Object.hasOwn(values, arg)) {
      const key = values[arg];
      const supplied = value();
      if (
        [
          "runtimeKind",
          "customManifest",
          "sourceLock",
          "artifactRoot",
          "sdk",
          "archive",
        ].includes(key) &&
        options[key] &&
        (key === "runtimeKind"
          ? options[key] !== supplied
          : !sameLocalPath(options[key], supplied))
      )
        throw new Error(
          `Conflicting CEF ${key} flag/environment inputs; no official fallback`,
        );
      options[key] = supplied;
      if (key === "runtimeKind")
        options.officialRuntimeExplicit = supplied === "official";
    } else if (["--config", "-c"].includes(arg)) options.configs.push(value());
    else if (["--features", "-f"].includes(arg))
      options.features.push(
        ...value()
          .split(/[,\s]+/)
          .filter(Boolean),
      );
    else if (arg === "--cef-offline") options.offline = true;
    else if (arg === "--cef-download") {
      options.download = true;
      options.downloadRequested = true;
    } else if (arg === "--cef-no-download") options.download = false;
    else if (arg === "--cef-static") options.dynamic = false;
    else if (arg === "--cef-prepare-only") options.prepareOnly = true;
    else if (arg === "--no-bundle") options.noBundle = true;
    else if (arg === "--debug" || arg === "-d") {
      options.debug = true;
      options.tauriArgs.push(arg);
    } else if (arg === "--release") {
      options.debug = false;
      options.tauriArgs.push(arg);
    } else if (
      arg === "--runner" ||
      arg === "-r" ||
      arg.startsWith("--runner=")
    )
      throw new Error(
        "CEF owns the Cargo runner; an ordinary cargo run cannot launch this app",
      );
    else if (arg.startsWith("--cef-"))
      throw new Error(`Unknown CEF option ${arg}`);
    else options.tauriArgs.push(arg);
  }
  packageManifest(options.target);
  // Cargo-side feature flags affect the SAME app. Promote them before choosing
  // its native dependency closure; never interpret arguments after Cargo's own
  // `--` (those belong to the launched app).
  const cargo = [];
  for (let i = 0; i < options.cargoArgs.length; i++) {
    const arg = options.cargoArgs[i];
    if (arg === "--") {
      cargo.push(...options.cargoArgs.slice(i));
      break;
    }
    if (["--features", "-F"].includes(arg) || arg.startsWith("--features=")) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : options.cargoArgs[++i];
      if (!value || value.startsWith("-"))
        throw new Error("Cargo --features requires a feature list");
      options.features.push(...value.split(/[,\s]+/).filter(Boolean));
    } else if (arg === "--all-features")
      throw new Error(
        "--all-features combines incompatible native linkage; select an explicit feature family",
      );
    else if (/^--(target|target-dir|manifest-path)(=|$)/.test(arg))
      throw new Error(
        "Pass --target or --cef-cargo-target-dir to the driver, not behind the Cargo separator",
      );
    else cargo.push(arg);
  }
  options.cargoArgs = cargo;
  options.offline ||= cargo.includes("--offline") || cargo.includes("--frozen");
  if (options.offline && options.downloadRequested)
    throw new Error("--cef-offline cannot acquire an archive");
  if (options.offline) options.download = false;
  // A deliberately reduced feature build remains an explicit opt-out. Merely
  // forgetting a CEF SDK never selects this route.
  options.cef = !(
    options.features.length &&
    options.cargoArgs.includes("--no-default-features") &&
    !options.features.some(
      (f) => f === "native-browser" || f.startsWith("full"),
    )
  );
  if (!options.cef) {
    if (
      options.runtimeKind === "custom" ||
      options.customManifest ||
      options.sourceLock ||
      options.artifactRoot
    )
      throw new Error(
        "Custom CEF cannot be combined with a browser-disabled feature selection",
      );
    return options;
  }
  if (
    env.SORNG_CEF_SDK &&
    env.CEF_PATH &&
    !sameLocalPath(env.SORNG_CEF_SDK, env.CEF_PATH)
  )
    throw new Error(
      "Conflicting SORNG_CEF_SDK/CEF_PATH inputs; no official fallback",
    );
  // Resolve the ignored target-keyed local registration BEFORE applying kind
  // defaults or custom-input validation. Absence is never implicit stock CEF.
  if (
    (options.runtimeKind ?? "custom") === "custom" &&
    options.downloadRequested
  )
    throw new Error(
      "Custom CEF acquisition uses the reviewed release catalog or browser:runtime:fetch; --cef-download is unavailable",
    );
  if (deferRuntime) return options;
  resolveLocalRuntime(options, selectionFile);
  options.runtimeKind ??= "custom";
  if (options.runtimeKind === "custom") {
    if (!options.customManifest || !options.sourceLock || !options.sdk)
      throw new Error(
        "Custom CEF requires manifest, source lock and SDK; no official fallback",
      );
    options.download = false;
    options.artifactRoot ??= path.dirname(path.resolve(options.customManifest));
  }
  if (!options.features.length)
    options.features.push(mode === "dev" ? "full-dev" : "full");
  const platform = packageManifest(options.target).platform;
  options.features = [
    ...new Set(
      options.features
        .flatMap((feature) =>
          feature === "full" && options.dynamic
            ? [
                platform === "windows"
                  ? "full-windows-dynamic"
                  : "full-unix-dynamic",
              ]
            : [feature],
        )
        .concat("native-browser"),
    ),
  ];
  if (!options.cargoArgs.includes("--no-default-features"))
    options.cargoArgs.unshift("--no-default-features");
  return options;
}

// Back up ONLY the concrete published artifact being replaced. This never
// removes a target directory and never stops a process that has a file open.
export async function backUpPublished(file, plan) {
  const root = await realpath(plan.publicTarget);
  const parent = await realpath(path.dirname(file));
  const relative = path.relative(root, file);
  const parentRelative = path.relative(root, parent);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    parentRelative.startsWith("..") ||
    path.isAbsolute(parentRelative)
  )
    throw new Error("Published artifact escapes the explicit target directory");
  if (!(await exists(file))) return;
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Refusing to replace a non-file published artifact");
  const backup = path.join(plan.root, "previous-output", relative);
  await mkdir(path.dirname(backup), { recursive: true });
  if (await exists(backup))
    throw new Error("Published artifact already backed up during this build");
  await rename(file, backup);
}

async function publish(source, file, plan) {
  await mkdir(path.dirname(file), { recursive: true });
  await backUpPublished(file, plan);
  await copyFile(source, file, constants.COPYFILE_EXCL);
}

function child(command, args, env, cwd = repo) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const processChild = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
      detached: grouped,
    });
    const terminate = (signal) => {
      if (!processChild.pid) return;
      try {
        grouped
          ? process.kill(-processChild.pid, signal)
          : processChild.kill(signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const handlers = ["SIGINT", "SIGTERM"].map((signal) => {
      const handler = () => terminate(signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    // On Unix the Tauri watcher can SIGKILL the native runner. Its still-live
    // Node child observes parent loss and kills only the group it spawned.
    const parent = Number(env.SORNG_CEF_RUNNER_PARENT);
    const orphanWatch =
      grouped && parent > 1
        ? setInterval(() => {
            try {
              process.kill(parent, 0);
            } catch (error) {
              if (error.code === "ESRCH") terminate("SIGKILL");
            }
          }, 250)
        : null;
    orphanWatch?.unref();
    const cleanup = () => {
      if (orphanWatch) clearInterval(orphanWatch);
      for (const [signal, handler] of handlers)
        process.removeListener(signal, handler);
    };
    processChild.once("error", (error) => {
      cleanup();
      reject(error);
    });
    processChild.once("close", (code, signal) => {
      cleanup();
      code === 0
        ? resolve()
        : reject(
            new Error(`${path.basename(command)} exited ${code ?? signal}`),
          );
    });
  });
}

export async function locateArchive(target, options, root = repo) {
  if (options.runtimeKind !== "official" || !options.officialRuntimeExplicit)
    throw new Error(
      "Official archive discovery requires explicit SDK/development selection; no official fallback",
    );
  if (options.archive) return path.resolve(options.archive);
  const name = packageManifest(target).artifact.name;
  const candidates = [
    path.join(root, ".cache/cef", target, name),
    path.join(root, ".artifacts/cef-archives", name),
  ];
  const buildRoot = path.join(root, "src-tauri/target/debug/build");
  if (await exists(buildRoot))
    for (const entry of await readdir(buildRoot)) {
      if (entry.startsWith("cef-dll-sys-"))
        candidates.push(path.join(buildRoot, entry, "out", name));
    }
  for (const candidate of candidates)
    if (await exists(candidate)) return candidate;
  return undefined;
}

async function loadConfiguration(options, env) {
  let config = await json(path.join(tauriDir, "tauri.conf.json"));
  const platform = packageManifest(options.target).platform;
  const platformFile = path.join(tauriDir, `tauri.${platform}.conf.json`);
  if (await exists(platformFile))
    config = mergeConfig(config, await json(platformFile));
  if (env.TAURI_CONFIG)
    config = mergeConfig(config, JSON.parse(env.TAURI_CONFIG));
  for (const entry of options.configs)
    config = mergeConfig(
      config,
      entry.trim().startsWith("{")
        ? JSON.parse(entry)
        : await json(path.resolve(entry)),
    );
  if (config.build?.runner)
    throw new Error(
      "Remove the existing build.runner before using the mandatory CEF runner",
    );
  const resources = config.bundle?.resources;
  if (resources && (Array.isArray(resources) || typeof resources !== "object"))
    throw new Error(
      "CEF driver requires bundle.resources as a source-to-destination map (preserves existing resources)",
    );
  config.mainBinaryName ??=
    platform === "linux" ? "com.sortofremote.ng" : "sortofremoteng";
  packageManifest(options.target, config.mainBinaryName);
  if (!/^[A-Za-z0-9_.-]+$/.test(config.productName))
    throw new Error("CEF launcher requires a portable productName component");
  if (platform === "macos")
    config = mergeConfig(config, {
      bundle: { macOS: { minimumSystemVersion: "14.0" } },
    });
  return config;
}

export function cargoPlan(args, plan) {
  const [verb, ...all] = args;
  if (!["run", "build"].includes(verb))
    throw new Error(`CEF Cargo runner does not support ${verb}`);
  const separator = all.indexOf("--");
  const passed = separator < 0 ? all : all.slice(0, separator);
  const runArgs = separator < 0 ? [] : all.slice(separator + 1);
  const clean = [];
  for (let i = 0; i < passed.length; i++) {
    const arg = passed[i];
    if (
      ["--target", "--target-dir", "--bin", "--manifest-path"].includes(arg)
    ) {
      i++;
      continue;
    }
    if (/^--(target|target-dir|bin|manifest-path)=/.test(arg)) continue;
    // Tauri injects --bins; replace it with our one platform entry below.
    if (arg === "--bins") continue;
    if (["--all-targets", "--examples", "--workspace", "--lib"].includes(arg))
      throw new Error(
        `Unsupported Cargo selection ${arg}; CEF builds only the application`,
      );
    if (arg === "--profile" || arg.startsWith("--profile="))
      throw new Error("CEF driver supports debug/release profiles only");
    clean.push(arg);
  }
  const release = clean.includes("--release");
  const common = [
    "--manifest-path",
    path.join(tauriDir, "Cargo.toml"),
    "--target",
    plan.target,
    "--target-dir",
    plan.cargoTarget,
    "--locked",
    ...(plan.offline ? ["--offline"] : []),
  ];
  return {
    verb,
    runArgs,
    profile: release ? "release" : "debug",
    application: [
      plan.platform === "windows" ? "rustc" : "build",
      ...common,
      ...clean,
      ...(plan.platform === "windows"
        ? ["--lib", "--crate-type", "cdylib"]
        : ["--bin", "app"]),
    ],
    helper: [
      "build",
      ...common,
      ...(release ? ["--release"] : []),
      "-p",
      "sorng-browser-host",
      "--features",
      "cef-host",
      "--bin",
      "sorng-cef-helper",
    ],
  };
}

export function linuxLauncher(appName, productName) {
  packageManifest("x86_64-unknown-linux-gnu", appName);
  if (!/^[A-Za-z0-9_.-]+$/.test(productName))
    throw new Error("Invalid product name");
  return `#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport GDK_BACKEND=x11\nif [ -x "$app_dir/${appName}.bin" ]; then\n  exec "$app_dir/${appName}.bin" "$@"\nfi\nexec "$app_dir/../lib/${productName}/${appName}.bin" "$@"\n`;
}

// Node's errorOnExist also rejects existing directories. Merge only real
// directories; leaf copies still fail rather than replace a file or symlink.
export async function copyTreeExclusive(source, destination) {
  if ((await lstat(source)).isDirectory()) {
    const sourceRoot = await realpath(source);
    // Resolve the nearest existing destination ancestor before creating any
    // directories, so aliases/junctions cannot hide a descendant destination.
    let ancestor = path.resolve(destination);
    const missing = [];
    let destinationRoot;
    for (;;) {
      try {
        destinationRoot = path.join(await realpath(ancestor), ...missing);
        break;
      } catch (error) {
        const parent = path.dirname(ancestor);
        if (error.code !== "ENOENT" || parent === ancestor) throw error;
        missing.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    const relative = path.relative(sourceRoot, destinationRoot);
    if (
      relative === "" ||
      (!path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`))
    )
      throw new Error(
        "Copy destination must not be the source or its descendant",
      );
  }
  // Containment is checked once at the boundary, not for every payload file.
  await copyTreeEntriesExclusive(source, destination);
}

async function copyTreeEntriesExclusive(source, destination) {
  const sourceInfo = await lstat(source);
  if (sourceInfo.isDirectory()) {
    try {
      await mkdir(destination, { mode: sourceInfo.mode });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const destinationInfo = await lstat(destination);
      if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink())
        throw error;
    }
    for (const name of await readdir(source))
      await copyTreeEntriesExclusive(
        path.join(source, name),
        path.join(destination, name),
      );
  } else {
    await cp(source, destination, {
      force: false,
      errorOnExist: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
}

// Expand the resource MAP without dropping native libraries, app locale JSONs,
// OPKSSH or the file-viewer host. CEF locale .pak files coexist with app JSONs.
async function copyResources(resources, destination) {
  for (const [source, relative] of Object.entries(resources ?? {})) {
    if (/[?*\[\]]/.test(source))
      throw new Error(`Dev resource globs require an explicit map: ${source}`);
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
      throw new Error("Resource destination escapes app resources");
    const from = path.resolve(tauriDir, source);
    const to = path.resolve(destination, relative);
    await mkdir(path.dirname(to), { recursive: true });
    await copyTreeExclusive(from, to);
  }
}

async function filesBelow(root, prefix = "") {
  const result = [];
  for (const item of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) result.push(...(await filesBelow(root, relative)));
    else result.push(relative);
  }
  return result;
}

export function bundleConfiguration(config, plan, payloadFiles) {
  const result = structuredClone(config);
  delete result.build.runner;
  const resources = (result.bundle.resources ??= {});
  if (plan.platform === "macos") {
    const mac = (result.bundle.macOS ??= {});
    mac.minimumSystemVersion = "14.0";
    mac.frameworks = [
      ...(mac.frameworks ?? []),
      path.join(plan.payload, "Contents/Frameworks", framework),
    ];
    mac.files ??= {};
    for (const helper of packageManifest(
      plan.target,
      plan.appName,
    ).applicationFiles.filter(
      (file) => file.endsWith("/Info.plist") && file.includes("/Frameworks/"),
    )) {
      const helperPath = path.posix.dirname(path.posix.dirname(helper));
      mac.files[helperPath.slice("Contents/".length)] = path.join(
        plan.payload,
        helperPath,
      );
    }
    for (const filename of ["cef-CREDITS.html", "cef-LICENSE.txt"])
      resources[path.join(plan.payload, "Contents/Resources", filename)] =
        filename;
  } else {
    for (const file of payloadFiles) {
      if (
        file ===
        (plan.platform === "windows" ? `${plan.appName}.exe` : plan.appName)
      )
        continue;
      if (Object.values(resources).includes(file))
        throw new Error(`CEF resource collision: ${file}`);
      resources[path.join(plan.payload, file)] = file;
    }
  }
  return result;
}

export async function stageApplicationPackage(plan, inputs) {
  if (plan.localRuntimeSelection && !plan.customRuntime)
    throw new Error(
      "Selected patched runtime is missing from the build plan; no official fallback",
    );
  if (plan.localRuntimeSelection)
    verifyLocalRuntimeSelection(plan.localRuntimeSelection);
  const report = await (plan.customRuntime
    ? stageCustomRuntimePackage({ ...inputs, plan })
    : stagePackage(inputs));
  if (report.ok && plan.platform === "windows")
    await ensureBrowserSandboxAccess({
      bundle: path.resolve(inputs.output),
      appName: plan.appName,
    });
  return report;
}

export async function loadCustomRuntimeInputs(options) {
  if (options.runtimeKind !== "custom") return null;
  let selected;
  if (options.localRuntimeSelection) {
    selected = verifyLocalRuntimeSelection(options.localRuntimeSelection);
    for (const key of ["customManifest", "sourceLock", "sdk", "artifactRoot"])
      if (!sameLocalPath(options[key], selected.paths[key]))
        throw new Error(
          "Local CEF selection inputs changed before preparation; no official fallback",
        );
  }
  const inputs = {
    // Use the exact reviewed snapshots, not a second unchecked JSON read.
    manifest:
      selected?.manifest ?? (await json(path.resolve(options.customManifest))),
    sourceLock:
      selected?.sourceLock ?? (await json(path.resolve(options.sourceLock))),
    target: options.target,
    artifactRoot: path.resolve(options.artifactRoot),
    sdkRoot: path.resolve(options.sdk),
  };
  const preflight = await preflightCustomRuntime(inputs);
  if (options.localRuntimeSelection)
    verifyLocalRuntimeSelection(options.localRuntimeSelection);
  if (
    options.archive &&
    (await realpath(path.resolve(options.archive))) !== preflight.archivePath
  )
    throw new Error(
      "Explicit custom archive differs from the reviewed manifest",
    );
  return { inputs, preflight };
}

// Every watch rebuild owns a new directory. Stage Windows/Linux directly into
// the Cargo-shaped launch location so the verified runtime is never copied a
// second time. Only its parent exists before the exclusive package stager runs.
export async function applicationPayloadDirectory(plan, commands) {
  if (commands.verb !== "run") return plan.payload;
  const root = await mkdtemp(path.join(plan.root, "dev-"));
  if (plan.platform === "macos") return path.join(root, `${plan.appName}.app`);
  const payload = path.join(root, "target", plan.target, commands.profile);
  await mkdir(path.dirname(payload), { recursive: true });
  return payload;
}

export async function runCargo(
  args,
  environment = process.env,
  { run = child, stage = stageApplicationPackage } = {},
) {
  if (!environment.SORNG_CEF_BUILD_PLAN)
    throw new Error("CEF runner must be started by browser-app-build.mjs");
  const plan = await json(environment.SORNG_CEF_BUILD_PLAN);
  if (
    !plan.customRuntime &&
    (plan.localRuntimeSelection ||
      plan.runtimeKind !== "official" ||
      !plan.officialRuntimeExplicit)
  )
    throw new Error(
      "Build plan has no verified custom runtime or explicit official development selection; no official fallback",
    );
  const commands = cargoPlan(args, plan);
  let env = {
    ...environment,
    CARGO_TARGET_DIR: plan.cargoTarget,
    CEF_PATH: plan.sdk,
  };
  delete env.FLATPAK;
  delete env.NIX_CEF_BINARY;
  if (plan.customRuntime) {
    if (plan.localRuntimeSelection)
      verifyLocalRuntimeSelection(plan.localRuntimeSelection);
    await verifyPreparedCustomRuntime(plan);
    // The pinned download-cef crate otherwise downloads on invalid CEF_PATH.
    // An unsupported scheme fails before networking, even if SDK files change.
    env = customRuntimeEnvironment(env);
  }
  await run("cargo", commands.application, env, tauriDir);
  if (plan.platform !== "windows")
    await run("cargo", commands.helper, env, tauriDir);
  const compiled = path.join(plan.cargoTarget, plan.target, commands.profile);
  if (plan.platform === "windows") {
    const client = path.join(compiled, "app_lib.dll");
    const bytes = await readFile(client);
    // Identify the exact final-link artifact on both success and rejection.
    // The guard stays before any payload staging; never patch a malformed PE.
    console.log(
      `[browser-app-build] Import guard: ${client}; SHA-256 ${createHash("sha256").update(bytes).digest("hex")}`,
    );
    const imports = validateBrowserClientImports(bytes, plan.target);
    const ownership = imports.thunkOwnership;
    console.log(
      `[browser-app-build] Winsock: ${imports.delayedImports} delayed imports; ` +
        `thunk ownership: ${ownership.status} (${ownership.recognizedThunks} recognized)`,
    );
    if (ownership.status !== "recognized-patterns-checked")
      console.warn(
        "[browser-app-build] Import structure passed, but machine-code delay-thunk coverage is incomplete on this target/compiler. Run the full-client network probe; structural checks alone are not runtime proof.",
      );
  }
  // Watch rebuilds get their own retained payload. No broad delete or mutation
  // of an existing launched bundle. A build verb has one fixed bundle source.
  const payload = await applicationPayloadDirectory(plan, commands);
  let appPlist;
  if (plan.platform === "macos") {
    appPlist = path.join(
      path.dirname(payload),
      `${path.basename(payload)}.plist`,
    );
    await run(
      "python3",
      [
        path.join(repo, "scripts/native/browser-app-plist.py"),
        plan.configFile,
        appPlist,
        tauriDir,
      ],
      env,
    );
  }
  const stageInputs = {
    target: plan.target,
    archivePath: plan.archive,
    application: path.join(
      compiled,
      plan.platform === "windows" ? "app_lib.dll" : "app",
    ),
    helper: path.join(compiled, "sorng-cef-helper"),
    output: payload,
    appName: plan.appName,
    appPlist,
  };
  const report = await stage(plan, stageInputs);
  if (!report.ok) throw new Error("CEF package verification failed");
  const output = path.join(plan.publicTarget, plan.target, commands.profile);
  await mkdir(output, { recursive: true });
  // Tauri's build step renames app[.exe] to mainBinaryName after the runner
  // returns. Publish only the bootstrap/launcher, never a Windows Cargo EXE.
  if (commands.verb === "build") {
    const entry = path.join(
      output,
      plan.platform === "windows" ? "app.exe" : "app",
    );
    const finalEntry = path.join(
      output,
      `${plan.appName}${plan.platform === "windows" ? ".exe" : ""}`,
    );
    if (finalEntry !== entry) await backUpPublished(finalEntry, plan);
    if (plan.platform === "windows")
      await publish(path.join(payload, `${plan.appName}.exe`), entry, plan);
    else if (plan.platform === "linux") {
      await backUpPublished(entry, plan);
      await writeFile(entry, linuxLauncher(plan.appName, plan.productName), {
        flag: "wx",
        mode: 0o755,
      });
    } else
      await publish(
        path.join(payload, `Contents/MacOS/${plan.appName}`),
        entry,
        plan,
      );
    await save(path.join(plan.root, "package.json"), report);
    return { output, payload, productionReady: false };
  }
  const config = await json(plan.configFile);
  let executable;
  if (plan.platform === "macos") {
    await copyResources(
      config.bundle.resources,
      path.join(payload, "Contents/Resources"),
    );
    for (const library of config.bundle.macOS?.frameworks ?? [])
      await cp(
        path.resolve(tauriDir, library),
        path.join(payload, "Contents/Frameworks", path.basename(library)),
        { recursive: true, errorOnExist: true, force: false },
      );
    executable = path.join(payload, `Contents/MacOS/${plan.appName}`);
  } else {
    // Unique target directory plus .cargo-lock lets Tauri resolve dev resources
    // beside the real Linux executable, not a production /usr/lib directory.
    await writeFile(path.join(payload, ".cargo-lock"), "", { flag: "wx" });
    await copyResources(config.bundle.resources, payload);
    executable = path.join(
      payload,
      `${plan.appName}${plan.platform === "windows" ? ".exe" : ""}`,
    );
  }
  if (plan.platform === "windows")
    await ensureBrowserSandboxAccess({
      bundle: path.dirname(executable),
      appName: plan.appName,
    });
  await run(
    executable,
    commands.runArgs,
    { ...env, GDK_BACKEND: "x11" },
    path.dirname(executable),
  );
  return { payload, productionReady: false };
}

export function validateBuildHost(
  options,
  platform = process.platform,
  arch = process.arch,
) {
  if (!options.cef) return;
  const targetPlatform = packageManifest(options.target).platform;
  const hostPlatform = { win32: "windows", linux: "linux", darwin: "macos" }[
    platform
  ];
  if (
    targetPlatform !== hostPlatform ||
    (options.mode === "dev" && options.target !== hostTarget(platform, arch))
  )
    throw new Error(
      "CEF requires the matching host OS; dev additionally requires native architecture. Architecture cross-builds are build-only and never runtime evidence.",
    );
}

export async function prepare(options, environment = process.env) {
  if (
    options.runtimeKind !== "custom" &&
    !(options.runtimeKind === "official" && options.officialRuntimeExplicit)
  )
    throw new Error(
      "A reviewed patched runtime selection is required; no official fallback",
    );
  validateBuildHost({ ...options, cef: true });
  const devReuse = reuseDevInputs(options);
  const devCacheRoot = path.join(repo, ".cache/cef-dev");
  const manifest = packageManifest(options.target);
  const custom = await loadCustomRuntimeInputs(options);
  const customInputs = custom?.inputs;
  const customPreflight = custom?.preflight;
  let archive =
    customPreflight?.archivePath ??
    (await locateArchive(options.target, options));
  if (!archive && !options.download)
    throw new Error(
      `Pinned CEF archive missing. Set SORNG_CEF_ARCHIVE/--cef-archive to ${manifest.artifact.name}, or deliberately acquire it with --cef-download. SDK-only builds cannot attest packaged runtime provenance.`,
    );
  if (archive && !customInputs) {
    const check = await verifyArtifact(archive, manifest.artifact);
    if (!check.ok)
      throw new Error(
        `Pinned CEF archive rejected: ${check.errors.join("; ")}`,
      );
  }
  const parent = path.join(repo, ".artifacts/browser-app");
  await mkdir(parent, { recursive: true });
  const root = options.output
    ? path.resolve(options.output)
    : await mkdtemp(path.join(parent, `${options.target}-`));
  if (options.output) await mkdir(root, { recursive: false });
  if (!archive) {
    archive = path.join(
      repo,
      ".cache/cef",
      options.target,
      manifest.artifact.name,
    );
    console.error(
      `[browser-app-build] acquiring pinned CEF ${manifest.artifact.name} into the reusable local cache`,
    );
    await downloadArchive({ target: options.target, output: archive });
  }
  let sdk = options.sdk && path.resolve(options.sdk);
  let customRuntime;
  if (customInputs) {
    ({ sdk, customRuntime } = devReuse
      ? await prepareDevSdkCache({
          inputs: customInputs,
          preflight: customPreflight,
          cacheRoot: devCacheRoot,
        })
      : await prepareCustomRuntime({
          ...customInputs,
          output: path.join(root, "sdk"),
        }));
  } else if (sdk) {
    const inspected = await inspectRuntime(sdk, options.target);
    if (!inspected.ok)
      throw new Error(`CEF SDK rejected: ${inspected.errors.join("; ")}`);
  } else
    sdk = (
      await extractRuntime({
        target: options.target,
        archivePath: archive,
        output: path.join(root, "sdk"),
      })
    ).runtime;
  let config = await loadConfiguration(options, environment);
  let env = buildNativeChildEnvironment({
    baseEnv: environment,
    argv: ["--target", options.target],
  });
  if (options.nativePrepared) {
    const names = Object.values(config.bundle.resources ?? {});
    const required =
      manifest.platform === "windows"
        ? runtimeDllsForArchitecture(
            options.target.startsWith("aarch64") ? "arm64" : "x64",
          )
        : [];
    if (required.some((name) => !names.includes(name)))
      throw new Error(
        "Pre-staged Windows native closure is missing from the merged Tauri resource map",
      );
  } else if (
    options.features.some(
      (f) => f === "full-windows-dynamic" || f === "full-unix-dynamic",
    )
  ) {
    if (options.offline)
      throw new Error(
        "Offline dynamic-native preparation is not implemented by the existing vcpkg stager. Use --cef-static with a populated Cargo cache, or prepare the native dependency environment explicitly and pass its exact feature list.",
      );
    const native = (
      manifest.platform === "windows"
        ? stageWindowsNativeRuntime
        : stageOpenH264Runtime
    )({
      target: options.target,
      stageRoot: path.join(root, "native"),
      licenseStageRoot: path.join(root, "native-licenses"),
    });
    Object.assign(env, native.environment);
    config.bundle.resources ??= {};
    config.bundle.resources[path.join(root, "native-licenses")] =
      "native-runtime-licenses";
    for (const file of native.files) {
      if (manifest.platform === "macos") {
        config.bundle.macOS ??= {};
        (config.bundle.macOS.frameworks ??= []).push(
          path.join(root, "native", file),
        );
      } else config.bundle.resources[path.join(root, "native", file)] = file;
    }
  }
  const runnerSource = path.join(
    repo,
    "scripts/native/browser-cargo-runner.rs",
  );
  const runner = devReuse
    ? await prepareDevRunnerCache({
        cacheRoot: devCacheRoot,
        source: runnerSource,
        compilerIdentity: (
          await promisify(execFile)("rustc", ["--version", "--verbose"], {
            env,
            cwd: repo,
            windowsHide: true,
          })
        ).stdout.trim(),
        env: { ...env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
      })
    : path.join(
        root,
        `cef-cargo-runner${process.platform === "win32" ? ".exe" : ""}`,
      );
  const plan = {
    root,
    target: options.target,
    runtimeKind: options.runtimeKind,
    officialRuntimeExplicit: options.officialRuntimeExplicit,
    platform: manifest.platform,
    archive,
    sdk,
    ...(customRuntime ? { customRuntime } : {}),
    ...(options.localRuntimeSelection
      ? { localRuntimeSelection: options.localRuntimeSelection }
      : {}),
    appName: config.mainBinaryName,
    productName: config.productName,
    publicTarget: path.resolve(
      options.publicTarget ?? path.join(tauriDir, "target"),
    ),
    cargoTarget: path.resolve(
      options.cargoTarget ?? path.join(repo, ".cache/cef-target"),
    ),
    payload: path.join(root, "payload"),
    configFile: path.join(root, "build-config.json"),
    offline: options.offline,
  };
  if (plan.publicTarget === plan.cargoTarget)
    throw new Error(
      "CEF raw Cargo cache must differ from public target directory; this prevents reusing a published launcher as a compiled binary",
    );
  if (devReuse) config = stableDevConfiguration(config, runner);
  else config.build.runner = { cmd: runner };
  await save(plan.configFile, config);
  const planFile = path.join(root, "plan.json");
  await save(planFile, plan);
  Object.assign(env, {
    CEF_PATH: sdk,
    CARGO_TARGET_DIR: plan.publicTarget,
    SORNG_CEF_BUILD_PLAN: planFile,
    SORNG_CEF_NODE: process.execPath,
    SORNG_CEF_DRIVER: driver,
    MACOSX_DEPLOYMENT_TARGET: "14.0",
    GDK_BACKEND: "x11",
  });
  delete env.FLATPAK;
  delete env.NIX_CEF_BINARY;
  if (customRuntime) env = customRuntimeEnvironment(env);
  // Each app/helper requires executable-relative CEF library lookup on Linux.
  if (manifest.platform === "linux")
    env.CARGO_ENCODED_RUSTFLAGS = [
      ...(env.CARGO_ENCODED_RUSTFLAGS
        ? env.CARGO_ENCODED_RUSTFLAGS.split("\x1f")
        : (env.RUSTFLAGS ?? "").split(/\s+/).filter(Boolean)),
      "-C",
      "link-arg=-Wl,-rpath,$ORIGIN",
    ].join("\x1f");
  if (options.offline) env.CARGO_NET_OFFLINE = "true";
  if (!devReuse)
    await child("rustc", ["--edition=2021", runnerSource, "-o", runner], env);
  return { plan, config, env };
}

export async function main(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  if (argv[0] === "__cargo") return runCargo(argv.slice(1), environment);
  const separator = argv.indexOf("--");
  if (
    (separator < 0 ? argv : argv.slice(0, separator)).some((arg) =>
      ["--help", "-h", "--version", "-V"].includes(arg),
    )
  )
    return child(process.execPath, [cli, ...argv], environment);
  const acquisition = parseArguments(argv, environment, { deferRuntime: true });
  validateBuildHost(acquisition);
  await ensurePublishedRuntime(acquisition);
  const options = parseArguments(argv, environment);
  if (!options.cef) {
    const passthrough = [
      options.mode,
      "--target",
      options.target,
      "--features",
      options.features.join(","),
      ...options.configs.flatMap((value) => ["--config", value]),
      ...options.tauriArgs,
      ...(options.noBundle ? ["--no-bundle"] : []),
      "--",
      ...options.cargoArgs,
    ];
    return child(
      process.execPath,
      [cli, ...passthrough],
      buildNativeChildEnvironment({ baseEnv: environment }),
    );
  }
  const { plan, config, env } = await prepare(options, environment);
  if (options.prepareOnly)
    return {
      plan: path.join(plan.root, "plan.json"),
      config: plan.configFile,
      productionReady: false,
    };
  // Tauri owns pre-build/dev hooks, frontend wait, Rust watcher and config env.
  // Build-only first: resources below are added after the verified native stage.
  const cliArgs = [
    options.mode,
    "--config",
    plan.configFile,
    "--target",
    plan.target,
    "--features",
    options.features.join(","),
    ...options.tauriArgs,
    ...(options.mode === "build" ? ["--no-bundle"] : []),
    "--",
    ...options.cargoArgs,
  ];
  await child(process.execPath, [cli, ...cliArgs], env);
  if (options.mode === "dev") return;
  const report = await json(path.join(plan.root, "package.json"));
  if (plan.customRuntime) {
    if (plan.localRuntimeSelection)
      verifyLocalRuntimeSelection(plan.localRuntimeSelection);
    await verifyPreparedCustomRuntime(plan);
  }
  const inspection = await inspectBundle(
    plan.payload,
    report.staging.runtime,
    plan.target,
    plan.appName,
  );
  if (!inspection.ok)
    throw new Error(
      `Pre-bundle CEF gate failed: ${inspection.errors.join("; ")}`,
    );
  const payloadFiles = await filesBelow(plan.payload);
  const bundleConfig = bundleConfiguration(config, plan, payloadFiles);
  const bundleFile = path.join(plan.root, "bundle-config.json");
  await save(bundleFile, bundleConfig);
  const output = path.join(
    plan.publicTarget,
    plan.target,
    options.debug ? "debug" : "release",
  );
  // An unpacked Windows build must also be directly runnable via its bootstrap.
  if (plan.platform !== "macos") {
    for (const file of payloadFiles) {
      if (
        file ===
        (plan.platform === "windows" ? `${plan.appName}.exe` : plan.appName)
      )
        continue;
      await mkdir(path.dirname(path.join(output, file)), { recursive: true });
      await publish(
        path.join(plan.payload, file),
        path.join(output, file),
        plan,
      );
    }
    if (
      plan.platform === "linux" &&
      !(await exists(path.join(output, ".cargo-lock")))
    )
      await writeFile(path.join(output, ".cargo-lock"), "", { flag: "wx" });
    const resources = path.join(plan.root, "app-resources");
    await mkdir(resources);
    await copyResources(config.bundle.resources, resources);
    for (const file of await filesBelow(resources))
      await publish(path.join(resources, file), path.join(output, file), plan);
    const published = await inspectBundle(
      output,
      report.staging.runtime,
      plan.target,
      plan.appName,
    );
    if (!published.ok)
      throw new Error(
        `Published CEF closure failed: ${published.errors.join("; ")}`,
      );
    if (plan.platform === "windows")
      await ensureBrowserSandboxAccess({
        bundle: output,
        appName: plan.appName,
      });
  } else if (options.noBundle) {
    await copyResources(
      config.bundle.resources,
      path.join(plan.payload, "Contents/Resources"),
    );
    for (const library of config.bundle.macOS?.frameworks ?? [])
      await cp(
        path.resolve(tauriDir, library),
        path.join(plan.payload, "Contents/Frameworks", path.basename(library)),
        { recursive: true, errorOnExist: true, force: false },
      );
  }
  let installerClientsManifest;
  if (!options.noBundle) {
    // Filter build-only arguments. Tauri performs final signing/notarization;
    // no --no-sign or weakened entitlements are injected by this driver.
    if (plan.platform === "windows") {
      const prepared = await prepareWindowsInstallerBundles({
        plan,
        bundleConfig,
        options,
      });
      installerClientsManifest = prepared.reportPath;
      // Warnings remain visible. The pinned bootstrap intentionally contains no
      // Tauri marker; each installer now embeds the marker-bearing client DLL.
      for (const installer of prepared.installers)
        await child(process.execPath, [cli, ...installer.args], env);
    } else {
      await child(
        process.execPath,
        [
          cli,
          ...bundleArguments({
            plan,
            configFile: bundleFile,
            options,
          }),
        ],
        env,
      );
    }
  }
  const result = {
    output,
    bundleConfig: bundleFile,
    ...(installerClientsManifest ? { installerClientsManifest } : {}),
    target: plan.target,
    productionReady: false,
    admission: "unchanged",
    sandboxExecution: "not-tested",
    packageReport: path.join(plan.root, "package.json"),
    replacedArtifactsBackup: path.join(plan.root, "previous-output"),
  };
  await save(path.join(plan.root, "build.json"), result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === driver)
  main()
    .then((result) => {
      if (result) console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(`[browser-app-build] ${error.stack ?? error}`);
      process.exitCode = 1;
    });
