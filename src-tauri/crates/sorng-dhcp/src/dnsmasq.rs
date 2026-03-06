//! dnsmasq DHCP configuration management.
use crate::client;
use crate::error::DhcpError;
use crate::types::*;
use std::collections::HashMap;

pub async fn get_config(host: &DhcpHost) -> Result<DnsmasqConfig, DhcpError> {
    let content = client::read_file(host, "/etc/dnsmasq.conf").await?;
    Ok(parse_dnsmasq_conf(&content))
}
pub async fn restart(host: &DhcpHost) -> Result<(), DhcpError> { client::exec_ok(host, "systemctl", &["restart", "dnsmasq"]).await?; Ok(()) }

pub fn parse_dnsmasq_conf(content: &str) -> DnsmasqConfig {
    let mut cfg = DnsmasqConfig { interface: None, listen_address: None, dhcp_ranges: Vec::new(), dhcp_hosts: Vec::new(), dhcp_options: HashMap::new(), domain: None, enable_tftp: false, tftp_root: None, all_settings: HashMap::new() };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim(); let v = v.trim();
            cfg.all_settings.insert(k.into(), v.into());
            match k {
                "interface" => cfg.interface = Some(v.into()),
                "listen-address" => cfg.listen_address = Some(v.into()),
                "domain" => cfg.domain = Some(v.into()),
                "enable-tftp" => cfg.enable_tftp = true,
                "tftp-root" => cfg.tftp_root = Some(v.into()),
                "dhcp-range" => {
                    let parts: Vec<&str> = v.split(',').collect();
                    if parts.len() >= 3 {
                        cfg.dhcp_ranges.push(DnsmasqRange { tag: None, start: parts[0].trim().into(), end: parts[1].trim().into(), lease_time: parts[2].trim().into(), netmask: parts.get(3).map(|s| s.trim().to_string()) });
                    }
                }
                "dhcp-host" => {
                    let parts: Vec<&str> = v.split(',').collect();
                    if parts.len() >= 2 {
                        cfg.dhcp_hosts.push(DhcpReservation { hostname: parts.get(2).unwrap_or(&"").to_string(), mac_address: parts[0].trim().into(), ip_address: parts[1].trim().into(), options: HashMap::new() });
                    }
                }
                _ => {}
            }
        }
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_dnsmasq() {
        let content = "interface=eth0\ndhcp-range=192.168.1.100,192.168.1.200,12h\ndhcp-host=aa:bb:cc:dd:ee:ff,192.168.1.50,myhost\n";
        let cfg = parse_dnsmasq_conf(content);
        assert_eq!(cfg.interface, Some("eth0".into()));
        assert_eq!(cfg.dhcp_ranges.len(), 1);
        assert_eq!(cfg.dhcp_hosts.len(), 1);
        assert_eq!(cfg.dhcp_hosts[0].ip_address, "192.168.1.50");
    }
}
