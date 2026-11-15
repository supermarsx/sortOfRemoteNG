import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendCapped,
  createBatchedLogBuffer,
} from "../../src/utils/runtime/batchedLogBuffer";
import { useBatchedLogStream } from "../../src/hooks/runtime/useBatchedLogStream";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createBatchedLogBuffer", () => {
  it("coalesces a 10k burst into one ordered flush", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createBatchedLogBuffer<number>({
      onFlush,
      flushMs: 100,
      cap: 20000,
    });
    for (let i = 0; i < 10_000; i++) buffer.push(i);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledTimes(1);
    const [batch] = onFlush.mock.calls[0];
    expect(batch).toHaveLength(10_000);
    expect(batch[0]).toBe(0);
    expect(batch[9_999]).toBe(9_999);
  });
  it("drops oldest entries past the cap and reports the count", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createBatchedLogBuffer<number>({ onFlush, cap: 100 });
    for (let i = 0; i < 1000; i++) buffer.push(i);
    vi.runOnlyPendingTimers();
    expect(onFlush).toHaveBeenCalledWith(
      Array.from({ length: 100 }, (_, i) => 900 + i),
      900,
    );
  });
  it("holds entries while paused and flushes on resume", () => {
    vi.useFakeTimers();
    let paused = true;
    const onFlush = vi.fn();
    const buffer = createBatchedLogBuffer<string>({
      onFlush,
      isPaused: () => paused,
    });
    buffer.push("a", "b");
    vi.advanceTimersByTime(10_000);
    expect(onFlush).not.toHaveBeenCalled();
    paused = false;
    buffer.resume();
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledWith(["a", "b"], 0);
  });
  it("dispose flushes pending entries and ignores later pushes", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createBatchedLogBuffer<string>({ onFlush });
    buffer.push("x");
    buffer.dispose();
    expect(onFlush).toHaveBeenCalledWith(["x"], 0);
    buffer.push("y");
    vi.advanceTimersByTime(1000);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
  it("appendCapped keeps the newest entries in order", () => {
    expect(appendCapped([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5]);
    expect(appendCapped([1], [2, 3, 4, 5, 6], 3)).toEqual([4, 5, 6]);
  });
});

describe("useBatchedLogStream", () => {
  it("renders a bounded number of times for a 10k burst, in order, capped", () => {
    vi.useFakeTimers();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useBatchedLogStream<number>({ cap: 500, flushMs: 100 });
    });
    const base = renders;
    act(() => {
      for (let i = 0; i < 10_000; i++) result.current.push(i);
    });
    expect(renders).toBe(base);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(renders - base).toBeLessThanOrEqual(2);
    expect(result.current.entries).toHaveLength(500);
    expect(result.current.entries[0]).toBe(9_500);
    expect(result.current.entries[499]).toBe(9_999);
    expect(result.current.dropped).toBe(10_000 - 500);
  });
  it("preserves order across multiple flushes", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useBatchedLogStream<number>({ cap: 100, flushMs: 50 }),
    );
    for (let round = 0; round < 3; round++) {
      act(() => {
        for (let i = 0; i < 10; i++) result.current.push(round * 10 + i);
        vi.advanceTimersByTime(50);
      });
    }
    expect(result.current.entries).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    );
  });
  it("buffers without state updates while paused, then publishes once", () => {
    vi.useFakeTimers();
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ paused }) => {
        renders++;
        return useBatchedLogStream<number>({ paused, flushMs: 50 });
      },
      { initialProps: { paused: true } },
    );
    act(() => {
      for (let i = 0; i < 1000; i++) result.current.push(i);
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.entries).toHaveLength(0);
    const before = renders;
    rerender({ paused: false });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.entries).toHaveLength(1000);
    expect(renders - before).toBeLessThanOrEqual(3);
  });
  it("buffers while the document is hidden and resumes on visibilitychange", () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const { result } = renderHook(() =>
      useBatchedLogStream<number>({ flushMs: 50 }),
    );
    act(() => {
      result.current.push(1, 2, 3);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.entries).toEqual([]);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(50);
    });
    expect(result.current.entries).toEqual([1, 2, 3]);
  });
  it("does not update state after unmount and leaves no timer behind", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useBatchedLogStream<number>({ flushMs: 50 }),
    );
    act(() => result.current.push(1, 2));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(error).not.toHaveBeenCalled();
  });
});
