import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInterval } from '../../src/hooks/useInterval';

describe('useInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback at the specified interval', () => {
    const callback = vi.fn();
    renderHook(() => useInterval(callback, 1000));

    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('does not start interval when delay is null', () => {
    const callback = vi.fn();
    renderHook(() => useInterval(callback, null));

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useInterval(callback, 1000));

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('updates callback without resetting interval', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { rerender } = renderHook(
      ({ cb }) => useInterval(cb, 1000),
      { initialProps: { cb: callback1 } },
    );

    vi.advanceTimersByTime(500);
    rerender({ cb: callback2 });

    // At 1000ms the interval fires — should call callback2, not callback1
    vi.advanceTimersByTime(500);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it('restarts interval when delay changes', () => {
    const callback = vi.fn();

    const { rerender } = renderHook(
      ({ delay }) => useInterval(callback, delay),
      { initialProps: { delay: 1000 as number | null } },
    );

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    rerender({ delay: 500 });

    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(3);
  });
});
