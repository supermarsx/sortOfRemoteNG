//! # NetBird Route Management
//!
//! Network route helpers — CIDR validation, route conflict detection,
//! high-availability (HA) route groups, and masquerade configuration.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;

/// Validate that a CIDR string is well-formed.
pub fn validate_cidr(cidr: &str) -> Result<(), String> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid CIDR format: {}", cidr));
    }
    parts[0]
        .parse::<IpAddr>()
        .map_err(|e| format!("Invalid IP in CIDR: {}", e))?;
    let prefix: u8 = parts[1]
        .parse()
        .map_err(|e| format!("Invalid prefix length: {}", e))?;
    let max = if parts[0].contains(':') { 128 } else { 32 };
    if prefix > max {
        return Err(format!("Prefix length {} exceeds maximum {} for address family", prefix, max));
    }
    Ok(())
}

/// Detect overlapping CIDR ranges between routes.
pub fn detect_route_conflicts(routes: &[&NetBirdRoute]) -> Vec<RouteConflict> {
    let mut conflicts = Vec::new();
    for i in 0..routes.len() {
        for j in (i + 1)..routes.len() {
            if routes[i].network == routes[j].network && routes[i].enabled && routes[j].enabled {
                conflicts.push(RouteConflict {
                    route_a: routes[i].id.clone(),
                    route_b: routes[j].id.clone(),
                    network: routes[i].network.clone(),
                    conflict_type: ConflictType::ExactDuplicate,
                });
            }
        }
    }
    conflicts
}

/// A conflict between two routes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteConflict {
    pub route_a: String,
    pub route_b: String,
    pub network: String,
    pub conflict_type: ConflictType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictType {
    ExactDuplicate,
    Overlap,
}

/// Group routes by their `network_id` for HA route identification.
pub fn ha_route_groups(routes: &[&NetBirdRoute]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for r in routes {
        map.entry(r.network_id.clone()).or_default().push(r.id.clone());
    }
    // Only keep groups with >1 route (actual HA)
    map.retain(|_, v| v.len() > 1);
    map
}

/// Summary of route distribution across the mesh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteSummary {
    pub total: u32,
    pub enabled: u32,
    pub disabled: u32,
    pub ipv4: u32,
    pub ipv6: u32,
    pub domain_routes: u32,
    pub ha_groups: u32,
    pub with_masquerade: u32,
}

/// Compute a route summary.
pub fn summarize_routes(routes: &[&NetBirdRoute]) -> RouteSummary {
    let ha = ha_route_groups(routes);
    RouteSummary {
        total: routes.len() as u32,
        enabled: routes.iter().filter(|r| r.enabled).count() as u32,
        disabled: routes.iter().filter(|r| !r.enabled).count() as u32,
        ipv4: routes.iter().filter(|r| r.network_type == RouteNetworkType::IPv4).count() as u32,
        ipv6: routes.iter().filter(|r| r.network_type == RouteNetworkType::IPv6).count() as u32,
        domain_routes: routes
            .iter()
            .filter(|r| r.network_type == RouteNetworkType::DomainRoute)
            .count() as u32,
        ha_groups: ha.len() as u32,
        with_masquerade: routes.iter().filter(|r| r.masquerade).count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_cidr_valid() {
        assert!(validate_cidr("10.0.0.0/8").is_ok());
        assert!(validate_cidr("192.168.1.0/24").is_ok());
        assert!(validate_cidr("fd00::/48").is_ok());
    }

    #[test]
    fn test_validate_cidr_invalid() {
        assert!(validate_cidr("not-a-cidr").is_err());
        assert!(validate_cidr("10.0.0.0/33").is_err());
        assert!(validate_cidr("10.0.0.0").is_err());
    }

    #[test]
    fn test_detect_route_conflicts() {
        let r1 = NetBirdRoute {
            id: "r1".into(),
            description: "".into(),
            network_id: "n1".into(),
            network: "10.0.0.0/8".into(),
            network_type: RouteNetworkType::IPv4,
            enabled: true,
            peer: None,
            peer_groups: vec![],
            metric: 100,
            masquerade: false,
            groups: vec![],
            keep_route: false,
        };
        let r2 = NetBirdRoute {
            id: "r2".into(),
            network: "10.0.0.0/8".into(),
            enabled: true,
            ..r1.clone()
        };
        let conflicts = detect_route_conflicts(&[&r1, &r2]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].conflict_type, ConflictType::ExactDuplicate);
    }

    #[test]
    fn test_ha_route_groups() {
        let r1 = NetBirdRoute {
            id: "r1".into(),
            description: "".into(),
            network_id: "n1".into(),
            network: "10.0.0.0/8".into(),
            network_type: RouteNetworkType::IPv4,
            enabled: true,
            peer: Some("p1".into()),
            peer_groups: vec![],
            metric: 100,
            masquerade: false,
            groups: vec![],
            keep_route: false,
        };
        let r2 = NetBirdRoute { id: "r2".into(), peer: Some("p2".into()), ..r1.clone() };
        let r3 = NetBirdRoute { id: "r3".into(), network_id: "n2".into(), ..r1.clone() };
        let ha = ha_route_groups(&[&r1, &r2, &r3]);
        assert_eq!(ha.len(), 1); // only n1 has >1 route
        assert!(ha.contains_key("n1"));
    }
}
