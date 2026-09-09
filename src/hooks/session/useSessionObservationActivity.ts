import { useEffect, useState } from "react";

/** Window-state checks occur on lifecycle events, never on a polling timer. */
export function useSessionObservationActivity(enabled: boolean): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const runtime = window as typeof window & {
      __TAURI_INTERNALS__?: unknown;
      __TAURI__?: unknown;
    };
    if (!runtime.__TAURI_INTERNALS__ && !runtime.__TAURI__) return;
    let live = true;
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let queued = false;
    let unlistenFocus: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (!live) return;
        const host = getCurrentWindow();
        const inspect = async () => {
          if (!live) return;
          if (inFlight) {
            queued = true;
            return;
          }
          inFlight = true;
          queued = false;
          const current = version;
          try {
            const next = await host.isMinimized();
            if (live && current === version) setMinimized(next);
          } catch {
            /* DOM visibility remains the cross-platform fallback. */
          } finally {
            inFlight = false;
            if (live && queued) void inspect();
          }
        };
        const requestInspection = (immediate: boolean) => {
          version++;
          if (timer !== undefined) clearTimeout(timer);
          if (immediate) void inspect();
          else
            timer = setTimeout(() => {
              timer = undefined;
              void inspect();
            }, 150);
        };
        const register = async (
          listener: Promise<() => void>,
          focus: boolean,
        ) => {
          const dispose = await listener;
          if (!live) dispose();
          else if (focus) unlistenFocus = dispose;
          else unlistenResize = dispose;
        };
        await Promise.all([
          register(
            host.onFocusChanged(() => requestInspection(true)),
            true,
          ),
          register(
            host.onResized(() => requestInspection(false)),
            false,
          ),
          Promise.resolve(requestInspection(true)),
        ]);
      } catch {
        /* Older/non-desktop hosts retain document visibility gating. */
      }
    })();
    return () => {
      live = false;
      version++;
      if (timer !== undefined) clearTimeout(timer);
      unlistenFocus?.();
      unlistenResize?.();
    };
  }, [enabled]);
  return enabled && visible && !minimized;
}
