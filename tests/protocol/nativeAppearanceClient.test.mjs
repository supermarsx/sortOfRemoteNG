import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import { transformSync } from "esbuild";

const source = readFileSync("src-tauri/crates/sorng-browser-host/src/native_appearance_client.js", "utf8");
const vendor = readFileSync("src-tauri/crates/sorng-protocols/src/vendor/darkreader/darkreader.js", "utf8");
const rendererSource = readFileSync("src-tauri/crates/sorng-browser-host/src/cef_appearance_renderer.rs", "utf8");
// Exercise the exact production Rust-owned bootstrap, not a hand-maintained
// approximation of its vendor/client interface. Both includes remain singular.
function assembledSource(engine) {
  assert.match(rendererSource, /include_str!\("native_appearance_bootstrap\.js\.in"\)/);
  const template = readFileSync("src-tauri/crates/sorng-browser-host/src/native_appearance_bootstrap.js.in", "utf8");
  for (const marker of ["/* BUNDLED_DARKREADER */", "/* NATIVE_APPEARANCE_CLIENT */"]) {
    assert.equal(template.split(marker).length, 2, "each static include is singular");
    assert.ok(rendererSource.includes(JSON.stringify(marker)), "Rust uses the identical include marker");
  }
  return template.replace("/* BUNDLED_DARKREADER */", () => engine)
    .replace("/* NATIVE_APPEARANCE_CLIENT */", () => source);
}
const theme = {
  followAppTheme: true, mode: "dynamic", brightness: 90, contrast: 110,
  sepia: 15, grayscale: 5, backgroundColor: "#181a1b", textColor: "#e8e6e3",
  preserveMedia: true, customCss: "",
};
const fakeVendor = `
  globalThis.__vendorCount = (globalThis.__vendorCount || 0) + 1;
  exports.enable = (theme, fixes) => {
    globalThis.__calls.push({kind:'enable', theme, fixes});
    document.documentElement.setAttribute('data-darkreader-mode','dynamic');
    if (globalThis.__throwEnable) throw Error('partial installation');
  };
  exports.disable = () => {
    globalThis.__calls.push({kind:'disable'});
    document.documentElement.removeAttribute('data-darkreader-mode');
  };
  exports.setFetchMethod = fn => { globalThis.__engineFetch = fn; };
`;

function fixture(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main>Hello</main><img src="data:,image"></body></html>', {
    url: "https://fixture.invalid/path", runScripts: "outside-only", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const win = dom.window;
  win.__calls = [];
  win.fetch = options.fetch || (() => Promise.resolve({ ok: true, text: async () => "" }));
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  win.CSS = { supports: () => false, escape: value => value };
  // JSDOM lacks this Chromium interface; the bundle uses it only for instanceof.
  win.SVGStyleElement = class extends win.SVGElement {};
  const existingReader = { marker: "page-owned" };
  const sendMessage = () => {};
  win.DarkReader = existingReader;
  win.chrome = { runtime: { sendMessage } };
  const originalChrome = win.chrome;
  const statuses = [];
  const controller = win.eval(assembledSource(options.real ? vendor : fakeVendor))((revision, status) => statuses.push({ revision, status }));
  assert.equal(typeof controller.apply, "function");
  let revision = 0;
  const apply = config => controller.apply(config, String(revision++), options.main !== false);
  t.after(() => { controller.dispose(); win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  return { win, doc: win.document, apply, controller, statuses, calls: win.__calls, existingReader, originalChrome, sendMessage,
    config: overrides => ({ enabled: true, theme: { ...theme, ...overrides } }),
    css: () => win.document.querySelector(".sorng-native-appearance")?.textContent || "" };
}

test("native appearance dynamic delegates conversion and preserves page globals", t => {
  const f = fixture(t);
  assert.equal(f.apply(f.config()), true);
  const converted = f.calls.find(call => call.kind === "enable");
  assert.equal(converted.theme.brightness, 90);
  assert.equal(converted.theme.contrast, 110);
  assert.equal(converted.theme.sepia, 15);
  assert.equal(converted.theme.grayscale, 5);
  assert.equal(converted.theme.darkSchemeBackgroundColor, theme.backgroundColor);
  assert.equal(converted.theme.darkSchemeTextColor, theme.textColor);
  assert.deepEqual(Array.from(converted.fixes.ignoreImageAnalysis), ["*"]);
  assert.equal(f.css(), "");
  assert.equal(f.win.DarkReader, f.existingReader);
  assert.equal(f.win.chrome, f.originalChrome);
  assert.equal(f.win.chrome.runtime.sendMessage, f.sendMessage);
  assert.equal(f.win.__sorngAppearance, undefined);
});

test("native appearance reapplies changed app colors and skips identical snapshots", t => {
  const f = fixture(t);
  assert.equal(f.apply(f.config()), true);
  assert.equal(f.apply(f.config()), true);
  assert.equal(f.calls.filter(call => call.kind === "enable").length, 1);
  assert.equal(f.apply(f.config({ backgroundColor: "#102030", textColor: "#ABCDEF" })), true);
  assert.equal(f.calls.filter(call => call.kind === "disable").length, 1);
  assert.equal(f.calls.at(-1).theme.darkSchemeTextColor, "#abcdef");
  assert.equal(f.calls.at(-1).theme.darkSchemeBackgroundColor, "#102030");
  assert.equal(f.win.__vendorCount, 1);
});

test("native appearance exact Rust controller interface acknowledges revision and status", t => {
  const f = fixture(t);
  assert.equal(f.controller.apply(f.config(), "42", true), true);
  assert.deepEqual(f.statuses.at(-1), { revision: "42", status: "applied" });
  assert.equal(f.controller.apply({ enabled: false }, "43", true), true);
  assert.deepEqual(f.statuses.at(-1), { revision: "43", status: "off" });
  assert.equal(f.controller.apply(f.config({ brightness: 999 }), "44", true), false);
  assert.deepEqual(f.statuses.at(-1), { revision: "44", status: "fallback" });
  const count = f.statuses.length;
  assert.equal(f.controller.apply(f.config(), "43", true), false);
  assert.equal(f.controller.apply(f.config(), "invalid", true), false);
  assert.equal(f.controller.apply(f.config(), "45", false), false);
  assert.equal(f.statuses.length, count);
});

test("native appearance subframes do not reapply their ancestor's root filter", t => {
  const f = fixture(t, { main: false });
  assert.equal(f.apply(f.config({ mode: "filter" })), true);
  assert.doesNotMatch(f.css(), /html:root\{[^}]*filter:/);
  assert.match(f.css(), /img,video,canvas,svg image,object,embed\{filter:invert/);
  assert.equal(f.apply(f.config({ mode: "dynamicFilter" })), true);
  assert.doesNotMatch(f.css(), /filter:/);
});

test("native appearance dynamicFilter applies adjustments once and never reinverts", t => {
  const f = fixture(t);
  assert.equal(f.apply(f.config({ mode: "dynamicFilter" })), true);
  const engine = f.calls.find(call => call.kind === "enable").theme;
  assert.deepEqual([engine.brightness, engine.contrast, engine.sepia, engine.grayscale], [100, 100, 0, 0]);
  assert.match(f.css(), /brightness\(90%\) contrast\(110%\) sepia\(15%\) grayscale\(5%\)/);
  assert.doesNotMatch(f.css(), /invert|hue-rotate/);
  assert.equal(f.doc.querySelectorAll(".sorng-native-appearance").length, 1);
});

test("native appearance filter uses one inversion with optional media compensation", t => {
  const f = fixture(t);
  assert.equal(f.apply(f.config({ mode: "filter" })), true);
  assert.equal(f.calls.length, 0);
  assert.match(f.css(), /html:root\{[^}]*filter:invert\(100%\) hue-rotate\(180deg\)/);
  assert.match(f.css(), /img,video,canvas,svg image,object,embed\{filter:invert/);
  assert.equal(f.apply(f.config({ mode: "filter", preserveMedia: false })), true);
  assert.doesNotMatch(f.css(), /img,video/);
  assert.equal(f.doc.querySelectorAll(".sorng-native-appearance").length, 1);
});

test("native appearance local CSS mode uses explicit palette and cleans up on disable", t => {
  const f = fixture(t);
  const original = f.doc.createElement("style");
  original.textContent = "main { color: red; }";
  f.doc.head.append(original);
  assert.equal(f.apply(f.config({ mode: "customCss", customCss: "main {color:rgb(2,3,4)}" })), true);
  assert.match(f.css(), /background-color:#181a1b/);
  assert.match(f.css(), /color:rgb\(2,3,4\)/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.apply({ enabled: false }), true);
  assert.equal(f.css(), "");
  assert.equal(original.isConnected, true);
  assert.equal(f.apply(f.config({ mode: "filter" })), true);
  assert.equal(f.apply(null), true);
});

test("native appearance rejects malformed settings and accessor inputs without running them", t => {
  const f = fixture(t);
  const inputs = [
    f.config({ mode: "automatic" }), f.config({ brightness: NaN }), f.config({ brightness: 201 }),
    f.config({ contrast: -1 }), f.config({ sepia: 101 }), f.config({ grayscale: Infinity }),
    f.config({ preserveMedia: "yes" }), f.config({ followAppTheme: 1 }),
    f.config({ backgroundColor: "red; background:url(https://secret)" }),
    f.config({ textColor: "#fff" }), f.config({ extra: true }),
    { ...f.config(), command: "privileged" }, { enabled: 1 }, [], "{}",
  ];
  const getter = { enabled: true, get theme() { throw Error("must never run"); } };
  inputs.push(getter);
  for (const input of inputs) {
    assert.equal(f.apply(f.config({ mode: "filter" })), true);
    assert.equal(f.apply(input), false);
    assert.equal(f.css(), "");
  }
});

test("native appearance local CSS validation matches the saved settings boundary", t => {
  const f = fixture(t);
  const module = { exports: {} };
  const ts = readFileSync("src/utils/connection/websiteDarkMode.ts", "utf8");
  new Function("module", "exports", transformSync(ts, { loader: "ts", format: "cjs" }).code)(module, module.exports);
  const validate = module.exports.validateWebsiteDarkCss;
  for (const css of ["", "main { color: #abc; }", "main:is(.a,.b) {background:linear-gradient(red,blue)}",
    "a {width:calc(100% - 2px)}", "@import 'https://secret';", "a{background:url(https://secret)}",
    "a{background:var(--remote)}", "a{content:attr(secret)}", "a{background:image-set('https://secret' 1x)}",
    "a{behavior:foo}", "a{-moz-binding:foo}", "/* comment */", "a{color:r\\65 d}", "</style>",
    "a\u0000{}", "a".repeat(16385), "é".repeat(8193)]) {
    let valid = true;
    try { validate(css); } catch { valid = false; }
    assert.equal(f.apply(f.config({ mode: "customCss", customCss: css })), valid);
    f.apply(null);
  }
});

test("native appearance auxiliary fetch is same-origin ordinary page fetch only", async t => {
  const requests = [];
  const f = fixture(t, { fetch: async (...args) => { requests.push(args); return { ok: true, text: async () => "css" }; } });
  assert.equal(f.apply(f.config()), true);
  assert.equal(await (await f.win.__engineFetch("/app.css")).text(), "css");
  assert.equal(requests[0][0], "https://fixture.invalid/app.css");
  assert.equal(requests[0][1].credentials, "same-origin");
  assert.equal(requests[0][1].redirect, "error");
  assert.equal(requests[0][1].cache, "no-store");
  for (const blocked of ["https://other.invalid/app.css", "http://fixture.invalid/app.css",
    "https://user:password@fixture.invalid/app.css", "data:text/css,x", "file:///secret", "javascript:alert(1)"]) {
    await assert.rejects(f.win.__engineFetch(blocked), /Native appearance resource unavailable/);
  }
  assert.equal(requests.length, 1);
  f.apply(null);
  await assert.rejects(f.win.__engineFetch("/app.css"));
});

test("native appearance cleanup aborts pending fetch and pagehide permanently disposes", async t => {
  let signal;
  const f = fixture(t, { fetch: (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("aborted"))));
  } });
  f.apply(f.config());
  const pending = f.win.__engineFetch("/app.css");
  f.win.dispatchEvent(new f.win.Event("pagehide"));
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, /Native appearance resource unavailable/);
  assert.equal(f.apply(f.config()), false);
  assert.equal(f.doc.documentElement.hasAttribute("data-darkreader-mode"), false);
});

test("native appearance disable also cancels response bodies after headers arrive", async t => {
  let signal, finish;
  const f = fixture(t, { fetch: async (_url, options) => {
    signal = options.signal;
    return { text: () => new Promise(resolve => { finish = resolve; }) };
  } });
  f.apply(f.config());
  const response = await f.win.__engineFetch("/slow.css");
  const body = response.text();
  f.apply(null);
  assert.equal(signal.aborted, true);
  finish("body arrived after disable");
  await assert.rejects(body, /Native appearance resource unavailable/);
});

test("native appearance rejects foreign DarkReader ownership and cleans partial engine failure", t => {
  const f = fixture(t);
  const foreign = f.doc.createElement("meta");
  foreign.name = "darkreader";
  foreign.content = "page-owned";
  f.doc.head.append(foreign);
  assert.equal(f.apply(f.config()), false);
  assert.equal(f.apply(f.config({ mode: "filter" })), false);
  assert.equal(f.calls.length, 0);
  assert.equal(foreign.isConnected, true);
  foreign.remove();
  f.win.__throwEnable = true;
  assert.equal(f.apply(f.config()), false);
  assert.equal(f.calls.at(-1).kind, "disable");
  assert.equal(f.doc.documentElement.hasAttribute("data-darkreader-mode"), false);
});

test("native appearance actual pinned DarkReader stays private and releases its styles", async t => {
  const f = fixture(t, { real: true });
  assert.equal(f.apply(f.config()), true);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(f.doc.documentElement.getAttribute("data-darkreader-mode"), "dynamic");
  assert.ok(f.doc.querySelector(".darkreader--user-agent"));
  assert.equal(f.win.DarkReader, f.existingReader);
  assert.equal(f.win.chrome, f.originalChrome);
  assert.equal(f.win.chrome.runtime.sendMessage, f.sendMessage);
  assert.equal(f.apply(null), true);
  assert.equal(f.doc.querySelector(".darkreader--user-agent"), null);
  assert.equal(f.doc.documentElement.hasAttribute("data-darkreader-mode"), false);
  assert.equal(f.apply(f.config({ backgroundColor: "#202122" })), true);
  assert.equal(f.apply(f.config({ mode: "filter" })), true);
  assert.equal(f.doc.querySelector(".darkreader--user-agent"), null);
  assert.match(f.css(), /filter:invert/);
});

test("native appearance wrapper adds no content scanner, observer, script URL, or app bridge", () => {
  assert.doesNotMatch(source, /BUNDLED_DARKREADER/);
  assert.doesNotMatch(source, /new MutationObserver|querySelectorAll|attachShadow|postMessage|__TAURI|createElement\(["']script/);
});

test("native appearance waits for the actual root and acknowledges only the latest revision", t => {
  const f = fixture(t);
  const root = f.doc.documentElement;
  root.remove();
  assert.equal(f.controller.apply(f.config(), "100", true), true);
  assert.equal(f.controller.apply(f.config({ backgroundColor: "#102030" }), "101", true), true);
  assert.equal(f.statuses.length, 0, "acceptance is not installation acknowledgement");
  f.doc.append(root);
  f.doc.dispatchEvent(new f.win.Event("readystatechange"));
  assert.deepEqual(f.statuses, [{ revision: "101", status: "applied" }]);
  assert.equal(f.calls.at(-1).theme.darkSchemeBackgroundColor, "#102030");
  f.doc.dispatchEvent(new f.win.Event("DOMContentLoaded"));
  f.controller.apply(f.config(), "101", true);
  assert.equal(f.statuses.length, 1, "no duplicate completion for the same revision");
});

test("native appearance cancels pre-root installation on off and disposal", t => {
  for (const dispose of [false, true]) {
    const f = fixture(t);
    const root = f.doc.documentElement;
    root.remove();
    f.controller.apply(f.config(), "100", true);
    if (dispose) f.controller.dispose();
    else f.controller.apply({ enabled: false }, "101", true);
    f.doc.append(root);
    f.doc.dispatchEvent(new f.win.Event("DOMContentLoaded"));
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.statuses, dispose ? [] : [{ revision: "101", status: "off" }]);
  }
});
