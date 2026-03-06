// ── SpamAssassin log management ──────────────────────────────────────────────

use crate::client::{shell_escape, SpamAssassinClient};
use crate::error::SpamAssassinResult;
use crate::types::*;

pub struct SpamAssassinLogManager;

impl SpamAssassinLogManager {
    /// Query SpamAssassin log entries from syslog/journald or log files.
    pub async fn query(
        client: &SpamAssassinClient,
        lines: Option<u32>,
        filter: Option<&str>,
    ) -> SpamAssassinResult<Vec<SpamLog>> {
        let limit = lines.unwrap_or(100);

        // Try journalctl first (systemd)
        let journal_cmd = {
            let mut c = format!(
                "journalctl -u spamassassin -n {} --no-pager 2>/dev/null",
                limit
            );
            if let Some(f) = filter {
                c.push_str(&format!(" | grep -i {}", shell_escape(f)));
            }
            c
        };

        let journal_out = client.exec_ssh(&journal_cmd).await;

        if let Ok(ref o) = journal_out {
            if !o.stdout.trim().is_empty() {
                return Ok(parse_journal_logs(&o.stdout));
            }
        }

        // Fallback: read /var/log/mail.log or /var/log/syslog
        let log_paths = [
            "/var/log/mail.log",
            "/var/log/syslog",
            "/var/log/maillog",
            "/var/log/spamassassin/spamd.log",
        ];

        for path in &log_paths {
            let exists = client.file_exists(path).await.unwrap_or(false);
            if !exists {
                continue;
            }

            let mut cmd = format!("sudo grep -i spamassassin {} | tail -n {}", shell_escape(path), limit);
            if let Some(f) = filter {
                cmd.push_str(&format!(" | grep -i {}", shell_escape(f)));
            }

            let out = client.exec_ssh(&cmd).await;
            if let Ok(ref o) = out {
                if !o.stdout.trim().is_empty() {
                    return Ok(parse_syslog_lines(&o.stdout));
                }
            }
        }

        Ok(Vec::new())
    }

    /// List available log files that contain SpamAssassin entries.
    pub async fn list_log_files(
        client: &SpamAssassinClient,
    ) -> SpamAssassinResult<Vec<String>> {
        let mut files = Vec::new();

        let common_paths = [
            "/var/log/mail.log",
            "/var/log/mail.err",
            "/var/log/syslog",
            "/var/log/maillog",
            "/var/log/spamassassin/spamd.log",
            "/var/log/spamassassin/sa-update.log",
        ];

        for path in &common_paths {
            let exists = client.file_exists(path).await.unwrap_or(false);
            if exists {
                files.push(path.to_string());
            }
        }

        // Also try to find rotated log files
        let rotated = client
            .exec_ssh("ls /var/log/mail.log.* /var/log/maillog.* /var/log/spamassassin/*.log.* 2>/dev/null")
            .await;
        if let Ok(ref o) = rotated {
            for line in o.stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !files.contains(&trimmed.to_string()) {
                    files.push(trimmed.to_string());
                }
            }
        }

        Ok(files)
    }

    /// Get aggregate spam scanning statistics by parsing recent log entries.
    pub async fn get_statistics(
        client: &SpamAssassinClient,
    ) -> SpamAssassinResult<SpamStatistics> {
        // Parse recent spamd log entries for statistics
        let cmd =
            "journalctl -u spamassassin --no-pager -n 10000 2>/dev/null | grep -i 'result\\|clean\\|identified spam'";
        let out = client.exec_ssh(cmd).await;

        let mut total_scanned = 0u64;
        let mut spam_count = 0u64;
        let mut ham_count = 0u64;
        let mut total_score = 0.0f64;
        let mut total_time = 0.0f64;
        let mut timed_entries = 0u64;

        let log_text = out
            .as_ref()
            .map(|o| o.stdout.as_str())
            .unwrap_or("");

        for line in log_text.lines() {
            let trimmed = line.trim().to_lowercase();
            if trimmed.is_empty() {
                continue;
            }

            total_scanned += 1;

            // Look for spam/ham indication
            if trimmed.contains("identified spam") || trimmed.contains("result: y") {
                spam_count += 1;
            } else if trimmed.contains("clean message") || trimmed.contains("result: .") {
                ham_count += 1;
            }

            // Extract score (patterns: "score=X.X" or "(X.X/Y.Y)")
            if let Some(s) = extract_score_from_log(&trimmed) {
                total_score += s;
            }

            // Extract scan time (patterns: "in X.Xs" or "time=X.Xms")
            if let Some(t) = extract_time_from_log(&trimmed) {
                total_time += t;
                timed_entries += 1;
            }
        }

        // Fallback: if no journal entries, try the log file approach
        if total_scanned == 0 {
            let fallback = client
                .exec_ssh(
                    "sudo grep -c 'spamd:' /var/log/mail.log 2>/dev/null || echo 0",
                )
                .await;
            if let Ok(ref o) = fallback {
                total_scanned = o.stdout.trim().parse().unwrap_or(0);
            }
        }

        let avg_score = if total_scanned > 0 {
            total_score / total_scanned as f64
        } else {
            0.0
        };

        let avg_scan_time_ms = if timed_entries > 0 {
            total_time / timed_entries as f64
        } else {
            0.0
        };

        Ok(SpamStatistics {
            total_scanned,
            spam_count,
            ham_count,
            avg_score,
            avg_scan_time_ms,
        })
    }
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

fn parse_journal_logs(output: &str) -> Vec<SpamLog> {
    let mut logs = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        logs.push(parse_log_entry(trimmed));
    }

    logs
}

fn parse_syslog_lines(output: &str) -> Vec<SpamLog> {
    let mut logs = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        logs.push(parse_log_entry(trimmed));
    }

    logs
}

fn parse_log_entry(line: &str) -> SpamLog {
    // Typical syslog format:
    // "Mar  3 12:00:00 hostname spamd[PID]: spamd: result: Y 5 - RULE1,RULE2 scantime=1.2,size=1234,..."
    // "Mar  3 12:00:00 hostname spamd[PID]: spamd: clean message (1.5/5.0) for user:1001 in 0.5 seconds"

    let parts: Vec<&str> = line.splitn(6, char::is_whitespace).collect();

    let timestamp = if parts.len() >= 3 {
        Some(parts[..3].join(" "))
    } else {
        None
    };

    let hostname = parts.get(3).map(|s| s.to_string());

    let (process, pid) = if let Some(proc_field) = parts.get(4) {
        if let Some(bracket_start) = proc_field.find('[') {
            let proc_name = proc_field[..bracket_start].to_string();
            let pid_str = proc_field[bracket_start + 1..]
                .trim_end_matches(']')
                .trim_end_matches(':');
            let pid = pid_str.parse::<u32>().ok();
            (Some(proc_name), pid)
        } else {
            (Some(proc_field.trim_end_matches(':').to_string()), None)
        }
    } else {
        (None, None)
    };

    let message_part = parts.get(5).unwrap_or(&"");

    // Extract score and threshold
    let (score, threshold) = extract_score_threshold(message_part);

    // Extract result (Y=spam, .=ham)
    let result = if message_part.contains("result: Y")
        || message_part.contains("identified spam")
    {
        Some("spam".to_string())
    } else if message_part.contains("result: .")
        || message_part.contains("clean message")
    {
        Some("ham".to_string())
    } else {
        None
    };

    // Extract message-id if present
    let message_id = extract_between(message_part, "mid=<", ">");

    // Extract rules hit
    let rules_hit = extract_rules_from_log(message_part);

    SpamLog {
        timestamp,
        hostname,
        process,
        pid,
        message_id,
        score,
        threshold,
        result,
        rules_hit,
    }
}

fn extract_score_threshold(s: &str) -> (Option<f64>, Option<f64>) {
    // Pattern: "(5.4/5.0)" or "score=5.4 required=5.0"
    if let Some(start) = s.find('(') {
        if let Some(end) = s[start..].find(')') {
            let inner = &s[start + 1..start + end];
            let parts: Vec<&str> = inner.split('/').collect();
            if parts.len() == 2 {
                let score = parts[0].parse::<f64>().ok();
                let threshold = parts[1].parse::<f64>().ok();
                return (score, threshold);
            }
        }
    }

    // Alternative: "score=X.X required=Y.Y"
    let score = extract_float_after(s, "score=");
    let threshold = extract_float_after(s, "required=");
    (score, threshold)
}

fn extract_float_after(s: &str, key: &str) -> Option<f64> {
    if let Some(idx) = s.find(key) {
        let rest = &s[idx + key.len()..];
        let val = rest
            .split(|c: char| c.is_whitespace() || c == ',' || c == ')')
            .next()
            .unwrap_or("");
        val.parse::<f64>().ok()
    } else {
        None
    }
}

fn extract_between(s: &str, start_delim: &str, end_delim: &str) -> Option<String> {
    if let Some(start) = s.find(start_delim) {
        let after = &s[start + start_delim.len()..];
        if let Some(end) = after.find(end_delim) {
            return Some(after[..end].to_string());
        }
    }
    None
}

fn extract_rules_from_log(s: &str) -> Vec<String> {
    // Pattern: "RULE1,RULE2,RULE3" after "result: Y X - " or "result: . X - "
    if let Some(idx) = s.find(" - ") {
        let after = s[idx + 3..].trim();
        let rules_part = after
            .split(|c: char| c.is_whitespace())
            .next()
            .unwrap_or("");
        if !rules_part.is_empty() && rules_part.contains(',') {
            return rules_part.split(',').map(|r| r.trim().to_string()).collect();
        }
        if !rules_part.is_empty()
            && rules_part
                .chars()
                .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit())
        {
            return vec![rules_part.to_string()];
        }
    }
    Vec::new()
}

fn extract_score_from_log(line: &str) -> Option<f64> {
    // "score=X.X" or "(X.X/Y.Y)"
    extract_float_after(line, "score=").or_else(|| {
        if let Some(start) = line.find('(') {
            if let Some(end) = line[start..].find('/') {
                line[start + 1..start + end].parse::<f64>().ok()
            } else {
                None
            }
        } else {
            None
        }
    })
}

fn extract_time_from_log(line: &str) -> Option<f64> {
    // "in X.Xs" (seconds) -> convert to ms
    if let Some(idx) = line.find(" in ") {
        let after = &line[idx + 4..];
        let time_str = after
            .split(|c: char| c.is_whitespace())
            .next()
            .unwrap_or("");
        if let Some(secs_str) = time_str.strip_suffix('s') {
            if let Ok(secs) = secs_str.parse::<f64>() {
                return Some(secs * 1000.0);
            }
        }
    }
    // "scantime=X.X" (seconds)
    extract_float_after(line, "scantime=").map(|s| s * 1000.0)
}
