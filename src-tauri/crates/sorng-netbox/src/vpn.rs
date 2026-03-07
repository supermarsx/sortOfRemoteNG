// ── sorng-netbox – VPN module ────────────────────────────────────────────────
//! Tunnels, tunnel groups, tunnel terminations, IKE/IPSec policies, L2VPNs.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct VpnManager;

impl VpnManager {
    // ── Tunnels ──────────────────────────────────────────────────────

    pub async fn list_tunnels(client: &NetboxClient) -> NetboxResult<Vec<Tunnel>> {
        client.api_get_list("/vpn/tunnels/").await
    }

    pub async fn get_tunnel(client: &NetboxClient, id: i64) -> NetboxResult<Tunnel> {
        let body = client.api_get(&format!("/vpn/tunnels/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_tunnel: {e}")))
    }

    pub async fn create_tunnel(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Tunnel> {
        let body = client.api_post("/vpn/tunnels/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_tunnel: {e}")))
    }

    pub async fn delete_tunnel(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/vpn/tunnels/{id}/")).await?;
        Ok(())
    }

    // ── Tunnel groups ────────────────────────────────────────────────

    pub async fn list_tunnel_groups(client: &NetboxClient) -> NetboxResult<Vec<TunnelGroup>> {
        client.api_get_list("/vpn/tunnel-groups/").await
    }

    // ── Tunnel terminations ──────────────────────────────────────────

    pub async fn list_tunnel_terminations(client: &NetboxClient) -> NetboxResult<Vec<TunnelTermination>> {
        client.api_get_list("/vpn/tunnel-terminations/").await
    }

    // ── IKE policies ─────────────────────────────────────────────────

    pub async fn list_ike_policies(client: &NetboxClient) -> NetboxResult<Vec<IKEPolicy>> {
        client.api_get_list("/vpn/ike-policies/").await
    }

    // ── IPSec policies ───────────────────────────────────────────────

    pub async fn list_ipsec_policies(client: &NetboxClient) -> NetboxResult<Vec<IPSecPolicy>> {
        client.api_get_list("/vpn/ipsec-policies/").await
    }

    // ── L2VPNs ───────────────────────────────────────────────────────

    pub async fn list_l2vpns(client: &NetboxClient) -> NetboxResult<Vec<L2VPN>> {
        client.api_get_list("/vpn/l2vpns/").await
    }

    // ── L2VPN terminations ───────────────────────────────────────────

    pub async fn list_l2vpn_terminations(client: &NetboxClient) -> NetboxResult<Vec<L2VPNTermination>> {
        client.api_get_list("/vpn/l2vpn-terminations/").await
    }
}
