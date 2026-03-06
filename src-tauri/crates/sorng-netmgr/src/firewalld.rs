//! # firewalld — firewalld D-Bus / CLI wrapper
//!
//! Manages firewalld zones, services, ports, rich rules, direct rules,
//! masquerading, port forwarding, and runtime-to-permanent persistence.

use crate::types::*;

/// Build `firewall-cmd` arguments for listing zones.
pub fn build_list_zones_args() -> Vec<String> {
    vec!["--list-all-zones".to_string()]
}

/// Build arguments for querying the default zone.
pub fn build_get_default_zone_args() -> Vec<String> {
    vec!["--get-default-zone".to_string()]
}

/// Build arguments for listing active zones.
pub fn build_get_active_zones_args() -> Vec<String> {
    vec!["--get-active-zones".to_string()]
}

/// Build arguments to add a service to a zone.
pub fn build_add_service_args(zone: &str, service: &str, permanent: bool) -> Vec<String> {
    let mut args = vec![
        format!("--zone={}", zone),
        format!("--add-service={}", service),
    ];
    if permanent {
        args.push("--permanent".to_string());
    }
    args
}

/// Build arguments to remove a service from a zone.
pub fn build_remove_service_args(zone: &str, service: &str, permanent: bool) -> Vec<String> {
    let mut args = vec![
        format!("--zone={}", zone),
        format!("--remove-service={}", service),
    ];
    if permanent {
        args.push("--permanent".to_string());
    }
    args
}

/// Build arguments to add a port to a zone.
pub fn build_add_port_args(zone: &str, port: &str, protocol: &str, permanent: bool) -> Vec<String> {
    let mut args = vec![
        format!("--zone={}", zone),
        format!("--add-port={}/{}", port, protocol),
    ];
    if permanent {
        args.push("--permanent".to_string());
    }
    args
}

/// Build arguments to add a rich rule.
pub fn build_add_rich_rule_args(zone: &str, rule: &str, permanent: bool) -> Vec<String> {
    let mut args = vec![
        format!("--zone={}", zone),
        format!("--add-rich-rule={}", rule),
    ];
    if permanent {
        args.push("--permanent".to_string());
    }
    args
}

/// Build arguments for reload.
pub fn build_reload_args() -> Vec<String> {
    vec!["--reload".to_string()]
}

/// Build arguments for runtime-to-permanent.
pub fn build_runtime_to_permanent_args() -> Vec<String> {
    vec!["--runtime-to-permanent".to_string()]
}

/// Parse `--list-all-zones` output into zone structures.
pub fn parse_zone_list(_output: &str) -> Vec<FirewalldZone> {
    // TODO: implement zone parsing
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_service_permanent() {
        let args = build_add_service_args("public", "http", true);
        assert!(args.contains(&"--permanent".to_string()));
        assert!(args.contains(&"--zone=public".to_string()));
    }

    #[test]
    fn add_port_runtime() {
        let args = build_add_port_args("dmz", "8080", "tcp", false);
        assert!(!args.contains(&"--permanent".to_string()));
        assert!(args.contains(&"--add-port=8080/tcp".to_string()));
    }

    #[test]
    fn reload() {
        let args = build_reload_args();
        assert_eq!(args, vec!["--reload"]);
    }
}
