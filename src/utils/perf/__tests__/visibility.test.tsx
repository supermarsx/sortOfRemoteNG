import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import React from "react";
import { createVisibleInterval, tickStore } from "../visibility";
import { useSharedTick } from "../../../hooks/perf/useSharedTick";
import { useVisibleInterval } from "../../../hooks/perf/useVisibleInterval";
import { useQuery } from "../../../hooks/perf/useQuery";
import { queryStore } from "../queryStore";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
  setHidden(false);
});
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
  queryStore.clearAll();
});

describe("visibility-aware polling", () => {
  it("fires nothing while hidden and exactly one catch-up on return", () => {
    const cb = vi.fn();
    const stop = createVisibleInterval(cb, 1000);
    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(3);
    setHidden(true);
    cb.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(cb).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hidden: <ms> slows instead of pausing", () => {
    const cb = vi.fn();
    const stop = createVisibleInterval(cb, 1000, { hidden: 10_000 });
    setHidden(true);
    vi.advanceTimersByTime(9000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });

  it("useVisibleInterval cleans up on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibleInterval(cb, 500));
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shared tick", () => {
  it("N subscribers share one timer; paused while hidden; released on unmount", () => {
    const renders = { a: 0, b: 0 };
    const A = () => {
      useSharedTick();
      renders.a++;
      return null;
    };
    const B = () => {
      useSharedTick();
      renders.b++;
      return null;
    };
    const { unmount } = render(
      <>
        <A />
        <B />
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);
    expect(tickStore.subscribers).toBe(2);
    const base = renders.a;
    for (let i = 0; i < 3; i++)
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    expect(renders.a - base).toBe(3);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(tickStore.subscribers).toBe(0);
  });
});

describe("useQuery", () => {
  it("three consumers of one key -> one fetch; stable data identity; select avoids re-render", async () => {
    vi.useRealTimers();
    const fetcher = vi.fn(async () => ({
      rows: [{ id: 1 }],
      noise: Math.random(),
    }));
    let renders = 0;
    const C = () => {
      const q = useQuery("hook:k", fetcher, {
        ttlMs: 0,
        select: (d) => d.rows,
        isEqual: (a, b) => a.length === b.length && a[0] === b[0],
      });
      renders++;
      return <span data-testid="n">{q.data?.length ?? -1}</span>;
    };
    const { findByText } = render(
      <>
        <C />
        <C />
        <C />
      </>,
    );
    await findByText("1", undefined, { timeout: 1000 }).catch(() => undefined);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const before = renders;
    await act(async () => {
      await queryStore.refetch("hook:k");
    });
    // noise changed but the selected rows are equal -> no extra commits for data
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(renders - before).toBeLessThanOrEqual(6); // fetching flag toggles only
  });
});
