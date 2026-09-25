// Focused real-CSS check: no account, proxy request, or remote service involved.
// Run with: node --test tests/tooling/cpanelDarkMode.browser-test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const browser =
  process.env.CPANEL_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);

test(
  "cPanel light and shadow headers are dark before rendering and restore on disable",
  {
    skip: browser
      ? false
      : "Set CPANEL_TEST_BROWSER to an installed Chromium browser",
    timeout: 30000,
  },
  async () => {
    const source = await readFile(
      new URL(
        "../../src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js",
        import.meta.url,
      ),
      "utf8",
    );
    const checks = async function () {
      const assert = (condition, name) => {
        if (!condition) throw new Error(name);
      };
      const color = (element) => getComputedStyle(element).backgroundColor;
      const dark = "rgb(49, 50, 51)";
      const controller = window.__sorngWebDarkModeDocument_v1;
      // The bootstrap starts the controller before the app supplies its command.
      assert(
        color(document.querySelector("nav")) === dark,
        "early document header",
      );
      const root = document
        .getElementById("host")
        .attachShadow({ mode: "open" });
      assert(root.querySelector("style"), "synchronous root palette");
      const header = document.createElement("div");
      header.className = "header";
      root.append(header);
      assert(color(header) === dark, "header is dark immediately on insertion");
      // An upstream important layer added after ours must not win.
      const sheet = document.createElement("style");
      sheet.textContent =
        "@layer page{.header{background:white!important;color:black!important}}";
      root.append(sheet);
      assert(color(header) === dark, "page layer cannot override header");
      const nestedHost = document.createElement("div");
      header.append(nestedHost);
      const nested = nestedHost.attachShadow({ mode: "open" });
      nested.innerHTML =
        '<style>.navbar{background:white!important;color:black!important}</style><nav class="navbar">Menu</nav>';
      // A replacement deletes our sheet; mutation delivery repairs it before paint.
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(
        color(nested.querySelector("nav")) === dark,
        "nested replacement repaired",
      );
      assert(color(nestedHost) === dark, "nested header host palette");
      header.style.setProperty("background", "white", "important");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(color(header) === dark, "inline override repaired");
      await controller.set({ enabled: false });
      assert(color(header) === "rgb(255, 255, 255)", "inline color restored");
      assert(
        !root.querySelector(".sorng-cpanel-shadow-dark"),
        "root sheet removed",
      );
      assert(
        !nested.querySelector(".sorng-cpanel-shadow-dark"),
        "nested sheet removed",
      );
    };
    const html = `<html><head><link href="/frontend/jupiter/theme.css" rel="stylesheet">
    <style id="__sorng_dark_bootstrap_v1" data-background-color="#181a1b" data-text-color="#e8e6e3"></style>
    <script>${source}</script></head><body id="cpanel_body"><nav class="navbar">Top bar</nav><div id="host"></div>
    <script>(${checks.toString()})().then(() => document.body.setAttribute('data-result','passed'), error => document.body.setAttribute('data-result', 'failed: ' + error.message));</script></body></html>`;
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", req.url === "/" ? "text/html" : "text/css");
      res.end(req.url === "/" ? html : ".navbar{background:white!important}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const profile = await mkdtemp(path.join(tmpdir(), "sorng-cpanel-dark-"));
    try {
      const { stdout } = await promisify(execFile)(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          `--user-data-dir=${profile}`,
          "--dump-dom",
          "--virtual-time-budget=2000",
          `http://127.0.0.1:${server.address().port}/`,
        ],
        { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 },
      );
      const result = /<body[^>]*data-result="([^"]*)"/.exec(stdout)?.[1];
      assert.equal(result, "passed");
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      // Only this test's fresh, absolute profile directory is removed.
      assert.equal(path.dirname(profile), path.resolve(tmpdir()));
      assert.ok(path.basename(profile).startsWith("sorng-cpanel-dark-"));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
