//! User crontab management — crontab -l / -e / -r per user.

use crate::client;
use crate::error::CronError;
use crate::types::{CronHost, CronJob, CronJobSource, CronSchedule, CrontabEntry};
use std::collections::HashMap;
use uuid::Uuid;

/// List users that have crontabs installed.
/// Checks /var/spool/cron/crontabs/ (Debian) and /var/spool/cron/ (RHEL).
pub async fn list_user_crontabs(host: &CronHost) -> Result<Vec<String>, CronError> {
    // Try Debian-style first, then RHEL-style
    let (stdout, _stderr, exit_code) = client::exec(
        host,
        "sh",
        &[
            "-c",
            "ls /var/spool/cron/crontabs/ 2>/dev/null || ls /var/spool/cron/ 2>/dev/null",
        ],
    )
    .await?;

    if exit_code != 0 {
        return Ok(Vec::new());
    }

    let users: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(users)
}

/// Read a user's crontab and parse it into entries.
pub async fn get_crontab(host: &CronHost, user: &str) -> Result<Vec<CrontabEntry>, CronError> {
    let (stdout, stderr, exit_code) = client::exec(host, "crontab", &["-l", "-u", user]).await?;

    // "no crontab for <user>" is exit 1 — return empty
    if exit_code != 0 {
        if stderr.contains("no crontab for") {
            return Ok(Vec::new());
        }
        return Err(CronError::CommandFailed {
            command: format!("crontab -l -u {user}"),
            exit_code,
            stderr,
        });
    }

    parse_crontab(&stdout, user)
}

/// Set a user's entire crontab from a list of entries (crontab - via stdin).
pub async fn set_crontab(
    host: &CronHost,
    user: &str,
    entries: &[CrontabEntry],
) -> Result<(), CronError> {
    let content = entries_to_string(entries);
    client::exec_with_stdin(host, "crontab", &["-u", user, "-"], &content).await?;
    Ok(())
}

/// Append a job to a user's crontab.
pub async fn add_job(host: &CronHost, user: &str, job: &CronJob) -> Result<(), CronError> {
    let mut entries = get_crontab(host, user).await?;

    // If there's a comment, add it before the job
    if !job.comment.is_empty() {
        entries.push(CrontabEntry::Comment {
            text: format!("# {}", job.comment),
        });
    }

    // Add environment variables
    for (key, value) in &job.environment {
        entries.push(CrontabEntry::Variable {
            key: key.clone(),
            value: value.clone(),
        });
    }

    entries.push(CrontabEntry::Job(job.clone()));
    set_crontab(host, user, &entries).await
}

/// Remove a job by id from a user's crontab.
pub async fn remove_job(host: &CronHost, user: &str, job_id: &str) -> Result<(), CronError> {
    let entries = get_crontab(host, user).await?;
    let filtered: Vec<CrontabEntry> = entries
        .into_iter()
        .filter(|e| {
            if let CrontabEntry::Job(j) = e {
                j.id != job_id
            } else {
                true
            }
        })
        .collect();
    set_crontab(host, user, &filtered).await
}

/// Update a job in-place in the user's crontab.
pub async fn update_job(
    host: &CronHost,
    user: &str,
    job_id: &str,
    job: &CronJob,
) -> Result<(), CronError> {
    let entries = get_crontab(host, user).await?;
    let mut found = false;
    let updated: Vec<CrontabEntry> = entries
        .into_iter()
        .map(|e| {
            if let CrontabEntry::Job(ref j) = e {
                if j.id == job_id {
                    found = true;
                    return CrontabEntry::Job(job.clone());
                }
            }
            e
        })
        .collect();

    if !found {
        return Err(CronError::JobNotFound(job_id.to_string()));
    }

    set_crontab(host, user, &updated).await
}

/// Enable (uncomment) a job in the user's crontab.
pub async fn enable_job(host: &CronHost, user: &str, job_id: &str) -> Result<(), CronError> {
    let entries = get_crontab(host, user).await?;
    let mut found = false;
    let updated: Vec<CrontabEntry> = entries
        .into_iter()
        .map(|e| {
            if let CrontabEntry::Job(ref j) = e {
                if j.id == job_id {
                    found = true;
                    let mut enabled = j.clone();
                    enabled.enabled = true;
                    return CrontabEntry::Job(enabled);
                }
            }
            e
        })
        .collect();

    if !found {
        return Err(CronError::JobNotFound(job_id.to_string()));
    }

    set_crontab(host, user, &updated).await
}

/// Disable (comment out) a job in the user's crontab.
pub async fn disable_job(host: &CronHost, user: &str, job_id: &str) -> Result<(), CronError> {
    let entries = get_crontab(host, user).await?;
    let mut found = false;
    let updated: Vec<CrontabEntry> = entries
        .into_iter()
        .map(|e| {
            if let CrontabEntry::Job(ref j) = e {
                if j.id == job_id {
                    found = true;
                    let mut disabled = j.clone();
                    disabled.enabled = false;
                    return CrontabEntry::Job(disabled);
                }
            }
            e
        })
        .collect();

    if !found {
        return Err(CronError::JobNotFound(job_id.to_string()));
    }

    set_crontab(host, user, &updated).await
}

/// Remove a user's crontab entirely.
pub async fn remove_crontab(host: &CronHost, user: &str) -> Result<(), CronError> {
    client::exec_ok(host, "crontab", &["-r", "-u", user]).await?;
    Ok(())
}

/// Back up a user's crontab as raw text.
pub async fn backup_crontab(host: &CronHost, user: &str) -> Result<String, CronError> {
    let (stdout, stderr, exit_code) = client::exec(host, "crontab", &["-l", "-u", user]).await?;

    if exit_code != 0 {
        if stderr.contains("no crontab for") {
            return Ok(String::new());
        }
        return Err(CronError::CommandFailed {
            command: format!("crontab -l -u {user}"),
            exit_code,
            stderr,
        });
    }
    Ok(stdout)
}

/// Restore a user's crontab from raw text content.
pub async fn restore_crontab(host: &CronHost, user: &str, content: &str) -> Result<(), CronError> {
    client::exec_with_stdin(host, "crontab", &["-u", user, "-"], content).await?;
    Ok(())
}

// ─── Parsing helpers ────────────────────────────────────────────────

/// Parse raw crontab text into structured entries.
pub fn parse_crontab(raw: &str, user: &str) -> Result<Vec<CrontabEntry>, CronError> {
    let mut entries = Vec::new();
    let mut env: HashMap<String, String> = HashMap::new();
    let mut pending_comment = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            entries.push(CrontabEntry::Blank);
            continue;
        }

        // Environment variable: KEY=value (but not a comment, not starting with digit/*)
        if !trimmed.starts_with('#') {
            if let Some((key, value)) = parse_env_var(trimmed) {
                env.insert(key.clone(), value.clone());
                entries.push(CrontabEntry::Variable { key, value });
                continue;
            }
        }

        // Pure comment line
        if trimmed.starts_with('#') {
            // Check if it's a commented-out cron job: #minute hour dom month dow command
            let uncommented = trimmed.trim_start_matches('#').trim();
            if let Some(job) = try_parse_cron_line(uncommented, user, &env) {
                let mut disabled_job = job;
                disabled_job.enabled = false;
                if !pending_comment.is_empty() {
                    disabled_job.comment = pending_comment.clone();
                    pending_comment.clear();
                }
                entries.push(CrontabEntry::Job(disabled_job));
            } else {
                pending_comment = trimmed.to_string();
                entries.push(CrontabEntry::Comment {
                    text: trimmed.to_string(),
                });
            }
            continue;
        }

        // Regular cron job line
        if let Some(mut job) = try_parse_cron_line(trimmed, user, &env) {
            if !pending_comment.is_empty() {
                job.comment = pending_comment.clone();
                pending_comment.clear();
            }
            entries.push(CrontabEntry::Job(job));
        } else {
            // Treat unparseable lines as comments
            entries.push(CrontabEntry::Comment {
                text: trimmed.to_string(),
            });
        }
    }

    Ok(entries)
}

/// Try to parse a line as KEY=VALUE (environment variable).
fn parse_env_var(line: &str) -> Option<(String, String)> {
    // Must have '=' and key must be a valid identifier
    let eq_pos = line.find('=')?;
    let key = line[..eq_pos].trim();
    let value = line[eq_pos + 1..].trim();

    // Key must be non-empty and consist of alphanumeric/underscore chars
    if key.is_empty() {
        return None;
    }
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    // Reject if key starts with a digit (it's probably a cron schedule)
    if key.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    // Reject if key is a single * or contains * (likely a cron line)
    if key.contains('*') {
        return None;
    }

    let unquoted = value.trim_matches('"').trim_matches('\'').to_string();
    Some((key.to_string(), unquoted))
}

/// Try to parse a cron-format line: min hour dom month dow command
fn try_parse_cron_line(line: &str, user: &str, env: &HashMap<String, String>) -> Option<CronJob> {
    // Handle @presets
    if line.starts_with('@') {
        let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
        if parts.len() < 2 {
            return None;
        }
        let preset = parts[0];
        let command = parts[1].trim().to_string();

        let schedule = match preset {
            "@reboot" => CronSchedule {
                minute: "@reboot".to_string(),
                hour: String::new(),
                day_of_month: String::new(),
                month: String::new(),
                day_of_week: String::new(),
            },
            "@yearly" | "@annually" => CronSchedule {
                minute: "0".into(),
                hour: "0".into(),
                day_of_month: "1".into(),
                month: "1".into(),
                day_of_week: "*".into(),
            },
            "@monthly" => CronSchedule {
                minute: "0".into(),
                hour: "0".into(),
                day_of_month: "1".into(),
                month: "*".into(),
                day_of_week: "*".into(),
            },
            "@weekly" => CronSchedule {
                minute: "0".into(),
                hour: "0".into(),
                day_of_month: "*".into(),
                month: "*".into(),
                day_of_week: "0".into(),
            },
            "@daily" | "@midnight" => CronSchedule {
                minute: "0".into(),
                hour: "0".into(),
                day_of_month: "*".into(),
                month: "*".into(),
                day_of_week: "*".into(),
            },
            "@hourly" => CronSchedule {
                minute: "0".into(),
                hour: "*".into(),
                day_of_month: "*".into(),
                month: "*".into(),
                day_of_week: "*".into(),
            },
            _ => return None,
        };

        return Some(CronJob {
            id: Uuid::new_v4().to_string(),
            schedule,
            command,
            user: user.to_string(),
            comment: String::new(),
            enabled: true,
            environment: env.clone(),
            source: CronJobSource::UserCrontab,
        });
    }

    // Standard 5-field schedule
    let fields: Vec<&str> = line.splitn(6, char::is_whitespace).collect();
    if fields.len() < 6 {
        return None;
    }

    // Basic validation: each of the first 5 fields should look like cron fields
    for field in &fields[..5] {
        if !is_cron_field(field) {
            return None;
        }
    }

    let schedule = CronSchedule {
        minute: fields[0].to_string(),
        hour: fields[1].to_string(),
        day_of_month: fields[2].to_string(),
        month: fields[3].to_string(),
        day_of_week: fields[4].to_string(),
    };

    Some(CronJob {
        id: Uuid::new_v4().to_string(),
        schedule,
        command: fields[5].trim().to_string(),
        user: user.to_string(),
        comment: String::new(),
        enabled: true,
        environment: env.clone(),
        source: CronJobSource::UserCrontab,
    })
}

/// Basic check: is this a valid cron field token?
fn is_cron_field(field: &str) -> bool {
    if field.is_empty() {
        return false;
    }
    // Valid chars: digits, *, /, -, comma, and alpha for month/day names
    field
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '*' || c == '/' || c == '-' || c == ',')
}

/// Convert entries back to crontab file text.
pub fn entries_to_string(entries: &[CrontabEntry]) -> String {
    let mut lines = Vec::with_capacity(entries.len());
    for entry in entries {
        lines.push(entry.to_line());
    }
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_crontab() {
        let raw = r#"# Daily backup
0 2 * * * /usr/local/bin/backup.sh
MAILTO=admin@example.com
*/5 * * * * /usr/bin/check_health

# Disabled job
#0 3 * * * /usr/local/bin/cleanup.sh
"#;
        let entries = parse_crontab(raw, "root").unwrap();
        // Comment, Job, Variable, Job, Blank, Comment(disabled becomes Job), Blank
        let job_count = entries
            .iter()
            .filter(|e| matches!(e, CrontabEntry::Job(_)))
            .count();
        assert_eq!(job_count, 3); // backup, check_health, disabled cleanup

        // Check that disabled job is detected
        let disabled: Vec<_> = entries
            .iter()
            .filter_map(|e| {
                if let CrontabEntry::Job(j) = e {
                    if !j.enabled {
                        Some(j)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(disabled.len(), 1);
        assert!(disabled[0].command.contains("cleanup"));
    }

    #[test]
    fn parse_env_var_line() {
        assert_eq!(
            parse_env_var("MAILTO=admin@example.com"),
            Some(("MAILTO".to_string(), "admin@example.com".to_string()))
        );
        assert_eq!(
            parse_env_var("PATH=\"/usr/bin:/usr/local/bin\""),
            Some(("PATH".to_string(), "/usr/bin:/usr/local/bin".to_string()))
        );
        // Cron line should not match
        assert_eq!(parse_env_var("0 2 * * * /bin/backup"), None);
    }

    #[test]
    fn parse_preset_lines() {
        let raw = "@hourly /usr/bin/hourly_check\n@daily /usr/bin/daily_report\n";
        let entries = parse_crontab(raw, "root").unwrap();
        let jobs: Vec<_> = entries
            .iter()
            .filter_map(|e| {
                if let CrontabEntry::Job(j) = e {
                    Some(j)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].schedule.minute, "0");
        assert_eq!(jobs[0].schedule.hour, "*");
        assert_eq!(jobs[1].schedule.minute, "0");
        assert_eq!(jobs[1].schedule.hour, "0");
    }

    #[test]
    fn entries_roundtrip() {
        let entries = vec![
            CrontabEntry::Comment {
                text: "# My crontab".to_string(),
            },
            CrontabEntry::Variable {
                key: "SHELL".to_string(),
                value: "/bin/bash".to_string(),
            },
            CrontabEntry::Job(CronJob {
                id: "test-1".to_string(),
                schedule: CronSchedule {
                    minute: "0".into(),
                    hour: "2".into(),
                    day_of_month: "*".into(),
                    month: "*".into(),
                    day_of_week: "*".into(),
                },
                command: "/usr/bin/backup".to_string(),
                user: "root".to_string(),
                comment: String::new(),
                enabled: true,
                environment: HashMap::new(),
                source: CronJobSource::UserCrontab,
            }),
            CrontabEntry::Blank,
        ];
        let text = entries_to_string(&entries);
        assert!(text.contains("# My crontab"));
        assert!(text.contains("SHELL=/bin/bash"));
        assert!(text.contains("0 2 * * * /usr/bin/backup"));
    }
}
