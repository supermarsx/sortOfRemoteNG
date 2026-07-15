import { useCallback, useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ConnectionBehaviorWindowKind } from "../../types/connection/behavior";
import { generateId } from "../../utils/core/id";
import {
  BEHAVIOR_WINDOW_LIFECYCLE_EVENT,
  type BehaviorWindowLifecycleEdge,
  type BehaviorWindowLifecycleSignal,
} from "../../utils/behavior/windowLifecycle";

export interface UseBehaviorWindowLifecycleOptions {
  windowId: string;
  kind: ConnectionBehaviorWindowKind;
  activeSessionId?: string;
  /** Main-window sink. Detached windows send only to the main label. */
  onSignal?(signal: BehaviorWindowLifecycleSignal): void | Promise<void>;
  /** The main window owns the single listener for detached signals. */
  receiveDetachedSignals?: boolean;
  now?: () => number;
  createEventId?: () => string;
}

interface PendingCloseAttempt {
  id: string;
  activeSessionId?: string;
}

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  Boolean(
    (
      window as typeof window & {
        __TAURI__?: unknown;
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI__ ||
    (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__,
  );

/**
 * Webview-local bridge for Tauri focus/minimize edges and explicit close
 * outcomes. It deliberately does not register a close-request listener; the
 * existing window policy is the only owner of that decision.
 */
export function useBehaviorWindowLifecycle(
  options: UseBehaviorWindowLifecycleOptions,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const minimizedRef = useRef<boolean | undefined>(undefined);
  const focusedRef = useRef<boolean | undefined>(undefined);
  const closeAttemptRef = useRef<PendingCloseAttempt | undefined>(undefined);

  const send = useCallback(
    async (
      edge: BehaviorWindowLifecycleEdge,
      closeAttempt?: PendingCloseAttempt,
    ) => {
      const runtime = optionsRef.current;
      const signal: BehaviorWindowLifecycleSignal = {
        version: 1,
        eventId: runtime.createEventId?.() ?? generateId(),
        edge,
        timestamp: runtime.now?.() ?? Date.now(),
        closeAttemptId: closeAttempt?.id,
        window: {
          id: runtime.windowId,
          kind: runtime.kind,
          activeSessionId:
            closeAttempt?.activeSessionId ?? runtime.activeSessionId,
        },
      };

      if (runtime.kind === "main") {
        await runtime.onSignal?.(signal);
      } else {
        await emitTo("main", BEHAVIOR_WINDOW_LIFECYCLE_EVENT, signal);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const currentWindow = getCurrentWindow();
    let active = true;

    const inspectMinimized = async () => {
      try {
        const minimized = await currentWindow.isMinimized();
        if (!active || minimizedRef.current === minimized) return;
        const hadValue = minimizedRef.current !== undefined;
        minimizedRef.current = minimized;
        if (!hadValue) return;
        await send(minimized ? "minimized" : "restored");
      } catch {
        // The webview can disappear while an async state read is pending.
      }
    };

    const focusUnlisten = currentWindow.onFocusChanged(async (event) => {
      const focused = event.payload;
      if (focusedRef.current !== focused) {
        focusedRef.current = focused;
        await send(focused ? "focused" : "blurred");
      }
      await inspectMinimized();
    });
    const resizeUnlisten = currentWindow.onResized(inspectMinimized);
    void currentWindow.isMinimized().then((value) => {
      if (active) minimizedRef.current = value;
    });

    return () => {
      active = false;
      focusUnlisten.then((unlisten) => unlisten()).catch(() => undefined);
      resizeUnlisten.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [send]);

  useEffect(() => {
    if (
      !options.receiveDetachedSignals ||
      options.kind !== "main" ||
      !isTauriRuntime()
    ) {
      return;
    }
    const unlisten = listen<BehaviorWindowLifecycleSignal>(
      BEHAVIOR_WINDOW_LIFECYCLE_EVENT,
      (event) => {
        const signal = event.payload;
        if (signal.window.kind !== "detached" || signal.window.id === "main") {
          return;
        }
        void optionsRef.current.onSignal?.(signal);
      },
    );
    return () => {
      unlisten.then((dispose) => dispose()).catch(() => undefined);
    };
  }, [options.kind, options.receiveDetachedSignals]);

  const requestClose = useCallback(async (): Promise<string | undefined> => {
    if (closeAttemptRef.current) return closeAttemptRef.current.id;
    const runtime = optionsRef.current;
    const attempt: PendingCloseAttempt = {
      id: runtime.createEventId?.() ?? generateId(),
      activeSessionId: runtime.activeSessionId,
    };
    closeAttemptRef.current = attempt;
    await send("closeRequested", attempt);
    return attempt.id;
  }, [send]);

  const cancelClose = useCallback(async () => {
    const attempt = closeAttemptRef.current;
    if (!attempt) return;
    closeAttemptRef.current = undefined;
    await send("closeCancelled", attempt);
  }, [send]);

  const confirmClose = useCallback(async () => {
    const attempt = closeAttemptRef.current;
    if (!attempt) return;
    closeAttemptRef.current = undefined;
    await send("closed", attempt);
  }, [send]);

  return { requestClose, cancelClose, confirmClose };
}
