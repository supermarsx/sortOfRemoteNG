import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  clearDeletedConnectionBrowserData,
  deletedWebConnectionIds,
} from "../../src/utils/connection/clearDeletedConnectionBrowserData";

const row = (id: string, protocol: string, extra: Partial<Connection> = {}) =>
  ({ id, name: id, protocol, hostname: "h", ...extra }) as Connection;

const before = [
  row("folder", "rdp", { isGroup: true }),
  row("web-1", "https", { parentId: "folder" }),
  row("web-2", "http"),
  row("ssh", "ssh"),
  row("kept", "https"),
];

afterEach(() => vi.restoreAllMocks());

describe("clearing browser data of deleted connections", () => {
  it("selects only deleted web connections, including folder descendants", () => {
    expect(deletedWebConnectionIds(before, [before[4]])).toEqual([
      "web-1",
      "web-2",
    ]);
    expect(deletedWebConnectionIds(before, before)).toEqual([]);
  });

  it("calls the clear command once per deleted web connection with cookies and cache", () => {
    const clear = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        cookiesCleared: true,
        cacheCleared: true,
        cachePendingRestart: false,
      },
    });
    clearDeletedConnectionBrowserData(before, [before[3], before[4]], clear);
    expect(clear.mock.calls).toEqual([
      [{ connectionId: "web-1", cookies: true, cache: true }],
      [{ connectionId: "web-2", cookies: true, cache: true }],
    ]);
  });

  it("returns synchronously without waiting for a pending clear", () => {
    const clear = vi.fn(() => new Promise<never>(() => {}));
    const result = clearDeletedConnectionBrowserData(
      before,
      [before[4]],
      clear,
    );
    expect(result).toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("never throws and only logs failures; unavailable runtimes stay quiet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clear = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync failure");
      })
      .mockRejectedValueOnce(new Error("async failure"));
    expect(() =>
      clearDeletedConnectionBrowserData(before, [before[4]], clear),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockClear();
    const refusals = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unavailable" })
      .mockResolvedValueOnce({ ok: false, error: "browser-session-open" });
    clearDeletedConnectionBrowserData(before, [before[4]], refusals);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("browser-session-open");
  });

  it("does nothing when no web connection was deleted", () => {
    const clear = vi.fn();
    clearDeletedConnectionBrowserData(before, before.slice(1), clear);
    clearDeletedConnectionBrowserData([], [], clear);
    expect(clear).not.toHaveBeenCalled();
  });
});
