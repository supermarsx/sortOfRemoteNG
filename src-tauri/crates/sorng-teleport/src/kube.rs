//! # Teleport Kubernetes Access
//!
//! List Kubernetes clusters, configure kubectl context, exec into pods,
//! and manage Kubernetes sessions.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Build `tsh kube ls` command.
pub fn list_kube_clusters_command(cluster: Option<&str>, format_json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "kube".to_string(), "ls".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh kube login` command.
pub fn kube_login_command(kube_cluster: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "kube".to_string(),
        "login".to_string(),
        kube_cluster.to_string(),
    ]
}

/// Build `tsh kube sessions` command.
pub fn kube_sessions_command(format_json: bool) -> Vec<String> {
    let mut cmd = vec![
        "tsh".to_string(),
        "kube".to_string(),
        "sessions".to_string(),
    ];
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh kube exec` command.
pub fn kube_exec_command(
    pod: &str,
    namespace: Option<&str>,
    container: Option<&str>,
    command: &str,
) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "kube".to_string(), "exec".to_string()];
    if let Some(ns) = namespace {
        cmd.push(format!("--namespace={}", ns));
    }
    if let Some(c) = container {
        cmd.push(format!("--container={}", c));
    }
    cmd.push(pod.to_string());
    cmd.push("--".to_string());
    cmd.push(command.to_string());
    cmd
}

/// Build `tsh kube credentials` for kubectl config.
pub fn kube_credentials_command(kube_cluster: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "kube".to_string(),
        "credentials".to_string(),
        kube_cluster.to_string(),
    ]
}

/// Summary of Kubernetes clusters by status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeSummary {
    pub total: u32,
    pub online: u32,
    pub offline: u32,
}

pub fn summarize_kube(clusters: &[&TeleportKubeCluster]) -> KubeSummary {
    KubeSummary {
        total: clusters.len() as u32,
        online: clusters
            .iter()
            .filter(|c| c.status == ResourceStatus::Online)
            .count() as u32,
        offline: clusters
            .iter()
            .filter(|c| c.status == ResourceStatus::Offline)
            .count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kube_login_command() {
        let cmd = kube_login_command("prod-cluster");
        assert_eq!(cmd, vec!["tsh", "kube", "login", "prod-cluster"]);
    }

    #[test]
    fn test_kube_exec_command() {
        let cmd = kube_exec_command("my-pod", Some("default"), Some("app"), "bash");
        assert!(cmd.contains(&"--namespace=default".to_string()));
        assert!(cmd.contains(&"--container=app".to_string()));
        assert!(cmd.contains(&"my-pod".to_string()));
        assert!(cmd.contains(&"bash".to_string()));
    }

    #[test]
    fn test_list_kube_clusters_command_json() {
        let cmd = list_kube_clusters_command(None, true);
        assert!(cmd.contains(&"--format=json".to_string()));
    }
}
