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

  // Only count real remote connections — exclude tools, settings, diagnostics, etc.
  const realSessions = useMemo(
    () => sessions.filter((s) => !s.protocol.startsWith("tool:") && !s.protocol.startsWith("winmgmt:")),
    [sessions],
  );

  const sessionsByStatus = useMemo(() => {
    const connected = realSessions.filter((s) => s.status === "connected").length;
    const connecting = realSessions.filter((s) => s.status === "connecting").length;
    const errored = realSessions.filter((s) => s.status === "error" || s.status === "disconnected").length;
    return { connected, connecting, errored, total: realSessions.length };
  }, [realSessions]);

  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of realSessions) {
      const p = (s.protocol || "unknown").toUpperCase();
      counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }, [realSessions]);

  return {
    t,
    isInitialized,
    collectionName: collection?.name ?? null,
    connectionCount: connections.length,
    sessionsByStatus,
    protocolCounts,
  };
}
