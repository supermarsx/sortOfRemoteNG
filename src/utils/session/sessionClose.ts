export const DEFAULT_SESSION_CLOSE_TIMEOUT_MS = 15_000;

export type SessionClosePhase = "closing" | "unresponsive";

/**
 * Transient renderer state for a single tab-close attempt. This is deliberately
 * kept outside ConnectionSession so a renderer-only timeout is never persisted
 * as proof that the native transport was closed.
 */
export interface SessionCloseState {
  readonly sessionId: string;
  readonly attemptId: number;
  readonly phase: SessionClosePhase;
  readonly startedAt: number;
  readonly timeoutMs: number;
  readonly cleanupPending: boolean;
  readonly message: string;
}

export type SessionCloseStateById = Readonly<
  Record<string, SessionCloseState | undefined>
>;
