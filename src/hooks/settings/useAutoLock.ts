/**
 * `useAutoLock` — central auto-lock policy enforcer.
 *
 * Reads `settings.autoLock` and triggers `encryption_lock` (via the
 * `useEncryption().lock` callback) on any of the configured signals:
 *
 *  - **Idle timeout** (`lockOnIdle` + `timeoutMinutes`): any DOM
 *    activity event (mousemove, keydown, pointerdown, touchstart,
 *    scroll, wheel) resets the timer; after `timeoutMinutes` of no
 *    activity, the lock fires.
 *  - **Window minimise** (`lockOnMinimize`): listens to the Tauri
 *    `tauri://focus` / `tauri://blur` events with a polled
 *    `isMinimized()` follow-up. The `visibilitychange` DOM event
 *    serves as the cross-platform fallback.
 *  - **Window blur** (`lockOnBlur`): debounced by 250 ms, then
 *    confirmed against native OS focus (document focus in browser
 *    builds). Moving focus into an embedded frame is not OS blur.
 *  - **Visibility hidden** (`lockOnVisibilityHidden`): the
 *    `document.hidden` flag — useful when the host browser collapses
 *    minimise/blur into a single signal.
 *
 * The hook is a side-effect-only React hook (no return value). Mount
 * once near the root of the app (after the encryption provider so
 * `useEncryption` is ready). Policy changes rebuild listeners; an
 * equivalent settings object does not postpone the idle deadline.
 *
 * The hook is a no-op when:
 *  - encryption is currently locked (nothing to lock),
 *  - encryption is not unlocked yet (status null / not setup),
 *  - `settings.autoLock.enabled` is `false`.
 *
 * Tests cover focus confirmation, asynchronous query/listener cleanup,
 * single-flight locking and policy timers with controlled native events.
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
  const armed = shouldArmAutoLock(config, unlocked);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  // Keep admission across effect rewiring while an asynchronous database
  // save/lock is pending. Concurrent blur/idle/visibility must not start it twice.
  const lockPendingRef = useRef(false);
  const timeoutMinutes = config?.timeoutMinutes;
  const lockOnIdle = config?.lockOnIdle;
  const lockOnBlur = config?.lockOnBlur;
  const lockOnMinimize = config?.lockOnMinimize;
  const lockOnVisibilityHidden = config?.lockOnVisibilityHidden;

  useEffect(() => {
    if (!armed) return;
    let disposed = false;

    const triggerLock = (
      reason: "idle" | "blur" | "minimize" | "visibility-hidden",
    ) => {
      if (disposed || !armedRef.current || lockPendingRef.current) return;
      lockPendingRef.current = true;
      void (async () => {
        try {
          await lockRef.current(reason);
        } catch {
          // The next genuine policy event may retry a failed save/lock.
        } finally {
          lockPendingRef.current = false;
        }
      })();
    };

    const cleanups: Array<() => void> = [];

    // ── Idle timer ────────────────────────────────────────────────
    if (lockOnIdle && timeoutMinutes !== undefined && timeoutMinutes > 0) {
      const timeoutMs = timeoutMinutes * 60_000;
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

    // ── DOM + native focus/minimize ──────────────────────────────
    if (lockOnBlur || lockOnMinimize) {
      let blurTimer: ReturnType<typeof setTimeout> | null = null;
      let blurRevision = 0;
      let minimizeRevision = 0;
      const nativeWindow = (async () => {
        try {
          const invoke = await getInvoke();
          if (!invoke || disposed) return null;
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          return disposed ? null : getCurrentWindow();
        } catch {
          return null;
        }
      })();

      const inspectBlur = async (revision: number) => {
        const host = await nativeWindow;
        if (disposed || revision !== blurRevision) return;
        let focused = document.hasFocus();
        if (host) {
          try {
            focused = await host.isFocused();
          } catch {
            focused = document.hasFocus();
          }
        }
        if (!disposed && revision === blurRevision && !focused)
          triggerLock("blur");
      };
      const inspectMinimized = async () => {
        const revision = ++minimizeRevision;
        const host = await nativeWindow;
        if (disposed || revision !== minimizeRevision) return;
        let minimized: boolean;
        try {
          minimized = host ? await host.isMinimized() : document.hidden;
        } catch {
          // Preserve the documented visibility fallback for older/web hosts.
          minimized = document.hidden;
        }
        if (!disposed && revision === minimizeRevision && minimized)
          triggerLock("minimize");
      };
      const onFocus = () => {
        blurRevision++;
        minimizeRevision++;
        if (blurTimer !== null) clearTimeout(blurTimer);
        blurTimer = null;
      };
      const onBlur = () => {
        if (disposed) return;
        if (lockOnBlur) {
          const revision = ++blurRevision;
          if (blurTimer !== null) clearTimeout(blurTimer);
          blurTimer = setTimeout(() => {
            blurTimer = null;
            void inspectBlur(revision);
          }, BLUR_DEBOUNCE_MS);
        }
        if (lockOnMinimize) void inspectMinimized();
      };
      const onVisibility = () => {
        if (!document.hidden) {
          // A restore can precede the native focus event/query reply.
          minimizeRevision++;
          if (document.hasFocus()) onFocus();
        } else if (lockOnMinimize) {
          void inspectMinimized();
        }
      };
      window.addEventListener("blur", onBlur);
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => {
        onFocus();
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
      });

      // Native focus edges are necessary when the DOM window was already
      // blurred by an iframe and therefore emits no second blur on Alt-Tab.
      // Use this window's listener, not a global event from another window.
      void (async () => {
        const host = await nativeWindow;
        if (!host || disposed) return;
        try {
          const unlisten = await host.onFocusChanged(({ payload: focused }) => {
            if (disposed) return;
            if (focused) onFocus();
            else onBlur();
          });
          if (disposed) unlisten();
          else cleanups.push(unlisten);
        } catch {
          // DOM listeners and focus/visibility checks remain active.
        }
      })();
    }

    // ── Document visibility (cross-platform fallback) ─────────────
    if (lockOnVisibilityHidden) {
      const onVisibility = () => {
        if (document.hidden) triggerLock("visibility-hidden");
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => {
        document.removeEventListener("visibilitychange", onVisibility);
      });
    }

    return () => {
      disposed = true;
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* swallow */
        }
      });
    };
  }, [
    armed,
    timeoutMinutes,
    lockOnIdle,
    lockOnBlur,
    lockOnMinimize,
    lockOnVisibilityHidden,
  ]);
}
