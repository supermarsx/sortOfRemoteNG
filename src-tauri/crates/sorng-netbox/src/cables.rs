// ── sorng-netbox/src/cables.rs ───────────────────────────────────────────────
//! Cable management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct CableManager;

impl CableManager {
    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Cable>> {
        client.api_get_paginated("dcim/cables", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Cable> {
        client.api_get(&format!("dcim/cables/{id}")).await
    }

    pub async fn create(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Cable> {
        client.api_post("dcim/cables", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Cable> {
        client.api_put(&format!("dcim/cables/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("dcim/cables/{id}")).await
    }

    pub async fn trace(
        client: &NetboxClient,
        cable_id: i64,
    ) -> NetboxResult<Vec<CableTrace>> {
        client.api_get(&format!("dcim/cables/{cable_id}/trace")).await
    }
}
