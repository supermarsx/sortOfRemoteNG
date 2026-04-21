//! VPN nesting infrastructure for true wrap-under-wrap chaining.
//!
//! Enables traffic to flow through nested VPN tunnels (e.g., PPTP → IKEv2 → WireGuard → SOCKS5 → target)
//! by managing routing tables, SOCKS5 bridges, and interface binding between layers.

use serde::{Deserialize, Serialize};

/// How a layer connects through its predecessor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NestingMethod {
    /// No nesting (first layer, or proxy-to-proxy which chains via ports)
    Direct,
    /// Inner VPN's server IP is routed through outer VPN's gateway
    RouteBased,
    /// A local SOCKS5 proxy is spawned on the outer VPN's interface
    SocksBridge,
    /// The inner layer's socket is bound to the outer's interface
    InterfaceBind,
}

/// Context passed from one layer to the next during nested connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NestingContext {
    /// The network interface created by the previous layer (e.g., "tun0", "wg0")
    pub interface_name: Option<String>,
    /// The IP address assigned to the previous layer's interface
    pub interface_ip: Option<String>,
    /// The gateway IP of the previous layer
    pub gateway_ip: Option<String>,
    /// If a SOCKS5 bridge was created, the local port it listens on
    pub socks_port: Option<u16>,
    /// Routes added for this nesting hop (for rollback on disconnect)
    pub applied_routes: Vec<AppliedRoute>,
    /// The method used for this nesting hop
    pub method: NestingMethod,
}

impl NestingContext {
    /// Create an initial context for the first layer (no predecessor).
    pub fn initial() -> Self {
        NestingContext {
            interface_name: None,
            interface_ip: None,
            gateway_ip: None,
            socks_port: None,
            applied_routes: Vec::new(),
            method: NestingMethod::Direct,
        }
    }
}

/// A route that was added for nesting and needs to be rolled back on disconnect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedRoute {
    pub destination: String,
    pub gateway: String,
    pub interface: Option<String>,
    pub metric: Option<u32>,
}

/// Trait for VPN protocols that support nesting.
pub trait NestableVpn {
    /// Can this protocol use route-based nesting?
    fn supports_route_nesting(&self) -> bool;
    /// Can this protocol connect through a SOCKS5 proxy?
    fn supports_socks_proxy(&self) -> bool;
    /// Can this protocol connect through an HTTP proxy?
    fn supports_http_proxy(&self) -> bool;
    /// Get the server address (host:port) for routing purposes.
    fn server_address(&self) -> Option<(String, u16)>;
}

/// Determine the best nesting method for a layer pair.
pub fn select_nesting_method(
    prev_type: &super::unified_chain::TunnelType,
    curr_type: &super::unified_chain::TunnelType,
) -> NestingMethod {
    use super::unified_chain::TunnelType;

    match (prev_type, curr_type) {
        // Proxy-to-proxy: chains naturally via ports (no special nesting)
        (TunnelType::Proxy | TunnelType::Shadowsocks | TunnelType::Tor,
         TunnelType::Proxy | TunnelType::Shadowsocks | TunnelType::Tor) => {
            NestingMethod::Direct
        }
        // VPN-to-VPN: route-based nesting
        (vpn_outer, vpn_inner)
            if is_vpn_type(vpn_outer) && is_vpn_type(vpn_inner) =>
        {
            NestingMethod::RouteBased
        }
        // VPN-to-proxy: SOCKS bridge on VPN interface
        (vpn, proxy) if is_vpn_type(vpn) && is_proxy_type(proxy) => {
            NestingMethod::SocksBridge
        }
        // Proxy-to-VPN: The VPN connects normally but through the proxy's local port
        (proxy, vpn) if is_proxy_type(proxy) && is_vpn_type(vpn) => {
            // OpenVPN and SSTP support --socks-proxy natively
            match vpn {
                TunnelType::Openvpn | TunnelType::Sstp => NestingMethod::SocksBridge,
                _ => NestingMethod::RouteBased,
            }
        }
        // SSH can act as a SOCKS bridge naturally
        (TunnelType::SshTunnel | TunnelType::SshJump, _) => NestingMethod::Direct,
        (_, TunnelType::SshTunnel | TunnelType::SshJump) => NestingMethod::Direct,
        // Default: try route-based
        _ => NestingMethod::RouteBased,
    }
}

fn is_vpn_type(t: &super::unified_chain::TunnelType) -> bool {
    use super::unified_chain::TunnelType;
    matches!(
        t,
        TunnelType::Openvpn
            | TunnelType::Wireguard
            | TunnelType::Tailscale
            | TunnelType::Zerotier
            | TunnelType::Ikev2
            | TunnelType::Sstp
            | TunnelType::L2tp
            | TunnelType::Pptp
            | TunnelType::Ipsec
            | TunnelType::Softether
    )
}

fn is_proxy_type(t: &super::unified_chain::TunnelType) -> bool {
    use super::unified_chain::TunnelType;
    matches!(
        t,
        TunnelType::Proxy | TunnelType::Shadowsocks | TunnelType::Tor
    )
}

/// Add a host route for nesting: route the inner VPN's server IP through the outer VPN's gateway.
///
/// Platform-specific: uses `route add` on Windows, `ip route add` on Linux.
pub async fn add_nesting_route(
    server_ip: &str,
    gateway: &str,
    interface: Option<&str>,
) -> Result<AppliedRoute, String> {
    let route = AppliedRoute {
        destination: format!("{}/32", server_ip),
        gateway: gateway.to_string(),
        interface: interface.map(|s| s.to_string()),
        metric: Some(10),
    };

    #[cfg(windows)]
    {
        let output = tokio::process::Command::new("route")
            .args([
                "add",
                server_ip,
                "mask",
                "255.255.255.255",
                gateway,
                "metric",
                "10",
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to add route: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Route add failed: {}", stderr));
        }
    }

    #[cfg(not(windows))]
    {
        let mut args = vec![
            "route".to_string(),
            "add".to_string(),
            format!("{}/32", server_ip),
            "via".to_string(),
            gateway.to_string(),
        ];
        if let Some(iface) = interface {
            args.push("dev".to_string());
            args.push(iface.to_string());
        }
        args.push("metric".to_string());
        args.push("10".to_string());

        let output = tokio::process::Command::new("ip")
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("Failed to add route: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Route add failed: {}", stderr));
        }
    }

    Ok(route)
}

/// Remove a previously added nesting route.
pub async fn remove_nesting_route(route: &AppliedRoute) -> Result<(), String> {
    let dest = route.destination.split('/').next().unwrap_or(&route.destination);

    #[cfg(windows)]
    {
        let output = tokio::process::Command::new("route")
            .args(["delete", dest])
            .output()
            .await
            .map_err(|e| format!("Failed to remove route: {}", e))?;
        if !output.status.success() {
            log::warn!(
                "Route delete failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[cfg(not(windows))]
    {
        let output = tokio::process::Command::new("ip")
            .args(["route", "del", &route.destination])
            .output()
            .await
            .map_err(|e| format!("Failed to remove route: {}", e))?;
        if !output.status.success() {
            log::warn!(
                "Route delete failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    Ok(())
}

/// Rollback all applied routes in reverse order.
pub async fn rollback_routes(routes: &[AppliedRoute]) {
    for route in routes.iter().rev() {
        if let Err(e) = remove_nesting_route(route).await {
            log::warn!("Failed to rollback route {:?}: {}", route.destination, e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unified_chain::TunnelType;

    #[test]
    fn test_nesting_method_selection() {
        // VPN-to-VPN = route-based
        assert_eq!(
            select_nesting_method(&TunnelType::Wireguard, &TunnelType::Openvpn),
            NestingMethod::RouteBased
        );

        // VPN-to-proxy = SOCKS bridge
        assert_eq!(
            select_nesting_method(&TunnelType::Wireguard, &TunnelType::Proxy),
            NestingMethod::SocksBridge
        );

        // Proxy-to-proxy = direct (port-based)
        assert_eq!(
            select_nesting_method(&TunnelType::Proxy, &TunnelType::Shadowsocks),
            NestingMethod::Direct
        );

        // Proxy-to-OpenVPN = SOCKS bridge (OpenVPN supports --socks-proxy)
        assert_eq!(
            select_nesting_method(&TunnelType::Proxy, &TunnelType::Openvpn),
            NestingMethod::SocksBridge
        );
    }

    #[test]
    fn test_initial_context() {
        let ctx = NestingContext::initial();
        assert_eq!(ctx.method, NestingMethod::Direct);
        assert!(ctx.interface_name.is_none());
        assert!(ctx.applied_routes.is_empty());
    }
}
