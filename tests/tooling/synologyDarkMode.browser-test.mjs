// node --test tests/tooling/synologyDarkMode.browser-test.mjs
// All browser requests target the local synthetic fixture server.
// $env:SYNOLOGY_TEST_RUNTIME_REF='<pre-fix commit>'; node --test <this file>
// Exit failure on baseline escapes is intentional; no expectation is weakened.
// Synthetic selector/timing regression, NOT DSM, Vue/ExtJS execution, native
// injection parity, proxy/WebView integration, or proof of flash-free hardware.
// Vue hierarchy/desktop markers: ../fixtures/synology/dsmLoginTimeline.ts.
// ExtJS class provenance (not DSM-version proof): public Sencha Ext 3.4.1.1
// https://cdn.sencha.com/ext/gpl/3.4.1.1/resources/css/ext-all.css
// Colors, geometry, late styles and timing below are deliberately synthetic.
// .syno-login-panel is omitted: the local fixture does not substantiate it.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  DARK_CLIENT_PATH,
  DARKREADER_ASSET_PATH,
  DARKREADER_URL_PATH,
  DevTools,
  decodePng,
  meanColor,
  relativeLuminance,
  THEME_DEFAULTS,
} from "../../scripts/test-website-dark-mode-browser.mjs";

const read = (file) =>
  readFile(new URL(`../../${file}`, import.meta.url), "utf8");
const browser =
  process.env.SYNOLOGY_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);

async function until(check, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

// Runs in the real renderer. Reading CSS immediately distinguishes persistent
// rules from DarkReader eventually catching up. RAF readings exercise the next
// rendering opportunity; screenshots independently check the presented pixels.
function installFixture(markup, selectors) {
  const area = document.getElementById("fixture");
  area.innerHTML = markup;
  // Canvas is preserved media: its red pixels prove content is visible through
  // the readiness handoff, rather than hidden by a full-page dark cover.
  const witness = document.createElement("canvas");
  witness.width = witness.height = 12;
  witness.style.cssText =
    "position:fixed;left:730px;top:330px;width:12px;height:12px";
  const context = witness.getContext("2d");
  context.fillStyle = "rgb(220,40,60)";
  context.fillRect(0, 0, 12, 12);
  area.append(witness);
  window.surfaces = selectors.map((selector, i) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing fixture selector ${selector}`);
    node.dataset.probe = selector;
    Object.assign(node.style, {
      position: "fixed",
      left: `${20 + (i % 5) * 140}px`,
      top: `${20 + Math.floor(i / 5) * 100}px`,
      width: "110px",
      height: "70px",
      margin: "0",
      padding: "0",
      border: "0",
    });
    return node;
  });
  window.sample = () =>
    surfaces.map((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        selector: node.dataset.probe,
        background: style.backgroundColor,
        image: style.backgroundImage,
        foreground: style.color,
        rect: { x: rect.x + 80, y: rect.y + 40, width: 15, height: 15 },
      };
    });
}

test(
  "Synology surfaces survive late CSS, marker arrival and inline important after real engine readiness",
  {
    timeout: 45000,
  },
  async (t) => {
    assert.ok(browser, "Installed Edge required; set SYNOLOGY_TEST_BROWSER");
    const ref = process.env.SYNOLOGY_TEST_RUNTIME_REF;
    const [source, bundle, fixtureSource] = await Promise.all([
      ref
        ? promisify(execFile)("git", ["show", `${ref}:${DARK_CLIENT_PATH}`], {
            cwd: new URL("../../", import.meta.url),
            maxBuffer: 1024 * 1024,
          }).then(({ stdout }) => stdout)
        : read(DARK_CLIENT_PATH),
      read(DARKREADER_ASSET_PATH),
      read("tests/fixtures/synology/dsmLoginTimeline.ts"),
    ]);
    // Reuse the exact local fixture strings without a TS loader or another file.
    const markupFor = (name) => {
      const value = new RegExp(`${name}: \\(\\) =>\\s*'([^']+)'`).exec(
        fixtureSource,
      )?.[1];
      assert.ok(value, `Local ${name} fixture changed; review extraction`);
      return value;
    };
    const loginSelectors = [
      ".login-wrapper",
      ".login-body-section",
      ".login-tab-panel",
      ".tab-content-ct",
    ];
    const extSelectors = [
      ".x-panel-body",
      ".x-window-body",
      ".x-grid3-scroller",
      ".x-toolbar",
    ];
    const cases = [
      {
        name: "Vue login",
        markup: markupFor("mounted"),
        selectors: loginSelectors,
      },
      {
        name: "desktop / ExtJS",
        markup:
          markupFor("desktop") +
          extSelectors.map((s) => `<div class="${s.slice(1)}"></div>`).join(""),
        selectors: ["#sds-desktop", "#sds-taskbar", ...extSelectors],
      },
    ];
    t.diagnostic(
      `runtime=${ref || "worktree"} SHA-256=${createHash("sha256").update(source).digest("hex")}`,
    );
    let engineRequests = 0;
    const server = createServer((req, res) => {
      const assets = {
        "/": [
          "text/html",
          `<!doctype html><html><head><script>${source}</script></head><body><div id="fixture"></div></body></html>`,
        ],
        [DARKREADER_URL_PATH]: ["text/javascript", bundle],
      };
      const asset = assets[req.url];
      if (!asset) return res.writeHead(404).end();
      if (req.url === DARKREADER_URL_PATH) engineRequests++;
      res.setHeader("Content-Type", asset[0]);
      res.setHeader("Cache-Control", "no-store");
      res.end(asset[1]);
    });
    const profile = await mkdtemp(path.join(tmpdir(), "sorng-synology-dark-"));
    let child, devtools, session, watchdog, exited;
    let stderr = "";
    const failures = [];
    const stop = async () => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
        return;
      await promisify(execFile)(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, timeout: 5000 },
      ).catch(() => {});
    };
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      child = spawn(
        browser,
        [
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-sync",
          "--disable-extensions",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
      );
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-1500);
      });
      let spawnError;
      exited = new Promise((resolve) => {
        child.once("exit", resolve);
        child.once("error", (error) => {
          spawnError = error;
          resolve();
        });
      });
      // A renderer microtask loop cannot evade this Node-side watchdog.
      watchdog = setTimeout(() => void stop(), 35000);
      const endpoint = await until(
        async () => {
          if (spawnError) throw spawnError;
          assert.equal(child.exitCode, null, stderr);
          const lines = await readFile(
            path.join(profile, "DevToolsActivePort"),
            "utf8",
          )
            .then((text) => text.split(/\r?\n/u))
            .catch(() => []);
          return lines[1] && `ws://127.0.0.1:${lines[0]}${lines[1]}`;
        },
        "Edge CDP endpoint",
        10000,
      );
      devtools = await Promise.race([
        DevTools.connect(endpoint),
        delay(5000).then(() => {
          throw new Error("CDP connect timeout");
        }),
      ]);
      const send = (method, params = {}) =>
        devtools.send(method, params, session, 4000);
      const { targetId } = await send("Target.createTarget", {
        url: "about:blank",
      });
      ({ sessionId: session } = await send("Target.attachToTarget", {
        targetId,
        flatten: true,
      }));
      await send("Page.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width: 760,
        height: 360,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const evaluate = async (expression) => {
        const result = await send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        assert.ok(
          !result.exceptionDetails,
          JSON.stringify(result.exceptionDetails),
        );
        return result.result.value;
      };
      const checkDark = (label, samples) => {
        for (const sample of samples) {
          const dark = relativeLuminance(sample.background);
          if (
            dark === null ||
            dark >= 0.2 ||
            sample.background === "rgba(0, 0, 0, 0)" ||
            sample.image !== "none"
          )
            failures.push(
              `${label} ${sample.selector}: ${sample.background}; image=${sample.image}`,
            );
        }
      };
      const screenshot = async (label, samples, enabled) => {
        assert.equal(
          await evaluate(`
          !document.getElementById('__sorng_dark_paint_shield_v1') &&
          getComputedStyle(document.documentElement, '::after').content === 'none' &&
          getComputedStyle(document.documentElement).visibility === 'visible'
        `),
          true,
          `${label}: no presentation mask`,
        );
        const { data } = await send("Page.captureScreenshot", {
          format: "png",
        });
        const png = decodePng(Buffer.from(data, "base64"));
        assert.equal(png.width, 760);
        assert.equal(
          meanColor(png, { x: 732, y: 332, width: 8, height: 8 }),
          "rgb(220, 40, 60)",
          `${label}: preserved content witness visible`,
        );
        for (const sample of samples) {
          const pixels = meanColor(png, sample.rect);
          const luminance = relativeLuminance(pixels);
          if (
            luminance === null ||
            (enabled ? luminance >= 0.2 : luminance < 0.85)
          )
            failures.push(`${label} ${sample.selector}: pixels=${pixels}`);
          if (
            enabled &&
            sample.image === "none" &&
            pixels !== sample.background
          )
            failures.push(
              `${label} ${sample.selector}: computed=${sample.background}, pixels=${pixels}`,
            );
        }
      };
      for (const fixture of cases) {
        await send("Page.navigate", {
          url: `http://127.0.0.1:${server.address().port}/`,
        });
        await until(
          () =>
            evaluate(
              "document.readyState === 'complete' && !!window.__sorngWebDarkModeDocument_v1",
            ),
          "runtime loaded",
        );
        assert.equal(
          await evaluate(
            `__sorngWebDarkModeDocument_v1.set(${JSON.stringify({ enabled: true, theme: THEME_DEFAULTS })})`,
          ),
          "engine",
        );
        await until(
          () =>
            evaluate(
              "document.documentElement.hasAttribute('data-sorng-dark-ready') && !!window.DarkReader?.isEnabled() && !document.querySelector('.darkreader--fallback')?.textContent",
            ),
          "real engine ready",
        );
        // The initial document has NO Synology marker. Add each marker and its
        // surfaces only after readiness, with a new upstream important sheet.
        const css = `${fixture.selectors.join(",")}{background-color:white!important;color:black!important;background-image:linear-gradient(white,white)!important}`;
        const initial = await evaluate(`(() => {
        (${installFixture})(${JSON.stringify(fixture.markup)}, ${JSON.stringify(fixture.selectors)});
        const sheet = document.createElement('style'); sheet.textContent = ${JSON.stringify(css)}; document.head.append(sheet);
        return sample();
      })()`);
        checkDark(`${fixture.name}/late-marker+CSS/synchronous`, initial);
        const frame = await evaluate(
          "new Promise(resolve => requestAnimationFrame(() => resolve(sample())))",
        );
        checkDark(`${fixture.name}/next-frame`, frame);
        await screenshot(`${fixture.name}/next-frame`, frame, true);
        for (const value of ["rgb(251, 251, 251)", "rgb(247, 247, 247)"]) {
          const samples = await evaluate(`new Promise(resolve => {
          surfaces.forEach(node => {
            node.style.setProperty('background-color', ${JSON.stringify(value)}, 'important');
            node.style.setProperty('background-image', 'linear-gradient(white, white)', 'important');
            node.style.setProperty('color', 'rgb(5, 5, 5)', 'important');
          });
          // MutationObserver delivery queues the production repair RAF. Queue
          // our measurement after that delivery, in the SAME upcoming frame.
          queueMicrotask(() => requestAnimationFrame(() => resolve(sample())));
        })`);
          checkDark(`${fixture.name}/inline ${value}/next-frame`, samples);
          await screenshot(
            `${fixture.name}/inline ${value}/next-frame`,
            samples,
            true,
          );
        }
        await delay(120);
        const settled = await evaluate("sample()");
        checkDark(`${fixture.name}/settled`, settled);
        await screenshot(`${fixture.name}/settled`, settled, true);
        t.diagnostic(
          JSON.stringify({ fixture: fixture.name, initial, settled }),
        );
        // Named document.host must never be treated as ShadowRoot.host.
        assert.equal(
          await evaluate(`new Promise(resolve => {
        const named = document.createElement('form'); named.name = 'host'; document.body.append(named);
        const host = document.createElement('div'); document.body.append(host);
        const shadow = host.attachShadow({mode:'open'}); shadow.innerHTML = '<header>Header</header>';
        document.body.classList.add('dashboard-ready');
        setTimeout(() => resolve(document.host === named && !!shadow.querySelector('style')), 80);
      })`),
          true,
          "named host traversal and timers remain responsive",
        );
        await evaluate("__sorngWebDarkModeDocument_v1.set({enabled:false})");
        await delay(80);
        assert.equal(await evaluate("DarkReader.isEnabled()"), false);
        const restored = await evaluate("sample()");
        for (const sample of restored) {
          assert.equal(
            sample.background,
            "rgb(247, 247, 247)",
            `${fixture.name} restores latest upstream inline color`,
          );
          assert.equal(sample.foreground, "rgb(5, 5, 5)");
          assert.match(sample.image, /linear-gradient/u);
        }
        assert.equal(
          await evaluate(
            "surfaces.every(n => n.style.getPropertyPriority('background-color') === 'important')",
          ),
          true,
        );
        await screenshot(`${fixture.name}/disabled`, restored, false);
      }
      assert.equal(
        engineRequests,
        cases.length,
        "real vendor fetched on each fresh document",
      );
      t.diagnostic(
        `Real vendor requests=${engineRequests}; named-host traversal and disable restoration completed for both fixtures`,
      );
      assert.deepEqual(
        failures,
        [],
        "Synology surface escapes (synthetic fixture)",
      );
    } finally {
      clearTimeout(watchdog);
      if (devtools) {
        await devtools
          .send("Browser.close", {}, undefined, 1000)
          .catch(() => {});
        devtools.close();
      }
      if (exited) await Promise.race([exited, delay(1000)]);
      await stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.equal(path.dirname(profile), path.resolve(tmpdir()));
      assert.ok(path.basename(profile).startsWith("sorng-synology-dark-"));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 150,
      });
    }
  },
);
