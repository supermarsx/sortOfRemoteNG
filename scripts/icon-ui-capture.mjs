#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { remote } from "webdriverio";
const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-icon-ui-"));
const output = path.resolve(".artifacts/icon-ui");
let server, browser;
const report = [];
try {
  server = await createServer({
    configFile: path.resolve("e2e/icon-ui-demo/vite.config.mjs"),
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
          "--user-data-dir=" + profile,
        ],
      },
    },
  });
  await browser.setTimeout({ pageLoad: 60000, script: 10000 });
  for (const width of [1440, 390]) {
    await browser.setViewport({ width, height: 900, devicePixelRatio: 1 });
    await browser.url("http://127.0.0.1:4323/");
    await browser.waitUntil(
      async () =>
        browser.execute(() => window.__ICON_UI_DEMO__?.ready === true),
      { timeout: 60000 },
    );
    const initial = await browser.execute(() => {
      const state = window.__ICON_UI_DEMO__;
      if (state.refused.length) throw Error(state.refused.join("; "));
      const search = document.querySelector('[aria-label="Search icons"]');
      const input = search.getBoundingClientRect();
      const icon = search.previousElementSibling.getBoundingClientRect();
      if (
        input.left + parseFloat(getComputedStyle(search).paddingLeft) <
        icon.right + 4
      )
        throw Error("Search icon overlaps text");
      if (innerWidth >= 1024 && input.width > 320)
        throw Error("Unnecessarily full-width search");
      if (document.documentElement.scrollWidth > innerWidth + 1)
        throw Error("Horizontal overflow");
      if (
        document.querySelectorAll('[aria-label="Icon catalog"] > li').length >
        96
      )
        throw Error("Unbounded icon grid");
      return {
        inputWidth: input.width,
        padding: getComputedStyle(search).paddingLeft,
        refused: state.refused,
      };
    });
    if (width >= 1024)
      await browser
        .$('nav[aria-label="Icon sections"]')
        .$("button*=Folders")
        .click();
    else
      await browser
        .$('[aria-label="Icon category"]')
        .selectByAttribute("value", "folders");
    await browser.saveScreenshot(
      path.join(output, "folders-" + width + ".png"),
    );
    await browser.$('button[aria-label="Inspect Demo folder"]').click();
    if (width >= 1280) {
      const sticky = await browser.execute(() => {
        const container = document.querySelector(
          'section[aria-label="Icon Explorer"]',
        );
        const detail = document.querySelector('[aria-label="Icon details"]');
        const sidebar = document.querySelector('[aria-label="Icon sections"]');
        container.scrollTop = 280;
        const d = detail.getBoundingClientRect();
        const s = sidebar.getBoundingClientRect();
        if (
          getComputedStyle(detail).position !== "sticky" ||
          d.top < 30 ||
          d.bottom > innerHeight
        )
          throw Error("Details do not follow scroll inside viewport");
        if (s.top < 30 || getComputedStyle(sidebar).position !== "sticky")
          throw Error("Section sidebar does not follow scroll");
        detail.scrollTop = detail.scrollHeight;
        const exportButton = [...detail.querySelectorAll("button")].find(
          (button) => button.textContent.includes("Export SVG"),
        );
        if (exportButton.getBoundingClientRect().bottom > d.bottom)
          throw Error("SVG export unreachable");
        detail.scrollTop = 0;
        return { detailTop: d.top, detailBottom: d.bottom, sectionTop: s.top };
      });
      report.push({ width, sticky });
    } else {
      await browser.execute(() => {
        const detail = document.querySelector('[aria-label="Icon details"]');
        detail.scrollIntoView({ block: "start" });
        const button = [...detail.querySelectorAll("button")].find((item) =>
          item.textContent.includes("Export SVG"),
        );
        if (button.getBoundingClientRect().bottom > innerHeight)
          throw Error(
            "Narrow detail actions are not reachable in the stacked panel",
          );
      });
    }
    await browser.saveScreenshot(
      path.join(output, "details-" + width + ".png"),
    );
    await browser.execute(() => {
      document.querySelector('section[aria-label="Icon Explorer"]').scrollTop =
        0;
    });
    await browser.$("button=Import SVG / JSON").click();
    await browser
      .$('[role="dialog"][aria-label="Review icon import"]')
      .waitForDisplayed();
    const review = await browser.execute(() => {
      const state = window.__ICON_UI_DEMO__;
      if (state.refused.length) throw Error(state.refused.join("; "));
      const dialog = document.querySelector(
        '[aria-label="Review icon import"]',
      );
      const body = dialog.querySelector(".sor-modal-body");
      const footer = dialog.querySelector(".sor-modal-footer");
      const before = footer.getBoundingClientRect();
      const text = dialog.querySelector("li > div").getBoundingClientRect();
      if (text.width < 100) throw Error("Import name column is squeezed");
      if (before.bottom > innerHeight || before.top < 0)
        throw Error("Import actions outside viewport");
      body.scrollTop = body.scrollHeight;
      if (footer.getBoundingClientRect().top !== before.top)
        throw Error("Import footer scrolls away");
      body.scrollTop = 0;
      if (dialog.scrollWidth > dialog.clientWidth + 1)
        throw Error("Import horizontal overflow");
      return {
        fields: dialog.querySelectorAll("select").length,
        footerTop: before.top,
        calls: state.calls,
        refused: state.refused,
      };
    });
    await browser.saveScreenshot(path.join(output, "import-" + width + ".png"));
    report.push({ width, initial, review });
    console.log("Verified Icon Explorer at " + width + "px");
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
        path.basename(profile).startsWith("sorng-icon-ui-")
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
