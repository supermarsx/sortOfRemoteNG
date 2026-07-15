import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TauriDriverService from "./helpers/tauri-service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriDriverPort = Number.parseInt(
  process.env.TAURI_DRIVER_PORT ?? "4444",
  10,
);
const phase = process.env.README_CAPTURE_PHASE;
const application = process.env.README_CAPTURE_BINARY?.trim();

if (phase !== "seed" && phase !== "capture") {
  throw new Error('README_CAPTURE_PHASE must be "seed" or "capture"');
}

if (!application || !fs.existsSync(application)) {
  throw new Error(
    `README_CAPTURE_BINARY must point to the built capture application; received ${String(application)}`,
  );
}

const collectionId = process.env.README_COLLECTION_ID?.trim() ?? "";
const connectionId = process.env.README_CONNECTION_ID?.trim() ?? "";

if (
  phase === "capture" &&
  (collectionId.length === 0 || connectionId.length === 0)
) {
  throw new Error(
    "README_COLLECTION_ID and README_CONNECTION_ID are required for capture",
  );
}

const applicationArgs =
  phase === "capture"
    ? [`--collection=${collectionId}`, `--connection=${connectionId}`]
    : [];

export const config = {
  runner: "local",
  logLevel: "error",
  hostname: "127.0.0.1",
  port: tauriDriverPort,
  path: "/",
  autoCompileOpts: {
    tsNodeOpts: {
      project: path.resolve(__dirname, "./tsconfig.readme-screenshot.json"),
    },
  },
  specs: ["./specs/readme-screenshot/readme-screenshot.spec.ts"],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application,
        args: applicationArgs,
      },
    } as never,
  ],
  services: [[TauriDriverService]],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
  reporters: ["spec"],
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
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
    if (result.passed) {
      return;
    }

    const browserLogs = (await browser
      .getLogs("browser")
      .catch(() => [])) as Array<{ level?: string; message?: string }>;
    for (const entry of browserLogs) {
      if (
        entry.level === "SEVERE" ||
        entry.message?.includes("SSH connection failed")
      ) {
        console.error(
          `[capture-browser] ${entry.level ?? "UNKNOWN"}: ${entry.message ?? ""}`,
        );
      }
    }

    const screenshotDirectory = path.resolve(
      __dirname,
      "./screenshots/readme-screenshot",
    );
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await browser.saveScreenshot(
      path.join(screenshotDirectory, `failure-${phase}-${Date.now()}.png`),
    );
  },
};

export default config;
