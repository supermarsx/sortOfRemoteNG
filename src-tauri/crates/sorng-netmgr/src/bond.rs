//! # bond — Network bonding / teaming management
//!
//! Creates and configures bonded interfaces via `ip link` or `nmcli`.
//! Supports modes: balance-rr, active-backup, balance-xor, broadcast,
//! 802.3ad (LACP), balance-tlb, balance-alb.

/// Build `ip link add <name> type bond` arguments.
pub fn build_create_bond_args(name: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "add".to_string(),
        name.to_string(),
        "type".to_string(),
        "bond".to_string(),
    ]
}

/// Build `ip link set <slave> master <bond>` arguments.
pub fn build_add_slave_args(slave: &str, bond: &str) -> Vec<String> {
    vec![
        "link".to_string(),
        "set".to_string(),
        slave.to_string(),
        "master".to_string(),
        bond.to_string(),
    ]
}

/// Build arguments to set bond mode via sysfs.
pub fn build_set_mode_args(bond: &str, mode: &str) -> String {
    format!("echo {} > /sys/class/net/{}/bonding/mode", mode, bond)
}

/// Build `ip link delete <name>` arguments.
pub fn build_delete_bond_args(name: &str) -> Vec<String> {
    vec!["link".to_string(), "delete".to_string(), name.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_bond() {
        let args = build_create_bond_args("bond0");
        assert!(args.contains(&"bond".to_string()));
        assert!(args.contains(&"bond0".to_string()));
    }

    #[test]
    fn add_slave() {
        let args = build_add_slave_args("eth0", "bond0");
        assert!(args.contains(&"master".to_string()));
    }
}
