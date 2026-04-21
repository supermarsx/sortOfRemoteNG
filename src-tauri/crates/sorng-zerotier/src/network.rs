//! # ZeroTier Network Management
//!
//! Network join/leave/configure operations, route management,
//! managed/global/default route settings.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Network join configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinConfig {
    pub network_id: String,
    pub allow_managed: bool,
    pub allow_global: bool,
    pub allow_default: bool,
    pub allow_dns: bool,
}

impl From<&ZtNetworkConfig> for JoinConfig {
    fn from(config: &ZtNetworkConfig) -> Self {
        Self {
            network_id: config.network_id.clone(),
            allow_managed: config.allow_managed,
            allow_global: config.allow_global,
            allow_default: config.allow_default,
            allow_dns: config.allow_dns,
        }
    }
}

/// Validate a network ID format.
pub fn validate_network_id(id: &str) -> Result<(), String> {
    if id.len() != 16 {
        return Err(format!(
            "Network ID must be 16 hex characters, got {} characters",
            id.len()
        ));
    }
    if !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Network ID must contain only hexadecimal characters".to_string());
    }
    Ok(())
}

/// Validate a ZeroTier node address.
pub fn validate_node_address(addr: &str) -> Result<(), String> {
    if addr.len() != 10 {
        return Err(format!(
            "Node address must be 10 hex characters, got {} characters",
            addr.len()
        ));
    }
    if !addr.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Node address must contain only hexadecimal characters".to_string());
    }
    Ok(())
}

/// Compute network statistics from detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStats {
    pub network_id: String,
    pub name: String,
    pub status: String,
    pub assigned_ip_count: usize,
    pub route_count: usize,
    pub has_dns: bool,
    pub mtu: u32,
    pub is_bridge: bool,
}

pub fn compute_network_stats(detail: &ZtNetworkDetail) -> NetworkStats {
    NetworkStats {
        network_id: detail.id.clone(),
        name: detail.name.clone(),
        status: format!("{:?}", detail.status),
        assigned_ip_count: detail.assigned_addresses.len(),
        route_count: detail.routes.len(),
        has_dns: detail.dns.is_some(),
        mtu: detail.mtu,
        is_bridge: detail.bridge,
    }
}

/// Build the API URL for the local ZeroTier service.
pub fn api_url(port: u16, path: &str) -> String {
    format!("http://127.0.0.1:{}/{}", port, path.trim_start_matches('/'))
}

/// Build API headers with auth token.
pub fn api_headers(authtoken: &str) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    headers.insert("X-ZT1-Auth".to_string(), authtoken.to_string());
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers
}

/// Build API request to get network configuration.
pub fn get_network_api_path(network_id: &str) -> String {
    format!("network/{}", network_id)
}

/// Build API request to set network configuration.
pub fn set_network_config_body(config: &JoinConfig) -> serde_json::Value {
    serde_json::json!({
        "allowManaged": config.allow_managed,
        "allowGlobal": config.allow_global,
        "allowDefault": config.allow_default,
        "allowDNS": config.allow_dns,
    })
}

/// Check if a route overlaps with existing routes.
pub fn check_route_conflicts(new_route: &ZtRoute, existing: &[ZtRoute]) -> Vec<String> {
    let mut conflicts = Vec::new();

    for route in existing {
        if route.target == new_route.target {
            conflicts.push(format!(
                "Route {} already exists (via {:?})",
                route.target, route.via
            ));
        }
        // Simple subnet overlap check
        if routes_overlap(&new_route.target, &route.target) {
            conflicts.push(format!(
                "Route {} may overlap with existing route {}",
                new_route.target, route.target
            ));
        }
    }

    conflicts
}

/// Simple check if two CIDR routes overlap.
fn routes_overlap(a: &str, b: &str) -> bool {
    // Parse CIDR notation
    let parse_cidr = |cidr: &str| -> Option<(u32, u32)> {
        let parts: Vec<&str> = cidr.split('/').collect();
        if parts.len() != 2 {
            return None;
        }
        let ip: u32 = parts[0]
            .split('.')
            .filter_map(|o| o.parse::<u32>().ok())
            .enumerate()
            .fold(0u32, |acc, (i, o)| acc | (o << (24 - i * 8)));
        let prefix: u32 = parts[1].parse().ok()?;
        let mask = if prefix == 0 {
            0
        } else {
            !0u32 << (32 - prefix)
        };
        Some((ip & mask, mask))
    };

    if let (Some((net_a, mask_a)), Some((net_b, mask_b))) = (parse_cidr(a), parse_cidr(b)) {
        let smaller_mask = mask_a & mask_b;
        (net_a & smaller_mask) == (net_b & smaller_mask)
    } else {
        false
    }
}

/// Generate managed route entries for the network.
pub fn suggest_routes(assigned_ips: &[String], include_default: bool) -> Vec<ZtRoute> {
    let mut routes = Vec::new();

    for ip in assigned_ips {
        // Generate /24 route for each assigned IP
        if let Some(prefix) = ip.split('/').next() {
            if let Some(last_dot) = prefix.rfind('.') {
                let network = format!("{}.0/24", &prefix[..last_dot]);
                routes.push(ZtRoute {
                    target: network,
                    via: None,
                    flags: 0,
                    metric: 0,
                });
            }
        }
    }

    if include_default {
        routes.push(ZtRoute {
            target: "0.0.0.0/0".to_string(),
            via: None,
            flags: 0,
            metric: 0,
        });
    }

    routes
}
