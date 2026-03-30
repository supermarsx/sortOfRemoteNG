//! # ethtool — NIC diagnostics wrapper
//!
//! Wraps `ethtool` for querying NIC capabilities, driver info,
//! offload settings, ring buffer sizes, and interface statistics.

use crate::types::*;
use std::collections::HashMap;

/// Build `ethtool <iface>` (general info) arguments.
pub fn build_info_args(interface: &str) -> Vec<String> {
    vec![interface.to_string()]
}

/// Build `ethtool -i <iface>` (driver info) arguments.
pub fn build_driver_info_args(interface: &str) -> Vec<String> {
    vec!["-i".to_string(), interface.to_string()]
}

/// Build `ethtool -k <iface>` (offload settings) arguments.
pub fn build_offload_args(interface: &str) -> Vec<String> {
    vec!["-k".to_string(), interface.to_string()]
}

/// Build `ethtool -g <iface>` (ring buffer) arguments.
pub fn build_ring_args(interface: &str) -> Vec<String> {
    vec!["-g".to_string(), interface.to_string()]
}

/// Build `ethtool -S <iface>` (statistics) arguments.
pub fn build_stats_args(interface: &str) -> Vec<String> {
    vec!["-S".to_string(), interface.to_string()]
}

/// Parse ethtool general output into `EthtoolInfo`.
pub fn parse_ethtool_output(output: &str) -> Option<EthtoolInfo> {
    let lines: Vec<&str> = output.lines().collect();
    if lines.is_empty() {
        return None;
    }

    // Extract interface from "Settings for <iface>:"
    let first_line = lines[0].trim();
    let interface = if let Some(rest) = first_line.strip_prefix("Settings for ") {
        rest.trim_end_matches(':').to_string()
    } else {
        return None;
    };

    let mut info = EthtoolInfo {
        interface,
        driver: None,
        driver_version: None,
        firmware_version: None,
        bus_info: None,
        speed_mbps: None,
        duplex: None,
        auto_negotiation: None,
        link_detected: false,
        supported_link_modes: Vec::new(),
        advertised_link_modes: Vec::new(),
        wake_on_lan: None,
        offloads: EthtoolOffloads {
            rx_checksumming: None,
            tx_checksumming: None,
            scatter_gather: None,
            tcp_segmentation_offload: None,
            generic_segmentation_offload: None,
            generic_receive_offload: None,
            large_receive_offload: None,
            rx_vlan_offload: None,
            tx_vlan_offload: None,
        },
        ring_params: None,
        statistics: HashMap::new(),
    };

    let mut i = 1;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim();
            let val = val.trim();

            match key {
                "Speed" => {
                    if let Some(num_str) = val.strip_suffix("Mb/s") {
                        info.speed_mbps = num_str.parse().ok();
                    } else if let Some(num_str) = val.strip_suffix("Gb/s") {
                        info.speed_mbps = num_str.parse::<u32>().ok().map(|g| g * 1000);
                    }
                }
                "Duplex" => {
                    info.duplex = Some(val.to_string());
                }
                "Auto-negotiation" => {
                    info.auto_negotiation = Some(val == "on");
                }
                "Link detected" => {
                    info.link_detected = val == "yes";
                }
                "Wake-on" => {
                    info.wake_on_lan = Some(val.to_string());
                }
                "Supported link modes" => {
                    info.supported_link_modes
                        .extend(val.split_whitespace().map(|s| s.to_string()));
                    // Collect continuation lines (indented, no ':')
                    while i + 1 < lines.len() {
                        let next_trimmed = lines[i + 1].trim();
                        if !next_trimmed.is_empty() && !next_trimmed.contains(':') {
                            info.supported_link_modes
                                .extend(next_trimmed.split_whitespace().map(|s| s.to_string()));
                            i += 1;
                        } else {
                            break;
                        }
                    }
                }
                "Advertised link modes" => {
                    info.advertised_link_modes
                        .extend(val.split_whitespace().map(|s| s.to_string()));
                    while i + 1 < lines.len() {
                        let next_trimmed = lines[i + 1].trim();
                        if !next_trimmed.is_empty() && !next_trimmed.contains(':') {
                            info.advertised_link_modes
                                .extend(next_trimmed.split_whitespace().map(|s| s.to_string()));
                            i += 1;
                        } else {
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }

    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_args() {
        let args = build_info_args("eth0");
        assert_eq!(args, vec!["eth0"]);
    }

    #[test]
    fn driver_info() {
        let args = build_driver_info_args("enp0s3");
        assert!(args.contains(&"-i".to_string()));
    }

    #[test]
    fn stats() {
        let args = build_stats_args("eth0");
        assert!(args.contains(&"-S".to_string()));
    }
}
