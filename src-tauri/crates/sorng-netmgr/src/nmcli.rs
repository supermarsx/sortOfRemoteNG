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
///
/// Terse nmcli `connection show --fields all` outputs colon-delimited fields.
/// Minimal expected fields: NAME:UUID:TYPE:DEVICE
pub fn parse_connection_line(line: &str) -> Option<NmConnection> {
    let fields: Vec<&str> = line.split(':').collect();
    if fields.len() < 4 {
        return None;
    }
    let name = fields[0].to_string();
    let uuid = fields[1].to_string();
    let conn_type = parse_nm_conn_type(fields[2]);
    let device_str = fields[3].trim();
    let device = if device_str.is_empty() || device_str == "--" {
        None
    } else {
        Some(device_str.to_string())
    };
    let active = device.is_some();

    Some(NmConnection {
        uuid,
        name,
        conn_type,
        device,
        active,
        autoconnect: true,
        ipv4_method: None,
        ipv4_addresses: Vec::new(),
        ipv4_gateway: None,
        ipv4_dns: Vec::new(),
        ipv6_method: None,
        ipv6_addresses: Vec::new(),
        ipv6_gateway: None,
        ipv6_dns: Vec::new(),
        zone: None,
        timestamp: None,
        read_only: false,
        filename: None,
    })
}

fn parse_nm_conn_type(s: &str) -> NmConnectionType {
    match s.trim() {
        "802-3-ethernet" | "ethernet" => NmConnectionType::Ethernet,
        "802-11-wireless" | "wifi" => NmConnectionType::Wifi,
        "wifi-p2p" => NmConnectionType::WifiP2p,
        "bond" => NmConnectionType::Bond,
        "bridge" => NmConnectionType::Bridge,
        "vlan" => NmConnectionType::Vlan,
        "team" => NmConnectionType::Team,
        "vpn" => NmConnectionType::Vpn,
        "wireguard" => NmConnectionType::Wireguard,
        "ip-tunnel" => NmConnectionType::IpTunnel,
        "infiniband" => NmConnectionType::Infiniband,
        "bluetooth" => NmConnectionType::Bluetooth,
        "gsm" | "cdma" => NmConnectionType::GsmCdma,
        "loopback" => NmConnectionType::Loopback,
        "pppoe" => NmConnectionType::Pppoe,
        "tun" => NmConnectionType::Tun,
        "dummy" => NmConnectionType::Dummy,
        _ => NmConnectionType::Unknown,
    }
}

/// Parse a terse nmcli device line into an `NmDevice`.
///
/// Terse `nmcli device status` fields: DEVICE:TYPE:STATE:CONNECTION
pub fn parse_device_line(line: &str) -> Option<NmDevice> {
    let fields: Vec<&str> = line.split(':').collect();
    if fields.len() < 3 {
        return None;
    }
    let device = fields[0].to_string();
    let device_type = fields[1].to_string();
    let state = parse_nm_device_state(fields[2]);
    let connection = fields.get(3).and_then(|s| {
        let s = s.trim();
        if s.is_empty() || s == "--" {
            None
        } else {
            Some(s.to_string())
        }
    });

    Some(NmDevice {
        device,
        device_type,
        state,
        connection,
        ip4_address: None,
        ip6_address: None,
        hw_address: None,
        mtu: None,
        driver: None,
        autoconnect: true,
    })
}

fn parse_nm_device_state(s: &str) -> NmDeviceState {
    match s.trim().to_lowercase().as_str() {
        "connected" | "activated" => NmDeviceState::Activated,
        "disconnected" => NmDeviceState::Disconnected,
        "unmanaged" => NmDeviceState::Unmanaged,
        "unavailable" => NmDeviceState::Unavailable,
        "connecting (prepare)" | "prepare" => NmDeviceState::Prepare,
        "connecting (configuring)" | "config" => NmDeviceState::Config,
        "connecting (need authentication)" | "need-auth" => NmDeviceState::NeedAuth,
        "connecting (getting ip configuration)" | "ip-config" => NmDeviceState::IpConfig,
        "connecting (checking ip connectivity)" | "ip-check" => NmDeviceState::IpCheck,
        "connecting (starting secondary connections)" | "secondaries" => NmDeviceState::Secondaries,
        "deactivating" => NmDeviceState::Deactivating,
        "failed" => NmDeviceState::Failed,
        _ => NmDeviceState::Unknown,
    }
}

/// Parse Wi-Fi access point fields from a terse nmcli line.
///
/// Terse `nmcli --terse --fields all device wifi list` has colon-delimited fields.
/// Typical order: IN-USE:BSSID:SSID:MODE:CHAN:FREQ:RATE:SIGNAL:BARS:SECURITY
pub fn parse_wifi_ap_line(line: &str) -> Option<WifiAccessPoint> {
    let fields: Vec<&str> = line.split(':').collect();
    // Need at least: IN-USE, BSSID (6 octets via 5 extra colons), SSID, MODE, CHAN, FREQ, RATE, SIGNAL, BARS, SECURITY
    // BSSIDs contain colons so we handle this by expecting >= 15 fields
    if fields.len() < 15 {
        // Try simpler format without BSSID colons (pre-escaped)
        if fields.len() >= 10 {
            return parse_wifi_ap_simple(fields);
        }
        return None;
    }

    // First field is in-use marker (* or empty)
    let connected = fields[0].trim() == "*";
    // BSSID is fields[1..7] joined with :
    let bssid = fields[1..7].join(":");
    // Remaining fields start at index 7
    let ssid = fields[7].to_string();
    let mode = parse_wifi_mode(fields[8]);
    let channel = fields[9].trim().parse().unwrap_or(0);
    let freq = fields[10].trim().replace(" MHz", "").parse().unwrap_or(0);
    let rate = fields[11].trim().replace(" Mbit/s", "").parse::<u32>().ok();
    let signal = fields[12].trim().parse().unwrap_or(0);
    // fields[13] = BARS (visual)
    let security = parse_wifi_security_str(fields.get(14).unwrap_or(&""));

    Some(WifiAccessPoint {
        ssid,
        bssid,
        mode,
        channel,
        frequency: freq,
        signal_strength: signal,
        security,
        connected,
        rate_mbps: rate,
        seen_at: chrono::Utc::now(),
    })
}

fn parse_wifi_ap_simple(fields: Vec<&str>) -> Option<WifiAccessPoint> {
    let connected = fields[0].trim() == "*";
    let bssid = fields[1].to_string();
    let ssid = fields[2].to_string();
    let mode = parse_wifi_mode(fields[3]);
    let channel = fields[4].trim().parse().unwrap_or(0);
    let freq = fields[5].trim().replace(" MHz", "").parse().unwrap_or(0);
    let rate = fields[6].trim().replace(" Mbit/s", "").parse::<u32>().ok();
    let signal = fields[7].trim().parse().unwrap_or(0);
    let security = parse_wifi_security_str(fields.get(9).unwrap_or(&""));

    Some(WifiAccessPoint {
        ssid,
        bssid,
        mode,
        channel,
        frequency: freq,
        signal_strength: signal,
        security,
        connected,
        rate_mbps: rate,
        seen_at: chrono::Utc::now(),
    })
}

fn parse_wifi_mode(s: &str) -> WifiMode {
    match s.trim().to_lowercase().as_str() {
        "infra" | "infrastructure" => WifiMode::Infrastructure,
        "ad-hoc" | "adhoc" | "ibss" => WifiMode::AdHoc,
        "ap" => WifiMode::Ap,
        "mesh" => WifiMode::Mesh,
        _ => WifiMode::Unknown,
    }
}

fn parse_wifi_security_str(s: &str) -> Vec<WifiSecurity> {
    let s = s.trim();
    if s.is_empty() || s == "--" {
        return vec![WifiSecurity::Open];
    }
    let mut result = Vec::new();
    let upper = s.to_uppercase();
    if upper.contains("WPA3") && upper.contains("SAE") {
        result.push(WifiSecurity::Wpa3Sae);
    }
    if upper.contains("WPA2") && upper.contains("ENTERPRISE") {
        result.push(WifiSecurity::Wpa2Enterprise);
    } else if upper.contains("WPA2") {
        result.push(WifiSecurity::Wpa2Psk);
    }
    if upper.contains("WPA1")
        || (upper.contains("WPA") && !upper.contains("WPA2") && !upper.contains("WPA3"))
    {
        result.push(WifiSecurity::WpaPsk);
    }
    if upper.contains("WEP") {
        result.push(WifiSecurity::Wep);
    }
    if upper.contains("OWE") {
        result.push(WifiSecurity::Owe);
    }
    if result.is_empty() {
        result.push(WifiSecurity::Open);
    }
    result
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
