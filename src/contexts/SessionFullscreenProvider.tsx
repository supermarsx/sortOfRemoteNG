import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SessionFullscreenContext,
  type SessionFullscreenLifecycle,
} from "./SessionFullscreenContext";

type NativeWindow = ReturnType<
  (typeof import("@tauri-apps/api/window"))["getCurrentWindow"]
>;

function findSessionFocusTarget(sessionId: string): HTMLElement | null {
  const roots = document.querySelectorAll<HTMLElement>(
    "[data-session-fullscreen-root]",
  );
  const root = Array.from(roots).find(
    (candidate) => candidate.dataset.sessionFullscreenRoot === sessionId,
  );
  if (!root) return null;

  return (
    root.querySelector<HTMLElement>("[data-session-focus-target]") ??
    root.querySelector<HTMLElement>("canvas[tabindex]") ??
    root.querySelector<HTMLElement>(".xterm-helper-textarea") ??
    root.querySelector<HTMLElement>("iframe") ??
    root
  );
}

function focusSession(sessionId: string) {
  window.requestAnimationFrame(() => {
    findSessionFocusTarget(sessionId)?.focus({ preventScroll: true });
  });
}

function restoreSessionTriggerFocus(
  sessionId: string,
  previousFocusedElement: HTMLElement | null,
) {
  window.requestAnimationFrame(() => {
    const triggers = document.querySelectorAll<HTMLElement>(
      "[data-session-fullscreen-trigger]",
    );
    const trigger = Array.from(triggers).find(
      (candidate) => candidate.dataset.sessionFullscreenTrigger === sessionId,
    );
    if (trigger) {
      trigger.focus({ preventScroll: true });
    } else if (previousFocusedElement?.isConnected) {
      previousFocusedElement.focus({ preventScroll: true });
    }
  });
}

export const SessionFullscreenProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const nativeWindowRef = useRef<NativeWindow | null>(null);
  const previousNativeFullscreenRef = useRef<boolean | null>(null);
  const nativeTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const lifecycleBySessionRef = useRef(
    new Map<string, SessionFullscreenLifecycle>(),
  );
  const activeLifecycleRef = useRef<SessionFullscreenLifecycle | null>(null);

  const enqueueNativeTransition = useCallback(
    (transition: () => Promise<void>) => {
      nativeTransitionRef.current = nativeTransitionRef.current.then(
        transition,
        transition,
      );
    },
    [],
  );

  const restoreNativeWindow = useCallback(async () => {
    const nativeWindow = nativeWindowRef.current;
    const previousFullscreen = previousNativeFullscreenRef.current;
    nativeWindowRef.current = null;
    previousNativeFullscreenRef.current = null;

    if (!nativeWindow || previousFullscreen === null) return;
    try {
      const currentFullscreen = await nativeWindow.isFullscreen();
      if (currentFullscreen !== previousFullscreen) {
        await nativeWindow.setFullscreen(previousFullscreen);
      }
    } catch {
      // The web build and restricted desktop windows intentionally fall back
      // to the in-app no-distraction layout without surfacing an error.
    }
  }, []);

  const runActiveExitLifecycle = useCallback(() => {
    const lifecycle = activeLifecycleRef.current;
    activeLifecycleRef.current = null;
    try {
      lifecycle?.onExit?.();
    } catch {
      // Fullscreen exit must still restore the app and native window even if
      // a protocol-specific resize/focus callback fails.
    }
  }, []);

  const registerLifecycle = useCallback(
    (sessionId: string, lifecycle: SessionFullscreenLifecycle) => {
      lifecycleBySessionRef.current.set(sessionId, lifecycle);
      if (activeSessionIdRef.current === sessionId) {
        activeLifecycleRef.current = lifecycle;
      }
      return () => {
        if (lifecycleBySessionRef.current.get(sessionId) === lifecycle) {
          lifecycleBySessionRef.current.delete(sessionId);
        }
      };
    },
    [],
  );

  const exitFullscreen = useCallback(
    (sessionId?: string) => {
      const owner = activeSessionIdRef.current;
      if (!owner || (sessionId && owner !== sessionId)) return;

      runActiveExitLifecycle();
      activeSessionIdRef.current = null;
      setActiveSessionId(null);
      enqueueNativeTransition(restoreNativeWindow);

      const previousFocusedElement = previousFocusedElementRef.current;
      previousFocusedElementRef.current = null;
      restoreSessionTriggerFocus(owner, previousFocusedElement);
    },
    [enqueueNativeTransition, restoreNativeWindow, runActiveExitLifecycle],
  );

  const enterFullscreen = useCallback(
    (sessionId: string) => {
      if (activeSessionIdRef.current === sessionId) return;

      const previousOwner = activeSessionIdRef.current;
      if (previousOwner) {
        runActiveExitLifecycle();
      }
      activeSessionIdRef.current = sessionId;
      activeLifecycleRef.current =
        lifecycleBySessionRef.current.get(sessionId) ?? null;
      setActiveSessionId(sessionId);
      previousFocusedElementRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      focusSession(sessionId);
      try {
        activeLifecycleRef.current?.onEnter?.();
      } catch {
        // Native/app fullscreen still proceeds if a protocol reflow fails.
      }

      enqueueNativeTransition(async () => {
        if (previousOwner) {
          await restoreNativeWindow();
        }
        if (activeSessionIdRef.current !== sessionId) return;

        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const nativeWindow = getCurrentWindow();
          const wasFullscreen = await nativeWindow.isFullscreen();
          if (activeSessionIdRef.current !== sessionId) return;

          nativeWindowRef.current = nativeWindow;
          previousNativeFullscreenRef.current = wasFullscreen;
          if (!wasFullscreen) {
            await nativeWindow.setFullscreen(true);
          }
          if (activeSessionIdRef.current !== sessionId) {
            await restoreNativeWindow();
            return;
          }
          await nativeWindow.setFocus();
        } catch {
          // Browser builds never obtain a native window. If a later native
          // operation failed, retain the captured prior state so exit can
          // still make a best-effort restoration.
        }
      });
    },
    [enqueueNativeTransition, restoreNativeWindow, runActiveExitLifecycle],
  );

  const setFullscreen = useCallback(
    (sessionId: string, nextValue: React.SetStateAction<boolean>) => {
      const current = activeSessionIdRef.current === sessionId;
      const next =
        typeof nextValue === "function" ? nextValue(current) : nextValue;
      if (next === current) return;
      if (next) enterFullscreen(sessionId);
      else exitFullscreen(sessionId);
    },
    [enterFullscreen, exitFullscreen],
  );

  useEffect(() => {
    if (!activeSessionId) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      exitFullscreen(activeSessionId);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [activeSessionId, exitFullscreen]);

  useEffect(
    () => () => {
      runActiveExitLifecycle();
      activeSessionIdRef.current = null;
      enqueueNativeTransition(restoreNativeWindow);
    },
    [enqueueNativeTransition, restoreNativeWindow, runActiveExitLifecycle],
  );

  const value = useMemo(
    () => ({
      activeSessionId,
      enterFullscreen,
      exitFullscreen,
      setFullscreen,
      registerLifecycle,
    }),
    [
      activeSessionId,
      enterFullscreen,
      exitFullscreen,
      registerLifecycle,
      setFullscreen,
    ],
  );

  return (
    <SessionFullscreenContext.Provider value={value}>
      {children}
    </SessionFullscreenContext.Provider>
  );
};
