import { useEffect } from "react";
import type { ConnectionSession } from "../../types/connection/connection";
import { hasNoLiveTransport } from "../../utils/session/sessionClassification";

/** Attribute that marks the element wrapping every protocol client view. */
export const SESSION_VIEWER_ATTRIBUTE = "data-session-viewer";

const isInsideSessionViewer = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(`[${SESSION_VIEWER_ATTRIBUTE}]`) !== null;

/**
 * Ctrl+W closes the active tab — but only when it is safe to steal the key:
 * either the session has no live transport (`error`/`connecting`, so the
 * remote cannot want the keystroke) or the event originates outside the
 * session viewer (tab bar, sidebar, …). With focus inside a connected
 * terminal/RDP canvas the keystroke belongs to the remote and is left alone.
 */
export function useCloseTabShortcut(
  sessions: ReadonlyArray<ConnectionSession>,
  activeSessionId: string | undefined,
  handleSessionClose: (sessionId: string) => unknown,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "w") return;
      if (!activeSessionId) return;
      const active = sessions.find((s) => s.id === activeSessionId);
      if (!active) return;
      if (!hasNoLiveTransport(active) && isInsideSessionViewer(event.target)) {
        return;
      }
      event.preventDefault();
      void handleSessionClose(activeSessionId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessions, activeSessionId, handleSessionClose]);
}
