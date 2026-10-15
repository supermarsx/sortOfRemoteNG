import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorLogBar } from "../../src/hooks/monitoring/useErrorLogBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
let queued: VoidFunction[];
beforeEach(() => {
  queued = [];
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("queueMicrotask", (callback: VoidFunction) =>
    queued.push(callback),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("error log emission timestamps", () => {
  it("captures each console timestamp at emission rather than deferred state rendering", () => {
    const first = new Date("2026-10-15T12:00:00.125Z");
    const second = new Date("2026-10-15T12:02:00.250Z");
    const rendered = new Date("2026-10-15T12:10:00.999Z");
    vi.setSystemTime(first);
    const view = renderHook(() => useErrorLogBar());
    console.error("first synthetic error");
    vi.setSystemTime(second);
    console.warn("second synthetic warning");
    expect(view.result.current.errors).toHaveLength(0);
    vi.setSystemTime(rendered);
    view.rerender();
    act(() => {
      for (const callback of queued.splice(0)) callback();
    });
    expect(
      view.result.current.errors.map((entry) => ({
        message: entry.message,
        level: entry.level,
        at: entry.timestamp.toISOString(),
      })),
    ).toEqual([
      {
        message: "second synthetic warning",
        level: "warn",
        at: second.toISOString(),
      },
      {
        message: "first synthetic error",
        level: "error",
        at: first.toISOString(),
      },
    ]);
    expect(view.result.current.errorCount).toBe(1);
    expect(view.result.current.warnCount).toBe(1);
  });
  it("captures window-error time before its queued update and retains source metadata", () => {
    const emitted = new Date("2026-10-15T13:00:00.123Z");
    vi.setSystemTime(emitted);
    const view = renderHook(() => useErrorLogBar());
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "synthetic window error",
        filename: "fixture.js",
        lineno: 7,
        colno: 2,
      }),
    );
    vi.setSystemTime(new Date("2026-10-15T13:05:00Z"));
    act(() => {
      for (const callback of queued.splice(0)) callback();
    });
    expect(view.result.current.errors[0]).toMatchObject({
      message: "synthetic window error",
      source: "fixture.js:7:2",
      timestamp: emitted,
    });
  });
});
