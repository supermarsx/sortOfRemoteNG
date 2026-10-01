// Real browser regression; synthetic cPanel DOM, no account or remote service.
// Run with: node --test tests/tooling/cpanelDarkMode.browser-test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  DevTools,
  decodePng,
  meanColor,
  relativeLuminance,
} from "../../scripts/test-website-dark-mode-browser.mjs";

const browserExited = (child) =>
  child.exitCode !== null || child.signalCode !== null;

async function waitForBrowserExit(child, timeout) {
  if (browserExited(child)) return true;
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off("exit", finish);
      resolve(browserExited(child));
    };
    const timer = setTimeout(finish, timeout);
    child.once("exit", finish);
  });
}

async function requestBrowserClose(profile) {
  const [port, endpoint] = (
    await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
  )
    .trim()
    .split(/\r?\n/u);
  assert.match(port, /^\d+$/u);
  assert.match(endpoint, /^\/devtools\/browser\/[\w-]+$/u);
  // This endpoint belongs to the unique temporary profile, never an existing
  // user browser. Bound both connection establishment and the close command.
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    const timer = setTimeout(
      () => finish(new Error("Browser.close timed out")),
      1500,
    );
    function finish(error) {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    }
    socket.addEventListener(
      "open",
      () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })),
      { once: true },
    );
    socket.addEventListener("close", () => finish(), { once: true });
    socket.addEventListener(
      "error",
      () => finish(new Error("Browser.close connection failed")),
      { once: true },
    );
  });
}

async function closeOwnedBrowser(child, graceful, force, timeout = 2000) {
  if (!child?.pid || browserExited(child)) return;
  // A close command can disconnect before its acknowledgement arrives.
  await graceful().catch(() => {});
  if (await waitForBrowserExit(child, timeout)) return;
  let killError;
  try {
    await force();
  } catch (error) {
    killError = error;
  }
  // taskkill can fail on an already-exiting renderer although it successfully
  // terminated our root. Trust the owned ChildProcess exit event, not its text.
  if (await waitForBrowserExit(child, timeout)) return;
  throw killError || new Error(`Owned browser ${child.pid} did not exit`);
}

test("browser cleanup prefers graceful exit and accepts an exited-root taskkill race", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
  });
  const exit = () => {
    child.exitCode = 0;
    child.emit("exit", 0, null);
  };
  let forced = false;
  await closeOwnedBrowser(
    child,
    async () => {
      exit();
    },
    async () => {
      forced = true;
    },
    1,
  );
  assert.equal(forced, false);
  child.exitCode = null;
  await closeOwnedBrowser(
    child,
    async () => {},
    async () => {
      setTimeout(exit, 0);
      throw new Error("child process operation unsupported");
    },
    20,
  );
  child.exitCode = null;
  await assert.rejects(
    closeOwnedBrowser(
      child,
      async () => {},
      async () => {
        throw new Error("root still alive");
      },
      1,
    ),
    /root still alive/u,
  );
});

// Record compositor frames, not a computed-style read inside an rAF callback.
// Keep a failing PNG and its measurements outside the disposable profile.
async function captureCpanelPaint(profile, url, regions) {
  const deadline = Date.now() + 5000;
  let endpoint;
  while (!endpoint && Date.now() < deadline) {
    const lines = await readFile(
      path.join(profile, "DevToolsActivePort"),
      "utf8",
    )
      .then((text) => text.split(/\r?\n/u))
      .catch(() => []);
    if (lines[1]) endpoint = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
    else await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(endpoint, "browser debugging endpoint available");
  const devtools = await DevTools.connect(endpoint);
  try {
    const { targetInfos } = await devtools.send("Target.getTargets");
    const target = targetInfos.find(
      (item) => item.type === "page" && item.url === url,
    );
    assert.ok(target, "local fixture target");
    const { sessionId } = await devtools.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const send = (method, params = {}) =>
      devtools.send(method, params, sessionId, 5000);
    const samples = [];
    let failedPng;
    let captureError;
    devtools.on((method, params, owner) => {
      if (owner !== sessionId || method !== "Page.screencastFrame") return;
      void send("Page.screencastFrameAck", {
        sessionId: params.sessionId,
      }).catch(() => {});
      try {
        const png = Buffer.from(params.data, "base64");
        const image = decodePng(png);
        const colors = regions.map((region) => meanColor(image, region));
        const white = colors.map(
          (color, index) =>
            regions[index].kind !== "marker" && relativeLuminance(color) > 0.8,
        );
        samples.push({ timestamp: params.metadata.timestamp, colors, white });
        if (white.some(Boolean) && !failedPng) failedPng = png;
      } catch (error) {
        captureError = error;
      }
    });
    await send("Page.enable");
    await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    return {
      async stop() {
        try {
          await send("Page.stopScreencast");
          if (captureError) throw captureError;
          const markersVisible = samples.every((sample) =>
            regions.every(
              (region, index) =>
                region.kind !== "marker" ||
                ["rgb(220, 40, 60)", "rgb(40, 100, 220)"].includes(
                  sample.colors[index],
                ),
            ),
          );
          const result = {
            samples: samples.length,
            whiteFrames: samples.filter((sample) => sample.white.some(Boolean))
              .length,
            markersVisible,
            markerSeen: samples.some((sample) =>
              regions.some(
                (region, index) =>
                  region.kind === "marker" &&
                  ["rgb(220, 40, 60)", "rgb(40, 100, 220)"].includes(
                    sample.colors[index],
                  ),
              ),
            ),
          };
          if (failedPng) {
            const artifacts = await mkdtemp(
              path.join(tmpdir(), "sorng-cpanel-paint-evidence-"),
            );
            await writeFile(path.join(artifacts, "white-frame.png"), failedPng);
            await writeFile(
              path.join(artifacts, "samples.json"),
              JSON.stringify({ regions, samples }, null, 2),
            );
            result.artifacts = artifacts;
          }
          return result;
        } finally {
          devtools.close();
        }
      },
      close() {
        devtools.close();
      },
    };
  } catch (error) {
    devtools.close();
    throw error;
  }
}

// Optional read-only baseline: CPANEL_TEST_RUNTIME_REF=HEAD. git show supplies
// bytes to the fixture server; the independently edited runtime is never replaced.
async function runtimeSource() {
  const relative =
    "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js";
  if (process.env.CPANEL_TEST_RUNTIME_REF) {
    const { stdout } = await promisify(execFile)(
      "git",
      ["show", `${process.env.CPANEL_TEST_RUNTIME_REF}:${relative}`],
      { cwd: new URL("../../", import.meta.url), maxBuffer: 1024 * 1024 },
    );
    return stdout;
  }
  return readFile(new URL(`../../${relative}`, import.meta.url), "utf8");
}

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
    const source = await runtimeSource();
    const checks = async function () {
      const assert = (condition, name) => {
        if (!condition) throw new Error(name);
      };
      const color = (element) => getComputedStyle(element).backgroundColor;
      const eventually = async (predicate, name) => {
        const deadline = performance.now() + 1500;
        while (!predicate()) {
          assert(performance.now() < deadline, name);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
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
      // Repair uses a 16ms timer; poll with a meaningful eventual deadline.
      await eventually(
        () => color(nested.querySelector("nav")) === dark,
        "nested replacement repaired within 1.5s",
      );
      assert(color(nestedHost) === dark, "nested header host palette");
      header.style.setProperty("background", "white", "important");
      await eventually(
        () => color(header) === dark,
        "inline override repaired within 1.5s",
      );
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

// Real wall-clock timers and a Node watchdog: a timeout inside the renderer
// cannot diagnose a microtask loop that prevents all browser timers from firing.
async function dynamicBrowser(
  t,
  checks,
  capturePaint = false,
  stalledLogin = false,
) {
  const [source, bundle] = await Promise.all([
    runtimeSource(),
    readFile(
      new URL(
        "../../src-tauri/crates/sorng-protocols/src/vendor/darkreader/darkreader.js",
        import.meta.url,
      ),
    ),
  ]);
  t.diagnostic(
    `runtime SHA-256 ${createHash("sha256").update(source).digest("hex")}`,
  );
  let paintShield = "";
  if (capturePaint) {
    const rust = await readFile(
      new URL(
        "../../src-tauri/crates/sorng-protocols/src/http_dark_mode.rs",
        import.meta.url,
      ),
      "utf8",
    );
    const match =
      /fn paint_shield\(&self\)[\s\S]*?Some\(format!\(\s*("(?:\\.|[^"\\])*")\s*,\s*self\.background_color,\s*\)\)/u.exec(
        rust,
      );
    assert.ok(match, "native paint shield template");
    paintShield = JSON.parse(match[1]).replace(/\{\{|\}\}|\{\}/gu, (part) =>
      part === "{}" ? "#181a1b" : part[0],
    );
  }
  // Mirror the native bootstrap's loading/canvas layers. This test exercises
  // JS adoption and computed CSS; Rust bootstrap generation has separate tests.
  const bootstrap = `<style id="__sorng_dark_bootstrap_v1" class="darkreader" data-background-color="#181a1b" data-text-color="#e8e6e3">
    @layer sorng-force-dark,sorng-dark-loading;
    @layer sorng-force-dark{html:root,html:root body{background-color:#181a1b!important;color:#e8e6e3!important}}
    @layer sorng-dark-loading{html:root:not([data-sorng-dark-ready]) body :not(iframe):not(img):not(video):not(canvas):not(svg):not(svg *){background-color:transparent!important;color:#e8e6e3!important;transition:none!important}}
    </style>${paintShield}`;
  const loginMarkup = stalledLogin
    ? /export const porkbunLoginHtml = `([\s\S]*)`;/u.exec(
        await readFile(
          new URL("../protocol/fixtures/porkbunLogin.ts", import.meta.url),
          "utf8",
        ),
      )?.[1]
    : "";
  if (stalledLogin) assert.ok(loginMarkup, "saved public Porkbun form fixture");
  const fixture = (frame) => `<!doctype html><html><head>${bootstrap}
    <link rel="stylesheet" href="/frontend/jupiter/theme.css"><script src="/runtime.js"></script>
    </head><body ${stalledLogin ? 'class="bodyDefault"' : 'id="cpanel_body"'}><div class="unconverted">Opaque arbitrary upstream surface</div>
    <script>window.firstPaint = {background: getComputedStyle(document.querySelector('.unconverted')).backgroundColor, text: getComputedStyle(document.querySelector('.unconverted')).color, canvas: getComputedStyle(document.body).backgroundColor};</script>
    <nav class="navbar">Menu</nav><main id="content">${stalledLogin && !frame ? loginMarkup : ""}</main>
    ${frame ? "" : '<iframe src="/frame" title="cPanel child dashboard"></iframe><script src="/checks.js"></script>'}
    ${stalledLogin && !frame ? '<script src="/stalled-footer-sdk.js"></script>' : ""}
    </body></html>`;
  const script = `(${async function (checks) {
    const assert = (condition, name) => {
      if (!condition) throw new Error(name);
    };
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const eventually = async (predicate, name, timeout = 2000) => {
      const deadline = performance.now() + timeout;
      while (!predicate()) {
        assert(performance.now() < deadline, name);
        await delay(25);
      }
    };
    const report = (value, endpoint = "progress") =>
      fetch(`/${endpoint}`, { method: "POST", body: JSON.stringify(value) });
    window.addEventListener(
      "error",
      (event) => void report({ error: event.message }, "result"),
    );
    window.addEventListener(
      "unhandledrejection",
      (event) => void report({ error: String(event.reason) }, "result"),
    );
    try {
      await eventually(
        () =>
          document.querySelector('iframe[src="/frame"]').contentWindow
            .firstPaint,
        "child frame loaded",
      );
      const metrics = await checks({ assert, delay, eventually, report });
      await report({ passed: true, metrics }, "result");
    } catch (error) {
      await report({ error: error.stack || error.message }, "result");
    }
  }})(${checks});`;
  const assets = new Map([
    ["/", ["text/html", fixture(false)]],
    ["/frame", ["text/html", fixture(true)]],
    ["/runtime.js", ["text/javascript", source]],
    ["/checks.js", ["text/javascript", script]],
    [
      "/frontend/jupiter/theme.css",
      [
        "text/css",
        ".unconverted{background:white;color:black}.navbar,.panel-heading{background:white!important;color:black!important}.panel,.panel-body{background:#fafafa;color:#111}.metric{background:#eee;color:#222}",
      ],
    ],
    ["/__sortofremoteng_web_darkreader_v1.js", ["text/javascript", bundle]],
  ]);
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  let lastProgress = null;
  let engineRequests = 0;
  let camera;
  const server = createServer(async (req, res) => {
    // Keep the parser genuinely blocked after visible login content, not a
    // mocked readyState. Only the fixture-owned server connection is held.
    if (stalledLogin && req.url === "/stalled-footer-sdk.js") return;
    if (stalledLogin && req.url === "/__sortofremoteng_web_darkreader_v1.js") {
      engineRequests++;
      return;
    }
    if (capturePaint && req.method === "POST" && req.url === "/paint-start") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        camera = await captureCpanelPaint(
          profile,
          `http://127.0.0.1:${server.address().port}/`,
          JSON.parse(body),
        );
        res.writeHead(204).end();
      } catch (error) {
        finish({ error: error.stack });
        res.writeHead(500).end();
      }
      return;
    }
    if (capturePaint && req.method === "POST" && req.url === "/paint-stop") {
      try {
        const pixels = await camera.stop();
        camera = null;
        t.diagnostic(`Compositor pixels: ${JSON.stringify(pixels)}`);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(pixels));
      } catch (error) {
        finish({ error: error.stack });
        res.writeHead(500).end();
      }
      return;
    }
    if (req.method === "POST" && ["/progress", "/result"].includes(req.url)) {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const value = JSON.parse(body);
        if (req.url === "/result") finish(value);
        else lastProgress = value;
        res.writeHead(204).end();
      } catch (error) {
        finish({ error: error.message });
        res.writeHead(400).end();
      }
      return;
    }
    const asset = assets.get(req.url);
    if (!asset) {
      res.writeHead(404).end();
      return;
    }
    if (req.url === "/__sortofremoteng_web_darkreader_v1.js") engineRequests++;
    res.setHeader("Content-Type", asset[0]);
    res.setHeader("Cache-Control", "no-store");
    res.end(asset[1]);
  });
  const profile = await mkdtemp(path.join(tmpdir(), "sorng-cpanel-dark-"));
  let child;
  let deadline;
  let stderr = "";
  let primaryError;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    child = spawn(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        ...(capturePaint
          ? ["--force-device-scale-factor=1", "--window-size=800,800"]
          : []),
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${server.address().port}/`,
      ],
      {
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.once("error", (error) => finish({ error: error.message }));
    child.once("exit", (code, signal) =>
      finish({ error: `Browser exited: ${code ?? signal}` }),
    );
    deadline = setTimeout(
      () => finish({ error: "Browser wall-clock deadline (35s) exceeded" }),
      35000,
    );
    const outcome = await result;
    assert.equal(
      outcome.passed,
      true,
      `${outcome.error}; engineRequests=${engineRequests}; last progress=${JSON.stringify(lastProgress)}; browser=${stderr}`,
    );
    t.diagnostic(JSON.stringify({ engineRequests, ...outcome.metrics }));
    return { engineRequests, ...outcome.metrics };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    clearTimeout(deadline);
    camera?.close();
    try {
      await closeOwnedBrowser(
        child,
        () => requestBrowserClose(profile),
        async () => {
          // Only this test's fresh browser process tree, including hung renderers.
          if (process.platform === "win32")
            await promisify(execFile)(
              "taskkill",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, timeout: 5000 },
            );
          else process.kill(-child.pid, "SIGKILL");
        },
      );
    } catch (error) {
      if (!primaryError) primaryError = error;
      else t.diagnostic(`Browser cleanup also failed: ${error.message}`);
    }
    try {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.equal(path.dirname(profile), path.resolve(tmpdir()));
      assert.ok(path.basename(profile).startsWith("sorng-cpanel-dark-"));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (error) {
      if (!primaryError) primaryError = error;
      else t.diagnostic(`Fixture cleanup also failed: ${error.message}`);
    }
    if (primaryError) throw primaryError;
  }
}

const dynamicOptions = {
  skip: browser
    ? false
    : "Set CPANEL_TEST_BROWSER to an installed Chromium browser",
  timeout: 45000,
};

test(
  "a stalled footer script cannot leave a ready dark login behind its paint shield",
  dynamicOptions,
  async (t) => {
    await dynamicBrowser(
      t,
      async ({ assert, eventually, delay }) => {
        const login = document.getElementById("loginForm");
        assert(
          login && login.target === "lame_login_iframe",
          "saved Porkbun form parsed before stalled script",
        );
        const marker = document.createElement("canvas");
        marker.width = marker.height = 24;
        marker.style.cssText =
          "position:fixed;left:40px;top:40px;width:24px;height:24px";
        login.append(marker);
        const context = marker.getContext("2d");
        context.fillStyle = "rgb(220,40,60)";
        context.fillRect(0, 0, 24, 24);
        const controller = window.__sorngWebDarkModeDocument_v1;
        assert(document.readyState === "loading", "footer SDK blocks parsing");
        await fetch("/paint-start", {
          method: "POST",
          body: JSON.stringify([
            { x: 400, y: 400, width: 24, height: 24 },
            { x: 40, y: 40, width: 24, height: 24, kind: "marker" },
          ]),
        });
        const started = performance.now();
        const outcome = await controller.set({ enabled: true });
        assert(
          outcome === "cssOnly",
          "real engine loader falls back while parser is blocked",
        );
        assert(
          performance.now() - started >= 3900,
          "real engine asset deadline exercised",
        );
        await eventually(
          () =>
            document.documentElement.hasAttribute("data-sorng-dark-presented"),
          "ready palette uncovers parsed login while SDK remains stalled",
        );
        assert(
          document.readyState === "loading",
          "did not wait for DOMContentLoaded",
        );
        assert(
          getComputedStyle(document.documentElement, "::after").content ===
            "none",
          "native shield no longer covers content",
        );
        assert(
          getComputedStyle(document.body).backgroundColor === "rgb(24, 26, 27)",
          "body remains dark",
        );
        assert(
          getComputedStyle(document.getElementById("loginUsername")).color ===
            "rgb(232, 230, 227)",
          "login text is readable",
        );
        assert(
          document.getElementById("loginUsername").getBoundingClientRect()
            .width > 0,
          "form has visible layout",
        );
        await delay(150);
        const pixels = await fetch("/paint-stop", { method: "POST" }).then(
          (response) => response.json(),
        );
        assert(
          pixels.samples > 0 && pixels.whiteFrames === 0,
          "no light frame during engine wait and fallback",
        );
        assert(
          pixels.markerSeen,
          "form marker painted after shield release while parsing is still blocked",
        );
        return {
          parserStillLoading: true,
          shieldReleased: true,
          outcome,
          ...pixels,
        };
      },
      true,
      true,
    );
  },
);

test(
  "cPanel after-ready inline mutations stay dark in compositor pixels",
  dynamicOptions,
  async (t) => {
    await dynamicBrowser(
      t,
      async ({ assert, delay, eventually }) => {
        const documents = [
          document,
          document.querySelector("iframe").contentDocument,
        ];
        const frame = document.querySelector("iframe");
        frame.style.cssText =
          "position:fixed;left:0;top:240px;width:700px;height:240px;border:0";
        const headers = [];
        const markers = [];
        for (const doc of documents) {
          doc.body.style.margin = "0";
          const header = doc.createElement("header");
          header.className = "panel-heading";
          header.style.cssText =
            "position:fixed;left:0;top:0;width:300px;height:100px";
          doc.body.append(header);
          const host = doc.createElement("div");
          host.style.cssText =
            "position:fixed;left:320px;top:0;width:300px;height:100px";
          doc.body.append(host);
          const shadow = host.attachShadow({ mode: "open" });
          shadow.innerHTML =
            '<header class="panel-heading" style="display:block;width:300px;height:100px"></header>';
          headers.push(header, shadow.querySelector("header"));
          const marker = doc.createElement("canvas");
          marker.width = marker.height = 20;
          marker.style.cssText =
            "position:fixed;left:40px;top:130px;width:20px;height:20px";
          doc.body.append(marker);
          const context = marker.getContext("2d");
          context.fillStyle = "rgb(220,40,60)";
          context.fillRect(0, 0, 20, 20);
          markers.push(context);
        }
        const controller = window.__sorngWebDarkModeDocument_v1;
        assert(
          (await controller.set({ enabled: true })) === "engine",
          "real engine active",
        );
        await eventually(
          () =>
            documents.every((doc) =>
              doc.documentElement.hasAttribute("data-sorng-dark-presented"),
            ),
          "both documents presented",
        );
        const regions = [
          { x: 40, y: 40, width: 20, height: 20 },
          { x: 360, y: 40, width: 20, height: 20 },
          { x: 40, y: 280, width: 20, height: 20 },
          { x: 360, y: 280, width: 20, height: 20 },
          { x: 40, y: 130, width: 20, height: 20, kind: "marker" },
          { x: 40, y: 370, width: 20, height: 20, kind: "marker" },
        ];
        await fetch("/paint-start", {
          method: "POST",
          body: JSON.stringify(regions),
        });
        await delay(100);
        // Existing light/shadow headers in both documents are reset by a dashboard
        // update during a rendering opportunity. No timer overrides or engine mocks.
        for (let tick = 0; tick < 40; tick++) {
          await delay(50);
          await new Promise((resolve) =>
            requestAnimationFrame(() => {
              for (const header of headers)
                header.style.setProperty(
                  "background-color",
                  "white",
                  "important",
                );
              for (const context of markers) {
                context.fillStyle =
                  tick % 2 ? "rgb(220,40,60)" : "rgb(40,100,220)";
                context.fillRect(0, 0, 20, 20);
              }
              resolve();
            }),
          );
        }
        await delay(150);
        const pixels = await fetch("/paint-stop", { method: "POST" }).then(
          (response) => response.json(),
        );
        assert(pixels.samples >= 10, "at least ten compositor frames sampled");
        assert(
          pixels.markersVisible,
          "content markers stay visible in both documents; no opaque shield",
        );
        assert(pixels.whiteFrames === 0, JSON.stringify(pixels));
        // A deliberately competing page observer must not turn a fast repair into
        // an infinite microtask feedback loop. The Node watchdog guards this phase.
        let reactions = 0;
        let beats = 0;
        let maxGap = 0;
        let lastBeat = performance.now();
        const heartbeat = setInterval(() => {
          const now = performance.now();
          maxGap = Math.max(maxGap, now - lastBeat);
          lastBeat = now;
          beats++;
        }, 16);
        const competitors = headers.map((header) => {
          const observer = new MutationObserver(() => {
            reactions++;
            if (header.style.backgroundColor !== "white")
              header.style.setProperty(
                "background-color",
                "white",
                "important",
              );
          });
          observer.observe(header, {
            attributes: true,
            attributeFilter: ["style"],
          });
          return observer;
        });
        try {
          for (const header of headers)
            header.style.setProperty("background-color", "white", "important");
          await delay(500);
        } finally {
          competitors.forEach((observer) => observer.disconnect());
          clearInterval(heartbeat);
        }
        assert(
          beats >= 10 && maxGap < 500,
          `heartbeat: ${beats} beats, ${maxGap}ms gap`,
        );
        assert(reactions < 1000, `bounded feedback: ${reactions} reactions`);
        await eventually(
          () =>
            headers.every(
              (header) =>
                getComputedStyle(header).backgroundColor === "rgb(49, 50, 51)",
            ),
          "headers recover after competing observer stops",
        );
        assert(
          documents.every((doc) =>
            doc.documentElement.hasAttribute("data-sorng-dark-presented"),
          ),
          "feedback never blanks documents",
        );
        await controller.set({ enabled: false });
        await delay(100);
        assert(
          headers.every((header) => header.style.backgroundColor === "white"),
          "disable restores latest site colors and cancels repairs",
        );
        return { ...pixels, beats, maxGap, reactions };
      },
      true,
    );
  },
);

test(
  "dark icons preserve sprite paints and SVG geometry, settle and restore on disable",
  dynamicOptions,
  async (t) => {
    await dynamicBrowser(t, async ({ assert, delay, eventually }) => {
      const controller = window.__sorngWebDarkModeDocument_v1;
      await controller.set({ enabled: false });
      const fixture = document.createElement("section");
      fixture.innerHTML = `<style>
        .icon-sprite,.icon-sprite::before{background-image:linear-gradient(red,blue)!important}
        .icon-font::before{content:'X';-webkit-text-fill-color:black!important;color:black}
        .not-an-icon{background:white!important;background-image:linear-gradient(white,white)!important}
        svg{width:24px;height:24px}
      </style>
      <span class="icon-sprite" style="background-image:linear-gradient(red,blue)!important">sprite</span>
      <i class="icon-font"></i><div class="not-an-icon">panel</div>
      <svg id="fixed"><path fill="black" d="M3 3h18v18H3z"/></svg>
      <svg id="default"><path d="M3 3h18v18H3z"/></svg>
      <svg id="current"><path fill="currentColor" d="M3 3h18v18H3z"/></svg>
      <svg id="stroke" fill="none" stroke="black"><path d="M3 3L21 21"/></svg>
      <svg id="brand"><path fill="red" d="M3 3h9v18H3z"/><path fill="blue" d="M12 3h9v18h-9z"/></svg>
      <svg id="media"><image href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"/></svg>
      <img id="photo" alt="unchanged" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">`;
      document.body.append(fixture);
      const element = (id) => fixture.querySelector(`#${id}`);
      const sprite = fixture.querySelector(".icon-sprite");
      const font = fixture.querySelector(".icon-font");
      const originalSprite = getComputedStyle(sprite).backgroundImage;
      await controller.set({
        enabled: true,
        cssOnly: true,
      });
      await eventually(
        () => element("fixed").style.filter.includes("drop-shadow"),
        "fixed dark glyph outlined",
      );
      for (const id of ["fixed", "default", "stroke"])
        assert(
          element(id).style.filter.includes("drop-shadow"),
          `${id} low-contrast icon outlined`,
        );
      assert(
        getComputedStyle(element("stroke")).fill === "none",
        "fill=none preserved",
      );
      assert(
        getComputedStyle(element("fixed").firstElementChild).fill ===
          "rgb(0, 0, 0)",
        "fixed fill untouched",
      );
      assert(
        getComputedStyle(element("current").firstElementChild).fill ===
          "rgb(232, 230, 227)",
        "currentColor follows theme",
      );
      for (const id of ["brand", "media", "photo", "current"])
        assert(!element(id).style.filter, `${id} not altered`);
      assert(
        getComputedStyle(sprite).backgroundImage === originalSprite,
        "inline sprite retained",
      );
      assert(
        getComputedStyle(sprite, "::before").backgroundImage !== "none",
        "pseudo sprite retained",
      );
      assert(
        getComputedStyle(font, "::before").webkitTextFillColor ===
          "rgb(232, 230, 227)",
        "icon font fill follows theme",
      );
      assert(
        getComputedStyle(fixture.querySelector(".not-an-icon"))
          .backgroundImage === "none",
        "panel background still protected",
      );
      let writes = 0;
      const observer = new MutationObserver((records) => {
        writes += records.length;
      });
      observer.observe(element("fixed"), {
        attributes: true,
        attributeFilter: ["style"],
      });
      element("fixed").firstElementChild.setAttribute("fill", "#010101");
      await delay(200);
      assert(writes < 3, "owned filters do not loop");
      observer.disconnect();
      element("fixed").firstElementChild.setAttribute("fill", "white");
      await eventually(
        () => !element("fixed").style.filter,
        "now-visible glyph releases outline",
      );
      await controller.set({ enabled: false });
      for (const id of ["default", "stroke"])
        assert(!element(id).style.filter, "disable restores filter");
      assert(
        getComputedStyle(font, "::before").webkitTextFillColor ===
          "rgb(0, 0, 0)",
        "disable restores font",
      );
      assert(
        getComputedStyle(sprite).backgroundImage === originalSprite,
        "disable preserves sprite",
      );
      const many = document.createElement("div");
      many.innerHTML = '<svg><path d="M3 3h18v18H3z"/></svg>'.repeat(320);
      fixture.append(many);
      let beats = 0;
      const heartbeat = setInterval(() => {
        beats++;
      }, 10);
      try {
        await controller.set({ enabled: true, cssOnly: true });
        await eventually(
          () => many.lastElementChild.style.filter.includes("drop-shadow"),
          "large icon collection processed without starvation",
          4000,
        );
        assert(beats > 5, "icon discovery yields to other tasks");
        await controller.set({ enabled: false });
        assert(
          Array.from(many.children).every((svg) => !svg.style.filter),
          "all batched icons restore",
        );
      } finally {
        clearInterval(heartbeat);
      }
      return { iconsRestored: true, writes };
    });
  },
);

test(
  "shadow ancestor traversal stops at a document with a named host form",
  dynamicOptions,
  async (t) => {
    await dynamicBrowser(t, async ({ assert, delay }) => {
      const named = document.createElement("form");
      named.name = "host";
      document.body.append(named);
      assert(
        document.host === named,
        "browser exposes named form as document.host",
      );
      const host = document.createElement("div");
      document.body.append(host);
      // Both initial theming and later class updates must terminate. A Document
      // named property is not the ShadowRoot.host relationship.
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = "<header>Header</header>";
      document.body.classList.add("dashboard-ready");
      await delay(100);
      assert(
        root.querySelector(".sorng-cpanel-shadow-dark"),
        "shadow palette installed",
      );
      window.__sorngWebDarkModeDocument_v1.dispose(false);
      return { namedHostTraversalCompleted: true };
    });
  },
);

test(
  "cPanel bootstrap preserves arbitrary light surfaces before the host command, including frames",
  dynamicOptions,
  async (t) => {
    const result = await dynamicBrowser(t, async ({ assert, delay }) => {
      const documents = [
        document,
        document.querySelector("iframe").contentDocument,
      ];
      for (const doc of documents) {
        const first = doc.defaultView.firstPaint;
        assert(
          first.background === "rgba(0, 0, 0, 0)",
          "first-paint arbitrary surface protected",
        );
        assert(
          first.text === "rgb(232, 230, 227)" &&
            first.canvas === "rgb(24, 26, 27)",
          "first-paint dark canvas and legible text",
        );
      }
      await delay(150);
      for (const doc of documents) {
        const computed = doc.defaultView.getComputedStyle(
          doc.querySelector(".unconverted"),
        );
        assert(
          computed.backgroundColor === "rgba(0, 0, 0, 0)" &&
            computed.color === "rgb(232, 230, 227)",
          "loading palette survives until host command",
        );
        assert(!doc.defaultView.DarkReader, "no engine before host command");
      }
      return { firstPaintDocuments: documents.length };
    });
    assert.equal(result.engineRequests, 0);
  },
);

test(
  "cPanel actual DarkReader stays responsive with dynamic DOM, nested shadows and a frame",
  dynamicOptions,
  async (t) => {
    const result = await dynamicBrowser(
      t,
      async ({ assert, delay, eventually, report }) => {
        const controller = window.__sorngWebDarkModeDocument_v1;
        const documents = [
          document,
          document.querySelector("iframe").contentDocument,
        ];
        const roots = [...documents];
        const shadowRoots = [];
        const metrics = {
          phase: "build",
          beats: 0,
          maxHeartbeatGapMs: 0,
          mutations: 0,
          updates: 0,
        };
        let previousBeat = performance.now();
        const heartbeat = setInterval(() => {
          const now = performance.now();
          metrics.maxHeartbeatGapMs = Math.max(
            metrics.maxHeartbeatGapMs,
            now - previousBeat,
          );
          previousBeat = now;
          metrics.beats++;
          if (metrics.beats % 5 === 0) void report(metrics);
        }, 50);
        const observer = new MutationObserver((records) => {
          metrics.mutations += records.length;
        });
        const observe = (root) =>
          observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
        const markup = (i) =>
          `<section class="panel"><header class="panel-heading">Panel ${i}</header><div class="panel-body">${'<span class="metric">42</span>'.repeat(12)}</div></section>`;
        // Real engine, synthetic workload. No mocked DarkReader or invented page
        // MutationObserver that writes back in response to the engine's own writes.
        for (const doc of documents) {
          observe(doc);
          const content = doc.getElementById("content");
          content.innerHTML = Array.from({ length: 200 }, (_, i) =>
            markup(i),
          ).join("");
          for (let i = 0; i < 4; i++) {
            const host = doc.createElement("div");
            content.append(host);
            const root = host.attachShadow({ mode: "open" });
            root.innerHTML = `<style>.panel-heading{background:white!important;color:black!important}</style>${markup(i)}<div class="nested"></div>`;
            const nested = root
              .querySelector(".nested")
              .attachShadow({ mode: "open" });
            nested.innerHTML =
              '<style>.navbar{background:white!important;color:black!important}</style><nav class="navbar">Nested menu</nav><span class="metric">0</span>';
            for (const shadow of [root, nested]) {
              roots.push(shadow);
              shadowRoots.push(shadow);
              observe(shadow);
            }
          }
        }
        metrics.lightElements = documents.reduce(
          (count, doc) =>
            count + doc.getElementById("content").querySelectorAll("*").length,
          0,
        );
        metrics.shadowRoots = shadowRoots.length;
        const color = (element) =>
          element.ownerDocument.defaultView.getComputedStyle(element)
            .backgroundColor;
        const dark = "rgb(49, 50, 51)";
        const allDark = () =>
          roots.every((root) =>
            [...root.querySelectorAll("header,nav")].every(
              (header) => color(header) === dark,
            ),
          );
        const ownedSheets = () =>
          roots.reduce(
            (count, root) =>
              count +
              root.querySelectorAll(
                "style.darkreader,style.sorng-cpanel-shadow-dark,style.sorng-website-dark-mode,style#__sorng_dark_bootstrap_v1",
              ).length,
            0,
          );
        // The pinned vendor removes shadow inline/override/sync sheets on disable
        // but retains an empty invert placeholder. Accept only that inert residue;
        // every application palette and every active engine rule must be gone.
        const cleaned = () =>
          roots.every((root) => {
            const remaining = [
              ...root.querySelectorAll(
                "style.darkreader,style.sorng-cpanel-shadow-dark,style.sorng-website-dark-mode,style#__sorng_dark_bootstrap_v1",
              ),
            ];
            return (
              remaining.length <= (root.nodeType === 11 ? 1 : 0) &&
              remaining.every(
                (sheet) =>
                  sheet.className === "darkreader darkreader--invert" &&
                  sheet.sheet?.cssRules.length === 0 &&
                  !sheet.textContent.trim(),
              )
            );
          });
        const noDuplicates = () => {
          for (const doc of documents) {
            assert(
              doc.querySelectorAll("#__sorng_dark_bootstrap_v1").length === 1,
              "one document bootstrap",
            );
            assert(
              doc.querySelectorAll(".sorng-website-dark-mode").length === 1,
              "one runtime sheet per document",
            );
          }
          for (const root of shadowRoots)
            assert(
              root.querySelectorAll(".sorng-cpanel-shadow-dark").length === 1,
              "one palette per shadow root",
            );
          for (const root of roots) {
            for (const kind of [
              "fallback",
              "user-agent",
              "inline",
              "override",
              "invert",
              "variables",
              "root-vars",
            ]) {
              assert(
                root.querySelectorAll(`.darkreader--${kind}`).length <= 1,
                `no duplicate DarkReader ${kind}`,
              );
            }
            const sources = root.querySelectorAll(
              'style:not(.darkreader),link[rel="stylesheet"]',
            ).length;
            assert(
              root.querySelectorAll(".darkreader--sync").length <= sources,
              "no duplicate converted sheets",
            );
          }
        };
        const active = () => {
          metrics.engines = documents.map((doc) => ({
            enabled: doc.defaultView.DarkReader?.isEnabled() === true,
            mode: doc.documentElement.dataset.darkreaderMode,
            // DarkReader writes CSSOM rules; textContent can legitimately be empty.
            rules: [...doc.querySelectorAll(".darkreader--sync")].reduce(
              (count, sheet) => count + (sheet.sheet?.cssRules.length || 0),
              0,
            ),
            ready: doc.documentElement.hasAttribute("data-sorng-dark-ready"),
          }));
          return metrics.engines.every(
            (engine) =>
              engine.enabled &&
              engine.mode === "dynamic" &&
              engine.rules > 0 &&
              engine.ready,
          );
        };
        try {
          metrics.phase = "enable";
          await report(metrics);
          assert(
            (await controller.set({ enabled: true })) === "engine",
            "actual engine outcome, not CSS fallback",
          );
          await eventually(
            active,
            "real DarkReader converted top document and child frame",
            5000,
          );
          for (const root of roots) {
            const doc = root.ownerDocument || root;
            const lateStyle = doc.createElement("style");
            lateStyle.textContent =
              "@layer late-site{.surface{background:white!important;color:black!important;background-image:linear-gradient(white,white)!important}}";
            (root.head || root).append(lateStyle);
            const surface = doc.createElement("section");
            surface.className = "surface";
            surface.innerHTML =
              '<img alt="preserved media" style="background-color:rgb(255,0,0)">Late panel';
            (root.body || root).append(surface);
            // Read synchronously, before the engine sees either mutation.
            const computed = doc.defaultView.getComputedStyle(surface);
            assert(
              computed.backgroundColor === "rgb(24, 26, 27)",
              "late panel dark before engine processing",
            );
            assert(
              computed.backgroundImage === "none",
              "late white gradient suppressed",
            );
            assert(
              computed.color === "rgb(232, 230, 227)",
              "late panel text remains readable",
            );
            assert(
              color(surface.querySelector("img")) === "rgb(255, 0, 0)",
              "media color preserved",
            );
          }
          metrics.phase = "updates";
          const beatsBefore = metrics.beats;
          for (let tick = 0; tick < 20; tick++) {
            await delay(75);
            for (const doc of documents) {
              const content = doc.getElementById("content");
              content.querySelectorAll(".metric").forEach((node, i) => {
                if (i % 24 === 0) node.textContent = String(tick + i);
              });
              content.children[tick].classList.toggle("updated");
              content
                .querySelectorAll("header")
                [tick].style.setProperty(
                  "background-color",
                  "white",
                  "important",
                );
            }
            for (const root of shadowRoots) {
              root.querySelector(".metric").textContent = String(tick);
              root
                .querySelector("header,nav")
                .style.setProperty("background-color", "white", "important");
            }
            // Delete an entire nested component, including both engines' sheets.
            if (tick === 5 || tick === 12)
              shadowRoots[1].innerHTML =
                '<style>.navbar{background:white!important;color:black!important}</style><nav class="navbar">Replaced menu</nav><span class="metric">1</span>';
            metrics.updates++;
          }
          assert(
            metrics.beats - beatsBefore >= 15,
            "timer heartbeat advanced during updates",
          );
          await eventually(
            allDark,
            "all document and nested shadow headers dark",
          );
          metrics.phase = "idle";
          await delay(750);
          noDuplicates();
          const sheetsBefore = ownedSheets();
          metrics.idleMutations = [];
          for (let sample = 0; sample < 2; sample++) {
            const before = metrics.mutations;
            await delay(500);
            const delta = metrics.mutations - before;
            metrics.idleMutations.push(delta);
            // Two records/root allows a late one-shot repair, not a continuous loop.
            assert(
              delta <= roots.length * 2,
              `idle mutations ${delta}/500ms exceed ${roots.length * 2}`,
            );
          }
          assert(
            ownedSheets() === sheetsBefore,
            "owned sheets do not grow at idle",
          );
          noDuplicates();
          metrics.ownedSheets = sheetsBefore;
          assert(
            metrics.maxHeartbeatGapMs < 2000,
            `heartbeat starved for ${metrics.maxHeartbeatGapMs.toFixed(0)}ms`,
          );
          metrics.phase = "disable";
          await controller.set({ enabled: false });
          metrics.remainingAfterDisable = roots.flatMap((root) =>
            [
              ...root.querySelectorAll(
                "style.darkreader,style.sorng-cpanel-shadow-dark,style.sorng-website-dark-mode,style#__sorng_dark_bootstrap_v1",
              ),
            ].map((sheet) => ({
              classes: sheet.className,
              rules: sheet.sheet?.cssRules.length || 0,
            })),
          );
          metrics.enabledAfterDisable = documents.map((doc) =>
            doc.defaultView.DarkReader.isEnabled(),
          );
          await eventually(
            () =>
              cleaned() &&
              documents.every(
                (doc) =>
                  !doc.defaultView.DarkReader.isEnabled() &&
                  !doc.documentElement.hasAttribute("data-darkreader-mode"),
              ),
            "engine and palette cleanup in both documents",
          );
          for (const doc of documents)
            assert(
              color(doc.querySelector("header")) === "rgb(255, 255, 255)",
              "document inline white restored",
            );
          for (const root of shadowRoots)
            assert(
              color(root.querySelector("header,nav")) === "rgb(255, 255, 255)",
              "shadow white restored",
            );
          const lateHost = document.createElement("div");
          document.body.append(lateHost);
          const lateRoot = lateHost.attachShadow({ mode: "open" });
          lateRoot.innerHTML =
            '<nav class="navbar" style="background:white!important">After disable</nav>';
          await delay(100);
          assert(
            !lateRoot.querySelector("style") && cleaned(),
            "hooks and queued repairs stay inert after disable",
          );
          roots.push(lateRoot);
          shadowRoots.push(lateRoot);
          observe(lateRoot);
          metrics.phase = "reenable";
          assert(
            (await controller.set({ enabled: true })) === "engine",
            "engine reenabled",
          );
          await eventually(
            () => active() && allDark(),
            "both engines and headers restored",
          );
          await delay(250);
          noDuplicates();
          // Dispose is document-local; release every controller just as pagehide does.
          for (const doc of documents)
            doc.defaultView.__sorngWebDarkModeDocument_v1.dispose(false);
          await delay(100);
          assert(
            cleaned() &&
              documents.every((doc) => !doc.defaultView.DarkReader.isEnabled()),
            "dispose removes engines and palettes",
          );
          metrics.phase = "passed";
          return metrics;
        } finally {
          clearInterval(heartbeat);
          observer.disconnect();
          for (const doc of documents)
            doc.defaultView.__sorngWebDarkModeDocument_v1.dispose(false);
        }
      },
    );
    assert.equal(
      result.engineRequests,
      2,
      "one local bundle per document, reused on reenable",
    );
  },
);
