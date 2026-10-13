#!/usr/bin/env node
// Captures the form skeleton of one login page for the login fixture corpus
// (tests/fixtures/logins/README.md): the tags and attributes of forms, fields,
// buttons and frames, with their ancestors. It never signs in.
//
//   node scripts/capture-login-page.mjs --id <application>
//   node scripts/capture-login-page.mjs --id <application> --from-file <saved.html>
//   node scripts/capture-login-page.mjs --resanitize <capture.json | corpus directory>
//   node scripts/capture-login-page.mjs --list
//
// Hosted mode renders the application's catalog `hostedLoginUrl`, and nothing
// else, once, in an installed headless Edge with a temporary profile that is
// deleted afterwards. Every connection the browser makes goes through a local
// guard that refuses private, loopback and link-local addresses. `--from-file`
// parses a page the user saved, without running its scripts or loading
// anything. In both modes the tool sends no keyboard or pointer input and
// activates no control, and the written skeleton holds no page text, field
// value, URL query, inline handler, script or style body, or browser state.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { BlockList, connect as netConnect, isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const CAPTURE_SCHEMA = "sorng-login-capture/1";
const repo = fileURLToPath(new URL("..", import.meta.url));
const CATALOG_PATH = "src/utils/protocol/originBrowserApplicationTargets.json";
const CORPUS_PATH = "tests/fixtures/logins";
const PROFILE_PREFIX = "sorng-login-capture-";
const APPLICATION_ID = /^[a-z][A-Za-z0-9-]{0,63}$/u;
const LIMITS = {
  maxNodes: 3000,
  maxFrames: 16,
  maxAttributes: 48,
  maxValue: 256,
  maxSavedBytes: 8 * 1024 * 1024,
};
const START_TIMEOUT_MS = 20000;
const LOAD_TIMEOUT_MS = 30000;
// A page is loaded once, so the script-rendered ones get time to finish.
const DEFAULT_SETTLE_MS = 6000;
const MAX_SETTLE_MS = 20000;

const USAGE = `Usage:
  node scripts/capture-login-page.mjs --id <application> [--url <hostedLoginUrl>]
       [--out <file.json>] [--fixture <file.html>] [--settle-ms <0-${MAX_SETTLE_MS}>]
  node scripts/capture-login-page.mjs --id <application> --from-file <saved.html>
       [--out <file.json>] [--fixture <file.html>]
  node scripts/capture-login-page.mjs --resanitize <capture.json | corpus directory>
       [--update-evidence]
  node scripts/capture-login-page.mjs --list

--id         a catalog application id; its hostedLoginUrl is the only page loaded
--url        optional cross-check; must equal that hostedLoginUrl exactly
--from-file  a page saved as HTML; parsed offline, nothing is loaded
--out        default ${CORPUS_PATH}/<application>/capture.json; never overwritten
--fixture    also write a synthetic fixture draft built from the skeleton
--resanitize rewrite existing captures under the current rules; loads nothing
--update-evidence  with --resanitize: put the new captureSha256 into evidence.json
--list       print the applications that have a hostedLoginUrl

Exit status: 0 written. 2 nothing was sent to the site (a refusal, or the run
failed before the site was reached); it may be repeated once the cause is
removed. 1 the site was reached and the run failed: that was the one load.
3 a run that requests no page (--from-file, --resanitize, --list) failed.`;

/** A request the tool will not carry out. Nothing was loaded. */
export class CaptureRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaptureRefusal";
    this.code = code;
  }
}

/**
 * A capture that started and did not finish. `loadAttempted` says whether the
 * guard had opened a connection to the site by then: that, and nothing else,
 * decides whether the run was the one load of the page.
 */
export class CaptureFailure extends Error {
  constructor(message, { loadAttempted, written = null }) {
    super(message);
    this.name = "CaptureFailure";
    this.loadAttempted = loadAttempted;
    // The capture file, when the run failed only after writing it.
    this.written = written;
  }
}

/**
 * A run that requests no page (`--from-file`, `--resanitize`, `--list`) and
 * failed. It says nothing about the one load of any page.
 */
export class OfflineFailure extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "OfflineFailure";
  }
}

/** Whether the guard reached the host and port of `url` (`contacted` lists `host:port`). */
export function loadWasAttempted(url, contacted) {
  const { hostname, port, protocol } = new URL(url);
  const target = `${hostname}:${port || (protocol === "https:" ? 443 : 80)}`;
  return contacted.includes(target);
}

const NOT_THE_LOAD =
  "Nothing was sent to the site. This run does not count as the one load of the page: " +
  "remove the cause and run the command once more.";
const THE_LOAD =
  "This was the one load for this page. Do not run it again: record the failure " +
  "in evidence.json and work from other material.";
const LOADED_AND_KEPT =
  "This was the one load for this page. Do not run it again: use the capture " +
  "that was written.";

const NO_PAGE =
  "No page was requested: this mode reads and writes files only. Nothing here " +
  "counts as the one load of any page; remove the cause and run it again.";

/**
 * Exit status: 0 done; 2 nothing was sent to the site (a refusal, or a run
 * that failed before the guard reached the site), so it may be repeated; 1 the
 * site was reached and the run failed, which was the one load; 3 a run that
 * requests no page failed. The command classifies every error it lets out; an
 * error nothing classified is counted as a load, never as a free retry.
 */
export function exitCodeFor(error) {
  if (error instanceof CaptureRefusal) return 2;
  if (error instanceof OfflineFailure) return 3;
  return error instanceof CaptureFailure && !error.loadAttempted ? 2 : 1;
}

/** What the command prints for a run that did not write a capture. */
export function describeOutcome(error) {
  if (error instanceof OfflineFailure)
    return `Failed: ${error.message}\n${NO_PAGE}`;
  if (error instanceof CaptureRefusal) {
    if (error.code === "usage") return error.message;
    // A name that did not resolve may resolve next time; every other refusal
    // would only be repeated.
    return `Refused: ${error.message}\n${
      error.code === "unresolved-host"
        ? NOT_THE_LOAD
        : "Nothing was sent to the site."
    }`;
  }
  if (error instanceof CaptureFailure && !error.loadAttempted)
    return `Capture did not start: ${error.message}\n${NOT_THE_LOAD}`;
  if (error instanceof CaptureFailure && error.written)
    return `The capture was written to ${error.written}, and the run then failed: ${error.message}\n${LOADED_AND_KEPT}`;
  return `Capture failed after the page was requested: ${error?.message ?? error}\n${THE_LOAD}`;
}

// ---------------------------------------------------------------- targets

/** Application id -> reviewed `hostedLoginUrl`, from the bundled catalog. */
export function loadCatalogTargets(root = repo) {
  const { profiles } = JSON.parse(
    readFileSync(path.join(root, CATALOG_PATH), "utf8"),
  );
  const targets = new Map();
  for (const [id, profile] of Object.entries(profiles))
    if (typeof profile.hostedLoginUrl === "string")
      targets.set(id, profile.hostedLoginUrl);
  targets.applicationIds = new Set(Object.keys(profiles));
  return targets;
}

const subnets = (entries) => {
  const list = new BlockList();
  for (const [address, prefix, family] of entries)
    list.addSubnet(address, prefix, family);
  return list;
};
const ADDRESS_KINDS = [
  [
    "loopback",
    subnets([
      ["127.0.0.0", 8, "ipv4"],
      ["::1", 128, "ipv6"],
    ]),
  ],
  [
    "link-local",
    subnets([
      ["169.254.0.0", 16, "ipv4"],
      ["fe80::", 10, "ipv6"],
    ]),
  ],
  [
    "private",
    subnets([
      ["10.0.0.0", 8, "ipv4"],
      ["172.16.0.0", 12, "ipv4"],
      ["192.168.0.0", 16, "ipv4"],
      ["100.64.0.0", 10, "ipv4"],
      ["fc00::", 7, "ipv6"],
      ["fec0::", 10, "ipv6"],
    ]),
  ],
  [
    "reserved",
    subnets([
      ["0.0.0.0", 8, "ipv4"],
      ["192.0.0.0", 24, "ipv4"],
      ["192.0.2.0", 24, "ipv4"],
      ["192.88.99.0", 24, "ipv4"],
      ["198.18.0.0", 15, "ipv4"],
      ["198.51.100.0", 24, "ipv4"],
      ["203.0.113.0", 24, "ipv4"],
      ["224.0.0.0", 4, "ipv4"],
      ["240.0.0.0", 4, "ipv4"],
      // 6to4 and Teredo wrap an IPv4 address; with the rest of the protocol
      // assignments, the discard prefix and the documentation prefix they
      // are never a site. (::/8 is handled in classifyHost: as a subnet here
      // it would match every IPv4 address through its mapped form.)
      ["100::", 64, "ipv6"],
      ["2001::", 23, "ipv6"],
      ["2001:db8::", 32, "ipv6"],
      ["2002::", 16, "ipv6"],
      ["ff00::", 8, "ipv6"],
    ]),
  ],
];
/**
 * Last labels of names that are never a public host: special-use and
 * private-use suffixes. The steps format refuses the same names as a listed
 * origin (`HTTP_LOGIN_NON_PUBLIC_SUFFIXES`); the corpus check holds the two
 * together.
 */
export const NON_PUBLIC_SUFFIXES = Object.freeze({
  localhost: "loopback",
  local: "private",
  lan: "private",
  home: "private",
  internal: "private",
  intranet: "private",
  corp: "private",
  private: "private",
  localdomain: "private",
  test: "reserved",
  invalid: "reserved",
  example: "reserved",
  onion: "reserved",
  alt: "reserved",
  mail: "reserved",
  arpa: "reserved",
});

const bareHost = (hostname) =>
  String(hostname)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/%.*$/u, "")
    .replace(/\.$/u, "");

/** "public", or why a host is never loaded: loopback, link-local, private, reserved. */
export function classifyHost(hostname) {
  const host = bareHost(hostname);
  const family = isIP(host);
  if (family) {
    const type = family === 4 ? "ipv4" : "ipv6";
    for (const [kind, list] of ADDRESS_KINDS)
      if (list.check(host, type)) return kind;
    // ::/8 holds the unspecified address, NAT64 and every form that carries
    // an IPv4 address in its low bits (IPv4-compatible, -mapped,
    // -translated). Loopback and the mapped private ranges are matched
    // above; whatever else is written this way is not a destination to load.
    if (
      family === 6 &&
      (host.startsWith("::") || Number.parseInt(host.split(":")[0], 16) < 0x100)
    )
      return "reserved";
    return "public";
  }
  // A dotted or hexadecimal number that is not a canonical address.
  if (!host || /^[0-9.]+$/u.test(host) || /^0x[0-9a-f.x]*$/u.test(host))
    return "reserved";
  if (host === "localhost") return "loopback";
  // A single label is an intranet name; home.arpa is the home-network zone.
  if (!host.includes(".") || host.endsWith(".home.arpa")) return "private";
  const suffix = host.slice(host.lastIndexOf(".") + 1);
  return Object.hasOwn(NON_PUBLIC_SUFFIXES, suffix)
    ? NON_PUBLIC_SUFFIXES[suffix]
    : "public";
}

const privateAddress = (host, kind) =>
  new CaptureRefusal(
    "private-address",
    `${host} is a ${kind} address. This tool renders public catalog login pages only; ` +
      "for a page on your own network or machine, save it and pass --from-file.",
  );

/**
 * Decides what to capture, or refuses. Hosted mode accepts exactly a catalog
 * `hostedLoginUrl` on a public host; `--from-file` accepts a saved HTML file.
 */
export function resolveCaptureTarget(
  { id, url, fromFile } = {},
  catalog = loadCatalogTargets(),
) {
  if (fromFile !== undefined) {
    if (url !== undefined)
      throw new CaptureRefusal(
        "usage",
        "--from-file reads a saved page and loads nothing, so it cannot be combined with --url.",
      );
    if (!id || !APPLICATION_ID.test(id))
      throw new CaptureRefusal(
        "usage",
        `--from-file needs --id <application>.\n${USAGE}`,
      );
    if (!/\.html?$/iu.test(fromFile))
      throw new CaptureRefusal(
        "usage",
        '--from-file takes a page saved as "Webpage, Complete" (the .html or .htm file; keep its _files folder beside it). Web archives are not read.',
      );
    return { kind: "file", applicationId: id, file: path.resolve(fromFile) };
  }
  if (!id && url === undefined) throw new CaptureRefusal("usage", USAGE);

  const notCatalog = (detail) =>
    new CaptureRefusal(
      "not-catalog-url",
      `${detail} Only the catalog hostedLoginUrl of an application is loaded (see --list).`,
    );
  let requested = null;
  if (url !== undefined) {
    try {
      requested = new URL(url);
    } catch {
      throw notCatalog(`"${url}" is not a URL.`);
    }
    const kind = classifyHost(requested.hostname);
    if (kind !== "public") throw privateAddress(requested.hostname, kind);
  }

  const known = catalog.applicationIds ?? new Set(catalog.keys());
  let applicationId = id;
  if (applicationId === undefined) {
    const matches = [...catalog].filter(
      ([, hosted]) =>
        URL.canParse(hosted) && new URL(hosted).href === requested.href,
    );
    if (matches.length === 0)
      throw notCatalog(`${url} is not a catalog hostedLoginUrl.`);
    if (matches.length > 1)
      throw new CaptureRefusal(
        "usage",
        `${url} is the hostedLoginUrl of ${matches.map(([match]) => match).join(", ")}; pass --id.`,
      );
    [[applicationId]] = matches;
  }
  if (!known.has(applicationId))
    throw new CaptureRefusal(
      "unknown-application",
      `"${applicationId}" is not in the catalog (${CATALOG_PATH}).`,
    );
  const hosted = catalog.get(applicationId);
  if (hosted === undefined)
    throw new CaptureRefusal(
      "no-hosted-login",
      `${applicationId} has no hostedLoginUrl: it runs on the user's own server or device. ` +
        "Use its public source, or a page the user saved with --from-file.",
    );
  let target;
  try {
    target = new URL(hosted);
  } catch {
    throw notCatalog(`The catalog entry for ${applicationId} is not a URL.`);
  }
  const kind = classifyHost(target.hostname);
  if (kind !== "public") throw privateAddress(target.hostname, kind);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw notCatalog(
      `The catalog entry for ${applicationId} is not a plain https URL.`,
    );
  // The guard opens ports 80 and 443 and no other, for no host.
  if (target.port)
    throw notCatalog(
      `The catalog entry for ${applicationId} names port ${target.port}; only the default https port is loaded.`,
    );
  if (requested && requested.href !== target.href)
    throw notCatalog(
      `${url} is not the hostedLoginUrl of ${applicationId} (${hosted}).`,
    );
  return { kind: "hosted", applicationId, url: hosted };
}

const systemLookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/** Resolves a public name and refuses it if any answer is not public. */
export async function assertPublicAddresses(hostname, lookup = systemLookup) {
  const host = bareHost(hostname);
  const kind = classifyHost(host);
  if (kind !== "public") throw privateAddress(host, kind);
  if (isIP(host)) return [host];
  let answers;
  try {
    answers = await lookup(host);
  } catch {
    answers = [];
  }
  if (!answers.length)
    throw new CaptureRefusal(
      "unresolved-host",
      `${host} did not resolve, so nothing was loaded. Confirm that the name resolves on this machine before running the command again.`,
    );
  for (const { address } of answers) {
    const answer = classifyHost(address);
    if (answer !== "public") throw privateAddress(host, answer);
  }
  // IPv4 first: the guard connects to the first address it is given.
  return answers
    .map(({ address }) => address)
    .sort((left, right) => isIP(left) - isIP(right));
}

/**
 * The rule every browser connection is held to. "hosted": public addresses on
 * the web ports. "loopback-fixture": the listed synthetic origins and nothing
 * else, so the tool's own tests stay off the network.
 */
export function connectionPolicy({
  mode,
  allowed = [],
  lookup = systemLookup,
}) {
  // Fixed: no option, and no catalog entry, opens another port.
  const webPorts = new Set([80, 443]);
  const synthetic = new Set(allowed.map((target) => target.toLowerCase()));
  const resolved = new Map();
  return {
    async decide(hostname, port) {
      const host = bareHost(hostname);
      if (mode === "loopback-fixture")
        return synthetic.has(`${host}:${port}`)
          ? { allow: true, address: "127.0.0.1" }
          : { allow: false, reason: "not a listed synthetic origin" };
      if (!webPorts.has(port)) return { allow: false, reason: `port ${port}` };
      if (!resolved.has(host))
        resolved.set(
          host,
          assertPublicAddresses(host, lookup).then(
            ([address]) => ({ allow: true, address }),
            (error) => ({ allow: false, reason: error.message }),
          ),
        );
      return resolved.get(host);
    },
  };
}

/** The committed capture of the same page, if one exists: one load per provider. */
export function findExistingCapture(corpusRoot, url) {
  let entries;
  try {
    entries = readdirSync(corpusRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(corpusRoot, entry.name);
    for (const name of readdirSync(directory)) {
      if (!/^capture[\w.-]*\.json$/u.test(name)) continue;
      try {
        const capture = JSON.parse(
          readFileSync(path.join(directory, name), "utf8"),
        );
        if (capture?.source?.requestedUrl === url)
          return path.join(directory, name);
      } catch {
        // An unreadable file is the corpus check's finding, not this tool's.
      }
    }
  }
  return null;
}

// ------------------------------------------------------------ sanitising

const WITHHELD = new Set([
  "style",
  "srcdoc",
  "srcset",
  "nonce",
  "integrity",
  "content",
  "placeholder",
  "title",
  "alt",
  "label",
  "summary",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
  "aria-roledescription",
  "data-sitekey",
]);
const URL_ATTRIBUTES = new Set([
  "action",
  "formaction",
  "src",
  "href",
  "data",
  "poster",
  "background",
  "cite",
  "ping",
  "manifest",
  "codebase",
  "longdesc",
  "xlink:href",
]);
const STRUCTURAL = new Set(
  (
    "id name class type autocomplete inputmode role for form method formmethod enctype " +
    "formenctype target formtarget rel sandbox allow loading tabindex maxlength minlength " +
    "size min max step pattern accept accept-charset autocapitalize autocorrect spellcheck " +
    "enterkeyhint dir lang hidden disabled readonly required multiple autofocus novalidate " +
    "formnovalidate checked selected inert open contenteditable draggable is slot part " +
    "exportparts popover popovertarget popovertargetaction list wrap rows cols scrolling " +
    "frameborder width height allowfullscreen referrerpolicy crossorigin shadowrootmode"
  ).split(" "),
);
// Attributes that name an element or a field, or point at one by its id.
const NAMING = new Set(["id", "name", "for", "form", "list", "popovertarget"]);
const IDENTIFIER_NAME = /^[\p{L}\p{N}_.:$[\]-]{1,128}$/u;
// aria attributes whose value is a state, a number or a keyword.
const ARIA_STATES = new Set(
  (
    "aria-hidden aria-disabled aria-required aria-invalid aria-expanded aria-haspopup " +
    "aria-pressed aria-checked aria-selected aria-busy aria-modal aria-live aria-atomic " +
    "aria-relevant aria-autocomplete aria-multiline aria-multiselectable aria-readonly " +
    "aria-orientation aria-sort aria-current aria-level aria-posinset aria-setsize " +
    "aria-colcount aria-colindex aria-colspan aria-rowcount aria-rowindex aria-rowspan " +
    "aria-valuemin aria-valuemax aria-valuenow"
  ).split(" "),
);
const ARIA_ID_LISTS = new Set(
  (
    "aria-controls aria-labelledby aria-describedby aria-details aria-errormessage " +
    "aria-owns aria-flowto aria-activedescendant"
  ).split(" "),
);
const BUTTON_TYPES = new Set([
  "submit",
  "button",
  "reset",
  "image",
  "checkbox",
  "radio",
]);
const TOKEN = /^[\w.:-]{1,64}$/u;
const IDENTIFIER = /^[\w.:/[\]#-]{0,64}$/u;
const ATTRIBUTE_NAME = /^[a-z_:][a-z0-9_.:-]{0,63}$/iu;
const TAG_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

const characterClass = (character) =>
  /[a-z]/u.test(character) ? 0 : /[A-Z]/u.test(character) ? 1 : 2;

/**
 * True for a token that looks like account or session data rather than a name
 * a page author chose: an email address, a JWT, a UUID, a long hexadecimal
 * run, or a long run that switches between cases and digits like random data.
 */
export function looksSecret(token) {
  if (/[^\s@]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/iu.test(token)) return true;
  if (/^eyJ[\w-]{6,}\.[\w-]{6,}/u.test(token)) return true;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(token))
    return true;
  for (const run of token.split(/[^A-Za-z0-9+/=]+/u)) {
    if (/^[0-9a-f]{24,}$/iu.test(run) && /\d/u.test(run)) return true;
    if (
      run.length < 24 ||
      !/[a-z]/u.test(run) ||
      !/[A-Z]/u.test(run) ||
      !/\d/u.test(run)
    )
      continue;
    let switches = 0;
    for (let index = 1; index < run.length; index++)
      if (characterClass(run[index]) !== characterClass(run[index - 1]))
        switches++;
    if (switches / (run.length - 1) >= 0.55) return true;
  }
  return false;
}

const FRAME_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;
const FRAME_NAME_PART = /^(?:[A-Za-z]+[0-9]{0,3}|[0-9]{1,4})$/u;

/**
 * A frame's name as it may be written: a plain identifier an author chose
 * (`appFrame`, `login_iframe`, `frame2`), or `null`. A frame name follows
 * `window.name`, so a page can put anything into it: free text, a token, or a
 * name generated per session, which is letters and digits mixed.
 */
export function sanitizeFrameName(name) {
  const text = typeof name === "string" ? name : "";
  return FRAME_NAME.test(text) &&
    !looksSecret(text) &&
    text
      .split(/[-_]+/u)
      .filter(Boolean)
      .every((part) => FRAME_NAME_PART.test(part))
    ? text
    : null;
}

/** The origin of an absolute or protocol-relative http(s) URL, else null. */
function httpOrigin(url) {
  const text = typeof url === "string" ? url : "";
  const absolute = text.startsWith("//") ? `https:${text}` : text;
  return /^https?:\/\//iu.test(absolute) && URL.canParse(absolute)
    ? new URL(absolute).origin
    : null;
}

function writtenOrigin(url, context) {
  const keep =
    context.mode === "loopback-fixture"
      ? Boolean(context.keepOrigins?.has(url.origin))
      : context.mode === "hosted" && classifyHost(url.hostname) === "public";
  if (keep) return url.origin;
  // A saved page's hosts, and any private host, are replaced by stable aliases.
  context.aliases ??= new Map();
  if (!context.aliases.has(url.origin))
    context.aliases.set(
      url.origin,
      `${url.protocol}//origin-${context.aliases.size + 1}.invalid`,
    );
  return context.aliases.get(url.origin);
}

function withheldSegment(segment, context) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the raw spelling for the check below.
  }
  // "Webpage, Complete" keeps frames and resources in a folder named after
  // the page title: that name is page text, and may hold an account name.
  if (context?.mode === "file" && /_files$/iu.test(decoded))
    return "[saved-files]";
  return looksSecret(decoded) ? "[withheld]" : segment;
}

const pathOnly = (value, context) =>
  value
    .split(/[?#]/u, 1)[0]
    .split("/")
    .map((segment) => withheldSegment(segment, context))
    .join("/");

function sanitizeUrl(raw, context) {
  const text = raw.trim();
  if (text === "") return "";
  if (text.length > 2048) return null;
  if (text.startsWith("#")) return "#";
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(text)?.[1].toLowerCase();
  const protocolRelative = text.startsWith("//");
  let written;
  if (!scheme && !protocolRelative) written = pathOnly(text, context);
  else if (scheme && scheme !== "http" && scheme !== "https")
    written = scheme === "about" ? pathOnly(text, context) : `${scheme}:`;
  else {
    let url;
    try {
      url = new URL(protocolRelative ? `https:${text}` : text);
    } catch {
      return null;
    }
    const origin = writtenOrigin(url, context);
    written =
      (protocolRelative ? origin.replace(/^https:/u, "") : origin) +
      pathOnly(url.pathname, context);
  }
  return written.length > LIMITS.maxValue ? null : written;
}

/**
 * The written form of one attribute: its value when it is structural, or
 * `null` when only its presence is recorded.
 */
export function sanitizeAttribute(element, name, value, context = {}) {
  const attribute = String(name).toLowerCase();
  const text = String(value);
  if (WITHHELD.has(attribute) || attribute.startsWith("on")) return null;
  if (attribute === "value") {
    const button =
      element.tag === "button" ||
      (element.tag === "input" && BUTTON_TYPES.has(element.type));
    return button && TOKEN.test(text) && !looksSecret(text) ? text : null;
  }
  if (URL_ATTRIBUTES.has(attribute)) return sanitizeUrl(text, context);
  if (text.length > LIMITS.maxValue || /[\u0000-\u001f\u007f]/u.test(text))
    return null;
  const tokens = text.split(/\s+/u).filter(Boolean);
  if (attribute === "class") {
    const kept = tokens.filter((token) => !looksSecret(token));
    return kept.length === tokens.length ? text : kept.join(" ");
  }
  if (tokens.some(looksSecret)) return null;
  // An id, a field name or a reference to one is an identifier: short, no
  // spaces. Anything else in such an attribute is page text.
  if (NAMING.has(attribute))
    return text === "" || IDENTIFIER_NAME.test(text) ? text : null;
  if (attribute.startsWith("aria-")) {
    if (ARIA_STATES.has(attribute))
      return tokens.every((token) => TOKEN.test(token)) ? text : null;
    // Lists of ids. Every other aria attribute holds words for a person, and
    // so does a list that is not all ids of its own document (`context.ids`):
    // "signed in as" is three identifier-shaped tokens too.
    return ARIA_ID_LISTS.has(attribute) &&
      tokens.length <= 8 &&
      tokens.every(
        (token) =>
          IDENTIFIER_NAME.test(token) && context.ids?.has(token) === true,
      )
      ? text
      : null;
  }
  if (STRUCTURAL.has(attribute)) return text;
  return IDENTIFIER.test(text) ? text : null;
}

/** A tag name is page-controlled too: a custom element can be named anything. */
function sanitizeTag(tag) {
  if (typeof tag === "string" && TAG_NAME.test(tag) && !looksSecret(tag))
    return tag;
  return String(tag).includes("-") ? "custom-element" : "unknown";
}

/**
 * The ids of one captured document as they are written, shadow trees
 * included: what a list of ids in that document may refer to. `idOf` reads an
 * element's id from a raw node or from a written one.
 */
function documentIds(tree, idOf) {
  const ids = new Set();
  const visit = (node) => {
    const id = idOf(node);
    if (
      typeof id === "string" &&
      id !== "" &&
      sanitizeAttribute({ tag: "", type: "" }, "id", id) === id
    )
      ids.add(id);
    for (const child of [...(node?.children ?? []), ...(node?.shadow ?? [])])
      visit(child);
  };
  if (tree) visit(tree);
  return ids;
}
const rawId = (node) =>
  Array.isArray(node?.attributes)
    ? node.attributes.find(([name]) => name === "id")?.[1]
    : undefined;
const writtenId = (node) => node?.attributes?.id;

/**
 * The written attributes of one element. `pairs` are `[name, value]`; a
 * `null` value is one that was already withheld and stays so. A frame element
 * that shows another origin than its document is another party's frame: its
 * `src` is reduced to that origin, which is all the frame record says too,
 * and its `name` is withheld. Any other frame's `name` is held to the
 * frame-name rule.
 */
function sanitizeAttributes(tag, pairs, context) {
  const type = pairs.find(([name]) => name === "type")?.[1] ?? "";
  const element = { tag, type: String(type ?? "").toLowerCase() };
  const attributes = {};
  for (const [name, value] of pairs)
    if (ATTRIBUTE_NAME.test(name) && name !== "__proto__" && !looksSecret(name))
      attributes[name] =
        value === null
          ? null
          : sanitizeAttribute(element, name, value, context);
  if (tag === "iframe" || tag === "frame") {
    const shown = httpOrigin(attributes.src);
    // Known only where the document's own origin is: not for a saved page.
    const elsewhere =
      shown !== null &&
      context.documentOrigin != null &&
      shown !== context.documentOrigin;
    if (elsewhere)
      attributes.src = attributes.src.startsWith("//")
        ? shown.replace(/^https:/u, "")
        : shown;
    if (
      attributes.name &&
      (elsewhere || sanitizeFrameName(attributes.name) === null)
    )
      attributes.name = null;
  }
  return { element, attributes };
}

function sanitizeNode(raw, context, counts) {
  const tag = sanitizeTag(raw.tag);
  const { attributes } = sanitizeAttributes(tag, raw.attributes, context);
  const node = { tag, attributes };
  if (raw.control) {
    counts.controls++;
    if (typeof raw.rendered === "boolean") node.rendered = raw.rendered;
    if (Number.isInteger(raw.options)) node.options = raw.options;
    if (
      /\b(?:g-recaptcha|h-captcha|cf-turnstile)\b/u.test(
        attributes.class ?? "",
      ) ||
      "data-sitekey" in attributes
    )
      counts.captcha = true;
  }
  if (raw.children?.length)
    node.children = raw.children.map((child) =>
      sanitizeNode(child, context, counts),
    );
  if (raw.shadow?.length)
    node.shadow = raw.shadow.map((child) =>
      sanitizeNode(child, context, counts),
    );
  return node;
}

const CAPTCHA_FRAME =
  /(?:recaptcha|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com|captcha-delivery\.com)/iu;

function buildCapture({
  applicationId,
  mode,
  engine,
  source,
  rawFrames,
  context,
  limits,
  network,
}) {
  const indexes = new Map(rawFrames.map((frame, index) => [frame.id, index]));
  let captcha = false;
  let truncated = false;
  // One alias table for every frame, as in resanitizeCapture.
  context.aliases ??= new Map();
  const frames = rawFrames.map((frame, index) => {
    const counts = { controls: 0, captcha: false };
    const record = { index, parent: indexes.get(frame.parentId) ?? null };
    // A frame's address before its tree: the order resanitizeCapture visits
    // them in, so host aliases get the same numbers in both passes.
    if (mode !== "file") {
      // The name and the origin flag are settled by resanitizeCapture below.
      record.name = frame.name || null;
      record.url = sanitizeUrl(frame.url, context);
      if (CAPTCHA_FRAME.test(frame.url)) counts.captcha = true;
    }
    // A frame on another origin was listed, not read: it has no tree.
    const tree = frame.raw
      ? sanitizeNode(
          frame.raw.tree,
          { ...context, ids: documentIds(frame.raw.tree, rawId) },
          counts,
        )
      : null;
    truncated ||= Boolean(frame.raw?.truncated);
    captcha ||= counts.captcha;
    return tree ? { ...record, controls: counts.controls, tree } : record;
  });
  // One function decides the written form, for a new capture and for an
  // existing one alike, so the two can never differ. It also reads the
  // password field, shadow tree and error status observations from what it
  // keeps: a challenge is the only one that has to be handed to it.
  return resanitizeCapture(
    {
      schema: CAPTURE_SCHEMA,
      applicationId,
      capturedAt: new Date().toISOString().slice(0, 10),
      mode,
      engine,
      source,
      limits: { ...limits, input: "none", truncated },
      ...(network ? { network } : {}),
      observations: captcha ? ["captcha"] : [],
      frames,
    },
    { keepOrigins: context.keepOrigins },
  );
}

// The browser's own services, seen in every run whatever the page. They are
// left out of the contacted list by name, whoever asked for them.
const BROWSER_OWN_HOST =
  /^(?:edge\.microsoft\.com|(?:[a-z0-9-]+\.)*smartscreen\.microsoft\.com|www\.bing\.com)$/u;
// A country domain of one service depends on where the capture was made.
const COUNTRY_HOST =
  /^((?:[a-z0-9-]+\.)*)google\.(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/u;

/**
 * A host label long enough, and mixed enough, to carry data rather than a
 * name. Host names are lower case, so the case test of `looksSecret` cannot
 * see it: what is left is letters and digits changing places.
 */
function dataLikeLabel(label) {
  if (looksSecret(label)) return true;
  const run = label.replace(/-/gu, "");
  if (run.length < 24 || !/[a-z]/u.test(run) || !/\d/u.test(run)) return false;
  let switches = 0;
  for (let index = 1; index < run.length; index++)
    if (/\d/u.test(run[index]) !== /\d/u.test(run[index - 1])) switches++;
  return switches / (run.length - 1) >= 0.25;
}

/**
 * The contacted list as written: every `host:port` the guard carried, with
 * three changes. Entries for `edge.microsoft.com`, any host under
 * `smartscreen.microsoft.com` and `www.bing.com` are removed by name: the
 * browser contacts them in every run, and the guard cannot tell its request
 * from a page's, so a page that itself requests one of these three loses
 * that entry. Country domains of Google are folded into one entry. A host
 * label that looks like data is withheld. The result is sorted and has no
 * duplicates; no other entry is dropped.
 */
export function normaliseContacted(entries) {
  const written = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.[\]-]+):(\d{1,5})$/iu.exec(
      String(entry),
    );
    if (!match) continue;
    let host = match[1].toLowerCase();
    if (BROWSER_OWN_HOST.test(host)) continue;
    const country = COUNTRY_HOST.exec(host);
    if (country) host = `${country[1]}google.[country]`;
    else if (!host.startsWith("["))
      host = host
        .split(".")
        .map((label) => (dataLikeLabel(label) ? "[withheld]" : label))
        .join(".");
    written.add(`${host}:${match[2]}`);
  }
  return [...written].sort();
}

function resanitizeNode(captured, context) {
  const node = captured ?? {};
  const tag = sanitizeTag(node.tag);
  const { attributes } = sanitizeAttributes(
    tag,
    Object.entries(node.attributes ?? {}).filter(
      ([, value]) => value === null || typeof value === "string",
    ),
    context,
  );
  const written = { tag, attributes };
  if (typeof node.rendered === "boolean") written.rendered = node.rendered;
  if (Number.isInteger(node.options)) written.options = node.options;
  for (const key of ["children", "shadow"])
    if (Array.isArray(node[key]) && node[key].length)
      written[key] = node[key].map((child) => resanitizeNode(child, context));
  return written;
}

/** The version of the sanitizing rules a capture was written under. */
export const CAPTURE_SANITIZER = 4;
const MODES = new Set(["hosted", "file", "loopback-fixture"]);
const SAVED_PAGE_ENGINE = "static parse of a saved page";
const HEADLESS_ENGINE =
  /^Microsoft Edge headless \([A-Za-z]{1,24}\/\d[\d.]{0,31}\)$/u;

const isCalendarDate = (text) => {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(text))
    return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
};

/**
 * The address a capture was asked for, when it is one the tool can have
 * loaded: for a hosted capture what `resolveCaptureTarget` accepts, a plain
 * https address of a public host in its canonical spelling.
 */
function requestedAddress(value, mode) {
  if (typeof value !== "string" || value.length > 2048 || !URL.canParse(value))
    return null;
  const url = new URL(value);
  if (
    url.href !== value ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  const kind = classifyHost(url.hostname);
  // The tool's own tests render synthetic pages on 127.0.0.1.
  if (mode === "loopback-fixture")
    return url.protocol === "http:" && kind === "loopback" ? value : null;
  return url.protocol === "https:" && !url.port && kind === "public"
    ? value
    : null;
}

/** What the tool states about a run: known keys, each of its own kind. */
function writtenLimits(limits, fileMode) {
  const given = limits !== null && typeof limits === "object" ? limits : {};
  const count = (value, most) =>
    Number.isInteger(value) && value >= 0 && value <= most;
  return {
    // Fixed by the mode: one navigation with the page's scripts, or a parse.
    navigations: fileMode ? 0 : 1,
    scriptsExecuted: !fileMode,
    ...(!fileMode && typeof given.loadEvent === "boolean"
      ? { loadEvent: given.loadEvent }
      : {}),
    ...(!fileMode && count(given.settleMs, MAX_SETTLE_MS)
      ? { settleMs: given.settleMs }
      : {}),
    ...(!fileMode && count(given.dialogsDismissed, 1000)
      ? { dialogsDismissed: given.dialogsDismissed }
      : {}),
    input: "none",
    truncated: given.truncated === true,
    // A property of every load: a redirect to another public host is
    // followed, and the guard refuses any other destination.
    ...(fileMode ? {} : { redirects: "public-hosts-only" }),
  };
}

/** What the written trees of a capture show, whatever it said before. */
function observedInTrees(frames) {
  let passwords = 0;
  let shadow = false;
  const visit = (node) => {
    if (
      node.tag === "input" &&
      String(node.attributes.type ?? "").toLowerCase() === "password"
    )
      passwords++;
    if (node.shadow?.length) shadow = true;
    for (const child of [...(node.children ?? []), ...(node.shadow ?? [])])
      visit(child);
  };
  for (const frame of frames) if (frame.tree) visit(frame.tree);
  return { passwords, shadow };
}

/**
 * Brings a capture under the current sanitizing rules without loading
 * anything, and is the one place that decides what a capture file holds:
 * known keys only, each of its own kind, at every level. Frame names, the
 * `name` and `src` of frame elements, the origin flag of frames, the
 * contacted list and every attribute are decided once more; what the capture
 * says about its own trees (a password field, a shadow tree, an error status)
 * is read from them again. Applying it to its own result changes nothing, and
 * every capture the tool writes has been through it. The argument is not
 * modified. What is not one of the tool's captures is refused, not repaired.
 */
export function resanitizeCapture(capture, { keepOrigins } = {}) {
  if (
    capture?.schema !== CAPTURE_SCHEMA ||
    !MODES.has(capture.mode) ||
    !Array.isArray(capture.frames) ||
    capture.frames.length === 0 ||
    !capture.frames.every(
      (frame) =>
        frame !== null && typeof frame === "object" && !Array.isArray(frame),
    )
  )
    throw new CaptureRefusal(
      "usage",
      `Not a ${CAPTURE_SCHEMA} capture; nothing was changed.`,
    );
  const fileMode = capture.mode === "file";
  const given =
    capture.source !== null && typeof capture.source === "object"
      ? capture.source
      : {};
  const context = {
    mode: capture.mode,
    // One alias table for the whole capture, shared by every frame.
    aliases: new Map(),
    // A synthetic test capture keeps the loopback origins it was made on.
    keepOrigins:
      keepOrigins ??
      new Set(
        [
          given.requestedUrl,
          given.finalUrl,
          ...capture.frames.map((frame) => frame.url),
        ]
          .map(httpOrigin)
          .filter(
            (origin) =>
              origin && classifyHost(new URL(origin).hostname) === "loopback",
          ),
      ),
  };
  // The final address first, then each frame's address before its tree:
  // host aliases are numbered in this order, here and in the first pass.
  const source = fileMode
    ? { kind: "saved-page" }
    : {
        kind: "hosted-login",
        requestedUrl: requestedAddress(given.requestedUrl, capture.mode),
        finalUrl:
          typeof given.finalUrl === "string"
            ? sanitizeUrl(given.finalUrl, context)
            : null,
        httpStatus:
          Number.isInteger(given.httpStatus) &&
          given.httpStatus >= 100 &&
          given.httpStatus <= 599
            ? given.httpStatus
            : null,
      };

  const origins = [];
  let elsewhere = false;
  const frames = capture.frames.map((frame, index) => {
    const parent =
      Number.isInteger(frame.parent) &&
      frame.parent >= 0 &&
      frame.parent < index
        ? frame.parent
        : null;
    const record = { index, parent };
    let documentOrigin = null;
    if (!fileMode) {
      const url =
        typeof frame.url === "string" ? sanitizeUrl(frame.url, context) : null;
      // A frame without a URL of its own has the origin of its parent.
      const inherits = index > 0 && /^about:/iu.test(url ?? "");
      documentOrigin = inherits ? (origins[parent] ?? null) : httpOrigin(url);
      const sameOrigin =
        index === 0 ||
        (documentOrigin !== null && documentOrigin === origins[0]);
      const name = sameOrigin ? sanitizeFrameName(frame.name) : null;
      record.name = name;
      if (frame.nameWithheld === true || (frame.name && name === null))
        record.nameWithheld = true;
      record.sameOriginAsTop = sameOrigin;
      if (!sameOrigin || !frame.tree) {
        // Another party's page inside this one. That it is there, and where
        // it is from, is a fact about the application's page; what is in it
        // is not, and nobody checked that party's rules: nothing is kept.
        elsewhere = true;
        origins.push(documentOrigin);
        const { sameOriginAsTop, ...position } = record;
        return {
          ...position,
          url: inherits ? url : (documentOrigin ?? url),
          sameOriginAsTop,
        };
      }
      record.url = url;
    }
    origins.push(documentOrigin);
    return {
      ...record,
      controls:
        Number.isInteger(frame.controls) && frame.controls >= 0
          ? frame.controls
          : 0,
      tree: resanitizeNode(frame.tree, {
        ...context,
        documentOrigin,
        ids: documentIds(frame.tree, writtenId),
      }),
    };
  });

  // A challenge is seen in a frame's address, of which only the origin is
  // kept, so that one observation is carried over. The others are read from
  // what is written.
  const seen = observedInTrees(frames);
  const observations = new Set([
    seen.passwords ? "password-field" : "no-password-field",
  ]);
  if ((capture.observations ?? []).includes?.("captcha"))
    observations.add("captcha");
  if (seen.shadow) observations.add("shadow-dom");
  if (source.httpStatus >= 400) observations.add("error-status");
  if (elsewhere) observations.add("cross-origin-frame");
  const network =
    !fileMode && capture.network !== null && typeof capture.network === "object"
      ? {
          contacted: normaliseContacted(capture.network.contacted),
          refused:
            Number.isInteger(capture.network.refused) &&
            capture.network.refused >= 0
              ? capture.network.refused
              : 0,
        }
      : null;
  return {
    schema: CAPTURE_SCHEMA,
    sanitizer: CAPTURE_SANITIZER,
    applicationId:
      typeof capture.applicationId === "string" &&
      APPLICATION_ID.test(capture.applicationId)
        ? capture.applicationId
        : null,
    capturedAt: isCalendarDate(capture.capturedAt) ? capture.capturedAt : null,
    mode: capture.mode,
    engine: fileMode
      ? SAVED_PAGE_ENGINE
      : typeof capture.engine === "string" &&
          HEADLESS_ENGINE.test(capture.engine)
        ? capture.engine
        : null,
    source,
    limits: writtenLimits(capture.limits, fileMode),
    ...(network ? { network } : {}),
    observations: [...observations].sort(),
    frames,
  };
}

// ------------------------------------------------------------- extraction

/**
 * Runs against a document: in an isolated world of the rendered page, or on a
 * statically parsed saved page. It reads element names, attributes and layout
 * through the DOM prototypes (so a control named like a DOM property cannot
 * redirect it), and returns forms, fields, buttons and frames with their
 * ancestors. It must stay self-contained: it is sent to the browser as source.
 */
export function extractLoginSkeleton(view, limits) {
  const getter = (prototype, name) =>
    Object.getOwnPropertyDescriptor(prototype, name).get;
  const element = view.Element.prototype;
  const childrenOf = getter(element, "children");
  const fragmentChildrenOf = getter(
    view.DocumentFragment.prototype,
    "children",
  );
  const attributesOf = getter(element, "attributes");
  const localNameOf = getter(element, "localName");
  const shadowRootOf = getter(element, "shadowRoot");
  const rootOf = getter(view.Document.prototype, "documentElement");
  const read = (node, name) => element.getAttribute.call(node, name);
  const has = (node, name) => element.hasAttribute.call(node, name);

  const CONTROLS = {
    form: 1,
    input: 1,
    button: 1,
    select: 1,
    textarea: 1,
    label: 1,
    iframe: 1,
    frame: 1,
    fieldset: 1,
    dialog: 1,
  };
  const ROLES = {
    button: 1,
    textbox: 1,
    tab: 1,
    tablist: 1,
    checkbox: 1,
    radio: 1,
    switch: 1,
    combobox: 1,
    dialog: 1,
    form: 1,
    search: 1,
  };
  const SKIPPED = {
    head: 1,
    script: 1,
    style: 1,
    noscript: 1,
    template: 1,
    svg: 1,
    math: 1,
  };
  let budget = limits.maxNodes;
  let truncated = false;

  function isControl(node, tag) {
    if (CONTROLS[tag] === 1) return true;
    const role = read(node, "role");
    if (role !== null && ROLES[role.trim().toLowerCase()] === 1) return true;
    if (has(node, "contenteditable")) return true;
    if (tag === "a") {
      const href = read(node, "href");
      return (
        has(node, "id") ||
        href === null ||
        href === "" ||
        href.charAt(0) === "#" ||
        /^javascript:/i.test(href) ||
        element.closest.call(
          node,
          "form,dialog,[role=dialog],[role=tablist]",
        ) !== null
      );
    }
    if (tag.indexOf("-") > 0 && (has(node, "name") || has(node, "type")))
      return true;
    // A challenge widget is recorded so the capture can say one is present.
    if (
      has(node, "data-sitekey") ||
      /(?:^|\s)(?:g-recaptcha|h-captcha|cf-turnstile)(?:\s|$)/.test(
        read(node, "class") || "",
      )
    )
      return true;
    return has(node, "id") && (has(node, "onclick") || has(node, "tabindex"));
  }

  function isRendered(node) {
    if (limits.layout !== true) return null;
    try {
      if (element.getClientRects.call(node).length === 0) return false;
      const computed = view.getComputedStyle(node);
      return computed.visibility !== "hidden" && computed.display !== "none";
    } catch (error) {
      return null;
    }
  }

  function attributePairs(node) {
    const pairs = [];
    const list = attributesOf.call(node);
    for (let index = 0; index < list.length; index++) {
      if (pairs.length >= limits.maxAttributes) break;
      const attribute = list.item(index);
      pairs.push([
        attribute.name,
        String(attribute.value).slice(0, limits.maxValue * 8 + 1),
      ]);
    }
    return pairs;
  }

  function visitAll(collection) {
    const kept = [];
    for (let index = 0; index < collection.length; index++) {
      const child = visit(collection.item(index));
      if (child !== null) kept.push(child);
    }
    return kept;
  }

  function visit(node) {
    const tag = localNameOf.call(node);
    if (SKIPPED[tag] === 1) return null;
    const children = visitAll(childrenOf.call(node));
    const root = shadowRootOf.call(node);
    const shadow = root ? visitAll(fragmentChildrenOf.call(root)) : [];
    const control = isControl(node, tag);
    if (!control && children.length === 0 && shadow.length === 0) return null;
    if (budget <= 0) {
      truncated = true;
      return null;
    }
    budget--;
    const kept = { tag: tag, attributes: attributePairs(node) };
    if (control) {
      kept.control = true;
      const rendered = isRendered(node);
      if (rendered !== null) kept.rendered = rendered;
      if (tag === "select")
        kept.options = element.querySelectorAll.call(node, "option").length;
    }
    // A select's options are counted, never copied.
    if (children.length !== 0 && tag !== "select") kept.children = children;
    if (shadow.length !== 0) kept.shadow = shadow;
    return kept;
  }

  const root = rootOf.call(view.document);
  let tree = root ? visit(root) : null;
  if (tree === null)
    tree = {
      tag: root ? localNameOf.call(root) : "html",
      attributes: root ? attributePairs(root) : [],
    };
  return { tree: tree, truncated: truncated };
}

/** Parses a page the user saved. No script runs and nothing is loaded. */
export async function captureFromFile(file, { applicationId }) {
  const stats = statSync(file, { throwIfNoEntry: false });
  if (!stats?.isFile())
    throw new CaptureRefusal("usage", `${file} is not a file.`);
  if (stats.size > LIMITS.maxSavedBytes)
    throw new CaptureRefusal(
      "usage",
      `${file} is larger than ${LIMITS.maxSavedBytes} bytes; save only the login page.`,
    );
  const { JSDOM } = await import("jsdom");
  // jsdom's defaults: scripts are not executed and no resource is fetched.
  const dom = new JSDOM(await readFile(file), { contentType: "text/html" });
  let raw;
  try {
    raw = extractLoginSkeleton(dom.window, { ...LIMITS, layout: false });
  } finally {
    dom.window.close();
  }
  return buildCapture({
    applicationId,
    mode: "file",
    engine: "static parse of a saved page",
    source: { kind: "saved-page" },
    rawFrames: [{ id: "top", parentId: null, url: "", name: "", raw }],
    context: { mode: "file" },
    limits: { navigations: 0, scriptsExecuted: false },
  });
}

// ------------------------------------------------------- connection guard

/**
 * A local forward proxy that applies `policy` to every connection the browser
 * makes and records what it carried and what it refused.
 */
export async function startConnectionGuard(policy) {
  const contacted = new Set();
  const refused = new Set();
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    return socket;
  };
  const named = (host, port) =>
    `${host.includes(":") ? `[${host}]` : host}:${port}`;

  // Plain http requests arrive in absolute form.
  async function forward(request, response) {
    if (!URL.canParse(request.url)) {
      response.writeHead(400).end();
      return;
    }
    const url = new URL(request.url);
    const port = Number(url.port || 80);
    const host = bareHost(url.hostname);
    const decision =
      url.protocol === "http:"
        ? await policy.decide(host, port)
        : { allow: false };
    if (!decision.allow) {
      refused.add(named(host, port));
      response.writeHead(403, { Connection: "close" }).end();
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = httpRequest(
      {
        host: decision.address,
        port,
        method: request.method,
        path: url.pathname + url.search,
        headers,
        setHost: false,
      },
      (answer) => {
        response.writeHead(
          answer.statusCode,
          answer.statusMessage,
          answer.rawHeaders,
        );
        answer.pipe(response);
      },
    );
    // Contacted means a connection exists, not that one was allowed.
    upstream.on("socket", (socket) => {
      track(socket);
      const reached = () => contacted.add(named(host, port));
      if (socket.connecting) socket.once("connect", reached);
      else reached();
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  }

  // https and WebSocket connections arrive as tunnels.
  async function tunnel(request, client, head) {
    const match = /^(\[[0-9a-f:.]+\]|[^:]+):(\d{1,5})$/iu.exec(
      request.url ?? "",
    );
    const host = match ? bareHost(match[1]) : "";
    const port = match ? Number(match[2]) : 0;
    const decision = match ? await policy.decide(host, port) : { allow: false };
    if (!decision.allow) {
      refused.add(named(host, port));
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = track(netConnect({ host: decision.address, port }));
    upstream.once("connect", () => {
      contacted.add(named(host, port));
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => client.destroy());
    client.once("close", () => upstream.destroy());
  }

  // Anything unexpected closes the connection: the guard fails closed.
  const server = createServer((request, response) => {
    forward(request, response).catch(() => response.destroy());
  });
  server.on("connect", (request, client, head) => {
    track(client);
    tunnel(request, client, head).catch(() => client.destroy());
  });
  server.on("connection", track);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    contacted,
    refused,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// ------------------------------------------------------------ real engine

/** An installed Edge. No browser is ever downloaded. */
export function edgeExecutable() {
  return (
    [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/microsoft-edge",
    ].find(existsSync) ?? null
  );
}

/**
 * DevTools over the browser's debugging pipe (messages end in a NUL byte).
 * No debugging port is opened, and the browser exits when the pipe closes:
 * that happens when this process ends in any way, including a kill it never
 * sees.
 */
class DevTools {
  #writable;
  #next = 0;
  #pending = new Map();
  #listeners = new Set();
  #buffered = "";
  constructor(writable, readable) {
    this.#writable = writable;
    writable.on("error", () => {});
    readable.setEncoding("utf8");
    readable.on("data", (chunk) => {
      this.#buffered += chunk;
      for (
        let end = this.#buffered.indexOf("\0");
        end >= 0;
        end = this.#buffered.indexOf("\0")
      ) {
        const message = this.#buffered.slice(0, end);
        this.#buffered = this.#buffered.slice(end + 1);
        try {
          this.#receive(JSON.parse(message));
        } catch {
          // Not a message: ignored.
        }
      }
    });
    const closed = () => {
      for (const call of this.#pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error("the browser closed its debugging pipe"));
      }
      this.#pending.clear();
    };
    readable.on("close", closed);
    readable.on("error", closed);
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
      this.#writable.write(
        `${JSON.stringify({ id, method, params, sessionId })}\0`,
      );
    });
  }
  on(listener) {
    this.#listeners.add(listener);
  }
  close() {
    this.#writable.end();
  }
}

async function until(predicate, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < end) await delay(100);
  return predicate();
}

const framesOf = (tree) => [
  tree.frame,
  ...(tree.childFrames ?? []).flatMap(framesOf),
];

// A run lasts a minute or two. A profile older than this was left by a run
// that was killed before it could clean up.
const STALE_PROFILE_MS = 10 * 60 * 1000;

/**
 * Removes temporary profiles left behind by a run that was killed outright.
 * Called at the start of every run; a profile in use by a current run is
 * younger than the limit and is left alone.
 */
export async function removeStaleProfiles(olderThanMs = STALE_PROFILE_MS) {
  const base = path.resolve(tmpdir());
  for (const name of readdirSync(base)) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const directory = path.join(base, name);
    const stats = statSync(directory, { throwIfNoEntry: false });
    if (!stats?.isDirectory() || Date.now() - stats.mtimeMs < olderThanMs)
      continue;
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

// Every termination request this process can see. On Windows Ctrl+C arrives
// as SIGINT, Ctrl+Break as SIGBREAK and a closing console window as SIGHUP;
// a kill by another process (taskkill /F, a parent ending the job) cannot be
// seen at all, which is why the browser is tied to the debugging pipe.
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];

/**
 * Whether the browser that used `profileDirectory` listened on a debugging
 * port: a browser that does writes the port into its profile.
 */
export function openedDebuggingPort(profileDirectory) {
  return existsSync(path.join(profileDirectory, "DevToolsActivePort"));
}

/**
 * One navigation in headless Edge behind the connection guard, then one
 * read-only pass over the frames of the page's own origin. The only commands
 * sent to a page are the navigation and the skeleton read.
 */
async function renderInEdge({ url, policy, settleMs }) {
  const executable = edgeExecutable();
  if (!executable)
    throw new CaptureFailure(
      "This capture needs an installed Microsoft Edge; no browser is downloaded.",
      { loadAttempted: false },
    );
  const run = {
    profileDirectory: null,
    refused: [],
    contacted: [],
    // What the browser was started with, the origin of every document the
    // read ran in, and whether a debugging port was opened beside the pipe.
    arguments: [],
    read: [],
    debuggingPort: false,
  };
  let guard;
  let profile;
  let browser;
  let exited;
  let devtools;
  let result;
  let failure = null;
  // A termination request ends the run through the same cleanup as a failure.
  let interrupt;
  const interrupted = new Promise((_resolve, reject) => {
    interrupt = () => reject(new Error("interrupted before the capture ended"));
  });
  for (const signal of TERMINATION_SIGNALS) process.once(signal, interrupt);
  const drive = async () => {
    await removeStaleProfiles();
    guard = await startConnectionGuard(policy);
    profile = await mkdtemp(path.join(tmpdir(), PROFILE_PREFIX));
    run.profileDirectory = profile;
    // Edge also writes importer and diagnostic files to TEMP; keep them here.
    const browserTemp = path.join(profile, "temp");
    await mkdir(browserTemp);
    const stderr = [];
    run.arguments = [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-domain-reliability",
      "--disable-client-side-phishing-detection",
      "--mute-audio",
      "--no-pings",
      "--dns-prefetch-disable",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      // Everything, loopback included, goes through the guard. The browser
      // itself can resolve nothing but the guard's own literal address.
      `--proxy-server=http://127.0.0.1:${guard.port}`,
      "--proxy-bypass-list=<-loopback>",
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
      `--user-data-dir=${profile}`,
      // The pipe is the only way to drive the browser: no debugging port,
      // which any local process could connect to.
      "--remote-debugging-pipe",
      "about:blank",
    ];
    browser = spawn(executable, run.arguments, {
      windowsHide: true,
      // The browser reads commands on descriptor 3 and answers on 4.
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
      env: { ...process.env, TEMP: browserTemp, TMP: browserTemp },
    });
    browser.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      if (stderr.length > 64) stderr.shift();
    });
    exited = new Promise((resolve) => {
      browser.once("exit", resolve);
      browser.once("error", resolve);
    });
    const tail = () => Buffer.concat(stderr).toString("utf8").slice(-2000);
    devtools = new DevTools(browser.stdio[3], browser.stdio[4]);
    try {
      ({ product: run.product } = await devtools.send(
        "Browser.getVersion",
        {},
        undefined,
        START_TIMEOUT_MS,
      ));
    } catch (error) {
      throw new Error(`Edge did not start: ${error.message} ${tail()}`.trim());
    }

    // An in-memory browser context on top of the temporary profile.
    const { browserContextId } = await devtools.send(
      "Target.createBrowserContext",
      {
        disposeOnDetach: true,
        proxyServer: `http://127.0.0.1:${guard.port}`,
        proxyBypassList: "<-loopback>",
      },
    );
    await devtools
      .send("Browser.setDownloadBehavior", {
        behavior: "deny",
        browserContextId,
      })
      .catch(() => {});
    const { targetId } = await devtools.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await devtools.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const attach = {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    };
    const sessions = new Set([sessionId]);
    const statusByLoader = new Map();
    let loaded = false;
    let dialogs = 0;
    devtools.on((method, params, session) => {
      if (method === "Target.attachedToTarget") {
        // Out-of-process frames arrive as their own targets.
        if (params.targetInfo.type !== "iframe") return;
        sessions.add(params.sessionId);
        devtools
          .send("Target.setAutoAttach", attach, params.sessionId)
          .catch(() => {});
      } else if (method === "Target.detachedFromTarget")
        sessions.delete(params.sessionId);
      else if (method === "Network.responseReceived") {
        if (session === sessionId && params.type === "Document")
          statusByLoader.set(params.loaderId, params.response.status);
      } else if (method === "Page.loadEventFired") {
        if (session === sessionId) loaded = true;
      } else if (method === "Page.javascriptDialogOpening") {
        // A script dialog would block the read; it is dismissed, never accepted.
        dialogs++;
        devtools
          .send("Page.handleJavaScriptDialog", { accept: false }, session)
          .catch(() => {});
      }
    });
    await devtools.send("Page.enable", {}, sessionId);
    await devtools.send("Network.enable", {}, sessionId);
    await devtools.send("Target.setAutoAttach", attach, sessionId);

    const navigation = await devtools.send(
      "Page.navigate",
      { url },
      sessionId,
      LOAD_TIMEOUT_MS,
    );
    if (navigation.errorText)
      throw new Error(`the page did not load: ${navigation.errorText}`);
    // A page that never finishes loading is still read, and marked.
    const loadEvent = await until(() => loaded, LOAD_TIMEOUT_MS);
    await delay(settleMs);

    const expression = `(${extractLoginSkeleton})(window, ${JSON.stringify({ ...LIMITS, layout: true })})`;
    // Every frame of the page: the page's own session first, then each
    // out-of-process frame, so a parent always comes before its children.
    const listed = [];
    let main = null;
    for (const session of sessions) {
      let tree;
      try {
        ({ frameTree: tree } = await devtools.send(
          "Page.getFrameTree",
          {},
          session,
        ));
      } catch {
        continue;
      }
      if (session === sessionId) main = tree.frame;
      for (const frame of framesOf(tree))
        if (!listed.some((item) => item.frame.id === frame.id))
          listed.push({ frame, session });
    }
    if (!main || listed[0]?.frame.id !== main.id)
      throw new Error("the page could not be read");
    // Only documents of the top document's origin are read. A frame on
    // another origin is another party's page: it is listed, never opened.
    const topOrigin = httpOrigin(main.url);
    const originOf = new Map();
    const rawFrames = [];
    for (const { frame, session } of listed.slice(0, LIMITS.maxFrames)) {
      const origin =
        frame.parentId && /^about:/iu.test(frame.url)
          ? (originOf.get(frame.parentId) ?? null)
          : httpOrigin(frame.url);
      originOf.set(frame.id, origin);
      const entry = {
        id: frame.id,
        parentId: frame.parentId ?? null,
        url: frame.url,
        name: frame.name ?? "",
        raw: null,
      };
      if (frame.id === main.id || (origin !== null && origin === topOrigin)) {
        run.read.push(origin ?? "");
        try {
          const { executionContextId } = await devtools.send(
            "Page.createIsolatedWorld",
            { frameId: frame.id, worldName: "sorng-login-capture" },
            session,
          );
          const evaluated = await devtools.send(
            "Runtime.evaluate",
            {
              contextId: executionContextId,
              expression,
              returnByValue: true,
            },
            session,
          );
          if (!evaluated.exceptionDetails)
            entry.raw = evaluated.result?.value ?? null;
        } catch {
          // A frame that went away during the read is left out below.
        }
        if (!entry.raw) continue;
      }
      rawFrames.push(entry);
    }
    if (rawFrames[0]?.id !== main.id)
      throw new Error("the page could not be read");
    return {
      rawFrames,
      finalUrl: main.url,
      httpStatus: statusByLoader.get(main.loaderId) ?? null,
      dialogs,
      loadEvent,
    };
  };
  try {
    const driving = drive();
    driving.catch(() => {});
    result = await Promise.race([driving, interrupted]);
  } catch (error) {
    failure = error;
  } finally {
    for (const signal of TERMINATION_SIGNALS) process.off(signal, interrupt);
    if (devtools) {
      await devtools.send("Browser.close", {}, undefined, 5000).catch(() => {});
      devtools.close();
    }
    if (browser?.pid) {
      const stopped = await Promise.race([exited, delay(5000, false)]);
      if (stopped === false && browser.exitCode === null) {
        if (process.platform === "win32") {
          const stop = spawn(
            "taskkill.exe",
            ["/PID", String(browser.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          await new Promise((resolve) => stop.once("exit", resolve));
        } else browser.kill("SIGKILL");
        await exited;
      }
    }
    if (guard) {
      await guard.close();
      run.refused = [...guard.refused].sort();
      run.contacted = [...guard.contacted].sort();
    }
    // The pipe is the only way in: anything else voids the run.
    if (profile && openedDebuggingPort(profile)) {
      run.debuggingPort = true;
      failure ??= new Error(
        "the browser opened a debugging port beside the pipe; the capture is discarded",
      );
    }
    if (
      profile &&
      path.dirname(profile) === path.resolve(tmpdir()) &&
      path.basename(profile).startsWith(PROFILE_PREFIX)
    )
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      }).catch(() => {});
    if (profile && existsSync(profile))
      failure ??= new Error(
        `the temporary browser profile could not be removed: ${profile}`,
      );
  }
  if (failure)
    throw new CaptureFailure(failure.message, {
      // After a read the page was certainly loaded, whatever failed later.
      loadAttempted:
        result !== undefined || loadWasAttempted(url, run.contacted),
    });
  return { ...result, run };
}

async function captureWithEdge({
  applicationId,
  mode,
  url,
  policy,
  context,
  settleMs,
}) {
  const settle = Math.min(
    Math.max(Number.isFinite(settleMs) ? settleMs : DEFAULT_SETTLE_MS, 0),
    MAX_SETTLE_MS,
  );
  const { rawFrames, finalUrl, httpStatus, dialogs, loadEvent, run } =
    await renderInEdge({ url, policy, settleMs: settle });
  const capture = buildCapture({
    applicationId,
    mode,
    engine: `Microsoft Edge headless (${run.product})`,
    source: {
      kind: "hosted-login",
      requestedUrl: url,
      finalUrl: sanitizeUrl(finalUrl, context),
      httpStatus,
    },
    rawFrames,
    context,
    limits: {
      navigations: 1,
      scriptsExecuted: true,
      loadEvent,
      settleMs: settle,
      dialogsDismissed: dialogs,
    },
    // Refused connections are counted, never named: they may be private hosts.
    network: { contacted: run.contacted, refused: run.refused.length },
  });
  return { capture, run };
}

/**
 * Renders a catalog `hostedLoginUrl` anonymously, once. `target` comes from
 * `resolveCaptureTarget`, which is repeated here so no caller can skip it.
 */
export async function captureHosted(
  target,
  { settleMs, catalog, lookup } = {},
) {
  const { applicationId, url } = resolveCaptureTarget(
    { id: target.applicationId, url: target.url },
    catalog,
  );
  const { hostname } = new URL(url);
  await assertPublicAddresses(hostname, lookup);
  return captureWithEdge({
    applicationId,
    mode: "hosted",
    url,
    policy: connectionPolicy({ mode: "hosted" }),
    context: { mode: "hosted" },
    settleMs,
  });
}

/**
 * For this tool's own tests: renders a synthetic page served on 127.0.0.1.
 * It accepts nothing else and reaches nothing else, so it cannot be used to
 * load a real site or a device. A capture made this way is never committed.
 */
export async function captureLoopbackFixture(
  url,
  { extraOrigins = [], settleMs = 1000 } = {},
) {
  const synthetic = (value, hosts) => {
    const parsed = URL.canParse(value) ? new URL(value) : null;
    if (
      parsed?.protocol !== "http:" ||
      !hosts.includes(parsed.hostname) ||
      !parsed.port
    )
      throw new CaptureRefusal(
        "not-loopback-fixture",
        `${value} is not a synthetic http://127.0.0.1:<port> page.`,
      );
    return parsed;
  };
  const origins = [
    synthetic(url, ["127.0.0.1"]),
    ...extraOrigins.map((origin) =>
      synthetic(origin, ["127.0.0.1", "localhost"]),
    ),
  ];
  return captureWithEdge({
    applicationId: "synthetic",
    mode: "loopback-fixture",
    url,
    policy: connectionPolicy({
      mode: "loopback-fixture",
      allowed: origins.map((origin) => origin.host),
    }),
    context: {
      mode: "loopback-fixture",
      keepOrigins: new Set(origins.map((origin) => origin.origin)),
    },
    settleMs,
  });
}

// ---------------------------------------------------------------- output

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

/**
 * SHA-256 of a capture's canonical JSON (sorted keys, no whitespace), so the
 * hash an evidence file pins survives reformatting and line-ending changes.
 */
export function canonicalSha256(capture) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(capture)), "utf8")
    .digest("hex");
}

const VOID_TAGS = new Set(["input", "frame", "br", "hr", "wbr"]);
const NEVER_IN_FIXTURE =
  /^(?:on.*|style|srcdoc|srcset|nonce|integrity|content|value)$/u;
const ALIASED_ORIGIN = /^(?:https?:)?\/\/origin-\d+\.invalid(?=\/|$)/u;
const escapeAttribute = (value) =>
  value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");

/**
 * A synthetic fixture draft of one captured document (the top one unless a
 * frame index is given): the captured elements with their attributes and
 * nothing else. Withheld attributes are written empty to keep their presence;
 * values, handlers, styles and frame sources are left out.
 */
export function renderFixtureHtml(capture, frameIndex = 0) {
  const lines = ["<!doctype html>"];
  const write = (node, depth) => {
    const indent = "  ".repeat(depth);
    const attributes = Object.entries(node.attributes).flatMap(
      ([name, value]) => {
        if ((node.tag === "iframe" || node.tag === "frame") && name === "src")
          return [];
        if (value === null)
          return NEVER_IN_FIXTURE.test(name) ? [] : [`${name}=""`];
        // A saved page's host is only an alias here; its path is what remains.
        const written = value.replace(ALIASED_ORIGIN, "") || "/";
        return [value === "" ? name : `${name}="${escapeAttribute(written)}"`];
      },
    );
    lines.push(`${indent}<${[node.tag, ...attributes].join(" ")}>`);
    if (VOID_TAGS.has(node.tag)) return;
    if (node.tag === "html")
      lines.push(
        `${indent}  <head>`,
        `${indent}    <meta charset="utf-8">`,
        `${indent}  </head>`,
      );
    if (node.shadow?.length) {
      lines.push(`${indent}  <template shadowrootmode="open">`);
      for (const child of node.shadow) write(child, depth + 2);
      lines.push(`${indent}  </template>`);
    }
    for (const child of node.children ?? []) write(child, depth + 1);
    lines.push(`${indent}</${node.tag}>`);
  };
  const frame = capture.frames[frameIndex];
  if (!frame?.tree)
    throw new Error(
      `frame ${frameIndex} is on another origin: its content is not captured`,
    );
  write(frame.tree, 0);
  return `${lines.join("\n")}\n`;
}

/** JSON as the repository's formatter writes it, when the formatter is there. */
async function formatJson(value, file) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const prettier = await import("prettier");
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(text, { ...options, parser: "json" });
  } catch {
    return text;
  }
}

const CAPTURE_FILE = /^capture[\w.-]*\.json$/u;

/** The one capture file given, or every capture of a corpus directory. */
function captureFiles(target) {
  const stats = statSync(target, { throwIfNoEntry: false });
  if (stats?.isFile()) return [target];
  if (!stats?.isDirectory())
    throw new CaptureRefusal(
      "usage",
      `${target} is neither a capture file nor a corpus directory; nothing was changed.`,
    );
  const files = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isFile() && CAPTURE_FILE.test(entry.name))
      files.push(path.join(target, entry.name));
    else if (entry.isDirectory())
      for (const name of readdirSync(path.join(target, entry.name)))
        if (CAPTURE_FILE.test(name))
          files.push(path.join(target, entry.name, name));
  }
  return files.sort();
}

/**
 * `--resanitize`: rewrites existing captures under the current rules. It reads
 * and writes files and does nothing else: no browser, no guard, no lookup.
 */
async function resanitizeFiles(target, { updateEvidence }) {
  for (const file of captureFiles(path.resolve(target))) {
    let before;
    try {
      before = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw new CaptureRefusal(
        "usage",
        `${file} is not JSON; nothing was changed.`,
      );
    }
    const after = resanitizeCapture(before);
    const earlier = canonicalSha256(before);
    const current = canonicalSha256(after);
    if (earlier === current) {
      console.log(`unchanged        ${file}`);
      console.log(`captureSha256    ${current}`);
      continue;
    }
    await writeFile(file, await formatJson(after, file), "utf8");
    console.log(`resanitized      ${file}`);
    console.log(`captureSha256    ${earlier} -> ${current}`);
    // Evidence pins the earlier hash: the application's own, and that of any
    // application citing this capture from a sibling directory.
    const corpus = path.dirname(path.dirname(file));
    for (const entry of readdirSync(corpus, { withFileTypes: true })) {
      const evidence = path.join(corpus, entry.name, "evidence.json");
      if (!entry.isDirectory() || !existsSync(evidence)) continue;
      const text = await readFile(evidence, "utf8");
      if (!text.includes(earlier)) continue;
      if (updateEvidence) {
        await writeFile(evidence, text.replaceAll(earlier, current), "utf8");
        console.log(`evidence updated ${evidence}`);
      } else
        console.log(
          `evidence to edit ${evidence} (its captureSha256; or pass --update-evidence)`,
        );
    }
  }
}

/**
 * The command. `corpus`, `hosted` and `lookup` exist for the tool's own tests:
 * a temporary corpus, a stand-in for the load, and a name lookup that fails.
 */
export async function runCaptureCommand(
  argv,
  {
    corpus = path.join(repo, CORPUS_PATH),
    hosted = captureHosted,
    lookup,
  } = {},
) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        id: { type: "string" },
        url: { type: "string" },
        "from-file": { type: "string" },
        out: { type: "string" },
        fixture: { type: "string" },
        "settle-ms": { type: "string" },
        resanitize: { type: "string" },
        "update-evidence": { type: "boolean", default: false },
        list: { type: "boolean", default: false },
      },
    }));
  } catch {
    throw new CaptureRefusal("usage", USAGE);
  }
  // Every error that leaves this command says what it means for the one load
  // of a page: a refusal, a run that requests no page, or a hosted run that
  // failed before, during or after its load.
  const offline =
    values.resanitize !== undefined ||
    values.list ||
    values["from-file"] !== undefined;
  let stage = "before";
  let written = null;
  try {
    return await carryOut(values, { corpus, hosted, lookup }, (next, file) => {
      stage = next;
      written = file ?? null;
    });
  } catch (error) {
    if (
      error instanceof CaptureRefusal ||
      error instanceof CaptureFailure ||
      error instanceof OfflineFailure
    )
      throw error;
    const message = error?.message ?? String(error);
    if (offline) throw new OfflineFailure(message, { cause: error });
    throw new CaptureFailure(
      stage === "after"
        ? `the page was read, but the capture was not written: ${message}`
        : message,
      // Inside the load nothing says whether the site was reached: it counts.
      { loadAttempted: stage !== "before", written },
    );
  }
}

async function carryOut(values, { corpus, hosted, lookup }, reached) {
  if (values.resanitize !== undefined) {
    for (const option of ["id", "url", "from-file", "out", "fixture"])
      if (values[option] !== undefined)
        throw new CaptureRefusal(
          "usage",
          `--resanitize rewrites existing captures and loads nothing; it cannot be combined with --${option}.`,
        );
    await resanitizeFiles(values.resanitize, {
      updateEvidence: values["update-evidence"],
    });
    return null;
  }
  if (values["update-evidence"]) throw new CaptureRefusal("usage", USAGE);
  const catalog = loadCatalogTargets();
  if (values.list) {
    for (const [id, url] of catalog) console.log(`${id.padEnd(28)} ${url}`);
    return null;
  }
  const target = resolveCaptureTarget(
    { id: values.id, url: values.url, fromFile: values["from-file"] },
    catalog,
  );
  const out = path.resolve(
    values.out ?? path.join(corpus, target.applicationId, "capture.json"),
  );
  const fixture = values.fixture ? path.resolve(values.fixture) : null;
  for (const file of [out, fixture])
    if (file && existsSync(file))
      throw new CaptureRefusal(
        "already-exists",
        `${file} already exists and is never overwritten. A page is captured once; ` +
          "remove the file only if that capture must be replaced.",
      );

  let capture;
  let run = null;
  if (target.kind === "file")
    capture = await captureFromFile(target.file, target);
  else {
    const earlier = findExistingCapture(corpus, target.url);
    if (earlier)
      throw new CaptureRefusal(
        "already-captured",
        `${target.url} was already captured in ${path.relative(repo, earlier)}. ` +
          "One load per provider: cite that capture instead of loading the page again.",
      );
    // The tool enforces the address, input and one-load rules. It does not
    // read a site's robots rules or terms: that is the operator's check.
    console.error(
      `Reminder: this tool does not read robots.txt or the provider's terms. Both must have been checked for ${new URL(target.url).host} before this run (${CORPUS_PATH}/README.md).`,
    );
    reached("loading");
    ({ capture, run } = await hosted(target, {
      settleMs:
        values["settle-ms"] === undefined
          ? undefined
          : Number.parseInt(values["settle-ms"], 10),
      catalog,
      lookup,
    }));
    reached("after");
  }

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await formatJson(capture, out), {
    encoding: "utf8",
    flag: "wx",
  });
  // From here on a failure loses nothing: the capture is on disk.
  if (run) reached("written", out);
  if (fixture) {
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(fixture, renderFixtureHtml(capture), {
      encoding: "utf8",
      flag: "wx",
    });
  }
  // What a person filling in the form would see: fields and buttons.
  let fields = 0;
  let passwords = 0;
  const count = (node) => {
    const type = String(node.attributes?.type ?? "").toLowerCase();
    if (
      ["select", "textarea", "button"].includes(node.tag) ||
      (node.tag === "input" && type !== "hidden")
    )
      fields++;
    if (node.tag === "input" && type === "password") passwords++;
    for (const child of [...(node.children ?? []), ...(node.shadow ?? [])])
      count(child);
  };
  for (const frame of capture.frames) if (frame.tree) count(frame.tree);
  console.log(`capture          ${out}`);
  if (fixture) console.log(`fixture draft    ${fixture}`);
  console.log(`captureSha256    ${canonicalSha256(capture)}`);
  console.log(
    `found            ${fields} form control${fields === 1 ? "" : "s"}${passwords ? ", including a password field" : " and no password field"}`,
  );
  if (target.kind === "file" && fields === 0)
    console.log(
      'This looks like an empty shell: the page as it is before its scripts run. Save the page again as "Webpage, Complete" once the sign-in form is on screen; "Webpage, HTML only" downloads the address afresh and loses a form that scripts built.',
    );
  console.log(
    `read             ${capture.frames.length} frame(s); ${capture.observations.join(", ")}`,
  );
  if (run) {
    console.log(
      `loaded           ${capture.source.requestedUrl} -> ${capture.source.finalUrl} (HTTP ${capture.source.httpStatus ?? "?"})`,
    );
    console.log(
      `contacted        ${capture.network.contacted.join(" ") || "-"}`,
    );
    if (run.refused.length)
      console.log(
        `refused by guard ${run.refused.length} connection target(s)`,
      );
    // A redirect to another public host is followed: the page that was
    // captured is then that host's, and the standard applies to it as well.
    const ended = httpOrigin(capture.source.finalUrl);
    if (ended && ended !== new URL(target.url).origin)
      console.error(
        `Reminder: the page redirected and was captured on ${new URL(ended).host}. The robots.txt and terms check applies to that host as well; if it was not made, do not use this capture.`,
      );
  }
  return capture;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    await runCaptureCommand(process.argv.slice(2));
  } catch (error) {
    console.error(describeOutcome(error));
    process.exitCode = exitCodeFor(error);
  }
}
