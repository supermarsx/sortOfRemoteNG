/** Actual import component and app CSS; isolated synthetic props, no native state. */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { remote } from "webdriverio";
const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-trust-ui-"));
const output = path.resolve(".artifacts/trust-ui");
let browser;
let server;
try {
  server = await createServer({
    configFile: path.resolve("e2e/trust-demo/vite.config.mjs"),
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
  const report = [];
  for (const width of [1440, 390]) {
    await browser.setViewport({ width, height: 900, devicePixelRatio: 1 });
    await browser.url("http://127.0.0.1:4320");
    await browser.$('[role="dialog"]').waitForDisplayed({ timeout: 60000 });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          if (window.__TRUST_DEMO__?.refused.length)
            throw new Error(window.__TRUST_DEMO__.refused.join("; "));
          const body = document.querySelector(".sor-modal-body");
          return (
            body &&
            parseFloat(getComputedStyle(body).paddingLeft) >= 16 &&
            document.querySelectorAll("tbody tr").length === 100
          );
        }),
      { timeout: 30000 },
    );
    const layout = await browser.execute(async () => {
      await document.fonts.ready;
      const panel = document.querySelector('[role="dialog"]');
      const body = panel.querySelector(".sor-modal-body");
      const footer = panel.querySelector(".sor-modal-footer");
      const rect = panel.getBoundingClientRect();
      const foot = footer.getBoundingClientRect();
      return {
        width: innerWidth,
        panelWidth: rect.width,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        footerBottom: foot.bottom,
        viewportHeight: innerHeight,
        scrollable: body.scrollHeight > body.clientHeight,
        refused: window.__TRUST_DEMO__.refused,
      };
    });
    if (
      layout.refused.length ||
      layout.left < 8 ||
      layout.right > width - 8 ||
      layout.top < 48 ||
      layout.bottom > layout.viewportHeight ||
      layout.footerBottom > layout.viewportHeight ||
      !layout.scrollable
    )
      throw new Error(JSON.stringify(layout));
    const confirm = await browser.$("button=Merge reviewed identities");
    if (await confirm.isEnabled())
      throw new Error("Import enabled without review");
    await browser.saveScreenshot(path.join(output, `import-${width}.png`));
    await browser.$(".sor-modal-body").execute((body) => {
      body.scrollTop = body.scrollHeight;
    });
    await browser.saveScreenshot(
      path.join(output, `import-${width}-scrolled.png`),
    );
    report.push(layout);
    console.log(`Verified actual import layout at ${width}px`);
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  try {
    if (browser) await browser.deleteSession();
  } finally {
    try {
      if (server) await server.close();
    } finally {
      const resolved = path.resolve(profile);
      if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith("sorng-trust-ui-")
      )
        throw new Error("Unsafe fixture cleanup target");
      await rm(resolved, { recursive: true, force: true });
    }
  }
}
