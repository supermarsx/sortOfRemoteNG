//! # NetBird Access Control (ACL) Policies
//!
//! Helpers for working with NetBird policies — validation, effective rule
//! computation, and policy conflict detection.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Validate a policy's rules for internal consistency.
pub fn validate_policy(policy: &NetBirdPolicy) -> Vec<String> {
    let mut issues = Vec::new();
    if policy.name.is_empty() {
        issues.push("Policy name cannot be empty".to_string());
    }
    if policy.rules.is_empty() {
        issues.push("Policy must have at least one rule".to_string());
    }
    for rule in &policy.rules {
        if rule.sources.is_empty() {
            issues.push(format!("Rule '{}' has no sources", rule.name));
        }
        if rule.destinations.is_empty() {
            issues.push(format!("Rule '{}' has no destinations", rule.name));
        }
    }
    issues
}

/// Find all group IDs referenced by a policy (both sources and destinations).
pub fn referenced_groups(policy: &NetBirdPolicy) -> HashSet<String> {
    let mut groups = HashSet::new();
    for rule in &policy.rules {
        for src in &rule.sources {
            groups.insert(src.clone());
        }
        for dst in &rule.destinations {
            groups.insert(dst.clone());
        }
    }
    groups
}

/// Check if two policies have overlapping source/destination group pairs.
pub fn policies_overlap(a: &NetBirdPolicy, b: &NetBirdPolicy) -> bool {
    for ra in &a.rules {
        for rb in &b.rules {
            let src_overlap = ra.sources.iter().any(|s| rb.sources.contains(s));
            let dst_overlap = ra.destinations.iter().any(|d| rb.destinations.contains(d));
            if src_overlap && dst_overlap {
                return true;
            }
        }
    }
    false
}

/// Summary of an account's policy configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicySummary {
    pub total: u32,
    pub enabled: u32,
    pub disabled: u32,
    pub total_rules: u32,
    pub accept_rules: u32,
    pub drop_rules: u32,
    pub with_posture_checks: u32,
}

/// Compute a policy summary.
pub fn summarize_policies(policies: &[&NetBirdPolicy]) -> PolicySummary {
    let mut total_rules = 0u32;
    let mut accept = 0u32;
    let mut drop = 0u32;

    for p in policies {
        for r in &p.rules {
            total_rules += 1;
            match r.action {
                PolicyAction::Accept => accept += 1,
                PolicyAction::Drop => drop += 1,
            }
        }
    }

    PolicySummary {
        total: policies.len() as u32,
        enabled: policies.iter().filter(|p| p.enabled).count() as u32,
        disabled: policies.iter().filter(|p| !p.enabled).count() as u32,
        total_rules,
        accept_rules: accept,
        drop_rules: drop,
        with_posture_checks: policies
            .iter()
            .filter(|p| !p.source_posture_checks.is_empty())
            .count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_policy(id: &str, rules: Vec<PolicyRule>) -> NetBirdPolicy {
        NetBirdPolicy {
            id: id.into(),
            name: id.into(),
            description: "".into(),
            enabled: true,
            rules,
            source_posture_checks: vec![],
        }
    }

    fn make_rule(name: &str, sources: Vec<&str>, destinations: Vec<&str>) -> PolicyRule {
        PolicyRule {
            id: name.into(),
            name: name.into(),
            description: "".into(),
            enabled: true,
            action: PolicyAction::Accept,
            bidirectional: true,
            protocol: PolicyProtocol::All,
            ports: vec![],
            sources: sources.into_iter().map(|s| s.to_string()).collect(),
            destinations: destinations.into_iter().map(|d| d.to_string()).collect(),
        }
    }

    #[test]
    fn test_validate_policy_ok() {
        let policy = make_policy("p1", vec![make_rule("r1", vec!["g1"], vec!["g2"])]);
        assert!(validate_policy(&policy).is_empty());
    }

    #[test]
    fn test_validate_policy_empty_name() {
        let mut policy = make_policy("", vec![make_rule("r1", vec!["g1"], vec!["g2"])]);
        policy.name = "".into();
        let issues = validate_policy(&policy);
        assert!(issues.iter().any(|i| i.contains("name")));
    }

    #[test]
    fn test_referenced_groups() {
        let policy = make_policy(
            "p1",
            vec![make_rule("r1", vec!["g1", "g2"], vec!["g3", "g4"])],
        );
        let groups = referenced_groups(&policy);
        assert_eq!(groups.len(), 4);
    }

    #[test]
    fn test_policies_overlap() {
        let p1 = make_policy("p1", vec![make_rule("r1", vec!["g1"], vec!["g2"])]);
        let p2 = make_policy("p2", vec![make_rule("r2", vec!["g1"], vec!["g2"])]);
        assert!(policies_overlap(&p1, &p2));
    }

    #[test]
    fn test_policies_no_overlap() {
        let p1 = make_policy("p1", vec![make_rule("r1", vec!["g1"], vec!["g2"])]);
        let p2 = make_policy("p2", vec![make_rule("r2", vec!["g3"], vec!["g4"])]);
        assert!(!policies_overlap(&p1, &p2));
    }
}
