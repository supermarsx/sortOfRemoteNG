import { loadAutologinClient } from "../helpers/autologinAsset";
// @ts-expect-error - jsdom has no bundled declarations
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const base = resolve("src-tauri/crates/sorng-browser-host/src");
const manifest = readFileSync(
  resolve(base, "native_login_profiles.rs"),
  "utf8",
);
const modules = [
  ...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g),
]
  .map(([, path]) => readFileSync(resolve(base, path), "utf8"))
  .join("");
const source = readFileSync(resolve(base, "native_login_client.js"), "utf8")
  .replace("/* REVIEWED_FORM_MODULES */", () => modules)
  .replace("/* NATIVE_KEYBOARD_CLIENT */", () =>
    readFileSync(resolve(base, "native_login_typing.js"), "utf8"),
  );
const pages: any[] = [];
afterEach(async () => {
  for (const dom of pages.splice(0)) {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    await vi.advanceTimersByTimeAsync(1);
    dom.window.close();
  }
  vi.useRealTimers();
});
function page(incompatible = false) {
  vi.useFakeTimers();
  const dom = new JSDOM(
    '<title>Just a moment...</title><div id="challenge-running">Performing security verification ' +
      (incompatible
        ? "Incompatible browser extension or network configuration"
        : "") +
      "</div>",
    { url: "https://site.test/login", runScripts: "outside-only" },
  );
  pages.push(dom);
  const win = dom.window;
  win.TextEncoder = TextEncoder;
  win.Date.now = () => Date.now();
  Object.defineProperty(win.document, "readyState", {
    value: "complete",
    configurable: true,
  });
  Object.defineProperty(win.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentElement;
    },
  });
  win.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 80, height: 24 }] : [];
  };
  const signals: string[] = [];
  const deliver = win.eval(source)(
    (signal: string) => signals.push(signal),
    {
      selectors: {
        username: "#user",
        password: "#password",
        submit: "#submit",
      },
      readiness: { detectionTimeoutMs: 8000 },
    },
    "modular-form",
    true,
  );
  return { win, signals, deliver };
}
describe("native Cloudflare interstitial hold", () => {
  it("waits beyond normal form detection without credentials, then resumes on the real form", async () => {
    const state = page();
    await vi.advanceTimersByTimeAsync(12000);
    expect(state.signals).toEqual(["challenge-waiting"]);
    expect(
      state.deliver(
        "https://site.test",
        "sentinel-user",
        "sentinel-password",
        true,
        Date.now() + 30000,
        {},
        "form",
      ),
    ).toBe(false);
    state.win.document.title = "Login";
    state.win.document.body.innerHTML =
      '<form><input id="user"><input id="password" type="password"><button id="submit" type="submit">Log in</button></form>';
    await vi.advanceTimersByTimeAsync(500);
    expect(state.signals).toContain("form-prepare");
    expect(state.signals).not.toContain("form-rejected");
  });
  it("resumes when the challenge container is retained but hidden", async () => {
    const state = page();
    state.win.document.querySelector("#challenge-running").hidden = true;
    state.win.document.body.insertAdjacentHTML(
      "beforeend",
      '<form><input id="user"><input id="password" type="password"><button id="submit" type="submit">Log in</button></form>',
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(state.signals).toContain("form-prepare");
  });
  it("holds a challenge that arrives after document creation before load end", async () => {
    const state = page();
    state.win.dispatchEvent(new state.win.Event("pagehide"));
    state.win.document.body.innerHTML = "";
    state.win.document.title = "";
    Object.defineProperty(state.win.document, "readyState", {
      value: "loading",
      configurable: true,
    });
    const signals: string[] = [];
    state.win.eval(source)(
      (signal: string) => signals.push(signal),
      {
        selectors: {
          username: "#user",
          password: "#password",
          submit: "#submit",
        },
      },
      "modular-form",
      true,
    );
    expect(signals).toEqual([]);
    state.win.document.title = "Just a moment...";
    state.win.document.body.innerHTML =
      '<div id="challenge-running">Performing security verification</div>';
    Object.defineProperty(state.win.document, "readyState", {
      value: "complete",
      configurable: true,
    });
    state.win.dispatchEvent(new state.win.Event("load"));
    await vi.advanceTimersByTimeAsync(12000);
    expect(signals).toEqual(["challenge-waiting"]);
  });
  it("a challenge that stays is bounded and produces a clear stopped status", async () => {
    const state = page();
    await vi.advanceTimersByTimeAsync(120100);
    expect(state.signals).toEqual(["challenge-waiting", "challenge-timeout"]);
  });
  it("requests one delayed native reload for incompatible network configuration", async () => {
    const state = page(true);
    await vi.advanceTimersByTimeAsync(4900);
    expect(state.signals).toEqual(["challenge-waiting"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(state.signals).toEqual(["challenge-waiting", "challenge-reloading"]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(
      state.signals.filter((signal) => signal === "challenge-reloading"),
    ).toHaveLength(1);
  });
  it("recognizes the reported verification/network failure variant without standard marker ids", async () => {
    const state = page();
    state.win.dispatchEvent(new state.win.Event("pagehide"));
    state.win.document.title = "Security verification";
    state.win.document.body.innerHTML =
      "<p>Performing security verification. Incompatible browser extension or network configuration. challenges.cloudflare.com. Ray ID: synthetic</p>";
    const signals: string[] = [];
    state.win.eval(source)(
      (signal: string) => signals.push(signal),
      {
        selectors: {
          username: "#user",
          password: "#password",
          submit: "#submit",
        },
      },
      "modular-form",
      true,
    );
    await vi.advanceTimersByTimeAsync(4900);
    expect(signals).toEqual(["challenge-waiting"]);
  });
  it("document departure stops waiting without rejecting a login", async () => {
    const state = page();
    state.win.dispatchEvent(new state.win.Event("pagehide"));
    await vi.advanceTimersByTimeAsync(120100);
    expect(state.signals).toEqual(["challenge-waiting"]);
  });
});

describe("legacy selected-form Cloudflare hold", () => {
  it("does not redeem credentials or reject during a challenge, and restarts detection after it clears", async () => {
    vi.useFakeTimers();
    const dom = new JSDOM(
      '<title>Just a moment...</title><div id="challenge-running">Performing security verification</div>',
      { url: "https://legacy.test/login", runScripts: "outside-only" },
    );
    pages.push(dom);
    const win = dom.window;
    win.Date.now = () => Date.now();
    Object.defineProperty(win.document, "readyState", {
      value: "complete",
      configurable: true,
    });
    const signals: unknown[] = [];
    const raw = readFileSync(
      "src-tauri/crates/sorng-protocols/src/autologin/forms/readiness.js",
      "utf8",
    );
    const waiting = win.eval(
      '(function(report){ var stopped=false, cancelActive=null; function normalizeFormOptions(options){return options || {detectionTimeoutMs:8000};} function findLoginForm(){return document.querySelector("#password") ? {pw:document.querySelector("#password")} : null;} function targetFingerprint(){} function openFreepbxAdmin(){} function porkbunSelectors(){return false;} ' +
        raw +
        ";return waitForSelectedLoginForm;})",
    )((result: unknown) => signals.push(result));
    const result = waiting({});
    await vi.advanceTimersByTimeAsync(12000);
    expect(signals).toHaveLength(0);
    win.document.title = "Login";
    win.document.body.innerHTML = '<input id="password" type="password">';
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ ok: true });
    expect(signals).toHaveLength(0);
  });
  it("holds the legacy coordinator before dispatching any provider adapter", async () => {
    vi.useFakeTimers();
    const dom = new JSDOM(
      '<title>Just a moment...</title><div id="challenge-running">Performing security verification</div>',
      { url: "https://legacy.test/login", runScripts: "outside-only" },
    );
    pages.push(dom);
    const win = dom.window;
    win.Date.now = () => Date.now();
    win.eval(loadAutologinClient());
    const run = vi.fn(() => Promise.resolve());
    win.__sorng_google_login = { runWhenReady: run, cancel: vi.fn() };
    const pending = win.__sorng_autologin.fetchCredsAndRun(
      "synthetic-nonce",
      undefined,
      "google",
    );
    win.__sorng_autologin.fetchCredsAndRun(
      "synthetic-nonce",
      undefined,
      "google",
    );
    await vi.advanceTimersByTimeAsync(12000);
    expect(run).not.toHaveBeenCalled();
    win.document.title = "Login";
    win.document.body.innerHTML = "<p>Real sign-in</p>";
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(run).toHaveBeenCalledOnce();
  });
});
