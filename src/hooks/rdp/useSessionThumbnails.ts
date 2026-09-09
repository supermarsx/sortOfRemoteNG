import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionObservationActivity } from "../session/useSessionObservationActivity";

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
  const observationActive = useSessionObservationActivity(
    enabled && sessions.length > 0,
  );
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const prevUrlsRef = useRef<Record<string, string>>({});
  const sessionsRef = useRef(sessions);
  const inFlightRef = useRef(false);
  const captureRef = useRef<(() => Promise<void>) | null>(null);
  sessionsRef.current = sessions;

  useEffect(() => {
    const ids = new Set(sessions.map((session) => session.id));
    let changed = false;
    const next = { ...prevUrlsRef.current };
    for (const id of Object.keys(next)) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(next[id]);
        delete next[id];
        changed = true;
      }
    }
    if (changed) {
      prevUrlsRef.current = next;
      setThumbnails(next);
    }
  }, [sessions]);

  const hasSessions = sessions.length > 0;
  useEffect(() => {
    if (!observationActive || !hasSessions) return;
    let cancelled = false;
    const capture = async () => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      const captured: Record<string, string> = {};
      try {
        for (const session of sessionsRef.current) {
          if (cancelled) break;
          if (!session.connected || session.desktop_width === 0) continue;

          try {
            const rgba = await invoke<ArrayBuffer>("rdp_get_thumbnail", {
              sessionId: session.id,
              thumbWidth: THUMB_WIDTH,
              thumbHeight: THUMB_HEIGHT,
            });
            if (cancelled) break;

            // Convert RGBA ArrayBuffer to a blob URL via OffscreenCanvas
            const canvas = new OffscreenCanvas(THUMB_WIDTH, THUMB_HEIGHT);
            const ctx = canvas.getContext("2d")!;
            const imgData = new ImageData(
              new Uint8ClampedArray(rgba),
              THUMB_WIDTH,
              THUMB_HEIGHT,
            );
            ctx.putImageData(imgData, 0, 0);

            const blob = await canvas.convertToBlob({ type: "image/png" });
            if (cancelled) break;
            // A session may disappear while its native capture/PNG encode is pending.
            if (
              !sessionsRef.current.some((current) => current.id === session.id)
            )
              continue;
            captured[session.id] = URL.createObjectURL(blob);
          } catch {
            // Keep the last successful thumbnail when the session ends or capture fails.
          }
        }
        if (!cancelled) {
          const liveIds = new Set(
            sessionsRef.current.map((session) => session.id),
          );
          const next = { ...prevUrlsRef.current };
          for (const [id, url] of Object.entries(captured)) {
            if (!liveIds.has(id)) continue;
            if (next[id]) URL.revokeObjectURL(next[id]);
            next[id] = url;
            delete captured[id];
          }
          prevUrlsRef.current = next;
          setThumbnails(next);
        }
      } finally {
        Object.values(captured).forEach((url) => URL.revokeObjectURL(url));
        inFlightRef.current = false;
        // Visibility/interval may have changed while native work was pending.
        // Let the newest activation capture promptly once the old call finishes.
        if (cancelled) void captureRef.current?.();
      }
    };
    captureRef.current = capture;
    capture();
    const timer = setInterval(capture, Math.max(1000, intervalMs));
    return () => {
      cancelled = true;
      if (captureRef.current === capture) captureRef.current = null;
      clearInterval(timer);
    };
  }, [observationActive, hasSessions, intervalMs]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(prevUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
      prevUrlsRef.current = {};
    };
  }, []);

  return thumbnails;
}
