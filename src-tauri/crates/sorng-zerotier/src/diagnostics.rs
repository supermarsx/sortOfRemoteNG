//! # ZeroTier Diagnostics
//!
//! Health checks, connectivity tests, bond status, log analysis,
//! troubleshooting recommendations.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Comprehensive diagnostic report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub overall_status: OverallHealth,
    pub checks: Vec<DiagnosticCheck>,
    pub recommendations: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OverallHealth {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    pub name: String,
    pub status: CheckStatus,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
    Skip,
}

/// Build a comprehensive diagnostic report.
pub fn build_diagnostic_report(
    status: Option<&ZtServiceStatus>,
    networks: &[ZtNetworkDetail],
    peers: &[ZtPeer],
) -> DiagnosticReport {
    let mut checks = Vec::new();
    let mut recommendations = Vec::new();

    // Check service status
    if let Some(s) = status {
        checks.push(DiagnosticCheck {
            name: "Service Online".to_string(),
            status: if s.online {
                CheckStatus::Pass
            } else {
                CheckStatus::Fail
            },
            message: format!(
                "ZeroTier {} ({})",
                if s.online { "online" } else { "offline" },
                s.version
            ),
            details: Some(format!("Address: {}, Port: {}", s.address, s.primary_port)),
        });

        if s.tcp_fallback_active {
            checks.push(DiagnosticCheck {
                name: "TCP Fallback".to_string(),
                status: CheckStatus::Warn,
                message: "TCP fallback is active — UDP may be blocked".to_string(),
                details: None,
            });
            recommendations
                .push("Check firewall settings to allow UDP traffic on ZeroTier ports".to_string());
        }
    } else {
        checks.push(DiagnosticCheck {
            name: "Service Online".to_string(),
            status: CheckStatus::Fail,
            message: "Cannot reach ZeroTier service".to_string(),
            details: None,
        });
    }

    // Check networks
    for network in networks {
        let net_status = match network.status {
            ZtNetworkStatus::Ok => CheckStatus::Pass,
            ZtNetworkStatus::Requesting => CheckStatus::Warn,
            ZtNetworkStatus::AccessDenied => CheckStatus::Fail,
            ZtNetworkStatus::NotFound => CheckStatus::Fail,
            _ => CheckStatus::Fail,
        };

        checks.push(DiagnosticCheck {
            name: format!("Network: {}", network.name),
            status: net_status,
            message: format!(
                "Status: {:?}, IPs: {}, Routes: {}",
                network.status,
                network.assigned_addresses.join(", "),
                network.routes.len()
            ),
            details: Some(format!("ID: {}", network.id)),
        });

        if network.status == ZtNetworkStatus::AccessDenied {
            recommendations.push(format!(
                "Network {} access denied — verify authorization on the controller",
                network.id
            ));
        }

        if network.assigned_addresses.is_empty() && network.status == ZtNetworkStatus::Ok {
            checks.push(DiagnosticCheck {
                name: format!("Network {} IPs", network.id),
                status: CheckStatus::Warn,
                message: "No IP addresses assigned".to_string(),
                details: None,
            });
        }

        if network.port_error != 0 {
            checks.push(DiagnosticCheck {
                name: format!("Network {} Port", network.id),
                status: CheckStatus::Fail,
                message: format!("Port error code: {}", network.port_error),
                details: network.port_device_name.clone(),
            });
        }
    }

    // Check peers
    let total_peers = peers.len();
    let reachable = peers
        .iter()
        .filter(|p| p.paths.iter().any(|path| path.active))
        .count();
    let root_peers = peers
        .iter()
        .filter(|p| matches!(p.role, ZtPeerRole::Planet | ZtPeerRole::Moon))
        .count();

    checks.push(DiagnosticCheck {
        name: "Peer Connectivity".to_string(),
        status: if reachable > 0 {
            CheckStatus::Pass
        } else {
            CheckStatus::Fail
        },
        message: format!(
            "{}/{} peers reachable, {} root servers",
            reachable, total_peers, root_peers
        ),
        details: None,
    });

    if root_peers == 0 {
        checks.push(DiagnosticCheck {
            name: "Root Servers".to_string(),
            status: CheckStatus::Fail,
            message: "No root servers (planet/moon) reachable".to_string(),
            details: None,
        });
        recommendations
            .push("Check internet connectivity and firewall rules for UDP port 9993".to_string());
    }

    // Check for high-latency peers
    let high_latency: Vec<&ZtPeer> = peers.iter().filter(|p| p.latency > 200).collect();
    if !high_latency.is_empty() {
        checks.push(DiagnosticCheck {
            name: "High Latency Peers".to_string(),
            status: CheckStatus::Warn,
            message: format!("{} peers with latency > 200ms", high_latency.len()),
            details: Some(
                high_latency
                    .iter()
                    .map(|p| format!("{}: {}ms", p.address, p.latency))
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
        });
    }

    // Check for unreachable peers
    let unreachable: Vec<&ZtPeer> = peers
        .iter()
        .filter(|p| p.paths.iter().all(|path| !path.active) && p.role == ZtPeerRole::Leaf)
        .collect();
    if !unreachable.is_empty() {
        checks.push(DiagnosticCheck {
            name: "Unreachable Peers".to_string(),
            status: CheckStatus::Warn,
            message: format!("{} peers with no active paths", unreachable.len()),
            details: Some(
                unreachable
                    .iter()
                    .map(|p| p.address.clone())
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
        });
    }

    // Determine overall status
    let has_fail = checks.iter().any(|c| c.status == CheckStatus::Fail);
    let has_warn = checks.iter().any(|c| c.status == CheckStatus::Warn);

    let overall_status = if has_fail {
        OverallHealth::Unhealthy
    } else if has_warn {
        OverallHealth::Degraded
    } else {
        OverallHealth::Healthy
    };

    DiagnosticReport {
        overall_status,
        checks,
        recommendations,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}

/// Build commands for troubleshooting.
pub fn troubleshooting_commands() -> Vec<(&'static str, Vec<String>)> {
    vec![
        (
            "Service Info",
            vec![
                "zerotier-cli".to_string(),
                "info".to_string(),
                "-j".to_string(),
            ],
        ),
        (
            "Network List",
            vec![
                "zerotier-cli".to_string(),
                "listnetworks".to_string(),
                "-j".to_string(),
            ],
        ),
        (
            "Peer List",
            vec![
                "zerotier-cli".to_string(),
                "listpeers".to_string(),
                "-j".to_string(),
            ],
        ),
        (
            "Moon List",
            vec!["zerotier-cli".to_string(), "listmoons".to_string()],
        ),
    ]
}

/// Analyze potential connectivity issues.
pub fn analyze_connectivity(status: &ZtServiceStatus, peers: &[ZtPeer]) -> Vec<String> {
    let mut issues = Vec::new();

    if !status.online {
        issues.push("ZeroTier service is offline".to_string());
    }

    if status.tcp_fallback_active {
        issues.push("TCP fallback active — UDP likely blocked by firewall".to_string());
    }

    let planet_count = peers
        .iter()
        .filter(|p| p.role == ZtPeerRole::Planet)
        .count();
    if planet_count == 0 {
        issues.push(
            "No planet root servers reachable — possible internet connectivity issue".to_string(),
        );
    }

    let all_high_latency = peers
        .iter()
        .filter(|p| p.latency >= 0)
        .all(|p| p.latency > 300);
    if all_high_latency && !peers.is_empty() {
        issues
            .push("All peers have high latency (>300ms) — possible network congestion".to_string());
    }

    let no_direct = peers
        .iter()
        .filter(|p| p.role == ZtPeerRole::Leaf)
        .all(|p| !p.paths.iter().any(|path| path.preferred));
    if no_direct {
        issues.push(
            "No direct peer connections — traffic is being relayed through root servers"
                .to_string(),
        );
    }

    issues
}
