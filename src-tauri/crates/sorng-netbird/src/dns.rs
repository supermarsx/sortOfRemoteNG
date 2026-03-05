//! # NetBird DNS Management
//!
//! Helpers for managing NetBird DNS nameserver groups, match domains,
//! search domains, and DNS resolution validation.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Validate a nameserver group's configuration.
pub fn validate_nameserver_group(group: &NameserverGroup) -> Vec<String> {
    let mut issues = Vec::new();
    if group.name.is_empty() {
        issues.push("Nameserver group name cannot be empty".to_string());
    }
    if group.nameservers.is_empty() {
        issues.push("At least one nameserver is required".to_string());
    }
    if group.groups.is_empty() {
        issues.push("At least one distribution group is required".to_string());
    }
    for ns in &group.nameservers {
        if ns.ip.parse::<std::net::IpAddr>().is_err() {
            issues.push(format!("Invalid nameserver IP: {}", ns.ip));
        }
        if ns.port == 0 {
            issues.push(format!("Invalid nameserver port for {}", ns.ip));
        }
    }
    issues
}

/// Collect all match-domains from all nameserver groups.
pub fn all_match_domains(groups: &[&NameserverGroup]) -> Vec<String> {
    let mut domains: Vec<String> = groups
        .iter()
        .flat_map(|g| g.domains.iter().cloned())
        .collect();
    domains.sort();
    domains.dedup();
    domains
}

/// Check for domain conflicts between nameserver groups.
pub fn detect_domain_conflicts(groups: &[&NameserverGroup]) -> Vec<DomainConflict> {
    let mut domain_map: HashMap<String, Vec<String>> = HashMap::new();
    for g in groups {
        for d in &g.domains {
            domain_map.entry(d.clone()).or_default().push(g.id.clone());
        }
    }
    domain_map
        .into_iter()
        .filter(|(_, ids)| ids.len() > 1)
        .map(|(domain, group_ids)| DomainConflict { domain, group_ids })
        .collect()
}

/// A domain claimed by more than one nameserver group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainConflict {
    pub domain: String,
    pub group_ids: Vec<String>,
}

/// DNS summary for the UI/dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsSummary {
    pub total_groups: u32,
    pub enabled_groups: u32,
    pub primary_groups: u32,
    pub total_nameservers: u32,
    pub total_domains: u32,
    pub has_conflicts: bool,
}

pub fn summarize_dns(groups: &[&NameserverGroup]) -> DnsSummary {
    let conflicts = detect_domain_conflicts(groups);
    DnsSummary {
        total_groups: groups.len() as u32,
        enabled_groups: groups.iter().filter(|g| g.enabled).count() as u32,
        primary_groups: groups.iter().filter(|g| g.primary).count() as u32,
        total_nameservers: groups.iter().map(|g| g.nameservers.len() as u32).sum(),
        total_domains: all_match_domains(groups).len() as u32,
        has_conflicts: !conflicts.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ns_group(id: &str, domains: Vec<&str>, ns_ips: Vec<&str>) -> NameserverGroup {
        NameserverGroup {
            id: id.into(),
            name: id.into(),
            description: "".into(),
            nameservers: ns_ips
                .into_iter()
                .map(|ip| Nameserver {
                    ip: ip.into(),
                    port: 53,
                    ns_type: NameserverType::Udp,
                })
                .collect(),
            groups: vec!["g1".into()],
            domains: domains.into_iter().map(|d| d.to_string()).collect(),
            primary: false,
            enabled: true,
            search_domains_enabled: false,
        }
    }

    #[test]
    fn test_validate_nameserver_group_ok() {
        let g = make_ns_group("ns1", vec!["example.com"], vec!["8.8.8.8"]);
        assert!(validate_nameserver_group(&g).is_empty());
    }

    #[test]
    fn test_validate_nameserver_group_bad_ip() {
        let g = make_ns_group("ns1", vec!["example.com"], vec!["not-an-ip"]);
        let issues = validate_nameserver_group(&g);
        assert!(issues.iter().any(|i| i.contains("Invalid nameserver IP")));
    }

    #[test]
    fn test_detect_domain_conflicts() {
        let g1 = make_ns_group("ns1", vec!["example.com"], vec!["8.8.8.8"]);
        let g2 = make_ns_group("ns2", vec!["example.com"], vec!["1.1.1.1"]);
        let conflicts = detect_domain_conflicts(&[&g1, &g2]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].domain, "example.com");
    }

    #[test]
    fn test_all_match_domains_dedup() {
        let g1 = make_ns_group("ns1", vec!["a.com", "b.com"], vec!["8.8.8.8"]);
        let g2 = make_ns_group("ns2", vec!["b.com", "c.com"], vec!["1.1.1.1"]);
        let domains = all_match_domains(&[&g1, &g2]);
        assert_eq!(domains, vec!["a.com", "b.com", "c.com"]);
    }
}
