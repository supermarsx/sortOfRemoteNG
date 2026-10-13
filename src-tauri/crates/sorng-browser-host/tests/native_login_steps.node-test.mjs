// Declarative login steps in the native page client (t102-e9).
//
// Runs the real bundled page client (shared form modules + native keyboard)
// in JSDOM on a deterministic clock. The host model below stands in for the
// browser host: one release per origin and stage for the whole attempt (the
// Rust `LoginBudget` + `DeclarativeLoginPolicy`, tested on their own in
// native_features.rs), deliveries with only the stage's own field, and native
// key receipts. Several documents (real navigations) share one host model;
// another tab has its own. No network, no browser, no clipboard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const base = new URL("../src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, base), "utf8");
const manifest = read("native_login_profiles.rs");
const modules = [
  ...manifest.split(");")[0].matchAll(/include_str!\("([^"]+)"\)/g),
]
  .map(([, path]) => read(path))
  .join("");
const source = read("native_login_client.js")
  .replace("/* REVIEWED_FORM_MODULES */", () => modules)
  .replace("/* NATIVE_KEYBOARD_CLIENT */", () =>
    read("native_login_typing.js"),
  );

const USER = "alice@example.test";
const SECRET = "s3cret-Pa55";
const REASONS = new Set([
  "unsupported-steps",
  "not-applicable",
  "layout-mismatch",
  "field-not-empty",
  "user-input",
  "navigation",
  "no-grant",
  "expired",
  "changed",
  "fill-only",
  "completed",
  "handed-over",
  "cancelled",
]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
// Real WebCrypto runs off the simulated clock: drain it before going on.
const digests = new Set();
async function settle() {
  await tick();
  while (digests.size) {
    await Promise.all([...digests]);
    await tick();
  }
}
const subtle = {
  async digest(...args) {
    const pending = webcrypto.subtle.digest(...args);
    digests.add(pending);
    try {
      return await pending;
    } finally {
      digests.delete(pending);
    }
  },
};

/** One attempt in one tab: clock, release budget, deliveries and keys. */
function host({
  autoSubmit = true,
  values = { username: USER, password: SECRET },
  refuse = () => false,
} = {}) {
  let clock = 1_000_000,
    nextId = 0;
  const jobs = new Map();
  const released = new Set();
  const requests = [];
  const pages = [];
  const schedule = (callback, ms, interval = 0) => {
    const id = ++nextId;
    jobs.set(id, { callback, at: clock + Math.max(1, ms || 0), interval });
    return id;
  };
  const model = {
    values,
    released,
    requests,
    pages,
    now: () => clock,
    schedule,
    cancel: (id) => jobs.delete(id),
    async advance(ms) {
      const end = clock + ms;
      for (let count = 0; count < 20000; count++) {
        const due = [...jobs]
          .filter(([, job]) => job.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, job] = due;
        clock = job.at;
        if (job.interval) job.at += job.interval;
        else jobs.delete(id);
        try {
          job.callback();
        } catch (error) {
          model.errors.push(error);
        }
        await settle();
        await settle();
      }
      clock = end;
      await settle();
    },
    errors: [],
    // The page asked for something. Stage requests get one release per
    // origin and stage; a refused or repeated one gets no reply at all.
    request(page, event) {
      requests.push([page.origin(), event]);
      if (event.startsWith("type|")) return page.typing(event);
      if (["form-completed", "form-rejected"].includes(event)) return;
      const key = `${page.origin()} ${event}`;
      if (released.has(key) || refuse(page.origin(), event)) return;
      released.add(key);
      const username = ["identifier", "form"].includes(event)
        ? values.username
        : "";
      const password = ["password", "form"].includes(event)
        ? values.password
        : "";
      schedule(() => {
        page.result.push([
          event,
          page.deliver(
            page.origin(),
            username,
            password,
            autoSubmit,
            clock + 30000,
            {
              version: 1,
              fillDelayMs: 0,
              submitDelayMs: 0,
              detectionTimeoutMs: 8000,
              submit: true,
              fields: [],
            },
            event,
          ),
        ]);
      }, 1);
    },
  };
  return model;
}

const loginSteps = (
  steps,
  {
    origins = [],
    passwordOnly = false,
    connection = "https://portal.example",
  } = {},
) => ({
  declarativeLogin: {
    connectionOrigin: connection,
    passwordOnly,
    credentialOrigins: origins,
    loginSteps: steps,
  },
});

/**
 * One document. `frame` puts the client in a direct child iframe of the top
 * document instead: `{ id, name, url, html }`.
 */
function page(t, h, url, html, configuration, options = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>${options.frame ? "" : html}</body></html>`,
    {
      url,
      runScripts: "outside-only",
      pretendToBeVisual: false,
    },
  );
  const top = dom.window;
  let win = top;
  if (options.frame) {
    const element = top.document.createElement("iframe");
    if (options.frame.id) element.id = options.frame.id;
    if (options.frame.name) element.setAttribute("name", options.frame.name);
    element.src = options.frame.url;
    top.document.body.appendChild(element);
    element.contentDocument.open();
    element.contentDocument.write(`<!doctype html><body>${html}</body>`);
    element.contentDocument.close();
    win = element.contentWindow;
  }
  const doc = win.document;
  for (const view of new Set([top, win])) {
    view.setTimeout = (callback, ms) => h.schedule(callback, ms);
    view.setInterval = (callback, ms) =>
      h.schedule(callback, ms, Math.max(1, ms || 0));
    view.clearTimeout = view.clearInterval = (id) => h.cancel(id);
    view.Date.now = () => h.now();
    view.TextEncoder = TextEncoder;
    if (view.location.protocol === "https:")
      Object.defineProperty(view.crypto, "subtle", {
        value: subtle,
        configurable: true,
      });
    Object.defineProperty(view.HTMLElement.prototype, "offsetParent", {
      get() {
        return this.parentElement;
      },
      configurable: true,
    });
    // JSDOM has no layout: every connected element has a box unless a test
    // marks it zero-size.
    view.HTMLElement.prototype.getClientRects = function () {
      if (!this.isConnected) return [];
      return this.hasAttribute("data-zero")
        ? [{ width: 0, height: 0 }]
        : [{ width: 120, height: 24 }];
    };
    view.fetch = () => {
      throw new Error("no network in a native login adapter");
    };
    if (options.background) {
      Object.defineProperty(view.document, "hidden", { get: () => true });
      Object.defineProperty(view.document, "visibilityState", {
        get: () => "hidden",
      });
      view.document.hasFocus = () => false;
      view.focus = () =>
        assert.fail("automatic login must not activate a window");
    }
  }
  // Trusted key, beforeinput and input events exist only in the model driver.
  const listeners = new Map();
  const add = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, callback, ...rest) => {
    if (["keydown", "beforeinput", "input", "keyup"].includes(type)) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    }
    return add(type, callback, ...rest);
  };
  const submits = [];
  doc.addEventListener("submit", (event) => {
    submits.push({ prevented: event.defaultPrevented, form: event.target });
    event.preventDefault();
  });
  const typed = [];
  const self = {
    win,
    doc,
    top,
    dom,
    typed,
    submits,
    result: [],
    signals: [],
    cancelled: new Set(),
    origin: () => win.location.origin,
    $: (selector) => doc.querySelector(selector),
    key(field, index) {
      const element = doc.activeElement;
      const unit = h.values[field][index];
      const event = {
        target: element,
        isTrusted: true,
        key: unit,
        data: unit,
        inputType: "insertText",
        preventDefault() {
          this.prevented = true;
        },
      };
      for (const type of ["keydown", "beforeinput"])
        for (const fn of listeners.get(type) ?? []) fn(event);
      if (event.prevented) return;
      element.value += unit;
      try {
        element.setSelectionRange(element.value.length, element.value.length);
      } catch (_) {
        /* email inputs have no selection */
      }
      for (const fn of listeners.get("input") ?? []) fn(event);
      for (const fn of listeners.get("keyup") ?? []) fn(event);
      typed.push([element.id || element.name, field]);
    },
    userTypes(element, text) {
      element.value = text;
      const event = {
        target: element,
        isTrusted: true,
        data: text,
        inputType: "insertText",
        preventDefault() {},
      };
      for (const fn of listeners.get("input") ?? []) fn(event);
    },
    typing(event) {
      const [, action, stage, field, n] = event.split("|");
      const role = `type|${stage}|${field}`;
      const index = Number(n);
      // A cancelled typing gets no further key from the host.
      if (action === "cancel") {
        self.cancelled.add(role);
        return;
      }
      h.schedule(() => {
        if (self.cancelled.has(role)) return;
        if (action === "start")
          self.deliver.nativeTyping("probe", 0, h.now() + 30000, false, role);
        if (action === "key") {
          self.key(field, index);
          self.deliver.nativeTyping(
            "probe",
            index + 1,
            h.now() + 30000,
            false,
            role,
          );
        }
      }, 1);
    },
    reason: () => self.deliver.declarativeReason,
    leave() {
      win.dispatchEvent(new win.Event("pagehide"));
    },
  };
  self.deliver = win.eval(source)(
    (event) => {
      self.signals.push(event);
      h.request(self, event);
    },
    configuration,
    options.adapter ?? "declarative-steps",
    options.keyboard ?? true,
  );
  h.pages.push(self);
  t.after(() => {
    try {
      win.dispatchEvent(new win.Event("pagehide"));
      top.close();
    } catch (_) {
      /* closed */
    }
  });
  return self;
}

const form = (extra = "") =>
  `<form method="post" action="/session"><input id="user" name="user" type="email"><input id="pass" name="pass" type="password"><button id="go" type="submit">Sign in</button>${extra}</form>`;
const formSteps = (submission = "click", scope = {}) => [
  {
    kind: "form",
    ...scope,
    selectors: { username: "#user", password: "#pass" },
  },
  submission === "enter"
    ? { kind: "submit", submission }
    : { kind: "submit", submission, selectors: { control: "#go" } },
];
const stages = (h) =>
  h.requests
    .map(([origin, event]) => `${event}@${origin}`)
    .filter((s) => !s.startsWith("type|"));
const leaks = (h) =>
  h.requests.some(
    ([, event]) => event.includes(USER) || event.includes(SECRET),
  );

test("a single-page form with a POST action is typed and submitted once through its own grants", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps("click", { paths: ["/login"] })),
  );
  await h.advance(3000);
  assert.equal(p.$("#user").value, USER);
  assert.equal(p.$("#pass").value, SECRET);
  assert.deepEqual(stages(h), [
    "form@https://portal.example",
    "form-submit@https://portal.example",
    "form-completed@https://portal.example",
  ]);
  assert.equal(p.submits.length, 1);
  assert.equal(p.reason(), "completed");
  assert.equal(leaks(h), false);
  assert.deepEqual(h.errors, []);
});

test("identifier-first across two listed origins: each page gets only its own field and stage", async (t) => {
  const h = host();
  const steps = [
    {
      kind: "identifier",
      origin: "https://id.example",
      paths: ["/start"],
      selectors: { username: "#user" },
    },
    { kind: "submit", submission: "click", selectors: { control: "#next" } },
    {
      kind: "password",
      origin: "https://login.example",
      paths: ["/pwd"],
      selectors: { password: "#pass" },
    },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
  ];
  const configuration = loginSteps(steps, {
    origins: ["https://id.example", "https://login.example"],
  });
  // The connection's own page has no step: it asks for nothing.
  const portal = page(t, h, "https://portal.example/", form(), configuration);
  await h.advance(2000);
  assert.deepEqual(portal.signals, []);
  assert.equal(portal.reason(), "not-applicable");
  const first = page(
    t,
    h,
    "https://id.example/start",
    '<form method="post" action="/start"><input id="user" type="email"><input id="pass" type="password" hidden><button id="next">Next</button></form>',
    configuration,
  );
  let next = 0;
  first.$("#next").addEventListener("click", () => {
    next++;
  });
  await h.advance(3000);
  assert.equal(first.$("#user").value, USER);
  assert.equal(
    first.$("#pass").value,
    "",
    "the hidden password field of the first page is never typed into",
  );
  assert.equal(next, 1);
  assert.equal(first.submits.length, 1);
  first.leave();
  const second = page(
    t,
    h,
    "https://login.example/pwd",
    `<form method="post" action="/pwd"><input id="user" type="email" value="${USER}" readonly hidden><input id="pass" type="password"><button id="go">Sign in</button></form>`,
    configuration,
  );
  await h.advance(3000);
  assert.equal(second.$("#pass").value, SECRET);
  assert.equal(second.submits.length, 1);
  assert.deepEqual(
    stages(h).filter((s) => !s.startsWith("form-")),
    [
      "identifier@https://id.example",
      "id-submit@https://id.example",
      "password@https://login.example",
      "pw-submit@https://login.example",
    ],
  );
  assert.deepEqual(
    first.typed
      .map(([, field]) => field)
      .filter((f, i, a) => a.indexOf(f) === i),
    ["username"],
  );
  assert.deepEqual(
    second.typed
      .map(([, field]) => field)
      .filter((f, i, a) => a.indexOf(f) === i),
    ["password"],
  );
  assert.equal(second.reason(), "completed");
  assert.equal(leaks(h), false);
});

test("a page reloaded at the password stage does not get the password twice and stops quietly", async (t) => {
  const h = host();
  const steps = [
    {
      kind: "identifier",
      paths: ["/signin"],
      selectors: { username: "#user" },
    },
    { kind: "submit", submission: "click", selectors: { control: "#next" } },
    { kind: "password", paths: ["/signin"], selectors: { password: "#pass" } },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
  ];
  const pwdPage =
    '<form method="post" action="/signin"><input id="pass" type="password"><button id="go">Sign in</button></form>';
  const first = page(
    t,
    h,
    "https://portal.example/signin",
    pwdPage,
    loginSteps(steps),
  );
  h.released.add("https://portal.example identifier");
  await h.advance(2500);
  assert.equal(first.$("#pass").value, SECRET);
  first.leave();
  const reload = page(
    t,
    h,
    "https://portal.example/signin",
    pwdPage,
    loginSteps(steps),
  );
  await h.advance(60000);
  assert.equal(reload.$("#pass").value, "");
  assert.equal(reload.submits.length, 0);
  assert.equal(
    reload.signals.filter((s) => s === "password").length,
    1,
    "asked once, refused, never again",
  );
  assert.equal(reload.reason(), "no-grant");
});

test("a pre-step click acts only on its displayed control and only after its grant", async (t) => {
  const h = host();
  const steps = [
    { kind: "click", paths: ["/"], selectors: { control: "#open" } },
    ...formSteps("click"),
  ];
  const p = page(
    t,
    h,
    "https://portal.example/",
    `<button id="open" type="button">Sign in</button><div id="dialog" hidden>${form()}</div>`,
    loginSteps(steps),
  );
  let clicks = 0;
  p.$("#open").addEventListener("click", () => {
    clicks++;
    p.$("#dialog").hidden = false;
  });
  await h.advance(300);
  assert.equal(clicks, 0, "nothing is clicked before the grant");
  await h.advance(4000);
  assert.equal(clicks, 1);
  assert.equal(p.$("#user").value, USER);
  assert.equal(p.submits.length, 1);
  assert.deepEqual(stages(h).slice(0, 3), [
    "form-prepare@https://portal.example",
    "form@https://portal.example",
    "form-submit@https://portal.example",
  ]);
});

for (const hide of [
  "hidden-attribute",
  "display-none",
  "zero-size",
  "aria-hidden",
  "type-hidden",
  "detached-parent",
]) {
  test(`a control that is not displayed (${hide}) is never typed into or clicked`, async (t) => {
    const h = host();
    const p = page(
      t,
      h,
      "https://portal.example/login",
      form(),
      loginSteps(formSteps()),
    );
    const pass = p.$("#pass");
    if (hide === "hidden-attribute") pass.hidden = true;
    if (hide === "display-none") pass.style.display = "none";
    if (hide === "zero-size") pass.setAttribute("data-zero", "");
    if (hide === "aria-hidden")
      pass.parentElement.setAttribute("aria-hidden", "true");
    if (hide === "type-hidden") pass.type = "hidden";
    if (hide === "detached-parent") p.$("form").remove();
    await h.advance(20000);
    assert.deepEqual(
      p.signals.filter((s) => !s.startsWith("form-")),
      [],
    );
    assert.equal(p.$("#user")?.value ?? "", "");
    assert.equal(p.reason(), "layout-mismatch");
  });
}

test("a hidden background tab still completes, without focusing any window", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
    { background: true },
  );
  await h.advance(3000);
  assert.equal(p.$("#pass").value, SECRET);
  assert.equal(p.submits.length, 1);
});

for (const by of ["id", "name"]) {
  test(`a same-origin frame named by ${by} gets the steps; the top document and other frames get nothing`, async (t) => {
    const h = host();
    const steps = formSteps("enter", {
      frame: "appFrame",
      paths: ["/login.html"],
    });
    const configuration = loginSteps(steps, {
      connection: "https://ilo.example:8443",
    });
    const frame = {
      [by]: "appFrame",
      url: "https://ilo.example:8443/login.html",
    };
    const p = page(
      t,
      h,
      "https://ilo.example:8443/index.html",
      form(),
      configuration,
      { frame },
    );
    await h.advance(3000);
    assert.equal(p.$("#user").value, USER);
    assert.equal(p.$("#pass").value, SECRET);
    assert.equal(p.submits.length, 1);
    const other = page(
      t,
      h,
      "https://ilo.example:8443/index.html",
      form(),
      configuration,
      {
        frame: {
          [by]: "otherFrame",
          url: "https://ilo.example:8443/login.html",
        },
      },
    );
    const topOnly = page(
      t,
      h,
      "https://ilo.example:8443/login.html",
      form(),
      configuration,
    );
    await h.advance(20000);
    assert.deepEqual(other.signals, []);
    assert.deepEqual(
      topOnly.signals.filter((s) => !s.startsWith("form-")),
      [],
    );
    assert.equal(other.$("#pass").value, "");
    assert.equal(topOnly.$("#pass").value, "");
  });
}

test("password-only: the password stage alone, no username asked or typed", async (t) => {
  const h = host({ values: { username: "", password: SECRET } });
  const steps = [
    { kind: "password", selectors: { password: "#pass" } },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
  ];
  const p = page(
    t,
    h,
    "http://router.lan/",
    '<form method="post" action="/cgi"><input id="pass" type="password"><button id="go">Login</button></form>',
    loginSteps(steps, { passwordOnly: true, connection: "http://router.lan" }),
  );
  await h.advance(3000);
  assert.equal(p.$("#pass").value, SECRET);
  assert.equal(p.submits.length, 1);
  assert.deepEqual(stages(h).slice(0, 2), [
    "password@http://router.lan",
    "pw-submit@http://router.lan",
  ]);
});

test("Enter submission presses Enter in the field just typed and submits its form once", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps("enter")),
  );
  const keys = [];
  p.$("#pass").addEventListener("keydown", (event) =>
    keys.push([event.key, event.target.id]),
  );
  await h.advance(3000);
  assert.deepEqual(
    keys.filter(([key]) => key === "Enter"),
    [["Enter", "pass"]],
  );
  assert.equal(p.submits.length, 1);
  assert.ok(stages(h).includes("form-submit@https://portal.example"));
});

test("reviewed single-page submission clicks its button and never lets the form submit natively", async (t) => {
  const h = host();
  const html =
    '<form><input id="user" type="email"><input id="pass" type="password"><button id="go" type="button">Log in</button></form>';
  const p = page(
    t,
    h,
    "https://portal.example/app",
    html,
    loginSteps(formSteps("spa")),
  );
  let clicked = 0;
  p.$("#go").addEventListener("click", () => {
    clicked++;
    p.$("form").requestSubmit();
  });
  await h.advance(3000);
  assert.equal(clicked, 1);
  assert.deepEqual(
    p.submits.map((s) => s.prevented),
    [true],
    "the native submission was prevented",
  );
});

test("a step on an unlisted origin receives nothing and asks for nothing", async (t) => {
  const h = host();
  const steps = formSteps("click").map((step) =>
    step.kind === "form" ? { ...step, origin: "https://id.example" } : step,
  );
  const configuration = loginSteps(steps, { origins: ["https://id.example"] });
  for (const url of [
    "https://evil.example/login",
    "https://id.example.evil.test/login",
    "http://id.example/login",
    "https://id.example:8443/login",
  ]) {
    const p = page(t, h, url, form(), configuration);
    await h.advance(20000);
    assert.deepEqual(p.signals, [], url);
    for (const stage of [
      "form",
      "identifier",
      "password",
      "form-prepare",
      "form-submit",
    ])
      assert.equal(
        p.deliver(p.origin(), USER, SECRET, true, h.now() + 1000, {}, stage),
        false,
      );
    assert.equal(p.$("#pass").value, "");
    assert.equal(p.reason(), "not-applicable");
  }
});

test("path rules are checked on the live address: a route to the login view is followed, a route away ends it", async (t) => {
  const h = host();
  const steps = formSteps("click", { paths: ["/auth"] });
  const p = page(t, h, "https://portal.example/", "", loginSteps(steps));
  await h.advance(500);
  p.win.history.pushState(null, "", "/auth");
  p.doc.body.innerHTML = form();
  await h.advance(3000);
  assert.equal(
    p.$("#pass").value,
    SECRET,
    "a same-document route to the step's path",
  );
  const q = page(
    t,
    h,
    "https://portal.example/auth",
    form(),
    loginSteps(steps),
  );
  await h.advance(450);
  const requested = q.signals.includes("form");
  q.win.history.pushState(null, "", "/elsewhere");
  await h.advance(5000);
  assert.ok(requested || q.signals.length === 0);
  assert.equal(q.$("#pass").value, "");
  assert.equal(q.submits.length, 0);
});

test("the stage is refused when the address leaves the step's path between request and delivery", async (t) => {
  const h = host({ refuse: () => true });
  const p = page(
    t,
    h,
    "https://portal.example/auth",
    form(),
    loginSteps(formSteps("click", { paths: ["/auth"] })),
  );
  await h.advance(1000);
  assert.deepEqual(p.signals, ["form"]);
  p.win.history.pushState(null, "", "/other");
  assert.equal(
    p.deliver(p.origin(), USER, SECRET, true, h.now() + 5000, {}, "form"),
    false,
  );
  await h.advance(1000);
  assert.equal(p.$("#user").value, "");
  assert.equal(p.reason(), "navigation");
});

test("user input ends the attempt and erases only what automatic typing entered", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
  );
  // Typing of the username has started; the user takes over.
  for (let i = 0; i < 2000 && !p.typed.length; i++) await h.advance(1);
  assert.ok(p.typed.length > 0);
  p.userTypes(p.$("#pass"), "mine");
  await h.advance(3000);
  assert.equal(p.reason(), "user-input");
  assert.equal(p.$("#user").value, "");
  assert.equal(p.$("#pass").value, "mine");
  assert.equal(p.submits.length, 0);
});

test("a field the user already filled is never overwritten", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
  );
  p.$("#user").value = "someone-else";
  await h.advance(5000);
  assert.deepEqual(
    p.signals.filter((s) => !s.startsWith("form-")),
    [],
  );
  assert.equal(p.$("#user").value, "someone-else");
  assert.equal(p.reason(), "field-not-empty");
});

test("a CAPTCHA or code page after the identifier stops quietly: nothing asked, no loop", async (t) => {
  const h = host();
  const steps = [
    { kind: "identifier", selectors: { username: "#user" } },
    { kind: "submit", submission: "click", selectors: { control: "#next" } },
    { kind: "password", selectors: { password: "#pass" } },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
  ];
  const first = page(
    t,
    h,
    "https://portal.example/login",
    '<form method="post"><input id="user" type="email"><button id="next">Next</button></form>',
    loginSteps(steps),
  );
  await h.advance(3000);
  first.leave();
  const challenge = page(
    t,
    h,
    "https://portal.example/challenge",
    '<form method="post"><div class="g-recaptcha"></div><input id="code" autocomplete="one-time-code"><button id="verify">Verify</button></form>',
    loginSteps(steps),
  );
  await h.advance(120000);
  assert.deepEqual(
    challenge.signals.filter((s) => !s.startsWith("form-")),
    [],
  );
  assert.equal(challenge.$("#code").value, "");
  assert.equal(challenge.submits.length, 0);
  assert.equal(challenge.reason(), "layout-mismatch");
});

test("fill-only consent types and stops: no submit is requested or performed", async (t) => {
  const h = host({ autoSubmit: false });
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
  );
  await h.advance(5000);
  assert.equal(p.$("#pass").value, SECRET);
  assert.equal(p.submits.length, 0);
  assert.ok(!p.signals.includes("form-submit"));
  assert.equal(p.reason(), "fill-only");
});

test("a form that would submit by GET or to another origin is not submitted", async (t) => {
  for (const attributes of [
    'method="get" action="/session"',
    'method="post" action="https://other.example/session"',
    'method="post" target="_blank"',
  ]) {
    const h = host();
    const html = `<form ${attributes}><input id="user" type="email"><input id="pass" type="password"><button id="go">Sign in</button></form>`;
    const p = page(
      t,
      h,
      "https://portal.example/login",
      html,
      loginSteps(formSteps("click")),
    );
    await h.advance(5000);
    assert.equal(p.submits.length, 0, attributes);
    assert.equal(
      p.$("#pass").value,
      "",
      `${attributes}: typed values are erased`,
    );
    assert.equal(p.reason(), "changed");
  }
});

test("a selector that matches the wrong kind of element, or none the browser can parse, types nothing", async (t) => {
  const h = host();
  const wrong = page(
    t,
    h,
    "https://portal.example/login",
    form('<div id="decoy">x</div>'),
    loginSteps([
      { kind: "form", selectors: { username: "#decoy", password: "#pass" } },
    ]),
  );
  await h.advance(5000);
  assert.deepEqual(
    wrong.signals.filter((s) => !s.startsWith("form-")),
    [],
  );
  assert.equal(wrong.reason(), "layout-mismatch");
  const unparsable = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps([
      { kind: "form", selectors: { username: "#user[", password: "#pass" } },
    ]),
  );
  await h.advance(5000);
  assert.deepEqual(unparsable.signals, []);
  assert.equal(unparsable.reason(), "unsupported-steps");
});

test("invalid or unsupported steps are refused whole and ask for nothing", async (t) => {
  const good = formSteps();
  const cases = [
    ["unknown root key", { ...loginSteps(good), extra: true }],
    ["unknown step key", loginSteps([{ ...good[0], script: "x" }, good[1]])],
    [
      "origin not listed",
      loginSteps([{ ...good[0], origin: "https://id.example" }, good[1]]),
    ],
    [
      "HTTP listed origin",
      loginSteps([{ ...good[0], origin: "http://id.example" }, good[1]], {
        origins: ["http://id.example"],
      }),
    ],
    ["submit first", loginSteps([good[1], good[0]])],
    [
      "password before identifier",
      loginSteps([{ kind: "password", selectors: { password: "#pass" } }]),
    ],
    [
      "password-only identifier",
      loginSteps([{ kind: "identifier", selectors: { username: "#user" } }], {
        passwordOnly: true,
      }),
    ],
    [
      "two clicks on one origin",
      loginSteps([
        { kind: "click", selectors: { control: "#a" } },
        { kind: "click", selectors: { control: "#b" } },
        ...good,
      ]),
    ],
    [
      "bad frame name",
      loginSteps([{ ...good[0], frame: "app.Frame" }, good[1]]),
    ],
    [
      "control character",
      loginSteps([
        { ...good[0], selectors: { username: "#u\u0007", password: "#pass" } },
        good[1],
      ]),
    ],
    [
      "frames list beside steps",
      { ...loginSteps(good), sameOriginLoginFrames: ["appFrame"] },
    ],
    ["no steps", loginSteps([])],
    ["seventeen steps", loginSteps(Array(17).fill(good[0]))],
  ];
  for (const [label, configuration] of cases) {
    const h = host();
    const p = page(t, h, "https://portal.example/login", form(), configuration);
    await h.advance(5000);
    assert.deepEqual(p.signals, [], label);
    assert.equal(
      p.deliver(
        "https://portal.example",
        USER,
        SECRET,
        true,
        h.now() + 1000,
        {},
        "form",
      ),
      false,
      label,
    );
    assert.equal(p.$("#pass").value, "", label);
    assert.equal(p.reason(), "unsupported-steps", label);
  }
  // Without native typing there is no script fallback.
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(good),
    { keyboard: false },
  );
  await h.advance(5000);
  assert.deepEqual(p.signals, []);
  assert.equal(p.$("#pass").value, "");
});

test("selectors next to the steps are ignored: the steps win", async (t) => {
  const h = host();
  const configuration = {
    ...loginSteps(formSteps()),
    selectors: {
      username: "#decoy-user",
      password: "#decoy-pass",
      submit: "#decoy-go",
    },
  };
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(
      '<input id="decoy-user"><input id="decoy-pass" type="password"><button id="decoy-go">x</button>',
    ),
    configuration,
  );
  await h.advance(3000);
  assert.equal(p.$("#user").value, USER);
  assert.equal(p.$("#decoy-user").value, "");
  assert.equal(p.$("#decoy-pass").value, "");
});

test("a delivery carrying another stage's field, a wrong origin or a stale stage is refused", async (t) => {
  const h = host({ refuse: () => true });
  const steps = [
    { kind: "identifier", selectors: { username: "#user" } },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
  ];
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(steps),
  );
  await h.advance(1000);
  assert.deepEqual(p.signals, ["identifier"]);
  const o = "https://portal.example",
    until = h.now() + 5000;
  assert.equal(
    p.deliver(o, USER, SECRET, true, until, {}, "identifier"),
    false,
    "password with the identifier",
  );
  assert.equal(
    p.deliver(o, "", SECRET, true, until, {}, "password"),
    false,
    "not the requested stage",
  );
  assert.equal(
    p.deliver("https://other.example", USER, "", true, until, {}, "identifier"),
    false,
  );
  assert.equal(
    p.deliver(o, USER, "", true, h.now() - 1, {}, "identifier"),
    false,
  );
  assert.equal(
    p.deliver(
      o,
      USER,
      "",
      true,
      until,
      { fields: [{ selector: "#x", value: "v" }] },
      "identifier",
    ),
    false,
  );
  assert.equal(p.$("#user").value, "");
  assert.equal(p.$("#pass").value, "");
});

test("two tabs signing in at once do not cross", async (t) => {
  const a = host({
    values: { username: "tab-a@example.test", password: "secret-a" },
  });
  const b = host({
    values: { username: "tab-b@example.test", password: "secret-b" },
  });
  const pa = page(
    t,
    a,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
  );
  const pb = page(
    t,
    b,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
  );
  for (let i = 0; i < 30; i++) {
    await a.advance(100);
    await b.advance(100);
  }
  assert.equal(pa.$("#user").value, "tab-a@example.test");
  assert.equal(pa.$("#pass").value, "secret-a");
  assert.equal(pb.$("#user").value, "tab-b@example.test");
  assert.equal(pb.$("#pass").value, "secret-b");
  assert.equal(pa.submits.length + pb.submits.length, 2);
});

test("statuses are fixed words and reasons a fixed set; no credential leaves the page", async (t) => {
  const h = host();
  const p = page(
    t,
    h,
    "https://portal.example/login",
    form(),
    loginSteps(formSteps()),
  );
  await h.advance(3000);
  for (const signal of p.signals)
    assert.match(
      signal,
      /^(form-prepare|form|form-submit|identifier|password|id-submit|pw-submit|form-completed|form-rejected|type\|(start|key|cancel)\|(form|identifier|password)\|(username|password)\|\d+)$/,
    );
  assert.ok(REASONS.has(p.reason()));
  assert.equal(leaks(h), false);
});

test("every reviewed steps file is accepted by the page client, as by the host", async (t) => {
  const { readdirSync } = await import("node:fs");
  const root = new URL("../../../../src/data/loginSteps/", import.meta.url);
  let count = 0;
  for (const family of readdirSync(root, { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    for (const name of readdirSync(new URL(`${family.name}/`, root))) {
      const file = JSON.parse(
        readFileSync(new URL(`${family.name}/${name}`, root), "utf8"),
      );
      for (const connection of [
        "https://device.example:8443",
        "http://192.168.1.10:8080",
      ]) {
        const h = host();
        const p = page(
          t,
          h,
          `${connection}/`,
          "",
          loginSteps(file.loginSteps, {
            origins: file.credentialOrigins,
            passwordOnly: file.passwordOnly === true,
            connection,
          }),
        );
        await h.advance(50);
        assert.notEqual(
          p.reason(),
          "unsupported-steps",
          `${name} on ${connection}`,
        );
        p.leave();
      }
      count++;
    }
  }
  assert.ok(count > 0, String(count));
});

test("with steps in two frames, each frame runs only its own step", async (t) => {
  const h = host();
  const steps = [
    { kind: "identifier", frame: "idFrame", selectors: { username: "#user" } },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
    { kind: "password", frame: "pwFrame", selectors: { password: "#pass" } },
    { kind: "submit", submission: "click", selectors: { control: "#go" } },
  ];
  // The password frame's document also shows a username field: the
  // identifier step is not this frame's, so it is never asked for here.
  h.released.add("https://portal.example identifier");
  const p = page(
    t,
    h,
    "https://portal.example/shell",
    form(),
    loginSteps(steps),
    {
      frame: { id: "pwFrame", url: "https://portal.example/password" },
    },
  );
  await h.advance(3000);
  assert.deepEqual(
    p.signals.filter((s) => !s.startsWith("type|") && !s.startsWith("form-")),
    ["password", "pw-submit"],
  );
  assert.equal(p.$("#user").value, "");
  assert.equal(p.$("#pass").value, SECRET);
});

test("a selector that matches two displayed controls is ambiguous: nothing is typed", async (t) => {
  const h = host();
  const html =
    '<form method="post"><input id="user" type="email"><input class="pw" type="password"><input class="pw" type="password"><button id="go">Go</button></form>';
  const p = page(
    t,
    h,
    "https://portal.example/login",
    html,
    loginSteps([
      { kind: "form", selectors: { username: "#user", password: "input.pw" } },
    ]),
  );
  await h.advance(20000);
  assert.deepEqual(
    p.signals.filter((s) => !s.startsWith("form-")),
    [],
  );
  assert.equal(p.$("#user").value, "");
  assert.equal(p.reason(), "layout-mismatch");
});
