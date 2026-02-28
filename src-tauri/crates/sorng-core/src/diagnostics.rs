//! Shared connection diagnostics infrastructure.
//!
//! Provides reusable types and helpers for protocol-specific diagnostic probes
//! (RDP, SSH, HTTP, etc.).  Each protocol module implements its own deep
//! diagnostics using [`DiagnosticStep`] and [`DiagnosticReport`] and can
//! leverage the parallel-probe helpers in this module.

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

// ─── Shared types ───────────────────────────────────────────────────────────

/// Result of a single diagnostic probe step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticStep {
    pub name: String,
    /// `"pass"` | `"fail"` | `"skip"` | `"warn"` | `"info"`
    pub status: String,
    pub message: String,
    pub duration_ms: u64,
    pub detail: Option<String>,
}

/// Full diagnostic report returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub host: String,
    pub port: u16,
    pub protocol: String,
    pub resolved_ip: Option<String>,
    pub steps: Vec<DiagnosticStep>,
    pub summary: String,
    pub root_cause_hint: Option<String>,
    /// Wall-clock milliseconds for the entire diagnostic run.
    pub total_duration_ms: u64,
}

// ─── Shared probe helpers ───────────────────────────────────────────────────

/// Resolve a hostname to all addresses (IPv4+IPv6) and return the first.
/// Pushes a [`DiagnosticStep`] onto `steps`.  Returns `None` on failure.
pub fn probe_dns(
    host: &str,
    port: u16,
    steps: &mut Vec<DiagnosticStep>,
) -> (Option<SocketAddr>, Option<String>, Vec<String>) {
    let addr_str = format!("{host}:{port}");
    let t = Instant::now();
    match addr_str.to_socket_addrs() {
        Ok(addrs) => {
            let all: Vec<SocketAddr> = addrs.collect();
            if all.is_empty() {
                steps.push(DiagnosticStep {
                    name: "DNS Resolution".into(),
                    status: "fail".into(),
                    message: format!("DNS returned no addresses for {host}"),
                    duration_ms: t.elapsed().as_millis() as u64,
                    detail: Some(
                        "Verify the hostname is correct and DNS is configured".into(),
                    ),
                });
                return (None, None, Vec::new());
            }
            let first = all[0];
            let ip_str = first.ip().to_string();
            let all_ips: Vec<String> = all.iter().map(|a| a.ip().to_string()).collect();
            let detail = if all_ips.len() > 1 {
                Some(format!("All resolved addresses: {}", all_ips.join(", ")))
            } else {
                None
            };
            steps.push(DiagnosticStep {
                name: "DNS Resolution".into(),
                status: "pass".into(),
                message: format!("{host} → {} ({} address{})", ip_str, all_ips.len(), if all_ips.len() > 1 { "es" } else { "" }),
                duration_ms: t.elapsed().as_millis() as u64,
                detail,
            });
            (Some(first), Some(ip_str), all_ips)
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                name: "DNS Resolution".into(),
                status: "fail".into(),
                message: format!("DNS lookup failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(
                    "Check hostname spelling, DNS server, and network connectivity".into(),
                ),
            });
            (None, None, Vec::new())
        }
    }
}

/// Attempt a TCP connect with timeout.  Pushes a [`DiagnosticStep`].
/// Returns the connected `TcpStream` on success.
pub fn probe_tcp(
    socket_addr: SocketAddr,
    timeout: Duration,
    nodelay: bool,
    steps: &mut Vec<DiagnosticStep>,
) -> Option<TcpStream> {
    let t = Instant::now();
    match TcpStream::connect_timeout(&socket_addr, timeout) {
        Ok(stream) => {
            let _ = stream.set_nodelay(nodelay);
            steps.push(DiagnosticStep {
                name: "TCP Connect".into(),
                status: "pass".into(),
                message: format!("Connected to {socket_addr} in {}ms", t.elapsed().as_millis()),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            Some(stream)
        }
        Err(e) => {
            let detail = if e.kind() == std::io::ErrorKind::TimedOut {
                "Connection timed out — the port may be firewalled or the host is unreachable"
            } else if e.kind() == std::io::ErrorKind::ConnectionRefused {
                "Connection refused — the service may not be running or is on a different port"
            } else {
                "Check firewall rules, VPN connectivity, and that the service is running"
            };
            steps.push(DiagnosticStep {
                name: "TCP Connect".into(),
                status: "fail".into(),
                message: format!("TCP connect failed: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: Some(detail.into()),
            });
            None
        }
    }
}

/// Read the service banner (first bytes sent by the server after connect).
/// Waits up to `timeout` for data.
pub fn probe_banner(
    stream: &TcpStream,
    timeout: Duration,
    step_name: &str,
    steps: &mut Vec<DiagnosticStep>,
) -> Option<String> {
    let _ = stream.set_read_timeout(Some(timeout));
    let t = Instant::now();
    let mut buf = [0u8; 1024];
    match std::io::Read::read(&mut &*stream, &mut buf) {
        Ok(0) => {
            steps.push(DiagnosticStep {
                name: step_name.into(),
                status: "warn".into(),
                message: "Server closed connection without sending a banner".into(),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            None
        }
        Ok(n) => {
            let banner = String::from_utf8_lossy(&buf[..n]).trim().to_string();
            steps.push(DiagnosticStep {
                name: step_name.into(),
                status: "pass".into(),
                message: format!("Banner: {}", banner.chars().take(120).collect::<String>()),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: if banner.len() > 120 {
                    Some(format!("Full banner ({n} bytes): {banner}"))
                } else {
                    None
                },
            });
            Some(banner)
        }
        Err(e) => {
            let status = if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut
            {
                // No banner within timeout — not necessarily an error.
                steps.push(DiagnosticStep {
                    name: step_name.into(),
                    status: "info".into(),
                    message: "No banner received within timeout (server waits for client to speak first)".into(),
                    duration_ms: t.elapsed().as_millis() as u64,
                    detail: None,
                });
                return None;
            } else {
                "fail"
            };
            steps.push(DiagnosticStep {
                name: step_name.into(),
                status: status.into(),
                message: format!("Banner read error: {e}"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            None
        }
    }
}

/// Build the final report from accumulated steps.
pub fn finish_report(
    host: &str,
    port: u16,
    protocol: &str,
    resolved_ip: Option<String>,
    steps: Vec<DiagnosticStep>,
    start: Instant,
) -> DiagnosticReport {
    let all_pass = steps.iter().all(|s| s.status == "pass" || s.status == "info");
    let first_fail = steps.iter().find(|s| s.status == "fail");
    let any_warn = steps.iter().any(|s| s.status == "warn");
    let root_cause = steps
        .iter()
        .filter(|s| s.name == "Root Cause Analysis")
        .last()
        .and_then(|s| s.detail.clone());

    let summary = if all_pass {
        "All diagnostic probes passed — the service is fully reachable and accepted the connection."
            .into()
    } else if let Some(fail) = first_fail {
        format!("Diagnostics stopped at: {} — {}", fail.name, fail.message)
    } else if any_warn {
        "Connection partially succeeded but warnings were reported.".into()
    } else {
        "Diagnostics completed with mixed results.".into()
    };

    DiagnosticReport {
        host: host.to_string(),
        port,
        protocol: protocol.to_string(),
        resolved_ip,
        steps,
        summary,
        root_cause_hint: root_cause,
        total_duration_ms: start.elapsed().as_millis() as u64,
    }
}

// ─── Parallel probe helpers ─────────────────────────────────────────────────

/// Probe multiple ports in parallel and return which are open/closed.
/// Useful for service-discovery diagnostics (e.g., "is 80/443/8080 open?").
pub fn probe_ports_parallel(
    host: &str,
    ports: &[u16],
    timeout: Duration,
    steps: &mut Vec<DiagnosticStep>,
) {
    if ports.is_empty() {
        return;
    }

    let t = Instant::now();
    let addr_str = format!("{host}:0");
    let base_addr = match addr_str.to_socket_addrs().ok().and_then(|mut a| a.next()) {
        Some(a) => a,
        None => {
            steps.push(DiagnosticStep {
                name: "Port Scan".into(),
                status: "fail".into(),
                message: format!("Cannot resolve {host} for port scanning"),
                duration_ms: t.elapsed().as_millis() as u64,
                detail: None,
            });
            return;
        }
    };

    let results: Vec<(u16, bool)> = std::thread::scope(|scope| {
        let handles: Vec<_> = ports
            .iter()
            .map(|&p| {
                let mut addr = base_addr;
                addr.set_port(p);
                scope.spawn(move || {
                    let open = TcpStream::connect_timeout(&addr, timeout).is_ok();
                    (p, open)
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect()
    });

    let open: Vec<u16> = results.iter().filter(|(_, o)| *o).map(|(p, _)| *p).collect();
    let closed: Vec<u16> = results.iter().filter(|(_, o)| !*o).map(|(p, _)| *p).collect();

    steps.push(DiagnosticStep {
        name: "Port Scan".into(),
        status: if open.is_empty() { "warn" } else { "info" }.into(),
        message: format!(
            "Scanned {} ports in {}ms. Open: {}. Closed/filtered: {}",
            ports.len(),
            t.elapsed().as_millis(),
            if open.is_empty() {
                "none".to_string()
            } else {
                open.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ")
            },
            if closed.is_empty() {
                "none".to_string()
            } else {
                closed.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ")
            },
        ),
        duration_ms: t.elapsed().as_millis() as u64,
        detail: None,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    // ── DiagnosticStep & DiagnosticReport serde ─────────────────────────

    #[test]
    fn diagnostic_step_serializes_camel_case() {
        let step = DiagnosticStep {
            name: "DNS Resolution".into(),
            status: "pass".into(),
            message: "ok".into(),
            duration_ms: 42,
            detail: None,
        };
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("\"durationMs\""));
        assert!(!json.contains("\"duration_ms\""));
    }

    #[test]
    fn diagnostic_step_roundtrip_with_detail() {
        let step = DiagnosticStep {
            name: "TCP Connect".into(),
            status: "fail".into(),
            message: "timeout".into(),
            duration_ms: 5000,
            detail: Some("firewall".into()),
        };
        let json = serde_json::to_string(&step).unwrap();
        let deserialized: DiagnosticStep = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "TCP Connect");
        assert_eq!(deserialized.detail.as_deref(), Some("firewall"));
    }

    #[test]
    fn diagnostic_step_roundtrip_without_detail() {
        let step = DiagnosticStep {
            name: "Banner".into(),
            status: "info".into(),
            message: "no banner".into(),
            duration_ms: 0,
            detail: None,
        };
        let json = serde_json::to_string(&step).unwrap();
        let deserialized: DiagnosticStep = serde_json::from_str(&json).unwrap();
        assert!(deserialized.detail.is_none());
    }

    #[test]
    fn diagnostic_report_roundtrip() {
        let report = DiagnosticReport {
            host: "example.com".into(),
            port: 22,
            protocol: "SSH".into(),
            resolved_ip: Some("93.184.216.34".into()),
            steps: vec![],
            summary: "all good".into(),
            root_cause_hint: None,
            total_duration_ms: 100,
        };
        let json = serde_json::to_string(&report).unwrap();
        let deserialized: DiagnosticReport = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.host, "example.com");
        assert_eq!(deserialized.port, 22);
        assert_eq!(deserialized.protocol, "SSH");
        assert!(json.contains("\"totalDurationMs\""));
        assert!(json.contains("\"rootCauseHint\""));
    }

    // ── probe_dns ───────────────────────────────────────────────────────

    #[test]
    fn probe_dns_resolves_localhost() {
        let mut steps = Vec::new();
        let (addr, ip, all) = probe_dns("localhost", 80, &mut steps);
        assert!(addr.is_some(), "localhost should resolve");
        assert!(ip.is_some());
        assert!(!all.is_empty());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].status, "pass");
    }

    #[test]
    fn probe_dns_fails_for_invalid_host() {
        let mut steps = Vec::new();
        let (addr, ip, all) = probe_dns("this.host.does.not.exist.invalid", 80, &mut steps);
        assert!(addr.is_none());
        assert!(ip.is_none());
        assert!(all.is_empty());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].status, "fail");
        assert!(steps[0].message.contains("DNS"));
    }

    #[test]
    fn probe_dns_appends_to_existing_steps() {
        let mut steps = vec![DiagnosticStep {
            name: "pre-existing".into(),
            status: "info".into(),
            message: "setup".into(),
            duration_ms: 0,
            detail: None,
        }];
        let _ = probe_dns("localhost", 80, &mut steps);
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].name, "pre-existing");
        assert_eq!(steps[1].name, "DNS Resolution");
    }

    // ── probe_tcp ───────────────────────────────────────────────────────

    #[test]
    fn probe_tcp_fails_on_closed_port() {
        // Port 1 is very unlikely to be open
        let addr: std::net::SocketAddr = "127.0.0.1:1".parse().unwrap();
        let mut steps = Vec::new();
        let stream = probe_tcp(addr, Duration::from_millis(200), true, &mut steps);
        assert!(stream.is_none());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].status, "fail");
    }

    #[test]
    fn probe_tcp_records_duration() {
        let addr: std::net::SocketAddr = "127.0.0.1:1".parse().unwrap();
        let mut steps = Vec::new();
        let _ = probe_tcp(addr, Duration::from_millis(100), false, &mut steps);
        // Duration should be > 0 but we mainly check it's set
        assert!(steps[0].duration_ms <= 5000); // sanity
    }

    // ── finish_report ───────────────────────────────────────────────────

    #[test]
    fn finish_report_all_pass() {
        let steps = vec![
            DiagnosticStep { name: "A".into(), status: "pass".into(), message: "ok".into(), duration_ms: 1, detail: None },
            DiagnosticStep { name: "B".into(), status: "info".into(), message: "ok".into(), duration_ms: 2, detail: None },
        ];
        let report = finish_report("host", 22, "SSH", Some("1.2.3.4".into()), steps, Instant::now());
        assert!(report.summary.contains("All diagnostic probes passed"));
        assert!(report.root_cause_hint.is_none());
        assert_eq!(report.host, "host");
        assert_eq!(report.port, 22);
        assert_eq!(report.protocol, "SSH");
        assert_eq!(report.resolved_ip.as_deref(), Some("1.2.3.4"));
    }

    #[test]
    fn finish_report_with_failure() {
        let steps = vec![
            DiagnosticStep { name: "DNS".into(), status: "pass".into(), message: "ok".into(), duration_ms: 1, detail: None },
            DiagnosticStep { name: "TCP".into(), status: "fail".into(), message: "refused".into(), duration_ms: 2, detail: None },
        ];
        let report = finish_report("host", 22, "SSH", None, steps, Instant::now());
        assert!(report.summary.contains("TCP"));
        assert!(report.summary.contains("refused"));
    }

    #[test]
    fn finish_report_with_warning_only() {
        let steps = vec![
            DiagnosticStep { name: "Banner".into(), status: "warn".into(), message: "no banner".into(), duration_ms: 1, detail: None },
        ];
        let report = finish_report("host", 80, "HTTP", None, steps, Instant::now());
        assert!(report.summary.contains("warnings"));
    }

    #[test]
    fn finish_report_extracts_root_cause() {
        let steps = vec![
            DiagnosticStep { name: "DNS".into(), status: "pass".into(), message: "ok".into(), duration_ms: 1, detail: None },
            DiagnosticStep { name: "Root Cause Analysis".into(), status: "info".into(), message: "hint".into(), duration_ms: 1, detail: Some("firewall is blocking".into()) },
        ];
        let report = finish_report("host", 22, "SSH", None, steps, Instant::now());
        assert_eq!(report.root_cause_hint.as_deref(), Some("firewall is blocking"));
    }

    #[test]
    fn finish_report_no_resolved_ip() {
        let steps = vec![];
        let report = finish_report("host", 22, "SSH", None, steps, Instant::now());
        assert!(report.resolved_ip.is_none());
    }

    #[test]
    fn finish_report_empty_steps() {
        let steps = vec![];
        let report = finish_report("host", 80, "HTTP", None, steps, Instant::now());
        assert!(report.summary.contains("All diagnostic probes passed"));
    }

    // ── probe_ports_parallel ────────────────────────────────────────────

    #[test]
    fn probe_ports_parallel_empty_list() {
        let mut steps = Vec::new();
        probe_ports_parallel("localhost", &[], Duration::from_millis(100), &mut steps);
        assert!(steps.is_empty(), "empty port list should produce no steps");
    }

    #[test]
    fn probe_ports_parallel_single_closed_port() {
        let mut steps = Vec::new();
        probe_ports_parallel("127.0.0.1", &[1], Duration::from_millis(200), &mut steps);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].name, "Port Scan");
        assert!(steps[0].message.contains("1 port"));
    }

    #[test]
    fn probe_ports_parallel_invalid_host() {
        let mut steps = Vec::new();
        probe_ports_parallel("this.host.does.not.exist.invalid", &[80, 443], Duration::from_millis(100), &mut steps);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].status, "fail");
        assert!(steps[0].message.contains("Cannot resolve"));
    }

    #[test]
    fn probe_ports_parallel_multiple_ports() {
        let mut steps = Vec::new();
        probe_ports_parallel("127.0.0.1", &[1, 2, 3], Duration::from_millis(200), &mut steps);
        assert_eq!(steps.len(), 1);
        assert!(steps[0].message.contains("3 ports"));
    }
}
