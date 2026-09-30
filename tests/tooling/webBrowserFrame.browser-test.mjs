// Local Edge sandbox regression; no Tauri/WebView2 injection or live proxy.
// node --test tests/tooling/webBrowserFrame.browser-test.mjs
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import ts from "typescript";
import { DevTools } from "../../scripts/test-website-dark-mode-browser.mjs";

const browser =
  process.env.WEB_FRAME_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);

async function until(check, label) {
  const deadline = Date.now() + 15000;
  do {
    const result = await check();
    if (result) return result;
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(`Timed out: ${label}`);
}

test(
  "implicit blank denies scripts and parent access; validated proxy enables scripts",
  {
    skip: browser
      ? false
      : "Set WEB_FRAME_BROWSER to an installed Edge executable",
    timeout: 50000,
  },
  async (t) => {
    const source = await readFile(
      new URL("../../src/utils/protocol/webBrowserFrame.ts", import.meta.url),
      "utf8",
    );
    const runtime = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    const profile = await mkdtemp(path.join(tmpdir(), "sorng-frame-sandbox-"));
    let proxy, child, devtools, session, exited;
    const server = createServer((req, res) => {
      if (req.url === "/frame.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(runtime);
        return;
      }
      res.setHeader("Content-Type", "text/html");
      if (
        req.headers.host?.startsWith(
          "p0123456789abcdef0123456789abcdef.localhost:",
        )
      ) {
        res.end(`<!doctype html><script>
        let isolated = false;
        try { parent.document.body; } catch { isolated = true; }
        parent.postMessage({type:'proxy-ready', isolated}, '*');
      </script>`);
        return;
      }
      res.end(`<!doctype html><body><script type="module">
      import * as api from '/frame.js';
      window.api = api;
      window.reports = [];
      window.loads = 0;
      window.frame = document.createElement('iframe');
      frame.addEventListener('load', () => { window.loads++; });
      frame.setAttribute('sandbox', api.EMPTY_WEB_FRAME_SANDBOX);
      document.body.append(frame);
      addEventListener('message', event => {
        if (event.source === frame.contentWindow && event.origin === ${JSON.stringify(proxy?.slice(0, -1))})
          reports.push(event.data);
      });
    </script>`);
    });
    const stop = async () => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
        return;
      if (process.platform === "win32")
        await promisify(execFile)(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
        ).catch(() => {});
      else child.kill("SIGKILL");
    };
    const watchdog = setTimeout(() => {
      void stop();
    }, 45000);
    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      proxy = `http://p0123456789abcdef0123456789abcdef.localhost:${port}/`;
      child = spawn(
        browser,
        [
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      let spawnError;
      exited = new Promise((resolve) => {
        child.once("exit", resolve);
        child.once("error", (error) => {
          spawnError = error;
          resolve();
        });
      });
      const endpoint = await until(async () => {
        if (spawnError) throw spawnError;
        assert.equal(child.exitCode, null, "Edge exited early");
        const lines = await readFile(
          path.join(profile, "DevToolsActivePort"),
          "utf8",
        )
          .then((value) => value.split(/\r?\n/u))
          .catch(() => []);
        return lines[1] && `ws://127.0.0.1:${lines[0]}${lines[1]}`;
      }, "Edge endpoint");
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
      const contexts = new Map();
      const warnings = [];
      devtools.on((method, params, owner) => {
        if (owner !== session) return;
        if (
          method === "Runtime.executionContextCreated" &&
          params.context.auxData?.isDefault
        )
          contexts.set(params.context.id, params.context);
        if (method === "Runtime.executionContextDestroyed")
          contexts.delete(params.executionContextId);
        if (method === "Runtime.executionContextsCleared") contexts.clear();
        if (method === "Log.entryAdded") warnings.push(params.entry.text);
      });
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Log.enable");
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
      const host = `http://127.0.0.1:${port}`;
      await send("Page.navigate", { url: host });
      await until(() => evaluate("!!window.frame"), "host mount");
      assert.deepEqual(
        await evaluate(
          "({src:frame.getAttribute('src'), sandbox:frame.getAttribute('sandbox'), document:frame.contentDocument})",
        ),
        { src: null, sandbox: "", document: null },
      );
      const blankContext = await until(
        () => [...contexts.values()].find((context) => context.origin !== host),
        "opaque blank context",
      );
      assert.equal(
        await evaluate("location.href", blankContext.id),
        "about:blank",
      );
      assert.equal(
        await evaluate(
          "(() => { try { parent.document.body; return false; } catch { return true; } })()",
          blankContext.id,
        ),
        true,
      );
      // CDP evaluation itself bypasses script policy. A DOM-inserted script must
      // obey the actual sandbox, including after the element flags are upgraded.
      await evaluate(
        "const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.body.append(s)",
        blankContext.id,
      );
      assert.equal(
        await evaluate("window.__ran === true", blankContext.id),
        false,
      );
      assert.equal(
        await evaluate(
          `(() => { try { api.navigateWebBrowserFrame(frame, ${JSON.stringify(host)}, ${JSON.stringify(proxy)}); return false; } catch { return frame.getAttribute('sandbox') === '' && !frame.hasAttribute('src'); } })()`,
        ),
        true,
      );
      await evaluate(
        `frame.setAttribute('sandbox', api.PROXY_WEB_FRAME_SANDBOX)`,
      );
      await evaluate(
        "const s2 = document.createElement('script'); s2.textContent = 'window.__ran = true'; document.body.append(s2)",
        blankContext.id,
      );
      assert.equal(
        await evaluate("window.__ran === true", blankContext.id),
        false,
      );
      assert.equal(await evaluate("frame.contentDocument === null"), true);
      await evaluate(
        `api.navigateWebBrowserFrame(frame, ${JSON.stringify(proxy)}, ${JSON.stringify(proxy)})`,
      );
      await until(
        () => evaluate("reports.length === 1"),
        "proxy script report",
      );
      assert.deepEqual(await evaluate("reports[0]"), {
        type: "proxy-ready",
        isolated: true,
      });
      await evaluate("api.clearWebBrowserFrame(frame)");
      await until(
        () =>
          evaluate(
            "frame.getAttribute('src') === 'about:blank' && frame.contentDocument === null",
          ),
        "restricted recovery",
      );
      assert.equal(await evaluate("frame.getAttribute('sandbox')"), "");
      // Reproduce a restricted document with an already matching src. A sandbox
      // attribute change alone must not be mistaken for permission activation.
      await evaluate(`loads = 0; frame.src = ${JSON.stringify(proxy)}`);
      await until(() => evaluate("loads > 0"), "restricted proxy load");
      assert.equal(await evaluate("reports.length"), 1);
      await evaluate(
        `api.navigateWebBrowserFrame(frame, ${JSON.stringify(proxy)}, ${JSON.stringify(proxy)})`,
      );
      await until(
        () => evaluate("reports.length === 2"),
        "same-URL script permission activation",
      );
      assert.ok(
        warnings.some(
          (text) =>
            text.includes("Blocked script execution") &&
            text.includes("about:blank"),
        ),
        "deliberately injected initial blank script must be blocked",
      );
      t.diagnostic(
        "Confirmed opaque blank before/after flag upgrade, blocked blank scripts, validated proxy scripts and parent isolation, and same-URL permission activation. Native WebView2 warning count is not measured.",
      );
    } finally {
      clearTimeout(watchdog);
      if (devtools) {
        await devtools
          .send("Browser.close", {}, undefined, 2000)
          .catch(() => {});
        devtools.close();
      }
      if (exited) await Promise.race([exited, delay(1500)]);
      await stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.equal(path.dirname(profile), path.resolve(tmpdir()));
      assert.ok(path.basename(profile).startsWith("sorng-frame-sandbox-"));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    }
  },
);
