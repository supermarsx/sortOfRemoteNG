import { useCallback, useEffect, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import {
  resolveRuntimeVaultCredential,
  runtimeCredentialTargetKey,
  type RuntimeVaultCredentialIntent,
} from "../../utils/security/runtimeCredentialVault";
import { normalizeConnectionCredentialSource } from "../../utils/security/databaseCredentialVault";

/** No resolved secrets in component state, saved connections or global registries. */
export function useRuntimeCredentialVault(
  session: ConnectionSession,
  connection: Connection | undefined,
) {
  const { credentialVault, databaseAvailability, state } = useConnections();
  const current = {
    session,
    connection,
    api: credentialVault,
    availability: databaseAvailability,
    saved:
      state?.connections.some((item) => item.id === session.connectionId) ===
      true,
  };
  const latest = useRef(current);
  latest.current = current;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return useCallback(
    async (
      assertAttempt: () => void,
      validateOnly = false,
      intent: RuntimeVaultCredentialIntent = "login",
    ) => {
      const captured = latest.current;
      if (
        captured.saved &&
        captured.session.ownerDatabaseId &&
        captured.availability &&
        (captured.availability.status !== "ready" ||
          captured.availability.databaseId !== captured.session.ownerDatabaseId)
      )
        throw new Error(
          "Open and unlock this session's owning database. No connection-local fallback was used.",
        );
      if (
        normalizeConnectionCredentialSource(
          captured.connection?.credentialSource,
        )?.kind !== "vault"
      )
        return null;
      const api = captured.api,
        selected = captured.connection;
      if (!selected) throw new Error("The vault connection is unavailable.");
      if (!api?.scope)
        throw new Error(
          "Open and unlock the owning protected database before using vault credentials.",
        );
      const scopeKey = JSON.stringify(api.scope),
        targetKey = runtimeCredentialTargetKey(selected);
      const target =
        DatabaseManager.getInstance().captureCurrentDatabaseDataTarget();
      if (!target)
        throw new Error("The owning credential database is unavailable.");
      const assertCurrent = () => {
        assertAttempt();
        if (
          !alive.current ||
          latest.current.session.id !== captured.session.id ||
          latest.current.session.connectionId !==
            captured.session.connectionId ||
          latest.current.session.ownerDatabaseId !==
            captured.session.ownerDatabaseId ||
          latest.current.session.hostname !== captured.session.hostname ||
          latest.current.session.protocol !== captured.session.protocol ||
          JSON.stringify(latest.current.api?.scope) !== scopeKey ||
          latest.current.api?.changeRevision !== api.changeRevision ||
          !latest.current.connection ||
          runtimeCredentialTargetKey(latest.current.connection) !== targetKey
        )
          throw new Error(
            "The vault credential attempt was cancelled because its session, database or connection changed.",
          );
        target.assertAccessible?.();
      };
      return resolveRuntimeVaultCredential({
        api,
        connection: selected,
        session: captured.session,
        target,
        assertCurrent,
        validateOnly,
        intent,
      });
    },
    [],
  );
}
