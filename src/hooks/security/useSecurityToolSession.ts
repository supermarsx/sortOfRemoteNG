import { useCallback, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import {
  createSecurityToolSession,
  type SecurityTool,
} from "../../components/app/toolSession";
import type { ConnectionSession } from "../../types/connection/connection";

export interface SecurityToolCallbacks {
  onOpenCredentialVault?: () => void;
  onOpenHardwareKeys?: () => void;
}

/** One tool per host window and, for private vaults, owning database. */
export function useSecurityToolSession(
  tool: SecurityTool,
  onActivateSession?: (id: string) => void,
  source?: ConnectionSession,
) {
  const { state, dispatch, databaseAvailability } = useConnections();
  const sessions = useRef(state.sessions);
  sessions.current = state.sessions;
  const databaseId = databaseAvailability?.databaseId ?? undefined;
  return useCallback(() => {
    if (!onActivateSession) return;
    if (tool === "credentialVault" && source?.layout?.isDetached) return;
    const candidate = createSecurityToolSession(tool, source, databaseId);
    const existing = sessions.current.find(
      (item) =>
        item.protocol === candidate.protocol &&
        !!item.layout?.isDetached === !!candidate.layout?.isDetached &&
        item.layout?.windowId === candidate.layout?.windowId &&
        (tool !== "credentialVault" || item.ownerDatabaseId === databaseId),
    );
    if (existing) {
      onActivateSession(existing.id);
      return;
    }
    sessions.current = [...sessions.current, candidate];
    dispatch({ type: "ADD_SESSION", payload: candidate });
    onActivateSession(candidate.id);
  }, [tool, dispatch, onActivateSession, source, databaseId]);
}
