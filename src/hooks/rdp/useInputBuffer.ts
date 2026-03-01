import { useRef, useCallback } from 'react';
import { debugLog } from '../../utils/debugLogger';
import { invoke } from '@tauri-apps/api/core';

export function useInputBuffer(
  sessionIdRef: React.MutableRefObject<string | null>,
  isConnected: boolean,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const inputBufferRef = useRef<Record<string, unknown>[]>([]);
  /** Index of the current MouseMove event in the buffer (-1 = none). */
  const pendingMoveIdxRef = useRef(-1);
  /** Boolean flag for queueMicrotask scheduling. */
  const flushScheduledRef = useRef(false);
  /** Cached canvas bounding rect -- invalidated on resize/scroll. */
  const cachedRectRef = useRef<DOMRect | null>(null);

  const flushInputBuffer = useCallback(() => {
    flushScheduledRef.current = false;
    const sid = sessionIdRef.current;
    const buf = inputBufferRef.current;
    if (!sid || buf.length === 0) return;
    inputBufferRef.current = [];
    pendingMoveIdxRef.current = -1;
    invoke('rdp_send_input', { sessionId: sid, events: buf }).catch(e => {
      debugLog(`Input send error: ${e}`);
    });
  }, []);

  const sendInput = useCallback((events: Record<string, unknown>[], immediate = false) => {
    if (!isConnected || !sessionIdRef.current) return;
    if (immediate) {
      flushScheduledRef.current = false;
      const buf = inputBufferRef.current;
      inputBufferRef.current = [];
      pendingMoveIdxRef.current = -1;
      const sid = sessionIdRef.current;
      if (buf.length > 0) {
        for (let i = 0; i < events.length; i++) buf.push(events[i]);
        invoke('rdp_send_input', { sessionId: sid!, events: buf }).catch(e => {
          debugLog(`Input send error: ${e}`);
        });
      } else {
        invoke('rdp_send_input', { sessionId: sid!, events }).catch(e => {
          debugLog(`Input send error: ${e}`);
        });
      }
      return;
    }
    const buf = inputBufferRef.current;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'MouseMove') {
        const idx = pendingMoveIdxRef.current;
        if (idx >= 0) {
          buf[idx] = ev;
        } else {
          pendingMoveIdxRef.current = buf.length;
          buf.push(ev);
        }
      } else {
        buf.push(ev);
      }
    }
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      queueMicrotask(flushInputBuffer);
    }
  }, [isConnected, flushInputBuffer]);

  const scaleCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    let rect = cachedRectRef.current;
    if (!rect) {
      rect = canvas.getBoundingClientRect();
      cachedRectRef.current = rect;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }, []);

  return { sendInput, scaleCoords, cachedRectRef };
}
