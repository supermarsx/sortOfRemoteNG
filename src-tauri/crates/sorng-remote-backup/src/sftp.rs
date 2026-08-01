//! SFTP wrapper — bulk file transfer with resume, progress tracking, checksums.

use crate::error::BackupError;
use crate::process::BoundedCommandExt;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool, SftpConfig,
    SftpTransferMode,
};
use chrono::Utc;
use log::{error, info};
use tokio::process::Command;
use uuid::Uuid;

/// Build an sftp batch file content for bulk operations.
pub fn build_batch_commands(cfg: &SftpConfig) -> Result<String, BackupError> {
    if cfg.local_paths.is_empty() || cfg.local_paths.len() > 1024 {
        return Err(BackupError::ConfigError(
            "SFTP requires between 1 and 1024 local paths".into(),
        ));
    }
    let quote = |path: &str| -> Result<String, BackupError> {
        crate::types::validate_cli_text("SFTP batch path", path, 4096)?;
        Ok(format!(
            "\"{}\"",
            path.replace('\\', "\\\\").replace('"', "\\\"")
        ))
    };
    let mut cmds = Vec::new();

    match cfg.mode {
        SftpTransferMode::Upload => {
            cmds.push(format!("cd {}", quote(&cfg.remote_path)?));
            if cfg.recursive {
                cmds.push("-mkdir .".into()); // ensure remote dir exists
            }
            for path in &cfg.local_paths {
                if cfg.recursive {
                    cmds.push(format!("put -r {}", quote(path)?));
                } else {
                    cmds.push(format!("put {}", quote(path)?));
                }
            }
        }
        SftpTransferMode::Download => {
            cmds.push(format!("cd {}", quote(&cfg.remote_path)?));
            for path in &cfg.local_paths {
                if cfg.recursive {
                    cmds.push(format!("get -r . {}", quote(path)?));
                } else {
                    cmds.push(format!("get * {}", quote(path)?));
                }
            }
        }
        SftpTransferMode::Sync | SftpTransferMode::Mirror => {
            // For sync/mirror we use rsync-like approach with sftp —
            // just do a recursive transfer (sftp doesn't natively support sync)
            cmds.push(format!("cd {}", quote(&cfg.remote_path)?));
            for path in &cfg.local_paths {
                cmds.push(format!("put -r {}", quote(path)?));
            }
        }
    }

    cmds.push("bye".into());
    Ok(cmds.join("\n"))
}

/// Build sftp command-line arguments.
pub fn build_args(cfg: &SftpConfig) -> Result<Vec<String>, BackupError> {
    cfg.ssh.validate()?;
    if cfg.buffer_size.unwrap_or(0) > 16 * 1024 * 1024 || cfg.concurrency.unwrap_or(1) > 32 {
        return Err(BackupError::ConfigError(
            "SFTP buffer size or concurrency exceeds the safety limit".into(),
        ));
    }
    // OpenSSH uses the first supplied value for these options.
    let mut args = vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
    ];

    // SSH options from transport config
    args.push("-P".into());
    args.push(cfg.ssh.port.to_string());

    if let Some(key) = &cfg.ssh.private_key_path {
        args.push("-i".into());
        args.push(key.clone());
    }

    if cfg.ssh.compression {
        args.push("-C".into());
    }

    let timeout = cfg.ssh.connect_timeout.unwrap_or(30).clamp(1, 300);
    args.push("-o".into());
    args.push(format!("ConnectTimeout={timeout}"));

    for (k, v) in &cfg.ssh.ssh_options {
        args.push("-o".into());
        args.push(format!("{k}={v}"));
    }

    if let Some(bs) = cfg.buffer_size {
        args.push("-B".into());
        args.push(bs.to_string());
    }

    // Bandwidth limit
    if let Some(bw) = &cfg.bandwidth_limit {
        if bw.rate_kbps > 0 {
            args.push("-l".into());
            args.push(bw.rate_kbps.to_string());
        }
    }

    if cfg.preserve_timestamps {
        args.push("-p".into());
    }

    if cfg.resume {
        args.push("-a".into()); // attempt to resume partial transfers
    }

    // Batch mode
    args.push("-b".into());
    args.push("-".into()); // read batch from stdin

    // target
    args.push(format!("{}@{}", cfg.ssh.username, cfg.ssh.host));

    Ok(args)
}

/// Execute an SFTP transfer.
pub async fn execute(
    cfg: &SftpConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let args = build_args(cfg)?;
    let batch = build_batch_commands(cfg)?;
    let cmd_str = "sftp <arguments redacted>".to_string();
    info!("Executing SFTP transfer");
    let started_at = Utc::now();

    let output = Command::new("sftp")
        .args(&args)
        .output_bounded_with_input(batch.as_bytes())
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound("sftp binary not found".into())
            } else {
                BackupError::ProcessError(format!("failed to run sftp safely: {e}"))
            }
        })?;
    let stdout_buf = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_buf = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    // Emit a final progress event
    on_progress(BackupProgress {
        job_id: job_id.to_string(),
        bytes_transferred: 0,
        bytes_total: None,
        files_transferred: cfg.local_paths.len() as u64,
        files_total: Some(cfg.local_paths.len() as u64),
        current_file: None,
        speed_bps: 0.0,
        eta_seconds: Some(0),
        percent_complete: Some(if exit_code == 0 { 100.0 } else { 0.0 }),
        phase: BackupPhase::Finished,
    });

    let status = if exit_code == 0 {
        BackupJobStatus::Completed
    } else {
        error!("sftp failed with exit code {exit_code}");
        BackupJobStatus::Failed
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Sftp,
        status,
        started_at,
        finished_at: Some(finished_at),
        duration_secs: Some(duration),
        bytes_transferred: 0,
        files_transferred: cfg.local_paths.len() as u64,
        files_deleted: 0,
        files_skipped: 0,
        files_failed: if exit_code != 0 {
            cfg.local_paths.len() as u64
        } else {
            0
        },
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
            Some(format!("sftp exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id: None,
        payload_hash: None,
        skipped_due_to_delta: false,
        per_target_results: Vec::new(),
    };

    if exit_code != 0 {
        return Err(BackupError::ToolFailed {
            tool: "sftp".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}
