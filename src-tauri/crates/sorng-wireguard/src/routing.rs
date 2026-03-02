//! # WireGuard Routing
//!
//! Route management for WireGuard tunnels including split tunneling,
//! default route handling, platform-specific route table manipulation.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

/// A routing action to apply when bringing up/down a tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteAction {
    pub destination: String,
    pub gateway: Option<String>,
    pub interface: String,
    pub metric: u32,
    pub action: RouteActionType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RouteActionType {
    Add,
    Remove,
    Replace,
}

/// Generate route commands for the given config.
pub fn generate_route_commands(config: &WgConfig, interface: &str) -> Vec<RouteAction> {
    let mut actions = Vec::new();

    for peer in &config.peers {
        for allowed_ip in &peer.allowed_ips {
            actions.push(RouteAction {
                destination: allowed_ip.clone(),
                gateway: None,
                interface: interface.to_string(),
                metric: 0,
                action: RouteActionType::Add,
            });
        }
    }

    actions
}

/// Platform-specific route command strings.
pub fn route_command_string(action: &RouteAction) -> String {
    if cfg!(target_os = "linux") {
        linux_route_command(action)
    } else if cfg!(target_os = "macos") {
        macos_route_command(action)
    } else {
        windows_route_command(action)
    }
}

fn linux_route_command(action: &RouteAction) -> String {
    let verb = match action.action {
        RouteActionType::Add => "add",
        RouteActionType::Remove => "del",
        RouteActionType::Replace => "replace",
    };

    let mut cmd = format!("ip route {} {} dev {}", verb, action.destination, action.interface);

    if let Some(ref gw) = action.gateway {
        cmd.push_str(&format!(" via {}", gw));
    }

    if action.metric > 0 {
        cmd.push_str(&format!(" metric {}", action.metric));
    }

    cmd
}

fn macos_route_command(action: &RouteAction) -> String {
    let verb = match action.action {
        RouteActionType::Add => "add",
        RouteActionType::Remove => "delete",
        RouteActionType::Replace => "change",
    };

    let (net, _prefix) = parse_cidr(&action.destination);

    let mut cmd = format!("route -n {} -net {}", verb, action.destination);

    if let Some(ref gw) = action.gateway {
        cmd.push_str(&format!(" {}", gw));
    } else {
        cmd.push_str(&format!(" -interface {}", action.interface));
    }

    let _ = net; // suppress unused warning
    cmd
}

fn windows_route_command(action: &RouteAction) -> String {
    let verb = match action.action {
        RouteActionType::Add => "add",
        RouteActionType::Remove => "delete",
        RouteActionType::Replace => "change",
    };

    let (net, prefix_len) = parse_cidr(&action.destination);
    let mask = prefix_to_mask(prefix_len);

    let gw = action
        .gateway
        .as_deref()
        .unwrap_or("0.0.0.0");

    let mut cmd = format!("route {} {} mask {} {}", verb, net, mask, gw);

    if action.metric > 0 {
        cmd.push_str(&format!(" metric {}", action.metric));
    }

    cmd
}

/// Parse a CIDR notation string into (address, prefix_length).
pub fn parse_cidr(cidr: &str) -> (String, u8) {
    if let Some(idx) = cidr.find('/') {
        let addr = cidr[..idx].to_string();
        let prefix: u8 = cidr[idx + 1..].parse().unwrap_or(32);
        (addr, prefix)
    } else {
        (cidr.to_string(), 32)
    }
}

/// Convert a prefix length to a subnet mask string (IPv4).
pub fn prefix_to_mask(prefix: u8) -> String {
    let mask: u32 = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix.min(32))
    };
    format!(
        "{}.{}.{}.{}",
        (mask >> 24) & 0xFF,
        (mask >> 16) & 0xFF,
        (mask >> 8) & 0xFF,
        mask & 0xFF
    )
}

/// Check for route conflicts with existing system routes.
pub fn check_route_conflicts(
    new_routes: &[WgRoute],
    existing_routes: &[WgRoute],
) -> Vec<RouteConflict> {
    let mut conflicts = Vec::new();

    for new_route in new_routes {
        for existing in existing_routes {
            if cidrs_overlap(&new_route.destination, &existing.destination) {
                conflicts.push(RouteConflict {
                    new_route: new_route.destination.clone(),
                    existing_route: existing.destination.clone(),
                    existing_interface: existing.interface.clone(),
                    severity: if is_default_route(&existing.destination) {
                        ConflictSeverity::High
                    } else {
                        ConflictSeverity::Medium
                    },
                });
            }
        }
    }

    conflicts
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteConflict {
    pub new_route: String,
    pub existing_route: String,
    pub existing_interface: String,
    pub severity: ConflictSeverity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictSeverity {
    Low,
    Medium,
    High,
}

/// Check if two CIDR ranges overlap.
pub fn cidrs_overlap(a: &str, b: &str) -> bool {
    let (a_addr, a_prefix) = parse_cidr(a);
    let (b_addr, b_prefix) = parse_cidr(b);

    let a_ip: Result<IpAddr, _> = a_addr.parse();
    let b_ip: Result<IpAddr, _> = b_addr.parse();

    match (a_ip, b_ip) {
        (Ok(IpAddr::V4(a4)), Ok(IpAddr::V4(b4))) => {
            let a_bits: u32 = u32::from(a4);
            let b_bits: u32 = u32::from(b4);
            let min_prefix = a_prefix.min(b_prefix);

            if min_prefix == 0 {
                return true;
            }

            let mask = !0u32 << (32 - min_prefix.min(32));
            (a_bits & mask) == (b_bits & mask)
        }
        _ => false, // IPv6 overlap detection or mixed → skip
    }
}

fn is_default_route(cidr: &str) -> bool {
    cidr == "0.0.0.0/0" || cidr == "::/0"
}

/// Split tunnel configuration builder.
pub fn build_split_tunnel_routes(
    config: &SplitTunnelConfig,
    all_allowed_ips: &[String],
) -> Vec<String> {
    match config.mode {
        SplitTunnelMode::FullTunnel => {
            vec!["0.0.0.0/0".to_string(), "::/0".to_string()]
        }
        SplitTunnelMode::SplitInclude => all_allowed_ips.to_vec(),
        SplitTunnelMode::SplitExclude => {
            // For exclude mode, route everything except the excluded CIDRs.
            // This requires splitting 0.0.0.0/0 into subnets that exclude
            // the listed CIDRs. A full implementation would use prefix
            // complement; here we return a placeholder list.
            let mut routes = Vec::new();

            // Start with the full range
            let exclude_set: std::collections::HashSet<String> =
                config.excluded_routes.iter().cloned().collect();

            // Keep allowed IPs that aren't excluded
            for ip in all_allowed_ips {
                if !exclude_set.contains(ip) {
                    routes.push(ip.clone());
                }
            }

            if routes.is_empty() {
                routes.push("0.0.0.0/0".to_string());
            }

            routes
        }
    }
}

/// Build routing table entries for kill switch (block all non-tunnel traffic).
pub fn kill_switch_routes(interface: &str, endpoint: &str) -> Vec<RouteAction> {
    let mut actions = Vec::new();

    // Route endpoint through default gateway (so the tunnel itself works)
    let (endpoint_ip, _) = parse_cidr(endpoint);
    actions.push(RouteAction {
        destination: format!("{}/32", endpoint_ip),
        gateway: None, // will be filled with default gw at runtime
        interface: String::new(),
        metric: 0,
        action: RouteActionType::Add,
    });

    // Route everything through tunnel (two /1 routes to override default without replacing it)
    actions.push(RouteAction {
        destination: "0.0.0.0/1".to_string(),
        gateway: None,
        interface: interface.to_string(),
        metric: 0,
        action: RouteActionType::Add,
    });

    actions.push(RouteAction {
        destination: "128.0.0.0/1".to_string(),
        gateway: None,
        interface: interface.to_string(),
        metric: 0,
        action: RouteActionType::Add,
    });

    actions
}
