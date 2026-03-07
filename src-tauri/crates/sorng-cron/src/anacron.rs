//! Anacron management — /etc/anacrontab and /var/spool/anacron/.

use crate::client;
use crate::error::CronError;
use crate::types::{AnacronEntry, CronHost};
use chrono::{DateTime, NaiveDate, Utc};
use std::collections::HashMap;

/// Read and parse /etc/anacrontab.
pub async fn get_anacrontab(host: &CronHost) -> Result<Vec<AnacronEntry>, CronError> {
    let stdout = client::exec_ok(host, "cat", &["/etc/anacrontab"]).await?;
    parse_anacrontab(&stdout)
}

/// Add a new entry to /etc/anacrontab.
pub async fn add_anacron_entry(
    host: &CronHost,
    entry: &AnacronEntry,
) -> Result<(), CronError> {
    let mut entries = get_anacrontab(host).await?;

    // Check for duplicate job_identifier
    if entries
        .iter()
        .any(|e| e.job_identifier == entry.job_identifier)
    {
        return Err(CronError::Other(format!(
            "Anacron entry with identifier '{}' already exists",
            entry.job_identifier
        )));
    }

    entries.push(entry.clone());
    write_anacrontab(host, &entries).await
}

/// Update an existing anacron entry by job_identifier.
pub async fn update_anacron_entry(
    host: &CronHost,
    job_id: &str,
    entry: &AnacronEntry,
) -> Result<(), CronError> {
    let entries = get_anacrontab(host).await?;
    let mut found = false;
    let updated: Vec<AnacronEntry> = entries
        .into_iter()
        .map(|e| {
            if e.job_identifier == job_id {
                found = true;
                entry.clone()
            } else {
                e
            }
        })
        .collect();

    if !found {
        return Err(CronError::JobNotFound(job_id.to_string()));
    }

    write_anacrontab(host, &updated).await
}

/// Remove an anacron entry by job_identifier.
pub async fn remove_anacron_entry(
    host: &CronHost,
    job_id: &str,
) -> Result<(), CronError> {
    let entries = get_anacrontab(host).await?;
    let initial_len = entries.len();
    let filtered: Vec<AnacronEntry> = entries
        .into_iter()
        .filter(|e| e.job_identifier != job_id)
        .collect();

    if filtered.len() == initial_len {
        return Err(CronError::JobNotFound(job_id.to_string()));
    }

    write_anacrontab(host, &filtered).await
}

/// Run anacron, optionally with `-f` (force).
pub async fn run_anacron(host: &CronHost, force: bool) -> Result<String, CronError> {
    let args: Vec<&str> = if force {
        vec!["-f", "-n"]
    } else {
        vec!["-n"]
    };
    client::exec_ok(host, "anacron", &args).await
}

/// Read anacron timestamp files from /var/spool/anacron/.
/// Returns a map of job_identifier -> last run timestamp.
pub async fn get_anacron_timestamps(
    host: &CronHost,
) -> Result<HashMap<String, DateTime<Utc>>, CronError> {
    let (ls_out, _stderr, exit_code) =
        client::exec(host, "ls", &["-1", "/var/spool/anacron/"]).await?;

    if exit_code != 0 {
        return Ok(HashMap::new());
    }

    let mut timestamps = HashMap::new();

    for filename in ls_out.lines() {
        let filename = filename.trim();
        if filename.is_empty() || filename.starts_with('.') {
            continue;
        }

        let path = format!("/var/spool/anacron/{filename}");
        let (content, _stderr, exit_code) =
            client::exec(host, "cat", &[&path]).await?;

        if exit_code != 0 {
            continue;
        }

        let date_str = content.trim();
        // Anacron timestamps are YYYYMMDD format
        if let Some(dt) = parse_anacron_timestamp(date_str) {
            timestamps.insert(filename.to_string(), dt);
        }
    }

    Ok(timestamps)
}

// ─── Parsing helpers ────────────────────────────────────────────────

/// Parse /etc/anacrontab content.
///
/// Format: period_in_days  delay_in_minutes  job-identifier  command
/// Lines starting with # are comments; blank lines are ignored.
/// Environment variables (SHELL=, PATH=, etc.) are also present.
fn parse_anacrontab(raw: &str) -> Result<Vec<AnacronEntry>, CronError> {
    let mut entries = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();

        // Skip blank lines, comments, and environment variable lines
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.contains('=') && !trimmed.starts_with(|c: char| c.is_ascii_digit()) && !trimmed.starts_with('@') {
            continue;
        }

        // Handle @monthly, @weekly, etc. anacron special periods
        let effective_line = if trimmed.starts_with('@') {
            // @monthly → 30, @weekly → 7, @daily → 1
            let (preset, rest) = trimmed.split_once(char::is_whitespace).unwrap_or((trimmed, ""));
            let period = match preset {
                "@monthly" => "30",
                "@weekly" => "7",
                "@daily" => "1",
                "@yearly" | "@annually" => "365",
                _ => {
                    continue; // unknown preset, skip
                }
            };
            format!("{period}\t{rest}")
        } else {
            trimmed.to_string()
        };

        let fields: Vec<&str> = effective_line.splitn(4, char::is_whitespace).collect();
        if fields.len() < 4 {
            continue;
        }

        let period_days: u32 = fields[0].parse().map_err(|_| {
            CronError::ParseError(format!("Invalid period in anacrontab line: {trimmed}"))
        })?;
        let delay_minutes: u32 = fields[1].parse().map_err(|_| {
            CronError::ParseError(format!("Invalid delay in anacrontab line: {trimmed}"))
        })?;
        let job_identifier = fields[2].to_string();
        let command = fields[3].trim().to_string();

        entries.push(AnacronEntry {
            period_days,
            delay_minutes,
            job_identifier,
            command,
        });
    }

    Ok(entries)
}

/// Write the full /etc/anacrontab file.
/// Preserves a standard header with SHELL and PATH.
async fn write_anacrontab(
    host: &CronHost,
    entries: &[AnacronEntry],
) -> Result<(), CronError> {
    // Read existing file to preserve env vars and comments at the top
    let (existing, _stderr, _exit_code) =
        client::exec(host, "cat", &["/etc/anacrontab"]).await?;

    let mut header_lines = Vec::new();
    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            header_lines.push(line.to_string());
            continue;
        }
        // Keep environment variables
        if trimmed.contains('=') && !trimmed.starts_with(|c: char| c.is_ascii_digit()) {
            header_lines.push(line.to_string());
            continue;
        }
        // Stop at first actual entry
        break;
    }

    let mut content = header_lines.join("\n");
    if !content.ends_with('\n') {
        content.push('\n');
    }

    for entry in entries {
        content.push_str(&entry.to_line());
        content.push('\n');
    }

    client::exec_with_stdin(host, "tee", &["/etc/anacrontab"], &content).await?;
    Ok(())
}

/// Parse YYYYMMDD date from anacron timestamp file.
fn parse_anacron_timestamp(s: &str) -> Option<DateTime<Utc>> {
    let trimmed = s.trim();
    if trimmed.len() != 8 {
        return None;
    }
    let date = NaiveDate::parse_from_str(trimmed, "%Y%m%d").ok()?;
    let datetime = date.and_hms_opt(0, 0, 0)?;
    Some(DateTime::<Utc>::from_naive_utc_and_offset(datetime, Utc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_anacrontab_content() {
        let raw = r#"# /etc/anacrontab: configuration file for anacron
# See anacron(8) and anacrontab(5) for details.

SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
HOME=/root
LOGNAME=root

# These replace cron's entries
1	5	cron.daily	run-parts --report /etc/cron.daily
7	10	cron.weekly	run-parts --report /etc/cron.weekly
@monthly	15	cron.monthly	run-parts --report /etc/cron.monthly
"#;
        let entries = parse_anacrontab(raw).unwrap();
        // 1 (daily), 7 (weekly), 30 (@monthly → 30)
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].period_days, 1);
        assert_eq!(entries[0].delay_minutes, 5);
        assert_eq!(entries[0].job_identifier, "cron.daily");
        assert!(entries[0].command.contains("cron.daily"));
        assert_eq!(entries[1].period_days, 7);
        assert_eq!(entries[2].period_days, 30);
        assert_eq!(entries[2].job_identifier, "cron.monthly");
    }

    #[test]
    fn parse_timestamp() {
        let dt = parse_anacron_timestamp("20260307").unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2026-03-07");
    }

    #[test]
    fn anacron_entry_to_line() {
        let entry = AnacronEntry {
            period_days: 1,
            delay_minutes: 5,
            job_identifier: "cron.daily".to_string(),
            command: "run-parts --report /etc/cron.daily".to_string(),
        };
        assert_eq!(entry.to_line(), "1\t5\tcron.daily\trun-parts --report /etc/cron.daily");
    }
}
