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
pub fn build_route_add_args(
    destination: &str,
    gateway: &str,
    interface: Option<&str>,
    metric: Option<u32>,
) -> Vec<String> {
    let mut args = vec![
        "route".to_string(),
        "add".to_string(),
        destination.to_string(),
        "via".to_string(),
        gateway.to_string(),
    ];
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
    vec![
        "route".to_string(),
        "delete".to_string(),
        destination.to_string(),
    ]
}

/// Build `route print` (Windows) arguments.
pub fn build_route_print_args() -> Vec<String> {
    vec!["print".to_string()]
}

/// Parse `ip -j route show` JSON output into `RouteEntry` structs.
pub fn parse_route_json(json: &str) -> Vec<RouteEntry> {
    let entries: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    entries
        .iter()
        .filter_map(|obj| {
            let destination = obj.get("dst")?.as_str()?.to_string();
            let interface = obj
                .get("dev")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let gateway = obj
                .get("gateway")
                .and_then(|v| v.as_str())
                .map(String::from);
            let protocol = obj
                .get("protocol")
                .and_then(|v| v.as_str())
                .map(String::from);
            let scope = obj.get("scope").and_then(|v| v.as_str()).map(String::from);
            let route_type = obj.get("type").and_then(|v| v.as_str()).map(String::from);
            let metric = obj
                .get("metric")
                .and_then(|v| v.as_u64().map(|n| n as u32))
                .unwrap_or(0);

            let prefix_len = if destination.contains('/') {
                destination
                    .split('/')
                    .nth(1)
                    .and_then(|s| s.parse::<u8>().ok())
            } else {
                None
            };

            let flags = obj
                .get("flags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|f| f.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            let mtu = obj.get("mtu").and_then(|v| v.as_u64().map(|n| n as u32));
            let table_id = obj.get("table").and_then(|v| v.as_u64().map(|n| n as u32));

            Some(RouteEntry {
                destination,
                gateway,
                netmask: None,
                prefix_len,
                interface,
                metric,
                protocol,
                scope,
                route_type,
                flags,
                mtu,
                table_id,
            })
        })
        .collect()
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
