#!/usr/bin/env node
// Keep `npm run tauri dev` on the same managed, full-feature path as tauri:dev.
// Other CLI commands retain their arguments and the CLI's exit/signal behavior.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as managedDev } from "./tauri-dev.mjs";
import { requiresBrowserBuildDriver } from "./lib/browser-build-route.mjs";

export function routeTauriArguments(args) {
  return args[0] === "dev"
    ? { managed: true, args: args.slice(1) }
    : { managed: false, args: [...args] };
}

export async function main(args = process.argv.slice(2), managedDependencies) {
  const route = routeTauriArguments(args);
  if (route.managed) return managedDev(route.args, managedDependencies);
  const host = managedDependencies?.process ?? process;
  const cli =
    route.args[0] === "build" && requiresBrowserBuildDriver(route.args)
      ? fileURLToPath(new URL("./browser-app-build.mjs", import.meta.url))
      : createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
  const child = (managedDependencies?.spawn ?? spawn)(
    host.execPath,
    [cli, ...route.args],
    {
      stdio: "inherit",
      shell: false,
      env: managedDependencies?.env ?? host.env,
      windowsHide: true,
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    host.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  child.on("error", (error) => {
    console.error(`[tauri] ${error.message}`);
    host.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) host.kill(host.pid, signal);
    else host.exit(code ?? 0);
  });
  return child;
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
