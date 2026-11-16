import { useCallback, useEffect, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { SESSION_ENDED_WHILE_AWAY } from "../../services/session/reconcileWorkspace";
import {
  buildSessionClaims,
  claimsKey,
  HEARTBEAT_HIDDEN_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  sendSessionHostHeartbeat,
  type HeartbeatAck,
} from "../../services/session/sessionHostHeartbeat";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { useVisibleInterval } from "../perf/useVisibleInterval";

/**
 * Claims the backend sessions this window holds (every tab, including hidden
 * ones) on a visible-aware interval, sends one right away whenever the claimed
 * set changes (e.g. just after boot adoption), and marks tabs whose backend
 * session no longer exists as dead so the user can reconnect.
 */
export function useSessionHostHeartbeat(): void {
  const { state, dispatch } = useConnections();
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  const inFlightRef = useRef(false);

  const applyMissing = useCallback(
    (ack: HeartbeatAck) => {
      for (const gone of ack.missing) {
        for (const session of sessionsRef.current) {
          if (
            session.protocol !== gone.protocol ||
            session.backendSessionId !== gone.backendSessionId ||
            session.status === "connecting"
          ) {
            continue;
          }
          dispatch({
            type: "UPDATE_SESSION",
            payload: {
              ...session,
              status: "disconnected",
              backendSessionId: undefined,
              errorMessage: SESSION_ENDED_WHILE_AWAY,
            },
          });
        }
      }
    },
    [dispatch],
  );

  const beat = useCallback(async () => {
    if (inFlightRef.current) return;
    const claims = buildSessionClaims(sessionsRef.current);
    inFlightRef.current = true;
    try {
      const ack = await sendSessionHostHeartbeat(
        claims,
        SettingsManager.getInstance().getSettings().sessionGraceSeconds,
      );
      if (ack && ack.missing.length > 0) applyMissing(ack);
    } finally {
      inFlightRef.current = false;
    }
  }, [applyMissing]);

  useVisibleInterval(() => void beat(), HEARTBEAT_INTERVAL_MS, {
    hidden: HEARTBEAT_HIDDEN_INTERVAL_MS,
  });

  const key = claimsKey(buildSessionClaims(state.sessions));
  useEffect(() => {
    if (key.length > 0) void beat();
  }, [key, beat]);
}
