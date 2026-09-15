import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
} from "../../src/utils/monitoring/sessionActivityLog";
import {
  parseDeferredSynologyLoginStatus,
  parseSynologyLoginProgress,
  useDeferredSynologyLoginStatus,
} from "../../src/hooks/protocol/useDeferredSynologyLoginStatus";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
beforeEach(() => {
  clearSessionActivityLog();
  vi.useFakeTimers();
  h.invoke.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function fixture() {
  let context = {
    sessionId: "proxy-a",
    generation: 1,
    document: "doc-a" as string | null,
  };
  const options = {
    activityContext: {
      sessionId: "tab-a",
      connectionId: "connection-a",
      databaseId: "db-a",
    },
    scope: "owner-a:source-a",
    requested: true,
    valid: true,
    context: () => context,
    assertCurrent: vi.fn(),
    automaticOtp: undefined as boolean | undefined,
  };
  const view = renderHook(
    (props = options) => useDeferredSynologyLoginStatus(props),
    { initialProps: options },
  );
  return {
    ...view,
    options,
    replaceContext: (next: typeof context) => {
      context = next;
    },
  };
}
describe("native deferred Synology status snapshots", () => {
  it("logs only accepted closed observations, deduplicates snapshots and ignores revoked late replies", async () => {
    const view = fixture();
    act(() => {
      view.result.current.receive({
        session_id: "proxy-a",
        deferred_login_status: "waiting_for_form",
      });
      view.result.current.receive({
        session_id: "proxy-a",
        deferred_login_status: "waiting_for_form",
      });
      view.result.current.receive({
        session_id: "foreign",
        deferred_login_status: "credentials_released",
      });
      view.result.current.receivePageProgress({
        phase: "waiting_next_button",
        reason: "input-settling",
        value: "PRIVATE_PASSWORD",
      });
      view.result.current.receivePageProgress({
        phase: "waiting_next_button",
        reason: "input-settling",
      });
    });
    expect(getSessionActivityLog().map((entry) => entry.code)).toEqual([
      "waiting_next_button",
      "waiting_for_form",
    ]);
    expect(getSessionActivityLog()[0]).toMatchObject({
      sessionId: "tab-a",
      connectionId: "connection-a",
      databaseId: "db-a",
    });
    expect(JSON.stringify(getSessionActivityLog())).not.toContain(
      "PRIVATE_PASSWORD",
    );
    let resolve!: (value: unknown) => void;
    h.invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let reading!: Promise<void>;
    act(() => {
      reading = view.result.current.refresh();
    });
    view.rerender({ ...view.options, valid: false });
    await act(async () => {
      resolve([
        {
          session_id: "proxy-a",
          deferred_login_status: "credentials_released",
        },
      ]);
      await reading;
    });
    expect(getSessionActivityLog()).toHaveLength(2);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it("explains stable-form and input waits then a non-advancing Next without retrying", () => {
    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "waiting_account_stable",
        reason: "form-settling",
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: checking login form",
    );
    expect(view.result.current.presentation?.detail).toContain(
      "does not prove the page framework",
    );
    act(() =>
      view.result.current.receivePageProgress({
        phase: "waiting_next_button",
        reason: "input-settling",
      }),
    );
    expect(view.result.current.presentation?.detail).toContain(
      "filled the reviewed input once",
    );
    act(() =>
      view.result.current.receivePageProgress({
        phase: "timeout",
        reason: "next-not-advanced",
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: timed out — Next did not advance",
    );
    expect(view.result.current.presentation?.detail).toContain(
      "Next was clicked once",
    );
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("keeps page-helper timeout distinct from the native grant without requesting or retrying anything", () => {
    const view = fixture();
    act(() =>
      view.result.current.receive({
        session_id: "proxy-a",
        deferred_login_status: "waiting_for_form",
      }),
    );
    act(() =>
      view.result.current.receivePageProgress({
        phase: "timeout",
        reason: "timeout",
        password: "private",
      }),
    );
    expect(view.result.current.presentation).toMatchObject({
      status: "waiting_for_form",
      text: "Auto-fill: timed out — deadline reached",
      pageProgress: { phase: "timeout", reason: "timeout" },
    });
    expect(view.result.current.presentation?.detail).toContain(
      "Native snapshot: Waiting for the DSM form",
    );
    expect(view.result.current.presentation?.detail).toContain(
      "advisory page state",
    );
    expect(JSON.stringify(view.result.current.presentation)).not.toContain(
      "private",
    );
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("validates closed page phases/reasons and never uses page submission as sign-in proof", () => {
    expect(
      parseSynologyLoginProgress({ phase: "__proto__", reason: "timeout" }),
    ).toBeNull();
    expect(
      parseSynologyLoginProgress({
        phase: "submitted",
        reason: { toString: () => "submitted" },
      }),
    ).toBeNull();
    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "submitted",
        reason: "submitted",
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: reported submission",
    );
    expect(view.result.current.presentation?.detail).toContain(
      "does not confirm authentication",
    );
    expect(view.result.current.presentation?.status).toBeNull();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "waiting_root",
        reason: "root-missing",
      }),
    );
    expect(view.result.current.presentation?.pageProgress?.phase).toBe(
      "submitted",
    );
    view.rerender({ ...view.options, scope: "other" });
    view.rerender(view.options);
    expect(view.result.current.presentation?.pageProgress).toBeNull();
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("hides page diagnostics on document replacement, absent document or revoked original lease", () => {
    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "waiting_account_form",
        reason: "button-missing",
      }),
    );
    view.replaceContext({
      sessionId: "proxy-a",
      generation: 1,
      document: "doc-b",
    });
    view.rerender(view.options);
    expect(view.result.current.presentation?.pageProgress).toBeNull();
    view.replaceContext({
      sessionId: "proxy-a",
      generation: 1,
      document: null,
    });
    act(() =>
      view.result.current.receivePageProgress({
        phase: "timeout",
        reason: "timeout",
      }),
    );
    expect(view.result.current.presentation?.pageProgress).toBeNull();
    view.rerender({ ...view.options, valid: false });
    act(() =>
      view.result.current.receivePageProgress({
        phase: "timeout",
        reason: "timeout",
      }),
    );
    expect(view.result.current.presentation?.pageProgress).toBeNull();
  });
  it.each([
    "awaiting_nas",
    "waiting_for_form",
    "waiting_for_password",
    "credentials_released",
    "expired",
    "cancelled",
  ])("shows the native %s without claiming sign-in success", async (status) => {
    const view = fixture();
    h.invoke.mockResolvedValue([
      { session_id: "proxy-a", deferred_login_status: status },
    ]);
    await act(() => view.result.current.refresh());
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith(
      "get_proxy_session_details",
      { sessionId: "proxy-a" },
    );
    expect(view.result.current.presentation?.status).toBe(status);
    expect(view.result.current.presentation?.text).toMatch(/^Auto-fill: /);
    expect(view.result.current.presentation?.text).not.toMatch(
      /signed in|successful|complete/i,
    );
    expect(view.result.current.presentation?.detail).toContain(
      "not proof of successful sign-in",
    );
    expect(view.result.current.presentation?.muted).toBe(
      ["credentials_released", "expired", "cancelled"].includes(status),
    );
  });
  it.each([
    undefined,
    null,
    true,
    "future-state",
    { toString: () => "waiting_for_form" },
  ])(
    "does not coerce missing or malformed status %s into inactive or active",
    async (status) => {
      expect(parseDeferredSynologyLoginStatus(status)).toBeNull();
      const view = fixture();
      act(() =>
        view.result.current.receive({
          session_id: "proxy-a",
          deferred_login_status: status,
        }),
      );
      expect(view.result.current.presentation?.status).toBeNull();
      expect(view.result.current.presentation?.reason).toBe(
        status == null ? "status-missing" : "unsupported-status",
      );
      expect(view.result.current.presentation?.detail).toContain(
        "Saved login requested; native status unknown",
      );
    },
  );
  it("expires waiting snapshots without polling, while explicit refresh reads again", async () => {
    const view = fixture();
    h.invoke.mockResolvedValue([
      { session_id: "proxy-a", deferred_login_status: "waiting_for_form" },
    ]);
    await act(() => view.result.current.refresh());
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(view.result.current.presentation?.status).toBeNull();
    expect(view.result.current.presentation?.reason).toBe("snapshot-aged");
    expect(view.result.current.presentation?.text).toBe(
      "Saved login: status needs refresh",
    );
    expect(view.result.current.presentation?.detail).toContain(
      "Saved login requested; native status unknown",
    );
    expect(h.invoke).toHaveBeenCalledTimes(1);
    await act(() => view.result.current.refresh());
    expect(view.result.current.presentation?.status).toBe("waiting_for_form");
  });
  it.each([
    "scope-aba",
    "generation",
    "document",
    "proxy",
    "revoked",
    "unmount",
  ])("discards a held native snapshot after %s", async (change) => {
    let resolve!: (value: unknown) => void;
    h.invoke.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = fixture();
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.refresh();
    });
    if (change === "scope-aba") {
      view.rerender({ ...view.options, scope: "other" });
      view.rerender(view.options);
    } else if (change === "unmount") view.unmount();
    else if (change === "revoked")
      view.rerender({ ...view.options, valid: false });
    else
      view.replaceContext({
        sessionId: change === "proxy" ? "proxy-b" : "proxy-a",
        generation: change === "generation" ? 2 : 1,
        document: change === "document" ? "doc-b" : "doc-a",
      });
    await act(async () => {
      resolve([
        {
          session_id: "proxy-a",
          deferred_login_status: "credentials_released",
        },
      ]);
      await pending;
    });
    expect(view.result.current.presentation?.status).not.toBe(
      "credentials_released",
    );
  });
  it("coalesces in-flight reads and rate-limits page hints to one per current document", async () => {
    let resolve!: (value: unknown) => void;
    h.invoke.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = fixture();
    act(() => {
      view.result.current.refreshFromPage();
      view.result.current.refreshFromPage();
      void view.result.current.refresh();
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve([
        {
          session_id: "proxy-a",
          deferred_login_status: "waiting_for_password",
        },
      ]),
    );
    act(() => view.result.current.refreshFromPage());
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it("ignores another session, duplicate matching rows and failed native reads", async () => {
    const view = fixture();
    for (const response of [
      [
        {
          session_id: "proxy-b",
          deferred_login_status: "credentials_released",
        },
      ],
      [
        { session_id: "proxy-a", deferred_login_status: "expired" },
        { session_id: "proxy-a", deferred_login_status: "cancelled" },
      ],
    ]) {
      h.invoke.mockResolvedValue(response);
      await act(() => view.result.current.refresh());
      expect(view.result.current.presentation?.status).toBeNull();
    }
    h.invoke.mockRejectedValue(new Error("private backend detail"));
    await act(() => view.result.current.refresh());
    expect(view.result.current.presentation?.detail).not.toContain("private");
  });
  it.each([
    [null, "invalid-response"],
    [[], "session-missing"],
    [
      [{ sessionId: "proxy-a", deferredLoginStatus: "waiting_for_form" }],
      "session-missing",
    ],
    [[{ session_id: "proxy-a" }], "status-missing"],
    [
      [{ session_id: "proxy-a", deferred_login_status: "future" }],
      "unsupported-status",
    ],
    [
      [{ session_id: "proxy-a" }, { session_id: "proxy-a" }],
      "ambiguous-session",
    ],
  ])(
    "distinguishes a closed response diagnostic for %j",
    async (response, reason) => {
      const view = fixture();
      h.invoke.mockResolvedValue(response);
      await act(() => view.result.current.refresh());
      expect(view.result.current.presentation).toMatchObject({
        status: null,
        reason,
      });
      expect(view.result.current.presentation?.detail).toContain(`[${reason}]`);
    },
  );
  it("reports a failed native request without echoing an exception or arbitrary secret-bearing object", async () => {
    const view = fixture();
    for (const failure of [
      "private token=hidden",
      new Error("private hostname"),
      { password: "private" },
    ]) {
      h.invoke.mockRejectedValue(failure);
      await act(() => view.result.current.refresh());
      expect(view.result.current.presentation).toMatchObject({
        status: null,
        reason: "request-failed",
        text: "Saved login: status read failed",
      });
      expect(view.result.current.presentation?.detail).not.toMatch(
        /private|hidden|hostname/,
      );
    }
  });
  it("makes no requests for ordinary or revoked login contexts", async () => {
    const view = fixture();
    view.rerender({ ...view.options, requested: false });
    await act(() => view.result.current.refresh());
    expect(view.result.current.presentation).toBeNull();
    view.rerender({ ...view.options, valid: false });
    await act(() => view.result.current.refresh());
    expect(view.result.current.presentation?.detail).toContain(
      "access changed",
    );
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("bounds a stalled read, allows explicit retry and discards the old late reply", async () => {
    const view = fixture();
    act(() =>
      view.result.current.receive({
        session_id: "proxy-a",
        deferred_login_status: "waiting_for_form",
      }),
    );
    let resolve!: (value: unknown) => void;
    h.invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
      await pending;
    });
    expect(view.result.current.presentation).toMatchObject({
      status: null,
      reason: "request-timeout",
    });
    expect(view.result.current.presentation?.detail).toContain(
      "Last observed: Waiting for the DSM form (not current status)",
    );
    h.invoke.mockResolvedValueOnce([
      { session_id: "proxy-a", deferred_login_status: "credentials_released" },
    ]);
    await act(() => view.result.current.refresh());
    await act(async () =>
      resolve([{ session_id: "proxy-a", deferred_login_status: "expired" }]),
    );
    expect(view.result.current.presentation?.status).toBe(
      "credentials_released",
    );
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects an overdue reply even before the delayed timer callback runs", async () => {
    const view = fixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let resolve!: (value: unknown) => void;
    h.invoke.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.refresh();
    });
    now = 6001;
    await act(async () => {
      resolve([
        {
          session_id: "proxy-a",
          deferred_login_status: "waiting_for_password",
        },
      ]);
      await pending;
    });
    expect(view.result.current.presentation).toMatchObject({
      status: null,
      reason: "request-timeout",
    });
    vi.mocked(performance.now).mockRestore();
  });
  it("does not carry a timeout or last-observed phase into a replacement owner", async () => {
    const view = fixture();
    act(() =>
      view.result.current.receive({
        session_id: "proxy-a",
        deferred_login_status: "waiting_for_form",
      }),
    );
    h.invoke.mockReturnValue(new Promise(() => {}));
    act(() => {
      void view.result.current.refresh();
    });
    view.rerender({ ...view.options, scope: "replacement-owner" });
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(view.result.current.presentation).toMatchObject({
      status: null,
      reason: "not-observed",
    });
    expect(view.result.current.presentation?.detail).not.toContain(
      "Last observed",
    );
  });
});

const fingerprint = (overrides: Record<string, unknown> = {}) => ({
  root: 1,
  panel: 1,
  form: 1,
  field: 1,
  button: 1,
  hash: "signin",
  readyState: "complete",
  stage: "account",
  ...overrides,
});
describe("page-helper outcome presentation", () => {
  it.each([
    ["waiting_document", "document-loading", "Auto-fill: waiting for page"],
    ["waiting_page", "route-pending", "Auto-fill: waiting for DSM"],
    ["waiting_page", "page-busy", "Auto-fill: waiting for DSM"],
    ["waiting_root", "root-missing", "Auto-fill: finding DSM"],
    [
      "waiting_account_form",
      "controls-replaced",
      "Auto-fill: finding login form",
    ],
    [
      "waiting_account_stable",
      "panel-quiet-wait",
      "Auto-fill: checking login form",
    ],
    ["filling_username", "value-refilled", "Auto-fill: filling username"],
    ["waiting_next_button", "next-reclicked", "Auto-fill: waiting for Next"],
    [
      "waiting_password_form",
      "panel-transition",
      "Auto-fill: waiting for password step",
    ],
    ["filling_password", "value-refilled", "Auto-fill: filling password"],
    ["verifying_sign_in", "submitted", "Auto-fill: signing in"],
    ["submitted", "sign-in-unconfirmed", "Auto-fill: reported submission"],
    ["signed_in", "left-signin-page", "Auto-fill: signed in"],
    ["signed_in", "no-sign-in-page", "Auto-fill: already signed in"],
    ["cancelled", "cancelled", "Auto-fill: cancelled"],
  ])("labels %s/%s as %j", (phase, reason, text) => {
    const view = fixture();
    act(() => view.result.current.receivePageProgress({ phase, reason }));
    expect(view.result.current.presentation?.text).toBe(text);
    expect(view.result.current.presentation?.pageProgress).toEqual({
      phase,
      reason,
    });
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each([
    ["stopped", "captcha-required", "Auto-fill: stopped — CAPTCHA required"],
    [
      "stopped",
      "user-input-detected",
      "Auto-fill: stopped — manual input detected",
    ],
    [
      "stopped",
      "unsafe-form-target",
      "Auto-fill: stopped — unsafe form target",
    ],
    ["stopped", "account-mismatch", "Auto-fill: stopped — account mismatch"],
    ["stopped", "left-login-page", "Auto-fill: stopped — left the login page"],
    [
      "stopped",
      "layout-unrecognized",
      "Auto-fill: stopped — login layout not recognized",
    ],
    [
      "stopped",
      "unsupported-login-path",
      "Auto-fill: stopped — unsupported login path",
    ],
    ["stopped", "form-changed", "Auto-fill: stopped — login form changed"],
    ["stopped", "route-changed", "Auto-fill: stopped — page route changed"],
    ["stopped", "captcha", "Auto-fill: stopped — CAPTCHA detected"],
    [
      "stopped",
      "credentials-unavailable",
      "Auto-fill: stopped — saved credentials unavailable",
    ],
    [
      "stopped",
      "invalid-credential-response",
      "Auto-fill: stopped — invalid credential response",
    ],
    ["stopped", "stopped", "Auto-fill: stopped — not completed"],
    [
      "timeout",
      "page-never-ready",
      "Auto-fill: timed out — page never became ready",
    ],
    [
      "timeout",
      "login-form-never-appeared",
      "Auto-fill: timed out — login form never appeared",
    ],
    [
      "timeout",
      "password-panel-never-appeared",
      "Auto-fill: timed out — password step never appeared",
    ],
    [
      "timeout",
      "signin-button-never-enabled",
      "Auto-fill: timed out — Sign in never enabled",
    ],
    [
      "timeout",
      "next-not-advanced",
      "Auto-fill: timed out — Next did not advance",
    ],
    ["timeout", "timeout", "Auto-fill: timed out — deadline reached"],
    [
      "rejected",
      "error-visible",
      "Auto-fill: sign-in rejected — DSM showed an error",
    ],
  ])("formats the terminal %s/%s as %j", (phase, reason, text) => {
    const view = fixture();
    act(() => view.result.current.receivePageProgress({ phase, reason }));
    expect(view.result.current.presentation?.text).toBe(text);
    expect(view.result.current.presentation?.detail).toContain(
      `[${phase}/${reason}]`,
    );
    act(() =>
      view.result.current.receivePageProgress({
        phase: "waiting_root",
        reason: "root-missing",
      }),
    );
    expect(view.result.current.presentation?.text).toBe(text);
  });
  it.each([
    ["otp", "Auto-fill: filled — enter your 2FA code", "one-time 2FA code"],
    [
      "approve",
      "Auto-fill: filled — approve sign-in in Secure SignIn",
      "Synology Secure SignIn",
    ],
    [
      "select-auth",
      "Auto-fill: filled — choose a sign-in method",
      "choose how to verify",
    ],
    [
      "passkey",
      "Auto-fill: filled — use your passkey",
      "passkey or hardware security key",
    ],
    [
      "other",
      "Auto-fill: filled — finish sign-in on the page",
      "remaining DSM sign-in step",
    ],
  ])(
    "hands the interactive %s step to the user instead of reporting a failure",
    (handoff, text, explanation) => {
      const view = fixture();
      act(() =>
        view.result.current.receivePageProgress({
          phase: "stopped",
          reason: "interactive-step-required",
          trace: {
            fingerprint: fingerprint({
              hash: handoff,
              stage: "submitted",
            }),
            handoff,
          },
        }),
      );
      const presentation = view.result.current.presentation;
      expect(presentation?.text).toBe(text);
      expect(presentation?.text).not.toMatch(/stopped|failed|timed out/i);
      expect(presentation?.detail).toContain(explanation);
      expect(presentation?.detail).toContain("DSM asked for it after Sign in.");
      expect(presentation?.detail).toContain(
        "never enters a 2FA code, approves a sign-in or uses a passkey",
      );
      expect(presentation?.pageProgress?.phase).toBe("stopped");
      expect(h.invoke).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ fingerprint: { hash: "approve" } }, "approve sign-in in Secure SignIn"],
    [{ fingerprint: { hash: "otp" } }, "enter your 2FA code"],
    [{ fingerprint: { hash: "other" } }, "finish sign-in on the page"],
    [{ fingerprint: { hash: "password" } }, "finish sign-in on the page"],
    [
      { handoff: "select-auth", fingerprint: { hash: "approve" } },
      "choose a sign-in method",
    ],
    [undefined, "finish sign-in on the page"],
  ])(
    "falls back from the named hand-off to the route class for %j",
    (trace, handoff) => {
      const view = fixture();
      act(() =>
        view.result.current.receivePageProgress({
          phase: "stopped",
          reason: "interactive-step-required",
          ...(trace ? { trace } : {}),
        }),
      );
      expect(view.result.current.presentation?.text).toBe(
        `Auto-fill: filled — ${handoff}`,
      );
    },
  );
  it.each([
    ["account", "DSM asked for it after the username step."],
    ["password", "DSM asked for it during the password step."],
  ])("says where the %s-stage hand-off happened", (stage, sentence) => {
    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "stopped",
        reason: "interactive-step-required",
        trace: { fingerprint: { hash: "approve", stage }, handoff: "approve" },
      }),
    );
    expect(view.result.current.presentation?.detail).toContain(sentence);
  });
  it("hands the code step to Automatic 2FA when the connection enables it", () => {
    const view = fixture();
    view.rerender({ ...view.options, automaticOtp: true });
    act(() =>
      view.result.current.receivePageProgress({
        phase: "stopped",
        reason: "interactive-step-required",
        trace: {
          fingerprint: { hash: "otp", stage: "submitted" },
          handoff: "otp",
        },
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: filled — Automatic 2FA is entering the code",
    );
    expect(view.result.current.presentation?.detail).toContain(
      "Automatic 2FA is enabled for this connection",
    );
    view.rerender({ ...view.options, automaticOtp: false });
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: filled — enter your 2FA code",
    );
  });
  it("uses the hand-off only for the interactive stop, never to relabel other stops", () => {
    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "stopped",
        reason: "captcha-required",
        trace: { fingerprint: { hash: "otp" }, handoff: "otp" },
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: stopped — CAPTCHA required",
    );
    expect(view.result.current.presentation?.detail).not.toContain(
      "2FA code from your authenticator",
    );
  });
  it("explains that page-observed sign-in is inferred, not native proof", () => {
    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "signed_in",
        reason: "left-signin-page",
      }),
    );
    const detail = view.result.current.presentation?.detail;
    expect(detail).toContain("left the DSM sign-in page after Sign in");
    expect(detail).toContain("advisory page state");
    expect(detail).toContain("not native proof of authentication");
    expect(detail).not.toContain(
      "not native authorization or proof of sign-in",
    );
  });
  it("appends the last eight closed trace steps and the fingerprint to the detail", () => {
    const view = fixture();
    const steps = Array.from({ length: 10 }, (_, index) => ({
      t: index * 250,
      phase: index % 2 ? "waiting_page" : "waiting_root",
      reason: index % 2 ? "route-pending" : "root-missing",
    }));
    act(() =>
      view.result.current.receivePageProgress({
        phase: "timeout",
        reason: "login-form-never-appeared",
        trace: {
          steps,
          fingerprint: fingerprint({
            form: 0,
            field: 0,
            button: 0,
            hash: "slash",
          }),
        },
      }),
    );
    const detail = view.result.current.presentation?.detail ?? "";
    expect(detail).toContain(
      "Recent page steps (ms since start): 500 waiting_root/root-missing; 750 waiting_page/route-pending;",
    );
    expect(detail).toContain("2250 waiting_page/route-pending.");
    expect(detail).not.toContain(" 250 waiting_page/route-pending");
    expect(detail).toContain(
      "Page fingerprint: root 1, panel 1, form 0, field 0, button 0, route slash, document complete, stage account.",
    );
    expect(view.result.current.presentation?.pageProgress?.trace).toEqual({
      steps: steps.slice(-8),
      fingerprint: fingerprint({
        form: 0,
        field: 0,
        button: 0,
        hash: "slash",
      }),
    });
  });
  it("rejects page values outside the closed trace vocabulary and never shows or logs secrets", () => {
    expect(
      parseSynologyLoginProgress({
        phase: "stopped",
        reason: "interactive-step-required",
        trace: {
          steps: [
            { t: 1, phase: "waiting_root", reason: "root-missing", id: "x" },
            { t: -1, phase: "waiting_root", reason: "root-missing" },
            { t: 2.5, phase: "waiting_root", reason: "root-missing" },
            { t: 3, phase: "PRIVATE_PHASE", reason: "root-missing" },
            { t: 3, phase: "waiting_root", reason: "PRIVATE_REASON" },
            { t: 3, phase: "waiting_root", reason: "observation-limited" },
          ],
          fingerprint: {
            root: 12,
            panel: "1",
            form: -1,
            field: 0.5,
            hash: "#/signin/PRIVATE",
            readyState: "PRIVATE",
            stage: "PRIVATE",
            password: "PRIVATE_PASSWORD",
          },
          handoff: "PRIVATE_STEP",
          url: "https://PRIVATE.invalid",
        },
      }),
    ).toEqual({
      phase: "stopped",
      reason: "interactive-step-required",
      trace: {
        steps: [{ t: 1, phase: "waiting_root", reason: "root-missing" }],
        fingerprint: { root: 9 },
      },
    });
    for (const trace of [
      "PRIVATE",
      [],
      {},
      { steps: {}, fingerprint: [], handoff: 1 },
    ])
      expect(
        parseSynologyLoginProgress({
          phase: "waiting_page",
          reason: "route-pending",
          trace,
        }),
      ).toEqual({ phase: "waiting_page", reason: "route-pending" });
    const hostile = {};
    Object.defineProperty(hostile, "fingerprint", {
      get() {
        throw new Error("PRIVATE_GETTER");
      },
    });
    expect(
      parseSynologyLoginProgress({
        phase: "waiting_page",
        reason: "route-pending",
        trace: hostile,
      }),
    ).toEqual({ phase: "waiting_page", reason: "route-pending" });
    for (const value of [
      { phase: "waiting_page", reason: "PRIVATE" },
      { phase: "signed_in_PRIVATE", reason: "left-signin-page" },
      { phase: "constructor", reason: "route-pending" },
      { phase: "rejected", reason: "hasOwnProperty" },
    ])
      expect(parseSynologyLoginProgress(value)).toBeNull();

    const view = fixture();
    act(() =>
      view.result.current.receivePageProgress({
        phase: "stopped",
        reason: "interactive-step-required",
        username: "PRIVATE_USER",
        trace: {
          steps: [
            {
              t: 10,
              phase: "requesting_password",
              reason: "requesting-password",
              password: "PRIVATE_PASSWORD",
            },
          ],
          fingerprint: { ...fingerprint({ hash: "otp" }), code: "PRIVATE" },
          handoff: "otp",
          href: "https://PRIVATE.invalid/#/signin/otp",
        },
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: filled — enter your 2FA code",
    );
    expect(JSON.stringify(view.result.current.presentation)).not.toMatch(
      /PRIVATE|"password"|"username"|href|"code"/,
    );
    expect(JSON.stringify(getSessionActivityLog())).not.toMatch(
      /PRIVATE|href|username/,
    );
  });
  it("bounds noisy phase changes, lets the bridge limit notice through once, and still shows the terminal result", () => {
    const view = fixture();
    act(() => {
      for (let index = 0; index < 70; index++)
        view.result.current.receivePageProgress({
          phase: index % 2 ? "waiting_root" : "waiting_account_form",
          reason: "root-missing",
        });
    });
    expect(getSessionActivityLog()).toHaveLength(64);
    act(() => {
      view.result.current.receivePageProgress({
        phase: "waiting_account_form",
        reason: "observation-limited",
      });
      view.result.current.receivePageProgress({
        phase: "waiting_root",
        reason: "observation-limited",
      });
    });
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: details limited",
    );
    expect(getSessionActivityLog()).toHaveLength(65);
    act(() =>
      view.result.current.receivePageProgress({
        phase: "stopped",
        reason: "captcha-required",
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: stopped — CAPTCHA required",
    );
  });
  it("gives reason-only churn a separate larger bound and refuses an early limit notice", () => {
    const view = fixture();
    act(() => {
      view.result.current.receivePageProgress({
        phase: "waiting_page",
        reason: "observation-limited",
      });
    });
    expect(view.result.current.presentation?.pageProgress).toBeNull();
    act(() => {
      for (let index = 0; index < 300; index++)
        view.result.current.receivePageProgress({
          phase: "waiting_page",
          reason: index % 2 ? "route-pending" : "page-busy",
        });
    });
    // One phase change plus 256 reason-only changes.
    expect(getSessionActivityLog()).toHaveLength(257);
    act(() =>
      view.result.current.receivePageProgress({
        phase: "waiting_page",
        reason: "observation-limited",
      }),
    );
    expect(view.result.current.presentation?.text).toBe(
      "Auto-fill: details limited",
    );
    act(() =>
      view.result.current.receivePageProgress({
        phase: "signed_in",
        reason: "left-signin-page",
      }),
    );
    expect(view.result.current.presentation?.text).toBe("Auto-fill: signed in");
  });
  it("records new phases, the hand-off and the terminal fingerprint in the session activity log using fixed text", () => {
    const view = fixture();
    act(() => {
      view.result.current.receivePageProgress({
        phase: "waiting_page",
        reason: "route-pending",
        trace: { fingerprint: fingerprint({ hash: "empty" }) },
      });
      view.result.current.receivePageProgress({
        phase: "stopped",
        reason: "interactive-step-required",
        trace: {
          steps: [{ t: 40, phase: "waiting_page", reason: "route-pending" }],
          fingerprint: fingerprint({ hash: "approve", stage: "account" }),
          handoff: "approve",
        },
      });
    });
    const log = getSessionActivityLog();
    expect(log.map((entry) => entry.code)).toEqual(["stopped", "waiting_page"]);
    expect(log[1].details).not.toContain("fingerprint");
    expect(log[0].details).toContain("interactive sign-in step");
    expect(log[0].details).toContain(
      "DSM is waiting for sign-in approval in Synology Secure SignIn.",
    );
    expect(log[0].details).toContain(
      "Page fingerprint: root 1, panel 1, form 1, field 1, button 1, route approve, document complete, stage account.",
    );
  });
});
