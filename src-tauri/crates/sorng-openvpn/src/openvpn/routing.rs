//! Route-table manipulation, split-tunnel policy, and platform-specific route
//! add/remove helpers for OpenVPN connections.

use crate::openvpn::types::*;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Routing policy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Routing policy for a VPN connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingPolicy {
    /// Full tunnel: redirect all traffic through VPN.
    pub redirect_gateway: bool,
    /// Pull routes from server.
    pub pull_routes: bool,
    /// Only route these subnets through VPN (split-tunnel include list).
    pub include_subnets: Vec<SubnetRoute>,
    /// Exclude these subnets from VPN (split-tunnel exclude list).
    pub exclude_subnets: Vec<SubnetRoute>,
    /// Bypass VPN for local LAN.
    pub bypass_lan: bool,
    /// Bypass VPN for the VPN server IP itself (to prevent routing loop).
    pub bypass_vpn_server: bool,
    /// Custom static routes to add on connect.
    pub static_routes: Vec<SubnetRoute>,
    /// IPv6 routing policy.
    pub ipv6_redirect: bool,
    /// IPv6 routes.
    pub ipv6_routes: Vec<Ipv6SubnetRoute>,
}

impl Default for RoutingPolicy {
    fn default() -> Self {
        Self {
            redirect_gateway: false,
            pull_routes: true,
            include_subnets: Vec::new(),
            exclude_subnets: Vec::new(),
            bypass_lan: true,
            bypass_vpn_server: true,
            static_routes: Vec::new(),
            ipv6_redirect: false,
            ipv6_routes: Vec::new(),
        }
    }
}

impl RoutingPolicy {
    /// Full-tunnel policy: route everything through VPN.
    pub fn full_tunnel() -> Self {
        Self {
            redirect_gateway: true,
            bypass_lan: true,
            bypass_vpn_server: true,
            ..Default::default()
        }
    }

    /// Split-tunnel: only specified subnets go through VPN.
    pub fn split_tunnel(subnets: Vec<SubnetRoute>) -> Self {
        Self {
            redirect_gateway: false,
            include_subnets: subnets,
            bypass_lan: true,
            ..Default::default()
        }
    }

    /// Is this policy a split-tunnel configuration?
    pub fn is_split_tunnel(&self) -> bool {
        !self.redirect_gateway && !self.include_subnets.is_empty()
    }
}

/// A subnet route (IPv4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubnetRoute {
    pub network: String,
    pub mask: String,
    pub gateway: Option<String>,
    pub metric: Option<u32>,
    pub comment: Option<String>,
}

impl SubnetRoute {
    pub fn new(network: impl Into<String>, mask: impl Into<String>) -> Self {
        Self {
            network: network.into(),
            mask: mask.into(),
            gateway: None,
            metric: None,
            comment: None,
        }
    }

    pub fn with_gateway(mut self, gw: impl Into<String>) -> Self {
        self.gateway = Some(gw.into());
        self
    }

    pub fn with_metric(mut self, m: u32) -> Self {
        self.metric = Some(m);
        self
    }

    /// Convert mask like "255.255.255.0" to CIDR prefix like "/24".
    pub fn cidr_prefix(&self) -> Option<u8> {
        mask_to_prefix(&self.mask)
    }
}

/// IPv6 subnet route.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ipv6SubnetRoute {
    pub network: String, // e.g. "2001:db8::/32"
    pub gateway: Option<String>,
    pub metric: Option<u32>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Route table snapshot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A snapshot of the system routing table (simplified).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteTableEntry {
    pub destination: String,
    pub mask: String,
    pub gateway: String,
    pub interface: String,
    pub metric: u32,
}

/// Capture the current IPv4 routing table.
pub async fn capture_route_table() -> Result<Vec<RouteTableEntry>, OpenVpnError> {
    #[cfg(target_os = "windows")]
    let output = tokio::process::Command::new("route")
        .args(["print", "-4"])
        .output()
        .await;

    #[cfg(target_os = "linux")]
    let output = tokio::process::Command::new("ip")
        .args(["route", "show"])
        .output()
        .await;

    #[cfg(target_os = "macos")]
    let output = tokio::process::Command::new("netstat")
        .args(["-rn", "-f", "inet"])
        .output()
        .await;

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    let output: Result<std::process::Output, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Unsupported platform",
    ));

    let output = output.map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::RouteError,
        message: format!("Cannot capture route table: {}", e),
        detail: None,
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_route_table(&stdout))
}

/// Parse `route print` (Windows) or `ip route` (Linux) output.
pub fn parse_route_table(output: &str) -> Vec<RouteTableEntry> {
    let mut entries = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Windows format: "  10.0.0.0   255.0.0.0   10.8.0.1   10.8.0.2   25"
        let parts: Vec<&str> = line.split_whitespace().collect();

        // Try parsing as Windows route-print output
        if parts.len() >= 5 {
            if is_ip_like(parts[0]) && is_ip_like(parts[1]) {
                entries.push(RouteTableEntry {
                    destination: parts[0].to_string(),
                    mask: parts[1].to_string(),
                    gateway: parts[2].to_string(),
                    interface: parts[3].to_string(),
                    metric: parts[4].parse().unwrap_or(0),
                });
                continue;
            }
        }

        // Try Linux `ip route` format: "10.0.0.0/8 via 10.8.0.1 dev tun0 metric 100"
        if parts.len() >= 3 && parts[0].contains('/') {
            let dest_parts: Vec<&str> = parts[0].split('/').collect();
            if dest_parts.len() == 2 {
                let mask = prefix_to_mask(dest_parts[1].parse().unwrap_or(0));
                let gateway = if parts.len() > 2 && parts[1] == "via" {
                    parts[2].to_string()
                } else {
                    "0.0.0.0".to_string()
                };
                let iface = parts
                    .iter()
                    .position(|&p| p == "dev")
                    .and_then(|i| parts.get(i + 1))
                    .unwrap_or(&"")
                    .to_string();
                let metric = parts
                    .iter()
                    .position(|&p| p == "metric")
                    .and_then(|i| parts.get(i + 1))
                    .and_then(|m| m.parse().ok())
                    .unwrap_or(0);
                entries.push(RouteTableEntry {
                    destination: dest_parts[0].to_string(),
                    mask,
                    gateway,
                    interface: iface,
                    metric,
                });
            }
        }
    }

    entries
}

fn is_ip_like(s: &str) -> bool {
    s.parse::<IpAddr>().is_ok() || s.split('.').count() == 4
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Route commands (add / delete)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build the platform command to add a route.
pub fn build_add_route_cmd(route: &SubnetRoute) -> Vec<String> {
    let gw = route.gateway.as_deref().unwrap_or("vpn_gateway");

    #[cfg(target_os = "windows")]
    {
        let mut cmd = vec![
            "route".into(),
            "add".into(),
            route.network.clone(),
            "mask".into(),
            route.mask.clone(),
            gw.to_string(),
        ];
        if let Some(m) = route.metric {
            cmd.push("metric".into());
            cmd.push(m.to_string());
        }
        cmd
    }

    #[cfg(target_os = "linux")]
    {
        let prefix = mask_to_prefix(&route.mask).unwrap_or(24);
        let mut cmd = vec![
            "ip".into(),
            "route".into(),
            "add".into(),
            format!("{}/{}", route.network, prefix),
            "via".into(),
            gw.to_string(),
        ];
        if let Some(m) = route.metric {
            cmd.push("metric".into());
            cmd.push(m.to_string());
        }
        cmd
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = vec![
            "route".into(),
            "add".into(),
            "-net".into(),
            route.network.clone(),
            "-netmask".into(),
            route.mask.clone(),
            gw.to_string(),
        ];
        let _ = route.metric; // macOS route doesn't support metric directly
        cmd
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        vec!["echo".into(), "unsupported".into()]
    }
}

/// Build the platform command to delete a route.
pub fn build_delete_route_cmd(route: &SubnetRoute) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        vec![
            "route".into(),
            "delete".into(),
            route.network.clone(),
            "mask".into(),
            route.mask.clone(),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        let prefix = mask_to_prefix(&route.mask).unwrap_or(24);
        vec![
            "ip".into(),
            "route".into(),
            "del".into(),
            format!("{}/{}", route.network, prefix),
        ]
    }

    #[cfg(target_os = "macos")]
    {
        vec![
            "route".into(),
            "delete".into(),
            "-net".into(),
            route.network.clone(),
            "-netmask".into(),
            route.mask.clone(),
        ]
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        vec!["echo".into(), "unsupported".into()]
    }
}

/// Execute a route add command.
pub async fn add_route(route: &SubnetRoute) -> Result<(), OpenVpnError> {
    let cmd = build_add_route_cmd(route);
    if cmd.is_empty() {
        return Ok(());
    }
    let output = tokio::process::Command::new(&cmd[0])
        .args(&cmd[1..])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::RouteError,
            message: format!("Cannot add route: {}", e),
            detail: None,
        })?;
    if !output.status.success() {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::RouteError,
            message: format!(
                "Route add failed for {}/{}",
                route.network, route.mask
            ),
            detail: Some(String::from_utf8_lossy(&output.stderr).to_string()),
        });
    }
    Ok(())
}

/// Execute a route delete command.
pub async fn delete_route(route: &SubnetRoute) -> Result<(), OpenVpnError> {
    let cmd = build_delete_route_cmd(route);
    if cmd.is_empty() {
        return Ok(());
    }
    let output = tokio::process::Command::new(&cmd[0])
        .args(&cmd[1..])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::RouteError,
            message: format!("Cannot delete route: {}", e),
            detail: None,
        })?;
    if !output.status.success() {
        log::warn!(
            "Route delete failed for {}/{}: {}",
            route.network,
            route.mask,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Apply / rollback policy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Routes that were applied, stored for rollback.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedRoutes {
    pub routes: Vec<SubnetRoute>,
    pub original_default_gw: Option<String>,
    pub vpn_gateway: String,
}

/// Apply the routing policy after tunnel is up.
pub async fn apply_routing_policy(
    policy: &RoutingPolicy,
    vpn_gateway: &str,
    vpn_server_ip: Option<&str>,
) -> Result<AppliedRoutes, OpenVpnError> {
    let mut applied = Vec::new();

    // If bypass_vpn_server is set, add a host route for the VPN server via the original gateway
    if policy.bypass_vpn_server {
        if let Some(server_ip) = vpn_server_ip {
            let route = SubnetRoute::new(server_ip, "255.255.255.255");
            // We'd normally use the original default gateway here
            // but for now just record it
            applied.push(route);
        }
    }

    // Apply include subnets
    for subnet in &policy.include_subnets {
        let mut route = subnet.clone();
        if route.gateway.is_none() {
            route.gateway = Some(vpn_gateway.to_string());
        }
        if let Err(e) = add_route(&route).await {
            log::error!("Failed to add route {}/{}: {}", route.network, route.mask, e.message);
        } else {
            applied.push(route);
        }
    }

    // Apply static routes
    for subnet in &policy.static_routes {
        let mut route = subnet.clone();
        if route.gateway.is_none() {
            route.gateway = Some(vpn_gateway.to_string());
        }
        if let Err(e) = add_route(&route).await {
            log::error!("Failed to add static route {}/{}: {}", route.network, route.mask, e.message);
        } else {
            applied.push(route);
        }
    }

    Ok(AppliedRoutes {
        routes: applied,
        original_default_gw: None,
        vpn_gateway: vpn_gateway.to_string(),
    })
}

/// Rollback routes that were applied during connect.
pub async fn rollback_routes(applied: &AppliedRoutes) {
    for route in &applied.routes {
        if let Err(e) = delete_route(route).await {
            log::warn!(
                "Failed to rollback route {}/{}: {}",
                route.network,
                route.mask,
                e.message
            );
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Mask/prefix conversions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Convert a subnet mask to a CIDR prefix length.
pub fn mask_to_prefix(mask: &str) -> Option<u8> {
    let addr: std::net::Ipv4Addr = mask.parse().ok()?;
    let bits = u32::from(addr);
    Some(bits.leading_ones() as u8)
}

/// Convert a CIDR prefix length to a subnet mask.
pub fn prefix_to_mask(prefix: u8) -> String {
    if prefix > 32 {
        return "255.255.255.255".into();
    }
    let bits: u32 = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix)
    };
    let addr = std::net::Ipv4Addr::from(bits);
    addr.to_string()
}

/// Check whether an IP falls within a given subnet.
pub fn ip_in_subnet(ip: &str, network: &str, mask: &str) -> bool {
    let ip: u32 = match ip.parse::<std::net::Ipv4Addr>() {
        Ok(a) => a.into(),
        Err(_) => return false,
    };
    let net: u32 = match network.parse::<std::net::Ipv4Addr>() {
        Ok(a) => a.into(),
        Err(_) => return false,
    };
    let m: u32 = match mask.parse::<std::net::Ipv4Addr>() {
        Ok(a) => a.into(),
        Err(_) => return false,
    };
    (ip & m) == (net & m)
}

/// Check if an IP is in a private/RFC1918 range.
pub fn is_private_ip(ip: &str) -> bool {
    ip_in_subnet(ip, "10.0.0.0", "255.0.0.0")
        || ip_in_subnet(ip, "172.16.0.0", "255.240.0.0")
        || ip_in_subnet(ip, "192.168.0.0", "255.255.0.0")
        || ip_in_subnet(ip, "127.0.0.0", "255.0.0.0")
}

/// Build OpenVPN route directives from a routing policy.
pub fn policy_to_ovpn_directives(policy: &RoutingPolicy) -> Vec<String> {
    let mut lines = Vec::new();

    if policy.redirect_gateway {
        let mut flags = vec!["redirect-gateway".to_string()];
        if policy.bypass_lan {
            flags.push("def1".into());
        }
        if policy.bypass_vpn_server {
            flags.push("bypass-dhcp".into());
        }
        lines.push(flags.join(" "));
    }

    if !policy.pull_routes {
        lines.push("route-nopull".into());
    }

    for s in &policy.include_subnets {
        let mut parts = vec![
            "route".to_string(),
            s.network.clone(),
            s.mask.clone(),
        ];
        if let Some(gw) = &s.gateway {
            parts.push(gw.clone());
        } else {
            parts.push("vpn_gateway".into());
        }
        if let Some(m) = s.metric {
            parts.push(m.to_string());
        }
        lines.push(parts.join(" "));
    }

    if policy.ipv6_redirect {
        lines.push("redirect-gateway ipv6".into());
    }
    for r in &policy.ipv6_routes {
        let mut parts = vec!["route-ipv6".to_string(), r.network.clone()];
        if let Some(gw) = &r.gateway {
            parts.push(gw.clone());
        }
        if let Some(m) = r.metric {
            parts.push(m.to_string());
        }
        lines.push(parts.join(" "));
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Mask <-> Prefix ──────────────────────────────────────────

    #[test]
    fn mask_to_prefix_basic() {
        assert_eq!(mask_to_prefix("255.255.255.0"), Some(24));
        assert_eq!(mask_to_prefix("255.255.0.0"), Some(16));
        assert_eq!(mask_to_prefix("255.0.0.0"), Some(8));
        assert_eq!(mask_to_prefix("255.255.255.255"), Some(32));
        assert_eq!(mask_to_prefix("0.0.0.0"), Some(0));
    }

    #[test]
    fn prefix_to_mask_basic() {
        assert_eq!(prefix_to_mask(24), "255.255.255.0");
        assert_eq!(prefix_to_mask(16), "255.255.0.0");
        assert_eq!(prefix_to_mask(8), "255.0.0.0");
        assert_eq!(prefix_to_mask(32), "255.255.255.255");
        assert_eq!(prefix_to_mask(0), "0.0.0.0");
    }

    #[test]
    fn mask_prefix_roundtrip() {
        for p in 0u8..=32 {
            let mask = prefix_to_mask(p);
            assert_eq!(mask_to_prefix(&mask), Some(p));
        }
    }

    // ── ip_in_subnet ─────────────────────────────────────────────

    #[test]
    fn ip_in_subnet_true() {
        assert!(ip_in_subnet("192.168.1.100", "192.168.1.0", "255.255.255.0"));
        assert!(ip_in_subnet("10.0.5.3", "10.0.0.0", "255.0.0.0"));
    }

    #[test]
    fn ip_in_subnet_false() {
        assert!(!ip_in_subnet("192.168.2.100", "192.168.1.0", "255.255.255.0"));
        assert!(!ip_in_subnet("172.17.0.1", "192.168.0.0", "255.255.0.0"));
    }

    #[test]
    fn ip_in_subnet_invalid() {
        assert!(!ip_in_subnet("bad", "192.168.0.0", "255.255.0.0"));
    }

    // ── is_private_ip ────────────────────────────────────────────

    #[test]
    fn private_ip_check() {
        assert!(is_private_ip("10.8.0.2"));
        assert!(is_private_ip("192.168.1.1"));
        assert!(is_private_ip("172.16.0.1"));
        assert!(is_private_ip("127.0.0.1"));
        assert!(!is_private_ip("8.8.8.8"));
        assert!(!is_private_ip("1.1.1.1"));
    }

    // ── SubnetRoute ──────────────────────────────────────────────

    #[test]
    fn subnet_route_cidr() {
        let r = SubnetRoute::new("192.168.1.0", "255.255.255.0");
        assert_eq!(r.cidr_prefix(), Some(24));
    }

    #[test]
    fn subnet_route_builder() {
        let r = SubnetRoute::new("10.0.0.0", "255.0.0.0")
            .with_gateway("10.8.0.1")
            .with_metric(100);
        assert_eq!(r.gateway.as_deref(), Some("10.8.0.1"));
        assert_eq!(r.metric, Some(100));
    }

    // ── RoutingPolicy ────────────────────────────────────────────

    #[test]
    fn policy_default() {
        let p = RoutingPolicy::default();
        assert!(!p.redirect_gateway);
        assert!(p.pull_routes);
        assert!(p.bypass_lan);
    }

    #[test]
    fn policy_full_tunnel() {
        let p = RoutingPolicy::full_tunnel();
        assert!(p.redirect_gateway);
        assert!(p.bypass_lan);
        assert!(!p.is_split_tunnel());
    }

    #[test]
    fn policy_split_tunnel() {
        let p = RoutingPolicy::split_tunnel(vec![
            SubnetRoute::new("10.0.0.0", "255.0.0.0"),
        ]);
        assert!(!p.redirect_gateway);
        assert!(p.is_split_tunnel());
        assert_eq!(p.include_subnets.len(), 1);
    }

    // ── Directives generation ────────────────────────────────────

    #[test]
    fn directives_full_tunnel() {
        let p = RoutingPolicy::full_tunnel();
        let d = policy_to_ovpn_directives(&p);
        let joined = d.join("\n");
        assert!(joined.contains("redirect-gateway"));
        assert!(joined.contains("def1"));
    }

    #[test]
    fn directives_split_tunnel() {
        let p = RoutingPolicy::split_tunnel(vec![
            SubnetRoute::new("10.0.0.0", "255.0.0.0"),
        ]);
        let d = policy_to_ovpn_directives(&p);
        let joined = d.join("\n");
        assert!(joined.contains("route 10.0.0.0 255.0.0.0"));
    }

    #[test]
    fn directives_nopull() {
        let mut p = RoutingPolicy::default();
        p.pull_routes = false;
        let d = policy_to_ovpn_directives(&p);
        assert!(d.iter().any(|l| l == "route-nopull"));
    }

    #[test]
    fn directives_ipv6() {
        let mut p = RoutingPolicy::default();
        p.ipv6_redirect = true;
        p.ipv6_routes.push(Ipv6SubnetRoute {
            network: "2001:db8::/32".into(),
            gateway: None,
            metric: None,
        });
        let d = policy_to_ovpn_directives(&p);
        assert!(d.iter().any(|l| l.contains("route-ipv6")));
        assert!(d.iter().any(|l| l.contains("redirect-gateway ipv6")));
    }

    // ── Route command building ───────────────────────────────────

    #[test]
    fn build_add_cmd() {
        let r = SubnetRoute::new("10.0.0.0", "255.0.0.0").with_gateway("10.8.0.1");
        let cmd = build_add_route_cmd(&r);
        assert!(!cmd.is_empty());
        // The first element should be a route/ip command
        assert!(cmd[0] == "route" || cmd[0] == "ip");
    }

    #[test]
    fn build_delete_cmd() {
        let r = SubnetRoute::new("10.0.0.0", "255.0.0.0");
        let cmd = build_delete_route_cmd(&r);
        assert!(!cmd.is_empty());
    }

    // ── Route table parsing ──────────────────────────────────────

    #[test]
    fn parse_windows_route_table() {
        let output = "  10.0.0.0   255.0.0.0   10.8.0.1   10.8.0.2   25\n\
                       192.168.1.0   255.255.255.0   192.168.1.1   192.168.1.100   10\n";
        let entries = parse_route_table(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].destination, "10.0.0.0");
        assert_eq!(entries[0].metric, 25);
    }

    #[test]
    fn parse_linux_route_table() {
        let output = "10.0.0.0/8 via 10.8.0.1 dev tun0 metric 100\n\
                       192.168.1.0/24 via 192.168.1.1 dev eth0 metric 10\n";
        let entries = parse_route_table(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].destination, "10.0.0.0");
        assert_eq!(entries[0].gateway, "10.8.0.1");
        assert_eq!(entries[0].interface, "tun0");
        assert_eq!(entries[0].metric, 100);
    }

    #[test]
    fn parse_empty_route_table() {
        let entries = parse_route_table("");
        assert!(entries.is_empty());
    }

    // ── AppliedRoutes serde ──────────────────────────────────────

    #[test]
    fn applied_routes_serde() {
        let ar = AppliedRoutes {
            routes: vec![SubnetRoute::new("10.0.0.0", "255.0.0.0")],
            original_default_gw: Some("192.168.1.1".into()),
            vpn_gateway: "10.8.0.1".into(),
        };
        let json = serde_json::to_string(&ar).unwrap();
        let back: AppliedRoutes = serde_json::from_str(&json).unwrap();
        assert_eq!(back.routes.len(), 1);
        assert_eq!(back.vpn_gateway, "10.8.0.1");
    }

    // ── RoutingPolicy serde ──────────────────────────────────────

    #[test]
    fn routing_policy_serde_roundtrip() {
        let p = RoutingPolicy::split_tunnel(vec![
            SubnetRoute::new("10.0.0.0", "255.0.0.0").with_gateway("10.8.0.1"),
        ]);
        let json = serde_json::to_string(&p).unwrap();
        let back: RoutingPolicy = serde_json::from_str(&json).unwrap();
        assert!(back.is_split_tunnel());
        assert_eq!(back.include_subnets[0].network, "10.0.0.0");
    }

    // ── is_ip_like ───────────────────────────────────────────────

    #[test]
    fn is_ip_like_valid() {
        assert!(is_ip_like("192.168.1.1"));
        assert!(is_ip_like("0.0.0.0"));
        assert!(is_ip_like("255.255.255.255"));
    }

    #[test]
    fn is_ip_like_invalid() {
        assert!(!is_ip_like("hello"));
        assert!(!is_ip_like("10.0.0"));
    }
}
