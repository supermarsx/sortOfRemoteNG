// Declarative login steps in the native page client (t102-e9).
//
// Runs the real bundled page client (shared form modules + native keyboard)
// in JSDOM on a deterministic clock. The host model below stands in for the
// browser host: one release per origin and stage for the whole attempt (the
// Rust `LoginBudget` + `DeclarativeLoginPolicy`, tested on their own in
// native_features.rs), deliveries with only the stage's own field, and native
// key receipts. Several documents (real navigations) share one host model;
// another tab has its own. No network, no browser, no clipboard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const base = new URL(
  "../../src-tauri/crates/sorng-browser-host/src/",
  import.meta.url,
);
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
      if (event === "form-completed" || event.startsWith("form-rejected"))
        return;
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
      // The engine types into the focused element, inside open shadow roots
      // too; a document listener sees it through the event's composed path.
      let element = doc.activeElement;
      while (element?.shadowRoot?.activeElement)
        element = element.shadowRoot.activeElement;
      const unit = h.values[field][index];
      const event = {
        target: element,
        composedPath: () => [element],
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
      // Engine typing never runs page-defined value setters.
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        "value",
      ).set.call(element, element.value + unit);
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

export { host, page, loginSteps, USER, SECRET };
