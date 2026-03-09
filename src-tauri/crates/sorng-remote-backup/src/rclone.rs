//! Rclone wrapper — remote config, sync/copy/move, bandwidth limiting, output parser.

use crate::error::BackupError;
use crate::types::{
    BackupExecutionRecord, BackupJobStatus, BackupPhase, BackupProgress, BackupTool, RcloneConfig,
    RcloneSyncMode,
};
use chrono::Utc;
use log::{debug, error, info};
use regex::Regex;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build rclone argument vector from config.
pub fn build_args(cfg: &RcloneConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // Sub-command
    let sub = match &cfg.mode {
        RcloneSyncMode::Sync => "sync",
        RcloneSyncMode::Copy => "copy",
        RcloneSyncMode::Move => "move",
        RcloneSyncMode::Check => "check",
        RcloneSyncMode::Bisync => "bisync",
        RcloneSyncMode::Dedupe => "dedupe",
    };
    args.push(sub.into());

    // Source & destination
    args.push(cfg.source.clone());
    args.push(cfg.destination.clone());

    // Filters
    for ex in &cfg.exclude {
        args.push("--exclude".into());
        args.push(ex.clone());
    }
    for inc in &cfg.include {
        args.push("--include".into());
        args.push(inc.clone());
    }
    for fr in &cfg.filter_rules {
        args.push("--filter".into());
        args.push(fr.clone());
    }

    // Bandwidth limit
    if let Some(bw) = &cfg.bandwidth_limit {
        if bw.rate_kbps > 0 {
            args.push(format!("--bwlimit={}K", bw.rate_kbps));
        }
    }

    // Transfers / checkers
    if let Some(t) = cfg.transfers {
        args.push(format!("--transfers={t}"));
    }
    if let Some(c) = cfg.checkers {
        args.push(format!("--checkers={c}"));
    }

    // Age / size filters
    if let Some(v) = &cfg.min_age {
        args.push(format!("--min-age={v}"));
    }
    if let Some(v) = &cfg.max_age {
        args.push(format!("--max-age={v}"));
    }
    if let Some(v) = &cfg.min_size {
        args.push(format!("--min-size={v}"));
    }
    if let Some(v) = &cfg.max_size {
        args.push(format!("--max-size={v}"));
    }

    // Various flags
    if cfg.delete_empty_dirs {
        args.push("--delete-empty-src-dirs".into());
    }
    if cfg.track_renames {
        args.push("--track-renames".into());
    }
    if cfg.dry_run {
        args.push("--dry-run".into());
    }
    if let Some(v) = cfg.verbose {
        for _ in 0..v {
            args.push("-v".into());
        }
    }

    // Progress in machine-readable format
    args.push("--progress".into());
    args.push("--stats=1s".into());
    args.push("--stats-one-line".into());

    // Extra user args
    for a in &cfg.extra_args {
        args.push(a.clone());
    }

    args
}

/// Build environment variables for rclone remote configs.
/// Rclone accepts remote config as env vars: RCLONE_CONFIG_<NAME>_<PARAM>=value
pub fn build_env(cfg: &RcloneConfig) -> HashMap<String, String> {
    let mut env = HashMap::new();

    for (name, remote_cfg) in &cfg.remotes {
        let prefix = format!("RCLONE_CONFIG_{}", name.to_uppercase());
        env.insert(
            format!("{prefix}_TYPE"),
            format!("{:?}", remote_cfg.remote_type).to_lowercase(),
        );
        for (k, v) in &remote_cfg.params {
            env.insert(format!("{prefix}_{}", k.to_uppercase()), v.clone());
        }
    }

    // If SSH transport is set, inject SFTP remote params
    if let Some(ssh) = &cfg.ssh {
        let prefix = "RCLONE_CONFIG_SSHREMOTE";
        env.insert(format!("{prefix}_TYPE"), "sftp".into());
        env.insert(format!("{prefix}_HOST"), ssh.host.clone());
        env.insert(format!("{prefix}_PORT"), ssh.port.to_string());
        env.insert(format!("{prefix}_USER"), ssh.username.clone());
        if let Some(pass) = &ssh.password {
            env.insert(format!("{prefix}_PASS"), pass.clone());
        }
        if let Some(key) = &ssh.private_key_path {
            env.insert(format!("{prefix}_KEY_FILE"), key.clone());
        }
        if let Some(phrase) = &ssh.private_key_passphrase {
            env.insert(format!("{prefix}_KEY_FILE_PASS"), phrase.clone());
        }
    }

    env
}

/// Parse rclone --stats-one-line output.
///
/// Example: "Transferred:   1.234 GiB / 5.678 GiB, 22%, 12.34 MiB/s, ETA 5m30s"
pub fn parse_progress_line(line: &str, job_id: &str) -> Option<BackupProgress> {
    let re = Regex::new(
        r"(?x)
        Transferred:\s+
        ([\d.]+)\s*(\w+)\s*/\s*([\d.]+)\s*(\w+),\s*  # transferred / total
        (\d+)%,\s*                                      # percent
        ([\d.]+)\s*(\w+/s)                              # speed
        (?:,\s*ETA\s*([\w\d]+))?                        # optional ETA
        ",
    )
    .ok()?;

    let caps = re.captures(line)?;
    let transferred = parse_size_value(&caps[1], &caps[2]);
    let total = parse_size_value(&caps[3], &caps[4]);
    let pct: f64 = caps[5].parse().ok()?;
    let speed_val: f64 = caps[6].parse().ok()?;
    let speed_unit = &caps[7];
    let eta_str = caps.get(8).map(|m| m.as_str());

    let speed_bps = convert_speed(speed_val, speed_unit);
    let eta_seconds = eta_str.and_then(parse_eta);

    Some(BackupProgress {
        job_id: job_id.to_string(),
        bytes_transferred: transferred,
        bytes_total: Some(total),
        files_transferred: 0,
        files_total: None,
        current_file: None,
        speed_bps,
        eta_seconds,
        percent_complete: Some(pct),
        phase: BackupPhase::Transferring,
    })
}

/// Execute rclone with the given configuration.
pub async fn execute(
    cfg: &RcloneConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.rclone_binary.as_deref().unwrap_or("rclone");
    let args = build_args(cfg);
    let env = build_env(cfg);
    let cmd_str = format!("{} {}", binary, args.join(" "));

    info!("Executing rclone: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new(binary)
        .args(&args)
        .envs(&env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("rclone binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to spawn rclone: {e}"))
            }
        })?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("rclone: {}", line);
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');
        }
    }

    if let Some(err) = child.stderr.take() {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            // Rclone outputs progress to stderr
            if let Some(progress) = parse_progress_line(&line, job_id) {
                on_progress(progress);
            }
            debug!("rclone stderr: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to wait for rclone: {e}")))?;

    let exit_code = exit_status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    let status = if exit_code == 0 {
        BackupJobStatus::Completed
    } else {
        error!("rclone failed with exit code {exit_code}");
        BackupJobStatus::Failed
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Rclone,
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
            Some(format!("rclone exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id: None,
    };

    if exit_code != 0 {
        return Err(BackupError::ToolFailed {
            tool: "rclone".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}

/// List remotes configured in the system's rclone config.
pub async fn list_remotes(rclone_binary: Option<&str>) -> Result<Vec<String>, BackupError> {
    let binary = rclone_binary.unwrap_or("rclone");
    let output = Command::new(binary)
        .args(["listremotes"])
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run rclone listremotes: {e}")))?;

    if !output.status.success() {
        return Err(BackupError::ToolFailed {
            tool: "rclone".into(),
            exit_code: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    let remotes = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim_end_matches(':').to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(remotes)
}

/// Get version of installed rclone.
pub async fn version(rclone_binary: Option<&str>) -> Result<String, BackupError> {
    let binary = rclone_binary.unwrap_or("rclone");
    let output = Command::new(binary)
        .args(["version"])
        .output()
        .await
        .map_err(|e| BackupError::ProcessError(format!("failed to run rclone version: {e}")))?;

    let full = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(full.lines().next().unwrap_or("unknown").to_string())
}

// ─── Helpers ────────────────────────────────────────────────────────

fn parse_size_value(val: &str, unit: &str) -> u64 {
    let v: f64 = val.parse().unwrap_or(0.0);
    let multiplier: f64 = match unit {
        "B" | "Bytes" => 1.0,
        "KiB" | "kiB" => 1_024.0,
        "MiB" | "miB" => 1_048_576.0,
        "GiB" | "giB" => 1_073_741_824.0,
        "TiB" | "tiB" => 1_099_511_627_776.0,
        "kB" | "KB" => 1_000.0,
        "MB" => 1_000_000.0,
        "GB" => 1_000_000_000.0,
        "TB" => 1_000_000_000_000.0,
        _ => 1.0,
    };
    (v * multiplier) as u64
}

fn convert_speed(val: f64, unit: &str) -> f64 {
    match unit {
        "B/s" | "Bytes/s" => val,
        "KiB/s" | "kiB/s" => val * 1_024.0,
        "MiB/s" | "miB/s" => val * 1_048_576.0,
        "GiB/s" | "giB/s" => val * 1_073_741_824.0,
        "kB/s" | "KB/s" => val * 1_000.0,
        "MB/s" => val * 1_000_000.0,
        "GB/s" => val * 1_000_000_000.0,
        _ => val,
    }
}

fn parse_eta(s: &str) -> Option<u64> {
    // Parse formats like "5m30s", "1h2m", "30s", "2h5m30s"
    let re = Regex::new(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?").ok()?;
    let caps = re.captures(s)?;
    let h: u64 = caps
        .get(1)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(0);
    let m: u64 = caps
        .get(2)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(0);
    let sec: u64 = caps
        .get(3)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(0);
    let total = h * 3600 + m * 60 + sec;
    if total > 0 {
        Some(total)
    } else {
        None
    }
}
