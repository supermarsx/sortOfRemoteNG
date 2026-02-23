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
