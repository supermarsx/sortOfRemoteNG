import { useCallback, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { createIconExplorerSession } from "../../components/app/toolSession";
import type { ConnectionSession } from "../../types/connection/connection";

/** One independent explorer per host window; repeated activation focuses it. */
export function useIconExplorerSession(
  onActivateSession?: (id: string) => void,
  source?: ConnectionSession,
) {
  const { state, dispatch } = useConnections();
  const sessions = useRef(state.sessions);
  sessions.current = state.sessions;
  return useCallback(() => {
    if (!onActivateSession) return;
    const candidate = createIconExplorerSession(source);
    if (!sessions.current.some((item) => item.id === candidate.id)) {
      sessions.current = [...sessions.current, candidate];
      dispatch({ type: "ADD_SESSION", payload: candidate });
    }
    onActivateSession(candidate.id);
  }, [dispatch, onActivateSession, source]);
}
