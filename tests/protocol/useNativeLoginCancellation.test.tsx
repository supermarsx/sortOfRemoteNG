import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNativeLoginCancellation,
  type NativeLoginCancellationTarget,
} from "../../src/hooks/protocol/useNativeLoginCancellation";
const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
const target = {
  ownerDatabaseId: "db",
  connectionId: "connection",
  sessionId: "session",
  attemptId: "attempt",
};
const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  h.invoke.mockReset().mockResolvedValue(true);
});
describe("attempt-scoped automatic login cancellation", () => {
  it("sends the exact attempt identity once and reports only confirmed cancellation", async () => {
    const reply = deferred();
    h.invoke.mockReturnValue(reply.promise);
    const view = renderHook(() => useNativeLoginCancellation(target));
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.cancel();
    });
    await act(async () => {
      await view.result.current.cancel();
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("origin_browser_cancel_login", {
      request: { identity: target, reason: "user-cancelled" },
    });
    expect(view.result.current.busy).toBe(true);
    expect(view.result.current.message).toBe("");
    await act(async () => {
      reply.resolve(true);
      await pending;
    });
    expect(view.result.current.message).toContain("Automatic login cancelled");
    expect(view.result.current.available).toBe(false);
  });
  it("does not label a false receipt as cancellation", async () => {
    h.invoke.mockResolvedValue(false);
    const view = renderHook(() => useNativeLoginCancellation(target));
    await act(async () => {
      await view.result.current.cancel();
    });
    expect(view.result.current.message).toContain("already ended or changed");
    expect(view.result.current.message).not.toContain("cancelled");
  });
  it.each([new Error("SECRET_NATIVE_ERROR"), "invalid-receipt"])(
    "reports unconfirmed cancellation without exposing native details",
    async (failure) => {
      if (failure instanceof Error) h.invoke.mockRejectedValueOnce(failure);
      else h.invoke.mockResolvedValueOnce(failure);
      const view = renderHook(() => useNativeLoginCancellation(target));
      await act(async () => {
        await view.result.current.cancel();
      });
      expect(view.result.current.message).toContain("was not confirmed");
      expect(view.result.current.message).not.toContain("SECRET");
      expect(view.result.current.available).toBe(true);
      await act(async () => {
        await view.result.current.cancel();
      });
      expect(h.invoke).toHaveBeenCalledTimes(2);
    },
  );
  it("discards replies after an attempt change, including a return to the same identity", async () => {
    const reply = deferred();
    h.invoke.mockReturnValue(reply.promise);
    const view = renderHook(
      (value: NativeLoginCancellationTarget | null) =>
        useNativeLoginCancellation(value),
      { initialProps: target as NativeLoginCancellationTarget | null },
    );
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.cancel();
    });
    view.rerender(null);
    view.rerender(target);
    await act(async () => {
      reply.resolve(true);
      await pending;
    });
    expect(view.result.current.message).toBe("");
    expect(view.result.current.available).toBe(true);
  });
  it("does not invoke for a missing owner/attempt and ignores late unmount replies", async () => {
    const view = renderHook(
      (value: NativeLoginCancellationTarget | null) =>
        useNativeLoginCancellation(value),
      { initialProps: null as NativeLoginCancellationTarget | null },
    );
    await act(async () => {
      await view.result.current.cancel();
    });
    expect(h.invoke).not.toHaveBeenCalled();
    view.rerender(target);
    const reply = deferred();
    h.invoke.mockReturnValue(reply.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.cancel();
    });
    view.unmount();
    await act(async () => {
      reply.resolve(true);
      await pending;
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});
