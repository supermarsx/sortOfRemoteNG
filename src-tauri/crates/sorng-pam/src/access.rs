//! /etc/security/access.conf management.

use crate::client;
use crate::error::PamError;
use crate::types::{PamAccessRule, PamHost};
use log::info;

// ─── Parsing ────────────────────────────────────────────────────────

const ACCESS_CONF: &str = "/etc/security/access.conf";

/// Parse a single access.conf line.
///
/// Format: `permission : users : origins`
fn parse_access_line(line: &str) -> Option<PamAccessRule> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let parts: Vec<&str> = trimmed.splitn(3, ':').collect();
    if parts.len() < 3 {
        return None;
    }

    let permission = parts[0].trim().to_string();
    if permission != "+" && permission != "-" {
        return None;
    }

    let users: Vec<String> = parts[1]
        .trim()
        .split_whitespace()
        .map(String::from)
        .collect();
    let origins: Vec<String> = parts[2]
        .trim()
        .split_whitespace()
        .map(String::from)
        .collect();

    Some(PamAccessRule {
        permission,
        users,
        origins,
    })
}

/// Parse access.conf content.
pub fn parse_access_rules(content: &str) -> Vec<PamAccessRule> {
    content.lines().filter_map(parse_access_line).collect()
}

/// Serialize access rules back to file content.
pub fn serialize_access_rules(rules: &[PamAccessRule]) -> String {
    let mut out = String::new();
    out.push_str("# /etc/security/access.conf\n");
    out.push_str("#\n");
    out.push_str("# Login access control table.\n");
    out.push_str("#\n");
    out.push_str("# permission : users : origins\n");
    out.push_str("#\n");
    for rule in rules {
        out.push_str(&rule.to_config_line());
        out.push('\n');
    }
    out
}

// ─── Remote Operations ──────────────────────────────────────────────

/// Get all access rules from /etc/security/access.conf.
pub async fn get_access_rules(host: &PamHost) -> Result<Vec<PamAccessRule>, PamError> {
    let content = client::read_file(host, ACCESS_CONF).await?;
    Ok(parse_access_rules(&content))
}

/// Add an access rule (appended to the end of the file).
pub async fn add_access_rule(
    host: &PamHost,
    rule: &PamAccessRule,
) -> Result<(), PamError> {
    validate_access_rule(rule)?;
    let content = client::read_file(host, ACCESS_CONF).await?;
    let mut rules = parse_access_rules(&content);
    rules.push(rule.clone());

    let new_content = serialize_access_rules(&rules);
    client::write_file(host, ACCESS_CONF, &new_content).await?;
    info!("Added access rule: {}", rule.to_config_line());
    Ok(())
}

/// Remove an access rule by index.
pub async fn remove_access_rule(host: &PamHost, index: usize) -> Result<(), PamError> {
    let content = client::read_file(host, ACCESS_CONF).await?;
    let mut rules = parse_access_rules(&content);

    if index >= rules.len() {
        return Err(PamError::InvalidConfig(format!(
            "Access rule index {} out of range (have {} rules)",
            index,
            rules.len()
        )));
    }

    let removed = rules.remove(index);
    let new_content = serialize_access_rules(&rules);
    client::write_file(host, ACCESS_CONF, &new_content).await?;
    info!("Removed access rule: {}", removed.to_config_line());
    Ok(())
}

/// Update an access rule by index.
pub async fn update_access_rule(
    host: &PamHost,
    index: usize,
    rule: &PamAccessRule,
) -> Result<(), PamError> {
    validate_access_rule(rule)?;
    let content = client::read_file(host, ACCESS_CONF).await?;
    let mut rules = parse_access_rules(&content);

    if index >= rules.len() {
        return Err(PamError::InvalidConfig(format!(
            "Access rule index {} out of range (have {} rules)",
            index,
            rules.len()
        )));
    }

    rules[index] = rule.clone();
    let new_content = serialize_access_rules(&rules);
    client::write_file(host, ACCESS_CONF, &new_content).await?;
    info!("Updated access rule at index {}", index);
    Ok(())
}

/// Basic validation for an access rule.
fn validate_access_rule(rule: &PamAccessRule) -> Result<(), PamError> {
    if rule.permission != "+" && rule.permission != "-" {
        return Err(PamError::InvalidConfig(format!(
            "Permission must be '+' or '-', got '{}'",
            rule.permission
        )));
    }
    if rule.users.is_empty() {
        return Err(PamError::InvalidConfig(
            "Access rule must have at least one user".to_string(),
        ));
    }
    if rule.origins.is_empty() {
        return Err(PamError::InvalidConfig(
            "Access rule must have at least one origin".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_allow_rule() {
        let line = "+ : root : ALL";
        let rule = parse_access_line(line).unwrap();
        assert_eq!(rule.permission, "+");
        assert_eq!(rule.users, vec!["root"]);
        assert_eq!(rule.origins, vec!["ALL"]);
    }

    #[test]
    fn test_parse_deny_rule() {
        let line = "- : ALL EXCEPT root : ALL";
        let rule = parse_access_line(line).unwrap();
        assert_eq!(rule.permission, "-");
        assert_eq!(rule.users, vec!["ALL", "EXCEPT", "root"]);
        assert_eq!(rule.origins, vec!["ALL"]);
    }

    #[test]
    fn test_parse_network_origin() {
        let line = "+ : admin : 192.168.1.0/24";
        let rule = parse_access_line(line).unwrap();
        assert_eq!(rule.permission, "+");
        assert_eq!(rule.users, vec!["admin"]);
        assert_eq!(rule.origins, vec!["192.168.1.0/24"]);
    }

    #[test]
    fn test_comment_ignored() {
        assert!(parse_access_line("# comment").is_none());
        assert!(parse_access_line("").is_none());
    }

    #[test]
    fn test_parse_full_file() {
        let content = "\
# /etc/security/access.conf
# Allow root from anywhere
+ : root : ALL
# Allow admins from local network
+ : @admins : 192.168.0.0/16
# Deny everyone else
- : ALL : ALL
";
        let rules = parse_access_rules(content);
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0].permission, "+");
        assert_eq!(rules[0].users, vec!["root"]);
        assert_eq!(rules[1].users, vec!["@admins"]);
        assert_eq!(rules[2].permission, "-");
    }

    #[test]
    fn test_serialize_roundtrip() {
        let rules = vec![
            PamAccessRule {
                permission: "+".to_string(),
                users: vec!["root".to_string()],
                origins: vec!["ALL".to_string()],
            },
            PamAccessRule {
                permission: "-".to_string(),
                users: vec!["ALL".to_string()],
                origins: vec!["ALL".to_string()],
            },
        ];
        let serialized = serialize_access_rules(&rules);
        let reparsed = parse_access_rules(&serialized);
        assert_eq!(reparsed.len(), 2);
        assert_eq!(reparsed[0].permission, "+");
        assert_eq!(reparsed[1].permission, "-");
    }

    #[test]
    fn test_validate_access_rule() {
        let good = PamAccessRule {
            permission: "+".to_string(),
            users: vec!["root".to_string()],
            origins: vec!["ALL".to_string()],
        };
        assert!(validate_access_rule(&good).is_ok());

        let bad_perm = PamAccessRule {
            permission: "x".to_string(),
            users: vec!["root".to_string()],
            origins: vec!["ALL".to_string()],
        };
        assert!(validate_access_rule(&bad_perm).is_err());

        let no_users = PamAccessRule {
            permission: "+".to_string(),
            users: vec![],
            origins: vec!["ALL".to_string()],
        };
        assert!(validate_access_rule(&no_users).is_err());
    }
}
