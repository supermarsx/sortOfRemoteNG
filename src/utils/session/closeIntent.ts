/**
 * "User close" versus "component unmount" intent.
 *
 * Protocol hooks used to disconnect their backend session from React effect
 * cleanup. That cleanup also runs on Fast Refresh, tab remounts and layout
 * changes, so a healthy session was killed whenever the UI re-rendered from
 * scratch. Hooks now disconnect on unmount only when a user-driven close (or a
 * session removal) has marked the session id here. Everything else just
 * releases listeners and lets the next mount re-adopt the live backend session.
 *
 * In-memory only; ids are opaque tab ids, never secrets.
 */

const MAX_TRACKED = 512;
const marks = new Set<string>();

/** Record that the user (or the manager) has decided this session is over. */
export function markUserClose(sessionId: string): void {
  if (!sessionId) return;
  marks.delete(sessionId);
  marks.add(sessionId);
  while (marks.size > MAX_TRACKED) {
    const oldest = marks.values().next().value;
    if (oldest === undefined) break;
    marks.delete(oldest);
  }
}

export function hasUserClose(sessionId: string): boolean {
  return marks.has(sessionId);
}

/** Forget the mark, e.g. when a session id is re-created. */
export function clearUserClose(sessionId: string): void {
  marks.delete(sessionId);
}

/**
 * Effect-cleanup policy: only a genuine unmount of a session that was closed
 * on purpose may tear down the backend. Dependency-change cleanups (reconnect)
 * are the caller's business and always disconnect the superseded session.
 */
export function shouldDisconnectOnUnmount(sessionId: string): boolean {
  return hasUserClose(sessionId);
}

/** Test helper. */
export function resetCloseIntentForTests(): void {
  marks.clear();
}
