// Real browser form transport with the production routing and auto-login assets.
// Synthetic credentials only; all network destinations are loopback or blocked.
// Source-reviewed form/handler contract:
// https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/views/login.php
// https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/assets/js/script.legacy.js
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const base = "src-tauri/crates/sorng-protocols/src";
const asset = (name) => readFile(`${base}/${name}`, "utf8");
const browser =
  process.env.FREEPBX_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium",
  ].find(existsSync);
const selectors = {
  username:
    '.ui-dialog form[id="loginform"] input[name="username"][type="text"]',
  password:
    '.ui-dialog form[id="loginform"] input[name="password"][type="password"]',
  submit:
    '.ui-dialog form[id="loginform"] button[id="customContinue"][type="button"]',
};

async function loginAsset() {
  const manifest = /pub const AUTOLOGIN_MODULES_JS: &str = ([\s\S]*?);/.exec(
    await asset("autologin_asset.rs"),
  )?.[1];
  assert.ok(manifest);
  const parts = await Promise.all(
    [...manifest.matchAll(/include_str!\("([^"]+)"\)/g)].map((match) =>
      asset(match[1]),
    ),
  );
  return (await asset("autologin_client.js")).replace(
    "/*__SORNG_AUTOLOGIN_MODULES__*/",
    () => parts.join(""),
  );
}

for (const automatic of [false, true]) {
  test(
    `FreePBX ${automatic ? "automatic" : "manual"} Continue sends one authenticated POST with analytics blocked`,
    {
      skip: browser ? false : "Set FREEPBX_TEST_BROWSER",
      timeout: 30000,
    },
    async () => {
      const [jquery, cookies, compat, runtime, popups, login] =
        await Promise.all([
          readFile(
            "tests/protocol/fixtures/freepbx-jquery-3.1.1.min.js",
            "utf8",
          ),
          readFile(
            "tests/protocol/fixtures/freepbx-js-cookie-2.1.3.js",
            "utf8",
          ),
          asset("freepbx_cookie_compat.js"),
          asset("web_network_client.js"),
          asset("web_popup_client.js"),
          loginAsset(),
        ]);
      const profile = await mkdtemp(path.join(tmpdir(), "sorng-freepbx-post-"));
      const requests = [];
      let redemptions = 0;
      let analyticsBlocked = 0;
      const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://fixture.localhost");
        res.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/fixture-analytics-blocked") {
          analyticsBlocked++;
          res.writeHead(204).end();
          return;
        }
        if (url.pathname === "/__sortofremoteng_autologin") {
          redemptions++;
          res.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              username: "fixture-admin",
              password: "fixture & pass+word",
              selectors,
            }),
          );
          return;
        }
        if (url.pathname !== "/admin/") {
          res.writeHead(404).end();
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        requests.push({ method: req.method, body, cookie: req.headers.cookie });
        if (req.method === "POST") {
          const fields = new URLSearchParams(body);
          const valid =
            fields.get("username") === "fixture-admin" &&
            fields.get("password") === "fixture & pass+word" &&
            /PHPSESSID=fixture-prelogin/.test(req.headers.cookie || "");
          res
            .writeHead(valid ? 303 : 401, {
              Location: "/admin/",
              "Set-Cookie":
                "PHPSESSID=fixture-authenticated; Path=/admin/; HttpOnly; SameSite=Lax",
            })
            .end(valid ? "" : "Wrong form or lost pre-login session");
          return;
        }
        res.setHeader("Content-Type", "text/html");
        if (/PHPSESSID=fixture-authenticated/.test(req.headers.cookie || "")) {
          res.end(
            '<!doctype html><link rel="icon" href="data:,"><h1 id="authenticated">Signed in</h1>',
          );
          return;
        }
        if (requests.length > 3) {
          res.end("Unexpected reload loop");
          return;
        }
        res.setHeader("Set-Cookie", [
          "PHPSESSID=fixture-prelogin; Path=/admin/; HttpOnly; SameSite=Lax",
          "theme=dark; Path=/",
        ]);
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'",
        );
        const origin = `http://${req.headers.host}`;
        res.end(`<!doctype html><html><head><link rel="icon" href="data:,"><script>
        var failures=[];
        window.addEventListener('error', function(e) { failures.push(e.message); });
        window.addEventListener('unhandledrejection', function(e) { failures.push(String(e.reason)); });
        document.addEventListener('securitypolicyviolation', function(e) {
          if(e.blockedURI.indexOf('https://www.googletagmanager.com/') === 0)
            fetch('/fixture-analytics-blocked', {method:'POST'});
        });
        setTimeout(function() {
          var metrics=document.createElement('pre'); metrics.id='metrics';
          metrics.textContent=JSON.stringify({failures:failures, result:window.__autologin_last});
          document.body.append(metrics);
        }, 4000);
        ${popups}\n${runtime}\n${compat}
        installWebNetworkClient(${JSON.stringify({
          version: 1,
          sessionId: "fixture",
          documentSequence: 1,
          sourceOrigin: "https://pbx.example",
          proxyOrigin: origin,
          requestGeneration: "a".repeat(32),
          mappings: [],
        })}, function() {});
        </script><script>${jquery}</script><script>${cookies}</script></head><body>
        <div id="login_form" style="display:none"><form id="loginform" method="post" role="form">
          <input type="text" name="username" autocomplete="off">
          <input type="password" name="password" autocomplete="off">
          <button type="button" id="customContinue">Continue</button>
          <button type="button" id="customCancel">Cancel</button>
        </form></div><a href="#" class="login_item" id="login_admin">Administration</a>
        <script src="https://www.googletagmanager.com/gtag/js?id=fixture"></script>
        <script>
        // Reduced source-reviewed FreePBX16 script.legacy.js flow: clone the
        // hidden template, run the site's async hooks, then jQuery submit.
        // requestSubmit is deliberately NOT substituted for trigger('submit').
        $(function() {
          $('#login_admin').on('click', function() {
            var dialog=$('<div class="ui-dialog"></div>').html($('#login_form').html()).appendTo(document.body);
            dialog.on('click', '#customContinue', function() {
              var form=$(this).closest('form');
              Promise.resolve(true).then(function(allowed) { if(allowed) form.trigger('submit'); });
            });
          });
        });
        ${login}
        $(function() { setTimeout(function() {
          ${
            automatic
              ? `window.__sorng_autologin.fetchCredsAndRun('fixture', ${JSON.stringify(selectors)});`
              : `
          var launcher=document.getElementById('login_admin');
          launcher.click();
          var form=document.querySelector('.ui-dialog form');
          // Leave time for an unintended launcher navigation to interrupt the
          // dialog. A same-tick synthetic submit can hide the real-user failure.
          setTimeout(function() {
            form.elements.username.value='fixture-admin';
            form.elements.password.value='fixture & pass+word';
            form.querySelector('#customContinue').click();
          }, 250);`
          }
        }, 50); });</script></body></html>`);
      });
      try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://p0123456789abcdef0123456789abcdef.localhost:${server.address().port}`;
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
            "--virtual-time-budget=5000",
            `${origin}/admin/`,
          ],
          { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
        );
        assert.ok(
          /id="authenticated"/.test(stdout),
          JSON.stringify({
            requests,
            metrics: stdout.match(/<pre id="metrics">([\s\S]*?)<\/pre>/)?.[1],
          }),
        );
        assert.deepEqual(
          requests.map((request) => request.method),
          ["GET", "POST", "GET"],
        );
        assert.equal(redemptions, automatic ? 1 : 0);
        assert.equal(
          analyticsBlocked,
          1,
          "The actual CSP violation must not block login",
        );
        assert.equal(
          requests[1].body,
          "username=fixture-admin&password=fixture+%26+pass%2Bword",
        );
        assert.match(requests[2].cookie, /PHPSESSID=fixture-authenticated/);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(path.dirname(profile), path.resolve(tmpdir()));
        assert.ok(path.basename(profile).startsWith("sorng-freepbx-post-"));
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      }
    },
  );
}
