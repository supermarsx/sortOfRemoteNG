import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../types/encryption/encryption";
import { getInvoke } from "../tauri/invoke";
import { clearAllPreloadCaches } from "./memoryCache";
import { scheduleIdle } from "./idle";

export type PreloadTarget = "documents" | "credentialVault";

type Preloader = () => void | Promise<unknown>;

const preloaders = new Map<PreloadTarget, Preloader>();
const lastRun = new Map<PreloadTarget, number>();
/** Hover/focus storms must not turn into a request per pointer event. */
const INTENT_THROTTLE_MS = 1500;

/** The App registers what is safe to warm. Returns an unregister function. */
export function registerTabPreloader(
  target: PreloadTarget,
  preloader: Preloader,
): () => void {
  preloaders.set(target, preloader);
  return () => {
    if (preloaders.get(target) === preloader) preloaders.delete(target);
  };
}

/**
 * Warm a tab because the user showed intent (hover/focus/shortcut) or the app
 * is idle. Never throws, never prompts: a preloader only reads state that is
 * already unlocked and silently skips otherwise.
 */
export function preloadTab(target: PreloadTarget, force = false): void {
  const preloader = preloaders.get(target);
  if (!preloader) return;
  const now = Date.now();
  if (!force && now - (lastRun.get(target) ?? -Infinity) < INTENT_THROTTLE_MS)
    return;
  lastRun.set(target, now);
  try {
    void Promise.resolve(preloader()).catch(() => undefined);
  } catch {
    /* preload is best effort */
  }
}

/** Props for a tab button/menu entry: preload on pointer hover and keyboard focus. */
export function tabIntentHandlers(target: PreloadTarget) {
  const warm = () => preloadTab(target);
  return { onPointerEnter: warm, onFocus: warm };
}

/** Warm every registered target once the app has settled. */
export function warmTabsWhenIdle(timeoutMs = 3000): () => void {
  return scheduleIdle(() => {
    for (const target of preloaders.keys()) preloadTab(target, true);
  }, timeoutMs);
}

let lockListenerStarted = false;
/**
 * Wipe every preload cache when the desktop locks or unlocks. Idempotent and a
 * no-op outside the Tauri shell.
 */
export function ensurePreloadLockListener(): void {
  if (lockListenerStarted) return;
  lockListenerStarted = true;
  void (async () => {
    try {
      if (!(await getInvoke())) return;
      const { listen } = await import("@tauri-apps/api/event");
      for (const event of [ENCRYPTION_EVENT_LOCKED, ENCRYPTION_EVENT_UNLOCKED])
        await listen(event, () => {
          lastRun.clear();
          clearAllPreloadCaches();
        });
    } catch {
      lockListenerStarted = false;
    }
  })();
}

/** Test hook. */
export function resetTabPreloadForTests(): void {
  preloaders.clear();
  lastRun.clear();
  lockListenerStarted = false;
}
