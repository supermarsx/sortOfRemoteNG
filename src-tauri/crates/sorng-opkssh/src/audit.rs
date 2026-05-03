//! # opkssh Audit
//!
//! Parse and manage opkssh audit output for identity and access reviews.
//! Audit remains an admin-oriented CLI bridge in the first shipping version;
//! the builder below now uses a shell wrapper with positional arguments so the
//! remote `opkssh audit` invocation no longer interpolates user input directly
//! into the command body.

use crate::types::*;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Default)]
struct StructuredAuditReport {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    username: String,
    #[serde(default)]
    providers_file: StructuredAuditProviderFile,
    #[serde(default)]
    system_policy: StructuredAuditPolicyFile,
    #[serde(default)]
    home_policy: Vec<StructuredAuditPolicyFile>,
    #[serde(default)]
    opk_version: String,
    #[serde(default)]
    openssh_version: String,
    #[serde(default)]
    os_info: String,
}

#[derive(Debug, Deserialize, Default)]
struct StructuredAuditProviderFile {
    #[serde(default)]
    file_path: String,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Deserialize, Default)]
struct StructuredAuditPolicyFile {
    #[serde(default)]
    file_path: String,
    #[serde(default)]
    rows: Vec<serde_json::Value>,
    #[serde(default)]
    error: String,
    #[serde(default)]
    perms_error: String,
}

/// Build the command to run `opkssh audit` on a remote server.
pub fn build_audit_command(principal: Option<&str>, limit: Option<usize>) -> String {
    let principal_arg = principal
        .filter(|principal| !principal.trim().is_empty())
        .unwrap_or("");
    let limit_arg = limit.map(|value| value.to_string()).unwrap_or_default();

    render_sudo_sh_command(
        r#"set -- opkssh audit
if [ -n "$1" ]; then
    set -- "$@" --principal "$1"
fi
if [ -n "$2" ]; then
    set -- "$@" --limit "$2"
fi
exec "$@""#,
        &[principal_arg, &limit_arg],
    )
}

/// Parse the raw audit output into structured entries.
pub fn parse_audit_output(raw: &str) -> AuditResult {
    if let Some(structured) = parse_structured_audit_output(raw) {
        return structured;
    }

    parse_cli_audit_output(raw)
}

fn parse_structured_audit_output(raw: &str) -> Option<AuditResult> {
    let trimmed = raw.trim();
    if !trimmed.starts_with('{') {
        return None;
    }

    let report = serde_json::from_str::<StructuredAuditReport>(trimmed).ok()?;
    let mut entries = Vec::new();
    let identity = default_identity(&report.username);

    if let Some(entry) = summarize_provider_file(&identity, &report.providers_file) {
        entries.push(entry);
    }

    if let Some(entry) = summarize_policy_file(&identity, "system-policy", &report.system_policy) {
        entries.push(entry);
    }

    for home_policy in &report.home_policy {
        if let Some(entry) = summarize_policy_file(&identity, "user-policy", home_policy) {
            entries.push(entry);
        }
    }

    if entries.is_empty() {
        entries.push(AuditEntry {
            timestamp: None,
            identity,
            principal: "summary".to_string(),
            issuer: report.os_info,
            action: "audit-summary".to_string(),
            source_ip: None,
            success: report.ok,
            details: Some(format!(
                "opkssh={} openssh={}",
                empty_to_dash(&report.opk_version),
                empty_to_dash(&report.openssh_version)
            )),
        });
    }

    let total_count = entries.len();
    Some(AuditResult {
        entries,
        total_count,
        raw_output: raw.to_string(),
    })
}

fn summarize_provider_file(
    identity: &str,
    provider_file: &StructuredAuditProviderFile,
) -> Option<AuditEntry> {
    if provider_file.file_path.is_empty() && provider_file.error.is_empty() {
        return None;
    }

    Some(AuditEntry {
        timestamp: None,
        identity: identity.to_string(),
        principal: "providers".to_string(),
        issuer: provider_file.file_path.clone(),
        action: "providers-file".to_string(),
        source_ip: None,
        success: provider_file.error.is_empty(),
        details: if provider_file.error.is_empty() {
            Some("provider file validated via admin bridge".to_string())
        } else {
            Some(provider_file.error.clone())
        },
    })
}

fn summarize_policy_file(
    identity: &str,
    action: &str,
    policy_file: &StructuredAuditPolicyFile,
) -> Option<AuditEntry> {
    if policy_file.file_path.is_empty()
        && policy_file.rows.is_empty()
        && policy_file.error.is_empty()
        && policy_file.perms_error.is_empty()
    {
        return None;
    }

    let principal = Path::new(&policy_file.file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(action)
        .to_string();

    let mut details = Vec::new();
    if !policy_file.error.is_empty() {
        details.push(policy_file.error.clone());
    }
    if !policy_file.perms_error.is_empty() {
        details.push(format!("permissions: {}", policy_file.perms_error));
    }
    if !policy_file.rows.is_empty() {
        details.push(format!("rows={}", policy_file.rows.len()));
    }

    Some(AuditEntry {
        timestamp: None,
        identity: identity.to_string(),
        principal,
        issuer: policy_file.file_path.clone(),
        action: action.to_string(),
        source_ip: None,
        success: policy_file.error.is_empty() && policy_file.perms_error.is_empty(),
        details: if details.is_empty() {
            None
        } else {
            Some(details.join("; "))
        },
    })
}

fn parse_cli_audit_output(raw: &str) -> AuditResult {
    let mut entries = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("---") {
            continue;
        }

        if let Some(entry) = parse_cli_audit_line(trimmed) {
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
fn parse_cli_audit_line(line: &str) -> Option<AuditEntry> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }

    let (timestamp, rest_start) = try_parse_timestamp(parts.as_slice());
    let rest = &parts[rest_start..];
    if rest.is_empty() {
        return None;
    }

    let identity = rest.first().unwrap_or(&"").to_string();
    let principal = rest.get(1).unwrap_or(&"").to_string();
    let issuer = rest.get(2).unwrap_or(&"").to_string();
    let action = rest.get(3).unwrap_or(&"login").to_string();
    let success_str = rest.get(4).unwrap_or(&"true");
    let success = *success_str == "true" || *success_str == "success" || *success_str == "allowed";
    let source_ip = rest.get(5).map(|source_ip| source_ip.to_string());
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

    if let Ok(date_time) = parts[0].parse::<DateTime<Utc>>() {
        return (Some(date_time), 1);
    }

    if parts.len() >= 2 {
        let combined = format!("{} {}", parts[0], parts[1]);
        if let Ok(date_time) = NaiveDateTime::parse_from_str(&combined, "%Y-%m-%d %H:%M:%S") {
            return (Some(DateTime::from_naive_utc_and_offset(date_time, Utc)), 2);
        }
    }

    (None, 0)
}

fn default_identity(username: &str) -> String {
    if username.trim().is_empty() {
        "system".to_string()
    } else {
        username.to_string()
    }
}

fn empty_to_dash(value: &str) -> &str {
    if value.trim().is_empty() {
        "-"
    } else {
        value
    }
}

fn render_sudo_sh_command(script: &str, args: &[&str]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 5);
    parts.push("sudo".to_string());
    parts.push("sh".to_string());
    parts.push("-c".to_string());
    parts.push(shell_escape(script));
    parts.push("sh".to_string());
    for arg in args {
        parts.push(shell_escape(arg));
    }
    parts.join(" ")
}

fn shell_escape(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    if value.chars().all(is_shell_safe_char) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn is_shell_safe_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || matches!(
            character,
            '_' | '-' | '/' | '.' | ':' | '@' | '%' | '+' | '=' | ','
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_audit_command_basic() {
        let cmd = build_audit_command(None, None);
        assert!(cmd.starts_with("sudo sh -c "));
        assert!(cmd.contains("set -- opkssh audit"));
        assert!(cmd.ends_with(" sh '' ''"));
    }

    #[test]
    fn test_build_audit_command_with_options() {
        let cmd = build_audit_command(Some("root"), Some(50));
        assert!(cmd.starts_with("sudo sh -c "));
        assert!(cmd.contains("set -- \"$@\" --principal \"$1\""));
        assert!(cmd.contains("set -- \"$@\" --limit \"$2\""));
        assert!(cmd.ends_with(" sh root 50"));
    }

    #[test]
    fn test_build_audit_command_uses_positional_principal_argument() {
        let cmd = build_audit_command(Some("root user"), Some(50));
        assert!(cmd.contains("exec \"$@\""));
        assert!(cmd.ends_with(" sh 'root user' 50"));
    }

    #[test]
    fn test_parse_audit_output_empty() {
        let result = parse_audit_output("");
        assert_eq!(result.total_count, 0);
    }

    #[test]
    fn test_parse_audit_line_basic() {
        let entry =
            parse_cli_audit_line("alice@gmail.com root https://accounts.google.com login success");
        assert!(entry.is_some());
        let e = entry.unwrap();
        assert_eq!(e.identity, "alice@gmail.com");
        assert_eq!(e.principal, "root");
        assert!(e.success);
    }

    #[test]
    fn test_parse_structured_audit_output_summarizes_admin_bridge() {
        let raw = r#"{
    "ok": true,
    "username": "ubuntu",
    "providers_file": {
        "file_path": "/etc/opk/providers",
        "error": ""
    },
    "system_policy": {
        "file_path": "/etc/opk/auth_id",
        "rows": [{"ok": true}],
        "error": "",
        "perms_error": ""
    },
    "home_policy": [],
    "opk_version": "0.13.0",
    "openssh_version": "OpenSSH_9.6",
    "os_info": "linux"
}"#;

        let result = parse_audit_output(raw);
        assert_eq!(result.total_count, 2);
        assert_eq!(result.entries[0].action, "providers-file");
        assert_eq!(result.entries[1].action, "system-policy");
        assert_eq!(result.entries[1].principal, "auth_id");
        assert!(result
            .entries
            .iter()
            .all(|entry| entry.identity == "ubuntu"));
    }
}
