//! # diagnostics — Cross-utility health checks and reporting
//!
//! Provides unified health evaluation for all network utilities,
//! tool availability detection, and diagnostic report generation.

use crate::types::*;
use chrono::Utc;

/// List of common network utility binaries to check availability for.
pub const KNOWN_TOOLS: &[&str] = &[
    "ping", "traceroute", "mtr", "nmap", "ss", "netstat", "arp",
    "dig", "whois", "ethtool", "tcpdump", "iperf3", "speedtest",
    "ip", "curl", "nc", "lsof", "nload", "iftop", "arping",
];

/// Evaluate overall health of the network utilities subsystem.
pub fn evaluate_health(
    available_tools: usize,
    total_tools: usize,
    recent_errors: usize,
) -> NetUtilsHealthCheck {
    let healthy = available_tools > 0 && recent_errors == 0;
    NetUtilsHealthCheck {
        healthy,
        tools_available: available_tools,
        tools_total: total_tools,
        message: if healthy {
            format!("{}/{} tools available", available_tools, total_tools)
        } else if available_tools == 0 {
            "No network utilities found on system".to_string()
        } else {
            format!("{} recent errors detected", recent_errors)
        },
        checked_at: Utc::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_nominal() {
        let h = evaluate_health(15, 20, 0);
        assert!(h.healthy);
        assert!(h.message.contains("15/20"));
    }

    #[test]
    fn health_no_tools() {
        let h = evaluate_health(0, 20, 0);
        assert!(!h.healthy);
    }

    #[test]
    fn known_tools_not_empty() {
        assert!(!KNOWN_TOOLS.is_empty());
        assert!(KNOWN_TOOLS.contains(&"ping"));
    }
}
