//! # wifi — Wi-Fi management
//!
//! Manages Wi-Fi connections via nmcli, wpa_supplicant, and iwconfig.
//! Provides scanning, connecting, disconnecting, hotspot creation,
//! and signal monitoring.

use crate::types::*;

/// Build `nmcli device wifi list` arguments.
pub fn build_wifi_list_args(interface: Option<&str>) -> Vec<String> {
    let mut args = vec!["--terse".to_string(), "--fields".to_string(), "all".to_string(), "device".to_string(), "wifi".to_string(), "list".to_string()];
    if let Some(iface) = interface {
        args.push("ifname".to_string());
        args.push(iface.to_string());
    }
    args
}

/// Build `nmcli device wifi connect` arguments.
pub fn build_wifi_connect_args(ssid: &str, password: Option<&str>, interface: Option<&str>) -> Vec<String> {
    let mut args = vec!["device".to_string(), "wifi".to_string(), "connect".to_string(), ssid.to_string()];
    if let Some(pw) = password {
        args.push("password".to_string());
        args.push(pw.to_string());
    }
    if let Some(iface) = interface {
        args.push("ifname".to_string());
        args.push(iface.to_string());
    }
    args
}

/// Build `nmcli device wifi hotspot` arguments.
pub fn build_hotspot_args(ssid: &str, password: &str, interface: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "device".to_string(), "wifi".to_string(), "hotspot".to_string(),
        "ssid".to_string(), ssid.to_string(),
        "password".to_string(), password.to_string(),
    ];
    if let Some(iface) = interface {
        args.push("ifname".to_string());
        args.push(iface.to_string());
    }
    args
}

/// Parse Wi-Fi scan results into `WifiAccessPoint` entries.
pub fn parse_wifi_scan(_output: &str) -> Vec<WifiAccessPoint> {
    // TODO: implement
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wifi_list() {
        let args = build_wifi_list_args(None);
        assert!(args.contains(&"wifi".to_string()));
    }

    #[test]
    fn wifi_connect() {
        let args = build_wifi_connect_args("MySSID", Some("secret"), None);
        assert!(args.contains(&"MySSID".to_string()));
        assert!(args.contains(&"password".to_string()));
    }

    #[test]
    fn hotspot() {
        let args = build_hotspot_args("TestAP", "pw123", Some("wlan0"));
        assert!(args.contains(&"hotspot".to_string()));
        assert!(args.contains(&"wlan0".to_string()));
    }
}
