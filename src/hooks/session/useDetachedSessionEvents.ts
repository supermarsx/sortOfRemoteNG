import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { ConnectionSession } from "../../types/connection/connection";

export function useDetachedSessionEvents(
  handleSessionClose: (sessionId: string) => Promise<void>,
  sessions: ConnectionSession[],
  dispatch: React.Dispatch<any>,
  setActiveSessionId: (id: string) => void
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

    listen<{ sessionId?: string }>("detached-session-closed", (event) => {
      const sessionId = event.payload?.sessionId;
      if (!sessionId) return;
      handleCloseRef.current(sessionId).catch(console.error);
    })
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisten = fn; }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  // Register once — handleCloseRef keeps it current
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for detached session reattach
  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<{ sessionId?: string; terminalBuffer?: string }>(
      "detached-session-reattach",
      (event) => {
        const sessionId = event.payload?.sessionId;
        if (!sessionId) return;
        // Read current sessions from ref — always up to date
        const session = sessionsRef.current.find((s) => s.id === sessionId);
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
        try { localStorage.removeItem(`detached-session-${sessionId}`); } catch { /* ignore */ }
      }
    )
      .then((fn) => {
        if (cancelled) { fn(); } else { unlisten = fn; }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  // Register once — sessionsRef keeps it current
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
}
