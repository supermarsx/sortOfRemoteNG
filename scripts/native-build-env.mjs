#!/usr/bin/env node
// Runs a command with native Windows build helpers first on PATH.
//
// `openssl-src` rejects Cygwin/MSYS Perl when building MSVC targets. Several
// Rust crates in this workspace intentionally use vendored OpenSSL on Windows,
// so local npm scripts need to prefer Strawberry Perl when it is installed.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);

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

const child = spawn(args[0], args.slice(1), {
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
