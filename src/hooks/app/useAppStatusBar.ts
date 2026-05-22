import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Connection, ConnectionSession } from "../../types/connection/connection";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { isRealConnectionSession } from "../../utils/session/sessionClassification";

interface AppStatusBarInput {
  connections: Connection[];
  sessions: ConnectionSession[];
  databaseManager: DatabaseManager;
  isInitialized: boolean;
}

export function useAppStatusBar({
  connections,
  sessions,
  databaseManager,
  isInitialized,
}: AppStatusBarInput) {
  const { t } = useTranslation();

  const collection = databaseManager.getCurrentDatabase();

  // Only count real remote connections — `isRealConnectionSession`
  // excludes `tool:*` and `winmgmt:*` tabs (which are app surfaces,
  // not sessions). Centralised so this filter can't drift from
  // the rest of the app's session-counting logic.
  const realSessions = useMemo(
    () => sessions.filter(isRealConnectionSession),
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
