import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProxyRequestLogSync } from "../../src/hooks/settings/useProxyRequestLogSync";
import {
  normalizeProxyRequestLogLimit,
  validateProxyRequestLogLimit,
} from "../../src/utils/settings/proxyRequestLog";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  available: true,
  windowLabel: "main",
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: mocks.windowLabel }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (mocks.available ? mocks.invoke : null),
}));

beforeEach(() => {
  mocks.available = true;
  mocks.windowLabel = "main";
  mocks.invoke.mockReset().mockImplementation(async (_command, args) => ({
    capacity: args.capacity,
    retained: 0,
  }));
});

describe("proxy request log configuration", () => {
  it("never lets a detached window's stale zero reset the shared native log", async () => {
    mocks.windowLabel = "detached-fixture";
    const { result, rerender } = renderHook(
      ({ ready }) => useProxyRequestLogSync(0, ready),
      { initialProps: { ready: true } },
    );
    await waitFor(() => expect(result.current.managedByMainWindow).toBe(true));
    expect(mocks.invoke).not.toHaveBeenCalled();
    rerender({ ready: false });
    rerender({ ready: true });
    await waitFor(() => expect(result.current.managedByMainWindow).toBe(true));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("defaults older settings and strictly bounds explicit changes", () => {
    expect(normalizeProxyRequestLogLimit(undefined)).toBe(10000);
    for (const invalid of [-1, 100001, 1.1, NaN, Infinity, "100", null]) {
      expect(() => validateProxyRequestLogLimit(invalid)).toThrow();
      expect(normalizeProxyRequestLogLimit(invalid)).toBe(10000);
    }
    for (const valid of [0, 1, 10000, 100000])
      expect(validateProxyRequestLogLimit(valid)).toBe(valid);
  });

  it("waits for settings readiness and applies zero without changing recording", async () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useProxyRequestLogSync(0, ready),
      { initialProps: { ready: false } },
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.appliedLimit).toBe(0));
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "set_proxy_request_log_capacity",
      { capacity: 0 },
    );
  });

  it("serializes superseding changes and never publishes stale completion", async () => {
    let resolveFirst!: (value: { capacity: number; retained: number }) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ limit }) => useProxyRequestLogSync(limit, true),
      { initialProps: { limit: 10000 } },
    );
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    rerender({ limit: 0 });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst({ capacity: 10000, retained: 1 }));
    await waitFor(() => expect(result.current.appliedLimit).toBe(0));
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "set_proxy_request_log_capacity",
      { capacity: 0 },
    );
  });

  it("reports sanitized failure and retries only explicitly", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("private upstream detail"));
    const { result } = renderHook(() => useProxyRequestLogSync(10000, true));
    await waitFor(() =>
      expect(result.current.error).toContain("could not be applied"),
    );
    expect(result.current.error).not.toContain("private");
    expect(result.current.appliedLimit).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.appliedLimit).toBe(10000));
    expect(result.current.error).toBeNull();
  });

  it("refuses malformed success responses and missing native runtime", async () => {
    mocks.invoke.mockResolvedValueOnce({ capacity: 10, retained: 11 });
    const { result } = renderHook(() => useProxyRequestLogSync(10, true));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.appliedLimit).toBeNull();
    mocks.available = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).not.toBeNull();
  });

  it("does not publish a completion after lock or unmount", async () => {
    let resolveFirst!: (value: { capacity: number; retained: number }) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result, rerender, unmount } = renderHook(
      ({ ready }) => useProxyRequestLogSync(10, ready),
      { initialProps: { ready: true } },
    );
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    rerender({ ready: false });
    await act(async () => resolveFirst({ capacity: 10, retained: 0 }));
    expect(result.current.appliedLimit).toBeNull();
    expect(result.current.pending).toBe(false);
    unmount();
  });
});
