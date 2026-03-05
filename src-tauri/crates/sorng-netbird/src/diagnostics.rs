//! # NetBird Diagnostics
//!
//! Health checks, connectivity probes, debug bundle generation, and
//! network quality assessment.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Build the `netbird status --detail` command for diagnostics.
pub fn debug_status_command() -> Vec<String> {
    vec![
        "netbird".to_string(),
        "status".to_string(),
        "--json".to_string(),
        "--detail".to_string(),
    ]
}

/// Build a debug bundle command.
pub fn debug_bundle_command(output_path: &str) -> Vec<String> {
    vec![
        "netbird".to_string(),
        "debug".to_string(),
        "bundle".to_string(),
        "-o".to_string(),
        output_path.to_string(),
    ]
}

/// Build a log command (follows daemon logs).
pub fn log_command(lines: u32) -> Vec<String> {
    vec![
        "netbird".to_string(),
        "debug".to_string(),
        "log".to_string(),
        "-n".to_string(),
        lines.to_string(),
    ]
}

/// Evaluate the overall health from infrastructure connectivity.
pub fn evaluate_health(
    mgmt: &ManagementServer,
    signal: &SignalServer,
    relays: &[TurnRelay],
    interface_up: bool,
) -> HealthStatus {
    if !mgmt.connected || !signal.connected || !interface_up {
        return HealthStatus::Unhealthy;
    }
    let available_relays = relays.iter().filter(|r| r.available).count();
    if available_relays == 0 && !relays.is_empty() {
        return HealthStatus::Degraded;
    }
    HealthStatus::Healthy
}

/// Run a series of connectivity checks and produce a report.
pub fn connectivity_report(
    mgmt: &ManagementServer,
    signal: &SignalServer,
    relays: &[TurnRelay],
    interface_up: bool,
    peers_total: u32,
    peers_connected: u32,
) -> ConnectivityReport {
    let checks = vec![
        CheckResult {
            name: "Management server".into(),
            passed: mgmt.connected,
            detail: mgmt.uri.clone(),
            latency_ms: mgmt.latency_ms,
        },
        CheckResult {
            name: "Signal server".into(),
            passed: signal.connected,
            detail: signal.uri.clone(),
            latency_ms: signal.latency_ms,
        },
        CheckResult {
            name: "WireGuard interface".into(),
            passed: interface_up,
            detail: if interface_up { "up" } else { "down" }.into(),
            latency_ms: None,
        },
        CheckResult {
            name: "TURN relays".into(),
            passed: relays.iter().any(|r| r.available),
            detail: format!(
                "{}/{} available",
                relays.iter().filter(|r| r.available).count(),
                relays.len()
            ),
            latency_ms: relays
                .iter()
                .filter_map(|r| r.latency_ms)
                .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)),
        },
        CheckResult {
            name: "Peer connectivity".into(),
            passed: peers_connected > 0 || peers_total == 0,
            detail: format!("{}/{} connected", peers_connected, peers_total),
            latency_ms: None,
        },
    ];

    let passed = checks.iter().filter(|c| c.passed).count() as u32;
    ConnectivityReport {
        overall: evaluate_health(mgmt, signal, relays, interface_up),
        checks_passed: passed,
        checks_total: checks.len() as u32,
        checks,
    }
}

/// A full connectivity report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectivityReport {
    pub overall: HealthStatus,
    pub checks_passed: u32,
    pub checks_total: u32,
    pub checks: Vec<CheckResult>,
}

/// A single check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    pub name: String,
    pub passed: bool,
    pub detail: String,
    pub latency_ms: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_mgmt(connected: bool) -> ManagementServer {
        ManagementServer {
            uri: "https://api.netbird.io".into(),
            connected,
            version: Some("0.28.0".into()),
            latency_ms: Some(15.0),
        }
    }

    fn make_signal(connected: bool) -> SignalServer {
        SignalServer {
            uri: "wss://signal.netbird.io".into(),
            connected,
            protocol: SignalProtocol::Grpc,
            latency_ms: Some(12.0),
        }
    }

    fn make_relay(available: bool) -> TurnRelay {
        TurnRelay {
            uri: "turn:relay.netbird.io:3478".into(),
            username: None,
            available,
            latency_ms: Some(25.0),
            region: Some("us-east".into()),
            protocol: TurnProtocol::Udp,
        }
    }

    #[test]
    fn test_evaluate_health_healthy() {
        let status = evaluate_health(
            &make_mgmt(true),
            &make_signal(true),
            &[make_relay(true)],
            true,
        );
        assert_eq!(status, HealthStatus::Healthy);
    }

    #[test]
    fn test_evaluate_health_unhealthy_mgmt() {
        let status = evaluate_health(
            &make_mgmt(false),
            &make_signal(true),
            &[make_relay(true)],
            true,
        );
        assert_eq!(status, HealthStatus::Unhealthy);
    }

    #[test]
    fn test_evaluate_health_degraded_relays() {
        let status = evaluate_health(
            &make_mgmt(true),
            &make_signal(true),
            &[make_relay(false)],
            true,
        );
        assert_eq!(status, HealthStatus::Degraded);
    }

    #[test]
    fn test_connectivity_report() {
        let report = connectivity_report(
            &make_mgmt(true),
            &make_signal(true),
            &[make_relay(true)],
            true,
            10,
            8,
        );
        assert_eq!(report.overall, HealthStatus::Healthy);
        assert_eq!(report.checks_passed, report.checks_total);
    }
}
