import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  README_CAPTURE_IDENTIFIER,
  resolveRunProfile,
  webview2Launch,
} from "../scripts/lib/e2e-profile-isolation.mjs";
import TauriDriverService from "./helpers/tauri-service";
import { resolveDriverPorts } from "./helpers/driver-ports";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `scripts/readme-screenshot.mjs` pins these so it can wait for the driver port
// to close between its seed and capture phases; standalone runs get a free pair.
const { driverPort: tauriDriverPort } = resolveDriverPorts();
// scripts/readme-screenshot.mjs pins the run id and run dir as well, so both
// phases share one WebView2 folder.
const runProfile = resolveRunProfile({ identifier: README_CAPTURE_IDENTIFIER });
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

const applicationArgs = [
  ...(phase === "capture"
    ? [`--collection=${collectionId}`, `--connection=${connectionId}`]
    : []),
  ...webview2Launch(runProfile).args,
];

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
  // The seed and capture phases share one profile, so
  // scripts/readme-screenshot.mjs owns the wipe; identity is still proven here.
  services: [
    [
      TauriDriverService,
      {
        expectedIdentifier: README_CAPTURE_IDENTIFIER,
        wipe: "none",
        runProfile,
      },
    ],
  ],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
  reporters: ["spec"],
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  async beforeSession() {
    const { enforceWorkerPreflight } = await import("./helpers/profile-guard");
    enforceWorkerPreflight();
  },

  async before() {
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
