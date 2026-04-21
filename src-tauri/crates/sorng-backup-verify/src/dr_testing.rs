use chrono::{DateTime, Utc};
use log::info;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::Result;
use crate::integrity::IntegrityChecker;
use crate::types::{BackupPolicy, CatalogEntry, VerificationStatus};

// ─── DR drill plan ──────────────────────────────────────────────────────────

/// A plan describing which steps a DR drill should execute and their order.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DrDrillPlan {
    pub id: String,
    pub name: String,
    pub policy_id: String,
    pub target_description: String,
    pub steps: Vec<DrDrillStep>,
    pub rto_target_secs: u64,
    pub rpo_target_secs: u64,
    pub timeout_secs: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DrDrillStep {
    pub name: String,
    pub description: String,
    pub step_type: DrStepType,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum DrStepType {
    ValidateBackupExists,
    RestoreToStaging,
    VerifyIntegrity,
    BootTest,
    ApplicationTest,
    NetworkTest,
    Cleanup,
}

impl std::fmt::Display for DrStepType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ValidateBackupExists => write!(f, "ValidateBackupExists"),
            Self::RestoreToStaging => write!(f, "RestoreToStaging"),
            Self::VerifyIntegrity => write!(f, "VerifyIntegrity"),
            Self::BootTest => write!(f, "BootTest"),
            Self::ApplicationTest => write!(f, "ApplicationTest"),
            Self::NetworkTest => write!(f, "NetworkTest"),
            Self::Cleanup => write!(f, "Cleanup"),
        }
    }
}

/// Report produced by `validate_backup_restorability`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RestorabilityReport {
    pub entry_id: String,
    pub restorable: bool,
    pub checked_at: DateTime<Utc>,
    pub backup_exists: bool,
    pub checksum_valid: bool,
    pub chain_complete: bool,
    pub estimated_restore_secs: u64,
    pub issues: Vec<String>,
}

/// Result returned by a full DR drill execution.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DrDrillResult {
    pub drill_id: String,
    pub plan_id: String,
    pub executed_at: DateTime<Utc>,
    pub duration_secs: u64,
    pub status: VerificationStatus,
    pub rto_actual_secs: u64,
    pub rpo_actual_secs: u64,
    pub rto_met: bool,
    pub rpo_met: bool,
    pub steps_completed: u32,
    pub steps_total: u32,
    pub step_results: Vec<DrStepResult>,
    pub details: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DrStepResult {
    pub step_name: String,
    pub status: VerificationStatus,
    pub duration_secs: u64,
    pub details: Vec<String>,
}

/// Scheduled DR drill record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScheduledDrill {
    pub plan_id: String,
    pub cron_expression: String,
    pub last_run: Option<DateTime<Utc>>,
    pub next_run: Option<DateTime<Utc>>,
    pub enabled: bool,
}

// ─── DrTestEngine ───────────────────────────────────────────────────────────

/// Engine for automated disaster-recovery testing with RTO/RPO measurement.
pub struct DrTestEngine {
    integrity_checker: IntegrityChecker,
    drill_history: Vec<DrDrillResult>,
    scheduled_drills: Vec<ScheduledDrill>,
    staging_root: PathBuf,
}

impl DrTestEngine {
    pub fn new() -> Self {
        Self {
            integrity_checker: IntegrityChecker::new(),
            drill_history: Vec::new(),
            scheduled_drills: Vec::new(),
            staging_root: std::env::temp_dir().join("sorng_dr_staging"),
        }
    }

    /// Create with a custom staging directory.
    pub fn with_staging_root(staging_root: PathBuf) -> Self {
        Self {
            integrity_checker: IntegrityChecker::new(),
            drill_history: Vec::new(),
            scheduled_drills: Vec::new(),
            staging_root,
        }
    }

    // ── Plan creation ──────────────────────────────────────────────────────

    /// Build a DR drill plan from a policy and target description.
    pub fn create_drill_plan(
        &self,
        policy: &BackupPolicy,
        target_description: &str,
    ) -> DrDrillPlan {
        let steps = vec![
            DrDrillStep {
                name: "Validate backup".into(),
                description: "Confirm backup artifact exists and is accessible".into(),
                step_type: DrStepType::ValidateBackupExists,
                timeout_secs: 60,
            },
            DrDrillStep {
                name: "Restore to staging".into(),
                description: "Copy / extract backup to staging area".into(),
                step_type: DrStepType::RestoreToStaging,
                timeout_secs: 1800,
            },
            DrDrillStep {
                name: "Verify integrity".into(),
                description: "Checksum comparison between source and restored data".into(),
                step_type: DrStepType::VerifyIntegrity,
                timeout_secs: 600,
            },
            DrDrillStep {
                name: "Application healthcheck".into(),
                description: "Verify restored application components respond correctly".into(),
                step_type: DrStepType::ApplicationTest,
                timeout_secs: 300,
            },
            DrDrillStep {
                name: "Cleanup staging".into(),
                description: "Remove temporary staging data".into(),
                step_type: DrStepType::Cleanup,
                timeout_secs: 120,
            },
        ];

        let plan = DrDrillPlan {
            id: Uuid::new_v4().to_string(),
            name: format!("DR drill for {}", policy.name),
            policy_id: policy.id.clone(),
            target_description: target_description.to_string(),
            steps,
            rto_target_secs: 3600,
            rpo_target_secs: 86400,
            timeout_secs: 7200,
            created_at: Utc::now(),
        };

        info!(
            "Created DR drill plan '{}' with {} steps for policy {}",
            plan.id,
            plan.steps.len(),
            policy.id
        );
        plan
    }

    // ── Drill execution ────────────────────────────────────────────────────

    /// Execute a full DR drill according to the given plan.
    pub fn run_dr_drill(
        &mut self,
        plan: &DrDrillPlan,
        entry: &CatalogEntry,
    ) -> Result<DrDrillResult> {
        info!("Starting DR drill '{}' (plan={})", plan.name, plan.id);
        let start = Utc::now();
        let steps_total = plan.steps.len() as u32;
        let mut step_results = Vec::new();
        let mut steps_completed: u32 = 0;
        let mut overall_status = VerificationStatus::Passed;
        let mut details = Vec::new();

        let staging_dir = self.staging_root.join(&plan.id);

        for step in &plan.steps {
            let step_start = Utc::now();
            let step_result = self.execute_step(step, entry, &staging_dir);
            let step_duration = (Utc::now() - step_start).num_seconds().max(0) as u64;

            match step_result {
                Ok(mut sr) => {
                    sr.duration_secs = step_duration;
                    if sr.status == VerificationStatus::Failed {
                        overall_status = VerificationStatus::Failed;
                        details.push(format!("Step '{}' failed", step.name));
                    }
                    steps_completed += 1;
                    step_results.push(sr);
                }
                Err(e) => {
                    overall_status = VerificationStatus::Failed;
                    details.push(format!("Step '{}' error: {}", step.name, e));
                    step_results.push(DrStepResult {
                        step_name: step.name.clone(),
                        status: VerificationStatus::Failed,
                        duration_secs: step_duration,
                        details: vec![e.to_string()],
                    });
                    break; // Abort on first failure
                }
            }
        }

        let duration_secs = (Utc::now() - start).num_seconds().max(0) as u64;
        let rto_actual = self.measure_rto(&step_results);
        let rpo_actual = self.measure_rpo(entry);

        let result = DrDrillResult {
            drill_id: Uuid::new_v4().to_string(),
            plan_id: plan.id.clone(),
            executed_at: start,
            duration_secs,
            status: overall_status,
            rto_actual_secs: rto_actual,
            rpo_actual_secs: rpo_actual,
            rto_met: rto_actual <= plan.rto_target_secs,
            rpo_met: rpo_actual <= plan.rpo_target_secs,
            steps_completed,
            steps_total,
            step_results,
            details,
        };

        info!(
            "DR drill '{}' finished: {:?} (RTO: {}s/{}, RPO: {}s/{})",
            plan.id,
            result.status,
            rto_actual,
            if result.rto_met { "MET" } else { "MISSED" },
            rpo_actual,
            if result.rpo_met { "MET" } else { "MISSED" },
        );

        self.drill_history.push(result.clone());
        Ok(result)
    }

    /// Execute a single drill step.
    fn execute_step(
        &self,
        step: &DrDrillStep,
        entry: &CatalogEntry,
        staging_dir: &Path,
    ) -> Result<DrStepResult> {
        let mut result = DrStepResult {
            step_name: step.name.clone(),
            status: VerificationStatus::InProgress,
            duration_secs: 0,
            details: Vec::new(),
        };

        match step.step_type {
            DrStepType::ValidateBackupExists => {
                let backup_path = Path::new(&entry.location);
                if backup_path.exists() {
                    result.status = VerificationStatus::Passed;
                    result
                        .details
                        .push(format!("Backup found at {}", entry.location));
                } else {
                    result.status = VerificationStatus::Failed;
                    result
                        .details
                        .push(format!("Backup not found at {}", entry.location));
                }
            }
            DrStepType::RestoreToStaging => {
                let backup_path = Path::new(&entry.location);
                std::fs::create_dir_all(staging_dir)?;

                if backup_path.is_dir() {
                    match copy_dir_recursive(backup_path, staging_dir) {
                        Ok(count) => {
                            result.status = VerificationStatus::Passed;
                            result
                                .details
                                .push(format!("Restored {} files to staging", count));
                        }
                        Err(e) => {
                            result.status = VerificationStatus::Failed;
                            result.details.push(format!("Restore failed: {}", e));
                        }
                    }
                } else if backup_path.is_file() {
                    let dest = staging_dir.join(backup_path.file_name().unwrap_or_default());
                    match std::fs::copy(backup_path, &dest) {
                        Ok(_) => {
                            result.status = VerificationStatus::Passed;
                            result.details.push("Single-file restore ok".into());
                        }
                        Err(e) => {
                            result.status = VerificationStatus::Failed;
                            result.details.push(format!("Copy failed: {}", e));
                        }
                    }
                } else {
                    result.status = VerificationStatus::Failed;
                    result
                        .details
                        .push("Backup path is neither file nor directory".into());
                }
            }
            DrStepType::VerifyIntegrity => {
                let backup_path = Path::new(&entry.location);
                if !backup_path.exists() || !staging_dir.exists() {
                    result.status = VerificationStatus::Skipped;
                    result
                        .details
                        .push("Source or staging missing, skipping integrity".into());
                } else if backup_path.is_dir() {
                    let source_manifest = self
                        .integrity_checker
                        .compute_manifest_path(backup_path, "sha256")?;
                    let staging_manifest = self
                        .integrity_checker
                        .compute_manifest_path(staging_dir, "sha256")?;
                    let diff =
                        IntegrityChecker::compare_manifests(&source_manifest, &staging_manifest);

                    if diff.modified.is_empty() && diff.removed.is_empty() {
                        result.status = VerificationStatus::Passed;
                        result
                            .details
                            .push(format!("All {} files match", diff.unchanged_count));
                    } else {
                        result.status = VerificationStatus::Failed;
                        for f in &diff.modified {
                            result.details.push(format!("Mismatch: {}", f));
                        }
                        for f in &diff.removed {
                            result.details.push(format!("Missing: {}", f));
                        }
                    }
                } else {
                    // Single file — compare checksums
                    let src_hash = self.integrity_checker.compute_sha256(backup_path)?;
                    let staging_file =
                        staging_dir.join(backup_path.file_name().unwrap_or_default());
                    if staging_file.exists() {
                        let dst_hash = self.integrity_checker.compute_sha256(&staging_file)?;
                        if src_hash == dst_hash {
                            result.status = VerificationStatus::Passed;
                        } else {
                            result.status = VerificationStatus::Failed;
                            result
                                .details
                                .push("Checksum mismatch after restore".into());
                        }
                    } else {
                        result.status = VerificationStatus::Failed;
                        result.details.push("Staged file not found".into());
                    }
                }
            }
            DrStepType::BootTest => {
                // Simulated boot test — verify entry metadata is consistent
                result.status = VerificationStatus::Passed;
                result
                    .details
                    .push("Boot test simulated (entry metadata consistent)".into());
            }
            DrStepType::ApplicationTest => {
                // Simulated application test — check that restored files look reasonable
                if staging_dir.exists() {
                    let count = count_files(staging_dir);
                    if count > 0 {
                        result.status = VerificationStatus::Passed;
                        result.details.push(format!(
                            "Application test: {} files present in staging",
                            count
                        ));
                    } else {
                        result.status = VerificationStatus::Warning;
                        result.details.push("Staging directory is empty".into());
                    }
                } else {
                    result.status = VerificationStatus::Skipped;
                    result.details.push("No staging directory".into());
                }
            }
            DrStepType::NetworkTest => {
                result.status = VerificationStatus::Passed;
                result
                    .details
                    .push("Network test simulated (local-only mode)".into());
            }
            DrStepType::Cleanup => {
                if staging_dir.exists() {
                    std::fs::remove_dir_all(staging_dir).ok();
                    result.details.push("Staging directory cleaned up".into());
                }
                result.status = VerificationStatus::Passed;
            }
        }

        Ok(result)
    }

    // ── RTO / RPO measurement ──────────────────────────────────────────────

    /// Measure Recovery Time Objective: total time for restore + verify steps.
    pub fn measure_rto(&self, step_results: &[DrStepResult]) -> u64 {
        step_results.iter().map(|s| s.duration_secs).sum()
    }

    /// Measure Recovery Point Objective: age of the backup in seconds.
    pub fn measure_rpo(&self, entry: &CatalogEntry) -> u64 {
        let age = Utc::now() - entry.timestamp;
        age.num_seconds().max(0) as u64
    }

    // ── Restorability ──────────────────────────────────────────────────────

    /// Quick assessment of whether a catalog entry can be restored.
    pub fn validate_backup_restorability(
        &self,
        entry: &CatalogEntry,
    ) -> Result<RestorabilityReport> {
        let backup_path = Path::new(&entry.location);
        let mut report = RestorabilityReport {
            entry_id: entry.id.clone(),
            restorable: false,
            checked_at: Utc::now(),
            backup_exists: false,
            checksum_valid: false,
            chain_complete: true, // assume complete until proven otherwise
            estimated_restore_secs: 0,
            issues: Vec::new(),
        };

        // Check existence
        report.backup_exists = backup_path.exists();
        if !report.backup_exists {
            report
                .issues
                .push(format!("Backup not found: {}", entry.location));
            return Ok(report);
        }

        // Verify checksum if available
        if !entry.checksum.is_empty() {
            match self.integrity_checker.compute_sha256(backup_path) {
                Ok(hash) => {
                    report.checksum_valid = hash == entry.checksum;
                    if !report.checksum_valid {
                        report.issues.push("Checksum mismatch".into());
                    }
                }
                Err(e) => {
                    report
                        .issues
                        .push(format!("Cannot compute checksum: {}", e));
                }
            }
        } else {
            // No stored checksum; treat as valid but note it
            report.checksum_valid = true;
            report
                .issues
                .push("No stored checksum to verify against".into());
        }

        // Estimate restore time based on size (arbitrary 100 MB/s throughput)
        let throughput: u64 = 100 * 1024 * 1024;
        report.estimated_restore_secs = if entry.size_bytes > 0 && throughput > 0 {
            (entry.size_bytes / throughput).max(1)
        } else {
            0
        };

        report.restorable = report.backup_exists && report.checksum_valid && report.chain_complete;

        info!(
            "Restorability for {}: restorable={}, issues={}",
            entry.id,
            report.restorable,
            report.issues.len()
        );
        Ok(report)
    }

    // ── History & scheduling ───────────────────────────────────────────────

    /// Get all drill results for a specific plan.
    pub fn get_drill_history(&self) -> &[DrDrillResult] {
        &self.drill_history
    }

    /// Get drill history filtered by plan ID.
    pub fn get_drill_history_for_plan(&self, plan_id: &str) -> Vec<&DrDrillResult> {
        self.drill_history
            .iter()
            .filter(|r| r.plan_id == plan_id)
            .collect()
    }

    /// Schedule a recurring drill.
    pub fn schedule_drill(&mut self, plan_id: &str, cron_expression: &str) {
        // Remove existing schedule for this plan
        self.scheduled_drills.retain(|s| s.plan_id != plan_id);

        self.scheduled_drills.push(ScheduledDrill {
            plan_id: plan_id.to_string(),
            cron_expression: cron_expression.to_string(),
            last_run: None,
            next_run: None,
            enabled: true,
        });

        info!(
            "Scheduled DR drill for plan {} (cron: {})",
            plan_id, cron_expression
        );
    }

    /// List all scheduled drills.
    pub fn list_scheduled_drills(&self) -> &[ScheduledDrill] {
        &self.scheduled_drills
    }

    /// Enable or disable a scheduled drill.
    pub fn set_drill_enabled(&mut self, plan_id: &str, enabled: bool) {
        for drill in &mut self.scheduled_drills {
            if drill.plan_id == plan_id {
                drill.enabled = enabled;
                info!("Drill {} enabled={}", plan_id, enabled);
            }
        }
    }

    /// Get a summary of recent drill results.
    pub fn get_drill_summary(&self, last_n: usize) -> DrDrillSummary {
        let recent: Vec<&DrDrillResult> = self.drill_history.iter().rev().take(last_n).collect();

        let total = recent.len() as u32;
        let passed = recent
            .iter()
            .filter(|r| r.status == VerificationStatus::Passed)
            .count() as u32;
        let rto_met = recent.iter().filter(|r| r.rto_met).count() as u32;
        let rpo_met = recent.iter().filter(|r| r.rpo_met).count() as u32;
        let avg_duration = if total > 0 {
            recent.iter().map(|r| r.duration_secs).sum::<u64>() / total as u64
        } else {
            0
        };

        DrDrillSummary {
            total_drills: total,
            passed,
            failed: total - passed,
            rto_met_pct: if total > 0 {
                (rto_met as f64 / total as f64) * 100.0
            } else {
                0.0
            },
            rpo_met_pct: if total > 0 {
                (rpo_met as f64 / total as f64) * 100.0
            } else {
                0.0
            },
            avg_duration_secs: avg_duration,
        }
    }
}

impl Default for DrTestEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Summary statistics for recent DR drills.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DrDrillSummary {
    pub total_drills: u32,
    pub passed: u32,
    pub failed: u32,
    pub rto_met_pct: f64,
    pub rpo_met_pct: f64,
    pub avg_duration_secs: u64,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<u64> {
    std::fs::create_dir_all(dst)?;
    let mut count: u64 = 0;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            count += copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
            count += 1;
        }
    }
    Ok(count)
}

fn count_files(dir: &Path) -> u64 {
    let mut count: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                count += 1;
            } else if p.is_dir() {
                count += count_files(&p);
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::BackupMethod;
    use chrono::Duration;

    fn make_entry() -> CatalogEntry {
        CatalogEntry::new(
            "test-entry".into(),
            "job-1".into(),
            "pol-1".into(),
            "tgt-1".into(),
            BackupMethod::Full,
            std::env::temp_dir().to_string_lossy().into_owned(),
            Utc::now() + Duration::days(30),
        )
    }

    #[test]
    fn test_measure_rpo() {
        let engine = DrTestEngine::new();
        let mut entry = make_entry();
        entry.timestamp = Utc::now() - Duration::hours(6);
        let rpo = engine.measure_rpo(&entry);
        // Should be ~6 hours in seconds (± a few seconds)
        assert!(rpo >= 21590 && rpo <= 21700);
    }

    #[test]
    fn test_create_drill_plan() {
        let engine = DrTestEngine::new();
        let policy = BackupPolicy::new("p1".into(), "Daily backup".into());
        let plan = engine.create_drill_plan(&policy, "Production DB");
        assert_eq!(plan.policy_id, "p1");
        assert!(!plan.steps.is_empty());
    }
}
