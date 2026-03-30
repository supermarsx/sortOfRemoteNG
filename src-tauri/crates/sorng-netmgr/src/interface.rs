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
pub fn parse_interfaces_json(json: &str) -> Vec<NetworkInterface> {
    let arr: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    arr.into_iter()
        .filter_map(|obj| {
            let name = obj.get("ifname")?.as_str()?.to_string();
            let flags: Vec<String> = obj
                .get("flags")
                .and_then(|f| f.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            let oper_state = obj
                .get("operstate")
                .and_then(|s| s.as_str())
                .unwrap_or("UNKNOWN");
            let state = match oper_state.to_uppercase().as_str() {
                "UP" => InterfaceState::Up,
                "DOWN" => InterfaceState::Down,
                "LOWERLAYERDOWN" => InterfaceState::LowerLayerDown,
                "DORMANT" => InterfaceState::Dormant,
                "NOTPRESENT" => InterfaceState::NotPresent,
                _ => InterfaceState::Unknown,
            };

            let link_type = obj.get("link_type").and_then(|s| s.as_str()).unwrap_or("");
            let iface_type = match link_type {
                "ether" => InterfaceType::Ethernet,
                "loopback" => InterfaceType::Loopback,
                "bridge" => InterfaceType::Bridge,
                "bond" => InterfaceType::Bond,
                "vlan" => InterfaceType::Vlan,
                "tun" => InterfaceType::Tun,
                "tap" => InterfaceType::Tap,
                "veth" => InterfaceType::Veth,
                "dummy" => InterfaceType::Dummy,
                _ => InterfaceType::Other,
            };

            let mac = obj
                .get("address")
                .and_then(|s| s.as_str())
                .map(String::from);
            let mtu = obj.get("mtu").and_then(|v| v.as_u64()).unwrap_or(1500) as u32;

            let stats = obj.get("stats64").or_else(|| obj.get("stats"));
            let tx_bytes = stats
                .and_then(|s| s.get("tx"))
                .and_then(|t| t.get("bytes"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let rx_bytes = stats
                .and_then(|s| s.get("rx"))
                .and_then(|t| t.get("bytes"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let tx_packets = stats
                .and_then(|s| s.get("tx"))
                .and_then(|t| t.get("packets"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let rx_packets = stats
                .and_then(|s| s.get("rx"))
                .and_then(|t| t.get("packets"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let tx_errors = stats
                .and_then(|s| s.get("tx"))
                .and_then(|t| t.get("errors"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let rx_errors = stats
                .and_then(|s| s.get("rx"))
                .and_then(|t| t.get("errors"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let tx_dropped = stats
                .and_then(|s| s.get("tx"))
                .and_then(|t| t.get("dropped"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let rx_dropped = stats
                .and_then(|s| s.get("rx"))
                .and_then(|t| t.get("dropped"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            Some(NetworkInterface {
                name,
                iface_type,
                state,
                mac_address: mac,
                mtu,
                speed_mbps: None,
                duplex: None,
                ipv4_addresses: Vec::new(),
                ipv6_addresses: Vec::new(),
                flags,
                tx_bytes,
                rx_bytes,
                tx_packets,
                rx_packets,
                tx_errors,
                rx_errors,
                tx_dropped,
                rx_dropped,
                driver: None,
                firmware_version: None,
                pci_bus: None,
            })
        })
        .collect()
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
