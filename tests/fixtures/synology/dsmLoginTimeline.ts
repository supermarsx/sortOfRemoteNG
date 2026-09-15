/**
 * Synthetic DSM 7.2 desktop login fixture and scripted timeline driver (t85).
 *
 * Everything here is synthetic: markup follows the reviewed DSM 7 Vue login
 * contract (`#sds-login-vue`, `form#dsm-user-fieldset`, `form#dsm-pass-fieldset`,
 * `#dsm-otp-fieldset`), and no real or Virtual DSM is involved. The account
 * values are placeholders, never real credentials.
 *
 * Consumers:
 * - vitest/jsdom (`tests/protocol/synologyLoginTimeline.test.ts`): calls
 *   `createDsmPage(window, ...)`, `installJsdomLayout(window)` and
 *   `createDsmGrantEndpoint(...)`, then `runDsmTimeline(...)` with fake timers.
 * - real-engine acceptance (plain Node, no bundler): import this file directly
 *   (Node strips the erasable types) and inject `dsmPageRuntimeSource()` into a
 *   served page, then `createDsmPage(window).apply(step)` for each timeline
 *   step. Steps that need jsdom (`readyState`, `userType`) are marked
 *   `jsdomOnly` on their timeline.
 * - e2e container: reuse `createDsmMarkup()` for static markup and the
 *   `DSM_LOGIN_TIMELINES` expectations.
 *
 * Keep `createDsmMarkup` and `createDsmPage` self-contained (no references to
 * other module bindings except `createDsmMarkup`), so their source text can be
 * shipped to a browser. This file must not import vitest or jsdom.
 */

export const DSM_SYNTHETIC_ACCOUNT = {
  username: "synthetic-dsm-user",
  password: "synthetic-dsm-password",
} as const;
export const DSM_READINESS_NONCE = "a".repeat(32);
export const DSM_CONTINUATION_NONCE = "b".repeat(32);
export const DSM_LOGIN_ASSET_PATHS = {
  helper: "src-tauri/crates/sorng-protocols/src/synology_autologin_client.js",
  client: "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  bridge:
    "src-tauri/crates/sorng-protocols/src/synology_login_progress_client.js",
  automation: "src-tauri/crates/sorng-protocols/src/web_automation_client.js",
} as const;

/** Mirror of the named budgets at the top of the page helper (milliseconds). */
export const DSM_HELPER_TIMING = {
  watchdogMs: 500,
  quietMs: 400,
  maxSettleMs: 3000,
  routeGraceMs: 2000,
  stepGraceMs: 3000,
  rejectConfirmMs: 1000,
  pageIdleMs: 60000,
  pageCapMs: 240000,
  layoutGraceMs: 45000,
  requestMs: 30000,
  submitCapMs: 85000,
  reclickMs: 8000,
  verifyMs: 30000,
  leftConfirmMs: 2000,
  desktopConfirmMs: 20000,
  maxFills: 3,
  traceLimit: 40,
} as const;

/** Best-effort DSM desktop markers, mirrored verbatim from the page helper.
 * No live DSM capture backs them: a session is only inferred from one of these
 * being visible without a login root, never from a splash or an empty "#/". */
export const DSM_DESKTOP_MARKERS =
  "#sds-desktop, #sds-taskbar, .sds-desktop, .sds-taskbar";

export type DsmReadyState = "loading" | "interactive" | "complete";
export type DsmStep =
  /** jsdom only: overrides `document.readyState` and fires its events. */
  | { type: "readyState"; value: DsmReadyState }
  /** `replace`/`push` fire no event (vue-router); `hashchange` dispatches one. */
  | { type: "route"; hash: string; via?: "replace" | "push" | "hashchange" }
  | { type: "path"; path: string }
  | { type: "splash" }
  /** An empty document body, as during a slow boot. */
  | { type: "blank" }
  /** A streamed parser insertion while the document is still loading. */
  | { type: "parserChunk" }
  | { type: "mountRoot" }
  | { type: "account"; prefill?: string }
  | { type: "rerenderAccount" }
  | { type: "replaceRoot" }
  | { type: "password"; hiddenUsername?: string }
  | { type: "otp" }
  | { type: "removeRoot" }
  | { type: "desktop" }
  | {
      type: "captcha";
      placement:
        | "root-visible"
        | "root-zero-size"
        | "root-class-only"
        | "outside-visible";
    }
  | { type: "base" }
  | {
      type: "formAttribute";
      name: "action" | "method" | "target";
      value: string;
    }
  | { type: "panelChurn" }
  | { type: "unreviewedLayout" }
  | { type: "field"; disabled?: boolean; hidden?: boolean }
  | { type: "clearField" }
  /** Needs a trusted-input implementation (jsdom helper or CDP). */
  | { type: "userType"; text: string };

export type DsmInteractiveRoute = "select-auth" | "approve" | "passkey" | "otp";
export interface DsmBehavior {
  /** What DSM does after an accepted Next click. Default: password panel. */
  next?: {
    delayMs: number;
    outcome: "password" | Exclude<DsmInteractiveRoute, "otp"> | "none";
    /** Hidden username rendered on the password panel (default: account). */
    hiddenUsername?: string;
  };
  /** Clicks lost to a Vue re-render: the Next button is replaced instead. */
  swallowNextClicks?: number;
  /** Clicks lost to a Vue re-render: the Sign in button is replaced instead. */
  swallowSignInClicks?: number;
  /** What DSM does after an accepted Sign in click. Default: desktop. */
  signIn?: {
    delayMs: number;
    outcome: "desktop" | "otp" | "approve" | "error" | "none";
  };
}
export interface DsmPageCounts {
  next: number;
  nextSwallowed: number;
  signIn: number;
  signInSwallowed: number;
  /** Sign in clicks while the field held the synthetic password. */
  signInWithPassword: number;
  otp: number;
  /** Input events observed on the username field (helper writes included). */
  usernameInputs: number;
}
export interface DsmPage {
  readonly counts: DsmPageCounts;
  apply(step: DsmStep): void;
  install(behavior: DsmBehavior): void;
  dispose(): void;
}
export interface DsmPageOptions {
  account?: { username: string; password: string };
  /** Real user typing: a jsdom trusted dispatch, or CDP in a real engine. */
  trustedInput?: (field: HTMLInputElement, text: string) => void;
}

export function createDsmMarkup() {
  function attribute(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }
  function panel(inner: string) {
    return `<div class="login-tabs-content-wrapper">${inner}</div>`;
  }
  return {
    splash: () =>
      '<div class="dsm-boot-splash" role="progressbar">Loading DSM</div>',
    root: (inner = "") => `<div id="sds-login-vue">${inner}</div>`,
    account: () =>
      panel(
        '<form id="dsm-user-fieldset"><input syno-id="username" type="text" placeholder="Username" name="username" autocomplete="username" tabindex="1"><input name="password" type="password" autocomplete="current-password" hidden></form><div role="button" syno-id="account-panel-next-btn" class="login-btn">Next</div>',
      ),
    password: (username: string) =>
      panel(
        `<form id="dsm-pass-fieldset"><input name="username" autocomplete="username" hidden value="${attribute(username)}"><input syno-id="password" type="password" placeholder="Password" name="current-password" autocomplete="current-password" tabindex="1"></form><div role="button" syno-id="password-panel-next-btn" class="login-btn">Sign in</div>`,
      ),
    otp: () =>
      panel(
        '<div id="dsm-otp-fieldset"><input type="text" name="one-time-code" autocomplete="one-time-code"><input type="checkbox" name="trust-device"></div><div role="button" syno-id="otp-panel-next-btn">Verify</div>',
      ),
    interactive: (route: string) =>
      panel(
        `<div class="login-step" data-step="${attribute(route)}">Continue on your device</div>`,
      ),
    unreviewed: () =>
      panel(
        '<form id="custom-login"><input name="user" type="text"><input name="pass" type="password"></form><div role="button" class="login-btn">Log in</div>',
      ),
    desktop: () =>
      '<div id="sds-desktop" class="sds-desktop"><div id="sds-taskbar" class="sds-taskbar">Main Menu</div></div>',
    error: () =>
      '<div class="login-error-msg" role="alert">The account or password is invalid.</div>',
  };
}

/** Page-side DSM simulator. Uses only `win`; safe to ship as source text. */
export function createDsmPage(win: Window, options: DsmPageOptions = {}) {
  const doc = win.document;
  const view = win as unknown as {
    Event: typeof Event;
    HashChangeEvent: typeof HashChangeEvent;
    HTMLInputElement: typeof HTMLInputElement;
  };
  const markup = createDsmMarkup();
  const account = options.account ?? {
    username: "synthetic-dsm-user",
    password: "synthetic-dsm-password",
  };
  const counts: DsmPageCounts = {
    next: 0,
    nextSwallowed: 0,
    signIn: 0,
    signInSwallowed: 0,
    signInWithPassword: 0,
    otp: 0,
    usernameInputs: 0,
  };
  const timers: number[] = [];
  const added: Element[] = [];
  let behavior: DsmBehavior = {};
  let swallowNext = 0;
  let swallowSignIn = 0;
  const setValue = (field: HTMLInputElement, value: string) =>
    Object.getOwnPropertyDescriptor(
      view.HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
  const root = () => doc.querySelector("#sds-login-vue");
  const ensureRoot = () => {
    const current = root();
    if (current) return current;
    doc.body.innerHTML = markup.root();
    return root()!;
  };
  const form = () =>
    doc.querySelector<HTMLFormElement>(
      "form#dsm-pass-fieldset, form#dsm-user-fieldset",
    );
  const field = () =>
    doc.querySelector<HTMLInputElement>(
      '[syno-id="password"], [syno-id="username"]',
    );
  const later = (ms: number, action: () => void) => {
    timers.push(win.setTimeout(action, ms));
  };
  const route = (hash: string, via: "replace" | "push" | "hashchange") => {
    const url = win.location.pathname + win.location.search + hash;
    if (via === "push") win.history.pushState(null, "", url);
    else win.history.replaceState(null, "", url);
    if (via === "hashchange")
      win.dispatchEvent(new view.HashChangeEvent("hashchange"));
  };
  const replaceButton = (button: Element) =>
    button.replaceWith(button.cloneNode(true));
  function onClick(event: Event) {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    const next = target.closest('[syno-id="account-panel-next-btn"]');
    if (next) {
      if (swallowNext > 0) {
        swallowNext--;
        counts.nextSwallowed++;
        replaceButton(next);
        return;
      }
      counts.next++;
      const plan = behavior.next ?? { delayMs: 300, outcome: "password" };
      later(plan.delayMs, () => {
        if (plan.outcome === "none") return;
        if (plan.outcome === "password") {
          route("#/signin/password", "push");
          ensureRoot().innerHTML = markup.password(
            plan.hiddenUsername ?? account.username,
          );
        } else {
          route(`#/signin/${plan.outcome}`, "push");
          ensureRoot().innerHTML = markup.interactive(plan.outcome);
        }
      });
      return;
    }
    const signIn = target.closest('[syno-id="password-panel-next-btn"]');
    if (signIn) {
      if (swallowSignIn > 0) {
        swallowSignIn--;
        counts.signInSwallowed++;
        replaceButton(signIn);
        return;
      }
      counts.signIn++;
      if (field()?.value === account.password) counts.signInWithPassword++;
      const plan = behavior.signIn ?? { delayMs: 1500, outcome: "desktop" };
      signIn.classList.add("spin");
      later(plan.delayMs, () => {
        signIn.classList.remove("spin");
        if (plan.outcome === "desktop") {
          root()?.remove();
          route("#/", "replace");
          doc.body.insertAdjacentHTML("beforeend", markup.desktop());
        } else if (plan.outcome === "otp" || plan.outcome === "approve") {
          route(`#/signin/${plan.outcome}`, "push");
          ensureRoot().innerHTML =
            plan.outcome === "otp"
              ? markup.otp()
              : markup.interactive(plan.outcome);
        } else if (plan.outcome === "error") {
          const current = field();
          if (current) setValue(current, "");
          doc
            .querySelector(".login-tabs-content-wrapper")
            ?.insertAdjacentHTML("beforeend", markup.error());
        }
      });
      return;
    }
    if (target.closest('[syno-id="otp-panel-next-btn"]')) counts.otp++;
  }
  function onInput(event: Event) {
    const target = event.target as Element | null;
    if (target && target.matches?.('[syno-id="username"]'))
      counts.usernameInputs++;
  }
  doc.addEventListener("click", onClick);
  doc.addEventListener("input", onInput, true);
  function apply(step: DsmStep) {
    switch (step.type) {
      case "readyState": {
        Object.defineProperty(doc, "readyState", {
          configurable: true,
          get: () => step.value,
        });
        doc.dispatchEvent(new view.Event("readystatechange"));
        if (step.value === "interactive")
          doc.dispatchEvent(new view.Event("DOMContentLoaded"));
        if (step.value === "complete")
          win.dispatchEvent(new view.Event("load"));
        return;
      }
      case "route":
        return route(step.hash, step.via ?? "replace");
      case "path":
        win.history.pushState(null, "", step.path);
        return;
      case "splash":
        doc.body.innerHTML = markup.splash();
        return;
      case "blank":
        doc.body.innerHTML = "";
        return;
      case "parserChunk": {
        const chunk = doc.createElement("div");
        chunk.setAttribute("data-dsm-chunk", "");
        doc.body.append(chunk);
        return;
      }
      case "mountRoot":
        doc.body.innerHTML = markup.root();
        return;
      case "account": {
        ensureRoot().innerHTML = markup.account();
        if (step.prefill !== undefined) setValue(field()!, step.prefill);
        return;
      }
      case "rerenderAccount":
        ensureRoot().innerHTML = markup.account();
        return;
      case "replaceRoot": {
        const current = root();
        if (!current) return;
        const next = doc.createElement("div");
        next.innerHTML = current.outerHTML;
        current.replaceWith(next.firstElementChild!);
        return;
      }
      case "password":
        ensureRoot().innerHTML = markup.password(
          step.hiddenUsername ?? account.username,
        );
        return;
      case "otp":
        ensureRoot().innerHTML = markup.otp();
        return;
      case "removeRoot":
        root()?.remove();
        return;
      case "desktop":
        doc.body.innerHTML = markup.desktop();
        return;
      case "captcha": {
        const html =
          step.placement === "root-zero-size"
            ? '<div class="login-captcha-wrapper" style="width:0;height:0;overflow:hidden"><input name="captcha" type="text"></div>'
            : step.placement === "root-class-only"
              ? '<div class="captcha-panel">Security check</div>'
              : '<input name="captcha" type="text">';
        const host =
          step.placement === "outside-visible"
            ? doc.body
            : step.placement === "root-visible"
              ? (form() ?? ensureRoot())
              : ensureRoot();
        host.insertAdjacentHTML("beforeend", html);
        return;
      }
      case "base": {
        const base = doc.createElement("base");
        base.setAttribute("href", "/");
        doc.head.append(base);
        added.push(base);
        return;
      }
      case "formAttribute":
        form()?.setAttribute(step.name, step.value);
        return;
      case "panelChurn":
        doc
          .querySelector(".login-tabs-content-wrapper")
          ?.classList.toggle("is-busy");
        return;
      case "unreviewedLayout":
        ensureRoot().innerHTML = markup.unreviewed();
        return;
      case "field": {
        const current = field();
        if (!current) return;
        if (step.disabled !== undefined) current.disabled = step.disabled;
        if (step.hidden !== undefined) current.hidden = step.hidden;
        return;
      }
      case "clearField": {
        const current = field();
        if (current) setValue(current, "");
        return;
      }
      case "userType": {
        const current = field();
        if (!current || !options.trustedInput)
          throw new Error("userType needs a login field and trusted input");
        options.trustedInput(current, step.text);
        return;
      }
    }
  }
  const page: DsmPage = {
    counts,
    apply,
    install(next: DsmBehavior) {
      behavior = next;
      swallowNext = next.swallowNextClicks ?? 0;
      swallowSignIn = next.swallowSignInClicks ?? 0;
    },
    dispose() {
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("input", onInput, true);
      timers.forEach((timer) => win.clearTimeout(timer));
      added.forEach((element) => element.remove());
      Reflect.deleteProperty(doc, "readyState");
    },
  };
  return page;
}

/** Browser-injectable source defining `createDsmMarkup` and `createDsmPage`.
 * Call it from plain Node (type stripping), not from a transformed bundle. */
export function dsmPageRuntimeSource() {
  return `var createDsmMarkup = ${createDsmMarkup.toString()};\nvar createDsmPage = ${createDsmPage.toString()};\n`;
}

export interface DsmGrantEndpoint {
  fetch(
    input: string,
    init?: { signal?: AbortSignal | null },
  ): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  readonly requests: { username: number; password: number; refused: number };
}
/** One-shot stand-in for `/__sortofremoteng_autologin`: one username grant
 * for the readiness nonce, then one password grant for its continuation. */
export function createDsmGrantEndpoint(options: {
  schedule: (action: () => void, ms: number) => unknown;
  usernameDelayMs?: number;
  passwordDelayMs?: number;
  account?: { username: string; password: string };
}): DsmGrantEndpoint {
  const account = options.account ?? DSM_SYNTHETIC_ACCOUNT;
  const requests = { username: 0, password: 0, refused: 0 };
  let usernameSpent = false;
  let passwordSpent = false;
  const refuse = () => {
    requests.refused++;
    return Promise.resolve({
      ok: false,
      status: 403,
      json: () => Promise.reject(new Error("refused")),
    });
  };
  return {
    requests,
    fetch(input, init) {
      const url = new URL(input, "http://127.0.0.1/");
      if (url.pathname !== "/__sortofremoteng_autologin") return refuse();
      const passwordStage = url.searchParams.get("phase") === "password";
      const nonce = url.searchParams.get("nonce");
      if (passwordStage) requests.password++;
      else requests.username++;
      let body: object;
      if (!passwordStage && nonce === DSM_READINESS_NONCE && !usernameSpent) {
        usernameSpent = true;
        body = {
          loginFlow: "synology",
          username: account.username,
          continuation: DSM_CONTINUATION_NONCE,
        };
      } else if (
        passwordStage &&
        nonce === DSM_CONTINUATION_NONCE &&
        usernameSpent &&
        !passwordSpent
      ) {
        passwordSpent = true;
        body = { loginFlow: "synology", password: account.password };
      } else return refuse();
      const delay =
        (passwordStage ? options.passwordDelayMs : options.usernameDelayMs) ??
        0;
      const response = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...body }),
      };
      if (delay <= 0) return Promise.resolve(response);
      return new Promise((resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        options.schedule(() => {
          signal?.removeEventListener("abort", abort);
          resolve(response);
        }, delay);
      });
    },
  };
}

type LayoutWindow = Window & {
  HTMLElement: typeof HTMLElement;
};
/** jsdom has no layout. Every element is a 120x28 box at the origin unless
 * hidden (`hidden`, `display:none`/`visibility:hidden` on it or an ancestor,
 * detached) or zero-sized by its own inline `width:0`/`height:0`. As in
 * Chromium, a zero-size ancestor does not shrink its children; only a
 * clipping (`overflow`) ancestor hides them. Returns a restore. */
export function installJsdomLayout(win: Window): () => void {
  const proto = (win as LayoutWindow).HTMLElement.prototype;
  const offsetParent = Object.getOwnPropertyDescriptor(proto, "offsetParent");
  const clientRects = Object.getOwnPropertyDescriptor(proto, "getClientRects");
  const boundingRect = Object.getOwnPropertyDescriptor(
    proto,
    "getBoundingClientRect",
  );
  const walk = (
    element: Element,
    test: (style: CSSStyleDeclaration) => boolean,
  ) => {
    for (let node: Element | null = element; node; node = node.parentElement)
      if ((node as HTMLElement).style && test((node as HTMLElement).style))
        return true;
    return false;
  };
  const hidden = (element: Element) =>
    !element.isConnected ||
    element.closest("[hidden]") !== null ||
    walk(
      element,
      (style) => style.display === "none" || style.visibility === "hidden",
    );
  const zero = (element: Element) => {
    const style = (element as HTMLElement).style;
    return !!style && (style.width === "0px" || style.height === "0px");
  };
  const box = (element: Element) => {
    const size = hidden(element) ? 0 : zero(element) ? 0 : 1;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 120 * size,
      height: 28 * size,
      right: 120 * size,
      bottom: 28 * size,
    };
  };
  Object.defineProperty(proto, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return hidden(this) ? null : this.ownerDocument.body;
    },
  });
  Object.defineProperty(proto, "getClientRects", {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      return hidden(this) ? [] : [box(this)];
    },
  });
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      return box(this);
    },
  });
  return () => {
    for (const [name, descriptor] of [
      ["offsetParent", offsetParent],
      ["getClientRects", clientRects],
      ["getBoundingClientRect", boundingRect],
    ] as const) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else Reflect.deleteProperty(proto, name);
    }
  };
}

/** jsdom only: dispatches `event` with `isTrusted === true`, as a real user
 * gesture would. Uses jsdom's implementation objects; test use only. */
export function dispatchTrustedJsdom(target: EventTarget, event: Event) {
  const impl = (value: object) =>
    Object.getOwnPropertySymbols(value).find(
      (symbol) => String(symbol) === "Symbol(impl)",
    );
  const eventImpl = impl(event);
  const targetImpl = impl(target);
  if (!eventImpl || !targetImpl)
    throw new Error("Trusted dispatch needs jsdom implementation objects");
  const internal = (event as unknown as Record<symbol, { isTrusted: boolean }>)[
    eventImpl
  ];
  internal.isTrusted = true;
  return (
    target as unknown as Record<symbol, { _dispatch(event: unknown): boolean }>
  )[targetImpl]._dispatch(internal);
}

/** jsdom only: a trusted keystroke plus trusted input, like a user typing. */
export function typeAsUserJsdom(field: HTMLInputElement, text: string) {
  const win = field.ownerDocument.defaultView as Window & {
    KeyboardEvent: typeof KeyboardEvent;
    InputEvent: typeof InputEvent;
  };
  dispatchTrustedJsdom(
    field,
    new win.KeyboardEvent("keydown", { key: text.charAt(0), bubbles: true }),
  );
  field.value = field.value + text;
  dispatchTrustedJsdom(
    field,
    new win.InputEvent("input", { bubbles: true, data: text }),
  );
}

export interface DsmTimeline {
  name: string;
  summary: string;
  /** Start path and hash, default `/`. */
  path?: string;
  /** Initial `document.readyState`, default `complete`. */
  readyState?: DsmReadyState;
  /** Applied before the helper starts. */
  initial: readonly DsmStep[];
  /** Applied at `at` ms after the helper starts. */
  steps: readonly { at: number; step: DsmStep }[];
  behavior: DsmBehavior;
  grant?: { usernameDelayMs?: number; passwordDelayMs?: number };
  /** Virtual time from helper start to the final assertion. */
  runMs: number;
  /** Needs jsdom-only steps (`readyState`, `userType`). */
  jsdomOnly?: boolean;
  expected: {
    phase: string;
    reason: string;
    usernameRequests: number;
    passwordRequests: number;
    signInClicks: number;
    nextClicks?: number;
    /** Interactive route class reported by the helper trace. */
    handoff?: DsmInteractiveRoute | "other" | null;
    /** Reasons that must appear somewhere in the helper trace. */
    traceReasons?: readonly string[];
    usernameInputs?: number;
  };
}

const signedIn = {
  phase: "signed_in",
  reason: "left-signin-page",
  usernameRequests: 1,
  passwordRequests: 1,
  signInClicks: 1,
} as const;

/** Scripted DSM boot/sign-in timelines with the helper outcome each must reach. */
export const DSM_LOGIN_TIMELINES: readonly DsmTimeline[] = [
  {
    name: "slow-load",
    summary:
      "document streams for 70s, turns interactive, controls render at 95s (past the old 90s budget); load never fires",
    readyState: "loading",
    jsdomOnly: true,
    initial: [{ type: "splash" }],
    steps: [
      { at: 20000, step: { type: "parserChunk" } },
      { at: 45000, step: { type: "parserChunk" } },
      { at: 65000, step: { type: "parserChunk" } },
      { at: 70000, step: { type: "readyState", value: "interactive" } },
      { at: 94000, step: { type: "route", hash: "#/" } },
      { at: 95000, step: { type: "route", hash: "#/signin", via: "push" } },
      { at: 95000, step: { type: "account" } },
    ],
    behavior: {},
    runMs: 102000,
    expected: signedIn,
  },
  {
    name: "vue-router-slash-normalisation",
    summary:
      "hash '' becomes '#/' by replaceState while the app mounts, then '#/signin' without any hashchange",
    initial: [{ type: "splash" }],
    steps: [
      { at: 50, step: { type: "route", hash: "#/" } },
      { at: 60, step: { type: "mountRoot" } },
      { at: 1200, step: { type: "route", hash: "#/signin" } },
      { at: 1250, step: { type: "account" } },
    ],
    behavior: {},
    runMs: 7000,
    expected: signedIn,
  },
  {
    name: "redirect-route-churn",
    summary: "route guards bounce between '#/', '#/signin' and '#/signin/'",
    initial: [{ type: "splash" }],
    steps: [
      { at: 100, step: { type: "route", hash: "#/" } },
      { at: 300, step: { type: "route", hash: "#/signin", via: "hashchange" } },
      { at: 500, step: { type: "route", hash: "#/", via: "push" } },
      { at: 700, step: { type: "route", hash: "#/signin/", via: "push" } },
      { at: 800, step: { type: "mountRoot" } },
      { at: 900, step: { type: "route", hash: "#/signin" } },
      { at: 1000, step: { type: "account" } },
    ],
    behavior: {},
    runMs: 7000,
    expected: signedIn,
  },
  {
    name: "splash-mount-account-root-replaced-during-username-fetch",
    summary:
      "splash, empty mount, account panel, then the whole root is replaced while the username request is in flight",
    path: "/#/signin",
    initial: [{ type: "splash" }],
    steps: [
      { at: 500, step: { type: "mountRoot" } },
      { at: 1500, step: { type: "account" } },
      { at: 2400, step: { type: "replaceRoot" } },
    ],
    grant: { usernameDelayMs: 1000 },
    behavior: {},
    runMs: 10000,
    expected: { ...signedIn, traceReasons: ["controls-replaced"] },
  },
  {
    name: "rerender-after-username-fill",
    summary: "the account panel re-renders after the fill and drops the value",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [{ at: 600, step: { type: "rerenderAccount" } }],
    behavior: {},
    runMs: 7000,
    expected: { ...signedIn, traceReasons: ["value-refilled"] },
  },
  {
    name: "next-swallowed-by-button-replacement",
    summary:
      "the first Next click is lost to a button re-render; Next is clicked again once after 8s",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { swallowNextClicks: 1 },
    runMs: 15000,
    expected: {
      ...signedIn,
      nextClicks: 1,
      traceReasons: ["next-reclicked"],
    },
  },
  {
    name: "slow-password-panel",
    summary: "the password panel appears 20s after Next",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { next: { delayMs: 20000, outcome: "password" } },
    runMs: 27000,
    expected: signedIn,
  },
  {
    name: "load-never-fires",
    summary:
      "a slow image holds the load event; ready controls proceed while interactive",
    path: "/#/signin",
    readyState: "interactive",
    jsdomOnly: true,
    initial: [{ type: "account" }],
    steps: [],
    behavior: {},
    runMs: 7000,
    expected: signedIn,
  },
  {
    name: "prefilled-identical-username",
    summary: "DSM remembered the same username; it is accepted without a write",
    path: "/#/signin",
    initial: [{ type: "account", prefill: "synthetic-dsm-user" }],
    steps: [],
    behavior: {},
    runMs: 7000,
    expected: { ...signedIn, usernameInputs: 0 },
  },
  {
    name: "prefilled-different-username",
    summary: "a page or browser prefill with another value is overwritten once",
    path: "/#/signin",
    initial: [{ type: "account", prefill: "someone-else" }],
    steps: [],
    behavior: {},
    runMs: 7000,
    expected: { ...signedIn, usernameInputs: 1 },
  },
  {
    name: "quickconnect-slow-boot-splash",
    summary:
      "a QuickConnect-style boot shows a splash on '#/' with no login root for 35s, then the login form",
    path: "/#/",
    initial: [{ type: "splash" }],
    steps: [
      { at: 35000, step: { type: "route", hash: "#/signin", via: "push" } },
      { at: 35000, step: { type: "account" } },
    ],
    behavior: {},
    runMs: 42000,
    expected: signedIn,
  },
  {
    name: "empty-slash-without-desktop-marker",
    summary:
      "an empty '#/' page with no login root and no desktop marker is never treated as signed in",
    path: "/#/",
    initial: [{ type: "blank" }],
    steps: [],
    behavior: {},
    runMs: 60000,
    expected: {
      phase: "timeout",
      reason: "page-never-ready",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "already-signed-in-desktop",
    summary:
      "the DSM desktop marker is shown without a login root; no credential is requested",
    path: "/#/",
    initial: [{ type: "desktop" }],
    steps: [],
    behavior: {},
    runMs: 20000,
    expected: {
      phase: "signed_in",
      reason: "no-sign-in-page",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "zero-size-and-outside-captcha-markup",
    summary:
      "a zero-size captcha input, a captcha-class panel and a captcha outside the login root do not stop",
    path: "/#/signin",
    initial: [
      { type: "account" },
      { type: "captcha", placement: "root-zero-size" },
      { type: "captcha", placement: "root-class-only" },
      { type: "captcha", placement: "outside-visible" },
    ],
    steps: [],
    behavior: {},
    runMs: 7000,
    expected: signedIn,
  },
  {
    name: "base-element",
    summary: "a <base> element is not a stop",
    path: "/#/signin",
    initial: [{ type: "base" }, { type: "account" }],
    steps: [],
    behavior: {},
    runMs: 7000,
    expected: signedIn,
  },
  {
    name: "post-submit-otp-hand-off",
    summary:
      "2FA: after Sign in DSM routes to the OTP panel; the helper hands off",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { signIn: { delayMs: 1200, outcome: "otp" } },
    runMs: 7000,
    expected: {
      phase: "stopped",
      reason: "interactive-step-required",
      usernameRequests: 1,
      passwordRequests: 1,
      signInClicks: 1,
      handoff: "otp",
    },
  },
  {
    name: "post-submit-secure-signin-approval",
    summary: "Secure SignIn: after Sign in DSM waits for approval",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { signIn: { delayMs: 1200, outcome: "approve" } },
    runMs: 7000,
    expected: {
      phase: "stopped",
      reason: "interactive-step-required",
      usernameRequests: 1,
      passwordRequests: 1,
      signInClicks: 1,
      handoff: "approve",
    },
  },
  {
    name: "post-submit-rejected",
    summary: "DSM clears the password and shows an error",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { signIn: { delayMs: 1200, outcome: "error" } },
    runMs: 7000,
    expected: {
      phase: "rejected",
      reason: "error-visible",
      usernameRequests: 1,
      passwordRequests: 1,
      signInClicks: 1,
    },
  },
  {
    name: "post-submit-splash-rerender",
    summary:
      "after Sign in the login root is briefly replaced by a splash on the password route, then re-rendered",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [
      { at: 2500, step: { type: "splash" } },
      { at: 7500, step: { type: "password" } },
    ],
    behavior: { signIn: { delayMs: 1200, outcome: "none" } },
    runMs: 33000,
    expected: {
      phase: "submitted",
      reason: "sign-in-unconfirmed",
      usernameRequests: 1,
      passwordRequests: 1,
      signInClicks: 1,
    },
  },
  {
    name: "post-submit-brief-slash-splash",
    summary:
      "after Sign in a splash on '#/' lasts under the confirmation window before the login page returns",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [
      { at: 2500, step: { type: "route", hash: "#/" } },
      { at: 2500, step: { type: "splash" } },
      {
        at: 4000,
        step: { type: "route", hash: "#/signin/password", via: "push" },
      },
      { at: 4000, step: { type: "password" } },
    ],
    behavior: { signIn: { delayMs: 1200, outcome: "none" } },
    runMs: 33000,
    expected: {
      phase: "submitted",
      reason: "sign-in-unconfirmed",
      usernameRequests: 1,
      passwordRequests: 1,
      signInClicks: 1,
    },
  },
  {
    name: "post-submit-unconfirmed",
    summary: "nothing observable happens after Sign in for 30s",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { signIn: { delayMs: 1200, outcome: "none" } },
    runMs: 33000,
    expected: {
      phase: "submitted",
      reason: "sign-in-unconfirmed",
      usernameRequests: 1,
      passwordRequests: 1,
      signInClicks: 1,
    },
  },
  {
    name: "visible-captcha-in-login-root",
    summary: "a visible captcha input inside the login form stops",
    path: "/#/signin",
    initial: [
      { type: "account" },
      { type: "captcha", placement: "root-visible" },
    ],
    steps: [],
    behavior: {},
    runMs: 1000,
    expected: {
      phase: "stopped",
      reason: "captcha-required",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "select-auth-after-next",
    summary: "DSM asks to select a sign-in method after Next",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { next: { delayMs: 300, outcome: "select-auth" } },
    runMs: 3000,
    expected: {
      phase: "stopped",
      reason: "interactive-step-required",
      usernameRequests: 1,
      passwordRequests: 0,
      signInClicks: 0,
      handoff: "select-auth",
    },
  },
  {
    name: "passkey-after-next",
    summary: "DSM asks for a passkey after Next",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: { next: { delayMs: 300, outcome: "passkey" } },
    runMs: 3000,
    expected: {
      phase: "stopped",
      reason: "interactive-step-required",
      usernameRequests: 1,
      passwordRequests: 0,
      signInClicks: 0,
      handoff: "passkey",
    },
  },
  {
    name: "trusted-user-keystroke",
    summary: "the user starts typing before the helper acts",
    path: "/#/signin",
    jsdomOnly: true,
    initial: [{ type: "account" }],
    steps: [{ at: 100, step: { type: "userType", text: "m" } }],
    behavior: {},
    runMs: 2000,
    expected: {
      phase: "stopped",
      reason: "user-input-detected",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "foreign-form-action",
    summary: "the account form posts elsewhere",
    path: "/#/signin",
    initial: [
      { type: "account" },
      {
        type: "formAttribute",
        name: "action",
        value: "https://other.invalid/",
      },
    ],
    steps: [],
    behavior: {},
    runMs: 1000,
    expected: {
      phase: "stopped",
      reason: "unsafe-form-target",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "hidden-username-mismatch",
    summary: "the password panel is for another account",
    path: "/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: {
      next: { delayMs: 300, outcome: "password", hiddenUsername: "admin" },
    },
    runMs: 3000,
    expected: {
      phase: "stopped",
      reason: "account-mismatch",
      usernameRequests: 1,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "unsupported-login-path",
    summary: "a reverse-proxy portal path is not a reviewed DSM path",
    path: "/dsm/#/signin",
    initial: [{ type: "account" }],
    steps: [],
    behavior: {},
    runMs: 0,
    expected: {
      phase: "stopped",
      reason: "unsupported-login-path",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "left-login-page",
    summary: "the document path changes and stays changed past the grace",
    path: "/#/signin",
    initial: [{ type: "mountRoot" }],
    steps: [{ at: 100, step: { type: "path", path: "/other/#/signin" } }],
    behavior: {},
    runMs: 3100,
    expected: {
      phase: "stopped",
      reason: "left-login-page",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "layout-unrecognized",
    summary: "the login root renders a layout without the reviewed controls",
    path: "/#/signin",
    initial: [{ type: "mountRoot" }, { type: "unreviewedLayout" }],
    steps: [],
    behavior: {},
    runMs: 45000,
    expected: {
      phase: "stopped",
      reason: "layout-unrecognized",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "page-never-appears",
    summary: "only the boot splash, with no progress for 60s",
    path: "/#/signin",
    initial: [{ type: "splash" }],
    steps: [],
    behavior: {},
    runMs: 60000,
    expected: {
      phase: "timeout",
      reason: "page-never-ready",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
  {
    name: "login-form-never-ready",
    summary: "the reviewed controls stay disabled with no progress for 60s",
    path: "/#/signin",
    initial: [{ type: "account" }, { type: "field", disabled: true }],
    steps: [],
    behavior: {},
    runMs: 60000,
    expected: {
      phase: "timeout",
      reason: "login-form-never-appeared",
      usernameRequests: 0,
      passwordRequests: 0,
      signInClicks: 0,
    },
  },
];

/** Applies a timeline to a page: initial steps, `begin()`, then each step at
 * its time using `advance(ms)` (fake timers in jsdom, real waits elsewhere).
 * Resolves after `runMs`; the helper's own promise is deliberately not awaited. */
export async function runDsmTimeline(
  timeline: DsmTimeline,
  page: DsmPage,
  begin: () => unknown,
  advance: (ms: number) => Promise<unknown>,
) {
  page.install(timeline.behavior);
  if (timeline.readyState)
    page.apply({ type: "readyState", value: timeline.readyState });
  timeline.initial.forEach((step) => page.apply(step));
  void begin();
  let now = 0;
  for (const { at, step } of timeline.steps) {
    if (at > now) await advance(at - now);
    now = Math.max(now, at);
    page.apply(step);
  }
  if (timeline.runMs > now) await advance(timeline.runMs - now);
}
