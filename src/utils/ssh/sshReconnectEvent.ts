/**
 * In-place SSH reconnect request. The tab context menu dispatches this so a
 * mounted terminal reconnects without closing the tab (the xterm buffer and
 * replay cursor survive). When no terminal marks the request handled, the
 * caller falls back to close-and-reopen.
 */
export const SSH_SESSION_RECONNECT_EVENT = "sor:ssh-session-reconnect";

export interface SshSessionReconnectDetail {
  sessionId: string;
  handled: boolean;
}

/** Returns true when a mounted SSH terminal took ownership of the request. */
export function requestInPlaceSshReconnect(sessionId: string): boolean {
  const detail: SshSessionReconnectDetail = { sessionId, handled: false };
  window.dispatchEvent(
    new CustomEvent<SshSessionReconnectDetail>(SSH_SESSION_RECONNECT_EVENT, {
      detail,
    }),
  );
  return detail.handled;
}
