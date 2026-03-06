// ── postfix log management ───────────────────────────────────────────────────

use crate::client::{shell_escape, PostfixClient};
use crate::error::PostfixResult;
use crate::types::*;

pub struct PostfixLogManager;

impl PostfixLogManager {
    /// Query mail log entries. Reads the last N lines from /var/log/mail.log
    /// and optionally filters by a search string.
    pub async fn query_mail_log(
        client: &PostfixClient,
        lines: Option<u32>,
        filter: Option<&str>,
    ) -> PostfixResult<Vec<PostfixMailLog>> {
        let limit = lines.unwrap_or(200);
        let cmd = match filter {
            Some(f) => format!(
                "tail -n {} /var/log/mail.log 2>/dev/null | grep -i {} || true",
                limit,
                shell_escape(f)
            ),
            None => format!("tail -n {} /var/log/mail.log 2>/dev/null || true", limit),
        };
        let out = client.exec_ssh(&cmd).await?;
        let entries: Vec<PostfixMailLog> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| parse_mail_log_line(l))
            .collect();
        Ok(entries)
    }

    /// List available mail log files.
    pub async fn list_log_files(client: &PostfixClient) -> PostfixResult<Vec<String>> {
        let out = client
            .exec_ssh("ls -1 /var/log/mail* 2>/dev/null || true")
            .await?;
        let files: Vec<String> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect();
        Ok(files)
    }

    /// Gather mail delivery statistics by parsing recent log entries.
    pub async fn get_statistics(client: &PostfixClient) -> PostfixResult<MailStatistics> {
        let out = client
            .exec_ssh(
                "tail -n 10000 /var/log/mail.log 2>/dev/null | \
                awk '
                    /status=sent/    { sent++ }
                    /status=bounced/ { bounced++ }
                    /status=deferred/{ deferred++ }
                    /reject:/        { rejected++ }
                    /hold:/          { held++ }
                    END { printf \"%d %d %d %d %d\", sent+0, bounced+0, deferred+0, rejected+0, held+0 }
                '",
            )
            .await?;
        let parts: Vec<u64> = out
            .stdout
            .trim()
            .split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect();
        let sent = parts.first().copied().unwrap_or(0);
        let bounced = parts.get(1).copied().unwrap_or(0);
        let deferred = parts.get(2).copied().unwrap_or(0);
        let rejected = parts.get(3).copied().unwrap_or(0);
        let held = parts.get(4).copied().unwrap_or(0);
        let total = sent + bounced + deferred + rejected + held;
        Ok(MailStatistics {
            sent,
            bounced,
            deferred,
            rejected,
            held,
            total,
        })
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Parse a syslog-style mail log line.
/// Format: "Mon DD HH:MM:SS hostname process[pid]: queue_id: message"
fn parse_mail_log_line(line: &str) -> PostfixMailLog {
    let parts: Vec<&str> = line.splitn(5, ' ').collect();
    if parts.len() < 5 {
        return PostfixMailLog {
            timestamp: None,
            hostname: None,
            process: None,
            pid: None,
            queue_id: None,
            message: line.to_string(),
        };
    }

    // Timestamp: first 3 tokens "Mon DD HH:MM:SS"
    let timestamp = if parts.len() >= 3 {
        Some(format!("{} {} {}", parts[0], parts[1], parts[2]))
    } else {
        None
    };

    let hostname = parts.get(3).map(|s| s.to_string());

    // Process and PID: "postfix/smtp[12345]:"
    let rest = parts.get(4).unwrap_or(&"");
    let (process, pid, message_part) = if let Some(colon_idx) = rest.find(':') {
        let proc_part = &rest[..colon_idx];
        let msg = rest[colon_idx + 1..].trim();
        let (proc_name, pid_val) = if let Some(bracket_start) = proc_part.find('[') {
            let proc_name = &proc_part[..bracket_start];
            let pid_str = proc_part[bracket_start + 1..].trim_end_matches(']');
            (Some(proc_name.to_string()), pid_str.parse::<u32>().ok())
        } else {
            (Some(proc_part.to_string()), None)
        };
        (proc_name, pid_val, msg.to_string())
    } else {
        (None, None, rest.to_string())
    };

    // Extract queue ID from message (typically the first token before ':')
    let queue_id = message_part
        .split(':')
        .next()
        .and_then(|token| {
            let t = token.trim();
            // Queue IDs are hex strings, typically 10-12 chars
            if !t.is_empty()
                && t.len() <= 20
                && t.chars().all(|c| c.is_ascii_hexdigit())
            {
                Some(t.to_string())
            } else {
                None
            }
        });

    PostfixMailLog {
        timestamp,
        hostname,
        process,
        pid,
        queue_id,
        message: message_part,
    }
}
