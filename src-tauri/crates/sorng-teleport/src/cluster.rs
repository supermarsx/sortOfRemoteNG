//! # Teleport Trusted Cluster Management
//!
//! Trusted cluster configuration, role mappings, and health
//! monitoring utilities.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Build `tsh clusters` command.
pub fn list_clusters_command(format_json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "clusters".to_string()];
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tctl create` command for a trusted cluster resource YAML.
pub fn create_trusted_cluster_command(filepath: &str, force: bool) -> Vec<String> {
    let mut cmd = vec!["tctl".to_string(), "create".to_string()];
    if force {
        cmd.push("-f".to_string());
    }
    cmd.push(filepath.to_string());
    cmd
}

/// Build `tctl rm trusted_cluster/<name>` command.
pub fn remove_trusted_cluster_command(name: &str) -> Vec<String> {
    vec![
        "tctl".to_string(),
        "rm".to_string(),
        format!("trusted_cluster/{}", name),
    ]
}

/// Validate a trusted cluster configuration.
pub fn validate_trusted_cluster(cluster: &TrustedCluster) -> Vec<String> {
    let mut issues = Vec::new();

    if cluster.name.is_empty() {
        issues.push("Trusted cluster name is empty".to_string());
    }

    if cluster.proxy_address.is_empty() {
        issues.push("Proxy address is empty".to_string());
    }

    if cluster.role_map.is_empty() {
        issues.push("No role mappings defined — no access will be granted".to_string());
    }

    for (i, rm) in cluster.role_map.iter().enumerate() {
        if rm.remote.is_empty() {
            issues.push(format!("Role mapping {} has empty remote role", i));
        }
        if rm.local.is_empty() {
            issues.push(format!("Role mapping {} has empty local role list", i));
        }
    }

    if cluster.token.is_none() && cluster.status != TrustedClusterStatus::Online {
        issues.push("Cluster is not online and has no join token".to_string());
    }

    issues
}

/// Get all local roles referenced by role mappings.
pub fn all_local_roles(cluster: &TrustedCluster) -> Vec<String> {
    let mut roles: Vec<String> = cluster
        .role_map
        .iter()
        .flat_map(|rm| rm.local.clone())
        .collect();
    roles.sort();
    roles.dedup();
    roles
}

/// Get all remote roles referenced by role mappings.
pub fn all_remote_roles(cluster: &TrustedCluster) -> Vec<String> {
    let mut roles: Vec<String> = cluster
        .role_map
        .iter()
        .map(|rm| rm.remote.clone())
        .collect();
    roles.sort();
    roles.dedup();
    roles
}

/// Group trusted clusters by status.
pub fn group_clusters_by_status<'a>(
    clusters: &[&'a TrustedCluster],
) -> HashMap<String, Vec<&'a TrustedCluster>> {
    let mut map: HashMap<String, Vec<&'a TrustedCluster>> = HashMap::new();
    for c in clusters {
        map.entry(format!("{:?}", c.status)).or_default().push(c);
    }
    map
}

/// Cluster summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterSummary {
    pub total: u32,
    pub online: u32,
    pub offline: u32,
    pub total_role_mappings: u32,
    pub unique_local_roles: u32,
}

pub fn summarize_clusters(clusters: &[&TrustedCluster]) -> ClusterSummary {
    let mut total_mappings = 0u32;
    let mut local_roles = std::collections::HashSet::new();
    let mut online = 0u32;
    let mut offline = 0u32;

    for c in clusters {
        match c.status {
            TrustedClusterStatus::Online => online += 1,
            TrustedClusterStatus::Offline => offline += 1,
            TrustedClusterStatus::Establishing => {}
        }
        total_mappings += c.role_map.len() as u32;
        for rm in &c.role_map {
            for r in &rm.local {
                local_roles.insert(r.clone());
            }
        }
    }

    ClusterSummary {
        total: clusters.len() as u32,
        online,
        offline,
        total_role_mappings: total_mappings,
        unique_local_roles: local_roles.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_cluster() -> TrustedCluster {
        TrustedCluster {
            name: "leaf-1".to_string(),
            enabled: true,
            status: TrustedClusterStatus::Online,
            proxy_address: "leaf-1.example.com:3080".to_string(),
            reverse_tunnel_address: Some("leaf-1.example.com:3024".to_string()),
            token: Some("secret-token".to_string()),
            role_map: vec![RoleMapping {
                remote: "admin".to_string(),
                local: vec!["access".to_string(), "editor".to_string()],
            }],
            last_heartbeat: Some(Utc::now()),
        }
    }

    #[test]
    fn test_validate_trusted_cluster_ok() {
        let c = sample_cluster();
        let issues = validate_trusted_cluster(&c);
        assert!(issues.is_empty(), "unexpected: {:?}", issues);
    }

    #[test]
    fn test_all_local_roles() {
        let c = sample_cluster();
        let roles = all_local_roles(&c);
        assert_eq!(roles, vec!["access", "editor"]);
    }

    #[test]
    fn test_remove_command() {
        let cmd = remove_trusted_cluster_command("leaf-1");
        assert_eq!(cmd[2], "trusted_cluster/leaf-1");
    }
}
