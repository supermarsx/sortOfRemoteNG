//! # diagnostics — Cross-utility health checks and reporting
//!
//! Provides unified health evaluation for all network utilities,
//! tool availability detection, and diagnostic report generation.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// List of common network utility binaries to check availability for.
pub const KNOWN_TOOLS: &[&str] = &[
    "ping",
    "traceroute",
    "mtr",
    "nmap",
    "ss",
    "netstat",
    "arp",
    "dig",
    "whois",
    "ethtool",
    "tcpdump",
    "iperf3",
    "speedtest",
    "ip",
    "curl",
    "nc",
    "lsof",
    "nload",
    "iftop",
    "arping",
];

/// Evaluate overall health of the network utilities subsystem.
pub fn evaluate_health(
    tools_available: HashMap<String, bool>,
    ping_ok: bool,
    dns_ok: bool,
    gateway_reachable: bool,
    internet_reachable: bool,
) -> NetUtilsHealthCheck {
    let mut warnings = Vec::new();
    let available_count = tools_available.values().filter(|v| **v).count();
    let total = tools_available.len();
    if available_count < total / 2 {
        warnings.push(format!(
            "Only {}/{} tools available",
            available_count, total
        ));
    }
    if !ping_ok {
        warnings.push("ping is not functioning".to_string());
    }
    if !dns_ok {
        warnings.push("DNS resolution is not working".to_string());
    }
    NetUtilsHealthCheck {
        tools_available,
        ping_ok,
        dns_ok,
        default_gateway_reachable: gateway_reachable,
        internet_reachable,
        warnings,
        checked_at: Utc::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_nominal() {
        let mut tools = HashMap::new();
        tools.insert("ping".to_string(), true);
        tools.insert("traceroute".to_string(), true);
        let h = evaluate_health(tools, true, true, true, true);
        assert!(h.ping_ok);
        assert!(h.dns_ok);
        assert!(h.warnings.is_empty());
    }

    #[test]
    fn health_no_tools() {
        let tools = HashMap::new();
        let h = evaluate_health(tools, false, false, false, false);
        assert!(!h.ping_ok);
    }

    #[test]
    fn known_tools_not_empty() {
        assert!(!KNOWN_TOOLS.is_empty());
        assert!(KNOWN_TOOLS.contains(&"ping"));
    }
}
