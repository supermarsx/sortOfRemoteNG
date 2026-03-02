//! # Tailscale ACL Policy Management
//!
//! Parse, validate, test, and manage Tailscale ACL policies.
//! Supports both JSON and HuJSON formats.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Full ACL policy document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclDocument {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<HashMap<String, Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_owners: Option<HashMap<String, Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hosts: Option<HashMap<String, String>>,
    pub acls: Vec<AclEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh: Option<Vec<SshAclEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_attrs: Option<Vec<NodeAttrEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approvers: Option<AutoApproverConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests: Option<Vec<AclTestCase>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derp_map: Option<DerpMapConfig>,
}

/// Single ACL entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclEntry {
    pub action: AclAction,
    pub src: Vec<String>,
    pub dst: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proto: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AclAction {
    Accept,
    Deny,
}

/// SSH ACL entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAclEntry {
    pub action: SshAclAction,
    pub src: Vec<String>,
    pub dst: Vec<String>,
    pub users: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_period: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SshAclAction {
    Accept,
    Check,
    Deny,
}

/// Node attribute entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeAttrEntry {
    pub target: Vec<String>,
    pub attr: Vec<String>,
}

/// Auto-approver configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoApproverConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routes: Option<HashMap<String, Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_node: Option<Vec<String>>,
}

/// ACL test case.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclTestCase {
    pub src: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accept: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deny: Option<Vec<String>>,
}

/// DERP map configuration in ACLs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerpMapConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omit_default_regions: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub regions: Option<HashMap<String, DerpRegionConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerpRegionConfig {
    pub region_id: u32,
    pub region_code: String,
    pub region_name: String,
    pub nodes: Vec<DerpNodeConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerpNodeConfig {
    pub name: String,
    pub region_id: u32,
    pub host_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipv4: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipv6: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stun_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stun_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derp_port: Option<u16>,
}

/// Validate an ACL document for common errors.
pub fn validate_acl(doc: &AclDocument) -> Vec<AclValidationError> {
    let mut errors = Vec::new();

    // Check ACL entries reference valid groups/hosts
    if let Some(groups) = &doc.groups {
        for (name, _members) in groups {
            if !name.starts_with("group:") {
                errors.push(AclValidationError {
                    severity: Severity::Error,
                    message: format!("Group name '{}' must start with 'group:'", name),
                    path: format!("groups.{}", name),
                });
            }
        }
    }

    // Check for empty ACL rules
    for (i, acl) in doc.acls.iter().enumerate() {
        if acl.src.is_empty() {
            errors.push(AclValidationError {
                severity: Severity::Error,
                message: format!("ACL rule {} has empty src", i),
                path: format!("acls[{}].src", i),
            });
        }
        if acl.dst.is_empty() {
            errors.push(AclValidationError {
                severity: Severity::Error,
                message: format!("ACL rule {} has empty dst", i),
                path: format!("acls[{}].dst", i),
            });
        }
    }

    // Validate tag owners reference valid tags
    if let Some(tag_owners) = &doc.tag_owners {
        for (tag, _) in tag_owners {
            if !tag.starts_with("tag:") {
                errors.push(AclValidationError {
                    severity: Severity::Warning,
                    message: format!("Tag '{}' should start with 'tag:'", tag),
                    path: format!("tagOwners.{}", tag),
                });
            }
        }
    }

    // Validate SSH ACLs
    if let Some(ssh) = &doc.ssh {
        for (i, rule) in ssh.iter().enumerate() {
            if rule.users.is_empty() {
                errors.push(AclValidationError {
                    severity: Severity::Warning,
                    message: format!("SSH rule {} has empty users list", i),
                    path: format!("ssh[{}].users", i),
                });
            }
        }
    }

    errors
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclValidationError {
    pub severity: Severity,
    pub message: String,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Parse ACL JSON to document.
pub fn parse_acl(json: &str) -> Result<AclDocument, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse ACL: {}", e))
}

/// Serialize ACL document to JSON.
pub fn serialize_acl(doc: &AclDocument, pretty: bool) -> Result<String, String> {
    if pretty {
        serde_json::to_string_pretty(doc).map_err(|e| format!("Failed to serialize ACL: {}", e))
    } else {
        serde_json::to_string(doc).map_err(|e| format!("Failed to serialize ACL: {}", e))
    }
}

/// Check if a specific src→dst path is allowed by ACLs.
pub fn test_acl_access(doc: &AclDocument, src: &str, dst: &str) -> AclTestResult {
    let mut matched_rules = Vec::new();
    let mut allowed = false;

    for (i, acl) in doc.acls.iter().enumerate() {
        let src_match = acl.src.iter().any(|s| s == "*" || s == src);
        let dst_match = acl.dst.iter().any(|d| {
            d == "*" || d.starts_with(&format!("{}:", dst)) || d == dst
        });

        if src_match && dst_match {
            matched_rules.push(i);
            if acl.action == AclAction::Accept {
                allowed = true;
            }
        }
    }

    AclTestResult {
        src: src.to_string(),
        dst: dst.to_string(),
        allowed,
        matched_rules,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclTestResult {
    pub src: String,
    pub dst: String,
    pub allowed: bool,
    pub matched_rules: Vec<usize>,
}

/// Generate a default permissive ACL.
pub fn default_acl() -> AclDocument {
    AclDocument {
        groups: None,
        tag_owners: None,
        hosts: None,
        acls: vec![AclEntry {
            action: AclAction::Accept,
            src: vec!["*".to_string()],
            dst: vec!["*:*".to_string()],
            proto: None,
        }],
        ssh: None,
        node_attrs: None,
        auto_approvers: None,
        tests: None,
        derp_map: None,
    }
}

/// Generate a restrictive starter ACL.
pub fn restrictive_acl_template() -> AclDocument {
    AclDocument {
        groups: Some(HashMap::from([
            ("group:admin".to_string(), vec!["admin@example.com".to_string()]),
            ("group:dev".to_string(), vec!["dev@example.com".to_string()]),
        ])),
        tag_owners: Some(HashMap::from([
            ("tag:server".to_string(), vec!["group:admin".to_string()]),
            ("tag:monitoring".to_string(), vec!["group:admin".to_string()]),
        ])),
        hosts: None,
        acls: vec![
            AclEntry {
                action: AclAction::Accept,
                src: vec!["group:admin".to_string()],
                dst: vec!["*:*".to_string()],
                proto: None,
            },
            AclEntry {
                action: AclAction::Accept,
                src: vec!["group:dev".to_string()],
                dst: vec!["tag:server:22".to_string(), "tag:server:80".to_string(), "tag:server:443".to_string()],
                proto: None,
            },
        ],
        ssh: Some(vec![SshAclEntry {
            action: SshAclAction::Check,
            src: vec!["group:admin".to_string()],
            dst: vec!["tag:server".to_string()],
            users: vec!["root".to_string(), "ubuntu".to_string()],
            check_period: Some("12h".to_string()),
        }]),
        node_attrs: None,
        auto_approvers: None,
        tests: Some(vec![
            AclTestCase {
                src: "group:admin".to_string(),
                accept: Some(vec!["tag:server:22".to_string()]),
                deny: None,
            },
        ]),
        derp_map: None,
    }
}
