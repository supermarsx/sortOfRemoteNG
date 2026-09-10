import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutomationLibraryApi } from "../../src/hooks/recording/useAutomationLibraryApi";
const native = vi.hoisted(() => ({
  settingsReady: true,
  invoke: vi.fn(),
  listen: vi.fn(),
  locked: null as null | (() => void),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settingsReady: native.settingsReady }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => native.listen(...args),
}));
beforeEach(() => {
  native.settingsReady = true;
  native.invoke.mockReset().mockResolvedValue(null);
  native.listen
    .mockReset()
    .mockImplementation(async (_event: string, callback: () => void) => {
      native.locked = callback;
      return vi.fn();
    });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("fails closed with actionable listener diagnostic and explicit retry", async () => {
  native.listen.mockRejectedValueOnce(new Error("PRIVATE_NATIVE_PATH"));
  const { result } = renderHook(() => useAutomationLibraryApi());
  await waitFor(() =>
    expect(result.current.diagnostic?.code).toBe("backend-unavailable"),
  );
  expect(result.current.ready).toBe(false);
  expect(result.current.databaseScope).toBeNull();
  expect(JSON.stringify(result.current.diagnostic)).not.toContain(
    "PRIVATE_NATIVE_PATH",
  );
  await expect(
    result.current.api.read({ kind: "app" }, "website-script"),
  ).rejects.toThrow("initialize");
  expect(native.invoke).not.toHaveBeenCalled();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(
    (await result.current.api.read({ kind: "app" }, "website-script")).entries,
  ).toEqual([]);
});
it("invalidates existing reviews on lock and increments visible revocation epoch", async () => {
  const { result } = renderHook(() => useAutomationLibraryApi());
  await waitFor(() => expect(result.current.ready).toBe(true));
  const snapshot = await result.current.api.read(
      { kind: "app" },
      "website-script",
    ),
    before = result.current.accessEpoch;
  act(() => native.locked!());
  expect(result.current.accessEpoch).toBeGreaterThan(before);
  await expect(result.current.api.apply(snapshot, [])).rejects.toThrow(
    "review",
  );
});
it("ignores disposed listener failure after a new ready lifecycle", async () => {
  let reject!: (error: Error) => void;
  native.listen.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const { result, rerender } = renderHook(() => useAutomationLibraryApi());
  await waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
  native.settingsReady = false;
  rerender();
  native.settingsReady = true;
  rerender();
  await waitFor(() => expect(result.current.ready).toBe(true));
  const currentEpoch = result.current.accessEpoch;
  await act(async () => {
    reject(new Error("stale listener failure"));
    await Promise.resolve();
  });
  expect(result.current.diagnostic).toBeNull();
  expect(result.current.accessEpoch).toBe(currentEpoch);
  expect(result.current.ready).toBe(true);
});
