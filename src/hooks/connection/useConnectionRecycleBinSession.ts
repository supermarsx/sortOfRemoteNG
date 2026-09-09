import { useCallback, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { createConnectionRecycleBinSession } from "../../components/app/toolSession";
import { DatabaseManager } from "../../utils/connection/databaseManager";

export function useConnectionRecycleBinSession(
  onActivateSession?: (sessionId: string) => void,
) {
  const { state, dispatch, recycleBin } = useConnections();
  const sessions = useRef(state.sessions);
  sessions.current = state.sessions;
  const databaseId = recycleBin?.snapshot?.scope.databaseId;
  const open = useCallback(() => {
    if (!databaseId || !onActivateSession) return;
    const database = DatabaseManager.getInstance().getCurrentDatabase();
    if (database?.id !== databaseId) return;
    const candidate = createConnectionRecycleBinSession(
      databaseId,
      database.name,
    );
    if (!sessions.current.some((session) => session.id === candidate.id)) {
      sessions.current = [...sessions.current, candidate];
      dispatch({ type: "ADD_SESSION", payload: candidate });
    }
    onActivateSession(candidate.id);
  }, [databaseId, dispatch, onActivateSession]);
  return { open, available: Boolean(databaseId && onActivateSession) };
}
