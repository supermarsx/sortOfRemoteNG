//! # arp — ARP cache management
//!
//! Manages the ARP cache via `arp`, `ip neigh`, and provides
//! ARP scanning capabilities.

use crate::types::*;

/// Build `ip -j neigh show` arguments.
pub fn build_ip_neigh_args() -> Vec<String> {
    vec!["-j".to_string(), "neigh".to_string(), "show".to_string()]
}

/// Build `arp -a` arguments.
pub fn build_arp_show_args() -> Vec<String> {
    vec!["-a".to_string()]
}

/// Build `ip neigh flush all` arguments.
pub fn build_flush_args() -> Vec<String> {
    vec!["neigh".to_string(), "flush".to_string(), "all".to_string()]
}

/// Build `arping` arguments for ARP-level probing.
pub fn build_arping_args(target: &str, interface: &str, count: u32) -> Vec<String> {
    vec![
        "-c".to_string(),
        count.to_string(),
        "-I".to_string(),
        interface.to_string(),
        target.to_string(),
    ]
}

/// Parse `ip -j neigh show` JSON output into `ArpEntry` structs.
pub fn parse_neigh_json(_json: &str) -> Vec<ArpEntry> {
    // TODO: implement
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neigh_args() {
        let args = build_ip_neigh_args();
        assert!(args.contains(&"-j".to_string()));
        assert!(args.contains(&"neigh".to_string()));
    }

    #[test]
    fn arping_args() {
        let args = build_arping_args("192.168.1.1", "eth0", 3);
        assert!(args.contains(&"eth0".to_string()));
        assert!(args.contains(&"3".to_string()));
    }
}
