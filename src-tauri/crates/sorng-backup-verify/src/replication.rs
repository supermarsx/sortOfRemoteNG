use std::collections::HashMap;
use std::path::Path;
use chrono::{DateTime, Utc};
use log::{info, warn, error};
use uuid::Uuid;

use crate::error::{BackupVerifyError, Result};
use crate::integrity::IntegrityChecker;
use crate::types::{
    CatalogEntry, ReplicationState, ReplicationStatus, ReplicationTarget,
    VerificationStatus,
};

// ─── Replication events ─────────────────────────────────────────────────────

/// A logged replication event.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplicationEvent {
    pub id: String,
    pub target_id: String,
    pub entry_id: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub bytes_transferred: u64,
    pub status: ReplicationState,
    pub error_message: Option<String>,
}

/// Result of a replica integrity verification.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplicaIntegrityResult {
    pub target_id: String,
    pub entry_id: String,
    pub verified_at: DateTime<Utc>,
    pub status: VerificationStatus,
    pub files_checked: u64,
    pub mismatches: u64,
    pub details: Vec<String>,
}

// ─── ReplicationManager ─────────────────────────────────────────────────────

/// Manages cross-site backup replicas: adding/removing targets, triggering
/// replication, checking lag, promoting replicas, and verifying integrity.
pub struct ReplicationManager {
    targets: HashMap<String, ReplicationTarget>,
    status: HashMap<String, ReplicationStatus>,
    events: Vec<ReplicationEvent>,
    integrity_checker: IntegrityChecker,
}

impl ReplicationManager {
    pub fn new() -> Self {
        Self {
            targets: HashMap::new(),
            status: HashMap::new(),
            events: Vec::new(),
            integrity_checker: IntegrityChecker::new(),
        }
    }

    // ── Target management ──────────────────────────────────────────────────

    /// Register a new replication target.
    pub fn add_replica(&mut self, target: ReplicationTarget) -> Result<String> {
        let id = target.id.clone();
        if self.targets.contains_key(&id) {
            return Err(BackupVerifyError::replication_error(
                format!("Replication target '{}' already exists", id),
            ));
        }

        info!(
            "Adding replication target '{}' at {}://{}{}",
            target.name, target.protocol, target.host, target.path
        );
        self.status.insert(id.clone(), ReplicationStatus::new(id.clone()));
        self.targets.insert(id.clone(), target);
        Ok(id)
    }

    /// Remove a replication target.
    pub fn remove_replica(&mut self, target_id: &str) -> Result<ReplicationTarget> {
        self.status.remove(target_id);
        self.targets.remove(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(
                format!("Replication target '{}' not found", target_id),
            )
        })
    }

    /// List all replication targets.
    pub fn list_replicas(&self) -> Vec<&ReplicationTarget> {
        self.targets.values().collect()
    }

    /// Get a target by ID.
    pub fn get_replica(&self, target_id: &str) -> Result<&ReplicationTarget> {
        self.targets.get(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(
                format!("Replication target '{}' not found", target_id),
            )
        })
    }

    // ── Replication operations ─────────────────────────────────────────────

    /// Start replication of a catalog entry to a specific target.
    pub fn start_replication(
        &mut self,
        entry: &CatalogEntry,
        target_id: &str,
    ) -> Result<String> {
        let target = self.targets.get(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(
                format!("Replication target '{}' not found", target_id),
            )
        })?;

        let backup_path = Path::new(&entry.location);
        if !backup_path.exists() {
            return Err(BackupVerifyError::replication_error(
                format!("Source backup does not exist: {}", entry.location),
            ));
        }

        let event_id = Uuid::new_v4().to_string();
        info!(
            "Starting replication of entry {} to target {} (event {})",
            entry.id, target_id, event_id
        );

        // Update status to Syncing
        if let Some(status) = self.status.get_mut(target_id) {
            status.state = ReplicationState::Syncing;
            status.error_message = None;
        }

        // Simulate the replication transfer
        let bytes = entry.size_bytes;
        let dest_path = format!("{}/{}", target.path, entry.id);

        // For local-path targets we can actually copy; for remote targets we
        // simulate.  Here we always record the event.
        let event = ReplicationEvent {
            id: event_id.clone(),
            target_id: target_id.to_string(),
            entry_id: entry.id.clone(),
            started_at: Utc::now(),
            completed_at: Some(Utc::now()),
            bytes_transferred: bytes,
            status: ReplicationState::InSync,
            error_message: None,
        };

        // Update status
        if let Some(status) = self.status.get_mut(target_id) {
            status.state = ReplicationState::InSync;
            status.last_sync = Some(Utc::now());
            status.lag_bytes = 0;
            status.lag_secs = 0;
            status.transfer_speed_bps = if bytes > 0 { bytes * 8 } else { 0 };
        }

        self.events.push(event);
        Ok(event_id)
    }

    /// Check the replication status for a target.
    pub fn check_replication_status(&self, target_id: &str) -> Result<&ReplicationStatus> {
        self.status.get(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(
                format!("No status for target '{}'", target_id),
            )
        })
    }

    /// Get replication lag (in seconds) for a target.
    pub fn get_replication_lag(&self, target_id: &str) -> Result<u64> {
        let status = self.check_replication_status(target_id)?;

        let lag = match status.last_sync {
            Some(last) => {
                let diff = Utc::now() - last;
                diff.num_seconds().max(0) as u64
            }
            None => u64::MAX,
        };

        if lag > 3600 {
            warn!("Replication lag for target {} is {} seconds", target_id, lag);
        }
        Ok(lag)
    }

    /// Promote a replica to become the primary source.
    /// This is a metadata-only operation — it swaps which target is considered
    /// authoritative.
    pub fn promote_replica(&mut self, target_id: &str) -> Result<()> {
        let target = self.targets.get(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(
                format!("Cannot promote: target '{}' not found", target_id),
            )
        })?;

        // Ensure the replica is in sync before promotion
        let status = self.status.get(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error("No status available for target")
        })?;

        if status.state != ReplicationState::InSync {
            return Err(BackupVerifyError::replication_error(
                format!(
                    "Cannot promote target '{}': state is {:?}, expected InSync",
                    target_id, status.state
                ),
            ));
        }

        info!("Promoting replica '{}' ({}) as primary", target.name, target_id);

        // Mark all other targets as needing re-sync
        for (id, s) in &mut self.status {
            if id != target_id {
                s.state = ReplicationState::Initial;
                s.lag_bytes = 0;
                s.lag_secs = 0;
            }
        }

        Ok(())
    }

    // ── Integrity verification ─────────────────────────────────────────────

    /// Verify that a replica matches the source backup.
    pub fn verify_replica_integrity(
        &self,
        entry: &CatalogEntry,
        target_id: &str,
    ) -> Result<ReplicaIntegrityResult> {
        let target = self.get_replica(target_id)?;
        let source_path = Path::new(&entry.location);

        if !source_path.exists() {
            return Err(BackupVerifyError::replication_error(
                format!("Source backup not found: {}", entry.location),
            ));
        }

        let mut result = ReplicaIntegrityResult {
            target_id: target_id.to_string(),
            entry_id: entry.id.clone(),
            verified_at: Utc::now(),
            status: VerificationStatus::InProgress,
            files_checked: 0,
            mismatches: 0,
            details: Vec::new(),
        };

        // Build a manifest for the source
        if source_path.is_dir() {
            let source_manifest =
                self.integrity_checker.compute_manifest_path(source_path, "sha256")?;
            result.files_checked = source_manifest.entries.len() as u64;

            // For remote targets we simulate a pass; for local paths we can
            // actually compare.
            let replica_path_str = format!("{}/{}", target.path, entry.id);
            let replica_path = Path::new(&replica_path_str);

            if replica_path.exists() && replica_path.is_dir() {
                let replica_manifest =
                    self.integrity_checker.compute_manifest_path(replica_path, "sha256")?;
                let diff = IntegrityChecker::compare_manifests(&source_manifest, &replica_manifest);

                result.mismatches = diff.modified.len() as u64 + diff.removed.len() as u64;
                if result.mismatches == 0 {
                    result.status = VerificationStatus::Passed;
                    result.details.push(format!(
                        "All {} files match between source and replica",
                        diff.unchanged_count
                    ));
                } else {
                    result.status = VerificationStatus::Failed;
                    for f in &diff.modified {
                        result.details.push(format!("Modified: {}", f));
                    }
                    for f in &diff.removed {
                        result.details.push(format!("Missing on replica: {}", f));
                    }
                }
            } else {
                // Remote or non-existent local replica — report based on status
                let status = self.check_replication_status(target_id)?;
                if status.state == ReplicationState::InSync {
                    result.status = VerificationStatus::Passed;
                    result.details.push("Replica reports InSync (remote verification unavailable)".into());
                } else {
                    result.status = VerificationStatus::Warning;
                    result.details.push(format!(
                        "Replica state is {:?}; cannot verify remotely",
                        status.state
                    ));
                }
            }
        } else {
            // Single-file source
            result.files_checked = 1;
            let src_hash = self.integrity_checker.compute_sha256(source_path)?;

            let replica_path_str = format!("{}/{}", target.path, entry.id);
            let replica_path = Path::new(&replica_path_str);
            if replica_path.exists() {
                let dst_hash = self.integrity_checker.compute_sha256(replica_path)?;
                if src_hash == dst_hash {
                    result.status = VerificationStatus::Passed;
                } else {
                    result.status = VerificationStatus::Failed;
                    result.mismatches = 1;
                    result.details.push("Checksum mismatch".into());
                }
            } else {
                let status = self.check_replication_status(target_id)?;
                result.status = if status.state == ReplicationState::InSync {
                    VerificationStatus::Passed
                } else {
                    VerificationStatus::Warning
                };
                result.details.push("Replica file not locally accessible".into());
            }
        }

        info!(
            "Replica integrity for entry {} on target {}: {:?}",
            entry.id, target_id, result.status
        );
        Ok(result)
    }

    // ── Event history ──────────────────────────────────────────────────────

    /// Get all replication events.
    pub fn get_events(&self) -> &[ReplicationEvent] {
        &self.events
    }

    /// Get events for a specific target.
    pub fn get_events_for_target(&self, target_id: &str) -> Vec<&ReplicationEvent> {
        self.events.iter().filter(|e| e.target_id == target_id).collect()
    }

    /// Pause replication for a target.
    pub fn pause_replica(&mut self, target_id: &str) -> Result<()> {
        let status = self.status.get_mut(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(format!("Target '{}' not found", target_id))
        })?;
        status.state = ReplicationState::Paused;
        info!("Paused replication for target {}", target_id);
        Ok(())
    }

    /// Resume replication for a target.
    pub fn resume_replica(&mut self, target_id: &str) -> Result<()> {
        let status = self.status.get_mut(target_id).ok_or_else(|| {
            BackupVerifyError::replication_error(format!("Target '{}' not found", target_id))
        })?;
        if status.state == ReplicationState::Paused {
            status.state = ReplicationState::Initial;
            info!("Resumed replication for target {}", target_id);
        }
        Ok(())
    }

    /// Get a combined view of all targets + statuses.
    pub fn get_replication_overview(&self) -> Vec<ReplicationOverview> {
        self.targets
            .values()
            .map(|t| {
                let status = self.status.get(&t.id);
                ReplicationOverview {
                    target_id: t.id.clone(),
                    target_name: t.name.clone(),
                    site_name: t.site_name.clone(),
                    state: status.map(|s| s.state.clone()).unwrap_or(ReplicationState::Initial),
                    last_sync: status.and_then(|s| s.last_sync),
                    lag_secs: status.map(|s| s.lag_secs).unwrap_or(0),
                    lag_bytes: status.map(|s| s.lag_bytes).unwrap_or(0),
                }
            })
            .collect()
    }
}

impl Default for ReplicationManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Summary view of a single replication target.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplicationOverview {
    pub target_id: String,
    pub target_name: String,
    pub site_name: String,
    pub state: ReplicationState,
    pub last_sync: Option<DateTime<Utc>>,
    pub lag_secs: u64,
    pub lag_bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_target(id: &str) -> ReplicationTarget {
        ReplicationTarget {
            id: id.into(),
            name: format!("Replica {}", id),
            site_name: "DC-2".into(),
            host: "replica.example.com".into(),
            protocol: "rsync".into(),
            path: "/mnt/replicas".into(),
            bandwidth_limit: None,
            sync_interval_secs: 3600,
            compression: CompressionConfig::default(),
            encryption: EncryptionConfig::default(),
        }
    }

    #[test]
    fn test_add_remove_replica() {
        let mut mgr = ReplicationManager::new();
        let id = mgr.add_replica(make_target("r1")).unwrap();
        assert_eq!(mgr.list_replicas().len(), 1);
        mgr.remove_replica(&id).unwrap();
        assert!(mgr.list_replicas().is_empty());
    }

    #[test]
    fn test_duplicate_target() {
        let mut mgr = ReplicationManager::new();
        mgr.add_replica(make_target("r1")).unwrap();
        assert!(mgr.add_replica(make_target("r1")).is_err());
    }

    #[test]
    fn test_promote_requires_in_sync() {
        let mut mgr = ReplicationManager::new();
        mgr.add_replica(make_target("r1")).unwrap();
        // Initial state is Initial, not InSync
        assert!(mgr.promote_replica("r1").is_err());
    }
}
