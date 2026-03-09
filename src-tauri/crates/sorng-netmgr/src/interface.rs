//! # interface — Network interface management
//!
//! Manages network interfaces via `ip link`, `ip addr`, `ifconfig`, and
//! platform-specific tools. Provides interface listing, up/down control,
//! MTU/MAC configuration, and interface statistics.

use crate::types::*;

/// Build `ip -j link show` arguments for JSON output.
pub fn build_list_interfaces_args() -> Vec<String> {
    vec!["-j".to_string(), "link".to_string(), "show".to_string()]
}

/// Build `ip link set <iface> up` arguments.
pub fn build_set_up_args(interface: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "set".to_string(),
        interface.to_string(),
        "up".to_string(),
    ]
}

/// Build `ip link set <iface> down` arguments.
pub fn build_set_down_args(interface: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "set".to_string(),
        interface.to_string(),
        "down".to_string(),
    ]
}

/// Build `ip link set <iface> mtu <mtu>` arguments.
pub fn build_set_mtu_args(interface: &str, mtu: u32) -> Vec<String> {
    vec![
        "link".to_string(),
        "set".to_string(),
        interface.to_string(),
        "mtu".to_string(),
        mtu.to_string(),
    ]
}

/// Build `ip -j addr show <iface>` arguments.
pub fn build_show_addrs_args(interface: &str) -> Vec<String> {
    vec![
        "-j".to_string(),
        "addr".to_string(),
        "show".to_string(),
        interface.to_string(),
    ]
}

/// Parse JSON `ip -j link show` output into `NetworkInterface` structs.
pub fn parse_interfaces_json(_json: &str) -> Vec<NetworkInterface> {
    // TODO: implement
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_up() {
        let args = build_set_up_args("eth0");
        assert!(args.contains(&"up".to_string()));
        assert!(args.contains(&"eth0".to_string()));
    }

    #[test]
    fn set_mtu() {
        let args = build_set_mtu_args("eth0", 9000);
        assert!(args.contains(&"9000".to_string()));
    }
}
