//! Journal log management — journalctl queries, disk usage, vacuum.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Query journal logs.
pub async fn query(host: &SystemdHost, opts: &JournalQueryOpts) -> Result<Vec<JournalEntry>, SystemdError> {
    let mut args = vec!["--no-pager".to_string(), "--output=json".to_string()];
    if let Some(ref unit) = opts.unit {
        args.push(format!("--unit={unit}"));
    }
    if let Some(ref boot) = opts.boot_id {
        args.push(format!("--boot={boot}"));
    }
    if let Some(ref since) = opts.since {
        args.push(format!("--since={since}"));
    }
    if let Some(ref until) = opts.until {
        args.push(format!("--until={until}"));
    }
    if let Some(ref prio) = opts.priority {
        args.push(format!("--priority={}", priority_str(prio)));
    }
    if let Some(ref grep) = opts.grep {
        args.push(format!("--grep={grep}"));
    }
    if let Some(n) = opts.lines {
        args.push(format!("--lines={n}"));
    }
    if opts.reverse {
        args.push("--reverse".into());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = client::exec_ok(host, "journalctl", &arg_refs).await?;
    Ok(parse_journal_json(&stdout))
}

/// Get journal disk usage.
pub async fn disk_usage(host: &SystemdHost) -> Result<JournalDiskUsage, SystemdError> {
    let stdout = client::exec_ok(host, "journalctl", &["--disk-usage"]).await?;
    Ok(JournalDiskUsage {
        archived_bytes: 0,
        current_bytes: parse_bytes_from_output(&stdout),
        total_bytes: parse_bytes_from_output(&stdout),
        max_use_bytes: None,
    })
}

/// Vacuum journal by size.
pub async fn vacuum_size(host: &SystemdHost, max_size: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "journalctl", &["--vacuum-size", max_size]).await?;
    Ok(())
}

/// Vacuum journal by time.
pub async fn vacuum_time(host: &SystemdHost, max_time: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "journalctl", &["--vacuum-time", max_time]).await?;
    Ok(())
}

/// List boots.
pub async fn list_boots(host: &SystemdHost) -> Result<Vec<BootEntry>, SystemdError> {
    let stdout = client::exec_ok(host, "journalctl", &["--list-boots", "--no-pager"]).await?;
    Ok(parse_boots(&stdout))
}

fn priority_str(p: &JournalPriority) -> &'static str {
    match p {
        JournalPriority::Emergency => "emerg",
        JournalPriority::Alert => "alert",
        JournalPriority::Critical => "crit",
        JournalPriority::Error => "err",
        JournalPriority::Warning => "warning",
        JournalPriority::Notice => "notice",
        JournalPriority::Info => "info",
        JournalPriority::Debug => "debug",
    }
}

fn parse_journal_json(_output: &str) -> Vec<JournalEntry> {
    // TODO: parse journalctl --output=json lines
    Vec::new()
}

fn parse_bytes_from_output(_output: &str) -> u64 {
    // TODO: parse "Archived and active journals take up X" output
    0
}

fn parse_boots(_output: &str) -> Vec<BootEntry> {
    // TODO: parse journalctl --list-boots
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_str() {
        assert_eq!(priority_str(&JournalPriority::Error), "err");
        assert_eq!(priority_str(&JournalPriority::Warning), "warning");
    }
}
