//! Filter rule management — list, read, test, create filters.

use crate::error::Fail2banError;
use crate::types::{Fail2banHost, FilterRule};
use std::collections::HashMap;

/// List available filter names by scanning filter.d directory.
pub async fn list_filters(host: &Fail2banHost) -> Result<Vec<String>, Fail2banError> {
    let cmd = "ls /etc/fail2ban/filter.d/*.conf 2>/dev/null | sed 's|.*/||;s|\\.conf$||' | sort";

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

    let output = output.map_err(|e| Fail2banError::ProcessError(format!("list filters: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Read a filter configuration file.
pub async fn read_filter(
    host: &Fail2banHost,
    filter_name: &str,
) -> Result<FilterRule, Fail2banError> {
    let path = format!("/etc/fail2ban/filter.d/{filter_name}.conf");
    let cmd = format!("cat {path}");

    let output = if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let mut command = tokio::process::Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            command.arg(arg);
        }
        command.arg(&cmd);
        command.output().await
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", &cmd])
            .output()
            .await
    };

    let output = output.map_err(|e| Fail2banError::ProcessError(format!("read filter: {e}")))?;

    if !output.status.success() {
        return Err(Fail2banError::FilterNotFound(filter_name.to_string()));
    }

    let content = String::from_utf8_lossy(&output.stdout);
    parse_filter_conf(filter_name, &content, &path)
}

/// Test a filter's regex against a log file.
///
/// Uses `fail2ban-regex` to test the filter against a log file.
pub async fn test_filter(
    host: &Fail2banHost,
    log_file: &str,
    filter_name: &str,
) -> Result<FilterTestResult, Fail2banError> {
    let tool = "fail2ban-regex";
    let args_str = format!("{log_file} /etc/fail2ban/filter.d/{filter_name}.conf");

    let output = if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let remote_cmd = if host.use_sudo {
            format!("sudo {tool} {args_str}")
        } else {
            format!("{tool} {args_str}")
        };
        let mut command = tokio::process::Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            command.arg(arg);
        }
        command.arg(&remote_cmd);
        command.output().await
    } else if host.use_sudo {
        tokio::process::Command::new("sudo")
            .args([
                tool,
                log_file,
                &format!("/etc/fail2ban/filter.d/{filter_name}.conf"),
            ])
            .output()
            .await
    } else {
        tokio::process::Command::new(tool)
            .args([
                log_file,
                &format!("/etc/fail2ban/filter.d/{filter_name}.conf"),
            ])
            .output()
            .await
    };

    let output = output.map_err(|e| Fail2banError::ProcessError(format!("test filter: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    parse_regex_test_output(&stdout, &stderr)
}

/// Test a custom regex against a log sample.
pub async fn test_regex(
    host: &Fail2banHost,
    log_file: &str,
    regex: &str,
) -> Result<FilterTestResult, Fail2banError> {
    let tool = "fail2ban-regex";

    let output = if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let remote_cmd = if host.use_sudo {
            format!("sudo {tool} {log_file} '{regex}'")
        } else {
            format!("{tool} {log_file} '{regex}'")
        };
        let mut command = tokio::process::Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            command.arg(arg);
        }
        command.arg(&remote_cmd);
        command.output().await
    } else if host.use_sudo {
        tokio::process::Command::new("sudo")
            .args([tool, log_file, regex])
            .output()
            .await
    } else {
        tokio::process::Command::new(tool)
            .args([log_file, regex])
            .output()
            .await
    };

    let output = output.map_err(|e| Fail2banError::ProcessError(format!("test regex: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    parse_regex_test_output(&stdout, &stderr)
}

// ─── Types ──────────────────────────────────────────────────────────

/// Result of a filter regex test.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FilterTestResult {
    pub total_lines: u64,
    pub matched_lines: u64,
    pub missed_lines: u64,
    pub ignored_lines: u64,
    /// Sample matched lines (first N)
    pub sample_matches: Vec<String>,
    /// Raw output
    pub raw_output: String,
}

// ─── Parsers ────────────────────────────────────────────────────────

/// Parse a fail2ban filter .conf file.
fn parse_filter_conf(
    name: &str,
    content: &str,
    source_path: &str,
) -> Result<FilterRule, Fail2banError> {
    let mut failregex = Vec::new();
    let mut ignoreregex = Vec::new();
    let mut datepattern = None;
    let mut definition = HashMap::new();
    let mut current_section = String::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        // Section headers
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].to_lowercase();
            continue;
        }

        match current_section.as_str() {
            "definition" => {
                if let Some((key, val)) = trimmed.split_once('=') {
                    let key = key.trim();
                    let val = val.trim();
                    if key == "failregex" {
                        if !val.is_empty() {
                            failregex.push(val.to_string());
                        }
                    } else if key == "ignoreregex" {
                        if !val.is_empty() {
                            ignoreregex.push(val.to_string());
                        }
                    } else if key == "datepattern" {
                        datepattern = Some(val.to_string());
                    } else {
                        definition.insert(key.to_string(), val.to_string());
                    }
                } else {
                    // Continuation line for multi-line regex
                    if !failregex.is_empty() || !ignoreregex.is_empty() {
                        // Append to last failregex/ignoreregex
                        if !trimmed.is_empty() {
                            failregex.push(trimmed.to_string());
                        }
                    }
                }
            }
            "init" | "includes" => {
                if let Some((key, val)) = trimmed.split_once('=') {
                    definition.insert(key.trim().to_string(), val.trim().to_string());
                }
            }
            _ => {}
        }
    }

    Ok(FilterRule {
        name: name.to_string(),
        failregex,
        ignoreregex,
        datepattern,
        definition,
        source_path: Some(source_path.to_string()),
        used_by: Vec::new(),
    })
}

/// Parse fail2ban-regex test output.
fn parse_regex_test_output(stdout: &str, stderr: &str) -> Result<FilterTestResult, Fail2banError> {
    let combined = format!("{stdout}\n{stderr}");
    let mut total_lines: u64 = 0;
    let mut matched_lines: u64 = 0;
    let mut missed_lines: u64 = 0;
    let mut ignored_lines: u64 = 0;
    let mut sample_matches = Vec::new();

    let lines_re = regex::Regex::new(
        r"Lines:\s*(\d+)\s*lines?,\s*(\d+)\s*ignored,\s*(\d+)\s*matched,\s*(\d+)\s*missed",
    )
    .ok();

    for line in combined.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("Lines: ") {
            // "Lines: 1000 lines, 0 ignored, 50 matched, 950 missed"
            if let Some(caps) = lines_re.as_ref().and_then(|r| r.captures(trimmed)) {
                total_lines = caps[1].parse().unwrap_or(0);
                ignored_lines = caps[2].parse().unwrap_or(0);
                matched_lines = caps[3].parse().unwrap_or(0);
                missed_lines = caps[4].parse().unwrap_or(0);
            }
        }

        // Collect sample match lines
        if trimmed.starts_with("|-") && trimmed.contains("[") && sample_matches.len() < 20 {
            sample_matches.push(trimmed.to_string());
        }
    }

    Ok(FilterTestResult {
        total_lines,
        matched_lines,
        missed_lines,
        ignored_lines,
        sample_matches,
        raw_output: combined,
    })
}
