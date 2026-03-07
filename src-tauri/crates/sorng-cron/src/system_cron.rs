//! System cron directories — /etc/cron.d/, /etc/crontab, periodic scripts.

use crate::client;
use crate::crontab::parse_crontab;
use crate::error::CronError;
use crate::types::{CronHost, CronJob, CronJobSource, CronSchedule, CrontabEntry};
use std::collections::HashMap;
use uuid::Uuid;

// ─── /etc/cron.d/ management ────────────────────────────────────────

/// List files in /etc/cron.d/.
pub async fn list_system_cron_files(host: &CronHost) -> Result<Vec<String>, CronError> {
    let (stdout, _stderr, exit_code) =
        client::exec(host, "ls", &["-1", "/etc/cron.d/"]).await?;

    if exit_code != 0 {
        return Ok(Vec::new());
    }

    let files: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('.'))
        .collect();
    Ok(files)
}

/// Read and parse a file from /etc/cron.d/.
pub async fn get_system_cron_file(
    host: &CronHost,
    name: &str,
) -> Result<Vec<CrontabEntry>, CronError> {
    validate_filename(name)?;
    let path = format!("/etc/cron.d/{name}");
    let stdout = client::exec_ok(host, "cat", &[&path]).await?;
    parse_system_crontab(&stdout, name)
}

/// Create a new file in /etc/cron.d/.
pub async fn create_system_cron_file(
    host: &CronHost,
    name: &str,
    entries: &[CrontabEntry],
) -> Result<(), CronError> {
    validate_filename(name)?;
    let path = format!("/etc/cron.d/{name}");

    // Check it doesn't already exist
    let (_stdout, _stderr, exit_code) =
        client::exec(host, "test", &["-f", &path]).await?;
    if exit_code == 0 {
        return Err(CronError::Other(format!("File {path} already exists")));
    }

    let content = system_entries_to_string(entries);
    write_file_via_tee(host, &path, &content).await
}

/// Update (overwrite) a file in /etc/cron.d/.
pub async fn update_system_cron_file(
    host: &CronHost,
    name: &str,
    entries: &[CrontabEntry],
) -> Result<(), CronError> {
    validate_filename(name)?;
    let path = format!("/etc/cron.d/{name}");
    let content = system_entries_to_string(entries);
    write_file_via_tee(host, &path, &content).await
}

/// Delete a file from /etc/cron.d/.
pub async fn delete_system_cron_file(
    host: &CronHost,
    name: &str,
) -> Result<(), CronError> {
    validate_filename(name)?;
    let path = format!("/etc/cron.d/{name}");
    client::exec_ok(host, "rm", &["-f", &path]).await?;
    Ok(())
}

// ─── Periodic scripts (/etc/cron.{hourly,daily,weekly,monthly}) ─────

/// List scripts in /etc/cron.{hourly,daily,weekly,monthly}.
pub async fn list_periodic_jobs(
    host: &CronHost,
) -> Result<HashMap<String, Vec<String>>, CronError> {
    let mut result = HashMap::new();

    for period in &["hourly", "daily", "weekly", "monthly"] {
        let dir = format!("/etc/cron.{period}");
        let (stdout, _stderr, exit_code) =
            client::exec(host, "ls", &["-1", &dir]).await?;

        let scripts = if exit_code == 0 {
            stdout
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !l.starts_with('.'))
                .collect()
        } else {
            Vec::new()
        };

        result.insert(period.to_string(), scripts);
    }

    Ok(result)
}

/// Add a script to a periodic directory.
pub async fn add_periodic_script(
    host: &CronHost,
    period: &str,
    name: &str,
    content: &str,
) -> Result<(), CronError> {
    validate_period(period)?;
    validate_filename(name)?;
    let path = format!("/etc/cron.{period}/{name}");

    // Write the script
    write_file_via_tee(host, &path, content).await?;

    // Make it executable
    client::exec_ok(host, "chmod", &["+x", &path]).await?;
    Ok(())
}

/// Remove a script from a periodic directory.
pub async fn remove_periodic_script(
    host: &CronHost,
    period: &str,
    name: &str,
) -> Result<(), CronError> {
    validate_period(period)?;
    validate_filename(name)?;
    let path = format!("/etc/cron.{period}/{name}");
    client::exec_ok(host, "rm", &["-f", &path]).await?;
    Ok(())
}

// ─── /etc/crontab ───────────────────────────────────────────────────

/// Read and parse /etc/crontab (the system-wide crontab).
pub async fn get_etc_crontab(host: &CronHost) -> Result<Vec<CrontabEntry>, CronError> {
    let stdout = client::exec_ok(host, "cat", &["/etc/crontab"]).await?;
    parse_system_crontab(&stdout, "/etc/crontab")
}

// ─── Parsing helpers for system crontab ─────────────────────────────

/// Parse a system crontab (like /etc/crontab or /etc/cron.d/*), which has a
/// USER field between the schedule and the command (6th field is user, 7th+ is command).
fn parse_system_crontab(raw: &str, source_name: &str) -> Result<Vec<CrontabEntry>, CronError> {
    let mut entries = Vec::new();
    let mut env: HashMap<String, String> = HashMap::new();

    for line in raw.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            entries.push(CrontabEntry::Blank);
            continue;
        }

        if trimmed.starts_with('#') {
            // Check if it looks like a commented-out system cron job
            let uncommented = trimmed.trim_start_matches('#').trim();
            if let Some(job) = try_parse_system_cron_line(uncommented, source_name, &env) {
                let mut disabled = job;
                disabled.enabled = false;
                entries.push(CrontabEntry::Job(disabled));
            } else {
                entries.push(CrontabEntry::Comment {
                    text: trimmed.to_string(),
                });
            }
            continue;
        }

        // Environment variable
        if let Some((key, value)) = parse_env_var(trimmed) {
            env.insert(key.clone(), value.clone());
            entries.push(CrontabEntry::Variable { key, value });
            continue;
        }

        // System cron entry: min hour dom month dow USER command
        if let Some(job) = try_parse_system_cron_line(trimmed, source_name, &env) {
            entries.push(CrontabEntry::Job(job));
        } else {
            // Fall back to user-style (5-field) parsing for simple /etc/crontab entries
            if let Ok(mut user_entries) = parse_crontab(trimmed, "root") {
                entries.append(&mut user_entries);
            } else {
                entries.push(CrontabEntry::Comment {
                    text: trimmed.to_string(),
                });
            }
        }
    }

    Ok(entries)
}

/// Parse a system cron line: min hour dom month dow USER command
fn try_parse_system_cron_line(
    line: &str,
    source_name: &str,
    env: &HashMap<String, String>,
) -> Option<CronJob> {
    // Handle @presets with user field
    if line.starts_with('@') {
        let parts: Vec<&str> = line.splitn(3, char::is_whitespace).collect();
        if parts.len() < 3 {
            return None;
        }
        let preset = parts[0];
        let user = parts[1].trim();
        let command = parts[2].trim().to_string();

        let schedule = match preset {
            "@reboot" => CronSchedule {
                minute: "@reboot".into(),
                hour: String::new(),
                day_of_month: String::new(),
                month: String::new(),
                day_of_week: String::new(),
            },
            "@yearly" | "@annually" => CronSchedule {
                minute: "0".into(), hour: "0".into(), day_of_month: "1".into(),
                month: "1".into(), day_of_week: "*".into(),
            },
            "@monthly" => CronSchedule {
                minute: "0".into(), hour: "0".into(), day_of_month: "1".into(),
                month: "*".into(), day_of_week: "*".into(),
            },
            "@weekly" => CronSchedule {
                minute: "0".into(), hour: "0".into(), day_of_month: "*".into(),
                month: "*".into(), day_of_week: "0".into(),
            },
            "@daily" | "@midnight" => CronSchedule {
                minute: "0".into(), hour: "0".into(), day_of_month: "*".into(),
                month: "*".into(), day_of_week: "*".into(),
            },
            "@hourly" => CronSchedule {
                minute: "0".into(), hour: "*".into(), day_of_month: "*".into(),
                month: "*".into(), day_of_week: "*".into(),
            },
            _ => return None,
        };

        let source = if source_name == "/etc/crontab" {
            CronJobSource::EtcCrontab
        } else {
            CronJobSource::SystemCrond {
                filename: source_name.to_string(),
            }
        };

        return Some(CronJob {
            id: Uuid::new_v4().to_string(),
            schedule,
            command,
            user: user.to_string(),
            comment: String::new(),
            enabled: true,
            environment: env.clone(),
            source,
        });
    }

    // Standard: min hour dom month dow USER command
    // Use split_whitespace to handle multiple spaces/tabs, then collect
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 7 {
        return None;
    }
    // Reconstruct: first 6 tokens are schedule+user, rest is command
    let fields: Vec<&str> = {
        let mut v: Vec<&str> = tokens[..6].to_vec();
        // Rejoin the command part from the original line
        // Find where the 6th token ends in the original line
        let mut pos = 0;
        for i in 0..6 {
            pos = line[pos..].find(tokens[i]).map(|p| p + pos + tokens[i].len()).unwrap_or(pos);
        }
        let cmd = line[pos..].trim();
        v.push(cmd);
        v
    };
    if fields.len() < 7 || fields[6].is_empty() {
        return None;
    }

    // Validate cron fields
    for field in &fields[..5] {
        if !is_cron_field(field) {
            return None;
        }
    }

    let user = fields[5].trim();
    let command = fields[6].trim().to_string();

    // User field should look like a username (alphanumeric, dash, underscore)
    if !user
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }

    let source = if source_name == "/etc/crontab" {
        CronJobSource::EtcCrontab
    } else {
        CronJobSource::SystemCrond {
            filename: source_name.to_string(),
        }
    };

    Some(CronJob {
        id: Uuid::new_v4().to_string(),
        schedule: CronSchedule {
            minute: fields[0].to_string(),
            hour: fields[1].to_string(),
            day_of_month: fields[2].to_string(),
            month: fields[3].to_string(),
            day_of_week: fields[4].to_string(),
        },
        command,
        user: user.to_string(),
        comment: String::new(),
        enabled: true,
        environment: env.clone(),
        source,
    })
}

/// Render system crontab entries (includes user field in job lines).
fn system_entries_to_string(entries: &[CrontabEntry]) -> String {
    let mut lines = Vec::with_capacity(entries.len());
    for entry in entries {
        match entry {
            CrontabEntry::Job(job) => {
                let prefix = if job.enabled { "" } else { "#" };
                lines.push(format!("{}{} {} {}", prefix, job.schedule, job.user, job.command));
            }
            other => lines.push(other.to_line()),
        }
    }
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Write content to a file via tee (works with sudo).
async fn write_file_via_tee(
    host: &CronHost,
    path: &str,
    content: &str,
) -> Result<(), CronError> {
    client::exec_with_stdin(host, "tee", &[path], content).await?;
    Ok(())
}

fn is_cron_field(field: &str) -> bool {
    if field.is_empty() {
        return false;
    }
    // Must start with *, digit, or a recognized 3-letter month/day name
    let first = field.as_bytes()[0];
    if first != b'*' && !first.is_ascii_digit() {
        // Allow 3-letter month/day abbreviations in ranges/lists
        let lower = field.to_lowercase();
        let names = [
            "jan", "feb", "mar", "apr", "may", "jun",
            "jul", "aug", "sep", "oct", "nov", "dec",
            "sun", "mon", "tue", "wed", "thu", "fri", "sat",
        ];
        for part in lower.split(|c: char| c == ',' || c == '-' || c == '/') {
            if part.is_empty() {
                continue;
            }
            if part.parse::<u32>().is_ok() {
                continue;
            }
            if part == "*" {
                continue;
            }
            if !names.contains(&part) {
                return false;
            }
        }
    }
    field
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '*' || c == '/' || c == '-' || c == ',')
}

fn parse_env_var(line: &str) -> Option<(String, String)> {
    let eq_pos = line.find('=')?;
    let key = line[..eq_pos].trim();
    let value = line[eq_pos + 1..].trim();

    if key.is_empty() {
        return None;
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return None;
    }
    if key.chars().next().map_or(false, |c| c.is_ascii_digit()) {
        return None;
    }
    if key.contains('*') {
        return None;
    }

    let unquoted = value.trim_matches('"').trim_matches('\'').to_string();
    Some((key.to_string(), unquoted))
}

fn validate_filename(name: &str) -> Result<(), CronError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\0')
        || name.starts_with('.')
        || name.starts_with('-')
        || name == "."
        || name == ".."
    {
        return Err(CronError::ParseError(format!(
            "Invalid filename: {name}"
        )));
    }
    // cron.d filenames must match [a-zA-Z0-9_-]+
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(CronError::ParseError(format!(
            "Invalid cron.d filename (must be alphanumeric, underscore, or dash): {name}"
        )));
    }
    Ok(())
}

fn validate_period(period: &str) -> Result<(), CronError> {
    match period {
        "hourly" | "daily" | "weekly" | "monthly" => Ok(()),
        _ => Err(CronError::ParseError(format!(
            "Invalid periodic directory: {period} (must be hourly, daily, weekly, or monthly)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_system_crontab_content() {
        let raw = r#"# /etc/crontab: system-wide crontab
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# m h dom mon dow user  command
17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly
25 6    * * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )
47 6    * * 7   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.weekly )
52 6    1 * *   root    test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.monthly )
"#;
        let entries = parse_system_crontab(raw, "/etc/crontab").unwrap();
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
        assert_eq!(jobs.len(), 4);
        assert_eq!(jobs[0].user, "root");
        assert!(jobs[0].command.contains("cron.hourly"));
        assert!(matches!(jobs[0].source, CronJobSource::EtcCrontab));
    }

    #[test]
    fn validate_filenames() {
        assert!(validate_filename("my-cron-job").is_ok());
        assert!(validate_filename("backup_daily").is_ok());
        assert!(validate_filename("../etc/passwd").is_err());
        assert!(validate_filename(".hidden").is_err());
        assert!(validate_filename("").is_err());
        assert!(validate_filename("bad file").is_err());
    }

    #[test]
    fn validate_periods() {
        assert!(validate_period("hourly").is_ok());
        assert!(validate_period("daily").is_ok());
        assert!(validate_period("weekly").is_ok());
        assert!(validate_period("monthly").is_ok());
        assert!(validate_period("yearly").is_err());
        assert!(validate_period("").is_err());
    }
}
