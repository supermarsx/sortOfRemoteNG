import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the shipped probe assets, not copies of their relay logic. These are
// synthetic message/DOM tests, not WebView2, network, or login acceptance tests.
const assets = new URL(
  "../../src-tauri/crates/sorng-file-viewer-host/tests/live_browser/",
  import.meta.url,
);
const observerSource = readFileSync(new URL("observe.js", assets), "utf8");
const shellSource = readFileSync(new URL("shell.html", assets), "utf8");
const origin = `http://p${"a".repeat(32)}.localhost:43123`;
const alias = `http://p${"b".repeat(32)}.localhost:43123`;
const token = "c".repeat(32);
const documentToken = "d".repeat(32);
const pageUrl = `${origin}/login`;
const config = {
  proxyUrl: pageUrl,
  sessionId: "anonymous-test-session",
  allowedOrigins: [origin, alias],
  navigationToken: token,
};

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatch(type, event = {}) {
      for (const callback of [...(listeners.get(type) ?? [])]) callback(event);
    },
  };
}

function clock() {
  let time = 0;
  let next = 0;
  const timers = new Map();
  return {
    performance: { now: () => time },
    setInterval(callback) {
      timers.set(++next, callback);
      return next;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    tick(milliseconds = 1000) {
      time += milliseconds;
      for (const callback of [...timers.values()]) callback();
    },
    timers,
  };
}

function shell(overrides = {}) {
  const messages = [];
  const window = events();
  window.top = window;
  window.ipc = { postMessage: (message) => messages.push(JSON.parse(message)) };
  const attributes = new Map([["sandbox", ""]]);
  const frame = {
    ...events(),
    contentWindow: {},
    style: {},
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    set src(value) {
      attributes.set("src", value);
    },
    get src() {
      return attributes.get("src");
    },
  };
  const time = clock();
  const scripts = [...shellSource.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  assert.equal(
    scripts.length,
    1,
    "probe shell must have one configuration script",
  );
  const source = scripts[0][1].replace(
    "__CONFIG__",
    JSON.stringify({ ...config, ...overrides }),
  );
  vm.runInNewContext(
    source,
    {
      window,
      document: { getElementById: (id) => (id === "website" ? frame : null) },
      location: new URL("http://localhost:43124/"),
      navigator: { userAgent: "Synthetic Node VM fixture" },
      URL,
      ...time,
    },
    { filename: "live_browser/shell.html", timeout: 1000 },
  );
  return {
    messages,
    window,
    frame,
    ...time,
    receive(data, options = {}) {
      window.dispatch("message", {
        source: frame.contentWindow,
        origin,
        data,
        ...options,
      });
    },
    observations: () =>
      messages.filter((message) => message.kind === "observation"),
    activations: () =>
      messages.filter((message) => message.kind === "activate"),
  };
}

function start(overrides = {}) {
  return {
    type: "proxy_document_start",
    version: 1,
    sessionId: config.sessionId,
    documentToken,
    documentSequence: 1,
    navigationToken: token,
    url: pageUrl,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    type: "native_live_observation",
    url: pageUrl,
    snapshot: { bodyVisible: true, emailFields: 1 },
    ...overrides,
  };
}

class FakeElement {
  constructor(parent = null) {
    this.parentElement = parent;
    this.hidden = false;
    this.style = { display: "block", visibility: "visible", opacity: "1" };
  }
  getClientRects() {
    return [{}];
  }
  getElementsByTagName() {
    return [1, 2, 3];
  }
  hasAttribute() {
    return false;
  }
  closest() {
    return null;
  }
  get value() {
    throw new Error("must not inspect form values");
  }
}

function observer(options = {}) {
  const posts = [];
  const window = Object.assign(options.window ?? {}, events());
  const parent = {
    postMessage(message, targetOrigin) {
      // postMessage structured-clones across realms, unlike a direct callback.
      const copy = structuredClone(message);
      posts.push({ message: copy, targetOrigin });
      options.onPost?.(copy);
    },
  };
  window.parent = parent;
  window.top = options.nested ? {} : parent;
  if (options.top) window.top = window;
  Object.defineProperty(window, "ipc", {
    get() {
      throw new Error("child native IPC must not be accessed");
    },
  });
  const body = new FakeElement();
  const email = new FakeElement(body);
  const password = new FakeElement(body);
  password.hidden = true;
  const document = {
    ...events(),
    body,
    documentElement: new FakeElement(),
    readyState: "complete",
    baseURI: options.url ?? pageUrl,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector.startsWith('input[type="email"]')) return [email];
      if (selector === 'input[type="password"]') return [password];
      return [];
    },
    createTreeWalker() {
      if (options.failRead) throw new Error("synthetic DOM read failure");
      const nodes = [
        { nodeValue: "Sign in", parentElement: body },
        {
          nodeValue: "DO_NOT_REPORT_TOKEN",
          parentElement: { closest: () => ({}) },
        },
      ];
      return { nextNode: () => nodes.shift() ?? null };
    },
  };
  Object.defineProperty(document, "cookie", {
    get() {
      throw new Error("must not inspect cookies");
    },
  });
  const time = clock();
  const context = {
    window,
    document,
    location: new URL(options.url ?? pageUrl),
    URL,
    Element: FakeElement,
    HTMLElement: FakeElement,
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (element) => element.style,
    ...time,
  };
  for (const name of [
    "localStorage",
    "sessionStorage",
    "fetch",
    "XMLHttpRequest",
  ]) {
    Object.defineProperty(context, name, {
      get() {
        throw new Error(`observer must not access ${name}`);
      },
    });
  }
  vm.runInNewContext(observerSource, context, {
    filename: "live_browser/observe.js",
    timeout: 1000,
  });
  return { posts, window, document, body, email, password, ...time };
}

test("primary observer reports through parent without child IPC, storage, network, or form-value reads", () => {
  const probe = observer();
  assert.equal(probe.posts.length, 1);
  const message = probe.posts[0].message;
  assert.equal(message.type, "native_live_observation");
  assert.equal(message.url, pageUrl);
  assert.equal(message.snapshot.emailFields, 1);
  assert.equal(message.snapshot.passwordFields, 0);
  assert.equal(message.snapshot.bodyVisible, true);
  assert.equal(message.snapshot.bodyTextLength, "Sign in".length);
  assert.doesNotMatch(JSON.stringify(message), /DO_NOT_REPORT_TOKEN|Sign in/u);
});

for (const [name, options] of [
  ["top-level page", { top: true }],
  ["nested challenge iframe", { nested: true }],
  ["remote host", { url: "https://accounts.google.com/login" }],
  ["ordinary localhost", { url: "http://localhost:43123/login" }],
]) {
  test(`observer ignores ${name}`, () => {
    const probe = observer(options);
    assert.equal(probe.posts.length, 0);
    assert.equal(probe.timers.size, 0);
  });
}

test("observer removes private navigation markers without changing other query serialization", () => {
  const clean = `${pageUrl}?continue=a%20b%2fc&signed=~%2F#step`;
  const url = clean.replace(
    "#step",
    `&__sorng_navigation_v1=${token}&__sorng_generation_v1=private&__sorng_google_hop_v1=2#step`,
  );
  const probe = observer({ url });
  assert.equal(probe.posts[0].message.url, clean);
});

test("observer counts categorized failures without copying error, CSP, or rejection payloads", () => {
  const probe = observer();
  probe.window.dispatch("error", {
    target: probe.window,
    message: "Invalid network route configuration DO_NOT_REPORT_ERROR",
  });
  probe.window.dispatch("error", {
    target: new FakeElement(),
    message: "DO_NOT_REPORT_RESOURCE",
  });
  probe.window.dispatch("unhandledrejection", {
    reason: {
      toString() {
        throw new Error("must not stringify arbitrary rejection");
      },
    },
  });
  probe.document.dispatch("securitypolicyviolation", {
    blockedURI: "DO_NOT_REPORT_CSP",
  });
  probe.tick();
  const snapshot = probe.posts.at(-1).message.snapshot;
  assert.equal(snapshot.scriptErrors, 2);
  assert.equal(snapshot.bootstrapErrors, 1);
  assert.equal(snapshot.resourceErrors, 1);
  assert.equal(snapshot.cspViolations, 1);
  assert.doesNotMatch(JSON.stringify(probe.posts), /DO_NOT_REPORT/u);
});

test("failed observer reads do not manufacture successful snapshots", () => {
  const probe = observer({ failRead: true });
  assert.equal(probe.posts.length, 0);
  assert.equal(probe.timers.size, 0);
});

test("observer stops reporting on pagehide and at its bounded deadline", () => {
  const hidden = observer();
  hidden.window.dispatch("pagehide");
  hidden.tick();
  assert.equal(hidden.posts.length, 1);
  assert.equal(hidden.timers.size, 0);
  const expired = observer();
  expired.tick(60_000);
  assert.equal(expired.posts.length, 1);
  assert.equal(expired.timers.size, 0);
});

test("shell configures the production iframe sandbox and exactly one private navigation marker", () => {
  const probe = shell();
  assert.equal(
    probe.frame.getAttribute("sandbox"),
    "allow-same-origin allow-scripts allow-forms",
  );
  const url = new URL(probe.frame.src);
  assert.deepEqual(url.searchParams.getAll("__sorng_navigation_v1"), [token]);
  assert.equal(probe.activations().length, 0);
});

test("shell does not relay observations until a validated document is selected", () => {
  const probe = shell();
  probe.receive(receipt());
  assert.equal(probe.observations().length, 0);
  probe.receive(start());
  probe.receive(receipt({ sequence: 999 }));
  assert.deepEqual(probe.activations(), [{ kind: "activate", sequence: 1 }]);
  assert.deepEqual(probe.observations(), [
    {
      kind: "observation",
      sequence: 1,
      snapshot: receipt().snapshot,
    },
  ]);
  assert.equal(Object.hasOwn(probe.observations()[0], "url"), false);
});

for (const [name, options, change] of [
  ["different frame", { source: {} }, {}],
  ["unreviewed origin", { origin: "https://untrusted.example" }, {}],
  ["opaque origin", { origin: "null" }, {}],
  ["other document path", {}, { url: `${origin}/other` }],
  ["old document query", {}, { url: `${pageUrl}?old=1` }],
  ["unselected hosted alias", {}, { url: `${alias}/login` }],
  ["missing snapshot", {}, { snapshot: null }],
  ["non-object snapshot", {}, { snapshot: "not-an-observation" }],
]) {
  test(`shell rejects observation from ${name}`, () => {
    const probe = shell();
    probe.receive(start());
    probe.receive(receipt(change), options);
    assert.equal(probe.observations().length, 0);
  });
}

for (const [name, change] of [
  ["wrong session", { sessionId: "different-session" }],
  ["wrong navigation token", { navigationToken: "e".repeat(32) }],
  ["missing first navigation token", { navigationToken: null }],
  ["zero sequence", { documentSequence: 0 }],
  ["unsafe sequence", { documentSequence: Number.MAX_SAFE_INTEGER + 1 }],
  ["malformed document token", { documentToken: "short" }],
  ["wrong URL origin", { url: `${alias}/login` }],
]) {
  test(`shell rejects document selection with ${name}`, () => {
    const probe = shell();
    probe.receive(start(change));
    probe.receive(receipt());
    assert.equal(probe.activations().length, 0);
    assert.equal(probe.observations().length, 0);
  });
}

test("navigation retires old observations and binds the successor alias to its own sequence", () => {
  const probe = shell();
  probe.receive(start());
  probe.receive(start({ type: "proxy_navigation_start" }));
  probe.receive(receipt());
  assert.equal(probe.observations().length, 0);
  probe.receive(
    start({
      url: `${alias}/identifier`,
      documentSequence: 2,
      documentToken: "e".repeat(32),
      navigationToken: null,
    }),
    { origin: alias },
  );
  probe.receive(receipt());
  probe.receive(receipt({ url: `${alias}/identifier` }), { origin: alias });
  probe.receive(start()); // A late/stale document cannot replace sequence 2.
  probe.receive(receipt());
  assert.deepEqual(
    probe.observations().map((value) => value.sequence),
    [2],
  );
  assert.deepEqual(
    probe.activations().map((value) => value.sequence),
    [1, 2],
  );
});

test("shell stops relaying after parent pagehide", () => {
  const probe = shell();
  probe.receive(start());
  probe.window.dispatch("pagehide");
  probe.receive(receipt());
  assert.equal(probe.observations().length, 0);
  assert.equal(probe.timers.size, 0);
});

test("real observer and shell relay a primary-frame snapshot after document activation", () => {
  const parent = shell();
  const child = observer({
    window: parent.frame.contentWindow,
    onPost: (message) => parent.receive(message),
  });
  assert.equal(parent.observations().length, 0); // Document-created script runs first.
  parent.receive(start());
  child.tick();
  assert.equal(parent.observations().length, 1);
  assert.equal(parent.observations()[0].sequence, 1);
  assert.equal(parent.observations()[0].snapshot.emailFields, 1);
  assert.equal(parent.observations()[0].snapshot.bodyVisible, true);
});
