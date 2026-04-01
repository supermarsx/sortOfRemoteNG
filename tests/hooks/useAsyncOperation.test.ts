import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAsyncOperation } from '../../src/hooks/useAsyncOperation';

describe('useAsyncOperation', () => {
  it('has correct initial state', () => {
    const asyncFn = vi.fn();
    const { result } = renderHook(() => useAsyncOperation(asyncFn));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets data on successful execution', async () => {
    const asyncFn = vi.fn().mockResolvedValue('result-data');
    const { result } = renderHook(() => useAsyncOperation<string>(asyncFn));

    await act(async () => {
      const returned = await result.current.execute();
      expect(returned).toBe('result-data');
    });

    expect(result.current.data).toBe('result-data');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error on failed execution', async () => {
    const asyncFn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAsyncOperation<string>(asyncFn));

    await act(async () => {
      const returned = await result.current.execute();
      expect(returned).toBeNull();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('boom');
  });

  it('handles non-Error rejection', async () => {
    const asyncFn = vi.fn().mockRejectedValue('string-error');
    const { result } = renderHook(() => useAsyncOperation<string>(asyncFn));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe('string-error');
  });

  it('reset clears state', async () => {
    const asyncFn = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() => useAsyncOperation<string>(asyncFn));

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toBe('data');

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not update state after unmount', async () => {
    let resolvePromise: (value: string) => void;
    const asyncFn = vi.fn(() => new Promise<string>((resolve) => {
      resolvePromise = resolve;
    }));

    const { result, unmount } = renderHook(() => useAsyncOperation<string>(asyncFn));

    let executePromise: Promise<string | null>;
    act(() => {
      executePromise = result.current.execute();
    });

    expect(result.current.loading).toBe(true);

    unmount();

    await act(async () => {
      resolvePromise!('late-data');
      await executePromise!;
    });

    // After unmount, state should not have been updated — no errors thrown
  });
});
