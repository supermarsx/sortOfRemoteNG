// ── sorng-netbox – Status module ─────────────────────────────────────────────
//! NetBox status, object counts, content types, recent changes.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct StatusManager;

impl StatusManager {
    pub async fn get_status(client: &NetboxClient) -> NetboxResult<NetboxStatus> {
        let body = client.api_get("/status/").await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_status: {e}")))
    }

    pub async fn get_object_counts(client: &NetboxClient) -> NetboxResult<serde_json::Value> {
        let body = client.api_get("/status/").await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_object_counts: {e}")))
    }

    pub async fn list_content_types(client: &NetboxClient) -> NetboxResult<Vec<ContentType>> {
        client.api_get_list("/extras/content-types/").await
    }

    pub async fn list_recent_changes(client: &NetboxClient) -> NetboxResult<Vec<ObjectChange>> {
        client.api_get_list("/extras/object-changes/").await
    }
}
