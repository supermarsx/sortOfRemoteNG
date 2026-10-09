import { useLayoutEffect, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import { getQuickConnectConnection } from "../../utils/session/runtimeConnectionRegistry";
import {
  ORIGIN_BROWSER_RECOVERY_EVENT,
  readOriginBrowserRecovery,
  browserRecoveryEditorTarget,
  type BrowserRecoveryEditorSession,
} from "../../utils/session/originBrowserRecovery";
import { createToolSession } from "../../components/app/toolSession";
import { generateId } from "../../utils/core/id";

/** Main-window navigation only: never unlock, save, launch login, or reconnect. */
export function useOriginBrowserRecovery(options: {
  activateSession: (id: string) => void;
  openDatabases: () => void;
  openQuickConnect: () => void;
}) {
  const context = useConnections();
  const latest = useRef({ context, options });
  useLayoutEffect(() => {
    latest.current = { context, options };
  });
  useLayoutEffect(() => {
    const receive = (event: Event) => {
      try {
        const issued = readOriginBrowserRecovery(event);
        if (!issued) return;
        const { request, assertCurrent } = issued;
        const { context: current, options: actions } = latest.current;
        const sources = current.state.sessions.filter(
          (source) =>
            source.id === request.sessionId &&
            source.connectionId === request.connectionId &&
            source.ownerDatabaseId === request.ownerDatabaseId &&
            !source.layout?.isDetached &&
            ["http", "https"].includes(source.protocol),
        );
        if (sources.length !== 1) return;
        const source = sources[0];
        if (request.action === "database") {
          assertCurrent();
          actions.openDatabases();
        } else if (request.action === "quick-connect") {
          if (
            source.ownerDatabaseId ||
            current.state.connections.some(
              (row) => row.id === source.connectionId,
            ) ||
            !getQuickConnectConnection(source.connectionId)
          )
            return;
          assertCurrent();
          actions.openQuickConnect();
        } else {
          const scope = current.databaseAvailability;
          const manager = DatabaseManager.getInstance();
          if (
            !request.ownerDatabaseId ||
            scope?.status !== "ready" ||
            scope.databaseId !== request.ownerDatabaseId ||
            manager.getCurrentDatabase()?.id !== request.ownerDatabaseId
          )
            return;
          const lease = captureSessionDatabaseAccess(source);
          const rows = current
            .getCurrentConnections?.({
              databaseId: request.ownerDatabaseId,
              generation: scope.generation,
            })
            .filter((row) => row.id === request.connectionId);
          if (
            rows?.length !== 1 ||
            rows[0].isGroup ||
            !["http", "https"].includes(rows[0].protocol)
          )
            return;
          const row = rows[0];
          const target = browserRecoveryEditorTarget(request.action, row);
          if (!target) return;
          const existing = current.state.sessions.find(
            (candidate) =>
              candidate.protocol === "tool:connectionEditor" &&
              candidate.connectionId === row.id &&
              candidate.ownerDatabaseId === request.ownerDatabaseId &&
              !candidate.layout?.isDetached,
          );
          const editor: BrowserRecoveryEditorSession = {
            ...(existing ??
              createToolSession("connectionEditor", {
                connectionId: row.id,
                name: `Edit: ${row.name}`,
              })),
            ownerDatabaseId: request.ownerDatabaseId,
            browserRecoveryNavigation: {
              ...target,
              requestId: generateId(),
              connectionId: row.id,
              ownerDatabaseId: request.ownerDatabaseId,
            },
          };
          assertCurrent();
          lease();
          // Check again at the dispatch boundary; no unrelated database row
          // may stand in for the one that was reviewed in the browser shell.
          const fresh = current
            .getCurrentConnections?.({
              databaseId: request.ownerDatabaseId,
              generation: scope.generation,
            })
            .filter((candidate) => candidate.id === row.id);
          if (
            manager.getCurrentDatabase()?.id !== request.ownerDatabaseId ||
            fresh?.length !== 1 ||
            fresh[0] !== row
          )
            return;
          current.dispatch({
            type: existing ? "UPDATE_SESSION" : "ADD_SESSION",
            payload: editor,
          });
          actions.activateSession(editor.id);
        }
        event.preventDefault();
      } catch {
        // A revoked request is deliberately unhandled; the shell reports it.
      }
    };
    window.addEventListener(ORIGIN_BROWSER_RECOVERY_EVENT, receive);
    return () =>
      window.removeEventListener(ORIGIN_BROWSER_RECOVERY_EVENT, receive);
  }, []);
}
