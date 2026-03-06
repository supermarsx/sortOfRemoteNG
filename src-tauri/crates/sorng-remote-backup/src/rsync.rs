//! Rsync wrapper — argument builder, execution, dry-run, output parser.

use crate::error::BackupError;
use crate::types::{BackupExecutionRecord, BackupJobStatus, BackupProgress, BackupPhase, BackupTool, RsyncConfig};
use chrono::Utc;
use log::{debug, error, info, warn};
use regex::Regex;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

/// Build the full rsync argument vector from config.
pub fn build_args(cfg: &RsyncConfig) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    if cfg.archive {
        args.push("--archive".into());
    }
    if cfg.compress {
        args.push("--compress".into());
    }
    if cfg.delete {
        if cfg.delete_before {
            args.push("--delete-before".into());
        } else {
            args.push("--delete".into());
        }
    }
    if cfg.hard_links {
        args.push("--hard-links".into());
    }
    if cfg.acls {
        args.push("--acls".into());
    }
    if cfg.xattrs {
        args.push("--xattrs".into());
    }
    if cfg.checksum {
        args.push("--checksum".into());
    }
    if cfg.partial {
        args.push("--partial".into());
    }
    if cfg.progress {
        args.push("--progress".into());
        args.push("--info=progress2".into());
    }
    if cfg.numeric_ids {
        args.push("--numeric-ids".into());
    }
    if cfg.dry_run {
        args.push("--dry-run".into());
    }

    // Exclude / include / filter
    for ex in &cfg.exclude {
        args.push("--exclude".into());
        args.push(ex.clone());
    }
    for inc in &cfg.include {
        args.push("--include".into());
        args.push(inc.clone());
    }
    for f in &cfg.filters {
        args.push("--filter".into());
        args.push(f.clone());
    }

    // Bandwidth limit
    if let Some(bw) = &cfg.bandwidth_limit {
        if bw.rate_kbps > 0 {
            args.push(format!("--bwlimit={}", bw.rate_kbps));
        }
    }

    // Max delete
    if let Some(md) = cfg.max_delete {
        args.push(format!("--max-delete={}", md));
    }

    // Block size
    if let Some(bs) = cfg.block_size {
        args.push(format!("--block-size={}", bs));
    }

    // I/O timeout
    if let Some(t) = cfg.io_timeout {
        args.push(format!("--timeout={}", t));
    }

    // Link-dest for incremental
    if let Some(ld) = &cfg.link_dest {
        args.push(format!("--link-dest={}", ld));
    }

    // Backup dir
    if let Some(bd) = &cfg.backup_dir {
        args.push("--backup".into());
        args.push(format!("--backup-dir={}", bd));
    }

    // Files-from
    if let Some(ff) = &cfg.files_from {
        args.push(format!("--files-from={}", ff));
    }

    // SSH command
    if let Some(ssh) = &cfg.ssh {
        args.push("-e".into());
        args.push(ssh.to_ssh_command());
    }

    // Extra user-provided args
    for a in &cfg.extra_args {
        args.push(a.clone());
    }

    // Sources
    for s in &cfg.sources {
        args.push(s.clone());
    }

    // Destination
    args.push(cfg.destination.clone());

    args
}

/// Parse rsync --info=progress2 output line.
///
/// Example: "  1,234,567  50%   12.34MB/s    0:01:23"
pub fn parse_progress_line(line: &str, job_id: &str) -> Option<BackupProgress> {
    let re = Regex::new(
        r"(?x)
        ^\s*
        ([\d,]+)              # bytes transferred
        \s+
        (\d+)%                # percent
        \s+
        ([\d.]+)(\w+/s)      # speed + unit
        \s+
        (\d+:\d+:\d+)        # ETA
        ",
    )
    .ok()?;

    let caps = re.captures(line)?;
    let bytes: u64 = caps[1].replace(',', "").parse().ok()?;
    let pct: f64 = caps[2].parse().ok()?;
    let speed_val: f64 = caps[3].parse().ok()?;
    let speed_unit = &caps[4];
    let eta_str = &caps[5];

    let speed_bps = match speed_unit {
        "kB/s" => speed_val * 1_000.0,
        "MB/s" => speed_val * 1_000_000.0,
        "GB/s" => speed_val * 1_000_000_000.0,
        "B/s" => speed_val,
        _ => speed_val,
    };

    let eta_parts: Vec<&str> = eta_str.split(':').collect();
    let eta_seconds = if eta_parts.len() == 3 {
        let h: u64 = eta_parts[0].parse().unwrap_or(0);
        let m: u64 = eta_parts[1].parse().unwrap_or(0);
        let s: u64 = eta_parts[2].parse().unwrap_or(0);
        Some(h * 3600 + m * 60 + s)
    } else {
        None
    };

    Some(BackupProgress {
        job_id: job_id.to_string(),
        bytes_transferred: bytes,
        bytes_total: if pct > 0.0 {
            Some((bytes as f64 / (pct / 100.0)) as u64)
        } else {
            None
        },
        files_transferred: 0,
        files_total: None,
        current_file: None,
        speed_bps,
        eta_seconds,
        percent_complete: Some(pct),
        phase: BackupPhase::Transferring,
    })
}

/// Parse rsync summary stats from output.
///
/// Looks for lines like:
/// - "Number of files: 1,234"
/// - "Number of files transferred: 567"
/// - "Total transferred file size: 1,234,567 bytes"
/// - "Total bytes sent: 1,234,567"
pub fn parse_stats(output: &str) -> RsyncStats {
    let mut stats = RsyncStats::default();

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(val) = extract_stat(trimmed, "Number of files:") {
            // "Number of files: 1,234 (reg: 1,000, dir: 100, ...)"
            if let Some(paren_idx) = val.find('(') {
                stats.total_files = parse_comma_number(&val[..paren_idx]);
            } else {
                stats.total_files = parse_comma_number(&val);
            }
        } else if let Some(val) =
            extract_stat(trimmed, "Number of regular files transferred:")
                .or_else(|| extract_stat(trimmed, "Number of files transferred:"))
        {
            stats.files_transferred = parse_comma_number(&val);
        } else if let Some(val) = extract_stat(trimmed, "Total transferred file size:") {
            stats.bytes_transferred = parse_byte_value(&val);
        } else if let Some(val) = extract_stat(trimmed, "Total bytes sent:") {
            stats.bytes_sent = parse_byte_value(&val);
        } else if let Some(val) = extract_stat(trimmed, "Total bytes received:") {
            stats.bytes_received = parse_byte_value(&val);
        } else if let Some(val) = extract_stat(trimmed, "Number of deleted files:") {
            stats.files_deleted = parse_comma_number(&val);
        }
    }

    stats
}

/// Execute rsync with the given configuration.
pub async fn execute(
    cfg: &RsyncConfig,
    job_id: &str,
    mut on_progress: impl FnMut(BackupProgress),
) -> Result<BackupExecutionRecord, BackupError> {
    let binary = cfg.rsync_binary.as_deref().unwrap_or("rsync");
    let args = build_args(cfg);
    let cmd_str = format!("{} {}", binary, args.join(" "));

    info!("Executing rsync: {}", cmd_str);
    let started_at = Utc::now();

    let mut child = Command::new(binary)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::ToolNotFound(format!("rsync binary not found at: {binary}"))
            } else {
                BackupError::ProcessError(format!("failed to spawn rsync: {e}"))
            }
        })?;

    // Read stdout for progress
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    if let Some(out) = stdout {
        let reader = BufReader::new(out);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!("rsync: {}", line);
            if let Some(progress) = parse_progress_line(&line, job_id) {
                on_progress(progress);
            }
            stdout_buf.push_str(&line);
            stdout_buf.push('\n');
        }
    }

    if let Some(err) = stderr {
        let reader = BufReader::new(err);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            warn!("rsync stderr: {}", line);
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let exit_status = child.wait().await.map_err(|e| {
        BackupError::ProcessError(format!("failed to wait for rsync: {e}"))
    })?;

    let exit_code = exit_status.code().unwrap_or(-1);
    let finished_at = Utc::now();
    let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

    let stats = parse_stats(&stdout_buf);
    let status = if exit_code == 0 {
        BackupJobStatus::Completed
    } else if exit_code == 24 {
        // Partial transfer due to vanished source files — usually OK
        warn!("rsync finished with exit code 24 (some source files vanished)");
        BackupJobStatus::PartiallyCompleted
    } else {
        error!("rsync failed with exit code {exit_code}");
        BackupJobStatus::Failed
    };

    let record = BackupExecutionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: job_id.to_string(),
        job_name: String::new(),
        tool: BackupTool::Rsync,
        status,
        started_at,
        finished_at: Some(finished_at),
        duration_secs: Some(duration),
        bytes_transferred: stats.bytes_transferred,
        files_transferred: stats.files_transferred,
        files_deleted: stats.files_deleted,
        files_skipped: 0,
        files_failed: 0,
        speed_bps: if duration > 0.0 {
            Some(stats.bytes_transferred as f64 / duration)
        } else {
            None
        },
        file_records: Vec::new(),
        command: Some(cmd_str),
        stdout: Some(truncate_output(&stdout_buf, 10_000)),
        stderr: if stderr_buf.is_empty() {
            None
        } else {
            Some(truncate_output(&stderr_buf, 5_000))
        },
        exit_code: Some(exit_code),
        error: if exit_code != 0 && exit_code != 24 {
            Some(format!("rsync exited with code {exit_code}"))
        } else {
            None
        },
        retry_attempt: 0,
        snapshot_id: None,
    };

    if exit_code != 0 && exit_code != 24 {
        return Err(BackupError::ToolFailed {
            tool: "rsync".into(),
            exit_code,
            stderr: stderr_buf,
        });
    }

    Ok(record)
}

// ─── Rsync stats ────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct RsyncStats {
    pub total_files: u64,
    pub files_transferred: u64,
    pub bytes_transferred: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub files_deleted: u64,
}

// ─── Private helpers ────────────────────────────────────────────────

fn extract_stat<'a>(line: &'a str, prefix: &str) -> Option<String> {
    if line.starts_with(prefix) {
        Some(line[prefix.len()..].trim().to_string())
    } else {
        None
    }
}

fn parse_comma_number(s: &str) -> u64 {
    s.trim().replace(',', "").parse().unwrap_or(0)
}

fn parse_byte_value(s: &str) -> u64 {
    // "1,234,567 bytes" or "1,234,567"
    let num_str = s.trim().split_whitespace().next().unwrap_or("0");
    parse_comma_number(num_str)
}

pub(crate) fn truncate_output(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        let suffix = "\n... (output truncated)";
        let cut = max_len - suffix.len();
        format!("{}{}", &s[..cut], suffix)
    }
}
