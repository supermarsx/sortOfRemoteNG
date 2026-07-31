#!/usr/bin/env node
// Import-safe Next.js development launcher. Standalone browser development may
// climb to a free port. Tauri-managed development is fixed to the port already
// present in Tauri's devUrl and fails closed if that port cannot be bound.

import { spawn } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoManagedDevLock,
  resolveDevPort,
  DEFAULT_PORT,
} from "./dev-port.mjs";

export function resolveBundlerFlag(value) {
  switch (value.trim().toLowerCase()) {
    case "turbo":
    case "turbopack":
      return { label: "Turbopack", flag: "--turbopack" };
    case "webpack":
    case "":
      return { label: "Webpack", flag: "--webpack" };
    default:
      return { label: "Turbopack", flag: "--turbopack", usedFallback: true };
  }
}

export async function resolveDevServerPlan({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  isPortFreeFn,
  assertNoManagedDevLockFn = assertNoManagedDevLock,
  log = () => {},
} = {}) {
  const checkOnly = argv.includes("--check");
  const fixed =
    argv.includes("--fixed-tauri-port") || env.SORNG_DEV_PORT_RESOLVED === "1";

  if (fixed) {
    assertNoManagedDevLockFn({ cwd });
  }

  const result = await resolveDevPort({
    preferred: env.SORNG_DEV_PORT ?? DEFAULT_PORT,
    fixed,
    isPortFreeFn,
    log,
  });
  const bundlerValue =
    env.SORNG_NEXT_DEV_BUNDLER ?? env.SORNG_DEV_BUNDLER ?? "turbopack";
  const bundler = resolveBundlerFlag(bundlerValue);
  const childEnv = { ...env, PORT: String(result.port) };

  if (fixed) {
    childEnv.SORNG_TAURI_MANAGED_DEV = "1";
  } else {
    delete childEnv.SORNG_TAURI_MANAGED_DEV;
  }

  return {
    ...result,
    fixed,
    checkOnly,
    bundler,
    childEnv,
  };
}

export async function main() {
  const log = (message) => console.log(`[dev-server] ${message}`);
  const plan = await resolveDevServerPlan({ log });

  if (plan.bundler.usedFallback) {
    const configured =
      process.env.SORNG_NEXT_DEV_BUNDLER ?? process.env.SORNG_DEV_BUNDLER ?? "";
    log(
      `unknown development bundler ${JSON.stringify(configured)}; ` +
        "falling back to Turbopack",
    );
  }

  if (plan.fixed) {
    log(`using fixed Tauri devUrl port ${plan.port}`);
  }

  if (plan.checkOnly) {
    console.log(JSON.stringify({ port: plan.port, fixed: plan.fixed }));
    return;
  }

  log(`starting Next.js dev server with ${plan.bundler.label}`);
  const child = spawn(
    process.execPath,
    [
      "./node_modules/next/dist/bin/next",
      "dev",
      plan.bundler.flag,
      "--port",
      String(plan.port),
    ],
    { stdio: "inherit", env: plan.childEnv, shell: false },
  );

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(
      `[dev-server] failed to launch Next.js: ${error?.stack || error}`,
    );
    process.exit(1);
  });
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`[dev-server] fatal: ${error?.stack || error}`);
    process.exit(1);
  });
}
