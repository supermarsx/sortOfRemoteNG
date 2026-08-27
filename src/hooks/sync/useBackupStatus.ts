import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { Connection } from "../../types/connection/connection";
import { GlobalSettings } from "../../types/settings/settings";
import { buildBackupPayload } from "../../utils/services/backupPayload";
import {
  applyTrustDocument,
  readTrustDocument,
  type TrustExportDocument,
} from "../../utils/services/trustPortability";

export interface BackupStatus {
  isRunning: boolean;
  lastBackupTime?: number;
  lastBackupType?: string;
  lastBackupStatus?: "success" | "failed" | "partial";
  lastError?: string;
  nextScheduledTime?: number;
  backupCount: number;
  totalSizeBytes: number;
  lastTargetResults?: BackupTargetResult[];
}

export interface BackupTargetResult {
  targetId: string;
  status: "success" | "skipped_unchanged" | "disabled" | "failed";
  payloadHashWritten?: string;
  bytesWritten?: number;
  filePath?: string;
  errorMessage?: string;
}

export interface BackupListItem {
  id: string;
  filename: string;
  createdAt: number;
  backupType: string;
  sizeBytes: number;
  encrypted: boolean;
  compressed: boolean;
  /** Origin destination id when the backup came from a multi-target
   *  configured destination. `undefined` for legacy single-target
   *  sidecars that pre-date the multi-target work. */
  targetId?: string;
  /** Human-facing destination label, populated by
   *  `backup_list_all_targets` and the flattened wrapper so the UI
   *  can render per-source badges without joining against the live
   *  config. */
  targetLabel?: string;
  /** Canonical payload hash from the sidecar; lets the restore
   *  picker coalesce duplicate rows when the same backup landed at
   *  multiple destinations. */
  payloadHash?: string;
}

interface DestinationListing {
  targetId: string;
  targetLabel: string;
  backups: BackupListItem[];
}

interface BackupRestorePayload {
  connections?: Connection[];
  settings?: Partial<GlobalSettings>;
  timestamp?: number;
  /**
   * Trust Center document written by t62-aware backups (D6). Backups taken
   * before t62 have none — the restore must succeed either way.
   */
  trustRecords?: TrustExportDocument;
}

export interface BackupRunMetadata {
  id: string;
  checksum: string;
  targetId?: string;
  backupType?: string;
}

export type BackupCommandInvoker = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export const BACKUP_TARGET_RECOVERY_GUIDANCE =
  "This backup does not identify its destination, so it cannot be changed safely. Open Backup Settings, confirm the original destination, and refresh Available Backups. If it remains unidentified, create a replacement backup and remove the legacy files manually from that destination.";

const tauriBackupInvoker: BackupCommandInvoker = (command, args) =>
  invoke<unknown>(command, args);

const describeBackupError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const requireBackupTargetId = (targetId?: string): string => {
  const exactTargetId = targetId?.trim();
  if (!exactTargetId) {
    throw new Error(BACKUP_TARGET_RECOVERY_GUIDANCE);
  }
  return exactTargetId;
};

export async function restoreBackupCopy<T>(
  backupId: string,
  targetId: string | undefined,
  invokeCommand: BackupCommandInvoker = tauriBackupInvoker,
): Promise<T> {
  const exactTargetId = requireBackupTargetId(targetId);
  return (await invokeCommand("backup_restore", {
    backupId,
    targetId: exactTargetId,
  })) as T;
}

export async function restoreBackupTransaction<T>(
  backupId: string,
  targetId: string | undefined,
  invokeCommand: BackupCommandInvoker = tauriBackupInvoker,
): Promise<T> {
  const exactTargetId = requireBackupTargetId(targetId);
  return (await invokeCommand("backup_restore", {
    backupId,
    targetId: exactTargetId,
    apply: true,
  })) as T;
}

export async function deleteBackupCopy(
  backupId: string,
  targetId: string | undefined,
  invokeCommand: BackupCommandInvoker = tauriBackupInvoker,
): Promise<void> {
  const exactTargetId = requireBackupTargetId(targetId);
  await invokeCommand("backup_delete", {
    backupId,
    targetId: exactTargetId,
  });
}

export async function readBackupStatusWithRetry(
  invokeCommand: BackupCommandInvoker = tauriBackupInvoker,
  attempts = 2,
): Promise<BackupStatus> {
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return (await invokeCommand("backup_get_status")) as BackupStatus;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(describeBackupError(lastError));
}

export interface TestBackupTargetDiscovery {
  targetIds: string[];
  status?: BackupStatus;
  warning?: string;
}

export async function discoverTestBackupTargets(
  metadata: BackupRunMetadata,
  invokeCommand: BackupCommandInvoker = tauriBackupInvoker,
): Promise<TestBackupTargetDiscovery> {
  const targetIds = new Set<string>();
  const primaryTargetId = metadata.targetId?.trim();
  if (primaryTargetId) targetIds.add(primaryTargetId);

  let status: BackupStatus | undefined;
  let statusError: unknown;
  try {
    status = await readBackupStatusWithRetry(invokeCommand);
  } catch (error) {
    statusError = error;
  }

  const successfulResults = (status?.lastTargetResults ?? []).filter(
    (result) => result.status === "success",
  );
  const unidentifiedResults = successfulResults.filter(
    (result) => !result.targetId?.trim(),
  );
  successfulResults.forEach((result) => {
    const targetId = result.targetId?.trim();
    if (targetId) targetIds.add(targetId);
  });

  const statusIsComplete =
    successfulResults.length > 0 && unidentifiedResults.length === 0;
  const listingTargetIds = new Set<string>();
  let listingError: unknown;
  if (!statusIsComplete) {
    try {
      const rawListings = await invokeCommand("backup_list_all_targets");
      if (!Array.isArray(rawListings)) {
        throw new Error("backup_list_all_targets returned an invalid payload");
      }
      (rawListings as DestinationListing[]).forEach((listing) => {
        (listing.backups ?? []).forEach((backup) => {
          if (backup.id !== metadata.id) return;
          const targetId =
            backup.targetId?.trim() || listing.targetId?.trim() || undefined;
          if (targetId) {
            listingTargetIds.add(targetId);
            targetIds.add(targetId);
          }
        });
      });
    } catch (error) {
      listingError = error;
    }
  }

  const listingIsComplete =
    !statusIsComplete &&
    listingTargetIds.size > 0 &&
    (!status || listingTargetIds.size >= successfulResults.length);
  const discoveryIsComplete = statusIsComplete || listingIsComplete;
  if (discoveryIsComplete) {
    return { targetIds: [...targetIds], status };
  }

  const details: string[] = [];
  if (statusError) {
    details.push(`Status lookup failed: ${describeBackupError(statusError)}.`);
  } else if (successfulResults.length === 0) {
    details.push("The completed run reported no successful destinations.");
  } else if (unidentifiedResults.length > 0) {
    details.push(
      `${unidentifiedResults.length} successful destination result(s) had no target identity.`,
    );
  }
  if (listingError) {
    details.push(
      `Backup listing failed: ${describeBackupError(listingError)}.`,
    );
  } else if (listingTargetIds.size === 0) {
    details.push("The backup was not present in the destination listing.");
  }

  return {
    targetIds: [...targetIds],
    status,
    warning: `Could not enumerate every destination that received test backup "${metadata.id}". Known exact copies were cleaned where possible, but other copies may remain. Refresh Available Backups and delete any remaining copies of this ID from their listed destinations. ${details.join(" ")}`,
  };
}

export async function verifyAndCleanupTestBackupCopies(
  backupId: string,
  targetIds: string[],
  invokeCommand: BackupCommandInvoker = tauriBackupInvoker,
): Promise<number> {
  const exactTargetIds = [
    ...new Set(targetIds.map((targetId) => requireBackupTargetId(targetId))),
  ];
  if (exactTargetIds.length === 0) {
    throw new Error(
      `No exact destination could be identified for test backup "${backupId}". Refresh Available Backups and remove any listed copy manually.`,
    );
  }

  const verificationFailures: string[] = [];
  const cleanupFailures: string[] = [];
  for (const targetId of exactTargetIds) {
    try {
      const restored = await restoreBackupCopy<{ connections?: unknown[] }>(
        backupId,
        targetId,
        invokeCommand,
      );
      if (
        !Array.isArray(restored?.connections) ||
        restored.connections.length === 0
      ) {
        verificationFailures.push(`${targetId}: no connections were restored`);
      }
    } catch (error) {
      verificationFailures.push(`${targetId}: ${describeBackupError(error)}`);
    }

    try {
      await deleteBackupCopy(backupId, targetId, invokeCommand);
    } catch (error) {
      cleanupFailures.push(`${targetId}: ${describeBackupError(error)}`);
    }
  }

  if (verificationFailures.length > 0 || cleanupFailures.length > 0) {
    const messages: string[] = [];
    if (verificationFailures.length > 0) {
      messages.push(
        `Verification failed for ${verificationFailures.join("; ")}.`,
      );
    }
    if (cleanupFailures.length > 0) {
      messages.push(
        `Cleanup failed for ${cleanupFailures.join("; ")}. Refresh Available Backups and delete those exact destination copies manually.`,
      );
    }
    throw new Error(messages.join(" "));
  }

  return exactTargetIds.length;
}

// ─── Formatting helpers ─────────────────────────────────────────────

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp) return "Never";
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

export const formatNextTime = (timestamp?: number): string => {
  if (!timestamp) return "Not scheduled";
  const now = Date.now() / 1000;
  const diff = timestamp - now;
  if (diff < 0) return "Overdue";
  if (diff < 60) return "In < 1m";
  if (diff < 3600) return `In ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `In ${Math.floor(diff / 3600)}h`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

// ─── Hook ───────────────────────────────────────────────────────────

interface UseBackupStatusOptions {
  onBackupNow?: (data: unknown) => Promise<void>;
}

export function useBackupStatus({ onBackupNow }: UseBackupStatusOptions = {}) {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();
  const settingsManager = SettingsManager.getInstance();

  const [isOpen, setIsOpen] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupList, setBackupList] = useState<BackupListItem[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [restoreResult, setRestoreResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [restoringBackupKey, setRestoringBackupKey] = useState<string | null>(
    null,
  );
  const [showBackupList, setShowBackupList] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch backup status from Rust backend
  useEffect(() => {
    if (typeof isTauri !== "function" || !isTauri()) return;
    const fetchBackupStatus = async () => {
      try {
        const status = await invoke<BackupStatus>("backup_get_status");
        setBackupStatus(status);
      } catch (error) {
        console.error("Failed to fetch backup status:", error);
      }
    };
    fetchBackupStatus();
    const interval = setInterval(fetchBackupStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch backup list when showing list
  const fetchBackupList = useCallback(async () => {
    try {
      try {
        const listings = await invoke<DestinationListing[]>(
          "backup_list_all_targets",
        );
        if (!Array.isArray(listings)) {
          throw new Error(
            "backup_list_all_targets returned an invalid payload",
          );
        }
        const flattened = listings
          .flatMap((listing) =>
            (listing.backups ?? []).map((backup) => ({
              ...backup,
              targetId:
                backup.targetId?.trim() ||
                listing.targetId?.trim() ||
                undefined,
              targetLabel:
                backup.targetLabel?.trim() ||
                listing.targetLabel?.trim() ||
                undefined,
            })),
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        setBackupList(flattened);
      } catch {
        const list = await invoke<BackupListItem[]>("backup_list");
        setBackupList(Array.isArray(list) ? list : []);
      }
    } catch (error) {
      console.error("Failed to fetch backup list:", error);
    }
  }, []);

  useEffect(() => {
    if (showBackupList) {
      fetchBackupList();
    }
  }, [showBackupList, fetchBackupList]);

  const getStatusIcon = useCallback(() => {
    if (isBackingUp || backupStatus?.isRunning) return "loading" as const;
    if (!backupStatus || backupStatus.backupCount === 0)
      return "empty" as const;
    if (backupStatus.lastBackupStatus === "failed") return "failed" as const;
    if (backupStatus.lastBackupStatus === "partial") return "partial" as const;
    if (backupStatus.lastBackupStatus === "success") return "success" as const;
    return "default" as const;
  }, [isBackingUp, backupStatus]);

  const handleBackupNow = useCallback(async () => {
    setIsBackingUp(true);
    try {
      if (onBackupNow) {
        await onBackupNow({});
      } else {
        const settings = settingsManager.getSettings();
        const backupConfig = settings.backup;
        const connections = state?.connections ?? [];
        // t62 / D6 — carry the active database's Trust Center records.
        // Best-effort: null when the Trust Center is unavailable.
        const trustRecords = await readTrustDocument();
        const data = buildBackupPayload(
          {
            connections,
            settings,
            timestamp: Date.now(),
            trustRecords,
          },
          backupConfig,
        );
        await invoke("backup_update_config", { config: backupConfig });
        await invoke("backup_run_now", {
          backupType: "manual",
          data,
        });
      }
      const status = await invoke<BackupStatus>("backup_get_status");
      setBackupStatus(status);
      await fetchBackupList();
    } catch (error) {
      console.error("Backup failed:", error);
    } finally {
      setIsBackingUp(false);
    }
  }, [onBackupNow, fetchBackupList, settingsManager, state?.connections]);

  const handleTestBackup = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const testData = {
        connections: [{ id: "test", name: "Test Connection", protocol: "ssh" }],
        settings: { testMode: true },
        timestamp: Date.now(),
      };

      const metadata = await invoke<BackupRunMetadata>("backup_run_now", {
        backupType: "test",
        data: testData,
      });

      const discovery = await discoverTestBackupTargets(metadata);
      const verifiedTargetCount = await verifyAndCleanupTestBackupCopies(
        metadata.id,
        discovery.targetIds,
      );

      if (discovery.warning) {
        throw new Error(discovery.warning);
      }
      setTestResult({
        success: true,
        message: t(
          "backup.testSuccess",
          "Backup test passed! Data integrity verified across {{count}} destination(s).",
          { count: verifiedTargetCount },
        ),
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: t("backup.testError", "Backup test failed: {{error}}", {
          error: String(error),
        }),
      });
    } finally {
      try {
        const status = await invoke<BackupStatus>("backup_get_status");
        setBackupStatus(status);
      } catch (error) {
        console.error("Failed to refresh backup status after test:", error);
      }
      setIsTesting(false);
    }
  }, [t]);

  const handleRestoreBackup = useCallback(
    async (backupId: string, targetId?: string) => {
      let exactTargetId: string;
      try {
        exactTargetId = requireBackupTargetId(targetId);
      } catch (error) {
        setRestoreResult({
          success: false,
          message: t("backup.targetRequired", BACKUP_TARGET_RECOVERY_GUIDANCE),
        });
        return;
      }
      if (
        !confirm(
          t(
            "backup.confirmRestore",
            "Are you sure you want to restore this backup? Current data will be overwritten.",
          ),
        )
      ) {
        return;
      }
      setRestoringBackupKey(`${exactTargetId}:${backupId}`);
      setRestoreResult(null);
      try {
        const data = await restoreBackupTransaction<BackupRestorePayload>(
          backupId,
          exactTargetId,
        );
        const restoredConnections = Array.isArray(data?.connections)
          ? data.connections.map((conn: any) => ({
              ...conn,
              createdAt: conn.createdAt ? new Date(conn.createdAt) : new Date(),
              updatedAt: conn.updatedAt ? new Date(conn.updatedAt) : new Date(),
            }))
          : [];

        // t62 / D6 — re-import the backup's trust records into the active
        // database. Best-effort and tolerant of older backups: a payload
        // without `trustRecords` is a no-op, and a failing Trust Center
        // never turns a committed restore into a reported failure.
        await applyTrustDocument(data?.trustRecords, { mode: "merge" });

        const hadConnections = Array.isArray(data?.connections);
        const hadSettings = Boolean(
          data?.settings && Object.keys(data.settings).length > 0,
        );
        const hydrationFailures: string[] = [];
        if (hadSettings && data?.settings) {
          try {
            await settingsManager.saveSettings(data.settings);
          } catch (error) {
            hydrationFailures.push(
              t("backup.restoreSettingsFailed", "settings: {{error}}", {
                error: String(error),
              }),
            );
          }
        }

        // Do not advance the window's connection snapshot after a
        // settings hydration failure. The backend has already committed
        // the complete candidate atomically, so a restart can hydrate
        // both sections from one durable state instead of leaving a
        // deliberately partial window.
        if (hydrationFailures.length === 0 && hadConnections) {
          try {
            dispatch({ type: "SET_CONNECTIONS", payload: restoredConnections });
          } catch (error) {
            hydrationFailures.push(
              t("backup.restoreConnectionsFailed", "connections: {{error}}", {
                error: String(error),
              }),
            );
          }
        }

        if (hydrationFailures.length > 0) {
          setRestoreResult({
            success: false,
            message: t(
              "backup.restoreCommittedRefreshFailed",
              "The backup was committed safely, but this window could not refresh: {{error}}. Restart the app before making further changes.",
              { error: hydrationFailures.join("; ") },
            ),
          });
        } else {
          setRestoreResult({
            success: true,
            message: t(
              "backup.restoreSuccessTransactional",
              "Backup restored and committed atomically.",
            ),
          });
        }
      } catch (error) {
        console.error("Restore failed:", error);
        setRestoreResult({
          success: false,
          message: t(
            "backup.restoreFailed",
            "Failed to restore backup: {{error}}",
            {
              error: String(error),
            },
          ),
        });
      } finally {
        setRestoringBackupKey(null);
      }
    },
    [t, dispatch, settingsManager],
  );

  const handleDeleteBackup = useCallback(
    async (backupId: string, targetId?: string) => {
      let exactTargetId: string;
      try {
        exactTargetId = requireBackupTargetId(targetId);
      } catch {
        alert(t("backup.targetRequired", BACKUP_TARGET_RECOVERY_GUIDANCE));
        return;
      }
      if (
        !confirm(
          t(
            "backup.confirmDelete",
            "Are you sure you want to delete this backup?",
          ),
        )
      ) {
        return;
      }
      try {
        await deleteBackupCopy(backupId, exactTargetId);
        await fetchBackupList();
        const status = await invoke<BackupStatus>("backup_get_status");
        setBackupStatus(status);
      } catch (error) {
        console.error("Delete failed:", error);
        alert(
          t("backup.deleteFailed", "Failed to delete backup: {{error}}", {
            error: String(error),
          }),
        );
      }
    },
    [t, fetchBackupList],
  );

  return {
    t,
    isOpen,
    setIsOpen,
    backupStatus,
    backupList,
    isBackingUp,
    isTesting,
    testResult,
    restoreResult,
    restoringBackupKey,
    showBackupList,
    setShowBackupList,
    dropdownRef,
    getStatusIcon,
    handleBackupNow,
    handleTestBackup,
    handleRestoreBackup,
    handleDeleteBackup,
  };
}
