import { useCallback } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";

export const DOCUMENTS_PROTOCOL = "tool:documents";

export function useDocumentSession(onActivateSession?: (id: string) => void) {
  const { state, dispatch, databaseAvailability } = useConnections();
  return useCallback(
    (
      options: {
        parentFolderId?: string;
        documentId?: string;
        create?: boolean;
      } = {},
    ) => {
      const databaseId = databaseAvailability?.databaseId;
      if (!databaseId || databaseAvailability.status !== "ready") return;
      if (
        options.parentFolderId &&
        !state.connections.some(
          (item) => item.id === options.parentFolderId && item.isGroup,
        )
      )
        return;
      const id = `documents-${encodeURIComponent(databaseId)}`;
      const request = { databaseId, ...options, requestId: generateId() };
      if (state.sessions.some((session) => session.id === id)) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: { id, documentsWorkspace: request },
        });
      } else {
        const session: ConnectionSession = {
          id,
          connectionId: "tool-documents",
          name: "Documents",
          status: "connected",
          startTime: new Date(),
          protocol: DOCUMENTS_PROTOCOL,
          hostname: "",
          ownerDatabaseId: databaseId,
          documentsWorkspace: request,
        };
        dispatch({ type: "ADD_SESSION", payload: session });
      }
      onActivateSession?.(id);
    },
    [
      databaseAvailability,
      dispatch,
      onActivateSession,
      state.connections,
      state.sessions,
    ],
  );
}
