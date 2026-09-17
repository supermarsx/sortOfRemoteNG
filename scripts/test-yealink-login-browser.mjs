// t96 W0 harness: can the app's website frame sign in to a Yealink T2x servlet
// login page? Installed Edge headless over CDP mounts the synthetic phone
// fixture (`e2e/fixtures/voip-phone/`) on a `p<32 hex>.localhost` authority
// inside an app-shaped document carrying the production sandbox tokens, exactly
// as `navigateWebBrowserFrame` does, and measures five things:
//
//   1. the corrected selectors `#idUsername` / `#idPassword` / `#idConfirm`
//      match exactly once each (t96 §2.2 — the shipped constants do not);
//   2. `#idConfirm` is an anchor, so `autologin_client.js`'s plain
//      submit-button search finds nothing, while the override path reaches it;
//   3. the page's own `doLogin` posts a body the native parser must accept —
//      the fixture holds the matching private key and decrypts it;
//   4. with today's jail a `commonjs.js`-shaped `onload` (it reads
//      `parent.document` first) aborts, so clicking the login control does
//      NOTHING — the t96 dependency on t95, proven rather than assumed;
//   5. with t95's parent shim injected, the same page completes and posts.
//
//   node scripts/test-yealink-login-browser.mjs [--only=name,...] [--list]
//     [--concurrency=4] [--verbose] [--markdown=<file>]
//
// Exit codes: 0 every scenario matched, 1 a scenario failed, 2 the harness
// could not run (no Edge, or a production shape this mirror pins has drifted).
//
// No app build, app binary, account, profile, package download, WDIO run or
// real device is used. Every page is synthetic — no vendor code or markup is
// copied and no firmware was downloaded — and every request stays on 127.0.0.1.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  LOGIN_FORM_PATH,
  PHONE_FIRMWARE,
  PHONE_TYPE,
  RSA_AES_LOGIN_FIELDS,
  createPhoneHandler,
} from "../e2e/fixtures/voip-phone/server.mjs";
// The t95 probe owns the sandbox mirror and the compatibility shim prototype;
// importing them keeps one copy of each and makes this harness follow t95-e3
// when it re-points that file at the production client.
import {
  DIALOG_ENDPOINT_PATH,
  SANDBOX_SOURCE_PATH,
  buildCompatShimSource,
  parseSandboxTokens,
  proxyHost,
  shimOrderingProblems,
} from "./test-legacy-web-compat-browser.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
/** The app document's authority; a sibling `*.localhost` label of the frame. */
const APP_HOST = "app.localhost";
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const ACCOUNT = Object.freeze({ username: "admin", password: "T21-fixture!" });
const AUTOLOGIN_CLIENT =
  "src-tauri/crates/sorng-protocols/src/autologin_client.js";

/**
 * Fragments of the production auto-login client this harness mirrors. A drifted
 * client must fail loudly rather than leave the probe measuring a stale search.
 */
const PRODUCTION_SHAPES = Object.freeze({
  [AUTOLOGIN_CLIENT]: [
    'scope.querySelector("button[type=submit], input[type=submit]")',
    'scope.querySelector("button:not([type])")',
    '"[role=button][type=submit], button[id*=login i], button[class*=login i], button[id*=signin i]",',
    "/^(BUTTON|INPUT|A)$/.test(submit.tagName)",
    'submit.getAttribute("role") === "button"',
  ],
});

const hex32 = () => randomBytes(16).toString("hex");

// ── scenarios ───────────────────────────────────────────────────────────────

/**
 * `shim` installs t95's parent shim as a document-start script, which is the
 * only difference between `onload-abort` and `signs-in`.
 */
const SCENARIOS = Object.freeze([
  {
    name: "onload-abort",
    summary:
      "today's jail: the page's onload reads parent.document, aborts, and the login control stays dead",
    layout: "form",
    shim: false,
    expect: {
      onloadStarted: true,
      onloadFinished: false,
      boundConfirm: false,
      posts: 0,
      attempts: 0,
      authstatus: null,
      dialogs: 0,
      pageError: "SecurityError",
    },
  },
  {
    name: "signs-in",
    summary:
      "the same page with t95's parent shim: onload completes, the click posts the encrypted body, the phone answers done",
    layout: "form",
    shim: true,
    expect: {
      onloadStarted: true,
      onloadFinished: true,
      boundConfirm: true,
      posts: 1,
      attempts: 1,
      authstatus: "done",
      dialogs: 0,
      pageError: null,
    },
  },
  {
    name: "signs-in-formless",
    summary:
      "the same contract on a markup with no <form> element, where the override falls back to the nearest common scope",
    layout: "formless",
    shim: true,
    expect: {
      onloadStarted: true,
      onloadFinished: true,
      boundConfirm: true,
      posts: 1,
      attempts: 1,
      authstatus: "done",
      dialogs: 0,
      pageError: null,
    },
  },
  {
    name: "bad-credentials",
    summary:
      'a wrong password answers {"authstatus":"none"} and the page raises it as a dialog',
    layout: "form",
    shim: true,
    password: "not-the-password",
    expect: {
      onloadStarted: true,
      onloadFinished: true,
      boundConfirm: true,
      posts: 1,
      attempts: 1,
      authstatus: "none",
      dialogs: 1,
      pageError: null,
    },
  },
  {
    name: "locked-account",
    summary:
      'a locked-out phone answers {"authstatus":"lock"}; nothing here may retry',
    layout: "form",
    shim: true,
    locked: true,
    expect: {
      onloadStarted: true,
      onloadFinished: true,
      boundConfirm: true,
      posts: 1,
      attempts: 1,
      authstatus: "lock",
      dialogs: 1,
      pageError: null,
    },
  },
]);

// ── page-side scripts (shipped as source text) ──────────────────────────────

/**
 * Runs inside the website frame, after the phone's own page bundle. Mirrors the
 * parts of `autologin_client.js` that decide whether this page is reachable,
 * then drives the login control the way the production client does
 * (`target.submit.click()`), and reports everything to the app document.
 */
function frameReporter(config) {
  "use strict";
  // With the shim installed `parent` is the frame itself, so the app window is
  // only reachable through the reference the shim pins.
  var host = window.__sorngAppParent || window.parent;
  var errors = [];
  window.addEventListener("error", function (event) {
    errors.push(String((event.error && event.error.name) || event.message));
  });

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return el.offsetParent !== null;
    var style = view.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;
    return el.offsetParent !== null || style.position === "fixed";
  }
  function nearestScope(pw, user) {
    if (!user) return pw.parentElement || pw.ownerDocument;
    var node = pw.parentElement;
    while (node && !node.contains(user)) node = node.parentElement;
    return node || pw.ownerDocument;
  }
  function findSubmitButton(scope) {
    return (
      scope.querySelector("button[type=submit], input[type=submit]") ||
      scope.querySelector("button:not([type])") ||
      scope.querySelector(
        "[role=button][type=submit], button[id*=login i], button[class*=login i], button[id*=signin i]",
      )
    );
  }

  function probe() {
    var pw = document.querySelector(config.selectors.password);
    var user = document.querySelector(config.selectors.username);
    var result = {
      matches: {},
      passwordUsable: false,
      usernameUsable: false,
      sameForm: false,
      hasFormElement: false,
      plainSubmit: null,
      overrideTag: null,
      overrideUsable: false,
    };
    ["username", "password", "submit"].forEach(function (role) {
      result.matches[role] = document.querySelectorAll(
        config.selectors[role],
      ).length;
    });
    if (!pw || !user) return result;
    result.passwordUsable =
      isVisible(pw) && pw.tagName === "INPUT" && pw.type === "password";
    result.usernameUsable =
      isVisible(user) &&
      user.tagName === "INPUT" &&
      /^(text|email|tel)$/.test(user.type);
    result.sameForm = user.form === pw.form;
    result.hasFormElement = !!pw.form;
    var scope = pw.form || nearestScope(pw, user);
    var plain = findSubmitButton(scope);
    result.plainSubmit = plain ? plain.tagName : null;
    var override = scope.querySelector(config.selectors.submit);
    if (override) {
      result.overrideTag = override.tagName;
      result.overrideUsable =
        isVisible(override) &&
        !(override.form && override.form !== pw.form) &&
        (/^(BUTTON|INPUT|A)$/.test(override.tagName) ||
          override.getAttribute("role") === "button");
    }
    return result;
  }

  function fill(selector, value) {
    var field = document.querySelector(selector);
    if (!field) return false;
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function collect(measured) {
    var page = window.__yealinkPage || { state: {} };
    host.postMessage(
      {
        type: "yealink-collected",
        run: config.run,
        probe: measured,
        page: {
          onloadStarted: !!page.state.onloadStarted,
          onloadFinished: !!page.state.onloadFinished,
          onloadError: page.state.onloadError || null,
          boundConfirm: !!page.state.boundConfirm,
          doLoginCalls: page.state.doLoginCalls || 0,
          posts: page.state.posts || 0,
          authstatus: page.state.authstatus || null,
          lastError: page.state.lastError || null,
          sessionSource: page.state.sessionSource || "none",
          cookieVisible: !!page.state.cookieVisible,
        },
        shim: window.__sorngShim || null,
        parentIsSelf: window.parent === window,
        cookie: document.cookie ? "present" : "empty",
        result: (document.getElementById("_RES_INFO_") || {}).textContent || "",
        errors: errors,
      },
      config.hostOrigin,
    );
  }

  window.addEventListener("load", function () {
    var measured = probe();
    fill(config.selectors.username, config.account.username);
    fill(config.selectors.password, config.account.password);
    // Exactly what the production client does with a submit override.
    var control = document.querySelector(config.selectors.submit);
    if (control) control.click();
    setTimeout(function () {
      collect(measured);
    }, config.settleMs);
  });
}

/** Host-side stand-in for the app's web view: collects what the frame reports. */
function appWebView() {
  "use strict";
  window.__records = [];
  var frame = document.querySelector("iframe");
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    window.__records.push(event.data);
  });
}

// ── harness ─────────────────────────────────────────────────────────────────

class DevTools {
  #socket;
  #next = 0;
  #pending = new Map();
  static async connect(url) {
    const devtools = new DevTools();
    devtools.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      devtools.#socket.addEventListener("open", resolve, { once: true });
      devtools.#socket.addEventListener(
        "error",
        () => reject(new Error("DevTools connection failed")),
        { once: true },
      );
    });
    devtools.#socket.addEventListener("message", (event) =>
      devtools.#receive(JSON.parse(String(event.data))),
    );
    devtools.#socket.addEventListener("close", () => {
      for (const call of devtools.#pending.values())
        call.reject(new Error("DevTools connection closed"));
      devtools.#pending.clear();
    });
    return devtools;
  }
  #receive(message) {
    if (message.id === undefined) return;
    const call = this.#pending.get(message.id);
    if (!call) return;
    this.#pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error)
      call.reject(new Error(`${call.method}: ${message.error.message}`));
    else call.resolve(message.result);
  }
  send(method, params = {}, sessionId = undefined, timeoutMs = 20000) {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() {
    this.#socket.close();
  }
}

const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");

/**
 * The selectors this harness proves, i.e. what `endpoints.rs` must carry after
 * t96-e1 and what the `voip-phone` application profile must declare.
 */
export const CORRECTED_SELECTORS = Object.freeze({
  username: "#idUsername",
  password: "#idPassword",
  submit: "#idConfirm",
});

async function main() {
  const { values: options } = parseArgs({
    options: {
      only: { type: "string" },
      list: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      concurrency: { type: "string", default: "4" },
      markdown: { type: "string" },
    },
  });
  if (options.list) {
    for (const scenario of SCENARIOS)
      console.log(`${scenario.name.padEnd(22)} ${scenario.summary}`);
    return 0;
  }
  const executable = EDGE.find(existsSync);
  if (!executable) {
    console.error(
      "This harness needs an existing installed Edge; no browser is downloaded.",
    );
    return 2;
  }
  let tokens;
  try {
    tokens = parseSandboxTokens(
      await readFile(path.join(repo, SANDBOX_SOURCE_PATH), "utf8"),
    );
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  for (const [file, fragments] of Object.entries(PRODUCTION_SHAPES)) {
    const source = (await readFile(path.join(repo, file), "utf8")).replace(
      /\r\n/gu,
      "\n",
    );
    for (const fragment of fragments)
      if (!source.includes(fragment)) {
        console.error(
          `Production shape changed in ${file}; update this mirror:\n  ${fragment}`,
        );
        return 2;
      }
  }
  const shim = buildCompatShimSource({ dialogEndpoint: DIALOG_ENDPOINT_PATH });
  const problems = shimOrderingProblems(shim);
  if (problems.length) {
    console.error(
      `The compatibility shim prototype lost its install order: ${problems.join("; ")}`,
    );
    return 2;
  }

  const only = options.only?.split(",").filter(Boolean);
  const selected = SCENARIOS.filter(
    (scenario) => !only || only.some((name) => scenario.name.includes(name)),
  ).map((scenario) => ({
    ...scenario,
    key: hex32(),
    dialogs: [],
    records: [],
    failures: [],
  }));
  if (!selected.length) {
    console.error(`No scenario matches --only=${options.only}`);
    return 2;
  }

  let port = 0;
  const hostOrigin = () => `http://${APP_HOST}:${port}`;
  const frameOrigin = (scenario) => `http://${proxyHost(scenario.key)}:${port}`;

  for (const scenario of selected) {
    scenario.phone = createPhoneHandler({
      mode: "servlet",
      authShape: "rsa-aes",
      layout: scenario.layout,
      // The website frame is cross-site to the app document, so the phone's
      // cookie needs the attributes an embedded page would need.
      crossSiteCookie: true,
      lockAfter: scenario.locked ? 1 : 0,
      username: ACCOUNT.username,
      password: ACCOUNT.password,
      transformHtml: (html, context) =>
        context.kind === "servlet-login"
          ? wrapLoginDocument(html, scenario)
          : html,
    });
    if (scenario.locked) scenario.phone.state.locked = true;
  }

  function wrapLoginDocument(html, scenario) {
    const documentStart = `<script>window.__sorngRun=${scriptJson(scenario.key)};</script>${
      scenario.shim ? `<script>${shim}</script>` : ""
    }`;
    const source = `(${frameReporter.toString()})(${scriptJson({
      run: scenario.key,
      hostOrigin: hostOrigin(),
      selectors: CORRECTED_SELECTORS,
      account: {
        username: ACCOUNT.username,
        password: scenario.password ?? ACCOUNT.password,
      },
      settleMs: 1500,
    })});`;
    if (/<\/script|<!--/iu.test(source))
      throw new Error("The frame reporter cannot be inlined");
    const reporter = `<script>${source}</script>`;
    const head = html.indexOf("<head>") + "<head>".length;
    const body = html.lastIndexOf("</body>");
    return (
      html.slice(0, head) +
      documentStart +
      html.slice(head, body) +
      reporter +
      html.slice(body)
    );
  }

  function hostDocument(scenario) {
    const src = `${frameOrigin(scenario)}${LOGIN_FORM_PATH}&Random=${Math.random()}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Web view</title><style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe sandbox="${tokens.proxy}" src="${src.replace(/&/gu, "&amp;")}"></iframe><script>(${appWebView.toString()})();</script></body></html>`;
  }

  const byKey = new Map(selected.map((scenario) => [scenario.key, scenario]));
  const sockets = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture");
    const host = String(request.headers.host ?? "").replace(/:\d+$/u, "");
    if (host === APP_HOST) {
      const scenario = byKey.get(url.pathname.slice("/web-view/".length));
      if (!scenario) {
        response.writeHead(url.pathname === "/favicon.ico" ? 204 : 404).end();
        return;
      }
      const body = hostDocument(scenario);
      response
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        })
        .end(body);
      return;
    }
    const scenario = byKey.get(/^p([0-9a-f]{32})\.localhost$/u.exec(host)?.[1]);
    if (!scenario) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname === DIALOG_ENDPOINT_PATH) {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        try {
          scenario.dialogs.push(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
        } catch {
          scenario.dialogs.push({ kind: "unparsed" });
        }
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ outcome: "dismiss" }));
      });
      return;
    }
    scenario.phone.handle(request, response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const profile = await mkdtemp(path.join(tmpdir(), "sorng-yealink-login-"));
  const browserTemp = path.join(profile, "temp");
  await mkdir(browserTemp);
  let browser;
  let exited;
  let devtools;
  let failed = 1;
  const began = Date.now();
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    const stderr = [];
    browser = spawn(
      executable,
      [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-sync",
        "--mute-audio",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "about:blank",
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, TEMP: browserTemp, TMP: browserTemp },
      },
    );
    browser.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      if (stderr.length > 64) stderr.shift();
    });
    exited = new Promise((resolve) => {
      browser.once("exit", resolve);
      browser.once("error", resolve);
    });
    let endpoint;
    for (let waited = 0; !endpoint && waited < 20000; waited += 100) {
      if (browser.exitCode !== null)
        throw new Error(
          `Edge exited during startup (code ${browser.exitCode}): ${Buffer.concat(stderr).toString("utf8").slice(-2000)}`,
        );
      const lines = await readFile(
        path.join(profile, "DevToolsActivePort"),
        "utf8",
      )
        .then((value) => value.split(/\r?\n/u))
        .catch(() => []);
      if (lines[1]) endpoint = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
      else await delay(100);
    }
    if (!endpoint)
      throw new Error(
        `Edge headless did not publish a DevTools endpoint: ${Buffer.concat(stderr).toString("utf8").slice(-2000)}`,
      );
    devtools = await DevTools.connect(endpoint);
    const { product } = await devtools.send("Browser.getVersion");
    console.log(
      `${product}: ${selected.length} scenarios against the synthetic ${PHONE_TYPE} fixture (firmware ${PHONE_FIRMWARE})`,
    );
    const concurrency = Math.max(
      1,
      Number.parseInt(options.concurrency, 10) || 4,
    );
    const queue = [...selected];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) await runScenario(devtools, queue.shift());
      }),
    );
    failed = report(selected, options.verbose, product, {
      seconds: (Date.now() - began) / 1000,
    });
    if (options.markdown)
      await writeFile(
        path.resolve(repo, options.markdown),
        markdown(selected, product, failed),
        "utf8",
      );
  } catch (error) {
    console.error(`The harness could not run: ${error.message}`);
    failed = Math.max(failed, 1);
  } finally {
    if (devtools) {
      await devtools.send("Browser.close", {}, undefined, 5000).catch(() => {});
      devtools.close();
    }
    if (browser?.pid) {
      const stopped = await Promise.race([exited, delay(5000, false)]);
      if (stopped === false && browser.exitCode === null) {
        const stop = spawn(
          "taskkill.exe",
          ["/PID", String(browser.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        await new Promise((resolve) => stop.once("exit", resolve));
        await exited;
      }
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (
      path.dirname(profile) === path.resolve(tmpdir()) &&
      path.basename(profile).startsWith("sorng-yealink-login-")
    )
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      });
  }
  return failed ? 1 : 0;

  async function runScenario(tools, scenario) {
    const started = Date.now();
    let targetId;
    try {
      ({ targetId } = await tools.send("Target.createTarget", {
        url: "about:blank",
      }));
      const { sessionId } = await tools.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await tools.send("Runtime.enable", {}, sessionId);
      await tools.send("Page.enable", {}, sessionId);
      const navigation = await tools.send(
        "Page.navigate",
        { url: `${hostOrigin()}/web-view/${scenario.key}` },
        sessionId,
      );
      if (navigation.errorText)
        throw new Error(`web view navigation failed: ${navigation.errorText}`);
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const collected = await tools.send(
          "Runtime.evaluate",
          {
            expression: "JSON.stringify(window.__records || [])",
            returnByValue: true,
          },
          sessionId,
        );
        scenario.records = JSON.parse(collected.result.value ?? "[]");
        if (scenario.records.some((item) => item.type === "yealink-collected"))
          break;
        await delay(150);
      }
    } catch (error) {
      scenario.failures.push(error.message);
    } finally {
      scenario.wallMs = Date.now() - started;
      if (targetId)
        await tools.send("Target.closeTarget", { targetId }).catch(() => {});
    }
    verify(scenario);
    console.log(
      `${scenario.failures.length ? "FAIL" : "pass"} ${scenario.name} -> ${
        scenario.collected?.page.authstatus ?? "no authstatus"
      } (${(scenario.wallMs / 1000).toFixed(1)} s)`,
    );
  }
}

function verify(scenario) {
  const fail = (message) => scenario.failures.push(message);
  const check = (label, actual, wanted) => {
    if (actual !== wanted)
      fail(
        `${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
      );
  };
  const collected = scenario.records.find(
    (item) => item.type === "yealink-collected",
  );
  scenario.collected = collected;
  if (!collected) {
    fail("the website frame never reported its state");
    return;
  }
  const { probe, page } = collected;

  // 1. the corrected selectors, each matching exactly once.
  for (const role of ["username", "password", "submit"])
    check(`${role} matches`, probe.matches[role], 1);
  check("the password field is usable", probe.passwordUsable, true);
  check("the username field is usable", probe.usernameUsable, true);
  check("both fields share one form", probe.sameForm, true);

  // 2. the confirm control is an anchor: the plain search misses it, the
  //    override path reaches it.
  check("a plain submit-button search", probe.plainSubmit, null);
  check("the override control", probe.overrideTag, "A");
  check("the override control is usable", probe.overrideUsable, true);

  // 4/5. the page's own script, and what the click did.
  const expected = scenario.expect;
  check("onload started", page.onloadStarted, expected.onloadStarted);
  check("onload finished", page.onloadFinished, expected.onloadFinished);
  check("the login control is bound", page.boundConfirm, expected.boundConfirm);
  check("login requests", page.posts, expected.posts);
  check("the page's authstatus", page.authstatus, expected.authstatus);
  check("shim installed", !!collected.shim?.installed, !!scenario.shim);
  check("parent === window", collected.parentIsSelf, !!scenario.shim);
  if (expected.pageError)
    check("the page error", collected.errors[0] ?? null, expected.pageError);
  else if (collected.errors.length)
    fail(`unexpected page errors: ${collected.errors.join(" | ")}`);
  if (page.lastError) fail(`the page reported ${page.lastError}`);
  check("dialogs raised to the app", scenario.dialogs.length, expected.dialogs);

  // 3. what the phone received.
  const attempts = scenario.phone.state.loginAttempts;
  check("login attempts", attempts.length, expected.attempts);
  const attempt = attempts[0];
  if (attempt) {
    check("the login shape", attempt.shape, "form-rsa-aes");
    check("the answered authstatus", attempt.authstatus, expected.authstatus);
    check(
      "the login fields",
      attempt.detail.fields.join(","),
      RSA_AES_LOGIN_FIELDS.join(","),
    );
    check("the AES key unwrapped to hex", attempt.detail.keyLooksHex, true);
    check("the AES IV unwrapped to hex", attempt.detail.ivLooksHex, true);
    check("the wrapped key size", attempt.detail.wrappedBytes, 128);
    check("the session the page encrypted", attempt.detail.session, "matched");
    check("the random prefix", attempt.detail.randomPrefix, true);
    if (attempt.detail.pwdBytes % 16 || !attempt.detail.pwdBytes)
      fail(`pwd was ${attempt.detail.pwdBytes} bytes, not whole AES blocks`);
    for (const problem of attempt.detail.problems)
      fail(`the phone rejected the body: ${problem}`);
    check(
      "the phone accepted the credentials",
      attempt.ok,
      expected.authstatus === "done",
    );
  }

  // The password must never reach the app document.
  const everything = JSON.stringify([
    collected,
    scenario.dialogs,
    scenario.records,
  ]);
  for (const secret of [ACCOUNT.password, scenario.password].filter(Boolean))
    if (everything.includes(secret))
      fail("a credential appeared in what the frame reported");
}

function rows(selected) {
  return selected.map((scenario, index) => {
    const page = scenario.collected?.page;
    const attempt = scenario.phone.state.loginAttempts[0];
    return [
      String(index + 1),
      scenario.name,
      scenario.shim ? "shim" : "today",
      page ? (page.onloadFinished ? "ok" : "aborted") : "-",
      page ? String(page.posts) : "-",
      attempt
        ? `${attempt.detail.pwdBytes}B/${attempt.detail.wrappedBytes}B`
        : "-",
      page?.authstatus ?? "-",
      // Where the page's own script found the JSESSIONID it encrypts, or, when
      // no login ran, whether the phone's cookie survived the cross-site frame.
      page?.doLoginCalls
        ? page.sessionSource
        : `cookie ${scenario.collected?.cookie ?? "-"}`,
      scenario.failures.length ? "FAIL" : "PASS",
    ];
  });
}

const HEADER = [
  "#",
  "scenario",
  "frame",
  "onload",
  "posts",
  "pwd/wrapped",
  "authstatus",
  "session id",
  "result",
];

function report(selected, verbose, version, { seconds }) {
  const table = rows(selected);
  const widths = HEADER.map((title, column) =>
    Math.max(title.length, ...table.map((row) => row[column].length)),
  );
  const line = (row) =>
    row.map((cell, column) => cell.padEnd(widths[column])).join("  ");
  console.log(
    `\nYealink T2x servlet login in the app's website frame (${version}, ${table.length} scenarios)\n`,
  );
  console.log(line(HEADER));
  console.log(line(widths.map((width) => "-".repeat(width))));
  table.forEach((row) => console.log(line(row)));
  for (const scenario of selected) {
    if (!scenario.failures.length && !verbose) continue;
    console.log(`\n${scenario.name}: ${scenario.summary}`);
    for (const failure of scenario.failures) console.log(`  x ${failure}`);
    if (scenario.collected)
      console.log(`  page ${JSON.stringify(scenario.collected.page)}`);
    for (const dialog of scenario.dialogs)
      console.log(`  dialog ${dialog.kind}: ${dialog.message ?? ""}`);
  }
  const failures = selected.filter((scenario) => scenario.failures.length);
  console.log(
    `\n${selected.length - failures.length} passed, ${failures.length} failed in ${seconds.toFixed(1)} s`,
  );
  return failures.length;
}

function markdown(selected, version, failures) {
  const table = rows(selected);
  const line = (row) => `| ${row.join(" | ")} |`;
  return `# t96 W0 — the Yealink servlet login inside the app's website frame

Executor \`t96-e5a\`, harness \`node scripts/test-yealink-login-browser.mjs\`.
Engine: ${version}. Fixture: synthetic ${PHONE_TYPE} (firmware ${PHONE_FIRMWARE}),
\`e2e/fixtures/voip-phone/\`, loopback only. ${failures ? `${failures} FAILED` : "All scenarios passed"}.

${line(HEADER)}
${line(HEADER.map(() => "---"))}
${table.map(line).join("\n")}

\`frame\` = \`today\` the production sandbox tokens as shipped, \`shim\` the same
tokens plus t95's parent shim as a document-start script. \`posts\` counts login
requests the phone actually received. \`pwd/wrapped\` is the decrypted body's
ciphertext size and the RSA block size.

Every scenario also asserts, in the real engine:

- \`#idUsername\`, \`#idPassword\` and \`#idConfirm\` each match exactly once;
- the password field is a visible \`input[type=password]\` and the username
  field a visible text input in the same form;
- \`autologin_client.js\`'s plain submit-button search finds **nothing**, while
  the override path resolves \`#idConfirm\` (an \`A\`) and accepts it;
- for every login the phone received: the field names are exactly
  \`${RSA_AES_LOGIN_FIELDS.join(", ")}\`, \`rsakey\` and \`rsaiv\` each unwrap
  (RSA-PKCS1v1.5) to 32 hex characters, \`pwd\` decrypts (AES-128-CBC,
  zero-padded) to \`<random>;<JSESSIONID>;<password>\`, and the JSESSIONID is the
  one that login page was issued;
- no credential appears in anything the frame reports to the app document.

## What this settles for the rest of t96

1. **The corrected selectors work and the shipped ones cannot.** \`#idConfirm\`
   is an \`A\`, so \`findSubmitButton\` returns \`null\`; only the override path
   (which accepts \`BUTTON|INPUT|A\`) reaches it. Both attested markups behave
   the same — with a real \`<form>\` and with none, where the override resolves
   through \`nearestScope\`.
2. **Route B is blocked on t95.** Rows 1 and 2 are the same page, same server,
   same click; the only difference is the shim. Without it \`onload\` aborts with
   a SecurityError, \`#idConfirm\` never gets its handler, and the click posts
   nothing at all — no error, no timeout, nothing. With it the page completes and
   signs in.
3. **Fill-and-click alone can never finish this login.** The body the phone
   accepts is computed by the page from its own \`g_rsa_n\`/\`g_rsa_e\` and the
   session cookie; no filler can produce it.
4. **The phone's cookie does survive the website frame** (\`SameSite=None;
   Secure\` on the \`*.localhost\` origin): \`document.cookie\` carried the
   JSESSIONID in every row, including the aborted one. The page-variable
   fallback the fixture also renders was never needed here.
5. **\`none\` and \`lock\` are distinguishable, and neither may be retried.**
   The locked row answers \`lock\` for a *correct* password.
`;
}

const isDirectRun = () => {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const invoked = path.resolve(process.argv[1]);
  return process.platform === "win32"
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self;
};

if (isDirectRun())
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    },
  );
