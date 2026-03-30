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
pub fn parse_neigh_json(json: &str) -> Vec<ArpEntry> {
    let entries: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    entries
        .iter()
        .filter_map(|entry| {
            let ip = entry.get("dst")?.as_str()?.to_string();
            let mac = entry
                .get("lladdr")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let interface = entry
                .get("dev")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let state = entry
                .get("state")
                .and_then(|v| {
                    // state can be an array of strings or a single string
                    if let Some(arr) = v.as_array() {
                        arr.first().and_then(|s| s.as_str())
                    } else {
                        v.as_str()
                    }
                })
                .map(|s| match s.to_uppercase().as_str() {
                    "REACHABLE" => ArpState::Reachable,
                    "STALE" => ArpState::Stale,
                    "DELAY" => ArpState::Delay,
                    "PROBE" => ArpState::Probe,
                    "FAILED" => ArpState::Failed,
                    "NOARP" => ArpState::Noarp,
                    "INCOMPLETE" => ArpState::Incomplete,
                    "PERMANENT" => ArpState::Permanent,
                    _ => ArpState::Stale,
                })
                .unwrap_or(ArpState::Stale);

            Some(ArpEntry {
                ip,
                mac,
                interface,
                state,
                hw_type: None,
                flags: None,
            })
        })
        .collect()
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
