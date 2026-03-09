//! # Teleport Diagnostics
//!
//! Health evaluation, connectivity reporting, and debug command
//! builders for Teleport clusters.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Build `tctl status` command for cluster health.
pub fn cluster_status_command() -> Vec<String> {
    vec!["tctl".to_string(), "status".to_string()]
}

/// Build `tsh status` for user certificate diagnostics.
pub fn user_status_command() -> Vec<String> {
    vec!["tsh".to_string(), "status".to_string()]
}

/// Build `teleport debug` or equivalent diag command.
pub fn diagnostics_command(diag_addr: Option<&str>) -> Vec<String> {
    let addr = diag_addr.unwrap_or("http://127.0.0.1:3000");
    vec![
        "curl".to_string(),
        "-s".to_string(),
        format!("{}/healthz", addr),
    ]
}

/// Build readiness check command.
pub fn readiness_check_command(diag_addr: Option<&str>) -> Vec<String> {
    let addr = diag_addr.unwrap_or("http://127.0.0.1:3000");
    vec![
        "curl".to_string(),
        "-s".to_string(),
        format!("{}/readyz", addr),
    ]
}

/// Build `tctl top` for real-time cluster metrics.
pub fn top_command() -> Vec<String> {
    vec!["tctl".to_string(), "top".to_string()]
}

/// Evaluate a cluster health check and produce human-readable issues.
pub fn evaluate_health(health: &ClusterHealthCheck) -> Vec<String> {
    let mut issues = Vec::new();

    match health.overall {
        HealthStatus::Healthy => {}
        HealthStatus::Degraded => issues.push("Cluster is in degraded state".to_string()),
        HealthStatus::Unhealthy => issues.push("Cluster is unhealthy".to_string()),
    }

    if !health.auth_server.reachable {
        issues.push("Auth server is not reachable".to_string());
    }

    if !health.proxy_server.reachable {
        issues.push("Proxy server is not reachable".to_string());
    }

    if health.nodes_connected < health.nodes_total {
        issues.push(format!(
            "Only {}/{} nodes connected",
            health.nodes_connected, health.nodes_total
        ));
    }

    if !health.errors.is_empty() {
        for err in &health.errors {
            issues.push(format!("Error: {}", err));
        }
    }

    issues
}

/// Connectivity report combining multiple diagnostic checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectivityReport {
    pub cluster_name: String,
    pub overall_status: String,
    pub checks: Vec<DiagCheck>,
}

/// A single diagnostic check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagCheck {
    pub name: String,
    pub passed: bool,
    pub message: String,
}

/// Build a connectivity report from a health check.
pub fn connectivity_report(cluster_name: &str, health: &ClusterHealthCheck) -> ConnectivityReport {
    let issues = evaluate_health(health);
    let mut checks = Vec::new();

    checks.push(DiagCheck {
        name: "Overall Status".to_string(),
        passed: health.overall == HealthStatus::Healthy,
        message: format!("{:?}", health.overall),
    });

    checks.push(DiagCheck {
        name: "Auth Server".to_string(),
        passed: health.auth_server.reachable,
        message: if health.auth_server.reachable {
            format!(
                "Reachable, version {}",
                health.auth_server.version.as_deref().unwrap_or("unknown")
            )
        } else {
            "Not reachable".to_string()
        },
    });

    checks.push(DiagCheck {
        name: "Proxy Server".to_string(),
        passed: health.proxy_server.reachable,
        message: if health.proxy_server.reachable {
            format!(
                "Reachable, version {}",
                health.proxy_server.version.as_deref().unwrap_or("unknown")
            )
        } else {
            "Not reachable".to_string()
        },
    });

    checks.push(DiagCheck {
        name: "Node Connectivity".to_string(),
        passed: health.nodes_connected == health.nodes_total,
        message: format!(
            "{}/{} nodes connected",
            health.nodes_connected, health.nodes_total
        ),
    });

    checks.push(DiagCheck {
        name: "Errors".to_string(),
        passed: health.errors.is_empty(),
        message: if health.errors.is_empty() {
            "No errors".to_string()
        } else {
            format!("{} error(s)", health.errors.len())
        },
    });

    ConnectivityReport {
        cluster_name: cluster_name.to_string(),
        overall_status: if issues.is_empty() {
            "Healthy".to_string()
        } else {
            format!("{} issue(s) found", issues.len())
        },
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn healthy_health() -> ClusterHealthCheck {
        ClusterHealthCheck {
            overall: HealthStatus::Healthy,
            cluster_name: "test-cluster".to_string(),
            cluster_version: "16.1.0".to_string(),
            auth_server: ServerHealth {
                address: "auth.example.com:3025".to_string(),
                reachable: true,
                version: Some("16.1.0".to_string()),
                latency_ms: Some(5.0),
            },
            proxy_server: ServerHealth {
                address: "proxy.example.com:3080".to_string(),
                reachable: true,
                version: Some("16.1.0".to_string()),
                latency_ms: Some(3.0),
            },
            nodes_connected: 10,
            nodes_total: 10,
            license_type: Some("Enterprise".to_string()),
            trusted_clusters: 2,
            trusted_clusters_online: 2,
            active_sessions: 5,
            warnings: vec![],
            errors: vec![],
            checked_at: Utc::now(),
        }
    }

    #[test]
    fn test_evaluate_healthy() {
        let h = healthy_health();
        let issues = evaluate_health(&h);
        assert!(issues.is_empty());
    }

    #[test]
    fn test_evaluate_degraded() {
        let mut h = healthy_health();
        h.overall = HealthStatus::Degraded;
        h.proxy_server.reachable = false;
        let issues = evaluate_health(&h);
        assert!(issues.len() >= 2);
    }

    #[test]
    fn test_connectivity_report_healthy() {
        let h = healthy_health();
        let report = connectivity_report("test-cluster", &h);
        assert_eq!(report.overall_status, "Healthy");
        assert!(report.checks.iter().all(|c| c.passed));
    }

    #[test]
    fn test_cluster_status_command() {
        let cmd = cluster_status_command();
        assert_eq!(cmd, vec!["tctl", "status"]);
    }
}
