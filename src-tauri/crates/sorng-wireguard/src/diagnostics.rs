//! # WireGuard Diagnostics
//!
//! Health checks, handshake monitoring, transfer stats analysis,
//! endpoint reachability testing, configuration auditing.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Complete diagnostic report for a WireGuard connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub connection_id: String,
    pub interface: String,
    pub timestamp: String,
    pub overall_health: HealthStatus,
    pub checks: Vec<DiagnosticCheck>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    pub name: String,
    pub status: HealthStatus,
    pub message: String,
}

/// Build a diagnostic report for the given interface and peer stats.
pub fn build_diagnostic_report(
    connection_id: &str,
    interface: &str,
    interface_stats: &WgInterfaceStats,
    peer_stats: &[WgPeerStats],
    config: &WgConfig,
) -> DiagnosticReport {
    let mut checks = Vec::new();
    let mut recommendations = Vec::new();

    // 1. Interface — check if running
    let total_rx: u64 = interface_stats.peers.iter().map(|p| p.transfer_rx).sum();
    let total_tx: u64 = interface_stats.peers.iter().map(|p| p.transfer_tx).sum();
    checks.push(DiagnosticCheck {
        name: "Interface Status".to_string(),
        status: if total_rx > 0 || total_tx > 0 {
            HealthStatus::Healthy
        } else {
            HealthStatus::Degraded
        },
        message: format!("RX: {} bytes, TX: {} bytes", total_rx, total_tx),
    });

    // 2. Peer handshakes
    for (i, peer) in peer_stats.iter().enumerate() {
        let handshake_check = check_handshake(peer, i);
        if handshake_check.status == HealthStatus::Unhealthy {
            recommendations.push(format!(
                "Peer {} has no recent handshake — check endpoint reachability and keys",
                peer.public_key.chars().take(8).collect::<String>()
            ));
        }
        checks.push(handshake_check);
    }

    // 3. Transfer activity
    for peer in peer_stats {
        let transfer_check = check_transfer(peer);
        if transfer_check.status == HealthStatus::Degraded {
            recommendations.push(format!(
                "Peer {} has zero received bytes — possible one-way communication",
                peer.public_key.chars().take(8).collect::<String>()
            ));
        }
        checks.push(transfer_check);
    }

    // 4. Config audit
    let config_checks = audit_config(config);
    for check in &config_checks {
        if check.status != HealthStatus::Healthy {
            recommendations.push(check.message.clone());
        }
    }
    checks.extend(config_checks);

    // 5. DNS safety
    let dns_audit = super::dns::audit_dns_safety(config);
    checks.push(DiagnosticCheck {
        name: "DNS Configuration".to_string(),
        status: match dns_audit.risk_level {
            super::dns::DnsRiskLevel::Low => HealthStatus::Healthy,
            super::dns::DnsRiskLevel::Medium => HealthStatus::Degraded,
            super::dns::DnsRiskLevel::High => HealthStatus::Unhealthy,
        },
        message: format!(
            "DNS configured: {}, Full tunnel: {}, Risk: {:?}",
            dns_audit.has_dns_configured, dns_audit.is_full_tunnel, dns_audit.risk_level
        ),
    });
    recommendations.extend(dns_audit.recommendations);

    // Overall health
    let overall_health = compute_overall_health(&checks);

    DiagnosticReport {
        connection_id: connection_id.to_string(),
        interface: interface.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        overall_health,
        checks,
        recommendations,
    }
}

fn check_handshake(peer: &WgPeerStats, index: usize) -> DiagnosticCheck {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let handshake_status = super::interface::check_handshake(peer.latest_handshake, now);
    let age = peer.latest_handshake.map(|ts| now.saturating_sub(ts));

    match handshake_status {
        HandshakeStatus::Active => {
            let seconds_ago = age.unwrap_or(0);
            let status = if seconds_ago < 180 {
                HealthStatus::Healthy
            } else if seconds_ago < 300 {
                HealthStatus::Degraded
            } else {
                HealthStatus::Unhealthy
            };

            DiagnosticCheck {
                name: format!("Peer {} Handshake", index),
                status,
                message: format!("Last handshake {} seconds ago", seconds_ago),
            }
        }
        HandshakeStatus::Stale => DiagnosticCheck {
            name: format!("Peer {} Handshake", index),
            status: HealthStatus::Degraded,
            message: format!("Handshake is stale ({} seconds ago)", age.unwrap_or(0)),
        },
        HandshakeStatus::None => DiagnosticCheck {
            name: format!("Peer {} Handshake", index),
            status: HealthStatus::Unhealthy,
            message: "No handshake ever completed".to_string(),
        },
    }
}

fn check_transfer(peer: &WgPeerStats) -> DiagnosticCheck {
    let status = if peer.transfer_rx > 0 && peer.transfer_tx > 0 {
        HealthStatus::Healthy
    } else if peer.transfer_tx > 0 {
        HealthStatus::Degraded
    } else {
        HealthStatus::Unhealthy
    };

    DiagnosticCheck {
        name: format!(
            "Peer {} Transfer",
            peer.public_key.chars().take(8).collect::<String>()
        ),
        status,
        message: format!(
            "RX: {} bytes, TX: {} bytes",
            peer.transfer_rx, peer.transfer_tx
        ),
    }
}

fn audit_config(config: &WgConfig) -> Vec<DiagnosticCheck> {
    let mut checks = Vec::new();

    // Check private key present
    checks.push(DiagnosticCheck {
        name: "Private Key".to_string(),
        status: if !config.interface.private_key.is_empty() {
            HealthStatus::Healthy
        } else {
            HealthStatus::Unhealthy
        },
        message: if config.interface.private_key.is_empty() {
            "No private key configured".to_string()
        } else {
            "Private key present".to_string()
        },
    });

    // Check address assignment
    checks.push(DiagnosticCheck {
        name: "Address".to_string(),
        status: if !config.interface.address.is_empty() {
            HealthStatus::Healthy
        } else {
            HealthStatus::Unhealthy
        },
        message: if config.interface.address.is_empty() {
            "No address configured".to_string()
        } else {
            format!("Address: {}", config.interface.address.join(", "))
        },
    });

    // Check peers
    if config.peers.is_empty() {
        checks.push(DiagnosticCheck {
            name: "Peers".to_string(),
            status: HealthStatus::Unhealthy,
            message: "No peers configured".to_string(),
        });
    } else {
        for (i, peer) in config.peers.iter().enumerate() {
            let mut peer_issues = Vec::new();

            if peer.public_key.is_empty() {
                peer_issues.push("missing public key");
            }

            if peer.endpoint.is_none() && peer.allowed_ips.iter().any(|a| a == "0.0.0.0/0") {
                peer_issues.push("full tunnel peer without endpoint");
            }

            checks.push(DiagnosticCheck {
                name: format!("Peer {} Config", i),
                status: if peer_issues.is_empty() {
                    HealthStatus::Healthy
                } else {
                    HealthStatus::Unhealthy
                },
                message: if peer_issues.is_empty() {
                    format!(
                        "AllowedIPs: {}, Endpoint: {}",
                        peer.allowed_ips.join(", "),
                        peer.endpoint.as_deref().unwrap_or("(none)")
                    )
                } else {
                    peer_issues.join(", ")
                },
            });
        }
    }

    // MTU check
    if let Some(mtu) = config.interface.mtu {
        let status = if (1280..=1500).contains(&mtu) {
            HealthStatus::Healthy
        } else {
            HealthStatus::Degraded
        };
        checks.push(DiagnosticCheck {
            name: "MTU".to_string(),
            status,
            message: format!("MTU: {} (recommended: 1280-1420)", mtu),
        });
    }

    checks
}

fn compute_overall_health(checks: &[DiagnosticCheck]) -> HealthStatus {
    if checks.iter().any(|c| c.status == HealthStatus::Unhealthy) {
        HealthStatus::Unhealthy
    } else if checks.iter().any(|c| c.status == HealthStatus::Degraded) {
        HealthStatus::Degraded
    } else if checks.iter().all(|c| c.status == HealthStatus::Unknown) {
        HealthStatus::Unknown
    } else {
        HealthStatus::Healthy
    }
}

/// Commands for troubleshooting a WireGuard connection.
pub fn troubleshooting_commands(interface: &str) -> Vec<TroubleshootingCommand> {
    let mut commands = vec![
        TroubleshootingCommand {
            description: "Show interface status".to_string(),
            command: format!("wg show {}", interface),
        },
        TroubleshootingCommand {
            description: "Show interface dump (machine-readable)".to_string(),
            command: format!("wg showconf {}", interface),
        },
    ];

    if cfg!(target_os = "linux") {
        commands.extend(vec![
            TroubleshootingCommand {
                description: "Check routing table".to_string(),
                command: format!("ip route show dev {}", interface),
            },
            TroubleshootingCommand {
                description: "Check interface addresses".to_string(),
                command: format!("ip addr show {}", interface),
            },
            TroubleshootingCommand {
                description: "Check firewall rules".to_string(),
                command: "iptables -L -n -v".to_string(),
            },
            TroubleshootingCommand {
                description: "DNS resolution check".to_string(),
                command: format!("resolvectl status {}", interface),
            },
        ]);
    } else if cfg!(target_os = "windows") {
        commands.extend(vec![
            TroubleshootingCommand {
                description: "Check routes".to_string(),
                command: "route print".to_string(),
            },
            TroubleshootingCommand {
                description: "Check interface config".to_string(),
                command: format!("netsh interface ipv4 show config name=\"{}\"", interface),
            },
            TroubleshootingCommand {
                description: "Check DNS config".to_string(),
                command: format!(
                    "netsh interface ipv4 show dnsservers name=\"{}\"",
                    interface
                ),
            },
        ]);
    }

    commands.push(TroubleshootingCommand {
        description: "Test connectivity through tunnel".to_string(),
        command: "ping -c 4 10.0.0.1".to_string(),
    });

    commands
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TroubleshootingCommand {
    pub description: String,
    pub command: String,
}

/// Analyze handshake history for connection stability.
pub fn analyze_stability(handshake_samples: &[(u64, HandshakeStatus)]) -> StabilityReport {
    if handshake_samples.is_empty() {
        return StabilityReport {
            sample_count: 0,
            healthy_ratio: 0.0,
            longest_gap_secs: 0,
            average_handshake_interval: 0,
            classification: "insufficient-data".to_string(),
        };
    }

    let healthy = handshake_samples
        .iter()
        .filter(|(_, s)| matches!(s, HandshakeStatus::Active))
        .count();

    let healthy_ratio = healthy as f64 / handshake_samples.len() as f64;

    // Find longest gap between samples where handshake was healthy
    let mut max_gap = 0u64;
    let mut last_healthy_ts = 0u64;

    for (ts, status) in handshake_samples {
        if matches!(status, HandshakeStatus::Active) {
            if last_healthy_ts > 0 {
                let gap = ts.saturating_sub(last_healthy_ts);
                if gap > max_gap {
                    max_gap = gap;
                }
            }
            last_healthy_ts = *ts;
        }
    }

    let classification = if healthy_ratio > 0.95 {
        "stable"
    } else if healthy_ratio > 0.7 {
        "intermittent"
    } else {
        "unstable"
    };

    // Average interval between healthy handshakes
    let avg_interval = if healthy > 1 {
        let first = handshake_samples.first().map(|(t, _)| *t).unwrap_or(0);
        let last = handshake_samples.last().map(|(t, _)| *t).unwrap_or(0);
        (last.saturating_sub(first)) / (healthy as u64).max(1)
    } else {
        0
    };

    StabilityReport {
        sample_count: handshake_samples.len(),
        healthy_ratio,
        longest_gap_secs: max_gap,
        average_handshake_interval: avg_interval,
        classification: classification.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StabilityReport {
    pub sample_count: usize,
    pub healthy_ratio: f64,
    pub longest_gap_secs: u64,
    pub average_handshake_interval: u64,
    pub classification: String,
}
