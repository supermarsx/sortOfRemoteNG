#!/usr/bin/env node
// Runs a command with native Windows build helpers first on PATH.
//
// Preserve optional vendored/native toolchain support without requiring OpenSSL
// for Windows builds. If a vendored MSVC build is selected, `openssl-src` rejects
// Cygwin/MSYS Perl; prefer installed Strawberry Perl and normalize only explicitly
// configured OpenSSL library directories, exclusively in the child environment.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  buildNativeChildEnvironment,
  nativeWindowsPathPrefix,
} from "./lib/native-child-env.mjs";
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

const env = buildNativeChildEnvironment({ argv: args });
const prefix = nativeWindowsPathPrefix();

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
