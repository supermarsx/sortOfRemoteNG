/**
 * Portainer sign-in through the page client of the native (CEF) engine, and
 * through the legacy client for comparison.
 *
 * The page below is modelled on Portainer's own login view as published in
 * the public repository portainer/portainer (read 2026-10-13 at 2.0.0,
 * release/2.11, release/2.19 and develop: `app/config.js`,
 * `app/portainer/views/auth/auth.html`, `authController.js`). In all four:
 *
 * - the router is hashbang with `$urlRouterProvider.otherwise('/auth')`, so a
 *   tab opened at the saved address (`https://host:9443/`) is routed to
 *   `/#!/auth` inside the same document once AngularJS has started;
 * - the panel holding the form is rendered only after the public settings
 *   request has answered (`loginInProgress` starts true), which is around or
 *   after the document's load event;
 * - the form has neither action nor method, `input#username` carries the
 *   auto-focus directive, and the only `button[type=submit]` signs in through
 *   its click handler, which removes the panel.
 *
 * From 2.19 on the password field takes its type from the controller and is
 * followed by a `button[type=button]` that shows the password; before that it
 * is a plain `type="password"` field. The reviewed selectors match both.
 *
 * Nothing here leaves the process and every credential is synthetic.
 */
// @ts-expect-error - no type declarations for jsdom
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { PORTAINER_AUTO_LOGIN_SELECTORS } from "../../src/components/integrations/portainer/webUiLaunch";

const ROOT = "https://portainer.test:9443/";
const LOGIN_ROUTE = "https://portainer.test:9443/#!/auth";
const USERNAME = "admin-operator";
const PASSWORD = "pA55@word-16char";

// Assembled as `native_login_profiles.rs::form_client_source` does it.
function nativeClientSource(): string {
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
  return readFileSync(resolve(base, "native_login_client.js"), "utf8")
    .replace("/* REVIEWED_FORM_MODULES */", () => modules)
    .replace("/* NATIVE_KEYBOARD_CLIENT */", () =>
      readFileSync(resolve(base, "native_login_typing.js"), "utf8"),
    );
}

type Family = "2.0" | "2.19";

function authView(family: Family): string {
  const password =
    family === "2.19"
      ? '<div class="relative"><input id="password" type="password" class="form-control pr-10" name="password" autocomplete="off" data-cy="auth-passwordInput" placeholder="Enter your password">' +
        '<button data-cy="auth-passwordInputToggle" type="button" class="absolute right-0 top-0"></button></div>'
      : '<div class="input-group"><span class="input-group-addon"></span><input id="password" type="password" class="form-control" name="password"></div>';
  return (
    '<div class="page-wrapper"><div class="simple-box container"><div class="col-sm-4 col-sm-offset-4">' +
    '<div class="panel panel-default" id="login-panel"><div class="panel-body">' +
    '<form class="simple-box-form form-horizontal"><div class="form-group"></div>' +
    '<div><input id="username" type="text" class="form-control" name="username" data-cy="auth-usernameInput"></div>' +
    `<div>${password}</div>` +
    '<div class="form-group"><div class="col-sm-12">' +
    '<button type="submit" class="btn btn-primary" data-cy="auth-loginButton"><span>Login</span></button>' +
    "</div></div></form></div></div></div></div></div>"
  );
}

interface Timeline {
  /** Address of the document when it is created. */
  url: string;
  family?: Family;
  /** The router replaces an empty route: `hash` as Portainer does, `history`
   * for an application that uses the History API instead. */
  route?: { at: number; kind: "hash" | "history" };
  /** The login panel is rendered. */
  formAt: number;
  /** Load end of the main document; already loaded when absent. */
  loadAt?: number;
  /** The tab is not the visible one. */
  hidden?: boolean;
  /** The page routes away from its login view: once the form's metadata was
   * released, or on the fourth key of the password. */
  leave?: "before-fill" | "during-fill";
  fillDelayMs?: number;
}

interface PortainerPage {
  window: any;
  document: Document;
  logins: { Username: string; Password: string }[];
  /** Submissions that would have sent the form as a GET. */
  nativeSubmits: () => number;
  field: (id: "username" | "password") => HTMLInputElement | null;
  /** What `ng-model` does for the element an `input` event names. */
  sync: (input: Element | null) => void;
  load: () => void;
  closed: () => boolean;
  close: () => void;
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
const pages: PortainerPage[] = [];

afterEach(() => {
  for (const page of pages.splice(0)) page.close();
});

function portainerPage(timeline: Timeline): PortainerPage {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Portainer</title><base id="base" href="/"></head>' +
      '<body><div id="page-wrapper"><div class="page-wrapper" id="loading">Loading Portainer...</div><div id="view"></div></div></body></html>',
    { url: timeline.url, runScripts: "outside-only" },
  );
  const window = dom.window;
  const document: Document = window.document;
  let closed = false;
  if (timeline.hidden) {
    Object.defineProperty(document, "visibilityState", {
      get: () => "hidden",
    });
    Object.defineProperty(document, "hidden", { get: () => true });
    document.hasFocus = () => false;
  }
  // jsdom has no layout: an element is displayed when it is in the document.
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
  window.HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    return this.isConnected ? [{ width: 100, height: 20 }] : [];
  };
  if (window.location.protocol === "https:")
    Object.defineProperty(window.crypto, "subtle", {
      value: webcrypto.subtle,
    });
  window.TextEncoder = TextEncoder;
  let readyState = timeline.loadAt === undefined ? "complete" : "interactive";
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => readyState,
  });
  const model = { Username: "", Password: "" };
  const logins: PortainerPage["logins"] = [];
  let nativeSubmits = 0;
  document.addEventListener("submit", (event) => {
    if (!event.defaultPrevented) nativeSubmits++;
    event.preventDefault();
  });
  const field = (id: "username" | "password") =>
    document.getElementById(id) as HTMLInputElement | null;
  const sync = (input: Element | null) => {
    if (input === field("username")) model.Username = field("username")!.value;
    if (input === field("password")) model.Password = field("password")!.value;
  };
  const at = (ms: number, task: () => void) =>
    setTimeout(() => {
      if (!closed) task();
    }, ms);
  if (timeline.route) {
    const { kind } = timeline.route;
    at(timeline.route.at, () => {
      if (kind === "history") window.history.pushState(null, "", "/login");
      // `$browser.url(url, true)`: a hash-only change is `location.replace`.
      else window.location.replace(`${ROOT}#!/auth`);
    });
  }
  at(timeline.formAt, () => {
    document.getElementById("loading")?.remove();
    document.getElementById("view")!.innerHTML = authView(
      timeline.family ?? "2.19",
    );
    for (const id of ["username", "password"] as const)
      field(id)!.addEventListener("input", (event) =>
        sync(event.target as Element),
      );
    document
      .querySelector('button[type="submit"]')!
      .addEventListener("click", () => {
        // `ctrl.authenticateUser()`: `loginInProgress` removes the panel and
        // the router leaves for the home view once the token is stored.
        logins.push({ ...model });
        document.getElementById("login-panel")?.remove();
        at(20, () => {
          window.location.hash = "#!/home";
        });
      });
    // The auto-focus directive: `$timeout(() => element.focus())`.
    at(0, () => field("username")?.focus());
  });
  const page: PortainerPage = {
    window,
    document,
    logins,
    nativeSubmits: () => nativeSubmits,
    field,
    sync,
    load: () => {
      readyState = "complete";
      document.dispatchEvent(new window.Event("readystatechange"));
      window.dispatchEvent(new window.Event("load"));
    },
    closed: () => closed,
    close: () => {
      if (closed) return;
      closed = true;
      window.dispatchEvent(new window.Event("pagehide"));
      window.close();
    },
  };
  pages.push(page);
  return page;
}

type Deliver = ((
  origin: string,
  username: string,
  password: string,
  autoSubmit: boolean,
  deadline: number,
  options: unknown,
  stage: string,
) => boolean) & {
  nativeTyping(
    command: string,
    index: number,
    deadline: number,
    submit: boolean,
    role: string,
  ): boolean;
};

/**
 * The native page client in that page, with a model of the host: one release
 * per stage for the attempt, typing that starts only after load end, and key
 * events that go to whatever holds the focus.
 */
function nativeLogin(timeline: Timeline) {
  const page = portainerPage(timeline);
  const { window, document } = page;
  const origin = new URL(timeline.url).origin;
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const add = document.addEventListener.bind(document);
  document.addEventListener = ((
    type: string,
    callback: (event: unknown) => void,
    ...rest: unknown[]
  ) => {
    if (["keydown", "beforeinput", "input", "keyup"].includes(type))
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    return (add as (...args: unknown[]) => void)(type, callback, ...rest);
  }) as typeof document.addEventListener;
  const fire = (type: string, event: unknown) => {
    for (const callback of listeners.get(type) ?? []) callback(event);
  };
  const values = { username: USERNAME, password: PASSWORD };
  const signals: string[] = [];
  const released = new Set<string>();
  const started = new Set<string>();
  let loaded = timeline.loadAt === undefined;
  let typing: {
    role: string;
    field: "username" | "password";
    next: number;
  } | null = null;
  let keys = 0;
  const leave = () => {
    window.location.hash = "#!/init/admin";
  };
  // Only this model writes characters; production sends CEF key events.
  function press(unit: string) {
    const input = document.activeElement as HTMLInputElement | null;
    const event = {
      target: input,
      isTrusted: true,
      key: unit,
      data: unit,
      inputType: "insertText",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    fire("keydown", event);
    if (!event.prevented) fire("beforeinput", event);
    if (event.prevented || input?.tagName !== "INPUT") return false;
    input.value += unit;
    input.setSelectionRange(input.value.length, input.value.length);
    fire("input", event);
    page.sync(input);
    fire("keyup", event);
    return true;
  }
  function stage(name: string) {
    if (released.has(name)) return;
    released.add(name);
    const credential = name === "form";
    deliver(
      origin,
      credential ? values.username : "",
      credential ? values.password : "",
      true,
      // As native: 30 s for the credential stage, 2 s for the other two.
      Date.now() + (credential ? 30_000 : 2_000),
      {
        version: 1,
        fillDelayMs: timeline.fillDelayMs ?? 0,
        submitDelayMs: 0,
        detectionTimeoutMs: 8000,
        submit: true,
        fields: [],
      },
      name,
    );
    if (name === "form-prepare" && timeline.leave === "before-fill") leave();
  }
  function type(event: string) {
    const [, action, stageName, field, index] = event.split("|");
    const role = `type|${stageName}|${field}`;
    const reply = (command: string, value = 0, deadline = 0) =>
      deliver.nativeTyping(command, value, deadline, false, role);
    if (!loaded) return reply(action === "start" ? "wait" : "cancel", 200);
    if (action === "cancel") {
      typing = null;
      return reply("cancel");
    }
    if (action === "start") {
      if (typing || started.has(role)) {
        typing = null;
        return reply("cancel");
      }
      started.add(role);
      typing = { role, field: field as "username" | "password", next: 0 };
      return reply("probe", 0, Date.now() + 30_000);
    }
    if (!typing || typing.role !== role || typing.next !== Number(index)) {
      typing = null;
      return reply("cancel");
    }
    if (
      timeline.leave === "during-fill" &&
      typing.field === "password" &&
      typing.next === 3
    )
      leave();
    if (!press(values[typing.field][typing.next])) return false;
    keys++;
    const next = ++typing.next;
    if (next === values[typing.field].length) typing = null;
    return reply("probe", next, Date.now() + 30_000);
  }
  const signal = (event: string) => {
    signals.push(event);
    if (event === "form-completed" || event.startsWith("form-rejected")) return;
    setTimeout(() => {
      if (page.closed()) return;
      if (event.startsWith("type|")) type(event);
      else stage(event);
    }, 1);
  };
  if (timeline.loadAt !== undefined)
    setTimeout(() => {
      if (page.closed()) return;
      loaded = true;
      page.load();
    }, timeline.loadAt);
  const deliver: Deliver = window.eval(nativeClientSource())(
    signal,
    {
      selectors: {
        username: PORTAINER_AUTO_LOGIN_SELECTORS.usernameSelector,
        password: PORTAINER_AUTO_LOGIN_SELECTORS.passwordSelector,
        submit: PORTAINER_AUTO_LOGIN_SELECTORS.submitSelector,
      },
      readiness: { detectionTimeoutMs: 8000 },
    },
    "modular-form",
    true,
  );
  const stages = () => signals.filter((value) => !value.startsWith("type|"));
  return {
    page,
    signals,
    stages,
    keys: () => keys,
    /** The attempt's last word, or what it had said when the wait ran out. */
    async outcome(within: number) {
      const until = Date.now() + within;
      const ended = () =>
        signals.includes("form-completed") ||
        signals.some((signal) => signal.startsWith("form-rejected"));
      while (!ended() && Date.now() < until) await delay(20);
      // The page's own reaction to the click (the route home) follows.
      await delay(40);
      return stages();
    },
  };
}

function expectSignedInOnce(login: ReturnType<typeof nativeLogin>) {
  expect(login.stages()).toEqual([
    "form-prepare",
    "form",
    "form-submit",
    "form-completed",
  ]);
  expect(login.page.logins).toEqual([
    { Username: USERNAME, Password: PASSWORD },
  ]);
  expect(login.keys()).toBe(USERNAME.length + PASSWORD.length);
  expect(login.page.nativeSubmits()).toBe(0);
  expect(
    login.signals.some((value) =>
      [USERNAME, PASSWORD].some((secret) => value.includes(secret)),
    ),
  ).toBe(false);
}

describe("Portainer sign-in with the native page client", () => {
  // A row whose host field already names the login route.
  it.each<[string, Timeline]>([
    [
      "a 2.19 page whose form comes after load end",
      { url: LOGIN_ROUTE, loadAt: 60, formAt: 200 },
    ],
    [
      "a 2.0 page whose form comes after load end",
      { url: LOGIN_ROUTE, family: "2.0", loadAt: 60, formAt: 200 },
    ],
    [
      "a hidden tab",
      { url: LOGIN_ROUTE, loadAt: 60, formAt: 200, hidden: true },
    ],
  ])("signs in at the login route: %s", async (_name, timeline) => {
    const login = nativeLogin(timeline);
    await login.outcome(4000);
    expectSignedInOnce(login);
  });

  // The saved address of a Portainer connection is its host and port. The
  // router then replaces the empty route with `#!/auth` in the same document.
  it.each<[string, Timeline, number]>([
    [
      "the form right after the route",
      {
        url: ROOT,
        route: { at: 30, kind: "hash" },
        loadAt: 60,
        formAt: 200,
      },
      4000,
    ],
    [
      "a 2.0 page",
      {
        url: ROOT,
        family: "2.0",
        route: { at: 30, kind: "hash" },
        loadAt: 60,
        formAt: 200,
      },
      4000,
    ],
    [
      "the form 1 s after load end",
      {
        url: ROOT,
        route: { at: 30, kind: "hash" },
        loadAt: 60,
        formAt: 1060,
      },
      5000,
    ],
    [
      "the form 5 s after load end",
      {
        url: ROOT,
        route: { at: 30, kind: "hash" },
        loadAt: 60,
        formAt: 5060,
      },
      9000,
    ],
    [
      "load end after the form",
      {
        url: ROOT,
        route: { at: 30, kind: "hash" },
        formAt: 120,
        loadAt: 600,
      },
      4000,
    ],
    [
      "a hidden tab",
      {
        url: ROOT,
        route: { at: 30, kind: "hash" },
        loadAt: 60,
        formAt: 200,
        hidden: true,
      },
      4000,
    ],
  ])(
    "signs in when the saved address is the root and the page routes itself to its login view: %s",
    async (_name, timeline, within) => {
      const login = nativeLogin(timeline);
      await login.outcome(within);
      expectSignedInOnce(login);
    },
    15_000,
  );

  it("signs in when a page routes to its login view through the History API", async () => {
    const login = nativeLogin({
      url: ROOT,
      route: { at: 30, kind: "history" },
      loadAt: 60,
      formAt: 200,
    });
    await login.outcome(4000);
    expectSignedInOnce(login);
  });

  // The address fence holds from the moment the form is found, whichever
  // address the document was created at.
  it.each<[string, Timeline]>([
    ["created at the login route", { url: LOGIN_ROUTE, formAt: 120 }],
    [
      "routed there from the root",
      { url: ROOT, route: { at: 30, kind: "hash" }, formAt: 120 },
    ],
  ])(
    "ends the attempt and requests no credential when the page leaves its login view before the fill: %s",
    async (_name, timeline) => {
      const login = nativeLogin({
        ...timeline,
        loadAt: 60,
        fillDelayMs: 500,
        leave: "before-fill",
      });
      expect(await login.outcome(4000)).toEqual([
        "form-prepare",
        "form-rejected|page-changed",
      ]);
      expect(login.keys()).toBe(0);
      expect(login.page.logins).toEqual([]);
      expect(login.page.field("username")?.value).toBe("");
      expect(login.page.field("password")?.value).toBe("");
    },
  );

  it("stops typing and erases what it typed when the page leaves its login view during the fill", async () => {
    const login = nativeLogin({
      url: LOGIN_ROUTE,
      loadAt: 60,
      formAt: 120,
      leave: "during-fill",
    });
    expect(await login.outcome(4000)).toEqual([
      "form-prepare",
      "form",
      "form-rejected|page-changed",
    ]);
    // The whole username and three characters of the password.
    expect(login.keys()).toBe(USERNAME.length + 3);
    expect(login.page.logins).toEqual([]);
    expect(login.page.field("username")?.value).toBe("");
    expect(login.page.field("password")?.value).toBe("");
    expect(login.page.nativeSubmits()).toBe(0);
  });
});

describe("Portainer sign-in with the legacy client", () => {
  it("signs in when the saved address is the root and the page routes itself to its login view", async () => {
    const page = portainerPage({
      url: ROOT,
      route: { at: 30, kind: "hash" },
      loadAt: 60,
      formAt: 200,
    });
    setTimeout(() => {
      if (!page.closed()) page.load();
    }, 60);
    let redeemed = 0;
    page.window.fetch = async () => {
      redeemed++;
      return {
        ok: true,
        json: async () => ({ username: USERNAME, password: PASSWORD }),
      };
    };
    page.window.eval(loadAutologinClient());
    const result = await page.window.__sorng_autologin.fetchCredsAndRun(
      "fixture-nonce",
      {
        username_selector: PORTAINER_AUTO_LOGIN_SELECTORS.usernameSelector,
        password_selector: PORTAINER_AUTO_LOGIN_SELECTORS.passwordSelector,
        submit_selector: PORTAINER_AUTO_LOGIN_SELECTORS.submitSelector,
      },
    );
    expect(result).toMatchObject({ ok: true, reason: "submitted" });
    expect(redeemed).toBe(1);
    expect(page.logins).toEqual([{ Username: USERNAME, Password: PASSWORD }]);
    expect(page.nativeSubmits()).toBe(0);
  });
});
