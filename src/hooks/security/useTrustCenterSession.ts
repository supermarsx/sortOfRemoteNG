import { useCallback, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { createTrustCenterSession } from "../../components/app/toolSession";
import type { ConnectionSession } from "../../types/connection/connection";

export function useTrustCenterSession(
  onActivateSession?: (id: string) => void,
  source?: ConnectionSession,
) {
  const { state, dispatch } = useConnections();
  const sessions = useRef(state.sessions);
  sessions.current = state.sessions;
  return useCallback(() => {
    if (!onActivateSession) return;
    const candidate = createTrustCenterSession(source);
    const existing = sessions.current.find((item) => item.id === candidate.id);
    if (!existing) {
      sessions.current = [...sessions.current, candidate];
      dispatch({ type: "ADD_SESSION", payload: candidate });
    }
    onActivateSession(candidate.id);
  }, [dispatch, onActivateSession, source]);
}
