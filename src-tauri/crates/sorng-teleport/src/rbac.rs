//! # Teleport RBAC (Role-Based Access Control)
//!
//! Role analysis, validation, label-matching helpers, and policy
//! summarisation utilities.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Validate a role for common misconfigurations.
pub fn validate_role(role: &TeleportRole) -> Vec<String> {
    let mut issues = Vec::new();

    if role.metadata.labels.is_empty() && role.metadata.revision.is_none() {
        // informational only — not necessarily an issue
    }

    let allow = &role.spec.allow;
    if allow.node_labels.is_empty()
        && allow.db_labels.is_empty()
        && allow.app_labels.is_empty()
        && allow.desktop_labels.is_empty()
        && allow.rules.is_empty()
        && allow.logins.is_empty()
    {
        issues.push(
            "Allow section has no labels, logins, or rules — role grants no access".to_string(),
        );
    }

    // Warn on wildcard
    for (key, vals) in &allow.node_labels {
        if key == "*" || vals.iter().any(|v| v == "*") {
            issues.push(
                "Allow section has wildcard node_labels — grants access to all nodes".to_string(),
            );
            break;
        }
    }

    let deny = &role.spec.deny;
    if !deny.node_labels.is_empty() && allow.node_labels.is_empty() && allow.logins.is_empty() {
        issues.push("Role has deny labels but empty allow section".to_string());
    }

    let opts = &role.spec.options;
    if opts.max_session_ttl.is_none() {
        issues.push("max_session_ttl is not set — sessions may last indefinitely".to_string());
    }

    issues
}

/// Check if a set of resource labels satisfies the label requirements.
pub fn labels_match(
    resource_labels: &HashMap<String, String>,
    required_labels: &HashMap<String, Vec<String>>,
) -> bool {
    for (key, allowed_values) in required_labels {
        if key == "*" {
            return true; // wildcard matches everything
        }
        match resource_labels.get(key) {
            Some(val) => {
                if !allowed_values.iter().any(|v| v == "*" || v == val) {
                    return false;
                }
            }
            None => return false,
        }
    }
    true
}

/// Collect all unique label keys referenced by a role's allow/deny sections.
pub fn referenced_label_keys(role: &TeleportRole) -> HashSet<String> {
    let mut keys = HashSet::new();
    for section in [&role.spec.allow, &role.spec.deny] {
        for maps in [
            &section.node_labels,
            &section.db_labels,
            &section.app_labels,
            &section.desktop_labels,
        ] {
            for k in maps.keys() {
                keys.insert(k.clone());
            }
        }
    }
    keys
}

/// Determine which roles would grant access to a node with given labels.
pub fn roles_granting_node_access<'a>(
    roles: &[&'a TeleportRole],
    node_labels: &HashMap<String, String>,
) -> Vec<&'a TeleportRole> {
    roles
        .iter()
        .filter(|r| {
            let allow = &r.spec.allow;
            if !labels_match(node_labels, &allow.node_labels) {
                return false;
            }
            let deny = &r.spec.deny;
            if labels_match(node_labels, &deny.node_labels) {
                return false;
            }
            true
        })
        .copied()
        .collect()
}

/// Role summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleSummary {
    pub total: u32,
    pub with_wildcard_labels: u32,
    pub with_deny_rules: u32,
    pub with_require_mfa: u32,
    pub unique_label_keys: u32,
}

pub fn summarize_roles(roles: &[&TeleportRole]) -> RoleSummary {
    let mut with_wildcard = 0u32;
    let mut with_deny = 0u32;
    let mut with_mfa = 0u32;
    let mut all_keys = HashSet::new();
    for role in roles {
        let keys = referenced_label_keys(role);
        if keys.contains("*") {
            with_wildcard += 1;
        }
        all_keys.extend(keys);
        if !role.spec.deny.node_labels.is_empty() || !role.spec.deny.rules.is_empty() {
            with_deny += 1;
        }
        if role.spec.options.require_session_mfa.is_some() {
            with_mfa += 1;
        }
    }
    RoleSummary {
        total: roles.len() as u32,
        with_wildcard_labels: with_wildcard,
        with_deny_rules: with_deny,
        with_require_mfa: with_mfa,
        unique_label_keys: all_keys.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_role() -> TeleportRole {
        TeleportRole {
            name: "dev".to_string(),
            description: "Developer role".to_string(),
            metadata: RoleMetadata {
                labels: HashMap::new(),
                revision: None,
            },
            spec: RoleSpec {
                allow: RoleConditions {
                    logins: vec!["root".to_string()],
                    node_labels: HashMap::from([("env".to_string(), vec!["prod".to_string()])]),
                    ..Default::default()
                },
                deny: RoleConditions::default(),
                options: RoleOptions {
                    max_session_ttl: Some("8h".to_string()),
                    ..Default::default()
                },
            },
        }
    }

    #[test]
    fn test_validate_role_ok() {
        let role = sample_role();
        let issues = validate_role(&role);
        assert!(issues.is_empty(), "unexpected issues: {:?}", issues);
    }

    #[test]
    fn test_labels_match() {
        let resource = HashMap::from([("env".to_string(), "prod".to_string())]);
        let required = HashMap::from([("env".to_string(), vec!["prod".to_string()])]);
        assert!(labels_match(&resource, &required));
    }

    #[test]
    fn test_labels_mismatch() {
        let resource = HashMap::from([("env".to_string(), "staging".to_string())]);
        let required = HashMap::from([("env".to_string(), vec!["prod".to_string()])]);
        assert!(!labels_match(&resource, &required));
    }

    #[test]
    fn test_wildcard_match() {
        let resource = HashMap::from([("env".to_string(), "anything".to_string())]);
        let required = HashMap::from([("*".to_string(), vec!["*".to_string()])]);
        assert!(labels_match(&resource, &required));
    }
}
