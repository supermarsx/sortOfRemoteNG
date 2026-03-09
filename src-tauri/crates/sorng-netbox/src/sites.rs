// ── sorng-netbox/src/sites.rs ────────────────────────────────────────────────
//! DCIM Site management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct SiteManager;

impl SiteManager {
    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Site>> {
        client.api_get_paginated("dcim/sites", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Site> {
        client.api_get(&format!("dcim/sites/{id}")).await
    }

    pub async fn create(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Site> {
        client.api_post("dcim/sites", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Site> {
        client.api_put(&format!("dcim/sites/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Site> {
        client.api_patch(&format!("dcim/sites/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("dcim/sites/{id}")).await
    }

    pub async fn list_by_region(
        client: &NetboxClient,
        region: &str,
    ) -> NetboxResult<PaginatedResponse<Site>> {
        client
            .api_get_paginated("dcim/sites", &[("region", region)])
            .await
    }

    pub async fn list_by_group(
        client: &NetboxClient,
        group: &str,
    ) -> NetboxResult<PaginatedResponse<Site>> {
        client
            .api_get_paginated("dcim/sites", &[("group", group)])
            .await
    }
}
