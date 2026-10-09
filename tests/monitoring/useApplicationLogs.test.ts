import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApplicationLogs } from "../../src/hooks/monitoring/useApplicationLogs";
import type {
  ApplicationLogContent,
  ApplicationLogSource,
} from "../../src/types/monitoring/applicationLogs";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  off: vi.fn(),
  locked: undefined as undefined | (() => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
const files = [
  {
    id: "latest",
    name: "app-20261009.log",
    modifiedUnixMs: 1791558000000,
    sizeBytes: 300,
    encrypted: true,
  },
  {
    id: "older",
    name: "app-20261008.log",
    modifiedUnixMs: 1791471600000,
    sizeBytes: 200,
    encrypted: false,
  },
];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const readCount = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === "application_logs_read",
  ).length;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listen.mockImplementation(async (_event, callback) => {
    mocks.locked = callback;
    return mocks.off;
  });
  mocks.invoke.mockImplementation(async (command, args) =>
    command === "application_logs_list"
      ? { files, truncated: false }
      : { text: `${args.source}:${args.id}`, truncated: false },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("native application log reads", () => {
  it("loads only fixed-source IDs after subscribing to storage locks", async () => {
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await waitFor(() =>
      expect(result.current.content?.text).toBe("application:latest"),
    );
    expect(mocks.invoke.mock.calls).toEqual([
      ["application_logs_list", { source: "application" }],
      ["application_logs_read", { source: "application", id: "latest" }],
    ]);
    expect(result.current.autoRefresh).toBe(false);
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder[0],
    );
  });
  it("does not access files when inactive", async () => {
    const { result } = renderHook(() => useApplicationLogs("browser", false));
    expect(result.current.content).toBeNull();
    await act(async () => result.current.refresh());
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
  it("clears content while selecting and ignores an older read completing last", async () => {
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await waitFor(() => expect(result.current.content).not.toBeNull());
    const pending = deferred<ApplicationLogContent>();
    mocks.invoke.mockImplementation(async (_command, args) =>
      args.id === "older"
        ? pending.promise
        : { text: "fresh", truncated: false },
    );
    act(() => {
      void result.current.selectFile("older");
    });
    expect(result.current.content).toBeNull();
    await act(async () => result.current.selectFile("latest"));
    await act(async () =>
      pending.resolve({ text: "stale secret", truncated: false }),
    );
    expect(result.current.content?.text).toBe("fresh");
  });
  it("discards in-flight content when switching sources or hiding the view", async () => {
    const pending = deferred<ApplicationLogContent>();
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : args.source === "application"
          ? pending.promise
          : { text: "browser only", truncated: false },
    );
    const { result, rerender } = renderHook(
      ({ source, active }: { source: ApplicationLogSource; active: boolean }) =>
        useApplicationLogs(source, active),
      { initialProps: { source: "application", active: true } },
    );
    await waitFor(() => expect(readCount()).toBe(1));
    rerender({ source: "browser", active: true });
    expect(result.current.content).toBeNull();
    await waitFor(() =>
      expect(result.current.content?.text).toBe("browser only"),
    );
    await act(async () =>
      pending.resolve({ text: "old application secret", truncated: false }),
    );
    expect(result.current.content?.text).toBe("browser only");
    rerender({ source: "browser", active: false });
    expect(result.current.content).toBeNull();
    expect(mocks.off).toHaveBeenCalledTimes(2);
  });
  it.each(["application_logs_read", "application_logs_list"])(
    "clears previous text and exposes %s failure",
    async (commandToFail) => {
      const { result } = renderHook(() =>
        useApplicationLogs("application", true),
      );
      await waitFor(() => expect(result.current.content).not.toBeNull());
      mocks.invoke.mockImplementation(async (command) => {
        if (command === commandToFail) throw "Application storage is locked.";
        return { files, truncated: false };
      });
      await act(async () => result.current.refresh());
      expect(result.current.content).toBeNull();
      expect(result.current.error).toBe("Application storage is locked.");
      expect(result.current.loading).toBe(false);
    },
  );
  it("auto refresh is opt-in, visible-only and does not overlap slow reads", async () => {
    const { result, rerender } = renderHook(
      ({ active }) => useApplicationLogs("browser", active),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(result.current.content).not.toBeNull());
    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(readCount()).toBe(1);
    const pending = deferred<ApplicationLogContent>();
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : pending.promise,
    );
    act(() => result.current.setAutoRefresh(true));
    await act(async () => vi.advanceTimersByTimeAsync(35_000));
    expect(readCount()).toBe(2);
    rerender({ active: false });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(readCount()).toBe(2);
    await act(async () =>
      pending.resolve({ text: "hidden", truncated: false }),
    );
    expect(result.current.content).toBeNull();
  });
  it("storage lock clears content, stops auto refresh and fences pending reads", async () => {
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await waitFor(() => expect(result.current.content).not.toBeNull());
    const pending = deferred<ApplicationLogContent>();
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : pending.promise,
    );
    act(() => {
      result.current.setAutoRefresh(true);
      void result.current.refresh();
    });
    await waitFor(() => expect(readCount()).toBe(2));
    act(() => mocks.locked?.());
    expect(result.current.content).toBeNull();
    expect(result.current.files).toEqual([]);
    expect(result.current.autoRefresh).toBe(false);
    await act(async () =>
      pending.resolve({ text: "revoked secret", truncated: false }),
    );
    expect(result.current.content).toBeNull();
    expect(result.current.error).toContain("locked");
  });
  it("waits for lock subscription and allows manual retry after subscription failure", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("Native events unavailable"));
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await waitFor(() =>
      expect(result.current.error).toBe("Native events unavailable"),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => result.current.refresh());
    await waitFor(() =>
      expect(result.current.content?.text).toBe("application:latest"),
    );
  });
  it("rejects IDs not returned by enumeration and handles empty bounded listings", async () => {
    mocks.invoke.mockResolvedValue({ files: [], truncated: true });
    const { result } = renderHook(() => useApplicationLogs("browser", true));
    await waitFor(() => expect(result.current.truncated).toBe(true));
    await act(async () => result.current.selectFile("../../private"));
    expect(readCount()).toBe(0);
    expect(result.current.content).toBeNull();
  });
});
