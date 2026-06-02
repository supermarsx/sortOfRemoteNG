//! # Backup Service (Rust Backend)
//!
//! This module provides all backup functionality in the Rust backend.
//! The frontend simply requests backups via Tauri commands - all logic runs here.
//!
//! ## Features
//!
//! - Full and differential backups
//! - Scheduled backup support with background thread
//! - Automatic cleanup of old backups (keep last X)
//! - Compression (gzip)
//! - Encryption (AES-256-GCM)
//! - Backup verification and integrity checking

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
#[cfg(test)]
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// Backup frequency options
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackupFrequency {
    Manual,
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

/// Backup format options
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BackupFormat {
    Json,
    Xml,
    EncryptedJson,
}

/// Day of week for weekly backups
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DayOfWeek {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

/// A single user-defined destination the scheduled backup writes to.
///
/// Replaces the implicit single-destination model (just
/// `destination_path` on `BackupConfig`) so one tick can fan out to
/// several user-configured destinations — multiple local folders,
/// multiple clouds, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTarget {
    /// Stable identifier; referenced by `TargetResult.target_id` so
    /// the UI can correlate per-tick outcomes back to a destination
    /// even when the user renames or reorders them.
    pub id: String,
    /// Human-facing label for the settings list editor and the
    /// restore picker.
    pub label: String,
    /// Storage class for this destination (e.g. `custom`, `appData`,
    /// `documents`, `googleDrive`, `oneDrive`, `nextcloud`, `dropbox`).
    /// Free-form string so additional providers can land without a
    /// coordinated type bump across crates.
    pub preset: String,
    /// Local filesystem path for filesystem presets, or cloud-side
    /// subfolder for cloud presets. Optional because some presets
    /// resolve to a default location (e.g. `appData`).
    #[serde(default)]
    pub custom_path: Option<String>,
    /// Soft-disable a destination without removing it from the
    /// settings list; the scheduler will skip it on the next tick.
    pub enabled: bool,
    /// Optional retention override; when `None`, the per-job /
    /// per-config global retention applies.
    #[serde(default)]
    pub retention_override: Option<DestinationRetentionPolicy>,
}

/// Retention policy applied per destination. Kept as a subset of the
/// full retention surface in `sorng-remote-backup::types::RetentionPolicy`
/// — the in-app backup pipeline only needs the count-based slice.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DestinationRetentionPolicy {
    /// Override `max_backups_to_keep` for this destination only.
    /// `0` is treated as "unlimited" to match the global setting.
    pub max_backups_to_keep: Option<u32>,
}

/// Outcome of writing the current tick's payload to one destination.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetResult {
    pub target_id: String,
    pub status: TargetStatus,
    /// Canonical payload hash that landed at this destination on this
    /// tick. The next tick uses this to recover destinations that
    /// fell behind because of a previous failure: if this destination's
    /// recorded hash differs from the current payload, we write even
    /// when other destinations would be skipped.
    #[serde(default)]
    pub payload_hash_written: Option<String>,
    /// Bytes that landed on disk (post-encrypt, post-compress). `None`
    /// when no write happened (skipped / disabled / failed-before-write).
    pub bytes_written: Option<u64>,
    /// Resolved absolute file path for the backup at this destination,
    /// useful for the restore picker.
    #[serde(default)]
    pub file_path: Option<String>,
    /// Populated when `status == Failed`.
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TargetStatus {
    /// Payload was written to this destination on this tick.
    Success,
    /// Delta-skip decided this destination already had the current
    /// payload and the force-N threshold hadn't fired.
    SkippedUnchanged,
    /// `enabled = false` in the config; nothing attempted.
    Disabled,
    /// Write attempted and failed (path / credentials / network).
    Failed,
}

/// Backup configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    pub enabled: bool,
    pub frequency: BackupFrequency,
    pub scheduled_time: String,
    pub weekly_day: DayOfWeek,
    pub monthly_day: u8,
    pub destination_path: String,
    pub differential_enabled: bool,
    pub full_backup_interval: u32,
    pub max_backups_to_keep: u32,
    pub format: BackupFormat,
    pub include_passwords: bool,
    pub encrypt_backups: bool,
    pub encryption_algorithm: String,
    pub encryption_password: Option<String>,
    pub include_settings: bool,
    pub include_ssh_keys: bool,
    pub backup_on_close: bool,
    pub notify_on_backup: bool,
    pub compress_backups: bool,
    /// Destinations the payload fans out to on each scheduled tick.
    /// Empty when the config still uses the legacy single-destination
    /// model (`destination_path` only) — `effective_destinations()`
    /// synthesises a single-element list in that case so the runtime
    /// always has at least one target.
    #[serde(default)]
    pub destinations: Vec<BackupTarget>,
    /// Master toggle for delta-verified backups. When on, ticks whose
    /// canonical payload hash matches the previous successful run's
    /// hash are skipped at every destination that's already up to
    /// date, unless the force-N safety valve kicks in.
    #[serde(default)]
    pub delta_skip_enabled: bool,
    /// After this many consecutive skipped ticks the next tick emits
    /// regardless, so retention rotation stays healthy. `0` means
    /// "never force" (skip indefinitely when payload is unchanged).
    #[serde(default = "default_force_emit_every")]
    pub force_emit_every_n_skipped_ticks: u32,
}

fn default_force_emit_every() -> u32 {
    // 7 ticks ~= one guaranteed backup per week on a daily schedule.
    // Matches the planning doc's default.
    7
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency: BackupFrequency::Daily,
            scheduled_time: "03:00".to_string(),
            weekly_day: DayOfWeek::Sunday,
            monthly_day: 1,
            destination_path: String::new(),
            differential_enabled: true,
            full_backup_interval: 7,
            max_backups_to_keep: 30,
            format: BackupFormat::Json,
            include_passwords: false,
            encrypt_backups: true,
            encryption_algorithm: "AES-256-GCM".to_string(),
            encryption_password: None,
            include_settings: true,
            include_ssh_keys: false,
            backup_on_close: false,
            notify_on_backup: true,
            compress_backups: true,
            destinations: Vec::new(),
            delta_skip_enabled: false,
            force_emit_every_n_skipped_ticks: default_force_emit_every(),
        }
    }
}

impl BackupConfig {
    /// Synthesise the effective destination list. When the user has
    /// configured one or more entries in `destinations` we honour them
    /// as-is. Otherwise, wrap the legacy `destination_path` into a
    /// single-entry list so the runtime always has at least one target
    /// to iterate over without scattering the migration check across
    /// every caller.
    pub fn effective_destinations(&self) -> Vec<BackupTarget> {
        if !self.destinations.is_empty() {
            return self.destinations.clone();
        }
        if self.destination_path.is_empty() {
            return Vec::new();
        }
        vec![BackupTarget {
            id: "legacy-default".to_string(),
            label: "Default".to_string(),
            preset: "custom".to_string(),
            custom_path: Some(self.destination_path.clone()),
            enabled: true,
            retention_override: None,
        }]
    }
}

/// Backup metadata stored in each backup file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMetadata {
    pub id: String,
    pub created_at: u64,
    pub backup_type: String, // "full" or "differential"
    pub version: String,
    pub checksum: String,
    pub encrypted: bool,
    pub compressed: bool,
    pub size_bytes: u64,
    pub connections_count: u32,
    pub parent_backup_id: Option<String>, // For differential backups
    /// Canonical SHA-256 hash of the *plaintext* payload (sorted keys,
    /// pre-encryption). Drives delta-skip on the next tick — the
    /// checksum field above is over the rendered JSON text and varies
    /// with formatting, so it can't be used for that comparison.
    /// Legacy records without this field deserialise as `None`.
    #[serde(default)]
    pub payload_hash: Option<String>,
    /// `target_id` of the destination this file belongs to. Used by
    /// the restore picker to render per-source badges and by the
    /// per-destination delta logic. `None` for legacy single-target
    /// records.
    #[serde(default)]
    pub target_id: Option<String>,
}

/// Backup status for frontend updates
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub is_running: bool,
    pub last_backup_time: Option<u64>,
    pub last_backup_type: Option<String>,
    pub last_backup_status: Option<String>, // "success" | "failed" | "partial" | "skipped"
    pub last_error: Option<String>,
    pub next_scheduled_time: Option<u64>,
    pub backup_count: u32,
    pub total_size_bytes: u64,
    /// Canonical payload hash of the most recent successful tick, used
    /// by the delta-skip comparator on the next tick. `None` until the
    /// first successful run since the feature landed.
    #[serde(default)]
    pub last_payload_hash: Option<String>,
    /// How many ticks in a row have been delta-skipped. Reset to 0 by
    /// any tick that wrote to at least one destination, including
    /// ticks that were forced via `force_emit_every_n_skipped_ticks`.
    #[serde(default)]
    pub consecutive_skipped_count: u32,
    /// Per-destination outcomes of the most recent tick (success /
    /// skipped / disabled / failed). The UI uses this for the
    /// "last run" panel in the backup settings dialog.
    #[serde(default)]
    pub last_target_results: Vec<TargetResult>,
}

/// Per-file failure record carried by [`BackupMigrationReport`]. The
/// UI renders one row per failure so the user can address each one
/// (e.g. wrong password on a specific destination, missing source).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMigrationFailure {
    pub file_path: String,
    pub reason: String,
}

/// Aggregate report returned by
/// [`BackupService::migrate_to_master_dek`]. Counts are independent
/// — a file can only fall into one of `migrated`, `already_v2`, or
/// `failed`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMigrationReport {
    /// Total candidate files scanned (post-filter, pre-classify).
    pub total: u32,
    /// Files freshly re-encrypted under the master DEK.
    pub migrated: u32,
    /// Files that were already in the v2 envelope at scan time —
    /// idempotent no-op.
    pub already_v2: u32,
    /// Sum of plaintext sizes read (decrypted from SORNG1 / read from
    /// plaintext). Useful for the UI to show "migrated X MiB".
    pub bytes_in: u64,
    /// Sum of v2-envelope sizes written. The delta from `bytes_in`
    /// is the envelope overhead — should be ~64 bytes per file.
    pub bytes_out: u64,
    /// Per-file failures with the path and reason. Empty on a clean
    /// run; non-empty does not stop the loop from processing other
    /// files at other destinations.
    pub failed: Vec<BackupMigrationFailure>,
}

/// List of available backups
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupListItem {
    pub id: String,
    pub filename: String,
    pub created_at: u64,
    pub backup_type: String,
    pub size_bytes: u64,
    pub encrypted: bool,
    pub compressed: bool,
    /// `target_id` from the matching `BackupTarget` so the restore
    /// picker can show per-source badges and pick a specific
    /// destination when the same backup exists at several. `None`
    /// for legacy single-target sidecars that pre-date the
    /// multi-target work.
    #[serde(default)]
    pub target_id: Option<String>,
    /// Human-facing label of the destination the file lives at. Lets
    /// the restore picker render meaningful strings without joining
    /// against the live config on the TS side. `None` when the
    /// listing is computed from a legacy single-target sidecar.
    #[serde(default)]
    pub target_label: Option<String>,
    /// Canonical payload hash carried by the sidecar. The restore
    /// picker uses this to coalesce duplicate rows when the same
    /// backup landed at multiple destinations.
    #[serde(default)]
    pub payload_hash: Option<String>,
}

/// Per-destination view returned by `list_backups_all_targets`. The
/// restore picker walks this to render a merged timeline grouped by
/// destination on one side and by backup on the other.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationListing {
    /// `id` of the originating `BackupTarget`, or `"legacy-default"`
    /// when the listing comes from the legacy `destination_path`.
    pub target_id: String,
    /// Human-facing label of the destination.
    pub target_label: String,
    /// Resolved filesystem path the listing was read from.
    pub resolved_path: String,
    /// Whether this destination was enabled in config at scan time.
    pub enabled: bool,
    /// Backups discovered at this destination, newest first.
    pub backups: Vec<BackupListItem>,
    /// Populated when the directory couldn't be scanned (missing
    /// path, permission error). Other destinations still scan
    /// independently — one failure doesn't block the rest.
    #[serde(default)]
    pub error_message: Option<String>,
}

/// Backup service state
pub struct BackupService {
    config: BackupConfig,
    status: BackupStatus,
    #[allow(dead_code)]
    data_path: String,
    /// Phase 3a encryption-at-rest handle. When `Some` and unlocked,
    /// `perform_backup` writes through the v2 envelope codec
    /// (`sorng-v1::backups` sub-key) instead of the legacy
    /// PBKDF2/600k SORNG1 path. Reads always magic-byte sniff so
    /// existing SORNG1 backups remain restorable for one release.
    encryption_state:
        Option<Arc<sorng_encryption::EncryptionState>>,
}

/// Type alias for thread-safe backup state
pub type BackupServiceState = Arc<Mutex<BackupService>>;

impl BackupService {
    /// Create a new backup service
    pub fn new(data_path: String) -> BackupServiceState {
        Arc::new(Mutex::new(BackupService {
            config: BackupConfig::default(),
            status: BackupStatus {
                is_running: false,
                last_backup_time: None,
                last_backup_type: None,
                last_backup_status: None,
                last_error: None,
                next_scheduled_time: None,
                backup_count: 0,
                total_size_bytes: 0,
                last_payload_hash: None,
                consecutive_skipped_count: 0,
                last_target_results: Vec::new(),
            },
            data_path,
            encryption_state: None,
        }))
    }

    /// Install the global `EncryptionState` so subsequent backups use
    /// the v2 envelope codec while unlocked. Calling this after
    /// construction is intentional — the encryption state is
    /// `app.manage`-d before this service is created (see
    /// `state_registry::security_data`), and we don't want to make the
    /// backup module aware of Tauri.
    pub fn set_encryption_state(
        &mut self,
        state: Arc<sorng_encryption::EncryptionState>,
    ) {
        self.encryption_state = Some(state);
    }

    /// Update backup configuration
    pub fn update_config(&mut self, config: BackupConfig) {
        self.config = config;
        self.calculate_next_scheduled_time();
    }

    /// Get current backup configuration
    pub fn get_config(&self) -> BackupConfig {
        self.config.clone()
    }

    /// Get current backup status
    pub fn get_status(&self) -> BackupStatus {
        self.status.clone()
    }

    /// Calculate next scheduled backup time based on config
    fn calculate_next_scheduled_time(&mut self) {
        if !self.config.enabled || self.config.frequency == BackupFrequency::Manual {
            self.status.next_scheduled_time = None;
            return;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Parse scheduled time (HH:MM)
        let parts: Vec<&str> = self.config.scheduled_time.split(':').collect();
        let hour: u64 = parts.first().and_then(|h| h.parse().ok()).unwrap_or(3);
        let minute: u64 = parts.get(1).and_then(|m| m.parse().ok()).unwrap_or(0);
        let time_of_day_secs = hour * 3600 + minute * 60;

        // Calculate next time based on frequency
        let next_time = match self.config.frequency {
            BackupFrequency::Manual => None,
            BackupFrequency::Hourly => {
                let current_hour_start = now - (now % 3600);
                Some(current_hour_start + 3600)
            }
            BackupFrequency::Daily => {
                let today_start = now - (now % 86400);
                let scheduled_today = today_start + time_of_day_secs;
                if scheduled_today > now {
                    Some(scheduled_today)
                } else {
                    Some(scheduled_today + 86400)
                }
            }
            BackupFrequency::Weekly => {
                // Simplified: just add 7 days from last backup or now
                let base = self.status.last_backup_time.unwrap_or(now);
                Some(base + 604800) // 7 days in seconds
            }
            BackupFrequency::Monthly => {
                // Simplified: add ~30 days from last backup or now
                let base = self.status.last_backup_time.unwrap_or(now);
                Some(base + 2592000) // 30 days in seconds
            }
        };

        self.status.next_scheduled_time = next_time;
    }

    /// Run a backup with the current configuration. Fans out to every
    /// enabled destination configured in `BackupConfig.destinations`
    /// (or the legacy single-destination wrapper when the user hasn't
    /// migrated). When `delta_skip_enabled` is on, ticks whose
    /// canonical payload hash matches the previous successful run's
    /// hash are skipped at every destination that's already up to
    /// date — unless `force_emit_every_n_skipped_ticks` has been hit,
    /// in which case the next tick emits regardless to keep retention
    /// rotation healthy.
    pub async fn run_backup(
        &mut self,
        backup_type: &str,
        data: &serde_json::Value,
    ) -> Result<BackupMetadata, String> {
        if self.status.is_running {
            return Err("Backup already in progress".to_string());
        }

        self.status.is_running = true;
        self.status.last_error = None;

        let result = self.perform_backup(backup_type, data).await;

        self.status.is_running = false;

        match result {
            Ok(summary) => {
                // Always record per-destination outcomes — even a
                // fully-skipped tick yields one row per enabled target
                // so the UI can render the "last run" table.
                self.status.last_target_results = summary.target_results.clone();

                if summary.skipped {
                    // No destination wrote on this tick. Bump the
                    // consecutive-skipped counter so the force-N
                    // safety valve can eventually fire, but leave
                    // `last_backup_time` alone — that's the timestamp
                    // of the most recent *emitted* backup, not the
                    // most recent tick.
                    self.status.last_backup_status = Some("skipped".to_string());
                    self.status.consecutive_skipped_count =
                        self.status.consecutive_skipped_count.saturating_add(1);
                    self.calculate_next_scheduled_time();
                    // Return a synthetic metadata so the Tauri command
                    // contract stays a `Result<BackupMetadata, String>`
                    // — the caller can detect skips via
                    // `backup_type == "skipped"` or status updates.
                    return Ok(skipped_run_metadata(
                        backup_type,
                        summary.payload_hash,
                    ));
                }

                // At least one destination wrote — counter resets and
                // the last-hash bookmark advances.
                self.status.consecutive_skipped_count = 0;
                self.status.last_payload_hash = Some(summary.payload_hash.clone());

                let any_failed = summary
                    .target_results
                    .iter()
                    .any(|r| r.status == TargetStatus::Failed);
                let status_label = if any_failed { "partial" } else { "success" };
                self.status.last_backup_status = Some(status_label.to_string());

                let primary = summary
                    .primary_metadata
                    .ok_or_else(|| "internal: write succeeded but no metadata".to_string())?;
                self.status.last_backup_time = Some(primary.created_at);
                self.status.last_backup_type = Some(primary.backup_type.clone());
                self.calculate_next_scheduled_time();

                // Cleanup old backups per destination (each target may
                // have its own retention override).
                self.cleanup_old_backups_all_targets().await?;
                self.update_backup_stats().await?;

                Ok(primary)
            }
            Err(e) => {
                self.status.last_backup_status = Some("failed".to_string());
                self.status.last_error = Some(e.clone());
                Err(e)
            }
        }
    }

    /// Encode + encrypt the payload once and fan out to every enabled
    /// destination, honouring per-target delta-skip decisions.
    ///
    /// Returns a summary (per-target results, canonical payload hash,
    /// representative metadata) that `run_backup` uses to update the
    /// service status.
    async fn perform_backup(
        &self,
        backup_type: &str,
        data: &serde_json::Value,
    ) -> Result<BackupRunSummary, String> {
        let targets = self.config.effective_destinations();
        if targets.is_empty() {
            return Err(
                "No backup destinations configured (set destinationPath or destinations[])"
                    .to_string(),
            );
        }

        // ── Canonical payload hash (drives the delta-skip comparator
        //    next tick *and* the per-target recovery check this tick). ─
        let payload_hash = crate::payload_hash::payload_hash(data)
            .map_err(|e| format!("Failed to canonical-hash payload: {e}"))?;

        // ── Serialise + compress + encrypt the payload exactly once
        //    so every destination receives byte-identical bytes. ─────
        let json_data = serde_json::to_string_pretty(data)
            .map_err(|e| format!("Failed to serialize backup data: {}", e))?;

        let mut hasher = Sha256::new();
        hasher.update(json_data.as_bytes());
        let checksum = format!("{:x}", hasher.finalize());

        let final_data = if self.config.compress_backups {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
            encoder
                .write_all(json_data.as_bytes())
                .map_err(|e| format!("Failed to compress backup: {}", e))?;
            encoder
                .finish()
                .map_err(|e| format!("Failed to finish compression: {}", e))?
        } else {
            json_data.as_bytes().to_vec()
        };

        // Encryption dispatch (legacy SORNG1 write path removed —
        // see commit 57cf5505 for the migrator that converts existing
        // SORNG1 files to v2, and the legacy read path is retained
        // below until the next commit purges it):
        //  1. v2 envelope — whenever the master-key state is
        //     installed and unlocked. Master DEK drives sub-key
        //     derivation; the legacy backup password is dead weight.
        //  2. Plaintext — when no encryption state is installed (the
        //     pre-encryption boot path for tests).
        //
        // `BackupConfig.encrypt_backups` + `.encryption_password`
        // remain on the type for backward-compat deserialise but no
        // longer influence write dispatch; the master key is the
        // single source of truth.
        let used_v2 = self.encryption_state.is_some()
            && self
                .encryption_state
                .as_ref()
                .unwrap()
                .is_unlocked()
                .await;
        let encrypted_data = if used_v2 {
            self.encrypt_backup_v2(&final_data).await?
        } else {
            final_data
        };

        let connections_count = data
            .get("connections")
            .and_then(|c| c.as_array())
            .map(|arr| arr.len() as u32)
            .unwrap_or(0);

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup_id = format!(
            "{}-{}",
            now,
            uuid::Uuid::new_v4()
                .to_string()
                .split('-')
                .next()
                .unwrap_or("0")
        );
        let extension = match (&self.config.format, self.config.compress_backups) {
            (BackupFormat::Json, true) => "json.gz",
            (BackupFormat::Json, false) => "json",
            (BackupFormat::EncryptedJson, true) => "enc.json.gz",
            (BackupFormat::EncryptedJson, false) => "enc.json",
            (BackupFormat::Xml, true) => "xml.gz",
            (BackupFormat::Xml, false) => "xml",
        };
        let filename = format!("backup_{}_{}.{}", backup_type, backup_id, extension);

        // Force-emit safety valve: when the counter has caught up to
        // the threshold, this tick must write regardless of delta-skip.
        // `0` disables the safety valve (skip indefinitely).
        let force_emit = self.config.force_emit_every_n_skipped_ticks > 0
            && self.status.consecutive_skipped_count
                >= self.config.force_emit_every_n_skipped_ticks;

        // ── Fan out to every target ────────────────────────────────
        let mut target_results: Vec<TargetResult> = Vec::with_capacity(targets.len());
        let mut primary_metadata: Option<BackupMetadata> = None;
        let mut any_wrote = false;

        for target in &targets {
            if !target.enabled {
                target_results.push(TargetResult {
                    target_id: target.id.clone(),
                    status: TargetStatus::Disabled,
                    payload_hash_written: None,
                    bytes_written: None,
                    file_path: None,
                    error_message: None,
                });
                continue;
            }

            let target_dir = match resolve_target_dir(target, &self.config.destination_path) {
                Ok(p) => p,
                Err(e) => {
                    target_results.push(TargetResult {
                        target_id: target.id.clone(),
                        status: TargetStatus::Failed,
                        payload_hash_written: None,
                        bytes_written: None,
                        file_path: None,
                        error_message: Some(e),
                    });
                    continue;
                }
            };

            if let Err(e) = fs::create_dir_all(&target_dir) {
                target_results.push(TargetResult {
                    target_id: target.id.clone(),
                    status: TargetStatus::Failed,
                    payload_hash_written: None,
                    bytes_written: None,
                    file_path: None,
                    error_message: Some(format!(
                        "Failed to create backup directory {}: {}",
                        target_dir.display(),
                        e
                    )),
                });
                continue;
            }

            // Per-target delta decision: skip only when delta-skip is
            // on, *this destination* already has the current payload,
            // and the force-N valve hasn't fired.
            let target_last_hash = find_last_payload_hash_for_target(&target_dir, &target.id);
            let should_skip = self.config.delta_skip_enabled
                && !force_emit
                && target_last_hash.as_deref() == Some(payload_hash.as_str());
            if should_skip {
                target_results.push(TargetResult {
                    target_id: target.id.clone(),
                    status: TargetStatus::SkippedUnchanged,
                    payload_hash_written: target_last_hash,
                    bytes_written: None,
                    file_path: None,
                    error_message: None,
                });
                continue;
            }

            // Write the (already-encrypted) payload + per-target
            // metadata sidecar.
            let file_path = target_dir.join(&filename);
            let write_result = (|| -> Result<u64, String> {
                let mut file = File::create(&file_path).map_err(|e| {
                    format!(
                        "Failed to create backup file at {}: {}",
                        file_path.display(),
                        e
                    )
                })?;
                file.write_all(&encrypted_data)
                    .map_err(|e| format!("Failed to write backup file: {}", e))?;
                Ok(encrypted_data.len() as u64)
            })();

            match write_result {
                Ok(size_bytes) => {
                    let metadata = BackupMetadata {
                        id: backup_id.clone(),
                        created_at: now,
                        backup_type: backup_type.to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                        checksum: checksum.clone(),
                        // `encrypted` reflects whatever path actually
                        // produced the bytes — v2 envelope counts as
                        // encrypted even when the legacy
                        // `encrypt_backups` switch is off.
                        encrypted: used_v2
                            || (self.config.encrypt_backups
                                && self.config.encryption_password.is_some()),
                        compressed: self.config.compress_backups,
                        size_bytes,
                        connections_count,
                        parent_backup_id: None,
                        payload_hash: Some(payload_hash.clone()),
                        target_id: Some(target.id.clone()),
                    };
                    let metadata_path = target_dir.join(format!("{}.meta.json", filename));
                    if let Err(e) = serde_json::to_string_pretty(&metadata)
                        .map_err(|e| format!("Failed to serialize metadata: {}", e))
                        .and_then(|s| {
                            fs::write(&metadata_path, s)
                                .map_err(|e| format!("Failed to write metadata: {}", e))
                        })
                    {
                        // Roll back the data file so an orphan doesn't
                        // confuse the delta comparator on the next tick.
                        let _ = fs::remove_file(&file_path);
                        target_results.push(TargetResult {
                            target_id: target.id.clone(),
                            status: TargetStatus::Failed,
                            payload_hash_written: None,
                            bytes_written: None,
                            file_path: None,
                            error_message: Some(e),
                        });
                        continue;
                    }

                    target_results.push(TargetResult {
                        target_id: target.id.clone(),
                        status: TargetStatus::Success,
                        payload_hash_written: Some(payload_hash.clone()),
                        bytes_written: Some(size_bytes),
                        file_path: Some(file_path.to_string_lossy().into_owned()),
                        error_message: None,
                    });
                    if primary_metadata.is_none() {
                        primary_metadata = Some(metadata);
                    }
                    any_wrote = true;
                }
                Err(e) => {
                    target_results.push(TargetResult {
                        target_id: target.id.clone(),
                        status: TargetStatus::Failed,
                        payload_hash_written: None,
                        bytes_written: None,
                        file_path: None,
                        error_message: Some(e),
                    });
                }
            }
        }

        Ok(BackupRunSummary {
            payload_hash,
            skipped: !any_wrote
                && target_results
                    .iter()
                    .any(|r| r.status == TargetStatus::SkippedUnchanged),
            target_results,
            primary_metadata,
        })
    }

    /// Run `cleanup_old_backups` for every enabled destination so the
    /// retention policy applies independently per target. Each target
    /// may override `max_backups_to_keep` via its `retentionOverride`.
    async fn cleanup_old_backups_all_targets(&self) -> Result<(), String> {
        for target in self.config.effective_destinations() {
            if !target.enabled {
                continue;
            }
            let dir = match resolve_target_dir(&target, &self.config.destination_path) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let limit = target
                .retention_override
                .as_ref()
                .and_then(|r| r.max_backups_to_keep)
                .unwrap_or(self.config.max_backups_to_keep);
            if limit == 0 {
                // 0 means "unlimited" — skip cleanup entirely.
                continue;
            }
            cleanup_backups_in_dir(&dir, limit as usize)?;
        }
        Ok(())
    }

    /// Update backup statistics across every configured destination.
    /// When the user has multiple targets, the count is the sum of
    /// `backup_*` files at each location and the total size is the
    /// sum of their on-disk sizes.
    async fn update_backup_stats(&mut self) -> Result<(), String> {
        let mut count = 0u32;
        let mut total_size = 0u64;

        for target in self.config.effective_destinations() {
            if !target.enabled {
                continue;
            }
            let dir = match resolve_target_dir(&target, &self.config.destination_path) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if !dir.exists() {
                continue;
            }
            for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if filename.starts_with("backup_") && !filename.contains(".meta.") {
                    count += 1;
                    if let Ok(meta) = entry.metadata() {
                        total_size += meta.len();
                    }
                }
            }
        }

        self.status.backup_count = count;
        self.status.total_size_bytes = total_size;
        Ok(())
    }

    /// Flat list of every backup across every enabled destination,
    /// sorted newest-first. Preserved for back-compat callers; the
    /// richer per-destination view lives in `list_backups_all_targets`.
    pub async fn list_backups(&self) -> Result<Vec<BackupListItem>, String> {
        let mut all = Vec::new();
        for listing in self.list_backups_all_targets().await? {
            all.extend(listing.backups);
        }
        all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(all)
    }

    /// Per-destination listing of available backups. The restore
    /// picker uses this to render the merged timeline (one row per
    /// backup with per-source badges) and the destinations sidebar.
    /// Errors at individual destinations land in
    /// `DestinationListing.error_message` rather than failing the
    /// whole call — a missing local folder shouldn't hide what's
    /// available on the user's cloud.
    pub async fn list_backups_all_targets(&self) -> Result<Vec<DestinationListing>, String> {
        let targets = self.config.effective_destinations();
        if targets.is_empty() {
            return Ok(Vec::new());
        }

        let mut out = Vec::with_capacity(targets.len());
        for target in targets {
            let resolved = match resolve_target_dir(&target, &self.config.destination_path) {
                Ok(p) => p,
                Err(e) => {
                    out.push(DestinationListing {
                        target_id: target.id.clone(),
                        target_label: target.label.clone(),
                        resolved_path: String::new(),
                        enabled: target.enabled,
                        backups: Vec::new(),
                        error_message: Some(e),
                    });
                    continue;
                }
            };

            let mut listing = DestinationListing {
                target_id: target.id.clone(),
                target_label: target.label.clone(),
                resolved_path: resolved.to_string_lossy().into_owned(),
                enabled: target.enabled,
                backups: Vec::new(),
                error_message: None,
            };

            if !resolved.exists() {
                // Missing directory is not an error per se — it just
                // means nothing has been written here yet.
                out.push(listing);
                continue;
            }

            let entries = match fs::read_dir(&resolved) {
                Ok(e) => e,
                Err(e) => {
                    listing.error_message = Some(format!(
                        "Failed to scan {}: {}",
                        resolved.display(),
                        e
                    ));
                    out.push(listing);
                    continue;
                }
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                if !filename.starts_with("backup_") || filename.contains(".meta.") {
                    continue;
                }

                let meta_path = resolved.join(format!("{}.meta.json", filename));
                let (id, backup_type, created_at, encrypted, compressed, payload_hash, target_id) =
                    if meta_path.exists() {
                        let meta_content = fs::read_to_string(&meta_path).unwrap_or_default();
                        if let Ok(meta) =
                            serde_json::from_str::<BackupMetadata>(&meta_content)
                        {
                            (
                                meta.id,
                                meta.backup_type,
                                meta.created_at,
                                meta.encrypted,
                                meta.compressed,
                                meta.payload_hash,
                                meta.target_id.or_else(|| Some(target.id.clone())),
                            )
                        } else {
                            (
                                filename.clone(),
                                "unknown".to_string(),
                                0,
                                false,
                                false,
                                None,
                                Some(target.id.clone()),
                            )
                        }
                    } else {
                        (
                            filename.clone(),
                            "unknown".to_string(),
                            0,
                            false,
                            false,
                            None,
                            Some(target.id.clone()),
                        )
                    };

                let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                listing.backups.push(BackupListItem {
                    id,
                    filename,
                    created_at,
                    backup_type,
                    size_bytes,
                    encrypted,
                    compressed,
                    target_id,
                    target_label: Some(target.label.clone()),
                    payload_hash,
                });
            }
            listing.backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            out.push(listing);
        }
        Ok(out)
    }

    /// Restore from a backup file. When the user has multiple
    /// destinations and the restore picker offers a specific source,
    /// `target_id` should be set so we read from that destination
    /// only. When `target_id` is `None`, every enabled destination is
    /// searched and the first matching file is used (back-compat with
    /// the legacy single-destination flow).
    pub async fn restore_backup_from_target(
        &self,
        backup_id: &str,
        target_id: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        // Build the list of directories to search.
        let mut candidate_dirs: Vec<PathBuf> = Vec::new();
        for target in self.config.effective_destinations() {
            if !target.enabled {
                continue;
            }
            if let Some(want) = target_id {
                if target.id != want {
                    continue;
                }
            }
            if let Ok(p) = resolve_target_dir(&target, &self.config.destination_path) {
                candidate_dirs.push(p);
            }
        }
        if candidate_dirs.is_empty() {
            return Err(match target_id {
                Some(t) => format!("Backup target '{}' is not configured or disabled", t),
                None => "No backup destinations configured".to_string(),
            });
        }

        // Find the backup file across every candidate directory.
        let mut backup_path: Option<PathBuf> = None;
        for dir in &candidate_dirs {
            if !dir.exists() {
                continue;
            }
            let entries = match fs::read_dir(dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if filename.contains(backup_id) && !filename.contains(".meta.") {
                    backup_path = Some(path);
                    break;
                }
            }
            if backup_path.is_some() {
                break;
            }
        }

        let path = backup_path.ok_or_else(|| format!("Backup not found: {}", backup_id))?;

        // Read file
        let file_data =
            fs::read(&path).map_err(|e| format!("Failed to read backup file: {}", e))?;

        // Magic-byte dispatch on read. v2 envelope (sorng-v1) wins,
        // legacy SORNG1 stays supported, otherwise treat as plaintext.
        let decrypted_data = if self.is_v2_backup(&file_data) {
            self.decrypt_backup_v2(&file_data).await?
        } else if self.is_encrypted_backup(&file_data) {
            let password =
                self.config.encryption_password.as_ref().ok_or_else(|| {
                    "Backup is encrypted but no password is configured".to_string()
                })?;
            self.decrypt_backup_data(&file_data, password)?
        } else {
            file_data
        };

        // Decompress if needed
        let is_compressed = path.to_string_lossy().contains(".gz");
        let json_data = if is_compressed {
            let mut decoder = GzDecoder::new(&decrypted_data[..]);
            let mut decompressed = String::new();
            decoder
                .read_to_string(&mut decompressed)
                .map_err(|e| format!("Failed to decompress backup: {}", e))?;
            decompressed
        } else {
            String::from_utf8(decrypted_data)
                .map_err(|e| format!("Invalid UTF-8 in backup: {}", e))?
        };

        // Parse JSON
        let data: serde_json::Value = serde_json::from_str(&json_data)
            .map_err(|e| format!("Failed to parse backup JSON: {}", e))?;

        Ok(data)
    }

    /// Back-compat wrapper for callers that don't care which
    /// destination the backup is restored from — searches every
    /// enabled destination and returns the first match. New callers
    /// should use `restore_backup_from_target` with an explicit
    /// `target_id` so the user controls which copy is restored when
    /// the same backup ID exists at multiple destinations.
    pub async fn restore_backup(&self, backup_id: &str) -> Result<serde_json::Value, String> {
        self.restore_backup_from_target(backup_id, None).await
    }

    /// Delete a specific backup
    pub async fn delete_backup(&mut self, backup_id: &str) -> Result<(), String> {
        let dest_path = Path::new(&self.config.destination_path);

        for entry in fs::read_dir(dest_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if filename.contains(backup_id) {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete backup file: {}", e))?;
            }
        }

        self.update_backup_stats().await?;
        Ok(())
    }

    /// SORNG1 envelope writer. No production caller remains after
    /// this commit — kept only so the legacy-decrypt tests can produce
    /// fixtures the same way the old write path did. Full purge in
    /// commit Z.
    #[cfg(test)]
    fn encrypt_backup_data(&self, plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
        let key = self.derive_key(password);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Failed to encrypt backup: {}", e))?;
        let mut out = Vec::with_capacity(6 + nonce_bytes.len() + ciphertext.len());
        out.extend_from_slice(b"SORNG1");
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    fn decrypt_backup_data(&self, data: &[u8], password: &str) -> Result<Vec<u8>, String> {
        if data.len() < 6 + 12 || &data[..6] != b"SORNG1" {
            return Err("Backup encryption header missing or invalid".to_string());
        }
        let nonce_bytes = &data[6..18];
        let ciphertext = &data[18..];
        let key = self.derive_key(password);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Failed to decrypt backup: {}", e))
    }

    fn is_encrypted_backup(&self, data: &[u8]) -> bool {
        data.len() >= 6 && &data[..6] == b"SORNG1"
    }

    /// Magic-byte sniff: `SORNG\0` → v2 envelope (per-master-key DEK),
    /// otherwise fall through to legacy PBKDF2 / plaintext detection.
    fn is_v2_backup(&self, data: &[u8]) -> bool {
        data.len() >= 6 && &data[..6] == sorng_encryption::envelope::MAGIC
    }

    /// Encrypt under the v2 envelope. Caller already has the
    /// (plaintext-or-gzipped) payload; this is symmetric with
    /// `decrypt_backup_v2`.
    async fn encrypt_backup_v2(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let state = self
            .encryption_state
            .as_ref()
            .ok_or_else(|| "v2 backup requested but encryption state not installed".to_string())?;
        sorng_encryption::artifacts::backups::write(
            state,
            plaintext,
            sorng_encryption::envelope::MasterKeyStorage::Vault,
            sorng_encryption::password_wrap::Argon2Params::OWASP,
            [0u8; sorng_encryption::envelope::SALT_LEN],
        )
        .await
        .map_err(|e| format!("v2 backup encrypt: {e}"))
    }

    /// Inverse of `encrypt_backup_v2`. Returns the raw (still possibly
    /// gzipped) plaintext.
    async fn decrypt_backup_v2(&self, blob: &[u8]) -> Result<Vec<u8>, String> {
        let state = self
            .encryption_state
            .as_ref()
            .ok_or_else(|| "v2 backup found but encryption state not installed".to_string())?;
        sorng_encryption::artifacts::backups::read(state, blob)
            .await
            .map_err(|e| format!("v2 backup decrypt: {e}"))
    }

    fn derive_key(&self, password: &str) -> [u8; 32] {
        // Use PBKDF2-HMAC-SHA256 with 600k iterations (OWASP 2023) instead of
        // a single SHA-256 pass. Salt is deterministic so existing backups
        // encrypted with the same password can still be decrypted.
        let mut salt_hasher = Sha256::new();
        salt_hasher.update(b"sorng-backup-kdf-salt:");
        salt_hasher.update(password.as_bytes());
        let salt = salt_hasher.finalize();

        let mut key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, 600_000, &mut key);
        key
    }

    /// One-shot migration of every backup file under each configured
    /// destination from the legacy `SORNG1` envelope (or plaintext) to
    /// the v2 envelope under the master DEK
    /// (`sorng-v1::backups`). The migrator is the prerequisite for
    /// dropping the legacy `SORNG1` read path — once a user runs this
    /// successfully across every destination, the legacy reader can
    /// be removed safely.
    ///
    /// Per-file behaviour:
    /// - File starts with `SORNG\0` → already v2, reported as
    ///   `AlreadyV2`. No-op.
    /// - File starts with `SORNG1` → caller must pass the legacy
    ///   backup password. Decrypt with PBKDF2/600k, re-encrypt under
    ///   the master DEK, archive original as `<file>.v0.bak`.
    /// - Anything else → treat as plaintext. Re-encrypt and archive.
    ///
    /// Safety invariants (test-covered):
    /// - Wrong password produces an error WITHOUT renaming or
    ///   deleting the source file. Resumable.
    /// - Encryption state must be installed and unlocked; locked
    ///   migration is refused before any disk write.
    /// - Sidecar metadata files (`*.meta.json`) are never touched.
    /// - The first successful file's `bytes_in/bytes_out` proves
    ///   round-trip; subsequent failures don't roll the success back.
    pub async fn migrate_to_master_dek(
        &mut self,
        legacy_password: Option<&str>,
    ) -> Result<BackupMigrationReport, String> {
        let state = self
            .encryption_state
            .clone()
            .ok_or_else(|| "encryption state not installed; cannot migrate".to_string())?;
        if !state.is_unlocked().await {
            return Err("master key is locked; unlock before migrating".into());
        }

        let targets = self.config.effective_destinations();
        let mut report = BackupMigrationReport::default();

        for target in &targets {
            if !target.enabled {
                continue;
            }
            let dir = match resolve_target_dir(target, &self.config.destination_path) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if !dir.exists() {
                continue;
            }
            let entries = match fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                // Sidecar metadata + already-archived legacy files
                // are skipped silently — they're not encrypted blobs.
                if !name.starts_with("backup_") || name.ends_with(".v0.bak") {
                    continue;
                }
                if name.contains(".meta.") {
                    continue;
                }
                report.total += 1;

                let bytes = match fs::read(&path) {
                    Ok(b) => b,
                    Err(e) => {
                        report.failed.push(BackupMigrationFailure {
                            file_path: path.display().to_string(),
                            reason: format!("read: {e}"),
                        });
                        continue;
                    }
                };

                // Idempotency: already v2 → no-op.
                if self.is_v2_backup(&bytes) {
                    report.already_v2 += 1;
                    continue;
                }

                // Recover plaintext per the source format.
                let plaintext: Vec<u8> = if self.is_encrypted_backup(&bytes) {
                    let pw = match legacy_password {
                        Some(p) => p,
                        None => {
                            report.failed.push(BackupMigrationFailure {
                                file_path: path.display().to_string(),
                                reason:
                                    "SORNG1 backup found but no legacy password supplied"
                                        .into(),
                            });
                            continue;
                        }
                    };
                    match self.decrypt_backup_data(&bytes, pw) {
                        Ok(b) => b,
                        Err(e) => {
                            report.failed.push(BackupMigrationFailure {
                                file_path: path.display().to_string(),
                                reason: e,
                            });
                            continue;
                        }
                    }
                } else {
                    // Plaintext backup (encrypt_backups was false at
                    // write time). Bytes are already what we need.
                    bytes.clone()
                };

                // Re-encrypt under the master DEK before touching the
                // disk so a v2 encode failure doesn't lose the source.
                let blob = match self.encrypt_backup_v2(&plaintext).await {
                    Ok(b) => b,
                    Err(e) => {
                        report.failed.push(BackupMigrationFailure {
                            file_path: path.display().to_string(),
                            reason: e,
                        });
                        continue;
                    }
                };

                // Atomic flip: archive the original first so the
                // canonical path is free for the v2 blob. On write
                // failure, restore the backup so the user retains
                // recoverable data at this destination.
                let backup_path = path.with_extension(format!(
                    "{}.v0.bak",
                    path.extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("bin")
                ));
                if let Err(e) = fs::rename(&path, &backup_path) {
                    report.failed.push(BackupMigrationFailure {
                        file_path: path.display().to_string(),
                        reason: format!("archive: {e}"),
                    });
                    continue;
                }
                if let Err(e) = fs::write(&path, &blob) {
                    // Best-effort rollback so the destination is still
                    // restorable from disk.
                    let _ = fs::rename(&backup_path, &path);
                    report.failed.push(BackupMigrationFailure {
                        file_path: path.display().to_string(),
                        reason: format!("write v2: {e}"),
                    });
                    continue;
                }
                report.migrated += 1;
                report.bytes_in += bytes.len() as u64;
                report.bytes_out += blob.len() as u64;
            }
        }

        Ok(report)
    }
}

// ── Multi-target / delta-skip helpers ────────────────────────────────

/// Summary returned by `perform_backup` describing what happened at
/// each destination on a single scheduled tick. The owning
/// `run_backup` uses this to update `BackupStatus` and surface the
/// outcome to the caller.
#[derive(Debug, Clone)]
struct BackupRunSummary {
    /// Canonical SHA-256 of the *plaintext* payload — used as the
    /// `last_payload_hash` bookmark for the next tick's delta check.
    payload_hash: String,
    /// `true` when no destination wrote on this tick (every enabled
    /// target was delta-skipped and force-N didn't fire). Disabled
    /// targets alone don't count as a skip — at least one
    /// `SkippedUnchanged` is required.
    skipped: bool,
    /// One entry per destination (including Disabled targets) so the
    /// UI can render the full "last run" panel.
    target_results: Vec<TargetResult>,
    /// First successful per-target metadata, returned by `run_backup`
    /// to preserve the existing `Result<BackupMetadata, String>`
    /// Tauri command shape. `None` when every target was skipped.
    primary_metadata: Option<BackupMetadata>,
}

/// Build a synthetic `BackupMetadata` for a tick where every enabled
/// destination was delta-skipped, so the Tauri command contract can
/// stay `Result<BackupMetadata, String>` and the caller can detect
/// the skip via `backup_type == "skipped"` plus the empty checksum.
fn skipped_run_metadata(backup_type: &str, payload_hash: String) -> BackupMetadata {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    BackupMetadata {
        id: format!("skipped-{}", now),
        created_at: now,
        backup_type: format!("{}-skipped", backup_type),
        version: env!("CARGO_PKG_VERSION").to_string(),
        checksum: String::new(),
        encrypted: false,
        compressed: false,
        size_bytes: 0,
        connections_count: 0,
        parent_backup_id: None,
        payload_hash: Some(payload_hash),
        target_id: None,
    }
}

/// Resolve a `BackupTarget` to an absolute filesystem path. The
/// `custom` / `appData` / `documents` presets use the supplied
/// `custom_path` (or the legacy `BackupConfig.destination_path` when
/// custom_path is None, for back-compat). Cloud presets are out of
/// scope for the local-write path used by the in-app backup; the
/// commit upstream of this one in the plan wires the cloud transports
/// — for now they resolve to `custom_path` so a user who points
/// `customPath` at a locally-mounted cloud sync folder (e.g. a
/// Dropbox/OneDrive client cache) Just Works.
fn resolve_target_dir(target: &BackupTarget, legacy_fallback: &str) -> Result<PathBuf, String> {
    if let Some(p) = target.custom_path.as_ref() {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    if !legacy_fallback.is_empty() {
        return Ok(PathBuf::from(legacy_fallback));
    }
    Err(format!(
        "Backup target '{}' has no custom_path set and no legacy destination_path to fall back on",
        target.label
    ))
}

/// Scan `dir` for the most recent `.meta.json` sidecar whose
/// `target_id` matches `target_id`, and return its `payload_hash` if
/// present. Used by the delta-skip comparator to decide whether
/// *this destination* already has the current payload — independent
/// of what other destinations did.
fn find_last_payload_hash_for_target(dir: &Path, target_id: &str) -> Option<String> {
    if !dir.exists() {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    let mut best: Option<(u64, String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !filename.contains(".meta.json") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let meta: BackupMetadata = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.target_id.as_deref() != Some(target_id) {
            continue;
        }
        if let Some(hash) = meta.payload_hash {
            if best.as_ref().map(|(t, _)| meta.created_at > *t).unwrap_or(true) {
                best = Some((meta.created_at, hash));
            }
        }
    }
    best.map(|(_, h)| h)
}

/// Drop all but the `keep_last` newest `backup_*` files (and their
/// `.meta.json` sidecars) from `dir`. Idempotent and safe to call on
/// a missing directory.
fn cleanup_backups_in_dir(dir: &Path, keep_last: usize) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let mut backups: Vec<(PathBuf, u64)> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !filename.starts_with("backup_") || filename.contains(".meta.") {
            continue;
        }
        let created = entry
            .metadata()
            .and_then(|m| m.created())
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);
        backups.push((path, created));
    }
    backups.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in backups.iter().skip(keep_last) {
        let _ = fs::remove_file(path);
        // Sidecar lives alongside as `<name>.meta.json`.
        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            if let Some(parent) = path.parent() {
                let meta = parent.join(format!("{}.meta.json", filename));
                let _ = fs::remove_file(meta);
            }
        }
    }
    Ok(())
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── BackupConfig Default ────────────────────────────────────────────

    #[test]
    fn backup_config_default_values() {
        let cfg = BackupConfig::default();
        assert!(!cfg.enabled);
        assert_eq!(cfg.frequency, BackupFrequency::Daily);
        assert_eq!(cfg.scheduled_time, "03:00");
        assert_eq!(cfg.weekly_day, DayOfWeek::Sunday);
        assert_eq!(cfg.monthly_day, 1);
        assert!(cfg.destination_path.is_empty());
        assert!(cfg.differential_enabled);
        assert_eq!(cfg.full_backup_interval, 7);
        assert_eq!(cfg.max_backups_to_keep, 30);
        assert_eq!(cfg.format, BackupFormat::Json);
        assert!(!cfg.include_passwords);
        assert!(cfg.encrypt_backups);
        assert_eq!(cfg.encryption_algorithm, "AES-256-GCM");
        assert!(cfg.encryption_password.is_none());
        assert!(cfg.include_settings);
        assert!(!cfg.include_ssh_keys);
        assert!(!cfg.backup_on_close);
        assert!(cfg.notify_on_backup);
        assert!(cfg.compress_backups);
    }

    // ── Enum serde round-trips ──────────────────────────────────────────

    #[test]
    fn backup_frequency_serde_roundtrip() {
        let variants = vec![
            BackupFrequency::Manual,
            BackupFrequency::Hourly,
            BackupFrequency::Daily,
            BackupFrequency::Weekly,
            BackupFrequency::Monthly,
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: BackupFrequency = serde_json::from_str(&json).unwrap();
            assert_eq!(v, back);
        }
    }

    #[test]
    fn backup_frequency_rename_all_lowercase() {
        let json = serde_json::to_string(&BackupFrequency::Daily).unwrap();
        assert_eq!(json, "\"daily\"");
    }

    #[test]
    fn backup_format_serde_roundtrip() {
        let variants = vec![
            BackupFormat::Json,
            BackupFormat::Xml,
            BackupFormat::EncryptedJson,
        ];
        for v in variants {
            let json = serde_json::to_string(&v).unwrap();
            let back: BackupFormat = serde_json::from_str(&json).unwrap();
            assert_eq!(v, back);
        }
    }

    #[test]
    fn backup_format_rename_all_kebab() {
        let json = serde_json::to_string(&BackupFormat::EncryptedJson).unwrap();
        assert_eq!(json, "\"encrypted-json\"");
    }

    #[test]
    fn day_of_week_serde_roundtrip() {
        let days = vec![
            DayOfWeek::Sunday,
            DayOfWeek::Monday,
            DayOfWeek::Tuesday,
            DayOfWeek::Wednesday,
            DayOfWeek::Thursday,
            DayOfWeek::Friday,
            DayOfWeek::Saturday,
        ];
        for d in days {
            let json = serde_json::to_string(&d).unwrap();
            let back: DayOfWeek = serde_json::from_str(&json).unwrap();
            assert_eq!(d, back);
        }
    }

    #[test]
    fn day_of_week_rename_all_lowercase() {
        assert_eq!(
            serde_json::to_string(&DayOfWeek::Wednesday).unwrap(),
            "\"wednesday\""
        );
    }

    // ── BackupConfig serde ──────────────────────────────────────────────

    #[test]
    fn backup_config_serde_roundtrip() {
        let cfg = BackupConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: BackupConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.frequency, cfg.frequency);
        assert_eq!(back.scheduled_time, cfg.scheduled_time);
        assert_eq!(back.max_backups_to_keep, cfg.max_backups_to_keep);
    }

    #[test]
    fn backup_config_camel_case_keys() {
        let cfg = BackupConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("scheduledTime"));
        assert!(json.contains("maxBackupsToKeep"));
        assert!(json.contains("includePasswords"));
        assert!(json.contains("encryptBackups"));
        assert!(!json.contains("scheduled_time"));
    }

    // ── BackupMetadata serde ────────────────────────────────────────────

    #[test]
    fn backup_metadata_serde_roundtrip() {
        let meta = BackupMetadata {
            id: "abc-123".to_string(),
            created_at: 1700000000,
            backup_type: "full".to_string(),
            version: "1.0.0".to_string(),
            checksum: "deadbeef".to_string(),
            encrypted: true,
            compressed: true,
            size_bytes: 4096,
            connections_count: 10,
            parent_backup_id: Some("parent-1".to_string()),
            payload_hash: Some("sha256:abc".to_string()),
            target_id: Some("legacy-default".to_string()),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let back: BackupMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc-123");
        assert_eq!(back.connections_count, 10);
        assert_eq!(back.parent_backup_id, Some("parent-1".to_string()));
        assert_eq!(back.payload_hash.as_deref(), Some("sha256:abc"));
    }

    #[test]
    fn backup_metadata_camel_case_keys() {
        let meta = BackupMetadata {
            id: "x".to_string(),
            created_at: 0,
            backup_type: "full".to_string(),
            version: "0".to_string(),
            checksum: "".to_string(),
            encrypted: false,
            compressed: false,
            size_bytes: 0,
            connections_count: 0,
            parent_backup_id: None,
            payload_hash: None,
            target_id: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("createdAt"));
        assert!(json.contains("sizeBytes"));
        assert!(json.contains("parentBackupId"));
    }

    // ── BackupStatus serde ──────────────────────────────────────────────

    #[test]
    fn backup_status_serde_roundtrip() {
        let status = BackupStatus {
            is_running: false,
            last_backup_time: Some(1700000000),
            last_backup_type: Some("full".to_string()),
            last_backup_status: Some("success".to_string()),
            last_error: None,
            next_scheduled_time: Some(1700003600),
            backup_count: 5,
            total_size_bytes: 10240,
            last_payload_hash: Some("sha256:abc".to_string()),
            consecutive_skipped_count: 0,
            last_target_results: Vec::new(),
        };
        let json = serde_json::to_string(&status).unwrap();
        let back: BackupStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back.backup_count, 5);
        assert_eq!(back.last_backup_time, Some(1700000000));
        assert_eq!(back.last_payload_hash.as_deref(), Some("sha256:abc"));
    }

    #[test]
    fn backup_status_deserialises_legacy_json_without_new_fields() {
        // Status records persisted before the delta-skip / multi-target
        // work must still load — the new fields are #[serde(default)].
        let legacy = r#"{
          "isRunning": false,
          "lastBackupTime": 1700000000,
          "lastBackupType": "full",
          "lastBackupStatus": "success",
          "lastError": null,
          "nextScheduledTime": null,
          "backupCount": 3,
          "totalSizeBytes": 2048
        }"#;
        let status: BackupStatus = serde_json::from_str(legacy).unwrap();
        assert_eq!(status.backup_count, 3);
        assert_eq!(status.consecutive_skipped_count, 0);
        assert!(status.last_payload_hash.is_none());
        assert!(status.last_target_results.is_empty());
    }

    #[test]
    fn backup_config_deserialises_legacy_json_without_new_fields() {
        // Same backward-compat check for BackupConfig.
        let legacy = r#"{
          "enabled": true,
          "frequency": "daily",
          "scheduledTime": "03:00",
          "weeklyDay": "sunday",
          "monthlyDay": 1,
          "destinationPath": "C:\\backups",
          "differentialEnabled": true,
          "fullBackupInterval": 7,
          "maxBackupsToKeep": 30,
          "format": "json",
          "includePasswords": false,
          "encryptBackups": true,
          "encryptionAlgorithm": "AES-256-GCM",
          "encryptionPassword": null,
          "includeSettings": true,
          "includeSshKeys": false,
          "backupOnClose": false,
          "notifyOnBackup": true,
          "compressBackups": true
        }"#;
        let cfg: BackupConfig = serde_json::from_str(legacy).unwrap();
        assert!(cfg.destinations.is_empty());
        assert!(!cfg.delta_skip_enabled);
        // Default force-N applies when the field is absent.
        assert_eq!(cfg.force_emit_every_n_skipped_ticks, 7);
    }

    #[test]
    fn effective_destinations_wraps_legacy_destination_path() {
        let mut cfg = BackupConfig::default();
        cfg.destination_path = "C:\\backups".to_string();
        let dests = cfg.effective_destinations();
        assert_eq!(dests.len(), 1);
        assert_eq!(dests[0].id, "legacy-default");
        assert_eq!(dests[0].custom_path.as_deref(), Some("C:\\backups"));
        assert!(dests[0].enabled);
    }

    #[test]
    fn effective_destinations_returns_configured_list_when_present() {
        let mut cfg = BackupConfig::default();
        cfg.destination_path = "C:\\legacy".to_string();
        cfg.destinations.push(BackupTarget {
            id: "t1".to_string(),
            label: "Primary".to_string(),
            preset: "custom".to_string(),
            custom_path: Some("D:\\primary".to_string()),
            enabled: true,
            retention_override: None,
        });
        let dests = cfg.effective_destinations();
        // When destinations is non-empty, the legacy field is ignored.
        assert_eq!(dests.len(), 1);
        assert_eq!(dests[0].id, "t1");
    }

    #[test]
    fn effective_destinations_returns_empty_when_nothing_configured() {
        let cfg = BackupConfig::default();
        // Default destination_path is empty and destinations is empty.
        assert!(cfg.effective_destinations().is_empty());
    }

    // ── BackupListItem serde ────────────────────────────────────────────

    #[test]
    fn backup_list_item_serde_roundtrip() {
        let item = BackupListItem {
            id: "b1".to_string(),
            filename: "backup_full_b1.json.gz".to_string(),
            created_at: 1700000000,
            backup_type: "full".to_string(),
            size_bytes: 5120,
            encrypted: false,
            compressed: true,
            target_id: Some("legacy-default".to_string()),
            target_label: Some("Default".to_string()),
            payload_hash: Some("sha256:abc".to_string()),
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: BackupListItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "b1");
        assert!(back.compressed);
        assert_eq!(back.target_label.as_deref(), Some("Default"));
    }

    #[test]
    fn backup_list_item_deserialises_legacy_json() {
        // Legacy sidecars persisted before the multi-target work
        // didn't carry target_id / target_label / payload_hash —
        // confirm those default to None when missing.
        let legacy = r#"{
          "id": "b1",
          "filename": "backup_full_b1.json.gz",
          "createdAt": 1700000000,
          "backupType": "full",
          "sizeBytes": 5120,
          "encrypted": false,
          "compressed": true
        }"#;
        let item: BackupListItem = serde_json::from_str(legacy).unwrap();
        assert_eq!(item.id, "b1");
        assert!(item.target_id.is_none());
        assert!(item.payload_hash.is_none());
    }

    // ── BackupService ───────────────────────────────────────────────────

    #[tokio::test]
    async fn backup_service_new_defaults() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let cfg = svc.get_config();
        assert!(!cfg.enabled);
        assert_eq!(cfg.frequency, BackupFrequency::Daily);
        let status = svc.get_status();
        assert!(!status.is_running);
        assert_eq!(status.backup_count, 0);
    }

    #[tokio::test]
    async fn backup_service_update_and_get_config() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = true;
        cfg.frequency = BackupFrequency::Hourly;
        cfg.max_backups_to_keep = 10;
        svc.update_config(cfg);
        let retrieved = svc.get_config();
        assert!(retrieved.enabled);
        assert_eq!(retrieved.frequency, BackupFrequency::Hourly);
        assert_eq!(retrieved.max_backups_to_keep, 10);
    }

    #[tokio::test]
    async fn backup_service_manual_no_next_time() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = true;
        cfg.frequency = BackupFrequency::Manual;
        svc.update_config(cfg);
        let status = svc.get_status();
        assert!(status.next_scheduled_time.is_none());
    }

    #[tokio::test]
    async fn backup_service_enabled_daily_has_next_time() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = true;
        cfg.frequency = BackupFrequency::Daily;
        svc.update_config(cfg);
        let status = svc.get_status();
        assert!(status.next_scheduled_time.is_some());
    }

    #[tokio::test]
    async fn backup_service_disabled_no_next_time() {
        let state = BackupService::new("/tmp/test".to_string());
        let mut svc = state.lock().await;
        let mut cfg = BackupConfig::default();
        cfg.enabled = false;
        cfg.frequency = BackupFrequency::Daily;
        svc.update_config(cfg);
        let status = svc.get_status();
        assert!(status.next_scheduled_time.is_none());
    }

    // ── Encryption round-trip ───────────────────────────────────────────

    #[tokio::test]
    async fn encrypt_decrypt_roundtrip() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let plaintext = b"Hello, World!";
        let password = "secret123";
        let encrypted = svc.encrypt_backup_data(plaintext, password).unwrap();
        assert_ne!(encrypted, plaintext);
        assert!(svc.is_encrypted_backup(&encrypted));
        let decrypted = svc.decrypt_backup_data(&encrypted, password).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[tokio::test]
    async fn is_encrypted_backup_false_for_plain_data() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        assert!(!svc.is_encrypted_backup(b"plain text data"));
        assert!(!svc.is_encrypted_backup(b"SORNG")); // Too short prefix
        assert!(!svc.is_encrypted_backup(b"")); // Empty
    }

    #[tokio::test]
    async fn decrypt_rejects_invalid_header() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let result = svc.decrypt_backup_data(b"INVALID_HEADER", "password");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn decrypt_wrong_password_fails() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let encrypted = svc.encrypt_backup_data(b"secret data", "correct").unwrap();
        let result = svc.decrypt_backup_data(&encrypted, "wrong");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn derive_key_deterministic() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let k1 = svc.derive_key("password");
        let k2 = svc.derive_key("password");
        assert_eq!(k1, k2);
    }

    #[tokio::test]
    async fn derive_key_different_passwords() {
        let state = BackupService::new("/tmp/test".to_string());
        let svc = state.lock().await;
        let k1 = svc.derive_key("password1");
        let k2 = svc.derive_key("password2");
        assert_ne!(k1, k2);
    }

    // ── Full backup round-trip with temp dir ────────────────────────────

    #[tokio::test]
    async fn run_backup_and_restore() {
        let tmp = std::env::temp_dir().join("sorng_backup_test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = false;
        cfg.compress_backups = false;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"name": "test"}]});
        let meta = svc.run_backup("full", &data).await.unwrap();

        assert_eq!(meta.backup_type, "full");
        assert!(!meta.encrypted);
        assert!(!meta.compressed);
        assert_eq!(meta.connections_count, 1);
        assert!(!meta.checksum.is_empty());

        let status = svc.get_status();
        assert_eq!(status.last_backup_status, Some("success".to_string()));
        assert!(status.last_backup_time.is_some());

        // Restore
        let restored = svc.restore_backup(&meta.id).await.unwrap();
        assert_eq!(restored["connections"][0]["name"], "test");

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn run_backup_compressed() {
        let tmp = std::env::temp_dir().join("sorng_backup_test_gz");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = false;
        cfg.compress_backups = true;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": []});
        let meta = svc.run_backup("full", &data).await.unwrap();
        assert!(meta.compressed);

        let restored = svc.restore_backup(&meta.id).await.unwrap();
        assert_eq!(restored["connections"], serde_json::json!([]));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn run_backup_encrypted_and_compressed() {
        let tmp = std::env::temp_dir().join("sorng_backup_test_enc");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = true;
        cfg.encryption_password = Some("test_password".to_string());
        cfg.compress_backups = true;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"name": "secure"}]});
        let meta = svc.run_backup("full", &data).await.unwrap();
        assert!(meta.encrypted);
        assert!(meta.compressed);

        let restored = svc.restore_backup(&meta.id).await.unwrap();
        assert_eq!(restored["connections"][0]["name"], "secure");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn backup_already_running_rejects() {
        let state = BackupService::new("/tmp/test_running".to_string());
        let mut svc = state.lock().await;
        svc.status.is_running = true;
        let result = svc.run_backup("full", &serde_json::json!({})).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already in progress"));
    }

    // ── Delta-skip + multi-target behaviour ─────────────────────────────

    /// Build a `BackupConfig` aimed at a single temp directory with
    /// no encryption/compression so test assertions can inspect the
    /// raw output. The caller layers on `destinations`, delta-skip,
    /// and the force-N threshold as needed.
    fn build_test_config(tmp: &std::path::Path) -> BackupConfig {
        let mut cfg = BackupConfig::default();
        cfg.destination_path = tmp.to_string_lossy().to_string();
        cfg.encrypt_backups = false;
        cfg.compress_backups = false;
        cfg.max_backups_to_keep = 0;
        cfg
    }

    fn fresh_temp_dir(label: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("sorng_backup_phase_b_{}", label));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[tokio::test]
    async fn multi_target_fan_out_writes_to_every_destination() {
        let dir_a = fresh_temp_dir("fanout_a");
        let dir_b = fresh_temp_dir("fanout_b");
        let state = BackupService::new(dir_a.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&dir_a);
        cfg.destinations = vec![
            BackupTarget {
                id: "a".into(),
                label: "Primary".into(),
                preset: "custom".into(),
                custom_path: Some(dir_a.to_string_lossy().to_string()),
                enabled: true,
                retention_override: None,
            },
            BackupTarget {
                id: "b".into(),
                label: "Secondary".into(),
                preset: "custom".into(),
                custom_path: Some(dir_b.to_string_lossy().to_string()),
                enabled: true,
                retention_override: None,
            },
        ];
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"id": "c1", "name": "srv"}]});
        svc.run_backup("full", &data).await.unwrap();

        // Both directories now contain one backup_*.json + sidecar.
        let count_files = |d: &std::path::Path| {
            std::fs::read_dir(d)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    n.starts_with("backup_") && !n.contains(".meta.")
                })
                .count()
        };
        assert_eq!(count_files(&dir_a), 1);
        assert_eq!(count_files(&dir_b), 1);

        let status = svc.get_status();
        assert_eq!(status.last_target_results.len(), 2);
        assert!(status
            .last_target_results
            .iter()
            .all(|r| r.status == TargetStatus::Success));
        assert!(status.last_payload_hash.is_some());

        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    #[tokio::test]
    async fn delta_skip_blocks_redundant_writes() {
        let tmp = fresh_temp_dir("delta_skip");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&tmp);
        cfg.delta_skip_enabled = true;
        // Disable the safety valve so the test deterministically skips.
        cfg.force_emit_every_n_skipped_ticks = 0;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"id": "c1"}]});
        let first = svc.run_backup("full", &data).await.unwrap();
        assert_eq!(first.backup_type, "full");

        // Second run with the same payload: skipped, no new file.
        let second = svc.run_backup("full", &data).await.unwrap();
        assert!(second.backup_type.ends_with("-skipped"));

        let files: Vec<_> = std::fs::read_dir(&tmp)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .collect();
        assert_eq!(files.len(), 1, "expected only the first backup file");

        let status = svc.get_status();
        assert_eq!(status.consecutive_skipped_count, 1);
        assert_eq!(status.last_backup_status.as_deref(), Some("skipped"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn delta_skip_emits_for_changed_payload() {
        let tmp = fresh_temp_dir("delta_change");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&tmp);
        cfg.delta_skip_enabled = true;
        cfg.force_emit_every_n_skipped_ticks = 0;
        svc.update_config(cfg);

        let payload1 = serde_json::json!({"connections": [{"id": "c1"}]});
        let payload2 = serde_json::json!({"connections": [{"id": "c2"}]});
        svc.run_backup("full", &payload1).await.unwrap();
        let second = svc.run_backup("full", &payload2).await.unwrap();
        assert_eq!(second.backup_type, "full");
        assert!(!second.backup_type.ends_with("-skipped"));

        let count = std::fs::read_dir(&tmp)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .count();
        assert_eq!(count, 2);

        let status = svc.get_status();
        assert_eq!(status.consecutive_skipped_count, 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn force_emit_every_n_safety_valve_fires() {
        let tmp = fresh_temp_dir("force_n");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&tmp);
        cfg.delta_skip_enabled = true;
        // After 2 skipped ticks the next tick must emit.
        cfg.force_emit_every_n_skipped_ticks = 2;
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": []});
        svc.run_backup("full", &data).await.unwrap(); // emit
        svc.run_backup("full", &data).await.unwrap(); // skip 1
        svc.run_backup("full", &data).await.unwrap(); // skip 2
        let forced = svc.run_backup("full", &data).await.unwrap(); // forced emit

        assert_eq!(
            forced.backup_type, "full",
            "force-N tick should produce a real full backup, not a skip marker"
        );
        let status = svc.get_status();
        assert_eq!(status.consecutive_skipped_count, 0);

        let count = std::fs::read_dir(&tmp)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .count();
        // Two emitted backups: the first and the forced one.
        assert_eq!(count, 2);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn per_target_recovery_writes_only_to_lagging_destination() {
        let dir_a = fresh_temp_dir("recover_a");
        let dir_b = fresh_temp_dir("recover_b");
        let state = BackupService::new(dir_a.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&dir_a);
        cfg.delta_skip_enabled = true;
        cfg.force_emit_every_n_skipped_ticks = 0;
        cfg.destinations = vec![
            BackupTarget {
                id: "a".into(),
                label: "A".into(),
                preset: "custom".into(),
                custom_path: Some(dir_a.to_string_lossy().to_string()),
                enabled: true,
                retention_override: None,
            },
            BackupTarget {
                id: "b".into(),
                label: "B".into(),
                preset: "custom".into(),
                custom_path: Some(dir_b.to_string_lossy().to_string()),
                enabled: true,
                retention_override: None,
            },
        ];
        svc.update_config(cfg);

        let data = serde_json::json!({"connections": [{"id": "c1"}]});
        svc.run_backup("full", &data).await.unwrap();

        // Simulate destination B losing its data (failed cloud sync,
        // disk wipe, manual deletion). Both files at B vanish.
        for entry in std::fs::read_dir(&dir_b).unwrap().flatten() {
            let _ = std::fs::remove_file(entry.path());
        }

        // Next tick: A's hash matches → skipped; B's hash is missing
        // → writes anyway. End result is a recovery, not a full skip.
        svc.run_backup("full", &data).await.unwrap();

        let count_a = std::fs::read_dir(&dir_a)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .count();
        let count_b = std::fs::read_dir(&dir_b)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .count();
        assert_eq!(count_a, 1, "A should not have been written to again");
        assert_eq!(count_b, 1, "B should have been recovered");

        let status = svc.get_status();
        let by_id: std::collections::HashMap<_, _> = status
            .last_target_results
            .iter()
            .map(|r| (r.target_id.as_str(), r.status.clone()))
            .collect();
        assert_eq!(by_id.get("a"), Some(&TargetStatus::SkippedUnchanged));
        assert_eq!(by_id.get("b"), Some(&TargetStatus::Success));

        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    #[tokio::test]
    async fn disabled_target_is_skipped_with_disabled_status() {
        let dir_a = fresh_temp_dir("disabled_a");
        let dir_b = fresh_temp_dir("disabled_b");
        let state = BackupService::new(dir_a.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&dir_a);
        cfg.destinations = vec![
            BackupTarget {
                id: "a".into(),
                label: "A".into(),
                preset: "custom".into(),
                custom_path: Some(dir_a.to_string_lossy().to_string()),
                enabled: true,
                retention_override: None,
            },
            BackupTarget {
                id: "b".into(),
                label: "B".into(),
                preset: "custom".into(),
                custom_path: Some(dir_b.to_string_lossy().to_string()),
                enabled: false,
                retention_override: None,
            },
        ];
        svc.update_config(cfg);

        svc.run_backup("full", &serde_json::json!({"connections": []}))
            .await
            .unwrap();

        let b_empty = std::fs::read_dir(&dir_b)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_")
            })
            .count();
        assert_eq!(b_empty, 0, "disabled target must not be written to");

        let status = svc.get_status();
        let by_id: std::collections::HashMap<_, _> = status
            .last_target_results
            .iter()
            .map(|r| (r.target_id.as_str(), r.status.clone()))
            .collect();
        assert_eq!(by_id.get("a"), Some(&TargetStatus::Success));
        assert_eq!(by_id.get("b"), Some(&TargetStatus::Disabled));

        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    #[tokio::test]
    async fn per_destination_retention_override_keeps_fewer() {
        let dir_a = fresh_temp_dir("retention_a");
        let dir_b = fresh_temp_dir("retention_b");
        let state = BackupService::new(dir_a.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        let mut cfg = build_test_config(&dir_a);
        cfg.max_backups_to_keep = 5;
        cfg.destinations = vec![
            BackupTarget {
                id: "a".into(),
                label: "A".into(),
                preset: "custom".into(),
                custom_path: Some(dir_a.to_string_lossy().to_string()),
                enabled: true,
                retention_override: None,
            },
            BackupTarget {
                id: "b".into(),
                label: "B".into(),
                preset: "custom".into(),
                custom_path: Some(dir_b.to_string_lossy().to_string()),
                enabled: true,
                retention_override: Some(DestinationRetentionPolicy {
                    max_backups_to_keep: Some(2),
                }),
            },
        ];
        svc.update_config(cfg);

        // Different payload each tick so nothing gets delta-skipped.
        for i in 0..4u32 {
            let data = serde_json::json!({"connections": [{"id": format!("c{i}")}]});
            svc.run_backup("full", &data).await.unwrap();
            // Sleep briefly so file mtimes don't collide on fast systems.
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        let count = |d: &std::path::Path| {
            std::fs::read_dir(d)
                .unwrap()
                .flatten()
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    n.starts_with("backup_") && !n.contains(".meta.")
                })
                .count()
        };
        assert_eq!(count(&dir_a), 4, "global keep=5 lets all 4 stay");
        assert_eq!(count(&dir_b), 2, "per-target keep=2 prunes the older two");

        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 3a — v2 envelope dispatch
    // ────────────────────────────────────────────────────────────────

    async fn unlocked_enc_state() -> std::sync::Arc<sorng_encryption::EncryptionState> {
        let s = sorng_encryption::EncryptionState::new();
        s.install(
            sorng_encryption::MasterDek::from_bytes(&[9u8; 32]).unwrap(),
        )
        .await;
        std::sync::Arc::new(s)
    }

    #[tokio::test]
    async fn v2_envelope_used_when_state_unlocked() {
        let tmp = fresh_temp_dir("v2_write");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        let cfg = build_test_config(&tmp);
        svc.update_config(cfg);
        svc.set_encryption_state(unlocked_enc_state().await);

        let data = serde_json::json!({ "connections": [{ "id": "c1" }] });
        let meta = svc.perform_backup("manual", &data).await.unwrap();
        // Locate the on-disk blob (no compression / no legacy crypto)
        // and verify the magic prefix is the v2 envelope, not SORNG1.
        let entry = std::fs::read_dir(&tmp).unwrap().find_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().into_owned();
            (name.starts_with("backup_") && !name.contains(".meta.")).then_some(e.path())
        }).expect("backup file written");
        let bytes = std::fs::read(&entry).unwrap();
        assert_eq!(
            &bytes[..6],
            sorng_encryption::envelope::MAGIC,
            "v2 envelope must win when state is unlocked"
        );
        assert!(meta.primary_metadata.unwrap().encrypted, "metadata flags as encrypted");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn plaintext_path_when_no_state_installed() {
        // After commit Y, the legacy SORNG1 write path is gone; with
        // no encryption state installed, backups land as plain bytes.
        // The `encrypt_backups: true` + password config is preserved
        // for backward-compat deserialisation but no longer
        // influences write dispatch.
        let tmp = fresh_temp_dir("v2_legacy");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        let mut cfg = build_test_config(&tmp);
        cfg.encrypt_backups = true;
        cfg.encryption_password = Some("hunter2".to_string());
        svc.update_config(cfg);

        let data = serde_json::json!({ "connections": [] });
        let _ = svc.perform_backup("manual", &data).await.unwrap();
        let entry = std::fs::read_dir(&tmp).unwrap().find_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().into_owned();
            (name.starts_with("backup_") && !name.contains(".meta.")).then_some(e.path())
        }).unwrap();
        let bytes = std::fs::read(&entry).unwrap();
        assert_ne!(
            &bytes[..6],
            b"SORNG1",
            "legacy SORNG1 write path was removed in commit Y"
        );
        assert_ne!(&bytes[..6], sorng_encryption::envelope::MAGIC);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn v2_round_trip_via_restore() {
        let tmp = fresh_temp_dir("v2_restore");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        let cfg = build_test_config(&tmp);
        svc.update_config(cfg);
        svc.set_encryption_state(unlocked_enc_state().await);

        let payload = serde_json::json!({
            "connections": [{ "id": "c1", "host": "example.com" }],
            "settings": { "theme": "dark" }
        });
        let result = svc.perform_backup("manual", &payload).await.unwrap();
        let id = result.primary_metadata.unwrap().id;
        let restored = svc
            .restore_backup_from_target(&id, None)
            .await
            .unwrap();
        assert_eq!(restored, payload, "v2 round-trip preserves the payload");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn restore_dispatches_on_magic_bytes() {
        // Hand-craft both blob shapes in the same dir and confirm the
        // dispatch picks the right path for each.
        let tmp = fresh_temp_dir("v2_sniff");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        let cfg = build_test_config(&tmp);
        svc.update_config(cfg);
        let enc = unlocked_enc_state().await;
        svc.set_encryption_state(enc.clone());

        // 1. is_v2_backup distinguishes correctly.
        let v2_bytes = svc
            .encrypt_backup_v2(b"{\"k\":\"v\"}")
            .await
            .unwrap();
        assert!(svc.is_v2_backup(&v2_bytes));
        assert!(!svc.is_encrypted_backup(&v2_bytes));

        let legacy = svc
            .encrypt_backup_data(b"{\"k\":\"v\"}", "pw")
            .unwrap();
        assert!(!svc.is_v2_backup(&legacy));
        assert!(svc.is_encrypted_backup(&legacy));

        let plain = b"{\"k\":\"v\"}".to_vec();
        assert!(!svc.is_v2_backup(&plain));
        assert!(!svc.is_encrypted_backup(&plain));

        // 2. Round-trip the v2 blob directly through the decrypt helper.
        let plaintext = svc.decrypt_backup_v2(&v2_bytes).await.unwrap();
        assert_eq!(plaintext, b"{\"k\":\"v\"}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn locked_state_falls_back_to_legacy_or_plaintext() {
        // EncryptionState installed but never unlocked → v2 path is
        // skipped without erroring; fall through to legacy / plaintext
        // exactly like a no-encryption build.
        let tmp = fresh_temp_dir("v2_locked");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        let cfg = build_test_config(&tmp);
        svc.update_config(cfg);
        let locked = std::sync::Arc::new(sorng_encryption::EncryptionState::new());
        svc.set_encryption_state(locked);

        let data = serde_json::json!({ "connections": [] });
        let _ = svc.perform_backup("manual", &data).await.unwrap();
        let entry = std::fs::read_dir(&tmp).unwrap().find_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().into_owned();
            (name.starts_with("backup_") && !name.contains(".meta.")).then_some(e.path())
        }).unwrap();
        let bytes = std::fs::read(&entry).unwrap();
        // No password configured and locked state → plaintext on disk.
        assert_ne!(&bytes[..6.min(bytes.len())], sorng_encryption::envelope::MAGIC);
        assert_ne!(&bytes[..6.min(bytes.len())], b"SORNG1");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ────────────────────────────────────────────────────────────────
    // SORNG1 → v2 backup migrator (`migrate_to_master_dek`)
    //
    // The advisor flagged backup migration as the prerequisite for
    // dropping the legacy SORNG1 read path. These tests prove the
    // wrong-password / locked-state / mixed-format / idempotency
    // properties the migrator must hold for that drop to be safe.
    // ────────────────────────────────────────────────────────────────

    /// Plant a hand-crafted SORNG1-format backup at the chosen
    /// destination, using the test-only `encrypt_backup_data` helper.
    /// Required after commit Y removed the legacy SORNG1 write path
    /// from `perform_backup` — migrator tests can no longer rely on
    /// the service to produce a SORNG1 fixture for them.
    fn plant_sorng1_fixture(
        svc: &BackupService,
        dir: &std::path::Path,
        payload: &serde_json::Value,
        password: &str,
        id_suffix: &str,
    ) -> std::path::PathBuf {
        let json = serde_json::to_string_pretty(payload).unwrap();
        let blob = svc
            .encrypt_backup_data(json.as_bytes(), password)
            .unwrap();
        let path = dir.join(format!("backup_manual_{}_legacy.json", id_suffix));
        std::fs::write(&path, &blob).unwrap();
        // Sidecar metadata mirroring what `perform_backup` would have
        // written, so `list_backups`/`restore` can locate the file by
        // its `id` field — required by the migrator round-trip
        // restore assertion.
        let meta = BackupMetadata {
            id: id_suffix.to_string(),
            created_at: 0,
            backup_type: "manual".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            checksum: String::new(),
            encrypted: true,
            compressed: false,
            size_bytes: blob.len() as u64,
            connections_count: 0,
            parent_backup_id: None,
            payload_hash: None,
            target_id: None,
        };
        let meta_path = dir.join(format!(
            "backup_manual_{}_legacy.json.meta.json",
            id_suffix
        ));
        std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).unwrap();
        path
    }

    fn count_files_with_prefix(dir: &std::path::Path, prefix: &[u8]) -> usize {
        let mut n = 0;
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("backup_") || name.contains(".meta.") {
                continue;
            }
            let bytes = std::fs::read(entry.path()).unwrap();
            if bytes.starts_with(prefix) {
                n += 1;
            }
        }
        n
    }

    #[tokio::test]
    async fn migrate_sorng1_to_v2_round_trips() {
        // Plant a SORNG1 fixture directly (the legacy write path was
        // removed in commit Y, so `perform_backup` no longer produces
        // SORNG1 files even with `encrypt_backups: true`), then run
        // the migrator. The on-disk file must end up as v2 and the
        // original archived as `.v0.bak`.
        let tmp = fresh_temp_dir("migrate_sorng1");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        svc.update_config(build_test_config(&tmp));

        let data = serde_json::json!({ "connections": [{ "id": "c1" }] });
        plant_sorng1_fixture(&svc, &tmp, &data, "hunter2", "abc123");
        assert_eq!(count_files_with_prefix(&tmp, b"SORNG1"), 1);
        assert_eq!(count_files_with_prefix(&tmp, sorng_encryption::envelope::MAGIC), 0);

        // Install master DEK and migrate.
        svc.set_encryption_state(unlocked_enc_state().await);
        let report = svc
            .migrate_to_master_dek(Some("hunter2"))
            .await
            .unwrap();
        assert_eq!(report.total, 1);
        assert_eq!(report.migrated, 1);
        assert_eq!(report.already_v2, 0);
        assert!(report.failed.is_empty());

        // On-disk: one v2 file + one .v0.bak archive.
        assert_eq!(count_files_with_prefix(&tmp, sorng_encryption::envelope::MAGIC), 1);
        let archive_count = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".v0.bak"))
            .count();
        assert_eq!(archive_count, 1);

        // Round-trip the v2 file through restore.
        let restored = svc
            .restore_backup_from_target("abc123", None)
            .await
            .unwrap();
        assert_eq!(restored, data);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn migrate_wrong_password_does_not_destroy_legacy_files() {
        // Safety-critical case: a wrong legacy password must not
        // rename or delete the source file. The user keeps their data
        // intact and can retry with the correct password.
        let tmp = fresh_temp_dir("migrate_wrong_pw");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        svc.update_config(build_test_config(&tmp));

        let data = serde_json::json!({ "connections": [] });
        plant_sorng1_fixture(&svc, &tmp, &data, "correct", "wp1");
        let pre_bytes: Vec<Vec<u8>> = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();

        svc.set_encryption_state(unlocked_enc_state().await);
        let report = svc.migrate_to_master_dek(Some("WRONG")).await.unwrap();
        // Reported as failed, not migrated.
        assert_eq!(report.total, 1);
        assert_eq!(report.migrated, 0);
        assert_eq!(report.failed.len(), 1);

        // Source byte-identical, no .v0.bak created.
        let post_bytes: Vec<Vec<u8>> = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();
        assert_eq!(pre_bytes, post_bytes);
        let archive_count = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".v0.bak"))
            .count();
        assert_eq!(archive_count, 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn migrate_already_v2_files_are_noop() {
        // A directory that already holds only v2 backups must report
        // `already_v2 == total` and leave the files byte-identical.
        let tmp = fresh_temp_dir("migrate_idempotent");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        svc.update_config(build_test_config(&tmp));
        svc.set_encryption_state(unlocked_enc_state().await);
        let _ = svc.perform_backup("manual", &serde_json::json!({})).await.unwrap();
        let snapshot: Vec<Vec<u8>> = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();

        let report = svc.migrate_to_master_dek(None).await.unwrap();
        assert_eq!(report.migrated, 0);
        assert_eq!(report.already_v2, 1);
        assert!(report.failed.is_empty());

        let after: Vec<Vec<u8>> = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();
        assert_eq!(snapshot, after);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn migrate_plaintext_backups_to_v2() {
        // A user who wrote backups with `encrypt_backups = false`
        // ends up with plain JSON / gzipped files. The migrator
        // accepts them with no legacy password and wraps them under
        // the v2 envelope.
        let tmp = fresh_temp_dir("migrate_plain");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        svc.update_config(build_test_config(&tmp)); // encrypt off, compress off
        let _ = svc
            .perform_backup("manual", &serde_json::json!({ "connections": [] }))
            .await
            .unwrap();
        assert_eq!(count_files_with_prefix(&tmp, sorng_encryption::envelope::MAGIC), 0);

        svc.set_encryption_state(unlocked_enc_state().await);
        let report = svc.migrate_to_master_dek(None).await.unwrap();
        assert_eq!(report.migrated, 1);
        assert!(report.bytes_in > 0);
        assert!(report.bytes_out >= report.bytes_in, "envelope adds overhead");
        assert_eq!(count_files_with_prefix(&tmp, sorng_encryption::envelope::MAGIC), 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn migrate_mixed_directory_reports_per_file_outcomes() {
        // Mix of SORNG1 + plaintext + already-v2 in the same target
        // directory. The migrator processes each per its kind without
        // bailing on the first non-trivial case.
        let tmp = fresh_temp_dir("migrate_mixed");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;

        // 1. Write a plaintext backup (no password, no state).
        let mut cfg = build_test_config(&tmp);
        svc.update_config(cfg.clone());
        let _ = svc
            .perform_backup("manual", &serde_json::json!({ "id": 1 }))
            .await
            .unwrap();

        // 2. Write a SORNG1 backup with a password.
        cfg.encrypt_backups = true;
        cfg.encryption_password = Some("legacypw".to_string());
        svc.update_config(cfg.clone());
        let _ = svc
            .perform_backup("manual", &serde_json::json!({ "id": 2 }))
            .await
            .unwrap();

        // 3. Install master DEK and write a v2 backup.
        svc.set_encryption_state(unlocked_enc_state().await);
        let _ = svc
            .perform_backup("manual", &serde_json::json!({ "id": 3 }))
            .await
            .unwrap();

        // Pre-migration: 1 plain, 1 SORNG1, 1 v2.
        let total = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().into_owned();
                n.starts_with("backup_") && !n.contains(".meta.")
            })
            .count();
        assert_eq!(total, 3);

        let report = svc
            .migrate_to_master_dek(Some("legacypw"))
            .await
            .unwrap();
        assert_eq!(report.total, 3);
        // 2 freshly migrated (plain + SORNG1), 1 already v2.
        assert_eq!(report.migrated, 2);
        assert_eq!(report.already_v2, 1);
        assert!(report.failed.is_empty());

        // Post-migration: 3 v2 + 2 .v0.bak archives.
        assert_eq!(count_files_with_prefix(&tmp, sorng_encryption::envelope::MAGIC), 3);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn migrate_requires_unlocked_state() {
        // Locked state must reject the migration before touching any
        // file — symmetric with the connections-side guarantee.
        let tmp = fresh_temp_dir("migrate_locked");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        svc.update_config(build_test_config(&tmp));
        let _ = svc
            .perform_backup("manual", &serde_json::json!({}))
            .await
            .unwrap();
        let pre_bytes: Vec<Vec<u8>> = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();

        let locked = std::sync::Arc::new(sorng_encryption::EncryptionState::new());
        svc.set_encryption_state(locked);
        let err = svc.migrate_to_master_dek(None).await.unwrap_err();
        assert!(err.contains("locked"));

        let post_bytes: Vec<Vec<u8>> = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| std::fs::read(e.path()).unwrap())
            .collect();
        assert_eq!(pre_bytes, post_bytes);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn migrate_skips_meta_sidecars() {
        // The per-target `.meta.json` sidecars are not encrypted
        // blobs — they must not be picked up by the migrator's scan.
        let tmp = fresh_temp_dir("migrate_meta");
        let state = BackupService::new(tmp.to_string_lossy().to_string());
        let mut svc = state.lock().await;
        svc.update_config(build_test_config(&tmp));
        let _ = svc
            .perform_backup("manual", &serde_json::json!({}))
            .await
            .unwrap();

        // Confirm the sidecar exists before migration.
        let sidecar_count = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".meta."))
            .count();
        assert_eq!(sidecar_count, 1);

        svc.set_encryption_state(unlocked_enc_state().await);
        let report = svc.migrate_to_master_dek(None).await.unwrap();
        // Only the data file counted; sidecar was not in `total`.
        assert_eq!(report.total, 1);

        // Sidecar still on disk untouched.
        let post_sidecar = std::fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".meta."))
            .count();
        assert_eq!(post_sidecar, 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }
}

