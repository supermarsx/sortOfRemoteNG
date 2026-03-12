import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Connection, ConnectionSession } from "../../types/connection/connection";
import { CollectionManager } from "../../utils/connection/collectionManager";

interface AppStatusBarInput {
  connections: Connection[];
  sessions: ConnectionSession[];
  collectionManager: CollectionManager;
  isInitialized: boolean;
}

export function useAppStatusBar({
  connections,
  sessions,
  collectionManager,
  isInitialized,
}: AppStatusBarInput) {
  const { t } = useTranslation();

  const collection = collectionManager.getCurrentCollection();

  const sessionsByStatus = useMemo(() => {
    const connected = sessions.filter(
      (s) => s.status === "connected",
    ).length;
    const connecting = sessions.filter(
      (s) => s.status === "connecting",
    ).length;
    const errored = sessions.filter(
      (s) => s.status === "error" || s.status === "disconnected",
    ).length;
    return { connected, connecting, errored, total: sessions.length };
  }, [sessions]);

  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      const p = (s.protocol || "unknown").toUpperCase();
      counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }, [sessions]);

  return {
    t,
    isInitialized,
    collectionName: collection?.name ?? null,
    connectionCount: connections.length,
    sessionsByStatus,
    protocolCounts,
  };
}
