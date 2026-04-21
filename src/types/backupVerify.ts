// TypeScript mirror of `sorng-backup-verify/src/types.rs` plus the
// submodule result types referenced by the Tauri command surface
// (`dr_testing::DrDrillResult`, `replication::ReplicationOverview`,
// `retention::{PurgeResult, RetentionForecastEntry, ImmutabilityLock}`,
// `notifications::{DispatchResult, ChannelTestResult}`).
//
// These mirror the `#[derive(Serialize)]` shapes, which serde emits with
// default field names (snake_case → camelCase conversion is NOT applied
// by Tauri for struct fields, so snake_case is preserved here).

// ─── Enums ─────────────────────────────────────────────────────────────

export type TargetType =
  | 'FileSystem'
  | 'Database'
  | 'VirtualMachine'
  | 'Container'
  | 'Application'
  | 'CloudBucket'
  | 'NasShare'
  | 'MailServer'
  | 'LdapDirectory';

export type BackupMethod =
  | 'Full'
  | 'Incremental'
  | 'Differential'
  | 'Synthetic'
  | 'ContinuousReplication'
  | 'Snapshot'
  | 'Mirror';

export type CompressionAlgorithm =
  | 'None'
  | 'Gzip'
  | 'Zstd'
  | 'Lz4'
  | 'Bzip2'
  | 'Xz';

export type EncryptionAlgorithm = 'None' | 'AES256' | 'ChaCha20' | 'AES128GCM';

export type NotifyChannel = 'Email' | 'Webhook' | 'Syslog' | 'Snmp' | 'Tauri';

export type NotifyEvent =
  | 'JobStarted'
  | 'JobCompleted'
  | 'JobFailed'
  | 'VerificationFailed'
  | 'RetentionApplied'
  | 'DrTestResult'
  | 'ComplianceAlert'
  | 'ReplicationLag'
  | 'StorageThreshold';

export type BackupJobState =
  | 'Queued'
  | 'Running'
  | 'Verifying'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'PartiallyCompleted';

export type VerificationMethod =
  | 'ChecksumFull'
  | 'ChecksumSampled'
  | 'MetadataOnly'
  | 'RestoreTest'
  | 'ContentDiff'
  | 'MountAndScan';

export type VerificationStatus =
  | 'Passed'
  | 'Failed'
  | 'Warning'
  | 'Skipped'
  | 'InProgress';

export type ComplianceFramework =
  | 'SOX'
  | 'HIPAA'
  | 'GDPR'
  | 'PCI_DSS'
  | 'ISO27001'
  | 'NIST'
  | 'Custom';

export type FindingSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

export type ReplicationState =
  | 'InSync'
  | 'Syncing'
  | 'Lagging'
  | 'Error'
  | 'Paused'
  | 'Initial';

export type PolicyHealth = 'Healthy' | 'Warning' | 'Critical' | 'Unknown';

// ─── Config / Policy Structures ────────────────────────────────────────

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  key_path: string | null;
  known_hosts_check: boolean;
}

export interface BackupTarget {
  id: string;
  name: string;
  target_type: TargetType;
  host: string;
  paths: string[];
  credentials: string | null;
  ssh_config: SshConfig | null;
  tags: string[];
}

export interface CompressionConfig {
  algorithm: CompressionAlgorithm;
  level: number;
}

export interface EncryptionConfig {
  algorithm: EncryptionAlgorithm;
  key_id: string | null;
  passphrase_hint: string | null;
}

export interface BlackoutPeriod {
  start_time: string;
  end_time: string;
  days_of_week: number[];
  reason: string;
}

export interface BackupSchedule {
  cron_expression: string;
  timezone: string;
  start_window_minutes: number;
  blackout_periods: BlackoutPeriod[];
  retry_count: number;
  retry_delay_secs: number;
}

export interface RetentionPolicy {
  daily_count: number;
  weekly_count: number;
  monthly_count: number;
  yearly_count: number;
  min_retention_days: number;
  max_retention_days: number;
  gfs_enabled: boolean;
  immutable_period_days: number;
}

export interface BackupPolicy {
  id: string;
  name: string;
  targets: BackupTarget[];
  schedule: BackupSchedule;
  retention: RetentionPolicy;
  method: BackupMethod;
  compression: CompressionConfig;
  encryption: EncryptionConfig;
  pre_scripts: string[];
  post_scripts: string[];
  verify_after: boolean;
  notify_on: NotifyEvent[];
  max_parallel: number;
  bandwidth_limit: number | null;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Verification / Jobs / Catalog ────────────────────────────────────

export interface VerificationResult {
  verified_at: string;
  method: VerificationMethod;
  status: VerificationStatus;
  files_checked: number;
  files_ok: number;
  files_corrupted: number;
  files_missing: number;
  checksum_errors: number;
  metadata_errors: number;
  details: string[];
}

export interface BackupJob {
  id: string;
  policy_id: string;
  state: BackupJobState;
  started_at: string | null;
  completed_at: string | null;
  duration_secs: number | null;
  size_bytes: number;
  files_count: number;
  error_message: string | null;
  verification_result: VerificationResult | null;
  transfer_speed_bps: number;
  source_snapshot: string | null;
  target_location: string;
}

export interface CatalogEntry {
  id: string;
  job_id: string;
  policy_id: string;
  target_id: string;
  backup_type: BackupMethod;
  timestamp: string;
  size_bytes: number;
  file_count: number;
  location: string;
  checksum: string;
  retention_until: string;
  verified: boolean;
  verification_result: VerificationResult | null;
  tags: string[];
  metadata: Record<string, string>;
}

// ─── Compliance ────────────────────────────────────────────────────────

export interface ComplianceFinding {
  severity: FindingSeverity;
  category: string;
  description: string;
  policy_id: string | null;
  remediation: string;
}

export interface ComplianceReport {
  id: string;
  generated_at: string;
  framework: ComplianceFramework;
  period_start: string;
  period_end: string;
  policies_evaluated: number;
  policies_compliant: number;
  findings: ComplianceFinding[];
  score_percent: number;
  recommendations: string[];
}

// ─── Replication ──────────────────────────────────────────────────────

export interface ReplicationTarget {
  id: string;
  name: string;
  site_name: string;
  host: string;
  protocol: string;
  path: string;
  bandwidth_limit: number | null;
  sync_interval_secs: number;
  compression: CompressionConfig;
  encryption: EncryptionConfig;
}

export interface ReplicationStatus {
  target_id: string;
  state: ReplicationState;
  last_sync: string | null;
  lag_bytes: number;
  lag_secs: number;
  transfer_speed_bps: number;
  error_message: string | null;
}

// Shape mirrored from `replication::ReplicationOverview`; fields are
// intentionally optional so tests/callers can be forward-compatible.
export interface ReplicationOverview {
  target_id: string;
  target_name: string;
  state: ReplicationState;
  lag_secs: number;
  lag_bytes: number;
  last_sync: string | null;
}

// ─── Notifications ────────────────────────────────────────────────────

export interface ChannelConfig {
  policy_id: string;
  channels: NotifyChannel[];
  email_recipients: string[];
  webhook_urls: string[];
  syslog_target: string | null;
  snmp_target: string | null;
  events: NotifyEvent[];
}

export interface DispatchResult {
  channel: NotifyChannel;
  ok: boolean;
  message: string;
}

export interface ChannelTestResult {
  channel: NotifyChannel;
  ok: boolean;
  latency_ms: number;
  message: string;
}

// ─── DR Testing ───────────────────────────────────────────────────────

// Mirrors `dr_testing::DrDrillResult` — a superset of `DrTestResult`
// returned from the `run_dr_drill` / `get_drill_history` commands.
export interface DrDrillResult {
  test_id: string;
  policy_id: string;
  entry_id: string;
  executed_at: string;
  duration_secs: number;
  status: VerificationStatus;
  rto_actual_secs: number;
  rpo_actual_secs: number;
  steps_completed: number;
  steps_total: number;
  details: string[];
  artifacts: string[];
}

// ─── Retention ────────────────────────────────────────────────────────

export interface PurgeResult {
  entries_removed: number;
  bytes_reclaimed: number;
  policy_id: string;
  executed_at: string;
  details: string[];
}

export interface RetentionForecastEntry {
  entry_id: string;
  policy_id: string;
  retention_until: string;
  days_remaining: number;
  size_bytes: number;
}

export interface ImmutabilityLock {
  entry_id: string;
  locked_at: string;
  expires_at: string;
  reason: string;
}

// ─── Integrity ────────────────────────────────────────────────────────

export interface FileEntry {
  checksum: string;
  size: number;
  mtime: string;
}

export interface FileManifest {
  entries: Record<string, FileEntry>;
  generated_at: string;
  algorithm: string;
}

// ─── Overview ─────────────────────────────────────────────────────────

export interface BackupOverview {
  total_policies: number;
  active_policies: number;
  total_catalog_entries: number;
  total_size_bytes: number;
  last_backup_at: string | null;
  next_backup_at: string | null;
  failed_last_24h: number;
  verified_last_24h: number;
  storage_used_bytes: number;
  storage_available_bytes: number;
  compliance_score: number | null;
}
