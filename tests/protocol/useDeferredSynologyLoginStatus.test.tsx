import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseDeferredSynologyLoginStatus,
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
      expect(view.result.current.presentation?.text).toBe(
        "Saved login: status unknown",
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
});
