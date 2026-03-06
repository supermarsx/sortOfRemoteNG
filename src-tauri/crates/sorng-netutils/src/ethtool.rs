//! # ethtool — NIC diagnostics wrapper
//!
//! Wraps `ethtool` for querying NIC capabilities, driver info,
//! offload settings, ring buffer sizes, and interface statistics.

use crate::types::*;

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
pub fn parse_ethtool_output(_output: &str) -> Option<EthtoolInfo> {
    // TODO: implement
    None
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
