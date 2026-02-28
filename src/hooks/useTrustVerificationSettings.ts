import { useState, useMemo, useEffect, useCallback } from "react";
import { GlobalSettings } from "../types/settings";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  type TrustRecord,
  type ConnectionTrustGroup,
} from "../utils/trustStore";
import { useConnections } from "../contexts/useConnections";

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTrustVerificationSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const [trustRecords, setTrustRecords] = useState<TrustRecord[]>(() =>
    getAllTrustRecords(),
  );
  const [connectionGroups, setConnectionGroups] = useState<
    ConnectionTrustGroup[]
  >(() => getAllPerConnectionTrustRecords());
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const { state: connectionState } = useConnections();

  const refreshRecords = useCallback(() => {
    setTrustRecords(getAllTrustRecords());
    setConnectionGroups(getAllPerConnectionTrustRecords());
  }, []);

  useEffect(() => {
    window.addEventListener("trustStoreChanged", refreshRecords);
    return () =>
      window.removeEventListener("trustStoreChanged", refreshRecords);
  }, [refreshRecords]);

  /** Resolve a connection ID to its name, falling back to a truncated ID. */
  const connectionName = useCallback(
    (id: string): string => {
      const conn = connectionState.connections.find((c) => c.id === id);
      return conn?.name || `Connection ${id.slice(0, 8)}…`;
    },
    [connectionState.connections],
  );

  const tlsRecords = useMemo(
    () => trustRecords.filter((r) => r.type === "tls"),
    [trustRecords],
  );
  const sshRecords = useMemo(
    () => trustRecords.filter((r) => r.type === "ssh"),
    [trustRecords],
  );

  const handleRemoveRecord = useCallback(
    (record: TrustRecord, connectionId?: string) => {
      const [host, portStr] = record.host.split(":");
      const port = parseInt(portStr, 10);
      removeIdentity(host, port, record.type, connectionId);
      refreshRecords();
    },
    [refreshRecords],
  );

  const handleClearAll = useCallback(() => {
    clearAllTrustRecords();
    // Also clear all per-connection stores
    connectionGroups.forEach((g) => clearAllTrustRecords(g.connectionId));
    refreshRecords();
    setShowConfirmClear(false);
  }, [connectionGroups, refreshRecords]);

  const totalCount =
    trustRecords.length +
    connectionGroups.reduce((sum, g) => sum + g.records.length, 0);

  return {
    settings,
    updateSettings,
    trustRecords,
    connectionGroups,
    showConfirmClear,
    setShowConfirmClear,
    refreshRecords,
    connectionName,
    tlsRecords,
    sshRecords,
    handleRemoveRecord,
    handleClearAll,
    totalCount,
  };
}
