use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use chrono::{DateTime, Utc, Duration};
use log::{info, warn, error};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::{BackupVerifyError, Result};
use crate::types::{
    BackupJob, BackupJobState, BackupMethod, BackupPolicy, CatalogEntry,
};
use crate::catalog::BackupCatalog;
use crate::policies::{PolicyManager, calculate_next_run, is_in_blackout};

/// Backup job scheduler managing job queues, execution, and lifecycle.
pub struct BackupScheduler {
    running_jobs: HashMap<String, BackupJob>,
    queued_jobs: Vec<BackupJob>,
    job_history: HashMap<String, Vec<BackupJob>>,
    running: Arc<AtomicBool>,
    scheduler_handle: Option<tokio::task::JoinHandle<()>>,
    max_concurrent: u32,
}

impl BackupScheduler {
    pub fn new() -> Self {
        Self {
            running_jobs: HashMap::new(),
            queued_jobs: Vec::new(),
            job_history: HashMap::new(),
            running: Arc::new(AtomicBool::new(false)),
            scheduler_handle: None,
            max_concurrent: 4,
        }
    }

    /// Start the background scheduler loop.
    pub fn start_scheduler(
        running: Arc<AtomicBool>,
        policies: Arc<Mutex<PolicyManager>>,
        scheduler: Arc<Mutex<BackupScheduler>>,
        catalog: Arc<Mutex<BackupCatalog>>,
    ) -> tokio::task::JoinHandle<()> {
        running.store(true, Ordering::SeqCst);
        info!("Starting backup scheduler");

        tokio::spawn(async move {
            while running.load(Ordering::SeqCst) {
                // Check policies for due jobs
                {
                    let policies_lock = policies.lock().await;
                    let mut scheduler_lock = scheduler.lock().await;

                    for policy in policies_lock.list_policies() {
                        if !policy.enabled {
                            continue;
                        }
                        if is_in_blackout(&policy.schedule) {
                            continue;
                        }

                        // Check if a job is already running or queued for this policy
                        let already_active = scheduler_lock.running_jobs.values()
                            .any(|j| j.policy_id == policy.id)
                            || scheduler_lock.queued_jobs.iter()
                                .any(|j| j.policy_id == policy.id);

                        if already_active {
                            continue;
                        }

                        // Check if it's time to run
                        if let Ok(next_run) = calculate_next_run(&policy.schedule) {
                            let now = Utc::now();
                            let window = Duration::minutes(policy.schedule.start_window_minutes as i64);
                            if next_run <= now + window && next_run >= now - Duration::minutes(1) {
                                if let Err(e) = scheduler_lock.queue_job_internal(&policy.id, &policy.name) {
                                    warn!("Failed to queue job for policy {}: {}", policy.id, e);
                                }
                            }
                        }
                    }

                    // Promote queued jobs if under concurrency limit
                    scheduler_lock.promote_queued_jobs();
                }

                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            }
            info!("Backup scheduler stopped");
        })
    }

    /// Stop the scheduler.
    pub fn stop_scheduler(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.scheduler_handle.take() {
            handle.abort();
        }
        info!("Backup scheduler stop requested");
    }

    /// Manually trigger a backup for a given policy.
    pub fn trigger_manual_backup(&mut self, policy_id: &str, policy_name: &str) -> Result<String> {
        info!("Manual backup triggered for policy: {}", policy_id);
        self.queue_job_internal(policy_id, policy_name)
    }

    /// Queue a job for a specific policy.
    fn queue_job_internal(&mut self, policy_id: &str, policy_name: &str) -> Result<String> {
        let job_id = Uuid::new_v4().to_string();
        let location = format!("/backups/{}/{}", policy_id, job_id);
        let job = BackupJob::new(job_id.clone(), policy_id.to_string(), location);
        info!("Queuing backup job {} for policy {} ({})", job_id, policy_name, policy_id);
        self.queued_jobs.push(job);
        // Sort by priority (we'd need priority on the job, use insertion order for now)
        Ok(job_id)
    }

    /// Queue a job (public interface).
    pub fn queue_job(&mut self, policy_id: &str) -> Result<String> {
        self.queue_job_internal(policy_id, policy_id)
    }

    /// Execute a backup job — transitions from Queued to Running.
    pub fn run_job(&mut self, job_id: &str) -> Result<()> {
        // Find and remove from queue
        let pos = self.queued_jobs.iter().position(|j| j.id == job_id)
            .ok_or_else(|| BackupVerifyError::scheduler_error(
                format!("Job '{}' not found in queue", job_id),
            ))?;

        let mut job = self.queued_jobs.remove(pos);
        job.state = BackupJobState::Running;
        job.started_at = Some(Utc::now());
        info!("Starting backup job: {}", job_id);
        self.running_jobs.insert(job_id.to_string(), job);
        Ok(())
    }

    /// Get the status of a specific job.
    pub fn get_job_status(&self, job_id: &str) -> Result<&BackupJob> {
        // Check running jobs
        if let Some(job) = self.running_jobs.get(job_id) {
            return Ok(job);
        }
        // Check queued
        if let Some(job) = self.queued_jobs.iter().find(|j| j.id == job_id) {
            return Ok(job);
        }
        // Check history
        for jobs in self.job_history.values() {
            if let Some(job) = jobs.iter().find(|j| j.id == job_id) {
                return Ok(job);
            }
        }
        Err(BackupVerifyError::scheduler_error(
            format!("Job '{}' not found", job_id),
        ))
    }

    /// List all currently running jobs.
    pub fn list_running_jobs(&self) -> Vec<&BackupJob> {
        self.running_jobs.values().collect()
    }

    /// List all queued jobs.
    pub fn list_queued_jobs(&self) -> Vec<&BackupJob> {
        self.queued_jobs.iter().collect()
    }

    /// Cancel a job (remove from queue or mark running job as cancelled).
    pub fn cancel_job(&mut self, job_id: &str) -> Result<()> {
        // Try queue first
        if let Some(pos) = self.queued_jobs.iter().position(|j| j.id == job_id) {
            let mut job = self.queued_jobs.remove(pos);
            job.state = BackupJobState::Cancelled;
            job.completed_at = Some(Utc::now());
            self.add_to_history(job);
            info!("Cancelled queued job: {}", job_id);
            return Ok(());
        }

        // Try running
        if let Some(mut job) = self.running_jobs.remove(job_id) {
            job.state = BackupJobState::Cancelled;
            job.completed_at = Some(Utc::now());
            if let Some(started) = job.started_at {
                job.duration_secs = Some((Utc::now() - started).num_seconds() as u64);
            }
            self.add_to_history(job);
            info!("Cancelled running job: {}", job_id);
            return Ok(());
        }

        Err(BackupVerifyError::scheduler_error(
            format!("Job '{}' not found in queue or running", job_id),
        ))
    }

    /// Get job history for a specific policy.
    pub fn get_job_history(&self, policy_id: &str, limit: usize) -> Vec<&BackupJob> {
        self.job_history
            .get(policy_id)
            .map(|jobs| {
                let start = jobs.len().saturating_sub(limit);
                jobs[start..].iter().collect()
            })
            .unwrap_or_default()
    }

    /// Handle job completion — move to history and update stats.
    pub fn handle_job_completion(&mut self, job_id: &str, success: bool, size_bytes: u64, files_count: u64, error_msg: Option<String>) -> Result<BackupJob> {
        let mut job = self.running_jobs.remove(job_id).ok_or_else(|| {
            BackupVerifyError::scheduler_error(format!("Running job '{}' not found", job_id))
        })?;

        let now = Utc::now();
        job.completed_at = Some(now);
        if let Some(started) = job.started_at {
            let duration = (now - started).num_seconds() as u64;
            job.duration_secs = Some(duration);
            if duration > 0 {
                job.transfer_speed_bps = size_bytes * 8 / duration;
            }
        }
        job.size_bytes = size_bytes;
        job.files_count = files_count;

        if success {
            job.state = BackupJobState::Completed;
            info!("Job {} completed successfully: {} bytes, {} files", job_id, size_bytes, files_count);
        } else {
            job.state = BackupJobState::Failed;
            job.error_message = error_msg;
            warn!("Job {} failed: {:?}", job_id, job.error_message);
        }

        let finished_job = job.clone();
        self.add_to_history(job);
        Ok(finished_job)
    }

    /// Apply retry logic for a failed job.
    pub fn apply_retry_logic(&mut self, failed_job: &BackupJob, max_retries: u32, delay_secs: u64) -> Option<String> {
        // Count existing retries for this policy in history
        let retry_count = self.job_history
            .get(&failed_job.policy_id)
            .map(|jobs| {
                jobs.iter()
                    .rev()
                    .take(max_retries as usize + 1)
                    .filter(|j| j.state == BackupJobState::Failed)
                    .count()
            })
            .unwrap_or(0);

        if retry_count as u32 >= max_retries {
            warn!(
                "Max retries ({}) reached for policy {}, not retrying",
                max_retries, failed_job.policy_id
            );
            return None;
        }

        info!(
            "Scheduling retry {}/{} for policy {} (delay: {}s)",
            retry_count + 1,
            max_retries,
            failed_job.policy_id,
            delay_secs
        );

        match self.queue_job_internal(&failed_job.policy_id, &failed_job.policy_id) {
            Ok(job_id) => Some(job_id),
            Err(e) => {
                error!("Failed to queue retry: {}", e);
                None
            }
        }
    }

    /// Check if bandwidth limit allows a new job to proceed.
    pub fn bandwidth_throttle_check(&self, policy: &BackupPolicy) -> bool {
        if let Some(limit) = policy.bandwidth_limit {
            let current_bps: u64 = self.running_jobs.values()
                .filter(|j| j.policy_id == policy.id)
                .map(|j| j.transfer_speed_bps)
                .sum();
            if current_bps >= limit {
                warn!(
                    "Bandwidth limit reached for policy {}: {}bps >= {}bps",
                    policy.id, current_bps, limit
                );
                return false;
            }
        }
        true
    }

    /// Promote queued jobs to running if under concurrency limit.
    fn promote_queued_jobs(&mut self) {
        while (self.running_jobs.len() as u32) < self.max_concurrent && !self.queued_jobs.is_empty() {
            let mut job = self.queued_jobs.remove(0);
            job.state = BackupJobState::Running;
            job.started_at = Some(Utc::now());
            let job_id = job.id.clone();
            info!("Promoting queued job {} to running", job_id);
            self.running_jobs.insert(job_id, job);
        }
    }

    /// Add a completed/cancelled/failed job to history.
    fn add_to_history(&mut self, job: BackupJob) {
        let policy_id = job.policy_id.clone();
        self.job_history.entry(policy_id).or_default().push(job);
    }

    /// Get all job history across all policies.
    pub fn all_job_history(&self) -> Vec<&BackupJob> {
        self.job_history.values().flat_map(|v| v.iter()).collect()
    }

    /// Count failed jobs in the last N hours.
    pub fn failed_in_last_hours(&self, hours: i64) -> u32 {
        let cutoff = Utc::now() - Duration::hours(hours);
        self.job_history.values()
            .flat_map(|v| v.iter())
            .filter(|j| {
                j.state == BackupJobState::Failed
                    && j.completed_at.map(|t| t > cutoff).unwrap_or(false)
            })
            .count() as u32
    }

    /// Set maximum concurrent jobs.
    pub fn set_max_concurrent(&mut self, max: u32) {
        self.max_concurrent = max.max(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_and_run_job() {
        let mut scheduler = BackupScheduler::new();
        let job_id = scheduler.queue_job("p1").unwrap();
        assert_eq!(scheduler.queued_jobs.len(), 1);
        assert_eq!(scheduler.running_jobs.len(), 0);

        scheduler.run_job(&job_id).unwrap();
        assert_eq!(scheduler.queued_jobs.len(), 0);
        assert_eq!(scheduler.running_jobs.len(), 1);

        let job = scheduler.get_job_status(&job_id).unwrap();
        assert_eq!(job.state, BackupJobState::Running);
    }

    #[test]
    fn test_cancel_queued_job() {
        let mut scheduler = BackupScheduler::new();
        let job_id = scheduler.queue_job("p1").unwrap();
        scheduler.cancel_job(&job_id).unwrap();
        assert!(scheduler.queued_jobs.is_empty());
        let history = scheduler.get_job_history("p1", 10);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].state, BackupJobState::Cancelled);
    }

    #[test]
    fn test_job_completion() {
        let mut scheduler = BackupScheduler::new();
        let job_id = scheduler.queue_job("p1").unwrap();
        scheduler.run_job(&job_id).unwrap();
        let job = scheduler.handle_job_completion(&job_id, true, 1024, 10, None).unwrap();
        assert_eq!(job.state, BackupJobState::Completed);
        assert_eq!(job.size_bytes, 1024);
        assert!(scheduler.running_jobs.is_empty());
    }

    #[test]
    fn test_promote_queued() {
        let mut scheduler = BackupScheduler::new();
        scheduler.set_max_concurrent(2);
        scheduler.queue_job("p1").unwrap();
        scheduler.queue_job("p2").unwrap();
        scheduler.queue_job("p3").unwrap();
        scheduler.promote_queued_jobs();
        assert_eq!(scheduler.running_jobs.len(), 2);
        assert_eq!(scheduler.queued_jobs.len(), 1);
    }
}
