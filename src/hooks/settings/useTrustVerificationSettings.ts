import { useState, useMemo, useEffect, useCallback } from "react";
import { GlobalSettings } from "../../types/settings/settings";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  getTrustStoreScope,
  refreshTrustStoreScope,
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
  type TrustStoreScope,
  type ConnectionTrustGroup,
} from "../../utils/auth/trustStore";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
} from "../../utils/connection/databaseManager";
import {
  applyTrustDocument,
  isTrustExportDocument,
  readTrustDocument,
  type TrustExportDocument,
} from "../../utils/services/trustPortability";
import { getInvoke } from "../../utils/tauri/invoke";
import { useConnections } from "../../contexts/useConnections";

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
export type TrustDatabaseAction =
  | "export"
  | "import"
  | "known-hosts"
  | "delete-legacy";

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

/**
 * Accept either a bare export document or any wrapper that carries one under
 * `trustRecords` — a full database export written by the Import/Export wizard
 * is a perfectly reasonable thing for a user to point this importer at.
 */
function extractTrustDocument(value: unknown): TrustExportDocument | null {
  if (isTrustExportDocument(value)) return value;
  if (value && typeof value === "object") {
    const nested = (value as { trustRecords?: unknown }).trustRecords;
    if (isTrustExportDocument(nested)) return nested;
  }
  return null;
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

  /**
   * Re-read everything the native side owns after a mutation that bypassed the
   * display cache (a JSON import, a known_hosts import). `retryTrustStoreHydration`
   * is the forced-refetch path; the scope read updates the record count.
   */
  const reloadFromNative = useCallback(async () => {
    await refreshTrustStoreScope();
    setScope(getTrustStoreScope());
    await loadRecords(true);
  }, [loadRecords]);

  const handleExportJson = useCallback(async () => {
    setActionBusy("export");
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
      const document = await readTrustDocument(scope.databaseId ?? undefined);
      if (!document) {
        setActionMessage({
          tone: "error",
          key: "trustCenter.status.exportFailed",
        });
        return;
      }
      if (document.records.length === 0) {
        setActionMessage({
          tone: "error",
          key: "trustCenter.status.exportEmpty",
        });
        return;
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `trust-center-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      // A cancelled dialog is not a failure — leave the banner clear.
      if (!path) return;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, `${JSON.stringify(document, null, 2)}\n`);
      setActionMessage({
        tone: "success",
        key: "trustCenter.status.exported",
        values: { path },
      });
    } catch {
      setActionMessage({
        tone: "error",
        key: "trustCenter.status.exportFailed",
      });
    } finally {
      setActionBusy(undefined);
    }
  }, [scope.databaseId]);

  const handleImportJson = useCallback(async () => {
    setActionBusy("import");
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
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const path = typeof selected === "string" ? selected : null;
      if (!path) return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const raw = await readTextFile(path);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        setActionMessage({
          tone: "error",
          key: "trustCenter.status.importInvalid",
        });
        return;
      }
      const document = extractTrustDocument(parsed);
      if (!document) {
        setActionMessage({
          tone: "error",
          key: "trustCenter.status.importInvalid",
        });
        return;
      }

      const outcome = await applyTrustDocument(document, {
        databaseId: scope.databaseId ?? undefined,
        mode: "merge",
      });
      if (!outcome) {
        setActionMessage({
          tone: "error",
          key: "trustCenter.status.importFailed",
        });
        return;
      }
      await reloadFromNative();
      setActionMessage({
        tone: "success",
        key: "trustCenter.status.imported",
        values: { imported: outcome.imported, skipped: outcome.skipped },
      });
    } catch {
      setActionMessage({
        tone: "error",
        key: "trustCenter.status.importFailed",
      });
    } finally {
      setActionBusy(undefined);
    }
  }, [reloadFromNative, scope.databaseId]);

  const handleImportKnownHosts = useCallback(async () => {
    setActionBusy("known-hosts");
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
      const result = await invoke<{ imported?: number } | number | null>(
        "trust_import_known_hosts",
        {},
      );
      const imported =
        typeof result === "number" ? result : (result?.imported ?? 0);
      await reloadFromNative();
      setActionMessage({
        tone: "success",
        key: "trustCenter.status.knownHostsImported",
        values: { total: imported },
      });
    } catch {
      setActionMessage({
        tone: "error",
        key: "trustCenter.status.knownHostsFailed",
      });
    } finally {
      setActionBusy(undefined);
    }
  }, [reloadFromNative]);

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
    handleExportJson,
    handleImportJson,
    handleImportKnownHosts,
    handleDeleteLegacyStores,
  };
}
