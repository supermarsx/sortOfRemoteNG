//! Passive discovery of the actual networks attached to local interfaces.

use getifaddrs::{Interface, InterfaceFlags};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// An interface address and its full, canonical network CIDR (IPv4 or IPv6).
/// Scan-size limits and suggested slices belong to the caller.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceSubnet {
    pub interface_name: String,
    pub address: String,
    pub cidr: String,
}

/// Read native interface metadata without probes, DNS lookups, or route changes.
///
/// Includes up VPN/tunnel interfaces and preserves their actual prefixes. IPv6
/// link-local addresses are omitted because the scanner cannot accept a scope ID.
/// Results are sorted lexically by interface name, address, then CIDR, with exact
/// duplicates removed. An empty result is valid when no eligible addresses exist.
pub async fn detect_interface_subnets() -> Result<Vec<InterfaceSubnet>, String> {
    tokio::task::spawn_blocking(|| {
        let interfaces = getifaddrs::getifaddrs()
            .map_err(|error| format!("Could not enumerate local interfaces: {error}"))?;
        Ok(collect_subnets(interfaces))
    })
    .await
    .map_err(|error| format!("Local interface enumeration task failed: {error}"))?
}

fn collect_subnets(interfaces: impl IntoIterator<Item = Interface>) -> Vec<InterfaceSubnet> {
    let mut subnets: Vec<_> = interfaces
        .into_iter()
        .filter_map(interface_subnet)
        .collect();
    subnets.sort_unstable();
    subnets.dedup();
    subnets
}

fn interface_subnet(interface: Interface) -> Option<InterfaceSubnet> {
    if !interface.flags.contains(InterfaceFlags::UP)
        || interface.flags.contains(InterfaceFlags::LOOPBACK)
    {
        return None;
    }
    // getifaddrs also sets UP for IP-enabled Windows adapters even when down.
    // RUNNING reflects OperStatusUp there. Unix uses IFF_UP; requiring RUNNING
    // on Unix would unnecessarily constrain virtual/point-to-point interfaces.
    #[cfg(windows)]
    if !interface.flags.contains(InterfaceFlags::RUNNING) {
        return None;
    }
    let address = interface.address.ip_addr()?;
    if !usable_address(address) {
        return None;
    }
    let cidr = network_cidr(address, interface.address.netmask()?)?;
    // getifaddrs' Windows description is GetAdaptersAddresses.FriendlyName;
    // name is the lower-level if_indextoname identifier (or a LUID fallback).
    #[cfg(windows)]
    let interface_name = if interface.description.trim().is_empty() {
        interface.name
    } else {
        interface.description
    };
    #[cfg(not(windows))]
    let interface_name = interface.name;
    Some(InterfaceSubnet {
        interface_name,
        address: address.to_string(),
        cidr,
    })
}

fn usable_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            // Exclude 0/8 and reserved space, including limited broadcast.
            !ip.is_loopback() && !ip.is_multicast() && ip.octets()[0] != 0 && ip.octets()[0] < 240
        }
        IpAddr::V6(ip) => {
            !ip.is_unspecified()
                && !ip.is_loopback()
                && !ip.is_multicast()
                && !ip.is_unicast_link_local()
                && ip.to_ipv4_mapped().is_none()
        }
    }
}

fn network_cidr(address: IpAddr, netmask: IpAddr) -> Option<String> {
    let (network, prefix) = match (address, netmask) {
        (IpAddr::V4(address), IpAddr::V4(mask)) => {
            let mask = u32::from(mask);
            let prefix = mask.leading_ones();
            // Counting set bits alone would accept non-contiguous masks.
            if mask.count_ones() != prefix {
                return None;
            }
            (
                IpAddr::V4(Ipv4Addr::from(u32::from(address) & mask)),
                prefix,
            )
        }
        (IpAddr::V6(address), IpAddr::V6(mask)) => {
            let mask = u128::from(mask);
            let prefix = mask.leading_ones();
            if mask.count_ones() != prefix {
                return None;
            }
            (
                IpAddr::V6(Ipv6Addr::from(u128::from(address) & mask)),
                prefix,
            )
        }
        _ => return None,
    };
    Some(format!("{network}/{prefix}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use getifaddrs::{Address, NetworkAddress};

    fn interface(name: &str, ip: &str, mask: Option<&str>) -> Interface {
        let address = match ip.parse::<IpAddr>().unwrap() {
            IpAddr::V4(address) => Address::V4(NetworkAddress {
                address,
                netmask: mask.map(|mask| mask.parse().unwrap()),
                associated_address: None,
            }),
            IpAddr::V6(address) => Address::V6(NetworkAddress {
                address,
                netmask: mask.map(|mask| mask.parse().unwrap()),
                associated_address: None,
            }),
        };
        Interface {
            name: name.to_owned(),
            #[cfg(windows)]
            description: String::new(),
            address,
            flags: InterfaceFlags::UP | InterfaceFlags::RUNNING,
            index: Some(1),
        }
    }

    #[test]
    fn preserves_real_networks_and_host_prefixes() {
        for (ip, mask, expected) in [
            ("172.20.42.7", "255.255.0.0", "172.20.0.0/16"),
            ("192.168.10.200", "255.255.255.128", "192.168.10.128/25"),
            ("10.2.3.5", "255.255.255.254", "10.2.3.4/31"),
            ("10.2.3.5", "255.255.255.255", "10.2.3.5/32"),
            ("10.2.3.5", "0.0.0.0", "0.0.0.0/0"),
            (
                "fd12:3456:789a:1::abcd",
                "ffff:ffff:ffff:ffff::",
                "fd12:3456:789a:1::/64",
            ),
            (
                "2001:db8::abcd",
                "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ff00",
                "2001:db8::ab00/120",
            ),
            (
                "2001:db8::abcd",
                "ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe",
                "2001:db8::abcc/127",
            ),
            (
                "2001:db8::abcd",
                "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
                "2001:db8::abcd/128",
            ),
            ("2001:db8::abcd", "::", "::/0"),
        ] {
            let result = interface_subnet(interface("tun0", ip, Some(mask))).unwrap();
            assert_eq!(result.address, ip);
            assert_eq!(result.cidr, expected);
        }
    }

    #[test]
    fn accepts_every_contiguous_mask() {
        for prefix in 0..=32 {
            let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
            let result = network_cidr(
                Ipv4Addr::new(10, 2, 3, 4).into(),
                Ipv4Addr::from(mask).into(),
            )
            .unwrap();
            assert!(result.ends_with(&format!("/{prefix}")));
        }
        for prefix in 0..=128 {
            let mask = u128::MAX.checked_shl(128 - prefix).unwrap_or(0);
            let result =
                network_cidr("fd12::abcd".parse().unwrap(), Ipv6Addr::from(mask).into()).unwrap();
            assert!(result.ends_with(&format!("/{prefix}")));
        }
    }

    #[test]
    fn rejects_missing_noncontiguous_and_wrong_family_masks() {
        for mask in [
            None,
            Some("255.0.255.0"),
            Some("255.255.255.1"),
            Some("127.255.255.255"),
        ] {
            assert!(interface_subnet(interface("eth0", "10.2.3.4", mask)).is_none());
        }
        for mask in [None, Some("ffff:ffff:0:ffff::"), Some("::1")] {
            assert!(interface_subnet(interface("eth0", "fd12::abcd", mask)).is_none());
        }
        assert!(network_cidr("10.2.3.4".parse().unwrap(), "ffff::".parse().unwrap()).is_none());
        assert!(network_cidr("fd12::1".parse().unwrap(), "255.0.0.0".parse().unwrap()).is_none());
    }

    #[test]
    fn excludes_unusable_addresses() {
        for ip in [
            "0.0.0.0",
            "0.1.2.3",
            "127.0.0.1",
            "127.42.0.7",
            "224.0.0.1",
            "239.255.255.255",
            "240.0.0.1",
            "255.255.255.255",
        ] {
            assert!(
                interface_subnet(interface("eth0", ip, Some("255.255.0.0"))).is_none(),
                "{ip}"
            );
        }
        for ip in [
            "::",
            "::1",
            "ff02::1",
            "fe80::1",
            "febf::1",
            "::ffff:192.168.1.2",
        ] {
            assert!(
                interface_subnet(interface("eth0", ip, Some("ffff:ffff:ffff:ffff::"))).is_none(),
                "{ip}"
            );
        }
        // IPv4 link-local and IPv6 unique-local addresses remain useful locally.
        assert!(interface_subnet(interface("eth0", "169.254.42.5", Some("255.255.0.0"))).is_some());
        assert!(
            interface_subnet(interface("eth0", "fd12::1", Some("ffff:ffff:ffff:ffff::"))).is_some()
        );
    }

    #[test]
    fn respects_interface_flags_and_keeps_tunnels() {
        let mut candidate = interface("tun0", "10.8.0.3", Some("255.255.0.0"));
        candidate.flags |= InterfaceFlags::POINTTOPOINT;
        assert!(interface_subnet(candidate.clone()).is_some());
        candidate.flags.remove(InterfaceFlags::UP);
        assert!(interface_subnet(candidate.clone()).is_none());
        candidate
            .flags
            .insert(InterfaceFlags::UP | InterfaceFlags::LOOPBACK);
        assert!(interface_subnet(candidate.clone()).is_none());
        candidate
            .flags
            .remove(InterfaceFlags::LOOPBACK | InterfaceFlags::RUNNING);
        assert_eq!(interface_subnet(candidate).is_some(), !cfg!(windows));
    }

    #[test]
    fn sorts_and_only_deduplicates_exact_triples() {
        let a = interface("eth0", "10.2.3.4", Some("255.255.0.0"));
        let inputs = vec![
            interface("tun0", "10.2.3.4", Some("255.255.0.0")),
            a.clone(),
            interface("eth0", "10.2.3.4", Some("255.255.255.0")),
            interface("eth0", "10.2.3.5", Some("255.255.0.0")),
            a,
        ];
        let result = collect_subnets(inputs.clone());
        assert_eq!(result.len(), 4);
        assert!(result.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(result, collect_subnets(inputs.into_iter().rev()));
        assert!(collect_subnets(Vec::new()).is_empty());
    }

    #[test]
    fn serializes_agreed_camel_case_fields() {
        let result =
            interface_subnet(interface("eth0", "172.20.42.7", Some("255.255.0.0"))).unwrap();
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "interfaceName": "eth0", "address": "172.20.42.7", "cidr": "172.20.0.0/16"
            })
        );
    }

    #[cfg(windows)]
    #[test]
    fn uses_windows_friendly_name_with_native_name_fallback() {
        let mut candidate = interface("ethernet_32768", "172.20.42.7", Some("255.255.0.0"));
        candidate.description = "Ethernet - Escritório".to_string();
        assert_eq!(
            interface_subnet(candidate.clone()).unwrap().interface_name,
            "Ethernet - Escritório"
        );
        for missing in ["", "  "] {
            candidate.description = missing.to_string();
            assert_eq!(
                interface_subnet(candidate.clone()).unwrap().interface_name,
                "ethernet_32768"
            );
        }
    }

    #[tokio::test]
    #[ignore = "reads native local interface metadata; run explicitly for a smoke check"]
    async fn native_enumeration_smoke() {
        let result = detect_interface_subnets().await.unwrap();
        assert!(result.windows(2).all(|pair| pair[0] < pair[1]));
        for subnet in &result {
            assert!(usable_address(subnet.address.parse().unwrap()));
        }
        println!("Enumerated {} local interface subnets", result.len());
    }
}
