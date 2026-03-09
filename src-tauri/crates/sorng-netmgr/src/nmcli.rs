//! # nmcli — NetworkManager CLI wrapper
//!
//! Wraps the `nmcli` command-line tool for managing NetworkManager:
//! - Connection profiles (add, modify, delete, up, down)
//! - Device management (status, connect, disconnect, Wi-Fi scan)
//! - General status (hostname, connectivity, logging)
//! - Radio controls (wifi on/off, wwan on/off)

use crate::types::*;

/// Build `nmcli connection show` arguments.
pub fn build_connection_list_args(active_only: bool) -> Vec<String> {
    let mut args = vec![
        "--terse".to_string(),
        "--fields".to_string(),
        "all".to_string(),
        "connection".to_string(),
        "show".to_string(),
    ];
    if active_only {
        args.push("--active".to_string());
    }
    args
}

/// Build `nmcli device status` arguments.
pub fn build_device_status_args() -> Vec<String> {
    vec![
        "--terse".to_string(),
        "device".to_string(),
        "status".to_string(),
    ]
}

/// Build `nmcli device wifi list` arguments.
pub fn build_wifi_scan_args(interface: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "--terse".to_string(),
        "--fields".to_string(),
        "all".to_string(),
        "device".to_string(),
        "wifi".to_string(),
        "list".to_string(),
    ];
    if let Some(iface) = interface {
        args.push("ifname".to_string());
        args.push(iface.to_string());
    }
    args
}

/// Build arguments to activate a connection.
pub fn build_connection_up_args(name_or_uuid: &str, interface: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "connection".to_string(),
        "up".to_string(),
        name_or_uuid.to_string(),
    ];
    if let Some(iface) = interface {
        args.push("ifname".to_string());
        args.push(iface.to_string());
    }
    args
}

/// Build arguments to deactivate a connection.
pub fn build_connection_down_args(name_or_uuid: &str) -> Vec<String> {
    vec![
        "connection".to_string(),
        "down".to_string(),
        name_or_uuid.to_string(),
    ]
}

/// Build arguments to delete a connection.
pub fn build_connection_delete_args(name_or_uuid: &str) -> Vec<String> {
    vec![
        "connection".to_string(),
        "delete".to_string(),
        name_or_uuid.to_string(),
    ]
}

/// Build `nmcli general status` arguments.
pub fn build_general_status_args() -> Vec<String> {
    vec![
        "--terse".to_string(),
        "general".to_string(),
        "status".to_string(),
    ]
}

/// Parse a terse nmcli connection line into an `NmConnection`.
pub fn parse_connection_line(_line: &str) -> Option<NmConnection> {
    // TODO: implement terse field parsing
    None
}

/// Parse a terse nmcli device line into an `NmDevice`.
pub fn parse_device_line(_line: &str) -> Option<NmDevice> {
    // TODO: implement terse field parsing
    None
}

/// Parse Wi-Fi access point fields from a terse nmcli line.
pub fn parse_wifi_ap_line(_line: &str) -> Option<WifiAccessPoint> {
    // TODO: implement terse field parsing
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_list_args_all() {
        let args = build_connection_list_args(false);
        assert!(!args.contains(&"--active".to_string()));
        assert!(args.contains(&"connection".to_string()));
    }

    #[test]
    fn connection_list_args_active() {
        let args = build_connection_list_args(true);
        assert!(args.contains(&"--active".to_string()));
    }

    #[test]
    fn wifi_scan_args_no_iface() {
        let args = build_wifi_scan_args(None);
        assert!(!args.contains(&"ifname".to_string()));
    }

    #[test]
    fn wifi_scan_args_with_iface() {
        let args = build_wifi_scan_args(Some("wlan0"));
        assert!(args.contains(&"ifname".to_string()));
        assert!(args.contains(&"wlan0".to_string()));
    }

    #[test]
    fn connection_up_args() {
        let args = build_connection_up_args("my-wifi", Some("wlan0"));
        assert!(args.contains(&"up".to_string()));
        assert!(args.contains(&"my-wifi".to_string()));
    }
}
