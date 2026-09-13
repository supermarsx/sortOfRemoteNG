import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../../contexts/ConnectionContextTypes";
import type { Connection } from "../../../types/connection/connection";
import type {
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../../types/security/databaseCredentialVault";
import { credentialVaultScopeKey } from "../../../hooks/security/useDatabaseCredentialVault";
import {
  connectionCredentialInventory,
  type ConnectionCredentialInventoryRow,
} from "../../../utils/security/connectionCredentialInventory";

/** Reuses the vault's native protection proof; the Provider remains the only owner. */
export function useConnectionCredentialInventory(
  api: DatabaseCredentialVaultApi,
  snapshot: DatabaseCredentialSnapshot | null,
  loading: boolean,
  onEditConnection?: (connection: Connection) => void,
) {
  const context = useContext(ConnectionContext);
  const availability = context?.databaseAvailability;
  // These epochs are intentionally different: the vault uses the load/review
  // generation; the Provider getter uses its database-availability generation.
  const connectionScope =
    availability?.status === "ready" &&
    availability.databaseId === api.scope?.databaseId &&
    availability.databaseId
      ? {
          databaseId: availability.databaseId,
          generation: availability.generation,
        }
      : null;
  const key = JSON.stringify([credentialVaultScopeKey(api), connectionScope]);
  const latest = useRef({
    context,
    api,
    key,
    connectionScope,
    onEditConnection,
  });
  latest.current = { context, api, key, connectionScope, onEditConnection };
  const alive = useRef(true);
  const busyRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  let rows: ConnectionCredentialInventoryRow[] = [];
  let unavailable = !context?.getCurrentConnections || !connectionScope;
  if (
    !loading &&
    snapshot &&
    api.scope &&
    snapshot.scope.databaseId === api.scope.databaseId &&
    snapshot.scope.generation === api.scope.generation
  ) {
    try {
      if (context?.getCurrentConnections && connectionScope)
        rows = connectionCredentialInventory(
          context.getCurrentConnections(connectionScope),
        );
    } catch {
      unavailable = true;
    }
  }
  const edit = async (id: string) => {
    if (busyRef.current || loading || !snapshot || !onEditConnection) return;
    busyRef.current = true;
    setOpening(true);
    setError(null);
    const assertOwner = () => {
      const current = latest.current;
      if (
        !alive.current ||
        current.key !== key ||
        !current.api.scope ||
        !current.connectionScope ||
        !current.context?.getCurrentConnections ||
        !current.onEditConnection
      )
        throw new Error("Unavailable owner");
      current.context.getCurrentConnections(current.connectionScope);
      return current;
    };
    try {
      const current = assertOwner();
      // Repeat artifact protection and current-file verification before passing
      // authoritative connection data to its existing private editor.
      const reviewed = await current.api.list({ ...current.api.scope! });
      const now = assertOwner();
      if (
        reviewed.scope.databaseId !== now.api.scope!.databaseId ||
        reviewed.scope.generation !== now.api.scope!.generation
      )
        throw new Error("Changed review");
      const matches = now.context!.getCurrentConnections!(
        now.connectionScope!,
      ).filter((row) => row.id === id);
      if (
        matches.length !== 1 ||
        !connectionCredentialInventory(matches).length
      )
        throw new Error("Connection removed or changed");
      now.onEditConnection!(matches[0]);
    } catch {
      if (alive.current && latest.current.key === key)
        setError(
          "The connection could not be opened. Unlock and reload its owning protected database, then review the current connection again.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setOpening(false);
    }
  };
  return { rows, unavailable, opening, error, edit };
}
