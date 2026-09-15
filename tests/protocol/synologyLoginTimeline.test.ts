import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";
import {
  DSM_HELPER_TIMING as timing,
  DSM_LOGIN_ASSET_PATHS,
  DSM_LOGIN_TIMELINES,
  DSM_CONTINUATION_NONCE,
  DSM_DESKTOP_MARKERS,
  DSM_READINESS_NONCE,
  DSM_SYNTHETIC_ACCOUNT as account,
  createDsmGrantEndpoint,
  createDsmPage,
  dsmPageRuntimeSource,
  installJsdomLayout,
  runDsmTimeline,
  typeAsUserJsdom,
  type DsmGrantEndpoint,
  type DsmPage,
  type DsmTimeline,
} from "../fixtures/synology/dsmLoginTimeline";

// Simulated DSM boot and sign-in timelines against the production page
// helper, with fake timers. Synthetic markup and accounts only.
const helper = readFileSync(DSM_LOGIN_ASSET_PATHS.helper, "utf8");
const client = readFileSync(DSM_LOGIN_ASSET_PATHS.client, "utf8");
const automation = readFileSync(DSM_LOGIN_ASSET_PATHS.automation, "utf8");

interface Trace {
  steps: { t: number; phase: string; reason: string }[];
  fingerprint: Record<string, number | string>;
  handoff: string | null;
}
type Progress = { phase: string; reason: string; trace: Trace };
const win = window as unknown as {
  __sorng_autologin: {
    fetchCredsAndRun(
      nonce: string,
      selectors: null,
      loginFlow: string,
    ): Promise<unknown>;
    cancel(): void;
  };
  __sorng_synology_login: {
    cancel(): void;
    getStatus(): { phase: string; reason: string };
    getTrace(): Trace;
  };
  __autologin_last?: { ok: boolean; reason: string };
};
const terminal = [
  "submitted",
  "timeout",
  "stopped",
  "cancelled",
  "signed_in",
  "rejected",
];
let page: DsmPage;
let grant: DsmGrantEndpoint;
let restoreLayout: () => void;
let events: Progress[];
let originalParent: PropertyDescriptor | undefined;
// Page listeners added by individual tests are removed with this signal.
let listeners: AbortController;
const record = (event: Event) =>
  events.push((event as CustomEvent<Progress>).detail);
const last = <T>(values: readonly T[]) => values[values.length - 1];
const status = () => win.__sorng_synology_login.getStatus();
const trace = () => win.__sorng_synology_login.getTrace();
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const begin = () =>
  win.__sorng_autologin.fetchCredsAndRun(DSM_READINESS_NONCE, null, "synology");
const timeline = (name: string) =>
  DSM_LOGIN_TIMELINES.find((value) => value.name === name)!;

function load(
  path = "/#/signin",
  grantOptions: DsmTimeline["grant"] = {},
): void {
  history.replaceState(null, "", path);
  grant = createDsmGrantEndpoint({
    schedule: (action, ms) => setTimeout(action, ms),
    ...grantOptions,
  });
  vi.stubGlobal("fetch", grant.fetch);
  window.eval(helper);
  window.eval(client);
  page = createDsmPage(window, { trustedInput: typeAsUserJsdom });
}
async function play(value: DsmTimeline, runMs = value.runMs) {
  load(value.path ?? "/", value.grant);
  await runDsmTimeline({ ...value, runMs }, page, begin, advance);
}
function field(stage: "username" | "password") {
  return document.querySelector<HTMLInputElement>(`[syno-id="${stage}"]`);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Autologin results post to the parent; keep timer accounting to the helper.
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  restoreLayout = installJsdomLayout(window);
  listeners = new AbortController();
  events = [];
  document.addEventListener("sorng_synology_login_progress", record);
});
afterEach(() => {
  win.__sorng_autologin?.cancel();
  for (const name of ["pagehide", "unload"]) {
    if (win.__sorng_autologin)
      window.removeEventListener(name, win.__sorng_autologin.cancel);
    if (win.__sorng_synology_login)
      window.removeEventListener(name, win.__sorng_synology_login.cancel);
  }
  document.removeEventListener("sorng_synology_login_progress", record);
  listeners.abort();
  page?.dispose();
  restoreLayout();
  if (originalParent) Object.defineProperty(window, "parent", originalParent);
  originalParent = undefined;
  Reflect.deleteProperty(win, "__sorng_autologin");
  Reflect.deleteProperty(win, "__sorng_synology_login");
  Reflect.deleteProperty(win, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scripted DSM login timelines", () => {
  it.each(DSM_LOGIN_TIMELINES.map((value) => [value.name, value] as const))(
    "%s",
    async (_name, value) => {
      await play(value);
      const { expected } = value;
      expect(status()).toEqual({
        phase: expected.phase,
        reason: expected.reason,
      });
      // One grant per stage; the fixture refuses any repeated request.
      expect(grant.requests).toEqual({
        username: expected.usernameRequests,
        password: expected.passwordRequests,
        refused: 0,
      });
      expect(page.counts.signIn).toBe(expected.signInClicks);
      expect(page.counts.signInWithPassword).toBe(expected.signInClicks);
      if (expected.nextClicks !== undefined)
        expect(page.counts.next).toBe(expected.nextClicks);
      if (expected.usernameInputs !== undefined)
        expect(page.counts.usernameInputs).toBe(expected.usernameInputs);
      expect(trace().handoff).toBe(expected.handoff ?? null);
      const reasons = trace().steps.map((step) => step.reason);
      for (const reason of expected.traceReasons ?? [])
        expect(reasons).toContain(reason);
      if (!expected.signInClicks)
        expect(field("password")?.value ?? "").toBe("");
      expect(last(events)).toMatchObject({
        phase: expected.phase,
        reason: expected.reason,
      });
      // Nothing terminal (such as an early signed_in) precedes the outcome.
      expect(
        events.slice(0, -1).filter((event) => terminal.includes(event.phase)),
      ).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ["layout-unrecognized", "waiting_account_form"],
    ["page-never-appears", "waiting_root"],
    ["login-form-never-ready", "waiting_account_editable"],
    ["already-signed-in-desktop", "waiting_root"],
    ["empty-slash-without-desktop-marker", "waiting_root"],
  ])(
    "%s waits for its whole budget before the terminal status",
    async (name, waiting) => {
      const value = timeline(name);
      await play(value, value.runMs - 1);
      expect(status().phase).toBe(waiting);
      await advance(1);
      expect(status()).toEqual({
        phase: value.expected.phase,
        reason: value.expected.reason,
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps waiting through a 35s QuickConnect splash on '#/' without claiming a session", async () => {
    // The scripted login form arrives at 35s; stop just before it.
    await play(
      { ...timeline("quickconnect-slow-boot-splash"), steps: [] },
      34999,
    );
    expect(status()).toEqual({ phase: "waiting_root", reason: "root-missing" });
    expect(trace().steps.map((step) => step.phase)).not.toContain("signed_in");
    expect(grant.requests.username).toBe(0);
    page.apply({ type: "route", hash: "#/signin", via: "push" });
    page.apply({ type: "account" });
    await advance(7000);
    expect(status()).toEqual({
      phase: "signed_in",
      reason: "left-signin-page",
    });
    expect(grant.requests).toEqual({ username: 1, password: 1, refused: 0 });
  });

  it("uses the helper's own desktop markers as the only session evidence", async () => {
    expect(helper).toContain(`"${DSM_DESKTOP_MARKERS}"`);
    // A visible marker alone confirms sign-in after Sign in; no wait needed.
    load();
    page.install({ signIn: { delayMs: 1200, outcome: "desktop" } });
    page.apply({ type: "account" });
    void begin();
    await advance(1900 + 1200);
    expect(status()).toEqual({
      phase: "signed_in",
      reason: "left-signin-page",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("measures page budgets from the last progress, not from the start", async () => {
    load();
    page.apply({ type: "splash" });
    void begin();
    await advance(50000);
    page.apply({ type: "mountRoot" });
    await advance(10000 + timing.layoutGraceMs - 10001);
    expect(terminal).not.toContain(status().phase);
    // The root appeared at 50s: the layout grace runs from there.
    await advance(1);
    expect(status()).toEqual({
      phase: "stopped",
      reason: "layout-unrecognized",
    });
    expect(grant.requests.username).toBe(0);
  });

  it("times out a Next that never advances only after the username-to-submit cap", async () => {
    load();
    page.install({ next: { delayMs: 0, outcome: "none" } });
    page.apply({ type: "account" });
    void begin();
    await advance(timing.quietMs);
    expect(grant.requests.username).toBe(1);
    await advance(timing.submitCapMs - 1);
    expect(status()).toEqual({
      phase: "waiting_password_form",
      reason: "panel-transition",
    });
    await advance(1);
    expect(status()).toEqual({ phase: "timeout", reason: "next-not-advanced" });
    expect(page.counts.next).toBe(1);
    expect(grant.requests).toEqual({ username: 1, password: 0, refused: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("acts on identical controls after the settle cap when the panel never goes quiet", async () => {
    load();
    page.apply({ type: "account" });
    const churn = setInterval(() => page.apply({ type: "panelChurn" }), 100);
    void begin();
    await advance(timing.maxSettleMs - 1);
    expect(status()).toEqual({
      phase: "waiting_account_stable",
      reason: "form-settling",
    });
    expect(grant.requests.username).toBe(0);
    await advance(1);
    expect(grant.requests.username).toBe(1);
    clearInterval(churn);
  });

  it("ends a refused one-shot username grant with a named terminal reason", async () => {
    load();
    page.apply({ type: "account" });
    // A nonce the endpoint does not recognise is answered with 403.
    void win.__sorng_autologin.fetchCredsAndRun(
      "c".repeat(32),
      null,
      "synology",
    );
    await advance(timing.quietMs);
    expect(status()).toEqual({
      phase: "stopped",
      reason: "credentials-unavailable",
    });
    expect(grant.requests).toEqual({ username: 1, password: 0, refused: 1 });
    expect(field("username")!.value).toBe("");
    expect(win.__autologin_last).toEqual({
      ok: false,
      reason: "reviewed-login-stopped",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-clicks a replaced Next at most once", async () => {
    load();
    page.install({ swallowNextClicks: 2 });
    page.apply({ type: "account" });
    void begin();
    await advance(timing.submitCapMs + timing.quietMs);
    expect(page.counts).toMatchObject({ next: 0, nextSwallowed: 2 });
    expect(status()).toEqual({ phase: "timeout", reason: "next-not-advanced" });
    expect(grant.requests).toEqual({ username: 1, password: 0, refused: 0 });
  });

  it("never clicks Sign in twice, even when the first click is lost", async () => {
    load();
    page.install({ swallowSignInClicks: 1 });
    page.apply({ type: "account" });
    void begin();
    await advance(5000);
    expect(page.counts).toMatchObject({ signIn: 0, signInSwallowed: 1 });
    expect(status()).toEqual({
      phase: "verifying_sign_in",
      reason: "submitted",
    });
    expect(win.__autologin_last).toEqual({ ok: true, reason: "submitted" });
    await advance(timing.verifyMs);
    expect(status()).toEqual({
      phase: "submitted",
      reason: "sign-in-unconfirmed",
    });
    expect(page.counts).toMatchObject({ signIn: 0, signInSwallowed: 1 });
    expect(grant.requests).toEqual({ username: 1, password: 1, refused: 0 });
  });

  it("stops after three fills when every write is lost to a re-render", async () => {
    load();
    page.apply({ type: "account" });
    document.addEventListener(
      "input",
      (event) => {
        if ((event.target as Element).matches('[syno-id="username"]'))
          setTimeout(() => page.apply({ type: "rerenderAccount" }), 100);
      },
      { signal: listeners.signal },
    );
    void begin();
    await advance(5000);
    expect(page.counts.usernameInputs).toBe(timing.maxFills);
    expect(status()).toEqual({ phase: "stopped", reason: "form-changed" });
    expect(page.counts.next).toBe(0);
    expect(grant.requests).toEqual({ username: 1, password: 0, refused: 0 });
  });

  it.each([
    ["an overflow wrapper that overlaps it", "overflow:hidden"],
    ["a zero-size wrapper that does not clip", "width:0;height:0"],
  ])("still stops for a captcha inside %s", async (_label, wrapper) => {
    load();
    page.apply({ type: "account" });
    document
      .querySelector("form")!
      .insertAdjacentHTML(
        "beforeend",
        `<div style="${wrapper}"><input name="captcha" type="text"></div>`,
      );
    void begin();
    await advance(timing.quietMs);
    expect(status()).toEqual({ phase: "stopped", reason: "captcha-required" });
    expect(grant.requests.username).toBe(0);
  });

  it("hands off an unknown #/signin step after the step grace", async () => {
    load();
    page.install({ next: { delayMs: 0, outcome: "none" } });
    page.apply({ type: "account" });
    void begin();
    await advance(2 * timing.quietMs);
    expect(page.counts.next).toBe(1);
    page.apply({ type: "route", hash: "#/signin/recovery", via: "hashchange" });
    await advance(timing.stepGraceMs - 1);
    expect(terminal).not.toContain(status().phase);
    await advance(1);
    expect(status()).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
    });
    expect(trace().handoff).toBe("other");
  });

  it("accepts the password panel's hidden username trimmed and case-insensitively", async () => {
    load();
    page.install({
      next: {
        delayMs: 300,
        outcome: "password",
        hiddenUsername: " Synthetic-DSM-User ",
      },
    });
    page.apply({ type: "account" });
    void begin();
    await advance(7000);
    expect(status()).toEqual({
      phase: "signed_in",
      reason: "left-signin-page",
    });
    expect(page.counts.signInWithPassword).toBe(1);
  });

  it("refuses a re-acquired password form that fails the reviewed contract", async () => {
    load("/#/signin", { passwordDelayMs: 1000 });
    page.apply({ type: "account" });
    void begin();
    await advance(2 * timing.quietMs + 300 + timing.quietMs + 500);
    expect(status().phase).toBe("requesting_password");
    page.apply({ type: "replaceRoot" });
    page.apply({
      type: "formAttribute",
      name: "action",
      value: "https://other.invalid/",
    });
    await advance(2000);
    expect(status()).toEqual({
      phase: "stopped",
      reason: "unsafe-form-target",
    });
    expect(field("password")!.value).toBe("");
    expect(page.counts.signIn).toBe(0);
    expect(grant.requests).toEqual({ username: 1, password: 1, refused: 0 });
  });

  it("clears every unsent password copy, including one left in a replaced field", async () => {
    load();
    page.apply({ type: "account" });
    document.addEventListener(
      "input",
      (event) => {
        if ((event.target as Element).matches('[syno-id="password"]'))
          document
            .querySelector('[syno-id="password-panel-next-btn"]')!
            .setAttribute("aria-disabled", "true");
      },
      { signal: listeners.signal },
    );
    void begin();
    await advance(3000);
    const first = field("password")!;
    expect(first.value).toBe(account.password);
    page.apply({ type: "replaceRoot" });
    await advance(1000);
    const second = field("password")!;
    expect(second).not.toBe(first);
    expect(second.value).toBe(account.password);
    expect(status().phase).toBe("waiting_signin_button");
    page.apply({
      type: "formAttribute",
      name: "action",
      value: "https://other.invalid/",
    });
    await advance(0);
    expect(status()).toEqual({
      phase: "stopped",
      reason: "unsafe-form-target",
    });
    expect(first.value).toBe("");
    expect(second.value).toBe("");
    expect(page.counts.signIn).toBe(0);
    expect(grant.requests).toEqual({ username: 1, password: 1, refused: 0 });
  });

  it("stops for trusted typing in the password field and keeps the typed value", async () => {
    load("/#/signin", { passwordDelayMs: 2000 });
    page.apply({ type: "account" });
    void begin();
    await advance(2000);
    expect(status().phase).toBe("requesting_password");
    typeAsUserJsdom(field("password")!, "typed-by-user");
    expect(status()).toEqual({
      phase: "stopped",
      reason: "user-input-detected",
    });
    await advance(3000);
    expect(field("password")!.value).toBe("typed-by-user");
    expect(page.counts.signIn).toBe(0);
    expect(win.__autologin_last).toEqual({
      ok: false,
      reason: "reviewed-login-stopped",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands the OTP panel to opted-in Automatic 2FA without touching it", async () => {
    await play(timeline("post-submit-otp-hand-off"));
    expect(status()).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
    });
    expect(trace()).toMatchObject({
      handoff: "otp",
      fingerprint: { hash: "otp", stage: "submitted" },
    });
    const code = document.querySelector<HTMLInputElement>(
      '[name="one-time-code"]',
    )!;
    expect(code.value).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    // The separate web automation client, armed by the parent, fills one code.
    const handlers: EventListener[] = [];
    const parent = { postMessage: vi.fn() };
    originalParent = Object.getOwnPropertyDescriptor(window, "parent");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });
    vi.spyOn(window, "addEventListener").mockImplementation((name, handler) => {
      if (name === "message") handlers.push(handler as EventListener);
    });
    const identity = {
      sessionId: "fixture",
      documentToken: "d".repeat(32),
      documentSequence: 1,
      navigationToken: null,
    };
    window.eval(
      `(function(){var p=${JSON.stringify(identity)},u=new URL(location.href);${automation}\n})();`,
    );
    const send = (action: string, payload: object) =>
      handlers.forEach((handler) =>
        handler({
          source: parent,
          origin: "http://localhost:3000",
          data: {
            type: "sorng_web_automation",
            version: 1,
            ...identity,
            url: location.href,
            requestId: "c".repeat(32),
            action,
            payload,
          },
        } as unknown as Event),
      );
    const challenge = {
      ...getHttpApplicationProfile("synology-dsm")!.totpChallenges![0],
      nonce: "e".repeat(32),
    };
    send("totpProbe", challenge);
    send("totpSubmit", {
      nonce: challenge.nonce,
      code: "123456",
      expires: Date.now() + 20000,
    });
    expect(page.counts.otp).toBe(1);
    expect(code.value).toBe("123456");
    expect(status().reason).toBe("interactive-step-required");
  });

  it("reports a bounded, closed, secret-free trace and freezes it at the terminal status", async () => {
    load();
    page.apply({ type: "account" });
    void begin();
    // Flap editability to produce more than the ring size of statuses.
    for (let index = 0; index < 30; index++) {
      page.apply({ type: "field", disabled: true });
      await advance(10);
      page.apply({ type: "field", disabled: false });
      await advance(10);
    }
    expect(grant.requests.username).toBe(0);
    await advance(7000);
    expect(status()).toEqual({
      phase: "signed_in",
      reason: "left-signin-page",
    });
    const final = trace();
    expect(final.steps.length).toBe(timing.traceLimit);
    expect(last(final.steps)).toMatchObject({
      phase: "signed_in",
      reason: "left-signin-page",
    });
    let previous = 0;
    for (const step of final.steps) {
      expect(Object.keys(step)).toEqual(["t", "phase", "reason"]);
      expect(Number.isInteger(step.t) && step.t >= previous).toBe(true);
      expect(step.phase).toMatch(/^[a-z_]+$/);
      expect(step.reason).toMatch(/^[a-z-]+$/);
      previous = step.t;
    }
    expect(Object.keys(final.fingerprint).sort()).toEqual(
      [
        "button",
        "field",
        "form",
        "hash",
        "panel",
        "readyState",
        "root",
        "stage",
      ].sort(),
    );
    expect(final.fingerprint).toMatchObject({
      root: 0,
      hash: "slash",
      readyState: "complete",
      stage: "submitted",
    });
    for (const event of events) {
      expect(Object.keys(event)).toEqual(["phase", "reason", "trace"]);
      expect(last(event.trace.steps)).toMatchObject({
        phase: event.phase,
        reason: event.reason,
      });
    }
    const serialized = JSON.stringify([events, final]);
    for (const secret of [
      account.username,
      account.password,
      DSM_READINESS_NONCE,
      DSM_CONTINUATION_NONCE,
      "localhost",
      "http",
    ])
      expect(serialized).not.toContain(secret);
    // Frozen: later page changes and cancellation do not rewrite it.
    const count = events.length;
    page.apply({ type: "account" });
    win.__sorng_synology_login.cancel();
    await advance(60000);
    expect(events.length).toBe(count);
    expect(trace()).toEqual(final);
    final.steps.length = 0;
    expect(trace().steps.length).toBe(timing.traceLimit);
  });

  it("ships a page runtime that runs from source text alone", () => {
    const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
      JSDOM: new (
        html: string,
        options: object,
      ) => { window: Window & { eval(code: string): unknown }; close(): void };
    };
    const dom = new JSDOM("<body></body>", {
      runScripts: "outside-only",
      url: "https://nas.invalid/#/signin",
    });
    try {
      const signedIn = dom.window.eval(
        `${dsmPageRuntimeSource()}
        var dsm = createDsmPage(window);
        dsm.apply({ type: "account" });
        dsm.apply({ type: "password" });
        document.querySelector('[syno-id="password"]') !== null &&
          document.querySelector('[name="username"]').value === "synthetic-dsm-user";`,
      );
      expect(signedIn).toBe(true);
    } finally {
      dom.window.close();
    }
  });
});
