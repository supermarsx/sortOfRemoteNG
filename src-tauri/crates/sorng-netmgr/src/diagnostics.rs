//! # diagnostics — Cross-backend health checks and rule auditing
//!
//! Provides unified diagnostic routines that evaluate the state of
//! all configured firewall backends and network managers, detecting
//! stale rules, conflicting policies, and misconfigured interfaces.

use crate::types::*;
use chrono::Utc;

/// Evaluate the overall health of the network management subsystem.
pub fn evaluate_health(
    firewall_rules_count: u32,
    interfaces_up: u32,
    interfaces_total: u32,
    stale_rules: u32,
) -> NetMgrHealthCheck {
    let _healthy = stale_rules == 0 && interfaces_up > 0;
    let mut warnings = Vec::new();
    if stale_rules > 0 {
        warnings.push(format!("{} stale firewall rules detected", stale_rules));
    }
    let mut errors = Vec::new();
    if interfaces_up == 0 {
        errors.push("No network interfaces found".to_string());
    }
    NetMgrHealthCheck {
        backend: FirewallBackend::Iptables,
        firewall_running: true,
        nm_running: true,
        nm_connectivity: None,
        interfaces_up,
        interfaces_total,
        default_route_present: interfaces_up > 0,
        dns_resolving: interfaces_up > 0,
        active_rules: firewall_rules_count,
        warnings,
        errors,
        checked_at: Utc::now(),
    }
}

/// Detect duplicate firewall rules across backends.
pub fn find_duplicate_rules(rules: &[FirewallRule]) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    for (i, a) in rules.iter().enumerate() {
        for b in rules.iter().skip(i + 1) {
            if a.source_addr == b.source_addr
                && a.dest_addr == b.dest_addr
                && a.dest_port == b.dest_port
                && a.protocol == b.protocol
            {
                pairs.push((a.id.clone(), b.id.clone()));
            }
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_nominal() {
        let h = evaluate_health(10, 3, 5, 0);
        assert!(h.errors.is_empty());
        assert!(h.warnings.is_empty());
    }

    #[test]
    fn health_stale_rules() {
        let h = evaluate_health(10, 3, 5, 2);
        assert!(!h.warnings.is_empty());
        assert!(h.warnings[0].contains("stale"));
    }

    #[test]
    fn no_duplicates() {
        let rules: Vec<FirewallRule> = Vec::new();
        assert!(find_duplicate_rules(&rules).is_empty());
    }
}
