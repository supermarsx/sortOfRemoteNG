//! # Tailscale Diagnostics
//!
//! Health checks, bugreport generation, connectivity tests,
//! log collection, configuration analysis.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Overall health report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    pub overall_status: OverallHealth,
    pub checks: Vec<HealthCheckResult>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OverallHealth {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

/// Individual health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    pub name: String,
    pub status: CheckStatus,
    pub message: String,
    pub details: Option<String>,
    pub severity: CheckSeverity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
    Skip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckSeverity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

/// Build a comprehensive health report.
pub fn build_health_report(
    status: &super::daemon::TailscaleStatusJson,
    netcheck: Option<&super::network::NetcheckReport>,
) -> HealthReport {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();
    let mut errors = Vec::new();

    // Check backend state
    let backend_ok = status
        .backend_state
        .as_deref()
        .map(|s| s == "Running")
        .unwrap_or(false);

    checks.push(HealthCheckResult {
        name: "Backend State".to_string(),
        status: if backend_ok {
            CheckStatus::Pass
        } else {
            CheckStatus::Fail
        },
        message: format!(
            "Backend is {}",
            status.backend_state.as_deref().unwrap_or("unknown")
        ),
        details: None,
        severity: CheckSeverity::Critical,
    });

    // Check Tailscale IPs
    let has_ips = status
        .tailscale_ips
        .as_ref()
        .map(|ips| !ips.is_empty())
        .unwrap_or(false);

    checks.push(HealthCheckResult {
        name: "Tailscale IPs".to_string(),
        status: if has_ips {
            CheckStatus::Pass
        } else {
            CheckStatus::Fail
        },
        message: if has_ips {
            format!(
                "Assigned IPs: {}",
                status
                    .tailscale_ips
                    .as_ref()
                    .map(|ips| ips.join(", "))
                    .unwrap_or_default()
            )
        } else {
            "No Tailscale IPs assigned".to_string()
        },
        details: None,
        severity: CheckSeverity::Critical,
    });

    // Check auth
    let needs_auth = status.auth_url.is_some();
    if needs_auth {
        checks.push(HealthCheckResult {
            name: "Authentication".to_string(),
            status: CheckStatus::Fail,
            message: "Needs re-authentication".to_string(),
            details: status.auth_url.clone(),
            severity: CheckSeverity::High,
        });
        errors.push("Authentication required".to_string());
    } else {
        checks.push(HealthCheckResult {
            name: "Authentication".to_string(),
            status: CheckStatus::Pass,
            message: "Authenticated".to_string(),
            details: None,
            severity: CheckSeverity::High,
        });
    }

    // Check health messages from status
    if let Some(health) = &status.health {
        for msg in health {
            warnings.push(msg.clone());
            checks.push(HealthCheckResult {
                name: "Health Warning".to_string(),
                status: CheckStatus::Warn,
                message: msg.clone(),
                details: None,
                severity: CheckSeverity::Medium,
            });
        }
    }

    // Check MagicDNS
    checks.push(HealthCheckResult {
        name: "MagicDNS".to_string(),
        status: if status.magic_dns_suffix.is_some() {
            CheckStatus::Pass
        } else {
            CheckStatus::Warn
        },
        message: status
            .magic_dns_suffix
            .as_ref()
            .map(|s| format!("MagicDNS suffix: {}", s))
            .unwrap_or_else(|| "MagicDNS not configured".to_string()),
        details: None,
        severity: CheckSeverity::Low,
    });

    // Netcheck diagnostics
    if let Some(nc) = netcheck {
        checks.push(HealthCheckResult {
            name: "UDP Connectivity".to_string(),
            status: if nc.udp { CheckStatus::Pass } else { CheckStatus::Fail },
            message: format!("UDP: {}", if nc.udp { "available" } else { "blocked" }),
            details: None,
            severity: CheckSeverity::High,
        });

        checks.push(HealthCheckResult {
            name: "IPv4".to_string(),
            status: if nc.ipv4 { CheckStatus::Pass } else { CheckStatus::Warn },
            message: format!("IPv4: {}", if nc.ipv4 { "available" } else { "unavailable" }),
            details: nc.global_v4.clone(),
            severity: CheckSeverity::Medium,
        });

        checks.push(HealthCheckResult {
            name: "IPv6".to_string(),
            status: if nc.ipv6 { CheckStatus::Pass } else { CheckStatus::Warn },
            message: format!("IPv6: {}", if nc.ipv6 { "available" } else { "unavailable" }),
            details: nc.global_v6.clone(),
            severity: CheckSeverity::Low,
        });

        if nc.mapping_varies_by_dest_ip == Some(true) {
            warnings.push("NAT mapping varies by destination — may cause connectivity issues".to_string());
            checks.push(HealthCheckResult {
                name: "NAT Type".to_string(),
                status: CheckStatus::Warn,
                message: "Symmetric NAT detected — direct connections may be harder".to_string(),
                details: None,
                severity: CheckSeverity::Medium,
            });
        }

        if nc.captive_portal == Some(true) {
            errors.push("Captive portal detected — connectivity may be limited".to_string());
            checks.push(HealthCheckResult {
                name: "Captive Portal".to_string(),
                status: CheckStatus::Fail,
                message: "Captive portal detected".to_string(),
                details: None,
                severity: CheckSeverity::High,
            });
        }

        if let Some(derp) = nc.preferred_derp {
            checks.push(HealthCheckResult {
                name: "DERP Relay".to_string(),
                status: CheckStatus::Pass,
                message: format!("Preferred DERP: region {}", derp),
                details: None,
                severity: CheckSeverity::Medium,
            });
        }
    }

    // Determine overall status
    let has_critical_fail = checks
        .iter()
        .any(|c| c.status == CheckStatus::Fail && c.severity == CheckSeverity::Critical);
    let has_any_fail = checks.iter().any(|c| c.status == CheckStatus::Fail);
    let has_warnings = checks.iter().any(|c| c.status == CheckStatus::Warn);

    let overall_status = if has_critical_fail {
        OverallHealth::Unhealthy
    } else if has_any_fail {
        OverallHealth::Degraded
    } else if has_warnings {
        OverallHealth::Degraded
    } else {
        OverallHealth::Healthy
    };

    HealthReport {
        overall_status,
        checks,
        warnings,
        errors,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}

/// Build bugreport command.
pub fn bugreport_command() -> Vec<String> {
    vec!["tailscale".to_string(), "bugreport".to_string()]
}

/// Build debug command.
pub fn debug_command(subcmd: &str) -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "debug".to_string(),
        subcmd.to_string(),
    ]
}

/// Log collection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    pub include_daemon_logs: bool,
    pub include_network_logs: bool,
    pub include_status: bool,
    pub include_netcheck: bool,
    pub include_bugreport: bool,
    pub max_lines: Option<usize>,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            include_daemon_logs: true,
            include_network_logs: true,
            include_status: true,
            include_netcheck: true,
            include_bugreport: false,
            max_lines: Some(1000),
        }
    }
}

/// Connectivity test suite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectivityTestResult {
    pub tests: Vec<ConnectivityTest>,
    pub overall_pass: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectivityTest {
    pub name: String,
    pub passed: bool,
    pub latency_ms: Option<f64>,
    pub error: Option<String>,
}

/// Build a connectivity test plan.
pub fn build_connectivity_tests(
    peers: &[super::peer::PeerDetail],
    max_peers: usize,
) -> Vec<String> {
    // Select a representative set of peers to test
    let mut targets = Vec::new();

    // Always test a direct peer if available
    if let Some(direct) = peers
        .iter()
        .find(|p| p.connection.connection_type == super::peer::PeerConnectionType::Direct && !p.is_self)
    {
        targets.push(direct.tailscale_ips.first().cloned().unwrap_or(direct.hostname.clone()));
    }

    // Test a relay peer
    if let Some(relay) = peers
        .iter()
        .find(|p| p.connection.connection_type == super::peer::PeerConnectionType::Relay)
    {
        targets.push(relay.tailscale_ips.first().cloned().unwrap_or(relay.hostname.clone()));
    }

    // Add more online peers up to limit
    for peer in peers.iter().filter(|p| p.online && !p.is_self) {
        if targets.len() >= max_peers {
            break;
        }
        let addr = peer
            .tailscale_ips
            .first()
            .cloned()
            .unwrap_or(peer.hostname.clone());
        if !targets.contains(&addr) {
            targets.push(addr);
        }
    }

    targets
}

/// Analyze configuration for potential issues.
pub fn analyze_configuration(
    status: &super::daemon::TailscaleStatusJson,
    peer_count: usize,
) -> Vec<ConfigRecommendation> {
    let mut recommendations = Vec::new();

    if peer_count > 100 {
        recommendations.push(ConfigRecommendation {
            category: "Performance".to_string(),
            message: format!(
                "Large tailnet with {} peers — consider using ACLs to limit visibility",
                peer_count
            ),
            severity: CheckSeverity::Medium,
        });
    }

    if status.magic_dns_suffix.is_none() {
        recommendations.push(ConfigRecommendation {
            category: "DNS".to_string(),
            message: "MagicDNS is not enabled — enable it for easier peer access".to_string(),
            severity: CheckSeverity::Low,
        });
    }

    if status.cert_domains.as_ref().map(|d| d.is_empty()).unwrap_or(true) {
        recommendations.push(ConfigRecommendation {
            category: "HTTPS".to_string(),
            message: "No HTTPS cert domains — enable MagicDNS and HTTPS to use Funnel/Serve".to_string(),
            severity: CheckSeverity::Info,
        });
    }

    recommendations
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigRecommendation {
    pub category: String,
    pub message: String,
    pub severity: CheckSeverity,
}
