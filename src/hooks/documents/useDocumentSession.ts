import { useCallback } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";
import { activateNewToolTab } from "../../utils/session/activateNewToolTab";
import { APP_DOCUMENTS_OWNER_ID } from "../../utils/documents/appDocumentsStore";

export const DOCUMENTS_PROTOCOL = "tool:documents";

export function useDocumentSession(onActivateSession?: (id: string) => void) {
  const { state, dispatch, databaseAvailability } = useConnections();
  return useCallback(
    (
      options: {
        scope?: "app" | "database";
        parentFolderId?: string;
        documentId?: string;
        create?: boolean;
        /** Toolbar entry may open a locked tab before a database is ready. */
        allowUnavailable?: boolean;
      } = {},
    ) => {
      const scope = options.scope ?? "database";
      const isApp = scope === "app";
      const databaseId = isApp
        ? APP_DOCUMENTS_OWNER_ID
        : databaseAvailability?.databaseId;
      const ready =
        isApp || (!!databaseId && databaseAvailability?.status === "ready");
      if (!ready && !options.allowUnavailable) return;
      if (
        options.parentFolderId &&
        (isApp ||
          !state.connections.some(
            (item) => item.id === options.parentFolderId && item.isGroup,
          ))
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
            (session.documentsWorkspace?.scope ?? "database") === scope &&
            (session.documentsWorkspace?.databaseId ??
              session.ownerDatabaseId) === databaseId,
        ) ??
        (!isApp && !explicitNavigation
          ? state.sessions.find(
              (session) =>
                session.protocol === DOCUMENTS_PROTOCOL &&
                !session.layout?.isDetached &&
                session.documentsWorkspace?.scope !== "app" &&
                !session.ownerDatabaseId &&
                !session.documentsWorkspace?.databaseId,
            )
          : undefined);
      if (existing && !explicitNavigation) {
        onActivateSession?.(existing.id);
        return;
      }
      const preferredId = isApp
        ? "documents-app-wide"
        : databaseId
          ? `documents-${encodeURIComponent(databaseId)}`
          : `documents-unbound-${generateId()}`;
      const id =
        existing?.id ??
        (state.sessions.some((session) => session.id === preferredId)
          ? `${preferredId}-${generateId()}`
          : preferredId);
      const request =
        ready && databaseId
          ? {
              databaseId,
              scope,
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
          name: isApp ? "Documents · App-wide" : "Documents",
          status: "connected",
          startTime: new Date(),
          protocol: DOCUMENTS_PROTOCOL,
          hostname: "",
          ownerDatabaseId: isApp ? undefined : databaseId,
          documentsWorkspace: request,
        };
        dispatch({ type: "ADD_SESSION", payload: session });
        activateNewToolTab(session, onActivateSession);
        return;
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
