// Real-browser regression; local fixture only, no PBX credentials/network.
// node --test tests/tooling/freepbxCssProbe.browser-test.mjs
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
  process.env.FREEPBX_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find(existsSync);
test(
  "FreePBX CSS support probe does not abort cookie helper initialization",
  {
    skip: browser ? false : "Set FREEPBX_TEST_BROWSER",
    timeout: 30000,
  },
  async () => {
    const runtimePath =
      "src-tauri/crates/sorng-protocols/src/web_network_client.js";
    // Compare committed bytes without replacing another agent's working tree.
    const runtime = process.env.FREEPBX_TEST_RUNTIME_REF
      ? (
          await promisify(execFile)("git", [
            "show",
            `${process.env.FREEPBX_TEST_RUNTIME_REF}:${runtimePath}`,
          ])
        ).stdout
      : await readFile(runtimePath, "utf8");
    const cookie = await readFile(
      "tests/protocol/fixtures/freepbx-js-cookie-2.1.3.js",
      "utf8",
    );
    const jquery = await readFile(
      "tests/protocol/fixtures/freepbx-jquery-3.1.1.min.js",
      "utf8",
    );
    const compat = await readFile(
      "src-tauri/crates/sorng-protocols/src/freepbx_cookie_compat.js",
      "utf8",
    );
    const profile = await mkdtemp(path.join(tmpdir(), "sorng-freepbx-css-"));
    const requests = [];
    let origin;
    const server = createServer((req, res) => {
      requests.push(req.url);
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        // Exact multiplebgs probe from Modernizr 3.3.1 in the same pinned
        // FreePBX tree as the cookie fixture, followed by the real cookie library.
        res.end(`${jquery}
        var probe=document.createElement('a').style;
        probe.cssText='background:url(https://),url(https://),red url(https://)';
        window.multiplebgs=/(url\\s*\\(.*?){3}/.test(probe.background);
        ${cookie}
        Cookies.set('fixture', 'ready');
        window.cookieBefore=Cookies.get('fixture');
        window.removeResult=$.removeCookie('fixture', {path:'/'});
        window.absentResult=$.removeCookie('fixture', {path:'/'});
        window.cookieAfter=Cookies.get('fixture'); window.bundleFinished=true;`);
        return;
      }
      if (req.url !== "/admin/") {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><link rel="icon" href="data:,"><body><pre id="result"></pre>
      <script>window.errors=[];window.addEventListener('error',e=>errors.push(e.message));
      ${runtime}
      ${compat}
      window.reports=[];window.controller=installWebNetworkClient(${JSON.stringify({ version: 1, sessionId: "fixture", documentSequence: 1, requestGeneration: "a".repeat(32), sourceOrigin: "https://pbx.example", proxyOrigin: origin, mappings: [] })},e=>reports.push(e));</script>
      <script src="/bundle.js"></script><script>
      var denied=0;
      for (const u of ['https://unapproved.example/image.png','javascript:alert','https://[']) {
        try {document.createElement('div').style.cssText='background:url("'+u+'")';}
        catch(e){if(e.name==='SecurityError')denied++;}
      }
      document.querySelector('#result').textContent=btoa(JSON.stringify({
        finished:window.bundleFinished===true,multiplebgs:window.multiplebgs,
        cookieBefore:window.cookieBefore,cookieRemoved:window.cookieAfter===undefined,
        removeResult:window.removeResult,absentResult:window.absentResult,
        errors,denied,reports:reports.length}));</script>`);
    });
    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      origin = `http://p0123456789abcdef0123456789abcdef.localhost:${server.address().port}`;
      const { stdout } = await promisify(execFile)(
        browser,
        [
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--no-proxy-server",
          "--host-resolver-rules=MAP *.localhost 127.0.0.1, MAP * ~NOTFOUND",
          `--user-data-dir=${profile}`,
          "--dump-dom",
          "--virtual-time-budget=1500",
          `${origin}/admin/`,
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
      );
      const encoded = stdout.match(
        /<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/,
      )?.[1];
      assert.ok(encoded, "Browser fixture did not return a result");
      assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString()), {
        finished: true,
        multiplebgs: true,
        cookieBefore: "ready",
        cookieRemoved: true,
        removeResult: true,
        absentResult: false,
        errors: [],
        denied: 3,
        reports: 3,
      });
      assert.deepEqual(requests.sort(), ["/admin/", "/bundle.js"]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.equal(path.dirname(profile), path.resolve(tmpdir()));
      assert.ok(path.basename(profile).startsWith("sorng-freepbx-css-"));
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    }
  },
);
