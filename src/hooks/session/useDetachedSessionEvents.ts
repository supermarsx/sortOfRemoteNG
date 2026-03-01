import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { ConnectionSession } from "../../types/connection";

export function useDetachedSessionEvents(
  handleSessionClose: (sessionId: string) => Promise<void>,
  sessions: ConnectionSession[],
  dispatch: React.Dispatch<any>,
  setActiveSessionId: (id: string) => void
) {
  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<{ sessionId?: string }>("detached-session-closed", (event) => {
      const sessionId = event.payload?.sessionId;
      if (!sessionId) return;
      handleSessionClose(sessionId).catch(console.error);
    })
      .then((stop) => {
        if (typeof stop === "function") {
          if (isCancelled) {
            try {
              Promise.resolve(stop()).catch(() => {});
            } catch {
              /* ignore */
            }
          } else {
            unlistenFn = stop;
          }
        }
      })
      .catch(console.error);

    return () => {
      isCancelled = true;
      try {
        Promise.resolve(unlistenFn?.()).catch(() => {});
      } catch {
        /* ignore */
      }
    };
  }, [handleSessionClose]);

  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<{ sessionId?: string; terminalBuffer?: string }>(
      "detached-session-reattach",
      (event) => {
        const sessionId = event.payload?.sessionId;
        if (!sessionId) return;
        const session = sessions.find((item) => item.id === sessionId);
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
              windowId: session.layout?.windowId,
            },
          },
        });
        setActiveSessionId(sessionId);
      }
    )
      .then((stop) => {
        if (typeof stop === "function") {
          if (isCancelled) {
            try {
              Promise.resolve(stop()).catch(() => {});
            } catch {
              /* ignore */
            }
          } else {
            unlistenFn = stop;
          }
        }
      })
      .catch(console.error);

    return () => {
      isCancelled = true;
      try {
        Promise.resolve(unlistenFn?.()).catch(() => {});
      } catch {
        /* ignore */
      }
    };
  }, [dispatch, setActiveSessionId, sessions]);
}
