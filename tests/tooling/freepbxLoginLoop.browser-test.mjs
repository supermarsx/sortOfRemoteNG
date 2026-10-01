// Local reproduction of FreePBX16's navbar ready request and global 401 handler.
// No appliance credentials or remote requests. FREEPBX_LOOP_BASELINE=1 checks
// the pre-fix loop instead of the expected stable signed-out page.
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
  ].find(existsSync);
for (const expiredSession of [false, true])
  test(
    `FreePBX ${expiredSession ? "expired session retains one real 401/logout" : "signed-out page stays available"}`,
    {
      skip: browser ? false : "Set FREEPBX_TEST_BROWSER",
      timeout: 30000,
    },
    async () => {
      const jquery = await readFile(
        "tests/protocol/fixtures/freepbx-jquery-3.1.1.min.js",
        "utf8",
      );
      const cookie = await readFile(
        "tests/protocol/fixtures/freepbx-js-cookie-2.1.3.js",
        "utf8",
      );
      const compatPath =
        "src-tauri/crates/sorng-protocols/src/freepbx_cookie_compat.js";
      // Stable pre-loop-fix bytes: baseline mode must not race working-tree edits.
      const compat =
        process.env.FREEPBX_LOOP_BASELINE === "1"
          ? (
              await promisify(execFile)("git", [
                "show",
                `52c8c799ec6869e12f069719e5bf245a26899bbd:${compatPath}`,
              ])
            ).stdout
          : await readFile(compatPath, "utf8");
      const counts = { documents: 0, navbar401: 0, logout: 0 };
      const profile = await mkdtemp(path.join(tmpdir(), "sorng-freepbx-loop-"));
      const server = createServer((req, res) => {
        const url = new URL(req.url, "http://fixture.localhost");
        res.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/admin/ajax.php") {
          counts.navbar401++;
          res
            .writeHead(401, { "Content-Type": "application/json" })
            .end('{"error":"Not Authenticated"}');
          return;
        }
        if (url.searchParams.get("logout") === "true") {
          counts.logout++;
          res.end("Logged out");
          return;
        }
        if (url.pathname !== "/admin/") {
          res.writeHead(404).end();
          return;
        }
        counts.documents++;
        // Cap a broken fixture deterministically; do not let it run indefinitely.
        if (counts.documents > 3) {
          res.end("Loop reproduced; fixture stopped");
          return;
        }
        const signedOut = !expiredSession || counts.logout > 0;
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><link rel="icon" href="data:,"><body><pre id="metrics"></pre>
      ${signedOut ? '<a class="login_item" id="login_admin" href="/admin/">Administration</a><div id="login_form"><form id="loginform"><input type="text" name="username"><input type="password" name="password"></form></div>' : '<nav id="floating-nav-bar">Signed-in dashboard</nav>'}
      <script>${compat}</script><script>${jquery}</script><script>${cookie}</script>
      <script>
      // Reduced verbatim control flow from pinned script.legacy.js. Error
      // status is never transformed; server counters record real HTTP 401s.
      var metrics={toasts:0,starts:0,sends:0,errors:0,success:0,rejections:[]};
      function fpbxToast(){metrics.toasts++;}
      $(document).ajaxStart(function(){metrics.starts++;});
      $(document).ajaxSend(function(){metrics.sends++;});
      $(document).ajaxError(function(){metrics.errors++;});
      $(document).ready(function() {
        $.ajax({type:'POST',url:'ajax.php?command=navbarToogle',dataType:'json',
          success:function(){metrics.success++;},
          error:function(reqObj,status){
            var err='<p>XHR response code: '+reqObj.status+' XHR responseText: '+reqObj.resonseText+' jQuery status: '+status+'</p>';
            fpbxToast(err,'Error','danger');
          }
        }).fail(function(xhr,reason){metrics.rejections.push({status:xhr.status,reason:reason});});
        $(document).ajaxError(function(event,jqxhr) {
          if(jqxhr.status==401) {
            var url=window.location.pathname;
            $.get(url+'?logout=true',function(){
              $.removeCookie('PHPSESSID',{path:'/'});
              window.location=url;
            });
            return;
          }
        });
        setTimeout(function(){document.querySelector('#metrics').textContent=btoa(JSON.stringify(metrics));},200);
      });</script>`);
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
            "--virtual-time-budget=2500",
            `${origin}/admin/`,
          ],
          { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
        );
        if (process.env.FREEPBX_LOOP_BASELINE === "1") {
          assert.ok(
            counts.documents >= 3 &&
              counts.navbar401 >= 2 &&
              counts.logout >= 2,
            JSON.stringify(counts),
          );
        } else {
          assert.deepEqual(
            counts,
            expiredSession
              ? { documents: 2, navbar401: 1, logout: 1 }
              : { documents: 1, navbar401: 0, logout: 0 },
          );
          const encoded = stdout.match(
            /<pre id="metrics">([A-Za-z0-9+/=]+)<\/pre>/,
          )?.[1];
          assert.ok(
            encoded,
            "Final signed-out document must expose completed preflight metrics",
          );
          assert.deepEqual(
            JSON.parse(Buffer.from(encoded, "base64").toString()),
            {
              toasts: 0,
              starts: 0,
              sends: 0,
              errors: 0,
              success: 0,
              rejections: [
                { status: 0, reason: "freepbx-navbar-requires-login" },
              ],
            },
          );
        }
        console.log(JSON.stringify({ expiredSession, ...counts }));
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(path.dirname(profile), path.resolve(tmpdir()));
        assert.ok(path.basename(profile).startsWith("sorng-freepbx-loop-"));
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      }
    },
  );
