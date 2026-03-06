//! Borg wrapper — repo init, create, extract, list, prune, compact, check.

use crate::error::BackupError;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool,
    BorgCompression, BorgConfig, BorgEncryption, BorgRetention, SnapshotInfo,
};
use chrono::Utc;
use log::{debug, error, info};
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build environment variables for borg.
pub fn build_env(cfg: &BorgConfig) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("BORG_REPO".into(), cfg.repository.clone());
    if let Some(pass) = &cfg.passphrase {
        env.insert("BORG_PASSPHRASE".into(), pass.clone());
    }
    if let Some(file) = &cfg.passphrase_file {
        env.insert("BORG_PASSPHRASE_FD".into(), "0".into()); // will pipe from file
        env.insert("BORG_PASSCOMMAND".into(), format!("cat {file}"));
    }
    // Non-interactive
    env.insert("BORG_RELOCATED_REPO_ACCESS_IS_OK".into(), "yes".into());
    env.insert("BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK".into(), "yes".into());

    // SSH command
    if let Some(ssh) = &cfg.ssh {
        env.insert("BORG_RSH".into(), ssh.to_ssh_command());
    }
    env
}

/// Build compression argument for borg.
fn compression_arg(cfg: &BorgConfig) -> Option<String> {
    cfg.compression.as_ref().map(|c| {
        let base = match c {
            BorgCompression::None => "none".to_string(),
            BorgCompression::Lz4 => "lz4".to_string(),
            BorgCompression::Zstd => {
                if let Some(lvl) = cfg.compression_level {
                    format!("zstd,{lvl}")
                } else {
                    "zstd".to_string()
                }
            }
            BorgCompression::Zlib => {
                if let Some(lvl) = cfg.compression_level {
                    format!("zlib,{lvl}")
                } else {
                    "zlib".to_string()
                }
            }
            BorgCompression::Lzma => {
                if let Some(lvl) = cfg.compression_level {
                    format!("lzma,{lvl}")
                } else {
                    "lzma".to_string()
                }
            }
            BorgCompression::Auto => {
                if let Some(lvl) = cfg.compression_level {
                    format!("auto,zstd,{lvl}")
                } else {
                    "auto,zstd".to_string()
                }
            }
        };
        base
    })
}

/// Initialize a borg repository.
pub async fn init(cfg: &BorgConfig) -> Result<String, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);

    let encryption = cfg.encryption.as_ref().map_or("repokey", |e| match e {
        BorgEncryption::None => "none",
        BorgEncryption::Repokey => "repokey",
        BorgEncryption::RepokeyBlake2 => "repokey-blake2",
        BorgEncryption::Keyfile => "keyfile",
        BorgEncryption::KeyfileBlake2 => "keyfile-blake2",
        BorgEncryption::Authenticated => "authenticated",
        BorgEncryption::AuthenticatedBlake2 => "authenticated-blake2",
    });

    let args = vec!["init".to_string(), format!("--encryption={encryption}")];

    info!("Initializing borg repository: {}", cfg.repository);
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg init: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("already exists") {
            return Ok("repository already initialized".into());
        }
        return Err(BackupError::RepositoryError(format!(
            "borg init failed: {}",
            stderr
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Create a borg backup archive.
pub async fn create(
    cfg: &BorgConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);

    let archive_name = cfg.archive_name.as_deref().unwrap_or("{hostname}-{now}");
    let archive_path = format!("::{archive_name}");

    let mut args = vec![
        "create".to_string(),
        "--json".to_string(),
        "--progress".to_string(),
        "--log-json".to_string(),
    ];

    if cfg.stats {
        args.push("--stats".into());
    }
    if cfg.list_files {
        args.push("--list".into());
    }
    if cfg.dry_run {
        args.push("--dry-run".into());
    }
    if cfg.one_file_system {
        args.push("--one-file-system".into());
    }

    if let Some(comp) = compression_arg(cfg) {
        args.push(format!("--compression={comp}"));
    }

    for ex in &cfg.exclude {
        args.push("--exclude".into());
        args.push(ex.clone());
    }
    if let Some(ef) = &cfg.exclude_file {
        args.push(format!("--exclude-from={ef}"));
    }

    for a in &cfg.extra_args {
        args.push(a.clone());
    }

    args.push(archive_path);
    for p in &cfg.paths {
        args.push(p.clone());
    }

    let cmd_str = format!("{} {}", binary, args.join(" "));
    info!("Executing borg create: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new(binary)
        .args(&args)
        .envs(&env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("borg binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to spawn borg: {e}"))
            }
        })?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    // Borg outputs JSON progress to stderr
    if let Some(err) = child.stderr.take() {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("borg: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                if json.get("type").and_then(|v| v.as_str()) == Some("progress_percent") {
                    let progress = BackupProgress {
                        job_id: job_id.to_string(),
                        bytes_transferred: json
                            .get("current")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        bytes_total: json.get("total").and_then(|v| v.as_u64()),
                        files_transferred: json.get("nfiles").and_then(|v| v.as_u64()).unwrap_or(0),
                        files_total: None,
                        current_file: json
                            .get("path")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        speed_bps: 0.0,
                        eta_seconds: None,
                        percent_complete: json
                            .get("current")
                            .and_then(|c| {
                                json.get("total").and_then(|t| {
                                    let c = c.as_f64()?;
                                    let t = t.as_f64()?;
                                    if t > 0.0 {
                                        Some(c / t * 100.0)
                                    } else {
                                        None
                                    }
                                })
                            }),
                        phase: BackupPhase::Transferring,
                    };
                    on_progress(progress);
                }
            }
        }
    }

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to wait for borg: {e}")))?;

    let exit_code = exit_status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    let status = match exit_code {
        0 => BackupJobStatus::Completed,
        1 => {
            // Warning — some files could not be backed up
            BackupJobStatus::PartiallyCompleted
        }
        _ => {
            error!("borg create failed with exit code {exit_code}");
            BackupJobStatus::Failed
        }
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Borg,
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
        error: if exit_code > 1 {
            Some(format!("borg exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id: None,
    };

    if exit_code > 1 {
        return Err(BackupError::ToolFailed {
            tool: "borg".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}

/// List borg archives.
pub async fn list(cfg: &BorgConfig) -> Result<Vec<SnapshotInfo>, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);
    let args = vec!["list".to_string(), "--json".to_string()];

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg list: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "borg".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let root: serde_json::Value = serde_json::from_str(&json_str)?;
    let archives = root
        .get("archives")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let result = archives
        .into_iter()
        .map(|a| SnapshotInfo {
            id: a
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            short_id: a.get("name").and_then(|v| v.as_str()).map(String::from),
            time: a
                .get("start")
                .and_then(|v| v.as_str())
                .and_then(|t| t.parse().ok())
                .unwrap_or_else(Utc::now),
            hostname: a.get("hostname").and_then(|v| v.as_str()).map(String::from),
            username: a.get("username").and_then(|v| v.as_str()).map(String::from),
            paths: Vec::new(),
            tags: Vec::new(),
            size_bytes: None,
            deduplicated_size: None,
            files_count: a.get("stats").and_then(|s| s.get("nfiles")).and_then(|v| v.as_u64()),
            tool: BackupTool::Borg,
        })
        .collect();

    Ok(result)
}

/// Extract files from a borg archive.
pub async fn extract(
    cfg: &BorgConfig,
    archive_name: &str,
    target_path: &str,
    patterns: &[String],
) -> Result<String, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);
    let archive = format!("::{archive_name}");
    let mut args = vec!["extract".to_string(), archive];
    for p in patterns {
        args.push(p.clone());
    }

    info!("Extracting borg archive {archive_name} to {target_path}");
    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .current_dir(target_path)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg extract: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "borg".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok("extraction complete".into())
}

/// Prune old borg archives per retention policy.
pub async fn prune(cfg: &BorgConfig, retention: &BorgRetention) -> Result<String, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);
    let mut args = vec!["prune".to_string(), "--stats".to_string()];

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
    if let Some(pfx) = &retention.prefix {
        args.push(format!("--prefix={pfx}"));
    }
    if let Some(glob) = &retention.glob_archives {
        args.push(format!("--glob-archives={glob}"));
    }

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg prune: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "borg".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    // Optionally compact after prune
    if cfg.compact_after_prune {
        compact(cfg).await?;
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Compact a borg repository (free space from deleted archives).
pub async fn compact(cfg: &BorgConfig) -> Result<String, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);
    let args = vec!["compact".to_string()];

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg compact: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "borg".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok("compact complete".into())
}

/// Check borg repository integrity.
pub async fn check(cfg: &BorgConfig, verify_data: bool) -> Result<String, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);
    let mut args = vec!["check".to_string()];
    if verify_data {
        args.push("--verify-data".into());
    }

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg check: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::RepositoryError(format!(
            "borg check failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Break borg repository lock.
pub async fn break_lock(cfg: &BorgConfig) -> Result<String, BackupError> {
    let binary = cfg.borg_binary.as_deref().unwrap_or("borg");
    let env = build_env(cfg);
    let args = vec!["break-lock".to_string()];

    let output = Command::new(binary)
        .args(&args)
        .envs(&env)
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg break-lock: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::RepositoryError(format!(
            "borg break-lock failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok("lock broken".into())
}

/// Get version of installed borg.
pub async fn version(borg_binary: Option<&str>) -> Result<String, BackupError> {
    let binary = borg_binary.unwrap_or("borg");
    let output = Command::new(binary)
        .args(["--version"])
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run borg --version: {e}")))?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
