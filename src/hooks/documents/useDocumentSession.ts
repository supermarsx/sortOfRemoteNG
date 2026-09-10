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
        /** Toolbar entry may open a locked tab before a database is ready. */
        allowUnavailable?: boolean;
      } = {},
    ) => {
      const databaseId = databaseAvailability?.databaseId;
      const ready = !!databaseId && databaseAvailability?.status === "ready";
      if (!ready && !options.allowUnavailable) return;
      if (
        options.parentFolderId &&
        !state.connections.some(
          (item) => item.id === options.parentFolderId && item.isGroup,
        )
      )
        return;
      const explicitNavigation =
        options.create ||
        !!options.documentId ||
        options.parentFolderId !== undefined;
      const existing =
        state.sessions.find(
          (session) =>
            session.protocol === DOCUMENTS_PROTOCOL &&
            !session.layout?.isDetached &&
            (session.documentsWorkspace?.databaseId ??
              session.ownerDatabaseId) === databaseId,
        ) ??
        (!explicitNavigation
          ? state.sessions.find(
              (session) =>
                session.protocol === DOCUMENTS_PROTOCOL &&
                !session.layout?.isDetached &&
                !session.ownerDatabaseId &&
                !session.documentsWorkspace?.databaseId,
            )
          : undefined);
      if (existing && !explicitNavigation) {
        onActivateSession?.(existing.id);
        return;
      }
      const preferredId = databaseId
        ? `documents-${encodeURIComponent(databaseId)}`
        : `documents-unbound-${generateId()}`;
      const id =
        existing?.id ??
        (state.sessions.some((session) => session.id === preferredId)
          ? `${preferredId}-${generateId()}`
          : preferredId);
      const request = ready
        ? {
            databaseId,
            parentFolderId: options.parentFolderId,
            documentId: options.documentId,
            create: options.create,
            requestId: generateId(),
          }
        : undefined;
      if (state.sessions.some((session) => session.id === id)) {
        if (request)
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
