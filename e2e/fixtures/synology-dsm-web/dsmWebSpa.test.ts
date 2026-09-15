// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DSM_LOGIN_ASSET_PATHS,
  DSM_LOGIN_TIMELINES,
  DSM_READINESS_NONCE,
  DSM_SYNTHETIC_ACCOUNT,
  createDsmGrantEndpoint,
  createDsmMarkup,
  createDsmPage,
  installJsdomLayout,
  type DsmGrantEndpoint,
  type DsmPage,
} from "../../../tests/fixtures/synology/dsmLoginTimeline";
import {
  createDsmWebState,
  type DsmWebState,
  type DsmWebVariant,
} from "./fixture";

// The e2e fixture SPA against the production DSM page helper in jsdom, with
// fake timers: proves the served page drives the helper to the outcome the
// WDIO spec expects before any app build. Parser-blocking boot chunks are
// real-engine only and not simulated here.
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (file: string) => readFileSync(path.join(repo, file), "utf8");
const helper = read(DSM_LOGIN_ASSET_PATHS.helper);
const client = read(DSM_LOGIN_ASSET_PATHS.client);
const app = read("e2e/fixtures/synology-dsm-web/app.js");

type Progress = {
  phase: string;
  reason: string;
  trace?: { handoff?: string | null };
};
const win = window as unknown as Window & {
  __DSM_FIXTURE__?: unknown;
  createDsmPage?: typeof createDsmPage;
  createDsmMarkup?: typeof createDsmMarkup;
  __sorng_autologin?: {
    fetchCredsAndRun(nonce: string, selectors: null, flow: string): unknown;
    cancel(): void;
  };
  __sorng_synology_login?: {
    cancel(): void;
    getStatus(): { phase: string; reason: string };
    getTrace(): { handoff: string | null };
  };
  __autologin_last?: unknown;
};

let state: DsmWebState;
let grant: DsmGrantEndpoint;
let page: DsmPage | undefined;
let events: Progress[];
let restoreLayout: () => void;
// app.js listeners outlive a test in the shared jsdom document; remove them.
let appListeners: Parameters<Document["removeEventListener"]>[];
const record = (event: Event) =>
  events.push((event as CustomEvent<Progress>).detail);

function reply(body: unknown, delayMs: number) {
  const response = { ok: true, status: 200, json: async () => body };
  return new Promise((resolve) => setTimeout(() => resolve(response), delayMs));
}

function routeFetch(input: string, init?: { body?: unknown }) {
  const url = new URL(input, "https://127.0.0.1:8446/");
  if (url.pathname === "/__sortofremoteng_autologin")
    return grant.fetch(input, init as { signal?: AbortSignal | null });
  const body = typeof init?.body === "string" ? init.body : "";
  if (url.pathname === "/webapi/entry.cgi") {
    const result = state.handleEntryCgi(new URLSearchParams(body), "POST");
    return reply(result.body, result.delayMs);
  }
  if (url.pathname === "/webman/fixture-event.cgi") {
    state.recordPageEvent(JSON.parse(body));
    return reply({ success: true }, 0);
  }
  return Promise.reject(new Error(`unexpected fetch ${url.pathname}`));
}

function boot(variant: DsmWebVariant) {
  state = createDsmWebState({
    timelines: DSM_LOGIN_TIMELINES,
    account: DSM_SYNTHETIC_ACCOUNT,
    variant,
  });
  grant = createDsmGrantEndpoint({
    schedule: (action, ms) => setTimeout(action, ms),
  });
  vi.stubGlobal("fetch", routeFetch);
  window.eval(helper);
  window.eval(client);
  win.createDsmMarkup = createDsmMarkup;
  win.createDsmPage = (target, options) =>
    (page = createDsmPage(target, options));
  win.__DSM_FIXTURE__ = state.pageConfig();
  const add = document.addEventListener;
  document.addEventListener = function (
    this: Document,
    ...args: Parameters<Document["addEventListener"]>
  ) {
    appListeners.push(args);
    return add.apply(this, args);
  };
  try {
    window.eval(app);
  } finally {
    document.addEventListener = add;
  }
  void win.__sorng_autologin!.fetchCredsAndRun(
    DSM_READINESS_NONCE,
    null,
    "synology",
  );
  return state.scenario();
}

const status = () => win.__sorng_synology_login!.getStatus();
const pageEvents = (event: string) =>
  state.snapshot().page.filter((entry) => entry.event === event);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  history.replaceState(null, "", "/");
  restoreLayout = installJsdomLayout(window);
  events = [];
  appListeners = [];
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
  for (const args of appListeners) document.removeEventListener(...args);
  page?.dispose();
  page = undefined;
  restoreLayout();
  for (const key of [
    "__sorng_autologin",
    "__sorng_synology_login",
    "__autologin_last",
    "__DSM_FIXTURE__",
    "createDsmPage",
    "createDsmMarkup",
  ])
    Reflect.deleteProperty(win, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectOneSubmissionPerStage(outcome: string) {
  const hits = state.snapshot();
  expect(grant.requests).toEqual({ username: 1, password: 1, refused: 0 });
  expect(hits.authType).toEqual([
    expect.objectContaining({ method: "POST", accountMatches: true }),
  ]);
  expect(hits.login).toEqual([
    expect.objectContaining({
      accountMatches: true,
      passwordMatches: true,
      otpCode: false,
      outcome,
    }),
  ]);
  expect(page?.counts).toMatchObject({ next: 1, signIn: 1, otp: 0 });
  expect(JSON.stringify(hits)).not.toContain(DSM_SYNTHETIC_ACCOUNT.password);
}

const failure = (entry: Progress) =>
  ["stopped", "timeout", "cancelled", "rejected"].includes(entry.phase) ||
  (entry.phase === "signed_in" && entry.reason === "no-sign-in-page");

describe("synthetic DSM website fixture SPA", () => {
  it("standard: signs in once through the login API", async () => {
    const scenario = boot("standard");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(status()).toEqual({
      phase: scenario.expected.phase,
      reason: scenario.expected.reason,
    });
    expect(status()).toEqual({
      phase: "signed_in",
      reason: "left-signin-page",
    });
    expectOneSubmissionPerStage("signed-in");
    expect(pageEvents("desktop-shown")).toHaveLength(1);
    expect(events.filter(failure)).toEqual([]);
    expect(location.hash).toBe("#/");
  });

  it("slow: waits through a 35s splash on #/ without a stop or a signed-in misfire", async () => {
    const scenario = boot("slow");
    await vi.advanceTimersByTimeAsync(34_000);
    expect(state.snapshot().authType).toEqual([]);
    expect(grant.requests.username).toBe(0);
    expect(events.filter(failure)).toEqual([]);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(status()).toEqual({
      phase: scenario.expected.phase,
      reason: scenario.expected.reason,
    });
    expectOneSubmissionPerStage("signed-in");
    const account = pageEvents("step").find(
      (entry) => entry.detail === "account",
    );
    expect(account?.t).toBeGreaterThanOrEqual(35_000);
    expect(state.snapshot().authType[0].t).toBeGreaterThanOrEqual(35_000);
    expect(events.filter(failure)).toEqual([]);
  });

  it("otp: fills both stages once, then hands off on the 2FA route", async () => {
    const scenario = boot("otp");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(scenario.expected).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
      handoff: "otp",
    });
    expect(status()).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
    });
    expect(win.__sorng_synology_login!.getTrace().handoff).toBe("otp");
    expectOneSubmissionPerStage("otp-required");
    expect(location.hash).toBe("#/signin/otp");
    expect(
      document.querySelector('input[name="one-time-code"]'),
    ).not.toBeNull();
    expect(events.filter(failure)).toEqual([
      expect.objectContaining({
        phase: "stopped",
        reason: "interactive-step-required",
      }),
    ]);

    // A hand-off is terminal: nothing is retried or submitted afterwards.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.snapshot().login).toHaveLength(1);
    expect(page?.counts.otp).toBe(0);
  });
});
