//! # vlan — VLAN (802.1Q) management
//!
//! Creates, configures, and removes VLAN sub-interfaces via
//! `ip link` or `nmcli connection`.

/// Build `ip link add link <parent> name <name> type vlan id <vid>` arguments.
pub fn build_create_vlan_args(parent: &str, vlan_id: u16, name: Option<&str>) -> Vec<String> {
    let vlan_name = name
        .map(|n| n.to_string())
        .unwrap_or_else(|| format!("{}.{}", parent, vlan_id));
    vec![
        "link".to_string(),
        "add".to_string(),
        "link".to_string(),
        parent.to_string(),
        "name".to_string(),
        vlan_name,
        "type".to_string(),
        "vlan".to_string(),
        "id".to_string(),
        vlan_id.to_string(),
    ]
}

/// Build `ip link delete <name>` arguments.
pub fn build_delete_vlan_args(name: &str) -> Vec<String> {
    vec!["link".to_string(), "delete".to_string(), name.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_vlan_default_name() {
        let args = build_create_vlan_args("eth0", 100, None);
        assert!(args.contains(&"eth0.100".to_string()));
        assert!(args.contains(&"100".to_string()));
    }

    #[test]
    fn create_vlan_custom_name() {
        let args = build_create_vlan_args("eth0", 200, Some("mgmt"));
        assert!(args.contains(&"mgmt".to_string()));
    }
}
