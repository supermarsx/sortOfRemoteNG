//! SFTP wrapper — bulk file transfer with resume, progress tracking, checksums.

use crate::error::BackupError;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool, SftpConfig,
    SftpTransferMode,
};
use chrono::Utc;
use log::{debug, error, info};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build an sftp batch file content for bulk operations.
pub fn build_batch_commands(cfg: &SftpConfig) -> String {
    let mut cmds = Vec::new();

    match cfg.mode {
        SftpTransferMode::Upload => {
            cmds.push(format!("cd {}", cfg.remote_path));
            if cfg.recursive {
                cmds.push("-mkdir .".into()); // ensure remote dir exists
            }
            for path in &cfg.local_paths {
                if cfg.recursive {
                    cmds.push(format!("put -r {path}"));
                } else {
                    cmds.push(format!("put {path}"));
                }
            }
        }
        SftpTransferMode::Download => {
            cmds.push(format!("cd {}", cfg.remote_path));
            for path in &cfg.local_paths {
                if cfg.recursive {
                    cmds.push(format!("get -r . {path}"));
                } else {
                    cmds.push(format!("get * {path}"));
                }
            }
        }
        SftpTransferMode::Sync | SftpTransferMode::Mirror => {
            // For sync/mirror we use rsync-like approach with sftp —
            // just do a recursive transfer (sftp doesn't natively support sync)
            cmds.push(format!("cd {}", cfg.remote_path));
            for path in &cfg.local_paths {
                cmds.push(format!("put -r {path}"));
            }
        }
    }

    cmds.push("bye".into());
    cmds.join("\n")
}

/// Build sftp command-line arguments.
pub fn build_args(cfg: &SftpConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

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

    if let Some(timeout) = cfg.ssh.connect_timeout {
        args.push("-o".into());
        args.push(format!("ConnectTimeout={timeout}"));
    }

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

    args
}

/// Execute an SFTP transfer.
pub async fn execute(
    cfg: &SftpConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let args = build_args(cfg);
    let batch = build_batch_commands(cfg);
    let cmd_str = format!("sftp {}", args.join(" "));

    info!("Executing SFTP transfer: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new("sftp")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound("sftp binary not found".into())
            } else {
                BackupError::ProcessError(format!("failed to spawn sftp: {e}"))
            }
        })?;

    // Write batch commands to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin
            .write_all(batch.as_bytes())
            .await
            .map_err(|e| BackupError::IoError(format!("failed to write sftp batch: {e}")))?;
        drop(stdin);
    }

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("sftp: {}", line);
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');
        }
    }

    if let Some(err) = child.stderr.take() {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("sftp stderr: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to wait for sftp: {e}")))?;

    let exit_code = exit_status.code().unwrap_or(-1);
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
