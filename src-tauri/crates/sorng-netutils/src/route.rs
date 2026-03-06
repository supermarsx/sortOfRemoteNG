//! # route — Routing table management
//!
//! Wraps `ip route`, `netstat -rn`, and `route print` for
//! inspecting and managing the system routing table.

use crate::types::*;

/// Build `ip -j route show` arguments.
pub fn build_ip_route_args(table: Option<&str>) -> Vec<String> {
    let mut args = vec!["-j".to_string(), "route".to_string(), "show".to_string()];
    if let Some(t) = table {
        args.push("table".to_string());
        args.push(t.to_string());
    }
    args
}

/// Build `ip route add` arguments.
pub fn build_route_add_args(destination: &str, gateway: &str, interface: Option<&str>, metric: Option<u32>) -> Vec<String> {
    let mut args = vec!["route".to_string(), "add".to_string(), destination.to_string(), "via".to_string(), gateway.to_string()];
    if let Some(iface) = interface {
        args.push("dev".to_string());
        args.push(iface.to_string());
    }
    if let Some(m) = metric {
        args.push("metric".to_string());
        args.push(m.to_string());
    }
    args
}

/// Build `ip route delete` arguments.
pub fn build_route_del_args(destination: &str) -> Vec<String> {
    vec!["route".to_string(), "delete".to_string(), destination.to_string()]
}

/// Build `route print` (Windows) arguments.
pub fn build_route_print_args() -> Vec<String> {
    vec!["print".to_string()]
}

/// Parse `ip -j route show` JSON output into `RouteEntry` structs.
pub fn parse_route_json(_json: &str) -> Vec<RouteEntry> {
    // TODO: implement
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_show() {
        let args = build_ip_route_args(None);
        assert!(args.contains(&"route".to_string()));
        assert!(args.contains(&"-j".to_string()));
    }

    #[test]
    fn route_add() {
        let args = build_route_add_args("10.0.0.0/8", "192.168.1.1", Some("eth0"), Some(100));
        assert!(args.contains(&"via".to_string()));
        assert!(args.contains(&"metric".to_string()));
    }
}
