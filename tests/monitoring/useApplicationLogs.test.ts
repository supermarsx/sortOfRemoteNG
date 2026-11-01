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
  vi.restoreAllMocks();
});

describe("native application log reads", () => {
  it("reads changed file metadata once and keeps current text while its update is pending", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await act(async () => {});
    const pending = deferred<ApplicationLogContent>();
    const changed = [
      { ...files[0], modifiedUnixMs: files[0].modifiedUnixMs + 1 },
      files[1],
    ];
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files: changed, truncated: false }
        : pending.promise,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(readCount()).toBe(2);
    expect(result.current.content?.text).toBe("application:latest");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(readCount()).toBe(2);
    await act(async () =>
      pending.resolve({ text: "changed", truncated: false }),
    );
    expect(result.current.content?.text).toBe("changed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(readCount()).toBe(2);
    await act(async () => result.current.refresh());
    expect(readCount()).toBe(3);
  });
  it("pauses metadata I/O while hidden and catches up once visible", async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const { result } = renderHook(() => useApplicationLogs("browser", true));
    await act(async () => {});
    const count = mocks.invoke.mock.calls.length;
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(count);
    visibility.mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(count + 1);
    expect(readCount()).toBe(1);
    expect(result.current.autoRefresh).toBe(true);
  });
  it("selection pause retains the live preference, content and lock listener without refetching", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ paused }) =>
        useApplicationLogs("browser", true, "owner", true, paused),
      { initialProps: { paused: false } },
    );
    await act(async () => {});
    const content = result.current.content;
    const count = mocks.invoke.mock.calls.length;
    rerender({ paused: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(count);
    expect(mocks.listen).toHaveBeenCalledTimes(1);
    expect(mocks.off).not.toHaveBeenCalled();
    expect(result.current.content).toBe(content);
    expect(result.current.autoRefresh).toBe(true);
    rerender({ paused: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(count + 1);
    expect(readCount()).toBe(1);
  });
  it("keeps a user-disabled live preference across inactive and active transitions", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ active }) => useApplicationLogs("application", active),
      { initialProps: { active: true } },
    );
    await act(async () => {});
    act(() => result.current.setAutoRefresh(false));
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});
    const count = mocks.invoke.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(count);
    expect(result.current.autoRefresh).toBe(false);
  });
  it("coalesces repeated manual requests behind one pending native read", async () => {
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await waitFor(() => expect(result.current.content).not.toBeNull());
    const pending = deferred<ApplicationLogContent>();
    let nextRead = 0;
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : ++nextRead === 1
          ? pending.promise
          : { text: "latest explicit request", truncated: false },
    );
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(readCount()).toBe(2));
    act(() => {
      void result.current.refresh();
      void result.current.refresh();
      void result.current.refresh();
    });
    expect(readCount()).toBe(2);
    await act(async () =>
      pending.resolve({ text: "superseded", truncated: false }),
    );
    await waitFor(() =>
      expect(result.current.content?.text).toBe("latest explicit request"),
    );
    expect(readCount()).toBe(3);
  });
  it.each([
    { ...files[0], name: {} },
    { ...files[0], modifiedUnixMs: NaN },
    { ...files[0], id: "../outside" },
  ])(
    "rejects malformed file rows before selecting or reading",
    async (invalid) => {
      mocks.invoke.mockResolvedValue({ files: [invalid], truncated: false });
      const { result } = renderHook(() =>
        useApplicationLogs("application", true),
      );
      await waitFor(() =>
        expect(result.current.error).toContain("invalid file list"),
      );
      expect(readCount()).toBe(0);
      expect(result.current.content).toBeNull();
    },
  );
  it("rejects oversized native text without retaining it", async () => {
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : { text: "x".repeat(262145), truncated: false },
    );
    const { result } = renderHook(() =>
      useApplicationLogs("application", true),
    );
    await waitFor(() =>
      expect(result.current.error).toContain("invalid response"),
    );
    expect(result.current.content).toBeNull();
  });
  it("recent mode follows new files on refresh while archived selections stay pinned", async () => {
    const { result, rerender } = renderHook(
      ({ recent }) => useApplicationLogs("browser", true, "owner", recent),
      { initialProps: { recent: true } },
    );
    await waitFor(() => expect(result.current.selectedId).toBe("latest"));
    const newer = {
      ...files[0],
      id: "newest",
      modifiedUnixMs: files[0].modifiedUnixMs + 1000,
    };
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "application_logs_list"
        ? { files: [newer, ...files], truncated: false }
        : { text: args.id, truncated: false },
    );
    await act(async () => result.current.refresh());
    expect(result.current.selectedId).toBe("newest");
    rerender({ recent: false });
    await act(async () => result.current.selectFile("older"));
    await act(async () => result.current.refresh());
    expect(result.current.selectedId).toBe("older");
  });
  it("owner replacement clears displayed content and rejects old in-flight reads", async () => {
    const { result, rerender } = renderHook(
      ({ owner }) => useApplicationLogs("application", true, owner),
      { initialProps: { owner: "old-owner" } },
    );
    await waitFor(() => expect(result.current.content).not.toBeNull());
    const pending = deferred<ApplicationLogContent>();
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : pending.promise,
    );
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(readCount()).toBe(2));
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: false }
        : { text: "new-owner", truncated: false },
    );
    rerender({ owner: "new-owner" });
    expect(result.current.content).toBeNull();
    await act(async () =>
      pending.resolve({ text: "old-owner-private", truncated: false }),
    );
    await waitFor(() => expect(result.current.content?.text).toBe("new-owner"));
    expect(result.current.content?.text).toBe("new-owner");
  });
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
    expect(result.current.autoRefresh).toBe(true);
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
    let latest: Promise<void>;
    act(() => {
      latest = result.current.selectFile("latest");
    });
    await act(async () =>
      pending.resolve({ text: "stale secret", truncated: false }),
    );
    await act(async () => latest!);
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
    await act(async () =>
      pending.resolve({ text: "old application secret", truncated: false }),
    );
    await waitFor(() =>
      expect(result.current.content?.text).toBe("browser only"),
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
  it("live metadata checks default on, skip unchanged decryption, and serialize slow reads", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ active }) => useApplicationLogs("browser", active),
      { initialProps: { active: true } },
    );
    await act(async () => {});
    expect(result.current.content).not.toBeNull();
    const revision = result.current.revision;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(readCount()).toBe(1);
    expect(result.current.isCurrent(revision)).toBe(true);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "application_logs_list",
      ).length,
    ).toBeGreaterThan(1);
    const pending = deferred<ApplicationLogContent>();
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? {
            files: [{ ...files[0], sizeBytes: 400 }, files[1]],
            truncated: false,
          }
        : pending.promise,
    );
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
