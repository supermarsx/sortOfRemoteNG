// ── dovecot log management ───────────────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct DovecotLogManager;

impl DovecotLogManager {
    /// Query dovecot log entries via `doveadm log find` or reading log files.
    pub async fn query_log(
        client: &DovecotClient,
        lines: Option<u32>,
        filter: Option<&str>,
    ) -> DovecotResult<Vec<DovecotLog>> {
        let limit = lines.unwrap_or(100);

        // Try to find the log file location from config
        let log_path_out = client
            .exec_ssh(&format!(
                "sudo {} -h log_path 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        let log_path = log_path_out
            .ok()
            .map(|o| o.stdout.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/var/log/dovecot.log".to_string());

        // If log_path is "syslog", use journalctl
        let cmd = if log_path == "syslog" {
            let mut c = format!("journalctl -u dovecot -n {} --no-pager", limit);
            if let Some(f) = filter {
                c.push_str(&format!(" | grep -i {}", shell_escape(f)));
            }
            c
        } else {
            let mut c = format!("sudo tail -n {} {}", limit, shell_escape(&log_path));
            if let Some(f) = filter {
                c.push_str(&format!(" | grep -i {}", shell_escape(f)));
            }
            c
        };

        let out = client.exec_ssh(&cmd).await?;
        let mut logs = Vec::new();

        for line in out.stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            logs.push(parse_dovecot_log_line(line));
        }

        Ok(logs)
    }

    /// List available log files.
    pub async fn list_log_files(client: &DovecotClient) -> DovecotResult<Vec<String>> {
        let mut files = Vec::new();

        // Get configured log paths
        let log_path = client
            .exec_ssh(&format!(
                "sudo {} -h log_path 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        if let Ok(ref o) = log_path {
            let path = o.stdout.trim();
            if !path.is_empty() && path != "syslog" {
                files.push(path.to_string());
            }
        }

        let info_log = client
            .exec_ssh(&format!(
                "sudo {} -h info_log_path 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        if let Ok(ref o) = info_log {
            let path = o.stdout.trim();
            if !path.is_empty() && path != "syslog" {
                files.push(path.to_string());
            }
        }

        let debug_log = client
            .exec_ssh(&format!(
                "sudo {} -h debug_log_path 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        if let Ok(ref o) = debug_log {
            let path = o.stdout.trim();
            if !path.is_empty() && path != "syslog" {
                files.push(path.to_string());
            }
        }

        // Also check common locations
        let common_paths = [
            "/var/log/dovecot.log",
            "/var/log/dovecot-info.log",
            "/var/log/dovecot-debug.log",
            "/var/log/mail.log",
            "/var/log/mail.err",
        ];
        for path in &common_paths {
            let exists = client.file_exists(path).await.unwrap_or(false);
            if exists && !files.contains(&path.to_string()) {
                files.push(path.to_string());
            }
        }

        Ok(files)
    }

    /// Set the log level via doveadm or config modification.
    pub async fn set_log_level(client: &DovecotClient, level: &str) -> DovecotResult<()> {
        // Validate level
        let valid_levels = ["error", "warning", "info", "debug"];
        if !valid_levels.contains(&level) {
            return Err(DovecotError::parse(format!(
                "Invalid log level '{}', expected one of: {}",
                level,
                valid_levels.join(", ")
            )));
        }

        // Set via doveadm log reopen + config change for auth_verbose, auth_debug, mail_debug
        match level {
            "debug" => {
                crate::config::DovecotConfigManager::set_param(client, "auth_debug", "yes").await?;
                crate::config::DovecotConfigManager::set_param(client, "auth_verbose", "yes")
                    .await?;
                crate::config::DovecotConfigManager::set_param(client, "mail_debug", "yes").await?;
            }
            "info" => {
                crate::config::DovecotConfigManager::set_param(client, "auth_debug", "no").await?;
                crate::config::DovecotConfigManager::set_param(client, "auth_verbose", "yes")
                    .await?;
                crate::config::DovecotConfigManager::set_param(client, "mail_debug", "no").await?;
            }
            "warning" | "error" => {
                crate::config::DovecotConfigManager::set_param(client, "auth_debug", "no").await?;
                crate::config::DovecotConfigManager::set_param(client, "auth_verbose", "no")
                    .await?;
                crate::config::DovecotConfigManager::set_param(client, "mail_debug", "no").await?;
            }
            _ => {}
        }

        // Reopen log files
        let _ = client.doveadm("log reopen").await;

        Ok(())
    }

    /// Get current log level by inspecting config.
    pub async fn get_log_level(client: &DovecotClient) -> DovecotResult<String> {
        let auth_debug = crate::config::DovecotConfigManager::get_param(client, "auth_debug")
            .await
            .unwrap_or_else(|_| "no".to_string());
        let auth_verbose = crate::config::DovecotConfigManager::get_param(client, "auth_verbose")
            .await
            .unwrap_or_else(|_| "no".to_string());
        let mail_debug = crate::config::DovecotConfigManager::get_param(client, "mail_debug")
            .await
            .unwrap_or_else(|_| "no".to_string());

        let level = if auth_debug == "yes" || mail_debug == "yes" {
            "debug"
        } else if auth_verbose == "yes" {
            "info"
        } else {
            "warning"
        };

        Ok(level.to_string())
    }
}

/// Parse a dovecot log line into structured form.
/// Common format: "Mon DD HH:MM:SS process(pid): message"
/// Or: "YYYY-MM-DD HH:MM:SS level process[pid]: message"
fn parse_dovecot_log_line(line: &str) -> DovecotLog {
    // Try to parse structured format first
    let parts: Vec<&str> = line.splitn(4, ' ').collect();
    if parts.len() >= 4 {
        // Check if first part looks like a date
        let maybe_date = parts[0];
        if maybe_date.contains('-') || maybe_date.len() == 3 {
            // Likely has a timestamp
            let timestamp = if parts.len() >= 3 {
                Some(format!("{} {}", parts[0], parts[1]))
            } else {
                None
            };

            let rest = if parts.len() >= 4 {
                parts[3]
            } else {
                parts.last().unwrap_or(&"")
            };

            // Try to extract process and pid
            let (process, pid, message) = if let Some(bracket_pos) = rest.find('[') {
                if let Some(close_pos) = rest.find(']') {
                    let proc_name = &rest[..bracket_pos];
                    let pid_str = &rest[bracket_pos + 1..close_pos];
                    let msg = rest[close_pos + 1..].trim_start_matches(':').trim();
                    (
                        Some(proc_name.to_string()),
                        pid_str.parse().ok(),
                        msg.to_string(),
                    )
                } else {
                    (None, None, rest.to_string())
                }
            } else if let Some(colon_pos) = rest.find(':') {
                let proc_part = &rest[..colon_pos];
                let msg = rest[colon_pos + 1..].trim();
                // Extract pid from process(pid) format
                if let Some(paren_pos) = proc_part.find('(') {
                    let proc_name = &proc_part[..paren_pos];
                    let pid_str = proc_part[paren_pos + 1..].trim_end_matches(')');
                    (
                        Some(proc_name.to_string()),
                        pid_str.parse().ok(),
                        msg.to_string(),
                    )
                } else {
                    (Some(proc_part.to_string()), None, msg.to_string())
                }
            } else {
                (None, None, rest.to_string())
            };

            // Try to detect log level
            let level = if parts.len() >= 3 {
                let candidate = parts[2].to_lowercase();
                if ["error", "warning", "info", "debug", "fatal", "panic"]
                    .contains(&candidate.as_str())
                {
                    Some(candidate)
                } else {
                    None
                }
            } else {
                None
            };

            return DovecotLog {
                timestamp,
                level,
                process,
                pid,
                message,
            };
        }
    }

    // Fallback: treat entire line as message
    DovecotLog {
        timestamp: None,
        level: None,
        process: None,
        pid: None,
        message: line.to_string(),
    }
}
