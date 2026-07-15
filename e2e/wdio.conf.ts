import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { Options } from "@wdio/types";
import TauriDriverService from "./helpers/tauri-service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriDriverPort = Number.parseInt(
  process.env.TAURI_DRIVER_PORT ?? "4444",
  10,
);
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
      },
    } as never,
  ],

  services: [[TauriDriverService]],

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 90_000,
  },

  reporters: ["spec"],

  waitforTimeout: 15_000,
  connectionRetryTimeout,
  connectionRetryCount: 3,

  async before() {
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
