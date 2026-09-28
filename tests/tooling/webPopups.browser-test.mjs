// Local Chromium compatibility regression, not native egress/TLS acceptance.
// node --test tests/tooling/webPopups.browser-test.mjs
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const executable =
  process.env.WEB_POPUP_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);
const generationKey = "__sorng_generation_v1";

// Runs in the sandboxed proxy parent. Only harness reporting retains fetch.
async function exercise(config) {
  const reportFetch = window.fetch.bind(window);
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const eventually = async (predicate, label) => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      check(performance.now() < deadline, `Timed out: ${label}`);
      await pause(20);
    }
  };
  const frames = () =>
    Array.from(document.querySelectorAll("iframe[data-sorng-website-popup]"));
  const childReady = async (frame, pathname) => {
    await eventually(() => {
      try {
        return (
          frame.contentWindow.location.pathname === pathname &&
          frame.contentWindow.fixtureReady === pathname
        );
      } catch {
        return false;
      }
    }, `child ${pathname}`);
  };
  const blocked = [];
  try {
    const controller = installWebNetworkClient(config, (entry) =>
      blocked.push(entry),
    );
    const parentDocument = document;
    const parentUrl = location.href;
    const state = (window.fixtureState = { unsaved: "parent-still-alive" });
    const initialSubscribers = window.__sorngWebDarkMode_v1.subscribers.length;
    document.querySelector("input").value = "unsaved edit";
    check(frames().length === 0, "no startup popup");
    const invalid = document.createElement("form");
    invalid.target = "_blank";
    invalid.action = config.sourceOrigin + "/cpsess123/invalid";
    invalid.innerHTML =
      '<input required name="required"><button>Submit</button>';
    document.body.append(invalid);
    invalid.requestSubmit();
    await pause(0);
    check(frames().length === 0, "invalid form creates no popup");
    invalid.remove();
    const cancelled = document.createElement("form");
    cancelled.target = "_blank";
    cancelled.action = config.sourceOrigin + "/cpsess123/cancelled";
    cancelled.addEventListener("submit", (event) => event.preventDefault());
    document.body.append(cancelled);
    cancelled.requestSubmit();
    await pause(20);
    check(frames().length === 0, "cancelled form leaves no blank popup");
    cancelled.remove();
    const anchor = document.createElement("a");
    anchor.href = config.sourceOrigin + "/cpsess123/filemanager";
    anchor.target = "_blank";
    anchor.textContent = "File Manager";
    document.body.append(anchor);
    anchor.click();
    await eventually(() => frames().length === 1, "blank link context");
    const first = frames()[0];
    await childReady(first, "/cpsess123/filemanager");
    check(first.getRootNode() === document, "native target is in light DOM");
    check(
      first.contentWindow.location.origin === config.proxyOrigin,
      "popup exact proxy origin",
    );
    check(
      first.contentDocument.cookie.includes("fixtureSession=synthetic-session"),
      "popup cookie continuity",
    );
    check(first.contentWindow.sorngDarkRoot() === window, "same dark registry");
    check(
      window.__sorngWebDarkMode_v1.subscribers.length ===
        initialSubscribers + 1,
      "child dark subscription",
    );

    const named = window.open("", "FileEditor");
    check(named && !named.closed, "blank named handle");
    check(window.open("", "FileEditor") === named, "named handle reuse");
    check(named.document !== document, "loader document is child only");
    named.document.body.textContent = "Loading synthetic editor";
    await pause(0);
    named.location.href = config.sourceOrigin + "/cpsess123/editor?keep=a%20b";
    const editor = frames()[1];
    await childReady(editor, "/cpsess123/editor");
    check(
      new URL(named.location.href).searchParams.get("__sorng_generation_v1") ===
        config.requestGeneration,
      "getter preserves generation",
    );
    named.location.assign(config.sourceOrigin + "/cpsess123/editor-assigned");
    await childReady(editor, "/cpsess123/editor-assigned");
    named.location.replace(config.sourceOrigin + "/cpsess123/editor-replaced");
    await childReady(editor, "/cpsess123/editor-replaced");
    named.location = config.sourceOrigin + "/cpsess123/editor-final";
    await childReady(editor, "/cpsess123/editor-final");
    named.focus();
    check(
      editor.contentWindow.opener === window,
      "editor opener is proxy parent",
    );

    check(
      window.open(
        config.sourceOrigin + "/cpsess123/noopener",
        "FileEditor",
        "noopener",
      ) === null,
      "noopener returns no handle",
    );
    const isolated = frames()[2];
    await childReady(isolated, "/cpsess123/noopener");
    check(
      isolated.contentWindow.opener === null,
      "noopener child has no opener",
    );
    check(
      editor.contentWindow.location.pathname === "/cpsess123/editor-final",
      "noopener does not reuse existing named editor",
    );
    isolated.contentWindow.close();
    check(frames().length === 2, "noopener close retains existing windows");

    const isolatedLink = document.createElement("a");
    isolatedLink.href = config.sourceOrigin + "/cpsess123/noopener-link";
    isolatedLink.target = "FileEditor";
    isolatedLink.rel = "noopener";
    document.body.append(isolatedLink);
    isolatedLink.click();
    const isolatedLinkFrame = frames()[2];
    await childReady(isolatedLinkFrame, "/cpsess123/noopener-link");
    check(
      isolatedLinkFrame.contentWindow.opener === null,
      "rel=noopener child has no opener",
    );
    check(
      editor.contentWindow.location.pathname === "/cpsess123/editor-final",
      "rel=noopener preserves named editor",
    );
    isolatedLinkFrame.contentWindow.close();

    const form = document.createElement("form");
    form.method = "post";
    form.action = config.sourceOrigin + "/cpsess123/wrong-action";
    form.target = "WrongTarget";
    form.innerHTML =
      '<input name="token" value="synthetic-token"><input name="choice" value="one"><input name="choice" value="two"><button name="operation" value="save" formtarget="FileEditor" formaction="/cpsess123/save">Save</button>';
    document.body.append(form);
    form.requestSubmit(form.querySelector("button"));
    await childReady(editor, "/cpsess123/save");
    check(frames().length === 2, "native POST reused named context");
    await pause(0);
    check(
      form.querySelector("button").getAttribute("formtarget") === "FileEditor",
      "submitter target restored",
    );

    const multipart = document.createElement("form");
    multipart.method = "post";
    multipart.enctype = "multipart/form-data";
    multipart.target = "_blank";
    multipart.action = config.sourceOrigin + "/cpsess123/upload";
    multipart.innerHTML =
      '<input name="token" value="synthetic-token"><input type="file" name="upload"><button name="operation" value="upload">Upload</button>';
    const files = new DataTransfer();
    files.items.add(
      new File(["synthetic file bytes\n"], "fixture.txt", {
        type: "text/plain",
      }),
    );
    multipart.querySelector('[type="file"]').files = files.files;
    document.body.append(multipart);
    multipart.requestSubmit(multipart.querySelector("button"));
    await eventually(() => frames().length === 3, "one blank form child");
    await childReady(frames()[2], "/cpsess123/upload");
    check(
      frames().length === 3,
      "requestSubmit plus submit capture creates exactly one child",
    );

    const directForm = document.createElement("form");
    directForm.method = "post";
    directForm.target = "FileEditor";
    directForm.action = config.sourceOrigin + "/cpsess123/direct-save";
    directForm.innerHTML = '<input name="direct" value="native-submit">';
    document.body.append(directForm);
    directForm.submit();
    await childReady(editor, "/cpsess123/direct-save");

    const unsafeCount = frames().length;
    check(
      window.open(
        config.foreignOrigin + "/private?secret=fixture-only",
        "unsafe",
      ) === null,
      "foreign URL denied",
    );
    check(
      window.open(config.siblingOrigin + "/private", "unsafe") === null,
      "sibling route denied",
    );
    let refused = false;
    try {
      named.location.href = config.foreignOrigin + "/private";
    } catch {
      refused = true;
    }
    check(refused, "delayed foreign navigation denied");
    check(frames().length === unsafeCount, "no foreign blank context");
    check(
      !JSON.stringify(blocked).includes("fixture-only"),
      "reports omit URL secrets",
    );

    const childClient = editor.contentWindow.eval(
      `installWebPopupClient({proxyOrigin:${JSON.stringify(config.proxyOrigin)},mapUrl:value=>value,isActive:()=>true,blocked:()=>new Error('blocked')})`,
    );
    check(
      typeof childClient.closeSelf === "function",
      "managed child closeSelf callback",
    );
    childClient.dispose();
    editor.contentWindow.close();
    await eventually(
      () => named.closed && frames().length === 2,
      "child window.close closes its overlay",
    );
    check(
      window.__sorngWebDarkMode_v1.subscribers.length ===
        initialSubscribers + 2,
      "closed child dark subscription released",
    );

    const parentProof = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", config.sourceOrigin + "/parent-xhr");
      xhr.onload = () =>
        xhr.status === 200
          ? resolve(JSON.parse(xhr.responseText))
          : reject(Error(`XHR ${xhr.status}`));
      xhr.onerror = () => reject(Error("parent XHR failed"));
      xhr.send("parent-after-popup");
    });
    check(
      document === parentDocument && window.fixtureState === state,
      "parent document and state survive",
    );
    check(
      document.querySelector("input").value === "unsaved edit",
      "parent edit survives",
    );
    check(location.href === parentUrl, "parent navigation unchanged");
    controller.dispose();
    check(frames().length === 0, "dispose removes every overlay");
    await reportFetch("/result", {
      method: "POST",
      body: JSON.stringify({
        ok: true,
        parentProof,
        nativeOpenCalls: window.fixtureNativeOpens,
      }),
    });
  } catch (error) {
    await reportFetch("/result", {
      method: "POST",
      body: JSON.stringify({ error: error.stack || String(error) }),
    });
  }
}

test(
  "contained cPanel popups preserve cookies, native POST bodies and the parent",
  {
    skip: executable
      ? false
      : "Set WEB_POPUP_TEST_BROWSER to an installed Chromium browser",
    timeout: 45000,
  },
  async (t) => {
    const paths = [
      "web_popup_client.js",
      "web_network_client.js",
      "web_dark_mode_client.js",
    ];
    const sources = await Promise.all(
      paths.map((name) =>
        readFile(
          new URL(
            `../../src-tauri/crates/sorng-protocols/src/${name}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    t.diagnostic(
      paths
        .map(
          (name, i) =>
            `${name} SHA-256 ${createHash("sha256").update(sources[i]).digest("hex")}`,
        )
        .join("; "),
    );
    const runtime = sources.join("\n");
    const requests = [];
    const foreignRequests = [];
    const received = [];
    const hostname = `p${randomBytes(16).toString("hex")}.localhost`;
    const siblingHost = `p${randomBytes(16).toString("hex")}.localhost`;
    const foreignHost = "foreign-popup-fixture.localhost";
    const generation = randomBytes(16).toString("hex");
    let config;
    let finish;
    let sequence = 0;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, config.proxyOrigin);
        const host = req.headers.host.split(":")[0];
        received.push({ host, url: req.url });
        let body = "";
        for await (const chunk of req) body += chunk;
        res.setHeader("Cache-Control", "no-store");
        if (![hostname, "app-popup-fixture.localhost"].includes(host)) {
          foreignRequests.push({
            host,
            url: req.url,
            cookie: req.headers.cookie,
            body,
          });
          res.writeHead(403).end();
        } else if (url.pathname === "/app") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<!doctype html><iframe sandbox="allow-same-origin allow-scripts allow-forms" src="${config.proxyOrigin}/parent"></iframe>`,
          );
        } else if (url.pathname === "/result") {
          finish(JSON.parse(body));
          res.writeHead(204).end();
        } else if (url.pathname === "/runtime.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(runtime);
        } else if (url.pathname === "/parent-xhr") {
          const record = {
            method: req.method,
            url: req.url,
            cookie: req.headers.cookie,
            body,
            host: req.headers.host,
          };
          requests.push(record);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(record));
        } else if (
          url.pathname === "/parent" ||
          url.pathname.startsWith("/cpsess123/")
        ) {
          requests.push({
            method: req.method,
            url: req.url,
            cookie: req.headers.cookie,
            body,
            contentType: req.headers["content-type"],
            host: req.headers.host,
          });
          const parent = url.pathname === "/parent";
          if (parent)
            res.setHeader(
              "Set-Cookie",
              // Synthetic embedded-cookie policy, not upstream-cookie acceptance.
              "fixtureSession=synthetic-session; Path=/; SameSite=None; Secure",
            );
          res.setHeader("Content-Type", "text/html");
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-src 'self'; form-action 'self'; object-src 'none'",
          );
          // Explicit synthetic config per document: this does not validate Rust
          // response generation, native selection or native credential isolation.
          const childConfig = { ...config, documentSequence: ++sequence };
          res.end(`<!doctype html><html><head><title>Synthetic File Manager</title><script src="/runtime.js"></script></head><body><input aria-label="Unsaved parent edit"><script>
          window.fixtureNativeOpens=0;window.open=function(){window.fixtureNativeOpens++;throw Error('Unexpected native popup');};
          ${parent ? `(${exercise.toString()})(${JSON.stringify(childConfig)});` : `window.fixtureController=installWebNetworkClient(${JSON.stringify(childConfig)},function(){});window.fixtureReady=${JSON.stringify(url.pathname)};window.parent.postMessage({type:'proxy_dom_ready',documentSequence:${sequence}},location.origin);`}
        </script></body></html>`);
        } else res.writeHead(404).end();
      } catch (error) {
        finish({ error: String(error) });
        res.writeHead(500).end();
      }
    });
    const profile = await mkdtemp(
      path.join(path.resolve(tmpdir()), "sorng-web-popups-"),
    );
    let child, exited, deadline;
    let stderr = "";
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = server.address().port;
      config = {
        version: 1,
        sessionId: "synthetic-popup-session",
        documentSequence: 1,
        requestGeneration: generation,
        sourceOrigin: "https://cpanel-fixture.invalid:2083",
        proxyOrigin: `http://${hostname}:${port}`,
        siblingOrigin: `http://${siblingHost}:${port}`,
        foreignOrigin: `http://${foreignHost}:${port}`,
        mappings: [
          {
            upstreamOrigin: "https://sibling-fixture.invalid",
            proxyOrigin: `http://${siblingHost}:${port}`,
          },
        ],
      };
      child = spawn(
        executable,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--no-proxy-server",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          `--host-resolver-rules=MAP ${hostname} 127.0.0.1, MAP ${siblingHost} 127.0.0.1, MAP ${foreignHost} 127.0.0.1, MAP app-popup-fixture.localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
          `--user-data-dir=${profile}`,
          `http://app-popup-fixture.localhost:${port}/app`,
        ],
        {
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "ignore", "pipe"],
          env: { ...process.env, TEMP: profile, TMP: profile, TMPDIR: profile },
        },
      );
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      exited = new Promise((resolve) => {
        child.once("error", (error) => {
          finish({ error: String(error) });
          resolve();
        });
        child.once("exit", (code, signal) => {
          finish({ error: `Browser exited: ${code ?? signal}` });
          resolve();
        });
      });
      deadline = setTimeout(
        () => finish({ error: "Browser wall-clock deadline (30s) exceeded" }),
        30000,
      );
      const outcome = await result;
      t.diagnostic(
        JSON.stringify({
          outcome,
          requests,
          foreignRequests,
          received,
          stderr: outcome.error ? stderr : undefined,
        }),
      );
      assert.equal(
        outcome.error,
        undefined,
        `${outcome.error}; browser=${stderr}`,
      );
      assert.equal(outcome.ok, true);
      assert.equal(outcome.nativeOpenCalls, 0);
      assert.deepEqual(
        foreignRequests,
        [],
        "no foreign/sibling listener requests",
      );
      assert.equal(
        requests.filter((record) => record.url === "/parent").length,
        1,
        "parent document loaded once",
      );
      const popupRequests = requests.filter((record) =>
        record.url.startsWith("/cpsess123/"),
      );
      assert.equal(popupRequests.length, 10);
      for (const record of popupRequests) {
        assert.equal(record.host, new URL(config.proxyOrigin).host);
        assert.match(record.cookie, /fixtureSession=synthetic-session/);
        assert.equal(
          new URL(record.url, config.proxyOrigin).searchParams.get(
            generationKey,
          ),
          generation,
        );
      }
      const post = popupRequests.find((record) =>
        record.url.startsWith("/cpsess123/save?"),
      );
      assert.equal(post.method, "POST");
      assert.equal(
        post.body,
        "token=synthetic-token&choice=one&choice=two&operation=save",
      );
      const upload = popupRequests.find((record) =>
        record.url.startsWith("/cpsess123/upload?"),
      );
      assert.equal(upload.method, "POST");
      assert.match(upload.contentType, /^multipart\/form-data; boundary=/);
      assert.match(
        upload.body,
        /name="upload"; filename="fixture.txt"\r\nContent-Type: text\/plain\r\n\r\nsynthetic file bytes\n/,
      );
      assert.match(upload.body, /name="operation"\r\n\r\nupload/);
      assert.match(upload.body, /name="token"\r\n\r\nsynthetic-token/);
      const direct = popupRequests.find((record) =>
        record.url.startsWith("/cpsess123/direct-save?"),
      );
      assert.equal(direct.method, "POST");
      assert.equal(direct.body, "direct=native-submit");
      assert.equal(outcome.parentProof.body, "parent-after-popup");
      assert.match(
        outcome.parentProof.cookie,
        /fixtureSession=synthetic-session/,
      );
      assert.equal(
        new URL(outcome.parentProof.url, config.proxyOrigin).searchParams.get(
          generationKey,
        ),
        generation,
      );
    } finally {
      clearTimeout(deadline);
      try {
        if (
          child?.pid &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          if (process.platform === "win32")
            await promisify(execFile)(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, timeout: 5000 },
            ).catch((error) => {
              // taskkill can report an already-exiting child after terminating
              // the owned browser root. Preserve the actual test failure.
              if (child.exitCode === null && child.signalCode === null)
                throw error;
            });
          else process.kill(-child.pid, "SIGKILL");
          await exited;
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(path.dirname(profile), path.resolve(tmpdir()));
        assert.ok(path.basename(profile).startsWith("sorng-web-popups-"));
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      }
    }
  },
);
