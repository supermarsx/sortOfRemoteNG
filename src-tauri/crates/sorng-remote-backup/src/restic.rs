//! Restic wrapper — repository management, backup, restore, snapshots, prune, check.

use crate::error::BackupError;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool,
    ResticConfig, ResticRetention, SnapshotInfo,
};
use chrono::Utc;
use log::{debug, error, info};
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build environment variables for restic (password, cache dir, etc.)
pub fn build_env(cfg: &ResticConfig) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("RESTIC_REPOSITORY".into(), cfg.repository.clone());
    if let Some(pass) = &cfg.password {
        env.insert("RESTIC_PASSWORD".into(), pass.clone());
    }
    if let Some(file) = &cfg.password_file {
        env.insert("RESTIC_PASSWORD_FILE".into(), file.clone());
    }
    if let Some(cache) = &cfg.cache_dir {
        env.insert("RESTIC_CACHE_DIR".into(), cache.clone());
    }
    env
}

/// Build common restic arguments (verbose, compression, SSH, etc.)
fn build_common_args(cfg: &ResticConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if let Some(v) = cfg.verbose {
        for _ in 0..v {
            args.push("-v".into());
        }
    }
    if let Some(comp) = &cfg.compression {
        args.push(format!("--compression={comp}"));
    }
    if let Some(ps) = cfg.pack_size {
        args.push(format!("--pack-size={ps}"));
    }
    if let Some(rc) = cfg.read_concurrency {
        args.push(format!("--read-concurrency={rc}"));
    }
    if let Some(bw) = cfg.bandwidth_limit_kbps {
        if bw > 0 {
            args.push(format!("--limit-upload={bw}"));
            args.push(format!("--limit-download={bw}"));
        }
    }
    // SSH transport — restic uses -o sftp.command='ssh ...' for sftp backend
    if let Some(ssh) = &cfg.ssh {
        let ssh_cmd = ssh.to_ssh_command();
        args.push("-o".into());
        args.push(format!("sftp.command=\"{ssh_cmd} -s sftp\""));
    }
    for a in &cfg.extra_args {
        args.push(a.clone());
    }
    args
}

/// Initialize a new restic repository.
pub async fn init(cfg: &ResticConfig) -> Result<String, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let mut args = vec!["init".to_string()];
    args.extend(build_common_args(cfg));

    info!("Initializing restic repository: {}", cfg.repository);
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic init: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("already initialized") || stderr.contains("already exists") {
            return Ok("repository already initialized".into());
        }
        return Err(BackupError::RepositoryError(format!(
            "restic init failed: {}",
            stderr
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run a restic backup.
pub async fn backup(
    cfg: &ResticConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let mut args = vec!["backup".to_string(), "--json".to_string()];
    args.extend(build_common_args(cfg));

    // Exclude patterns
    for ex in &cfg.exclude {
        args.push("--exclude".into());
        args.push(ex.clone());
    }
    if let Some(ef) = &cfg.exclude_file {
        args.push(format!("--exclude-file={ef}"));
    }

    // Tags
    for tag in &cfg.tags {
        args.push("--tag".into());
        args.push(tag.clone());
    }

    // Hostname
    if let Some(host) = &cfg.hostname {
        args.push(format!("--host={host}"));
    }

    if cfg.dry_run {
        args.push("--dry-run".into());
    }

    // Paths
    for p in &cfg.paths {
        args.push(p.clone());
    }

    let cmd_str = format!("{} {}", binary, args.join(" "));
    info!("Executing restic backup: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new(binary)
        .args(&args)
        .envs(&env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("restic binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to spawn restic: {e}"))
            }
        })?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();
    let mut snapshot_id: Option<String> = None;

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("restic: {}", line);
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');

            // Parse JSON progress messages
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                match json.get("message_type").and_then(|v| v.as_str()) {
                    Some("status") => {
                        let progress = BackupProgress {
                            job_id: job_id.to_string(),
                            bytes_transferred: json
                                .get("bytes_done")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            bytes_total: json.get("total_bytes").and_then(|v| v.as_u64()),
                            files_transferred: json
                                .get("files_done")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            files_total: json.get("total_files").and_then(|v| v.as_u64()),
                            current_file: json
                                .get("current_files")
                                .and_then(|v| v.as_array())
                                .and_then(|a| a.first())
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            speed_bps: json
                                .get("bytes_done")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0),
                            eta_seconds: json
                                .get("seconds_remaining")
                                .and_then(|v| v.as_u64()),
                            percent_complete: json
                                .get("percent_done")
                                .and_then(|v| v.as_f64())
                                .map(|p| p * 100.0),
                            phase: BackupPhase::Transferring,
                        };
                        on_progress(progress);
                    }
                    Some("summary") => {
                        snapshot_id = json
                            .get("snapshot_id")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(err) = child.stderr.take() {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("restic stderr: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to wait for restic: {e}")))?;

    let exit_code = exit_status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    let status = if exit_code == 0 {
        BackupJobStatus::Completed
    } else {
        error!("restic backup failed with exit code {exit_code}");
        BackupJobStatus::Failed
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Restic,
        status,
        started_at,
        finished_at: Some(finished_at),
        duration_secs: Some(duration),
        bytes_transferred: 0,
        files_transferred: 0,
        files_deleted: 0,
        files_skipped: 0,
        files_failed: 0,
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
        error: if exit_code != 0 {
            Some(format!("restic exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id,
    };

    if exit_code != 0 {
        return Err(BackupError::ToolFailed {
            tool: "restic".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}

/// List restic snapshots.
pub async fn snapshots(cfg: &ResticConfig) -> Result<Vec<SnapshotInfo>, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let mut args = vec!["snapshots".to_string(), "--json".to_string()];
    args.extend(build_common_args(cfg));

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic snapshots: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "restic".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let snaps: Vec<serde_json::Value> = serde_json::from_str(&json_str)?;

    let result = snaps
        .into_iter()
        .map(|s| SnapshotInfo {
            id: s
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            short_id: s.get("short_id").and_then(|v| v.as_str()).map(String::from),
            time: s
                .get("time")
                .and_then(|v| v.as_str())
                .and_then(|t| t.parse().ok())
                .unwrap_or_else(Utc::now),
            hostname: s.get("hostname").and_then(|v| v.as_str()).map(String::from),
            username: s.get("username").and_then(|v| v.as_str()).map(String::from),
            paths: s
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            tags: s
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            size_bytes: None,
            deduplicated_size: None,
            files_count: None,
            tool: BackupTool::Restic,
        })
        .collect();

    Ok(result)
}

/// Restore a restic snapshot.
pub async fn restore(
    cfg: &ResticConfig,
    snapshot_id: &str,
    target_path: &str,
    include_paths: &[String],
    exclude_paths: &[String],
) -> Result<String, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let mut args = vec![
        "restore".to_string(),
        snapshot_id.to_string(),
        "--target".to_string(),
        target_path.to_string(),
    ];
    for ip in include_paths {
        args.push("--include".into());
        args.push(ip.clone());
    }
    for ep in exclude_paths {
        args.push("--exclude".into());
        args.push(ep.clone());
    }
    args.extend(build_common_args(cfg));

    info!("Restoring restic snapshot {snapshot_id} to {target_path}");
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic restore: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "restic".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run `restic forget` with the given retention policy, optionally followed by `prune`.
pub async fn forget(
    cfg: &ResticConfig,
    retention: &ResticRetention,
) -> Result<String, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let mut args = vec!["forget".to_string()];

    if let Some(n) = retention.keep_last {
        args.push(format!("--keep-last={n}"));
    }
    if let Some(n) = retention.keep_hourly {
        args.push(format!("--keep-hourly={n}"));
    }
    if let Some(n) = retention.keep_daily {
        args.push(format!("--keep-daily={n}"));
    }
    if let Some(n) = retention.keep_weekly {
        args.push(format!("--keep-weekly={n}"));
    }
    if let Some(n) = retention.keep_monthly {
        args.push(format!("--keep-monthly={n}"));
    }
    if let Some(n) = retention.keep_yearly {
        args.push(format!("--keep-yearly={n}"));
    }
    if let Some(w) = &retention.keep_within {
        args.push(format!("--keep-within={w}"));
    }
    for tag in &retention.keep_tags {
        args.push("--keep-tag".into());
        args.push(tag.clone());
    }
    if retention.prune {
        args.push("--prune".into());
    }
    args.extend(build_common_args(cfg));

    info!("Running restic forget with retention policy");
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic forget: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "restic".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run `restic check` to verify repository integrity.
pub async fn check(cfg: &ResticConfig, read_data: bool) -> Result<String, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let mut args = vec!["check".to_string()];
    if read_data {
        args.push("--read-data".into());
    }
    args.extend(build_common_args(cfg));

    info!("Running restic check on {}", cfg.repository);
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic check: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::RepositoryError(format!(
            "restic check failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Unlock a locked restic repository.
pub async fn unlock(cfg: &ResticConfig) -> Result<String, BackupError> {
    let binary = cfg.restic_binary.as_deref().unwrap_or("restic");
    let env = build_env(cfg);
    let args = vec!["unlock".to_string()];

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic unlock: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::RepositoryError(format!(
            "restic unlock failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get version of installed restic.
pub async fn version(restic_binary: Option<&str>) -> Result<String, BackupError> {
    let binary = restic_binary.unwrap_or("restic");
    let output = Command::new(binary)
        .args(["version"])
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run restic version: {e}")))?;

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string())
}
