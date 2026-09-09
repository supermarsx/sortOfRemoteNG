#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { remote } from "webdriverio";

const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-provider-icons-"));
const output = path.resolve(".artifacts/provider-icons");
const rolesOnly = process.argv.includes("--roles-only");
let server, browser;
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
  const reports = [];
  for (const [view, count, filename] of [
    ["providers", 34, "provider-size-sheet"],
    ["role-composites", 27, "role-composites-size-sheet"],
    ["cloud-database", 19, "cloud-database-size-sheet"],
  ].filter(([view]) => !rolesOnly || view !== "providers")) {
    await browser.setViewport({
      width: 1440,
      height: view === "providers" ? 1920 : 1800,
      devicePixelRatio: 1,
    });
    await browser.url("http://127.0.0.1:4323/provider-icons.html?view=" + view);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const state = window.__ICON_UI_DEMO__;
          if (state?.refused.length) throw Error(state.refused.join("; "));
          return state?.ready === true;
        }),
      { timeout: 60000 },
    );
    const report = await browser.execute((expectedCount) => {
      const state = window.__ICON_UI_DEMO__;
      if (state.refused.length || state.calls.length)
        throw Error(
          "Unexpected boundary calls: " +
            [...state.refused, ...state.calls].join("; "),
        );
      if (
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight
      )
        throw Error("Contact sheet does not fit viewport");
      const cards = [...document.querySelectorAll("[data-provider]")];
      if (cards.length !== expectedCount)
        throw Error("Incomplete contact sheet: " + cards.length);
      return cards.map((card) => {
        const icons = [...card.querySelectorAll("[data-surface] > div > svg")];
        if (icons.length !== 6) throw Error("Missing size/surface sample");
        return {
          key: card.getAttribute("data-provider"),
          samples: icons.map((svg, index) => {
            const expected = [16, 24, 32][index % 3];
            const rect = svg.getBoundingClientRect();
            if (rect.width !== expected || rect.height !== expected)
              throw Error("Incorrect rendered icon size");
            if (svg.querySelector("image, use, script, foreignObject"))
              throw Error("External or active vector content");
            const bounds = svg.getBBox();
            const box = svg.viewBox.baseVal;
            if (!bounds.width || !bounds.height || !box.width || !box.height)
              throw Error("Empty artwork");
            for (const frame of svg.querySelectorAll("[data-role-frame]")) {
              const badge = [...frame.parentElement.children].find(
                (item) => item.tagName === "svg",
              );
              if (
                !badge ||
                badge.getAttribute("x") !== "12" ||
                badge.getAttribute("y") !== "12" ||
                badge.getAttribute("width") !== "11" ||
                badge.getAttribute("height") !== "11"
              )
                throw Error(
                  "Inconsistent corner badge: " +
                    card.getAttribute("data-provider"),
                );
              const badgePaint = [
                ...badge.querySelectorAll(
                  "path, ellipse, circle, rect, line, polyline, polygon",
                ),
              ].map((shape) => ({
                shape,
                inverse: shape.getCTM().inverse(),
                style: getComputedStyle(shape),
              }));
              for (const shape of frame.querySelectorAll(
                "path, ellipse, circle, rect, line, polyline, polygon",
              )) {
                for (let x = 12; x < 24; x += 0.5)
                  for (let y = 12; y < 24; y += 0.5) {
                    const point = new DOMPoint(x, y);
                    if (!shape.isPointInStroke(point)) continue;
                    const screenPoint = point.matrixTransform(shape.getCTM());
                    for (const mark of badgePaint) {
                      const markPoint = screenPoint.matrixTransform(
                        mark.inverse,
                      );
                      if (
                        (mark.style.fill !== "none" &&
                          mark.shape.isPointInFill(markPoint)) ||
                        (mark.style.stroke !== "none" &&
                          mark.shape.isPointInStroke(markPoint))
                      )
                        throw Error(
                          "Frame overlaps painted badge: " +
                            frame.getAttribute("data-role-frame"),
                        );
                    }
                  }
              }
            }
            return {
              size: expected,
              surface: index < 3 ? "light" : "dark",
              artworkWidthPx: (bounds.width / box.width) * expected,
              artworkHeightPx: (bounds.height / box.height) * expected,
            };
          }),
        };
      });
    }, count);
    await browser.saveScreenshot(path.join(output, filename + ".png"));
    reports.push({ view, icons: report });
    console.log(
      "Verified " +
        view +
        ": " +
        report.length +
        " icons at16/24/32 on light/dark; no boundary calls.",
    );
  }
  await writeFile(
    path.join(output, rolesOnly ? "role-report.json" : "report.json"),
    JSON.stringify(reports, null, 2),
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
        path.basename(profile).startsWith("sorng-provider-icons-")
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
