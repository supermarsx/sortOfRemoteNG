//! Log parsing — read, tail, and search fail2ban logs.

use crate::client::{self, CommandResult};
use crate::error::Fail2banError;
use crate::types::{Fail2banHost, LogAction, LogEntry, LogLevel};
use chrono::{NaiveDateTime, TimeZone, Utc};
use regex::Regex;

const DEFAULT_LOG_PATH: &str = "/var/log/fail2ban.log";
const MAX_TAIL_LINES: u32 = 10_000;

pub async fn tail_log(
    host: &Fail2banHost,
    lines: u32,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    if !(1..=MAX_TAIL_LINES).contains(&lines) {
        return Err(Fail2banError::ConfigError(format!(
            "tail lines must be 1-{MAX_TAIL_LINES}"
        )));
    }
    let path = checked_path(log_path)?;
    let line_count = lines.to_string();
    let output = run_checked(host, "tail", &["-n", &line_count, "--", path], "tail log").await?;
    Ok(parse_log_lines(&output.stdout))
}

pub async fn read_log(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = checked_path(log_path)?;
    let output = run_checked(host, "cat", &["--", path], "read log").await?;
    Ok(parse_log_lines(&output.stdout))
}

pub async fn search_by_ip(
    host: &Fail2banHost,
    ip: &str,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    client::validate_ip_or_host(ip)?;
    search(host, "-F", ip, log_path, "search log by IP").await
}

pub async fn search_by_jail(
    host: &Fail2banHost,
    jail_name: &str,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    client::validate_safe_name(jail_name, "jail name")?;
    let pattern = format!("[{jail_name}]");
    search(host, "-F", &pattern, log_path, "search log by jail").await
}

pub async fn search_bans(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    search(host, "-E", r"\bBan\b", log_path, "search ban events").await
}

pub async fn search_unbans(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    search(host, "-E", r"\bUnban\b", log_path, "search unban events").await
}

pub async fn search_by_time_range(
    host: &Fail2banHost,
    start: &NaiveDateTime,
    end: &NaiveDateTime,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let entries = read_log(host, log_path).await?;
    Ok(entries
        .into_iter()
        .filter(|entry| {
            entry
                .timestamp
                .as_ref()
                .map(|timestamp| {
                    let timestamp = timestamp.naive_utc();
                    timestamp >= *start && timestamp <= *end
                })
                .unwrap_or(false)
        })
        .collect())
}

pub async fn search_custom(
    host: &Fail2banHost,
    pattern: &str,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    client::validate_argument(pattern, "search pattern")?;
    search(host, "-E", pattern, log_path, "search log").await
}

pub async fn log_info(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<LogFileInfo, Fail2banError> {
    let path = checked_path(log_path)?;
    let line_output = run_checked(host, "wc", &["-l", "--", path], "count log lines").await?;
    let line_count = line_output
        .stdout
        .split_whitespace()
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);

    let primary = client::exec_program(
        host,
        host.use_sudo,
        "stat",
        &["-c", "%s", "--", path],
        "read log size",
    )
    .await?;
    let size_output = if primary.exit_code == 0 {
        primary
    } else {
        run_checked(host, "stat", &["-f", "%z", "--", path], "read log size").await?
    };
    let size_bytes = size_output.stdout.trim().parse().unwrap_or(0);

    Ok(LogFileInfo {
        path: path.to_string(),
        line_count,
        size_bytes,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LogFileInfo {
    pub path: String,
    pub line_count: u64,
    pub size_bytes: u64,
}

fn checked_path(log_path: Option<&str>) -> Result<&str, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    client::validate_absolute_path(path, "log path")?;
    Ok(path)
}

async fn run_checked(
    host: &Fail2banHost,
    program: &str,
    args: &[&str],
    operation: &'static str,
) -> Result<CommandResult, Fail2banError> {
    let output = client::exec_program(host, host.use_sudo, program, args, operation).await?;
    client::require_success(operation, output)
}

async fn search(
    host: &Fail2banHost,
    mode: &str,
    pattern: &str,
    log_path: Option<&str>,
    operation: &'static str,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = checked_path(log_path)?;
    let output = client::exec_program(
        host,
        host.use_sudo,
        "grep",
        &[mode, "--", pattern, path],
        operation,
    )
    .await?;
    if output.exit_code > 1 || output.exit_code < 0 {
        return Err(Fail2banError::ClientFailed {
            command: operation.into(),
            exit_code: output.exit_code,
            stderr: output.stderr,
        });
    }
    Ok(parse_log_lines(&output.stdout))
}

pub fn parse_log_lines(content: &str) -> Vec<LogEntry> {
    let line_re = Regex::new(
        r"(?x)
        ^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+
        fail2ban\.(\w+)\s+
        \[\d+\]:\s+
        (\w+)\s+
        (.+)$
        ",
    )
    .expect("valid regex");
    let action_re = Regex::new(
        r"(?x)
        \[(\S+)\]\s+
        (Ban|Unban|Found|Restore\s+Ban|Already\s+banned)\s+
        (\S+)
        ",
    )
    .expect("valid regex");

    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let Some(captures) = line_re.captures(trimmed) else {
                return Some(LogEntry {
                    timestamp: None,
                    level: LogLevel::Info,
                    message: trimmed.to_string(),
                    jail: None,
                    action: None,
                    ip: None,
                    raw_line: trimmed.to_string(),
                });
            };

            let timestamp = NaiveDateTime::parse_from_str(&captures[1], "%Y-%m-%d %H:%M:%S,%3f")
                .ok()
                .map(|value| Utc.from_utc_datetime(&value));
            let level = match &captures[3] {
                "DEBUG" => LogLevel::Debug,
                "INFO" => LogLevel::Info,
                "NOTICE" => LogLevel::Notice,
                "WARNING" | "WARN" => LogLevel::Warning,
                "ERROR" => LogLevel::Error,
                "CRITICAL" => LogLevel::Critical,
                _ => LogLevel::Unknown,
            };
            let message = captures[4].to_string();
            let (jail, action, ip) = action_re
                .captures(&message)
                .map(|action| {
                    let kind = match &action[2] {
                        "Ban" => LogAction::Ban,
                        "Unban" => LogAction::Unban,
                        "Found" => LogAction::Found,
                        value if value.starts_with("Restore") => LogAction::Restore,
                        value if value.starts_with("Already") => LogAction::AlreadyBanned,
                        value => LogAction::Other(value.to_string()),
                    };
                    (
                        Some(action[1].to_string()),
                        Some(kind),
                        Some(action[3].to_string()),
                    )
                })
                .unwrap_or((None, None, None));
            Some(LogEntry {
                timestamp,
                level,
                jail,
                message,
                ip,
                action,
                raw_line: trimmed.to_string(),
            })
        })
        .collect()
}
