import { useEffect, useState } from "react";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import {
  cloudSyncErrorMessage,
  unavailableCloudSyncDatabaseIds,
} from "../../utils/settings/cloudSyncPresentation";

/** Resolve legacy error IDs from the public index, never database contents. */
export function CloudSyncErrorMessage({ message }: { message: string }) {
  const [resolved, setResolved] = useState<{
    message: string;
    names: Map<string, string>;
  }>();
  useEffect(() => {
    const ids = new Set(unavailableCloudSyncDatabaseIds(message));
    if (!ids.size) return;
    let active = true;
    void (async () => {
      try {
        const databases = await DatabaseManager.getInstance().getAllDatabases();
        if (!active) return;
        const names = new Map(
          databases
            .filter((database) => ids.has(database.id))
            .map((database) => [database.id, database.name]),
        );
        setResolved({ message, names });
      } catch {
        // Metadata may itself be unavailable. Keep the safe generic label;
        // do not trigger unlocks, select another scope or mask the sync failure.
      }
    })();
    return () => {
      active = false;
    };
  }, [message]);
  return cloudSyncErrorMessage(
    message,
    resolved?.message === message ? resolved.names : undefined,
  );
}
