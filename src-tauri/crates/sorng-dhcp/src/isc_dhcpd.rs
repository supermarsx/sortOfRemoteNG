//! ISC dhcpd configuration management.
use crate::client;
use crate::error::DhcpError;
use crate::types::*;
use std::collections::HashMap;

pub async fn get_config(host: &DhcpHost) -> Result<IscDhcpdConfig, DhcpError> {
    let content = client::read_file(host, "/etc/dhcp/dhcpd.conf").await?;
    parse_dhcpd_conf(&content)
}
pub async fn check_config(host: &DhcpHost) -> Result<bool, DhcpError> {
    let (_, _, code) = client::exec(host, "dhcpd", &["-t", "-cf", "/etc/dhcp/dhcpd.conf"]).await?;
    Ok(code == 0)
}
pub async fn restart(host: &DhcpHost) -> Result<(), DhcpError> {
    client::exec_ok(host, "systemctl", &["restart", "isc-dhcp-server"]).await?;
    Ok(())
}

pub fn parse_dhcpd_conf(content: &str) -> Result<IscDhcpdConfig, DhcpError> {
    let mut cfg = IscDhcpdConfig {
        global_options: HashMap::new(),
        subnets: Vec::new(),
        reservations: Vec::new(),
        shared_networks: Vec::new(),
        authoritative: false,
        ddns_update_style: None,
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line == "authoritative;" {
            cfg.authoritative = true;
        } else if line.starts_with("ddns-update-style") {
            cfg.ddns_update_style = Some(
                line.split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .trim_end_matches(';')
                    .to_string(),
            );
        } else if line.starts_with("option") {
            let rest = line
                .strip_prefix("option ")
                .unwrap_or(line)
                .trim_end_matches(';');
            if let Some((k, v)) = rest.split_once(' ') {
                cfg.global_options.insert(k.trim().into(), v.trim().into());
            }
        } else if line.starts_with("subnet") {
            // simplified — just capture the subnet line
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                cfg.subnets.push(DhcpSubnet {
                    network: parts[1].into(),
                    netmask: parts[3].into(),
                    range_start: None,
                    range_end: None,
                    gateway: None,
                    dns_servers: Vec::new(),
                    domain_name: None,
                    lease_time: None,
                    max_lease_time: None,
                    options: HashMap::new(),
                });
            }
        } else if line.starts_with("host") {
            let name = line.split_whitespace().nth(1).unwrap_or("").to_string();
            cfg.reservations.push(DhcpReservation {
                hostname: name,
                mac_address: String::new(),
                ip_address: String::new(),
                options: HashMap::new(),
            });
        }
    }
    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_dhcpd() {
        let content = "authoritative;\nddns-update-style none;\noption domain-name \"example.com\";\nsubnet 192.168.1.0 netmask 255.255.255.0 {\n}\n";
        let cfg = parse_dhcpd_conf(content).unwrap();
        assert!(cfg.authoritative);
        assert_eq!(cfg.subnets.len(), 1);
        assert_eq!(cfg.subnets[0].network, "192.168.1.0");
    }
}
