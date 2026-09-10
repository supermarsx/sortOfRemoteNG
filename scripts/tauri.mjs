#!/usr/bin/env node
// Keep `npm run tauri dev` on the same managed, full-feature path as tauri:dev.
// Other CLI commands retain their arguments and the CLI's exit/signal behavior.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as managedDev } from "./tauri-dev.mjs";

export function routeTauriArguments(args) {
  return args[0] === "dev"
    ? { managed: true, args: args.slice(1) }
    : { managed: false, args: [...args] };
}

export async function main(args = process.argv.slice(2)) {
  const route = routeTauriArguments(args);
  if (route.managed) return managedDev(route.args);
  const cli = createRequire(import.meta.url).resolve(
    "@tauri-apps/cli/tauri.js",
  );
  const child = spawn(process.execPath, [cli, ...route.args], {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  child.on("error", (error) => {
    console.error(`[tauri] ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[tauri] ${error.message}`);
    process.exit(1);
  });
}
