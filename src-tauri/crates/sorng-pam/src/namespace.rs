//! /etc/security/namespace.conf management.

use crate::client;
use crate::error::PamError;
use crate::types::{PamHost, PamNamespaceRule};
use log::info;

// ─── Parsing ────────────────────────────────────────────────────────

const NAMESPACE_CONF: &str = "/etc/security/namespace.conf";

/// Parse a single namespace.conf line.
///
/// Format: `polydir instance_method [method_options ...]`
fn parse_namespace_line(line: &str) -> Option<PamNamespaceRule> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }

    let polydir = tokens[0].to_string();
    let instance_method = tokens[1].to_string();
    let method_options: Vec<String> = tokens[2..].iter().map(|s| s.to_string()).collect();

    Some(PamNamespaceRule {
        polydir,
        instance_method,
        method_options,
    })
}

/// Parse namespace.conf content.
pub fn parse_namespace_rules(content: &str) -> Vec<PamNamespaceRule> {
    content.lines().filter_map(parse_namespace_line).collect()
}

/// Serialize namespace rules back to file content.
pub fn serialize_namespace_rules(rules: &[PamNamespaceRule]) -> String {
    let mut out = String::new();
    out.push_str("# /etc/security/namespace.conf\n");
    out.push_str("#\n");
    out.push_str("# polydir instance_method [options]\n");
    out.push_str("#\n");
    for rule in rules {
        out.push_str(&rule.to_config_line());
        out.push('\n');
    }
    out
}

// ─── Remote Operations ──────────────────────────────────────────────

/// Get all namespace rules from /etc/security/namespace.conf.
pub async fn get_namespace_rules(host: &PamHost) -> Result<Vec<PamNamespaceRule>, PamError> {
    let content = client::read_file(host, NAMESPACE_CONF).await?;
    Ok(parse_namespace_rules(&content))
}

/// Add a namespace rule (appended to the end).
pub async fn add_namespace_rule(host: &PamHost, rule: &PamNamespaceRule) -> Result<(), PamError> {
    validate_namespace_rule(rule)?;
    let content = client::read_file(host, NAMESPACE_CONF).await?;
    let mut rules = parse_namespace_rules(&content);
    rules.push(rule.clone());

    let new_content = serialize_namespace_rules(&rules);
    client::write_file(host, NAMESPACE_CONF, &new_content).await?;
    info!("Added namespace rule for {}", rule.polydir);
    Ok(())
}

/// Remove a namespace rule by index.
pub async fn remove_namespace_rule(host: &PamHost, index: usize) -> Result<(), PamError> {
    let content = client::read_file(host, NAMESPACE_CONF).await?;
    let mut rules = parse_namespace_rules(&content);

    if index >= rules.len() {
        return Err(PamError::InvalidConfig(format!(
            "Namespace rule index {} out of range (have {} rules)",
            index,
            rules.len()
        )));
    }

    let removed = rules.remove(index);
    let new_content = serialize_namespace_rules(&rules);
    client::write_file(host, NAMESPACE_CONF, &new_content).await?;
    info!("Removed namespace rule for {}", removed.polydir);
    Ok(())
}

/// Basic validation for a namespace rule.
fn validate_namespace_rule(rule: &PamNamespaceRule) -> Result<(), PamError> {
    if rule.polydir.is_empty() {
        return Err(PamError::InvalidConfig(
            "Namespace rule must specify a polydir".to_string(),
        ));
    }
    if !rule.polydir.starts_with('/') {
        return Err(PamError::InvalidConfig(format!(
            "Polydir must be an absolute path, got '{}'",
            rule.polydir
        )));
    }
    let valid_methods = ["user", "context", "level", "tmpdir", "tmpfs"];
    if !valid_methods.contains(&rule.instance_method.as_str()) {
        return Err(PamError::InvalidConfig(format!(
            "Invalid instance method '{}', expected one of: {}",
            rule.instance_method,
            valid_methods.join(", ")
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_namespace_line() {
        let line = "/tmp\ttmpfs\troot,adm";
        let rule = parse_namespace_line(line).unwrap();
        assert_eq!(rule.polydir, "/tmp");
        assert_eq!(rule.instance_method, "tmpfs");
        assert_eq!(rule.method_options, vec!["root,adm"]);
    }

    #[test]
    fn test_parse_simple_rule() {
        let line = "/var/tmp\tuser";
        let rule = parse_namespace_line(line).unwrap();
        assert_eq!(rule.polydir, "/var/tmp");
        assert_eq!(rule.instance_method, "user");
        assert!(rule.method_options.is_empty());
    }

    #[test]
    fn test_parse_context_rule() {
        let line = "/tmp\tcontext\troot,adm\tiscript=/etc/security/namespace.init";
        let rule = parse_namespace_line(line).unwrap();
        assert_eq!(rule.polydir, "/tmp");
        assert_eq!(rule.instance_method, "context");
        assert_eq!(rule.method_options.len(), 2);
    }

    #[test]
    fn test_comment_ignored() {
        assert!(parse_namespace_line("# comment").is_none());
        assert!(parse_namespace_line("").is_none());
    }

    #[test]
    fn test_parse_full_file() {
        let content = "\
# /etc/security/namespace.conf
# Polyinstantiation configuration
/tmp     tmpfs   root,adm
/var/tmp tmpfs   root,adm
/home    user
";
        let rules = parse_namespace_rules(content);
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0].polydir, "/tmp");
        assert_eq!(rules[0].instance_method, "tmpfs");
        assert_eq!(rules[1].polydir, "/var/tmp");
        assert_eq!(rules[2].instance_method, "user");
    }

    #[test]
    fn test_serialize_roundtrip() {
        let rules = vec![
            PamNamespaceRule {
                polydir: "/tmp".to_string(),
                instance_method: "tmpfs".to_string(),
                method_options: vec!["root,adm".to_string()],
            },
            PamNamespaceRule {
                polydir: "/home".to_string(),
                instance_method: "user".to_string(),
                method_options: vec![],
            },
        ];
        let serialized = serialize_namespace_rules(&rules);
        let reparsed = parse_namespace_rules(&serialized);
        assert_eq!(reparsed.len(), 2);
        assert_eq!(reparsed[0].polydir, "/tmp");
        assert_eq!(reparsed[1].instance_method, "user");
    }

    #[test]
    fn test_validate_namespace_rule() {
        let good = PamNamespaceRule {
            polydir: "/tmp".to_string(),
            instance_method: "tmpfs".to_string(),
            method_options: vec![],
        };
        assert!(validate_namespace_rule(&good).is_ok());

        let bad_method = PamNamespaceRule {
            polydir: "/tmp".to_string(),
            instance_method: "invalid".to_string(),
            method_options: vec![],
        };
        assert!(validate_namespace_rule(&bad_method).is_err());

        let not_absolute = PamNamespaceRule {
            polydir: "tmp".to_string(),
            instance_method: "user".to_string(),
            method_options: vec![],
        };
        assert!(validate_namespace_rule(&not_absolute).is_err());
    }
}
