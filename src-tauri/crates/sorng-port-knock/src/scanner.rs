use crate::types::{KnockProtocol, KnockVerification, PortScanResult, PortState};
use chrono::Utc;

/// Port scanning and knock verification utilities.
///
/// Builds shell commands for remote execution and parses their results.
pub struct KnockScanner;

impl Default for KnockScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl KnockScanner {
    pub fn new() -> Self {
        Self
    }

    /// Builds a bash command to check if a port is open.
    pub fn check_port_command(
        host: &str,
        port: u16,
        protocol: KnockProtocol,
        timeout_ms: u64,
    ) -> String {
        let timeout_sec = std::cmp::max(1, timeout_ms / 1000);
        match protocol {
            KnockProtocol::Tcp => {
                format!(
                    "timeout {} bash -c 'echo > /dev/tcp/{}/{}' 2>/dev/null && echo OPEN || echo CLOSED",
                    timeout_sec, host, port
                )
            }
            KnockProtocol::Udp => {
                format!(
                    "nc -zu -w {} {} {} 2>/dev/null && echo OPEN || echo CLOSED",
                    timeout_sec, host, port
                )
            }
        }
    }

    /// Interprets command output from a port check.
    pub fn parse_port_check_result(output: &str, exit_code: i32) -> PortState {
        let trimmed = output.trim();
        if exit_code == 0 && trimmed.contains("OPEN") {
            PortState::Open
        } else if trimmed.contains("CLOSED") {
            PortState::Closed
        } else if exit_code == 124 {
            // timeout exit code
            PortState::Filtered
        } else {
            PortState::Unknown
        }
    }

    /// Builds a command to grab a service banner.
    pub fn banner_grab_command(host: &str, port: u16, timeout_ms: u64) -> String {
        let timeout_sec = std::cmp::max(1, timeout_ms / 1000);
        format!(
            "echo '' | nc -w {} {} {} 2>/dev/null",
            timeout_sec, host, port
        )
    }

    /// Extracts a banner string from command output.
    pub fn parse_banner(output: &str) -> Option<String> {
        let trimmed = output.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    /// Returns an ordered list of commands: pre-check, knock placeholder, post-check.
    pub fn build_verification_plan(
        host: &str,
        port: u16,
        protocol: KnockProtocol,
        timeout_ms: u64,
    ) -> Vec<String> {
        vec![
            // Step 0: pre-knock port check
            Self::check_port_command(host, port, protocol, timeout_ms),
            // Step 1: placeholder — caller inserts the actual knock command
            format!("echo 'KNOCK_PLACEHOLDER for {}:{}'", host, port),
            // Step 2: post-knock port check
            Self::check_port_command(host, port, protocol, timeout_ms),
        ]
    }

    /// Creates a `PortScanResult` from collected data.
    pub fn create_port_scan_result(
        host: &str,
        port: u16,
        protocol: KnockProtocol,
        state: PortState,
        banner: Option<String>,
        elapsed_ms: u64,
    ) -> PortScanResult {
        PortScanResult {
            host: host.to_string(),
            port,
            protocol,
            state,
            banner,
            elapsed_ms,
            timestamp: Utc::now(),
        }
    }

    /// Creates a `KnockVerification` comparing before/after port state.
    pub fn create_verification_result(
        host: &str,
        port: u16,
        before: PortState,
        after: PortState,
        banner: Option<String>,
        elapsed_ms: u64,
    ) -> KnockVerification {
        KnockVerification {
            host: host.to_string(),
            port,
            before_knock: before,
            after_knock: after,
            port_opened: before != PortState::Open && after == PortState::Open,
            banner,
            elapsed_ms,
            timestamp: Utc::now(),
        }
    }

    /// Builds a command that checks multiple ports in one invocation.
    pub fn multi_port_check_command(
        host: &str,
        ports: &[u16],
        protocol: KnockProtocol,
        timeout_ms: u64,
    ) -> String {
        let timeout_sec = std::cmp::max(1, timeout_ms / 1000);
        let checks: Vec<String> = ports
            .iter()
            .map(|p| match protocol {
                KnockProtocol::Tcp => format!(
                    "(timeout {} bash -c 'echo > /dev/tcp/{}/{}' 2>/dev/null && echo '{}:OPEN' || echo '{}:CLOSED')",
                    timeout_sec, host, p, p, p
                ),
                KnockProtocol::Udp => format!(
                    "(nc -zu -w {} {} {} 2>/dev/null && echo '{}:OPEN' || echo '{}:CLOSED')",
                    timeout_sec, host, p, p, p
                ),
            })
            .collect();
        checks.join("; ")
    }

    /// Parses multi-port check output into per-port states.
    pub fn parse_multi_port_result(output: &str, ports: &[u16]) -> Vec<(u16, PortState)> {
        let mut results = Vec::new();
        for port in ports {
            let open_tag = format!("{}:OPEN", port);
            let closed_tag = format!("{}:CLOSED", port);
            if output.contains(&open_tag) {
                results.push((*port, PortState::Open));
            } else if output.contains(&closed_tag) {
                results.push((*port, PortState::Closed));
            } else {
                results.push((*port, PortState::Unknown));
            }
        }
        results
    }

    /// Builds an explicit TCP connect test command.
    pub fn tcp_connect_test_command(host: &str, port: u16, timeout_seconds: u32) -> String {
        format!(
            "timeout {} bash -c 'cat < /dev/null > /dev/tcp/{}/{}' 2>/dev/null; echo \"EXIT:$?\"",
            timeout_seconds, host, port
        )
    }

    /// Builds an nmap scan command for the given ports.
    pub fn nmap_scan_command(host: &str, ports: &[u16], fast: bool) -> String {
        let port_list: String = ports
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(",");
        if fast {
            format!("nmap -T4 -p {} {}", port_list, host)
        } else {
            format!("nmap -sV -p {} {}", port_list, host)
        }
    }

    /// Builds a ping command the measure round-trip time.
    pub fn measure_rtt_command(host: &str, count: u32) -> String {
        format!("ping -c {} {}", count, host)
    }
}
