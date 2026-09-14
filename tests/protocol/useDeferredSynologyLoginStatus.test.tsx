import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseDeferredSynologyLoginStatus,
  parseSynologyLoginProgress,
  useDeferredSynologyLoginStatus,
} from "../../src/hooks/protocol/useDeferredSynologyLoginStatus";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
beforeEach(() => {
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
    scope: "owner-a:source-a",
    requested: true,
    valid: true,
    context: () => context,
    assertCurrent: vi.fn(),
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
      text: "Auto-fill: timed out",
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
