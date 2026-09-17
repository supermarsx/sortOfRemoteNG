import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { Options } from "@wdio/types";
import {
  E2E_IDENTIFIER,
  resolveRunProfile,
  webview2Launch,
} from "../scripts/lib/e2e-profile-isolation.mjs";
import TauriDriverService from "./helpers/tauri-service";
import { resolveDriverPorts } from "./helpers/driver-ports";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Allocated once per run and published to the environment, so the WDIO workers
// (which re-parse this file in their own processes) reuse the launcher's port
// instead of allocating a different one.
const { driverPort: tauriDriverPort } = resolveDriverPorts();
// The per-run WebView2 folder follows the same publish-once pattern, so every
// worker launches the app with the folder the launcher's preflight verified.
const runProfile = resolveRunProfile({ identifier: E2E_IDENTIFIER });
const connectionRetryTimeout = Number.parseInt(
  process.env.WDIO_CONNECTION_RETRY_TIMEOUT ?? "120000",
  10,
);

const configuredTauriBinary = process.env.TAURI_BINARY_PATH?.trim();
if (!configuredTauriBinary) {
  throw new Error(
    "TAURI_BINARY_PATH is required so desktop E2E cannot silently run against a stale binary.",
  );
}
const configuredTauriBinaryPath = path.resolve(configuredTauriBinary);

if (!fs.existsSync(configuredTauriBinaryPath)) {
  throw new Error(
    `TAURI_BINARY_PATH does not point to an existing application: ${configuredTauriBinaryPath}`,
  );
}

export const config = {
  runner: "local",
  logLevel: "warn",
  hostname: "127.0.0.1",
  port: tauriDriverPort,
  path: "/",
  autoCompileOpts: {
    tsNodeOpts: {
      project: path.resolve(__dirname, "./tsconfig.json"),
    },
  },

  specs: ["./specs/**/*.spec.ts"],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      "tauri:options": {
        application: configuredTauriBinaryPath,
        args: webview2Launch(runProfile).args,
      },
    } as never,
  ],

  // The service refuses to start unless the binary is proven to be the
  // isolated e2e build; it wipes only that profile before and after the run.
  services: [
    [
      TauriDriverService,
      {
        expectedIdentifier: E2E_IDENTIFIER,
        wipe: "before-and-after",
        runProfile,
      },
    ],
  ],

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 90_000,
  },

  reporters: ["spec"],

  waitforTimeout: 15_000,
  connectionRetryTimeout,
  connectionRetryCount: 3,

  async beforeSession() {
    const { enforceWorkerPreflight } = await import("./helpers/profile-guard");
    enforceWorkerPreflight();
  },

  async before() {
    // Must precede anything that touches app state.
    const { enforceWorkerProfileIsolation } =
      await import("./helpers/profile-guard");
    await enforceWorkerProfileIsolation();
    const { waitForAppReady } = await import("./helpers/app");
    await waitForAppReady();
  },

  async afterTest(
    _test: unknown,
    _context: unknown,
    result: { passed: boolean },
  ) {
    if (!result.passed) {
      const timestamp = Date.now();
      const screenshotDir = path.resolve(__dirname, "./screenshots");
      const fs = await import("fs");
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      await browser.saveScreenshot(
        path.join(screenshotDir, `failure-${timestamp}.png`),
      );
    }
  },
};

export default config;
