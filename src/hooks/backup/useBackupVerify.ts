/**
 * React hook wrapping the 35 `backup_verify_*` Tauri commands exposed by
 * the `sorng-backup-verify` backend crate (see t3-e45 wiring).
 *
 * The backend is ops-gated; these command invocations only resolve in
 * builds that include the `ops` feature (default). Non-ops builds will
 * reject the commands at the IPC boundary.
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  BackupOverview,
  BackupPolicy,
  CatalogEntry,
  VerificationMethod,
  VerificationResult,
  BackupJob,
  FileManifest,
  DrDrillResult,
  ComplianceFramework,
  ComplianceReport,
  ReplicationTarget,
  ReplicationStatus,
  ReplicationOverview,
  PurgeResult,
  RetentionForecastEntry,
  ImmutabilityLock,
  ChannelConfig,
  DispatchResult,
  ChannelTestResult,
  NotifyChannel,
} from "../../types/backupVerify";

// ────────────────────────────────────────────────────────────────────
//  Command bindings — one function per `#[tauri::command]`
// ────────────────────────────────────────────────────────────────────

// Tauri converts command arguments snake_case → camelCase on the wire.
// Each wrapper below takes camelCase params and forwards them verbatim.

export const backupVerifyApi = {
  // ── Overview ────────────────────────────────────────────────────
  getOverview: (): Promise<BackupOverview> =>
    invoke("backup_verify_get_overview"),

  // ── Policies ────────────────────────────────────────────────────
  listPolicies: (): Promise<BackupPolicy[]> =>
    invoke("backup_verify_list_policies"),

  getPolicy: (policyId: string): Promise<BackupPolicy> =>
    invoke("backup_verify_get_policy", { policyId }),

  createPolicy: (policy: BackupPolicy): Promise<string> =>
    invoke("backup_verify_create_policy", { policy }),

  updatePolicy: (policy: BackupPolicy): Promise<void> =>
    invoke("backup_verify_update_policy", { policy }),

  deletePolicy: (policyId: string): Promise<BackupPolicy> =>
    invoke("backup_verify_delete_policy", { policyId }),

  // ── Catalog ─────────────────────────────────────────────────────
  listCatalog: (args: {
    policyId?: string;
    from?: string;
    to?: string;
  } = {}): Promise<CatalogEntry[]> =>
    invoke("backup_verify_list_catalog", {
      policyId: args.policyId ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
    }),

  getCatalogEntry: (entryId: string): Promise<CatalogEntry> =>
    invoke("backup_verify_get_catalog_entry", { entryId }),

  addCatalogEntry: (entry: CatalogEntry): Promise<string> =>
    invoke("backup_verify_add_catalog_entry", { entry }),

  deleteCatalogEntry: (entryId: string): Promise<CatalogEntry> =>
    invoke("backup_verify_delete_catalog_entry", { entryId }),

  // ── Verification ────────────────────────────────────────────────
  verifyBackup: (
    entryId: string,
    method: VerificationMethod,
  ): Promise<VerificationResult> =>
    invoke("backup_verify_verify_backup", { entryId, method }),

  // ── Scheduler / Jobs ────────────────────────────────────────────
  triggerBackup: (policyId: string): Promise<string> =>
    invoke("backup_verify_trigger_backup", { policyId }),

  cancelJob: (jobId: string): Promise<void> =>
    invoke("backup_verify_cancel_job", { jobId }),

  listRunningJobs: (): Promise<BackupJob[]> =>
    invoke("backup_verify_list_running_jobs"),

  listQueuedJobs: (): Promise<BackupJob[]> =>
    invoke("backup_verify_list_queued_jobs"),

  getJobHistory: (policyId: string, limit?: number): Promise<BackupJob[]> =>
    invoke("backup_verify_get_job_history", {
      policyId,
      limit: limit ?? null,
    }),

  // ── Integrity ───────────────────────────────────────────────────
  computeSha256: (path: string): Promise<string> =>
    invoke("backup_verify_compute_sha256", { path }),

  generateManifest: (path: string): Promise<FileManifest> =>
    invoke("backup_verify_generate_manifest", { path }),

  // ── DR Testing ──────────────────────────────────────────────────
  runDrDrill: (policyId: string, entryId: string): Promise<DrDrillResult> =>
    invoke("backup_verify_run_dr_drill", { policyId, entryId }),

  getDrillHistory: (): Promise<DrDrillResult[]> =>
    invoke("backup_verify_get_drill_history"),

  // ── Compliance ──────────────────────────────────────────────────
  generateComplianceReport: (
    framework: ComplianceFramework,
    periodStart: string,
    periodEnd: string,
  ): Promise<ComplianceReport> =>
    invoke("backup_verify_generate_compliance_report", {
      framework,
      periodStart,
      periodEnd,
    }),

  getComplianceHistory: (): Promise<ComplianceReport[]> =>
    invoke("backup_verify_get_compliance_history"),

  // ── Replication ─────────────────────────────────────────────────
  listReplicas: (): Promise<ReplicationTarget[]> =>
    invoke("backup_verify_list_replicas"),

  addReplica: (target: ReplicationTarget): Promise<string> =>
    invoke("backup_verify_add_replica", { target }),

  removeReplica: (targetId: string): Promise<ReplicationTarget> =>
    invoke("backup_verify_remove_replica", { targetId }),

  startReplication: (entryId: string, targetId: string): Promise<string> =>
    invoke("backup_verify_start_replication", { entryId, targetId }),

  getReplicationStatus: (targetId: string): Promise<ReplicationStatus> =>
    invoke("backup_verify_get_replication_status", { targetId }),

  getReplicationOverview: (): Promise<ReplicationOverview[]> =>
    invoke("backup_verify_get_replication_overview"),

  // ── Retention ───────────────────────────────────────────────────
  enforceRetention: (policyId: string): Promise<PurgeResult> =>
    invoke("backup_verify_enforce_retention", { policyId }),

  getRetentionForecast: (): Promise<RetentionForecastEntry[]> =>
    invoke("backup_verify_get_retention_forecast"),

  setImmutabilityLock: (
    entryId: string,
    durationDays: number,
    reason: string,
  ): Promise<ImmutabilityLock> =>
    invoke("backup_verify_set_immutability_lock", {
      entryId,
      durationDays,
      reason,
    }),

  checkImmutability: (): Promise<ImmutabilityLock[]> =>
    invoke("backup_verify_check_immutability"),

  // ── Notifications ───────────────────────────────────────────────
  configureNotifications: (config: ChannelConfig): Promise<void> =>
    invoke("backup_verify_configure_notifications", { config }),

  sendTestNotification: (policyId: string): Promise<DispatchResult[]> =>
    invoke("backup_verify_send_test_notification", { policyId }),

  testChannel: (
    channel: NotifyChannel,
    policyId: string,
  ): Promise<ChannelTestResult> =>
    invoke("backup_verify_test_channel", { channel, policyId }),
};

export type BackupVerifyApi = typeof backupVerifyApi;

/** React hook variant — returns the stable API object memoised for the
 *  component's lifetime. */
export function useBackupVerify(): BackupVerifyApi {
  return useMemo(() => backupVerifyApi, []);
}

export default useBackupVerify;
