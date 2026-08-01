//! SCP wrapper — recursive copy with bandwidth limits and progress.

use crate::error::BackupError;
use crate::process::BoundedCommandExt;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool, ScpConfig,
    ScpDirection,
};
use chrono::Utc;
use log::{error, info};
use tokio::process::Command;
use uuid::Uuid;

/// Build scp argument vector from config.
pub fn build_args(cfg: &ScpConfig) -> Result<Vec<String>, BackupError> {
    cfg.ssh.validate()?;
    if cfg.sources.is_empty() || cfg.sources.len() > 1024 || cfg.extra_args.len() > 64 {
        return Err(BackupError::ConfigError(
            "scp source or additional-argument limits were exceeded".into(),
        ));
    }
    crate::types::validate_cli_text("scp destination", &cfg.destination, 4096)?;
    if cfg.destination.starts_with('-') {
        return Err(BackupError::ConfigError(
            "scp destination must not begin with an option prefix".into(),
        ));
    }
    for source in &cfg.sources {
        crate::types::validate_cli_text("scp source", source, 4096)?;
        if source.starts_with('-') {
            return Err(BackupError::ConfigError(
                "scp sources must not begin with an option prefix".into(),
            ));
        }
    }
    // OpenSSH uses the first supplied value for these options.
    let mut args = vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
    ];

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
    let timeout = cfg.ssh.connect_timeout.unwrap_or(30).clamp(1, 300);
    args.push("-o".into());
    args.push(format!("ConnectTimeout={timeout}"));

    // Bandwidth limit
    if let Some(bw) = cfg.bandwidth_limit_kbps {
        if bw > 0 {
            args.push("-l".into());
            args.push((bw * 8).to_string()); // scp uses Kbit/s
        }
    }

    // Extra args
    for a in &cfg.extra_args {
        crate::types::validate_cli_text("scp additional argument", a, 1024)?;
        let normalized = a.to_ascii_lowercase();
        if normalized == "-o"
            || normalized.starts_with("-o")
            || normalized == "-f"
            || normalized.starts_with("-f")
            || normalized == "-s"
            || normalized.starts_with("-s")
        {
            return Err(BackupError::ConfigError(
                "scp additional arguments may not override SSH policy or select alternate configuration/program files".into(),
            ));
        }
        args.push(a.clone());
    }

    let remote_prefix = format!("{}@{}:", cfg.ssh.username, cfg.ssh.host);

    match cfg.direction {
        ScpDirection::Upload => {
            // Sources are local, destination is remote
            for s in &cfg.sources {
                args.push(s.clone());
            }
            args.push(format!(
                "{remote_prefix}{}",
                crate::types::quote_remote_path(&cfg.destination)?
            ));
        }
        ScpDirection::Download => {
            // Sources are remote, destination is local
            for s in &cfg.sources {
                args.push(format!(
                    "{remote_prefix}{}",
                    crate::types::quote_remote_path(s)?
                ));
            }
            args.push(cfg.destination.clone());
        }
    }

    Ok(args)
}

/// Execute an SCP transfer.
pub async fn execute(
    cfg: &ScpConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.scp_binary.as_deref().unwrap_or("scp");
    let args = build_args(cfg)?;
    let cmd_str = "scp <arguments redacted>".to_string();
    info!("Executing SCP transfer");
    let started_at = Utc::now();

    let output = Command::new(binary)
        .args(&args)
        .output_bounded()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("scp binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to run scp safely: {e}"))
            }
        })?;
    let stdout_buf = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_buf = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);
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
        files_failed: if exit_code != 0 {
            cfg.sources.len() as u64
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
            Some(format!("scp exited with code {exit_code}"))
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
            tool: "scp".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}
