/** Real component stress fixture; no native IPC, application stores or user profile. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { remote } from "webdriverio";

const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-viewport-check-"));
const output = path.resolve(".artifacts/viewport-scroll");
let server;
let browser;
try {
  server = await createServer({
    configFile: false,
    root: path.resolve("e2e/viewport-demo"),
    cacheDir: path.join(profile, "vite"),
    plugins: [react()],
    optimizeDeps: {
      noDiscovery: true,
      include: [
        "react",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "lucide-react",
      ],
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: null,
      fs: { allow: [process.cwd()] },
    },
  });
  await server.listen();
  const port = server.httpServer.address().port;
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
  await browser.setViewport({ width: 1000, height: 800, devicePixelRatio: 1 });
  await browser.url(`http://127.0.0.1:${port}`);
  await browser.$("#highlight").waitForDisplayed({ timeout: 30000 });
  const read = () =>
    browser.execute(() => ({
      root: document.scrollingElement.scrollTop,
      shell: document.getElementById("shell").scrollTop,
      lane: document.getElementById("settings-lane").scrollTop,
      toolbarTop: document.getElementById("toolbar").getBoundingClientRect()
        .top,
    }));
  const before = await read();
  await browser.$("#highlight").click();
  await browser.waitUntil(async () => (await read()).lane > 0, {
    timeout: 10000,
  });
  await browser.pause(500);
  const after = await read();
  await mkdir(output, { recursive: true });
  const name = process.argv.includes("--expect-regression")
    ? "before"
    : "after";
  await browser.saveScreenshot(path.join(output, `${name}.png`));
  const report = { before, after };
  await writeFile(
    path.join(output, `${name}.json`),
    JSON.stringify(report, null, 2),
  );
  if (name === "before")
    assert.ok(
      after.shell > before.shell || after.root > before.root,
      "Expected baseline ancestor scrolling",
    );
  else {
    assert.equal(after.shell, before.shell);
    assert.equal(after.root, before.root);
    assert.equal(after.toolbarTop, before.toolbarTop);
    await browser.$('[role="combobox"]').click();
    await browser.keys("End");
    const dropdown = await browser.execute(
      () => document.querySelector(".sor-select-dropdown-scroll").scrollTop,
    );
    assert.ok(dropdown > 0, "Last option must remain keyboard-visible");
    await browser.keys("Escape");
    assert.deepEqual(await read(), after);
    await browser.$("#open-modal").click();
    await browser.waitUntil(async () =>
      browser.execute(() => document.activeElement?.id === "modal-first"),
    );
    await browser.keys(["Shift", "Tab"]);
    await browser.keys("NULL");
    const modal = await browser.execute(() => ({
      focus: document.activeElement?.id,
      scroll: document.querySelector('[role="dialog"]').scrollTop,
    }));
    assert.equal(modal.focus, "modal-last");
    assert.ok(
      modal.scroll > 0,
      "Modal's own scroll lane must reveal trapped keyboard focus",
    );
    await browser.keys("Escape");
    assert.equal(
      await browser.execute(() => document.activeElement?.id),
      "open-modal",
    );
    assert.deepEqual(await read(), after);
    console.log(
      JSON.stringify({ dropdown, modal, outerScrollUnchanged: true }),
    );
  }
  console.log(JSON.stringify(report));
} finally {
  try {
    await browser?.deleteSession();
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
