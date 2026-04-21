import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ThumbnailSession {
  id: string;
  connected: boolean;
  desktop_width: number;
  desktop_height: number;
}

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;

/**
 * Periodically captures downscaled thumbnails for active RDP sessions.
 * Returns a map of sessionId -> blob URL for use as <img> src.
 */
export function useSessionThumbnails(
  sessions: ThumbnailSession[],
  intervalMs: number = 5000,
  enabled: boolean = true,
): Record<string, string> {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const prevUrlsRef = useRef<Record<string, string>>({});

  const capture = useCallback(async () => {
    const newThumbnails: Record<string, string> = {};

    for (const session of sessions) {
      if (!session.connected || session.desktop_width === 0) {
        // Keep existing thumbnail for disconnected sessions
        if (prevUrlsRef.current[session.id]) {
          newThumbnails[session.id] = prevUrlsRef.current[session.id];
        }
        continue;
      }

      try {
        const rgba = await invoke<ArrayBuffer>('rdp_get_thumbnail', {
          sessionId: session.id,
          thumbWidth: THUMB_WIDTH,
          thumbHeight: THUMB_HEIGHT,
        });

        // Convert RGBA ArrayBuffer to a blob URL via OffscreenCanvas
        const canvas = new OffscreenCanvas(THUMB_WIDTH, THUMB_HEIGHT);
        const ctx = canvas.getContext('2d')!;
        const imgData = new ImageData(
          new Uint8ClampedArray(rgba),
          THUMB_WIDTH,
          THUMB_HEIGHT,
        );
        ctx.putImageData(imgData, 0, 0);

        const blob = await canvas.convertToBlob({ type: 'image/png' });
        // Revoke old URL for this session
        if (prevUrlsRef.current[session.id]) {
          URL.revokeObjectURL(prevUrlsRef.current[session.id]);
        }
        newThumbnails[session.id] = URL.createObjectURL(blob);
      } catch {
        // Session may have ended, keep existing thumbnail
        if (prevUrlsRef.current[session.id]) {
          newThumbnails[session.id] = prevUrlsRef.current[session.id];
        }
      }
    }

    prevUrlsRef.current = newThumbnails;
    setThumbnails(newThumbnails);
  }, [sessions]);

  useEffect(() => {
    if (!enabled || sessions.length === 0) return;

    capture();
    const timer = setInterval(capture, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, sessions.length, intervalMs, capture]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(prevUrlsRef.current).forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  return thumbnails;
}
