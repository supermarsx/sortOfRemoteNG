import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { ConnectionSession } from "../../types/connection/connection";
import type { SessionLifecyclePatch } from "../../types/windowManager";
import { applySessionLifecyclePatch } from "../../utils/session/sessionLifecycle";

const hasLifecycleProvenance = (
  patch: SessionLifecyclePatch | undefined,
): patch is SessionLifecyclePatch &
  Required<
    Pick<SessionLifecyclePatch, "revision" | "actorGeneration" | "writerId">
  > =>
  patch !== undefined &&
  typeof patch.revision === "number" &&
  Number.isSafeInteger(patch.revision) &&
  patch.revision >= 0 &&
  typeof patch.actorGeneration === "number" &&
  Number.isSafeInteger(patch.actorGeneration) &&
  patch.actorGeneration >= 0 &&
  typeof patch.writerId === "string" &&
  patch.writerId.length > 0;

export function useDetachedSessionEvents(
  handleSessionClose: (sessionId: string) => Promise<boolean | void>,
  sessions: ConnectionSession[],
  dispatch: React.Dispatch<any>,
  setActiveSessionId: (id: string) => void,
) {
  // Use a ref so the reattach listener always reads current sessions
  // without needing sessions in the dependency array (which would cause
  // constant re-registration and missed events during the gap).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const handleCloseRef = useRef(handleSessionClose);
  handleCloseRef.current = handleSessionClose;

  // Listen for detached session closed
  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ sessionId?: string; lifecycle?: SessionLifecyclePatch }>(
      "detached-session-closed",
      (event) => {
        const sessionId = event.payload?.sessionId;
        if (!sessionId) return;
        const session = sessionsRef.current.find(
          (item) => item.id === sessionId,
        );
        const lifecycle = hasLifecycleProvenance(event.payload.lifecycle)
          ? event.payload.lifecycle
          : undefined;
        if (session && lifecycle) {
          const merged = applySessionLifecyclePatch(session, lifecycle);
          sessionsRef.current = sessionsRef.current.map((item) =>
            item.id === sessionId ? merged : item,
          );
          dispatch({ type: "UPDATE_SESSION", payload: merged });
          // Let the provider commit the authoritative lifecycle row before the
          // close path reads it through its own current-state ref.
          setTimeout(() => {
            handleCloseRef.current(sessionId).catch(console.error);
          }, 0);
          return;
        }
        handleCloseRef.current(sessionId).catch(console.error);
      },
    )
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // Register once for each stable provider dispatch function; handleCloseRef
    // keeps the mutable close callback current.
  }, [dispatch]);

  // Listen for detached session reattach
  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{
      sessionId?: string;
      terminalBuffer?: string;
      lifecycle?: SessionLifecyclePatch;
    }>("detached-session-reattach", (event) => {
      const sessionId = event.payload?.sessionId;
      if (!sessionId) return;
      // Read current sessions from ref — always up to date
      const canonical = sessionsRef.current.find((s) => s.id === sessionId);
      const lifecycle = hasLifecycleProvenance(event.payload.lifecycle)
        ? event.payload.lifecycle
        : undefined;
      const session = canonical
        ? applySessionLifecyclePatch(canonical, lifecycle)
        : undefined;
      if (!session) return;
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          ...session,
          terminalBuffer:
            event.payload.terminalBuffer || session.terminalBuffer,
          layout: {
            x: session.layout?.x ?? 0,
            y: session.layout?.y ?? 0,
            width: session.layout?.width ?? 800,
            height: session.layout?.height ?? 600,
            zIndex: session.layout?.zIndex ?? 1,
            isDetached: false,
            windowId: undefined, // Clear — no longer in a detached window
          },
        },
      });
      setActiveSessionId(sessionId);
      // Clean up localStorage entry for reattached session
      try {
        localStorage.removeItem(`detached-session-${sessionId}`);
      } catch {
        /* ignore */
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // Register once — sessionsRef keeps it current
  }, [dispatch, setActiveSessionId]);

  // Clean stale detached-session localStorage entries on app exit
  useEffect(() => {
    const handleBeforeUnload = () => {
      const current = sessionsRef.current;
      current.forEach((session) => {
        if (!session.layout?.isDetached) {
          localStorage.removeItem(`detached-session-${session.id}`);
        }
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
}
