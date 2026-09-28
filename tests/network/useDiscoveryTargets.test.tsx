import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDiscoveryTargets } from "../../src/hooks/network/useDiscoveryTargets";
import { NETWORK_TARGET_HISTORY_KEY } from "../../src/utils/discovery/networkTargets";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => {
  localStorage.removeItem(NETWORK_TARGET_HISTORY_KEY);
  invoke.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("refreshes lazily, reports failure, and allows retry", async () => {
  invoke
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([
      { interfaceName: "eth0", address: "10.0.4.2", cidr: "10.0.0.0/16" },
    ]);
  const { result } = renderHook(() => useDiscoveryTargets(true));
  expect(invoke).not.toHaveBeenCalled();
  await act(() => result.current.refreshInterfaces());
  expect(result.current.interfaceStatus).toBe("error");
  await act(() => result.current.refreshInterfaces());
  expect(result.current.interfaceStatus).toBe("ready");
  expect(result.current.interfaces[0]).toMatchObject({
    cidr: "10.0.0.0/16",
    target: "10.0.0.0/19",
    isSlice: true,
  });
  expect(invoke.mock.calls).toEqual([
    ["detect_interface_subnets"],
    ["detect_interface_subnets"],
  ]);
});

it("ignores non-native refresh and rejects malformed native responses", async () => {
  const { result, rerender } = renderHook(
    ({ native }) => useDiscoveryTargets(native),
    { initialProps: { native: false } },
  );
  await act(() => result.current.refreshInterfaces());
  expect(invoke).not.toHaveBeenCalled();
  rerender({ native: true });
  invoke.mockResolvedValue({ interfaces: [] });
  await act(() => result.current.refreshInterfaces());
  expect(result.current.interfaceStatus).toBe("error");
});

it("keeps recent individual targets usable when writes fail and synchronizes storage events", async () => {
  const { result } = renderHook(() => useDiscoveryTargets(false));
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  act(() => result.current.remember("10.0.0.1,2001:0db8::1\n10.0.0.2"));
  expect(result.current.history).toEqual([
    "10.0.0.1",
    "2001:db8::1",
    "10.0.0.2",
  ]);
  expect(set).toHaveBeenCalledTimes(1);
  set.mockRestore();
  localStorage.setItem(NETWORK_TARGET_HISTORY_KEY, '["192.0.2.1"]');
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: NETWORK_TARGET_HISTORY_KEY }),
    ),
  );
  await waitFor(() => expect(result.current.history).toEqual(["192.0.2.1"]));
  act(() => result.current.clearHistory());
  expect(result.current.history).toEqual([]);
  expect(localStorage.getItem(NETWORK_TARGET_HISTORY_KEY)).toBeNull();
});

it("bounds a stalled refresh and permits retry without accepting the late reply", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  invoke
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce([]);
  const { result } = renderHook(() => useDiscoveryTargets(true));
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.refreshInterfaces();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
    await refresh;
  });
  expect(result.current.interfaceStatus).toBe("error");
  await act(() => result.current.refreshInterfaces());
  await act(async () => {
    resolve([
      { interfaceName: "late", address: "10.0.0.1", cidr: "10.0.0.0/24" },
    ]);
  });
  expect(result.current.interfaceStatus).toBe("ready");
  expect(result.current.interfaces).toEqual([]);
});

it("coalesces concurrent refreshes and does not update after unmount", async () => {
  let resolve!: (value: unknown) => void;
  invoke.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, unmount } = renderHook(() => useDiscoveryTargets(true));
  let first!: Promise<void>;
  act(() => {
    first = result.current.refreshInterfaces();
    void result.current.refreshInterfaces();
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  const before = result.current;
  unmount();
  await act(async () => {
    resolve([]);
    await first;
  });
  expect(result.current).toBe(before);
});
