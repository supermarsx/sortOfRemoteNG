// Does the per-connection dark-mode extension reach every document of a legacy
// device page? Installed Edge headless over CDP mounts synthetic legacy
// fixtures inside an iframe carrying the production sandbox tokens, on a
// per-session proxy authority, served by a stand-in that injects the REAL
// `web_dark_mode_client.js` into every document exactly as the proxy does. No
// app build, app binary, account, profile, package download, WDIO run or real
// device is used; every page is synthetic and every request stays on 127.0.0.1.
//
//   node scripts/test-website-dark-mode-browser.mjs [--expect=post|pre|none]
//     [--only=name,...] [--list] [--record] [--verbose] [--json=<file>]
//
// `--expect=post` (the default) is the production expectation, and the shipped
// controller meets it: every proxied document themes itself, framesets get
// their gutters back, frames the proxy never served get CSS-only theming, and a
// single-document page behaves exactly as it did before. Run it that way in a
// gate. `--expect=pre` pins what `main` measured before per-document delivery
// existed; it FAILS on a current tree, and is kept only for archaeology — to
// show, row by row, what the bug looked like. `--expect=none` only prints.
//
// Exit codes: 0 every pinned check matched, 1 a check drifted from the chosen
// expectation, 2 the harness could not run (no Edge, or a production shape this
// mirror reproduces has changed and the mirror is stale).
//
// Alongside the pinned checks the run prints structural measurements, kept
// because each one decided a design choice that is easy to undo by accident:
//   M1  the readiness script really executes in a <frameset> document, with
//       and without a <head>, at the offset the proxy inserts it.
//   M2  an inversion on the outermost document composites over child frame
//       content — which is why only that document carries the filter layer.
//   M3  what the dynamic engine does when asked to convert a body-less
//       frameset (it converts it, invisibly; hence the engine is skipped).
//   M4  the engine already rewrites bgcolor/text/font colour, so the explicit
//       legacy rules belong to the engine-less paths only.
//   M5  every document's same-origin `parent` walk lands on the outermost
//       proxied document, with and without a `parent` override on the root.
//   F2  only the frameset's `bordercolor` attribute repaints its gutters; a
//       stylesheet does not reach them.
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
import { inflateSync } from "node:zlib";

// ── production shapes this mirror reproduces (pure; no I/O) ─────────────────

export const SANDBOX_SOURCE_PATH = "src/utils/protocol/webBrowserFrame.ts";
export const DARK_CLIENT_PATH =
  "src-tauri/crates/sorng-protocols/src/web_dark_mode_client.js";
export const INJECTION_SOURCE_PATH =
  "src-tauri/crates/sorng-protocols/src/http_response.rs";
export const DARKREADER_ASSET_PATH =
  "src-tauri/crates/sorng-protocols/src/vendor/darkreader/darkreader.js";
/** `http_web_automation.rs::DARKREADER_PATH`; the controller builds this URL. */
export const DARKREADER_URL_PATH = "/__sortofremoteng_web_darkreader_v1.js";

/** The proxy frame's tokens, in the product's own order. */
export const EXPECTED_PROXY_TOKENS = Object.freeze([
  "allow-same-origin",
  "allow-scripts",
  "allow-forms",
]);

export class HarnessSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessSetupError";
  }
}

/** Read the sandbox constants out of the product source (see the t95 sibling). */
export function parseSandboxTokens(source) {
  const text = String(source).replace(/\r\n/gu, "\n");
  const proxy = /export const PROXY_WEB_FRAME_SANDBOX =\s*"([^"]*)";/u.exec(
    text,
  );
  if (!proxy)
    throw new HarnessSetupError(
      `Could not read PROXY_WEB_FRAME_SANDBOX from ${SANDBOX_SOURCE_PATH}; update this mirror.`,
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
  return { proxy: proxy[1], tokens };
}

/**
 * The shape of the injected dark-mode controller. The shipped file defines
 * `createWebDarkModeController` and calls an eager per-document install as its
 * last statement, which is what joins every frame to the root's registry; this
 * detects that call by name and reports the shape as "registry". A file that
 * only defines the factory still runs here, as "legacy" — the run then measures
 * root-only theming and every per-frame check fails, which is the point.
 *
 * The factory's empty parameter list is load-bearing: the injected script calls
 * it with no arguments, so a new parameter is drift and stops the run (exit 2).
 *
 * @param {string} source
 * @returns {{ factory: string, installer: string | null, shape: "legacy" | "registry", modes: string[] }}
 */
export function parseDarkClientShape(source) {
  const text = String(source).replace(/\r\n/gu, "\n");
  if (!/\bfunction createWebDarkModeController\s*\(\s*\)\s*\{/u.test(text))
    throw new HarnessSetupError(
      `Could not find createWebDarkModeController in ${DARK_CLIENT_PATH}; update this mirror.`,
    );
  const modes = /\[([^\]]*)\]\s*\.indexOf\(value\.mode\)/u.exec(text);
  if (!modes)
    throw new HarnessSetupError(
      `Could not read the accepted mode list from ${DARK_CLIENT_PATH}; update this mirror.`,
    );
  const accepted = [...modes[1].matchAll(/"([a-zA-Z]+)"/gu)].map(
    (match) => match[1],
  );
  for (const mode of ["dynamic", "filter", "dynamicFilter", "customCss"])
    if (!accepted.includes(mode))
      throw new HarnessSetupError(
        `${DARK_CLIENT_PATH} no longer accepts the "${mode}" mode; update this mirror.`,
      );
  // An eager per-document install is a bare call on the file's last line.
  const lines = text.split("\n").filter((line) => line.trim().length);
  const last = lines[lines.length - 1] ?? "";
  const eager = /^\s*([A-Za-z_$][\w$]*)\(\)\s*;\s*$/u.exec(last);
  return {
    factory: "createWebDarkModeController",
    installer: eager ? eager[1] : null,
    shape: eager ? "registry" : "legacy",
    modes: accepted,
  };
}

/**
 * The readiness IIFE's splice order. The dark-mode controller must stay ahead
 * of the automation client: the eager per-document install has to run before
 * anything captures `window.parent`, and t95's `parent` override is appended
 * after both.
 */
export function injectionOrderProblems(source) {
  const text = String(source).replace(/\r\n/gu, "\n");
  const problems = [];
  const dark = text.indexOf("{dark_mode_client}");
  const automation = text.indexOf("{automation_client}");
  if (dark < 0) problems.push("the dark-mode client is no longer spliced in");
  if (automation < 0)
    problems.push("the automation client is no longer spliced in");
  if (dark >= 0 && automation >= 0 && dark > automation)
    problems.push("the automation client now precedes the dark-mode client");
  if (!text.includes('include_str!("web_dark_mode_client.js")'))
    problems.push("web_dark_mode_client.js is no longer included verbatim");
  for (const destination of ["document", "iframe", "frame"])
    if (!text.includes(`"${destination}"`))
      problems.push(
        `is_document_request no longer accepts sec-fetch-dest ${destination}`,
      );
  return problems;
}

/** The per-session proxy authority shape asserted by the product. */
export function proxyHost(hex) {
  if (!/^[0-9a-f]{32}$/u.test(hex))
    throw new HarnessSetupError("A proxy label needs 32 lowercase hex digits.");
  return `p${hex}.localhost`;
}

/**
 * A faithful port of `http_response.rs::early_script_insertion`. Where the
 * readiness script lands decides whether it runs at all in a `<frameset>`
 * document with no `<head>` (measurement M1), so this must not be approximated.
 */
export function earlyScriptInsertion(html) {
  const lower = html.toLowerCase();
  let cursor = 0;
  let fallback = 0;
  for (;;) {
    const offset = lower.indexOf("<", cursor);
    if (offset < 0) break;
    const start = offset;
    if (lower.startsWith("<!--", start)) {
      const end = lower.indexOf("-->", start + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    let end = start + 1;
    let quote = null;
    while (end < lower.length) {
      const character = lower[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === "'" || character === '"') quote = character;
      else if (character === ">") break;
      end += 1;
    }
    if (end >= lower.length) break;
    const name = lower.slice(start + 1, end).split(/[\s/]/u)[0] ?? "";
    if (name === "head" || name === "body") return end + 1;
    if (name === "script") return start;
    if (name === "!doctype" || name === "html") fallback = end + 1;
    cursor = end + 1;
  }
  return fallback;
}

// ── legacy charsets (pure) ─────────────────────────────────────────────────

let gbReverse = null;
/**
 * A GB2312 encoder derived from the platform's own GB18030 decoder, so no table
 * is hand-copied into the repo: every two-byte pair in the GB2312 range is
 * decoded once and the mapping inverted. The fixture stays readable UTF-8 on
 * disk and is encoded on the way out, exactly as a device would serve it.
 */
export function encodeGb2312(text) {
  if (!gbReverse) {
    gbReverse = new Map();
    const decoder = new TextDecoder("gb18030");
    const pair = new Uint8Array(2);
    for (let lead = 0xa1; lead <= 0xf7; lead++)
      for (let trail = 0xa1; trail <= 0xfe; trail++) {
        pair[0] = lead;
        pair[1] = trail;
        const decoded = decoder.decode(pair);
        if (
          decoded.length === 1 &&
          decoded !== "\uFFFD" &&
          !gbReverse.has(decoded)
        )
          gbReverse.set(decoded, [lead, trail]);
      }
  }
  const bytes = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const mapped = gbReverse.get(character);
    if (!mapped)
      throw new HarnessSetupError(
        `The gb2312 fixture contains ${JSON.stringify(character)}, which GB2312 cannot encode.`,
      );
    bytes.push(mapped[0], mapped[1]);
  }
  return Buffer.from(bytes);
}

/**
 * How the proxy splices its script into a response body.
 *
 * `lossy` reproduces today's `http.rs` path (`String::from_utf8_lossy` there and
 * back), which replaces every non-UTF-8 byte with U+FFFD (H5/F7, a separate
 * task: dark mode works either way, the page is just unreadable).
 * `bytes` is the proposed byte-level insertion: the insertion offset is computed
 * on ASCII markup either way, so the rest of the body is never re-encoded.
 */
export function injectDocument(body, script, injection) {
  if (injection === "bytes") {
    const markup = body.toString("latin1");
    const at = earlyScriptInsertion(markup);
    return Buffer.concat([
      body.subarray(0, at),
      Buffer.from(script, "utf8"),
      body.subarray(at),
    ]);
  }
  const text = new TextDecoder("utf-8").decode(body);
  const at = earlyScriptInsertion(text);
  return Buffer.from(`${text.slice(0, at)}${script}${text.slice(at)}`, "utf8");
}

// ── colour maths (pure) ────────────────────────────────────────────────────

export function parseColor(value) {
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/u.exec(
      String(value ?? "").trim(),
    );
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

export function relativeLuminance(color) {
  const rgb = typeof color === "string" ? parseColor(color) : color;
  if (!rgb) return null;
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The threshold that separates a themed document from an untouched one. */
export const DARK_LUMINANCE = 0.2;

export function darkness(color) {
  const luminance = relativeLuminance(color);
  if (luminance === null) return { outcome: "unknown", luminance: null };
  return {
    outcome: luminance < DARK_LUMINANCE ? "dark" : "light",
    luminance,
  };
}

// ── PNG (pure) ─────────────────────────────────────────────────────────────

/** Minimal decoder for the 8-bit, non-interlaced RGB/RGBA PNGs CDP returns. */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47)
    throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const parts = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6))
    throw new Error(
      `unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`,
    );
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let position = 0;
  for (let row = 0; row < height; row++) {
    const filter = raw[position++];
    const line = raw.subarray(position, position + stride);
    position += stride;
    const base = row * stride;
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? pixels[base + index - channels] : 0;
      const up = row ? pixels[base - stride + index] : 0;
      const corner =
        row && index >= channels ? pixels[base - stride + index - channels] : 0;
      let value;
      switch (filter) {
        case 0:
          value = line[index];
          break;
        case 1:
          value = line[index] + left;
          break;
        case 2:
          value = line[index] + up;
          break;
        case 3:
          value = line[index] + ((left + up) >> 1);
          break;
        case 4: {
          const estimate = left + up - corner;
          const dl = Math.abs(estimate - left);
          const du = Math.abs(estimate - up);
          const dc = Math.abs(estimate - corner);
          value =
            line[index] +
            (dl <= du && dl <= dc ? left : du <= dc ? up : corner);
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[base + index] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** Mean colour of a rectangle, as a CSS `rgb()` string. */
export function meanColor(image, rect) {
  if (!image || !rect) return null;
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(image.width, Math.round(rect.x + rect.width));
  const y1 = Math.min(image.height, Math.round(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const at = y * image.width * image.channels + x * image.channels;
      r += image.pixels[at];
      g += image.pixels[at + 1];
      b += image.pixels[at + 2];
      count += 1;
    }
  if (!count) return null;
  return `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
}

/** The middle of the gap between two frame boxes, or null when they touch. */
export function gutterBetween(first, second) {
  if (!first || !second) return null;
  const vertical = second.y - (first.y + first.height);
  if (vertical >= 4)
    return {
      x: Math.max(first.x, second.x) + 12,
      y: first.y + first.height + 2,
      width: 6,
      height: vertical - 4,
    };
  const horizontal = second.x - (first.x + first.width);
  if (horizontal >= 4)
    return {
      x: first.x + first.width + 2,
      y: Math.max(first.y, second.y) + 12,
      width: horizontal - 4,
      height: 6,
    };
  return null;
}

// ── scenarios (pure) ───────────────────────────────────────────────────────

export const THEME_DEFAULTS = Object.freeze({
  mode: "dynamic",
  brightness: 100,
  contrast: 100,
  sepia: 0,
  grayscale: 0,
  backgroundColor: "#181a1b",
  textColor: "#e8e6e3",
  preserveMedia: true,
  customCss: "",
});

/**
 * Every run mounts one fixture. `probes` asks for the structural measurements
 * M1–M3 and the F2 frameset-background trial, which are deliberately taken on
 * runs with the extension OFF so their before/after deltas are unambiguous.
 */
export const SCENARIOS = Object.freeze([
  {
    id: "single-document/dynamic/off",
    fixture: "single-document.html",
    theme: { mode: "dynamic" },
    enabled: false,
    summary: "modern single-document control, extension off",
  },
  {
    id: "single-document/dynamic/on",
    fixture: "single-document.html",
    theme: { mode: "dynamic" },
    enabled: true,
    summary:
      "modern single-document control: what already works must not break",
  },
  {
    id: "single-document/filter/on",
    fixture: "single-document.html",
    theme: { mode: "filter" },
    enabled: true,
    summary: "single-document control in filter mode",
  },
  {
    id: "frameset-3/dynamic/off",
    fixture: "frameset-3.html",
    theme: { mode: "dynamic" },
    enabled: false,
    probes: ["filter-composite", "frameset-background", "frameset-engine"],
    summary: "three-frame frameset, extension off: M1/M2/M3 and the F2 trial",
  },
  {
    id: "frameset-3/dynamic/on",
    fixture: "frameset-3.html",
    theme: { mode: "dynamic" },
    enabled: true,
    summary: "three-frame frameset: the reported Yealink-shaped failure",
  },
  {
    id: "frameset-3/filter/on",
    fixture: "frameset-3.html",
    theme: { mode: "filter" },
    enabled: true,
    summary: "three-frame frameset in filter mode (the user's 30-second test)",
  },
  {
    id: "frameset-3/dynamicFilter/on",
    fixture: "frameset-3.html",
    theme: { mode: "dynamicFilter" },
    enabled: true,
    summary:
      "three-frame frameset in dynamicFilter mode (double-inversion risk)",
  },
  {
    id: "frameset-nohead/dynamic/on",
    fixture: "frameset-nohead.html",
    theme: { mode: "dynamic" },
    enabled: true,
    summary:
      "frameset with no <head>: does the readiness script run at all (M1)",
  },
  {
    id: "nested-iframes/dynamic/off",
    fixture: "nested-iframes.html",
    theme: { mode: "dynamic" },
    enabled: false,
    probes: ["filter-composite"],
    summary: "iframes three deep, extension off: baseline and M2",
  },
  {
    id: "nested-iframes/dynamic/on",
    fixture: "nested-iframes.html",
    theme: { mode: "dynamic" },
    enabled: true,
    summary: "iframes three deep: only the outermost document is told",
  },
  {
    id: "nested-iframes/dynamic/on+shim",
    fixture: "nested-iframes.html",
    theme: { mode: "dynamic" },
    enabled: true,
    parentShim: true,
    summary: "iframes three deep with t95's parent override on the root (M5)",
  },
  {
    id: "nested-iframes/filter/on",
    fixture: "nested-iframes.html",
    theme: { mode: "filter" },
    enabled: true,
    summary: "iframes three deep in filter mode",
  },
  {
    id: "document-write/dynamic/on",
    fixture: "document-write.html",
    theme: { mode: "dynamic" },
    enabled: true,
    summary: "document.write and srcdoc frames the proxy never served (F3)",
  },
  {
    id: "gb2312/dynamic/on",
    fixture: "gb2312.html",
    charset: "gb2312",
    injection: "lossy",
    theme: { mode: "dynamic" },
    enabled: true,
    summary: "gb2312 page through today's from_utf8_lossy injection (H5/F7)",
  },
  {
    id: "gb2312-bytes/dynamic/on",
    fixture: "gb2312.html",
    charset: "gb2312",
    injection: "bytes",
    theme: { mode: "dynamic" },
    enabled: true,
    summary:
      "the same gb2312 page with byte-level insertion (the F7 fix shape)",
  },
  {
    id: "bgcolor-tables/dynamic/off",
    fixture: "bgcolor-tables.html",
    theme: { mode: "dynamic" },
    enabled: false,
    summary: "hardcoded bgcolor/text/font colour tables, extension off",
  },
  {
    id: "bgcolor-tables/dynamic/on",
    fixture: "bgcolor-tables.html",
    theme: { mode: "dynamic" },
    enabled: true,
    summary: "does the engine override presentational colour attributes (M4)",
  },
  {
    id: "bgcolor-tables/media/on",
    fixture: "bgcolor-tables.html",
    theme: { mode: "dynamic", preserveMedia: false },
    enabled: true,
    summary: "preserveMedia off: is the white-background GIF inverted (F4)",
  },
  {
    id: "bgcolor-tables/customCss/on",
    fixture: "bgcolor-tables.html",
    theme: {
      mode: "customCss",
      customCss:
        "body{background-color:#181a1b;color:#e8e6e3}td{background-color:#202324;color:#e8e6e3}",
    },
    enabled: true,
    summary: "customCss mode reaches the same documents as every other mode",
  },
]);

export function selectRuns(only, scenarios = SCENARIOS) {
  if (!only) return [...scenarios];
  const wanted = String(only)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = wanted.filter(
    (item) =>
      !scenarios.some(
        (scenario) =>
          scenario.id === item || scenario.id.startsWith(`${item}/`),
      ),
  );
  if (unknown.length)
    throw new HarnessSetupError(`Unknown scenario(s): ${unknown.join(", ")}`);
  return scenarios.filter((scenario) =>
    wanted.some(
      (item) => scenario.id === item || scenario.id.startsWith(`${item}/`),
    ),
  );
}

// ── expectations ───────────────────────────────────────────────────────────

/**
 * What `main` measured on 2026-09-16 (Edge headless), before per-document
 * delivery existed. This is the bug, recorded: only the outermost proxied
 * document was ever told to theme itself. It is kept as the witness — reachable
 * with `--expect=pre`, where it now fails — not as anything to restore.
 */
export const PRE = Object.freeze({
  "single-document/dynamic/on": {
    "single-document controller": "injected",
    "single-document delivered": "yes",
    "single-document theming installed": "yes",
    "single-document themed": "dark",
    "single-document ink contrast": "ok",
  },
  "single-document/filter/on": {
    "single-document themed": "dark",
    "stacked filters": "none",
  },
  "frameset-3/dynamic/on": {
    "frameset-3 controller": "injected",
    "frameset-3 delivered": "yes",
    "banner controller": "injected",
    "banner theming installed": "no",
    "banner themed": "light",
    "banner ink contrast": "ok",
    "menu controller": "injected",
    "menu theming installed": "no",
    "menu themed": "light",
    "menu ink contrast": "ok",
    "content controller": "injected",
    "content theming installed": "no",
    "content themed": "light",
    "content ink contrast": "ok",
    "frameset-3 gutter": "light",
  },
  "frameset-3/filter/on": {
    "banner themed": "dark",
    "menu themed": "dark",
    "content themed": "dark",
    "stacked filters": "none",
  },
  "frameset-3/dynamicFilter/on": {
    "banner theming installed": "no",
    "banner themed": "light",
    "menu themed": "light",
    "content themed": "light",
    "frameset-3 gutter": "light",
    "stacked filters": "none",
  },
  "frameset-nohead/dynamic/on": {
    "frameset-nohead controller": "injected",
    "menu theming installed": "no",
    "menu themed": "light",
    "content themed": "light",
    "frameset-nohead gutter": "light",
  },
  "nested-iframes/dynamic/on": {
    "nested-iframes themed": "dark",
    "nested-1 controller": "injected",
    "nested-1 theming installed": "no",
    "nested-1 themed": "light",
    "nested-2 theming installed": "no",
    "nested-2 themed": "light",
    "nested-3 theming installed": "no",
    "nested-3 themed": "light",
    "root walk": "ok",
  },
  "nested-iframes/dynamic/on+shim": {
    "nested-1 theming installed": "no",
    "nested-1 themed": "light",
    "nested-2 themed": "light",
    "nested-3 themed": "light",
    "root walk": "ok",
  },
  "nested-iframes/filter/on": {
    "nested-1 themed": "dark",
    "nested-2 themed": "dark",
    "nested-3 themed": "dark",
    "stacked filters": "none",
  },
  "document-write/dynamic/on": {
    "document-write themed": "dark",
    "written-frame controller": "absent",
    "written-frame theming installed": "no",
    "written-frame themed": "light",
    "srcdoc-frame controller": "absent",
    "srcdoc-frame theming installed": "no",
    "srcdoc-frame themed": "light",
  },
  "bgcolor-tables/dynamic/on": {
    "bgcolor-tables themed": "dark",
    "bgcolor cell": "dark",
    "bgcolor ink contrast": "ok",
    "body text attribute": "light on dark",
  },
  "bgcolor-tables/customCss/on": {
    "bgcolor-tables themed": "dark",
    "bgcolor ink contrast": "low",
  },
  "gb2312/dynamic/on": {
    "gb2312 controller": "injected",
    "gb2312 themed": "dark",
  },
  "gb2312-bytes/dynamic/on": {
    "gb2312 controller": "injected",
    "gb2312 themed": "dark",
    "gb2312 text": "intact",
  },
});

/**
 * The production expectation, and the default: every proxied document themes
 * itself, a frameset gets its background and gutters, frames the proxy never
 * served get CSS-only theming, the filter layer stays in the outermost document
 * alone, and the single-document control behaves as it always did. A row that
 * stops matching here is a regression in the shipped behaviour.
 */
export const POST = Object.freeze({
  // The no-regression control: one document, behaviour unchanged by the
  // per-document delivery work.
  "single-document/dynamic/on": {
    "single-document controller": "injected",
    "single-document delivered": "yes",
    "single-document theming installed": "yes",
    "single-document themed": "dark",
    "single-document ink contrast": "ok",
  },
  "single-document/filter/on": {
    "single-document themed": "dark",
    "stacked filters": "none",
  },
  // F1: every proxied document themes itself. F2: the frameset's own gutters,
  // which the F2 trial proved only the `bordercolor` attribute repaints.
  "frameset-3/dynamic/on": {
    "frameset-3 controller": "injected",
    "frameset-3 delivered": "yes",
    "banner controller": "injected",
    "banner theming installed": "yes",
    "banner themed": "dark",
    "banner ink contrast": "ok",
    "menu controller": "injected",
    "menu theming installed": "yes",
    "menu themed": "dark",
    "menu ink contrast": "ok",
    "content controller": "injected",
    "content theming installed": "yes",
    "content themed": "dark",
    "content ink contrast": "ok",
    "frameset-3 gutter": "dark",
  },
  // Dark even before per-document delivery, because the root filter composites
  // over every frame (M2). No frame may filter as well, or content inverts twice.
  "frameset-3/filter/on": {
    "banner themed": "dark",
    "menu themed": "dark",
    "content themed": "dark",
    "stacked filters": "none",
  },
  "frameset-3/dynamicFilter/on": {
    "banner theming installed": "yes",
    "banner themed": "dark",
    "menu themed": "dark",
    "content themed": "dark",
    "frameset-3 gutter": "dark",
    "stacked filters": "none",
  },
  "frameset-nohead/dynamic/on": {
    "frameset-nohead controller": "injected",
    "menu theming installed": "yes",
    "menu themed": "dark",
    "content themed": "dark",
    "frameset-nohead gutter": "dark",
  },
  "nested-iframes/dynamic/on": {
    "nested-iframes themed": "dark",
    "nested-1 controller": "injected",
    "nested-1 theming installed": "yes",
    "nested-1 themed": "dark",
    "nested-2 theming installed": "yes",
    "nested-2 themed": "dark",
    "nested-3 theming installed": "yes",
    "nested-3 themed": "dark",
    "root walk": "ok",
  },
  // The same, with t95's `parent` override installed on the proxied root: M5
  // showed the walk stops on `p === w` there instead of on a cross-origin read.
  "nested-iframes/dynamic/on+shim": {
    "nested-1 theming installed": "yes",
    "nested-1 themed": "dark",
    "nested-2 themed": "dark",
    "nested-3 themed": "dark",
    "root walk": "ok",
  },
  "nested-iframes/filter/on": {
    "nested-1 themed": "dark",
    "nested-2 themed": "dark",
    "nested-3 themed": "dark",
    "stacked filters": "none",
  },
  // F3: the proxy never served these documents, so they get CSS-only theming
  // installed from their parent realm.
  "document-write/dynamic/on": {
    "document-write themed": "dark",
    "written-frame controller": "absent",
    "written-frame theming installed": "yes",
    "written-frame themed": "dark",
    "srcdoc-frame controller": "absent",
    "srcdoc-frame theming installed": "yes",
    "srcdoc-frame themed": "dark",
  },
  // M4 showed the engine already handles bgcolor/text/font colour, so these are
  // a no-regression pin for `dynamic`...
  "bgcolor-tables/dynamic/on": {
    "bgcolor-tables themed": "dark",
    "bgcolor cell": "dark",
    "bgcolor ink contrast": "ok",
    "body text attribute": "light on dark",
  },
  // ...and the engine-less path: without an engine `<font color>` keeps its
  // literal colour, and the page used to end up black on near-black (1.33:1).
  "bgcolor-tables/customCss/on": {
    "bgcolor-tables themed": "dark",
    "bgcolor ink contrast": "ok",
  },
  "gb2312/dynamic/on": {
    "gb2312 controller": "injected",
    "gb2312 themed": "dark",
  },
  // F7 is a separate task; this run only proves the byte-level insertion shape
  // keeps a gb2312 body readable while still injecting the controller.
  "gb2312-bytes/dynamic/on": {
    "gb2312 controller": "injected",
    "gb2312 themed": "dark",
    "gb2312 text": "intact",
  },
});

/**
 * Compare measured rows with one expectation table. A pinned check the run never
 * produced counts as a mismatch, so a silently dropped probe cannot pass.
 */
export function expectationMismatches(rows, table, annotate = null) {
  const problems = [];
  for (const row of rows) {
    if (row.check === "run completed" && row.outcome === "failed") {
      problems.push(`${row.run}: ${row.detail}`);
      continue;
    }
    const wanted = table[row.run]?.[row.check];
    if (wanted === undefined) continue;
    if (row.outcome === wanted) continue;
    const recorded = annotate?.[row.run]?.[row.check];
    const note =
      recorded === undefined
        ? ""
        : recorded === row.outcome
          ? " [exactly the pre-fix outcome: per-document delivery is gone]"
          : ` [NEW: the recorded pre-fix outcome was ${recorded}]`;
    problems.push(
      `${row.run} ${row.check}: expected ${wanted}, measured ${row.outcome} (${row.detail})${note}`,
    );
  }
  for (const [run, checks] of Object.entries(table)) {
    if (!rows.some((row) => row.run === run)) continue;
    for (const check of Object.keys(checks))
      if (!rows.some((row) => row.run === run && row.check === check))
        problems.push(`${run} ${check}: never measured`);
  }
  return problems;
}

/** Re-emit the measured outcomes as a table literal, for `--record`. */
export function recordTable(rows, template) {
  const out = {};
  for (const [run, checks] of Object.entries(template))
    for (const check of Object.keys(checks)) {
      const row = rows.find((item) => item.run === run && item.check === check);
      if (!row) continue;
      out[run] ??= {};
      out[run][check] = row.outcome;
    }
  return out;
}

// ── reporting (pure) ───────────────────────────────────────────────────────

export function renderTable(header, lines, { width = 44 } = {}) {
  const table = [
    header,
    ...lines.map((line) =>
      line.map((cell) =>
        String(cell ?? "")
          .replace(/\s+/gu, " ")
          .slice(0, width),
      ),
    ),
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

// ── harness ────────────────────────────────────────────────────────────────

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
const FIXTURE_DIR = "tests/fixtures/legacy-web-dark";
const APP_HOST = "localhost";
const VIEWPORT = { width: 1000, height: 760 };
const START_TIMEOUT_MS = 20000;
const APPLY_TIMEOUT_MS = 15000;
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");

export class DevTools {
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
  on(listener) {
    this.#listeners.add(listener);
  }
  close() {
    this.#socket.close();
  }
}

/**
 * The page side of the proxy, reproduced: the readiness IIFE with the REAL
 * dark-mode controller spliced in ahead of a stand-in automation client that
 * keeps production's delivery rules — the sender must be this document's own
 * `window.parent`, and the message identity must equal this document's own.
 * That pair is the whole bug: a child frame's parent is the proxied root, and
 * its identity is its own, so the app's message can never match.
 */
function readinessScript(run, identity, darkClientSource, shape) {
  const install = shape.installer
    ? `typeof ${shape.installer} === "function" ? ${shape.installer}() : ${shape.factory}()`
    : `${shape.factory}()`;
  const parentShim = run.parentShim
    ? `
try {
  if (window.parent !== window) {
    var crossOrigin = false;
    try { void window.parent.location.href; } catch (_) { crossOrigin = true; }
    if (crossOrigin)
      Object.defineProperty(window, "parent", { value: window, writable: true, configurable: true });
  }
} catch (_) {}`
    : "";
  return `<script>(function(){'use strict';var p=${scriptJson(identity)};
var u=new URL(location.href);
try {
  Object.defineProperty(window, "__sorngDocName", { value: ${scriptJson(identity.docName)}, configurable: true });
  var outermost = false;
  try { void window.parent.location.href; } catch (_) { outermost = true; }
  if (window.parent === window) outermost = true;
  Object.defineProperty(window, "__sorngProxyRoot", { value: outermost, configurable: true });
} catch (_) {}
function emit(type){p.type=type;p.url=u.href;try{window.parent.postMessage(p,'*');}catch(_){}}
${darkClientSource}
(function installHarnessAutomation(identity, cleanUrl){
  "use strict";
  var parentWindow = window.parent;
  if (parentWindow === window) return;
  var darkMode = null, closed = false;
  var state = { shape: ${scriptJson(shape.shape)}, delivered: false, applied: null, error: null };
  try { Object.defineProperty(window, "__sorngDark", { value: state, configurable: true }); } catch (_) { window.__sorngDark = state; }
  function matches(message) {
    return (
      message &&
      message.version === 1 &&
      message.type === "sorng_web_automation" &&
      message.sessionId === identity.sessionId &&
      message.documentToken === identity.documentToken &&
      message.documentSequence === identity.documentSequence &&
      message.navigationToken === identity.navigationToken &&
      message.url === cleanUrl &&
      typeof message.requestId === "string" &&
      /^[0-9a-f]{32}$/.test(message.requestId)
    );
  }
  function reply(request, origin, status, detail) {
    parentWindow.postMessage({
      type: "proxy_web_automation", version: 1,
      sessionId: identity.sessionId, documentToken: identity.documentToken,
      documentSequence: identity.documentSequence, navigationToken: identity.navigationToken,
      url: cleanUrl, requestId: request.requestId, status: status, detail: detail,
    }, origin);
  }
  function setDark(payload) {
    if (!darkMode) darkMode = ${install};
    return darkMode.set(payload);
  }
  window.addEventListener("message", function (event) {
    if (closed || event.source !== parentWindow || !event.origin || event.origin === "null" || !matches(event.data)) return;
    var request = event.data, payload = request.payload;
    if (request.action !== "dark") return;
    if (!payload || typeof payload.enabled !== "boolean") return;
    state.delivered = true;
    try {
      setDark(payload).then(function () {
        state.applied = true;
        reply(request, event.origin, "ok", null);
      }, function (error) {
        state.applied = false;
        state.error = String(error && error.message).slice(0, 220);
        reply(request, event.origin, "failed", state.error);
      });
    } catch (error) {
      state.applied = false;
      state.error = String(error && error.message).slice(0, 220);
      reply(request, event.origin, "failed", state.error);
    }
  });
  window.addEventListener("pagehide", function () {
    closed = true;
    if (darkMode) darkMode.dispose();
  });
})(p, u.href);
emit('proxy_document_start');${parentShim}
})();</script>`;
}

/** The app window: the only realm that ever posts the `dark` command. */
function appDocument(run) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>app window stand-in</title>
<style>html,body{margin:0;padding:0;height:100%;background:#ffffff;overflow:hidden}
iframe#website{position:fixed;left:0;top:0;width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;border:0;display:block}</style>
</head><body><script>
window.SORNG_APP_MARKER = "app-window-secret";
var state = { ready: null, replies: [], sent: null, messages: 0 };
window.__app = state;
var frame = document.createElement("iframe");
frame.id = "website";
frame.setAttribute("sandbox", ${scriptJson(run.sandbox)});
var PAYLOAD = ${scriptJson(run.payload)};
var REQUEST = ${scriptJson(run.requestId)};
function deliver() {
  if (state.sent || !state.ready) return;
  var doc = state.ready;
  state.sent = { at: Date.now(), url: doc.url };
  frame.contentWindow.postMessage({
    type: "sorng_web_automation", version: 1,
    sessionId: doc.sessionId, documentToken: doc.documentToken,
    documentSequence: doc.documentSequence, navigationToken: doc.navigationToken,
    url: doc.url, requestId: REQUEST, action: "dark", payload: PAYLOAD,
  }, new URL(doc.url).origin);
}
addEventListener("message", function (event) {
  if (event.source !== frame.contentWindow) return;
  state.messages++;
  var data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "proxy_document_start" && !state.ready) { state.ready = data; deliver(); }
  else if (data.type === "proxy_web_automation")
    state.replies.push({ status: data.status, detail: data.detail || null });
});
frame.src = ${scriptJson(run.frameUrl)};
document.body.appendChild(frame);
</script></body></html>`;
}

/**
 * Measure every same-origin document under the outermost proxied one. Returns
 * page-level coordinates for each swatch and frame box so the pixel probes can
 * sample them from one screenshot of the app window.
 */
const MEASURE = `(function () {
  var out = [];
  function styleOf(w, el) { try { return el ? w.getComputedStyle(el) : null; } catch (_) { return null; } }
  function opaque(color) { return !!color && color !== "transparent" && !/^rgba\\(.*,\\s*0\\s*\\)$/.test(color); }
  function effectiveBackground(w, el) {
    var node = el;
    while (node) {
      var s = styleOf(w, node);
      if (s && opaque(s.backgroundColor)) return s.backgroundColor;
      node = node.parentElement;
    }
    var root = styleOf(w, w.document.documentElement);
    return root ? root.backgroundColor : null;
  }
  function rootWalk(w) {
    var current = w, hops = 0, stopped = "cap";
    for (var depth = 0; depth < 32; depth++) {
      var up;
      try { up = current.parent; } catch (_) { stopped = "throw"; break; }
      if (!up || up === current) { stopped = "self"; break; }
      try { void up.location.href; } catch (_) { stopped = "cross-origin"; break; }
      current = up; hops++;
    }
    var landed = "?";
    try { landed = String(current.__sorngDocName); } catch (_) { landed = "unreadable"; }
    var isRoot = false;
    try { isRoot = current.__sorngProxyRoot === true; } catch (_) {}
    return { hops: hops, stopped: stopped, landed: landed, outermost: isRoot };
  }
  function visit(w, depth, offX, offY, name, frameRect) {
    if (out.length >= 48) return;
    var d;
    try { d = w.document; if (!d) throw new Error("no document"); }
    catch (error) {
      out.push({ name: name, depth: depth, reachable: false, note: String(error && error.name), frameRect: frameRect });
      return;
    }
    var rootStyle = styleOf(w, d.documentElement);
    var bodyStyle = styleOf(w, d.body);
    var swatch = d.getElementById("sorng-swatch");
    var ink = d.getElementById("sorng-ink");
    var cell = d.getElementById("sorng-cell");
    var logo = d.getElementById("sorng-logo");
    var cn = d.getElementById("sorng-cn");
    var inkStyle = styleOf(w, ink);
    var swatchRect = null;
    if (swatch) {
      var r = swatch.getBoundingClientRect();
      if (r.width > 2 && r.height > 2)
        swatchRect = { x: r.left + offX, y: r.top + offY, width: r.width, height: r.height };
    }
    var ours = d.querySelectorAll("style.sorng-website-dark-mode");
    var engineStyles = 0, nodes = d.querySelectorAll("style,link");
    for (var i = 0; i < nodes.length; i++)
      if (String(nodes[i].className || "").indexOf("darkreader") >= 0) engineStyles++;
    var dark = null;
    try { dark = w.__sorngDark || null; } catch (_) {}
    var entry = {
      name: name, depth: depth, reachable: true,
      doc: d.documentElement ? d.documentElement.getAttribute("data-doc") : null,
      url: String(d.URL).slice(0, 160),
      injected: !!dark,
      shape: dark ? dark.shape : null,
      delivered: dark ? !!dark.delivered : false,
      applied: dark ? dark.applied : null,
      error: dark ? dark.error : null,
      frameset: !!d.querySelector("frameset"),
      bodyless: d.body === null,
      bodyTag: d.body ? d.body.tagName : null,
      head: !!d.head,
      charset: d.characterSet,
      styleNodes: ours.length,
      styleMode: ours.length ? ours[0].getAttribute("data-mode") : null,
      styleText: ours.length ? String(ours[0].textContent).slice(0, 2000) : "",
      engineStyles: engineStyles,
      engine: typeof w.DarkReader,
      htmlBackground: rootStyle ? rootStyle.backgroundColor : null,
      htmlColor: rootStyle ? rootStyle.color : null,
      htmlFilter: rootStyle ? rootStyle.filter : null,
      bodyBackground: bodyStyle ? bodyStyle.backgroundColor : null,
      bodyColor: bodyStyle ? bodyStyle.color : null,
      swatchBackground: swatch ? effectiveBackground(w, swatch) : null,
      inkColor: inkStyle ? inkStyle.color : null,
      inkBackground: ink ? effectiveBackground(w, ink) : null,
      cellBackground: cell ? effectiveBackground(w, cell) : null,
      bodyBackgroundImage: bodyStyle ? String(bodyStyle.backgroundImage).slice(0, 80) : null,
      logoWidth: logo ? logo.naturalWidth : null,
      logoRect: null,
      text: cn ? String(cn.textContent).slice(0, 80) : null,
      swatchRect: swatchRect,
      frameRect: frameRect,
      rootWalk: rootWalk(w),
      frames: 0,
    };
    if (logo) {
      var lr = logo.getBoundingClientRect();
      if (lr.width > 2 && lr.height > 2)
        entry.logoRect = { x: lr.left + offX, y: lr.top + offY, width: lr.width, height: lr.height };
    }
    out.push(entry);
    var kids = d.querySelectorAll("iframe, frame");
    entry.frames = kids.length;
    for (var k = 0; k < kids.length && k < 12; k++) {
      var kid = kids[k];
      var label = kid.getAttribute("name") || kid.getAttribute("id") || ("frame" + k);
      var box = kid.getBoundingClientRect();
      var ks = styleOf(w, kid);
      var left = ks ? parseFloat(ks.borderLeftWidth) || 0 : 0;
      var top = ks ? parseFloat(ks.borderTopWidth) || 0 : 0;
      var rect = { x: box.left + offX, y: box.top + offY, width: box.width, height: box.height };
      var kw = null;
      try { kw = kid.contentWindow; } catch (_) {}
      if (!kw) {
        out.push({ name: name + "/" + label, depth: depth + 1, reachable: false, note: "no contentWindow", frameRect: rect });
        continue;
      }
      visit(kw, depth + 1, offX + box.left + left, offY + box.top + top, name + "/" + label, rect);
    }
  }
  visit(window, 0, 0, 0, "top", null);
  return JSON.stringify(out);
})()`;

/** M2: does a root-document inversion composite over child frame content? */
const FILTER_PROBE = `(function(){
  document.documentElement.style.setProperty("filter", "invert(100%) hue-rotate(180deg)", "important");
  return "applied";
})()`;
const FILTER_UNDO = `(function(){
  document.documentElement.style.removeProperty("filter");
  return "removed";
})()`;
/**
 * The F2 trial, in two steps, to keep it visible which lever repaints the
 * inter-frame gutters: CSS on `html`/`frameset`, then the `bordercolor`
 * presentational attribute the engine paints frameset borders from.
 */
const FRAMESET_BACKGROUND_CSS = `(function(){
  var style = document.createElement("style");
  style.className = "sorng-harness-frameset-probe";
  style.textContent = "html,frameset{background-color:#181a1b !important}frameset,frame{border-color:#181a1b !important}";
  (document.head || document.documentElement).appendChild(style);
  return JSON.stringify({
    head: !!document.head,
    bodyTag: document.body ? document.body.tagName : "null",
    frames: document.querySelectorAll("frameset").length,
  });
})()`;
const FRAMESET_BORDERCOLOR_PROBE = `(function(){
  var sets = document.querySelectorAll("frameset");
  for (var i = 0; i < sets.length; i++) sets[i].setAttribute("bordercolor", "#181a1b");
  return JSON.stringify({ framesets: sets.length });
})()`;
/** M3: what the engine does when asked to convert a body-less frameset. */
const FRAMESET_ENGINE_PROBE = `(function(){
  function load() {
    if (window.DarkReader) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = location.origin + ${scriptJson(DARKREADER_URL_PATH)};
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("the engine asset did not load")); };
      (document.head || document.documentElement).appendChild(script);
    });
  }
  return load().then(function () {
    var result = { engine: typeof window.DarkReader, head: !!document.head, body: document.body === null ? "null" : "present" };
    try {
      window.DarkReader.enable({ mode: 1, darkSchemeBackgroundColor: "#181a1b", darkSchemeTextColor: "#e8e6e3" }, { ignoreImageAnalysis: [] });
      result.enable = "returned";
    } catch (error) {
      result.enable = "threw " + ((error && error.name) || "Error") + ": " + String(error && error.message).slice(0, 160);
    }
    result.engineStyles = document.querySelectorAll('style[class*="darkreader"]').length;
    result.htmlBackground = getComputedStyle(document.documentElement).backgroundColor;
    return JSON.stringify(result);
  }, function (error) {
    return JSON.stringify({ engine: "unavailable", enable: "not attempted", error: String(error && error.message) });
  });
})()`;

async function readFixtures(root) {
  const directory = path.join(root, FIXTURE_DIR);
  const names = [
    "frameset-3.html",
    "frameset-nohead.html",
    "banner.html",
    "menu.html",
    "content.html",
    "nested-iframes.html",
    "nested-1.html",
    "nested-2.html",
    "nested-3.html",
    "document-write.html",
    "gb2312.html",
    "bgcolor-tables.html",
    "single-document.html",
    "legacy-logo.gif",
  ];
  const files = new Map();
  for (const name of names) {
    const body = await readFile(path.join(directory, name)).catch(() => null);
    if (!body)
      throw new HarnessSetupError(`Missing fixture ${FIXTURE_DIR}/${name}`);
    files.set(name, body);
  }
  return files;
}

/** Fold one run's measured documents into pinnable rows. */
function summarise(run, documents, image, probes) {
  const rows = [];
  const push = (check, outcome, detail) =>
    rows.push({ run: run.id, check, outcome, detail: detail ?? "" });
  const pixel = (rect) => (image && rect ? meanColor(image, rect) : null);
  const reached = documents.filter((entry) => entry.reachable);
  push(
    "documents reached",
    String(reached.length),
    documents
      .map(
        (entry) =>
          `${entry.doc ?? entry.name}${entry.reachable ? "" : ` (${entry.note})`}`,
      )
      .join(", "),
  );
  // A frameset document paints no content of its own: what the user sees of it
  // is the gutter between its frames, so that is its background.
  const framesetDoc = reached.find((entry) => entry.frameset);
  let gutterColour = null;
  if (framesetDoc) {
    const boxes = reached
      .filter(
        (entry) => entry.frameRect && entry.depth === framesetDoc.depth + 1,
      )
      .map((entry) => entry.frameRect)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    gutterColour = pixel(gutterBetween(boxes[0], boxes[1]));
  }
  const opaque = (color) => {
    const parsed = parseColor(color);
    return parsed && parsed.a > 0 ? color : null;
  };
  for (const entry of reached) {
    const label = entry.doc ?? entry.name;
    entry.label = label;
    entry.pixel =
      pixel(entry.swatchRect) ?? (entry === framesetDoc ? gutterColour : null);
    entry.effective =
      entry.pixel ??
      opaque(entry.swatchBackground) ??
      opaque(entry.bodyBackground) ??
      opaque(entry.htmlBackground);
    push(
      `${label} controller`,
      entry.injected ? "injected" : "absent",
      `${entry.url} charset=${entry.charset}${entry.frameset ? " frameset" : ""} document.body=${entry.bodyTag ?? "null"} head=${entry.head}`,
    );
    if (entry.injected)
      push(
        `${label} delivered`,
        entry.delivered ? "yes" : "no",
        `shape=${entry.shape}`,
      );
    // Evidence, not the message path: a child document themes itself from the
    // root-realm registry and is never sent a `dark` message of its own.
    push(
      `${label} theming installed`,
      entry.error
        ? "error"
        : entry.styleNodes || entry.engineStyles
          ? "yes"
          : "no",
      `${entry.error ? `${entry.error}; ` : ""}told=${entry.delivered ? "yes" : "no"} acked=${entry.applied} own=${entry.styleNodes} engine=${entry.engineStyles} DarkReader=${entry.engine}`,
    );
    const state = darkness(entry.effective);
    push(
      `${label} themed`,
      entry.effective ? state.outcome : "unknown",
      `background=${entry.effective ?? "n/a"}${
        state.luminance === null
          ? ""
          : ` luminance=${state.luminance.toFixed(3)}`
      }${entry.pixel ? " (pixel)" : " (computed)"} filter=${entry.htmlFilter ?? "none"}`,
    );
    const ratio = contrastRatio(entry.inkColor, entry.inkBackground);
    if (ratio !== null)
      push(
        `${label} ink contrast`,
        ratio >= 4.5 ? "ok" : "low",
        `${ratio.toFixed(2)}:1 ${entry.inkColor} on ${entry.inkBackground}`,
      );
  }

  if (framesetDoc)
    push(
      `${framesetDoc.label} gutter`,
      gutterColour ? darkness(gutterColour).outcome : "unknown",
      gutterColour
        ? `${gutterColour} between the first two frames`
        : "no measurable gutter",
    );

  // Legacy colour attributes (M4): the cell keeps its bgcolor unless something
  // overrides a presentational attribute the engine does not treat as a style.
  const legacy = reached.find((entry) => entry.cellBackground);
  if (legacy) {
    push(
      "bgcolor cell",
      darkness(legacy.cellBackground).outcome,
      `td[bgcolor] computed ${legacy.cellBackground}`,
    );
    const ratio = contrastRatio(legacy.inkColor, legacy.inkBackground);
    push(
      "bgcolor ink contrast",
      ratio === null ? "unknown" : ratio >= 4.5 ? "ok" : "low",
      ratio === null
        ? ""
        : `${ratio.toFixed(2)}:1 ${legacy.inkColor} on ${legacy.inkBackground}`,
    );
    const bodyDark = darkness(legacy.bodyBackground).outcome === "dark";
    const textDark = darkness(legacy.bodyColor).outcome === "dark";
    push(
      "body text attribute",
      bodyDark && !textDark
        ? "light on dark"
        : !bodyDark && textDark
          ? "dark on light"
          : "unreadable",
      `body[text] computed ${legacy.bodyColor} on ${legacy.bodyBackground}`,
    );
    push(
      "body background attribute",
      String(legacy.bodyBackgroundImage).includes("legacy-logo.gif")
        ? "tiled"
        : "removed",
      String(legacy.bodyBackgroundImage),
    );
    const logo = pixel(legacy.logoRect);
    push(
      "logo rendering",
      legacy.logoWidth ? darkness(logo).outcome : "not decoded",
      `naturalWidth=${legacy.logoWidth} mean=${logo ?? "n/a"}`,
    );
  }

  // Non-UTF-8 bodies (H5/F7).
  const chinese = reached.find((entry) => entry.text !== null);
  if (chinese)
    push(
      "gb2312 text",
      /\uFFFD/u.test(chinese.text)
        ? "mojibake"
        : chinese.text.includes("\u4e2d\u6587")
          ? "intact"
          : "unexpected",
      `${JSON.stringify(chinese.text)} charset=${chinese.charset}`,
    );

  // M5: every document's same-origin walk must land on the outermost proxied one.
  const walks = reached.filter((entry) => entry.injected && entry.depth > 0);
  if (walks.length) {
    const wrong = walks.filter((entry) => !entry.rootWalk.outermost);
    push(
      "root walk",
      wrong.length ? "wrong" : "ok",
      walks
        .map(
          (entry) =>
            `${entry.label}@${entry.depth}: ${entry.rootWalk.hops} hops -> ${entry.rootWalk.landed} (stopped on ${entry.rootWalk.stopped})`,
        )
        .join(" | "),
    );
  }

  // M2 proved a root filter composites over child frame content, so a filtered
  // document nested inside another filtered one is adjusted twice.
  const filtered = reached.filter(
    (entry) => entry.htmlFilter && entry.htmlFilter !== "none",
  );
  if (filtered.length)
    push(
      "stacked filters",
      filtered.some((entry) =>
        filtered.some(
          (other) => other !== entry && entry.name.startsWith(`${other.name}/`),
        ),
      )
        ? "stacked"
        : "none",
      filtered
        .map((entry) => `${entry.label}: ${entry.htmlFilter}`)
        .join(" | "),
    );

  for (const [check, outcome, detail] of probes.rows ?? [])
    push(check, outcome, detail);
  return rows;
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      expect: { type: "string", default: "post" },
      only: { type: "string" },
      list: { type: "boolean", default: false },
      record: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      json: { type: "string" },
    },
  });
  if (!["post", "pre", "none"].includes(options.expect)) {
    console.error("--expect must be post, pre or none");
    return 2;
  }
  const root = repoRoot();
  const executable = EDGE.find(existsSync);
  if (!executable) {
    console.error(
      "This probe needs an existing installed Edge; no browser is downloaded.",
    );
    return 2;
  }
  let tokens;
  let shape;
  let darkClientSource;
  let engineSource;
  let fixtures;
  try {
    tokens = parseSandboxTokens(
      await readFile(path.join(root, SANDBOX_SOURCE_PATH), "utf8"),
    );
    darkClientSource = (
      await readFile(path.join(root, DARK_CLIENT_PATH), "utf8")
    ).replace(/\r\n/gu, "\n");
    shape = parseDarkClientShape(darkClientSource);
    const problems = injectionOrderProblems(
      await readFile(path.join(root, INJECTION_SOURCE_PATH), "utf8"),
    );
    if (problems.length)
      throw new HarnessSetupError(
        `The readiness injection drifted: ${problems.join("; ")}; update this mirror.`,
      );
    engineSource = await readFile(path.join(root, DARKREADER_ASSET_PATH));
    fixtures = await readFixtures(root);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  let runs;
  try {
    runs = selectRuns(options.only).map((scenario) => ({ ...scenario }));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (options.list) {
    for (const run of runs) console.log(`${run.id}  ${run.summary}`);
    return 0;
  }

  const sockets = new Set();
  const byHost = new Map();
  let sequence = 0;
  const server = createServer((request, response) => {
    const host = String(request.headers.host || "").split(":")[0];
    const url = new URL(request.url, `http://${request.headers.host}`);
    const send = (status, type, body, extra = {}) =>
      response
        .writeHead(status, {
          "Content-Type": type,
          "Cache-Control": "no-store",
          ...extra,
        })
        .end(body);
    if (url.pathname === "/favicon.ico")
      return void response.writeHead(204).end();
    if (host === APP_HOST) {
      const run = byHost.get(url.searchParams.get("run") ?? "");
      if (url.pathname !== "/outer" || !run)
        return void send(404, "text/plain", "unknown run");
      // Mirrors tauri.conf.json: the app document may frame *.localhost.
      return void send(200, "text/html", appDocument(run), {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src http://*.localhost:*; object-src 'none'; frame-ancestors 'none'",
      });
    }
    const run = byHost.get(host);
    if (!run) return void send(404, "text/plain", "unknown proxy authority");
    if (url.pathname === DARKREADER_URL_PATH)
      return void send(
        200,
        "application/javascript; charset=utf-8",
        engineSource,
        {
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      );
    const name = url.pathname.replace(/^\//u, "") || run.fixture;
    const file = fixtures.get(name);
    if (!file) return void send(404, "text/plain", "no such fixture");
    if (name.endsWith(".gif")) return void send(200, "image/gif", file);
    // Every proxied document is injected, root and frame alike: the product
    // accepts sec-fetch-dest document, iframe and frame (http_response.rs).
    const charset = name === "gb2312.html" ? (run.charset ?? "utf-8") : "utf-8";
    const body =
      charset === "gb2312" ? encodeGb2312(file.toString("utf8")) : file;
    sequence += 1;
    const identity = {
      version: 1,
      sessionId: run.sessionId,
      navigationToken: null,
      documentToken: randomBytes(16).toString("hex"),
      documentSequence: sequence,
      docName: name.replace(/\.html$/u, ""),
    };
    const script = readinessScript(run, identity, darkClientSource, shape);
    return void send(
      200,
      `text/html; charset=${charset}`,
      injectDocument(body, script, run.injection ?? "lossy"),
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const profile = await mkdtemp(path.join(tmpdir(), "sorng-web-dark-"));
  const browserTemp = path.join(profile, "temp");
  await mkdir(browserTemp);
  let browser;
  let exited;
  let devtools;
  const rows = [];
  const notes = [];
  const details = [];
  let product = "unknown";
  let failed = 0;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
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
        "--force-device-scale-factor=1",
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
    ({ product } = await devtools.send("Browser.getVersion"));
    console.log(
      `${product}: ${runs.length} runs, dark-mode client shape "${shape.shape}"${
        shape.installer ? ` (eager install: ${shape.installer}())` : ""
      }, sandbox "${tokens.proxy}"`,
    );
    if (shape.shape === "legacy" && options.expect === "post")
      console.log(
        `${DARK_CLIENT_PATH} no longer calls an eager per-document install as its\n` +
          "last statement, so only the outermost document can theme itself; expect\n" +
          "every per-frame check below to fail.",
      );

    const attached = [];
    const logs = [];
    devtools.on((method, params, sessionId) => {
      if (method === "Target.targetInfoChanged") {
        const known = attached.find(
          (target) => target.targetId === params.targetInfo.targetId,
        );
        if (known) Object.assign(known, params.targetInfo);
      } else if (method === "Target.attachedToTarget") {
        attached.push({ ...params.targetInfo, sessionId: params.sessionId });
        for (const call of ["Runtime.enable", "Page.enable", "Log.enable"])
          devtools.send(call, {}, params.sessionId, 8000).catch(() => {});
        devtools
          .send(
            "Target.setAutoAttach",
            { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
            params.sessionId,
            8000,
          )
          .catch(() => {});
      } else if (method === "Log.entryAdded")
        logs.push(
          `${params.entry.source}/${params.entry.level}: ${params.entry.text}`.slice(
            0,
            220,
          ),
        );
      else if (method === "Runtime.exceptionThrown")
        logs.push(
          `exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`.slice(
            0,
            220,
          ),
        );
      else if (method === "Inspector.targetCrashed")
        logs.push("renderer crashed");
    });

    for (const run of runs) {
      const hex = randomBytes(16).toString("hex");
      Object.assign(run, {
        runId: randomUUID(),
        sessionId: randomBytes(16).toString("hex"),
        requestId: randomBytes(16).toString("hex"),
        sandbox: tokens.proxy,
        payload: {
          enabled: run.enabled,
          theme: { ...THEME_DEFAULTS, ...run.theme },
        },
      });
      run.proxyOrigin = `http://${proxyHost(hex)}:${port}`;
      run.frameUrl = `${run.proxyOrigin}/${run.fixture}`;
      byHost.set(hex ? proxyHost(hex) : "", run);
      byHost.set(proxyHost(hex), run);
      byHost.set(run.runId, run);
      attached.length = 0;
      logs.length = 0;
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
        for (const call of ["Runtime.enable", "Page.enable", "Log.enable"])
          await devtools.send(call, {}, sessionId);
        await devtools.send(
          "Emulation.setDeviceMetricsOverride",
          { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
          sessionId,
        );
        await devtools.send(
          "Target.setAutoAttach",
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
          sessionId,
        );
        await devtools.send(
          "Page.navigate",
          {
            url: `http://${APP_HOST}:${port}/outer?run=${encodeURIComponent(run.runId)}`,
          },
          sessionId,
        );
        // The proxied root is cross-origin to the app document, so it gets its
        // own target; its same-origin descendants share that target's realm.
        let frameSession;
        for (let waited = 0; !frameSession && waited < 15000; waited += 100) {
          frameSession = (
            attached.find(
              (target) =>
                target.type === "iframe" &&
                String(target.url).startsWith(run.proxyOrigin),
            ) ?? attached.find((target) => target.type === "iframe")
          )?.sessionId;
          if (!frameSession) await delay(100);
        }
        if (!frameSession)
          throw new Error(
            `the proxied document never became its own target (attached: ${
              attached
                .map((target) => `${target.type}@${target.url}`)
                .join(", ") || "nothing"
            }; app page: ${await devtools
              .send(
                "Runtime.evaluate",
                {
                  expression:
                    "location.href + ' frames=' + frames.length + ' src=' + (document.querySelector('iframe')||{}).src",
                  returnByValue: true,
                },
                sessionId,
                8000,
              )
              .then((result) => result.result.value)
              .catch((error) => error.message)})`,
          );
        const evaluate = (expression, awaitPromise = false) =>
          devtools
            .send(
              "Runtime.evaluate",
              { expression, returnByValue: true, awaitPromise },
              frameSession,
              25000,
            )
            .then((result) =>
              result.exceptionDetails
                ? `{"error":${JSON.stringify(String(result.exceptionDetails.text))}}`
                : result.result.value,
            );
        // Give the frame tree time to load, then wait for the command to settle.
        await delay(900);
        for (let waited = 0; waited < APPLY_TIMEOUT_MS; waited += 200) {
          const state = await evaluate(
            "JSON.stringify((window.__sorngDark || {}))",
          ).catch(() => "{}");
          const parsed = JSON.parse(state || "{}");
          if (parsed.applied !== null && parsed.applied !== undefined) break;
          await delay(200);
        }
        await delay(900);
        const measured = JSON.parse(await evaluate(MEASURE));
        const screenshot = await devtools
          .send("Page.captureScreenshot", { format: "png" }, sessionId, 20000)
          .then((result) => decodePng(Buffer.from(result.data, "base64")))
          .catch((error) => {
            notes.push(`${run.id}: screenshot unavailable (${error.message})`);
            return null;
          });
        const probes = { rows: [] };
        const wanted = run.probes ?? [];
        if (wanted.includes("filter-composite") && screenshot) {
          const child = measured.find(
            (entry) => entry.depth > 0 && entry.reachable && entry.swatchRect,
          );
          const before = child ? meanColor(screenshot, child.swatchRect) : null;
          await evaluate(FILTER_PROBE);
          await delay(300);
          const after = await devtools
            .send("Page.captureScreenshot", { format: "png" }, sessionId, 20000)
            .then((result) => decodePng(Buffer.from(result.data, "base64")))
            .catch(() => null);
          const sampled =
            child && after ? meanColor(after, child.swatchRect) : null;
          probes.filterComposites = Boolean(
            before && sampled && before !== sampled,
          );
          probes.rows.push([
            "M2 root filter reaches frames",
            !before || !sampled
              ? "unknown"
              : before === sampled
                ? "root only"
                : "composites",
            `${child?.doc ?? "?"} swatch ${before} -> ${sampled}`,
          ]);
          await evaluate(FILTER_UNDO);
          await delay(200);
        }
        if (wanted.includes("frameset-background")) {
          const framesetDoc = measured.find(
            (entry) => entry.reachable && entry.frameset,
          );
          const boxes = measured
            .filter(
              (entry) =>
                entry.frameRect &&
                entry.depth === (framesetDoc?.depth ?? 0) + 1,
            )
            .map((entry) => entry.frameRect)
            .sort((a, b) => a.y - b.y || a.x - b.x);
          const gutter = gutterBetween(boxes[0], boxes[1]);
          const before =
            screenshot && gutter ? meanColor(screenshot, gutter) : null;
          const shot = async () =>
            devtools
              .send(
                "Page.captureScreenshot",
                { format: "png" },
                sessionId,
                20000,
              )
              .then((result) => decodePng(Buffer.from(result.data, "base64")))
              .catch(() => null);
          const styled = await evaluate(FRAMESET_BACKGROUND_CSS);
          await delay(300);
          const afterCss = await shot();
          const cssColour =
            afterCss && gutter ? meanColor(afterCss, gutter) : null;
          probes.rows.push([
            "F2 frameset background by CSS",
            !cssColour ? "unknown" : darkness(cssColour).outcome,
            `${styled} gutter ${before} -> ${cssColour}`,
          ]);
          const attributed = await evaluate(FRAMESET_BORDERCOLOR_PROBE);
          await delay(300);
          const afterAttribute = await shot();
          const attributeColour =
            afterAttribute && gutter ? meanColor(afterAttribute, gutter) : null;
          probes.rows.push([
            "F2 frameset gutter by bordercolor",
            !attributeColour ? "unknown" : darkness(attributeColour).outcome,
            `${attributed} gutter ${cssColour} -> ${attributeColour}`,
          ]);
        }
        if (wanted.includes("frameset-engine")) {
          const result = await evaluate(FRAMESET_ENGINE_PROBE, true);
          const parsed = JSON.parse(result || "{}");
          probes.rows.push([
            "M3 engine on a body-less frameset",
            String(parsed.enable ?? "unknown").startsWith("threw")
              ? "throws"
              : Number(parsed.engineStyles) > 0
                ? "converts"
                : "no-op",
            `engine=${parsed.engine} head=${parsed.head} body=${parsed.body} enable=${parsed.enable} styles=${parsed.engineStyles} html=${parsed.htmlBackground}`,
          ]);
        }
        const appState = await devtools
          .send(
            "Runtime.evaluate",
            { expression: "JSON.stringify(window.__app)", returnByValue: true },
            sessionId,
            10000,
          )
          .then((result) => JSON.parse(result.result.value ?? "{}"))
          .catch(() => ({}));
        probes.rows.push([
          "app acknowledgement",
          appState.replies?.length
            ? appState.replies.map((reply) => reply.status).join(",")
            : "none",
          `sent=${appState.sent ? "yes" : "no"} replies=${JSON.stringify(appState.replies ?? [])}`,
        ]);
        const insertion = earlyScriptInsertion(
          fixtures.get(run.fixture).toString("utf8"),
        );
        probes.rows.push([
          "M1 readiness script ran",
          measured[0]?.injected ? "yes" : "no",
          `insertion offset ${insertion} of ${fixtures.get(run.fixture).length} bytes, after ${JSON.stringify(
            fixtures
              .get(run.fixture)
              .toString("utf8")
              .slice(Math.max(0, insertion - 24), insertion),
          )}`,
        ]);
        rows.push(...summarise(run, measured, screenshot, probes));
        details.push({ run: run.id, documents: measured });
        for (const line of logs) notes.push(`${run.id}  ${line}`);
      } catch (error) {
        rows.push({
          run: run.id,
          check: "run completed",
          outcome: "failed",
          detail: error.message,
        });
      } finally {
        if (targetId)
          await devtools
            .send("Target.closeTarget", { targetId }, undefined, 8000)
            .catch(() => {});
      }
    }

    const perDocument = [];
    for (const { run, documents } of details)
      for (const entry of documents)
        perDocument.push([
          run,
          `${"  ".repeat(entry.depth)}${entry.doc ?? entry.name}`,
          entry.reachable ? (entry.injected ? "injected" : "none") : "-",
          entry.reachable
            ? entry.delivered
              ? "yes"
              : "no"
            : (entry.note ?? "-"),
          entry.reachable
            ? entry.error
              ? "error"
              : entry.styleNodes || entry.engineStyles
                ? "yes"
                : "no"
            : "-",
          entry.effective ?? "-",
          entry.effective ? darkness(entry.effective).outcome : "-",
          entry.styleNodes ? `${entry.styleNodes}x${entry.styleMode}` : "-",
          entry.engineStyles || "-",
        ]);
    console.log(
      `\n${renderTable(
        [
          "run",
          "document",
          "controller",
          "told",
          "themed itself",
          "background",
          "state",
          "own css",
          "engine css",
        ],
        perDocument,
        { width: 30 },
      )}\n`,
    );
    const measurements = rows.filter((row) => /^(M\d|F2) /u.test(row.check));
    if (measurements.length) {
      console.log(
        "Structural measurements (M1-M5 and the F2 trial; see the file header):",
      );
      console.log(
        renderTable(
          ["run", "measurement", "outcome", "detail"],
          measurements.map((row) => [
            row.run,
            row.check,
            row.outcome,
            row.detail,
          ]),
          { width: 96 },
        ),
      );
      console.log("");
    }
    const walkRows = rows.filter((row) => row.check === "root walk");
    if (walkRows.length) {
      console.log("M5 same-origin root walk:");
      for (const row of walkRows)
        console.log(`  ${row.run}: ${row.outcome} - ${row.detail}`);
      console.log("");
    }
    if (options.verbose) {
      console.log("Every measured check:");
      console.log(
        renderTable(
          ["run", "check", "outcome", "detail"],
          rows.map((row) => [row.run, row.check, row.outcome, row.detail]),
          { width: 110 },
        ),
      );
      console.log("");
      if (notes.length) {
        console.log("Engine messages:");
        for (const line of notes) console.log(`  ${line}`);
        console.log("");
      }
    }
    if (options.record) {
      console.log(
        "Measured outcomes for the pinned checks (paste into POST once the\n" +
          "change that moved them has been reviewed):",
      );
      console.log(JSON.stringify(recordTable(rows, POST), null, 2));
      console.log("");
    }
    if (options.expect !== "none") {
      const table = options.expect === "pre" ? PRE : POST;
      const mismatches = expectationMismatches(
        rows,
        table,
        options.expect === "post" ? PRE : null,
      );
      failed += mismatches.length;
      if (mismatches.length) {
        console.log(
          options.expect === "post"
            ? `Regression against the production expectation (${mismatches.length}):`
            : `Drift from the recorded pre-fix baseline (${mismatches.length}):`,
        );
        for (const line of mismatches) console.log(`  x ${line}`);
        if (options.expect === "post")
          console.log(
            "\nRe-run with --only=<scenario> --verbose to see every measured check,\n" +
              "and with --expect=pre to see what the pre-fix bug looked like.",
          );
      } else
        console.log(
          `Every pinned check matched the "${options.expect}" expectation.`,
        );
    }
    if (options.json)
      await writeFile(
        path.resolve(root, options.json),
        `${JSON.stringify({ product, shape, rows, details, notes }, null, 2)}\n`,
        "utf8",
      );
  } catch (error) {
    console.error(`The probe could not run: ${error.stack ?? error.message}`);
    failed = Math.max(failed, 1);
  } finally {
    if (devtools) {
      await devtools.send("Browser.close", {}, undefined, 8000).catch(() => {});
      devtools.close();
    }
    if (browser?.pid) {
      const stopped = await Promise.race([exited, delay(5000, false)]);
      if (stopped === false && browser.exitCode === null) {
        const stop = spawn(
          "taskkill.exe",
          ["/PID", String(browser.pid), "/T", "/F"],
          {
            windowsHide: true,
            stdio: "ignore",
          },
        );
        await new Promise((resolve) => stop.once("exit", resolve));
        await exited;
      }
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (
      path.dirname(profile) === path.resolve(tmpdir()) &&
      path.basename(profile).startsWith("sorng-web-dark-")
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
