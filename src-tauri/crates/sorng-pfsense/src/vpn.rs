//! VPN management for pfSense/OPNsense (IPsec, OpenVPN, WireGuard).

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct VpnManager;

impl VpnManager {
    // ── IPsec ────────────────────────────────────────────────────

    pub async fn list_ipsec_tunnels(client: &PfsenseClient) -> PfsenseResult<Vec<IpsecTunnel>> {
        let resp = client.api_get("/vpn/ipsec/phase1").await?;
        let tunnels = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        tunnels.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_ipsec_tunnel(client: &PfsenseClient, ikeid: &str) -> PfsenseResult<IpsecTunnel> {
        let tunnels = Self::list_ipsec_tunnels(client).await?;
        tunnels.into_iter()
            .find(|t| t.ikeid == ikeid)
            .ok_or_else(|| PfsenseError::vpn_tunnel_not_found(ikeid))
    }

    pub async fn create_ipsec_tunnel(client: &PfsenseClient, tunnel: &IpsecTunnel) -> PfsenseResult<IpsecTunnel> {
        let body = serde_json::to_value(tunnel)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/vpn/ipsec/phase1", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_ipsec_tunnel(client: &PfsenseClient, ikeid: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/vpn/ipsec/phase1/{ikeid}")).await
    }

    pub async fn get_ipsec_status(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        let resp = client.api_get("/vpn/ipsec/status").await?;
        Ok(resp.get("data").cloned().unwrap_or(resp))
    }

    // ── OpenVPN ──────────────────────────────────────────────────

    pub async fn list_openvpn_servers(client: &PfsenseClient) -> PfsenseResult<Vec<OpenVpnServer>> {
        let resp = client.api_get("/vpn/openvpn/server").await?;
        let servers = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        servers.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_openvpn_server(client: &PfsenseClient, vpnid: &str) -> PfsenseResult<OpenVpnServer> {
        let servers = Self::list_openvpn_servers(client).await?;
        servers.into_iter()
            .find(|s| s.vpnid == vpnid)
            .ok_or_else(|| PfsenseError::vpn_tunnel_not_found(vpnid))
    }

    pub async fn list_openvpn_clients(client: &PfsenseClient) -> PfsenseResult<Vec<OpenVpnClient>> {
        let resp = client.api_get("/vpn/openvpn/client").await?;
        let clients = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        clients.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_openvpn_client_status(client: &PfsenseClient, vpnid: &str) -> PfsenseResult<OpenVpnClient> {
        let clients = Self::list_openvpn_clients(client).await?;
        clients.into_iter()
            .find(|c| c.vpnid == vpnid)
            .ok_or_else(|| PfsenseError::vpn_tunnel_not_found(vpnid))
    }

    // ── WireGuard ────────────────────────────────────────────────

    pub async fn list_wireguard_tunnels(client: &PfsenseClient) -> PfsenseResult<Vec<WireGuardTunnel>> {
        let resp = client.api_get("/vpn/wireguard/tunnel").await?;
        let tunnels = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        tunnels.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn create_wireguard_tunnel(client: &PfsenseClient, tunnel: &WireGuardTunnel) -> PfsenseResult<WireGuardTunnel> {
        let body = serde_json::to_value(tunnel)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/vpn/wireguard/tunnel", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_wireguard_tunnel(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/vpn/wireguard/tunnel/{name}")).await
    }

    pub async fn add_wireguard_peer(client: &PfsenseClient, tunnel_name: &str, peer: &WireGuardPeer) -> PfsenseResult<WireGuardPeer> {
        let body = serde_json::to_value(peer)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post(&format!("/vpn/wireguard/tunnel/{tunnel_name}/peer"), &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn remove_wireguard_peer(client: &PfsenseClient, tunnel_name: &str, peer_id: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/vpn/wireguard/tunnel/{tunnel_name}/peer/{peer_id}")).await
    }
}
