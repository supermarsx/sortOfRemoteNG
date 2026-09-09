import { useState, useEffect, useCallback, useRef } from "react";
import { GlobalSettings } from "../../types/settings/settings";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  getTrustStoreScope,
  ensureTrustStoreReady,
  getTrustStoreAvailability,
  retryTrustStoreHydration,
  refreshTrustStoreRecords,
  type TrustRecord,
  type TrustStoreScope,
  type ConnectionTrustGroup,
} from "../../utils/auth/trustStore";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
} from "../../utils/connection/databaseManager";
import { getInvoke } from "../../utils/tauri/invoke";
import { useLegacyTrustForceDelete } from "./useLegacyTrustForceDelete";
import type { ConnectionDatabase } from "../../types/connection/connection";
import type { DatabaseProtectionStatus } from "../../types/encryption/databaseProtection";

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
  pendingDatabaseIds?: string[];
  verifiedDatabaseIds?: string[];
  blockers?: string[];
  canDeleteLegacy?: boolean;
}

export interface TrustMigrationRow {
  database: ConnectionDatabase;
  state:
    | "ready"
    | "locked"
    | "verified"
    | "migrating"
    | "migrated"
    | "error"
    | "cancelled";
  added?: number;
  preserved?: number;
  message?: string;
}

function validateLegacyStatus(
  value: TrustLegacyStatus | null,
): TrustLegacyStatus {
  if (
    !value ||
    typeof value.legacyPresent !== "boolean" ||
    typeof value.rdpLegacyPresent !== "boolean" ||
    !Number.isSafeInteger(value.legacyRecords) ||
    value.legacyRecords < 0 ||
    !Number.isSafeInteger(value.rdpLegacyRecords) ||
    value.rdpLegacyRecords < 0
  )
    throw new Error(
      "Native legacy trust inspection returned no valid status. Retry before migration or cleanup.",
    );
  for (const ids of [value.pendingDatabaseIds, value.verifiedDatabaseIds])
    if (
      ids !== undefined &&
      (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id))
    )
      throw new Error("Native migration coverage is malformed.");
  if (
    value.blockers !== undefined &&
    (!Array.isArray(value.blockers) ||
      value.blockers.some((item) => typeof item !== "string"))
  )
    throw new Error("Native migration restrictions are malformed.");
  return value;
}

/** Which long-running Trust Center action is in flight, if any. */
export type TrustDatabaseAction =
  "delete-legacy" | "review-migration" | "migrate-legacy" | "force-delete";

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
  const [legacyError, setLegacyError] = useState("");
  const [showConfirmDeleteLegacy, setShowConfirmDeleteLegacy] = useState(false);
  const [actionBusy, setActionBusy] = useState<TrustDatabaseAction>();
  const [actionMessage, setActionMessage] = useState<TrustActionMessage | null>(
    null,
  );
  const [migrationRows, setMigrationRows] = useState<
    TrustMigrationRow[] | null
  >(null);
  const [migrationError, setMigrationError] = useState("");
  const [confirmMigration, setConfirmMigration] = useState(false);
  const [migrationUnlock, setMigrationUnlock] = useState<{
    database: ConnectionDatabase;
    status?: DatabaseProtectionStatus;
  } | null>(null);
  const migrationBusy = useRef(false);
  const migrationCancelled = useRef(false);
  const migrationGeneration = useRef(0);
  const migrationUnlockRequest = useRef(0);
  useEffect(
    () => () => {
      migrationGeneration.current += 1;
      migrationCancelled.current = true;
    },
    [],
  );

  const reviewMigration = async () => {
    if (migrationBusy.current) return;
    migrationBusy.current = true;
    setActionBusy("review-migration");
    setMigrationError("");
    setMigrationUnlock(null);
    setConfirmMigration(false);
    const generation = ++migrationGeneration.current;
    try {
      const invoke = await getInvoke();
      if (!invoke)
        throw new Error("Legacy trust migration requires the desktop app.");
      const [status, databases] = await Promise.all([
        invoke<TrustLegacyStatus>("trust_legacy_status"),
        DatabaseManager.getInstance().getAllDatabases(),
      ]);
      if (generation !== migrationGeneration.current) return;
      validateLegacyStatus(status);
      if (
        !Array.isArray(status.pendingDatabaseIds) ||
        !Array.isArray(status.verifiedDatabaseIds)
      )
        throw new Error(
          "This backend cannot verify legacy migration coverage. Update the desktop app before migrating or deleting legacy files.",
        );
      setLegacyStatus(status);
      setLegacyError("");
      const verified = new Set(status.verifiedDatabaseIds);
      const manager = DatabaseManager.getInstance();
      setMigrationRows(
        databases.map((database) => ({
          database,
          state: verified.has(database.id)
            ? "verified"
            : database.isEncrypted && !manager.isDatabaseUnlocked(database.id)
              ? "locked"
              : "ready",
        })),
      );
    } catch (error) {
      if (generation === migrationGeneration.current) {
        setLegacyStatus((previous) =>
          previous ? { ...previous, canDeleteLegacy: false } : null,
        );
        setMigrationError(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      migrationBusy.current = false;
      if (generation === migrationGeneration.current) setActionBusy(undefined);
    }
  };
  const startMigrationUnlock = async (database: ConnectionDatabase) => {
    const request = ++migrationUnlockRequest.current;
    const generation = migrationGeneration.current;
    setMigrationError("");
    try {
      const status =
        database.protectionFormat === "sorng-db"
          ? await DatabaseManager.getInstance().getDatabaseProtectionStatus(
              database.id,
            )
          : undefined;
      if (
        generation === migrationGeneration.current &&
        request === migrationUnlockRequest.current
      )
        setMigrationUnlock({ database, status });
    } catch (error) {
      if (generation === migrationGeneration.current)
        setMigrationError(
          error instanceof Error ? error.message : String(error),
        );
    }
  };
  const finishMigrationUnlock = async (password?: string) => {
    const pending = migrationUnlock;
    if (!pending) return;
    const generation = migrationGeneration.current;
    const request = migrationUnlockRequest.current;
    const manager = DatabaseManager.getInstance();
    if (!pending.status)
      await manager.unlockDatabase(pending.database.id, password ?? "");
    if (
      generation !== migrationGeneration.current ||
      request !== migrationUnlockRequest.current
    )
      return;
    if (!manager.isDatabaseUnlocked(pending.database.id))
      throw new Error(
        "Database access is no longer unlocked. Retry the selected unlock method.",
      );
    setMigrationRows(
      (rows) =>
        rows?.map((row) =>
          row.database.id === pending.database.id
            ? { ...row, state: "ready", message: undefined }
            : row,
        ) ?? null,
    );
    setMigrationUnlock(null);
  };
  const applyMigration = async () => {
    if (migrationBusy.current || !migrationRows) return;
    migrationBusy.current = true;
    migrationCancelled.current = false;
    setActionBusy("migrate-legacy");
    setConfirmMigration(false);
    setMigrationError("");
    const generation = migrationGeneration.current;
    const targets = migrationRows.filter((row) => row.state === "ready");
    const patch = (id: string, fields: Partial<TrustMigrationRow>) => {
      if (generation === migrationGeneration.current)
        setMigrationRows(
          (rows) =>
            rows?.map((row) =>
              row.database.id === id ? { ...row, ...fields } : row,
            ) ?? null,
        );
    };
    try {
      for (const row of targets) {
        if (
          migrationCancelled.current ||
          generation !== migrationGeneration.current
        ) {
          patch(row.database.id, {
            state: "cancelled",
            message: "Not started; legacy sources retained.",
          });
          continue;
        }
        patch(row.database.id, { state: "migrating" });
        try {
          const result =
            await DatabaseManager.getInstance().migrateLegacyTrustDatabase(
              row.database.id,
            );
          if (
            result.databaseId !== row.database.id ||
            !["migrated", "already-verified"].includes(result.status)
          )
            throw new Error(
              "Migration returned an unexpected database result. Refresh verification before cleanup.",
            );
          patch(row.database.id, {
            state:
              result.status === "already-verified" ? "verified" : "migrated",
            added: result.migratedRecords,
            preserved: result.preservedRecords,
            message: result.warnings.join(" "),
          });
        } catch (error) {
          patch(row.database.id, {
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      migrationBusy.current = false;
      if (generation === migrationGeneration.current) {
        setActionBusy(undefined);
        await refreshLegacyStatus();
        try {
          await refreshTrustStoreRecords();
          refreshRecords();
        } catch {
          setMigrationError(
            "Migration results are retained, but current trust records could not be refreshed. Retry the Trust Center refresh before connecting.",
          );
        }
      }
    }
  };

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
        throw new Error(
          "Legacy trust inspection and migration require the desktop app.",
        );
      }
      const status = await invoke<TrustLegacyStatus | null>(
        "trust_legacy_status",
      );
      setLegacyStatus(validateLegacyStatus(status));
      setLegacyError("");
    } catch (error) {
      setLegacyStatus((previous) =>
        previous ? { ...previous, canDeleteLegacy: false } : null,
      );
      setLegacyError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshLegacyStatus();
  }, [refreshLegacyStatus]);

  const forceDelete = useLegacyTrustForceDelete({
    acquire: () => {
      if (migrationBusy.current) return false;
      migrationBusy.current = true;
      setActionBusy("force-delete");
      setActionMessage(null);
      return true;
    },
    release: () => {
      migrationBusy.current = false;
      setActionBusy(undefined);
    },
    refresh: refreshLegacyStatus,
  });

  const handleDeleteLegacyStores = useCallback(async () => {
    if (migrationBusy.current || legacyStatus?.canDeleteLegacy !== true) return;
    migrationBusy.current = true;
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
      if (!Number.isSafeInteger(removed) || removed === null || removed < 0)
        throw new Error("Native cleanup returned no verified removal count.");
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
      migrationBusy.current = false;
      setActionBusy(undefined);
    }
  }, [refreshLegacyStatus, legacyStatus]);

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
    legacyError,
    legacyPresent,
    showConfirmDeleteLegacy,
    setShowConfirmDeleteLegacy,
    actionBusy,
    actionMessage,
    clearActionMessage: () => setActionMessage(null),
    refreshLegacyStatus,
    handleDeleteLegacyStores,
    forceDelete,
    migrationRows,
    migrationError,
    confirmMigration,
    setConfirmMigration,
    migrationUnlock,
    startMigrationUnlock,
    finishMigrationUnlock,
    closeMigrationUnlock: () => {
      migrationUnlockRequest.current += 1;
      setMigrationUnlock(null);
    },
    reviewMigration,
    applyMigration,
    cancelMigration: () => {
      migrationCancelled.current = true;
    },
  };
}
