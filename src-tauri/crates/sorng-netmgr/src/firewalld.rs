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
pub fn parse_zone_list(output: &str) -> Vec<FirewalldZone> {
    let mut zones = Vec::new();
    let mut current: Option<FirewalldZone> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if let Some(zone) = current.take() {
                zones.push(zone);
            }
            continue;
        }

        // A new zone block starts with a non-indented line ending with or containing the zone name
        // e.g. "public (active)" or "public"
        if !line.starts_with(' ') && !line.starts_with('\t') && current.is_none() {
            let name = trimmed.split_whitespace().next().unwrap_or("").to_string();
            let is_active = trimmed.contains("(active)");
            let is_default = trimmed.contains("(default");
            current = Some(FirewalldZone {
                name,
                description: String::new(),
                target: FirewallVerdict::Drop,
                interfaces: Vec::new(),
                sources: Vec::new(),
                services: Vec::new(),
                ports: Vec::new(),
                protocols: Vec::new(),
                masquerade: false,
                forward_ports: Vec::new(),
                rich_rules: Vec::new(),
                icmp_blocks: Vec::new(),
                icmp_block_inversion: false,
                is_active,
                is_default,
            });
            continue;
        }

        // Non-indented line while we already have a zone means continuation header
        if !line.starts_with(' ') && !line.starts_with('\t') {
            if let Some(zone) = current.take() {
                zones.push(zone);
            }
            let name = trimmed.split_whitespace().next().unwrap_or("").to_string();
            let is_active = trimmed.contains("(active)");
            let is_default = trimmed.contains("(default");
            current = Some(FirewalldZone {
                name,
                description: String::new(),
                target: FirewallVerdict::Drop,
                interfaces: Vec::new(),
                sources: Vec::new(),
                services: Vec::new(),
                ports: Vec::new(),
                protocols: Vec::new(),
                masquerade: false,
                forward_ports: Vec::new(),
                rich_rules: Vec::new(),
                icmp_blocks: Vec::new(),
                icmp_block_inversion: false,
                is_active,
                is_default,
            });
            continue;
        }

        if let Some(ref mut zone) = current {
            if let Some((key, value)) = trimmed.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                match key {
                    "target" => {
                        zone.target = match value.to_uppercase().as_str() {
                            "ACCEPT" => FirewallVerdict::Accept,
                            "REJECT" => FirewallVerdict::Reject,
                            "%%REJECT%%" => FirewallVerdict::Reject,
                            _ => FirewallVerdict::Drop,
                        };
                    }
                    "description" => zone.description = value.to_string(),
                    "interfaces" => {
                        zone.interfaces = value
                            .split_whitespace()
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .collect();
                    }
                    "sources" => {
                        zone.sources = value
                            .split_whitespace()
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .collect();
                    }
                    "services" => {
                        zone.services = value
                            .split_whitespace()
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .collect();
                    }
                    "ports" => {
                        zone.ports = value
                            .split_whitespace()
                            .filter(|s| !s.is_empty())
                            .filter_map(|s| {
                                let mut parts = s.splitn(2, '/');
                                let port = parts.next()?.to_string();
                                let protocol = parts.next().unwrap_or("tcp").to_string();
                                Some(FirewalldPort { port, protocol })
                            })
                            .collect();
                    }
                    "protocols" => {
                        zone.protocols = value
                            .split_whitespace()
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .collect();
                    }
                    "masquerade" => zone.masquerade = value == "yes",
                    "forward-ports" => {
                        // forward-ports entries like: port=80:proto=tcp:toport=8080:toaddr=192.168.1.1
                        if !value.is_empty() {
                            for entry in value.split_whitespace() {
                                let mut port = String::new();
                                let mut protocol = String::new();
                                let mut to_port = None;
                                let mut to_addr = None;
                                for kv in entry.split(':') {
                                    if let Some((k, v)) = kv.split_once('=') {
                                        match k {
                                            "port" => port = v.to_string(),
                                            "proto" => protocol = v.to_string(),
                                            "toport" => to_port = Some(v.to_string()),
                                            "toaddr" => to_addr = Some(v.to_string()),
                                            _ => {}
                                        }
                                    }
                                }
                                if !port.is_empty() {
                                    zone.forward_ports.push(FirewalldForwardPort {
                                        port,
                                        protocol,
                                        to_port,
                                        to_addr,
                                    });
                                }
                            }
                        }
                    }
                    "rich rules" => {
                        if !value.is_empty() {
                            zone.rich_rules.push(value.to_string());
                        }
                    }
                    "icmp-blocks" => {
                        zone.icmp_blocks = value
                            .split_whitespace()
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .collect();
                    }
                    "icmp-block-inversion" => zone.icmp_block_inversion = value == "yes",
                    _ => {}
                }
            } else if trimmed.starts_with("rule ") {
                // continuation rich rule line
                zone.rich_rules.push(trimmed.to_string());
            }
        }
    }

    if let Some(zone) = current {
        zones.push(zone);
    }

    zones
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
