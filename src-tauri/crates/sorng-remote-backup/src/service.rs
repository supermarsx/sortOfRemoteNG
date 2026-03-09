//! Service façade — central orchestrator for backup jobs, execution, and progress.

use crate::error::BackupError;
use crate::progress::ProgressTracker;
use crate::types::{
    BackupExecutionRecord, BackupJob, BackupJobStatus, BackupProgress, BackupTool, ToolInfo,
};
use chrono::Utc;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// The primary service for managing backup jobs.
pub struct RemoteBackupService {
    /// Registered backup jobs
    pub jobs: HashMap<String, BackupJob>,
    /// Execution history
    pub history: Vec<BackupExecutionRecord>,
    /// Currently-running job IDs
    pub running: HashMap<String, tokio::task::JoinHandle<()>>,
    /// Progress tracker
    pub progress: ProgressTracker,
    /// Max history records to retain in-memory
    pub max_history: usize,
}

/// Thread-safe state handle for Tauri managed state.
pub type RemoteBackupServiceState = Arc<Mutex<RemoteBackupService>>;

impl RemoteBackupService {
    pub fn new() -> RemoteBackupServiceState {
        Arc::new(Mutex::new(Self {
            jobs: HashMap::new(),
            history: Vec::new(),
            running: HashMap::new(),
            progress: ProgressTracker::new(),
            max_history: 1000,
        }))
    }

    // ─── Job CRUD ───────────────────────────────────────────────

    /// Add a new backup job.
    pub fn add_job(&mut self, mut job: BackupJob) -> Result<String, BackupError> {
        if job.id.is_empty() {
            job.id = Uuid::new_v4().to_string();
        }
        let id = job.id.clone();
        job.created_at = Utc::now();
        job.updated_at = Utc::now();
        info!("Adding backup job: {} ({})", job.name, id);
        self.jobs.insert(id.clone(), job);
        Ok(id)
    }

    /// Update an existing backup job.
    pub fn update_job(&mut self, job: BackupJob) -> Result<(), BackupError> {
        if !self.jobs.contains_key(&job.id) {
            return Err(BackupError::JobNotFound(job.id.clone()));
        }
        if self.running.contains_key(&job.id) {
            return Err(BackupError::JobAlreadyRunning(job.id.clone()));
        }
        let mut updated = job;
        updated.updated_at = Utc::now();
        self.jobs.insert(updated.id.clone(), updated);
        Ok(())
    }

    /// Remove a backup job by ID.
    pub fn remove_job(&mut self, id: &str) -> Result<BackupJob, BackupError> {
        if self.running.contains_key(id) {
            return Err(BackupError::JobAlreadyRunning(id.to_string()));
        }
        self.jobs
            .remove(id)
            .ok_or_else(|| BackupError::JobNotFound(id.to_string()))
    }

    /// Get a job by ID.
    pub fn get_job(&self, id: &str) -> Result<&BackupJob, BackupError> {
        self.jobs
            .get(id)
            .ok_or_else(|| BackupError::JobNotFound(id.to_string()))
    }

    /// List all jobs, optionally filtered by tags or status.
    pub fn list_jobs(
        &self,
        tag_filter: Option<&str>,
        status_filter: Option<&BackupJobStatus>,
    ) -> Vec<&BackupJob> {
        self.jobs
            .values()
            .filter(|j| {
                if let Some(tag) = tag_filter {
                    if !j.tags.iter().any(|t| t == tag) {
                        return false;
                    }
                }
                if let Some(status) = status_filter {
                    if j.status != *status {
                        return false;
                    }
                }
                true
            })
            .collect()
    }

    // ─── Execution ──────────────────────────────────────────────

    /// Mark a job as running (called before spawning).
    pub fn mark_running(&mut self, id: &str) -> Result<(), BackupError> {
        let job = self
            .jobs
            .get_mut(id)
            .ok_or_else(|| BackupError::JobNotFound(id.to_string()))?;
        if job.status == BackupJobStatus::Running {
            return Err(BackupError::JobAlreadyRunning(id.to_string()));
        }
        job.status = BackupJobStatus::Running;
        job.last_run_at = Some(Utc::now());
        job.run_count += 1;
        Ok(())
    }

    /// Record the result of a job execution.
    pub fn record_execution(&mut self, record: BackupExecutionRecord) {
        let job_id = record.job_id.clone();
        let status = record.status.clone();

        // Update job status
        if let Some(job) = self.jobs.get_mut(&job_id) {
            job.status = status.clone();
            job.updated_at = Utc::now();
            if status == BackupJobStatus::Failed {
                job.fail_count += 1;
            }
            // Schedule next run if applicable
            if let Some(schedule) = &job.schedule {
                let now = Utc::now();
                if let Ok(next) = crate::scheduler::next_run(schedule, &now) {
                    job.next_run_at = Some(next);
                }
            }
        }

        // Remove from running set
        self.running.remove(&job_id);

        // Clean progress
        self.progress.remove(&job_id);

        // Store history (capped)
        self.history.push(record);
        if self.history.len() > self.max_history {
            self.history.remove(0);
        }
    }

    /// Cancel a running job.
    pub fn cancel_job(&mut self, id: &str) -> Result<(), BackupError> {
        if let Some(handle) = self.running.remove(id) {
            handle.abort();
            if let Some(job) = self.jobs.get_mut(id) {
                job.status = BackupJobStatus::Cancelled;
                job.updated_at = Utc::now();
            }
            self.progress.remove(id);
            info!("Cancelled backup job: {id}");
            Ok(())
        } else {
            Err(BackupError::JobNotFound(format!(
                "job {id} is not currently running"
            )))
        }
    }

    // ─── History & Progress ─────────────────────────────────────

    /// Get execution history for a job.
    pub fn job_history(&self, job_id: &str) -> Vec<&BackupExecutionRecord> {
        self.history.iter().filter(|r| r.job_id == job_id).collect()
    }

    /// Get all execution history.
    pub fn all_history(&self) -> &[BackupExecutionRecord] {
        &self.history
    }

    /// Get current progress for a job.
    pub fn job_progress(&self, job_id: &str) -> Option<&BackupProgress> {
        self.progress.get(job_id)
    }

    /// Update progress for a running job.
    pub fn update_progress(&mut self, progress: BackupProgress) {
        self.progress.update(progress);
    }

    // ─── Tool Detection ─────────────────────────────────────────

    /// Detect which backup tools are installed on the system.
    pub async fn detect_tools() -> Vec<ToolInfo> {
        let tools = vec![
            ("rsync", BackupTool::Rsync),
            ("rclone", BackupTool::Rclone),
            ("restic", BackupTool::Restic),
            ("borg", BackupTool::Borg),
            ("sftp", BackupTool::Sftp),
            ("scp", BackupTool::Scp),
            ("unison", BackupTool::Unison),
            ("duplicity", BackupTool::Duplicity),
        ];

        let mut results = Vec::new();

        for (binary, tool) in tools {
            let (installed, path, version) = detect_tool_binary(binary).await;
            results.push(ToolInfo {
                tool,
                installed,
                path,
                version,
            });
        }

        results
    }
}

/// Detect if a binary is available, returning (installed, path, version).
async fn detect_tool_binary(name: &str) -> (bool, Option<String>, Option<String>) {
    // Try `which`/`where` to find the binary
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let path_result = tokio::process::Command::new(which_cmd)
        .arg(name)
        .output()
        .await;

    match path_result {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();

            // Try to get version
            let version_flag = match name {
                "borg" => "--version",
                "rsync" | "rclone" | "restic" | "duplicity" => "--version",
                "unison" => "-version",
                _ => "--version",
            };

            let version = tokio::process::Command::new(name)
                .arg(version_flag)
                .output()
                .await
                .ok()
                .and_then(|o| {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() {
                        let s2 = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if s2.is_empty() {
                            None
                        } else {
                            Some(s2.lines().next().unwrap_or("").to_string())
                        }
                    } else {
                        Some(s.lines().next().unwrap_or("").to_string())
                    }
                });

            (true, Some(path), version)
        }
        _ => (false, None, None),
    }
}
