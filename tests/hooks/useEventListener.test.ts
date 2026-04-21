import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEventListener } from '../../src/hooks/useEventListener';

describe('useEventListener', () => {
  it('calls handler when event fires', () => {
    const handler = vi.fn();
    renderHook(() => useEventListener('click', handler));

    window.dispatchEvent(new MouseEvent('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removes listener on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useEventListener('click', handler));

    unmount();
    window.dispatchEvent(new MouseEvent('click'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('updates handler ref without re-attaching listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { rerender } = renderHook(
      ({ handler }) => useEventListener('keydown', handler),
      { initialProps: { handler: handler1 } },
    );

    const initialAddCount = addSpy.mock.calls.filter(c => c[0] === 'keydown').length;

    rerender({ handler: handler2 });

    const afterRerenderAddCount = addSpy.mock.calls.filter(c => c[0] === 'keydown').length;
    // Handler change should NOT cause a new addEventListener call
    expect(afterRerenderAddCount).toBe(initialAddCount);

    window.dispatchEvent(new KeyboardEvent('keydown'));
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('attaches to a custom element target', () => {
    const handler = vi.fn();
    const div = document.createElement('div');

    renderHook(() => useEventListener('click', handler, div));

    div.dispatchEvent(new MouseEvent('click'));
    expect(handler).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new MouseEvent('click'));
    expect(handler).toHaveBeenCalledTimes(1); // still 1
  });
});
