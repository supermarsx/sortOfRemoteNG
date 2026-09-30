// Local pixel regression, NOT an app/WebView/host integration test.
// node --test tests/tooling/webDarkPaint.browser-test.mjs
// Uses installed Edge, production runtime/vendor bytes and Rust's paint_shield
// format string. The synthetic host verifies document identity before removing
// its fixed cover. No accounts, remote fixtures, downloads or virtual timers.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  parseSandboxTokens,
  relativeLuminance,
  SANDBOX_SOURCE_PATH,
} from "../../scripts/test-website-dark-mode-browser.mjs";

const readSource = (name) =>
  readFile(new URL(`../../${name}`, import.meta.url), "utf8");
const browser =
  process.env.WEB_DARK_PAINT_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
const viewport = { width: 800, height: 600 };
const center = { x: 388, y: 288, width: 24, height: 24 };
const marker = { x: 44, y: 44, width: 24, height: 24 };

// Fail closed on native template drift; do not maintain a second shield CSS.
function nativeShield(source) {
  const match =
    /fn paint_shield\(&self\)[\s\S]*?Some\(format!\(\s*("(?:\\.|[^"\\])*")\s*,\s*self\.background_color,\s*\)\)/u.exec(
      source,
    );
  assert.ok(
    match,
    "Rust paint_shield format template changed; update extraction",
  );
  const template = JSON.parse(match[1]);
  let slots = 0;
  const html = template.replace(/\{\{|\}\}|\{\}/gu, (part) => {
    if (part === "{}") {
      slots++;
      return "#181a1b";
    }
    return part[0];
  });
  assert.equal(slots, 1, "expected exactly the native background argument");
  assert.match(html, /id="__sorng_dark_paint_shield_v1"/u);
  return html;
}

// Render the actual Rust templates for this fixture's fixed palette. The
// extractor deliberately rejects argument/template drift rather than silently
// testing an unrelated copy of the native bootstrap.
function nativeBootstrap(source) {
  const template = (name) => {
    const match = new RegExp(
      `fn ${name}\\([^]*?format!\\(\\s*("(?:\\\\.|[^"\\\\])*")`,
      "u",
    ).exec(source);
    assert.ok(match, `Rust ${name} format template changed`);
    return JSON.parse(match[1]);
  };
  const render = (value, args = [], named = {}) => {
    let slots = 0;
    const result = value.replace(/\{\{|\}\}|\{([^{}]*)\}/gu, (part, name) => {
      if (part === "{{" || part === "}}") return part[0];
      if (name === "") return args[slots++];
      assert.ok(Object.hasOwn(named, name), `unknown Rust field: ${name}`);
      return named[name];
    });
    assert.equal(slots, args.length);
    return result;
  };
  const background = "#181a1b",
    text = "#e8e6e3";
  const selector = /let selector = "([^"]+)";/u.exec(source)?.[1];
  const root = /let root = "([^"]+)";/u.exec(source)?.[1];
  assert.ok(selector && root);
  return render(template("style"), [
    background,
    text,
    background,
    text,
    render(template("force_surface_coverage"), [], { background, text }),
    render(template("cpanel_coverage"), [], {
      background,
      text,
      root,
      surface: "#292a2b",
      header: "#313233",
      border: "#464747",
    }),
    render(template("generic_surface_coverage"), [], { selector, text }),
    text,
  ]);
}

async function until(check, label, timeout = 5000) {
  const end = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await delay(25);
  } while (Date.now() < end);
  assert.fail(`Timed out: ${label}`);
}

test(
  "dark paint pixels survive delayed engine and repeated document/iframe navigation",
  {
    skip: browser
      ? false
      : "Set WEB_DARK_PAINT_BROWSER to an installed Edge executable",
    timeout: 65000,
  },
  async (t) => {
    const [runtime, bundle, rust, sandboxSource] = await Promise.all([
      readSource(DARK_CLIENT_PATH),
      readSource(DARKREADER_ASSET_PATH),
      readSource("src-tauri/crates/sorng-protocols/src/http_dark_mode.rs"),
      readSource(SANDBOX_SOURCE_PATH),
    ]);
    const shield = nativeShield(rust);
    const bootstrap = nativeBootstrap(rust);
    const sandbox = parseSandboxTokens(sandboxSource).proxy;
    t.diagnostic(
      `Synthetic fixture; runtime SHA-256 ${createHash("sha256").update(runtime).digest("hex")}`,
    );
    const runs = new Map();
    const heldBundles = new Set();
    let engineRequests = 0;
    let hostOrigin;
    let pageOrigin;
    const fixture = (run) => `<!doctype html><html><head>${shield}
    ${bootstrap}
    ${run.csp ? `<meta http-equiv="Content-Security-Policy" content="style-src 'self'; script-src 'unsafe-inline'"><link rel="stylesheet" href="/fixture.css">` : ""}
    <script>(function(){
      const identity = ${JSON.stringify(run.identity)};
      const state = window.__paint = {events:[], outcome:null, error:null};
      function emit(type) {
        const event = {...identity, type, url:location.href};
        state.events.push({type, at:performance.now(), dom:document.readyState,
          presented:document.documentElement.hasAttribute('data-sorng-dark-presented')});
        parent.postMessage(event, ${JSON.stringify(hostOrigin)});
      }
      ${runtime}
      state.start = () => window.__sorngWebDarkModeDocument_v1.set({enabled:true})
        .then(value => state.outcome = value, error => state.error = String(error));
    })();</script>
    <style>html,body{margin:0;width:100%;height:100%;overflow:hidden}
      .custom-app-shell{position:fixed;inset:0}canvas{position:fixed;left:40px;top:40px;z-index:2}</style>
    </head><body style="background:white!important;color:black!important">
    <div class="custom-app-shell" style="background:white!important;color:black!important">Synthetic content ${run.id}</div>
    <canvas id="marker" width="32" height="32" aria-label="visible content marker"></canvas>
    <script>const ctx = document.getElementById('marker').getContext('2d');
      ctx.fillStyle = ${JSON.stringify(run.color)};ctx.fillRect(0,0,32,32);</script>
    </body></html>`;
    const pageServer = createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (req.url === "/fixture.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(
          "html,body{margin:0;width:100%;height:100%;overflow:hidden}.custom-app-shell{position:fixed;inset:0;background:white!important;color:black!important}canvas{position:fixed;left:40px;top:40px;z-index:2}",
        );
        return;
      }
      if (req.url === DARKREADER_URL_PATH) {
        engineRequests++;
        res.setHeader("Content-Type", "text/javascript");
        // Test-controlled route delay: capture real paints while the real bundle
        // is pending, then release it well inside the production 4s fetch cap.
        heldBundles.add(res);
        res.once("close", () => heldBundles.delete(res));
        return;
      }
      const run = runs.get(req.url?.slice(1));
      if (!run) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(fixture(run));
    });
    const hostServer = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><head><style>
      html,body{margin:0;background:#181a1b;overflow:hidden}
      iframe{position:fixed;inset:0;width:100vw;height:100vh;border:0}
      #cover{position:fixed;inset:0;background:#181a1b;z-index:10}
      </style></head><body><iframe sandbox="${sandbox}"></iframe><div id="cover"></div><script>
      const frame = document.querySelector('iframe'), cover = document.getElementById('cover');
      window.__host = {expected:null, accepted:[], rejected:0};
      window.navigateFixture = (identity, url) => {
        __host.expected = {...identity,url};cover.hidden = false;frame.src = url;
      };
      addEventListener('message', event => {
        const data = event.data, expected = __host.expected;
        if (!data || data.type !== 'proxy_dark_ready') return;
        if (event.source !== frame.contentWindow || event.origin !== ${JSON.stringify(pageOrigin)} ||
            !expected || !Object.keys(expected).every(key => data[key] === expected[key])) {
          __host.rejected++;return;
        }
        __host.accepted.push(data);cover.hidden = true;
      });</script></body></html>`);
    });
    const profile = await mkdtemp(path.join(tmpdir(), "sorng-dark-paint-"));
    let child, exited, devtools, watchdog;
    let stderr = "";
    let session;
    const contexts = new Map();
    const errors = [];
    const samples = [];
    let lastPng;
    try {
      for (const server of [pageServer, hostServer])
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
      pageOrigin = `http://127.0.0.1:${pageServer.address().port}`;
      hostOrigin = `http://127.0.0.1:${hostServer.address().port}`;
      const browserTemp = path.join(profile, "temp");
      await mkdir(browserTemp);
      child = spawn(
        browser,
        [
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--force-device-scale-factor=1",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        {
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
          env: { ...process.env, TEMP: browserTemp, TMP: browserTemp },
        },
      );
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      let spawnError;
      exited = new Promise((resolve) => {
        child.once("exit", resolve);
        child.once("error", (error) => {
          spawnError = error;
          resolve();
        });
      });
      const stop = async () => {
        if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
          return;
        if (process.platform === "win32")
          await promisify(execFile)(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 5000 },
          ).catch(() => {});
        else child.kill("SIGKILL");
      };
      // Node-side deadline also terminates a renderer that starves its own timers.
      watchdog = setTimeout(() => {
        void stop();
      }, 50000);
      const endpoint = await until(
        async () => {
          if (spawnError) throw spawnError;
          assert.equal(child.exitCode, null, `Edge exited: ${stderr}`);
          const lines = await readFile(
            path.join(profile, "DevToolsActivePort"),
            "utf8",
          )
            .then((text) => text.split(/\r?\n/u))
            .catch(() => []);
          return lines[1] && `ws://127.0.0.1:${lines[0]}${lines[1]}`;
        },
        "Edge CDP endpoint",
        15000,
      );
      devtools = await DevTools.connect(endpoint);
      const send = (method, params = {}) =>
        devtools.send(method, params, session, 5000);
      const { targetId } = await send("Target.createTarget", {
        url: "about:blank",
      });
      ({ sessionId: session } = await send("Target.attachToTarget", {
        targetId,
        flatten: true,
      }));
      devtools.on((method, params, owner) => {
        if (owner !== session) return;
        if (method === "Runtime.executionContextCreated") {
          const context = params.context;
          if (context.auxData?.isDefault) contexts.set(context.id, context);
        } else if (method === "Runtime.executionContextDestroyed")
          contexts.delete(params.executionContextId);
        else if (method === "Runtime.executionContextsCleared")
          contexts.clear();
        else if (method === "Runtime.exceptionThrown")
          errors.push(params.exceptionDetails);
      });
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const evaluate = async (expression, contextId) => {
        const reply = await send("Runtime.evaluate", {
          expression,
          contextId,
          returnByValue: true,
        });
        assert.ok(
          !reply.exceptionDetails,
          JSON.stringify(reply.exceptionDetails),
        );
        return reply.result.value;
      };
      const state = (contextId) =>
        evaluate(
          `({
      events:__paint.events, outcome:__paint.outcome, error:__paint.error,
      presented:document.documentElement.hasAttribute('data-sorng-dark-presented'),
      ready:document.documentElement.hasAttribute('data-sorng-dark-ready'),
      shield:getComputedStyle(document.documentElement,'::after').content,
      engine:window.DarkReader?.isEnabled() === true,
      dom:document.readyState
    })`,
          contextId,
        );
      const shot = async (label, expected = "dark", color) => {
        const { data } = await send("Page.captureScreenshot", {
          format: "png",
        });
        lastPng = Buffer.from(data, "base64");
        const image = decodePng(lastPng);
        assert.equal(image.width, viewport.width);
        assert.equal(image.height, viewport.height);
        const centerColor = meanColor(image, center);
        const markerColor = meanColor(image, marker);
        const luminance = relativeLuminance(centerColor);
        samples.push({ label, center: centerColor, marker: markerColor });
        assert.ok(
          expected === "light" ? luminance > 0.9 : luminance < 0.08,
          `${label}: center pixels ${centerColor}, luminance ${luminance}`,
        );
        if (color)
          assert.equal(
            markerColor,
            color,
            `${label}: actual content must be visible`,
          );
        return markerColor;
      };

      for (const hosted of [false, true]) {
        if (hosted) {
          await send("Page.navigate", { url: hostOrigin });
          await until(
            () => evaluate("typeof navigateFixture === 'function'"),
            "synthetic host",
          );
        }
        for (let navigation = 1; navigation <= 2; navigation++) {
          const id = randomUUID();
          const color =
            navigation === 1 ? "rgb(220, 40, 60)" : "rgb(40, 100, 220)";
          const run = {
            id,
            color,
            identity: {
              version: 1,
              sessionId: "pixel-fixture",
              documentToken: randomUUID(),
              documentSequence: navigation,
              navigationToken: id,
            },
          };
          runs.set(id, run);
          const url = `${pageOrigin}/${id}`;
          const label = `${hosted ? "iframe" : "document"}/${navigation}`;
          if (hosted) {
            await evaluate(
              `navigateFixture(${JSON.stringify(run.identity)},${JSON.stringify(url)})`,
            );
            await shot(`${label}/navigation-cover`);
          } else await send("Page.navigate", { url });
          const contextId = await until(async () => {
            for (const context of contexts.values()) {
              if (context.origin !== pageOrigin) continue;
              // Contexts disappear during navigation; only the current URL counts.
              const matches = await evaluate(
                `location.href === ${JSON.stringify(url)} &&
              !!window.__paint && !!document.getElementById('marker')`,
                context.id,
              ).catch(() => false);
              if (matches) return context.id;
            }
            return false;
          }, `${label} document context`);
          assert.equal((await state(contextId)).presented, false);
          await shot(`${label}/before-command`, "dark", "rgb(24, 26, 27)");
          if (hosted) {
            // A readiness-shaped message from the host itself cannot reveal.
            await evaluate(
              `postMessage({...__host.expected,type:'proxy_dark_ready'},location.origin)`,
            );
            await until(
              () => evaluate(`__host.rejected >= ${navigation}`),
              "reject wrong message source",
            );
            assert.equal(
              await evaluate("document.getElementById('cover').hidden"),
              false,
            );
          }
          const requestsBefore = engineRequests;
          await evaluate("void __paint.start()", contextId);
          await until(
            () => heldBundles.size === 1,
            `${label} delayed local bundle`,
          );
          for (let sample = 0; sample < 4; sample++) {
            const pending = await state(contextId);
            assert.equal(
              pending.presented,
              false,
              `${label}: no readiness before engine arrives`,
            );
            assert.equal(pending.events.length, 0);
            assert.equal(pending.engine, false);
            await shot(
              `${label}/bundle-pending-${sample}`,
              "dark",
              "rgb(24, 26, 27)",
            );
            await delay(60);
          }
          for (const response of heldBundles) response.end(bundle);
          heldBundles.clear();
          // Sample through engine installation and the real readiness handoff.
          await until(
            async () => {
              await shot(`${label}/handoff`);
              const current = await state(contextId);
              assert.equal(current.error, null);
              return (
                current.presented &&
                (!hosted ||
                  (await evaluate("document.getElementById('cover').hidden")))
              );
            },
            `${label} presentation`,
            6000,
          );
          const final = await state(contextId);
          assert.equal(
            final.outcome,
            "engine",
            "must use actual vendor, not CSS fallback",
          );
          assert.equal(final.engine, true);
          assert.equal(final.ready, true);
          assert.equal(final.shield, "none", "native pseudo-element released");
          assert.equal(
            final.events.length,
            1,
            "one readiness event for this document",
          );
          assert.equal(final.events[0].type, "proxy_dark_ready");
          assert.equal(final.events[0].presented, true);
          assert.notEqual(final.events[0].dom, "loading");
          assert.equal(
            engineRequests,
            requestsBefore + 1,
            "fresh engine request after navigation",
          );
          if (hosted)
            assert.equal(
              await evaluate(
                `__host.accepted.filter(event => event.documentToken === ${JSON.stringify(run.identity.documentToken)}).length`,
              ),
              1,
            );
          for (let sample = 0; sample < 3; sample++) {
            await shot(`${label}/presented-${sample}`, "dark", color);
            await delay(60);
          }
          // Generic custom-app UI, with no framework or product marker. Late
          // sheets, pseudo-elements and inline-important mutations must never
          // expose a light surface after the initial readiness handshake.
          await evaluate(
            `(() => {
            const sheet = document.createElement('style');
            sheet.textContent = '.custom-app-shell,.custom-app-shell::before{background:white!important;color:black!important}.custom-app-shell::before{content:"";position:fixed;inset:0}';
            document.head.append(sheet);
            document.querySelector('.custom-app-shell').style.setProperty('background-color','white','important');
          })()`,
            contextId,
          );
          await shot(`${label}/late-custom-app-style`, "dark", color);
          await evaluate(
            `(() => {
            const sheet = document.getElementById('__sorng_dark_bootstrap_v1');
            sheet.setAttribute('media', 'print');
            sheet.textContent = 'html,body{background:white!important}';
          })()`,
            contextId,
          );
          await shot(`${label}/repaired-custom-app-preload`, "dark", color);
          // CSS-only components must receive the same protection without the
          // vendor's shadow support concealing a missing controller path.
          await evaluate(
            `void __sorngWebDarkModeDocument_v1.set({enabled:true,cssOnly:true})`,
            contextId,
          );
          await until(
            () =>
              evaluate(
                "document.documentElement.hasAttribute('data-sorng-dark-presented')",
                contextId,
              ),
            "CSS fallback presented",
          );
          await evaluate(
            `(() => {
            const host = document.createElement('div');
            document.body.append(host);
            window.__component = host.attachShadow({mode:'open'});
            __component.innerHTML += '<style>.unknown-login-shell,.unknown-login-shell::before{background:white!important}.unknown-login-shell{position:fixed;inset:0;z-index:1}.unknown-login-shell::before{content:"";position:fixed;inset:0}</style><div class="unknown-login-shell" style="background:white!important">Login</div>';
          })()`,
            contextId,
          );
          await shot(`${label}/generic-shadow-repair`, "dark");
          await until(
            () =>
              evaluate(
                "document.documentElement.hasAttribute('data-sorng-dark-presented')",
                contextId,
              ),
            "shadow repair presented",
          );
          await shot(`${label}/generic-shadow`, "dark", color);
          await evaluate(
            `__component.querySelector('.unknown-login-shell').style.setProperty('background-color','#fafafa','important')`,
            contextId,
          );
          await shot(`${label}/late-shadow-inline`, "dark", color);
          await evaluate(
            `(() => {
              const sheet = __component.querySelector('.sorng-cpanel-shadow-dark');
              window.__shadowCss = sheet.textContent;
              sheet.firstChild.data = '*::before{background:white!important}';
            })()`,
            contextId,
          );
          await shot(`${label}/shadow-text-damage-repair`, "dark");
          await until(
            () =>
              evaluate(
                "__component.querySelector('.sorng-cpanel-shadow-dark').textContent === __shadowCss && document.documentElement.hasAttribute('data-sorng-dark-presented')",
                contextId,
              ),
            "shadow text damage repaired and presented",
          );
          await shot(`${label}/shadow-text-damage-recovered`, "dark", color);
          if (!hosted && navigation === 2) {
            // Sensitivity control and disable coverage: the same fixture must
            // actually paint white once production removes its protections.
            await evaluate(
              "void __sorngWebDarkModeDocument_v1.set({enabled:false})",
              contextId,
            );
            await shot(`${label}/disabled-negative-control`, "light", color);
            assert.equal(
              await evaluate(
                "!!document.getElementById('__sorng_dark_paint_shield_v1')",
                contextId,
              ),
              false,
            );
          }
        }
      }
      // A meta policy can take effect after the native preload but before a
      // delayed controller. Its static sheet must survive adoption and an
      // engine refusal, without adding script permissions to the policy.
      const cspRun = {
        id: randomUUID(),
        color: "rgb(220, 40, 60)",
        identity: {},
        csp: true,
      };
      runs.set(cspRun.id, cspRun);
      const cspUrl = `${pageOrigin}/${cspRun.id}`;
      await send("Page.navigate", { url: cspUrl });
      const cspContext = await until(async () => {
        for (const context of contexts.values()) {
          if (
            context.origin === pageOrigin &&
            (await evaluate(
              `location.href === ${JSON.stringify(cspUrl)} && !!window.__paint && !!document.getElementById('marker')`,
              context.id,
            ).catch(() => false))
          )
            return context.id;
        }
        return false;
      }, "CSP fixture context");
      await evaluate("void __paint.start()", cspContext);
      await until(
        () =>
          evaluate(
            "__paint.outcome === 'cssOnly' && document.documentElement.hasAttribute('data-sorng-dark-presented')",
            cspContext,
          ),
        "CSP fallback visible",
      );
      await shot("csp/native-preload-retained", "dark", cspRun.color);
      assert.equal(
        await evaluate(
          "!!document.getElementById('__sorng_dark_bootstrap_v1').sheet",
          cspContext,
        ),
        true,
        "CSP must not invalidate the adopted preload",
      );
      await evaluate(
        "void __sorngWebDarkModeDocument_v1.set({enabled:false})",
        cspContext,
      );
      await shot("csp/disabled-negative-control", "light", cspRun.color);
      assert.deepEqual(errors, [], "no renderer exceptions");
      t.diagnostic(
        `${samples.length} PNG samples; ${engineRequests} delayed local bundle requests; both navigation markers visible`,
      );
      t.diagnostic(JSON.stringify(samples));
    } catch (error) {
      // Retain only the failing screenshot outside the disposable browser profile.
      if (lastPng) {
        const artifact = path.join(
          tmpdir(),
          `sorng-dark-paint-failure-${randomUUID()}.png`,
        );
        await writeFile(artifact, lastPng);
        t.diagnostic(`Last screenshot: ${artifact}`);
      }
      t.diagnostic(JSON.stringify({ samples, errors, stderr }));
      throw error;
    } finally {
      clearTimeout(watchdog);
      if (devtools) {
        await devtools
          .send("Browser.close", {}, undefined, 2000)
          .catch(() => {});
        devtools.close();
      }
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const stopped = await Promise.race([
          exited.then(() => true),
          delay(1500, false),
        ]);
        if (!stopped) {
          if (process.platform === "win32")
            await promisify(execFile)(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, timeout: 5000 },
            ).catch(() => {});
          else child.kill("SIGKILL");
        }
      }
      for (const server of [pageServer, hostServer]) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      assert.equal(path.dirname(profile), path.resolve(tmpdir()));
      assert.ok(path.basename(profile).startsWith("sorng-dark-paint-"));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    }
  },
);
