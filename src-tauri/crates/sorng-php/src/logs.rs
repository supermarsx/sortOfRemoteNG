// ── sorng-php – PHP error log management ─────────────────────────────────────
//! Read, rotate, and manage PHP error logs on a remote host.

use crate::client::{shell_escape, PhpClient};
use crate::error::{PhpError, PhpResult};
use crate::types::*;

/// Manages PHP error logs.
pub struct LogManager;

impl LogManager {
    /// Read PHP error log entries. Defaults to the last 100 lines.
    pub async fn read_log(
        client: &PhpClient,
        req: &PhpLogReadRequest,
    ) -> PhpResult<Vec<PhpLogEntry>> {
        let log_path = match req.log_path {
            Some(ref p) => p.clone(),
            None => {
                return Err(PhpError::command_failed(
                    "No log_path specified and no default available",
                ));
            }
        };
        let lines = req.lines.unwrap_or(100);
        let raw = Self::tail_log(client, &log_path, lines).await?;

        let mut entries: Vec<PhpLogEntry> = raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(parse_log_line)
            .collect();

        // Apply optional level filter.
        if let Some(ref level) = req.level_filter {
            let target = format!("{:?}", level).to_lowercase();
            entries.retain(|e| format!("{:?}", e.level).to_lowercase() == target);
        }
        // Apply optional search filter.
        if let Some(ref search) = req.search {
            let needle = search.to_lowercase();
            entries.retain(|e| e.message.to_lowercase().contains(&needle));
        }

        Ok(entries)
    }

    /// Get error logging configuration from php.ini directives.
    pub async fn get_log_config(client: &PhpClient, version: &str) -> PhpResult<PhpLogConfig> {
        let php = client.versioned_php_bin(version);
        let cmd = format!(
            "{php} -r \"echo json_encode([\
                'error_log' => ini_get('error_log') ?: null,\
                'log_errors' => (bool)ini_get('log_errors'),\
                'display_errors' => (bool)ini_get('display_errors'),\
                'error_reporting' => ini_get('error_reporting'),\
                'log_errors_max_len' => (int)ini_get('log_errors_max_len') ?: null,\
                'syslog_facility' => ini_get('syslog.facility') ?: null,\
                'syslog_ident' => ini_get('syslog.ident') ?: null,\
                'syslog_filter' => ini_get('syslog.filter') ?: null,\
            ]);\""
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to read log config: {}",
                out.stderr
            )));
        }
        serde_json::from_str(out.stdout.trim())
            .map_err(|e| PhpError::parse(format!("Failed to parse log config: {e}")))
    }

    /// Get FPM-specific log configuration.
    pub async fn get_fpm_log_config(client: &PhpClient, version: &str) -> PhpResult<FpmLogConfig> {
        let config_path = format!("{}/{}/fpm/php-fpm.conf", client.config_dir(), version);
        let content = client.read_remote_file(&config_path).await?;

        fn extract_value(content: &str, key: &str) -> Option<String> {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with(';') || trimmed.starts_with('#') {
                    continue;
                }
                if let Some(rest) = trimmed.strip_prefix(key) {
                    if let Some(val) = rest.strip_prefix('=') {
                        return Some(val.trim().to_string());
                    }
                    if let Some(val) = rest.strip_prefix(" =") {
                        return Some(val.trim().to_string());
                    }
                }
            }
            None
        }

        Ok(FpmLogConfig {
            error_log: extract_value(&content, "error_log"),
            log_level: extract_value(&content, "log_level"),
            syslog_facility: extract_value(&content, "syslog.facility"),
            syslog_ident: extract_value(&content, "syslog.ident"),
        })
    }

    /// Get the error_log path for a PHP version.
    pub async fn get_log_path(client: &PhpClient, version: &str) -> PhpResult<String> {
        let cmd = format!(
            "{} -r \"echo ini_get('error_log');\"",
            client.versioned_php_bin(version)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to get error_log path: {}",
                out.stderr
            )));
        }
        let path = out.stdout.trim().to_string();
        if path.is_empty() {
            Err(PhpError::config_not_found("error_log directive is empty"))
        } else {
            Ok(path)
        }
    }

    /// Get the FPM error log path from FPM config.
    pub async fn get_fpm_log_path(client: &PhpClient, version: &str) -> PhpResult<String> {
        let config = Self::get_fpm_log_config(client, version).await?;
        config
            .error_log
            .ok_or_else(|| PhpError::config_not_found("FPM error_log not set in php-fpm.conf"))
    }

    /// Truncate a log file.
    pub async fn clear_log(client: &PhpClient, log_path: &str) -> PhpResult<()> {
        let cmd = format!("sudo truncate -s 0 {}", shell_escape(log_path));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to clear log: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Get the last N lines from a log file as raw text.
    pub async fn tail_log(client: &PhpClient, log_path: &str, lines: u32) -> PhpResult<String> {
        let cmd = format!("tail -n {} {}", lines, shell_escape(log_path));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to tail log: {}",
                out.stderr
            )));
        }
        Ok(out.stdout)
    }

    /// Get the size of a log file in bytes.
    pub async fn get_log_size(client: &PhpClient, log_path: &str) -> PhpResult<u64> {
        let cmd = format!("stat -c %s {} 2>/dev/null", shell_escape(log_path));
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to get log size: {}",
                out.stderr
            )));
        }
        out.stdout
            .trim()
            .parse()
            .map_err(|e| PhpError::parse(format!("Failed to parse file size: {e}")))
    }

    /// Rotate a log file: rename with timestamp suffix, create empty new file.
    pub async fn rotate_log(client: &PhpClient, log_path: &str) -> PhpResult<()> {
        let cmd = format!(
            "sudo mv {} {}.$(date +%Y%m%d%H%M%S) && sudo touch {} && sudo chmod 640 {}",
            shell_escape(log_path),
            shell_escape(log_path),
            shell_escape(log_path),
            shell_escape(log_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(PhpError::command_failed(format!(
                "Failed to rotate log: {}",
                out.stderr
            )));
        }
        Ok(())
    }
}

/// Parse a single PHP error log line.
/// Expected format: `[DD-Mon-YYYY HH:MM:SS TZ] PHP Level: message in /file on line N`
fn parse_log_line(line: &str) -> PhpLogEntry {
    let mut timestamp = None;
    let mut rest = line;

    // Extract timestamp in brackets.
    if let Some(start) = line.find('[') {
        if let Some(end) = line[start..].find(']') {
            timestamp = Some(line[start + 1..start + end].to_string());
            rest = line[start + end + 1..].trim_start();
        }
    }

    // Try to extract "PHP Level:" prefix.
    let (level, message_start) = if let Some(stripped) = rest.strip_prefix("PHP ") {
        parse_level_prefix(stripped)
    } else {
        (PhpLogLevel::Unknown, rest)
    };

    // Try to extract file and line from " in /path on line N".
    let (message, file, line_number) = extract_file_and_line(message_start);

    PhpLogEntry {
        timestamp,
        level,
        message: message.to_string(),
        file,
        line_number,
        stack_trace: None,
    }
}

fn parse_level_prefix(s: &str) -> (PhpLogLevel, &str) {
    let levels = [
        ("Fatal error:", PhpLogLevel::Emergency),
        ("Parse error:", PhpLogLevel::Critical),
        ("Warning:", PhpLogLevel::Warning),
        ("Notice:", PhpLogLevel::Notice),
        ("Deprecated:", PhpLogLevel::Warning),
        ("Strict Standards:", PhpLogLevel::Notice),
        ("Recoverable fatal error:", PhpLogLevel::Error),
    ];
    for (prefix, level) in &levels {
        if let Some(rest) = s.strip_prefix(prefix) {
            return (level.clone(), rest.trim_start());
        }
    }
    (PhpLogLevel::Unknown, s)
}

fn extract_file_and_line(s: &str) -> (&str, Option<String>, Option<u32>) {
    if let Some(in_pos) = s.rfind(" in ") {
        let after_in = &s[in_pos + 4..];
        if let Some(on_pos) = after_in.rfind(" on line ") {
            let file = after_in[..on_pos].trim().to_string();
            let line_str = after_in[on_pos + 9..].trim();
            let line_num = line_str.parse().ok();
            let message = s[..in_pos].trim();
            return (message, Some(file), line_num);
        }
    }
    (s, None, None)
}
