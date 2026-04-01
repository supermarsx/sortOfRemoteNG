import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMountedRef } from '../../src/hooks/useMountedRef';

describe('useMountedRef', () => {
  it('returns true while mounted', () => {
    const { result } = renderHook(() => useMountedRef());
    expect(result.current.current).toBe(true);
  });

  it('returns false after unmount', () => {
    const { result, unmount } = renderHook(() => useMountedRef());
    const ref = result.current;
    expect(ref.current).toBe(true);

    unmount();
    expect(ref.current).toBe(false);
  });
});
