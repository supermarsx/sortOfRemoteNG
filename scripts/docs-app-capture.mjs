#!/usr/bin/env node
/** Captures actual React components with an isolated, explicitly synthetic fixture. */
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { remote } from "webdriverio";

const allViews = [
  "editor",
  "artifacts",
  "database",
  "sessions",
  "recordings",
  "trust",
];
const publish = process.argv.includes("--publish");
const requested = process.argv.slice(2).filter((arg) => arg !== "--publish");
if (requested.some((view) => !allViews.includes(view)))
  throw new Error("Unknown documentation view");
if (publish && requested.length)
  throw new Error("Publishing requires the complete verified capture set");
const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-docs-app-"));
const output = path.resolve(".artifacts/docs-app");
let server;
let browser;
try {
  server = await createServer({
    configFile: path.resolve("e2e/docs-demo/vite.config.mjs"),
    cacheDir: path.join(profile, "vite-cache"),
  });
  await server.listen();
  await mkdir(output, { recursive: true });
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": {
        binary:
          process.env.DOCS_CHROME_BINARY ??
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
        args: [
          "--headless=new",
          "--no-first-run",
          "--disable-background-networking",
          `--user-data-dir=${profile}`,
        ],
      },
    },
  });
  await browser.setTimeout({ pageLoad: 60000, script: 10000 });
  await browser.setViewport({ width: 1440, height: 1000, devicePixelRatio: 1 });
  const report = [];
  for (const view of requested.length ? requested : allViews) {
    console.log(`Loading actual component: ${view}`);
    await browser.setViewport({
      width: 1440,
      height: view === "artifacts" ? 1500 : 1000,
      devicePixelRatio: 1,
    });
    await browser.url(`http://127.0.0.1:4319/?view=${view}`);
    await browser.waitUntil(
      async () =>
        browser.execute((name) => {
          const demo = window.__DOCS_DEMO__;
          if (demo?.refused.length) throw new Error(demo.refused.join("; "));
          if (!document.querySelector(`[data-docs-demo="${name}"]`))
            return false;
          if (name === "editor")
            return (
              document.querySelector('[data-testid="editor-name"]')?.value ===
                "Operations dashboard" &&
              !!document.querySelector('[data-testid="editor-hostname"]')
            );
          const text = document.body.innerText;
          const commands = demo.commands;
          if (name === "artifacts")
            return (
              commands.includes("encryption_get_artifact_status") &&
              !!document.querySelector(
                '[aria-label="Select Connections database"]',
              ) &&
              text.includes("Protected key infrastructure")
            );
          if (name === "database")
            return (
              commands.includes("database_protection_status") &&
              commands.includes("database_protection_capabilities") &&
              text.includes("Recovery password") &&
              text.includes("This computer")
            );
          if (name === "sessions")
            return (
              commands.includes("get_rdp_stats") &&
              text.includes("app.example.test") &&
              text.includes("desktop.example.test") &&
              text.includes("dashboard.example.test") &&
              !text.includes("Loading sessions")
            );
          if (name === "recordings")
            return (
              demo.storageReads.includes("mremote-session-recordings") &&
              text.includes("Deployment walkthrough") &&
              text.includes("Service health review")
            );
          if (name === "trust")
            return (
              commands.includes("trust_get_summary") &&
              text.includes("Application server") &&
              text.includes("Operations dashboard") &&
              !!document.querySelector('button[aria-label^="Inspect"]')
            );
          throw new Error(`Unknown capture view ${name}`);
        }, view),
      {
        timeout: 60000,
        timeoutMsg: `Actual ${view} component did not become ready`,
      },
    );
    const failure = await browser.$('[role="alert"]');
    if (await failure.isExisting())
      throw new Error(`${view}: ${await failure.getText()}`);
    await browser.saveScreenshot(path.join(output, `${view}.png`));
    const data = await browser.execute(() => ({
      commands: window.__DOCS_DEMO__.commands,
      refused: window.__DOCS_DEMO__.refused,
      storageReads: window.__DOCS_DEMO__.storageReads,
      text: document.body.innerText,
    }));
    if (data.refused.length)
      throw new Error(`${view}: ${data.refused.join("; ")}`);
    report.push({
      view,
      commands: data.commands,
      refused: data.refused,
      storageReads: data.storageReads,
      text: data.text,
      file: `${view}.png`,
    });
    console.log(`Captured ready component: ${view}`);
    if (view === "editor") {
      await browser.$("button=Organize").click();
      await browser
        .$('[data-testid="connection-editor-panel-organize"]')
        .waitForExist({ timeout: 10000 });
      const refused = await browser.execute(() => window.__DOCS_DEMO__.refused);
      if (refused.length) throw new Error(refused.join("; "));
      await browser.saveScreenshot(path.join(output, "editor-organize.png"));
      report.push({
        view: "editor-organize",
        file: "editor-organize.png",
        refused,
      });
    }
  }
  for (const item of report) {
    const png = await readFile(path.join(output, item.file));
    item.width = png.readUInt32BE(16);
    item.height = png.readUInt32BE(20);
    item.sha256 = createHash("sha256").update(png).digest("hex");
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        notice:
          "Actual application components, synthetic documentation data and native responses. No live session, app profile, secret, native file or network endpoint.",
        views: report,
      },
      null,
      2,
    ),
  );
  if (publish) {
    const destination = path.resolve("docs/assets/screenshots");
    await mkdir(destination, { recursive: true });
    for (const item of report)
      await copyFile(
        path.join(output, item.file),
        path.join(destination, item.file),
      );
    await copyFile(
      path.join(output, "report.json"),
      path.join(destination, "capture-manifest.json"),
    );
  }
  console.log(`Captured ${report.length} actual component views in ${output}`);
} catch (error) {
  if (browser) {
    console.error(
      "Capture diagnostics:",
      await browser
        .execute(() => ({
          text: document.body?.innerText,
          state: window.__DOCS_DEMO__,
          resources: performance
            .getEntriesByType("resource")
            .slice(-12)
            .map((entry) => entry.name),
        }))
        .catch(() => "Browser diagnostics unavailable"),
    );
  }
  throw error;
} finally {
  try {
    if (browser) await browser.deleteSession();
  } finally {
    try {
      if (server) await server.close();
    } finally {
      if (
        path.dirname(profile) === os.tmpdir() &&
        path.basename(profile).startsWith("sorng-docs-app-")
      )
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
    }
  }
}
