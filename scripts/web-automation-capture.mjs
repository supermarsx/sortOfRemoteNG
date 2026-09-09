#!/usr/bin/env node
// Actual controls, synthetic in-memory props. No native app or live website.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { remote } from "webdriverio";
const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-web-automation-"));
const output = path.resolve(".artifacts/web-automation");
let server, browser;
const report = [];
try {
  server = await createServer({
    configFile: path.resolve("e2e/web-automation-demo/vite.config.mjs"),
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
  for (const width of [1440, 390])
    for (const view of [
      "bar",
      "setup",
      "recording",
      "capture-review",
      "discard",
      "library",
      "macro",
      "review",
    ]) {
      await browser.setViewport({ width, height: 700, devicePixelRatio: 1 });
      await browser.url(`http://127.0.0.1:4325/?view=${view}`);
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            if (window.__WEB_AUTOMATION_DEMO__?.refused.length)
              throw Error(window.__WEB_AUTOMATION_DEMO__.refused.join("; "));
            return window.__WEB_AUTOMATION_DEMO__?.ready === true;
          }),
        { timeout: 60000 },
      );
      if (view === "library")
        await browser.$("button=JS · Highlight maintenance notices").click();
      if (view === "setup") await browser.$("button=Record macro").click();
      if (view === "capture-review")
        await browser
          .$('[aria-label="Stop recording and review macro"]')
          .click();
      if (view === "discard")
        await browser.$('[aria-label="Discard unsaved recording"]').click();
      const result = await browser.execute((view) => {
        const state = window.__WEB_AUTOMATION_DEMO__;
        if (state.refused.length) throw Error(state.refused.join("; "));
        if (document.documentElement.scrollWidth > innerWidth + 1)
          throw Error("Horizontal overflow");
        const rect = (element) => {
          const r = element.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        const dialog = document.querySelector('[role="dialog"]');
        if (view === "bar" || view === "recording") {
          const controls = document.querySelector(
            '[data-testid="web-macro-recording-controls"]',
          );
          const lane = document.querySelector(
            '[data-testid="web-bookmark-scroll"]',
          );
          if (!controls || !lane || lane.scrollWidth <= lane.clientWidth)
            throw Error("Missing actual overflowing bookmark lane");
          const before = rect(controls);
          lane.scrollLeft = lane.scrollWidth;
          const after = rect(controls);
          if (
            Math.abs(after.left - before.left) > 1 ||
            after.left < 0 ||
            after.right > innerWidth
          )
            throw Error("Recording controls scroll out of view");
          if (
            view === "recording" &&
            !controls.textContent.includes("Stop & review · 3")
          )
            throw Error("Missing captured step count");
          return {
            controls: document.querySelectorAll("button").length,
            pinned: after,
            bookmarkScroll: lane.scrollLeft,
            refused: state.refused,
          };
        }
        if (!dialog) throw Error("Missing actual dialog");
        if (view === "setup" || view === "discard") {
          const confirm = dialog.querySelector('[data-testid="confirm-yes"]');
          const cancel = dialog.querySelector('[data-testid="confirm-no"]');
          if (!confirm || !cancel) throw Error("Missing confirmation actions");
          const d = rect(dialog),
            f = rect(confirm),
            c = rect(cancel);
          if (
            d.left < 0 ||
            d.right > innerWidth + 1 ||
            d.top < 0 ||
            d.bottom > innerHeight ||
            f.bottom > innerHeight ||
            c.bottom > innerHeight
          )
            throw Error("Unreachable confirmation actions");
          return { dialog: d, confirm: f, refused: state.refused };
        }
        const body = dialog.querySelector(".sor-modal-body"),
          footer = dialog.querySelector(".sor-modal-footer");
        if (!body || !footer) throw Error("Missing bounded body/footer");
        const d = rect(dialog),
          f = rect(footer);
        if (
          d.left < 0 ||
          d.right > innerWidth + 1 ||
          f.bottom > innerHeight ||
          f.top < 0
        )
          throw Error("Unreachable dialog actions");
        const before = f.top;
        body.scrollTop = body.scrollHeight;
        if (Math.abs(rect(footer).top - before) > 1)
          throw Error("Footer scrolls with body");
        body.scrollTop = 0;
        return {
          dialog: d,
          footer: f,
          scrollable: body.scrollHeight > body.clientHeight,
          refused: state.refused,
        };
      }, view);
      await browser.saveScreenshot(path.join(output, `${view}-${width}.png`));
      if (view === "setup") {
        await browser.$("button=Enable website macros").click();
        await browser.waitUntil(
          async () => await browser.$("button=Record macro").isExisting(),
        );
        if (
          await browser
            .$('[aria-label="Stop recording and review macro"]')
            .isExisting()
        )
          throw Error("Consent silently started recording");
      }
      if (view === "discard") {
        await browser.$("button=Discard recording").click();
        await browser.waitUntil(
          async () => await browser.$("button=Record macro").isExisting(),
        );
        if (
          await browser
            .$('[aria-label="Discard unsaved recording"]')
            .isExisting()
        )
          throw Error("Discard retained unsaved recording");
      }
      await browser.execute(() => {
        if (window.__WEB_AUTOMATION_DEMO__.refused.length)
          throw Error(window.__WEB_AUTOMATION_DEMO__.refused.join("; "));
      });
      report.push({ view, width, ...result });
      console.log(`Verified ${view} ${width}px`);
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
      if (
        path.dirname(profile) === os.tmpdir() &&
        path.basename(profile).startsWith("sorng-web-automation-")
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
