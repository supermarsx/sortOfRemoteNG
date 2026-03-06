//! DHCP reservation management helpers.
use crate::types::*;
use std::collections::HashMap;

pub fn create_reservation(hostname: &str, mac: &str, ip: &str) -> DhcpReservation {
    DhcpReservation { hostname: hostname.into(), mac_address: mac.into(), ip_address: ip.into(), options: HashMap::new() }
}

pub fn reservation_to_dhcpd(r: &DhcpReservation) -> String {
    format!("host {} {{\n  hardware ethernet {};\n  fixed-address {};\n}}", r.hostname, r.mac_address, r.ip_address)
}

pub fn reservation_to_dnsmasq(r: &DhcpReservation) -> String {
    format!("dhcp-host={},{},{}", r.mac_address, r.ip_address, r.hostname)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_reservation_to_dhcpd() {
        let r = create_reservation("myhost", "aa:bb:cc:dd:ee:ff", "192.168.1.50");
        let out = reservation_to_dhcpd(&r);
        assert!(out.contains("hardware ethernet aa:bb:cc:dd:ee:ff"));
        assert!(out.contains("fixed-address 192.168.1.50"));
    }
}
