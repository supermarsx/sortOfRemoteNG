/**
 * `useAutoLock` — central auto-lock policy enforcer.
 *
 * Reads `settings.autoLock` and triggers `encryption_lock` (via the
 * `useEncryption().lock` callback) on any of the configured signals:
 *
 *  - **Idle timeout** (`lockOnIdle` + `timeoutMinutes`): any DOM
 *    activity event (mousemove, keypress, pointerdown, touchstart,
 *    scroll, wheel) resets the timer; after `timeoutMinutes` of no
 *    activity, the lock fires.
 *  - **Window minimise** (`lockOnMinimize`): listens to the Tauri
 *    `tauri://focus` / `tauri://blur` events with a polled
 *    `isMinimized()` follow-up. The `visibilitychange` DOM event
 *    serves as the cross-platform fallback.
 *  - **Window blur** (`lockOnBlur`): pure DOM `window.onblur`,
 *    debounced by 250 ms to avoid locking on transient focus loss
 *    (e.g. a tooltip click).
 *  - **Visibility hidden** (`lockOnVisibilityHidden`): the
 *    `document.hidden` flag — useful when the host browser collapses
 *    minimise/blur into a single signal.
 *
 * The hook is a side-effect-only React hook (no return value). Mount
 * once near the root of the app (after the encryption provider so
 * `useEncryption` is ready). Idempotent: every settings change
 * tears down listeners + rebuilds them so toggling fields in
 * Settings → Security takes effect immediately.
 *
 * The hook is a no-op when:
 *  - encryption is currently locked (nothing to lock),
 *  - encryption is not unlocked yet (status null / not setup),
 *  - `settings.autoLock.enabled` is `false`.
 *
 * Tests cover the predicate that decides whether a given event
 * should trigger lock — the DOM-driven side effects rely on jsdom
 * timers + manual event dispatch.
 */
import { useEffect, useRef } from "react";
import type { AutoLockConfig } from "../../types/settings/settings";
import { useEncryption } from "./useEncryption";
import { getInvoke } from "../../utils/tauri/invoke";

/** Pure predicate: should the hook attach *any* listener given this
 *  config + unlocked state? Extracted so unit tests can assert the
 *  guard without spinning up jsdom timers. */
export function shouldArmAutoLock(
  config: AutoLockConfig | undefined,
  unlocked: boolean,
): boolean {
  if (!config) return false;
  if (!config.enabled) return false;
  if (!unlocked) return false;
  return (
    !!config.lockOnIdle ||
    !!config.lockOnMinimize ||
    !!config.lockOnBlur ||
    !!config.lockOnVisibilityHidden
  );
}

/** Activity DOM events that reset the idle timer. Kept narrow so we
 *  don't accidentally subscribe to e.g. animation frame events. */
const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "pointerdown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

const BLUR_DEBOUNCE_MS = 250;

export function useAutoLock(config: AutoLockConfig | undefined): void {
  const enc = useEncryption();
  const lockRef = useRef(enc.lock);
  lockRef.current = enc.lock;

  const unlocked = !!enc.status?.unlocked;

  useEffect(() => {
    if (!shouldArmAutoLock(config, unlocked)) return;

    const triggerLock = (reason: "idle" | "blur" | "minimize" | "visibility-hidden") => {
      // Reading the latest callback through a ref keeps the listener
      // wiring stable across hook renders.
      void lockRef.current(reason).catch(() => {
        // Lock errors are non-fatal — the next event will retry.
      });
    };

    const cleanups: Array<() => void> = [];

    // ── Idle timer ────────────────────────────────────────────────
    if (config?.lockOnIdle && config?.timeoutMinutes > 0) {
      const timeoutMs = config.timeoutMinutes * 60_000;
      let handle: ReturnType<typeof setTimeout> | null = null;

      const reset = () => {
        if (handle) clearTimeout(handle);
        handle = setTimeout(() => triggerLock("idle"), timeoutMs);
      };
      reset();
      ACTIVITY_EVENTS.forEach((evt) => {
        window.addEventListener(evt, reset, { passive: true });
      });
      cleanups.push(() => {
        if (handle) clearTimeout(handle);
        ACTIVITY_EVENTS.forEach((evt) => {
          window.removeEventListener(evt, reset);
        });
      });
    }

    // ── Window blur (DOM-level, debounced) ────────────────────────
    if (config?.lockOnBlur) {
      let blurTimer: ReturnType<typeof setTimeout> | null = null;
      const onBlur = () => {
        if (blurTimer) clearTimeout(blurTimer);
        blurTimer = setTimeout(() => triggerLock("blur"), BLUR_DEBOUNCE_MS);
      };
      const onFocus = () => {
        if (blurTimer) clearTimeout(blurTimer);
      };
      window.addEventListener("blur", onBlur);
      window.addEventListener("focus", onFocus);
      cleanups.push(() => {
        if (blurTimer) clearTimeout(blurTimer);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
      });
    }

    // ── Document visibility (cross-platform fallback) ─────────────
    if (config?.lockOnVisibilityHidden) {
      const onVisibility = () => {
        if (document.hidden) triggerLock("visibility-hidden");
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => {
        document.removeEventListener("visibilitychange", onVisibility);
      });
    }

    // ── Tauri window minimise event ───────────────────────────────
    // The `tauri://blur` listener is set up at the webview level by
    // the Tauri runtime and fires when the OS window loses focus
    // *or* is minimised. We follow up with a polled `isMinimized`
    // check via the windows plugin to avoid locking on plain alt-tab
    // when only `lockOnMinimize` (not `lockOnBlur`) is configured.
    if (config?.lockOnMinimize) {
      let aborted = false;
      void (async () => {
        const inv = await getInvoke();
        if (!inv || aborted) return;
        try {
          const { listen } = await import("@tauri-apps/api/event");
          const unlisten = await listen("tauri://blur", async () => {
            // Use the windows plugin to confirm "minimised, not just
            // backgrounded". Falls back to the DOM `document.hidden`
            // flag when the plugin isn't registered (older builds).
            try {
              const { getCurrentWindow } = await import(
                "@tauri-apps/api/window"
              );
              const w = getCurrentWindow();
              const isMin = await w.isMinimized();
              if (isMin) triggerLock("minimize");
            } catch {
              if (document.hidden) triggerLock("minimize");
            }
          });
          cleanups.push(() => {
            void unlisten();
          });
        } catch {
          // Event API not available — silently degrade.
        }
      })();
      cleanups.push(() => {
        aborted = true;
      });
    }

    return () => {
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* swallow */
        }
      });
    };
  }, [
    config?.enabled,
    config?.timeoutMinutes,
    config?.lockOnIdle,
    config?.lockOnBlur,
    config?.lockOnMinimize,
    config?.lockOnVisibilityHidden,
    unlocked,
    config,
  ]);
}
