use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::catalog::BackupCatalog;
use crate::compliance::ComplianceReporter;
use crate::dr_testing::DrTestEngine;
use crate::error::Result;
use crate::integrity::IntegrityChecker;
use crate::notifications::NotificationDispatcher;
use crate::policies::PolicyManager;
use crate::replication::ReplicationManager;
use crate::retention::RetentionEngine;
use crate::scheduler::BackupScheduler;
use crate::types::*;
use crate::verification::VerificationEngine;

// ─── State alias ────────────────────────────────────────────────────────────

pub type BackupVerifyServiceState = Arc<Mutex<BackupVerifyService>>;

pub fn new_state() -> BackupVerifyServiceState {
    Arc::new(Mutex::new(BackupVerifyService::new()))
}

// ─── BackupVerifyService ────────────────────────────────────────────────────

/// Façade that ties together every subsystem of the backup-verify crate.
pub struct BackupVerifyService {
    pub catalog: BackupCatalog,
    pub policies: PolicyManager,
    pub scheduler: BackupScheduler,
    pub verification: VerificationEngine,
    pub integrity: IntegrityChecker,
    pub dr_testing: DrTestEngine,
    pub compliance: ComplianceReporter,
    pub replication: ReplicationManager,
    pub retention: RetentionEngine,
    pub notifications: NotificationDispatcher,
}

impl BackupVerifyService {
    pub fn new() -> Self {
        let data_dir = dirs_data_path();
        Self {
            catalog: BackupCatalog::new(data_dir.join("catalog.json")),
            policies: PolicyManager::new(),
            scheduler: BackupScheduler::new(),
            verification: VerificationEngine::new(),
            integrity: IntegrityChecker::new(),
            dr_testing: DrTestEngine::new(),
            compliance: ComplianceReporter::new(),
            replication: ReplicationManager::new(),
            retention: RetentionEngine::new(),
            notifications: NotificationDispatcher::new(),
        }
    }

    /// Create with a custom data directory (for testing / portable installs).
    pub fn with_data_dir(data_dir: PathBuf) -> Self {
        Self {
            catalog: BackupCatalog::new(data_dir.join("catalog.json")),
            policies: PolicyManager::new(),
            scheduler: BackupScheduler::new(),
            verification: VerificationEngine::new(),
            integrity: IntegrityChecker::new(),
            dr_testing: DrTestEngine::new(),
            compliance: ComplianceReporter::new(),
            replication: ReplicationManager::new(),
            retention: RetentionEngine::new(),
            notifications: NotificationDispatcher::new(),
        }
    }

    // ── Overview ───────────────────────────────────────────────────────────

    /// Build a high-level overview of the backup system state.
    pub fn get_overview(&self) -> BackupOverview {
        let all_policies = self.policies.list_policies();
        let all_entries = self.catalog.list_entries(None, None, None, None);

        let total_size: u64 = all_entries.iter().map(|e| e.size_bytes).sum();
        let last_backup = all_entries.iter().map(|e| e.timestamp).max();
        let verified_24h = all_entries
            .iter()
            .filter(|e| {
                e.verified
                    && e.verification_result
                        .as_ref()
                        .map(|v| v.verified_at > Utc::now() - Duration::hours(24))
                        .unwrap_or(false)
            })
            .count() as u32;

        BackupOverview {
            total_policies: all_policies.len() as u32,
            active_policies: self.policies.active_count() as u32,
            total_catalog_entries: all_entries.len() as u64,
            total_size_bytes: total_size,
            last_backup_at: last_backup,
            next_backup_at: None, // calculated from scheduler if needed
            failed_last_24h: self.scheduler.failed_in_last_hours(24),
            verified_last_24h: verified_24h,
            storage_used_bytes: total_size,
            storage_available_bytes: 0,
            compliance_score: None,
        }
    }

    // ── Policy helpers ─────────────────────────────────────────────────────

    pub fn create_policy(&mut self, policy: BackupPolicy) -> Result<String> {
        self.policies.create_policy(policy)
    }

    pub fn update_policy(&mut self, policy: BackupPolicy) -> Result<()> {
        self.policies.update_policy(policy)
    }

    pub fn delete_policy(&mut self, policy_id: &str) -> Result<BackupPolicy> {
        self.policies.delete_policy(policy_id)
    }

    pub fn get_policy(&self, policy_id: &str) -> Result<&BackupPolicy> {
        self.policies.get_policy(policy_id)
    }

    pub fn list_policies(&self) -> Vec<&BackupPolicy> {
        self.policies.list_policies()
    }

    // ── Catalog helpers ────────────────────────────────────────────────────

    pub fn add_catalog_entry(&mut self, entry: CatalogEntry) -> Result<String> {
        self.catalog.add_entry(entry)
    }

    pub fn get_catalog_entry(&self, entry_id: &str) -> Result<&CatalogEntry> {
        self.catalog.get_entry(entry_id)
    }

    pub fn list_catalog_entries(
        &self,
        policy_id: Option<&str>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Vec<&CatalogEntry> {
        self.catalog.list_entries(policy_id, None, from, to)
    }

    pub fn delete_catalog_entry(&mut self, entry_id: &str) -> Result<CatalogEntry> {
        self.catalog.delete_entry(entry_id)
    }

    // ── Verification helpers ───────────────────────────────────────────────

    pub fn verify_backup(
        &mut self,
        entry_id: &str,
        method: VerificationMethod,
    ) -> Result<VerificationResult> {
        let entry = self.catalog.get_entry(entry_id)?.clone();
        self.verification.verify_backup(&entry, method)
    }

    // ── Scheduler helpers ──────────────────────────────────────────────────

    pub fn trigger_backup(&mut self, policy_id: &str) -> Result<String> {
        let policy = self.policies.get_policy(policy_id)?;
        self.scheduler
            .trigger_manual_backup(policy_id, &policy.name)
    }

    pub fn cancel_job(&mut self, job_id: &str) -> Result<()> {
        self.scheduler.cancel_job(job_id)
    }

    pub fn list_running_jobs(&self) -> Vec<&BackupJob> {
        self.scheduler.list_running_jobs()
    }

    pub fn list_queued_jobs(&self) -> Vec<&BackupJob> {
        self.scheduler.list_queued_jobs()
    }

    pub fn get_job_history(&self, policy_id: &str, limit: usize) -> Vec<&BackupJob> {
        self.scheduler.get_job_history(policy_id, limit)
    }

    // ── Integrity helpers ──────────────────────────────────────────────────

    pub fn compute_sha256(&self, path: &str) -> Result<String> {
        self.integrity.compute_sha256(std::path::Path::new(path))
    }

    pub fn generate_manifest(&self, path: &str) -> Result<FileManifest> {
        self.integrity.generate_manifest(std::path::Path::new(path))
    }

    // ── DR testing helpers ─────────────────────────────────────────────────

    pub fn run_dr_drill(
        &mut self,
        policy_id: &str,
        entry_id: &str,
    ) -> Result<crate::dr_testing::DrDrillResult> {
        let policy = self.policies.get_policy(policy_id)?.clone();
        let entry = self.catalog.get_entry(entry_id)?.clone();
        let plan = self.dr_testing.create_drill_plan(&policy, &entry.location);
        self.dr_testing.run_dr_drill(&plan, &entry)
    }

    // ── Compliance helpers ─────────────────────────────────────────────────

    pub fn generate_compliance_report(
        &mut self,
        framework: ComplianceFramework,
        period_start: DateTime<Utc>,
        period_end: DateTime<Utc>,
    ) -> Result<ComplianceReport> {
        let policies: Vec<&BackupPolicy> = self.policies.list_policies();
        let entries: Vec<&CatalogEntry> = self.catalog.list_entries(None, None, None, None);
        let verifications = HashMap::new();
        self.compliance.generate_report(
            framework,
            period_start,
            period_end,
            &policies,
            &entries,
            &verifications,
        )
    }

    // ── Replication helpers ────────────────────────────────────────────────

    pub fn add_replication_target(&mut self, target: ReplicationTarget) -> Result<String> {
        self.replication.add_replica(target)
    }

    pub fn remove_replication_target(&mut self, target_id: &str) -> Result<ReplicationTarget> {
        self.replication.remove_replica(target_id)
    }

    pub fn list_replication_targets(&self) -> Vec<&ReplicationTarget> {
        self.replication.list_replicas()
    }

    pub fn start_replication(&mut self, entry_id: &str, target_id: &str) -> Result<String> {
        let entry = self.catalog.get_entry(entry_id)?.clone();
        self.replication.start_replication(&entry, target_id)
    }

    pub fn get_replication_status(&self, target_id: &str) -> Result<&ReplicationStatus> {
        self.replication.check_replication_status(target_id)
    }

    // ── Retention helpers ──────────────────────────────────────────────────

    pub fn enforce_retention(&mut self, policy_id: &str) -> Result<crate::retention::PurgeResult> {
        let policy = self.policies.get_policy(policy_id)?.clone();
        let entries = self.catalog.list_entries(Some(policy_id), None, None, None);
        self.retention.enforce_retention(&policy, &entries)
    }

    pub fn get_retention_forecast(&self) -> Vec<crate::retention::RetentionForecastEntry> {
        let entries = self.catalog.list_entries(None, None, None, None);
        self.retention.get_retention_forecast(&entries)
    }

    // ── Notification helpers ───────────────────────────────────────────────

    pub fn configure_notification_channels(&mut self, config: ChannelConfig) {
        self.notifications.configure_channels(config)
    }

    pub fn send_notification(
        &mut self,
        notification: &BackupNotification,
    ) -> Vec<crate::notifications::DispatchResult> {
        self.notifications.send_notification(notification)
    }

    /// Set the event emitter for frontend event dispatch.
    pub fn set_event_emitter(&mut self, emitter: sorng_core::events::DynEventEmitter) {
        self.notifications.set_event_emitter(emitter);
    }
}

impl Default for BackupVerifyService {
    fn default() -> Self {
        Self::new()
    }
}

/// Determine data directory for persisted state.
///
/// Production keeps the historical location, including the `SORNG_DATA_DIR`
/// override. An isolated app identity (e2e builds) resolves inside its own
/// local-data profile root, `<local data>/<identifier>/backup-verify`, and
/// ignores `SORNG_DATA_DIR`, so it never shares production state.
fn dirs_data_path() -> PathBuf {
    data_path_for(sorng_core::app_identity::current_identifier(), |key| {
        std::env::var(key).ok()
    })
}

fn data_path_for(identifier: &str, env: impl Fn(&str) -> Option<String>) -> PathBuf {
    let isolated = !sorng_core::app_identity::is_production(identifier);
    if !isolated {
        if let Some(dir) = env("SORNG_DATA_DIR") {
            return PathBuf::from(dir).join("backup-verify");
        }
    }
    let profile = if isolated { identifier } else { "sorng" };
    #[cfg(target_os = "windows")]
    let local_data = env("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let local_data = env("HOME").map(|home| PathBuf::from(home).join(".local").join("share"));
    match local_data {
        Some(root) => root.join(profile).join("backup-verify"),
        None if isolated => PathBuf::from(".")
            .join("sorng-data")
            .join(identifier)
            .join("backup-verify"),
        None => PathBuf::from(".").join("sorng-data").join("backup-verify"),
    }
}

#[cfg(test)]
mod data_path_tests {
    use super::{data_path_for, dirs_data_path};
    use sorng_core::app_identity::{self, PRODUCTION_IDENTIFIER};
    use std::collections::HashMap;
    use std::path::PathBuf;

    const E2E_IDENTIFIER: &str = "com.sortofremote.ng.e2e";

    /// The resolver as it was before app identities existed.
    fn legacy_data_path(env: impl Fn(&str) -> Option<String>) -> PathBuf {
        if let Some(dir) = env("SORNG_DATA_DIR") {
            return PathBuf::from(dir).join("backup-verify");
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(appdata) = env("LOCALAPPDATA") {
                return PathBuf::from(appdata).join("sorng").join("backup-verify");
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Some(home) = env("HOME") {
                return PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join("sorng")
                    .join("backup-verify");
            }
        }
        PathBuf::from(".").join("sorng-data").join("backup-verify")
    }

    fn fixture(name: &str) -> String {
        std::env::temp_dir()
            .join("sorng-backup-verify-paths")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn env_from(pairs: &[(&str, String)]) -> impl Fn(&str) -> Option<String> {
        let vars: HashMap<String, String> = pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone()))
            .collect();
        move |key| vars.get(key).cloned()
    }

    fn env_matrix() -> Vec<Vec<(&'static str, String)>> {
        vec![
            vec![],
            vec![("SORNG_DATA_DIR", fixture("override"))],
            vec![
                ("LOCALAPPDATA", fixture("local")),
                ("HOME", fixture("home")),
            ],
            vec![
                ("SORNG_DATA_DIR", fixture("override")),
                ("LOCALAPPDATA", fixture("local")),
                ("HOME", fixture("home")),
            ],
            vec![("LOCALAPPDATA", String::new()), ("HOME", String::new())],
        ]
    }

    #[test]
    fn production_identity_matches_the_legacy_resolver_byte_for_byte() {
        for pairs in env_matrix() {
            let env = env_from(&pairs);
            assert_eq!(
                data_path_for(PRODUCTION_IDENTIFIER, &env)
                    .as_os_str()
                    .as_encoded_bytes(),
                legacy_data_path(&env).as_os_str().as_encoded_bytes(),
                "{pairs:?}"
            );
        }
        assert_eq!(
            data_path_for(
                PRODUCTION_IDENTIFIER,
                env_from(&[("SORNG_DATA_DIR", fixture("override"))])
            ),
            PathBuf::from(fixture("override")).join("backup-verify")
        );
    }

    #[test]
    fn uninstalled_process_identity_resolves_the_production_location() {
        // Nothing in this test binary installs an app identity.
        assert_eq!(
            dirs_data_path().as_os_str().as_encoded_bytes(),
            legacy_data_path(|key| std::env::var(key).ok())
                .as_os_str()
                .as_encoded_bytes()
        );
    }

    #[test]
    fn isolated_identity_resolves_inside_its_profile_root_and_ignores_the_override() {
        let env = env_from(&[
            ("SORNG_DATA_DIR", fixture("override")),
            ("LOCALAPPDATA", fixture("local")),
            ("HOME", fixture("home")),
        ]);
        #[cfg(target_os = "windows")]
        let local_data = PathBuf::from(fixture("local"));
        #[cfg(not(target_os = "windows"))]
        let local_data = PathBuf::from(fixture("home")).join(".local").join("share");

        let resolved = data_path_for(E2E_IDENTIFIER, &env);
        assert_eq!(
            resolved,
            local_data.join(E2E_IDENTIFIER).join("backup-verify")
        );
        app_identity::verify_isolated_dir(&resolved, E2E_IDENTIFIER)
            .expect("isolated backup-verify state must not alias production state");
        assert!(!resolved.starts_with(fixture("override")));
        assert_ne!(resolved, data_path_for(PRODUCTION_IDENTIFIER, &env));
    }

    #[test]
    fn isolated_identity_without_a_home_stays_under_its_identifier() {
        assert_eq!(
            data_path_for(
                E2E_IDENTIFIER,
                env_from(&[("SORNG_DATA_DIR", fixture("override"))])
            ),
            PathBuf::from(".")
                .join("sorng-data")
                .join(E2E_IDENTIFIER)
                .join("backup-verify")
        );
    }
}
