//! Journal log management — journalctl queries, disk usage, vacuum.

use chrono::{DateTime, NaiveDateTime, Utc};
use std::collections::HashMap;

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Query journal logs.
pub async fn query(
    host: &SystemdHost,
    opts: &JournalQueryOpts,
) -> Result<Vec<JournalEntry>, SystemdError> {
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

fn parse_journal_json(output: &str) -> Vec<JournalEntry> {
    let known_keys = [
        "__REALTIME_TIMESTAMP",
        "_HOSTNAME",
        "_SYSTEMD_UNIT",
        "SYSLOG_IDENTIFIER",
        "_PID",
        "PRIORITY",
        "MESSAGE",
        "__CURSOR",
        "_BOOT_ID",
    ];
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(obj) = v.as_object() else {
            continue;
        };

        let timestamp_us: i64 = obj
            .get("__REALTIME_TIMESTAMP")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let timestamp = DateTime::<Utc>::from_timestamp(
            timestamp_us / 1_000_000,
            ((timestamp_us % 1_000_000) * 1000) as u32,
        )
        .unwrap_or_default();

        let hostname = obj
            .get("_HOSTNAME")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let unit = obj
            .get("_SYSTEMD_UNIT")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let syslog_identifier = obj
            .get("SYSLOG_IDENTIFIER")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let pid = obj
            .get("_PID")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok());
        let priority_num: u32 = obj
            .get("PRIORITY")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(6);
        let priority = match priority_num {
            0 => JournalPriority::Emergency,
            1 => JournalPriority::Alert,
            2 => JournalPriority::Critical,
            3 => JournalPriority::Error,
            4 => JournalPriority::Warning,
            5 => JournalPriority::Notice,
            7 => JournalPriority::Debug,
            _ => JournalPriority::Info,
        };
        let message = obj
            .get("MESSAGE")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cursor = obj
            .get("__CURSOR")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let boot_id = obj
            .get("_BOOT_ID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut extra_fields = HashMap::new();
        for (k, v) in obj {
            if !known_keys.contains(&k.as_str()) {
                if let Some(s) = v.as_str() {
                    extra_fields.insert(k.clone(), s.to_string());
                }
            }
        }

        entries.push(JournalEntry {
            timestamp,
            hostname,
            unit,
            syslog_identifier,
            pid,
            priority,
            message,
            cursor,
            boot_id,
            extra_fields,
        });
    }
    entries
}

fn parse_bytes_from_output(output: &str) -> u64 {
    for line in output.lines() {
        let line = line.trim();
        if !line.contains("take up") {
            continue;
        }
        if let Some(start) = line.find("take up ") {
            let after = &line[start + 8..];
            if let Some(end) = after.find(" in") {
                return parse_byte_size(after[..end].trim());
            }
        }
    }
    0
}

fn parse_byte_size(s: &str) -> u64 {
    let s = s.trim();
    if let Some(v) = s.strip_suffix('G') {
        (v.parse::<f64>().unwrap_or(0.0) * 1_073_741_824.0) as u64
    } else if let Some(v) = s.strip_suffix('M') {
        (v.parse::<f64>().unwrap_or(0.0) * 1_048_576.0) as u64
    } else if let Some(v) = s.strip_suffix('K') {
        (v.parse::<f64>().unwrap_or(0.0) * 1024.0) as u64
    } else if let Some(v) = s.strip_suffix('B') {
        v.trim().parse().unwrap_or(0)
    } else {
        s.parse().unwrap_or(0)
    }
}

fn parse_boots(output: &str) -> Vec<BootEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, char::is_whitespace).collect();
        if parts.len() < 3 {
            continue;
        }

        let offset: i32 = parts[0].parse().unwrap_or(0);
        let boot_id = parts[1].to_string();
        let rest = parts[2].trim();

        // Split on em-dash (—) separating first and last timestamps
        let (first_str, last_str) = if let Some(pos) = rest.find('\u{2014}') {
            (&rest[..pos], &rest[pos + '\u{2014}'.len_utf8()..])
        } else {
            continue;
        };

        let first_entry = parse_systemd_timestamp(first_str.trim()).unwrap_or_default();
        let last_entry = parse_systemd_timestamp(last_str.trim()).unwrap_or_default();

        entries.push(BootEntry {
            boot_id,
            first_entry,
            last_entry,
            offset,
        });
    }
    entries
}

fn parse_systemd_timestamp(s: &str) -> Option<DateTime<Utc>> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    let date_idx = parts.iter().position(|p| {
        p.len() == 10 && p.as_bytes().get(4) == Some(&b'-') && p.as_bytes().get(7) == Some(&b'-')
    })?;
    if date_idx + 1 >= parts.len() {
        return None;
    }
    let datetime_str = format!("{} {}", parts[date_idx], parts[date_idx + 1]);
    let naive = NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%d %H:%M:%S").ok()?;
    Some(naive.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_str() {
        assert_eq!(priority_str(&JournalPriority::Error), "err");
        assert_eq!(priority_str(&JournalPriority::Warning), "warning");
    }

    #[test]
    fn test_parse_journal_json() {
        let output = r#"{"__REALTIME_TIMESTAMP":"1704067200000000","_HOSTNAME":"myhost","_SYSTEMD_UNIT":"sshd.service","SYSLOG_IDENTIFIER":"sshd","_PID":"1234","PRIORITY":"6","MESSAGE":"Server listening","__CURSOR":"s=abc","_BOOT_ID":"boot1"}"#;
        let entries = parse_journal_json(output);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hostname, "myhost");
        assert_eq!(entries[0].unit.as_deref(), Some("sshd.service"));
        assert_eq!(entries[0].pid, Some(1234));
        assert_eq!(entries[0].message, "Server listening");
    }

    #[test]
    fn test_parse_bytes_from_output() {
        assert_eq!(
            parse_bytes_from_output(
                "Archived and active journals take up 1.2G in the file system."
            ),
            (1.2 * 1_073_741_824.0) as u64
        );
        assert_eq!(
            parse_bytes_from_output("Journals take up 512.0M in the file system."),
            (512.0 * 1_048_576.0) as u64
        );
    }

    #[test]
    fn test_parse_boots() {
        let output = "-1 abc12345678901234567890123456789012 Thu 2024-01-01 10:00:00 UTC\u{2014}Thu 2024-01-02 15:00:00 UTC\n 0 def45678901234567890123456789012345 Fri 2024-01-03 12:01:00 UTC\u{2014}Fri 2024-01-03 18:00:00 UTC\n";
        let entries = parse_boots(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].offset, -1);
        assert_eq!(entries[0].boot_id, "abc12345678901234567890123456789012");
        assert_eq!(entries[1].offset, 0);
    }
}
