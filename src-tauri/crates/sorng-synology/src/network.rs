//! Network management — interfaces, DNS, firewall, DHCP, VPN, proxy.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct NetworkManager;

impl NetworkManager {
    /// Get network overview (interfaces, gateway, DNS, etc.).
    pub async fn get_overview(client: &SynoClient) -> SynologyResult<NetworkOverview> {
        let v = client.best_version("SYNO.Core.Network", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Network", v, "get", &[]).await
    }

    /// List all network interfaces.
    pub async fn list_interfaces(client: &SynoClient) -> SynologyResult<Vec<NetworkInterface>> {
        let v = client.best_version("SYNO.Core.Network.Interface", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Network.Interface", v, "list", &[]).await
    }

    /// List firewall rules.
    pub async fn list_firewall_rules(client: &SynoClient) -> SynologyResult<Vec<FirewallRule>> {
        let v = client.best_version("SYNO.Core.Security.Firewall.Rules", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Security.Firewall.Rules", v, "list_all", &[]).await
    }

    /// Set firewall enabled/disabled.
    pub async fn set_firewall_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Security.Firewall", 1).unwrap_or(1);
        let val = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.Security.Firewall", v, "set", &[("enable", val)]).await
    }

    /// List DHCP server leases.
    pub async fn list_dhcp_leases(client: &SynoClient) -> SynologyResult<Vec<DhcpLease>> {
        let v = client.best_version("SYNO.Core.DHCP.Server", 1).unwrap_or(1);
        client.api_call("SYNO.Core.DHCP.Server", v, "list", &[]).await
    }

    /// Get DNS settings.
    pub async fn get_dns(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Network", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Network", v, "get", &[("group", "dns")]).await
    }

    /// Set DNS servers.
    pub async fn set_dns(
        client: &SynoClient,
        primary: &str,
        secondary: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Network", 1).unwrap_or(1);
        client.api_post_void(
            "SYNO.Core.Network",
            v,
            "set",
            &[("dns_primary", primary), ("dns_secondary", secondary)],
        )
        .await
    }

    /// List VPN profiles.
    pub async fn list_vpn_profiles(client: &SynoClient) -> SynologyResult<Vec<VpnProfile>> {
        let v = client.best_version("SYNO.Core.Network.VPN.PPTP", 1).unwrap_or(1);
        if client.has_api("SYNO.Core.Network.VPN.Profile") {
            let vp = client.best_version("SYNO.Core.Network.VPN.Profile", 1).unwrap_or(1);
            return client.api_call("SYNO.Core.Network.VPN.Profile", vp, "list", &[]).await;
        }
        // Fallback: try per-type listing
        client.api_call("SYNO.Core.Network.VPN.PPTP", v, "list", &[]).await
    }

    /// Get proxy settings.
    pub async fn get_proxy(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Network.Proxy", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Network.Proxy", v, "get", &[]).await
    }

    /// Set proxy configuration.
    pub async fn set_proxy(
        client: &SynoClient,
        enable: bool,
        host: &str,
        port: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Network.Proxy", 1).unwrap_or(1);
        let en = if enable { "true" } else { "false" };
        client.api_post_void(
            "SYNO.Core.Network.Proxy",
            v,
            "set",
            &[("enable", en), ("host", host), ("port", port)],
        )
        .await
    }

    /// Get DDNS status.
    pub async fn get_ddns(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.DDNS.Record", 1).unwrap_or(1);
        client.api_call("SYNO.Core.DDNS.Record", v, "list", &[]).await
    }
}
