//! # opkssh Audit
//!
//! Parse and manage opkssh audit output for identity and access reviews.

use crate::types::*;
use chrono::{NaiveDateTime, Utc, DateTime};
use log::debug;

/// Build the command to run `opkssh audit` on a remote server.
pub fn build_audit_command(principal: Option<&str>, limit: Option<usize>) -> String {
    let mut cmd = "sudo opkssh audit".to_string();
    if let Some(p) = principal {
        cmd.push_str(&format!(" --principal {}", p));
    }
    if let Some(l) = limit {
        cmd.push_str(&format!(" --limit {}", l));
    }
    cmd
}

/// Parse the raw audit output into structured entries.
pub fn parse_audit_output(raw: &str) -> AuditResult {
    let mut entries = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("---") {
            continue;
        }

        // Attempt to parse structured audit lines
        // Format varies but typically includes: timestamp identity principal issuer action status
        if let Some(entry) = parse_audit_line(trimmed) {
            entries.push(entry);
        }
    }

    let total_count = entries.len();
    AuditResult {
        entries,
        total_count,
        raw_output: raw.to_string(),
    }
}

/// Parse a single audit line.
fn parse_audit_line(line: &str) -> Option<AuditEntry> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }

    // Try to parse various formats
    // Common format: TIMESTAMP IDENTITY PRINCIPAL ISSUER ACTION STATUS [SOURCE_IP]
    let (timestamp, rest_start) = try_parse_timestamp(parts.as_slice());

    let rest = &parts[rest_start..];
    if rest.is_empty() {
        return None;
    }

    // Best-effort parsing
    let identity = rest.first().unwrap_or(&"").to_string();
    let principal = rest.get(1).unwrap_or(&"").to_string();
    let issuer = rest.get(2).unwrap_or(&"").to_string();
    let action = rest.get(3).unwrap_or(&"login").to_string();
    let success_str = rest.get(4).unwrap_or(&"true");
    let success = *success_str == "true" || *success_str == "success" || *success_str == "allowed";
    let source_ip = rest.get(5).map(|s| s.to_string());
    let details = if rest.len() > 6 {
        Some(rest[6..].join(" "))
    } else {
        None
    };

    Some(AuditEntry {
        timestamp,
        identity,
        principal,
        issuer,
        action,
        source_ip,
        success,
        details,
    })
}

/// Try to parse a timestamp from the beginning of the parts.
fn try_parse_timestamp(parts: &[&str]) -> (Option<DateTime<Utc>>, usize) {
    if parts.is_empty() {
        return (None, 0);
    }

    // Try ISO 8601 format in first token
    if let Ok(dt) = parts[0].parse::<DateTime<Utc>>() {
        return (Some(dt), 1);
    }

    // Try "YYYY-MM-DD HH:MM:SS" across two tokens
    if parts.len() >= 2 {
        let combined = format!("{} {}", parts[0], parts[1]);
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&combined, "%Y-%m-%d %H:%M:%S") {
            return (Some(DateTime::from_naive_utc_and_offset(ndt, Utc)), 2);
        }
    }

    (None, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_audit_command_basic() {
        let cmd = build_audit_command(None, None);
        assert_eq!(cmd, "sudo opkssh audit");
    }

    #[test]
    fn test_build_audit_command_with_options() {
        let cmd = build_audit_command(Some("root"), Some(50));
        assert_eq!(cmd, "sudo opkssh audit --principal root --limit 50");
    }

    #[test]
    fn test_parse_audit_output_empty() {
        let result = parse_audit_output("");
        assert_eq!(result.total_count, 0);
    }

    #[test]
    fn test_parse_audit_line_basic() {
        let entry = parse_audit_line("alice@gmail.com root https://accounts.google.com login success");
        assert!(entry.is_some());
        let e = entry.unwrap();
        assert_eq!(e.identity, "alice@gmail.com");
        assert_eq!(e.principal, "root");
        assert!(e.success);
    }
}
