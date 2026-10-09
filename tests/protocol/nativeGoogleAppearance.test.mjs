import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const host = "src-tauri/crates/sorng-browser-host/src/";
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const include = (source, marker, replacement) => {
  assert.equal(source.split(marker).length, 2, "production include remains singular");
  return source.replace(marker, () => replacement);
};
// Mirror the Rust-owned, native-only adapter and bootstrap. Never patch the
// pinned vendor itself, install a page-global bridge, or insert a DOM script.
const vendor = include(
  read("src-tauri/crates/sorng-protocols/src/vendor/darkreader/darkreader.js"),
  read(host + "native_darkreader_dom_proxy.js.in"),
  read(host + "native_darkreader_proxy.js"),
);
const appearanceSource = include(include(
  read(host + "native_appearance_bootstrap.js.in"), "/* BUNDLED_DARKREADER */", vendor,
), "/* NATIVE_APPEARANCE_CLIENT */", read(host + "native_appearance_client.js"));
const modules = [...read(host + "native_login_profiles.rs").split(");")[0]
  .matchAll(/include_str!\("([^"]+)"\)/g)]
  .map(([, path]) => read(host + path)).join("");
const loginSource = include(include(
  read(host + "native_login_client.js"), "/* REVIEWED_FORM_MODULES */", modules,
), "/* NATIVE_KEYBOARD_CLIENT */", read(host + "native_login_typing.js"));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("native DarkReader and Google disabled-Next keyboard flow coexist under a rejecting script-sink policy", { timeout: 15000 }, async t => {
  const policy = "script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'";
  const dom = new JSDOM(`<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <style>body { color: black; background: white; }</style></head><body>
    <form method="POST"><input id="identifierId" name="identifier" type="text" autocomplete="username">
    <input name="hiddenPassword" type="password" aria-hidden="true" tabindex="-1">
    <button id="identifierNext" disabled>Next</button></form></body></html>`, {
    url: "https://accounts.google.com/v3/signin/identifier",
    runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const win = dom.window, doc = win.document;
  let appearance;
  t.after(() => {
    win.dispatchEvent(new win.Event("pagehide"));
    try { appearance?.dispose(); } finally { win.close(); }
  });
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  win.CSS = { supports: () => false, escape: value => value };
  win.SVGStyleElement = class extends win.SVGElement {};
  win.TextEncoder = TextEncoder;
  Object.defineProperty(win.crypto, "subtle", { value: webcrypto.subtle });
  Object.defineProperty(win.HTMLElement.prototype, "offsetParent", { get() { return this.parentElement; } });
  win.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 100, height: 20 }] : []; };
  let networkAttempts = 0, scriptSinks = 0, policyAttempts = 0;
  win.fetch = () => { networkAttempts++; throw Error("synthetic fixture must not access the network"); };
  // JSDOM does not enforce CSP/Trusted Types. Model the upstream failing sink
  // explicitly; this is combined client coverage, not Chromium acceptance.
  const append = win.Element.prototype.append;
  win.Element.prototype.append = function (...values) {
    if (this.tagName === "SCRIPT") {
      scriptSinks++;
      throw new win.TypeError("This document requires TrustedScript assignment");
    }
    return append.apply(this, values);
  };
  win.trustedTypes = Object.freeze({ createPolicy() { policyAttempts++; throw Error("no bypass policy"); } });
  const pageReader = win.DarkReader = { marker: "page-owned" };
  const pageChrome = win.chrome = { runtime: { sendMessage() { throw Error("no page bridge"); } } };
  const originalInsertRule = win.CSSStyleSheet.prototype.insertRule;
  const statuses = [];
  appearance = win.eval(appearanceSource)((revision, status) => statuses.push({ revision, status }));
  const theme = {
    followAppTheme: true, mode: "dynamic", brightness: 90, contrast: 110,
    sepia: 15, grayscale: 5, backgroundColor: "#181a1b", textColor: "#e8e6e3",
    preserveMedia: true, customCss: "",
  };
  assert.equal(appearance.apply({ enabled: true, theme }, "0", true), true);
  assert.equal(statuses.at(-1).status, "applied");
  assert.notEqual(win.CSSStyleSheet.prototype.insertRule, originalInsertRule);
  assert.ok(doc.querySelector(".darkreader--user-agent"));

  const listeners = new Map(), addEventListener = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...args) => {
    if (["keydown", "beforeinput", "input"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
    return addEventListener(type, callback, ...args);
  };
  const values = { username: "operator@example.test", password: "synthetic-password" };
  const signals = [], keys = [];
  let delivered, submissions = 0, identifierValue;
  const until = Date.now() + 12000;
  doc.addEventListener("input", event => {
    const expected = event.target.name === "identifier" ? values.username : values.password;
    doc.querySelector("button").disabled = event.target.value !== expected;
  }, true);
  doc.addEventListener("submit", event => {
    event.preventDefault();
    assert.equal(doc.querySelector("button").disabled, false);
    submissions++;
  });
  doc.getElementById("identifierNext").onclick = event => {
    event.preventDefault();
    identifierValue = doc.getElementById("identifierId").value;
    assert.equal(doc.querySelector('[name="hiddenPassword"]').value, "");
    win.history.replaceState(null, "", "/v3/signin/challenge/pwd");
    doc.body.innerHTML = '<form method="POST"><input id="password" name="Passwd" type="password">' +
      '<input type="checkbox" id="show-password" aria-labelledby="show-label"><label id="show-label" for="show-password">Show password</label>' +
      '<button id="passwordNext" disabled>Next</button></form>';
    assert.equal(appearance.apply({ enabled: true, theme: { ...theme, backgroundColor: "#102030" } }, "1", true), true);
  };
  function key(field, index) {
    const input = doc.getElementById(field === "username" ? "identifierId" : "password");
    const unit = values[field][index];
    const event = { target: input, isTrusted: true, key: unit, data: unit, inputType: "insertText", preventDefault() { this.prevented = true; } };
    for (const type of ["keydown", "beforeinput"]) for (const fn of listeners.get(type) || []) fn(event);
    if (event.prevented) return;
    // Model native send_key_event; the client itself must not assign the value.
    input.value += unit;
    input.setSelectionRange(input.value.length, input.value.length);
    for (const fn of listeners.get("input") || []) fn(event);
    keys.push([field, index]);
  }
  const notify = event => {
    signals.push(event);
    win.setTimeout(() => {
      if (event.startsWith("type|")) {
        const [, action, stage, field, position] = event.split("|"), index = Number(position);
        const role = `type|${stage}|${field}`;
        if (action === "start") delivered.nativeTyping("probe", 0, until, false, role);
        if (action === "key") { key(field, index); delivered.nativeTyping("probe", index + 1, until, false, role); }
      } else if (["identifier", "password"].includes(event)) {
        delivered("https://accounts.google.com", event === "identifier" ? values.username : "",
          event === "password" ? values.password : "", true, until, event);
      }
    }, 0);
  };
  delivered = win.eval(loginSource)(notify, { provider: "google-account" }, "google-account", true);
  while (!signals.includes("form-completed") && !signals.includes("form-rejected") && Date.now() < until) await delay(25);
  assert.equal(signals.at(-1), "form-completed", JSON.stringify(signals));
  assert.equal(submissions, 1);
  assert.equal(identifierValue, values.username);
  assert.equal(doc.getElementById("password").value, values.password);
  assert.equal(doc.getElementById("show-password").checked, false);
  assert.equal(keys.length, values.username.length + values.password.length);
  assert.equal(signals.filter(value => value === "identifier").length, 1);
  assert.equal(signals.filter(value => value === "password").length, 1);
  assert.equal(signals.some(value => value.includes(values.password)), false);
  assert.equal(statuses.at(-1).status, "applied");
  assert.equal(appearance.apply({ enabled: false }, "2", true), true);
  assert.equal(statuses.at(-1).status, "off");
  assert.equal(win.CSSStyleSheet.prototype.insertRule, originalInsertRule);
  assert.equal(doc.querySelectorAll("script").length, 0);
  assert.equal(scriptSinks, 0);
  assert.equal(policyAttempts, 0);
  assert.equal(networkAttempts, 0);
  assert.equal(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content, policy);
  assert.equal(win.DarkReader, pageReader);
  assert.equal(win.chrome, pageChrome);
});
