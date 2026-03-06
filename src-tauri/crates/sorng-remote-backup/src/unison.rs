//! Unison wrapper — profile management, bidirectional sync, conflict handling.

use crate::error::BackupError;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool,
    UnisonConfig, UnisonConflictPolicy,
};
use chrono::Utc;
use log::{debug, error, info};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build unison argument vector from config.
pub fn build_args(cfg: &UnisonConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // If using a named profile, pass it first
    if let Some(profile) = &cfg.profile {
        args.push(profile.clone());
    } else {
        // Root1 and Root2
        args.push(cfg.root1.clone());
        args.push(cfg.root2.clone());
    }

    // Specific paths within roots
    for p in &cfg.paths {
        args.push("-path".into());
        args.push(p.clone());
    }

    // Ignore patterns
    for ig in &cfg.ignore {
        args.push("-ignore".into());
        args.push(format!("Name {ig}"));
    }

    // Force direction
    if let Some(force) = &cfg.force {
        args.push("-force".into());
        args.push(force.clone());
    }

    // Prefer on conflict
    if let Some(prefer) = &cfg.prefer {
        match prefer {
            UnisonConflictPolicy::Newer => {
                args.push("-prefer".into());
                args.push("newer".into());
            }
            UnisonConflictPolicy::PreferSource => {
                args.push("-prefer".into());
                args.push(cfg.root1.clone());
            }
            UnisonConflictPolicy::PreferDest => {
                args.push("-prefer".into());
                args.push(cfg.root2.clone());
            }
            UnisonConflictPolicy::Skip => {
                args.push("-prefer".into());
                args.push("skip".into());
            }
            UnisonConflictPolicy::Ask => {} // default behavior
        }
    }

    // Batch/auto modes
    if cfg.batch {
        args.push("-batch".into());
    }
    if cfg.auto {
        args.push("-auto".into());
    }

    // Performance
    if cfg.fastcheck {
        args.push("-fastcheck".into());
        args.push("true".into());
    }

    // Permissions
    if cfg.perms {
        args.push("-perms".into());
        args.push("-1".into()); // synchronize permissions
    }
    if cfg.owner {
        args.push("-owner".into());
    }
    if cfg.group {
        args.push("-group".into());
    }

    // Logging
    if let Some(logfile) = &cfg.log_file {
        args.push("-logfile".into());
        args.push(logfile.clone());
    }

    // SSH transport
    if let Some(ssh) = &cfg.ssh {
        args.push("-sshargs".into());
        let mut ssh_args = Vec::new();
        ssh_args.push(format!("-p {}", ssh.port));
        if let Some(key) = &ssh.private_key_path {
            ssh_args.push(format!("-i {key}"));
        }
        if ssh.compression {
            ssh_args.push("-C".to_string());
        }
        for (k, v) in &ssh.ssh_options {
            ssh_args.push(format!("-o {k}={v}"));
        }
        args.push(ssh_args.join(" "));
    }

    // Extra args
    for a in &cfg.extra_args {
        args.push(a.clone());
    }

    args
}

/// Parse unison output for progress/status.
///
/// Unison outputs lines like:
/// - "  new file ---->  path/to/file"
/// - "  changed  ---->  path/to/file"
/// - "  deleted        path/to/file"
/// - "  <---- changed  path/to/file"
///
/// Summary: "Synchronization complete at HH:MM:SS (X items transferred, ...)"
pub fn parse_summary(output: &str) -> UnisonStats {
    let mut stats = UnisonStats::default();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.contains("---->") || trimmed.contains("<----") {
            if trimmed.contains("new file") || trimmed.contains("new dir") {
                stats.files_created += 1;
            } else if trimmed.contains("changed") {
                stats.files_updated += 1;
            } else if trimmed.contains("deleted") {
                stats.files_deleted += 1;
            }
            stats.files_transferred += 1;
        } else if trimmed.starts_with("CONFLICT") || trimmed.starts_with("conflict") {
            stats.conflicts += 1;
        } else if trimmed.contains("Synchronization complete") {
            stats.completed = true;
        } else if trimmed.contains("Nothing to do") {
            stats.completed = true;
            stats.nothing_to_do = true;
        } else if trimmed.contains("Skipping") {
            stats.files_skipped += 1;
        }
    }

    stats
}

/// Execute unison sync.
pub async fn execute(
    cfg: &UnisonConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.unison_binary.as_deref().unwrap_or("unison");
    let args = build_args(cfg);
    let cmd_str = format!("{} {}", binary, args.join(" "));

    info!("Executing Unison sync: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new(binary)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("unison binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to spawn unison: {e}"))
            }
        })?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();
    let mut files_seen: u64 = 0;

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("unison: {}", line);
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');

            // Track file transfer progress
            let trimmed = line.trim();
            if trimmed.contains("---->") || trimmed.contains("<----") {
                files_seen += 1;
                let current_file = trimmed
                    .split_whitespace()
                    .last()
                    .map(String::from);
                on_progress(BackupProgress {
                    job_id: job_id.to_string(),
                    bytes_transferred: 0,
                    bytes_total: None,
                    files_transferred: files_seen,
                    files_total: None,
                    current_file,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    percent_complete: None,
                    phase: BackupPhase::Transferring,
                });
            }
        }
    }

    if let Some(err) = child.stderr.take() {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("unison stderr: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to wait for unison: {e}")))?;

    let exit_code = exit_status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    let stats = parse_summary(&stdout_buf);

    let status = match exit_code {
        0 => BackupJobStatus::Completed,
        1 => {
            // Some files were skipped
            BackupJobStatus::PartiallyCompleted
        }
        2 => {
            // Non-fatal failures
            BackupJobStatus::PartiallyCompleted
        }
        _ => {
            error!("unison failed with exit code {exit_code}");
            BackupJobStatus::Failed
        }
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Unison,
        status,
        started_at,
        finished_at: Some(finished_at),
        duration_secs: Some(duration),
        bytes_transferred: 0,
        files_transferred: stats.files_transferred,
        files_deleted: stats.files_deleted,
        files_skipped: stats.files_skipped,
        files_failed: stats.conflicts,
        speed_bps: None,
        file_records: Vec::new(),
        command: Some(cmd_str),
        stdout: Some(crate::rsync::truncate_output(&stdout_buf, 10_000)),
        stderr: if stderr_buf.is_empty() {
            None
        } else {
            Some(crate::rsync::truncate_output(&stderr_buf, 5_000))
        },
        exit_code: Some(exit_code),
        error: if exit_code > 2 {
            Some(format!("unison exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id: None,
    };

    if exit_code > 2 {
        return Err(BackupError::ToolFailed {
            tool: "unison".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}

/// List unison profiles available on the system.
pub async fn list_profiles(_unison_binary: Option<&str>) -> Result<Vec<String>, BackupError> {
    // Unison stores profiles in ~/.unison/*.prf
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| BackupError::ConfigError("cannot determine home directory".into()))?;

    let unison_dir = std::path::Path::new(&home).join(".unison");
    if !unison_dir.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();
    let mut entries = tokio::fs::read_dir(&unison_dir)
        .await
        .map_err(|e| BackupError::IoError(format!("failed to read .unison dir: {e}")))?;

    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".prf") {
                profiles.push(name.trim_end_matches(".prf").to_string());
            }
        }
    }

    Ok(profiles)
}

/// Get version of installed unison.
pub async fn version(unison_binary: Option<&str>) -> Result<String, BackupError> {
    let binary = unison_binary.unwrap_or("unison");
    let output = Command::new(binary)
        .args(["-version"])
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run unison -version: {e}")))?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ─── Stats ──────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct UnisonStats {
    pub files_transferred: u64,
    pub files_created: u64,
    pub files_updated: u64,
    pub files_deleted: u64,
    pub files_skipped: u64,
    pub conflicts: u64,
    pub completed: bool,
    pub nothing_to_do: bool,
}
