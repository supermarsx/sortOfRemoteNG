//! Log parsing — read, tail, and search fail2ban logs.

use crate::error::Fail2banError;
use crate::types::{Fail2banHost, LogAction, LogEntry, LogLevel};
use chrono::{NaiveDateTime, TimeZone, Utc};
use regex::Regex;

/// Default fail2ban log path.
const DEFAULT_LOG_PATH: &str = "/var/log/fail2ban.log";

/// Validate a shell argument that will be placed inside single quotes.
/// Rejects single quotes (which break out of single-quoted strings in sh)
/// and other dangerous characters.
fn validate_shell_arg(value: &str, name: &str) -> Result<(), Fail2banError> {
    if value.is_empty() {
        return Err(Fail2banError::ConfigError(format!("{name} cannot be empty")));
    }
    const BLOCKED: &[char] = &['\'', '"', ';', '`', '$', '|', '&', '\n', '\r', '\0'];
    if value.chars().any(|c| BLOCKED.contains(&c)) {
        return Err(Fail2banError::ConfigError(format!(
            "{name} contains invalid characters"
        )));
    }
    Ok(())
}

/// Validate a log file path — must be absolute, no traversal, no shell metacharacters.
fn validate_log_path(path: &str) -> Result<(), Fail2banError> {
    if !path.starts_with('/') {
        return Err(Fail2banError::ConfigError("Log path must be absolute".into()));
    }
    if path.contains("..") {
        return Err(Fail2banError::ConfigError("Log path must not contain '..'".into()));
    }
    if !path.chars().all(|c| c.is_alphanumeric() || matches!(c, '/' | '-' | '_' | '.')) {
        return Err(Fail2banError::ConfigError("Log path contains invalid characters".into()));
    }
    Ok(())
}

/// Read the last N lines from the fail2ban log.
pub async fn tail_log(
    host: &Fail2banHost,
    lines: u32,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    let cmd = build_read_cmd(host, &format!("tail -n {lines} '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Read the full log file.
pub async fn read_log(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    let cmd = build_read_cmd(host, &format!("cat '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Search log entries by IP address.
pub async fn search_by_ip(
    host: &Fail2banHost,
    ip: &str,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    validate_shell_arg(ip, "IP address")?;
    let cmd = build_read_cmd(host, &format!("grep -F '{ip}' '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Search log entries by jail name.
pub async fn search_by_jail(
    host: &Fail2banHost,
    jail_name: &str,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    validate_shell_arg(jail_name, "jail name")?;
    let cmd = build_read_cmd(host, &format!("grep -F '[{jail_name}]' '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Search log for Ban events only.
pub async fn search_bans(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    let cmd = build_read_cmd(host, &format!("grep -E '\\bBan\\b' '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Search log for Unban events only.
pub async fn search_unbans(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    let cmd = build_read_cmd(host, &format!("grep -E '\\bUnban\\b' '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Search log entries within a specific time range.
pub async fn search_by_time_range(
    host: &Fail2banHost,
    start: &NaiveDateTime,
    end: &NaiveDateTime,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let entries = read_log(host, log_path).await?;

    Ok(entries
        .into_iter()
        .filter(|e| {
            if let Some(ts) = &e.timestamp {
                let entry_time = ts.naive_utc();
                return entry_time >= *start && entry_time <= *end;
            }
            false
        })
        .collect())
}

/// Search log with a custom grep pattern.
pub async fn search_custom(
    host: &Fail2banHost,
    pattern: &str,
    log_path: Option<&str>,
) -> Result<Vec<LogEntry>, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    validate_shell_arg(pattern, "search pattern")?;
    let cmd = build_read_cmd(host, &format!("grep -E '{pattern}' '{path}'"));

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(parse_log_lines(&stdout))
}

/// Get the log file size and line count.
pub async fn log_info(
    host: &Fail2banHost,
    log_path: Option<&str>,
) -> Result<LogFileInfo, Fail2banError> {
    let path = log_path.unwrap_or(DEFAULT_LOG_PATH);
    validate_log_path(path)?;
    let cmd = build_read_cmd(
        host,
        &format!("wc -l '{path}' && stat -c %s '{path}' 2>/dev/null || stat -f %z '{path}' 2>/dev/null"),
    );

    let output = run_cmd(host, &cmd).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut line_count: u64 = 0;
    let mut size_bytes: u64 = 0;

    let lines: Vec<&str> = stdout.lines().collect();
    if let Some(first) = lines.first() {
        if let Some(count_str) = first.split_whitespace().next() {
            line_count = count_str.parse().unwrap_or(0);
        }
    }
    if let Some(second) = lines.get(1) {
        size_bytes = second.trim().parse().unwrap_or(0);
    }

    Ok(LogFileInfo {
        path: path.to_string(),
        line_count,
        size_bytes,
    })
}

// ─── Types ──────────────────────────────────────────────────────────

/// Metadata about a log file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LogFileInfo {
    pub path: String,
    pub line_count: u64,
    pub size_bytes: u64,
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Build the shell command with optional sudo.
fn build_read_cmd(host: &Fail2banHost, cmd: &str) -> String {
    if host.use_sudo {
        format!("sudo {cmd}")
    } else {
        cmd.to_string()
    }
}

/// Execute a command on the host.
async fn run_cmd(host: &Fail2banHost, cmd: &str) -> Result<std::process::Output, Fail2banError> {
    let output = if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let mut command = tokio::process::Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            command.arg(arg);
        }
        command.arg(cmd);
        command.output().await
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", cmd])
            .output()
            .await
    };

    output.map_err(|e| Fail2banError::ProcessError(format!("log command failed: {e}")))
}

/// Parse a block of log file content into structured entries.
pub fn parse_log_lines(content: &str) -> Vec<LogEntry> {
    // Typical fail2ban log format:
    // 2024-01-15 10:30:45,123 fail2ban.actions        [12345]: NOTICE  [sshd] Ban 192.168.1.100
    // 2024-01-15 10:30:45,123 fail2ban.filter          [12345]: INFO    [sshd] Found 192.168.1.100 - 2024-01-15 10:30:44

    let line_re = Regex::new(
        r"(?x)
        ^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+  # timestamp
        fail2ban\.(\w+)\s+                                      # component
        \[\d+\]:\s+                                             # PID
        (\w+)\s+                                                # level
        (.+)$                                                   # message
        ",
    )
    .expect("valid regex");

    let action_re = Regex::new(
        r"(?x)
        \[(\S+)\]\s+                 # jail name
        (Ban|Unban|Found|Restore\s+Ban|Already\s+banned)\s+  # action
        (\S+)                        # IP address
        ",
    )
    .expect("valid regex");

    let mut entries = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(caps) = line_re.captures(trimmed) {
            let timestamp = caps[1].to_string();
            let _component = &caps[2];
            let level_str = &caps[3];
            let message = caps[4].to_string();

            let level = match level_str {
                "DEBUG" => LogLevel::Debug,
                "INFO" => LogLevel::Info,
                "NOTICE" => LogLevel::Notice,
                "WARNING" | "WARN" => LogLevel::Warning,
                "ERROR" => LogLevel::Error,
                "CRITICAL" => LogLevel::Critical,
                _ => LogLevel::Info,
            };

            let mut jail = None;
            let mut action = None;
            let mut ip = None;

            if let Some(acaps) = action_re.captures(&message) {
                jail = Some(acaps[1].to_string());
                action = Some(match &acaps[2] {
                    "Ban" => LogAction::Ban,
                    "Unban" => LogAction::Unban,
                    "Found" => LogAction::Found,
                    a if a.starts_with("Restore") => LogAction::Restore,
                    a if a.starts_with("Already") => LogAction::AlreadyBanned,
                    _ => LogAction::Other(acaps[2].to_string()),
                });
                ip = Some(acaps[3].to_string());
            }

            let parsed_ts = NaiveDateTime::parse_from_str(&timestamp, "%Y-%m-%d %H:%M:%S,%3f")
                .ok()
                .map(|ndt| Utc.from_utc_datetime(&ndt));

            entries.push(LogEntry {
                timestamp: parsed_ts,
                level,
                message: message.clone(),
                jail,
                action,
                ip,
                raw_line: trimmed.to_string(),
            });
        } else {
            // Non-standard log line — capture as-is
            entries.push(LogEntry {
                timestamp: None,
                level: LogLevel::Info,
                message: trimmed.to_string(),
                jail: None,
                action: None,
                ip: None,
                raw_line: trimmed.to_string(),
            });
        }
    }

    entries
}
