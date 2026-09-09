import { useState, useEffect, useCallback } from "react";
import { GlobalSettings } from "../../types/settings/settings";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  getTrustStoreScope,
  ensureTrustStoreReady,
  getTrustStoreAvailability,
  retryTrustStoreHydration,
  type TrustRecord,
  type TrustStoreScope,
  type ConnectionTrustGroup,
} from "../../utils/auth/trustStore";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
} from "../../utils/connection/databaseManager";
import { getInvoke } from "../../utils/tauri/invoke";

export interface ClassifiedTrustRecords {
  httpsRecords: TrustRecord[];
  certificateRecords: TrustRecord[];
  rdpRecords: TrustRecord[];
  sshRecords: TrustRecord[];
  legacyTlsRecords: TrustRecord[];
}

/**
 * Result of `trust_legacy_status` (t62 / D5). The pre-t62 sidecars
 * (`trust_store.json`, `rdp-cert-trust.json`) are read once to seed each
 * database and are never modified, so they linger until the user removes
 * them here.
 */
export interface TrustLegacyStatus {
  legacyPresent: boolean;
  legacyRecords: number;
  rdpLegacyPresent: boolean;
  rdpLegacyRecords: number;
  /** Every database in the index already has its own trust file. */
  allDatabasesOpened: boolean;
}

/** Which long-running Trust Center action is in flight, if any. */
export type TrustDatabaseAction = "delete-legacy";

/**
 * A translatable outcome banner. The hook deliberately reports a key plus
 * interpolation values rather than a rendered sentence so the section stays
 * translatable — the surrounding legacy strings in this section are t53's
 * sweep, not ours.
 */
export interface TrustActionMessage {
  tone: "success" | "error";
  key: string;
  values?: Record<string, string | number>;
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
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeError, setStoreError] = useState<string>();
  const [scope, setScope] = useState<TrustStoreScope>(() =>
    getTrustStoreScope(),
  );
  const [databaseName, setDatabaseName] = useState<string | null>(
    () => DatabaseManager.getInstance().getCurrentDatabase()?.name ?? null,
  );
  const [legacyStatus, setLegacyStatus] = useState<TrustLegacyStatus | null>(
    null,
  );
  const [showConfirmDeleteLegacy, setShowConfirmDeleteLegacy] = useState(false);
  const [actionBusy, setActionBusy] = useState<TrustDatabaseAction>();
  const [actionMessage, setActionMessage] = useState<TrustActionMessage | null>(
    null,
  );

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
      setScope(getTrustStoreScope());
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

  /*  Database scope (t62 / D7) ------------------------------------------- */

  // The scope itself is tracked by `trustStore.ts`, but the *name* lives in the
  // database manager: the banner has to say which collection the records belong
  // to, and an id is not something a user recognises.
  useEffect(() => {
    setDatabaseName(
      DatabaseManager.getInstance().getCurrentDatabase()?.name ?? null,
    );
    return onCurrentDatabaseChange((change) => {
      setDatabaseName(change.database?.name ?? null);
      setScope(getTrustStoreScope());
      setActionMessage(null);
    });
  }, []);

  const refreshLegacyStatus = useCallback(async () => {
    try {
      const invoke = await getInvoke();
      if (!invoke) {
        setLegacyStatus(null);
        return;
      }
      const status = await invoke<TrustLegacyStatus | null>(
        "trust_legacy_status",
      );
      setLegacyStatus(status ?? null);
    } catch {
      // Legacy status is informational: an older shell that does not know the
      // command simply has nothing to report.
      setLegacyStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshLegacyStatus();
  }, [refreshLegacyStatus]);

  const handleDeleteLegacyStores = useCallback(async () => {
    setActionBusy("delete-legacy");
    setActionMessage(null);
    try {
      const invoke = await getInvoke();
      if (!invoke) {
        setActionMessage({
          tone: "error",
          key: "trustCenter.status.unavailable",
        });
        return;
      }
      const removed = await invoke<number | null>("trust_delete_legacy_stores");
      setShowConfirmDeleteLegacy(false);
      await refreshLegacyStatus();
      setActionMessage({
        tone: "success",
        key: "trustCenter.status.legacyDeleted",
        values: { total: typeof removed === "number" ? removed : 0 },
      });
    } catch {
      setActionMessage({
        tone: "error",
        key: "trustCenter.status.legacyDeleteFailed",
      });
    } finally {
      setActionBusy(undefined);
    }
  }, [refreshLegacyStatus]);

  const totalCount =
    trustRecords.length +
    connectionGroups.reduce((sum, g) => sum + g.records.length, 0);

  // Only a *resolved* empty scope means "no database". While unresolved the
  // store keeps its pre-t62 behaviour (see t62-e6), so the banner must not
  // claim a lock-out that is not happening.
  const noActiveDatabase = scope.resolved && scope.databaseId === null;
  const legacyPresent = Boolean(
    legacyStatus &&
    (legacyStatus.legacyPresent || legacyStatus.rdpLegacyPresent),
  );

  return {
    settings,
    updateSettings,
    trustRecords,
    connectionGroups,
    storeLoading,
    storeError,
    retryLoad: () => loadRecords(true),
    refreshRecords,
    totalCount,
    scope,
    databaseName,
    noActiveDatabase,
    legacyStatus,
    legacyPresent,
    showConfirmDeleteLegacy,
    setShowConfirmDeleteLegacy,
    actionBusy,
    actionMessage,
    clearActionMessage: () => setActionMessage(null),
    refreshLegacyStatus,
    handleDeleteLegacyStores,
  };
}
