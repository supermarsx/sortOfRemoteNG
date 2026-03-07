//! /etc/security/time.conf management.

use crate::client;
use crate::error::PamError;
use crate::types::{PamHost, PamTimeRule};
use log::info;

// ─── Parsing ────────────────────────────────────────────────────────

const TIME_CONF: &str = "/etc/security/time.conf";

/// Parse a single time.conf line.
///
/// Format: `services;ttys;users;times`
fn parse_time_line(line: &str) -> Option<PamTimeRule> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let parts: Vec<&str> = trimmed.splitn(4, ';').collect();
    if parts.len() < 4 {
        return None;
    }

    Some(PamTimeRule {
        services: parts[0].trim().to_string(),
        ttys: parts[1].trim().to_string(),
        users: parts[2].trim().to_string(),
        times: parts[3].trim().to_string(),
    })
}

/// Parse time.conf content.
pub fn parse_time_rules(content: &str) -> Vec<PamTimeRule> {
    content.lines().filter_map(parse_time_line).collect()
}

/// Serialize time rules back to file content.
pub fn serialize_time_rules(rules: &[PamTimeRule]) -> String {
    let mut out = String::new();
    out.push_str("# /etc/security/time.conf\n");
    out.push_str("#\n");
    out.push_str("# services;ttys;users;times\n");
    out.push_str("#\n");
    for rule in rules {
        out.push_str(&rule.to_config_line());
        out.push('\n');
    }
    out
}

// ─── Remote Operations ──────────────────────────────────────────────

/// Get all time rules from /etc/security/time.conf.
pub async fn get_time_rules(host: &PamHost) -> Result<Vec<PamTimeRule>, PamError> {
    let content = client::read_file(host, TIME_CONF).await?;
    Ok(parse_time_rules(&content))
}

/// Add a time rule (appended to the end of the file).
pub async fn add_time_rule(host: &PamHost, rule: &PamTimeRule) -> Result<(), PamError> {
    validate_time_rule(rule)?;
    let content = client::read_file(host, TIME_CONF).await?;
    let mut rules = parse_time_rules(&content);
    rules.push(rule.clone());

    let new_content = serialize_time_rules(&rules);
    client::write_file(host, TIME_CONF, &new_content).await?;
    info!("Added time rule: {}", rule.to_config_line());
    Ok(())
}

/// Remove a time rule by index.
pub async fn remove_time_rule(host: &PamHost, index: usize) -> Result<(), PamError> {
    let content = client::read_file(host, TIME_CONF).await?;
    let mut rules = parse_time_rules(&content);

    if index >= rules.len() {
        return Err(PamError::InvalidConfig(format!(
            "Time rule index {} out of range (have {} rules)",
            index,
            rules.len()
        )));
    }

    let removed = rules.remove(index);
    let new_content = serialize_time_rules(&rules);
    client::write_file(host, TIME_CONF, &new_content).await?;
    info!("Removed time rule: {}", removed.to_config_line());
    Ok(())
}

/// Update a time rule by index.
pub async fn update_time_rule(
    host: &PamHost,
    index: usize,
    rule: &PamTimeRule,
) -> Result<(), PamError> {
    validate_time_rule(rule)?;
    let content = client::read_file(host, TIME_CONF).await?;
    let mut rules = parse_time_rules(&content);

    if index >= rules.len() {
        return Err(PamError::InvalidConfig(format!(
            "Time rule index {} out of range (have {} rules)",
            index,
            rules.len()
        )));
    }

    rules[index] = rule.clone();
    let new_content = serialize_time_rules(&rules);
    client::write_file(host, TIME_CONF, &new_content).await?;
    info!("Updated time rule at index {}", index);
    Ok(())
}

/// Basic validation for a time rule.
fn validate_time_rule(rule: &PamTimeRule) -> Result<(), PamError> {
    if rule.services.is_empty() {
        return Err(PamError::InvalidConfig(
            "Time rule must specify services".to_string(),
        ));
    }
    if rule.users.is_empty() {
        return Err(PamError::InvalidConfig(
            "Time rule must specify users".to_string(),
        ));
    }
    if rule.times.is_empty() {
        return Err(PamError::InvalidConfig(
            "Time rule must specify times".to_string(),
        ));
    }
    // Validate times format: should contain day abbreviations and time range
    // e.g., Al0800-1800, Mo0000-2400, !SaSu0000-2400
    let times = rule.times.trim_start_matches('!');
    if times.len() < 6 {
        return Err(PamError::InvalidConfig(format!(
            "Invalid times specification: '{}'",
            rule.times
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_time_rule() {
        let line = "login;*;!root;Al0800-1800";
        let rule = parse_time_line(line).unwrap();
        assert_eq!(rule.services, "login");
        assert_eq!(rule.ttys, "*");
        assert_eq!(rule.users, "!root");
        assert_eq!(rule.times, "Al0800-1800");
    }

    #[test]
    fn test_parse_complex_rule() {
        let line = "sshd|login;tty*;@developers;MoTuWeThFr0800-1800";
        let rule = parse_time_line(line).unwrap();
        assert_eq!(rule.services, "sshd|login");
        assert_eq!(rule.ttys, "tty*");
        assert_eq!(rule.users, "@developers");
    }

    #[test]
    fn test_parse_comment_ignored() {
        assert!(parse_time_line("# comment").is_none());
        assert!(parse_time_line("").is_none());
    }

    #[test]
    fn test_parse_full_file() {
        let content = "\
# /etc/security/time.conf
# Restrict login hours for students
login;*;@students;Al0800-2200
# Allow SSH for admins always
sshd;*;@admins;Al0000-2400
# Restrict console access on weekends
login;tty*;!root;!SaSu0000-2400
";
        let rules = parse_time_rules(content);
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0].services, "login");
        assert_eq!(rules[0].users, "@students");
        assert_eq!(rules[1].services, "sshd");
        assert_eq!(rules[2].times, "!SaSu0000-2400");
    }

    #[test]
    fn test_serialize_roundtrip() {
        let rules = vec![
            PamTimeRule {
                services: "sshd".to_string(),
                ttys: "*".to_string(),
                users: "admin".to_string(),
                times: "Al0000-2400".to_string(),
            },
            PamTimeRule {
                services: "login".to_string(),
                ttys: "tty*".to_string(),
                users: "!root".to_string(),
                times: "MoTuWeThFr0800-1800".to_string(),
            },
        ];
        let serialized = serialize_time_rules(&rules);
        let reparsed = parse_time_rules(&serialized);
        assert_eq!(reparsed.len(), 2);
        assert_eq!(reparsed[0].services, "sshd");
        assert_eq!(reparsed[1].users, "!root");
    }

    #[test]
    fn test_validate_time_rule() {
        let good = PamTimeRule {
            services: "sshd".to_string(),
            ttys: "*".to_string(),
            users: "admin".to_string(),
            times: "Al0000-2400".to_string(),
        };
        assert!(validate_time_rule(&good).is_ok());

        let empty_services = PamTimeRule {
            services: "".to_string(),
            ttys: "*".to_string(),
            users: "admin".to_string(),
            times: "Al0000-2400".to_string(),
        };
        assert!(validate_time_rule(&empty_services).is_err());

        let bad_times = PamTimeRule {
            services: "sshd".to_string(),
            ttys: "*".to_string(),
            users: "admin".to_string(),
            times: "bad".to_string(),
        };
        assert!(validate_time_rule(&bad_times).is_err());
    }
}
