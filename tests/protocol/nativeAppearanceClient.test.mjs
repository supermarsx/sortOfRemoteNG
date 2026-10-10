import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import { transformSync } from "esbuild";

const source = readFileSync("src-tauri/crates/sorng-browser-host/src/native_appearance_client.js", "utf8");
const vendor = readFileSync("src-tauri/crates/sorng-protocols/src/vendor/darkreader/darkreader.js", "utf8");
const rendererSource = readFileSync("src-tauri/crates/sorng-browser-host/src/cef_appearance_renderer.rs", "utf8");
const proxyTemplate = readFileSync("src-tauri/crates/sorng-browser-host/src/native_darkreader_dom_proxy.js.in", "utf8").replace(/\r\n/g, "\n");
const nativeProxy = readFileSync("src-tauri/crates/sorng-browser-host/src/native_darkreader_proxy.js", "utf8").replace(/\r\n/g, "\n");
// Exercise the exact production Rust-owned bootstrap, not a hand-maintained
// approximation of its vendor/client interface. Both includes remain singular.
function assembledSource(engine, adapt = true) {
  if (engine === vendor && adapt) {
    // Identical singular replacement as the production Rust adapter. Vendor
    // bytes remain pinned; this is only for the native V8-owned closure.
    assert.match(rendererSource, /darkreader::adapt\(include_str!/);
    engine = engine.replace(/\r\n/g, "\n");
    assert.equal(engine.split(proxyTemplate).length, 2);
    engine = engine.replace(proxyTemplate, () => nativeProxy);
  }
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
    url: options.url || "https://fixture.invalid/path", runScripts: "outside-only", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const win = dom.window;
  win.__calls = [];
  win.fetch = options.fetch || (() => Promise.resolve({ ok: true, text: async () => "" }));
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  win.CSS = { supports: () => false, escape: value => value };
  // JSDOM lacks these Chromium interfaces; the bundle uses them for instanceof.
  win.SVGStyleElement = class extends win.SVGElement {};
  win.SVGTextElement = class extends win.SVGElement {};
  const existingReader = { marker: "page-owned" };
  const sendMessage = () => {};
  win.DarkReader = existingReader;
  win.chrome = { runtime: { sendMessage } };
  const originalChrome = win.chrome;
  const statuses = [];
  let scriptSinks = 0;
  if (options.rejectScript) {
    // A deterministic policy-sink model, not a substitute for Chromium CSP
    // acceptance: reject the exact script.append sink used by upstream.
    const append = win.Element.prototype.append;
    win.Element.prototype.append = function (...values) {
      if (this.tagName === "SCRIPT") {
        scriptSinks++;
        throw new win.TypeError(options.rejectScript);
      }
      return append.apply(this, values);
    };
    win.trustedTypes = Object.freeze({ createPolicy() { throw Error("must not create a bypass policy"); } });
  }
  const controller = win.eval(assembledSource(options.real ? vendor : fakeVendor, options.adapt !== false))((revision, status) => statuses.push({ revision, status }));
  assert.equal(typeof controller.apply, "function");
  let revision = 0;
  const apply = config => controller.apply(config, String(revision++), options.main !== false);
  t.after(() => { controller.dispose(); win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  return { win, doc: win.document, apply, controller, statuses, calls: win.__calls, existingReader, originalChrome, sendMessage,
    config: overrides => ({ enabled: true, theme: { ...theme, ...overrides } }),
    scriptSinks: () => scriptSinks,
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

test("native bundled hooks avoid inline and TrustedScript sinks on every origin", t => {
  for (const policy of ["Inline execution blocked by script-src", "This document requires TrustedScript assignment"]) {
    const baseline = fixture(t, { real: true, adapt: false, rejectScript: policy });
    assert.equal(baseline.apply(baseline.config()), false);
    assert.equal(baseline.scriptSinks(), 1, "baseline reproduces the blocked upstream sink");
    assert.equal(baseline.statuses.at(-1).status, "fallback");

    const fixed = fixture(t, { real: true, rejectScript: policy });
    const csp = fixed.doc.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'";
    fixed.doc.head.append(csp);
    const original = fixed.win.CSSStyleSheet.prototype.insertRule;
    assert.equal(fixed.apply(fixed.config()), true);
    assert.equal(fixed.statuses.at(-1).status, "applied");
    assert.notEqual(fixed.win.CSSStyleSheet.prototype.insertRule, original, "the real stylesheet hooks are installed");
    assert.equal(fixed.doc.querySelectorAll("script").length, 0);
    assert.equal(fixed.scriptSinks(), 0, "no DOM-script assignment to block or retry");
    assert.equal(csp.content, "script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'");
    assert.ok(fixed.doc.querySelector(".darkreader--user-agent"));
    assert.equal(fixed.apply(fixed.config({ backgroundColor: "#102030" })), true);
    assert.equal(fixed.scriptSinks(), 0, "theme reapplication must also avoid the sink");
    assert.equal(fixed.apply({ enabled: false }), true);
    assert.equal(fixed.win.CSSStyleSheet.prototype.insertRule, original, "turning off restores the native stylesheet API");
  }
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

test("native appearance wrapper adds no content reader, script URL, or app bridge", () => {
  assert.doesNotMatch(source, /BUNDLED_DARKREADER/);
  assert.doesNotMatch(source, /innerHTML|innerText|textContent\s*[^=\s]|postMessage|__TAURI|createElement\(["']script/);
});

function openRoot(f, parent = f.doc.body) {
  const host = f.doc.createElement("div");
  parent.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<div class="panel">Panel<img src="data:,image"></div>';
  return root;
}
const shadowCss = root => root.querySelector(".sorng-native-appearance")?.textContent || "";
const settle = () => new Promise(resolve => setTimeout(resolve, 40));

test("native filter reaches nested open roots without multiplying the ancestor filter", t => {
  for (const main of [true, false]) {
    const f = fixture(t, { main });
    const root = openRoot(f), nested = openRoot(f, root);
    const config = f.config({ mode: "filter", customCss: ".panel{border-color:#456!important}" });
    assert.equal(f.apply(config), true);
    for (const scope of [root, nested]) {
      assert.match(shadowCss(scope), /img,video,canvas,svg image,object,embed\{filter:invert/);
      assert.match(shadowCss(scope), /\.panel\{border-color:#456!important\}/);
      assert.doesNotMatch(shadowCss(scope), /brightness|contrast|:host\{[^}]*filter:|html:root/);
    }
    assert.equal(f.apply(config), true);
    assert.equal(root.querySelectorAll(".sorng-native-appearance").length, 1);
    assert.equal(f.apply(f.config({ mode: "filter", preserveMedia: false })), true);
    assert.equal(shadowCss(root), "", "no unnecessary shadow styles without media compensation or custom CSS");
    assert.equal(shadowCss(nested), "");
  }
});

test("native custom CSS reaches existing, inserted, and late-attached nested open roots", async t => {
  const f = fixture(t);
  const root = openRoot(f), nested = openRoot(f, root);
  const originalAttach = f.win.Element.prototype.attachShadow;
  assert.equal(f.apply(f.config({ mode: "customCss", customCss: ".panel{border-color:#456!important}" })), true);
  const inserted = openRoot(f);
  const late = openRoot(f, nested);
  const detached = openRoot(f, f.doc.createElement("section"));
  assert.equal(shadowCss(detached), "", "disconnected trees are not observed");
  f.doc.body.append(detached.host.parentNode);
  await settle();
  for (const scope of [root, nested, inserted, late, detached]) {
    assert.match(shadowCss(scope), /:host\{color-scheme:dark!important;/);
    assert.match(shadowCss(scope), /background-color:#181a1b!important;color:#e8e6e3!important/);
    assert.match(shadowCss(scope), /\.panel\{border-color:#456!important\}/);
    assert.doesNotMatch(shadowCss(scope), /filter:|brightness|invert/);
  }
  const pageStyle = f.doc.createElement("style");
  pageStyle.textContent = ".panel{margin:1px}";
  root.append(pageStyle);
  assert.equal(f.apply({ enabled: false }), true);
  for (const scope of [root, nested, inserted, late, detached]) assert.equal(shadowCss(scope), "");
  assert.equal(pageStyle.parentNode, root, "page-owned styles remain untouched");
  assert.equal(f.win.Element.prototype.attachShadow, originalAttach);
  assert.equal(shadowCss(openRoot(f, root)), "", "disabled hooks cannot reinstall styles");
});

test("native shadow styles recover from component replacement and release removed trees", async t => {
  const f = fixture(t);
  const root = openRoot(f), nested = openRoot(f, root);
  f.apply(f.config({ mode: "customCss" }));
  root.innerHTML = '<div class="replacement">Replacement</div>';
  await settle();
  assert.equal(root.querySelectorAll(".sorng-native-appearance").length, 1);
  assert.equal(shadowCss(nested), "", "removed nested roots release their owned styles");
  root.append(nested.host);
  await settle();
  assert.ok(shadowCss(nested), "reinserted roots are styled again");
  root.host.remove();
  await settle();
  assert.equal(shadowCss(root), "");
  assert.equal(shadowCss(nested), "");
  f.doc.body.append(root.host);
  await settle();
  assert.ok(shadowCss(root));
  assert.ok(shadowCss(nested));
  f.controller.dispose();
  assert.equal(shadowCss(root), "");
  assert.equal(shadowCss(nested), "");
});

test("native shadow work is structural only and does not cross closed or frame contexts", async t => {
  const f = fixture(t);
  const subscriptions = [];
  const Observer = f.win.MutationObserver;
  f.win.MutationObserver = class extends Observer {
    observe(target, options) { subscriptions.push({ target, options }); super.observe(target, options); }
  };
  const root = openRoot(f);
  const closedHost = f.doc.createElement("div");
  f.doc.body.append(closedHost);
  const closed = closedHost.attachShadow({ mode: "closed" });
  const frame = f.doc.createElement("iframe");
  f.doc.body.append(frame);
  assert.equal(f.apply(f.config({ mode: "filter" })), true);
  await settle();
  assert.ok(shadowCss(root));
  assert.equal(shadowCss(closed), "");
  assert.equal(frame.contentDocument.querySelector(".sorng-native-appearance"), null, "CEF owns each frame controller");
  for (const { target, options } of subscriptions) {
    assert.ok(target === f.doc || target === root);
    assert.deepEqual(Object.keys(options).sort(), ["childList", "subtree"]);
    assert.equal(options.childList, true);
    assert.equal(options.subtree, true);
  }
});

test("actual native DarkReader owns dynamic conversion in existing and late nested roots", async t => {
  const f = fixture(t, { real: true, rejectScript: "TrustedScript required" });
  const root = openRoot(f), nested = openRoot(f, root);
  const lateHost = f.doc.createElement("div");
  const documentHost = f.doc.createElement("div");
  nested.append(lateHost);
  f.doc.body.append(documentHost);
  const originalAttach = f.win.Element.prototype.attachShadow;
  assert.equal(f.apply(f.config()), true);
  await settle();
  for (const scope of [root, nested]) {
    assert.equal(scope.querySelectorAll(".darkreader--inline").length, 1);
    assert.equal(shadowCss(scope), "", "no duplicate wrapper conversion pipeline");
  }
  const late = lateHost.attachShadow({ mode: "open" });
  late.innerHTML = '<div class="panel" style="background-color:white;color:black">Late panel</div>';
  const documentLate = documentHost.attachShadow({ mode: "open" });
  documentLate.innerHTML = '<div class="panel" style="background-color:white;color:black">Late panel</div>';
  await settle();
  for (const scope of [late, documentLate]) {
    assert.equal(scope.querySelectorAll(".darkreader--inline").length, 1);
    const panel = scope.querySelector(".panel");
    assert.ok(panel.hasAttribute("data-darkreader-inline-bgcolor"));
    panel.style.backgroundColor = "red";
  }
  await settle();
  for (const scope of [late, documentLate]) {
    assert.match(scope.querySelector(".panel").style.getPropertyValue("--darkreader-inline-bgcolor"), /--darkreader-background-ff0000/);
  }
  assert.equal(shadowCss(late), "");
  assert.equal(f.apply({ enabled: false }), true);
  for (const scope of [root, nested, late, documentLate]) assert.equal(scope.querySelectorAll(".darkreader").length, 0);
  assert.equal(f.win.Element.prototype.attachShadow, originalAttach);
  assert.equal(f.scriptSinks(), 0);
});

test("actual native DarkReader converts nested inline containers and reapplies settings with local CSS", async t => {
  for (const mode of ["dynamic", "dynamicFilter"]) {
    const f = fixture(t, { real: true });
    const originalDescriptor = Object.getOwnPropertyDescriptor(f.win.Element.prototype, "attachShadow");
    const root = openRoot(f), nested = openRoot(f, root);
    const lightPanel = f.doc.querySelector("main");
    const panels = [lightPanel, root.querySelector(".panel"), nested.querySelector(".panel")];
    for (const panel of panels) panel.setAttribute("style", "background-color:white!important;color:black!important");
    const customCss = ".panel{border-color:#abcdef!important}";
    assert.equal(f.apply(f.config({ mode, customCss })), true);
    await settle();
    for (const panel of panels) {
      assert.ok(panel.hasAttribute("data-darkreader-inline-bgcolor"), "real engine converts light and shadow containers");
      assert.ok(panel.hasAttribute("data-darkreader-inline-color"));
      assert.ok(panel.style.getPropertyValue("--darkreader-inline-bgcolor"));
      assert.notEqual(panel.style.getPropertyValue("--darkreader-inline-bgcolor"), "#ffffff");
    }
    for (const scope of [root, nested]) {
      assert.equal(shadowCss(scope).trim(), customCss, "supplemental sheet contains only the user's CSS");
      assert.equal(scope.querySelectorAll(".darkreader--inline").length, 1);
    }
    // DarkReader keeps an inherited variable reference in inline declarations;
    // settings changes update its shared definition, not the fallback literal.
    const backgroundVariable = () => f.doc.querySelector(".darkreader--variables")
      .sheet.cssRules[0].style.getPropertyValue("--darkreader-background-ffffff");
    const before = backgroundVariable();
    assert.ok(before);
    assert.equal(f.apply(f.config({ mode, customCss, backgroundColor: "#102030", preserveMedia: false })), true);
    await settle();
    assert.notEqual(backgroundVariable(), before);
    panels.forEach(panel => assert.match(panel.style.getPropertyValue("--darkreader-inline-bgcolor"), /var\(--darkreader-background-ffffff,/));
    for (const scope of [root, nested]) {
      assert.equal(scope.querySelectorAll(".sorng-native-appearance").length, 1);
      assert.equal(scope.querySelectorAll(".darkreader--inline").length, 1);
    }
    assert.equal(f.apply(f.config({ mode: "filter" })), true);
    for (const scope of [root, nested]) assert.equal(scope.querySelector(".darkreader--inline"), null);
    assert.equal(f.apply({ enabled: false }), true);
    for (const scope of [root, nested]) assert.equal(scope.querySelector(".darkreader"), null);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.win.Element.prototype, "attachShadow"), originalDescriptor);
  }
});

test("native shadow cleanup restores descriptors, leaves later page hooks, and cancels queued discovery", async t => {
  const f = fixture(t);
  const proto = f.win.Element.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "attachShadow");
  const root = openRoot(f);
  assert.equal(f.apply(f.config({ mode: "customCss" })), true);
  assert.equal(f.apply(f.config({ mode: "invalid" })), false);
  assert.equal(shadowCss(root), "");
  assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "attachShadow"), original);
  f.apply(f.config({ mode: "customCss" }));
  const nativeHook = proto.attachShadow;
  const pageHook = function (...args) { return Reflect.apply(nativeHook, this, args); };
  proto.attachShadow = pageHook;
  f.apply({ enabled: false });
  assert.equal(proto.attachShadow, pageHook, "a later page wrapper is not overwritten");
  assert.equal(shadowCss(openRoot(f, root)), "", "retained native wrapper is inert");
  Object.defineProperty(proto, "attachShadow", original);

  const real = fixture(t, { real: true });
  const realDescriptor = Object.getOwnPropertyDescriptor(real.win.Element.prototype, "attachShadow");
  const parent = openRoot(real);
  const host = real.doc.createElement("div");
  parent.append(host);
  real.apply(real.config());
  await settle();
  const late = host.attachShadow({ mode: "open" });
  real.apply({ enabled: false });
  await settle();
  assert.equal(late.querySelector(".darkreader"), null, "disable cancels queued vendor discovery");
  assert.deepEqual(Object.getOwnPropertyDescriptor(real.win.Element.prototype, "attachShadow"), realDescriptor);
});

test("native queued shadow discovery contains hostile DOM and vendor failures and still disables cleanly", { timeout: 5000 }, async t => {
  for (const failure of ["host", "vendor"]) {
    const f = fixture(t, { real: true });
    const original = Object.getOwnPropertyDescriptor(f.win.Element.prototype, "attachShadow");
    const parent = openRoot(f);
    const host = f.doc.createElement("div");
    parent.append(host);
    const errors = [];
    f.win.addEventListener("error", event => { errors.push(event.error); event.preventDefault(); });
    assert.equal(f.apply(f.config()), true);
    await settle();
    const root = host.attachShadow({ mode: "open" });
    // Replace only the surface used by the queued native discovery. Attachment
    // has succeeded already; neither a host getter nor vendor traversal failure
    // should become an uncaught page error or prevent normal disable cleanup.
    const target = failure === "host" ? host : root;
    const method = failure === "host" ? "getRootNode" : "querySelectorAll";
    let attempts = 0;
    target[method] = () => { attempts++; throw Error(`synthetic ${failure} failure`); };
    try { await settle(); } finally { delete target[method]; }
    assert.ok(attempts > 0, "the queued discovery exercised the throwing surface");
    assert.equal(f.apply({ enabled: false }), true);
    assert.equal(root.querySelector(".darkreader"), null);
    assert.equal(parent.querySelector(".darkreader"), null);
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.win.Element.prototype, "attachShadow"), original);
    assert.deepEqual(errors, [], "optional discovery cannot emit an uncaught microtask error");
  }
});

test("actual native appearance controllers remain frame-local without reaching sibling documents", async t => {
  const parent = fixture(t, { real: true });
  const child = fixture(t, { real: true, main: false, url: "https://other-origin.invalid/frame" });
  const root = openRoot(parent), childRoot = openRoot(child);
  const frame = parent.doc.createElement("iframe");
  parent.doc.body.append(frame);
  const frameDescriptor = Object.getOwnPropertyDescriptor(child.win.Element.prototype, "attachShadow");
  let frameReads = 0;
  for (const key of ["contentWindow", "contentDocument"]) {
    Object.defineProperty(frame, key, { configurable: true, get() { frameReads++; throw Error("no cross-frame DOM access"); } });
  }
  assert.equal(parent.apply(parent.config({ mode: "dynamicFilter", customCss: ".panel{color:#abc}" })), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(child.win.Element.prototype, "attachShadow"), frameDescriptor,
    "parent install does not patch another context's prototype");
  assert.equal(child.apply(child.config({ mode: "dynamicFilter", customCss: ".panel{color:#def}" })), true);
  await settle();
  assert.match(parent.css(), /html:root\{filter:/);
  assert.doesNotMatch(child.css(), /filter:/);
  assert.equal(shadowCss(root).trim(), ".panel{color:#abc}");
  assert.equal(shadowCss(childRoot).trim(), ".panel{color:#def}");
  parent.apply({ enabled: false });
  assert.equal(root.querySelector(".darkreader"), null);
  assert.equal(childRoot.querySelectorAll(".darkreader--inline").length, 1, "disabling parent does not disable child context");
  child.apply({ enabled: false });
  assert.deepEqual(Object.getOwnPropertyDescriptor(child.win.Element.prototype, "attachShadow"), frameDescriptor);
  assert.equal(frameReads, 0);
  delete frame.contentWindow;
  delete frame.contentDocument;
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

test("native appearance installs as soon as the parser creates a root, before DOM readiness", async t => {
  for (const main of [true, false]) {
    const f = fixture(t, { real: true, main });
    await new Promise(resolve => f.win.addEventListener("load", resolve, { once: true }));
    // Suppress JSDOM's initial synthetic ready events before modeling a new
    // document whose parser has not reached readiness yet.
    Object.defineProperty(f.doc, "readyState", { value: "loading", configurable: true });
    const root = f.doc.documentElement;
    root.remove();
    assert.equal(f.controller.apply(f.config(), "100", main), true);
    assert.equal(f.controller.apply(f.config({ backgroundColor: "#102030" }), "101", main), true);
    assert.equal(f.statuses.length, 0);
    const head = root.querySelector("head");
    head.remove();
    f.doc.append(root);
    // The parser can paint before readystatechange/DOMContentLoaded. A single
    // mutation checkpoint must already have installed the actual vendor floor.
    await Promise.resolve();
    assert.deepEqual(f.statuses, [{ revision: "101", status: "applied" }]);
    assert.ok(f.doc.querySelector(".darkreader--fallback"));
    root.prepend(head);
    await Promise.resolve();
    assert.ok(f.doc.querySelector(".darkreader--user-agent"));
  }
});

test("native appearance retains its palette across cached back/forward restoration", async t => {
  const f = fixture(t, { real: true });
  assert.equal(f.apply(f.config({ backgroundColor: "#102030" })), true);
  const styles = f.doc.querySelector(".darkreader--user-agent");
  assert.ok(styles);
  for (let visit = 0; visit < 2; visit++) {
    f.win.dispatchEvent(new f.win.PageTransitionEvent("pagehide", { persisted: true }));
    assert.equal(styles.isConnected, true, "a cached document must retain its dark paint");
    f.win.dispatchEvent(new f.win.PageTransitionEvent("pageshow", { persisted: true }));
    assert.equal(f.apply(f.config({ backgroundColor: "#102030" })), true);
    assert.equal(f.doc.querySelector(".darkreader--user-agent"), styles);
  }
  assert.equal(f.apply({ enabled: false }), true);
  assert.equal(styles.isConnected, false, "explicit off still removes owned styling");
  f.win.dispatchEvent(new f.win.PageTransitionEvent("pagehide", { persisted: false }));
  assert.equal(f.apply(f.config()), false);
});

test("native appearance root observation is shallow and released on install, off, and disposal", async t => {
  for (const finish of ["install", "off", "dispose"]) {
    const f = fixture(t);
    await new Promise(resolve => f.win.addEventListener("load", resolve, { once: true }));
    const root = f.doc.documentElement;
    const subscriptions = [];
    let disconnected = 0;
    const Observer = f.win.MutationObserver;
    f.win.MutationObserver = class extends Observer {
      observe(target, options) { subscriptions.push({ target, options }); super.observe(target, options); }
      disconnect() { disconnected++; super.disconnect(); }
    };
    root.remove();
    f.apply(f.config());
    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].target, f.doc);
    assert.deepEqual(Object.keys(subscriptions[0].options), ["childList"]);
    assert.equal(subscriptions[0].options.childList, true);
    if (finish === "off") f.apply({ enabled: false });
    if (finish === "dispose") f.controller.dispose();
    f.doc.append(root);
    await Promise.resolve();
    assert.equal(disconnected, 1);
    assert.equal(f.calls.filter(call => call.kind === "enable").length, finish === "install" ? 1 : 0);
    root.append(f.doc.createElement("div"));
    await Promise.resolve();
    assert.equal(subscriptions.length, 1, "no continuing content watcher");
  }
});

test("native appearance cached pagehide aborts resources without revoking the controller", async t => {
  let signal;
  const f = fixture(t, { fetch: (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("aborted"))));
  } });
  f.apply(f.config());
  const pending = f.win.__engineFetch("/app.css");
  f.win.dispatchEvent(new f.win.PageTransitionEvent("pagehide", { persisted: true }));
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, /Native appearance resource unavailable/);
  assert.equal(f.apply(f.config()), true);
  assert.equal(f.calls.filter(call => call.kind === "enable").length, 1);
  f.win.dispatchEvent(new f.win.PageTransitionEvent("pagehide", { persisted: false }));
  assert.equal(f.apply(f.config()), false);
});
