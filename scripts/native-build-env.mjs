#!/usr/bin/env node
// Runs a command with native Windows build helpers first on PATH.
//
// `openssl-src` rejects Cygwin/MSYS Perl when building MSVC targets. Several
// Rust crates in this workspace intentionally use vendored OpenSSL on Windows,
// so local npm scripts need to prefer Strawberry Perl when it is installed.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  rustTargetFromArgs,
  stageWindowsNativeRuntime,
  writeWindowsNativeTauriConfig,
} from "./stage-windows-native-runtime.mjs";
import {
  stageOpenH264Runtime,
  writeOpenH264NativeTauriConfig,
} from "./stage-openh264-runtime.mjs";

const rawArgs = process.argv.slice(2);
const useDynamicNativeRuntime = rawArgs.some((argument) =>
  ["--dynamic-native-runtime", "--windows-dynamic-runtime"].includes(argument),
);
const args = rawArgs.filter(
  (argument) =>
    argument !== "--dynamic-native-runtime" &&
    argument !== "--windows-dynamic-runtime",
);
const executableName = args[0]?.toLowerCase().replace(/\.exe$/u, "");

if (args.length === 0) {
  console.error("usage: native-build-env <command> [args...]");
  process.exit(2);
}

function nativeWindowsPathPrefix() {
  if (process.platform !== "win32") return [];

  const candidates = ["C:\\Strawberry\\perl\\bin", "C:\\Strawberry\\c\\bin"];

  return candidates.filter((entry) => existsSync(entry));
}

const env = { ...process.env };
const prefix = nativeWindowsPathPrefix();
if (prefix.length > 0) {
  const existingPath = env.Path ?? env.PATH ?? "";
  env.PATH = `${prefix.join(";")};${existingPath}`;
  env.Path = env.PATH;
}

function selectDynamicFeatureSet(featureSet) {
  const featuresIndex = args.indexOf("--features");
  if (featuresIndex < 0 || args[featuresIndex + 1] !== "full") {
    console.error(
      "[native-build-env] --dynamic-native-runtime requires `--features full`",
    );
    process.exit(2);
  }
  args[featuresIndex + 1] = featureSet;
}

function addTauriConfig(configPath) {
  if (executableName !== "tauri" || args[1] !== "build") return;
  const cargoArgumentsIndex = args.indexOf("--");
  const insertAt = cargoArgumentsIndex >= 0 ? cargoArgumentsIndex : args.length;
  args.splice(insertAt, 0, "--config", configPath);
}

if (useDynamicNativeRuntime && process.platform === "win32") {
  const nativeRuntime = stageWindowsNativeRuntime({
    target: rustTargetFromArgs(args, env),
  });
  Object.assign(env, nativeRuntime.environment);
  env.Path = env.PATH;
  if (prefix.length > 0) {
    env.PATH = `${prefix.join(";")};${env.PATH}`;
    env.Path = env.PATH;
  }

  selectDynamicFeatureSet("full-windows-dynamic");
  addTauriConfig(writeWindowsNativeTauriConfig(undefined, nativeRuntime.files));
}

if (
  useDynamicNativeRuntime &&
  (process.platform === "linux" || process.platform === "darwin")
) {
  const openh264Runtime = stageOpenH264Runtime({
    target: rustTargetFromArgs(args, env),
  });
  Object.assign(env, openh264Runtime.environment);
  selectDynamicFeatureSet("full-unix-dynamic");
  addTauriConfig(
    writeOpenH264NativeTauriConfig(process.platform, openh264Runtime.files[0]),
  );
}

let executable = args[0];
let executableArguments = args.slice(1);
if (executableName === "tauri") {
  const tauriCli = fileURLToPath(
    new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
  );
  if (!existsSync(tauriCli)) {
    console.error(`[native-build-env] local Tauri CLI is missing: ${tauriCli}`);
    process.exit(1);
  }
  executable = process.execPath;
  executableArguments = [tauriCli, ...executableArguments];
}

const child = spawn(executable, executableArguments, {
  stdio: "inherit",
  shell: false,
  env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error(`[native-build-env] failed to run ${args[0]}: ${err.message}`);
  process.exit(1);
});
