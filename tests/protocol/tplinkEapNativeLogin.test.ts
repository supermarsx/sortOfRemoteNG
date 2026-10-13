import { createHash } from "node:crypto";
// @ts-expect-error - no type declarations for jsdom
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
const PORTAINER_AUTO_LOGIN_SELECTORS =
  getHttpApplicationProfile("tplink-eap")!.selectors!;

const ROOT = "http://eap.test/";
const LOGIN_ROUTE = "http://eap.test/login";
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

function authView(_family: Family): string {
  return '<form id="form-login" method="post" action="/"><input id="login-username" name="username" type="text"><span class="password-wrap"><input class="password-text password-hidden" type="password"><input id="login-password" name="password" class="hidden" type="password"></span><button id="login-btn" type="button">LOGIN</button></form>';
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
    document.querySelector(
      id === "username" ? "#login-username" : "input.password-hidden",
    ) as HTMLInputElement | null;
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
      .querySelector("button#login-btn")!
      .addEventListener("click", () => {
        // `ctrl.authenticateUser()`: `loginInProgress` removes the panel and
        // the router leaves for the home view once the token is stored.
        logins.push({
          ...model,
          Password: createHash("md5")
            .update(model.Password)
            .digest("hex")
            .toUpperCase(),
        });
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
    if (event === "form-completed" || event === "form-rejected") return;
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
        signals.includes("form-completed") || signals.includes("form-rejected");
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
    {
      Username: USERNAME,
      Password: createHash("md5").update(PASSWORD).digest("hex").toUpperCase(),
    },
  ]);
  expect(login.keys()).toBe(USERNAME.length + PASSWORD.length);
  expect(login.page.nativeSubmits()).toBe(0);
  expect(
    login.signals.some((value) =>
      [USERNAME, PASSWORD].some((secret) => value.includes(secret)),
    ),
  ).toBe(false);
}

describe("native TP-Link EAP typing", () => {
  it("types real keys into the hydrated clone and lets the site hash and submit once", async () => {
    const login = nativeLogin({ url: "http://eap.test/", formAt: 50 });
    await login.outcome(4000);
    expectSignedInOnce(login);
    expect(
      login.page.document.querySelector<HTMLInputElement>("#login-password")
        ?.value ?? "",
    ).toBe("");
  });
});
