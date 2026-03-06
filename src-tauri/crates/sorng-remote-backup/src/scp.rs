//! SCP wrapper — recursive copy with bandwidth limits and progress.

use crate::error::BackupError;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool,
    ScpConfig, ScpDirection,
};
use chrono::Utc;
use log::{debug, error, info};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build scp argument vector from config.
pub fn build_args(cfg: &ScpConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    if cfg.recursive {
        args.push("-r".into());
    }
    if cfg.preserve {
        args.push("-p".into());
    }
    if cfg.compress {
        args.push("-C".into());
    }

    // Port
    args.push("-P".into());
    args.push(cfg.ssh.port.to_string());

    // Key
    if let Some(key) = &cfg.ssh.private_key_path {
        args.push("-i".into());
        args.push(key.clone());
    }

    // SSH options
    for (k, v) in &cfg.ssh.ssh_options {
        args.push("-o".into());
        args.push(format!("{k}={v}"));
    }

    // Timeout
    if let Some(timeout) = cfg.ssh.connect_timeout {
        args.push("-o".into());
        args.push(format!("ConnectTimeout={timeout}"));
    }

    // Bandwidth limit
    if let Some(bw) = cfg.bandwidth_limit_kbps {
        if bw > 0 {
            args.push("-l".into());
            args.push((bw * 8).to_string()); // scp uses Kbit/s
        }
    }

    // Extra args
    for a in &cfg.extra_args {
        args.push(a.clone());
    }

    let remote_prefix = format!("{}@{}:", cfg.ssh.username, cfg.ssh.host);

    match cfg.direction {
        ScpDirection::Upload => {
            // Sources are local, destination is remote
            for s in &cfg.sources {
                args.push(s.clone());
            }
            args.push(format!("{remote_prefix}{}", cfg.destination));
        }
        ScpDirection::Download => {
            // Sources are remote, destination is local
            for s in &cfg.sources {
                args.push(format!("{remote_prefix}{s}"));
            }
            args.push(cfg.destination.clone());
        }
    }

    args
}

/// Execute an SCP transfer.
pub async fn execute(
    cfg: &ScpConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.scp_binary.as_deref().unwrap_or("scp");
    let args = build_args(cfg);
    let cmd_str = format!("{} {}", binary, args.join(" "));

    info!("Executing SCP transfer: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new(binary)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("scp binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to spawn scp: {e}"))
            }
        })?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("scp: {}", line);
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');
        }
    }

    if let Some(err) = child.stderr.take() {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("scp stderr: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to wait for scp: {e}")))?;

    let exit_code = exit_status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    on_progress(BackupProgress {
        job_id: job_id.to_string(),
        bytes_transferred: 0,
        bytes_total: None,
        files_transferred: cfg.sources.len() as u64,
        files_total: Some(cfg.sources.len() as u64),
        current_file: None,
        speed_bps: 0.0,
        eta_seconds: Some(0),
        percent_complete: Some(if exit_code == 0 { 100.0 } else { 0.0 }),
        phase: BackupPhase::Finished,
    });

    let status = if exit_code == 0 {
        BackupJobStatus::Completed
    } else {
        error!("scp failed with exit code {exit_code}");
        BackupJobStatus::Failed
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Scp,
        status,
        started_at,
        finished_at: Some(finished_at),
        duration_secs: Some(duration),
        bytes_transferred: 0,
        files_transferred: cfg.sources.len() as u64,
        files_deleted: 0,
        files_skipped: 0,
        files_failed: if exit_code != 0 { cfg.sources.len() as u64 } else { 0 },
        speed_bps: None,
        file_records: Vec::new(),
        command: Some(cmd_str),
        stdout: Some(crate::rsync::truncate_output(&stdout_buf, 10_000)),
        stderr: if stderr_buf.is_empty() { None } else { Some(crate::rsync::truncate_output(&stderr_buf, 5_000)) },
        exit_code: Some(exit_code),
        error: if exit_code != 0 { Some(format!("scp exited with code {exit_code}")) } else { None },
        retry_attempt: 0,
        snapshot_id: None,
    };

    if exit_code != 0 {
        return Err(BackupError::ToolFailed {
            tool: "scp".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}
