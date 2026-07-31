#!/usr/bin/env node
// Import-safe Tauri development orchestrator. It selects a free port before
// Tauri starts, pins devUrl and the development capability origin to that port,
// and marks the beforeDev launch as fixed so it can never silently diverge.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertNoManagedDevLock,
  parseDevPort,
  resolveDevPort,
  DEFAULT_PORT,
} from "./dev-port.mjs";

const require = createRequire(import.meta.url);
const tauriConfigPath = fileURLToPath(
  new URL("../src-tauri/tauri.conf.json", import.meta.url),
);
const defaultCapabilityPath = fileURLToPath(
  new URL("../src-tauri/capabilities/default.json", import.meta.url),
);

export function buildDevSecurityOverride(portValue) {
  const port = parseDevPort(portValue);
  const { $schema: _schema, ...capability } = JSON.parse(
    readFileSync(defaultCapabilityPath, "utf8"),
  );
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const productionCsp = tauriConfig?.app?.security?.csp;
  if (
    typeof productionCsp !== "string" ||
    !productionCsp.includes("connect-src")
  ) {
    throw new Error("tauri.conf.json must define a connect-src CSP directive");
  }

  const httpOrigin = `http://localhost:${port}`;
  const websocketOrigin = `ws://localhost:${port}`;
  const devCsp = productionCsp.replace(
    /connect-src\s+([^;]*)/,
    (_directive, sources) =>
      `connect-src ${sources.trim()} ${httpOrigin} ${websocketOrigin}`,
  );

  return {
    capabilities: [
      {
        ...capability,
        remote: { urls: [httpOrigin] },
      },
    ],
    csp: devCsp,
  };
}

export function buildTauriLaunchPlan({
  port: portValue,
  passthrough = [],
  baseEnv = process.env,
  securityOverride,
} = {}) {
  const port = parseDevPort(portValue);
  const devUrl = `http://localhost:${port}`;
  const security = securityOverride ?? buildDevSecurityOverride(port);
  const override = {
    build: { devUrl },
    app: { security },
  };

  return {
    port,
    devUrl,
    env: {
      ...baseEnv,
      SORNG_DEV_PORT: String(port),
      SORNG_DEV_PORT_RESOLVED: "1",
      SORNG_TAURI_MANAGED_DEV: "1",
    },
    tauriArgs: ["dev", "-c", JSON.stringify(override), ...passthrough],
  };
}

export async function main() {
  const passthrough = process.argv.slice(2);
  const log = (message) => console.log(`[tauri-dev] ${message}`);
  const preferred = parseDevPort(
    process.env.SORNG_DEV_PORT ?? DEFAULT_PORT,
    "SORNG_DEV_PORT",
  );

  assertNoManagedDevLock();
  const selected = await resolveDevPort({
    preferred,
    fixed: false,
    log,
  });
  const plan = buildTauriLaunchPlan({
    port: selected.port,
    passthrough,
  });

  log(`dev server will use port ${plan.port} (${selected.action})`);
  log(`pinning Tauri devUrl and capability origin -> ${plan.devUrl}`);

  const tauriBin = require.resolve("@tauri-apps/cli/tauri.js");
  const child = spawn(process.execPath, [tauriBin, ...plan.tauriArgs], {
    stdio: "inherit",
    env: plan.env,
    shell: false,
  });

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
      `[tauri-dev] failed to launch Tauri: ${error?.stack || error}`,
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
    console.error(`[tauri-dev] fatal: ${error?.stack || error}`);
    process.exit(1);
  });
}
