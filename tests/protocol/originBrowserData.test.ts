import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyOriginBrowserDataError,
  clearAllHttpCache,
  clearConnectionData,
  formatCacheBytes,
  getHttpCacheUsage,
} from "../../src/services/originBrowserData";

const transport = vi.hoisted(() => ({ getInvoke: vi.fn(), invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: transport.getInvoke,
}));

beforeEach(() => {
  transport.invoke.mockReset();
  transport.getInvoke.mockReset().mockResolvedValue(transport.invoke);
});

describe("origin browser data commands (C-H5)", () => {
  it("clears connection data with the exact command, arguments and reply shape", async () => {
    transport.invoke.mockResolvedValue({
      cookiesCleared: true,
      cacheCleared: false,
      cachePendingRestart: true,
    });
    await expect(
      clearConnectionData({ connectionId: "c-1", cookies: true, cache: true }),
    ).resolves.toEqual({
      ok: true,
      value: {
        cookiesCleared: true,
        cacheCleared: false,
        cachePendingRestart: true,
      },
    });
    expect(transport.invoke.mock.calls).toEqual([
      [
        "origin_browser_clear_connection_data",
        { request: { connectionId: "c-1", cookies: true, cache: true } },
      ],
    ]);
  });

  it("maps an open browser session to its own error", async () => {
    transport.invoke.mockRejectedValue("browser-session-open");
    await expect(
      clearConnectionData({ connectionId: "c", cookies: false, cache: true }),
    ).resolves.toEqual({ ok: false, error: "browser-session-open" });
  });

  it.each([
    "command origin_browser_clear_connection_data not found",
    "The packaged real-origin browser is unavailable. No website was opened and no direct-network fallback was used.",
    new Error("Unknown command"),
  ])("degrades to unavailable for %s", async (error) => {
    transport.invoke.mockRejectedValue(error);
    await expect(
      clearConnectionData({ connectionId: "c", cookies: true, cache: false }),
    ).resolves.toEqual({ ok: false, error: "unavailable" });
    await expect(clearAllHttpCache()).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
    await expect(getHttpCacheUsage("c")).resolves.toEqual({
      available: false,
      reason: "unavailable",
      bytes: 0,
      limitBytes: 0,
    });
  });

  it("is unavailable without a Tauri runtime and never invokes", async () => {
    transport.getInvoke.mockResolvedValue(null);
    await expect(
      clearConnectionData({ connectionId: "c", cookies: true, cache: true }),
    ).resolves.toEqual({ ok: false, error: "unavailable" });
    await expect(getHttpCacheUsage()).resolves.toMatchObject({
      available: false,
    });
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it("treats malformed replies and other errors as failures", async () => {
    for (const reply of [
      null,
      {},
      { cookiesCleared: "yes", cacheCleared: true, cachePendingRestart: false },
    ]) {
      transport.invoke.mockResolvedValueOnce(reply);
      await expect(
        clearConnectionData({ connectionId: "c", cookies: true, cache: true }),
      ).resolves.toEqual({ ok: false, error: "failed" });
    }
    transport.invoke.mockRejectedValueOnce("database is locked");
    await expect(
      clearConnectionData({ connectionId: "c", cookies: true, cache: true }),
    ).resolves.toEqual({ ok: false, error: "failed" });
    await expect(
      clearConnectionData({ connectionId: " ", cookies: true, cache: true }),
    ).resolves.toEqual({ ok: false, error: "failed" });
    expect(classifyOriginBrowserDataError({ message: "x" })).toBe("failed");
  });

  it("reads usage for one connection or globally and validates the reply", async () => {
    transport.invoke.mockResolvedValueOnce({
      available: true,
      bytes: 5 * 1024 * 1024,
      limitBytes: 128 * 1024 * 1024,
    });
    await expect(getHttpCacheUsage("c-2")).resolves.toEqual({
      available: true,
      bytes: 5 * 1024 * 1024,
      limitBytes: 128 * 1024 * 1024,
    });
    transport.invoke.mockResolvedValueOnce({
      available: false,
      reason: "cache-location-not-local",
      bytes: 0,
      limitBytes: 0,
    });
    await expect(getHttpCacheUsage()).resolves.toEqual({
      available: false,
      reason: "cache-location-not-local",
      bytes: 0,
      limitBytes: 0,
    });
    transport.invoke.mockResolvedValueOnce({
      available: false,
      reason: "D:/secret/path",
      bytes: 1,
      limitBytes: 2,
    });
    await expect(getHttpCacheUsage()).resolves.toMatchObject({
      reason: "unavailable",
    });
    transport.invoke.mockResolvedValueOnce({
      available: true,
      bytes: -1,
      limitBytes: 2,
    });
    await expect(getHttpCacheUsage()).resolves.toMatchObject({
      available: false,
    });
    expect(transport.invoke.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [
        [
          "origin_browser_http_cache_usage",
          { request: { connectionId: "c-2" } },
        ],
        ["origin_browser_http_cache_usage", { request: {} }],
        ["origin_browser_http_cache_usage", { request: {} }],
        ["origin_browser_http_cache_usage", { request: {} }],
      ],
    );
  });

  it("clears all caches with no arguments", async () => {
    transport.invoke.mockResolvedValue({
      cleared: true,
      pendingRestart: false,
    });
    await expect(clearAllHttpCache()).resolves.toEqual({
      ok: true,
      value: { cleared: true, pendingRestart: false },
    });
    expect(transport.invoke.mock.calls).toEqual([
      ["origin_browser_clear_all_http_cache", undefined],
    ]);
  });

  it("formats byte counts for usage lines", () => {
    expect(formatCacheBytes(0)).toBe("0.0 MB");
    expect(formatCacheBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatCacheBytes(128 * 1024 * 1024)).toBe("128 MB");
    expect(formatCacheBytes(2048 * 1024 * 1024)).toBe("2.0 GB");
  });
});
