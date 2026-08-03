import { useState, useMemo, useEffect, useCallback } from "react";
import { GlobalSettings } from "../../types/settings/settings";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  removeIdentity,
  clearEntireTrustStore,
  ensureTrustStoreReady,
  getTrustStoreAvailability,
  parseTrustRecordAddress,
  retryTrustStoreHydration,
  setTrustRecordPolicy,
  setTrustRecordRevoked,
  type TrustPolicy,
  updateTrustRecordNickname,
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
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState<string>();
  const [busyRecord, setBusyRecord] = useState<string>();
  const { state: connectionState } = useConnections();

  const refreshRecords = useCallback(() => {
    setTrustRecords(getAllTrustRecords());
    setConnectionGroups(getAllPerConnectionTrustRecords());
  }, []);

  const loadRecords = useCallback(
    async (retry = false) => {
      setStoreLoading(true);
      setStoreError(undefined);
      try {
        if (retry) await retryTrustStoreHydration();
        else await ensureTrustStoreReady();
        refreshRecords();
      } catch {
        setStoreError(
          "The native Trust Center could not be loaded. Trust-dependent connections remain blocked.",
        );
      } finally {
        setStoreLoading(false);
      }
    },
    [refreshRecords],
  );

  useEffect(() => {
    const handleChanged = () => {
      const availability = getTrustStoreAvailability();
      if (availability.state === "ready") {
        refreshRecords();
        setStoreError(undefined);
        setStoreLoading(false);
      } else if (availability.state === "error") {
        setStoreError(
          "The native Trust Center could not be loaded. Trust-dependent connections remain blocked.",
        );
        setStoreLoading(false);
      }
    };
    window.addEventListener("trustStoreChanged", handleChanged);
    void loadRecords();
    return () => window.removeEventListener("trustStoreChanged", handleChanged);
  }, [loadRecords, refreshRecords]);

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
    async (record: TrustRecord, connectionId?: string) => {
      const operationKey = `${connectionId ?? "global"}:${record.type}:${record.host}`;
      setBusyRecord(operationKey);
      setStoreError(undefined);
      try {
        const { host, port } = parseTrustRecordAddress(record);
        await removeIdentity(host, port, record.type, connectionId);
        refreshRecords();
      } catch {
        setStoreError("The trust record could not be removed safely.");
      } finally {
        setBusyRecord(undefined);
      }
    },
    [refreshRecords],
  );

  const handleClearAll = useCallback(async () => {
    setBusyRecord("clear-all");
    setStoreError(undefined);
    try {
      await clearEntireTrustStore();
      refreshRecords();
      setShowConfirmClear(false);
    } catch {
      setStoreError("The Trust Center could not be cleared safely.");
    } finally {
      setBusyRecord(undefined);
    }
  }, [refreshRecords]);

  const handleSetRevoked = useCallback(
    async (record: TrustRecord, revoked: boolean, connectionId?: string) => {
      const operationKey = `${connectionId ?? "global"}:${record.type}:${record.host}`;
      setBusyRecord(operationKey);
      setStoreError(undefined);
      try {
        await setTrustRecordRevoked(record, revoked, connectionId);
        refreshRecords();
      } catch {
        setStoreError(
          revoked
            ? "The trust record could not be revoked safely."
            : "The trust record could not be reinstated safely.",
        );
      } finally {
        setBusyRecord(undefined);
      }
    },
    [refreshRecords],
  );

  const handleSetPolicy = useCallback(
    async (
      record: TrustRecord,
      policy: TrustPolicy | undefined,
      connectionId?: string,
    ) => {
      const operationKey = `${connectionId ?? "global"}:${record.type}:${record.host}`;
      setBusyRecord(operationKey);
      setStoreError(undefined);
      try {
        await setTrustRecordPolicy(record, policy, connectionId);
        refreshRecords();
      } catch {
        setStoreError("The scoped trust policy could not be saved safely.");
      } finally {
        setBusyRecord(undefined);
      }
    },
    [refreshRecords],
  );

  const handleUpdateNickname = useCallback(
    async (record: TrustRecord, nickname: string, connectionId?: string) => {
      const operationKey = `${connectionId ?? "global"}:${record.type}:${record.host}`;
      setBusyRecord(operationKey);
      setStoreError(undefined);
      try {
        const { host, port } = parseTrustRecordAddress(record);
        await updateTrustRecordNickname(
          host,
          port,
          record.type,
          nickname,
          connectionId,
        );
        refreshRecords();
        return true;
      } catch {
        setStoreError("The trust record nickname could not be saved.");
        return false;
      } finally {
        setBusyRecord(undefined);
      }
    },
    [refreshRecords],
  );

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
    storeLoading,
    storeError,
    busyRecord,
    retryLoad: () => loadRecords(true),
    refreshRecords,
    connectionName,
    ...classifiedTrustRecords,
    handleRemoveRecord,
    handleClearAll,
    handleSetRevoked,
    handleSetPolicy,
    handleUpdateNickname,
    totalCount,
  };
}
