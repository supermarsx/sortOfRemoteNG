// Tooling suite for scripts/capture-login-page.mjs. Synthetic pages only: a
// temporary HTML file, or a node:http server on 127.0.0.1. No real site, saved
// account or device is contacted, and nothing is typed anywhere.
// Run with: node --test tests/tooling/captureLoginPage.node-test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(repo, "scripts/capture-login-page.mjs");
const tool = await import(pathToFileURL(script).href);
const {
  CAPTURE_SCHEMA,
  CaptureRefusal,
  assertPublicAddresses,
  canonicalSha256,
  captureFromFile,
  captureLoopbackFixture,
  classifyHost,
  connectionPolicy,
  edgeExecutable,
  findExistingCapture,
  NON_PUBLIC_SUFFIXES,
  CAPTURE_SANITIZER,
  CaptureFailure,
  OfflineFailure,
  describeOutcome,
  exitCodeFor,
  loadCatalogTargets,
  loadWasAttempted,
  looksSecret,
  normaliseContacted,
  openedDebuggingPort,
  removeStaleProfiles,
  renderFixtureHtml,
  resanitizeCapture,
  resolveCaptureTarget,
  runCaptureCommand,
  sanitizeAttribute,
  sanitizeFrameName,
  startConnectionGuard,
} = tool;

// Every string below must be absent from anything the tool writes.
const MARKERS = [
  "COMMENT-MARKER",
  "META-TOKEN-MARKER",
  "TITLE-TEXT-MARKER",
  "STYLE-BODY-MARKER",
  "SCRIPT-BODY-MARKER",
  "COOKIE-MARKER",
  "STORAGE-MARKER",
  "NOSCRIPT-TEXT-MARKER",
  "VISIBLE-TEXT-MARKER",
  "ALT-TEXT-MARKER",
  "QUERY-MARKER",
  "FRAGMENT-MARKER",
  "HANDLER-MARKER",
  "CSRF-VALUE-MARKER",
  "LABEL-TEXT-MARKER",
  "PLACEHOLDER-MARKER",
  "PREFILLED-USER-MARKER",
  "PREFILLED-PASSWORD-MARKER",
  "ARIA-LABEL-MARKER",
  "OPTION-VALUE-MARKER",
  "OPTION-TEXT-MARKER",
  "TEXTAREA-TEXT-MARKER",
  "DATA-JSON-MARKER",
  "TITLE-ATTR-MARKER",
  "BUTTON-TEXT-MARKER",
  "ANCHOR-TEXT-MARKER",
  "FRAME-TITLE-MARKER",
  "SRCDOC-MARKER",
  "TAB-TEXT-MARKER",
  "FRAME-NAME-MARKER",
  "SITEKEY-MARKER",
  "realmail-marker.com",
  "Sign in now",
  "192.168.50.7",
];

const savedPage = (tripwire) => `<!doctype html>
<!-- saved from url=(0036)https://192.168.50.7/COMMENT-MARKER -->
<html lang="en" class="login-root">
<head>
<meta charset="utf-8">
<meta name="csrf-token" content="META-TOKEN-MARKER">
<title>TITLE-TEXT-MARKER</title>
<link rel="stylesheet" href="${tripwire}/style.css">
<style>.x{background:url(${tripwire}/bg.png)} /* STYLE-BODY-MARKER */</style>
<script src="${tripwire}/vendor.js"></script>
<script>window.secret = "SCRIPT-BODY-MARKER"; document.cookie = "sid=COOKIE-MARKER"; localStorage.setItem("k", "STORAGE-MARKER");</script>
</head>
<body class="page-login theme-dark" id="top">
<noscript><form id="noscript-form"><input name="noscript-field"></form>NOSCRIPT-TEXT-MARKER</noscript>
<div id="wrapper" class="login-modal-content">
  <h1>VISIBLE-TEXT-MARKER</h1>
  <img src="${tripwire}/logo.png" alt="ALT-TEXT-MARKER">
  <form id="iform" name="iform" method="post" action="https://192.168.50.7/cgi-bin/login.cgi?session=QUERY-MARKER#FRAGMENT-MARKER" novalidate onsubmit="return HANDLER-MARKER()">
    <input type="hidden" name="__csrf" value="CSRF-VALUE-MARKER">
    <label for="usernamefld">LABEL-TEXT-MARKER</label>
    <input id="usernamefld" name="usernamefld" type="text" autocomplete="username" placeholder="PLACEHOLDER-MARKER" value="PREFILLED-USER-MARKER" required>
    <input id="passwordfld" name="passwordfld" type="password" autocomplete="current-password" aria-label="ARIA-LABEL-MARKER" value="PREFILLED-PASSWORD-MARKER">
    <select name="realm" id="realm"><option value="OPTION-VALUE-MARKER">OPTION-TEXT-MARKER</option><option>pam</option></select>
    <textarea name="notes">TEXTAREA-TEXT-MARKER</textarea>
    <button type="submit" name="login" value="1" class="btn btn-primary" data-testid="sign-in-button" data-state='{"token":"DATA-JSON-MARKER"}' title="TITLE-ATTR-MARKER" onclick="HANDLER-MARKER()">BUTTON-TEXT-MARKER</button>
    <input type="submit" id="alt-submit" value="Sign in now" formaction="/alt/login?step=QUERY-MARKER#FRAGMENT-MARKER">
    <a href="#" id="forgot" class="link">ANCHOR-TEXT-MARKER</a>
  </form>
  <iframe id="appFrame" name="appFrame" src="${tripwire}/frame.html?state=QUERY-MARKER" title="FRAME-TITLE-MARKER" srcdoc="<p>SRCDOC-MARKER</p>"></iframe>
  <div id="tab2" onclick="HANDLER-MARKER()" tabindex="0">TAB-TEXT-MARKER</div>
  <div class="g-recaptcha" data-sitekey="SITEKEY-MARKER"></div>
  <p>Signed in as someone@realmail-marker.com</p>
</div>
</body></html>
`;

function runTool(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repo,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });
}

async function scratch(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "sorng-capture-test-"));
  t.after(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 10 }),
  );
  return directory;
}

// A loopback listener that must never be reached; it counts connections.
async function tripwireServer(t) {
  const state = { connections: 0 };
  const sockets = new Set();
  const server = createServer((_request, response) =>
    response.writeHead(403).end(),
  );
  server.on("connection", (socket) => {
    state.connections++;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = server.address().port;
  state.origin = `http://127.0.0.1:${state.port}`;
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return state;
}

function walk(node, visit, ancestors = []) {
  visit(node, ancestors);
  for (const child of [...(node.children ?? []), ...(node.shadow ?? [])])
    walk(child, visit, [...ancestors, node]);
}

function findById(capture, id) {
  let found = null;
  // A frame on another origin has no tree: only its origin is recorded.
  for (const frame of capture.frames.filter((item) => item.tree))
    walk(frame.tree, (node, ancestors) => {
      if (node.attributes?.id === id) found = { node, ancestors, frame };
    });
  assert.ok(found, `the capture has no element with id ${id}`);
  return found;
}

function assertNoMarkers(text, label) {
  for (const marker of MARKERS)
    assert.ok(!text.includes(marker), `${label} contains ${marker}`);
}

const catalog = loadCatalogTargets(repo);
const fakeCatalog = (entries) => new Map(Object.entries(entries));
const refusal = (code) => (error) =>
  error instanceof CaptureRefusal && error.code === code;

test("reads the reviewed catalog targets", () => {
  assert.equal(catalog.get("github"), "https://github.com/login");
  assert.equal(catalog.has("zulip"), false, "zulip has no hostedLoginUrl");
  for (const [id, url] of catalog) {
    assert.equal(new URL(url).protocol, "https:", id);
    assert.equal(classifyHost(new URL(url).hostname), "public", id);
  }
});

test("accepts exactly a catalog hostedLoginUrl", () => {
  assert.deepEqual(resolveCaptureTarget({ id: "github" }, catalog), {
    kind: "hosted",
    applicationId: "github",
    url: "https://github.com/login",
  });
  assert.deepEqual(
    resolveCaptureTarget({ url: "https://github.com/login" }, catalog),
    {
      kind: "hosted",
      applicationId: "github",
      url: "https://github.com/login",
    },
  );
});

test("refuses a URL that is not a catalog hostedLoginUrl", () => {
  for (const url of [
    "https://example.com/login",
    "https://github.com/session",
    "https://github.com/login?return_to=%2F",
    "https://github.com/login#top",
    "http://github.com/login",
    "https://user@github.com/login",
    "https://github.com:8443/login",
    "https://github.com.example.net/login",
    "ftp://github.com/login",
    "not a url",
  ])
    assert.throws(
      () => resolveCaptureTarget({ url }, catalog),
      refusal("not-catalog-url"),
      url,
    );
  assert.throws(
    () => resolveCaptureTarget({ id: "no-such-application" }, catalog),
    refusal("unknown-application"),
  );
  // A self-hosted profile has no public page to render: a saved file only.
  assert.throws(
    () => resolveCaptureTarget({ id: "zulip" }, catalog),
    refusal("no-hosted-login"),
  );
  // An id and a URL must name the same catalog entry.
  assert.throws(
    () =>
      resolveCaptureTarget(
        { id: "github", url: "https://login.brevo.com/" },
        catalog,
      ),
    refusal("not-catalog-url"),
  );
  // The right origin is not enough: the whole URL must be the catalog's.
  assert.throws(
    () =>
      resolveCaptureTarget(
        { id: "github", url: "https://github.com/session" },
        catalog,
      ),
    refusal("not-catalog-url"),
  );
  assert.throws(() => resolveCaptureTarget({}, catalog), refusal("usage"));
});

test("refuses private, loopback and link-local addresses even when a catalog lists them", () => {
  const hosts = {
    "127.0.0.1": "loopback",
    "127.8.9.10": "loopback",
    localhost: "loopback",
    "app.localhost": "loopback",
    "[::1]": "loopback",
    "10.0.0.5": "private",
    "172.16.0.1": "private",
    "172.31.255.254": "private",
    "192.168.1.1": "private",
    "100.64.0.1": "private",
    "[fc00::1]": "private",
    "[fd12:3456:789a::1]": "private",
    "[::ffff:192.168.1.1]": "private",
    "169.254.169.254": "link-local",
    "[fe80::1]": "link-local",
    "0.0.0.0": "reserved",
    "[::]": "reserved",
    "224.0.0.251": "reserved",
    "192.0.2.10": "reserved",
    "router.local": "private",
    "nas.lan": "private",
    "printer.home.arpa": "private",
    "intranet.corp": "private",
    switch: "private",
    "hidden.onion": "reserved",
    "name.alt": "reserved",
    "smtp.mail": "reserved",
    "1.168.192.in-addr.arpa": "reserved",
    "host.test": "reserved",
    "host.invalid": "reserved",
    "host.example": "reserved",
    // WHATWG URL parsing folds these spellings into 127.0.0.1.
    2130706433: "loopback",
    "0x7f.0.0.1": "loopback",
  };
  for (const [host, kind] of Object.entries(hosts)) {
    const url = `https://${host}/login`;
    assert.equal(classifyHost(new URL(url).hostname), kind, host);
    assert.throws(
      () =>
        resolveCaptureTarget(
          { id: "poisoned" },
          fakeCatalog({ poisoned: url }),
        ),
      refusal("private-address"),
      host,
    );
    assert.throws(
      () => resolveCaptureTarget({ url }, catalog),
      refusal("private-address"),
      host,
    );
  }
  for (const host of ["github.com", "8.8.8.8", "[2606:4700:4700::1111]"])
    assert.equal(classifyHost(new URL(`https://${host}/`).hostname), "public");
  assert.equal(classifyHost("172.32.0.1"), "public");
  assert.equal(classifyHost("100.128.0.1"), "public");
  // Every listed suffix is refused, at any depth; names under example.com are not.
  for (const [suffix, kind] of Object.entries(NON_PUBLIC_SUFFIXES)) {
    assert.equal(classifyHost(`host.${suffix}`), kind, suffix);
    assert.notEqual(classifyHost(`a.b.${suffix}`), "public", suffix);
  }
  for (const host of [
    "login.example.com",
    "mail.example.org",
    "home.vendor.net",
  ])
    assert.equal(classifyHost(host), "public", host);
});

test("refuses a public name that resolves to a private address", async () => {
  const lookup = (answers) => async () => answers;
  await assert.rejects(
    assertPublicAddresses(
      "portal.example.com",
      lookup([{ address: "10.1.2.3", family: 4 }]),
    ),
    refusal("private-address"),
  );
  // One private answer is enough, whatever else the name resolves to.
  await assert.rejects(
    assertPublicAddresses(
      "portal.example.com",
      lookup([
        { address: "93.184.216.34", family: 4 },
        { address: "fe80::1", family: 6 },
      ]),
    ),
    refusal("private-address"),
  );
  await assert.rejects(
    assertPublicAddresses("portal.example.com", lookup([])),
    refusal("unresolved-host"),
  );
  assert.deepEqual(
    await assertPublicAddresses(
      "portal.example.com",
      lookup([{ address: "93.184.216.34", family: 4 }]),
    ),
    ["93.184.216.34"],
  );
});

test("the connection guard allows only public addresses for a hosted page", async () => {
  const lookups = [];
  const policy = connectionPolicy({
    mode: "hosted",
    ports: [443],
    lookup: async (host) => {
      lookups.push(host);
      return host === "rebind.example.com"
        ? [{ address: "192.168.0.10", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    },
  });
  assert.deepEqual(await policy.decide("login.example.com", 443), {
    allow: true,
    address: "93.184.216.34",
  });
  for (const [host, port] of [
    ["rebind.example.com", 443],
    ["192.168.1.1", 443],
    ["127.0.0.1", 443],
    ["localhost", 443],
    ["169.254.169.254", 80],
    ["::1", 443],
    ["login.example.com", 8443],
    ["login.example.com", 22],
  ])
    assert.equal(
      (await policy.decide(host, port)).allow,
      false,
      `${host}:${port}`,
    );
  assert.ok(!lookups.includes("localhost"), "local names are never resolved");
});

test("the connection guard keeps a synthetic run on its own loopback origins", async () => {
  const policy = connectionPolicy({
    mode: "loopback-fixture",
    allowed: ["127.0.0.1:4100", "localhost:4100"],
    lookup: async () => {
      throw new Error("a synthetic run must not resolve names");
    },
  });
  assert.deepEqual(await policy.decide("127.0.0.1", 4100), {
    allow: true,
    address: "127.0.0.1",
  });
  assert.deepEqual(await policy.decide("localhost", 4100), {
    allow: true,
    address: "127.0.0.1",
  });
  for (const [host, port] of [
    ["127.0.0.1", 4101],
    ["192.168.1.1", 4100],
    ["github.com", 443],
    ["edge.microsoft.com", 443],
  ])
    assert.equal(
      (await policy.decide(host, port)).allow,
      false,
      `${host}:${port}`,
    );
});

test("the guard carries allowed connections and refuses the rest", async (t) => {
  const echoed = [];
  const sockets = new Set();
  const echo = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk) => {
      echoed.push(chunk.toString("utf8"));
      socket.write(`echo:${chunk}`);
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => echo.listen(0, "127.0.0.1", resolve));
  const tripwire = await tripwireServer(t);
  const { port } = echo.address();
  const guard = await startConnectionGuard(
    connectionPolicy({
      mode: "loopback-fixture",
      allowed: [`127.0.0.1:${port}`],
    }),
  );
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await guard.close();
    await new Promise((resolve) => echo.close(resolve));
  });
  const tunnel = (target, payload) =>
    new Promise((resolve, reject) => {
      const socket = connect(guard.port, "127.0.0.1");
      let received = "";
      let sent = false;
      socket.on("data", (chunk) => {
        received += chunk.toString("utf8");
        if (!sent && /^HTTP\/1\.1 200 [^\r]*\r\n\r\n/u.test(received)) {
          sent = true;
          socket.write(payload);
        }
        if (received.includes(`echo:${payload}`)) socket.end();
      });
      socket.once("error", reject);
      socket.once("close", () => resolve(received));
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });

  const carried = await tunnel(`127.0.0.1:${port}`, "ping");
  assert.match(carried, /^HTTP\/1\.1 200 /u);
  assert.ok(carried.endsWith("echo:ping"), carried);
  assert.deepEqual(echoed, ["ping"]);

  for (const target of [
    `127.0.0.1:${tripwire.port}`,
    `localhost:${port}`,
    "192.168.1.1:443",
    "github.com:443",
    `[::1]:${port}`,
  ])
    assert.match(await tunnel(target, "ping"), /^HTTP\/1\.1 403 /u, target);
  assert.equal(tripwire.connections, 0);
  assert.deepEqual(echoed, ["ping"], "a refused tunnel carries nothing");
  assert.deepEqual([...guard.contacted], [`127.0.0.1:${port}`]);
  assert.ok(guard.refused.has("github.com:443"));
});

test("the synthetic entry point accepts nothing but a 127.0.0.1 URL", async () => {
  for (const url of [
    "https://github.com/login",
    "http://192.168.1.1:8080/",
    "http://localhost:8080/",
    "http://127.0.0.1/",
    "https://127.0.0.1:8443/",
  ])
    await assert.rejects(
      captureLoopbackFixture(url),
      refusal("not-loopback-fixture"),
      url,
    );
  await assert.rejects(
    captureLoopbackFixture("http://127.0.0.1:4100/", {
      extraOrigins: ["http://192.168.1.1:4100"],
    }),
    refusal("not-loopback-fixture"),
  );
});

test("the command line refuses before anything is launched", async (t) => {
  const temp = await scratch(t);
  const env = { TEMP: temp, TMP: temp, TMPDIR: temp };
  const out = path.join(temp, "capture.json");
  const cases = [
    [["--url", "http://127.0.0.1:9/", "--out", out], /private|loopback/iu],
    [["--url", "https://192.168.1.1/", "--out", out], /private|loopback/iu],
    [["--url", "https://example.com/login", "--out", out], /hostedLoginUrl/u],
    [["--id", "zulip", "--out", out], /--from-file/u],
    [["--id", "no-such-application", "--out", out], /not in the catalog/iu],
    [[], /Usage/u],
    [["--bogus"], /Usage/u],
    [
      [
        "--id",
        "github",
        "--from-file",
        "page.html",
        "--url",
        "https://github.com/login",
      ],
      /--from-file.*--url|--url.*--from-file/isu,
    ],
    [
      ["--id", "eaton-ups", "--from-file", "page.mhtml", "--out", out],
      /"Webpage, Complete"/u,
    ],
  ];
  for (const [args, message] of cases) {
    const result = await runTool(args, env);
    assert.equal(result.code, 2, `${args.join(" ")}\n${result.stderr}`);
    assert.match(result.stderr, message, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
  }
  assert.equal(existsSync(out), false);
  assert.deepEqual(
    readdirSync(temp),
    [],
    "a refusal must not create a browser profile or any file",
  );
});

test("a saved page becomes a skeleton with what a selector needs", async (t) => {
  const temp = await scratch(t);
  const tripwire = await tripwireServer(t);
  const page = path.join(temp, "saved login.html");
  const out = path.join(temp, "out", "capture.json");
  const fixture = path.join(temp, "out", "fixture.html");
  await mkdir(path.dirname(out));
  await writeFile(page, savedPage(tripwire.origin), "utf8");

  const result = await runTool([
    "--id",
    "eaton-ups",
    "--from-file",
    page,
    "--out",
    out,
    "--fixture",
    fixture,
  ]);
  assert.equal(result.code, 0, result.stderr);
  const text = await readFile(out, "utf8");
  const capture = JSON.parse(text);

  assert.equal(capture.schema, CAPTURE_SCHEMA);
  assert.equal(capture.applicationId, "eaton-ups");
  assert.equal(capture.mode, "file");
  assert.match(capture.capturedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(capture.limits.input, "none");
  assert.equal(capture.limits.scriptsExecuted, false);
  assert.equal(capture.frames.length, 1, "a saved page loads no frame");
  assert.deepEqual(Object.keys(capture.source), ["kind"]);
  assert.equal(capture.sanitizer, CAPTURE_SANITIZER);
  assert.deepEqual(resanitizeCapture(capture), capture);

  // Ancestor context, as reviewed selectors use it.
  const username = findById(capture, "usernamefld");
  assert.deepEqual(
    username.ancestors.map((node) => node.tag),
    ["html", "body", "div", "form"],
  );
  const [html, body, wrapper, form] = username.ancestors;
  assert.deepEqual(html.attributes, { lang: "en", class: "login-root" });
  assert.deepEqual(body.attributes, {
    class: "page-login theme-dark",
    id: "top",
  });
  assert.deepEqual(wrapper.attributes, {
    id: "wrapper",
    class: "login-modal-content",
  });
  assert.equal(form.attributes.id, "iform");
  assert.equal(form.attributes.name, "iform");
  assert.equal(form.attributes.method, "post");
  assert.equal(form.attributes.novalidate, "");
  assert.match(
    form.attributes.action,
    /^https:\/\/origin-\d+\.invalid\/cgi-bin\/login\.cgi$/u,
  );
  assert.equal(form.attributes.onsubmit, null, "a handler is presence only");

  assert.deepEqual(username.node.attributes, {
    id: "usernamefld",
    name: "usernamefld",
    type: "text",
    autocomplete: "username",
    placeholder: null,
    value: null,
    required: "",
  });
  assert.deepEqual(findById(capture, "passwordfld").node.attributes, {
    id: "passwordfld",
    name: "passwordfld",
    type: "password",
    autocomplete: "current-password",
    "aria-label": null,
    value: null,
  });

  const realm = findById(capture, "realm").node;
  assert.equal(realm.options, 2);
  assert.equal(realm.children, undefined, "options are counted, not copied");

  let submit = null;
  let hidden = null;
  let label = null;
  walk(capture.frames[0].tree, (node) => {
    if (node.attributes?.["data-testid"] === "sign-in-button") submit = node;
    if (node.attributes?.name === "__csrf") hidden = node;
    if (node.tag === "label") label = node;
  });
  assert.deepEqual(submit.attributes, {
    type: "submit",
    name: "login",
    value: "1",
    class: "btn btn-primary",
    "data-testid": "sign-in-button",
    "data-state": null,
    title: null,
    onclick: null,
  });
  assert.deepEqual(hidden.attributes, {
    type: "hidden",
    name: "__csrf",
    value: null,
  });
  assert.deepEqual(label.attributes, { for: "usernamefld" });
  assert.equal(findById(capture, "alt-submit").node.attributes.value, null);
  assert.equal(
    findById(capture, "alt-submit").node.attributes.formaction,
    "/alt/login",
  );
  assert.equal(findById(capture, "forgot").node.attributes.href, "#");

  const frame = findById(capture, "appFrame").node;
  assert.equal(frame.attributes.name, "appFrame");
  assert.match(
    frame.attributes.src,
    /^https?:\/\/origin-\d+\.invalid\/frame\.html$/u,
  );
  assert.equal(frame.attributes.title, null);
  assert.equal(frame.attributes.srcdoc, null);
  assert.deepEqual(findById(capture, "tab2").node.attributes, {
    id: "tab2",
    onclick: null,
    tabindex: "0",
  });
  // A challenge widget is noted, never read or answered.
  assert.deepEqual(capture.observations, ["captcha", "password-field"]);

  // Nothing but the controls and their ancestors.
  const tags = new Set();
  walk(capture.frames[0].tree, (node) => tags.add(node.tag));
  for (const tag of ["script", "style", "noscript", "option", "img", "h1", "p"])
    assert.ok(!tags.has(tag), `${tag} must not be captured`);
  assert.ok(
    !text.includes("noscript-form"),
    "markup inside noscript is not rendered and must not be captured",
  );

  assertNoMarkers(text, "the capture");
  assert.ok(!/cookie|storage/iu.test(text), "no cookie or storage data");
  const keys = new Set();
  JSON.parse(text, (key, value) => (keys.add(key), value));
  for (const key of ["text", "textContent", "innerHTML", "cookies", "script"])
    assert.ok(!keys.has(key), `the capture has a ${key} key`);

  // The printed hash survives reformatting and a CRLF checkout.
  const hash = canonicalSha256(capture);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.ok(result.stdout.includes(hash), result.stdout);
  assert.equal(canonicalSha256(JSON.parse(JSON.stringify(capture))), hash);
  assert.equal(
    canonicalSha256(JSON.parse(text.replace(/\r?\n/gu, "\r\n"))),
    hash,
  );
  const edited = structuredClone(capture);
  findById(edited, "usernamefld").node.attributes.id = "edited";
  assert.notEqual(canonicalSha256(edited), hash);

  // The fixture draft is synthetic: controls only.
  const draft = await readFile(fixture, "utf8");
  assertNoMarkers(draft, "the fixture draft");
  assert.equal(draft, renderFixtureHtml(capture));
  const { document } = new JSDOM(draft).window;
  assert.equal(
    document.querySelectorAll(
      "script,style,link,img,meta[content],noscript,option,svg,base",
    ).length,
    0,
  );
  assert.ok(
    document.querySelector(
      "html.login-root body#top.page-login .login-modal-content form#iform[name=iform][method=post] input#usernamefld[name=usernamefld][autocomplete=username]:not([value])",
    ),
    "a reviewed-style selector matches the draft",
  );
  assert.ok(
    document.querySelector(
      'button[type=submit][name=login][value="1"][data-testid=sign-in-button]',
    ),
  );
  assert.equal(
    document.querySelector("#passwordfld").hasAttribute("value"),
    false,
  );
  assert.equal(
    document.querySelector("iframe#appFrame").hasAttribute("src"),
    false,
  );
  const iterator = document.createNodeIterator(document, 4 | 128);
  for (let node = iterator.nextNode(); node; node = iterator.nextNode())
    assert.equal(node.nodeValue.trim(), "", "the draft has no text or comment");
  for (const element of document.querySelectorAll("*"))
    for (const { name } of element.attributes)
      assert.ok(!/^on|^style$|^srcdoc$/u.test(name), `${name} in the draft`);

  // The same result from the module API.
  assert.deepEqual(
    (await captureFromFile(page, { applicationId: "eaton-ups" })).frames,
    capture.frames,
  );

  // A second run never overwrites what was captured.
  const again = await runTool([
    "--id",
    "eaton-ups",
    "--from-file",
    page,
    "--out",
    out,
  ]);
  assert.equal(again.code, 2, again.stderr);
  assert.match(again.stderr, /already exists/u);
  assert.equal(await readFile(out, "utf8"), text);

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(tripwire.connections, 0, "a saved page must not load anything");
});

test("controls named like DOM properties cannot hide a form from the read", async (t) => {
  const temp = await scratch(t);
  const page = path.join(temp, "clobbered.html");
  await writeFile(
    page,
    '<!doctype html><html><body><img name="documentElement"><form id="login" name="defaultView">' +
      '<input name="children"><input name="attributes"><input name="localName">' +
      '<input name="shadowRoot"><input name="getAttribute"><input id="pass" name="password" type="password">' +
      "</form></body></html>",
    "utf8",
  );
  const capture = await captureFromFile(page, { applicationId: "custom" });
  const form = findById(capture, "login").node;
  assert.deepEqual(
    form.children.map((node) => node.attributes.name),
    [
      "children",
      "attributes",
      "localName",
      "shadowRoot",
      "getAttribute",
      "password",
    ],
  );
  assert.deepEqual(capture.observations, ["password-field"]);
});

test("attribute values are kept only when they are structural", () => {
  const input = { tag: "input", type: "text" };
  const button = { tag: "button", type: "submit" };
  const cases = [
    [input, "id", "ctl00_ContentPlaceHolder1_LoginUser_UserName", "same"],
    [input, "name", "user[login]", "same"],
    [input, "class", "MuiInputBase-input MuiOutlinedInput-input", "same"],
    [input, "autocomplete", "current-password", "same"],
    [input, "formcontrolname", "email", "same"],
    [input, "data-drupal-selector", "edit-name", "same"],
    [input, "required", "", "same"],
    [input, "value", "admin", null],
    [{ tag: "input", type: "hidden" }, "value", "login", null],
    [{ tag: "input", type: "submit" }, "value", "Log in", null],
    [{ tag: "input", type: "submit" }, "value", "login", "same"],
    [button, "value", "1", "same"],
    [button, "onclick", "doLogin()", null],
    [button, "aria-label", "Sign in", null],
    [button, "aria-disabled", "true", "same"],
    [input, "placeholder", "Email address", null],
    [input, "style", "background:url(https://x.example/a.png)", null],
    [input, "nonce", "r4nd0m", null],
    [input, "data-user", "someone@example.org", null],
    [input, "data-config", '{"a":1}', null],
    [
      input,
      "data-token",
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c",
      null,
    ],
    [input, "id", "x".repeat(300), null],
    // An id or a name is an identifier or it is page text: no spaces, bounded.
    [input, "id", "Welcome back, Mariana", null],
    [input, "name", "user name", null],
    [input, "id", "x".repeat(129), null],
    [input, "id", "x".repeat(128), "same"],
    [input, "id", ":r1:", "same"],
    [input, "id", "j_id0:j_id5", "same"],
    [input, "name", "ctl00$Main$LoginUser$UserName", "same"],
    [input, "name", "data[User][username]", "same"],
    [input, "name", "utilizador", "same"],
    [{ tag: "label" }, "for", "user name", null],
    [{ tag: "label" }, "for", "usernamefld", "same"],
    [input, "form", "login form", null],
    // Every aria attribute that carries words for a person is text.
    [button, "aria-braillelabel", "Sign in", null],
    [button, "aria-brailleroledescription", "button", null],
    [button, "aria-keyshortcuts", "Alt+S", null],
    [button, "aria-description", "Opens your account", null],
    [button, "aria-unknown-future-text", "Sign in", null],
    // A list of ids is kept only against the ids of its document (below).
    [input, "aria-labelledby", "label-user hint-user", null],
    [input, "aria-describedby", "hint.user", null],
    [input, "aria-describedby", "Signed in, as Mariana!", null],
    [input, "aria-invalid", "false", "same"],
    [input, "aria-required", "true", "same"],
    [input, "aria-autocomplete", "list", "same"],
    [input, "aria-valuenow", "3", "same"],
    [
      input,
      "class",
      "field eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc wide",
      "field wide",
    ],
    [{ tag: "form" }, "action", "/session?next=%2F#x", "/session"],
    [{ tag: "form" }, "action", "javascript:void(doLogin('x'))", "javascript:"],
    [{ tag: "form" }, "action", "", "same"],
    [
      { tag: "form" },
      "action",
      "https://login.example.com/oauth/authorize?client_id=abc&state=xyz",
      "https://login.example.com/oauth/authorize",
    ],
    [
      { tag: "form" },
      "action",
      "https://user:pass@login.example.com/a",
      "https://login.example.com/a",
    ],
    [
      { tag: "iframe" },
      "src",
      "//idp.example.com/widget/9f86d081884c7d659a2feaa0c55ad015/frame",
      "//idp.example.com/widget/[withheld]/frame",
    ],
    [{ tag: "iframe" }, "src", "data:text/html,<p>x</p>", "data:"],
    [{ tag: "a" }, "href", "/owa/shared@example.com/", "/owa/[withheld]/"],
  ];
  for (const [element, name, value, expected] of cases)
    assert.equal(
      sanitizeAttribute(element, name, value, { mode: "hosted" }),
      expected === "same" ? value : expected,
      `${element.tag} ${name}=${value}`,
    );
  // A list of ids is words until every one of them is an id of the document:
  // "signed in as" is three identifier-shaped tokens too.
  const ids = new Set(["label-user", "hint-user", "hint.user", "as"]);
  for (const [name, value, kept] of [
    ["aria-labelledby", "label-user hint-user", true],
    ["aria-describedby", "hint.user", true],
    ["aria-describedby", "  hint.user   label-user ", true],
    ["aria-labelledby", "label-user missing-one", false],
    ["aria-describedby", "signed in as", false],
    ["aria-controls", "Mariana", false],
    ["aria-owns", "", true],
    // Nine references are more than a control has.
    ["aria-labelledby", new Array(9).fill("hint-user").join(" "), false],
  ])
    assert.equal(
      sanitizeAttribute(input, name, value, { mode: "hosted", ids }),
      kept ? value : null,
      `${name}=${value}`,
    );
  // A private or intranet host is never written, whatever the mode.
  assert.equal(
    sanitizeAttribute({ tag: "form" }, "action", "https://10.0.0.8/login", {
      mode: "hosted",
    }),
    "https://origin-1.invalid/login",
  );
  const aliases = { mode: "file" };
  assert.equal(
    sanitizeAttribute(
      { tag: "form" },
      "action",
      "https://nas.example.org/a",
      aliases,
    ),
    "https://origin-1.invalid/a",
  );
  assert.equal(
    sanitizeAttribute(
      { tag: "iframe" },
      "src",
      "https://sso.example.org/b",
      aliases,
    ),
    "https://origin-2.invalid/b",
  );
  assert.equal(
    sanitizeAttribute(
      { tag: "a" },
      "href",
      "https://nas.example.org/c",
      aliases,
    ),
    "https://origin-1.invalid/c",
    "one saved host keeps one alias",
  );
});

test("secret-looking tokens are recognised without eating ordinary identifiers", () => {
  for (const token of [
    "someone@example.org",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b",
    "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1O",
    "k9Xq2LmP7vRt4ZsW8yBn3CdF6gHj1KaE5uTo0iNp",
  ])
    assert.equal(looksSecret(token), true, token);
  for (const token of [
    "ctl00_ContentPlaceHolder1_LoginUser_UserName",
    "ContentPlaceHolderMainLoginFormUserNameTextBox",
    "MuiOutlinedInput-notchedOutline",
    "mod-login-username",
    "session_password",
    "user[password]",
    "g-recaptcha-response",
    "btn-login-submit",
    "css-1q2w3e4",
    "@container",
  ])
    assert.equal(looksSecret(token), false, token);
});

test("one load per provider: an existing capture of the same page is found", async (t) => {
  const corpus = await scratch(t);
  await mkdir(path.join(corpus, "github"));
  await writeFile(
    path.join(corpus, "github", "capture.json"),
    JSON.stringify({
      schema: CAPTURE_SCHEMA,
      mode: "hosted",
      source: { requestedUrl: "https://github.com/login" },
    }),
  );
  await writeFile(path.join(corpus, "github", "evidence.json"), "{}");
  await writeFile(path.join(corpus, "README.md"), "# not an application\n");
  assert.equal(
    findExistingCapture(corpus, "https://github.com/login"),
    path.join(corpus, "github", "capture.json"),
  );
  assert.equal(findExistingCapture(corpus, "https://login.brevo.com/"), null);
  assert.equal(
    findExistingCapture(
      path.join(corpus, "missing"),
      "https://github.com/login",
    ),
    null,
  );
});

test("the tool has no code that types, clicks, or reads text, cookies or storage", () => {
  const source = readFileSync(script, "utf8");
  for (const pattern of [
    /\bInput\.(dispatch|insert|synthesize|ime)/u,
    /\.click\(/u,
    /\.submit\(/u,
    /\.requestSubmit\(/u,
    /\.focus\(/u,
    /dispatchEvent/u,
    /insertText/u,
    /\.value\s*=[^=]/u,
    /document\.cookie/u,
    /getCookies|getAllCookies/u,
    /localStorage|sessionStorage|indexedDB/u,
    /textContent|innerText|innerHTML|outerHTML|nodeValue/u,
    /DOMSnapshot|DOM\.getOuterHTML|Page\.captureSnapshot|Page\.captureScreenshot/u,
    /--user-data-dir=(?!\$\{profile\})/u,
    /--ignore-certificate-errors|--disable-web-security|--no-sandbox/u,
    /hideWebdriver|--user-agent|setUserAgentOverride/u,
    // The pipe is the only way in: a debugging port would let any local
    // process read and drive the page.
    /--remote-debugging-(?!pipe")/u,
    /--remote-allow-origins/u,
  ])
    assert.doesNotMatch(source, pattern);
  assert.match(source, /"--remote-debugging-pipe",/u);
  // One place creates a world in a document and one place evaluates in it.
  for (const command of ["Page.createIsolatedWorld", "Runtime.evaluate"])
    assert.equal(source.split(`"${command}"`).length - 1, 1, command);
  // The profile is created fresh under the system temporary directory.
  assert.match(source, /mkdtemp\(path\.join\(tmpdir\(\), PROFILE_PREFIX\)\)/u);
  assert.match(source, /--user-data-dir=\$\{profile\}/u);
});

test("a frame name is written only when it is a plain authored identifier", () => {
  for (const name of [
    "appFrame",
    "sameFrame",
    "freshworks-frame",
    "__uspapiLocator",
    "launcher",
    "iwc",
    "frame1",
    "ms-oauth2-frame",
    "login_iframe",
  ])
    assert.equal(sanitizeFrameName(name), name, name);
  for (const name of [
    // A per-session widget name, as challenge widgets generate them.
    "a-m9iunublb80o",
    "a-nntc24bde7qd",
    "gsi_123456_789",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "someone@example.org",
    "Sign in frame",
    "frame.name",
    "x".repeat(65),
    `FRAME-NAME-MARKER ${"x".repeat(630)}`,
    "",
    null,
    undefined,
  ])
    assert.equal(sanitizeFrameName(name), null, String(name).slice(0, 40));
});

test("the contacted list drops the browser's own hosts and country-specific spellings", () => {
  assert.deepEqual(
    normaliseContacted([
      "zoom.us:443",
      "edge.microsoft.com:443",
      "edge.microsoft.com:80",
      "data-edge.smartscreen.microsoft.com:443",
      "nav-edge.smartscreen.microsoft.com:443",
      "postnav-edge.smartscreen.microsoft.com:443",
      "www.bing.com:443",
      "bat.bing.com:443",
      "www.google.com:443",
      "www.google.pt:443",
      "www.google.co.uk:443",
      "accounts.google.com.br:443",
      "login.microsoftonline.com:443",
      "browser.events.data.microsoft.com:443",
      "zoom.us:443",
      "k9Xq2LmP7vRt4ZsW8yBn3CdF6gHj1KaE5uTo0iNp.tracker.example.com:443",
      "not a host",
      "https://zoom.us",
    ]),
    [
      "[withheld].tracker.example.com:443",
      "accounts.google.[country]:443",
      "bat.bing.com:443",
      "browser.events.data.microsoft.com:443",
      "login.microsoftonline.com:443",
      "www.google.[country]:443",
      "www.google.com:443",
      "zoom.us:443",
    ],
  );
  // Applying it again changes nothing.
  const once = normaliseContacted(["www.google.pt:443", "127.0.0.1:4100"]);
  assert.deepEqual(once, ["127.0.0.1:4100", "www.google.[country]:443"]);
  assert.deepEqual(normaliseContacted(once), once);
});

// A capture as the first version of the tool wrote it: a per-session frame
// name in two places, inherited-origin frames marked cross-origin, and the
// browser's own hosts in the contacted list.
const legacyCapture = () => ({
  schema: CAPTURE_SCHEMA,
  applicationId: "zoom",
  capturedAt: "2026-10-12",
  mode: "hosted",
  engine: "Microsoft Edge headless (Edg/146.0.3856.84)",
  source: {
    kind: "hosted-login",
    requestedUrl: "https://zoom.us/signin",
    finalUrl: "https://zoom.us/signin",
    httpStatus: 200,
  },
  limits: {
    navigations: 1,
    scriptsExecuted: true,
    loadEvent: true,
    settleMs: 6000,
    dialogsDismissed: 0,
    input: "none",
    truncated: false,
  },
  network: {
    contacted: [
      "edge.microsoft.com:443",
      "nav-edge.smartscreen.microsoft.com:443",
      "www.google.com:443",
      "www.google.pt:443",
      "zoom.us:443",
    ],
    refused: 1,
  },
  observations: ["captcha", "cross-origin-frame", "password-field"],
  frames: [
    {
      index: 0,
      parent: null,
      name: null,
      url: "https://zoom.us/signin",
      sameOriginAsTop: true,
      controls: 5,
      tree: {
        tag: "html",
        attributes: { lang: "en" },
        children: [
          {
            tag: "body",
            attributes: {},
            children: [
              {
                tag: "form",
                attributes: { id: "login-form", action: "/signin" },
                rendered: true,
                children: [
                  {
                    tag: "input",
                    attributes: { id: "email", name: "email", value: null },
                    rendered: true,
                  },
                  {
                    tag: "input",
                    attributes: { id: "password", type: "password" },
                    rendered: true,
                  },
                ],
              },
              {
                tag: "iframe",
                attributes: {
                  id: "launcher-frame",
                  name: "launcher",
                  title: null,
                },
                rendered: true,
              },
              {
                tag: "iframe",
                attributes: {
                  title: null,
                  name: "a-nntc24bde7qd",
                  src: "https://www.google.com/recaptcha/enterprise/anchor",
                },
                rendered: true,
              },
            ],
          },
        ],
      },
    },
    {
      index: 1,
      parent: 0,
      name: "launcher",
      url: "about:blank",
      sameOriginAsTop: false,
      controls: 0,
      tree: { tag: "html", attributes: {} },
    },
    {
      index: 2,
      parent: 0,
      name: "a-nntc24bde7qd",
      url: "https://www.google.com/recaptcha/enterprise/anchor",
      sameOriginAsTop: false,
      controls: 2,
      tree: { tag: "html", attributes: {} },
    },
    {
      index: 3,
      parent: 2,
      name: null,
      url: "about:blank",
      sameOriginAsTop: false,
      controls: 0,
      tree: { tag: "html", attributes: {} },
    },
    {
      // Same origin as the top document, but a name made up per session.
      index: 4,
      parent: 0,
      name: "w-7k2m9x4q1z8p",
      url: "about:blank",
      sameOriginAsTop: false,
      controls: 0,
      tree: {
        tag: "html",
        attributes: {},
        children: [
          {
            tag: "body",
            attributes: {},
            children: [
              {
                tag: "iframe",
                attributes: { name: "w-7k2m9x4q1z8p", id: "inner" },
              },
            ],
          },
        ],
      },
    },
  ],
});

test("re-sanitizing brings an earlier capture under the current rules, offline", () => {
  const before = legacyCapture();
  const after = resanitizeCapture(before);
  assert.deepEqual(before, legacyCapture(), "the input is not modified");
  assert.equal(after.sanitizer, CAPTURE_SANITIZER);

  // The per-session name is gone from the frame record and from the element.
  assert.ok(!JSON.stringify(after).includes("a-nntc24bde7qd"));
  assert.equal(after.frames[2].name, null);
  assert.equal(after.frames[2].nameWithheld, true);
  const [, launcherElement, challengeElement] =
    after.frames[0].tree.children[0].children;
  // Its source says where the other party's frame is from, as the frame
  // record does, and no more: the path belongs to that party's page.
  assert.deepEqual(challengeElement.attributes, {
    title: null,
    name: null,
    src: "https://www.google.com",
  });
  // An authored name of a same-origin frame stays, in both places.
  assert.equal(launcherElement.attributes.name, "launcher");
  assert.equal(after.frames[1].name, "launcher");
  assert.equal(after.frames[1].nameWithheld, undefined);

  // A frame without a URL of its own has its parent's origin.
  assert.deepEqual(
    after.frames.map((frame) => frame.sameOriginAsTop),
    [true, true, false, false, true],
  );
  // Sharing the top origin is not enough: the name itself must be plain.
  assert.ok(!JSON.stringify(after).includes("w-7k2m9x4q1z8p"));
  assert.equal(after.frames[4].name, null);
  assert.equal(after.frames[4].nameWithheld, true);
  assert.deepEqual(after.frames[4].tree.children[0].children[0].attributes, {
    name: null,
    id: "inner",
  });
  // The challenge frame and the frame inside it belong to another party:
  // their skeleton is dropped, only origin and position stay. That they held
  // form controls remains as the observation.
  assert.deepEqual(after.frames[2], {
    index: 2,
    parent: 0,
    name: null,
    nameWithheld: true,
    url: "https://www.google.com",
    sameOriginAsTop: false,
  });
  assert.deepEqual(after.frames[3], {
    index: 3,
    parent: 2,
    name: null,
    url: "about:blank",
    sameOriginAsTop: false,
  });
  assert.equal(after.frames[1].controls, 0);
  assert.ok(after.frames[1].tree && after.frames[4].tree);
  assert.deepEqual(after.observations, [
    "captcha",
    "cross-origin-frame",
    "password-field",
  ]);
  assert.equal(after.limits.redirects, "public-hosts-only");
  assert.deepEqual(after.network, {
    contacted: [
      "www.google.[country]:443",
      "www.google.com:443",
      "zoom.us:443",
    ],
    refused: 1,
  });

  // Everything else is as it was.
  assert.deepEqual(
    after.frames[0].tree.children[0].children[0],
    before.frames[0].tree.children[0].children[0],
  );
  assert.deepEqual(after.source, before.source);
  assert.deepEqual(after.limits, {
    ...before.limits,
    redirects: "public-hosts-only",
  });
  assert.equal(after.applicationId, "zoom");

  // A fixed point: a second pass changes nothing.
  assert.deepEqual(resanitizeCapture(after), after);
  assert.notEqual(canonicalSha256(after), canonicalSha256(before));
  assert.throws(
    () => resanitizeCapture({ schema: "something-else", frames: [] }),
    refusal("usage"),
  );
});

test("--resanitize rewrites captures in place without any network and reports the new hash", async (t) => {
  const temp = await scratch(t);
  const tripwire = await tripwireServer(t);
  const corpus = path.join(temp, "logins");
  const file = path.join(corpus, "zoom", "capture.json");
  await mkdir(path.join(corpus, "zoom"), { recursive: true });
  await mkdir(path.join(corpus, "other"), { recursive: true });
  const before = legacyCapture();
  // A host that would be a tripwire hit if anything were loaded.
  before.frames[0].tree.children[0].children[0].attributes.action = `${tripwire.origin}/signin`;
  const oldHash = canonicalSha256(before);
  await writeFile(file, `${JSON.stringify(before, null, 2)}\n`);
  const evidence = (capture) =>
    `${JSON.stringify({ sources: [{ capture, captureSha256: oldHash }] }, null, 2)}\n`;
  const own = path.join(corpus, "zoom", "evidence.json");
  const sibling = path.join(corpus, "other", "evidence.json");
  await writeFile(own, evidence("capture.json"));
  await writeFile(sibling, evidence("../zoom/capture.json"));
  const profileTemp = path.join(temp, "browser-temp");
  await mkdir(profileTemp);
  const env = { TEMP: profileTemp, TMP: profileTemp, TMPDIR: profileTemp };

  // Without --update-evidence the evidence files are named, not edited.
  const listed = await runTool(["--resanitize", file], env);
  assert.equal(listed.code, 0, listed.stderr);
  const after = JSON.parse(await readFile(file, "utf8"));
  const newHash = canonicalSha256(after);
  assert.notEqual(newHash, oldHash);
  assert.deepEqual(after, resanitizeCapture(before));
  assert.ok(listed.stdout.includes(oldHash) && listed.stdout.includes(newHash));
  assert.match(listed.stdout, /zoom[\\/]evidence\.json/u);
  assert.match(listed.stdout, /other[\\/]evidence\.json/u);
  assert.equal(await readFile(own, "utf8"), evidence("capture.json"));

  // Put the earlier capture back and do the whole corpus in one pass.
  await writeFile(file, `${JSON.stringify(before, null, 2)}\n`);
  const whole = await runTool(
    ["--resanitize", corpus, "--update-evidence"],
    env,
  );
  assert.equal(whole.code, 0, whole.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), after);
  for (const cited of [own, sibling]) {
    const text = await readFile(cited, "utf8");
    assert.ok(text.includes(newHash) && !text.includes(oldHash), cited);
  }

  // A second pass finds nothing to do.
  const again = await runTool(
    ["--resanitize", corpus, "--update-evidence"],
    env,
  );
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /unchanged/u);
  assert.ok(again.stdout.includes(newHash));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), after);

  // It is an offline mode: it cannot be combined with anything that loads.
  for (const extra of [
    ["--id", "zoom"],
    ["--url", "https://zoom.us/signin"],
    ["--from-file", "saved.html"],
  ]) {
    const refused = await runTool(["--resanitize", file, ...extra], env);
    assert.equal(refused.code, 2, extra.join(" "));
  }
  const missing = await runTool(
    ["--resanitize", path.join(temp, "none.json")],
    env,
  );
  assert.equal(missing.code, 2);

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(tripwire.connections, 0, "re-sanitizing loads nothing");
  assert.deepEqual(readdirSync(profileTemp), [], "and starts no browser");
});

test("a page the corpus already holds is refused before anything is loaded", async (t) => {
  const temp = await scratch(t);
  const corpus = path.join(temp, "logins");
  await mkdir(path.join(corpus, "network-solutions"), { recursive: true });
  const shared = catalog.get("network-solutions");
  await writeFile(
    path.join(corpus, "network-solutions", "capture.json"),
    JSON.stringify({
      schema: CAPTURE_SCHEMA,
      source: { requestedUrl: shared },
    }),
  );
  let loads = 0;
  const hosted = async () => {
    loads++;
    throw new Error("the page must not be loaded");
  };
  // The same application again, and the second application that shares the URL.
  for (const id of ["network-solutions", "register-com"])
    await assert.rejects(
      runCaptureCommand(["--id", id, "--out", path.join(temp, `${id}.json`)], {
        corpus,
        hosted,
      }),
      (error) =>
        refusal("already-captured")(error) &&
        /network-solutions[\\/]capture\.json/u.test(error.message),
      id,
    );
  // An output file that exists is never overwritten either.
  const out = path.join(temp, "exists.json");
  await writeFile(out, "{}");
  await assert.rejects(
    runCaptureCommand(["--id", "github", "--out", out], { corpus, hosted }),
    refusal("already-exists"),
  );
  assert.equal(loads, 0);
  assert.equal(existsSync(path.join(temp, "register-com.json")), false);
});

test("a refusal before the load may be repeated; a failed load may not", async (t) => {
  const temp = await scratch(t);
  const corpus = path.join(temp, "logins");
  const profilesBefore = readdirSync(tmpdir()).filter((name) =>
    name.startsWith("sorng-login-capture-"),
  );
  // A name that does not resolve: refused at the pre-flight, exit 2.
  const unresolved = await runCaptureCommand(
    ["--id", "github", "--out", path.join(temp, "out.json")],
    { corpus, lookup: async () => [] },
  ).then(
    () => null,
    (error) => error,
  );
  assert.ok(refusal("unresolved-host")(unresolved), String(unresolved));
  assert.equal(exitCodeFor(unresolved), 2);
  assert.match(describeOutcome(unresolved), /did not resolve/u);
  assert.match(
    describeOutcome(unresolved),
    /Nothing was sent to the site\. This run does not count as the one load/u,
  );
  assert.deepEqual(
    readdirSync(tmpdir()).filter((name) =>
      name.startsWith("sorng-login-capture-"),
    ),
    profilesBefore,
    "no browser was started",
  );
  assert.equal(existsSync(path.join(temp, "out.json")), false);

  // The two kinds of failure, by whether the guard reached the site.
  const notSent = new CaptureFailure("Edge did not start", {
    loadAttempted: false,
  });
  assert.equal(exitCodeFor(notSent), 2);
  assert.match(describeOutcome(notSent), /does not count as the one load/u);
  const sent = new CaptureFailure("the page did not load: net::ERR_FAILED", {
    loadAttempted: true,
  });
  assert.equal(exitCodeFor(sent), 1);
  assert.match(
    describeOutcome(sent),
    /This was the one load for this page\. Do not run it again/u,
  );
  // An error nothing classified is treated as an attempted load: the command
  // classifies every error of its own (see the next test).
  assert.equal(exitCodeFor(new Error("unexpected")), 1);
  assert.equal(exitCodeFor(new CaptureRefusal("usage", "Usage")), 2);
});

test("only a hosted run that reached the site is called the one load", async (t) => {
  const temp = await scratch(t);
  const corpus = path.join(temp, "logins");
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  const outcome = (argv, options) =>
    runCaptureCommand(argv, { corpus, ...options }).then(
      () => null,
      (error) => error,
    );
  const THE_LOAD = /This was the one load for this page/u;
  const OFFLINE = /No page was requested/u;
  // A place nothing can be written to: its parent is a file.
  const blocker = path.join(temp, "a-file");
  await writeFile(blocker, "x");
  const unwritable = path.join(blocker, "capture.json");
  const saved = path.join(temp, "saved.html");
  await writeFile(saved, '<!doctype html><body><input id="user"></body>');

  // --from-file: the page was parsed, the capture could not be written.
  const offline = await outcome([
    "--id",
    "eaton-ups",
    "--from-file",
    saved,
    "--out",
    unwritable,
  ]);
  assert.ok(offline instanceof OfflineFailure, String(offline));
  assert.equal(exitCodeFor(offline), 3);
  assert.match(describeOutcome(offline), OFFLINE);
  assert.doesNotMatch(describeOutcome(offline), THE_LOAD);
  assert.doesNotMatch(describeOutcome(offline), /sent to the site/u);

  // --resanitize: an evidence file that cannot be read (it is a directory).
  const broken = path.join(temp, "broken-corpus");
  await mkdir(path.join(broken, "zoom"), { recursive: true });
  await mkdir(path.join(broken, "other", "evidence.json"), { recursive: true });
  const legacy = `${JSON.stringify(legacyCapture())}\n`;
  await writeFile(path.join(broken, "zoom", "capture.json"), legacy);
  const resanitized = await outcome(["--resanitize", broken]);
  assert.ok(resanitized instanceof OfflineFailure, String(resanitized));
  assert.equal(exitCodeFor(resanitized), 3);
  assert.match(describeOutcome(resanitized), OFFLINE);
  assert.doesNotMatch(describeOutcome(resanitized), THE_LOAD);
  // The same through the command line: its own status, its own sentence.
  await writeFile(path.join(broken, "zoom", "capture.json"), legacy);
  const cli = await runTool(["--resanitize", broken]);
  assert.equal(cli.code, 3, cli.stderr);
  assert.match(cli.stderr, OFFLINE);
  assert.doesNotMatch(cli.stderr, THE_LOAD);
  // A refusal in an offline mode stays a refusal: a file that is no capture,
  // and one whose frames this tool cannot have written.
  assert.equal((await runTool(["--resanitize", blocker])).code, 2);
  const noFrames = path.join(temp, "no-frames.json");
  await writeFile(
    noFrames,
    JSON.stringify({ ...legacyCapture(), frames: [null] }),
  );
  assert.ok(
    refusal("usage")(await outcome(["--resanitize", noFrames])),
    "frames that are not objects",
  );

  // Hosted, failing before anything is sent: may be repeated.
  let loads = 0;
  const early = await outcome(["--id", "github"], {
    corpus: 42,
    hosted: async () => {
      loads++;
    },
  });
  assert.ok(early instanceof CaptureFailure, String(early));
  assert.equal(early.loadAttempted, false);
  assert.equal(exitCodeFor(early), 2);
  assert.match(describeOutcome(early), /does not count as the one load/u);
  assert.equal(loads, 0);

  // Hosted, failing inside the load in a way nothing classified: whether the
  // site was reached is not known, so it counts.
  const during = await outcome(
    ["--id", "github", "--out", path.join(temp, "during.json")],
    {
      hosted: async () => {
        throw new TypeError("unforeseen");
      },
    },
  );
  assert.ok(during instanceof CaptureFailure, String(during));
  assert.equal(during.loadAttempted, true);
  assert.equal(exitCodeFor(during), 1);
  assert.match(describeOutcome(during), THE_LOAD);

  // Hosted, the page was read and the capture could not be written: the load
  // is spent, and the message says what was lost.
  const standIn = async (target) => ({
    capture: resanitizeCapture({
      ...legacyCapture(),
      applicationId: target.applicationId,
    }),
    run: { contacted: ["github.com:443"], refused: [] },
  });
  const late = await outcome(["--id", "github", "--out", unwritable], {
    hosted: standIn,
  });
  assert.ok(late instanceof CaptureFailure, String(late));
  assert.equal(late.loadAttempted, true);
  assert.equal(exitCodeFor(late), 1);
  assert.match(describeOutcome(late), THE_LOAD);
  assert.match(late.message, /was read.*not written/su);
  assert.equal(late.written, null);
  assert.match(describeOutcome(late), /work from other material/u);

  // Hosted, the capture was written and something after it failed (here the
  // fixture draft): the load is spent, but nothing is lost, and the message
  // must not send the reader to "other material".
  const kept = path.join(temp, "kept.json");
  const afterWrite = await outcome(
    ["--id", "github", "--out", kept, "--fixture", unwritable],
    { hosted: standIn },
  );
  assert.ok(afterWrite instanceof CaptureFailure, String(afterWrite));
  assert.equal(afterWrite.loadAttempted, true);
  assert.equal(afterWrite.written, kept);
  assert.equal(exitCodeFor(afterWrite), 1);
  assert.equal(existsSync(kept), true, "the capture is on disk");
  assert.match(
    describeOutcome(afterWrite),
    /The capture was written to .*kept\.json/u,
  );
  assert.match(describeOutcome(afterWrite), /Do not run it again/u);
  assert.doesNotMatch(describeOutcome(afterWrite), /other material/u);
});

const dynamicLogin = (tripwire, port) => `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><title>TITLE-TEXT-MARKER</title>
<link rel="preconnect" href="${tripwire}">
<link rel="dns-prefetch" href="${tripwire}">
</head><body class="spa-shell">
<div id="app">VISIBLE-TEXT-MARKER</div>
<img src="${tripwire}/pixel.png" alt="ALT-TEXT-MARKER">
<iframe id="same" name="sameFrame" src="/frame"></iframe>
<iframe id="cross" name="crossFrame" src="http://localhost:${port}/xframe?state=QUERY-MARKER"></iframe>
<iframe id="token-frame" name="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.FRAME-NAME-MARKER" src="/plain/token"></iframe>
<iframe id="session-frame" name="a-m9iunublb80o" src="/plain/session"></iframe>
<iframe id="renamed-frame" src="/renames"></iframe>
<form id="clobber"><input name="children"><input name="attributes"><input name="localName"><input name="shadowRoot" type="password"></form>
<script>
/* SCRIPT-BODY-MARKER */
document.cookie = "js=COOKIE-MARKER";
try { localStorage.setItem("k", "STORAGE-MARKER"); } catch (error) {}
["keydown", "keyup", "input", "change", "click", "mousedown", "pointerdown", "submit", "focusin", "paste"].forEach(function (type) {
  document.addEventListener(type, function (event) { fetch("/event?type=" + type + "&trusted=" + event.isTrusted); }, true);
});
fetch("${tripwire}/api").catch(function () {});
try { new WebSocket("ws://127.0.0.1:${new URL(tripwire).port}/socket"); } catch (error) {}
try { new WebSocket("ws://127.0.0.1:${port}/socket").onopen = function () { fetch("/socket-opened"); }; } catch (error) {}
setTimeout(function () {
  document.getElementById("app").innerHTML =
    '<form id="spa-form" action="/session?state=QUERY-MARKER" method="post">' +
    '<input id="spa-user" name="email" type="email" autocomplete="username" value="PREFILLED-USER-MARKER">' +
    '<input id="spa-pass" name="password" type="password" style="display:none">' +
    '<button id="spa-next" type="button" onclick="HANDLER-MARKER()">BUTTON-TEXT-MARKER</button></form>';
  var host = document.createElement("login-widget");
  host.id = "widget";
  host.attachShadow({ mode: "open" }).innerHTML = '<input id="shadow-code" name="otp" inputmode="numeric">';
  document.body.appendChild(host);
}, 300);
</script></body></html>`;

test(
  "headless Edge renders a script-built page once, types nothing and leaves no profile",
  { skip: edgeExecutable() ? false : "Microsoft Edge is not installed" },
  async (t) => {
    const tripwire = await tripwireServer(t);
    const seen = {
      documents: 0,
      events: 0,
      writes: 0,
      upgrades: 0,
      socketOpened: 0,
      hosts: new Set(),
    };
    const sockets = new Set();
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      seen.hosts.add(String(request.headers.host));
      if (request.method !== "GET") seen.writes++;
      const html = (body) =>
        response
          .writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Set-Cookie": "sid=COOKIE-MARKER; Path=/",
          })
          .end(body);
      if (url.pathname === "/login") {
        seen.documents++;
        html(dynamicLogin(tripwire.origin, server.address().port));
      } else if (url.pathname === "/frame")
        html(
          '<!doctype html><body><form id="frame-form"><input id="usernameInput"><input id="passwordInput" type="password"></form>VISIBLE-TEXT-MARKER</body>',
        );
      else if (url.pathname === "/xframe")
        html(
          '<!doctype html><body><form id="x-form"><input id="x-user" name="account" value="PREFILLED-USER-MARKER"></form></body>',
        );
      else if (url.pathname.startsWith("/plain/"))
        html(
          `<!doctype html><body><input id="${url.pathname.slice(7)}-input"></body>`,
        );
      else if (url.pathname === "/renames")
        // A document can give its own frame any name, of any length.
        html(
          '<!doctype html><body><input id="renamed-input"><script>window.name = "FRAME-NAME-MARKER " + new Array(631).join("x");</script></body>',
        );
      else if (url.pathname === "/event") {
        seen.events++;
        response.writeHead(204).end();
      } else if (url.pathname === "/socket-opened") {
        seen.socketOpened++;
        response.writeHead(204).end();
      } else response.writeHead(404).end();
    });
    server.on("upgrade", (request, socket) => {
      seen.upgrades++;
      const accept = createHash("sha1")
        .update(
          `${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
        )
        .digest("base64");
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "",
          "",
        ].join("\r\n"),
      );
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    const { port } = server.address();
    const profilesBefore = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("sorng-login-capture-"),
    );

    const { capture, run } = await captureLoopbackFixture(
      `http://127.0.0.1:${port}/login`,
      // Margin for a cold browser on a slow runner; the page needs ~0.3 s.
      { extraOrigins: [`http://localhost:${port}`], settleMs: 2500 },
    );
    const text = JSON.stringify(capture);

    assert.equal(capture.schema, CAPTURE_SCHEMA);
    assert.equal(capture.mode, "loopback-fixture");
    assert.equal(capture.limits.input, "none");
    assert.equal(capture.limits.navigations, 1);
    assert.equal(capture.limits.scriptsExecuted, true);
    assert.equal(capture.source.httpStatus, 200);
    assert.equal(capture.source.finalUrl, `http://127.0.0.1:${port}/login`);
    assert.match(capture.engine, /Edg/u);

    // The form exists only after the page's own script ran.
    const user = findById(capture, "spa-user");
    assert.deepEqual(
      user.ancestors.map((node) => node.tag),
      ["html", "body", "div", "form"],
    );
    assert.deepEqual(user.node.attributes, {
      id: "spa-user",
      name: "email",
      type: "email",
      autocomplete: "username",
      value: null,
    });
    assert.equal(user.node.rendered, true);
    assert.equal(findById(capture, "spa-pass").node.rendered, false);
    assert.equal(
      findById(capture, "spa-form").node.attributes.action,
      "/session",
    );
    assert.equal(findById(capture, "spa-next").node.attributes.onclick, null);
    // Open shadow roots are walked and marked.
    const widget = findById(capture, "widget").node;
    assert.equal(widget.shadow?.[0]?.attributes.id, "shadow-code");
    // In a real engine these names shadow the form's own DOM properties.
    assert.deepEqual(
      findById(capture, "clobber").node.children.map(
        (node) => node.attributes.name,
      ),
      ["children", "attributes", "localName", "shadowRoot"],
    );

    // Same-origin and cross-origin frames are captured as their own documents.
    const same = findById(capture, "usernameInput").frame;
    assert.equal(same.name, "sameFrame");
    assert.equal(same.sameOriginAsTop, true);
    assert.equal(same.nameWithheld, undefined);
    assert.equal(capture.frames[0].parent, null);

    // A frame on another origin is another party's page: the capture says
    // that it exists and where it is from, and nothing of what is in it.
    const others = capture.frames.filter((frame) => !frame.sameOriginAsTop);
    assert.deepEqual(others, [
      {
        index: others[0]?.index,
        parent: 0,
        name: null,
        nameWithheld: true,
        url: `http://localhost:${port}`,
        sameOriginAsTop: false,
      },
    ]);
    assert.ok(!text.includes("x-user") && !text.includes("x-form"));
    // The element that embeds it belongs to the page and is kept; its source
    // is reduced to the same origin the frame record gives.
    assert.equal(
      findById(capture, "cross").node.attributes.src,
      `http://localhost:${port}`,
    );
    assert.equal(findById(capture, "cross").node.attributes.name, null);
    assert.equal(findById(capture, "same").node.attributes.src, "/frame");
    // The read ran in the five documents of the page's own origin and in no
    // other: the frame on localhost was listed, never opened.
    assert.deepEqual(
      run.read,
      new Array(5).fill(`http://127.0.0.1:${port}`),
      "documents the tool read",
    );
    // The browser is driven over the pipe alone: no debugging port is asked
    // for, and none was opened.
    assert.ok(run.arguments.includes("--remote-debugging-pipe"));
    assert.deepEqual(
      run.arguments.filter(
        (argument) =>
          /^--remote-(?!debugging-pipe$)/u.test(argument) ||
          /devtools|debugging-port/iu.test(argument),
      ),
      [],
    );
    assert.equal(run.debuggingPort, false);

    // A frame name is page-controlled: only a plain authored identifier of a
    // same-origin frame is written, in the frame record and on its element.
    assert.equal(findById(capture, "same").node.attributes.name, "sameFrame");
    for (const [control, element] of [
      ["token-input", "token-frame"], // token-shaped
      ["session-input", "session-frame"], // generated per session
    ]) {
      const { frame } = findById(capture, control);
      assert.equal(frame.name, null, control);
      assert.equal(frame.nameWithheld, true, control);
      assert.equal(findById(capture, element).node.attributes.name, null);
    }
    // 648 characters set by the frame's own script: no attribute carries it.
    const renamed = findById(capture, "renamed-input").frame;
    assert.equal(renamed.name, null);
    assert.equal(renamed.nameWithheld, true);
    for (const frame of capture.frames)
      assert.ok(
        frame.name === null || sanitizeFrameName(frame.name) === frame.name,
        `frame ${frame.index} name`,
      );
    assert.ok(!text.includes("a-m9iunublb80o") && !text.includes("crossFrame"));

    // What the tool writes is already in its own sanitized form.
    assert.equal(capture.sanitizer, CAPTURE_SANITIZER);
    assert.deepEqual(resanitizeCapture(capture), capture);

    assert.deepEqual(capture.observations, [
      "cross-origin-frame",
      "password-field",
      "shadow-dom",
    ]);

    assertNoMarkers(text, "the capture");
    assert.ok(!/cookie|storage/iu.test(text), "no cookie or storage data");

    // One load, no input of any kind, no write.
    assert.equal(seen.documents, 1, "the page was loaded exactly once");
    assert.equal(seen.events, 0, "no key, pointer, focus or submit event");
    assert.equal(seen.writes, 0, "no request other than GET");
    assert.deepEqual([...seen.hosts].sort(), [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
    ]);

    // Nothing outside the two allowed origins was reachable.
    assert.equal(tripwire.connections, 0, "the tripwire origin was contacted");
    assert.ok(
      run.refused.includes(`127.0.0.1:${tripwire.port}`),
      `the guard recorded the refused origin: ${run.refused.join(", ")}`,
    );
    assert.deepEqual(capture.network.contacted.sort(), [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
    ]);
    // A WebSocket to an allowed origin is carried through the guard's tunnel.
    assert.equal(seen.upgrades, 1, "the allowed WebSocket reached the server");
    assert.equal(seen.socketOpened, 1, "and opened in the page");

    // A fresh temporary profile, gone afterwards.
    assert.equal(path.dirname(run.profileDirectory), path.resolve(tmpdir()));
    assert.match(path.basename(run.profileDirectory), /^sorng-login-capture-/u);
    assert.equal(existsSync(run.profileDirectory), false);
    assert.deepEqual(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith("sorng-login-capture-"),
      ),
      profilesBefore,
    );
  },
);

test("the guard counts a host as contacted only once a connection to it exists", async (t) => {
  // A port nothing listens on: reserved by listening once, then closed.
  const probe = createTcpServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const closed = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const open = createServer((_request, response) =>
    response.writeHead(204).end(),
  );
  await new Promise((resolve) => open.listen(0, "127.0.0.1", resolve));
  const { port } = open.address();
  const guard = await startConnectionGuard(
    connectionPolicy({
      mode: "loopback-fixture",
      allowed: [`127.0.0.1:${closed}`, `127.0.0.1:${port}`],
    }),
  );
  t.after(async () => {
    await guard.close();
    open.closeAllConnections();
    await new Promise((resolve) => open.close(resolve));
  });
  const send = (lines) =>
    new Promise((resolve, reject) => {
      const socket = connect(guard.port, "127.0.0.1");
      let received = "";
      socket.on("data", (chunk) => {
        received += chunk.toString("utf8");
        if (received.includes("\r\n\r\n")) socket.destroy();
      });
      socket.once("error", reject);
      socket.once("close", () => resolve(received));
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
  const plain = (target) =>
    send([
      `GET http://${target}/ HTTP/1.1`,
      `Host: ${target}`,
      "Connection: close",
    ]);

  // Allowed, but nothing answers: neither form of request reached a site.
  assert.match(await plain(`127.0.0.1:${closed}`), /^HTTP\/1\.1 502 /u);
  await send([
    `CONNECT 127.0.0.1:${closed} HTTP/1.1`,
    `Host: 127.0.0.1:${closed}`,
  ]);
  assert.deepEqual([...guard.contacted], []);
  assert.equal(
    loadWasAttempted(`http://127.0.0.1:${closed}/login`, [...guard.contacted]),
    false,
  );

  assert.match(await plain(`127.0.0.1:${port}`), /^HTTP\/1\.1 204 /u);
  assert.deepEqual([...guard.contacted], [`127.0.0.1:${port}`]);
  assert.equal(
    loadWasAttempted(`http://127.0.0.1:${port}/login`, [...guard.contacted]),
    true,
  );
  // The site's own host and port decide, whatever else was reached.
  assert.equal(
    loadWasAttempted("https://zoom.us/signin", ["edge.microsoft.com:443"]),
    false,
  );
  assert.equal(
    loadWasAttempted("https://zoom.us/signin", ["zoom.us:443"]),
    true,
  );
});

test(
  "a load that fails after the site was reached is reported as the one load",
  { skip: edgeExecutable() ? false : "Microsoft Edge is not installed" },
  async (t) => {
    // The server accepts the connection, reads the request and hangs up.
    const sockets = new Set();
    let requests = 0;
    const server = createTcpServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("data", () => {
        requests++;
        socket.destroy();
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    const profilesBefore = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("sorng-login-capture-"),
    );
    const failure = await captureLoopbackFixture(
      `http://127.0.0.1:${server.address().port}/login`,
      { settleMs: 0 },
    ).then(
      () => null,
      (error) => error,
    );
    assert.ok(failure instanceof CaptureFailure, String(failure));
    assert.equal(failure.loadAttempted, true);
    assert.equal(exitCodeFor(failure), 1);
    assert.match(describeOutcome(failure), /Do not run it again/u);
    assert.ok(requests >= 1, "the request reached the server");
    assert.deepEqual(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith("sorng-login-capture-"),
      ),
      profilesBefore,
      "the profile of a failed run is removed as well",
    );
  },
);

test("IPv6 spellings that wrap or stand for another address are never public", () => {
  const addresses = {
    // IPv4-compatible: the IPv4 address in the low bits of ::/96.
    "::7f00:1": "reserved",
    "::a00:1": "reserved",
    "::c0a8:101": "reserved",
    "::808:808": "reserved",
    // IPv4-mapped and IPv4-translated.
    "::ffff:7f00:1": "loopback",
    "::ffff:a00:1": "private",
    "::ffff:a9fe:a9fe": "link-local",
    "::ffff:808:808": "reserved",
    "::ffff:0:7f00:1": "reserved",
    // NAT64, well-known and local-use, and 6to4 wrapping any IPv4 address.
    "64:ff9b::7f00:1": "reserved",
    "64:ff9b::808:808": "reserved",
    "64:ff9b:1::a00:1": "reserved",
    "2002:7f00:1::1": "reserved",
    "2002:c0a8:101::1": "reserved",
    // Teredo and the other protocol assignments of 2001::/23.
    "2001:0:4136:e378:8000:63bf:3fff:fdd2": "reserved",
    "2001:10::1": "reserved",
    "2001:db8::1": "reserved",
    "100::1": "reserved",
    "::": "reserved",
    "::1": "loopback",
    "fc00::1": "private",
    "fd12:3456:789a::1": "private",
    "fec0::1": "private",
    "fe80::1": "link-local",
    "febf::1": "link-local",
    "ff02::1": "reserved",
    // A zone id does not change what the address is.
    "fe80::1%eth0": "link-local",
    "::1%lo0": "loopback",
    "[fe80::1%25eth0]": "link-local",
  };
  for (const [address, kind] of Object.entries(addresses))
    assert.equal(classifyHost(address), kind, address);
  // The same through the URL parser, as the command line and the guard see it.
  for (const spelling of [
    "[::127.0.0.1]",
    "[::ffff:127.0.0.1]",
    "[64:ff9b::127.0.0.1]",
  ])
    assert.notEqual(
      classifyHost(new URL(`https://${spelling}/`).hostname),
      "public",
      spelling,
    );
  for (const address of [
    "2606:4700:4700::1111",
    "2a00:1450:4003:80f::200e",
    "2001:4860:4860::8888",
  ])
    assert.equal(classifyHost(address), "public", address);
});

test("the guard opens the two web ports and no other, whatever a catalog says", async () => {
  // A catalog URL with a port is refused: it would not be the page the
  // operator checked, and the guard never opens another port for it.
  for (const url of [
    "https://login.example.com:8443/",
    "https://login.example.com:444/login",
    "https://login.example.com:80/",
  ])
    assert.throws(
      () =>
        resolveCaptureTarget({ id: "ported" }, fakeCatalog({ ported: url })),
      (error) =>
        refusal("not-catalog-url")(error) && /port/u.test(error.message),
      url,
    );
  // The default port, written out or not, is the plain URL.
  assert.equal(
    resolveCaptureTarget(
      { id: "plain" },
      fakeCatalog({ plain: "https://login.example.com:443/login" }),
    ).url,
    "https://login.example.com:443/login",
  );
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  // No option widens the guard.
  const policy = connectionPolicy({ mode: "hosted", ports: [8443], lookup });
  assert.equal((await policy.decide("login.example.com", 443)).allow, true);
  assert.equal((await policy.decide("login.example.com", 80)).allow, true);
  for (const port of [8443, 8080, 444, 22, 3389, 0])
    assert.equal(
      (await policy.decide("login.example.com", port)).allow,
      false,
      String(port),
    );
});

test("a saved page: what was saved shows in one line, and the save folder's name is not kept", async (t) => {
  const temp = await scratch(t);
  // What "Webpage, Complete" writes: the document as it stood, frames and
  // resources in a folder named after the page title.
  const complete = path.join(temp, "complete.html");
  await writeFile(
    complete,
    "<!doctype html><html><head><title>Sign in</title></head><body>" +
      '<form id="login" action="https://portal.example.org/session">' +
      '<input id="user" name="user"><input id="pass" name="pass" type="password">' +
      '<button type="submit">Sign in</button></form>' +
      '<iframe id="help" src="./Sign in - someone@realmail-marker.com_files/saved_resource.html"></iframe>' +
      '<a id="more" href="Welcome%20back%20SAVED-TITLE-MARKER_files/saved_resource(1).html"></a>' +
      "</body></html>",
  );
  // What "Webpage, HTML only" writes for a script-rendered page: the address
  // downloaded again, which is the shell before any script ran.
  const shell = path.join(temp, "shell.html");
  await writeFile(
    shell,
    '<!doctype html><html><head><title>Sign in</title></head><body><div id="root"></div>' +
      '<script src="/static/app.js"></script></body></html>',
  );

  const good = await runTool([
    "--id",
    "eaton-ups",
    "--from-file",
    complete,
    "--out",
    path.join(temp, "complete.json"),
  ]);
  assert.equal(good.code, 0, good.stderr);
  assert.match(
    good.stdout,
    /^found +3 form controls, including a password field$/mu,
  );
  const capture = JSON.parse(
    await readFile(path.join(temp, "complete.json"), "utf8"),
  );
  const text = JSON.stringify(capture);
  assert.ok(
    !text.includes("realmail-marker") && !text.includes("SAVED-TITLE-MARKER"),
  );
  assert.equal(
    findById(capture, "help").node.attributes.src,
    "./[saved-files]/saved_resource.html",
  );
  assert.equal(
    findById(capture, "more").node.attributes.href,
    "[saved-files]/saved_resource(1).html",
  );

  const empty = await runTool([
    "--id",
    "eaton-ups",
    "--from-file",
    shell,
    "--out",
    path.join(temp, "shell.json"),
  ]);
  assert.equal(empty.code, 0, empty.stderr);
  assert.match(
    empty.stdout,
    /^found +0 form controls and no password field$/mu,
  );
  // The line that tells a non-expert what went wrong and what to do.
  assert.match(
    empty.stdout,
    /empty shell.*"Webpage, Complete"/su,
    empty.stdout,
  );
  // The refusal for the wrong kind of file names the right way to save.
  const archive = await runTool([
    "--id",
    "eaton-ups",
    "--from-file",
    path.join(temp, "page.mhtml"),
  ]);
  assert.equal(archive.code, 2);
  assert.match(archive.stderr, /"Webpage, Complete"/u);
  assert.doesNotMatch(archive.stderr, /HTML only"\)/u);
});

test("a hosted run is preceded by a reminder of what the tool does not check", async (t) => {
  const temp = await scratch(t);
  const said = [];
  t.mock.method(console, "error", (line) => said.push(String(line)));
  t.mock.method(console, "log", () => {});
  let remindedBeforeLoad = false;
  await runCaptureCommand(
    ["--id", "github", "--out", path.join(temp, "out.json")],
    {
      corpus: path.join(temp, "logins"),
      hosted: async (target) => {
        remindedBeforeLoad = said.some((line) =>
          /robots\.txt.*terms/isu.test(line),
        );
        const capture = resanitizeCapture({
          schema: CAPTURE_SCHEMA,
          applicationId: target.applicationId,
          capturedAt: "2026-10-12",
          mode: "hosted",
          engine: "stand-in",
          source: {
            kind: "hosted-login",
            requestedUrl: target.url,
            finalUrl: "https://sso.example.net/login",
            httpStatus: 200,
          },
          limits: { navigations: 1, scriptsExecuted: true, input: "none" },
          network: { contacted: ["github.com:443"], refused: 0 },
          observations: ["no-password-field"],
          frames: [
            {
              index: 0,
              parent: null,
              name: null,
              url: "https://sso.example.net/login",
              controls: 0,
              tree: { tag: "html", attributes: {} },
            },
          ],
        });
        return { capture, run: { contacted: ["github.com:443"], refused: [] } };
      },
    },
  );
  assert.equal(remindedBeforeLoad, true, said.join("\n"));
  // And afterwards, when the page ended on another host than it started on.
  assert.ok(
    said.some(
      (line) => /sso\.example\.net/u.test(line) && /robots/iu.test(line),
    ),
    said.join("\n"),
  );
});

test("stale temporary profiles of a killed run are removed by the next run", async (t) => {
  const stale = path.join(tmpdir(), "sorng-login-capture-stale-selftest");
  const fresh = path.join(tmpdir(), "sorng-login-capture-fresh-selftest");
  t.after(async () => {
    await rm(stale, { recursive: true, force: true });
    await rm(fresh, { recursive: true, force: true });
  });
  await mkdir(path.join(stale, "Default"), { recursive: true });
  await mkdir(fresh, { recursive: true });
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  utimesSync(stale, old, old);
  await removeStaleProfiles();
  assert.equal(existsSync(stale), false, "a profile hours old is removed");
  assert.equal(existsSync(fresh), true, "a run in progress is left alone");
});

test(
  "termination closes the browser and removes the profile; a killed tool takes its browser with it",
  { skip: edgeExecutable() ? false : "Microsoft Edge is not installed" },
  async (t) => {
    const temp = await scratch(t);
    let documents = 0;
    const sockets = new Set();
    const server = createServer((request, response) => {
      if (request.url === "/login") documents++;
      response
        .writeHead(200, { "Content-Type": "text/html" })
        .end('<!doctype html><body><input id="user"></body>');
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}/login`;
    const listed = () =>
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith("sorng-login-capture-"),
      );
    const before = new Set(listed());
    const until = async (predicate, ms) => {
      const end = Date.now() + ms;
      while (!predicate() && Date.now() < end)
        await new Promise((resolve) => setTimeout(resolve, 100));
      return predicate();
    };

    // 1. A termination signal the process can see: every one of them is
    //    watched while a capture runs, and one of them ends it cleanly.
    const watched = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
    const idle = watched.map((signal) => process.listenerCount(signal));
    const running = captureLoopbackFixture(url, { settleMs: 20000 }).then(
      () => null,
      (error) => error,
    );
    assert.ok(await until(() => documents === 1, 20000), "the page loaded");
    assert.deepEqual(
      watched.map((signal) => process.listenerCount(signal)),
      idle.map((count) => count + 1),
    );
    const began = Date.now();
    // Emitted on a signal nothing else in this process listens to.
    process.emit(
      watched.find((signal, index) => index > 0 && idle[index] === 0),
    );
    const interrupted = await running;
    assert.ok(interrupted instanceof CaptureFailure, String(interrupted));
    assert.match(interrupted.message, /interrupted/u);
    assert.equal(interrupted.loadAttempted, true);
    assert.ok(
      Date.now() - began < 15000,
      "it did not wait out the settle time",
    );
    assert.deepEqual(
      watched.map((signal) => process.listenerCount(signal)),
      idle,
      "the handlers are removed afterwards",
    );
    assert.deepEqual(
      listed().filter((name) => !before.has(name)),
      [],
      "the profile is removed",
    );

    // 2. A kill the process cannot see: the browser notices that its
    //    debugging pipe is gone and exits, so the profile can be deleted.
    const script = path.join(temp, "run.mjs");
    await writeFile(
      script,
      `import { captureLoopbackFixture } from ${JSON.stringify(pathToFileURL(path.join(repo, "scripts/capture-login-page.mjs")).href)};\n` +
        `await captureLoopbackFixture(${JSON.stringify(url)}, { settleMs: 20000 });\n`,
    );
    const child = spawn(process.execPath, [script], {
      stdio: "ignore",
      windowsHide: true,
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    assert.ok(await until(() => documents === 2, 20000), "the child loaded");
    const [orphan] = listed().filter((name) => !before.has(name));
    assert.ok(orphan, "the child has a profile");
    child.kill("SIGKILL");
    await exited;
    // While the browser lives its profile is locked; once it is gone the
    // directory can be removed. (Elsewhere than on Windows removal alone
    // proves little, so the lock file's owner is checked as well.)
    const gone = await until(() => {
      try {
        rmSync(path.join(tmpdir(), orphan), { recursive: true, force: true });
        return !existsSync(path.join(tmpdir(), orphan));
      } catch {
        return false;
      }
    }, 15000);
    assert.ok(gone, "the browser exited and released its profile");
  },
);

test(
  "a frame on another origin is never read, whatever it holds",
  { skip: edgeExecutable() ? false : "Microsoft Edge is not installed" },
  async (t) => {
    // The page itself has no password field. The only one is in a frame of
    // another origin: reading that frame would be the only way to see it.
    const sockets = new Set();
    const documents = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      documents.push(`${request.headers.host}${url.pathname}`);
      const html = (body) =>
        response
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(`<!doctype html><body>${body}</body>`);
      if (url.pathname === "/login")
        html(
          '<form id="top-form"><input id="top-user" name="user"></form>' +
            '<iframe id="own" src="/own"></iframe>' +
            `<iframe id="other" src="http://localhost:${server.address().port}/other"></iframe>`,
        );
      else if (url.pathname === "/own") html('<input id="own-field">');
      else if (url.pathname === "/other")
        html(
          '<form id="other-form"><input id="other-pass" type="password"></form>' +
            '<iframe id="other-inner" src="/other-inner"></iframe>',
        );
      else if (url.pathname === "/other-inner")
        html('<input id="inner-pass" type="password">');
      else response.writeHead(404).end();
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    const { port } = server.address();
    const own = `http://127.0.0.1:${port}`;

    const { capture, run } = await captureLoopbackFixture(`${own}/login`, {
      extraOrigins: [`http://localhost:${port}`],
      settleMs: 1500,
    });
    const text = JSON.stringify(capture);

    // The other party's frames did load: there was something to read.
    assert.ok(documents.includes(`localhost:${port}/other`), documents.join());
    assert.ok(documents.includes(`localhost:${port}/other-inner`));
    // The read ran in the page and in its own frame, and nowhere else.
    assert.deepEqual(run.read, [own, own]);
    assert.deepEqual(capture.observations, [
      "cross-origin-frame",
      "no-password-field",
    ]);
    for (const id of ["other-form", "other-pass", "inner-pass", "other-inner"])
      assert.ok(!text.includes(id), id);
    assert.equal(findById(capture, "top-user").frame.index, 0);
    assert.equal(findById(capture, "own-field").frame.sameOriginAsTop, true);
    // Listed, with their origin, and nothing else: the frame and the frame
    // inside it. (The browser may give an unnamed frame a name of its own;
    // whatever it is, it is withheld.)
    const others = capture.frames.filter((frame) => !frame.sameOriginAsTop);
    assert.equal(others.length, 2);
    for (const frame of others) {
      assert.deepEqual(
        Object.keys(frame).filter((key) => key !== "nameWithheld"),
        ["index", "parent", "name", "url", "sameOriginAsTop"],
      );
      assert.equal(frame.name, null);
      assert.equal(frame.url, `http://localhost:${port}`);
    }
    assert.equal(
      findById(capture, "other").node.attributes.src,
      `http://localhost:${port}`,
    );
    assert.deepEqual(resanitizeCapture(capture), capture);
  },
);

test("re-sanitizing keeps only what the tool writes about a capture, in the shape it writes it", () => {
  const MARK = "FREE-TEXT-MARKER";
  const edited = legacyCapture();
  edited.reviewer = `${MARK} at the top`;
  edited.engine = `Someone's own browser, ${MARK}`;
  edited.capturedAt = `yesterday, ${MARK}`;
  edited.source.note = `${MARK} in source`;
  edited.source.kind = MARK;
  edited.source.httpStatus = `200 ${MARK}`;
  edited.limits.comment = `${MARK} in limits`;
  edited.limits.settleMs = MARK;
  edited.limits.navigations = 7;
  edited.limits.scriptsExecuted = MARK;
  edited.limits.loadEvent = MARK;
  edited.limits.truncated = MARK;
  edited.limits.dialogsDismissed = -3;
  edited.limits.input = MARK;
  edited.network.note = MARK;
  edited.frames[0].comment = MARK;
  edited.frames[0].controls = MARK;
  const after = resanitizeCapture(edited);
  assert.ok(!JSON.stringify(after).includes(MARK), JSON.stringify(after));
  assert.deepEqual(Object.keys(after), [
    "schema",
    "sanitizer",
    "applicationId",
    "capturedAt",
    "mode",
    "engine",
    "source",
    "limits",
    "network",
    "observations",
    "frames",
  ]);
  assert.equal(after.engine, null);
  assert.equal(after.capturedAt, null);
  assert.deepEqual(after.source, {
    kind: "hosted-login",
    requestedUrl: "https://zoom.us/signin",
    finalUrl: "https://zoom.us/signin",
    httpStatus: null,
  });
  // What a mode fixes is written from the mode; the rest is dropped when it
  // is not of its kind.
  assert.deepEqual(after.limits, {
    navigations: 1,
    scriptsExecuted: true,
    input: "none",
    truncated: false,
    redirects: "public-hosts-only",
  });
  assert.equal(after.frames[0].controls, 0);
  assert.deepEqual(resanitizeCapture(after), after);

  // A capture the tool wrote keeps every value, in the order it wrote them.
  const kept = resanitizeCapture(legacyCapture());
  assert.equal(kept.engine, "Microsoft Edge headless (Edg/146.0.3856.84)");
  assert.equal(kept.capturedAt, "2026-10-12");
  assert.deepEqual(Object.entries(kept.limits), [
    ["navigations", 1],
    ["scriptsExecuted", true],
    ["loadEvent", true],
    ["settleMs", 6000],
    ["dialogsDismissed", 0],
    ["input", "none"],
    ["truncated", false],
    ["redirects", "public-hosts-only"],
  ]);
  assert.deepEqual(Object.keys(kept.source), [
    "kind",
    "requestedUrl",
    "finalUrl",
    "httpStatus",
  ]);

  // The requested address is the catalog's: a plain https address of a
  // public host, spelt canonically, or it is not written.
  const requested = (value) => {
    const capture = legacyCapture();
    capture.source.requestedUrl = value;
    return resanitizeCapture(capture).source.requestedUrl;
  };
  assert.equal(requested("https://zoom.us/signin"), "https://zoom.us/signin");
  for (const value of [
    `https://zoom.us/signin?note=${MARK}`,
    `https://zoom.us/signin#${MARK}`,
    "https://someone:secret@zoom.us/signin",
    "http://zoom.us/signin",
    "https://zoom.us:8443/signin",
    "https://ZOOM.us/signin",
    "zoom.us/signin",
    "https://10.0.0.8/login",
    "https://nas.local/login",
    `captured by ${MARK}`,
    42,
    null,
  ])
    assert.equal(requested(value), null, String(value));
  for (const [key, value] of [
    ["applicationId", `Zoom (${MARK})`],
    ["applicationId", 7],
    ["capturedAt", "2026-13-45"],
    ["capturedAt", "12 October 2026"],
    ["engine", "Microsoft Edge headless (Edg/146.0) and more"],
  ])
    assert.equal(
      resanitizeCapture({ ...legacyCapture(), [key]: value })[key],
      null,
      `${key}=${value}`,
    );
  assert.equal(
    resanitizeCapture({ ...legacyCapture(), httpNote: MARK }).source.httpStatus,
    200,
  );

  // A saved page: its description is fixed by the mode.
  const saved = resanitizeCapture({
    schema: CAPTURE_SCHEMA,
    applicationId: "eaton-ups",
    capturedAt: "2026-10-12",
    mode: "file",
    engine: MARK,
    source: { kind: "saved-page", savedFrom: MARK, requestedUrl: MARK },
    limits: { navigations: 3, scriptsExecuted: true, settleMs: 5, note: MARK },
    network: { contacted: ["zoom.us:443"], refused: 0 },
    observations: ["no-password-field", MARK],
    frames: [{ index: 0, parent: null, controls: 0, tree: { tag: "html" } }],
  });
  assert.ok(!JSON.stringify(saved).includes(MARK));
  assert.equal(saved.engine, "static parse of a saved page");
  assert.deepEqual(saved.source, { kind: "saved-page" });
  assert.deepEqual(saved.limits, {
    navigations: 0,
    scriptsExecuted: false,
    input: "none",
    truncated: false,
  });
  assert.equal(saved.network, undefined, "a saved page contacted nothing");

  // What a capture says about its trees is read from them, not carried: a
  // password field, a shadow tree and an error status cannot be claimed or
  // denied by hand. Only a challenge is noted while the page is read.
  const claimed = resanitizeCapture({
    ...legacyCapture(),
    observations: ["no-password-field", "shadow-dom", "error-status"],
  });
  assert.deepEqual(claimed.observations, [
    "cross-origin-frame",
    "password-field",
  ]);
  const failed = legacyCapture();
  failed.source.httpStatus = 403;
  failed.frames[0].tree.children[0].children = [
    {
      tag: "login-widget",
      attributes: { id: "widget" },
      shadow: [{ tag: "input", attributes: { id: "code" } }],
    },
  ];
  assert.deepEqual(resanitizeCapture(failed).observations, [
    "captcha",
    "cross-origin-frame",
    "error-status",
    "no-password-field",
    "shadow-dom",
  ]);

  // What is not one of the tool's captures is refused, not repaired.
  for (const change of [
    { mode: "something-else" },
    { mode: undefined },
    { frames: [null] },
    { frames: ["frame"] },
    { frames: [] },
  ])
    assert.throws(
      () => resanitizeCapture({ ...legacyCapture(), ...change }),
      refusal("usage"),
      JSON.stringify(change),
    );
});

test("a list of ids is kept only when each one names an element of the same captured document", async (t) => {
  const temp = await scratch(t);
  const file = path.join(temp, "saved.html");
  await writeFile(
    file,
    "<!doctype html><html><body>" +
      '<span id="user-hint">not a control, so not captured</span>' +
      '<label id="user-label" for="user"></label>' +
      '<input id="user" aria-labelledby="user-label" aria-describedby="user-hint pass" aria-controls="signed in as">' +
      '<input id="pass" type="password" aria-describedby="pass user" aria-errormessage="">' +
      '<login-box id="box" name="box"></login-box>' +
      "</body></html>",
  );
  const capture = await captureFromFile(file, { applicationId: "eaton-ups" });
  const attributes = (id) => findById(capture, id).node.attributes;
  // Every id it names is in the capture: kept, in both directions.
  assert.equal(attributes("user")["aria-labelledby"], "user-label");
  assert.equal(attributes("pass")["aria-describedby"], "pass user");
  assert.equal(attributes("pass")["aria-errormessage"], "");
  // One of them is not: the value is withheld, its presence stays.
  assert.equal(attributes("user")["aria-describedby"], null);
  assert.ok("aria-describedby" in attributes("user"));
  // Three plain words are not three ids.
  assert.equal(attributes("user")["aria-controls"], null);
  assert.deepEqual(resanitizeCapture(capture), capture);

  // The same rule for a capture that exists already, per document: an id of
  // another frame does not count.
  const earlier = legacyCapture();
  const [email, password] =
    earlier.frames[0].tree.children[0].children[0].children;
  email.attributes["aria-describedby"] = "password login-form";
  email.attributes["aria-labelledby"] = "inner";
  password.attributes["aria-controls"] = "welcome back";
  const after = resanitizeCapture(earlier);
  const [emailAfter, passwordAfter] =
    after.frames[0].tree.children[0].children[0].children;
  assert.equal(
    emailAfter.attributes["aria-describedby"],
    "password login-form",
  );
  assert.equal(emailAfter.attributes["aria-labelledby"], null);
  assert.equal(passwordAfter.attributes["aria-controls"], null);
  assert.deepEqual(resanitizeCapture(after), after);
});

test("the source of a frame element says no more than the frame record: the origin, when it is another party's", () => {
  const capture = legacyCapture();
  const body = capture.frames[0].tree.children[0];
  const frame = (attributes, tag = "iframe") =>
    body.children.push({ tag, attributes }) - 1;
  const relative = frame({ id: "relative", src: "/help/frame" });
  const own = frame({ id: "own", src: "https://zoom.us/embedded/chat" });
  const other = frame({
    id: "other",
    src: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile",
  });
  const schemeless = frame({ id: "schemeless", src: "//idp.example.com/a/b" });
  const privateHost = frame({ id: "private", src: "https://10.0.0.8/admin" });
  const old = frame({ id: "old", src: "http://zoom.us/legacy" }, "frame");
  // Only a frame's own source is reduced: a link or a form to another origin
  // is where the page sends the user, and its path is what a step gates on.
  body.children.push({
    tag: "form",
    attributes: { id: "sso", action: "https://sso.example.net/login/start" },
  });
  const after = resanitizeCapture(capture);
  const written = after.frames[0].tree.children[0].children;
  assert.equal(written[relative].attributes.src, "/help/frame");
  assert.equal(written[own].attributes.src, "https://zoom.us/embedded/chat");
  assert.equal(
    written[other].attributes.src,
    "https://challenges.cloudflare.com",
  );
  assert.equal(written[schemeless].attributes.src, "//idp.example.com");
  assert.equal(written[privateHost].attributes.src, "https://origin-1.invalid");
  // Another scheme is another origin.
  assert.equal(written[old].attributes.src, "http://zoom.us");
  assert.equal(
    written.at(-1).attributes.action,
    "https://sso.example.net/login/start",
  );
  assert.deepEqual(resanitizeCapture(after), after);
});

test("host aliases are numbered the same way whatever order a capture was written in", () => {
  // Two private hosts, met in the tree and as the address of a frame of
  // another origin. A capture could number them tree first or address first.
  const build = (first, second, third) => {
    const capture = legacyCapture();
    capture.frames = capture.frames.slice(0, 1);
    capture.frames[0].tree.children[0].children.push(
      { tag: "a", attributes: { id: "one", href: `https://${first}/a` } },
      { tag: "a", attributes: { id: "two", href: `https://${second}/b` } },
    );
    capture.frames.push({
      index: 1,
      parent: 0,
      name: null,
      url: `https://${third}/frame`,
      sameOriginAsTop: false,
    });
    return capture;
  };
  const links = (capture) => [
    ...capture.frames[0].tree.children[0].children
      .slice(-2)
      .map((node) => node.attributes.href),
    capture.frames[1].url,
  ];
  // From raw hosts: numbered in the order they are met, a host met twice
  // keeping its number.
  const fresh = resanitizeCapture(build("10.0.0.8", "nas.local", "10.0.0.8"));
  assert.deepEqual(links(fresh), [
    "https://origin-1.invalid/a",
    "https://origin-2.invalid/b",
    "https://origin-1.invalid",
  ]);
  // From aliases numbered in any other order: brought to the same numbering,
  // and stable from then on.
  for (const [first, second, third] of [
    ["origin-2.invalid", "origin-1.invalid", "origin-2.invalid"],
    ["origin-7.invalid", "origin-3.invalid", "origin-7.invalid"],
    ["origin-1.invalid", "origin-2.invalid", "origin-1.invalid"],
  ]) {
    const once = resanitizeCapture(build(first, second, third));
    assert.deepEqual(links(once), links(fresh), `${first} ${second}`);
    assert.deepEqual(resanitizeCapture(once), once);
  }
  // A third host that only the frame record names comes last.
  const mixed = resanitizeCapture(
    build("nas.local", "10.0.0.8", "192.168.1.9"),
  );
  assert.deepEqual(links(mixed), [
    "https://origin-1.invalid/a",
    "https://origin-2.invalid/b",
    "https://origin-3.invalid",
  ]);
  assert.deepEqual(resanitizeCapture(mixed), mixed);
  // Within one document its address is numbered before its tree. The tool
  // writes no capture where that could matter (a document it reads has the
  // origin of the final address, which is numbered first of all), so this
  // one is made by hand: a top document on a private host, no final address.
  const top = build("nas.local", "10.0.0.8", "nas.local");
  top.source.finalUrl = null;
  top.frames[0].url = "https://192.168.1.9/login";
  const numbered = resanitizeCapture(top);
  assert.equal(numbered.frames[0].url, "https://origin-1.invalid/login");
  assert.deepEqual(links(numbered), [
    "https://origin-2.invalid/a",
    "https://origin-3.invalid/b",
    "https://origin-2.invalid",
  ]);
  assert.deepEqual(resanitizeCapture(numbered), numbered);
});

test("what the tool writes from a saved page is already what re-sanitizing gives", async (t) => {
  const temp = await scratch(t);
  const file = path.join(temp, "saved.html");
  // Hosts in several attributes and several orders, a frame, and a frame
  // source on another host.
  await writeFile(
    file,
    "<!doctype html><html><body>" +
      '<a id="b" href="https://b.example.org/x"></a>' +
      '<form id="f" action="https://a.example.org/login">' +
      '<input id="u" formaction="https://c.example.org/alt">' +
      '<button id="s" formaction="https://b.example.org/y"></button></form>' +
      '<iframe id="i" name="appFrame" src="https://a.example.org/frame/deep"></iframe>' +
      '<a id="a" href="//c.example.org/z"></a>' +
      "</body></html>",
  );
  const capture = await captureFromFile(file, { applicationId: "eaton-ups" });
  assert.deepEqual(resanitizeCapture(capture), capture);
  const value = (id, name) => findById(capture, id).node.attributes[name];
  assert.equal(value("b", "href"), "https://origin-1.invalid/x");
  assert.equal(value("f", "action"), "https://origin-2.invalid/login");
  assert.equal(value("u", "formaction"), "https://origin-3.invalid/alt");
  assert.equal(value("s", "formaction"), "https://origin-1.invalid/y");
  // A saved page does not say what its own origin was, so a frame's source
  // cannot be shown to be another party's: the path stays, under the alias.
  assert.equal(value("i", "src"), "https://origin-2.invalid/frame/deep");
  assert.equal(value("i", "name"), "appFrame");
  assert.equal(value("a", "href"), "//origin-3.invalid/z");
});

test("a debugging port leaves a mark in the profile, and the tool looks for it", async (t) => {
  const profile = await scratch(t);
  assert.equal(openedDebuggingPort(profile), false);
  await writeFile(path.join(profile, "DevToolsActivePort"), "9222\n/devtools");
  assert.equal(openedDebuggingPort(profile), true);
});

test(
  "a browser that opens a debugging port beside the pipe voids the run",
  { skip: edgeExecutable() ? false : "Microsoft Edge is not installed" },
  async (t) => {
    // The tool itself never asks for a port, so this runs a copy that does:
    // the tool's source with one argument added, in a temporary directory.
    const temp = await scratch(t);
    const source = readFileSync(script, "utf8");
    const pipe = '"--remote-debugging-pipe",';
    assert.equal(source.split(pipe).length, 2, "the pipe argument, once");
    const copy = path.join(temp, "capture-login-page.mjs");
    await writeFile(
      copy,
      source.replace(pipe, `${pipe} "--remote-debugging-port=0",`),
    );
    const altered = await import(pathToFileURL(copy).href);

    const sockets = new Set();
    let documents = 0;
    const server = createServer((_request, response) => {
      documents++;
      response
        .writeHead(200, { "Content-Type": "text/html" })
        .end('<!doctype html><body><input id="user"></body>');
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    const profilesBefore = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("sorng-login-capture-"),
    );

    const outcome = await altered
      .captureLoopbackFixture(
        `http://127.0.0.1:${server.address().port}/login`,
        { settleMs: 500 },
      )
      .then(
        () => null,
        (error) => error,
      );
    // No capture comes back, although the page was read without trouble.
    assert.equal(outcome?.name, "CaptureFailure", String(outcome));
    assert.match(outcome.message, /debugging port beside the pipe/u);
    assert.equal(outcome.loadAttempted, true);
    assert.equal(altered.exitCodeFor(outcome), 1);
    assert.ok(documents >= 1, "the page was loaded");
    assert.deepEqual(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith("sorng-login-capture-"),
      ),
      profilesBefore,
      "the profile is removed all the same",
    );
  },
);
test("native CEF metadata reconstruction preserves honest hosted provenance and strips transaction tokens on roundtrip", () => {
  const before = legacyCapture();
  before.engine = tool.NATIVE_CEF_METADATA_ENGINE;
  before.mode = "hosted";
  before.source = {
    kind: "hosted-login",
    requestedUrl: "https://my.meo.pt/",
    finalUrl:
      "https://login.telecom.pt/AuthorizeService/authorize.aspx?state=PRIVATE_TRANSACTION",
    httpStatus: null,
  };
  before.frames[0].url = before.source.finalUrl;
  before.limits = {
    navigations: 3,
    scriptsExecuted: true,
    input: "none",
    truncated: false,
  };
  const after = resanitizeCapture(before);
  assert.equal(
    after.engine,
    "Native CEF anonymous metadata (offline structural reconstruction)",
  );
  assert.equal(after.source.requestedUrl, "https://my.meo.pt/");
  assert.equal(
    after.source.finalUrl,
    "https://login.telecom.pt/AuthorizeService/authorize.aspx",
  );
  assert.equal(after.frames[0].url, after.source.finalUrl);
  assert.equal(after.limits.navigations, 3);
  assert.equal(after.limits.scriptsExecuted, true);
  assert.equal(after.limits.input, "none");
  assert.ok(!JSON.stringify(after).includes("PRIVATE_TRANSACTION"));
  assert.deepEqual(resanitizeCapture(after), after);
  assert.equal(
    resanitizeCapture({ ...before, mode: "file" }).engine,
    "static parse of a saved page",
  );
  assert.equal(
    resanitizeCapture({
      ...before,
      engine: tool.NATIVE_CEF_METADATA_ENGINE + " PRIVATE_TRANSACTION",
    }).engine,
    null,
  );
});
