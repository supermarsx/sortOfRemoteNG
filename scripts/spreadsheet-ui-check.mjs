/** Isolated synthetic fixture. Requires existing Chrome + chromedriver; never downloads either. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { remote } from "webdriverio";
const binary =
  process.env.DOCS_CHROME_BINARY ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const driver = process.env.CHROMEDRIVER_PATH;
if (!driver)
  throw Error(
    "Set CHROMEDRIVER_PATH to an existing compatible driver; downloads are disabled.",
  );
await access(binary);
await access(driver);
const profile = await mkdtemp(
  path.join(os.tmpdir(), "sorng-spreadsheet-fixture-"),
);
const output = path.resolve(".artifacts/spreadsheet");
let server, browser;
try {
  server = await createServer({
    configFile: false,
    root: path.resolve("e2e/spreadsheet-demo"),
    cacheDir: path.join(profile, "vite"),
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: null,
      fs: { allow: [process.cwd()] },
    },
  });
  await server.listen();
  await mkdir(output, { recursive: true });
  browser = await remote({
    logLevel: "error",
    capabilities: {
      browserName: "chrome",
      "wdio:chromedriverOptions": { binary: driver },
      "goog:chromeOptions": {
        binary,
        args: [
          "--headless=new",
          "--no-first-run",
          "--disable-background-networking",
          `--user-data-dir=${profile}`,
        ],
      },
    },
  });
  await browser.setTimeout({ pageLoad: 120000, script: 10000 });
  await browser.setViewport({ width: 1440, height: 900, devicePixelRatio: 1 });
  await browser.url(`http://127.0.0.1:${server.httpServer.address().port}`);
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.querySelectorAll("canvas").length > 0 ||
          [...document.querySelectorAll('[role="alert"]')].some((x) =>
            x.textContent.includes("could not load"),
          ),
      ),
    { timeout: 120000 },
  );
  await browser.pause(1500);
  const state = await browser.execute(() => ({
    canvases: document.querySelectorAll("canvas").length,
    errors: [...document.querySelectorAll('[role="alert"]')].map(
      (x) => x.textContent,
    ),
    text: document.body.innerText.slice(0, 4000),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  await browser.saveScreenshot(path.join(output, "desktop.png"));
  await writeFile(
    path.join(output, "desktop.json"),
    JSON.stringify(state, null, 2),
  );
  assert.ok(state.canvases > 0, "Actual spreadsheet Canvas must mount");
  assert.deepEqual(state.errors, [], "No editor loading/validation errors");
  await browser.$("button=Link selected cell").click();
  await browser.pause(1000);
  const afterLink = await browser.execute(() => ({
    snapshot: document.getElementById("snapshot").textContent,
    errors: [
      ...document.querySelectorAll('[role="alert"],[data-fixture-error]'),
    ].map((x) => x.textContent),
  }));
  await writeFile(
    path.join(output, "after-link.json"),
    JSON.stringify(afterLink, null, 2),
  );
  await browser.saveScreenshot(path.join(output, "after-link.png"));
  assert.ok(
    afterLink.snapshot.includes('"reference"'),
    `Selected cell link must persist; errors: ${afterLink.errors.join("; ")}`,
  );
  await browser.$("#lock").click();
  await browser.waitUntil(
    async () => !(await browser.$("button=Link selected cell").isEnabled()),
    { timeout: 10000 },
  );
  await browser.setViewport({ width: 600, height: 900, devicePixelRatio: 1 });
  await browser.pause(1500);
  await browser.saveScreenshot(path.join(output, "narrow-locked.png"));
  console.log(
    JSON.stringify({
      canvasCount: state.canvases,
      desktopOverflow: state.overflow,
      referencePersisted: true,
      lockedControls: true,
    }),
  );
} finally {
  if (browser) await browser.deleteSession();
  if (server) await server.close();
  const resolved = path.resolve(profile),
    temp = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== temp ||
    !path.basename(resolved).startsWith("sorng-spreadsheet-fixture-")
  )
    throw Error("Unexpected fixture cleanup target");
  await rm(resolved, { recursive: true, force: true });
}
