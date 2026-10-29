import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const base = resolve("src-tauri/crates/sorng-browser-host/src");
const manifest = readFileSync(resolve(base, "native_login_profiles.rs"), "utf8");
const modules = [...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g)]
  .map(([, path]) => readFileSync(resolve(base, path), "utf8")).join("");
const guards = readFileSync("src-tauri/crates/sorng-protocols/src/web_automation_client.js", "utf8");
const source = readFileSync(resolve(base, "native_login_client.js"), "utf8")
  .replace("/* REVIEWED_FORM_MODULES */", () => modules)
  .replace("/* NATIVE_KEYBOARD_CLIENT */", () => readFileSync(resolve(base, "native_login_typing.js"), "utf8"))
  .replace("/* REVIEWED_TOTP_GUARDS */", () => guards.slice(guards.indexOf("  function synologyButtonReady("), guards.indexOf("  function probeTotp(")));
const otpSetup = JSON.parse(readFileSync("src-tauri/src/origin_browser_totp_catalog.json", "utf8")).gitea[0];
const selectors = { username: "#username", password: "#password", submit: "#login" };
const loginHtml = '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="login" type="submit">Login</button></form>';
const otpHtml = '<form method="post" action="/user/two_factor"><input id="passcode" name="passcode" autocomplete="one-time-code"><button class="ui primary" type="submit">Verify</button></form>';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, detail) {
  for (let i = 0; i < 200 && !predicate(); i++) await delay(20);
  assert.ok(predicate(), typeof detail === "function" ? detail() : detail);
}

function fixture(t, options = {}) {
  const origin = options.origin ?? "https://device.test:8443";
  const path = options.otp ? "/user/two_factor" : "/login";
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: `${origin}${options.top ? path : "/shell"}`, runScripts: "outside-only",
  });
  const top = dom.window;
  function frameIn(parent, name, url, tag = "iframe") {
    const frame = parent.document.createElement(tag);
    frame.setAttribute("name", name);
    frame.src = url;
    parent.document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write("<!doctype html><body></body>");
    frame.contentDocument.close();
    return frame;
  }
  const parent = options.nested ? frameIn(top, "outer", `${origin}/outer`).contentWindow : top;
  const frame = options.top ? null : frameIn(parent, options.name ?? "appFrame", options.frameUrl ?? `${origin}${path}`, options.tag);
  const win = frame?.contentWindow ?? top, doc = win.document;
  if (frame && options.id) frame.id = options.id;
  if (frame && options.sandbox !== undefined) frame.setAttribute("sandbox", options.sandbox);
  win.name = options.windowName ?? "";
  if (!options.delayed) doc.body.innerHTML = options.otp ? otpHtml : loginHtml;
  Object.defineProperty(win.HTMLElement.prototype, "offsetParent", { get() { return this.parentElement; } });
  win.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 100, height: 20 }] : []; };
  if (win.location.protocol === "https:") Object.defineProperty(win.crypto, "subtle", { value: webcrypto.subtle });
  win.TextEncoder = TextEncoder;
  if (options.background) {
    for (const view of new Set([top, win])) {
      Object.defineProperty(view.document, "hidden", { get: () => true });
      Object.defineProperty(view.document, "visibilityState", { get: () => "hidden" });
      view.document.hasFocus = () => false;
      view.focus = () => assert.fail("automatic login must not activate a window");
    }
  }
  const signals = [], keys = [], errors = [], deliveries = [];
  win.addEventListener("error", event => { errors.push(event.error); event.preventDefault(); });
  const listeners = new Map(), add = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...args) => {
    if (["keydown", "beforeinput", "input"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
    return add(type, callback, ...args);
  };
  const values = { username: "op", password: "pw1!" };
  const formOptions = { version: 1, fillDelayMs: 0, submitDelayMs: 0, detectionTimeoutMs: 8000, submit: true, fields: [] };
  const restores = [];
  function override(object, key, descriptor) {
    const previous = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, ...descriptor });
    restores.push(() => previous ? Object.defineProperty(object, key, previous) : delete object[key]);
  }
  let deliver, submits = 0, closed = false;
  const deadline = Date.now() + 10000;
  doc.addEventListener("submit", event => { event.preventDefault(); submits++; });
  // JSDOM has real frame/document relationships, but no trusted native input,
  // renderer installation, browser SOP enforcement or CEF focus routing. This
  // driver models receipts and trusted events; only it writes key characters.
  function key(field, index) {
    const input = doc.getElementById(field), unit = values[field][index];
    const event = { target: input, isTrusted: true, key: unit, data: unit, inputType: "insertText", preventDefault() { this.prevented = true; } };
    for (const type of ["keydown", "beforeinput"]) for (const fn of listeners.get(type) ?? []) fn(event);
    if (event.prevented) return false;
    input.value += unit;
    input.setSelectionRange(input.value.length, input.value.length);
    for (const fn of listeners.get("input") ?? []) fn(event);
    keys.push([field, index]);
    return true;
  }
  function send(stage, expectedOrigin = origin) {
    const result = deliver(expectedOrigin, stage === "form" ? values.username : "", stage === "form" ? values.password : "", true, deadline, { ...formOptions, fields: [] }, stage);
    deliveries.push([stage, result]);
    return result;
  }
  function addFrame({ name = "", id = "", windowName = "", url = `${origin}/peer` } = {}) {
    const peer = frameIn(top, name, url);
    peer.id = id;
    peer.contentWindow.name = windowName;
    return peer;
  }
  const f = { dom, top, win, doc, frame, signals, keys, errors, deliveries, values, deadline, key, send, override, addFrame, submits: () => submits };
  t.after(() => {
    closed = true;
    // Restore modeled browser properties before JSDOM recursively closes its
    // real frame tree (a forged contentWindow must not recurse into the top).
    for (const restore of restores.reverse()) restore();
    win.dispatchEvent(new win.Event("pagehide"));
    top.dispatchEvent(new top.Event("pagehide"));
    top.close();
  });
  options.beforeInstall?.(f);
  const configuration = options.configuration ?? (options.otp
    ? { ...otpSetup, origin, digits: 6, fillDelayMs: 0, submitDelayMs: 0, sameOriginLoginFrames: ["appFrame"] }
    : { selectors, sameOriginLoginFrames: ["appFrame"] });
  const notify = signal => {
    signals.push(signal);
    if (options.otp) return;
    top.setTimeout(() => {
      if (closed || signal === options.pauseAt) return;
      try {
        if (["form-prepare", "form", "form-submit"].includes(signal)) send(signal);
        if (signal.startsWith("type|") && !options.manualKeys) {
          const [, action, stage, field, n] = signal.split("|"), index = Number(n);
          const role = `type|${stage}|${field}`;
          if (action === "start") deliver.nativeTyping("probe", 0, deadline, false, role);
          if (action === "key") {
            key(field, index);
            deliver.nativeTyping("probe", index + 1, deadline, false, role);
          }
        }
      } catch (error) { errors.push(error); }
    }, 0);
  };
  deliver = win.eval(source)(notify, configuration, options.otp ? "approved-otp" : (options.adapter ?? "modular-form"), true);
  f.deliver = deliver;
  return f;
}

async function completed(f) {
  await until(() => f.signals.includes("form-completed"), () => JSON.stringify({ signals: f.signals, errors: f.errors.map(String) }));
  assert.equal(f.submits(), 1);
  assert.equal(f.doc.getElementById("username").value, f.values.username);
  assert.equal(f.doc.getElementById("password").value, f.values.password);
  assert.equal(f.keys.length, f.values.username.length + f.values.password.length);
  assert.equal(f.signals.filter(signal => signal === "form").length, 1);
  assert.equal(f.signals.filter(signal => signal === "form-submit").length, 1);
  assert.equal(f.signals.some(signal => signal.includes(f.values.password)), false);
  assert.deepEqual(f.errors, []);
}

for (const [label, options] of [
  ["frame element name", {}],
  ["frame element id", { name: "", id: "appFrame" }],
  ["window name", { name: "", windowName: "appFrame" }],
  ["non-opaque sandbox", { sandbox: "allow-scripts allow-same-origin allow-forms" }],
  ["HTTP exact custom port", { origin: "http://device.test:8080" }],
  ["top with native iframe policy", { top: true }],
  ["top without iframe policy", { top: true, configuration: { selectors } }],
  ["eight unique native frame names", { configuration: { selectors, sameOriginLoginFrames: ["appFrame", "a", "B", "0", "_", "-", "frame_2", "frame-3"] } }],
  ["128-character native frame name", { name: "a".repeat(128), configuration: { selectors, sameOriginLoginFrames: ["a".repeat(128)] } }],
]) {
  test(`${label} completes native-keyboard login exactly once`, async t => {
    const f = fixture(t, options);
    await completed(f);
    assert.equal(f.send("form"), false);
    assert.equal(f.send("form-submit"), false);
  });
}

test("authorized background appFrame waits for delayed controls without activating its tab", async t => {
  const f = fixture(t, { delayed: true, background: true });
  await delay(240);
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.keys, []);
  f.doc.body.innerHTML = loginHtml;
  await completed(f);
  assert.equal(f.doc.hidden, true);
  assert.equal(f.doc.hasFocus(), false);
  assert.equal(f.top.document.hidden, true);
  assert.equal(f.top.document.hasFocus(), false);
});

test("an authorized iframe asks for nothing until the top document has finished loading", async t => {
  let state = "interactive";
  const f = fixture(t, { beforeInstall: f => f.override(f.top.document, "readyState", { get: () => state }) });
  await delay(400);
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.keys, []);
  state = "complete";
  await completed(f);
});

// The routing window of a top document is not opened for a frame.
test("an authorized iframe stays bound to the address it was created at when it routes before its form exists", async t => {
  const f = fixture(t, { delayed: true });
  await delay(60);
  f.win.history.pushState(null, "", "/login/routed");
  f.doc.body.innerHTML = loginHtml;
  await delay(700);
  assert.equal(f.signals.includes("form-prepare"), false);
  assert.deepEqual(f.keys, []);
  assert.equal(f.submits(), 0);
  assert.deepEqual(f.errors, []);
});

test("a hashchange event in an authorized iframe ends its attempt even when its address did not change", async t => {
  const f = fixture(t, { pauseAt: "form" });
  await until(() => f.signals.includes("form"), () => JSON.stringify(f.signals));
  f.win.dispatchEvent(new f.win.Event("hashchange"));
  assert.equal(f.send("form"), false);
  await delay(120);
  assert.deepEqual(f.keys, []);
  assert.equal(f.submits(), 0);
  assert.deepEqual(f.errors, []);
});

for (const [label, peer] of [
  ["duplicate name", { name: "appFrame" }],
  ["mixed name/id", { id: "appFrame" }],
  ["duplicate window name", { windowName: "appFrame" }],
  ["cross-origin duplicate name", { name: "appFrame", url: "https://other.test/peer" }],
]) {
  test(`${label} is ambiguous before any credential request`, async t => {
    const f = fixture(t, { beforeInstall: f => f.addFrame(peer) });
    await delay(60);
    assert.deepEqual(f.signals, []);
    assert.equal(f.send("form"), false);
    assert.deepEqual(f.keys, []);
    assert.equal(f.doc.getElementById("password").value, "");
    assert.equal(f.submits(), 0);
    assert.deepEqual(f.errors, []);
  });
  test(`${label} added while typing prevents further keys, password and submit`, async t => {
    const f = fixture(t, { manualKeys: true });
    await until(() => f.signals.includes("type|start|form|username|0"));
    assert.equal(f.deliver.nativeTyping("probe", 0, f.deadline, false, "type|form|username"), true);
    await until(() => f.signals.includes("type|key|form|username|0"));
    assert.equal(f.key("username", 0), true);
    f.addFrame(peer);
    f.deliver.nativeTyping("probe", 1, f.deadline, false, "type|form|username");
    await until(() => f.signals.some((s) => s.startsWith("form-rejected")), () => JSON.stringify(f.signals));
    assert.deepEqual(f.keys, [["username", 0]]);
    assert.equal(f.signals.filter(signal => signal.startsWith("type|key|")).length, 1);
    assert.equal(f.signals.some(signal => signal.startsWith("type|start|form|password|")), false);
    assert.equal(f.doc.getElementById("password").value, "");
    assert.equal(f.submits(), 0);
    assert.deepEqual(f.errors, []);
  });
}

test("unrelated cross-origin frames with unreadable window names do not block appFrame", async t => {
  const f = fixture(t, { beforeInstall: f => {
    const peer = f.addFrame({ name: "otherFrame", id: "otherId", url: "https://other.test/peer" });
    // Model the SOP exception JSDOM does not enforce for frame WindowProxy.
    f.override(peer.contentWindow, "name", { get() { throw new f.win.DOMException("Blocked", "SecurityError"); } });
  } });
  await completed(f);
});

for (const [label, options] of [
  ["missing native permission", { configuration: { selectors } }],
  ["empty permission list", { configuration: { selectors, sameOriginLoginFrames: [] } }],
  ["wildcard permission", { configuration: { selectors, sameOriginLoginFrames: ["*"] } }],
  ["wrong frame", { name: "otherFrame" }],
  ["case-mismatched frame", { name: "appframe" }],
  ["whitespace-mismatched frame", { name: " appFrame " }],
  ["nested frame", { nested: true }],
  ["cross-host frame", { frameUrl: "https://other.test:8443/login" }],
  ["cross-scheme frame", { frameUrl: "http://device.test:8443/login" }],
  ["cross-port frame", { frameUrl: "https://device.test:9443/login" }],
  ["about:blank frame", { frameUrl: "about:blank" }],
  ["sandbox without same-origin", { sandbox: "allow-scripts allow-forms" }],
  ["sandbox without scripts", { sandbox: "allow-same-origin allow-forms" }],
  ["empty sandbox", { sandbox: "" }],
  ["opaque effective origin", { beforeInstall: f => f.override(f.win, "origin", { value: "null" }) }],
  ["missing frame element", { beforeInstall: f => f.override(f.win, "frameElement", { value: null }) }],
  ["unrelated frame window", { beforeInstall: f => f.override(f.frame, "contentWindow", { value: f.top }) }],
  ["unrelated frame document", { beforeInstall: f => f.override(f.frame, "contentDocument", { value: f.top.document }) }],
  ["disconnected frame", { beforeInstall: f => f.override(f.frame, "isConnected", { value: false }) }],
  ["wrong owner document", { beforeInstall: f => f.override(f.frame, "ownerDocument", { value: f.doc }) }],
  ["security exception", { beforeInstall: f => f.override(f.win, "frameElement", { get() { throw new f.win.DOMException("Blocked", "SecurityError"); } }) }],
]) {
  test(`${label} cannot request or receive iframe credentials`, async t => {
    const f = fixture(t, options);
    await delay(30);
    assert.deepEqual(f.signals, []);
    assert.equal(f.send("form"), false);
    assert.deepEqual(f.keys, []);
    assert.equal(f.submits(), 0);
    assert.equal(f.doc.getElementById("password").value, "");
    assert.deepEqual(f.errors, []);
  });
}

for (const permission of [
  null, true, "appFrame", [], [""], [" appFrame"], [42], ["appFrame\n"],
  ["x".repeat(129)], ["appFrame", "appFrame"],
  ["appFrame", "a", "b", "c", "d", "e", "f", "g", "h"],
  ["appFrame", "*"], ["appFrame", "frame.name"], ["appFrame", "fráme"],
]) {
  test(`invalid frame policy ${JSON.stringify(permission)} fails closed`, async t => {
    // Use a top document to prove malformed policy is rejected as configuration,
    // even when it would not otherwise need iframe permission to log in.
    const f = fixture(t, { top: true, configuration: { selectors, sameOriginLoginFrames: permission } });
    await delay(20);
    assert.deepEqual(f.signals, []);
    assert.equal(f.send("form"), false);
  });
}

for (const adapter of ["legacy-form", "google-account"]) {
  test(`frame policy is not accepted by ${adapter}`, async t => {
    const configuration = adapter === "google-account"
      ? { provider: "google-account", sameOriginLoginFrames: ["appFrame"] }
      : { selectors, sameOriginLoginFrames: ["appFrame"] };
    const f = fixture(t, { top: true, adapter, configuration });
    await delay(20);
    assert.deepEqual(f.signals, []);
    assert.equal(f.send("form"), false);
  });
}

test("configured appFrame cannot authorize a Google provider closure", async t => {
  const f = fixture(t, {
    origin: "https://accounts.google.com", frameUrl: "https://accounts.google.com/v3/signin/identifier",
    adapter: "google-account", configuration: { provider: "google-account", sameOriginLoginFrames: ["appFrame"] },
  });
  await delay(100);
  assert.deepEqual(f.signals, []);
  assert.equal(f.send("form"), false);
  assert.deepEqual(f.keys, []);
});

const changes = [
  ["parent URL", f => f.top.history.replaceState(null, "", "/other")],
  ["parent query", f => f.top.history.replaceState(null, "", "?other")],
  ["parent hash", f => f.top.history.replaceState(null, "", "#other")],
  ["parent origin", f => f.dom.reconfigure({ url: "https://other.test:8443/shell" })],
  ["parent scheme", f => f.dom.reconfigure({ url: "http://device.test:8443/shell" })],
  ["parent port", f => f.dom.reconfigure({ url: "https://device.test:9443/shell" })],
  // JSDOM cannot navigate documents and document is unforgeable. Replace its
  // internal document slot solely to model the browser's WindowProxy behavior.
  ["parent document", f => f.override(f.top, "_document", { value: f.doc.implementation.createHTMLDocument("replacement") })],
  ["frame name", f => { f.frame.name = "other"; }],
  ["frame sandbox", f => f.frame.setAttribute("sandbox", "allow-scripts")],
  ["frame window relation", f => f.override(f.frame, "contentWindow", { value: f.top })],
  ["child URL", f => f.win.history.replaceState(null, "", "/other")],
  ["detached frame", f => f.frame.remove()],
  ["parent access exception", f => f.override(f.win, "parent", { get() { throw new f.win.DOMException("Blocked", "SecurityError"); } })],
];

for (const [label, change] of changes) {
  test(`${label} invalidates a pending native key receipt in the background`, async t => {
    const f = fixture(t, { manualKeys: true, background: true });
    await until(() => f.signals.includes("type|start|form|username|0"), () => JSON.stringify(f.signals));
    const password = f.doc.getElementById("password");
    change(f);
    f.deliver.nativeTyping("probe", 0, f.deadline, false, "type|form|username");
    await delay(120);
    assert.equal(f.signals.some(signal => signal.startsWith("type|key|")), false);
    assert.deepEqual(f.keys, []);
    assert.equal(f.submits(), 0);
    assert.equal(password.value, "");
    assert.equal(f.send("form"), false);
    assert.deepEqual(f.errors, []);
  });
}

for (const event of ["pagehide", "unload", "hashchange", "popstate"]) {
  test(`parent ${event} permanently cancels even if its URL is restored`, async t => {
    const f = fixture(t, { manualKeys: true });
    await until(() => f.signals.includes("type|start|form|username|0"), () => JSON.stringify(f.signals));
    f.top.history.replaceState(null, "", "/other");
    f.top.dispatchEvent(new f.top.Event(event));
    f.top.history.replaceState(null, "", "/shell");
    assert.equal(f.deliver.nativeTyping("probe", 0, f.deadline, false, "type|form|username"), false);
    assert.equal(f.send("form"), false);
    await delay(30);
    assert.deepEqual(f.keys, []);
    assert.equal(f.submits(), 0);
    assert.deepEqual(f.errors, []);
  });
}

test("parent navigation between native key grant and input suppresses the armed key", async t => {
  const f = fixture(t, { manualKeys: true });
  await until(() => f.signals.includes("type|start|form|username|0"));
  f.deliver.nativeTyping("probe", 0, f.deadline, false, "type|form|username");
  await until(() => f.signals.includes("type|key|form|username|0"));
  f.top.history.replaceState(null, "", "/other");
  assert.equal(f.key("username", 0), false);
  assert.deepEqual(f.keys, []);
  assert.equal(f.doc.getElementById("username").value, "");
  assert.equal(f.submits(), 0);
});

for (const stage of ["form-prepare", "form", "form-submit"]) {
  test(`parent navigation rejects the pending ${stage} delivery`, async t => {
    const f = fixture(t, { pauseAt: stage });
    await until(() => f.signals.includes(stage), () => JSON.stringify(f.signals));
    f.top.history.replaceState(null, "", "/other");
    assert.equal(f.send(stage), false);
    await delay(120);
    assert.equal(f.submits(), 0);
    if (stage !== "form-submit") assert.deepEqual(f.keys, []);
    else assert.equal(f.doc.getElementById("password").value, "");
    assert.deepEqual(f.errors, []);
  });
}

test("frame delivery still requires the exact native origin", async t => {
  const f = fixture(t, { pauseAt: "form" });
  await until(() => f.signals.includes("form"));
  for (const origin of ["https://other.test:8443", "https://device.test:9443", "http://device.test:8443"])
    assert.equal(f.send("form", origin), false);
  assert.deepEqual(f.keys, []);
  assert.equal(f.send("form"), true);
  await completed(f);
});

test("changing the supplied configuration cannot extend the copied native frame policy", async t => {
  const configuration = { selectors, sameOriginLoginFrames: ["appFrame"] };
  const f = fixture(t, { configuration, manualKeys: true });
  await until(() => f.signals.includes("type|start|form|username|0"));
  f.frame.name = "other";
  configuration.sameOriginLoginFrames.push("other");
  f.deliver.nativeTyping("probe", 0, f.deadline, false, "type|form|username");
  await delay(100);
  assert.deepEqual(f.keys, []);
  assert.equal(f.signals.some(signal => signal.startsWith("type|key|")), false);
});

for (const [label, options, allowed] of [
  ["authorized HTTPS iframe", {}, false],
  ["HTTP top document", { top: true, origin: "http://device.test:8080" }, false],
  ["HTTPS top document", { top: true }, true],
]) {
  test(`automatic OTP stays top/HTTPS-only: ${label}`, async t => {
    const f = fixture(t, { ...options, otp: true });
    if (allowed) await until(() => f.signals.some(signal => signal.startsWith("totp|start|")));
    else {
      await delay(100);
      assert.deepEqual(f.signals, []);
      assert.equal(f.deliver("probe", 0, f.deadline, true), false);
    }
    assert.equal(f.doc.getElementById("passcode").value, "");
    assert.equal(f.submits(), 0);
    assert.deepEqual(f.errors, []);
  });
}
