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
import { stageVendorArtifact } from "./stage-opkssh-vendor.mjs";
import { stageFileViewerHost } from "./stage-file-viewer-host.mjs";
import { buildNativeChildEnvironment } from "./lib/native-child-env.mjs";
import {
  describeDevBuildResources,
  planDevBuildResources,
} from "./lib/dev-build-budget.mjs";

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
  nativeEnvironmentOptions,
  buildResourceOptions,
} = {}) {
  const port = parseDevPort(portValue);
  const devUrl = `http://localhost:${port}`;
  const security = securityOverride ?? buildDevSecurityOverride(port);
  const override = {
    build: { devUrl },
    app: { security },
  };
  const buildResources = planDevBuildResources({
    ...buildResourceOptions,
    argv: passthrough,
    baseEnv,
  });

  return {
    port,
    devUrl,
    buildResources,
    env: {
      ...buildNativeChildEnvironment({
        ...nativeEnvironmentOptions,
        baseEnv,
        argv: passthrough,
      }),
      ...buildResources.environment,
      SORNG_DEV_PORT: String(port),
      SORNG_DEV_PORT_RESOLVED: "1",
      SORNG_TAURI_MANAGED_DEV: "1",
    },
    tauriArgs: ["dev", "-c", JSON.stringify(override), ...passthrough],
  };
}

export function prepareTauriDevOpkssh(
  passthrough,
  env,
  log,
  stage = stageVendorArtifact,
) {
  return stage({
    argv: passthrough.filter(
      (arg, index) =>
        arg === "--target" ||
        passthrough[index - 1] === "--target" ||
        arg.startsWith("--target="),
    ),
    env,
    log,
  });
}

export async function main(
  passthrough = process.argv.slice(2),
  dependencies = {},
) {
  const host = dependencies.process ?? process;
  const baseEnv = dependencies.env ?? host.env;
  const log =
    dependencies.log ?? ((message) => console.log(`[tauri-dev] ${message}`));
  const preferred = parseDevPort(
    baseEnv.SORNG_DEV_PORT ?? DEFAULT_PORT,
    "SORNG_DEV_PORT",
  );

  (dependencies.assertNoManagedDevLock ?? assertNoManagedDevLock)();
  const selected = await (dependencies.resolveDevPort ?? resolveDevPort)({
    preferred,
    fixed: false,
    log,
  });
  const plan = buildTauriLaunchPlan({
    port: selected.port,
    passthrough,
    baseEnv,
    nativeEnvironmentOptions: dependencies.nativeEnvironmentOptions,
    buildResourceOptions: dependencies.buildResourceOptions,
  });

  log(`dev server will use port ${plan.port} (${selected.action})`);
  log(`pinning Tauri devUrl and capability origin -> ${plan.devUrl}`);
  log(describeDevBuildResources(plan.buildResources));
  log(
    "Cargo defaults include all supported features; reduced builds require --no-default-features. Native services still require their documented drivers/tools.",
  );
  log(
    "Checking the embedded OPKSSH runtime before native launch; explicit CLI-only opt-out uses SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE=1.",
  );
  (dependencies.prepareTauriDevOpkssh ?? prepareTauriDevOpkssh)(
    passthrough,
    plan.env,
    log,
  );
  (dependencies.stageFileViewerHost ?? stageFileViewerHost)({
    argv: passthrough,
    env: plan.env,
    log,
  });

  const tauriBin = require.resolve("@tauri-apps/cli/tauri.js");
  const child = (dependencies.spawn ?? spawn)(
    host.execPath,
    [tauriBin, ...plan.tauriArgs],
    {
      stdio: "inherit",
      env: plan.env,
      shell: false,
    },
  );

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  host.on("SIGINT", () => forward("SIGINT"));
  host.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) host.kill(host.pid, signal);
    else host.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(
      `[tauri-dev] failed to launch Tauri: ${error?.stack || error}`,
    );
    host.exit(1);
  });
  return child;
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
