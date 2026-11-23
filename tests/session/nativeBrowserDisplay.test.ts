import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  nativeDisplayStore,
  parseDisplayAction,
  parseDisplayState,
  parseSlotReport,
  probeNativeDisplaySupport,
  setNativeDisplayTransportForTests,
} from "../../src/utils/session/nativeBrowserDisplay";

const rect = { x: 0, y: 40, width: 800, height: 500 };

describe("native browser display relay validation", () => {
  it("accepts only an exactly shaped slot report for the session", () => {
    expect(
      parseSlotReport("s1", {
        sessionId: "s1",
        bounds: rect,
        rectangles: [{ x: 10, y: 10, width: 20, height: 20 }],
        blocked: true,
      }),
    ).toEqual({
      bounds: rect,
      rectangles: [{ x: 10, y: 10, width: 20, height: 20 }],
      blocked: true,
    });
    expect(
      parseSlotReport("s1", {
        sessionId: "s1",
        bounds: null,
        rectangles: [],
        blocked: false,
      }),
    ).toEqual({ bounds: null, rectangles: [], blocked: false });
  });

  it("rejects another session, malformed bounds and oversized overlay lists", () => {
    expect(
      parseSlotReport("s1", { sessionId: "s2", bounds: rect, rectangles: [] }),
    ).toBeNull();
    expect(
      parseSlotReport("s1", {
        sessionId: "s1",
        bounds: { x: -1, y: 0, width: 5, height: 5 },
        rectangles: [],
      }),
    ).toBeNull();
    expect(
      parseSlotReport("s1", {
        sessionId: "s1",
        bounds: rect,
        rectangles: [{ x: 0, y: 0, width: 0, height: 5 }],
      }),
    ).toBeNull();
    expect(
      parseSlotReport("s1", {
        sessionId: "s1",
        bounds: rect,
        rectangles: Array.from({ length: 33 }, () => rect),
      }),
    ).toBeNull();
    expect(parseSlotReport("s1", "x")).toBeNull();
  });

  it("accepts only the fixed toolbar actions", () => {
    for (const kind of ["back", "forward", "reload", "stop", "release"]) {
      expect(
        parseDisplayAction("s1", { sessionId: "s1", action: { kind } }),
      ).toEqual({ kind });
    }
    expect(
      parseDisplayAction("s1", {
        sessionId: "s1",
        action: { kind: "navigate", url: "https://a.test/" },
      }),
    ).toEqual({ kind: "navigate", url: "https://a.test/" });
    for (const bad of [
      { sessionId: "s2", action: { kind: "back" } },
      { sessionId: "s1", action: { kind: "close" } },
      { sessionId: "s1", action: { kind: "navigate", url: "" } },
      { sessionId: "s1", action: { kind: "navigate", url: "x".repeat(9000) } },
      { sessionId: "s1", action: null },
    ]) {
      expect(parseDisplayAction("s1", bad)).toBeNull();
    }
  });

  it("bounds state text mirrored to the detached toolbar", () => {
    const state = parseDisplayState("s1", {
      sessionId: "s1",
      state: {
        title: "t".repeat(2000),
        url: "u",
        loading: true,
        phase: "attached",
      },
    });
    expect(state?.title).toHaveLength(512);
    expect(state?.loading).toBe(true);
    expect(state?.canGoBack).toBe(false);
    expect(parseDisplayState("s1", { sessionId: "s2", state: {} })).toBeNull();
  });
});

describe("native display capability probe and store", () => {
  beforeEach(() => nativeDisplayStore.reset());

  it("treats a failing or negative probe as unsupported and asks again later", async () => {
    const capability = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(true);
    setNativeDisplayTransportForTests({
      capability,
      move: vi.fn(),
      claim: vi.fn(),
      release: vi.fn(),
    });
    expect(await probeNativeDisplaySupport()).toBe(false);
    expect(await probeNativeDisplaySupport()).toBe(true);
    expect(await probeNativeDisplaySupport()).toBe(true);
    expect(capability).toHaveBeenCalledTimes(2);
  });

  it("allows one display request per session", () => {
    expect(nativeDisplayStore.request("s1", "detached-s1")).toBe(true);
    expect(nativeDisplayStore.request("s1", "detached-s1")).toBe(false);
    nativeDisplayStore.update("s1", { phase: "claimed" });
    expect(nativeDisplayStore.get("s1")?.phase).toBe("claimed");
    nativeDisplayStore.clear("s1");
    expect(nativeDisplayStore.get("s1")).toBeUndefined();
  });
});
