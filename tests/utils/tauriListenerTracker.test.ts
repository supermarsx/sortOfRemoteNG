import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dynamic import of @tauri-apps/api/event used inside tauriListenerTracker
const mockListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

// We need fresh module state per test
let trackedListen: typeof import("../../src/utils/debug/tauriListenerTracker")["trackedListen"];
let getListenerStats: typeof import("../../src/utils/debug/tauriListenerTracker")["getListenerStats"];
let getActiveListenerCount: typeof import("../../src/utils/debug/tauriListenerTracker")["getActiveListenerCount"];
let dumpListeners: typeof import("../../src/utils/debug/tauriListenerTracker")["dumpListeners"];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  // Default: listen resolves to an unlisten function
  mockListen.mockImplementation(() => Promise.resolve(vi.fn()));

  const mod = await import("../../src/utils/debug/tauriListenerTracker");
  trackedListen = mod.trackedListen;
  getListenerStats = mod.getListenerStats;
  getActiveListenerCount = mod.getActiveListenerCount;
  dumpListeners = mod.dumpListeners;
});

describe("tauriListenerTracker", () => {
  describe("trackedListen", () => {
    it("registers a listener and increments active count", async () => {
      trackedListen("my-event", vi.fn());
      // The listen call is async (dynamic import + then), so we need to flush
      await vi.dynamicImportSettled?.() ?? new Promise((r) => setTimeout(r, 0));

      expect(getActiveListenerCount()).toBe(1);
    });

    it("returns a cleanup function and a numeric id", () => {
      const { cleanup, id } = trackedListen("test-event", vi.fn());
      expect(typeof cleanup).toBe("function");
      expect(typeof id).toBe("number");
    });

    it("cleanup removes the listener from active tracking", async () => {
      const { cleanup } = trackedListen("remove-me", vi.fn());
      await new Promise((r) => setTimeout(r, 0));
      expect(getActiveListenerCount()).toBe(1);

      cleanup();
      expect(getActiveListenerCount()).toBe(0);
    });

    it("cleanup calls the unlisten function from listen()", async () => {
      const unlistenFn = vi.fn();
      mockListen.mockResolvedValue(unlistenFn);

      const { cleanup } = trackedListen("evt", vi.fn());
      await new Promise((r) => setTimeout(r, 0));

      cleanup();
      expect(unlistenFn).toHaveBeenCalledTimes(1);
    });

    it("handles cleanup called before listen resolves (pre-cancel)", async () => {
      const unlistenFn = vi.fn();
      let resolveListen!: (fn: () => void) => void;
      mockListen.mockImplementation(
        () => new Promise((resolve) => { resolveListen = resolve; }),
      );

      const { cleanup } = trackedListen("slow-evt", vi.fn());
      // Wait for the dynamic import to resolve so mockListen gets called
      await new Promise((r) => setTimeout(r, 0));

      // cleanup before listen promise resolves
      cleanup();

      // Now let the listen promise resolve
      resolveListen(unlistenFn);
      await new Promise((r) => setTimeout(r, 0));

      // The unlisten should be called immediately since cancelled
      expect(unlistenFn).toHaveBeenCalledTimes(1);
      expect(getActiveListenerCount()).toBe(0);
    });

    it("does not deliver events after cleanup is called", async () => {
      const handler = vi.fn();
      let capturedHandler: (...args: any[]) => void;
      mockListen.mockImplementation((_event: string, cb: any) => {
        capturedHandler = cb;
        return Promise.resolve(vi.fn());
      });

      const { cleanup } = trackedListen("events-check", handler);
      await new Promise((r) => setTimeout(r, 0));

      cleanup();
      // Simulate event delivery after cleanup
      capturedHandler!({ payload: "late" } as any);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("getListenerStats", () => {
    it("returns an empty object when no listeners are active", () => {
      expect(getListenerStats()).toEqual({});
    });

    it("groups counts by event name", async () => {
      trackedListen("alpha", vi.fn());
      trackedListen("alpha", vi.fn());
      trackedListen("beta", vi.fn());
      await new Promise((r) => setTimeout(r, 0));

      const stats = getListenerStats();
      expect(stats["alpha"]).toBe(2);
      expect(stats["beta"]).toBe(1);
    });
  });

  describe("getActiveListenerCount", () => {
    it("returns 0 initially", () => {
      expect(getActiveListenerCount()).toBe(0);
    });

    it("returns total active listeners", async () => {
      trackedListen("a", vi.fn());
      trackedListen("b", vi.fn());
      await new Promise((r) => setTimeout(r, 0));

      expect(getActiveListenerCount()).toBe(2);
    });
  });

  describe("dumpListeners", () => {
    it("logs to console without throwing", async () => {
      const spy = vi.spyOn(console, "group").mockImplementation(() => {});
      const spyEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});

      trackedListen("dump-test", vi.fn());
      await new Promise((r) => setTimeout(r, 0));

      expect(() => dumpListeners()).not.toThrow();
      expect(spy).toHaveBeenCalled();
      expect(spyEnd).toHaveBeenCalled();

      spy.mockRestore();
      spyEnd.mockRestore();
    });
  });

  describe("error handling", () => {
    it("removes listener from active map when listen() rejects", async () => {
      mockListen.mockRejectedValue(new Error("listen failed"));

      trackedListen("fail-evt", vi.fn());
      await new Promise((r) => setTimeout(r, 10));

      expect(getActiveListenerCount()).toBe(0);
    });
  });
});
