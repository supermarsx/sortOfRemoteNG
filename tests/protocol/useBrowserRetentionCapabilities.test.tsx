import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserRetentionCapabilities } from "../../src/hooks/protocol/useBrowserRetentionCapabilities";

const transport = vi.hoisted(() => ({ getInvoke: vi.fn(), invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: transport.getInvoke,
}));
const unavailable = {
  memory: false,
  encryptedDatabase: false,
  policyExpiration: false,
  clearOnDatabaseLock: false,
};
const supported = {
  memory: true,
  encryptedDatabase: true,
  policyExpiration: true,
  clearOnDatabaseLock: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  transport.invoke.mockReset().mockResolvedValue(unavailable);
  transport.getInvoke.mockReset().mockResolvedValue(transport.invoke);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native browser retention capabilities", () => {
  it("stays unavailable until a complete native response and sends no arguments or owner identifiers", async () => {
    const reply = deferred<unknown>();
    transport.invoke.mockReturnValue(reply.promise);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    expect(result.current).toEqual(unavailable);
    await flush();
    expect(transport.invoke.mock.calls).toEqual([
      ["origin_browser_retention_capabilities"],
    ]);
    await act(async () => reply.resolve(supported));
    expect(result.current).toEqual(supported);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not probe when disabled or poll when Tauri is missing", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useBrowserRetentionCapabilities(enabled),
      { initialProps: { enabled: false } },
    );
    await flush();
    expect(transport.getInvoke).not.toHaveBeenCalled();
    transport.getInvoke.mockResolvedValue(null);
    rerender({ enabled: true });
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(transport.getInvoke).toHaveBeenCalledTimes(1);
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(result.current).toEqual(unavailable);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("backs off unavailable support and discovers later native admission", async () => {
    transport.invoke
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValue(supported);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(transport.invoke).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current).toEqual(supported);
    expect(transport.invoke).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(transport.invoke).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("requires encryptedDatabase in the reply instead of inferring support from an older backend", async () => {
    transport.invoke
      .mockResolvedValueOnce({
        memory: true,
        encryptedLocal: true,
        policyExpiration: true,
        clearOnDatabaseLock: true,
      })
      .mockResolvedValue(supported);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    expect(result.current).toEqual(unavailable);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(result.current).toEqual(supported);
    unmount();
  });

  it("honors an explicit database denial even if a legacy sidecar flag is also present", async () => {
    transport.invoke.mockResolvedValue({
      ...supported,
      encryptedDatabase: false,
      encryptedLocal: true,
    });
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    expect(result.current).toEqual({ ...supported, encryptedDatabase: false });
    expect(result.current).not.toHaveProperty("encryptedLocal");
    unmount();
  });

  it("clears previously reported support on command failure without rapid retries", async () => {
    transport.invoke
      .mockResolvedValueOnce(supported)
      .mockRejectedValue(new Error("missing command"));
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    expect(result.current).toEqual(supported);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(result.current).toEqual(unavailable);
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(transport.invoke).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("retracts capabilities when native admission or the patched bridge becomes unavailable", async () => {
    transport.invoke
      .mockResolvedValueOnce(supported)
      .mockResolvedValue(unavailable);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    expect(result.current).toEqual(supported);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(result.current).toEqual(unavailable);
    unmount();
  });

  it("requires a fresh native reply after returning from a hidden settings window", async () => {
    const stale = deferred<unknown>();
    const fresh = deferred<unknown>();
    transport.invoke
      .mockResolvedValueOnce(supported)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    expect(result.current).toEqual(supported);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toEqual(unavailable);
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(transport.invoke).toHaveBeenCalledTimes(2);
    await act(async () => stale.resolve(supported));
    expect(result.current).toEqual(unavailable);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(transport.invoke).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual(unavailable);
    await act(async () => fresh.resolve(supported));
    expect(result.current).toEqual(supported);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    undefined,
    null,
    [],
    true,
    { memory: true },
    { ...supported, encryptedDatabase: "true" },
  ])("rejects incomplete or malformed replies: %j", async (reply) => {
    transport.invoke.mockResolvedValue(reply);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    expect(result.current).toEqual(unavailable);
    unmount();
  });

  it("clears stale support after the deadline without overlapping a hung command or accepting its late reply", async () => {
    const reply = deferred<unknown>();
    transport.invoke
      .mockResolvedValueOnce(supported)
      .mockReturnValue(reply.promise);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current).toEqual(unavailable);
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(transport.invoke).toHaveBeenCalledTimes(2);
    await act(async () => reply.resolve(supported));
    expect(result.current).toEqual(unavailable);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a deferred reply after unmount and never schedules another poll", async () => {
    const reply = deferred<unknown>();
    transport.invoke.mockReturnValue(reply.promise);
    const { result, unmount } = renderHook(() =>
      useBrowserRetentionCapabilities(),
    );
    await flush();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => reply.resolve(supported));
    expect(result.current).toEqual(unavailable);
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not invoke after unmount while runtime discovery is pending", async () => {
    const discovery = deferred<typeof transport.invoke>();
    transport.getInvoke.mockReturnValue(discovery.promise);
    const { unmount } = renderHook(() => useBrowserRetentionCapabilities());
    unmount();
    await act(async () => discovery.resolve(transport.invoke));
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disables immediately and ignores the preceding request after re-enabling", async () => {
    const oldReply = deferred<unknown>();
    transport.invoke
      .mockReturnValueOnce(oldReply.promise)
      .mockResolvedValue(unavailable);
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useBrowserRetentionCapabilities(enabled),
      { initialProps: { enabled: true } },
    );
    await flush();
    rerender({ enabled: false });
    expect(result.current).toEqual(unavailable);
    rerender({ enabled: true });
    await flush();
    await act(async () => oldReply.resolve(supported));
    expect(result.current).toEqual(unavailable);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses native polling while hidden and resumes when the settings window is visible", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const { unmount } = renderHook(() => useBrowserRetentionCapabilities());
    await flush();
    expect(transport.invoke).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(transport.invoke).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(transport.invoke).toHaveBeenCalledTimes(1);
    unmount();
    visibility.mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(transport.invoke).toHaveBeenCalledTimes(1);
  });
});
