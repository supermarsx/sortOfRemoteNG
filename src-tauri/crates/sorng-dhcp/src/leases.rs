//! DHCP lease management.
use crate::client;
use crate::error::DhcpError;
use crate::types::*;

pub async fn list_leases_isc(host: &DhcpHost) -> Result<Vec<DhcpLease>, DhcpError> {
    let content = client::read_file(host, "/var/lib/dhcp/dhcpd.leases").await?;
    Ok(parse_isc_leases(&content))
}
pub async fn list_leases_dnsmasq(host: &DhcpHost) -> Result<Vec<DhcpLease>, DhcpError> {
    let content = client::read_file(host, "/var/lib/misc/dnsmasq.leases").await?;
    Ok(parse_dnsmasq_leases(&content))
}

pub fn parse_isc_leases(content: &str) -> Vec<DhcpLease> {
    let mut leases = Vec::new();
    let mut current_ip = String::new();
    let mut mac = String::new();
    let mut hostname: Option<String> = None;
    let mut in_lease = false;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("lease ") && line.ends_with('{') {
            current_ip = line
                .strip_prefix("lease ")
                .unwrap_or("")
                .strip_suffix(" {")
                .unwrap_or("")
                .trim()
                .to_string();
            in_lease = true;
            mac.clear();
            hostname = None;
        } else if line == "}" && in_lease {
            leases.push(DhcpLease {
                ip_address: current_ip.clone(),
                mac_address: mac.clone(),
                hostname: hostname.clone(),
                starts: None,
                ends: None,
                state: LeaseState::Active,
                client_id: None,
            });
            in_lease = false;
        } else if in_lease {
            if line.starts_with("hardware ethernet") {
                mac = line
                    .split_whitespace()
                    .nth(2)
                    .unwrap_or("")
                    .trim_end_matches(';')
                    .to_string();
            } else if line.starts_with("client-hostname") {
                hostname = Some(line.split('"').nth(1).unwrap_or("").to_string());
            }
        }
    }
    leases
}

pub fn parse_dnsmasq_leases(content: &str) -> Vec<DhcpLease> {
    content
        .lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 5 {
                return None;
            }
            Some(DhcpLease {
                ip_address: cols[2].into(),
                mac_address: cols[1].into(),
                hostname: Some(cols[3].into()).filter(|s: &String| s != "*"),
                starts: None,
                ends: None,
                state: LeaseState::Active,
                client_id: cols.get(4).map(|s| s.to_string()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_isc_leases() {
        let content = "lease 192.168.1.100 {\n  hardware ethernet aa:bb:cc:dd:ee:ff;\n  client-hostname \"myhost\";\n}\n";
        let leases = parse_isc_leases(content);
        assert_eq!(leases.len(), 1);
        assert_eq!(leases[0].ip_address, "192.168.1.100");
        assert_eq!(leases[0].mac_address, "aa:bb:cc:dd:ee:ff");
        assert_eq!(leases[0].hostname, Some("myhost".into()));
    }
    #[test]
    fn test_parse_dnsmasq_leases() {
        let content = "1234567890 aa:bb:cc:dd:ee:ff 192.168.1.100 myhost 01:aa:bb:cc:dd:ee:ff\n";
        let leases = parse_dnsmasq_leases(content);
        assert_eq!(leases.len(), 1);
        assert_eq!(leases[0].ip_address, "192.168.1.100");
    }
}
