//! Subnet management helpers.
use crate::types::*;
use std::collections::HashMap;

pub fn create_subnet(
    network: &str,
    netmask: &str,
    range_start: Option<&str>,
    range_end: Option<&str>,
    gateway: Option<&str>,
    dns: &[&str],
) -> DhcpSubnet {
    DhcpSubnet {
        network: network.into(),
        netmask: netmask.into(),
        range_start: range_start.map(Into::into),
        range_end: range_end.map(Into::into),
        gateway: gateway.map(Into::into),
        dns_servers: dns.iter().map(|s| s.to_string()).collect(),
        domain_name: None,
        lease_time: None,
        max_lease_time: None,
        options: HashMap::new(),
    }
}

pub fn subnet_to_dhcpd(subnet: &DhcpSubnet) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "subnet {} netmask {} {{",
        subnet.network, subnet.netmask
    ));
    if let (Some(ref s), Some(ref e)) = (&subnet.range_start, &subnet.range_end) {
        lines.push(format!("  range {} {};", s, e));
    }
    if let Some(ref gw) = subnet.gateway {
        lines.push(format!("  option routers {};", gw));
    }
    if !subnet.dns_servers.is_empty() {
        lines.push(format!(
            "  option domain-name-servers {};",
            subnet.dns_servers.join(", ")
        ));
    }
    if let Some(ref d) = subnet.domain_name {
        lines.push(format!("  option domain-name \"{}\";", d));
    }
    if let Some(lt) = subnet.lease_time {
        lines.push(format!("  default-lease-time {};", lt));
    }
    if let Some(mlt) = subnet.max_lease_time {
        lines.push(format!("  max-lease-time {};", mlt));
    }
    lines.push("}".into());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_subnet_to_dhcpd() {
        let s = create_subnet(
            "192.168.1.0",
            "255.255.255.0",
            Some("192.168.1.100"),
            Some("192.168.1.200"),
            Some("192.168.1.1"),
            &["8.8.8.8"],
        );
        let out = subnet_to_dhcpd(&s);
        assert!(out.contains("subnet 192.168.1.0 netmask 255.255.255.0"));
        assert!(out.contains("range 192.168.1.100 192.168.1.200"));
    }
}
