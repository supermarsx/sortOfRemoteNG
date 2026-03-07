// ── sorng-netbox – Wireless module ───────────────────────────────────────────
//! Wireless LANs, wireless LAN groups, wireless links.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct WirelessManager;

impl WirelessManager {
    // ── Wireless LANs ────────────────────────────────────────────────

    pub async fn list_wireless_lans(client: &NetboxClient) -> NetboxResult<Vec<WirelessLan>> {
        client.api_get_list("/wireless/wireless-lans/").await
    }

    pub async fn get_wireless_lan(client: &NetboxClient, id: i64) -> NetboxResult<WirelessLan> {
        let body = client.api_get(&format!("/wireless/wireless-lans/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_wireless_lan: {e}")))
    }

    pub async fn create_wireless_lan(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<WirelessLan> {
        let body = client.api_post("/wireless/wireless-lans/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_wireless_lan: {e}")))
    }

    pub async fn delete_wireless_lan(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/wireless/wireless-lans/{id}/")).await?;
        Ok(())
    }

    // ── Wireless LAN groups ──────────────────────────────────────────

    pub async fn list_wireless_lan_groups(client: &NetboxClient) -> NetboxResult<Vec<WirelessLanGroup>> {
        client.api_get_list("/wireless/wireless-lan-groups/").await
    }

    // ── Wireless links ───────────────────────────────────────────────

    pub async fn list_wireless_links(client: &NetboxClient) -> NetboxResult<Vec<WirelessLink>> {
        client.api_get_list("/wireless/wireless-links/").await
    }

    pub async fn create_wireless_link(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<WirelessLink> {
        let body = client.api_post("/wireless/wireless-links/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_wireless_link: {e}")))
    }
}
