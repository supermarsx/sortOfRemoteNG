// ── sorng-netbox – Power module ──────────────────────────────────────────────
//! Power feeds and power panels.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct PowerManager;

impl PowerManager {
    // ── Power feeds ──────────────────────────────────────────────────

    pub async fn list_power_feeds(client: &NetboxClient) -> NetboxResult<Vec<PowerFeed>> {
        client.api_get_list("/dcim/power-feeds/").await
    }

    pub async fn get_power_feed(client: &NetboxClient, id: i64) -> NetboxResult<PowerFeed> {
        let body = client.api_get(&format!("/dcim/power-feeds/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_power_feed: {e}")))
    }

    pub async fn create_power_feed(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<PowerFeed> {
        let body = client.api_post("/dcim/power-feeds/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_power_feed: {e}")))
    }

    pub async fn update_power_feed(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<PowerFeed> {
        let body = client.api_patch(&format!("/dcim/power-feeds/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_power_feed: {e}")))
    }

    pub async fn delete_power_feed(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/power-feeds/{id}/")).await?;
        Ok(())
    }

    // ── Power panels ─────────────────────────────────────────────────

    pub async fn list_power_panels(client: &NetboxClient) -> NetboxResult<Vec<PowerPanel>> {
        client.api_get_list("/dcim/power-panels/").await
    }

    pub async fn create_power_panel(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<PowerPanel> {
        let body = client.api_post("/dcim/power-panels/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_power_panel: {e}")))
    }

    pub async fn delete_power_panel(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/power-panels/{id}/")).await?;
        Ok(())
    }
}
