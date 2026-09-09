#!/usr/bin/env node
// Real React UI, synthetic boundaries only. Never connects to the native app.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { remote } from "webdriverio";
const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-database-ui-"));
const output = path.resolve(".artifacts/database-ui");
let server, browser;
const report = [];
try {
  server = await createServer({
    configFile: path.resolve("e2e/database-ui-demo/vite.config.mjs"),
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
    for (const view of ["unlock", "bulk", "progress"]) {
      await browser.setViewport({ width, height: 700, devicePixelRatio: 1 });
      await browser.url(`http://127.0.0.1:4321/?view=${view}`);
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const d = window.__DATABASE_UI_DEMO__;
            if (d?.refused.length) throw Error(d.refused.join("; "));
            return d?.ready === true;
          }),
        { timeout: 60000 },
      );
      if (view === "bulk") await browser.$("button=Unlock selected").click();
      if (view === "progress") {
        await browser.$("button=Clone selected").click();
        await browser.$("button=Run 18 database operations").click();
        for (const count of [1, 2]) {
          await browser.waitUntil(async () =>
            browser.execute(
              (count) => document.body.innerText.includes(`— ${count} of 18`),
              count,
            ),
          );
          await browser.execute(() => window.__DATABASE_UI_DEMO__.advance());
        }
        await browser.waitUntil(async () =>
          browser.execute(() => document.body.innerText.includes("— 3 of 18")),
        );
      }
      const result = await browser.execute((view) => {
        const state = window.__DATABASE_UI_DEMO__;
        if (state.refused.length) throw Error(state.refused.join("; "));
        if (document.documentElement.scrollWidth > innerWidth + 1)
          throw Error("Horizontal overflow");
        const rect = (element) => {
          const r = element.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height,
          };
        };
        const dialog = document.querySelector('[role="dialog"]');
        if (view !== "progress") {
          if (!dialog) throw Error("Missing auth dialog");
          const body = dialog.querySelector(".sor-modal-body");
          const footer = dialog.querySelector(".sor-modal-footer");
          if (!body || !footer)
            throw Error("Missing bounded body/fixed footer");
          const f = rect(footer);
          if (f.bottom > innerHeight || f.top < 0)
            throw Error("Unreachable footer");
          if (parseFloat(getComputedStyle(body).paddingLeft) < 16)
            throw Error("Missing body padding");
          if (view === "bulk" && dialog.querySelectorAll("input").length !== 18)
            throw Error("Missing bulk credential fields");
          const before = rect(footer).top;
          body.scrollTop = body.scrollHeight;
          if (rect(footer).top !== before)
            throw Error("Footer scrolls with fields");
          body.scrollTop = 0;
          return {
            dialog: rect(dialog),
            body: rect(body),
            footer: f,
            fields: dialog.querySelectorAll("input").length,
            refused: state.refused,
          };
        }
        const toasts = document.querySelectorAll(".toast-item");
        if (toasts.length !== 1) throw Error("Expected one progress toast");
        const progress = document.querySelector('[role="progressbar"]');
        if (!progress || Number(progress.getAttribute("aria-valuenow")) >= 100)
          throw Error("Premature completion");
        return {
          toast: rect(toasts[0]),
          text: toasts[0].textContent,
          completed: state.completed,
          refused: state.refused,
        };
      }, view);
      await browser.saveScreenshot(path.join(output, `${view}-${width}.png`));
      report.push({ view, width, ...result });
      console.log(`Verified ${view} at ${width}px`);
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
        path.basename(profile).startsWith("sorng-database-ui-")
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
