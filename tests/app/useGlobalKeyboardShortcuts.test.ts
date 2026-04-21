import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlobalKeyboardShortcuts } from '../../src/hooks/app/useGlobalKeyboardShortcuts';

function fireKey(key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe('useGlobalKeyboardShortcuts', () => {
  it('calls handler on matching keyboard shortcut', () => {
    const handler = vi.fn();
    renderHook(() => useGlobalKeyboardShortcuts({ 'Ctrl+s': handler }));

    fireKey('s', { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores non-matching key combos', () => {
    const handler = vi.fn();
    renderHook(() => useGlobalKeyboardShortcuts({ 'Ctrl+s': handler }));

    fireKey('s'); // no ctrl
    fireKey('d', { ctrlKey: true }); // wrong key
    fireKey('s', { altKey: true }); // wrong modifier
    expect(handler).not.toHaveBeenCalled();
  });

  it('prevents default on matched shortcut', () => {
    const handler = vi.fn();
    renderHook(() => useGlobalKeyboardShortcuts({ 'Ctrl+k': handler }));

    const spy = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
    fireKey('k', { ctrlKey: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('cleans up listener on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useGlobalKeyboardShortcuts({ 'Ctrl+q': handler }));

    unmount();
    fireKey('q', { ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multi-modifier combos', () => {
    const handler = vi.fn();
    renderHook(() => useGlobalKeyboardShortcuts({ 'Ctrl+Shift+p': handler }));

    fireKey('p', { ctrlKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handles multiple shortcuts simultaneously', () => {
    const save = vi.fn();
    const open = vi.fn();
    renderHook(() => useGlobalKeyboardShortcuts({ 'Ctrl+s': save, 'Ctrl+o': open }));

    fireKey('s', { ctrlKey: true });
    fireKey('o', { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
