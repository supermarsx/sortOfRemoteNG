import { useCallback, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import { createCredentialEditorSession } from "../../components/app/toolSession";
import type { ConnectionSession } from "../../types/connection/connection";
import type { CredentialEditorRequest } from "../../types/security/credentialEditor";

/** Opening an editor is explicit. Repeated clicks focus its existing private draft. */
export function useCredentialEditorSession(
  onActivateSession?: (id: string) => void,
  source?: ConnectionSession,
) {
  const { state, dispatch, databaseAvailability, credentialVault } =
    useConnections();
  const sessions = useRef(state.sessions);
  sessions.current = state.sessions;
  return useCallback(
    (request: CredentialEditorRequest) => {
      const scope = credentialVault?.scope;
      if (
        !onActivateSession ||
        source?.layout?.isDetached ||
        databaseAvailability?.status !== "ready" ||
        !scope ||
        databaseAvailability.databaseId !== scope.databaseId ||
        request.scope.databaseId !== scope.databaseId ||
        request.scope.generation !== scope.generation
      )
        return;
      const candidate = createCredentialEditorSession(request, source);
      const existing = sessions.current.find((item) => {
        const editor = item.credentialEditor;
        return (
          item.protocol === candidate.protocol &&
          !item.layout?.isDetached &&
          item.ownerDatabaseId === scope.databaseId &&
          editor &&
          editor.scope.databaseId === scope.databaseId &&
          editor.scope.generation === scope.generation &&
          editor.mode === request.mode &&
          (request.mode !== "edit" ||
            (editor.mode === "edit" &&
              editor.credentialId === request.credentialId)) &&
          (request.mode !== "migrate" ||
            (editor.mode === "migrate" &&
              editor.connectionId === request.connectionId))
        );
      });
      if (existing) {
        onActivateSession(existing.id);
        return;
      }
      sessions.current = [...sessions.current, candidate];
      dispatch({ type: "ADD_SESSION", payload: candidate });
      onActivateSession(candidate.id);
    },
    [
      credentialVault,
      databaseAvailability,
      dispatch,
      onActivateSession,
      source,
    ],
  );
}
