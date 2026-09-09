#!/usr/bin/env node
/** Isolated, real-browser documentation QA. No app profile or credentials. */
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

export async function startDocsServer(directory) {
  const root = await realpath(directory);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      if (
        pathname !== "/sortOfRemoteNG" &&
        !pathname.startsWith("/sortOfRemoteNG/")
      ) {
        response.writeHead(404).end();
        return;
      }
      let file = path.resolve(
        root,
        "." + pathname.slice("/sortOfRemoteNG".length),
      );
      if (file !== root && !file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory())
        file = path.join(file, "index.html");
      file = await realpath(file);
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/sortOfRemoteNG`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export async function captureDocs({
  directory = ".artifacts/docs-review",
  output = ".artifacts/docs-visual",
  binary = process.env.DOCS_CHROME_BINARY ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
} = {}) {
  const { remote } = await import("webdriverio");
  const server = await startDocsServer(directory);
  const profile = await mkdtemp(path.join(os.tmpdir(), "sorng-docs-browser-"));
  let browser;
  const report = [];
  try {
    await mkdir(output, { recursive: true });
    browser = await remote({
      logLevel: "error",
      capabilities: {
        browserName: "chrome",
        "goog:chromeOptions": {
          binary,
          args: [
            "--headless=new",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            "--disable-background-networking",
          ],
        },
      },
    });
    for (const [label, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ]) {
      await browser.setWindowSize(width, height);
      // Chrome's outer-window minimum can otherwise silently turn 390px into 500px.
      await browser.setViewport({ width, height, devicePixelRatio: 1 });
      for (const route of [
        "",
        "getting-started/",
        "user-guide/",
        "architecture/",
        "releases/",
      ]) {
        await browser.url(`${server.url}/${route}`);
        await browser.$("main h1").waitForDisplayed();
        await browser.execute(() => {
          document.documentElement.style.scrollBehavior = "auto";
        });
        await browser.waitUntil(
          async () => browser.execute(() => document.readyState === "complete"),
          { timeout: 15000 },
        );
        const chooser = await browser.$("[data-release-chooser]");
        if (await chooser.isExisting()) {
          await browser
            .$("[data-release-os]")
            .selectByAttribute("value", "windows");
          await browser
            .$("[data-release-arch]")
            .selectByAttribute("value", "x86_64");
          await browser.waitUntil(
            async () => (await chooser.getAttribute("aria-busy")) === "false",
            { timeout: 20000 },
          );
        }
        if ((await browser.$$("pre.mermaid")).length) {
          await browser.waitUntil(
            async () =>
              browser.execute(() =>
                [...document.querySelectorAll("pre.mermaid")].every((node) =>
                  ["ready", "fallback"].includes(node.dataset.diagramState),
                ),
              ),
            { timeout: 20000 },
          );
        }
        const metrics = await browser.execute(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          title: document.title,
          heading: document.querySelector("h1")?.textContent,
          releaseStatus:
            document.querySelector("[data-release-status]")?.textContent ??
            null,
          diagrams: [...document.querySelectorAll("pre.mermaid")].map(
            (node) => ({
              rendered: Boolean(node.querySelector("svg")),
              readableText: Boolean(node.textContent?.trim()),
              state: node.dataset.diagramState,
              viewBox: node.querySelector("svg")?.getAttribute("viewBox"),
              svgStyle: node.querySelector("svg")?.getAttribute("style"),
              labels: [...node.querySelectorAll("svg .node")]
                .slice(0, 3)
                .map((label) => ({
                  text: label.textContent,
                  transform: label.getAttribute("transform"),
                  box: {
                    width: label.getBBox().width,
                    height: label.getBBox().height,
                  },
                  html: label.innerHTML.slice(0, 1200),
                })),
              graphBox: (() => {
                const box = node.querySelector("svg > g")?.getBBox();
                return box
                  ? { x: box.x, y: box.y, width: box.width, height: box.height }
                  : null;
              })(),
            }),
          ),
        }));
        if (metrics.width !== width)
          throw new Error(
            `Expected ${width}px viewport, got ${metrics.width}px`,
          );
        for (const diagram of metrics.diagrams) {
          if (diagram.state !== "ready") continue;
          const dimensions = diagram.viewBox?.split(/\s+/).map(Number);
          if (
            !dimensions ||
            dimensions[2] > 2000 ||
            dimensions[3] > 2000 ||
            diagram.labels.length === 0
          )
            throw new Error(
              `${route}: diagram layout is empty or unexpectedly oversized`,
            );
        }
        if (metrics.scrollWidth > metrics.width + 1)
          throw new Error(
            `${label}/${route}: horizontal overflow ${JSON.stringify(metrics)}`,
          );
        if (label === "mobile") {
          const toggle = await browser.$("[data-nav-toggle]");
          await toggle.click();
          const isolated = await browser.execute(
            () =>
              document.querySelector("main").inert &&
              !document.querySelector("#site-navigation").inert,
          );
          if (!isolated)
            throw new Error("Mobile navigation did not isolate the page");
          await browser.keys("Escape");
          if ((await toggle.getAttribute("aria-expanded")) !== "false")
            throw new Error("Escape did not close mobile navigation");
        }
        const name = `${route.replaceAll("/", "") || "home"}-${label}.png`;
        await browser.saveScreenshot(path.join(output, name));
        const diagrams = await browser.$$(".diagram-frame");
        for (let index = 0; index < diagrams.length; index++) {
          await browser.execute((element) => {
            element.style.scrollMarginTop = "80px";
            element.scrollIntoView({ behavior: "instant", block: "start" });
          }, diagrams[index]);
          await diagrams[index].saveScreenshot(
            path.join(
              output,
              `${route.replaceAll("/", "")}-${label}-diagram-${index + 1}.png`,
            ),
          );
        }
        report.push({ route, viewport: label, ...metrics, screenshot: name });
      }
    }
    await browser.url(`${server.url}/releases/#release-engineering`);
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector("#release-engineering")?.closest("details")
              ?.open === true,
        ),
      { timeout: 10000 },
    );
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: path.resolve(directory),
          note: "Actual built docs in isolated Chrome. Release API may be unavailable; screenshots retain its real status. No app data or live sessions used.",
          pages: report,
        },
        null,
        2,
      ),
    );
    return report;
  } finally {
    try {
      if (browser) await browser.deleteSession();
    } finally {
      try {
        await server.close();
      } finally {
        // Exact unique directory returned by mkdtemp, never a user browser profile.
        if (
          path.dirname(profile) === os.tmpdir() &&
          path.basename(profile).startsWith("sorng-docs-browser-")
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
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  captureDocs()
    .then((report) =>
      console.log(
        `Captured ${report.length} real docs views in .artifacts/docs-visual`,
      ),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
