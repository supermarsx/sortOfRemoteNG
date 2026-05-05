import { useState, useMemo, useEffect, useCallback } from "react";
import { GlobalSettings } from "../../types/settings/settings";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  type TrustRecord,
  type ConnectionTrustGroup,
} from "../../utils/auth/trustStore";
import { useConnections } from "../../contexts/useConnections";

export interface ClassifiedTrustRecords {
  httpsRecords: TrustRecord[];
  certificateRecords: TrustRecord[];
  rdpRecords: TrustRecord[];
  sshRecords: TrustRecord[];
  legacyTlsRecords: TrustRecord[];
}

export function classifyTrustRecords(
  records: TrustRecord[],
): ClassifiedTrustRecords {
  return {
    httpsRecords: records.filter((record) => record.type === "https"),
    certificateRecords: records.filter(
      (record) => record.type === "certificate",
    ),
    rdpRecords: records.filter((record) => record.type === "rdp"),
    sshRecords: records.filter((record) => record.type === "ssh"),
    legacyTlsRecords: records.filter((record) => record.type === "tls"),
  };
}

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

  const classifiedTrustRecords = useMemo(
    () => classifyTrustRecords(trustRecords),
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
    ...classifiedTrustRecords,
    handleRemoveRecord,
    handleClearAll,
    totalCount,
  };
}
