//! Filter rule management — list, read, test, create filters.

use crate::error::Fail2banError;
use crate::types::{Fail2banHost, FilterRule};
use std::collections::HashMap;

/// List available filter names by scanning filter.d directory.
pub async fn list_filters(host: &Fail2banHost) -> Result<Vec<String>, Fail2banError> {
    let output = crate::client::exec_program(
        host,
        host.use_sudo,
        "find",
        &[
            "/etc/fail2ban/filter.d",
            "-maxdepth",
            "1",
            "-type",
            "f",
            "-name",
            "*.conf",
            "-print",
        ],
        "list filters",
    )
    .await?;
    let output = crate::client::require_success("list filters", output)?;
    let mut names: Vec<String> = output
        .stdout
        .lines()
        .filter_map(|line| line.trim().rsplit('/').next())
        .filter_map(|name| name.strip_suffix(".conf"))
        .filter(|name| crate::client::validate_safe_name(name, "filter name").is_ok())
        .map(str::to_string)
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

/// Read a filter configuration file.
pub async fn read_filter(
    host: &Fail2banHost,
    filter_name: &str,
) -> Result<FilterRule, Fail2banError> {
    crate::client::validate_safe_name(filter_name, "filter name")?;
    let path = format!("/etc/fail2ban/filter.d/{filter_name}.conf");
    let output =
        crate::client::exec_program(host, host.use_sudo, "cat", &["--", &path], "read filter")
            .await?;
    if output.exit_code != 0 {
        return Err(Fail2banError::FilterNotFound(filter_name.to_string()));
    }
    parse_filter_conf(filter_name, &output.stdout, &path)
}

/// Test a filter's regex against a log file.
///
/// Uses `fail2ban-regex` to test the filter against a log file.
pub async fn test_filter(
    host: &Fail2banHost,
    log_file: &str,
    filter_name: &str,
) -> Result<FilterTestResult, Fail2banError> {
    crate::client::validate_safe_name(filter_name, "filter name")?;
    crate::client::validate_absolute_path(log_file, "log file")?;
    let filter_path = format!("/etc/fail2ban/filter.d/{filter_name}.conf");
    let output = crate::client::exec_program(
        host,
        host.use_sudo,
        "fail2ban-regex",
        &[log_file, &filter_path],
        "test filter",
    )
    .await?;
    let output = crate::client::require_success("test filter", output)?;
    parse_regex_test_output(&output.stdout, &output.stderr)
}

/// Test a custom regex against a log sample.
pub async fn test_regex(
    host: &Fail2banHost,
    log_file: &str,
    regex: &str,
) -> Result<FilterTestResult, Fail2banError> {
    crate::client::validate_absolute_path(log_file, "log file")?;
    crate::client::validate_argument(regex, "regex pattern")?;
    let output = crate::client::exec_program(
        host,
        host.use_sudo,
        "fail2ban-regex",
        &[log_file, regex],
        "test regex",
    )
    .await?;
    let output = crate::client::require_success("test regex", output)?;
    parse_regex_test_output(&output.stdout, &output.stderr)
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
