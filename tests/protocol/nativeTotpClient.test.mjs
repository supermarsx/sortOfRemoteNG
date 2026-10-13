import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { createRequire } from "node:module";

const guards = readFileSync("src-tauri/crates/sorng-protocols/src/web_automation_client.js", "utf8");
const source = readFileSync("src-tauri/crates/sorng-browser-host/src/native_login_client.js", "utf8")
  .replace("/* REVIEWED_TOTP_GUARDS */", () => guards.slice(guards.indexOf("  function synologyButtonReady("), guards.indexOf("  function probeTotp(")));
const catalog = JSON.parse(readFileSync("src-tauri/src/origin_browser_totp_catalog.json", "utf8"));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("native MFA snapshot matches every reviewed application challenge", async () => {
  const result = await build({ entryPoints:["src/utils/connection/httpApplicationProfiles.ts"], bundle:true, platform:"node", format:"cjs", write:false, packages:"external" });
  const module = { exports:{} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  assert.deepEqual(catalog, JSON.parse(JSON.stringify(Object.fromEntries(module.exports.HTTP_APPLICATION_PROFILES.filter(p => p.totpChallenges?.length).map(p => [p.id, p.totpChallenges])))));
});

function fixture(t, options = {}) {
  const dom = new JSDOM(options.html || '<form method="post" action="/user/two_factor"><input id="passcode" name="passcode" autocomplete="one-time-code"><button class="ui primary" type="submit">Verify</button></form>', {
    url: options.url || "https://device.test/user/two_factor", runScripts:"outside-only",
  });
  const win = dom.window, doc = win.document;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  Object.defineProperty(win.HTMLElement.prototype, "offsetParent", { get() { return this.hidden ? null : this.parentElement; } });
  const listeners = new Map();
  const original = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...args) => {
    if (["keydown", "beforeinput", "input"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
    return original(type, callback, ...args);
  };
  const signals = [], typed = [];
  let submits = 0, dispatch;
  const input = doc.querySelector("input");
  doc.querySelector("form").addEventListener("submit", e => { e.preventDefault(); submits++; });
  const setup = { ...catalog.gitea[0], origin:"https://device.test", digits:6, fillDelayMs:0, submitDelayMs:0, ...options.setup };
  const expiry = Date.now() + (options.ttl ?? 5000);
  // This is a browser-process keyboard MODEL, not evidence of live CEF input.
  // Only this test driver mutates the field; production sends CEF key events.
  const character = unit => {
    const event = { target:input, isTrusted:true, key:unit, data:unit, inputType:"insertText", preventDefault() { this.prevented = true; } };
    for (const callback of listeners.get("keydown") || []) callback(event);
    for (const callback of listeners.get("beforeinput") || []) callback(event);
    if (event.prevented) return;
    input.value += unit;
    input.setSelectionRange(input.value.length, input.value.length);
    for (const callback of listeners.get("input") || []) callback(event);
    typed.push(unit);
  };
  const signal = event => {
    signals.push(event);
    const [, command, , indexText] = event.split("|");
    const index = Number(indexText);
    // From the start request on, no page timer ever fires again.
    if (options.freezeOnStart && command === "start") win.setTimeout = () => 0;
    if (options.manual) return;
    setTimeout(() => {
      if (command === "start") dispatch("probe", 0, expiry, options.submit !== false);
      if (command === "key") {
        character("123456"[index]);
        dispatch("probe", index + 1, expiry, options.submit !== false);
      }
      if (command === "finish") dispatch("submit", 6, expiry, true);
    }, 0);
  };
  dispatch = win.eval(source)(signal, setup, "approved-otp");
  return { win, doc, input, signals, typed, dispatch, expiry, submits:() => submits, character };
}

test("approved OTP stage types sequentially and submits only after fresh native finish", async t => {
  const f = fixture(t, { setup:{fillDelayMs:40, submitDelayMs:60} });
  await delay(20); assert.equal(f.signals.length, 0);
  for (let i = 0; i < 40 && f.submits() === 0; i++) await delay(50);
  assert.equal(f.typed.join(""), "123456");
  assert.equal(f.input.value, "123456");
  assert.equal(f.submits(), 1);
  assert.equal(f.signals.filter(s => s.includes("|key|")).length, 6);
  assert.equal(f.signals.filter(s => s.includes("|finish|")).length, 1);
  assert.equal(f.dispatch("submit", 6, f.expiry, true), false);
});

test("saved manual submit leaves a fully typed OTP for the user", async t => {
  const f = fixture(t, { submit:false });
  for (let i = 0; i < 40 && f.input.value !== "123456"; i++) await delay(50);
  assert.equal(f.input.value, "123456");
  assert.equal(f.submits(), 0);
  assert.equal(f.signals.some(s => s.includes("|finish|")), false);
});

test("HTTP password support does not grant automatic TOTP on an exact HTTP origin", async t => {
  const f = fixture(t, {
    url: "http://device.test:8080/user/two_factor",
    setup: { origin: "http://device.test:8080" },
  });
  await delay(100);
  assert.deepEqual(f.signals, []);
  assert.equal(f.dispatch("probe", 0, f.expiry, true), false);
  assert.deepEqual(f.typed, []);
  assert.equal(f.input.value, "");
  assert.equal(f.submits(), 0);
});

test("manual code and another focused control are never overwritten", async t => {
  const f = fixture(t);
  f.input.value = "999";
  await delay(120);
  assert.equal(f.input.value, "999"); assert.equal(f.signals.length, 0);
});

// Finding A2: the challenge can appear while the control that submitted the
// password still has focus.
test("OTP discovery keeps looking while another control holds focus and starts once it is released", async t => {
  const f = fixture(t);
  const button = f.doc.querySelector("button");
  button.focus();
  await delay(450);
  assert.equal(f.doc.activeElement, button);
  assert.deepEqual(f.signals, []);
  assert.equal(f.input.value, "");
  button.blur();
  for (let i = 0; i < 40 && f.submits() === 0; i++) await delay(50);
  assert.equal(f.input.value, "123456");
  assert.equal(f.submits(), 1);
  assert.equal(f.signals.filter(s => s.includes("|start|")).length, 1);
});

test("a control that is no longer shown does not keep OTP discovery waiting", async t => {
  const f = fixture(t, { html: '<form method="post" action="/user/two_factor"><input id="passcode" name="passcode" autocomplete="one-time-code"><button class="ui primary" type="submit">Verify</button></form><button id="previous" type="button">Sign in</button>' });
  const previous = f.doc.getElementById("previous");
  previous.focus();
  previous.hidden = true;
  assert.equal(f.doc.activeElement, previous);
  for (let i = 0; i < 40 && f.submits() === 0; i++) await delay(50);
  assert.equal(f.input.value, "123456");
  assert.equal(f.submits(), 1);
});

const kinds = f => f.signals.map(s => { const [, command, , index] = s.split("|"); return command + index; });

test("OTP digits are requested by receipts and input events: typing finishes with every page timer frozen", async t => {
  const f = fixture(t, { freezeOnStart:true });
  for (let i = 0; i < 40 && f.submits() === 0; i++) await delay(25);
  assert.equal(f.typed.join(""), "123456");
  assert.equal(f.submits(), 1);
  assert.deepEqual(kinds(f), ["start0", "key0", "key1", "key2", "key3", "key4", "key5", "finish6"]);
});

test("an OTP receipt that overtakes its input event waits for that event, and an undelivered digit fails closed", async t => {
  const f = fixture(t, { manual:true });
  for (let i = 0; i < 40 && !f.signals.length; i++) await delay(10);
  assert.deepEqual(kinds(f), ["start0"]);
  // The start grant asks for the first digit at once, not after a timer.
  assert.equal(f.dispatch("probe", 0, f.expiry, true), true);
  assert.deepEqual(kinds(f), ["start0", "key0"]);
  // Receipt first: the next digit waits for the trusted input event.
  assert.equal(f.dispatch("probe", 1, f.expiry, true), true);
  assert.deepEqual(kinds(f), ["start0", "key0"]);
  f.character("1");
  assert.deepEqual(kinds(f), ["start0", "key0", "key1"]);
  // Input event first: the receipt requests the next digit.
  f.character("2");
  assert.deepEqual(kinds(f), ["start0", "key0", "key1"]);
  assert.equal(f.dispatch("probe", 2, f.expiry, true), true);
  assert.deepEqual(kinds(f), ["start0", "key0", "key1", "key2"]);
  // A digit the engine never delivers is not requested again.
  assert.equal(f.dispatch("probe", 3, f.expiry, true), true);
  await delay(1700);
  assert.deepEqual(kinds(f), ["start0", "key0", "key1", "key2", "cancel0"]);
  assert.equal(f.input.value, "12");
  assert.equal(f.dispatch("probe", 3, f.expiry, true), false);
  assert.equal(f.submits(), 0);
});

for (const [label, drive] of [
  ["a repeated start grant", f => f.dispatch("probe", 0, f.expiry, true)],
  ["a receipt for a digit that was not requested", f => { f.character("1"); f.dispatch("probe", 1, f.expiry, true); f.character("2"); return f.dispatch("probe", 3, f.expiry, true); }],
  ["a receipt that claims two digits at once", f => f.dispatch("probe", 2, f.expiry, true)],
]) {
  test(`event-driven OTP receipts reject ${label}`, async t => {
    const f = fixture(t, { manual:true });
    for (let i = 0; i < 40 && !f.signals.length; i++) await delay(10);
    assert.equal(f.dispatch("probe", 0, f.expiry, true), true);
    assert.equal(drive(f), false);
    assert.equal(kinds(f).at(-1), "cancel0");
    assert.equal(f.signals.filter(s => s.includes("|key|")).length <= 2, true);
    assert.equal(f.submits(), 0);
  });
}

test("navigation, action replacement, focus changes, and expired code cancel without keys", async t => {
  for (const change of [
    f => f.win.history.replaceState({}, "", "/user/login"),
    f => f.doc.querySelector("form").action = "https://other.test/collect",
    f => f.doc.querySelector("button").focus(),
    f => f.input.value = "manual",
  ]) {
    const f = fixture(t, { manual:true });
    await delay(20);
    change(f);
    f.dispatch("probe", 0, f.expiry, true);
    await delay(70);
    assert.equal(f.signals.some(s => s.includes("|key|")), false);
    assert.equal(f.submits(), 0);
  }
  const f = fixture(t, { manual:true });
  await delay(20);
  assert.equal(f.dispatch("probe", 0, Date.now() - 1, true), false);
  assert.equal(f.signals.some(s => s.includes("|key|")), false);
});

test("OTP renderer contract never receives secrets or sets field values", () => {
  const otp = source.slice(source.indexOf("function approvedOtpStage"), source.indexOf("  var stopped = false;"));
  assert.doesNotMatch(otp, /\.value\s*=(?!=)|setNativeValue|dispatchEvent|KeyboardEvent/);
  assert.match(otp, /emit\("key", index\)/);
  const bridge = readFileSync("src-tauri/crates/sorng-browser-host/src/cef_login_totp.rs", "utf8");
  assert.match(bridge, /send_cef_login_character\(browser, target, unit\)/);
  assert.doesNotMatch(bridge, /CefString::from\(code\.code\)/);
});
