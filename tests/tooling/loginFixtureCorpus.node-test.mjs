// Corpus check for tests/fixtures/logins. The standard it enforces is written
// down in tests/fixtures/logins/README.md and evidence.schema.json.
//
//   node --test tests/tooling/loginFixtureCorpus.node-test.mjs
//   node --test --test-name-pattern="logins/<id>" tests/tooling/loginFixtureCorpus.node-test.mjs
//
// LOGIN_CORPUS_STRICT=1 (gates) also requires an evidence record for every
// catalog application without a reviewed login, and a coverage document that
// is exactly what the catalog, the evidence and the steps files give.
//
// LOGIN_COVERAGE_WRITE=1 rewrites the generated parts of that document:
//
//   LOGIN_COVERAGE_WRITE=1 node --test tests/tooling/loginFixtureCorpus.node-test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import {
  CAPTURE_SANITIZER,
  CAPTURE_SCHEMA,
  canonicalSha256,
  captureFromFile,
  classifyHost,
  NON_PUBLIC_SUFFIXES,
  looksSecret,
  renderFixtureHtml,
  resanitizeCapture,
  sanitizeFrameName,
} from "../../scripts/capture-login-page.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const CORPUS = "tests/fixtures/logins";
const STEPS = "src/data/loginSteps";
const STEPS_SCHEMA = "src/types/connection/httpLoginSteps.schema.json";
const COVERAGE = "docs/application-login-coverage.md";
const STRICT = process.env.LOGIN_CORPUS_STRICT === "1";
const SUPPORT_GATE = "src/utils/connection/declarativeLoginSupport.ts";
const COVERAGE_WRITE = process.env.LOGIN_COVERAGE_WRITE === "1";
const REGENERATE =
  "LOGIN_COVERAGE_WRITE=1 node --test tests/tooling/loginFixtureCorpus.node-test.mjs";
const MAX_FIXTURE_BYTES = 64 * 1024;
const MAX_CAPTURE_BYTES = 512 * 1024;
const MAX_FIXTURE_TEXT = 1000;

const readText = (file) =>
  fs.readFileSync(file, "utf8").replace(/\r\n/gu, "\n");
const readJson = (file) => JSON.parse(readText(file));
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// ------------------------------------------------- JSON schema (the subset used)

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const KEYWORDS = new Set([
  ...ANNOTATIONS,
  "$defs",
  "$ref",
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "maxLength",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "allOf",
  "anyOf",
  "not",
  "if",
  "then",
  "else",
]);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const typeOf = (value) =>
  Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

function resolveRef(root, ref) {
  const name = /^#\/\$defs\/([A-Za-z0-9]+)$/u.exec(ref)?.[1];
  const target = name && root.$defs?.[name];
  if (!target) throw new Error(`unresolved $ref ${ref}`);
  return target;
}

/** Validates `value` against the keywords listed in KEYWORDS. */
function schemaErrors(schema, value, root = schema, at = "") {
  const errors = [];
  const fail = (message) => errors.push(`${at || "(file)"} ${message}`);
  const check = (sub, item = value, where = at) =>
    schemaErrors(sub, item, root, where);
  if (schema.$ref) errors.push(...check(resolveRef(root, schema.$ref)));
  if ("const" in schema && !same(value, schema.const))
    fail(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((option) => same(option, value)))
    fail(`must be one of: ${schema.enum.join(", ")}`);
  if (schema.type && typeOf(value) !== schema.type) {
    fail(`must be of type ${schema.type}`);
    return errors;
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      fail(`is shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength)
      fail(`is longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      fail("does not have the required form");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      fail(`needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      fail(`allows at most ${schema.maxItems} item(s)`);
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    )
      fail("has duplicate items");
    if (schema.items)
      value.forEach((item, index) =>
        errors.push(...check(schema.items, item, `${at}[${index}]`)),
      );
  }
  if (isObject(value)) {
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(value, key)) fail(`is missing "${key}"`);
    for (const [key, sub] of Object.entries(schema.properties ?? {}))
      if (Object.hasOwn(value, key))
        errors.push(...check(sub, value[key], at ? `${at}.${key}` : key));
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value))
        if (!Object.hasOwn(schema.properties ?? {}, key))
          fail(`has an unknown field "${key}"`);
  }
  for (const sub of schema.allOf ?? []) errors.push(...check(sub));
  if (schema.anyOf && !schema.anyOf.some((sub) => check(sub).length === 0))
    fail("matches none of the allowed forms");
  if (schema.not && check(schema.not).length === 0)
    fail("has a combination of fields that is not allowed");
  if (schema.if) {
    const branch = check(schema.if).length === 0 ? schema.then : schema.else;
    if (branch) errors.push(...check(branch));
  }
  return errors;
}

/** Every keyword the schema uses must be one this file enforces. */
function unsupportedKeywords(schema, at = "#") {
  const found = [];
  if (!isObject(schema)) return [`${at} is not a schema object`];
  for (const [key, value] of Object.entries(schema)) {
    if (!KEYWORDS.has(key)) found.push(`${at}/${key}`);
    else if (key === "properties" || key === "$defs")
      for (const [name, sub] of Object.entries(value))
        found.push(...unsupportedKeywords(sub, `${at}/${key}/${name}`));
    else if (key === "allOf" || key === "anyOf")
      value.forEach((sub, index) =>
        found.push(...unsupportedKeywords(sub, `${at}/${key}/${index}`)),
      );
    else if (["items", "not", "if", "then", "else"].includes(key))
      found.push(...unsupportedKeywords(value, `${at}/${key}`));
    else if (key === "additionalProperties" && value !== false)
      found.push(`${at}/additionalProperties must be false`);
  }
  if (schema.type === "object" && schema.additionalProperties !== false)
    found.push(`${at} is an open object`);
  return found;
}

// --------------------------------------------- anything resembling a credential

const RESERVED_MAIL =
  /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:example|test|invalid|localhost))$/iu;
const CREDENTIAL_RULES = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ["a JSON web token", /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/u],
  [
    "an Authorization header",
    /\bAuthorization\s*:\s*\S|\b(?:Basic|Bearer)\s+(?=[A-Za-z0-9+/_.-]*[0-9=])[A-Za-z0-9+/=_.-]{16,}/u,
  ],
  ["a Cookie header", /\b(?:Set-Cookie|Cookie)\s*:\s*[^\s=;]+=/u],
  [
    "user information in a URL",
    /[a-z][a-z0-9+.-]*:\/\/[^\s/@"'<>]+:[^\s/@"'<>]+@/iu,
  ],
  [
    "an assigned secret",
    /\b(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*=\s*["']?[^\s"'&<>\]]{4,}/iu,
  ],
  ["an authenticator secret URI", /\botpauth:\/\//iu],
  [
    "a provider access key",
    /\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAIza[\w-]{30,}|\bsk-[A-Za-z0-9]{20,}/u,
  ],
];

/**
 * Why `text` looks like it carries a credential, an account or a private
 * address. `citation` relaxes the two rules a pinned URL, a commit or a hash
 * legitimately trips (long hexadecimal runs, `name@version`).
 */
function credentialFindings(text, { citation = false } = {}) {
  const found = [];
  for (const [label, pattern] of CREDENTIAL_RULES)
    if (pattern.test(text)) found.push(label);
  for (const [address] of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu))
    if (["loopback", "private", "link-local"].includes(classifyHost(address)))
      found.push(`a ${classifyHost(address)} address`);
  if (citation) return [...new Set(found)];
  for (const [mail] of text.matchAll(
    /[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu,
  ))
    if (!RESERVED_MAIL.test(mail)) found.push("an email address");
  for (const [run] of text.matchAll(/[A-Za-z0-9+/=_-]{24,}/gu))
    if (looksSecret(run)) found.push("a long random-looking token");
  return [...new Set(found)];
}

const CITATION_FIELDS = new Set([
  "$schema",
  "url",
  "path",
  "commit",
  "capture",
  "captureSha256",
  "source",
]);

function jsonCredentialFindings(value, key = "", at = "") {
  if (typeof value === "string")
    return credentialFindings(value, {
      citation: CITATION_FIELDS.has(key),
    }).map((finding) => `${at || "(file)"} looks like ${finding}`);
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      jsonCredentialFindings(item, key, `${at}[${index}]`),
    );
  if (isObject(value))
    return Object.entries(value).flatMap(([name, item]) =>
      jsonCredentialFindings(item, name, at ? `${at}.${name}` : name),
    );
  return [];
}

// ------------------------------------------------------------- fixtures

const FORBIDDEN_ELEMENTS = [
  "script",
  "style",
  "link",
  "base",
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  "object",
  "embed",
  "applet",
  "canvas",
  "svg",
  "math",
  "meta[http-equiv]",
];
const FORBIDDEN_ATTRIBUTES = new Set([
  "srcdoc",
  "srcset",
  "background",
  "poster",
  "ping",
  "manifest",
  "data",
  "integrity",
  "nonce",
]);
const CONTROL_ELEMENTS = "input,button,select,textarea,iframe,frame";

function allElements(root) {
  const elements = [];
  for (const element of root.querySelectorAll("*")) {
    elements.push(element);
    if (element.localName === "template")
      elements.push(...allElements(element.content));
  }
  return elements;
}

function parseFixture(text) {
  return new JSDOM(text, { contentType: "text/html" });
}

/** What makes a fixture something other than minimal synthetic controls. */
function fixtureErrors(text, { origins, files }) {
  const errors = [];
  if (Buffer.byteLength(text, "utf8") > MAX_FIXTURE_BYTES)
    errors.push(`is larger than ${MAX_FIXTURE_BYTES} bytes`);
  const dom = parseFixture(text);
  const { document, NodeFilter } = dom.window;
  const elements = allElements(document);
  for (const element of elements) {
    const tag = element.localName;
    if (element.matches(FORBIDDEN_ELEMENTS.join(",")))
      errors.push(`has a <${tag}> element (no scripts, styles or assets)`);
    if (tag === "template" && !element.hasAttribute("shadowrootmode"))
      errors.push("has a <template> that is not a declarative shadow root");
    for (const { name, value } of element.attributes) {
      if (name.startsWith("on"))
        errors.push(`has an inline ${name} handler on <${tag}>`);
      else if (FORBIDDEN_ATTRIBUTES.has(name))
        errors.push(`has a ${name} attribute on <${tag}>`);
      else if (
        name === "style" &&
        /url\s*\(|@import|expression\s*\(/iu.test(value)
      )
        errors.push(`loads a resource from a style attribute on <${tag}>`);
      else if (name === "src") {
        const frame = tag === "iframe" || tag === "frame";
        if (!frame) errors.push(`loads ${tag} src (no assets)`);
        else if (value !== "" && value !== "about:blank" && !files.has(value))
          errors.push(
            `frames "${value}": a frame may only show a listed fixture file of this directory`,
          );
      } else if (["action", "formaction", "href"].includes(name)) {
        const scheme = /^\s*([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1];
        if (value.trim().startsWith("//"))
          errors.push(`has a protocol-relative ${name}`);
        else if (scheme && !/^https?$/iu.test(scheme)) {
          if (value.trim().toLowerCase() !== "javascript:")
            errors.push(
              `has a ${scheme}: ${name} (only the bare "javascript:" marker is allowed)`,
            );
        }
      }
    }
    if (
      tag === "input" &&
      (element.getAttribute("type") ?? "").toLowerCase() === "password" &&
      (element.getAttribute("value") ?? "") !== ""
    )
      errors.push("has a password field with a value");
  }
  if (!elements.some((element) => element.matches(CONTROL_ELEMENTS)))
    errors.push("has no form control");

  let textLength = 0;
  const walker = document.createTreeWalker(
    document,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    textLength += node.nodeValue.replace(/\s+/gu, "").length;
  if (textLength > MAX_FIXTURE_TEXT)
    errors.push(
      `holds ${textLength} characters of text and comments (at most ${MAX_FIXTURE_TEXT}; a fixture is controls, not page copy)`,
    );

  // Every absolute URL, wherever it is written, names a declared origin.
  for (const [url] of text.matchAll(/\bhttps?:\/\/[^\s"'<>)]+/giu)) {
    const origin = URL.canParse(url) ? new URL(url).origin : null;
    if (!origin || !origins.has(origin))
      errors.push(
        `names ${origin ?? url}, which is not an origin of a listed fixture`,
      );
  }
  dom.window.close();
  return [...new Set(errors)];
}

/** Whether a parsed selector matches an element of the document. */
function matches(document, selector) {
  try {
    return document.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

/**
 * The alternatives of a selector list: split on its top-level commas only,
 * so a comma inside brackets, quotes or a functional pseudo-class such as
 * `:is(a, b)` or `:has(> a, b)` stays where it is. `null` when the brackets,
 * parentheses or quotes do not balance, or an alternative is empty.
 */
function selectorAlternatives(selector) {
  const parts = [];
  let parentheses = 0;
  let brackets = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === "\\") index++;
    else if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "[") brackets++;
    else if (character === "]") brackets--;
    else if (character === "(") parentheses++;
    else if (character === ")") parentheses--;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      parts.push(selector.slice(start, index));
      start = index + 1;
    }
    if (parentheses < 0 || brackets < 0) return null;
  }
  if (quote || parentheses !== 0 || brackets !== 0) return null;
  parts.push(selector.slice(start));
  const alternatives = parts.map((part) => part.trim());
  return alternatives.some((part) => part === "") ? null : alternatives;
}

const PROBE = new JSDOM("<!doctype html><html><body></body></html>").window
  .document;

/**
 * The alternatives of a selector, each one a selector the static parser
 * accepts; `null` for a selector that cannot be parsed. A selector that
 * cannot be parsed can be neither checked nor run, so it fails its directory.
 */
function parsedAlternatives(selector) {
  const alternatives = selectorAlternatives(selector);
  if (!alternatives) return null;
  try {
    for (const alternative of alternatives) PROBE.querySelector(alternative);
  } catch {
    return null;
  }
  return alternatives;
}

/** The ids and field names a selector spells out: `#user`, `[name="user"]`. */
function selectorIdentifiers(selector) {
  const names = new Set();
  const outside = selector.replace(/\[[^\]]*\]/gu, " ");
  for (const [, id] of outside.matchAll(/#((?:[\w-]|\\.)+)/gu))
    names.add(id.replaceAll("\\", ""));
  for (const [, double, single, bare] of selector.matchAll(
    /\[\s*(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))/giu,
  ))
    names.add(double ?? single ?? bare);
  names.delete("");
  return [...names];
}

// -------------------------------------------------------------- captures

const CAPTURE_WITHHELD =
  /^(?:on.*|style|srcdoc|srcset|nonce|integrity|content|placeholder|title|alt|label|summary|aria-label|aria-description|aria-placeholder|aria-valuetext|aria-roledescription|data-sitekey)$/u;
const CAPTURE_URLS = new Set(["action", "formaction", "src", "href"]);

function captureNodeErrors(node, at) {
  const errors = [];
  if (
    !isObject(node) ||
    typeof node.tag !== "string" ||
    !isObject(node.attributes)
  )
    return [`${at} is not a captured element`];
  for (const key of Object.keys(node))
    if (
      ![
        "tag",
        "attributes",
        "rendered",
        "options",
        "children",
        "shadow",
      ].includes(key)
    )
      errors.push(`${at} has an unexpected "${key}"`);
  const button =
    node.tag === "button" ||
    (node.tag === "input" &&
      ["submit", "button", "reset", "image", "checkbox", "radio"].includes(
        String(node.attributes.type ?? "").toLowerCase(),
      ));
  for (const [name, value] of Object.entries(node.attributes)) {
    if (value !== null && typeof value !== "string")
      errors.push(`${at} ${name} is not a string`);
    else if (value === null) continue;
    else if (CAPTURE_WITHHELD.test(name))
      errors.push(`${at} keeps the value of ${name}`);
    else if (name === "value" && !button)
      errors.push(`${at} keeps a field value`);
    else if (CAPTURE_URLS.has(name) && /[?#]./u.test(value))
      errors.push(`${at} keeps a URL query or fragment in ${name}`);
    else if (value.length > 256) errors.push(`${at} ${name} is too long`);
  }
  for (const [list, label] of [
    [node.children, "children"],
    [node.shadow, "shadow"],
  ])
    (list ?? []).forEach((child, index) =>
      errors.push(...captureNodeErrors(child, `${at}.${label}[${index}]`)),
    );
  return errors;
}

/** A capture must still look like what the tool writes, not a hand edit. */
function captureErrors(capture) {
  const errors = [];
  if (!isObject(capture) || capture.schema !== CAPTURE_SCHEMA)
    return [`is not a ${CAPTURE_SCHEMA} capture`];
  if (!["hosted", "file"].includes(capture.mode))
    errors.push(
      `was made in "${capture.mode}" mode; only hosted and saved-page captures belong in the corpus`,
    );
  if (capture.limits?.input !== "none")
    errors.push("does not state input: none");
  if (!Array.isArray(capture.frames) || capture.frames.length === 0)
    return [...errors, "has no frames"];
  capture.frames.forEach((frame, index) => {
    // A frame on another origin is listed without its content.
    if (frame?.tree === undefined && frame?.sameOriginAsTop === false) return;
    errors.push(...captureNodeErrors(frame?.tree, `frames[${index}].tree`));
  });
  return errors;
}

// ------------------------------------------------------------ the checker

const AUTHORITATIVE = new Set([
  "repository",
  "public-source",
  "cdp-auth",
  "user-capture",
  "user-confirmation",
]);
const MOVING_REF =
  /\/(?:blob|tree|raw|branch|heads)\/(?:main|master|HEAD|develop|dev|trunk|latest|next)(?:\/|$)|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(?:main|master|HEAD|develop|dev|trunk)\//u;
const STANDARD_FILE =
  /^(?:evidence\.json|fixture(?:\.[a-z0-9-]+)*\.html|capture(?:\.[a-z0-9-]+)*\.json)$/u;

const realDate = (text) => {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
};

/** The citation a source contributes: what `source` at the top may repeat. */
const citationOf = (source, id) =>
  source.url ??
  source.path ??
  (source.capture
    ? path.posix.normalize(`${CORPUS}/${id}/${source.capture}`)
    : null);

function loadCatalog(root) {
  const targets = readJson(
    path.join(root, "src/utils/protocol/originBrowserApplicationTargets.json"),
  ).profiles;
  const native = readJson(
    path.join(
      root,
      "src-tauri/crates/sorng-browser-host/src/native_login_catalog.json",
    ),
  ).profiles;
  return new Map(
    Object.keys(native).map((id) => [
      id,
      {
        capability: native[id].capability,
        loginFlow: native[id].loginFlow ?? targets[id]?.loginFlow ?? null,
        hostedLoginUrl: targets[id]?.hostedLoginUrl ?? null,
      },
    ]),
  );
}

/** Application id -> steps files, from `<stepsRoot>/<family>/<id>.json`. */
function indexSteps(stepsRoot) {
  const index = new Map();
  if (!fs.existsSync(stepsRoot)) return index;
  for (const family of fs.readdirSync(stepsRoot, { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(stepsRoot, family.name))) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      index.set(id, [
        ...(index.get(id) ?? []),
        path.join(stepsRoot, family.name, name),
      ]);
    }
  }
  return index;
}

/**
 * Why the steps validator refuses `origin` as a listed credential origin
 * (issue codes), or nothing. Asked through a minimal steps file, because that
 * validator, not a copied pattern, is the authority on origins.
 */
function listedOriginIssues(validator, origin) {
  const result = validator.validateHttpLoginSteps(
    {
      version: 1,
      id: "probe",
      evidence: { class: "A", source: "probe", reviewed: "2026-01-01" },
      credentialOrigins: [origin],
      loginSteps: [
        {
          kind: "form",
          origin,
          selectors: { username: "input", password: "input.password" },
        },
      ],
    },
    { id: "probe" },
  );
  return result.ok
    ? []
    : [...new Set(result.issues.map((issue) => issue.code))];
}

async function loadStepsValidator(root) {
  const file = path.join(root, "src/utils/connection/httpLoginSteps.ts");
  if (!fs.existsSync(file)) return null;
  try {
    return await import(pathToFileURL(file).href);
  } catch (error) {
    return { unavailable: String(error?.message ?? error) };
  }
}

/** The selectors of a steps file, each with the scope it must match in. */
function stepSelectors(steps) {
  const wanted = [];
  let scope = null;
  steps.loginSteps.forEach((step, index) => {
    if (step.kind !== "submit")
      scope = {
        origin: step.origin ?? null,
        frame: step.frame ?? null,
        gate: step,
      };
    const at = `loginSteps[${index}]`;
    for (const [name, selector] of Object.entries(step.selectors ?? {}))
      wanted.push({ at: `${at}.selectors.${name}`, selector, scope });
    if (step.waitFor)
      wanted.push({ at: `${at}.waitFor`, selector: step.waitFor, scope });
  });
  (steps.totpChallenges ?? []).forEach((challenge, index) => {
    for (const origin of challenge.origins ?? [null]) {
      const totp = { origin, frame: null, gate: { paths: challenge.paths } };
      for (const name of ["codeSelector", "submitSelector"])
        wanted.push({
          at: `totpChallenges[${index}].${name}`,
          selector: challenge[name],
          scope: totp,
        });
    }
  });
  return wanted;
}

/** An instruction that names "HTML only" or asks for a page "as HTML". */
const SAVED_AS_HTML = /\bHTML only\b|\bas (?:an? )?HTML\b/iu;

/**
 * Checks one application directory. `errors` fail the corpus; `notes` are
 * printed. Nothing here reads the network or runs a fixture's content.
 */
function checkApplication(directory, context) {
  const errors = [];
  const notes = [];
  const id = path.basename(directory);
  const fail = (message) => errors.push(message);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) fail(`${entry.name}/ is a subdirectory`);
    else if (!STANDARD_FILE.test(entry.name))
      fail(
        `${entry.name} is not a corpus file (evidence.json, fixture*.html, capture*.json only)`,
      );
  }
  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  if (!names.has("evidence.json")) {
    fail("evidence.json is missing");
    return { errors, notes };
  }

  // Raw text first: nothing resembling a credential in any file.
  const texts = new Map();
  for (const name of names) {
    const text = readText(path.join(directory, name));
    texts.set(name, text);
    if (name.endsWith(".html"))
      for (const finding of credentialFindings(text))
        fail(`${name} looks like it holds ${finding}`);
  }

  let evidence;
  try {
    evidence = JSON.parse(texts.get("evidence.json"));
  } catch (error) {
    fail(`evidence.json is not valid JSON: ${error.message}`);
    return { errors, notes };
  }
  const invalid = schemaErrors(context.schema, evidence);
  for (const finding of jsonCredentialFindings(evidence))
    fail(`evidence.json ${finding}`);
  if (invalid.length) {
    for (const message of invalid) fail(`evidence.json ${message}`);
    return { errors, notes };
  }

  const profile = context.catalog.get(id);
  if (evidence.id !== id)
    fail(`evidence.json id "${evidence.id}" is not "${id}"`);
  if (!profile && !evidence.proposedProfile)
    fail(
      `"${id}" is not a catalog application; a new profile needs "proposedProfile": true`,
    );
  if (profile && evidence.proposedProfile)
    notes.push(`${id} is in the catalog now; drop proposedProfile`);
  if (profile && evidence.mechanism === "adapter" && !profile.loginFlow)
    fail(`mechanism "adapter" but the catalog gives ${id} no loginFlow`);
  if (
    profile &&
    evidence.mechanism === "http-auth" &&
    profile.capability !== "http-auth"
  )
    fail(
      `mechanism "http-auth" but the catalog capability is ${profile.capability}`,
    );

  // A page the user is asked to save: "Webpage, HTML only" downloads the
  // address again instead of saving what is on screen, so an instruction that
  // names that format, or asks for "HTML" and names none, must name the one
  // that keeps the form. Only the instruction is held to this.
  if (
    typeof evidence.neededFromUser === "string" &&
    SAVED_AS_HTML.test(evidence.neededFromUser) &&
    !evidence.neededFromUser.includes("Webpage, Complete")
  )
    fail(
      `neededFromUser asks for a page saved as HTML, or names "HTML only", without naming the format to use: say "Webpage, Complete" ("HTML only" downloads the address again and misses a form that a script drew)`,
    );

  // Dates.
  for (const [label, date] of [
    ["reviewed", evidence.reviewed],
    ...evidence.sources.map((source) => [
      `source ${source.id} retrieved`,
      source.retrieved,
    ]),
  ]) {
    if (!realDate(date)) fail(`${label} ${date} is not a calendar date`);
    else if (date > context.latestDate)
      fail(`${label} ${date} is in the future`);
    else if (date > evidence.reviewed)
      fail(`${label} ${date} is after the review (${evidence.reviewed})`);
  }

  // Sources. What a source demonstrably contains is kept for the selectors:
  // the text of a cited repository file, the documents of a capture.
  const sources = new Map();
  const sourceText = new Map();
  const sourceDocuments = new Map();
  for (const source of evidence.sources) {
    if (sources.has(source.id)) fail(`source id "${source.id}" is used twice`);
    sources.set(source.id, source);
    if (source.url) {
      const { hostname } = new URL(source.url);
      if (classifyHost(hostname) !== "public")
        fail(
          `source ${source.id} is on ${classifyHost(hostname)} host ${hostname}`,
        );
    }
    if (source.kind === "repository") {
      // A fixture or steps file is what the evidence explains, never its proof.
      if (new RegExp(`^(?:${CORPUS}|${STEPS})(?:/|$)`, "u").test(source.path))
        fail(
          `source ${source.id} cites ${source.path}: the corpus and the steps data are not sources`,
        );
      else if (
        !fs
          .statSync(path.join(context.repo, source.path), {
            throwIfNoEntry: false,
          })
          ?.isFile()
      )
        fail(`source ${source.id} cites ${source.path}, which does not exist`);
      else
        sourceText.set(
          source.id,
          readText(path.join(context.repo, source.path)),
        );
    }
    if (
      ["public-source", "cdp-auth"].includes(source.kind) &&
      MOVING_REF.test(source.url)
    )
      fail(
        `source ${source.id} points at a moving branch; pin the URL to a commit or a release tag`,
      );
    if (source.capture) {
      const file = path.join(directory, source.capture);
      const label = `source ${source.id} capture ${source.capture}`;
      if (!fs.existsSync(file)) {
        fail(`${label} does not exist`);
        continue;
      }
      let capture;
      try {
        capture = readJson(file);
      } catch {
        fail(`${label} is not valid JSON`);
        continue;
      }
      if (canonicalSha256(capture) !== source.captureSha256)
        fail(
          `${label} does not match captureSha256: the capture was changed after it was made`,
        );
      // What the capture shows is what the current rules keep of it: a
      // selector that matches only inside a frame of another origin was not
      // observed in the application's own page.
      let shown = null;
      try {
        shown = resanitizeCapture(capture);
      } catch {
        // Not a capture: reported with the files of the directory.
      }
      if (shown && captureErrors(shown).length === 0)
        sourceDocuments.set(
          source.id,
          shown.frames.flatMap((frame, index) =>
            frame.tree
              ? [parseFixture(renderFixtureHtml(shown, index)).window.document]
              : [],
          ),
        );
      const wanted = source.kind === "anonymous-capture" ? "hosted" : "file";
      if (capture.mode !== wanted)
        fail(`${label} is a "${capture.mode}" capture, not a ${wanted} one`);
      if (source.kind === "anonymous-capture") {
        if (capture.source?.requestedUrl !== source.url)
          fail(
            `${label} was made from ${capture.source?.requestedUrl}, not ${source.url}`,
          );
        if (source.url !== profile?.hostedLoginUrl)
          fail(
            `source ${source.id} url is not the catalog hostedLoginUrl of ${id}; only that page may be captured`,
          );
      }
    }
  }
  if (evidence.source !== undefined) {
    const cited = evidence.sources.filter(
      (source) => citationOf(source, id) === evidence.source,
    );
    if (cited.length === 0)
      fail(
        `source "${evidence.source}" is not the url, path or capture of a listed source`,
      );
    else if (
      evidence.class === "A" &&
      !cited.some((s) => AUTHORITATIVE.has(s.kind))
    )
      fail("class A but the primary source is not an authoritative kind");
  }

  // Captures present in the directory.
  for (const name of names) {
    if (!name.startsWith("capture")) continue;
    const text = texts.get(name);
    if (Buffer.byteLength(text, "utf8") > MAX_CAPTURE_BYTES)
      fail(`${name} is larger than ${MAX_CAPTURE_BYTES} bytes`);
    let capture;
    try {
      capture = JSON.parse(text);
    } catch {
      fail(`${name} is not valid JSON`);
      continue;
    }
    for (const message of captureErrors(capture)) fail(`${name} ${message}`);
    for (const finding of jsonCredentialFindings(capture))
      fail(`${name} ${finding}`);
    if (!evidence.sources.some((source) => source.capture === name))
      fail(`${name} is not cited by any source`);
    if (capture?.applicationId !== id)
      fail(`${name} was captured for "${capture?.applicationId}", not ${id}`);
    // What the capture saw standing in the way is part of the evidence.
    if (
      capture?.observations?.includes("captcha") &&
      !evidence.staysInteractive.some((entry) => entry.kind === "captcha")
    )
      fail(
        `${name} saw a challenge widget, but staysInteractive lists no captcha`,
      );
    // A frame name is page-controlled text. Both rules below are met by the
    // tool's offline re-sanitizing; the page is never loaded a second time.
    const fix = `It is fixed offline, without loading the page again: node scripts/capture-login-page.mjs --resanitize ${CORPUS}/${id}/${name} --update-evidence`;
    let current = null;
    try {
      current = resanitizeCapture(capture);
    } catch {
      // Not a capture at all: reported above.
    }
    // A written name must be the one the current rules would write. (The
    // rules, not the stored flag, say which frames share the top origin.)
    for (const [index, frame] of (capture?.frames ?? []).entries())
      if (
        frame?.name != null &&
        (current
          ? current.frames[index]?.name !== frame.name
          : sanitizeFrameName(frame.name) !== frame.name)
      )
        fail(
          `${name} frames[${index}].name is not the plain identifier of a same-origin frame. ${fix}`,
        );
    if (current && canonicalSha256(current) !== canonicalSha256(capture)) {
      const message = `${name} is not in the capture tool's current sanitized form (rules ${CAPTURE_SANITIZER}). ${fix}`;
      // A capture written before the current rules is brought under them in
      // one pass at the gate; one that claims the current rules must meet them.
      if (capture.sanitizer === CAPTURE_SANITIZER || context.strict)
        fail(message);
      else notes.push(message);
    }
  }

  // Fixtures.
  const listed = new Map();
  for (const fixture of evidence.fixtures) {
    if (listed.has(fixture.file))
      fail(`fixture ${fixture.file} is listed twice`);
    listed.set(fixture.file, fixture);
    // The steps format decides what may be a listed origin; ask it, so this
    // check cannot fall behind a copied pattern.
    if (fixture.origin && context.validator?.validateHttpLoginSteps) {
      const refused = listedOriginIssues(context.validator, fixture.origin);
      if (refused.length)
        fail(
          `fixture ${fixture.file} origin ${fixture.origin} is not acceptable to the steps format (${refused.join(", ")})`,
        );
    }
    for (const from of fixture.derivedFrom)
      if (!sources.has(from))
        fail(
          `fixture ${fixture.file} is derived from unknown source "${from}"`,
        );
      else if (
        evidence.class === "A" &&
        !AUTHORITATIVE.has(sources.get(from).kind)
      )
        fail(
          `class A but fixture ${fixture.file} is derived from ${sources.get(from).kind} source "${from}"`,
        );
  }
  const fixtureNames = [...names].filter((name) => name.endsWith(".html"));
  for (const name of fixtureNames)
    if (!listed.has(name)) fail(`${name} is not listed in fixtures`);
  for (const name of listed.keys())
    if (!names.has(name)) fail(`fixture ${name} is listed but does not exist`);
  if (evidence.mechanism === "form" && !listed.has("fixture.html"))
    fail("a form login needs fixture.html, the first document of the flow");
  // Origins a fixture may name: those of the listed fixtures, and for a hosted
  // application its own, which is the connection's origin.
  const origins = new Set(
    evidence.fixtures.flatMap((fixture) =>
      fixture.origin ? [fixture.origin] : [],
    ),
  );
  if (profile?.hostedLoginUrl)
    origins.add(new URL(profile.hostedLoginUrl).origin);
  const documents = new Map();
  for (const name of fixtureNames) {
    if (!listed.has(name)) continue;
    for (const message of fixtureErrors(texts.get(name), {
      origins,
      files: new Set(listed.keys()),
    }))
      fail(`${name} ${message}`);
    documents.set(name, parseFixture(texts.get(name)).window.document);
  }
  for (const [name, fixture] of listed) {
    if (!fixture.frame || !documents.has(name)) continue;
    const framed = `iframe[id="${fixture.frame}"],iframe[name="${fixture.frame}"],frame[id="${fixture.frame}"],frame[name="${fixture.frame}"]`;
    const parents = [...listed]
      .filter(([, top]) => !top.frame && top.origin === fixture.origin)
      .map(([file]) => documents.get(file));
    if (!parents.some((document) => document && matches(document, framed)))
      fail(
        `fixture ${name} is the content of frame "${fixture.frame}", but no top fixture of that origin has such a frame`,
      );
  }

  // Selectors: each one cited, class A only from what was observed, each one
  // matching the fixture that pins it.
  const cited = new Set();
  const citedAlternatives = new Set();
  for (const [index, entry] of evidence.selectors.entries()) {
    const at = `selectors[${index}]`;
    const alternatives = parsedAlternatives(entry.selector);
    if (!alternatives) {
      fail(`${at} is not a selector the checker can parse`);
      continue;
    }
    cited.add(entry.selector);
    for (const alternative of alternatives) citedAlternatives.add(alternative);
    // In messages: the selector itself, or the one alternative of its list.
    const named = (alternative) =>
      alternatives.length > 1 ? `${at} alternative "${alternative}"` : at;
    const source = sources.get(entry.source);
    if (!source) {
      fail(`${at} cites unknown source "${entry.source}"`);
      continue;
    }
    if (evidence.class === "A" && entry.basis !== "observed")
      fail(`class A but ${at} is ${entry.basis}`);
    if (evidence.class === "A" && !AUTHORITATIVE.has(source.kind))
      fail(`class A but ${at} cites ${source.kind} source "${source.id}"`);
    // "observed" is checked wherever the source is at hand, for every
    // alternative: each one claims to have been seen there.
    if (entry.basis === "observed" && sourceDocuments.has(source.id))
      for (const alternative of alternatives)
        if (
          !sourceDocuments
            .get(source.id)
            .some((document) => matches(document, alternative))
        )
          fail(
            `${named(alternative)} is marked observed, but matches nothing in ${source.capture}. A selector for something that capture does not show is "inferred", in an entry of its own.`,
          );
    if (entry.basis === "observed" && sourceText.has(source.id))
      for (const name of selectorIdentifiers(entry.selector))
        if (!sourceText.get(source.id).includes(name))
          fail(
            `${at} is marked observed in ${source.path}, which does not contain "${name}"`,
          );
    if (entry.fixture && !listed.has(entry.fixture)) {
      fail(`${at} names fixture ${entry.fixture}, which is not listed`);
      continue;
    }
    const candidates = (
      entry.fixture ? [entry.fixture] : [...documents.keys()]
    ).filter((file) => documents.has(file));
    if (documents.size === 0) continue;
    // The selector as written matches the fixture that pins it ...
    if (
      !candidates.some((file) =>
        alternatives.some((alternative) =>
          matches(documents.get(file), alternative),
        ),
      )
    ) {
      fail(`${at} matches nothing in ${entry.fixture ?? "any fixture"}`);
      continue;
    }
    // ... and none of its alternatives is dead: each one matches a fixture
    // of the directory, the one it was written for.
    for (const alternative of alternatives)
      if (
        ![...documents.values()].some((document) =>
          matches(document, alternative),
        )
      )
        fail(
          `${named(alternative)} matches nothing in any fixture. Every alternative of a selector list needs a fixture it matches: add the layout it is for as its own fixture file, or remove the alternative.`,
        );
  }
  if (
    evidence.class === "B" &&
    evidence.selectors.length &&
    evidence.selectors.every(
      (entry) =>
        entry.basis === "observed" &&
        AUTHORITATIVE.has(sources.get(entry.source)?.kind),
    )
  )
    notes.push(
      `${id} is labelled B, yet every selector is observed in an authoritative source`,
    );

  // The steps file, when there is one, says the same thing.
  const stepsFiles = context.steps.get(id) ?? [];
  if (stepsFiles.length > 1)
    fail(`${stepsFiles.length} steps files claim ${id}`);
  if (stepsFiles.length === 1) {
    const shown = path
      .relative(context.repo, stepsFiles[0])
      .replaceAll("\\", "/");
    if (evidence.class === "C") fail(`class C but ${shown} exists`);
    else if (evidence.mechanism !== "form")
      fail(
        `${shown} exists but the mechanism is "${evidence.mechanism}", not "form"`,
      );
    else if (!context.validator || context.validator.unavailable)
      fail(
        `${shown} cannot be checked: the steps validator is unavailable (${context.validator?.unavailable ?? "missing"})`,
      );
    else {
      let steps = null;
      try {
        const result = context.validator.validateHttpLoginSteps(
          readJson(stepsFiles[0]),
          { id },
        );
        if (result.ok) steps = result.value;
        else
          for (const issue of result.issues)
            fail(`${shown} ${issue.code} at ${issue.path || "(file)"}`);
      } catch (error) {
        fail(`${shown} is not valid JSON: ${error.message}`);
      }
      if (steps) {
        for (const field of ["class", "source", "reviewed"])
          if (steps.evidence[field] !== evidence[field])
            fail(
              `${shown} evidence.${field} is "${steps.evidence[field]}" but evidence.json says "${evidence[field]}"`,
            );
        for (const { at, selector, scope } of stepSelectors(steps)) {
          const alternatives = parsedAlternatives(selector);
          if (!alternatives) {
            fail(`${shown} ${at} is not a selector the checker can parse`);
            continue;
          }
          // Cited as written, or each alternative cited on its own (which is
          // how alternatives from different sources are recorded).
          if (
            !cited.has(selector) &&
            !alternatives.every((alternative) =>
              citedAlternatives.has(alternative),
            )
          )
            fail(
              `${shown} ${at} is not cited in evidence.json selectors: list the selector as it is written here, or each of its alternatives as an entry of its own`,
            );
          const served = [...listed].filter(
            ([file, fixture]) =>
              documents.has(file) &&
              (fixture.origin ?? null) === scope.origin &&
              (fixture.frame ?? null) === scope.frame &&
              context.validator.httpLoginStepMatchesPath(
                scope.gate,
                fixture.path,
              ),
          );
          if (served.length === 0) {
            fail(
              `${shown} ${at} runs on ${scope.origin ?? "the connection's origin"}${scope.frame ? ` in frame ${scope.frame}` : ""}, where no fixture is served`,
            );
            continue;
          }
          // Any one alternative matching would hide a misspelt other: every
          // alternative must match a fixture served where the step runs.
          for (const alternative of alternatives)
            if (
              !served.some(([file]) =>
                matches(documents.get(file), alternative),
              )
            )
              fail(
                `${shown} ${at}${alternatives.length > 1 ? ` alternative "${alternative}"` : ""} matches nothing in ${served.map(([file]) => file).join(", ")}.${alternatives.length > 1 ? " Every alternative of a selector list needs a fixture it matches, served on this step's origin, path and frame: add the layout it is for as its own fixture file, or remove the alternative." : ""}`,
              );
        }
      }
    }
  }
  for (const document of [
    ...documents.values(),
    ...[...sourceDocuments.values()].flat(),
  ])
    document.defaultView.close();
  return { errors: [...new Set(errors)], notes };
}

/** Application directories of a corpus root, and what else lies there. */
function listCorpus(corpusRoot) {
  const applications = [];
  const stray = [];
  for (const entry of fs.readdirSync(corpusRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) applications.push(entry.name);
    else if (!["README.md", "evidence.schema.json"].includes(entry.name))
      stray.push(entry.name);
  }
  return { applications: applications.sort(), stray };
}

// ------------------------------------------------------ the coverage document

const tableCells = (line) =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

/**
 * Rows of the coverage matrix: id -> { application, capability, class, note }.
 * The Application cell, and the Note of a row only a person can explain, are
 * the hand-written part of the document; everything else is generated.
 */
function coverageRows(markdown) {
  const rows = new Map();
  const duplicates = [];
  let columns = null;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      columns = null;
      continue;
    }
    const cells = tableCells(line);
    if (!columns) {
      columns = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    const cell = (name) => cells[columns.indexOf(name)] ?? "";
    const id = /^`([A-Za-z0-9-]+)`$/u.exec(cell("id"))?.[1];
    if (!id) continue;
    if (rows.has(id)) duplicates.push(id);
    rows.set(id, {
      application: cell("application"),
      capability: cell("catalog capability").replaceAll("`", ""),
      class: cell("class"),
      note: cell("note"),
    });
  }
  return { rows, duplicates };
}

/**
 * Whether steps-based login is switched on in this tree: true, false, or null
 * when the source does not say so in the form this check can read.
 */
function stepsLoginEnabled(root) {
  const file = path.join(root, SUPPORT_GATE);
  if (!fs.existsSync(file)) return null;
  const value =
    /^export const DECLARATIVE_LOGIN_SUPPORTED: boolean = (true|false);$/mu.exec(
      readText(file),
    )?.[1];
  return value ? value === "true" : null;
}

/**
 * Why a class C application has nothing to build from. The Note of such a row
 * is written by a person from its evidence.json and opens with one of these.
 */
const NOTHING_REASONS = [
  [
    "Robots rules or terms",
    "The site's robots rules or its terms forbid a program reading the page, so it was not loaded.",
  ],
  [
    "Refused or unreadable",
    "The site answered with a refusal or a challenge, or its robots rules or terms could not be read, so the page was not loaded; or the one permitted load failed.",
  ],
  [
    "No public markup",
    "The application has a password form, but no public source shows its markup.",
  ],
  [
    "No password form",
    "The evidence shows no user name and password form for a saved password to fill.",
  ],
];
const nothingReason = (note) =>
  NOTHING_REASONS.find(
    ([label]) => note === label || note.startsWith(`${label}:`),
  )?.[0] ?? null;

/** Where an application stands today. A reviewed login is not re-examined. */
function coverageGroup({ id, capability, evidence, stepsFiles }) {
  if (capability === "known-form") return "reviewed";
  if (capability === "http-auth") return "http";
  if (capability === "custom-form" || id === "generic-form")
    return "configured";
  if (capability === "none") return "none";
  if (stepsFiles.length > 0) return "steps";
  if (!evidence) return "unexamined";
  return evidence.class === "C" ? "nothing" : "evidence";
}

/**
 * What the catalog, the corpus and the steps files say about each application.
 * `evidence` maps an id to its evidence.json; `steps` to its steps files.
 */
function coverageModel({ catalog, evidence, steps, stepsRoot, enabled }) {
  const ids = new Set([...catalog.keys(), ...evidence.keys(), ...steps.keys()]);
  const entries = [...ids].map((id) => {
    const profile = catalog.get(id);
    const entry = {
      id,
      capability: profile?.capability ?? null,
      loginFlow: profile?.loginFlow ?? null,
      evidence: evidence.get(id) ?? null,
      stepsFiles: (steps.get(id) ?? [])
        .map((file) => path.relative(stepsRoot, file).split(path.sep).join("/"))
        .sort(),
    };
    return { ...entry, group: coverageGroup(entry) };
  });
  return { entries, enabled };
}

/** A table padded the way the repository's formatter writes one. */
function markdownTable(header, rows) {
  const width = (text) => [...text].length;
  const widths = header.map((title, column) =>
    Math.max(3, width(title), ...rows.map((row) => width(row[column]))),
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell + " ".repeat(widths[column] - width(cell))).join(" | ")} |`;
  return [
    line(header),
    line(widths.map((size) => "-".repeat(size))),
    ...rows.map(line),
  ].join("\n");
}

/** Stands for a space at which generated prose is not broken. */
const TIE = "\u0001";

/**
 * Prose broken into lines of at most `width` characters. A line never starts
 * with what would open a list, a heading or a quotation; such a word stays on
 * the line before it, however long that gets.
 */
function wrapProse(text, width = 100) {
  const lines = [];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (
      last >= 0 &&
      (lines[last].length + 1 + word.length <= width ||
        /^(?:\d{1,9}[.)]|[-+*#>=])/u.test(word))
    )
      lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines.join("\n").replaceAll(TIE, " ");
}

const COVERAGE_COLUMNS = [
  "Application",
  "Id",
  "Catalog capability",
  "Class",
  "Mechanism",
  "Steps file",
  "Note",
];
const COVERAGE_GROUPS = [
  [
    "reviewed",
    "Signs in automatically today",
    "A reviewed login in the catalog: reviewed form selectors, or a hand-written adapter for a sign-in that takes several pages.",
  ],
  [
    "http",
    "HTTP authentication",
    "The saved credential answers the server's HTTP Basic or Digest request. There is no page form.",
  ],
  [
    "configured",
    "Configured by you",
    "Automatic through your own configuration: field detection on a page you choose, or selectors you enter.",
  ],
  [
    "none",
    "No web login",
    "Native integration entries with no web login page.",
  ],
  [
    "steps",
    "Login steps written",
    "A steps file exists under `src/data/loginSteps/`. Class A: every selector was seen in an authoritative source. Class B: the layout is unverified until someone signs in with it.",
  ],
  [
    "evidence",
    "Evidence, but no steps file",
    "The login layout is known. The Note says why no steps file was written.",
  ],
  [
    "nothing",
    "Nothing to build from",
    "Class C. The Note says why. Each application's `evidence.json` says what was looked for and what you can supply.",
  ],
  ["unexamined", "Not examined yet", "No evidence record exists for these."],
];
const code = (text) => `\`${text}\``;
const counted = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** The notes the generator writes itself. */
const NOTES = {
  selectors: "Reviewed form selectors",
  http: "HTTP Basic or Digest; no page form",
  custom: "Selectors you enter yourself",
  detection: "Field detection on a page you choose",
  none: "No web login page",
  classA: "Authoritative source",
  classB: "Unverified layout",
  unexamined: "No evidence record yet",
};
const adapterNote = (flow) => `Hand-written adapter (${code(flow)})`;
/**
 * A note the generator wrote is not a person's reason: a row that moves to a
 * section where a person writes the Note arrives there without one.
 */
const isGeneratedNote = (note) =>
  Object.values(NOTES).includes(note) ||
  /^Hand-written adapter \(`[^`]*`\)$/u.test(note);

/**
 * The generated parts of the coverage document: the summary, the matrix, and
 * what a person still has to supply (`problems`). `kept` holds the document's
 * hand-written cells by id, as `coverageRows` reads them.
 */
function renderCoverage(model, kept = new Map()) {
  const problems = [];
  const rows = model.entries
    .map((entry) => {
      const mine = kept.get(entry.id);
      return {
        ...entry,
        application: mine?.application || entry.id,
        named: Boolean(mine?.application),
        written: mine?.note && !isGeneratedNote(mine.note) ? mine.note : "",
      };
    })
    .sort(
      (a, b) =>
        a.application.localeCompare(b.application, "en", {
          sensitivity: "base",
        }) || (a.id < b.id ? -1 : 1),
    );
  const note = (row) => {
    switch (row.group) {
      case "reviewed":
        return row.loginFlow ? adapterNote(row.loginFlow) : NOTES.selectors;
      case "http":
        return NOTES.http;
      case "configured":
        return row.capability === "custom-form"
          ? NOTES.custom
          : NOTES.detection;
      case "none":
        return NOTES.none;
      case "steps":
        return row.evidence?.class === "A" ? NOTES.classA : NOTES.classB;
      case "unexamined":
        problems.push(
          `${row.id} has no evidence record: add ${CORPUS}/${row.id}/evidence.json`,
        );
        return NOTES.unexamined;
      case "evidence":
        if (!row.written)
          problems.push(
            `${row.id}: say in the Note column why there is no steps file`,
          );
        return row.written;
      default:
        if (!nothingReason(row.written))
          problems.push(
            `${row.id}: the Note must open with one of: ${NOTHING_REASONS.map(([label]) => label).join("; ")}`,
          );
        return row.written;
    }
  };
  const sections = [];
  for (const [group, title, lead] of COVERAGE_GROUPS) {
    const members = rows.filter((row) => row.group === group);
    if (members.length === 0) continue;
    const heading =
      group === "steps" && model.enabled === false
        ? `${title}, not switched on`
        : title;
    const table = members.map((row) => {
      if (!row.named)
        problems.push(`${row.id} has no name in the Application column`);
      return [
        row.application,
        code(row.id),
        row.capability ? code(row.capability) : "-",
        row.evidence?.class ?? "-",
        row.evidence ? code(row.evidence.mechanism) : "-",
        row.stepsFiles.length > 0
          ? row.stepsFiles.map(code).join(", ")
          : row.evidence
            ? "none"
            : "-",
        note(row),
      ];
    });
    sections.push(
      `### ${heading} (${members.length})\n\n${wrapProse(lead)}\n\n${markdownTable(COVERAGE_COLUMNS, table)}`,
    );
  }

  // The summary counts catalog applications only.
  const listed = rows.filter((row) => row.capability !== null);
  const proposed = rows.filter((row) => row.capability === null);
  const of = (group) => listed.filter((row) => row.group === group);
  const steps = of("steps");
  const stepsOfClass = (letter) =>
    steps.filter((row) => row.evidence?.class === letter).length;
  const standing = [
    ["Signs in automatically with a reviewed login", of("reviewed").length],
    ["HTTP authentication, no page form", of("http").length],
    ["Configured by you", of("configured").length],
    ["No web login", of("none").length],
    [
      "Login steps written, class A: every selector seen in an authoritative source",
      stepsOfClass("A"),
    ],
    ["Login steps written, class B: unverified layout", stepsOfClass("B")],
    ["Evidence, but no steps file", of("evidence").length],
    ["Nothing to build from (class C)", of("nothing").length],
    ...(of("unexamined").length > 0
      ? [["Not examined yet", of("unexamined").length]]
      : []),
    ["Total", listed.length],
  ];
  const summary = [
    markdownTable(
      ["Where each application stands today", "Applications"],
      standing.map(([label, count]) => [label, String(count)]),
    ),
  ];
  const reviewed = of("reviewed");
  if (reviewed.length > 0) {
    const adapters = reviewed.filter((row) => row.loginFlow);
    const flows = [...new Set(adapters.map((row) => row.loginFlow))].sort();
    const selectors = reviewed.length - adapters.length;
    summary.push(
      wrapProse(
        `Of the ${reviewed.length} that sign in automatically, ${counted(selectors, "uses", "use")} reviewed form selectors and ${counted(adapters.length, "keeps", "keep")} a hand-written adapter${
          flows.length > 0
            ? ` (${flows.map((flow) => `${code(flow)}${TIE}${adapters.filter((row) => row.loginFlow === flow).length}`).join(", ")})`
            : ""
        }.`,
      ),
    );
  }
  if (model.enabled === null)
    problems.push(
      `whether steps-based login is switched on could not be read from ${SUPPORT_GATE}`,
    );
  if (steps.length > 0 || model.enabled !== false) {
    const manual = steps.filter((row) => row.capability === "manual").length;
    const state =
      model.enabled === false
        ? "No steps-based login is switched on yet."
        : model.enabled
          ? "Steps-based login is switched on in the source. Every connection still starts in Manual mode."
          : "Whether steps-based login is switched on could not be read from the source.";
    summary.push(
      wrapProse(
        model.enabled === false
          ? `${state} The ${counted(steps.length, "application", "applications")} with login steps ${steps.length === 1 ? "behaves as it" : "behave as they"} did before the steps were written: ${counted(manual, "is", "are")} manual and ${counted(steps.length - manual, "uses", "use")} field detection.`
          : state,
      ),
    );
  }
  // What only a user can add, counted from the sources the evidence cites.
  const citing = (kind) =>
    listed.filter((row) =>
      row.evidence?.sources?.some((source) => source.kind === kind),
    ).length;
  const confirmed = citing("user-confirmation");
  const saved = citing("user-capture");
  if (listed.some((row) => row.evidence))
    summary.push(
      wrapProse(
        `${confirmed === 0 ? "No evidence record cites" : counted(confirmed, "evidence record cites", "evidence records cite")} a sign-in confirmed by a user, and ${saved === 0 ? "none cites" : counted(saved, "cites", "cite")} a page a user saved.`,
      ),
    );
  if (of("nothing").length > 0)
    summary.push(
      markdownTable(
        ["Why nothing can be built", "Applications", "Meaning"],
        NOTHING_REASONS.map(([label, meaning]) => [
          label,
          String(
            of("nothing").filter((row) => nothingReason(row.written) === label)
              .length,
          ),
          meaning,
        ]),
      ),
    );
  if (proposed.length > 0)
    summary.push(
      wrapProse(
        `Listed below but not in the catalog, and not counted above: ${proposed.map((row) => code(row.id)).join(", ")}.`,
      ),
    );
  return {
    summary: summary.join("\n\n"),
    matrix: sections.join("\n\n"),
    problems,
  };
}

/** `markdown` with the body of one generated block replaced, or null. */
function replaceBlock(markdown, name, body) {
  const begin = `<!-- coverage:${name}:begin -->`;
  const end = `<!-- coverage:${name}:end -->`;
  const from = markdown.indexOf(begin);
  const to = markdown.indexOf(end);
  if (from < 0 || to < from) return null;
  return `${markdown.slice(0, from + begin.length)}\n\n${body}\n\n${markdown.slice(to)}`;
}

/** Lines of a document with table padding taken out. */
const comparableMarkdown = (markdown) =>
  markdown.split("\n").map((line) =>
    line.startsWith("|")
      ? tableCells(line)
          .map((cell) => cell.replace(/^-{3,}$/u, "---"))
          .join(" | ")
      : line.trimEnd(),
  );

/**
 * Where the document first differs from what was generated: one note, or
 * none. Later lines are not counted: one line more or less shifts them all.
 */
function coverageDrift(current, wanted) {
  const have = comparableMarkdown(current);
  const want = comparableMarkdown(wanted);
  const length = Math.max(have.length, want.length);
  for (let index = 0; index < length; index++)
    if (have[index] !== want[index])
      return [
        `${COVERAGE} is not what the catalog, the evidence and the steps files give. First difference, at line ${index + 1}: it has "${have[index] ?? ""}", generated "${want[index] ?? ""}". Regenerate it: ${REGENERATE}`,
      ];
  return [];
}

/**
 * The patterns the evidence schema shares with the steps schema, by name,
 * wherever the two differ. They are copies, so they are compared, not trusted.
 */
function sharedPatternDrift(evidenceSchema, stepsSchema) {
  const mine = evidenceSchema.$defs ?? {};
  const steps = stepsSchema.$defs ?? {};
  return [
    ["origin", mine.origin?.pattern, steps.origin?.pattern],
    ["selector", mine.selectorText?.pattern, steps.selector?.pattern],
    ["path", mine.fixture?.properties?.path?.pattern, steps.path?.pattern],
    ["frame", mine.fixture?.properties?.frame?.pattern, steps.frame?.pattern],
    [
      "citation",
      mine.citation?.pattern,
      steps.evidence?.properties?.source?.pattern,
    ],
    ["date", mine.date?.pattern, steps.evidence?.properties?.reviewed?.pattern],
  ]
    .filter(([, ours, theirs]) => ours === undefined || ours !== theirs)
    .map(([name]) => name);
}

const schema = readJson(path.join(repo, CORPUS, "evidence.schema.json"));
const context = {
  repo,
  schema,
  strict: STRICT,
  catalog: loadCatalog(repo),
  steps: indexSteps(path.join(repo, STEPS)),
  validator: await loadStepsValidator(repo),
  // A local date may be one day ahead of the UTC date.
  latestDate: new Date(Date.now() + 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10),
};
const corpusRoot = path.join(repo, CORPUS);
const corpus = listCorpus(corpusRoot);

describe("login fixture corpus", () => {
  test("the evidence schema is closed and uses only enforced keywords", () => {
    assert.deepEqual(unsupportedKeywords(schema), []);
    assert.equal(schema.additionalProperties, false);
    // Recollection is not a source: there is no kind for it.
    assert.deepEqual(schema.$defs.source.properties.kind.enum, [
      ...AUTHORITATIVE,
      "anonymous-capture",
      "vendor-documentation",
      "secondary",
    ]);
    assert.deepEqual(schema.properties.class.enum, ["A", "B", "C"]);
  });

  test("the README examples are valid evidence", () => {
    const readme = readText(path.join(corpusRoot, "README.md"));
    const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/gu)]
      .map(([, block]) => JSON.parse(block))
      .filter((block) => block.$schema === "../evidence.schema.json");
    assert.deepEqual(
      examples.map((example) => example.class).sort(),
      ["A", "B", "C"],
      "one worked example per class",
    );
    for (const example of examples) {
      assert.deepEqual(schemaErrors(schema, example), [], example.id);
      assert.deepEqual(jsonCredentialFindings(example), [], example.id);
    }
  });

  test("the corpus root holds only the standard and application directories", () => {
    assert.deepEqual(corpus.stray, []);
  });

  for (const id of corpus.applications)
    test(`logins/${id}`, (t) => {
      const { errors, notes } = checkApplication(
        path.join(corpusRoot, id),
        context,
      );
      for (const note of notes) t.diagnostic(note);
      assert.ok(
        errors.length === 0,
        `${CORPUS}/${id}: ${errors.length} problem(s)\n  - ${errors.join("\n  - ")}`,
      );
    });

  test("every steps file has an application directory", () => {
    assert.deepEqual(
      [...context.steps.keys()].filter(
        (id) => !corpus.applications.includes(id),
      ),
      [],
      `a file under ${STEPS} needs ${CORPUS}/<id>/evidence.json`,
    );
  });

  test(
    "what the capture tool will not load is never a listed credential origin",
    {
      skip: context.validator?.validateHttpLoginSteps
        ? false
        : "the steps validator is not available",
    },
    (t) => {
      for (const suffix of Object.keys(NON_PUBLIC_SUFFIXES))
        assert.notDeepEqual(
          listedOriginIssues(context.validator, `https://login.${suffix}`),
          [],
          `the steps format accepts https://login.${suffix} as a listed origin`,
        );
      assert.deepEqual(
        listedOriginIssues(context.validator, "https://login.example.com"),
        [],
      );
      // And the other way round: the tool is at least as strict as the
      // validator, for every suffix the validator refuses, at any depth.
      const refused = context.validator.HTTP_LOGIN_NON_PUBLIC_SUFFIXES;
      assert.ok(Array.isArray(refused) && refused.length > 0);
      for (const suffix of refused)
        for (const host of [`host.${suffix}`, `a.b.${suffix}`])
          assert.notEqual(
            classifyHost(host),
            "public",
            `the capture tool would load ${host}, which the steps format refuses`,
          );
      t.diagnostic(
        `${refused.length} suffixes refused by the steps format, ${Object.keys(NON_PUBLIC_SUFFIXES).length} by the capture tool`,
      );
    },
  );

  test("the evidence schema repeats the steps schema's shared patterns exactly", (t) => {
    const file = path.join(repo, STEPS_SCHEMA);
    if (!fs.existsSync(file)) {
      t.skip("the steps schema is not present");
      return;
    }
    assert.deepEqual(
      sharedPatternDrift(schema, readJson(file)),
      [],
      `copy the pattern from ${STEPS_SCHEMA}; a hand-typed copy loses its escapes`,
    );
  });

  // Runs before the listing test below, so that a rewrite is what that reads.
  test("the coverage document reports what the catalog, the evidence and the steps files say", (t) => {
    const file = path.join(repo, COVERAGE);
    const raw = fs.readFileSync(file, "utf8");
    const current = raw.replace(/\r\n/gu, "\n");
    const model = coverageModel({
      catalog: context.catalog,
      evidence: new Map(
        corpus.applications.map((id) => {
          try {
            return [id, readJson(path.join(corpusRoot, id, "evidence.json"))];
          } catch {
            // Reported by that application's own test.
            return [id, { class: "?", mechanism: "?" }];
          }
        }),
      ),
      steps: context.steps,
      stepsRoot: path.join(repo, STEPS),
      enabled: stepsLoginEnabled(repo),
    });
    const generated = renderCoverage(model, coverageRows(current).rows);
    let wanted = current;
    for (const name of ["summary", "matrix"]) {
      wanted = replaceBlock(wanted, name, generated[name]);
      assert.ok(
        wanted !== null,
        `${COVERAGE} has no block between <!-- coverage:${name}:begin --> and <!-- coverage:${name}:end -->`,
      );
    }
    const drift = coverageDrift(current, wanted);
    if (COVERAGE_WRITE && drift.length > 0) {
      fs.writeFileSync(
        file,
        raw.includes("\r\n") ? wanted.replace(/\n/gu, "\r\n") : wanted,
      );
      t.diagnostic(`rewrote ${COVERAGE}`);
      drift.length = 0;
    }
    const notes = [...drift, ...generated.problems];
    const groups = (key) =>
      model.entries.filter((entry) => entry.group === key).length;
    t.diagnostic(
      `${model.entries.length} applications: ${groups("reviewed")} reviewed, ${groups("http")} HTTP authentication, ${groups("configured")} configured, ${groups("none")} without a web login, ${groups("steps")} with steps, ${groups("evidence")} with evidence only, ${groups("nothing")} with nothing to build from, ${groups("unexamined")} not examined; steps-based login is ${model.enabled === false ? "off" : model.enabled ? "on" : "not readable"}`,
    );
    for (const note of notes) t.diagnostic(`drift: ${note}`);
    if (STRICT)
      assert.deepEqual(
        notes,
        [],
        "the coverage document is out of step with the catalog, the corpus or the steps files",
      );
  });

  test("the coverage document lists every catalog application exactly once", () => {
    const { rows, duplicates } = coverageRows(
      readText(path.join(repo, COVERAGE)),
    );
    assert.deepEqual(duplicates, [], "an application is listed twice");
    assert.deepEqual(
      [...context.catalog.keys()].filter((id) => !rows.has(id)),
      [],
      `catalog applications missing from ${COVERAGE}. Regenerate it: ${REGENERATE}`,
    );
    assert.deepEqual(
      [...rows.keys()].filter(
        (id) => !context.catalog.has(id) && !corpus.applications.includes(id),
      ),
      [],
      "rows that are neither a catalog application nor a corpus directory",
    );
  });
});

// ------------------------------------------- the check must reject bad input

const evidenceA = () => ({
  $schema: "../evidence.schema.json",
  version: 1,
  id: "pfsense",
  class: "A",
  mechanism: "form",
  source: "tests/tooling/captureLoginPage.node-test.mjs",
  reviewed: "2026-10-12",
  summary:
    "Synthetic self-test entry: one form on the connection's own origin.",
  sources: [
    {
      id: "repo",
      kind: "repository",
      title: "A file of this repository, standing in for a reviewed fixture",
      path: "tests/tooling/captureLoginPage.node-test.mjs",
      retrieved: "2026-10-12",
    },
  ],
  selectors: [
    {
      selector: 'form#iform input#usernamefld[name="usernamefld"]',
      role: "username",
      source: "repo",
      basis: "observed",
      locator: "lines 10-12",
    },
    {
      selector: 'form#iform input#passwordfld[type="password"]',
      role: "password",
      source: "repo",
      basis: "observed",
      locator: "lines 13-14",
    },
    {
      selector: 'form#iform button[type="submit"][name="login"]',
      role: "control",
      source: "repo",
      basis: "observed",
      locator: "line 15",
    },
  ],
  fixtures: [{ file: "fixture.html", path: "/", derivedFrom: ["repo"] }],
  staysInteractive: [],
});
const FIXTURE_A =
  '<!doctype html>\n<html><body class="page-login"><form id="iform" method="post" action="/index.php">' +
  '<input id="usernamefld" name="usernamefld" type="text"><input id="passwordfld" name="passwordfld" type="password">' +
  '<button type="submit" name="login" value="1">Sign in</button></form></body></html>\n';

const hostedId = "github";
const hostedUrl = context.catalog.get(hostedId).hostedLoginUrl;
// A capture as an earlier version of the tool wrote it: no sanitizer mark,
// and the browser's own host in the contacted list.
const legacyCaptureB = () => ({
  schema: CAPTURE_SCHEMA,
  applicationId: hostedId,
  capturedAt: "2026-10-11",
  mode: "hosted",
  engine: "Microsoft Edge headless (synthetic self-test)",
  source: {
    kind: "hosted-login",
    requestedUrl: hostedUrl,
    finalUrl: hostedUrl,
    httpStatus: 200,
  },
  limits: {
    navigations: 1,
    scriptsExecuted: true,
    input: "none",
    truncated: false,
  },
  network: {
    contacted: ["edge.microsoft.com:443", `${new URL(hostedUrl).host}:443`],
    refused: 0,
  },
  observations: ["no-password-field"],
  frames: [
    {
      index: 0,
      parent: null,
      name: null,
      url: hostedUrl,
      sameOriginAsTop: true,
      controls: 2,
      tree: {
        tag: "html",
        attributes: {},
        children: [
          {
            tag: "body",
            attributes: {},
            children: [
              {
                tag: "form",
                attributes: { id: "sign-in", action: "/session" },
                children: [
                  {
                    tag: "input",
                    attributes: {
                      id: "login_field",
                      name: "login",
                      value: null,
                    },
                  },
                  {
                    tag: "button",
                    attributes: { type: "submit", "aria-label": null },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
});
// The same capture as the current tool writes it.
const captureB = () => resanitizeCapture(legacyCaptureB());
const evidenceB = (capture = captureB()) => ({
  $schema: "../evidence.schema.json",
  version: 1,
  id: hostedId,
  class: "B",
  mechanism: "form",
  source: hostedUrl,
  reviewed: "2026-10-12",
  summary:
    "Synthetic self-test entry: the first step captured, the second inferred.",
  sources: [
    {
      id: "page",
      kind: "anonymous-capture",
      title: "The public sign-in page, rendered once without an account",
      url: hostedUrl,
      capture: "capture.json",
      captureSha256: canonicalSha256(capture),
      retrieved: "2026-10-11",
    },
    {
      id: "guide",
      kind: "secondary",
      title: "A third-party description of the password step",
      url: "https://docs.example.org/sign-in",
      retrieved: "2026-10-11",
    },
  ],
  selectors: [
    {
      selector: 'form#sign-in input#login_field[name="login"]',
      role: "username",
      source: "page",
      basis: "observed",
      locator: "frames[0] #login_field",
    },
    {
      selector: 'form#sign-in input[name="password"][type="password"]',
      role: "password",
      source: "guide",
      basis: "inferred",
      fixture: "fixture.password.html",
    },
  ],
  fixtures: [
    { file: "fixture.html", path: "/login", derivedFrom: ["page"] },
    { file: "fixture.password.html", path: "/login", derivedFrom: ["guide"] },
  ],
  staysInteractive: [
    { kind: "device-approval", note: "A new device is confirmed by email." },
  ],
  unverified: [
    "The password step: it is shown only after an account name is accepted.",
  ],
  neededFromUser:
    "One sign-in with this layout, or the password step saved signed out as Webpage, Complete.",
});
const FIXTURE_B =
  '<!doctype html>\n<html><body><form id="sign-in" action="/session"><input id="login_field" name="login"><button type="submit"></button></form></body></html>\n';
const FIXTURE_B_PASSWORD =
  '<!doctype html>\n<html><body><form id="sign-in" action="/session"><input name="password" type="password"><button type="submit"></button></form></body></html>\n';
const evidenceC = () => ({
  $schema: "../evidence.schema.json",
  version: 1,
  id: "lxd",
  class: "C",
  mechanism: "none",
  reviewed: "2026-10-12",
  summary: "Synthetic self-test entry: no password form exists.",
  sources: [],
  selectors: [],
  fixtures: [],
  staysInteractive: [{ kind: "client-certificate" }],
  lookedFor: ["The profile text in the catalog: it states mutual TLS or OIDC."],
  neededFromUser:
    "Confirmation of how sign-in is done on the user's own server.",
});

const filesA = () => ({
  "evidence.json": evidenceA(),
  "fixture.html": FIXTURE_A,
});
const filesB = () => {
  const capture = captureB();
  return {
    "evidence.json": evidenceB(capture),
    "capture.json": capture,
    "fixture.html": FIXTURE_B,
    "fixture.password.html": FIXTURE_B_PASSWORD,
  };
};
const filesC = () => ({ "evidence.json": evidenceC() });

/** Writes one application directory into a temporary corpus and checks it. */
function checkTemporary(t, files, { steps = null, overrides = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sorng-login-corpus-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = files["evidence.json"]?.id ?? overrides.directory ?? "pfsense";
  const directory = path.join(root, "logins", overrides.directory ?? id);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof content === "string"
        ? content
        : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
  const stepsRoot = path.join(root, "steps");
  if (steps) {
    fs.mkdirSync(path.join(stepsRoot, "family"), { recursive: true });
    fs.writeFileSync(
      path.join(stepsRoot, "family", `${id}.json`),
      typeof steps === "string" ? steps : JSON.stringify(steps),
    );
  }
  // What these tests expect does not depend on how the run was started: the
  // gate's strict mode is asked for by a test, never inherited.
  return checkApplication(directory, {
    ...context,
    strict: false,
    steps: indexSteps(stepsRoot),
    ...overrides.context,
  });
}

const stepsA = () => ({
  $schema: "../../../types/connection/httpLoginSteps.schema.json",
  version: 1,
  id: "pfsense",
  evidence: {
    class: "A",
    source: "tests/tooling/captureLoginPage.node-test.mjs",
    reviewed: "2026-10-12",
  },
  credentialOrigins: [],
  loginSteps: [
    {
      kind: "form",
      selectors: {
        username: 'form#iform input#usernamefld[name="usernamefld"]',
        password: 'form#iform input#passwordfld[type="password"]',
      },
    },
    {
      kind: "submit",
      submission: "click",
      selectors: { control: 'form#iform button[type="submit"][name="login"]' },
    },
  ],
});

const expectFailure = (result, pattern) => {
  assert.ok(
    result.errors.some((error) => pattern.test(error)),
    `expected an error matching ${pattern}, got:\n${result.errors.join("\n") || "(none)"}`,
  );
};
const edit = (value, change) => {
  const copy = structuredClone(value);
  change(copy);
  return copy;
};

describe("the corpus check", () => {
  test("accepts a valid directory of each class", (t) => {
    for (const files of [filesA(), filesB(), filesC()]) {
      const result = checkTemporary(t, files);
      assert.deepEqual(result.errors, [], files["evidence.json"].id);
    }
  });

  test("accepts what the capture tool writes for a saved page", async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "sorng-login-saved-"));
    t.after(() => fs.rmSync(work, { recursive: true, force: true }));
    const saved = path.join(work, "saved.html");
    fs.writeFileSync(
      saved,
      '<!doctype html><html lang="en"><head><title>Log on</title><script>boot()</script></head>' +
        '<body class="logon"><h1>Network card</h1>' +
        '<form id="logon" method="post" action="https://ups.example.org/logon?next=%2Fhome">' +
        '<input id="user" name="user" value="left in the saved page">' +
        '<input id="pass" name="pass" type="password" value="left in the saved page">' +
        '<button type="submit" name="go" value="1" onclick="go()">Log on</button>' +
        "</form></body></html>",
    );
    const capture = await captureFromFile(saved, {
      applicationId: "eaton-ups",
    });
    const evidence = {
      $schema: "../evidence.schema.json",
      version: 1,
      id: "eaton-ups",
      class: "A",
      mechanism: "form",
      source: "tests/fixtures/logins/eaton-ups/capture.json",
      reviewed: "2026-10-12",
      summary: "Synthetic self-test entry: a saved page read with --from-file.",
      sources: [
        {
          id: "saved",
          kind: "user-capture",
          title: "The login page as the user saved it",
          capture: "capture.json",
          captureSha256: canonicalSha256(capture),
          retrieved: "2026-10-12",
        },
      ],
      selectors: [
        ['form#logon input#user[name="user"]', "username"],
        ['form#logon input#pass[type="password"]', "password"],
        ['form#logon button[type="submit"][name="go"][value="1"]', "control"],
      ].map(([selector, role]) => ({
        selector,
        role,
        source: "saved",
        basis: "observed",
        locator: "frames[0], form#logon",
      })),
      fixtures: [
        { file: "fixture.html", path: "/logon", derivedFrom: ["saved"] },
      ],
      staysInteractive: [],
    };
    const fixture = renderFixtureHtml(capture);
    assert.match(fixture, /<form id="logon" method="post" action="\/logon">/u);
    const result = checkTemporary(t, {
      "evidence.json": evidence,
      "capture.json": capture,
      "fixture.html": fixture,
    });
    assert.deepEqual(result.errors, []);
  });

  test("fails a directory without valid evidence", async (t) => {
    const cases = {
      "no evidence file": [
        { "fixture.html": FIXTURE_A },
        /evidence\.json is missing/u,
      ],
      "evidence that is not JSON": [
        { ...filesA(), "evidence.json": "{ not json" },
        /not valid JSON/u,
      ],
      "no class": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => delete e.class),
        },
        /is missing "class"/u,
      ],
      "an unknown class": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => (e.class = "verified")),
        },
        /class must be one of: A, B, C/u,
      ],
      "an unknown field": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => (e.verified = true)),
        },
        /unknown field "verified"/u,
      ],
      "a source kind that does not exist": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.sources[0].kind = "memory"),
          ),
        },
        /sources\[0\]\.kind must be one of/u,
      ],
      "an id that is not the directory": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => (e.id = "opnsense")),
        },
        /id "opnsense" is not/u,
        { directory: "pfsense" },
      ],
      "an application that is not in the catalog": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => (e.id = "not-a-profile")),
        },
        /not a catalog application/u,
      ],
      "a review date in the future": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.reviewed = "2999-01-01"),
          ),
        },
        /in the future/u,
      ],
      "an impossible date": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.reviewed = "2026-02-30"),
          ),
        },
        /not a calendar date/u,
      ],
      "a source read after the review": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.reviewed = "2026-10-01"),
          ),
        },
        /after the review/u,
      ],
      "a selector without a source": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => delete e.selectors[0].source,
          ),
        },
        /selectors\[0\] is missing "source"/u,
      ],
      "a selector citing a source that is not listed": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.selectors[1].source = "memory"),
          ),
        },
        /cites unknown source "memory"/u,
      ],
      "an observed selector that does not say where": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => delete e.selectors[0].locator,
          ),
        },
        /selectors\[0\] is missing "locator"/u,
      ],
      "a primary source that is not a listed source": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.source = "docs/testing.md"),
          ),
        },
        /not the url, path or capture of a listed source/u,
      ],
      "a cited repository file that does not exist": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => {
            e.source = "tests/protocol/no-such-file.test.ts";
            e.sources[0].path = e.source;
          }),
        },
        /does not exist/u,
      ],
      "an observed selector that the cited file does not contain": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.selectors[0].selector = "form#iform input#zzqnotthere"),
          ),
        },
        /marked observed in tests\/tooling\/captureLoginPage\.node-test\.mjs, which does not contain "zzqnotthere"/u,
      ],
      "an observed selector that the capture does not contain": [
        {
          ...filesB(),
          "evidence.json": edit(
            evidenceB(),
            (e) =>
              (e.selectors[0].selector = "form#sign-in input#not-captured"),
          ),
        },
        /selectors\[0\] is marked observed, but matches nothing in capture\.json/u,
      ],
      "a fixture cited as its own source": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => {
            e.source = "tests/fixtures/logins/pfsense/fixture.html";
            e.sources[0].path = e.source;
          }),
        },
        /the corpus and the steps data are not sources/u,
      ],
      "a steps file cited as a source": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => {
            e.source = "src/data/loginSteps/family/pfsense.json";
            e.sources[0].path = e.source;
          }),
        },
        /the corpus and the steps data are not sources/u,
      ],
      "class A with an inferred selector": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => {
            e.selectors[1].basis = "inferred";
          }),
        },
        /class A but selectors\[1\] is inferred/u,
      ],
      "class A carrying an unverified list": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.unverified = ["Other firmware."]),
          ),
        },
        /combination of fields that is not allowed/u,
      ],
      "class A built on an anonymous capture": [
        {
          ...filesB(),
          "evidence.json": edit(evidenceB(), (e) => {
            e.class = "A";
            delete e.unverified;
          }),
        },
        /class A but selectors\[0\] cites anonymous-capture/u,
      ],
      "class B that does not say what is unverified": [
        {
          ...filesB(),
          "evidence.json": edit(evidenceB(), (e) => delete e.unverified),
        },
        /is missing "unverified"/u,
      ],
      "class C with a selector": [
        {
          "evidence.json": edit(evidenceC(), (e) =>
            e.selectors.push({
              selector: "input",
              role: "other",
              source: "x",
              basis: "inferred",
            }),
          ),
        },
        /selectors allows at most 0/u,
      ],
      "class C that does not say what is needed": [
        { "evidence.json": edit(evidenceC(), (e) => delete e.neededFromUser) },
        /is missing "neededFromUser"/u,
      ],
      "public source on a moving branch": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => {
            e.source = "https://github.com/example/app/blob/master/login.html";
            e.sources[0] = {
              id: "repo",
              kind: "public-source",
              title: "The login template of the project",
              url: e.source,
              version: "v1.2.3",
              retrieved: "2026-10-12",
            };
          }),
        },
        /moving branch/u,
      ],
      "public source without a commit or version": [
        {
          ...filesA(),
          "evidence.json": edit(evidenceA(), (e) => {
            e.source =
              "https://github.com/example/app/blob/0123456789abcdef0123456789abcdef01234567/login.html";
            e.sources[0] = {
              id: "repo",
              kind: "public-source",
              title: "The login template of the project",
              url: e.source,
              retrieved: "2026-10-12",
            };
          }),
        },
        /sources\[0\] matches none of the allowed forms/u,
      ],
      "a source on a device address": [
        {
          ...filesB(),
          "evidence.json": edit(
            evidenceB(),
            (e) => (e.sources[1].url = "https://192.168.1.20/login"),
          ),
        },
        /private host 192\.168\.1\.20|private address/u,
      ],
      "a fixture that is listed but missing": [
        { "evidence.json": evidenceA() },
        /fixture fixture\.html is listed but does not exist/u,
      ],
      "a fixture that is not listed": [
        { ...filesA(), "fixture.extra.html": FIXTURE_A },
        /fixture\.extra\.html is not listed/u,
      ],
      "a form login without fixture.html": [
        {
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.fixtures[0].file = "fixture.login.html"),
          ),
          "fixture.login.html": FIXTURE_A,
        },
        /needs fixture\.html/u,
      ],
      "a selector that matches nothing in its fixture": [
        {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.selectors[0].selector = "form#iform input#user"),
          ),
        },
        /selectors\[0\] matches nothing/u,
      ],
      "a capture changed after it was made": [
        {
          ...filesB(),
          "capture.json": edit(
            captureB(),
            (c) =>
              (c.frames[0].tree.children[0].children[0].attributes.id =
                "edited"),
          ),
        },
        /does not match captureSha256/u,
      ],
      "a capture of some other page": [
        (() => {
          const capture = edit(
            captureB(),
            (c) => (c.source.requestedUrl = "https://example.org/login"),
          );
          return {
            ...filesB(),
            "capture.json": capture,
            "evidence.json": evidenceB(capture),
          };
        })(),
        /was made from https:\/\/example\.org\/login/u,
      ],
      "an anonymous capture of a page that is not the catalog's": [
        (() => {
          const capture = edit(
            captureB(),
            (c) => (c.source.requestedUrl = "https://example.org/login"),
          );
          return {
            ...filesB(),
            "capture.json": capture,
            "evidence.json": edit(evidenceB(capture), (e) => {
              e.source = "https://example.org/login";
              e.sources[0].url = e.source;
            }),
          };
        })(),
        /not the catalog hostedLoginUrl/u,
      ],
      "a capture from the tool's synthetic test mode": [
        (() => {
          const capture = edit(
            captureB(),
            (c) => (c.mode = "loopback-fixture"),
          );
          return {
            ...filesB(),
            "capture.json": capture,
            "evidence.json": evidenceB(capture),
          };
        })(),
        /only hosted and saved-page captures/u,
      ],
      "a capture that keeps a field value": [
        (() => {
          const capture = edit(
            captureB(),
            (c) =>
              (c.frames[0].tree.children[0].children[0].children[0].attributes.value =
                "someone"),
          );
          return {
            ...filesB(),
            "capture.json": capture,
            "evidence.json": evidenceB(capture),
          };
        })(),
        /keeps a field value/u,
      ],
      "a capture that is cited but missing": [
        (() => {
          const files = filesB();
          delete files["capture.json"];
          return files;
        })(),
        /capture capture\.json does not exist/u,
      ],
      "a capture nobody cites": [
        { ...filesA(), "capture.json": captureB() },
        /capture\.json is not cited/u,
      ],
      "a capture made for another application": [
        (() => {
          const capture = edit(captureB(), (c) => (c.applicationId = "zoom"));
          return {
            ...filesB(),
            "capture.json": capture,
            "evidence.json": evidenceB(capture),
          };
        })(),
        /capture\.json was captured for "zoom", not github/u,
      ],
      "a capture that saw a challenge the evidence leaves out": [
        (() => {
          const capture = edit(captureB(), (c) =>
            c.observations.unshift("captcha"),
          );
          return {
            ...filesB(),
            "capture.json": capture,
            "evidence.json": evidenceB(capture),
          };
        })(),
        /saw a challenge widget, but staysInteractive lists no captcha/u,
      ],
      "a file that is not part of the standard": [
        { ...filesA(), "vendor.js": "console.log(1);\n" },
        /vendor\.js is not a corpus file/u,
      ],
      "a copied asset": [
        { ...filesA(), "logo.png": "not really a png" },
        /logo\.png is not a corpus file/u,
      ],
      "a subdirectory": [
        { ...filesA(), "assets/fixture.html": FIXTURE_A },
        /assets\/ is a subdirectory/u,
      ],
    };
    for (const [name, [files, pattern, overrides]] of Object.entries(cases))
      await t.test(name, (t) =>
        expectFailure(checkTemporary(t, files, { overrides }), pattern),
      );
  });

  test("fails a directory with anything resembling a credential", async (t) => {
    const inFixture = (markup) => ({
      ...filesA(),
      "fixture.html": FIXTURE_A.replace("</form>", `${markup}</form>`),
    });
    const inNote = (text) => ({
      ...filesA(),
      "evidence.json": edit(evidenceA(), (e) => (e.notes = text)),
    });
    const cases = {
      "a password typed into the fixture": [
        {
          ...filesA(),
          "fixture.html": FIXTURE_A.replace(
            'type="password"',
            'type="password" value="hunter2"',
          ),
        },
        /password field with a value/u,
      ],
      "a secret in a form action": [
        inFixture(
          '<input type="hidden" name="next" value="/login?token=abcd1234">',
        ),
        /an assigned secret/u,
      ],
      "an authorization header": [
        inNote("The page answers to Authorization: Basic dXNlcjpwYXNzd29yZA=="),
        /an Authorization header/u,
      ],
      "a bearer token": [
        inNote("Requests carry Bearer abcdefghijklmnopqrstuvwxyz012345."),
        /an Authorization header/u,
      ],
      "a cookie header": [
        inNote("The server sent Set-Cookie: sid=abc; Path=/"),
        /a Cookie header/u,
      ],
      "user information in a URL": [
        inNote("Opened as https://admin:hunter2@device.example.com/login"),
        /user information in a URL/u,
      ],
      "a JSON web token": [
        inFixture(
          '<input type="hidden" name="state" value="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk">',
        ),
        /a JSON web token/u,
      ],
      "a private key": [
        inNote("-----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXktdjEAAAAA"),
        /a private key/u,
      ],
      "an authenticator secret": [
        inNote("Enrolled with otpauth://totp/Example:user?issuer=Example"),
        /an authenticator secret URI/u,
      ],
      "a cloud access key": [
        inNote("Signed in with key AKIAIOSFODNN7EXAMPLE on the console."),
        /a provider access key/u,
      ],
      "an assigned password in prose": [
        inNote("The default login is password=changeme123 on first boot."),
        /an assigned secret/u,
      ],
      "a real account name": [
        inNote("Tested while signed in as mariana.silva@gmail.com."),
        /an email address/u,
      ],
      "a session token in a hidden field": [
        inFixture(
          '<input type="hidden" name="csrf" value="k9Xq2LmP7vRt4ZsW8yBn3CdF6gHj1KaE5uTo0iNp">',
        ),
        /a long random-looking token/u,
      ],
      "a device address on the user's network": [
        inNote("Read from the switch at 192.168.1.20 in the office."),
        /a private address/u,
      ],
      "a loopback address": [
        inFixture('<a href="http://127.0.0.1:8080/admin" id="admin"></a>'),
        /a loopback address/u,
      ],
    };
    for (const [name, [files, pattern]] of Object.entries(cases))
      await t.test(name, (t) =>
        expectFailure(checkTemporary(t, files), pattern),
      );
    // Ordinary login vocabulary is not a credential.
    for (const text of [
      'input[name="password"][type="password"]:not([readonly])',
      "The password field is filled only after the identifier step.",
      "Uses autocomplete=current-password and a token field named csrf_token.",
      "Contact the vendor at support@example.com for the manual.",
      "Reviewed at commit 0123456 of the public repository.",
    ])
      assert.deepEqual(credentialFindings(text), [], text);
    assert.deepEqual(
      credentialFindings(
        "https://github.com/example/app/blob/0123456789abcdef0123456789abcdef01234567/pkg@1.2.3/login.html",
        { citation: true },
      ),
      [],
    );
  });

  test("fails a fixture that is not minimal synthetic controls", async (t) => {
    const withMarkup = (markup) => ({
      ...filesA(),
      "fixture.html": FIXTURE_A.replace("</body>", `${markup}</body>`),
    });
    const cases = {
      "an inline script": [
        withMarkup("<script>login()</script>"),
        /<script> element/u,
      ],
      "a vendor script": [
        withMarkup('<script src="/js/app.js"></script>'),
        /<script> element/u,
      ],
      "a stylesheet": [
        withMarkup('<link rel="stylesheet" href="/css/app.css">'),
        /<link> element/u,
      ],
      "a style block": [
        withMarkup("<style>form{color:red}</style>"),
        /<style> element/u,
      ],
      "an image": [
        withMarkup('<img src="/logo.png" alt="">'),
        /<img> element/u,
      ],
      "an inline icon": [
        withMarkup("<svg><path d='M0 0'/></svg>"),
        /<svg> element/u,
      ],
      "an inline handler": [
        withMarkup('<button type="button" onclick="login()">Go</button>'),
        /inline onclick handler/u,
      ],
      "a script URL": [
        withMarkup('<a id="go" href="javascript:login()">Go</a>'),
        /only the bare "javascript:" marker/u,
      ],
      "a frame that loads another site": [
        withMarkup(
          '<iframe id="sso" src="https://sso.example.com/widget"></iframe>',
        ),
        /a frame may only show a listed fixture file|not an origin of a listed fixture/u,
      ],
      "inline frame content": [
        withMarkup('<iframe id="sso" srcdoc="<input>"></iframe>'),
        /srcdoc attribute/u,
      ],
      "a form posting to an undeclared origin": [
        withMarkup(
          '<form action="https://login.example.com/session"><input name="x"></form>',
        ),
        /https:\/\/login\.example\.com, which is not an origin of a listed fixture/u,
      ],
      "a style attribute that loads an image": [
        withMarkup(
          '<div style="background:url(/bg.png)"><input name="x"></div>',
        ),
        /loads a resource from a style attribute/u,
      ],
      "page copy": [
        withMarkup(`<p>${"Lorem ipsum dolor sit amet. ".repeat(60)}</p>`),
        /characters of text/u,
      ],
      "no control at all": [
        {
          ...filesA(),
          "fixture.html":
            "<!doctype html><html><body><p>Sign in</p></body></html>",
        },
        /has no form control/u,
      ],
      "a template that hides markup": [
        withMarkup("<template><script>login()</script></template>"),
        /<template> that is not a declarative shadow root|<script> element/u,
      ],
      "an oversized file": [
        withMarkup(`<input name="pad" class="${"x ".repeat(40000)}">`),
        /is larger than/u,
      ],
    };
    for (const [name, [files, pattern]] of Object.entries(cases))
      await t.test(name, (t) =>
        expectFailure(checkTemporary(t, files), pattern),
      );

    await t.test(
      "accepts a declared second origin, a frame and a bare javascript: action",
      (t) => {
        const evidence = edit(evidenceA(), (e) => {
          e.fixtures.push(
            {
              file: "fixture.frame.html",
              path: "/",
              frame: "appFrame",
              derivedFrom: ["repo"],
            },
            {
              file: "fixture.idp.html",
              origin: "https://login.example.com",
              path: "/session",
              derivedFrom: ["repo"],
            },
          );
        });
        const result = checkTemporary(t, {
          "evidence.json": evidence,
          "fixture.html": FIXTURE_A.replace(
            "</body>",
            '<iframe id="appFrame" name="appFrame" src="fixture.frame.html"></iframe>' +
              '<form action="javascript:"><input name="spa"></form>' +
              '<form action="https://login.example.com/session"><input name="idp"></form></body>',
          ),
          "fixture.frame.html":
            '<!doctype html><html><body><input id="usernameInput"></body></html>',
          "fixture.idp.html":
            '<!doctype html><html><body><input name="idp"></body></html>',
        });
        assert.deepEqual(result.errors, []);
      },
    );
  });

  test(
    "keeps a steps file and its evidence saying the same thing",
    {
      skip: context.validator?.validateHttpLoginSteps
        ? false
        : "the steps validator is not available",
    },
    async (t) => {
      await t.test("accepts matching steps", (t) =>
        assert.deepEqual(
          checkTemporary(t, filesA(), { steps: stepsA() }).errors,
          [],
        ),
      );
      const cases = {
        "a different class": [
          filesA(),
          edit(stepsA(), (s) => (s.evidence.class = "B")),
          /evidence\.class is "B" but evidence\.json says "A"/u,
        ],
        "a different review date": [
          filesA(),
          edit(stepsA(), (s) => (s.evidence.reviewed = "2026-10-11")),
          /evidence\.reviewed is/u,
        ],
        "a different source": [
          filesA(),
          edit(stepsA(), (s) => (s.evidence.source = "docs/testing.md")),
          /evidence\.source is/u,
        ],
        "a selector the evidence does not cite": [
          filesA(),
          edit(
            stepsA(),
            (s) =>
              (s.loginSteps[0].selectors.username =
                "form#iform input#usernamefld"),
          ),
          /loginSteps\[0\]\.selectors\.username is not cited/u,
        ],
        "a selector that matches nothing in its fixture": [
          {
            ...filesA(),
            "evidence.json": edit(evidenceA(), (e) =>
              e.selectors.push({
                selector: "form#iform button#missing",
                role: "control",
                source: "repo",
                basis: "observed",
                locator: "line 20",
                fixture: "fixture.html",
              }),
            ),
          },
          edit(
            stepsA(),
            (s) =>
              (s.loginSteps[1].selectors.control = "form#iform button#missing"),
          ),
          /loginSteps\[1\]\.selectors\.control matches nothing in fixture\.html/u,
        ],
        "a step on an origin with no fixture": [
          filesA(),
          edit(stepsA(), (s) => {
            s.credentialOrigins = ["https://login.example.com"];
            s.loginSteps[0].origin = "https://login.example.com";
          }),
          /runs on https:\/\/login\.example\.com, where no fixture is served/u,
        ],
        "a step gated to a path no fixture is served on": [
          filesA(),
          edit(stepsA(), (s) => (s.loginSteps[0].paths = ["/admin/login"])),
          /where no fixture is served/u,
        ],
        "a step in a frame with no frame fixture": [
          filesA(),
          edit(stepsA(), (s) => (s.loginSteps[0].frame = "appFrame")),
          /in frame appFrame, where no fixture is served/u,
        ],
        "steps the validator rejects": [
          filesA(),
          edit(stepsA(), (s) => (s.loginSteps[0].value = "typed")),
          /unknown-field at loginSteps\[0\]\.value/u,
        ],
        "steps for a class C application": [
          filesC(),
          edit(stepsA(), (s) => (s.id = "lxd")),
          /class C but .*lxd\.json exists/u,
        ],
      };
      for (const [name, [files, steps, pattern]] of Object.entries(cases))
        await t.test(name, (t) =>
          expectFailure(checkTemporary(t, files, { steps }), pattern),
        );
    },
  );

  test("splits a selector list on its top-level commas only", () => {
    const cases = {
      "#a, #b": ["#a", "#b"],
      "form#f input": ["form#f input"],
      ":is(#a, #b) input, form:has(> #c, #d) button": [
        ":is(#a, #b) input",
        "form:has(> #c, #d) button",
      ],
      "input[data-x=\"a,b\"], input[name='c,d']": [
        'input[data-x="a,b"]',
        "input[name='c,d']",
      ],
      "a:not(.x, .y) , b": ["a:not(.x, .y)", "b"],
      'input[placeholder="a \\" , b"], #c': [
        'input[placeholder="a \\" , b"]',
        "#c",
      ],
      "#a\\,b": ["#a\\,b"],
    };
    for (const [selector, alternatives] of Object.entries(cases))
      assert.deepEqual(selectorAlternatives(selector), alternatives, selector);
    for (const broken of [
      "#a,,#b",
      "#a,",
      ",#a",
      "input#x[",
      "]]]",
      "a:is(b",
      "a)",
      "input[name='x]",
    ])
      assert.equal(selectorAlternatives(broken), null, broken);
    // Parsed: the list is split and every alternative is a selector.
    assert.deepEqual(parsedAlternatives("#a, form:has(#b) input"), [
      "#a",
      "form:has(#b) input",
    ]);
    for (const broken of ["]]]", "input#x[", "#a, input::", "form >> input"])
      assert.equal(parsedAlternatives(broken), null, broken);
  });

  test("fails a selector the checker cannot parse", async (t) => {
    await t.test("in evidence.json", (t) =>
      expectFailure(
        checkTemporary(t, {
          ...filesA(),
          "evidence.json": edit(
            evidenceA(),
            (e) => (e.selectors[0].selector = "form#iform input#usernamefld["),
          ),
        }),
        /selectors\[0\] is not a selector the checker can parse/u,
      ),
    );
    await t.test(
      "in the steps file",
      {
        skip: context.validator?.validateHttpLoginSteps
          ? false
          : "the steps validator is not available",
      },
      (t) => {
        const result = checkTemporary(t, filesA(), {
          steps: edit(
            stepsA(),
            (s) => (s.loginSteps[1].selectors.control = "]]]"),
          ),
        });
        expectFailure(
          result,
          /loginSteps\[1\]\.selectors\.control is not a selector the checker can parse/u,
        );
        // It fails; it is not passed over with a note.
        assert.deepEqual(
          result.notes.filter((note) => /not evaluated/u.test(note)),
          [],
        );
      },
    );
  });

  test(
    "requires every alternative of a selector list to match a fixture",
    {
      skip: context.validator?.validateHttpLoginSteps
        ? false
        : "the steps validator is not available",
    },
    async (t) => {
      // Two layouts of one page, each with its own fixture.
      const CLASSIC =
        '<!doctype html>\n<html><body><form id="clobber"><input id="user" name="user">' +
        '<input id="pass" name="pass" type="password"><button id="go" type="submit"></button></form></body></html>\n';
      const username =
        'form#iform input#usernamefld[name="usernamefld"], form#clobber input#user';
      const password =
        'form#iform input#passwordfld[type="password"], form#clobber input#pass[type="password"]';
      const control =
        'form#iform button[type="submit"][name="login"], form#clobber button#go';
      const twoLayouts = (change = () => {}) => {
        const evidence = edit(evidenceA(), (e) => {
          e.selectors[0].selector = username;
          e.selectors[1].selector = password;
          e.selectors[2].selector = control;
          e.fixtures.push({
            file: "fixture.classic.html",
            path: "/",
            derivedFrom: ["repo"],
          });
          change(e);
        });
        return {
          "evidence.json": evidence,
          "fixture.html": FIXTURE_A,
          "fixture.classic.html": CLASSIC,
        };
      };
      const steps = (change = () => {}) =>
        edit(stepsA(), (s) => {
          s.loginSteps[0].selectors = { username, password };
          s.loginSteps[1].selectors.control = control;
          change(s);
        });

      await t.test("both layouts matched: accepted", (t) =>
        assert.deepEqual(
          checkTemporary(t, twoLayouts(), { steps: steps() }).errors,
          [],
        ),
      );
      await t.test(
        "alternatives cited as entries of their own: accepted",
        (t) =>
          assert.deepEqual(
            checkTemporary(
              t,
              twoLayouts((e) => {
                // One entry per alternative, so each can cite its own source.
                const [current, classic] = username.split(", ");
                e.selectors[0].selector = current;
                e.selectors.push({
                  ...e.selectors[0],
                  selector: classic,
                  fixture: "fixture.classic.html",
                });
              }),
              { steps: steps() },
            ).errors,
            [],
          ),
      );
      // The same misspelling in evidence.json and in the steps file: one
      // matching alternative must not hide it.
      const misspelt = username.replace(
        "form#clobber input#user",
        "form#clobber input#usr",
      );
      await t.test("a misspelt alternative fails in the steps file", (t) => {
        const result = checkTemporary(
          t,
          twoLayouts((e) => (e.selectors[0].selector = misspelt)),
          {
            steps: steps(
              (s) => (s.loginSteps[0].selectors.username = misspelt),
            ),
          },
        );
        expectFailure(
          result,
          /loginSteps\[0\]\.selectors\.username alternative "form#clobber input#usr" matches nothing in fixture\.html, fixture\.classic\.html\. Every alternative of a selector list needs a fixture it matches/u,
        );
        expectFailure(
          result,
          /selectors\[0\] alternative "form#clobber input#usr" matches nothing in any fixture/u,
        );
      });
      await t.test("an alternative whose layout has no fixture fails", (t) => {
        const files = twoLayouts((e) => e.fixtures.pop());
        delete files["fixture.classic.html"];
        expectFailure(
          checkTemporary(t, files, { steps: steps() }),
          /loginSteps\[0\]\.selectors\.password alternative "form#clobber input#pass\[type="password"\]" matches nothing in fixture\.html/u,
        );
      });
      await t.test("an alternative that is cited nowhere fails", (t) =>
        expectFailure(
          checkTemporary(t, twoLayouts(), {
            steps: steps(
              (s) =>
                (s.loginSteps[1].selectors.control = `${control}, form#clobber input[type="submit"]`),
            ),
          }),
          /loginSteps\[1\]\.selectors\.control is not cited in evidence\.json selectors: list the selector as it is written here, or each of its alternatives as an entry of its own/u,
        ),
      );
      await t.test("an observed list is observed in every alternative", (t) => {
        const capture = captureB();
        const listed =
          'form#sign-in input#login_field[name="login"], form#old input#login';
        const files = {
          ...filesB(),
          "evidence.json": edit(evidenceB(capture), (e) => {
            e.selectors[0].selector = listed;
          }),
          "fixture.old.html":
            '<!doctype html>\n<html><body><form id="old"><input id="login"></form></body></html>\n',
        };
        files["evidence.json"].fixtures.push({
          file: "fixture.old.html",
          path: "/login",
          derivedFrom: ["guide"],
        });
        expectFailure(
          checkTemporary(t, files),
          /selectors\[0\] alternative "form#old input#login" is marked observed, but matches nothing in capture\.json/u,
        );
      });
    },
  );

  test("a selector inside a frame of another origin was not observed in the application's page", (t) => {
    // An earlier capture still holds the skeleton of a third-party frame.
    const capture = edit(legacyCaptureB(), (c) => {
      c.frames[0].tree.children[0].children.push({
        tag: "iframe",
        attributes: { src: "https://widget.example.net/challenge" },
      });
      c.frames.push({
        index: 1,
        parent: 0,
        name: null,
        url: "https://widget.example.net/challenge",
        sameOriginAsTop: false,
        controls: 1,
        tree: {
          tag: "html",
          attributes: {},
          children: [
            {
              tag: "body",
              attributes: {},
              children: [
                { tag: "input", attributes: { id: "challenge-answer" } },
              ],
            },
          ],
        },
      });
    });
    const files = {
      ...filesB(),
      "capture.json": capture,
      "evidence.json": edit(evidenceB(capture), (e) => {
        e.selectors.push({
          selector: "input#challenge-answer",
          role: "other",
          source: "page",
          basis: "observed",
          locator: "frames[1] #challenge-answer",
          fixture: "fixture.html",
        });
      }),
      "fixture.html": FIXTURE_B.replace(
        "</form>",
        '<input id="challenge-answer"></form>',
      ),
    };
    expectFailure(
      checkTemporary(t, files),
      /selectors\[2\] is marked observed, but matches nothing in capture\.json/u,
    );
    // Re-sanitizing drops that frame's skeleton and keeps its origin.
    const stripped = resanitizeCapture(capture);
    assert.deepEqual(stripped.frames[1], {
      index: 1,
      parent: 0,
      name: null,
      url: "https://widget.example.net",
      sameOriginAsTop: false,
    });
    assert.ok(!JSON.stringify(stripped).includes("challenge-answer"));
    // A capture written under the current rules may not hold one either.
    expectFailure(
      checkTemporary(t, {
        ...filesB(),
        "capture.json": edit(captureB(), (c) =>
          c.frames.push({
            index: 1,
            parent: 0,
            name: null,
            url: "https://widget.example.net/challenge",
            sameOriginAsTop: false,
            controls: 1,
            tree: { tag: "html", attributes: {} },
          }),
        ),
      }),
      /not in the capture tool's current sanitized form|does not match captureSha256/u,
    );
  });

  test("holds captures to the tool's current sanitizing rules", async (t) => {
    const withCapture = (capture) => ({
      ...filesB(),
      "capture.json": capture,
      "evidence.json": evidenceB(capture),
    });
    const command =
      /node scripts\/capture-login-page\.mjs --resanitize tests\/fixtures\/logins\/github\/capture\.json --update-evidence/u;
    const named = (name, sameOriginAsTop = true) =>
      edit(captureB(), (c) =>
        c.frames.push({
          index: 1,
          parent: 0,
          name,
          url: sameOriginAsTop ? "about:blank" : "https://widget.example.net/",
          sameOriginAsTop,
          controls: 0,
          tree: { tag: "html", attributes: {} },
        }),
      );

    await t.test("a plain name of a same-origin frame is accepted", (t) =>
      assert.deepEqual(
        checkTemporary(t, withCapture(named("appFrame"))).errors,
        [],
      ),
    );
    const refused = {
      "a name generated per session": named("a-m9iunublb80o"),
      "a token-shaped name": named(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      ),
      "free text of any length": named(`Signed in as ${"x".repeat(630)}`),
      "a name kept for a frame on another origin": named("appFrame", false),
    };
    for (const [name, capture] of Object.entries(refused))
      await t.test(name, (t) => {
        const result = checkTemporary(t, withCapture(capture));
        expectFailure(
          result,
          /frames\[1\]\.name is not the plain identifier of a same-origin frame/u,
        );
        // The message names the command that fixes it without a second load.
        expectFailure(result, command);
      });

    // A capture written before the current rules is a note until the gate has
    // re-sanitized it; under the gate's strict mode it fails.
    await t.test("a capture from before the current rules is noted", (t) => {
      const result = checkTemporary(t, withCapture(legacyCaptureB()));
      assert.deepEqual(result.errors, []);
      assert.ok(
        result.notes.some(
          (note) =>
            /not in the capture tool's current sanitized form/u.test(note) &&
            command.test(note),
        ),
        result.notes.join("\n"),
      );
    });
    await t.test("and fails at a gate", (t) =>
      expectFailure(
        checkTemporary(t, withCapture(legacyCaptureB()), {
          overrides: { context: { strict: true } },
        }),
        /not in the capture tool's current sanitized form/u,
      ),
    );
    await t.test(
      "a capture that claims the current rules must meet them",
      (t) =>
        expectFailure(
          checkTemporary(
            t,
            withCapture(
              edit(captureB(), (c) =>
                c.network.contacted.push("edge.microsoft.com:443"),
              ),
            ),
          ),
          /not in the capture tool's current sanitized form/u,
        ),
    );
  });

  test("compares the patterns it shares with the steps schema", () => {
    const steps = {
      $defs: {
        origin: { pattern: "^https://strict$" },
        selector: { pattern: schema.$defs.selectorText.pattern },
        path: { pattern: schema.$defs.fixture.properties.path.pattern },
        frame: { pattern: schema.$defs.fixture.properties.frame.pattern },
        evidence: {
          properties: {
            source: { pattern: schema.$defs.citation.pattern },
            reviewed: { pattern: "^another-date$" },
          },
        },
      },
    };
    assert.deepEqual(sharedPatternDrift(schema, steps), ["origin", "date"]);
    steps.$defs.origin.pattern = schema.$defs.origin.pattern;
    steps.$defs.evidence.properties.reviewed.pattern =
      schema.$defs.date.pattern;
    assert.deepEqual(sharedPatternDrift(schema, steps), []);
    // A pattern that has gone missing on either side is drift too.
    assert.deepEqual(sharedPatternDrift({ $defs: {} }, steps).length, 6);
    delete steps.$defs.frame;
    assert.deepEqual(sharedPatternDrift(schema, steps), ["frame"]);
  });

  test("a page the user is asked to save is asked for in the format that keeps the form", async (t) => {
    const asking = (neededFromUser, change = () => {}) => ({
      "evidence.json": edit(evidenceC(), (e) => {
        e.neededFromUser = neededFromUser;
        change(e);
      }),
    });
    const refused = /neededFromUser .* "Webpage, Complete"/u;
    for (const wrong of [
      "The sign-in page saved from the user's own browser as HTML (Webpage, HTML only).",
      "Save the page as Webpage, HTML only and import it.",
      "One sign-in with this layout, or the password page saved as HTML.",
      "The page saved from your own browser as an HTML file that contains its fields.",
      "Do not use HTML only.",
    ])
      await t.test(`refused: ${wrong}`, (t) =>
        expectFailure(checkTemporary(t, asking(wrong)), refused),
      );
    for (const right of [
      'The sign-in page saved from the user\'s own browser as "Webpage, Complete", with its _files folder.',
      "Save each as Webpage, Complete (HTML only re-downloads the address and misses a scripted form).",
      "The page saved as an HTML file that contains its fields. Save it as Webpage, Complete.",
      // No page is asked for: a saved password is not a saved page.
      "Say which Git provider the server signs in with: a saved password belongs to that page.",
      "Confirmation of how sign-in is done on the user's own server.",
    ])
      await t.test(`accepted: ${right}`, (t) =>
        assert.deepEqual(checkTemporary(t, asking(right)).errors, []),
      );
    // Only the instruction is held to this: other prose may mention the format.
    await t.test("the format may be mentioned outside the instruction", (t) =>
      assert.deepEqual(
        checkTemporary(
          t,
          asking(
            "Confirmation of how sign-in is done.",
            (e) =>
              (e.notes =
                "A first copy was saved as HTML only and held an empty shell."),
          ),
        ).errors,
        [],
      ),
    );
  });

  test("refuses a fixture on an origin that cannot be a listed origin", async (t) => {
    const onOrigin = (origin) => ({
      ...filesA(),
      "evidence.json": edit(evidenceA(), (e) =>
        e.fixtures.push({
          file: "fixture.idp.html",
          origin,
          path: "/",
          derivedFrom: ["repo"],
        }),
      ),
      "fixture.idp.html":
        '<!doctype html><html><body><input name="idp"></body></html>',
    });
    for (const origin of [
      "https://login.corp",
      "https://sso.device.local",
      "https://192.0.2.10",
      "http://login.example.com",
    ])
      await t.test(`the schema refuses ${origin}`, (t) =>
        expectFailure(
          checkTemporary(t, onOrigin(origin)),
          /fixtures\[1\]\.origin does not have the required form/u,
        ),
      );
    await t.test("a public identity origin is accepted", (t) =>
      assert.deepEqual(
        checkTemporary(t, onOrigin("https://login.example.com")).errors,
        [],
      ),
    );
    // With a stale, laxer copy of the pattern the validator still decides.
    await t.test(
      "the steps validator refuses it even when the schema copy is stale",
      {
        skip: context.validator?.validateHttpLoginSteps
          ? false
          : "the steps validator is not available",
      },
      (t) =>
        expectFailure(
          checkTemporary(t, onOrigin("https://login.corp"), {
            overrides: {
              context: {
                schema: edit(
                  schema,
                  (s) => (s.$defs.origin.pattern = "^https://[a-z0-9.-]+$"),
                ),
              },
            },
          }),
          /origin https:\/\/login\.corp is not acceptable to the steps format/u,
        ),
    );
  });

  test("reads the coverage matrix by its column names", () => {
    const { rows, duplicates } = coverageRows(
      [
        "| Application | Id | Catalog capability | Class | Mechanism | Steps file | Note |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| pfSense | `pfsense` | `known-form` | - | - | - | Reviewed form selectors |",
        "| Grafana | `grafana` | `generic-form` | A | `form` | `self-hosted/grafana.json` | Authoritative source |",
        "| pfSense again | `pfsense` | `known-form` | - | - | - | |",
        "",
        "| Term | Meaning |",
        "| --- | --- |",
        "| `not-an-id` | prose |",
      ].join("\n"),
    );
    assert.deepEqual(duplicates, ["pfsense"]);
    assert.deepEqual([...rows.keys()], ["pfsense", "grafana"]);
    assert.deepEqual(rows.get("grafana"), {
      application: "Grafana",
      capability: "generic-form",
      class: "A",
      note: "Authoritative source",
    });
    assert.equal(rows.get("pfsense").capability, "known-form");
  });

  const coverageSample = (enabled = false) => {
    const stepsRoot = path.join("anywhere", "loginSteps");
    const profile = (capability, loginFlow = null) => ({
      capability,
      loginFlow,
    });
    return coverageModel({
      catalog: new Map([
        ["pfsense", profile("known-form")],
        ["gmail", profile("known-form", "google")],
        ["youtube", profile("known-form", "google")],
        ["ddwrt", profile("http-auth")],
        ["custom", profile("custom-form")],
        ["generic-form", profile("generic-form")],
        ["nginx", profile("none")],
        ["grafana", profile("generic-form")],
        ["zoom", profile("manual")],
        ["adobe", profile("manual")],
        ["steam", profile("manual")],
        ["lxd", profile("manual")],
        ["jira", profile("generic-form")],
      ]),
      evidence: new Map([
        ["grafana", { class: "A", mechanism: "form" }],
        ["zoom", { class: "B", mechanism: "form" }],
        ["adobe", { class: "B", mechanism: "form" }],
        ["steam", { class: "C", mechanism: "none" }],
        ["lxd", { class: "C", mechanism: "none" }],
        ["new-switch", { class: "A", mechanism: "form" }],
      ]),
      steps: new Map([
        ["grafana", [path.join(stepsRoot, "self-hosted", "grafana.json")]],
        ["zoom", [path.join(stepsRoot, "hosted", "zoom.json")]],
        ["new-switch", [path.join(stepsRoot, "appliances", "new-switch.json")]],
      ]),
      stepsRoot,
      enabled,
    });
  };
  const coverageKept = () =>
    new Map(
      Object.entries({
        pfsense: { application: "pfSense" },
        gmail: { application: "Gmail" },
        youtube: { application: "YouTube" },
        ddwrt: { application: "DD-WRT" },
        custom: { application: "Custom application" },
        "generic-form": { application: "Generic login form" },
        nginx: { application: "Nginx configuration" },
        grafana: { application: "Grafana", note: "an older note" },
        zoom: { application: "Zoom web portal" },
        adobe: {
          application: "Adobe Account",
          note: "The format cannot gate on a URL fragment",
        },
        steam: {
          application: "Steam account",
          note: "Robots rules or terms: the subscriber agreement",
        },
        lxd: { application: "LXD / Incus", note: "No password form" },
        jira: { application: "Jira" },
        "new-switch": { application: "A new switch" },
      }),
    );

  test("places each application by its catalog entry, its evidence and its steps file", () => {
    const model = coverageSample();
    assert.deepEqual(
      Object.fromEntries(model.entries.map((entry) => [entry.id, entry.group])),
      {
        pfsense: "reviewed",
        gmail: "reviewed",
        youtube: "reviewed",
        ddwrt: "http",
        custom: "configured",
        "generic-form": "configured",
        nginx: "none",
        grafana: "steps",
        zoom: "steps",
        adobe: "evidence",
        steam: "nothing",
        lxd: "nothing",
        jira: "unexamined",
        "new-switch": "steps",
      },
    );
    assert.deepEqual(
      model.entries.find((entry) => entry.id === "grafana").stepsFiles,
      ["self-hosted/grafana.json"],
    );
    // A reviewed login stays where it is when evidence is added for it later.
    assert.equal(
      coverageGroup({
        id: "pfsense",
        capability: "known-form",
        evidence: { class: "A", mechanism: "form" },
        stepsFiles: ["self-hosted/pfsense.json"],
      }),
      "reviewed",
    );
    // Only the generic profile itself is configuration; another profile with
    // that capability still needs evidence.
    assert.equal(
      coverageGroup({
        id: "idrac",
        capability: "generic-form",
        evidence: null,
        stepsFiles: [],
      }),
      "unexamined",
    );
  });

  test("writes the coverage summary and matrix from the model", () => {
    const { summary, matrix, problems } = renderCoverage(
      coverageSample(),
      coverageKept(),
    );
    const cells = (text) =>
      comparableMarkdown(text).filter((line) => line.includes(" | "));
    assert.deepEqual(cells(summary), [
      "Where each application stands today | Applications",
      "--- | ---",
      "Signs in automatically with a reviewed login | 3",
      "HTTP authentication, no page form | 1",
      "Configured by you | 2",
      "No web login | 1",
      "Login steps written, class A: every selector seen in an authoritative source | 1",
      "Login steps written, class B: unverified layout | 1",
      "Evidence, but no steps file | 1",
      "Nothing to build from (class C) | 2",
      "Not examined yet | 1",
      "Total | 13",
      "Why nothing can be built | Applications | Meaning",
      "--- | --- | ---",
      ...NOTHING_REASONS.map(
        ([label, meaning]) =>
          `${label} | ${["Robots rules or terms", "No password form"].includes(label) ? 1 : 0} | ${meaning}`,
      ),
    ]);
    // Prose is wrapped; where a line ends is not what is being said.
    const said = summary.replace(/\s+/gu, " ");
    assert.ok(
      said.includes(
        "Of the 3 that sign in automatically, 1 uses reviewed form selectors and 2 keep a hand-written adapter (`google` 2).",
      ),
      summary,
    );
    assert.ok(
      said.includes(
        "No steps-based login is switched on yet. The 2 applications with login steps behave as they did before the steps were written: 1 is manual and 1 uses field detection.",
      ),
      summary,
    );
    // A profile that is not in the catalog is named and left out of the total.
    assert.ok(
      said.includes(
        "Listed below but not in the catalog, and not counted above: `new-switch`.",
      ),
      summary,
    );
    for (const line of summary.split("\n"))
      if (!line.startsWith("|")) assert.ok(line.length <= 100, line);
    // What only a user can add is counted from the sources the evidence cites.
    assert.ok(
      said.includes(
        "No evidence record cites a sign-in confirmed by a user, and none cites a page a user saved.",
      ),
      summary,
    );
    const supplied = coverageSample();
    const cite = (id, kind) =>
      (supplied.entries.find((entry) => entry.id === id).evidence.sources = [
        { kind: "repository" },
        { kind },
      ]);
    cite("grafana", "user-confirmation");
    cite("zoom", "user-confirmation");
    cite("steam", "user-capture");
    assert.ok(
      renderCoverage(supplied, coverageKept())
        .summary.replace(/\s+/gu, " ")
        .includes(
          "2 evidence records cite a sign-in confirmed by a user, and 1 cites a page a user saved.",
        ),
    );

    assert.deepEqual(
      matrix.split("\n").filter((line) => line.startsWith("### ")),
      [
        "### Signs in automatically today (3)",
        "### HTTP authentication (1)",
        "### Configured by you (2)",
        "### No web login (1)",
        "### Login steps written, not switched on (3)",
        "### Evidence, but no steps file (1)",
        "### Nothing to build from (2)",
        "### Not examined yet (1)",
      ],
    );
    const rows = new Map(
      cells(matrix).map((line) => [line.split(" | ")[1], line]),
    );
    assert.equal(
      rows.get("`gmail`"),
      "Gmail | `gmail` | `known-form` | - | - | - | Hand-written adapter (`google`)",
    );
    assert.equal(
      rows.get("`pfsense`"),
      "pfSense | `pfsense` | `known-form` | - | - | - | Reviewed form selectors",
    );
    // The note of a steps row is generated: what the document held is dropped.
    assert.equal(
      rows.get("`grafana`"),
      "Grafana | `grafana` | `generic-form` | A | `form` | `self-hosted/grafana.json` | Authoritative source",
    );
    assert.equal(
      rows.get("`zoom`"),
      "Zoom web portal | `zoom` | `manual` | B | `form` | `hosted/zoom.json` | Unverified layout",
    );
    assert.equal(
      rows.get("`new-switch`"),
      "A new switch | `new-switch` | - | A | `form` | `appliances/new-switch.json` | Authoritative source",
    );
    // Hand-written notes are kept where only a person can give the reason.
    assert.equal(
      rows.get("`adobe`"),
      "Adobe Account | `adobe` | `manual` | B | `form` | none | The format cannot gate on a URL fragment",
    );
    assert.equal(
      rows.get("`steam`"),
      "Steam account | `steam` | `manual` | C | `none` | none | Robots rules or terms: the subscriber agreement",
    );
    assert.equal(
      rows.get("`jira`"),
      "Jira | `jira` | `generic-form` | - | - | - | No evidence record yet",
    );
    // Rows are in name order, whatever the order of the catalog.
    assert.deepEqual([...rows.keys()].slice(2, 5), [
      "`gmail`",
      "`pfsense`",
      "`youtube`",
    ]);
    assert.deepEqual(problems, [
      `jira has no evidence record: add ${CORPUS}/jira/evidence.json`,
    ]);
  });

  test("names what the coverage document cannot say without a person", () => {
    const kept = coverageKept();
    kept.delete("pfsense");
    kept.get("adobe").note = "";
    kept.get("steam").note = "Their terms forbid it";
    kept.get("lxd").note = "No password formula";
    const { matrix, problems } = renderCoverage(coverageSample(), kept);
    assert.deepEqual(problems, [
      "pfsense has no name in the Application column",
      "adobe: say in the Note column why there is no steps file",
      // "No password formula" only begins like a reason.
      `lxd: the Note must open with one of: ${NOTHING_REASONS.map(([label]) => label).join("; ")}`,
      `steam: the Note must open with one of: ${NOTHING_REASONS.map(([label]) => label).join("; ")}`,
      `jira has no evidence record: add ${CORPUS}/jira/evidence.json`,
    ]);
    // What was written stays in the document until a person corrects it.
    assert.match(matrix, /\| Their terms forbid it\s+\|/u);
    assert.match(matrix, /\| pfsense\s+\| `pfsense`/u);
  });

  test("does not take a note the generator wrote for a person's reason", () => {
    // What each row held while it stood in another section.
    const kept = coverageKept();
    kept.get("adobe").note = "Unverified layout";
    kept.get("lxd").note = "No evidence record yet";
    kept.get("steam").note = "Hand-written adapter (`google`)";
    const { matrix, problems } = renderCoverage(coverageSample(), kept);
    const reasons = NOTHING_REASONS.map(([label]) => label).join("; ");
    assert.deepEqual(problems.slice(0, 3), [
      "adobe: say in the Note column why there is no steps file",
      `lxd: the Note must open with one of: ${reasons}`,
      `steam: the Note must open with one of: ${reasons}`,
    ]);
    const row = (id) =>
      comparableMarkdown(matrix).find((line) => line.includes(`| \`${id}\` |`));
    assert.equal(
      row("adobe"),
      "Adobe Account | `adobe` | `manual` | B | `form` | none | ",
    );
    assert.equal(
      row("steam"),
      "Steam account | `steam` | `manual` | C | `none` | none | ",
    );
  });

  test("says in the coverage document whether steps-based login is switched on", () => {
    const on = renderCoverage(coverageSample(true), coverageKept());
    assert.match(on.summary, /Steps-based login is switched on/u);
    assert.doesNotMatch(on.summary, /switched on yet/u);
    assert.match(on.matrix, /^### Login steps written \(3\)$/mu);
    const unknown = renderCoverage(coverageSample(null), coverageKept());
    assert.match(unknown.summary, /could not be read/u);
    assert.ok(
      unknown.problems.some((problem) => problem.includes(SUPPORT_GATE)),
      unknown.problems.join("\n"),
    );
  });

  test("reads the switch for steps-based login from the source", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sorng-coverage-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.equal(stepsLoginEnabled(root), null);
    const file = path.join(root, SUPPORT_GATE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const gate = (value) =>
      `/** Requires DECLARATIVE_LOGIN_SUPPORTED. */\nexport const DECLARATIVE_LOGIN_SUPPORTED: boolean = ${value};\nexport const DECLARATIVE_LOGIN_LEGACY_SUPPORTED: boolean = true;\n`;
    fs.writeFileSync(file, gate("false"));
    assert.equal(stepsLoginEnabled(root), false);
    fs.writeFileSync(file, gate("true"));
    assert.equal(stepsLoginEnabled(root), true);
    fs.writeFileSync(file, gate("isReady()"));
    assert.equal(stepsLoginEnabled(root), null);
  });

  test("writes tables the way the formatter keeps them", () => {
    assert.equal(
      markdownTable(
        ["Application", "Id", "n"],
        [
          ["Balcão Digital — E-REDES", "`e-redes`", "1"],
          ["X", "`x`", ""],
        ],
      ),
      [
        "| Application              | Id        | n   |",
        "| ------------------------ | --------- | --- |",
        "| Balcão Digital — E-REDES | `e-redes` | 1   |",
        "| X                        | `x`       |     |",
      ].join("\n"),
    );
  });

  test("wraps generated prose without starting a line like a list", () => {
    assert.equal(
      wrapProse("one two three four five six", 9),
      "one two\nthree\nfour five\nsix",
    );
    // "12." or "- " at the start of a line would be read as a list item.
    assert.equal(
      wrapProse("there are 12. and - then # more", 9),
      "there are 12.\nand -\nthen #\nmore",
    );
    // A number that is not a list marker may start a line.
    assert.equal(wrapProse("there are 12, and", 9), "there are\n12, and");
    // Two words tied together stay on one line.
    assert.equal(
      wrapProse(`a b c \`flow\`${TIE}19, d`, 9),
      "a b c\n`flow` 19,\nd",
    );
    assert.equal(wrapProse("short"), "short");
  });

  test("replaces a generated block and nothing around it", () => {
    const page = [
      "intro",
      "<!-- coverage:summary:begin -->",
      "old",
      "<!-- coverage:summary:end -->",
      "outro",
    ].join("\n");
    assert.equal(
      replaceBlock(page, "summary", "new\nlines"),
      [
        "intro",
        "<!-- coverage:summary:begin -->",
        "",
        "new",
        "lines",
        "",
        "<!-- coverage:summary:end -->",
        "outro",
      ].join("\n"),
    );
    assert.equal(replaceBlock(page, "matrix", "new"), null);
    assert.equal(
      replaceBlock(page.replace(":end", ":finish"), "summary", "new"),
      null,
    );
    assert.equal(
      replaceBlock(page.replace("begin", "start"), "summary", "new"),
      null,
    );
  });

  test("compares the coverage document cell by cell, whatever the padding", () => {
    const wanted = "| A | Id |\n| --- | --- |\n| Zoom | `zoom` |\ntext";
    assert.deepEqual(
      coverageDrift(
        "| A    | Id     |\n| ---- | ------ |\n| Zoom | `zoom` |\ntext  ",
        wanted,
      ),
      [],
    );
    const drift = coverageDrift(wanted.replace("Zoom", "Zum"), wanted);
    assert.equal(drift.length, 1);
    assert.match(drift[0], /line 3/u);
    assert.match(drift[0], /Zum \| `zoom`/u);
    assert.match(drift[0], /LOGIN_COVERAGE_WRITE=1/u);
    // A missing or extra line is drift too.
    assert.equal(coverageDrift(`${wanted}\nmore`, wanted).length, 1);
  });
});
