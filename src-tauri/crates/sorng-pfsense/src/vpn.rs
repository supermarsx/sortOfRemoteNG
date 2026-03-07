use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct VpnManager;

impl VpnManager {
    // ── OpenVPN servers ──

    pub async fn list_openvpn_servers(client: &PfsenseClient) -> PfsenseResult<Vec<OpenVpnServer>> {
        let resp: ApiListResponse<OpenVpnServer> = client.api_get("vpn/openvpn/server").await?;
        Ok(resp.data)
    }

    pub async fn get_openvpn_server(client: &PfsenseClient, vpnid: u32) -> PfsenseResult<OpenVpnServer> {
        let resp: ApiResponse<OpenVpnServer> = client.api_get(&format!("vpn/openvpn/server/{vpnid}")).await?;
        Ok(resp.data)
    }

    pub async fn create_openvpn_server(client: &PfsenseClient, server: &OpenVpnServer) -> PfsenseResult<OpenVpnServer> {
        let resp: ApiResponse<OpenVpnServer> = client.api_post("vpn/openvpn/server", server).await?;
        Ok(resp.data)
    }

    pub async fn update_openvpn_server(client: &PfsenseClient, vpnid: u32, server: &OpenVpnServer) -> PfsenseResult<OpenVpnServer> {
        let resp: ApiResponse<OpenVpnServer> = client.api_put(&format!("vpn/openvpn/server/{vpnid}"), server).await?;
        Ok(resp.data)
    }

    pub async fn delete_openvpn_server(client: &PfsenseClient, vpnid: u32) -> PfsenseResult<()> {
        client.api_delete_void(&format!("vpn/openvpn/server/{vpnid}")).await
    }

    // ── OpenVPN clients ──

    pub async fn list_openvpn_clients(client: &PfsenseClient) -> PfsenseResult<Vec<OpenVpnClient>> {
        let resp: ApiListResponse<OpenVpnClient> = client.api_get("vpn/openvpn/client").await?;
        Ok(resp.data)
    }

    pub async fn get_openvpn_client(client: &PfsenseClient, vpnid: u32) -> PfsenseResult<OpenVpnClient> {
        let resp: ApiResponse<OpenVpnClient> = client.api_get(&format!("vpn/openvpn/client/{vpnid}")).await?;
        Ok(resp.data)
    }

    pub async fn create_openvpn_client(client: &PfsenseClient, vpn_client: &OpenVpnClient) -> PfsenseResult<OpenVpnClient> {
        let resp: ApiResponse<OpenVpnClient> = client.api_post("vpn/openvpn/client", vpn_client).await?;
        Ok(resp.data)
    }

    pub async fn update_openvpn_client(client: &PfsenseClient, vpnid: u32, vpn_client: &OpenVpnClient) -> PfsenseResult<OpenVpnClient> {
        let resp: ApiResponse<OpenVpnClient> = client.api_put(&format!("vpn/openvpn/client/{vpnid}"), vpn_client).await?;
        Ok(resp.data)
    }

    pub async fn delete_openvpn_client(client: &PfsenseClient, vpnid: u32) -> PfsenseResult<()> {
        client.api_delete_void(&format!("vpn/openvpn/client/{vpnid}")).await
    }

    // ── IPsec tunnels ──

    pub async fn list_ipsec_tunnels(client: &PfsenseClient) -> PfsenseResult<Vec<IpsecTunnel>> {
        let resp: ApiListResponse<IpsecTunnel> = client.api_get("vpn/ipsec").await?;
        Ok(resp.data)
    }

    pub async fn get_ipsec_tunnel(client: &PfsenseClient, ikeid: u32) -> PfsenseResult<IpsecTunnel> {
        let resp: ApiResponse<IpsecTunnel> = client.api_get(&format!("vpn/ipsec/{ikeid}")).await?;
        Ok(resp.data)
    }

    pub async fn create_ipsec_tunnel(client: &PfsenseClient, tunnel: &IpsecTunnel) -> PfsenseResult<IpsecTunnel> {
        let resp: ApiResponse<IpsecTunnel> = client.api_post("vpn/ipsec", tunnel).await?;
        Ok(resp.data)
    }

    pub async fn update_ipsec_tunnel(client: &PfsenseClient, ikeid: u32, tunnel: &IpsecTunnel) -> PfsenseResult<IpsecTunnel> {
        let resp: ApiResponse<IpsecTunnel> = client.api_put(&format!("vpn/ipsec/{ikeid}"), tunnel).await?;
        Ok(resp.data)
    }

    pub async fn delete_ipsec_tunnel(client: &PfsenseClient, ikeid: u32) -> PfsenseResult<()> {
        client.api_delete_void(&format!("vpn/ipsec/{ikeid}")).await
    }

    pub async fn apply_ipsec(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("vpn/ipsec/apply", &serde_json::json!({})).await
    }

    // ── WireGuard tunnels ──

    pub async fn list_wireguard_tunnels(client: &PfsenseClient) -> PfsenseResult<Vec<WireGuardTunnel>> {
        let resp: ApiListResponse<WireGuardTunnel> = client.api_get("vpn/wireguard/tunnel").await?;
        Ok(resp.data)
    }

    pub async fn get_wireguard_tunnel(client: &PfsenseClient, id: &str) -> PfsenseResult<WireGuardTunnel> {
        let resp: ApiResponse<WireGuardTunnel> = client.api_get(&format!("vpn/wireguard/tunnel/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_wireguard_tunnel(client: &PfsenseClient, tunnel: &WireGuardTunnel) -> PfsenseResult<WireGuardTunnel> {
        let resp: ApiResponse<WireGuardTunnel> = client.api_post("vpn/wireguard/tunnel", tunnel).await?;
        Ok(resp.data)
    }

    pub async fn update_wireguard_tunnel(client: &PfsenseClient, id: &str, tunnel: &WireGuardTunnel) -> PfsenseResult<WireGuardTunnel> {
        let resp: ApiResponse<WireGuardTunnel> = client.api_put(&format!("vpn/wireguard/tunnel/{id}"), tunnel).await?;
        Ok(resp.data)
    }

    pub async fn delete_wireguard_tunnel(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("vpn/wireguard/tunnel/{id}")).await
    }

    // ── WireGuard peers ──

    pub async fn list_wireguard_peers(client: &PfsenseClient, tunnel_id: &str) -> PfsenseResult<Vec<WireGuardPeer>> {
        let resp: ApiListResponse<WireGuardPeer> = client.api_get(&format!("vpn/wireguard/peer/{tunnel_id}")).await?;
        Ok(resp.data)
    }

    pub async fn get_wireguard_peer(client: &PfsenseClient, id: &str) -> PfsenseResult<WireGuardPeer> {
        let resp: ApiResponse<WireGuardPeer> = client.api_get(&format!("vpn/wireguard/peer/detail/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn create_wireguard_peer(client: &PfsenseClient, peer: &WireGuardPeer) -> PfsenseResult<WireGuardPeer> {
        let resp: ApiResponse<WireGuardPeer> = client.api_post("vpn/wireguard/peer", peer).await?;
        Ok(resp.data)
    }

    pub async fn update_wireguard_peer(client: &PfsenseClient, id: &str, peer: &WireGuardPeer) -> PfsenseResult<WireGuardPeer> {
        let resp: ApiResponse<WireGuardPeer> = client.api_put(&format!("vpn/wireguard/peer/{id}"), peer).await?;
        Ok(resp.data)
    }

    pub async fn delete_wireguard_peer(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("vpn/wireguard/peer/{id}")).await
    }

    pub async fn apply_wireguard(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_post("vpn/wireguard/apply", &serde_json::json!({})).await
    }
}
