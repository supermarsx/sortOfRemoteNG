//! At / batch job scheduling — atq, at, atrm, at.allow/at.deny.

use crate::client;
use crate::error::CronError;
use crate::types::{AtJob, CronAccessControl, CronHost};
use chrono::{DateTime, NaiveDateTime, Utc};

/// List pending at jobs (parses `atq` output).
///
/// atq output format:
///   JOB_ID\tDATE\tQUEUE USERNAME
///   e.g. "3\tThu Mar  7 14:30:00 2026 a root"
pub async fn list_at_jobs(host: &CronHost) -> Result<Vec<AtJob>, CronError> {
    let (stdout, _stderr, exit_code) = client::exec(host, "atq", &[]).await?;

    if exit_code != 0 || stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut jobs = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(job) = parse_atq_line(line) {
            jobs.push(job);
        }
    }

    Ok(jobs)
}

/// Get details for a specific at job (including the command via `at -c`).
pub async fn get_at_job(host: &CronHost, job_id: u64) -> Result<AtJob, CronError> {
    let id_str = job_id.to_string();

    // Get job info from atq first
    let jobs = list_at_jobs(host).await?;
    let mut job = jobs
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| CronError::JobNotFound(id_str.clone()))?;

    // Get the command from at -c
    let stdout = client::exec_ok(host, "at", &["-c", &id_str]).await?;

    // at -c output is a shell script; the actual command is typically the last
    // non-empty lines after the environment setup. We extract everything after
    // the last "}" or the marker line.
    job.command = extract_at_command(&stdout);

    Ok(job)
}

/// Schedule a one-time job with `at`.
///
/// `time_spec` is any valid at(1) time specification, e.g.:
/// - "now + 1 hour"
/// - "16:00 2026-03-08"
/// - "teatime tomorrow"
pub async fn schedule_at_job(
    host: &CronHost,
    time_spec: &str,
    command: &str,
) -> Result<AtJob, CronError> {
    // echo 'command' | at time_spec
    // at writes to stderr on success: "job N at DATE"
    let args_str = format!("echo '{}' | at {}", escape_single_quotes(command), time_spec);
    let (stdout, stderr, exit_code) =
        client::exec(host, "sh", &["-c", &args_str]).await?;

    // at uses stderr for its messages, even on success
    let combined = format!("{}{}", stdout, stderr);

    // Parse "job N at ..." from stderr
    let (job_id, scheduled_at) = parse_at_schedule_output(&combined)?;

    // Try to determine the queue and user
    let jobs = list_at_jobs(host).await.unwrap_or_default();
    let (queue, user) = jobs
        .iter()
        .find(|j| j.id == job_id)
        .map(|j| (j.queue, j.user.clone()))
        .unwrap_or(('a', String::new()));

    // If exit_code is non-zero and we couldn't parse, it's an error
    if exit_code != 0 && job_id == 0 {
        return Err(CronError::CommandFailed {
            command: format!("at {time_spec}"),
            exit_code,
            stderr: combined,
        });
    }

    Ok(AtJob {
        id: job_id,
        command: command.to_string(),
        scheduled_at,
        queue,
        user,
    })
}

/// Schedule a job to run when system load permits (`batch`).
pub async fn schedule_batch_job(
    host: &CronHost,
    command: &str,
) -> Result<AtJob, CronError> {
    let args_str = format!("echo '{}' | batch", escape_single_quotes(command));
    let (stdout, stderr, _exit_code) =
        client::exec(host, "sh", &["-c", &args_str]).await?;

    let combined = format!("{}{}", stdout, stderr);
    let (job_id, scheduled_at) = parse_at_schedule_output(&combined)?;

    let jobs = list_at_jobs(host).await.unwrap_or_default();
    let (queue, user) = jobs
        .iter()
        .find(|j| j.id == job_id)
        .map(|j| (j.queue, j.user.clone()))
        .unwrap_or(('b', String::new()));

    Ok(AtJob {
        id: job_id,
        command: command.to_string(),
        scheduled_at,
        queue,
        user,
    })
}

/// Remove a scheduled at job.
pub async fn remove_at_job(host: &CronHost, job_id: u64) -> Result<(), CronError> {
    let id_str = job_id.to_string();
    client::exec_ok(host, "atrm", &[&id_str]).await?;
    Ok(())
}

/// Read at access control files (/etc/at.allow, /etc/at.deny).
pub async fn get_at_access(host: &CronHost) -> Result<CronAccessControl, CronError> {
    let (allow_out, _, allow_exit) =
        client::exec(host, "cat", &["/etc/at.allow"]).await?;
    let (deny_out, _, deny_exit) =
        client::exec(host, "cat", &["/etc/at.deny"]).await?;

    let allow_exists = allow_exit == 0;
    let deny_exists = deny_exit == 0;

    let allow_users = if allow_exists {
        allow_out
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect()
    } else {
        Vec::new()
    };

    let deny_users = if deny_exists {
        deny_out
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect()
    } else {
        Vec::new()
    };

    Ok(CronAccessControl {
        allow_users,
        deny_users,
        allow_file_exists: allow_exists,
        deny_file_exists: deny_exists,
    })
}

// ─── Parsing helpers ────────────────────────────────────────────────

/// Parse a single line from `atq` output.
///
/// Format varies but typically:
///   "3\tFri Mar  7 14:30:00 2026 a root"
///   "3\t2026-03-07 14:30 a root"
fn parse_atq_line(line: &str) -> Option<AtJob> {
    // Split on tab first, then whitespace for the rest
    let parts: Vec<&str> = line.splitn(2, '\t').collect();
    if parts.len() < 2 {
        // Some at implementations use spaces instead of tabs
        return parse_atq_line_spaces(line);
    }

    let id: u64 = parts[0].trim().parse().ok()?;
    let rest = parts[1].trim();

    // rest is something like "Fri Mar  7 14:30:00 2026 a root"
    // The queue letter and user are at the end
    let tokens: Vec<&str> = rest.split_whitespace().collect();
    if tokens.len() < 3 {
        return None;
    }

    // Last token is user, second-to-last is queue
    let user = tokens[tokens.len() - 1].to_string();
    let queue = tokens[tokens.len() - 2].chars().next().unwrap_or('a');

    // Everything before queue+user is the date
    let date_end = tokens.len() - 2;
    let date_str = tokens[..date_end].join(" ");
    let scheduled_at = parse_at_datetime(&date_str).unwrap_or_else(Utc::now);

    Some(AtJob {
        id,
        command: String::new(),
        scheduled_at,
        queue,
        user,
    })
}

/// Fallback parser when atq uses spaces instead of tabs.
fn parse_atq_line_spaces(line: &str) -> Option<AtJob> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 8 {
        return None;
    }

    let id: u64 = tokens[0].parse().ok()?;
    let user = tokens[tokens.len() - 1].to_string();
    let queue = tokens[tokens.len() - 2].chars().next().unwrap_or('a');

    let date_tokens = &tokens[1..tokens.len() - 2];
    let date_str = date_tokens.join(" ");
    let scheduled_at = parse_at_datetime(&date_str).unwrap_or_else(Utc::now);

    Some(AtJob {
        id,
        command: String::new(),
        scheduled_at,
        queue,
        user,
    })
}

/// Parse various date formats from at output.
fn parse_at_datetime(s: &str) -> Option<DateTime<Utc>> {
    // Try common formats
    let formats = [
        "%a %b %d %H:%M:%S %Y",   // "Fri Mar  7 14:30:00 2026"
        "%a %b %e %H:%M:%S %Y",   // "Fri Mar 7 14:30:00 2026" (single-digit day)
        "%Y-%m-%d %H:%M:%S",      // "2026-03-07 14:30:00"
        "%Y-%m-%d %H:%M",         // "2026-03-07 14:30"
    ];

    let trimmed = s.trim();
    for fmt in &formats {
        if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Some(DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc));
        }
    }
    None
}

/// Parse "job N at DATE" from at command output.
fn parse_at_schedule_output(output: &str) -> Result<(u64, DateTime<Utc>), CronError> {
    // Look for pattern: "job N at ..."
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("job ") {
            let parts: Vec<&str> = rest.splitn(2, " at ").collect();
            if parts.len() == 2 {
                let job_id: u64 = parts[0].trim().parse().map_err(|_| {
                    CronError::ParseError(format!("Cannot parse job ID from: {trimmed}"))
                })?;
                let date = parse_at_datetime(parts[1].trim())
                    .unwrap_or_else(Utc::now);
                return Ok((job_id, date));
            }
        }
    }

    Err(CronError::ParseError(format!(
        "Cannot parse at schedule output: {output}"
    )))
}

/// Extract the user's actual command from `at -c` output.
/// The output is a full shell script with environment setup; the command
/// is at the end, after the last block of env/cd/umask lines.
fn extract_at_command(script: &str) -> String {
    let lines: Vec<&str> = script.lines().collect();

    // Walk backwards to find the last non-empty, non-comment,
    // non-shell-boilerplate line(s).
    let mut cmd_lines = Vec::new();
    let mut in_command = false;

    for line in lines.iter().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() && !in_command {
            continue;
        }
        // Skip the trailing marker line if present
        if trimmed == "marcinDELIMITER" || trimmed.starts_with("marcinDELIMITER") {
            continue;
        }
        // Stop when we hit shell boilerplate
        if trimmed.starts_with("cd ") || trimmed.starts_with("umask ") || trimmed == "{" || trimmed == "}" {
            break;
        }
        if trimmed.starts_with("export ") || trimmed.contains("=${") || trimmed.contains("; export ") {
            break;
        }
        in_command = true;
        cmd_lines.push(*line);
    }

    cmd_lines.reverse();
    cmd_lines.join("\n").trim().to_string()
}

fn escape_single_quotes(s: &str) -> String {
    s.replace('\'', "'\\''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_atq_tab_format() {
        let line = "3\tFri Mar  7 14:30:00 2026 a root";
        let job = parse_atq_line(line).unwrap();
        assert_eq!(job.id, 3);
        assert_eq!(job.queue, 'a');
        assert_eq!(job.user, "root");
    }

    #[test]
    fn parse_atq_space_format() {
        let line = "5 Thu Mar  6 09:00:00 2026 b admin";
        let job = parse_atq_line(line).unwrap();
        assert_eq!(job.id, 5);
        assert_eq!(job.queue, 'b');
        assert_eq!(job.user, "admin");
    }

    #[test]
    fn parse_schedule_output() {
        let output = "warning: commands will be executed using /bin/sh\njob 42 at Fri Mar  7 15:00:00 2026\n";
        let (id, _dt) = parse_at_schedule_output(output).unwrap();
        assert_eq!(id, 42);
    }

    #[test]
    fn extract_command_from_at_c() {
        let script = r#"#!/bin/sh
# atrun uid=0 gid=0
umask 22
cd /root || { echo 'Execution directory inaccessible' >&2; exit 1; }
SHELL=/bin/bash; export SHELL
/usr/local/bin/backup.sh --full
"#;
        let cmd = extract_at_command(script);
        assert_eq!(cmd, "/usr/local/bin/backup.sh --full");
    }
}
