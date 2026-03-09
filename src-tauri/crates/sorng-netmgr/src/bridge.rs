//! # bridge — Bridge interface management
//!
//! Creates, configures, and removes bridge interfaces and
//! manages bridge ports via `ip link` and `bridge` commands.

/// Build `ip link add name <name> type bridge` arguments.
pub fn build_create_bridge_args(name: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "add".to_string(),
        "name".to_string(),
        name.to_string(),
        "type".to_string(),
        "bridge".to_string(),
    ]
}

/// Build `ip link set <port> master <bridge>` arguments.
pub fn build_add_port_args(port: &str, bridge: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "set".to_string(),
        port.to_string(),
        "master".to_string(),
        bridge.to_string(),
    ]
}

/// Build `ip link set <port> nomaster` arguments.
pub fn build_remove_port_args(port: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "set".to_string(),
        port.to_string(),
        "nomaster".to_string(),
    ]
}

/// Build `bridge -j link show` arguments.
pub fn build_show_bridge_links_args() -> Vec<String> {
    vec!["-j".to_string(), "link".to_string(), "show".to_string()]
}

/// Build `ip link delete <name>` arguments.
pub fn build_delete_bridge_args(name: &str) -> Vec<String> {
    vec!["link".to_string(), "delete".to_string(), name.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_bridge() {
        let args = build_create_bridge_args("br0");
        assert!(args.contains(&"bridge".to_string()));
        assert!(args.contains(&"br0".to_string()));
    }

    #[test]
    fn add_port() {
        let args = build_add_port_args("eth0", "br0");
        assert!(args.contains(&"master".to_string()));
        assert!(args.contains(&"br0".to_string()));
    }
}
