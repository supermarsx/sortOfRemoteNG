// t95 W0 probe: how the app's website frame "jail" treats legacy device pages.
// Installed Edge headless over CDP mounts a synthetic legacy page inside an
// iframe carrying the production sandbox tokens, on a different origin, exactly
// as `navigateWebBrowserFrame` does. No app build, app binary, account, profile,
// package download, WDIO run or real device is used; every page is synthetic and
// every request stays on 127.0.0.1.
//
//   node scripts/test-legacy-web-compat-browser.mjs [--only=name,...] [--list]
//     [--hold-ms=40000] [--verbose] [--json=<file>]
//
// Exit codes: 0 all runs matched their recorded expectations, 1 a run failed or
// drifted from its expectation, 2 the harness could not run (no Edge, or the
// production sandbox tokens changed and this mirror is stale).
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// ── production shapes (pure; unit tested) ───────────────────────────────────

/** Where the product pins the tokens this probe must reproduce exactly. */
export const SANDBOX_SOURCE_PATH = "src/utils/protocol/webBrowserFrame.ts";

/** The proxy frame's tokens, in the product's own order. */
export const EXPECTED_PROXY_TOKENS = Object.freeze([
  "allow-same-origin",
  "allow-scripts",
  "allow-forms",
]);

/** Tokens the product must never grant a website frame (plan §2.1). */
export const FORBIDDEN_SANDBOX_TOKENS = Object.freeze([
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-top-navigation",
  "allow-top-navigation-by-user-activation",
  "allow-top-navigation-to-custom-protocols",
  "allow-downloads",
  "allow-presentation",
  "allow-pointer-lock",
  "allow-storage-access-by-user-activation",
]);

/** The proxy-internal path the blocking dialog bridge would POST to. */
export const DIALOG_ENDPOINT_PATH = "/__sortofremoteng_dialog_v1";

export class HarnessSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessSetupError";
  }
}

/**
 * Read the two sandbox constants out of the product source. A drifted product
 * must fail this probe loudly rather than leave it measuring a stale jail.
 */
export function parseSandboxTokens(source) {
  const text = String(source).replace(/\r\n/gu, "\n");
  const empty = /export const EMPTY_WEB_FRAME_SANDBOX =\s*"([^"]*)";/u.exec(
    text,
  );
  const proxy = /export const PROXY_WEB_FRAME_SANDBOX =\s*"([^"]*)";/u.exec(
    text,
  );
  if (!empty || !proxy)
    throw new HarnessSetupError(
      `Could not read the sandbox constants from ${SANDBOX_SOURCE_PATH}; update this mirror.`,
    );
  if (empty[1] !== "")
    throw new HarnessSetupError(
      `EMPTY_WEB_FRAME_SANDBOX is no longer the empty string (${JSON.stringify(empty[1])}); update this mirror.`,
    );
  const tokens = proxy[1].split(/\s+/u).filter(Boolean);
  const unexpected = tokens.filter(
    (token) => !EXPECTED_PROXY_TOKENS.includes(token),
  );
  const missing = EXPECTED_PROXY_TOKENS.filter(
    (token) => !tokens.includes(token),
  );
  if (unexpected.length || missing.length)
    throw new HarnessSetupError(
      `PROXY_WEB_FRAME_SANDBOX drifted (unexpected: ${unexpected.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}); update this mirror.`,
    );
  return { empty: empty[1], proxy: proxy[1], tokens };
}

/** The per-session proxy authority shape asserted by the product. */
export const PROXY_HOST_PATTERN = /^p[0-9a-f]{32}$/u;

export function proxyHost(hex) {
  if (!/^[0-9a-f]{32}$/u.test(hex))
    throw new HarnessSetupError("A proxy label needs 32 lowercase hex digits.");
  return `p${hex}.localhost`;
}

export function isProxyHost(host) {
  const [label, ...rest] = String(host).split(".");
  return rest.join(".") === "localhost" && PROXY_HOST_PATTERN.test(label);
}

/**
 * Host variants for the embedding app document. `dev` mirrors `npm run tauri
 * dev` (`http://localhost:<port>`); `prod` mirrors the packaged app, whose
 * origin is a sibling `*.localhost` label of the proxy authority. Both are
 * measured because same-site grouping would decide whether the sandboxed frame
 * gets its own renderer, which the blocking dialog bridge depends on.
 */
export const APP_HOSTS = Object.freeze({
  dev: "localhost",
  prod: "app.localhost",
});

/** Iframe sandbox modes. `null` means the attribute is absent entirely. */
export function sandboxForMode(mode, tokens) {
  switch (mode) {
    case "current":
    case "shim":
      return tokens;
    case "modals":
      return `${tokens} allow-modals`;
    case "nosandbox":
      return null;
    default:
      throw new HarnessSetupError(`Unknown sandbox mode ${mode}`);
  }
}

/**
 * The prototype of the injected compatibility client (plan §3.1/§3.2). Ordering
 * is load bearing: the real parent is captured first, every other install runs
 * next, and the `parent` override is the last statement so that earlier clients
 * (which capture `window.parent` at IIFE time) keep the app window.
 *
 * @param {{ dialogEndpoint?: string, holdMs?: number }} [options]
 * @returns {string}
 */
export function buildCompatShimSource({ dialogEndpoint, holdMs = 0 } = {}) {
  if (typeof dialogEndpoint !== "string" || !dialogEndpoint.startsWith("/"))
    throw new HarnessSetupError("The dialog bridge needs a same-origin path.");
  return `(function(){
var realParent = window.parent;
var nested = false;
try { realParent.location.href; nested = true; } catch (e) { nested = false; }
window.__sorngShim = { installed: true, nested: nested };
function sameOrigin(w){ try { void w.location.href; return true; } catch (e) { return false; } }
function rootRealm(){
  var w = window;
  try { while (w.parent !== w && sameOrigin(w.parent)) w = w.parent; } catch (e) {}
  return w;
}
function post(message){
  if (nested) {
    var root = rootRealm();
    if (root !== window && typeof root.__sorngDialogPost === "function") {
      root.__sorngDialogPost(message);
      return;
    }
  }
  (window.__sorngAppParent || window.parent).postMessage(message, "*");
}
if (!nested) {
  try {
    Object.defineProperty(window, "__sorngAppParent", {
      value: realParent, writable: false, configurable: false, enumerable: false,
    });
  } catch (e) { window.__sorngShim.appParentFailed = String(e && e.name); }
  try {
    Object.defineProperty(window, "__sorngDialogPost", {
      value: function (message) {
        (window.__sorngAppParent || realParent).postMessage(message, "*");
      },
      writable: false, configurable: false, enumerable: false,
    });
  } catch (e) { window.__sorngShim.dialogPostFailed = String(e && e.name); }
}
var bridgeUnavailable = false, bridgeSuppressed = false;
function fallback(kind){ return kind === "confirm" ? false : kind === "prompt" ? null : undefined; }
function hex(){
  var out = "";
  var bytes = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] + 256).toString(16).slice(1);
  return out;
}
function ask(kind, message, defaultValue){
  if (bridgeUnavailable || bridgeSuppressed) return fallback(kind);
  var dialogId = hex();
  var began = Date.now();
  try {
    post({
      type: "sorng_script_dialog", version: 1, dialogId: dialogId, kind: kind,
      message: String(message === undefined ? "" : message).slice(0, 2000),
      defaultValue: defaultValue === undefined ? undefined : String(defaultValue).slice(0, 1000),
      sentAt: began,
    });
  } catch (e) { bridgeUnavailable = true; return fallback(kind); }
  var answer;
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", ${JSON.stringify(dialogEndpoint)} + "?run=" + encodeURIComponent(window.__sorngRun), false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({
      run: window.__sorngRun, dialogId: dialogId, kind: kind, holdMs: ${Number(holdMs) || 0},
      message: String(message === undefined ? "" : message).slice(0, 2000),
      defaultValue: defaultValue === undefined ? undefined : String(defaultValue).slice(0, 1000),
    }));
    if (xhr.status !== 200) throw new Error("status " + xhr.status);
    answer = JSON.parse(xhr.responseText);
  } catch (e) {
    bridgeUnavailable = true;
    window.__sorngShim.bridgeError = String(e && e.message).slice(0, 200);
    return fallback(kind);
  }
  window.__sorngShim.lastDialogMs = Date.now() - began;
  if (answer.outcome === "suppressed") { bridgeSuppressed = true; return fallback(kind); }
  if (answer.outcome !== "accept") return fallback(kind);
  return kind === "confirm" ? true : kind === "prompt" ? String(answer.value == null ? "" : answer.value) : undefined;
}
window.alert = function (message) { ask("alert", message, undefined); };
window.confirm = function (message) { return ask("confirm", message, undefined); };
window.prompt = function (message, defaultValue) { return ask("prompt", message, defaultValue); };
if (!nested)
  Object.defineProperty(window, "parent", { value: window, writable: true, configurable: true });
})();`;
}

/**
 * The install order the compatibility client depends on. e1's vitest suite
 * asserts the same invariants against the real client.
 */
export function shimOrderingProblems(source) {
  const text = String(source);
  const problems = [];
  const capture = text.indexOf("var realParent = window.parent;");
  const override = text.indexOf('Object.defineProperty(window, "parent"');
  const appParent = text.indexOf('"__sorngAppParent"');
  const firstPost = text.indexOf("postMessage");
  if (capture < 0) problems.push("the real parent is never captured");
  if (override < 0) problems.push("the parent override is missing");
  if (appParent < 0) problems.push("the app parent reference is missing");
  if (
    capture >= 0 &&
    !/^\(function\s*\(\)\s*\{\s*var realParent = window\.parent;/u.test(text)
  )
    problems.push("the capture is not the IIFE's first statement");
  if (capture >= 0 && appParent >= 0 && capture > appParent)
    problems.push("the app parent reference precedes the capture");
  if (capture >= 0 && firstPost >= 0 && capture > firstPost)
    problems.push("a postMessage bridge installs before the capture");
  if (override >= 0 && appParent >= 0 && override < appParent)
    problems.push("the parent override precedes the app parent reference");
  if (override >= 0 && text.slice(override).split("\n").length > 3)
    problems.push("the parent override is not the IIFE's last statement");
  return problems;
}

// ── scenario catalogue (pure; unit tested) ──────────────────────────────────

/**
 * `expect` holds the behaviour measured on this machine (see
 * `.orchestration/scratch/t95/probe-results.md`). A mismatch is a real signal:
 * either the engine changed or the jail did. e3 re-points these at the
 * production compatibility client once W1 lands.
 */
export const SCENARIOS = Object.freeze([
  {
    name: "legacy-onload",
    summary:
      "a Yealink-shaped window.onload that reads parent.document before finishing its setup",
    modes: ["current", "shim"],
    hosts: ["dev"],
    reports: 1,
  },
  {
    name: "parent-top-access",
    summary: "every cross-origin parent/top read a legacy page performs",
    modes: ["current", "shim", "nosandbox"],
    hosts: ["dev"],
    reports: 1,
  },
  {
    name: "top-shadowing",
    summary: "whether window.top can be redefined, shadowed or assigned",
    modes: ["current", "shim"],
    hosts: ["dev"],
    reports: 1,
  },
  {
    name: "frame-bust",
    summary:
      "if (top != self) top.location = self.location, and top.location.replace",
    modes: ["current", "shim", "nosandbox"],
    hosts: ["dev"],
    reports: 1,
  },
  {
    name: "dialogs",
    summary: "engine alert/confirm/prompt/print with and without allow-modals",
    modes: ["current", "modals"],
    hosts: ["dev"],
    reports: 1,
  },
  {
    name: "renderer-placement",
    summary:
      "a busy loop and a held synchronous XHR inside the frame while the app page keeps ticking",
    modes: ["current"],
    hosts: ["dev", "prod"],
    reports: 1,
  },
  {
    name: "frameset",
    summary: "classic frameset: sibling, ancestor and target= navigation",
    modes: ["current", "nosandbox"],
    hosts: ["dev"],
    reports: 1,
    tolerateLostReport: true,
  },
  {
    name: "postmessage-shim",
    summary:
      "with the shim installed, the app still receives postMessage from the frame root",
    modes: ["shim"],
    hosts: ["dev"],
    reports: 2,
  },
  {
    name: "dialog-bridge",
    summary:
      "blocking sync-XHR dialog bridge: root and nested frames get real answers",
    modes: ["shim"],
    hosts: ["dev", "prod"],
    reports: 2,
  },
  {
    name: "dialog-hold",
    summary:
      "a long held dialog: the app page keeps painting, handling input and answering",
    modes: ["shim"],
    hosts: ["dev"],
    reports: 1,
  },
  {
    name: "dialog-unload",
    summary:
      "synchronous XHR attempted from pagehide, as an unload dialog would",
    modes: ["shim"],
    hosts: ["dev"],
    reports: 1,
  },
]);

export function expandRuns(scenarios = SCENARIOS) {
  const runs = [];
  for (const scenario of scenarios)
    for (const mode of scenario.modes)
      for (const host of scenario.hosts)
        runs.push({
          id: `${scenario.name}/${mode}/${host}`,
          scenario,
          mode,
          host,
        });
  return runs;
}

export function selectRuns(only, scenarios = SCENARIOS) {
  const runs = expandRuns(scenarios);
  if (!only) return runs;
  const wanted = String(only)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = wanted.filter(
    (item) =>
      !runs.some((run) => run.id === item || run.scenario.name === item),
  );
  if (unknown.length)
    throw new HarnessSetupError(`Unknown scenario(s): ${unknown.join(", ")}`);
  return runs.filter((run) =>
    wanted.some((item) => run.id === item || run.scenario.name === item),
  );
}

/**
 * What this machine measured on 2026-09-16 (Edge 146 / Chromium, headless).
 * A value is either the expected outcome, or `[outcome, detail substring]`.
 * Anything a run reports that is not listed here is informational: the probe
 * fails only when a pinned behaviour changes, so W1 inherits a regression test
 * rather than a one-off measurement. e3 re-points these at the production
 * compatibility client. Full context: .orchestration/scratch/t95/probe-results.md
 */
export const EXPECTATIONS = Object.freeze({
  "legacy-onload/current": {
    "onload started": "ok",
    "onload finished": "aborted",
    "uncaught error name": ["ok", "SecurityError"],
    "app window never navigated": "ok",
  },
  "legacy-onload/shim": {
    "onload started": "ok",
    "onload finished": "ok",
    "uncaught error name": "none",
    "app window never navigated": "ok",
  },
  "parent-top-access/current": {
    "parent.document": ["throw", "SecurityError"],
    "window.parent.document": "throw",
    "self.parent.document": "throw",
    "parent global (SORNG_APP_MARKER)": "throw",
    "top.document": ["throw", "SecurityError"],
    "top.location.href": "throw",
    "parent === window": ["ok", "false"],
    "top === window": ["ok", "false"],
    "top != self (framing check)": ["ok", "true"],
    "top.length (cross-origin allowed)": "ok",
    frameElement: ["ok", "null"],
    "inline handler parent.SORNG_INLINE()": ["ok", "SecurityError"],
    "out-of-process frame target": ["ok", "iframe"],
    "app window never navigated": "ok",
  },
  "parent-top-access/shim": {
    "parent.document": ["ok", "true"],
    "window.parent.document": ["ok", "true"],
    "self.parent.document": ["ok", "true"],
    "parent global (SORNG_APP_MARKER)": ["ok", "undefined"],
    "top.document": ["throw", "SecurityError"],
    "top.location.href": "throw",
    "parent === window": ["ok", "true"],
    "top === window": ["ok", "false"],
    "inline handler parent.SORNG_INLINE()": ["ok", "inline-ran"],
    "app window never navigated": "ok",
  },
  "parent-top-access/nosandbox": {
    "parent.document": "throw",
    "top.document": "throw",
    "out-of-process frame target": ["ok", "iframe"],
  },
  "top-shadowing/current": {
    "defineProperty(window,top)": ["throw", "TypeError"],
    "window.top = window": ["ok", "silently ignored"],
    "descriptor of top": ["ok", "configurable=false"],
    "delete window.top": ["ok", "false"],
    "global let top": "throw",
    "global var top": ["ok", "window.top === window ? false"],
  },
  "top-shadowing/shim": {
    "defineProperty(window,top)": ["throw", "TypeError"],
    "global let top": "throw",
    "global var top": ["ok", "window.top === window ? false"],
  },
  "frame-bust/current": {
    "top.location = self.location": ["throw", "SecurityError"],
    "top.location.href = app origin": ["throw", "SecurityError"],
    "top.location.replace(app origin)": ["throw", "SecurityError"],
    "parent.location = own origin": ["throw", "SecurityError"],
    "window.open(app origin, _top)": ["ok", "null"],
    "app window never navigated": "ok",
    "navigations that reached the server": "blocked",
  },
  "frame-bust/shim": {
    "top.location = self.location": "throw",
    "top.location.href = app origin": "throw",
    "top.location.replace(app origin)": "throw",
    // The shim turns an ancestor navigation into a self navigation.
    "parent.location = own origin": "ok",
    "app window never navigated": "ok",
    "navigations that reached the server": ["escaped", "parent@own origin"],
  },
  "frame-bust/nosandbox": {
    // Measure-only: proof that the sandbox, not the origin, is what holds.
    "top.location.href = app origin": "ok",
    "top.location.replace(app origin)": "ok",
    "app window never navigated": "failed",
    "navigations that reached the server": ["escaped", "app window"],
  },
  "dialogs/current": {
    "alert()": ["ok", "undefined"],
    "confirm()": ["ok", "false"],
    "prompt()": ["ok", "null"],
    "print()": "ok",
    "engine dialogs opened": "none",
  },
  "dialogs/modals": {
    "confirm()": ["ok", "true"],
    "prompt()": ["ok", "typed-into-engine-dialog"],
    "engine dialogs opened": ["ok", "alert:"],
  },
  "renderer-placement/current": {
    "synchronous XHR status": ["ok", "200"],
    "out-of-process frame target": ["ok", "iframe"],
    "app tick gap during frame busy loop": "isolated",
    "app tick gap during sync XHR": "isolated",
  },
  "frameset/current": {
    "menu: sibling frames.main reachable": ["ok", "true"],
    "menu: sibling parent.frames.main.location =": ["throw", "SecurityError"],
    "menu: window.open(name=main)": ["ok", "null"],
    "menu: ancestor parent.location = (frameset root)": "throw",
    "menu: ancestor top.location = (app window)": "throw",
    "frames the menu actually navigated": "blocked",
    "navigations that reached the server": "blocked",
    "app window never navigated": "ok",
  },
  "frameset/nosandbox": {
    "menu: sibling parent.frames.main.location =": "ok",
    "frames the menu actually navigated": "navigated",
    "navigations that reached the server": "escaped",
    "app window never navigated": "failed",
  },
  "postmessage-shim/shim": {
    "shim installed": "ok",
    "root treated as root": "ok",
    "parent === window after shim": ["ok", "true"],
    "__sorngAppParent is the app window": ["ok", "true"],
    "__sorngAppParent redefinition": ["throw", "TypeError"],
    "parent.document after shim": ["ok", "true"],
    "nested: nested frame is nested": "ok",
    "nested: nested parent untouched": ["ok", "true"],
    "nested: nested __sorngAppParent absent": ["ok", "true"],
    "nested: nested parent.parent is the frame root": ["ok", "true"],
    "nested: nested top.document": "throw",
    "postMessage source is the frame root": "ok",
  },
  "dialog-bridge/shim": {
    "confirm returns host answer": ["ok", "value=true"],
    "prompt returns host text": ["ok", "typed-by-host"],
    "alert returns undefined": "ok",
    "nested: nested confirm returns host answer": ["ok", "value=true"],
    "nested: nested frame is nested": "ok",
    "app learned of the dialog while the frame was blocked": "ok",
    "postMessage source is the frame root": "ok",
    "app window never navigated": "ok",
  },
  "dialog-hold/shim": {
    "held confirm returns host answer": ["ok", "value=true"],
    "app page stayed live during the hold": "ok",
    "app learned of the dialog while the frame was blocked": "ok",
    // The page's own postMessage only lands when the block ends, so the app
    // must be told by the proxy instead. This is the plan's one design change.
    "postMessage from the blocked frame arrived": "deferred",
  },
  "dialog-unload/shim": {
    "synchronous XHR from pagehide": ["blocked", "NetworkError"],
  },
});

/**
 * Compare the measured rows with `EXPECTATIONS`. A pinned check that the run
 * never produced counts as a mismatch, so a silently dropped probe cannot pass.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {Record<string, Record<string, string | string[]>>} [table]
 * @returns {string[]}
 */
export function expectationMismatches(rows, table = EXPECTATIONS) {
  const problems = [];
  for (const row of rows) {
    if (row.check === "run completed" && row.outcome === "failed") {
      problems.push(`${row.scenario}/${row.mode}/${row.host}: ${row.detail}`);
      continue;
    }
    const wanted = table[`${row.scenario}/${row.mode}`]?.[row.check];
    if (wanted === undefined) continue;
    const [outcome, detail] = Array.isArray(wanted) ? wanted : [wanted, null];
    if (
      row.outcome !== outcome ||
      (detail && !String(row.detail ?? "").includes(detail))
    )
      problems.push(
        `${row.scenario}/${row.mode}/${row.host} ${row.check}: expected ${outcome}${detail ? ` containing ${JSON.stringify(detail)}` : ""}, measured ${row.outcome} (${row.detail})`,
      );
  }
  for (const [key, checks] of Object.entries(table)) {
    if (!rows.some((row) => `${row.scenario}/${row.mode}` === key)) continue;
    for (const check of Object.keys(checks))
      if (
        !rows.some(
          (row) => `${row.scenario}/${row.mode}` === key && row.check === check,
        )
      )
        problems.push(`${key} ${check}: never measured`);
  }
  return problems;
}

// ── reporting (pure; unit tested) ───────────────────────────────────────────

export function renderMatrix(rows, { width = 64 } = {}) {
  const header = ["scenario", "mode", "host", "check", "outcome", "detail"];
  const table = [
    header,
    ...rows.map((row) => [
      row.scenario,
      row.mode,
      row.host,
      row.check,
      row.outcome,
      String(row.detail ?? "")
        .replace(/\s+/gu, " ")
        .slice(0, width),
    ]),
  ];
  const widths = header.map((_, column) =>
    Math.max(...table.map((line) => String(line[column]).length)),
  );
  return table
    .map((line, index) => {
      const text = line
        .map((cell, column) =>
          column === line.length - 1
            ? String(cell)
            : String(cell).padEnd(widths[column]),
        )
        .join("  ")
        .trimEnd();
      return index === 0
        ? `${text}\n${widths.map((size) => "-".repeat(size)).join("  ")}`
        : text;
    })
    .join("\n");
}

/**
 * Turn the measured rows into the go/no-go statements W1 needs. Nothing here is
 * inferred: every verdict names the rows it was derived from.
 */
export function deriveVerdicts(rows) {
  const find = (scenario, mode, check) =>
    rows.find(
      (row) =>
        row.scenario === scenario && row.mode === mode && row.check === check,
    );
  const truthy = (row) => Boolean(row) && row.outcome === "ok";
  const parentBefore = find("parent-top-access", "current", "parent.document");
  const parentAfter = find("parent-top-access", "shim", "parent.document");
  const topAfter = find("parent-top-access", "shim", "top.document");
  const define = find("top-shadowing", "current", "defineProperty(window,top)");
  const lexical = find("top-shadowing", "current", "global let top");
  const placements = rows.filter(
    (row) =>
      row.scenario === "renderer-placement" &&
      row.check === "app tick gap during sync XHR",
  );
  const bridges = rows.filter(
    (row) =>
      row.scenario === "dialog-bridge" &&
      row.check === "confirm returns host answer",
  );
  const hold = find(
    "dialog-hold",
    "shim",
    "app page stayed live during the hold",
  );
  const notified = rows.filter(
    (row) =>
      row.check === "app learned of the dialog while the frame was blocked",
  );
  // Only the long hold separates "deferred until the block ends" from "fast":
  // a bridge round trip of 20 ms looks prompt either way.
  const deferred = rows.filter(
    (row) =>
      row.scenario === "dialog-hold" &&
      row.check === "postMessage from the blocked frame arrived",
  );
  return {
    parentShim:
      parentBefore?.outcome === "throw" && truthy(parentAfter)
        ? "works"
        : parentBefore?.outcome === "throw"
          ? "does not fix the parent read"
          : "inconclusive (the baseline did not throw)",
    topRuntime:
      !define || !lexical
        ? "not measured"
        : define.outcome === "throw" && lexical.outcome === "throw"
          ? "no runtime shim is possible; a source rewrite or top-level hosting is the only route"
          : "unexpected: top was shadowable, re-measure before relying on it",
    topAfterShim: topAfter ? topAfter.outcome : "not measured",
    syncXhrBridge: !bridges.length
      ? "not measured"
      : bridges.every((row) => row.outcome === "ok")
        ? placements.every((row) => Number(row.value) < 500)
          ? "viable: the frame blocks alone and the app page keeps running"
          : "viable only where the frame is out of process; one host variant stalled the app page"
        : "not viable as measured",
    dialogNotification: !notified.length
      ? "not measured"
      : notified.every((row) => row.outcome === "ok") &&
          deferred.every((row) => row.outcome === "deferred")
        ? "the app must be told by the proxy: the page's own postMessage only lands after the block ends"
        : deferred.some((row) => row.outcome === "prompt")
          ? "postMessage arrived promptly on at least one run; re-measure before relying on either channel"
          : "the proxy-side notification did not reach the app",
    holdSafety: hold ? hold.detail : "not measured",
    hostVariants: Object.fromEntries(
      placements.map((row) => [row.host, `${row.value} ms app tick gap`]),
    ),
  };
}

// ── harness (browser, server, CDP) ──────────────────────────────────────────

// Resolved lazily: a test runner may import this module under a non-file URL.
function repoRoot() {
  try {
    return fileURLToPath(new URL("..", import.meta.url));
  } catch {
    return process.cwd();
  }
}
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const START_TIMEOUT_MS = 20000;
const RUN_TIMEOUT_MS = 90000;
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");

class DevTools {
  #socket;
  #next = 0;
  #pending = new Map();
  #listeners = new Set();
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
    if (message.id === undefined) {
      for (const listener of this.#listeners)
        listener(message.method, message.params, message.sessionId);
      return;
    }
    const call = this.#pending.get(message.id);
    if (!call) return;
    this.#pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error)
      call.reject(new Error(`${call.method}: ${message.error.message}`));
    else call.resolve(message.result);
  }
  send(method, params = {}, sessionId = undefined, timeoutMs = 15000) {
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
  on(listener) {
    this.#listeners.add(listener);
  }
  close() {
    this.#socket.close();
  }
}

/** The legacy page bodies. Every one is synthetic; no vendor code is copied. */
function pageScript(run) {
  const { scenario, proxyOrigin, appOrigin } = run;
  switch (scenario.name) {
    case "legacy-onload":
      return `
// Shaped like commonjs.js: onload reads the embedder, then finishes page setup.
window.onload = function () {
  EXTRA.onloadStarted = true;
  var doc = parent.document;
  EXTRA.parentDocumentReadable = !!doc;
  EXTRA.onloadFinished = true;
};
setTimeout(function () {
  note("onload started", EXTRA.onloadStarted ? "ok" : "missing", "");
  note("onload finished", EXTRA.onloadFinished ? "ok" : "aborted",
    EXTRA.onloadFinished ? "page setup after the parent read ran" : "the parent read aborted the rest of onload");
  note("uncaught error name", ERRORS.length ? "ok" : "none", ERRORS.map(function (e) { return e.name + ": " + e.message; }).join(" | "));
  report();
}, 600);`;
    case "parent-top-access":
      return `
probe("parent.document", function () { return !!parent.document; });
probe("window.parent.document", function () { return !!window.parent.document; });
probe("self.parent.document", function () { return !!self.parent.document; });
probe("parent global (SORNG_APP_MARKER)", function () { return parent.SORNG_APP_MARKER; });
probe("top.document", function () { return !!top.document; });
probe("top.location.href", function () { return top.location.href; });
probe("parent === window", function () { return parent === window; });
probe("top === window", function () { return top === window; });
probe("top != self (framing check)", function () { return top != self; });
probe("top.length (cross-origin allowed)", function () { return top.length; });
probe("typeof top.postMessage", function () { return typeof top.postMessage; });
probe("frameElement", function () { return String(frameElement); });
var button = document.getElementById("inline");
window.SORNG_INLINE = function () { return "inline-ran"; };
probe("inline handler parent.SORNG_INLINE()", function () { button.click(); return EXTRA.inline || "no result"; });
report();`;
    case "top-shadowing":
      return `
probe("defineProperty(window,top)", function () {
  Object.defineProperty(window, "top", { value: window, writable: true, configurable: true });
  return "redefined";
});
probe("window.top = window", function () { window.top = window; return top === window ? "shadowed" : "silently ignored"; });
probe("descriptor of top", function () {
  var d = Object.getOwnPropertyDescriptor(window, "top");
  return "configurable=" + d.configurable + " get=" + (typeof d.get) + " set=" + (typeof d.set);
});
probe("delete window.top", function () { return delete window.top; });
note("global let top", window.__letTopRan ? "ok" : "throw", window.__letTopError || "SyntaxError before evaluation (the whole script is dropped)");
note("global var top", window.__varTopRan ? "ok" : "throw", "window.top === window ? " + (top === window));
probe("with({top:window}) shadowing", function () {
  var seen;
  with ({ top: window }) { seen = top === window; }
  return seen ? "works inside the with block only" : "no";
});
report();`;
    case "frame-bust":
      // Each attempt aims at its own /busted URL so the server's request log
      // says which one escaped. parent.* aims at the page's own origin: once the
      // shim is installed that is a self-navigation, not an escape.
      return `
var APP = ${scriptJson(appOrigin + "/busted?run=" + encodeURIComponent(run.runId))};
var SELF = ${scriptJson(proxyOrigin + "/busted?run=" + encodeURIComponent(run.runId))};
probe("top != self", function () { return top != self; });
probe("top.location = self.location", function () { top.location = self.location; return "returned without throwing"; });
probe("top.location.href = app origin", function () { top.location.href = APP + "&from=top-href"; return "returned without throwing"; });
probe("top.location.replace(app origin)", function () { top.location.replace(APP + "&from=top-replace"); return "returned without throwing"; });
probe("parent.location = own origin", function () { parent.location = SELF + "&from=parent"; return "returned without throwing"; });
probe("window.open(app origin, _top)", function () { return String(window.open(APP + "&from=open", "_top")); });
report();`;
    case "dialogs":
      return `
var t = probe("alert()", function () { return typeof alert("sortOfRemoteNG alert probe"); });
note("alert() blocked for", "ok", t + " ms");
t = probe("confirm()", function () { return confirm("sortOfRemoteNG confirm probe"); });
note("confirm() blocked for", "ok", t + " ms");
t = probe("prompt()", function () { return prompt("sortOfRemoteNG prompt probe", "default value"); });
note("prompt() blocked for", "ok", t + " ms");
probe("print()", function () { print(); return "returned"; });
probe("onbeforeunload registered", function () { window.onbeforeunload = function (e) { e.returnValue = "stay?"; return "stay?"; }; return "registered"; });
report();`;
    case "renderer-placement":
      return `
EXTRA.busyStart = Date.now();
var spin = Date.now() + 1500;
while (Date.now() < spin) { /* occupy this frame's main thread */ }
EXTRA.busyEnd = Date.now();
setTimeout(function () {
  EXTRA.xhrStart = Date.now();
  var status = 0;
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", ${scriptJson(DIALOG_ENDPOINT_PATH)} + "?run=" + encodeURIComponent(window.__sorngRun), false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ run: window.__sorngRun, dialogId: "placement", kind: "confirm", holdMs: 1500 }));
    status = xhr.status;
  } catch (e) { note("synchronous XHR", "throw", (e && e.name) + ": " + (e && e.message)); }
  EXTRA.xhrEnd = Date.now();
  note("synchronous XHR status", status === 200 ? "ok" : "failed", String(status));
  note("frame busy loop ms", "ok", String(EXTRA.busyEnd - EXTRA.busyStart));
  note("frame sync XHR ms", "ok", String(EXTRA.xhrEnd - EXTRA.xhrStart));
  report();
}, 300);`;
    case "postmessage-shim":
      return `
note("shim installed", window.__sorngShim && window.__sorngShim.installed ? "ok" : "missing", JSON.stringify(window.__sorngShim || {}));
note("root treated as root", window.__sorngShim && window.__sorngShim.nested === false ? "ok" : "wrong", "nested=" + (window.__sorngShim && window.__sorngShim.nested));
probe("parent === window after shim", function () { return parent === window; });
probe("__sorngAppParent is the app window", function () { return window.__sorngAppParent !== window; });
probe("__sorngAppParent redefinition", function () {
  Object.defineProperty(window, "__sorngAppParent", { value: window });
  return "redefined";
});
probe("parent.document after shim", function () { return !!parent.document; });
window.__sorngAppParent.postMessage({ type: "sorng_probe_root", run: window.__sorngRun }, "*");
var nested = document.createElement("iframe");
nested.src = "/nested?run=" + encodeURIComponent(window.__sorngRun);
document.body.appendChild(nested);
setTimeout(report, 1200);`;
    case "dialog-bridge":
      return `
var began = Date.now();
var confirmed = confirm("Apply the new configuration and reboot?");
note("confirm returns host answer", confirmed === true ? "ok" : "failed", "value=" + confirmed + " after " + (Date.now() - began) + " ms");
began = Date.now();
var typed = prompt("Administrator name", "admin");
note("prompt returns host text", typed === "typed-by-host" ? "ok" : "failed", "value=" + JSON.stringify(typed) + " after " + (Date.now() - began) + " ms");
began = Date.now();
var alerted = alert("Settings saved.");
note("alert returns undefined", alerted === undefined ? "ok" : "failed", "blocked for " + (Date.now() - began) + " ms");
var nested = document.createElement("iframe");
nested.src = "/nested?run=" + encodeURIComponent(window.__sorngRun) + "&dialog=1";
document.body.appendChild(nested);
setTimeout(report, 2500);`;
    case "dialog-hold":
      return `
var began = Date.now();
var confirmed = confirm("Long held dialog");
EXTRA.heldMs = Date.now() - began;
note("held confirm returns host answer", confirmed === true ? "ok" : "failed", "value=" + confirmed);
note("frame blocked for", "ok", EXTRA.heldMs + " ms");
report();`;
    case "dialog-unload":
      return `
window.addEventListener("pagehide", function () {
  var outcome;
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", ${scriptJson(DIALOG_ENDPOINT_PATH)} + "?run=" + encodeURIComponent(window.__sorngRun), false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ run: window.__sorngRun, dialogId: "unload", kind: "confirm", holdMs: 0, unload: true }));
    outcome = "status " + xhr.status;
  } catch (e) { outcome = (e && e.name) + ": " + String(e && e.message).slice(0, 160); }
  try { sessionStorage.setItem("sorng-unload-xhr", outcome); } catch (e) {}
});
setTimeout(function () { location.href = "/page2?run=" + encodeURIComponent(window.__sorngRun); }, 300);`;
    default:
      throw new HarnessSetupError(`No page body for ${scenario.name}`);
  }
}

function innerRuntime(run, role) {
  return `
window.__sorngRun = ${scriptJson(run.runId)};
var F = [], EXTRA = {}, ERRORS = [], reported = false;
window.addEventListener("error", function (event) {
  ERRORS.push({
    name: (event.error && event.error.name) || "Error",
    message: String(event.message || "").slice(0, 300),
  });
}, true);
function note(name, outcome, detail) {
  F.push({ name: name, outcome: outcome, detail: detail === undefined ? "" : String(detail).slice(0, 300) });
}
function probe(name, fn) {
  var began = Date.now();
  try {
    var value = fn();
    note(name, "ok", typeof value === "string" ? JSON.stringify(value) : String(value));
  } catch (error) {
    note(name, "throw", ((error && error.name) || "Error") + ": " + String(error && error.message).slice(0, 220));
  }
  return Date.now() - began;
}
function report() {
  if (reported) return;
  reported = true;
  fetch("/report?run=" + encodeURIComponent(window.__sorngRun), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ role: ${scriptJson(role)}, findings: F, extra: EXTRA, errors: ERRORS }),
  });
}`;
}

function innerDocument(run, role, body) {
  const shim =
    run.mode === "shim"
      ? buildCompatShimSource({
          dialogEndpoint: DIALOG_ENDPOINT_PATH,
          holdMs: run.scenario.name === "dialog-hold" ? run.holdMs : 0,
        })
      : "";
  const lexical =
    run.scenario.name === "top-shadowing"
      ? `<script>window.__letTopError="";</script><script>let top = 1; window.__letTopRan = true;</script><script>var top = window; window.__varTopRan = true;</script>`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>legacy device fixture</title>
<script>${innerRuntime(run, role)}</script>
${shim ? `<script>${shim}</script>` : ""}
</head><body>
<h1>Synthetic legacy device page</h1>
<button id="inline" onclick="EXTRA.inline = (function(){ try { return parent.SORNG_INLINE ? parent.SORNG_INLINE() : 'no function on parent'; } catch (e) { return e.name; } })()">inline</button>
${lexical}
<script>${body}</script>
</body></html>`;
}

function nestedDocument(run, dialog) {
  const shim =
    run.mode === "shim"
      ? buildCompatShimSource({ dialogEndpoint: DIALOG_ENDPOINT_PATH })
      : "";
  const body = dialog
    ? `
var began = Date.now();
var confirmed = confirm("Nested frame confirm");
note("nested confirm returns host answer", confirmed === true ? "ok" : "failed", "value=" + confirmed + " after " + (Date.now() - began) + " ms");
note("nested frame is nested", window.__sorngShim && window.__sorngShim.nested === true ? "ok" : "wrong", "nested=" + (window.__sorngShim && window.__sorngShim.nested));
report();`
    : `
note("nested frame is nested", window.__sorngShim && window.__sorngShim.nested === true ? "ok" : "wrong", "nested=" + (window.__sorngShim && window.__sorngShim.nested));
probe("nested parent untouched", function () { return parent !== window && !!parent.location.href; });
probe("nested __sorngAppParent absent", function () { return window.__sorngAppParent === undefined; });
probe("nested parent.parent is the frame root", function () { return parent.parent === parent; });
probe("nested top.document", function () { return !!top.document; });
parent.__sorngDialogPost({ type: "sorng_probe_nested", run: window.__sorngRun });
setTimeout(report, 400);`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>nested</title>
<script>${innerRuntime(run, "nested")}</script>
${shim ? `<script>${shim}</script>` : ""}
</head><body><script>${body}</script></body></html>`;
}

function framesetDocuments(run) {
  const id = encodeURIComponent(run.runId);
  const root = `<!doctype html><html><head><title>frameset</title></head>
<frameset cols="180,*">
<frame name="menu" src="/menu?run=${id}">
<frame name="main" src="/main?run=${id}&v=1">
</frameset></html>`;
  // Which navigations actually happened is read from the server's request log,
  // not from a frame that an escaping navigation would have destroyed. Ancestor
  // attempts aim at /busted so they can never be mistaken for a sibling hop.
  const menu = `<!doctype html><html><head><meta charset="utf-8"><title>menu</title>
<script>${innerRuntime(run, "menu")}</script></head><body>
<a id="link" href="/main?run=${id}&v=3" target="main">main</a>
<script>
probe("sibling frames.main reachable", function () { return !!parent.frames.main.document; });
probe("sibling parent.frames.main.location =", function () { parent.frames.main.location = "/main?run=${id}&v=2"; return "returned without throwing"; });
probe("anchor target=main click", function () { document.getElementById("link").click(); return "clicked"; });
probe("window.open(name=main)", function () { return String(window.open("/main?run=${id}&v=6", "main")); });
probe("own location stays writable", function () { return typeof location.replace; });
probe("ancestor parent.location = (frameset root)", function () { parent.location = "/busted?run=${id}&from=parent"; return "returned without throwing"; });
probe("ancestor top.location = (app window)", function () { top.location = ${scriptJson(run.appOrigin)} + "/busted?run=${id}&from=top"; return "returned without throwing"; });
report();
</script></body></html>`;
  const main = `<!doctype html><html><head><meta charset="utf-8"><title>main</title></head>
<body>main frame</body></html>`;
  return { root, menu, main };
}

function outerDocument(run) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>app window stand-in</title>
<style>html,body{margin:0;height:100%}iframe{width:100%;height:80%;border:0}</style>
</head><body>
<h1 id="banner">sortOfRemoteNG app window stand-in</h1>
<script>
window.SORNG_APP_MARKER = "app-window-secret";
var NONCE = ${scriptJson(run.nonce)};
window.__outer = {
  nonce: NONCE, ticks: [], frames: [], messages: [], inputs: 0,
  sourceMismatch: 0, answered: [], notified: [], started: Date.now(),
};
setInterval(function () {
  __outer.ticks.push(Date.now());
  if (__outer.ticks.length > 40000) __outer.ticks.shift();
}, 10);
(function paint() {
  __outer.frames.push(Date.now());
  if (__outer.frames.length > 40000) __outer.frames.shift();
  requestAnimationFrame(paint);
})();
addEventListener("keydown", function () { __outer.inputs++; });
addEventListener("click", function () { __outer.inputs++; });
var frame = document.createElement("iframe");
${
  run.sandbox === null
    ? "// measure-only mode: no sandbox attribute at all"
    : `frame.setAttribute("sandbox", ${scriptJson(run.sandbox)});`
}
window.__outer.sandbox = frame.getAttribute("sandbox");
var ANSWERS = {
  confirm: { outcome: "accept" },
  prompt: { outcome: "accept", value: "typed-by-host" },
  alert: { outcome: "accept" },
};
addEventListener("message", function (event) {
  var fromFrame = event.source === frame.contentWindow;
  if (!fromFrame) __outer.sourceMismatch++;
  __outer.messages.push({
    type: event.data && event.data.type,
    origin: event.origin,
    sourceIsFrameRoot: fromFrame,
    dialogKind: event.data && event.data.kind,
    deliveryMs: event.data && event.data.sentAt ? Date.now() - event.data.sentAt : null,
  });
  if (event.data && event.data.type === "sorng_script_dialog")
    __outer.answered.push(event.data.kind);
});
// Stands in for the proxy telling the app about a held dialog over its own
// channel (a Tauri event), which does not depend on the blocked page's thread.
function answerDialog(item) {
  var answer = ANSWERS[item.kind] || { outcome: "cancel" };
  return fetch(${scriptJson(run.appOrigin)} + "/dialog-answer?run=" + encodeURIComponent(${scriptJson(run.runId)}), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      run: ${scriptJson(run.runId)}, dialogId: item.dialogId,
      outcome: answer.outcome, value: answer.value,
    }),
  });
}
(function poll() {
  fetch(${scriptJson(run.appOrigin)} + "/pending-dialog?run=" + encodeURIComponent(${scriptJson(run.runId)}))
    .then(function (response) { return response.json(); })
    .then(function (item) {
      if (!item || !item.dialogId) return;
      __outer.notified.push({ kind: item.kind, message: item.message, at: Date.now() });
      return answerDialog(item);
    })
    .catch(function () {})
    .then(function () { setTimeout(poll, 20); });
})();
frame.src = ${scriptJson(run.frameUrl)};
document.body.appendChild(frame);
window.__outer.frameElement = frame;
</script></body></html>`;
}

/** Longest gap between app-window ticks inside [from, to], in milliseconds. */
export function maxGap(ticks, from, to) {
  if (!Array.isArray(ticks) || !Number.isFinite(from) || !Number.isFinite(to))
    return -1;
  const inside = ticks.filter((tick) => tick >= from - 50 && tick <= to + 50);
  if (inside.length < 2) return to - from;
  let worst = 0;
  for (let index = 1; index < inside.length; index++)
    worst = Math.max(worst, inside[index] - inside[index - 1]);
  return worst;
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      only: { type: "string" },
      list: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "hold-ms": { type: "string", default: "40000" },
      json: { type: "string" },
    },
  });
  const executable = EDGE.find(existsSync);
  if (!executable) {
    console.error(
      "This probe needs an existing installed Edge; no browser is downloaded.",
    );
    return 2;
  }
  let tokens;
  try {
    tokens = parseSandboxTokens(
      await readFile(path.join(repoRoot(), SANDBOX_SOURCE_PATH), "utf8"),
    );
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const shimProblems = shimOrderingProblems(
    buildCompatShimSource({ dialogEndpoint: DIALOG_ENDPOINT_PATH }),
  );
  if (shimProblems.length) {
    console.error(
      `The compatibility shim prototype lost its install order: ${shimProblems.join("; ")}`,
    );
    return 2;
  }
  let runs;
  try {
    runs = selectRuns(options.only);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (options.list) {
    for (const run of runs) console.log(`${run.id}  ${run.scenario.summary}`);
    return 0;
  }
  const holdMs = Math.max(
    1000,
    Number.parseInt(options["hold-ms"], 10) || 40000,
  );

  const sockets = new Set();
  const reports = new Map();
  const answers = new Map();
  const dialogWaiters = new Map();
  const hits = [];
  let port = 0;
  const waitFor = (runId, need) =>
    new Promise((resolve, reject) => {
      const bucket = reports.get(runId);
      bucket.resolve = resolve;
      bucket.need = need;
      bucket.timer = setTimeout(
        () => reject(new Error(`no page report within ${RUN_TIMEOUT_MS} ms`)),
        RUN_TIMEOUT_MS,
      );
      if (bucket.items.length >= need) {
        clearTimeout(bucket.timer);
        resolve(bucket.items);
      }
    });
  const readBody = async (request) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64 * 1024) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  };

  const server = createServer(async (request, response) => {
    const host = String(request.headers.host || "").split(":")[0];
    const url = new URL(request.url, `http://${request.headers.host}`);
    const runId = url.searchParams.get("run") || "";
    const run = reports.get(runId)?.run;
    hits.push({
      host,
      pathname: url.pathname,
      runId,
      method: request.method,
      params: Object.fromEntries(url.searchParams),
    });
    // The app window mirrors tauri.conf.json (frame-src http://*.localhost:*);
    // a proxied document mirrors the proxy's own same-origin policy. Keeping the
    // two apart stops a CSP difference being mistaken for a sandbox result.
    const csp = (pathname) =>
      pathname === "/outer"
        ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src http://*.localhost:*; object-src 'none'; frame-ancestors 'none'"
        : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; object-src 'none'";
    const send = (status, type, body) =>
      response
        .writeHead(status, {
          "Content-Type": type,
          "Cache-Control": "no-store",
          ...(type === "text/html"
            ? { "Content-Security-Policy": csp(url.pathname) }
            : {}),
        })
        .end(body);
    if (url.pathname === "/favicon.ico")
      return void response.writeHead(204).end();
    if (!run) return void send(404, "text/plain", "unknown run");
    switch (url.pathname) {
      case "/outer":
        return void send(200, "text/html", outerDocument(run));
      case "/busted":
        // Never reached unless a sandboxed frame navigated the app window.
        return void send(
          200,
          "text/html",
          "<!doctype html><title>BUSTED</title>",
        );
      case "/page":
        return void send(
          200,
          "text/html",
          run.scenario.name === "frameset"
            ? framesetDocuments(run).root
            : innerDocument(run, "root", pageScript(run)),
        );
      case "/page2":
        return void send(
          200,
          "text/html",
          `<!doctype html><html><head><meta charset="utf-8"><script>${innerRuntime(run, "root")}</script></head><body><script>
var outcome = "";
try { outcome = sessionStorage.getItem("sorng-unload-xhr") || "nothing recorded"; } catch (e) { outcome = "sessionStorage: " + e.name; }
note("synchronous XHR from pagehide", outcome.indexOf("status 200") === 0 ? "ok" : "blocked", outcome);
report();
</script></body></html>`,
        );
      case "/nested":
        return void send(
          200,
          "text/html",
          nestedDocument(run, url.searchParams.get("dialog") === "1"),
        );
      case "/menu":
        return void send(200, "text/html", framesetDocuments(run).menu);
      case "/main":
        return void send(200, "text/html", framesetDocuments(run).main);
      case "/report": {
        const body = await readBody(request);
        const bucket = reports.get(runId);
        try {
          bucket.items.push(JSON.parse(body ?? "{}"));
        } catch {
          bucket.items.push({ role: "unparsable", findings: [] });
        }
        if (bucket.resolve && bucket.items.length >= bucket.need) {
          clearTimeout(bucket.timer);
          bucket.resolve(bucket.items);
        }
        return void send(200, "text/plain", "ok");
      }
      case "/pending-dialog": {
        const began = Date.now();
        while (!run.pending.length && Date.now() - began < 25000)
          await new Promise((resolve) => {
            run.pendingResolve = resolve;
            setTimeout(resolve, 50);
          });
        run.pendingResolve = null;
        return void send(
          200,
          "application/json",
          JSON.stringify(run.pending.shift() ?? {}),
        );
      }
      case "/dialog-answer": {
        const body = await readBody(request);
        let payload = {};
        try {
          payload = JSON.parse(body ?? "{}");
        } catch {
          payload = {};
        }
        const key = `${runId}:${payload.dialogId}`;
        answers.set(key, payload);
        dialogWaiters.get(key)?.();
        return void send(200, "text/plain", "ok");
      }
      case DIALOG_ENDPOINT_PATH: {
        if (request.method !== "POST")
          return void send(405, "text/plain", "POST only");
        const body = await readBody(request);
        let payload = {};
        try {
          payload = JSON.parse(body ?? "{}");
        } catch {
          payload = {};
        }
        const key = `${runId}:${payload.dialogId}`;
        run.dialogRequests.push({
          dialogId: payload.dialogId,
          kind: payload.kind,
          at: Date.now(),
          origin: request.headers.origin ?? null,
          unload: Boolean(payload.unload),
        });
        run.pending.push({
          dialogId: payload.dialogId,
          kind: payload.kind,
          message: payload.message,
          defaultValue: payload.defaultValue,
        });
        run.pendingResolve?.();
        const hold = Math.max(0, Number(payload.holdMs) || 0);
        // A dialog raised while the document is going away must never hold the
        // unload path open; answer it at once and record that it arrived.
        if (payload.unload)
          return void send(200, "application/json", '{"outcome":"cancel"}');
        if (hold) await delay(hold);
        else {
          const began = Date.now();
          while (!answers.has(key) && Date.now() - began < 20000)
            await new Promise((resolve) => {
              dialogWaiters.set(key, resolve);
              setTimeout(resolve, 50);
            });
          dialogWaiters.delete(key);
        }
        const answer = answers.get(key);
        return void send(
          200,
          "application/json",
          JSON.stringify(
            answer
              ? { outcome: answer.outcome, value: answer.value }
              : { outcome: hold ? "accept" : "cancel" },
          ),
        );
      }
      default:
        return void send(404, "text/plain", "not found");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const profile = await mkdtemp(path.join(tmpdir(), "sorng-legacy-frame-"));
  const browserTemp = path.join(profile, "temp");
  await mkdir(browserTemp);
  let browser;
  let exited;
  let devtools;
  const rows = [];
  const notes = [];
  let failed = 0;
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
        // The app's web view is a visible, unthrottled frame; so are these tabs.
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
    for (
      let waited = 0;
      !endpoint && waited < START_TIMEOUT_MS;
      waited += 100
    ) {
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
      throw new Error("Edge headless did not publish a DevTools endpoint");
    devtools = await DevTools.connect(endpoint);
    const { product } = await devtools.send("Browser.getVersion");
    console.log(`${product}: ${runs.length} runs`);

    const live = new Map();
    devtools.on((method, params, sessionId) => {
      const current = live.get(sessionId) ?? live.get("*");
      if (!current) return;
      if (method === "Log.entryAdded")
        current.logs.push(
          `${params.entry.source}/${params.entry.level}: ${params.entry.text}`.slice(
            0,
            300,
          ),
        );
      else if (method === "Runtime.consoleAPICalled")
        current.logs.push(
          `console.${params.type}: ${params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`.slice(
            0,
            300,
          ),
        );
      else if (method === "Runtime.exceptionThrown")
        current.logs.push(
          `exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`.slice(
            0,
            300,
          ),
        );
      else if (method === "Page.javascriptDialogOpening") {
        current.dialogs.push({
          type: params.type,
          message: String(params.message).slice(0, 200),
          url: params.url,
          hasHandler: params.hasBrowserHandler,
          defaultPrompt: params.defaultPrompt,
        });
        devtools
          .send(
            "Page.handleJavaScriptDialog",
            { accept: true, promptText: "typed-into-engine-dialog" },
            sessionId,
            5000,
          )
          .catch(() => {});
      } else if (method === "Inspector.targetCrashed")
        current.logs.push("the renderer crashed");
      else if (method === "Target.attachedToTarget") {
        current.childTargets.push(params.targetInfo.type);
        live.set(params.sessionId, current);
        for (const call of ["Runtime.enable", "Log.enable"])
          devtools.send(call, {}, params.sessionId, 5000).catch(() => {});
      }
    });

    for (const run of runs) {
      const runId = randomUUID();
      const hex = randomBytes(16).toString("hex");
      Object.assign(run, {
        runId,
        nonce: randomUUID(),
        holdMs,
        appOrigin: `http://${APP_HOSTS[run.host]}:${port}`,
        proxyOrigin: `http://${proxyHost(hex)}:${port}`,
        sandbox: sandboxForMode(run.mode, tokens.proxy),
        dialogRequests: [],
        pending: [],
        pendingResolve: null,
      });
      run.frameUrl = `${run.proxyOrigin}/page?run=${encodeURIComponent(runId)}`;
      reports.set(runId, { items: [], need: run.scenario.reports, run });
      const state = { logs: [], dialogs: [], childTargets: [] };
      let targetId;
      let sessionId;
      try {
        ({ targetId } = await devtools.send("Target.createTarget", {
          url: "about:blank",
        }));
        ({ sessionId } = await devtools.send("Target.attachToTarget", {
          targetId,
          flatten: true,
        }));
        live.set(sessionId, state);
        for (const call of ["Runtime.enable", "Page.enable", "Log.enable"])
          await devtools.send(call, {}, sessionId);
        await devtools.send(
          "Target.setAutoAttach",
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
          sessionId,
        );
        await devtools.send(
          "Page.navigate",
          {
            url: `${run.appOrigin}/outer?run=${encodeURIComponent(runId)}`,
          },
          sessionId,
        );
        const observed = { run, state };
        if (run.scenario.name === "dialog-hold") {
          // Sample the app window while the website frame is blocked.
          await delay(1500);
          observed.duringHold = [];
          for (let sample = 0; sample < 4; sample++) {
            await delay(Math.min(4000, holdMs / 5));
            await devtools
              .send(
                "Input.dispatchKeyEvent",
                { type: "keyDown", key: "a", text: "a" },
                sessionId,
                4000,
              )
              .catch(() => {});
            await devtools
              .send(
                "Input.dispatchKeyEvent",
                { type: "keyUp", key: "a" },
                sessionId,
                4000,
              )
              .catch(() => {});
            const began = Date.now();
            const value = await devtools
              .send(
                "Runtime.evaluate",
                {
                  expression:
                    "JSON.stringify({ticks:__outer.ticks.length,frames:__outer.frames.length,inputs:__outer.inputs,postMessages:__outer.answered.length,proxyNotified:__outer.notified.length})",
                  returnByValue: true,
                },
                sessionId,
                6000,
              )
              .then((result) => result.result.value)
              .catch((error) => `evaluate failed: ${error.message}`);
            observed.duringHold.push({
              evaluateMs: Date.now() - began,
              value,
            });
          }
        }
        const items = await waitFor(runId, run.scenario.reports).catch(
          (error) => {
            // A scenario whose whole point is an escaping navigation may lose
            // its report with the document; measure what the server saw instead.
            if (!run.scenario.tolerateLostReport) throw error;
            return reports.get(runId).items;
          },
        );
        // Messages a blocked frame queued are delivered once its task ends;
        // settle before reading so the read is not racing that delivery.
        await delay(250);
        const outer = await devtools
          .send(
            "Runtime.evaluate",
            {
              expression:
                "JSON.stringify({nonce:__outer.nonce,sandbox:__outer.sandbox,messages:__outer.messages,inputs:__outer.inputs,sourceMismatch:__outer.sourceMismatch,answered:__outer.answered,notified:__outer.notified,ticks:__outer.ticks,frames:__outer.frames.length,href:location.href})",
              returnByValue: true,
            },
            sessionId,
            10000,
          )
          .then((result) => JSON.parse(result.result.value))
          .catch((error) => ({ error: error.message }));
        observed.items = items;
        observed.outer = outer;
        rows.push(...summarise(observed, hits, notes));
      } catch (error) {
        rows.push({
          scenario: run.scenario.name,
          mode: run.mode,
          host: run.host,
          check: "run completed",
          outcome: "failed",
          detail: error.message,
        });
      } finally {
        live.delete(sessionId);
        if (targetId)
          await devtools
            .send("Target.closeTarget", { targetId }, undefined, 5000)
            .catch(() => {});
      }
    }
    console.log(`\n${renderMatrix(rows)}\n`);
    const verdicts = deriveVerdicts(rows);
    console.log("Verdicts:");
    for (const [key, value] of Object.entries(verdicts))
      console.log(
        `  ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`,
      );
    if (notes.length && options.verbose) {
      console.log("\nEngine messages:");
      for (const line of notes) console.log(`  ${line}`);
    }
    const mismatches = expectationMismatches(rows);
    if (mismatches.length) {
      console.log("\nDrift from the recorded behaviour:");
      for (const line of mismatches) console.log(`  x ${line}`);
    } else
      console.log("\nEvery pinned behaviour matched the recorded measurement.");
    failed += mismatches.length;
    if (options.json)
      await writeFile(
        path.resolve(repoRoot(), options.json),
        `${JSON.stringify({ product, rows, verdicts, mismatches, notes }, null, 2)}\n`,
        "utf8",
      );
  } catch (error) {
    console.error(`The probe could not run: ${error.message}`);
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
      path.basename(profile).startsWith("sorng-legacy-frame-")
    )
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      });
  }
  return failed ? 1 : 0;
}

/** Fold one run's page reports, app-window state and engine logs into rows. */
function summarise(observed, hits, notes) {
  const { run, state, items, outer } = observed;
  const base = {
    scenario: run.scenario.name,
    mode: run.mode,
    host: run.host,
  };
  const rows = [];
  for (const item of items)
    for (const finding of item.findings ?? [])
      rows.push({
        ...base,
        check:
          item.role === "root" ? finding.name : `${item.role}: ${finding.name}`,
        outcome: finding.outcome,
        detail: finding.detail,
      });
  for (const line of state.logs) notes.push(`${run.id}  ${line}`);
  rows.push({
    ...base,
    check: "out-of-process frame target",
    outcome: state.childTargets.includes("iframe") ? "ok" : "none",
    detail: state.childTargets.length
      ? state.childTargets.join(",")
      : "no separate target: the frame shares the app renderer",
  });
  rows.push({
    ...base,
    check: "engine dialogs opened",
    outcome: state.dialogs.length ? "ok" : "none",
    detail: state.dialogs
      .map((dialog) => `${dialog.type}: ${dialog.message}`)
      .join(" | "),
  });
  const mine = hits.filter((hit) => hit.runId === run.runId);
  const appHost = APP_HOSTS[run.host];
  const appHits = mine.filter((hit) => hit.pathname === "/outer").length;
  const busted = mine.filter(
    (hit) => hit.pathname === "/busted" && hit.host === appHost,
  );
  rows.push({
    ...base,
    check: "app window never navigated",
    outcome:
      appHits === 1 && busted.length === 0 && !outer.error ? "ok" : "failed",
    detail: `app document requests=${appHits} escapes=${busted.length} href=${outer.href ?? "?"}`,
  });
  if (run.scenario.name === "frameset") {
    const mains = mine
      .filter((hit) => hit.pathname === "/main")
      .map((hit) => hit.params.v);
    rows.push({
      ...base,
      check: "frames the menu actually navigated",
      outcome: mains.join(",") === "1" ? "blocked" : "navigated",
      detail: `/main?v= requests: ${mains.join(",") || "none"} (1 = the initial load only)`,
    });
  }
  if (run.scenario.name === "frame-bust" || run.scenario.name === "frameset") {
    const escapes = mine
      .filter((hit) => hit.pathname === "/busted")
      .map(
        (hit) =>
          `${hit.params.from ?? "?"}@${hit.host === appHost ? "app window" : "own origin"}`,
      );
    rows.push({
      ...base,
      check: "navigations that reached the server",
      outcome: escapes.length ? "escaped" : "blocked",
      detail: escapes.join(" | ") || "none reached the server",
    });
  }
  if (run.dialogRequests.some((request) => !request.unload)) {
    const asked = run.dialogRequests.filter((request) => !request.unload);
    rows.push({
      ...base,
      check: "app learned of the dialog while the frame was blocked",
      outcome: (outer.notified ?? []).length >= asked.length ? "ok" : "failed",
      detail: `proxy-side notifications=${(outer.notified ?? []).length} of ${asked.length} dialogs`,
    });
    const delays = (outer.messages ?? [])
      .filter((message) => message.type === "sorng_script_dialog")
      .map((message) => message.deliveryMs)
      .filter((value) => Number.isFinite(value));
    rows.push({
      ...base,
      check: "postMessage from the blocked frame arrived",
      outcome: delays.some((value) => value < 1000) ? "prompt" : "deferred",
      detail: delays.length
        ? `delivery delays: ${delays.join(", ")} ms (each covers the whole block)`
        : "no sorng_script_dialog message was delivered at all",
    });
  }
  if (outer.messages)
    rows.push({
      ...base,
      check: "postMessage source is the frame root",
      outcome:
        outer.messages.length === 0
          ? "none"
          : outer.sourceMismatch === 0
            ? "ok"
            : "failed",
      detail: outer.messages
        .map(
          (message) =>
            `${message.type}${message.sourceIsFrameRoot ? "" : " (WRONG SOURCE)"}@${message.origin}`,
        )
        .join(" | "),
    });
  if (run.scenario.name === "renderer-placement") {
    const item = items.find((entry) => entry.role === "root") ?? {};
    const extra = item.extra ?? {};
    const ticks = outer.ticks ?? [];
    // A gap anywhere near the block length means one renderer serves both.
    const gap = (from, to, blocked) => {
      const value = maxGap(ticks, from, to);
      return {
        ...base,
        outcome: value >= 0 && value < 500 ? "isolated" : "shared",
        value,
        detail: `${value} ms app tick gap while the frame blocked ${blocked} ms`,
      };
    };
    rows.push({
      ...gap(extra.busyStart, extra.busyEnd, extra.busyEnd - extra.busyStart),
      check: "app tick gap during frame busy loop",
    });
    rows.push({
      ...gap(extra.xhrStart, extra.xhrEnd, extra.xhrEnd - extra.xhrStart),
      check: "app tick gap during sync XHR",
    });
  }
  if (run.scenario.name === "dialog-hold") {
    const samples = observed.duringHold ?? [];
    const liveSamples = samples.filter(
      (sample) =>
        typeof sample.value === "string" && sample.value.startsWith("{"),
    );
    rows.push({
      ...base,
      check: "app page stayed live during the hold",
      outcome:
        liveSamples.length === samples.length && samples.length
          ? "ok"
          : "failed",
      detail: samples
        .map(
          (sample) =>
            `${sample.evaluateMs}ms ${String(sample.value).slice(0, 80)}`,
        )
        .join(" | "),
    });
  }
  if (run.dialogRequests.length)
    rows.push({
      ...base,
      check: "bridge requests reached the proxy",
      outcome: "ok",
      detail: run.dialogRequests
        .map(
          (request) =>
            `${request.kind}${request.unload ? " (unload)" : ""}@${request.origin}`,
        )
        .join(" | "),
    });
  return rows;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  let self;
  try {
    self = fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
  const invoked = path.resolve(process.argv[1]);
  return process.platform === "win32"
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self;
}

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
